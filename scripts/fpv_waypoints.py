"""FPV Kamikaze waypoint generator — terrain-following flight profile.

Reads start + target positions from stdin JSON, loads Stratis cost grid,
outputs terrain-hugging waypoints at ~100m spacing + pop-up/dive terminal phase.

Usage: echo '{"start":[x,y,z],"target":[x,y,z]}' | python fpv_waypoints.py
"""

import sys
import json
import numpy as np
from pathlib import Path

GRID_PATH = Path(__file__).parent.parent / "public" / "maps" / "stratis_costgrid.npz"
CELL_M = 64.0
SAMPLE_SPACING = 100.0
FLY_HEIGHT = 50.0
POP_HEIGHT = 150.0
BUILDING_THRESHOLD = 2
MIN_POINTS = 3


def load_grid():
    data = np.load(GRID_PATH)
    return data[list(data.keys())[0]]


def grid_coord(arma_coord):
    return max(0, min(127, int(arma_coord / CELL_M)))


def get_elevation(grid, arma_x, arma_y):
    gx = grid_coord(arma_x)
    gy = grid_coord(arma_y)
    return grid[gy, gx, 0] / 100.0  # cm to meters


def get_building_count(grid, arma_x, arma_y):
    gx = grid_coord(arma_x)
    gy = grid_coord(arma_y)
    return grid[gy, gx, 3]


def generate(start, target):
    grid = load_grid()

    sx, sy, sz = start
    tx, ty, _ = target

    dist = np.hypot(tx - sx, ty - sy)
    if dist < SAMPLE_SPACING:
        # Too close for terrain following — just direct dive
        return [
            [tx, ty, POP_HEIGHT],
            [tx, ty, 0],
        ]

    steps = max(MIN_POINTS, int(dist / SAMPLE_SPACING) + 1)
    waypoints = []

    for i in range(steps):
        t = i / (steps - 1)
        px = sx + (tx - sx) * t
        py = sy + (ty - sy) * t
        elev = get_elevation(grid, px, py)
        bldg = get_building_count(grid, px, py)

        alt = elev + FLY_HEIGHT
        if bldg > BUILDING_THRESHOLD:
            alt = max(alt, elev + 80)  # extra clearance over dense buildings

        waypoints.append([round(px), round(py), round(alt)])

    # Terminal phase: pop-up over target, then dive
    waypoints.append([round(tx), round(ty), round(POP_HEIGHT)])
    waypoints.append([round(tx), round(ty), 0])

    return waypoints


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"error": "no input"}))
        sys.exit(1)

    try:
        data = json.loads(raw)
        start = data["start"]
        target = data["target"]
    except (json.JSONDecodeError, KeyError) as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    try:
        waypoints = generate(start, target)
        print(json.dumps({"waypoints": waypoints}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
