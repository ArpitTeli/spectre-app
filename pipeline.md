# SPECTRE — Full System Pipeline

End-to-end documentation of how terrain intelligence flows from Arma 3 into AI-generated orders, and how training data is produced to fine-tune the local Gemma E4B model.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ARMA 3 (SQF Mod)                            │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │ export_cost_grid  │    │  fn_bridgeInit   │    │ Order Executor │ │
│  │   (one-time)      │    │  (live loop)     │    │  doMove/WPs   │ │
│  └────────┬─────────┘    └────────┬─────────┘    └───────▲───────┘ │
│           │ diag_log              │ diag_log              │ setVariable│
└───────────┼───────────────────────┼───────────────────────┼──────────┘
            │ RPT                   │ RPT                   │
            ▼                       ▼                       │
┌─────────────────────┐  ┌──────────────────────┐          │
│ rpt_to_cost_grid.py │  │  RPT Parser (Node)   │          │
│   (one-time)        │  │  reads Arma state    │          │
└─────────┬───────────┘  └──────────┬───────────┘          │
          │                         │                       │
          ▼                         ▼                       │
┌─────────────────────┐  ┌──────────────────────┐          │
│ stratis_costgrid    │  │  Electron App (UI)   │          │
│    .npz (128×128×5) │  │  useSpectreStore     │          │
└─────────┬───────────┘  └──────────┬───────────┘          │
          │                         │                       │
          ▼                         ▼                       │
┌─────────────────────┐  ┌──────────────────────┐          │
│ apply_cost_weights  │  │   aiService.js       │          │
│  (12 unit types)    │  │  LLM calls via       │          │
└─────────┬───────────┘  │  OpenRouter/Local    │          │
          │               └──────────┬───────────┘          │
          ▼                          │ orders              │
┌─────────────────────┐              │                      │
│ stratis_costgrid    │              │                      │
│  _weighted.npz      │              │                      │
│  (128×128×12)       │              │                      │
└─────────┬───────────┘              │                      │
          │                          │                      │
          ▼                          ▼                      │
┌──────────────────────────────────────────────────┐       │
│              Path Planner (A*)                    │       │
│  plan_route() / plan_multi_anchor()              │       │
│  8-directional, ~50m spacing, 12 unit types      │       │
└─────────┬────────────────────────────────────────┘       │
          │                                                 │
          ▼                                                 │
┌──────────────────────────────────────────────────┐       │
│         OAKOC Feature Extractor                   │       │
│  key_terrain, obstacles, cover, exposed, avenues  │       │
└─────────┬────────────────────────────────────────┘       │
          │                                                 │
          ▼                                                 │
┌──────────────────────────────────────────────────┐       │
│         Route Candidate Generator                 │       │
│  2-5 routes (direct/road/cover/flank)            │       │
│  OAKOC-scored, LLM selects                       │       │
└──────────────────────────────────────────────────┘       │
                                                           │
          ┌────────────────────────────────────────────────┘
          │ spectre_to_arma.sqf
          │ (DLL callExtension)
          ▼
