import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const MAP = 8192;
const HALF = MAP / 2;
const RES = 256;
const EXAG = 3;

function buildMesh(heightImg) {
  const verts = [], cols = [], idx = [];
  const step = MAP / RES;

  // Read height pixels: 16-bit PNG, 0=low, 65535=high
  const canvas = document.createElement('canvas');
  canvas.width = heightImg.width;
  canvas.height = heightImg.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(heightImg, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  function getH(x, y) {
    const px = Math.round((x / MAP) * (canvas.width - 1));
    const py = Math.round((y / MAP) * (canvas.height - 1));
    const i = (py * canvas.width + px) * 4;
    // 16-bit PNG: two bytes per pixel
    const val = (pixels[i] << 8) | pixels[i + 1];
    // Convert to meters: 0=-152.4m, 65535=6.5m
    const min_h = -152.4;
    const max_h = 6.5;
    const h = min_h + (val / 65535) * (max_h - min_h);
    return Math.max(0, h) * EXAG;
  }

  const COLORS = [
    { up: 0.05, c: [0.20, 0.30, 0.18] },
    { up: 0.15, c: [0.25, 0.38, 0.20] },
    { up: 0.30, c: [0.30, 0.42, 0.22] },
    { up: 0.50, c: [0.38, 0.40, 0.24] },
    { up: 0.70, c: [0.42, 0.38, 0.26] },
    { up: 1.00, c: [0.45, 0.35, 0.25] },
  ];
  function heightColor(t) {
    for (let i = 0; i < COLORS.length; i++) {
      if (t <= COLORS[i].up) return COLORS[i].c;
    }
    return COLORS[COLORS.length - 1].c;
  }

  for (let iy = 0; iy <= RES; iy++) {
    for (let ix = 0; ix <= RES; ix++) {
      const wx = ix * step, wy = iy * step;
      const h = getH(wx, wy);
      verts.push(wx - HALF, h, wy - HALF);
      const c = heightColor(Math.min(1, h / (135 * EXAG)));
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
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export default function MapView3D({ units }) {
  const ref = useRef(null);
  const st = useRef({});
  const [status, setStatus] = useState('loading');
  const [heightImg, setHeightImg] = useState(null);

  // Load the heightmap image
  useEffect(() => {
    const img = new Image();
    img.onload = () => setHeightImg(img);
    img.onerror = () => setStatus('no heightmap');
    img.src = 'maps/stratis_height.png';
  }, []);

  // Build scene when heightmap is loaded
  useEffect(() => {
    if (!heightImg) return;
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
    ctrl.dampingFactor = 0.12;
    ctrl.rotateSpeed = 0.8;
    ctrl.keys = { LEFT: 0, RIGHT: 0, UP: 0, BOTTOM: 0 };
    ctrl.enableKeys = false;
    ctrl.update();

    scene.add(new THREE.AmbientLight(0x888888, 0.5));
    const sun = new THREE.DirectionalLight(0xffeedd, 1.0);
    sun.position.set(5000, 8000, 3000); scene.add(sun);
    scene.add(new THREE.DirectionalLight(0x8888ff, 0.3).position.set(-3000, 2000, -4000));

    const grid = new THREE.GridHelper(MAP, 32, 0x333355, 0x222244);
    grid.position.set(0, -3, 0); scene.add(grid);

    const mesh = new THREE.Mesh(buildMesh(heightImg), new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    }));
    scene.add(mesh);

    const markers = new THREE.Group(); scene.add(markers);
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

    setStatus('ready');

    return () => {
      running = false;
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      window.removeEventListener('resize', rs);
      renderer.dispose();
      if (c.contains(renderer.domElement)) c.removeChild(renderer.domElement);
    };
  }, [heightImg]);

  // Update markers
  useEffect(() => {
    const s = st.current;
    if (!s.markers) return;
    const g = s.markers;
    while (g.children.length) { const ch = g.children[0]; if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); g.remove(ch); }
    const sg = new THREE.SphereGeometry(6, 6, 6);
    Object.values(units || {}).forEach(u => {
      const p = u.position;
      if (!p || p.x === undefined || p.y === undefined) return;

      // Read height from heightmap image
      const tx = p.x - HALF;
      const tz = p.y - HALF;

      // Use the cached heightImg to sample height at this position
      const img = heightImg;
      if (!img) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const px = Math.round((p.x / MAP) * (img.width - 1));
      const py = Math.round((p.y / MAP) * (img.height - 1));
      const pixelData = ctx.getImageData(px, py, 1, 1).data;
      const val = (pixelData[0] << 8) | pixelData[1];
      const h = Math.max(0, -152.4 + (val / 65535) * (6.5 + 152.4)) * 3;

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
  }, [units, heightImg]);

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', overflow:'hidden' }}>
      <div ref={ref} style={{ width:'100%', height:'100%' }} />
      <div style={{ position:'absolute', top:12, left:12, zIndex:10, display:'flex', gap:4, alignItems:'center' }}>
        <span className="badge badge-primary">3D</span>
        <span className={`badge ${status==='ready'?'badge-success':''}`}>{status}</span>
      </div>
      <div style={{ position:'absolute', bottom:12, left:12, zIndex:10, fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-muted)', background:'rgba(0,0,0,0.7)', padding:'5px 10px', borderRadius:3, pointerEvents:'none' }}>
        WASD+Shift=fly · Drag=orbit · Scroll=zoom · M=2D
      </div>
    </div>
  );
}
