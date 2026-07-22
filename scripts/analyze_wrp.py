import struct

with open(r'F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps\stratis.wrp', 'rb') as f:
    data = f.read()

print(f"File size: {len(data)} bytes")

# Search for markers
markers = [b'OPRW', b'Terrain', b'height', b'mask', b'cells', b'grid', b'nvCL']
for marker in markers:
    idx = data.find(marker)
    if idx >= 0:
        context = data[max(0,idx-8):idx+len(marker)+24]
        print(f"Found '{marker.decode()}' at offset {idx}")
        print(f"  Context: {context[:48].hex()}")

# Look for image signatures
for sig_name, sig in [('PNG', b'\x89PNG'), ('JPEG', b'\xff\xd8\xff'), ('BMP', b'BM')]:
    idx = data.find(sig)
    if idx >= 0:
        print(f"Found {sig_name} at offset {idx}")

# Search for 4096 as uint32 LE
target = struct.pack('<I', 4096)
idx = data.find(target)
count = 0
while idx >= 0 and count < 10:
    print(f"Found uint32(4096) at offset {idx}")
    context = data[max(0,idx-16):idx+20]
    print(f"  Context: {context.hex()}")
    idx = data.find(target, idx + 1)
    count += 1

# The WRP format data sections typically start with a section header
# Let me look for the OPRW marker more carefully - it might indicate object placement data
oprw_idx = data.find(b'OPRW')
if oprw_idx >= 0:
    # OPRW might be followed by a version or size
    print(f"\nOPRW at {oprw_idx}:")
    chunk = data[oprw_idx:oprw_idx+64]
    print(f"  Raw: {chunk.hex()}")
    # Parse after OPRW
    pos = oprw_idx + 4
    if pos + 4 <= len(data):
        val = struct.unpack('<I', data[pos:pos+4])[0]
        print(f"  Next uint32: {val} (0x{val:x})")
        # This might be the number of objects or a data size

# The file starts with 'structbuilding' - this is a C++ struct definition marker
# The actual data format likely uses a chunk-based system
# Let me try to find the terrain grid data
# Each cell in Stratis is 2m, and the grid is 4096x4096
# 4096 * 4096 * 2 = 33,554,432 bytes for height data
# But the file is only 24,518,659 bytes, so the height data is smaller
# Actually with 16-bit values: 4096 * 4096 * 2 = 33,554,432 bytes
# The file is 24.5M, so maybe the full resolution isn't stored, or it uses compression

# Let me look for a 4096x2 or 8192 pattern
# 8192 = 0x2000
target2 = struct.pack('<I', 8192)
idx = data.find(target2)
count = 0
while idx >= 0 and count < 10:
    print(f"Found uint32(8192) at offset {idx}")
    context = data[max(0,idx-16):idx+20]
    print(f"  Context: {context.hex()}")
    idx = data.find(target2, idx + 1)
    count += 1
