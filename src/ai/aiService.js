// ─── SPECTRE AI Service ───────────────────────────────────────────────────────
// All LLM interactions: planning, COA gen, adaptation, AAR
// Features: API key rotation (last→first), sliding context window, auto-retry

const SYSTEM_PROMPT = `You are SPECTRE, an advanced military Command & Control AI.
You assist a commander by analyzing battlefield situations and generating tactical plans.

Personality: Professional, direct, analytical. Military radio format for status messages.
Use proper military terminology. Be concise but thorough.

Available assets: IFVs, MBTs, recon vehicles, helicopters, and dismounted crew.
Your job: turn battlefield data into clear, executable tactical plans.

CRITICAL RULES FOR RESPONSES:
- When asked to return JSON, ALWAYS wrap it in the specified XML tags
- Keep JSON strictly valid — no trailing commas, no comments inside JSON
- Probability estimates must be 0-100 integers
- All text fields must be non-empty strings
- waypoints array can be empty [] if no specific waypoints needed`;

class AIService {
  constructor() {
    this.config = null;
    this.conversationHistory = [];
    this.currentKeyIndex = -1;
    this.keyRetryCount = 0;
    this.MAX_RETRIES_PER_KEY = 2;
    this.RETRY_WAIT_MS = 1000;
    this.EXHAUSTED_WAIT_MS = 30000;
    this.MAX_HISTORY = 8;
    this.lastRotationTime = 0;
    this.rotationsThisSession = 0;
  }

  setConfig(config) {
    this.config = config;
    const keys = this.config?.api_keys || [];
    this.currentKeyIndex = Math.max(0, keys.length - 1);
    this.keyRetryCount = 0;
  }

  getCurrentKey() {
    const keys = this.config?.api_keys || [];
    if (keys.length === 0) return null;
    if (this.currentKeyIndex < 0 || this.currentKeyIndex >= keys.length) {
      this.currentKeyIndex = keys.length - 1;
    }
    return keys[this.currentKeyIndex];
  }

  rotateKey() {
    const keys = this.config?.api_keys || [];
    if (keys.length === 0) return;
    this.currentKeyIndex--;
    if (this.currentKeyIndex < 0) {
      this.currentKeyIndex = keys.length - 1;
    }
    this.keyRetryCount = 0;
    console.log(`SPECTRE AI: rotated to key ${keys.length - this.currentKeyIndex}/${keys.length}`);
  }

