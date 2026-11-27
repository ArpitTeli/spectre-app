# SPECTRE C2 — Arma 3 Edition

AI-powered Command & Control system for Arma 3. Real-time tactical map, AI mission planning, live unit command, and after-action reviews.

Part of a three-repo project:

| Repo | Role |
|---|---|
| **spectre-app** (this repo) | The C2 desktop app, plus the terrain tooling in `scripts/` (cost grid, path planner, OAKOC extractor) |
| [spectre-mod](https://github.com/ArpitTeli/spectre-mod) | The standalone Arma 3 mod (a copy of `mod/addons/` with its own README and releases) |
| [spectre-terrain-intelligence](https://github.com/ArpitTeli/spectre-terrain-intelligence) | Training-data pipeline for the Tasking Layer model |

Requires Windows and Arma 3. Proprietary, all rights reserved (see [License](#license)).

---

## First-Time Setup

### 1. Install dependencies
```
npm install
```

### 2. Start the app
```
npm start
```
React starts on port 3000, Electron opens automatically.

### 3. Install the Arma 3 mod

On first launch, SPECTRE auto-detects your Arma 3 installation and installs the `@SPECTRE` mod. If auto-install fails:

1. Open **Settings** (bottom-right of the Status tab)
2. Click **Install @SPECTRE Mod**
3. Restart Arma 3 with the mod enabled

**CBA_A3 is not required.** The mod starts through vanilla `postInit`. Settings can still install
CBA_A3 for other mods that need it. FPV drones need the **D37_FPV** mod.

### 4. Start Arma 3

Launch Arma 3 with the SPECTRE mod enabled. Start or load a mission on any of the supported maps. SPECTRE auto-connects by tailing the Arma RPT log file — no manual bridge setup needed.

### 5. Connect the app

When SPECTRE opens, choose a connection mode:

- **HOST** — You're running Arma 3 on this PC. SPECTRE connects to the local Arma process and generates a room code for remote viewers.
- **COMMAND** — Connect to a host PC remotely by entering their room code. **View only:** orders over the relay are disabled, because anyone with the room code could send them.

To command from another device, pair the SPECTRE Android app: press **PAIR** in the host's bottom bar and enter the address and code in the app (same network).

---

## How the Bridge Works

| Direction | Method |
|---|---|
| **Arma → SPECTRE** | The SPECTRE mod uses `diag_log` to write structured JSON lines (`SPECTRE_META:`, `SPECTRE_UNIT:`, `SPECTRE_CONTACT:`, `SPECTRE_EVENTS:`) to the Arma RPT log every 0.5s. SPECTRE tails this file and parses the lines. |
| **SPECTRE → Arma** | SPECTRE writes one command at a time to `<Arma 3>\@SPECTRE\addons\spectre_cmds.sqf`. The mod reads and clears it every 0.3s via `callExtension` (DLL file reader) and executes it. Format: `<id>|<TYPE>|<unitId>|<x,y;x,y>|<roe>|<action>`. |

No DLL injection and no manual init.sqf editing. The mod ships a `callExtension` DLL, so run it on a
trusted local setup. The command file has no authentication: anything that can write it can command your units.

---

## Workflow

```
1. SPECTRE opens → Mode Select (Host / Command)
2. Arma 3 connects → units appear on the tactical map
3. Open Planning (PLAN button) → chat with SPECTRE AI about your objective
4. Click GENERATE OPORD → review the Operations Order
5. Click APPROVE → 3 Courses of Action generated
6. Step through each COA on the map, or modify with natural language
7. Click EXECUTE → SPECTRE sends Phase 1 orders to Arma
8. Watch units move. SPECTRE adapts if vehicles are destroyed or contacts spotted.
9. Advance phases as each completes
10. OBJ (complete) or END → AAR generated
```

---

## Features

### Tactical Map
- **2D Leaflet map** with 6 Arma 3 maps: Stratis, Altis, Tanoa, Enoch, Livonia, Malden
- **3D Three.js viewer** with satellite terrain, 92K instanced objects (trees, buildings), roads — press **M** to toggle
- Unit markers with callsign, vehicle type symbol, health bar
- Enemy contacts with state-based coloring (Confirmed / Last Known / Suspected)
- COA overlay visualization (polylines + waypoint markers)
- Custom CRS per map for accurate Arma coordinate positioning

### Unit Command & Control
- **Radial menu** — right-click or Q+click on a unit for contextual actions
- **Multi-select** — Ctrl+click to select multiple units, batch commands
- **Target mode** — click map to set positions for MOVE_TO, ATTACK, SMOKE_AT, ARTILLERY_STRIKE, LAND_AT
- **Fire Mission panel** — full-screen overlay with mini-map for artillery (ammo type, rounds, spread)
- **Flight Plan panel** — full-screen overlay for helicopter waypoint planning (altitude, speed, landing mode)

### AI Planning
- Chat interface with SPECTRE AI (OpenRouter default, or Anthropic/OpenAI)
- **OPORD generation** — full Operations Order with Situation, Mission, Execution phases, Abort Conditions
- **COA generation** — 3 tactically distinct Courses of Action with probability estimates
- **COA modification** — natural language edits ("use Alpha for the flank instead")
- **Mid-mission adaptation** — AI responds to battlefield events (vehicle loss, contact spotted) with modified orders
- **After-Action Review** — outcome summary, decision analysis, training notes
- API key rotation across multiple keys for rate limit handling

### Mission Lifecycle
- Mission phases: BRIEFING → PLANNING → ACTIVE → AAR (with ABORTING emergency state)
- Mission timer, reward scoring (objective, kills, casualties, time bonus)
- Score grading: S / A / B / C / F
- Save/load mission data to JSON

### Intelligence System
- Persistent intel database across missions (locations, patterns, terrain)
- Manual intel reporting with threat-level auto-detection
- AI intel extraction from OPORD and AAR

### Knowledge Vault
- Obsidian-compatible `.md` files with YAML frontmatter + wikilinks
- Auto-generated from OPORD + COA (units, contacts, objectives, phases, intel)
- Cytoscape.js graph visualization of mission knowledge
- Vault-aware AI context — SPECTRE reads the knowledge graph for richer prompts

### Remote Viewing
- **Built-in web viewer** — serves a live Leaflet map on port 3721 (open `http://your-ip:3721` on any device)
- **Cloud relay** — Host/Client multiplayer mode via WebSocket relay
- **Vercel web viewer** — Next.js app for hosted remote viewing

### Mod Management
- Auto-detect Arma 3 installation (Windows registry, Steam VDF, 10 fallback paths)
- Auto-install `@SPECTRE` mod (and optionally `@CBA_A3`)
- Mod status detection

---

## Supported Commands

| Command | Target | SQF Execution |
|---|---|---|
| HOLD | Unit | `doStop` |
| RTB | Unit | `doMove` to spawn position |
| HOLD ALL | All units | `doStop` on all BLUFOR |
| RTB ALL | All units | `doMove` to spawn on all |
| WEAPONS FREE | All units | `setCombatMode "RED"` + `setBehaviour "COMBAT"` |
| WEAPONS SAFE | All units | `setCombatMode "BLUE"` + `setBehaviour "AWARE"` |
| FORM UP | All units | All alive units move to first unit's position |
| DISPERSE | All units | Each unit moves to random offset ±40m |
| MOVE_TO | Unit | `doMove` (single) or group waypoints (multi) |
| ATTACK | Unit | `doTarget` + `doFire` on named target |
| ATTACK_POS | Unit | Creates temp target, fires at position |
| ARTILLERY_STRIKE | Unit | `fireMission` with rounds + ammo type |
| LAND_AT | Helicopter | `doMove` + `land "LAND"` |
| SMOKE_AT | Unit | Creates smoke grenade at position |
| ADJUST_FIRE | Unit | Targets temp object (no fire) |
| HOVER | Helicopter | Hovers at 50m altitude |
| EXECUTE_ORDER | Unit | Clear + set waypoints, ROE, order label |
| CUSTOM | Unit | Sets free-text order label |

---

## Supported Maps

| Map | Tile Size | Max Zoom | World Size |
|---|---|---|---|
| Stratis | 226px | 4 | 8192m |
| Altis | 212px | 6 | 30720m |
| Tanoa | 213px | 5 | 15360m |
| Enoch | 356px | 4 | 12800m |
| Livonia | 356px | 4 | 12800m |
| Malden | 186px | 5 | 12800m |

Tile source: [jetelain/Arma3Map](https://jetelain.github.io/Arma3Map/)

---

## Project Structure

```
├── electron/
│   ├── main.js              # Electron main process (log tail, command writer, relay, web viewer, mod installer)
│   ├── preload.js           # Context bridge (window.spectreAPI)
│   ├── armaDetector.js      # Auto-detect Arma 3 install
│   └── guardrails/          # JS mirror of the shared guardrail kernel (edge_guardrail.js, policy.json)
├── src/
│   ├── App.js               # Root component
│   ├── store/useSpectreStore.js   # State management
│   ├── ai/aiService.js      # LLM interactions
│   ├── lib/vault.js         # Knowledge graph system
│   ├── components/          # Map (2D/3D), panels, radial menu, planning, COA, AAR, modals
│   └── styles/global.css    # Design system
├── mod/                     # Arma mod source and built PBO
│   ├── mod.cpp
│   ├── spectre_ext_x64.dll
│   └── addons/              # config.cpp, $PBOPREFIX$, spectre_bridge.pbo, functions/ (fn_bridgeInit.sqf, export_*)
├── spectre_ext/             # DLL source (spectre_ext.c) and prebuilt DLL
├── relay-server/server.js   # WebSocket relay for multiplayer
├── web-viewer/              # Next.js live map viewer (app/page.js, app/api/state/route.js)
├── scripts/                 # Python terrain tooling: WRP parsing, cost grid, path planner, OAKOC, training pipeline
├── public/                  # Static assets (maps, models, terrain worker)
├── batches/, spectre_dataset.json, doctrine.py, validate.py   # Training data and doctrine validation
├── Models for C2/           # Source 3D model assets (see Third-party assets)
├── create_pbo.py            # PBO packager for the Arma mod
└── *.md                     # Design and reference docs (see Documentation)
```

---

## Documentation

| File | What it covers |
|---|---|
| [current-architecture.md](current-architecture.md) | Exact current bridge and app implementation, the debugging reference |
| [HANDOVER.md](HANDOVER.md) | Project handover: overview, setup, internals |
| [pipeline.md](pipeline.md) | End-to-end flow from Arma terrain to AI orders and training data |
| [model-training-pipeline.md](model-training-pipeline.md) | Terrain intelligence, model selection, synthetic data generation |
| [spectre-lattice-gameplan.md](spectre-lattice-gameplan.md) | Full build spec |
| [todo.md](todo.md), [future-plans-todo.md](future-plans-todo.md) | Tasking Layer decisions and roadmap |

---

## Configuration

Settings are stored at `%LOCALAPPDATA%\spectre-arma\config.json`:

```json
{
  "ai_provider": "openrouter",
  "api_keys": [],
  "model": "qwen/qwen3-next-80b-a3b-instruct:free",
  "base_url": "https://openrouter.ai/api/v1",
  "mission_folder_path": "",
  "arma_path": "",
  "relay_url": "wss://spectre-relay.onrender.com",
  "auto_abort_threshold": {
    "firepower_loss_pct": 50,
    "crew_kia": 2
  }
}
```

---

## Development

```bash
# Development mode (React hot-reload + Electron)
npm start

# Production build
npm run build

# Build Arma mod PBO
python create_pbo.py "mod\addons" "mod\addons\spectre_bridge.pbo"
```

---

## Fresh-machine notes

- `npm install` now works on current npm (the unused `@react-three` packages were removed).
- npm 10+ blocks package install scripts, so Electron's binary is not downloaded. Run
  `node node_modules/electron/install.js` once after `npm install`, or approve it with
  `npm install-scripts approve electron`.

---

## Troubleshooting

**Units don't appear on map**
- Is Arma 3 running with the SPECTRE mod enabled?
- Check the Arma RPT log for `SPECTRE: Initialized — tracking N blufor assets`
- If absent, the mod isn't loading: check Arma was launched with `-mod=@SPECTRE`

**Commands not reaching Arma**
- Confirm `<Arma 3>\@SPECTRE\addons\spectre_cmds.sqf` is written after you send a command (it is cleared once read)
- Confirm `spectre_ext_x64.dll` is in the `@SPECTRE\` root
- Check the RPT for `SPECTRE: Executed OK:` or `SPECTRE read: malformed command`

**AI errors**
- Verify at least one API key is configured in Settings
- OpenRouter keys start with `sk-or-`
- Anthropic keys start with `sk-ant-`

**Map tiles not loading**
- Tiles are loaded from `jetelain.github.io` — check internet connection
- Check browser DevTools network tab for 404s

**Relay connection issues**
- Host must be running for clients to connect
- The default relay `wss://spectre-relay.onrender.com` (Render free tier) is currently **offline** (HTTP 404).
  Remote viewing (Host/Command mode) needs your own relay: deploy `relay-server/` anywhere that supports WebSockets and
  set `relay_url` in the config file. The local web viewer on port 3721 works without a relay.
- Check relay status in the title bar

---

## Third-party assets

`Models for C2/` and `public/models/` contain third-party 3D models and textures. For example,
the Recon Tank is by Mophs, based on work by MNDV.ecb (CC-BY 4.0, see its `credits.txt`). Check
each asset's license before redistributing this repo.

Map tiles come from [jetelain/Arma3Map](https://jetelain.github.io/Arma3Map/).

---

## License

Proprietary, all rights reserved. Third-party assets keep their own licenses.
