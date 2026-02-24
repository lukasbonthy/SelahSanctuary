(() => {
  const s = Selah.session.ensure();
  const socket = io("/walk");

  const nearInfo = document.getElementById("nearInfo");
  const walkMsgs = document.getElementById("walkMsgs");
  const walkInput = document.getElementById("walkInput");
  const walkSend = document.getElementById("walkSend");

  const WORLD = { w: 1280, h: 880 };
  const SPEED = 210;

  let me = null;
  const others = new Map(); // id -> { sprite, labelBg, labelText, name, x,y }
  let cursors = null;

  socket.emit("walk:join", { name: s.name });

  socket.on("walk:state:init", (state) => {
    me = state.you;
    nearInfo.textContent = `Connected as ${me.name}. Walk near someone to chat.`;
    Selah.toast({ kind: "success", title: "Walk connected", message: "WASD to move. Proximity chat enabled." });
    bootGame(state.players || []);
  });

  socket.on("walk:player:join", (p) => {
    if (!sceneRef) return;
    addOther(p);
    Selah.toast({ kind: "presence", title: "Someone arrived", message: `${p.name} entered the walk.` });
  });

  socket.on("walk:player:update", (u) => {
    const o = others.get(u.id);
    if (!o) return;
    o.targetX = u.x;
    o.targetY = u.y;
  });

  socket.on("walk:player:leave", ({ id }) => {
    const o = others.get(id);
    if (!o) return;
    o.sprite.destroy();
    o.labelBg.destroy();
    o.labelText.destroy();
    others.delete(id);
  });

  socket.on("walk:chat:recv", (msg) => {
    pushWalkMsg(msg);
  });

  function pushWalkMsg(msg) {
    const row = document.createElement("div");
    row.className = "rounded-2xl bg-white/5 border border-white/10 px-3 py-2 text-sm";
    row.innerHTML = `<span class="text-white/60">${Selah.escape(msg.from.name)}:</span> <span class="text-white/85">${Selah.escape(msg.text)}</span>`;
    walkMsgs.appendChild(row);
    walkMsgs.scrollTop = walkMsgs.scrollHeight;
  }

  function sendWalkMsg() {
    const text = (walkInput.value || "").trim();
    if (!text) return;
    socket.emit("walk:chat", { text });
    walkInput.value = "";
    Selah.pulse(walkSend);
  }

  walkSend.addEventListener("click", sendWalkMsg);
  walkInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendWalkMsg();
    }
  });

  // ---------- Phaser ----------
  let sceneRef = null;

  function bootGame(players) {
    const config = {
      type: Phaser.AUTO,
      parent: "gameWrap",
      width: 960,
      height: 620,
      backgroundColor: "rgba(0,0,0,0)",
      physics: {
        default: "arcade",
        arcade: { gravity: { y: 0 }, debug: false }
      },
      scene: { preload, create, update }
    };

    new Phaser.Game(config);

    function preload() {}

    function create() {
      sceneRef = this;

      // camera + world bounds
      this.cameras.main.setBounds(0, 0, WORLD.w, WORLD.h);
      this.physics.world.setBounds(0, 0, WORLD.w, WORLD.h);

      // soft grid background
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 0.03);
      for (let x = 0; x < WORLD.w; x += 40) g.fillRect(x, 0, 1, WORLD.h);
      for (let y = 0; y < WORLD.h; y += 40) g.fillRect(0, y, WORLD.w, 1);

      // glowy “sanctuary zones” (UI only)
      const zone1 = this.add.ellipse(380, 330, 520, 360, 0x38bdf8, 0.08);
      const zone2 = this.add.ellipse(920, 560, 520, 360, 0xf472b6, 0.07);

      // obstacles
      const obstacles = this.physics.add.staticGroup();
      const ob = (x,y,w,h) => {
        const r = this.add.rectangle(x, y, w, h, 0xffffff, 0.06);
        r.setStrokeStyle(1, 0xffffff, 0.10);
        obstacles.add(r);
        r.body.setSize(w, h, true);
        return r;
      };
      ob(640, 210, 420, 34);
      ob(250, 560, 340, 34);
      ob(1020, 350, 240, 34);
      ob(720, 740, 500, 34);

      // you
      const you = this.add.circle(me.x, me.y, 14, 0x7dd3fc, 0.9);
      you.setStrokeStyle(2, 0xffffff, 0.18);
      const youBody = this.physics.add.existing(you);
      youBody.body.setCircle(14);
      youBody.body.setCollideWorldBounds(true);
      this.physics.add.collider(youBody, obstacles);

      // nameplate
      const labelBg = this.add.rectangle(me.x, me.y - 28, 120, 22, 0x000000, 0.35)
        .setStrokeStyle(1, 0xffffff, 0.16);
      labelBg.setOrigin(0.5, 0.5);
      const labelText = this.add.text(me.x, me.y - 34, me.name, {
        fontFamily: "ui-sans-serif, system-ui",
        fontSize: "12px",
        color: "#ffffff"
      }).setOrigin(0.5, 0.5);

      // add others from init
      players.forEach((p) => {
        if (p.id === me.id) return;
        addOther(p);
      });

      // camera follow
      this.cameras.main.startFollow(you, true, 0.12, 0.12);

      // controls
      cursors = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D
      });

      // store refs
      this.__you = you;
      this.__youBody = youBody.body;
      this.__labelBg = labelBg;
      this.__labelText = labelText;

      // lil intro toast
      Selah.toast({ kind: "info", title: "Walk tip", message: "Move near someone to chat. Only nearby players see messages." });
    }

    function update(_, dtMs) {
      if (!sceneRef || !sceneRef.__youBody) return;
      const dt = dtMs / 1000;

      const body = sceneRef.__youBody;
      const vx = (cursors.right.isDown ? 1 : 0) - (cursors.left.isDown ? 1 : 0);
      const vy = (cursors.down.isDown ? 1 : 0) - (cursors.up.isDown ? 1 : 0);

      const len = Math.hypot(vx, vy) || 1;
      body.setVelocity((vx / len) * SPEED, (vy / len) * SPEED);

      // nameplate follows
      const you = sceneRef.__you;
      sceneRef.__labelBg.setPosition(you.x, you.y - 28);
      sceneRef.__labelText.setPosition(you.x, you.y - 34);

      // smooth other players
      for (const o of others.values()) {
        const sx = o.sprite.x;
        const sy = o.sprite.y;
        const tx = o.targetX ?? sx;
        const ty = o.targetY ?? sy;
        o.sprite.setPosition(Phaser.Math.Linear(sx, tx, 0.18), Phaser.Math.Linear(sy, ty, 0.18));
        o.labelBg.setPosition(o.sprite.x, o.sprite.y - 28);
        o.labelText.setPosition(o.sprite.x, o.sprite.y - 34);
      }

      // emit position (throttle-ish)
      if (socket.connected && me) {
        if (!sceneRef.__lastEmit) sceneRef.__lastEmit = 0;
        sceneRef.__lastEmit += dtMs;
        if (sceneRef.__lastEmit > 70) {
          sceneRef.__lastEmit = 0;
          socket.emit("walk:pos", { x: you.x, y: you.y });
        }
      }
    }

    function addOther(p) {
      const scene = sceneRef;
      if (!scene) return;

      const spr = scene.add.circle(p.x, p.y, 14, 0xf0abfc, 0.85);
      spr.setStrokeStyle(2, 0xffffff, 0.14);

      const bg = scene.add.rectangle(p.x, p.y - 28, 120, 22, 0x000000, 0.32)
        .setStrokeStyle(1, 0xffffff, 0.14);
      bg.setOrigin(0.5, 0.5);

      const tx = scene.add.text(p.x, p.y - 34, p.name, {
        fontFamily: "ui-sans-serif, system-ui",
        fontSize: "12px",
        color: "#ffffff"
      }).setOrigin(0.5, 0.5);

      others.set(p.id, {
        sprite: spr,
        labelBg: bg,
        labelText: tx,
        name: p.name,
        targetX: p.x,
        targetY: p.y
      });
    }
  }
})();
