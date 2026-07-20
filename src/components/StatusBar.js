import React, { useState, useEffect } from 'react';

function formatElapsed(sec) {
  if (!sec) return '00:00';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ─── Status Bar ───────────────────────────────────────────────────────────────
export function StatusBar({ armaConnected, forceMetrics, missionPhase, missionElapsedSec, rewardData, onCommsToggle }) {
  const [clock, setClock] = useState(new Date().toLocaleTimeString('en-GB', { hour12: false }));
  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en-GB', { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  const fpColor = forceMetrics.firepower_index < 50 ? 'danger' : forceMetrics.firepower_index < 70 ? 'warning' : 'good';

  return (
    <div className="statusbar">
      <div className="statusbar__item">
        <span className="statusbar__item-label">LOCAL:</span>
        <span className="statusbar__item-value">{clock}</span>
      </div>
      <div className="statusbar__divider" />
      <div className="statusbar__item">
        <span className="statusbar__item-label">ARMA:</span>
        <span className={`statusbar__item-value ${armaConnected ? 'good' : 'danger'}`}>
          {armaConnected ? 'CONNECTED' : 'OFFLINE'}
        </span>
      </div>
      <div className="statusbar__divider" />
      <div className="statusbar__item">
        <span className="statusbar__item-label">PHASE:</span>
        <span className={`statusbar__item-value ${missionPhase === 'ABORTING' ? 'danger' : ''}`}>{missionPhase}</span>
      </div>
      {missionPhase === 'ACTIVE' && (
        <>
          <div className="statusbar__divider" />
          <div className="statusbar__item">
            <span className="statusbar__item-label">ELAPSED:</span>
            <span className="statusbar__item-value good">{formatElapsed(missionElapsedSec)}</span>
          </div>
        </>
      )}
      <div className="statusbar__divider" />
      <div className="statusbar__item">
        <span className="statusbar__item-label">FP:</span>
        <span className={`statusbar__item-value ${fpColor}`}>{forceMetrics.firepower_index}%</span>
      </div>
      <div className="statusbar__item">
        <span className="statusbar__item-label">VEH:</span>
        <span className="statusbar__item-value">{forceMetrics.vehicles_active}/{forceMetrics.vehicles_total}</span>
      </div>
      {rewardData && (
        <>
          <div className="statusbar__divider" />
          <div className="statusbar__item">
            <span className="statusbar__item-label">SCORE:</span>
            <span className={`statusbar__item-value ${rewardData.score >= 0 ? 'good' : 'danger'}`}>
              {rewardData.score.toFixed(0)}
            </span>
          </div>
          {rewardData.friendly_kia > 0 && (
            <div className="statusbar__item">
              <span className="statusbar__item-label">KIA:</span>
              <span className="statusbar__item-value danger">{rewardData.friendly_kia}</span>
            </div>
          )}
        </>
      )}
      <div style={{ flex: 1 }} />
      <button onClick={onCommsToggle} style={{
        background: 'none', border: '1px solid var(--border-primary)', borderRadius: '3px',
        color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)',
        fontSize: '10px', padding: '2px 8px', letterSpacing: '1px'
      }}>
        ◈ COMMS
      </button>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '2px', marginLeft: '10px' }}>
        SPECTRE C2 v1.3.4
      </div>
    </div>
  );
}

// ─── TTS Helper ──────────────────────────────────────────────────────────────
let lastSpokenId = null;
function speakCommsEntry(entry) {
  if (!window.speechSynthesis) return;
  if (entry.id === lastSpokenId) return;
  lastSpokenId = entry.id;

  // Only speak YELLOW and RED priority messages (tactical comms)
  if (entry.priority !== 'YELLOW' && entry.priority !== 'RED') return;

  const text = `${entry.from} to ${entry.to}: ${entry.message}`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  utterance.pitch = 0.9;
  utterance.volume = 0.8;
  window.speechSynthesis.speak(utterance);
}

