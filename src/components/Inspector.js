import React, { useEffect, useRef, useState } from 'react';
import { Button, ButtonGroup, InputGroup } from '@blueprintjs/core';
import Symbol from './Symbol';
import Segments from './Segments';
import HeadingDial from './HeadingDial';
import useElevation from './useElevation';
import FireMissionPanel from './FireMissionPanel';
import FlightPlanPanel from './FlightPlanPanel';
import { TYPE_LABELS, gridRef, isDown } from './unitFormat';

// The right-hand detail panel. It only exists while something is selected.
export default function Inspector({
  mapName, state, patch, sendArmaCommand, addCommsEntry, fireMissionUnit, setFireMissionUnit,
  flightPlanUnit, setFlightPlanUnit, panelClickHandlerRef, activeTab, setActiveTab, onTarget, onOpenChange,
}) {
  const unit = state.selectedUnit ? state.units[state.selectedUnit] : null;
  const contact = state.selectedContact ? state.contacts[state.selectedContact] : null;

  // Show whichever of unit or contact was picked most recently.
  const [focus, setFocus] = useState('unit');
  useEffect(() => { if (state.selectedUnit) setFocus('unit'); }, [state.selectedUnit]);
  useEffect(() => { if (state.selectedContact) setFocus('contact'); }, [state.selectedContact]);

  const planning = activeTab === 'ARTILLERY' && fireMissionUnit ? 'artillery'
    : activeTab === 'FLIGHT' && flightPlanUnit ? 'flight' : null;
  useEffect(() => { panelClickHandlerRef.current = null; }, [planning, panelClickHandlerRef]);

  const showContact = !!contact && (focus === 'contact' || !unit);
  const open = !!(planning || unit || contact);
  const openRef = useRef(onOpenChange);
  openRef.current = onOpenChange;
  useEffect(() => { openRef.current?.(open); }, [open]);
  if (!open) return null;

  const closePlan = () => {
    setFireMissionUnit(null);
    setFlightPlanUnit(null);
    setActiveTab('STATUS');
  };

  if (planning) {
    const subject = planning === 'artillery' ? fireMissionUnit : flightPlanUnit;
    const Panel = planning === 'artillery' ? FireMissionPanel : FlightPlanPanel;
    return (
      <aside className="inspector">
        <div className="inspector__body">
          <Panel
            unit={subject}
            onClose={closePlan}
            onSubmit={(cmd) => {
              sendArmaCommand(cmd);
              addCommsEntry('SPECTRE', subject?.callsign || subject?.id,
                planning === 'artillery'
                  ? `ARTILLERY STRIKE ${cmd.x},${cmd.y} (${cmd.rounds}x ${cmd.ammoType})`
                  : `FLIGHT PLAN (${cmd.waypoints.length} WPs)`,
                'BLUE');
              closePlan();
            }}
            onMapClick={(handler) => { panelClickHandlerRef.current = handler; }}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      {showContact
        ? <ContactDetail contact={contact} onClose={() => patch({ selectedContact: null })} />
        : (
          <UnitDetail
            mapName={mapName}
            unit={unit}
            state={state}
            sendArmaCommand={sendArmaCommand}
            addCommsEntry={addCommsEntry}
            onTarget={onTarget}
            onClose={() => patch({ selectedUnit: null })}
          />
        )}
    </aside>
  );
}

function Header({ item, side, title, subtitle, onClose }) {
  return (
    <header className="inspector__head">
      <Symbol item={item} side={side} size={20} />
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <Button minimal small icon="cross" onClick={onClose} aria-label="Close details" />
    </header>
  );
}

function Rows({ rows }) {
  return (
    <dl className="rows">
      {rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v, className]) => (
        <div key={k}><dt>{k}</dt><dd className={className || ''}>{v}</dd></div>
      ))}
    </dl>
  );
}

