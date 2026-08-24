/* ============================================================
   terrain.js — the ground the map is built on.

   Laid out the way surviv.io/survev arranges an island:

       ocean  ──►  beach  ──►  grass interior
                                 │
                        a river winds through it,
                        crossed by a few bridges,
                        with roads linking the
                        built-up areas.

   All of it is generated from a seed, so a map is reproducible and
   the same layout can be handed to a server. Nothing here is art —
   see sprites.js — this is the shape of the world plus the queries
   the engine needs (what am I standing on, can I walk here).
   ============================================================ */
const Terrain = (() => {

  /* survev-ish palette: saturated grass, warm sand, deep water */
  const COLORS = {
    ocean:      '#1a5a8e',
    oceanDeep:  '#0f3d5c',
    beach:      '#e5c88a',
    beachEdge:  '#d4b873',
    grass:      '#5aa83f',
    grassAlt:   '#4a9d2d',
    grassLight: '#6db856',
    river:      '#2680b8',
    riverEdge:  '#4a9fd6',
    road:       '#9d8f7c',
    roadLine:   '#d4c9b6',
    bridge:     '#8a6a45',
    bridgeEdge: '#5e4629',
  };

  /* how far in from the edge each band sits */
  const OCEAN_INSET = 150;      // water all the way round
  const BEACH_INSET = 300;      // sand between water and grass

  /* tiny seeded RNG so a seed always rebuilds the same island */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* ---------- generate ---------- */
  /* ---------- biomes ----------
     One island, several climates. The generator's shape is unchanged — the
     same coast, rivers and roads — but the palette, the vegetation and the
     ground underfoot come from the biome the seed rolls, so two maps read as
     two places rather than as the same place twice.

     `tree` names the vegetation the map generator should plant; `scatter` is
     what its loose scenery is made of. */
  const BIOMES = {
    temperate: {
      name: 'Temperate', tree: 'tree', scatter: ['stump', 'rubble', 'pallet'],
      colors: {},                                   // the defaults above
    },
    arid: {
      name: 'Arid Basin', tree: 'palm', scatter: ['rubble', 'sandpile', 'stump'],
      colors: {
        grass: '#b9a05e', grassAlt: '#a8904f', grassLight: '#cbb573',
        beach: '#e8d3a0', beachEdge: '#d8c08a',
        river: '#3f93b8', riverEdge: '#63b0d0', road: '#b0a храм'.replace(' храм', '18c'),
      },
    },
    tundra: {
      name: 'Frozen Flats', tree: 'tree', scatter: ['rock', 'stump', 'rubble'],
      colors: {
        grass: '#cdd8dc', grassAlt: '#bcc9ce', grassLight: '#e2ebee',
        beach: '#dfe6ea', beachEdge: '#c8d2d8',
        ocean: '#2a5f80', oceanDeep: '#17415c',
        river: '#6fb6d8', riverEdge: '#9ed6ee', road: '#98a4ab',
      },
    },
    tropic: {
      name: 'Jungle Coast', tree: 'palm', scatter: ['bush', 'stump', 'pallet'],
      colors: {
        grass: '#2f8a3a', grassAlt: '#256f2d', grassLight: '#48a851',
        beach: '#efdcae', beachEdge: '#dcc696',
        ocean: '#137a9c', oceanDeep: '#0a5570',
        river: '#1f9fb8', riverEdge: '#48c4d6',
      },
    },
    volcanic: {
      name: 'Ashfields', tree: 'stump', scatter: ['rock', 'rubble', 'sandpile'],
      colors: {
        grass: '#5c5750', grassAlt: '#4c483f', grassLight: '#6e6860',
        beach: '#7a7068', beachEdge: '#655d55',
        ocean: '#1b4358', oceanDeep: '#102c3c',
        river: '#8a5a3a', riverEdge: '#b07a4a', road: '#3f3a35',
      },
    },
  };
  /* ---------- weather ----------
     What the sky is doing, and what that costs you. Each climate has its own,
     rolled from the seed alongside the biome so every client agrees without
     anything crossing the wire.

       density  particles on screen at once
       sight    how far you can see, as a fraction of clear conditions
       tint     a wash over the whole scene
       drift    how far the fall leans, in px per px of descent

     `sight` is the part that matters. Weather that only looks like weather is
     scenery; weather that shortens the engagement range changes which gun you
     want and how close you have to get, and it changes it for everybody on the
     map at once. */
  const WEATHER = {
    clear:   { name: 'Clear',      density: 0,   sight: 1.00, tint: null,                    drift: 0 },
    rain:    { name: 'Rain',       density: 260, sight: 0.72, tint: 'rgba(30,52,74,0.20)',   drift: 0.32, streak: 16, color: 'rgba(174,206,235,0.55)' },
    snow:    { name: 'Snowfall',   density: 220, sight: 0.62, tint: 'rgba(190,205,220,0.16)', drift: 0.55, streak: 0,  color: 'rgba(255,255,255,0.80)' },
    dust:    { name: 'Dust Haze',  density: 150, sight: 0.55, tint: 'rgba(150,120,70,0.22)',  drift: 0.85, streak: 5,  color: 'rgba(214,186,132,0.45)' },
    ash:     { name: 'Ashfall',    density: 190, sight: 0.66, tint: 'rgba(40,36,34,0.26)',    drift: 0.30, streak: 0,  color: 'rgba(190,186,180,0.50)' },
  };
  /* Which climates get which weather, and how often. Clear is always on the
     table — a map that is always raining is a map with one look. */
  const BIOME_WEATHER = {
    temperate: ['clear', 'clear', 'rain'],
    arid:      ['clear', 'dust', 'dust'],
    tundra:    ['snow', 'snow', 'clear'],
    tropic:    ['rain', 'rain', 'clear'],
    volcanic:  ['ash', 'ash', 'clear'],
  };

  const BIOME_IDS = Object.keys(BIOMES);
  const biomeFor = (seed) => BIOMES[BIOME_IDS[Math.abs((seed || 0) >>> 0) % BIOME_IDS.length]];
  /* A different shuffle of the seed than the biome uses, so the same island
     does not always get the same sky. */
  function weatherFor(seed, biomeId) {
    const pool = BIOME_WEATHER[biomeId] || ['clear'];
    const n = Math.abs(((seed || 0) >>> 0) * 2654435761 % 4294967296) >>> 0;
    return Object.assign({ id: pool[n % pool.length] }, WEATHER[pool[n % pool.length]]);
  }

  function generate(w, h, seed) {
    const rand = rng(seed || 1337);
    /* The climate this island has. Chosen from the seed, so every client
       generating the same map agrees on it without anything crossing the
       wire. */
    const biome = biomeFor(seed || 1337);
    const t = {
      w, h, seed: seed || 1337,
      biome, colors: Object.assign({}, COLORS, biome.colors),
      weather: weatherFor(seed || 1337, BIOME_IDS[Math.abs((seed || 1337) >>> 0) % BIOME_IDS.length]),
      oceanInset: OCEAN_INSET,
      beachInset: BEACH_INSET,
      rivers: [], bridges: [], roads: [], patches: [],
      obstacles: [],  // structured obstacle zones
    };

    // --- river: a polyline wandering top-to-bottom or left-to-right ---
    const vertical = rand() < 0.5;
    const width = 120 + rand() * 70;
    const pts = [];
    const steps = 9;
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      if (vertical) {
        pts.push({ x: w * (0.32 + 0.36 * p) + Math.sin(p * 5 + rand()) * w * 0.07, y: -40 + (h + 80) * p });
      } else {
        pts.push({ x: -40 + (w + 80) * p, y: h * (0.32 + 0.36 * p) + Math.sin(p * 5 + rand()) * h * 0.07 });
      }
    }
    t.rivers.push({ pts, width, vertical });

    // bridges are added after the roads, where the two actually cross

    /* --- roads ---
       A proper network rather than decoration: a ring road round the inhabited
       area, a cross through the middle, and spurs out to the three landmark
       sites, so the places worth going to are actually connected. Junctions are
       recorded because bridges are placed where a road meets the river. */
    const inset = BEACH_INSET + 180;
    const ring = [
      { x: inset, y: inset }, { x: w - inset, y: inset },
      { x: w - inset, y: h - inset }, { x: inset, y: h - inset }, { x: inset, y: inset },
    ];
    t.roads.push({ pts: ring, width: 84, kind: 'ring' });
    t.roads.push({ pts: [{ x: inset, y: h * 0.5 }, { x: w - inset, y: h * 0.5 }], width: 70, kind: 'trunk' });
    t.roads.push({ pts: [{ x: w * 0.5, y: inset }, { x: w * 0.5, y: h - inset }], width: 70, kind: 'trunk' });

    // spurs to the landmark anchors, matching game.js's placement
    t.landmarkAnchors = [
      { x: w * 0.26, y: h * 0.70 },
      { x: w * 0.52, y: h * 0.40 },
      { x: w * 0.76, y: h * 0.72 },
    ];
    for (const a of t.landmarkAnchors) {
      // join each site to the nearest trunk, with one bend so it isn't a ruler line
      const toTrunkY = Math.abs(a.y - h * 0.5) < Math.abs(a.x - w * 0.5);
      const bend = toTrunkY
        ? { x: a.x, y: h * 0.5 }
        : { x: w * 0.5, y: a.y };
      t.roads.push({ pts: [{ x: a.x, y: a.y }, bend], width: 58, kind: 'spur' });
    }

    // --- structured obstacle zones: clearings, dense clusters, perimeter fortifications ---
    // Forest clearing (open sightlines in otherwise dense area)
    t.obstacles.push({ type: 'clearing', x: w * 0.25, y: h * 0.35, r: 280, density: 0 });
    // Dense thicket (tight cover, movement hazard)
    t.obstacles.push({ type: 'thicket', x: w * 0.75, y: h * 0.25, r: 300, density: 0.8 });
    // Rocky outcrop (scattered boulders, medium cover)
    t.obstacles.push({ type: 'rocks', x: w * 0.5, y: h * 0.7, r: 320, density: 0.5 });
    // Perimeter fortifications (sandbags + wire around edges)
    t.obstacles.push({ type: 'fortified', x: BEACH_INSET + 100, y: BEACH_INSET + 100, r: 150, density: 0.9 });
    t.obstacles.push({ type: 'fortified', x: w - BEACH_INSET - 100, y: h - BEACH_INSET - 100, r: 150, density: 0.9 });

    /* --- bridges ---
       Put a bridge wherever a road crosses the river, which is where you'd
       actually build one, and guarantees the network stays connected. If the
       river somehow misses every road, fall back to spacing them along it. */
    for (const road of t.roads) {
      for (let i = 0; i < road.pts.length - 1; i++) {
        const a = road.pts[i], b = road.pts[i + 1];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 40);
        let entry = null;
        for (let k = 0; k <= steps; k++) {
          const p = k / steps;
          const x = a.x + (b.x - a.x) * p, y = a.y + (b.y - a.y) * p;
          const wet = distToPath(pts, x, y) < width / 2;
          if (wet && !entry) entry = { x, y };
          else if (!wet && entry) {
            const mx = (entry.x + x) / 2, my = (entry.y + y) / 2;
            const ang = Math.atan2(b.y - a.y, b.x - a.x);
            if (!t.bridges.some(br => Math.hypot(br.x - mx, br.y - my) < 300)) {
              t.bridges.push({ x: mx, y: my, angle: ang, w: width + 160, h: Math.max(96, road.width + 24) });
            }
            entry = null;
          }
        }
      }
    }
    if (t.bridges.length < 2) {
      for (const frac of [0.3, 0.7]) {
        const i = Math.floor(frac * (pts.length - 1));
        const a = pts[i], b = pts[i + 1] || pts[i];
        const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
        t.bridges.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle: ang, w: width + 120, h: 108 });
      }
    }

    // --- grass patches: subtle tone variation so the field isn't flat ---
    for (let i = 0; i < 90; i++) {
      t.patches.push({
        x: rand() * w, y: rand() * h,
        r: 90 + rand() * 220,
        light: rand() < 0.5,
      });
    }
    return t;
  }

  /* ---------- queries ---------- */
  /* distance from a point to a polyline, used for rivers and roads */
  function distToPath(pts, x, y) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      let tt = ((x - a.x) * dx + (y - a.y) * dy) / len2;
      tt = Math.max(0, Math.min(1, tt));
      const px = a.x + dx * tt, py = a.y + dy * tt;
      const d = Math.hypot(x - px, y - py);
      if (d < best) best = d;
    }
    return best;
  }

  const inOcean = (t, x, y) =>
    x < t.oceanInset || y < t.oceanInset || x > t.w - t.oceanInset || y > t.h - t.oceanInset;
  const inBeach = (t, x, y) =>
    !inOcean(t, x, y) &&
    (x < t.beachInset || y < t.beachInset || x > t.w - t.beachInset || y > t.h - t.beachInset);

  function onBridge(t, x, y) {
    for (const b of t.bridges) {
      const dx = x - b.x, dy = y - b.y;
      const c = Math.cos(-b.angle), s = Math.sin(-b.angle);
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      if (Math.abs(lx) < b.w / 2 && Math.abs(ly) < b.h / 2) return true;
    }
    return false;
  }
  function inRiver(t, x, y) {
    if (onBridge(t, x, y)) return false;
    for (const r of t.rivers) if (distToPath(r.pts, x, y) < r.width / 2) return true;
    return false;
  }
  const onRoad = (t, x, y) => t.roads.some(r => distToPath(r.pts, x, y) < r.width / 2);

  /* what you're standing on, and what it does to you */
  function surfaceAt(t, x, y) {
    if (inOcean(t, x, y)) return { kind: 'ocean', speed: 0.45, swim: true };
    if (inRiver(t, x, y)) return { kind: 'river', speed: 0.55, swim: true };
    if (onBridge(t, x, y)) return { kind: 'bridge', speed: 1 };
    if (onRoad(t, x, y)) return { kind: 'road', speed: 1.12 };      // roads are quick
    if (inBeach(t, x, y)) return { kind: 'beach', speed: 0.92 };    // sand drags a little
    return { kind: 'grass', speed: 1 };
  }

  /* somewhere sensible to put a building or a crate: dry, inland, off the road */
  function isBuildable(t, x, y, pad) {
    const p = pad || 0;
    if (x < t.beachInset + p || y < t.beachInset + p) return false;
    if (x > t.w - t.beachInset - p || y > t.h - t.beachInset - p) return false;
    for (const r of t.rivers) if (distToPath(r.pts, x, y) < r.width / 2 + p + 60) return false;
    return true;
  }
  /* loot may sit on roads and beaches, it just can't be in the water */
  function isSpawnable(t, x, y) {
    if (inOcean(t, x, y)) return false;
    if (inRiver(t, x, y)) return false;
    return true;
  }

  return {
    COLORS, BIOMES, BIOME_IDS, biomeFor, WEATHER, BIOME_WEATHER, weatherFor, OCEAN_INSET, BEACH_INSET,
    generate, rng, distToPath,
    inOcean, inBeach, inRiver, onBridge, onRoad,
    surfaceAt, isBuildable, isSpawnable,
  };
})();
