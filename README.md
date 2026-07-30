# Battle Squads

A fast-paced **2D browser team shooter** with two game modes:

- **🚩 Domination** — 3 squads of 3 on a large 3400×2300 map; capture and hold three objectives,
  first squad to the score cap wins (like Delta Force).
- **💀 Elimination** — 6 squads of 4 in a tighter 2400×1600 arena; last squad standing,
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
| Open door / crate / grab ammo | `E` |
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
│   ├── classes.js      # 10 classes: base speed, tool, consumable + carry limit
│   ├── structures.js   # wall types, 9 building blueprints, decor props
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

2. **Move the rest of the sim server-side** — grenades, deployables, class tools,
   structures/doors and objective capture still run on the client. Weapons, the damage
   calculator and classes are already shared with the server.

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

> **The server cannot run on Vercel.** Vercel Functions cap at 300 seconds and
> can't hold a WebSocket open, so <https://battle-squads.vercel.app> serves the
> static game only and plays offline against bots. Deploy `server/` to any host
> that keeps a process alive — Render, Railway, Fly.io, a VPS — and put the URL in
> `SERVER_URL` at the top of [js/net.js](js/net.js). Full instructions and a host
> comparison are in [server/README.md](server/README.md).

With no server configured the game is exactly what it was: single-player vs bots.
The home screen shows which mode you're in.

Movement, shooting, damage and deaths are authoritative — a modified client can't
teleport or claim kills. Not yet moved server-side: the tactical layer (grenades,
deployables, tools), structures/doors, and objective capture.

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

The **Shop** tab spends what you earn. Nothing in it changes a combat stat —
there's a test asserting that.

| Category | What's in it |
|---|---|
| Weapon Skins | 15 skins over four rarities. Repaint your barrel, muzzle flash and tracers in-match. Account-wide, so a skin goes on any gun it fits. |
| Avatars | Profile icons, credits or squad coins. |
| Name Tags | Coloured callsign in the HUD and scoreboard. |
| Tracers | Bullet trail colours, independent of your skin. |
| Utility | A second loadout preset slot, XP boosts, callsign changes. |

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

Domination's larger board carries fourteen of them (~125 wall pieces), Elimination eight.
Doors open and close with `E`, and bots shove them open as they push through.

**Buildings are three times tougher than the raw design table.** `HP_SCALE` went from 10
to 30: a wood 0.3 wall is 90 HP instead of 30, metal 0.6 is 360, reinforced is 300. At the
old values a single fire-axe swing dropped a wall and buildings disintegrated before a
fight got going — a full match now ends with most of the map still standing. The table's
ratios between materials are untouched.

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
> **Not yet wired:** the Flare Launcher airstrike and Grenade Launcher fire mode are declared
> and carried onto the weapon but don't yet fire; suppressor audio is a stat with no sound
> model behind it; and vehicles are still AI-driven rather than drivable.

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
