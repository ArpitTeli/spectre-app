# Threat Level Assessment

How SPECTRE rates the threat of any opposing force on Stratis, and how that
rating relates to *which* of your units a threat actually endangers.

There are **two distinct questions** here, and conflating them is the mistake the
original single-`avoid_zone` model made:

1. **How dangerous is this force overall?** → the `threat_level` label
   (`low` / `medium` / `high`). A property of the *enemy force as a whole*.
2. **Which of my units is this specific threat dangerous to?** → each contact's
   `vulnerable_unit_types`. A property of *one threat relative to one friendly
   platform*. A SAM is "high" to a helicopter and irrelevant to infantry; the
   overall label can't capture that, so we carry both.

---

## 1. Overall threat level (capability-weighted)

Threat level is driven by the **lethality of the platforms present, not the head
count**. Three light trucks are not more dangerous than one main battle tank, and
the old count-based rule (`low = 1-2, medium = 3-4, high = 5+`) got that exactly
backwards while also colliding with the "max 4 contacts" placement rule.

### Threat points per platform

| Platform | Points | Why |
|----------|:------:|-----|
| `mbt`        | 5    | 1200 m stabilized main gun — overmatch against everything |
| `ifv`        | 4    | 800 m autocannon + ATGM |
| `apc`        | 3.75 | 600 m crew-served / light cannon — nearly IFV-grade |
| `mrap`       | 3.2  | 500 m crew-served weapon |
| `light`      | 2.5  | 400 m light weapon |
| `infantry`   | 1    | 300 m dismounts |
| `truck`      | 0.5  | 300 m, soft transport — negligible on its own |
| `helicopter` | 5    | 1500 m — enemy air is always top-tier (future enum) |

Weights are fractional so that similar-but-not-identical platforms rank
distinctly (an APC at 3.75 is nearly IFV-grade; a bare truck at 0.5 barely
registers). The buckets below are defined as half-open ranges so no fractional
sum can fall in a gap.

### Classification algorithm

Evaluate in order:

1. **Any `mbt`, `ifv`, or (enemy) `helicopter` present → `high`.**
   Heavy armor, ATGM-capable, or air overmatch defines a high-threat fight
   regardless of how few contacts there are. A lone tank is a high threat.
2. Otherwise sum the threat points of all contacts:
   - **total ≥ 9 → `high`** (e.g. an APC + MRAP + light — a mechanized force even without a tank)
   - **4 ≤ total < 9 → `medium`**
   - **total < 4 → `low`**

This is monotonic (adding a threat never lowers the level), it makes an
IFV-heavy force read as genuinely dangerous, and the ranges are half-open so a
fractional sum like 3.5 is unambiguously `low`.

### Worked examples

| Contacts | Points | Level |
|----------|--------|:-----:|
| 1 × infantry | 1 | **low** |
| infantry + truck | 1.5 | **low** |
| 3 × infantry | 3 | **low** |
| light + infantry | 3.5 | **low** |
| 2 × light | 5.0 | **medium** |
| apc + infantry | 4.75 | **medium** |
| apc + mrap | 6.95 | **medium** |
| 2 × apc | 7.5 | **medium** |
| apc + mrap + light | 9.45 | **high** |
| 3 × apc | 11.25 | **high** |
| 1 × mbt | rule 1 (tank present) | **high** |
| mbt + ifv + apc + infantry | rule 1 | **high** |
| ifv + apc + mrap | rule 1 (ifv present) | **high** |

### Boundary notes

- A **single APC** (3.75) is `low`; a second (7.5) makes it `medium`; a third
  (11.25) reaches `high` on points alone. One APC with no support is a real but
  limited threat.
- The `light + infantry` case (3.5) is the tightest `low`: one more light vehicle
  (→ 6.0) or swapping the infantry for an APC (→ 6.25) tips it to `medium`.
- The classifier lives in `threat.py` (`classify(contacts)`); `validate.py`
  enforces that every example's stored `threat_level` matches it exactly.

---

## 2. Target-relative threat: `vulnerable_unit_types`

A threat's *overall* level says nothing about whether it endangers a **specific**
unit you might send at it. That is what `vulnerable_unit_types` encodes, per
contact:

