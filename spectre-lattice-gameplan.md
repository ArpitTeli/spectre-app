# SPECTRE — Full Build Spec
### A Lattice-OS-inspired asset tracking & tasking system, demoed live inside Arma 3

No deadline pressure, so this is scoped to be built *properly* — modular, so each layer works standalone before the next is added, rather than one big system that only works all-at-once-or-not-at-all.

**Status:** Tracking (2D/3D map, friendly/enemy detection) and manual Order Dispatch (move_to, drop_smoke, attack, hold_fire, open_fire) are already built as a working desktop app. This spec now focuses primarily on the piece being added on top: the AI Tasking Layer.

---

## 1. What this actually is

Anduril's Lattice does two things at core, across many asset types: **build a shared real-time picture of everything on the field (tracking)**, and **decide what each asset should do and issue that as orders (tasking)**. Everything else — UI, multi-domain sensor fusion, comms mesh — is scale and polish on top of that loop.

SPECTRE reproduces that loop, scoped to one simulation environment (Arma 3) and infantry/vehicle units, with room to expand later. The loop, end to end:

```
[Arma 3 units] -> state extracted every tick -> [Tracking Layer: common operating picture] (BUILT)
                                                        |
                                          [Tasking Layer: AI decides orders] (THIS SPEC)
                                                        |
                          orders sent back -> [Arma 3 units execute them] (BUILT) -> (loop repeats)
```

---

## 2. System architecture

### A. State Extraction (BUILT) - inside Arma 3, via SQF
Per-tick unit state (position, heading, health, ammo, known contacts) already extracted and feeding the desktop app's map.

### B. The Bridge (BUILT) - interop layer, outside Arma 3
Already working - state flows out of Arma 3 into the app, and orders flow back in and execute.

### C. Tracking Layer (BUILT) - the desktop app's 2D/3D map
Common operating picture of friendly and detected enemy units. This is the ground truth the Tasking Layer will read from.

### D. Tasking Layer (NEW - this is what's being added)
The AI system that reads tracked state and issues the same orders a human currently issues manually through the app (move_to, drop_smoke, attack, hold_fire, open_fire, etc.). Full design below in Section 4 - this is the core of this spec.

### E. Order Dispatch (BUILT) - Bridge -> Arma 3
Already executes orders in-game. The Tasking Layer will call the exact same order functions the manual UI currently calls - no new dispatch mechanism needed, the AI just becomes another order source alongside the human operator.

### F. Live Dashboard (BUILT) - this is the existing desktop app itself.

---

## 3. Data schemas

**State message** (Tracking Layer -> Tasking Layer), current picture per unit:
```json
{
  "unit_id": "alpha_1",
  "unit_type": "infantry",
  "timestamp": 1234567,
  "position": [120, 340, 0],
  "heading": 180,
  "health": 0.85,
  "ammo_pct": 0.6,
  "fuel_pct": 0.9,
  "current_order": "move_to",
  "squad_id": "alpha",
  "terrain": "urban",
  "known_contacts": [
    {"type": "SAM_site", "pos": [200, 360, 0], "engagement_radius": 150, "confidence": 0.9}
  ],
  "objective": "take_position",
  "objective_pos": [250, 380, 0]
}
```
`terrain` values: `urban | forest | open_ridge | river_crossing | desert`. This must be a structured field, not just flavor text inside a `reasoning` string — a model can only learn "given urban terrain, do X" if terrain was actually part of what it was conditioned on. Populate this field explicitly at scenario-generation time (Section 5.2), not narrated after the fact.

**Order message** (Tasking Layer -> Order Dispatch), one per unit per decision - matches the app's existing order set exactly:
```json
{
  "unit_id": "alpha_1",
  "action": "move_to",
  "target": [230, 370, 0],
  "reasoning": "short plain-English justification",
  "issued_at": 1234567
}
```
Valid `action` values: `move_to | hold | attack | drop_smoke | hold_fire | open_fire | flank | retreat`

Both schemas stay frozen once built - the Tasking Layer is designed to slot in as a drop-in AI order source using the app's existing action vocabulary, nothing new for the dispatch side to learn.

---

## 4. Tasking Layer - full architecture

### 4.1 Two-tier structure: intent vs. execution
A single call planning every unit at once doesn't scale and is a single point of failure. Instead:

