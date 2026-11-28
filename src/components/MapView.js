import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@blueprintjs/core';
import { symbolFor } from './milSymbols';
import { gridRef } from './unitFormat';
import { hasTerrain, loadTerrain, terrainLayer } from './terrain';
import { trackPosition, trails, routes } from './tracks';

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
    maxZoom: 4, defaultZoom: 2, tileSize: 226, worldSize: 8192,
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
    maxZoom: 6, defaultZoom: 3, tileSize: 212, worldSize: 30720,
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
    maxZoom: 5, defaultZoom: 2, tileSize: 213, worldSize: 15360,
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
    maxZoom: 4, defaultZoom: 2, tileSize: 356, worldSize: 12800,
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
    maxZoom: 4, defaultZoom: 2, tileSize: 356, worldSize: 12800,
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
    maxZoom: 5, defaultZoom: 2, tileSize: 186, worldSize: 12800,
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

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// A standard symbol with the name beside it. The symbol's anchor point sits on
// the position; a square bracket marks selection.
function markerIcon(item, side, selected, label, tone) {
  const symbol = symbolFor(item, side, 19);
  const classes = [
    'sym', `sym--${side}`,
    selected ? 'is-selected' : '',
    item.state === 'LAST_KNOWN' || item.state === 'DEAD' ? 'is-old' : '',
    item.status === 'DESTROYED' || item.status === 'DEAD' ? 'is-down' : '',
  ].join(' ');
  return L.divIcon({
    className: '',
    iconSize: [symbol.width, symbol.height],
    iconAnchor: [symbol.anchor.x, symbol.anchor.y],
    html: `<div class="${classes}">${symbol.svg}<span class="sym__label${tone ? ` tone-${tone}` : ''}">${escapeHtml(label)}</span></div>`,
  });
}

function makeUnitIcon(unit, selected) {
  const hp = unit.health ?? 100;
  const note = hp <= 60 ? ` ${Math.round(hp)}%` : '';
  return markerIcon(unit, 'friend', selected, `${unit.callsign || unit.id}${note}`, hp <= 30 ? 'bad' : hp <= 60 ? 'warn' : '');
}

