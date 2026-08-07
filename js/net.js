/* ============================================================
   net.js — multiplayer client.

   The game talks to a transport, never to a socket. Two exist:

     LocalTransport  — no server. Everything is simulated in this
                       tab against bots. This is the offline game.
     SocketTransport — a real WebSocket to an authoritative server
                       (see server/server.js). The server owns the
                       world; we send inputs and render snapshots.

   Because the client is snapshot-driven either way, the rest of the
   game does not care which one is plugged in.

   IMPORTANT — where the server can live:
   Vercel (where battle-squads is hosted) runs serverless functions
   with a hard 300s ceiling and no persistent connections, so it
   cannot host the game server. Deploy server/ to any host that
   keeps a process alive — Render, Railway, Fly.io, or your own box —
   and put that URL in SERVER_URL below (or ?server=wss://... in the
   query string). With no server configured the game stays offline
   and plays exactly as it does today.
   ============================================================ */
const Net = (() => {

  /* Set this to your deployed server, e.g. 'wss://battle-squads.onrender.com'.
     Empty string = offline only. A ?server= query param overrides it, which
     makes it easy to point the live site at a test server. */
  const SERVER_URL = '';

  const TICK_RATE = 20;                  // snapshots/sec the server sends
  const SEND_RATE = 30;                  // input packets/sec we send
  const INTERP_DELAY = 100;              // ms we render behind the server

  function serverUrl() {
    try {
      const q = new URLSearchParams(location.search).get('server');
      if (q) return q;
    } catch (e) { /* no location in a test harness */ }
    return SERVER_URL;
  }
  const isConfigured = () => !!serverUrl();

  /* ---------- offline ---------- */
  class LocalTransport {
    constructor() { this.kind = 'local'; this.connected = true; }
    connect() { return Promise.resolve(this); }
    send() { /* nothing to send — this tab is the authority */ }
    close() { this.connected = false; }
    get status() { return { kind: 'local', label: 'Offline vs bots', ok: true }; }
  }

  /* ---------- online ---------- */
  class SocketTransport {
    constructor(url) {
      this.kind = 'socket';
      this.url = url;
      this.ws = null;
      this.connected = false;
      this.playerId = null;
      this.handlers = {};              // event -> fn
      this.snapshots = [];             // buffered for interpolation
      this.serverTimeOffset = 0;
      this.ping = 0;
    }
    on(evt, fn) { this.handlers[evt] = fn; return this; }
    emit(evt, data) { if (this.handlers[evt]) this.handlers[evt](data); }

    connect(joinInfo) {
      return new Promise((resolve, reject) => {
        let ws;
        try { ws = new WebSocket(this.url); }
        catch (e) { return reject(new Error('Bad server URL: ' + this.url)); }
        this.ws = ws;

        const timeout = setTimeout(() => {
          try { ws.close(); } catch (e) {}
          reject(new Error('Server did not respond'));
        }, 6000);

        ws.onopen = () => {
          clearTimeout(timeout);
          this.connected = true;
          this.send('join', joinInfo);
          resolve(this);
        };
        ws.onmessage = (ev) => this._recv(ev.data);
        ws.onclose = () => { this.connected = false; this.emit('close'); };
        ws.onerror = () => {
          clearTimeout(timeout);
          if (!this.connected) reject(new Error('Could not reach ' + this.url));
        };
      });
    }

    _recv(raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      switch (msg.t) {
        case 'welcome':
          this.playerId = msg.id;
          this.emit('welcome', msg);
          break;
        case 'snapshot':
          // keep a short buffer so we can render smoothly between ticks
          this.snapshots.push({ at: performance.now(), data: msg });
          while (this.snapshots.length > 32) this.snapshots.shift();
          this.emit('snapshot', msg);
          break;
        case 'pong':
          this.ping = Math.round(performance.now() - msg.c);
          break;
        case 'event':
          this.emit('event', msg);
          break;
        case 'end':
          this.emit('end', msg);
          break;
      }
    }

    send(t, data) {
      if (!this.ws || this.ws.readyState !== 1) return;
      this.ws.send(JSON.stringify({ t, ...data }));
    }
    close() { if (this.ws) try { this.ws.close(); } catch (e) {} this.connected = false; }

    interpolated() { return interpolate(this.snapshots); }

    get status() {
      return {
        kind: 'socket',
        label: this.connected ? `Online · ${this.ping}ms` : 'Disconnected',
        ok: this.connected,
        ping: this.ping,
      };
    }
  }

  /* ---------- picking one ----------
     Tries the server if one is configured; falls back to offline with a
     reason rather than failing the match. */
  async function open(joinInfo) {
    const url = serverUrl();
    if (!url) return { transport: new LocalTransport(), reason: 'No server configured' };
    try {
      const t = new SocketTransport(url);
      await t.connect(joinInfo);
      return { transport: t, reason: null };
    } catch (err) {
      return { transport: new LocalTransport(), reason: err.message };
    }
  }

  /* ---------- picking the pair to render between ----------
     Two snapshots either side of "now minus a render delay", so the world
     moves smoothly instead of snapping 20 times a second.

     The delay adapts. A fixed 100ms is right for a steady stream, but a
     browser host is not a datacentre: it generates its map, it garbage
     collects, its tab gets throttled, and the snapshots bunch up. When the
     buffer ran dry the renderer held on the newest frame, and then the next
     packet dropped it back to a moment it had already drawn — every remote
     player lurching backwards. Watching the worst recent gap and buffering
     just behind it means a stuttering host costs a little more latency
     instead of a visible jolt.

     Shared by both transports so the socket path and the peer path can't
     drift apart. */
  const JITTER_WINDOW = 12;      // snapshots of history the estimate looks at
  const MAX_DELAY = 400;         // never fall further behind than this
  function interpolate(snaps) {
    if (!snaps || !snaps.length) return null;
    if (snaps.length < 2) return { a: snaps[0].data, b: snaps[0].data, t: 0 };

    let worst = 0;
    for (let i = Math.max(1, snaps.length - JITTER_WINDOW); i < snaps.length; i++) {
      const gap = snaps[i].at - snaps[i - 1].at;
      if (gap > worst) worst = gap;
    }
    const delay = Math.min(MAX_DELAY, Math.max(INTERP_DELAY, worst * 1.6));
    const target = performance.now() - delay;

    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1].at <= target && snaps[i].at >= target) {
        const span = snaps[i].at - snaps[i - 1].at || 1;
        return { a: snaps[i - 1].data, b: snaps[i].data, t: (target - snaps[i - 1].at) / span };
      }
    }
    // nothing new enough yet: hold on the freshest frame rather than guessing
    return { a: snaps[snaps.length - 2].data, b: snaps[snaps.length - 1].data, t: 1 };
  }

  /* Linear interpolation helper the renderer uses on snapshot pairs.

     Driven by the *newer* snapshot, which is what decides who is in the match
     right now. Walking the older one instead — as this used to — meant two
     things went wrong with a changing roster: somebody who joined between the
     two frames stayed invisible until they aged into the older snapshot, and
     somebody who left stayed on screen, frozen at their last position, being
     drawn and aimed at for as long as the old frame lingered in the buffer.
     Neither is survivable once more than a couple of people are coming and
     going. Anyone with no previous frame is simply drawn where they are. */
  function lerpAgents(a, b, t) {
    if (!b) return a ? a.agents.slice() : [];
    const prevById = {};
    if (a) for (const ag of a.agents) prevById[ag.id] = ag;
    const k = Math.max(0, Math.min(1, t));
    return b.agents.map(next => {
      const prev = prevById[next.id];
      if (!prev) return next;             // just joined, or just respawned into view
      return {
        ...next,
        x: prev.x + (next.x - prev.x) * k,
        y: prev.y + (next.y - prev.y) * k,
        angle: prev.angle + angleDelta(prev.angle, next.angle) * k,
      };
    });
  }
  const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

  return {
    SERVER_URL, TICK_RATE, SEND_RATE, INTERP_DELAY,
    LocalTransport, SocketTransport,
    open, isConfigured, serverUrl, lerpAgents, interpolate,
  };
})();
