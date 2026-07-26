# Model Training Pipeline — Full Spec
### Terrain intelligence, model selection, and the synthetic data generation pipeline for SPECTRE's Tasking Layer

This is a companion to the main SPECTRE build spec — it covers everything needed to actually train the Tasking Layer's model in detail, developed after realizing several of these pieces are hard dependencies of each other, not independent nice-to-haves. Read alongside the main spec's Sections 3-5, which this expands and in some places corrects.

---

## 1. Why this document exists

Working through the training approach surfaced a chain of dependencies that weren't obvious up front:
- You can't generate honest training data without a path planner, because the planner's *output* is what training examples should contain — not the teacher model's raw guess at waypoints
- The path planner can't route realistically without a terrain cost grid
- The Tasking Layer's LLM (both live and during data generation) can't reason about terrain without a digestible summary of that grid — because handing it raw grid data would mean it needs "whole map intelligence" it shouldn't need
- That summary needs to update when new threats appear, but only partially, or every new contact would mean expensive full recomputation

So build order matters here more than it first appeared. This is captured in Section 6.

---

## 2. Terrain Intelligence System

### 2.1 Terrain Cost Grid (static layer, built once per map)

A cached grid built once per Arma map, from SQF-extracted per-cell data:
- `surfaceType` (water, road, forest, urban, open)
- Elevation
- Forest/vegetation density
- Building footprints

**Per-unit-type cost weighting** applied over this grid — the same terrain is not equally costly to every unit type:
- Tank: high cost through dense forest, low cost across open ground, near-impassable through water/steep grades
- Infantry: low cost through forest (concealment), high cost across open exposed ground (no cover), moderate cost through urban (cover but slower movement)
- Helicopter: mostly ignores ground cost, cares about elevation/obstruction for terrain masking instead

This grid is expensive to build (full-map geometry) but built exactly once per map and cached — never recomputed live. Both the Path Planner (2.2) and the Feature Extractor (2.3) read from this same cached grid; it's computed once and consumed twice, not duplicated logic.

**Build steps:**
1. Confirm exactly what Arma's SQF layer exposes per-cell — `surfaceType`, elevation, and forest detection at minimum. This needs verifying against your actual map/mod setup before the extractor can be written for real.
2. Write a one-time grid-builder script: walks the map at a fixed resolution, queries SQF per cell, outputs a cached grid file (format TBD — likely a simple 2D array serialized to disk, resolution chosen based on map size vs. useful granularity).
3. Apply the per-unit-type cost weighting as a function over the raw grid values, not baked into the grid itself — so adding a new unit type later means adding a new weighting function, not rebuilding the grid.

### 2.2 Path Planner (execution tier, continuous, non-AI)

Takes the strategic LLM's output — an objective and a small number of waypoint *anchors* plus constraints ("avoid this radius," "prefer tree line") — and produces the actual dense, terrain-aware route (~50m waypoint spacing) using A*/navmesh routing over the cost grid from 2.1, weighted for the specific unit type being routed.

This is deterministic, not AI-based, and runs continuously (not event-triggered like the strategic tier) — it's cheap per-call and there's no reason to gate it behind an event.

**Critical role in training data generation:** the teacher model, when generating synthetic examples, must NOT be asked to produce the dense waypoint list directly — that reproduces the exact failure mode already caught in the DeepSeek sample check (LLMs are unreliable at precise spatial output; a hand-placed waypoint list "avoiding a forest" will look plausible and be subtly wrong). Instead:
- Teacher model outputs: intent, anchor points, constraints (same as the live system)
- The **same path planner** that will run at inference time consumes those anchors and produces the actual route
- The `orders` field written into each training example is the **planner's output**, not the teacher's raw suggestion

This keeps training and inference perfectly consistent: the fine-tuned model learns to produce anchors, because anchors are all it will ever need to produce at inference time.

### 2.3 OAKOC Feature Extractor (deterministic, non-AI, windowed)

The LLM (strategic tier and teacher model alike) does not need "whole map intelligence." It needs a small, pre-digested summary of locally relevant tactical features — the same way a human commander works from a staff officer's terrain analysis rather than raw elevation data. Modeled on the military OAKOC framework (Observation & fields of fire, Avenues of approach, Key terrain, Obstacles, Cover & concealment).