  // ── Core API call with key rotation ────────────────────────────────────────
  async call(messages, systemOverride) {
    const keys = this.config?.api_keys || [];
    if (keys.length === 0) {
      throw new Error('No API keys configured. Open Settings (⚙) and add at least one OpenRouter key.');
    }

    let totalRetries = 0;
    const MAX_TOTAL_RETRIES = keys.length * 4;

    while (totalRetries < MAX_TOTAL_RETRIES) {
      const key = this.getCurrentKey();
      if (!key) throw new Error('No valid API key available.');

      try {
        const res = await fetch(`${this.config.base_url || 'https://openrouter.ai/api/v1'}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`,
            'HTTP-Referer': 'https://spectre-c2.local',
            'X-Title': 'SPECTRE C2'
          },
          body: JSON.stringify({
            model: this.config.model || 'qwen/qwen3-next-80b-a3b-instruct:free',
            messages: [
              { role: 'system', content: systemOverride || SYSTEM_PROMPT },
              ...messages
            ],
            temperature: 0.7,
            max_tokens: 4000
          })
        });

        if (res.ok) {
          this.keyRetryCount = 0;
          let data;
          try { data = await res.json(); } catch (_) { throw new Error('Invalid JSON response from AI API'); }
          if (!data.choices?.[0]?.message?.content) {
            throw new Error('Empty response from AI API');
          }
          return data.choices[0].message.content;
        }

        const body = await res.text().catch(() => '');
        totalRetries++;

        if (res.status === 429) {
          this.keyRetryCount++;
          if (this.keyRetryCount > this.MAX_RETRIES_PER_KEY) {
            this.rotateKey();
            await this.sleep(this.RETRY_WAIT_MS);
          } else {
            await this.sleep(this.RETRY_WAIT_MS);
          }
          continue;
        }

        throw new Error(`AI API ${res.status}: ${body.slice(0, 200)}`);

      } catch (err) {
        totalRetries++;
        if (err.message?.startsWith('AI API')) throw err;
        if (err.message?.includes('429') || err.message?.includes('Rate limited')) {
          this.rotateKey();
          await this.sleep(this.RETRY_WAIT_MS);
          continue;
        }
        this.rotateKey();
        await this.sleep(this.RETRY_WAIT_MS);
      }
    }

    throw new Error(`All ${keys.length} API keys exhausted after ${totalRetries} attempts. Try again later or add more keys in Settings (⚙).`);
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Sliding window context memory ──────────────────────────────────────────
  compressHistory() {
    if (this.conversationHistory.length < this.MAX_HISTORY) return;

    // Keep last 4 messages, compress everything before them
    const toCompress = this.conversationHistory.slice(0, this.conversationHistory.length - 4);
    const toKeep = this.conversationHistory.slice(this.conversationHistory.length - 4);

    let summary = 'SESSION SUMMARY: ';
    for (const msg of toCompress) {
      const text = msg.content;
      if (text.startsWith('SESSION SUMMARY:')) {
        summary = text;
        continue;
      }
      // Extract key info: look for objective, OPORD, COA, constraints
      const clean = text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').replace(/[\n\r]+/g, ' ').trim();
      if (clean.length > 200) {
        summary += clean.slice(0, 200) + '...; ';
      } else if (clean.length > 5) {
        summary += clean + '; ';
      }
    }
    if (summary.endsWith('; ')) summary = summary.slice(0, -2);

    this.conversationHistory = [
      { role: 'user', content: summary },
      ...toKeep
    ];
  }

  // ── Planning conversation ──────────────────────────────────────────────────
  async chat(userMessage, context) {
    this.compressHistory();
    this.conversationHistory.push({ role: 'user', content: userMessage });

    const ctx = this.buildContext(context);
    const messages = [
      { role: 'user', content: `BATTLEFIELD CONTEXT:\n${ctx}\n\n---` },
      ...this.conversationHistory
    ];

    const response = await this.call(messages);
    this.conversationHistory.push({ role: 'assistant', content: response });
    return response;
  }

  resetConversation() {
    this.conversationHistory = [];
    this.keyRetryCount = 0;
    const keys = this.config?.api_keys || [];
    this.currentKeyIndex = Math.max(0, keys.length - 1);
  }

  // ── OPORD generation ───────────────────────────────────────────────────────
  async generateOPORD(objective, constraints, context, conversation) {
    const ctx = this.buildContext(context);
    const convSummary = (conversation || []).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');

    const prompt = `Generate a complete Operations Order based on this planning session.

OBJECTIVE: ${objective}
CONSTRAINTS: ${constraints}

PLANNING CONVERSATION:
${convSummary}

BATTLEFIELD CONTEXT:
${ctx}

Return JSON wrapped in <OPORD_JSON> tags:
{
  "mission_name": "string",
  "classification": "UNCLASSIFIED//EXERCISE",
  "situation": {
    "enemy": "string describing enemy forces and disposition",
    "friendly": "string describing own forces"
  },
  "mission": "single sentence mission statement",
  "execution": {
    "commander_intent": "string",
    "phases": [
      { "number": 1, "name": "string", "description": "string", "duration_min": 5 }
    ],
    "coordinating_instructions": ["string", "string"]
  },
  "abort_conditions": ["string", "string"],
  "notes": "string"
}`;

    const raw = await this.call([{ role: 'user', content: prompt }]);
    return this.extractJSON(raw, 'OPORD_JSON');
  }

  // ── COA generation ─────────────────────────────────────────────────────────
  async generateCOAs(situation, opord, context) {
    const ctx = this.buildContext(context);

    const prompt = `Generate exactly 3 tactically distinct Courses of Action.

SITUATION: ${situation}

OPORD SUMMARY:
Mission: ${opord?.mission || 'Not specified'}
Phase count: ${opord?.execution?.phases?.length || 1}

BATTLEFIELD:
${ctx}

Rules:
- Each COA must use a genuinely different approach (e.g., frontal assault vs flanking vs feint)
- Probabilities must be realistic integers 0-100
- Account for fog of war: suspected contacts reduce confidence
- waypoints use Arma grid coordinates (x, y in meters from map origin)
- If no specific coordinates known, use empty waypoints array []

Return JSON wrapped in <COA_JSON> tags:
{
  "coas": [
    {
      "id": 1,
      "name": "short name",
      "summary": "2-3 sentence description",
      "recommended": true,
      "success_probability": 75,
      "objective_capture_probability": 80,
      "time_estimate_min": { "min": 8, "max": 15 },
      "casualties": {
        "vehicles_lost": { "min": 0, "max": 1, "probability_pct": 20 },
        "crew_casualties": { "min": 0, "max": 2, "probability_pct": 25 }
      },
      "risk_level": "MEDIUM",
      "risk_factors": ["string"],
      "advantages": ["string"],
      "phases": [
        {
          "number": 1,
          "name": "string",
          "description": "string",
          "duration_sec": 120,
          "unit_orders": [
            {
              "unit_id": "use callsign or ID from context",
              "callsign": "string",
              "action": "clear description of what this unit does",
              "waypoints": [],
              "engagement_rules": "WEAPONS FREE or HOLD FIRE or ENGAGE IF FIRED UPON"
            }
          ]
        }
      ],
      "reasoning": "why this COA was designed this way"
    }
  ]
}`;

    const raw = await this.call([{ role: 'user', content: prompt }]);
    return this.extractJSON(raw, 'COA_JSON');
  }

  // ── Modify COA ─────────────────────────────────────────────────────────────
  async modifyCOA(coa, modification, context) {
    const prompt = `Modify this Course of Action based on the commander's request.

ORIGINAL COA:
${JSON.stringify(coa, null, 2)}

COMMANDER'S REQUEST: "${modification}"

CONTEXT:
${this.buildContext(context)}

Apply the modification, recalculate all probabilities, and return the updated COA.
Add a "changes" array describing what changed.

Return JSON wrapped in <COA_JSON> tags with this structure:
{
  "coas": [ { ...same structure as original plus "changes": ["string"] } ]
}`;

    const raw = await this.call([{ role: 'user', content: prompt }]);
    const result = this.extractJSON(raw, 'COA_JSON');
    if (result?.coas?.[0]) return result.coas[0];
    return this.extractJSON(raw, null);
  }

  // ── Mid-mission adaptation ─────────────────────────────────────────────────
  async adaptPlan(event, currentCOA, context) {
    const prompt = `A battlefield event has occurred. Assess and recommend adaptation.

EVENT: ${JSON.stringify(event)}

CURRENT PLAN (abbreviated):
${JSON.stringify({ name: currentCOA?.name, phases: currentCOA?.phases?.map(p => ({ name: p.name, units: p.unit_orders?.map(o => o.callsign) })) }, null, 2)}

CURRENT STATE:
${this.buildContext(context)}

Determine severity and recommend action. Return JSON (no tags needed, raw JSON only):
{
  "severity": "MINOR",
  "auto_handle": true,
  "assessment": "what happened and why it matters",
  "recommended_action": "what SPECTRE recommends",
  "comms_message": "short radio message to all units (military format)",
  "modified_orders": [
    { "unit_id": "string", "new_action": "string", "waypoints": [] }
  ],
  "new_coas": null
}

Severity guide:
- MINOR: single unit suppressed, minor delay, routine contact → auto_handle: true
- MAJOR: vehicle destroyed, ambush, significant plan change needed → auto_handle: false
- CRITICAL: multiple casualties, mission at risk → auto_handle: false, generate new_coas`;

    const raw = await this.call([{ role: 'user', content: prompt }]);
    return this.extractJSON(raw, null);
  }

  // ── AAR generation ─────────────────────────────────────────────────────────
  async generateAAR(missionData) {
    const prompt = `Generate a thorough After Action Review for this mission.

MISSION OUTCOME:
${JSON.stringify(missionData?.outcome || {}, null, 2)}

OPORD (mission was):
${missionData?.opord?.mission || 'Not recorded'}

DECISIONS MADE:
${JSON.stringify(missionData?.decisions || [], null, 2)}

COMMS LOG (last 20 entries):
${(missionData?.comms_log || []).slice(-20).map(e => `[${e.timestamp}] ${e.from}→${e.to}: ${e.message}`).join('\n')}

Be honest. If the commander made poor decisions, say so directly.

Return JSON wrapped in <AAR_JSON> tags:
{
  "mission_name": "string",
  "duration_formatted": "14m 32s",
  "outcome_summary": {
    "objective_captured": true,
    "friendly_casualties": 0,
    "vehicles_lost": 0,
    "enemy_neutralized": 0
  },
  "key_decision_points": [
    {
      "timestamp": "string",
      "event": "what happened",
      "decision_made": "what the commander chose",
      "assessment": "was this correct and why",
      "better_alternative": "what would have been better (or null if decision was good)"
    }
  ],
  "what_went_well": ["string"],
  "what_went_wrong": ["string"],
  "recommendations": "paragraph of tactical recommendations for future missions",
  "intelligence_updates": [
    { "type": "location", "data": { "name": "string", "threat_level": "HIGH", "raw_intel": "string", "observations": [] } }
  ],
  "training_notes": "paragraph on what this mission teaches about tactics"
}`;

    const raw = await this.call([{ role: 'user', content: prompt }]);
    return this.extractJSON(raw, 'AAR_JSON');
  }

  // ── Radio message generator ────────────────────────────────────────────────
  async generateRadioMessage(from, to, situation) {
    const prompt = `Write a brief military radio message. Under 2 sentences. FROM: ${from} TO: ${to} SITUATION: ${situation}. Return only the message text.`;
    return this.call([{ role: 'user', content: prompt }]);
  }

  // ── Context builder ────────────────────────────────────────────────────────
  buildContext(context) {
    if (!context) return 'No context available.';
    const { units, contacts, forceMetrics, intelDB } = context;

    const friendlyStr = Object.values(units || {})
      .filter(u => u.status !== 'DEAD' && u.status !== 'DESTROYED')
      .map(u => `  ${u.callsign} (${u.vehicle_type || 'UNKNOWN'}): HP=${u.health ?? 100}% Fuel=${u.fuel ?? 100}% Status=${u.status || 'OK'}`)
      .join('\n') || '  None';

    const enemyStr = Object.values(contacts || {})
      .map(c => `  ${c.id} [${c.state}]: ${c.type} pos=(${Math.round(c.position?.x || 0)},${Math.round(c.position?.y || 0)}) src=${c.source}`)
      .join('\n') || '  None confirmed';

    const intelStr = (intelDB?.locations || [])
      .map(l => `  ${l.name}: threat=${l.threat_level}, ${l.observations?.length || 0} obs. "${l.raw_intel || ''}"`)
      .join('\n') || '  No previous intel';

    const patternStr = (intelDB?.patterns || []).slice(-5)
      .map(p => `  ${p.type}: ${JSON.stringify(p).slice(0, 80)}`)
      .join('\n') || '  None';

    return `FRIENDLY FORCES (FP Index: ${forceMetrics?.firepower_index ?? 100}%, Mobility: ${forceMetrics?.mobility ?? 'HIGH'}):
${friendlyStr}

ENEMY CONTACTS:
${enemyStr}

LOCATION INTELLIGENCE (from previous missions):
${intelStr}

OBSERVED PATTERNS:
${patternStr}`;
  }

  // ── Robust JSON extractor ──────────────────────────────────────────────────
  extractJSON(text, tag) {
    if (!text) return null;

    if (tag) {
      const tagMatch = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      if (tagMatch) {
        try { return JSON.parse(tagMatch[1].trim()); } catch (e) {
          try { return JSON.parse(this.cleanJSON(tagMatch[1])); } catch (e2) { }
        }
      }
    }

    const candidates = [];
    let depth = 0, start = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }

    candidates.sort((a, b) => b.length - a.length);
    for (const candidate of candidates) {
      try { return JSON.parse(candidate); } catch (e) {
        try { return JSON.parse(this.cleanJSON(candidate)); } catch (e2) { }
      }
    }

    console.warn('JSON extraction failed for tag:', tag, '\nRaw text:', text.slice(0, 300));
    return null;
  }

  cleanJSON(str) {
    return str
      .trim()
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
  }
}

export const aiService = new AIService();
export default aiService;