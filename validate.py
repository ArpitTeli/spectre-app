"""SPECTRE dataset validator — v2 (avoid/engage zones + doctrine).

Validates every batch under batches/ against the v2 schema and, on zero errors,
merges them into spectre_dataset.json.

v2 changes over v1:
  * threat_level must equal threat.classify(contacts) (capability-weighted),
    not the old count-based rule.
  * every known_contact carries vulnerable_unit_types, which must equal the
    doctrine matrix for its type exactly.
  * order constraints split into avoid_zones (hard no-entry) and engage_zones
    (intentional entry, each with a target_contact resolving to a real contact).
  * engage-suitability: a unit ordered into an engage_zone must NOT be listed in
    that contact's vulnerable_unit_types (mirrors the pipeline geo filter, spec
    1.5). A mismatch is a hard error here so the generated set stays doctrine-clean.
"""
import json, math, glob, os
from doctrine import (VULNERABLE_TO, vulnerable_types_for, is_mismatch,
                       THREAT_POINTS, FORCES_HIGH, threat_score, classify_threat,
                       ENGAGEMENT_RADII, COMPOSITIONS, OBJECTIVES, INTENTS,
                       ENEMY_TYPES, ZONE_RADIUS_MIN, ZONE_RADIUS_MAX)

ENG = ENGAGEMENT_RADII
COMP = COMPOSITIONS
OBJ = OBJECTIVES
INTENT = INTENTS
CONTACT_TYPES = set(ENEMY_TYPES)


def rng(p):
    return 1000 <= p[0] <= 7000 and 1000 <= p[1] <= 7000


errs = []
allex = []
for bf in sorted(glob.glob('batches/batch_*.json')):
    data = json.load(open(bf, encoding='utf-8'))
    name = os.path.basename(bf)
    for i, e in enumerate(data):
        tag = f'{name}#{i}'
        sp, sj = e['scenario_params'], e['state_json']
        orders = e['teacher_output']['orders']
        contacts = sj['known_contacts']
        cids = {c['contact_id'] for c in contacts}

        # --- objective enum + agreement -------------------------------------
        if sp['objective'] not in OBJ:
            errs.append(f'{tag} BAD objective={sp["objective"]!r}')
        if sj['objective'] not in OBJ:
            errs.append(f'{tag} BAD state objective={sj["objective"]!r}')
        if sp['objective'] != sj['objective']:
            errs.append(f'{tag} objective mismatch sp/sj')

        # --- coordinate bounds (all declared points) ------------------------
        pts = [sp['start'], sp['end']]
        pts += [u['pos'] for u in sj['friendly_units']]
        pts += [c['pos'] for c in contacts]
        for o in orders:
            pts += [o['target']] + o['anchors']
            pts += [z['pos'] for z in o['constraints'].get('avoid_zones', [])]
            pts += [z['pos'] for z in o['constraints'].get('engage_zones', [])]
        for p in pts:
            if not rng(p):
                errs.append(f'{tag} coord OOR {p}')

        # --- counts ---------------------------------------------------------
        if sp['enemy_count'] != len(contacts):
            errs.append(f'{tag} enemy_count {sp["enemy_count"]}v{len(contacts)}')
        if sp['friendly_count'] != len(sj['friendly_units']):
            errs.append(f'{tag} friendly_count')
        if not (1 <= len(contacts) <= 4):
            errs.append(f'{tag} contact count {len(contacts)}')
        if len(cids) != len(contacts):
            errs.append(f'{tag} duplicate contact_id')

        # --- contacts -------------------------------------------------------
        for c in contacts:
            t = c['type']
            if t not in CONTACT_TYPES:
                errs.append(f'{tag} bad contact type {t!r}')
                continue
            if c['engagement_radius'] != ENG.get(t):
                errs.append(f'{tag} radius {t}={c["engagement_radius"]}')
            if not (0.6 <= c['confidence'] <= 1.0):
                errs.append(f'{tag} conf {c["confidence"]}')
            expected = vulnerable_types_for(t)
            if c.get('vulnerable_unit_types') != expected:
                errs.append(f'{tag} vuln_types {t} = {c.get("vulnerable_unit_types")} '
                            f'!= {expected}')

        # --- threat level (capability-weighted, must match classifier) ------
        want = classify_threat(contacts)
        if sp['threat_level'] != want:
            errs.append(f'{tag} threat_level sp={sp["threat_level"]} != {want} '
                        f'(score={threat_score(contacts)}, {[c["type"] for c in contacts]})')
        if sj['threat_level'] != want:
            errs.append(f'{tag} threat_level sj={sj["threat_level"]} != {want}')

        # --- composition ----------------------------------------------------
        comp = tuple(u['type'] for u in sj['friendly_units'])
        if comp not in COMP:
            errs.append(f'{tag} comp {comp}')

        # --- orders ---------------------------------------------------------
        if len(orders) != len(sj['friendly_units']):
            errs.append(f'{tag} order/unit count {len(orders)}v{len(sj["friendly_units"])}')
        unit_type = {u['unit_id']: u['type'] for u in sj['friendly_units']}
        contact_by_id = {c['contact_id']: c for c in contacts}
        for o in orders:
            uid = o['unit_id']
            if uid not in unit_type:
                errs.append(f'{tag} order uid {uid}')
            if o['intent'] not in INTENT:
                errs.append(f'{tag} intent {o["intent"]!r}')
            if not (2 <= len(o['anchors']) <= 5):
                errs.append(f'{tag} anchors {len(o["anchors"])}')
            cons = o['constraints']
            for z in cons.get('avoid_zones', []):
                if not (150 <= z['radius'] <= 300):
                    errs.append(f'{tag} avoid zone r {z["radius"]}')
            for z in cons.get('engage_zones', []):
                if not (150 <= z['radius'] <= 300):
                    errs.append(f'{tag} engage zone r {z["radius"]}')
                tc = z.get('target_contact')
                if tc not in contact_by_id:
                    errs.append(f'{tag} engage target_contact {tc!r} unresolved')
                    continue
                # engage-suitability: the ordered unit must overmatch the threat
                ut = unit_type.get(uid)
                if ut and is_mismatch(ut, contact_by_id[tc]['type']):
                    errs.append(f'{tag} MISMATCH {uid}({ut}) ordered to engage '
                                f'{tc}({contact_by_id[tc]["type"]}) — vulnerable')
            if cons.get('prefer_surface') not in ('road', 'forest', None):
                errs.append(f'{tag} surf {cons.get("prefer_surface")!r}')
            r = o['reasoning']
            for k in ('situation_assessment', 'tactical_choice', 'tradeoffs', 'what_if_rejected'):
                if len(r.get(k, '')) < 40:
                    errs.append(f'{tag} thin reasoning {uid}.{k}')
        allex.append(e)

print('total examples:', len(allex))
print('errors:', len(errs))
for x in errs:
    print('  -', x)
if not errs and allex:
    json.dump(allex, open('spectre_dataset.json', 'w', encoding='utf-8'), indent=2)
    print(f'MERGED {len(allex)} examples -> spectre_dataset.json')
