import React, { useState } from 'react';

export default function ModeSelect({ onSelect }) {
  const [mode, setMode] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');

  const handleHost = () => {
    onSelect({ mode: 'host', roomCode: '' });
  };

  const handleClient = () => {
    const code = roomCode.trim().toUpperCase();
    if (!code || code.length < 4) {
      setError('Enter a room code (at least 4 characters)');
      return;
    }
    onSelect({ mode: 'client', roomCode: code });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#1b1b1b',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{ textAlign: 'center', maxWidth: 480, padding: '0 24px' }}>
        {/* Logo */}
        <div style={{
          fontFamily: "'Inter', sans-serif",
          fontWeight: 700,
          fontSize: 28,
          letterSpacing: 6,
          color: '#2a7de1',
          marginBottom: 8
        }}>
          SPECTRE
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: '#888',
          letterSpacing: 2,
          marginBottom: 48
        }}>
          COMMAND & CONTROL SYSTEM
        </div>

        {!mode ? (
          <>
            {/* Mode selection */}
            <div style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              color: '#a0a0a0',
              marginBottom: 24
            }}>
              How do you want to connect?
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
              {/* Host button */}
              <button
                onClick={() => setMode('host')}
                style={{
                  flex: 1, padding: '24px 16px',
                  background: '#212121',
                  border: '1px solid #3a3a3a',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'border-color 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#2a7de1'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#3a3a3a'}
              >
                <div style={{ fontSize: 24, marginBottom: 8, color: '#2a7de1' }}>🖥</div>
                <div style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#f5f6f7',
                  marginBottom: 6
                }}>
                  HOST
                </div>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: '#888',
                  lineHeight: 1.5
                }}>
                  Play Arma 3 on this PC<br />
                  Others connect to you
                </div>
              </button>

              {/* Client button */}
              <button
                onClick={() => setMode('client')}
                style={{
                  flex: 1, padding: '24px 16px',
                  background: '#212121',
                  border: '1px solid #3a3a3a',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'border-color 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#2a7de1'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#3a3a3a'}
              >
                <div style={{ fontSize: 24, marginBottom: 8, color: '#f5a623' }}>📡</div>
                <div style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#f5f6f7',
                  marginBottom: 6
                }}>
                  COMMAND
                </div>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: '#888',
                  lineHeight: 1.5
                }}>
                  Connect to a host PC<br />
                  Command troops remotely
                </div>
              </button>
            </div>
          </>
        ) : mode === 'host' ? (
          <>
            {/* Host mode — start directly */}
            <div style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              color: '#a0a0a0',
              marginBottom: 24
            }}>
              Host mode will start the Arma 3 bridge.
              <br />Other commanders can connect using your room code.
            </div>

            <button
              onClick={handleHost}
              style={{
                padding: '12px 48px',
                background: '#2a7de1',
                border: 'none',
                borderRadius: 3,
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                cursor: 'pointer',
                letterSpacing: 1,
                textTransform: 'uppercase',
                marginBottom: 16
              }}
            >
              Start Host
            </button>

            <div>
              <button
                onClick={() => setMode(null)}
                style={{
                  background: 'none', border: 'none',
                  color: '#888', cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10
                }}
              >
                ← Back
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Client mode — enter room code */}
            <div style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              color: '#a0a0a0',
              marginBottom: 24
            }}>
              Enter the room code from the host PC
            </div>

            <input
              value={roomCode}
              onChange={e => { setRoomCode(e.target.value.toUpperCase()); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleClient()}
              placeholder="e.g. ALPHA-1"
              maxLength={20}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: '#212121',
                border: '1px solid #3a3a3a',
                borderRadius: 3,
                color: '#f5f6f7',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 18,
                letterSpacing: 3,
                textAlign: 'center',
                outline: 'none',
                marginBottom: 8,
                textTransform: 'uppercase'
              }}
              onFocus={e => e.target.style.borderColor = '#2a7de1'}
              onBlur={e => e.target.style.borderColor = '#3a3a3a'}
            />

            {error && (
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: '#db3838',
                marginBottom: 12
              }}>
                {error}
              </div>
            )}

            <button
              onClick={handleClient}
              style={{
                padding: '12px 48px',
                background: '#2a7de1',
                border: 'none',
                borderRadius: 3,
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                cursor: 'pointer',
                letterSpacing: 1,
                textTransform: 'uppercase',
                marginBottom: 16
              }}
            >
              Connect
            </button>

            <div>
              <button
                onClick={() => setMode(null)}
                style={{
                  background: 'none', border: 'none',
                  color: '#888', cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10
                }}
              >
                ← Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
