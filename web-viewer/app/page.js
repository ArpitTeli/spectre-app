'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

const VEHICLE_SYMBOL = { MBT: '▲', IFV: '■', APC: '◆', RECON: '◇', HELI: '✦', TRUCK: '▪', INFANTRY: '●', DEFAULT: '○' };

export default function Home() {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const unitLayer = useRef(null);
  const contactLayer = useRef(null);
  const [connected, setConnected] = useState(false);
  const [unitCount, setUnitCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [mapName, setMapName] = useState(null);

  const TILE_MAPS = {
    stratis: { pattern: '/maps/stratis/{z}/{x}/{y}.png', maxZoom: 4, tileSize: 226 },
    altis:   { pattern: '/maps/altis/{z}/{x}/{y}.png',   maxZoom: 6, tileSize: 212 },
    tanoa:   { pattern: '/maps/tanoa/{z}/{x}/{y}.png',   maxZoom: 5, tileSize: 213 },
    enoch:   { pattern: '/maps/enoch/{z}/{x}/{y}.png',   maxZoom: 4, tileSize: 356 },
    livonia: { pattern: '/maps/enoch/{z}/{x}/{y}.png',   maxZoom: 4, tileSize: 356 },
    malden:  { pattern: '/maps/malden/{z}/{x}/{y}.png',  maxZoom: 5, tileSize: 186 },
  };

  const TILE_BASE = 'https://jetelain.github.io/Arma3Map';

  const makeUnitIcon = useCallback((unit) => {
    const symbol = VEHICLE_SYMBOL[unit.vehicle_type || unit.vtype] || VEHICLE_SYMBOL.DEFAULT;
    const hp = unit.health ?? unit.hp ?? 100;
    const hpColor = hp > 60 ? '#2a7de1' : hp > 30 ? '#f5a623' : '#db3838';
    const status = unit.status || unit.st || 'OK';
    const dead = status === 'DEAD' || status === 'DESTROYED';
    const opacity = dead ? 0.3 : 1;

    return {
      className: '',
      iconSize: [60, 50],
      iconAnchor: [30, 25],
      html: `<div style="opacity:${opacity};display:flex;flex-direction:column;align-items:center">
        <div style="background:rgba(27,27,27,0.95);border:1px solid ${dead ? '#525252' : '#2a7de1'};border-radius:3px;padding:2px 6px;font-family:monospace;font-size:9px;font-weight:600;color:#f5f6f7;white-space:nowrap;margin-bottom:2px">${unit.callsign || unit.id}</div>
        <div style="font-size:14px;line-height:1;color:${dead ? '#525252' : '#2a7de1'}">${symbol}</div>
        <div style="width:24px;height:3px;background:rgba(42,42,42,0.8);border-radius:2px;overflow:hidden;margin-top:2px">
          <div style="width:${hp}%;height:100%;background:${hpColor};border-radius:2px"></div>
        </div>
      </div>`
    };
  }, []);

  const makeContactIcon = useCallback((contact) => {
    const stateColors = { CONFIRMED: '#db3838', LAST_KNOWN: '#e87c3e', SUSPECTED: '#f5a623' };
    const color = stateColors[contact.state] || '#db3838';
    const label = contact.id || '?';

    return {
      className: '',
      iconSize: [50, 40],
      iconAnchor: [25, 20],
      html: `<div style="display:flex;flex-direction:column;align-items:center">
        <div style="background:rgba(27,27,27,0.95);border:1px solid ${color};border-radius:3px;padding:2px 6px;font-family:monospace;font-size:9px;font-weight:600;color:${color};white-space:nowrap;margin-bottom:2px">${label}</div>
        <div style="font-size:12px;line-height:1;color:${color}">●</div>
      </div>`
    };
  }, []);

  const getLatLng = useCallback((pos) => {
    if (!pos) return null;
    if (pos.lat !== undefined && pos.lng !== undefined) return [pos.lat, pos.lng];
    if (pos.x !== undefined && pos.y !== undefined) return [pos.y, pos.x];
    return null;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const L = require('leaflet');

    if (mapInst.current) return;

    const map = L.map(mapRef.current, {
      crs: L.CRS.Simple,
      center: [4100, 4100],
      zoom: 2,
      maxZoom: 8,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5
    });

    L.control.zoom({ position: 'topright' }).addTo(map);
    unitLayer.current = L.layerGroup().addTo(map);
    contactLayer.current = L.layerGroup().addTo(map);
    mapInst.current = map;

    return () => { map.remove(); mapInst.current = null; };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const L = require('leaflet');

    const poll = async () => {
      try {
        const res = await fetch('/api/state');
        const data = await res.json();

        if (!data.state) {
          setConnected(false);
          return;
        }

        setConnected(data.age < 10000);
        setLastUpdate(data.lastUpdate);

        const state = data.state;
        const units = state.units || [];
        const contacts = state.contacts || [];

        setUnitCount(units.length);

        // Update map tiles if map changed
        const newMap = (state.mapName || '').toLowerCase();
        if (newMap && newMap !== mapName && mapInst.current) {
          setMapName(newMap);
          const config = TILE_MAPS[newMap];
          if (config) {
            mapInst.current.eachLayer(layer => {
              if (layer._url) mapInst.current.removeLayer(layer);
            });
            L.tileLayer(TILE_BASE + config.pattern, {
              tileSize: config.tileSize,
              maxZoom: config.maxZoom + 4,
              maxNativeZoom: config.maxZoom,
              minZoom: 0
            }).addTo(mapInst.current);
          }
        }

        // Update unit markers
        if (unitLayer.current) {
          unitLayer.current.clearLayers();
          const latlngs = [];
          for (const u of units) {
            const ll = getLatLng(u.position || u.pos);
            if (!ll) continue;
            latlngs.push(ll);
            const icon = L.divIcon(makeUnitIcon(u));
            const marker = L.marker(ll, { icon });
            marker.bindTooltip(
              `<div style="font-family:monospace;font-size:11px;background:#1b1b1b;border:1px solid #3a3a3a;padding:6px;border-radius:3px">
                <b style="color:#2a7de1">${u.callsign || u.id}</b><br>
                ${u.vehicle_type || u.vtype || ''} | HP:${u.health ?? u.hp ?? 100}%<br>
                Status: ${u.status || u.st || 'OK'}
              </div>`,
              { permanent: false, direction: 'top' }
            );
            unitLayer.current.addLayer(marker);
          }
          if (latlngs.length > 0 && mapInst.current) {
            if (latlngs.length === 1) {
              mapInst.current.setView(latlngs[0], Math.max(mapInst.current.getZoom(), 3));
            } else {
              mapInst.current.fitBounds(L.latLngBounds(latlngs), { padding: [60, 60] });
            }
          }
        }

        // Update contact markers
        if (contactLayer.current) {
          contactLayer.current.clearLayers();
          for (const c of contacts) {
            const ll = getLatLng(c.position || c.pos);
            if (!ll) continue;
            const icon = L.divIcon(makeContactIcon(c));
            const marker = L.marker(ll, { icon });
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
  }, [mapName, makeUnitIcon, makeContactIcon, getLatLng]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div style={{ background: '#1b1b1b', color: '#f5f6f7', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: '#212121', borderBottom: '1px solid #2a2a2a', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px', height: '40px', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '2px', color: '#2a7de1' }}>SPECTRE</span>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#2a7de1' : '#db3838' }} />
          <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#888' }}>
            {connected ? 'LIVE' : 'WAITING FOR DATA'}
          </span>
          {unitCount > 0 && (
            <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#888' }}>{unitCount} units</span>
          )}
          {mapName && (
            <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#525252', marginLeft: 'auto' }}>{mapName.toUpperCase()}</span>
          )}
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%', background: '#141414' }} />
          <div style={{ position: 'absolute', bottom: 10, left: 10, background: 'rgba(27,27,27,0.95)', border: '1px solid #2a2a2a', borderRadius: 3, padding: '8px 12px', fontFamily: 'monospace', fontSize: 10, zIndex: 1000, pointerEvents: 'none' }}>
            <div style={{ color: '#888', marginBottom: 4, letterSpacing: 1 }}>LEGEND</div>
            <div style={{ color: '#2a7de1', marginBottom: 2 }}>○ FRIENDLY</div>
            <div style={{ color: '#db3838' }}>● HOSTILE</div>
          </div>
          {!connected && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', zIndex: 1000 }}>
              <div style={{ background: 'rgba(27,27,27,0.95)', border: '1px solid #3a3a3a', borderRadius: 3, padding: '20px 30px' }}>
                <div style={{ fontSize: 24, marginBottom: 8, color: '#525252' }}>◎</div>
                <div style={{ fontWeight: 600, letterSpacing: 1 }}>WAITING FOR DATA</div>
                <div style={{ marginTop: 6, fontSize: 10, color: '#888' }}>Start SPECTRE C2 + Arma 3 to see live positions</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
