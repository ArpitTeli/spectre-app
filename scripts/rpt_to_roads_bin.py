#!/usr/bin/env python3
"""Extract SPECTRE_ROADS data from RPT and convert to binary format.

Binary format:
  Header: uint32 totalSegments, uint32 totalChains
  Chain index: totalChains * uint32 (segment count per chain)
  Segments: totalSegments * (x:f32, y:f32, dir:f32, w:f32) = 16 bytes each
"""

import struct
import re
import sys
import os
import math


def parse_rpt(rpt_path):
    """Parse SPECTRE_ROADS:R lines from RPT file."""
    roads = []
    pattern = re.compile(
        r'"SPECTRE_ROADS:R,([\d.]+),([\d.]+),([\d.]+),([\d.]+)"'
    )

    with open(rpt_path, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            m = pattern.search(line)
            if m:
                x, y, d, w = float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4))
                roads.append((x, y, d, w))

    return roads


def connect_segments(segments, max_gap=80):
    """Connect point samples into road chains by proximity."""
    if not segments:
        return []

    remaining = list(range(len(segments)))
    chains = []

    while remaining:
        chain = [remaining.pop(0)]
        changed = True

        while changed:
            changed = False
            i = 0
            while i < len(remaining):
                idx = remaining[i]
                sx, sy = segments[idx][0], segments[idx][1]

                hx, hy = segments[chain[0]][0], segments[chain[0]][1]
                tx, ty = segments[chain[-1]][0], segments[chain[-1]][1]

                d_head = ((sx - hx) ** 2 + (sy - hy) ** 2) ** 0.5
                d_tail = ((sx - tx) ** 2 + (sy - ty) ** 2) ** 0.5

                if d_head <= max_gap:
                    chain.insert(0, idx)
                    remaining.pop(i)
                    changed = True
                elif d_tail <= max_gap:
                    chain.append(idx)
                    remaining.pop(i)
                    changed = True
                else:
                    i += 1

        chains.append(chain)

    return chains


def compute_chain_directions(chain, segments):
    """Compute direction for each point based on neighboring points."""
    result = []
    for i, idx in enumerate(chain):
        x, y, _, w = segments[idx]

        if len(chain) < 2:
            result.append((x, y, 0, w))
            continue

        if i == 0:
            nx, ny = segments[chain[1]][0], segments[chain[1]][1]
            dx, dy = nx - x, ny - y
        elif i == len(chain) - 1:
            px, py = segments[chain[i - 1]][0], segments[chain[i - 1]][1]
            dx, dy = x - px, y - py
        else:
            nx, ny = segments[chain[i + 1]][0], segments[chain[i + 1]][1]
            dx, dy = nx - x, ny - y

        angle = math.degrees(math.atan2(dy, dx))
        result.append((x, y, angle, w))

    return result


def write_binary(chains_data, output_path):
    """Write road chains to binary file.

    chains_data: list of lists of (x, y, dir, w) tuples
    """
    total_segments = sum(len(c) for c in chains_data)
    total_chains = len(chains_data)

    with open(output_path, 'wb') as f:
        f.write(struct.pack('<II', total_segments, total_chains))
        for chain in chains_data:
            f.write(struct.pack('<I', len(chain)))
        for chain in chains_data:
            for x, y, d, w in chain:
                f.write(struct.pack('<ffff', x, y, d, w))

    size_kb = os.path.getsize(output_path) / 1024
    print(f"Wrote {total_segments} segments in {total_chains} chains to {output_path} ({size_kb:.1f} KB)")


def main():
    rpt_path = r"C:\Users\arpit\AppData\Local\Arma 3\Arma3_x64_2026-07-23_00-00-25.rpt"
    output_path = r"F:\Projects\SPECTRE-ARMA 3\spectre-fixed\public\maps\stratis_roads.bin"

    print(f"Parsing RPT: {rpt_path}")
    raw = parse_rpt(rpt_path)
    print(f"Found {len(raw)} raw road point samples")

    if not raw:
        print("No road data found!")
        sys.exit(1)

    chains = connect_segments(raw, max_gap=80)
    print(f"Connected into {len(chains)} road chains")

    # Filter out tiny chains (< 3 points)
    chains = [c for c in chains if len(c) >= 3]
    print(f"After filtering: {len(chains)} chains with >= 3 points")

    # Compute directions per chain
    all_chains = []
    for chain in chains:
        directed = compute_chain_directions(chain, raw)
        all_chains.append(directed)

    total = sum(len(c) for c in all_chains)
    print(f"Total segments: {total}")

    write_binary(all_chains, output_path)


if __name__ == '__main__':
    main()
