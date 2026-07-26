"""Test the path planner on Stratis."""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from path_planner import plan_route, plan_multi_anchor, load_weighted_grid

def test_basic():
    grid = load_weighted_grid("stratis")

    # Verified connected land cells on Stratis
    start = (2592, 288)
    end = (5152, 3552)

    for unit_type in ["infantry", "mbt", "ifv", "apc", "mrap", "light", "truck", "spg", "spaa", "eng", "helicopter"]:
        wps = plan_route(start, end, unit_type=unit_type, grid=grid)
        if wps is None:
            print(f"  {unit_type:12s}: NO PATH FOUND")
        else:
            dist = 0
            for i in range(1, len(wps)):
                dx = wps[i][0] - wps[i-1][0]
                dy = wps[i][1] - wps[i-1][1]
                dist += (dx**2 + dy**2) ** 0.5
            print(f"  {unit_type:12s}: {len(wps)} waypoints, {dist:.0f}m total")

def test_avoid():
    grid = load_weighted_grid("stratis")

    start = (2592, 288)
    end = (5152, 3552)

    wps_no_avoid = plan_route(start, end, unit_type="infantry", grid=grid)
    wps_avoid = plan_route(start, end, unit_type="infantry",
                           avoid_zones=[(3800, 1800, 200)], grid=grid)

    print(f"  Without avoid: {len(wps_no_avoid) if wps_no_avoid else 'NONE'} waypoints")
    print(f"  With avoid:    {len(wps_avoid) if wps_avoid else 'NONE'} waypoints")

def test_multi_anchor():
    grid = load_weighted_grid("stratis")

    start = (2592, 288)
    anchors = [(3500, 1800), (4500, 2800)]
    end = (5152, 3552)

    wps = plan_multi_anchor(start, anchors, end, unit_type="infantry", grid=grid)
    if wps:
        print(f"  Multi-anchor: {len(wps)} waypoints through {len(anchors)} anchors")
    else:
        print(f"  Multi-anchor: NO PATH FOUND")

if __name__ == "__main__":
    print("=== Basic routing ===")
    test_basic()
    print("\n=== Avoid zones ===")
    test_avoid()
    print("\n=== Multi-anchor ===")
    test_multi_anchor()
