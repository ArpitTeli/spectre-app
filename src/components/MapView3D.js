import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const MAP_SIZE = 8192;
const GRID_SIZE = 1024;
const TILE_SERVER = 'https://jetelain.github.io/Arma3Map';
const TILE_PATTERN = '/maps/stratis/{z}/{x}/{y}.png';
const MAX_ZOOM = 4;
const TILE_SIZE = 226;
const MOVE_SPEED = 200;

function generateHeight(x, z) {
  const nx = x / MAP_SIZE;
  const nz = z / MAP_SIZE;
  let h = 0;
  const ridge = Math.sin(nx * 3.0 + nz * 2.0) * 0.4 +
                Math.sin(nx * 1.5 + nz * 4.0) * 0.25;
  h += Math.max(0, ridge * 80);
  h += Math.sin(nx * 8 + nz * 6) * 15;
  h += Math.sin(nx * 15 + nz * 10) * 8;
  h += Math.cos(nx * 20 - nz * 25) * 4;
  h += Math.sin(nx * 30 + nz * 20) * 3;
  const dx = Math.min(x, MAP_SIZE - x, 200) / 200;
  const dz = Math.min(z, MAP_SIZE - z, 200) / 200;
  h *= Math.min(1, Math.min(dx, dz));
  return Math.max(0, Math.min(135, h));
}

