// ─── Plain-text command queue (consumption-driven, no ack dependency) ─────────
// The app writes ONE command per file. The queue advances when the file BECOMES
// EMPTY (the game's READ_CLEAR truncates after reading) — file consumption IS
// the acknowledgement.
//
// A command may carry:
//   _notify(stage, reason)  told 'delivered', 'expired' or 'failed' once
//   _expiresAt              it is withdrawn if the game has not read it by then
// Desktop commands carry neither and wait as long as they need to.

const fs = require('fs');

const STUCK_MS = 15000;
const MAX_PENDING = 50;

function createCommandQueue({ filePath, buildLine, log = () => {}, now = Date.now }) {
  let pending = [];
  let inFlight = null; // the command currently written to the file
  let nonEmptySince = 0;

  function settle(cmd, stage, reason) {
    const notify = cmd._notify;
    if (!notify) return;
    cmd._notify = null;
    try { notify(stage, reason); } catch (e) { log(`SPECTRE: notify failed: ${e.message}`); }
  }

  function remove(cmd) {
    pending = pending.filter(c => c !== cmd);
    if (inFlight === cmd) inFlight = null;
  }

  function fileSize(p) {
    try { return fs.statSync(p).size; } catch (_) { return -1; }
  }

  function write(p, cmd) {
    const line = buildLine(cmd);
    if (!line.includes('|')) {
      remove(cmd);
      log(`SPECTRE: dropped phantom ${cmd.type}`);
      settle(cmd, 'failed', 'order had nothing to execute');
      return;
    }
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        fs.writeFileSync(p, line, 'utf8');
        inFlight = cmd;
        log(`SPECTRE: wrote command ${cmd.type} (${pending.length} pending)`);
        return;
      } catch (e) {
        if (attempt === 4 || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) {
          log(`SPECTRE: write failed: ${e.message}`);
          return;
        }
      }
    }
  }

  // Take the file away from the game. Renaming first means we can tell whether
  // the game read the order before we withdrew it.
  function withdraw(p, cmd) {
    const aside = `${p}.expired`;
    try {
      fs.renameSync(p, aside);
    } catch (e) {
      if (e.code !== 'ENOENT') return; // locked: try again on the next tick
      remove(cmd);
      settle(cmd, 'expired', 'the game did not pick it up in time');
      return;
    }
    let unread = true;
    try { unread = fs.statSync(aside).size !== 0; fs.rmSync(aside, { force: true }); } catch (_) {}
    remove(cmd);
    nonEmptySince = 0;
    if (unread) settle(cmd, 'expired', 'the game did not pick it up in time');
    else settle(cmd, 'delivered');
  }

  function expireWaiting() {
    const t = now();
    for (const cmd of [...pending]) {
      if (cmd !== inFlight && cmd._expiresAt && t > cmd._expiresAt) {
        remove(cmd);
        settle(cmd, 'expired', 'the game did not pick it up in time');
      }
    }
  }

  function tick() {
    const p = filePath();
    if (!p) return;
    try {
      const size = fileSize(p);
      if (inFlight && size === 0) {
        // Consumed by the game.
        const done = inFlight;
        remove(done);
        nonEmptySince = 0;
        log(`SPECTRE: command consumed (${pending.length} pending)`);
        settle(done, 'delivered');
      }
      expireWaiting();
      if (inFlight && inFlight._expiresAt && now() > inFlight._expiresAt) withdraw(p, inFlight);
      if (pending.length === 0) return;

      const current = fileSize(p);
      if (current === -1) {
        // Missing (reset by the stuck handler) — recreate the current command.
        write(p, pending[0]);
        return;
      }
      if (current !== 0) {
        // Not consumed yet. Detect a stuck reader.
        if (nonEmptySince === 0) nonEmptySince = now();
        if (now() - nonEmptySince > STUCK_MS) {
          try { fs.rmSync(p, { force: true }); } catch (_) {}
          nonEmptySince = 0;
          log('SPECTRE: command file stuck >15s — reset reader');
        }
        return;
      }
      nonEmptySince = 0;
      write(p, pending[0]);
    } catch (e) {
      log(`SPECTRE: advanceQueue error: ${e.message}`);
    }
  }

  return {
    push(cmd) {
      pending.push(cmd);
      while (pending.length > MAX_PENDING) {
        const dropped = pending.find(c => c !== inFlight);
        remove(dropped);
        settle(dropped, 'failed', 'too many orders waiting');
      }
      tick();
    },

    /** A safety order: goes next, and cancels waiting orders that could move units. */
    pushUrgent(cmd, cancels) {
      for (const other of [...pending]) {
        if (other !== inFlight && cancels(other)) {
          remove(other);
          settle(other, 'failed', `cancelled by ${cmd.type}`);
        }
      }
      pending.splice(inFlight ? 1 : 0, 0, cmd);
      tick();
    },

    clear(reason) {
      const dropped = pending;
      pending = [];
      inFlight = null;
      nonEmptySince = 0;
      dropped.forEach(cmd => settle(cmd, 'failed', reason));
    },

    tick,
    size: () => pending.length,
  };
}

module.exports = { createCommandQueue };