- **Strategic tier (LLM, per squad, event-triggered):** one sub-agent per squad/group, not one global agent. Reasons over that squad's state plus relevant nearby threats and outputs intent - a target objective, a small number of waypoint anchors (not a dense route), and constraints ("avoid this radius," "prefer terrain masking," "hold until flank clears"). Runs only when triggered (see 4.2), not on a fixed clock.
- **Execution tier (classical path planner, continuous, non-AI):** takes the strategic tier's anchors and constraints and fills in the dense, terrain-aware waypoints (roughly 50m spacing) using A*/navmesh routing - the same kind of routing Arma's own `doMove` already does internally. Runs constantly, needs no AI, and is what actually produces fine-grained movement.

Why split this way: LLMs are unreliable at precise spatial/numeric output over terrain (dense waypoints generated directly by an LLM tend to look plausible but be subtly broken), and dense-waypoint generation doesn't need judgment - only the intent behind it does.

### 4.2 Event-triggered replanning with a significance threshold
Replanning on every minor event (every shot fired, every tick) causes units to thrash between plans mid-execution. Instead:
- Batch events over a short window (debounce)
- Only trigger a full replan when something crosses a real threshold:
  - New enemy contact within engagement range
  - A squad crosses a defined casualty threshold (e.g. N casualties or below X% strength in a given period) - signals something is going wrong and may need reinforcement or a changed plan
  - An objective becomes unreachable given current constraints
- **Known limitation to revisit later:** casualty count is a lagging indicator - by the time it fires, the bad situation already happened. A future refinement is a leading signal (contact density, incoming fire rate) that reacts before losses stack up. Not required for v1.

### 4.3 Validation / guardrail layer (required before touching live units)
Sits between the Tasking Layer's proposed orders and actual dispatch. Deterministic, not AI-based - this is the single most portfolio-relevant piece of the whole system, worth calling out explicitly in any writeup ("AI proposes, deterministic layer validates before execution" is a real, defensible C2 design pattern):
- **Reachability check:** is the target position actually valid/traversable?
- **Deconfliction:** are two units being ordered into the same space or crossing paths dangerously?
- **Fratricide/ROE check:** does an `open_fire`/`attack` order risk hitting a friendly unit in the blast/fire radius?
- Any order failing validation is rejected and logged, not silently modified - silent correction hides bugs, rejection surfaces them.

### 4.4 Structured output, not freeform text
The model's output is constrained via function-calling / JSON schema directly against the order schema in Section 3 - never freeform natural language later parsed by hand. The app's existing order set is the tool schema. This removes an entire class of parsing failures and hallucinated actions outside the valid set.

### 4.5 Success metrics
A composite score, tracked per mission run, used to evaluate whether any change (prompt tweak, fine-tune, architecture change) actually improved decisions:
- Casualties taken (friendly)
- Casualties inflicted (enemy)
- Objective(s) held / time-to-objective
- Weighting between these three is a tuning decision to make once real runs exist - track all three raw numbers from day one so the weighting can be decided later from real data instead of guessed upfront.

---

## 5. Training pipeline - how the model actually learns tactics

### 5.1 Why distillation, not knowledge injection
An edge-deployable small model (3B-8B range) doesn't have frontier-level reasoning, and trying to "teach" it general tactical knowledge (ridge exposure, flanking, urban vs. forest combat) via fine-tuning would be redundant anyway - that knowledge is already present in any strong model's training data. The actual gap is applying general principles correctly to SPECTRE's specific state format, unit types, and constraints - and that's learned from examples, not from re-reading manuals.

The approach: use a frontier model offline, in bulk, ahead of time to generate a large set of (situation -> good decision + reasoning) examples, then fine-tune the small edge model on that set. This is standard knowledge distillation - the small model doesn't need frontier-level judgment baked in, because it's trained on decisions a frontier model already made.

### 5.2 Synthetic data generation - the actual process

**Step 1 - sample scenario diversity programmatically.** Never prompt a model with "generate 5000 scenarios" - that produces low-diversity, near-identical output. Define a parameter space and sample combinations in code:

```python
terrains   = ["urban", "forest", "open_ridge", "river_crossing"]
enemy_comp = ["infantry_only", "armor_support", "SAM_present", "ambush_entrenched"]
own_force  = ["single_squad", "squad_plus_helo", "mixed_armor_infantry"]
objective  = ["take_position", "hold_position", "extract_casualty", "escort"]
# sample thousands of combinations, each becomes one concrete scenario
```

