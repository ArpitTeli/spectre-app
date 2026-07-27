# Fixed Doctrine Matrix

The single, frozen reference for every type-vs-type relationship SPECTRE uses on
Stratis: unit enums, engagement reach, threat weighting, the per-threat
`vulnerable_unit_types` lists, and the full friendly-vs-enemy engage/avoid grid.

This file is **generated from / mirrors [`doctrine.py`](doctrine.py) and
[`threat.py`](threat.py)** — those modules are the executable source of truth and
[`validate.py`](validate.py) enforces the dataset against them. If they change,
regenerate this. For the *why* behind the numbers, see
[`threat_level.md`](threat_level.md).

---

## 1. Unit type enums

**Friendly units** (may appear in `friendly_units[].type` and be ordered):
`mbt`, `ifv`, `apc`, `mrap`, `light`, `truck`, `spg`, `spaa`, `eng`,
`infantry`, `helicopter`

**Enemy contacts** (`known_contacts[].type`):
`mbt`, `ifv`, `apc`, `mrap`, `light`, `truck`, `infantry`
— **never `helicopter`**; air is friendly-only in this dataset.

---

## 2. Engagement radii (metres) — fixed per type

| Type | Radius | | Type | Radius |
|------|:------:|-|------|:------:|
| `mbt`        | 1200 | | `truck`      | 300 |
| `ifv`        | 800  | | `infantry`   | 300 |
| `apc`        | 600  | | `helicopter` | 1500 |
| `mrap`       | 500  | | | |
| `light`      | 400  | | | |

A contact's `engagement_radius` MUST equal the value for its type exactly.

---

## 3. Threat weighting & overall level

**Threat points per platform** (lethality × reach, not head count):

| Platform | Pts | | Platform | Pts |
|----------|:---:|-|----------|:---:|
| `mbt`        | 5 | | `mrap`     | 3.2 |
| `helicopter` | 5 | | `light`    | 2.5 |
| `ifv`        | 4 | | `truck`    | 0.5 |
| `apc`        | 3.75 | | `infantry` | 1 |

**Classification (`threat.classify`)** — evaluate in order:
1. Any `mbt`, `ifv`, or `helicopter` present → **high**.
2. Else sum points: **≥ 9 → high**, **≥ 4 and < 9 → medium**, **< 4 → low**
   (half-open ranges so fractional sums never fall in a gap).

Worked examples and boundary cases live in [`threat_level.md`](threat_level.md) §1.

---

## 4. `vulnerable_unit_types` — which friendly types each threat OUTMATCHES

Stamped onto every contact (by [`inject_vuln.py`](inject_vuln.py)). Read as:
"these friendly types are outmatched closing on this threat and must **not** be
ordered to solo-engage it."

| Enemy threat | `vulnerable_unit_types` (hard-counters) |
|--------------|------------------------------------------|
| `mbt`      | apc, mrap, light, truck, spg, spaa, eng, infantry |
| `ifv`      | apc, mrap, light, truck, spg, spaa, eng, infantry |
| `apc`      | mrap, light, truck, spg, spaa, eng, infantry |
| `mrap`     | light, truck, spg, spaa, eng, infantry |
| `light`    | truck, spg, spaa, eng, infantry |
| `truck`    | *(none — unarmed transport)* |
| `infantry` | mrap, light, truck, spg, spaa, eng |

`mbt`, `ifv`, and `helicopter` appear in **no** list — nothing in the current
conventional enemy enum hard-counters a tank, an IFV/ATGM platform, or air.

---

## 5. Full engage / avoid grid (friendly × enemy)

Derived from §4 via `doctrine.is_mismatch(friendly, enemy)`:

- **ENGAGE** — friendly overmatches the threat; a valid `engage_zone` target.
- **PEER** — same class; engaging is *permitted* but contested (commit only with
  numbers, surprise, or terrain).
- **AVOID** — friendly is outmatched; **never** an engage target — route around
  via `avoid_zone`.

