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

  /* The data modules are globals in the browser and required on the
     server; either way ballistics and the damage calculator are the
     same code both sides. */
  const W = (typeof Weapons !== 'undefined') ? Weapons : require('./_shared').Weapons;
  const C = (typeof Combat !== 'undefined') ? Combat : require('./_shared').Combat;
  const K = (typeof Classes !== 'undefined') ? Classes : require('./_shared').Classes;

  const TICK = 1000 / 20;              // snapshot rate
  const MAP = { w: 3400, h: 2300 };
  const ROOM_MAX = 24;
  const MATCH_SECONDS = 8 * 60;

  /* Ballistics, mirroring game.js. These belong with the simulation rather
     than the weapon table, and now that the sim is shared they live here
     instead of being declared separately by each host.
     BODY_R is the authoritative hitbox; BULLET_STEP must stay under it or a
     fast round can step straight past someone. */
  const BODY_R = 15;
  const BULLET_STEP = 10;
  const FALLOFF_STEP = W.TILE * 4, FALLOFF_START = 0.45, FALLOFF_MIN = 0.4;

  const now = () => Date.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

  let nextId = 1;

  class Room {
    constructor(id, mode) {
      this.id = id;
      this.mode = mode || 'domination';
      this.players = new Map();          // id -> player
      this.bullets = [];
      this.events = [];                  // things clients should hear about
      this.timeLeft = MATCH_SECONDS;
      this.tick = 0;
      this.over = false;
      this.lastSim = now();
    }

    get full() { return this.players.size >= ROOM_MAX; }

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
        t: 'welcome', id, team, mode: this.mode, map: MAP,
        tickRate: 1000 / TICK, roster: this.roster(),
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

    spawnPoint(team) {
      const cx = MAP.w / 2, cy = MAP.h / 2;
      const rx = MAP.w / 2 - 240, ry = MAP.h / 2 - 240;
      const ang = -Math.PI / 2 + (team / 4) * Math.PI * 2;
      return {
        x: cx + Math.cos(ang) * rx + (Math.random() * 140 - 70),
        y: cy + Math.sin(ang) * ry + (Math.random() * 140 - 70),
      };
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
          p.x = clamp(p.x + (dx / m) * spd * dt, 16, MAP.w - 16);
          p.y = clamp(p.y + (dy / m) * spd * dt, 16, MAP.h - 16);
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
      if (this.timeLeft <= 0) this.finish();
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
          b.x += b.vx * hop; b.y += b.vy * hop;
          if (b.x < 0 || b.y < 0 || b.x > MAP.w || b.y > MAP.h) { dead = true; break; }
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
        })),
        bullets: this.bullets.slice(0, 120).map(b => ({
          x: Math.round(b.x), y: Math.round(b.y), team: b.team,
        })),
        events: this.events.splice(0, this.events.length),
      };
    }

    broadcast(msg) {
      for (const p of this.players.values()) p.send(msg);
    }

    finish() {
      this.over = true;
      const scores = {};
      for (const p of this.players.values()) scores[p.team] = (scores[p.team] || 0) + p.kills;
      this.broadcast({ t: 'end', scores, roster: this.roster() });
    }
  }
  return { Room, MAP, TICK, ROOM_MAX, MATCH_SECONDS };
}));
