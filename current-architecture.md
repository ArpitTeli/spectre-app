# SPECTRE C2 — Current Architecture

## System Overview

SPECTRE C2 is an Electron desktop application that controls Arma 3 units in real-time. The app provides a 2D tactical map, a 3D battlespace viewer, AI mission planning, and a command bridge that executes orders in Arma 3.

```
┌─────────────────────────────────────────────────┐
│                  Electron App                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  React   │  │  2D Map  │  │   3D Viewer   │  │
│  │  UI      │  │ (Leaflet)│  │ (Three.js)    │  │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │                │           │
│  ┌────┴──────────────┴────────────────┴───────┐  │
│  │            Redux Store (Zustand)            │  │
│  └────────────────────┬───────────────────────┘  │
│                       │                          │
│  ┌────────────────────┴───────────────────────┐  │
│  │  IPC Layer (ipcMain/ipcRenderer)            │  │
│  └────────────────────┬───────────────────────┘  │
│                       │                          │
│  ┌────────────────────┴───────────────────────┐  │
│  │  writeCommandToFile() → spectre_cmds.sqf   │  │
│  └────────────────────┬───────────────────────┘  │
│                       │                          │
│  ┌────────────────────┴───────────────────────┐  │
│  │  watchArmaLog() ← RPT tailing (fs.watchFile │  │
│  │  + 1s polling fallback)                     │  │
│  └────────────────────┬───────────────────────┘  │
└───────────────────────┼──────────────────────────┘
          file write    │              ▲ file read
          (cmds.sqf)    ▼              │ (RPT log)
┌─────────────────┐          ┌─────────────────┐
│ spectre_ext_x64 │          │    Arma 3       │
│    .dll         │◄─────────│  (game engine)  │
│  (file reader)  │ callExt  │  SQF scripts    │
└─────────────────┘          └─────────────────┘
```

**Two independent data channels:**
- **App → Arma:** Electron writes `spectre_cmds.sqf` → DLL reads file via `callExtension` → SQF parses and executes
- **Arma → App:** SQF writes to Arma RPT via `diag_log` → Electron tails RPT file → parses unit data → sends to React renderer

---

## 1. Arma ↔ Electron Bridge Pipeline

### 1.1 Command Flow (App → Arma)

**Step 1: User triggers command in UI**
- User clicks a button (HOLD, RTB, WEAPONS_FREE, etc.) or uses radial menu / target mode
- React component calls `sendCommand(cmd)` via the preload bridge

**Step 2: IPC sends command to main process**
- `preload.js` exposes `window.spectreAPI.sendCommand(cmd)` via `ipcRenderer.send('send-command', cmd)`
- Note: uses `ipcRenderer.send` (async), NOT `ipcRenderer.invoke` (async/await). This is intentional — fire-and-forget.
- `cmd` is an object like `{ type: 'MOVE_TO', unit_id: 'SPECTRE_0', x: 5000, y: 6000 }`

**Step 3: Main process writes SQF file**
- `electron/main.js` `ipcMain.on('send-command')` handler receives the command
- Calls `writeCommandToFile(cmd)` which:
  1. Builds SQF content via `buildSQFContent([cmd])`
  2. Writes to `@SPECTRE\addons\spectre_cmds.sqf` on disk
  3. Logs to `cmdlog.txt` for debugging

