"""Apply density-aware per-unit-type cost weights over the terrain cost grid.

Cost model:
  total = base_surface_cost + veg_density * (1 + slope)

Key insight: vegetation on steep ground is worse than either alone (multiplicative).
A tank can push through scattered trees on flat ground.
The same trees on a cliff edge are impassable.

Usage:
    python scripts/apply_cost_weights.py [MAP_NAME]
"""

import sys
import os
import numpy as np

OUTPUT_DIR = r"F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps"

UNIT_TYPES = [
    "mbt", "ifv", "apc", "mrap", "light", "truck",
    "spg", "spaa", "eng",
    "infantry", "helicopter", "boat"
]

# Surface type codes: 0=unknown 1=grass 2=forest 3=concrete 4=water 5=dirt 6=rock
SURFACE_COSTS = {
    #            unk  grass  forest  concrete  water  dirt  rock
    "mbt":       [1.0, 1.0,  1.5,    0.7,     99.0, 1.1,  1.5],
    "ifv":       [1.0, 1.0,  1.3,    0.75,    99.0, 1.0,  1.3],
    "apc":       [1.0, 1.0,  1.2,    0.7,      0.8, 1.0,  1.2],
    "mrap":      [1.0, 1.0,  1.3,    0.7,     99.0, 1.0,  1.3],
    "light":     [1.0, 1.0,  1.2,    0.7,     99.0, 1.0,  1.2],
    "truck":     [1.0, 1.0,  1.5,    0.6,     99.0, 1.2,  1.8],
    "spg":       [1.0, 1.0,  1.5,    0.7,     99.0, 1.1,  1.5],
    "spaa":      [1.0, 1.0,  1.3,    0.75,    99.0, 1.0,  1.3],
    "eng":       [1.0, 1.0,  1.3,    0.8,     99.0, 1.0,  1.2],
    "infantry":  [1.0, 1.0,  1.0,    1.0,     10.0, 1.0,  1.2],
    "helicopter":[1.0, 1.0,  1.0,    1.0,      1.0, 1.0,  1.0],
    "boat":      [99.0,99.0, 99.0,   99.0,     0.5, 99.0, 99.0],
}

# Road cost multiplier: applied when road=1 in cost grid
# Lower = stronger road preference
ROAD_COST = {
    "mbt":        0.25,
    "ifv":        0.30,
    "apc":        0.25,
    "mrap":       0.25,
    "light":      0.30,
    "truck":      0.15,
    "spg":        0.30,
    "spaa":       0.30,
    "eng":        0.35,
    "infantry":   1.00,
    "helicopter": 1.00,
    "boat":       99.0,
}

# Vegetation density penalty per tree/bush
# Scales linearly with count, then multiplied by (1 + slope)
# High = unit is severely affected by vegetation
VEG_DENSITY_FACTOR = {
    "mbt":        0.08,
    "ifv":        0.06,
    "apc":        0.05,
    "mrap":       0.05,
    "light":      0.04,
    "truck":      0.10,
    "spg":        0.08,
    "spaa":       0.06,
    "eng":        0.05,
    "infantry":  -0.03,
    "helicopter":  0.0,
    "boat":       0.0,
}

# Slope penalty per degree of elevation gradient
# Scales linearly with gradient, then vegetation penalty is multiplied by (1 + this)
# High = unit is severely affected by steep terrain
SLOPE_FACTOR = {
    "mbt":        0.06,
    "ifv":        0.05,
    "apc":        0.04,
    "mrap":       0.04,
    "light":      0.03,
    "truck":      0.07,
    "spg":        0.06,
    "spaa":       0.05,
    "eng":        0.04,
    "infantry":   0.01,
    "helicopter": 0.0,
    "boat":       0.0,
}

# Maximum vegetation count for normalization (cells with more trees are clamped)
# At 64m resolution, a cell is 4096 m². 80 trees = ~1 tree per 50 m² = dense forest
MAX_VEG_COUNT = 80.0

CELL_SIZE = 64.0  # meters per cell


