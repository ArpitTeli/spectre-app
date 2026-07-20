const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3722;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocket.Server({ server });

// Room structure: { host: ws, clients: Set<ws>, lastState: object }
const rooms = new Map();

wss.on('connection', (ws) => {
  let roomCode = null;
  let role = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── Join room ──
    if (msg.type === 'join') {
      roomCode = (msg.room || '').toUpperCase().trim();
      role = msg.role; // 'host' or 'client'

      if (!roomCode || !role) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing room or role' }));
        return;
      }

      if (!rooms.has(roomCode)) {
        rooms.set(roomCode, { host: null, clients: new Set(), lastState: null });
      }

      const room = rooms.get(roomCode);

      if (role === 'host') {
        if (room.host && room.host !== ws && room.host.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room already has a host' }));
          return;
        }
        room.host = ws;
        ws.send(JSON.stringify({ type: 'joined', role: 'host', room: roomCode, clients: room.clients.size }));
        console.log(`Room ${roomCode}: host connected`);
      } else {
        room.clients.add(ws);
        ws.send(JSON.stringify({ type: 'joined', role: 'client', room: roomCode }));
        // Send last known state to new client
        if (room.lastState) {
          ws.send(JSON.stringify({ type: 'state', data: room.lastState }));
        }
        // Notify host of new client count
        if (room.host && room.host.readyState === WebSocket.OPEN) {
          room.host.send(JSON.stringify({ type: 'client_count', count: room.clients.size }));
        }
        console.log(`Room ${roomCode}: client connected (${room.clients.size} total)`);
      }
      return;
    }

    // ── Host sends state ──
    if (msg.type === 'state' && role === 'host' && roomCode) {
      const room = rooms.get(roomCode);
      if (!room) return;
      room.lastState = msg.data;
      // Relay to all clients
      for (const client of room.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try { client.send(JSON.stringify({ type: 'state', data: msg.data })); } catch {}
        }
      }
      return;
    }

    // ── Client sends command ──
    if (msg.type === 'command' && role === 'client' && roomCode) {
      const room = rooms.get(roomCode);
      if (!room || !room.host) return;
      if (room.host.readyState === WebSocket.OPEN) {
        try { room.host.send(JSON.stringify({ type: 'command', data: msg.data })); } catch {}
      }
      return;
    }
  });

  ws.on('close', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (role === 'host' && room.host === ws) {
      room.host = null;
      // Notify all clients
      for (const client of room.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try { client.send(JSON.stringify({ type: 'host_disconnected' })); } catch {}
        }
      }
      console.log(`Room ${roomCode}: host disconnected`);
    } else if (role === 'client') {
      room.clients.delete(ws);
      if (room.host && room.host.readyState === WebSocket.OPEN) {
        room.host.send(JSON.stringify({ type: 'client_count', count: room.clients.size }));
      }
      console.log(`Room ${roomCode}: client disconnected (${room.clients.size} remaining)`);
    }

    // Clean up empty rooms
    if (!room.host && room.clients.size === 0) {
      rooms.delete(roomCode);
    }
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`SPECTRE Relay Server running on port ${PORT}`);
});
