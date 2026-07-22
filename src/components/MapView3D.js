import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const MAP_SIZE = 8192;
const HALF = MAP_SIZE / 2;
const GRID_SIZE = 512;
const VERT_EXAG = 3.0;
const TILE_SERVER = 'https://jetelain.github.io/Arma3Map';
const MAX_ZOOM = 4;
const TILE_SIZE = 226;

function generateHeight(x, y) {
  const nx = x / MAP_SIZE;
  const ny = y / MAP_SIZE;
  let h = 0;
  h += Math.max(0, Math.sin(nx * 3.0 + ny * 2.0) * 0.4 + Math.sin(nx * 1.5 + ny * 4.0) * 0.25) * 80;
  h += Math.sin(nx * 8 + ny * 6) * 18;
  h += Math.sin(nx * 15 + ny * 10) * 10;
  h += Math.cos(nx * 20 - ny * 25) * 5;
  h += Math.sin(nx * 35 + ny * 22) * 3;
  const dx = Math.min(x, MAP_SIZE - x, 300) / 300;
  const dy = Math.min(y, MAP_SIZE - y, 300) / 300;
  h *= Math.min(1, Math.min(dx, dy));
  h = Math.max(0, Math.min(135, h));
  return h * VERT_EXAG;
}

function getHeightColor(h) {
  const t = h / (135 * VERT_EXAG);
  if (t < 0.05) return new THREE.Color(0.25, 0.35, 0.20);
  if (t < 0.15) return new THREE.Color(0.30, 0.45, 0.22);
  if (t < 0.30) return new THREE.Color(0.35, 0.50, 0.20);
  if (t < 0.50) return new THREE.Color(0.45, 0.45, 0.25);
  if (t < 0.70) return new THREE.Color(0.50, 0.40, 0.28);
  return new THREE.Color(0.45, 0.35, 0.25);
}