function makeContactIcon(contact, selected) {
  const age = contact.state === 'LAST_KNOWN' ? ' (last known)' : '';
  return markerIcon(contact, 'hostile', selected, `${contact.id || '?'}${age}`, '');
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MapView({
  units, contacts, zones,
  selectedUnit, selectedUnits,
  selectedContact,
  selectedCOA, showCOAOverlay,
  mapName,
  pendingAction,
  onUnitSelect, onUnitRightClick, onContactSelect, onMapRightClick, onMapClick
}) {
  const mapRef      = useRef(null);
  const cursorRef   = useRef(null);
  const baseRef     = useRef(null);
  const trailLayer  = useRef(null);
  const [routeTick, setRouteTick] = useState(0);
  const mapInst     = useRef(null);
  const unitLayer   = useRef(null);
  const contactLayer = useRef(null);
  const coaLayer    = useRef(null);
  const [dismissOverlay, setDismissOverlay] = useState(false);
  const currentMapRef = useRef(null);
  const prevUnitCountRef = useRef(0);
  const qHeldRef = useRef(false);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onMapRightClickRef = useRef(onMapRightClick);
  onMapRightClickRef.current = onMapRightClick;
  const onUnitRightClickRef = useRef(onUnitRightClick);
  onUnitRightClickRef.current = onUnitRightClick;

  useEffect(() => {
    const kd = (e) => { if (e.key === 'q' || e.key === 'Q') qHeldRef.current = true; };
    const ku = (e) => { if (e.key === 'q' || e.key === 'Q') qHeldRef.current = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

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
      maxZoom: config ? config.maxZoom + 4 : 12,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5
    });

    // Dark background behind tiles
    mapRef.current.style.background = 'var(--bg-deepest)';

    const chart = () => (config
      ? L.tileLayer(TILE_BASE + config.tilePattern, {
        attribution: config.attribution,
        tileSize: config.tileSize,
        maxZoom: config.maxZoom + 4,
        maxNativeZoom: config.maxZoom,
        minZoom: 0
      })
      : L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { opacity: 0.15 }));

    // "Terrain" is drawn from the game's data; "chart" is the published map,
    // which also carries place names.
    let base = null;
    let wanted = null;
    const showBase = (kind) => {
      wanted = kind;
      const swap = (layer) => {
        if (base) map.removeLayer(base);
        base = layer.addTo(map);
        base.bringToBack?.();
        mapRef.current.classList.toggle('base-chart', kind === 'chart');
      };
      if (kind === 'terrain' && hasTerrain(mapName)) {
        loadTerrain(mapName)
          .then((terrain) => { if (mapInst.current === map && wanted === 'terrain') swap(terrainLayer(terrain)); })
          .catch(() => { if (mapInst.current === map) swap(chart()); });
      } else {
        wanted = 'chart';
        kind = 'chart';
        swap(chart());
      }
    };
    baseRef.current = {
      toggle: () => {
        const next = wanted === 'terrain' ? 'chart' : 'terrain';
        try { localStorage.setItem('spectre.basemap', next); } catch (_) {}
        showBase(next);
      },
    };
    let saved = null;
    try { saved = localStorage.getItem('spectre.basemap'); } catch (_) {}
    mapInst.current = map;
    showBase(saved === 'chart' ? 'chart' : 'terrain');
    L.control.scale({ metric: true, imperial: false, position: 'topright', maxWidth: 140 }).addTo(map);
    trailLayer.current = L.layerGroup().addTo(map);

    // Grid under the pointer, written straight to the page to avoid re-renders.
    map.on('mousemove', (e) => {
      if (cursorRef.current) cursorRef.current.textContent = gridRef({ x: e.latlng.lng, y: e.latlng.lat });
    });

    map.on('contextmenu', (e) => {
      if (onMapRightClickRef.current) onMapRightClickRef.current(e.latlng, e.originalEvent.clientX, e.originalEvent.clientY);
    });

    map.on('click', (e) => {
      if (onMapClickRef.current) {
        onMapClickRef.current(e.latlng.lng, e.latlng.lat);
      }
    });

    unitLayer.current    = L.layerGroup().addTo(map);
    contactLayer.current = L.layerGroup().addTo(map);
    coaLayer.current     = L.layerGroup().addTo(map);

    prevUnitCountRef.current = 0;
  }, [mapName]);

  // Floating panels cover the map's edges; their widths come from the layout.
  const fitPadding = () => {
    const css = getComputedStyle(mapRef.current);
    const left = parseFloat(css.getPropertyValue('--inset-left')) || 0;
    const right = parseFloat(css.getPropertyValue('--inset-right')) || 0;
    return { paddingTopLeft: [left + 80, 90], paddingBottomRight: [right + 80, 150] };
  };

  // Fitting never zooms far past the sharpest tiles, or the map turns to mush.
  const fitZoom = () => {
    const config = getMapConfig(currentMapRef.current);
    return config ? config.maxZoom + 0.5 : mapInst.current.getMaxZoom() - 1;
  };

  // Buttons in the floating map toolbar.
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  useEffect(() => {
    const onTool = (e) => {
      const map = mapInst.current;
      if (!map) return;
      if (e.detail === 'basemap') baseRef.current?.toggle();
      if (e.detail === 'zoomIn') map.zoomIn();
      if (e.detail === 'zoomOut') map.zoomOut();
      if (e.detail === 'fit') {
        const points = [...Object.values(unitsRef.current || {}), ...Object.values(contactsRef.current || {})]
          .map(u => getUnitLatLng(u.position)).filter(Boolean);
        if (points.length) map.fitBounds(L.latLngBounds(points), { ...fitPadding(), maxZoom: fitZoom() });
      }
    };
    window.addEventListener('spectre:map', onTool);
    return () => window.removeEventListener('spectre:map', onTool);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Where units have been, and where they were told to go ──────────────────
  useEffect(() => {
    const redraw = () => setRouteTick(t => t + 1);
    window.addEventListener('spectre:routes', redraw);
    return () => window.removeEventListener('spectre:routes', redraw);
  }, []);

  useEffect(() => {
    const layer = trailLayer.current;
    if (!layer) return;
    layer.clearLayers();
    Object.values(units || {}).forEach(unit => {
      if (!unit.position) return;
      trackPosition(mapName, unit);
      const path = trails.get(unit.id) || [];
      // Older parts of the trail fade out.
      for (let i = 1; i < path.length; i++) {
        L.polyline([[path[i - 1].y, path[i - 1].x], [path[i].y, path[i].x]], {
          color: '#4fd6ff', weight: 2.5, opacity: 0.15 + 0.6 * (i / path.length), interactive: false,
        }).addTo(layer);
      }
      const to = routes.get(unit.id);
      if (to) {
        L.polyline([[unit.position.y, unit.position.x], [to.y, to.x]], { color: '#eaf9ff', weight: 1.5, dashArray: '7 6', opacity: 0.95, interactive: false }).addTo(layer);
        L.circleMarker([to.y, to.x], { radius: 7, color: '#eaf9ff', weight: 1.5, fill: false, interactive: false }).addTo(layer);
        L.circleMarker([to.y, to.x], { radius: 2, color: '#eaf9ff', fillColor: '#eaf9ff', fillOpacity: 1, interactive: false }).addTo(layer);
      }
    });
  }, [units, mapName, routeTick]);

  // ── Update unit markers ────────────────────────────────────────────────────
  useEffect(() => {
    if (!unitLayer.current) return;
    unitLayer.current.clearLayers();

    Object.values(units || {}).forEach(unit => {
      const latlng = getUnitLatLng(unit.position);
      if (!latlng) return;

      const isSelected = unit.id === selectedUnit || (selectedUnits && selectedUnits.includes(unit.id));
      const marker = L.marker(latlng, { icon: makeUnitIcon(unit, isSelected) });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (qHeldRef.current) {
          onUnitRightClickRef.current && onUnitRightClickRef.current(unit.id, e.originalEvent.clientX, e.originalEvent.clientY);
        } else {
          onUnitSelect(unit.id, e.originalEvent.ctrlKey || e.originalEvent.metaKey);
        }
      });
      if (onUnitRightClickRef.current) {
        marker.on('contextmenu', (e) => {
          L.DomEvent.stopPropagation(e);
          onUnitRightClickRef.current(unit.id, e.originalEvent.clientX, e.originalEvent.clientY);
        });
      }

      marker.bindTooltip(
        `<div class="map-tip">
          <b>${escapeHtml(unit.callsign || unit.id)}</b>
          <span>${escapeHtml(unit.vehicle_type || '')} · health ${unit.health ?? 100}% · fuel ${unit.fuel ?? 100}%</span>
          <span>${escapeHtml(unit.current_order || unit.status || '')}</span>
        </div>`,
        { className: 'spectre-tooltip', permanent: false, direction: 'top', offset: [0, -20] }
      );

      unitLayer.current.addLayer(marker);
    });

    // Auto-fit bounds only when units first appear or count changes
    if (mapInst.current) {
      const unitList = Object.values(units).filter(u => u.position);
      const latlngs = unitList.map(u => getUnitLatLng(u.position)).filter(Boolean);
      if (latlngs.length > 0 && latlngs.length !== prevUnitCountRef.current) {
        prevUnitCountRef.current = latlngs.length;
        if (latlngs.length === 1) {
          mapInst.current.setView(latlngs[0], mapInst.current.getZoom());
        } else {
          const everything = [...latlngs, ...Object.values(contactsRef.current || {}).map(c => getUnitLatLng(c.position)).filter(Boolean)];
          mapInst.current.fitBounds(L.latLngBounds(everything), { ...fitPadding(), maxZoom: fitZoom() });
        }
      }
    }
  }, [units, selectedUnit, selectedUnits, onUnitSelect, mapName]);

  // ── Update contact markers ─────────────────────────────────────────────────
  useEffect(() => {
    if (!contactLayer.current) return;
    contactLayer.current.clearLayers();

    Object.values(contacts || {}).forEach(contact => {
      const latlng = getUnitLatLng(contact.position);
      if (!latlng) return;

      const marker = L.marker(latlng, { icon: makeContactIcon(contact, contact.id === selectedContact) });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        onContactSelect(contact.id);
      });

      const ageMin = contact.last_seen ? Math.floor((Date.now() - contact.last_seen) / 60000) : 0;
      marker.bindTooltip(
        `<div class="map-tip map-tip--hot">
          <b>${escapeHtml(contact.id)}</b>
          <span>${escapeHtml(contact.type || 'Unknown')} · ${escapeHtml(String(contact.state || '').replace('_', ' ').toLowerCase())}</span>
          <span>${escapeHtml(contact.source || 'UNKNOWN')} · ${ageMin > 0 ? `seen ${ageMin} min ago` : 'just spotted'}</span>
        </div>`,
        { className: 'spectre-tooltip', permanent: false, direction: 'top', offset: [0, -20] }
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
        <div className="map-empty">
          <Button className="map-empty__close" minimal small icon="cross" onClick={() => setDismissOverlay(true)} aria-label="Dismiss" />
          <h2>Waiting for Arma</h2>
          <p>Start Arma 3 with @SPECTRE enabled and load a mission with BLUFOR units.</p>
        </div>
      )}

      <div className="map-readout">
        <span>{mapName || 'No map'}</span>
        <span>Grid <b ref={cursorRef}>—</b></span>
      </div>
    </div>
  );
}
