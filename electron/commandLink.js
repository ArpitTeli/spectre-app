// ─── Paired command link (Android commander and later vehicle apps) ───────────
// Shares the LAN server on port 3721. Clients that never say hello only receive
// the read-only state feed, exactly as before.
//
//   client  {type:'hello', v:1, role:'commander'}
//   host    {type:'challenge', nonce}
//   client  {type:'auth', clientNonce, proof}      proof = HMAC(code, ...)
//   host    {type:'welcome', proof, control}       the host proves it knows the code too
//   host    {type:'beat', t, control}              every 2 s
//   client  {type:'order', body, mac}              mac = HMAC(sessionKey, body)
//   host    {type:'ack', id, stage, reason}        received | delivered | rejected | expired | failed
//
// The password is chosen on the host and never crosses the network. A short one
// can still be worked out by someone who records a pairing on the same network,
// and wrong guesses are rate limited here. Each order is signed with a key
// unique to the connection, numbered (no replays) and must quote a recent host
// beat (an order held up by a bad network is refused). Traffic is NOT
// encrypted: use a trusted network.

const crypto = require('crypto');

const PROTOCOL = 1;
const BEAT_MS = 2000;
const MAX_BEAT_AGE_MS = 8000; // order must quote a beat this recent
const DELIVERY_TTL_MS = 10000; // the game must pick it up within this
const MIN_PASSWORD = 4;
const MAX_PASSWORD = 64;
const TRIES = 5; // wrong passwords from one address before it must wait
const TRIES_TOTAL = 20; // from all addresses together
const LOCK_MS = 60000;

const UNIT_ORDERS = ['MOVE_TO', 'ATTACK', 'HOLD', 'RTB'];
const FORCE_ORDERS = ['HOLD_ALL', 'RTB_ALL', 'WEAPONS_FREE', 'WEAPONS_SAFE', 'FORM_UP', 'DISPERSE'];
const SAFETY_ORDERS = ['HOLD_ALL']; // any paired commander may send these
const ID_PATTERN = /^[A-Za-z0-9_\-]{1,40}$/;
const MAX_COORD = 40960;

/** Used until the operator chooses a password. */
function generatePassword() {
  return String(crypto.randomInt(0, 100000000)).padStart(8, '0');
}

/** The password trimmed, or null if it is too short or long. */
function cleanPassword(text) {
  const password = String(text ?? '').trim();
  return password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD ? password : null;
}

// Counts wrong passwords and says when to stop listening for a while.
function createLimiter(now) {
  const entries = new Map();
  const entry = key => {
    let e = entries.get(key);
    if (!e || (e.until && now() >= e.until)) entries.set(key, (e = { count: 0, until: 0 }));
    return e;
  };
  return {
    blocked: address => entry(address).until > 0 || entry('*').until > 0,
    fail(address) {
      for (const [key, limit] of [[address, TRIES], ['*', TRIES_TOTAL]]) {
        const e = entry(key);
        if (++e.count >= limit) e.until = now() + LOCK_MS;
      }
    },
    succeed: address => entries.delete(address),
    reset: () => entries.clear(),
  };
}

function hmac(key, text) {
  return crypto.createHmac('sha256', key).update(text, 'utf8').digest();
}

function sameHex(expected, actual) {
  if (typeof actual !== 'string' || !/^[0-9a-f]{64}$/.test(actual)) return false;
  return crypto.timingSafeEqual(expected, Buffer.from(actual, 'hex'));
}

/** Returns { command } built only from allowed fields, or { error }. */
function validateOrder(order, picture) {
  if (!order || typeof order !== 'object') return { error: 'malformed order' };
  const { type } = order;
  if (FORCE_ORDERS.includes(type)) return { command: { type } };
  if (!UNIT_ORDERS.includes(type)) return { error: 'order type not allowed' };

  const unit = order.unit_id;
  if (typeof unit !== 'string' || !ID_PATTERN.test(unit) || !picture.units.has(unit)) {
    return { error: 'unknown unit' };
  }
  if (type === 'MOVE_TO') {
    const { x, y } = order;
    const ok = v => Number.isFinite(v) && v >= 0 && v <= MAX_COORD;
    if (!ok(x) || !ok(y)) return { error: 'destination is off the map' };
    return { command: { type, unit_id: unit, x: Math.round(x), y: Math.round(y) } };
  }
  if (type === 'ATTACK') {
    const target = order.target_id;
    if (typeof target !== 'string' || !ID_PATTERN.test(target) || !picture.contacts.has(target)) {
      return { error: 'unknown target' };
    }
    return { command: { type, unit_id: unit, target_id: target } };
  }
  return { command: { type, unit_id: unit } };
}

