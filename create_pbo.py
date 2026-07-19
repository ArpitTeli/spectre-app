#!/usr/bin/env python3
"""
PBO packer for Arma 3 - Based on Bohemia Interactive PBO File Format spec.

PBO Entry structure:
  - Filename: null-terminated string (variable length, relative to PBO)
  - MimeType: 4 bytes (0x00000000 for normal uncompressed files)
  - OriginalSize: 4 bytes (file size, uint32 LE)
  - Offset: 4 bytes (always 0 for uncompressed)
  - TimeStamp: 4 bytes (unix timestamp, uint32 LE)

Entries are contiguous, terminated by a null entry (empty filename + 16 zero bytes).
Data block follows immediately after all entries.
"""
import struct
import os
import sys
import time


def pack_pbo(source_dir, output_path):
    source_dir = os.path.abspath(source_dir)

    files = []
    for root, dirs, fnames in os.walk(source_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for fname in fnames:
            if fname.startswith('.'):
                continue
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, source_dir).replace('\\', '/')
            with open(full_path, 'rb') as f:
                data = f.read()
            files.append((rel_path, data))

    if not files:
        print("No files found to pack")
        return False

    files.sort(key=lambda x: x[0])
    now = int(time.time())

    with open(output_path, 'wb') as out:
        for rel_path, data in files:
            name_bytes = rel_path.encode('utf-8') + b'\x00'
            out.write(name_bytes)
            out.write(struct.pack('<IIII', 0, len(data), 0, now))

        out.write(b'\x00')
        out.write(b'\x00' * 16)

        for rel_path, data in files:
            out.write(data)

    print(f"PBO created: {output_path}")
    print(f"  Files: {len(files)}")
    print(f"  Size: {os.path.getsize(output_path)} bytes")
    return True


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <source_dir> <output.pbo>")
        sys.exit(1)

    source = sys.argv[1]
    output = sys.argv[2]

    if not os.path.isdir(source):
        print(f"Error: Source directory '{source}' does not exist")
        sys.exit(1)

    os.makedirs(os.path.dirname(output) or '.', exist_ok=True)
    success = pack_pbo(source, output)
    sys.exit(0 if success else 1)
