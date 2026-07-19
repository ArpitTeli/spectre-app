import React, { useState, useRef } from 'react';
import aiService from '../ai/aiService';

const RISK_COLORS = {
  LOW:      'var(--color-green)',
  MEDIUM:   'var(--color-yellow)',
  HIGH:     'var(--color-last-known)',
  CRITICAL: 'var(--color-red)'
};

function getProbColor(pct) {
  if (pct >= 70) return 'var(--color-green)';
  if (pct >= 50) return 'var(--color-yellow)';
  return 'var(--color-red)';
}

export default function COAPanel({ coas, selectedCOA, state, patch, addCommsEntry, sendArmaCommand }) {
  const [modifyingId,  setModifyingId]  = useState(null);
  const [modifyInput,  setModifyInput]  = useState('');
  const [steppingCOA,  setSteppingCOA] = useState(null);
  const [stepIndex,    setStepIndex]   = useState(0);
  const [loading,      setLoading]     = useState(false);

  // Phase advancement: track which phase of the selected COA is currently active
  // Use ref for synchronous access in async handlers to avoid race conditions
  const activePhaseIdxRef = useRef(0);
  const [activePhaseIdx, setActivePhaseIdx] = useState(0);
  const syncPhaseIdx = (val) => { activePhaseIdxRef.current = val; setActivePhaseIdx(val); };

  if (!coas || coas.length === 0) return null;

  // ── COA modification ─────────────────────────────────────────────────────
  const handleModify = async (coa) => {
    if (!modifyInput.trim()) return;
    setLoading(true);
    try {
      const ctx = { units: state.units, contacts: state.contacts, forceMetrics: state.forceMetrics, intelDB: state.intelDB };
      const modified = await aiService.modifyCOA(coa, modifyInput, ctx);
      const updated  = coas.map(c => c.id === coa.id ? { ...modified, id: coa.id } : c);
      patch({ currentCOAs: updated });
      setModifyingId(null);
      setModifyInput('');
      if (modified.changes?.length) {
        addCommsEntry('SPECTRE', 'COMMANDER', `COA ${coa.id} modified: ${modified.changes.join(', ')}`, 'BLUE');
      }
    } catch (err) {
      console.error('Modify failed:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Execute a COA (starts at phase 1) ────────────────────────────────────
  const handleExecute = async (coa, phaseIndex = 0) => {
    patch({ selectedCOA: coa, showCOAOverlay: true, showCOAPanel: false });
    syncPhaseIdx(phaseIndex);
    await sendPhaseOrders(coa, phaseIndex);
    addCommsEntry('SPECTRE', 'ALL',
      `Executing COA: ${coa.name}. Phase ${phaseIndex + 1} of ${coa.phases?.length || 1} active.`, 'GREEN');
    // Record decision
    patch(prev => ({
      missionData: {
        ...(prev.missionData || {}),
        decisions: [
          ...((prev.missionData?.decisions) || []),
          { timestamp: Date.now(), coa_selected: coa.id, coa_name: coa.name, phase: phaseIndex + 1 }
        ]
      }
    }));
  };

  // ── Send orders for a specific phase to Arma ──────────────────────────────
  const sendPhaseOrders = async (coa, phaseIdx) => {
    const phase = (coa.phases || [])[phaseIdx];
    if (!phase) return;
    for (const order of (phase.unit_orders || [])) {
      await sendArmaCommand({
        type:             'EXECUTE_ORDER',
        unit_id:          order.unit_id   || order.callsign,
        callsign:         order.callsign,
        action:           order.action,
        waypoints:        order.waypoints || [],
        engagement_rules: order.engagement_rules
      });
      addCommsEntry('SPECTRE', order.callsign || order.unit_id,
        `${order.action}${order.engagement_rules ? ' — ' + order.engagement_rules : ''}`, 'BLUE');
    }
  };

  // ── Advance the active COA to the next phase ──────────────────────────────
  const handleAdvancePhase = async () => {
    if (!selectedCOA) return;
    const phases = selectedCOA.phases || [];
    // Read from ref for synchronous access — avoids stale state on rapid clicks
    const next = activePhaseIdxRef.current + 1;
    if (next >= phases.length) return;
    syncPhaseIdx(next);
    await sendPhaseOrders(selectedCOA, next);
    addCommsEntry('SPECTRE', 'ALL',
      `Phase ${next + 1} of ${phases.length}: ${phases[next].name}. Sending orders.`, 'GREEN');
  };

  // ─── Step-through view ────────────────────────────────────────────────────
  if (steppingCOA) {
    const phases = steppingCOA.phases || [];
    const phase  = phases[stepIndex];
    return (
      <div className="coa-overlay">
        <div className="coa-container" style={{ maxWidth: '700px' }}>
          <div className="coa-container__header">
            <div>
              <div className="coa-container__title">{steppingCOA.name}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                STEP THROUGH — Phase {stepIndex + 1} of {phases.length}
              </div>
            </div>
            <button className="btn" onClick={() => { setSteppingCOA(null); patch({ showCOAOverlay: false }); }}>✕ CLOSE</button>
          </div>

          {phase && (
            <div style={{ padding: '16px' }}>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-accent)', borderRadius: '4px', padding: '14px', marginBottom: '12px' }}>
                <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '16px', fontWeight: 700, color: 'var(--accent-bright)', marginBottom: '8px' }}>
                  PHASE {phase.number || stepIndex + 1}: {phase.name}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', marginLeft: '10px' }}>
                    ~{Math.round((phase.duration_sec || 120) / 60)} min
                  </span>
                </div>
                <div style={{ color: 'var(--text-secondary)', marginBottom: '14px' }}>{phase.description}</div>

                <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: '8px' }}>
                  UNIT ORDERS
                </div>
                {(phase.unit_orders || []).map((order, i) => (
                  <div key={i} style={{
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                    borderLeft: '3px solid var(--color-friendly)', borderRadius: '3px',
                    padding: '8px 12px', marginBottom: '6px'
                  }}>
                    <div style={{ fontFamily: 'var(--font-condensed)', fontWeight: 700, color: 'var(--color-friendly)', marginBottom: '4px' }}>
                      {order.callsign || order.unit_id}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{order.action}</div>
                    {order.engagement_rules && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>ROE: {order.engagement_rules}</div>
                    )}
                    {order.waypoints?.length > 0 && (
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '3px', fontFamily: 'var(--font-mono)' }}>
                        {order.waypoints.map((wp, j) => `WP${j + 1}: ${wp.description || `(${wp.x},${wp.y})`}`).join(' → ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn" onClick={() => setStepIndex(Math.max(0, stepIndex - 1))} disabled={stepIndex === 0}>
                  ◀ PREV
                </button>
                {stepIndex < phases.length - 1 ? (
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStepIndex(stepIndex + 1)}>
                    NEXT PHASE ▶
                  </button>
                ) : (
                  <button className="btn btn-success" style={{ flex: 1 }} onClick={() => {
                    setSteppingCOA(null);
                    handleExecute(steppingCOA, 0);
                  }}>
                    ⚡ EXECUTE — START PHASE 1
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Phase advancement bar (shown when a COA is active, panel reopened) ──
  const PhaseBar = () => {
    if (!selectedCOA || !state.showCOAOverlay) return null;
    const phases     = selectedCOA.phases || [];
    const isLastPhase = activePhaseIdx >= phases.length - 1;
    if (phases.length <= 1) return null;

    return (
      <div style={{
        margin: '0 0 16px', padding: '12px 14px',
        background: 'rgba(13,127,204,0.08)', border: '1px solid var(--border-accent)',
        borderRadius: '4px'
      }}>
        <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '2px', marginBottom: '8px' }}>
          ACTIVE COA: {selectedCOA.name}
        </div>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
          {phases.map((ph, i) => (
            <div key={i} style={{
              flex: 1, height: '6px', borderRadius: '3px',
              background: i < activePhaseIdx ? 'var(--color-green)'
                : i === activePhaseIdx ? 'var(--accent-bright)'
                : 'var(--bg-tertiary)',
              transition: 'background 0.3s'
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
            Phase {activePhaseIdx + 1}/{phases.length}: {phases[activePhaseIdx]?.name}
          </span>
          {!isLastPhase && (
            <button className="btn btn-primary" style={{ fontSize: '11px' }} onClick={handleAdvancePhase}>
              ▶ ADVANCE TO PHASE {activePhaseIdx + 2}
            </button>
          )}
          {isLastPhase && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-green)' }}>
              ✓ Final phase active
            </span>
          )}
        </div>
      </div>
    );
  };

  // ─── Main COA selection view ──────────────────────────────────────────────
  return (
    <div className="coa-overlay">
      <div className="coa-container">
        <div className="coa-container__header">
          <div>
            <div className="coa-container__title">Courses of Action</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
              SELECT AND EXECUTE A COURSE OF ACTION
            </div>
          </div>
          <button className="btn" onClick={() => patch({ showCOAPanel: false })}>✕ CLOSE</button>
        </div>

        <div style={{ padding: '0 16px' }}>
          <PhaseBar />
        </div>

        <div className="coa-cards">
          {coas.map(coa => (
            <div key={coa.id}
              className={`coa-card ${selectedCOA?.id === coa.id ? 'selected' : ''} ${coa.recommended ? 'recommended' : ''}`}>
              <div className="coa-card__header">
                <div>
                  <div className="coa-card__name">COA {coa.id}: {coa.name}</div>
                  {coa.recommended && (
                    <div style={{ fontSize: '10px', color: 'var(--color-green)', marginTop: '3px' }}>★ RECOMMENDED</div>
                  )}
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: RISK_COLORS[coa.risk_level] || 'var(--text-muted)' }}>
                  {coa.risk_level}
                </span>
              </div>

              <div className="coa-card__body">
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.5 }}>
                  {coa.summary}
                </div>

                {/* Success probability */}
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span className="coa-stat-row__label">SUCCESS PROBABILITY</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '15px', fontWeight: 'bold', color: getProbColor(coa.success_probability) }}>
                      {coa.success_probability}%
                    </span>
                  </div>
                  <div className="coa-prob-bar">
                    <div className="coa-prob-bar__track">
                      <div className="coa-prob-bar__fill"
                        style={{ width: `${coa.success_probability}%`, background: getProbColor(coa.success_probability) }} />
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <StatRow label="TIME ESTIMATE"
                    value={`${coa.time_estimate_min?.min}-${coa.time_estimate_min?.max} min`} />
                  <StatRow label="VEHICLES AT RISK"
                    value={`${coa.casualties?.vehicles_lost?.min}-${coa.casualties?.vehicles_lost?.max} (${coa.casualties?.vehicles_lost?.probability_pct}%)`}
                    danger={(coa.casualties?.vehicles_lost?.probability_pct || 0) > 40} />
                  <StatRow label="CREW CASUALTIES"
                    value={`${coa.casualties?.crew_casualties?.min}-${coa.casualties?.crew_casualties?.max} (${coa.casualties?.crew_casualties?.probability_pct}%)`}
                    danger={(coa.casualties?.crew_casualties?.probability_pct || 0) > 30} />
                </div>

                {/* Risk factors */}
                {coa.risk_factors?.length > 0 && (
                  <div className="coa-risk-factors">
                    <div className="coa-section-title">Risk Factors</div>
                    {coa.risk_factors.map((r, i) => <div key={i} className="coa-risk-item">{r}</div>)}
                  </div>
                )}

                {/* Phases */}
                <div className="coa-phases" style={{ marginTop: '10px' }}>
                  <div className="coa-section-title">Phases ({coa.phases?.length || 0})</div>
                  {(coa.phases || []).map((ph, i) => (
                    <div key={i} className="coa-phase-item">
                      <b style={{ color: 'var(--text-primary)' }}>Phase {ph.number || i + 1}: {ph.name}</b>
                      <br />{ph.description}
                      <span style={{ color: 'var(--text-muted)', marginLeft: '6px', fontSize: '10px' }}>
                        ~{Math.round((ph.duration_sec || 120) / 60)}min
                      </span>
                    </div>
                  ))}
                </div>

                {/* Modify input */}
                {modifyingId === coa.id && (
                  <div className="modify-area" style={{ margin: '8px -14px -12px', borderRadius: '0 0 3px 3px' }}>
                    <input
                      className="modify-input"
                      placeholder="Describe your modification (e.g. use Alpha-1 for the flank instead)"
                      value={modifyInput}
                      onChange={e => setModifyInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleModify(coa)}
                      autoFocus
                    />
                    <button className="btn btn-primary" onClick={() => handleModify(coa)} disabled={loading}>
                      {loading ? '⟳' : 'APPLY'}
                    </button>
                    <button className="btn" onClick={() => setModifyingId(null)}>✕</button>
                  </div>
                )}
              </div>

              <div className="coa-card__footer">
                <button className="btn" style={{ fontSize: '11px' }} onClick={() => {
                  setSteppingCOA(coa);
                  setStepIndex(0);
                  patch({ selectedCOA: coa, showCOAOverlay: true });
                }}>
                  ▷ STEP THROUGH
                </button>
                <button className="btn" style={{ fontSize: '11px' }}
                  onClick={() => { setModifyingId(modifyingId === coa.id ? null : coa.id); setModifyInput(''); }}>
                  ✎ MODIFY
                </button>
                <button className="btn btn-success" style={{ flex: 1, fontSize: '11px' }}
                  onClick={() => handleExecute(coa, 0)}>
                  ⚡ EXECUTE
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, danger }) {
  return (
    <div className="coa-stat-row">
      <span className="coa-stat-row__label">{label}</span>
      <span className="coa-stat-row__value" style={{ color: danger ? 'var(--color-yellow)' : 'var(--text-bright)' }}>
        {value}
      </span>
    </div>
  );
}
