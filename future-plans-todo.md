# SPECTRE C2 — Future Plans / To-Do

## Micro-Models Architecture

SPECTRE C2 will adopt a micro-model architecture inspired by Palantir's AIP. Each micro-model is a specialized, self-contained unit that handles one specific operational capability. Micro-models receive structured input, compute a result, and output structured data that other parts of the system (or other micro-models) can consume.

### Micro-Model: Pathfinding

**Purpose:** Compute optimal movement routes for units across the Stratis terrain, respecting unit capabilities, terrain constraints, and user-defined tactical restrictions.

#### Input Data Layers

| Layer | Source | Format | Resolution |
|-------|--------|--------|------------|
| Road network | `stratis_roads.bin` | Chain of centerline points (x, y, dir, w) | ~50m spacing |
| Terrain height | `stratis_height.png` | 8-bit grayscale PNG | 512×512 (16m/cell) |
| Vegetation density | `stratis_objects.bin` | Binary (x, y, z, dir, w, h, d, shape, density) | Per-object |
| Unit position/type | Bridge (Arma) | `{x, y, type, vehicle_type}` | Real-time |
| User constraints | UI (future) | Flagged zones (blocked, mined, etc.) | Arbitrary |

#### Unit Type Movement Profiles

Each unit type has a cost modifier per terrain class. The pathfinding model uses these to compute a cost grid where each cell's movement cost = base terrain cost × unit modifier.

**Infantry:**
- Road: 1.0 (baseline)
- Open terrain: 2.0
- Light forest (sparse trees): 3.0
- Dense forest (very dense): 5.0
- Rock/cliff: 8.0
- Water: impassable

**Off-road vehicle (jeep, APC):**
- Road: 1.0
- Open terrain: 1.5
- Light forest: 4.0
- Dense forest: impassable
- Rock/cliff: impassable
- Water: impassable

**Truck / logistics vehicle:**
- Road: 1.0
- Open terrain: 3.0
- Light forest: impassable
- Dense forest: impassable
- Rock/cliff: impassable
- Water: impassable

**Tracked vehicle (tank):**
- Road: 1.0
- Open terrain: 1.5
- Light forest: 3.0
- Dense forest: 6.0
- Rock/cliff: impassable
- Water: impassable

#### Terrain Cost Grid Generation

1. Start with 512×512 grid (matches heightmap resolution, 16m per cell)
2. For each cell:
   - Sample heightmap → compute slope (difference from neighbors)
   - Sample terrain objects within cell radius → classify density
   - Check if cell is on road (distance to nearest road segment < road width)
3. Assign base cost:
   - Road cell: 1.0
   - Slope < 10°: 1.5
   - Slope 10–25°: 3.0
   - Slope > 25°: 5.0
   - Slope > 40°: impassable
   - Dense vegetation (4+ objects in 20m radius): +2.0
   - Very dense vegetation (8+ objects): +4.0
4. Apply unit modifier to get final cost grid

#### Dynamic Constraints

User-placed tactical flags that modify the cost grid at runtime:

| Constraint Type | Effect | Visual |
|----------------|--------|--------|
| Destroyed route | Cells set to impassable | Red X on road segment |
| Mined area | Cells set to very high cost (50.0) or impassable | Yellow warning zone |
| Ambush zone | Cells get +10.0 cost penalty | Orange hatched area |
| Blocked intersection | Specific road junction set to impassable | Red circle |

These are stored as a list of `{type, x, y, radius}` objects that modify the cost grid before pathfinding runs.

#### Algorithm: A* on Cost Grid

1. Generate cost grid (512×512) from terrain + unit type + constraints
2. Convert start/end positions to grid coordinates
3. Run A* with 8-directional movement (including diagonals)
4. Diagonal movement cost: base × √2
5. Path smoothing: simplify waypoints using line-of-sight checks
6. Output: ordered list of `{x, y}` waypoints in Arma coordinates

#### Output Format

```json
{
  "unit_id": "alpha_1",
  "path": [
    {"x": 2610.2, "y": 625.7},
    {"x": 2580.0, "y": 650.0},
    {"x": 2540.5, "y": 700.3}
  ],
  "total_distance": 450.2,
  "estimated_time": 35.5,
  "terrain_summary": {
    "road_pct": 45.2,
    "offroad_pct": 54.8,
    "max_slope": 18.3
  }
}
```