function buildTerrainGeo() {
  const verts = [];
  const uvs = [];
  const idx = [];
  const step = MAP_SIZE / GRID_SIZE;
  for (let iz = 0; iz <= GRID_SIZE; iz++) {
    for (let ix = 0; ix <= GRID_SIZE; ix++) {
      const x = ix * step, z = iz * step;
      verts.push(x - MAP_SIZE / 2, generateHeight(x, z), z - MAP_SIZE / 2);
      uvs.push(ix / GRID_SIZE, 1 - iz / GRID_SIZE);
    }
  }
  for (let iz = 0; iz < GRID_SIZE; iz++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      const a = iz * (GRID_SIZE + 1) + ix;
      const b = a + 1, c = a + GRID_SIZE + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function buildSatTexture() {
  return new Promise(resolve => {
    const tilesPerRow = Math.pow(2, MAX_ZOOM);
    const totalTiles = tilesPerRow * tilesPerRow;
    const outSize = tilesPerRow * TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a2a1a';
    ctx.fillRect(0, 0, outSize, outSize);

    let loaded = 0;
    let hasError = false;

    for (let ty = 0; ty < tilesPerRow; ty++) {
      for (let tx = 0; tx < tilesPerRow; tx++) {
        const url = `${TILE_SERVER}/maps/stratis/${MAX_ZOOM}/${tx}/${ty}.png`;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          ctx.drawImage(img, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          loaded++;
          if (loaded === totalTiles) resolve(canvas);
        };
        img.onerror = () => {
          hasError = true;
          loaded++;
          if (loaded === totalTiles) resolve(canvas);
        };
        img.src = url;
      }
    }
  });
}

function posTo3D(x, y) {
  const wx = x - MAP_SIZE / 2;
  const wz = y - MAP_SIZE / 2;
  return new THREE.Vector3(wx, generateHeight(x, y) + 3, wz);
}

export default function MapView3D({ units, contacts, onUnitSelect, onContactSelect }) {
  const containerRef = useRef(null);
  const stateRef = useRef({ controls: null, camera: null, scene: null, markers: null });
  const keysRef = useRef({});
  const [status, setStatus] = useState('init');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || container.clientWidth === 0) {
      const retry = setTimeout(() => setStatus(s => s), 100);
      return () => clearTimeout(retry);
    }

    const w = container.clientWidth;
    const h = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08080c);
    scene.fog = new THREE.Fog(0x08080c, 8000, 15000);

    const camera = new THREE.PerspectiveCamera(60, w / h, 1, 30000);
    camera.position.set(0, 800, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 10;
    controls.maxDistance = 20000;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.6;
    controls.update();

    stateRef.current = { controls, camera, scene, renderer };

    const ambient = new THREE.AmbientLight(0x888888, 0.5);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffeedd, 1.0);
    sun.position.set(5000, 8000, 3000);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
    fill.position.set(-3000, 2000, -4000);
    scene.add(fill);

    const grid = new THREE.GridHelper(MAP_SIZE, 32, 0x333355, 0x222244);
    grid.position.y = -2;
    scene.add(grid);

    const terrainGeo = buildTerrainGeo();
    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x2a3a2a,
      roughness: 0.9,
      metalness: 0,
      flatShading: false,
      side: THREE.DoubleSide,
    });
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.receiveShadow = false;
    scene.add(terrain);

    const markers = new THREE.Group();
    scene.add(markers);

    setStatus('loading');

    buildSatTexture().then(canvas => {
      const tex = new THREE.CanvasTexture(canvas);
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      terrainMat.map = tex;
      terrainMat.needsUpdate = true;
      setStatus('ready');
    }).catch(() => setStatus('ready (no sat)'));

    // WASD keyboard handling
    const keys = {};
    keysRef.current = keys;

    function onKey(e) {
      keys[e.key.toLowerCase()] = e.type === 'keydown';
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    let running = true;
    function animate() {
      if (!running) return;
      requestAnimationFrame(animate);

      const ctrl = stateRef.current.controls;
      if (ctrl) {
        const cam = ctrl.object;
        const forward = new THREE.Vector3();
        cam.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        let moved = false;
        const speed = MOVE_SPEED * (keys['shift'] ? 3 : 1);

        if (keys['w'] || keys['arrowup']) { ctrl.target.add(forward.clone().multiplyScalar(speed)); moved = true; }
        if (keys['s'] || keys['arrowdown']) { ctrl.target.add(forward.clone().multiplyScalar(-speed)); moved = true; }
        if (keys['a'] || keys['arrowleft']) { ctrl.target.add(right.clone().multiplyScalar(-speed)); moved = true; }
        if (keys['d'] || keys['arrowright']) { ctrl.target.add(right.clone().multiplyScalar(speed)); moved = true; }

        if (moved) {
          // Clamp to map bounds
          const half = MAP_SIZE / 2;
          ctrl.target.x = Math.max(-half, Math.min(half, ctrl.target.x));
          ctrl.target.z = Math.max(-half, Math.min(half, ctrl.target.z));
        }

        ctrl.update();
      }

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
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update unit markers
  useEffect(() => {
    const st = stateRef.current;
    if (!st.scene) return;

    // Find or create markers group
    let markers = st.markers;
    if (!markers) {
      markers = new THREE.Group();
      st.scene.add(markers);
      st.markers = markers;
    }

    // Remove old markers
    while (markers.children.length) {
      const c = markers.children[0];
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
      markers.remove(c);
    }

    const sphereGeo = new THREE.SphereGeometry(8, 8, 8);
    const coneGeo = new THREE.ConeGeometry(6, 16, 6);

    Object.values(units || {}).forEach(u => {
      const p = u.position;
      if (!p) return;
      const pos = posTo3D(p.x, p.y);

      const group = new THREE.Group();

      if (u.vehicle_type && u.vehicle_type !== 'INFANTRY') {
        const mat = new THREE.MeshBasicMaterial({
          color: u.status === 'DESTROYED' || u.status === 'DEAD' ? 0x585870 : 0x3b82f6,
          transparent: true,
          opacity: u.status === 'DESTROYED' || u.status === 'DEAD' ? 0.3 : 1,
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 12), mat);
        mesh.position.copy(pos);
        mesh.position.y += 6;
        group.add(mesh);
      } else {
        const mat = new THREE.MeshBasicMaterial({
          color: u.status === 'DESTROYED' || u.status === 'DEAD' ? 0x585870 : 0x3b82f6,
          transparent: u.status === 'DESTROYED' || u.status === 'DEAD',
          opacity: u.status === 'DESTROYED' ? 0.3 : 1,
        });
        const mesh = new THREE.Mesh(sphereGeo, mat);
        mesh.position.copy(pos);
        group.add(mesh);
      }

      // Direction indicator
      if (u.hdg !== undefined) {
        const dirMat = new THREE.MeshBasicMaterial({
          color: 0x60a5fa,
          transparent: true,
          opacity: u.status === 'DESTROYED' ? 0.2 : 1,
        });
        const dir = new THREE.Mesh(coneGeo, dirMat);
        dir.position.copy(pos);
        dir.position.y += 5;
        dir.rotation.x = Math.PI / 2;
        dir.rotation.z = (u.hdg || 0) * Math.PI / 180;
        group.add(dir);
      }

      markers.add(group);
    });
  }, [units]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        display: 'flex', gap: 4, alignItems: 'center'
      }}>
        <span className="badge badge-primary">3D</span>
        <span className={`badge ${status === 'ready' ? 'badge-success' : ''}`}
          style={{ opacity: status === 'loading' ? 0.6 : 1 }}>
          {status}
        </span>
      </div>
      <div style={{
        position: 'absolute', bottom: 12, left: 12, zIndex: 10,
        fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)',
        background: 'rgba(0,0,0,0.7)', padding: '5px 10px', borderRadius: 3,
        pointerEvents: 'none'
      }}>
        WASD+Shift=move · Drag=orbit · Scroll=zoom · M=2D
      </div>
    </div>
  );
}
