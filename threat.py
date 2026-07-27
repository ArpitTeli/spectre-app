"""Canonical threat-level classifier for SPECTRE / Stratis scenarios.

Capability-weighted: a force's threat level is driven by the lethality of its
platforms, not merely how many contacts there are. See threat_level.md for the
full rationale, worked examples, and edge cases.
"""

# Threat points per platform, tracking lethality / engagement reach.
THREAT_POINTS = {
    "mbt": 5,        # 1200m stabilized main gun — overmatch
    "ifv": 4,        # 800m autocannon + ATGM
    "apc": 3.75,     # 600m crew-served / cannon — nearly IFV-grade
    "mrap": 3.2,     # 500m crew-served
    "light": 2.5,    # 400m light weapon
    "truck": 0.5,    # 300m soft transport — negligible on its own
    "infantry": 1,   # 300m dismounts
    "helicopter": 5,  # 1500m — enemy air is always a top-tier threat
}

# Platforms whose mere presence forces a high rating (heavy armor / ATGM-capable).
FORCES_HIGH = ("mbt", "ifv", "helicopter")


def score(contacts):
    """Sum of threat points across a list of contact dicts (each with a 'type')."""
    return sum(THREAT_POINTS.get(c["type"], 1) for c in contacts)


def classify(contacts):
    """Return 'low' | 'medium' | 'high' for a list of contact dicts.

    Priority order:
      1. Any MBT / IFV / (enemy) helicopter present  -> high
      2. Otherwise bucket by total threat points:
         >= 9 -> high,  4-8 -> medium,  <= 3 -> low
    """
    if any(c["type"] in FORCES_HIGH for c in contacts):
        return "high"
    total = score(contacts)
    if total >= 9:
        return "high"
    if total >= 4:
        return "medium"
    return "low"
