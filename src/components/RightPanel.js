import React, { useState } from 'react';

const AMMO_TYPES = [
  { name: 'APFSDS-T', subtitle: 'Armor Piercing', color: 'var(--accent)' },
  { name: 'HEAB-T', subtitle: 'Airburst', color: 'var(--green)' },
  { name: 'COYOTE', subtitle: 'UAS', color: 'var(--yellow)' },
  { name: 'TOW', subtitle: 'Missile', color: 'var(--red)' },
];

const SENSOR_TYPES = [
  { name: 'Radar', category: 'Front Sensors' },
  { name: 'Turret EO/IR', category: 'Front Sensors' },
  { name: 'EO/IR', category: '360 Sensors' },
  { name: 'Active Protection System', category: '360 Sensors' },
  { name: 'Laser Warning System', category: '360 Sensors' },
];

const EXTERNAL_DATA = [
  { name: 'ADIS', connected: true },
  { name: 'JBC-P', connected: false },
];

export default function RightPanel({ state, patch, sendArmaCommand, addCommsEntry, selectedUnit }) {
  const [activeTab, setActiveTab] = useState('HEALTH');

  const units = Object.values(state.units || {});
  const contacts = Object.values(state.contacts || {});
  const forceMetrics = state.forceMetrics || { firepower_index: 0, vehicles_active: 0, vehicles_total: 0 };
  const rewardData = state.rewardData || { score: 0 };

  return (
    <div className="right-panel">
      <div className="right-panel__tabs">
        <button
          className={`right-panel__tab ${activeTab === 'TASKS' ? 'active' : ''}`}
          onClick={() => setActiveTab('TASKS')}
        >
          Tasks
        </button>
        <button
          className={`right-panel__tab ${activeTab === 'HEALTH' ? 'active' : ''}`}
          onClick={() => setActiveTab('HEALTH')}
        >
          Vehicle Health
        </button>
      </div>

      <div className="right-panel__content">
        {activeTab === 'TASKS' && (
          <TasksTab
            units={units}
            contacts={contacts}
            state={state}
            patch={patch}
            sendArmaCommand={sendArmaCommand}
            addCommsEntry={addCommsEntry}
          />
        )}
        {activeTab === 'HEALTH' && (
          <HealthTab
            selectedUnit={selectedUnit}
            forceMetrics={forceMetrics}
            rewardData={rewardData}
          />
        )}
      </div>
    </div>
  );
}

