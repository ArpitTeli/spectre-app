"""SPECTRE Doctrine — single source of truth for all tactical rules on Stratis.

Consolidates: doctrine.py, threat.py, fixed-doctrine-matrix.md, threat_level.md

Three things this file defines:
  1. Which enemy threats outmatch which friendly units (VULNERABLE_TO)
  2. How to score and classify overall threat level (THREAT_POINTS, classify)
  3. Engagement radii, composition rosters, zone rules, and the full engage/avoid grid
"""

import math


# =============================================================================
# SECTION 1: Unit type enums
# =============================================================================

FRIENDLY_TYPES = [
    "mbt", "ifv", "apc", "mrap", "light", "truck",
    "spg", "spaa", "eng", "infantry", "helicopter"
]

ENEMY_TYPES = ["mbt", "ifv", "apc", "mrap", "light", "truck", "infantry"]

INTENTS = {"attack", "defend", "move", "hold", "recon", "evacuate", "support"}

OBJECTIVES = {"attack", "defend", "patrol", "evacuate", "recon", "hold", "support"}


# =============================================================================
# SECTION 2: Engagement radii (metres) — fixed per type
# =============================================================================

ENGAGEMENT_RADII = {
    "mbt": 1200,
    "ifv": 800,
    "apc": 600,
    "mrap": 500,
    "light": 400,
    "truck": 300,
    "infantry": 300,
    "helicopter": 1500,
}


# =============================================================================
# SECTION 3: Threat scoring and classification
# =============================================================================

# Threat points per platform (lethality x reach, not head count)
THREAT_POINTS = {
    "mbt": 5,          # 1200m stabilized main gun — overmatch
    "ifv": 4,          # 800m autocannon + ATGM
    "apc": 3.75,       # 600m crew-served / light cannon — nearly IFV-grade
    "mrap": 3.2,       # 500m crew-served weapon
    "light": 2.5,      # 400m light weapon
    "truck": 0.5,      # 300m soft transport — negligible on its own
    "infantry": 1,     # 300m dismounts
    "helicopter": 5,    # 1500m — enemy air is always top-tier
}

# Platforms whose mere presence forces a high rating
FORCES_HIGH = ("mbt", "ifv", "helicopter")


def threat_score(contacts):
    """Sum of threat points across a list of contact dicts."""
    return sum(THREAT_POINTS.get(c["type"], 1) for c in contacts)


def classify_threat(contacts):
    """Return 'low' | 'medium' | 'high' for a list of contact dicts.

    Priority order:
      1. Any MBT / IFV / helicopter present -> high
      2. Otherwise bucket by total threat points:
         >= 9 -> high,  4-8 -> medium,  < 4 -> low
    """
    if any(c["type"] in FORCES_HIGH for c in contacts):
        return "high"
    total = threat_score(contacts)
    if total >= 9:
        return "high"
    if total >= 4:
        return "medium"
    return "low"


# =============================================================================
# SECTION 4: Vulnerable unit types (doctrine matrix)
# =============================================================================

# enemy contact type -> friendly unit types it hard-counters (outmatches)
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
# conventional enemy enum hard-counters a tank, an IFV/ATGM platform, or air.
# Helicopter vulnerability becomes meaningful when air-defense threats
# (SAM / manpad / spaa) enter the contact enum.


def vulnerable_types_for(contact_type):
    """The vulnerable_unit_types list to stamp on a contact of this type."""
    return list(VULNERABLE_TO.get(contact_type, []))


def is_mismatch(unit_type, contact_type):
    """True if ordering unit_type to engage contact_type is a doctrine mismatch."""
    return unit_type in VULNERABLE_TO.get(contact_type, [])


# =============================================================================
# SECTION 5: Full engage/avoid grid (friendly x enemy)
# =============================================================================

