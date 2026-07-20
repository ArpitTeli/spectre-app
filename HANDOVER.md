# SPECTRE C2 — Project Handover Document

> **Version:** 1.2.0  
> **Last Updated:** 2026-07-20  
> **Repository:** `spectre-fixed` (GitHub: ArpitTeli/spectre-app)  
> **License:** Proprietary  

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [File-by-File Reference](#4-file-by-file-reference)
5. [Feature Inventory](#5-feature-inventory)
6. [Arma 3 Bridge System](#6-arma-3-bridge-system)
7. [AI Service](#7-ai-service)
8. [Map System](#8-map-system)
9. [Known Bugs](#9-known-bugs)
10. [Design System](#10-design-system)
11. [Build & Distribution](#11-build--distribution)
12. [Configuration & Data Paths](#12-configuration--data-paths)
13. [Future Roadmap](#13-future-roadmap)
14. [Developer Notes](#14-developer-notes)

---

## 1. Project Overview

### What It Is

SPECTRE C2 is an **AI-powered Command & Control application** for Arma 3. It runs as a desktop Electron app alongside Arma 3, providing a commander with:

- A real-time tactical map displaying friendly units and enemy contacts
- AI-generated Operations Orders (OPORDs) and Courses of Action (COAs)
- Live unit command and control (HOLD, RTB, WEAPONS FREE, custom orders)
- Mid-mission AI adaptation when battlefield events occur
- After-Action Reviews (AARs) with reward scoring
- Persistent intelligence databases across missions

SPECTRE bridges to Arma 3 via a **file-based protocol**: it tails the Arma RPT log file for state data and writes SQF command files into the active mission folder.

### Target Audience

- Arma 3 mission makers who want an AI C2 system for Zeus or SP scenarios
- Arma 3 groups wanting a tactical planning overlay
- MilSim communities running organized operations
- Solo players wanting AI-assisted command gameplay

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Electron + React | Cross-platform desktop, rich UI, npm ecosystem |
| File-based bridge (no DLL injection) | Non-invasive, no BattlEye concerns, works with any Arma 3 setup |
| OpenRouter as default AI provider | Free tier models available, key rotation for rate limits |
| Leaflet for mapping | Lightweight, supports custom CRS needed for Arma 3 coordinate systems |
| No state management library | `useSpectreStore` uses raw React hooks to avoid Redux/Zustand dependency |
| Hidden title bar with custom controls | Military/C2 aesthetic, maximizes screen real estate |
| CBA_A3 dependency for mod | Standard Arma 3 addon framework, XEH for auto-initialization |
| PBO built via Python script | No external tools needed (MicMac/PBOManager), self-contained build |

---

## 2. Architecture

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SPECTRE C2 (Electron)                        │
│                                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │ Renderer │◄──►│  preload.js  │◄──►│       main.js            │  │
│  │ (React)  │    │ (contextBridge│    │  - IPC handlers          │  │
│  │          │    │  14 APIs)     │    │  - Bridge watcher        │  │
│  │ App.js   │    └──────────────┘    │  - Command queue         │  │
│  │ Store    │                        │  - Auto-updater          │  │
│  │ AI Svc   │                        │  - Arma path detection   │  │
│  └────┬─────┘                        └────────────┬─────────────┘  │
│       │                                           │                │
│       │ IPC (invoke/send)                         │ File I/O       │
│       │                                           │                │
└───────┼───────────────────────────────────────────┼────────────────┘
        │                                           │
        │                                     ┌─────▼──────────┐
        │                                     │  File System   │
        │                                     │                │
        │              ┌──────────────────────┤ config.json    │
        │              │                      │ debug.log      │
        │              │                      │ missions/      │
        │              │                      │ intel/         │
        │              │                      │ bridge/        │
        │              │                      └───────┬────────┘
        │              │                              │
   ┌────▼──────┐  ┌───▼──────────────┐        ┌──────▼──────────────┐
   │ aiService │  │ armaDetector.js  │        │  Arma 3 Documents   │
   │           │  │                  │        │  \SPECTRE\          │
   │ OpenRouter│  │ - Registry       │        │  arma_to_spectre    │
   │ API calls │  │ - VDF parse      │        │  .json (legacy)     │
   │           │  │ - RPT log find   │        └─────────────────────┘
   └───────────┘  └──────────────────┘
                                   ┌──────────────────────────────────┐
                                   │     Arma 3 Game Process           │
                                   │                                  │
                                   │  @SPECTRE mod (PBO)              │
                                   │  ├─ fn_bridgeInit.sqf           │
                                   │  │  ├─ Broadcasts state via      │
                                   │  │  │  diag_log → RPT file      │
                                   │  │  ├─ Reads commands from       │
                                   │  │  │  spectre_to_arma.sqf      │
                                   │  │  └─ Main loop: 1s broadcast,  │
                                   │  │     0.75s command read        │
                                   │  └─ XEH_postInit.sqf            │
                                   │     └─ Calls bridgeInit          │
                                   └──────────────────────────────────┘

DATA FLOW:
  Arma 3 → diag_log → RPT file → main.js tails log → parseArmaLog()
         → IPC 'arma-state-update' → React store → MapView + SidePanel

  SPECTRE → IPC 'send-command' → main.js queueCommand()
          → buildSQFContent() → writes spectre_to_arma.sqf to mission folder
          → Arma 3 fn_readCommands reads + compiles SQF
```

### Bridge Protocol

The bridge is **asynchronous and file-based**:

- **Arma → SPECTRE:** The Arma mod uses `diag_log` to write structured JSON lines into the RPT log file. SPECTRE's Electron main process tails this file with chokidar (polling at 500ms) and parses lines matching `SPECTRE_META:`, `SPECTRE_UNIT:`, `SPECTRE_CONTACT:`, `SPECTRE_EVENTS:`, or legacy `SPECTRE_STATE:`.

- **SPECTRE → Arma:** SPECTRE writes SQF commands to `spectre_to_arma.sqf` in the active mission folder. The Arma mod's main loop reads this file every 0.75 seconds using `loadFile` + `call compile`.

- **Deduplication:** The Arma side tracks executed command IDs in `SPECTRE_executedCmds` array (capped at 600 entries, trimmed to last 300).

---

## 3. Tech Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.3.1 | UI framework |
| React DOM | 18.3.1 | DOM rendering |
| Leaflet | 1.9.4 | Interactive map |
| react-leaflet | 4.2.1 | React Leaflet bindings |
| CSS custom properties | — | Design tokens / theming |
| Google Fonts | — | JetBrains Mono, Orbitron, Inter |

### Desktop / Electron

| Technology | Version | Purpose |
|------------|---------|---------|
| Electron | 28.0.0 | Desktop shell |
| electron-builder | 24.0.0 | Packaging / NSIS installer |
| electron-updater | 6.1.0 | Auto-update via GitHub releases |
| chokidar | 3.6.0 | File watching (RPT log, bridge files) |

### AI / Network

| Technology | Version | Purpose |
|------------|---------|---------|
| axios | 1.14.0 | HTTP client (declared but aiService uses native fetch) |
| OpenRouter API | — | Default LLM provider (OpenAI-compatible endpoint) |

### Dev Tooling

| Technology | Version | Purpose |
|------------|---------|---------|
| react-scripts | 5.0.1 | CRA build pipeline |
| concurrently | 8.2.0 | Run React dev + Electron simultaneously |
| cross-env | 7.0.3 | Cross-platform env vars |
| wait-on | 7.2.0 | Wait for React dev server before launching Electron |

### Arma 3 Mod

| Technology | Purpose |
|------------|---------|
| SQF (Arma scripting) | Bridge logic, unit serialization, command execution |
| CBA_A3 | Required addon framework (XEH event handlers) |
| Python 3 | PBO packaging script (`create_pbo.py`) |

---

## 4. File-by-File Reference

### Root

| File | Lines | Purpose |
|------|------:|---------|
| `package.json` | 79 | npm manifest, scripts, electron-builder config, dependencies |

### Electron Main Process (`electron/`)

| File | Lines | Purpose |
|------|------:|---------|
| `electron/main.js` | 893 | **Core of the Electron app.** Single-instance lock, crash reporter, directory setup, config management, command queue (buildSQFContent), bridge watcher (RPT log tailing via chokidar), IPC handlers (15 total: send-command, get-config, save-config, save-mission, load-intel, save-intel, get-mission-folders, get-paths, get-arma-info, set-arma-path, install-mod, check-mod-status, minimize/maximize/close window), auto-update setup, auto-install mod, auto-detect mission folders. |
| `electron/preload.js` | 50 | Context bridge exposing 16 `spectreAPI` methods to renderer: onArmaUpdate, onArmaEvent, sendCommand, getConfig, saveConfig, onConfigUpdated, saveMission, loadIntel, saveIntel, getMissionFolders, getPaths, getArmaInfo, setArmaPath, installMod, checkModStatus, onUpdateAvailable/Downloaded, minimize/maximize/close. |
| `electron/armaDetector.js` | 158 | Auto-detects Arma 3 installation via: Windows registry (3 keys), Steam libraryfolders.vdf parsing, common fallback paths (10 paths). Also detects Arma Documents folder (including OneDrive), and finds most recent RPT log file in `%LOCALAPPDATA%\Arma 3` and Documents. |

### React Source (`src/`)

| File | Lines | Purpose |
|------|------:|---------|
| `src/App.js` | 206 | Root component. Bootstraps store, connects IPC listeners, renders TitleBar + MapView + SidePanel + StatusBar + all modals. Contains abort countdown logic, adaptation acceptance handler. |
| `src/store/useSpectreStore.js` | 349 | **Central state management** using React hooks. Contains: REWARD scoring constants (8 weights), INITIAL_STATE (35 fields), patch updater, bootstrap effect (IPC listeners, config loading), mission timer, force metrics calculator (firepower index from vehicle weights), abort threshold watcher, comms logger (300-entry cap), Arma command sender, intel database adder, mission end handler with AAR trigger. Also contains processArmaUpdate (unit/merge, contact aging/deletion, event dedup) and handleArmaEvents (reward updates, AI adaptation triggers). |
| `src/ai/aiService.js` | 501 | **AI service singleton.** Manages: API key rotation (last→first, MAX_RETRIES_PER_KEY=2), OpenRouter API calls with retry logic, sliding context window (MAX_HISTORY=8, compresses to summary), conversation history. Methods: `call()` (core API with key rotation), `chat()` (planning conversation), `generateOPORD()` (operations order), `generateCOAs()` (3 courses of action), `modifyCOA()` (AI COA modification), `adaptPlan()` (mid-mission adaptation), `generateAAR()` (after-action review), `generateRadioMessage()`. Also: `buildContext()` (formats battlefield data for LLM), `extractJSON()` (robust parser with tag matching + brace counting + cleaning), `cleanJSON()` (strips trailing commas, comments, unquoted keys). |
| `src/components/MapView.js` | 418 | Leaflet map component. Defines 6 Arma 3 maps with custom CRS (Stratis, Altis, Tanoa, Enoch, Livonia, Malden). Creates/recreates map on mapName change. Renders unit markers (DivIcon with callsign + symbol + HP bar), contact markers (state-colored), COA overlays (polylines + circle markers for waypoints). Auto-fits bounds. Legend + map name overlay. |
| `src/components/StatusBar.js` | 465 | Exports 3 components: `StatusBar` (bottom bar with clock, Arma connection, phase, elapsed time, firepower index, vehicle count, score, KIA, COMMS toggle), `CommsLog` (floating panel with priority-colored entries, auto-scroll, TTS for YELLOW/RED messages via SpeechSynthesisUtterance), `SettingsModal` (AI provider presets, API key textarea, model fields, Arma 3 path browser, mod installer buttons for SPECTRE + CBA_A3, mission folder auto-detect, bridge diagnostics display). |
| `src/components/SidePanel.js` | 305 | Right side panel with 4 tabs: UNITS (sorted unit cards with HP/FUEL/AMMO bars, HOLD/RTB/ORDER quick actions, custom order input), CONTACTS (sorted by state, color-coded left border), INTEL (report textarea with threat auto-detection, location database display), ORDERS (mass order input, 6 preset command buttons in 2-column grid). Also includes ForceMetrics section with firepower/vehicles/mobility/score boxes and mission phase control buttons. |
| `src/components/PlanningModal.js` | 338 | Full-screen planning interface. Conversation mode: chat with SPECTRE AI, messages display as user/assistant bubbles. After first user message, "GENERATE OPORD" button appears. OPORD view: structured display with Situation, Mission, Execution (phases with duration), Coordinating Instructions, Abort Conditions. Approve → auto-generates 3 COAs via AI → transitions to COA panel. Seeds intel DB from OPORD situation. |
| `src/components/COAPanel.js` | 368 | COA display and execution panel. Shows 3 COA cards with: success probability bar, time estimate, vehicle/crew casualty estimates, risk factors, phase list. Actions: STEP THROUGH (phase-by-phase preview), MODIFY (AI-powered natural language modification), EXECUTE (sends phase 1 orders to Arma). Phase advancement bar tracks active COA progress with ADVANCE button. |
| `src/components/AbortModal.js` | 132 | Emergency abort modal. Triggered when firepower drops below 50% or crew KIA ≥ 2. Shows situation assessment, force stats grid (firepower, vehicles, crew KIA), 3 options: FIGHTING WITHDRAWAL (82% success), CONSOLIDATE & HOLD (61%), CONTINUE ASSAUT (12% - not recommended). 30-second countdown with progress bar, auto-selects WITHDRAW. |
| `src/components/AdaptationModal.js` | 88 | Mid-mission adaptation notification. Severity-colored (MINOR/MAJOR/CRITICAL). Shows assessment, recommended action, modified unit orders preview. Options: ACCEPT & EXECUTE (sends orders), VIEW NEW COAs (if generated), IGNORE. |
| `src/components/AARPanel.js` | 263 | After-Action Review with 4 tabs: SUMMARY (outcome grid, score breakdown with per-event point values, what went well/wrong lists), DECISIONS (key decision points with event/decision/assessment/alternative), ANALYSIS (SPECTRE recommendations, training notes, intelligence updates), TRAINING DATA (reward record preview, file path). Score letter grading (S/A/B/C/F). |
| `src/components/TitleBar.js` | 56 | Custom frameless title bar. Displays: "SPECTRE" logo (Orbitron font), mission phase label, elapsed timer (T+ format), Arma connection indicator with animated pulse dot, minimize/maximize/close buttons. |
| `src/components/ErrorBoundary.js` | 71 | React error boundary. Catches render errors, displays error message with RELOAD APP and DISMISS buttons. Full-screen dark overlay with red accent. |

### Styles

| File | Lines | Purpose |
|------|------:|---------|
| `src/styles/global.css` | 1185 | **Complete design system.** CSS custom properties (38 variables for surfaces, borders, text, colors, typography, spacing, radii, shadows, layout, transitions). Full component styles: titlebar, map, side panel (tabs, unit cards, bars, force metrics), comms log, COA panel (overlay, cards, stat rows, probability bars, risk items, phases), buttons (4 variants), status bar, planning modal (messages, input area), settings modal, scrollbars, loading/thinking animations, map markers, intel tags, animations (fadeIn, slideUp, pulse-dot, blink), Leaflet tooltip overrides, focus states, reduced-motion media query. |

### Arma 3 Mod (`mod/`)

| File | Lines | Purpose |
|------|------:|---------|
| `mod/addons/config.cpp` | 28 | CfgPatches (requires CBA_A3), CfgFunctions (registers SPECTRE_fnc_bridgeInit), Extended_PostInit_EventHandlers (auto-runs XEH_postInit.sqf). |
| `mod/addons/XEH_postInit.sqf` | 2 | Minimal: logs post-init, calls `SPECTRE_fnc_bridgeInit`. |
| `mod/addons/functions/fn_bridgeInit.sqf` | 431 | **The Arma-side bridge.** 431 lines of SQF. Globals: broadcast rate (1.0s), command read rate (0.75s), map coordinate lookup table (8 maps). Functions: `SPECTRE_fnc_vehicleType` (classifies 9 vehicle types), `SPECTRE_fnc_serializeUnit` (JSON serialization with map coordinate conversion), `SPECTRE_fnc_serializeContact` (enemy contact JSON), `SPECTRE_fnc_execCmd` (command executor: 8 command types), `SPECTRE_fnc_detectEvents` (KIA/destroyed/spotted detection), `SPECTRE_fnc_broadcastState` (per-line diag_log output: META + UNITS + CONTACTS + EVENTS), `SPECTRE_fnc_readCommands` (reads + compiles spectre_to_arma.sqf). Main loop: spawned with sleep 0.1, broadcasts every 1s, reads commands every 0.75s. |

### Build

| File | Lines | Purpose |
|------|------:|---------|
| `create_pbo.py` | 99 | Python PBO packer. Reads source directory, packs files into Arma 3 PBO format (Vers entry, properties with prefix, file entries with metadata, sentinel, data block). Used for building the mod addon without external tools. |

---

## 5. Feature Inventory

### Core C2 Features

1. **Real-time tactical map** — Leaflet-based map with Arma 3 coordinate systems, auto-centers on friendly forces
2. **Unit tracking** — Live position, health, fuel, ammo, heading, current order for all BLUFOR assets
3. **Contact tracking** — Enemy unit detection with CONFIRMED/LAST_KNOWN/SUSPECTED state management and age-based state degradation (2min → LAST_KNOWN, 10min → deleted)
4. **Unit command & control** — HOLD, RTB, WEAPONS FREE, WEAPONS SAFE, FORM UP, DISPERSE, EXECUTE_ORDER, CUSTOM orders
5. **Mass commands** — Send orders to all units simultaneously
6. **Custom text orders** — Free-text instructions sent to individual units

### AI Planning

7. **AI-powered planning conversation** — Chat interface with SPECTRE AI to discuss mission objectives and constraints
8. **OPORD generation** — AI generates complete Operations Orders with Situation, Mission, Execution phases, Coordinating Instructions, Abort Conditions
9. **COA generation** — AI produces 3 tactically distinct Courses of Action with probability estimates
10. **COA modification** — Natural language modification of individual COAs ("use Alpha for the flank instead")
11. **Step-through preview** — Phase-by-phase preview of a COA before execution
12. **Phase advancement** — Manual phase progression during active COA execution
13. **AI radio messages** — Generate military-format radio messages

### Mission Lifecycle

14. **Mission phases** — BRIEFING → PLANNING → ACTIVE → AAR (with ABORTING as an emergency state)
15. **Mission timer** — Elapsed time tracking during active missions
16. **Mission save/load** — Save mission data to JSON files
17. **After-Action Review** — AI-generated AAR with outcome summary, decision analysis, what went well/wrong, training notes
18. **Reward scoring** — Point-based scoring: objective (+50), enemy kill (+3), vehicle lost (-20), friendly KIA (-15), time bonus (+2/min saved), abort (-10), mission failed (-50)
19. **Score grading** — Letter grades: S (≥80), A (≥60), B (≥40), C (≥20), F (<20)

### Intelligence System

20. **Intel database** — Persistent locations, patterns, and terrain data across missions
21. **Manual intel reporting** — Commander can report intel with auto-threat-level detection
22. **AI intel extraction** — OPORD situation seeding, AAR intelligence updates
23. **Contact spotted events** — Automatic intel pattern recording

### Emergency System

24. **Abort threshold detection** — Auto-triggers when firepower < 50% or crew KIA ≥ 2 or vehicles lost ≥ 2
25. **Abort countdown** — 30-second countdown with auto-select (FIGHTING WITHDRAWAL)
26. **3 abort options** — Fighting Withdrawal, Consolidate & Hold, Continue Assault (with success probabilities)
27. **AI adaptation** — Mid-mission plan adaptation based on battlefield events (auto-handle for MINOR, user prompt for MAJOR/CRITICAL)

### Bridge & Integration

28. **File-based Arma 3 bridge** — No DLL injection, no BattlEye issues
29. **RPT log tailing** — Chokidar-based file watching with 500ms polling
30. **Multi-line state parsing** — Handles per-line SPECTRE_META/UNIT/CONTACT/EVENTS format
31. **Legacy format support** — Backward-compatible with single-line SPECTRE_STATE: format
32. **Auto-detect Arma 3** — Registry → Steam VDF → common paths (10 fallback paths)
33. **Auto-detect mission folders** — Scans Documents\Arma 3\missions and mpmissions
34. **Auto-set mission folder** — Detects from bridge's getMissionPath broadcast

### Mod Management

35. **Auto-install SPECTRE mod** — Copies bundled mod to Arma 3 directory on first run
36. **Manual mod install** — Settings button to install @SPECTRE mod
37. **CBA_A3 auto-download** — Downloads from GitHub releases, extracts with PowerShell, fixes nested folder structure
38. **Mod status detection** — Checks for mod.cpp in both mod directories

### UI/UX Features

39. **Custom title bar** — Frameless window with SPECTRE branding, phase display, connection indicator, window controls
40. **Dark military theme** — Full design system with 38 CSS custom properties
41. **Comms log** — Floating priority-colored message log with auto-scroll
42. **Text-to-speech** — Browser TTS for tactical (YELLOW/RED) comms messages
43. **Map legend** — Friendly/Hostile/Last Known/Suspected indicator
44. **Unit tooltips** — Detailed hover info on map markers
45. **Force metrics dashboard** — Firepower index, vehicle count, mobility assessment
46. **Error boundary** — Graceful crash handling with reload option
47. **Single-instance lock** — Prevents multiple app instances
48. **Auto-update** — GitHub releases-based update with download notification
49. **Settings modal** — AI provider presets (OpenRouter/Anthropic/OpenAI/Custom), API key management, model configuration, mission folder setup

### Map System

50. **6 Arma 3 maps** — Stratis, Altis, Tanoa, Enoch, Livonia, Malden with accurate CRS
51. **Custom CRS per map** — Each map has its own transformation factor and tile width for accurate positioning
52. **Fallback CRS** — 1:1 meter mapping for unknown maps
53. **COA overlay visualization** — Polylines and waypoint markers for active COAs
54. **Auto-fit bounds** — Map auto-zooms to encompass all friendly units
55. **Dark tile styling** — Brightness/saturation/hue-rotate filter on Leaflet tiles

### Build & Distribution

56. **NSIS installer** — Windows installer with custom install directory
57. **PBO build script** — Python script to package Arma mod without external tools
58. **Dev mode** — Concurrent React dev server + Electron with hot reload
59. **Production build** — Optimized React build + Electron packaging

---

## 6. Arma 3 Bridge System

### Data Format (Arma → SPECTRE)

State is broadcast via `diag_log` as structured lines in the RPT log. The Electron main process parses these lines.

#### SPECTRE_META (line 354 in fn_bridgeInit.sqf)
```json
{"map":"Altis","mf":"mpmissions\\myMission.Altis","ts":1234567890}
```
Fields: `map` (world name), `mf` (mission folder relative path), `ts` (timestamp in ms)

#### SPECTRE_UNIT (one per friendly unit, line 359)
```json
{"id":"Alpha-1","vtype":"MBT","pos":{"x":4500,"y":8200,"lat":39.075,"lng":21.053},"hdg":45,"hp":85,"fuel":72,"order":"WEAPONS FREE","st":"READY"}
```
Fields: `id` (callsign), `vtype` (vehicle type), `pos` (Arma grid + lat/lng), `hdg` (heading), `hp` (health percent), `fuel` (fuel percent, vehicles only), `order` (current order, if any), `st` (status: READY|DEAD)

#### SPECTRE_CONTACT (one per spotted enemy, line 369)
```json
{"id":"HOSTILE-0","type":"MBT","position":{"x":5100,"y":9000,"lat":39.081,"lng":21.06},"state":"CONFIRMED","source":"VISUAL","confidence":"HIGH"}
```

#### SPECTRE_EVENTS (line 377, array format)
```json
[{"type":"VEHICLE_DESTROYED","unit":"Bravo-2","id":"VEHICLE_DESTROYED_Bravo-2_1234"}]
```
Event types: `UNIT_KIA`, `VEHICLE_DESTROYED`, `CONTACT_SPOTTED`

### Command Format (SPECTRE → Arma)

Written to `spectre_to_arma.sqf` in the mission folder as compilable SQF.

#### Simple commands (HOLD, RTB, HOLD_ALL, RTB_ALL, WEAPONS_FREE, WEAPONS_SAFE, FORM_UP, DISPERSE)
```sqf
[1234567890, "HOLD", "Alpha-1"] call SPECTRE_fnc_execCmd;
```

#### EXECUTE_ORDER
```sqf
[1234567890, "EXECUTE_ORDER", "Alpha-1", [[4500,8200],[5000,9000]], "WEAPONS FREE", "Advance to objective"] call SPECTRE_fnc_execCmd;
```

#### CUSTOM
```sqf
[1234567890, "CUSTOM", "Alpha-1", [], "", "Move to building north"] call SPECTRE_fnc_execCmd;
```

### Map Coordinates

The Arma mod converts Arma grid coordinates (meters from map origin) to approximate lat/lng using a lookup table:

```sqf
SPECTRE_mapCoords = createHashMap;
SPECTRE_mapCoords set ["altis",    [39.0, 21.0, 111000, 85000]];   // [origin_lat, origin_lng, m_per_lat, m_per_lng]
SPECTRE_mapCoords set ["stratis",  [39.0, 21.0, 111000, 85000]];
SPECTRE_mapCoords set ["tanoa",    [-6.0, 149.0, 111000, 111000]];
SPECTRE_mapCoords set ["livonia",  [51.0, 17.0, 111000, 63000]];
SPECTRE_mapCoords set ["malden",   [42.0, 3.0, 111000, 78000]];
SPECTRE_mapCoords set ["enoch",    [51.0, 17.0, 111000, 63000]];
SPECTRE_mapCoords set ["tem_anizay", [37.0, 71.0, 111000, 88000]];
SPECTRE_mapCoords set ["cola",     [-23.0, -68.0, 111000, 95000]];
```

Conversion math (SQF):
```sqf
_lat = _originLat + (_py / _mPerLat);
_lng = _originLng + (_px / _mPerLng);
```

Where `_px` = Arma X (easting), `_py` = Arma Y (northing), both in meters.

### Bridge Timing

| Parameter | Value | Location |
|-----------|-------|----------|
| State broadcast rate | 1.0 seconds | `fn_bridgeInit.sqf:15` |
| Command read rate | 0.75 seconds | `fn_bridgeInit.sqf:16` |
| Main loop sleep | 0.1 seconds | `fn_bridgeInit.sqf:429` |
| RPT file poll interval | 500ms | `main.js:454` |
| Log rotation check | 30 seconds | `main.js:562` |
| Fallback poll timer | 2 seconds | `main.js:516` |

---

## 7. AI Service

### Architecture

`src/ai/aiService.js` exports a singleton `AIService` instance. It manages all LLM interactions including planning, COA generation, adaptation, and AAR generation.

### API Key Rotation

```
Keys: [key_A, key_B, key_C]
              ↑
     currentKeyIndex starts at last key (key_C)

On 429 rate limit:
  1. keyRetryCount++ (max 2 per key)
  2. If retryCount > MAX_RETRIES_PER_KEY → rotateKey()
  3. rotateKey() decrements currentKeyIndex, wraps around
  4. Resets retryCount

Total retry budget: keys.length * 4 attempts
```

Key rotation order: **last → first** (reverse order through the array). This means the most recently added key is tried first.

### Context Window Management

```
MAX_HISTORY = 8 messages

When history reaches 8:
  1. Take messages[0..n-5] → compress to summary
  2. Keep messages[n-4..n-1] (last 4)
  3. Prepend: { role: 'user', content: 'SESSION SUMMARY: ...' }
```

Summary extraction: Strips XML tags, truncates each message to 200 chars, semicolon-separated.

### API Call Details

- **Endpoint:** `{base_url}/chat/completions` (default: `https://openrouter.ai/api/v1`)
- **Headers:** `Authorization: Bearer {key}`, `HTTP-Referer: https://spectre-c2.local`, `X-Title: SPECTRE C2`
- **Parameters:** `temperature: 0.7`, `max_tokens: 4000`
- **System prompt:** SPECTRE personality definition with military C2 rules

### All Methods

| Method | Input | Output | Tag |
|--------|-------|--------|-----|
| `call(messages, systemOverride?)` | Message array, optional system prompt | Raw text response | — |
| `chat(userMessage, context)` | User message, battlefield context | AI response text | — |
| `generateOPORD(objective, constraints, context, conversation)` | Mission details + chat history | OPORD JSON | `<OPORD_JSON>` |
| `generateCOAs(situation, opord, context)` | Situation description + OPORD | 3 COAs JSON | `<COA_JSON>` |
| `modifyCOA(coa, modification, context)` | Original COA + modification text | Modified COA | `<COA_JSON>` |
| `adaptPlan(event, currentCOA, context)` | Battlefield event + current plan | Adaptation JSON | Raw JSON |
| `generateAAR(missionData)` | Full mission data | AAR JSON | `<AAR_JSON>` |
| `generateRadioMessage(from, to, situation)` | Sender, recipient, situation | Radio message text | — |
| `buildContext(context)` | Units, contacts, metrics, intel | Formatted context string | — |
| `extractJSON(text, tag)` | Raw LLM text, optional tag name | Parsed JSON or null | — |
| `cleanJSON(str)` | Malformed JSON string | Cleaned JSON string | — |
| `compressHistory()` | — | — (modifies conversationHistory) | — |
| `resetConversation()` | — | — (clears history) | — |
| `setConfig(config)` | App config object | — (updates internal config) | — |
| `getCurrentKey()` | — | Current API key string | — |
| `rotateKey()` | — | — (switches to next key) | — |
| `sleep(ms)` | Milliseconds | Promise | — |

### JSON Extraction Strategy

1. Try regex match for `<TAG>...</TAG>` → parse content
2. If fails, try parsing content after `cleanJSON()`
3. If no tag, use brace-counting to find all `{...}` candidates
4. Sort candidates by length (longest first)
5. Try parsing each, with cleanJSON fallback
6. Returns null if all fail (logs warning)

### Default Models

| Provider | Primary Model | Fallback Model |
|----------|--------------|----------------|
| OpenRouter (default) | `qwen/qwen3-next-80b-a3b-instruct:free` | `qwen/qwen3-next-80b-a3b-instruct:free` |
| Anthropic | `claude-opus-4-5` | — |
| OpenAI | `gpt-4o` | — |

---

## 8. Map System

### CRS (Coordinate Reference System) Math

Each Arma 3 map uses a custom Leaflet CRS based on `L.CRS.Simple` with a `L.Transformation` that maps Arma grid meters to pixel coordinates.

The transformation format is: `L.Transformation(a, b, c, d)` where:
- `a` = scale factor for x (easting → pixel x)
- `b` = translate offset for x
- `c` = scale factor for y (northing → pixel y, negative for screen coords)
- `d` = translate offset for y (tileWidth parameter)

For Arma 3Map CRS, the formula is:
```
pixel_x = factor_x * meter_x
pixel_y = -factor_y * meter_y + tileWidth
```

The `tileWidth` parameter (`d` in Transformation) is critical — it offsets the y-axis so that the map origin aligns correctly. Without it (or with value 0), tiles at negative y-coordinates disappear.

### Tile Configuration

| Map | Factor X | Factor Y | Tile Width | Max Zoom | Default Zoom | World Size | Center |
|-----|----------|----------|------------|----------|--------------|------------|--------|
| **Stratis** | 0.027475 | 0.027475 | 226 | 8 | 2 | 8192 | [4100, 4100] |
| **Altis** | 0.006839 | 0.006836 | 212 | 10 | 3 | 30720 | [15000, 15000] |
| **Tanoa** | 0.01385 | 0.01385 | 213 | 9 | 2 | 15360 | [7000, 7000] |
| **Enoch** | 0.02735 | 0.02735 | 356 | 8 | 2 | 12800 | [7100, 7100] |
| **Livonia** | 0.02735 | 0.02735 | 356 | 8 | 2 | 12800 | [7100, 7100] |
| **Malden** | 0.01448 | 0.01448 | 186 | 9 | 2 | 12800 | [7000, 7000] |

### Tile Sources

All maps use tiles from `https://jetelain.github.io/Arma3Map/maps/{mapname}/{z}/{x}/{y}.png`

Pattern: `TILE_BASE + config.tilePattern`

For example, Altis zoom 3: `https://jetelain.github.io/Arma3Map/maps/altis/3/0/0.png`

### Coordinate Conversion

In the custom CRS, Arma positions map as:
- **Leaflet lat** = Arma Y (northing in meters)
- **Leaflet lng** = Arma X (easting in meters)

The `getUnitLatLng()` function (MapView.js:120) performs:
```javascript
[position.y, position.x]  // Arma → Leaflet
```

### Tile Rendering

- `maxNativeZoom` is set to the map's `maxZoom` (e.g., 8 for Stratis)
- `minZoom` is 0
- Leaflet's `maxZoom` on the map instance is set to 20 (for overlay zoom)
- The `tileSize` parameter in the CRS transformation is the `tileWidth` value (226 for Stratis, 212 for Altis, etc.)

### Known Map Issue

See [Section 9.1 — Deep Zoom Tiles Disappear](#91-deep-zoom-tiles-disappear-past-native-maxzoom) for the critical bug related to CRS tileWidth and Leaflet's `_setZoomTransform`.

---

## 9. Known Bugs

### 9.1 Deep Zoom Tiles Disappear Past Native maxZoom

**Severity:** High  
**Component:** `src/components/MapView.js` (CRS definition + tile layer)

**Description:** When zooming past the native `maxZoom` of the tile set (e.g., zoom 9+ on Stratis which has `maxZoom: 8`), tiles disappear completely. The map shows a black background instead of zoomed-in tiles.

**Root Cause:** The custom MGRS-style CRS uses a `tileWidth` parameter in the `L.Transformation` (the `d` value). For example, Stratis uses `new L.Transformation(f, 0, -f, 226)` where 256 is the tile width offset. When Leaflet tries to display tiles at zoom levels beyond `maxNativeZoom`, it calls `_setZoomTransform` internally. This method assumes standard CRS behavior where `scale(z)` directly maps to tile coordinates. The non-zero `d` (tileWidth) offset in the Transformation breaks this assumption — the tile coordinate calculation produces incorrect positions, causing tiles to render off-screen or at wrong positions.

**Affected Maps:** All 6 maps (Stratis, Altis, Tanoa, Enoch, Livonia, Malden) — any map with a non-zero tileWidth in its CRS Transformation.

**Workaround:** Currently none implemented. Users are limited to the native maxZoom of each tile set.

**Potential Fix:** Override Leaflet's internal `_setZoomTransform` or `getTileSize` to account for the CRS Transformation offset. Alternatively, generate higher-zoom tile sets (expensive) or implement a custom tile loading strategy that scales existing tiles.

---

### 9.2 CSS Variable Mismatches

**Severity:** Low  
**Component:** Various components

**Description:** Some components reference CSS variable names that don't exactly match the canonical names defined in `global.css`. This was partially fixed but some inconsistencies remain.

**Specific Mismatches Observed:**
- `--accent-primary` vs `--accent` — both used interchangeably across components
- `--accent-bright` — defined as alias to `--accent` in CSS, used extensively in inline styles
- `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-panel`, `--bg-hover` — alias layer exists but some components use raw `--surface-*` vars directly
- `--text-bright` vs `--text-primary` — alias exists, both used

**Status:** Partially fixed. The alias layer in `:root` (lines 57-66 of global.css) maps common names to canonical names, but inline styles in components sometimes use one form and CSS classes use another.

---

### 9.3 SettingsModal Inline CSS

**Severity:** Low  
**Component:** `src/components/StatusBar.js` (SettingsModal)

**Description:** The SettingsModal component makes heavy use of inline `style={{}}` props instead of CSS classes. This makes the component harder to maintain and inconsistent with other components that use CSS classes from `global.css`.

**Example locations:**
- `StatusBar.js:234` — provider button container
- `StatusBar.js:256-259` — API key count display
- `StatusBar.js:289-329` — Arma 3 path section (all inline)
- `StatusBar.js:335-356` — Mod installation buttons
- `StatusBar.js:387-415` — Folder picker list
- `StatusBar.js:434-452` — Bridge diagnostics box

**Estimated inline styles:** ~40+ style objects in SettingsModal alone.

**Impact:** Maintains visual consistency (uses CSS variables), but violates the project's general pattern of using CSS classes. Makes quick theming harder.

---

### 9.4 No Automated Tests

**Severity:** Medium  
**Component:** Entire codebase

**Description:** There are zero automated tests in the project. No unit tests, integration tests, or end-to-end tests exist. The `package.json` has no test script defined.

**Impact:**
- Regressions can be introduced without detection
- The AI service's JSON extraction logic is fragile and would benefit from test coverage
- The bridge parser (`parseArmaLog`) handles multiple formats and edge cases — high regression risk
- CRS math in MapView is complex and untested

**Recommended test targets (priority order):**
1. `aiService.extractJSON()` — various malformed inputs
2. `aiService.cleanJSON()` — trailing commas, comments, unquoted keys
3. `parseArmaLog()` — all message formats, edge cases
4. `buildSQFContent()` — all command types
5. `processArmaUpdate()` — unit merging, contact aging, event dedup
6. `expandUnit()` — field mapping
7. CRS calculations — coordinate conversion accuracy
8. `expandLegacyState()` — backward compatibility

---

## 10. Design System

### Color Palette

#### Surface Colors (dark theme)
| Token | Hex | Usage |
|-------|-----|-------|
| `--surface-0` | `#020617` | App background, deepest layer |
| `--surface-1` | `#0f172a` | Panel backgrounds, titlebar |
| `--surface-2` | `#1e293b` | Card backgrounds, inputs |
| `--surface-3` | `#283548` | Hover states, secondary surfaces |
| `--surface-4` | `#334155` | Scrollbars, track backgrounds |

#### Border Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--border-subtle` | `#1e293b` | Default subtle borders |
| `--border-default` | `#334155` | Standard borders, buttons |
| `--border-strong` | `#475569` | Emphasized borders |
| `--border-focus` | `#22c55e` | Focus ring (green accent) |

#### Text Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#f1f5f9` | Headings, important text |
| `--text-secondary` | `#94a3b8` | Body text, descriptions |
| `--text-muted` | `#64748b` | Labels, metadata |
| `--text-inverse` | `#0f172a` | Text on accent backgrounds |

#### Semantic Colors
| Token | Hex | Semantic |
|-------|-----|----------|
| `--accent` / `--color-green` | `#22c55e` | Positive, active, success |
| `--blue` / `--color-friendly` | `#3b82f6` | Info, friendly forces |
| `--red` / `--color-hostile` | `#ef4444` | Hostile, danger, destructive |
| `--yellow` / `--color-suspected` | `#eab308` | Warning, caution |
| `--orange` / `--color-last-known` | `#f97316` | Last known position |

#### Dim/Translucent Variants
| Token | Value | Usage |
|-------|-------|-------|
| `--accent-dim` | `rgba(34, 197, 94, 0.15)` | Selected card backgrounds |
| `--accent-glow` | `rgba(34, 197, 94, 0.4)` | Glow effects, pulse animation |
| `--blue-dim` | `rgba(59, 130, 246, 0.15)` | Blue comms entries |
| `--red-dim` | `rgba(239, 68, 68, 0.12)` | Red comms, error states |
| `--yellow-dim` | `rgba(234, 179, 8, 0.12)` | Yellow comms, warnings |

### Typography

| Token | Font | Usage |
|-------|------|-------|
| `--font-display` | Orbitron (500/700/900) | Logo, section titles |
| `--font-mono` | JetBrains Mono (400/500/600) | Data values, code, timestamps |
| `--font-body` | Inter (300-700) | Body text, labels, buttons |
| `--font-condensed` | Inter (alias) | Condensed labels, section headers |

Google Fonts import: `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Orbitron:wght@500;700;900&family=Inter:wght@300;400;500;600;700&display=swap');`

### Spacing Scale
| Token | Value |
|-------|-------|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-8` | 32px |

### Border Radius
| Token | Value |
|-------|-------|
| `--radius-sm` | 4px |
| `--radius-md` | 6px |
| `--radius-lg` | 8px |

### Shadows
| Token | Value |
|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0, 0, 0, 0.4)` |
| `--shadow-md` | `0 4px 12px rgba(0, 0, 0, 0.5)` |
| `--shadow-lg` | `0 8px 32px rgba(0, 0, 0, 0.6)` |
| `--shadow-glow` | `0 0 20px var(--accent-glow)` |

### Layout Constants
| Token | Value | Usage |
|-------|-------|-------|
| `--titlebar-height` | 40px | Custom title bar |
| `--statusbar-height` | 32px | Bottom status bar |
| `--side-panel-width` | 380px | Right side panel |

### Transitions
| Token | Value |
|-------|-------|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--duration-fast` | 120ms |
| `--duration-normal` | 200ms |

### Animations
- `pulse-dot` — Connection indicator glow pulse (2s infinite)
- `fadeIn` — Message entry fade-in (0.2s)
- `slideUp` — Slide up entrance
- `blink` — Thinking dots animation (1.4s infinite, staggered)

### Accessibility
- `:focus-visible` outlines on buttons, inputs, textareas (2px solid accent)
- `prefers-reduced-motion: reduce` — disables all animations
- Semantic color coding (not sole indicator — text labels always present)

---

## 11. Build & Distribution

### Development Mode

```bash
npm start
```

Runs concurrently:
1. `cross-env BROWSER=none react-scripts start` — React dev server on port 3000
2. After 3000 is ready: `cross-env NODE_ENV=development electron .` — Electron loads from localhost

DevTools open with `DEVTOOLS=1` environment variable.

### Production Build

```bash
npm run build
```

Two-step process:
1. `react-scripts build` — Optimized React build to `build/`
2. `electron-builder` — Packages Electron app with NSIS installer

### Build Configuration (package.json `build` key)

```json
{
  "appId": "com.spectre.c2",
  "productName": "SPECTRE C2",
  "files": ["build/**/*", "electron/**/*", "node_modules/**/*", "mod/**/*"],
  "win": {
    "target": "nsis",
    "artifactName": "${productName}-${version}.${ext}"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "SPECTRE C2"
  },
  "publish": {
    "provider": "github",
    "owner": "ArpitTeli",
    "repo": "spectre-app",
    "releaseType": "release"
  }
}
```

### PBO Build (Arma 3 Mod)

```bash
python create_pbo.py mod/addons output.pbo "z\spectre\addons\spectre_bridge"
```

Creates an Arma 3 PBO file with:
- Vers entry (Bohemia format header)
- Prefix property (`z\spectre\addons\spectre_bridge`)
- File entries with metadata
- Data block (concatenated file contents)

### Auto-Update Flow

1. On startup (10s delay), checks GitHub releases via `electron-updater`
2. If update available: sends `update-available` to renderer → comms log entry
3. Downloads automatically in background
4. When downloaded: sends `update-downloaded` → comms log entry → "Restart to apply"
5. Auto-installs on quit (`autoInstallOnAppQuit: true`)

### Version Management

- Version defined in `package.json` (`1.2.0`)
- Also in `config.cpp` (`version = "1.1.0"` — **note: out of sync**)
- StatusBar displays `v1.1` hardcoded (line 81 of StatusBar.js — **also out of sync**)

---

## 12. Configuration & Data Paths

### Path Resolution

```
USER_DATA = app.getPath('userData')
          = %LOCALAPPDATA%\spectre-arma\          (Windows)
          = ~/Library/Application Support/spectre-arma/  (macOS)
          = ~/.config/spectre-arma/               (Linux)
```

### All Paths

| Path | Variable | Purpose |
|------|----------|---------|
| `%LOCALAPPDATA%\spectre-arma\` | `USER_DATA` | App root data directory |
| `%LOCALAPPDATA%\spectre-arma\config.json` | `CONFIG_PATH` | Persistent configuration |
| `%LOCALAPPDATA%\spectre-arma\debug.log` | `DEBUG_LOG` | Debug log file |
| `%LOCALAPPDATA%\spectre-arma\bridge\` | `BRIDGE_DIR` | Bridge files directory |
| `%LOCALAPPDATA%\spectre-arma\missions\` | `MISSIONS_DIR` | Saved mission JSONs |
| `%LOCALAPPDATA%\spectre-arma\intel\` | `INTEL_DIR` | Intel database |
| `%LOCALAPPDATA%\spectre-arma\intel\intel_db.json` | — | Intel persistence file |
| `%LOCALAPPDATA%\Arma 3\arma3_x64_*.rpt` | — | Arma 3 RPT log files (tailed) |
| `{ARMA_DOCS}\SPECTRE\` | `ARMA_SPECTRE` | Arma-side SPECTRE data folder |
| `{ARMA_DOCS}\missions\` | — | Scanned for mission folders |
| `{ARMA_DOCS}\mpmissions\` | — | Scanned for mission folders |
| `{ARMA_INSTALL}\@SPECTRE\` | — | Installed SPECTRE mod |
| `{ARMA_INSTALL}\@CBA_A3\` | — | Installed CBA_A3 mod |
| `{mission_folder_path}\spectre_to_arma.sqf` | — | Command file written by SPECTRE |

### Config Schema (`config.json`)

```json
{
  "ai_provider": "openrouter",           // "openrouter" | "anthropic" | "openai" | "custom"
  "api_keys": [],                        // Array of API key strings
  "model": "qwen/qwen3-next-80b-a3b-instruct:free",   // Primary LLM model
  "fallback_model": "qwen/qwen3-next-80b-a3b-instruct:free",  // Fallback model
  "base_url": "https://openrouter.ai/api/v1",  // API endpoint
  "mission_folder_path": "",             // Arma 3 mission folder path
  "arma_path": "",                       // Arma 3 installation path
  "auto_abort_threshold": {
    "firepower_loss_pct": 50,            // Abort when firepower drops below this %
    "crew_kia": 2                        // Abort when this many crew KIA
  }
}
```

### Legacy Config Handling

In `main.js:796-801`, config is migrated on load:
- Single `api_key` → migrated to `api_keys` array
- Old model names (`anthropic/claude-opus-4-5`, `openai/gpt-4o`, `openai/gpt-4o-mini`) → replaced with defaults

---

## 13. Future Roadmap

### High Priority

1. **Fix deep zoom tile disappearance** — Resolve CRS tileWidth vs Leaflet `_setZoomTransform` conflict
2. **Add automated tests** — Jest for React components, unit tests for aiService and bridge parser
3. **Refactor SettingsModal inline CSS** — Move to CSS classes for maintainability
4. **Sync version numbers** — Ensure package.json, config.cpp, and StatusBar.js all reference the same version
5. **Replace axios with native fetch** — axios is declared as dependency but unused; aiService uses fetch
6. **Add error handling for CBA download failures** — Currently shows generic error message

### Medium Priority

7. **WebSocket bridge option** — Replace file-based bridge with WebSocket for lower latency
8. **Map zoom persistence** — Remember zoom level and center per map
9. **Unit group management** — Organize units into fireteams/squads
10. **Drag-and-drop waypoints** — Draw COA waypoints on the map directly
11. **Multiple COA comparison view** — Side-by-side COA comparison
12. **Intel map markers** — Show intel locations on the map
13. **Mission replay system** — Replay saved mission data step-by-step
14. **Multi-language support** — i18n for UI text
15. **Notification system** — Toast notifications for events
16. **Export AAR to PDF/HTML** — Shareable AAR reports
17. **Custom theme support** — User-defined color schemes beyond dark military

### Low Priority

18. **Linux/macOS Arma detection** — Current detection is Windows-only (registry, Steam VDF)
19. **Steam Workshop integration** — Browse and download community missions
20. **Voice input** — Speech-to-text for commander orders
21. **Multi-monitor support** — Detachable map panel
22. **Plugin system** — Allow custom AI providers and bridge protocols
23. **Training data pipeline** — Automated fine-tuning data collection from missions
24. **Real-time collaboration** — Multiple commanders sharing a session
25. **Night mode / alternate themes** — Light mode, desert theme, etc.
26. **Unit path history** — Show breadcrumbs of unit movement
27. **Weather integration** — Display Arma 3 weather on the map
28. **Artillery overlay** — Range circles, fire mission planning
29. **Log viewer** — In-app RPT log viewer for debugging

---

## 14. Developer Notes

### Common Tasks

#### Running in Dev Mode
```bash
npm start
```
Opens React dev server + Electron. Changes to React code hot-reload. Electron changes require restart.

#### Building the PBO
```bash
python create_pbo.py mod/addons output.pbo "z\spectre\addons\spectre_bridge"
```
Copy `output.pbo` to your Arma 3 `@SPECTRE/addons/` directory.

#### Testing Bridge Without Arma
Create a file at `%USERPROFILE%\Documents\Arma 3\SPECTRE\arma_to_spectre.json` with:
```json
{
  "mapName": "Altis",
  "units": [{"id":"Test-1","callsign":"Test-1","type":"VEHICLE","vehicle_type":"MBT","position":{"x":5000,"y":8000,"lat":39.07,"lng":21.06},"heading":0,"health":100,"fuel":100,"ammo":100,"status":"READY","current_order":""}],
  "contacts": [],
  "events": []
}
```
Note: This uses the legacy JSON bridge format. The primary bridge is now RPT log tailing.

#### Adding a New Command Type
1. Add case to `SPECTRE_fnc_execCmd` in `fn_bridgeInit.sqf` (~line 171)
2. Add case to `buildSQFContent()` in `electron/main.js` (~line 108)
3. Add UI trigger in `SidePanel.js` or `COAPanel.js`

#### Adding a New Map
1. Add entry to `ARMA_MAPS` object in `MapView.js` (~line 9)
2. Add entry to `SPECTRE_mapCoords` HashMap in `fn_bridgeInit.sqf` (~line 20)
3. Verify CRS factors using jetelain/Arma3Map reference

#### Debugging Bridge Communication
- Check `debug.log` at `%LOCALAPPDATA%\spectre-arma\debug.log`
- Enable verbose logging in `preload.js` (DEBUG = true, line 3)
- Check Electron console for `[SPECTRE-RENDERER]` prefixed messages
- Check Arma 3 RPT for `SPECTRE:` prefixed lines

### Debug Tips

| Issue | Check |
|-------|-------|
| "Arma not connected" | Is Arma running? Is the SPECTRE mod loaded? Check RPT for "SPECTRE: Bridge running" |
| "No units detected" | Check RPT for "SPECTRE: Initialized — tracking N blufor assets" |
| Map tiles not loading | Check network tab for 404s on jetelain.github.io |
| Commands not executing | Verify `mission_folder_path` in config, check `spectre_to_arma.sqf` exists |
| AI errors | Check API key in Settings, verify OpenRouter key is valid |
| App crashes on start | Check `debug.log` for stack trace, try deleting `config.json` |
| CBA install fails | Check internet connection, GitHub API rate limits |

### Architecture Decisions Log

| Decision | Why |
|----------|-----|
| **No state management library** | App has ~35 state fields. Redux/Zustand would add complexity without proportional benefit. `useSpectreStore` with `patch` function is sufficient. |
| **File-based bridge** | Most conservative approach — no code injection, no BattlEye issues, no DLL concerns. Trade-off: ~1s latency, but acceptable for turn-based C2. |
| **React hooks over class components** | Modern React pattern, better composition, but caused some complexity with `stateRef` pattern for async handlers. |
| **Single AI service singleton** | Ensures consistent state (conversation history, key rotation) across all components. |
| **Chokidar for file watching** | Cross-platform, handles Windows file locking better than fs.watch. Polling mode at 500ms ensures reliability. |
| **Inline styles in some components** | Quick prototyping for complex layouts (modals, cards). Trade-off: harder to maintain. Should be refactored. |
| **Custom PBO builder** | Eliminates dependency on external tools (MicMac, PBOManager). Simple Python script that anyone can run. |

### Code Quality Notes

- **No TypeScript** — All JavaScript, no type checking
- **No linting enforced** — ESLint config extends react-app but no custom rules
- **No Prettier** — Code formatting varies between files
- **Mixed style patterns** — Some components use CSS classes, others use inline styles
- **Comment density** — Generally well-commented in critical paths (bridge, CRS), sparse in UI components
- **Error handling** — try/catch throughout, but many catch blocks silently swallow errors (`catch (_) {}`)
- **State refs** — `stateRef` pattern used extensively to avoid stale closures in async handlers

### Performance Considerations

- **Unit markers** — Cleared and re-added on every update (no diffing). Could be optimized with marker pooling.
- **Contact aging** — 10-minute TTL with 600ms check interval
- **Event dedup** — Uses processedEventIds Set, capped at 500 entries
- **Comms log** — Capped at 300 entries (FIFO)
- **Conversation history** — Capped at 8 messages with compression
- **Map tiles** — Standard Leaflet tile caching, no custom caching layer

### Security Notes

- API keys stored in plaintext `config.json` on disk
- No encryption at rest
- No authentication on IPC channels (renderer has full access to all APIs)
- `nodeIntegration: false` and `contextIsolation: true` provide standard Electron security
- Bridge commands have no authorization — anyone with file write access to the mission folder can send commands

---

*End of HANDOVER document. For questions, contact the original developer or open an issue on the repository.*
