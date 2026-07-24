import React, { useEffect, useRef } from 'react';
import './RadialMenu.css';

const ACTIONS = {
  INFANTRY: [
    { id: 'MOVE_TO',     label: 'Move To',     icon: '↗', color: '#3b82f6' },
    { id: 'HOLD',        label: 'Hold',        icon: '⏸', color: '#eab308' },
    { id: 'ATTACK',      label: 'Attack',      icon: '⚔', color: '#ef4444' },
    { id: 'FORM_UP',     label: 'Form Up',     icon: '◈', color: '#22c55e' },
    { id: 'DISPERSE',    label: 'Disperse',    icon: '⬡', color: '#a855f7' },
    { id: 'SMOKE_AT',    label: 'Smoke',       icon: '☁', color: '#94a3b8' },
  ],
  VEHICLE: [
    { id: 'MOVE_TO',     label: 'Move To',     icon: '↗', color: '#3b82f6' },
    { id: 'HOLD',        label: 'Hold',        icon: '⏸', color: '#eab308' },
    { id: 'ATTACK',      label: 'Attack',      icon: '⚔', color: '#ef4444' },
    { id: 'WEAPONS_FREE',label: 'Open Fire',   icon: '🔴', color: '#ef4444' },
    { id: 'WEAPONS_SAFE',label: 'Cease Fire',  icon: '⚪', color: '#94a3b8' },
    { id: 'SMOKE_AT',    label: 'Smoke',       icon: '☁', color: '#94a3b8' },
  ],
  ARMORED: [
    { id: 'MOVE_TO',     label: 'Move To',     icon: '↗', color: '#3b82f6' },
    { id: 'HOLD',        label: 'Hold',        icon: '⏸', color: '#eab308' },
    { id: 'ATTACK',      label: 'Attack',      icon: '⚔', color: '#ef4444' },
    { id: 'WEAPONS_FREE',label: 'Open Fire',   icon: '🔴', color: '#ef4444' },
    { id: 'WEAPONS_SAFE',label: 'Cease Fire',  icon: '⚪', color: '#94a3b8' },
    { id: 'SMOKE_AT',    label: 'Smoke',       icon: '☁', color: '#94a3b8' },
  ],
  ARTILLERY: [
    { id: 'ARTILLERY_STRIKE', label: 'Fire Mission',  icon: '🎯', color: '#ef4444', complex: true },
    { id: 'MOVE_TO',          label: 'Move To',       icon: '↗', color: '#3b82f6' },
    { id: 'HOLD',             label: 'Hold',          icon: '⏸', color: '#eab308' },
    { id: 'ADJUST_FIRE',      label: 'Adjust Fire',   icon: '◎', color: '#f97316' },
  ],
  HELICOPTER: [
    { id: 'MOVE_TO',     label: 'Move To',     icon: '↗', color: '#3b82f6' },
    { id: 'LAND_AT',     label: 'Land',        icon: '⬇', color: '#22c55e' },
    { id: 'HOVER',       label: 'Hover',       icon: '◎', color: '#eab308' },
    { id: 'ATTACK',      label: 'Attack',      icon: '⚔', color: '#ef4444' },
    { id: 'SMOKE_AT',    label: 'Smoke',       icon: '☁', color: '#94a3b8' },
  ],
  MULTI: [
    { id: 'MOVE_TO',     label: 'Move To',     icon: '↗', color: '#3b82f6' },
    { id: 'HOLD',        label: 'Hold',        icon: '⏸', color: '#eab308' },
    { id: 'ATTACK',      label: 'Attack',      icon: '⚔', color: '#ef4444' },
  ],
};

function getUnitActions(unit) {
  if (!unit) return ACTIONS.INFANTRY;
  const type = (unit.type || '').toUpperCase();
  const vt = (unit.vehicle_type || '').toUpperCase();
  if (vt === 'HELI' || vt === 'PLANE') return ACTIONS.HELICOPTER;
  if (vt === 'ARTILLERY') return ACTIONS.ARTILLERY;
  if (vt === 'TANK' || vt === 'IFV' || vt.includes('TRACKED')) return ACTIONS.ARMORED;
  if (vt === 'CAR' || vt === 'TRUCK' || vt === 'RECON' || vt.includes('MRAP')) return ACTIONS.VEHICLE;
  if (type === 'VEHICLE') return ACTIONS.VEHICLE;
  return ACTIONS.INFANTRY;
}

export default function RadialMenu({ x, y, unit, multiSelect, onSelect, onClose }) {
  const ref = useRef(null);
  const items = multiSelect ? ACTIONS.MULTI : getUnitActions(unit);
  const radius = 90;

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    window.addEventListener('keydown', handleKey);
    window.addEventListener('mousedown', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="radial-menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="radial-center">
        {multiSelect ? (
          <span className="radial-center-text">MULTI</span>
        ) : unit ? (
          <>
            <span className="radial-center-text">{(unit.callsign || unit.id || '').substring(0, 8)}</span>
            <span className="radial-center-type">{unit.type || 'UNIT'}</span>
          </>
        ) : null}
      </div>
      {items.map((action, i) => {
        const angle = (i / items.length) * Math.PI * 2 - Math.PI / 2;
        const ix = Math.cos(angle) * radius;
        const iy = Math.sin(angle) * radius;
        return (
          <button
            key={action.id}
            className="radial-item"
            style={{
              transform: `translate(${ix}px, ${iy}px)`,
              borderColor: action.color,
              color: action.color,
            }}
            onClick={() => onSelect(action)}
            title={action.label}
          >
            <span className="radial-icon">{action.icon}</span>
            <span className="radial-label">{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