```json
{"type": "mbt", "pos": [5000, 5350], "confidence": 0.82,
 "engagement_radius": 1200,
 "vulnerable_unit_types": ["apc", "mrap", "light", "truck", "spg", "spaa", "eng", "infantry"]}
```

Read it as: *"these friendly types are outmatched closing on this threat and must
not be ordered to solo-engage it."* It is the basis of the **engage-zone
suitability check** — an order that drives a listed unit into a threat's
`engage_zone` is a doctrine mismatch and gets flagged.

### The doctrine matrix (source of truth: `doctrine.py`)

| Enemy threat | Hard-counters (vulnerable_unit_types) |
|--------------|----------------------------------------|
| `mbt`      | apc, mrap, light, truck, spg, spaa, eng, infantry |
| `ifv`      | apc, mrap, light, truck, spg, spaa, eng, infantry |
| `apc`      | mrap, light, truck, spg, spaa, eng, infantry |
| `mrap`     | light, truck, spg, spaa, eng, infantry |
| `light`    | truck, spg, spaa, eng, infantry |
| `truck`    | *(none — unarmed transport)* |
| `infantry` | mrap, light, truck, spg, spaa, eng |

**Principles behind the matrix:**

- **Firepower/armor ladder** `mbt > ifv > apc > mrap > light > truck`: a threat
  outmatches every class below it.
- **Standoff overmatch is not a mismatch.** `mbt`, `ifv`, and `helicopter` never
  appear in the `mbt`/`ifv` rows — a tank fighting a tank, or an IFV/attack
  helicopter killing armor with ATGMs from standoff, is *correct* tasking. Only
  the units that would be outgunned are listed.
- **Infantry is asymmetric.** Dismounts are outmatched by every armed vehicle
  (so they appear in most rows), yet they themselves threaten soft-skinned
  vehicles (ambush AT / small arms) — hence the `infantry` row lists the soft
  platforms, but not armor and not opposing infantry (a peer fight, which is
  legitimate to order).
- **Thin-skinned support** (`spg`, `spaa`, `eng`, `truck`, `boat`) loses any
  direct-fire duel, so it appears wherever a direct-fire threat does. In practice
  `spg`/`spaa` fight from defilade or the rear and should carry `avoid_zones`, not
  `engage_zones`.

`mbt`, `ifv`, and `helicopter` are absent from every row because no current
conventional enemy hard-counters them frontally. When air-defense threats
(`SAM` / manpad) join the enemy enum, add their rows (SAM → `helicopter`, etc.).

---

## 3. Assessing an arbitrary opposing force — procedure

Given a list of enemy contacts:

1. **Level.** Run the two-step classifier in §1 → `low` / `medium` / `high`.
   Present it verbatim on the scenario (`scenario_params.threat_level` and
   `state_json.threat_level` must agree).
2. **Per-unit danger.** For each contact, stamp `vulnerable_unit_types` from the
   §2 matrix. This is deterministic — do not hand-guess it.
3. **Tasking sanity.** For every order that *engages* a threat (an `engage_zone`
   with a `target_contact`), confirm the ordered unit is **not** in that
   contact's `vulnerable_unit_types`. If it is, re-task: assign an overmatching
   platform (armor/ATGM/air) to that threat and have the outmatched unit route
   around it via an `avoid_zone` instead.
4. **Zones.** Threats a unit deliberately closes on → `engage_zones`
   (with `target_contact`). Every other threat it must route around → `avoid_zones`
   (hard no-entry). Recon, transport, and indirect-fire units typically carry only
   `avoid_zones`.

---

## 4. Future extensions (not yet in the enum)

- **Air-defense threats** (`SAM`, `manpad`, enemy `spaa`): add matrix rows making
  `helicopter` vulnerable; these are the cases where `vulnerable_unit_types`
  becomes most discriminating.
- **Force ratio.** The level in §1 is absolute. A fuller model would weight enemy
  power against the friendly force committed (2 infantry vs. a recon pair ≠ 2
  infantry vs. a heavy platoon). Deferred until the absolute scale is validated in
  training.
- **Coordinates.** This dataset uses 2-D `[x, y]`. The base spec's newer examples
  use 3-D `[x, y, z]`; if elevation enters, threat reach and masking terrain
  become 3-D and the ladder above is unaffected but line-of-sight checks change.
