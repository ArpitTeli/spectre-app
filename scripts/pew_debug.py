import struct

raw = open(r'E:\Games\Arma 3\Addons\map_stratis.pbo', 'rb').read()

# First null byte at position 0? Let's check
print("Bytes 0-5:", raw[0:5].hex())
print("Byte 0:", raw[0])

# Let's parse properly
# Structure: [0x00] + 'sreV' + 8 zero bytes + 8 zero bytes = 21 bytes
# Then extensions as: key\x00value\x00 repeated
# Then \x00 terminates extensions
# Then file entries: filename\x00 + 20 bytes header
# Then \x00 terminates file list
# Then file data in order

pos = 0
if raw[0] != 0:
    print("WARNING: Expected null byte at position 0, got", raw[0])

pos = 1
magic = raw[1:5]
print(f"Magic: {magic} (should be sreV)")
pos = 5
pos += 16  # skip 16 zero bytes
print(f"Position after version header: {pos}")

# Read extensions
while pos < len(raw):
    key_end = raw.find(b'\x00', pos)
    if key_end < 0:
        break
    key = raw[pos:key_end].decode('ascii', errors='replace')
    pos = key_end + 1
    if not key:
        print(f"Null key (end of extensions) at pos {pos}")
        break
    val_end = raw.find(b'\x00', pos)
    if val_end < 0:
        break
    value = raw[pos:val_end].decode('ascii', errors='replace')
    pos = val_end + 1
    print(f"Extension: [{key}] = [{value}]")

print(f"Position after extensions: {pos}")
print(f"Byte at pos: {raw[pos]:02x} ({chr(raw[pos]) if 32 <= raw[pos] < 127 else '?'})")

# Now read file entries
entry_count = 0
while pos < len(raw):
    fname_end = raw.find(b'\x00', pos)
    if fname_end < 0:
        break
    fname = raw[pos:fname_end]
    pos = fname_end + 1
    if not fname:
        print(f"Null filename (end of file list) at pos {pos}")
        break
    if pos + 20 > len(raw):
        break
    header = raw[pos:pos+20]
    packing, orig_size, reserved, timestamp, data_size = struct.unpack('<5I', header)
    pos += 20
    fname_str = fname.decode('ascii', errors='replace')
    print(f"Entry {entry_count}: [{fname_str}] pack={packing} orig={orig_size} data={data_size} ts={timestamp}")
    entry_count += 1

print(f"\nTotal entries: {entry_count}")
print(f"Final position: {pos}")

# Now dump the file data
# Data starts at the position after the null byte that terminated the file list
data_start = pos + 1  # skip null terminator
print(f"\nData starts at: {data_start}")
print(f"Remaining bytes: {len(raw) - data_start}")
