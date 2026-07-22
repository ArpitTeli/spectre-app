"""Extract real heightmap from Stratis.wrp"""
import struct
import numpy as np
from PIL import Image

WRP_PATH = r"F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps\stratis.wrp"
OUTPUT_PNG = r"F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps\stratis_height.png"

with open(WRP_PATH, 'rb') as f:
    data = f.read()

# WRPv7 has a known structure documented by the modding community
# Header: (based on Mikero's documentation)
# uint32 version (7)
# uint32 nRows (grid height = 4096 for stratis)
# uint32 nCols (grid width = 4096 for stratis)
# float cellSize (2.0 for stratis)
# Then packed data follows

# Let me scan for a WRP-like version header
for i in range(0, min(1000, len(data))):
    if i + 16 <= len(data):
        ver = struct.unpack('<I', data[i:i+4])[0]
        if ver == 7:
            rows = struct.unpack('<I', data[i+4:i+8])[0]
            cols = struct.unpack('<I', data[i+8:i+12])[0]
            cell = struct.unpack('<f', data[i+12:i+16])[0]
            if 2000 < rows < 20000 and 2000 < cols < 20000 and 0.5 < cell < 10:
                print(f"WRP header at {i}: v={ver} {rows}x{cols} cell={cell}m")

# The WRP file is 24.5MB. A 4096x4096 uint16 grid = 33.5MB.
# So the file is smaller than the full height grid -> height data must be compressed or partial.

# Try common WRPv7 data layout:
# After header, there might be:
# - Elevation data (compressed or partial)
# - Mask/satellite texture references  
# - Object placements
# - Road networks

# For WRPv7, the height data is often stored as "NVCL" chunks (Navel/Vector)
# Let me search for the NVCL marker
nvcl_idx = data.find(b'nvCL')
if nvcl_idx >= 0:
    print(f"Found nvCL at offset {nvcl_idx} (0x{nvcl_idx:x})")
    # After nvCL: typically 4 bytes chunk size, then compressed height data

# The height data might use NVCL compression (Navel Compression Library)
# Each NVCL chunk: 'nvCL' + uint32 decompressedSize + uint32 compressedSize + compressed data

pos = 0
chunks = []
while pos < len(data):
    marker = data[pos:pos+4]
    if marker == b'nvCL':
        if pos + 12 > len(data): break
        decompSize = struct.unpack('<I', data[pos+4:pos+8])[0]
        compSize = struct.unpack('<I', data[pos+8:pos+12])[0]
        chunks.append({
            'offset': pos,
            'decompSize': decompSize,
            'compSize': compSize,
            'content_type': 'nvCL'
        })
        print(f"nvCL chunk at {pos}: decomp={decompSize} comp={compSize}")
        pos += 12 + compSize
    else:
        pos += 1

# If we found nvCL chunks, the first one might be the height data
# The height data for Stratis (4096x4096x2 bytes = 33.5MB decompressed)
if chunks and chunks[0]['decompSize'] == 33554432:  # 4096*4096*2
    print("\nFirst nvCL chunk is likely the heightmap!")
    
# Try a different approach: read 16-bit values from various offsets 
# and look for the pattern of a heightmap (smooth gradients)
print("\nScanning for height data patterns...")
for start in range(0, min(5000000, len(data) - 100), 1000):
    chunk = data[start:start+200]
    vals = np.frombuffer(chunk, dtype=np.uint16)
    if len(vals) < 2: continue
    # Height data should have:
    # - Values in a reasonable range (0-2000 for raw, 0-65535 for normalized)
    # - Adjacent values that are correlated (terrain is smooth-ish)
    diffs = np.abs(np.diff(vals.astype(np.int32)))
    avg_diff = np.mean(diffs)
    if avg_diff < 50 and avg_diff > 0.1:
        print(f"  Offset {start}: avg_diff={avg_diff:.2f} range=[{np.min(vals)},{np.max(vals)}]")
