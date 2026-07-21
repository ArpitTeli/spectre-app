import React from 'react';

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

const PHASE_LABELS = {
  PLANNING: 'PLANNING',
  BRIEFING: 'BRIEFING',
  ACTIVE: 'ACTIVE',
  ABORTING: 'EMERGENCY',
  AAR: 'AFTER ACTION REVIEW'
};

export default function TitleBar({ missionPhase, missionElapsedSec, armaConnected, mode, roomCode, relayClients, relayError, relayConnecting, onSwitchMode, onMinimize, onMaximize, onClose }) {
  return (
    <div className="titlebar">
      <span className="titlebar__logo">SPECTRE</span>
      <div className="titlebar__divider" />
      <span className={`phase-badge ${(missionPhase || '').toLowerCase()}`}>
        {PHASE_LABELS[missionPhase] || 'STANDBY'}
      </span>
      {missionPhase === 'ACTIVE' && (
        <>
          <div className="titlebar__divider" />
          <span className="timer-display">T+{formatTime(missionElapsedSec || 0)}</span>
        </>
      )}
      <div className="titlebar__divider" />
      <div className="titlebar__connection">
        <div className={`titlebar__connection-dot ${armaConnected ? 'connected' : ''}`} />
        <span style={{ color: relayError ? 'var(--red)' : relayConnecting ? 'var(--yellow)' : armaConnected ? 'var(--green)' : 'var(--text-muted)' }}>
          {relayError
            ? relayError.toUpperCase()
            : relayConnecting
              ? 'CONNECTING'
              : mode === 'client'
                ? (armaConnected ? 'HOST LINKED' : 'NO HOST')
                : (armaConnected ? 'ARMA LINKED' : 'NO LINK')
          }
        </span>
      </div>
      {roomCode && (
        <>
          <div className="titlebar__divider" />
          <span className="badge badge-primary">{mode === 'client' ? 'ROOM' : 'HOST'}: {roomCode}</span>
          {mode === 'host' && relayClients > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)' }}>
              {relayClients} CLIENT{(relayClients !== 1 ? 'S' : '')}
            </span>
          )}
        </>
      )}
      {onSwitchMode && (
        <>
          <div className="titlebar__divider" />
          <button className="titlebar__btn" onClick={onSwitchMode} title="Switch mode">⇄</button>
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
