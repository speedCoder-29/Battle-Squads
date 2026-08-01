/* ============================================================
   structures.js — wall types, their ballistics, and the buildings
   the map is made out of.

   BUILDING CATEGORIES (30 total, 28 implemented):
     • Tactical (small, fast play): tower, checkpoint, bunker, fuel-depot
     • Residential (medium, mixed): house, mansion, shanty, apartments
     • Industrial (large, complex): warehouse, factory, depot, power-plant
     • Institutional (varied): hospital, school, church, museum, prison
     • Commercial (trade hubs): market, bank, gas-station
     • Military (high-security): base, fortress, hangar, barracks, armory
     • Unique (special gameplay): radio-tower, arena, bridge-fort, mine, farm, camp
     • Utility (resource hubs): dock, train-station

   PHASE 6 EXPANSION (14 new buildings added):
     ✓ prison (high-security cells, reinforced perimeter, 6+ entry points for breach gameplay)
     ✓ bank (ultra-secure vault, minimal access, high-tier loot concentration)
     ✓ market (diverse loot pools, many entry points, open stall layout for dynamic play)
     ✓ school (varied heights, open classrooms, educational loot distribution)
     ✓ church (tall interior, spiritual atmosphere, pew-line cover patterns)
     ✓ museum (gallery halls, display cases as cover, high-rarity artifacts)
     ✓ barracks (military dormitory, dense rooms, weapons-rich loot)
     ✓ armory (weapons cache, ultra-reinforced, legendary-tier loot)
     ✓ arena (open center with ring seating, ring-of-fire tactical engagement)
     ✓ bridge-fort (linear forced-engagement bridge, narrow high-pressure combat)
     ✓ train-station (platform-based, multiple entry points, horizontal sightlines)
     ✓ power-plant (industrial complex, hazardous turbine areas, tech loot)
     ✓ gas-station (compact convenience store, fuel pump cover, explosive hazard)
     ✓ mine (underground quarry, vertical drops, tight passages, ore/explosives)

   Engine mapping notes:
     • Thickness/length are design metres; PX_PER_M converts them.
       A "0.3 thickness, 1.5 length" door is 12px thick and 60px wide.
     • HP is the table formula × HP_SCALE. The scale exists so
       "10 × thickness" lands somewhere playable — with it, a wood
       0.3 door comes out at exactly the table's 30 HP.
     • Toughness is the minimum tool Structure Pierce needed to
       damage the wall by hand. Tools with an explicit clearing
       effect (bayonet→wire, spade→sandbags) ignore it, and
       explosives ignore it entirely.
     • Height decides sight: "high" blocks line of sight, "low"
       is cover you can see over, "under" (trench) blocks nothing.
   ============================================================ */
