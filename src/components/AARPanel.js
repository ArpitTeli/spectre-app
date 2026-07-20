import React, { useState } from 'react';

export default function AARPanel({ aar, rewardData, onClose, onNewMission }) {
  const [tab, setTab] = useState('SUMMARY');

  if (!aar) return null;

  const scoreColor = rewardData.score >= 70 ? 'var(--accent)' : rewardData.score >= 40 ? 'var(--color-yellow)' : 'var(--color-red)';
  const scoreLetter = rewardData.score >= 80 ? 'S' : rewardData.score >= 60 ? 'A' : rewardData.score >= 40 ? 'B' : rewardData.score >= 20 ? 'C' : 'F';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
    }}>
      <div style={{
        background: 'var(--bg-panel)', border: '1px solid var(--border-accent)',
        borderRadius: '4px', width: '100%', maxWidth: '860px', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border-primary)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '20px', fontWeight: 700, letterSpacing: '4px', color: 'var(--text-bright)' }}>
              AFTER ACTION REVIEW
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
              {aar.mission_name} · {aar.duration_formatted}
            </div>
          </div>

          {/* Score box */}
          <div style={{ textAlign: 'center', background: 'var(--bg-secondary)', border: `2px solid ${scoreColor}`, borderRadius: '4px', padding: '8px 16px' }}>
            <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '36px', fontWeight: 900, color: scoreColor, lineHeight: 1 }}>{scoreLetter}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: scoreColor, marginTop: '2px' }}>{rewardData.score.toFixed(0)} pts</div>
            <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '1px', marginTop: '2px' }}>OVERALL</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-primary)', flexShrink: 0 }}>
          {['SUMMARY', 'DECISIONS', 'ANALYSIS', 'TRAINING DATA'].map(t => (
            <button key={t} className={`side-panel__tab ${tab === t ? 'active' : ''}`}
              style={{ flex: 'none', padding: '8px 16px', fontSize: '11px' }}
              onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {tab === 'SUMMARY' && <SummaryTab aar={aar} rewardData={rewardData} scoreColor={scoreColor} />}
          {tab === 'DECISIONS' && <DecisionsTab aar={aar} />}
          {tab === 'ANALYSIS' && <AnalysisTab aar={aar} />}
          {tab === 'TRAINING DATA' && <TrainingDataTab rewardData={rewardData} />}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-primary)', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <div style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>✓</span> Mission data saved to training dataset
          </div>
          <button className="btn" onClick={onClose}>CLOSE</button>
          <button className="btn btn-primary" onClick={onNewMission}>▶ NEW MISSION</button>
        </div>
      </div>
    </div>
  );
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────
function SummaryTab({ aar, rewardData, scoreColor }) {
  const outcome = aar.outcome_summary || {};
  return (
    <div>
      {/* Outcome grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        <OutcomeBox label="OBJECTIVE" value={outcome.objective_captured ? '✓ CAPTURED' : '✗ FAILED'} good={outcome.objective_captured} />
        <OutcomeBox label="ENEMY KIA" value={rewardData.enemy_kills} neutral />
        <OutcomeBox label="FRIENDLY KIA" value={rewardData.friendly_kia} bad={rewardData.friendly_kia > 0} />
        <OutcomeBox label="VEHICLES LOST" value={rewardData.vehicles_lost} bad={rewardData.vehicles_lost > 0} />
      </div>

      {/* Reward breakdown */}
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '4px', padding: '12px 14px', marginBottom: '16px' }}>
        <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: '10px' }}>
          SCORE BREAKDOWN
        </div>
        <ScoreLine label="Objective captured" value={outcome.objective_captured ? '+50' : '0'} positive={outcome.objective_captured} />
        <ScoreLine label={`Enemy eliminated (${rewardData.enemy_kills})`} value={`+${rewardData.enemy_kills * 3}`} positive />
        <ScoreLine label={`Friendly KIA (${rewardData.friendly_kia})`} value={rewardData.friendly_kia > 0 ? `-${rewardData.friendly_kia * 15}` : '0'} negative={rewardData.friendly_kia > 0} />
        <ScoreLine label={`Vehicles lost (${rewardData.vehicles_lost})`} value={rewardData.vehicles_lost > 0 ? `-${rewardData.vehicles_lost * 20}` : '0'} negative={rewardData.vehicles_lost > 0} />
        <div style={{ borderTop: '1px solid var(--border-primary)', marginTop: '6px', paddingTop: '6px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-condensed)', fontWeight: 700, color: 'var(--text-bright)' }}>TOTAL</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 'bold', color: scoreColor }}>{rewardData.score.toFixed(0)}</span>
        </div>
      </div>

      {/* What went well / wrong */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <ListBox title="WHAT WENT WELL" items={aar.what_went_well || []} color="var(--accent)" icon="✓" />
        <ListBox title="WHAT WENT WRONG" items={aar.what_went_wrong || []} color="var(--color-red)" icon="✗" />
      </div>
    </div>
  );
}

