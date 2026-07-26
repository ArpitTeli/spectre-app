"""OAKOC Feature Extractor — route corridor version.

Scans a corridor between start and end positions, extracting terrain features
relevant to the entire maneuver — not just one point.

The LLM sees: "here's what's between you and your objective."

Usage:
    from scripts.oakoc_extractor import extract_route_features
    digest = extract_route_features(
        start=(2592, 288),
        end=(5152, 3552),
        unit_type="infantry",
        known_contacts=[...],
        map_name="stratis"
    )
"""

import math
import numpy as np
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from path_planner import (
    load_weighted_grid, world_to_grid, grid_to_world,
    plan_route, CELL_SIZE, GRID_DIM, MAP_SIZE
)

GRID_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "maps")

# Margin around the route corridor (meters)
CORRIDOR_MARGIN = 800

# Key terrain: minimum prominence to qualify
KEY_TERRAIN_MIN_PROMINENCE = 15

# Cover thresholds
MIN_FOREST_FOR_COVER = 5
MIN_BLDG_FOR_COVER = 2

# Max features per category (keeps digest small for LLM context)
MAX_KEY_TERRAIN = 5
MAX_OBSTACLES = 8
MAX_COVER_ZONES = 6
MAX_EXPOSED = 10
MAX_AVENUES = 3


def _load_heightmap(map_name="stratis"):
    from PIL import Image
    path = os.path.join(GRID_DIR, f"{map_name}_height.png")
    img = Image.open(path).resize((GRID_DIM, GRID_DIM), Image.BILINEAR)
    arr = np.array(img).astype(np.float32)
    return (arr / 255.0) * 392.4 - 157.5


def _line_of_sight(heightmap, gy1, gx1, gy2, gx2):
    """Check line-of-sight between two grid cells via ray march."""
    dy = gy2 - gy1
    dx = gx2 - gx1
    dist_cells = math.sqrt(dy**2 + dx**2)
    if dist_cells < 0.5:
        return True

    steps = max(int(dist_cells * 2), 10)
    h1 = heightmap[gy1, gx1]
    h2 = heightmap[gy2, gx2]

    for i in range(steps + 1):
        t = i / steps
        gy = gy1 + dy * t
        gx = gx1 + dx * t
        gi = int(np.clip(gy, 0, GRID_DIM - 1))
        gj = int(np.clip(gx, 0, GRID_DIM - 1))
        terrain_h = heightmap[gi, gj]
        line_h = h1 + (h2 - h1) * t
        if terrain_h > line_h + 5:
            return False
    return True


def _get_corridor_bbox(start, end, margin_cells):
    """Get bounding box (grid coords) encompassing start-to-end + margin."""
    sy, sx = world_to_grid(*start)
    ey, ex = world_to_grid(*end)

    min_y = max(0, min(sy, ey) - margin_cells)
    max_y = min(GRID_DIM - 1, max(sy, ey) + margin_cells)
    min_x = max(0, min(sx, ex) - margin_cells)
    max_x = min(GRID_DIM - 1, max(sx, ex) + margin_cells)

    return min_y, max_y, min_x, max_x