┌─────────────────────┐
│  Arma 3 executes    │
│  doMove / waypoints │
└─────────────────────┘
```

---

## Part 1: Terrain Intelligence Pipeline

This is the one-time setup that produces terrain-aware routing data from Arma 3's map.

### Step 1: SQF Terrain Export

**File:** `mod/addons/functions/export_cost_grid.sqf`

Run once in Arma 3 Eden Editor. Scans the entire 8192×8192m map in three passes, writing to the RPT log via `diag_log`. Each pass emits one row per scan line (128 rows total, 64m per cell = 128×128 grid).

**Pass 1 — `SPECTRE_SURFGRID`** (surface codes):
- Scans `surfaceType` at each cell center
- Classifies into 7 surface types: grass=1, forest=2, concrete=3, water=4, dirt=5, rock=6, unknown=0
- Output: `SPECTRE_SURFGRID:1;2;3;1;5;0;...;` per row

**Pass 2 — `SPECTRE_OBJGRID`** (vegetation + buildings):
- Counts `nearestTerrainObjects` within 32m radius
- Vegetation: trees, small trees, forest borders, bushes
- Buildings: buildings, houses, walls, bunkers, ruins
- Output: `SPECTRE_OBJGRID:veg,bldg;veg,bldg;...;` per row

**Pass 3 — `SPECTRE_ROADGRID`** (road presence):
- Uses `nearRoads` with 48m radius (0.75 × cell size)
- Binary: 1 if any road segment is nearby, 0 otherwise
- Output: `SPECTRE_ROADGRID:1;0;0;1;...;` per row

### Step 2: RPT Parser

**File:** `scripts/rpt_to_cost_grid.py`

Reads the Arma 3 RPT log file, parses the three grid passes, and saves a compressed NumPy archive.

```
Input:  Arma3.rpt (containing SPECTRE_SURFGRID, SPECTRE_OBJGRID, SPECTRE_ROADGRID)
Output: public/maps/stratis_costgrid.npz  (shape: [128, 128, 5])
```

The 5 channels:
| Channel | Content | Range |
|---------|---------|-------|
| 0 | Elevation (cm) | -1575 to 3924 |
| 1 | Surface code | 0-6 |
| 2 | Vegetation count | 0-N |
| 3 | Building count | 0-N |
| 4 | Road presence | 0 or 1 |

### Step 3: Cost Weight Applicator

**File:** `scripts/apply_cost_weights.py`

Applies per-unit-type cost weights to the raw 5-channel grid, producing a 12-channel weighted grid (one channel per unit type).

```
Input:  stratis_costgrid.npz       (128×128×5)
Output: stratis_costgrid_weighted.npz  (128×128×12)
```

**12 unit types:** mbt, ifv, apc, mrap, light, truck, spg, spaa, eng, infantry, helicopter, boat

**Density-aware cost model:**
```
total = base_surface + (veg_count × veg_factor) × (1 + slope_degrees × slope_factor)
```
- Vegetation on steep ground is worse than either alone (multiplicative interaction)
- Slope computed from elevation gradient using `np.gradient`

**Road bonuses** (reduced cost for cells with roads=1):
| Unit Type | Road Factor | Reasoning |
|-----------|-------------|-----------|
| truck | 0.10 | Strongest road preference |
| mbt, apc, mrap | 0.25 | Heavy vehicles favor roads |
| ifv, light, spg, spaa | 0.30 | Moderate road benefit |
| eng | 0.35 | Engineer vehicles |
| infantry | 1.0 | Roads no advantage (infantry uses terrain) |
| helicopter | 1.0 | Airborne, roads irrelevant |

**Rock costs** (heavily penalized):
| Unit Type | Rock Cost | Reasoning |
|-----------|-----------|-----------|
| mbt | 25 | Heavy tracked, avoids rocks |
| ifv | 30 | Wheeled/tracked, rocks slow |
| apc | 30 | Same as IFV |
| mrap | 35 | Wheeled, rocks dangerous |
| light | 30 | Light wheeled |
| truck | 40 | Most vulnerable to rocks |
| infantry | 3.0 | Can navigate but slower |
| helicopter | 1.0 | Airborne |

**APC amphibious:** Water cost = 1.8 (can cross water but slower than land)

**Helicopter:** Ignores all terrain (cost = 1.0 everywhere)

---

## Part 2: Path Planning

### A* Path Planner

**File:** `scripts/path_planner.py`

Deterministic A* search over the weighted cost grid. No AI — pure graph search.

**Key functions:**
- `plan_route(start, end, unit_type)` — Single route from A to B
- `plan_multi_anchor(start, anchors, end, unit_type)` — Route through intermediate waypoints (chained A* segments)

**Parameters:**
- Grid: 128×128 cells, 64m each = 8192m map
- Movement: 8-directional (N/S/E/W + diagonals, diagonal cost ×1.414)
- Waypoint spacing: ~50m (thinned from full A* path)
- Impassable: Cells with cost ≥ 50.0 are treated as walls
- Avoid zones: Injected as cost penalties (10.0 × inverse distance from center)

**Usage:**
```python
from scripts.path_planner import plan_route, plan_multi_anchor

