import React, { useState, useEffect } from 'react';

function formatElapsed(sec) {
  if (!sec) return '00:00';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

let lastSpokenId = null;
function speakCommsEntry(entry) {
  if (!window.speechSynthesis) return;
  if (entry.id === lastSpokenId) return;
  lastSpokenId = entry.id;
  if (entry.priority !== 'YELLOW' && entry.priority !== 'RED') return;
  const text = `${entry.from} to ${entry.to}: ${entry.message}`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  utterance.pitch = 0.9;
  utterance.volume = 0.8;
  window.speechSynthesis.speak(utterance);
}

export function StatusBar({ armaConnected, forceMetrics, missionPhase, missionElapsedSec, rewardData, onCommsToggle, bridgePaths, mode, roomCode, relayClients }) {
  const [clock, setClock] = useState(new Date().toLocaleTimeString('en-GB', { hour12: false }));
  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en-GB', { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  const fpColor = forceMetrics.firepower_index < 50 ? 'danger' : forceMetrics.firepower_index < 70 ? 'warning' : '';
  const webUrl = bridgePaths?.web_viewer_url;

  return (
    <div className="statusbar">
      <div className="statusbar__item">
        <span className="statusbar__dot" style={{ background: armaConnected ? 'var(--green)' : 'var(--red)' }} />
        <span>{mode === 'client' ? 'RELAY' : 'ARMA'}</span>
      </div>
      <div className="statusbar__item">
        <span className={`statusbar__value ${armaConnected ? '' : ''}`} style={{ color: armaConnected ? 'var(--green)' : 'var(--red)' }}>
          {mode === 'client' ? (armaConnected ? 'ON' : 'OFF') : (armaConnected ? 'ON' : 'OFF')}
        </span>
      </div>
      <div className="statusbar__divider" style={{ width: '1px', height: '12px', background: 'var(--border-hairline)' }} />
      <div className="statusbar__item">
        <span className="statusbar__value">{clock}</span>
      </div>
      <div className="statusbar__divider" style={{ width: '1px', height: '12px', background: 'var(--border-hairline)' }} />
      <div className="statusbar__item">
        <span className={`statusbar__value ${missionPhase === 'ABORTING' ? 'danger' : ''}`}>{missionPhase}</span>
      </div>
      {missionPhase === 'ACTIVE' && (
        <>
          <div className="statusbar__divider" style={{ width: '1px', height: '12px', background: 'var(--border-hairline)' }} />
          <div className="statusbar__item">
            <span className="statusbar__value" style={{ color: 'var(--accent)' }}>T+{formatElapsed(missionElapsedSec)}</span>
          </div>
        </>
      )}
      <div className="statusbar__divider" style={{ width: '1px', height: '12px', background: 'var(--border-hairline)' }} />
      <div className="statusbar__item">
        <span className={`statusbar__value ${fpColor}`}>FP {forceMetrics.firepower_index}%</span>
      </div>
      <div className="statusbar__item">
        <span className="statusbar__value">{forceMetrics.vehicles_active}/{forceMetrics.vehicles_total} V</span>
      </div>
      {rewardData && (
        <>
          <div className="statusbar__divider" style={{ width: '1px', height: '12px', background: 'var(--border-hairline)' }} />
          <div className="statusbar__item">
            <span className={`statusbar__value ${rewardData.score >= 0 ? '' : 'danger'}`}>{rewardData.score.toFixed(0)}</span>
          </div>
          {rewardData.friendly_kia > 0 && (
            <div className="statusbar__item">
              <span className="statusbar__value" style={{ color: 'var(--red)' }}>KIA {rewardData.friendly_kia}</span>
            </div>
          )}
        </>
      )}
      <div className="statusbar__spacer" />
      {roomCode && (
        <div className="statusbar__item">
          <span className="badge badge-primary" style={{ fontSize: '8px', padding: '1px 6px' }}>
            {mode === 'client' ? 'ROOM' : 'HOST'}: {roomCode}
          </span>
          {mode === 'host' && relayClients > 0 && (
            <span className="statusbar__value" style={{ marginLeft: '2px' }}>{relayClients}CL</span>
          )}
        </div>
      )}
      {webUrl && (
        <button className="statusbar__btn" onClick={() => window.spectreAPI?.openExternal?.(webUrl)}>◎ WEB</button>
      )}
      <button className="statusbar__btn" onClick={onCommsToggle}>◈ COMMS</button>
      <div className="statusbar__value" style={{ fontSize: '8px', letterSpacing: '1px', color: 'var(--text-muted)' }}>v1.9.6</div>
    </div>
  );
}

export function CommsLog({ entries, onClose }) {
  const endRef = React.useRef(null);
  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [entries]);
  React.useEffect(() => {
    if (entries.length > 0) speakCommsEntry(entries[entries.length - 1]);
  }, [entries.length]);

  return (
    <div className="comms-log">
      <div className="comms-log__header">
        <span>◈ COMMS</span>
        <div className="flex items-center gap-2">
          <span className="text-muted text-sm">{entries.length} entries</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="comms-log__entries">
        {entries.length === 0
          ? <div className="empty-state" style={{ padding: '16px' }}>No transmissions.</div>
          : entries.map(e => (
            <div key={e.id} className={`comms-entry priority-${e.priority}`}>
              <div className="comms-entry__header">
                <span>{e.from} → {e.to}</span>
                <span>{e.timestamp}</span>
              </div>
              <div className="comms-entry__message">{e.message}</div>
            </div>
          ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

const SETTINGS_DEFAULTS = {
  model: 'qwen/qwen3-next-80b-a3b-instruct:free',
  fallback_model: 'qwen/qwen3-next-80b-a3b-instruct:free',
  base_url: 'https://openrouter.ai/api/v1',
  api_keys: [],
  ai_provider: 'openrouter'
};

export function SettingsModal({ config, bridgePaths, onSave, onClose }) {
  const [form, setForm]             = useState(() => ({ ...SETTINGS_DEFAULTS, ...(config || {}) }));
  const [saved, setSaved]           = useState(false);
  const [detecting, setDetecting]   = useState(false);
  const [detectedFolders, setDetectedFolders] = useState([]);
  const [showFolderList, setShowFolderList]   = useState(false);
  const [armaPath, setArmaPath]     = useState('');
  const [armaPathStatus, setArmaPathStatus] = useState('');
  const [browsing, setBrowsing]     = useState(false);
  const [modStatus, setModStatus]   = useState({});
  const [installing, setInstalling] = useState('');
  const [livePaths, setLivePaths]   = useState(null);

  useEffect(() => {
    window.spectreAPI?.getPaths?.().then(setLivePaths).catch(() => {});
    window.spectreAPI?.getArmaInfo?.().then(info => {
      if (info?.installPath) setArmaPath(info.installPath);
    }).catch(() => {});
    window.spectreAPI?.checkModStatus?.().then(setModStatus).catch(() => {});
  }, []);

  const PRESETS = {
    openrouter: { base_url: 'https://openrouter.ai/api/v1', model: 'qwen/qwen3-next-80b-a3b-instruct:free',    ai_provider: 'openrouter' },
    anthropic:  { base_url: 'https://api.anthropic.com/v1',  model: 'claude-opus-4-5',              ai_provider: 'anthropic'  },
    openai:     { base_url: 'https://api.openai.com/v1',     model: 'gpt-4o',                       ai_provider: 'openai'     },
    custom:     { ai_provider: 'custom' }
  };

  const handleSave = async () => {
    await onSave(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAutoDetect = async () => {
    setDetecting(true);
    setShowFolderList(false);
    try {
      const folders = await window.spectreAPI?.getMissionFolders();
      if (folders && folders.length > 0) {
        setDetectedFolders(folders);
        setShowFolderList(true);
      } else {
        setDetectedFolders([]);
        setShowFolderList(true);
      }
    } catch (e) {
      console.error('Auto-detect failed:', e);
    } finally {
      setDetecting(false);
    }
  };

  const selectFolder = (folderPath) => {
    setForm(prev => ({ ...prev, mission_folder_path: folderPath }));
    setShowFolderList(false);
  };

  const handleInstallMod = async (modType) => {
    setInstalling(modType);
    try {
      const result = await window.spectreAPI?.installMod?.(modType);
      if (result?.success) {
        setModStatus(prev => ({ ...prev, [modType]: true }));
        setArmaPathStatus(result.message || `${modType.toUpperCase()} installed`);
        setTimeout(() => setArmaPathStatus(''), 3000);
      } else {
        setArmaPathStatus(result?.error || 'Install failed');
      }
    } catch (e) {
      setArmaPathStatus('Install failed: ' + e.message);
    }
    setInstalling('');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <span>Configuration</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          <div className="settings-section">
            <div className="settings-section__title">AI Provider</div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {Object.keys(PRESETS).map(p => (
                <button key={p} className={`btn btn-sm ${form.ai_provider === p ? 'btn-primary' : ''}`} onClick={() => setForm(prev => ({ ...prev, ...PRESETS[p] }))}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section__title">API Keys</div>
            <div className="settings-field">
              <div className="settings-field__label">One per line — last key used on rate limit</div>
              <textarea style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-hairline)', borderRadius: '2px', padding: '6px 10px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '10px', outline: 'none', resize: 'vertical', minHeight: '60px', maxHeight: '120px' }}
                rows={3} placeholder={'sk-or-v1-...'}
                value={(form.api_keys || []).join('\n')}
                onChange={e => setForm(prev => ({ ...prev, api_keys: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))} />
              <div className="settings-field__label" style={{ marginTop: '2px' }}>{(form.api_keys || []).length} key{(form.api_keys || []).length !== 1 ? 's' : ''} configured</div>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section__title">Models</div>
            {[
              { key: 'model',         label: 'Primary',  ph: 'qwen/qwen3-next-80b-a3b-instruct:free' },
              { key: 'fallback_model',label: 'Fallback', ph: 'qwen/qwen3-next-80b-a3b-instruct:free' },
              { key: 'base_url',      label: 'Base URL', ph: 'https://openrouter.ai/api/v1' },
            ].map(f => (
              <div className="settings-field" key={f.key}>
                <div className="settings-field__label">{f.label}</div>
                <input type="text" placeholder={f.ph} value={form[f.key] || ''}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-hairline)', borderRadius: '2px', padding: '4px 8px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '10px', outline: 'none' }} />
              </div>
            ))}
          </div>
          <div className="settings-section">
            <div className="settings-section__title">Web Viewer</div>
            <div className="settings-field">
              <div className="settings-field__label">Vercel URL (optional)</div>
              <input type="text" placeholder="https://spectre-viewer.vercel.app" value={form.vercel_url || ''}
                onChange={e => setForm(prev => ({ ...prev, vercel_url: e.target.value }))}
                style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-hairline)', borderRadius: '2px', padding: '4px 8px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '10px', outline: 'none' }} />
              <div className="settings-field__label">{form.vercel_url ? 'Relayed to URL' : 'Local only (ws://3721)'}</div>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section__title">Arma 3</div>
            <div className="settings-field">
              <div className="settings-field__label">Install Path</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <input type="text" placeholder="E:\Games\Arma 3" value={armaPath}
                  onChange={e => setArmaPath(e.target.value)}
                  style={{ flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border-hairline)', borderRadius: '2px', padding: '4px 8px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '10px', outline: 'none' }} />
                <button className="btn btn-sm" onClick={async () => {
                  setBrowsing(true);
                  try { const r = await window.spectreAPI?.setArmaPath?.(armaPath || undefined); if (r?.success) setArmaPath(r.path); } catch (_) {}
                  setBrowsing(false);
                }} disabled={browsing}>SET</button>
              </div>
            </div>
            {armaPath && (
              <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                <button className={`btn btn-sm flex-1 ${modStatus.spectre ? 'btn-primary' : ''}`}
                  onClick={() => handleInstallMod('spectre')} disabled={installing === 'spectre' || modStatus.spectre}>
                  {installing === 'spectre' ? '...' : modStatus.spectre ? '@SPECTRE ✓' : 'Install @SPECTRE'}
                </button>
                <button className={`btn btn-sm flex-1 ${modStatus.cba ? 'btn-primary' : ''}`}
                  onClick={() => handleInstallMod('cba')} disabled={installing === 'cba' || modStatus.cba}>
                  {installing === 'cba' ? '...' : modStatus.cba ? '@CBA_A3 ✓' : 'Install @CBA_A3'}
                </button>
              </div>
            )}
            <div className="settings-field" style={{ marginTop: '8px' }}>
              <div className="settings-field__label">Mission Folder</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <input type="text" placeholder="...missions\SPECTRETEST2.Stratis" value={form.mission_folder_path || ''}
                  onChange={e => setForm(prev => ({ ...prev, mission_folder_path: e.target.value }))}
                  style={{ flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border-hairline)', borderRadius: '2px', padding: '4px 8px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '10px', outline: 'none' }} />
                <button className="btn btn-sm" onClick={handleAutoDetect} disabled={detecting}>{detecting ? '...' : 'SCAN'}</button>
              </div>
              {showFolderList && (
                <div style={{ marginTop: '4px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '2px', maxHeight: '120px', overflowY: 'auto' }}>
                  {detectedFolders.length === 0
                    ? <div className="text-muted text-sm" style={{ padding: '8px' }}>No folders found.</div>
                    : detectedFolders.map((f, i) => (
                      <div key={i} onClick={() => selectFolder(f.path)} className="cursor-pointer" style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: '10px', borderBottom: i < detectedFolders.length - 1 ? '1px solid var(--border-hairline)' : 'none' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <div style={{ color: 'var(--text-primary)' }}>{f.name}</div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
          {bridgePaths && (
            <div className="settings-section">
              <div className="settings-section__title">Bridge</div>
              {[
                ['Arma log', (livePaths || bridgePaths)?.arma_log_watched],
                ['Cmds file', (livePaths || bridgePaths)?.spectre_to_arma],
                ['Web viewer', (livePaths || bridgePaths)?.web_viewer_url + ' (' + ((livePaths || bridgePaths)?.ws_clients || 0) + ' cl)'],
              ].map(([label, val]) => (
                <div key={label} className="settings-field">
                  <div className="settings-field__label">{label}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--accent)', wordBreak: 'break-all' }}>{val}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal__footer">
          <button className="btn btn-sm" onClick={async () => {
            const result = await window.spectreAPI?.checkForUpdates?.();
            if (!result) alert('Update check unavailable.');
            else if (result.error) alert(`Update check failed: ${result.error}`);
            else if (result.hasUpdate) alert(`Update v${result.latestVersion} available.`);
            else alert(`Up to date (v${result.currentVersion}).`);
          }}>CHECK</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={onClose}>CANCEL</button>
          <button className={`btn btn-sm ${saved ? 'btn-primary' : ''}`} onClick={handleSave}>{saved ? 'SAVED' : 'SAVE'}</button>
        </div>
      </div>
    </div>
  );
}

export default StatusBar;
