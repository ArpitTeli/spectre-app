import React, { useState, useMemo } from 'react';
import { Button, HTMLTable, Icon, InputGroup } from '@blueprintjs/core';
import VaultGraph from './VaultGraph';
import AppIcon from './Icon';
import Symbol from './Symbol';
import Segments from './Segments';
import { TYPE_LABELS, gridRef, isDown, unitState } from './unitFormat';

const TABS = [
  { id: 'UNITS', label: 'Units', icon: 'drive-time' },
  { id: 'CONTACTS', label: 'Contacts', icon: 'locate' },
  { id: 'INTEL', label: 'Intel', icon: 'document' },
  { id: 'ORDERS', label: 'Orders', icon: 'timeline-events' },
  { id: 'GRAPH', label: 'Graph', icon: 'graph' },
];

export default function SidePanel({ state, patch, addCommsEntry, sendArmaCommand, addIntel, visibleUnits, collapsed, onCollapse, onPickUnit }) {
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

  const counts = { UNITS: units.filter(u => !u.vehicle).length, CONTACTS: contacts.length };
  const current = TABS.find(t => t.id === activeTab);
  const searchable = activeTab === 'UNITS' || activeTab === 'CONTACTS';

  const choose = (id) => {
    if (id === activeTab && !collapsed) onCollapse(true);
    else {
      setActiveTab(id);
      onCollapse(false);
    }
  };

  return (
    <>
    <nav className="rail" aria-label="Sections">
      {TABS.map(t => (
        <button
          key={t.id}
          className={!collapsed && activeTab === t.id ? 'active' : ''}
          onClick={() => choose(t.id)}
          title={counts[t.id] !== undefined ? `${t.label} (${counts[t.id]})` : t.label}
          aria-label={t.label}
        >
          <Icon icon={t.icon} size={18} />
          {t.id === 'CONTACTS' && counts[t.id] > 0 && <em>{counts[t.id]}</em>}
        </button>
      ))}
    </nav>
    {!collapsed && (
    <div className="tracks-panel">
      <header className="panel__head">
        <h1>{current.label}</h1>
        {counts[activeTab] !== undefined && <span>{counts[activeTab]}</span>}
        {searchable && (
          <InputGroup
            className="panel__search"
            small
            leftIcon="search"
            placeholder="Filter"
            aria-label={`Filter ${current.label.toLowerCase()}`}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        )}
        <Button className="panel__close" minimal small icon="chevron-left" onClick={() => onCollapse(true)} aria-label="Hide panel" />
      </header>

      <div className="tracks-panel__content">
        {activeTab === 'UNITS' && (
          <UnitsTab
            units={filteredUnits}
            selectedUnit={state.selectedUnit}
            selectedUnits={state.selectedUnits}
            allUnits={state.units}
            onPick={onPickUnit}
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
      {searchable && <Activity entries={state.commsLog} />}
    </div>
    )}
    </>
  );
}

function Activity({ entries = [] }) {
  const recent = entries.slice(-12).reverse();
  return (
    <section className="activity">
      <h2>Activity</h2>
      {recent.length === 0 && <p>Orders and reports will appear here.</p>}
      <ol>
        {recent.map(entry => (
          <li key={entry.id} className={`priority-${entry.priority}`}>
            <time>{entry.timestamp}</time>
            <b>{entry.to}</b>
            <span>{entry.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function UnitsTab({ units, selectedUnit, selectedUnits = [], allUnits, onPick }) {
  const vehicles = useMemo(() => {
    const order = { TANK: 0, MBT: 0, IFV: 1, APC: 2, HELI: 3, CAR: 4, TRUCK: 5, RECON: 6, VEHICLE: 7, INFANTRY: 10 };
    return units.filter(u => !u.vehicle).sort((a, b) => {
      const diff = (order[a.vehicle_type] ?? 8) - (order[b.vehicle_type] ?? 8);
      return diff || String(a.callsign || '').localeCompare(String(b.callsign || ''), undefined, { numeric: true });
    });
  }, [units]);

  if (vehicles.length === 0) return <div className="empty-state">No units yet. Waiting for Arma.</div>;
  const crewOf = (id) => Object.values(allUnits || {}).filter(u => u.vehicle === id).length;

  return (
    <ul className="units">
      {vehicles.map(u => {
        const selected = u.id === selectedUnit || selectedUnits.includes(u.id);
        const state = unitState(u);
        const crew = crewOf(u.id);
        return (
          <li key={u.id}>
            <button
              className={`unit unit--${state}${selected ? ' selected' : ''}`}
              aria-pressed={selected}
              onClick={e => onPick(u.id, e.ctrlKey || e.metaKey)}
            >
              <Symbol item={u} side="friend" size={19} />
              <span className="unit__id">
                <strong>{u.callsign || u.id}</strong>
                <small>
                  <b>{isDown(u) ? 'destroyed' : String(u.current_order || 'no task').toLowerCase()}</b>
                  {' · '}{TYPE_LABELS[u.vehicle_type] || u.vehicle_type || 'Unit'}{crew ? ` · crew ${crew}` : ''}
                </small>
              </span>
              <span className="unit__speed"><strong>{Math.round(u.speed ?? 0)}</strong><small>km/h</small></span>
              <span className="unit__gauges">
                <Segments label="HP" value={u.health ?? 100} />
                <Segments label="Fuel" value={u.fuel ?? 100} />
                <small className="num">{gridRef(u.position)}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ContactsTab({ contacts, selectedContact, patch }) {
  const list = useMemo(() => {
    const rank = { CONFIRMED: 0, LAST_KNOWN: 1, SUSPECTED: 2, DEAD: 3 };
    return [...contacts].sort((a, b) => (rank[a.state] ?? 2) - (rank[b.state] ?? 2));
  }, [contacts]);

  if (list.length === 0) return <div className="empty-state">No contacts reported.</div>;

  return (
    <HTMLTable compact interactive className="grid-table">
      <thead>
        <tr><th aria-label="Symbol" /><th>Contact</th><th>Type</th><th>State</th><th className="num">Grid</th></tr>
      </thead>
      <tbody>
        {list.map(c => (
          <tr
            key={c.id}
            className={c.id === selectedContact ? 'selected' : ''}
            tabIndex={0}
            onClick={() => patch({ selectedContact: c.id })}
            onKeyDown={e => e.key === 'Enter' && patch({ selectedContact: c.id })}
          >
            <td><Symbol item={c} side="hostile" size={13} /></td>
            <td className="name">{c.id}</td>
            <td className="cap">{String(c.type || 'unknown').toLowerCase()}</td>
            <td className={`cap ${c.state === 'CONFIRMED' ? 'tone-bad' : 'tone-warn'}`}>{String(c.state || '').replace('_', ' ').toLowerCase()}</td>
            <td className="num">{gridRef(c.position)}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
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
      <div className="form-block">
        <h3>Report intel</h3>
        <textarea
          className="field"
          rows={3}
          placeholder='For example: "Firna is an enemy stronghold with IFVs"'
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) submit(); }}
        />
        <button className="wide-btn" onClick={submit}>{saved ? 'Logged' : 'Log intel'}</button>
      </div>
      <h3 className="list-title">Known locations <span>{locs.length}</span></h3>
      {locs.map((loc, i) => (
        <div key={i} className="asset asset--static">
          <div className="asset__head">
            <span className="entity-tile entity-tile--intel"><AppIcon name="intel" size={16} /></span>
            <div className="asset__name">
              <strong>{loc.name}</strong>
              <span>{(loc.observations || []).length} observations · {String(loc.confidence || '').replace('_', ' ').toLowerCase()}</span>
            </div>
            <span className={`chip chip--${loc.threat_level === 'HIGH' ? 'bad' : loc.threat_level === 'MEDIUM' ? 'warn' : 'plain'}`}>
              {(loc.threat_level || 'medium').toLowerCase()}
            </span>
          </div>
          {loc.raw_intel && <p className="asset__quote">“{loc.raw_intel}”</p>}
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

  const recent = (state.commsLog || []).slice(-30).reverse();

  return (
    <div className="tracks-list">
      <div className="form-block">
        <h3>Custom order to all units</h3>
        <div className="form-row">
          <input
            className="field"
            placeholder="Type an order"
            value={massOrder}
            onChange={e => setMassOrder(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMass()}
          />
          <button className="wide-btn wide-btn--primary" onClick={sendMass}>Send</button>
        </div>
      </div>
      <h3 className="list-title">Activity</h3>
      {recent.length === 0 && <div className="empty-state">No orders yet.</div>}
      <ol className="timeline">
        {recent.map(entry => (
          <li key={entry.id} className={`timeline__item priority-${entry.priority}`}>
            <time>{entry.timestamp}</time>
            <strong>{entry.to}</strong>
            <p>{entry.message}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
