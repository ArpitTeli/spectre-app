import React, { useState, useMemo } from 'react';

const TYPE_LABELS = {
  INFANTRY: 'Infantry', CAR: 'Car', RECON: 'Recon', TRUCK: 'Truck',
  APC: 'APC', IFV: 'IFV', TANK: 'Tank', HELI: 'Helicopter',
  PLANE: 'Fixed-Wing', BOAT: 'Boat', VEHICLE: 'Vehicle',
};

function getUnitClassification(unit) {
  if (unit.status === 'DESTROYED' || unit.status === 'DEAD') return 'destroyed';
  const type = (unit.vehicle_type || '').toUpperCase();
  if (['TANK', 'IFV', 'APC', 'HELI', 'PLANE'].includes(type)) return 'hostile';
  if (unit.is_enemy || unit.side === 'ENEMY') return 'hostile';
  return 'friendly';
}

function getDistance(unit) {
  if (!unit.position) return null;
  const x = unit.position.x || 0;
  const y = unit.position.y || 0;
  const dist = Math.sqrt(x * x + y * y);
  if (dist < 1000) return `${Math.round(dist)}m`;
  return `${(dist / 1000).toFixed(1)}km`;
}

export default function SidePanel({ state, patch, addCommsEntry, sendArmaCommand, addIntel, endMission, visibleUnits }) {
  const [activeTab, setActiveTab] = useState('TRACKS');
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

  const hostileUnits = filteredUnits.filter(u => getUnitClassification(u) === 'hostile');
  const friendlyUnits = filteredUnits.filter(u => getUnitClassification(u) === 'friendly');
  const destroyedUnits = filteredUnits.filter(u => getUnitClassification(u) === 'destroyed');

  return (
    <div className="tracks-panel">
      <div className="tracks-panel__tabs">
        {['TRACKS', 'ASSETS', 'ENVIRONMENT'].map(t => (
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
          placeholder="Search by x, y, z..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="tracks-panel__search-input"
        />
        <button className="tracks-panel__filter-btn">Filters</button>
      </div>

      <div className="tracks-panel__content">
        {activeTab === 'TRACKS' && (
          <TracksTab
            hostileUnits={hostileUnits}
            friendlyUnits={friendlyUnits}
            destroyedUnits={destroyedUnits}
            contacts={contacts}
            selectedUnit={state.selectedUnit}
            patch={patch}
            sendArmaCommand={sendArmaCommand}
            addCommsEntry={addCommsEntry}
          />
        )}
        {activeTab === 'ASSETS' && (
          <AssetsTab
            units={filteredUnits}
            selectedUnit={state.selectedUnit}
            patch={patch}
            sendArmaCommand={sendArmaCommand}
            addCommsEntry={addCommsEntry}
          />
        )}
        {activeTab === 'ENVIRONMENT' && (
          <EnvironmentTab
            state={state}
            addIntel={addIntel}
          />
        )}
      </div>
    </div>
  );
}

function TracksTab({ hostileUnits, friendlyUnits, destroyedUnits, contacts, selectedUnit, patch, sendArmaCommand, addCommsEntry }) {
  return (
    <div className="tracks-list">
      {hostileUnits.length > 0 && (
        <UnitSection
          title="Hostile"
          color="var(--red)"
          count={hostileUnits.length}
          units={hostileUnits}
          selectedUnit={selectedUnit}
          patch={patch}
          sendArmaCommand={sendArmaCommand}
          addCommsEntry={addCommsEntry}
        />
      )}

      {friendlyUnits.length > 0 && (
        <UnitSection
          title="Friendly"
          color="var(--accent)"
          count={friendlyUnits.length}
          units={friendlyUnits}
          selectedUnit={selectedUnit}
          patch={patch}
          sendArmaCommand={sendArmaCommand}
          addCommsEntry={addCommsEntry}
        />
      )}

      {destroyedUnits.length > 0 && (
        <UnitSection
          title="Destroyed"
          color="var(--text-muted)"
          count={destroyedUnits.length}
          units={destroyedUnits}
          selectedUnit={selectedUnit}
          patch={patch}
          sendArmaCommand={sendArmaCommand}
          addCommsEntry={addCommsEntry}
        />
      )}

      {hostileUnits.length === 0 && friendlyUnits.length === 0 && destroyedUnits.length === 0 && (
        <div className="empty-state">
          <div style={{ fontSize: '24px', marginBottom: '8px', color: 'var(--text-muted)' }}>◎</div>
          <div>No tracks detected.</div>
          <div style={{ fontSize: '8px', color: 'var(--text-muted)' }}>Awaiting Arma connection</div>
        </div>
      )}
    </div>
  );
}

function UnitSection({ title, color, count, units, selectedUnit, patch, sendArmaCommand, addCommsEntry }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="unit-section">
      <div className="unit-section__header" onClick={() => setExpanded(!expanded)}>
        <div className="unit-section__title">
          <span className="unit-section__dot" style={{ background: color }} />
          <span>{title}</span>
        </div>
        <div className="unit-section__count">
          <span>{count}</span>
          <span className="unit-section__arrow">{expanded ? '▾' : '▸'}</span>
        </div>
      </div>
      {expanded && (
        <div className="unit-section__list">
          {units.map(u => (
            <TrackCard
              key={u.id}
              unit={u}
              selected={u.id === selectedUnit}
              onSelect={() => patch({ selectedUnit: u.id })}
              sendArmaCommand={sendArmaCommand}
              addCommsEntry={addCommsEntry}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TrackCard({ unit, selected, onSelect, sendArmaCommand, addCommsEntry }) {
  const [showActions, setShowActions] = useState(false);
  const isSelected = unit.id === selected;
  const isYou = isSelected;
  const distance = getDistance(unit);
  const label = TYPE_LABELS[unit.vehicle_type] || unit.vehicle_type || 'Unknown';
  const order = unit.current_order;
  const dead = unit.status === 'DESTROYED' || unit.status === 'DEAD';

  const send = async (type, params = {}) => {
    await sendArmaCommand({ type, unit_id: unit.id, ...params });
    addCommsEntry('SPECTRE', unit.callsign, `${type}${params.instruction ? ': ' + params.instruction : ''}`, 'BLUE');
  };

  return (
    <div
      className={`track-card ${isSelected ? 'selected' : ''} ${dead ? 'destroyed' : ''}`}
      onClick={onSelect}
    >
      <div className="track-card__row">
        <div className="track-card__icon">
          {unit.vehicle_type === 'TANK' || unit.vehicle_type === 'IFV' ? '▲' :
           unit.vehicle_type === 'HELI' ? '✦' :
           unit.vehicle_type === 'CAR' || unit.vehicle_type === 'TRUCK' ? '●' :
           unit.vehicle_type === 'INFANTRY' ? '●' : '○'}
        </div>
        <div className="track-card__info">
          <div className="track-card__name">
            <span className="track-card__callsign">{unit.callsign || unit.id}</span>
            {isYou && <span className="track-card__you-badge">You</span>}
          </div>
          <div className="track-card__meta">
            <span className="track-card__type">{label}</span>
            <span className="track-card__separator">·</span>
            <span className="track-card__distance">{distance ? `${distance} NE of you` : ''}</span>
          </div>
        </div>
        <div className="track-card__status">
          <span className="track-card__live-badge">Live</span>
          <span className="track-card__tracking-badge">Tracking</span>
        </div>
      </div>

      {order && (
        <div className="track-card__task">
          <span className="track-card__task-label">Task:</span>
          <span className="track-card__task-value">{order}</span>
        </div>
      )}

      <div className="track-card__actions-row">
        <div className="track-card__assign">
          <span className="track-card__assign-label">Assign to</span>
          <span className="track-card__assign-arrow">▾</span>
        </div>
        <button
          className="track-card__menu-btn"
          onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
        >
          ···
        </button>
      </div>

      {showActions && isSelected && !dead && (
        <div className="track-card__quick-actions" onClick={e => e.stopPropagation()}>
          <button className="track-card__action-btn" onClick={() => send('HOLD')}>HOLD</button>
          <button className="track-card__action-btn" onClick={() => send('RTB')}>RTB</button>
          <button className="track-card__action-btn primary" onClick={() => send('WEAPONS_FREE')}>WEAPONS FREE</button>
        </div>
      )}
    </div>
  );
}

function AssetsTab({ units, selectedUnit, patch, sendArmaCommand, addCommsEntry }) {
  const grouped = useMemo(() => {
    const groups = {};
    units.forEach(u => {
      const type = u.vehicle_type || 'UNKNOWN';
      if (!groups[type]) groups[type] = [];
      groups[type].push(u);
    });
    return groups;
  }, [units]);

  return (
    <div className="assets-tab">
      {Object.entries(grouped).map(([type, list]) => (
        <div key={type} className="asset-group">
          <div className="asset-group__header">
            <span className="asset-group__type">{TYPE_LABELS[type] || type}</span>
            <span className="asset-group__count">{list.length}</span>
          </div>
          {list.map(u => (
            <TrackCard
              key={u.id}
              unit={u}
              selected={u.id === selectedUnit}
              onSelect={() => patch({ selectedUnit: u.id })}
              sendArmaCommand={sendArmaCommand}
              addCommsEntry={addCommsEntry}
            />
          ))}
        </div>
      ))}
      {Object.keys(grouped).length === 0 && (
        <div className="empty-state">No assets.</div>
      )}
    </div>
  );
}

function EnvironmentTab({ state, addIntel }) {
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

  const intelDB = state.intelDB;
  const contacts = Object.values(state.contacts || {});

  return (
    <div className="environment-tab">
      <div className="env-section">
        <div className="env-section__header">
          <span>CONTACTS</span>
          <span className="env-section__count">{contacts.length}</span>
        </div>
        {contacts.length === 0 && (
          <div className="empty-state" style={{ padding: '12px' }}>No contacts.</div>
        )}
      </div>

      <div className="env-section">
        <div className="env-section__header">
          <span>INTEL</span>
          <span className="env-section__count">{(intelDB?.locations || []).length}</span>
        </div>
        <div className="env-report-box">
          <textarea
            className="env-report-input"
            rows={2}
            placeholder='e.g. "Firna is enemy stronghold with IFVs"'
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) submit(); }}
          />
          <button className={`btn btn-sm ${saved ? 'btn-primary' : ''}`} onClick={submit}>
            {saved ? 'LOGGED' : 'LOG INTEL'}
          </button>
        </div>
        {(intelDB?.locations || []).map((loc, i) => (
          <div key={i} className="intel-item">
            <div className="intel-item__header">
              <span className="intel-item__type">{loc.name}</span>
              <span className="intel-item__time">{loc.threat_level || 'MED'}</span>
            </div>
            <div className="intel-item__content">{(loc.observations || []).length} obs</div>
          </div>
        ))}
      </div>
    </div>
  );
}