**Step 2 - turn each sampled combination into a full state JSON** using the schema from Section 3, with concrete positions, unit stats, and known contacts filled in.

**Step 3 - one API call per scenario.** Example request/response pair:

Prompt (system + this scenario's state):
```
You are a tactical advisor. Given the current battlefield state,
decide the best order for each unit. Output valid JSON matching
the order schema. Include a "reasoning" field explaining why.

State:
{
  "units": [
    {"unit_id": "alpha_1", "type": "infantry", "position": [120,340], "health": 1.0, "ammo_pct": 0.9},
    {"unit_id": "heli_1", "type": "helicopter", "position": [80,300], "health": 1.0, "fuel_pct": 0.7}
  ],
  "known_contacts": [
    {"type": "SAM_site", "pos": [200,360], "engagement_radius": 150, "confidence": 0.9}
  ],
  "objective": "take_position",
  "objective_pos": [250,380]
}
```

Model output:
```json
{
  "orders": [
    {
      "unit_id": "heli_1",
      "action": "move_to",
      "target": [180, 250],
      "reasoning": "Route stays outside the SAM's 150m engagement radius by approaching from the northwest at low altitude, using the ridge at (180,250) for terrain masking before continuing to the objective."
    },
    {
      "unit_id": "alpha_1",
      "action": "move_to",
      "target": [230, 370],
      "reasoning": "Advances on foot toward the objective from the south, out of the SAM's engagement arc since it targets air assets primarily; ground approach is the lower-risk path here."
    }
  ]
}
```

The `reasoning` field is what actually transfers judgment (patterns like "stay outside engagement radius," "use terrain masking," "this threat targets air not ground") rather than just memorized coordinate answers - train on it, don't discard it.

**Step 4 - submit as a batch job**, not one-by-one interactively. Loop through all sampled scenarios, submit via a Batch API (async, roughly 50% cheaper, designed for exactly this kind of bulk offline job), and collect results overnight.

**Step 5 - automated geometric validation, before spot-checking.** LLM-generated reasoning will sound tactically fluent while being spatially wrong — e.g. an order claims a helicopter is now "outside the SAM's engagement radius" while its actual target coordinates are still well within it. This isn't rare; expect it in roughly 10-15% of raw output based on early samples. Catch it programmatically, not by eye:

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

Run this over every generated example before it goes anywhere near the fine-tuning set. Anything flagged gets dropped or regenerated — never manually "fixed" by rewriting the reasoning to match the coordinates, since that risks quietly injecting your own tactical judgment into what's supposed to be the model's. This is the same validation-layer logic from Section 4.3 (reject bad orders, don't silently correct them), applied here to training data instead of live orders.

**Step 6 - spot-check what survives filtering.** Manually review a random sample (roughly 100 of whatever passes Step 5) before committing to fine-tuning on the full set. The geometric filter catches spatial contradictions; it won't catch every kind of bad reasoning (a plan that's spatially consistent but tactically dumb, for instance), so human review still matters on top of it.

**Cost and model choice:** use the API, not chat - chat has message-count limits because it's a flat-rate subscription; the API bills per token with no such cap, and this is a one-time offline job, not live usage.
- Use a cheaper/faster tier for the bulk of scenario generation - sufficient for most "average combat situation" examples
- Reserve a stronger tier for a smaller subset of harder edge cases (SAM-avoidance judgment calls, ambiguous urban engagements) where reasoning quality matters more
- Combining batch discount with a right-sized model tier means generating thousands of examples costs on the order of single-digit-to-low-double-digit dollars, not a meaningful budget item
- Start with a few hundred high-quality examples, fine-tune, evaluate where the small model is still weak, then generate more targeted data for those specific gaps rather than generating everything upfront blind

### 5.3 Combine with real sim logs
The synthetic dataset gives breadth (wide scenario coverage); real logged (state -> decision -> actual outcome) traces from your own Arma runs give grounding in what actually happens in your specific sim (physics quirks, actual pathing behavior, actual detection ranges). Fine-tune on both together.

### 5.4 Fine-tuning and serving
- **Technique:** LoRA fine-tune (not full fine-tune - unnecessary cost/complexity at this scale) of an open, edge-deployable base model. Practical starting candidates: a small model in the 8B class or a mobile/edge-oriented "mini" model - both run quantized on a consumer GPU, both support function calling (needed for the structured order schema), both LoRA-fine-tunable without exotic hardware. Confirm current best-in-class options at build time since this shifts fast.
- **Quantization:** 4-bit GGUF for deployment.
- **Serving:** llama.cpp locally. One shared model instance handling all squad sub-agents via separate calls with different context - not N separate loaded models per squad. Because replanning is event-triggered rather than continuous, load is bursty (most squads idle between events), not sustained concurrent inference across every squad at once.

### 5.5 RAG grounding on doctrine
Retrieve relevant doctrine snippets (cover/concealment, urban ops, flanking principles - public field manuals) into context at decision time rather than relying on the small model to recall them from training. This reduces how much tactical knowledge the model needs to carry in its own weights - it just needs to apply what's handed to it.

---

## 6. Build order (phases)

### Phase 0 - Foundations (2-4 weeks)
Python/PyTorch basics, core ML/RL concepts, a toy Gymnasium environment. Still required even though most code will be written for you - you need to be able to read and reason about what's running, especially for a defense-adjacent portfolio piece you may need to explain.

### Phase 1 - Dummy Tasking Layer (1-2 weeks)
Before any AI: hardcoded logic ("always move_to objective") calling the app's existing order functions, proving the Tasking Layer can issue orders the app executes correctly. Debugging the wiring is much easier before an AI (and its occasional wrong answers) is in the loop.

**Exit condition:** an external process issues an order and a unit visibly executes it in the running app - no human clicking.

### Phase 2 - Prompted frontier model, no training yet (1-2 weeks)
Before building any training pipeline: wire a frontier model (via API, function-calling against the order schema) directly into the Tasking Layer and see how good its decisions already are, single-squad, single-scenario. This baseline tells you how much the fine-tuning step in Phase 4 actually needs to fix, and gives you a working (if not-yet-edge-deployable) end-to-end demo early.

**Exit condition:** a frontier model is issuing sensible orders to a live squad through the full loop.

### Phase 3 - Validation/guardrail layer (1-2 weeks)
Build Section 4.3 before scaling up - reachability, deconfliction, fratricide checks between the Tasking Layer's output and Order Dispatch. Required before trusting any AI-issued order at scale, including the frontier-model version from Phase 2.

### Phase 4 - Synthetic data generation + distillation fine-tune (3-5 weeks)
Full Section 5 pipeline: scenario sampling, batch generation, spot-check, combine with real logs, LoRA fine-tune the chosen small edge model, quantize, swap in as the Tasking Layer's model in place of the frontier API call from Phase 2.

**Exit condition:** the local quantized model is issuing comparable-quality orders to what the frontier model produced in Phase 2, running fully on your hardware with no API calls.

### Phase 5 - Hierarchical squad sub-agents + event-triggered replanning (2-3 weeks)
Move from single-squad to multiple squad sub-agents (Section 4.1), add the debounce/significance-threshold replanning logic (Section 4.2), add the execution-tier path planner so the LLM only outputs anchors, not dense routes.

### Phase 6 - Scale out (open-ended)
- More squads / more unit types (vehicles, air) tracked and tasked simultaneously
- RAG doctrine grounding (Section 5.5)
- Success-metric weighting tuned from real run data (Section 4.5)
- Leading-indicator replanning triggers, not just casualty thresholds (Section 4.2 known limitation)
- Demo/dashboard polish, narration layer explaining orders in plain English for the demo video

Don't start Phase 6 until Phase 4's local model is solid - scaling a weak core loop just produces a bigger weak loop.

---

## 7. What's out of scope
- Real hardware integration - stays entirely in Arma 3
- Production-grade networking beyond the existing Bridge
- Anything resembling Anduril's actual sensor fusion or classified capability - this is a simulation demo and shouldn't be described as equivalent in the portfolio writeup
- Chinese-origin models anywhere near this pipeline being reused later in the actual Straegis product - fine as a cheap synthetic-data-generation option for SPECTRE specifically if desired, not fine to bleed into anything defense-proper

---

## 8. Definition of done (portfolio version)
A recorded video: Arma 3 mission running live, the existing app's map showing tracked units, and visible in-game unit behavior clearly driven by the local fine-tuned Tasking Layer - including a case where the validation layer catches and rejects a bad proposed order, and a case where a casualty-threshold event triggers a visible replan. Plus a writeup covering the two-tier architecture, the distillation training approach, what was tried, what worked, and honest limitations.
