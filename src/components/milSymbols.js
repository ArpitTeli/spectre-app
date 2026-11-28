// Standard military map symbols (MIL-STD-2525C letter codes) via milsymbol.
// A symbol shows only what the game reports: side, kind of thing, how current
// the sighting is and, for something moving, its heading.
import ms from 'milsymbol';

// Positions 5-10 of the code, within the ground dimension unless stated.
const GROUND = {
  INFANTRY: 'UCI---',
  TANK: 'EVAT--', MBT: 'EVAT--',
  IFV: 'EVAA--', APC: 'EVAA--',
  CAR: 'EV----', TRUCK: 'EV----', VEHICLE: 'EV----',
  RECON: 'UCR---',
  // The 2525C letter set has no unmanned ground vehicle: show a ground vehicle.
  STOMPER: 'EV----', ED1: 'EV----',
};
const AIR = { UAV: 'MFQ---', FPV: 'MFQ---', HELI: 'MH----', PLANE: 'MF----' };

export function sidcFor(item, side) {
  const kind = String(item.vehicle_type || item.type || '').toUpperCase();
  // F friend, H hostile, S suspect
  const affiliation = side === 'friend' ? 'F' : item.state === 'SUSPECTED' ? 'S' : 'H';
  if (AIR[kind]) return `S${affiliation}AP${AIR[kind]}`;
  return `S${affiliation}GP${GROUND[kind] || '------'}`;
}

const cache = new Map();

/** { svg, width, height, anchor } for an item; cached by appearance. */
export function symbolFor(item, side, size = 20) {
  const sidc = sidcFor(item, side);
  const moving = (item.speed ?? 0) > 1 && Number.isFinite(item.heading);
  const direction = moving ? String(Math.round(item.heading / 5) * 5 % 360) : '';
  const key = `${sidc}|${size}|${direction}`;
  let made = cache.get(key);
  if (!made) {
    const symbol = new ms.Symbol(sidc, { size, ...(direction ? { direction } : {}) });
    const { width, height } = symbol.getSize();
    made = { svg: symbol.asSVG(), width, height, anchor: symbol.getAnchor() };
    cache.set(key, made);
  }
  return made;
}

/** A symbol for lists and headers: no direction arrow. */
export function listSymbol(item, side, size = 15) {
  return symbolFor({ ...item, speed: 0 }, side, size);
}
