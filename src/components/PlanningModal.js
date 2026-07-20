import React, { useState, useRef, useEffect } from 'react';
import aiService from '../ai/aiService';

export default function PlanningModal({ state, patch, addCommsEntry, addIntel, generateMissionVault }) {
  const [messages, setMessages] = useState([{
    role: 'assistant',
    content: 'SPECTRE online. Ready for mission briefing.\n\nWhat is your objective, Commander?'
  }]);
  const [input,    setInput]    = useState('');
  const [thinking, setThinking] = useState(false);
  // phase: 'CONVERSATION' | 'OPORD' | 'GENERATING'
  const [phase,    setPhase]    = useState('CONVERSATION');
  const [opord,    setOpord]    = useState(null);
  const [error,    setError]    = useState('');
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, thinking]);

  useEffect(() => {
    if (state.config) {
      aiService.setConfig(state.config);
      aiService.resetConversation();
    }
  }, [state.config]);

  // Number of user messages sent so far (used to decide when to show OPORD button)
  const userMessageCount = messages.filter(m => m.role === 'user').length;

  const handleSend = async () => {
    if (!input.trim() || thinking) return;
    const userMsg = input.trim();
    setInput('');
    setError('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setThinking(true);

    try {
      const context = {
        units: state.units,
        contacts: state.contacts,
        forceMetrics: state.forceMetrics,
        intelDB: state.intelDB
      };
      const response = await aiService.chat(userMsg, context, state.vaultPath);
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (err) {
      const msg = err.message || 'Unknown error';
      setError(msg);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠ Connection error: ${msg}\n\nCheck your API key in Settings (⚙).`
      }]);
    } finally {
      setThinking(false);
    }
  };

  const handleGenerateOPORD = async () => {
    setThinking(true);
    setPhase('GENERATING');
    setError('');

    try {
      const context = {
        units: state.units,
        contacts: state.contacts,
        forceMetrics: state.forceMetrics,
        intelDB: state.intelDB
      };

      const conversation = aiService.conversationHistory;
      // First user message is the objective, everything after is constraints/refinements
      const userMsgs   = conversation.filter(m => m.role === 'user').map(m => m.content);
      const objective  = userMsgs[0] || 'Unspecified';
      const constraints = userMsgs.slice(1).join('; ') || 'None specified';

      const generated = await aiService.generateOPORD(objective, constraints, context, conversation, state.vaultPath);

      if (!generated) throw new Error('AI returned no OPORD — check API key and model.');

      setOpord(generated);
      setPhase('OPORD');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Operations Order generated.\n\nMission: ${generated.mission || '(see below)'}\n\nReview and approve to proceed to COA generation.`
      }]);
    } catch (err) {
      setError(err.message || 'OPORD generation failed');
      setPhase('CONVERSATION');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠ OPORD generation failed: ${err.message}`
      }]);
    } finally {
      setThinking(false);
    }
  };

  const handleApproveOPORD = async () => {
    if (!opord) return;
    setThinking(true);
    setError('');

    try {
      const context = {
        units: state.units,
        contacts: state.contacts,
        forceMetrics: state.forceMetrics,
        intelDB: state.intelDB
      };

      const coaResult = await aiService.generateCOAs('Initial planning', opord, context, state.vaultPath);

      patch({
        opord,
        missionData: { opord, start_time: Date.now(), events: [], decisions: [] },
        currentCOAs: coaResult?.coas || [],
        missionPhase: 'BRIEFING',
        showCOAPanel: true
      });

      // Generate vault ontology from OPORD + COA
      if (generateMissionVault && coaResult?.coas?.[0]) {
        await generateMissionVault(opord, coaResult.coas[0]);
      }

      addCommsEntry('SPECTRE', 'ALL',
        `OPORD approved. ${opord.mission_name || 'Mission'}. Stand by for execution orders.`, 'BLUE');

      // Seed the intel DB from OPORD situation
      if (opord.situation?.enemy) {
        addIntel('location', {
          name: 'AO (from OPORD)',
          raw_intel: opord.situation.enemy,
          threat_level: 'HIGH',
          confidence: 'ASSESSED',
          observations: [{ text: opord.situation.enemy, timestamp: new Date().toISOString(), source: 'OPORD' }]
        });
      }
    } catch (err) {
      setError(err.message || 'COA generation failed');
    } finally {
      setThinking(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="planning-modal">
      <div className="planning-container">
        <div className="planning-container__header">
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div className="planning-container__title">Mission Planning</div>
            <div className="planning-container__subtitle">
              {state.armaConnected
                ? `${Object.keys(state.units).length} units available · ${Object.keys(state.contacts).length} contacts tracked`
                : 'Arma not connected — planning in simulation mode'}
            </div>
          </div>
          <button className="btn" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={() => patch({ missionPhase: 'BRIEFING' })}>
            ✕ CANCEL
          </button>
        </div>

        {phase !== 'OPORD' ? (
          <>
            <div className="planning-messages">
              {messages.map((msg, i) => (
                <div key={i} className={`planning-message ${msg.role} fade-in`}>
                  <div className="planning-message__sender">
                    {msg.role === 'user' ? '▸ COMMANDER' : '◈ SPECTRE'}
                  </div>
                  <div className="planning-message__content">
                    {msg.content.split('\n').map((line, j) => (
                      <span key={j}>{line}<br /></span>
                    ))}
                  </div>
                </div>
              ))}

              {thinking && (
                <div className="thinking-indicator">
                  <span>◈ SPECTRE PROCESSING</span>
                  <span className="thinking-dots">
                    <span>.</span><span>.</span><span>.</span>
                  </span>
                </div>
              )}

              <div ref={endRef} />
            </div>

            {/* Error banner */}
            {error && (
              <div style={{
                margin: '0 16px 8px', padding: '8px 12px',
                background: 'var(--red-dim)', border: '1px solid var(--color-red)',
                borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-red)'
              }}>
                ⚠ {error}
              </div>
            )}

            <div className="planning-input-area">
              <textarea
                className="planning-input"
                placeholder="Brief SPECTRE on your objective and constraints..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={thinking}
                rows={2}
              />
              <button className="btn btn-primary" onClick={handleSend} disabled={thinking || !input.trim()}>
                SEND
              </button>
            </div>

            {/* Show OPORD button after the first user message — no wording dependency */}
            {userMessageCount >= 1 && phase !== 'GENERATING' && (
              <div style={{
                padding: '10px 16px', borderTop: '1px solid var(--border-primary)',
                display: 'flex', gap: '8px', alignItems: 'center'
              }}>
                <div style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
                  {userMessageCount === 1
                    ? 'Ready to generate OPORD, or keep briefing SPECTRE for a more tailored plan.'
                    : `${userMessageCount} exchanges — click when you're ready to commit.`}
                </div>
                <button className="btn btn-success" onClick={handleGenerateOPORD} disabled={thinking}>
                  GENERATE OPORD
                </button>
              </div>
            )}
          </>
        ) : (
          <OPORDView opord={opord} thinking={thinking} onApprove={handleApproveOPORD} onRevise={() => setPhase('CONVERSATION')} />
        )}
      </div>
    </div>
  );
}