def compute_slope(grid):
    """Compute per-cell elevation gradient in degrees.

    Returns slope in degrees (0 = flat, 90 = vertical cliff).
    grid[:,:,0] = elevation in cm.
    """
    elev_m = grid[:, :, 0] / 10.0  # cm -> meters
    gy, gx = np.gradient(elev_m, CELL_SIZE)
    gradient_mag = np.sqrt(gx**2 + gy**2)  # meters per meter = tan(angle)
    slope_deg = np.degrees(np.arctan(gradient_mag))
    return slope_deg


def apply_weights(raw_grid):
    """Apply density-aware per-unit-type cost weights."""
    rows, cols = raw_grid.shape[:2]
    result = np.zeros((rows, cols, len(UNIT_TYPES)), dtype=np.float32)

    surf_codes = raw_grid[:, :, 1].astype(int)
    vegetation = np.clip(raw_grid[:, :, 2], 0, MAX_VEG_COUNT)
    buildings = raw_grid[:, :, 3]
    has_road = raw_grid[:, :, 4] > 0.5 if raw_grid.shape[2] > 4 else np.zeros((rows, cols), dtype=bool)
    slope = compute_slope(raw_grid)

    for i, unit_type in enumerate(UNIT_TYPES):
        # Base surface cost (terrain type only)
        surf_costs = np.array(SURFACE_COSTS[unit_type])
        surf_codes_clipped = np.clip(surf_codes, 0, len(surf_costs) - 1)
        cost = surf_costs[surf_codes_clipped].copy()

        # Road bonus: if road present, use road cost instead of terrain cost
        road_mult = ROAD_COST[unit_type]
        cost = np.where(has_road, np.minimum(cost, road_mult), cost)

        # Vegetation density penalty: veg_count * factor
        veg_penalty = vegetation * VEG_DENSITY_FACTOR[unit_type]

        # Slope multiplier: (1 + slope_deg * slope_factor)
        # This makes vegetation worse on steep ground
        slope_mult = 1.0 + slope * SLOPE_FACTOR[unit_type]

        # Combined terrain penalty (multiplicative interaction)
        terrain_penalty = veg_penalty * slope_mult

        # Building penalty (separate, additive — buildings are obstacles)
        bldg_penalty = buildings * 0.05  # small additive for all unit types
        if unit_type == "infantry":
            bldg_penalty = buildings * -0.02  # infantry likes buildings for cover

        cost = cost + terrain_penalty + bldg_penalty

        # Clamp — never go below 0.01 or above 99
        cost = np.clip(cost, 0.01, 99.0)

        result[:, :, i] = cost

    return result


if __name__ == "__main__":
    map_name = sys.argv[1] if len(sys.argv) > 1 else "stratis"

    raw_path = os.path.join(OUTPUT_DIR, f"{map_name}_costgrid.npz")
    if not os.path.exists(raw_path):
        print(f"Raw grid not found: {raw_path}")
        print("Run rpt_to_cost_grid.py first.")
        sys.exit(1)

    raw = np.load(raw_path)["grid"]
    print(f"Loaded raw grid: {raw.shape}")

    # Show slope stats
    elev_m = raw[:, :, 0] / 10.0
    gy, gx = np.gradient(elev_m, CELL_SIZE)
    slope = np.degrees(np.arctan(np.sqrt(gx**2 + gy**2)))
    print(f"Slope: max={slope.max():.1f}° mean={slope.mean():.1f}°")
    print(f"  cells > 15°: {(slope > 15).sum()}")
    print(f"  cells > 30°: {(slope > 30).sum()}")

    weighted = apply_weights(raw)
    out_path = os.path.join(OUTPUT_DIR, f"{map_name}_costgrid_weighted.npz")
    np.savez_compressed(out_path, grid=weighted, unit_types=UNIT_TYPES)
    print(f"\nSaved weighted grid: {out_path}")
    print(f"Shape: {weighted.shape}")

    for i, ut in enumerate(UNIT_TYPES):
        layer = weighted[:, :, i]
        passable = (layer < 50).sum()
        print(f"  {ut:12s}: min={layer.min():.3f} max={layer.max():.3f} "
              f"mean={layer.mean():.3f} passable={passable} ({passable*100/(128*128):.0f}%)")
