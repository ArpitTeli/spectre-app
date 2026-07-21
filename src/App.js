import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useSpectreStore } from './store/useSpectreStore';
import { aiService } from './ai/aiService';
import TitleBar from './components/TitleBar';
import MapView from './components/MapView';
import SidePanel from './components/SidePanel';
import { CommsLog, StatusBar, SettingsModal } from './components/StatusBar';
import PlanningModal from './components/PlanningModal';
import COAPanel from './components/COAPanel';
import AbortModal from './components/AbortModal';
import AdaptationModal from './components/AdaptationModal';
import AARPanel from './components/AARPanel';
import ModeSelect from './components/ModeSelect';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/global.css';

export default function App() {
  const {
    state, patch, addCommsEntry, sendArmaCommand,
    addIntel, endMission, generateMissionVault, setCommandMode
  } = useSpectreStore();

  const stateRef = useRef(state);
  stateRef.current = state;

  const [appMode, setAppMode] = useState(null); // 'host' | 'client' | null
  const [roomCode, setRoomCode] = useState('');
  const [relayStatus, setRelayStatus] = useState({ connected: false, clients: 0 });

  // Sync AI config
  useEffect(() => {
    if (state.config) aiService.setConfig(state.config);
  }, [state.config]);

  // Auto-update notifications
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);

  useEffect(() => {
    window.spectreAPI?.rendererReady?.();

    window.spectreAPI?.onUpdateAvailable?.((info) => {
      setUpdateInfo(info);
      addCommsEntry('SPECTRE', 'ALL', `Update available: v${info.version}. Downloading...`, 'BLUE');
    });
    window.spectreAPI?.onUpdateDownloaded?.((info) => {
      setUpdateDownloaded(true);
      setUpdateInfo(info);
      addCommsEntry('SPECTRE', 'ALL', `Update v${info.version} ready. Restart to apply.`, 'GREEN');
    });
    window.spectreAPI?.onUpdateNotAvailable?.((info) => {
      addCommsEntry('SPECTRE', 'ALL', `No update available. Version ${info.version} is current.`, 'BLUE');
    });

    // Listen for relay status updates
    window.spectreAPI?.onRelayStatus?.((data) => {
      setRelayStatus(data);
      if (data.connected && data.mode === 'client') {
        addCommsEntry('SPECTRE', 'ALL', `Connected to host. Room: ${data.room}`, 'GREEN');
      } else if (data.error) {
        addCommsEntry('SPECTRE', 'ALL', `Relay: ${data.error}`, 'RED');
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Abort countdown ticker
  useEffect(() => {
    if (state.missionPhase !== 'ABORTING' || !state.abortState) return;
    if (state.abortState.countdown <= 0) {
      handleAbortChoiceRef.current(state.abortState.auto_select);
      return;
    }
    const t = setTimeout(() => {
      patch(prev => ({
        ...prev,
        abortState: prev.abortState ? { ...prev.abortState, countdown: prev.abortState.countdown - 1 } : null
      }));
    }, 1000);
    return () => clearTimeout(t);
  }, [state.missionPhase, state.abortState?.countdown, patch]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAbortChoice = useCallback(async (choiceId) => {
    patch({ missionPhase: 'ACTIVE', abortState: null });
    if (choiceId === 'WITHDRAW' || choiceId === 'CONSOLIDATE') {
      addCommsEntry('SPECTRE', 'ALL', `Executing ${choiceId}. All units comply.`, 'RED');
      if (choiceId === 'WITHDRAW') {
        Object.values(stateRef.current.units).forEach(u => {
          sendArmaCommand({ type: 'RTB', unit_id: u.id });
        });
      } else {
        sendArmaCommand({ type: 'HOLD_ALL' });
        sendArmaCommand({ type: 'WEAPONS_FREE' });
      }
    } else if (choiceId === 'CONTINUE') {
      addCommsEntry('SPECTRE', 'ALL', 'Continuing assault. High risk acknowledged.', 'RED');
    }
  }, [patch, addCommsEntry, sendArmaCommand]);

  const handleAbortChoiceRef = useRef(handleAbortChoice);
  handleAbortChoiceRef.current = handleAbortChoice;

  const handleAcceptAdaptation = useCallback(async () => {
    const a = stateRef.current.pendingAdaptation;
    if (!a) return;
    for (const order of (a.modified_orders || [])) {
      await sendArmaCommand({ type: 'EXECUTE_ORDER', unit_id: order.unit_id, action: order.new_action, waypoints: order.waypoints || [] });
    }
    addCommsEntry('SPECTRE', 'ALL', a.comms_message || a.recommended_action, 'YELLOW');
    if (a.new_coas) patch({ currentCOAs: a.new_coas, showCOAPanel: true });
    patch({ pendingAdaptation: null });
  }, [sendArmaCommand, addCommsEntry, patch]);

  // Mode selection handler
  const handleModeSelect = useCallback(({ mode, roomCode: code }) => {
    // Host auto-generates a room code if none provided
    const finalCode = mode === 'host' && !code
      ? 'ROOM-' + Math.random().toString(36).substring(2, 6).toUpperCase()
      : code;

    setAppMode(mode);
    setRoomCode(finalCode);

    if (mode === 'host') {
      // Host mode: start bridge services + connect to relay as host
      setCommandMode('local');
      window.spectreAPI?.startHostServices?.();
      patch({ missionPhase: 'BRIEFING' });
      const config = stateRef.current.config;
      window.spectreAPI?.relayConnect?.({ mode: 'host', roomCode: finalCode, url: config?.relay_url });
    } else {
      // Client mode: connect to relay as client, skip Arma bridge
      setCommandMode('relay');
      patch({ missionPhase: 'BRIEFING', armaConnected: false });
      const config = stateRef.current.config;
      window.spectreAPI?.relayConnect?.({ mode: 'client', roomCode: finalCode, url: config?.relay_url });
      // Persist room code for next session
      if (finalCode) {
        window.spectreAPI?.saveConfig?.({ ...config, last_room_code: finalCode });
      }
    }
  }, [patch, setCommandMode]);

  // Switch back to mode select (disconnect relay, reset mode)
  const handleSwitchMode = useCallback(() => {
    window.spectreAPI?.relayDisconnect?.();
    setAppMode(null);
    setRoomCode('');
    setRelayStatus({ connected: false, clients: 0 });
    patch({ missionPhase: 'BRIEFING', armaConnected: false, units: {}, contacts: {}, mapName: null });
  }, [patch]);

  // Show mode select if no mode chosen
  if (!appMode) {
    return <ModeSelect onSelect={handleModeSelect} savedRoomCode={state.config?.last_room_code} />;
  }

  return (
    <ErrorBoundary>
    <div className="app">
      <TitleBar
        missionPhase={state.missionPhase}
        missionElapsedSec={state.missionElapsedSec}
        armaConnected={appMode === 'client' ? relayStatus.connected : state.armaConnected}
        mode={appMode}
        roomCode={roomCode}
        relayClients={relayStatus.clients}
        relayError={relayStatus.error}
        relayConnecting={relayStatus.connecting}
        onSwitchMode={handleSwitchMode}
        onMinimize={() => window.spectreAPI?.minimize()}
        onMaximize={() => window.spectreAPI?.maximize()}
        onClose={() => window.spectreAPI?.close()}
      />

      {updateDownloaded && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 16px',
          background: 'var(--accent-dim)',
          borderBottom: '1px solid var(--accent)',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          flexShrink: 0
        }}>
          <span style={{ color: 'var(--accent)' }}>
            Update v{updateInfo?.version} downloaded — restart to apply
          </span>
          <button
            className="btn btn-primary"
            style={{ fontSize: '10px', padding: '3px 12px' }}
            onClick={() => window.spectreAPI?.restartApp?.()}
          >
            RESTART NOW
          </button>
        </div>
      )}

      <div className="app-body">
        <MapView
          units={state.units}
          contacts={state.contacts}
          zones={state.zones}
          selectedUnit={state.selectedUnit}
          selectedContact={state.selectedContact}
          currentCOAs={state.currentCOAs}
          selectedCOA={state.selectedCOA}
          showCOAOverlay={state.showCOAOverlay}
          mapName={state.mapName}
          onUnitSelect={id => patch({ selectedUnit: id })}
          onContactSelect={id => patch({ selectedContact: id })}
        />

        <SidePanel
          state={state}
          patch={patch}
          addCommsEntry={addCommsEntry}
          sendArmaCommand={sendArmaCommand}
          addIntel={addIntel}
          endMission={endMission}
        />
      </div>

      <StatusBar
        armaConnected={appMode === 'client' ? relayStatus.connected : state.armaConnected}
        forceMetrics={state.forceMetrics}
        missionPhase={state.missionPhase}
        missionElapsedSec={state.missionElapsedSec}
        rewardData={state.rewardData}
        lastUpdate={state.lastArmaUpdate}
        bridgePaths={state.bridgePaths}
        mode={appMode}
        roomCode={roomCode}
        relayClients={relayStatus.clients}
        onCommsToggle={() => patch(p => ({ ...p, showComms: !p.showComms }))}
      />

      {state.showComms && (
        <CommsLog
          entries={state.commsLog}
          onClose={() => patch({ showComms: false })}
        />
      )}

      {state.missionPhase === 'PLANNING' && (
        <PlanningModal
          state={state}
          patch={patch}
          addCommsEntry={addCommsEntry}
          addIntel={addIntel}
          generateMissionVault={generateMissionVault}
        />
      )}

      {state.showCOAPanel && (
        <COAPanel
          coas={state.currentCOAs}
          selectedCOA={state.selectedCOA}
          state={state}
          patch={patch}
          addCommsEntry={addCommsEntry}
          sendArmaCommand={sendArmaCommand}
        />
      )}

      {state.missionPhase === 'ABORTING' && state.abortState && (
        <AbortModal
          abortState={state.abortState}
          forceMetrics={state.forceMetrics}
          rewardData={state.rewardData}
          onChoice={handleAbortChoice}
        />
      )}

      {state.pendingAdaptation && (
        <AdaptationModal
          adaptation={state.pendingAdaptation}
          onAccept={handleAcceptAdaptation}
          onDismiss={() => patch({ pendingAdaptation: null })}
          onShowNewCOAs={() => { patch({ currentCOAs: state.pendingAdaptation.new_coas, showCOAPanel: true, pendingAdaptation: null }); }}
        />
      )}

      {state.showAAR && state.aarData && (
        <AARPanel
          aar={state.aarData}
          rewardData={state.rewardData}
          onClose={() => patch({ showAAR: false })}
          onNewMission={() => patch({ showAAR: false, missionPhase: 'PLANNING', missionElapsedSec: 0, missionStartTime: null, selectedCOA: null, currentCOAs: null, abortState: null, pendingAdaptation: null, rewardData: { score: 0, enemy_kills: 0, friendly_kia: 0, vehicles_lost: 0, vehicles_destroyed_enemy: 0, objective_complete: false, aborted: false } })}
        />
      )}

      {state.showSettings && (
        <SettingsModal
          config={state.config}
          bridgePaths={state.bridgePaths}
          onSave={async config => {
            await window.spectreAPI?.saveConfig(config);
            patch({ config, showSettings: false });
            aiService.setConfig(config);
            if (config.vercel_url) {
              window.spectreAPI?.setVercelUrl?.(config.vercel_url);
            }
          }}
          onClose={() => patch({ showSettings: false })}
        />
      )}
    </div>
    </ErrorBoundary>
  );
}
