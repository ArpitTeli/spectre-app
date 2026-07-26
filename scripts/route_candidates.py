"""Generate multiple route candidates and evaluate them.

Hybrid approach: planner generates 2-3 routes with different strategies,
LLM picks from pre-computed options (fast — selecting from list, not computing).

Usage:
    from scripts.route_candidates import generate_candidates
    candidates = generate_candidates(start, end, unit_type="mbt")
"""

import sys
import os
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

from path_planner import (
    load_weighted_grid, plan_route, plan_multi_anchor,
    world_to_grid, grid_to_world, CELL_SIZE, GRID_DIM
)
from oakoc_extractor import extract_route_features

MAP_SIZE = 8192


def _find_road_direction(grid, start_gy, start_gx, roads):
    """Find the dominant road direction from a starting cell."""
    if not roads[start_gy, start_gx]:
        return None

    # BFS to find road cells nearby
    visited = set()
    queue = [(start_gy, start_gx, 0)]
    visited.add((start_gy, start_gx))
    road_cells = []

    while queue:
        y, x, dist = queue.pop(0)
        if dist > 5:
            continue
        road_cells.append((y, x))
        for dy in [-1, 0, 1]:
            for dx in [-1, 0, 1]:
                if dy == 0 and dx == 0:
                    continue
                ny, nx = y + dy, x + dx
                if 0 <= ny < GRID_DIM and 0 <= nx < GRID_DIM:
                    if (ny, nx) not in visited and roads[ny, nx]:
                        visited.add((ny, nx))
                        queue.append((ny, nx, dist + 1))

    if len(road_cells) < 3:
        return None

    # Find dominant direction using PCA
    cells = np.array(road_cells)
    mean = cells.mean(axis=0)
    centered = cells - mean
    cov = np.cov(centered.T)
    eigenvalues, eigenvectors = np.linalg.eigh(cov)
    direction = eigenvectors[:, np.argmax(eigenvalues)]
    return direction


def _generate_midpoint(start, end, offset_factor, grid, raw_grid, roads):
    """Generate a midpoint between start and end with lateral offset."""
    sx, sy = start
    ex, ey = end
    mx = (sx + ex) / 2
    my = (sy + ey) / 2

    # Direction from start to end
    dx = ex - sx
    dy = ey - sy
    length = (dx**2 + dy**2) ** 0.5
    if length < 1:
        return None

    # Perpendicular direction
    px = -dy / length
    py = dx / length

    # Offset distance (quarter of total distance)
    offset = length * offset_factor
    mid_x = mx + px * offset
    mid_y = my + py * offset

    # Clamp to map
    mid_x = max(100, min(MAP_SIZE - 100, mid_x))
    mid_y = max(100, min(MAP_SIZE - 100, mid_y))

    return (mid_x, mid_y)


def _generate_road_route(start, end, grid, raw_grid, roads):
    """Generate a route that strongly prefers roads."""
    sx, sy = start
    ex, ey = end
    start_gy, start_gx = world_to_grid(sx, sy)
    end_gy, end_gx = world_to_grid(ex, ey)

    # Find road cells near start and end
    road_start = None
    road_end = None

    # BFS from start to find nearest road
    visited = set()
    queue = [(start_gy, start_gx, 0)]
    visited.add((start_gy, start_gx))

    while queue:
        y, x, dist = queue.pop(0)
        if dist > 10:
            break
        if roads[y, x]:
            road_start = (y, x)
            break
        for dy in [-1, 0, 1]:
            for dx in [-1, 0, 1]:
                if dy == 0 and dx == 0:
                    continue
                ny, nx = y + dy, x + dx
                if 0 <= ny < GRID_DIM and 0 <= nx < GRID_DIM:
                    if (ny, nx) not in visited:
                        visited.add((ny, nx))
                        queue.append((ny, nx, dist + 1))

    # BFS from end to find nearest road
    visited = set()
    queue = [(end_gy, end_gx, 0)]
    visited.add((end_gy, end_gx))

    while queue:
        y, x, dist = queue.pop(0)
        if dist > 10:
            break
        if roads[y, x]:
            road_end = (y, x)
            break
        for dy in [-1, 0, 1]:
            for dx in [-1, 0, 1]:
                if dy == 0 and dx == 0:
                    continue
                ny, nx = y + dy, x + dx
                if 0 <= ny < GRID_DIM and 0 <= nx < GRID_DIM:
                    if (ny, nx) not in visited:
                        visited.add((ny, nx))
                        queue.append((ny, nx, dist + 1))

    if road_start and road_end:
        # Convert back to world coords
        rs_x, rs_y = grid_to_world(*road_start)
        re_x, re_y = grid_to_world(*road_end)
        # Plan: start -> road_start -> road_end -> end
        anchors = [(rs_x, rs_y), (re_x, re_y)]
        return plan_multi_anchor(start, anchors, end, unit_type="truck",
                                grid=grid, avoid_zones=None)
    elif road_start:
        rs_x, rs_y = grid_to_world(*road_start)
        return plan_route(start, (rs_x, rs_y), unit_type="truck", grid=grid)
    elif road_end:
        re_x, re_y = grid_to_world(*road_end)
        return plan_route((re_x, re_y), end, unit_type="truck", grid=grid)
    else:
        return None


