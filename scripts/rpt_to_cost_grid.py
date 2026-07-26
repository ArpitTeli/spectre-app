"""Parse SPECTRE cost grid (v8 three-pass) from Arma 3 RPT log.

Pass 1: SPECTRE_SURFGRID — surface codes (1 char per cell)
Pass 2: SPECTRE_OBJGRID — vegetation + building counts
Pass 3: SPECTRE_ROADGRID — road presence (0 or 1 per cell)

Usage:
    python scripts/rpt_to_cost_grid.py [RPT_PATH]
"""

import re
import sys
import os
import numpy as np

STEP = 64
MAP_SIZE = 8192
GRID_DIM = MAP_SIZE // STEP  # 128

RPT_PATH_DEFAULT = r"C:\Users\arpit\AppData\Local\Arma 3\Arma3_x64_*.rpt"
OUTPUT_DIR = r"F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps"


def find_latest_rpt():
    import glob
    files = sorted(glob.glob(RPT_PATH_DEFAULT), key=os.path.getmtime)
    if not files:
        print("No RPT files found.")
        sys.exit(1)
    return files[-1]


def parse_pass(rpt_path, marker):
    """Extract rows for a given marker (SURFGRID or OBJGRID)."""
    all_exports = []
    current = []
    in_export = False

    with open(rpt_path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if f"SPECTRE_{marker}:START" in line:
                current = []
                in_export = True
            elif f"SPECTRE_{marker}:END" in line and in_export:
                all_exports.append(current)
                in_export = False
                current = []
            elif in_export and f"SPECTRE_{marker}:" in line:
                m = re.search(rf"SPECTRE_{marker}:(.*)", line)
                if m:
                    data = m.group(1).strip().rstrip(";")
                    cells = [c.strip() for c in data.split(";") if c.strip()]
                    current.append(cells)

    if not all_exports:
        return None
    return all_exports[-1]


def build_grid(surface_rows, object_rows, road_rows, map_name="stratis"):
    grid = np.zeros((GRID_DIM, GRID_DIM, 5), dtype=np.float32)
    # channels: 0=elevation_cm, 1=surface_code, 2=vegetation, 3=buildings, 4=road

    # Elevation from heightmap PNG
    heightmap_path = os.path.join(OUTPUT_DIR, f"{map_name}_height.png")
    if os.path.exists(heightmap_path):
        from PIL import Image
        img = Image.open(heightmap_path).resize((GRID_DIM, GRID_DIM), Image.BILINEAR)
        arr = np.array(img).astype(np.float32)
        # Heightmap was normalized: 0=lowest, 255=highest
        # Stratis range: -157.5m to 234.9m
        elev_m = (arr / 255.0) * 392.4 - 157.5
        grid[:, :, 0] = elev_m * 10  # meters to cm
        print(f"Loaded heightmap: {heightmap_path}")
    else:
        print(f"Warning: heightmap not found at {heightmap_path}")

    # Surface codes from pass 1
    if surface_rows:
        for row_idx, row in enumerate(surface_rows):
            if row_idx >= GRID_DIM:
                break
            for col_idx, cell in enumerate(row):
                if col_idx >= GRID_DIM:
                    break
                try:
                    grid[row_idx, col_idx, 1] = int(cell)
                except ValueError:
                    pass

    # Vegetation + buildings from pass 2
    if object_rows:
        for row_idx, row in enumerate(object_rows):
            if row_idx >= GRID_DIM:
                break
            for col_idx, cell in enumerate(row):
                if col_idx >= GRID_DIM:
                    break
                parts = cell.split(",")
                if len(parts) >= 2:
                    try:
                        grid[row_idx, col_idx, 2] = int(parts[0])
                        grid[row_idx, col_idx, 3] = int(parts[1])
                    except ValueError:
                        pass

    # Road presence from pass 3
    if road_rows:
        for row_idx, row in enumerate(road_rows):
            if row_idx >= GRID_DIM:
                break
            for col_idx, cell in enumerate(row):
                if col_idx >= GRID_DIM:
                    break
                try:
                    grid[row_idx, col_idx, 4] = int(cell)
                except ValueError:
                    pass

    return grid


def save_grid(grid, map_name="stratis"):
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    npz_path = os.path.join(OUTPUT_DIR, f"{map_name}_costgrid.npz")
    np.savez_compressed(npz_path, grid=grid)
    print(f"Saved {npz_path}: shape={grid.shape}")

    surf = grid[:, :, 1].astype(int)
    veg = grid[:, :, 2]
    bldg = grid[:, :, 3]

    print(f"\nGrid stats ({grid.shape[0]}x{grid.shape[1]}):")
    codes = {0: "unknown", 1: "grass", 2: "forest", 3: "concrete", 4: "water", 5: "dirt", 6: "rock"}
    for code, name in codes.items():
        count = (surf == code).sum()
        if count > 0:
            print(f"  {name:12s}: {count:5d} cells ({count*100/(GRID_DIM*GRID_DIM):.1f}%)")
    print(f"  Max vegetation: {veg.max():.0f}")
    print(f"  Max buildings:  {bldg.max():.0f}")
    print(f"  Land cells (non-water): {(surf != 4).sum()}")
    road = grid[:, :, 4]
    print(f"  Road cells: {int(road.sum())} ({road.sum()*100/(GRID_DIM*GRID_DIM):.1f}%)")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        rpt_path = sys.argv[1]
    else:
        rpt_path = find_latest_rpt()

    print(f"Parsing: {rpt_path}")

    surf_rows = parse_pass(rpt_path, "SURFGRID")
    obj_rows = parse_pass(rpt_path, "OBJGRID")
    road_rows = parse_pass(rpt_path, "ROADGRID")

    if surf_rows is None:
        print("No SPECTRE_SURFGRID export found.")
        sys.exit(1)

    print(f"Surface pass: {len(surf_rows)} rows, avg {sum(len(r) for r in surf_rows)/len(surf_rows):.0f} cells/row")
    if obj_rows:
        print(f"Object pass:  {len(obj_rows)} rows, avg {sum(len(r) for r in obj_rows)/len(obj_rows):.0f} cells/row")
    if road_rows:
        print(f"Road pass:    {len(road_rows)} rows, avg {sum(len(r) for r in road_rows)/len(road_rows):.0f} cells/row")

    grid = build_grid(surf_rows, obj_rows, road_rows, map_name="stratis")
    save_grid(grid)