**Windowing:** the extractor only queries the cached grid within a radius relevant to the current squad position, objective, and known threats — not the whole map. This keeps output size roughly constant regardless of total map size.

**The five categories and how each is computed — all mechanical/geometric, none requiring tactical expertise to author:**

- **`key_terrain`** — points with unusually high visibility over the surrounding area. Computed by casting rays outward from candidate high-elevation points (reusing the line-of-sight mechanism from `exposed_zones` below) and counting visible area. High visible-area count → flagged as key terrain. Static — doesn't depend on enemy position, a dominant hill is dominant regardless of who's in the valley.
- **`avenues_of_approach`** — not separately authored logic; this is literally the Path Planner (2.2) run between two points under a given unit-type's cost profile, packaged with a name and a `suitable_for` unit-type tag. Effectively free once the planner exists.
- **`obstacles`** — surface types already flagged impassable/heavily restricted in the cost grid (water, cliffs, single fordable crossing points) — read directly, no new computation. Static.
- **`cover_concealment`** — read directly from the same per-cell cost grid values already computed for the planner (forest density → concealment, buildings → cover), reported as named zones instead of raw numbers. Static, and literally reuses the planner's own cost data rather than duplicating it.
- **`exposed_zones`** — the one dynamic category. Line-of-sight check (`lineIntersects` in Arma) from a candidate area to each currently known threat's position. Depends on `known_contacts`, so this is the only category that changes when new intel arrives.

**Output** — small JSON digest, example:
```json
{
  "key_terrain": [
    {"name": "ridge_north", "pos": [180, 400], "note": "dominates approach, high exposure if crossed"}
  ],
  "avenues_of_approach": [
    {"name": "treeline_corridor", "path_hint": [[120,340],[150,360],[180,380]], "cover": "high", "suitable_for": ["infantry"]},
    {"name": "open_flat_east", "path_hint": [[120,340],[200,340]], "cover": "none", "suitable_for": ["tank","ifv"]}
  ],
  "obstacles": [
    {"name": "river_crossing", "pos": [160, 350], "note": "single fordable point, bottleneck"}
  ],
  "exposed_zones": [
    {"name": "ridge_north_exposure", "visible_to_contacts": ["SAM_site_1"], "note": "line of sight confirmed via lineIntersects check"}
  ]
}
```
This digest sits in the LLM's context alongside the state JSON (Section 3 of the main spec) and doctrine RAG snippets. The LLM reasons over **named features and relationships** ("use treeline_corridor, it avoids ridge_north_exposure") — never raw coordinate-vs-grid-cell geometry. This is the reasoning style LLMs are actually reliable at (selecting from a list of named options), not the geometry-heavy style that produced the DeepSeek error.

**Same digest feeds both the live Tasking Layer and the training-data teacher model** — this consistency matters as much as the planner consistency in 2.2: if the live system and the training generator see terrain differently, the fine-tuned model learns patterns that don't transfer to deployment.

### 2.4 Static vs. dynamic updates — why new intel doesn't mean a full rebuild

Splitting the five OAKOC categories by whether they depend on enemy position (rather than by category name) is what keeps this cheap under real-time updates:

**Static — computed once per map, never recomputed:**
- Terrain cost grid itself
- `key_terrain`
- `obstacles`
- `cover_concealment`

None of these depend on where the enemy is. A river crossing is a bottleneck and a hill is dominant regardless of current contacts.

**Dynamic — recomputed incrementally, only on trigger:**
- `exposed_zones` only. When a new contact is discovered:
  1. Run `lineIntersects` from the new contact's position against the *already-cached* static feature locations (key terrain points, avenue segments) near it — not the whole map, just what's near the new threat
  2. Only `exposed_zones` updates; the other four categories are untouched
  3. This is a handful of geometry checks against an already-windowed set of features — milliseconds, not a rebuild

**This plugs directly into the existing event-triggered replanning system (main spec, Section 4.2)** rather than being new machinery: "new enemy contact within engagement range" is already a replan trigger; this defines what that trigger actually does to the terrain digest specifically — incrementally patch `exposed_zones`, leave the rest cached.

### 2.5 Multi-waypoint order schema