# Simple A→B
waypoints = plan_route(
    start=(4096, 4096),
    end=(6000, 3000),
    unit_type="infantry"
)

# Through anchor waypoints
waypoints = plan_multi_anchor(
    start=(2592, 288),
    anchors=[(3500, 1500), (5000, 2500)],
    end=(5152, 3552),
    unit_type="mbt",
    avoid_zones=[(4000, 2000, 300)]  # (x, y, radius)
)
```

### OAKOC Feature Extractor

**File:** `scripts/oakoc_extractor.py`

Scans a corridor between start and end positions, extracting terrain features relevant to the entire maneuver corridor. The LLM sees: "here's what's between you and your objective."

**Corridor:** 800m margin around the direct line between start and end.

**5 feature categories:**

| Category | What it finds | Max items |
|----------|--------------|-----------|
| `key_terrain` | High-elevation observation points with good visibility | 5 |
| `obstacles` | Water bodies (flood-fill clustered) and steep slopes (>20°) | 8 |
| `cover_concealment` | Forest zones (veg≥5) and building clusters (bldg≥2) | 6 |
| `exposed_zones` | Cells within engagement range AND line-of-sight of known threats | 10 |
| `avenues_of_approach` | (Derived from route analysis) | 3 |

**Output format:**
```json
{
  "start": [2592, 288],
  "end": [5152, 3552],
  "unit_type": "infantry",
  "route_waypoints": 42,
  "corridor_bbox": {"min": [1792, -512], "max": [5888, 4352]},
  "key_terrain": [{"pos": [3200, 1920], "elevation": 85.2, "prominence": 22.1, "visibility": 0.75}],
  "obstacles": [{"type": "water", "pos": [4000, 2560], "cells": 12}],
  "cover_concealment": [{"pos": [2880, 1280], "cover_type": ["concealment"], "forest_score": 15}],
  "exposed_zones": [{"pos": [3520, 1920], "visible_to": ["enemy_0"]}]
}
```

### Route Candidate Generator

**File:** `scripts/route_candidates.py`

Generates 2-5 tactically distinct routes per scenario, each OAKOC-evaluated, then the LLM picks from the scored list.

**Route strategies:**
| Strategy | Description |
|----------|-------------|
| `direct` | Straight-line A* (shortest path) |
| `road_preferred` | Heavily weighted toward road cells |
| `cover_preferred` | Routes through high-vegetation/building zones |
| `left_flank` | Waypoints offset to the left of direct line |
| `right_flank` | Waypoints offset to the right of direct line |

**Hybrid planning model:**
```
Route candidates → OAKOC scores each → LLM selects (fast selection, not computation)
```

---

## Part 3: Live Bridge (Arma 3 ↔ SPECTRE App)

### SQF Side: fn_bridgeInit.sqf

**File:** `mod/addons/functions/fn_bridgeInit.sqf`

Runs inside Arma 3 as a continuous loop. Two directions of data flow:

**Arma → SPECTRE (every 0.5s via `diag_log`):**
- Serializes all BLUFOR units: position, heading, HP, fuel, speed, ammo, vehicle membership, crew, current order, status
- Serializes all enemy contacts: position, type, state (CONFIRMED/DEAD)
- Serializes mission events: UNIT_KIA, VEHICLE_DESTROYED, ENEMY_KILLED, CONTACT_SPOTTED
- Writes JSON to `state.json` in the bridge folder

**SPECTRE → Arma (every 0.3s via DLL `callExtension`):**
- Reads `spectre_to_arma.sqf` file
- Executes SQF commands: `doMove`, waypoint creation, unit status changes
- Handles order dispatch: matching unit callsigns, setting variables, issuing movement commands

**Key SQF functions:**
| Function | Purpose |
|----------|---------|
| `SPECTRE_fnc_serializeUnit` | JSON-serialize one BLUFOR unit |
| `SPECTRE_fnc_serializeContact` | JSON-serialize one enemy contact |
| `SPECTRE_fnc_execCmd` | Execute a command from SPECTRE |
| `SPECTRE_fnc_artilleryStrike` | Fire artillery at target coordinates |

### Node.js Side: RPT Parser → Electron App

**Flow:**
1. Node.js process watches the Arma 3 RPT file for `SPECTRE_STATE:` lines
2. Parses JSON state (units, contacts, events)
3. Sends to Electron renderer via IPC (`onArmaUpdate`)
4. `useSpectreStore.js` processes the update:
   - Merges unit data into `state.units` map
   - Merges contact data into `state.contacts` map (with deduplication, state tracking)
   - Deduplicates events using `processedEventIds` set
   - Updates `forceMetrics` (firepower index, mobility)
   - Triggers AI adaptation for significant events
5. UI renders tactical map, comms log, COA panels

### Order Execution

When the AI generates an order:
1. `aiService.js` calls OpenRouter (or local model) with battlefield context
2. Response parsed as JSON with `extractJSON()` (handles XML tags, markdown blocks, raw JSON)
3. Order dispatched via `window.spectreAPI.sendCommand()` → DLL `callExtension`
4. `SPECTRE_fnc_execCmd` in SQF receives the command
5. For movement orders: creates waypoints and issues `doMove` commands
6. Unit's `SPECTRE_currentOrder` variable updated (visible in next state broadcast)

---

## Part 4: AI Service (Live Mission)

**File:** `src/ai/aiService.js`

The LLM service handles all real-time AI interactions during a mission.

**Key rotation:** Multiple OpenRouter API keys, rotates on 429/rate-limit, exponential backoff.

**Sliding context window:** Keeps last 8 messages, compresses older ones into a session summary.

**Capabilities:**

| Function | When | Input | Output |
|----------|------|-------|--------|
| `chat()` | Planning phase | Commander message + context | Free-form response |
| `generateOPORD()` | After planning | Objective, constraints, conversation | Operations order JSON |
| `generateCOAs()` | After OPORD | Situation, OPORD, context | 3 courses of action |
| `modifyCOA()` | Commander request | Original COA, modification | Updated COA |
| `adaptPlan()` | Mid-mission event | Event, current COA, context | Severity + recommended action |
| `generateAAR()` | Mission end | Mission data, comms log | After-action review |
| `generateRadioMessage()` | Ad-hoc | From, to, situation | Radio message text |

**Context building:**
- Without vault: Builds text from units, contacts, intel, patterns
- With vault: Reads Obsidian-style vault nodes, builds graph with relationships, phases, objectives

**Event-driven adaptation:**
```
Arma event → processArmaUpdate → handleArmaEvents → aiService.adaptPlan()
  ├── MINOR (auto_handle: true) → Execute modified orders immediately
  └── MAJOR/CRITICAL (auto_handle: false) → Show pending adaptation to commander
