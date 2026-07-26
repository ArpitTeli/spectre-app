"""Path planner: A* over the terrain cost grid.

Converts the strategic LLM's anchor waypoints into dense, terrain-aware
routes at ~50m spacing. Deterministic, no AI — just A* on the weighted grid.

Usage:
    from scripts.path_planner import plan_route
    waypoints = plan_route(start=(4096, 4096), end=(6000, 3000), unit_type="infantry")
"""

import heapq
import math
import numpy as np
import os

MAP_SIZE = 8192
GRID_DIM = 128
CELL_SIZE = MAP_SIZE / GRID_DIM  # 64m
WAYPOINT_SPACING_M = 50

# 8-directional movement: (dy, dx, cost_multiplier)
DIRECTIONS = [
    (-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
    (-1, -1, 1.414), (-1, 1, 1.414), (1, -1, 1.414), (1, 1, 1.414),
]

UNIT_TYPES = ["tank", "ifv", "truck", "infantry", "helicopter", "boat"]

GRID_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "maps")


def load_weighted_grid(map_name="stratis"):
    path = os.path.join(GRID_DIR, f"{map_name}_costgrid_weighted.npz")
    data = np.load(path)
    return data["grid"]  # shape: [128, 128, 5]


def world_to_grid(x, y):
    gx = int(np.clip(x / CELL_SIZE, 0, GRID_DIM - 1))
    gy = int(np.clip(y / CELL_SIZE, 0, GRID_DIM - 1))
    return gy, gx


def grid_to_world(gy, gx):
    return (gx + 0.5) * CELL_SIZE, (gy + 0.5) * CELL_SIZE


def apply_constraints(cost_grid, unit_idx, avoid_zones=None, prefer_surface=None):
    grid = cost_grid[:, :, unit_idx].copy()

    if avoid_zones:
        for az_x, az_y, az_r in avoid_zones:
            az_gy, az_gx = world_to_grid(az_x, az_y)
            az_r_cells = max(1, int(az_r / CELL_SIZE))
            for dy in range(-az_r_cells, az_r_cells + 1):
                for dx in range(-az_r_cells, az_r_cells + 1):
                    ny, nx = az_gy + dy, az_gx + dx
                    if 0 <= ny < GRID_DIM and 0 <= nx < GRID_DIM:
                        dist = math.sqrt(dy**2 + dx**2) * CELL_SIZE
                        if dist <= az_r:
                            penalty = 10.0 * (1.0 - dist / az_r)
                            grid[ny, nx] += penalty

    return grid


def astar(grid, start_gy, start_gx, goal_gy, goal_gx):
    rows, cols = grid.shape
    INF = float("inf")
    cost_so_far = np.full((rows, cols), INF, dtype=np.float32)
    came_from = np.full((rows, cols, 2), -1, dtype=np.int32)

    cost_so_far[start_gy, start_gx] = 0.0
    h = math.sqrt((goal_gy - start_gy)**2 + (goal_gx - start_gx)**2)
    open_set = [(h, 0.0, start_gy, start_gx)]
    closed = set()

    while open_set:
        f, g, cy, cx = heapq.heappop(open_set)

        if (cy, cx) in closed:
            continue
        closed.add((cy, cx))

        if cy == goal_gy and cx == goal_gx:
            break

        for ddy, ddx, move_cost in DIRECTIONS:
            ny, nx = cy + ddy, cx + ddx
            if not (0 <= ny < rows and 0 <= nx < cols):
                continue
            if (ny, nx) in closed:
                continue

            cell_cost = grid[ny, nx]
            if cell_cost >= 50.0:
                continue

            new_g = g + cell_cost * move_cost
            if new_g < cost_so_far[ny, nx]:
                cost_so_far[ny, nx] = new_g
                came_from[ny, nx] = [cy, cx]
                h = math.sqrt((goal_gy - ny)**2 + (goal_gx - nx)**2)
                heapq.heappush(open_set, (new_g + h, new_g, ny, nx))

    if cost_so_far[goal_gy, goal_gx] == INF:
        return None

    path = []
    cy, cx = goal_gy, goal_gx
    while cy != -1 and cx != -1:
        path.append((cy, cx))
        prev = came_from[cy, cx]
        cy, cx = int(prev[0]), int(prev[1])
    path.reverse()
    return path


def thin_waypoints(path_cells, spacing_cells=2):
    if not path_cells:
        return []

    thinned = [path_cells[0]]
    last_kept = path_cells[0]

    for i in range(1, len(path_cells)):
        dy = path_cells[i][0] - last_kept[0]
        dx = path_cells[i][1] - last_kept[1]
        dist = math.sqrt(dy**2 + dx**2)
        if dist >= spacing_cells:
            thinned.append(path_cells[i])
            last_kept = path_cells[i]

    if thinned[-1] != path_cells[-1]:
        thinned.append(path_cells[-1])

    return thinned


def plan_route(start, end, unit_type="infantry", avoid_zones=None,
               prefer_surface=None, grid=None, map_name="stratis"):
    if grid is None:
        grid = load_weighted_grid(map_name)

    unit_idx = UNIT_TYPES.index(unit_type) if unit_type in UNIT_TYPES else 0

    constrained = apply_constraints(grid, unit_idx, avoid_zones, prefer_surface)

    start_gy, start_gx = world_to_grid(*start)
    end_gy, end_gx = world_to_grid(*end)

    path_cells = astar(constrained, start_gy, start_gx, end_gy, end_gx)
    if path_cells is None:
        return None

    spacing = max(1, int(WAYPOINT_SPACING_M / CELL_SIZE))
    thinned = thin_waypoints(path_cells, spacing)

    waypoints = []
    for gy, gx in thinned:
        wx, wy = grid_to_world(gy, gx)
        waypoints.append((wx, wy))

    return waypoints


def plan_multi_anchor(start, anchors, end, unit_type="infantry",
                      avoid_zones=None, prefer_surface=None,
                      grid=None, map_name="stratis"):
    if grid is None:
        grid = load_weighted_grid(map_name)

    all_waypoints = []
    points = [start] + anchors + [end]

    for i in range(len(points) - 1):
        segment = plan_route(
            points[i], points[i + 1],
            unit_type=unit_type,
            avoid_zones=avoid_zones,
            prefer_surface=prefer_surface,
            grid=grid,
            map_name=map_name,
        )
        if segment is None:
            return None
        if all_waypoints:
            segment = segment[1:]
        all_waypoints.extend(segment)

    return all_waypoints
