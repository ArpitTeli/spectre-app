import React, { useState } from 'react';

export default function RightPanel({ state, patch, sendArmaCommand, addCommsEntry, selectedUnit }) {
  const [activeTab, setActiveTab] = useState('STATUS');

  const forceMetrics = state.forceMetrics || { firepower_index: 0, vehicles_active: 0, vehicles_total: 0, mobility: 'UNKNOWN' };
  const rewardData = state.rewardData || { score: 0, friendly_kia: 0, enemy_kills: 0 };
  const missionPhase = state.missionPhase || 'BRIEFING';

  return (
    <div className="right-panel">
      <div className="right-panel__tabs">
        <button
          className={`right-panel__tab ${activeTab === 'STATUS' ? 'active' : ''}`}
          onClick={() => setActiveTab('STATUS')}
        >
          Status
        </button>
        <button
          className={`right-panel__tab ${activeTab === 'UNIT' ? 'active' : ''}`}
          onClick={() => setActiveTab('UNIT')}
        >
          Unit Detail
        </button>
      </div>

      <div className="right-panel__content">
        {activeTab === 'STATUS' && (
          <StatusTab
            forceMetrics={forceMetrics}
            rewardData={rewardData}
            missionPhase={missionPhase}
            state={state}
            patch={patch}
            sendArmaCommand={sendArmaCommand}
            addCommsEntry={addCommsEntry}
          />
        )}
        {activeTab === 'UNIT' && (
          <UnitDetailTab
            unit={selectedUnit}
            state={state}
            sendArmaCommand={sendArmaCommand}
            addCommsEntry={addCommsEntry}
          />
        )}
      </div>
    </div>
  );
}