```

---

## Part 5: Training Data Pipeline

**Directory:** `scripts/pipeline/`

A 7-stage pipeline that generates synthetic training data for fine-tuning Gemma E4B.

```
┌─────────┐    ┌─────────┐    ┌──────────┐    ┌───────┐    ┌──────────┐    ┌──────────┐    ┌────────┐
│ Sampler │───▶│ Teacher │───▶│Geo Filter│───▶│ Judge │───▶│ Resolver │───▶│  Export  │───▶│ JSONL  │
│         │    │ (LLM)  │    │(spatial) │    │(Gemini│    │          │    │          │    │for     │
│ 10 rand │    │Opus 4.8│    │          │    │ Pro)  │    │          │    │          │    │Unsloth │
└─────────┘    └─────────┘    └──────────┘    └───────┘    └──────────┘    └──────────┘    └────────┘
```

### Database Schema

**File:** `scripts/pipeline/db.py`

Single SQLite table `examples` with one row per training example:

| Column | Stage | Content |
|--------|-------|---------|
| `scenario_params` | 1 | Map, start/end, objective, threat level, unit counts |
| `state_json` | 1 | Full scenario: friendly units, contacts, mission |
| `terrain_digest_json` | 2 | OAKOC analysis of the corridor |
| `teacher_model` | 2 | Model name used (e.g., "claude-opus-4-8") |
| `teacher_output_json` | 2 | Orders with reasoning for each unit |
| `teacher_raw_response` | 2 | Raw LLM response text |
| `planner_output_json` | 3 | A* route waypoints |
| `geo_filter_result` | 4 | Spatial contradiction flags |
| `geo_filter_status` | 4 | "passed" or "failed" |
| `judge_a_verdict` | 5 | Judge verdict (tactical coherence + reasoning quality) |
| `judge_b_verdict` | 5 | (Currently same as judge_a — single judge mode) |
| `final_status` | 6 | "accepted" or "rejected" |

**Status flow:**
```
sampled → teacher_done → geo_passed/geo_failed → judged → accepted/rejected
```

### Stage 1: Sampler

**File:** `scripts/pipeline/sampler.py`

Generates random but realistic battlefield scenarios.

**Unit compositions** (15 canonical patterns):
| Category | Composition |
|----------|-------------|
| Light recon | light + infantry |
| Patrol | mrap + infantry |
| Mechanized | mbt + ifv + infantry |
| Heavy assault | mbt + ifv + apc + infantry ×2 |
| Combined arms | mbt + ifv + apc + mrap + light + infantry |
| Support | spg + ifv + mrap + infantry ×2 |
| Aviation | helicopter + infantry ×2 |

**Enemy compositions** (11 patterns):
| Threat Level | Example |
|-------------|---------|
| Low | 2× infantry |
| Medium | 1× ifv + 2× infantry |
| Heavy | 1× mbt + 1× ifv |
| Mixed | 1× mbt + 2× ifv + 3× infantry |

**Threat level auto-adjusted:**
- MBT present → high
- ≥5 enemies → high
- ≥3 enemies → medium
- <3 enemies → low

**Engagement radii by type:**
| Type | Radius (m) |
|------|-----------|
| mbt | 1200 |
| ifv | 800 |
| apc | 600 |
| mrap | 500 |
| light | 400 |
| truck | 300 |
| helicopter | 1500 |
| infantry | 300 |

### Stage 2: Teacher

**File:** `scripts/pipeline/teacher.py`

Calls a large LLM (currently Claude Opus 4.8 via AgentRouter Cloud Code) to generate tactical decisions for each scenario.

**Prompt structure:**
```
You are SPECTRE, a tactical AI advisor for Arma 3.
Given the current battlefield state and terrain digest, decide the best order for each friendly unit.

