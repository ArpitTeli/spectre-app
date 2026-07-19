# SPECTRE C2 — Arma 3 Edition  v1.1

AI-powered Command & Control system for Arma 3.
Plan missions, generate COAs with Claude/GPT-4, command units, review after-action reports.

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

### 3. Configure in Settings (⚙ button, bottom-right)
- **AI Provider** — select OpenRouter, Anthropic, or OpenAI
- **API Key** — your OpenRouter/Anthropic/OpenAI key
- **Mission Folder** — click **🔍 Auto-detect** to find your Arma missions,
  or paste the path manually (e.g. `C:\Users\You\Documents\Arma 3\missions\MyMission.Altis`)
  This is where SPECTRE writes `spectre_to_arma.sqf` so Arma can receive commands.

### 4. Set up the Arma mission

**a)** Copy `arma-mod/SPECTRE_bridge.sqf` into your mission folder.

**b)** Create (or open) `init.sqf` in the same folder and add:
```sqf
[] execVM "SPECTRE_bridge.sqf";
```

**c)** In the Arma 3 editor, give your vehicles and infantry **variable names**
in the Attributes panel (e.g. `Alpha_1`, `Bravo_1`, `Charlie_1`).
Units without variable names will be tracked but named `UNIT_0`, `UNIT_1`, etc.

**d)** Launch the mission. You'll see `SPECTRE C2 Bridge: ACTIVE` in the hint area.

---

## How the Bridge Works

| Direction | Method |
|---|---|
| **Arma → SPECTRE** | `diag_log` writes `SPECTRE_STATE:{...json...}` every second. SPECTRE tails the Arma RPT log file. |
| **SPECTRE → Arma** | SPECTRE writes `spectre_to_arma.sqf` into your mission folder. The bridge reads and executes it every 0.75s via `loadFile` + `call compile`. |

No mods required. No `-filePatching` required.

---

## Workflow

```
1. SPECTRE opens → Planning Modal appears
2. Brief SPECTRE on your objective ("capture the town, minimize casualties")
3. Click GENERATE OPORD → review the Operations Order
4. Click APPROVE & GENERATE COAs → 3 tactical options appear
5. Step through each COA on the map, or modify with natural language
6. Click EXECUTE → SPECTRE sends Phase 1 orders to Arma
7. Watch units move. SPECTRE adapts if vehicles are destroyed or contacts spotted.
8. Click ADVANCE TO PHASE 2, 3... as each phase completes
9. Click ✓ OBJ (objective complete) or ■ END → AAR generated
10. Training data saved to %LOCALAPPDATA%\spectre-arma\missions\
```

---

## Supported Commands (sent to Arma)

| UI action | SQF executed |
|---|---|
| HOLD (unit) | `doStop` |
| RTB (unit) | `doMove` to spawn position |
| ALL HOLD | `doStop` on all blufor |
| ALL RTB | `doMove` spawn pos on all |
| WEAPONS FREE | `setCombatMode "RED"` + `setBehaviour "COMBAT"` |
| WEAPONS SAFE | `setCombatMode "BLUE"` + `setBehaviour "AWARE"` |
| FORM UP | all alive units move to first alive unit's position |
| DISPERSE | each unit moves to random offset ±40m |
| EXECUTE ORDER | clear waypoints, add new waypoints, set ROE |
| CUSTOM (text) | sets `SPECTRE_currentOrder` label on unit |

---

## Files Changed in v1.1

| File | What changed |
|---|---|
| `arma-mod/SPECTRE_bridge.sqf` | Fixed SQF variable scoping in enemy detection; added command deduplication; enabled `readCommands` loop; implemented FORM_UP and DISPERSE; added per-unit kill event handlers |
| `electron/main.js` | Added `buildSQFContent()` command builder; added `mission_folder_path` config key; added `getMissionFolders()` auto-detect IPC handler |
| `electron/preload.js` | Exposed `getMissionFolders` to renderer |
| `src/components/StatusBar.js` | Settings modal: added Mission Folder field with auto-detect button and validation |
| `src/components/PlanningModal.js` | OPORD button shows after first message (removed fragile wording dependency); added error banner |
| `src/components/COAPanel.js` | Added phase progress bar and "Advance to Phase N" button for multi-phase plan execution |

---

## Troubleshooting

**Units don't appear on map**
Check the Arma RPT log (Documents\Arma 3\arma3.log) for `SPECTRE_STATE:` lines.
If absent, the bridge script isn't running — confirm `init.sqf` calls it.

**Commands not reaching Arma**
- Confirm Mission Folder is set in SPECTRE Settings
- Check the folder contains `spectre_to_arma.sqf` after you send a command
- Confirm the bridge's `readCommands` loop is active (check RPT for `SPECTRE CMD:` lines)

**AI errors**
- Verify API key is correct for the selected provider
- OpenRouter keys start with `sk-or-`
- Anthropic keys start with `sk-ant-`

**Map shows wrong area**
The coordinate conversion is calibrated for **Altis** (the default large map).
For other maps, edit the constants in `src/components/MapView.js`:
`ALTIS_ORIGIN_LAT`, `ALTIS_ORIGIN_LNG`, `METERS_PER_LAT`, `METERS_PER_LNG`
