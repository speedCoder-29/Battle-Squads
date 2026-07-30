# Battle Squads — multiplayer server

Authoritative WebSocket server. Clients send inputs; this process owns the world
and broadcasts snapshots at 20Hz.

It loads the game's own `js/weapons.js`, `js/combat.js`, `js/classes.js` and
`js/items.js`, so ballistics and the damage calculator are literally the same
code on both ends — there is no second copy of the numbers to drift.

## Run it locally

```bash
cd server
npm install
npm start          # listens on :8080
```

Then open the game pointed at it:

```
http://localhost:8000/?server=ws://localhost:8080
```

`/health` returns room and player counts if you want to check it's alive.

## Deploying

**It cannot go on Vercel.** Vercel Functions cap out at 300 seconds and cannot
hold a WebSocket open, so there is nowhere for an authoritative game loop to
live. The static site is fine there — only this server needs a different home.

Any host that keeps a process running works. All of these read `PORT` from the
environment, which this server already honours:

| Host | Setup |
|---|---|
| **Render** | New Web Service → point at this repo → Root Directory `server` → Build `npm install` → Start `npm start`. Free tier sleeps when idle. |
| **Railway** | New Project → Deploy from repo → set Root Directory to `server`. |
| **Fly.io** | `fly launch` inside `server/`, accept the Node defaults. |
| **Any VPS** | `npm install && npm start` behind nginx with a TLS proxy. |

Once deployed, either:

1. put the URL in `SERVER_URL` at the top of [`../js/net.js`](../js/net.js), or
2. append `?server=wss://your-host` to the game URL for a one-off test.

Use `wss://` (not `ws://`) from an HTTPS page — browsers block mixed content.

## Protocol

Client → server:

| Message | Fields | Meaning |
|---|---|---|
| `join` | `mode, name, weapon, skin` | Enter matchmaking |
| `input` | `up/down/left/right, shooting, ads, angle, fire` | Per-frame intent (30/s) |
| `reload` | — | Request a reload |
| `ping` | `c` (client clock) | Latency probe |

Server → client:

| Message | Fields |
|---|---|
| `welcome` | `id, team, mode, map, tickRate, roster` |
| `snapshot` | `tick, time, timeLeft, agents[], bullets[], events[]` |
| `pong` | `c` |
| `end` | `scores, roster` |

The client renders ~100ms behind the newest snapshot and interpolates between
the two that straddle that point — see `interpolated()` in `js/net.js`.

## What's authoritative

Movement, firing, damage, deaths and respawns are all decided here. Clients send
intent only, never positions, so a modified client can't teleport or claim kills.

Not yet server-side: the tactical layer (grenades, deployables, tools),
structures and doors, and objective capture. Those still run client-side in the
offline game; moving them across is the next step and needs the map to be shared
the same way the weapon tables already are.
