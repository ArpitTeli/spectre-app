import React, { useState, useCallback, useEffect, useRef } from 'react';

const AMMO_TYPES = [
  { id: 'HE', label: 'HE', description: 'High Explosive — Anti-personnel/soft targets' },
  { id: 'SMOKE', label: 'SMOKE', description: 'Smoke screening — Obscuration' },
  { id: 'ILLUM', label: 'ILLUM', description: 'Illumination — Flares' },
  { id: 'WP', label: 'WP', description: 'White Phosphorus — Incendiary' },
  { id: 'CLUSTER', label: 'CLUSTER', description: 'Cluster munitions — Area denial' },
];

const FIRE_MODES = [
  { id: 'DIRECT', label: 'DIRECT', description: 'Line of sight fire' },
  { id: 'INDIRECT', label: 'INDIRECT', description: 'Over terrain obstacles' },
];

const ROUND_COUNTS = [1, 2, 3, 4, 6, 8, 10, 12];

export default function FireMissionPanel({ unit, onClose, onSubmit, onMapClick }) {
  const [targetX, setTargetX] = useState('');
  const [targetY, setTargetY] = useState('');
  const [ammoType, setAmmoType] = useState('HE');
  const [rounds, setRounds] = useState(6);
  const [fireMode, setFireMode] = useState('INDIRECT');
  const [phase, setPhase] = useState('SET_TARGET'); // SET_TARGET | CONFIRM
  const targetInputRef = useRef(null);

  useEffect(() => {
    if (targetInputRef.current) {
      targetInputRef.current.focus();
    }
  }, [phase]);

  useEffect(() => {
    if (onMapClick) {
      onMapClick((x, y) => {
        setTargetX(Math.round(x).toString());
        setTargetY(Math.round(y).toString());
      });
    }
  }, [onMapClick]);

  const handleSubmit = useCallback(() => {
    const x = parseFloat(targetX);
    const y = parseFloat(targetY);
    if (isNaN(x) || isNaN(y)) return;

    onSubmit({
      type: 'ARTILLERY_STRIKE',
      unit_id: unit.id,
      x, y,
      rounds,
      ammoType,
      fireMode,
    });
    onClose();
  }, [unit, targetX, targetY, rounds, ammoType, fireMode, onSubmit, onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && phase === 'CONFIRM') handleSubmit();
  }, [onClose, phase, handleSubmit]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <span>FIRE MISSION — {unit?.callsign || unit?.id || 'UNKNOWN'}</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {phase === 'SET_TARGET' && (
            <div className="fire-mission-form">
              <div className="fire-mission-section">
                <div className="fire-mission-label">TARGET COORDINATES</div>
                <div className="fire-mission-coords">
                  <div className="fire-mission-input-group">
                    <label>EASTING (X)</label>
                    <input
                      ref={targetInputRef}
                      type="number"
                      value={targetX}
                      onChange={e => setTargetX(e.target.value)}
                      placeholder="Click map or enter"
                      className="fire-mission-input"
                    />
                  </div>
                  <div className="fire-mission-input-group">
                    <label>NORTHING (Y)</label>
                    <input
                      type="number"
                      value={targetY}
                      onChange={e => setTargetY(e.target.value)}
                      placeholder="Click map or enter"
                      className="fire-mission-input"
                    />
                  </div>
                </div>
                <div className="fire-mission-hint">Click on map to set target coordinates</div>
              </div>

              <div className="fire-mission-section">
                <div className="fire-mission-label">AMMUNITION</div>
                <div className="fire-mission-grid">
                  {AMMO_TYPES.map(ammo => (
                    <button
                      key={ammo.id}
                      className={`fire-mission-option ${ammoType === ammo.id ? 'selected' : ''}`}
                      onClick={() => setAmmoType(ammo.id)}
                    >
                      <div className="fire-mission-option-label">{ammo.label}</div>
                      <div className="fire-mission-option-desc">{ammo.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="fire-mission-section">
                <div className="fire-mission-label">ROUNDS</div>
                <div className="fire-mission-rounds">
                  {ROUND_COUNTS.map(count => (
                    <button
                      key={count}
                      className={`fire-mission-round-btn ${rounds === count ? 'selected' : ''}`}
                      onClick={() => setRounds(count)}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>

              <div className="fire-mission-section">
                <div className="fire-mission-label">FIRE MODE</div>
                <div className="fire-mission-grid">
                  {FIRE_MODES.map(mode => (
                    <button
                      key={mode.id}
                      className={`fire-mission-option ${fireMode === mode.id ? 'selected' : ''}`}
                      onClick={() => setFireMode(mode.id)}
                    >
                      <div className="fire-mission-option-label">{mode.label}</div>
                      <div className="fire-mission-option-desc">{mode.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {phase === 'CONFIRM' && (
            <div className="fire-mission-confirm">
              <div className="fire-mission-confirm-title">CONFIRM FIRE MISSION</div>
              <div className="fire-mission-summary">
                <div className="fire-mission-summary-row">
                  <span className="fire-mission-summary-label">TARGET:</span>
                  <span className="fire-mission-summary-value">{targetX}, {targetY}</span>
                </div>
                <div className="fire-mission-summary-row">
                  <span className="fire-mission-summary-label">AMMO:</span>
                  <span className="fire-mission-summary-value">{ammoType}</span>
                </div>
                <div className="fire-mission-summary-row">
                  <span className="fire-mission-summary-label">ROUNDS:</span>
                  <span className="fire-mission-summary-value">{rounds}</span>
                </div>
                <div className="fire-mission-summary-row">
                  <span className="fire-mission-summary-label">MODE:</span>
                  <span className="fire-mission-summary-value">{fireMode}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal__footer">
          {phase === 'SET_TARGET' ? (
            <>
              <button className="btn" onClick={onClose}>CANCEL</button>
              <button
                className="btn btn-primary"
                disabled={!targetX || !targetY}
                onClick={() => setPhase('CONFIRM')}
              >
                REVIEW
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setPhase('SET_TARGET')}>BACK</button>
              <button className="btn btn-primary" onClick={handleSubmit}>FIRE MISSION</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
