import struct

PBO_PATH = r"E:\Games\Arma 3\Addons\map_stratis.pbo"

with open(PBO_PATH, 'rb') as f:
    raw = f.read()

# PBO format: 0x00 + "sreV" + 16 zeros + extensions + null + entries
pos = 1 + 4 + 16  # skip the version header

# Read extensions
extensions = {}
while pos < len(raw):
    key_end = raw.find(b'\x00', pos)
    if key_end < 0:
        break
    key = raw[pos:key_end].decode('ascii', errors='replace')
    pos = key_end + 1

    val_end = raw.find(b'\x00', pos)
    if val_end < 0:
        break
    value = raw[pos:val_end].decode('ascii', errors='replace')
    pos = val_end + 1

    if not key:
        break
    extensions[key] = value
    print("Ext:", key, "=", value)

# Read file entries
entries = []
while pos < len(raw):
    fname_end = raw.find(b'\x00', pos)
    if fname_end < 0:
        break
    fname = raw[pos:fname_end]
    pos = fname_end + 1
    if not fname:
        break
    if pos + 20 > len(raw):
        break
    packing, orig_size, reserved, timestamp, data_size = struct.unpack('<5I', raw[pos:pos+20])
    pos += 20
    entries.append({
        'name': fname.decode('ascii', errors='replace'),
        'packing': packing,
        'orig_size': orig_size,
        'data_size': data_size,
        'timestamp': timestamp
    })

# After the null entry, the file data follows
# Data starts after the null byte that terminated the file list
data_start = pos + 1  # skip the null terminator

print(f"\n{len(entries)} file entries, data starts at {data_start}")

offset = data_start
for e in entries:
    ds = e['data_size']
    if ds > 0:
        filedata = raw[offset:offset+ds]
        offset += ds
        print(f"Data: {e['name']:40s} size={ds}")
        
        if '.wrp' in e['name'].lower():
            print("  -> Found WRP terrain file!")
            out_path = r"F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps\stratis.wrp"
            with open(out_path, 'wb') as f:
                f.write(filedata)
            print(f"  -> Saved: {out_path} ({len(filedata)} bytes)")