| FRIENDLY ↓ \ ENEMY → | mbt | ifv | apc | mrap | light | truck | infantry |
|----------------------|:---:|:---:|:---:|:----:|:-----:|:-----:|:--------:|
| **mbt**        | PEER   | ENGAGE | ENGAGE | ENGAGE | ENGAGE | ENGAGE | ENGAGE |
| **ifv**        | ENGAGE | PEER   | ENGAGE | ENGAGE | ENGAGE | ENGAGE | ENGAGE |
| **apc**        | AVOID  | AVOID  | PEER   | ENGAGE | ENGAGE | ENGAGE | ENGAGE |
| **mrap**       | AVOID  | AVOID  | AVOID  | PEER   | ENGAGE | ENGAGE | AVOID  |
| **light**      | AVOID  | AVOID  | AVOID  | AVOID  | PEER   | ENGAGE | AVOID  |
| **truck**      | AVOID  | AVOID  | AVOID  | AVOID  | AVOID  | PEER†  | AVOID  |
| **spg**        | AVOID  | AVOID  | AVOID  | AVOID  | AVOID  | ENGAGE†| AVOID  |
| **spaa**       | AVOID  | AVOID  | AVOID  | AVOID  | AVOID  | ENGAGE†| AVOID  |
| **eng**        | AVOID  | AVOID  | AVOID  | AVOID  | AVOID  | ENGAGE†| AVOID  |
| **infantry**   | AVOID  | AVOID  | AVOID  | AVOID  | AVOID  | ENGAGE | PEER   |
| **helicopter** | ENGAGE | ENGAGE | ENGAGE | ENGAGE | ENGAGE | ENGAGE | ENGAGE |

**† Soft-skin / support convention.** `truck`, `spg`, `spaa`, and `eng` are
transport, indirect-fire, air-defence, and engineering platforms — not
direct-fire fighters. The raw matrix marks them able to "engage" a `truck`
because neither is outmatched, but **in practice these four are `avoid`-only**:
they carry `avoid_zones`, never `engage_zones`. `spg`/`spaa` fight from defilade
or the rear. The validator does not *flag* these as mismatches (they aren't in any
`vulnerable_unit_types` list for `truck`), so authoring must uphold the convention.

### How to read the asymmetries

- **The armour ladder** `mbt > ifv > apc > mrap > light`: each class overmatches
  everything strictly below it and is outmatched by everything above.
- **Standoff overmatch, not a mismatch.** `mbt`, `ifv`, and `helicopter` engage
  enemy `mbt`/`ifv` (main gun / ATGM / rockets from reach). Only against a same-tier
  tank is it a *PEER* fight.
- **Infantry is asymmetric.** Friendly `infantry` overmatches only enemy `truck`
  (ambush) and fights enemy `infantry` at PEER — it must AVOID every armed vehicle,
  including `mrap` and `light`, which outgun exposed dismounts in the open.
- **Mutual-avoid pairs.** `mrap`↔`infantry` and `light`↔`infantry` are AVOID in
  *both* directions: each can kill the other from ambush, so neither is tasked to
  close head-on — both route around.

---

## 6. Zones: how the grid drives orders

- **`engage_zone`** `{pos, radius(150–300), target_contact}` — intentional entry
  to fight. Legal **only** when the ordered unit's cell against that contact is
  ENGAGE (or a deliberately-accepted PEER). `target_contact` must resolve to a real
  `contact_id`.
- **`avoid_zone`** `{pos, radius(150–300)}` — hard no-entry. Every AVOID-cell threat,
  plus any threat outside this unit's task. The unit's `anchors` and `target` must
  stay outside all of its `avoid_zones`.
- **Engage-suitability check** (`validate.py`, mirrors pipeline geo filter spec 1.5):
  an order whose unit enters an `engage_zone` for a contact that lists the unit in
  `vulnerable_unit_types` is a **hard error** — re-task an overmatching platform and
  route the outmatched unit around instead.

---

## 7. Composition rosters (friendly force archetypes)

Fixed set the generator draws from; `friendly_units[].type` order = `friendly_0`,
`friendly_1`, …

| Archetype | Units (in order) | Size |
|-----------|------------------|:----:|
| Recon      | light, infantry | 2 |
| Patrol     | mrap, light, infantry | 3 |
| Mechanized | mbt, ifv, infantry | 3 |
| Support    | spg, ifv, mrap, infantry | 4 |
| Heavy      | mbt, ifv, apc, infantry, infantry | 5 |
| Combined   | mbt, ifv, mrap, light, infantry | 5 |
| Aviation   | helicopter, infantry, infantry | 3 |

---

## 8. Not yet modelled (future rows)

- **Air-defence threats** (`SAM`, `manpad`, enemy `spaa`) → would add rows making
  `helicopter` AVOID/vulnerable; the case where the grid becomes most discriminating.
- **Force ratio** — the grid and threat level are *absolute* (per-platform), not
  weighted by how many of each side is committed. Deferred.
- **Coordinates** — 2-D `[x, y]` in this dataset; the base spec's newer examples use
  3-D `[x, y, z]`. The ladder is unaffected; only line-of-sight/masking would change.
