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

  /* ---------- how the two peers actually find a path to each other ----------
     We used to take PeerJS's built-in ICE list, and two thirds of it is dead.
     Its defaults are one Google STUN server plus `eu-0.turn.peerjs.com` and
     `us-0.turn.peerjs.com` — and neither of those hostnames resolves any more.
     Public DNS returns no address at all for them, so every connection was
     attempted with STUN and nothing else.

     STUN only tells you what your public address looks like from outside. It
     is enough for two ordinary home routers to punch a hole to one another,
     which is why this ever worked. It is not enough for a symmetric NAT — most
     mobile networks, most workplaces, most schools — because that kind of
     router gives every destination a different port, so the address STUN
     reported is not the one the other side can use. Those joins never
     completed: no error, no candidate that worked, just fifteen seconds of
     silence and then "check the code", which sent people hunting for a typo
     that was never there.

     So we stop inheriting the defaults and say what we want. Several STUN
     vendors, because one of them being down should not take multiplayer with
     it, and a TURN slot.

     TURN is the part that cannot be free. A relay carries the whole match, so
     somebody pays for the bandwidth, and every public one that used to be
     listed here has since been withdrawn — the two PeerJS relays above,
     openrelay.metered.ca, freeturn.net. Bring your own and everyone can
     connect: fill in TURN below, or pass it at runtime with
       ?turn=turn:host:3478&turnUser=NAME&turnPass=SECRET
     Metered, Cloudflare Calls, ExpressTurn and a coturn box of your own all
     work. Without one the game still runs for most pairs of players — it just
     cannot promise it, and now it says so rather than blaming the code. */
  const STUN = [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun.cloudflare.com:3478',
    'stun:global.stun.twilio.com:3478',
  ];
  /* Your relay goes here. urls may be a single string or a list — prefer a
     :443 or ?transport=tcp entry alongside the UDP one, since the networks
     that need a relay at all are usually the ones that also block UDP. */
  const TURN = { urls: [], username: '', credential: '' };

  function turnFromQuery() {
    try {
      const q = new URLSearchParams(location.search);
      const urls = q.get('turn');
      if (!urls) return null;
      return {
        urls: urls.split(',').map(s => s.trim()).filter(Boolean),
        username: q.get('turnUser') || '',
        credential: q.get('turnPass') || '',
      };
    } catch (e) { return null; }   // no location in a test harness
  }
  function relay() {
    const q = turnFromQuery();
    if (q && q.urls.length) return q;
    const urls = Array.isArray(TURN.urls) ? TURN.urls : (TURN.urls ? [TURN.urls] : []);
    return urls.length ? { urls, username: TURN.username, credential: TURN.credential } : null;
  }
  const hasRelay = () => !!relay();
  function iceServers() {
    const list = [{ urls: STUN }];
    const r = relay();
    if (r) list.push(r);
    return list;
  }
  const peerOpts = () => ({
    debug: 0,
    config: { iceServers: iceServers(), sdpSemantics: 'unified-plan' },
  });

  /* Why a connection didn't come up, in words that point at the actual
     problem. `failed` means the two sides traded candidates and none of them
     worked — that is the relay case, not a wrong code. */
  const RELAY_ADVICE = hasRelay()
    ? 'Found the host, but neither your network nor the relay could carry the connection.'
    : 'Found the host, but your two networks will not talk to each other directly — one of you '
      + 'is behind a router that needs a TURN relay (see the README). Try the same wifi, or a '
      + 'phone hotspot.';

  /* PeerJS hands us the RTCPeerConnection once the negotiator has built it,
     which is a tick or two after connect(). Watch it so an ICE failure is
     reported the moment it happens instead of waiting out the timeout. */
  function watchIce(conn, onFail) {
    let tries = 0;
    const attach = () => {
      const pc = conn && conn.peerConnection;
      if (!pc) { if (tries++ < 40) setTimeout(attach, 50); return; }
      const check = () => {
        const s = pc.iceConnectionState;
        if (s === 'failed') onFail(RELAY_ADVICE);
      };
      pc.addEventListener('iceconnectionstatechange', check);
      check();
    };
    attach();
  }
  /* What to say when the wait ran out. If a peer connection exists and is
     still checking, the host was found and the paths are what failed. */
  function timeoutReason(conn) {
    const pc = conn && conn.peerConnection;
    const s = pc && pc.iceConnectionState;
    if (s === 'checking' || s === 'failed' || s === 'disconnected') return RELAY_ADVICE;
    return 'Could not reach the host — check the code, and that they are still hosting.';
  }

  /* The broker only remembers a host for as long as its socket stays up, and a
     browser throttles timers in a tab that is not on screen — which is exactly
     where a host tab sits while its owner reads the code out. The keepalive
     stalls, the broker drops the socket, and the id is handed back. The host
     went on saying "Hosting ABCDE" while everyone typing ABCDE was told nobody
     was hosting it. PeerJS reports this as `disconnected` (the peer is still
     alive, it just lost its registration), so take the id back rather than
     letting the room quietly become unreachable. */
  function keepRegistered(peer, onNote) {
    let tries = 0, timer = null;
    peer.on('disconnected', () => {
      if (peer.destroyed || timer) return;
      const wait = Math.min(8000, 500 * Math.pow(2, tries++));
      onNote('Lost the lobby registration — getting the code back…');
      timer = setTimeout(() => {
        timer = null;
        if (peer.destroyed) return;
        try { peer.reconnect(); } catch (e) { /* destroyed underneath us */ }
      }, wait);
    });
    peer.on('open', () => { tries = 0; });
  }

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

  /* ---------- a timer that survives being in the background ----------
     setInterval in a hidden tab is clamped to about once a second, and a host
     tab spends most of a match hidden — its owner is reading the code out, or
     has tabbed away entirely. The accumulator above means no simulated time is
     lost when that happens, but it can't fix *when* the time arrives: at 1Hz
     the room sat still for a second and then replayed a second of movement in
     one go. Measured, the guest ran an average of 54px ahead of where the room
     had them, spiking past 200px between bursts, and the reconciler spent the
     whole match hauling them back — the same yanking, arriving a different way.

     A dedicated worker doesn't get that clamp, so the ticks keep coming at the
     rate we asked for whatever the tab is doing. If workers or blob URLs are
     unavailable, fall back to setInterval and accept the lumpiness rather than
     not hosting at all. */
  function ticker(fn, ms) {
    try {
      const src = 'let h=null;onmessage=e=>{if(e.data&&e.data.stop){clearInterval(h);close();return;}'
        + 'clearInterval(h);h=setInterval(()=>postMessage(0),e.data.ms);};';
      const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      w.onmessage = () => fn();
      w.postMessage({ ms });
      return { stop() { try { w.postMessage({ stop: true }); w.terminate(); } catch (e) {} } };
    } catch (e) {
      const id = setInterval(fn, ms);
      return { stop() { clearInterval(id); } };
    }
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
    host.simTimer = ticker(() => {
      const t = Date.now();
      backlog = Math.min(SIM_CATCHUP_MAX, backlog + (t - last) / 1000);
      last = t;
      while (backlog >= SIM_STEP) { room.step(SIM_STEP); backlog -= SIM_STEP; }
    }, 1000 / 60);
    host.timer = ticker(() => {
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
    } else if (msg.t === 'melee') {
      /* Swinging a tool. Nothing about the tool travels — the room reads it off
         the player's class — so this can only ask, never assert. */
      room.melee(player);
    } else if (msg.t === 'dig') {
      // the trench spade. The room owns the hole because it rolls the dodge.
      room.dig(player, msg.r, msg.dodge);
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
      const peer = new Peer(ROOM_PREFIX + code, peerOpts());
      let opened = false;
      const timeout = setTimeout(() => reject(new Error('Broker did not respond — try again')), 12000);
      const note = (msg) => emit('status', { hosting: true, code, error: msg });
      peer.on('open', () => {
        clearTimeout(timeout);
        /* `open` fires again every time the peer reclaims its id after a
           dropped registration (see keepRegistered). Building the room here
           unguarded would throw the live match away and start a fresh one
           under everybody mid-round. Second time round there is nothing to do
           but say the code is live again. */
        if (opened) { emit('status', { hosting: true, code, players: host ? host.room.players.size : 0 }); return; }
        opened = true;
        mode = 'webrtc';
        const me = startHost(code, opts);
        host.peer = peer;
        keepRegistered(peer, note);
        peer.on('connection', (conn) => {
          let player = null;
          /* A guest whose network can't reach us never opens this connection,
             and the host saw nothing at all — no arrival, no failure. Say it,
             because it is the host who has to decide to stand up a relay. */
          watchIce(conn, (why) => { if (!player) note('Someone tried to join. ' + why); });
          conn.on('open', () => {
            player = acceptPeer((msg) => { try { conn.send(msg); } catch (e) {} }, conn.metadata || {});
            conn.on('data', (msg) => handleFromPeer(player, msg));
          });
          conn.on('close', () => { if (player) dropPlayer(player); });
        });
        resolve({ code, me, seed: host.room.seed });
      });
      peer.on('error', (err) => {
        clearTimeout(timeout);
        const type = (err && err.type) || 'unknown';
        /* Once we're hosting the promise is long settled, so rejecting it again
           is a no-op and the host is told nothing at all. Errors after that
           point — a peer that couldn't be reached, the broker dropping us — go
           to the lobby status line instead. */
        if (opened) {
          // `network` is the registration dropping, which keepRegistered is
          // already reporting and already fixing — saying it twice helps nobody
          if (type !== 'peer-unavailable' && type !== 'network') note('Connection trouble: ' + type);
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
      const peer = new Peer(peerOpts());
      let conn = null, settled = false;
      /* Every exit from here goes through one of these two, so a failure can
         never leave a half-built peer running in the background holding a
         socket open to the broker. */
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { peer.destroy(); } catch (e) {}
        reject(new Error(msg));
      };
      const ok = (c) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(c);
      };
      const timeout = setTimeout(() => fail(timeoutReason(conn)), 15000);

      peer.on('open', () => {
        // reclaiming our id after a blip must not open a second connection
        if (conn) return;
        conn = peer.connect(ROOM_PREFIX + code, { metadata: info || {}, reliable: true });
        /* ICE giving up is the failure people actually hit, and it used to be
           invisible: the promise sat there until the timeout and then blamed
           the code. Report it as what it is, as soon as it happens. */
        watchIce(conn, fail);
        conn.on('open', () => {
          mode = 'webrtc';
          guest = { conn, peer, code };
          conn.on('data', (msg) => emit('message', msg));
          conn.on('close', () => { guest = null; emit('status', { disconnected: true }); });
          bindGoodbye();
          emit('status', { joined: true, code });
          ok(conn);
        });
        conn.on('error', () => fail('Host refused the connection'));
      });
      peer.on('error', (err) => {
        const type = (err && err.type) || 'unknown';
        /* Once we are in, the peer's errors are the broker's problem, not the
           match's — the data channel is direct and keeps running without it. */
        if (settled) return;
        if (type === 'peer-unavailable') return fail('Nobody is hosting that code');
        if (type === 'network') return fail('Lost the connection to the lobby broker — try again');
        fail('WebRTC error: ' + type);
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
      // both are worker-backed tickers now, not raw intervals
      if (host.simTimer) host.simTimer.stop();
      if (host.timer) host.timer.stop();
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
    hasRelay, iceServers,
    ROOM_PREFIX, CHANNEL,
    /* exposed for tests */ _startHost: startHost, _acceptPeer: acceptPeer, _handleFromPeer: handleFromPeer,
    get _host() { return host; },
  };
})();
