import React, { useCallback, useEffect, useState } from 'react';

// Shows what a commander's phone needs in order to send orders to this host.
export default function PairModal({ onClose }) {
  const [info, setInfo] = useState(null);
  const [show, setShow] = useState(false);
  const [next, setNext] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(() => {
    window.spectreAPI?.getPairingInfo?.().then(setInfo).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const change = async () => {
    const result = await window.spectreAPI?.setPairingPassword?.(next);
    if (result?.success) {
      setNext('');
      setMessage('Password changed. Phones must connect again.');
      refresh();
    } else {
      setMessage(result?.error || 'Could not change the password.');
    }
  };

  const row = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontFamily: 'var(--font-mono)', fontSize: 12 };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span>Pair a commander</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body" style={{ color: 'var(--text-primary)', fontSize: 12 }}>
          <p>In the SPECTRE Android app, open Connection and enter this PC's address and the password.</p>
          <div style={{ margin: '12px 0' }}>
            {(info?.addresses || []).map((a) => (
              <div key={a.address} style={row}>
                <span style={{ color: 'var(--text-muted)' }}>{a.name}</span>
                <strong style={{ userSelect: 'text' }}>{a.address}</strong>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', padding: 12, border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)', fontSize: 20, letterSpacing: 2, userSelect: 'text' }}>
            {show ? info?.password : '••••••••'}
          </div>
          <div style={row}>
            <span>Commanders connected</span>
            <strong>{info?.commanders ?? 0}</strong>
          </div>
          <p style={{ color: 'var(--text-muted)' }}>
            Anyone with this password can command your units. A short password is easy to work out, and connections are not
            encrypted, so use a trusted network.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="field"
              type="password"
              placeholder="New password (4 characters or more)"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && change()}
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={change}>Set password</button>
          </div>
          {message && <p style={{ color: 'var(--text-muted)' }}>{message}</p>}
        </div>
        <div className="modal__footer">
          <button className="btn btn-primary" onClick={() => setShow((s) => !s)}>{show ? 'Hide password' : 'Show password'}</button>
        </div>
      </div>
    </div>
  );
}
