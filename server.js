const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ---------- Static + friendly routes ----------
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/lobby", (req, res) => res.sendFile(path.join(__dirname, "public", "lobby.html")));
app.get("/chat", (req, res) => res.sendFile(path.join(__dirname, "public", "chat.html")));
app.get("/walk", (req, res) => res.sendFile(path.join(__dirname, "public", "walk.html")));

// ---------- In-memory state ----------
const DEFAULT_ROOMS = [
  { id: "fireside", name: "Fireside Lounge", desc: "Warm, calm conversation + prayer requests." },
  { id: "garden", name: "Prayer Garden", desc: "Quiet, supportive chat. Slow mode vibes." },
  { id: "study", name: "Word Study", desc: "Scripture discussion, questions, and notes." },
  { id: "youth", name: "Youth Hangout", desc: "Chill talk, school life, encouragement." }
];

const rooms = new Map(); // roomId -> { id, name, desc, users:Set(socketId), messages:[], typing:Set(socketId) }
for (const r of DEFAULT_ROOMS) {
  rooms.set(r.id, { ...r, users: new Set(), messages: [], typing: new Set() });
}

function safeName(name) {
  const s = String(name || "").trim().slice(0, 24);
  return s.length ? s : `Guest${Math.floor(1000 + Math.random() * 9000)}`;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function roomSummary() {
  return Array.from(rooms.values()).map((r) => ({
    id: r.id,
    name: r.name,
    desc: r.desc,
    online: r.users.size
  }));
}

function roster(roomId) {
  const r = rooms.get(roomId);
  if (!r) return [];
  const list = [];
  for (const sid of r.users) {
    const s = io.sockets.sockets.get(sid);
    if (s) list.push({ id: sid, name: s.data.name || "Guest", badge: s.data.badge || "Seeker" });
  }
  // cute: alphabetical
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

// ---------- Main chat namespace ----------
io.on("connection", (socket) => {
  socket.data.name = "Guest";
  socket.data.badge = "Seeker";

  socket.on("session:hello", (payload = {}) => {
    socket.data.name = safeName(payload.name);
    socket.data.badge = (payload.badge && String(payload.badge).slice(0, 18)) || "Seeker";
    socket.emit("lobby:rooms", roomSummary());
  });

  socket.on("lobby:get", () => {
    socket.emit("lobby:rooms", roomSummary());
  });

  socket.on("room:create", (payload = {}) => {
    const name = String(payload.name || "").trim().slice(0, 28);
    if (!name) return;

    const id = String(payload.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 18) || makeId().slice(0, 10);
    if (rooms.has(id)) return;

    rooms.set(id, {
      id,
      name,
      desc: "A new sanctuary room.",
      users: new Set(),
      messages: [],
      typing: new Set()
    });

    io.emit("lobby:rooms", roomSummary());
  });

  socket.on("room:join", (payload = {}) => {
    const roomId = String(payload.roomId || "");
    if (!rooms.has(roomId)) return;

    // leave any previous room
    for (const [rid, r] of rooms.entries()) {
      if (r.users.has(socket.id)) {
        r.users.delete(socket.id);
        r.typing.delete(socket.id);
        socket.leave(rid);
        io.to(rid).emit("room:roster", roster(rid));
        io.emit("lobby:rooms", roomSummary());
      }
    }

    const r = rooms.get(roomId);
    r.users.add(socket.id);
    socket.join(roomId);

    // system join msg
    io.to(roomId).emit("toast:system", {
      kind: "presence",
      title: "Joined sanctuary",
      message: `${socket.data.name} entered ${r.name}.`
    });

    // send state
    socket.emit("room:state", {
      room: { id: r.id, name: r.name, desc: r.desc },
      roster: roster(roomId),
      messages: r.messages.slice(-50)
    });

    io.to(roomId).emit("room:roster", roster(roomId));
    io.emit("lobby:rooms", roomSummary());
  });

  socket.on("typing:set", (payload = {}) => {
    const roomId = String(payload.roomId || "");
    const isTyping = !!payload.isTyping;
    const r = rooms.get(roomId);
    if (!r || !r.users.has(socket.id)) return;

    if (isTyping) r.typing.add(socket.id);
    else r.typing.delete(socket.id);

    const names = [];
    for (const sid of r.typing) {
      const s = io.sockets.sockets.get(sid);
      if (s) names.push(s.data.name);
    }
    socket.to(roomId).emit("typing:list", names.slice(0, 4));
  });

  socket.on("message:send", (payload = {}) => {
    const roomId = String(payload.roomId || "");
    const text = String(payload.text || "").trim().slice(0, 2000);
    if (!text) return;

    const r = rooms.get(roomId);
    if (!r || !r.users.has(socket.id)) return;

    const msg = {
      id: makeId(),
      roomId,
      user: { id: socket.id, name: socket.data.name, badge: socket.data.badge },
      text,
      ts: Date.now(),
      reactions: {} // emoji -> { count, by:[socketId] }
    };

    r.messages.push(msg);
    if (r.messages.length > 300) r.messages.shift();

    // stop typing
    r.typing.delete(socket.id);
    socket.to(roomId).emit("typing:list", Array.from(r.typing).map((sid) => (io.sockets.sockets.get(sid)?.data?.name || "Guest")).slice(0, 4));

    io.to(roomId).emit("message:new", msg);
  });

  socket.on("message:react", (payload = {}) => {
    const roomId = String(payload.roomId || "");
    const msgId = String(payload.msgId || "");
    const emoji = String(payload.emoji || "").slice(0, 8);
    const r = rooms.get(roomId);
    if (!r || !r.users.has(socket.id)) return;

    const msg = r.messages.find((m) => m.id === msgId);
    if (!msg) return;

    if (!msg.reactions[emoji]) msg.reactions[emoji] = { count: 0, by: [] };
    const entry = msg.reactions[emoji];

    const i = entry.by.indexOf(socket.id);
    if (i >= 0) {
      entry.by.splice(i, 1);
      entry.count = Math.max(0, entry.count - 1);
      if (entry.count === 0) delete msg.reactions[emoji];
    } else {
      entry.by.push(socket.id);
      entry.count += 1;
    }

    io.to(roomId).emit("message:reactions", { msgId, reactions: msg.reactions });
  });

  socket.on("disconnect", () => {
    // remove from all rooms
    for (const [rid, r] of rooms.entries()) {
      if (r.users.has(socket.id)) {
        r.users.delete(socket.id);
        r.typing.delete(socket.id);

        io.to(rid).emit("toast:system", {
          kind: "presence",
          title: "Left sanctuary",
          message: `${socket.data.name} stepped away.`
        });

        io.to(rid).emit("room:roster", roster(rid));
      }
    }
    io.emit("lobby:rooms", roomSummary());
  });
});

// ---------- Walk namespace (Phaser/canvas world) ----------
const walk = io.of("/walk");
const walkPlayers = new Map(); // socketId -> { id,name,x,y,vx,vy,ts }

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

walk.on("connection", (socket) => {
  socket.data.name = "Guest";

  socket.on("walk:join", (payload = {}) => {
    socket.data.name = safeName(payload.name);

    const spawn = {
      id: socket.id,
      name: socket.data.name,
      x: 240 + Math.random() * 280,
      y: 240 + Math.random() * 220,
      ts: Date.now()
    };
    walkPlayers.set(socket.id, spawn);

    socket.emit("walk:state:init", {
      you: spawn,
      players: Array.from(walkPlayers.values())
    });

    socket.broadcast.emit("walk:player:join", spawn);
  });

  socket.on("walk:pos", (payload = {}) => {
    const p = walkPlayers.get(socket.id);
    if (!p) return;
    p.x = clamp(Number(payload.x) || p.x, 40, 1240);
    p.y = clamp(Number(payload.y) || p.y, 40, 840);
    p.ts = Date.now();
    socket.broadcast.emit("walk:player:update", { id: socket.id, x: p.x, y: p.y, ts: p.ts });
  });

  // Proximity-based text chat: deliver only to players in radius
  socket.on("walk:chat", (payload = {}) => {
    const p = walkPlayers.get(socket.id);
    if (!p) return;
    const text = String(payload.text || "").trim().slice(0, 240);
    if (!text) return;

    const radius = 180; // pixels
    const msg = {
      id: makeId(),
      from: { id: socket.id, name: p.name },
      text,
      x: p.x,
      y: p.y,
      ts: Date.now(),
      radius
    };

    // send to self + nearby
    socket.emit("walk:chat:recv", msg);

    for (const [sid, other] of walkPlayers.entries()) {
      if (sid === socket.id) continue;
      const dx = other.x - p.x;
      const dy = other.y - p.y;
      if (Math.hypot(dx, dy) <= radius) {
        walk.to(sid).emit("walk:chat:recv", msg);
      }
    }
  });

  socket.on("disconnect", () => {
    const p = walkPlayers.get(socket.id);
    walkPlayers.delete(socket.id);
    if (p) socket.broadcast.emit("walk:player:leave", { id: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`Selah Sanctuary running on http://localhost:${PORT}`);
});
