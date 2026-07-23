/*
  SPECTRE C2 Bridge - Arma 3 PBO Addon v2.3
  ===========================================
  Auto-executed via CBA XEH PostInit.
  No manual init.sqf editing needed — just enable the mod.

  HOW IT WORKS:
  Arma -> SPECTRE : diag_log writes to the Arma RPT log file.
                    SPECTRE tails that log file and parses SPECTRE_STATE: lines.
  SPECTRE -> Arma : SPECTRE writes "spectre_to_arma.sqf" into the mission folder.
                    This script reads it with loadFile + call compile every 0.75s.
*/

// ─── Rate config (globals — spawn block can't see private locals) ─────────────
SPECTRE_broadcastRate = 0.5;
SPECTRE_cmdReadRate   = 0.3;

// ─── Map coordinate lookup ────────────────────────────────────────────────────
// Format: [origin_lat, origin_lng, meters_per_lat, meters_per_lng]
SPECTRE_mapCoords = createHashMap;
SPECTRE_mapCoords set ["altis",    [39.0, 21.0, 111000, 85000]];
SPECTRE_mapCoords set ["stratis",  [39.0, 21.0, 111000, 85000]];
SPECTRE_mapCoords set ["tanoa",    [-6.0, 149.0, 111000, 111000]];
SPECTRE_mapCoords set ["livonia",  [51.0, 17.0, 111000, 63000]];
SPECTRE_mapCoords set ["malden",   [42.0, 3.0, 111000, 78000]];
SPECTRE_mapCoords set ["enoch",    [51.0, 17.0, 111000, 63000]];
SPECTRE_mapCoords set ["tem_anizay", [37.0, 71.0, 111000, 88000]];
SPECTRE_mapCoords set ["cola",     [-23.0, -68.0, 111000, 95000]];

// ─── Global state ─────────────────────────────────────────────────────────────
SPECTRE_blufor         = [];
SPECTRE_spottedEnemies = [];
SPECTRE_initialized    = false;

// ─── Get map coordinate data ──────────────────────────────────────────────────
private _mapName = toLowerANSI worldName;
SPECTRE_mapData = SPECTRE_mapCoords getOrDefault [_mapName, [0, 0, 111000, 85000]];

// ─── Collect friendly units and vehicles ──────────────────────────────────────
SPECTRE_blufor = [];

// Infantry
private _infantry = allUnits select { side _x == west || side _x == blufor };
if (_infantry isEqualTo []) then {
    _infantry = allUnits select {
        isPlayer _x || (!(vehicle _x isEqualTo _x) && side _x == west)
    };
};
SPECTRE_blufor append _infantry;

// Vehicles (only crewed or player-owned)
private _vehicles = vehicles select {
    side _x == west || side _x == blufor
};
{
    if !(_x in SPECTRE_blufor) then {
        SPECTRE_blufor pushBack _x;
    };
} forEach _vehicles;

// Assign variable names to units that don't have one (for command targeting)
{
    private _vn = vehicleVarName _x;
    if (_vn isEqualTo "") then {
        _vn = format ["SPECTRE_%1", _forEachIndex];
        _x setVehicleVarName _vn;
        // Also register in missionNamespace so getVariable works
        missionNamespace setVariable [_vn, _x];
    };
    _x setVariable ["SPECTRE_spawnPos",     getPos _x,          false];
    _x setVariable ["SPECTRE_wasAlive",     alive _x,           false];
    _x setVariable ["SPECTRE_callsign",     _vn,                false];
    _x setVariable ["SPECTRE_currentOrder", "",                 false];
} forEach SPECTRE_blufor;

diag_log format ["SPECTRE: Initialized — tracking %1 blufor assets on %2", count SPECTRE_blufor, _mapName];

// ─── Vehicle type classifier ──────────────────────────────────────────────────
SPECTRE_fnc_vehicleType = {
    params ["_v"];
    if (_v isKindOf "Helicopter")  exitWith { "HELI" };
    if (_v isKindOf "Plane")       exitWith { "PLANE" };
    if (_v isKindOf "Ship")        exitWith { "BOAT" };
    if (_v isKindOf "Truck_F")     exitWith { "TRUCK" };
    if (_v isKindOf "Tank")        exitWith { "TANK" };
    if (_v isKindOf "Wheeled_APC_F") exitWith { "IFV" };
    if (_v isKindOf "Car")         exitWith { "CAR" };
    if (_v isKindOf "Man")         exitWith { "INFANTRY" };
    "VEHICLE"
};

