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
    /* Hosting twice without stopping used to leave the first room running:
       `host` was simply overwritten, so its two intervals kept stepping a match
       nobody could see, and the old code stayed registered with the broker —
       anyone who still had it joined a room the host had forgotten about. */
    if (host || guest) stop();
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

    /* The host plays too — its own send() just loops straight back.
       Everything a guest tells the room about itself has to be told here as
       well. Passing only name/weapon/skin meant the room ran the host's *stock*
       gun while their own client ran the one with attachments on it, so the two
       disagreed about magazine size, damage and walking speed — the same
       desync that drags a player away from where they think they are, except
       it was the host suffering it. */
    host.localPlayer = room.join(
      (msg) => emit('message', msg),
      { ...(opts || {}), name: (opts && opts.name) || 'Host' },
    );

    /* ---------- the simulation loop ----------
       Fixed timestep with an accumulator, rather than "however long since the
       last tick, capped".

       The cap was the bug. A browser throttles timers in a tab that isn't the
       visible one, so the moment the host alt-tabbed its ticks arrived late —
       and every late tick had its excess thrown away by the cap. Measured with
       the host tab merely in the background: 87% of real time simulated, so
       every guest walked 13% further on their own screen than the room ever
       moved them. The reconciler then spent the whole match dragging them back
       against their own movement, which is what the yanking actually was.

       Banking the leftover and spending it in whole steps loses nothing: a
       tick that arrives late runs two steps instead of one. The catch-up
       ceiling is there so a host that was suspended for a minute resumes the
       match rather than fast-forwarding a minute of bullets into everyone. */
    const SIM_STEP = 1 / 60;
    const SIM_CATCHUP_MAX = 1.0;      // seconds of backlog worth replaying
    let last = Date.now(), backlog = 0;
    host.simTimer = setInterval(() => {
      const t = Date.now();
      backlog = Math.min(SIM_CATCHUP_MAX, backlog + (t - last) / 1000);
      last = t;
      while (backlog >= SIM_STEP) { room.step(SIM_STEP); backlog -= SIM_STEP; }
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
  function provideWorld(world) {
    if (!host) return 0;
    // the surface lookup is a function, so it never goes on the wire — it only
    // makes sense in the host's own tab, which is where the room lives
    if (world && typeof world.surface === 'function') host.room.setSurface(world.surface);
    return host.room.setWorld(world);
  }

  /* accept a peer and wire its messages into the room */
  function acceptPeer(sendFn, info) {
    if (!host) return null;
    // a full room turns people away with a reason rather than seating them
    const p = host.room.join(sendFn, info || {});
    if (!p) return null;
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
      // the magazine fills when the reload ends — room.step() does that
      if (Date.now() >= player.reloadUntil && player.ammo < player.weapon.mag) {
        player.reloadUntil = Date.now() + player.weapon.reloadMs;
        player.reloading = true;
      }
    } else if (msg.t === 'door') {
      room.toggleDoor(player, msg.id, msg.open);
    } else if (msg.t === 'mark') {
      room.mark(player, msg.x, msg.y, msg.kind);
    } else if (msg.t === 'emote') {
      room.emote(player, msg.id);
    } else if (msg.t === 'ping') {
      player.send({ t: 'pong', c: msg.c });
    } else if (msg.t === 'bye') {
      /* Someone closing the tab. WebRTC notices this by itself, but a
         BroadcastChannel has no close event, so without an explicit goodbye a
         guest who left stood in the room forever — a body everyone could still
         see, shoot at, and lose a capture to. */
      dropPlayer(player);
    }
  }

  /* take a player out of the room and tell the lobby */
  function dropPlayer(player) {
    if (!host || !player) return;
    host.room.leave(player.id);
    for (const [peerId, p] of host.peers) if (p === player) host.peers.delete(peerId);
    emit('status', { hosting: true, code: host.code, players: host.room.players.size });
    emit('peers', rosterNames());
  }
  const rosterNames = () =>
    host ? [...host.room.players.values()].map(p => ({ name: p.name, team: p.team })) : [];

  /* ---------- WebRTC ---------- */
  async function hostWebRTC(code, opts) {
    const Peer = await loadPeerLib();
    return new Promise((resolve, reject) => {
      const peer = new Peer(ROOM_PREFIX + code, { debug: 0 });
      let opened = false;
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
          conn.on('close', () => { if (player) dropPlayer(player); });
        });
        resolve({ code, me, seed: host.room.seed });
        opened = true;
      });
      peer.on('error', (err) => {
        clearTimeout(timeout);
        const type = (err && err.type) || 'unknown';
        /* Once we're hosting the promise is long settled, so rejecting it again
           is a no-op and the host is told nothing at all. Errors after that
           point — a peer that couldn't be reached, the broker dropping us — go
           to the lobby status line instead. */
        if (opened) {
          if (type !== 'peer-unavailable') emit('status', { hosting: true, code, error: 'Connection trouble: ' + type });
          return;
        }
        // an id clash just means that code is taken
        reject(new Error(type === 'unavailable-id'
          ? 'That code is already hosting — pick another'
          : 'WebRTC error: ' + type));
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
          guest = { conn, peer, code };
          conn.on('data', (msg) => emit('message', msg));
          conn.on('close', () => { guest = null; emit('status', { disconnected: true }); });
          bindGoodbye();
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
  /* Which tab is hosting the same-machine game. The claim used to be written
     once and treated as stale after 15 seconds, so the second tab you opened
     more than 15s later quietly started a *second* host instead of joining the
     first — two rooms, two maps, two players who never meet. The host keeps
     the claim warm for as long as it is actually up, and clears it on the way
     out, so "is anyone hosting?" is a real answer rather than a stopwatch. */
  const LOCAL_CLAIM = 'bs-local-host';
  const CLAIM_FRESH = 4000;
  function localHostAlive() {
    try {
      const at = +localStorage.getItem(LOCAL_CLAIM);
      return !!at && Date.now() - at < CLAIM_FRESH;
    } catch (e) { return false; }
  }

  function hostLocal(code, opts) {
    const ch = new BroadcastChannel(CHANNEL);
    mode = 'local';
    const me = startHost(code, opts);
    host.channel = ch;
    try {
      localStorage.setItem(LOCAL_CLAIM, String(Date.now()));
      host.claim = setInterval(() => {
        try { localStorage.setItem(LOCAL_CLAIM, String(Date.now())); } catch (e) {}
      }, CLAIM_FRESH / 2);
    } catch (e) { /* storage disabled — the second tab just can't auto-detect */ }
    ch.onmessage = (ev) => {
      const { peerId, payload } = ev.data || {};
      if (!payload) return;
      if (payload.t === 'hello') {
        const player = acceptPeer(
          (msg) => ch.postMessage({ toPeer: peerId, payload: msg }),
          payload.info || {},
        );
        if (player) host.peers.set(peerId, player);
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
      channel: ch, peerId, code: 'LOCAL',
      conn: { send: (msg) => ch.postMessage({ peerId, payload: msg }) },
    };
    ch.onmessage = (ev) => {
      const { toPeer, payload } = ev.data || {};
      if (toPeer !== peerId || !payload) return;
      emit('message', payload);
    };
    ch.postMessage({ peerId, payload: { t: 'hello', info: info || {} } });
    bindGoodbye();
    emit('status', { joined: true, local: true });
    return guest.conn;
  }

  /* Tell the host we're going before the tab dies. `pagehide` is the one event
     that reliably fires on a close, a refresh and a navigation. */
  let goodbyeBound = false;
  function bindGoodbye() {
    if (goodbyeBound || typeof window === 'undefined') return;
    goodbyeBound = true;
    window.addEventListener('pagehide', () => {
      if (guest && guest.conn) { try { guest.conn.send({ t: 'bye' }); } catch (e) {} }
    });
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
      // one buffering rule for both transports — see Net.interpolate
      interpolated() { return Net.interpolate(this.snapshots); },
      get status() {
        return { kind: this.kind, ok: true, label: host ? 'Hosting' : 'Connected', ping: this.ping };
      },
    };
  }

  function stop() {
    if (host) {
      clearInterval(host.simTimer); clearInterval(host.timer);
      if (host.claim) clearInterval(host.claim);
      // stop claiming the same-machine slot, so the next tab can host
      try { if (host.channel) localStorage.removeItem(LOCAL_CLAIM); } catch (e) {}
      if (host.peer) try { host.peer.destroy(); } catch (e) {}
      if (host.channel) try { host.channel.close(); } catch (e) {}
      host = null;
    }
    if (guest) {
      // let the host take us out of the room rather than leaving a body behind
      if (guest.conn) try { guest.conn.send({ t: 'bye' }); } catch (e) {}
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
  /* What the HUD puts on screen during a hosted match. The code only ever
     lived in the lobby status line, which is behind the game the moment you
     deploy — so a host had no way to read out the thing everybody needs to
     type in. Local games have no code to share, hence `local`. */
  const roomInfo = () => {
    if (host) {
      return {
        hosting: true, code: host.code, players: host.room.players.size,
        capacity: host.room.capacity, phase: host.room.phase, local: mode === 'local',
      };
    }
    if (guest) return { hosting: false, code: guest.code || null, players: 0, local: mode === 'local' };
    return null;
  };

  /* The host pressing "Start Match". Only they can — everyone else's copy of
     this returns false, because only the host has a room to start. */
  function startMatch() {
    if (!host) return false;
    return host.room.startMatch();
  }

  return {
    hostWebRTC, joinWebRTC, hostLocal, joinLocal,
    transport, stop, on, provideWorld, roomInfo, localHostAlive, startMatch,
    isHosting, isGuest, isActive, playerCount, rosterNames,
    ROOM_PREFIX, CHANNEL,
    /* exposed for tests */ _startHost: startHost, _acceptPeer: acceptPeer, _handleFromPeer: handleFromPeer,
    get _host() { return host; },
  };
})();
