/**
 * SPECTRE Guardrail Kernel — edge reference (JavaScript / Electron main process).
 *
 * This is the deployed-side twin of guardrails/kernel.py. It loads the SAME
 * policy.json the Python kernel exports, and mirrors the coherence checks that
 * matter for a live command: doctrine suitability, engagement reachability,
 * avoid-zone entry, engage/avoid contradiction, coordinate bounds, and
 * target-contact resolution. Run it in electron/main.js immediately before
 * writeCommandToFile(): if the deployed Tasking Layer model proposes an order,
 * evaluate() + onlineDecision() decide whether it reaches the Arma bridge.
 *
 *   const { evaluate, onlineDecision } = require('./edge_guardrail');
 *   const report = evaluate(state, orders);          // state = live tracked units + contacts
 *   const decision = onlineDecision(report, 'HOLD'); // 'block' -> do NOT send; fall back
 *   if (!decision.allowed) { holdUnit(order.unit_id, decision); return; }
 *
 * Parity is guaranteed structurally: the numbers come from policy.json (written
 * by guardrails/policy.py::as_dict), and guardrails/conformance.py proves the
 * Python side matches the legacy doctrine. Keep the check bodies here in step
 * with kernel.py — the conformance golden cases are the shared spec; port any
 * new case here when you add one there.
 *
 * Pure and dependency-free (only reads policy.json). Points are [x, y]; a third
 * component is ignored.
 */

'use strict';

const P = require('./policy.json');

const ERROR = 'error', WARN = 'warn';
const SCHEMA = 'schema', DOCTRINE = 'doctrine', GEOMETRY = 'geometry', REASONING = 'reasoning';

// --------------------------------------------------------------------------- //
// geometry (mirror of geo.py)
// --------------------------------------------------------------------------- //
function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function pointInCircle(p, c, r) { return distance(p, c) <= r; }

function distPointToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const denom = dx * dx + dy * dy;
  if (denom === 0) return distance(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denom;
  t = Math.max(0, Math.min(1, t));
  return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}

