// Shared wording and formatting for units and contacts.
export const TYPE_LABELS = {
  INFANTRY: 'Infantry', CAR: 'Car', RECON: 'Recon', TRUCK: 'Truck',
  APC: 'APC', IFV: 'IFV', TANK: 'Tank', MBT: 'Tank', HELI: 'Helicopter',
  PLANE: 'Fixed-wing', BOAT: 'Boat', VEHICLE: 'Vehicle',
  FPV: 'FPV drone', UAV: 'UAV', STOMPER: 'Stomper UGV', ED1: 'ED-1D UGV',
};

/** Six-figure Arma grid (100 m squares). */
export function gridRef(position) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return '—';
  const part = (v) => String(Math.max(0, Math.floor(v / 100))).padStart(3, '0');
  return `${part(position.x)} ${part(position.y)}`;
}

export const tone = (percent) => (percent > 60 ? 'good' : percent > 30 ? 'warn' : 'bad');

export const isDown = (unit) => unit.status === 'DESTROYED' || unit.status === 'DEAD';

/** For the status stripe: down, damaged, moving or still. */
export function unitState(unit) {
  if (isDown(unit)) return 'down';
  if ((unit.health ?? 100) <= 60 || (unit.fuel ?? 100) <= 25) return 'damaged';
  return (unit.speed ?? 0) > 1 ? 'moving' : 'still';
}