// ─── OPORD View ───────────────────────────────────────────────────────────────
function OPORDView({ opord, thinking, onApprove, onRevise }) {
  if (!opord) return null;
  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-accent)',
          borderRadius: '3px', padding: '16px', fontFamily: 'var(--font-mono)', fontSize: '12px'
        }}>
          <div style={{
            fontSize: '14px', fontFamily: 'var(--font-condensed)', fontWeight: 700,
            color: 'var(--accent-bright)', letterSpacing: '2px', marginBottom: '16px'
          }}>
            OPERATIONS ORDER — {opord.mission_name || 'UNTITLED'}
            <span style={{ marginLeft: '12px', fontSize: '10px', color: 'var(--text-muted)' }}>
              {opord.classification}
            </span>
          </div>

          <Section title="1. SITUATION">
            <SubSection title="ENEMY">{opord.situation?.enemy}</SubSection>
            <SubSection title="FRIENDLY">{opord.situation?.friendly}</SubSection>
          </Section>

          <Section title="2. MISSION">
            <div style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>{opord.mission}</div>
          </Section>

          <Section title="3. EXECUTION">
            <SubSection title="COMMANDER'S INTENT">{opord.execution?.commander_intent}</SubSection>
            {(opord.execution?.phases || []).map((ph, i) => (
              <div key={i} style={{ marginBottom: '8px' }}>
                <div style={{ color: 'var(--accent-bright)', marginBottom: '4px' }}>
                  PHASE {ph.number || i + 1}: {ph.name}
                  {ph.duration_min && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>({ph.duration_min} min)</span>
                  )}
                </div>
                <div style={{ color: 'var(--text-secondary)', paddingLeft: '12px' }}>{ph.description}</div>
              </div>
            ))}
          </Section>

          {(opord.execution?.coordinating_instructions || []).length > 0 && (
            <Section title="COORDINATING INSTRUCTIONS">
              {opord.execution.coordinating_instructions.map((inst, i) => (
                <div key={i} style={{ color: 'var(--text-secondary)', paddingLeft: '8px', marginBottom: '4px' }}>• {inst}</div>
              ))}
            </Section>
          )}

          {(opord.abort_conditions || []).length > 0 && (
            <Section title="ABORT CONDITIONS">
              {opord.abort_conditions.map((cond, i) => (
                <div key={i} style={{ color: 'var(--color-yellow)', paddingLeft: '8px', marginBottom: '4px' }}>⚠ {cond}</div>
              ))}
            </Section>
          )}
        </div>
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-primary)', display: 'flex', gap: '8px' }}>
        <button className="btn" onClick={onRevise} disabled={thinking}>◀ REVISE</button>
        <button className="btn btn-success" style={{ flex: 1 }} onClick={onApprove} disabled={thinking}>
          {thinking ? 'GENERATING COAs...' : 'APPROVE & GENERATE COAs'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{
        color: 'var(--text-bright)', fontWeight: 'bold', marginBottom: '6px',
        borderBottom: '1px solid var(--border-primary)', paddingBottom: '4px'
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function SubSection({ title, children }) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: '10px', letterSpacing: '1px', marginBottom: '3px' }}>{title}</div>
      <div style={{ color: 'var(--text-primary)', paddingLeft: '8px', lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}
