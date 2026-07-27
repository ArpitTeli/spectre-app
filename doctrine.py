"""Doctrine matrix for SPECTRE / Stratis.

Single source of truth for "which friendly unit types is a given enemy threat
genuinely dangerous to" — i.e. which units are *outmatched* closing on it and
should not be ordered to solo-engage it without overmatch or support.

Used in three places:
  1. Injected onto every known_contact as `vulnerable_unit_types`.
  2. Communicated to the teacher so it assigns the right unit to each engage_zone.
  3. Checked by validate.py (mirrors the pipeline geo filter, spec 1.5): an order
     entering an engage_zone whose ordered unit is vulnerable to that contact is
     a mismatch (helicopter solo-ing a SAM, an MRAP assaulting dug-in infantry).

Model: a firepower/armor ladder mbt > ifv > apc > mrap > light > truck, plus two
asymmetries — dismounted infantry is outmatched by every armed vehicle but itself
threatens soft-skinned vehicles (ambush AT/small arms), and thin-skinned support
platforms (spg/spaa/eng/truck/boat) lose any direct-fire duel. Units that can kill
heavy armor from standoff (mbt gun, ifv ATGM, helicopter ATGM) are NOT listed as
vulnerable to mbt/ifv — engaging with overmatch is correct, not a mismatch.
"""

# enemy contact type  ->  friendly unit types it hard-counters (outmatches)
VULNERABLE_TO = {
    "mbt":      ["apc", "mrap", "light", "truck", "spg", "spaa", "eng", "infantry"],
    "ifv":      ["apc", "mrap", "light", "truck", "spg", "spaa", "eng", "infantry"],
    "apc":      ["mrap", "light", "truck", "spg", "spaa", "eng", "infantry"],
    "mrap":     ["light", "truck", "spg", "spaa", "eng", "infantry"],
    "light":    ["truck", "spg", "spaa", "eng", "infantry"],
    "truck":    [],
    "infantry": ["mrap", "light", "truck", "spg", "spaa", "eng"],
}

# NOTE: mbt, ifv, and helicopter appear in NO list — nothing in the current
# conventional enemy enum hard-counters a tank, an IFV (peer/standoff), or air.
# Helicopter vulnerability becomes meaningful only when air-defense threats
# (SAM / manpad / spaa) enter the contact enum; add those rows then.


def vulnerable_types_for(contact_type):
    """The vulnerable_unit_types list to stamp on a contact of this type."""
    return list(VULNERABLE_TO.get(contact_type, []))


def is_mismatch(unit_type, contact_type):
    """True if ordering `unit_type` to engage `contact_type` is a doctrine mismatch."""
    return unit_type in VULNERABLE_TO.get(contact_type, [])
