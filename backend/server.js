import http from "http";
import express from "express";
import { WebSocketServer } from "ws";
import crypto from "crypto";

// ---- Config ----
const PORT = process.env.PORT || 5000;
const ROOM = { width: 1600, height: 900 }; // client should mirror these
const MOVE_RATE_LIMIT_MS = 12; // ~80 updates/sec cap per client
const CHAT_RATE_LIMIT_MS = 1000; // 1 message per second max
const MAX_MESSAGE_LENGTH = 200; // Prevent spam with long messages
const HEARTBEAT_INTERVAL_MS = 15000; // pings
const CONNECTION_TTL_MS = 30000; // declare dead if no pong in 30s
const PROXIMITY_RADIUS = 200; // px distance threshold

// ---- Server (HTTP + WS) ----
const app = express();
app.use(express.json());

// Lightweight health + debug routes
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));
app.get("/room", (req, res) => res.json(ROOM));

// If you later build the React app, serve it here (optional for Hour 1)
// app.use(express.static("./dist"));
// app.get("*", (_, res) => res.sendFile(path.resolve("./dist/index.html")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---- State ----
/** @type {Map<string, Participant>} */
const participants = new Map();

/**
 * @typedef {Object} Participant
 * @property {string} id
 * @property {string} name
 * @property {number} x
 * @property {number} y
 * @property {string} color
 * @property {number} lastSeen
 */

// ---- Utils ----
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const now = () => Date.now();
const makeId = () => crypto.randomUUID();
const randomColor = () => `hsl(${Math.floor(Math.random() * 360)} 90% 60%)`;
const randomSpawn = () => ({
  x: Math.floor(Math.random() * ROOM.width),
  y: Math.floor(Math.random() * ROOM.height),
});

function toClientParticipant(p) {
  return { id: p.id, name: p.name, x: p.x, y: p.y, color: p.color };
}

function calcNearby(p) {
  const nearby = [];
  for (const [id2, q] of participants) {
    if (p.id === id2) continue;
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    if (dx*dx + dy*dy <= PROXIMITY_RADIUS*PROXIMITY_RADIUS) {
      nearby.push(id2);
    }
  }
  return nearby;
}

function sendProximity(ws, p) {
  const nearby = calcNearby(p);
  send(ws, "proximity", { selfId: p.id, nearby });
}

function broadcast(type, payload, exceptWs = null) {
  const msg = JSON.stringify({ type, payload, ts: now() });
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */ && client !== exceptWs) {
      client.send(msg);
    }
  }
}

function send(ws, type, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, payload, ts: now() }));
}

// Sanitize chat message - prevent XSS and normalize text
function sanitizeMessage(text) {
  if (typeof text !== 'string') return '';
  
  return text
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH)
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/\s+/g, ' '); // Normalize whitespace
}

// Get participants within proximity of a given participant
function getProximityParticipants(sourceParticipant) {
  const nearby = [];
  for (const [id, participant] of participants) {
    if (sourceParticipant.id === id) continue;
    const dx = sourceParticipant.x - participant.x;
    const dy = sourceParticipant.y - participant.y;
    if (dx*dx + dy*dy <= PROXIMITY_RADIUS*PROXIMITY_RADIUS) {
      nearby.push(participant);
    }
  }
  return nearby;
}

// Send message to specific participants
function sendToParticipants(type, payload, targetParticipants, exceptWs = null) {
  const msg = JSON.stringify({ type, payload, ts: now() });
  for (const client of wss.clients) {
    if (client.readyState === 1 && client !== exceptWs) {
      // Check if this client belongs to one of the target participants
      const clientParticipant = Array.from(participants.values())
        .find(p => client._participantId === p.id);
      
      if (clientParticipant && targetParticipants.some(p => p.id === clientParticipant.id)) {
        client.send(msg);
      }
    }
  }
}

// ---- Message Protocol ----
// Client -> Server
//   join:     { name?: string }
//   move:     { x: number, y: number }
//   rename:   { name: string }
//   ping:     {}
//   chat:     { message: string }
//
// Server -> Client
//   welcome:  { selfId: string, room: {width, height} }
//   state:    { participants: Participant[] }
//   joined:   { participant: Participant }
//   moved:    { id: string, x: number, y: number }
//   renamed:  { id: string, name: string }
//   left:     { id: string }
//   pong:     {}
//   proximity: { selfId: string, nearby: string[] }
//   chat:     { senderId: string, senderName: string, message: string, timestamp: number }