def extract_key_terrain(heightmap, raw_grid, bbox):
    """Find high-elevation observation points within the corridor."""
    min_y, max_y, min_x, max_x = bbox
    candidates = []

    for ny in range(min_y, max_y + 1, 2):
        for nx in range(min_x, max_x + 1, 2):
            # Local maximum check
            is_max = True
            for ddy in [-1, 0, 1]:
                for ddx in [-1, 0, 1]:
                    if ddy == 0 and ddx == 0:
                        continue
                    sy, sx = ny + ddy, nx + ddx
                    if 0 <= sy < GRID_DIM and 0 <= sx < GRID_DIM:
                        if heightmap[sy, sx] >= heightmap[ny, nx]:
                            is_max = False
                            break
                if not is_max:
                    break
            if not is_max:
                continue

            # Prominence
            neighbors = []
            for ddy in range(-3, 4):
                for ddx in range(-3, 4):
                    sy, sx = ny + ddy, nx + ddx
                    if 0 <= sy < GRID_DIM and 0 <= sx < GRID_DIM:
                        neighbors.append(heightmap[sy, sx])
            avg = np.mean(neighbors) if neighbors else 0
            prominence = heightmap[ny, nx] - avg
            if prominence < KEY_TERRAIN_MIN_PROMINENCE:
                continue

            # Visibility (sample 8 directions, 10 cells each)
            visible_dirs = 0
            for angle in range(0, 360, 45):
                ray_gy = int(ny + 10 * math.sin(math.radians(angle)))
                ray_gx = int(nx + 10 * math.cos(math.radians(angle)))
                ray_gy = np.clip(ray_gy, 0, GRID_DIM - 1)
                ray_gx = np.clip(ray_gx, 0, GRID_DIM - 1)
                if _line_of_sight(heightmap, ny, nx, ray_gy, ray_gx):
                    visible_dirs += 1
            visibility = visible_dirs / 8.0

            wx, wy = grid_to_world(ny, nx)
            candidates.append({
                "pos": (wx, wy),
                "elevation": round(float(heightmap[ny, nx]), 1),
                "prominence": round(float(prominence), 1),
                "visibility": round(visibility, 2),
            })

    candidates.sort(key=lambda c: c["visibility"] * c["prominence"], reverse=True)
    return candidates[:MAX_KEY_TERRAIN]


def extract_obstacles(raw_grid, bbox):
    """Find water bodies and steep slopes within the corridor."""
    min_y, max_y, min_x, max_x = bbox
    surf = raw_grid[:, :, 1].astype(int)
    elev_m = raw_grid[:, :, 0] / 10.0
    gy_grad, gx_grad = np.gradient(elev_m, CELL_SIZE)
    slope = np.degrees(np.arctan(np.sqrt(gx_grad**2 + gy_grad**2)))

    obstacles = []

    # Water — cluster nearby water cells
    water_mask = surf == 4
    visited_water = set()
    for ny in range(min_y, max_y + 1, 3):
        for nx in range(min_x, max_x + 1, 3):
            if not water_mask[ny, nx] or (ny, nx) in visited_water:
                continue
            # Flood fill small cluster
            cluster = []
            stack = [(ny, nx)]
            while stack and len(cluster) < 50:
                cy, cx = stack.pop()
                if (cy, cx) in visited_water:
                    continue
                if not (0 <= cy < GRID_DIM and 0 <= cx < GRID_DIM):
                    continue
                if not water_mask[cy, cx]:
                    continue
                visited_water.add((cy, cx))
                cluster.append((cy, cx))
                for ddy, ddx in [(-1,0),(1,0),(0,-1),(0,1)]:
                    stack.append((cy+ddy, cx+ddx))

            if len(cluster) >= 6:  # significant water body
                # Find center and extent
                avg_y = np.mean([c[0] for c in cluster])
                avg_x = np.mean([c[1] for c in cluster])
                wx, wy = grid_to_world(avg_y, avg_x)
                obstacles.append({
                    "type": "water",
                    "pos": (wx, wy),
                    "cells": len(cluster),
                })

    # Steep slopes
    for ny in range(min_y, max_y + 1, 2):
        for nx in range(min_x, max_x + 1, 2):
            if slope[ny, nx] > 20:
                wx, wy = grid_to_world(ny, nx)
                obstacles.append({
                    "type": "slope",
                    "pos": (wx, wy),
                    "angle": round(float(slope[ny, nx]), 1),
                })

    return obstacles[:MAX_OBSTACLES]


