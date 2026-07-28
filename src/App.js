import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useSpectreStore } from './store/useSpectreStore';
import { aiService } from './ai/aiService';
import TitleBar from './components/TitleBar';
import MapView from './components/MapView';
import MapView3D from './components/MapView3D';
import SidePanel from './components/SidePanel';
import RightPanel from './components/RightPanel';
import { CommsLog, StatusBar, SettingsModal } from './components/StatusBar';
import PlanningModal from './components/PlanningModal';
import COAPanel from './components/COAPanel';
import AbortModal from './components/AbortModal';
import AdaptationModal from './components/AdaptationModal';
import AARPanel from './components/AARPanel';
import ModeSelect from './components/ModeSelect';
import { ErrorBoundary } from './components/ErrorBoundary';
import RadialMenu from './components/RadialMenu';
import './styles/global.css';

export default function App() {
  const {
    state, patch, addCommsEntry, sendArmaCommand,
    addIntel, endMission, generateMissionVault, setCommandMode,
    visibleUnits, toggleUnitSelection, clearSelection
  } = useSpectreStore();

  const stateRef = useRef(state);
  stateRef.current = state;

  const [appMode, setAppMode] = useState(null); // 'host' | 'client' | null
  const [roomCode, setRoomCode] = useState('');
  const [relayStatus, setRelayStatus] = useState({ connected: false, clients: 0 });
  const [viewMode, setViewMode] = useState('2d'); // '2d' | '3d'
  const [radialMenu, setRadialMenu] = useState(null); // { x, y, unitId }
  const [pendingAction, setPendingAction] = useState(null); // { id, unitId, label }
  const pendingActionRef = useRef(null);
  pendingActionRef.current = pendingAction;
  const [fireMissionUnit, setFireMissionUnit] = useState(null);
  const [flightPlanUnit, setFlightPlanUnit] = useState(null);
  const panelClickHandlerRef = useRef(null);
  const [rightTab, setRightTab] = useState('STATUS');
  const qHeldRef = useRef(false);
  const ctrlHeldRef = useRef(false);

  const handleMapClick = useCallback((x, y) => {
    if (panelClickHandlerRef.current) {
      panelClickHandlerRef.current(x, y);
      return;
    }

    const action = pendingActionRef.current;
    if (!action) return;

    const targets = action.unitId ? [action.unitId] : state.selectedUnits;
    const units = visibleUnits();

    targets.forEach(unitId => {
      const unit = units[unitId];
      switch (action.id) {
        case 'MOVE_TO':
          sendArmaCommand({ type: 'MOVE_TO', unit_id: unitId, x, y });
          addCommsEntry('SPECTRE', unit?.callsign || unitId, `MOVE TO ${Math.round(x)},${Math.round(y)}`, 'BLUE');
          break;
        case 'LAND_AT':
          sendArmaCommand({ type: 'LAND_AT', unit_id: unitId, x, y });
          addCommsEntry('SPECTRE', unit?.callsign || unitId, `LAND AT ${Math.round(x)},${Math.round(y)}`, 'BLUE');
          break;
        case 'SMOKE_AT':
          sendArmaCommand({ type: 'SMOKE_AT', unit_id: unitId, x, y });
          addCommsEntry('SPECTRE', unit?.callsign || unitId, `SMOKE AT ${Math.round(x)},${Math.round(y)}`, 'BLUE');
          break;
        case 'ARTILLERY_STRIKE':
          sendArmaCommand({ type: 'ARTILLERY_STRIKE', unit_id: unitId, x, y, rounds: 6, ammoType: 'HE' });
          addCommsEntry('SPECTRE', unit?.callsign || unitId, `ARTILLERY STRIKE ${Math.round(x)},${Math.round(y)}`, 'BLUE');
          break;
        case 'ATTACK':
          sendArmaCommand({ type: 'ATTACK', unit_id: unitId, x, y });
          addCommsEntry('SPECTRE', unit?.callsign || unitId, `ATTACK POSITION ${Math.round(x)},${Math.round(y)}`, 'BLUE');
          break;
        default:
          break;
      }
    });
    setPendingAction(null);
  }, [sendArmaCommand, addCommsEntry, visibleUnits, state.selectedUnits]);

  // Keyboard shortcut: M to toggle 2D/3D map
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'm' || e.key === 'M') {
        setViewMode(v => v === '2d' ? '3d' : '2d');
      }
      if (e.key === 'q' || e.key === 'Q') {
        qHeldRef.current = true;
      }
      if (e.ctrlKey || e.metaKey) {
        ctrlHeldRef.current = true;
      }
      if (e.key === 'Escape') {
        if (pendingActionRef.current) {
          setPendingAction(null);
        } else if (state.selectedUnits.length > 0) {
          clearSelection();
        }
      }
    }
    function onKeyUp(e) {
      if (e.key === 'q' || e.key === 'Q') {
        qHeldRef.current = false;
      }
      if (!e.ctrlKey && !e.metaKey) {
        ctrlHeldRef.current = false;
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [clearSelection, state.selectedUnits.length]);

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
        addCommsEntry('SPECTRE', 'ALL', 'Executing WITHDRAWAL. All units RTB.', 'RED');
        sendArmaCommand({ type: 'RTB_ALL' });
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
    setCommandMode('local');
    setAppMode(null);
    setRoomCode('');
    setRelayStatus({ connected: false, clients: 0 });
    patch({ missionPhase: 'BRIEFING', armaConnected: false, units: {}, contacts: {}, mapName: null });
  }, [patch, setCommandMode]);

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
        <SidePanel
          state={state}
          patch={patch}
          addCommsEntry={addCommsEntry}
          sendArmaCommand={sendArmaCommand}
          addIntel={addIntel}
          endMission={endMission}
          visibleUnits={visibleUnits}
        />

        <div className={`app-center ${pendingAction ? 'target-mode' : ''}`}>
          {pendingAction && (
            <div className="target-mode-indicator">
              {pendingAction.id === 'KAMIKAZE'
                ? `Click enemy contact to send drone — ${pendingAction.label} — ESC to cancel`
                : `Click map to set target — ${pendingAction.label} — ESC to cancel`}
            </div>
          )}
          {state.selectedUnits.length > 1 && !pendingAction && (
            <div className="selection-indicator">
              <span className="selection-count">{state.selectedUnits.length} UNITS SELECTED</span>
              <div className="selection-actions">
                <button className="selection-action-btn" onClick={() => {
                  state.selectedUnits.forEach(id => sendArmaCommand({ type: 'HOLD', unit_id: id }));
                  addCommsEntry('SPECTRE', 'SELECTED', 'HOLD', 'BLUE');
                }}>HOLD</button>
                <button className="selection-action-btn" onClick={() => {
                  setPendingAction({ id: 'MOVE_TO', unitId: null, label: 'MOVE TO (ALL)' });
                }}>MOVE TO</button>
                <button className="selection-action-btn" onClick={() => {
                  state.selectedUnits.forEach(id => sendArmaCommand({ type: 'ATTACK', unit_id: id }));
                  addCommsEntry('SPECTRE', 'SELECTED', 'ATTACK', 'BLUE');
                }}>ATTACK</button>
              </div>
              <button className="selection-clear-btn" onClick={clearSelection}>✕</button>
            </div>
          )}
          {viewMode === '2d' ? (
            <MapView
              units={visibleUnits()}
              contacts={state.contacts}
              zones={state.zones}
              selectedUnit={state.selectedUnit}
              selectedUnits={state.selectedUnits}
              selectedContact={state.selectedContact}
              currentCOAs={state.currentCOAs}
              selectedCOA={state.selectedCOA}
              showCOAOverlay={state.showCOAOverlay}
              mapName={state.mapName}
              pendingAction={pendingAction}
              onUnitSelect={(id, ctrlKey) => {
                if (ctrlKey || ctrlHeldRef.current) {
                  toggleUnitSelection(id);
                } else {
                  clearSelection();
                  patch({ selectedUnit: id });
                }
              }}
              onUnitRightClick={(id, x, y) => setRadialMenu({ x, y, unitId: id })}
              onContactSelect={id => {
                if (pendingAction && pendingAction.id === 'KAMIKAZE') {
                  const units = visibleUnits();
                  const allTargets = pendingAction.unitId ? [pendingAction.unitId] : state.selectedUnits;
                  const targets = allTargets.filter(uid => units[uid]?.vehicle_type === 'FPV');
                  targets.forEach(uid => {
                    sendArmaCommand({ type: 'KAMIKAZE', unit_id: uid, target_id: id });
                    addCommsEntry('SPECTRE', uid, `KAMIKAZE → ${id}`, 'RED');
                  });
                  setPendingAction(null);
                } else {
                  patch({ selectedContact: id });
                }
              }}
              onMapClick={handleMapClick}
            />
          ) : (
            <MapView3D
              units={visibleUnits()}
              contacts={state.contacts}
              selectedUnits={state.selectedUnits}
              pendingAction={pendingAction}
              onUnitSelect={(id, ctrlKey) => {
                if (ctrlKey || ctrlHeldRef.current) {
                  toggleUnitSelection(id);
                } else {
                  clearSelection();
                  patch({ selectedUnit: id });
                }
              }}
              onUnitRightClick={(id, x, y) => setRadialMenu({ x, y, unitId: id })}
              onContactSelect={id => {
                if (pendingAction && pendingAction.id === 'KAMIKAZE') {
                  const units = visibleUnits();
                  const allTargets = pendingAction.unitId ? [pendingAction.unitId] : state.selectedUnits;
                  const targets = allTargets.filter(uid => units[uid]?.vehicle_type === 'FPV');
                  targets.forEach(uid => {
                    sendArmaCommand({ type: 'KAMIKAZE', unit_id: uid, target_id: id });
                    addCommsEntry('SPECTRE', uid, `KAMIKAZE → ${id}`, 'RED');
                  });
                  setPendingAction(null);
                } else {
                  patch({ selectedContact: id });
                }
              }}
              onMapClick={handleMapClick}
            />
          )}


          <button
            onClick={() => setViewMode(v => v === '2d' ? '3d' : '2d')}
            className="btn btn-sm view-toggle"
            title="Press M to toggle 2D/3D"
          >
            {viewMode === '2d' ? '3D' : '2D'}
          </button>
        </div>

        <RightPanel
          state={state}
          patch={patch}
          sendArmaCommand={sendArmaCommand}
          addCommsEntry={addCommsEntry}
          selectedUnit={state.selectedUnit ? state.units[state.selectedUnit] : null}
          fireMissionUnit={fireMissionUnit}
          setFireMissionUnit={setFireMissionUnit}
          flightPlanUnit={flightPlanUnit}
          setFlightPlanUnit={setFlightPlanUnit}
          panelClickHandlerRef={panelClickHandlerRef}
          activeTab={rightTab}
          setActiveTab={setRightTab}
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

      {radialMenu && (
        <RadialMenu
          x={radialMenu.x}
          y={radialMenu.y}
          unit={Object.values(visibleUnits()).find(u => u.id === radialMenu.unitId)}
          multiSelect={state.selectedUnits.length > 1 && state.selectedUnits.includes(radialMenu.unitId)}
          onSelect={(action) => {
            const unitId = radialMenu.unitId;
            const units = visibleUnits();
            setRadialMenu(null);

            if (action.complex) {
              if (action.id === 'ARTILLERY_STRIKE') {
                if (units[unitId]) { setFireMissionUnit(units[unitId]); setRightTab('ARTILLERY'); }
              } else if (action.id === 'HOVER' || action.id === 'LAND_AT') {
                if (units[unitId]) { setFlightPlanUnit(units[unitId]); setRightTab('FLIGHT'); }
              }
              return;
            }

            const targets = (state.selectedUnits.length > 1 && state.selectedUnits.includes(unitId))
              ? state.selectedUnits
              : [unitId];

            targets.forEach(tid => {
              const u = units[tid];
              switch (action.id) {
                case 'HOLD':
                case 'RTB':
                case 'WEAPONS_FREE':
                case 'WEAPONS_SAFE':
                case 'FORM_UP':
                case 'DISPERSE':
                  sendArmaCommand({ type: action.id, unit_id: tid });
                  addCommsEntry('SPECTRE', u?.callsign || tid, action.id, 'BLUE');
                  break;
                case 'KAMIKAZE':
                case 'MOVE_TO':
                case 'LAND_AT':
                case 'SMOKE_AT':
                case 'ARTILLERY_STRIKE':
                case 'ATTACK':
                  if (tid === targets[0]) {
                    setPendingAction({ id: action.id, unitId: targets.length > 1 ? null : tid, label: action.label });
                  }
                  break;
                default:
                  sendArmaCommand({ type: action.id, unit_id: tid });
                  addCommsEntry('SPECTRE', u?.callsign || tid, action.id, 'BLUE');
              }
            });
          }}
          onClose={() => setRadialMenu(null)}
        />
      )}
    </div>
    </ErrorBoundary>
  );
}
