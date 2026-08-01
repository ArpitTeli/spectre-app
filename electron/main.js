const { app, BrowserWindow, ipcMain, crashReporter, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const http = require('http');
const WebSocket = require('ws');
const { detectArma3, detectArmaDocuments, findLatestRptLog } = require('./armaDetector');

// ─── Single instance lock ────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── Crash reporter ──────────────────────────────────────────────────────────
crashReporter.start({
  companyName: 'SPECTRE',
  productName: 'SPECTRE C2',
  submitURL: '',
  uploadToServer: false,
  compress: true,
});

// ─── Directory paths ─────────────────────────────────────────────────────────
const USER_DATA    = app.getPath('userData');
const BRIDGE_DIR   = path.join(USER_DATA, 'bridge');
const MISSIONS_DIR = path.join(USER_DATA, 'missions');
const INTEL_DIR    = path.join(USER_DATA, 'intel');
const CONFIG_PATH  = path.join(USER_DATA, 'config.json');
const VAULTS_DIR   = path.join(USER_DATA, 'vaults');

// ─── Auto-detect Arma 3 ─────────────────────────────────────────────────────
let _configData;
try { _configData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { _configData = {}; }

let ARMA_INSTALL = (_configData.arma_path && fs.existsSync(_configData.arma_path))
  ? _configData.arma_path
  : detectArma3();
const ARMA_DOCS    = detectArmaDocuments();
const ARMA_SPECTRE = ARMA_DOCS ? path.join(ARMA_DOCS, 'SPECTRE') : null;

// Persist detected path back to config if we found one and config didn't have it
if (ARMA_INSTALL && !_configData.arma_path) {
  try {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
    cfg.arma_path = ARMA_INSTALL;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (_) {}
}

const DEBUG_LOG = path.join(USER_DATA, 'debug.log');
function dbg(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    // Rotate debug log if > 10 MB to prevent unbounded growth
    try {
      const st = fs.statSync(DEBUG_LOG);
      if (st.size > 10 * 1024 * 1024) {
        const backup = DEBUG_LOG + '.1';
        try { fs.unlinkSync(backup); } catch (_) {}
        fs.renameSync(DEBUG_LOG, backup);
      }
    } catch (_) {}
    fs.appendFileSync(DEBUG_LOG, line);
  } catch (_) {}
  console.log(line.trimEnd());
}

dbg('SPECTRE: App starting');
dbg('SPECTRE: Arma 3 install: ' + (ARMA_INSTALL || '(not found)'));
dbg('SPECTRE: Arma 3 documents: ' + ARMA_DOCS);
dbg('SPECTRE: Config path: ' + CONFIG_PATH);

// ─── Default config ──────────────────────────────────────────────────────────
const RELAY_URL = 'wss://spectre-relay.onrender.com'; // cloud relay (Render free tier)
const DEFAULT_CONFIG = {
  mode:          'host', // 'host' or 'client'
  room_code:     '',
  relay_url:     RELAY_URL,
  ai_provider:   'openrouter',
  api_keys:      [],
  model:         'qwen/qwen3-next-80b-a3b-instruct:free',
  fallback_model:'qwen/qwen3-next-80b-a3b-instruct:free',
  base_url:      'https://openrouter.ai/api/v1',
  mission_folder_path: '',
  arma_path:     '',
  auto_abort_threshold: {
    firepower_loss_pct: 50,
    crew_kia: 2
  }
};

// ─── Ensure directories exist ────────────────────────────────────────────────
[BRIDGE_DIR, MISSIONS_DIR, INTEL_DIR, VAULTS_DIR].forEach(d => {
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch (_) {}
});
if (ARMA_DOCS && ARMA_SPECTRE) {
  try { if (!fs.existsSync(ARMA_SPECTRE)) fs.mkdirSync(ARMA_SPECTRE, { recursive: true }); } catch (_) {}
}
if (!fs.existsSync(CONFIG_PATH)) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
}

// ─── WebSocket Server (live web viewer) ──────────────────────────────────────
const WS_PORT = 3721;
let wss = null;
let wsClients = new Set();
let lastBroadcastState = null;

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function startWebSocketServer() {
  // HTTP server that serves the web viewer HTML
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getWebViewerHTML());
    } else if (req.url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(lastBroadcastState || {}));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    dbg(`SPECTRE: WebSocket client connected (${wsClients.size} total)`);

    // Send current state immediately on connect
    if (lastBroadcastState) {
      ws.send(JSON.stringify(lastBroadcastState));
    }

    ws.on('close', () => {
      wsClients.delete(ws);
      dbg(`SPECTRE: WebSocket client disconnected (${wsClients.size} total)`);
    });

    ws.on('error', () => {
      wsClients.delete(ws);
    });
  });

  server.listen(WS_PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log(`SPECTRE: Web viewer running at http://${ip}:${WS_PORT}`);
    dbg(`SPECTRE: Web viewer running at http://${ip}:${WS_PORT}`);
  });

  server.on('error', (err) => {
    console.error('SPECTRE: WebSocket server error:', err.message);
  });
}

function broadcastToWebClients(data) {
  lastBroadcastState = data;
  if (wsClients.size === 0) return;
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch (_) {}
    }
  }
}

// ─── Vercel Relay (POST state to hosted web viewer) ─────────────────────────
let vercelUrl = null;
let vercelPostQueue = [];
let vercelPosting = false;

function setVercelUrl(url) {
  vercelUrl = url ? url.replace(/\/+$/, '') : null;
  dbg(`SPECTRE: Vercel relay URL set to: ${vercelUrl || '(disabled)'}`);
}

