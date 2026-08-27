# Battle Squads — multiplayer server

Authoritative WebSocket server. Clients send inputs; this process owns the world
and broadcasts snapshots at 20Hz.

Rooms start themselves here, because there is no host to press the button: five
seconds after a second player arrives, or thirty seconds for somebody who is
still on their own, so the first person through the door is not left staring at
an empty island.

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

Any host that keeps a Node process alive works. This one reads `PORT` from the
environment already, and answers `/health` for a health check.

**Deploy the repository root, not `server/`.** The server loads the game's own
weapon, combat and class tables through [`../js/_shared.js`](../js/_shared.js),
and builds its map by running [`../js/game.js`](../js/game.js) in a sandbox —
that is why there is only one copy of the rules. A deploy that uploads only
this folder installs cleanly and then dies on the first `require`. The
[`Dockerfile`](../Dockerfile) and [`render.yaml`](../render.yaml) in the repo
root both do it correctly.

### Free hosts that can actually hold a socket open

Checked against each provider's own documentation rather than a listicle; free
tiers move, so re-check before relying on any of it.

| Host | What's free | Sleeps? | Good for |
|---|---|---|---|
| **Render** | 750 instance-hours/month (one service, continuously), WebSockets supported, free `*.onrender.com` with TLS, custom domains with automatic certificates | Yes — after 15 min with no HTTP request *and* no WebSocket message, ~1 min to wake | The easy answer. Use [`render.yaml`](../render.yaml) |
| **Northflank** | Sandbox: 2 services, **always-on, no sleeping**; card is verified but not charged | No | The easy answer if the cold start bothers you |
| **Oracle Cloud** | Always Free, perpetual: 2 AMD micro VMs (1 GB each), or ~2 ARM cores + 12 GB continuous, **10 TB/month out** | No | A real server, if you'll do TLS yourself |
| **Fly.io** | No free tier any more — about $2/month for one small always-on machine | — | Cheap, not free |

Render's sleep rule matters less than it sounds for a game: an occupied match
is never idle, because clients ping every two seconds. It costs the first
player of the day about a minute, nobody else.

On Oracle you get a bare VM, so terminate TLS yourself — Caddy is two lines and
gets a certificate automatically:

```
your.domain { reverse_proxy localhost:8080 }
```

### A domain for it

The host's own subdomain (`something.onrender.com`) already has a valid
certificate and needs no setup. For a nicer name:

- **[is-a.dev](https://is-a.dev)** — free `you.is-a.dev`, by pull request to
  [is-a-dev/register](https://github.com/is-a-dev/register). Cloudflare-backed.
- **[eu.org](https://nic.eu.org)** — free `you.eu.org`, approval takes ~2 weeks.
- **[js.org](https://js.org)** — free, but only for JavaScript libraries and
  tools, so a game is unlikely to qualify.

Point it at the host with a CNAME and let the host issue the certificate.
If you proxy through Cloudflare instead, WebSockets work on the free plan with
the orange cloud on — just note the 100-second idle timeout, which this game
never hits because snapshots and pings are always flowing.

### Bandwidth, so you know what you're spending

Eight players is roughly 1.9 KB per snapshot each, 20 times a second — about
1 GB per hour of a full match. Render's free bandwidth allowance is the thing
to watch; Oracle's 10 TB is not a constraint for a hobby game.

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
