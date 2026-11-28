import React, { useEffect, useState } from 'react';
import { Button, Divider } from '@blueprintjs/core';

const FORCE = [
  { type: 'RTB_ALL', label: 'All RTB', icon: 'home' },
  { type: 'FORM_UP', label: 'Form up', icon: 'minimize' },
  { type: 'DISPERSE', label: 'Disperse', icon: 'fullscreen' },
  null,
  { type: 'WEAPONS_SAFE', label: 'Weapons safe', icon: 'shield' },
  { type: 'WEAPONS_FREE', label: 'Weapons free', icon: 'locate', confirm: true },
];

// Orders for the whole force, plus a second row while several units are selected.
export default function CommandBar({ selectedUnits, onForceOrder, onHoldSelected, onMoveSelected, onAttackSelected, onClearSelection }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const press = (order) => {
    if (order.confirm && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onForceOrder(order.type, order.label);
  };

  return (
    <div className="command-dock">
      {selectedUnits.length > 1 && (
        <div className="command-bar command-bar--selection">
          <strong>{selectedUnits.length} selected</strong>
          <Button minimal icon="pause" text="Hold" onClick={onHoldSelected} />
          <Button minimal icon="arrow-right" text="Move" onClick={onMoveSelected} />
          <Button minimal icon="locate" text="Attack" onClick={onAttackSelected} />
          <Button minimal icon="cross" aria-label="Clear selection" onClick={onClearSelection} />
        </div>
      )}
      <div className="command-bar" role="toolbar" aria-label="Orders for all units">
        {/* The one control that must never be hunted for. */}
        <Button className="all-hold" intent="danger" icon="stop" text="All hold" onClick={() => press({ type: 'HOLD_ALL', label: 'All hold' })} />
        <Divider />
        {FORCE.map((order, i) => (order ? (
          <Button
            key={order.type}
            minimal={!(order.confirm && armed)}
            intent={order.confirm && armed ? 'warning' : 'none'}
            icon={order.icon}
            text={order.confirm && armed ? 'Confirm weapons free' : order.label}
            onClick={() => press(order)}
          />
        ) : <Divider key={`sep-${i}`} />))}
      </div>
    </div>
  );
}
