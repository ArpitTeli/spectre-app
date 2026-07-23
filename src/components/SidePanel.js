import React, { useState } from 'react';
import VaultGraph from './VaultGraph';

export default function SidePanel({ state, patch, addCommsEntry, sendArmaCommand, addIntel, endMission }) {
  const [activeTab, setActiveTab] = useState('UNITS');

  return (
    <div className="side-panel">
      <ForceMetrics
        forceMetrics={state.forceMetrics}
        missionPhase={state.missionPhase}
        rewardData={state.rewardData}
        patch={patch}
        addCommsEntry={addCommsEntry}
        sendArmaCommand={sendArmaCommand}
        endMission={endMission}
      />
      <div className="side-panel__tabs">
        {['UNITS','CONTACTS','INTEL','ORDERS','GRAPH'].map(t => (
          <button key={t} className={`side-panel__tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>
      <div className="side-panel__content">
        {activeTab === 'UNITS'    && <UnitsTab    units={state.units}    selectedUnit={state.selectedUnit} patch={patch} sendArmaCommand={sendArmaCommand} addCommsEntry={addCommsEntry} />}
        {activeTab === 'CONTACTS' && <ContactsTab contacts={state.contacts} selectedContact={state.selectedContact} patch={patch} />}
        {activeTab === 'INTEL'    && <IntelTab    intelDB={state.intelDB} addIntel={addIntel} />}
        {activeTab === 'ORDERS'   && <OrdersTab   state={state} sendArmaCommand={sendArmaCommand} addCommsEntry={addCommsEntry} />}
        {activeTab === 'GRAPH'    && <VaultGraph  vaultPath={state.vaultPath} units={state.units} contacts={state.contacts} />}
      </div>
    </div>
  );
}

function ForceMetrics({ forceMetrics, missionPhase, rewardData, patch, addCommsEntry, sendArmaCommand, endMission }) {
  const fpColor = forceMetrics.firepower_index < 50 ? 'danger' : forceMetrics.firepower_index < 70 ? 'warning' : '';
  return (
    <div className="force-metrics">
      <div className="force-metrics__title">Force</div>
      <div className="force-metrics__grid">
        <div className="metric-box">
          <div className={`metric-box__value ${fpColor}`}>{forceMetrics.firepower_index}%</div>
          <div className="metric-box__label">FP</div>
        </div>
        <div className="metric-box">
          <div className="metric-box__value" style={{ color: 'var(--text-primary)' }}>{forceMetrics.vehicles_active}<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>/{forceMetrics.vehicles_total}</span></div>
          <div className="metric-box__label">VEH</div>
        </div>
        <div className="metric-box">
          <div className={`metric-box__value ${forceMetrics.mobility === 'LOW' ? 'danger' : ''}`}>{forceMetrics.mobility}</div>
          <div className="metric-box__label">MOB</div>
        </div>
        <div className="metric-box">
          <div className={`metric-box__value ${rewardData?.score < 0 ? 'danger' : ''}`}>{(rewardData?.score || 0).toFixed(0)}</div>
          <div className="metric-box__label">SCORE</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
        {missionPhase === 'BRIEFING' && (
          <>
            <button className="btn btn-sm flex-1" onClick={() => patch({ missionPhase: 'PLANNING' })}>PLAN</button>
            <button className="btn btn-sm btn-primary flex-1" onClick={() => { patch({ missionPhase: 'ACTIVE', missionStartTime: Date.now() }); addCommsEntry('SPECTRE', 'ALL', 'Mission GO. Execute.', 'GREEN'); }}>EXEC</button>
          </>
        )}
        {missionPhase === 'PLANNING' && (
          <button className="btn btn-sm flex-1 btn-primary" onClick={() => addCommsEntry('SPECTRE', 'ALL', 'Planning phase.', 'BLUE')}>PLAN</button>
        )}
        {missionPhase === 'ACTIVE' && (
          <>
            <button className="btn btn-sm flex-1" onClick={() => patch({ showCOAPanel: true })}>COA</button>
            <button className="btn btn-sm btn-primary flex-1" onClick={() => endMission(true)}>OBJ</button>
            <button className="btn btn-sm btn-danger" onClick={() => endMission(false)}>END</button>
          </>
        )}
        <button className="btn btn-sm" onClick={() => patch({ showSettings: true })} style={{ fontSize: 10, padding: '3px 8px' }}>⚙</button>
      </div>
    </div>
  );
}

function UnitsTab({ units, selectedUnit, patch, sendArmaCommand, addCommsEntry }) {
  const list = Object.values(units).sort((a, b) => {
    const order = { TANK: 0, IFV: 1, APC: 2, HELI: 3, CAR: 4, TRUCK: 5, RECON: 6, INFANTRY: 10, VEHICLE: 7 };
    const oa = order[a.vehicle_type] ?? 8;
    const ob = order[b.vehicle_type] ?? 8;
    if (oa !== ob) return oa - ob;
    return (a.callsign || '').localeCompare(b.callsign || '');
  });
  if (list.length === 0) return <div className="empty-state">No units detected.<br />Awaiting Arma link.</div>;

  const vehicles = list.filter(u => !u.vehicle);
  const embedded = list.filter(u => u.vehicle);

  return (
    <div className="unit-list">
      {vehicles.map(u => (
        <UnitCard
          key={u.id}
          unit={u}
          crew={embedded.filter(e => e.vehicle === u.id)}
          selected={u.id === selectedUnit}
          onSelect={() => patch({ selectedUnit: u.id })}
          sendArmaCommand={sendArmaCommand}
          addCommsEntry={addCommsEntry}
        />
      ))}
    </div>
  );
}

const TYPE_LABELS = {
  INFANTRY: 'Infantry', CAR: 'Car', RECON: 'Recon', TRUCK: 'Truck',
  APC: 'APC', IFV: 'IFV', TANK: 'Tank', HELI: 'Helicopter',
  PLANE: 'Fixed-Wing', BOAT: 'Boat', VEHICLE: 'Vehicle',
};

function UnitCard({ unit, crew = [], selected, onSelect, sendArmaCommand, addCommsEntry }) {
  const [showOrder, setShowOrder] = useState(false);
  const [orderText, setOrderText] = useState('');
  const dead = unit.status === 'DESTROYED' || unit.status === 'DEAD';
  const isVehicle = unit.type === 'VEHICLE';
  const isInfantry = unit.type === 'INFANTRY';

  const send = async (type, params = {}) => {
    await sendArmaCommand({ type, unit_id: unit.id, ...params });
    addCommsEntry('SPECTRE', unit.callsign, `${type}${params.instruction ? ': ' + params.instruction : ''}`, 'BLUE');
  };

  return (
    <div className={`unit-card ${selected ? 'selected' : ''} ${dead ? 'destroyed' : ''}`} onClick={onSelect}>
      <div className="unit-card__header">
        <span className="unit-card__callsign">{unit.callsign}</span>
        <span className="unit-card__type">{TYPE_LABELS[unit.vehicle_type] || unit.vehicle_type}</span>
      </div>
      <div className="unit-card__bars">
        <Bar label="HP" value={unit.health ?? 100} type="health" />
        {isVehicle && <Bar label="FUEL" value={unit.fuel ?? 100} type="fuel" />}
        {isVehicle && unit.speed > 0 && <div className="unit-card__stat"><span style={{fontSize:9,color:'var(--text-muted)'}}>SPD</span><span style={{fontSize:9,color:'var(--text-primary)'}}>{unit.speed} km/h</span></div>}
      </div>
      {unit.current_order && <div className="unit-card__status">▶ {unit.current_order}</div>}
      {isInfantry && unit.vehicle && (
        <div className="unit-card__status" style={{fontSize:9,color:'var(--text-muted)'}}>Inside: {unit.vehicle} ({unit.vehicle_role || 'CARGO'})</div>
      )}
      {isVehicle && crew.length > 0 && (
        <div className="unit-card__crew">
          <span className="unit-card__crew-label">CREW ({crew.length})</span>
          {crew.map(c => (
            <span key={c.id} className="unit-card__crew-member">{c.callsign}</span>
          ))}
        </div>
      )}
      {selected && !dead && (
        <div style={{ marginTop: '6px', display: 'flex', gap: '3px', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
          <button className="btn btn-sm" onClick={() => send('HOLD')}>HOLD</button>
          <button className="btn btn-sm" onClick={() => send('RTB')}>RTB</button>
          <button className="btn btn-sm" onClick={() => { setShowOrder(v => !v); setOrderText(''); }}>ORDER</button>
        </div>
      )}
      {showOrder && (
        <div style={{ marginTop: '4px' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: '3px' }}>
            <input className="settings-field input" style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-hairline)', borderRadius: '2px', padding: '3px 6px', color: 'var(--text-primary)', outline: 'none' }}
              placeholder="order..." value={orderText} onChange={e => setOrderText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && orderText.trim()) { send('CUSTOM', { instruction: orderText }); setOrderText(''); setShowOrder(false); } }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ label, value, type }) {
  const pct = Math.max(0, Math.min(100, value ?? 100));
  const cls = type === 'health' ? (pct < 30 ? 'critical' : pct < 60 ? 'low' : '') : '';
  return (
    <div className="unit-bar">
      <span className="unit-bar__label">{label}</span>
      <div className="unit-bar__track">
        <div className={`unit-bar__fill ${type} ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span style={{ fontSize: '9px', color: 'var(--text-muted)', minWidth: '24px' }}>{pct}%</span>
    </div>
  );
}

function ContactsTab({ contacts, selectedContact, patch }) {
  const list = Object.values(contacts).sort((a, b) => {
    const o = { CONFIRMED: 0, LAST_KNOWN: 1, SUSPECTED: 2 };
    return (o[a.state] || 2) - (o[b.state] || 2);
  });
  if (list.length === 0) return <div className="empty-state">No contacts.</div>;
  return (
    <div className="contact-list">
      {list.map(c => (
        <div key={c.id} className={`contact-card ${c.id === selectedContact ? 'selected' : ''}`} data-confidence={c.state} onClick={() => patch({ selectedContact: c.id })}>
          <div className="contact-card__header">
            <span className="contact-card__type">{c.type || c.id}</span>
            <span className={`contact-card__confidence ${(c.state || '').toLowerCase()}`}>{c.state}</span>
          </div>
          <div className="contact-card__position">{c.position ? `(${Math.round(c.position.x)}, ${Math.round(c.position.y)})` : '? pos'} · {c.source}</div>
        </div>
      ))}
    </div>
  );
}

function IntelTab({ intelDB, addIntel }) {
  const [input, setInput] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = () => {
    if (!input.trim()) return;
    const lower = input.toLowerCase();
    const threat = lower.includes('stronghold') || lower.includes('heavily') || lower.includes('tank') ? 'HIGH'
      : lower.includes('patrol') || lower.includes('infantry') ? 'MEDIUM' : 'LOW';
    const words = input.split(' ');
    const name = words.find(w => w.length > 3 && /^[A-Z]/.test(w) && !/^(The|An|A|Is|Enemy|Friendly|There)$/.test(w)) || 'Unknown';
    addIntel('location', {
      name, raw_intel: input, confidence: 'PLAYER_REPORTED', threat_level: threat,
      timestamp: new Date().toISOString(),
      observations: [{ text: input, timestamp: new Date().toISOString(), source: 'COMMANDER' }]
    });
    setInput('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="intel-list">
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <div className="panel-section__title" style={{ marginBottom: '6px' }}>Report Intel</div>
        <textarea className="sidebar-input" rows={2}
          placeholder={'e.g. "Firna is enemy stronghold with IFVs"' }
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) submit(); }}
          style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-hairline)', borderRadius: '2px', padding: '4px 8px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '10px', outline: 'none', resize: 'vertical' }}
        />
        <button className={`btn btn-sm ${saved ? 'btn-primary' : ''}`} style={{ marginTop: '4px', width: '100%' }} onClick={submit}>
          {saved ? 'LOGGED' : 'LOG INTEL'}
        </button>
      </div>
      <div className="panel-section__title" style={{ marginBottom: '6px' }}>Database · {(intelDB?.locations || []).length} loc {(intelDB?.patterns || []).length} pat</div>
      {(intelDB?.locations || []).map((loc, i) => (
        <div key={i} className="intel-item">
          <div className="intel-item__header">
            <span className="intel-item__type">{loc.name}</span>
            <span className="intel-item__time">{loc.threat_level || 'MED'}</span>
          </div>
          <div className="intel-item__content">{(loc.observations || []).length} obs · {loc.confidence}</div>
          {loc.raw_intel && <div style={{ color: 'var(--text-muted)', marginTop: '4px', fontSize: '9px', fontStyle: 'italic' }}>"{loc.raw_intel}"</div>}
        </div>
      ))}
    </div>
  );
}

