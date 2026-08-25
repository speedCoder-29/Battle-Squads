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

  /* how far in from the edge each band sits, on average */
  const OCEAN_INSET = 150;      // water all the way round
  const BEACH_INSET = 300;      // sand between water and grass

  /* ============================================================
     THE COASTLINE

     The island used to be three nested rectangles: a square of ocean, a
     square of sand inside it, a square of grass inside that. Every shore on
     the map ran dead straight for four thousand pixels and turned ninety
     degrees at the corner. Nothing else on the map mattered as much to whether
     it read as a place — you can draw beautiful grass and it is still a
     rectangle of it.

     What replaces it is the standard approach for this: a base shape with
     octaves of noise displacing the water's edge — a few big lobes for bays
     and headlands, then finer detail for inlets and points. The base is a
     rounded rectangle rather than a circle so the playable area stays close
     to the square the rest of the generator assumes.

     Two rules make it hold together:

     • ONE SOURCE OF TRUTH. `edgeDist` and `oceanAt` decide where the water is,
       and the drawn polygons are solved from those same functions rather than
       drawn to look similar. Otherwise you get sand you cannot stand on and
       water you can walk over.

     • SAND COLLECTS IN BAYS. A beach is not a constant-width ribbon: where the
       coast is bitten inland the beach is broad, and on an exposed headland it
       is a thin strip below the grass. So the beach edge is derived from the
       water's edge rather than wobbling independently.
     ============================================================ */
  /* Wavelengths around the island and how far each one pushes the shore.
     Low k = a few big bays; high k = the detail you see standing on it. */
  const COAST_OCTAVES = [
    { k: 1, amp: 0.44 },
    { k: 2, amp: 0.27 },
    { k: 3, amp: 0.15 },
    { k: 5, amp: 0.11 },
    { k: 9, amp: 0.07 },
    { k: 17, amp: 0.04 },
  ];
  const COAST_AMP = 215;        // px the water's edge swings either way
  const BEACH_MIN = 120;        // narrowest strip of sand, on a headland
  const BEACH_SWING = 210;      // extra sand that gathers in a bay
  const CORNER_R = 1650;        // how much the island's corners are rounded off

  /* Where a point sits on the way round the island, 0..1. Taken from the angle
     about the centre, which wraps continuously and so cannot seam. */
  const coastU = (t, x, y) => {
    const a = Math.atan2(y - t.h / 2, x - t.w / 2);
    return a / (Math.PI * 2) + 0.5;
  };

  /* Signed distance inward from the island's base outline — positive on land,
     negative out to sea. Standard rounded-rectangle SDF, negated. */
  function edgeDist(t, x, y) {
    const R = Math.min(CORNER_R, t.w / 2, t.h / 2);
    const qx = Math.abs(x - t.w / 2) - (t.w / 2 - R);
    const qy = Math.abs(y - t.h / 2) - (t.h / 2 - R);
    const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
    return -(Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - R);
  }

  /* The summed octaves at a point on the way round, roughly -1..1. */
  function coastNoise(t, u) {
    let s = 0;
    for (let i = 0; i < COAST_OCTAVES.length; i++) {
      const o = COAST_OCTAVES[i];
      s += Math.sin(u * Math.PI * 2 * o.k + t.coastPhase[i]) * o.amp;
    }
    return s;
  }

  /* How far in from the base outline the water reaches here. */
  const oceanAt = (t, u) => t.oceanInset + coastNoise(t, u) * COAST_AMP;
  /* ...and where the sand gives way to grass. Broad where the sea has bitten
     inland, narrow where the land pushes out. */
  const beachAt = (t, u) => {
    const bay = (coastNoise(t, u) + 1) / 2;      // 0 on a headland, 1 in a bay
    return oceanAt(t, u) + BEACH_MIN + bay * BEACH_SWING;
  };

  /* Solve the outline for drawing, so the picture is derived from the same
     functions the game queries rather than drawn to match by eye. For each of
     `n` bearings, bisect along the ray from the centre for the point where the
     inward distance equals the band's inset. */
  function boundaryPolygon(t, insetAt, n) {
    const cx = t.w / 2, cy = t.h / 2;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const ang = (u - 0.5) * Math.PI * 2;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const want = insetAt(t, u);
      // outside the island for sure, and inside for sure
      let lo = 0, hi = Math.hypot(t.w, t.h) * 0.6;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        // edgeDist falls as we head outward, so the land side is the low half
        if (edgeDist(t, cx + dx * mid, cy + dy * mid) > want) lo = mid; else hi = mid;
      }
      pts.push({ x: cx + dx * lo, y: cy + dy * lo });
    }
    return pts;
  }

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
        /* This read `'#b0a храм'.replace(' храм', '18c')` — a hex colour with a
           Cyrillic word spliced into it and patched back out at runtime. It
           evaluated to the right string, so nothing ever failed; it was still
           garbage that survived into the source. */
        river: '#3f93b8', riverEdge: '#63b0d0', road: '#b0a18c',
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

    /* This island's coastline. One phase per octave, drawn from the same seed
       as everything else, so every client carves the same bays. */
    t.coastPhase = COAST_OCTAVES.map(() => rand() * Math.PI * 2);
    /* Solved once, here, rather than every frame: the water's edge and the
       top of the beach, as closed outlines the renderer can fill. 220 points
       is enough that the finest octave still reads as a curve. */
    t.coastLine = boundaryPolygon(t, oceanAt, 220);
    t.shoreLine = boundaryPolygon(t, beachAt, 220);

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
    /* Roads are laid as straight lines between a handful of corners, which at
       any distance reads as a rectangle drawn on the ground with a ruler —
       and once the coast started bending, it was the most obviously
       manufactured thing left on the map.

       `wander` subdivides a run and pushes each new point sideways, so a road
       leans around what it is passing the way a real one does. The corners it
       was given are kept exactly, so junctions, spurs and bridge crossings all
       still meet. */
    const wander = (pts, amp, seg) => {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const n = Math.max(1, Math.round(len / seg));
        // unit normal to the run, which is the direction a road can drift in
        const nx = -dy / len, ny = dx / len;
        for (let k = 1; k < n; k++) {
          const p = k / n;
          // zero at both ends so the given corners are not moved
          const fall = Math.sin(p * Math.PI);
          const push = (rand() * 2 - 1) * amp * fall;
          out.push({ x: a.x + dx * p + nx * push, y: a.y + dy * p + ny * push });
        }
        out.push(b);
      }
      return out;
    };

    const inset = BEACH_INSET + 180;
    const ring = [
      { x: inset, y: inset }, { x: w - inset, y: inset },
      { x: w - inset, y: h - inset }, { x: inset, y: h - inset }, { x: inset, y: inset },
    ];
    t.roads.push({ pts: wander(ring, 150, 760), width: 84, kind: 'ring' });
    t.roads.push({ pts: wander([{ x: inset, y: h * 0.5 }, { x: w - inset, y: h * 0.5 }], 175, 820), width: 70, kind: 'trunk' });
    t.roads.push({ pts: wander([{ x: w * 0.5, y: inset }, { x: w * 0.5, y: h - inset }], 175, 820), width: 70, kind: 'trunk' });

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
      t.roads.push({ pts: wander([{ x: a.x, y: a.y }, bend], 90, 520), width: 58, kind: 'spur' });
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

  /* Where the water is. These were four comparisons against the map edge —
     which is exactly why the island was a rectangle. They now ask the
     coastline, and so does the renderer, so what you see is what you can walk
     on. Both are cheap: one atan2, one hypot and five sines. */
  const inOcean = (t, x, y) => edgeDist(t, x, y) < oceanAt(t, coastU(t, x, y));
  const inBeach = (t, x, y) => {
    const d = edgeDist(t, x, y), u = coastU(t, x, y);
    return d >= oceanAt(t, u) && d < beachAt(t, u);
  };
  /* How far inside the water's edge a point is, negative out at sea. What the
     renderer uses to lay wet sand and foam along the tideline. */
  const shoreDepth = (t, x, y) => edgeDist(t, x, y) - oceanAt(t, coastU(t, x, y));

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
    /* Inland of the grass line by at least the building's own reach, measured
       against the real coast. The old rectangular test let a warehouse sit on
       what is now a beach, or half in a bay. */
    if (edgeDist(t, x, y) < beachAt(t, coastU(t, x, y)) + p) return false;
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
    // the coastline, for anything that needs to draw or reason about the shore
    edgeDist, coastU, oceanAt, beachAt, shoreDepth, boundaryPolygon, CORNER_R,
    surfaceAt, isBuildable, isSpawnable,
  };
})();
