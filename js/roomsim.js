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
  const ROOM_MAX = 24;
  const MATCH_SECONDS = 8 * 60;
  const SCORE_CAP = 1000;              // domination win score, as offline
  const COMMS_GAP = 550;               // ms between one player's pings/emotes

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
      /* Every client generates its own copy of the world, so they all need the
         same seed to end up with the same map. The room owns it and hands it
         out with the welcome. */
      this.seed = (Math.random() * 0xffffffff) >>> 0;
      this.players = new Map();          // id -> player
      this.walls = [];                   // world geometry, empty until setWorld
      this.wallIndex = null;
      this.downed = [];                  // walls destroyed so far, for late joiners
      this.objectives = [];              // domination capture points
      this.scores = [0, 0, 0, 0];        // domination score per team
      this.bullets = [];
      this.events = [];                  // things clients should hear about
      this.timeLeft = MATCH_SECONDS;
      this.tick = 0;
      this.over = false;
      this.lastSim = now();
    }

    get full() { return this.players.size >= ROOM_MAX; }

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
      }));
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

    /* the emptiest team that can seat a whole party together */
    freeTeam(size) {
      const counts = [0, 0, 0, 0];
      for (const p of this.players.values()) counts[p.team]++;
      let best = 0;
      for (let t = 1; t < counts.length; t++) if (counts[t] < counts[best]) best = t;
      return best;
    }

    join(send, info, forceTeam) {
      const id = nextId++;
      const weapon = W.byId[info.weapon] || W.byId[W.default];
      const cls = K.forWeapon(weapon);
      // a party is handed a team so it stays together; otherwise the smallest
      // team wins the new player, keeping squads even
      let team = forceTeam;
      if (team === undefined) {
        const counts = {};
        for (const p of this.players.values()) counts[p.team] = (counts[p.team] || 0) + 1;
        team = 0;
        let best = Infinity;
        for (let t = 0; t < 4; t++) { const c = counts[t] || 0; if (c < best) { best = c; team = t; } }
      }

      const spawn = this.spawnPoint(team);
      const p = {
        id, send, name: (info.name || 'Operator').slice(0, 16), team,
        x: spawn.x, y: spawn.y, angle: 0,
        hp: C.maxHpFor('infantry'), maxHp: C.maxHpFor('infantry'),
        klass: 'infantry', vest: 0, helmet: 0, adrenaline: 0,
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
        tickRate: 1000 / TICK, roster: this.roster(),
        // join halfway through and the cover that has already been shot away
        // should be gone on your screen too
        downed: this.downed.slice(),
      });
      this.pushEvent({ e: 'join', id, name: p.name, team });
      return p;
    }

    leave(id) {
      const p = this.players.get(id);
      if (!p) return;
      this.players.delete(id);
      this.pushEvent({ e: 'leave', id, name: p.name });
    }

    /* Each team gets its own quarter of the map, and nobody spawns inside a
       building — spread the jitter wider on each retry so a crowded corner
       still finds somewhere to put you. */
    spawnPoint(team) {
      const cx = this.map.w / 2, cy = this.map.h / 2;
      const rx = this.map.w / 2 - 240, ry = this.map.h / 2 - 240;
      const ang = -Math.PI / 2 + (team / 4) * Math.PI * 2;
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
    step(dt) {
      if (this.over) return;
      this.timeLeft -= dt;

      for (const p of this.players.values()) {
        if (!p.alive) {
          if (now() >= p.respawnAt) this.respawn(p);
          continue;
        }
        // movement — the server decides where you are, not your client
        const i = p.input;
        let dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
        let dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
        const m = Math.hypot(dx, dy);
        if (m > 0) {
          let spd = p.weapon.moveSpeed * p.cls.speed * C.armorSpeed(p) * C.adrenaline(p.adrenaline).speed;
          if (i.ads) spd *= 0.55;
          /* Move, then get pushed back out of anything solid — the same
             resolution the client runs offline, so a player and the host
             agree about where a wall stopped them. Pushing out rather than
             refusing the step is what lets you slide along a wall instead of
             sticking to it; a step is a few pixels and the thinnest wall is
             8px, so you are always ejected back the way you came. */
          p.x = clamp(p.x + (dx / m) * spd * dt, 16, this.map.w - 16);
          p.y = clamp(p.y + (dy / m) * spd * dt, 16, this.map.h - 16);
          this.resolveWorld(p);
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
        if (p.ammo <= 0) { p.reloadUntil = now() + p.weapon.reloadMs; p.ammo = p.weapon.mag; continue; }
        const wantsFire = i.shooting && (p.weapon.action === 'auto' || i.fireEdge);
        if (wantsFire && p.fireCd <= 0) this.fire(p);
      }

      this.stepBullets(dt);
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
          life: Math.min(2.4, (w.range * 1.15) / w.bulletSpeed),
        });
      }
      if (p.ammo <= 0) p.reloadUntil = now() + w.reloadMs;
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
          for (const p of this.players.values()) {
            if (!p.alive || p.team === b.team) continue;
            if (dist2(p.x, p.y, b.x, b.y) < BODY_R * BODY_R) {
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
        if (wall.hp <= 0) this.destroyWall(wall);
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

    destroyWall(wall) {
      if (wall.dead) return;
      wall.dead = true;
      this.downed.push(wall.id);
      this.pushEvent({ e: 'wall', id: wall.id });
    }

    /* the same calculator the client uses */
    damage(target, raw, type, attacker) {
      const hit = C.resolve({ damage: raw, type }, target);
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
      p.ammo = p.weapon.mag; p.reloadUntil = 0; p.adrenaline = 0;
    }

    snapshot() {
      return {
        t: 'snapshot', tick: this.tick++, time: now(), timeLeft: Math.max(0, Math.round(this.timeLeft)),
        agents: [...this.players.values()].map(p => ({
          id: p.id, x: Math.round(p.x), y: Math.round(p.y),
          angle: +p.angle.toFixed(3), hp: Math.round(p.hp), alive: p.alive,
          team: p.team, name: p.name, ammo: p.ammo, adrenaline: Math.round(p.adrenaline),
          vest: p.vest, helmet: p.helmet, weaponId: p.weaponId, skin: p.skin,
          kills: p.kills, deaths: p.deaths,
          // seconds until this one is back on their feet, for the HUD
          respawn: p.alive ? 0 : Math.max(0, Math.ceil((p.respawnAt - now()) / 1000)),
        })),
        bullets: this.bullets.slice(0, 120).map(b => ({
          x: Math.round(b.x), y: Math.round(b.y), team: b.team,
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
  return { Room, MAP_SIZES, TICK, ROOM_MAX, MATCH_SECONDS };
}));
