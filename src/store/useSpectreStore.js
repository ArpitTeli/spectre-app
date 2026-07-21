import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Reward scoring weights ───────────────────────────────────────────────────
export const REWARD = {
  OBJECTIVE_COMPLETE: 50,
  ENEMY_KILL: 3,
  VEHICLE_DESTROYED_ENEMY: 8,
  TIME_BONUS_PER_MIN_SAVED: 2,
  FRIENDLY_KIA: -15,
  VEHICLE_LOST: -20,
  MISSION_FAILED: -50,
  ABORT: -10
};

const INITIAL_STATE = {
  armaConnected: false,
  lastArmaUpdate: null,
  missionPhase: 'BRIEFING',
  missionStartTime: null,
  missionElapsedSec: 0,
  missionData: null,
  opord: null,
  units: {},
  contacts: {},
  zones: [],
  events: [],
  processedEventIds: [],
  commsLog: [],
  currentCOAs: null,
  selectedCOA: null,
  showCOAPanel: false,
  showCOAOverlay: false,
  planningConversation: [],
  intelDB: { locations: [], patterns: [], terrain: [] },
  config: null,
  mapName: null,
  vaultPath: null,
  forceMetrics: {
    vehicles_total: 0, vehicles_active: 0,
    crew_total: 0, crew_active: 0,
    firepower_index: 100, mobility: 'HIGH'
  },
  rewardData: {
    score: 0, enemy_kills: 0, friendly_kia: 0,
    vehicles_lost: 0, vehicles_destroyed_enemy: 0,
    objective_complete: false, aborted: false
  },
  abortState: null,
  hideArmaOverlay: false,
  showAAR: false,
  pendingAdaptation: null,
  selectedUnit: null,
  selectedContact: null,
  showSettings: false,
  bridgePaths: null
};

