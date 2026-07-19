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
  ABORTING: '⚠ EMERGENCY',
  AAR: 'AFTER ACTION REVIEW'
};

export default function TitleBar({ missionPhase, missionElapsedSec, armaConnected, onMinimize, onMaximize, onClose }) {
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
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--color-green)', letterSpacing: '1px' }}>
            T+{formatTime(missionElapsedSec || 0)}
          </span>
        </>
      )}

      <div className="titlebar__divider" />
      <div className="titlebar__connection">
        <div className={`titlebar__connection-dot ${armaConnected ? 'connected' : ''}`} />
        <span style={{
          color: armaConnected ? 'var(--color-green)' : '#ff4444',
          fontFamily: 'var(--font-mono)', fontSize: '10px'
        }}>
          {armaConnected ? 'ARMA LINK ACTIVE' : 'ARMA NOT CONNECTED'}
        </span>
      </div>

      <div className="titlebar__spacer" />
      <div className="titlebar__controls">
        <button className="titlebar__btn" onClick={onMinimize}>─</button>
        <button className="titlebar__btn" onClick={onMaximize}>□</button>
        <button className="titlebar__btn close" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
