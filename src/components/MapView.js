import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ─── Arma 3 Map Configs (from jetelain/Arma3Map) ─────────────────────────────
// In this CRS: lat = Arma Y (northing), lng = Arma X (easting) — both in meters
const TILE_BASE = 'https://jetelain.github.io/Arma3Map';

const ARMA_MAPS = {
  stratis: {
    crs: (() => {
      const f = 0.027475, tw = 226;
      return L.extend({}, L.CRS.Simple, {
        projection: L.Projection.LonLat,
        transformation: new L.Transformation(f, 0, -f, tw),
        scale: z => Math.pow(2, z),
        zoom: s => Math.log(s) / Math.LN2,
        infinite: true
      });
    })(),
    tilePattern: '/maps/stratis/{z}/{x}/{y}.png',
    maxZoom: 8, defaultZoom: 2, tileSize: 226, worldSize: 8192,
    center: [4100, 4100]
  },
  altis: {
    crs: (() => {
      const fx = 0.006839, fy = 0.006836, tw = 212;
      return L.extend({}, L.CRS.Simple, {
        projection: L.Projection.LonLat,
        transformation: new L.Transformation(fx, 0, -fy, tw),
        scale: z => Math.pow(2, z),
        zoom: s => Math.log(s) / Math.LN2,
        infinite: true
      });
    })(),
    tilePattern: '/maps/altis/{z}/{x}/{y}.png',
    maxZoom: 10, defaultZoom: 3, tileSize: 212, worldSize: 30720,
    center: [15000, 15000]
  },
  tanoa: {
    crs: (() => {
      const f = 0.01385, tw = 213;
      return L.extend({}, L.CRS.Simple, {
        projection: L.Projection.LonLat,
        transformation: new L.Transformation(f, 0, -f, tw),
        scale: z => Math.pow(2, z),
        zoom: s => Math.log(s) / Math.LN2,
        infinite: true
      });
    })(),
    tilePattern: '/maps/tanoa/{z}/{x}/{y}.png',
    maxZoom: 9, defaultZoom: 2, tileSize: 213, worldSize: 15360,
    center: [7000, 7000]
  },
  enoch: {
    crs: (() => {
      const f = 0.02735, tw = 356;
      return L.extend({}, L.CRS.Simple, {
        projection: L.Projection.LonLat,
        transformation: new L.Transformation(f, 0, -f, tw),
        scale: z => Math.pow(2, z),
        zoom: s => Math.log(s) / Math.LN2,
        infinite: true
      });
    })(),
    tilePattern: '/maps/enoch/{z}/{x}/{y}.png',
    maxZoom: 8, defaultZoom: 2, tileSize: 356, worldSize: 12800,
    center: [7100, 7100]
  },
  livonia: {
    crs: (() => {
      const f = 0.02735, tw = 356;
      return L.extend({}, L.CRS.Simple, {
        projection: L.Projection.LonLat,
        transformation: new L.Transformation(f, 0, -f, tw),
        scale: z => Math.pow(2, z),
        zoom: s => Math.log(s) / Math.LN2,
        infinite: true
      });
    })(),
    tilePattern: '/maps/enoch/{z}/{x}/{y}.png',
    maxZoom: 8, defaultZoom: 2, tileSize: 356, worldSize: 12800,
    center: [7100, 7100]
  },
  malden: {
    crs: (() => {
      const f = 0.01448, tw = 186;
      return L.extend({}, L.CRS.Simple, {
        projection: L.Projection.LonLat,
        transformation: new L.Transformation(f, 0, -f, tw),
        scale: z => Math.pow(2, z),
        zoom: s => Math.log(s) / Math.LN2,
        infinite: true
      });
    })(),
    tilePattern: '/maps/malden/{z}/{x}/{y}.png',
    maxZoom: 9, defaultZoom: 2, tileSize: 186, worldSize: 12800,
    center: [7000, 7000]
  }
};

// Fallback for unknown maps: simple CRS with 1:1 meter mapping
function makeFallbackCRS() {
  return L.extend({}, L.CRS.Simple, {
    projection: L.Projection.LonLat,
    transformation: new L.Transformation(1, 0, -1, 0),
    scale: z => Math.pow(2, z),
    zoom: s => Math.log(s) / Math.LN2,
    infinite: true
  });
}

