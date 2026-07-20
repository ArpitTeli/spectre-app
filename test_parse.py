import re, json, os

rpt_dir = r'C:\Users\arpit\AppData\Local\Arma 3'
files = [f for f in os.listdir(rpt_dir) if f.endswith('.rpt')]
files.sort(key=lambda f: os.path.getmtime(os.path.join(rpt_dir, f)), reverse=True)
latest = os.path.join(rpt_dir, files[0])
print(f"Testing RPT: {files[0]}")

with open(latest, 'r', errors='replace') as f:
    content = f.read()

# Simulate what the Electron app does
lines = content.split('\n')
parsed = 0
failed = 0
for line in lines:
    m = re.search(r'SPECTRE_STATE:(\{.+\})', line)
    if m:
        raw = m.group(1)
        json_str = raw.replace('""', '"')
        try:
            data = json.loads(json_str)
            parsed += 1
            if parsed == 1:
                print(f"  First parsed: missionFolder={data.get('missionFolder')}, units={len(data.get('units',[]))}")
        except Exception as e:
            failed += 1
            if failed <= 2:
                print(f"  FAILED: {e}")
                print(f"  Raw (first 200): {repr(raw[:200])}")
                print(f"  Unescaped (first 200): {repr(json_str[:200])}")

print(f"\nTotal: {parsed} parsed OK, {failed} failed out of {parsed+failed}")
