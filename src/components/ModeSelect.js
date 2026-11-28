import React, { useState } from 'react';
import Icon from './Icon';

export default function ModeSelect({ onSelect, savedRoomCode }) {
  const [mode, setMode] = useState(null);
  const [roomCode, setRoomCode] = useState(savedRoomCode || '');
  const [error, setError] = useState('');

  const handleHost = () => {
    if (typeof onSelect === 'function') onSelect({ mode: 'host', roomCode: '' });
  };

  const handleClient = () => {
    const code = roomCode.trim().toUpperCase();
    if (!code || code.length < 4) {
      setError('Enter a room code (at least 4 characters)');
      return;
    }
    if (typeof onSelect === 'function') onSelect({ mode: 'client', roomCode: code });
  };

  return (
    <div className="start">
      <div className="start__window">
        <button onClick={() => window.spectreAPI?.minimize()} aria-label="Minimise"><Icon name="minimize" size={15} /></button>
        <button className="close" onClick={() => window.spectreAPI?.close()} aria-label="Close"><Icon name="close" size={15} /></button>
      </div>

      <div className="start__card">
        <svg className="start__mark" width="44" height="44" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l10 10-10 10L2 12z" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M12 7.5l4.2 8.8-4.2-2.6-4.2 2.6z" fill="currentColor" />
        </svg>
        <h1>SPECTRE</h1>
        <p className="start__sub">Command &amp; control</p>

        {!mode ? (
          <div className="start__choices">
            <button onClick={() => setMode('host')}>
              <Icon name="units" size={26} />
              <strong>Host</strong>
              <span>Arma 3 runs on this PC. Command from here, and pair phones.</span>
            </button>
            <button onClick={() => setMode('client')}>
              <Icon name="web" size={26} />
              <strong>Command</strong>
              <span>Watch a host remotely with its room code. View only.</span>
            </button>
          </div>
        ) : mode === 'host' ? (
          <div className="start__form">
            <p>Starts the link to Arma 3 on this PC. A room code is created for remote viewers.</p>
            <button className="start__go" onClick={handleHost}>Start Host</button>
            <button className="start__back" onClick={() => setMode(null)}>Back</button>
          </div>
        ) : (
          <div className="start__form">
            <p>Enter the room code from the host PC.</p>
            <input
              value={roomCode}
              onChange={e => { setRoomCode(e.target.value.toUpperCase()); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleClient()}
              placeholder="e.g. ALPHA-1"
              maxLength={20}
            />
            {error && <div className="start__error">{error}</div>}
            <button className="start__go" onClick={handleClient}>Connect</button>
            <button className="start__back" onClick={() => setMode(null)}>Back</button>
          </div>
        )}
      </div>

      <p className="start__version">v{window.__APP_VERSION || '?'}</p>
    </div>
  );
}
