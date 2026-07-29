# Battle Squads

A fast-paced **2D browser team shooter** with two game modes:

- **🚩 Domination** — capture and hold objectives; first squad to the score cap wins (like Delta Force).
- **💀 Elimination** — last squad standing, no respawns (like Fortnite).

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
| Call in vehicle token | `B` |
| Open crate / grab ammo | `E` |
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

## Weapons, consumables & loot

- **30 weapons across 10 classes** ([js/weapons.js](js/weapons.js)) — the design roster with real
  ballistics: damage, burst, pellets, fire rate, mag/reload, accuracy→spread, recoil→bloom,
  weight→mobility, damage falloff, and explosive splash. Browse them by class in the **Loadout** screen.
- **Consumables** ([js/items.js](js/items.js)) — grenades (Frag, Impact, C4, Smoke, Flashbang),
  tactical deploys (Mine, Barricade, Ammo Box, Cool Flag), heals/boosts (Medkit, Bandage, Pills,
  Soda, Stim), and vehicle call-in tokens (Armored Jeep, Tank).
- **Loot crates** spawn on the map — walk up and press `E`. Regular / Silver / Gold tiers roll from
  the design's weighted drop tables. Gold crates can drop a **Legendary ("Gold") weapon** — a buffed
  variant of the best gun in your class — or a **vehicle token**.
- **Adrenaline** is a boost resource (from Pills/Soda/Stim/Flag) that grants +25% move speed while active.

> Currently functional as gameplay: all weapon ballistics, every grenade/tactical/heal, crates,
> legendary weapons, adrenaline, and AI-driven call-in vehicles. **Not yet wired to combat:**
> specialized ammo types (AP/HP/Tracer/Slug), weapon attachments (Suppressor, Grenade Launcher, etc.),
> and *drivable* vehicles (call-ins currently fight as allied AI). These are the natural next steps.

## Tuning knobs

Quick things to tweak while designing your game:

- **Weapons** — the `RAW` table in `js/weapons.js` (edit stats inline; the builder derives the rest).
- **Consumables / crates / legendaries** — `CONSUMABLES`, `CRATE_TABLES`, `LEGENDARY_MODS` in `js/items.js`.
- **Modes / teams / map** — constants at the top of `js/game.js`
  (`MAP_W`, `SCORE_CAP`, `MATCH_SECONDS`, team counts in `setupTeams`, cover in `buildMap`).
- **Missions & Battle Pass** — pools and tiers in `js/progression.js`.
- **Look & feel** — CSS variables at the top of `css/styles.css`.

Have fun — squad up. 🎮