// ─── Comms Log ────────────────────────────────────────────────────────────────
export function CommsLog({ entries, onClose }) {
  const endRef = React.useRef(null);
  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [entries]);

  // TTS: speak new entries
  React.useEffect(() => {
    if (entries.length > 0) {
      speakCommsEntry(entries[entries.length - 1]);
    }
  }, [entries.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="comms-log">
      <div className="comms-log__header">
        <span>◈ COMMS LOG</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
            {entries.length} entries
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}>✕</button>
        </div>
      </div>
      <div className="comms-log__entries">
        {entries.length === 0
          ? <div style={{ color: 'var(--text-muted)', padding: '10px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>No transmissions.</div>
          : entries.map(e => (
            <div key={e.id} className={`comms-entry ${e.priority}`}>
              <span className="comms-entry__time">{e.timestamp}</span>
              <span className="comms-entry__from">{e.from} → {e.to}:</span>
              {e.message}
            </div>
          ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ─── Settings Modal ───────────────────────────────────────────────────────────
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

  useEffect(() => {
    window.spectreAPI?.getArmaInfo?.().then(info => {
      if (info?.installPath) setArmaPath(info.installPath);
    });
    window.spectreAPI?.checkModStatus?.().then(setModStatus);
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
        setShowFolderList(true); // show "none found" message
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
        setArmaPathStatus(result.message || `${modType.toUpperCase()} installed successfully`);
        setTimeout(() => setArmaPathStatus(''), 3000);
      } else {
        setArmaPathStatus(result?.error || 'Installation failed');
      }
    } catch (e) {
      setArmaPathStatus('Installation failed: ' + e.message);
    }
    setInstalling('');
  };

  return (
    <div className="settings-modal">
      <div className="settings-container" style={{ maxWidth: '560px' }}>
        <div className="settings-title">Configuration</div>

        {/* AI Provider */}
        <div className="settings-field">
          <label className="settings-label">AI Provider</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {Object.keys(PRESETS).map(p => (
              <button key={p} className={`btn ${form.ai_provider === p ? 'btn-primary' : ''}`}
                style={{ fontSize: '11px', textTransform: 'capitalize' }}
                onClick={() => setForm(prev => ({ ...prev, ...PRESETS[p] }))}>
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* API Keys */}
        <div className="settings-field">
          <label className="settings-label">
            API Keys (one per line — rotate on rate limit, last to first)
          </label>
          <textarea
            className="planning-input"
            rows={4}
            placeholder={'sk-or-v1-...\nsk-or-v1-...'}
            value={(form.api_keys || []).join('\n')}
            onChange={e => setForm(prev => ({ ...prev, api_keys: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))}
            style={{ minHeight: '60px', maxHeight: '120px' }}
          />
          <div style={{ marginTop: '4px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
            {(form.api_keys || []).length} key{(form.api_keys || []).length !== 1 ? 's' : ''} configured
          </div>
        </div>

        {/* Other API fields */}
        {[
          { key: 'model',         label: 'Primary Model',  placeholder: 'qwen/qwen3-next-80b-a3b-instruct:free' },
          { key: 'fallback_model',label: 'Fallback Model', placeholder: 'qwen/qwen3-next-80b-a3b-instruct:free' },
          { key: 'base_url',      label: 'Base URL',       placeholder: 'https://openrouter.ai/api/v1' },
        ].map(f => (
          <div className="settings-field" key={f.key}>
            <label className="settings-label">{f.label}</label>
            <input
              className="settings-input"
              type="text"
              placeholder={f.placeholder}
              value={form[f.key] || ''}
              onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
            />
          </div>
        ))}

        {/* ── Arma 3 Installation Path ── */}
        <div className="settings-field">
          <label className="settings-label">
            Arma 3 Installation Path
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', marginLeft: '8px', fontWeight: 400 }}>
              (for auto mod install)
            </span>
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              className="settings-input"
              style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '11px' }}
              placeholder="C:\Program Files (x86)\Steam\steamapps\common\Arma 3"
              value={armaPath}
              onChange={e => setArmaPath(e.target.value)}
            />
            <button
              className="btn"
              style={{ fontSize: '11px', whiteSpace: 'nowrap' }}
              onClick={async () => {
                setBrowsing(true);
                try {
                  const result = await window.spectreAPI?.setArmaPath?.(armaPath || undefined);
                  if (result?.success) {
                    setArmaPath(result.path);
                    setArmaPathStatus('saved');
                    setTimeout(() => setArmaPathStatus(''), 2000);
                  } else if (result?.error) {
                    setArmaPathStatus(result.error);
                  }
                } catch (_) {}
                setBrowsing(false);
              }}
              disabled={browsing}
            >
              {browsing ? '...' : 'Browse'}
            </button>
          </div>
          {armaPathStatus === 'saved' && (
            <div style={{ marginTop: '4px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent)' }}>
              Path saved — SPECTRE will install the mod to this location
            </div>
          )}
          {armaPathStatus && armaPathStatus !== 'saved' && (
            <div style={{ marginTop: '4px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--yellow)' }}>
              {armaPathStatus}
            </div>
          )}
        </div>

        {/* ── Mod Installation ── */}
        {armaPath && (
          <div className="settings-field">
            <label className="settings-label">Mods</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className={`btn ${modStatus.spectre ? 'btn-success' : 'btn-primary'}`}
                style={{ flex: 1, fontSize: '11px' }}
                onClick={() => handleInstallMod('spectre')}
                disabled={installing === 'spectre' || modStatus.spectre}
              >
                {installing === 'spectre' ? 'Installing...' : modStatus.spectre ? '@SPECTRE Installed' : 'Install @SPECTRE'}
              </button>
              <button
                className={`btn ${modStatus.cba ? 'btn-success' : ''}`}
                style={{ flex: 1, fontSize: '11px' }}
                onClick={() => handleInstallMod('cba')}
                disabled={installing === 'cba' || modStatus.cba}
              >
                {installing === 'cba' ? 'Downloading...' : modStatus.cba ? '@CBA_A3 Installed' : 'Install @CBA_A3'}
              </button>
            </div>
            <div style={{ marginTop: '4px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
              Both mods are required. CBA_A3 will be downloaded from GitHub.
            </div>
          </div>
        )}

        {/* ── Mission Folder ── */}
        <div className="settings-field">
          <label className="settings-label">
            Arma 3 Mission Folder
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', marginLeft: '8px', fontWeight: 400 }}>
              (SPECTRE writes spectre_to_arma.sqf here)
            </span>
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              className="settings-input"
              style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '11px' }}
              placeholder="C:\Users\You\Documents\Arma 3\missions\MyMission.Altis"
              value={form.mission_folder_path || ''}
              onChange={e => setForm(prev => ({ ...prev, mission_folder_path: e.target.value }))}
            />
            <button
              className="btn"
              style={{ fontSize: '11px', whiteSpace: 'nowrap' }}
              onClick={handleAutoDetect}
              disabled={detecting}
            >
              {detecting ? '...' : 'Auto-detect'}
            </button>
          </div>

          {/* Folder picker list */}
          {showFolderList && (
            <div style={{
              marginTop: '6px', background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-accent)', borderRadius: '3px',
              maxHeight: '160px', overflowY: 'auto'
            }}>
              {detectedFolders.length === 0
                ? (
                  <div style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
                    No mission folders found in Documents\Arma 3\missions
                  </div>
                )
                : detectedFolders.map((f, i) => (
                  <div key={i}
                    onClick={() => selectFolder(f.path)}
                    style={{
                      padding: '7px 10px', cursor: 'pointer',
                      borderBottom: '1px solid var(--border-primary)',
                      fontFamily: 'var(--font-mono)', fontSize: '11px'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    <div style={{ color: 'var(--text-bright)', marginBottom: '2px' }}>{f.name}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{f.path}</div>
                  </div>
                ))
              }
            </div>
          )}

          {/* Validation indicator */}
          {form.mission_folder_path && (
            <div style={{ marginTop: '4px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
              <span style={{ color: 'var(--accent)' }}>OK </span>
              <span style={{ color: 'var(--text-muted)' }}>
                Commands will write to: {form.mission_folder_path}\spectre_to_arma.sqf
              </span>
            </div>
          )}
          {!form.mission_folder_path && (
            <div style={{ marginTop: '4px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--yellow)' }}>
              Not set — SPECTRE cannot send commands to Arma until this is configured
            </div>
          )}
        </div>

        {/* Bridge diagnostics */}
        {bridgePaths && (
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
            borderRadius: '3px', padding: '10px', marginBottom: '14px'
          }}>
            <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: '6px' }}>
              BRIDGE DIAGNOSTICS
            </div>
            {[
              ['Arma log', bridgePaths.arma_log_watched],
              ['Commands file', bridgePaths.spectre_to_arma],
            ].map(([label, val]) => (
              <div key={label} style={{ display: 'flex', gap: '8px', marginBottom: '3px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: '90px' }}>{label}:</span>
                <span style={{ color: 'var(--accent-bright)', wordBreak: 'break-all' }}>{val}</span>
              </div>
            ))}
          </div>
        )}

        <div className="settings-footer">
          <button className="btn" onClick={onClose}>CANCEL</button>
          <button className={`btn ${saved ? 'btn-success' : 'btn-primary'}`} onClick={handleSave}>
            {saved ? 'SAVED' : 'SAVE CONFIG'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default StatusBar;