function StatusTab({ forceMetrics, rewardData, missionPhase, state, patch, sendArmaCommand, addCommsEntry }) {
  const CMDS = [
    { label: 'ALL HOLD', type: 'HOLD_ALL' },
    { label: 'ALL RTB', type: 'RTB_ALL' },
    { label: 'WEAPONS FREE', type: 'WEAPONS_FREE' },
    { label: 'WEAPONS SAFE', type: 'WEAPONS_SAFE' },
    { label: 'FORM UP', type: 'FORM_UP' },
    { label: 'DISPERSE', type: 'DISPERSE' },
  ];

  return (
    <div className="right-status">
      <div className="health-stats-row">
        <div className="health-stat-box">
          <div className="health-stat-value" style={{ color: forceMetrics.firepower_index < 50 ? 'var(--red)' : forceMetrics.firepower_index < 70 ? 'var(--yellow)' : 'var(--accent)' }}>
            {forceMetrics.firepower_index}%
          </div>
          <div className="health-stat-label">FP</div>
        </div>
        <div className="health-stat-box">
          <div className="health-stat-value">
            {forceMetrics.vehicles_active}<span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>/{forceMetrics.vehicles_total}</span>
          </div>
          <div className="health-stat-label">VEHICLES</div>
        </div>
        <div className="health-stat-box">
          <div className="health-stat-value" style={{ color: forceMetrics.mobility === 'LOW' ? 'var(--red)' : 'var(--accent)' }}>
            {forceMetrics.mobility}
          </div>
          <div className="health-stat-label">MOBILITY</div>
        </div>
      </div>

      <div className="health-stats-row" style={{ borderBottom: '1px solid var(--border-hairline)' }}>
        <div className="health-stat-box">
          <div className="health-stat-value" style={{ color: rewardData.score >= 0 ? 'var(--accent)' : 'var(--red)' }}>
            {rewardData.score.toFixed(0)}
          </div>
          <div className="health-stat-label">SCORE</div>
        </div>
        <div className="health-stat-box">
          <div className="health-stat-value" style={{ color: 'var(--red)' }}>
            {rewardData.friendly_kia || 0}
          </div>
          <div className="health-stat-label">KIA</div>
        </div>
        <div className="health-stat-box">
          <div className="health-stat-value" style={{ color: 'var(--green)' }}>
            {rewardData.enemy_kills || 0}
          </div>
          <div className="health-stat-label">KILLS</div>
        </div>
      </div>

      <div className="health-section">
        <div className="health-section__header">
          <span className="health-section__title">Mission Controls</span>
        </div>
        <div style={{ padding: '0 12px 8px', display: 'flex', gap: '4px' }}>
          {missionPhase === 'BRIEFING' && (
            <>
              <button className="tasks-action-btn" style={{ flex: 1 }} onClick={() => patch({ missionPhase: 'PLANNING' })}>PLAN</button>
              <button className="tasks-action-btn primary" style={{ flex: 1 }} onClick={() => {
                patch({ missionPhase: 'ACTIVE', missionStartTime: Date.now() });
                addCommsEntry('SPECTRE', 'ALL', 'Mission GO. Execute.', 'GREEN');
              }}>EXEC</button>
            </>
          )}
          {missionPhase === 'PLANNING' && (
            <button className="tasks-action-btn primary" style={{ flex: 1 }} onClick={() => addCommsEntry('SPECTRE', 'ALL', 'Planning phase.', 'BLUE')}>PLAN</button>
          )}
          {missionPhase === 'ACTIVE' && (
            <>
              <button className="tasks-action-btn" style={{ flex: 1 }} onClick={() => patch({ showCOAPanel: true })}>COA</button>
              <button className="tasks-action-btn primary" style={{ flex: 1 }} onClick={() => {
                patch({ showAAR: true, missionPhase: 'AAR' });
                addCommsEntry('SPECTRE', 'ALL', 'Mission complete. AAR.', 'GREEN');
              }}>OBJ</button>
              <button className="tasks-action-btn danger" style={{ flex: 1 }} onClick={() => {
                patch({ missionPhase: 'ABORTING', abortState: { countdown: 30, auto_select: 'CONTINUE' } });
                addCommsEntry('SPECTRE', 'ALL', 'Emergency abort initiated.', 'RED');
              }}>END</button>
            </>
          )}
        </div>
      </div>

      <div className="health-section">
        <div className="health-section__header">
          <span className="health-section__title">All Units</span>
        </div>
        <div style={{ padding: '0 12px 8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
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

      <div className="health-section">
        <div className="health-section__header">
          <span className="health-section__title">Settings</span>
        </div>
        <div style={{ padding: '0 12px 8px' }}>
          <button className="tasks-action-btn" style={{ width: '100%' }} onClick={() => patch({ showSettings: true })}>
            ⚙ Configuration
          </button>
        </div>
      </div>
    </div>
  );
}

function UnitDetailTab({ unit, state, sendArmaCommand, addCommsEntry }) {
  if (!unit) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div style={{ fontSize: '24px', marginBottom: '8px', color: 'var(--text-muted)' }}>◎</div>
        <div>Select a unit to view details</div>
      </div>
    );
  }

  const hp = unit.health ?? 100;
  const fuel = unit.fuel ?? 100;
  const speed = unit.speed ?? 0;
  const dead = unit.status === 'DESTROYED' || unit.status === 'DEAD';
  const isVehicle = !unit.vehicle;
  const crew = Object.values(state.units || {}).filter(u => u.vehicle === unit.id);

  const send = async (type, params = {}) => {
    await sendArmaCommand({ type, unit_id: unit.id, ...params });
    addCommsEntry('SPECTRE', unit.callsign, `${type}${params.instruction ? ': ' + params.instruction : ''}`, 'BLUE');
  };

  return (
    <div className="right-unit-detail">
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-hairline)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
          {unit.callsign || unit.id}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {unit.vehicle_type || 'Unknown'} · {unit.status || 'UNKNOWN'}
        </div>
      </div>

      <div className="health-stats-row">
        <div className="health-stat-box">
          <div className="health-stat-value" style={{ color: hp > 60 ? 'var(--accent)' : hp > 30 ? 'var(--yellow)' : 'var(--red)' }}>
            {hp}%
          </div>
          <div className="health-stat-label">HEALTH</div>
        </div>
        {isVehicle && (
          <>
            <div className="health-stat-box">
              <div className="health-stat-value">{fuel}%</div>
              <div className="health-stat-label">FUEL</div>
            </div>
            <div className="health-stat-box">
              <div className="health-stat-value">{speed}</div>
              <div className="health-stat-label">KM/H</div>
            </div>
          </>
        )}
      </div>

      {isVehicle && (
        <div className="health-section">
          <div className="health-section__header">
            <span className="health-section__title">Bars</span>
          </div>
          <div style={{ padding: '0 12px 8px' }}>
            <div className="unit-bar" style={{ marginBottom: '4px' }}>
              <span className="unit-bar__label">HP</span>
              <div className="unit-bar__track">
                <div className={`unit-bar__fill health ${hp < 30 ? 'critical' : hp < 60 ? 'low' : ''}`} style={{ width: `${hp}%` }} />
              </div>
              <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>{hp}%</span>
            </div>
            <div className="unit-bar" style={{ marginBottom: '4px' }}>
              <span className="unit-bar__label">FUEL</span>
              <div className="unit-bar__track">
                <div className="unit-bar__fill fuel" style={{ width: `${fuel}%` }} />
              </div>
              <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>{fuel}%</span>
            </div>
          </div>
        </div>
      )}

      {unit.current_order && (
        <div className="health-section">
          <div className="health-section__header">
            <span className="health-section__title">Current Order</span>
          </div>
          <div style={{ padding: '0 12px 8px', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-secondary)' }}>
            ▸ {unit.current_order}
          </div>
        </div>
      )}

      {crew.length > 0 && (
        <div className="health-section">
          <div className="health-section__header">
            <span className="health-section__title">Crew ({crew.length})</span>
          </div>
          <div style={{ padding: '0 12px 8px' }}>
            {crew.map(c => (
              <div key={c.id} style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-secondary)', padding: '2px 0' }}>
                {c.callsign || c.id} · {c.vehicle_role || 'CARGO'}
              </div>
            ))}
          </div>
        </div>
      )}

      {unit.vehicle && (
        <div className="health-section">
          <div className="health-section__header">
            <span className="health-section__title">Embedded In</span>
          </div>
          <div style={{ padding: '0 12px 8px', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--accent)' }}>
            {unit.vehicle} ({unit.vehicle_role || 'CARGO'})
          </div>
        </div>
      )}

      {!dead && (
        <div className="health-section">
          <div className="health-section__header">
            <span className="health-section__title">Quick Actions</span>
          </div>
          <div style={{ padding: '0 12px 8px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            <button className="tasks-cmd-btn" onClick={() => send('HOLD')}>HOLD</button>
            <button className="tasks-cmd-btn" onClick={() => send('RTB')}>RTB</button>
            <button className="tasks-cmd-btn primary" onClick={() => send('WEAPONS_FREE')}>WEAPONS FREE</button>
            <button className="tasks-cmd-btn" onClick={() => send('WEAPONS_SAFE')}>WEAPONS SAFE</button>
            <button className="tasks-cmd-btn" onClick={() => send('FORM_UP')}>FORM UP</button>
            <button className="tasks-cmd-btn danger" onClick={() => send('DISPERSE')}>DISPERSE</button>
          </div>
        </div>
      )}
    </div>
  );
}
