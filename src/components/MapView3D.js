import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';

const MAP = 8192;
const HALF = MAP / 2;
const RES = 511;   // terrain cells per side: one vertex per heightmap pixel
const EXAG = 1.5;
const SAT_ZOOM = 3;
const TS = 226;
const CRS_SCALE = TS / 0.027475;

const MODEL_WORLD_SIZE = {
  helicopter: 28,
  tank: 8,
  vehicle: 14,
  jeep: 5,
  infantry: 2,
};

const MODEL_HEIGHT_OFFSET = {
  helicopter: 8,
  tank: 3,
  vehicle: 3,
  jeep: 3,
  infantry: 1.5,
};

function loadSatTiles() {
  return new Promise((resolve) => {
    const tpr = Math.pow(2, SAT_ZOOM);
    const out = tpr * TS;
    const c = document.createElement('canvas');
    c.width = c.height = out;
    const ctx = c.getContext('2d');
    let n = 0, loaded = 0, total = tpr * tpr;
    for (let ty = 0; ty < tpr; ty++) {
      for (let tx = 0; tx < tpr; tx++) {
        const img = new Image();
        // The tiles come from another site. Without this the canvas is
        // "tainted" and WebGL refuses it, leaving the terrain black.
        img.crossOrigin = 'anonymous';
        // n and loaded are shared async counters, so the closures are intentional.
        // eslint-disable-next-line no-loop-func
        img.onload = () => { ctx.drawImage(img, tx * TS, ty * TS, TS, TS); n++; loaded++; if (n === total) resolve({ canvas: c, loaded, total }); };
        // eslint-disable-next-line no-loop-func
        img.onerror = () => { n++; if (n === total) resolve({ canvas: c, loaded, total }); };
        img.src = `https://jetelain.github.io/Arma3Map/maps/stratis/${SAT_ZOOM}/${tx}/${ty}.png`;
      }
    }
  });
}