The existing `move_to` order (main spec, Section 3) only carries a single target coordinate — a real gap, since the Path Planner (2.2) produces a full route, not one point, and Arma's own pathfinding has no knowledge of tactical threats (it avoids physical obstacles like hills/buildings, but has no concept of a "SAM engagement radius" — that only exists in the Tracking Layer, so threat-avoidance must be enforced via intermediate points).

**Schema extension (backward-compatible):**
```json
{
  "unit_id": "alpha_1",
  "action": "move_to",
  "target": [230, 370, 0],
  "waypoints": [[180,350,0], [210,360,0], [230,370,0]],
  "reasoning": "...",
  "issued_at": 1234567
}
```
`target` remains the final destination and stays valid on its own (the manual UI's single-click orders never populate `waypoints` and behave exactly as they do today). When `waypoints` is present, the SQF side of Order Dispatch pushes them onto the unit's **native Arma waypoint queue** (`addWaypoint`) instead of issuing a single `doMove` — Arma's engine already handles arrival detection and advancing between points natively, so this reuses existing engine capability rather than reimplementing waypoint-sequencing logic in the Bridge/Tasking Layer.

---

## 3. Model selection for the Tasking Layer

### 3.1 Recommended: Gemma 4 E4B
- ~4.5B effective parameters, edge-optimized, Apache 2.0 license (fully open, no usage restrictions)
- Native function-calling / agentic tool use — matters directly here since the Tasking Layer's output must be structured JSON against the order schema, not freeform text
- LoRA/QLoRA fine-tunable on a single consumer GPU
- 128K context — enough headroom for state JSON + terrain digest + doctrine RAG snippets + reasoning output in one call
- US-origin (Google), Apache 2.0 — avoids the provenance/liability concerns raised earlier about Chinese-origin models, relevant given this technology is the intended precursor to the real SPECTRE edge layers eventually

### 3.2 Alternative (better ceiling, more VRAM): Gemma 4 26B MoE (A4B)
- Only 3.8B parameters activated per token — inference speed/cost behaves like a ~4B model
- **Important caveat:** MoE saves compute, not memory — all 26B parameters' worth of experts must still be loaded in VRAM even though only a subset routes per token. Needs meaningfully more VRAM than E4B to hold the weights (roughly a 24GB-class consumer GPU) even though it runs about as fast.
- Worth it if hardware allows: noticeably closer to frontier-level judgment than E4B while still fully local/offline. Choose based on available VRAM, not by default.

### 3.3 On comparing model "reasoning capability" to human IQ
No trustworthy IQ-equivalent number exists for LLMs. The closest legitimate attempt (ARC-AGI, designed by François Chollet specifically as a memorization-resistant fluid-intelligence test) shows the picture is not a single score: static pattern-based reasoning (ARC-AGI-1) is now considered solved by frontier models at human level, while interactive/adaptive reasoning (ARC-AGI-3 — explore an unfamiliar environment, learn the goal on the fly) shows frontier models still scoring under 1% against human baselines near 100%. Models and humans are good at different kinds of reasoning, not comparable on one axis.

**Practical implication:** there's no IQ-style number to shop for when picking a teacher or edge model. Use domain-relevant benchmarks (agentic tool-use, math/reasoning scores) as a directional signal, and rely on empirical scenario testing — generating sample outputs and checking them the way the DeepSeek sample was checked — as the real signal for whether a given model's tactical judgment is good enough.

---

## 4. Synthetic Training Data Generation Pipeline

### 4.1 Hard dependency: the terrain system must exist before data generation starts
Because training examples' `orders` field must be the Path Planner's output (2.2), not the teacher model's raw guess, and the teacher's prompt must include the Feature Extractor's digest (2.3) to match what the live system will see — **the terrain cost grid, path planner, and feature extractor are prerequisites for Phase 4 (data generation) in the main spec, not later additions.** This reorders the phase plan; see Section 6.

### 4.2 Pipeline stages
Each generated example moves through a sequence of stages with tracked state, so a failed API call or a later pipeline change (like adding the dual-judge step) means resuming, not restarting from scratch:

```
1. SAMPLE     -> scenario parameters generated (terrain window, enemy_comp, force, objective)
2. GENERATE   -> sent to teacher model; raw (intent, anchors, constraints) received
3. PLAN       -> Path Planner (2.2) converts anchors -> dense route; this becomes the example's actual "orders"
4. GEO_FILTER -> deterministic script checks spatial claims in the teacher's reasoning against the real geometry
5. JUDGE      -> survivors sent to 2 independent judge models (different providers)
6. RESOLVE    -> both judges agree -> accept / disagree -> flag / geo-filter failed -> reject
7. REVIEW     -> human spot-checks the accepted sample plus everything flagged
8. EXPORT     -> final approved set written as fine-tuning-ready JSONL
```
Note the addition of stage 3 (PLAN) relative to earlier drafts of this pipeline — this is where "teacher output" and "training example" diverge: the teacher only ever produces intent/anchors, the planner produces what's actually recorded as the example's orders.

### 4.3 Data model (SQLite)
One row per example, single table as the pipeline's entire state:
```
id | scenario_params | state_json | terrain_digest_json | 
teacher_output_json | planner_output_json |
geo_filter_result | judge_1_verdict | judge_2_verdict | 
final_status (pending/accepted/rejected/flagged) | reviewed_by_human
```
Every stage reads rows in a given status, does its work, writes results, advances the status. A crash mid-run means re-running the pipeline, not losing progress — it picks up wherever each row left off.

### 4.4 Geometric filter (Stage 4)
Catches spatial claims in the teacher's reasoning that contradict the actual geometry — this is the exact failure mode found in the DeepSeek sample (reasoning claims "outside the SAM radius" while target coordinates say otherwise). Runs before the judge stage since it's cheap/deterministic and should filter obvious errors before spending judge-model calls on them.

```python
import math

def validate_example(example):
    """Flag orders whose stated target contradicts the known_contacts geometry."""
    flags = []
    contacts = example["state"]["known_contacts"]
    for order in example["orders"]:
        target = order["target"]
        for contact in contacts:
            dist = math.dist(target[:2], contact["pos"][:2])
            claims_avoidance = any(
                phrase in order["reasoning"].lower()
                for phrase in ["outside", "avoid", "stay clear", "out of range", "beyond"]
            )
            if claims_avoidance and dist < contact["engagement_radius"]:
                flags.append({
                    "unit_id": order["unit_id"],
                    "contact_type": contact["type"],
                    "distance": round(dist, 1),
                    "engagement_radius": contact["engagement_radius"],
                    "issue": "reasoning claims avoidance but target is inside the threat radius"
                })
    return flags
```
Anything flagged is dropped or regenerated — never manually rewritten to match, since that risks quietly injecting personal tactical judgment into what's supposed to be the model's own training signal.

### 4.5 Dual-judge review (Stage 5)
**Why this is needed on top of the geometric filter, not instead of it:** the geometric filter only catches spatial/numeric contradictions. It cannot catch tactical/logical incoherence — an order that's spatially valid but doesn't actually fit the situation (e.g. `hold_fire` when ammo is fine and a hostile contact is at high confidence within range), or reasoning that contradicts the stated objective, or two units given conflicting orders.

**Why two *different* models, not two calls to the same model:** LLMs share correlated blind spots. The exact SAM-radius error already found is a general LLM weakness (models default to plausibility-checking spatial claims rather than computing them) — asking the same model to "proofread" its own class of mistake is a weak check, since a second call from the same architecture may share the blind spot. Two structurally different judge models (different providers) are more likely to independently agree on tactical soundness (a judgment call, which models are decent at) than to independently agree on a spatial claim's truth (which requires suppressed computation, which they're bad at by default) — which is exactly why the geometric filter (not the judges) is responsible for the spatial category, and the judges are responsible for the tactical-coherence category.

