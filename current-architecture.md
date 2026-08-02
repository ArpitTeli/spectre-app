# SPECTRE C2 — Current Architecture (v1.12.40)

> **This document describes the EXACT current implementation.** Update it whenever the bridge or pipeline changes. It is the reference for debugging command/connection issues.

## System Overview

SPECTRE C2 is an Electron desktop application that controls Arma 3 units in real-time. The app provides a 2D tactical map (Leaflet), a 3D battlespace viewer (Three.js), AI mission planning, and a command bridge that executes orders in Arma 3.

```
┌─────────────────────────────────────────────────┐
│                  Electron App                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  React   │  │  2D Map  │  │   3D Viewer   │  │
│  │  UI      │  │ (Leaflet)│  │ (Three.js)    │  │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │                │           │
│  ┌────┴──────────────┴────────────────┴───────┐  │
│  │           Redux Store (Zustand)             │  │
│  └────────────────────┬───────────────────────┘  │
│                       │ IPC (preload.js)         │
│  ┌────────────────────┴───────────────────────┐  │
│  │  Main process (electron/main.js)           │  │
│  │  • Command queue → spectre_cmds.sqf        │  │
│  │  • RPT tailer ← Arma log                   │  │
│  └───────────┬────────────────────┬──────────┘  │
└──────────────┼────────────────────┼─────────────┘
    write 1 cmd   │                   │  file read
    (pipe line)   ▼                   │  (RPT tail)
┌─────────────────┐          ┌─────────────────┐
│ spectre_ext_x64 │◄─────────│    Arma 3       │
│    .dll         │ callExt  │  SQF scripts    │
│ (READ_CLEAR)    │          │  (bridge PBO)   │
└─────────────────┘          └─────────────────┘
```

**Two independent data channels:**
- **App → Arma (commands):** Electron writes ONE pipe-delimited text line into `spectre_cmds.sqf` → DLL reads + truncates it via `callExtension ["READ_CLEAR", ...]` → SQF splits the line and executes.
- **Arma → App (telemetry):** SQF writes structured JSON lines to the Arma RPT via `diag_log` → Electron tails the RPT → parses → React renderer.

---

## 1. Command Channel (App → Arma)

### 1.1 Command file format (plain text, ONE command per write)

`E:\Games\Arma 3\@SPECTRE\addons\spectre_cmds.sqf` contains a single line:

```
<id>|<TYPE>|<unitId>|<x1,y1;x2,y2;...>|<roe>|<action>
```

Example:
```
1785643756404|MOVE_TO|SPECTRE_23|4090,5356||NORMAL
1785643756404|ATTACK|SPECTRE_22|4107,5375|HOSTILE-0|
1785643756404|KAMIKAZE|SPECTRE_26|5013,5909|HOSTILE-1|
1785643756404|WEAPONS_FREE|ALL|||
```

Fields:
| Field | Meaning |
|-------|---------|
| `id` | Command id (integer ms timestamp + random; used for diagnostics/acks) |
| `TYPE` | Command type (MOVE_TO, ATTACK, KAMIKAZE, HOLD, ...) |
| `unitId` | SPECTRE unit id (or `ALL`) |
| `x,y;...` | Waypoint list, semicolon-separated `x,y` pairs (empty for non-positional) |
| `roe` | Target id (`HOSTILE-N`) for ATTACK/KAMIKAZE; engagement rules for EXECUTE_ORDER; rounds for ARTILLERY_STRIKE |
| `action` | Speed (`speed:120`) for MOVE_TO; instruction/action for EXECUTE_ORDER/CUSTOM; ammo for ARTILLERY_STRIKE |

The app NEVER writes more than one command per file. This is deliberate: multi-command files were the source of the "first command executes, then nothing" bug across every earlier protocol.

### 1.2 App-side command path (`electron/main.js`)

