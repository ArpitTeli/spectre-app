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
│  │         IPC Layer (ipcMain/ipcRenderer)     │  │
│  └────────────────────┬───────────────────────┘  │
│                       │                          │
│  ┌────────────────────┴───────────────────────┐  │
│  │    writeCommandToFile() → spectre_cmds.sqf  │  │
│  └────────────────────┬───────────────────────┘  │
└───────────────────────┼──────────────────────────┘
                        │ file write
                        ▼
              ┌─────────────────┐
              │ spectre_ext_x64 │  (DLL)
              │    .dll         │
              │  callExtension  │
              └────────┬────────┘
                       │ SQF execution
                       ▼
              ┌─────────────────┐
              │    Arma 3       │
              │  (game engine)  │
              └─────────────────┘
```

---

## 1. Arma ↔ Electron Bridge Pipeline

This is the most critical and fragile part of the system. Getting reliable command execution from the app into Arma required extensive debugging.

### 1.1 Command Flow (App → Arma)

**Step 1: User triggers command in UI**
- User clicks a button (HOLD, RTB, WEAPONS_FREE, etc.) in the SidePanel
- React component calls `sendCommand(unitId, commandType)` via the preload bridge

**Step 2: IPC sends command to main process**
- `preload.js` exposes `window.electron.sendCommand(unitId, command)` via `ipcRenderer.send('send-command', { unitId, command })`
- Note: uses `ipcRenderer.send` (async), NOT `ipcRenderer.invoke` (async/await). This is intentional — fire-and-forget.

**Step 3: Main process writes SQF file**
- `electron/main.js` `ipcMain.on('send-command')` handler receives the command
- Calls `writeCommandToFile(unitId, command)` which:
  1. Builds SQF content via `buildSQFContent(unitId, command)`
  2. Writes to `addons\spectre_cmds.sqf` on disk
  3. Also updates `SPECTRE_lastSQF` for content-based dedup

**Step 4: DLL reads and executes SQF**
- `spectre_ext_x64.dll` polls `addons\spectre_cmds.sqf` for changes
- When file content changes, it reads and executes the SQF
- Uses `callExtension` to pass the SQF string to Arma's engine

**Step 5: Arma executes SQF**
- The SQF runs in Arma's scripting environment
- Commands like `SPECTRE_fnc_execCmd` are called with the parsed arguments
- Units receive orders (move, hold, engage, etc.)

### 1.2 What We Changed (Critical Fixes)

#### Problem 1: `call compile` was unreliable

**Original code (BROKEN):**
```sqf
// In fn_bridgeInit.sqf
_sqf = ...; // read from file
call compile _sqf;  // THIS WAS THE PROBLEM
```

`call compile` in Arma is unreliable for dynamic SQF strings, especially when the string contains:
- Variable references that don't exist at compile time
- Nested quotes
- Complex array syntax

**Fix: Manual SQF parsing + direct function call**
```sqf
// In fn_bridgeInit.sqf — REPLACED call compile
_command = ...; // parsed command name
_args = ...;   // parsed argument array
_args call SPECTRE_fnc_execCmd;  // Direct function call
```

The DLL now parses the SQF file manually:
1. Reads the file content
2. Splits by newline to get individual commands
3. For each line, extracts command name and arguments
4. Calls `SPECTRE_fnc_execCmd` directly with the arguments array

This eliminated all `call compile` errors.

#### Problem 2: ID-based dedup caused stale commands

**Original approach:**
```javascript
// Each command got a unique ID
const cmdId = Date.now();
// File content: SPECTRE_CMD:1721234567890:HOLD:alpha_1
```

The DLL tracked which IDs it had seen and skipped duplicates. But:
- If Arma was slow to process, the DLL might skip a valid command
- If the file was rewritten before the DLL read it, commands got lost
- Race conditions between write and read

**Fix: Content-based dedup**
```javascript
// In main.js
const SPECTRE_lastSQF = { current: '' };