#### Integration with Bridge

The pathfinding model outputs waypoints, which are sent to Arma via the existing command pipeline:

1. Model computes path → returns waypoint array
2. App formats as SQF: `[_unit, [[x1,y1],[x2,y2],...]] remoteExec ["SPECTRE_fnc_moveUnit", 2]`
3. `writeCommandToFile()` writes to `addons\spectre_cmds.sqf`
4. DLL reads file, executes SQF in Arma
5. Unit moves along waypoints

**Note:** A `MOVE_TO` command does not currently exist in the bridge. It would need to be added:
- Add `SPECTRE_fnc_moveUnit` to the SQF addon (takes unit + waypoint array)
- Add `MOVE_TO` command type in `electron/main.js` `buildSQFContent()`
- The pathfinding model calls this after computing the route

#### Future Enhancements

- **Multi-unit pathfinding:** Compute paths for squads/groups, avoid collision
- **Real-time replanning:** If unit encounters unexpected obstacle, recompute from current position
- **Threat-aware routing:** Factor in enemy positions (from intel) to avoid engagement zones
- **Time-of-day adjustment:** Night movement slower off-road
- **Weather effects:** Rain/mud increases off-road cost

---

## Unit Identity System

Before building map commands or action panels, the app needs to properly identify and classify units. Currently the bridge returns basic data (`id, x, y, type, vehicle_type`). This needs to be expanded.

### Unit Type Identification

Each unit must be classified by its actual Arma class, not just generic labels:

| Arma Class | SPECTRE Type | Marker Shape | Stats Shown |
|------------|-------------|--------------|-------------|
| CAManBase (rifleman, etc.) | INFANTRY | Circle | Health, Ammo, Position |
| Car (unarmed) | CAR | Rectangle | Health, Fuel, Speed, Position |
| Car_F (armed) | ARMED_CAR | Rectangle | Health, Fuel, Speed, Ammo, Position |
| Tank / Tank_F | TANK | Large rectangle | Health, Fuel, Speed, Armor, Ammo, Position |
| APC_Wheeled / APC_Tracked | APC | Large rectangle | Health, Fuel, Speed, Armor, Ammo, Position, Crew |
| Helicopter | HELICOPTER | Diamond | Health, Fuel, Altitude, Speed, Ammo, Position |
| Plane | PLANE | Triangle | Health, Fuel, Speed, Altitude, Position |
| Ship / Boat | BOAT | Boat shape | Health, Fuel, Speed, Position |

**No irrelevant stats.** Infantry never shows fuel. Unarmed vehicles never show ammo. This is a C2 app, not an RPG.

### Vehicle-Infantry Grouping

**Problem:** When infantry is inside a vehicle, showing both the vehicle and each infantryman as separate markers creates visual clutter and makes commanding tedious.

**Solution:** Units inside a vehicle are absorbed into the vehicle's UI representation. Only the vehicle is selectable on the map.

**Detection:** Query Arma for:
- `assignedVehicle unit` — returns the vehicle a unit is crewing/passengering
- `vehicleRole unit` — returns "Driver", "Gunner", "Commander", "Cargo"
- `fullCrew vehicle` — returns all crew and passengers

**Grouping rule:** If `assignedVehicle unit` returns a vehicle (not the unit itself), the unit is hidden from the map and shown as part of the vehicle's crew panel.

**Hierarchy example:**
```
BRADLEY (IFV)
├── Driver: Alpha 1 (INFANTRY)
├── Gunner: Alpha 2 (INFANTRY)
├── Commander: Alpha 3 (INFANTRY)
└── Cargo: Alpha 4, Alpha 5 (INFANTRY)
```

Clicking BRADLEY shows:
```
┌─────────────────────┐
│ BRADLEY — IFV        │
│ Health: 85%          │
│ Fuel: 72%            │
│ Speed: 0 km/h        │
│ Armor: Medium         │
├─────────────────────┤
│ CREW                 │
│ • Driver: Alpha 1    │
│ • Gunner: Alpha 2    │
│ • Cmdr: Alpha 3     │
│ • Cargo: Alpha 4, 5  │
├─────────────────────┤
│ Ammo: 30mm (120)     │
│       ATGM (4)       │
│       Coax (200)     │
└─────────────────────┘
```

