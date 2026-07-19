const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spectreAPI', {
  // ── Arma bridge ───────────────────────────────────────────────────────────
  onArmaUpdate: (cb) => ipcRenderer.on('arma-state-update', (_, data) => cb(data)),
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
});
