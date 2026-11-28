import React, { useEffect, useState } from 'react';
import { Button, Divider, Tag } from '@blueprintjs/core';
import PairModal from './PairModal';

function formatTime(sec) {
  const s = Number.isFinite(sec) ? sec : 0;
  const part = (v) => String(v).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return `${h ? `${part(h)}:` : ''}${part(Math.floor((s % 3600) / 60))}:${part(s % 60)}`;
}

const PHASES = {
  BRIEFING: 'Briefing', PLANNING: 'Planning', ACTIVE: 'Mission active', ABORTING: 'Emergency', AAR: 'After action review',
};

const ABORT_STATE = {
  tier: 1,
  reason: 'Commander-initiated emergency abort.',
  countdown: 30,
  options: [
    { id: 'WITHDRAW', label: 'FIGHTING WITHDRAWAL', description: 'Suppress and disengage to nearest safe position', success_pct: 82, risk: 'LOW' },
    { id: 'CONSOLIDATE', label: 'CONSOLIDATE & HOLD', description: 'Defensive perimeter, await situation change', success_pct: 61, risk: 'MEDIUM' },
    { id: 'CONTINUE', label: 'CONTINUE ASSAULT', description: '⚠ HIGH RISK — not recommended at current strength', success_pct: 12, risk: 'CRITICAL' },
  ],
  assessment: 'Commander-initiated emergency abort.',
  auto_select: 'CONTINUE',
};

function MissionControls({ phase, elapsed, patch, addCommsEntry, endMission }) {
  const start = () => {
    patch({ missionPhase: 'ACTIVE', missionStartTime: Date.now() });
    addCommsEntry('SPECTRE', 'ALL', 'Mission GO. Execute.', 'GREEN');
  };
  const complete = () => {
    patch({ missionPhase: 'AAR' });
    addCommsEntry('SPECTRE', 'ALL', 'Mission complete. Generating AAR...', 'GREEN');
    endMission?.(true);
  };
  const abort = () => {
    patch({ missionPhase: 'ABORTING', abortState: { ...ABORT_STATE } });
    addCommsEntry('SPECTRE', 'ALL', 'Emergency abort initiated.', 'RED');
  };

  return (
    <div className="mission">
      <span className={`mission__phase${phase === 'ABORTING' ? ' tone-bad' : ''}`}>{PHASES[phase] || 'Standby'}</span>
      {phase === 'ACTIVE' && <span className="mission__timer">T+{formatTime(elapsed)}</span>}
      {phase === 'BRIEFING' && (
        <>
          <Button small text="Plan" onClick={() => patch({ missionPhase: 'PLANNING' })} />
          <Button small intent="primary" text="Execute" onClick={start} />
        </>
      )}
      {phase === 'ACTIVE' && (
        <>
          <Button small text="COAs" title="Courses of action" onClick={() => patch({ showCOAPanel: true })} />
          <Button small intent="primary" text="Complete" title="Objective complete" onClick={complete} />
          <Button small intent="danger" outlined text="Abort" onClick={abort} />
        </>
      )}
    </div>
  );
}

function linkStatus({ mode, armaConnected, relayError, relayConnecting }) {
  if (mode !== 'client') {
    return armaConnected ? { intent: 'success', text: 'Arma linked' } : { intent: 'danger', text: 'Waiting for Arma' };
  }
  if (relayError) return { intent: 'danger', text: relayError };
  if (relayConnecting) return { intent: 'warning', text: 'Connecting' };
  return armaConnected ? { intent: 'success', text: 'Host linked' } : { intent: 'danger', text: 'No host' };
}

export default function TopBar({
  state, patch, addCommsEntry, endMission, armaConnected, mode, roomCode, relayStatus, onSwitchMode,
}) {
  const [pairing, setPairing] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const force = state.forceMetrics || {};
  const reward = state.rewardData || {};
  const fp = force.firepower_index ?? 100;
  const link = linkStatus({ mode, armaConnected, relayError: relayStatus.error, relayConnecting: relayStatus.connecting });
  const webUrl = state.bridgePaths?.web_viewer_url;
  const scored = state.missionPhase === 'ACTIVE' || reward.score || reward.enemy_kills || reward.friendly_kia;
  const roomNote = roomCode
    ? `Room ${roomCode}${relayStatus.clients > 0 ? ` · ${relayStatus.clients} viewing` : ''}`
    : '';

  return (
    <header className="topbar">
      <span className="topbar__brand">SPECTRE</span>
      {onSwitchMode && (
        <Button small minimal rightIcon="swap-horizontal" text={mode === 'client' ? 'Command' : 'Host'} title={`Switch mode. ${roomNote}`} onClick={onSwitchMode} />
      )}
      <Divider />
      <MissionControls
        phase={state.missionPhase}
        elapsed={state.missionElapsedSec}
        patch={patch}
        addCommsEntry={addCommsEntry}
        endMission={endMission}
      />

      <div className="topbar__space" />

      {/* Force figures appear only when there is something to report. */}
      {fp < 100 && <Tag minimal intent={fp < 50 ? 'danger' : 'warning'}>Firepower {fp}%</Tag>}
      {force.mobility && force.mobility !== 'HIGH' && (
        <Tag minimal intent={force.mobility === 'LOW' ? 'danger' : 'warning'}>Mobility {force.mobility.toLowerCase()}</Tag>
      )}
      {scored ? (
        <span className="topbar__score">
          Score {Number(reward.score || 0).toFixed(0)} · Kills {reward.enemy_kills || 0} · KIA {reward.friendly_kia || 0}
        </span>
      ) : null}
      <Tag minimal intent={link.intent} icon="dot" title={roomNote}>{link.text}</Tag>
      <Divider />

      {mode === 'host' && <Button small minimal icon="link" text="Pair" title="Pair a commander" onClick={() => setPairing(true)} />}
      {webUrl && <Button small minimal icon="globe-network" title="Web viewer" aria-label="Web viewer" onClick={() => window.spectreAPI?.openExternal?.(webUrl)} />}
      <Button small minimal icon="chat" title="Comms log" aria-label="Comms log" active={!!state.showComms} onClick={() => patch((p) => ({ ...p, showComms: !p.showComms }))} />
      <Button small minimal icon="cog" title="Settings" aria-label="Settings" onClick={() => patch({ showSettings: true })} />

      <time className="topbar__clock" title={`SPECTRE v${window.__APP_VERSION || '?'}`}>
        {clock.toLocaleTimeString('en-GB', { hour12: false })}
      </time>

      <div className="topbar__window">
        <Button minimal icon="minus" aria-label="Minimise" onClick={() => window.spectreAPI?.minimize()} />
        <Button minimal icon="square" aria-label="Maximise" onClick={() => window.spectreAPI?.maximize()} />
        <Button minimal icon="cross" className="close" aria-label="Close" onClick={() => window.spectreAPI?.close()} />
      </div>

      {pairing && <PairModal onClose={() => setPairing(false)} />}
    </header>
  );
}
