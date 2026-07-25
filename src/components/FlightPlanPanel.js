import React, { useState, useCallback, useEffect } from 'react';

const SPEED_PRESETS = [
  { id: 'SLOW', label: 'SLOW', value: 50 },
  { id: 'NORM', label: 'NORM', value: 120 },
  { id: 'FAST', label: 'FAST', value: 200 },
];

const ALTITUDE_PRESETS = [
  { id: 'LOW', label: 'LOW', value: 50 },
  { id: 'MED', label: 'MED', value: 150 },
  { id: 'HIGH', label: 'HIGH', value: 300 },
];

export default function FlightPlanPanel({ unit, onClose, onSubmit, onMapClick }) {
  const [waypoints, setWaypoints] = useState([]);
  const [speed, setSpeed] = useState(120);
  const [defaultAlt, setDefaultAlt] = useState(150);
  const [editingWp, setEditingWp] = useState(null);

  useEffect(() => {
    if (onMapClick) {
      onMapClick((x, y) => {
        const newWp = {
          id: Date.now(),
          x: Math.round(x),
          y: Math.round(y),
          altitude: defaultAlt,
          hoverTime: 0,
          description: `WP${waypoints.length + 1}`,
        };
        setWaypoints(prev => [...prev, newWp]);
      });
    }
  }, [onMapClick, waypoints.length, defaultAlt]);

  const removeWaypoint = useCallback((id) => {
    setWaypoints(prev => prev.filter(wp => wp.id !== id));
  }, []);

  const updateWaypoint = useCallback((id, updates) => {
    setWaypoints(prev => prev.map(wp => wp.id === id ? { ...wp, ...updates } : wp));
  }, []);

  const moveWaypoint = useCallback((id, direction) => {
    setWaypoints(prev => {
      const idx = prev.findIndex(wp => wp.id === id);
      if (idx < 0) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (waypoints.length === 0) return;
    onSubmit({
      type: 'MOVE_TO',
      unit_id: unit.id,
      x: waypoints[waypoints.length - 1].x,
      y: waypoints[waypoints.length - 1].y,
      waypoints: waypoints.map(wp => ({ x: wp.x, y: wp.y, altitude: wp.altitude, hoverTime: wp.hoverTime, description: wp.description })),
      speed,
    });
  }, [unit, waypoints, speed, onSubmit]);

  return (
    <div className="flight-plan-inline">
      <div className="fire-mission-section">
        <div className="fire-mission-label">SPEED</div>
        <div className="fire-mission-rounds">
          {SPEED_PRESETS.map(p => (
            <button key={p.id} className={`fire-mission-round-btn ${speed === p.value ? 'selected' : ''}`} onClick={() => setSpeed(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="fire-mission-section">
        <div className="fire-mission-label">ALTITUDE</div>
        <div className="fire-mission-rounds">
          {ALTITUDE_PRESETS.map(p => (
            <button key={p.id} className={`fire-mission-round-btn ${defaultAlt === p.value ? 'selected' : ''}`} onClick={() => setDefaultAlt(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="fire-mission-section">
        <div className="fire-mission-label">WAYPOINTS ({waypoints.length})</div>
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>Click map to add</div>
        {waypoints.length === 0 && (
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', padding: '8px 0' }}>No waypoints</div>
        )}
        {waypoints.map((wp, idx) => (
          <div key={wp.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 0', borderBottom: '1px solid var(--border-hairline)', fontFamily: 'var(--font-mono)', fontSize: '9px' }}>
            <span style={{ color: 'var(--accent)', width: '16px' }}>{idx + 1}</span>
            <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{wp.x},{wp.y} <span style={{ color: 'var(--text-muted)' }}>ALT:{wp.altitude}</span></span>
            <button className="flight-plan-wp-btn" onClick={() => moveWaypoint(wp.id, 'up')} disabled={idx === 0} style={{ fontSize: '8px', padding: '1px 3px' }}>↑</button>
            <button className="flight-plan-wp-btn" onClick={() => moveWaypoint(wp.id, 'down')} disabled={idx === waypoints.length - 1} style={{ fontSize: '8px', padding: '1px 3px' }}>↓</button>
            <button className="flight-plan-wp-btn" onClick={() => setEditingWp(editingWp === wp.id ? null : wp.id)} style={{ fontSize: '8px', padding: '1px 3px' }}>✎</button>
            <button className="flight-plan-wp-btn danger" onClick={() => removeWaypoint(wp.id)} style={{ fontSize: '8px', padding: '1px 3px' }}>✕</button>
            {editingWp === wp.id && (
              <div style={{ width: '100%', display: 'flex', gap: '4px', paddingTop: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <label style={{ fontSize: '8px', color: 'var(--text-muted)' }}>ALT</label>
                  <input type="number" value={wp.altitude} onChange={e => updateWaypoint(wp.id, { altitude: parseInt(e.target.value) || 0 })} style={{ width: '40px', fontSize: '9px', padding: '2px', background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <label style={{ fontSize: '8px', color: 'var(--text-muted)' }}>HOVER</label>
                  <input type="number" value={wp.hoverTime} onChange={e => updateWaypoint(wp.id, { hoverTime: parseInt(e.target.value) || 0 })} style={{ width: '30px', fontSize: '9px', padding: '2px', background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: '8px 0', display: 'flex', gap: '4px' }}>
        <button className="btn" style={{ flex: 1 }} onClick={onClose}>CANCEL</button>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={waypoints.length === 0} onClick={handleSubmit}>EXECUTE</button>
      </div>
    </div>
  );
}
