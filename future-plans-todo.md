# SPECTRE C2 — Future Plans / To-Do

## Status

- ✅ Enemy Tracking — implemented
- ✅ Unit Identity System — mostly done (HP, fuel, crew, vehicle grouping)
- ✅ Basic Commands (HOLD, RTB, WEAPONS_FREE, WEAPONS_SAFE, DISPERSE, FORM_UP, EXECUTE_ORDER, CUSTOM) — implemented
- ✅ Command System (Tier 2) — implemented (MOVE_TO, ATTACK, ATTACK_POS, ARTILLERY_STRIKE, LAND_AT, SMOKE_AT, ADJUST_FIRE, HOVER)
- ✅ Radial Menu — implemented (glassmorphism, right-click/Q+click, per-unit-type actions)
- ✅ Target Mode — implemented (MOVE_TO/ATTACK/LAND_AT/SMOKE_AT/ARTILLERY_STRIKE via map click)
- 🔲 Contacts rendering issues — to fix (visible but has problems)
- 🔲 Full-Screen Action Panels — next
- 🔲 Multi-Select — after panels
- ⏳ Map Annotations — deferred
- ⏳ Pathfinding Micro-Model — deferred (much later)
- ⏳ Logging / AAR — deferred (much later)

---

## Command System (Tier 2)

Position-based commands that require a target location or enemy unit.

### Commands

| Command | Parameters | SQF | Unit Types |
|---------|-----------|-----|------------|
| MOVE_TO | `{x, y}` | `driver _vehicle move [x, y]` | All |
| ATTACK | `{targetUnitId}` or `{x, y}` | `gunner _vehicle doTarget target` | All (auto-detect: click enemy = unit, click empty = position) |
| ARTILLERY_STRIKE | `{x, y, rounds, ammoType}` | `[_vehicle, [x,y]] fireMission [rounds, ammoType]` | Artillery |
| LAND_AT | `{x, y}` | `helicopter landAt [x, y]` | Helicopters |
| SMOKE_AT | `{x, y}` | `driver _vehicle smokeScreen true` | All |

### Attack Auto-Detection

When "Attack" is selected from radial menu:
- Click on enemy unit → attack that unit (SQF: `doTarget`)
- Click on empty map → fire at position (SQF: `doFire` at coordinates)

### SQF Additions Required

New functions in `mod/addons/functions/`:
- `fn_moveUnit.sqf` — takes unit + waypoint array, moves along path
- `fn_artilleryStrike.sqf` — takes unit + target pos + rounds + ammo type
- `fn_landAt.sqf` — takes helicopter + landing position

---

## Radial Menu

Primary command interface. Appears on right-click or Q+left-click on a unit.

### Trigger

| Input | 2D Map | 3D View |
|-------|--------|---------|
| Right-click on unit | Opens radial | Opens radial |
| Right-click on empty | Normal browser context | Orbits camera |
| Q + left-click on unit | Opens radial | Opens radial |
| Q + left-click on empty | Nothing | Nothing |

### Visual Style

- Glassmorphism (frosted glass, blur effects)
- Dark background with colored text/icons
- Center circle shows unit name and type
- 6-8 action items arranged in a circle around center
- Actions filtered by unit type

### Actions by Unit Type

| Unit Type | Actions |
|-----------|---------|
| Infantry | Move To, Hold, Attack, Form Up, Disperse, Get In/Out |
| Vehicle | Move To, Hold, Open Fire, Cease Fire, Speed Up, Slow Down |
| Artillery | Fire Mission, Adjust Fire, Move To, Hold |
| Helicopter | Move To, Land, Hover, Attack, Get In/Out |
| Multi-select (mixed) | Move To, Hold, Attack (common only) |

### Behavior

- Simple actions (Hold, Open Fire, Disperse) → execute immediately, menu closes
- Complex actions (Fire Mission, Flight Plan) → open full-screen panel
- Cancel: ESC or click empty area

---

## Multi-Select System

### Interaction