**Step 4: SQF reads file via DLL (every 0.3s)**
- `SPECTRE_fnc_readCommands` in `fn_bridgeInit.sqf` runs every 0.3s
- Calls `"spectre_ext" callExtension ["READ", ["addons\spectre_cmds.sqf"]]`
- The DLL resolves the path relative to its own location (`@SPECTRE\`) and returns the file content as a string
- Content-based dedup: skips if file content hasn't changed since last read (`SPECTRE_lastSQF`)

**Step 5: SQF parses and executes**
- Extracts the argument array from the string (everything before ` call SPECTRE_fnc_execCmd;`)
- Uses `call compile` on the argument array ONLY (safe — it's just numbers, strings, and nested arrays)
- Calls `SPECTRE_fnc_execCmd` directly with the parsed array
- Units receive orders (move, hold, engage, etc.)

### 1.2 SQF File Format

The file `spectre_cmds.sqf` contains SQF code that calls `SPECTRE_fnc_execCmd` directly:

```sqf
// Simple commands (HOLD, RTB, WEAPONS_FREE, etc.)
[1784891871132, "HOLD", "SPECTRE_0"] call SPECTRE_fnc_execCmd;

// Positional commands (MOVE_TO, ATTACK_POS, LAND_AT, SMOKE_AT, ADJUST_FIRE)
[1784891871132, "MOVE_TO", "SPECTRE_0", [[5000,6000]]] call SPECTRE_fnc_execCmd;

// Complex commands (EXECUTE_ORDER with waypoints, ROE, action)
[1784891871132, "EXECUTE_ORDER", "SPECTRE_0", [[5000,6000],[6000,7000]], "ENGAGE IF FIRED", "Assault OBJ Alpha"] call SPECTRE_fnc_execCmd;
```

**`buildSQFContent` generates this format in `electron/main.js`.**

### 1.3 Command Types

| Command | Arguments | Description |
|---------|-----------|-------------|
| HOLD | unit_id | Unit holds position (doStop) |
| RTB | unit_id | Unit returns to spawn position |
| HOLD_ALL | (none) | All units hold |
| RTB_ALL | (none) | All units RTB |
| WEAPONS_FREE | unit_id | All units: RED combat, COMBAT behavior |
| WEAPONS_SAFE | unit_id | All units: BLUE combat, AWARE behavior |
| FORM_UP | unit_id | All alive units move to first unit's position |
| DISPERSE | unit_id | All units move to random offset ±40m |
| EXECUTE_ORDER | unit_id, waypoints[], roe, action | Set waypoints + ROE + order label |
| CUSTOM | unit_id, instruction | Set custom order label |
| MOVE_TO | unit_id, x, y | Unit moves to position (driver doMove) |
| ATTACK | unit_id, target_id | Unit attacks named target object |
| ATTACK_POS | unit_id, x, y | Creates temp target object, unit fires at it |
| ARTILLERY_STRIKE | unit_id, x, y, rounds, ammoType | Unit fires at position |
| LAND_AT | unit_id, x, y | Helicopter lands at position |
| SMOKE_AT | unit_id, x, y | Creates smoke grenade at position |
| ADJUST_FIRE | unit_id, x, y | Unit targets temp object (no fire) |
| HOVER | unit_id | Helicopter hovers at 50m |

### 1.4 Reading Data from Arma (Arma → App)

Unit positions and state are sent from Arma to the Electron app via the RPT log file.

**How it works:**
1. `SPECTRE_fnc_broadcastState` runs every 0.5s in Arma (via `diag_tickTime` wall-clock loop)
2. It calls `diag_log` to write structured JSON lines to the Arma RPT log:
   - `SPECTRE_META:{...}` — map name, mission folder, timestamp
   - `SPECTRE_UNIT:{...}` — one line per unit (id, position, health, heading, etc.)
   - `SPECTRE_CONTACT:{...}` — one line per spotted enemy
   - `SPECTRE_EVENTS:[...]` — death/spotted events
3. Electron's `watchArmaLog()` tails the RPT file:
   - `fs.watchFile` with 500ms interval detects file size changes
   - 1s polling fallback catches any missed events
   - `readNewLogData()` reads new bytes from the file
   - `parseArmaLog()` matches regex patterns for SPECTRE_UNIT, SPECTRE_CONTACT, etc.
   - Accumulates units in `pendingState`, flushes to renderer every chunk
4. `sendToRenderer('arma-state-update', data)` sends data to React
5. `processArmaUpdate()` in the Zustand store merges units and sets `armaConnected: true`

**Key SQF functions:**
- `SPECTRE_fnc_bridgeInit` — Main bridge init (runs once via CBA PostInit)
- `SPECTRE_fnc_broadcastState` — Serializes all units and writes to RPT
- `SPECTRE_fnc_serializeUnit` — Converts one unit to JSON string
- `SPECTRE_fnc_execCmd` — Executes commands received from app
- `SPECTRE_fnc_readCommands` — Reads commands file via DLL, parses, dispatches
- `SPECTRE_fnc_detectEvents` — Detects unit deaths and enemy contacts
- `SPECTRE_fnc_vehicleType` — Classifies unit as HELI, TANK, IFV, CAR, INFANTRY, etc.

### 1.5 File Paths

| File | Location | Purpose |
|------|----------|---------|
| `spectre_cmds.sqf` | `E:\Games\Arma 3\@SPECTRE\addons\` | Commands from app to Arma (written by Electron, read by DLL) |
| `SPECTRE_lastSQF` | In-memory (SQF global) | Content dedup cache (prevents re-executing same command) |
| `stratis_height.png` | `public\maps\` | 512×512 heightmap |
| `stratis_roads.bin` | `public\maps\` | Road network binary (5,202 segments) |
| `stratis_objects.bin` | `public\maps\` | 92K terrain objects binary |
| Arma RPT log | `%LOCALAPPDATA%\Arma 3\Arma3_x64_*.rpt` | Contains SPECTRE_UNIT/META/CONTACT lines |

---

## 2. 3D Map Viewer Architecture

The 3D viewer is a Three.js scene rendered inside a React component (`MapView3D.js`). It displays the Stratis terrain with satellite imagery, terrain objects (trees, buildings, rocks), roads, and unit markers.

### 2.1 Component Structure

```
MapView3D.js
├── loadSatTiles()          — Loads 64 satellite tiles from jetelain CDN
├── buildMesh(heightImg)    — Creates terrain geometry from heightmap
├── cacheHeightmap()        — Caches heightmap pixel data for getHeightAt()
├── getHeightAt(x, y)      — Returns terrain height at Arma coordinates
├── Terrain mesh            — 256×256 grid of quads with satellite texture
├── Terrain objects         — 92K instanced meshes via Web Worker
├── Roads                   — 74 chain meshes from binary data
└── Unit markers            — Spheres/boxes for infantry/vehicles
```

### 2.2 Terrain Mesh

**Grid:** 256×256 vertices (RES=256), covering 8192×8192 Arma units (MAP=8192)

**Height sampling:**
```javascript
// Heightmap pixel value → world height
const v = pixels[(py * 512 + px) * 4]; // 0-255 from PNG
const height = Math.max(0, -157.5 + (v / 255) * 392.4) * 1.5; // EXAG
```

- Min height: -157.5m (below sea level)
- Max height: 234.9m
- Vertical exaggeration: 1.5× (EXAG) for better visual depth
- Values are Arma terrain height × 10 (exported from Eden Editor)

**Vertex positions:**
```javascript
// Arma coords → Three.js coords
x = armaX - HALF;        // Center X: 0 → -4096, 8192 → +4096
z = -(armaY - HALF);     // Center Z: Arma Y flipped (Arma Y = -Three.js Z)
y = terrainHeight;       // World Y = terrain elevation
```

**UV mapping (satellite texture):**
```javascript
u = armaX / CRS_SCALE;  // CRS_SCALE = 8226.37
v = armaY / CRS_SCALE;
```

CRS_SCALE is derived from the jetelain tile system: `tileSize / tileSizeDegrees = 226 / 0.027475 = 8226.37`. This aligns the satellite tiles with the terrain mesh.

### 2.3 Satellite Tiles

**Source:** `https://jetelain.github.io/Arma3Map/maps/stratis/{z}/{x}/{y}.png`
- Zoom level 3: 8×8 = 64 tiles
- Each tile: 226×226 pixels
- Total texture: 1808×1808 pixels

**Loading:**
```javascript
// 64 tiles loaded in parallel via Image elements
for (let ty = 0; ty < tpr; ty++) {
  for (let tx = 0; tx < tpr; tx++) {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, tx * TS, ty * TS, TS, TS); };
    img.src = `https://jetelain.github.io/Arma3Map/maps/stratis/3/${tx}/${ty}.png`;
  }
}
```

When all 64 tiles load, the canvas becomes the terrain texture. The terrain mesh material switches from vertex colors to the satellite texture.

### 2.4 Terrain Objects (Trees, Buildings, Rocks)

**Data source:** `stratis_objects.bin` — 92,675 objects exported from Arma 3

**Binary format per object (32 bytes):**
```
x:     float32  (Arma X position)
y:     float32  (Arma Y position)
z:     float32  (height offset from terrain)
dir:   float32  (heading in degrees)
w:     float32  (bounding box width)
h:     float32  (bounding box height)
d:     float32  (bounding box depth)
shape: uint8    (0=cone, 1=sphere, 2=flat, 3=box)
density: uint8  (0=sparse, 1=medium, 2=dense, 3=very_dense)
pad:   uint16   (alignment padding)
```

**Processing pipeline:**
1. `public/maps/stratis_objects.bin` fetched via HTTP
2. Buffer passed to Web Worker (`public/terrainWorker.js`)
3. Worker parses binary, groups objects by (shape, density)
4. Worker sends typed arrays back to main thread
5. Main thread creates InstancedMesh per group (one draw call per unique shape+density combo)

**Shape classification:**
| Shape | Count | Visual | Geometry |
|-------|-------|--------|----------|
| Cone (0) | 362 | Pine tree | `ConeGeometry(0.5, 1, 6)` |
| Sphere (1) | 88,932 | Deciduous tree/bush | `SphereGeometry(0.5, 6, 6)` |
| Flat (2) | 2,562 | Ground bush | `SphereGeometry(0.5, 8, 4)` (squished) |
| Box (3) | 819 | Named structure (building, fence) | `BoxGeometry(1, 1, 1)` |

**Density-based opacity:**
```javascript
const DENSITY_OPACITY = [0.35, 0.50, 0.70, 0.90];
// opacity = DENSITY_OPACITY[density] for vegetation
// opacity = 1.0 for buildings (always solid)
```

**Positioning:**
```javascript
const th = getHeightAt(x, y);           // Terrain height at object position
pos.set(x - HALF, th + z + h/2, -(y - HALF)); // Center vertically on terrain
scl.set(w, h, d);                        // Scale to bounding box
```

### 2.5 Road Rendering

**Data source:** `stratis_roads.bin` — 5,202 road segments in 74 chains

**Binary format:**
```
Header: uint32 totalSegments, uint32 totalChains
Chain lengths: totalChains × uint32
Segments: totalSegments × (x:f32, y:f32, dir:f32, w:f32)
```

**Rendering approach (independent quads):**
Each pair of consecutive road points creates an independent quad:
```javascript
// Per segment (p1 → p2):
const dx = p2.x - p1.x, dy = p2.y - p1.y;
const dl = Math.sqrt(dx*dx + dy*dy);
const nx = -dy / dl, ny = dx / dl; // Perpendicular (always 90° left of forward)