const Structures = (() => {
  const PX_PER_M = 40;
  /* HP_SCALE turns the design table's "10 x thickness" into playable numbers.
     It started at 10, which made a 0.3 wood wall 30 HP — one axe swing, or a
     third of a magazine. Buildings fell apart before a fight got going, so it
     is now 30: that same wall takes 90, a metal 0.6 takes 360, and reinforced
     walls take real explosive work. The table's ratios are untouched. */
  const HP_SCALE = 30;
  const m = (v) => v * PX_PER_M;

  /* ---------- WALL TYPES ---------- */
  // bullets: 'stop'    — absorbed
  //          'pen'     — passes through, keeps (1 - loss) of its damage
  //          'reflect' — ricochets off, keeps 50% of its damage
  //          'through' — no interaction at all
  const WALL_TYPES = {
    wood: {
      name: 'Wood', height: 'high', hpPerThickness: 10, toughness: (t) => (t <= 0.2 ? 1 : t <= 0.4 ? 2 : 3),
      bullets: 'pen', lossPerM: 1.0,            // 10% per 0.1 thickness
      fill: '#8a6d45', stroke: 'rgba(255,200,110,0.95)',
      effect: 'Bullets lose 10% damage per 0.1 thickness',
    },
    metal: {
      name: 'Metal', height: 'high', hpPerThickness: 20, toughness: 4,
      bullets: 'pen', lossPerM: 1.0, reflectAbove: 0.5,
      fill: '#4a6280', stroke: 'rgba(200,220,255,0.90)',
      effect: 'Penetrable up to 0.5 thickness, then ricochets for 50%',
    },
    door: {
      name: 'Door', height: 'high', hp: 90, toughness: 1, door: true,
      bullets: 'pen', lossPerM: 1.0,            // it's wood, 0.3 thick
      defThickness: 0.3, defLength: 1.5,
      fill: '#9a7244', stroke: 'rgba(255,210,140,0.95)',
      effect: 'Opens and closes',
    },
    rdoor: {
      name: 'Reinforced Door', height: 'high', hp: 300, toughness: 5, door: true,
      bullets: 'reflect', defThickness: 0.35, defLength: 1.5,
      fill: '#3d5070', stroke: 'rgba(220,235,255,0.95)',
      effect: 'Opens and closes · bullets ricochet for 50%',
    },
    rwall: {
      name: 'Reinforced Wall', height: 'high', hp: 300, toughness: 5,
      bullets: 'reflect',
      fill: '#4a5e80', stroke: 'rgba(200,220,255,0.90)',
      effect: 'Bullets ricochet for 50%',
    },
    wire: {
      name: 'Barbed Wire', height: 'low', hp: 60, toughness: 5,
      bullets: 'through', passable: true, slow: 0.1, dps: 2,
      fill: 'rgba(180,200,240,0.18)', stroke: 'rgba(220,235,255,0.85)',
      effect: '90% movement slowdown · 2 damage/s',
    },
    sandbag: {
      name: 'Sand Bags', height: 'low', hp: 300, toughness: 6,
      bullets: 'stop',
      fill: '#7a7040', stroke: 'rgba(245,225,140,0.85)',
      effect: 'Stops bullets outright',
    },
    barricade: {
      name: 'Barricade', height: 'low', hp: 150, toughness: 1,
      bullets: 'pen', flatLoss: 0.5,
      fill: '#6a5a85', stroke: 'rgba(200,140,255,0.80)',
      effect: 'Bullets lose 50% damage passing through',
    },
    trench: {
      name: 'Trench', height: 'under', hp: 1, toughness: 6,
      bullets: 'through', passable: true, dodge: 0.5,
      fill: 'rgba(132,100,62,0.55)', stroke: 'rgba(205,168,116,0.75)',
      effect: 'Infantry inside dodge 50% of incoming fire',
    },

    /* ---------- PROPS ----------
       survev's world objects aren't scenery: crates break open and spill
       loot, barrels cook off and chain, trees block your shot, bushes hide
       you. These are wall types like any other, so they inherit HP,
       toughness, the spatial index and tool breaching for free — the extras
       are `drops`, `explodes` and `conceals`, handled in game.js. */
    crate: {
      name: 'Crate', height: 'low', hp: 90, toughness: 1, prop: 'crate',
      bullets: 'stop', drops: 'regular',
      fill: '#9a7747', stroke: '#6b5333',
      effect: 'Breaks open and spills loot',
    },
    barrel: {
      name: 'Barrel', height: 'low', hp: 70, toughness: 1, prop: 'barrel',
      bullets: 'stop', explodes: { damage: 85, radius: 165 },
      fill: '#c25e3a', stroke: '#7a3a1f',
      effect: 'Cooks off when destroyed — and sets off its neighbours',
    },
    tree: {
      name: 'Tree', height: 'high', hp: 160, toughness: 2, prop: 'tree',
      bullets: 'stop', round: true, drops: null,
      fill: '#5ab947', stroke: '#2d7a1a',
      effect: 'Blocks sight and gunfire until it comes down',
    },
    rock: {
      name: 'Boulder', height: 'low', hp: 400, toughness: 4, prop: 'rock',
      bullets: 'stop', round: true,
      fill: '#9ca5b5', stroke: '#6a7382',
      effect: 'Hard cover — takes HEAT or a hammer',
    },
    container: {
      name: 'Container', height: 'high', hp: 500, toughness: 4, prop: 'container',
      bullets: 'reflect',
      fill: '#2d5a8a', stroke: '#1a3f5a',
      effect: 'Steel box: bullets ricochet off it',
    },
    bush: {
      name: 'Bush', height: 'low', hp: 40, toughness: 1, prop: 'bush',
      bullets: 'through', passable: true, conceals: true, round: true,
      fill: 'rgba(90,185,71,0.40)', stroke: 'rgba(45,122,26,0.70)',
      effect: 'Hides anyone standing still inside it',
    },
  };
  /* wall types that are really world props, drawn with a sprite */
  const PROP_TYPES = ['crate', 'barrel', 'tree', 'rock', 'container', 'bush'];

  /* ---------- derived stats ---------- */
  const def = (type) => WALL_TYPES[type] || WALL_TYPES.wood;

  function maxHp(type, thickness) {
    const d = def(type);
    if (d.hp !== undefined) return d.hp;
    return d.hpPerThickness * thickness * HP_SCALE;
  }
  function toughness(type, thickness) {
    const t = def(type).toughness;
    return typeof t === 'function' ? t(thickness) : t;
  }
  /* what happens to a bullet entering this wall */
  function ballistics(s) {
    const d = def(s.type);
    if (d.bullets === 'through') return { mode: 'through', keep: 1 };
    if (d.bullets === 'reflect') return { mode: 'reflect', keep: 0.5 };
    if (d.bullets === 'pen') {
      const th = s.thickness || d.defThickness || 0.3;
      if (d.reflectAbove !== undefined && th > d.reflectAbove) return { mode: 'reflect', keep: 0.5 };
      const loss = d.flatLoss !== undefined ? d.flatLoss : Math.min(1, th * d.lossPerM);
      return loss >= 1 ? { mode: 'stop', keep: 0 } : { mode: 'pen', keep: 1 - loss };
    }
    return { mode: 'stop', keep: 0 };
  }
  const blocksSight = (s) => def(s.type).height === 'high' && !s.open;
  const blocksMove  = (s) => !def(s.type).passable && !s.open;
  const isDoor      = (s) => !!def(s.type).door;

  /* ---------- build one wall segment ----------
     axis 'h' = runs along x, 'v' = runs along y. (x, y) is the
     centre-line start; length and thickness are in design metres. */
  function seg(type, x, y, length, axis, thickness) {
    const d = def(type);
    const th = thickness || d.defThickness || 0.3;
    const t = Math.max(6, m(th));
    const len = m(length);
    const s = axis === 'h'
      ? { x, y: y - t / 2, w: len, h: t }
      : { x: x - t / 2, y, w: t, h: len };
    s.type = type; s.thickness = th; s.axis = axis;
    s.maxHp = maxHp(type, th); s.hp = s.maxHp;
    s.toughness = toughness(type, th);
    if (d.door) s.open = false;
    return s;
  }

  /* Build a prop as a square wall segment centred on (x, y). Props are square,
     so `seg`'s run-length model doesn't fit them. */
  function prop(type, x, y, size, scale) {
    const d = def(type);
    const half = (size || 34) * (scale || 1) / 2;
    const s = { x: x - half, y: y - half, w: half * 2, h: half * 2 };
    s.type = type; s.thickness = 0.4; s.axis = 'h';
    s.maxHp = maxHp(type, 0.4); s.hp = s.maxHp;
    s.toughness = toughness(type, 0.4);
    s.isProp = true;
    s.scale = scale || 1;
    s.rot = Math.random() * Math.PI * 2;
    return s;
  }

  /* ---------- BUILDING BLUEPRINTS ----------
     Each returns wall segments in world space for an origin (ox, oy).
     Door gaps are left in the runs and filled with door segments. */

  // A four-sided shell with optional gaps; `doors` are {side, at, len, type}
  function shell(ox, oy, w, h, type, thickness, doors) {
    const out = [];
    const M = 1 / PX_PER_M;                       // px -> metres for run lengths
    const sides = [
      { side: 'n', x: ox, y: oy, len: w, axis: 'h' },
      { side: 's', x: ox, y: oy + h, len: w, axis: 'h' },
      { side: 'w', x: ox, y: oy, len: h, axis: 'v' },
      { side: 'e', x: ox + w, y: oy, len: h, axis: 'v' },
    ];
    for (const sd of sides) {
      const gaps = (doors || []).filter(d => d.side === sd.side)
        .map(d => ({ at: d.at, len: m(d.len || def(d.type || 'door').defLength), type: d.type || 'door' }))
        .sort((a, b) => a.at - b.at);
      let cursor = 0;
      for (const g of gaps) {
        if (g.at - cursor > 4) out.push(runSeg(type, sd, cursor, (g.at - cursor) * M, thickness));
        out.push(runSeg(g.type, sd, g.at, g.len * M, undefined));
        cursor = g.at + g.len;
      }
      if (sd.len - cursor > 4) out.push(runSeg(type, sd, cursor, (sd.len - cursor) * M, thickness));
    }
    return out;
  }
  function runSeg(type, sd, offsetPx, lengthM, thickness) {
    return sd.axis === 'h'
      ? seg(type, sd.x + offsetPx, sd.y, lengthM, 'h', thickness)
      : seg(type, sd.x, sd.y + offsetPx, lengthM, 'v', thickness);
  }

  const BUILDINGS = {
    /* a plain wooden house: one front door, one back door, a divided interior */
    house(ox, oy) {
      const w = 420, h = 340;
      const out = shell(ox, oy, w, h, 'wood', 0.3, [
        { side: 'n', at: 170 }, { side: 's', at: 200 },
      ]);
      // interior divider with a doorway
      out.push(seg('wood', ox + 240, oy + 12, 3.1, 'v', 0.2));
      out.push(seg('door', ox + 240, oy + 136, 1.5, 'v'));
      out.push(seg('wood', ox + 240, oy + 196, 3.5, 'v', 0.2));
      return out;
    },

    /* mansion: thicker walls, a reinforced core room, four ways in */
    mansion(ox, oy) {
      const w = 720, h = 520;
      const out = shell(ox, oy, w, h, 'wood', 0.4, [
        { side: 'n', at: 200 }, { side: 'n', at: 460 },
        { side: 's', at: 320 }, { side: 'w', at: 220 },
      ]);
      // interior wings
      out.push(seg('wood', ox + 280, oy + 14, 4.2, 'v', 0.3));
      out.push(seg('door', ox + 280, oy + 182, 1.5, 'v'));
      out.push(seg('wood', ox + 14, oy + 300, 6.6, 'h', 0.3));
      out.push(seg('door', ox + 292, oy + 300, 1.5, 'h'));
      // reinforced strongroom in the back corner
      out.push(seg('rwall', ox + 460, oy + 330, 6.4, 'h', 0.4));
      out.push(seg('rwall', ox + 460, oy + 330, 4.6, 'v', 0.4));
      out.push(seg('rdoor', ox + 560, oy + 330, 1.5, 'h'));
      return out;
    },

    /* military base: metal shell that ricochets rifle fire, wire + sandbags outside */
    base(ox, oy) {
      const w = 600, h = 400;
      const out = shell(ox, oy, w, h, 'metal', 0.6, [
        { side: 'w', at: 160, type: 'rdoor' }, { side: 'e', at: 200, type: 'rdoor' },
      ]);
      // thinner inner partition — this one you *can* shoot through
      out.push(seg('metal', ox + 300, oy + 20, 4.6, 'v', 0.3));
      out.push(seg('rdoor', ox + 300, oy + 204, 1.5, 'v'));
      // emplacements + perimeter wire
      out.push(seg('sandbag', ox - 90, oy + 60, 3.2, 'h', 0.5));
      out.push(seg('sandbag', ox - 90, oy + 300, 3.2, 'h', 0.5));
      out.push(seg('sandbag', ox + w + 20, oy + 180, 3.2, 'h', 0.5));
      out.push(seg('wire', ox - 120, oy - 60, 18, 'h', 0.4));
      out.push(seg('wire', ox - 120, oy - 60, 12, 'v', 0.4));
      return out;
    },

    /* warehouse: one big metal hall, a mezzanine wall, wide roller doors.
       Ricochet city — think twice before spraying inside it. */
    warehouse(ox, oy) {
      const w = 660, h = 420;
      const out = shell(ox, oy, w, h, 'metal', 0.55, [
        { side: 'n', at: 250, type: 'rdoor', len: 3 },
        { side: 's', at: 120 }, { side: 'e', at: 170, type: 'rdoor' },
      ]);
      // internal racking, staggered so there's no straight sightline through
      out.push(seg('metal', ox + 150, oy + 90, 4.5, 'v', 0.3));
      out.push(seg('metal', ox + 380, oy + 210, 4.5, 'v', 0.3));
      out.push(seg('barricade', ox + 220, oy + 300, 5, 'h', 0.3));
      out.push(seg('sandbag', ox + 470, oy + 110, 3, 'h', 0.5));
      return out;
    },

    /* bunker: small, squat and reinforced. Nothing short of HEAT gets in
       through the walls, so the doors are the fight. */
    bunker(ox, oy) {
      const w = 300, h = 240;
      const out = shell(ox, oy, w, h, 'rwall', 0.5, [
        { side: 'w', at: 90, type: 'rdoor' }, { side: 'e', at: 90, type: 'rdoor' },
      ]);
      // firing step inside
      out.push(seg('sandbag', ox + 40, oy + 60, 4.5, 'h', 0.5));
      out.push(seg('sandbag', ox + 40, oy + 180, 4.5, 'h', 0.5));
      // wire apron outside
      out.push(seg('wire', ox - 70, oy - 50, 11, 'h', 0.4));
      out.push(seg('wire', ox - 70, oy - 50, 8.5, 'v', 0.4));
      return out;
    },

    /* watchtower: tiny reinforced footprint with a commanding sightline.
       Cheap to hold, hard to dig out. */
    tower(ox, oy) {
      const w = 150, h = 150;
      const out = shell(ox, oy, w, h, 'rwall', 0.4, [{ side: 's', at: 45, type: 'rdoor' }]);
      out.push(seg('sandbag', ox - 50, oy + 170, 5, 'h', 0.5));
      return out;
    },

    /* shanty row: four flimsy wooden shacks. Everything here is toughness 1-2,
       so a Breacher or a fire axe can simply make a new door. */
    shanty(ox, oy) {
      const out = [];
      const hut = (hx, hy, w, h, doorAt) => {
        out.push(...shell(hx, hy, w, h, 'wood', 0.2, [{ side: 's', at: doorAt }]));
      };
      hut(ox, oy, 170, 140, 55);
      hut(ox + 210, oy + 30, 170, 140, 40);
      hut(ox + 40, oy + 200, 170, 140, 70);
      hut(ox + 250, oy + 220, 170, 140, 50);
      out.push(seg('barricade', ox + 185, oy + 180, 4, 'v', 0.3));
      return out;
    },

    /* fuel depot: sandbag revetments around metal tanks. Open ground with
       lots of low cover, so it plays completely unlike the buildings. */
    depot(ox, oy) {
      const out = [];
      const tank = (tx, ty) => {
        out.push(seg('metal', tx, ty, 2.6, 'h', 0.45));
        out.push(seg('metal', tx, ty + 70, 2.6, 'h', 0.45));
        out.push(seg('metal', tx, ty, 1.75, 'v', 0.45));
        out.push(seg('metal', tx + 104, ty, 1.75, 'v', 0.45));
      };
      tank(ox, oy); tank(ox + 190, oy); tank(ox + 95, oy + 150);
      out.push(seg('sandbag', ox - 50, oy - 40, 8, 'h', 0.5));
      out.push(seg('sandbag', ox - 50, oy + 260, 8, 'h', 0.5));
      out.push(seg('wire', ox + 330, oy - 20, 7, 'v', 0.4));
      return out;
    },

    /* apartment block: a long spine of rooms off a central corridor.
       The densest close-quarters fight on any map. */
    apartments(ox, oy) {
      const w = 780, h = 400;
      const out = shell(ox, oy, w, h, 'wood', 0.45, [
        { side: 'w', at: 170 }, { side: 'e', at: 170 }, { side: 'n', at: 360 },
      ]);
      // corridor walls with doors into each room
      out.push(seg('wood', ox + 14, oy + 150, 19, 'h', 0.3));
      out.push(seg('wood', ox + 14, oy + 250, 19, 'h', 0.3));
      for (const dx of [120, 320, 520, 660]) {
        out.push(seg('door', ox + dx, oy + 150, 1.5, 'h'));
        out.push(seg('door', ox + dx - 40, oy + 250, 1.5, 'h'));
      }
      // room dividers above and below the corridor
      for (const dx of [200, 400, 600]) {
        out.push(seg('wood', ox + dx, oy + 14, 3.4, 'v', 0.25));
        out.push(seg('wood', ox + dx, oy + 250, 3.4, 'v', 0.25));
      }
      return out;
    },

    /* hangar: one enormous metal shed with a blast door. Wide open inside,
       so it is all about the approach. */
    hangar(ox, oy) {
      const w = 820, h = 480;
      const out = shell(ox, oy, w, h, 'metal', 0.65, [
        { side: 's', at: 330, type: 'rdoor', len: 4 },
        { side: 'w', at: 200, type: 'rdoor' },
      ]);
      out.push(seg('sandbag', ox + 120, oy + 120, 5, 'h', 0.5));
      out.push(seg('sandbag', ox + 500, oy + 340, 5, 'h', 0.5));
      out.push(seg('barricade', ox + 380, oy + 60, 6, 'v', 0.3));
      return out;
    },

    /* farm: a big barn plus a fenced yard. Wood everywhere — a Breacher's map. */
    farm(ox, oy) {
      const out = shell(ox, oy, 420, 300, 'wood', 0.35, [
        { side: 's', at: 170, len: 3 }, { side: 'n', at: 60 },
      ]);
      out.push(seg('wood', ox + 200, oy + 14, 2.4, 'v', 0.25));
      // yard fence, deliberately flimsy
      out.push(seg('barricade', ox + 470, oy + 40, 8, 'v', 0.25));
      out.push(seg('barricade', ox + 470, oy + 40, 7, 'h', 0.25));
      out.push(seg('barricade', ox + 470, oy + 360, 7, 'h', 0.25));
      out.push(seg('wire', ox - 60, oy + 340, 8, 'h', 0.4));
      return out;
    },

    /* checkpoint: sandbag chicane across a lane, with a hard reinforced post.
       Cheap, low, and it breaks up open ground. */
    checkpoint(ox, oy) {
      const out = [];
      out.push(seg('sandbag', ox, oy, 5, 'h', 0.5));
      out.push(seg('sandbag', ox + 120, oy + 110, 5, 'h', 0.5));
      out.push(seg('sandbag', ox, oy + 220, 5, 'h', 0.5));
      out.push(...shell(ox + 250, oy + 60, 130, 110, 'rwall', 0.4, [{ side: 'w', at: 40, type: 'rdoor' }]));
      out.push(seg('wire', ox - 40, oy - 40, 5, 'v', 0.4));
      return out;
    },

    /* ---------- LANDMARKS ----------
       One-offs, much bigger than the ordinary buildings, meant to anchor a
       whole area of the map and be worth fighting over. */

    /* silo complex: three reinforced drums joined by a walkway */
    silos(ox, oy) {
      const out = [];
      const drum = (dx, dy, r) => {
        // a ring of short reinforced segments approximates a round silo
        const n = 10;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const px = dx + Math.cos(a) * r, py = dy + Math.sin(a) * r;
          const seg1 = seg('rwall', px, py, 1.4, i % 2 ? 'h' : 'v', 0.4);
          out.push(seg1);
        }
      };
      drum(ox + 150, oy + 150, 120);
      drum(ox + 470, oy + 150, 120);
      drum(ox + 310, oy + 430, 120);
      // connecting gantry
      out.push(seg('metal', ox + 150, oy + 150, 8, 'h', 0.5));
      out.push(seg('metal', ox + 310, oy + 150, 7, 'v', 0.5));
      out.push(seg('sandbag', ox + 40, oy + 560, 8, 'h', 0.5));
      return out;
    },

    /* factory: a long hall with an internal spine and loading bays */
    factory(ox, oy) {
      const w = 1000, h = 560;
      const out = shell(ox, oy, w, h, 'metal', 0.6, [
        { side: 'n', at: 200, type: 'rdoor', len: 4 },
        { side: 'n', at: 640, type: 'rdoor', len: 4 },
        { side: 's', at: 420, type: 'rdoor', len: 4 },
        { side: 'w', at: 240, type: 'rdoor' },
      ]);
      // production line down the middle, with gaps to move through
      for (const x of [260, 500, 740]) {
        out.push(seg('metal', ox + x, oy + 40, 3, 'v', 0.35));
        out.push(seg('metal', ox + x, oy + 340, 4.5, 'v', 0.35));
      }
      out.push(seg('rwall', ox + 60, oy + 280, 6, 'h', 0.4));
      out.push(seg('sandbag', ox + 700, oy + 200, 5, 'h', 0.5));
      return out;
    },

    /* keep: a walled compound with an inner reinforced hold */
    keep(ox, oy) {
      const w = 820, h = 760;
      const out = shell(ox, oy, w, h, 'rwall', 0.5, [
        { side: 's', at: 340, type: 'rdoor', len: 3 },
        { side: 'n', at: 380, type: 'rdoor', len: 3 },
      ]);
      // corner towers
      for (const [tx, ty] of [[0, 0], [w - 130, 0], [0, h - 130], [w - 130, h - 130]]) {
        out.push(...shell(ox + tx, oy + ty, 130, 130, 'rwall', 0.45, []));
      }
      // inner hold
      out.push(...shell(ox + 250, oy + 250, 320, 260, 'rwall', 0.5, [{ side: 'w', at: 90, type: 'rdoor' }]));
      out.push(seg('wire', ox - 60, oy - 60, 22, 'h', 0.4));
      return out;
    },

    /* camp: a cluster of low tents behind sandbags and wire */
    camp(ox, oy) {
      const out = [];
      const tent = (tx, ty, size) => {
        out.push(seg('barricade', tx, ty, size / PX_PER_M, 'h', 0.25));
        out.push(seg('barricade', tx, ty + size, size / PX_PER_M, 'h', 0.25));
        out.push(seg('barricade', tx, ty, size / PX_PER_M, 'v', 0.25));
        // fourth side left open as the entrance
      };
      tent(ox, oy, 120);
      tent(ox + 190, oy + 40, 120);
      tent(ox + 60, oy + 210, 120);
      tent(ox + 250, oy + 240, 120);
      out.push(seg('sandbag', ox - 40, oy + 160, 4, 'h', 0.5));
      out.push(seg('sandbag', ox + 390, oy + 30, 5, 'v', 0.5));
      out.push(seg('wire', ox - 60, oy - 50, 12, 'h', 0.4));
      return out;
    },

    /* hospital: medical loot, open layout for triage, few walls for mobility */
    hospital(ox, oy) {
      const w = 640, h = 480;
      const out = shell(ox, oy, w, h, 'wood', 0.4, [
        { side: 'n', at: 240, type: 'door', len: 3 },
        { side: 's', at: 280 }, { side: 'e', at: 300, type: 'door' },
      ]);
      // reception hall + treatment wings (low walls for sightlines)
      out.push(seg('barricade', ox + 120, oy + 80, 4, 'v', 0.3));
      out.push(seg('barricade', ox + 120, oy + 380, 4, 'v', 0.3));
      out.push(seg('barricade', ox + 420, oy + 140, 5, 'v', 0.3));
      // interior divisions (rooms open to corridors)
      out.push(seg('door', ox + 240, oy + 200, 1.5, 'h'));
      out.push(seg('door', ox + 380, oy + 280, 1.5, 'v'));
      return out;
    },

    /* factory: industrial metal structure, tight corridors, high loot density */
    factory(ox, oy) {
      const w = 760, h = 520;
      const out = shell(ox, oy, w, h, 'metal', 0.5, [
        { side: 'n', at: 300, type: 'rdoor', len: 3 },
        { side: 's', at: 200, type: 'rdoor', len: 2 },
        { side: 'w', at: 240, type: 'door' },
      ]);
      // industrial floor: metal racking and partitions
      out.push(seg('metal', ox + 150, oy + 50, 5.5, 'v', 0.3));
      out.push(seg('metal', ox + 300, oy + 150, 5.5, 'v', 0.3));
      out.push(seg('metal', ox + 500, oy + 80, 5.5, 'v', 0.3));
      out.push(seg('barricade', ox + 100, oy + 320, 6, 'h', 0.3));
      out.push(seg('barricade', ox + 520, oy + 280, 6, 'h', 0.3));
      // control room (reinforced corner)
      out.push(seg('rwall', ox + 650, oy + 60, 3, 'h', 0.35));
      out.push(seg('rwall', ox + 650, oy + 60, 3, 'v', 0.35));
      out.push(seg('rdoor', ox + 650, oy + 180, 1.5, 'v'));
      return out;
    },

    /* dock: long wharf with crates and shipping containers, water-side hazard */
    dock(ox, oy) {
      const out = [];
      // main warehouse
      out.push(...shell(ox, oy, 520, 380, 'metal', 0.45, [
        { side: 's', at: 180, type: 'door', len: 2 },
        { side: 'w', at: 100, type: 'door' },
      ]));
      // container stacks (high cover)
      for (let i = 0; i < 2; i++) {
        out.push(seg('metal', ox + 20 + i * 200, oy + 450, 4, 'h', 0.45));
        out.push(seg('metal', ox + 20 + i * 200, oy + 450, 2, 'v', 0.45));
      }
      // shipping crates and sandbags (low cover density)
      out.push(seg('barricade', ox + 600, oy + 80, 5, 'v', 0.3));
      out.push(seg('sandbag', ox + 600, oy + 250, 4, 'h', 0.5));
      return out;
    },

    /* fortress: multi-layer defense, reinforced strongpoint, heavy to assault */
    fortress(ox, oy) {
      const w = 500, h = 500;
      const out = [];
      // outer perimeter (sandbags)
      out.push(seg('sandbag', ox - 60, oy - 60, 10, 'h', 0.5));
      out.push(seg('sandbag', ox - 60, oy + w + 60, 10, 'h', 0.5));
      out.push(seg('sandbag', ox - 60, oy - 60, 10, 'v', 0.5));
      out.push(seg('sandbag', ox + w + 60, oy - 60, 10, 'v', 0.5));
      // main walls (reinforced)
      out.push(...shell(ox, oy, w, h, 'rwall', 0.5, [
        { side: 'n', at: 180, type: 'rdoor' }, { side: 'e', at: 160, type: 'rdoor' },
      ]));
      // inner strongroom
      out.push(seg('rwall', ox + 160, oy + 80, 3.6, 'h', 0.4));
      out.push(seg('rwall', ox + 160, oy + 80, 3.6, 'v', 0.4));
      out.push(seg('rdoor', ox + 280, oy + 80, 1.5, 'h'));
      // firing positions
      out.push(seg('sandbag', ox + 60, oy + 240, 3, 'h', 0.5));
      out.push(seg('sandbag', ox + 420, oy + 240, 3, 'h', 0.5));
      return out;
    },

    /* radio tower: tiny observation post, tall sight lines, isolated loot */
    'radio-tower'(ox, oy) {
      const out = [];
      // tower foundation
      out.push(...shell(ox, oy, 120, 120, 'rwall', 0.35, [{ side: 's', at: 40, type: 'rdoor' }]));
      // antenna tower (visual only, not functional)
      out.push(seg('metal', ox + 60, oy - 100, 1, 'v', 0.3));  // mast
      // perimeter wire
      out.push(seg('wire', ox - 80, oy - 80, 6, 'h', 0.4));
      out.push(seg('wire', ox - 80, oy - 80, 6, 'v', 0.4));
      out.push(seg('wire', ox + 200, oy - 80, 6, 'v', 0.4));
      out.push(seg('wire', ox - 80, oy + 200, 6, 'h', 0.4));
      return out;
    },

    /* prison: high-security cells with reinforced walls, hard to breach */
    prison(ox, oy) {
      const w = 800, h = 600;
      const out = shell(ox, oy, w, h, 'rwall', 0.5, [
        { side: 'n', at: 320, type: 'rdoor', len: 2 },
        { side: 's', at: 200, type: 'rdoor' },
      ]);
      // cell block north: 4 cells × 2 rows
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
          const cx = ox + 80 + col * 120, cy = oy + 100 + row * 160;
          out.push(seg('rwall', cx, cy, 2.8, 'h', 0.35));
          out.push(seg('rwall', cx, cy, 2.8, 'v', 0.35));
          out.push(seg('rdoor', cx + 56, cy, 1.2, 'h'));  // cell entrance
        }
      }
      // guard corridor
      out.push(seg('metal', ox + 50, oy + 300, 7.2, 'h', 0.3));
      // watchtower (corner)
      out.push(seg('rwall', ox + 650, oy + 450, 2, 'h', 0.4));
      out.push(seg('rwall', ox + 650, oy + 450, 2, 'v', 0.4));
      out.push(seg('sandbag', ox + 700, oy + 400, 3, 'h', 0.5));
      return out;
    },

    /* bank: ultra-secure vault with minimal entry points, high-tier loot */
    bank(ox, oy) {
      const w = 520, h = 420;
      const out = shell(ox, oy, w, h, 'rwall', 0.55, [
        { side: 'n', at: 200, type: 'rdoor', len: 1.5 },
      ]);
      // front lobby (reinforced)
      out.push(seg('metal', ox + 120, oy + 80, 2.8, 'h', 0.4));
      // vault room (ultra-secure)
      out.push(seg('rwall', ox + 320, oy + 120, 4, 'h', 0.5));
      out.push(seg('rwall', ox + 320, oy + 120, 3.2, 'v', 0.5));
      out.push(seg('rdoor', ox + 360, oy + 120, 1, 'h'));  // narrow vault entrance
      // teller stations + secure boxes
      out.push(seg('metal', ox + 150, oy + 200, 2.2, 'h', 0.3));
      out.push(seg('metal', ox + 300, oy + 280, 2.2, 'v', 0.3));
      return out;
    },

    /* market: diverse trading post with many entry points, varied cover */
    market(ox, oy) {
      const w = 680, h = 520;
      const out = shell(ox, oy, w, h, 'wood', 0.35, [
        { side: 'n', at: 160 }, { side: 'n', at: 400 },
        { side: 's', at: 200 }, { side: 'e', at: 280 },
      ]);
      // market stalls (scattered, low cover)
      for (let i = 0; i < 5; i++) {
        out.push(seg('barricade', ox + 100 + i * 110, oy + 150 + (i % 2) * 200, 2, 'h', 0.25));
        out.push(seg('barricade', ox + 100 + i * 110, oy + 150 + (i % 2) * 200, 1.8, 'v', 0.25));
      }
      // vendor counter
      out.push(seg('wood', ox + 320, oy + 320, 4.2, 'h', 0.3));
      return out;
    },

    /* school: open classrooms, varied heights, educational theme */
    school(ox, oy) {
      const w = 640, h = 560;
      const out = shell(ox, oy, w, h, 'wood', 0.4, [
        { side: 'n', at: 240, type: 'door', len: 2 },
        { side: 's', at: 320 },
      ]);
      // classroom wings (north + south corridor)
      out.push(seg('wood', ox + 14, oy + 200, 8.4, 'h', 0.3));  // divider
      for (const dx of [100, 240, 380, 520]) {
        out.push(seg('door', ox + dx, oy + 200, 1.5, 'h'));  // classroom doors
      }
      // gym (large open area)
      out.push(seg('barricade', ox + 400, oy + 380, 5, 'h', 0.25));
      out.push(seg('barricade', ox + 400, oy + 380, 3.5, 'v', 0.25));
      // cafeteria (low walls, many tables)
      out.push(seg('barricade', ox + 180, oy + 450, 3, 'h', 0.25));
      return out;
    },

    /* church: tall open interior, minimal internal walls, spiritual cover */
    church(ox, oy) {
      const w = 500, h = 620;
      const out = shell(ox, oy, w, h, 'wood', 0.45, [
        { side: 'n', at: 180, type: 'door', len: 2 },
        { side: 's', at: 200, type: 'door' },
      ]);
      // altar platform (elevated, central focus)
      out.push(seg('wood', ox + 220, oy + 100, 3, 'h', 0.3));
      out.push(seg('wood', ox + 220, oy + 100, 2, 'v', 0.3));
      // pews (linear rows for cover)
      for (let i = 0; i < 4; i++) {
        out.push(seg('barricade', ox + 60, oy + 220 + i * 80, 3.6, 'h', 0.25));
      }
      // bell tower (back corner)
      out.push(seg('metal', ox + 420, oy + 400, 2, 'h', 0.35));
      out.push(seg('metal', ox + 420, oy + 400, 2.5, 'v', 0.35));
      return out;
    },

    /* museum: cultural artifacts, high ceilings, display cases as cover */
    museum(ox, oy) {
      const w = 720, h = 580;
      const out = shell(ox, oy, w, h, 'wood', 0.4, [
        { side: 'n', at: 280, type: 'door', len: 2 },
        { side: 'e', at: 180, type: 'door' },
      ]);
      // gallery halls (parallel wings with art display walls)
      out.push(seg('wood', ox + 180, oy + 80, 6, 'v', 0.3));
      out.push(seg('wood', ox + 380, oy + 80, 6, 'v', 0.3));
      out.push(seg('wood', ox + 580, oy + 140, 5, 'v', 0.3));
      // central atrium (open area, few walls)
      out.push(seg('wood', ox + 280, oy + 300, 3.2, 'h', 0.25));
      // security desk
      out.push(seg('metal', ox + 100, oy + 200, 2.2, 'h', 0.3));
      return out;
    },

    /* barracks: military dormitory, many small rooms, high-loot density */
    barracks(ox, oy) {
      const w = 700, h = 500;
      const out = shell(ox, oy, w, h, 'metal', 0.45, [
        { side: 'w', at: 120, type: 'door' }, { side: 'e', at: 180, type: 'door' },
      ]);
      // bunk room 1 (north wing)
      out.push(seg('metal', ox + 120, oy + 80, 3.4, 'v', 0.3));
      out.push(seg('door', ox + 120, oy + 220, 1.5, 'v'));
      // bunk room 2 (central)
      out.push(seg('metal', ox + 360, oy + 100, 3.4, 'v', 0.3));
      out.push(seg('door', ox + 360, oy + 240, 1.5, 'v'));
      // common area (south)
      out.push(seg('barricade', ox + 280, oy + 380, 4, 'h', 0.3));
      // armory (reinforced corner)
      out.push(seg('rwall', ox + 600, oy + 350, 2.8, 'h', 0.35));
      out.push(seg('rwall', ox + 600, oy + 350, 2.8, 'v', 0.35));
      out.push(seg('rdoor', ox + 650, oy + 350, 1.2, 'h'));
      return out;
    },

    /* armory: weapons cache, heavily reinforced, sparse interior */
    armory(ox, oy) {
      const w = 480, h = 360;
      const out = shell(ox, oy, w, h, 'rwall', 0.55, [
        { side: 's', at: 150, type: 'rdoor', len: 1.5 },
      ]);
      // weapon racks (metal storage)
      out.push(seg('metal', ox + 100, oy + 80, 1.8, 'h', 0.4));
      out.push(seg('metal', ox + 220, oy + 100, 1.8, 'h', 0.4));
      out.push(seg('metal', ox + 340, oy + 110, 1.8, 'h', 0.4));
      // ammo vault (ultra-secure)
      out.push(seg('rwall', ox + 320, oy + 200, 2.2, 'h', 0.5));
      out.push(seg('rwall', ox + 320, oy + 200, 2, 'v', 0.5));
      out.push(seg('rdoor', ox + 350, oy + 200, 1, 'h'));
      return out;
    },

    /* arena: open center with spectator seating, ring of cover */
    arena(ox, oy) {
      const w = 700, h = 700;
      const out = [];
      // outer ring wall (spectator barrier)
      out.push(seg('sandbag', ox - 40, oy - 40, 14, 'h', 0.5));
      out.push(seg('sandbag', ox - 40, oy + w + 40, 14, 'h', 0.5));
      out.push(seg('sandbag', ox - 40, oy - 40, 14, 'v', 0.5));
      out.push(seg('sandbag', ox + w + 40, oy - 40, 14, 'v', 0.5));
      // inner ring (lower seating cover)
      out.push(seg('barricade', ox + 80, oy + 80, 12, 'h', 0.3));
      out.push(seg('barricade', ox + 80, oy + 80, 12, 'v', 0.3));
      out.push(seg('barricade', ox + w - 80, oy + 80, 12, 'v', 0.3));
      out.push(seg('barricade', ox + 80, oy + w - 80, 12, 'h', 0.3));
      // center pit (open, vulnerable)
      return out;
    },

    /* bridge fortification: narrow linear structure, forced engagement */
    'bridge-fort'(ox, oy) {
      const out = [];
      // main bridge deck (metal)
      out.push(seg('metal', ox, oy, 8, 'h', 0.4));
      // fortification pillars + sandbags
      for (let i = 0; i < 4; i++) {
        out.push(seg('sandbag', ox + 120 + i * 140, oy - 60, 1.5, 'h', 0.5));
        out.push(seg('sandbag', ox + 120 + i * 140, oy + 60, 1.5, 'h', 0.5));
      }
      // center strongpoint
      out.push(seg('rwall', ox + 300, oy - 80, 2.2, 'h', 0.4));
      out.push(seg('rwall', ox + 300, oy - 80, 2.2, 'v', 0.4));
      out.push(seg('rwall', ox + 300, oy + 80, 2.2, 'h', 0.4));
      out.push(seg('rwall', ox + 300, oy + 80, 2.2, 'v', 0.4));
      return out;
    },

    /* train station: linear with platforms, multiple entry points */
    'train-station'(ox, oy) {
      const w = 800, h = 500;
      const out = shell(ox, oy, w, h, 'metal', 0.4, [
        { side: 'n', at: 200 }, { side: 'n', at: 500 },
        { side: 's', at: 250 }, { side: 'w', at: 150, type: 'door' },
      ]);
      // track platforms (metal rails as barriers)
      out.push(seg('metal', ox + 100, oy + 180, 7.2, 'h', 0.3));
      out.push(seg('metal', ox + 300, oy + 180, 7.2, 'h', 0.3));
      // passenger benches + pillars (cover)
      for (let i = 0; i < 3; i++) {
        out.push(seg('wood', ox + 150 + i * 200, oy + 80, 1.6, 'v', 0.3));
      }
      // station office
      out.push(seg('wood', ox + 650, oy + 200, 2.6, 'h', 0.35));
      out.push(seg('wood', ox + 650, oy + 200, 2.6, 'v', 0.35));
      return out;
    },

    /* power plant: industrial complex with hazardous generators */
    'power-plant'(ox, oy) {
      const w = 820, h = 600;
      const out = shell(ox, oy, w, h, 'metal', 0.5, [
        { side: 'w', at: 150, type: 'rdoor' }, { side: 'e', at: 200, type: 'rdoor' },
      ]);
      // turbine hall (large open area)
      out.push(seg('metal', ox + 200, oy + 100, 5, 'v', 0.4));
      out.push(seg('metal', ox + 400, oy + 120, 5, 'v', 0.4));
      out.push(seg('metal', ox + 600, oy + 80, 5, 'v', 0.4));
      // control room (reinforced)
      out.push(seg('rwall', ox + 650, oy + 350, 3.2, 'h', 0.4));
      out.push(seg('rwall', ox + 650, oy + 350, 3.2, 'v', 0.4));
      out.push(seg('rdoor', ox + 720, oy + 350, 1.5, 'h'));
      // cooling systems (low walls, hazard zones)
      out.push(seg('barricade', ox + 100, oy + 450, 4, 'h', 0.3));
      out.push(seg('barricade', ox + 500, oy + 500, 4, 'h', 0.3));
      return out;
    },

    /* fuel depot (expanded): gas station with pumps + convenience store */
    'gas-station'(ox, oy) {
      const out = [];
      // fuel pump islands (metal)
      for (let i = 0; i < 2; i++) {
        out.push(seg('metal', ox + 60, oy + 40 + i * 120, 2, 'h', 0.35));
        out.push(seg('metal', ox + 60, oy + 40 + i * 120, 1.4, 'v', 0.35));
      }
      // convenience store (small structure)
      out.push(...shell(ox + 280, oy - 20, 240, 200, 'wood', 0.3, [
        { side: 's', at: 80, type: 'door', len: 1.2 },
      ]));
      // storage tanks (hazard)
      out.push(seg('metal', ox + 480, oy + 160, 2.2, 'h', 0.4));
      out.push(seg('metal', ox + 480, oy + 160, 2.2, 'v', 0.4));
      return out;
    },

    /* mine: underground quarry with vertical drops and tight passages */
    mine(ox, oy) {
      const w = 680, h = 640;
      const out = shell(ox, oy, w, h, 'rock', 0.4, [
        { side: 'n', at: 240, type: 'door' }, { side: 's', at: 280, type: 'door' },
      ]);
      // mining shafts (vertical passages)
      out.push(seg('rock', ox + 150, oy + 120, 4.4, 'v', 0.35));
      out.push(seg('rock', ox + 400, oy + 100, 4.8, 'v', 0.35));
      // support structures (wooden scaffolding)
      out.push(seg('wood', ox + 280, oy + 280, 3.2, 'h', 0.25));
      out.push(seg('wood', ox + 500, oy + 320, 3, 'h', 0.25));
      // equipment room (metal reinforced)
      out.push(seg('metal', ox + 580, oy + 450, 2.8, 'h', 0.35));
      out.push(seg('metal', ox + 580, oy + 450, 2.8, 'v', 0.35));
      return out;
    },
  };

  /* ---------- DECOR PLACEMENT ----------
     The props themselves (their look, radius and shadow) live in sprites.js;
     this is only the scattering helper the map generator uses. */
  /* scatter n props of the given kinds inside a rect */
  function scatter(kinds, x, y, w, h, n, rng) {
    const rand = rng || Math.random;
    const out = [];
    for (let i = 0; i < n; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)];
      out.push({
        kind, x: x + rand() * w, y: y + rand() * h,
        rot: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.45,
      });
    }
    return out;
  }

  return {
    WALL_TYPES, PROP_TYPES, BUILDINGS, scatter, prop, PX_PER_M, HP_SCALE,
    def, maxHp, toughness, ballistics, blocksSight, blocksMove, isDoor, seg, shell,
    /* place a named building and tag every piece with it */
    place(name, ox, oy) {
      const parts = BUILDINGS[name](ox, oy);
      parts.forEach(p => { p.building = name; });
      return parts;
    },
  };
})();
