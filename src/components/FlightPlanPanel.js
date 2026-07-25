import React, { useState, useCallback, useEffect } from 'react';

const SPEED_PRESETS = [
  { id: 'SLOW', label: 'SLOW', value: 50, description: '50 km/h — Recon' },
  { id: 'NORMAL', label: 'NORMAL', value: 120, description: '120 km/h — Transit' },
  { id: 'FAST', label: 'FAST', value: 200, description: '200 km/h — Emergency' },
];

const ALTITUDE_PRESETS = [
  { id: 'LOW', label: 'LOW', value: 50, description: '50m AGL — Nap of earth' },
  { id: 'MEDIUM', label: 'MED', value: 150, description: '150m AGL — Standard' },
  { id: 'HIGH', label: 'HIGH', value: 300, description: '300m AGL — High approach' },
];

export default function FlightPlanPanel({ unit, onClose, onSubmit, onMapClick }) {
  const [waypoints, setWaypoints] = useState([]);
  const [speed, setSpeed] = useState(120);
  const [defaultAlt, setDefaultAlt] = useState(150);
  const [editingWp, setEditingWp] = useState(null);
  const [phase, setPhase] = useState('PLAN'); // PLAN | CONFIRM

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
      waypoints: waypoints.map((wp, i) => ({
        x: wp.x,
        y: wp.y,
        altitude: wp.altitude,
        hoverTime: wp.hoverTime,
        description: wp.description,
      })),
      speed,
    });
    onClose();
  }, [unit, waypoints, speed, onSubmit, onClose]);

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
          <span>FLIGHT PLAN — {unit?.callsign || unit?.id || 'UNKNOWN'}</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {phase === 'PLAN' && (
            <div className="flight-plan-form">
              <div className="flight-plan-section">
                <div className="flight-plan-label">SPEED</div>
                <div className="flight-plan-grid">
                  {SPEED_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      className={`flight-plan-option ${speed === preset.value ? 'selected' : ''}`}
                      onClick={() => setSpeed(preset.value)}
                    >
                      <div className="flight-plan-option-label">{preset.label}</div>
                      <div className="flight-plan-option-desc">{preset.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flight-plan-section">
                <div className="flight-plan-label">DEFAULT ALTITUDE</div>
                <div className="flight-plan-grid">
                  {ALTITUDE_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      className={`flight-plan-option ${defaultAlt === preset.value ? 'selected' : ''}`}
                      onClick={() => setDefaultAlt(preset.value)}
                    >
                      <div className="flight-plan-option-label">{preset.label}</div>
                      <div className="flight-plan-option-desc">{preset.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flight-plan-section">
                <div className="flight-plan-label">WAYPOINTS ({waypoints.length})</div>
                <div className="flight-plan-hint">Click on map to add waypoints</div>
                <div className="flight-plan-waypoint-list">
                  {waypoints.length === 0 && (
                    <div className="flight-plan-empty">No waypoints added yet</div>
                  )}
                  {waypoints.map((wp, idx) => (
                    <div key={wp.id} className="flight-plan-waypoint">
                      <div className="flight-plan-wp-num">{idx + 1}</div>
                      <div className="flight-plan-wp-info">
                        <div className="flight-plan-wp-coords">{wp.x}, {wp.y}</div>
                        <div className="flight-plan-wp-details">
                          <span>ALT: {wp.altitude}m</span>
                          {wp.hoverTime > 0 && <span>HOVER: {wp.hoverTime}s</span>}
                        </div>
                      </div>
                      <div className="flight-plan-wp-actions">
                        <button
                          className="flight-plan-wp-btn"
                          onClick={() => moveWaypoint(wp.id, 'up')}
                          disabled={idx === 0}
                        >↑</button>
                        <button
                          className="flight-plan-wp-btn"
                          onClick={() => moveWaypoint(wp.id, 'down')}
                          disabled={idx === waypoints.length - 1}
                        >↓</button>
                        <button
                          className="flight-plan-wp-btn"
                          onClick={() => setEditingWp(editingWp === wp.id ? null : wp.id)}
                        >✎</button>
                        <button
                          className="flight-plan-wp-btn danger"
                          onClick={() => removeWaypoint(wp.id)}
                        >✕</button>
                      </div>
                      {editingWp === wp.id && (
                        <div className="flight-plan-wp-editor">
                          <div className="flight-plan-input-row">
                            <label>ALT (m)</label>
                            <input
                              type="number"
                              value={wp.altitude}
                              onChange={e => updateWaypoint(wp.id, { altitude: parseInt(e.target.value) || 0 })}
                              className="flight-plan-input-sm"
                            />
                          </div>
                          <div className="flight-plan-input-row">
                            <label>HOVER (s)</label>
                            <input
                              type="number"
                              value={wp.hoverTime}
                              onChange={e => updateWaypoint(wp.id, { hoverTime: parseInt(e.target.value) || 0 })}
                              className="flight-plan-input-sm"
                            />
                          </div>
                          <div className="flight-plan-input-row">
                            <label>DESC</label>
                            <input
                              type="text"
                              value={wp.description}
                              onChange={e => updateWaypoint(wp.id, { description: e.target.value })}
                              className="flight-plan-input-sm"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {phase === 'CONFIRM' && (
            <div className="flight-plan-confirm">
              <div className="flight-plan-confirm-title">CONFIRM FLIGHT PLAN</div>
              <div className="flight-plan-summary">
                <div className="flight-plan-summary-row">
                  <span className="flight-plan-summary-label">SPEED:</span>
                  <span className="flight-plan-summary-value">{speed} km/h</span>
                </div>
                <div className="flight-plan-summary-row">
                  <span className="flight-plan-summary-label">WAYPOINTS:</span>
                  <span className="flight-plan-summary-value">{waypoints.length}</span>
                </div>
                {waypoints.map((wp, idx) => (
                  <div key={wp.id} className="flight-plan-summary-wp">
                    WP{idx + 1}: {wp.x}, {wp.y} — ALT {wp.altitude}m
                    {wp.hoverTime > 0 ? ` — HOVER ${wp.hoverTime}s` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal__footer">
          {phase === 'PLAN' ? (
            <>
              <button className="btn" onClick={onClose}>CANCEL</button>
              <button
                className="btn btn-primary"
                disabled={waypoints.length === 0}
                onClick={() => setPhase('CONFIRM')}
              >
                REVIEW
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setPhase('PLAN')}>BACK</button>
              <button className="btn btn-primary" onClick={handleSubmit}>EXECUTE FLIGHT PLAN</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
