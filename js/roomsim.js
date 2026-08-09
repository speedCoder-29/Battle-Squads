/* ============================================================
   roomsim.js — the authoritative match simulation.

   This is the part of multiplayer that owns the world: where every
   player is, what they shot, who died. It is deliberately free of
   any transport — it never touches a socket. You hand it a `send`
   function per player and it calls that with whatever the client
   needs to hear.

   That matters because the same code has to run in two places:

     • the Node server in server/server.js, over WebSockets
     • a player's own browser, hosting for their friends over
       WebRTC — which is how multiplayer works on a static host
       like Vercel, where nothing can hold a socket open

   Loaded as a plain script in the browser (window.RoomSim) and via
   require() on the server, so there is exactly one copy of the rules.
   ============================================================ */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.RoomSim = mod;
}(typeof self !== 'undefined' ? self : this, function () {

  /* The data modules are globals in the browser and required on the server;
     either way ballistics and the damage calculator are the same code both
     sides. Resolved on first use rather than at load, so this file doesn't
     care whether it is pulled in before or after them. */
  let W, C, K, FALLOFF_STEP;
  function deps() {
    if (W) return;
    if (typeof Weapons !== 'undefined') { W = Weapons; C = Combat; K = Classes; }
    else { const s = require('./_shared'); W = s.Weapons; C = s.Combat; K = s.Classes; }
    FALLOFF_STEP = W.TILE * 4;
  }

  const TICK = 1000 / 20;              // snapshot rate
  /* The client renders in these dimensions, so the simulation has to use them
     too. They were 3400x2300 here and 6400x6400 there, which meant an online
     match was simulated in one coordinate space and drawn in another. */
  const MAP_SIZES = { domination: { w: 6400, h: 6400 }, elimination: { w: 4500, h: 4500 } };
  /* How many squads each mode is fought between, matching TEAM_SETUP in
     game.js. This used to be the literal 4 in three separate places — the
     team-balancing loop, the score array and the spawn ring — so an
     elimination room quietly put everyone into four squads while every client
     drew six, and the fifth and sixth never got a spawn corner or a score. */
  const TEAM_COUNT = { domination: 4, elimination: 6 };
  /* A 6400px map is 128 tiles across; two dozen people on it are specks. The
     ceiling is per-squad rather than a flat number so that adding a squad adds
     room for a squad, and no team can be more than one player larger than the
     smallest. */
  const SQUAD_MAX = 8;
  const ROOM_MAX = 48;
  const MATCH_SECONDS = 8 * 60;
  const SCORE_CAP = 1000;              // domination win score, as offline
  const COMMS_GAP = 550;               // ms between one player's pings/emotes
  const DOOR_REACH = 110;              // how close you must be to work a door
  const MAX_TRENCHES = 200;            // a dug map, not a moonscape
  // Structures.WALL_TYPES.trench.dodge — the room doesn't load the wall table,
  // so a trench it digs itself carries the figure the client draws it with
  const TRENCH_DODGE = 0.5;
  /* Barbed wire cuts in chunks rather than a trickle, matching wireAt() in
     game.js: whole numbers of damage arriving occasionally read as being hurt,
     where 0.03 HP a tick reads as nothing at all. */
  const WIRE_CHUNK = 4;
  /* A barrel sets off its neighbours a beat later, so a row of them goes up as
     a run of blasts instead of one lump. */
  const CHAIN_MIN = 120, CHAIN_JITTER = 180;

  /* Ballistics, mirroring game.js. These belong with the simulation rather
     than the weapon table, and now that the sim is shared they live here
     instead of being declared separately by each host.
     BODY_R is the authoritative hitbox; BULLET_STEP must stay under it or a
     fast round can step straight past someone. */
  const BODY_R = 15;
  const BULLET_STEP = 10;
  const FALLOFF_START = 0.45, FALLOFF_MIN = 0.4;   // FALLOFF_STEP set in deps()

  const now = () => Date.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
  const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const angleDiff = (x, y) => Math.atan2(Math.sin(x - y), Math.cos(x - y));

  /* ---------- one movement model ----------
     The client predicts its own movement and the room decides it for real, so
     the two have to compute the same number or the player drifts away from
     where the room says they are and gets yanked back. They used to disagree:
     the client multiplied in terrain, barbed wire and tool slows that the room
     had never heard of, and the room ran on the *unmodified* weapon while the
     client ran on the one with attachments bolted on. Measured on a guest
     walking off a beach spawn, the room moved them roughly three times as fast
     as their own screen did.

     Everything both sides can agree on lives here now, and game.js calls this
     exact function while online. Terrain is the one term the room can't derive
     on its own, so whoever hosts hands it a lookup (see setSurface) — the host
     generated the map from the room's seed, so it has one. */
  function moveSpeedFor(p, ads) {
    // a guest never constructs a Room, so this can be the first thing in the
    // file anyone touches — resolve the shared tables here too
    deps();
    let spd = p.weapon.moveSpeed * p.cls.speed * C.armorSpeed(p)
      * C.adrenaline(p.adrenaline, p.perk).speed;
    if (ads) {
      spd *= 0.55;
      if (typeof p.weapon.scopeMoveMult === 'number') spd *= p.weapon.scopeMoveMult;
    }
    return spd;
  }

  /* What the ground under you does to that speed. Terrain used to be a bare
     multiplier both sides looked up independently, which was fine while it
     depended only on the position — but a Diver is not slowed by water, and
     that makes it depend on *who is standing there*. One function, given the
     surface and the player, so the client and the room can't disagree. */
  function surfaceSpeedFor(p, surf) {
    if (!surf) return 1;
    const speed = typeof surf === 'number' ? surf : surf.speed;
    if (typeof speed !== 'number' || !(speed > 0)) return 1;
    // a diver swims as fast as they walk; a river is no longer a wall
    if (surf.swim && p && p.perk === 'diver') return 1;
    return speed;
  }

  /* ---------- the world the match is fought in ----------
     The simulation used to know nothing about the map: players walked through
     warehouses and rounds went straight through walls, while every client drew
     solid buildings. Whoever owns the match now owns the geometry too.

     It arrives as a flat list of rects, because the client already generated
     exactly this world from the room's seed — see Game.netWorld(). Each rect
     keeps the id it had on the client, so "that wall just came down" is one
     number on the wire and every client destroys the same piece.

     Same coarse bucket grid the client uses: a map is 300+ segments and this
     is queried per player and per bullet hop. */
  const WCELL = 220;
  function worldIndex(rects, w, h) {
    const g = { cols: Math.ceil(w / WCELL) + 1, cells: new Map() };
    for (const s of rects) addToIndex(g, s);
    return g;
  }
  function addToIndex(g, s) {
    const x0 = Math.max(0, Math.floor(s.x / WCELL)), x1 = Math.floor((s.x + s.w) / WCELL);
    const y0 = Math.max(0, Math.floor(s.y / WCELL)), y1 = Math.floor((s.y + s.h) / WCELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = cy * g.cols + cx;
        let arr = g.cells.get(k);
        if (!arr) { arr = []; g.cells.set(k, arr); }
        arr.push(s);
      }
    }
  }
  const cellAt = (g, x, y) => g.cells.get(Math.floor(y / WCELL) * g.cols + Math.floor(x / WCELL));
  function nearRects(g, x, y, r) {
    const out = [];
    const x0 = Math.max(0, Math.floor((x - r) / WCELL)), x1 = Math.floor((x + r) / WCELL);
    const y0 = Math.max(0, Math.floor((y - r) / WCELL)), y1 = Math.floor((y + r) / WCELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = g.cells.get(cy * g.cols + cx);
        if (arr) for (const s of arr) if (!s.dead && out.indexOf(s) < 0) out.push(s);
      }
    }
    return out;
  }

  let nextId = 1;

  class Room {
    constructor(id, mode) {
      deps();                       // make sure the shared tables are resolved
      this.id = id;
      this.mode = mode || 'domination';
      this.map = MAP_SIZES[this.mode] || MAP_SIZES.domination;
      this.teams = TEAM_COUNT[this.mode] || 4;
      this.capacity = Math.min(ROOM_MAX, this.teams * SQUAD_MAX);
      /* Every client generates its own copy of the world, so they all need the
         same seed to end up with the same map. The room owns it and hands it
         out with the welcome. */
      this.seed = (Math.random() * 0xffffffff) >>> 0;
      this.players = new Map();          // id -> player
      this.walls = [];                   // world geometry, empty until setWorld
      this.wallIndex = null;
      this.downed = [];                  // walls destroyed so far, for late joiners
      this.objectives = [];              // domination capture points
      this.scores = new Array(this.teams).fill(0);   // domination score per team
      this.bullets = [];
      this.trenches = [];                // dug cover: {x, y, r, dodge}
      this.chains = [];                  // barrels waiting their turn to go off
      this.events = [];                  // things clients should hear about
      this.timeLeft = MATCH_SECONDS;     // see the accessor below — this sets endsAt
      /* Rooms open in a lobby and only start fighting when whoever is hosting
         says so. Deploying the host straight into the match meant everybody
         after them was a late joiner into a round already in progress, on a
         clock that had been running since before they clicked anything. */
      this.phase = 'lobby';
      this.tick = 0;
      this.over = false;
      this.lastSim = now();
      /* Terrain speed lookup, supplied by whoever hosts. A browser host has
         the terrain (it generated the same map from this room's seed); the
         Node server does not, and falls back to flat ground. */
      this.surface = null;
    }

    /* ---------- the match clock ----------
       Anchored to wall time rather than accumulated from the simulation's own
       dt. The room used to count down by subtracting each step's dt, which is
       capped at 50ms so one slow tick can't teleport everybody — but that cap
       also meant every hitch on whoever hosts *added* time to the match: a
       browser host generating its map, a garbage collection pause, or a tab
       the OS decided to throttle all made the round run long, and every guest
       inherited the stretched clock because the countdown ships in the
       snapshot. An end time in milliseconds can't drift: the match is over
       when it's over, whatever the host's frame rate did in between.

       Still assignable, because "end this round now" is just a shorter match. */
    get timeLeft() {
      // a lobby isn't burning match time, however long people take to arrive
      if (this.phase === 'lobby') return MATCH_SECONDS;
      return Math.max(0, (this.endsAt - now()) / 1000);
    }
    set timeLeft(seconds) { this.endsAt = now() + Math.max(0, seconds) * 1000; }

    /* fn(x, y) -> the surface there: either a bare speed multiplier or the
       full { speed, swim } that Terrain reports. The full object is what lets
       a Diver ignore water — a number alone can't say whether the slowdown is
       mud or a river. Null means flat ground everywhere. */
    setSurface(fn) { this.surface = typeof fn === 'function' ? fn : null; }
    surfaceAt(x, y) {
      if (!this.surface) return null;
      return this.surface(x, y);
    }

    get full() { return this.players.size >= this.capacity; }

    /* Hand the room the map. Whoever hosts has already built this world from
       this room's seed, so the rects — and their ids — are the ones every
       client is looking at. Safe to call before or after players join. */
    setWorld(world) {
      const rects = Array.isArray(world) ? world : (world && world.walls) || [];
      const objs = (!Array.isArray(world) && world && world.objectives) || [];
      this.objectives = objs.map(o => ({
        name: o.name, x: o.x, y: o.y, r: o.r,
        owner: -1, progress: 0, capTeam: -1,
      }));
      this.walls = (rects || []).map(r => ({
        id: r.id, x: r.x, y: r.y, w: r.w, h: r.h,
        solid: !!r.solid,                        // stops a player walking through
        mode: r.mode || 'stop',                  // what a round does: stop/pen/through/ricochet
        keep: typeof r.keep === 'number' ? r.keep : 0,
        hp: r.hp > 0 ? r.hp : Infinity,          // Infinity = indestructible
        type: r.type, toughness: r.toughness || 1,
        dead: false,
        /* Not every wall is something you bump into. A few act on whoever is
           standing in them, or on everyone nearby when they come apart, and
           the room has to own that the same way it owns a wall stopping you —
           otherwise barbed wire is scenery and a barrel is a crate.

           These arrive already looked up (see Game.netWorld) rather than the
           room importing the wall table, which keeps the geometry a plain
           description of itself: the room needs to know that this rect halves
           your speed, not that it is called `wire`. */
        slow: r.slow > 0 && r.slow < 1 ? r.slow : 0,      // 0 = doesn't slow you
        dps: r.dps > 0 ? r.dps : 0,                       // damage/sec while you stand in it
        explodes: r.explodes || null,                     // { damage, radius }
        /* A door is the one wall that changes its mind. Remember what it is
           when shut, so opening and closing it is reversible. */
        door: !!r.door, open: false, baseSolid: !!r.solid, baseMode: r.mode || 'stop',
      }));
      /* Dug cover. Circles rather than rects, and not part of the wall list at
         all — a trench doesn't stop anything, it just makes whoever is in it
         hard to hit. Usually empty at the start of a match: they get dug as it
         runs (see `dig`), so handing the world over again must not fill one in. */
      const dug = (!Array.isArray(world) && world && world.trenches) || null;
      if (dug) this.trenches = dug.slice();
      this.wallById = new Map(this.walls.map(w => [w.id, w]));
      this.wallIndex = worldIndex(this.walls, this.map.w, this.map.h);
      // anyone already standing in a wall gets pushed out of it
      for (const p of this.players.values()) if (p.alive) this.resolveWorld(p);
      return this.walls.length;
    }
    get hasWorld() { return !!(this.wallIndex && this.walls.length); }

    /* push a player out of anything solid they have ended up inside */
    resolveWorld(p, r = BODY_R) {
      if (!this.wallIndex) return;
      for (const o of nearRects(this.wallIndex, p.x, p.y, r + 4)) {
        if (!o.solid) continue;
        const cx = clamp(p.x, o.x, o.x + o.w);
        const cy = clamp(p.y, o.y, o.y + o.h);
        const dx = p.x - cx, dy = p.y - cy;
        const d = Math.hypot(dx, dy);
        if (d < r && d > 0) { p.x = cx + (dx / d) * r; p.y = cy + (dy / d) * r; }
        else if (d === 0) {
          // dead centre of the rect: leave by the nearest face
          const l = p.x - o.x, ri = o.x + o.w - p.x, t = p.y - o.y, b = o.y + o.h - p.y;
          const min = Math.min(l, ri, t, b);
          if (min === l) p.x = o.x - r;
          else if (min === ri) p.x = o.x + o.w + r;
          else if (min === t) p.y = o.y - r;
          else p.y = o.y + o.h + r;
        }
      }
    }

    /* ---------- what you are standing in ----------
       Barbed wire is the one bit of the map that does something to you while
       you walk through it rather than refusing to let you: 90% slower, and it
       cuts. Online it did neither. The client drew it, computed the slow, and
       then threw the number away, because applying a slow the room had never
       heard of only makes the prediction wrong and gets you dragged back — so
       everyone strolled through the wire at full speed taking nothing.

       Now the room owns it and the client predicts the same figure, which is
       what makes it safe for the client to apply it again.

       Point query rather than a radius sweep: you are either in the wire or
       you are not. `cellAt` is exact for a point because addToIndex files a
       rect under every cell it covers. */
    hazardAt(x, y) {
      if (!this.wallIndex) return null;
      const arr = cellAt(this.wallIndex, x, y);
      if (!arr) return null;
      let slow = 1, dps = 0;
      for (const s of arr) {
        if (s.dead || s.solid || (!s.slow && !s.dps) || !inRect(x, y, s)) continue;
        if (s.slow) slow = Math.min(slow, s.slow);
        dps += s.dps;
      }
      return slow < 1 || dps > 0 ? { slow, dps } : null;
    }
    /* Dug in: infantry in a trench dodge half of what comes at them. */
    trenchDodge(x, y) {
      for (const t of this.trenches) {
        if (dist2(x, y, t.x, t.y) < t.r * t.r) return t.dodge || 0;
      }
      return 0;
    }
    /* The trench-spade digging one. Broadcast so every client draws the same
       hole in the same place — a dodge nobody else can see is indistinguishable
       from the shooter missing for no reason. */
    dig(p, r, dodge) {
      if (!p || !p.alive) return false;
      if (this.trenches.length >= MAX_TRENCHES) return false;
      const t = {
        x: Math.round(p.x), y: Math.round(p.y),
        r: clamp(r || 48, 16, 120), dodge: clamp(dodge || 0.5, 0, 1),
      };
      this.trenches.push(t);
      this.pushEvent({ e: 'trench', x: t.x, y: t.y, r: t.r, dodge: t.dodge });
      return true;
    }

    /* ---------- swinging a tool ----------
       The bayonet, the axe, the hammer, the spade. Offline these hit people
       and chew through cover; online they did neither usefully. The swing ran
       on the client, where the only agent left in the world is you — so it
       could never touch an enemy — and when it broke a wall it broke it *only*
       there, leaving the room still holding a wall you had walked into. Being
       hauled back out of a doorway you had just cut is the same class of
       rubber-banding closed doors used to cause.

       Nothing about the tool comes over the wire. The room already knows which
       class the player is (it derived it from their weapon on join), and the
       class owns the tool, so a modified client cannot claim a longer reach or
       a bigger number — it can only ask to swing. */
    melee(p) {
      if (!p || !p.alive) return false;
      const t = p.cls && p.cls.tool;
      if (!t || t.passive || (!t.melee && !t.structure)) return false;
      const nowT = now();
      if (nowT < (p.toolUntil || 0)) return false;         // still on cooldown
      p.toolUntil = nowT + (t.cooldown || 0.5) * 1000;

      const reach = t.range + BODY_R;
      let hit = false;
      // enemies in a ~100° arc in front, matching meleeSwing() in game.js
      for (const o of this.players.values()) {
        if (!o.alive || o.id === p.id || o.team === p.team) continue;
        if (dist2(o.x, o.y, p.x, p.y) > (reach + BODY_R) ** 2) continue;
        if (Math.abs(angleDiff(Math.atan2(o.y - p.y, o.x - p.x), p.angle)) > 0.9) continue;
        this.damage(o, t.melee, 'normal', p);
        hit = true;
      }
      if (t.structure > 0 && this.meleeWalls(p, t, reach)) hit = true;
      // the spade digs when the swing found nothing, exactly as it does offline
      if (!hit && t.digs) this.dig(p, 48, TRENCH_DODGE);
      this.pushEvent({ e: 'melee', id: p.id, tool: t.id });
      return true;
    }
    /* Walls straight ahead, sampled along the swing — mirrors hitStructures().
       A tool only works a wall its Structure Pierce out-rates, unless it has an
       explicit clearing effect for that type (bayonet→wire, spade→sandbags). */
    meleeWalls(p, t, reach) {
      if (!this.wallIndex) return false;
      const seen = [];
      for (let d = BODY_R; d <= reach; d += 8) {
        const x = p.x + Math.cos(p.angle) * d, y = p.y + Math.sin(p.angle) * d;
        const arr = cellAt(this.wallIndex, x, y);
        if (!arr) continue;
        for (const s of arr) {
          if (s.dead || s.hp === Infinity || seen.indexOf(s) >= 0 || !inRect(x, y, s)) continue;
          if (!C.canDamageStructure(s, { kind: 'melee', pierce: t.pierce, clears: t.clears })) continue;
          seen.push(s);
          // a clearing tool cuts straight through whatever it was built for
          const dmg = t.clears === s.type ? Infinity : t.structure * ((t.vs && t.vs[s.type]) || 1);
          s.hp -= dmg;
          if (s.hp <= 0) this.destroyWall(s, p);
        }
      }
      return seen.length > 0;
    }

    /* is this spot clear of solid geometry? */
    freeSpot(x, y, r = BODY_R) {
      if (!this.wallIndex) return true;
      for (const o of nearRects(this.wallIndex, x, y, r)) {
        if (!o.solid) continue;
        const cx = clamp(x, o.x, o.x + o.w), cy = clamp(y, o.y, o.y + o.h);
        if (dist2(x, y, cx, cy) < r * r) return false;
      }
      return true;
    }

    /* how many are on each squad right now */
    teamCounts() {
      const counts = new Array(this.teams).fill(0);
      for (const p of this.players.values()) if (counts[p.team] !== undefined) counts[p.team]++;
      return counts;
    }
    /* the emptiest team that can seat a whole party together */
    freeTeam(size) {
      const counts = this.teamCounts();
      let best = 0;
      for (let t = 1; t < counts.length; t++) if (counts[t] < counts[best]) best = t;
      return best;
    }

    join(send, info, forceTeam) {
      /* A full room says so instead of seating someone anyway. Silently
         over-filling gave the extra players a team index nothing else knew
         about — no spawn corner, no score slot, no colour. */
      if (this.full) {
        send({ t: 'rejected', reason: 'This game is full (' + this.capacity + ' players).' });
        return null;
      }
      const id = nextId++;
      /* Take the weapon the player is actually carrying, attachments and all.
         Running the base gun here while their client ran the configured one
         meant the two disagreed about damage, magazine size and — because a
         suppressor or a bipod changes the weight — how fast they walk. */
      const base = W.byId[info.weapon] || W.byId[W.default];
      const weapon = (info.attachments || info.ammo)
        ? W.configure(base, { attachments: info.attachments, ammo: info.ammo })
        : base;
      const cls = K.forWeapon(weapon);
      // a party is handed a team so it stays together; otherwise the smallest
      // team wins the new player, keeping squads even
      let team = forceTeam;
      if (team === undefined || team < 0 || team >= this.teams) team = this.freeTeam(1);

      const spawn = this.spawnPoint(team);
      const p = {
        id, send, name: (info.name || 'Operator').slice(0, 16), team,
        x: spawn.x, y: spawn.y, angle: 0,
        hp: C.maxHpFor('infantry'), maxHp: C.maxHpFor('infantry'),
        klass: 'infantry', vest: 0, helmet: 0, bag: 0, adrenaline: 0,
        /* The perk changes numbers the client computes for itself — swim
           speed, armour weight, reload — so the room has to hold the same one
           or the two drift apart. */
        perk: (info.perk && String(info.perk).slice(0, 16)) || 'none',
        weaponId: weapon.id, weapon, cls,
        ammo: weapon.mag, reloadUntil: 0, fireCd: 0,
        alive: true, respawnAt: 0, kills: 0, deaths: 0,
        skin: info.skin || 'default',
        input: { up: false, down: false, left: false, right: false, shooting: false, ads: false, angle: 0 },
        lastSeen: now(),
      };
      this.players.set(id, p);
      p.send({
        t: 'welcome', id, team, mode: this.mode, map: this.map, seed: this.seed,
        // how many squads this match is fought between, and how many can be in
        // it — the client sizes its scoreboard from these rather than guessing
        teams: this.teams, capacity: this.capacity, phase: this.phase,
        tickRate: 1000 / TICK, roster: this.roster(),
        /* How long is left of *this* match, not of a fresh one. Join eight
           minutes into a round and your clock has to start where everyone
           else's is, rather than at 8:00 until the first snapshot lands. */
        timeLeft: Math.max(0, Math.round(this.timeLeft)),
        /* Where the room put you. The client spawned itself the moment it
           joined — before it knew which team it was on — so without this it
           stands at another squad's spawn until the reconciler drags it
           across the map. */
        x: Math.round(p.x), y: Math.round(p.y),
        // join halfway through and the cover that has already been shot away
        // should be gone on your screen too — and the doors people have opened
        // should be open, or you'd walk into one that isn't there
        downed: this.downed.slice(),
        openDoors: this.openDoors(),
        // and the holes people have dug, or you'd be shooting at someone the
        // room is letting dodge you for a reason your screen can't show
        trenches: this.trenches.slice(),
      });
      this.pushEvent({ e: 'join', id, name: p.name, team });
      this.pushLobby();
      return p;
    }

    leave(id) {
      const p = this.players.get(id);
      if (!p) return;
      this.players.delete(id);
      this.pushEvent({ e: 'leave', id, name: p.name });
      this.pushLobby();
    }

    /* Each team gets its own quarter of the map, and nobody spawns inside a
       building — spread the jitter wider on each retry so a crowded corner
       still finds somewhere to put you. */
    spawnPoint(team) {
      const cx = this.map.w / 2, cy = this.map.h / 2;
      const rx = this.map.w / 2 - 240, ry = this.map.h / 2 - 240;
      // squads are spaced evenly around the island, however many there are
      const ang = -Math.PI / 2 + (team / this.teams) * Math.PI * 2;
      const bx = cx + Math.cos(ang) * rx, by = cy + Math.sin(ang) * ry;
      let last = { x: bx, y: by };
      for (let i = 0; i < 40; i++) {
        const spread = 70 + i * 18;
        last = {
          x: clamp(bx + (Math.random() * 2 - 1) * spread, 40, this.map.w - 40),
          y: clamp(by + (Math.random() * 2 - 1) * spread, 40, this.map.h - 40),
        };
        if (this.freeSpot(last.x, last.y, BODY_R + 6)) return last;
      }
      return last;
    }

    /* ---------- comms ----------
       A ping is your team's business, so it goes straight to their sockets
       rather than into the snapshot everyone reads — a modified client can't
       learn where the other squad is being warned about. Emotes are for
       everyone, so those ride along with the events. Both are rate limited:
       one message every COMMS_GAP, or the map fills up with someone leaning
       on a key. */
    sendTeam(team, msg) {
      for (const p of this.players.values()) if (p.team === team) p.send(msg);
    }
    mark(p, x, y, kind) {
      if (!p || !p.alive) return false;
      const t = now();
      if (t < (p.commsUntil || 0)) return false;
      if (!(x >= 0 && x <= this.map.w && y >= 0 && y <= this.map.h)) return false;
      p.commsUntil = t + COMMS_GAP;
      this.sendTeam(p.team, {
        t: 'mark', x: Math.round(x), y: Math.round(y),
        kind: String(kind || 'enemy').slice(0, 12), by: p.name, byId: p.id,
      });
      return true;
    }
    emote(p, id) {
      if (!p || !p.alive) return false;
      const t = now();
      if (t < (p.commsUntil || 0)) return false;
      p.commsUntil = t + COMMS_GAP;
      this.pushEvent({ e: 'emote', id: String(id || 'gg').slice(0, 12), byId: p.id, by: p.name });
      return true;
    }

    roster() {
      return [...this.players.values()].map(p => ({
        id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths,
        weaponId: p.weaponId, skin: p.skin, cls: p.cls.name,
      }));
    }
    pushEvent(e) { this.events.push(e); if (this.events.length > 40) this.events.shift(); }

    /* ---------- simulation ---------- */
    /* ---------- starting the match ----------
       The clock is set here, not when the room was created, so the eight
       minutes are eight minutes of playing rather than eight minutes of
       waiting for a fourth player to load. */
    startMatch() {
      if (this.phase === 'live' || this.over) return false;
      this.phase = 'live';
      this.timeLeft = MATCH_SECONDS;
      this.broadcast({ t: 'start', mode: this.mode, timeLeft: MATCH_SECONDS, roster: this.roster() });
      return true;
    }

    /* Who is here, for the lobby. Sent whenever that changes rather than left
       to the next snapshot, so the list is right the instant someone joins. */
    pushLobby() {
      this.broadcast({
        t: 'lobby', phase: this.phase, roster: this.roster(),
        teams: this.teams, capacity: this.capacity, mode: this.mode,
      });
    }

    step(dt) {
      if (this.over || this.phase !== 'live') return;
      // the clock is wall-anchored (see the accessor above), so nothing to
      // decrement here — dt only moves players, rounds and captures

      for (const p of this.players.values()) {
        if (!p.alive) {
          if (now() >= p.respawnAt) this.respawn(p);
          continue;
        }
        // movement — the server decides where you are, not your client
        const i = p.input;
        // wire slows you and cuts you whether or not you are moving
        const hz = this.hazardAt(p.x, p.y);
        let dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
        let dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
        const m = Math.hypot(dx, dy);
        if (m > 0) {
          const spd = moveSpeedFor(p, i.ads)
            * surfaceSpeedFor(p, this.surfaceAt(p.x, p.y)) * (hz ? hz.slow : 1);
          /* Move, then get pushed back out of anything solid — the same
             resolution the client runs offline, so a player and the host
             agree about where a wall stopped them. Pushing out rather than
             refusing the step is what lets you slide along a wall instead of
             sticking to it; a step is a few pixels and the thinnest wall is
             8px, so you are always ejected back the way you came.

             Bounded by BODY_R, not by a hand-written 16. The client clamps to
             its own radius, and a room that stopped a pixel short of where the
             client did left a one-pixel argument running along all four edges
             for the reconciler to keep losing. */
          p.x = clamp(p.x + (dx / m) * spd * dt, BODY_R, this.map.w - BODY_R);
          p.y = clamp(p.y + (dy / m) * spd * dt, BODY_R, this.map.h - BODY_R);
          this.resolveWorld(p);
        }
        if (hz && hz.dps > 0) {
          p.wireAcc = (p.wireAcc || 0) + hz.dps * dt;
          // environmental: no hit-zone roll, no armour — the wire just cuts you
          if (p.wireAcc >= WIRE_CHUNK) { this.damage(p, p.wireAcc, 'true', null); p.wireAcc = 0; }
        }
        p.angle = i.angle;

        // adrenaline heals, and spends itself doing it
        if (p.adrenaline > 0) {
          const adr = C.adrenaline(p.adrenaline);
          if (p.hp < p.maxHp) {
            p.hp = Math.min(p.maxHp, p.hp + adr.regen * dt);
            p.adrenaline = Math.max(0, p.adrenaline - adr.burn * dt);
          } else p.adrenaline = Math.max(0, p.adrenaline - 1.5 * dt);
        }

        // firing
        p.fireCd -= dt * 1000;
        if (now() < p.reloadUntil) continue;
        /* A reload finishes here, not where it starts. Filling the magazine at
           the moment the reload began meant the ammo counter — which the
           client reads straight from the snapshot — snapped back to full
           immediately and then refused to fire for two seconds. */
        if (p.reloading) { p.ammo = p.weapon.mag; p.reloading = false; }
        if (p.ammo <= 0) { p.reloadUntil = now() + p.weapon.reloadMs; p.reloading = true; continue; }
        const wantsFire = i.shooting && (p.weapon.action === 'auto' || i.fireEdge);
        if (wantsFire && p.fireCd <= 0) this.fire(p);
      }

      this.stepBullets(dt);
      this.stepChains();
      if (this.mode === 'domination') this.stepObjectives(dt);
      if (this.timeLeft <= 0) this.finish();
    }

    /* ---------- domination ----------
       Same rules as the offline game (see updateObjectives in game.js): hold a
       point uncontested to take it, and every point you hold pays out. Run
       here rather than on each client, because a capture that only half the
       match agrees with is worse than no capture at all. */
    stepObjectives(dt) {
      for (const obj of this.objectives) {
        const counts = {};
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          if (dist2(p.x, p.y, obj.x, obj.y) < obj.r * obj.r) counts[p.team] = (counts[p.team] || 0) + 1;
        }
        const present = Object.keys(counts);
        if (present.length === 1) {
          const t = +present[0];
          if (obj.owner !== t) {
            obj.capTeam = t;
            obj.progress += 45 * dt * counts[t];
            if (obj.progress >= 100) {
              obj.progress = 100; obj.owner = t;
              this.pushEvent({ e: 'capture', name: obj.name, team: t });
            }
          }
        } else if (!present.length && obj.owner === -1) {
          obj.progress = Math.max(0, obj.progress - 20 * dt);
        }
        if (obj.owner >= 0) this.scores[obj.owner] += 4 * dt;
      }
      for (let t = 0; t < this.scores.length; t++) if (this.scores[t] >= SCORE_CAP) return this.finish();
    }

    fire(p) {
      const w = p.weapon;
      p.fireCd = w.fireInterval;
      p.ammo--;
      p.input.fireEdge = false;
      const cone = w.spreadBase * (p.input.ads ? w.adsMult : 1);
      for (let n = 0; n < (w.pellets || 1); n++) {
        const jitter = (Math.random() - 0.5) * cone * 2 + (Math.random() - 0.5) * (w.pelletSpread || 0) * 2;
        const ang = p.angle + jitter;
        this.bullets.push({
          x: p.x + Math.cos(ang) * 20, y: p.y + Math.sin(ang) * 20,
          vx: Math.cos(ang) * w.bulletSpeed, vy: Math.sin(ang) * w.bulletSpeed,
          sx: p.x, sy: p.y, dmg: w.damage, falloff: w.falloff, range: w.range,
          dmgType: w.dmgType, team: p.team, owner: p.id,
          /* Specialized ammo, mirroring game.js so an online round behaves the
             way the shooter's own screen showed it: a Tracer is fatter, an
             Anti-Tank punches through people, a Fuze flies on a timer rather
             than to its range. */
          hitR: w.hitboxMult || 1, fuze: w.fuze || 0, antiTank: !!w.antiTank,
          life: w.fuze ? w.fuze : Math.min(2.4, (w.range * 1.15) / w.bulletSpeed),
        });
      }
      // fired the last round: start the reload, and let step() fill it
      if (p.ammo <= 0) { p.reloadUntil = now() + w.reloadMs; p.reloading = true; }
    }

    stepBullets(dt) {
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        b.life -= dt;
        let dead = b.life <= 0;
        /* Same short-hop flight the client walks (see BULLET_STEP in game.js):
           a sniper round moves five body-widths in one tick, so testing only the
           end-of-tick position would let it pass through a player untouched —
           and here that would be an authoritative miss. */
        let remaining = dead ? 0 : dt;
        while (remaining > 1e-6) {
          const speed = Math.hypot(b.vx, b.vy) || 1;
          const hop = Math.min(remaining, BULLET_STEP / speed);
          remaining -= hop;
          b.px = b.x; b.py = b.y;                  // the face test needs where it came from
          b.x += b.vx * hop; b.y += b.vy * hop;
          if (b.x < 0 || b.y < 0 || b.x > this.map.w || b.y > this.map.h) { dead = true; break; }
          if (this.wallIndex && this.bulletVsWall(b)) { dead = true; break; }
          // a fuzed charge detonates on its timer, so it flies past people
          for (const p of (b.fuze ? [] : this.players.values())) {
            if (!p.alive || p.team === b.team) continue;
            const hitR = BODY_R * (b.hitR || 1);
            if (dist2(p.x, p.y, b.x, b.y) < hitR * hitR) {
              /* Anti-Tank isn't stopped by infantry: a flat 50 on the way
                 through, and it comes out an ordinary round. */
              if (b.antiTank) {
                this.damage(p, W.ANTI_TANK_PASSTHROUGH, 'normal', this.players.get(b.owner));
                b.antiTank = false; b.dmgType = 'normal';
                continue;
              }
              const travelled = Math.hypot(b.x - b.sx, b.y - b.sy);
              const start = (b.range || FALLOFF_STEP * 6) * FALLOFF_START;
              const steps = Math.max(0, travelled - start) / FALLOFF_STEP;
              const mult = Math.max(FALLOFF_MIN, 1 - b.falloff * steps);
              this.damage(p, b.dmg * mult, b.dmgType, this.players.get(b.owner));
              dead = true; break;
            }
          }
          if (dead) break;
        }
        if (dead) this.bullets.splice(i, 1);
      }
    }

    /* ---------- rounds against the map ----------
       Mirrors bulletVsWall() in game.js, minus the sparks: a wall either
       swallows the round, bleeds some damage off it, or lets it by. The room
       owns wall HP, so a wall coming down is broadcast rather than decided
       twice — otherwise two clients disagree about where the cover is. */
    bulletVsWall(b) {
      const arr = cellAt(this.wallIndex, b.x, b.y);
      let wall = null;
      if (arr) for (const s of arr) { if (!s.dead && s.mode !== 'through' && inRect(b.x, b.y, s)) { wall = s; break; } }
      if (!wall) { b.inWall = null; return false; }
      if (b.inWall === wall) return false;         // already dealt with on the way in
      b.inWall = wall;

      // only a round that out-ranks the wall's toughness chews into it
      const src = { kind: b.dmgType === 'heat' ? 'heat' : 'bullet', ap: b.dmgType === 'ap' };
      if (wall.hp !== Infinity && C.canDamageStructure(wall, src)) {
        wall.hp -= b.dmg;
        // credited to whoever fired, so shooting a barrel next to someone is a kill
        if (wall.hp <= 0) this.destroyWall(wall, this.players.get(b.owner));
      }
      if (wall.mode === 'stop') return true;
      if (wall.mode === 'pen') { b.dmg *= wall.keep; return b.dmg < 1; }
      // ricochet: bounce off whichever face the round crossed
      if (b.px === undefined ? wall.w < wall.h : (b.px < wall.x || b.px > wall.x + wall.w)) b.vx = -b.vx;
      else b.vy = -b.vy;
      b.dmg *= wall.keep;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      b.x += (b.vx / sp) * BULLET_STEP * 1.5; b.y += (b.vy / sp) * BULLET_STEP * 1.5;
      b.sx = b.x; b.sy = b.y;                      // falloff restarts from the bounce
      b.inWall = null;
      return b.dmg < 1;
    }

    /* ---------- doors ----------
       The one piece of geometry that moves during a match, and until now the
       room never heard about it. The world is handed over once, with every
       door shut, so a player who opened one walked through it on their own
       screen and into a wall the room still believed in — and got dragged back
       into the doorway. On a map whose capture points are *inside* buildings,
       that is most of the rubber-banding people actually notice.

       Owned here so both sides agree, and so a round can be fired through a
       door someone else left open. */
    toggleDoor(p, id, open) {
      if (!this.wallById) return false;
      const w = this.wallById.get(id);
      if (!w || w.dead || !w.door) return false;
      // you have to be standing at it — a client can't open a door across the map
      const cx = clamp(p.x, w.x, w.x + w.w), cy = clamp(p.y, w.y, w.y + w.h);
      if (dist2(p.x, p.y, cx, cy) > DOOR_REACH * DOOR_REACH) return false;
      const want = open === undefined ? !w.open : !!open;
      if (want === w.open) return false;
      w.open = want;
      w.solid = want ? false : w.baseSolid;
      w.mode = want ? 'through' : w.baseMode;
      this.pushEvent({ e: 'door', id, open: want });
      return true;
    }
    openDoors() { return this.walls.filter(w => w.door && w.open).map(w => w.id); }

    destroyWall(wall, killer) {
      if (wall.dead) return;
      wall.dead = true;
      this.downed.push(wall.id);
      this.pushEvent({ e: 'wall', id: wall.id });
      // an oil drum doesn't just stop being cover
      if (wall.explodes) this.cookOff(wall, killer);
    }

    /* ---------- things that go off ----------
       Mirrors cookOff() in game.js. Claim the neighbours *before* the blast,
       because the blast destroys them and gathering them afterwards finds
       nothing — which is how a row of barrels used to vanish silently instead
       of chaining. */
    cookOff(wall, killer) {
      const x = wall.x + wall.w / 2, y = wall.y + wall.h / 2;
      const conf = wall.explodes;
      const chain = [];
      for (const s of nearRects(this.wallIndex, x, y, conf.radius)) {
        if (s === wall || s.cooking || !s.explodes) continue;
        const sx = s.x + s.w / 2, sy = s.y + s.h / 2;
        if (dist2(sx, sy, x, y) > conf.radius * conf.radius) continue;
        s.cooking = true;                    // stops destroyWall double-firing it
        chain.push(s);
      }
      this.explode(x, y, conf.damage, conf.radius, -1, killer || null, 'explosive');
      for (const s of chain) {
        this.chains.push({ wall: s, at: now() + CHAIN_MIN + Math.random() * CHAIN_JITTER, killer });
      }
    }
    stepChains() {
      if (!this.chains.length) return;
      const t = now();
      for (let i = this.chains.length - 1; i >= 0; i--) {
        if (t < this.chains[i].at) continue;
        const c = this.chains.splice(i, 1)[0];
        if (!c.wall.dead) this.destroyWall(c.wall, c.killer);
      }
    }

    /* One blast: everyone near it, and the cover around it. Same shape as
       explode() in game.js — linear falloff to the edge, half damage to your
       own squad, and splash always counts as a body hit so a grenade can't
       roll a lucky headshot. The event is what lets every client draw the
       fireball in the same place. */
    explode(x, y, baseDmg, radius, team, owner, type) {
      this.pushEvent({ e: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(radius) });
      if (!radius) return;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d >= radius) continue;
        const dmg = baseDmg * (1 - d / radius) * (p.team === team ? 0.5 : 1);
        if (dmg > 1) this.damage(p, dmg, type || 'explosive', owner, 'body');
      }
      // blasts tear up cover too — that's how you make an entry point
      if (!this.wallIndex) return;
      const src = { kind: type === 'heat' ? 'heat' : 'explosive' };
      for (const s of nearRects(this.wallIndex, x, y, radius)) {
        if (s.hp === Infinity || !C.canDamageStructure(s, src)) continue;
        const cx = clamp(x, s.x, s.x + s.w), cy = clamp(y, s.y, s.y + s.h);
        const d = Math.hypot(cx - x, cy - y);
        if (d >= radius) continue;
        s.hp -= baseDmg * (1 - d / radius) * 1.5;
        if (s.hp <= 0) this.destroyWall(s, owner);
      }
    }

    /* the same calculator the client uses */
    damage(target, raw, type, attacker, zone) {
      /* Dug in: infantry in a trench dodge half of what comes at them. Rolled
         before the calculator, exactly as applyDamage() does offline — a dodge
         is the hit not landing, not a hit for less. */
      if (type !== 'true') {
        const dodge = this.trenchDodge(target.x, target.y);
        if (dodge > 0 && Math.random() < dodge) return;
      }
      const hit = C.resolve({ damage: raw, type, zone }, target);
      if (hit.damage <= 0) return;
      target.hp -= hit.damage;
      if (target.hp <= 0) {
        target.hp = 0; target.alive = false; target.deaths++;
        target.respawnAt = now() + 3000;
        if (attacker) attacker.kills++;
        this.pushEvent({
          e: 'kill', by: attacker ? attacker.name : 'the world',
          byId: attacker ? attacker.id : null, victim: target.name, victimId: target.id,
          zone: hit.zone,
        });
      }
    }

    respawn(p) {
      const s = this.spawnPoint(p.team);
      p.x = s.x; p.y = s.y; p.hp = p.maxHp; p.alive = true;
      p.ammo = p.weapon.mag; p.reloadUntil = 0; p.reloading = false; p.adrenaline = 0;
      p.wireAcc = 0;             // don't carry a part-finished wire cut into the next life
    }

    snapshot() {
      return {
        t: 'snapshot', tick: this.tick++, time: now(), timeLeft: Math.max(0, Math.round(this.timeLeft)),
        agents: [...this.players.values()].map(p => ({
          id: p.id, x: Math.round(p.x), y: Math.round(p.y),
          angle: +p.angle.toFixed(3), hp: Math.round(p.hp), alive: p.alive,
          team: p.team, name: p.name, ammo: p.ammo, adrenaline: Math.round(p.adrenaline),
          vest: p.vest, helmet: p.helmet, bag: p.bag, weaponId: p.weaponId, skin: p.skin,
          kills: p.kills, deaths: p.deaths,
          // seconds until this one is back on their feet, for the HUD
          respawn: p.alive ? 0 : Math.max(0, Math.ceil((p.respawnAt - now()) / 1000)),
        })),
        /* Rounds in flight. `o` is who fired it, so a client can skip its own
           (it drew those the moment it pulled the trigger) and `a` is the
           heading, so the tracer can be drawn pointing the right way rather
           than as a dot. */
        bullets: this.bullets.slice(0, 120).map(b => ({
          x: Math.round(b.x), y: Math.round(b.y), team: b.team, o: b.owner,
          a: +Math.atan2(b.vy, b.vx).toFixed(2),
        })),
        // capture points, in the order the client generated them
        objectives: this.objectives.map(o => ({ o: o.owner, p: Math.round(o.progress), c: o.capTeam })),
        scores: this.scores.map(s => Math.round(s)),
        events: this.events.splice(0, this.events.length),
      };
    }

    broadcast(msg) {
      for (const p of this.players.values()) p.send(msg);
    }

    finish() {
      if (this.over) return;
      this.over = true;
      const scores = {};
      // domination is won on ground held; elimination on kills
      if (this.mode === 'domination' && this.objectives.length) {
        this.scores.forEach((s, t) => { scores[t] = Math.round(s); });
      } else {
        for (const p of this.players.values()) scores[p.team] = (scores[p.team] || 0) + p.kills;
      }
      this.broadcast({ t: 'end', scores, roster: this.roster() });
    }
  }
  return { Room, MAP_SIZES, TICK, ROOM_MAX, MATCH_SECONDS, moveSpeedFor, surfaceSpeedFor, BODY_R };
}));
