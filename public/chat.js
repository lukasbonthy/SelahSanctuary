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

  let myId = null;
  let roster = [];
  let typingTimer = null;
  let lastTyping = 0;

  socket.on("connect", () => { myId = socket.id; });
  socket.emit("session:hello", s);
  socket.emit("room:join", { roomId });

  socket.on("room:state", (state) => {
    roomNameEl.textContent = state.room?.name || roomId;
    roomDescEl.textContent = state.room?.desc || "";
    roster = state.roster || [];
    renderRoster();
    renderMessages(state.messages || []);
    Selah.toast({ kind: "success", title: "Connected", message: `You entered ${state.room?.name || "the room"}.` });
  });

  socket.on("room:roster", (list) => {
    roster = list || [];
    renderRoster();
  });

  socket.on("toast:system", (t) => {
    Selah.toast({ kind: t.kind || "info", title: t.title || "System", message: t.message || "" });
  });

  socket.on("typing:list", (names) => {
    if (!names || names.length === 0) {
      typingEl.textContent = "";
      return;
    }
    const show = names.slice(0, 3);
    typingEl.textContent = show.length === 1
      ? `${show[0]} is typing…`
      : `${show.join(", ")} are typing…`;
  });

  socket.on("message:new", (msg) => {
    appendMessage(msg);
    // tiny “new message” toast for other people
    if (msg.user?.id !== myId) {
      Selah.toast({ kind: "message", title: msg.user?.name || "Message", message: msg.text.slice(0, 90) });
    }
  });

  socket.on("message:reactions", ({ msgId, reactions }) => {
    const el = document.querySelector(`[data-msg="${msgId}"]`);
    if (!el) return;
    const box = el.querySelector(".reactions");
    if (!box) return;
    box.innerHTML = renderReactions(reactions);
  });

  // ---------- UI render ----------
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

        <!-- reaction bar -->
        <div class="mt-2 ${mine ? "justify-end" : ""} hidden group-hover:flex gap-1 items-center">
          ${renderReactionBar(msg.id)}
          <span class="text-xs text-white/45 ml-2">tap to react</span>
        </div>
      </div>
    `;

    wrap.innerHTML = mine ? `${bubble}${avatar}` : `${avatar}${bubble}`;
    messagesEl.appendChild(wrap);

    // bind reactions
    wrap.querySelectorAll("[data-react]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const emoji = btn.getAttribute("data-react");
        socket.emit("message:react", { roomId, msgId: msg.id, emoji });
      });
    });

    // autoscroll if near bottom
    const nearBottom = (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight) < 160;
    if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderReactionBar(msgId) {
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

  // ---------- typing + sending ----------
  function setTyping(isTyping) {
    socket.emit("typing:set", { roomId, isTyping });
  }

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
    if (!text) {
      Selah.toast({ kind: "danger", title: "Empty message", message: "Type something first." });
      return;
    }
    socket.emit("message:send", { roomId, text });
    inputEl.value = "";
    countEl.textContent = "0/2000";
    autoGrow(inputEl);
    setTyping(false);
    Selah.pulse(sendBtn);
  }

  sendBtn.addEventListener("click", send);

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
})();
