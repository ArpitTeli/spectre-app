'use client';
import { useEffect, useRef, useState } from 'react';

const TILE_BASE = 'https://jetelain.github.io/Arma3Map';
const VEHICLE_SYMBOL = { MBT: '▲', IFV: '■', APC: '◆', RECON: '◇', HELI: '✦', TRUCK: '▪', INFANTRY: '●', DEFAULT: '○' };
const CONTACT_SYMBOL = { INFANTRY: '●', VEHICLE: '■', TANK: '▲', UNKNOWN: '?' };

// Map configs with CRS parameters (must match desktop app exactly)
const MAP_CONFIGS = {
  stratis: { pattern: '/maps/stratis/{z}/{x}/{y}.png', maxZoom: 4, defaultZoom: 2, tileSize: 226, center: [4100, 4100], f: 0.027475, tw: 226 },
  altis:   { pattern: '/maps/altis/{z}/{x}/{y}.png',   maxZoom: 6, defaultZoom: 3, tileSize: 212, center: [15000, 15000], fx: 0.006839, fy: 0.006836, tw: 212 },
  tanoa:   { pattern: '/maps/tanoa/{z}/{x}/{y}.png',   maxZoom: 5, defaultZoom: 2, tileSize: 213, center: [7000, 7000], f: 0.01385, tw: 213 },
  enoch:   { pattern: '/maps/enoch/{z}/{x}/{y}.png',   maxZoom: 4, defaultZoom: 2, tileSize: 356, center: [7100, 7100], f: 0.02735, tw: 356 },
  livonia: { pattern: '/maps/enoch/{z}/{x}/{y}.png',   maxZoom: 4, defaultZoom: 2, tileSize: 356, center: [7100, 7100], f: 0.02735, tw: 356 },
  malden:  { pattern: '/maps/malden/{z}/{x}/{y}.png',  maxZoom: 5, defaultZoom: 2, tileSize: 186, center: [7000, 7000], f: 0.01448, tw: 186 },
};

function makeCRS(L, config) {
  const fx = config.fx || config.f;
  const fy = config.fy || config.f;
  return L.extend({}, L.CRS.Simple, {
    projection: L.Projection.LonLat,
    transformation: new L.Transformation(fx, 0, -fy, config.tw),
    scale: z => Math.pow(2, z),
    zoom: s => Math.log(s) / Math.LN2,
    infinite: true
  });
}

function getLatLng(pos) {
  if (!pos) return null;
  if (pos.lat !== undefined && pos.lng !== undefined) return [pos.lat, pos.lng];
  if (pos.x !== undefined && pos.y !== undefined) return [pos.y, pos.x];
  return null;
}

function makeUnitHTML(unit) {
  const symbol = VEHICLE_SYMBOL[unit.vehicle_type || unit.vtype] || VEHICLE_SYMBOL.DEFAULT;
  const hp = unit.health ?? unit.hp ?? 100;
  const hpColor = hp > 60 ? '#2a7de1' : hp > 30 ? '#f5a623' : '#db3838';
  return `<div style="display:flex;flex-direction:column;align-items:center">
    <div style="background:rgba(27,27,27,0.95);border:1px solid #525252;border-radius:3px;padding:2px 6px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:600;color:#f5f6f7;letter-spacing:0.5px;white-space:nowrap;margin-bottom:2px">${unit.callsign || unit.id}</div>
    <div style="font-size:16px;line-height:1;color:#525252">${symbol}</div>
    <div style="width:28px;height:3px;background:rgba(42,42,42,0.8);border-radius:2px;overflow:hidden;margin-top:2px">
      <div style="width:${hp}%;height:100%;background:${hpColor};border-radius:2px"></div>
    </div>
  </div>`;
}

function makeContactHTML(contact) {
  const symbol = CONTACT_SYMBOL[contact.type] || CONTACT_SYMBOL.UNKNOWN;
  const colors = {
    CONFIRMED:  { border: '#db3838', text: '#f5a6a6', opacity: 1.0 },
    LAST_KNOWN: { border: '#e87c3e', text: '#f5c4a0', opacity: 0.7 },
    SUSPECTED:  { border: '#f5a623', text: '#f5d48a', opacity: 0.6 }
  };
  const c = colors[contact.state] || colors.SUSPECTED;
  const label = contact.state === 'SUSPECTED' ? '?' : (contact.id || '?').split('-').pop();
  return `<div style="opacity:${c.opacity};display:flex;flex-direction:column;align-items:center">
    <div style="background:rgba(27,27,27,0.95);border:1px solid ${c.border};border-radius:3px;padding:2px 6px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:600;color:${c.text};letter-spacing:0.5px;margin-bottom:2px">${label}</div>
    <div style="font-size:14px;line-height:1;color:${c.border}">${symbol}</div>
  </div>`;
}

