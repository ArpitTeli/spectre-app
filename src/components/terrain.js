// A tactical basemap drawn from the game's own data (public/maps): the height
// map, road network and objects. Relief is a raster; coastline, contours,
// roads, trees, buildings and the 1 km grid are drawn as vectors for every
// tile, so they stay sharp at any zoom. No map images, no network.
import L from 'leaflet';

const WORLDS = { stratis: { size: 8192, low: -157.5, range: 392.4 } };
const CELL = 512; // metres per lookup bucket
const RELIEF = 1024; // pixels of the shaded-relief raster

export const hasTerrain = (mapName) => !!WORLDS[String(mapName || '').toLowerCase()];

// ───────── loading ─────────
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`cannot load ${src}`));
    image.src = src;
  });
}

const fetchBuffer = (src) => fetch(src).then((r) => r.arrayBuffer());

function readHeights(image, world) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
  const n = image.width;
  const raw = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) raw[i] = world.low + (pixels[i * 4] / 255) * world.range;
  // The file stores 256 levels; a light blur removes the stair steps.
  const smooth = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          const w = (dx ? 1 : 2) * (dy ? 1 : 2);
          sum += raw[yy * n + xx] * w;
          weight += w;
        }
      }
      smooth[y * n + x] = sum / weight;
    }
  }
  return { n, data: smooth, step: world.size / (n - 1) }; // row 0 is the south edge
}

function sample(heights, x, y) {
  const { n, data, step } = heights;
  const fx = Math.max(0, Math.min(n - 1.001, x / step));
  const fy = Math.max(0, Math.min(n - 1.001, y / step));
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const at = (a, b) => data[b * n + a];
  return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
}

// ───────── shaded relief ─────────
const LAND = [[0, [35, 64, 58]], [25, [44, 76, 60]], [70, [63, 90, 62]], [130, [90, 98, 68]], [190, [118, 106, 78]], [260, [146, 128, 100]]];
const SEA = [[-160, [7, 16, 29]], [-60, [10, 25, 43]], [-18, [14, 40, 61]], [-3, [22, 62, 84]], [0, [30, 82, 101]]];

function ramp(stops, value) {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [h, colour] = stops[i];
    if (value <= h) {
      const [h0, c0] = stops[i - 1];
      const t = (value - h0) / (h - h0);
      return [0, 1, 2].map((k) => c0[k] + (colour[k] - c0[k]) * t);
    }
  }
  return stops[stops.length - 1][1];
}

