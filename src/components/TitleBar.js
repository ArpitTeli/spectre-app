import React from 'react';

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

const PHASE_LABELS = {
  PLANNING: 'PRE-MISSION PLANNING',
  BRIEFING: 'MISSION BRIEFING',
  ACTIVE: 'MISSION ACTIVE',
  ABORTING: 'EMERGENCY',
  AAR: 'AFTER ACTION REVIEW'
};

export default function TitleBar({ missionPhase, missionElapsedSec, armaConnected, mode, roomCode, relayClients, relayError, relayConnecting, onSwitchMode, onMinimize, onMaximize, onClose }) {
  return (
    <div className="titlebar">
      <span className="titlebar__logo">SPECTRE</span>
      <div className="titlebar__divider" />
      <span className="titlebar__phase" style={{ color: missionPhase === 'ABORTING' ? 'var(--color-red)' : undefined }}>
        {PHASE_LABELS[missionPhase] || 'STANDBY'}
      </span>

      {missionPhase === 'ACTIVE' && (
        <>
          <div className="titlebar__divider" />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent)', letterSpacing: '1px' }}>
            T+{formatTime(missionElapsedSec || 0)}
          </span>
        </>
      )}

      <div className="titlebar__divider" />
      <div className="titlebar__connection">
        <div className={`titlebar__connection-dot ${armaConnected ? 'connected' : ''}`} />
        <span style={{
          color: relayError ? 'var(--red)' : relayConnecting ? 'var(--yellow)' : armaConnected ? 'var(--accent)' : 'var(--red)',
          fontFamily: 'var(--font-mono)', fontSize: '10px'
        }}>
          {relayError
            ? relayError.toUpperCase()
            : relayConnecting
              ? 'CONNECTING...'
              : mode === 'client'
                ? (armaConnected ? 'CONNECTED TO HOST' : 'HOST DISCONNECTED')
                : (armaConnected ? 'ARMA LINK ACTIVE' : 'ARMA NOT CONNECTED')
          }
        </span>
      </div>

      {roomCode && (
        <>
          <div className="titlebar__divider" />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
              {mode === 'client' ? 'ROOM:' : 'HOSTING:'}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600,
              color: 'var(--accent)', background: 'var(--accent-dim)',
              padding: '1px 6px', borderRadius: '3px', letterSpacing: '1px'
            }}>
              {roomCode}
            </span>
            {mode === 'host' && relayClients > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
                {relayClients} connected
              </span>
            )}
          </div>
        </>
      )}

      {onSwitchMode && (
        <>
          <div className="titlebar__divider" />
          <button
            onClick={onSwitchMode}
            style={{
              background: 'none', border: '1px solid var(--border-default)', borderRadius: '3px',
              color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)',
              fontSize: '9px', padding: '2px 8px', letterSpacing: '1px',
              WebkitAppRegion: 'no-drag'
            }}
            title="Switch mode / change room"
          >
            ⇄ MODE
          </button>
        </>
      )}

      <div className="titlebar__spacer" />
      <div className="titlebar__controls">
        <button className="titlebar__btn" onClick={onMinimize}>─</button>
        <button className="titlebar__btn" onClick={onMaximize}>□</button>
        <button className="titlebar__btn close" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
