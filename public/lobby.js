(() => {
  const s = Selah.session.ensure();
  const socket = io();

  const roomsEl = document.getElementById("rooms");
  const activityEl = document.getElementById("activity");

  document.getElementById("meName").textContent = s.name;
  document.getElementById("meBadge").textContent = "✨ " + (s.badge || "Seeker");

  socket.emit("session:hello", s);

  socket.on("lobby:rooms", (rooms) => {
    renderRooms(rooms);
  });

  function roomCard(r) {
    const online = r.online ?? 0;
    return `
      <a href="/chat?room=${encodeURIComponent(r.id)}"
         class="group pressy block rounded-3xl p-4 glass-soft border border-white/12 hover:border-white/18 transition relative overflow-hidden">
        <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition duration-300"
             style="background: radial-gradient(600px 260px at 20% 10%, rgba(56,189,248,.18), transparent 55%),
                            radial-gradient(500px 260px at 90% 20%, rgba(244,114,182,.12), transparent 58%);">
        </div>
        <div class="relative">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="font-semibold tracking-tight truncate">${Selah.escape(r.name)}</div>
              <div class="text-sm text-white/65 mt-1 line-clamp-2">${Selah.escape(r.desc || "")}</div>
            </div>
            <div class="shrink-0 text-xs px-3 py-1.5 rounded-full border border-white/14 bg-white/6">
              <span class="text-emerald-200">${online}</span>
              <span class="text-white/55">online</span>
            </div>
          </div>
          <div class="mt-4 flex items-center justify-between">
            <div class="text-xs text-white/55">Tap to enter</div>
            <div class="text-sm text-white/75 group-hover:text-white transition">→</div>
          </div>
        </div>
      </a>
    `;
  }

  function renderRooms(rooms) {
    roomsEl.innerHTML = rooms.map(roomCard).join("");
    activityEl.textContent = `Rooms updated • ${rooms.reduce((a, r) => a + (r.online || 0), 0)} total online`;
  }

  document.getElementById("createRoom").addEventListener("click", () => {
    const name = document.getElementById("newRoomName").value.trim();
    if (!name) {
      Selah.toast({ kind: "danger", title: "Room name needed", message: "Type a room name first." });
      return;
    }
    socket.emit("room:create", { name });
    document.getElementById("newRoomName").value = "";
    Selah.toast({ kind: "success", title: "Room created", message: "If it’s new, it’ll appear instantly." });
  });

  // subtle refresh loop
  setInterval(() => socket.emit("lobby:get"), 4000);
})();
