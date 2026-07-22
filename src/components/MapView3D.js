import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const MAP = 8192;
const HALF = MAP / 2;
const RES = 256;
const EXAG = 1.5;
const SAT_ZOOM = 3;
const TS = 226;
const CRS_SCALE = TS / 0.027475; // 8226.37 — matches jetelain satellite tile CRS

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

export default function MapView3D({ units }) {
  const ref = useRef(null);
  const st = useRef({});
  const [status, setStatus] = useState('loading');
  const [hImg, setHImg] = useState(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setHImg(img);
    img.onerror = () => setStatus('no heightmap');
    img.src = 'maps/stratis_height.png';
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
    ctrl.minDistance = 5;
    ctrl.maxDistance = 20000;
    ctrl.enableDamping = false;
    ctrl.panSpeed = 2.0;
    ctrl.rotateSpeed = 1.0;
    ctrl.zoomSpeed = 1.5;
    ctrl.keys = { LEFT: 0, RIGHT: 0, UP: 0, BOTTOM: 0 };
    ctrl.enableKeys = false;
    ctrl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    ctrl.update();

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

    // Buildings + all terrain objects (binary format via Web Worker)
    const buildingsGroup = new THREE.Group();
    scene.add(buildingsGroup);

    const DENSITY_OPACITY = [0.35, 0.50, 0.70, 0.90];

    fetch('maps/stratis_objects.bin').then(r => r.arrayBuffer()).then(buf => {
      const worker = new Worker('terrainWorker.js');
      worker.postMessage(buf);
      worker.onmessage = (e) => {
        const groups = e.data;
        const coneGeo = new THREE.ConeGeometry(1, 1, 6);
        const sphereGeo = new THREE.SphereGeometry(1, 6, 6);
        const flatGeo = new THREE.SphereGeometry(1, 8, 4);
        const geos = [coneGeo, sphereGeo, flatGeo];
        const baseColors = [0x2d5a1e, 0x3a6a28, 0x4a6a30];

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
          const opacity = DENSITY_OPACITY[g.density];
          const mat = new THREE.MeshStandardMaterial({
            color, roughness: 0.9, transparent: true, opacity, side: THREE.DoubleSide,
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

    // Unit markers
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
    while (g.children.length) { const ch = g.children[0]; if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); g.remove(ch); }
    const sg = new THREE.SphereGeometry(6, 6, 6);
    Object.values(units || {}).forEach(u => {
      const p = u.position;
      if (!p || p.x === undefined || p.y === undefined) return;
      const tx = p.x - HALF;
      const tz = -(p.y - HALF);
      if (!hImg) return;
      const h = getHeightAt(p.x, p.y);
      const dead = u.status === 'DESTROYED' || u.status === 'DEAD';
      const op = dead ? 0.25 : 1;
      const veh = u.vehicle_type && !['INFANTRY','MAN'].includes(u.vehicle_type);
      const col = dead ? 0x585870 : veh ? 0x3b82f6 : 0x60a5fa;
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op });
      if (veh) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 10), mat);
        m.position.set(tx, h + 5, tz); g.add(m);
      } else {
        const m = new THREE.Mesh(sg.clone(), mat);
        m.position.set(tx, h + 3, tz); g.add(m);
      }
    });
  }, [units, hImg]);

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', overflow:'hidden' }}>
      <div ref={ref} style={{ width:'100%', height:'100%' }} />
      <div style={{ position:'absolute', top:12, left:12, zIndex:10, display:'flex', gap:4, alignItems:'center' }}>
        <span className="badge badge-primary">3D</span>
        <span className={`badge ${status.startsWith('ready')?'badge-success':''}`}>{status}</span>
      </div>
      <div style={{ position:'absolute', bottom:12, left:12, zIndex:10, fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-muted)', background:'rgba(0,0,0,0.7)', padding:'5px 10px', borderRadius:3, pointerEvents:'none' }}>
        WASD+Shift=fly · Left-drag=pan · Right-drag=orbit · Scroll=zoom · M=2D
      </div>
    </div>
  );
}
