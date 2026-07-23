import React, { useState, useMemo } from 'react';
import VaultGraph from './VaultGraph';

const TYPE_LABELS = {
  INFANTRY: 'Infantry', CAR: 'Car', RECON: 'Recon', TRUCK: 'Truck',
  APC: 'APC', IFV: 'IFV', TANK: 'Tank', HELI: 'Helicopter',
  PLANE: 'Fixed-Wing', BOAT: 'Boat', VEHICLE: 'Vehicle',
};

const VEHICLE_SYMBOL = { TANK: '▲', IFV: '▲', APC: '◆', CAR: '●', RECON: '◇', HELI: '✦', TRUCK: '▪', BOAT: '◆', PLANE: '✦', INFANTRY: '●', DEFAULT: '○' };

function getDistance(unit) {
  if (!unit.position) return null;
  const x = unit.position.x || 0;
  const y = unit.position.y || 0;
  const dist = Math.sqrt(x * x + y * y);
  if (dist < 1000) return `${Math.round(dist)}m`;
  return `${(dist / 1000).toFixed(1)}km`;
}

export default function SidePanel({ state, patch, addCommsEntry, sendArmaCommand, addIntel, endMission, visibleUnits }) {
  const [activeTab, setActiveTab] = useState('UNITS');
  const [searchQuery, setSearchQuery] = useState('');

  const units = Object.values(visibleUnits ? visibleUnits() : state.units);
  const contacts = Object.values(state.contacts || {});

  const filteredUnits = useMemo(() => {
    if (!searchQuery.trim()) return units;
    const q = searchQuery.toLowerCase();
    return units.filter(u =>
      (u.callsign || '').toLowerCase().includes(q) ||
      (u.vehicle_type || '').toLowerCase().includes(q) ||
      (u.id || '').toLowerCase().includes(q)
    );
  }, [units, searchQuery]);

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(c =>
      (c.id || '').toLowerCase().includes(q) ||
      (c.type || '').toLowerCase().includes(q)
    );
  }, [contacts, searchQuery]);

  return (
    <div className="tracks-panel">
      <div className="tracks-panel__tabs">
        {['UNITS', 'CONTACTS', 'INTEL', 'ORDERS', 'GRAPH'].map(t => (
          <button
            key={t}
            className={`tracks-panel__tab ${activeTab === t ? 'active' : ''}`}
            onClick={() => setActiveTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="tracks-panel__search">
        <span className="tracks-panel__search-icon">⌕</span>
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="tracks-panel__search-input"
        />
      </div>

      <div className="tracks-panel__content">
        {activeTab === 'UNITS' && (
          <UnitsTab
            units={filteredUnits}
            selectedUnit={state.selectedUnit}
            patch={patch}
            sendArmaCommand={sendArmaCommand}
            addCommsEntry={addCommsEntry}
          />
        )}
        {activeTab === 'CONTACTS' && (
          <ContactsTab
            contacts={filteredContacts}
            selectedContact={state.selectedContact}
            patch={patch}
          />
        )}
        {activeTab === 'INTEL' && (
          <IntelTab intelDB={state.intelDB} addIntel={addIntel} />
        )}
        {activeTab === 'ORDERS' && (
          <OrdersTab
            state={state}
            sendArmaCommand={sendArmaCommand}
            addCommsEntry={addCommsEntry}
          />
        )}
        {activeTab === 'GRAPH' && (
          <div style={{ height: '100%' }}>
            <VaultGraph
              vaultPath={state.vaultPath}
              units={state.units}
              contacts={state.contacts}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function UnitsTab({ units, selectedUnit, patch, sendArmaCommand, addCommsEntry }) {
  const list = useMemo(() => {
    return [...units].sort((a, b) => {
      const order = { TANK: 0, IFV: 1, APC: 2, HELI: 3, CAR: 4, TRUCK: 5, RECON: 6, INFANTRY: 10, VEHICLE: 7 };
      const oa = order[a.vehicle_type] ?? 8;
      const ob = order[b.vehicle_type] ?? 8;
      if (oa !== ob) return oa - ob;
      return (a.callsign || '').localeCompare(b.callsign || '');
    });
  }, [units]);

  if (list.length === 0) return <div className="empty-state">No units detected.<br />Awaiting Arma link.</div>;

  const vehicles = list.filter(u => !u.vehicle);
  const embedded = list.filter(u => u.vehicle);

  return (
    <div className="tracks-list">
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

function UnitCard({ unit, crew = [], selected, onSelect, sendArmaCommand, addCommsEntry }) {
  const [showOrder, setShowOrder] = useState(false);
  const [orderText, setOrderText] = useState('');
  const dead = unit.status === 'DESTROYED' || unit.status === 'DEAD';
  const hp = unit.health ?? 100;
  const distance = getDistance(unit);
  const symbol = VEHICLE_SYMBOL[unit.vehicle_type] || VEHICLE_SYMBOL.DEFAULT;
  const label = TYPE_LABELS[unit.vehicle_type] || unit.vehicle_type || '';

  const send = async (type, params = {}) => {
    await sendArmaCommand({ type, unit_id: unit.id, ...params });
    addCommsEntry('SPECTRE', unit.callsign, `${type}${params.instruction ? ': ' + params.instruction : ''}`, 'BLUE');
  };

  return (
    <div className={`track-card ${selected ? 'selected' : ''} ${dead ? 'destroyed' : ''}`} onClick={onSelect}>
      <div className="track-card__row">
        <div className="track-card__icon" style={{ color: selected ? 'var(--accent)' : 'var(--text-muted)' }}>
          {symbol}
        </div>
        <div className="track-card__info">
          <div className="track-card__name">
            <span className="track-card__callsign">{unit.callsign || unit.id}</span>
            <span className="track-card__type">{label}</span>
          </div>
          <div className="track-card__bars">
            <div className="unit-bar">
              <span className="unit-bar__label">HP</span>
              <div className="unit-bar__track">
                <div className={`unit-bar__fill health ${hp < 30 ? 'critical' : hp < 60 ? 'low' : ''}`} style={{ width: `${hp}%` }} />
              </div>
              <span style={{ fontSize: '8px', color: 'var(--text-muted)', minWidth: '24px' }}>{hp}%</span>
            </div>
          </div>
          <div className="track-card__meta">
            {distance && <span className="track-card__distance">{distance}</span>}
            {unit.current_order && <span className="track-card__task-value">▸ {unit.current_order}</span>}
          </div>
        </div>
      </div>

      {selected && !dead && (
        <div className="track-card__quick-actions" onClick={e => e.stopPropagation()}>
          <button className="track-card__action-btn" onClick={() => send('HOLD')}>HOLD</button>
          <button className="track-card__action-btn" onClick={() => send('RTB')}>RTB</button>
          <button className="track-card__action-btn" onClick={() => { setShowOrder(v => !v); setOrderText(''); }}>ORDER</button>
        </div>
      )}

      {showOrder && selected && (
        <div style={{ marginTop: '4px', padding: '0 12px 8px' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: '3px' }}>
            <input
              className="sidebar-input"
              style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '9px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '3px 6px', color: 'var(--text-primary)', outline: 'none' }}
              placeholder="order..."
              value={orderText}
              onChange={e => setOrderText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && orderText.trim()) {
                  send('CUSTOM', { instruction: orderText });
                  setOrderText('');
                  setShowOrder(false);
                }
              }}
            />
          </div>
        </div>
      )}

      {selected && !dead && crew.length > 0 && (
        <div className="track-card__meta" style={{ padding: '4px 12px 6px' }}>
          <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>CREW: {crew.map(c => c.callsign || c.id).join(', ')}</span>
        </div>
      )}
    </div>
  );
}

function ContactsTab({ contacts, selectedContact, patch }) {
  const list = useMemo(() => {
    return [...contacts].sort((a, b) => {
      const o = { CONFIRMED: 0, LAST_KNOWN: 1, SUSPECTED: 2 };
      return (o[a.state] || 2) - (o[b.state] || 2);
    });
  }, [contacts]);

  if (list.length === 0) return <div className="empty-state">No contacts.</div>;

  return (
    <div className="tracks-list">
      {list.map(c => (
        <div
          key={c.id}
          className={`track-card ${c.id === selectedContact ? 'selected' : ''}`}
          onClick={() => patch({ selectedContact: c.id })}
        >
          <div className="track-card__row">
            <div className="track-card__icon" style={{
              color: c.state === 'CONFIRMED' ? 'var(--red)' : c.state === 'LAST_KNOWN' ? 'var(--orange)' : 'var(--yellow)'
            }}>
              {VEHICLE_SYMBOL[c.type] || '○'}
            </div>
            <div className="track-card__info">
              <div className="track-card__name">
                <span className="track-card__callsign">{c.id}</span>
                <span className="track-card__type" style={{
                  color: c.state === 'CONFIRMED' ? 'var(--red)' : c.state === 'LAST_KNOWN' ? 'var(--orange)' : 'var(--yellow)'
                }}>{c.state}</span>
              </div>
              <div className="track-card__meta">
                <span className="track-card__distance">{c.type || 'Unknown'}</span>
                <span className="track-card__separator">·</span>
                <span className="track-card__distance">{c.source || 'VISUAL'}</span>
              </div>
            </div>
          </div>
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

  const locs = intelDB?.locations || [];

  return (
    <div className="tracks-list">
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-hairline)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Report Intel</div>
        <textarea
          className="sidebar-input"
          rows={2}
          placeholder='e.g. "Firna is enemy stronghold with IFVs"'
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) submit(); }}
          style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '4px 8px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '9px', outline: 'none', resize: 'vertical' }}
        />
        <button className={`btn btn-sm ${saved ? 'btn-primary' : ''}`} style={{ marginTop: '4px', width: '100%' }} onClick={submit}>
          {saved ? 'LOGGED' : 'LOG INTEL'}
        </button>
      </div>
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-hairline)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Database · {locs.length} locations</span>
      </div>
      {locs.map((loc, i) => (
        <div key={i} className="track-card">
          <div className="track-card__row">
            <div className="track-card__icon" style={{ color: loc.threat_level === 'HIGH' ? 'var(--red)' : loc.threat_level === 'MEDIUM' ? 'var(--yellow)' : 'var(--accent)' }}>◆</div>
            <div className="track-card__info">
              <div className="track-card__name">
                <span className="track-card__callsign">{loc.name}</span>
                <span className="track-card__type">{loc.threat_level || 'MED'}</span>
              </div>
              <div className="track-card__meta">
                <span className="track-card__distance">{(loc.observations || []).length} obs · {loc.confidence}</span>
              </div>
            </div>
          </div>
          {loc.raw_intel && (
            <div style={{ paddingLeft: '34px', paddingRight: '12px', paddingBottom: '6px', fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              "{loc.raw_intel}"
            </div>
          )}
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
    { label: 'ALL HOLD', type: 'HOLD_ALL' },
    { label: 'ALL RTB', type: 'RTB_ALL' },
    { label: 'WEAPONS FREE', type: 'WEAPONS_FREE' },
    { label: 'WEAPONS SAFE', type: 'WEAPONS_SAFE' },
    { label: 'FORM UP', type: 'FORM_UP' },
    { label: 'DISPERSE', type: 'DISPERSE' },
  ];

  return (
    <div className="tracks-list">
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-hairline)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>All Units</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <input
            className="sidebar-input"
            style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '9px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '4px 8px', color: 'var(--text-primary)', outline: 'none' }}
            placeholder="Custom order..."
            value={massOrder}
            onChange={e => setMassOrder(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMass()}
          />
          <button className="btn btn-sm btn-primary" onClick={sendMass}>SEND</button>
        </div>
      </div>
      <div style={{ padding: '8px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
        {CMDS.map(cmd => (
          <button
            key={cmd.type}
            className={`order-btn ${cmd.type === 'WEAPONS_FREE' ? 'danger' : cmd.type === 'WEAPONS_SAFE' ? 'primary' : ''}`}
            onClick={async () => {
              await sendArmaCommand({ type: cmd.type });
              addCommsEntry('SPECTRE', 'ALL', cmd.label, 'BLUE');
            }}
          >
            {cmd.label}
          </button>
        ))}
      </div>
    </div>
  );
}