## Current State
{state_json}

## Terrain Digest (OAKOC Analysis)
{terrain_digest_json}

## Task
For each friendly unit, output:
1. intent: [attack, defend, move, hold, recon, evacuate, support]
2. target: [x, y] coordinates
3. anchors: 2-5 intermediate waypoints
4. constraints: avoid zones, surface preferences
5. reasoning: structured tactical analysis
```

**Reasoning format (the distillation signal):**
```json
{
  "situation_assessment": "What you observe about terrain, threats, positions. Reference grid coordinates and threat types.",
  "tactical_choice": "What you decided and the immediate logic.",
  "tradeoffs": "Alternatives considered and why this was selected.",
  "what_if_rejected": "Why rejected alternatives would have failed."
}
```

**Output schema:**
```json
{
  "orders": [
    {
      "unit_id": "friendly_0",
      "intent": "attack",
      "target": [5152, 3552],
      "anchors": [[3000, 1500], [4500, 2800]],
      "constraints": {
        "avoid_zones": [{"pos": [4000, 2000], "radius": 300}],
        "prefer_surface": "road"
      },
      "reasoning": { ... }
    }
  ]
}
```

### Stage 3: Geometric Filter

**File:** `scripts/pipeline/geo_filter.py`

Deterministic spatial validation — cheap, runs before judge calls. Catches contradictions:

| Check | What it catches |
|-------|----------------|
| `check_avoidance_claims` | Claims "staying outside engagement range" but target is inside threat radius |
| `check_route_through_threats` | Route waypoints pass through threat zone without acknowledging it |
| `check_cover_claims` | Claims "using forest cover" but waypoint is in open ground (low veg, no buildings) |

**Cover validation** uses the raw cost grid:
- Vegetation ≥ 3 at waypoint → cover claim valid
- Buildings ≥ 1 at waypoint → hard cover valid
- Below thresholds → flagged as contradiction

### Stage 4: Judge (Gemini 2.5 Pro)

**File:** `scripts/pipeline/judge.py`

Evaluates batches of 10 examples per API call.

**Evaluation criteria:**
| Aspect | Scoring |
|--------|---------|
| Tactical coherence | Does the order logically follow from the situation? (1-10) |
| Reasoning quality | Is the reasoning sound and internally consistent? (1-10) |

**Verdict rules:**
- Both aspects score ≥ 6 → accept
- Either scores < 6 → reject
- Does NOT evaluate spatial accuracy (handled by geo filter)

**Current status:** Gemini 2.5 Pro free tier quota exhausted. Judge model TBD.

### Stage 5: Resolver

**File:** `scripts/pipeline/resolver.py`

Simple resolution logic:
- Geo filter failed → rejected
- Judge verdict = "accept" → accepted
- Judge verdict = "reject" → rejected

### Stage 6: Export

**File:** `scripts/pipeline/export.py`

Produces JSONL files for Unsloth fine-tuning.

**Two export formats:**

1. **Standard** (`training_set.jsonl`):
```json
{"prompt": "You are SPECTRE...\n## Current State\n{state}\n## Terrain Digest\n{terrain}", "completion": "{orders}"}
```

2. **With reasoning** (`training_set_with_reasoning.jsonl`):
```json
{"prompt": "...", "completion": "{orders with reasoning}"}
```

The reasoning format is the core distillation signal — it teaches the model HOW to think about tactical decisions, not just WHAT to decide.

### Running the Pipeline

```bash
# Initialize database
python -m scripts.pipeline.run init

