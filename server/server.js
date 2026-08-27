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
const { WebSocketServer } = require('ws');

/* ---------- the shared rules ----------
   The match simulation and the data tables live in js/, so this server and a
   browser hosting over WebRTC (see js/p2p.js) run exactly the same code. */
const { Weapons, Classes, buildWorld } = require('../js/_shared');
const { Room, MAP, TICK, ROOM_MAX, MATCH_SECONDS } = require('../js/roomsim');
console.log(`[init] loaded ${Weapons.list.length} weapons, ${Classes.list.length} classes`);

/* ---------- tuning ---------- */
// TICK, MAP, ROOM_MAX, MATCH_SECONDS and the ballistics constants all come
// from js/roomsim.js now, so the browser host and this server can't drift.
const PORT = process.env.PORT || 8080;
const SIM = 1000 / 60;               // simulation step
const now = () => Date.now();

/* ---------- room ---------- */
let nextId = 1;
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
  // ROOM_SEED pins the map every room generates, which makes a match
  // reproducible when you are chasing a bug on a particular piece of ground
  if (process.env.ROOM_SEED) r.seed = (+process.env.ROOM_SEED) >>> 0;
  /* Build the room's map here, from its own seed, so the server simulates the
     same buildings the clients draw. If generation ever fails the match still
     runs — just on open ground — rather than taking the server down with it. */
  try {
    const n = r.setWorld(buildWorld(mode, r.seed));
    console.log(`[room] created ${r.id} (${mode}) seed ${r.seed}, ${n} walls, ${r.objectives.length} objectives`);
  } catch (e) {
    console.warn(`[room] ${r.id}: could not build the map (${e.message}) — running without cover`);
  }
  rooms.set(r.id, r);
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
          const p = r.join((m) => { if (c.readyState === 1) c.send(JSON.stringify(m)); }, info, team);
          c.send(JSON.stringify({ t: 'partyLaunch', room: r.id, mode: existing.mode }));
          console.log(`[join] ${p.name} -> ${r.id} (party ${existing.code}, team ${p.team})`);
        }
        parties.delete(existing.code);
      }
      return;
    }

    if (msg.t === 'join' && !me) {
      room = findRoom(msg.mode);
      me = room.join((m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }, msg);
      console.log(`[join] ${me.name} -> ${room.id} (team ${me.team}, ${room.players.size} in room)`);
      return;
    }
    if (!me) return;
    me.lastSeen = now();

    /* One rulebook for both transports: everything a client may ask for is
       listed in Room.handle (js/roomsim.js), which trusts inputs and never
       positions. This file used to keep its own copy of that switch and the
       two had drifted — the server never handled doors, and it reloaded at the
       wrong end of the timer. */
    if (msg.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', c: msg.c })); return; }
    room.handle(me, msg);
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

/* ---------- starting a match with nobody to press start ----------
   A room opens in `lobby` and step() does nothing until it is `live`. On a
   browser host that is right: a human owns the room and clicks Start Match
   when their squad is in. A dedicated server has no such human, and nothing
   here ever called startMatch — so a room filled up, handed out welcomes,
   sent snapshots, and simulated not one tick of anything. Measured: hold [D]
   for five seconds against this server and you moved zero pixels.

   So it starts itself. As soon as a second player arrives the countdown runs,
   because a match is worth starting once there is somebody to fight; a player
   sitting alone gets a longer grace period and then a match anyway, so that
   the first person through the door is not stuck staring at an empty island
   waiting for a second who may never come. */
const START_WITH_SQUAD = 5;      // seconds once a second player is in
const START_ALONE = 30;          // seconds if nobody else turns up
function considerStart(r) {
  if (r.phase !== 'lobby' || r.over) return;
  if (!r.players.size) { r.startAt = 0; return; }
  const wait = r.players.size >= 2 ? START_WITH_SQUAD : START_ALONE;
  // the clock runs from the first arrival, and shortens when the room fills
  if (!r.startAt) r.startAt = now() + wait * 1000;
  else r.startAt = Math.min(r.startAt, now() + wait * 1000);
  if (now() >= r.startAt) {
    r.startMatch();
    console.log(`[room] ${r.id} started with ${r.players.size} player(s)`);
  }
}

/* simulation loop, independent of the snapshot rate */
let last = now();
setInterval(() => {
  const t = now();
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  for (const r of rooms.values()) { considerStart(r); r.step(dt); }
}, SIM);

/* snapshot loop */
setInterval(() => {
  for (const r of rooms.values()) {
    r.sendSnapshot();   // personalised per player: their inventory and input ack
  }
}, TICK);

server.listen(PORT, () => {
  console.log(`Battle Squads server listening on :${PORT}`);
  console.log(`Open the game with ?server=ws://localhost:${PORT}`);
});
