import React, { useState, useCallback, useEffect, useRef } from 'react';

const AMMO_TYPES = [
  { id: 'HE', label: 'HE', description: 'High Explosive' },
  { id: 'SMOKE', label: 'SMOKE', description: 'Smoke screening' },
  { id: 'ILLUM', label: 'ILLUM', description: 'Illumination' },
  { id: 'WP', label: 'WP', description: 'White Phosphorus' },
  { id: 'CLUSTER', label: 'CLUSTER', description: 'Cluster munitions' },
];

const FIRE_MODES = [
  { id: 'DIRECT', label: 'DIRECT', description: 'Line of sight' },
  { id: 'INDIRECT', label: 'INDIRECT', description: 'Over terrain' },
];

const ROUND_COUNTS = [1, 2, 3, 4, 6, 8, 10, 12];

export default function FireMissionPanel({ unit, onClose, onSubmit, onMapClick }) {
  const [targetX, setTargetX] = useState('');
  const [targetY, setTargetY] = useState('');
  const [ammoType, setAmmoType] = useState('HE');
  const [rounds, setRounds] = useState(6);
  const [fireMode, setFireMode] = useState('INDIRECT');
  const targetInputRef = useRef(null);

  useEffect(() => {
    if (targetInputRef.current) targetInputRef.current.focus();
  }, []);

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
    onSubmit({ type: 'ARTILLERY_STRIKE', unit_id: unit.id, x, y, rounds, ammoType, fireMode });
  }, [unit, targetX, targetY, rounds, ammoType, fireMode, onSubmit]);

  return (
    <div className="fire-mission-inline">
      <div className="fire-mission-section">
        <div className="fire-mission-label">TARGET COORDINATES</div>
        <div className="fire-mission-coords">
          <div className="fire-mission-input-group">
            <label>X</label>
            <input ref={targetInputRef} type="number" value={targetX} onChange={e => setTargetX(e.target.value)} placeholder="Click map" className="fire-mission-input" />
          </div>
          <div className="fire-mission-input-group">
            <label>Y</label>
            <input type="number" value={targetY} onChange={e => setTargetY(e.target.value)} placeholder="Click map" className="fire-mission-input" />
          </div>
        </div>
      </div>

      <div className="fire-mission-section">
        <div className="fire-mission-label">AMMO</div>
        <div className="fire-mission-grid" style={{ gridTemplateColumns: '1fr' }}>
          {AMMO_TYPES.map(ammo => (
            <button key={ammo.id} className={`fire-mission-option compact ${ammoType === ammo.id ? 'selected' : ''}`} onClick={() => setAmmoType(ammo.id)}>
              <div className="fire-mission-option-label">{ammo.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="fire-mission-section">
        <div className="fire-mission-label">ROUNDS</div>
        <div className="fire-mission-rounds">
          {ROUND_COUNTS.map(count => (
            <button key={count} className={`fire-mission-round-btn ${rounds === count ? 'selected' : ''}`} onClick={() => setRounds(count)}>{count}</button>
          ))}
        </div>
      </div>

      <div className="fire-mission-section">
        <div className="fire-mission-label">FIRE MODE</div>
        <div className="fire-mission-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {FIRE_MODES.map(mode => (
            <button key={mode.id} className={`fire-mission-option compact ${fireMode === mode.id ? 'selected' : ''}`} onClick={() => setFireMode(mode.id)}>
              <div className="fire-mission-option-label">{mode.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '8px 0', display: 'flex', gap: '4px' }}>
        <button className="btn" style={{ flex: 1 }} onClick={onClose}>CANCEL</button>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={!targetX || !targetY} onClick={handleSubmit}>FIRE</button>
      </div>
    </div>
  );
}