// 4 unique vertices (no sharing between segments):
// Left side at p1:  (wx1 + nx*hw, h1, wz1 + ny*hw)
// Right side at p1: (wx1 - nx*hw, h1, wz1 - ny*hw)
// Left side at p2:  (wx2 + nx*hw, h2, wz2 + ny*hw)
// Right side at p2: (wx2 - nx*hw, h2, wz2 - ny*hw)
```

**Why independent quads (not a ribbon):**
Ribbon meshes share vertices between adjacent segments. When consecutive segments point in opposite directions (sharp turns/U-turns), the shared vertex normal flips, causing the ribbon to fold over itself. Independent quads have no shared vertices → impossible to twist.

**Road width:** 10m (HALF_W = 5 per side)
**Height offset:** 2m above terrain (prevents z-fighting)
**Material:** `MeshStandardMaterial({ color: 0x999999, side: DoubleSide })`

### 2.6 Unit Markers

Updated reactively via `useEffect([units])`:
- Infantry: `SphereGeometry(6, 6, 6)` — blue sphere
- Vehicles: `BoxGeometry(16, 6, 10)` — blue box
- Dead units: same shapes but gray with 0.25 opacity

Positioned at terrain height + small offset above ground.

### 2.7 Camera Controls

- **OrbitControls** from Three.js
- WASD + Shift for fly-through movement
- Left drag: pan, Right drag: orbit, Scroll: zoom
- No damping (enableDamping: false) for constant-speed movement
- Pan speed: 2.0, Zoom speed: 1.5, Rotate speed: 1.0
- Max polar angle: π/2.1 (lightly above horizontal)
- Min distance: 5, Max distance: 20000

---

## 3. DLL Details

### 3.1 `spectre_ext_x64.dll`

The DLL is a native C++ plugin loaded by Arma 3. Its role is minimal — it is a **file reader only**. It does NOT write unit data and does NOT execute SQF.

The DLL provides:
- `RVExtension` / `RVExtensionArgs` — exported functions callable via `callExtension`
- `READ` function — reads a file relative to `@SPECTRE\` directory and returns content as string

### 3.2 How `callExtension` Works

```sqf
// In fn_bridgeInit.sqf
private _result = "spectre_ext" callExtension ["READ", ["addons\spectre_cmds.sqf"]];
```

1. Arma passes the function name `"READ"` and args `["addons\spectre_cmds.sqf"]` to the DLL
2. DLL resolves path relative to its own location: `@SPECTRE\addons\spectre_cmds.sqf`
3. DLL reads file content via `fopen_s` / `fread` / `fclose`
4. Returns content as a string in the `_result` array

### 3.3 The `call compile` Situation

`call compile` is **still used** in `SPECTRE_fnc_readCommands`, but only for parsing the argument array (not the full SQF command):

```sqf
// Extract the [...] portion from the SQF string
private _argsStr = _sqf select [0, _callIdx];
private _args = call compile _argsStr;  // Parses "[123, "MOVE_TO", "uid", [[x,y]]]"
_args call SPECTRE_fnc_execCmd;         // Direct function call
```

This is safe because `_argsStr` contains only a literal array (numbers, strings, nested arrays) — no variable references or complex SQF. The `call compile` risk described in older docs was about compiling the ENTIRE file content as SQF code, which is no longer done.

---

## 4. Data Export Pipeline

### 4.1 Heightmap Export

**Script:** `mod/addons/functions/export_terrain.sqf`
**Method:** Eden Editor debug console → Execute
**Output:** RPT file lines with terrain height values
**Conversion:** `scripts/rpt_to_heightmap.py` → `public/maps/stratis_height.png`

### 4.2 Terrain Objects Export

**Script:** `mod/addons/functions/export_all_objects.sqf` / `export_all_objects_inline.txt`
**Method:** Eden Editor debug console → Local Exec
**Output:** RPT file lines with object data
**Conversion:** `scripts/json_to_bin.py` → `public/maps/stratis_objects.bin`

### 4.3 Road Export

**Script:** `mod/addons/functions/export_roads_inline.txt`
**Method:** Eden Editor debug console → Local Exec
**Output:** RPT file lines with road positions
**Conversion:** `scripts/rpt_to_roads_bin.py` → `public/maps/stratis_roads.bin`

### 4.4 Common Pattern

All exports follow the same pattern:
1. SQF script runs in Arma (Eden Editor debug console)
2. Script uses `diag_log` to write structured lines to RPT
3. User copies RPT file path
4. Python script parses RPT with regex
5. Python converts to binary/JSON/PNG
6. Output placed in `public/maps/` for the app to serve

### 4.5 Mission File Locations

Arma 3 Eden Editor saves missions to one location, but the game reads them from another. This is important for the bridge to work.

| Purpose | Path | Notes |
|---------|------|-------|
| **Editor saves to** | `C:\Users\arpit\OneDrive\Documents\Arma 3\missions\SPECTRETEST2.Stratis\` | OneDrive-synced folder — this is where the editor writes `mission.sqm` |
| **Game reads from** | `E:\Games\Arma 3\Missions\SPECTRETEST2.Stratis\` | Non-Steam Arma install — game loads missions from here |
| **Bridge file** | `E:\Games\Arma 3\@SPECTRE\addons\spectre_cmds.sqf` | Written by Electron app, read by DLL via `callExtension` |

---

## 5. Version Management

- **Current version:** 1.11.46 (in `package.json`)
- **NEVER reuse a version number** — always bump
- Use `npm version patch --no-git-tag-version` for fixes
- Use `npm version minor --no-git-tag-version` for features

### Release Process

```bash
# 1. Build PBO (MUST be from mod\addons, NOT mod\ — see note below)
python create_pbo.py "mod\addons" SPECTREBridge.pbo