### Command Routing

Commands to a vehicle are routed to the correct crew member based on role:

| Command | Routes To | SQF Target |
|---------|-----------|------------|
| MOVE_TO | Driver | `driver _vehicle move [x, y]` |
| ARTILLERY_STRIKE | Gunner | `gunner _vehicle doTarget target` |
| ATTACK | Gunner | `gunner _vehicle doTarget target` |
| HOLD | All crew | Each crew member's AI receives hold |
| FORM_UP | Driver | Driver controls vehicle formation |
| GET_OUT | All passengers | All exit vehicle |
| SMOKE_AT | Driver | Driver deploys smoke |

**SQF implementation:**
```sqf
// Movement → driver
_driver = driver _vehicle;
_driver move [x, y];

// Shooting → gunner
_gunner = gunner _vehicle;
_gunner doTarget target;
_gunner fire atTarget [target, "mainGun"];
```

### Lifecycle Events

| Event | Action |
|-------|--------|
| Infantry enters vehicle | Infantry marker hidden, shown in vehicle crew panel |
| Infantry exits vehicle | Infantry marker reappears at exit position |
| Vehicle destroyed | All crew shown as individual markers (if survived) |
| Driver killed | Passenger can take over driver seat (auto-assign) |
| Empty vehicle shown | "NO DRIVER" warning, movement commands disabled |

### Bridge Data Expansion

Current bridge data per unit:
```json
{"id": "alpha_1", "x": 2500, "y": 3000, "type": "INFANTRY", "vehicle_type": "MAN"}
```

Required bridge data:
```json
{
  "id": "alpha_1",
  "x": 2500, "y": 3000,
  "type": "INFANTRY",
  "vehicle_type": "MAN",
  "vehicle": "bradley_1",
  "vehicle_role": "driver",
  "health": 85,
  "ammo": 210,
  "has_weapon": true
}
```

For vehicles:
```json
{
  "id": "bradley_1",
  "x": 2500, "y": 3000,
  "type": "APC",
  "vehicle_type": "APC_WHEELED",
  "vehicle": null,
  "vehicle_role": null,
  "health": 85,
  "fuel": 72,
  "speed": 0,
  "armor": 45,
  "ammo_main": 120,
  "ammo_atgm": 4,
  "ammo_coax": 200,
  "crew": ["alpha_1", "alpha_2", "alpha_3"],
  "cargo": ["alpha_4", "alpha_5"]
}
```

### Implementation Priority

This is a prerequisite for the Map Command System and Tab-Based Action Panels. Build order:

1. **Unit Identity** — Classify units by Arma class, show relevant stats
2. **Vehicle Grouping** — Detect crew/passengers, absorb into vehicle
3. **Command Routing** — Route commands to correct crew role
4. **Map Commands** — Then build the action system on top

---

## Map Command System

### Command Tiers

**Tier 1 — Simple (already implemented):**
- HOLD, RTB, WEAPONS_FREE, WEAPONS_SAFE, DISPERSE, FORM_UP, EXECUTE_ORDER, CUSTOM
- No position needed, just unit ID + command

**Tier 2 — Position-based (next to build):**
- MOVE_TO `{x, y}` — Move unit to position
- ARTILLERY_STRIKE `{x, y, rounds, ammoType}` — Fire artillery at position
- LAND_AT `{x, y}` — Helicopter land at position
- SMOKE_AT `{x, y}` — Pop smoke at position
- ATTACK `{targetUnitId}` — Engage specific enemy unit

**Tier 3 — Complex (later):**
- Multiple waypoints (pathfinding output)
- Scheduled fire missions
- Combined arms coordination
- Convoy movement

### Interaction Model: Fusion of Toolbar + Context Menu

**Step 1: Select a unit** (click on marker)
- Sidebar updates to show unit info (name, type, status, position)
- Below the info, a panel shows available actions as buttons/icons
- Actions are filtered by unit type (artillery sees "Fire Mission", infantry sees "Deploy", etc.)

**Step 2: Trigger an action** (two entry points)

*Path A — Toolbar:*
- Click an action button in the sidebar (e.g., "Move To")
- Map enters action mode — cursor changes, subtle highlight
- Click on map → action executes at that point
- ESC or right-click cancels

