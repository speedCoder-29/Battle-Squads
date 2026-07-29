# Battle Squads

A fast-paced **2D browser team shooter** with two game modes:

- **🚩 Domination** — 3 squads of 3 on a large 3400×2300 map; capture and hold three objectives,
  first squad to the score cap wins (like Delta Force).
- **💀 Elimination** — 6 squads of 4 in a tighter 2400×1600 arena; last squad standing,
  no respawns (like Fortnite).

This is a **baseline / prototype**: a complete front end (home page, accounts, settings,
daily missions, battle pass, loadout, matchmaking flow) plus a genuinely playable
single-player-vs-bots game for both modes. It is a **static site** with zero build step,
so it runs anywhere.

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
│   ├── weapons.js      # 30-weapon roster + ballistics + legendary modifiers
│   ├── classes.js      # 10 classes: base speed, tool, consumable + carry limit
│   ├── structures.js   # wall types (HP/toughness/ballistics) + building blueprints
│   ├── items.js        # consumables, loot-crate tables, legendary weapons
│   ├── storage.js      # localStorage persistence (accounts, profile, settings)
│   ├── audio.js        # procedural WebAudio SFX (no audio files needed)
│   ├── auth.js         # login / signup / guest / logout
│   ├── progression.js  # weapons, missions, battle pass, XP & rewards
│   ├── screens.js      # navigation, home rendering, settings, toasts
│   ├── matchmaking.js  # queue flow + "match found" overlay (simulated)
│   ├── game.js         # the 2D shooter: both modes, bots, HUD, scoring
│   └── main.js         # bootstrap + animated background particles
└── README.md
```

---

## What's real vs. simulated

This baseline runs **entirely in the browser** so you can ship it immediately:

- **Accounts & progression** are stored in `localStorage` (per browser/device).
- **Matchmaking** is simulated — it fakes a short search then starts a match **vs. bots**.
- **Multiplayer is single-player-vs-AI** for now.

### Making it truly online / multiplayer

To turn this into a real online game with shared accounts and live PvP, add a backend.
The code is structured so each piece swaps in cleanly:

1. **Real accounts** — replace the functions in `js/storage.js`
   (`createUser`, `verifyUser`, `getProfile`, `saveProfile`) with calls to your API.
   Recommended: a small **Node/Express** or **serverless** backend with a database
   (Postgres, Supabase, Firebase, etc.). Never store plain-text passwords server-side —
   hash them (bcrypt/argon2). The local version is for prototyping only.

2. **Real matchmaking + multiplayer** — replace `js/matchmaking.js` with a **WebSocket**
   connection (e.g. `socket.io`, or a service like Colyseus / PlayFab / Nakama). The
   server owns the authoritative game state; clients send inputs and render snapshots.
   In `js/game.js`, the `agents` array would be driven by server updates instead of local AI.

3. **Anti-cheat** — keep authoritative logic (damage, scoring, captures) on the server.

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

**Toughness vs Structure Pierce** is what ties the two tables together: a tool can only work a
wall whose Toughness its Pierce matches or beats, so a Bayonet (pierce 1) chops doors,
barricades and thin planks but bounces off metal, while the clearing effects are explicit
exemptions — the Bayonet still shreds barbed wire (toughness 5) and the Trench Spade still
clears sandbags (toughness 6). Explosives ignore toughness entirely: that's how a
Demolitionist makes an entry point through a reinforced wall.

Each map is assembled from **real buildings** — a **camp** of tents behind wire, a wooden
**house**, a **mansion** with a reinforced strongroom, and a **military base** whose metal
shell bounces rifle fire back at you — with the objectives out in the open ground between
them. Domination's larger board carries nine buildings (141 wall pieces) to Elimination's
five (81). Doors open and close with `E`, and bots shove them open as they push through.

> Two notes where the wall table was ambiguous: HP is the table's formula × 10 so the
> numbers land in a playable range (this makes a wood 0.3 door exactly the 30 HP the table
> lists for doors), and reinforced walls/doors are given **100 HP** rather than the listed 10 —
> at 10 HP they'd be the flimsiest thing on the map, which can't be the intent. Both knobs
> are `HP_SCALE` and the `hp` fields at the top of [js/structures.js](js/structures.js).
> Reinforced *walls* also don't "open and close" — that line looks copied from the door row.

## Weapons, consumables & loot

- **30 weapons across 10 classes** ([js/weapons.js](js/weapons.js)) — the design roster with real
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

> Currently functional as gameplay: all weapon ballistics, every class tool and consumable,
> the full wall table (penetration, ricochet, destruction, doors), buildings, every
> grenade/tactical/heal, crates, legendary weapons, adrenaline, and AI-driven call-in vehicles.
> Bots use their class speed, open doors and melee you at point-blank range.
> **Not yet wired to combat:**
> specialized ammo types (AP/HP/Tracer/Slug), weapon attachments (Suppressor, Grenade Launcher, etc.),
> and *drivable* vehicles (call-ins currently fight as allied AI). These are the natural next steps.

## Tuning knobs

Quick things to tweak while designing your game:

- **Weapons** — the `RAW` table in `js/weapons.js` (edit stats inline; the builder derives the rest).
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
