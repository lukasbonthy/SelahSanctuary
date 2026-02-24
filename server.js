const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/lobby", (req, res) => res.sendFile(path.join(__dirname, "public", "lobby.html")));
app.get("/chat", (req, res) => res.sendFile(path.join(__dirname, "public", "chat.html")));

// --------- State (in-memory) ----------
const DEFAULT_ROOMS = [
  { id: "fireside", name: "Fireside Lounge", desc: "Warm, calm conversation + prayer requests." },
  { id: "garden", name: "Prayer Garden", desc: "Quiet, supportive chat. Slow mode vibes." },
  { id: "study", name: "Word Study", desc: "Scripture discussion, questions, and notes." },
  { id: "youth", name: "Youth Hangout", desc: "Chill talk, school life, encouragement." }
];

const DEFAULT_VOICE_CHANNELS = [
  { id: "voice-general", name: "General Voice" },
  { id: "voice-prayer", name: "Prayer Circle" },
  { id: "voice-chill", name: "Chill Hangout" }
];

const rooms = new Map();
// roomId -> { id,name,desc, users:Set, messages:[], typing:Set, voice:{ channels:[...], members: Map(channelId->Set(socketId)) } }
for (const r of DEFAULT_ROOMS) {
  const members = new Map();
  for (const vc of DEFAULT_VOICE_CHANNELS) members.set(vc.id, new Set());
  rooms.set(r.id, { ...r, users: new Set(), messages: [], typing: new Set(), voice: { channels: DEFAULT_VOICE_CHANNELS, members } });
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
    online: r.users.size,
    voiceCounts: r.voice.channels.map((c) => ({ id: c.id, count: r.voice.members.get(c.id)?.size || 0 }))
  }));
}