async function postToVercel(data) {
  if (!vercelUrl) return;
  vercelPostQueue.push(JSON.parse(JSON.stringify(data)));
  if (vercelPostQueue.length > 100) vercelPostQueue.shift();
  if (vercelPosting) return;
  vercelPosting = true;

  while (vercelPostQueue.length > 0) {
    const payload = vercelPostQueue.shift();
    try {
      const res = await fetch(`${vercelUrl}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        dbg(`SPECTRE: Vercel POST failed: ${res.status}`);
      }
    } catch (e) {
      dbg(`SPECTRE: Vercel POST error: ${e.message}`);
    }
  }
  vercelPosting = false;
}

// ─── Cloud Relay Connection (Host/Client modes) ─────────────────────────────
let relayWs = null;
let relayConnected = false;
let relayRoomCode = '';
let relayMode = 'host'; // 'host' or 'client'
let relayReconnectTimer = null;
let relayFatalError = false; // true when server rejects (don't reconnect)
let relayIntentionalClose = false; // true when user initiated disconnect
let relayReconnectAttempts = 0;
const RELAY_MAX_RECONNECTS = 10; // stop after 10 failures (~30s)

function connectToRelay(mode, roomCode, url, _isReconnect) {
  relayMode = mode;
  relayRoomCode = roomCode;
  relayFatalError = false;
  if (!_isReconnect) relayReconnectAttempts = 0;
  if (relayWs) { relayWs.close(); relayWs = null; }
  if (relayReconnectTimer) { clearTimeout(relayReconnectTimer); relayReconnectTimer = null; }

  const relayUrl = url || RELAY_URL;
  dbg(`SPECTRE: Connecting to relay as ${mode}, room ${roomCode}, url ${relayUrl}`);
  sendToRenderer('relay-status', { connected: false, connecting: true, mode, room: roomCode });

  try {
    relayWs = new WebSocket(relayUrl);
  } catch (e) {
    dbg(`SPECTRE: Relay connect error: ${e.message}`);
    scheduleReconnect(mode, roomCode, url);
    return;
  }

  const thisSocket = relayWs;
  relayIntentionalClose = false;

  thisSocket.on('open', () => {
    if (relayWs !== thisSocket) return;
    relayConnected = true;
    relayReconnectAttempts = 0; // reset on successful connect
    dbg('SPECTRE: Relay connected, joining room...');
    try { thisSocket.send(JSON.stringify({ type: 'join', room: roomCode, role: mode })); } catch (_) {}
  });

  thisSocket.on('message', (raw) => {
    if (relayWs !== thisSocket) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'joined') {
      dbg(`SPECTRE: Joined room ${msg.room} as ${msg.role}`);
      sendToRenderer('relay-status', { connected: true, mode, room: roomCode, clients: msg.clients });
    }

    if (msg.type === 'client_count') {
      sendToRenderer('relay-status', { connected: true, mode, room: roomCode, clients: msg.count });
    }

    // Client receives state from relay
    if (msg.type === 'state' && relayMode === 'client') {
      sendToRenderer('arma-state-update', msg.data);
    }

    // Host receives commands from relay
    if (msg.type === 'command' && relayMode === 'host') {
      if (msg.data) {
        queueCommand(msg.data);
        dbg(`SPECTRE: Relay command received: ${msg.data.type}`);
      }
    }

    if (msg.type === 'host_disconnected') {
      sendToRenderer('relay-status', { connected: false, mode, room: roomCode, error: 'Host disconnected' });
    }

    if (msg.type === 'error') {
      dbg(`SPECTRE: Relay error: ${msg.message}`);
      // Fatal errors (room taken, invalid request) — don't reconnect
      relayFatalError = true;
      sendToRenderer('relay-status', { connected: false, mode, room: roomCode, error: msg.message, fatal: true });
    }
  });

  thisSocket.on('close', () => {
    if (relayWs !== thisSocket) return;
    relayConnected = false;
    dbg('SPECTRE: Relay disconnected');
    // Don't auto-reconnect on fatal errors or intentional disconnect
    if (!relayFatalError && !relayIntentionalClose) {
      sendToRenderer('relay-status', { connected: false, mode, room: roomCode });
      scheduleReconnect(mode, roomCode, url);
    }
    relayIntentionalClose = false;
  });

  thisSocket.on('error', (e) => {
    if (relayWs !== thisSocket) return;
    dbg(`SPECTRE: Relay WebSocket error: ${e.message}`);
    // Treat HTTP upgrade failures (404, 500, etc.) as fatal
    if (e.message && (/\b40[34]\b/.test(e.message) || e.message.includes('Unexpected server response'))) {
      relayFatalError = true;
      dbg('SPECTRE: relay server rejected connection — fatal');
      try { thisSocket.close(); } catch (_) {}
    }
  });

  }
function scheduleReconnect(mode, roomCode, url) {
  if (relayReconnectTimer) return;
  relayReconnectAttempts++;
  if (relayReconnectAttempts > RELAY_MAX_RECONNECTS) {
    dbg(`SPECTRE: relay reconnect gave up after ${RELAY_MAX_RECONNECTS} attempts`);
    sendToRenderer('relay-status', { connected: false, mode, room: roomCode, error: 'Relay unreachable', fatal: true });
    return;
  }
  const delay = Math.min(3000 * relayReconnectAttempts, 30000); // backoff up to 30s
  relayReconnectTimer = setTimeout(() => {
    relayReconnectTimer = null;
    if (!relayConnected) {
      dbg(`SPECTRE: Attempting relay reconnect (${relayReconnectAttempts}/${RELAY_MAX_RECONNECTS})...`);
      connectToRelay(mode, roomCode, url, true);
    }
  }, delay);
}

function sendStateToRelay(data) {
  if (!relayWs || relayWs.readyState !== WebSocket.OPEN || relayMode !== 'host') return;
  try {
    relayWs.send(JSON.stringify({ type: 'state', data }));
  } catch (e) {
    dbg(`SPECTRE: Relay send error: ${e.message}`);
  }
}

function disconnectRelay() {
  relayIntentionalClose = true;
  if (relayWs) { try { relayWs.close(); } catch (_) {} relayWs = null; }
  if (relayReconnectTimer) { clearTimeout(relayReconnectTimer); relayReconnectTimer = null; }
  relayConnected = false;
  relayFatalError = false;
  sendToRenderer('relay-status', { connected: false, mode: null, room: null });
}

function getWebViewerHTML() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPECTRE C2 — Live View</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #1b1b1b; color: #f5f6f7; font-family: 'Inter', system-ui, sans-serif; font-size: 13px; }
.header { background: #212121; border-bottom: 1px solid #2a2a2a; padding: 8px 16px; display: flex; align-items: center; gap: 12px; height: 40px; }
.header .logo { font-weight: 700; font-size: 13px; letter-spacing: 2px; color: #2a7de1; }
.header .status { font-family: monospace; font-size: 10px; color: #888; }
.header .dot { width: 6px; height: 6px; border-radius: 50%; background: #db3838; }
.header .dot.connected { background: #2a7de1; }
#map { width: 100%; height: calc(100vh - 40px); background: #141414; }
.legend { position: absolute; bottom: 10px; left: 10px; background: rgba(27,27,27,0.95); border: 1px solid #2a2a2a; border-radius: 3px; padding: 8px 12px; font-family: monospace; font-size: 10px; z-index: 1000; pointer-events: none; }
.legend div { margin-bottom: 2px; }
.legend .label { color: #888; margin-bottom: 4px; letter-spacing: 1px; }
</style>
</head>
<body>
<div class="header">
  <span class="logo">SPECTRE</span>
  <div class="dot" id="dot"></div>
  <span class="status" id="status">CONNECTING...</span>
  <span class="status" id="unitCount"></span>
</div>
<div id="map"></div>
<div class="legend">
  <div class="label">LEGEND</div>
  <div style="color:#2a7de1">○ FRIENDLY</div>
  <div style="color:#db3838">● HOSTILE</div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([4100, 4100], 2);
L.tileLayer('https://jetelain.github.io/Arma3Map/maps/stratis/{z}/{x}/{y}.png', {
  maxNativeZoom: 4, maxZoom: 8, tileSize: 226
}).addTo(map);
L.control.zoom({ position: 'topright' }).addTo(map);

const unitMarkers = {};
const contactMarkers = {};
let connected = false;

const VEHICLE_SYMBOL = { MBT: '▲', TANK: '▲', IFV: '■', APC: '◆', CAR: '●', RECON: '◇', HELI: '✦', TRUCK: '▪', BOAT: '◆', PLANE: '✦', INFANTRY: '●', FPV: '⌖', UAV: '◎', STOMPER: '◉', ED1: '○', DEFAULT: '○' };

function makeUnitIcon(unit) {
  const symbol = VEHICLE_SYMBOL[unit.vehicle_type || unit.vtype] || VEHICLE_SYMBOL.DEFAULT;
  const hp = unit.health ?? unit.hp ?? 100;
  const hpColor = hp > 60 ? '#2a7de1' : hp > 30 ? '#f5a623' : '#db3838';
  return L.divIcon({
    className: '', iconSize: [60, 50], iconAnchor: [30, 25],
    html: '<div style="display:flex;flex-direction:column;align-items:center">' +
      '<div style="background:rgba(27,27,27,0.95);border:1px solid #2a7de1;border-radius:3px;padding:2px 6px;font-family:monospace;font-size:9px;font-weight:600;color:#f5f6f7;letter-spacing:0.5px;white-space:nowrap;margin-bottom:2px">' + (unit.callsign || unit.id) + '</div>' +
      '<div style="font-size:14px;line-height:1;color:#2a7de1">' + symbol + '</div>' +
      '<div style="width:24px;height:3px;background:rgba(42,42,42,0.8);border-radius:2px;overflow:hidden;margin-top:2px">' +
      '<div style="width:' + hp + '%;height:100%;background:' + hpColor + ';border-radius:2px"></div></div></div>'
  });
}

function makeContactIcon(contact) {
  return L.divIcon({
    className: '', iconSize: [50, 40], iconAnchor: [25, 20],
    html: '<div style="display:flex;flex-direction:column;align-items:center">' +
      '<div style="background:rgba(27,27,27,0.95);border:1px solid #db3838;border-radius:3px;padding:2px 6px;font-family:monospace;font-size:9px;font-weight:600;color:#f5a6a6;letter-spacing:0.5px;margin-bottom:2px">' + (contact.id || '?') + '</div>' +
      '<div style="font-size:12px;line-height:1;color:#db3838">●</div></div>'
  });
}

function getLatLng(pos) {
  if (!pos) return null;
  if (pos.lat !== undefined && pos.lng !== undefined) return [pos.lat, pos.lng];
  if (pos.x !== undefined && pos.y !== undefined) return [pos.y, pos.x];
  return null;
}

function updateState(data) {
  if (!data) return;

  // Update connection status
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  dot.className = 'dot connected';
  status.textContent = 'LIVE';
  connected = true;

  // Update units
  const units = data.units || [];
  document.getElementById('unitCount').textContent = units.length + ' units';

  const seen = new Set();
  for (const u of units) {
    const latlng = getLatLng(u.position || u.pos);
    if (!latlng) continue;
    seen.add(u.id);

    if (unitMarkers[u.id]) {
      unitMarkers[u.id].setLatLng(latlng);
      unitMarkers[u.id].setIcon(makeUnitIcon(u));
    } else {
      unitMarkers[u.id] = L.marker(latlng, { icon: makeUnitIcon(u) }).addTo(map);
      unitMarkers[u.id].bindTooltip(
        '<div style="font-family:monospace;font-size:11px;background:#1b1b1b;border:1px solid #3a3a3a;padding:6px;border-radius:3px">' +
        '<b style="color:#2a7de1">' + (u.callsign || u.id) + '</b><br>' +
        (u.vehicle_type || u.vtype || '') + ' | HP:' + (u.health ?? u.hp ?? 100) + '%<br>' +
        'Status: ' + (u.status || u.st || 'OK') +
        '</div>',
        { permanent: false, direction: 'top' }
      );
    }
  }

  // Remove stale markers
  for (const id of Object.keys(unitMarkers)) {
    if (!seen.has(id)) { map.removeLayer(unitMarkers[id]); delete unitMarkers[id]; }
  }

  // Update contacts
  const contacts = data.contacts || [];
  const seenC = new Set();
  for (const c of contacts) {
    const latlng = getLatLng(c.position || c.pos);
    if (!latlng) continue;
    seenC.add(c.id);

    if (contactMarkers[c.id]) {
      contactMarkers[c.id].setLatLng(latlng);
    } else {
      contactMarkers[c.id] = L.marker(latlng, { icon: makeContactIcon(c) }).addTo(map);
    }
  }
  for (const id of Object.keys(contactMarkers)) {
    if (!seenC.has(id)) { map.removeLayer(contactMarkers[id]); delete contactMarkers[id]; }
  }

  // Fit bounds to all units
  const allLatLngs = [];
  for (const u of units) { const ll = getLatLng(u.position || u.pos); if (ll) allLatLngs.push(ll); }
  if (allLatLngs.length > 0) {
    if (allLatLngs.length === 1) { map.setView(allLatLngs[0], map.getZoom()); }
    else { map.fitBounds(L.latLngBounds(allLatLngs), { padding: [60, 60] }); }
  }
}

// WebSocket connection
function connect() {
  const ws = new WebSocket('ws://' + location.hostname + ':' + ${WS_PORT});
  ws.onopen = () => { document.getElementById('dot').className = 'dot connected'; document.getElementById('status').textContent = 'LIVE'; };
  ws.onmessage = (e) => { try { updateState(JSON.parse(e.data)); } catch (_) {} };
  ws.onclose = () => { document.getElementById('dot').className = 'dot'; document.getElementById('status').textContent = 'DISCONNECTED'; setTimeout(connect, 2000); };
  ws.onerror = () => { ws.close(); };
}
connect();
</script>
</body>
</html>`;
}

// ─── Command queue ───────────────────────────────────────────────────────────
let pendingSpectreCmds = [];   // local bridge command buffer (prevents overwrite)
let pendingCommands = [];

function buildSQFContent(commands) {
  if (commands.length === 0) return '// SPECTRE — no pending commands\n';

  const sqfSafe = (s) => (s || '').replace(/["'\[\];\n\r]/g, '').substring(0, 100);

  const lines = [];

  for (const cmd of commands) {
    // Sanitize _id to a non-negative integer to prevent SQF injection
    let rawId = parseInt(cmd._id, 10);
    if (isNaN(rawId) || rawId < 0) rawId = Date.now();
    const id   = rawId;
    const type = (cmd.type     || '').replace(/[^A-Z0-9_]/g, '');
    const uid  = sqfSafe(cmd.unit_id || 'ALL');

    switch (type) {
      case 'HOLD':
      case 'RTB':
      case 'HOLD_ALL':
      case 'RTB_ALL':
      case 'WEAPONS_FREE':
      case 'WEAPONS_SAFE':
      case 'FORM_UP':
      case 'DISPERSE':
        lines.push(`[${id}, "${type}", "${uid}"] call SPECTRE_fnc_execCmd;`);
        break;

      case 'EXECUTE_ORDER': {
        const wps = (cmd.waypoints || [])
          .filter(wp => wp && (wp.x !== undefined || wp.y !== undefined))
          .map(wp => `[${Math.round(wp.x || 0)},${Math.round(wp.y || 0)}]`)
          .join(',');
        const roe    = sqfSafe(cmd.engagement_rules).substring(0, 60);
        const action = sqfSafe(cmd.action).substring(0, 100);
        lines.push(`[${id}, "EXECUTE_ORDER", "${uid}", [${wps}], "${roe}", "${action}"] call SPECTRE_fnc_execCmd;`);
        break;
      }

      case 'CUSTOM': {
        const instr = sqfSafe(cmd.instruction).substring(0, 100);
        lines.push(`[${id}, "CUSTOM", "${uid}", [], "", "${instr}"] call SPECTRE_fnc_execCmd;`);
        break;
      }

      case 'MOVE_TO': {
        const wps = (cmd.waypoints || []);
        let wpStr;
        if (wps.length > 0) {
          wpStr = wps
            .filter(wp => wp && (wp.x !== undefined || wp.y !== undefined))
            .map(wp => {
              const px = Math.round(wp.x || 0);
              const py = Math.round(wp.y || 0);
              const alt = wp.altitude != null ? Math.round(wp.altitude) : '';
              return alt !== '' ? `[${px},${py},${alt}]` : `[${px},${py}]`;
            })
            .join(',');
          if (!wpStr) {
            const x = Math.round(cmd.x || 0);
            const y = Math.round(cmd.y || 0);
            wpStr = `[${x},${y}]`;
          }
        } else {
          const x = Math.round(cmd.x || 0);
          const y = Math.round(cmd.y || 0);
          wpStr = `[${x},${y}]`;
        }
        const speed = cmd.speed != null ? `speed:${Math.round(cmd.speed)}` : '';
        lines.push(`[${id}, "MOVE_TO", "${uid}", [${wpStr}], "", "${speed}"] call SPECTRE_fnc_execCmd;`);
        break;
      }

      case 'ATTACK': {
        const targetId = sqfSafe(cmd.target_id);
        const ax = cmd.x !== undefined ? Math.round(cmd.x) : '';
        const ay = cmd.y !== undefined ? Math.round(cmd.y) : '';
        if (targetId) {
          lines.push(`[${id}, "ATTACK", "${uid}", [], "${targetId}"] call SPECTRE_fnc_execCmd;`);
        } else if (ax || ay) {
          lines.push(`[${id}, "ATTACK_POS", "${uid}", [[${ax},${ay}]]] call SPECTRE_fnc_execCmd;`);
        }
        break;
      }

      case 'KAMIKAZE': {
        const targetId = sqfSafe(cmd.target_id);
        const wps = (cmd.waypoints || []);
        if (wps.length > 0) {
          const wpStr = wps
            .filter(wp => wp && wp.length >= 2)
            .map(wp => `[${Math.round(wp[0])},${Math.round(wp[1])},${Math.round(wp[2] || 0)}]`)
            .join(',');
          lines.push(`[${id}, "KAMIKAZE", "${uid}", [${wpStr}], "${targetId}"] call SPECTRE_fnc_execCmd;`);
        } else {
          lines.push(`[${id}, "KAMIKAZE", "${uid}", [], "${targetId}"] call SPECTRE_fnc_execCmd;`);
        }
        break;
      }

      case 'ARTILLERY_STRIKE': {
        const rx = Math.round(cmd.x || 0);
        const ry = Math.round(cmd.y || 0);
        const rounds = Math.min(12, Math.max(1, Math.round(cmd.rounds || 6)));
        const ammo = sqfSafe(cmd.ammoType).substring(0, 20);
        lines.push(`[${id}, "ARTILLERY_STRIKE", "${uid}", [[${rx},${ry}]], "${rounds}", "${ammo}"] call SPECTRE_fnc_execCmd;`);
        break;
      }

      case 'LAND_AT': {
        const lx = Math.round(cmd.x || 0);
        const ly = Math.round(cmd.y || 0);
        lines.push(`[${id}, "LAND_AT", "${uid}", [[${lx},${ly}]]] call SPECTRE_fnc_execCmd;`);
        break;
      }

      case 'SMOKE_AT': {
        const sx = Math.round(cmd.x || 0);
        const sy = Math.round(cmd.y || 0);
        lines.push(`[${id}, "SMOKE_AT", "${uid}", [[${sx},${sy}]]] call SPECTRE_fnc_execCmd;`);
        break;
      }

      case 'ADJUST_FIRE': {
        const dx = Math.round(cmd.x || 0);
        const dy = Math.round(cmd.y || 0);
        lines.push(`[${id}, "ADJUST_FIRE", "${uid}", [[${dx},${dy}]]] call SPECTRE_fnc_execCmd;`);
        break;
      }

      case 'HOVER': {
        lines.push(`[${id}, "HOVER", "${uid}"] call SPECTRE_fnc_execCmd;`);
        break;
      }

      default:
        lines.push(`// (skipped unknown command type: ${cmd.type})`);
    }
  }

  return lines.join('\n') + '\n';
}

// ─── Write a single command to the SQF file ───────────────────────────────────
function writeCommandToFile(cmd) {
  if (!ARMA_INSTALL) return;
  try {
    if (!cmd._id) cmd._id = Date.now() + Math.floor(Math.random() * 10000);
    pendingSpectreCmds.push(cmd);
    if (pendingSpectreCmds.length > 50) pendingSpectreCmds = pendingSpectreCmds.slice(-50);
    let sqf = buildSQFContent(pendingSpectreCmds);
    // DLL output cap is 10240 bytes; keep the file safely under it so Arma
    // never receives ERR_SIZE and drops every command.
    const SAFE_CAP = 8192;
    while (sqf.length > SAFE_CAP && pendingSpectreCmds.length > 1) {
      pendingSpectreCmds.shift();
      sqf = buildSQFContent(pendingSpectreCmds);
    }
    if (sqf.length > SAFE_CAP) sqf = sqf.slice(0, SAFE_CAP) + '\n';
    const p = path.join(ARMA_INSTALL, '@SPECTRE', 'addons', 'spectre_cmds.sqf');
    fs.writeFileSync(p, sqf, 'utf8');
    fs.appendFileSync(path.join(USER_DATA, 'cmdlog.txt'), `${Date.now()} OK ${cmd.type}\n`);
  } catch (e) {
    try { fs.appendFileSync(path.join(USER_DATA, 'cmdlog.txt'), `${Date.now()} FAIL ${e.message}\n`); } catch (_) {}
  }
}

function queueCommand(cmd) {
  writeCommandToFile(cmd);
}

// ─── Auto-install mod to Arma 3 ──────────────────────────────────────────────
function tryInstallMod() {
  if (!ARMA_INSTALL) return;

  const armaModDir = path.join(ARMA_INSTALL, '@SPECTRE');
  const bundledMod = path.join(__dirname, '..', 'mod');

  // Already installed?
  if (fs.existsSync(path.join(armaModDir, 'mod.cpp'))) {
    console.log('SPECTRE: mod already installed at', armaModDir);
    return;
  }

  // Bundled mod exists?
  if (!fs.existsSync(bundledMod)) {
    console.log('SPECTRE: no bundled mod found, skipping auto-install');
    return;
  }

  if (!mainWindow) return;
  const result = dialog.showMessageBoxSync(mainWindow, {
    type: 'question',
    buttons: ['Install Mod', 'Skip'],
    defaultId: 0,
    title: 'SPECTRE C2 — Mod Installation',
    message: 'Install the SPECTRE mod to Arma 3?',
    detail: `Arma 3 detected at:\n${ARMA_INSTALL}\n\nThe mod will be installed to:\n${armaModDir}`,
  });

  if (result !== 0) return;

  try {
    copyDirRecursive(bundledMod, armaModDir);
    console.log('SPECTRE: mod installed to', armaModDir);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'SPECTRE C2',
      message: 'Mod installed successfully!',
      detail: 'You can now launch Arma 3 with the @SPECTRE mod enabled.',
    });
  } catch (e) {
    console.error('SPECTRE: mod install failed:', e.message);
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'SPECTRE C2',
      message: 'Mod installation failed',
      detail: e.message,
    });
  }
}

// ─── Manual mod install (from Settings) ──────────────────────────────────────
ipcMain.handle('install-mod', async (_, modType) => {
  if (!ARMA_INSTALL) {
    return { success: false, error: 'Arma 3 path not set. Go to Settings and set the Arma 3 Installation Path first.' };
  }

  if (modType === 'spectre') {
    const armaModDir = path.join(ARMA_INSTALL, '@SPECTRE');
    const bundledMod = path.join(__dirname, '..', 'mod');

    if (!fs.existsSync(bundledMod)) {
      return { success: false, error: 'Bundled mod not found in app directory.' };
    }

    try {
      copyDirRecursive(bundledMod, armaModDir);
      console.log('SPECTRE: mod installed to', armaModDir);
      return { success: true, path: armaModDir };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  if (modType === 'cba') {
    const cbaDir = path.join(ARMA_INSTALL, '@CBA_A3');
    if (fs.existsSync(path.join(cbaDir, 'mod.cpp'))) {
      return { success: true, path: cbaDir, message: 'CBA_A3 already installed.' };
    }

    // Download CBA_A3 from GitHub
    try {
      const https = require('https');

      // Get latest release
      console.log('SPECTRE: Fetching CBA_A3 latest release...');
      const releaseData = await new Promise((resolve, reject) => {
        https.get('https://api.github.com/repos/CBATeam/CBA_A3/releases/latest', { headers: { 'User-Agent': 'SPECTRE-C2' } }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Failed to parse GitHub response')); }
          });
        }).on('error', reject);
      });

      // Find the .zip asset
      const asset = releaseData.assets?.find(a => a.name.endsWith('.zip'));
      if (!asset) return { success: false, error: 'Could not find CBA_A3 download in latest release.' };
      console.log('SPECTRE: Found CBA_A3 asset:', asset.name, 'size:', asset.size);

      // Download with redirect handling
      const downloadUrl = asset.browser_download_url;
      console.log('SPECTRE: Downloading from:', downloadUrl);

      const zipPath = path.join(ARMA_INSTALL, 'cba_a3_temp.zip');
      await new Promise((resolve, reject) => {
        let redirectCount = 0;
        const download = (url) => {
          if (redirectCount++ > 10) { reject(new Error('Too many redirects')); return; }
          https.get(url, { headers: { 'User-Agent': 'SPECTRE-C2' } }, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
              console.log('SPECTRE: Following redirect to:', res.headers.location);
              res.resume();
              download(res.headers.location);
            } else if (res.statusCode === 200) {
              const file = fs.createWriteStream(zipPath);
              let downloaded = 0;
              res.on('data', (chunk) => {
                downloaded += chunk.length;
              });
              res.on('error', reject);
              res.pipe(file);
              file.on('finish', () => {
                file.close();
                console.log('SPECTRE: Downloaded', downloaded, 'bytes');
                resolve();
              });
            } else {
              reject(new Error(`Download failed with status ${res.statusCode}`));
            }
          }).on('error', reject);
        };
        download(downloadUrl);
      });

      // Check file exists and has size
      const zipStat = fs.statSync(zipPath);
      console.log('SPECTRE: ZIP file size:', zipStat.size, 'bytes');
      if (zipStat.size < 1000) {
        fs.unlinkSync(zipPath);
        return { success: false, error: 'Downloaded file is too small - download may have failed.' };
      }

      // Extract using PowerShell — pass paths as args to avoid injection
      console.log('SPECTRE: Extracting CBA_A3...');
      const { execSync } = require('child_process');
      fs.mkdirSync(cbaDir, { recursive: true });
      execSync('powershell', ['-NoProfile', '-Command', 'Expand-Archive', '-LiteralPath', zipPath, '-DestinationPath', cbaDir, '-Force'], { stdio: 'ignore' });
      fs.unlinkSync(zipPath);

      // Fix nested folder: CBA_A3 zip extracts to @CBA_A3/@CBA_A3/, move contents up
      const nestedDir = path.join(cbaDir, '@CBA_A3');
      if (fs.existsSync(nestedDir)) {
        console.log('SPECTRE: Fixing nested folder structure...');
        const items = fs.readdirSync(nestedDir);
        for (const item of items) {
          const src = path.join(nestedDir, item);
          const dest = path.join(cbaDir, item);
          fs.renameSync(src, dest);
        }
        fs.rmdirSync(nestedDir);
      }

      // Verify installation
      if (!fs.existsSync(path.join(cbaDir, 'mod.cpp'))) {
        return { success: false, error: 'Extraction completed but mod.cpp not found. The zip format may have changed.' };
      }

      console.log('SPECTRE: CBA_A3 installed to', cbaDir);
      return { success: true, path: cbaDir };
    } catch (e) {
      console.error('SPECTRE: CBA_A3 install error:', e.message);
      return { success: false, error: `Failed to download CBA_A3: ${e.message}` };
    }
  }

  return { success: false, error: 'Unknown mod type.' };
});