function drawRelief(heights, size) {
  const canvas = document.createElement('canvas');
  canvas.width = RELIEF;
  canvas.height = RELIEF;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(RELIEF, RELIEF);
  const metres = size / RELIEF;
  // Light from the north-west, as on printed terrain maps.
  const light = [-0.55, 0.55, 0.63];
  for (let py = 0; py < RELIEF; py++) {
    const y = size - (py + 0.5) * metres;
    for (let px = 0; px < RELIEF; px++) {
      const x = (px + 0.5) * metres;
      const h = sample(heights, x, y);
      let colour;
      if (h <= 0) {
        colour = ramp(SEA, h);
      } else {
        const e = 14;
        const dx = (sample(heights, x + e, y) - sample(heights, x - e, y)) / (2 * e);
        const dy = (sample(heights, x, y + e) - sample(heights, x, y - e)) / (2 * e);
        const k = 2.4; // vertical exaggeration for the shading only
        const length = Math.hypot(dx * k, dy * k, 1);
        const lit = (-dx * k * light[0] - dy * k * light[1] + light[2]) / length;
        const shade = Math.max(0.5, Math.min(1.62, 0.46 + lit * 0.9));
        colour = ramp(LAND, h).map((c) => c * shade);
      }
      const o = (py * RELIEF + px) * 4;
      image.data[o] = colour[0];
      image.data[o + 1] = colour[1];
      image.data[o + 2] = colour[2];
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// ───────── vectors, bucketed so a tile only visits what it can show ─────────
function bucket() {
  const cells = new Map();
  return {
    add(x, y, item) {
      const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
      let list = cells.get(key);
      if (!list) cells.set(key, (list = []));
      list.push(item);
    },
    each(x0, y0, x1, y1, visit) {
      for (let cx = Math.floor(x0 / CELL) - 1; cx <= Math.floor(x1 / CELL) + 1; cx++) {
        for (let cy = Math.floor(y0 / CELL) - 1; cy <= Math.floor(y1 / CELL) + 1; cy++) {
          const list = cells.get(`${cx},${cy}`);
          if (list) list.forEach(visit);
        }
      }
    },
  };
}

function contourSegments(heights) {
  const { n, data, step } = heights;
  const out = { coast: bucket(), index: bucket(), minor: bucket() };
  for (let level = 0; level <= 240; level += 10) {
    const into = level === 0 ? out.coast : level % 50 === 0 ? out.index : out.minor;
    const value = level === 0 ? 0.3 : level;
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const a = data[y * n + x];
        const b = data[y * n + x + 1];
        const c = data[(y + 1) * n + x + 1];
        const d = data[(y + 1) * n + x];
        if ((a > value) === (b > value) && (b > value) === (c > value) && (c > value) === (d > value)) continue;
        const points = [];
        const cross = (v0, v1, x0, y0, x1, y1) => {
          if ((v0 > value) !== (v1 > value)) {
            const t = (value - v0) / (v1 - v0);
            points.push([(x0 + (x1 - x0) * t) * step, (y0 + (y1 - y0) * t) * step]);
          }
        };
        cross(a, b, x, y, x + 1, y);
        cross(b, c, x + 1, y, x + 1, y + 1);
        cross(c, d, x + 1, y + 1, x, y + 1);
        cross(d, a, x, y + 1, x, y);
        for (let i = 0; i + 1 < points.length; i += 2) {
          into.add(points[i][0], points[i][1], [...points[i], ...points[i + 1]]);
        }
      }
    }
  }
  return out;
}

// The file holds road pieces: position, direction (degrees from east) and
// width. Its stored chains were joined by closeness alone and zigzag, so the
// pieces are linked here by direction: on each side, the nearest piece that
// lies along this one's axis and points the same way.
function parseRoads(buffer) {
  const view = new DataView(buffer);
  const total = view.getUint32(0, true);
  const start = 8 + view.getUint32(4, true) * 4;
  const pieces = Array.from({ length: total }, (_, i) => {
    const o = start + i * 16;
    const angle = (view.getFloat32(o + 8, true) * Math.PI) / 180;
    return { x: view.getFloat32(o, true), y: view.getFloat32(o + 4, true), ax: Math.cos(angle), ay: Math.sin(angle) };
  });
  const near = bucket();
  pieces.forEach((p, i) => near.add(p.x, p.y, i));

  const REACH = 80;
  const CONE = Math.cos((35 * Math.PI) / 180);
  const links = pieces.map(() => new Map()); // piece -> (other -> length)
  pieces.forEach((p, i) => {
    const best = [null, null];
    near.each(p.x - REACH, p.y - REACH, p.x + REACH, p.y + REACH, (j) => {
      const q = pieces[j];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.5 || length >= REACH) return;
      const along = (dx * p.ax + dy * p.ay) / length;
      if (Math.abs(along) <= CONE || Math.abs((dx * q.ax + dy * q.ay) / length) <= CONE) return;
      const side = along > 0 ? 0 : 1;
      if (!best[side] || length < best[side][1]) best[side] = [j, length];
    });
    best.forEach((found) => {
      if (!found) return;
      links[i].set(found[0], found[1]);
      links[found[0]].set(i, found[1]);
    });
  });

  const roads = bucket();
  links.forEach((others, i) => {
    others.forEach((length, j) => {
      if (j <= i) return;
      // The long side of a small triangle is a false shortcut between lanes.
      for (const [k, first] of others) {
        const second = links[k].get(j);
        if (second !== undefined && first < length && second < length) return;
      }
      roads.add(pieces[i].x, pieces[i].y, [pieces[i].x, pieces[i].y, pieces[j].x, pieces[j].y]);
    });
  });
  return roads;
}

function parseObjects(buffer) {
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);
  const trees = bucket();
  const buildings = bucket();
  for (let i = 0, o = 4; i < count; i++, o += 32) {
    const x = view.getFloat32(o, true);
    const y = view.getFloat32(o + 4, true);
    const w = view.getFloat32(o + 16, true);
    const d = view.getFloat32(o + 24, true);
    const shape = view.getUint8(o + 28);
    if (shape === 3) buildings.add(x, y, [x, y, w, d, view.getFloat32(o + 12, true)]);
    else trees.add(x, y, [x, y, Math.max(1.5, Math.min(6, w / 2)), shape]);
  }
  return { trees, buildings };
}

const loaded = new Map();

/** Loads and prepares a map's data once. */
export function loadTerrain(mapName) {
  const name = String(mapName || '').toLowerCase();
  const world = WORLDS[name];
  if (!world) return Promise.reject(new Error('no terrain data for this map'));
  if (!loaded.has(name)) {
    const promise = Promise.all([
      loadImage(`maps/${name}_height.png`),
      fetchBuffer(`maps/${name}_roads.bin`),
      fetchBuffer(`maps/${name}_objects.bin`),
    ]).then(([image, roadData, objectData]) => {
      const heights = readHeights(image, world);
      return {
        size: world.size,
        heightAt: (x, y) => sample(heights, x, y),
        relief: drawRelief(heights, world.size),
        contours: contourSegments(heights),
        roads: parseRoads(roadData),
        ...parseObjects(objectData),
      };
    });
    promise.catch(() => loaded.delete(name));
    loaded.set(name, promise);
  }
  return loaded.get(name);
}

