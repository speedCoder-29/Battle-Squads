/* ============================================================
   p2p.js — multiplayer without a server to deploy.

   Vercel serves static files. It cannot hold a WebSocket open —
   its functions are capped at 300s and are not long-lived — so a
   dedicated game server can never live on the same host as the
   site. That is the whole reason this file exists.

   Instead, one player's browser becomes the host: it runs the very
   same authoritative simulation the Node server runs (js/roomsim.js)
   and everyone else connects straight to it. Two ways in:

     WebRTC (PeerJS)  — real players on real devices, anywhere.
                        Only a tiny public broker is used, and only
                        to introduce the two peers; the game traffic
                        goes directly between them.
     BroadcastChannel — two tabs on one machine. No network at all,
                        which makes it the quickest way to see the
                        netcode working.

   The host is authoritative exactly as the server is: peers send
   inputs, never positions.
   ============================================================ */
const P2P = (() => {

  const PEER_LIB = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const ROOM_PREFIX = 'battlesquads-';         // namespaces our ids on the broker
  const TICK = 1000 / 20;
  const CHANNEL = 'battle-squads-local';

  let host = null;          // { room, peers, loop }  when we're hosting
  let guest = null;         // { conn, onMessage }    when we've joined
  let mode = null;          // 'webrtc' | 'local' | null

  const listeners = { message: [], status: [], peers: [] };
  /* The room answers a join with `welcome` straight away — before the game
     screen has had a chance to subscribe. Anything sent to nobody is held
     here and replayed to the first listener, otherwise the host would never
     receive its own welcome and would not know which agent it is. */
  const pending = [];
  const on = (evt, fn) => {
    (listeners[evt] = listeners[evt] || []).push(fn);
    if (evt === 'message' && pending.length) {
      const held = pending.splice(0, pending.length);
      for (const m of held) fn(m);
    }
    return P2P;
  };
  const emit = (evt, data) => {
    const ls = listeners[evt] || [];
    if (!ls.length) { if (evt === 'message' && pending.length < 64) pending.push(data); return; }
    ls.forEach(fn => fn(data));
  };

  /* A new match starts with a clean bus: game.js subscribes on every
     startOnline, so without this a second match would deliver every message
     twice over. */
  function resetBus() { listeners.message.length = 0; pending.length = 0; }

  /* ---------- loading PeerJS on demand ---------- */
  let peerLibPromise = null;
  function loadPeerLib() {
    if (typeof window !== 'undefined' && window.Peer) return Promise.resolve(window.Peer);
    if (peerLibPromise) return peerLibPromise;
    peerLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEER_LIB;
      s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS failed to load')));
      s.onerror = () => reject(new Error('Could not load PeerJS (offline, or blocked)'));
      document.head.appendChild(s);
    });
    return peerLibPromise;
  }

  /* ---------- the authoritative host ---------- */
  function startHost(code, opts) {
    resetBus();
    const room = new RoomSim.Room('p2p-' + code, (opts && opts.mode) || 'domination');
    // A shared code should give a reproducible world, and the host must build
    // the same one it hands out — so the room's seed comes from the code.
    if (code) {
      let h = 2166136261;
      for (const ch of String(code)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
      room.seed = h >>> 0;
    }
    host = { code, room, peers: new Map(), nextPeer: 1, timer: null, simTimer: null };

    // the host plays too — its own send() just loops straight back
    host.localPlayer = room.join(
      (msg) => emit('message', msg),
      { name: (opts && opts.name) || 'Host', weapon: opts && opts.weapon, skin: opts && opts.skin },
    );

    let last = Date.now();
    host.simTimer = setInterval(() => {
      const t = Date.now();
      room.step(Math.min(0.05, (t - last) / 1000));
      last = t;
    }, 1000 / 60);
    host.timer = setInterval(() => {
      if (!room.players.size) return;
      room.broadcast(room.snapshot());
    }, TICK);

    emit('status', { hosting: true, code, players: room.players.size });
    return host.localPlayer;
  }

  /* The room is created before the map is, so the host hands the geometry
     over once game.js has generated it. Until then the sim has no walls. */
  function provideWorld(rects) {
    if (!host) return 0;
    return host.room.setWorld(rects);
  }

  /* accept a peer and wire its messages into the room */
  function acceptPeer(sendFn, info) {
    if (!host) return null;
    const p = host.room.join(sendFn, info || {});
    emit('status', { hosting: true, code: host.code, players: host.room.players.size });
    emit('peers', rosterNames());
    return p;
  }
  function handleFromPeer(player, msg) {
    if (!host || !player) return;
    const room = host.room;
    if (msg.t === 'input') {
      const i = player.input;
      i.up = !!msg.up; i.down = !!msg.down; i.left = !!msg.left; i.right = !!msg.right;
      i.shooting = !!msg.shooting; i.ads = !!msg.ads;
      if (msg.fire) i.fireEdge = true;
      if (typeof msg.angle === 'number') i.angle = msg.angle;
    } else if (msg.t === 'reload') {
      if (Date.now() >= player.reloadUntil && player.ammo < player.weapon.mag) {
        player.reloadUntil = Date.now() + player.weapon.reloadMs;
        player.ammo = player.weapon.mag;
      }
    } else if (msg.t === 'ping') {
      player.send({ t: 'pong', c: msg.c });
    }
    void room;
  }
  const rosterNames = () =>
    host ? [...host.room.players.values()].map(p => ({ name: p.name, team: p.team })) : [];

  /* ---------- WebRTC ---------- */
  async function hostWebRTC(code, opts) {
    const Peer = await loadPeerLib();
    return new Promise((resolve, reject) => {
      const peer = new Peer(ROOM_PREFIX + code, { debug: 0 });
      const timeout = setTimeout(() => reject(new Error('Broker did not respond — try again')), 12000);
      peer.on('open', () => {
        clearTimeout(timeout);
        mode = 'webrtc';
        const me = startHost(code, opts);
        host.peer = peer;
        peer.on('connection', (conn) => {
          let player = null;
          conn.on('open', () => {
            player = acceptPeer((msg) => { try { conn.send(msg); } catch (e) {} }, conn.metadata || {});
            conn.on('data', (msg) => handleFromPeer(player, msg));
          });
          conn.on('close', () => {
            if (player) { host.room.leave(player.id); emit('peers', rosterNames()); }
          });
        });
        resolve({ code, me, seed: host.room.seed });
      });
      peer.on('error', (err) => {
        clearTimeout(timeout);
        // an id clash just means that code is taken
        reject(new Error(err && err.type === 'unavailable-id'
          ? 'That code is already hosting — pick another'
          : 'WebRTC error: ' + (err && err.type ? err.type : 'unknown')));
      });
    });
  }

  async function joinWebRTC(code, info) {
    resetBus();
    const Peer = await loadPeerLib();
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      const timeout = setTimeout(() => reject(new Error('Could not reach the host — check the code')), 15000);
      peer.on('open', () => {
        const conn = peer.connect(ROOM_PREFIX + code, { metadata: info || {}, reliable: true });
        conn.on('open', () => {
          clearTimeout(timeout);
          mode = 'webrtc';
          guest = { conn, peer };
          conn.on('data', (msg) => emit('message', msg));
          conn.on('close', () => { guest = null; emit('status', { disconnected: true }); });
          emit('status', { joined: true, code });
          resolve(conn);
        });
        conn.on('error', () => { clearTimeout(timeout); reject(new Error('Host refused the connection')); });
      });
      peer.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(err && err.type === 'peer-unavailable'
          ? 'Nobody is hosting that code'
          : 'WebRTC error: ' + (err && err.type ? err.type : 'unknown')));
      });
    });
  }

  /* ---------- same-machine, two tabs ----------
     No network involved: the quickest way to see whether the netcode is
     behaving before you get two devices together. */
  function hostLocal(code, opts) {
    const ch = new BroadcastChannel(CHANNEL);
    mode = 'local';
    const me = startHost(code, opts);
    host.channel = ch;
    ch.onmessage = (ev) => {
      const { peerId, payload } = ev.data || {};
      if (!payload) return;
      if (payload.t === 'hello') {
        const player = acceptPeer(
          (msg) => ch.postMessage({ toPeer: peerId, payload: msg }),
          payload.info || {},
        );
        host.peers.set(peerId, player);
      } else {
        const player = host.peers.get(peerId);
        if (player) handleFromPeer(player, payload);
      }
    };
    emit('status', { hosting: true, code, local: true });
    return { code, me, seed: host.room.seed };
  }

  function joinLocal(info) {
    resetBus();
    const ch = new BroadcastChannel(CHANNEL);
    const peerId = 'g' + Math.random().toString(36).slice(2, 8);
    mode = 'local';
    guest = {
      channel: ch, peerId,
      conn: { send: (msg) => ch.postMessage({ peerId, payload: msg }) },
    };
    ch.onmessage = (ev) => {
      const { toPeer, payload } = ev.data || {};
      if (toPeer !== peerId || !payload) return;
      emit('message', payload);
    };
    ch.postMessage({ peerId, payload: { t: 'hello', info: info || {} } });
    emit('status', { joined: true, local: true });
    return guest.conn;
  }

  /* ---------- what the game talks to ---------- */
  /* Looks like the SocketTransport in net.js, so game.js can't tell the
     difference between a hosted match and a served one. */
  function transport() {
    return {
      kind: mode === 'local' ? 'local-p2p' : 'webrtc',
      connected: true,
      snapshots: [],
      ping: 0,
      send(t, data) {
        const msg = { t, ...data };
        if (host) {
          // hosting: feed our own inputs straight into the room
          handleFromPeer(host.localPlayer, msg);
          if (t === 'ping') emit('message', { t: 'pong', c: data.c });
        } else if (guest && guest.conn) {
          try { guest.conn.send(msg); } catch (e) {}
        }
      },
      close() { stop(); },
      interpolated() {
        const s = this.snapshots;
        if (s.length < 2) return s.length ? { a: s[0].data, b: s[0].data, t: 0 } : null;
        const target = performance.now() - Net.INTERP_DELAY;
        for (let i = s.length - 1; i > 0; i--) {
          if (s[i - 1].at <= target && s[i].at >= target) {
            const span = s[i].at - s[i - 1].at || 1;
            return { a: s[i - 1].data, b: s[i].data, t: (target - s[i - 1].at) / span };
          }
        }
        return { a: s[s.length - 2].data, b: s[s.length - 1].data, t: 1 };
      },
      get status() {
        return { kind: this.kind, ok: true, label: host ? 'Hosting' : 'Connected', ping: this.ping };
      },
    };
  }

  function stop() {
    if (host) {
      clearInterval(host.simTimer); clearInterval(host.timer);
      if (host.peer) try { host.peer.destroy(); } catch (e) {}
      if (host.channel) try { host.channel.close(); } catch (e) {}
      host = null;
    }
    if (guest) {
      if (guest.peer) try { guest.peer.destroy(); } catch (e) {}
      if (guest.channel) try { guest.channel.close(); } catch (e) {}
      guest = null;
    }
    mode = null;
    emit('status', { stopped: true });
  }

  const isHosting = () => !!host;
  const isGuest = () => !!guest;
  const isActive = () => !!(host || guest);
  const playerCount = () => (host ? host.room.players.size : 0);

  return {
    hostWebRTC, joinWebRTC, hostLocal, joinLocal,
    transport, stop, on, provideWorld,
    isHosting, isGuest, isActive, playerCount, rosterNames,
    ROOM_PREFIX, CHANNEL,
    /* exposed for tests */ _startHost: startHost, _acceptPeer: acceptPeer, _handleFromPeer: handleFromPeer,
    get _host() { return host; },
  };
})();