export function useSpectreStore() {
  const [state, setState] = useState(INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const timerRef = useRef(null);
  const adaptationLockRef = useRef(false);
  const lastUnitsKey = useRef('');
  const commandModeRef = useRef('local'); // default to local for compatibility

  const patch = useCallback((updates) => {
    setState(prev => typeof updates === 'function' ? updates(prev) : { ...prev, ...updates });
  }, []);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.spectreAPI) return;
    window.spectreAPI.onArmaUpdate(data => processArmaUpdate(data, stateRef, patch));
    window.spectreAPI.getConfig().then(config => {
      patch({ config });
      import('../ai/aiService').then(m => m.aiService.setConfig(config));
    });
    window.spectreAPI.loadIntel().then(intelDB => patch({ intelDB }));
    window.spectreAPI.getPaths().then(bridgePaths => patch({ bridgePaths }));
  }, [patch]);

  // ── Mission timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.missionPhase === 'ACTIVE') {
      timerRef.current = setInterval(() => {
        setState(prev => ({
          ...prev,
          missionElapsedSec: prev.missionStartTime
            ? Math.floor((Date.now() - prev.missionStartTime) / 1000)
            : prev.missionElapsedSec
        }));
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [state.missionPhase]);

  // ── Force metrics ─────────────────────────────────────────────────────────
  const recalcForceMetrics = useCallback(() => {
    setState(prev => {
      const units = Object.values(prev.units);
      const vehicles = units.filter(u => u.type === 'VEHICLE');
      const crew = units.filter(u => u.type === 'INFANTRY');
      const activeVehicles = vehicles.filter(u => u.status !== 'DESTROYED' && u.status !== 'DEAD');
      const activeCrew = crew.filter(u => u.status !== 'DEAD');
      const fpW = { MBT: 30, IFV: 20, APC: 12, RECON: 8, HELI: 25, TRUCK: 2 };
      const maxFP = vehicles.reduce((s, v) => s + (fpW[v.vehicle_type] || 10), 0) || 100;
      const curFP = activeVehicles.reduce((s, v) => s + (fpW[v.vehicle_type] || 10), 0);
      const firepower_index = Math.round((curFP / maxFP) * 100);
      return {
        ...prev,
        forceMetrics: {
          vehicles_total: vehicles.length,
          vehicles_active: activeVehicles.length,
          crew_total: crew.length,
          crew_active: activeCrew.length,
          firepower_index,
          mobility: firepower_index > 70 ? 'HIGH' : firepower_index > 40 ? 'MEDIUM' : 'LOW'
        }
      };
    });
  }, []);

  useEffect(() => {
    const unitsArr = Object.values(state.units);
    const key = unitsArr.map(u => `${u.id}:${u.status}:${u.health}`).join(',');
    if (key !== lastUnitsKey.current) {
      lastUnitsKey.current = key;
      recalcForceMetrics();
    }
  }, [state.units, recalcForceMetrics]);

  // ── Abort threshold watcher ───────────────────────────────────────────────
  useEffect(() => {
    if (state.missionPhase !== 'ACTIVE' || state.abortState || adaptationLockRef.current) return;
    const cfg = state.config?.auto_abort_threshold || {};
    const fp = state.forceMetrics.firepower_index;
    const kia = state.rewardData.friendly_kia;
    const lost = state.rewardData.vehicles_lost;
    if (fp <= (cfg.firepower_loss_pct ?? 50) || kia >= (cfg.crew_kia ?? 2) || lost >= 2) {
      adaptationLockRef.current = true;
      triggerAbortCheck(state, patch).finally(() => { adaptationLockRef.current = false; });
    }
  }, [state.forceMetrics, state.rewardData]); // eslint-disable-line

  // ── Comms logger ──────────────────────────────────────────────────────────
  const addCommsEntry = useCallback((from, to, message, priority = 'WHITE') => {
    const entry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      from, to, message, priority
    };
    setState(prev => ({ ...prev, commsLog: [...prev.commsLog.slice(-300), entry] }));
    return entry;
  }, []);

  // ── Arma commands ─────────────────────────────────────────────────────────
  const sendArmaCommand = useCallback(async (command) => {
    if (!window.spectreAPI) return;
    // In client mode, send through relay instead of local bridge
    if (commandModeRef.current === 'relay') {
      window.spectreAPI.relayCommand?.(command);
      return;
    }
    return window.spectreAPI.sendCommand(command);
  }, []);

  // ── Set command mode (host=local, client=relay) ───────────────────────────
  const setCommandMode = useCallback((mode) => {
    commandModeRef.current = mode;
    setState(prev => ({ ...prev, _commandMode: mode }));
  }, []);

  // ── Intel ─────────────────────────────────────────────────────────────────
  const addIntel = useCallback((type, data) => {
    setState(prev => {
      const db = { ...prev.intelDB, locations: [...prev.intelDB.locations], patterns: [...prev.intelDB.patterns], terrain: [...prev.intelDB.terrain] };
      if (type === 'location') {
        const idx = db.locations.findIndex(l => l.name === data.name);
        if (idx >= 0) {
          db.locations[idx] = { ...db.locations[idx], ...data, observations: [...(db.locations[idx].observations || []), ...(data.observations || [])] };
        } else {
          db.locations.push({ ...data, observations: data.observations || [] });
        }
      } else if (type === 'pattern') {
        db.patterns.push({ ...data, timestamp: new Date().toISOString() });
      } else if (type === 'terrain') {
        db.terrain.push(data);
      }
      window.spectreAPI?.saveIntel(db);
      return { ...prev, intelDB: db };
    });
  }, []);

  // ── End mission ───────────────────────────────────────────────────────────
  const endMission = useCallback(async (objective_complete = false) => {
    const s = stateRef.current;
    const elapsed = s.missionElapsedSec;
    const reward = { ...s.rewardData };

    if (objective_complete) {
      reward.score += REWARD.OBJECTIVE_COMPLETE;
      reward.objective_complete = true;
      const plannedMin = (s.opord?.execution?.phases || []).reduce((sum, p) => sum + (p.duration_min || 5), 0) || 30;
      const saved = Math.max(0, plannedMin * 60 - elapsed);
      reward.score += Math.floor(saved / 60) * REWARD.TIME_BONUS_PER_MIN_SAVED;
    }

    const missionData = {
      ...(s.missionData || {}),
      opord: s.opord,
      coas_generated: s.currentCOAs,
      coa_executed: s.selectedCOA,
      comms_log: s.commsLog,
      outcome: {
        objective_complete,
        friendly_kia: reward.friendly_kia,
        vehicles_lost: reward.vehicles_lost,
        enemy_kills: reward.enemy_kills,
        duration_sec: elapsed,
        reward_score: parseFloat(reward.score.toFixed(1))
      },
      reward,
      intel_snapshot: s.intelDB,
      timestamp: new Date().toISOString()
    };

    patch({ missionData, rewardData: reward, missionPhase: 'AAR' });
    if (window.spectreAPI) await window.spectreAPI.saveMission(missionData);

    try {
      const { aiService } = await import('../ai/aiService');
      const aar = await aiService.generateAAR(missionData);
      if (aar) {
        patch({ aarData: aar, showAAR: true });
        (aar.intelligence_updates || []).forEach(u => addIntel(u.type, u.data));
      }
    } catch (e) { console.error('AAR failed:', e); }
  }, [patch, addIntel]);

  // ── Vault generation (called from PlanningModal after OPORD+COA) ──────────
  const generateMissionVault = useCallback(async (opord, coa) => {
    try {
      const { generateVault } = await import('../lib/vault');
      const vaultPath = await generateVault(opord, coa, stateRef.current);
      if (vaultPath) {
        patch({ vaultPath });
        console.log('SPECTRE: vault created at', vaultPath);
      }
      return vaultPath;
    } catch (e) {
      console.error('SPECTRE: vault generation failed:', e);
      return null;
    }
  }, [patch]);

  return { state, patch, addCommsEntry, sendArmaCommand, addIntel, endMission, recalcForceMetrics, generateMissionVault, setCommandMode };
}