# ENGAGE = friendly overmatches; PEER = same class (contested); AVOID = outmatched
ENGAGE_GRID = {
    "mbt":        {"mbt": "PEER",  "ifv": "ENGAGE", "apc": "ENGAGE", "mrap": "ENGAGE", "light": "ENGAGE", "truck": "ENGAGE", "infantry": "ENGAGE"},
    "ifv":        {"mbt": "ENGAGE","ifv": "PEER",   "apc": "ENGAGE", "mrap": "ENGAGE", "light": "ENGAGE", "truck": "ENGAGE", "infantry": "ENGAGE"},
    "apc":        {"mbt": "AVOID", "ifv": "AVOID",  "apc": "PEER",   "mrap": "ENGAGE", "light": "ENGAGE", "truck": "ENGAGE", "infantry": "ENGAGE"},
    "mrap":       {"mbt": "AVOID", "ifv": "AVOID",  "apc": "AVOID",  "mrap": "PEER",   "light": "ENGAGE", "truck": "ENGAGE", "infantry": "AVOID"},
    "light":      {"mbt": "AVOID", "ifv": "AVOID",  "apc": "AVOID",  "mrap": "AVOID",  "light": "PEER",   "truck": "ENGAGE", "infantry": "AVOID"},
    "truck":      {"mbt": "AVOID", "ifv": "AVOID",  "apc": "AVOID",  "mrap": "AVOID",  "light": "AVOID",  "truck": "PEER",   "infantry": "AVOID"},
    "spg":        {"mbt": "AVOID", "ifv": "AVOID",  "apc": "AVOID",  "mrap": "AVOID",  "light": "AVOID",  "truck": "ENGAGE", "infantry": "AVOID"},
    "spaa":       {"mbt": "AVOID", "ifv": "AVOID",  "apc": "AVOID",  "mrap": "AVOID",  "light": "AVOID",  "truck": "ENGAGE", "infantry": "AVOID"},
    "eng":        {"mbt": "AVOID", "ifv": "AVOID",  "apc": "AVOID",  "mrap": "AVOID",  "light": "AVOID",  "truck": "ENGAGE", "infantry": "AVOID"},
    "infantry":   {"mbt": "AVOID", "ifv": "AVOID",  "apc": "AVOID",  "mrap": "AVOID",  "light": "AVOID",  "truck": "ENGAGE", "infantry": "PEER"},
    "helicopter": {"mbt": "ENGAGE","ifv": "ENGAGE", "apc": "ENGAGE", "mrap": "ENGAGE", "light": "ENGAGE", "truck": "ENGAGE", "infantry": "ENGAGE"},
}


# =============================================================================
# SECTION 6: Composition rosters (friendly force archetypes)
# =============================================================================

COMPOSITIONS = {
    ("light", "infantry"):                       "Recon",
    ("mrap", "light", "infantry"):               "Patrol",
    ("mbt", "ifv", "infantry"):                  "Mechanized",
    ("spg", "ifv", "mrap", "infantry"):          "Support",
    ("mbt", "ifv", "apc", "infantry", "infantry"): "Heavy",
    ("mbt", "ifv", "mrap", "light", "infantry"): "Combined",
    ("helicopter", "infantry", "infantry"):       "Aviation",
}


# =============================================================================
# SECTION 7: Zone rules
# =============================================================================

# avoid_zone: {pos, radius(150-300)} — hard no-entry
# engage_zone: {pos, radius(150-300), target_contact} — intentional entry,
#   legal only if the ordered unit is NOT in target_contact's vulnerable_unit_types
ZONE_RADIUS_MIN = 150
ZONE_RADIUS_MAX = 300


def validate_zone_radius(radius):
    """Check if a zone radius is within allowed bounds."""
    return ZONE_RADIUS_MIN <= radius <= ZONE_RADIUS_MAX


# =============================================================================
# SECTION 8: Threat level examples (for reference / prompt injection)
# =============================================================================

THREAT_EXAMPLES = """
| Contacts                  | Points | Level    |
|---------------------------|--------|----------|
| 1 x infantry              | 1      | low      |
| infantry + truck          | 1.5    | low      |
| 3 x infantry              | 3      | low      |
| light + infantry          | 3.5    | low      |
| 2 x light                 | 5.0    | medium   |
| apc + infantry            | 4.75   | medium   |
| apc + mrap                | 6.95   | medium   |
| 2 x apc                   | 7.5    | medium   |
| apc + mrap + light        | 9.45   | high     |
| 3 x apc                   | 11.25  | high     |
| 1 x mbt                   | rule 1 | high     |
| mbt + ifv + apc + infantry| rule 1 | high     |
| ifv + apc + mrap          | rule 1 | high     |
""".strip()


# =============================================================================
# SECTION 9: Coordinate bounds for Stratis
# =============================================================================

STRATIS_BOUNDS = {"x_min": 1000, "x_max": 7000, "y_min": 1000, "y_max": 7000}


def in_bounds(pos):
    """Check if a position is within Stratis bounds."""
    return (STRATIS_BOUNDS["x_min"] <= pos[0] <= STRATIS_BOUNDS["x_max"] and
            STRATIS_BOUNDS["y_min"] <= pos[1] <= STRATIS_BOUNDS["y_max"])