*Path B — Right-click:*
- Right-click anywhere on the map
- Context menu appears with the same actions (filtered by selected unit type)
- Click an action → immediately enters action mode → click to confirm

Both paths converge: action selected + position clicked → SQF sent to Arma.

### State Machine

```
IDLE
  ↓ (click unit)
UNIT_SELECTED
  ↓ (click action in sidebar OR right-click → pick action)
ACTION_PENDING { action: "MOVE_TO", unit: "alpha_1" }
  ↓ (click on map)
EXECUTING → sends SQF → back to IDLE
  ↓ (ESC/right-click again)
IDLE
```

### Example Flows

**Move infantry:**
1. Click Alpha 1 (infantry) → sidebar shows [Move To] [Hold] [Attack] [Form Up] [Disperse]
2. Click "Move To" → cursor changes
3. Click on map at (2500, 3000)
4. SQF: `SPECTRE_EXEC:alpha_1:MOVE_TO:2500:3000` → sent to Arma

**Artillery strike:**
1. Click Bravo 3 (artillery) → sidebar shows [Fire Mission] [Adjust Fire] [Move To] [Hold]
2. Click "Fire Mission" → Fire Mission tab opens in sidebar
3. Set 6 rounds, HE ammo
4. Click on map at (4000, 5000)
5. SQF: `SPECTRE_EXEC:bravo_3:ARTILLERY:4000:5000:6:HE` → sent to Arma

**Attack enemy:**
1. Click Alpha 1 → sidebar shows actions
2. Click "Attack" → map shows enemy unit markers highlighted
3. Click on enemy unit "Echo 2"
4. SQF: `SPECTRE_EXEC:alpha_1:ATTACK:echo_2` → sent to Arma

### UI Components

| Component | Purpose |
|-----------|---------|
| `ActionToolbar` | Sidebar panel showing available actions for selected unit |
| `ContextMenu` | Right-click map menu with same actions |
| `ActionPanel` | Dedicated tab for parameter-heavy actions (artillery, flight plan) |
| `MapCursor` | Visual feedback when in action mode (crosshair, highlight) |

---

## Tab-Based Action Panels

Each major action type gets its own dedicated panel/tab in the sidebar with all its controls.

### Tabs by Unit Type

| Unit Type | Tabs |
|-----------|------|
| Infantry | Actions, Intel, Path |
| Artillery | Actions, Fire Mission, Intel, Path |
| Helicopter | Actions, Flight Plan, Intel, Path |
| Vehicle | Actions, Cargo, Intel, Path |
| Plane | Actions, Strike Plan, Intel, Path |

### Fire Mission Tab (Artillery)

```
┌─────────────────────────┐
│  FIRE MISSION            │
│                          │
│  Target: (4000, 5000)   │  ← from map click
│  Distance: 2.4km        │  ← auto-calculated
│                          │
│  Ammo Type               │
│  ○ HE  ● Smoke  ○ ICM   │
│                          │
│  Rounds                  │
│  [========6====] 1-12    │
│                          │
│  Spread                  │
│  [====3=====] 1-10       │
│                          │
│  ┌────────────────────┐  │
│  │    Map Preview     │  │  ← mini map showing
│  │    shows impact    │  │     impact zone
│  │    radius          │  │
│  └────────────────────┘  │
│                          │
│  [  FIRE MISSION  ]      │
│  [  Clear Target  ]      │
└─────────────────────────┘
```

### Flight Plan Tab (Helicopter)

```
┌─────────────────────────┐
│  FLIGHT PLAN             │
│                          │
│  Altitude                │
│  [=====100m=====] 50-500 │
│                          │
│  Speed                   │
│  [====Normal=====]       │
│  Slow / Normal / Fast    │
│                          │
│  Landing Options         │
│  ○ Hover  ● Land  ○ Fly-by│
│                          │
│  Waypoints:              │
│  1. (2500, 3000) [×]    │
│  2. (3200, 4100) [×]    │
│  3. (click map to add)  │
│                          │
│  [EXECUTE FLIGHT PLAN]   │
└─────────────────────────┘
```

### Path Tab (Pathfinding — Future)

Every unit gets this tab. This is where the pathfinding micro-model lives:

```
┌─────────────────────────┐
│  PATHFINDER              │
│                          │
│  Destination: (5000, 6000)│
│  Distance: 3.2km        │
│                          │
│  Route Type              │
│  ● Shortest  ○ Safest   │
│                          │
│  Avoid:                  │
│  [✓] Destroyed routes    │
│  [✓] Mined areas         │
│  [ ] Enemy positions     │
│                          │
│  ┌────────────────────┐  │
│  │    Map shows       │  │
│  │    computed path   │  │
│  └────────────────────┘  │
│                          │
│  Terrain: 45% road       │
│  Est. time: 42 seconds   │
│                          │
│  [FOLLOW PATH]           │
│  [SET WAYPOINTS]         │
└─────────────────────────┘
```

Each tab is a self-contained micro-model UI — it owns its own state, controls, and produces a structured output (command + parameters) sent through the bridge.

---

## Multi-Select System

### Interaction: Ctrl+Click

1. **Hold `Ctrl`** → enters multi-select mode
2. **Click a unit** → adds to selection, unit highlights
3. **Click again** → removes from selection (toggle)
4. **Click empty area** → nothing happens (doesn't deselect all)
5. **Release `Ctrl`** → exits multi-select mode, selection persists

### On-Screen Selection List

When in multi-select mode, a floating panel appears:

```
┌──────────────────────┐
│ SELECTION (3)         │
│                      │
│ ● Alpha 1  Infantry  │
│ ● Alpha 2  Infantry  │
│ ● Bravo 3  Artillery │
│                      │
│ [Move All] [Hold]    │
│ [Clear]              │
└──────────────────────┘
```

Position: bottom-left or top-right corner, out of the way but visible.

- Panel only visible while `Ctrl` is held (or until selection is cleared)
- Clicking a unit name in the list highlights that unit on the map
- `[Clear]` button or pressing `Esc` deselects everything
- Action buttons (Move All, Hold) only show when 2+ units selected

### Single Select Still Works

- **Click without Ctrl** → selects one unit, clears previous selection
- **Ctrl+Click** → adds/removes from selection
- **Ctrl+A** → select all visible units (if desired)

### Multi-Select Actions

When multiple units are selected, the sidebar shows only actions valid for ALL selected unit types:

| Selection | Available Actions |
|-----------|-------------------|
| 3 Infantry | Move All, Hold All, Form Up, Disperse |
| 2 Infantry + 1 Artillery | Move All, Hold All (no Fire Mission) |
| 2 Vehicles | Move All, Hold All |
| Mixed (infantry + vehicle + artillery) | Move All, Hold All |

### Works Identically in 2D and 3D

Same mechanism in both views: click on unit marker, check if Ctrl is held, toggle selection. No coordinate system differences.

### Edge Cases

- **Hundreds of units:** Panel collapses to count ("+47 more"), scrollable list
- **Units at different zoom levels:** Selection persists across zoom changes
- **3D view tilted:** Click detection works via raycasting to unit meshes

---

## Map Annotations

User-placed markers and zones on the map for planning and operational purposes. These are separate from unit markers and contact markers — they're the commander's own notes.

### Annotation Types

| Type | Visual | Purpose |
|------|--------|---------|
| Point marker | Pin icon with label | Rendezvous point, rally point, objective |
| Line | Dashed line with endpoints | Phase line, boundary, route |
| Zone | Semi-transparent polygon | No-go area, danger zone, objective area |
| Text note | Floating text at position | Free-form note ("ambush here", "minefield") |

### Interaction

**Placing an annotation:**
1. Click annotation tool in toolbar (or keyboard shortcut: `M` for marker, `Z` for zone, `L` for line)
2. Click on map to place point / click multiple times to draw polygon
3. Small popup asks for label and type
4. Annotation appears on map

**Editing:**
- Click annotation → shows edit panel (change label, type, color)
- Drag to reposition
- Delete key to remove

**Feeds into pathfinding:**
- "No-go" zones → added to pathfinding cost grid as impassable
- "Danger" zones → added as high-cost cells
- "Rally point" → potential waypoint for pathfinding

### Data Model

```json
{
  "id": "ann_1",
  "type": "zone",
  "zone_type": "nogo",
  "label": "Minefield Alpha",
  "points": [{"x": 3000, "y": 4000}, {"x": 3200, "y": 4100}, {"x": 3100, "y": 4300}],
  "color": "#ff0000",
  "opacity": 0.3,
  "created_at": "2026-07-23T12:00:00Z"
}
```

### Visibility

- Annotations visible on both 2D and 3D maps
- Can be toggled on/off per type (show/hide all zones, show/hide all markers)
- Stored in Redux store, not persisted to disk (session-only)

---

## Logging System

Record commands, events, and unit state during a mission for after-action review and debugging.

### Mission Lifecycle

The app has a mission phase system (already exists in store: `PLANNING`, `EXECUTING`, `COMPLETE`).

**Logging is tied to mission phase:**
- `PLANNING` → logging is OFF
- `EXECUTING` → logging starts, records all events
- `COMPLETE` → logging stops, AAR (After Action Review) panel opens

### What Gets Logged

| Event Type | Data | When |
|------------|------|------|
| COMMAND_SENT | unit_id, command, args, timestamp | User sends any command |
| COMMAND_ACK | unit_id, command, success | Arma confirms execution |
| UNIT_MOVED | unit_id, from_pos, to_pos | Unit position changes significantly |
| CONTACT_SPOTTED | contact_id, type, position, source | New enemy detected |
| CONTACT_UPDATE | contact_id, position, state | Enemy position updated |
| CONTACT_KILLED | contact_id, position | Enemy destroyed |
| UNIT_KILLED | unit_id, position, cause | Friendly unit lost |
| DAMAGE_TAKEN | unit_id, amount, source | Unit takes damage |
| ZONE_ENTERED | unit_id, zone_id | Unit enters an annotation zone |
| MESSAGE | text, source, priority | Comms/log entries |

### Log Storage

```json
{
  "mission_id": "2026-07-23_12-00",
  "start_time": "2026-07-23T12:00:00Z",
  "end_time": "2026-07-23T12:35:00Z",
  "duration_sec": 2100,
  "events": [
    {
      "type": "COMMAND_SENT",
      "unit_id": "alpha_1",
      "command": "MOVE_TO",
      "args": {"x": 2500, "y": 3000},
      "timestamp": "2026-07-23T12:01:15Z"
    },
    {
      "type": "CONTACT_SPOTTED",
      "contact_id": "hostile_1",
      "type": "INFANTRY",
      "position": {"x": 4000, "y": 5000},
      "source": "alpha_1",
      "timestamp": "2026-07-23T12:02:30Z"
    }
  ]
}
```

### AAR Panel (After Action Review)

When mission completes, the AAR panel shows:
- Timeline of events (scrollable)
- Unit performance summary (distance moved, shots fired, kills)
- Enemy engagement summary
- Command log (what was ordered vs what happened)
- Export as JSON for external analysis

### Testing Mode

For development/testing outside of mission context:
- Logging is OFF by default
- A "Start Mission" button in the toolbar activates logging
- A "End Mission" button stops logging and shows AAR
- This prevents test sessions from flooding the log with irrelevant data

---

## Enemy Tracking (Existing)

Already implemented in the app. No new work needed here, just documentation.

### How It Works

- Arma bridge queries `groups` command to detect enemy units within sensor range of friendly units
- Detected enemies are stored as `contacts` in the Redux store
- Each contact has: `id, type, position, state, source, last_seen`

### Contact States

| State | Meaning | Map Visual |
|-------|---------|------------|
| CONFIRMED | Actively detected, current position known | Red marker |
| LAST_KNOWN | Was detected, position may be stale | Orange marker |
| SUSPECTED | Intel suggests presence, not directly observed | Yellow marker |

### Contact Types

INFANTRY, VEHICLE, TANK, UNKNOWN — shown with different symbols on the 2D map (●, ■, ▲, ?).

### 2D Map (Already Works)

Contacts render as colored markers on the Leaflet map via `contactLayer`. Clicking a contact shows tooltip with type, state, source, and age (minutes since last seen).

### 3D Map (Not Yet Implemented)

`MapView3D` only receives `units` prop, not `contacts`. To add contacts to3D view:
- Pass `contacts` prop to `MapView3D`
- Render enemy contacts as red markers (similar to friendly unit markers but red)
- Use raycasting for click detection