export default function Home() {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const unitLayer = useRef(null);
  const contactLayer = useRef(null);
  const tileLayer = useRef(null);
  const currentMapRef = useRef(null);
  const prevUnitCountRef = useRef(0);
  const [leafletReady, setLeafletReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [unitCount, setUnitCount] = useState(0);
  const [contactCount, setContactCount] = useState(0);
  const [mapName, setMapName] = useState(null);
  const [forceMetrics, setForceMetrics] = useState(null);
  const [missionPhase, setMissionPhase] = useState(null);

  // Load Leaflet from CDN
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => setLeafletReady(true);
    document.head.appendChild(script);
  }, []);

  // Poll for state + manage map lifecycle
  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    const L = window.L;

    const poll = async () => {
      try {
        const res = await fetch('/api/state');
        const data = await res.json();

        if (!data.state) { setConnected(false); return; }
        setConnected(data.age < 10000);

        const state = data.state;
        const units = state.units || [];
        const contacts = state.contacts || [];
        setUnitCount(units.length);
        setContactCount(contacts.length);
        if (state.forceMetrics) setForceMetrics(state.forceMetrics);
        if (state.missionPhase) setMissionPhase(state.missionPhase);

        // Recreate map when map type changes (matches desktop app behavior)
        const newMap = (state.mapName || '').toLowerCase();
        if (newMap && newMap !== currentMapRef.current) {
          currentMapRef.current = newMap;
          setMapName(newMap);

          // Destroy old map
          if (mapInst.current) {
            mapInst.current.remove();
            mapInst.current = null;
          }

          const config = MAP_CONFIGS[newMap];
          if (config) {
            const crs = makeCRS(L, config);
            const map = L.map(mapRef.current, {
              crs: crs,
              center: config.center,
              zoom: config.defaultZoom,
              maxZoom: config.maxZoom + 4,
              zoomControl: false,
              attributionControl: false,
              preferCanvas: true,
              zoomSnap: 0.25,
              zoomDelta: 0.5
            });

            map.getContainer().style.background = '#0a0f14';
            L.control.zoom({ position: 'topright' }).addTo(map);

            L.tileLayer(TILE_BASE + config.pattern, {
              tileSize: config.tileSize,
              maxZoom: config.maxZoom + 4,
              maxNativeZoom: config.maxZoom,
              minZoom: 0
            }).addTo(map);

            unitLayer.current = L.layerGroup().addTo(map);
            contactLayer.current = L.layerGroup().addTo(map);
            mapInst.current = map;
            prevUnitCountRef.current = 0;
          }
        }

        if (!mapInst.current) return;

        // Update unit markers
        if (unitLayer.current) {
          unitLayer.current.clearLayers();
          const latlngs = [];
          for (const u of units) {
            const ll = getLatLng(u.position || u.pos);
            if (!ll) continue;
            latlngs.push(ll);
            const icon = L.divIcon({ className: '', iconSize: [64, 54], iconAnchor: [32, 27], html: makeUnitHTML(u) });
            const marker = L.marker(ll, { icon });
            const hp = u.health ?? u.hp ?? 100;
            marker.bindTooltip(
              `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;background:#1b1b1b;border:1px solid #3a3a3a;padding:6px;border-radius:3px">
                <b style="color:#2a7de1">${u.callsign || u.id}</b><br>
                ${u.vehicle_type || u.vtype || ''} | HP:${hp}% Fuel:${u.fuel ?? 100}%<br>
                Status: ${u.status || u.st || 'OK'}<br>
                ${u.current_order || u.order ? `<span style="color:#a0a0a0">${u.current_order || u.order}</span>` : ''}
              </div>`,
              { permanent: false, direction: 'top' }
            );
            unitLayer.current.addLayer(marker);
          }
          // Only fit bounds when units first appear or count changes
          if (latlngs.length > 0 && latlngs.length !== prevUnitCountRef.current) {
            prevUnitCountRef.current = latlngs.length;
            if (latlngs.length === 1) mapInst.current.setView(latlngs[0], Math.max(mapInst.current.getZoom(), 3));
            else mapInst.current.fitBounds(L.latLngBounds(latlngs), { padding: [80, 80] });
          }
        }

        // Update contact markers
        if (contactLayer.current) {
          contactLayer.current.clearLayers();
          for (const c of contacts) {
            const ll = getLatLng(c.position || c.pos);
            if (!ll) continue;
            const icon = L.divIcon({ className: '', iconSize: [52, 42], iconAnchor: [26, 21], html: makeContactHTML(c) });
            const marker = L.marker(ll, { icon });
            const ageMin = c.last_seen ? Math.floor((Date.now() - c.last_seen) / 60000) : 0;
            marker.bindTooltip(
              `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;background:#1b1b1b;border:1px solid #3a3a3a;padding:6px;border-radius:3px">
                <b style="color:#db3838">${c.id}</b><br>
                Type: ${c.type || 'UNKNOWN'} | State: <b style="color:${c.state === 'CONFIRMED' ? '#db3838' : c.state === 'LAST_KNOWN' ? '#e87c3e' : '#f5a623'}">${c.state}</b><br>
                Source: ${c.source || 'UNKNOWN'}<br>
                ${ageMin > 0 ? `Last seen: ${ageMin}m ago` : 'Just spotted'}
              </div>`,
              { permanent: false, direction: 'top' }
            );
            contactLayer.current.addLayer(marker);
          }
        }
      } catch (e) {
        setConnected(false);
      }
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [leafletReady]);

  const fpColor = forceMetrics ? (forceMetrics.firepower_index < 50 ? '#db3838' : forceMetrics.firepower_index < 70 ? '#f5a623' : '#2a7de1') : '#888';

  return (
    <div style={{ background: '#1b1b1b', color: '#f5f6f7', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", fontSize: '13px', height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Title Bar */}
      <div style={{ display: 'flex', alignItems: 'center', height: '36px', background: '#212121', borderBottom: '1px solid #2a2a2a', padding: '0 12px', gap: '12px', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '2px', color: '#2a7de1', textTransform: 'uppercase' }}>SPECTRE</span>
        <div style={{ width: 1, height: 16, background: '#3a3a3a' }} />
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', fontWeight: 500, color: '#a0a0a0', letterSpacing: '1px', textTransform: 'uppercase' }}>
          {missionPhase || 'STANDBY'}
        </span>
        <div style={{ width: 1, height: 16, background: '#3a3a3a' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#2a7de1' : '#db3838' }} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: connected ? '#2a7de1' : '#db3838' }}>
            {connected ? 'ARMA LINK ACTIVE' : 'ARMA NOT CONNECTED'}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: '#888', letterSpacing: '1px' }}>LIVE WEB VIEW</span>
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', background: '#0a0f14' }} />

        {mapName && (
          <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(27,27,27,0.95)', border: '1px solid #2a2a2a', borderRadius: 3, padding: '6px 10px', zIndex: 1000, fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: '#f5f6f7', letterSpacing: '1px', fontWeight: 600 }}>
            {mapName.toUpperCase()}
          </div>
        )}

        <div style={{ position: 'absolute', bottom: 10, left: 10, background: 'rgba(27,27,27,0.95)', border: '1px solid #2a2a2a', borderRadius: '3px', padding: '8px 12px', zIndex: 1000, fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', pointerEvents: 'none' }}>
          <div style={{ color: '#888', marginBottom: 5, letterSpacing: '1px', fontWeight: 600 }}>LEGEND</div>
          <div style={{ color: '#2a7de1', marginBottom: 2 }}>○ FRIENDLY</div>
          <div style={{ color: '#db3838', marginBottom: 2 }}>● CONFIRMED HOSTILE</div>
          <div style={{ color: '#e87c3e', marginBottom: 2, opacity: 0.7 }}>● LAST KNOWN</div>
          <div style={{ color: '#f5a623', opacity: 0.6 }}>● SUSPECTED</div>
        </div>

        {!connected && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', zIndex: 1000 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', color: '#888', background: 'rgba(27,27,27,0.95)', padding: '20px 30px', borderRadius: '3px', border: '1px solid #3a3a3a' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px', color: '#888' }}>◎</div>
              <div style={{ fontWeight: 600, letterSpacing: '1px' }}>AWAITING ARMA CONNECTION</div>
              <div style={{ marginTop: '6px', fontSize: '10px', color: '#888' }}>Start SPECTRE C2 + Arma 3 to see live positions</div>
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div style={{ height: '28px', background: '#212121', borderTop: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', padding: '0 12px', gap: '12px', flexShrink: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: '#888' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#888' }}>ARMA:</span>
          <span style={{ color: connected ? '#2a7de1' : '#db3838', fontWeight: 500 }}>{connected ? 'CONNECTED' : 'OFFLINE'}</span>
        </div>
        <div style={{ width: 1, height: 12, background: '#2a2a2a' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#888' }}>PHASE:</span>
          <span style={{ color: missionPhase === 'ABORTING' ? '#db3838' : '#a0a0a0', fontWeight: 500 }}>{missionPhase || 'STANDBY'}</span>
        </div>
        {forceMetrics && (
          <>
            <div style={{ width: 1, height: 12, background: '#2a2a2a' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#888' }}>FP:</span>
              <span style={{ color: fpColor, fontWeight: 500 }}>{forceMetrics.firepower_index}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#888' }}>VEH:</span>
              <span style={{ color: '#a0a0a0', fontWeight: 500 }}>{forceMetrics.vehicles_active}/{forceMetrics.vehicles_total}</span>
            </div>
          </>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ color: '#888', letterSpacing: '1px' }}>{unitCount} units</span>
        {contactCount > 0 && <span style={{ color: '#888', letterSpacing: '1px' }}>{contactCount} contacts</span>}
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: '#888', letterSpacing: '2px' }}>
          SPECTRE C2 v1.4.2
        </div>
      </div>
    </div>
  );
}