function getMapConfig(mapName) {
  if (!mapName) return null;
  return ARMA_MAPS[mapName.toLowerCase()] || null;
}

// Convert Arma position to Leaflet LatLng for this CRS
// In Arma3Map CRS: lat = Y (northing), lng = X (easting)
function getUnitLatLng(position) {
  if (!position) return null;
  if (position.x !== undefined && position.y !== undefined) {
    return [position.y, position.x];
  }
  if (position.lat !== undefined && position.lng !== undefined) {
    return [position.lat, position.lng];
  }
  return null;
}

// ─── Icon factories ───────────────────────────────────────────────────────────
const VEHICLE_SYMBOL = { MBT: '▲', IFV: '■', APC: '◆', RECON: '◇', HELI: '✦', TRUCK: '▪', INFANTRY: '●', DEFAULT: '○' };
const CONTACT_SYMBOL = { INFANTRY: '●', VEHICLE: '■', TANK: '▲', UNKNOWN: '?' };

function makeUnitIcon(unit, selected) {
  const symbol = VEHICLE_SYMBOL[unit.vehicle_type] || VEHICLE_SYMBOL.DEFAULT;
  const hp = unit.health ?? 100;
  const hpColor = hp > 60 ? '#22c55e' : hp > 30 ? '#eab308' : '#ef4444';
  const borderColor = selected ? '#22c55e' : '#3b82f6';
  const glow = selected ? '6px rgba(34,197,94,0.6)' : '3px rgba(59,130,246,0.4)';

  return L.divIcon({
    className: '',
    iconSize: [64, 54],
    iconAnchor: [32, 27],
    html: `<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 0 ${glow})">
      <div style="background:rgba(15,23,42,0.92);border:1px solid ${borderColor};border-radius:3px;padding:2px 6px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:600;color:#f1f5f9;letter-spacing:0.5px;white-space:nowrap;margin-bottom:2px">${unit.callsign || unit.id}</div>
      <div style="font-size:16px;line-height:1;color:${borderColor}">${symbol}</div>
      <div style="width:28px;height:3px;background:rgba(30,41,59,0.8);border-radius:2px;overflow:hidden;margin-top:2px">
        <div style="width:${hp}%;height:100%;background:${hpColor};border-radius:2px"></div>
      </div>
    </div>`
  });
}