// ─── Decisions Tab ────────────────────────────────────────────────────────────
function DecisionsTab({ aar }) {
  const decisions = aar.key_decision_points || [];
  if (decisions.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '20px', textAlign: 'center' }}>No key decision points recorded.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {decisions.map((d, i) => (
        <div key={i} style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
          borderRadius: '4px', padding: '12px 14px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontFamily: 'var(--font-condensed)', fontSize: '14px', fontWeight: 700, color: 'var(--text-bright)' }}>{d.event}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>{d.timestamp}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '8px' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: '3px' }}>DECISION MADE</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-primary)' }}>{d.decision_made}</div>
            </div>
            {d.better_alternative && (
              <div>
                <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '10px', color: 'var(--color-yellow)', letterSpacing: '1px', marginBottom: '3px' }}>BETTER ALTERNATIVE</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-secondary)' }}>{d.better_alternative}</div>
              </div>
            )}
          </div>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-secondary)',
            background: 'var(--bg-tertiary)', borderRadius: '3px', padding: '8px 10px',
            borderLeft: '3px solid var(--accent-primary)'
          }}>
            {d.assessment}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Analysis Tab ─────────────────────────────────────────────────────────────
function AnalysisTab({ aar }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {aar.recommendations && (
        <Section title="SPECTRE RECOMMENDATIONS">
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.6 }}>
            {aar.recommendations}
          </div>
        </Section>
      )}
      {aar.training_notes && (
        <Section title="TRAINING NOTES">
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {aar.training_notes}
          </div>
        </Section>
      )}
      {(aar.intelligence_updates || []).length > 0 && (
        <Section title="INTELLIGENCE UPDATES">
          {aar.intelligence_updates.map((u, i) => (
            <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent)', padding: '3px 0' }}>
              ✓ Intel updated: {u.type} — {JSON.stringify(u.data).slice(0, 80)}...
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

// ─── Training Data Tab ────────────────────────────────────────────────────────
function TrainingDataTab({ rewardData }) {
  const sample = {
    reward_score: rewardData.score.toFixed(1),
    objective_complete: rewardData.objective_complete,
    enemy_kills: rewardData.enemy_kills,
    friendly_kia: rewardData.friendly_kia,
    vehicles_lost: rewardData.vehicles_lost,
    timestamp: new Date().toISOString()
  };

  return (
    <div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.6 }}>
        This mission has been saved to your training dataset. Over time, these records will be used to fine-tune a specialized tactical reasoning model that improves SPECTRE's COA quality.
      </div>

      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '4px', padding: '12px 14px', marginBottom: '12px' }}>
        <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: '8px' }}>REWARD RECORD (PREVIEW)</div>
        <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent)', margin: 0, lineHeight: 1.6 }}>
          {JSON.stringify(sample, null, 2)}
        </pre>
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.8 }}>
        Full record saved to:<br />
        <span style={{ color: 'var(--accent-bright)' }}>%LOCALAPPDATA%\spectre-arma\missions\mission_{'{timestamp}'}.json</span>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function OutcomeBox({ label, value, good, bad, neutral }) {
  const color = good ? 'var(--accent)' : bad ? 'var(--color-red)' : 'var(--text-bright)';
  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '4px', padding: '10px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 'bold', color }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: '3px' }}>{label}</div>
    </div>
  );
}

function ScoreLine({ label, value, positive, negative }) {
  const color = positive ? 'var(--accent)' : negative ? 'var(--color-red)' : 'var(--text-secondary)';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border-primary)' }}>
      <span style={{ fontFamily: 'var(--font-condensed)', fontSize: '12px', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color, fontWeight: 'bold' }}>{value}</span>
    </div>
  );
}

function ListBox({ title, items, color, icon }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '4px', padding: '10px 12px' }}>
      <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 700, color, letterSpacing: '2px', marginBottom: '8px' }}>{title}</div>
      {items.length === 0
        ? <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>None recorded.</div>
        : items.map((item, i) => (
          <div key={i} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-secondary)', padding: '3px 0', paddingLeft: '14px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: 0, color }}>{icon}</span>
            {item}
          </div>
        ))}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '4px', padding: '12px 14px' }}>
      <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: '10px' }}>{title}</div>
      {children}
    </div>
  );
}