# Run full pipeline
python -m scripts.pipeline.run run

# Run specific stages
python -m scripts.pipeline.run run --stages sample teacher geo_filter

# Check status
python -m scripts.pipeline.run status

# Override batch size
python -m scripts.pipeline.run run --count 20
```

---

## Part 6: Doctrine System

**File:** `doctrine.py`

Single source of truth for all tactical rules. Imported by both the training pipeline and the live app.

### Threat Classification

**`classify_threat(contacts)`** — Returns threat level string:
- capability-weighted scoring: mbt/helicopter=5, ifv=4, apc=3.75, mrap=3.2, light=2.5, infantry=1, truck=0.5
- Any MBT/IFV/helicopter present → "high"
- Total score ≥ 9 → "high"
- Total score 4-8 → "medium"
- Total score < 4 → "low"

### VULNERABLE_TO Matrix

Defines which friendly unit types are vulnerable to each enemy type:

| Enemy | Vulnerable Friendly Types |
|-------|--------------------------|
| mbt | (none — never outmatched by other ground contacts) |
| ifv | (none) |
| helicopter | (none) |
| apc | mbt |
| mrap | mbt, ifv, apc, spg |
| light | mbt, ifv, apc, mrap |
| truck | mbt, ifv, apc, mrap, spg, spaa |
| spg | mbt, ifv |
| spaa | mbt, ifv |
| infantry | (none — infantry is the threat to soft vehicles) |

### ENGAGE_GRID

Full friendly×enemy overmatch grid:
- `ENGAGE`: Friendly type overmatches enemy (safe to engage)
- `PEER`: Comparable capability (risky)
- `AVOID`: Friendly type at disadvantage (must disengage)

### Unit Compositions

7 canonical friendly compositions:
```python
COMPOSITIONS = {
    "Recon":       ["light", "infantry"],
    "Patrol":      ["mrap", "light", "infantry"],
    "Mechanized":  ["mbt", "ifv", "infantry"],
    "Heavy":       ["mbt", "ifv", "apc", "infantry", "infantry"],
    "Combined":    ["mbt", "ifv", "mrap", "light", "infantry"],
    "Support":     ["spg", "ifv", "mrap", "infantry"],
    "Aviation":    ["helicopter", "infantry", "infantry"],
}
```

### Engagement Radii

Per-type engagement ranges (meters):
```python
ENGAGEMENT_RADII = {
    "mbt": 1200, "ifv": 800, "apc": 600, "mrap": 500,
    "light": 400, "truck": 300, "infantry": 300, "helicopter": 1500
}
```

### Zone Rules

- `avoid_zones`: Hard no-entry areas (friendly units must not enter)
- `engage_zones`: Intentional entry with `target_contact` (entering to engage)
- Zone radius: min=150m, max=300m (`validate_zone_radius()`)

---

## Part 7: Validation

**File:** `validate.py`

Full v2 schema validator. Imports from `doctrine.py` only.

**Validates:**
- All `vulnerable_unit_types` match doctrine
- All `engage_zones` pair overmatching units (ENGAGE in ENGAGE_GRID)
- All `avoid_zones` shield correctly (AVOID in ENGAGE_GRID)
- Threat levels match classifier
- All 7 compositions present in balanced dataset
- Zone radii within 150-300m range
- Anchor waypoints coherent (reasonable spacing, on-land)

---

## Part 8: Fine-Tuning (Future)

### Target: Gemma E4B via Unsloth

**Method:** QLoRA (4-bit quantization + LoRA adapters)

**Input:** JSONL from `export.py` (prompt/completion pairs with reasoning)

**Serving:** llama.cpp as GGUF quantized model

**Workflow:**
1. Export accepted examples from pipeline DB → JSONL
2. Upload to Unsloth (free tier)
3. Fine-tune Gemma E4B with QLoRA
4. Export as GGUF
5. Serve via llama.cpp
6. aiService.js calls local model instead of OpenRouter

---

## File Reference

| File | Purpose |
|------|---------|
| `mod/addons/functions/export_cost_grid.sqf` | One-time terrain export (3-pass) |
| `mod/addons/functions/fn_bridgeInit.sqf` | Live bridge: state export + command execution |
| `scripts/rpt_to_cost_grid.py` | RPT parser → raw cost grid |
| `scripts/apply_cost_weights.py` | 12-unit-type cost weight applicator |
| `scripts/path_planner.py` | A* over weighted grid, 12 unit types |
| `scripts/oakoc_extractor.py` | Route corridor OAKOC feature extraction |
| `scripts/route_candidates.py` | Multi-strategy route candidate generator |
| `scripts/pipeline/config.py` | Pipeline config (API keys, models, paths) |
| `scripts/pipeline/db.py` | SQLite schema + CRUD operations |
| `scripts/pipeline/sampler.py` | Random scenario generation |
| `scripts/pipeline/teacher.py` | LLM teacher (OpenRouter API) |
| `scripts/pipeline/geo_filter.py` | Spatial contradiction detection |
| `scripts/pipeline/judge.py` | Gemini judge (tactical + reasoning) |
| `scripts/pipeline/resolver.py` | Verdict resolution |
| `scripts/pipeline/export.py` | JSONL export for Unsloth |
| `scripts/pipeline/run.py` | CLI orchestrator |
| `src/ai/aiService.js` | Live LLM service (planning, COA, adaptation) |
| `src/store/useSpectreStore.js` | React state management |
| `doctrine.py` | Consolidated tactical doctrine |
| `validate.py` | V2 schema validator |
| `public/maps/stratis_costgrid.npz` | Raw terrain grid |
| `public/maps/stratis_costgrid_weighted.npz` | Per-unit-type weighted grid |
