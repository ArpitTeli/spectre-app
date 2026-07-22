"""Extract Arma 3 terrain heightmap from .pbo -> .pew -> 16-bit PNG"""
import struct, sys, os
from pathlib import Path

def read_pbo_entries(pbo_path):
    entries = []
    with open(pbo_path, 'rb') as f:
        while True:
            filename = b''
            while True:
                c = f.read(1)
                if c == b'\x00' or not c:
                    break
                filename += c
            if not filename:
                break
            packing = struct.unpack('<I', f.read(4))[0]
            orig_size = struct.unpack('<I', f.read(4))[0]
            reserved = struct.unpack('<I', f.read(4))[0]
            timestamp = struct.unpack('<I', f.read(4))[0]
            data_size = struct.unpack('<I', f.read(4))[0]
            entries.append({
                'filename': filename.decode('ascii', errors='replace'),
                'packing': packing,
                'orig_size': orig_size,
                'data_size': data_size,
                'offset': f.tell()
            })
            f.seek(data_size, 1)
        # Data start is after all headers
        data_start = 0
        for e in entries:
            if e['data_size'] > 0:
                data_start = e['offset']
                break
        # Actually the data follows the null entry
        # Let me recalculate offsets
        return entries

def extract_pew(pbo_path, output_dir):
    with open(pbo_path, 'rb') as f:
        raw = f.read()
    
    # Find PBO entries
    pos = 0
    entries = []
    while pos < len(raw):
        filename = b''
        while pos < len(raw):
            c = raw[pos:pos+1]
            pos += 1
            if c == b'\x00':
                break
            filename += c
        if not filename:
            break
        if pos + 16 > len(raw):
            break
        packing, orig_size, reserved, timestamp, data_size = struct.unpack('<5I', raw[pos:pos+20])
        pos += 20
        fname = filename.decode('ascii', errors='replace')
        entries.append((fname, packing, orig_size, data_size, pos))
        pos += data_size
    
    # Find .pew file entry
    pew_entry = None
    for fname, packing, orig_size, data_size, offset in entries:
        if fname.lower().endswith('.pew') and data_size > 0:
            pew_entry = (fname, orig_size, data_size, offset)
            break
    
    if not pew_entry:
        print("No .pew file found in PBO")
        for fname, _, _, _, _ in entries:
            print(f"  {fname}")
        return None
    
    fname, orig_size, data_size, offset = pew_entry
    pew_data = raw[offset:offset+data_size]
    
    if fname.startswith('\\'):
        fname = fname[1:]
    out_path = Path(output_dir) / fname
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(pew_data)
    print(f"Extracted: {out_path} ({len(pew_data)} bytes)")
    return out_path

def pew_to_png(pew_path, output_png):
    with open(pew_path, 'rb') as f:
        data = f.read()
    
    # PEW header
    magic = data[0:4]
    version = struct.unpack('<I', data[4:8])[0]
    width = struct.unpack('<I', data[8:12])[0]
    height = struct.unpack('<I', data[12:16])[0]
    cell_size = struct.unpack('<f', data[16:20])[0]
    
    print(f"PEW: magic={magic} version={version} {width}x{height} cell={cell_size}m")
    
    # Height data starts at offset 20
    height_data = data[20:20 + width * height * 2]
    heights = struct.unpack(f'<{width * height}H', height_data)
    
    # Convert to 16-bit PNG
    import numpy as np
    from PIL import Image
    
    arr = np.array(heights, dtype=np.uint16).reshape((height, width))
    img = Image.fromarray(arr, mode='I;16')
    img.save(output_png)
    print(f"Saved heightmap: {output_png} ({width}x{height})")

if __name__ == '__main__':
    pbo_dir = Path(r"E:\Games\Arma 3\Addons")
    output_dir = Path(__file__).parent.parent / "public" / "maps"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Process Stratis map
    pbo_path = pbo_dir / "map_stratis.pbo"
    if not pbo_path.exists():
        print(f"PBO not found: {pbo_path}")
        sys.exit(1)
    
    pew_path = extract_pew(pbo_path, output_dir)
    if pew_path:
        pew_to_png(pew_path, output_dir / "stratis_height.png")
