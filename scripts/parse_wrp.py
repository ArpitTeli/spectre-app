import struct
import numpy as np
from PIL import Image

with open(r'F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps\stratis.wrp', 'rb') as f:
    data = f.read()

print(f"File size: {len(data)} bytes")

# WRPv7 format (from BI modding community docs):
# The file is structured as:
# - WRP header (variable)
# - Elevation data (packed)
# - Mask / satellite references
# - Object placements
# - Road network

# Let me try the open-wrp approach
# Write data to temp for analysis
with open(r'F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps\stratis_info.txt', 'w') as f:
    f.write(f"File: stratis.wrp\nSize: {len(data)}\n\n")

# The header might be at the start of the file
# structbuilding\x00\x01\x00\x00\x00OPRW\x19\x00\x00\x00...
# The OPRW after the initial string seems significant

# OPRW at offset 19, followed by uint32 25, then more data
# OPRW might be a section marker

# Let me try to find the height data by scanning for it
# Stratis height range: 0-135m, stored as uint16

# Try reading from the end of the file backwards
# Sometimes height data is at the end

# Look for common section markers in WRPv7
for marker in [b'rLVR', b'MPB ', b'PBLF', b'FNV\x00', b'Elev', b'hgt\x00']:
    idx = data.find(marker)
    if idx >= 0:
        print(f"Found '{marker.decode(errors='replace')}' at offset {idx}")

# The 'rLVR' marker is the terrain data section header  
# After 'rLVR': uint32 sectionLength + data

# Let me check if the height data uses NVCL compression
# nvCL was found in the file earlier
# NVCL = Navel Compression Library (used by BI)

# Actually, let me try a different approach entirely.
# Instead of parsing the WRP, let me check if there's a way
# to use the Arma 3 command-line tools.

# The BI tool 'TerrainBuilder.exe' can export heightmaps
# from .pew files. But we have a .wrp file.
# The 'ObjectBuilder.exe' or 'Visitor.exe' might also help.

# Let me check if there's a cached or pre-extracted heightmap
# in the Arma 3 installation

# Actually, let me try to install armake and use it to 
# convert the .wrp to something readable
import subprocess
import shutil

# Check if armake is available
armake_path = shutil.which('armake')
if armake_path:
    print(f"armake found at: {armake_path}")
else:
    print("armake not found in PATH")

# As a last resort, let me try to use a very simple approach:
# The height data in WRPv7 is often stored as raw uint16 LE
# starting at a specific offset after the header

# Let me try known offsets from WRPv7 format reverse engineering
# File starts with 'structbuilding' at offset 0
# Then various data sections follow

# The actual terrain data is in a 'rLVR' section
# Let me find it and parse it
idx = data.find(b'rLVR')
if idx >= 0:
    print(f"\nFound rLVR at offset {idx} (0x{idx:x})")
    # rLVR + 4 bytes resvd + version(4) + nRows(4) + nCols(4) + cellSize(4)
    # then height data follows
    hdr = data[idx+4:idx+24]
    if len(hdr) >= 20:
        vals = struct.unpack('<5I', hdr[:20])
        print(f"  rLVR header: {vals}")
        # Might be: reserved, version, nRows, nCols, cellSizeAsInt
        ver = struct.unpack('<I', hdr[0:4])[0]
        print(f"  version={ver}")
        
        # Try to find height data after the rLVR header
        # The header is usually 20 bytes after the marker
        height_offset = idx + 4 + 20
        chunk = data[height_offset:height_offset+200]
        vals = struct.unpack('<100H', chunk)
        print(f"  Values at {height_offset}: min={min(vals)} max={max(vals)} avg={sum(vals)/len(vals):.1f}")

# Let me also try the approach of finding the BMP embedded in the file
# Earlier we found a BMP at offset ~1158321
# Let me check if there's terrain mask data near that offset
bmp_offsets = []
for i in range(len(data)):
    if data[i:i+2] == b'BM':
        bmp_offsets.append(i)
        if len(bmp_offsets) >= 5:
            break

print(f"\nBMP images found at offsets: {bmp_offsets}")
for off in bmp_offsets:
    if off + 50 > len(data): continue
    hdr = data[off:off+30]
    try:
        sig, fsize, _, _, data_off = struct.unpack('<2sIHHI', hdr[:14])
        w = struct.unpack('<I', hdr[18:22])[0]
        h = struct.unpack('<I', hdr[22:26])[0]
        bpp = struct.unpack('<H', hdr[28:30])[0]
        print(f"  BMP at {off}: {w}x{h} bpp={bpp} fileSize={fsize} dataOffset={data_off}")
    except:
        print(f"  BMP at {off}: failed to parse header")
