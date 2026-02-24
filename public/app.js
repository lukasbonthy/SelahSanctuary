window.Selah = window.Selah || {};

Selah.session = {
  get() {
    try {
      const raw = localStorage.getItem("selah_session");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  set(data) {
    localStorage.setItem("selah_session", JSON.stringify(data));
  },
  ensure() {
    const s = Selah.session.get();
    if (s && s.name) return s;
    const fallback = { name: `Guest${Math.floor(1000 + Math.random() * 9000)}`, badge: "Seeker" };
    Selah.session.set(fallback);
    return fallback;
  }
};

Selah.qs = (k) => new URLSearchParams(location.search).get(k);

Selah.timeAgo = (ts) => {
  const d = Date.now() - ts;
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
};

Selah.escape = (str) =>
  String(str).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
