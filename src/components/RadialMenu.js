import React, { useEffect, useRef } from 'react';
import Icon from './Icon';
import './RadialMenu.css';

const ACTIONS = {
  INFANTRY: [
    { id: 'MOVE_TO', label: 'Move To', icon: 'move' },
    { id: 'HOLD', label: 'Hold', icon: 'hold' },
    { id: 'ATTACK', label: 'Attack', icon: 'attack', hot: true },
    { id: 'FORM_UP', label: 'Form Up', icon: 'formUp' },
    { id: 'DISPERSE', label: 'Disperse', icon: 'disperse' },
    { id: 'SMOKE_AT', label: 'Smoke', icon: 'smoke' },
  ],
  VEHICLE: [
    { id: 'MOVE_TO', label: 'Move To', icon: 'move' },
    { id: 'HOLD', label: 'Hold', icon: 'hold' },
    { id: 'ATTACK', label: 'Attack', icon: 'attack', hot: true },
    { id: 'WEAPONS_FREE', label: 'All: free', icon: 'attack', hot: true },
    { id: 'WEAPONS_SAFE', label: 'All: safe', icon: 'shield' },
    { id: 'SMOKE_AT', label: 'Smoke', icon: 'smoke' },
  ],
  ARMORED: [
    { id: 'MOVE_TO', label: 'Move To', icon: 'move' },
    { id: 'HOLD', label: 'Hold', icon: 'hold' },
    { id: 'ATTACK', label: 'Attack', icon: 'attack', hot: true },
    { id: 'WEAPONS_FREE', label: 'All: free', icon: 'attack', hot: true },
    { id: 'WEAPONS_SAFE', label: 'All: safe', icon: 'shield' },
    { id: 'SMOKE_AT', label: 'Smoke', icon: 'smoke' },
  ],
  ARTILLERY: [
    { id: 'ARTILLERY_STRIKE', label: 'Fire Mission', icon: 'alert', hot: true, complex: true },
    { id: 'MOVE_TO', label: 'Move To', icon: 'move' },
    { id: 'HOLD', label: 'Hold', icon: 'hold' },
    { id: 'ADJUST_FIRE', label: 'Adjust Fire', icon: 'fit' },
  ],
  HELICOPTER: [
    { id: 'MOVE_TO', label: 'Move To', icon: 'move' },
    { id: 'LAND_AT', label: 'Land', icon: 'land' },
    { id: 'HOVER', label: 'Flight Plan', icon: 'arrow', complex: true },
    { id: 'ATTACK', label: 'Attack', icon: 'attack', hot: true },
    { id: 'SMOKE_AT', label: 'Smoke', icon: 'smoke' },
  ],
  MULTI: [
    { id: 'MOVE_TO', label: 'Move To', icon: 'move' },
    { id: 'HOLD', label: 'Hold', icon: 'hold' },
    { id: 'ATTACK', label: 'Attack', icon: 'attack', hot: true },
  ],
  FPV: [
    { id: 'KAMIKAZE', label: 'Kamikaze', icon: 'alert', hot: true },
    { id: 'MOVE_TO', label: 'Move To', icon: 'move' },
    { id: 'HOLD', label: 'Hold', icon: 'hold' },
  ],
  STOMPER: [
    { id: 'MOVE_TO', label: 'Move To', icon: 'move' },
    { id: 'HOLD', label: 'Hold', icon: 'hold' },
    { id: 'ATTACK', label: 'Attack', icon: 'attack', hot: true },
    { id: 'WEAPONS_FREE', label: 'All: free', icon: 'attack', hot: true },
    { id: 'WEAPONS_SAFE', label: 'All: safe', icon: 'shield' },
  ],
  ED1: [
    { id: 'MOVE_TO', label: 'Move To', icon: 'move' },
    { id: 'HOLD', label: 'Hold', icon: 'hold' },
  ],
  UAV: [
    { id: 'MOVE_TO', label: 'Move To', icon: 'move' },
    { id: 'HOLD', label: 'Hold', icon: 'hold' },
  ],
};

function getUnitActions(unit) {
  if (!unit) return ACTIONS.INFANTRY;
  const type = (unit.type || '').toUpperCase();
  const vt = (unit.vehicle_type || '').toUpperCase();
  if (vt === 'FPV') return ACTIONS.FPV;
  if (vt === 'UAV') return ACTIONS.UAV;
  if (vt === 'STOMPER') return ACTIONS.STOMPER;
  if (vt === 'ED1') return ACTIONS.ED1;
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
  const radius = 96;

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
            <span className="radial-center-text">{unit.callsign || unit.id}</span>
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
            className={`radial-item${action.hot ? ' radial-item--hot' : ''}`}
            style={{ transform: `translate(${ix}px, ${iy}px)` }}
            onClick={() => onSelect(action)}
            title={action.label}
          >
            <Icon name={action.icon} size={19} />
            <span className="radial-label">{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
