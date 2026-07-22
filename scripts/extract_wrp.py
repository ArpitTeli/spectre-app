import struct
import numpy as np
from PIL import Image

PBO_PATH = r"E:\Games\Arma 3\Addons\map_stratis.pbo"
OUT_DIR = r"F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps"

# Read and parse the PBO
raw = open(PBO_PATH, 'rb').read()

# Parse PBO header (0x00 + "sreV" + 16 zeros)
pos = 21

# Read extensions
while pos < len(raw):
    key_end = raw.find(b'\x00', pos)
    if key_end < 0: break
    key = raw[pos:key_end].decode('ascii', errors='replace')
    pos = key_end + 1
    if not key: break
    val_end = raw.find(b'\x00', pos)
    if val_end < 0: break
    pos = val_end + 1

# Read file entries to find sizes
entries = []
while pos < len(raw):
    fname_end = raw.find(b'\x00', pos)
    if fname_end < 0: break
    fname = raw[pos:fname_end]
    pos = fname_end + 1
    if not fname: break
    packing, orig_size, reserved, timestamp, data_size = struct.unpack('<5I', raw[pos:pos+20])
    pos += 20
    entries.append({'name': fname.decode('ascii', errors='replace'), 'data_size': data_size})

# Data starts after the null byte terminating file list
data_start = pos + 1
offset = data_start

# Extract Stratis.wrp
for e in entries:
    if e['data_size'] > 0:
        if 'Stratis.wrp' in e['name']:
            filedata = raw[offset:offset + e['data_size']]
            print(f"Extracted Stratis.wrp: {len(filedata)} bytes")
            
            # Try different parse strategies
            # Check for "PEW" magic
            print(f"First 32 bytes hex: {filedata[:32].hex()}")
            print(f"First 64 bytes: {filedata[:64]}")
            
            # Try common WRP signatures
            for sig in [b'PEW\x00', b'PEW\x01', b'WRP\x00', b'wrp\x00']:
                idx = filedata.find(sig)
                if idx >= 0:
                    print(f"Found {sig} at offset {idx}")
            
            # The WRP format might start with a version number
            v = struct.unpack('<I', filedata[0:4])[0]
            print(f"First uint32: {v}")
            
            # Common WRPv7 format: version(4) + width(4) + height(4) + cellSize(4) + ...
            if v == 7:
                ver = v
                w = struct.unpack('<I', filedata[4:8])[0]
                h = struct.unpack('<I', filedata[8:12])[0]
                cell = struct.unpack('<f', filedata[12:16])[0]
                print(f"WRPv7: {w}x{h} cell={cell}m")
                
                # Need to find where height data starts
                # WRPv7 format: header (variable) + height data
                # The height data offset is often at a specific position
                print(f"Bytes 16-64 hex: {filedata[16:64].hex()}")
                
        offset += e['data_size']
