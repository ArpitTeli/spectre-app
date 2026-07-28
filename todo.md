# SPECTRE — Tasking Layer Integration Todo

## Decided

### F1 — Staleness Timeout (per-squad safety net)
Tied to threat level:
| Threat Level | Ceiling |
|---|---|
| High (MBT/IFV/heli present) | 90s |
| Medium (APC/MRAP level) | 3 min |
| Low (infantry/light only) | 5 min |

Pre-check before calling LLM: re-run route intersections, check unit health/fuel/ammo, verify objectives reachable. If clean, reset timer without LLM call.

### Single-Unit Trigger Batching
3-second window per squad. All single-unit triggers (A5, B3, D1, E1, E3) for the same squad collected within 3s → fire one squad-level replan.

### Periodic Sync
- **Interval**: 60s. Lightweight per-squad drift check — no LLM unless drift found.
- **Checks**: position drift (>100m from planned anchor), ammo/fuel below critical, engage target neutralized but squad still pushing, plan model contradicts actual unit status (operator override).
- **Escalation**: drift found → routes into F1 pre-check flow. Only calls LLM if pre-check confirms the drift matters.

### Trigger conditions adopted
Full trigger list from `Replan_threshold.txt` adopted:
- A1-A5: Threat/intel triggers
- B1-B4: Friendly-status triggers (B1 pending squad sizes)
- C1-C3: Objective/mission triggers
- D1-D2: Execution/environment triggers
- E1-E3: System/data-integrity triggers
- F1: Staleness timeout (decided above)

### Architecture
- Deterministic pre-check runs first on every trigger — LLM only wakes if situation changed enough to matter.
- Kernel gate (`edge_guardrail.js`) sits between Tasking Layer and bridge.
- Path planner fills ~50m waypoints between LLM anchors.
- Terrain data already extracted (`stratis_costgrid_weighted.npz`, 128×128×12 channels).

---

## Pending — Design Decisions

### Squad Sizes & Compositions + B1
- Need to define standard squad sizes and compositions (drone-only, since BLUFOR is unmanned)
- B1 casualty thresholds depend on these definitions
- Also affects B2 (vehicle loss semantics for drones vs crewed vehicles)

---

## BLUFOR Unmanned-Only — Files to Update

BLUFOR switches to drones/UGVs only. OPFOR keeps all conventional types (mbt, ifv, apc, mrap, etc.).

### Critical — Define what BLUFOR is

| File | What it defines |
|---|---|
| `doctrine.py` | FRIENDLY_TYPES, compositions, engagement radii, ENGAGE_GRID, VULNERABLE_TO, THREAT_POINTS |
| `scripts/pipeline/sampler.py` | 14 friendly squad archetypes — all contain mbt/ifv/apc/mrap |
| `scripts/pipeline/config.py` | UNIT_TYPES enum, 12 canonical types |
| `spectre-terrain-intelligence/backend/guardrails/policy.py` | Vendored doctrine copy — must mirror doctrine.py |
| `spectre-terrain-intelligence/backend/guardrails/policy.json` | JSON export of policy for JS edge parity |
| `spectre-terrain-intelligence/backend/pipeline/sampler.py` | Mirror of sampler — same compositions |
| `spectre-terrain-intelligence/backend/pipeline/config.py` | Mirror of config — same UNIT_TYPES |

### High — UI and bridge

| File | What it defines |
|---|---|
| `mod/addons/functions/fn_bridgeInit.sqf` | SPECTRE_fnc_vehicleType — Arma classifier using isKindOf |
| `electron/main.js` | VEHICLE_SYMBOL map, isVehicle detection, vtype mapping |
| `src/components/MapView.js` | 2D VEHICLE_SYMBOL icons |
| `src/components/SidePanel.js` | TYPE_LABELS, VEHICLE_SYMBOL, sort order |
| `src/components/MapView3D.js` | 3D model routing (tank/vehicle/infantry → needs drone/ugv) |
| `src/components/RadialMenu.js` | Per-type action menus (ARMORED, VEHICLE, etc.) |
| `src/store/useSpectreStore.js` | Firepower weights, type labels, reward values |
| `src/ai/aiService.js` | System prompt mentions "IFVs, MBTs, helicopters" |