function TasksTab({ units, contacts, state, patch, sendArmaCommand, addCommsEntry }) {
  const missionPhase = state.missionPhase || 'BRIEFING';

  const CMDS = [
    { label: 'ALL HOLD', type: 'HOLD_ALL' },
    { label: 'ALL RTB', type: 'RTB_ALL' },
    { label: 'WEAPONS FREE', type: 'WEAPONS_FREE' },
    { label: 'WEAPONS SAFE', type: 'WEAPONS_SAFE' },
    { label: 'FORM UP', type: 'FORM_UP' },
    { label: 'DISPERSE', type: 'DISPERSE' },
  ];

  return (
    <div className="tasks-tab">
      <div className="tasks-section">
        <div className="tasks-section__title">MISSION CONTROLS</div>
        <div className="tasks-actions">
          {missionPhase === 'BRIEFING' && (
            <>
              <button className="tasks-action-btn" onClick={() => patch({ missionPhase: 'PLANNING' })}>PLAN</button>
              <button className="tasks-action-btn primary" onClick={() => {
                patch({ missionPhase: 'ACTIVE', missionStartTime: Date.now() });
                addCommsEntry('SPECTRE', 'ALL', 'Mission GO. Execute.', 'GREEN');
              }}>EXEC</button>
            </>
          )}
          {missionPhase === 'ACTIVE' && (
            <>
              <button className="tasks-action-btn" onClick={() => patch({ showCOAPanel: true })}>COA</button>
              <button className="tasks-action-btn primary" onClick={() => {
                patch({ showAAR: true, missionPhase: 'AAR' });
                addCommsEntry('SPECTRE', 'ALL', 'Mission complete. AAR.', 'GREEN');
              }}>OBJ</button>
              <button className="tasks-action-btn danger" onClick={() => {
                patch({ missionPhase: 'ABORTING', abortState: { countdown: 30, auto_select: 'CONTINUE' } });
                addCommsEntry('SPECTRE', 'ALL', 'Emergency abort initiated.', 'RED');
              }}>END</button>
            </>
          )}
        </div>
      </div>

      <div className="tasks-section">
        <div className="tasks-section__title">ALL UNITS</div>
        <div className="tasks-cmd-grid">
          {CMDS.map(cmd => (
            <button
              key={cmd.type}
              className={`tasks-cmd-btn ${cmd.type === 'WEAPONS_FREE' ? 'danger' : cmd.type === 'WEAPONS_SAFE' ? 'primary' : ''}`}
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

      <div className="tasks-section">
        <div className="tasks-section__title">ACTIVE TRACKS</div>
        <div className="tasks-track-list">
          {units.slice(0, 5).map(u => (
            <div key={u.id} className="tasks-track-item" onClick={() => patch({ selectedUnit: u.id })}>
              <span className="tasks-track-dot" style={{
                background: u.status === 'DESTROYED' ? 'var(--text-muted)' :
                           (u.is_enemy || u.side === 'ENEMY') ? 'var(--red)' : 'var(--accent)'
              }} />
              <span className="tasks-track-name">{u.callsign || u.id}</span>
              <span className="tasks-track-type">{u.vehicle_type || 'UNK'}</span>
            </div>
          ))}
          {units.length === 0 && (
            <div className="empty-state" style={{ padding: '12px' }}>No active units.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function HealthTab({ selectedUnit, forceMetrics, rewardData }) {
  const unit = selectedUnit;

  const speed = unit?.speed || 0;
  const fuel = unit?.fuel || 100;

  const ammo = unit?.ammo || {};
  const ammoList = AMMO_TYPES.map((a, i) => ({
    ...a,
    current: Object.values(ammo)[i] || Math.floor(Math.random() * 40 + 10),
    total: 80,
  }));

  const sensors = SENSOR_TYPES.map((s, i) => ({
    ...s,
    status: i < 3 ? 'ON' : (unit?.sensors || [])[i] || 'OFF',
  }));

  return (
    <div className="health-tab">
      <div className="health-stats-row">
        <div className="health-stat-box">
          <div className="health-stat-value">{forceMetrics.vehicles_active || 8}</div>
          <div className="health-stat-label">CHANNEL</div>
        </div>
        <div className="health-stat-box">
          <div className="health-stat-value">{speed}</div>
          <div className="health-stat-label">MPH</div>
        </div>
        <div className="health-stat-box">
          <div className="health-stat-value">{Math.round((fuel / 100) * 200)}</div>
          <div className="health-stat-label">MILES</div>
        </div>
      </div>

      <div className="health-section">
        <div className="health-section__header">
          <span className="health-section__title">Ammunition</span>
          <span className="health-section__arrow">▾</span>
        </div>
        <div className="health-ammo-list">
          {ammoList.map((a, i) => (
            <div key={i} className="health-ammo-item">
              <div className="health-ammo-dot" style={{ background: a.color }} />
              <div className="health-ammo-info">
                <div className="health-ammo-name">{a.name}</div>
                <div className="health-ammo-subtitle">{a.subtitle}</div>
              </div>
              <div className="health-ammo-count">
                <span className="health-ammo-current">{a.current}</span>
                <span className="health-ammo-total">/{a.total}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="health-section">
        <div className="health-section__header">
          <span className="health-section__title">Sensors</span>
          <span className="health-section__arrow">▾</span>
        </div>
        <div className="health-sensor-list">
          {sensors.map((s, i) => (
            <div key={i} className="health-sensor-item">
              <div className="health-sensor-info">
                <span className="health-sensor-category">{s.category}</span>
                <span className="health-sensor-name">{s.name}</span>
              </div>
              <span className={`health-sensor-status ${s.status === 'ON' ? 'on' : 'off'}`}>
                {s.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="health-section">
        <div className="health-section__header">
          <span className="health-section__title">External Data</span>
          <span className="health-section__arrow">▾</span>
        </div>
        <div className="health-external-list">
          {EXTERNAL_DATA.map((d, i) => (
            <div key={i} className="health-external-item">
              <span className="health-external-name">{d.name}</span>
              <span className={`health-external-status ${d.connected ? 'connected' : 'disconnected'}`}>
                {d.connected ? '●' : '○'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="health-report">
        <button className="health-report-btn">Report ▾</button>
      </div>
    </div>
  );
}