// ───────── tiles ─────────
function lines(ctx, store, box, toPx, style, width) {
  ctx.beginPath();
  store.each(...box, (s) => {
    ctx.moveTo(...toPx(s[0], s[1]));
    ctx.lineTo(...toPx(s[2], s[3]));
  });
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawTile(ctx, terrain, box, scale, side) {
  const [x0, y0, x1, y1] = box;
  const toPx = (x, y) => [(x - x0) * scale, (y1 - y) * scale];

  ctx.fillStyle = '#050b14';
  ctx.fillRect(0, 0, side, side);
  const k = RELIEF / terrain.size;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(terrain.relief, x0 * k, (terrain.size - y1) * k, (x1 - x0) * k, (y1 - y0) * k, 0, 0, side, side);

  // Trees: only once they are big enough to read.
  if (scale > 0.12) {
    ctx.fillStyle = 'rgba(42, 112, 72, 0.6)';
    ctx.beginPath();
    terrain.trees.each(...box, ([x, y, r]) => {
      const [px, py] = toPx(x, y);
      const radius = Math.max(0.8, r * scale);
      if (px < -radius || py < -radius || px > side + radius || py > side + radius) return;
      ctx.moveTo(px + radius, py);
      ctx.arc(px, py, radius, 0, Math.PI * 2);
    });
    ctx.fill();
  }

  if (scale > 0.18) lines(ctx, terrain.contours.minor, box, toPx, 'rgba(218, 236, 204, 0.22)', 0.7);
  lines(ctx, terrain.contours.index, box, toPx, 'rgba(232, 242, 208, 0.46)', 1);
  lines(ctx, terrain.contours.coast, box, toPx, 'rgba(86, 214, 232, 0.16)', 5);
  lines(ctx, terrain.contours.coast, box, toPx, 'rgba(132, 228, 240, 0.80)', 1.1);

  const roadWidth = Math.max(1.4, Math.min(9, 8 * scale));
  lines(ctx, terrain.roads, box, toPx, 'rgba(4, 8, 12, 0.85)', roadWidth + 2.2);
  lines(ctx, terrain.roads, box, toPx, '#ecd9a4', roadWidth);

  if (scale > 0.12) {
    ctx.fillStyle = '#aab7c6';
    ctx.strokeStyle = 'rgba(4, 8, 12, 0.8)';
    ctx.lineWidth = 1;
    terrain.buildings.each(...box, ([x, y, w, d, dir]) => {
      const [px, py] = toPx(x, y);
      const bw = Math.max(1.2, w * scale);
      const bd = Math.max(1.2, d * scale);
      if (px < -bw || py < -bd || px > side + bw || py > side + bd) return;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((dir * Math.PI) / 180);
      ctx.fillRect(-bw / 2, -bd / 2, bw, bd);
      if (bw > 4) ctx.strokeRect(-bw / 2, -bd / 2, bw, bd);
      ctx.restore();
    });
  }

  // 1 km grid, numbered like the map references shown elsewhere.
  ctx.strokeStyle = 'rgba(170, 214, 250, 0.24)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(214, 236, 255, 0.78)';
  ctx.font = '600 10px "JetBrains Mono", Consolas, monospace';
  const km = (v) => String(Math.round(v / 100)).padStart(3, '0');
  for (let gx = Math.ceil(x0 / 1000) * 1000; gx <= x1; gx += 1000) {
    const [px] = toPx(gx, y0);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, side);
    ctx.stroke();
    for (let gy = Math.ceil(y0 / 1000) * 1000; gy <= y1; gy += 1000) {
      const [, py] = toPx(gx, gy);
      ctx.fillText(`${km(gx)} ${km(gy)}`, px + 4, py - 4);
    }
  }
  for (let gy = Math.ceil(y0 / 1000) * 1000; gy <= y1; gy += 1000) {
    const [, py] = toPx(x0, gy);
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(side, py);
    ctx.stroke();
  }
}

/** A Leaflet layer for a CRS where lng = Arma x and lat = Arma y, in metres. */
export function terrainLayer(terrain) {
  const Layer = L.GridLayer.extend({
    createTile(coords) {
      const side = this.getTileSize().x;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement('canvas');
      canvas.width = side * ratio;
      canvas.height = side * ratio;
      const crs = this._map.options.crs;
      const corner = L.point(coords.x * side, coords.y * side);
      const nw = crs.pointToLatLng(corner, coords.z);
      const se = crs.pointToLatLng(corner.add([side, side]), coords.z);
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      drawTile(ctx, terrain, [nw.lng, se.lat, se.lng, nw.lat], side / (se.lng - nw.lng), side);
      return canvas;
    },
  });
  return new Layer({ tileSize: 256, minZoom: 0, maxZoom: 12, keepBuffer: 2, updateWhenZooming: false });
}