// ─── Process Arma state update ────────────────────────────────────────────────
function processArmaUpdate(data, stateRef, patch) {
  if (!data || typeof data !== 'object') return;
  const { units = [], contacts = [], events = [], timestamp, mapName } = data;
  const now = Date.now();
  const current = stateRef.current;

  const unitsMap = {};
  units.forEach(u => { unitsMap[u.id] = { ...current.units[u.id], ...u, last_updated: timestamp }; });

  const contactsMap = { ...current.contacts };
  contacts.forEach(c => { contactsMap[c.id] = { ...contactsMap[c.id], ...c, state: 'CONFIRMED', last_seen: now }; });
  Object.keys(contactsMap).forEach(id => {
    const age = now - contactsMap[id].last_seen;
    if (age > 600000) delete contactsMap[id];
    else if (age > 120000) contactsMap[id] = { ...contactsMap[id], state: 'LAST_KNOWN' };
  });

  const processedSet = new Set(current.processedEventIds);
  const newEvents = events.filter(e => {
    const key = e.id || `${e.type}_${e.timestamp}`;
    if (processedSet.has(key)) return false;
    processedSet.add(key);
    return true;
  });

  patch(prev => ({
    ...prev,
    units: unitsMap,
    contacts: contactsMap,
    armaConnected: true,
    lastArmaUpdate: timestamp,
    mapName: mapName || prev.mapName,
    events: [...prev.events, ...newEvents].slice(-200),
    processedEventIds: Array.from(processedSet).slice(-500)
  }));

  if (newEvents.length > 0 && current.missionPhase === 'ACTIVE') {
    handleArmaEvents(newEvents, stateRef, patch);
  }
}