**`writeCommandToFile(cmd)`** (called from the `send-command` IPC handler):
1. `isDuplicateSend(cmd)` — drops a repeat of the same type+unit+target+coords within 600ms (2D+3D maps can double-fire).
2. Assigns `cmd._id = Date.now() + Math.floor(Math.random() * 10000)` if absent.
3. Phantom check: if `buildPlainCommand(cmd)` has no `|` separator (no executable payload), logs `SKIP` and drops it.
4. Pushes to `pendingSpectreCmds` (capped at 50), logs `OK <type>` to `cmdlog.txt`.
5. Calls `advanceQueue()`.

**`buildPlainCommand(cmd)`** — converts the command object to the pipe format:
- id = `parseInt(cmd._id, 10)`
- waypoints from `cmd.waypoints` (array of `{x,y}` or `[x,y]`) or `cmd.x`/`cmd.y`, joined `;` as `x,y`
- if no waypoints and there is a `roe` target, falls back to the contact's last-known position from `pendingState.contacts[roe]`
- roe = `cmd.target_id || cmd.engagement_rules`
- action = `cmd.action || (cmd.speed != null ? "speed:N" : "")`

**`advanceQueue()`** — the ONLY writer of the command file. Driven by a 500ms `setInterval` (`startCommandQueue()`) and called after every push:
1. Stats `spectre_cmds.sqf`.
2. **Missing** (stat fails) → recreate the current command via `writePending(0)`.
3. **Non-empty** → the reader hasn't consumed it yet. Tracks `cmdsFileNonEmptySince`; if non-empty > 15s, `fs.rmSync` the file (stuck-reader reset) and return.
4. **Empty** → the previous in-flight command was consumed (see below). If `cmdsInFlight > 0`, shift it off `pendingSpectreCmds` (log `command consumed (N pending)`). Then `writePending(0)`.
5. `writePending(0)` writes `pendingSpectreCmds[0]` via `buildPlainCommand`, with EBUSY/EPERM/EACCES retry (4×). Sets `cmdsInFlight = 1`, refreshes `_writtenAt`, logs `wrote command <type> (N pending)`.

**Delivery model — consumption is the acknowledgement:**
- `READ_CLEAR` truncates the file after a successful read, so **the file becoming empty means Arma read the command** → the app drops it and sends the next. The queue advances every ~500ms, completely independent of the RPT tailer and ack parsing.
- Commands are delivered serially: a burst of 5 delivers one per ~0.5s.

**Ack parsing (diagnostics only):** `parseArmaLog` matches `Executed OK: \[(\d+)` and logs `ack <id> seen`. It does NOT affect the queue (removed in v1.12.39 because it conflicted with consumption-based advancement).

### 1.3 DLL (`spectre_ext/spectre_ext.c`, v2.0, TCC-built)

- Exports: `RVExtension`, `RVExtensionArgs`, `RVExtensionVersion` (returns `"SPECTRE Ext v2.0"`).
- `READ` — returns the file content (never truncates).
- `READ_CLEAR` — returns the content, then **truncates** the file (`fopen("wb")` + `fclose`), retried 5× with 50ms sleep so the app's concurrent write handle never lets content accumulate toward the output cap.
- `ensureBasePath()`: resolves `@SPECTRE\` from the DLL's own path (`strstr` on `"@SPECTRE"`, `spectre += 9` to keep the trailing backslash). Fallback `E:\Games\Arma 3\@SPECTRE\`.
- `readFile()`: empty file → empty string (NOT `ERR_SIZE:0`); file ≥ 10240 bytes → `ERR_SIZE:<n>`; missing → `ERR_OPEN:<path>`.
- `MAX_OUTPUT = 10240` — the file must stay under this (the app writes one small line, so it never gets close).
- The DLL is stateless; it opens/closes the file fresh on every call.

### 1.4 SQF reader (`SPECTRE_fnc_readCommands` in `fn_bridgeInit.sqf`)

Runs in a dedicated spawned loop every `SPECTRE_cmdReadRate` (0.3s):

```sqf
"spectre_ext" callExtension ["READ_CLEAR", ["addons\spectre_cmds.sqf", str diag_tickTime]]
```

- **Unique nonce** (`str diag_tickTime`) is passed as `args[1]`; the DLL uses only `args[0]`. The varying argument prevents Arma from constant-folding/caching the `callExtension` result (the root cause of "reader reads the first file forever").
- Empty/`ERR_` responses exit silently (errors are logged).
- Strips leading comment lines (`//...`) — session banner / mission-restart comment.
- Splits the line on `|`; parses `id|TYPE|unitId|x,y;...|roe|action` with `splitString` + `parseNumber`; builds `_wps` as `[[x,y],...]`.
- Dispatches `[_id, _type, _uid, _wps, _roe, _action] call SPECTRE_fnc_execCmd`.
- Logs `SPECTRE: Executed OK: <id>|<TYPE>|<uid>`.
- **Deliberately avoids** `call compile`, a per-id dedup list, and multi-line `forEach` parsing — these constructs were the unreliable ones in this environment.