function buildMesh(heightImg) {
  const verts = [], uvs = [], cols = [], idx = [];
  const step = MAP / RES;
  const can = document.createElement('canvas');
  can.width = heightImg.width;
  can.height = heightImg.height;
  const c2d = can.getContext('2d');
  c2d.drawImage(heightImg, 0, 0);
  const pxls = c2d.getImageData(0, 0, can.width, can.height).data;

  function gH(x, y) {
    const pxx = Math.round((x / MAP) * (can.width - 1));
    const pxy = Math.round((y / MAP) * (can.height - 1));
    const v = pxls[(pxy * can.width + pxx) * 4];
    return Math.max(0, -157.5 + (v / 255) * 392.4) * EXAG;
  }

  const CS = [
    { u: 0.05, c: [0.20, 0.30, 0.18] },
    { u: 0.15, c: [0.25, 0.38, 0.20] },
    { u: 0.30, c: [0.30, 0.42, 0.22] },
    { u: 0.50, c: [0.38, 0.40, 0.24] },
    { u: 0.70, c: [0.42, 0.38, 0.26] },
    { u: 1.00, c: [0.45, 0.35, 0.25] },
  ];
  function hc(t) { for (let i = 0; i < CS.length; i++) if (t <= CS[i].u) return CS[i].c; return CS[CS.length - 1].c; }

  const grid = new Float32Array((RES + 1) * (RES + 1));
  for (let iy = 0; iy <= RES; iy++) {
    for (let ix = 0; ix <= RES; ix++) {
      const wx = ix * step, wy = iy * step;
      const h = gH(wx, wy);
      grid[iy * (RES + 1) + ix] = h;
      verts.push(wx - HALF, h, -(wy - HALF));
      uvs.push(wx / CRS_SCALE, wy / CRS_SCALE);
      const c = hc(Math.min(1, h / (135 * EXAG)));
      cols.push(c[0], c[1], c[2]);
    }
  }
  for (let iy = 0; iy < RES; iy++) {
    for (let ix = 0; ix < RES; ix++) {
      const a = iy * (RES + 1) + ix;
      idx.push(a, a + 1, a + RES + 1, a + 1, a + RES + 2, a + RES + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  _hGrid = grid;
  return geo;
}

// Height of the drawn terrain surface, so units, roads and trees sit on it
// exactly. Interpolates within the same two triangles per cell as the mesh.
let _hGrid = null;
function getHeightAt(armaX, armaY) {
  if (!_hGrid) return 0;
  const gx = Math.max(0, Math.min(RES - 1e-6, (armaX / MAP) * RES));
  const gy = Math.max(0, Math.min(RES - 1e-6, (armaY / MAP) * RES));
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = gx - ix, fy = gy - iy;
  const a = iy * (RES + 1) + ix;
  const h00 = _hGrid[a], h10 = _hGrid[a + 1], h01 = _hGrid[a + RES + 1], h11 = _hGrid[a + RES + 2];
  return fx + fy <= 1
    ? h00 + fx * (h10 - h00) + fy * (h01 - h00)
    : h11 + (1 - fx) * (h01 - h11) + (1 - fy) * (h10 - h11);
}
const groundAt = (sceneX, sceneZ) => getHeightAt(sceneX + HALF, -sceneZ + HALF);

// The 3D view is destroyed when you switch to 2D, so the camera is remembered here.
let _savedView = null; // { key, pos, target }

// Point the camera at the friendly units, looking north like the 2D map.
// Returns false if there is no unit to look at.
function frameUnits(cam, ctrl, unitList) {
  const alive = unitList.filter(u => u.position && u.position.x !== undefined && u.status !== 'DESTROYED' && u.status !== 'DEAD');
  if (alive.length === 0) return false;
  const xs = alive.map(u => u.position.x), ys = alive.map(u => u.position.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spread = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const dist = Math.min(6000, 160 + spread * 1.4);
  const tx = cx - HALF, tz = -(cy - HALF);
  const ty = getHeightAt(cx, cy);
  ctrl.target.set(tx, ty, tz);
  const camZ = tz + dist * 0.7;
  cam.position.set(tx, Math.max(ty + dist * 0.7, groundAt(tx, camZ) + 40), camZ);
  ctrl.update();
  return true;
}

// A name tag that stays the same size on screen and draws over the terrain,
// so a friendly can be found at any zoom.
function makeUnitTag(text, color) {
  const can = document.createElement('canvas');
  can.width = 256; can.height = 96;
  const c = can.getContext('2d');
  c.font = 'bold 30px monospace';
  c.textAlign = 'center';
  const w = Math.min(252, c.measureText(text).width + 24);
  c.fillStyle = 'rgba(7,9,15,0.85)';
  c.fillRect(128 - w / 2, 2, w, 44);
  c.strokeStyle = color; c.lineWidth = 3;
  c.strokeRect(128 - w / 2, 2, w, 44);
  c.fillStyle = '#ffffff';
  c.fillText(text, 128, 35, 240);
  c.fillStyle = color;
  c.beginPath(); c.moveTo(114, 58); c.lineTo(142, 58); c.lineTo(128, 92); c.closePath(); c.fill();
  const tex = new THREE.CanvasTexture(can);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true, fog: false }));
  sprite.center.set(0.5, 0); // the pointer's tip sits on the unit
  sprite.scale.set(0.16, 0.06, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function loadOBJ(url) {
  return new Promise((resolve, reject) => {
    const loader = new OBJLoader();
    loader.load(url, (model) => {
      const geoBox = new THREE.Box3();
      let hasGeo = false;
      model.traverse(child => {
        if (child.isMesh && child.geometry) {
          child.geometry.computeBoundingBox();
          geoBox.union(child.geometry.boundingBox);
          hasGeo = true;
        }
      });
      if (hasGeo) {
        const size = geoBox.getSize(new THREE.Vector3());
        const center = geoBox.getCenter(new THREE.Vector3());
        model.traverse(child => {
          if (child.isMesh && child.geometry) {
            child.geometry.translate(-center.x, -center.y, -center.z);
          }
        });
        model.userData.rawSize = Math.max(size.x, size.y, size.z);
      } else {
        model.userData.rawSize = 0;
      }
      resolve(model);
    }, undefined, reject);
  });
}

function loadMultiPartOBJ(baseDir, files) {
  return Promise.all(files.map(f => loadOBJ(`${baseDir}/${f}`).catch(() => null)))
    .then(parts => {
      const group = new THREE.Group();
      parts.filter(Boolean).forEach(p => group.add(p));
      if (group.children.length > 0) {
        const geoBox = new THREE.Box3();
        group.traverse(child => {
          if (child.isMesh && child.geometry) {
            child.geometry.computeBoundingBox();
            if (child.geometry.boundingBox) {
              geoBox.union(child.geometry.boundingBox);
            }
          }
        });
        const size = geoBox.getSize(new THREE.Vector3());
        group.userData.rawSize = Math.max(size.x, size.y, size.z);
        return group;
      }
      return null;
    });
}

function applyMaterial(model, color, emissive, emissiveIntensity) {
  model.traverse(child => {
    if (child.isMesh) {
      child.material = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity,
        roughness: 0.7,
        metalness: 0.3,
        side: THREE.DoubleSide,
      });
    }
  });
}

function getUnitModelType(unit) {
  const vt = (unit.vehicle_type || '').toUpperCase();
  const t = (unit.type || '').toUpperCase();
  if (t.includes('HELICOPTER') || vt === 'HELI' || t === 'AIR') return 'helicopter';
  if (vt === 'MBT' || vt === 'TANK' || t.includes('TANK') || vt.includes('TRACKED')) return 'tank';
  if (vt === 'STOMPER' || vt === 'ED1') return 'vehicle'; // ground robots
  if (vt === 'IFV' || t === 'IFV' || t === 'APC') return 'vehicle';
  if (vt === 'CAR' || t === 'CAR' || vt.includes('MRAP') || vt.includes('JLTV')) return 'vehicle';
  if (vt === 'TRUCK' || t === 'TRUCK') return 'vehicle';
  if (vt.includes('WHEELED') || vt.includes('CAR')) return 'vehicle';
  if (vt === 'BOAT' || t === 'BOAT') return 'infantry';
  return 'infantry';
}

function makeInfantryMesh(color, emissive, opacity) {
  const group = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(1.5, 1.5, 4, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 2;
  group.add(body);
  const headGeo = new THREE.SphereGeometry(1, 8, 6);
  const head = new THREE.Mesh(headGeo, bodyMat);
  head.position.y = 5;
  group.add(head);
  return group;
}

export default function MapView3D({ units, contacts, selectedUnits, viewKey, pendingAction, onUnitSelect, onUnitRightClick, onContactSelect, onMapClick }) {
  const ref = useRef(null);
  const st = useRef({});
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const selectedRef = useRef(selectedUnits);
  selectedRef.current = selectedUnits;
  const viewKeyRef = useRef(viewKey || '');
  viewKeyRef.current = viewKey || '';
  const framedKeyRef = useRef(null); // mission the camera has been placed for
  const [status, setStatus] = useState('loading');
  const [hImg, setHImg] = useState(null);
  const [models, setModels] = useState(null);
  const onUnitSelectRef = useRef(onUnitSelect);
  onUnitSelectRef.current = onUnitSelect;
  const onUnitRightClickRef = useRef(onUnitRightClick);
  onUnitRightClickRef.current = onUnitRightClick;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onContactSelectRef = useRef(onContactSelect);
  onContactSelectRef.current = onContactSelect;
  const qHeldRef = useRef(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setHImg(img);
    img.onerror = () => setStatus('no heightmap');
    img.src = 'maps/stratis_height.png';
  }, []);

  useEffect(() => {
    const M = 'models';
    Promise.all([
      loadOBJ(`${M}/Attack Helicopter.obj`).catch(() => null),
      loadOBJ(`${M}/Tank.obj`).catch(() => null),
      loadOBJ(`${M}/Armored Vehicle.obj`).catch(() => null),
      loadMultiPartOBJ(`${M}/jeep`, [
        'JeepBody.obj', 'JeepLargeSeat.obj', 'JeepSmallSeat.obj',
        'JeepSteeringWheel.obj', 'JeepTire.obj',
      ]),
    ]).then(([heli, tank, armored, jeep]) => {
      const loaded = {
        helicopter: heli,
        tank,
        vehicle: armored,
        jeep,
      };
      setModels(loaded);
      Object.entries(loaded).forEach(([k, v]) => {
        if (v) {
          const raw = v.userData.rawSize || 0;
          const worldSize = MODEL_WORLD_SIZE[k] || 2;
          const scale = worldSize / raw;
          console.log(`[MODELS] ${k}: rawSize=${raw.toFixed(1)} worldSize=${worldSize} scale=${scale.toFixed(6)}`);
        } else {
          console.log(`[MODELS] ${k}: FAILED to load`);
        }
      });
    });
  }, []);

  useEffect(() => {
    if (!hImg) return;
    const c = ref.current;
    if (!c || !c.clientWidth) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08080c);
    scene.fog = new THREE.Fog(0x08080c, 6000, 14000);

    const cam = new THREE.PerspectiveCamera(60, c.clientWidth / c.clientHeight, 1, 30000);
    cam.position.set(0, 300, 500);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(c.clientWidth, c.clientHeight);
    c.appendChild(renderer.domElement);

    const ctrl = new OrbitControls(cam, renderer.domElement);
    ctrl.target.set(0, 0, 0);
    ctrl.maxPolarAngle = Math.PI / 2.1;
    ctrl.enableDamping = false;
    ctrl.panSpeed = 2.0;
    ctrl.rotateSpeed = 1.0;
    ctrl.zoomSpeed = 2.0;
    ctrl.screenSpacePanning = false; // pan along the ground, so the pivot never goes under it
    ctrl.enableZoom = false;
    ctrl.keys = { LEFT: 0, RIGHT: 0, UP: 0, BOTTOM: 0 };
    ctrl.enableKeys = false;
    ctrl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE };
    ctrl.update();

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let mouseDownPos = { x: 0, y: 0 };

    renderer.domElement.addEventListener('mousedown', (e) => {
      mouseDownPos.x = e.clientX;
      mouseDownPos.y = e.clientY;
    });

    renderer.domElement.addEventListener('mouseup', (e) => {
      const dx = e.clientX - mouseDownPos.x;
      const dy = e.clientY - mouseDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, cam);

      const s = st.current;
      if (!s.markers) return;
      const hits = raycaster.intersectObjects(s.markers.children, true);

      // Resolve which marker (unit or contact) was hit by walking up the parent chain.
      let unitObj = null;
      let contactObj = null;
      for (const hit of hits) {
        let obj = hit.object;
        while (obj && !obj.userData?.unitId && !obj.userData?.contactId) obj = obj.parent;
        if (obj?.userData?.unitId) { unitObj = obj; break; }
        if (obj?.userData?.contactId && !contactObj) { contactObj = obj; }
      }

      if (unitObj) {
        if ((e.button === 2 || qHeldRef.current) && onUnitRightClickRef.current) {
          onUnitRightClickRef.current(unitObj.userData.unitId, e.clientX, e.clientY);
        } else {
          onUnitSelectRef.current(unitObj.userData.unitId, e.ctrlKey || e.metaKey);
        }
      } else if (contactObj) {
        if (onContactSelectRef.current) onContactSelectRef.current(contactObj.userData.contactId);
      } else if (onMapClickRef.current) {
        const terrainHits = raycaster.intersectObject(s.terrainMesh, false);
        if (terrainHits.length > 0) {
          const p = terrainHits[0].point;
          onMapClickRef.current(p.x + HALF, -(p.z) + HALF);
        }
      }
    });

    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    // Zoom toward or away from the point being looked at, which stays put.
    renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      const offset = cam.position.clone().sub(ctrl.target);
      const factor = Math.pow(e.shiftKey ? 1.35 : 1.12, Math.sign(e.deltaY || e.deltaX));
      offset.setLength(Math.max(30, Math.min(12000, offset.length() * factor)));
      cam.position.copy(ctrl.target).add(offset);
    }, { passive: false });

    scene.add(new THREE.AmbientLight(0x888888, 0.6));
    const sun = new THREE.DirectionalLight(0xffeedd, 1.0);
    sun.position.set(5000, 8000, 3000); scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
    fill.position.set(-3000, 2000, -4000); scene.add(fill);
    scene.add(new THREE.HemisphereLight(0xdde8ff, 0x606050, 0.35));

    const geo = buildMesh(hImg);

    // Put the camera back where it was, or, the first time, on the friendlies.
    framedKeyRef.current = null;
    if (_savedView && _savedView.key === viewKeyRef.current) {
      cam.position.copy(_savedView.pos);
      ctrl.target.copy(_savedView.target);
      ctrl.update();
      framedKeyRef.current = _savedView.key;
    } else if (frameUnits(cam, ctrl, Object.values(unitsRef.current || {}))) {
      framedKeyRef.current = viewKeyRef.current;
    } else {
      cam.position.set(0, 4500, 5500); // no units yet: show the whole island
      ctrl.update();
    }
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    setStatus('loading sat');
    loadSatTiles().then(({ canvas, loaded, total }) => {
      if (loaded === 0) { setStatus('ready · no satellite (offline?)'); return; } // keep the height colours
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const texMat = new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
      });
      mesh.material = texMat;
      mesh.material.needsUpdate = true;
      setStatus(loaded === total ? 'ready' : `ready · ${total - loaded} tiles missing`);
    });

    const buildingsGroup = new THREE.Group();
    scene.add(buildingsGroup);
    let roadGroup = null;

    const DENSITY_OPACITY = [0.35, 0.50, 0.70, 0.90];

    fetch('maps/stratis_objects.bin').then(r => r.arrayBuffer()).then(buf => {
      const worker = new Worker('terrainWorker.js');
      worker.postMessage(buf);
      worker.onmessage = (e) => {
        const groups = e.data;
        const coneGeo = new THREE.ConeGeometry(0.5, 1, 6);
        const sphereGeo = new THREE.SphereGeometry(0.5, 6, 6);
        const flatGeo = new THREE.SphereGeometry(0.5, 8, 4);
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const geos = [coneGeo, sphereGeo, flatGeo, boxGeo];
        const baseColors = [0x2d5a1e, 0x3a6a28, 0x4a6a30, 0x7a7568];

        const m4 = new THREE.Matrix4();
        const euler = new THREE.Euler();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        const pos = new THREE.Vector3();

        for (const key in groups) {
          const g = groups[key];
          if (g.count === 0) continue;
          const geo = geos[g.shape];
          const color = baseColors[g.shape];
          const isBox = g.shape === 3;
          const opacity = isBox ? 1.0 : DENSITY_OPACITY[g.density];
          const mat = new THREE.MeshStandardMaterial({
            color, roughness: 0.9, transparent: !isBox, opacity, side: THREE.DoubleSide,
          });
          const instMesh = new THREE.InstancedMesh(geo, mat, g.count);
          for (let i = 0; i < g.count; i++) {
            const x = g.x[i], y = g.y[i], z = g.z[i];
            const dir = g.dir[i];
            const w = Math.max(0.3, g.w[i]);
            const h = Math.max(0.3, g.h[i]);
            const d = Math.max(0.3, g.d[i]);
            const th = getHeightAt(x, y);
            pos.set(x - HALF, th + z + h / 2, -(y - HALF));
            scl.set(w, h, d);
            euler.set(0, -dir * Math.PI / 180, 0, 'YXZ');
            quat.setFromEuler(euler);
            m4.compose(pos, quat, scl);
            instMesh.setMatrixAt(i, m4);
          }
          instMesh.instanceMatrix.needsUpdate = true;
          buildingsGroup.add(instMesh);
        }
        worker.terminate();
      };
    }).catch(() => {});

    fetch('maps/stratis_roads.bin').then(r => r.arrayBuffer()).then(buf => {
      const dv = new DataView(buf);
      let off = 0;
      const totalSeg = dv.getUint32(off, true); off += 4;
      const totalChains = dv.getUint32(off, true); off += 4;
      const chainLens = [];
      for (let i = 0; i < totalChains; i++) {
        chainLens.push(dv.getUint32(off, true)); off += 4;
      }
      const roadData = [];
      for (let i = 0; i < totalSeg; i++) {
        roadData.push({
          x: dv.getFloat32(off, true), y: dv.getFloat32(off + 4, true),
          dir: dv.getFloat32(off + 8, true), w: dv.getFloat32(off + 12, true),
        });
        off += 16;
      }

      roadGroup = new THREE.Group();
      scene.add(roadGroup);
      const roadMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
      const HALF_W = 5;

      let segIdx = 0;
      let meshCount = 0;
      for (const len of chainLens) {
        if (len < 2) { segIdx += len; continue; }
        const allV = [], allI = [];
        for (let i = 0; i < len - 1; i++) {
          const p1 = roadData[segIdx + i];
          const p2 = roadData[segIdx + i + 1];
          const dx = p2.x - p1.x, dy = p2.y - p1.y;
          const dl = Math.sqrt(dx * dx + dy * dy);
          if (dl < 0.01) continue;
          const nx = -dy / dl, ny = dx / dl;
          const hw = HALF_W;
          const h1 = getHeightAt(p1.x, p1.y) + 2;
          const h2 = getHeightAt(p2.x, p2.y) + 2;
          const wx1 = p1.x - HALF, wz1 = -(p1.y - HALF);
          const wx2 = p2.x - HALF, wz2 = -(p2.y - HALF);
          const vi = allV.length / 3;
          allV.push(
            wx1 + nx * hw, h1, wz1 + ny * hw,
            wx1 - nx * hw, h1, wz1 - ny * hw,
            wx2 + nx * hw, h2, wz2 + ny * hw,
            wx2 - nx * hw, h2, wz2 - ny * hw
          );
          allI.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
        }
        if (allV.length > 0) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(allV, 3));
          geo.setIndex(allI);
          geo.computeVertexNormals();
          roadGroup.add(new THREE.Mesh(geo, roadMat));
          meshCount++;
        }
        segIdx += len;
      }
      console.log('[ROADS] Created', meshCount, 'road chain meshes');
    }).catch(() => {});

    const markers = new THREE.Group();
    scene.add(markers);

    st.current = { scene, cam, ctrl, renderer, markers, terrainMesh: mesh, buildingsGroup, roadGroup };

    const keys = {};
    // e.key returns 'W' when Shift is held and 'w' otherwise — normalize
    // single-char keys to lowercase so keydown/keyup always match the same flag.
    const keyOf = (e) => { const k = e.key; return k.length === 1 ? k.toLowerCase() : k; };
    function kd(e) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
      if (!typing && keyOf(e) === 'f') {
        // F: jump to the selected units, or to all friendlies.
        const all = Object.values(unitsRef.current || {});
        const picked = all.filter(u => (selectedRef.current || []).includes(u.id));
        if (frameUnits(cam, ctrl, picked.length ? picked : all)) framedKeyRef.current = viewKeyRef.current;
      }
      const k = keyOf(e); keys[k] = true; if (k === 'q') qHeldRef.current = true; if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault(); }
    function ku(e) { const k = keyOf(e); keys[k] = false; if (k === 'q') qHeldRef.current = false; }
    const onBlur = () => { for (const k in keys) delete keys[k]; };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', onBlur);

    let running = true;
    function tick() {
      if (!running) return;
      requestAnimationFrame(tick);
      const s = st.current;
      if (s.ctrl) {
        const fwd = new THREE.Vector3();
        s.cam.getWorldDirection(fwd); fwd.y = 0;
        if (fwd.length() < 0.001) fwd.z = -1;
        fwd.normalize();
        const rt = new THREE.Vector3(); rt.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
        // Safety: clear keys if window lost focus
        if (!document.hasFocus()) { for (const k in keys) delete keys[k]; }
        // Fly faster the further out you are, so close-up moves stay precise.
        const spd = Math.max(1, s.cam.position.distanceTo(s.ctrl.target) * 0.012) * (keys['Shift'] ? 3 : 1);
        let mx = 0, mz = 0;
        if (keys['w']||keys['ArrowUp'])         { mx += fwd.x * spd; mz += fwd.z * spd; }
        if (keys['s']||keys['ArrowDown'])       { mx -= fwd.x * spd; mz -= fwd.z * spd; }
        if (keys['a']||keys['ArrowLeft'])       { mx -= rt.x * spd; mz -= rt.z * spd; }
        if (keys['d']||keys['ArrowRight'])      { mx += rt.x * spd; mz += rt.z * spd; }
        if (mx || mz) {
          const before = groundAt(s.ctrl.target.x, s.ctrl.target.z);
          s.ctrl.target.x = Math.max(-HALF, Math.min(HALF, s.ctrl.target.x + mx));
          s.ctrl.target.z = Math.max(-HALF, Math.min(HALF, s.ctrl.target.z + mz));
          s.cam.position.x += mx;
          s.cam.position.z += mz;
          const climb = groundAt(s.ctrl.target.x, s.ctrl.target.z) - before;
          s.ctrl.target.y += climb;
          s.cam.position.y += climb;
        }
        s.ctrl.update();
        // Never let the camera sink into a hill.
        const floor = groundAt(s.cam.position.x, s.cam.position.z) + 8;
        if (s.cam.position.y < floor) { s.cam.position.y = floor; s.cam.lookAt(s.ctrl.target); }
      }
      renderer.render(scene, cam);
    }
    tick();

    function rs() {
      if (!ref.current) return;
      const w = ref.current.clientWidth, h = ref.current.clientHeight;
      if (!w || !h) return;
      cam.aspect = w / h; cam.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', rs);

    return () => {
      running = false;
      if (framedKeyRef.current !== null) {
        _savedView = { key: framedKeyRef.current, pos: cam.position.clone(), target: ctrl.target.clone() };
      }
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', rs);
      // Dispose all Three.js resources
      const s = st.current;
      [s.terrainMesh, s.buildingsGroup, s.roadGroup, s.markers].forEach(obj => {
        if (obj) {
          obj.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
              else child.material.dispose();
            }
          });
          if (obj.parent) obj.parent.remove(obj);
        }
      });
      renderer.dispose();
      if (c.contains(renderer.domElement)) c.removeChild(renderer.domElement);
    };
  }, [hImg]);

  useEffect(() => {
    const s = st.current;
    if (!s.markers) return;
    const g = s.markers;
    while (g.children.length) {
      const ch = g.children[0];
      ch.traverse(child => {
        if (child.geometry && !child.isSprite) child.geometry.dispose(); // sprites share one geometry
        if (child.material) {
          if (child.isSprite && child.material.map) child.material.map.dispose();
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
      g.remove(ch);
    }

    const unitList = Object.values(units || {});
    if (unitList.length > 0) {
      console.log(`[3D] Rendering ${unitList.length} units, models: ${models ? Object.keys(models).join(',') : 'none'}`);
    }

    const BLUE = 0x3b82f6;
    const SELECTED = 0xc75b1f;
    const DEAD = 0x585870;
    const lineMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.4 });
    const groundDotGeo = new THREE.RingGeometry(2, 4, 16);
    const groundDotMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    const selectionRingGeo = new THREE.RingGeometry(6, 8, 24);
    const selectionRingMat = new THREE.MeshBasicMaterial({ color: SELECTED, transparent: true, opacity: 0.8, side: THREE.DoubleSide });

    const tagged = []; // positions that already have a name tag
    Object.values(units || {}).forEach(u => {
      const p = u.position;
      if (!p || p.x === undefined || p.y === undefined) return;
      const tx = p.x - HALF;
      const tz = -(p.y - HALF);
      if (!hImg) return;
      const terrainH = getHeightAt(p.x, p.y);
      const altAGL = p.z || 0;
      const h = terrainH + altAGL;
      const dead = u.status === 'DESTROYED' || u.status === 'DEAD';
      const isSelected = selectedUnits && selectedUnits.includes(u.id);
      const color = dead ? DEAD : (isSelected ? SELECTED : BLUE);
      const emissive = dead ? 0x222233 : (isSelected ? 0xc75b1f : 0x2a6db5);
      const opacity = dead ? 0.4 : 1;

      const modelType = getUnitModelType(u);
      const template = models && models[modelType];
      const raw = template && template.userData.rawSize;

      if (!template || !raw || raw < 1) {
        const m = makeInfantryMesh(color, emissive, opacity);
        m.position.set(tx, h + MODEL_HEIGHT_OFFSET.infantry, tz);
        m.userData = { unitId: u.id };
        g.add(m);
      } else {
        const clone = template.clone();
        applyMaterial(clone, color, emissive, 0.5);
        const worldSize = MODEL_WORLD_SIZE[modelType] || 2;
        const scale = worldSize / raw;
        clone.scale.set(scale, scale, scale);
        clone.position.set(tx, h + (MODEL_HEIGHT_OFFSET[modelType] || 3), tz);
        clone.userData = { unitId: u.id };
        g.add(clone);
      }

      const tag = makeUnitTag(u.callsign || u.id, dead ? '#585870' : (isSelected ? '#c75b1f' : '#3b82f6'));
      tag.position.set(tx, h + 10, tz);
      tag.userData = { unitId: u.id };
      // Units close together get their tags stacked so each stays readable.
      const stack = tagged.filter(q => Math.hypot(q.x - p.x, q.y - p.y) < 120).length;
      tag.center.set(0.5, -0.55 * stack);
      tagged.push(p);
      g.add(tag);

      if (isSelected && !dead) {
        const ring = new THREE.Mesh(selectionRingGeo, selectionRingMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(tx, terrainH + 0.5, tz);
        ring.userData = { unitId: u.id };
        g.add(ring);
      }

      if (altAGL > 1 && !dead) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(tx, h, tz),
          new THREE.Vector3(tx, terrainH, tz)
        ]);
        const line = new THREE.Line(lineGeo, lineMat);
        line.userData = { unitId: u.id };
        g.add(line);

        const dot = new THREE.Mesh(groundDotGeo, groundDotMat);
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(tx, terrainH + 0.5, tz);
        dot.userData = { unitId: u.id };
        g.add(dot);
      }
    });

    Object.values(contacts || {}).forEach(c => {
      const p = c.position;
      if (!p || p.x === undefined || p.y === undefined) return;
      const tx = p.x - HALF;
      const tz = -(p.y - HALF);
      if (!hImg) return;
      const terrainH = getHeightAt(p.x, p.y);
      const altAGL = p.z || 0;
      const h = terrainH + altAGL;

      const state = (c.state || '').toUpperCase();
      if (state === 'DEAD') return; // don't render dead contacts
      const opacity = state === 'LAST_KNOWN' ? 0.5 : state === 'SUSPECTED' ? 0.3 : 1;
      const color = DEAD;
      const emissive = 0x8a1a1a;

      const modelType = getUnitModelType(c);
      const template = models && models[modelType];
      const raw = template && template.userData.rawSize;

      if (!template || !raw || raw < 1) {
        const m = makeInfantryMesh(color, emissive, opacity);
        m.position.set(tx, h + MODEL_HEIGHT_OFFSET.infantry, tz);
        m.userData = { contactId: c.id };
        g.add(m);
      } else {
        const clone = template.clone();
        applyMaterial(clone, color, emissive, 0.6);
        const worldSize = MODEL_WORLD_SIZE[modelType] || 2;
        const scale = worldSize / raw;
        clone.scale.set(scale, scale, scale);
        clone.position.set(tx, h + (MODEL_HEIGHT_OFFSET[modelType] || 3), tz);
        clone.userData = { contactId: c.id };
        g.add(clone);
      }

      if (altAGL > 1) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(tx, h, tz),
          new THREE.Vector3(tx, terrainH, tz)
        ]);
        const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x8a1a1a, transparent: true, opacity: 0.3 }));
        g.add(line);
      }
    });
  }, [units, contacts, selectedUnits, models, hImg]);

  // Units can arrive after the view opens, and a new mission puts them
  // somewhere else: place the camera once for each of those cases.
  useEffect(() => {
    const s = st.current;
    if (!s.cam || framedKeyRef.current === (viewKey || '')) return;
    if (frameUnits(s.cam, s.ctrl, Object.values(units || {}))) framedKeyRef.current = viewKey || '';
  }, [units, viewKey, hImg]);

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', overflow:'hidden' }}>
      <div ref={ref} style={{ width:'100%', height:'100%' }} />
      <div style={{ position:'absolute', top:12, left:12, zIndex:10, display:'flex', gap:4, alignItems:'center', background:'rgba(7,9,15,0.8)', padding:4, borderRadius:3 }}>
        <span className="badge badge-primary">3D</span>
        <span className={`badge ${status.startsWith('ready')?'badge-success':''}`}>{status}</span>
      </div>
      <div style={{ position:'absolute', bottom:12, left:60, zIndex:10, fontFamily:'var(--font-mono)', fontSize:11, color:'#c9d1e0', background:'rgba(7,9,15,0.82)', padding:'5px 10px', borderRadius:3, pointerEvents:'none' }}>
        F=find friendlies · WASD+Shift=fly · Scroll=zoom · Left-drag=pan · Right/Mid-drag=orbit · M=2D
      </div>
    </div>
  );
}
