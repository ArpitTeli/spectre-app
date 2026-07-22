"""Extract FULL terrain heightmap from Arma 3 RPT log"""
import re
import numpy as np
from PIL import Image

RPT_PATH = r"C:\Users\arpit\AppData\Local\Arma 3\Arma3_x64_2026-07-22_15-40-58.rpt"
OUTPUT = r"F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps\stratis_height.png"

# Extract only the LAST terrain export (there are 3 in this RPT)
all_exports = []
with open(RPT_PATH, 'r', encoding='utf-8', errors='replace') as f:
    in_export = False
    current = []
    for line in f:
        m_start = re.search(r'SPECTRE_TERRAIN:START', line)
        m_end = re.search(r'SPECTRE_TERRAIN:END', line)
        m_data = re.search(r'SPECTRE_TERRAIN:([0-9,-]+)', line)
        
        if m_start:
            current = []
            in_export = True
        elif m_end and in_export:
            all_exports.append(current)
            in_export = False
        elif in_export and m_data:
            data = m_data.group(1).strip(',')
            vals = [int(x) for x in data.split(',') if x.strip() and x.strip() != '-']
            if len(vals) > 5:
                current.append(vals)

print(f"Found {len(all_exports)} exports in RPT")
chunks = all_exports[-1]  # Use the last one
print(f"Last export: {len(chunks)} chunks")

print(f"Total chunks: {len(chunks)}")

# Compute chunks per row dynamically
vals_per_chunk = [len(c) for c in chunks[:50]]
avg_per_chunk = sum(vals_per_chunk) / len(vals_per_chunk)
chunks_per_row = int(round(1024 / avg_per_chunk))
print(f"Avg values per chunk: {avg_per_chunk:.1f}, chunks per row: {chunks_per_row}")

rows = []
for i in range(0, len(chunks), chunks_per_row):
    merged = []
    for c in chunks[i:i+chunks_per_row]:
        merged.extend(c)
    rows.append(merged)

print(f"Reconstructed rows: {len(rows)}")
print(f"Row lengths: min={min(len(r) for r in rows)} max={max(len(r) for r in rows)}")

# Truncate to 1024x1024
arr = np.zeros((len(rows), 1024), dtype=np.int32)
for i, r in enumerate(rows):
    arr[i, :min(1024, len(r))] = r[:1024]

print(f"Array: {arr.shape}")
print(f"Raw: min={arr.min()} max={arr.max()}")

# Shift to positive range
min_val = arr.min()
arr_shifted = (arr - min_val).astype(np.float32)
max_val = arr_shifted.max()

# Normalize to 0-255 for 8-bit PNG
arr_norm = (arr_shifted / max_val * 255).astype(np.uint8)

# Downsize to 512x512 using block averaging
nrows, ncols = arr_norm.shape
block_y = nrows // 512
block_x = ncols // 512
arr_512 = arr_norm[:block_y*512, :block_x*512].reshape(512, block_y, 512, block_x).mean(axis=(1, 3)).astype(np.uint8)

img = Image.fromarray(arr_512, mode='L')
img.save(OUTPUT)
print(f"Saved {OUTPUT}: 512x512 8-bit PNG")
print(f"Elevation: {(min_val)/10:.1f}m to {(max_val + min_val)/10:.1f}m")
