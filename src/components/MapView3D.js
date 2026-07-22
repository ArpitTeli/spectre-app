import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const MAP_SIZE = 8192;
const GRID_SIZE = 512;
const TILE_URL = 'https://jetelain.github.io/Arma3Map/maps/stratis';

function generateHeight(x, z) {
  const nx = x / MAP_SIZE;
  const nz = z / MAP_SIZE;
  let h = 0;
  const ridge = Math.sin(nx * 3.0 + nz * 2.0) * 0.3 +
                Math.sin(nx * 1.5 + nz * 4.0) * 0.2;
  h += Math.max(0, ridge * 80);
  h += Math.sin(nx * 8 + nz * 6) * 12;
  h += Math.sin(nx * 15 + nz * 10) * 6;
  h += Math.cos(nx * 20 - nz * 25) * 3;
  const dx = Math.min(x, MAP_SIZE - x) / 200;
  const dz = Math.min(z, MAP_SIZE - z) / 200;
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
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a2a1a';
    ctx.fillRect(0, 0, 1024, 1024);
    const ts = 256, tpr = 4;
    let loaded = 0;
    for (let ty = 0; ty < tpr; ty++) {
      for (let tx = 0; tx < tpr; tx++) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          ctx.drawImage(img, tx * ts, ty * ts, ts, ts);
          loaded++;
          if (loaded === tpr * tpr) resolve(canvas);
        };
        img.onerror = () => {
          ctx.fillStyle = '#2a3a2a';
          ctx.fillRect(tx * ts, ty * ts, ts, ts);
          loaded++;
          if (loaded === tpr * tpr) resolve(canvas);
        };
        img.src = `${TILE_URL}/10/${tx}/${ty}.png`;
      }
    }
    if (tpr * tpr === 0) resolve(canvas);
  });
}

function posTo3D(x, y) {
  return new THREE.Vector3(x - MAP_SIZE / 2, generateHeight(x, y) + 5, y - MAP_SIZE / 2);
}

function addUnitMarkers(scene, units, onSelect) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(12, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });

  Object.values(units).forEach(u => {
    const p = u.position;
    if (!p) return;
    const mesh = new THREE.Mesh(geo, mat.clone());
    const pos = posTo3D(p.x, p.y);
    mesh.position.copy(pos);
    mesh.userData = { id: u.id };
    if (u.status === 'DESTROYED' || u.status === 'DEAD') {
      mesh.material.color.setHex(0x585870);
      mesh.material.transparent = true;
      mesh.material.opacity = 0.3;
    }
    group.add(mesh);
  });

  scene.add(group);
  return group;
}

export default function MapView3D({ units, contacts, onUnitSelect, onContactSelect }) {
  const containerRef = useRef(null);
  const sceneObjectsRef = useRef({ scene: null, terrain: null, markers: null, controls: null, renderer: null, camera: null });
  const [status, setStatus] = useState('initializing');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || container.clientWidth === 0) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08080c);

    const camera = new THREE.PerspectiveCamera(60, w / h, 1, 50000);
    camera.position.set(6000, 4000, 4000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 100;
    controls.maxDistance = 15000;
    controls.dampingFactor = 0.08;
    controls.update();

    const ambient = new THREE.AmbientLight(0x888888, 0.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffeedd, 1.2);
    sun.position.set(5000, 8000, 3000);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
    fill.position.set(-3000, 2000, -4000);
    scene.add(fill);

    const grid = new THREE.GridHelper(MAP_SIZE, 20, 0x333355, 0x222244);
    grid.position.y = -50;
    scene.add(grid);

    // Terrain
    const terrainGeo = buildTerrainGeo();
    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x2a3a2a,
      roughness: 1,
      metalness: 0,
      flatShading: false,
      side: THREE.DoubleSide,
    });
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    scene.add(terrain);

    // Load satellite texture async
    setStatus('loading sat...');
    buildSatTexture().then(canvas => {
      const tex = new THREE.CanvasTexture(canvas);
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      terrainMat.map = tex;
      terrainMat.needsUpdate = true;
      setStatus('ready');
    });

    // Unit markers
    const markers = addUnitMarkers(scene, units || {});

    sceneObjectsRef.current = { scene, terrain, markers, controls, renderer, camera };

    let running = true;
    function animate() {
      if (!running) return;
      requestAnimationFrame(animate);
      controls.update();
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
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        display: 'flex', gap: 4
      }}>
        <span className="badge badge-primary">3D</span>
        <span className={`badge ${status === 'ready' ? 'badge-success' : ''}`}>{status}</span>
      </div>
      <div style={{
        position: 'absolute', bottom: 12, left: 12, zIndex: 10,
        fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)',
        background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: 3,
        pointerEvents: 'none'
      }}>
        M=2D  Drag=orbit  Scroll=zoom  Right-drag=pan
      </div>
    </div>
  );
}
