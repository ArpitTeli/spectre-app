import React, { useState } from 'react';

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
        {['UNITS','CONTACTS','INTEL','ORDERS'].map(t => (
          <button key={t} className={`side-panel__tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>

      <div className="side-panel__content">
        {activeTab === 'UNITS'    && <UnitsTab    units={state.units}    selectedUnit={state.selectedUnit} patch={patch} sendArmaCommand={sendArmaCommand} addCommsEntry={addCommsEntry} />}
        {activeTab === 'CONTACTS' && <ContactsTab contacts={state.contacts} patch={patch} />}
        {activeTab === 'INTEL'    && <IntelTab    intelDB={state.intelDB} addIntel={addIntel} />}
        {activeTab === 'ORDERS'   && <OrdersTab   state={state} sendArmaCommand={sendArmaCommand} addCommsEntry={addCommsEntry} />}
      </div>
    </div>
  );
}

// ─── Force Metrics + Mission Controls ────────────────────────────────────────
function ForceMetrics({ forceMetrics, missionPhase, rewardData, patch, addCommsEntry, sendArmaCommand, endMission }) {
  const fpColor = forceMetrics.firepower_index < 50 ? 'danger' : forceMetrics.firepower_index < 70 ? 'warning' : '';

  return (
    <div className="force-metrics">
      <div className="force-metrics__title">Force Status</div>
      <div className="force-metrics__grid">
        <div className="metric-box">
          <div className={`metric-box__value ${fpColor}`}>{forceMetrics.firepower_index}%</div>
          <div className="metric-box__label">Firepower</div>
        </div>
        <div className="metric-box">
          <div className="metric-box__value">{forceMetrics.vehicles_active}</div>
          <div className="metric-box__label">Vehicles</div>
        </div>
        <div className="metric-box">
          <div className={`metric-box__value ${forceMetrics.mobility === 'LOW' ? 'danger' : ''}`}>{forceMetrics.mobility}</div>
          <div className="metric-box__label">Mobility</div>
        </div>
        <div className="metric-box">
          <div className={`metric-box__value ${rewardData?.score < 0 ? 'danger' : ''}`}>{(rewardData?.score || 0).toFixed(0)}</div>
          <div className="metric-box__label">Score</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
        {missionPhase === 'PLANNING' && (
          <button className="btn btn-primary" style={{ flex: 1, fontSize: '11px' }} onClick={() => {
            addCommsEntry('SPECTRE', 'ALL', 'Mission planning initiated.', 'BLUE');
          }}>
            BEGIN PLANNING
          </button>
        )}
        {missionPhase === 'BRIEFING' && (
          <>
            <button className="btn" style={{ flex: 1, fontSize: '11px' }} onClick={() => patch({ missionPhase: 'PLANNING' })}>
              BEGIN PLANNING
            </button>
            <button className="btn btn-success" style={{ fontSize: '11px', padding: '6px 10px' }} onClick={() => {
              patch({ missionPhase: 'ACTIVE', missionStartTime: Date.now() });
              addCommsEntry('SPECTRE', 'ALL', 'Mission is GO. Execute plan.', 'GREEN');
            }}>
              EXECUTE
            </button>
          </>
        )}
        {missionPhase === 'ACTIVE' && (
          <>
            <button className="btn" style={{ flex: 1, fontSize: '11px' }} onClick={() => patch({ showCOAPanel: true })}>
              COA
            </button>
            <button className="btn btn-success" style={{ fontSize: '11px', padding: '6px 10px' }} onClick={() => endMission(true)}>
              OBJ
            </button>
            <button className="btn btn-danger" style={{ fontSize: '11px', padding: '6px 10px' }} onClick={() => endMission(false)}>
              END
            </button>
          </>
        )}
        <button className="btn" style={{ fontSize: '11px', padding: '6px 10px' }} onClick={() => patch({ showSettings: true })}>⚙</button>
      </div>
    </div>
  );
}

// ─── Units Tab ────────────────────────────────────────────────────────────────
function UnitsTab({ units, selectedUnit, patch, sendArmaCommand, addCommsEntry }) {
  const list = Object.values(units).sort((a, b) => (a.callsign || '').localeCompare(b.callsign || ''));
  if (list.length === 0) return (
    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
      No units detected.<br />Awaiting Arma connection.
    </div>
  );
  return (
    <div className="unit-list">
      {list.map(u => <UnitCard key={u.id} unit={u} selected={u.id === selectedUnit} onSelect={() => patch({ selectedUnit: u.id })} sendArmaCommand={sendArmaCommand} addCommsEntry={addCommsEntry} />)}
    </div>
  );
}

function UnitCard({ unit, selected, onSelect, sendArmaCommand, addCommsEntry }) {
  const [showOrder, setShowOrder] = useState(false);
  const [orderText, setOrderText] = useState('');
  const dead = unit.status === 'DESTROYED' || unit.status === 'DEAD';

  const send = async (type, params = {}) => {
    await sendArmaCommand({ type, unit_id: unit.id, ...params });
    addCommsEntry('SPECTRE', unit.callsign, `${type}${params.instruction ? ': ' + params.instruction : ''}`, 'BLUE');
  };

  return (
    <div className={`unit-card ${selected ? 'selected' : ''} ${dead ? 'destroyed' : ''}`} onClick={onSelect}>
      <div className="unit-card__header">
        <span className="unit-card__callsign">{unit.callsign}</span>
        <span className="unit-card__type">{unit.vehicle_type || unit.type}</span>
      </div>
      <div className="unit-card__bars">
        <Bar label="HP"   value={unit.health ?? 100} type="health" />
        <Bar label="FUEL" value={unit.fuel   ?? 100} type="fuel" />
        <Bar label="AMMO" value={unit.ammo   ?? 100} type="ammo" />
      </div>
      {unit.current_order && <div className="unit-card__status">▶ {unit.current_order}</div>}

      {selected && !dead && (
        <div style={{ marginTop: '8px', display: 'flex', gap: '4px', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
          <button className="btn" style={{ fontSize: '10px', padding: '3px 8px' }} onClick={() => send('HOLD')}>HOLD</button>
          <button className="btn" style={{ fontSize: '10px', padding: '3px 8px' }} onClick={() => send('RTB')}>RTB</button>
          <button className="btn" style={{ fontSize: '10px', padding: '3px 8px' }} onClick={() => { setShowOrder(v => !v); setOrderText(''); }}>ORDER</button>
        </div>
      )}
      {showOrder && (
        <div style={{ marginTop: '6px' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: '4px' }}>
            <input className="modify-input" placeholder="e.g. move to building north"
              value={orderText} onChange={e => setOrderText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && orderText.trim()) { send('CUSTOM', { instruction: orderText }); setOrderText(''); setShowOrder(false); } }}
            />
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
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', minWidth: '28px' }}>{pct}%</span>
    </div>
  );
}

// ─── Contacts Tab ─────────────────────────────────────────────────────────────
function ContactsTab({ contacts, patch }) {
  const list = Object.values(contacts).sort((a, b) => {
    const o = { CONFIRMED: 0, LAST_KNOWN: 1, SUSPECTED: 2 };
    return (o[a.state] || 2) - (o[b.state] || 2);
  });
  const stateColors = { CONFIRMED: 'var(--color-hostile)', LAST_KNOWN: 'var(--color-last-known)', SUSPECTED: 'var(--color-suspected)' };

  if (list.length === 0) return (
    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>No contacts detected.</div>
  );

  return (
    <div style={{ padding: '8px' }}>
      {list.map(c => (
        <div key={c.id} style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
          borderLeft: `3px solid ${stateColors[c.state] || 'var(--text-muted)'}`,
          borderRadius: '3px', padding: '8px 10px', marginBottom: '4px', cursor: 'pointer'
        }} onClick={() => patch({ selectedContact: c.id })}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontFamily: 'var(--font-condensed)', fontWeight: 700, color: 'var(--text-bright)', fontSize: '13px' }}>{c.id}</span>
            <span className={`intel-tag ${c.state === 'CONFIRMED' ? 'HIGH' : c.state === 'LAST_KNOWN' ? 'MEDIUM' : 'LOW'}`}>{c.state}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-secondary)' }}>
            {c.type} · {c.source} · {c.position ? `(${Math.round(c.position.x)}, ${Math.round(c.position.y)})` : 'pos unknown'}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Intel Tab ────────────────────────────────────────────────────────────────
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
      name,
      raw_intel: input,
      confidence: 'PLAYER_REPORTED',
      threat_level: threat,
      timestamp: new Date().toISOString(),
      observations: [{ text: input, timestamp: new Date().toISOString(), source: 'COMMANDER' }]
    });
    setInput('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ padding: '10px' }}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-accent)', borderRadius: '4px', padding: '10px', marginBottom: '12px' }}>
        <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '2px', marginBottom: '8px' }}>REPORT INTELLIGENCE</div>
        <textarea className="planning-input" rows={3}
          placeholder={'e.g. "Firna is an enemy stronghold with 2 IFVs"\n"Enemy patrol on eastern road every 10 min"'}
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) submit(); }}
        />
        <button className={`btn ${saved ? 'btn-success' : 'btn-primary'}`} style={{ marginTop: '6px', width: '100%', fontSize: '11px' }} onClick={submit}>
          {saved ? 'INTEL LOGGED' : 'LOG INTELLIGENCE'}
        </button>
      </div>

      <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: '8px' }}>
        DATABASE ({(intelDB?.locations || []).length} locations · {(intelDB?.patterns || []).length} patterns)
      </div>

      {(intelDB?.locations || []).map((loc, i) => (
        <div key={i} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '3px', padding: '8px 10px', marginBottom: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontFamily: 'var(--font-condensed)', fontWeight: 700, color: 'var(--text-bright)', fontSize: '13px' }}>{loc.name}</span>
            <span className={`intel-tag ${loc.threat_level || 'MEDIUM'}`}>{loc.threat_level || 'MEDIUM'}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-secondary)' }}>
            {(loc.observations || []).length} obs · {loc.confidence}
          </div>
          {loc.raw_intel && <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>"{loc.raw_intel}"</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────
function OrdersTab({ state, sendArmaCommand, addCommsEntry }) {
  const [massOrder, setMassOrder] = useState('');

  const sendMass = async () => {
    if (!massOrder.trim()) return;
    Object.keys(state.units).forEach(id => sendArmaCommand({ type: 'CUSTOM', unit_id: id, instruction: massOrder }));
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
    <div style={{ padding: '10px' }}>
      <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: '10px' }}>ALL UNITS ORDER</div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        <input className="modify-input" placeholder="Order for all units..."
          value={massOrder} onChange={e => setMassOrder(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMass()} />
        <button className="btn btn-primary" onClick={sendMass}>SEND</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        {CMDS.map(cmd => (
          <button key={cmd.type} className="btn" style={{ fontSize: '11px' }}
            onClick={async () => { await sendArmaCommand({ type: cmd.type }); addCommsEntry('SPECTRE', 'ALL', cmd.label, 'BLUE'); }}>
            {cmd.label}
          </button>
        ))}
      </div>
    </div>
  );
}