### Medium — Downstream / validation

| File | What it defines |
|---|---|
| `validate.py` | Dataset validator — imports from doctrine.py |
| `src/lib/vault.js` | Unit/event ontology |
| `spectre-terrain-intelligence/backend/guardrails/conformance.py` | Golden tests with mbt/ifv fixtures |
| `spectre_dataset.json` | Merged training examples — regenerate with new pipeline |
| `batches/batch_opus_48.json` | Raw training batch — regenerate or keep as enemy reference |
| `pipeline.md` | Documentation — compositions, radii, unit types |
| `model-training-pipeline.md` | Documentation — per-unit-type cost weighting, avenues |
| `HANDOVER.md` | Documentation — vehicle classifier, serialization format |
| `public/models/` | 3D OBJ files (Tank.obj, Armored Vehicle.obj) — need drone models |

### Low — Inline fixtures / planning

| File | What it defines |
|---|---|
| `spectre-terrain-intelligence/backend/pipeline/teacher.py` | Inline test fixture examples |
| `spectre-terrain-intelligence/backend/pipeline/judge.py` | Inline test fixture examples |
| `future-plans-todo.md` | Planning notes — unit type references |

---

## Remaining Build Work

1. Fine-tune Gemma E4B via Unsloth (pipeline → JSONL → QLoRA → GGUF)
2. Build Tasking Layer module in spectre-app (context builder, trigger evaluator, LLM caller, path planner bridge)
3. Build edge_guardrail.js (JS mirror of kernel.py, loads policy.json)
4. Wire kernel gate in main.js before writeCommandToFile
5. Path planner integration (Python subprocess vs JS port)
6. Define drone/UGV types and their engagement radii, reach, doctrine matrix entries
7. Edit all files listed above for unmanned-only BLUFOR

### FPV Kamikaze — Flight Profile (Decided)
Three-phase approach:
| Phase | Altitude | Time (at ~100 km/h) |
|---|---|---|
| Approach (transit) | 50m AGL, terrain-following via cost grid elevation | Variable |
| Pop-up | Vertical climb 50m → 150m AGL above target | ~3s |
| Strike | Vertical 90° drop 150m → impact on top armor | ~3s |

- Transit: terrain-following at 50m AGL using cost grid channel 0 (elevation). Detour around building clusters (bldg > 2).
- Terminal: pop to 150m directly over target, then 90° vertical drop. Clears tree canopy, hits weakest armor plate.
- Mod handles collision detonation. SPECTRE provides flight path via waypoints.
- SQF: `doMove` to each waypoint. Final phase: `doMove` to point at ground level under drone, or `setVelocity` for precise drop.

### BLUFOR Doctrine — Vehicle Types (Decided)
Four vehicle types. Nyx is the only crewed exception.

| Vehicle | Type | Manned? | Targets | Tactic |
|---|---|---|---|---|
| FPV Kamikaze (AR-2 + RPG) | Suicide drone | No | MBT, IFV, APC | Swarm: 3+ per target, 150m dive top-attack |
| AWC Nyx (AT variant) | Tracked recon/AT | Yes (exception) | MBT, hardened armor | Hit-and-run: ATGM at range, relocate |
| Stomper RCWS | Wheeled UGV | No | Trucks, light vehicles, infantry | Hold ground, area denial, sustained HMG/GMG |
| ED-1E (armed variant) | Tracked mini-UGV | No | Infantry (limited), recon | Infiltrate tight spaces, observe |

Moved out of scope for now: MQ-12 Falcon, MQ-4A Greyhawk.