function closestApproachToPoint(path, target) {
  if (!path.length) return Infinity;
  if (path.length === 1) return distance(path[0], target);
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = distPointToSegment(target, path[i], path[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

function pathEntersCircle(path, center, radius) {
  if (!path.length) return false;
  if (path.length === 1) return pointInCircle(path[0], center, radius);
  for (let i = 0; i < path.length - 1; i++) {
    if (distPointToSegment(center, path[i], path[i + 1]) <= radius) return true;
  }
  return false;
}

// --------------------------------------------------------------------------- //
// policy helpers (mirror of policy.py)
// --------------------------------------------------------------------------- //
function threatScore(contacts) {
  return contacts.reduce((s, c) => s + (P.threat_points[c.type] ?? 1), 0);
}
function classifyThreat(contacts) {
  if (contacts.some(c => P.forces_high.includes(c.type))) return 'high';
  const t = threatScore(contacts);
  if (t >= P.threat_high_min) return 'high';
  if (t >= P.threat_med_min) return 'medium';
  return 'low';
}
function isMismatch(unitType, contactType) {
  return (P.vulnerable_to[contactType] || []).includes(unitType);
}
function inBounds(p) {
  return p[0] >= P.coord_min && p[0] <= P.coord_max &&
         p[1] >= P.coord_min && p[1] <= P.coord_max;
}

// --------------------------------------------------------------------------- //
// report
// --------------------------------------------------------------------------- //
function makeReport() {
  const findings = [];
  return {
    policy_version: P.policy_version,
    findings,
    add(code, severity, category, message, unitId, data) {
      findings.push({ code, severity, category, message, unit_id: unitId || null, data: data || {} });
    },
    get errors() { return findings.filter(f => f.severity === ERROR); },
    get warnings() { return findings.filter(f => f.severity === WARN); },
    get ok() { return findings.every(f => f.severity !== ERROR); },
  };
}

function route(order, unitPos) {
  const pts = [];
  if (unitPos) pts.push([unitPos[0], unitPos[1]]);
  for (const a of (order.anchors || [])) pts.push([a[0], a[1]]);
  if (order.target) pts.push([order.target[0], order.target[1]]);
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

// --------------------------------------------------------------------------- //
// evaluate (mirror of kernel.evaluate — coherence subset relevant to the edge)
// --------------------------------------------------------------------------- //
function evaluate(state, orders) {
  if (!state || !orders) {
    const rep = makeReport();
    rep.add('INVALID_INPUT', ERROR, SCHEMA, 'state or orders is null', null, {});
    return rep;
  }
  const rep = makeReport();
  const contacts = state.known_contacts || [];
  const contactById = {};
  for (const c of contacts) if (c.contact_id) contactById[c.contact_id] = { ...c, type: String(c.type || '').toLowerCase() };
  const units = state.friendly_units || [];
  const unitById = {};
  for (const u of units) if (u.unit_id) unitById[u.unit_id] = { ...u, type: String(u.type || '').toLowerCase() };

  // threat parity (advisory)
  if (state.threat_level != null && contacts.length) {
    const want = classifyThreat(contacts);
    if (state.threat_level !== want) {
      rep.add('THREAT_MISCLASSIFIED', WARN, SCHEMA,
        `threat_level=${state.threat_level} but classifier says ${want}`,
        null, { declared: state.threat_level, expected: want });
    }
  }

  for (const order of orders) {
    const uid = order.unit_id;
    const unit = unitById[uid] || {};
    const utype = unit.type;
    const upos = unit.pos;
    const cons = order.constraints || {};
    const engageZones = cons.engage_zones || [];
    const avoidZones = cons.avoid_zones || [];
    const rt = route(order, upos);

    // coord bounds
    const pts = [];
    if (order.target) pts.push(['target', order.target]);
    (order.anchors || []).forEach((a, i) => pts.push([`anchor[${i}]`, a]));
    avoidZones.forEach((z, i) => z.pos && pts.push([`avoid_zone[${i}]`, z.pos]));
    engageZones.forEach((z, i) => z.pos && pts.push([`engage_zone[${i}]`, z.pos]));
    for (const [label, p] of pts) {
      if (!inBounds(p)) {
        rep.add('COORD_OOR', ERROR, SCHEMA,
          `${label} [${p}] outside bounds [${P.coord_min},${P.coord_max}]`,
          uid, { where: label, point: [p[0], p[1]] });
      }
    }

    // engage zones
    const engaged = new Set();
    engageZones.forEach((z, i) => {
      const tc = z.target_contact;
      const contact = contactById[tc];
      if (!contact) {
        rep.add('ENGAGE_TARGET_UNRESOLVED', ERROR, SCHEMA,
          `engage_zone[${i}] target_contact=${tc} unresolved`, uid, { target_contact: tc });
        return;
      }
      engaged.add(tc);
      const ctype = contact.type, cpos = contact.pos;

      if (utype && ctype && isMismatch(utype, ctype)) {
        rep.add('ENGAGE_MISMATCH', ERROR, DOCTRINE,
          `${uid} (${utype}) ordered to engage ${tc} (${ctype}) — outmatched`,
          uid, { unit_type: utype, contact_id: tc, contact_type: ctype });
      }
      if (P.non_engaging_types.includes(utype)) {
        rep.add('NON_ENGAGING_TYPE_ENGAGE', WARN, DOCTRINE,
          `${uid} (${utype}) is support/transport — should not carry an engage_zone`,
          uid, { unit_type: utype, contact_id: tc });
      }
      if (cpos && P.friendly_reach[utype] != null) {
        const reach = P.friendly_reach[utype];
        const approach = closestApproachToPoint(rt, cpos);
        const budget = reach + P.reach_slack;
        if (reach <= 0) {
          rep.add('ENGAGE_UNREACHABLE', ERROR, GEOMETRY,
            `${uid} (${utype}) cannot engage ${tc}: no offensive reach`,
            uid, { unit_type: utype, contact_id: tc });
        } else if (approach > budget) {
          rep.add('ENGAGE_UNREACHABLE', ERROR, GEOMETRY,
            `${uid} (${utype}) engaging ${tc}: closest approach ${approach.toFixed(0)}m > ${reach}m reach`,
            uid, { unit_type: utype, contact_id: tc, closest_approach: +approach.toFixed(1), reach });
        }
      }
      if (cpos && z.pos && z.radius != null) {
        const d = distance(z.pos, cpos);
        if (d > z.radius) {
          rep.add('ENGAGE_ZONE_NOT_ON_CONTACT', WARN, GEOMETRY,
            `engage_zone[${i}] centre is ${d.toFixed(0)}m from ${tc} (r=${z.radius})`,
            uid, { contact_id: tc, offset: +d.toFixed(1), radius: z.radius });
        }
      }
    });

    // avoid zones
    avoidZones.forEach((z, i) => {
      if (!z.pos || z.radius == null) return;
      if (pathEntersCircle(rt, z.pos, z.radius)) {
        rep.add('AVOID_ENTERED', ERROR, GEOMETRY,
          `${uid} route enters avoid_zone[${i}] at [${z.pos}] (r=${z.radius})`,
          uid, { zone_index: i, pos: [z.pos[0], z.pos[1]], radius: z.radius });
      }
      for (const tc of engaged) {
        const c = contactById[tc];
        if (c && c.pos && pointInCircle(c.pos, z.pos, z.radius)) {
          rep.add('ENGAGE_TARGET_IN_AVOID', ERROR, GEOMETRY,
            `${uid} engages ${tc} but it lies inside avoid_zone[${i}]`,
            uid, { contact_id: tc, zone_index: i });
        }
      }
    });

    // unacknowledged-threat transit (advisory)
    for (const c of contacts) {
      if (!c.pos || c.engagement_radius == null || engaged.has(c.contact_id)) continue;
      if (pathEntersCircle(rt, c.pos, c.engagement_radius)) {
        rep.add('UNACKNOWLEDGED_THREAT', WARN, REASONING,
          `${uid} route passes through ${c.contact_id} (${c.type}) engagement radius`,
          uid, { contact_id: c.contact_id, contact_type: c.type });
      }
    }
  }
  return rep;
}

// --------------------------------------------------------------------------- //
// online decision (mirror of adapters.online_decision)
// --------------------------------------------------------------------------- //
const BLOCKING = new Set([GEOMETRY, DOCTRINE, SCHEMA]);

function onlineDecision(report, fallback = 'HOLD') {
  const blocking = report.errors.filter(f => BLOCKING.has(f.category));
  const advisories = report.findings.filter(f => !blocking.includes(f));
  if (blocking.length) {
    const codes = [...new Set(blocking.map(f => f.code))].sort();
    return {
      action: 'block', allowed: false, fallback,
      reason: `${blocking.length} blocking violation(s): ${codes.join('; ')}`,
      blocking, advisories, policy_version: report.policy_version,
    };
  }
  const codes = [...new Set(advisories.map(f => f.code))].sort();
  return {
    action: 'allow', allowed: true, fallback,
    reason: advisories.length ? `allowed with advisories: ${codes.join('; ')}` : 'clean',
    blocking: [], advisories, policy_version: report.policy_version,
  };
}

module.exports = {
  evaluate, onlineDecision,
  classifyThreat, isMismatch,
  distance, closestApproachToPoint, pathEntersCircle,
  POLICY: P,
};
