(() => {
  window.SelahVoice = class SelahVoice {
    constructor(socket, opts = {}) {
      this.socket = socket;
      this.roomId = opts.roomId;
      this.onParticipants = opts.onParticipants || (() => {});
      this.onSpeaking = opts.onSpeaking || (() => {});
      this.onCounts = opts.onCounts || (() => {});
      this.onConnected = opts.onConnected || (() => {});
      this.onDisconnected = opts.onDisconnected || (() => {});
      this.onPeerToast = opts.onPeerToast || (() => {});

      this.channelId = null;
      this.localStream = null;
      this.peers = new Map(); // peerId -> { pc, audioEl }
      this.muted = false;
      this.deafened = false;

      this._speaking = false;
      this._speakingTimer = null;

      this.rtcConfig = {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      };

      this._bindSocket();
    }

    _bindSocket() {
      this.socket.on("voice:peers", async ({ roomId, channelId, peers }) => {
        if (roomId !== this.roomId) return;
        this.channelId = channelId;

        // new joiner initiates offers to existing peers
        for (const p of peers || []) {
          await this._ensurePeer(p.id, true);
        }
        this.onPeerToast({ kind: "success", title: "Voice connected", message: `Joined ${channelId}` });
        this.onConnected(channelId);
      });

      this.socket.on("voice:new-peer", async ({ roomId, channelId, peer }) => {
        if (roomId !== this.roomId) return;
        if (this.channelId !== channelId) return;
        if (!this.localStream) return;

        // existing peer waits for offer from new joiner (so do nothing here),
        // but we still “ensure peer” so we can answer quickly if offer arrives.
        await this._ensurePeer(peer.id, false);
        this.onPeerToast({ kind: "presence", title: "Voice", message: `${peer.name} joined voice.` });
      });

      this.socket.on("voice:peer-left", ({ roomId, channelId, id }) => {
        if (roomId !== this.roomId) return;
        if (this.channelId !== channelId) return;
        this._dropPeer(id);
        this.onPeerToast({ kind: "presence", title: "Voice", message: `Someone left voice.` });
      });

      this.socket.on("voice:channel:participants", ({ channelId, participants }) => {
        if (!this.channelId || channelId !== this.channelId) return;
        this.onParticipants(participants || []);
      });

      this.socket.on("voice:counts", (counts) => this.onCounts(counts || []));

      this.socket.on("voice:speaking", ({ id, channelId, speaking }) => {
        if (!this.channelId || channelId !== this.channelId) return;
        this.onSpeaking({ id, speaking: !!speaking });
      });

      this.socket.on("voice:signal", async ({ from, roomId, channelId, type, data }) => {
        if (roomId !== this.roomId) return;
        if (this.channelId !== channelId) return;

        const pc = await this._ensurePeer(from, false, true);
        if (!pc) return;

        try {
          if (type === "offer") {
            await pc.setRemoteDescription(data);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.socket.emit("voice:signal", { to: from, roomId: this.roomId, channelId: this.channelId, type: "answer", data: pc.localDescription });
          } else if (type === "answer") {
            await pc.setRemoteDescription(data);
          } else if (type === "ice") {
            if (data) await pc.addIceCandidate(data);
          }
        } catch (e) {
          console.warn("voice signal error", e);
        }
      });
    }

    async join(channelId) {
      if (!channelId) return;
      if (this.channelId === channelId) return;

      // if already in voice, leave first
      if (this.channelId) await this.leave();

      // get mic permission
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        this.onPeerToast({ kind: "danger", title: "Microphone blocked", message: "Allow mic permission to use voice." });
        throw e;
      }

      this.muted = false;
      this.deafened = false;
      this._applyTrackStates();

      this._startSpeakingDetector();
      this.socket.emit("voice:join", { roomId: this.roomId, channelId });
    }

    async leave() {
      if (!this.channelId) return;

      // stop speaking detector
      this._stopSpeakingDetector();

      // close peers
      for (const id of Array.from(this.peers.keys())) this._dropPeer(id);

      // stop local stream
      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
        this.localStream = null;
      }

      const prev = this.channelId;
      this.channelId = null;

      this.socket.emit("voice:leave", { roomId: this.roomId, channelId: prev });
      this.onDisconnected(prev);
    }

    toggleMute() {
      this.muted = !this.muted;
      this._applyTrackStates();
      this._emitState();
      return this.muted;
    }

    toggleDeafen() {
      this.deafened = !this.deafened;
      // deafen mutes remote audio locally + also mutes your mic (discord-ish)
      if (this.deafened) this.muted = true;
      this._applyTrackStates();
      this._setRemoteAudioEnabled(!this.deafened);
      this._emitState();
      return this.deafened;
    }

    _emitState() {
      if (!this.channelId) return;
      this.socket.emit("voice:state", {
        roomId: this.roomId,
        channelId: this.channelId,
        muted: this.muted,
        deafened: this.deafened
      });
    }

    _applyTrackStates() {
      if (!this.localStream) return;
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !this.muted; // muted disables mic track
      }
    }

    _setRemoteAudioEnabled(enabled) {
      for (const { audioEl } of this.peers.values()) {
        if (audioEl) audioEl.muted = !enabled; // local user deafen
      }
    }

    async _ensurePeer(peerId, initiator = false, force = false) {
      if (!this.localStream && !force) return null;
      if (this.peers.has(peerId)) return this.peers.get(peerId).pc;

      const pc = new RTCPeerConnection(this.rtcConfig);

      // local tracks
      if (this.localStream) {
        for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
      }

      pc.onicecandidate = (e) => {
        if (e.candidate && this.channelId) {
          this.socket.emit("voice:signal", {
            to: peerId,
            roomId: this.roomId,
            channelId: this.channelId,
            type: "ice",
            data: e.candidate
          });
        }
      };

      pc.ontrack = (e) => {
        const stream = e.streams?.[0];
        if (!stream) return;

        let entry = this.peers.get(peerId);
        if (!entry) return;

        if (!entry.audioEl) {
          const a = document.createElement("audio");
          a.autoplay = true;
          a.playsInline = true;
          a.srcObject = stream;
          a.muted = this.deafened; // if deafened, don't play others
          document.body.appendChild(a);
          entry.audioEl = a;
        } else {
          entry.audioEl.srcObject = stream;
        }
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === "failed" || st === "disconnected" || st === "closed") {
          this._dropPeer(peerId);
        }
      };

      this.peers.set(peerId, { pc, audioEl: null });

      // initiator creates offer
      if (initiator) {
        try {
          const offer = await pc.createOffer({ offerToReceiveAudio: true });
          await pc.setLocalDescription(offer);
          this.socket.emit("voice:signal", {
            to: peerId,
            roomId: this.roomId,
            channelId: this.channelId,
            type: "offer",
            data: pc.localDescription
          });
        } catch (e) {
          console.warn("offer error", e);
        }
      }

      return pc;
    }

    _dropPeer(peerId) {
      const entry = this.peers.get(peerId);
      if (!entry) return;
      try { entry.pc.close(); } catch {}
      if (entry.audioEl) entry.audioEl.remove();
      this.peers.delete(peerId);
    }

    _startSpeakingDetector() {
      this._stopSpeakingDetector();
      if (!this.localStream) return;

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(this.localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        // average energy
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;

        const speakingNow = avg > 18 && !this.muted; // threshold tuned for “basic”
        if (speakingNow !== this._speaking && this.channelId) {
          this._speaking = speakingNow;
          this.socket.emit("voice:speaking", { roomId: this.roomId, channelId: this.channelId, speaking: speakingNow });
        }

        this._speakingTimer = requestAnimationFrame(tick);
      };

      this._speakingTimer = requestAnimationFrame(tick);

      // store ctx so it doesn't GC
      this._audioCtx = ctx;
      this._analyser = analyser;
    }

    _stopSpeakingDetector() {
      if (this._speakingTimer) cancelAnimationFrame(this._speakingTimer);
      this._speakingTimer = null;
      this._speaking = false;

      try { this._audioCtx?.close(); } catch {}
      this._audioCtx = null;
      this._analyser = null;
    }
  };
})();
