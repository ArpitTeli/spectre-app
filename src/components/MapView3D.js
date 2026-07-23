import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';

const MAP = 8192;
const HALF = MAP / 2;
const RES = 256;
const EXAG = 1.5;
const SAT_ZOOM = 3;
const TS = 226;
const CRS_SCALE = TS / 0.027475;

const MODEL_WORLD_SIZE = {
  helicopter: 14,
  tank: 8,
  tank_destroyer: 5,
  vehicle: 7,
  jeep: 5,
  infantry: 2,
};

const MODEL_HEIGHT_OFFSET = {
  helicopter: 8,
  tank: 3,
  tank_destroyer: 3,
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
    let n = 0, total = tpr * tpr;
    for (let ty = 0; ty < tpr; ty++) {
      for (let tx = 0; tx < tpr; tx++) {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, tx * TS, ty * TS, TS, TS); n++; if (n === total) resolve(c); };
        img.onerror = () => { n++; if (n === total) resolve(c); };
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

  for (let iy = 0; iy <= RES; iy++) {
    for (let ix = 0; ix <= RES; ix++) {
      const wx = ix * step, wy = iy * step;
      const h = gH(wx, wy);
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
  return geo;
}

let _hCache = null;
function cacheHeightmap(heightImg) {
  const can = document.createElement('canvas');
  can.width = heightImg.width;
  can.height = heightImg.height;
  const c2d = can.getContext('2d');
  c2d.drawImage(heightImg, 0, 0);
  _hCache = c2d.getImageData(0, 0, can.width, can.height).data;
}
function getHeightAt(armaX, armaY) {
  if (!_hCache) return 0;
  const w = 512;
  const px = Math.round((armaX / MAP) * (w - 1));
  const py = Math.round((armaY / MAP) * (w - 1));
  const v = _hCache[(py * w + px) * 4];
  return Math.max(0, -157.5 + (v / 255) * 392.4) * EXAG;
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

function loadFBX(url) {
  return new Promise((resolve, reject) => {
    const loader = new FBXLoader();
    loader.load(url, (model) => {
      const geoBox = new THREE.Box3();
      model.traverse(child => {
        if (child.isMesh && child.geometry) {
          child.geometry.computeBoundingBox();
          if (child.geometry.boundingBox) {
            geoBox.union(child.geometry.boundingBox);
          }
        }
      });
      const size = geoBox.getSize(new THREE.Vector3());
      const center = geoBox.getCenter(new THREE.Vector3());
      model.traverse(child => {
        if (child.isMesh && child.geometry) {
          child.geometry.translate(-center.x, -center.y, -center.z);
        }
      });
      model.userData.rawSize = Math.max(size.x, size.y, size.z);
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

function applyFBXTextures(model, baseDir, textures) {
  const textureLoader = new THREE.TextureLoader();
  const loadTex = (name) => {
    if (!textures[name]) return null;
    const tex = textureLoader.load(`${baseDir}/${textures[name]}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  const baseColorMap = loadTex('baseColor');
  const normalMap = loadTex('normal');
  const roughnessMap = loadTex('roughness');
  const metallicMap = loadTex('metallic');

  model.traverse(child => {
    if (child.isMesh) {
      child.material = new THREE.MeshStandardMaterial({
        map: baseColorMap,
        normalMap,
        roughnessMap,
        metalnessMap: metallicMap,
        roughness: 0.8,
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
  if (vt === 'TANK' || t.includes('TANK') || vt.includes('TRACKED')) return 'tank';
  if (vt === 'IFV') return 'tank_destroyer';
  if (vt === 'CAR' || vt.includes('MRAP') || vt.includes('JLTV')) return 'vehicle';
  if (vt === 'TRUCK') return 'vehicle';
  if (vt.includes('WHEELED') || vt.includes('CAR')) return 'vehicle';
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

export default function MapView3D({ units, contacts, onUnitSelect, onContactSelect }) {
  const ref = useRef(null);
  const st = useRef({});
  const [status, setStatus] = useState('loading');
  const [hImg, setHImg] = useState(null);
  const [models, setModels] = useState(null);

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
      loadFBX(`${M}/tank_destroyer/reconTank.fbx`).catch(() => null).then(m => {
        if (m) applyFBXTextures(m, `${M}/tank_destroyer`, {
          baseColor: 'BaseColor.png', normal: 'Normal.png',
          roughness: 'Roughness.png', metallic: 'Metallic.png',
        });
        return m;
      }),
    ]).then(([heli, tank, armored, jeep, tankDest]) => {
      const loaded = {
        helicopter: heli,
        tank,
        vehicle: armored,
        jeep,
        tank_destroyer: tankDest,
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
    ctrl.screenSpacePanning = true;
    ctrl.enableZoom = false;
    ctrl.keys = { LEFT: 0, RIGHT: 0, UP: 0, BOTTOM: 0 };
    ctrl.enableKeys = false;
    ctrl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE };
    ctrl.update();

    const ZOOM_STEP = 40;
    renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      const step = e.deltaY > 0 ? ZOOM_STEP : -ZOOM_STEP;
      const mul = e.shiftKey ? 3 : 1;
      cam.position.addScaledVector(dir, -step * mul);
      ctrl.target.addScaledVector(dir, -step * mul);
    }, { passive: false });

    scene.add(new THREE.AmbientLight(0x888888, 0.6));
    const sun = new THREE.DirectionalLight(0xffeedd, 1.0);
    sun.position.set(5000, 8000, 3000); scene.add(sun);
    scene.add(new THREE.DirectionalLight(0x8888ff, 0.3).position.set(-3000, 2000, -4000));

    const geo = buildMesh(hImg);
    cacheHeightmap(hImg);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    setStatus('loading sat');
    loadSatTiles().then(satCanvas => {
      const tex = new THREE.CanvasTexture(satCanvas);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const texMat = new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
      });
      mesh.material = texMat;
      mesh.material.needsUpdate = true;
      setStatus('ready');
    });

    const buildingsGroup = new THREE.Group();
    scene.add(buildingsGroup);

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

      const roadGroup = new THREE.Group();
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

    st.current = { scene, cam, ctrl, renderer, markers };

    const keys = {};
    function kd(e) { keys[e.key] = true; if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault(); }
    function ku(e) { keys[e.key] = false; }
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);

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
        const spd = (keys['Shift'] ? 400 : 120) / 60;
        let mx = 0, mz = 0;
        if (keys['w']||keys['W']||keys['ArrowUp'])    { mx += fwd.x * spd; mz += fwd.z * spd; }
        if (keys['s']||keys['S']||keys['ArrowDown'])  { mx -= fwd.x * spd; mz -= fwd.z * spd; }
        if (keys['a']||keys['A']||keys['ArrowLeft'])  { mx -= rt.x * spd; mz -= rt.z * spd; }
        if (keys['d']||keys['D']||keys['ArrowRight']) { mx += rt.x * spd; mz += rt.z * spd; }
        if (mx || mz) {
          s.ctrl.target.x = Math.max(-HALF, Math.min(HALF, s.ctrl.target.x + mx));
          s.ctrl.target.z = Math.max(-HALF, Math.min(HALF, s.ctrl.target.z + mz));
        }
        s.ctrl.update();
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
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      window.removeEventListener('resize', rs);
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
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
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
    const DEAD = 0x585870;

    Object.values(units || {}).forEach(u => {
      const p = u.position;
      if (!p || p.x === undefined || p.y === undefined) return;
      const tx = p.x - HALF;
      const tz = -(p.y - HALF);
      if (!hImg) return;
      const h = getHeightAt(p.x, p.y);
      const dead = u.status === 'DESTROYED' || u.status === 'DEAD';
      const color = dead ? DEAD : BLUE;
      const emissive = dead ? 0x222233 : 0x1a4a8a;
      const opacity = dead ? 0.4 : 1;

      const modelType = getUnitModelType(u);
      const template = models && models[modelType];
      const raw = template && template.userData.rawSize;

      if (!template || !raw || raw < 1) {
        const m = makeInfantryMesh(color, emissive, opacity);
        m.position.set(tx, h + MODEL_HEIGHT_OFFSET.infantry, tz);
        g.add(m);
      } else {
        const clone = template.clone();
        applyMaterial(clone, color, emissive, 0.5);
        const worldSize = MODEL_WORLD_SIZE[modelType] || 2;
        const scale = worldSize / raw;
        clone.scale.set(scale, scale, scale);
        clone.position.set(tx, h + (MODEL_HEIGHT_OFFSET[modelType] || 3), tz);
        g.add(clone);
      }
    });

    Object.values(contacts || {}).forEach(c => {
      const p = c.position;
      if (!p || p.x === undefined || p.y === undefined) return;
      const tx = p.x - HALF;
      const tz = -(p.y - HALF);
      if (!hImg) return;
      const h = getHeightAt(p.x, p.y);

      const state = (c.state || '').toUpperCase();
      const opacity = state === 'LAST_KNOWN' ? 0.5 : state === 'SUSPECTED' ? 0.3 : 1;
      const color = DEAD;
      const emissive = 0x8a1a1a;

      const modelType = getUnitModelType(c);
      const template = models && models[modelType];
      const raw = template && template.userData.rawSize;

      if (!template || !raw || raw < 1) {
        const m = makeInfantryMesh(color, emissive, opacity);
        m.position.set(tx, h + MODEL_HEIGHT_OFFSET.infantry, tz);
        g.add(m);
      } else {
        const clone = template.clone();
        applyMaterial(clone, color, emissive, 0.6);
        const worldSize = MODEL_WORLD_SIZE[modelType] || 2;
        const scale = worldSize / raw;
        clone.scale.set(scale, scale, scale);
        clone.position.set(tx, h + (MODEL_HEIGHT_OFFSET[modelType] || 3), tz);
        g.add(clone);
      }
    });
  }, [units, contacts, models, hImg]);

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', overflow:'hidden' }}>
      <div ref={ref} style={{ width:'100%', height:'100%' }} />
      <div style={{ position:'absolute', top:12, left:12, zIndex:10, display:'flex', gap:4, alignItems:'center' }}>
        <span className="badge badge-primary">3D</span>
        <span className={`badge ${status.startsWith('ready')?'badge-success':''}`}>{status}</span>
      </div>
      <div style={{ position:'absolute', bottom:12, left:12, zIndex:10, fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-muted)', background:'rgba(0,0,0,0.7)', padding:'5px 10px', borderRadius:3, pointerEvents:'none' }}>
        WASD+Shift=fly · Scroll=zoom · Left-drag=pan · Right/Mid-drag=orbit · M=2D
      </div>
    </div>
  );
}