function OrdersTab({ state, sendArmaCommand, addCommsEntry }) {
  const [massOrder, setMassOrder] = useState('');

  const sendMass = async () => {
    if (!massOrder.trim()) return;
    for (const id of Object.keys(state.units)) {
      await sendArmaCommand({ type: 'CUSTOM', unit_id: id, instruction: massOrder });
    }
    addCommsEntry('SPECTRE', 'ALL', massOrder, 'BLUE');
    setMassOrder('');
  };

  const CMDS = [
    { label: 'ALL HOLD',     type: 'HOLD_ALL' },
    { label: 'ALL RTB',      type: 'RTB_ALL' },
    { label: 'WEAPONS FREE', type: 'WEAPONS_FREE' },
    { label: 'WEAPONS SAFE', type: 'WEAPONS_SAFE' },
    { label: 'FORM UP',      type: 'FORM_UP' },
    { label: 'DISPERSE',     type: 'DISPERSE' }
  ];

  return (
    <div className="orders-section">
      <div className="orders-section__title">All Units</div>
      <div style={{ display: 'flex', gap: '4px' }}>
        <input className="sidebar-input" style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-hairline)', borderRadius: '2px', padding: '4px 8px', color: 'var(--text-primary)', outline: 'none' }}
          placeholder="Custom order..." value={massOrder} onChange={e => setMassOrder(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMass()} />
        <button className="btn btn-sm btn-primary" onClick={sendMass}>SEND</button>
      </div>
      <div className="orders-actions">
        {CMDS.map(cmd => (
          <button key={cmd.type} className={`order-btn ${cmd.type === 'WEAPONS_FREE' ? 'danger' : cmd.type === 'WEAPONS_SAFE' ? 'primary' : ''}`}
            onClick={async () => { await sendArmaCommand({ type: cmd.type }); addCommsEntry('SPECTRE', 'ALL', cmd.label, 'BLUE'); }}>
            {cmd.label}
          </button>
        ))}
      </div>
    </div>
  );
}