function createCommandLink({ getCode, execute, log = () => {}, now = Date.now, onCount = () => {} }) {
  const sessions = new Set();
  const limiter = createLimiter(now);
  let controller = null;
  let mission = '';
  const picture = { units: new Set(), contacts: new Set() };

  const send = (session, message) => {
    if (session.ws.readyState !== 1) return;
    try { session.ws.send(JSON.stringify(message)); } catch (_) {}
  };

  const paired = () => [...sessions].filter(s => s.key);

  const beat = session => send(session, { type: 'beat', t: now(), control: controller === session });

  function deny(session, reason) {
    send(session, { type: 'denied', reason });
    try { session.ws.close(); } catch (_) {}
  }

  function onHello(session, msg) {
    if (msg.v !== PROTOCOL) return deny(session, 'this app version does not match the host');
    if (msg.role !== 'commander') return deny(session, 'role not supported');
    if (limiter.blocked(session.address)) return deny(session, 'too many wrong passwords: wait a minute');
    session.nonce = crypto.randomBytes(16).toString('hex');
    send(session, { type: 'challenge', nonce: session.nonce });
  }

  function onAuth(session, msg) {
    const code = getCode();
    const { nonce } = session;
    session.nonce = null; // one attempt per challenge
    const clientNonce = msg.clientNonce;
    if (limiter.blocked(session.address)) return deny(session, 'too many wrong passwords: wait a minute');
    if (!nonce || !code || typeof clientNonce !== 'string' || !/^[0-9a-f]{32}$/.test(clientNonce)
      || !sameHex(hmac(code, `auth\n${nonce}\n${clientNonce}\ncommander`), msg.proof)) {
      limiter.fail(session.address);
      log('SPECTRE-LINK: pairing refused');
      return deny(session, 'password is wrong');
    }
    limiter.succeed(session.address);
    session.key = hmac(code, `session\n${nonce}\n${clientNonce}`);
    session.lastSeq = 0;
    if (!controller) controller = session;
    send(session, {
      type: 'welcome',
      proof: hmac(code, `host\n${clientNonce}\n${nonce}`).toString('hex'),
      control: controller === session,
    });
    beat(session);
    log(`SPECTRE-LINK: commander paired (${paired().length} connected)`);
    onCount(paired().length);
  }

  function onOrder(session, msg) {
    if (!session.key) return deny(session, 'not paired');
    if (typeof msg.body !== 'string' || !sameHex(hmac(session.key, msg.body), msg.mac)) {
      return deny(session, 'order signature is wrong');
    }
    let body;
    try { body = JSON.parse(msg.body); } catch (_) { return deny(session, 'malformed order'); }
    const { seq, id, beat: quoted, order } = body || {};
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return deny(session, 'malformed order');
    const ack = (stage, reason) => send(session, { type: 'ack', id, stage, reason });

    if (!Number.isInteger(seq) || seq <= session.lastSeq) return ack('rejected', 'repeated order');
    session.lastSeq = seq;
    const age = now() - quoted;
    if (!Number.isFinite(age) || age < 0 || age > MAX_BEAT_AGE_MS) return ack('expired', 'it reached the host too late');

    const { command, error } = validateOrder(order, picture);
    if (error) return ack('rejected', error);
    if (controller !== session && !SAFETY_ORDERS.includes(command.type)) {
      return ack('rejected', 'another commander has control');
    }

    command._expiresAt = now() + DELIVERY_TTL_MS;
    command._notify = ack;
    ack('received');
    log(`SPECTRE-LINK: order ${command.type} ${command.unit_id || 'ALL'}`);
    execute(command);
  }

  const timer = setInterval(() => paired().forEach(beat), BEAT_MS);
  timer.unref?.();

  return {
    handleConnection(ws, address = 'unknown') {
      const session = { ws, address, nonce: null, key: null, lastSeq: 0 };
      sessions.add(session);
      ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'hello') onHello(session, msg);
        else if (msg.type === 'auth') onAuth(session, msg);
        else if (msg.type === 'order') onOrder(session, msg);
        else if (msg.type === 'take_control' && session.key) {
          controller = session;
          paired().forEach(beat);
        }
      });
      const gone = () => {
        if (!sessions.delete(session)) return;
        if (controller === session) controller = null;
        if (session.key) onCount(paired().length);
      };
      ws.on('close', gone);
      ws.on('error', gone);
    },

    /** Remember which units and contacts exist, for checking orders. */
    observe(state) {
      if (!state) return;
      if (state.missionFolder && state.missionFolder !== mission) {
        mission = state.missionFolder;
        picture.units.clear();
        picture.contacts.clear();
      }
      (state.units || []).forEach(u => u && u.id && picture.units.add(String(u.id)));
      (state.contacts || []).forEach(c => c && c.id && picture.contacts.add(String(c.id)));
    },

    /** Used when the password changes: every commander must pair again. */
    disconnectAll(reason) {
      limiter.reset();
      paired().forEach(s => deny(s, reason));
      controller = null;
    },

    count: () => paired().length,
    stop: () => clearInterval(timer),
  };
}

module.exports = {
  createCommandLink, validateOrder, generatePassword, cleanPassword,
  PROTOCOL, MAX_BEAT_AGE_MS, DELIVERY_TTL_MS, UNIT_ORDERS, FORCE_ORDERS,
};