def _generate_cover_route(start, end, grid, raw_grid, roads):
    """Generate a route that prefers vegetation (cover/concealment)."""
    # Create a modified cost grid that penalizes open ground
    modified_grid = grid.copy()

    # Read vegetation from raw grid
    vegetation = raw_grid[:, :, 2]

    # For each unit type layer, reduce cost in vegetated areas
    for i in range(modified_grid.shape[2]):
        # Cells with high vegetation get a bonus (lower cost)
        cover_bonus = np.where(vegetation > 5, -0.3, 0.0)
        modified_grid[:, :, i] = modified_grid[:, :, i] + cover_bonus

    # Plan with modified grid
    return plan_route(start, end, grid=modified_grid)


def generate_candidates(start, end, unit_type="mbt", avoid_zones=None):
    """Generate multiple route candidates with different strategies.

    Returns list of dicts:
    [
        {
            "name": "direct",
            "waypoints": [(x,y), ...],
            "distance": float,
            "description": "Direct route"
        },
        ...
    ]
    """
    raw_grid_path = os.path.join(
        os.path.dirname(__file__), "..", "public", "maps",
        "stratis_costgrid.npz"
    )
    if not os.path.exists(raw_grid_path):
        return []

    raw = np.load(raw_grid_path)["grid"]
    roads = raw[:, :, 4] > 0.5
    grid = load_weighted_grid("stratis")

    candidates = []

    # 1. Direct route
    direct = plan_route(start, end, unit_type=unit_type,
                       avoid_zones=avoid_zones, grid=grid)
    if direct:
        dist = _calc_distance(direct)
        candidates.append({
            "name": "direct",
            "waypoints": direct,
            "distance": dist,
            "description": "Direct route, fastest but may lack cover"
        })

    # 2. Road-preferring route (for vehicles)
    if unit_type in ["mbt", "ifv", "apc", "mrap", "light", "truck", "spg", "spaa", "eng"]:
        road_route = _generate_road_route(start, end, grid, raw, roads)
        if road_route:
            dist = _calc_distance(road_route)
            candidates.append({
                "name": "road_preferred",
                "waypoints": road_route,
                "distance": dist,
                "description": "Follows roads where available, faster but predictable"
            })

    # 3. Cover route (for infantry and light vehicles)
    if unit_type in ["infantry", "light", "mrap", "apc"]:
        cover_route = _generate_cover_route(start, end, grid, raw, roads)
        if cover_route:
            dist = _calc_distance(cover_route)
            candidates.append({
                "name": "cover_preferred",
                "waypoints": cover_route,
                "distance": dist,
                "description": "Prefers vegetation for concealment, slower but safer"
            })

    # 4. Left flank
    mid_left = _generate_midpoint(start, end, -0.25, grid, raw, roads)
    if mid_left:
        left_route = plan_multi_anchor(start, [mid_left], end,
                                      unit_type=unit_type,
                                      avoid_zones=avoid_zones, grid=grid)
        if left_route:
            dist = _calc_distance(left_route)
            candidates.append({
                "name": "left_flank",
                "waypoints": left_route,
                "distance": dist,
                "description": "Routes left of direct path, may avoid threats"
            })

    # 5. Right flank
    mid_right = _generate_midpoint(start, end, 0.25, grid, raw, roads)
    if mid_right:
        right_route = plan_multi_anchor(start, [mid_right], end,
                                       unit_type=unit_type,
                                       avoid_zones=avoid_zones, grid=grid)
        if right_route:
            dist = _calc_distance(right_route)
            candidates.append({
                "name": "right_flank",
                "waypoints": right_route,
                "distance": dist,
                "description": "Routes right of direct path, may avoid threats"
            })

    # 6. Avoid zone route (if avoid_zones provided, also generate without)
    if avoid_zones:
        no_avoid = plan_route(start, end, unit_type=unit_type, grid=grid)
        if no_avoid:
            dist = _calc_distance(no_avoid)
            candidates.append({
                "name": "direct_no_avoid",
                "waypoints": no_avoid,
                "distance": dist,
                "description": "Direct route without avoid zones"
            })

    # Deduplicate by checking if routes are very similar
    candidates = _deduplicate(candidates)

    return candidates