ipcMain.handle('check-mod-status', async () => {
  const mods = {};
  if (ARMA_INSTALL) {
    mods.spectre = fs.existsSync(path.join(ARMA_INSTALL, '@SPECTRE', 'mod.cpp'));
    mods.cba = fs.existsSync(path.join(ARMA_INSTALL, '@CBA_A3', 'mod.cpp'));
  }
  return mods;
});

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ─── Window ──────────────────────────────────────────────────────────────────
let mainWindow;
let logFilePos = 0;
let currentLogPath = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 1000,
    minWidth: 1280, minHeight: 800,
    backgroundColor: '#070b10',
    titleBarStyle: 'hidden',
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const isDev = process.env.NODE_ENV === 'development' ||
    !fs.existsSync(path.join(__dirname, '../build/index.html'));

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    if (process.env.DEVTOOLS) mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../build/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Auto-update ─────────────────────────────────────────────────────────────
let updateInfo = null;
let updateDownloaded = false;

function setupAutoUpdate() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (msg) => console.log('SPECTRE-UPDATER:', msg),
      warn: (msg) => console.warn('SPECTRE-UPDATER:', msg),
      error: (msg) => console.error('SPECTRE-UPDATER:', msg),
    };

    autoUpdater.on('checking-for-update', () => {
      console.log('SPECTRE: Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('SPECTRE: Update available:', info.version);
      updateInfo = info;
      // Try to notify renderer, but it might not be ready yet
      sendToRenderer('update-available', info);
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('SPECTRE: No update available. Current version:', info.version);
      sendToRenderer('update-not-available', info);
    });

    autoUpdater.on('download-progress', (progress) => {
      console.log(`SPECTRE: Download progress: ${Math.round(progress.percent)}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('SPECTRE: Update downloaded:', info.version);
      updateDownloaded = true;
      updateInfo = info;
      // Try to notify renderer
      sendToRenderer('update-downloaded', info);
    });

    autoUpdater.on('error', (err) => {
      console.error('SPECTRE: Auto-update error:', err.message);
    });

    // Don't check immediately — wait for renderer to be ready
    // The renderer will send 'check-for-updates' when it's mounted
  } catch (err) {
    console.error('SPECTRE: Failed to setup auto-updater:', err.message);
  }
}

// When renderer is ready, check for updates and send any pending state
let updateCheckDone = false;

function doUpdateCheck() {
  if (updateCheckDone) return;
  updateCheckDone = true;
  console.log('SPECTRE: Starting update check...');
  dbg('SPECTRE: Starting update check from GitHub releases');
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.checkForUpdates().then((result) => {
      console.log('SPECTRE: Update check result:', result?.updateInfo?.version || 'none');
      dbg(`SPECTRE: Update check complete — latest: ${result?.updateInfo?.version || 'none'}, current: ${app.getVersion()}`);
    }).catch((err) => {
      console.error('SPECTRE: Update check failed:', err.message);
      dbg(`SPECTRE: Update check failed: ${err.message}`);
    });
  } catch (err) {
    console.error('SPECTRE: Update check error:', err.message);
    dbg(`SPECTRE: Update check error: ${err.message}`);
  }
}

ipcMain.on('renderer-ready', () => {
  console.log('SPECTRE: Renderer ready, checking for updates...');

  // If we already have update state, send it now
  if (updateDownloaded && updateInfo) {
    sendToRenderer('update-downloaded', updateInfo);
  } else if (updateInfo) {
    sendToRenderer('update-available', updateInfo);
  }

  doUpdateCheck();
});

// Fallback: if renderer-ready never arrives (e.g. React app crashes),
// check anyway after 30 seconds
setTimeout(() => {
  console.log('SPECTRE: Fallback update check timer fired');
  doUpdateCheck();
}, 30000);

// Manual check from renderer
ipcMain.handle('check-for-updates', async () => {
  updateCheckDone = false;
  try {
    const { autoUpdater } = require('electron-updater');
    const result = await autoUpdater.checkForUpdates();
    return { 
      hasUpdate: result?.updateInfo?.version !== app.getVersion(),
      currentVersion: app.getVersion(),
      latestVersion: result?.updateInfo?.version || 'unknown'
    };
  } catch (err) {
    return { error: err.message, currentVersion: app.getVersion() };
  }
});

// ─── App ready ───────────────────────────────────────────────────────────────
let hostServicesStarted = false;

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdate();

  // Host-only services (bridge watcher, web viewer, mod install) are NOT
  // started here — they start when the user selects HOST mode via IPC.
  // This prevents errors/log-spam when running in client mode.

  // Load Vercel relay URL from config
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (config.vercel_url) setVercelUrl(config.vercel_url);
  } catch (_) {}
});

// Start host-only services (called from renderer when HOST mode is selected)
ipcMain.on('start-host-services', () => {
  if (hostServicesStarted) return;
  hostServicesStarted = true;
  dbg('SPECTRE: Starting host services (bridge watcher, web viewer, mod check)');
  startBridgeWatcher();
  startWebSocketServer();
  tryInstallMod();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Bridge Watchers ─────────────────────────────────────────────────────────
function startBridgeWatcher() {
  // Tail Arma RPT log using fs.watchFile + polling fallback
  initWatchArmaLog();

  // Periodic: check for newer RPT files (log rotation) + polling fallback
  setInterval(() => {
    const newer = findLatestRptLog(ARMA_DOCS);
    if (newer && newer !== currentLogPath) {
      dbg('SPECTRE: newer RPT detected, switching: ' + newer);
      initWatchArmaLog();
    }
    // Polling fallback: even if fs.watchFile misses events, we catch changes here
    readNewLogData();
  }, 1000);

  dbg('SPECTRE: bridge watching Arma log files');
}

let lastReadTime = 0;
let logLineBuffer = ''; // carry an unterminated final line across reads
function readNewLogData() {
  const now = Date.now();
  if (now - lastReadTime < 100) return;
  lastReadTime = now;
  if (!currentLogPath) return;
  try {
    if (!fs.existsSync(currentLogPath)) return;
    const stat = fs.statSync(currentLogPath);

    // Log rotated (file shrunk) — reset position
    if (stat.size < logFilePos) {
      logFilePos = 0;
      logLineBuffer = '';
    }

    if (stat.size <= logFilePos) return;

    const fd  = fs.openSync(currentLogPath, 'r');
    let chunk;
    try {
      const len = stat.size - logFilePos;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, logFilePos);
      logFilePos = stat.size;
      chunk = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }

    // Prepend any previously unterminated final line, and keep the current
    // unterminated final line for the next read.
    const text = logLineBuffer + chunk;
    const lines = text.split('\n');
    logLineBuffer = lines.pop();
    parseArmaLog(lines.join('\n'));
  } catch (e) {
    console.error('SPECTRE: log read error:', e.message);
  }
}

// Track which path the fs.watchFile is currently registered on
let watchFileRegisteredPath = null;

function initWatchArmaLog() {
  const logPath = findLatestRptLog(ARMA_DOCS);

  if (!logPath) {
    dbg('SPECTRE: no RPT log found, will retry via polling');
    return;
  }

  if (logPath !== currentLogPath) {
    // Stop watching old file
    if (currentLogPath && watchFileRegisteredPath === currentLogPath) {
      try { fs.unwatchFile(currentLogPath); } catch (_) {}
      watchFileRegisteredPath = null;
    }
    currentLogPath = logPath;
    try { logFilePos = fs.statSync(logPath).size; } catch (_) { logFilePos = 0; }
    dbg('SPECTRE: tailing Arma log: ' + logPath + ' at offset ' + logFilePos);
  }

  // Only register fs.watchFile once per path to avoid stacking watchers
  if (watchFileRegisteredPath !== logPath) {
    watchFileRegisteredPath = logPath;
    fs.watchFile(logPath, { interval: 500 }, (curr, prev) => {
      if (curr.size === prev.size) return;
      readNewLogData();
    });
    dbg('SPECTRE: registered fs.watchFile on ' + logPath);
  }
}

// Accumulator for multi-line state
let pendingState = { units: {}, contacts: {}, events: [], mapName: null, missionFolder: null, fullMissionPath: null, timestamp: 0 };

function parseArmaLog(chunk) {
  const lines = chunk.split('\n');
  let gotData = false;
  let legacyFlushed = false;

  for (const line of lines) {
    // New per-line format: SPECTRE_META, SPECTRE_UNIT, SPECTRE_CONTACT, SPECTRE_EVENTS
    const metaMatch = line.match(/SPECTRE_META:(\{.+\})/);
    if (metaMatch) {
      try {
        const jsonStr = metaMatch[1].replace(/""/g, '"');
        const meta = JSON.parse(jsonStr);
        if (meta.map) pendingState.mapName = meta.map;
        if (meta.mf) {
          // Mission changed — clear stale commands from previous mission
          if (pendingState.missionFolder && pendingState.missionFolder !== meta.mf) {
            try {
              const cmdsPath = path.join(ARMA_INSTALL, '@SPECTRE', 'addons', 'spectre_cmds.sqf');
              fs.writeFileSync(cmdsPath, '// SPECTRE — mission restarted\n', 'utf8');
              dbg('SPECTRE: Mission changed, cleared stale commands');
            } catch (_) {}
            // Clear stale units/contacts from previous mission
            pendingState.units = {};
            pendingState.contacts = {};
            pendingState.events = [];
            pendingSpectreCmds = []; // clear stale commands buffer too
          }
          pendingState.missionFolder = meta.mf;
        }
        // Full absolute path (added for folder-based mission support)
        if (meta.path) pendingState.fullMissionPath = meta.path;
        if (meta.ts) pendingState.timestamp = meta.ts;
        gotData = true;
      } catch (e) { dbg('SPECTRE: meta parse error: ' + e.message); }
      continue;
    }

    const unitMatch = line.match(/SPECTRE_UNIT:(\{.+\})/);
    if (unitMatch) {
      try {
        const jsonStr = unitMatch[1].replace(/""/g, '"');
        const raw = JSON.parse(jsonStr);
        const u = expandUnit(raw);
        pendingState.units[u.id] = u;
        gotData = true;
      } catch (e) { dbg('SPECTRE: unit parse error: ' + e.message); }
      continue;
    }

    const contactMatch = line.match(/SPECTRE_CONTACT:(\{.+\})/);
    if (contactMatch) {
      try {
        const jsonStr = contactMatch[1].replace(/""/g, '"');
        const raw = JSON.parse(jsonStr);
        pendingState.contacts[raw.id] = {
          id: raw.id,
          type: raw.type || raw.vtype || 'UNKNOWN',
    position: raw.position || raw.pos || { x: 0, y: 0, z: 0, lat: 0, lng: 0 },
          state: raw.state || 'CONFIRMED',
          source: raw.source || 'VISUAL',
          confidence: raw.confidence || 'HIGH'
        };
        gotData = true;
      } catch (e) { dbg('SPECTRE: contact parse error: ' + e.message); }
      continue;
    }

    const eventsMatch = line.match(/SPECTRE_EVENTS:(\[.+\])/);
    if (eventsMatch) {
      try {
        const jsonStr = eventsMatch[1].replace(/""/g, '"');
        const evts = JSON.parse(jsonStr);
        pendingState.events = pendingState.events.concat(evts);
        gotData = true;
      } catch (e) { dbg('SPECTRE: events parse error: ' + e.message); }
      continue;
    }

    // Legacy format fallback: SPECTRE_STATE (single-line JSON)
    const stateMatch = line.match(/SPECTRE_STATE:(\{.+\})/);
    if (stateMatch) {
      try {
        const jsonStr = stateMatch[1].replace(/""/g, '"');
        const raw = JSON.parse(jsonStr);
        const data = expandLegacyState(raw);
    if (data.missionFolder) autoSetMissionFolder(data.missionFolder, data.fullMissionPath);
        sendToRenderer('arma-state-update', data);
        broadcastToWebClients(data);
        postToVercel(data);
        sendStateToRelay(data);
        gotData = true;
        legacyFlushed = true;
      } catch (e) {
        dbg('SPECTRE: legacy parse error: ' + e.message);
      }
    }
  }

  // After processing all lines in this chunk, flush the accumulated state
  if (!legacyFlushed && gotData && (Object.keys(pendingState.units).length > 0 || Object.keys(pendingState.contacts).length > 0 || pendingState.events.length > 0 || pendingState.mapName)) {
    const data = {
      missionFolder: pendingState.missionFolder || '',
      fullMissionPath: pendingState.fullMissionPath || '',
      mapName: pendingState.mapName || '',
      timestamp: pendingState.timestamp,
      units: Object.values(pendingState.units),
      contacts: Object.values(pendingState.contacts),
      events: pendingState.events
    };
    dbg(`SPECTRE: FLUSH — units: ${data.units.length}, map: ${data.mapName}`);
    data.units.forEach(u => dbg(`  UNIT: id=${u.id}, pos=${JSON.stringify(u.position)}, hp=${u.health}`));

        if (data.missionFolder) autoSetMissionFolder(data.missionFolder, data.fullMissionPath || '');
    sendToRenderer('arma-state-update', data);
    broadcastToWebClients(data);
    postToVercel(data);
    sendStateToRelay(data);

    // Reset accumulator (keep mapName and missionFolder for next chunk)
    pendingState.units = {};
    pendingState.contacts = {};
    pendingState.events = [];
  }
}

function expandUnit(raw) {
  const vtype = raw.vehicle_type || raw.vtype || 'INFANTRY';
  const isVehicle = ['MBT','TANK','IFV','APC','RECON','HELI','TRUCK','PLANE','BOAT','CAR','VEHICLE','FPV','UAV','STOMPER','ED1'].includes(vtype);
  return {
    id: raw.id,
    callsign: raw.callsign || raw.id,
    type: raw.type || (isVehicle ? 'VEHICLE' : 'INFANTRY'),
    vehicle_type: vtype,
    position: raw.position || raw.pos || { x: 0, y: 0, z: 0, lat: 0, lng: 0 },
    heading: raw.heading ?? raw.hdg ?? 0,
    health: raw.health ?? raw.hp ?? 100,
    fuel: raw.fuel ?? 100,
    speed: raw.speed ?? 0,
    ammo: raw.ammo ?? 0,
    status: raw.status || raw.st || 'UNKNOWN',
    current_order: raw.current_order || raw.order || '',
    vehicle: raw.vehicle || null,
    vehicle_role: raw.vehicle_role || null,
    crew: raw.crew || [],
  };
}

function expandLegacyState(raw) {
  return {
    missionFolder: raw.missionFolder || '',
    mapName: raw.mapName || '',
    armaVersion: raw.armaVersion || '',
    timestamp: raw.timestamp || 0,
    units: (raw.units || []).map(expandUnit),
    contacts: (raw.contacts || []).map(c => ({
      id: c.id, type: c.type, position: c.position || c.pos || {},
      state: c.state || 'CONFIRMED', source: c.source || 'VISUAL', confidence: c.confidence || 'HIGH'
    })),
    events: raw.events || []
  };
}

// Auto-set mission folder from bridge's getMissionPath broadcast
let lastAutoSet = '';
let lastFullAutoSet = '';
function autoSetMissionFolder(missionPath, fullPath) {
  if (!missionPath || (missionPath === lastAutoSet && fullPath === lastFullAutoSet)) return;
  if (!ARMA_INSTALL) return;
  lastAutoSet = missionPath;
  lastFullAutoSet = fullPath || '';

  // Use full absolute path if available and valid
  let normalized = (fullPath || '').replace(/\/$/, '').replace(/\//g, '\\');

  // If full path is valid (starts with drive letter and folder exists), use it directly
  if (normalized && normalized.match(/^[A-Z]:\\/i) && fs.existsSync(normalized)) {
    // Good - use the absolute path directly
  } else if (normalized && !normalized.match(/^[A-Z]:\\/i)) {
    // Relative path — when playing from Scenarios, missions are under Arma install\Missions\
    // Try ARMA_INSTALL first, then fall back to ARMA_DOCS
    const resolved = path.join(ARMA_INSTALL, normalized);
    if (fs.existsSync(resolved)) {
      normalized = resolved;
    } else {
      normalized = path.join(ARMA_DOCS, normalized);
    }
  } else {
    // Fallback: use missionFolder (short path)
    normalized = missionPath.replace(/\/$/, '').replace(/\//g, '\\');
    if (!normalized.match(/^[A-Z]:\\/i)) {
      const resolved = path.join(ARMA_INSTALL, normalized);
      normalized = fs.existsSync(resolved) ? resolved : path.join(ARMA_DOCS, normalized);
    }
  }

  if (!fs.existsSync(normalized)) {
    dbg(`SPECTRE: Mission folder not found at: ${normalized}`);
    return;
  }

  let config;
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch (_) { config = { ...DEFAULT_CONFIG }; }

  // Only update if different from current
  if (config.mission_folder_path !== normalized) {
    config.mission_folder_path = normalized;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log('SPECTRE: auto-detected mission folder:', normalized);
    sendToRenderer('config-updated', config);
  }
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  } else {
    dbg(`SPECTRE: IPC skipped (no window), channel: ${channel}`);
  }
}

// ─── Auto-detect Arma mission folders ────────────────────────────────────────
function getMissionFolders() {
  const scanRoots = [
    path.join(ARMA_DOCS, 'missions'),
    path.join(ARMA_DOCS, 'mpmissions'),
  ];

  const results = [];
  for (const root of scanRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const full = path.join(root, e.name);
        const files = fs.readdirSync(full).map(f => f.toLowerCase());
        const looksLikeMission = files.some(f =>
          f === 'description.ext' || f === 'init.sqf' || f.endsWith('.sqf')
        );
        if (looksLikeMission) {
          results.push({ name: e.name, path: full });
        }
      }
    } catch (_) {}
  }

  results.sort((a, b) => {
    try {
      return fs.statSync(b.path).mtime - fs.statSync(a.path).mtime;
    } catch (_) { return 0; }
  });

  return results;
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.on('send-command', (_, command) => {
  writeCommandToFile(command);
});

ipcMain.handle('get-config', async () => {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (config.api_key && !config.api_keys?.length) {
      config.api_keys = [config.api_key];
      delete config.api_key;
    }
    if (config.model === 'anthropic/claude-opus-4-5') config.model = DEFAULT_CONFIG.model;
    if (config.fallback_model === 'openai/gpt-4o' || config.fallback_model === 'openai/gpt-4o-mini') config.fallback_model = DEFAULT_CONFIG.fallback_model;
    if (!Array.isArray(config.api_keys)) config.api_keys = [];
    return config;
  }
  catch (_) { return { ...DEFAULT_CONFIG }; }
});

ipcMain.handle('save-config', async (_, config) => {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
  const merged = { ...existing, ...config };
  // Only overwrite arma_path if user explicitly set it via Settings
  if (customArmaPath) merged.arma_path = customArmaPath;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return { success: true };
});

ipcMain.handle('save-mission', async (_, missionData) => {
  const filename = `mission_${Date.now()}.json`;
  fs.writeFileSync(path.join(MISSIONS_DIR, filename), JSON.stringify(missionData, null, 2));
  return { success: true, filename };
});

ipcMain.handle('load-intel', async () => {
  const p = path.join(INTEL_DIR, 'intel_db.json');
  if (!fs.existsSync(p)) return { locations: [], patterns: [], terrain: [] };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_) { return { locations: [], patterns: [], terrain: [] }; }
});

ipcMain.handle('save-intel', async (_, intel) => {
  fs.writeFileSync(path.join(INTEL_DIR, 'intel_db.json'), JSON.stringify(intel, null, 2));
  return { success: true };
});

ipcMain.handle('get-mission-folders', async () => {
  return getMissionFolders();
});

ipcMain.handle('get-paths', async () => {
  let config;
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { config = DEFAULT_CONFIG; }

  return {
    bridge_dir:           BRIDGE_DIR,
    arma_spectre_dir:     ARMA_SPECTRE,
    missions_dir:         MISSIONS_DIR,
    arma_install:         ARMA_INSTALL || '(not found)',
    mission_folder_path:  config.mission_folder_path || '(auto-detecting...)',
    spectre_to_arma:      ARMA_INSTALL
      ? path.join(ARMA_INSTALL, '@SPECTRE', 'addons', 'spectre_cmds.sqf')
      : '(waiting for Arma connection)',
    arma_log_watched:     currentLogPath || '(not found — launch Arma first)',
    web_viewer_url:       `http://${getLocalIP()}:${WS_PORT}`,
    ws_clients:           wsClients.size
  };
});

ipcMain.handle('get-arma-info', async () => {
  return {
    installPath: ARMA_INSTALL,
    documentsPath: ARMA_DOCS,
    detected: !!ARMA_INSTALL,
  };
});

// ── FPV waypoint generation ──────────────────────────────────────────────
ipcMain.handle('generate-fpv-waypoints', async (_, { start, target }) => {
  return new Promise((resolve) => {
    const script = path.join(__dirname, '..', 'scripts', 'fpv_waypoints.py');
    const input = JSON.stringify({ start, target });
    const pyExe = (() => {
      try { require('child_process').execSync('python3 --version 2>nul'); return 'python3'; } catch {}
      try { require('child_process').execSync('python --version 2>nul'); return 'python'; } catch {}
      return 'python';
    })();
    const py = require('child_process').spawn(pyExe, [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      try { py.kill(); } catch (_) {}
      resolve({ error: 'FPV waypoint generator timed out' });
    }, 10000);
    py.stdout.on('data', d => { stdout += d.toString(); });
    py.stderr.on('data', d => { stderr += d.toString(); });
    py.on('close', (code) => {
      clearTimeout(timer);
      let data;
      try { data = JSON.parse(stdout); } catch (_) {}
      if (code === 0) {
        resolve(data || { error: 'Invalid JSON from Python' });
      } else {
        resolve(data || { error: stderr || `Python exited with code ${code}` });
      }
    });
    py.on('error', () => resolve({ error: 'Failed to spawn Python' }));
    py.stdin.write(input);
    py.stdin.end();
  });
});

let customArmaPath = null;

ipcMain.handle('set-arma-path', async (_, manualPath) => {
  if (!manualPath) {
    // Browse for folder
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Arma 3 Installation Directory',
    });
    if (result.canceled || !result.filePaths[0]) return { success: false };
    manualPath = result.filePaths[0];
  }

  // Verify it looks like Arma 3
  const hasExe = fs.existsSync(path.join(manualPath, 'arma3_x64.exe')) ||
                 fs.existsSync(path.join(manualPath, 'arma3.exe'));
  if (!hasExe) {
    return { success: false, error: 'No arma3_x64.exe found in that directory.' };
  }

  customArmaPath = manualPath;
  ARMA_INSTALL = manualPath;
  console.log('SPECTRE: manual Arma 3 path set:', manualPath);
  return { success: true, path: manualPath };
});

