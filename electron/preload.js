const { contextBridge, ipcRenderer } = require('electron');

function onEvent(channel, cb) {
  const handler = (_, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

contextBridge.exposeInMainWorld('spectreAPI', {
  onArmaUpdate: (cb) => onEvent('arma-state-update', cb),
  onArmaEvent:  (cb) => onEvent('arma-event', cb),

  sendCommand: (cmd) => ipcRenderer.send('send-command', cmd),

  getConfig:   ()     => ipcRenderer.invoke('get-config'),
  saveConfig:  (cfg)  => ipcRenderer.invoke('save-config', cfg),
  onConfigUpdated: (cb) => onEvent('config-updated', cb),

  saveMission: (data) => ipcRenderer.invoke('save-mission', data),

  loadIntel:   ()      => ipcRenderer.invoke('load-intel'),
  saveIntel:   (intel) => ipcRenderer.invoke('save-intel', intel),

  vaultCreate:     (missionId)                    => ipcRenderer.invoke('vault-create', missionId),
  vaultWriteNode:  (vaultPath, filename, content) => ipcRenderer.invoke('vault-write-node', vaultPath, filename, content),
  vaultReadNodes:  (vaultPath)                    => ipcRenderer.invoke('vault-read-nodes', vaultPath),
  vaultUpdateNode: (vaultPath, nodeId, updates)   => ipcRenderer.invoke('vault-update-node', vaultPath, nodeId, updates),
  vaultAddWikilink:(vaultPath, nodeId, target)    => ipcRenderer.invoke('vault-add-wikilink', vaultPath, nodeId, target),

  getMissionFolders: () => ipcRenderer.invoke('get-mission-folders'),

  getPaths:    () => ipcRenderer.invoke('get-paths'),
  getArmaInfo: () => ipcRenderer.invoke('get-arma-info'),
  setArmaPath:  (p) => ipcRenderer.invoke('set-arma-path', p),
  installMod:   (type) => ipcRenderer.invoke('install-mod', type),
  checkModStatus: () => ipcRenderer.invoke('check-mod-status'),

  onUpdateAvailable:  (cb) => onEvent('update-available', cb),
  onUpdateDownloaded: (cb) => onEvent('update-downloaded', cb),
  onUpdateNotAvailable: (cb) => onEvent('update-not-available', cb),
  checkForUpdates:   ()   => ipcRenderer.invoke('check-for-updates'),

  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  close:    () => ipcRenderer.send('close-window'),
  restartApp: () => ipcRenderer.send('restart-app'),
  rendererReady: () => ipcRenderer.send('renderer-ready'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  setVercelUrl: (url) => ipcRenderer.send('set-vercel-url', url),
  relayConnect: (opts) => ipcRenderer.send('relay-connect', opts),
  relayDisconnect: () => ipcRenderer.send('relay-disconnect'),
  relayCommand: (cmd) => ipcRenderer.send('relay-command', cmd),
  onRelayStatus: (cb) => onEvent('relay-status', cb),
  startHostServices: () => ipcRenderer.send('start-host-services'),
});