// ─── Serialize one unit to a JSON string ──────────────────────────────────────
SPECTRE_fnc_serializeUnit = {
    params ["_unit"];

    private _cs = _unit getVariable ["SPECTRE_callsign", vehicleVarName _unit];
    if (_cs isEqualTo "") then {
        _cs = format ["UNIT_%1", SPECTRE_blufor find _unit];
    };
    _cs = _cs regexReplace ["""", ""];

    private _pos   = getPos _unit;
    private _px    = _pos select 0;
    private _py    = _pos select 1;
    private _hp    = round ((1 - getDammage _unit) * 100);
    private _vtype = [_unit] call SPECTRE_fnc_vehicleType;
    private _order = (_unit getVariable ["SPECTRE_currentOrder", ""]) regexReplace ["""", ""];
    private _status = if (!alive _unit) then { "DEAD" } else { "READY" };

    // Map coordinate conversion using lookup table
    private _originLat = SPECTRE_mapData select 0;
    private _originLng = SPECTRE_mapData select 1;
    private _mPerLat   = SPECTRE_mapData select 2;
    private _mPerLng   = SPECTRE_mapData select 3;
    private _lat = _originLat + (_py / _mPerLat);
    private _lng = _originLng + (_px / _mPerLng);

    // Fuel (vehicles only)
    private _fuelStr = "";
    if !(_unit isKindOf "Man") then {
        _fuelStr = format [",""fuel"":%1", round (fuel _unit * 100)];
    };

    // Speed in km/h (vehicles only)
    private _speedStr = "";
    if !(_unit isKindOf "Man") then {
        _speedStr = format [",""speed"":%1", round (speed _unit)];
    };

    // Ammo count (total magazines)
    private _ammoStr = format [",""ammo"":%1", count magazines _unit];

    // Vehicle membership (for infantry inside vehicles)
    private _vehicleStr = "";
    private _roleStr = "";
    if (_unit isKindOf "Man") then {
        private _veh = vehicle _unit;
        if !(_veh isEqualTo _unit) then {
            private _vcs = _veh getVariable ["SPECTRE_callsign", vehicleVarName _veh];
            if (_vcs isEqualTo "") then {
                _vcs = format ["UNIT_%1", SPECTRE_blufor find _veh];
            };
            _vehicleStr = format [",""vehicle"":""%1""", _vcs regexReplace ["""", ""]];
            private _role = assignedVehicleRole _unit;
            if (count _role > 0) then {
                _roleStr = format [",""vehicle_role"":""%1""", _role select 0];
            };
        };
    };

    // Crew list (for vehicles)
    private _crewStr = "";
    if !(_unit isKindOf "Man") then {
        private _crewArr = [];
        {
            private _ccs = _x getVariable ["SPECTRE_callsign", vehicleVarName _x];
            if (_ccs isEqualTo "") then {
                _ccs = format ["UNIT_%1", SPECTRE_blufor find _x];
            };
            private _crole = assignedVehicleRole _x;
            private _croleStr = if (count _crole > 0) then { _crole select 0 } else { "CARGO" };
            _crewArr pushBack format ["""%1""", _ccs regexReplace ["""", ""]];
        } forEach (crew _unit);
        if (count _crewArr > 0) then {
            _crewStr = format [",""crew"":[%1]", _crewArr joinString ","];
        };
    };

    private _orderStr = "";
    if !(_order isEqualTo "") then {
        _orderStr = format [",""order"":""%1""", _order];
    };

    format [
        "{""id"":""%1"",""vtype"":""%2"",""pos"":{""x"":%3,""y"":%4,""lat"":%5,""lng"":%6},""hdg"":%7,""hp"":%8%9%10%11%12%13%14%15,""st"":""%16""}",
        _cs, _vtype,
        round _px, round _py,
        _lat, _lng,
        round getDir _unit,
        _hp,
        _fuelStr,
        _speedStr,
        _ammoStr,
        _vehicleStr,
        _roleStr,
        _crewStr,
        _orderStr,
        _status
    ]
};

// ─── Serialize one enemy contact to a JSON string ────────────────────────────
SPECTRE_fnc_serializeContact = {
    params ["_unit", "_contactId"];

    private _pos   = getPos _unit;
    private _px    = _pos select 0;
    private _py    = _pos select 1;
    private _type  = [_unit] call SPECTRE_fnc_vehicleType;

    private _originLat = SPECTRE_mapData select 0;
    private _originLng = SPECTRE_mapData select 1;
    private _mPerLat   = SPECTRE_mapData select 2;
    private _mPerLng   = SPECTRE_mapData select 3;
    private _lat = _originLat + (_py / _mPerLat);
    private _lng = _originLng + (_px / _mPerLng);

    format [
        "{""id"":""%1"",""type"":""%2"",""position"":{""x"":%3,""y"":%4,""lat"":%5,""lng"":%6},""state"":""CONFIRMED"",""source"":""VISUAL"",""confidence"":""HIGH""}",
        _contactId, _type,
        round _px, round _py,
        _lat, _lng
    ]
};

// ─── Command executor ─────────────────────────────────────────────────────────
SPECTRE_fnc_execCmd = {
    params [
        "_id",
        "_type",
        "_unitId",
        ["_waypoints", []],
        ["_roe",       ""],
        ["_action",    ""]
    ];

    private _unit = missionNamespace getVariable [_unitId, objNull];
    diag_log format ["SPECTRE CMD: %1 -> %2 (units=%3)", _type, _unitId, count SPECTRE_blufor];

    switch (_type) do {

        case "HOLD": {
            if (!isNull _unit) then {
                doStop _unit;
                _unit setVariable ["SPECTRE_currentOrder", "HOLD", false];
            };
        };

        case "HOLD_ALL": {
            {
                doStop _x;
                _x setVariable ["SPECTRE_currentOrder", "HOLD", false];
            } forEach SPECTRE_blufor;
        };

        case "RTB": {
            if (!isNull _unit) then {
                private _sp = _unit getVariable ["SPECTRE_spawnPos", getPos _unit];
                _unit doMove _sp;
                _unit setVariable ["SPECTRE_currentOrder", "RTB", false];
            };
        };

        case "RTB_ALL": {
            {
                private _sp = _x getVariable ["SPECTRE_spawnPos", getPos _x];
                _x doMove _sp;
                _x setVariable ["SPECTRE_currentOrder", "RTB", false];
            } forEach SPECTRE_blufor;
        };

        case "WEAPONS_FREE": {
            {
                _x setCombatMode "RED";
                _x setBehaviour "COMBAT";
                _x setVariable ["SPECTRE_currentOrder", "WEAPONS FREE", false];
            } forEach SPECTRE_blufor;
        };

        case "WEAPONS_SAFE": {
            {
                _x setCombatMode "BLUE";
                _x setBehaviour "AWARE";
                _x setVariable ["SPECTRE_currentOrder", "WEAPONS SAFE", false];
            } forEach SPECTRE_blufor;
        };

        case "FORM_UP": {
            private _alive = SPECTRE_blufor select { alive _x };
            if (count _alive > 0) then {
                private _rallyPos = getPos (_alive select 0);
                {
                    _x doMove _rallyPos;
                    _x setVariable ["SPECTRE_currentOrder", "FORM UP", false];
                } forEach _alive;
            };
        };

        case "DISPERSE": {
            {
                private _base   = getPos _x;
                private _offset = [(random 80) - 40, (random 80) - 40, 0];
                _x doMove (_base vectorAdd _offset);
                _x setVariable ["SPECTRE_currentOrder", "DISPERSE", false];
            } forEach SPECTRE_blufor;
        };

        case "EXECUTE_ORDER": {
            if (!isNull _unit) then {
                if (!(_action isEqualTo "")) then {
                    _unit setVariable ["SPECTRE_currentOrder", _action, false];
                };

                private _grp = group _unit;
                while { count (waypoints _grp) > 0 } do {
                    deleteWaypoint [_grp, 0];
                };

                {
                    private _wp = _x;
                    private _wx = _wp select 0;
                    private _wy = _wp select 1;
                    if (_wx != 0 || _wy != 0) then {
                        private _newWP = _grp addWaypoint [[_wx, _wy, 0], 0];
                        _newWP setWaypointType             "MOVE";
                        _newWP setWaypointCompletionRadius 15;
                        _newWP setWaypointBehaviour        "COMBAT";
                        _newWP setWaypointSpeed            "FULL";
                    };
                } forEach _waypoints;

                switch (true) do {
                    case (_roe find "HOLD" >= 0): {
                        _unit setCombatMode "BLUE";
                        _unit setBehaviour  "AWARE";
                    };
                    case (_roe find "ENGAGE IF FIRED" >= 0): {
                        _unit setCombatMode "YELLOW";
                        _unit setBehaviour  "AWARE";
                    };
                    default {
                        _unit setCombatMode "RED";
                        _unit setBehaviour  "COMBAT";
                    };
                };
            };
        };

        case "CUSTOM": {
            if (!isNull _unit) then {
                _unit setVariable ["SPECTRE_currentOrder", _action, false];
                diag_log format ["SPECTRE CUSTOM [%1]: %2", _unitId, _action];
            };
        };
    };
};

// ─── Detect events since last poll ────────────────────────────────────────────
SPECTRE_fnc_detectEvents = {
    private _evts = [];

    {
        private _unit = _x;
        if (!alive _unit && (_unit getVariable ["SPECTRE_wasAlive", true])) then {
            _unit setVariable ["SPECTRE_wasAlive", false, false];
            private _cs      = _unit getVariable ["SPECTRE_callsign", vehicleVarName _unit];
            private _evtType = if (_unit isKindOf "Man") then { "UNIT_KIA" } else { "VEHICLE_DESTROYED" };
            _evts pushBack format [
                "{""type"":""%1"",""unit"":""%2"",""id"":""%1_%2_%3""}",
                _evtType, _cs, round time
            ];
        };
    } forEach SPECTRE_blufor;

    {
        private _enemy    = _x;
        private _enemyKey = str _enemy;

        if (!(_enemyKey in SPECTRE_spottedEnemies)) then {
            private _spotters = SPECTRE_blufor select { _x knowsAbout _enemy > 0.3 };
            if (count _spotters > 0) then {
                SPECTRE_spottedEnemies pushBack _enemyKey;
                if (count SPECTRE_spottedEnemies > 200) then {
                    SPECTRE_spottedEnemies = SPECTRE_spottedEnemies select [100, (count SPECTRE_spottedEnemies) - 100];
                };
                private _su       = _spotters select 0;
                private _spotterCs = _su getVariable ["SPECTRE_callsign", vehicleVarName _su];
                _evts pushBack format [
                    "{""type"":""CONTACT_SPOTTED"",""unit"":""%1"",""contact_type"":""%2"",""id"":""CS_%3_%4""}",
                    _spotterCs,
                    [_enemy] call SPECTRE_fnc_vehicleType,
                    SPECTRE_blufor find _su,
                    round time
                ];
            };
        };
    } forEach (allUnits select {
        private _e = _x;
        (side _e == east || side _e == independent) &&
        alive _e &&
        { _x knowsAbout _e > 0.3 } count SPECTRE_blufor > 0
    });

    _evts
};

// ─── Full state broadcast via diag_log (one line per unit to avoid RPT truncation) ──
SPECTRE_fnc_broadcastState = {
    private _ts = round (time * 1000);

    // Send metadata (short line, won't truncate)
    private _mapName = worldName;
    private _mp = getMissionPath "";
    private _mf = "";
    private _fullPath = (_mp regexReplace ["\\\\$", ""]); // full path without trailing backslash
    if (count _fullPath > 0) then {
        private _parts = _fullPath splitString "\\";
        private _cnt = count _parts;
        if (_cnt >= 2) then {
            _mf = format ["%1\\%2", _parts select (_cnt - 2), _parts select (_cnt - 1)];
        } else { _mf = _fullPath; };
    };
    diag_log format ["SPECTRE_META:{""map"":""%1"",""mf"":""%2"",""path"":""%3"",""ts"":%4}", _mapName, _mf regexReplace ["\\", "\\\\"], _fullPath regexReplace ["\\", "\\\\"], _ts];

    // Send each unit on its own line (well under 1024 char RPT limit)
    {
        if (!isNull _x) then {
            diag_log format ["SPECTRE_UNIT:%1", [_x] call SPECTRE_fnc_serializeUnit];
        };
    } forEach SPECTRE_blufor;

    // Send contacts (one per line)
    private _ci = 0;
    {
        private _e = _x;
        if ((side _e == east || side _e == independent) && alive _e &&
            { _x knowsAbout _e > 0.3 } count SPECTRE_blufor > 0) then {
            diag_log format ["SPECTRE_CONTACT:%1", [_e, format ["HOSTILE-%1", _ci]] call SPECTRE_fnc_serializeContact];
            _ci = _ci + 1;
        };
    } forEach allUnits;

    // Send events (usually few, one line)
    private _evts = call SPECTRE_fnc_detectEvents;
    if (count _evts > 0) then {
        diag_log format ["SPECTRE_EVENTS:[%1]", _evts joinString ","];
    };
};

// ─── Command reader ───────────────────────────────────────────────────────────
// Parses the command file content and executes via execCmd.
// No call compile — uses direct parsing + function call.
SPECTRE_fnc_readCommands = {
    private _result = "spectre_ext" callExtension ["READ", ["addons\spectre_cmds.sqf"]];
    if (count _result < 3) exitWith {};
    private _sqf = _result select 0;
    if (_sqf isEqualTo "" || { _sqf find "ERR_" == 0 }) exitWith {};

    // Content-based dedup: skip if same content as last read
    if (_sqf == SPECTRE_lastSQF) exitWith {};
    SPECTRE_lastSQF = _sqf;

    diag_log format ["SPECTRE: CMD %1", _sqf select [0, 60]];

    // Extract the argument array by finding everything before " call SPECTRE_fnc_execCmd;"
    // Handles both: [id, "TYPE", "UID"] and: [id, "EXECUTE_ORDER", "UID", [wp,wp], "ROE", "act"]
    private _callIdx = _sqf find " call SPECTRE_fnc_execCmd;";
    if (_callIdx < 0) exitWith {};
    private _argsStr = _sqf select [0, _callIdx];
    if (_argsStr select [0, 1] != "[") exitWith {};

    private _args = call compile _argsStr;
    if (!isNil "_args" && { typeName _args == "ARRAY" }) then {
        _args call SPECTRE_fnc_execCmd;
        diag_log format ["SPECTRE: Executed OK: %1", _argsStr select [0, 50]];
    } else {
        diag_log format ["SPECTRE: Bad args: %1", _argsStr];
    };
};

// ─── Main loop ────────────────────────────────────────────────────────────────
hint "SPECTRE C2 Bridge: ACTIVE";
diag_log "SPECTRE: Bridge running (wall-clock mode). Broadcasting every 0.5s, reading commands every 0.3s.";
SPECTRE_initialized = true;
SPECTRE_lastSQF = "";

[] spawn {
    private _lastBroadcast = -999;
    private _lastCmdRead   = -999;

    while { true } do {
        // diag_tickTime = real wall-clock time, NOT affected by Arma's
        // simulation throttle when backgrounded. This keeps broadcasts
        // running even when the user alt-tabs away from Arma.
        private _t = diag_tickTime;

        if (_t - _lastBroadcast >= SPECTRE_broadcastRate) then {
            _lastBroadcast = _t;
            call SPECTRE_fnc_broadcastState;
        };

        if (_t - _lastCmdRead >= SPECTRE_cmdReadRate) then {
            _lastCmdRead = _t;
            call SPECTRE_fnc_readCommands;
        };

        // uiSleep uses real time, NOT simulation time.
        // Regular sleep slows to a crawl when Arma is backgrounded.
        uiSleep 0.1;
    };
};