function writeCommandToFile(unitId, command) {
  const content = buildSQFContent(unitId, command);
  if (content === SPECTRE_lastSQF.current) return; // skip if identical
  SPECTRE_lastSQF.current = content;
  fs.writeFileSync(spectreCmdsPath, content);
}
```

The DLL also compares full file content string, not IDs. If the file content hasn't changed, it skips execution. This is simpler and eliminates race conditions.

### 1.3 Reading Data from Arma (Arma → App)

The app also reads data from Arma, but through a different mechanism:

**Bridge Initialization:**
1. DLL writes marker file when Arma loads the mod
2. App detects marker → starts polling for unit data
3. Unit positions are written by Arma's `SPECTRE_fnc_bridgeInit` SQF
4. App reads the file and updates the Redux store
5. React components re-render with new positions

**Key SQF functions:**
- `SPECTRE_fnc_bridgeInit` — Main bridge loop, runs every tick
- `SPECTRE_fnc_execCmd` — Executes commands received from app
- `SPECTRE_fnc_readCommands` — Reads commands file, parses, dispatches

### 1.4 The `addons\spectre_cmds.sqf` File Format

This is the communication channel between the app and Arma. Every command goes through this file.

**Current format (v2 — content-based):**
```sqf
SPECTRE_EXEC:unit_id:command_name:arg1:arg2:...
```

Example:
```sqf
SPECTRE_EXEC:alpha_1:HOLD
SPECTRE_EXEC:alpha_1:RTB
SPECTRE_EXEC:alpha_1:WEAPONS_FREE
SPECTRE_EXEC:alpha_1:FORM_UP:formation_name
```

**Command types implemented:**
| Command | Arguments | Description |
|---------|-----------|-------------|
| HOLD | unit_id | Unit holds position |
| RTB | unit_id | Unit returns to base |
| HOLD_ALL | (none) | All units hold |
| RTB_ALL | (none) | All units RTB |
| WEAPONS_FREE | unit_id | Unit engages freely |
| WEAPONS_SAFE | unit_id | Unit holds fire |
| FORM_UP | unit_id, formation | Unit forms up |
| DISPERSE | unit_id | Unit disperses |
| EXECUTE_ORDER | unit_id, order | Execute specific order |
| CUSTOM | unit_id, custom_data | Custom command |

### 1.5 File Paths

| File | Location | Purpose |
|------|----------|---------|
| `spectre_cmds.sqf` | `addons\` (Arma mission folder) | Commands from app to Arma |
| `SPECTRE_lastSQF` | In-memory (main.js) | Content dedup cache |
| `stratis_height.png` | `public\maps\` | 512×512 heightmap |
| `stratis_roads.bin` | `public\maps\` | Road network binary |
| `stratis_objects.bin` | `public\maps\` | 92K terrain objects binary |

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

**Rendering approach (v1.11.15 — independent quads):**
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
- Max polar angle: π/2.1 (slightly above horizontal)
- Min distance: 5, Max distance: 20000

---

## 3. DLL Bridge Details

### 3.1 `spectre_ext_x64.dll`

The DLL is a native C++ plugin loaded by Arma 3. It handles:
- Reading `spectre_cmds.sqf` file for commands from the app
- Writing unit position data for the app to read
- Executing SQF via `callExtension`

### 3.2 Key Functions in `spectre_ext.c`

```
// Main bridge initialization
SPECTRE_fnc_bridgeInit.sqf:
  - Runs every tick in Arma
  - Calls callExtension to read commands
  - Dispatches to SPECTRE_fnc_execCmd

// Command execution
SPECTRE_fnc_execCmd:
  - Takes [unit_id, command, args] array
  - Calls appropriate SQF function per command type
  - Returns success/failure

// Command reading (direct parsing, no call compile)
SPECTRE_fnc_readCommands:
  - Reads addons/spectre_cmds.sqf
  - Parses each line manually
  - Extracts command name + arguments
  - Calls SPECTRE_fnc_execCmd with parsed args
```

### 3.3 Why `call compile` Was Removed

`call compile` in Arma is a function that parses and executes a string as SQF code. It was the original approach but caused repeated failures:

1. **Variable scoping:** `call compile` creates a new scope. Variables from the outer scope aren't accessible unless passed explicitly.
2. **String escaping:** SQF strings within strings (nested quotes) required triple-quoting, which was fragile.
3. **Error handling:** `call compile` failures were silent — no error message, just no execution.
4. **Timing:** Arma's scheduler could interrupt `call compile` mid-execution, leaving partial commands.

The fix: parse the file content manually (split by delimiters, extract fields) and call functions directly with pre-built argument arrays. This is deterministic and doesn't depend on Arma's parser.

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
| **Bridge file** | `E:\Games\Arma 3\Missions\SPECTRETEST2.Stratis\spectre_cmds.sqf` | Written by our app, read by the DLL — lives in the game folder, NOT the editor folder |

**Important:** When copying updated missions from editor to game folder, always preserve `spectre_cmds.sqf` — it's the bridge communication channel and should never be overwritten.

**To sync a new mission version:**
1. Copy `mission.sqm` from OneDrive editor folder to game Missions folder
2. Do NOT overwrite `spectre_cmds.sqf`
3. No Arma relaunch needed — just restart the mission

---

## 5. Version Management

- **Current version:** 1.11.15 (in `package.json`)
- **NEVER reuse a version number** — always bump
- Use `npm version patch --no-git-tag-version` for fixes
- Use `npm version minor --no-git-tag-version` for features

### Release Process

```bash
# 1. Build PBO (MUST be from mod\addons, NOT mod\ — see note below)
python create_pbo.py "mod\addons" SPECTREBridge.pbo

# 2. Build React app
npx react-scripts build

# 3. Build Electron installer
npx electron-builder --win

# 4. Commit
git add -A
git commit -m "vX.Y.Z: description"

# 5. Push
git push

# 6. Create GitHub release
gh release create vX.Y.Z --title "vX.Y.Z" --notes "description"

# 7. Upload assets
gh release upload vX.Y.Z "dist\SPECTRE.C2-X.Y.Z.exe" "dist\SPECTRE.C2-X.Y.Z.exe.blockmap" "dist\latest.yml" --clobber
```

### PBO Build — CRITICAL

**Always pack from `mod\addons`, NOT `mod\`.**

The `$PBOPREFIX$` inside `mod\addons` is `z\spectre\addons\spectre_bridge`. When Arma loads the PBO, it maps files relative to this prefix. If you pack from `mod\`, the internal structure becomes `addons\functions\fn_bridgeInit.sqf`, which Arma maps to `z\spectre\addons\spectre_bridge\addons\functions\fn_bridgeInit.sqf` — but config.cpp references `z\spectre\addons\spectre_bridge\functions\fn_bridgeInit.sqf`. This causes "Script not found" errors.

**Correct:** `python create_pbo.py "mod\addons" SPECTREBridge.pbo`
**Wrong:** `python create_pbo.py mod SPECTREBridge.pbo`

### Auto-Updater

- Uses `electron-updater` with GitHub releases provider
- `dist/latest.yml` must include `releaseDate` field
- Format: flat YAML (not nested)