function buildTerrain() {
  const verts = [];
  const colors = [];
  const uvs = [];
  const idx = [];
  const step = MAP_SIZE / GRID_SIZE;

  for (let iy = 0; iy <= GRID_SIZE; iy++) {
    for (let ix = 0; ix <= GRID_SIZE; ix++) {
      const wx = ix * step, wy = iy * step;
      const h = generateHeight(wx, wy);
      verts.push(wx - HALF, h, wy - HALF);
      uvs.push(ix / GRID_SIZE, 1 - iy / GRID_SIZE);
      const c = getHeightColor(h);
      colors.push(c.r, c.g, c.b);
    }
  }

  for (let iy = 0; iy < GRID_SIZE; iy++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      const a = iy * (GRID_SIZE + 1) + ix;
      const b = a + 1, c = a + GRID_SIZE + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function loadSatTexture() {
  return new Promise(resolve => {
    const tpr = Math.pow(2, MAX_ZOOM);
    const total = tpr * tpr;
    const outSize = tpr * TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a2a1a';
    ctx.fillRect(0, 0, outSize, outSize);

    let loaded = 0;
    for (let ty = 0; ty < tpr; ty++) {
      for (let tx = 0; tx < tpr; tx++) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { ctx.drawImage(img, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE); loaded++; if (loaded === total) resolve(canvas); };
        img.onerror = () => { loaded++; if (loaded === total) resolve(canvas); };
        img.src = `${TILE_SERVER}/maps/stratis/${MAX_ZOOM}/${tx}/${ty}.png`;
      }
    }
  });
}

export default function MapView3D({ units, contacts, onUnitSelect, onContactSelect }) {
  const containerRef = useRef(null);
  const stateRef = useRef({});
  const keysRef = useRef({});
  const [status, setStatus] = useState('init');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.tabIndex = 0;
    container.style.outline = 'none';

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08080c);
    scene.fog = new THREE.Fog(0x08080c, 6000, 14000);

    const camera = new THREE.PerspectiveCamera(60, w / h, 1, 30000);
    camera.position.set(0, 300, 500);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 5;
    controls.maxDistance = 20000;
    controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.8;
    controls.keys = { LEFT: 0, RIGHT: 0, UP: 0, BOTTOM: 0 };
    controls.enableKeys = false;
    controls.update();

    stateRef.current.controls = controls;

    scene.add(new THREE.AmbientLight(0x888888, 0.6));
    const sun = new THREE.DirectionalLight(0xffeedd, 0.9);
    sun.position.set(5000, 6000, 3000);
    scene.add(sun);
    scene.add(new THREE.DirectionalLight(0x8888ff, 0.3).position.set(-3000, 2000, -4000));

    const grid = new THREE.GridHelper(MAP_SIZE, 32, 0x333355, 0x222244);
    grid.position.y = -3;
    scene.add(grid);

    // Terrain with height vertex colors
    const terrainGeo = buildTerrain();
    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    scene.add(terrain);

    // Load satellite texture on top
    setStatus('loading');
    loadSatTexture().then(canvas => {
      const tex = new THREE.CanvasTexture(canvas);
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      terrainMat.map = tex;
      terrainMat.vertexColors = false;
      terrainMat.needsUpdate = true;
      setStatus('ready');
    }).catch(() => setStatus('ready'));

    // Markers group
    const markers = new THREE.Group();
    scene.add(markers);
    stateRef.current.markers = markers;

    stateRef.current.scene = scene;
    stateRef.current.renderer = renderer;
    stateRef.current.camera = camera;

    // Keyboard state
    const keys = keysRef.current;

    function onKey(e) {
      keys[e.key.toLowerCase()] = e.type === 'keydown';
      keys[e.key] = e.type === 'keydown';
      // Prevent arrow keys from scrolling
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    // Focus container on click so keyboard works
    container.addEventListener('click', () => container.focus());

    // Movement loop
    let moveInterval;
    function moveLoop() {
      const ctrl = stateRef.current.controls;
      if (!ctrl) return;

      const cam = ctrl.object;
      const forward = new THREE.Vector3();
      cam.getWorldDirection(forward);
      forward.y = 0;
      if (forward.length() < 0.001) forward.z = -1;
      forward.normalize();

      const right = new THREE.Vector3();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      const speed = (keys['shift'] || keys['Shift'] ? 400 : 120) * 0.016;
      let dx = 0, dz = 0;

      if (keys['w'] || keys['W'] || keys['ArrowUp']) { dx += forward.x * speed; dz += forward.z * speed; }
      if (keys['s'] || keys['S'] || keys['ArrowDown']) { dx -= forward.x * speed; dz -= forward.z * speed; }
      if (keys['a'] || keys['A'] || keys['ArrowLeft']) { dx -= right.x * speed; dz -= right.z * speed; }
      if (keys['d'] || keys['D'] || keys['ArrowRight']) { dx += right.x * speed; dz += right.z * speed; }

      if (dx !== 0 || dz !== 0) {
        ctrl.target.x += dx;
        ctrl.target.z += dz;
        ctrl.target.x = Math.max(-HALF, Math.min(HALF, ctrl.target.x));
        ctrl.target.z = Math.max(-HALF, Math.min(HALF, ctrl.target.z));
        ctrl.update();
      }
    }
    moveInterval = setInterval(moveLoop, 16);

    let running = true;
    function animate() {
      if (!running) return;
      requestAnimationFrame(animate);
      stateRef.current.controls?.update();
      renderer.render(scene, camera);
    }
    animate();

    function onResize() {
      const c = containerRef.current;
      if (!c) return;
      const nw = c.clientWidth, nh = c.clientHeight;
      if (nw === 0 || nh === 0) return;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    }
    window.addEventListener('resize', onResize);

    return () => {
      running = false;
      clearInterval(moveInterval);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  // Update unit markers
  useEffect(() => {
    const markers = stateRef.current.markers;
    if (!markers) return;

    while (markers.children.length) {
      const c = markers.children[0];
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
      markers.remove(c);
    }

    const sphereGeo = new THREE.SphereGeometry(6, 6, 6);

    Object.values(units || {}).forEach(u => {
      const p = u.position;
      if (!p || p.x === undefined || p.y === undefined) return;

      // Convert Arma coords to Three.js: Arma (x,y) → Three.js (x - HALF, z = y - HALF)
      const tx = p.x - HALF;
      const tz = p.y - HALF;
      const th = generateHeight(p.x, p.y);

      const group = new THREE.Group();
      const dead = u.status === 'DESTROYED' || u.status === 'DEAD';
      const opacity = dead ? 0.25 : 1;

      if (u.vehicle_type && u.vehicle_type !== 'INFANTRY' && u.vehicle_type !== 'MAN') {
        const mat = new THREE.MeshBasicMaterial({ color: dead ? 0x585870 : 0x3b82f6, transparent: true, opacity });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 10), mat);
        mesh.position.set(tx, th + 5, tz);
        group.add(mesh);
      } else {
        const mat = new THREE.MeshBasicMaterial({ color: dead ? 0x585870 : 0x3b82f6, transparent: true, opacity });
        const mesh = new THREE.Mesh(sphereGeo.clone(), mat);
        mesh.position.set(tx, th + 3, tz);
        group.add(mesh);

        if (u.hdg !== undefined) {
          const dirmat = new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity });
          const dir = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 6), dirmat);
          dir.position.set(tx, th + 3, tz);
          dir.rotation.x = Math.PI / 2;
          dir.rotation.z = (u.hdg || 0) * Math.PI / 180;
          group.add(dir);
        }
      }

      // Label
      if (u.callsign) {
        const labelPos = new THREE.Vector3(tx, th + 12, tz);
        group.userData = { label: u.callsign, position: labelPos };
      }

      markers.add(group);
    });
  }, [units]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10, display: 'flex', gap: 4, alignItems: 'center' }}>
        <span className="badge badge-primary">3D</span>
        <span className={`badge ${status === 'ready' ? 'badge-success' : ''}`}>{status}</span>
      </div>
      <div style={{
        position: 'absolute', bottom: 12, left: 12, zIndex: 10,
        fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)',
        background: 'rgba(0,0,0,0.7)', padding: '5px 10px', borderRadius: 3,
        pointerEvents: 'none'
      }}>
        Click map · WASD+Shift=move · Drag=orbit · Scroll=zoom · M=2D
      </div>
    </div>
  );
}