function UnitDetail({ mapName, unit, state, sendArmaCommand, addCommsEntry, onTarget, onClose }) {
  const [order, setOrder] = useState('');
  useEffect(() => { setOrder(''); }, [unit.id]);
  const down = isDown(unit);
  const mounted = !!unit.vehicle;
  const crew = Object.values(state.units || {}).filter((u) => u.vehicle === unit.id);
  const health = Math.round(unit.health ?? 100);
  const fuel = Math.round(unit.fuel ?? 100);
  const elevation = useElevation(mapName, unit.position);

  const send = async (type, params = {}) => {
    await sendArmaCommand({ type, unit_id: unit.id, ...params });
    addCommsEntry('SPECTRE', unit.callsign, `${type}${params.instruction ? `: ${params.instruction}` : ''}`, 'BLUE');
  };

  return (
    <>
      <Header
        item={unit}
        side="friend"
        title={unit.callsign || unit.id}
        subtitle={TYPE_LABELS[unit.vehicle_type] || unit.vehicle_type || 'Unit'}
        onClose={onClose}
      />
      <div className="inspector__body">
        {!down && (
          <section className="inspector__orders">
            <ButtonGroup fill>
              <Button icon="arrow-right" text="Move" onClick={() => onTarget('MOVE_TO', unit.id, 'MOVE TO')} />
              <Button icon="locate" text="Attack" onClick={() => onTarget('ATTACK', unit.id, 'ATTACK')} />
              <Button icon="home" text="RTB" onClick={() => send('RTB')} />
              <Button icon="pause" text="Hold" intent="danger" outlined onClick={() => send('HOLD')} />
            </ButtonGroup>
            <InputGroup
              small
              placeholder="Custom order, then Enter"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && order.trim()) {
                  send('CUSTOM', { instruction: order });
                  setOrder('');
                }
              }}
            />
          </section>
        )}

        <div className="instrument">
          <HeadingDial heading={unit.heading ?? 0} speed={unit.speed ?? 0} />
          <dl>
            <div><dt>Heading</dt><dd>{String(Math.round(unit.heading ?? 0)).padStart(3, '0')}°</dd></div>
            <div><dt>Grid</dt><dd>{gridRef(unit.position)}</dd></div>
            <div><dt>Elevation</dt><dd>{elevation === null ? '—' : `${elevation} m`}</dd></div>
          </dl>
        </div>

        <div className="gauges">
          <Segments wide label="Health" value={health} />
          {!mounted && <Segments wide label="Fuel" value={fuel} />}
        </div>

        <Rows
          rows={[
            ['Task', (unit.current_order || 'None').toLowerCase(), 'cap'],
            ['Status', (unit.status || 'unknown').toLowerCase(), `cap ${down ? 'tone-bad' : ''}`],
          ]}
        />

        {(crew.length > 0 || mounted) && (
          <>
            <h3>{mounted ? 'Mounted in' : `Crew (${crew.length})`}</h3>
            <Rows
              rows={mounted
                ? [[unit.vehicle, unit.vehicle_role || 'cargo', 'cap']]
                : crew.map((c) => [c.callsign || c.id, (c.vehicle_role || 'cargo').toLowerCase(), 'cap'])}
            />
          </>
        )}
      </div>
    </>
  );
}

function ContactDetail({ contact, onClose }) {
  const seen = contact.last_seen ? Math.max(0, Math.round((Date.now() - contact.last_seen) / 1000)) : null;
  const stateName = String(contact.state || 'unknown').replace('_', ' ').toLowerCase();
  return (
    <>
      <Header item={contact} side="hostile" title={contact.id} subtitle={`${(contact.type || 'unknown').toLowerCase()} contact`} onClose={onClose} />
      <div className="inspector__body">
        <Rows
          rows={[
            ['State', stateName, `cap ${contact.state === 'CONFIRMED' ? 'tone-bad' : 'tone-warn'}`],
            ['Grid', gridRef(contact.position), 'num'],
            ['Source', (contact.source || '').toLowerCase(), 'cap'],
            ['Confidence', (contact.confidence || '').toLowerCase(), 'cap'],
            ['Last seen', seen === null ? null : seen < 60 ? `${seen} s ago` : `${Math.round(seen / 60)} min ago`, 'num'],
          ]}
        />
      </div>
    </>
  );
}
