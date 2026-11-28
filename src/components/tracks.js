// What the map remembers between views: where each unit has been, and the
// destination of each Move ordered from this desktop. (Orders from a paired
// phone do not carry their destination to this window.)
export const trails = new Map(); // unit id -> [{x, y}]
export const routes = new Map(); // unit id -> {x, y}

const STEP_M = 4;
const JUMP_M = 300; // a teleport or a new mission, not driving
const KEEP = 80;
const ARRIVED_M = 25;
let currentMap = null;

export function trackPosition(mapName, unit) {
  if (mapName !== currentMap) {
    currentMap = mapName;
    trails.clear();
    routes.clear();
  }
  const { x, y } = unit.position;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  let path = trails.get(unit.id);
  if (!path) trails.set(unit.id, (path = []));
  const last = path[path.length - 1];
  const moved = last ? Math.hypot(x - last.x, y - last.y) : Infinity;
  if (last && moved > JUMP_M) path.length = 0;
  if (!last || moved >= STEP_M) path.push({ x, y });
  if (path.length > KEEP) path.splice(0, path.length - KEEP);

  const to = routes.get(unit.id);
  if (to && Math.hypot(x - to.x, y - to.y) < ARRIVED_M) routes.delete(unit.id);
}

export function noteOrder(command) {
  const { type, unit_id: id, x, y } = command || {};
  if (type === 'MOVE_TO' && id && Number.isFinite(x) && Number.isFinite(y)) routes.set(id, { x, y });
  else if (type === 'HOLD_ALL' || type === 'RTB_ALL' || type === 'FORM_UP' || type === 'DISPERSE') routes.clear();
  else if (id && ['HOLD', 'RTB', 'ATTACK'].includes(type)) routes.delete(id);
  else return;
  window.dispatchEvent(new Event('spectre:routes'));
}
