"""Extract terrain heightmap from Arma 3 RPT log"""
import re
import numpy as np
from PIL import Image

RPT_PATH = r"C:\Users\arpit\AppData\Local\Arma 3\Arma3_x64_2026-07-22_14-31-54.rpt"
OUTPUT = r"F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps\stratis_height.png"

lines = []
with open(RPT_PATH, 'r', encoding='utf-8', errors='replace') as f:
    for line in f:
        m = re.search(r'SPECTRE_TERRAIN:([0-9,-]+)', line)
        if m:
            data = m.group(1).strip(',')
            vals = [int(x) for x in data.split(',') if x.strip() and x.strip() != '-']
            if len(vals) > 10:
                lines.append(vals)

# Group every 3 RPT lines into one y-row
reconstructed = []
for i in range(0, len(lines), 3):
    group = lines[i:i+3]
    merged = []
    for g in group:
        merged.extend(g)
    reconstructed.append(merged)

nrows = len(reconstructed)
ncols = min(len(r) for r in reconstructed)

arr = np.zeros((nrows, ncols), dtype=np.int32)
for i, r in enumerate(reconstructed):
    arr[i, :min(ncols, len(r))] = r[:ncols]

print(f"Raw data: {nrows}x{ncols}")

# Values are getTerrainHeight * 10
# Shift to positive, normalize for 16-bit PNG
min_val = arr.min()
arr_shifted = (arr - min_val).astype(np.float32)
max_val = arr_shifted.max()

arr_norm = (arr_shifted / max_val * 65535).astype(np.uint16)

# Stretch to full 8192m width by repeating last column
full = np.zeros((nrows, 1024), dtype=np.uint16)
full[:, :ncols] = arr_norm
full[:, ncols:] = arr_norm[:, -1:]  # fill rest with edge values

# Resize to 512x512 via averaging
import math
def resize_grid(src, target_y, target_x):
    sy, sx = src.shape
    result = np.zeros((target_y, target_x), dtype=np.uint16)
    for ty in range(target_y):
        ys = ty * sy // target_y
        ye = (ty + 1) * sy // target_y
        for tx in range(target_x):
            xs = tx * sx // target_x
            xe = (tx + 1) * sx // target_x
            result[ty, tx] = np.mean(src[ys:ye, xs:xe])
    return result

arr_512 = resize_grid(full, 512, 512)

# Save as 8-bit PNG (canvas-compatible)
arr_8 = (arr_512.astype(np.float32) / 65535 * 255).astype(np.uint8)

img = Image.fromarray(arr_8, mode='L')
img.save(OUTPUT)
print(f"Saved {OUTPUT}: 512x512 8-bit PNG")
print(f"Elevation range: {min_val/10:.1f}m to {(max_val + min_val)/10:.1f}m")