function makeContactIcon(contact, selected) {
  const symbol = CONTACT_SYMBOL[contact.type] || CONTACT_SYMBOL.UNKNOWN;
  const colors = {
    CONFIRMED:  { border: '#ef4444', glow: 'rgba(239,68,68,0.5)',  text: '#fca5a5', opacity: 1.0 },
    LAST_KNOWN: { border: '#f97316', glow: 'rgba(249,115,22,0.4)', text: '#fdba74', opacity: 0.7 },
    SUSPECTED:  { border: '#eab308', glow: 'rgba(234,179,8,0.4)',  text: '#fde047', opacity: 0.6 }
  };
  const c = colors[contact.state] || colors.SUSPECTED;
  const label = contact.state === 'SUSPECTED' ? '?' : (contact.id || '?').split('-').pop();

  return L.divIcon({
    className: '',
    iconSize: [52, 42],
    iconAnchor: [26, 21],
    html: `<div style="opacity:${c.opacity};display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 0 3px ${c.glow})">
      <div style="background:rgba(15,23,42,0.92);border:1px solid ${c.border};border-radius:3px;padding:2px 6px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:600;color:${c.text};letter-spacing:0.5px;margin-bottom:2px">${label}</div>
      <div style="font-size:14px;line-height:1;color:${c.border}">${symbol}</div>
    </div>`
  });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MapView({
  units, contacts, zones,
  selectedUnit, selectedContact,
  selectedCOA, showCOAOverlay,
  mapName,
  onUnitSelect, onContactSelect
}) {
  const mapRef      = useRef(null);
  const mapInst     = useRef(null);
  const unitLayer   = useRef(null);
  const contactLayer = useRef(null);
  const coaLayer    = useRef(null);
  const [dismissOverlay, setDismissOverlay] = useState(false);
  const currentMapRef = useRef(null);

  // ── Create/recreate map when mapName changes ────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;

    const mapKey = (mapName || '').toLowerCase();

    // Only recreate if map changed
    if (mapKey === currentMapRef.current) return;
    currentMapRef.current = mapKey;

    // Destroy old map
    if (mapInst.current) {
      mapInst.current.remove();
      mapInst.current = null;
    }

    const config = getMapConfig(mapName);
    const crs = config ? config.crs : makeFallbackCRS();
    const center = config ? config.center : [4000, 4000];
    const zoom = config ? config.defaultZoom : 2;

    const map = L.map(mapRef.current, {
      crs: crs,
      center: center,
      zoom: zoom,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true
    });

    if (config) {
      L.tileLayer(TILE_BASE + config.tilePattern, {
        attribution: config.attribution,
        tileSize: config.tileSize,
        maxZoom: config.maxZoom,
        minZoom: 0
      }).addTo(map);
    } else {
      // Fallback: dark grid for unknown maps
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        opacity: 0.15
      }).addTo(map);
    }

    L.control.zoom({ position: 'topright' }).addTo(map);

    unitLayer.current    = L.layerGroup().addTo(map);
    contactLayer.current = L.layerGroup().addTo(map);
    coaLayer.current     = L.layerGroup().addTo(map);

    mapInst.current = map;
  }, [mapName]);

  // ── Update unit markers ────────────────────────────────────────────────────
  useEffect(() => {
    if (!unitLayer.current) return;
    unitLayer.current.clearLayers();

    Object.values(units).forEach(unit => {
      const latlng = getUnitLatLng(unit.position);
      if (!latlng) return;

      const marker = L.marker(latlng, { icon: makeUnitIcon(unit, unit.id === selectedUnit) });

      marker.on('click', () => onUnitSelect(unit.id));

      marker.bindTooltip(
        `<div style="font-family:monospace;font-size:11px;background:#0d1520;border:1px solid #1a2d45;padding:6px;border-radius:3px">
          <b style="color:#00b4ff">${unit.callsign}</b><br>
          ${unit.vehicle_type} | HP:${unit.health ?? 100}% Fuel:${unit.fuel ?? 100}%<br>
          Status: ${unit.status || 'UNKNOWN'}<br>
          ${unit.current_order ? `<span style="color:#7a9ab8">▶ ${unit.current_order}</span>` : ''}
        </div>`,
        { className: 'spectre-tooltip', permanent: false, direction: 'top' }
      );

      unitLayer.current.addLayer(marker);
    });

    // Auto-fit bounds to all units
    if (mapInst.current) {
      const unitList = Object.values(units).filter(u => u.position);
      const latlngs = unitList.map(u => getUnitLatLng(u.position)).filter(Boolean);
      if (latlngs.length > 0) {
        const bounds = L.latLngBounds(latlngs);
        if (latlngs.length === 1) {
          mapInst.current.setView(latlngs[0], mapInst.current.getZoom());
        } else {
          mapInst.current.fitBounds(bounds, { padding: [80, 80], maxZoom: mapInst.current.getMaxZoom() - 1 });
        }
      }
    }
  }, [units, selectedUnit, onUnitSelect, mapName]);

  // ── Update contact markers ─────────────────────────────────────────────────
  useEffect(() => {
    if (!contactLayer.current) return;
    contactLayer.current.clearLayers();

    Object.values(contacts).forEach(contact => {
      const latlng = getUnitLatLng(contact.position);
      if (!latlng) return;

      const marker = L.marker(latlng, { icon: makeContactIcon(contact, contact.id === selectedContact) });

      marker.on('click', () => onContactSelect(contact.id));

      const ageMin = contact.last_seen ? Math.floor((Date.now() - contact.last_seen) / 60000) : 0;
      marker.bindTooltip(
        `<div style="font-family:monospace;font-size:11px;background:#0d1520;border:1px solid #1a2d45;padding:6px;border-radius:3px">
          <b style="color:#ff6666">${contact.id}</b><br>
          Type: ${contact.type} | State: <b style="color:${contact.state === 'CONFIRMED' ? '#ff4444' : contact.state === 'LAST_KNOWN' ? '#ff6b35' : '#ffaa00'}">${contact.state}</b><br>
          Source: ${contact.source || 'UNKNOWN'}<br>
          ${ageMin > 0 ? `Last seen: ${ageMin}m ago` : 'Just spotted'}
        </div>`,
        { className: 'spectre-tooltip', permanent: false, direction: 'top' }
      );

      contactLayer.current.addLayer(marker);
    });
  }, [contacts, selectedContact, onContactSelect, mapName]);

  // ── Draw COA overlays ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!coaLayer.current) return;
    coaLayer.current.clearLayers();

    if (!selectedCOA || !showCOAOverlay) return;

    (selectedCOA.phases || []).forEach((phase, phaseIdx) => {
      const hue = 200 + phaseIdx * 50;
      const color = `hsl(${hue}, 80%, 60%)`;

      (phase.unit_orders || []).forEach(order => {
        const unit = Object.values(units).find(u => u.id === order.unit_id || u.callsign === order.callsign);
        if (!order.waypoints?.length) return;

        const startLatLng = unit ? getUnitLatLng(unit.position) : null;
        const wpLatLngs = order.waypoints
          .map(wp => getUnitLatLng({ x: wp.x, y: wp.y }))
          .filter(Boolean);

        if (wpLatLngs.length === 0) return;

        const points = startLatLng ? [startLatLng, ...wpLatLngs] : wpLatLngs;

        L.polyline(points, { color, weight: 2, dashArray: '6,4', opacity: 0.85 })
          .addTo(coaLayer.current);

        wpLatLngs.forEach((latlng, i) => {
          L.circleMarker(latlng, { radius: 5, color, fillColor: color, fillOpacity: 0.8, weight: 2 })
            .bindTooltip(`<div style="font-family:monospace;font-size:10px">${order.callsign}: ${order.waypoints[i]?.description || `WP${i + 1}`}</div>`)
            .addTo(coaLayer.current);
        });
      });
    });
  }, [selectedCOA, showCOAOverlay, units, mapName]);

  return (
    <div className="map-container">
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {Object.keys(units).length === 0 && !dismissOverlay && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center', zIndex: 1000
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '12px',
            color: 'var(--text-muted)', background: 'rgba(7,11,16,0.9)',
            padding: '20px 30px', borderRadius: '4px',
            border: '1px solid var(--border-primary)',
            position: 'relative'
          }}>
            <button onClick={() => setDismissOverlay(true)}
              style={{
                position: 'absolute', top: '4px', right: '8px',
                background: 'none', border: 'none',
                color: 'var(--text-muted)', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: '14px',
                padding: '2px 6px', lineHeight: 1
              }}
            >✕</button>
            <div style={{ fontSize: '24px', marginBottom: '8px', color: 'var(--text-muted)' }}>◎</div>
            <div style={{ fontWeight: 600, letterSpacing: '1px' }}>AWAITING ARMA CONNECTION</div>
            <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)' }}>
              Load SPECTRE_bridge.sqf in your Arma 3 mission
            </div>
          </div>
        </div>
      )}

      <div style={{
        position: 'absolute', bottom: '10px', left: '10px',
        background: 'rgba(15,23,42,0.92)', border: '1px solid var(--border-subtle)',
        borderRadius: '4px', padding: '8px 12px', zIndex: 1000,
        fontFamily: 'var(--font-mono)', fontSize: '10px', pointerEvents: 'none',
        backdropFilter: 'blur(8px)'
      }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: '5px', letterSpacing: '1px', fontWeight: 600 }}>LEGEND</div>
        <div style={{ color: 'var(--color-friendly)',  marginBottom: '2px' }}>○ FRIENDLY</div>
        <div style={{ color: 'var(--color-hostile)',   marginBottom: '2px' }}>● CONFIRMED HOSTILE</div>
        <div style={{ color: 'var(--color-last-known)',marginBottom: '2px', opacity: 0.7 }}>● LAST KNOWN</div>
        <div style={{ color: 'var(--color-suspected)', opacity: 0.6 }}>● SUSPECTED</div>
      </div>

      {mapName && (
        <div style={{
          position: 'absolute', top: '10px', left: '10px',
          background: 'rgba(15,23,42,0.92)', border: '1px solid var(--border-subtle)',
          borderRadius: '4px', padding: '6px 10px', zIndex: 1000,
          fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-primary)',
          letterSpacing: '1px', fontWeight: 600
        }}>
          {mapName.toUpperCase()}
        </div>
      )}
    </div>
  );
}