def _calc_distance(waypoints):
    """Calculate total route distance."""
    if not waypoints or len(waypoints) < 2:
        return 0
    dist = 0
    for i in range(1, len(waypoints)):
        dx = waypoints[i][0] - waypoints[i-1][0]
        dy = waypoints[i][1] - waypoints[i-1][1]
        dist += (dx**2 + dy**2) ** 0.5
    return dist


def _deduplicate(candidates, threshold=0.85):
    """Remove routes that are >threshold similar to each other."""
    if len(candidates) <= 1:
        return candidates

    unique = [candidates[0]]
    for cand in candidates[1:]:
        is_dup = False
        for u in unique:
            similarity = _route_similarity(cand["waypoints"], u["waypoints"])
            if similarity > threshold:
                is_dup = True
                break
        if not is_dup:
            unique.append(cand)
    return unique


def _route_similarity(route1, route2):
    """Check similarity between two routes by sampling points."""
    if not route1 or not route2:
        return 0

    # Sample 10 points along each route
    def sample(route, n=10):
        if len(route) <= n:
            return route
        indices = np.linspace(0, len(route)-1, n, dtype=int)
        return [route[i] for i in indices]

    s1 = sample(route1)
    s2 = sample(route2)

    # Compare corresponding points
    matches = 0
    for p1, p2 in zip(s1, s2):
        dist = ((p1[0]-p2[0])**2 + (p1[1]-p2[1])**2) ** 0.5
        if dist < 100:  # Within 100m
            matches += 1

    return matches / len(s1)


def evaluate_candidates(candidates, unit_type="mbt", avoid_zones=None):
    """Evaluate each candidate using OAKOC features.

    Returns candidates with added evaluation scores.
    """
    raw_grid_path = os.path.join(
        os.path.dirname(__file__), "..", "public", "maps",
        "stratis_costgrid.npz"
    )
    raw = np.load(raw_grid_path)["grid"]

    for cand in candidates:
        waypoints = cand["waypoints"]
        if not waypoints or len(waypoints) < 2:
            cand["score"] = 0
            cand["oakoc"] = None
            continue

        # Extract OAKOC features along route corridor
        # extract_route_features takes start/end, not waypoints
        start = waypoints[0]
        end = waypoints[-1]
        try:
            oakoc = extract_route_features(start, end, unit_type=unit_type)
            cand["oakoc"] = oakoc
        except Exception as e:
            cand["oakoc"] = None

        # Simple scoring: prefer shorter routes with more cover
        # Base score from distance (shorter = better)
        score = 500 / max(cand["distance"] / 1000, 0.1)  # Per km

        # Bonus for cover (vegetation = concealment)
        if cand["oakoc"] and "cover_concealment" in cand["oakoc"]:
            cover_count = len(cand["oakoc"]["cover_concealment"])
            score += cover_count * 10

        # Penalty for exposed zones (line of sight to threats)
        if cand["oakoc"] and "exposed_zones" in cand["oakoc"]:
            exposed_count = len(cand["oakoc"]["exposed_zones"])
            score -= exposed_count * 20

        # Penalty for obstacles (water, cliffs, etc.)
        if cand["oakoc"] and "obstacles" in cand["oakoc"]:
            obstacle_count = len(cand["oakoc"]["obstacles"])
            score -= obstacle_count * 5

        # Bonus for key terrain access
        if cand["oakoc"] and "key_terrain" in cand["oakoc"]:
            key_count = len(cand["oakoc"]["key_terrain"])
            score += key_count * 8

        cand["score"] = score

    # Sort by score
    candidates.sort(key=lambda x: x.get("score", 0), reverse=True)
    return candidates


if __name__ == "__main__":
    # Test with Stratis endpoints
    start = (2592, 288)
    end = (5152, 3552)

    for unit_type in ["mbt", "ifv", "apc", "mrap", "light", "truck", "infantry"]:
        print(f"\n=== {unit_type.upper()} ===")
        candidates = generate_candidates(start, end, unit_type=unit_type)
        candidates = evaluate_candidates(candidates, unit_type=unit_type)

        for i, cand in enumerate(candidates):
            print(f"  {i+1}. {cand['name']:20s} - {cand['distance']:.0f}m, "
                  f"score={cand.get('score', 0):.1f} - {cand['description']}")
