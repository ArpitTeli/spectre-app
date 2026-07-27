# Spector — Change Log
### Proposed changes discussed after the base specs (spector-lattice-gameplan.md, model-training-pipeline.md) were written. Not yet merged into those files — listed here for review first.

---

## Context: what prompted these changes
The first real end-to-end pipeline run (teacher generation → path planner → geo filter → dual judges → resolution) worked — confirming the architecture in both base specs is sound. That run also surfaced one design gap (avoid zones vs. engage zones weren't actually distinct) and two infrastructure bugs (judge failures were silently destroying good data). All three are below.

---

## 1. Changes for the model / training pipeline

### 1.1 New concept: avoid zones vs. engage zones
Previously, every radius around a `known_contacts` entry was treated as a single kind of zone — implicitly "stay outside this." That's wrong for roughly half of real orders: a unit *deliberately* closing on a threat to fight it also enters that threat's radius, and that's correct behavior, not a violation.

**Two zone types now needed, not one:**
- **`avoid_zone`** — hard no-entry. A minefield, a threat outside this squad's mission, anything to route around entirely.
- **`engage_zone`** — same kind of radius, but entry is intentional. What matters isn't "did the unit enter it," it's **"is the unit that entered it one this threat is actually dangerous to."**

**New field needed on `known_contacts`:** `vulnerable_unit_types` — which friendly unit types a given threat is genuinely dangerous to. A SAM site threatens helicopters, not infantry. An anti-tank site threatens tanks/IFVs, not infantry. Example:
```json
{"type": "SAM_site", "pos": [200, 360, 0], "engagement_radius": 150, "confidence": 0.9, "vulnerable_unit_types": ["helicopter"]}
```

**New check needed in both places orders get validated** (the live guardrail layer, main spec Section 4.3; and the training-data geo filter, training-pipeline spec Section 4.4):
> For any order entering an `engage_zone`, check the ordered unit's type against that contact's `vulnerable_unit_types`. Flag a mismatch — a helicopter solo-engaging a SAM site, a tank frontally engaging an anti-tank position — the same way the geo filter already flags a reasoning claim that contradicts the actual coordinates.

### 1.2 Teacher/strategic-tier output schema — now confirmed real, not hypothetical
The real test run validated the intent/anchors/constraints/reasoning format actually works end to end. Worth formalizing in the spec once 1.1 above is settled, since the `constraints` object needs the `avoid_zones`/`engage_zones` split baked in:
```json
{
  "unit_id": "friendly_1",
  "intent": "attack",
  "target": [3722, 6205],
  "anchors": [[5600, 5950], [5200, 5900], [4300, 6100]],
  "constraints": {
    "avoid_zones": [
      {"pos": [4224, 6537], "radius": 150}
    ],
    "engage_zones": [
      {"pos": [5530, 5908], "radius": 250, "target_contact": "enemy_1"}
    ],
    "prefer_surface": null
  },
  "reasoning": {
    "situation_assessment": "...",
    "tactical_choice": "...",
    "tradeoffs": "...",
    "what_if_rejected": "..."
  }
}
```
The four-part `reasoning` structure (situation assessment, tactical choice, tradeoffs, consequence of rejecting) is what let the judges in the real test run score an order 8-9/10 with substantive written justification rather than a rubber-stamp — richer than a single free-text `reasoning` string would have supported.

### 1.3 Bug fix — per-order tracking, not per-example
**Found in the real test run:** one order in a two-order example hit a judge API failure (empty/malformed response). The whole example — including the *other* order, which scored well on both judges (8-9/10) — was marked `rejected`. A parsing failure on one order should never discard a good sibling order.

**Fix:** the pipeline's data model needs a row per **order**, not per example:
```
id | example_id | scenario_params | state_json | terrain_digest_json | 
teacher_output_json | planner_output_json | unit_id |
geo_filter_result | judge_1_verdict | judge_2_verdict | 
judge_1_retry_count | judge_2_retry_count |
final_status (pending/accepted/rejected/flagged) | reviewed_by_human
```
`example_id` still groups orders from the same scenario for whole-example export; `final_status` lives per-order.

### 1.4 Bug fix — judge parse failure must retry, not auto-reject
**Found in the same test run:** "the judge's API call failed to return valid JSON" and "the judge reviewed this and rejected it" were being treated identically. They are not the same thing.

**Fix:** a judge response that fails to parse triggers a retry (with backoff, tracked via the new `judge_1_retry_count`/`judge_2_retry_count` columns above) before falling back to `flagged` for human review. Never an automatic `rejected` on a parse failure.

### 1.5 Updated geo filter (incorporates 1.1, 1.3, 1.4)
```python
import math

def validate_example(example):
    """Check each order's anchors/target against avoid_zones (hard no-entry)
    and engage_zones (entry expected, but unit type must be suited to the threat)."""
    flags = []
    for order in example["orders"]:
        points = order.get("anchors", []) + [order["target"]]
        unit_type = example_unit_type(example, order["unit_id"])  # look up from state

        for zone in order["constraints"].get("avoid_zones", []):
            for p in points:
                if math.dist(p[:2], zone["pos"][:2]) < zone["radius"]:
                    flags.append({
                        "unit_id": order["unit_id"],
                        "issue": "route enters a declared avoid_zone",
                        "zone": zone,
                    })

        for zone in order["constraints"].get("engage_zones", []):
            contact = find_contact(example, zone["target_contact"])
            if unit_type in contact.get("vulnerable_unit_types", []):
                flags.append({
                    "unit_id": order["unit_id"],
                    "issue": "unit type is listed as vulnerable to the threat it's ordered to engage",
                    "contact": contact["type"],
                    "unit_type": unit_type,
                })
    return flags
```
This replaces the earlier version of the filter, which only checked whether the *reasoning text* claimed avoidance against a single combined zone type — the same failure mode that (before this fix existed) would have wrongly flagged the real test run's `friendly_1` order, which was deliberately closing on an MRAP to engage it.

---

## 2. Changes for the app (Order Dispatch / order schema)
No changes identified yet from this discussion — the app's existing order set (move_to, attack, drop_smoke, hold_fire, open_fire, flank, retreat) and the multi-waypoint schema addition already covered in the base spec (Section 3, `waypoints` field) are unaffected by the avoid/engage zone work above. The zone distinction lives entirely in the Tasking Layer's reasoning and validation logic — the app doesn't need to know a zone is an "avoid" vs. "engage" type, it just executes whatever order and waypoints it receives.

---

## 3. Doctrine / design notes
- The avoid/engage distinction is closer to how real C2 reasoning actually works: not every enemy radius is something to route around — some are things you're specifically ordered to close on and fight. Encoding that as two separate fields rather than one, with a unit-suitability check on the "engage" side, is a more accurate model of the actual decision than a single "stay outside this radius" rule ever was.
- Both infrastructure bugs (1.3, 1.4) share a root cause worth remembering going forward: **treating "the check failed to run" as equivalent to "the check ran and failed" is a recurring risk in any pipeline with external API calls in the loop.** Worth auditing other stages (the geo filter itself, the export stage) for the same pattern before scaling up generation volume.

---

## Status
All of the above is proposed, not yet merged into `spector-lattice-gameplan.md` or `model-training-pipeline.md`. Say the word when you want any of it folded into the base specs, or keep iterating here first.