**Judge prompt scope:** narrow — "does this order logically follow from the reasoning and fit the stated objective? yes/no + why." Judges evaluate, they don't regenerate or rewrite.

**Judge model tier:** cheap-tier (same reasoning as generation) — judging is a narrower task than generating, no need for frontier-tier cost here.

### 4.6 Resolution logic (Stage 6)
- Both judges agree the order is sound -> `accepted`
- Judges disagree -> `flagged` for human review, NOT auto-rejected — disagreement often signals genuine tactical ambiguity (more than one reasonable answer exists), not necessarily an error
- Failed the geometric filter -> `rejected` outright, does not reach the judges

### 4.7 Human review (Stage 7)
Manually review a random sample of `accepted` rows (roughly 100 of a few thousand) plus every `flagged` row before committing to the export. The geometric filter and judges catch what they're each designed for; this is the final layer for anything neither catches (a plan that's spatially consistent and logically coherent but still tactically weak, for instance).

### 4.8 Tooling
- **Language/runtime:** Python — glue code, not performance-critical, every needed API has a clean SDK
- **Generation + judging:** Batch API for both the teacher generation pass and the two judge passes — same async/cost benefit applies to judging as to generation since both are bulk offline work
- **Storage:** SQLite — zero setup, handles thousands of rows trivially, queryable with plain SQL (e.g. "show me everything the judges disagreed on")
- **Review interface:** a script pulling `flagged`/sampled-`accepted` rows and prompting y/n is sufficient at this scale; a real UI is only worth building if manual review becomes an actual bottleneck
- **Export:** final stage queries `WHERE final_status='accepted'` and writes JSONL in whatever format the fine-tuning framework needs (decide the exact framework — e.g. Unsloth vs. Hugging Face `trl` — at the point of actually starting Phase 4, not before)

