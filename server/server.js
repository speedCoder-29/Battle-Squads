/* ============================================================
   server.js — authoritative multiplayer server for Battle Squads.

   Run it:
       cd server && npm install && npm start
       # then open the game with ?server=ws://localhost:8080

   Deploy it anywhere that keeps a process alive — Render, Railway,
   Fly.io, a VPS. It cannot run on Vercel: Vercel Functions cap out
   at 300s and cannot hold a WebSocket open, which is why the game
   falls back to offline bots when no server is configured.

   Design:
     • The server owns the world. Clients send inputs only.
     • It reuses the game's own data modules (weapons, combat,
       classes) so ballistics and the damage calculator are
       identical on both sides — no drifting duplicate tables.
     • 20 snapshots/sec; clients render ~100ms behind and
       interpolate (see js/net.js).
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const vm = require('vm');

/* ---------- load the shared game data modules ---------- */
// These are plain IIFEs with no DOM dependency, so the server and the
// browser genuinely run the same numbers.
const SHARED = ['weapons.js', 'combat.js', 'classes.js', 'items.js'];
const sandbox = { console, Math, JSON, Date };
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of SHARED) {
  const p = path.join(__dirname, '..', 'js', f);
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
}
// top-level `const` in a vm script is script-scoped, not a property of the
// context, so reach the modules by evaluating inside the context
const { Weapons, Combat, Classes, Items } =
  vm.runInContext('({ Weapons, Combat, Classes, Items })', ctx);
console.log(`[init] loaded ${Weapons.list.length} weapons, ${Classes.list.length} classes`);

/* ---------- tuning ---------- */
const PORT = process.env.PORT || 8080;
const TICK = 1000 / 20;              // snapshot rate
const SIM = 1000 / 60;               // simulation step
const MAP = { w: 3400, h: 2300 };
const ROOM_MAX = 24;
const MATCH_SECONDS = 8 * 60;

const now = () => Date.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

/* ---------- room ---------- */
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

  join(ws, info, forceTeam) {
    const id = nextId++;
    const weapon = Weapons.byId[info.weapon] || Weapons.byId[Weapons.default];
    const cls = Classes.forWeapon(weapon);
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
      id, ws, name: (info.name || 'Operator').slice(0, 16), team,
      x: spawn.x, y: spawn.y, angle: 0,
      hp: Combat.maxHpFor('infantry'), maxHp: Combat.maxHpFor('infantry'),
      klass: 'infantry', vest: 0, helmet: 0, adrenaline: 0,
      weaponId: weapon.id, weapon, cls,
      ammo: weapon.mag, reloadUntil: 0, fireCd: 0,
      alive: true, respawnAt: 0, kills: 0, deaths: 0,
      skin: info.skin || 'default',
      input: { up: false, down: false, left: false, right: false, shooting: false, ads: false, angle: 0 },
      lastSeen: now(),
    };
    this.players.set(id, p);
    ws.send(JSON.stringify({
      t: 'welcome', id, team, mode: this.mode, map: MAP,
      tickRate: 1000 / TICK, roster: this.roster(),
    }));
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
        let spd = p.weapon.moveSpeed * p.cls.speed * Combat.armorSpeed(p) * Combat.adrenaline(p.adrenaline).speed;
        if (i.ads) spd *= 0.55;
        p.x = clamp(p.x + (dx / m) * spd * dt, 16, MAP.w - 16);
        p.y = clamp(p.y + (dy / m) * spd * dt, 16, MAP.h - 16);
      }
      p.angle = i.angle;

      // adrenaline heals, and spends itself doing it
      if (p.adrenaline > 0) {
        const adr = Combat.adrenaline(p.adrenaline);
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
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0 || b.x < 0 || b.y < 0 || b.x > MAP.w || b.y > MAP.h;
      if (!dead) {
        for (const p of this.players.values()) {
          if (!p.alive || p.team === b.team) continue;
          if (dist2(p.x, p.y, b.x, b.y) < 16 * 16) {
            const travelled = Math.hypot(b.x - b.sx, b.y - b.sy);
            const start = (b.range || 420) * 0.45;
            const steps = Math.max(0, travelled - start) / 210;
            const mult = Math.max(0.4, 1 - b.falloff * steps);
            this.damage(p, b.dmg * mult, b.dmgType, this.players.get(b.owner));
            dead = true; break;
          }
        }
      }
      if (dead) this.bullets.splice(i, 1);
    }
  }

  /* the same calculator the client uses */
  damage(target, raw, type, attacker) {
    const hit = Combat.resolve({ damage: raw, type }, target);
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
    const raw = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws.readyState === 1) p.ws.send(raw);
    }
  }

  finish() {
    this.over = true;
    const scores = {};
    for (const p of this.players.values()) scores[p.team] = (scores[p.team] || 0) + p.kills;
    this.broadcast({ t: 'end', scores, roster: this.roster() });
  }
}

/* ---------- parties ----------
   A party is a lobby with a short code you can share. Everyone in it queues
   together and lands on the same team in the same room. Parties live only as
   long as someone is in them. */
const parties = new Map();          // code -> party
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1 to read aloud

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (parties.has(code));
  return code;
}

