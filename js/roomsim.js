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
  let W, C, K, I, PERK, FALLOFF_STEP;
  function deps() {
    if (W) return;
    if (typeof Weapons !== 'undefined') { W = Weapons; C = Combat; K = Classes; I = Items; }
    else {
      const s = require('./_shared');
      W = s.Weapons; C = s.Combat; K = s.Classes; I = s.Items;
    }
    PERK = (typeof Perks !== 'undefined') ? Perks : require('./perks');
    FALLOFF_STEP = W.TILE * 4;
  }
  const PK = () => { deps(); return PERK; };

  const TICK = 1000 / 20;              // snapshot rate
  /* The client renders in these dimensions, so the simulation has to use them
     too. They were 3400x2300 here and 6400x6400 there, which meant an online
     match was simulated in one coordinate space and drawn in another. */
  /* The board each mode is fought over.

     Grown by a little under a fifth on each side. The buildings got bigger and
     there are more of them that a map is required to have — the four you can
     drive into were added to that list — and the ground did not grow with
     them. Measured over five generated maps, four came up short of the houses
     the design table asks for, because the required buildings, the four team
     bases and the three landmarks no longer fit on a 6400px board with room
     to walk between them. Everything scattered on the map is placed per unit
     of area, so cover, props and loot scale with this by themselves. */
  const MAP_SIZES = { domination: { w: 7400, h: 7400 }, elimination: { w: 5200, h: 5200 } };
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
  const CHANNEL_SLOW = 0.4;            // how much a heal in progress slows you
  const DROP_LIFE = 90;                // seconds a dropped stack survives
  const CRATE_REACH = 120;             // how close you must be to open a crate
  const MAX_VEHICLES = 24;             // a battlefield, not a car park
  /* How far away the scenery still gets sent. Generous enough to cover the
     widest zoom with margin — see cullTo(). */
  const CULL_R = 2200;

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
    /* Weight Lifter hands back part of what the gun's weight took. The weapon
       table derives moveSpeed as WEIGHT_FREE minus a penalty, so the penalty
       is the gap up to it — give back 30% of that rather than 30% of the
       speed, which is what "-30% weight debuff" means. */
    let base = p.weapon.moveSpeed;
    const relief = PK().mod(p, 'weightRelief', 0);
    if (relief > 0) base = Math.min(W.WEIGHT_FREE, base + (W.WEIGHT_FREE - base) * relief);

    let spd = base * p.cls.speed * C.armorSpeed(p)
      * C.adrenaline(p.adrenaline, p.perk).speed
      * PK().mod(p, 'speedMult', 1);            // Jogger, flat and always on
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

  /* ---------- what you are carrying ----------
     Mirrors the kit game.js hands you at spawn: your class's consumable in
     whichever of the three slots it belongs to, plus a couple of bandages so
     nobody deploys with no way to heal. Held by the room because the room is
     what spends it — a client that thinks it still has a grenade cannot throw
     one that has already been thrown. */
  function startingInv(cls) {
    deps();
    const inv = {
      grenade: { id: null, n: 0 },
      tactical: { id: null, n: 0 },
      heal: { id: null, n: 0 },
      tokens: [],
    };
    const kit = I.CONSUMABLES[cls.consumable];
    if (kit) inv[kit.cat] = { id: cls.consumable, n: K.startFor(cls, 0) };
    if (kit && kit.cat !== 'heal') inv.heal = { id: 'bandage', n: 2 };
    return inv;
  }
  /* A Mule counts as wearing one bag better than they are, exactly as
     carryTier() does on the client. */
  const carryTier = (p) => Math.min(3, (p.bag || 0) + (p.perk === 'mule' ? 1 : 0));
  /* Put `n` of something into a slot, returning what wouldn't fit. Swapping an
     occupied slot for a different item drops the old contents rather than
     binning them, which is what the client does too. */
  function addItem(room, p, cat, id, n) {
    const slot = p.inv[cat];
    if (!slot) return n;
    const cap = K.limitFor(p.cls, id, carryTier(p));
    if (slot.id && slot.id !== id && slot.n > 0) {
      if (room) room.dropItem(cat, slot.id, slot.n, p);
      slot.n = 0;
    }
    slot.id = id;
    const taken = Math.min(Math.max(0, cap - (slot.n || 0)), n);
    slot.n = (slot.n || 0) + taken;
    const over = n - taken;
    if (over > 0 && room) room.dropItem(cat, id, over, p);
    return over;
  }
  const spend = (slot) => { slot.n--; if (slot.n <= 0) { slot.n = 0; slot.id = null; } };

  /* ---------- vehicles ----------
     The same two the client draws (see VEHICLES in game.js). Their toughness
     is not a bigger health bar, it is the damage-type table in combat.js: a
     rifle round does 0% to a tank. */
  const VEHICLES = {
    jeep: { vtype: 'jeep', klass: 'jeep', weapon: 'm249', r: 29, speed: 175 },
    tank: { vtype: 'tank', klass: 'tank', weapon: 'qlz-87', r: 34, speed: 110 },
  };

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
      /* ---------- everything else that is in the world ----------
         These used to live only on each client, which meant that online they
         were either inert or a lie. A thrown grenade harmed nobody, because the
         only agent in a guest's local world is the guest. A vest picked up off
         the floor was overwritten by the next snapshot. A sentry shot at
         nothing. Whatever decides a fight has to be here or two people are
         playing different matches. */
      this.grenades = [];                // in flight or ticking down
      this.deployables = [];             // mines, sentries, barricades, ammo boxes, flags
      this.drops = [];                   // loot on the ground
      this.smokes = [];                  // sight blockers
      this.vehicles = [];                // jeeps and tanks, driven or parked
      this.crates = [];                  // loot crates, by index, opened once each
      this.nextEnt = 1;                  // ids for all of the above
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
        /* Whether you can see over it. A flashbang has to be stopped by a wall
           and a sentry must not shoot through one, and both of those are the
           room's calls now, so "high" has to travel with the rect. */
        tall: !!r.tall,
        /* A door is the one wall that changes its mind. Remember what it is
           when shut, so opening and closing it is reversible. */
        door: !!r.door, open: false, baseSolid: !!r.solid, baseMode: r.mode || 'stop',
      }));
      /* Loot crates, by index — the client generated them in this order, so an
         index is a name both ends agree on, exactly as with the walls. */
      const cr = (!Array.isArray(world) && world && world.crates) || null;
      if (cr) {
        this.crates = cr.map(c => ({
          x: c.x, y: c.y, tier: c.tier || 'regular', needs: c.needs || null, opened: false,
        }));
      }
      /* The hulls the map came with. Parked, unclaimed, and belonging to
         whoever reaches one first — spawned here rather than by a call-in
         token, because they are part of the world rather than something a
         player brought to it. Only on the first hand-over: re-publishing the
         world mid-match must not repopulate a car park people have emptied. */
      const cars = (!Array.isArray(world) && world && world.vehicles) || null;
      if (cars && !this.parked) {
        this.parked = true;
        for (const c of cars) this.spawnVehicle(c.vtype, c.x, c.y, -1);
      }
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

    /* ---------- taking one input packet ----------
       Lives here rather than being copied into js/p2p.js and
       server/server.js, which had already drifted apart once.

       `seq` is the sync fix. The client numbers every packet it sends and we
       remember the highest we have acted on; it goes back in that player's
       snapshot as `ack`. Their reconciler then replays exactly the packets we
       have not seen, instead of everything sent in the last half-ping — which
       was an estimate, was wrong whenever the connection wobbled, and put the
       predicted position a little ahead of or behind the truth every single
       frame. */
    applyInput(p, msg) {
      if (!p) return;
      const i = p.input;
      i.up = !!msg.up; i.down = !!msg.down; i.left = !!msg.left; i.right = !!msg.right;
      i.shooting = !!msg.shooting; i.ads = !!msg.ads;
      if (msg.fire) i.fireEdge = true;
      if (typeof msg.angle === 'number') i.angle = msg.angle;
      // packets can overtake each other on an unordered channel; never go back
      if (typeof msg.seq === 'number' && msg.seq > p.seq) p.seq = msg.seq;
      p.lastSeen = now();
    }
    reload(p) {
      if (!p || !p.alive) return false;
      /* The magazine fills when the reload *ends* — step() does that. Filling
         it here made the ammo counter, which the client reads straight out of
         the snapshot, snap to full and then refuse to fire for two seconds. */
      if (now() < p.reloadUntil || p.ammo >= p.weapon.mag) return false;
      p.reloadUntil = now() + this.reloadMs(p);
      p.reloading = true;
      return true;
    }
    /* Adren%/2 reload speedup, and a quarter off again for Quick Hands — the
       same two terms startReload() applies on the client. The room used to
       charge everyone the flat table figure, so a Quick Hands player watched
       their own reload finish and then stood there unable to fire. */
    reloadMs(p) {
      return p.weapon.reloadMs / C.adrenaline(p.adrenaline, p.perk).reload
        * (p.perk === 'quickhands' ? 0.75 : 1);
    }

    /* ================= CONSUMABLES =================
       Throwing, deploying, drinking. All three follow the same shape: check
       the player really has one, spend it here, and put the resulting entity
       in the room's own list. Nothing about the item comes over the wire
       except which slot to use — the stats are read from the shared table, so
       a modified client can ask to throw a frag but not to throw a frag with
       a 900px blast. */

    /* Toward a point, capped at the item's range. The room re-caps rather than
       trusting the client's target, which is the difference between a grenade
       and a guided missile. */
    throwItem(p, tx, ty) {
      if (!p || !p.alive || p.riding) return false;
      const slot = p.inv.grenade;
      if (!slot || !slot.id || slot.n <= 0) return false;
      const it = I.CONSUMABLES[slot.id];
      if (!it || it.cat !== 'grenade') return false;
      let dx = (+tx || 0) - p.x, dy = (+ty || 0) - p.y;
      const d = Math.hypot(dx, dy) || 1;
      // a Grenade Launcher throws them further and flatter
      const range = (it.throwRange || 520) * (p.weapon.launchGrenades ? 1.9 : 1);
      const dist = Math.min(d, range);
      this.grenades.push({
        id: this.nextEnt++, kind: slot.id, mode: it.mode, item: it,
        x: p.x, y: p.y, tx: p.x + (dx / d) * dist, ty: p.y + (dy / d) * dist,
        vx: (dx / d) * 660, vy: (dy / d) * 660,
        team: p.team, owner: p.id, arrived: false, fuzeLeft: it.fuze || 0,
      });
      spend(slot);
      this.pushEvent({ e: 'throw', id: p.id, kind: slot.id });
      return true;
    }

    /* Deployed where you stand (or just in front, for a barricade). */
    deploy(p) {
      if (!p || !p.alive || p.riding) return false;
      const slot = p.inv.tactical;
      if (!slot || !slot.id || slot.n <= 0) return false;
      const it = I.CONSUMABLES[slot.id];
      if (!it || it.cat !== 'tactical') return false;
      const base = {
        id: this.nextEnt++, kind: slot.id, mode: it.mode, item: it,
        x: p.x, y: p.y, team: p.team, owner: p.id, life: it.life || 60,
      };
      if (it.mode === 'mine') Object.assign(base, { arm: it.arm });
      else if (it.mode === 'ammo') Object.assign(base, { supply: it.supply });
      else if (it.mode === 'sentry') Object.assign(base, { hp: it.hp, maxHp: it.hp, angle: p.angle, cd: 0 });
      else if (it.mode === 'wall') {
        /* A barricade is a wall, so it has to join the geometry rather than sit
           beside it — otherwise the room lets people walk through the thing
           every client is drawing as cover. It gets a wall id like any other so
           "that one came down" is the same message it always was. */
        const wx = p.x + Math.cos(p.angle) * 42, wy = p.y + Math.sin(p.angle) * 42;
        const horizontal = Math.abs(Math.cos(p.angle)) < 0.707;
        const w = horizontal ? it.w : 22, h = horizontal ? 22 : it.w;
        const rect = {
          id: 100000 + this.nextEnt++, x: wx - w / 2, y: wy - h / 2, w, h,
          solid: true, mode: 'pen', keep: 0.5, hp: 150, type: 'barricade', toughness: 1,
          dead: false, slow: 0, dps: 0, explodes: null,
          door: false, open: false, baseSolid: true, baseMode: 'pen',
          temporary: true,
        };
        base.rect = rect;
        this.addWall(rect);
      }
      this.deployables.push(base);
      spend(slot);
      this.pushEvent({ e: 'deploy', id: p.id, kind: base.kind, x: Math.round(base.x), y: Math.round(base.y) });
      return true;
    }

    /* Walls that appear mid-match — a deployed barricade, and nothing else so
       far. The index is built once from the world, so a new rect has to be
       filed into it by hand or bullets and bodies pass straight through. */
    addWall(rect) {
      if (!this.wallIndex) return;
      this.walls.push(rect);
      this.wallById.set(rect.id, rect);
      addToIndex(this.wallIndex, rect);
    }

    /* Heals are channelled: you stand still-ish and vulnerable for a few
       seconds and it lands at the end. The room runs the clock, so being shot
       mid-drink is decided in one place. */
    heal(p) {
      if (!p || !p.alive || p.riding || p.channel) return false;
      const slot = p.inv.heal;
      if (!slot || !slot.id || slot.n <= 0) return false;
      const it = I.CONSUMABLES[slot.id];
      if (!it || it.cat !== 'heal') return false;
      p.channel = { id: slot.id, left: it.time, total: it.time };
      spend(slot);
      this.pushEvent({ e: 'channel', id: p.id, kind: p.channel.id, time: it.time });
      return true;
    }
    cancelChannel(p) {
      if (!p || !p.channel) return;
      p.channel = null;
      this.pushEvent({ e: 'channelEnd', id: p.id });
    }
    finishChannel(p) {
      const it = I.CONSUMABLES[p.channel.id];
      p.channel = null;
      if (!it) return;
      if (it.hp) p.hp = Math.min(p.maxHp, p.hp + it.hp);
      // stacking past 100 is the point of the top adrenaline band
      if (it.adr) p.adrenaline = Math.min(C.ADREN_MAX, p.adrenaline + it.adr);
      if (it.revive) this.reviveNear(p);
      this.pushEvent({ e: 'channelEnd', id: p.id, used: it.name });
    }
    reviveNear(p) {
      for (const o of this.players.values()) {
        if (o.alive || o.id === p.id || o.team !== p.team) continue;
        if (dist2(o.x, o.y, p.x, p.y) > 150 * 150) continue;
        o.alive = true; o.hp = o.maxHp * 0.5; o.ammo = o.weapon.mag;
        o.x = p.x + (Math.random() * 60 - 30); o.y = p.y + (Math.random() * 60 - 30);
        this.resolveWorld(o);
        this.pushEvent({ e: 'revive', id: o.id, by: p.name });
        return true;
      }
      return false;
    }

    /* ================= LOOT ================= */
    dropItem(cat, id, n, at) {
      if (!id || n <= 0) return;
      const a = Math.random() * Math.PI * 2, d = 18 + Math.random() * 22;
      const x = clamp((at.x || 0) + Math.cos(a) * d, 20, this.map.w - 20);
      const y = clamp((at.y || 0) + Math.sin(a) * d, 20, this.map.h - 20);
      // merge into a nearby identical pile rather than littering the floor
      for (const dr of this.drops) {
        if (dr.id === id && dist2(dr.x, dr.y, x, y) < 100 * 100) { dr.n += n; dr.life = DROP_LIFE; return; }
      }
      this.drops.push({ id: this.nextEnt++, x: Math.round(x), y: Math.round(y), cat, kind: id, n, life: DROP_LIFE });
    }
    /* A broken crate scatters what a crate of that tier would have held.
       Rolled here, not on the client: two people opening the same crate have
       to get the same thing out of it, and only one of them may have it. */
    spillLoot(x, y, tier) {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const entry = I.rollLoot(tier);
        let id = entry.id;
        if (id === 'classConsumable') id = I.randomClassConsumable();
        // ground drops are consumables only — armour and guns come from crates
        if (id === 'ammo' || id === 'legendary' || id === 'jeep' || id === 'tank'
          || id.indexOf('armor') === 0) id = 'bandage';
        const it = I.CONSUMABLES[id];
        if (it) this.dropItem(it.cat, id, 1, { x, y });
      }
    }
    /* Pick up the nearest pile. The room decides who got there first, which is
       the whole reason this cannot stay on the client. */
    grab(p) {
      if (!p || !p.alive || p.riding) return false;
      let best = null, bd = 78 * 78, bi = -1;
      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        const dd = dist2(p.x, p.y, d.x, d.y);
        if (dd < bd) { bd = dd; best = d; bi = i; }
      }
      if (!best) return false;
      const cap = K.limitFor(p.cls, best.kind, carryTier(p));
      const slot = p.inv[best.cat];
      if (slot && slot.id === best.kind && slot.n >= cap) return false;    // already full of it
      this.drops.splice(bi, 1);
      addItem(this, p, best.cat, best.kind, best.n);
      this.pushEvent({ e: 'pickup', id: p.id, kind: best.kind, n: best.n, drop: best.id });
      return true;
    }
    /* Opening a crate. It has to be in reach, and it can only be opened once —
       which is the whole reason this cannot stay on the client. Two people
       walking up to the same gold crate both used to get a legendary out of it. */
    openCrate(p, idx) {
      if (!p || !p.alive) return false;
      const c = this.crates[idx | 0];
      if (!c || c.opened) return false;
      if (dist2(p.x, p.y, c.x, c.y) > CRATE_REACH * CRATE_REACH) return false;
      // some crates are gated behind a perk — a Swimming Pool wants a Diver
      if (c.needs && p.perk !== c.needs) return false;
      c.opened = true;
      this.grantLoot(p, I.rollLoot(c.tier));
      // a Scavenger finds the thing at the bottom of the box
      if (p.perk === 'scavenger') this.grantLoot(p, I.rollLoot(c.tier));
      this.pushEvent({ e: 'crate', i: idx | 0, by: p.id });
      return true;
    }
    /* One roll from a crate table, applied. Mirrors grantLoot() in game.js. */
    grantLoot(p, entry) {
      switch (entry.id) {
        case 'ammo':
          p.ammo = p.weapon.mag;
          addItem(this, p, 'grenade', p.inv.grenade.id || 'frag', 1);
          break;
        case 'classConsumable': {
          const cid = I.classConsumableFor(p.cls.name);
          const it = I.CONSUMABLES[cid];
          if (it) addItem(this, p, it.cat, cid, 2);
          break;
        }
        case 'legendary': {
          const gold = I.makeLegendary(I.bestOfClass(p.cls.name));
          p.weapon = gold; p.weaponId = gold.id; p.ammo = gold.mag;
          p.reloadUntil = 0; p.reloading = false;
          this.pushEvent({ e: 'legendary', id: p.id, weapon: gold.id, name: gold.name });
          break;
        }
        case 'armorT1': case 'armorT2': case 'armorT3': {
          const tier = +entry.id.slice(-1);
          // upgrade whichever of the three pieces is furthest behind
          const slots = [
            { k: 'vest', v: p.vest || 0 }, { k: 'helmet', v: p.helmet || 0 }, { k: 'bag', v: p.bag || 0 },
          ].sort((a, b) => a.v - b.v);
          const k = slots[0].k;
          if (p[k] < tier) p[k] = tier;
          break;
        }
        case 'jeep': case 'tank':
          if (p.inv.tokens.length < 4) p.inv.tokens.push(entry.id);
          break;
        default: {
          const it = I.CONSUMABLES[entry.id];
          if (it) addItem(this, p, it.cat, entry.id, 1);
        }
      }
      this.pushEvent({ e: 'loot', id: p.id, got: entry.id, label: entry.label });
    }

    /* ================= VEHICLES ================= */
    /* Spawned by a call-in token, or parked on the map at generation. A
       vehicle is a body with its own hit-point pool and armour class — small
       arms bounce off a tank because of Combat.TARGETS, not because of HP. */
    spawnVehicle(vtype, x, y, team) {
      /* A ceiling, because every hull is a body in the snapshot for everyone
         near it. The oldest one nobody is driving makes way. */
      if (this.vehicles.length >= MAX_VEHICLES) {
        const i = this.vehicles.findIndex(v => !v.driver);
        if (i < 0) return null;
        this.pushEvent({ e: 'wreck', id: this.vehicles[i].id });
        this.vehicles.splice(i, 1);
      }
      const conf = VEHICLES[vtype] || VEHICLES.jeep;
      const weapon = W.byId[conf.weapon] || W.byId[W.default];
      const v = {
        id: this.nextEnt++, vtype: conf.vtype, klass: conf.klass,
        x: clamp(x, 60, this.map.w - 60), y: clamp(y, 60, this.map.h - 60),
        angle: 0, r: conf.r, speed: conf.speed,
        hp: C.maxHpFor(conf.klass), maxHp: C.maxHpFor(conf.klass),
        team: team === undefined ? -1 : team,
        weapon, ammo: weapon.mag, fireCd: 0, reloadUntil: 0, reloading: false,
        driver: null, alive: true,
      };
      this.vehicles.push(v);
      this.pushEvent({ e: 'vehicle', id: v.id, vtype: v.vtype, x: Math.round(v.x), y: Math.round(v.y) });
      return v;
    }
    callVehicle(p, tx, ty) {
      if (!p || !p.alive || !p.inv.tokens.length) return false;
      const vtype = p.inv.tokens.shift();
      // called in near the cursor, but not across the map from you
      let dx = (+tx || p.x) - p.x, dy = (+ty || p.y) - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const dist = Math.min(d, 900);
      this.spawnVehicle(vtype, p.x + (dx / d) * dist, p.y + (dy / d) * dist, p.team);
      return true;
    }
    /* Getting in and out. An unclaimed vehicle belongs to whoever reaches it. */
    useVehicle(p) {
      if (!p || !p.alive) return false;
      if (p.riding) {
        const v = p.riding;
        v.driver = null; p.riding = null;
        p.x = v.x + Math.cos(v.angle + Math.PI / 2) * (v.r + BODY_R + 6);
        p.y = v.y + Math.sin(v.angle + Math.PI / 2) * (v.r + BODY_R + 6);
        this.resolveWorld(p);
        this.pushEvent({ e: 'ride', id: p.id, vehicle: v.id, on: false });
        return true;
      }
      for (const v of this.vehicles) {
        if (!v.alive || v.driver) continue;
        if (v.team >= 0 && v.team !== p.team) continue;
        if (dist2(p.x, p.y, v.x, v.y) > (v.r + 70) ** 2) continue;
        v.driver = p.id; v.team = p.team; p.riding = v;
        this.pushEvent({ e: 'ride', id: p.id, vehicle: v.id, on: true });
        return true;
      }
      return false;
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
      const perk = (info.perk && String(info.perk).slice(0, 16)) || 'none';
      const built = (info.attachments || info.ammo)
        ? W.configure(base, { attachments: info.attachments, ammo: info.ammo })
        : base;
      // Bullet Strap rewrites the magazine, so it has to be applied here as
      // well as on the client or the two disagree about how many rounds you have
      const weapon = PK().applyToWeapon(built, perk);
      const cls = K.forWeapon(weapon);
      // a party is handed a team so it stays together; otherwise the smallest
      // team wins the new player, keeping squads even
      let team = forceTeam;
      if (team === undefined || team < 0 || team >= this.teams) team = this.freeTeam(1);

      const spawn = this.spawnPoint(team);
      const p = {
        id, send, name: (info.name || 'Operator').slice(0, 16), team,
        x: spawn.x, y: spawn.y, angle: 0,
        hp: C.maxHpFor('infantry', perk), maxHp: C.maxHpFor('infantry', perk),
        klass: 'infantry', vest: 0, helmet: 0, bag: 0, adrenaline: 0,
        /* The perk changes numbers the client computes for itself — swim
           speed, armour weight, magazine size, max HP — so the room has to
           hold the same one or the two drift apart. */
        perk,
        weaponId: weapon.id, weapon, cls,
        ammo: weapon.mag, reloadUntil: 0, fireCd: 0,
        alive: true, respawnAt: 0, kills: 0, deaths: 0,
        skin: info.skin || 'default',
        input: { up: false, down: false, left: false, right: false, shooting: false, ads: false, angle: 0 },
        /* The last input packet we have applied from this player. It goes back
           out in their snapshot so they can replay exactly the inputs we have
           not seen yet, instead of guessing the window from half their ping —
           see reconcile() in game.js. */
        seq: 0,
        /* What they are carrying. Built here from their class, exactly as
           game.js builds it at spawn, because from here on the room is the one
           spending it: a grenade you have already thrown cannot be thrown again
           by a client that decided it still had one. */
        inv: startingInv(cls),
        channel: null,                   // a heal being drunk, with its clock
        riding: null,                    // the vehicle they are driving, if any
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
        // crates other people have already emptied, so you don't walk across
        // the map for one that has nothing in it
        opened: this.crates.map((c, i) => (c.opened ? i : -1)).filter(i => i >= 0),
        you: this.personal(p),
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
        const i = p.input;
        /* Behind the wheel the whole control scheme changes hands: the vehicle
           moves, aims and shoots, and the player rides along inside it. */
        if (p.riding) { this.driveVehicle(p, p.riding, dt); continue; }

        /* A heal is a channel — you are stuck drinking it, slowed and unable
           to shoot, and it lands at the end. Moving doesn't cancel it, being
           dead does (see damage). */
        if (p.channel) {
          p.channel.left -= dt;
          if (p.channel.left <= 0) this.finishChannel(p);
        }

        // movement — the server decides where you are, not your client
        // wire slows you and cuts you whether or not you are moving
        const hz = this.hazardAt(p.x, p.y);
        let dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
        let dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
        const m = Math.hypot(dx, dy);
        if (m > 0) {
          const spd = moveSpeedFor(p, i.ads)
            * surfaceSpeedFor(p, this.surfaceAt(p.x, p.y))
            * ((hz && !Perks.mod(p, 'ignoreHazardSlow')) ? hz.slow : 1)
            * (p.channel ? CHANNEL_SLOW : 1);
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
          const adr = C.adrenaline(p.adrenaline, p.perk);
          if (p.hp < p.maxHp) {
            p.hp = Math.min(p.maxHp, p.hp + adr.regen * dt);
            p.adrenaline = Math.max(0, p.adrenaline - adr.burn * dt);
          } else p.adrenaline = Math.max(0, p.adrenaline - 1.5 * dt);
        }

        // firing — not while you have a bottle to your lips
        p.fireCd -= dt * 1000;
        if (p.channel) continue;
        if (now() < p.reloadUntil) continue;
        /* A reload finishes here, not where it starts. Filling the magazine at
           the moment the reload began meant the ammo counter — which the
           client reads straight from the snapshot — snapped back to full
           immediately and then refused to fire for two seconds. */
        if (p.reloading) { p.ammo = p.weapon.mag; p.reloading = false; }
        if (p.ammo <= 0) { p.reloadUntil = now() + this.reloadMs(p); p.reloading = true; continue; }
        const wantsFire = i.shooting && (p.weapon.action === 'auto' || i.fireEdge);
        if (wantsFire && p.fireCd <= 0) this.fire(p);
      }

      this.stepBullets(dt);
      this.stepChains();
      this.stepGrenades(dt);
      this.stepDeployables(dt);
      this.stepVehicles(dt);
      this.stepDecay(dt);
      if (this.mode === 'domination') this.stepObjectives(dt);
      if (this.timeLeft <= 0) this.finish();
    }

    /* ---------- thrown things ----------
       Mirrors updateGrenades() in game.js: they fly to where they were aimed,
       then either go off on contact (impact) or run their fuse down. */
    stepGrenades(dt) {
      for (let i = this.grenades.length - 1; i >= 0; i--) {
        const g = this.grenades[i];
        if (!g.arrived) {
          const dx = g.tx - g.x, dy = g.ty - g.y;
          const dd = Math.hypot(dx, dy), step = 660 * dt;
          if (g.mode === 'impact' && (this.solidAt(g.x, g.y) || this.enemyNear(g, 21))) {
            this.detonate(g); this.grenades.splice(i, 1); continue;
          }
          if (dd <= step) { g.x = g.tx; g.y = g.ty; g.arrived = true; }
          else { g.x += g.vx * dt; g.y += g.vy * dt; }
        } else {
          if (g.mode === 'impact') { this.detonate(g); this.grenades.splice(i, 1); continue; }
          g.fuzeLeft -= dt;
          if (g.fuzeLeft <= 0) { this.detonate(g); this.grenades.splice(i, 1); }
        }
      }
    }
    solidAt(x, y) {
      if (!this.wallIndex) return false;
      const arr = cellAt(this.wallIndex, x, y);
      if (!arr) return false;
      for (const s of arr) if (!s.dead && s.solid && inRect(x, y, s)) return true;
      return false;
    }
    enemyNear(g, r) {
      for (const p of this.players.values()) {
        if (!p.alive || p.team === g.team || p.riding) continue;
        if (dist2(p.x, p.y, g.x, g.y) < (BODY_R + r) ** 2) return true;
      }
      return false;
    }
    detonate(g) {
      const it = g.item;
      const owner = this.players.get(g.owner);
      if (g.mode === 'fuze' || g.mode === 'impact' || g.mode === 'c4') {
        // C4 is the demolition charge — it opens what ordinary explosives can't
        this.explode(g.x, g.y, it.damage, it.radius, g.team, owner, 'explosive', g.mode === 'c4' ? 'c4' : null);
      } else if (g.mode === 'smoke') {
        this.smokes.push({
          id: this.nextEnt++, x: Math.round(g.x), y: Math.round(g.y),
          r: it.radius, life: it.duration, max: it.duration,
        });
        this.pushEvent({ e: 'smoke', x: Math.round(g.x), y: Math.round(g.y), r: it.radius, life: it.duration });
      } else if (g.mode === 'flash') {
        /* A flashbang needs line of sight — a wall between you and it is the
           whole counterplay — and the room is the only place that can check
           that against geometry everyone agrees on. */
        this.pushEvent({ e: 'flash', x: Math.round(g.x), y: Math.round(g.y), r: it.radius });
        for (const p of this.players.values()) {
          if (!p.alive || p.riding) continue;         // buttoned up behind armour
          const d = Math.hypot(p.x - g.x, p.y - g.y);
          if (d >= it.radius || !this.hasLOS(g.x, g.y, p.x, p.y)) continue;
          const dur = it.blind * (1 - d / it.radius);
          p.blind = Math.max(p.blind || 0, dur);
          p.send({ t: 'blind', s: +dur.toFixed(2) });
        }
      }
    }
    /* Can a straight line get from here to there without crossing something
       that blocks sight? Stepped rather than analytic, same as the client. */
    hasLOS(x1, y1, x2, y2) {
      if (!this.wallIndex) return true;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const steps = Math.min(96, Math.ceil(len / 24));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        if (this.blocksSightAt(x1 + dx * t, y1 + dy * t)) return false;
      }
      return true;
    }
    blocksSightAt(x, y) {
      const arr = cellAt(this.wallIndex, x, y);
      if (!arr) return false;
      for (const s of arr) if (!s.dead && s.tall && inRect(x, y, s)) return true;
      return false;
    }

    /* ---------- mines, sentries, flags, ammo boxes ---------- */
    stepDeployables(dt) {
      for (let i = this.deployables.length - 1; i >= 0; i--) {
        const dp = this.deployables[i];
        dp.life -= dt;
        if (dp.life <= 0 || dp.dead) { this.removeDeployable(i); continue; }
        if (dp.mode === 'mine') {
          if (dp.arm > 0) { dp.arm -= dt; continue; }
          for (const p of this.players.values()) {
            if (!p.alive || p.team === dp.team) continue;
            if (dist2(p.x, p.y, dp.x, dp.y) > dp.item.trigger ** 2) continue;
            this.explode(dp.x, dp.y, dp.item.damage, dp.item.radius, dp.team, this.players.get(dp.owner), 'explosive');
            this.removeDeployable(i);
            break;
          }
        } else if (dp.mode === 'flag') {
          for (const p of this.players.values()) {
            if (!p.alive || p.team !== dp.team) continue;
            if (dist2(p.x, p.y, dp.x, dp.y) < dp.item.radius ** 2) {
              p.adrenaline = Math.max(p.adrenaline, dp.item.adr || 25);
            }
          }
        } else if (dp.mode === 'ammo') {
          // a supply box tops up magazines for the squad standing on it
          for (const p of this.players.values()) {
            if (!p.alive || p.team !== dp.team || dp.supply <= 0) continue;
            if (dist2(p.x, p.y, dp.x, dp.y) > 90 * 90) continue;
            if (p.ammo >= p.weapon.mag) continue;
            const give = Math.min(dp.supply, p.weapon.mag - p.ammo);
            p.ammo += give; dp.supply -= give;
            p.reloadUntil = 0; p.reloading = false;
          }
        } else if (dp.mode === 'sentry') {
          this.stepSentry(dp, dt);
        }
      }
    }
    removeDeployable(i) {
      const dp = this.deployables[i];
      this.deployables.splice(i, 1);
      // a barricade is real geometry, so retiring it has to take the wall too
      if (dp.rect && !dp.rect.dead) this.destroyWall(dp.rect, null);
      this.pushEvent({ e: 'undeploy', id: dp.id });
    }
    /* Engineer sentry: tracks the nearest enemy it can see and fires. */
    stepSentry(s, dt) {
      s.cd -= dt;
      let best = null, bd = s.item.range * s.item.range;
      for (const p of this.players.values()) {
        if (!p.alive || p.team === s.team) continue;
        const d = dist2(p.x, p.y, s.x, s.y);
        if (d < bd && this.hasLOS(s.x, s.y, p.x, p.y) && !this.smokeBlocks(s.x, s.y, p.x, p.y)) {
          bd = d; best = p;
        }
      }
      if (!best) return;
      const target = Math.atan2(best.y - s.y, best.x - s.x);
      s.angle += angleDiff(target, s.angle) * Math.min(1, 7 * dt);      // turret traverse
      if (s.cd > 0 || Math.abs(angleDiff(target, s.angle)) > 0.12) return;
      s.cd = 1 / s.item.rof;
      const ang = s.angle + (Math.random() - 0.5) * 0.05;
      this.bullets.push({
        x: s.x + Math.cos(ang) * 20, y: s.y + Math.sin(ang) * 20,
        vx: Math.cos(ang) * W.TILE * 48, vy: Math.sin(ang) * W.TILE * 48,
        sx: s.x, sy: s.y, dmg: s.item.damage, falloff: 0.04, range: s.item.range,
        dmgType: 'normal', team: s.team, owner: s.owner, hitR: 1, fuze: 0, antiTank: false,
        life: 1.2,
      });
    }
    smokeBlocks(x1, y1, x2, y2) {
      if (!this.smokes.length) return false;
      for (let t = 0.15; t < 1; t += 0.12) {
        const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
        for (const s of this.smokes) if (dist2(px, py, s.x, s.y) < (s.r * 0.85) ** 2) return true;
      }
      return false;
    }

    /* ---------- vehicles ----------
       Driven from the same input packet as a body: the direction keys steer
       and drive, the mouse angle aims the mounted gun. */
    driveVehicle(p, v, dt) {
      if (!v.alive) { p.riding = null; return; }
      const i = p.input;
      const dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
      const dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
      const m = Math.hypot(dx, dy);
      if (m > 0) {
        /* Terrain slows a hull the same way it slows a body — the client has
           always applied it in driveVehicle(), and the room did not, so
           driving through a river meant predicting one speed and being
           corrected to another for as long as you were in the water. */
        const spd = v.speed * surfaceSpeedFor(v, this.surfaceAt(v.x, v.y)) * dt;
        v.x = clamp(v.x + (dx / m) * spd, v.r, this.map.w - v.r);
        v.y = clamp(v.y + (dy / m) * spd, v.r, this.map.h - v.r);
        this.resolveWorld(v, v.r);
      }
      v.angle = i.angle;
      // the driver rides inside the hull, so their position is the hull's
      p.x = v.x; p.y = v.y; p.angle = v.angle;

      v.fireCd -= dt * 1000;
      if (now() < v.reloadUntil) return;
      if (v.reloading) { v.ammo = v.weapon.mag; v.reloading = false; }
      if (v.ammo <= 0) { v.reloadUntil = now() + v.weapon.reloadMs; v.reloading = true; return; }
      if (i.shooting && (v.weapon.action === 'auto' || i.fireEdge) && v.fireCd <= 0) {
        this.fireFrom(v, v.weapon, v.team, p.id);
        v.ammo--;
        v.fireCd = v.weapon.fireInterval;
        i.fireEdge = false;
        if (v.ammo <= 0) { v.reloadUntil = now() + v.weapon.reloadMs; v.reloading = true; }
      }
    }
    stepVehicles() {
      for (let i = this.vehicles.length - 1; i >= 0; i--) {
        const v = this.vehicles[i];
        if (v.alive) continue;
        const driver = v.driver && this.players.get(v.driver);
        if (driver) { driver.riding = null; this.damage(driver, 999, 'true', null); }
        this.vehicles.splice(i, 1);
        this.explode(v.x, v.y, 90, 190, -1, null, 'explosive');
        this.pushEvent({ e: 'wreck', id: v.id });
      }
    }

    /* smoke thinning out, loot rotting away */
    stepDecay(dt) {
      for (let i = this.smokes.length - 1; i >= 0; i--) {
        this.smokes[i].life -= dt;
        if (this.smokes[i].life <= 0) this.smokes.splice(i, 1);
      }
      for (let i = this.drops.length - 1; i >= 0; i--) {
        this.drops[i].life -= dt;
        if (this.drops[i].life <= 0) this.drops.splice(i, 1);
      }
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
      this.fireFrom(p, w, p.team, p.id, p.input.ads);
      // fired the last round: start the reload, and let step() fill it
      if (p.ammo <= 0) { p.reloadUntil = now() + this.reloadMs(p); p.reloading = true; }
    }
    /* One trigger pull from anything with a barrel — a player, or the gun on a
       jeep. Split out so a mounted weapon behaves exactly like a carried one
       rather than being a second, slightly different implementation. */
    fireFrom(src, w, team, ownerId, ads) {
      const cone = w.spreadBase * (ads ? w.adsMult : 1);
      for (let n = 0; n < (w.pellets || 1); n++) {
        const jitter = (Math.random() - 0.5) * cone * 2 + (Math.random() - 0.5) * (w.pelletSpread || 0) * 2;
        const ang = src.angle + jitter;
        const muzzle = (src.r || BODY_R) + 5;
        this.bullets.push({
          x: src.x + Math.cos(ang) * muzzle, y: src.y + Math.sin(ang) * muzzle,
          vx: Math.cos(ang) * w.bulletSpeed, vy: Math.sin(ang) * w.bulletSpeed,
          sx: src.x, sy: src.y, dmg: w.damage, falloff: w.falloff, range: w.range,
          dmgType: w.dmgType, team, owner: ownerId,
          /* Specialized ammo, mirroring game.js so an online round behaves the
             way the shooter's own screen showed it: a Tracer is fatter, an
             Anti-Tank punches through people, a Fuze flies on a timer rather
             than to its range. */
          hitR: w.hitboxMult || 1, fuze: w.fuze || 0, antiTank: !!w.antiTank,
          splashR: w.splashRadius || 0,        // a launcher round bursts on contact
          life: w.fuze ? w.fuze : Math.min(2.4, (w.range * 1.15) / w.bulletSpeed),
        });
      }
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
            // someone buttoned up inside a hull is hit through the hull, not directly
            if (!p.alive || p.team === b.team || p.riding) continue;
            const hitR = BODY_R * (b.hitR || 1);
            if (dist2(p.x, p.y, b.x, b.y) < hitR * hitR) {
              /* Anti-Tank isn't stopped by infantry: a flat 50 on the way
                 through, and it comes out an ordinary round. */
              if (b.antiTank) {
                this.damage(p, W.ANTI_TANK_PASSTHROUGH, 'normal', this.players.get(b.owner));
                b.antiTank = false; b.dmgType = 'normal';
                continue;
              }
              this.damage(p, b.dmg * this.falloffAt(b), b.dmgType, this.players.get(b.owner));
              dead = true; break;
            }
          }
          if (!dead && !b.fuze && this.bulletVsBodies(b)) dead = true;
          if (dead) break;
        }
        if (dead) {
          // a launcher round is an explosion that happened to be aimed
          if (b.splashR > 0) {
            this.explode(b.x, b.y, b.dmg, b.splashR, b.team, this.players.get(b.owner),
              b.dmgType === 'heat' ? 'heat' : 'explosive');
          }
          this.bullets.splice(i, 1);
        }
      }
    }

    /* How much of its damage a round still has after the distance it has
       flown. Was inline in the player-hit branch; a vehicle and a sentry have
       to fall off the same way or a tank is easier to kill at range. */
    falloffAt(b) {
      const travelled = Math.hypot(b.x - b.sx, b.y - b.sy);
      const start = (b.range || FALLOFF_STEP * 6) * FALLOFF_START;
      const steps = Math.max(0, travelled - start) / FALLOFF_STEP;
      return Math.max(FALLOFF_MIN, 1 - b.falloff * steps);
    }
    /* Everything shootable that isn't a player or a wall: hulls and turrets.
       Returns true if the round stopped here. */
    bulletVsBodies(b) {
      for (const v of this.vehicles) {
        if (!v.alive || v.team === b.team) continue;
        if (dist2(v.x, v.y, b.x, b.y) > v.r * v.r) continue;
        /* The damage-type table is what makes a tank a tank: a rifle round is
           multiplied by zero against one, so it genuinely bounces rather than
           chipping away at a big health bar. */
        const hit = C.resolve({ damage: b.dmg * this.falloffAt(b), type: b.dmgType }, v);
        v.hp -= hit.damage;
        if (v.hp <= 0) {
          v.alive = false;
          const killer = this.players.get(b.owner);
          if (killer && v.driver && v.driver !== killer.id) killer.kills++;
        }
        return true;
      }
      for (const dp of this.deployables) {
        if (dp.mode !== 'sentry' || dp.team === b.team || dp.dead) continue;
        if (dist2(dp.x, dp.y, b.x, b.y) > (BODY_R + 6) ** 2) continue;
        dp.hp -= b.dmg * this.falloffAt(b);
        if (dp.hp <= 0) dp.dead = true;
        return true;
      }
      return false;
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
        if (!p.alive || p.riding) continue;        // the hull eats it, not the driver
        const d = Math.hypot(p.x - x, p.y - y);
        if (d >= radius) continue;
        const dmg = baseDmg * (1 - d / radius) * (p.team === team ? 0.5 : 1);
        if (dmg > 1) this.damage(p, dmg, type || 'explosive', owner, 'body');
      }
      // hulls and turrets are in the blast too
      for (const v of this.vehicles) {
        if (!v.alive) continue;
        const d = Math.hypot(v.x - x, v.y - y);
        if (d >= radius) continue;
        const hit = C.resolve({ damage: baseDmg * (1 - d / radius), type: type || 'explosive' }, v);
        v.hp -= hit.damage;
        if (v.hp <= 0) v.alive = false;
      }
      for (const dp of this.deployables) {
        if (dp.mode !== 'sentry' || dp.dead) continue;
        const d = Math.hypot(dp.x - x, dp.y - y);
        if (d >= radius) continue;
        dp.hp -= baseDmg * (1 - d / radius);
        if (dp.hp <= 0) dp.dead = true;
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
      // being shot puts the bottle down; the item is already spent
      if (target.channel) this.cancelChannel(target);
      if (target.hp <= 0) {
        target.hp = 0; target.alive = false; target.deaths++;
        target.respawnAt = now() + 3000;
        if (attacker) attacker.kills++;
        /* What they were carrying hits the floor. Killing someone who had just
           looted a gold crate should be worth doing, and it is the only way
           the good stuff circulates once it has been picked up. */
        this.spillInventory(target);
        if (target.riding) { target.riding.driver = null; target.riding = null; }
        this.pushEvent({
          e: 'kill', by: attacker ? attacker.name : 'the world',
          byId: attacker ? attacker.id : null, victim: target.name, victimId: target.id,
          zone: hit.zone,
        });
      }
    }
    spillInventory(p) {
      if (!p.inv) return;
      for (const cat of ['grenade', 'tactical', 'heal']) {
        const slot = p.inv[cat];
        if (slot && slot.id && slot.n > 0) this.dropItem(cat, slot.id, slot.n, p);
      }
    }

    respawn(p) {
      const s = this.spawnPoint(p.team);
      p.x = s.x; p.y = s.y; p.hp = p.maxHp; p.alive = true;   // maxHp already has Beefy in it
      p.ammo = p.weapon.mag; p.reloadUntil = 0; p.reloading = false; p.adrenaline = 0;
      p.wireAcc = 0;             // don't carry a part-finished wire cut into the next life
      p.blind = 0; p.channel = null;
      // you come back with your class kit, not with whatever you died holding
      p.inv = startingInv(p.cls);
    }

    /* ---------- the snapshot ----------
       Built once per tick and then finished per player, because two parts of
       it are personal: what you are carrying (nobody else's business, and
       nobody else's bandwidth), and how much of your own input we have applied
       so you know what is left to replay.

       Everything positional is rounded to whole pixels and angles to three
       decimals. At a 6400px map a pixel is well under what anyone can see, and
       it roughly halves the JSON. */
    snapshot() {
      const t = now();
      return {
        t: 'snapshot', tick: this.tick++, time: t, timeLeft: Math.max(0, Math.round(this.timeLeft)),
        agents: [...this.players.values()].map(p => ({
          id: p.id, x: Math.round(p.x), y: Math.round(p.y),
          angle: +p.angle.toFixed(3), hp: Math.round(p.hp), alive: p.alive,
          team: p.team, name: p.name, ammo: p.ammo, adrenaline: Math.round(p.adrenaline),
          vest: p.vest, helmet: p.helmet, bag: p.bag, weaponId: p.weaponId, skin: p.skin,
          kills: p.kills, deaths: p.deaths,
          // riding, and channelling, so everyone draws them doing it
          ride: p.riding ? p.riding.id : 0,
          ch: p.channel ? +p.channel.left.toFixed(1) : 0,
          // seconds until this one is back on their feet, for the HUD
          respawn: p.alive ? 0 : Math.max(0, Math.ceil((p.respawnAt - t) / 1000)),
        })),
        /* Rounds in flight. `o` is who fired it, so a client can skip its own
           (it drew those the moment it pulled the trigger) and `a` is the
           heading, so the tracer can be drawn pointing the right way rather
           than as a dot. */
        bullets: this.bullets.slice(0, 120).map(b => ({
          x: Math.round(b.x), y: Math.round(b.y), team: b.team, o: b.owner,
          a: +Math.atan2(b.vy, b.vx).toFixed(2),
        })),
        // grenades mid-flight, so they are drawn arcing rather than appearing
        // as an explosion out of nowhere
        /* The world's furniture, encoded once and then filtered per player —
           see cullTo(). Encoding is the expensive half and it doesn't depend
           on who is looking, so it happens here; the filtering is a distance
           test on a number that is already computed. */
        nades: this.grenades.map(g => ({
          i: g.id, x: Math.round(g.x), y: Math.round(g.y), k: g.kind, tm: g.team,
        })),
        deploys: this.deployables.map(d => ({
          i: d.id, x: Math.round(d.x), y: Math.round(d.y), k: d.kind, tm: d.team,
          a: d.angle === undefined ? 0 : +d.angle.toFixed(2),
          hp: d.hp === undefined ? 0 : Math.round(d.hp),
          /* A barricade is geometry, not decoration: the client has to predict
             its own movement against the same rectangle the room is stopping
             it with, or walking into one you deployed rubber-bands you. */
          w: d.rect ? d.rect.w : 0, h: d.rect ? d.rect.h : 0,
          rx: d.rect ? d.rect.x : 0, ry: d.rect ? d.rect.y : 0,
        })),
        drops: this.drops.map(d => ({ i: d.id, x: d.x, y: d.y, k: d.kind, n: d.n })),
        smokes: this.smokes.map(s => ({ i: s.id, x: s.x, y: s.y, r: s.r, l: +s.life.toFixed(1) })),
        cars: this.vehicles.map(v => ({
          i: v.id, x: Math.round(v.x), y: Math.round(v.y), a: +v.angle.toFixed(2),
          v: v.vtype, tm: v.team, hp: Math.round(v.hp), mx: v.maxHp, d: v.driver || 0,
        })),
        // capture points, in the order the client generated them
        objectives: this.objectives.map(o => ({ o: o.owner, p: Math.round(o.progress), c: o.capTeam })),
        scores: this.scores.map(s => Math.round(s)),
        events: this.events.splice(0, this.events.length),
      };
    }
    /* The half of the snapshot that is different for everybody. Attached just
       before sending rather than built into a per-player snapshot, so the
       expensive part is still built once however many people are in the room. */
    personal(p) {
      return {
        // the last input packet of theirs we have acted on: reconcile() replays
        // from here rather than guessing the window from half a ping
        ack: p.seq,
        inv: {
          g: p.inv.grenade.id, gn: p.inv.grenade.n,
          t: p.inv.tactical.id, tn: p.inv.tactical.n,
          h: p.inv.heal.id, hn: p.inv.heal.n,
          tk: p.inv.tokens.slice(),
        },
      };
    }

    /* ---------- one door in ----------
       Every transport used to switch on `msg.t` itself, and the two copies had
       already drifted: the dedicated server never handled doors at all, and
       filled magazines at the wrong end of a reload. There is one list of
       things a client may ask for, and this is it.

       Everything here is a *request*. The room checks it can be done, decides
       the outcome, and puts the result in the snapshot; nothing a client sends
       is taken as a statement of fact. */
    handle(p, msg) {
      if (!p || !msg) return false;
      switch (msg.t) {
        case 'input': this.applyInput(p, msg); return true;
        case 'reload': return this.reload(p);
        case 'melee': return this.melee(p);
        case 'dig': return this.dig(p, msg.r, msg.dodge);
        case 'door': return this.toggleDoor(p, msg.id, msg.open);
        case 'throw': return this.throwItem(p, msg.x, msg.y);
        case 'deploy': return this.deploy(p);
        case 'heal': return this.heal(p);
        case 'grab': return this.grab(p);
        case 'crate': return this.openCrate(p, msg.i);
        case 'token': return this.callVehicle(p, msg.x, msg.y);
        case 'ride': return this.useVehicle(p);
        case 'mark': return this.mark(p, msg.x, msg.y, msg.kind);
        case 'emote': return this.emote(p, msg.id);
        case 'bye': this.leave(p.id); return true;
        default: return false;
      }
    }

    broadcast(msg) {
      for (const p of this.players.values()) p.send(msg);
    }
    /* ---------- what you can actually see ----------
       A 6400px map holds far more furniture than fits on anyone's screen, and
       shipping all of it to all of them twenty times a second is most of the
       bandwidth for none of the benefit. Measured on a busy eight-player map:
       6.7 KB a tick, ~130 KB/s per player, which is a lot to ask of a browser
       host on a domestic upload.

       Players and bullets are never culled — the scoreboard needs everyone,
       and a tracer you can't see yet is one that's about to reach you. It is
       the scenery that goes: loot, mines, hulls, smoke, grenades in flight.

       The radius is generous on purpose. It has to cover the widest zoom
       (binoculars) plus enough margin that something never pops into view
       already on top of you. */
    cullTo(list, x, y) {
      if (!list.length) return list;
      const r2 = CULL_R * CULL_R;
      const out = [];
      for (const e of list) if (dist2(e.x, e.y, x, y) <= r2) out.push(e);
      return out;
    }

    /* One tick's worth of world, personalised on the way out the door. */
    sendSnapshot() {
      if (!this.players.size) return;
      const full = this.snapshot();
      const near = ['nades', 'deploys', 'drops', 'smokes', 'cars'];
      for (const p of this.players.values()) {
        /* A shallow copy per player, sharing the arrays that aren't culled.
           The transports serialise immediately (JSON down a socket, structured
           clone down a data channel), so nothing here outlives the send. */
        const snap = Object.assign({}, full);
        snap.you = this.personal(p);
        for (const k of near) snap[k] = this.cullTo(full[k], p.x, p.y);
        p.send(snap);
      }
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
