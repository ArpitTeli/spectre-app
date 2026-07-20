// ─── SPECTRE Vault: Ontology Layer ──────────────────────────────────────────
// .md files with YAML frontmatter + [[wikilinks]] = typed knowledge graph
// Obsidian-compatible format, Palantir-style Ontology for LLM grounding

// ── YAML Frontmatter Parser ─────────────────────────────────────────────────
export function parseFrontmatter(content) {
  if (!content || typeof content !== 'string') return { frontmatter: {}, body: content || '' };
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const yaml = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();

    // Parse arrays like ["a", "b"]
    if (val.startsWith('[') && val.endsWith(']')) {
      try {
        frontmatter[key] = JSON.parse(val);
      } catch {
        frontmatter[key] = val;
      }
    }
    // Parse booleans
    else if (val === 'true') frontmatter[key] = true;
    else if (val === 'false') frontmatter[key] = false;
    // Parse numbers
    else if (/^\d+(\.\d+)?$/.test(val)) frontmatter[key] = Number(val);
    // Parse ISO dates
    else if (/^\d{4}-\d{2}-\d{2}T/.test(val)) frontmatter[key] = val;
    // Parse quoted strings
    else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      frontmatter[key] = val.slice(1, -1);
    }
    // Default string
    else frontmatter[key] = val;
  }

  return { frontmatter, body };
}