function roster(roomId) {
  const r = rooms.get(roomId);
  if (!r) return [];
  const list = [];
  for (const sid of r.users) {
    const s = io.sockets.sockets.get(sid);
    if (s) {
      list.push({
        id: sid,
        name: s.data.name || "Guest",
        badge: s.data.badge || "Seeker"
      });
    }
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function voiceParticipants(roomId, channelId) {
  const r = rooms.get(roomId);
  if (!r) return [];
  const set = r.voice.members.get(channelId);
  if (!set) return [];
  const list = [];
  for (const sid of set) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    list.push({
      id: sid,
      name: s.data.name || "Guest",
      badge: s.data.badge || "Seeker",
      muted: !!s.data.voiceMuted,
      deafened: !!s.data.voiceDeafened,
      speaking: !!s.data.voiceSpeaking
    });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function removeFromVoice(roomId, socketId) {
  const r = rooms.get(roomId);
  if (!r) return { removed: false, channelId: null };

  let removedChannel = null;
  for (const vc of r.voice.channels) {
    const set = r.voice.members.get(vc.id);
    if (set && set.has(socketId)) {
      set.delete(socketId);
      removedChannel = vc.id;
    }
  }
  return { removed: !!removedChannel, channelId: removedChannel };
}

// ---------- Socket.io ----------
io.on("connection", (socket) => {
  socket.data.name = "Guest";
  socket.data.badge = "Seeker";
  socket.data.voiceChannelId = null;
  socket.data.voiceMuted = false;
  socket.data.voiceDeafened = false;
  socket.data.voiceSpeaking = false;

  socket.on("session:hello", (payload = {}) => {
    socket.data.name = safeName(payload.name);
    socket.data.badge = (payload.badge && String(payload.badge).slice(0, 18)) || "Seeker";
    socket.emit("lobby:rooms", roomSummary());
  });

  socket.on("lobby:get", () => socket.emit("lobby:rooms", roomSummary()));

  socket.on("room:create", (payload = {}) => {
    const name = String(payload.name || "").trim().slice(0, 28);
    if (!name) return;
    const id =
      String(payload.id || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 18) || makeId().slice(0, 10);

    if (rooms.has(id)) return;

    const members = new Map();
    for (const vc of DEFAULT_VOICE_CHANNELS) members.set(vc.id, new Set());

    rooms.set(id, {
      id,
      name,
      desc: "A new sanctuary room.",
      users: new Set(),
      messages: [],
      typing: new Set(),
      voice: { channels: DEFAULT_VOICE_CHANNELS, members }
    });

    io.emit("lobby:rooms", roomSummary());
  });

  socket.on("room:join", (payload = {}) => {
    const roomId = String(payload.roomId || "");
    if (!rooms.has(roomId)) return;

    // leave any previous room(s)
    for (const [rid, r] of rooms.entries()) {
      if (r.users.has(socket.id)) {
        r.users.delete(socket.id);
        r.typing.delete(socket.id);

        // also leave voice in that room
        const { removed, channelId } = removeFromVoice(rid, socket.id);
        if (removed && channelId) {
          socket.to(rid).emit("voice:channel:participants", {
            channelId,
            participants: voiceParticipants(rid, channelId)
          });
          socket.to(rid).emit("voice:counts", roomSummary().find(x => x.id === rid)?.voiceCounts || []);
        }

        socket.leave(rid);
        io.to(rid).emit("room:roster", roster(rid));
      }
    }

    const r = rooms.get(roomId);
    r.users.add(socket.id);
    socket.join(roomId);

    io.to(roomId).emit("toast:system", {
      kind: "presence",
      title: "Joined sanctuary",
      message: `${socket.data.name} entered ${r.name}.`
    });

    socket.emit("room:state", {
      room: { id: r.id, name: r.name, desc: r.desc },
      roster: roster(roomId),
      messages: r.messages.slice(-60),
      voiceChannels: r.voice.channels.map((c) => ({
        id: c.id,
        name: c.name,
        count: r.voice.members.get(c.id)?.size || 0
      }))
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
      reactions: {}
    };

    r.messages.push(msg);
    if (r.messages.length > 400) r.messages.shift();

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

  // -------- Voice (WebRTC signaling) --------
  socket.on("voice:join", (payload = {}) => {
    const roomId = String(payload.roomId || "");
    const channelId = String(payload.channelId || "");
    const r = rooms.get(roomId);
    if (!r || !r.users.has(socket.id)) return;
    if (!r.voice.members.has(channelId)) return;

    // leave previous voice in this room (or any old room just in case)
    for (const [rid] of rooms.entries()) {
      removeFromVoice(rid, socket.id);
    }

    const set = r.voice.members.get(channelId);
    set.add(socket.id);

    socket.data.voiceChannelId = channelId;
    socket.data.voiceMuted = false;
    socket.data.voiceDeafened = false;
    socket.data.voiceSpeaking = false;

    const peers = voiceParticipants(roomId, channelId).filter((p) => p.id !== socket.id);

    socket.emit("voice:peers", {
      roomId,
      channelId,
      peers
    });

    // tell others new peer arrived
    socket.to(roomId).emit("voice:new-peer", {
      roomId,
      channelId,
      peer: { id: socket.id, name: socket.data.name, badge: socket.data.badge, muted: false, deafened: false, speaking: false }
    });

    // update participants list + counts
    io.to(roomId).emit("voice:channel:participants", {
      channelId,
      participants: voiceParticipants(roomId, channelId)
    });
    io.to(roomId).emit("voice:counts", roomSummary().find(x => x.id === roomId)?.voiceCounts || []);
  });

  socket.on("voice:leave", (payload = {}) => {
    const roomId = String(payload.roomId || "");
    const r = rooms.get(roomId);
    if (!r) return;

    const prev = socket.data.voiceChannelId;
    const { removed } = removeFromVoice(roomId, socket.id);
    socket.data.voiceChannelId = null;
    socket.data.voiceMuted = false;
    socket.data.voiceDeafened = false;
    socket.data.voiceSpeaking = false;

    if (removed && prev) {
      socket.to(roomId).emit("voice:peer-left", { roomId, channelId: prev, id: socket.id });
      io.to(roomId).emit("voice:channel:participants", { channelId: prev, participants: voiceParticipants(roomId, prev) });
      io.to(roomId).emit("voice:counts", roomSummary().find(x => x.id === roomId)?.voiceCounts || []);
    }
  });

  socket.on("voice:state", (payload = {}) => {
    const roomId = String(payload.roomId || "");
    const channelId = String(payload.channelId || socket.data.voiceChannelId || "");
    const r = rooms.get(roomId);
    if (!r || !channelId) return;
    const set = r.voice.members.get(channelId);
    if (!set || !set.has(socket.id)) return;

    socket.data.voiceMuted = !!payload.muted;
    socket.data.voiceDeafened = !!payload.deafened;

    io.to(roomId).emit("voice:channel:participants", {
      channelId,
      participants: voiceParticipants(roomId, channelId)
    });
  });

  socket.on("voice:speaking", (payload = {}) => {
    const roomId = String(payload.roomId || "");
    const channelId = String(payload.channelId || socket.data.voiceChannelId || "");
    const speaking = !!payload.speaking;
    const r = rooms.get(roomId);
    if (!r || !channelId) return;
    const set = r.voice.members.get(channelId);
    if (!set || !set.has(socket.id)) return;

    socket.data.voiceSpeaking = speaking;

    // broadcast a lightweight event (UI glow)
    socket.to(roomId).emit("voice:speaking", { id: socket.id, channelId, speaking });
  });

  // WebRTC relay: offer/answer/ice
  socket.on("voice:signal", (payload = {}) => {
    const to = String(payload.to || "");
    const roomId = String(payload.roomId || "");
    const channelId = String(payload.channelId || "");
    const type = String(payload.type || "");
    const data = payload.data;

    const r = rooms.get(roomId);
    if (!r) return;
    const set = r.voice.members.get(channelId);
    if (!set) return;

    // only allow signaling if both are in same voice channel
    if (!set.has(socket.id) || !set.has(to)) return;

    io.to(to).emit("voice:signal", {
      from: socket.id,
      roomId,
      channelId,
      type,
      data
    });
  });

  socket.on("disconnect", () => {
    // remove from all rooms and voice
    for (const [rid, r] of rooms.entries()) {
      if (r.users.has(socket.id)) {
        r.users.delete(socket.id);
        r.typing.delete(socket.id);

        const prev = socket.data.voiceChannelId;
        const { removed } = removeFromVoice(rid, socket.id);
        if (removed && prev) {
          socket.to(rid).emit("voice:peer-left", { roomId: rid, channelId: prev, id: socket.id });
          io.to(rid).emit("voice:channel:participants", { channelId: prev, participants: voiceParticipants(rid, prev) });
          io.to(rid).emit("voice:counts", roomSummary().find(x => x.id === rid)?.voiceCounts || []);
        }

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

server.listen(PORT, () => {
  console.log(`Selah Sanctuary running on http://localhost:${PORT}`);
});