class Party {
  constructor(leader) {
    this.code = makeCode();
    this.members = [leader];        // connections, leader first
    this.mode = 'domination';
    this.launching = false;
  }
  get leader() { return this.members[0]; }
  has(conn) { return this.members.includes(conn); }
  add(conn) { if (!this.has(conn)) this.members.push(conn); }
  remove(conn) {
    const i = this.members.indexOf(conn);
    if (i >= 0) this.members.splice(i, 1);
  }
  state() {
    return {
      code: this.code, mode: this.mode,
      leader: this.leader ? this.leader.pname : null,
      members: this.members.map(c => ({ name: c.pname, ready: !!c.pready, leader: c === this.leader })),
    };
  }
  broadcast(msg) {
    const raw = JSON.stringify(msg);
    for (const c of this.members) if (c.readyState === 1) c.send(raw);
  }
  sync() { this.broadcast({ t: 'party', ...this.state() }); }
}

function partyOf(conn) {
  for (const p of parties.values()) if (p.has(conn)) return p;
  return null;
}
function leaveParty(conn) {
  const p = partyOf(conn);
  if (!p) return;
  p.remove(conn);
  if (!p.members.length) { parties.delete(p.code); console.log(`[party] ${p.code} closed`); }
  else p.sync();
}

/* ---------- matchmaking ---------- */
const rooms = new Map();
function findRoom(mode, needSeats) {
  const seats = needSeats || 1;
  for (const r of rooms.values()) {
    if (r.mode === mode && !r.over && r.players.size + seats <= ROOM_MAX) return r;
  }
  const r = new Room('room-' + (rooms.size + 1), mode);
  rooms.set(r.id, r);
  console.log(`[room] created ${r.id} (${mode})`);
  return r;
}

/* ---------- wiring ---------- */
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const players = [...rooms.values()].reduce((n, r) => n + r.players.size, 0);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, players }));
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Battle Squads server. Connect a client with ?server=ws://<this-host>\n');
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  let room = null, me = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    /* ---- party lobby ---- */
    if (msg.t === 'party') {
      ws.pname = (msg.name || 'Operator').slice(0, 16);
      ws.pinfo = msg;                                // remembered for the launch
      const existing = partyOf(ws);

      if (msg.do === 'create') {
        leaveParty(ws);
        const p = new Party(ws);
        parties.set(p.code, p);
        console.log(`[party] ${p.code} created by ${ws.pname}`);
        p.sync();
      } else if (msg.do === 'join') {
        const code = String(msg.code || '').toUpperCase().trim();
        const p = parties.get(code);
        if (!p) return ws.send(JSON.stringify({ t: 'partyError', error: 'No party with that code.' }));
        if (p.members.length >= 4) return ws.send(JSON.stringify({ t: 'partyError', error: 'That party is full.' }));
        if (p.launching) return ws.send(JSON.stringify({ t: 'partyError', error: 'That party is already deploying.' }));
        leaveParty(ws);
        p.add(ws);
        console.log(`[party] ${ws.pname} joined ${p.code} (${p.members.length})`);
        p.sync();
      } else if (msg.do === 'leave') {
        leaveParty(ws);
        ws.send(JSON.stringify({ t: 'party', code: null, members: [] }));
      } else if (msg.do === 'ready' && existing) {
        ws.pready = !!msg.ready;
        existing.sync();
      } else if (msg.do === 'mode' && existing && existing.leader === ws) {
        existing.mode = msg.mode === 'elimination' ? 'elimination' : 'domination';
        existing.sync();
      } else if (msg.do === 'start' && existing && existing.leader === ws) {
        // the whole party drops into one room, on one team
        existing.launching = true;
        const squad = existing.members.slice();
        const r = findRoom(existing.mode, squad.length);
        const team = r.freeTeam(squad.length);
        for (const c of squad) {
          const info = { ...(c.pinfo || {}), mode: existing.mode, name: c.pname };
          const p = r.join(c, info, team);
          c.send(JSON.stringify({ t: 'partyLaunch', room: r.id, mode: existing.mode }));
          console.log(`[join] ${p.name} -> ${r.id} (party ${existing.code}, team ${p.team})`);
        }
        parties.delete(existing.code);
      }
      return;
    }

    if (msg.t === 'join' && !me) {
      room = findRoom(msg.mode);
      me = room.join(ws, msg);
      console.log(`[join] ${me.name} -> ${room.id} (team ${me.team}, ${room.players.size} in room)`);
      return;
    }
    if (!me) return;
    me.lastSeen = now();

    if (msg.t === 'input') {
      // trust inputs, never positions
      const i = me.input;
      i.up = !!msg.up; i.down = !!msg.down; i.left = !!msg.left; i.right = !!msg.right;
      i.shooting = !!msg.shooting; i.ads = !!msg.ads;
      if (msg.fire) i.fireEdge = true;
      if (typeof msg.angle === 'number') i.angle = msg.angle;
    } else if (msg.t === 'reload') {
      if (now() >= me.reloadUntil && me.ammo < me.weapon.mag) {
        me.reloadUntil = now() + me.weapon.reloadMs;
        me.ammo = me.weapon.mag;
      }
    } else if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', c: msg.c }));
    }
  });

  ws.on('close', () => {
    leaveParty(ws);
    if (room && me) {
      console.log(`[left] ${me.name} from ${room.id}`);
      room.leave(me.id);
      if (room.players.size === 0) { rooms.delete(room.id); console.log(`[room] closed ${room.id}`); }
    }
  });
});

/* simulation loop, independent of the snapshot rate */
let last = now();
setInterval(() => {
  const t = now();
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  for (const r of rooms.values()) r.step(dt);
}, SIM);

/* snapshot loop */
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.players.size) r.broadcast(r.snapshot());
  }
}, TICK);

server.listen(PORT, () => {
  console.log(`Battle Squads server listening on :${PORT}`);
  console.log(`Open the game with ?server=ws://localhost:${PORT}`);
});