// ── YAML Frontmatter Writer ─────────────────────────────────────────────────
export function writeFrontmatter(frontmatter, body) {
  const lines = ['---'];
  for (const [key, val] of Object.entries(frontmatter)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      lines.push(`${key}: ${JSON.stringify(val)}`);
    } else if (typeof val === 'string' && (val.includes(':') || val.includes('#') || val.includes('"'))) {
      lines.push(`${key}: "${val.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(body || '');
  return lines.join('\n');
}

// ── Wikilink Extraction ─────────────────────────────────────────────────────
export function extractWikilinks(body) {
  if (!body) return [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links = [];
  let match;
  while ((match = regex.exec(body)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

// ── Graph Builder from Wikilinks ────────────────────────────────────────────
export function buildGraphFromWikilinks(nodes) {
  const edges = [];
  const seen = new Set();

  for (const node of nodes) {
    const sourceId = node.frontmatter?.id;
    if (!sourceId) continue;

    for (const link of (node.wikilinks || [])) {
      const targetId = link.toLowerCase().replace(/\s+/g, '-');
      const edgeKey = [sourceId, targetId].sort().join('→');
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      edges.push({ source: sourceId, target: targetId, label: link });
    }
  }

  return edges;
}

// ── Node ID generator ───────────────────────────────────────────────────────
function slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Node Factories ──────────────────────────────────────────────────────────
export function createUnitNode(unit) {
  const body = [
    `${unit.callsign || unit.id} is assigned to the current mission.`,
    unit.current_order ? `Current order: ${unit.current_order}` : '',
  ].filter(Boolean).join('\n');

  return {
    frontmatter: {
      id: unit.id || slugify(unit.callsign),
      type: 'unit',
      callsign: unit.callsign || unit.id,
      vehicle_type: unit.vehicle_type || unit.type || 'UNKNOWN',
      health: unit.health ?? 100,
      fuel: unit.fuel ?? 100,
      ammo: unit.ammo ?? 100,
      status: unit.status || 'ALIVE',
      position_x: Math.round(unit.position?.x || 0),
      position_y: Math.round(unit.position?.y || 0),
      current_order: unit.current_order || '',
      updated_at: new Date().toISOString(),
      tags: ['friendly', (unit.vehicle_type || 'unknown').toLowerCase()]
    },
    body
  };
}

export function createContactNode(contact) {
  const body = [
    `Contact ${contact.id} — ${contact.type || 'UNKNOWN'} (${contact.state}).`,
    `Source: ${contact.source || 'UNKNOWN'}.`,
  ].join('\n');

  return {
    frontmatter: {
      id: contact.id || `contact-${Date.now()}`,
      type: 'contact',
      contact_type: contact.type || 'UNKNOWN',
      state: contact.state || 'CONFIRMED',
      position_x: Math.round(contact.position?.x || 0),
      position_y: Math.round(contact.position?.y || 0),
      source: contact.source || 'UNKNOWN',
      last_seen: contact.last_seen ? new Date(contact.last_seen).toISOString() : new Date().toISOString(),
      tags: ['hostile', (contact.state || 'unknown').toLowerCase()]
    },
    body
  };
}

export function createObjectiveNode(objective) {
  const body = [
    `${objective.name || objective.id}: ${objective.description || ''}`,
  ].join('\n');

  return {
    frontmatter: {
      id: objective.id || slugify(objective.name),
      type: 'objective',
      name: objective.name || objective.id,
      status: objective.status || 'NOT_STARTED',
      priority: objective.priority || 'HIGH',
      description: objective.description || '',
      tags: ['objective', (objective.priority || 'high').toLowerCase()]
    },
    body
  };
}

export function createPhaseNode(phase) {
  const units = (phase.unit_orders || []).map(o => o.callsign || o.unit_id).filter(Boolean);
  const unitLinks = units.map(u => `[[${u}]]`).join(', ');

  const body = [
    `Phase ${phase.number || 1}: ${phase.name || ''}.`,
    phase.description || '',
    units.length > 0 ? `Units assigned: ${unitLinks}` : '',
  ].filter(Boolean).join('\n');

  return {
    frontmatter: {
      id: `phase-${phase.number || 1}`,
      type: 'phase',
      number: phase.number || 1,
      name: phase.name || `Phase ${phase.number || 1}`,
      description: phase.description || '',
      duration_min: phase.duration_min || 5,
      status: phase.status || 'PENDING',
      tags: ['phase']
    },
    body
  };
}

export function createIntelNode(intel) {
  const body = [
    intel.raw_intel || intel.text || '',
    intel.observations?.length ? `${intel.observations.length} observations.` : '',
  ].filter(Boolean).join('\n');

  return {
    frontmatter: {
      id: `intel-${slugify(intel.name || intel.id || String(Date.now()))}`,
      type: 'intel',
      source: intel.confidence || intel.source || 'PLAYER_REPORTED',
      classification: intel.classification || 'UNCLASSIFIED',
      threat_level: intel.threat_level || 'MEDIUM',
      confidence: intel.confidence || 'ASSESSED',
      timestamp: intel.timestamp || new Date().toISOString(),
      tags: ['intel', (intel.threat_level || 'medium').toLowerCase()]
    },
    body
  };
}

export function createMissionNode(opord) {
  const phaseLinks = (opord?.execution?.phases || [])
    .map(p => `[[Phase-${p.number || 1}]]`)
    .join(', ');

  const body = [
    `Mission: ${opord?.mission || opord?.mission_name || 'Unnamed'}.`,
    `Commander's intent: ${opord?.execution?.commander_intent || 'Not specified'}.`,
    phaseLinks ? `Phases: ${phaseLinks}` : '',
  ].filter(Boolean).join('\n');

  return {
    frontmatter: {
      id: 'mission-current',
      type: 'mission',
      name: opord?.mission_name || 'Current Mission',
      classification: opord?.classification || 'UNCLASSIFIED//EXERCISE',
      commander_intent: opord?.execution?.commander_intent || '',
      start_time: new Date().toISOString(),
      status: 'ACTIVE',
      tags: ['mission']
    },
    body
  };
}

// ── Vault API (uses window.spectreAPI for file I/O) ─────────────────────────

export async function createVault(missionId) {
  const vaultPath = await window.spectreAPI?.vaultCreate?.(missionId);
  return vaultPath;
}

export async function writeNode(vaultPath, node) {
  if (!vaultPath || !node?.frontmatter?.id) return false;
  const content = writeFrontmatter(node.frontmatter, node.body);
  const filename = `${node.frontmatter.id}.md`;
  return window.spectreAPI?.vaultWriteNode?.(vaultPath, filename, content);
}

export async function readVaultNodes(vaultPath) {
  if (!vaultPath) return [];
  const files = await window.spectreAPI?.vaultReadNodes?.(vaultPath);
  if (!files || !Array.isArray(files)) return [];

  return files.map(file => {
    const { frontmatter, body } = parseFrontmatter(file.content);
    const wikilinks = extractWikilinks(body);
    return { ...file, frontmatter, body, wikilinks };
  });
}

export async function updateNode(vaultPath, nodeId, updates) {
  if (!vaultPath || !nodeId) return false;
  return window.spectreAPI?.vaultUpdateNode?.(vaultPath, nodeId, updates);
}

export async function addWikilink(vaultPath, nodeId, targetTitle) {
  if (!vaultPath || !nodeId || !targetTitle) return false;
  return window.spectreAPI?.vaultAddWikilink?.(vaultPath, nodeId, targetTitle);
}

// ── High-level: Generate full vault from OPORD + COA ────────────────────────
export async function generateVault(opord, coa, state) {
  const missionId = `mission-${Date.now()}`;
  const vaultPath = await createVault(missionId);
  if (!vaultPath) return null;

  const nodes = [];

  // Mission node
  nodes.push(createMissionNode(opord));

  // Phase nodes
  const phases = coa?.phases || opord?.execution?.phases || [];
  for (const phase of phases) {
    nodes.push(createPhaseNode(phase));
  }

  // Objective nodes
  const objective = {
    id: 'objective-alpha',
    name: opord?.mission_name || 'Primary Objective',
    description: opord?.mission || 'No description',
    status: 'NOT_STARTED',
    priority: 'HIGH'
  };
  nodes.push(createObjectiveNode(objective));

  // Unit nodes from current state
  for (const unit of Object.values(state.units || {})) {
    const unitNode = createUnitNode(unit);
    // Add wikilinks to phase
    if (phases.length > 0) {
      unitNode.body += `\nAssigned to [[Phase-1]].`;
    }
    nodes.push(unitNode);
  }

  // Intel nodes
  for (const loc of (state.intelDB?.locations || [])) {
    nodes.push(createIntelNode(loc));
  }

  // Write all nodes
  for (const node of nodes) {
    await writeNode(vaultPath, node);
  }

  return vaultPath;
}

// ── High-level: Update vault on significant events ──────────────────────────
export async function vaultOnEvent(vaultPath, event, state) {
  if (!vaultPath) return;

  switch (event.type) {
    case 'UNIT_KIA':
    case 'VEHICLE_DESTROYED': {
      const unitId = event.unit_id || event.id;
      if (unitId) {
        await updateNode(vaultPath, unitId, {
          status: event.type === 'UNIT_KIA' ? 'DEAD' : 'DESTROYED'
        });
      }
      break;
    }
    case 'CONTACT_SPOTTED': {
      const contact = state.contacts?.[event.contact_id] || event;
      const contactNode = createContactNode(contact);
      await writeNode(vaultPath, contactNode);
      break;
    }
    case 'ENEMY_KILLED': {
      const contactId = event.contact_id || event.id;
      if (contactId) {
        await updateNode(vaultPath, contactId, { state: 'DESTROYED' });
      }
      break;
    }
    default:
      break;
  }
}

const vault = {
  parseFrontmatter, writeFrontmatter, extractWikilinks, buildGraphFromWikilinks,
  createUnitNode, createContactNode, createObjectiveNode, createPhaseNode, createIntelNode, createMissionNode,
  createVault, writeNode, readVaultNodes, updateNode, addWikilink,
  generateVault, vaultOnEvent
};

export default vault;
