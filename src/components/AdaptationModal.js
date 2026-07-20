import React from 'react';

export default function AdaptationModal({ adaptation, onAccept, onDismiss, onShowNewCOAs }) {
  if (!adaptation) return null;

  const severityColors = { MINOR: 'var(--color-yellow)', MAJOR: 'var(--color-last-known)', CRITICAL: 'var(--color-red)' };
  const color = severityColors[adaptation.severity] || 'var(--color-yellow)';

  return (
    <div style={{
      position: 'fixed', bottom: '40px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 400, width: '540px',
      background: 'var(--bg-panel)', border: `1px solid ${color}`,
      borderRadius: '4px'
    }}>
      {/* Header */}
      <div style={{
        background: `${color}18`, borderBottom: `1px solid ${color}55`,
        padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
          <div>
            <span style={{ fontFamily: 'var(--font-condensed)', fontSize: '14px', fontWeight: 700, color, letterSpacing: '1px' }}>
              SPECTRE ADAPTATION — {adaptation.severity}
            </span>
          </div>
        </div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}>✕</button>
      </div>

      <div style={{ padding: '12px 14px' }}>
        {/* Assessment */}
        <div style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: '10px' }}>
          {adaptation.assessment}
        </div>

        {/* Recommended action */}
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
          borderLeft: `3px solid ${color}`, borderRadius: '3px',
          padding: '8px 12px', marginBottom: '10px'
        }}>
          <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: '4px' }}>
            RECOMMENDED ACTION
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-bright)' }}>
            {adaptation.recommended_action}
          </div>
        </div>

        {/* Modified orders preview */}
        {adaptation.modified_orders?.length > 0 && (
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: '6px' }}>
              UNIT ORDER CHANGES
            </div>
            {adaptation.modified_orders.map((o, i) => (
              <div key={i} style={{
                fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)',
                padding: '3px 0', borderBottom: '1px solid var(--border-primary)'
              }}>
                <span style={{ color: 'var(--color-friendly)' }}>{o.unit_id}</span>
                <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>→</span>
                {o.new_action}
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-success" style={{ flex: 1, fontSize: '11px' }} onClick={onAccept}>
            ACCEPT & EXECUTE
          </button>
          {adaptation.new_coas && (
            <button className="btn btn-primary" style={{ flex: 1, fontSize: '11px' }} onClick={onShowNewCOAs}>
              VIEW NEW COAs
            </button>
          )}
          <button className="btn" style={{ fontSize: '11px' }} onClick={onDismiss}>
            IGNORE
          </button>
        </div>
      </div>
    </div>
  );
}