### 1.5 Command types (execCmd switch)

| Command | Pipe fields | Behavior |
|---------|-------------|----------|
| HOLD | uid | `doStop` |
| RTB | uid | move to spawn position |
| HOLD_ALL / RTB_ALL | ALL | for each blufor |
| WEAPONS_FREE | uid | RED combat, COMBAT behaviour |
| WEAPONS_SAFE | uid | BLUE combat, AWARE behaviour |
| FORM_UP | uid | all alive units move to first unit's pos |
| DISPERSE | uid | random offset ±40m |
| EXECUTE_ORDER | wps, roe=engagement, action | waypoints + ROE + label |
| CUSTOM | action=instruction | set order label |
| MOVE_TO | wps, action=speed | ground: driver `doMove`; air (`isKindOf "Air"`): `_veh doMove` + `flyInHeight 50`; FPV: `SPECTRE_fnc_fpvFlyTo` (manual setVelocity flight) |
| ATTACK | roe=target_id, wps=last-known pos | resolve target → gunner `doTarget`/`doFire` + `_veh fireAtTarget [_target, "mainGun"]` |
| ATTACK_POS | wps | temp `Sign_Arrow_Red_F` target → fire |
| KAMIKAZE | wps=waypoints, roe=target_id | FPV: manual setVelocity chase (50m AGL, dive <150m, `triggerAmmo` detonation); UAV: waypoint flight + doMove chase |
| ARTILLERY_STRIKE | wps, roe=rounds, action=ammo | artillery fire |
| LAND_AT | wps | heli land |
| SMOKE_AT | wps | smoke at pos |
| ADJUST_FIRE | wps | target temp object, no fire |
| HOVER | uid | heli hover 50m |

**ATTACK target resolution (important):**
1. `SPECTRE_contactMap getOrDefault [_roe, objNull]` (stable HOSTILE-N map)
2. `missionNamespace getVariable [_roe, objNull]`
3. Fallback: create a temp `Sign_Arrow_Red_F` at the waypoint (last-known contact position)
Failure to resolve logs `SPECTRE ATTACK FAIL: ...` (never silent).

**MOVE_TO (important):**
- Ground vehicles: `driver doMove` (or `_unit doMove` if no driver).
- Air units (UAV/HELI): command the VEHICLE — `_veh doMove _pos` + `_veh flyInHeight 50` (the driver is a dummy for UAVs).
- FPV drones (D37 mod strips the AI pilot turret — `doMove` is a no-op): `SPECTRE_fnc_fpvFlyTo` steers the drone with `setVelocity` (real-time loop, 50m AGL).

**KAMIKAZE (important):**
- FPV path uses `setVelocity` steering: 60 m/s, hold 50m AGL until within 150m, then dive; detonate via `triggerAmmo` on the D37 `attachedShell` when within 10m and low; chases the target's last-known position even after the target dies. Runs on real time (`diag_tickTime` + `uiSleep 0.2`).

### 1.6 FPV manual flight (`SPECTRE_fnc_fpvFlyTo`)