// Window control IPC
ipcMain.on('minimize-window', () => mainWindow?.minimize());
ipcMain.on('maximize-window', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('close-window',    () => mainWindow?.close());
ipcMain.on('open-external',   (_, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url); });
ipcMain.on('set-vercel-url',  (_, url) => setVercelUrl(url));
ipcMain.on('relay-connect',   (_, opts = {}) => {
  const mode = opts.mode, roomCode = opts.roomCode || '', url = opts.url;
  if (mode && roomCode) connectToRelay(mode, roomCode, url);
});
ipcMain.on('relay-disconnect', () => disconnectRelay());
ipcMain.on('relay-command',   (_, cmd) => {
  // Client sends command through relay to host — sanitize cmd to a plain object
  if (relayWs && relayWs.readyState === WebSocket.OPEN && relayMode === 'client' && cmd && typeof cmd === 'object') {
    try { relayWs.send(JSON.stringify({ type: 'command', data: cmd })); } catch (_) {}
  }
});
ipcMain.on('restart-app',     () => {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall();
  } catch (e) {
    dbg('SPECTRE: restart-app failed: ' + e.message);
    app.relaunch();
    app.exit(0);
  }
});

// ─── Vault (Ontology Layer) ──────────────────────────────────────────────────
// Ensure vault paths stay inside VAULTS_DIR to prevent path traversal.
function safeVaultPath(vaultPath) {
  try {
    const resolved = path.resolve(vaultPath || '');
    const base = path.resolve(VAULTS_DIR);
    if (resolved === base || resolved.startsWith(base + path.sep)) return resolved;
  } catch (_) {}
  return null;
}
function safeVaultFilename(filename) {
  // Only allow simple .md filenames — no path separators or traversal
  if (!filename || typeof filename !== 'string') return null;
  const base = path.basename(filename);
  if (base !== filename || !/^[a-zA-Z0-9_-]+\.md$/.test(base)) return null;
  return base;
}
ipcMain.handle('vault-create', async (_, missionId) => {
  const safeId = (missionId || `mission-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const vaultPath = path.join(VAULTS_DIR, safeId);
  const nodesPath = path.join(vaultPath, 'nodes');
  try {
    fs.mkdirSync(nodesPath, { recursive: true });
    return vaultPath;
  } catch (e) {
    console.error('SPECTRE: vault create failed:', e.message);
    return null;
  }
});

ipcMain.handle('vault-write-node', async (_, vaultPath, filename, content) => {
  const safePath = safeVaultPath(vaultPath);
  const safeName = safeVaultFilename(filename);
  if (!safePath || !safeName || !content) return false;
  try {
    const nodesPath = path.join(safePath, 'nodes');
    if (!fs.existsSync(nodesPath)) fs.mkdirSync(nodesPath, { recursive: true });
    fs.writeFileSync(path.join(nodesPath, safeName), content, 'utf8');
    return true;
  } catch (e) {
    console.error('SPECTRE: vault write failed:', e.message);
    return false;
  }
});

ipcMain.handle('vault-read-nodes', async (_, vaultPath) => {
  const safePath = safeVaultPath(vaultPath);
  if (!safePath) return [];
  try {
    const nodesPath = path.join(safePath, 'nodes');
    if (!fs.existsSync(nodesPath)) return [];
    const files = fs.readdirSync(nodesPath).filter(f => f.endsWith('.md'));
    return files.map(f => {
      const content = fs.readFileSync(path.join(nodesPath, f), 'utf8');
      return { filename: f, content };
    });
  } catch (e) {
    console.error('SPECTRE: vault read failed:', e.message);
    return [];
  }
});

ipcMain.handle('vault-update-node', async (_, vaultPath, nodeId, updates) => {
  const safePath = safeVaultPath(vaultPath);
  const safeName = safeVaultFilename(`${nodeId}.md`);
  if (!safePath || !safeName || !updates) return false;
  try {
    const nodesPath = path.join(safePath, 'nodes');
    const filename = safeName;
    const filePath = path.join(nodesPath, filename);
    if (!fs.existsSync(filePath)) return false;

    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return false;

    const yamlLines = match[1].split('\n');
    const body = match[2];
    const updatedLines = yamlLines.map(line => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return line;
      const key = line.slice(0, colonIdx).trim();
      if (key in updates) {
        const val = updates[key];
        if (Array.isArray(val)) return `${key}: ${JSON.stringify(val)}`;
        if (typeof val === 'string' && (val.includes(':') || val.includes('#') || val.includes('"')))
          return `${key}: "${val.replace(/"/g, '\\"')}"`;
        return `${key}: ${val}`;
      }
      return line;
    });

    const newContent = `---\n${updatedLines.join('\n')}\n---\n${body}`;
    fs.writeFileSync(filePath, newContent, 'utf8');
    return true;
  } catch (e) {
    console.error('SPECTRE: vault update failed:', e.message);
    return false;
  }
});

ipcMain.handle('vault-add-wikilink', async (_, vaultPath, nodeId, targetTitle) => {
  const safePath = safeVaultPath(vaultPath);
  const safeName = safeVaultFilename(`${nodeId}.md`);
  if (!safePath || !safeName || !targetTitle) return false;
  try {
    const nodesPath = path.join(safePath, 'nodes');
    const filename = safeName;
    const filePath = path.join(nodesPath, filename);
    if (!fs.existsSync(filePath)) return false;

    const content = fs.readFileSync(filePath, 'utf8');
    const wikilink = `[[${targetTitle}]]`;
    if (content.includes(wikilink)) return true;

    const newContent = content.trimEnd() + `\n${wikilink}\n`;
    fs.writeFileSync(filePath, newContent, 'utf8');
    return true;
  } catch (e) {
    console.error('SPECTRE: vault add wikilink failed:', e.message);
    return false;
  }
});