1. Hold Ctrl → enters multi-select mode
2. Click unit → adds to selection (toggle)
3. Click empty area → clears all selection
4. Release Ctrl → exits multi-select mode, selection persists

### Selection Panel

- Position: bottom-right corner
- Shows: unit names, types, and batch action buttons
- Batch actions: Move All, Hold, Attack (common actions only)
- Click empty area clears all selection

### Right-Click in Multi-Select

- Right-click any selected unit → radial menu shows only actions valid for ALL selected unit types
- Example: 2 infantry + 1 vehicle → radial shows Move To, Hold, Attack only

---

## Full-Screen Action Panels

Complex actions open a dedicated full-screen overlay with its own mini-map.

### Panel Style

- Tactical dark background + glassmorphism
- Completely hides the main map
- Contains its own mini-map for target selection
- Large text, tactical grid layout

### Fire Mission Panel (Artillery)

```
┌─────────────────────────────────────────┐
│  FIRE MISSION                    [X]    │
│                                          │
│  ┌──────────────────┐  ┌──────────────┐ │
│  │                  │  │ Ammo Type    │ │
│  │   Mini-Map       │  │ ○ HE         │ │
│  │   (click to      │  │ ● Smoke      │ │
│  │    set target)   │  │ ○ ICM        │ │
│  │                  │  │              │ │
│  │                  │  │ Rounds       │ │
│  │                  │  │ [===6===] 1-12│ │
│  │                  │  │              │ │
│  │                  │  │ Spread       │ │
│  │                  │  │ [==3==] 1-10 │ │
│  └──────────────────┘  └──────────────┘ │
│                                          │
│  Target: (4000, 5000)                    │
│  Distance: 2.4km                        │
│                                          │
│  [  EXECUTE FIRE MISSION  ]              │
│  [  Clear Target  ]                      │
└─────────────────────────────────────────┘
```

### Flight Plan Panel (Helicopter)

```
┌─────────────────────────────────────────┐
│  FLIGHT PLAN                     [X]    │
│                                          │
│  ┌──────────────────┐  ┌──────────────┐ │
│  │                  │  │ Altitude     │ │
│  │   Mini-Map       │  │ [==100m==]   │ │
│  │   (click to add  │  │ 50-500m      │ │
│  │    waypoints)    │  │              │ │
│  │                  │  │ Speed        │ │
│  │                  │  │ ○ Slow       │ │
│  │                  │  │ ● Normal     │ │
│  │                  │  │ ○ Fast       │ │
│  │                  │  │              │ │
│  │                  │  │ Landing      │ │
│  │                  │  │ ○ Hover      │ │
│  │                  │  │ ● Land       │ │
│  │                  │  │ ○ Fly-by     │ │
│  └──────────────────┘  └──────────────┘ │
│                                          │
│  Waypoints:                              │
│  1. (2500, 3000) [x]                    │
│  2. (3200, 4100) [x]                    │
│                                          │
│  [  EXECUTE FLIGHT PLAN  ]               │
└─────────────────────────────────────────┘
```

### Target Mode (within panels)

- Click "Set Target" or click mini-map → cursor changes to crosshair + glow
- Click on mini-map → sets target coordinates
- ESC → returns to panel (does not close panel)
- Panel shows distance to target after selection

---

## Sidebar Changes

### Right Panel

- Global buttons (Hold All, RTB All, Weapons Free, Weapons Safe) stay for now
- Will be moved to radial menu later, sidebar space repurposed
- Unit Detail tab remains (shows selected unit info)

### Left Panel

- ORDERS tab stays for now (secondary method for commands)
- Radial menu is primary command interface
- UNITS/CONTACTS/INTEL/GRAPH tabs unchanged

---

## Deferred Features

### Map Annotations

User-placed markers, lines, zones, text notes on the map for planning. Feeds into pathfinding later. Deferred until commands and panels are complete.

### Pathfinding Micro-Model

A* on cost grid using heightmap + roads + vegetation data. Requires `SPECTRE_fnc_moveUnit` SQF function. Deferred much later.

### Logging / AAR

Mission lifecycle logging, event timeline, after-action review panel. Deferred much later.
