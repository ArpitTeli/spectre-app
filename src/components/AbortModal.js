import React from 'react';

const RISK_COLORS = {
  LOW: 'var(--color-green)',
  MEDIUM: 'var(--color-yellow)',
  HIGH: 'var(--color-last-known)',
  CRITICAL: 'var(--color-red)'
};

export default function AbortModal({ abortState, forceMetrics, rewardData, onChoice }) {
  if (!abortState) return null;

  const { countdown, options, assessment, auto_select } = abortState;
  const pct = (countdown / 30) * 100;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
    }}>
      <div style={{
        background: 'var(--bg-panel)', border: '2px solid var(--color-red)',
        borderRadius: '6px', width: '100%', maxWidth: '620px',
        boxShadow: '0 0 40px rgba(255,68,68,0.3)'
      }}>
        {/* Header */}
        <div style={{
          background: 'rgba(255,68,68,0.15)', borderBottom: '1px solid var(--color-red)',
          padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px'
        }}>
          <span style={{ fontSize: '22px' }}>⚠</span>
          <div>
            <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '18px', fontWeight: 700, color: 'var(--color-red)', letterSpacing: '2px' }}>
              EMERGENCY — MISSION ABORT RECOMMENDED
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
              SPECTRE has detected critical force degradation
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 20px' }}>
          {/* Situation */}
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
            borderLeft: '3px solid var(--color-red)', borderRadius: '3px',
            padding: '10px 14px', marginBottom: '14px'
          }}>
            <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: '6px' }}>
              SITUATION ASSESSMENT
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {assessment}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '10px' }}>
              <Stat label="FIREPOWER" value={`${forceMetrics.firepower_index}%`} danger={forceMetrics.firepower_index < 50} />
              <Stat label="VEHICLES" value={`${forceMetrics.vehicles_active}/${forceMetrics.vehicles_total}`} danger={forceMetrics.vehicles_active < forceMetrics.vehicles_total / 2} />
              <Stat label="CREW KIA" value={rewardData.friendly_kia} danger={rewardData.friendly_kia > 0} />
            </div>
          </div>

          {/* Options */}
          <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: '8px' }}>
            EMERGENCY OPTIONS
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
            {options.map(opt => (
              <button key={opt.id}
                onClick={() => onChoice(opt.id)}
                style={{
                  background: opt.id === auto_select ? 'rgba(13,127,204,0.1)' : 'var(--bg-secondary)',
                  border: `1px solid ${opt.id === auto_select ? 'var(--accent-bright)' : 'var(--border-primary)'}`,
                  borderLeft: `4px solid ${RISK_COLORS[opt.risk] || 'var(--text-muted)'}`,
                  borderRadius: '3px', padding: '10px 14px', cursor: 'pointer',
                  textAlign: 'left', transition: 'all 0.15s', color: 'inherit'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-condensed)', fontSize: '14px', fontWeight: 700, color: 'var(--text-bright)' }}>
                    {opt.label}
                    {opt.id === auto_select && <span style={{ marginLeft: '8px', fontSize: '10px', color: 'var(--accent-bright)', fontWeight: 400 }}>AUTO-SELECT</span>}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {opt.success_pct !== undefined && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: opt.success_pct > 60 ? 'var(--color-green)' : opt.success_pct > 30 ? 'var(--color-yellow)' : 'var(--color-red)', fontWeight: 'bold' }}>
                        {opt.success_pct}%
                      </span>
                    )}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: RISK_COLORS[opt.risk], border: `1px solid ${RISK_COLORS[opt.risk]}`, padding: '1px 6px', borderRadius: '2px' }}>
                      {opt.risk}
                    </span>
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {opt.description}
                </div>
              </button>
            ))}
          </div>

          {/* Countdown */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Auto-selecting FIGHTING WITHDRAWAL in</span>
              <span style={{ color: countdown <= 10 ? 'var(--color-red)' : 'var(--color-yellow)', fontWeight: 'bold' }}>{countdown}s</span>
            </div>
            <div style={{ height: '4px', background: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '2px',
                width: `${pct}%`,
                background: countdown <= 10 ? 'var(--color-red)' : 'var(--color-yellow)',
                transition: 'width 1s linear'
              }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, danger }) {
  return (
    <div style={{ background: 'var(--bg-tertiary)', borderRadius: '3px', padding: '6px 8px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 'bold', color: danger ? 'var(--color-red)' : 'var(--text-bright)' }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: '2px' }}>{label}</div>
    </div>
  );
}