// ---- WebSocket lifecycle ----
wss.on("connection", (ws) => {
  // Per-connection context
  let id = makeId();
  let lastMoveAt = 0;
  let lastChatAt = 0; // Rate limiting for chat
  ws.isAlive = true;
  ws._participantId = id; // Store participant ID on WebSocket for message routing

  // Provisional participant (until 'join')
  const spawn = randomSpawn();
  const p = {
    id,
    name: `Guest-${String(id).slice(0, 5)}`,
    x: spawn.x,
    y: spawn.y,
    color: randomColor(),
    lastSeen: now(),
  };
  participants.set(id, p);

  // Greet new client with their identity + full state
  send(ws, "welcome", { selfId: id, room: ROOM });
  send(ws, "state", { participants: Array.from(participants.values()).map(toClientParticipant) });

  // Notify others
  broadcast("joined", { participant: toClientParticipant(p) }, ws);

  ws.on("message", (data) => {
    try {
      const { type, payload } = JSON.parse(String(data));
      p.lastSeen = now();
      ws.isAlive = true;

      switch (type) {
        case "join": {
          const name = String(payload?.name ?? "").trim();
          if (name) {
            p.name = name.slice(0, 32);
            participants.set(id, p);
            // Echo back the corrected participant (e.g., truncated name)
            send(ws, "state", { participants: Array.from(participants.values()).map(toClientParticipant) });
            broadcast("renamed", { id, name: p.name }, ws);
          }
          break;
        }
        case "move": {
          const t = now();
          if (t - lastMoveAt < MOVE_RATE_LIMIT_MS) break; // simple rate limit
          lastMoveAt = t;
          let x = Number(payload?.x);
          let y = Number(payload?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) break;
          x = clamp(Math.round(x), 0, ROOM.width);
          y = clamp(Math.round(y), 0, ROOM.height);
          if (x === p.x && y === p.y) break;
          p.x = x; p.y = y;
          participants.set(id, p);
          broadcast("moved", { id, x, y }, ws);
          sendProximity(ws, p);
          break;
        }
        case "rename": {
          const name = String(payload?.name ?? "").trim();
          if (!name) break;
          const newName = name.slice(0, 32);
          if (newName !== p.name) {
            p.name = newName;
            participants.set(id, p);
            broadcast("renamed", { id, name: p.name });
          }
          break;
        }
        case "ping": {
          send(ws, "pong", {});
          break;
        }
        case "chat": {
          const currentTime = now();
          
          // Rate limiting
          if (currentTime - lastChatAt < CHAT_RATE_LIMIT_MS) {
            console.log(`Chat rate limit exceeded for participant ${id}`);
            break;
          }
          lastChatAt = currentTime;
          
          // Validate and sanitize message
          const rawMessage = payload?.message;
          if (!rawMessage) break;
          
          const sanitizedMessage = sanitizeMessage(rawMessage);
          if (!sanitizedMessage || sanitizedMessage.length === 0) {
            console.log(`Empty or invalid message from participant ${id}`);
            break;
          }
          
          // Get current participant state
          const sender = participants.get(id);
          if (!sender) {
            console.log(`Sender participant ${id} not found`);
            break;
          }
          
          // Find participants in proximity
          const nearbyParticipants = getProximityParticipants(sender);
          
          if (nearbyParticipants.length === 0) {
            console.log(`No nearby participants for ${id} to chat with`);
            // Optionally send a "no one nearby" message back to sender
            send(ws, "chat_error", { message: "No one nearby to chat with" });
            break;
          }
          
          console.log(`Broadcasting chat from ${sender.name} to ${nearbyParticipants.length} nearby participants`);
          
          // Create chat message payload
          const chatPayload = {
            senderId: sender.id,
            senderName: sender.name,
            message: sanitizedMessage,
            timestamp: currentTime
          };
          
          // Send to nearby participants (including sender for feedback)
          const allTargets = [sender, ...nearbyParticipants];
          sendToParticipants("chat", chatPayload, allTargets);
          
          break;
        }
        default:
          // ignore unknown messages in MVP
          break;
      }
    } catch (e) {
      console.error('Error processing message:', e);
    }
  });

  ws.on("pong", () => { 
    ws.isAlive = true; 
    p.lastSeen = now(); 
  });

  ws.on("close", () => {
    participants.delete(id);
    broadcast("left", { id });
  });

  ws.on("error", () => {
    // Avoid crashing the server on client socket errors
  });
});

// ---- Heartbeat (clean up dead sockets) ----
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    // Check if the connection is dead
    if (ws.isAlive === false) {
      console.log('Terminating dead connection');
      try { 
        ws.terminate(); 
      } catch (e) {
        console.error('Error terminating connection:', e);
      }
      return;
    }
    
    // Mark as potentially dead and send ping
    ws.isAlive = false;
    try { 
      ws.ping();
    } catch (e) {
      console.error('Error sending ping:', e);
      try { ws.terminate(); } catch {}
    }
  });

  // Also evict ghost participants that somehow lingered
  const cutoff = now() - CONNECTION_TTL_MS;
  for (const [id, p] of participants) {
    if (p.lastSeen < cutoff) {
      console.log(`Removing ghost participant: ${id}`);
      participants.delete(id);
      broadcast("left", { id });
    }
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`⚡ Futuristic Nexus WS server listening on :${PORT}`);
});