// ─── Handle game events ───────────────────────────────────────────────────────
async function handleArmaEvents(events, stateRef, patch) {
  const { aiService } = await import('../ai/aiService');

  for (const event of events) {
    // Always read the latest state for each event to avoid stale closures
    const state = stateRef.current;

    // Update reward data
    if (event.type === 'VEHICLE_DESTROYED') {
      patch(prev => ({ ...prev, rewardData: { ...prev.rewardData, vehicles_lost: prev.rewardData.vehicles_lost + 1, score: prev.rewardData.score + REWARD.VEHICLE_LOST } }));
    } else if (event.type === 'UNIT_KIA') {
      patch(prev => ({ ...prev, rewardData: { ...prev.rewardData, friendly_kia: prev.rewardData.friendly_kia + 1, score: prev.rewardData.score + REWARD.FRIENDLY_KIA } }));
    } else if (event.type === 'ENEMY_KILLED') {
      patch(prev => ({ ...prev, rewardData: { ...prev.rewardData, enemy_kills: prev.rewardData.enemy_kills + 1, score: prev.rewardData.score + REWARD.ENEMY_KILL } }));
    } else if (event.type === 'CONTACT_SPOTTED') {
      patch(prev => {
        const db = { ...prev.intelDB, patterns: [...prev.intelDB.patterns, { type: 'contact_spotted', ...event, timestamp: new Date().toISOString() }] };
        window.spectreAPI?.saveIntel(db);
        return { ...prev, intelDB: db };
      });
      // Don't continue — fall through to vault update, but skip adaptation
    }

    // Update vault on significant events
    const freshState = stateRef.current;
    if (freshState.vaultPath) {
      try {
        const { vaultOnEvent } = await import('../lib/vault');
        await vaultOnEvent(freshState.vaultPath, event, freshState);
      } catch (e) { console.error('Vault event update failed:', e); }
    }

    // Trigger AI adaptation for significant events (skip for kills and contact sightings)
    if (event.type === 'ENEMY_KILLED' || event.type === 'CONTACT_SPOTTED') continue;
    const currentState = stateRef.current;
    if (!currentState.selectedCOA) continue;
    try {
      const context = { units: currentState.units, contacts: currentState.contacts, forceMetrics: currentState.forceMetrics, intelDB: currentState.intelDB };
      const adaptation = await aiService.adaptPlan(event, currentState.selectedCOA, context, currentState.vaultPath);
      if (!adaptation) continue;

      if (adaptation.auto_handle) {
        patch(prev => ({
          ...prev,
          commsLog: [...prev.commsLog.slice(-300), {
            id: Date.now() + Math.random(),
            timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
            from: 'SPECTRE', to: 'ALL',
            message: adaptation.comms_message || adaptation.recommended_action,
            priority: 'YELLOW'
          }]
        }));
        for (const order of (adaptation.modified_orders || [])) {
          await window.spectreAPI?.sendCommand({ type: 'EXECUTE_ORDER', unit_id: order.unit_id, action: order.new_action, waypoints: order.waypoints || [] });
        }
      } else {
        patch({ pendingAdaptation: adaptation });
      }
    } catch (e) { console.error('Event adaptation failed:', e); }
  }
}

// ─── Abort threshold trigger ──────────────────────────────────────────────────
async function triggerAbortCheck(state, patch) {
  const fp = state.forceMetrics.firepower_index;
  const kia = state.rewardData.friendly_kia;
  let reason = fp <= 50 ? `Force strength critical — ${fp}% firepower remaining` : `${kia} crew KIA — force below effective threshold`;

  const baseOptions = [
    { id: 'WITHDRAW', label: 'FIGHTING WITHDRAWAL', description: 'Suppress and disengage to nearest safe position', success_pct: 82, risk: 'LOW' },
    { id: 'CONSOLIDATE', label: 'CONSOLIDATE & HOLD', description: 'Defensive perimeter, await situation change', success_pct: 61, risk: 'MEDIUM' },
    { id: 'CONTINUE', label: 'CONTINUE ASSAULT', description: '⚠ HIGH RISK — not recommended at current strength', success_pct: 12, risk: 'CRITICAL' }
  ];

  try {
    const { aiService } = await import('../ai/aiService');
    const context = { units: state.units, contacts: state.contacts, forceMetrics: state.forceMetrics, intelDB: state.intelDB };
    const result = await aiService.adaptPlan({ type: 'ABORT_THRESHOLD', reason }, state.selectedCOA, context, state.vaultPath);
    patch({
      missionPhase: 'ABORTING',
      abortState: { tier: 2, reason, countdown: 30, options: baseOptions, assessment: result?.assessment || reason, auto_select: 'WITHDRAW' }
    });
  } catch (e) {
    patch({
      missionPhase: 'ABORTING',
      abortState: { tier: 2, reason, countdown: 30, options: baseOptions, assessment: reason, auto_select: 'WITHDRAW' }
    });
  }
}
