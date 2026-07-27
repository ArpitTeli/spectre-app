# SPECTRE Guardrails — edge (on-device command gate)

`edge_guardrail.js` is the deployed-side twin of the Python Guardrail Kernel in
the `spectre-terrain-intelligence` repo (`backend/guardrails/`). It runs the
**same** coherence checks against the **same** `policy.json`, so an order the
offline data pipeline would reject is one the edge refuses to send — the model
is never taught a policy its runtime forbids (train/serve parity).

Pure and dependency-free: it only reads `policy.json` at `require` time. No
Python, no network.

## What it checks

Doctrine suitability (outmatched engager), engagement reachability (can the unit
ever get within its own weapon reach of the contact it declares engaging),
avoid-zone entry, engage/avoid contradiction, coordinate bounds, and
target-contact resolution. See `kernel.py` in the terrain repo for the shared
spec; the two are kept in step via `conformance.py`.

## How to wire it in (when the Tasking Layer lands)

The intended gate is the **output of the on-edge Tasking Layer model** — the
future component that emits orders in the `{unit_id, intent, target, anchors,
constraints:{engage_zones, avoid_zones}}` schema, before the path planner turns
anchors into dense waypoints. It is **not yet wired into `main.js`**: today's
commands arrive from a relay operator in the post-resolution `EXECUTE_ORDER`
(waypoint) schema, which is a different shape and not what this kernel gates.
Wiring it into that path now would be a schema mismatch, so `main.js` is left
untouched.

When the Tasking Layer is added, gate its orders at the chokepoint before
`queueCommand()` / `writeCommandToFile()`:

```js
const { evaluate, onlineDecision } = require('./guardrails/edge_guardrail');

// state = live tracked units + contacts; orders = Tasking Layer model output
const report   = evaluate(state, orders);
const decision = onlineDecision(report, 'HOLD');

if (!decision.allowed) {
  dbg(`SPECTRE guardrail BLOCK ${order.unit_id}: ${decision.reason}`);
  holdUnit(order.unit_id);   // fall back; do NOT write to the Arma bridge
  return;
}
// safe to queueCommand(...) → spectre_cmds.sqf
```

`onlineDecision` blocks on any GEOMETRY / DOCTRINE / SCHEMA error and recommends
a safe fallback (default `HOLD`); WARN-level findings are advisory (the order
proceeds, the operator is told).

## Keeping parity

`policy.json` is copied from the terrain repo's `backend/guardrails/policy.json`.
If the doctrine/threat/reach tables change there, re-copy this file. The numeric
tables flow automatically (read from JSON); only structural logic changes need a
matching edit in `edge_guardrail.js`, guarded by the conformance golden cases.