The D37 FPV config (`B_FPV_UAV`) empties `class Turrets {}` and sets `hasGunner = 0`, so there is no AI pilot and `doMove`/`flyInHeight` are no-ops. The helper steers with:
```sqf
_drone setVelocity [dx*speed, dy*speed, vz];       // vz holds altitude toward target
_drone setVectorDirAndUp [horizontalDir, [0,0,1]];
_drone flyInHeight 0;
```
Real-time loop (`uiSleep 0.2`), ends when within 15m or timeout.

---

## 2. Telemetry Channel (Arma → App)

### 2.1 SQF broadcast loop

A spawned loop (separate from the reader loop) runs every `SPECTRE_broadcastRate` (0.5s), driven by `diag_tickTime` (wall-clock, immune to simulation throttle) + `uiSleep 0.1`:

**`SPECTRE_fnc_broadcastState`** writes via `diag_log`:
- `SPECTRE_META:{"map":..., "mf":..., "path":..., "ts":...}` — map, mission folder, path, timestamp
- `SPECTRE_UNIT:{...}` — one line per blufor unit (id, vtype, pos+lat/lng, hdg, hp, fuel, speed, ammo, crew, order, status)
- `SPECTRE_CONTACT:{...}` — one line per spotted enemy (stable HOSTILE-N id, type, position, state, source)
- `SPECTRE_EVENTS:[...]` — death/spotted events

**Stable contact ids (critical for ATTACK/KAMIKAZE):** `SPECTRE_contactMap` is rebuilt each broadcast. Each enemy object gets a persistent id on first sighting: `_e setVariable ["SPECTRE_cid", format ["HOSTILE-%1", _ci]]` — the id is REUSED for the enemy's whole life, so ids never shift when the enemy set changes. Dead enemies drop out of the map (the app's position fallback covers stale targets).

### 2.2 App RPT tailer (`startBridgeWatcher`)

- `initWatchArmaLog()` — picks the newest `Arma3_x64_*.rpt`; `fs.watchFile` (500ms) + a 1s polling interval (`readNewLogData`) for missed events; on a new RPT file, calls `clearSpectreCommandFile('new Arma session detected')` (writes the banner) and resets the tail position.
- **TAIL-alive heartbeat**: a 5s interval logs `TAIL alive - path=... pos=...` so a dead tailer is visible in debug.log immediately.
- `readNewLogData()` — reads new bytes from the RPT, splits into lines (carrying an unterminated final line across reads via `logLineBuffer`), calls `parseArmaLog`.
- **`parseArmaLog()`** — every line is processed inside its own `try/catch` (a malformed line can never abort a chunk and skip subsequent acks/broadcasts). Matches: `Executed OK: [id` (ack log), `SPECTRE_META`, `SPECTRE_UNIT`, `SPECTRE_CONTACT`, `SPECTRE_EVENTS`, legacy `SPECTRE_STATE`. Flushes accumulated state to the renderer (`arma-state-update`) when a batch is complete.
- **Intro-scene handling:** METAs with `mf` starting `scenes\` set `pendingState.isScene = true`, which suppresses the FLUSH (cinematic placeholder units never reach the map). The `introExp` scene runs before the real mission, so the bridge initializes twice (intro + mission) — the second init's `clearSpectreCommandFile`/mission-change clear resets the command file and buffer.
- **Mission-change clear:** when a META's `mf` differs from the tracked `missionFolder`, the app writes the banner + `// SPECTRE — mission restarted` into the command file, clears units/contacts/events, and clears `pendingSpectreCmds`.

### 2.3 App state flow

`parseArmaLog` → `pendingState` (units/contacts/events) → FLUSH → `sendToRenderer('arma-state-update', data)` → Zustand store `processArmaUpdate()` → `armaConnected: true` + unit markers on the map.

---

## 3. Key SQF functions (`mod/addons/functions/fn_bridgeInit.sqf`)

