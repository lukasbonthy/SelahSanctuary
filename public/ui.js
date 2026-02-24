window.Selah = window.Selah || {};

Selah.ensureToastStack = () => {
  let el = document.querySelector(".toast-stack");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast-stack";
    document.body.appendChild(el);
  }
  return el;
};

Selah.toast = (opts = {}) => {
  const stack = Selah.ensureToastStack();
  const kind = opts.kind || "info";
  const title = opts.title || "Notice";
  const msg = opts.message || "";
  const icon =
    kind === "success" ? "✅" :
    kind === "danger" ? "⚠️" :
    kind === "presence" ? "✨" :
    kind === "message" ? "💬" : "🔔";

  const t = document.createElement("div");
  t.className = "toast glass-soft glow-ring rounded-2xl p-4 noise relative overflow-hidden";
  t.innerHTML = `
    <div class="flex gap-3 items-start">
      <div class="text-xl leading-none mt-0.5">${icon}</div>
      <div class="min-w-0">
        <div class="font-semibold tracking-tight">${Selah.escape(title)}</div>
        <div class="text-sm text-white/75 mt-0.5 break-words">${Selah.escape(msg)}</div>
      </div>
      <button class="ml-auto text-white/50 hover:text-white/90 transition" aria-label="Close">✕</button>
    </div>
    <div class="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-sky-400/50 via-fuchsia-400/40 to-violet-400/40"></div>
  `;

  const remove = () => {
    t.style.animation = "toast-out .22s ease forwards";
    setTimeout(() => t.remove(), 220);
  };
  t.querySelector("button").addEventListener("click", remove);

  stack.appendChild(t);
  setTimeout(remove, opts.duration ?? 3200);
};
