"""Test the OAKOC route corridor extractor on Stratis."""

import sys
import os
import json
import time
sys.path.insert(0, os.path.dirname(__file__))

from oakoc_extractor import extract_route_features

def test_corridor():
    """Extract features along a full route corridor."""
    start = (2592, 288)
    end = (5152, 3552)

    contacts = [
        {"id": "TANK-1", "pos": (4000, 2500), "type": "TANK", "engagement_radius": 400},
    ]

    print("=== Route corridor extraction ===")
    t0 = time.time()
    digest = extract_route_features(
        start=start, end=end,
        unit_type="infantry",
        known_contacts=contacts,
    )
    elapsed = time.time() - t0
    print(f"  Time: {elapsed:.1f}s")
    print(f"  Route: {digest['route_waypoints']} waypoints")
    print(f"  Corridor: {digest['corridor_bbox']['min']} to {digest['corridor_bbox']['max']}")

    print(f"\n  Key terrain: {len(digest['key_terrain'])}")
    for kt in digest['key_terrain']:
        print(f"    ({kt['pos'][0]:.0f},{kt['pos'][1]:.0f}) "
              f"elev={kt['elevation']}m vis={kt['visibility']}")

    print(f"\n  Obstacles: {len(digest['obstacles'])}")
    for obs in digest['obstacles']:
        print(f"    {obs['type']}: ({obs['pos'][0]:.0f},{obs['pos'][1]:.0f}) "
              f"{'%dm' % obs.get('angle', obs.get('cells', ''))}")

    print(f"\n  Cover zones: {len(digest['cover_concealment'])}")
    for cv in digest['cover_concealment']:
        print(f"    ({cv['pos'][0]:.0f},{cv['pos'][1]:.0f}) "
              f"type={cv['cover_type']} forest={cv['forest_score']} bldg={cv['building_score']}")

    print(f"\n  Exposed zones: {len(digest['exposed_zones'])}")
    for ex in digest['exposed_zones']:
        print(f"    ({ex['pos'][0]:.0f},{ex['pos'][1]:.0f}) "
              f"visible_to={ex['visible_to']}")

    return digest

def test_different_units():
    """Compare corridor for different unit types."""
    start = (2592, 288)
    end = (5152, 3552)

    print("\n=== Unit type comparison ===")
    for unit in ["infantry", "tank"]:
        t0 = time.time()
        d = extract_route_features(start=start, end=end, unit_type=unit)
        elapsed = time.time() - t0
        print(f"  {unit:12s}: {d['route_waypoints']} wps, "
              f"{len(d['key_terrain'])} key_terrain, "
              f"{len(d['obstacles'])} obstacles, "
              f"{len(d['cover_concealment'])} cover, "
              f"{len(d['exposed_zones'])} exposed "
              f"({elapsed:.1f}s)")

if __name__ == "__main__":
    digest = test_corridor()
    test_different_units()