| Function | Role |
|----------|------|
| `SPECTRE_fnc_bridgeInit` | Runs once via CfgFunctions `postInit=1` (no CBA dependency; the intro scene runs it too). Sets up globals and spawns the two loops. |
| `SPECTRE_fnc_readCommands` | Reads + consumes the command file (READ_CLEAR + nonce), splits the pipe line, dispatches to execCmd. |
| `SPECTRE_fnc_execCmd` | `params ["_id","_type","_unitId","_waypoints","_roe","_action"]`; the big switch of command handlers. Logs `SPECTRE CMD: <type> -> <uid>` first. |
| `SPECTRE_fnc_broadcastState` | Writes META/UNIT/CONTACT/EVENTS lines; rebuilds `SPECTRE_contactMap` with stable ids. |
| `SPECTRE_fnc_serializeUnit` | Unit → JSON line. |
| `SPECTRE_fnc_serializeContact` | Enemy → JSON contact line. |
| `SPECTRE_fnc_detectEvents` | Deaths / newly-spotted enemies → events array. |
| `SPECTRE_fnc_vehicleType` | Classifies: FPV (class contains "FPV"), UAV (`isKindOf "UAV_01_base_F"`), STOMPER (UGV_01), ED1 (UGV_02), HELI, PLANE, BOAT, TRUCK, TANK, IFV, CAR, INFANTRY. |
| `SPECTRE_fnc_fpvFlyTo` | Manual setVelocity flight for AI-less FPV drones. |
| `SPECTRE_fnc_execCmd` | See 1.5. |

**Globals:** `SPECTRE_blufor` (unit array), `SPECTRE_contactMap` (HashMap HOSTILE-N → object), `SPECTRE_execCmdIds` (legacy dedup list — initialized but no longer used for dedup; kept for diagnostics in the reader beat), `SPECTRE_mapData` (lat/lng origin + meters-per-degree), `SPECTRE_broadcastRate` (0.5), `SPECTRE_cmdReadRate` (0.3), `SPECTRE_initialized`.

**Main loop / reader loop:** two `[] spawn { while {true} ... }` scripts. Broadcast loop: hint refresh every 20s + broadcast every 0.5s. Reader loop: read every 0.3s + `reader beat: cmdIds=N` log every 30s. Each call is wrapped in `try/catch` that logs `SPECTRE broadcast error` / `SPECTRE readCommands error`.

---

## 4. DLL Details

### 4.1 `spectre_ext_x64.dll`

