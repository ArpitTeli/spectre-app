import React, { useCallback, useEffect, useState } from 'react';

// Shows what a commander's phone needs in order to send orders to this host.
export default function PairModal({ onClose }) {
  const [info, setInfo] = useState(null);
  const [show, setShow] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const refresh = useCallback(() => {
    window.spectreAPI?.getPairingInfo?.().then(setInfo).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const renew = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await window.spectreAPI?.resetPairing?.();
    setConfirming(false);
    refresh();
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
          <p>In the SPECTRE Android app, open Connection and enter this PC's address and the pairing code.</p>
          <div style={{ margin: '12px 0' }}>
            {(info?.addresses || []).map((a) => (
              <div key={a.address} style={row}>
                <span style={{ color: 'var(--text-muted)' }}>{a.name}</span>
                <strong style={{ userSelect: 'text' }}>{a.address}</strong>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', padding: 12, border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)', fontSize: 20, letterSpacing: 2, userSelect: 'text' }}>
            {show ? info?.code : '••••-••••-••••-••••'}
          </div>
          <div style={row}>
            <span>Commanders connected</span>
            <strong>{info?.commanders ?? 0}</strong>
          </div>
          <p style={{ color: 'var(--text-muted)' }}>
            Anyone with this code can command your units. Connections are not encrypted, so use a trusted network.
          </p>
        </div>
        <div className="modal__footer">
          <button className="statusbar__btn" onClick={renew}>
            {confirming ? 'Confirm: disconnect all and make a new code' : 'New code'}
          </button>
          <button className="statusbar__btn" onClick={() => setShow((s) => !s)}>{show ? 'Hide code' : 'Show code'}</button>
        </div>
      </div>
    </div>
  );
}
