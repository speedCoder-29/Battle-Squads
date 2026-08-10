# Battle Squads

A fast-paced **2D browser team shooter** with two game modes:

- **🚩 Domination** — squads on a large 4600×3100 map; capture and hold three objectives,
  first squad to the score cap wins (like Delta Force).
- **💀 Elimination** — 6 squads of 4 across a 3200×2200 arena; last squad standing,
  no respawns (like Fortnite).

A complete front end (home page, accounts, settings, daily missions, battle pass,
loadout, gunsmith, shop, matchmaking) plus a genuinely playable game for both modes —
offline against ten levels of bot, or online through the authoritative server in
[`server/`](server/). The game itself is a **static site** with zero build step.

---

## Run it locally

Because the game loads several `.js` files, open it through a tiny local web server
(opening `index.html` directly with `file://` works in most browsers but a server is safest):

```bash
# from inside the battle-squads folder — pick whichever you have:
python -m http.server 8000
#   → open http://localhost:8000

npx serve .
#   → open the URL it prints
```

Then create an account (or hit **Play as Guest**), pick a mode, and **Deploy**.

### Controls
| Action | Key |
|--------|-----|
| Move | `W A S D` / arrows |
| Aim | Mouse |
| Shoot | Left click (auto = hold, semi = click) |
| Aim down sights (tighten spread) | Right click (hold) |
| Reload | `R` |
| Dash | `Shift` |
| Throw grenade | `Q` |
| Deploy tactical | `C` |
| Use heal / boost | `F` |
| Class tool (swing / toggle) | `V` |
| Call in vehicle token | `B` |
| Pick up loot / open door / crate | `E` |
| Call airstrike (Flare Launcher) | `G` |
| Pause | `Esc` |

---

## Put it online

It's a plain static site — upload the whole `battle-squads` folder to any host:

- **GitHub Pages** — push the folder to a repo, enable Pages on the branch. Done.
- **Netlify / Vercel / Cloudflare Pages** — drag-and-drop the folder, no config needed.
- **itch.io** — zip the folder and upload as an HTML5 game.
- **Any web server** — copy the folder into your web root.

No compilation, bundler, or environment variables required.

---

## Project structure

```
battle-squads/
├── index.html          # all screens (auth, home, game) in one page
├── css/styles.css      # full theme + layouts + animated background
├── js/
│   ├── weapons.js      # 30-weapon roster + ballistics + attachments + ammo
│   ├── combat.js       # the damage calculator (types, zones, armour, adrenaline)
│   ├── skins.js        # cosmetic weapon skins
│   ├── shop.js         # what coins buy: skins, avatars, tags, tracers, utility
│   ├── botai.js        # 10 bot difficulty levels (aim / survival / teamwork)
│   ├── net.js          # multiplayer client: transports + snapshot interpolation
│   ├── party.js        # party lobby: invite codes, roster, deploy together
│   ├── classes.js      # 10 classes: base speed, tool, consumable + carry limit
│   ├── structures.js   # wall types + 13 building blueprints
│   ├── terrain.js      # seeded island: ocean, beach, grass, river, bridges, roads
│   ├── sprites.js      # all world art + furniture, drawn as canvas vectors
│   ├── items.js        # consumables, loot-crate tables, legendary weapons
│   ├── storage.js      # localStorage persistence (accounts, profile, settings)
│   ├── audio.js        # procedural WebAudio SFX (no audio files needed)
│   ├── auth.js         # login / signup / guest / logout
│   ├── progression.js  # weapons, missions, battle pass, XP & rewards
│   ├── screens.js      # navigation, home rendering, settings, toasts
│   ├── matchmaking.js  # queue flow + "match found" overlay (simulated)
│   ├── game.js         # the 2D shooter: both modes, bots, HUD, scoring
│   └── main.js         # bootstrap + animated background particles
├── server/             # authoritative multiplayer server (deploy separately)
│   ├── server.js
│   ├── package.json
│   └── README.md       # how to run and where to host it
└── README.md
```

---

## What's real vs. simulated

This baseline runs **entirely in the browser** so you can ship it immediately:

- **Accounts & progression** are stored in `localStorage` (per browser/device).
- **Multiplayer is real** but needs the server in `server/` running somewhere — see
  [Multiplayer](#multiplayer). With no server configured you play offline against bots.

### Still to do for a full online game

1. **Real accounts** — replace the functions in `js/storage.js`
   (`createUser`, `verifyUser`, `getProfile`, `saveProfile`) with calls to your API.
   Recommended: a small **Node/Express** or **serverless** backend with a database
   (Postgres, Supabase, Firebase, etc.). Never store plain-text passwords server-side —
   hash them (bcrypt/argon2). The local version is for prototyping only.

2. **Move the rest of the sim server-side** — grenades, deployables, class tools and
   doors still run on the client. Weapons, the damage calculator, classes, the map
   itself, wall destruction and objective capture are all shared with the server.

---

## Classes & tools

Your **class is your gun** — every weapon belongs to one of the ten classes, so equipping an
M16 deploys you as a Rifleman and a P90 deploys you as Assault. Each class brings a base
movement speed, a signature tool on `V`, and the only consumable you spawn with (capped at
that class's carry limit — crates top you back up to it, never past it).

| Class | Speed | Tool | Consumable | Limit |
|---|---|---|---|---|
| Rifleman | 1× | Bayonet — *clears barbed wire* | 3× Frag | 6 |
| Scout | 1.25× | Binoculars — *2× zoom (can't shoot)* | 3× Pills | 4 |
| Gunner | 1× | Trench Spade — *clears sandbags, digs trenches* | 1× Ammo Box | 3 |
| Assault | 1.1× | Fire Axe — *3× wood damage* | 3× Smoke | 3 |
| Breacher | 1× | Riot Shield — *frontal immunity while scoping, −50% speed, scope to shoot* | 3× Flashbang | 6 |
| Marksman | 1× | Night Vision Goggles — *+25% spotting, marks enemies* | 2× Impact Grenade | 4 |
| Sniper | 1× | Ghillie Suit — *invisible to bots while still in grass* | 2× Mine | 2 |
| Engineer | 1× | Stone Hammer — *builds stone walls* | 1× Sentry Gun | 1 |
| Medic | 1.1× | Defibrillator — *instant revive, 60s* | 1× Medkit | 2 |
| Demolitionist | 1× | Heat Vision Goggles — *see bodies through walls* | 3× C4 | 9 |

Melee tools have **damage, reach, structure damage, pierce and a cooldown**
([js/classes.js](js/classes.js)). Swing a hammer or spade at open ground and you **build**
or **dig in** instead of striking.

## Parties

Squad up and play with people you know. **Create Party** on the Play screen gives
you a five-character code; anyone who enters it — or opens your invite link —
joins your lobby, and when the leader hits **Deploy Squad** everyone lands in the
same room, on the same team.

- Up to four to a party, leader shown, roster live for everyone.
- The leader picks the mode and is the only one who can deploy.
- **Copy link** produces `…/?party=CODE&server=…`, and opening that link joins
  straight away.
- Bad codes, full parties and disconnects are all handled: dropping out removes
  you from the roster, and an empty party is cleaned up.

Parties are a server-side concept — two people on different machines have to meet
somewhere — so the panel needs the multiplayer server running. Without one it
says so rather than pretending.

## Multiplayer

There is a real authoritative server in [`server/`](server/). Clients send inputs;
the server owns movement, firing, damage and respawns, and broadcasts snapshots at
20Hz. Clients render ~100ms behind and interpolate. The server loads the game's own
`weapons.js`, `combat.js` and `classes.js`, so ballistics and the damage calculator
are the same code on both ends rather than two copies that drift.

```bash
cd server && npm install && npm start      # :8080
# then open the game with  ?server=ws://localhost:8080
```

### Playing on the Vercel link (no server)

Vercel serves static files and cannot hold a socket open, so instead **one
player's browser hosts**: it runs the same authoritative simulation
([js/roomsim.js](js/roomsim.js)) the Node server runs, and everyone else
connects straight to it.

On the Play screen, under **Squad**:

| Button | What it does |
|---|---|
| **Host Game** | You become the host and get a 5-character code. Share the code or the link. |
| **Join Game** | Enter someone's code and connect to them. |
| **Test in two tabs** | Same machine, no network at all — the quickest way to see the netcode working. |

Peers are introduced by a small public WebRTC broker, then talk **directly** to
each other; the game traffic never goes through a third party. The host is
authoritative exactly as the server is — peers send inputs, never positions,
and there's a test asserting a peer can't teleport itself.

Sharing `…/?game=CODE` joins that game straight away.

#### What the room simulates

Anything that decides a fight has to be owned by the room, or two players
disagree about it — so all of it is:

| | |
|---|---|
| **Movement** | Collision, terrain (ocean, rivers, bridges, roads and sand all change your speed), barbed wire (90% slower, 2 damage/s), trenches and the 50% dodge for anyone dug in |
| **The map** | Doors, destructible cover with per-wall toughness and ballistics, barrels cooking off and chaining, deployed barricades as real geometry |
| **Shooting** | Ballistics, penetration and ricochet, falloff, hit zones, armour, adrenaline, sentry fire, mounted vehicle guns |
| **Consumables** | Frags, impacts, C4, smoke and flashbangs (line of sight checked against the room's own geometry); mines, sentries, ammo boxes, flags, barricades; every heal, channelled with a clock the room runs |
| **Loot** | Crate contents, who opened one first, ground drops, who picked one up first, armour tiers, legendaries, what you scatter when you die |
| **Vehicles** | Every hull on the map — the ones a call-in token drops *and* the ones parked in garages and car parks — plus who is in the driver's seat, driving, terrain underneath, the gun on top, and what small arms do to a tank (nothing) |
| **The match** | Capture points, scores, the clock, respawns, melee tools — reach, arc, breaching and wire clearing all read off your class, never off the wire |

Nothing a client sends is taken as a statement of fact. Every action is a
request listed in `Room.handle` ([js/roomsim.js](js/roomsim.js)); the room
decides the outcome and puts it in the snapshot. A modified client can ask to
throw a grenade, but not to throw one with a 900px blast, and not one it has
already thrown.

Three things keep it in sync and smooth.

**Input acknowledgement.** Every packet is numbered and the room echoes back
the last one it acted on, so the client replays exactly the inputs still in
flight rather than guessing the window from half a ping.

**One clock for the whole world.** The client draws a fixed lag behind the
room, interpolating between the two snapshots that straddle render time.
Players always did; everything else used to be written straight out of the
newest snapshot as it landed, so it moved in twenty steps a second while the
players around it glided — and the two were on different clocks, which drew a
passenger a tenth of a second behind the jeep he was sitting in. Measured on a
jeep driven in a straight line: 57 of 87 frames frozen, ±4.18px of step
variation, against 0 frozen and ±0.20px now. What you are driving yourself is
predicted locally and eased onto the room's answer, so the wheel stays
responsive.

**Personal snapshots.** Your inventory and your acknowledgement are yours
alone, and the scenery is culled to what you can see — on a busy map that is
65 KB/s a player instead of 146.

Limits worth knowing: the host carries the simulation, so pick the strongest
machine, and if the host leaves the match ends.

#### If a code won't connect

Two peers need a network path to each other, and STUN alone can't always find
one. PeerJS ships default relays — `eu-0.turn.peerjs.com` and
`us-0.turn.peerjs.com` — that **no longer exist**; public DNS returns no
address for either, so the library's out-of-the-box config is one STUN server
and two dead entries. [js/p2p.js](js/p2p.js) therefore states its own ICE
config: four STUN vendors, so one being down doesn't take multiplayer with it.

STUN is enough for two ordinary home routers to punch a hole to one another.
It is not enough for a **symmetric NAT** — most mobile networks, many
workplaces and schools — because that kind of router uses a different port per
destination, so the address STUN reported isn't the one the other side can
reach. Those joins need a **TURN relay**, and TURN can't be free: the relay
carries the whole match, so someone pays for the bandwidth. Every public one
that used to be listed here has since been withdrawn.

Point the game at your own (Metered, Cloudflare Calls, ExpressTurn, or a coturn
box) either per-session in the URL:

```
?turn=turn:your.host:3478&turnUser=NAME&turnPass=SECRET
```

…or permanently, via the `TURN` constant near the top of
[js/p2p.js](js/p2p.js). Give it a `:443` or `?transport=tcp` entry as well as
the UDP one — the networks that need a relay usually block UDP too. Without a
relay the game still works for most pairs of players; it just can't promise it,
and a failed join now says so instead of blaming your code.

For anything beyond testing, run the dedicated server below.

> **The dedicated server cannot run on Vercel.** Vercel Functions cap at 300 seconds and
> can't hold a WebSocket open, so <https://battle-squads.vercel.app> serves the
> static game only and plays offline against bots. Deploy `server/` to any host
> that keeps a process alive — Render, Railway, Fly.io, a VPS — and put the URL in
> `SERVER_URL` at the top of [js/net.js](js/net.js). Full instructions and a host
> comparison are in [server/README.md](server/README.md).

With no server configured the game is exactly what it was: single-player vs bots.
The home screen shows which mode you're in.

The client plays a real networked match: it sends inputs at 30/s, renders the
server's snapshot 100ms behind with interpolation between the two that straddle
that moment, and draws remote players with their name and team colour. Your own
HP, ammo and adrenaline come from the server; your position stays locally
predicted so aiming is responsive, snapping back if it drifts too far.

Movement, shooting, damage and deaths are authoritative — a modified client can't
teleport or claim kills. Not yet moved server-side: the tactical layer (grenades,
deployables, tools) and doors.

### One world, not two

The map is never sent over the wire. Every client generates it, and the room hands
out the **seed** it was generated from, so everyone builds the same one — same
buildings, same river, same loot, down to the pixel. A client that has already built
a world when the welcome arrives throws it away and rebuilds from the host's seed.

Generation is seeded end to end: `Math.random` is swapped for a small deterministic
generator while the map is built, so two machines that start from one number finish
with byte-identical worlds. `ROOM_SEED=<n>` pins the seed on the dedicated server when
you want to fight the same ground twice.

The simulation knows about that world too:

- **Walls stop players and rounds.** The host hands the room its geometry
  (`Game.netWorld()`); the Node server generates the same thing headlessly through
  `buildWorld()` in [js/_shared.js](js/_shared.js). Without it players walked through
  buildings everyone could see.
- **Cover is destroyed once, for everyone.** Wall HP lives in the room. Each wall
  carries the index it had at generation time, so "wall 214 is down" is one number on
  the wire, and a player joining halfway is told which walls have already come down.
- **Capture points are decided by the host.** Progress, ownership and score come back
  in the snapshot instead of each client guessing from the handful of players it can
  see.

## Bot difficulty

Ten levels ([js/botai.js](js/botai.js)), set in Settings. Each level blends three
independent traits, and every bot gets a little individual jitter so a squad isn't
nine identical robots.

| Trait | What it controls |
|---|---|
| **Aim** | Aim error (0.30 → 0.012 rad), reaction time (850ms → 90ms), turn rate, whether they lead moving targets, and range discipline |
| **Survival** | Retreating when hurt, using heals, preferred standoff distance, strafing/dodging, reloading in cover |
| **Teamwork** | Squad cohesion and spacing, focus-firing whatever a squadmate is shooting, sharing contacts, pushing objectives together |

Level 1 is a distracted rookie who never retreats and fights alone. Level 10 reacts
in 90ms, leads every shot, breaks contact at 45% HP, heals, and focus-fires with its
squad. Contact-sharing unlocks at level 5; heals at level 3.

### Getting around the map

Routing is A* over a coarse grid ([js/nav.js](js/nav.js)). A cell counts as walkable
when a player standing at its **centre** would fit, and a step between two cells is
allowed only if the line between their centres is clear — checked once when the grid
is built, diagonals included.

The obvious rule (block a cell if a wall touches it anywhere) does not survive a map
with 1500 pieces of cover: a 12px wall closed a 90px corridor and a crate closed the
cell it sat in, three quarters of the world came out impassable, and A* simply failed
— which is why bots used to grind into buildings instead of walking round them. With
the centre rule, 30% of cells are blocked and a route is found most of the time.

Doors are routed **through** rather than around, and a bot that finds itself stopped
at one opens it. Otherwise every building — and every capture point inside one — is
sealed.

## Weapon stats & survev

The roster's numbers are joined directly from survev's source
([`gunDefs.ts`](https://github.com/leia-uwu/survev/blob/master/shared/defs/gameObjects/gunDefs.ts)
and [`bulletDefs.ts`](https://github.com/leia-uwu/survev/blob/master/shared/defs/gameObjects/bulletDefs.ts)),
gun by gun:

| Ours | survev source | What transfers |
|---|---|---|
| damage | `bullet_<gun>.damage` | directly — survev is also per-100 HP |
| fire rate | `1 / gunDef.fireDelay` | ak47 `0.1s` → 10 rps |
| mag / reload | `maxClip` / `reloadTime` | directly |
| accuracy | `gunDef.shotSpread` (deg) × 1.586 | same cone in our radian model |
| **move spread** | `gunDef.moveSpread` | new mechanic — see below |
| falloff | `(1 − bulletDef.falloff) × 50` | steep falloff = low survev number |
| range / velocity | `bulletDef.distance` / `.speed` | per-gun, not per-type |

Spot checks: AKM = 13.5 dmg @ 10 rps (ak47), Vector = 7.5 @ 26.3 (vector),
M249 = 14 dmg / 100 mag / 6.7s (m249), PKP = 18 / 200 belt / 5s, Mk 14 = 28 @ 4.35
(m39), SVD = 37 @ 4, Barrett = 99 (barrett), SV-98 = 80, M870 = 12.5 × 9 buckshot.
There are tests asserting these against the source numbers.

**Move spread is now a real mechanic.** Firing while moving widens your cone by the
gun's own `moveSpread`, scaled by how fast you're going, and aiming down sights cuts
it by half. It's a big differentiator: the Uzi (MAC-10, 11°) sprays wildly at a run
while the QBZ-95B bullpup (QBB-97, 0.5°) barely notices — a 22× difference that the
old per-type model couldn't express at all.

**Documented deviations**, all because our roster isn't 1:1 with theirs:

- K11 and AN-94 are 3- and 2-round bursts here; survev's nearest guns are full-auto,
  so their damage is scaled to fit a sane burst count.
- P90 is interpolated between survev's MP5 and UMP9 — we need a full-auto SMG with a
  50-round mag and neither is quite that.
- RPK-74 takes the BAR's round with the DP-28's cyclic rate.
- SV-98, QBU-10, DEagle and the FAMAS burst cycle slightly faster than survev's,
  purely so each class stays inside its TTK band.
- Launchers have no survev counterpart and keep our own tuned values.

## Damage calculator

Every point of damage in the game goes through one function
([js/combat.js](js/combat.js)), so these tables are the whole combat model:

```
raw damage → damage-type vs target-class → hit zone → armour → adrenaline
```

**Damage type vs target.** What a round is decides whether it can hurt what it hits.

| | Normal | AP | Explosive | HEAT |
|---|---|---|---|---|
| Infantry (100 HP) | 100% | 100% | 100% | 100% |
| Armored Jeep (150 HP) | 10% | 20% | 50% | 100% |
| Tank (250 HP) | 0% | 0% | 25% | 50% |

A tank is not tough because it has a big health bar — it is tough because rifle
rounds do literally nothing to it. Bring the RPG-7 (the roster's HEAT weapon) or
at least explosives. The Barrett counts as AP natively, thanks to its
Anti-Materiel tag.

**Hit zones.** There is no vertical aim in a top-down game, so each hit rolls a
zone using the design's size weights. Limb 50% (2/5), body 100% (2/5), head
200% (1/5) — which averages to exactly 1.0×, so the DPS maths above still holds;
zones add variance and headshot payoff, not power. Explosions always count as
body hits, and barbed wire bypasses zones entirely.

**Armour** drops from crates (T1 from regular, T2 from silver, T3 from gold) and
costs you movement speed. Vests scale body damage; helmets replace the 200%
headshot multiplier — a Helmet T3 is exactly what stops a sniper one-shotting you.
Penetration buffs deliberately do nothing against armour.

| Tier | Vest | Helmet |
|---|---|---|
| T1 | 70% body damage, −15% speed | 150% head damage, −7% speed |
| T2 | 40% body damage, −30% speed | 100% head damage, −14% speed |
| T3 | 10% body damage, −45% speed | 50% head damage, −21% speed |

**Adrenaline** (from Pills/Soda/Stim/Flag) gives *Adren%/2* as movement, reload
and handling speed — so at 100 adrenaline you move, reload and aim 50% faster —
plus damage reduction that steps at 25/50/75/100% for 5/20/35/50%.

## Attachments & specialized ammo

Both are picked per weapon in the **gunsmith** panel at the top of the Loadout
screen, which shows live stat deltas as you toggle them. Each weapon only offers
what its roster row allows.

| Attachment | Buff | Debuff |
|---|---|---|
| Grenade Launcher | Throw grenades while holding your primary | −10% Speed, +25% Handling |
| Scope | −50% Scope (2× magnification) | +50% Handling |
| Suppressor | −75% Firing Audio | −5% Damage |
| Bipod | −50% Scoping Recoil | −100% Scoping Movement Speed |
| Sawed-Off | −50% Weight, −50% Reload | +50% Accuracy (wider cone), +50% Scope |
| Flare Launcher | Single-use airstrike | −5% Speed, +50% Handling |

| Ammo | Buff | Debuff |
|---|---|---|
| AP | +50% Penetration (and counts as AP damage) | +50% Recoil |
| Tracer | Glowing rounds | Glowing rounds — they see you too |
| HP | +25% Damage | −50% Penetration |
| Slug | +900% Damage, +50% Penetration, −50% Falloff | +50% Recoil, +50% Weight, −8 Pellets |
| Birdshot | +100% Pellets, −50% Recoil | +50% Falloff, −50% Penetration |

**Penetration** is a wall-punching stat: it cuts how much damage a round loses
passing through cover (see the wall table below). It does nothing against armour.

## Shop & skins

The **Shop** tab spends what you earn — over 40 items across seven categories.
Nothing in it changes a combat stat; there's a test asserting that.

| Category | What's in it |
|---|---|
| Weapon Skins | 15 skins over four rarities. Repaint your barrel, muzzle flash and tracers in-match. Account-wide, so a skin goes on any gun it fits. |
| Avatars | Profile icons, credits or squad coins. |
| Name Tags | Coloured callsign in the HUD and scoreboard. |
| Tracers | Bullet trail colours, independent of your skin. |
| Emotes | Quick squad signals — rally here, enemy spotted, good game. |
| Squad Banners | Shown on your party card. |
| Utility | Loadout preset slots, XP boosts, callsign changes, credit bundles. |

Skins are also equippable from the gunsmith panel in the Loadout screen, which
previews the paint on the weapon and shows live stat deltas for attachments and
ammo. A couple of skins are type-restricted — Cold Bore only mounts on a Sniper
Rifle or DMR.

## Walls & buildings

Every wall on the map is a typed, destructible piece ([js/structures.js](js/structures.js)).
**Height** decides sight (high walls block it, low cover doesn't), **HP** how long it lasts,
**Toughness** which tools can work it, and the effect column what bullets do on contact.

| Wall | Height | HP | Toughness | Effect |
|---|---|---|---|---|
| Wood | High | 10 × thickness | 1–3 | Bullets pass through, losing 10% damage per 0.1 thickness |
| Metal | High | 20 × thickness | 4 | Same, up to 0.5 thickness — above that bullets ricochet for 50% |
| Door | High | 30 | 1 | Opens and closes (`E`). Wood, 0.3 thick, 1.5 long |
| Reinforced Door | High | 100 | 5 | Opens and closes · bullets ricochet for 50% |
| Reinforced Wall | High | 100 | 5 | Bullets ricochet for 50% |
| Barbed Wire | Low | 30 | 5 | 90% movement slowdown inside · 2 damage/s |
| Sand Bags | Low | 100 | 6 | Stops bullets outright |
| Barricade | Low | 50 | 1 | Bullets lose 50% damage passing through |
| Trench | Underground | 1 | 6 | Infantry inside dodge 50% of incoming fire |

**Toughness** is the ladder that decides what can break what:

| Toughness | Meaning |
|---|---|
| 1 | Destructible by anything — including plain rifle fire |
| 2 | Destructible by some melees (Structure Pierce 2+) |
| 3 | Destructible by the Stone Hammer (Pierce 3) |
| 4+ | Destructible by HEAT weapons |

A tool's **Structure Pierce** is what it out-ranks: a Bayonet (pierce 1) chops doors,
barricades and thin planks but bounces off metal. Explosives handle up to toughness 3;
only HEAT gets through metal and reinforced walls. The clearing effects are explicit
exemptions on top — the Bayonet still shreds barbed wire (toughness 5) and the Trench
Spade still clears sandbags (toughness 6) regardless.

One consequence worth knowing: normal rounds only *demolish* toughness-1 walls. They
still shoot *through* thicker cover per the penetration rules — you just can't level a
house with a rifle.

Each map is assembled from **nine building types**, each built from materials that make
it play differently:

| Building | Made of | How it plays |
|---|---|---|
| **House** | Wood 0.3 | Breachable with a fire axe; two doors, one divider |
| **Mansion** | Wood 0.4 + reinforced core | Four ways in, a strongroom you need explosives for |
| **Military base** | Metal 0.6 | Ricochets rifle fire back at you; reinforced doors |
| **Warehouse** | Metal 0.55 | Big open hall, staggered racking, no straight sightline |
| **Bunker** | Reinforced 0.5 | Walls need HEAT — the doors are the fight |
| **Watchtower** | Reinforced 0.4 | Tiny footprint, commanding sightline, hard to dig out |
| **Shanty row** | Wood 0.2 | Four flimsy shacks; make your own door anywhere |
| **Fuel depot** | Metal tanks + sandbags | Open ground, all low cover — plays unlike a building |
| **Camp** | Barricade tents | Low cover behind wire |
| **Apartments** | Wood 0.45 | A corridor with eight doored rooms — the densest CQB on the map |
| **Hangar** | Metal 0.65 | Enormous open shed with a blast door; all about the approach |
| **Farm** | Wood 0.35 + fences | Barn and yard, flimsy throughout — a Breacher's map |
| **Checkpoint** | Sandbags + reinforced post | A chicane that breaks up open ground |

Domination's board carries twenty of them (~190 wall pieces), Elimination twelve. With that
many segments, walls are bucketed into a **uniform spatial grid** so line-of-sight, collision
and bullet checks only test the cells they actually touch — without it the per-frame cost
scaled with the whole map.
Doors open and close with `E`, and bots shove them open as they push through.

**Buildings are three times tougher than the raw design table.** `HP_SCALE` went from 10
to 30: a wood 0.3 wall is 90 HP instead of 30, metal 0.6 is 360, reinforced is 300. At the
old values a single fire-axe swing dropped a wall and buildings disintegrated before a
fight got going — a full match now ends with most of the map still standing. The table's
ratios between materials are untouched.

## Inventory & loot

You carry **3× the design table's counts** with a generic cap of 8 for anything outside your
class kit, and loot is dense — 30 crates on the domination map, 20 on elimination.

**Nothing is ever silently destroyed.** Picking up an item that doesn't fit drops the excess
at your feet instead of binning it, and swapping to a different item in an occupied slot puts
the old stack on the ground rather than deleting it. Drops bob, merge with identical nearby
piles, time out after 90s, and are picked back up with `E`. There's a test asserting the
invariant directly: *what you end up carrying plus what hits the floor always equals what you
were given.*

## The map

Laid out the way surviv.io/survev arranges an island, generated from a seed so a
given map is reproducible:

```
ocean ──► beach ──► grass interior
                      │
             a river winds through it, crossed by
             bridges, with roads linking the
             built-up areas
```

Each surface does something to you ([js/terrain.js](js/terrain.js)):

| Surface | Effect |
|---|---|
| Road | 1.12× move speed — the fast way across the map |
| Grass / bridge | normal |
| Beach | 0.92× — sand drags |
| River | 0.55×, swimming |
| Ocean | 0.45×, swimming — the map border |

The river never cuts the map in two: three bridges always cross it, and they're
walkable even though the water isn't. Buildings are placed terrain-aware — a
placement that would straddle the river gets nudged to a nearby spot rather than
being cut in half, and loose cover that lands in water is simply dropped. Crates
and props are kept out of the water and off the roads.

## Art

Everything used to be an emoji, which meant a different-looking game on every
machine. All of it is now **vector sprites drawn in canvas**
([js/sprites.js](js/sprites.js)) in a consistent top-down style: flat fills, a
darker outline, one light source. Sixteen kinds — trees, palms, bushes, boulders,
crates, barrels, pallets, tyres, cones, rubble, antennas, signs, tents, sandbag
piles, shipping containers, stumps.

> On sprites: I couldn't use survev's actual image assets. They're a commercial
> game's art, and vendoring them into a public repo is a redistribution problem
> rather than a technical one. The style is matched; the pixels are drawn here,
> which also keeps the game a zero-asset static site that renders identically
> everywhere.

## Buildings you go inside

Buildings are places, not wall rings. Each one has a **floor** in its own
material, **furniture** against the walls, **loot** in the middle worth
committing to, and a **roof** that hides all of it until someone on your team
steps in — at which point it fades out rather than snapping.

| Building | Furnished with | Loot |
|---|---|---|
| House / Apartments / Shanty | beds, tables, shelves, stoves, toilets | 2–4 crates |
| Mansion | beds, desks, lockers, shelves | 4 crates |
| Warehouse / Hangar / Base | ammo boxes, lockers, desks, shelves | 4 crates |
| Bunker / Tower / Checkpoint | lockers, ammo boxes, desks | 1–3 crates |
| Farm / Depot / Camp | shelves, tables, stoves | 2 crates |

Furniture is placed against the inside of the walls and never overlapping them;
crates go toward the middle. Indoor loot is re-checked once the whole map is
final, so a wall placed later can't end up sitting on a crate.

## Scale

Framing matches survev's: the camera sits at **1.45×** so a player and the
things around them fill a good part of the screen, the player is r22, and every
prop scales with them — a tree is wider than a person, a container wider still.
Aiming down sights and the binoculars both scale relative to that base rather
than fighting it.

## Obstacles you can fight with

Props aren't scenery — following survev, the things lying around the map are
objects you shoot, break and hide behind. They're wall types like any other, so
they inherit HP, toughness, the spatial index and tool breaching for free.

| Prop | HP / Toughness | What it does |
|---|---|---|
| **Crate** | 90 / T1 | Breaks open and spills loot on the ground |
| **Barrel** | 70 / T1 | Cooks off for 85 damage — and sets off any barrel near it, a beat later |
| **Tree** | 160 / T2 | Blocks sight and gunfire until you bring it down |
| **Boulder** | 400 / T4 | Hard cover; needs HEAT or the Stone Hammer |
| **Container** | 500 / T4 | Steel: bullets ricochet off it |
| **Bush** | 40 / T1 | Passable, and hides anyone standing still inside it |

Bushes work like the Ghillie Suit but for everyone: stand still in one and bots
lose track of you. Barrel chains are staggered rather than simultaneous, so a
fuel depot goes up pop-pop-pop. Whoever shot a barrel gets credit for what it
kills.

## Shadows & decor

One low sun, so everything casts consistently. Shadows are drawn as a separate pass
underneath the objects that cast them, so nothing ever shades something it should be
beneath: tall walls throw a shadow proportional to their thickness, low cover gets a
tighter softer one, and units and props get flattened elliptical shadows.

Twelve **decor** kinds — trees, bushes, rocks, crates, barrels, pallets, tyres, cones,
rubble, antennas, signs — are scattered per map. They're purely visual: they never
collide, block a bullet, or break line of sight, and they're filtered so nothing spawns
growing out of a wall. There are tests holding them to that.

> Two notes where the wall table was ambiguous: HP is the table's formula × 10 so the
> numbers land in a playable range (this makes a wood 0.3 door exactly the 30 HP the table
> lists for doors), and reinforced walls/doors are given **100 HP** rather than the listed 10 —
> at 10 HP they'd be the flimsiest thing on the map, which can't be the intent. Both knobs
> are `HP_SCALE` and the `hp` fields at the top of [js/structures.js](js/structures.js).
> Reinforced *walls* also don't "open and close" — that line looks copied from the door row.

## Weapons, consumables & loot

- **30 weapons across 10 classes** ([js/weapons.js](js/weapons.js)) — stats matched to survev
  (see below) with real
  ballistics: damage, burst, pellets, fire rate, mag/reload, accuracy→spread, recoil→bloom,
  weight→mobility, damage falloff, and explosive splash. Browse them by class in the **Loadout** screen.
- **Consumables** ([js/items.js](js/items.js)) — grenades (Frag, Impact, C4, Smoke, Flashbang),
  tactical deploys (Mine, Barricade, Ammo Box, Sentry Gun, Cool Flag), heals/boosts (Medkit,
  Bandage, Pills, Soda, Stim), and vehicle call-in tokens (Armored Jeep, Tank).
- **Loot crates** spawn on the map — walk up and press `E`. Regular / Silver / Gold tiers roll from
  the design's weighted drop tables. A "Class Consumable" roll refills **your** class kit; gold crates
  can drop a **Legendary ("Gold") weapon** — a buffed variant of the best gun in your class — or a
  **vehicle token**.
- **Adrenaline** is a boost resource (from Pills/Soda/Stim/Flag) that grants +25% move speed while active.

> Currently functional as gameplay: all weapon ballistics, the full damage calculator
> (damage types, hit zones, armour, adrenaline), attachments and specialized ammo, skins,
> every class tool and consumable, the full wall table (penetration, ricochet, destruction,
> doors), buildings, every grenade/tactical/heal, crates, legendary weapons, and AI-driven
> call-in vehicles. Bots use their class speed, open doors and melee you at point-blank range.
> Every attachment and tool now does something: the **Flare Launcher** calls a real
> once-per-match airstrike on `G`, the **Grenade Launcher** nearly doubles your throw range,
> the **Suppressor** genuinely keeps you quiet (unsuppressed shots make nearby bots turn and
> investigate), and the **vision gadgets** sweep for contacts and mark them for the whole
> squad for six seconds when you switch them on — heat sees through walls, the others need
> line of sight. **Still not wired:** vehicles are AI-driven rather than drivable.

## Tuning knobs

Quick things to tweak while designing your game:

- **Weapons** — the `RAW` table in `js/weapons.js` (edit stats inline; the builder derives the rest).
  `ATTACHMENTS` and `AMMO_TYPES` live in the same file.
- **Damage model** — `TARGETS`, `HIT_ZONES`, `VESTS`, `HELMETS`, `ADREN_DR` in `js/combat.js`.
- **Skins** — the `SKINS` table and `RARITIES` pricing in `js/skins.js`.
- **Classes & tools** — `TOOLS` and the `RAW` class table in `js/classes.js`.
- **Walls & buildings** — `WALL_TYPES` and the `BUILDINGS` blueprints in `js/structures.js`;
  where they get placed is `buildMap()` in `js/game.js`.
- **Consumables / crates / legendaries** — `CONSUMABLES`, `CRATE_TABLES`, `LEGENDARY_MODS` in `js/items.js`.
- **Modes / teams / map size** — constants at the top of `js/game.js`: `MAP_SIZES` (per-mode
  board dimensions), `TEAM_SETUP` (squad count and squad size per mode), `SCORE_CAP`,
  `MATCH_SECONDS`. Spawns spread themselves evenly around the edge for any team count,
  and the building layouts live in `buildMap()`.
- **Missions & Battle Pass** — pools and tiers in `js/progression.js`.
- **Look & feel** — CSS variables at the top of `css/styles.css`.

Have fun — squad up. 🎮