- Native C extension (compiled with TCC: `tcc -shared -o spectre_ext_x64.dll spectre_ext.c`). MSVC `_s` functions are NOT used (TCC-incompatible).
- Deployed to `E:\Games\Arma 3\@SPECTRE\spectre_ext_x64.dll` (the copy the game loads) and `E:\Games\Arma 3\@SPECTRE\addons\spectre_ext_x64.dll`.
- `RVExtensionArgs` handles `READ` and `READ_CLEAR`; unknown function → `ERR_BAD_CALL:func=...`.
- Path resolution: the DLL derives `@SPECTRE\` from its own location (the `spectre += 9` fix is essential — `+= 8` produces `...@SPECTREaddons\...` and breaks everything).
- Empty file → empty string (normal consume state); oversize (≥10240) → `ERR_SIZE`; missing → `ERR_OPEN`.

### 4.2 `callExtension` caching pitfall (critical)

`callExtension` with identical literal arguments can be constant-folded/cached by Arma, returning the first result forever. **Every reader call must pass a unique argument** (`str diag_tickTime` as `args[1]`). Do not "optimize" this away.

---

## 5. File Paths

| File | Location | Purpose |
|------|----------|---------|
| `spectre_cmds.sqf` | `E:\Games\Arma 3\@SPECTRE\addons\` | One pipe-delimited command line (written by app, consumed by DLL). |
| `spectre_bridge.pbo` | `E:\Games\Arma 3\@SPECTRE\addons\` | The bridge addon (config.cpp + fn_bridgeInit.sqf + helpers). Packed from `mod\addons`. |
| `spectre_ext_x64.dll` | `E:\Games\Arma 3\@SPECTRE\` + `addons\` | The extension DLL. |
| `mod.cpp` | `E:\Games\Arma 3\@SPECTRE\` | Mod metadata (must end lines with `;`). |
| `cmdlog.txt` | `%APPDATA%\spectre-arma\` | Every command write: `OK/FAIL/SKIP <type>`. |
| `debug.log` | `%APPDATA%\spectre-arma\` | App diagnostics: FLUSH, TAIL alive, wrote/consumed commands, errors. |
| Arma RPT | `%LOCALAPPDATA%\Arma 3\Arma3_x64_*.rpt` | SPECTRE_UNIT/META/CONTACT + reader logs + SQF errors. |
| `stratis_height.png` | `public\maps\` | 512×512 heightmap |
| `stratis_roads.bin` | `public\maps\` | Road network binary |
| `stratis_objects.bin` | `public\maps\` | Terrain objects binary |

---

## 6. 3D Map Viewer Architecture

*(unchanged — see original doc sections; key points preserved below)*

- Three.js scene in `MapView3D.js`: satellite tiles from jetelain CDN, terrain mesh from `stratis_height.png`, 92K instanced objects via `terrainWorker.js`, roads from `stratis_roads.bin`, unit markers (spheres=infantry, boxes=vehicles, gray+0.25 opacity=dead).
- Coordinate mapping: `x = armaX - 4096`, `z = -(armaY - 4096)`, `y = terrainHeight` (1.5× vertical exaggeration).
- Camera: OrbitControls, WASD+Shift fly, no damping.

## 7. Data Export Pipeline

Editor scripts in `mod/addons/functions/` (`export_terrain.sqf`, `export_all_objects.sqf`, `export_roads_inline.txt`) → RPT → Python (`scripts/`) → `public/maps/`.

## 8. Mission Files

| Purpose | Path |
|---------|------|
| Editor saves to | `C:\Users\arpit\OneDrive\Documents\Arma 3\missions\SPECTRETEST2.Stratis\` |
| Game reads from | `E:\Games\Arma 3\Missions\SPECTRETEST2.Stratis\` |
| Bridge command file | `E:\Games\Arma 3\@SPECTRE\addons\spectre_cmds.sqf` |

---

## 9. Version Management & Release

- Current version in `package.json`; NEVER reuse a version number.
- The mission has an intro scene (`introExp`) before `SPECTRETEST2`; the bridge inits in both — the app's scene handling and command-file clear make this safe.

**Release process:**
```bash
# 1. Rebuild the DLL (only if spectre_ext.c changed)
tcc -shared -o spectre_ext\spectre_ext_x64.dll spectre_ext\spectre_ext.c
# 2. Build the PBO (from mod\addons, NOT mod\)
python create_pbo.py "mod\addons" "mod\addons\spectre_bridge.pbo"
# 3. Deploy to @SPECTRE (Arma must be closed)
copy mod\addons\spectre_bridge.pbo "E:\Games\Arma 3\@SPECTRE\addons\"
copy spectre_ext\spectre_ext_x64.dll "E:\Games\Arma 3\@SPECTRE\" + addons\
copy mod\mod.cpp "E:\Games\Arma 3\@SPECTRE\mod.cpp"
# 4. Build app
npm run build
# 5. Commit + push + release (app + mod; include latest.yml)
```

**Diagnostic quick-reference (what to check when something breaks):**
- **Not connected (no units):** RPT for `CallExtension loaded ... [SPECTRE Ext v2.0]` and `SPECTRE: Bridge running`; debug.log for `TAIL alive`.
- **Commands not executing:** debug.log `wrote command X (N pending)` → `command consumed (N pending)`; RPT `SPECTRE read: malformed command [...]` (format mismatch) or `SPECTRE readCommands DLL error` (DLL/path).
- **SQF compile errors:** RPT shows `Error in expression` + `File ...fn_bridgeInit.sqf, line N` — the ENTIRE bridge dies (no broadcasts). Avoid `exitWith` inside `if-then` blocks and the `weapon` command in assignments (both are SQF compile breakers seen in this project).