# 2. Copy PBO to Arma mod folder
copy /Y SPECTREBridge.pbo "E:\Games\Arma 3\@SPECTRE\addons\spectre_bridge.pbo"

# 3. Build React + Electron
npm run build

# 4. Commit
git add -A
git commit -m "vX.Y.Z: description"

# 5. Push
git push

# 6. Create GitHub release
gh release create vX.Y.Z --title "vX.Y.Z" --notes "description"

# 7. Upload assets (MUST include latest.yml for auto-updater)
gh release upload vX.Y.Z "dist\SPECTRE.C2-X.Y.Z.exe" "dist\SPECTRE.C2-X.Y.Z.exe.blockmap" "dist\latest.yml" --clobber
```

### PBO Build — CRITICAL

**Always pack from `mod\addons`, NOT `mod\`.**

The `$PBOPREFIX$` inside `mod\addons` is `z\spectre\addons\spectre_bridge`. When Arma loads the PBO, it maps files relative to this prefix. If you pack from `mod\`, the internal structure becomes `addons\functions\fn_bridgeInit.sqf`, which Arma maps to `z\spectre\addons\spectre_bridge\addons\functions\fn_bridgeInit.sqf` — but config.cpp references `z\spectre\addons\spectre_bridge\functions\fn_bridgeInit.sqf`. This causes "Script not found" errors.

**Correct:** `python create_pbo.py "mod\addons" SPECTREBridge.pbo`
**Wrong:** `python create_pbo.py mod SPECTREBridge.pbo`

### Auto-Updater

- Uses `electron-updater` with GitHub releases provider
- `dist/latest.yml` MUST be included in the GitHub release for auto-update to work
- Format: flat YAML with `version`, `files`, `path`, `sha512`, `releaseDate` fields