### 4.9 Cost estimate
Roughly triples per-example cost versus generation alone (1 generation call + 2 judge calls), but judge calls are cheap-tier and short (verdict + brief reasoning, not a full scenario). Rough estimate for a few thousand examples with judging included: on the order of tens of dollars, not a meaningful budget item.

### 4.10 Open decision — not yet resolved
Whether the SQLite pipeline database lives versioned inside the SPECTRE repo (so the dataset's evolution over time is visible in git) or is treated as a purely local, regenerable working artifact excluded from version control. This affects whether the pipeline is structured as a fully standalone script or something more integrated with the rest of the codebase — worth deciding before writing the actual pipeline code, not after.

---

## 5. Fine-tuning and serving — full workflow

### 5.1 Key decision: training and inference happen on different hardware
The edge/local requirement only applies to **inference** (the deployed Tasking Layer model must run on your hardware, offline). Training itself doesn't need to happen there — it can run for free on hosted infrastructure, with only the small resulting artifact brought back for local deployment. This removes VRAM as a real constraint on training.

**Practical implication:** train on a free Google Colab T4 (16GB VRAM) instance rather than requiring a beefy local GPU. VRAM estimates for E4B fine-tuning vary somewhat by source and quantization settings (roughly 10-17GB depending on config), but a T4's 16GB covers it either way. After training, only the LoRA adapter (typically 50-200MB, not the full model) needs to come back to local hardware, where it's merged into the quantized base model for serving.

### 5.2 Tool: Unsloth
The standard tool for this — delivers roughly 2x faster training and ~70% lower memory usage than vanilla Hugging Face fine-tuning via custom CUDA kernels, with native Gemma 4 support. Two modes:
- **Unsloth Studio** — no-code web UI, worth trying first given the "code written for you, not by you" preference established for this project
- **Unsloth Core** — the Python library, used below for the parts that need custom wiring to the pipeline's data format

### 5.3 Step 1 — prepare the dataset from the pipeline's export
The Section 4 pipeline's EXPORT stage (Stage 8) already produces the right raw material: every `accepted` row from the SQLite table, containing `state_json`, `terrain_digest_json`, and `planner_output_json` (the actual training target — recall from Section 4.2 that the *planner's* output is what gets trained on, not the teacher's raw anchor suggestion). This step turns those rows into the prompt/completion format Unsloth expects:

```python
import sqlite3
import json

def export_training_set(db_path, output_path):
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT state_json, terrain_digest_json, planner_output_json "
        "FROM examples WHERE final_status = 'accepted'"
    ).fetchall()

    with open(output_path, "w") as f:
        for state_json, terrain_json, orders_json in rows:
            prompt = (
                "You are a tactical advisor. Given the current battlefield "
                "state and terrain digest, decide the best order for each "
                "unit. Output valid JSON matching the order schema.\n\n"
                f"State:\n{state_json}\n\nTerrain digest:\n{terrain_json}"
            )
            completion = orders_json
            f.write(json.dumps({"prompt": prompt, "completion": completion}) + "\n")

    conn.close()
```

### 5.4 Step 2 — load the base model in 4-bit (QLoRA)
The base model's weights stay frozen and quantized; only small adapter matrices inserted into the attention layers get trained — this is what makes fine-tuning a 4.5B model tractable on a free-tier GPU:
```python
from unsloth import FastLanguageModel

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/gemma-4-e4b",
    max_seq_length = 4096,
    load_in_4bit = True,
)
```

### 5.5 Step 3 — attach the LoRA adapter
Rank 16 is a reasonable default for a dataset in the few-hundred-to-few-thousand-example range described in Section 4:
```python
model = FastLanguageModel.get_peft_model(
    model,
    r = 16,
    lora_alpha = 16,
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj"],
)
```

### 5.6 Step 4 — train
```python
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig

dataset = load_dataset("json", data_files="spectre_training_set.jsonl", split="train")

trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    args = SFTConfig(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4,
        num_train_epochs = 3,
        learning_rate = 2e-4,
    ),
)
trainer.train()
```
**Known quirk, not a bug:** Gemma's multimodal architecture commonly shows training loss around 13-15 instead of a small number — this is expected behavior for Gemma 4 E2B/E4B specifically (also seen on prior Gemma-3N and other vision-capable models), not a sign something is broken. Loss in the hundreds, on the other hand, usually indicates a gradient accumulation misconfiguration.

### 5.7 Step 5 — save and export for local serving
```python
model.save_pretrained("./spectre-tasking-adapter")   # 50-200MB adapter, not the full model
model.save_pretrained_gguf("./spectre-tasking-gguf", quantization_method = "q4_k_m")  # ready for llama.cpp
```
The exported GGUF file is what actually gets deployed per Section 5's original serving plan below (5.8) — one shared quantized model instance handling all squad sub-agents via separate calls with different context.

### 5.8 Serving (unchanged from earlier plan)
- 4-bit GGUF quantization, served locally via llama.cpp
- One shared model instance handling all squad sub-agents via separate calls with different context — not N separate loaded models
- RAG grounding on public doctrine documents supplements the model's context at decision time, reducing reliance on the model's own parametric memory for general tactical principles, leaving the terrain digest (Section 2.3) and state JSON to carry situation-specific detail

### 5.9 Combine with real sim logs
As in the main spec (Section 5.3): the synthetic/distilled dataset from Section 4 gives scenario breadth; real logged (state → decision → actual outcome) traces from actual Arma runs give grounding in what actually happens in the specific sim (physics quirks, actual pathing behavior, actual detection ranges). Both belong in the training set once real logs exist, not just the synthetic set alone.

### 5.10 Dataset size guidance
500-5,000 examples is the right range for task-specific adaptation like this (as opposed to 10,000-50,000, which is more appropriate for injecting broad domain knowledge — not the gap being closed here, per Section 3.1's distillation rationale). Quality and the filtering pipeline in Section 4 matter more than raw quantity.

### 5.11 Note for the 26B MoE alternative (Section 3.2), if used instead of E4B
Standard QLoRA (4-bit) is not recommended for the 26B-A4B MoE variant — the MoE routing and 4-bit quantization interact poorly. Use 16-bit LoRA (`load_in_16bit=True` instead of `load_in_4bit=True`) for that variant specifically, which is part of why it needs meaningfully more VRAM than E4B, consistent with Section 3.2's original caveat.

---

## 6. Updated phase dependency ordering

This corrects the main spec's Section 6 phase plan given everything above:

- **Terrain Cost Grid + Path Planner + Feature Extractor (Section 2) must be built before Phase 4 (synthetic data generation) starts** — previously implied to be Phase 5/6 scale-out work, actually a hard prerequisite, since Phase 4's training examples require the planner's output and the extractor's digest to be consistent with what the live system will use.
- Suggested insertion point: build Section 2's three components as their own phase, between the original Phase 3 (validation/guardrail layer) and Phase 4 (data generation) — call it **Phase 3.5 — Terrain Intelligence System.**
- Phase 4 then proceeds using the full pipeline in Section 4 of this document, superseding the simpler version described in the main spec.

---

## 7. Summary of what's still genuinely undecided
- SQLite pipeline DB versioning (Section 4.10)
- Exact fine-tuning framework (Unsloth / HF `trl` / other) — deferred to when Phase 4 actually starts
- Grid resolution for the terrain cost grid — depends on verifying what Arma's SQF layer actually exposes per-cell (Section 2.1, build step 1), not yet confirmed
- Final choice between Gemma 4 E4B and the 26B MoE variant — depends on actual available VRAM, not yet specified
