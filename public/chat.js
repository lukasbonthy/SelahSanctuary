(() => {
  const s = Selah.session.ensure();
  const socket = io();

  const roomId = Selah.qs("room") || "fireside";

  const roomNameEl = document.getElementById("roomName");
  const roomDescEl = document.getElementById("roomDesc");
  const usersEl = document.getElementById("users");
  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const typingEl = document.getElementById("typing");
  const countEl = document.getElementById("count");
  const onlineCountEl = document.getElementById("onlineCount");

  // voice UI
  const voiceChannelsEl = document.getElementById("voiceChannels");
  const voiceStatusEl = document.getElementById("voiceStatus");
  const voiceHintEl = document.getElementById("voiceHint");
  const voiceDotEl = document.getElementById("voiceDot");
  const btnMute = document.getElementById("btnMute");
  const btnDeafen = document.getElementById("btnDeafen");
  const btnLeaveVoice = document.getElementById("btnLeaveVoice");
  const voicePeople = document.getElementById("voicePeople");
  const voicePeopleHint = document.getElementById("voicePeopleHint");
  const voiceCountMini = document.getElementById("voiceCountMini");

  document.getElementById("meMiniName").textContent = s.name;
  document.getElementById("meMiniBadge").textContent = "✨ " + (s.badge || "Seeker");

  let myId = null;
  let roster = [];
  let typingTimer = null;
  let lastTyping = 0;

  let voiceChannels = [];
  let selectedVoice = null;
  let voiceParticipants = [];

  socket.on("connect", () => { myId = socket.id; });

  socket.emit("session:hello", s);
  socket.emit("room:join", { roomId });

  const voice = new SelahVoice(socket, {
    roomId,
    onParticipants: (list) => {
      voiceParticipants = list;
      renderVoiceParticipants();
    },
    onSpeaking: ({ id, speaking }) => {
      // glow on participant row if speaking
      const el = document.querySelector(`[data-vp="${id}"]`);
      if (el) {
        el.classList.toggle("speaking-glow", !!speaking);
      }
    },
    onCounts: (counts) => {
      // update counts on voice channel buttons
      for (const c of counts || []) {
        const badge = document.querySelector(`[data-vc-badge="${c.id}"]`);
        if (badge) badge.textContent = String(c.count || 0);
      }
    },
    onConnected: (channelId) => {
      selectedVoice = channelId;
      voiceStatusEl.textContent = "Connected";
      voiceHintEl.textContent = "Mic is live. Use mute/deafen below.";
      voiceDotEl.className = "w-2.5 h-2.5 rounded-full bg-emerald-400/70 mt-2";
      highlightVoiceChannel(channelId);
      Selah.pulse(voiceDotEl);
    },
    onDisconnected: () => {
      selectedVoice = null;
      voiceStatusEl.textContent = "Not connected";
      voiceHintEl.textContent = "Pick a channel above.";
      voiceDotEl.className = "w-2.5 h-2.5 rounded-full bg-white/20 mt-2";
      voiceParticipants = [];
      renderVoiceParticipants();
      highlightVoiceChannel(null);
    },
    onPeerToast: (t) => Selah.toast(t)
  });

  socket.on("room:state", (state) => {
    roomNameEl.textContent = state.room?.name || roomId;
    roomDescEl.textContent = state.room?.desc || "";
    roster = state.roster || [];
    voiceChannels = state.voiceChannels || [];

    renderRoster();
    renderVoiceChannels();
    renderMessages(state.messages || []);

    Selah.toast({ kind: "success", title: "Connected", message: `You entered ${state.room?.name || "the room"}.` });
  });

  socket.on("room:roster", (list) => { roster = list || []; renderRoster(); });

  socket.on("toast:system", (t) => Selah.toast({ kind: t.kind || "info", title: t.title || "System", message: t.message || "" }));

  socket.on("typing:list", (names) => {
    if (!names || names.length === 0) return (typingEl.textContent = "");
    const show = names.slice(0, 3);
    typingEl.textContent = show.length === 1 ? `${show[0]} is typing…` : `${show.join(", ")} are typing…`;
  });

  socket.on("message:new", (msg) => {
    appendMessage(msg);
    if (msg.user?.id !== myId) Selah.toast({ kind: "message", title: msg.user?.name || "Message", message: msg.text.slice(0, 90) });
  });

  socket.on("message:reactions", ({ msgId, reactions }) => {
    const el = document.querySelector(`[data-msg="${msgId}"]`);
    if (!el) return;
    const box = el.querySelector(".reactions");
    if (!box) return;
    box.innerHTML = renderReactions(reactions);
  });

  // ---------- roster ----------
  function renderRoster() {
    usersEl.innerHTML = "";
    onlineCountEl.textContent = `${roster.length} online`;

    roster.forEach((u) => {
      const row = document.createElement("div");
      row.className = "pressy rounded-2xl px-3 py-2 bg-white/5 hover:bg-white/7 border border-white/10 transition flex items-center gap-3";
      row.innerHTML = `
        <div class="w-9 h-9 rounded-2xl bg-gradient-to-br from-sky-300/55 via-fuchsia-300/45 to-violet-300/55"></div>
        <div class="min-w-0">
          <div class="font-semibold truncate">${Selah.escape(u.name)}</div>
          <div class="text-xs text-white/55 truncate">✨ ${Selah.escape(u.badge || "Seeker")}</div>
        </div>
        <div class="ml-auto text-xs px-2 py-1 rounded-full bg-emerald-400/10 border border-emerald-300/15 text-emerald-200">online</div>
      `;
      usersEl.appendChild(row);
    });
  }

  // ---------- voice channels ----------
  function renderVoiceChannels() {
    voiceChannelsEl.innerHTML = "";
    (voiceChannels || []).forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "pressy w-full text-left rounded-2xl px-4 py-3 bg-white/4 hover:bg-white/6 border border-white/10 transition flex items-center justify-between gap-3";
      btn.innerHTML = `
        <div class="min-w-0">
          <div class="font-semibold truncate">🎙 ${Selah.escape(c.name)}</div>
          <div class="text-xs text-white/55 truncate">click to join voice</div>
        </div>
        <div class="text-xs px-2.5 py-1 rounded-full bg-white/6 border border-white/10 text-white/75" data-vc-badge="${c.id}">
          ${c.count || 0}
        </div>
      `;
      btn.addEventListener("click", async () => {
        try {
          await voice.join(c.id);
        } catch {}
      });
      btn.dataset.vc = c.id;
      voiceChannelsEl.appendChild(btn);
    });
  }

  function highlightVoiceChannel(channelId) {
    document.querySelectorAll("[data-vc]").forEach((el) => {
      const on = el.dataset.vc === channelId;
      el.classList.toggle("bg-white/6", on);
      el.classList.toggle("glow-ring", on);
    });
  }

  function renderVoiceParticipants() {
    const list = voiceParticipants || [];
    voiceCountMini.textContent = String(list.length || 0);

    if (!selectedVoice) {
      voicePeopleHint.textContent = "Join a voice channel to see members.";
      voicePeople.innerHTML = "";
      return;
    }

    voicePeopleHint.textContent = `Channel: ${selectedVoice}`;
    voicePeople.innerHTML = "";

    list.forEach((p) => {
      const row = document.createElement("div");
      row.className = "pressy rounded-2xl px-3 py-2 bg-white/5 hover:bg-white/7 border border-white/10 transition flex items-center gap-3";
      row.dataset.vp = p.id;

      const mic = p.deafened ? "🔇" : (p.muted ? "🎙️🚫" : "🎙️");
      const speakDot = p.speaking ? "bg-emerald-400/80" : "bg-white/20";

      row.innerHTML = `
        <div class="w-9 h-9 rounded-2xl bg-gradient-to-br from-fuchsia-300/45 via-sky-300/45 to-violet-300/45"></div>
        <div class="min-w-0">
          <div class="font-semibold truncate">${Selah.escape(p.name)}</div>
          <div class="text-xs text-white/55 truncate">✨ ${Selah.escape(p.badge || "Seeker")}</div>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <div class="w-2.5 h-2.5 rounded-full ${speakDot}"></div>
          <div class="text-sm">${mic}</div>
        </div>
      `;
      voicePeople.appendChild(row);
    });
  }

  // voice controls
  btnMute.addEventListener("click", () => {
    if (!voice.channelId) return Selah.toast({ kind: "info", title: "Voice", message: "Join a voice channel first." });
    const muted = voice.toggleMute();
    btnMute.textContent = muted ? "🎙 Muted" : "🎙 Mute";
    btnMute.classList.toggle("bg-rose-400/10", muted);
    btnMute.classList.toggle("border-rose-300/15", muted);
  });

  btnDeafen.addEventListener("click", () => {
    if (!voice.channelId) return Selah.toast({ kind: "info", title: "Voice", message: "Join a voice channel first." });
    const deaf = voice.toggleDeafen();
    btnDeafen.textContent = deaf ? "🎧 Deafened" : "🎧 Deafen";
    btnDeafen.classList.toggle("bg-rose-400/10", deaf);
    btnDeafen.classList.toggle("border-rose-300/15", deaf);

    // if deafened forces mute
    btnMute.textContent = voice.muted ? "🎙 Muted" : "🎙 Mute";
  });

  btnLeaveVoice.addEventListener("click", async () => {
    if (!voice.channelId) return;
    await voice.leave();
    btnMute.textContent = "🎙 Mute";
    btnDeafen.textContent = "🎧 Deafen";
    btnMute.classList.remove("bg-rose-400/10", "border-rose-300/15");
    btnDeafen.classList.remove("bg-rose-400/10", "border-rose-300/15");
  });

  // ---------- messages ----------
  function renderMessages(list) {
    messagesEl.innerHTML = "";
    list.forEach(appendMessage);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendMessage(msg) {
    const mine = msg.user?.id === myId;
    const wrap = document.createElement("div");
    wrap.className = `group flex items-start gap-3 ${mine ? "justify-end" : ""}`;
    wrap.dataset.msg = msg.id;

    const avatar = `
      <div class="w-10 h-10 rounded-3xl bg-gradient-to-br from-sky-300/70 via-fuchsia-300/55 to-violet-300/70 ${mine ? "order-2" : ""}"></div>
    `;

    const bubble = `
      <div class="max-w-[85%] ${mine ? "order-1 text-right" : ""}">
        <div class="text-sm font-semibold ${mine ? "pr-1" : ""}">
          ${Selah.escape(msg.user?.name || "Guest")}
          <span class="text-xs text-white/45 font-normal">• ${Selah.timeAgo(msg.ts)}</span>
        </div>

        <div class="mt-1 inline-block px-4 py-3 rounded-3xl border ${mine
          ? "bg-gradient-to-br from-sky-400/22 via-fuchsia-400/18 to-violet-400/18 border-white/12"
          : "bg-white/6 border-white/10"
        }">
          <div class="whitespace-pre-wrap break-words text-white/90">${Selah.escape(msg.text)}</div>
        </div>

        <div class="reactions mt-2 flex flex-wrap gap-2 ${mine ? "justify-end" : ""}">
          ${renderReactions(msg.reactions || {})}
        </div>

        <div class="mt-2 ${mine ? "justify-end" : ""} hidden group-hover:flex gap-1 items-center">
          ${renderReactionBar(msg.id)}
          <span class="text-xs text-white/45 ml-2">tap to react</span>
        </div>
      </div>
    `;

    wrap.innerHTML = mine ? `${bubble}${avatar}` : `${avatar}${bubble}`;
    messagesEl.appendChild(wrap);

    wrap.querySelectorAll("[data-react]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const emoji = btn.getAttribute("data-react");
        socket.emit("message:react", { roomId, msgId: msg.id, emoji });
      });
    });

    const nearBottom = (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight) < 160;
    if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderReactionBar() {
    const emojis = ["👍", "❤️", "😂", "🙏", "✨"];
    return emojis.map((e) => `
      <button class="pressy reaction-pill rounded-2xl px-2 py-1 text-sm hover:bg-white/10 transition"
        data-react="${e}" title="React ${e}">${e}</button>
    `).join("");
  }

  function renderReactions(reactions) {
    const entries = Object.entries(reactions || {});
    if (!entries.length) return "";
    return entries.map(([emoji, info]) => `
      <button class="pressy reaction-pill rounded-2xl px-2.5 py-1 text-sm hover:bg-white/10 transition"
        data-react="${emoji}" title="Toggle ${emoji}">
        <span>${emoji}</span>
        <span class="text-white/70 ml-1">${info.count || 0}</span>
      </button>
    `).join("");
  }

  // typing + sending
  function setTyping(isTyping) { socket.emit("typing:set", { roomId, isTyping }); }

  inputEl.addEventListener("input", () => {
    const val = inputEl.value || "";
    countEl.textContent = `${Math.min(2000, val.length)}/2000`;

    const now = Date.now();
    if (now - lastTyping > 450) {
      setTyping(true);
      lastTyping = now;
    }

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTyping(false), 700);
    autoGrow(inputEl);
  });

  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }

  function send() {
    const text = (inputEl.value || "").trim();
    if (!text) return Selah.toast({ kind: "danger", title: "Empty message", message: "Type something first." });
    socket.emit("message:send", { roomId, text });
    inputEl.value = "";
    countEl.textContent = "0/2000";
    autoGrow(inputEl);
    setTyping(false);
    Selah.pulse(sendBtn);
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // safety: leave voice on page unload
  window.addEventListener("beforeunload", () => {
    try { voice.leave(); } catch {}
  });
})();
