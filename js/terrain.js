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
  function generate(w, h, seed) {
    const rand = rng(seed || 1337);
    const t = {
      w, h, seed: seed || 1337,
      oceanInset: OCEAN_INSET,
      beachInset: BEACH_INSET,
      rivers: [], bridges: [], roads: [], patches: [],
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

    // --- bridges: crossings so the river never fully cuts the map in two ---
    for (const frac of [0.25, 0.55, 0.82]) {
      const i = Math.floor(frac * (pts.length - 1));
      const a = pts[i], b = pts[i + 1] || pts[i];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      t.bridges.push({ x: mx, y: my, angle: ang, w: width + 90, h: 108 });
    }

    // --- roads: a ring road plus a couple of spurs ---
    const inset = BEACH_INSET + 180;
    t.roads.push({ pts: [
      { x: inset, y: inset }, { x: w - inset, y: inset },
      { x: w - inset, y: h - inset }, { x: inset, y: h - inset }, { x: inset, y: inset },
    ], width: 78 });
    t.roads.push({ pts: [{ x: inset, y: h * 0.5 }, { x: w - inset, y: h * 0.5 }], width: 66 });
    t.roads.push({ pts: [{ x: w * 0.5, y: inset }, { x: w * 0.5, y: h - inset }], width: 66 });

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
    COLORS, OCEAN_INSET, BEACH_INSET,
    generate, rng, distToPath,
    inOcean, inBeach, inRiver, onBridge, onRoad,
    surfaceAt, isBuildable, isSpawnable,
  };
})();