def extract_cover(raw_grid, bbox):
    """Find cover/concealment zones within the corridor."""
    min_y, max_y, min_x, max_x = bbox
    surf = raw_grid[:, :, 1].astype(int)
    veg = raw_grid[:, :, 2]
    bldg = raw_grid[:, :, 3]

    zones = []

    for ny in range(min_y, max_y + 1, 3):
        for nx in range(min_x, max_x + 1, 3):
            forest_score = 0
            building_score = 0

            for ddy in range(-1, 2):
                for ddx in range(-1, 2):
                    sy, sx = ny + ddy, nx + ddx
                    if 0 <= sy < GRID_DIM and 0 <= sx < GRID_DIM:
                        if surf[sy, sx] == 2:
                            forest_score += veg[sy, sx]
                        building_score += bldg[sy, sx]

            has_hard = building_score >= MIN_BLDG_FOR_COVER * 3
            has_conceal = forest_score >= MIN_FOREST_FOR_COVER * 3
            has_partial = forest_score >= MIN_FOREST_FOR_COVER

            if has_hard or has_conceal:
                wx, wy = grid_to_world(ny, nx)
                cover_type = []
                if has_hard:
                    cover_type.append("hard")
                if has_conceal:
                    cover_type.append("concealment")
                elif has_partial:
                    cover_type.append("partial")

                zones.append({
                    "pos": (wx, wy),
                    "cover_type": cover_type,
                    "forest_score": int(forest_score),
                    "building_score": int(building_score),
                })

    # Sort by total cover value, take best
    zones.sort(key=lambda z: z["forest_score"] + z["building_score"], reverse=True)
    return zones[:MAX_COVER_ZONES]


def extract_exposed(heightmap, raw_grid, bbox, known_contacts):
    """Find corridor cells visible to known threats."""
    if not known_contacts:
        return []

    min_y, max_y, min_x, max_x = bbox
    exposed = []

    for ny in range(min_y, max_y + 1, 4):
        for nx in range(min_x, max_x + 1, 4):
            visible_to = []
            for contact in known_contacts:
                cgy, cgx = world_to_grid(*contact["pos"])
                dist_m = math.sqrt((ny - cgy)**2 + (nx - cgx)**2) * CELL_SIZE
                if dist_m > contact.get("engagement_radius", 500):
                    continue
                if _line_of_sight(heightmap, ny, nx, cgy, cgx):
                    visible_to.append(contact.get("id", "unknown"))

            if visible_to:
                wx, wy = grid_to_world(ny, nx)
                exposed.append({
                    "pos": (wx, wy),
                    "visible_to": visible_to,
                })

    return exposed[:MAX_EXPOSED]


def extract_route_features(start, end, unit_type="infantry",
                           known_contacts=None, map_name="stratis"):
    """Main entry: extract OAKOC features along the start-to-end corridor.

    Returns a compact JSON digest for the LLM.
    """
    raw_grid = load_weighted_grid(map_name)
    # Load the raw cost grid separately — extraction functions need
    # surface/veg/building channels, not the weighted unit-cost grid
    raw_cost_path = os.path.join(GRID_DIR, f"{map_name}_costgrid.npz")
    if not os.path.exists(raw_cost_path):
        raise FileNotFoundError(
            f"Raw cost grid not found: {raw_cost_path}\n"
            "Run rpt_to_cost_grid.py first."
        )
    raw_cost_grid = np.load(raw_cost_path)["grid"]
    heightmap = _load_heightmap(map_name)

    # Build corridor bounding box
    margin_cells = int(CORRIDOR_MARGIN / CELL_SIZE)
    bbox = _get_corridor_bbox(start, end, margin_cells)

    # Compute rough route for avenue-of-approach info
    route_wps = plan_route(start, end, unit_type=unit_type,
                           grid=raw_grid, map_name=map_name)

    # Extract each category — use raw_cost_grid for surface/veg/building data
    key_terrain = extract_key_terrain(heightmap, raw_cost_grid, bbox)
    obstacles = extract_obstacles(raw_cost_grid, bbox)
    cover = extract_cover(raw_cost_grid, bbox)
    exposed = extract_exposed(heightmap, raw_cost_grid, bbox, known_contacts or [])

    # Build digest
    return {
        "start": start,
        "end": end,
        "unit_type": unit_type,
        "route_waypoints": len(route_wps) if route_wps else 0,
        "corridor_bbox": {
            "min": grid_to_world(bbox[0], bbox[2]),
            "max": grid_to_world(bbox[1], bbox[3]),
        },
        "key_terrain": key_terrain,
        "obstacles": obstacles,
        "cover_concealment": cover,
        "exposed_zones": exposed,
    }
