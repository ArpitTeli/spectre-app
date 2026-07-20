const { contextBridge, ipcRenderer } = require('electron');

const DEBUG = true;
function dbg(msg) {
  if (DEBUG) console.log('[SPECTRE-RENDERER] ' + msg);
}

contextBridge.exposeInMainWorld('spectreAPI', {
  // ── Arma bridge ───────────────────────────────────────────────────────────
  onArmaUpdate: (cb) => ipcRenderer.on('arma-state-update', (_, data) => {
    dbg('IPC arma-state-update received — units: ' + (data.units ? data.units.length : 'N/A') + ', mapName: ' + data.mapName);
    if (data.units) data.units.forEach(u => dbg('  unit: ' + u.id + ' pos: ' + JSON.stringify(u.position)));
    cb(data);
  }),
  onArmaEvent:  (cb) => ipcRenderer.on('arma-event',        (_, data) => cb(data)),

  // ── Commands to Arma ─────────────────────────────────────────────────────
  sendCommand: (cmd) => ipcRenderer.invoke('send-command', cmd),

  // ── Config ────────────────────────────────────────────────────────────────
  getConfig:   ()     => ipcRenderer.invoke('get-config'),
  saveConfig:  (cfg)  => ipcRenderer.invoke('save-config', cfg),
  onConfigUpdated: (cb) => ipcRenderer.on('config-updated', (_, data) => cb(data)),

  // ── Mission data ──────────────────────────────────────────────────────────
  saveMission: (data) => ipcRenderer.invoke('save-mission', data),

  // ── Intel database ────────────────────────────────────────────────────────
  loadIntel:   ()      => ipcRenderer.invoke('load-intel'),
  saveIntel:   (intel) => ipcRenderer.invoke('save-intel', intel),

  // ── Vault (Ontology Layer) ────────────────────────────────────────────────
  vaultCreate:     (missionId)                    => ipcRenderer.invoke('vault-create', missionId),
  vaultWriteNode:  (vaultPath, filename, content) => ipcRenderer.invoke('vault-write-node', vaultPath, filename, content),
  vaultReadNodes:  (vaultPath)                    => ipcRenderer.invoke('vault-read-nodes', vaultPath),
  vaultUpdateNode: (vaultPath, nodeId, updates)   => ipcRenderer.invoke('vault-update-node', vaultPath, nodeId, updates),
  vaultAddWikilink:(vaultPath, nodeId, target)    => ipcRenderer.invoke('vault-add-wikilink', vaultPath, nodeId, target),

  // ── Mission folder auto-detect ────────────────────────────────────────────
  getMissionFolders: () => ipcRenderer.invoke('get-mission-folders'),

  // ── Diagnostics ───────────────────────────────────────────────────────────
  getPaths:    () => ipcRenderer.invoke('get-paths'),
  getArmaInfo: () => ipcRenderer.invoke('get-arma-info'),
  setArmaPath:  (p) => ipcRenderer.invoke('set-arma-path', p),
  installMod:   (type) => ipcRenderer.invoke('install-mod', type),
  checkModStatus: () => ipcRenderer.invoke('check-mod-status'),

  // ── Auto-update ───────────────────────────────────────────────────────────
  onUpdateAvailable:  (cb) => ipcRenderer.on('update-available',  (_, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, info) => cb(info)),

  // ── Window controls ───────────────────────────────────────────────────────
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  close:    () => ipcRenderer.send('close-window'),
  restartApp: () => ipcRenderer.send('restart-app'),
});
