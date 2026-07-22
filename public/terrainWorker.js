// Web Worker: parses terrain objects binary buffer in background
// Binary format: [count:u32, per object: x:f32, y:f32, z:f32, dir:f32, w:f32, h:f32, d:f32, shape:u8, density:u8, pad:u16]
// shape: 0=cone, 1=sphere, 2=flat(bush)
// density: 0=sparse(0.35), 1=medium(0.50), 2=dense(0.70), 3=very_dense(0.90)

self.onmessage = function(e) {
  const buf = e.data;
  const view = new DataView(buf);
  const count = view.getUint32(0, true);
  const OBJ_SIZE = 32;
  const HEADER = 4;

  // Pre-allocate typed arrays for each shape+density combo (6 combos: 3 shapes × up to 4 densities)
  const groups = {};

  for (let i = 0; i < count; i++) {
    const off = HEADER + i * OBJ_SIZE;
    const x = view.getFloat32(off, true);
    const y = view.getFloat32(off + 4, true);
    const z = view.getFloat32(off + 8, true);
    const dir = view.getFloat32(off + 12, true);
    const w = view.getFloat32(off + 16, true);
    const h = view.getFloat32(off + 20, true);
    const d = view.getFloat32(off + 24, true);
    const shape = view.getUint8(off + 28);
    const density = view.getUint8(off + 29);

    const key = shape + '_' + density;
    if (!groups[key]) {
      groups[key] = { shape, density, instances: [] };
    }
    groups[key].instances.push({ x, y, z, dir, w, h, d });
  }

  // Convert to plain arrays for transfer
  const result = {};
  for (const key in groups) {
    const g = groups[key];
    result[key] = {
      shape: g.shape,
      density: g.density,
      count: g.instances.length,
      x: new Float32Array(g.instances.map(o => o.x)),
      y: new Float32Array(g.instances.map(o => o.y)),
      z: new Float32Array(g.instances.map(o => o.z)),
      dir: new Float32Array(g.instances.map(o => o.dir)),
      w: new Float32Array(g.instances.map(o => o.w)),
      h: new Float32Array(g.instances.map(o => o.h)),
      d: new Float32Array(g.instances.map(o => o.d)),
    };
  }

  self.postMessage(result);
};
