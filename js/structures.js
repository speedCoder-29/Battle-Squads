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

   Building design note:
     • Each blueprint is tuned to a gameplay role, cover density, and engagement style.
       Combat inside these structures is meant to feel distinct from open terrain.

   Engine mapping notes:
     • Thickness/length are design metres; PX_PER_M converts them.
       A "0.3 thickness, 1.5 length" door is 12px thick and 60px wide.
     • HP is the table's number, scaled — see HP_SCALE and
       FLAT_SCALE below for why there are two scales and not one.
     • Toughness is the minimum tool Structure Pierce needed to
       damage the wall by hand. Tools with an explicit clearing
       effect (bayonet→wire, spade→sandbags) ignore it, and
       explosives ignore it entirely.
     • Height decides sight: "high" blocks line of sight, "low"
       is cover you can see over, "under" (trench) blocks nothing.
   ============================================================ */
const Structures = (() => {
  const PX_PER_M = 40;
  /* ---------- two HP scales, and why ----------
     The design table measures HP two different ways and they don't meet. Wood
     is "10 × thickness", so the standard 0.3 wall is 3 HP — a single rifle
     round. Doors are a flat 30, even though the table's own Effect column
     describes a door as wood at 0.3 thickness, which by the formula would make
     it 3. The table disagrees with itself, so no single multiplier can honour
     all of it.

     What the numbers clearly mean is a ranking, and the ranking is what gets
     preserved. Thickness-derived HP is scaled by HP_SCALE, flat HP by
     FLAT_SCALE, both chosen so the two families land in the same playable
     range: a 0.3 wood wall and a door both come out at 90 — seven rifle rounds
     — and everything else keeps its position relative to them. */
  const HP_SCALE = 30;     // for the "N × thickness" rows: wood, metal
  const FLAT_SCALE = 3;    // for the rows given a flat number
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
      name: 'Door', height: 'high', tableHp: 30, toughness: 1, door: true,
      bullets: 'pen', lossPerM: 1.0,            // it's wood, 0.3 thick
      defThickness: 0.3, defLength: 1.5,
      fill: '#9a7244', stroke: 'rgba(255,210,140,0.95)',
      effect: 'Opens and closes',
    },
    rdoor: {
      name: 'Reinforced Door', height: 'high', tableHp: 10, toughness: 5, door: true,
      bullets: 'reflect', defThickness: 0.35, defLength: 1.5,
      fill: '#3d5070', stroke: 'rgba(220,235,255,0.95)',
      effect: 'Opens and closes · bullets ricochet for 50%',
    },
    rwall: {
      name: 'Reinforced Wall', height: 'high', tableHp: 10, toughness: 5,
      bullets: 'reflect',
      fill: '#4a5e80', stroke: 'rgba(200,220,255,0.90)',
      effect: 'Bullets ricochet for 50%',
    },
    wire: {
      name: 'Barbed Wire', height: 'low', tableHp: 30, toughness: 5,
      bullets: 'through', passable: true, slow: 0.1, dps: 2,
      fill: 'rgba(180,200,240,0.18)', stroke: 'rgba(220,235,255,0.85)',
      effect: '90% movement slowdown · 2 damage/s',
    },
    sandbag: {
      name: 'Sand Bags', height: 'low', tableHp: 100, toughness: 6,
      bullets: 'stop',
      fill: '#7a7040', stroke: 'rgba(245,225,140,0.85)',
      effect: 'Stops bullets outright',
    },
    barricade: {
      name: 'Barricade', height: 'low', tableHp: 50, toughness: 1,
      bullets: 'pen', flatLoss: 0.5,
      fill: '#6a5a85', stroke: 'rgba(200,140,255,0.80)',
      effect: 'Bullets lose 50% damage passing through',
    },
    trench: {
      name: 'Trench', height: 'under', tableHp: 1, toughness: 6,
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
    window: {
      name: 'Window', height: 'high', hp: 80, toughness: 1,
      bullets: 'pen', flatLoss: 0.35,
      fill: 'rgba(130,170,220,0.35)', stroke: 'rgba(210,235,255,0.80)',
      effect: 'Light cover and visibility; shatters when shot.',
    },
    desk: {
      name: 'Desk', height: 'low', hp: 60, toughness: 1, prop: 'desk',
      bullets: 'stop',
      fill: '#5c4a34', stroke: '#3e2f1f',
      effect: 'Furniture that blocks bullets and provides cover.',
    },
    locker: {
      name: 'Locker', height: 'low', hp: 100, toughness: 2, prop: 'locker',
      bullets: 'stop',
      fill: '#4b4f5f', stroke: '#2e323d',
      effect: 'Sturdy storage used as cover and loot furniture.',
    },
    ammoBox: {
      name: 'Ammo Box', height: 'low', hp: 70, toughness: 1, prop: 'ammoBox',
      bullets: 'stop',
      fill: '#4f4e35', stroke: '#2f2d1f',
      effect: 'Ammo crate: durable cover with tactical clutter.',
    },
    pallet: {
      name: 'Pallet', height: 'low', hp: 40, toughness: 1, prop: 'pallet',
      bullets: 'pen', flatLoss: 0.4,
      fill: 'rgba(110,84,42,0.9)', stroke: '#46371d',
      effect: 'Stacked goods cover with weak protection.',
    },
    tyre: {
      name: 'Tyre', height: 'low', hp: 35, toughness: 1, prop: 'tyre',
      bullets: 'through', passable: true,
      fill: '#2d2d2d', stroke: '#0f0f0f',
      effect: 'Light cover with visibility gaps.',
    },
    rubble: {
      name: 'Rubble', height: 'low', hp: 45, toughness: 1, prop: 'rubble',
      bullets: 'through', passable: true,
      fill: '#8f8f8f', stroke: '#5d5d5d',
      effect: 'Debris that slows movement and blocks little.',
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
  const PROP_TYPES = ['crate', 'barrel', 'tree', 'rock', 'container', 'bush', 'desk', 'locker', 'ammoBox', 'pallet', 'tyre', 'rubble'];

  /* ---------- derived stats ---------- */
  const def = (type) => WALL_TYPES[type] || WALL_TYPES.wood;

  function maxHp(type, thickness) {
    const d = def(type);
    // straight from the design table, on the flat-number scale
    if (d.tableHp !== undefined) return d.tableHp * FLAT_SCALE;
    // props are an engine addition, not in the table — their HP is literal
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
     Every blueprint is designed with a role, cover density, and engagement style:
       - tactical choke points, open halls, reinforced vaults, or low-cover camps.
       - entry count, sightline complexity, and internal cover are all deliberate.
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

  /* ============================================================
     SUB-BUILDINGS: what each kind of room is worth going into.

     Until now a building's loot was a count and a tier roll — eight crates
     somewhere inside a warehouse, rolled the same way whichever eight tiles
     they landed on. Rooms replace that with the design table: a bathroom
     holds exactly one regular crate, a safe holds one gold, a plane holds ten
     regular, and the reason to cross a resort is that the lounge has a silver
     in it and the bedrooms don't.

     `crates` is a list of [tier, count]. `vehicles` spawn a drivable hull.
     `chance` is a per-crate upgrade roll, which is how the shipping yard
     works: fifteen containers, one of which is worth opening.
     ============================================================ */
  const ROOM_LOOT = {
    bathroom:       { name: 'Bathroom',        crates: [['regular', 1]] },
    bedroom:        { name: 'Bedroom',         crates: [['regular', 1]] },
    kitchen:        { name: 'Kitchen',         crates: [['regular', 3]] },
    safe:           { name: 'Safe',            crates: [['gold', 1]] },
    dining:         { name: 'Dining Room',     crates: [] },
    pool:           { name: 'Swimming Pool',   crates: [['silver', 1]], needs: 'diver' },
    garage:         { name: 'Garage',          crates: [['regular', 2]], vehicles: [['jeep', 1]] },
    washroom:       { name: 'Public Washroom', crates: [['regular', 5]] },
    diningLobby:    { name: 'Dining Lobby',    crates: [] },
    backKitchen:    { name: 'Back Kitchen',    crates: [['regular', 5]] },
    lounge:         { name: 'Lounge',          crates: [['silver', 1]] },
    dock:           { name: 'Dock',            crates: [['regular', 2]] },
    gate:           { name: 'Gate',            crates: [] },
    plane:          { name: 'Plane',           crates: [['regular', 10]] },
    track:          { name: 'Track',           crates: [['regular', 10]] },
    warehouse:      { name: 'Warehouse',       crates: [['regular', 8]] },
    shippedCrate:   { name: 'Shipped Container', crates: [['regular', 1]], chance: { tier: 'gold', odds: 1 / 15 } },
    shippingCrate:  { name: 'Shipping Container', crates: [] },
    portapotty:     { name: 'Portapotty',      crates: [['regular', 1]] },
    mainExhibit:    { name: 'Main Exhibit',    crates: [] },
    gunExhibit:     { name: 'Gun Exhibit',     crates: [['regular', 5]] },
    displayHall:    { name: 'Display Hallway', crates: [['gold', 1]] },
    tent:           { name: 'Tent',            crates: [['regular', 1]] },
    parkingLot:     { name: 'Parking Lot',     vehicles: [['jeep', 4]] },
    lodge:          { name: 'Lodge',           crates: [['regular', 3]] },
    wheatField:     { name: 'Wheat Field',     crates: [['silver', 1]] },
    barn:           { name: 'Barn',            crates: [['regular', 8]] },
    chickenCoop:    { name: 'Chicken Coop',    crates: [['gold', 1]] },
    lobby:          { name: 'Lobby',           crates: [['silver', 1]] },

    /* Rooms for the buildings that aren't in the design table. Sized so a
       building holds roughly what its old flat loot count gave it — the point
       of the change is that you can now tell which room is worth entering,
       not that there is more of everything. */
    ward:           { name: 'Ward',            crates: [['regular', 1]] },
    surgery:        { name: 'Surgery',         crates: [['silver', 1]] },
    dispensary:     { name: 'Dispensary',      crates: [['regular', 3]] },
    classroom:      { name: 'Classroom',       crates: [['regular', 1]] },
    staffRoom:      { name: 'Staff Room',      crates: [['silver', 1]] },
    gym:            { name: 'Gymnasium',       crates: [['regular', 2]] },
    bunkroom:       { name: 'Bunk Room',       crates: [['regular', 2]] },
    armoury:        { name: 'Armoury',         crates: [['gold', 1]] },
    cell:           { name: 'Cell',            crates: [['regular', 1]] },
    guardRoom:      { name: 'Guard Room',      crates: [['silver', 1]] },
    apartment:      { name: 'Apartment',       crates: [['regular', 2]] },
    stall:          { name: 'Market Stall',    crates: [['regular', 2]] },
    office:         { name: 'Office',          crates: [['regular', 1]] },
    strongroom:     { name: 'Strongroom',      crates: [['gold', 1]] },
    storeroom:      { name: 'Storeroom',       crates: [['regular', 3]] },
    workbay:        { name: 'Work Bay',        crates: [['regular', 2]] },
    controlRoom:    { name: 'Control Room',    crates: [['silver', 1]] },
  };

  /* A room is a rectangle inside a building that the loot pass fills. Rooms
     are declarative — they carry no walls of their own, so a blueprint can
     mark out the space a kitchen occupies without having to box it in. */
  const room = (kind, x, y, w, h) => ({ kind, x, y, w, h });
  /* n rooms of one kind laid out in a strip, which is most of what a resort
     corridor or a row of tents actually is */
  function roomRow(kind, x, y, w, h, n, axis) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(axis === 'v'
        ? room(kind, x, y + (h / n) * i, w, h / n)
        : room(kind, x + (w / n) * i, y, w / n, h));
    }
    return out;
  }

  /* ---------- interior walls ----------
     Blueprints used to divide a building by hand: a wall segment, a door
     segment, another wall segment, with the offsets worked out on paper. That
     is fine for one divider and unmaintainable for a corridor of eight rooms,
     which is why most buildings had a shell and almost nothing inside it.

     `partition` is one wall run with doorways punched through it, and
     `roomGrid` is a block of rooms built from those — so an interior can be
     described as "four rooms off a corridor, doors on the corridor side"
     rather than as twenty hand-placed rectangles. */
  const DOORWAY = 62;          // px of gap a doorway leaves (1.55m)

  function runAt(type, x, y, axis, offsetPx, lenPx, thickness) {
    return axis === 'h'
      ? seg(type, x + offsetPx, y, lenPx / PX_PER_M, 'h', thickness)
      : seg(type, x, y + offsetPx, lenPx / PX_PER_M, 'v', thickness);
  }

  /* `doors` are offsets in px along the run where a gap goes. `doorType` fills
     the gap with something openable; leave it out for an open archway. */
  function partition(type, x, y, lengthPx, axis, thickness, doors, doorType) {
    const out = [];
    const stops = (doors || []).slice().sort((a, b) => a - b);
    let cursor = 0;
    for (const d of stops) {
      const start = Math.max(0, Math.min(lengthPx - DOORWAY, d - DOORWAY / 2));
      if (start - cursor > 6) out.push(runAt(type, x, y, axis, cursor, start - cursor, thickness));
      if (doorType) out.push(runAt(doorType, x, y, axis, start, DOORWAY, 0.3));
      cursor = start + DOORWAY;
    }
    if (lengthPx - cursor > 6) out.push(runAt(type, x, y, axis, cursor, lengthPx - cursor, thickness));
    return out;
  }

  /* A block of `cols` x `rows` rooms filling (x, y, w, h). Every room gets a
     door on the side named by `access` ('n'|'s'|'w'|'e'), which is where the
     corridor runs. Returns { parts, cells } — the cells are plain rects, ready
     to be handed to `room()` with whatever kind they hold. */
  function roomGrid(type, x, y, w, h, cols, rows, opts = {}) {
    const th = opts.thickness || 0.22;
    const doorType = opts.doorType === null ? null : (opts.doorType || 'door');
    const access = opts.access || 'n';
    const cw = w / cols, ch = h / rows;
    const parts = [], cells = [];
    // the walls between columns, and between rows
    for (let c = 1; c < cols; c++) {
      const doors = access === 'n' || access === 's' ? [] : [ch / 2];
      for (let r = 0; r < rows; r++) {
        parts.push(...partition(type, x + c * cw, y + r * ch, ch, 'v', th,
          doors.map(d => d), doorType));
      }
    }
    for (let r = 1; r < rows; r++) {
      const doors = access === 'w' || access === 'e' ? [] : [cw / 2];
      for (let c = 0; c < cols; c++) {
        parts.push(...partition(type, x + c * cw, y + r * ch, cw, 'h', th,
          doors.map(d => d), doorType));
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({ x: x + c * cw + 14, y: y + r * ch + 14, w: cw - 28, h: ch - 28 });
      }
    }
    return { parts, cells };
  }
  /* turn grid cells into rooms of a kind, in order */
  const cellRooms = (cells, kinds) =>
    cells.map((c, i) => room(typeof kinds === 'string' ? kinds : kinds[i % kinds.length], c.x, c.y, c.w, c.h));

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
      // windows for light and alternate sightlines
      out.push(seg('window', ox + 60, oy + 20, 1.2, 'h', 0.15));
      out.push(seg('window', ox + 360, oy + 20, 1.2, 'h', 0.15));
      // small pantry/closet off the rear room
      out.push(seg('wood', ox + 320, oy + 220, 1.6, 'v', 0.18));
      // 1 bathroom, 2 bedrooms, 1 kitchen — the divider at +240 splits them
      out.rooms = [
        room('bedroom',  ox + 20,  oy + 20,  200, 140),
        room('bedroom',  ox + 20,  oy + 175, 200, 145),
        room('kitchen',  ox + 258, oy + 20,  142, 180),
        room('bathroom', ox + 258, oy + 215, 142, 105),
      ];
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
      // grand staircase partition (visual + cover)
      out.push(seg('barricade', ox + 360, oy + 230, 2.8, 'h', 0.3));
      // windows on all faces for mansion sightlines
      out.push(seg('window', ox + 80, oy + 12, 2.2, 'h', 0.15));
      out.push(seg('window', ox + 640, oy + 12, 2.2, 'h', 0.15));
      // reinforced strongroom in the back corner
      out.push(seg('rwall', ox + 460, oy + 330, 6.4, 'h', 0.4));
      out.push(seg('rwall', ox + 460, oy + 330, 4.6, 'v', 0.4));
      out.push(seg('rdoor', ox + 560, oy + 330, 1.5, 'h'));
      /* 4 bedrooms in the west wing, kitchen and dining east, two bathrooms
         between them, pool and garage across the back, and the gold crate
         behind the reinforced door where it takes C4 or a hammer to reach. */
      out.rooms = [
        room('bedroom',  ox + 20,  oy + 20,  120, 125),
        room('bedroom',  ox + 145, oy + 20,  120, 125),
        room('bedroom',  ox + 20,  oy + 150, 120, 130),
        room('bedroom',  ox + 145, oy + 150, 120, 130),
        room('kitchen',  ox + 300, oy + 20,  180, 130),
        room('dining',   ox + 490, oy + 20,  210, 130),
        room('bathroom', ox + 300, oy + 160, 180, 120),
        room('bathroom', ox + 490, oy + 160, 210, 120),
        room('pool',     ox + 20,  oy + 320, 220, 170),
        room('garage',   ox + 255, oy + 320, 190, 170),
        room('safe',     ox + 480, oy + 350, 215, 145),
      ];
      return out;
    },

    /* ---------- resort ----------
       The biggest residential building on the map and the densest bedroom
       count: ten rooms off one long corridor, so it fights like a hotel —
       doorway after doorway, nowhere to shoot from range. The lounge and the
       dock are what make crossing it worth the risk. */
    resort(ox, oy) {
      const w = 1040, h = 620;
      const out = shell(ox, oy, w, h, 'wood', 0.4, [
        { side: 'w', at: 260, type: 'door', len: 2 },
        { side: 's', at: 420, type: 'door', len: 2 },
        { side: 'n', at: 700, type: 'door' },
      ]);
      // spine corridor: bedrooms north of it, public rooms south
      out.push(seg('wood', ox + 16, oy + 250, 25.2, 'h', 0.3));
      for (let i = 0; i < 5; i++) out.push(seg('door', ox + 120 + i * 190, oy + 250, 1.6, 'h'));
      // bedroom partitions, five each side of the corridor
      for (let i = 1; i < 5; i++) out.push(seg('wood', ox + i * 200, oy + 16, 5.85, 'v', 0.22));
      for (let i = 1; i < 5; i++) out.push(seg('wood', ox + i * 200, oy + 400, 3.5, 'v', 0.22));
      // back kitchen behind the dining lobby
      out.push(seg('wood', ox + 760, oy + 400, 3.5, 'v', 0.3));
      out.push(seg('door', ox + 760, oy + 330, 1.6, 'v'));
      out.rooms = [
        ...roomRow('bedroom', ox + 20, oy + 20, 990, 215, 5, 'h'),
        ...roomRow('bedroom', ox + 20, oy + 405, 720, 195, 5, 'h'),
        room('lounge',      ox + 780, oy + 270, 235, 120),
        room('backKitchen', ox + 780, oy + 405, 235, 195),
        room('diningLobby', ox + 300, oy + 270, 460, 120),
        room('washroom',    ox + 20,  oy + 270, 130, 120),
        room('washroom',    ox + 160, oy + 270, 130, 120),
        room('pool',        ox + w + 60, oy + 120, 260, 200),
        room('dock',        ox + w + 60, oy + 360, 300, 150),
      ];
      return out;
    },

    /* ---------- airfield ----------
       A runway with a parked aircraft on it. The plane and the track are the
       two richest single rooms in the game — ten regular crates each — and
       both sit in the open, so it is a lot of loot with nowhere to hide. */
    airfield(ox, oy) {
      const out = [];
      // terminal
      out.push(...shell(ox, oy, 460, 300, 'metal', 0.45, [
        { side: 's', at: 200, type: 'door', len: 2 },
        { side: 'e', at: 140, type: 'door' },
      ]));
      out.push(seg('metal', ox + 240, oy + 16, 6.9, 'v', 0.3));
      out.push(seg('door', ox + 240, oy + 150, 1.6, 'v'));
      // gate arm and fence out onto the apron
      out.push(seg('barricade', ox + 520, oy + 40, 6, 'v', 0.3));
      out.push(seg('wire', ox + 520, oy + 300, 9, 'h', 0.4));
      // hangar-garage at the far end
      out.push(...shell(ox + 1180, oy + 40, 340, 280, 'metal', 0.6, [
        { side: 'w', at: 140, type: 'rdoor', len: 3 },
      ]));
      /* The aircraft: a fuselage of metal plate with wings either side. It
         has to be a genuinely roomy hull — ten crates is the richest room in
         the game and they need somewhere to sit that isn't inside a wall. */
      out.push(seg('metal', ox + 620, oy + 400, 12.5, 'h', 0.5));
      out.push(seg('metal', ox + 620, oy + 560, 12.5, 'h', 0.5));
      out.push(seg('metal', ox + 620, oy + 400, 4, 'v', 0.5));
      out.push(seg('metal', ox + 900, oy + 300, 5, 'v', 0.35));
      out.push(seg('metal', ox + 940, oy + 300, 5, 'v', 0.35));
      out.rooms = [
        room('lobby',      ox + 20,   oy + 20,  200, 260),
        room('gate',       ox + 260,  oy + 20,  180, 260),
        room('garage',     ox + 1200, oy + 60,  300, 240),
        room('plane',      ox + 650,  oy + 425, 460, 130),
        room('track',      ox + 560,  oy + 640, 900, 130),
      ];
      return out;
    },

    /* ---------- harbor ----------
       Thirty containers in a yard, and only half of them have anything in
       them — a shipped container holds a crate and one in fifteen holds gold,
       while an empty shipping container is just cover. Looting it properly
       means opening a lot of steel boxes in the open. */
    harbor(ox, oy) {
      const out = [];
      /* Every part sits at a positive offset from the origin and on land. The
         first draft hung the docks and the toilet block off negative offsets
         and out over the water, and since a building is only placed where
         every one of its segments is buildable, the harbor could never find
         anywhere on the island to stand — it simply never appeared on a map. */
      out.push(...shell(ox, oy, 340, 240, 'metal', 0.45, [{ side: 's', at: 150, type: 'door', len: 2 }]));
      out.push(...shell(ox + 400, oy, 380, 260, 'metal', 0.5, [{ side: 'w', at: 120, type: 'door', len: 2 }]));
      out.push(...shell(ox + 820, oy, 380, 260, 'metal', 0.5, [{ side: 'w', at: 120, type: 'door', len: 2 }]));
      const rooms = [
        room('lobby',     ox + 20,  oy + 20, 300, 200),
        room('warehouse', ox + 420, oy + 20, 340, 220),
        room('warehouse', ox + 840, oy + 20, 340, 220),
      ];
      /* The container yard: five columns by six rows of steel, alternating
         loaded and empty so you can't tell which is which from outside. */
      let n = 0;
      for (let cy = 0; cy < 6; cy++) {
        for (let cx = 0; cx < 5; cx++) {
          const x = ox + 40 + cx * 215, y = oy + 320 + cy * 125;
          out.push(seg('metal', x, y, 4.3, 'h', 0.45));
          out.push(seg('metal', x, y + 86, 4.3, 'h', 0.45));
          out.push(seg('metal', x, y, 2.15, 'v', 0.45));
          rooms.push(room(n % 2 ? 'shippingCrate' : 'shippedCrate', x + 24, y + 18, 130, 52));
          n++;
        }
      }
      // three quays along the seaward edge, and the crew facilities
      for (let i = 0; i < 3; i++) {
        out.push(seg('wood', ox + 1240, oy + 360 + i * 200, 5.5, 'h', 0.3));
        rooms.push(room('dock', ox + 1250, oy + 372 + i * 200, 200, 120));
      }
      out.push(...shell(ox + 1240, oy + 40, 100, 100, 'wood', 0.2, [{ side: 's', at: 50 }]));
      out.push(...shell(ox + 1370, oy + 40, 100, 100, 'wood', 0.2, [{ side: 's', at: 50 }]));
      rooms.push(room('portapotty', ox + 1254, oy + 54, 72, 72));
      rooms.push(room('portapotty', ox + 1384, oy + 54, 72, 72));
      out.rooms = rooms;
      return out;
    },

    /* ---------- camping grounds ----------
       Twenty tents in the trees. Individually each is a single crate, but
       there are twenty of them and no walls worth the name, so it is the one
       place on the map where looting is fast and completely exposed. */
    campground(ox, oy) {
      const out = [];
      const rooms = [];
      const tent = (tx, ty, size) => {
        out.push(seg('barricade', tx, ty, size / PX_PER_M, 'h', 0.25));
        out.push(seg('barricade', tx, ty + size, size / PX_PER_M, 'h', 0.25));
        out.push(seg('barricade', tx, ty, size / PX_PER_M, 'v', 0.25));
        rooms.push(room('tent', tx + 12, ty + 12, size - 24, size - 24));
      };
      for (let i = 0; i < 20; i++) {
        const col = i % 5, rw = Math.floor(i / 5);
        tent(ox + col * 175 + (rw % 2) * 40, oy + rw * 165, 110);
      }
      // lodge at the top of the site
      out.push(...shell(ox + 940, oy + 40, 380, 280, 'wood', 0.35, [
        { side: 'w', at: 140, type: 'door', len: 2 },
      ]));
      out.push(seg('wood', ox + 1130, oy + 56, 6.4, 'v', 0.25));
      out.push(seg('door', ox + 1130, oy + 180, 1.6, 'v'));
      // washroom block and the car park
      out.push(...shell(ox + 940, oy + 400, 200, 140, 'wood', 0.3, [{ side: 'n', at: 100 }]));
      out.push(seg('barricade', ox + 940, oy + 620, 10, 'h', 0.3));
      rooms.push(room('lodge',      ox + 960,  oy + 60,  340, 240));
      rooms.push(room('washroom',   ox + 955,  oy + 415, 170, 110));
      rooms.push(room('parkingLot', ox + 950,  oy + 640, 380, 190));
      out.rooms = rooms;
      return out;
    },

    /* ---------- clinic ----------
       A house-sized hospital: two treatment rooms and a dispensary. Small
       enough to be worth taking on the way past rather than crossing for. */
    clinic(ox, oy) {
      const w = 420, h = 320;
      const out = shell(ox, oy, w, h, 'wood', 0.3, [
        { side: 's', at: 200, type: 'door', len: 2 }, { side: 'w', at: 160 },
      ]);
      out.push(...partition('wood', ox + 14, oy + 180, w - 28, 'h', 0.25, [120, 300], 'door'));
      const g = roomGrid('wood', ox + 14, oy + 14, w - 28, 166, 2, 1, { access: 's' });
      out.push(...g.parts);
      out.push(seg('window', ox + 80, oy + 12, 1.4, 'h', 0.15));
      out.push(seg('window', ox + 300, oy + 12, 1.4, 'h', 0.15));
      out.rooms = [
        room('ward', g.cells[0].x, g.cells[0].y, g.cells[0].w, g.cells[0].h),
        room('surgery', g.cells[1].x, g.cells[1].y, g.cells[1].w, g.cells[1].h),
        room('dispensary', ox + 30, oy + 200, w - 60, 100),
      ];
      return out;
    },

    /* ---------- library ----------
       Long parallel stacks: every sightline is a corridor, so it fights like a
       maze of one-way corners. */
    library(ox, oy) {
      const w = 620, h = 440;
      const out = shell(ox, oy, w, h, 'wood', 0.35, [
        { side: 'n', at: 300, type: 'door', len: 2 }, { side: 'e', at: 220 },
      ]);
      // the stacks: six runs with a gap at alternating ends
      for (let i = 0; i < 6; i++) {
        const x = ox + 70 + i * 80;
        const top = i % 2 === 0;
        out.push(seg('wood', x, oy + (top ? 60 : 150), top ? 5.5 : 6.2, 'v', 0.25));
      }
      out.push(...partition('wood', ox + 14, oy + 350, w - 28, 'h', 0.28, [160, 460], 'door'));
      const back = roomGrid('wood', ox + 14, oy + 364, w - 28, h - 378, 2, 1, { access: 'n' });
      out.push(...back.parts);
      out.rooms = [
        room('office', back.cells[0].x, back.cells[0].y, back.cells[0].w, back.cells[0].h),
        room('staffRoom', back.cells[1].x, back.cells[1].y, back.cells[1].w, back.cells[1].h),
        room('classroom', ox + 90, oy + 70, 440, 260),
      ];
      return out;
    },

    /* ---------- garage ----------
       Four work bays, a jeep in one of them, and a wall of tools. */
    garage(ox, oy) {
      const w = 560, h = 380;
      const out = shell(ox, oy, w, h, 'metal', 0.45, [
        { side: 's', at: 140, type: 'rdoor', len: 3 },
        { side: 's', at: 420, type: 'rdoor', len: 3 },
      ]);
      const bays = roomGrid('metal', ox + 14, oy + 14, w - 28, h - 120, 4, 1, { access: 's', doorType: null });
      out.push(...bays.parts);
      out.push(...partition('metal', ox + 14, oy + h - 106, w - 28, 'h', 0.3, [140, 420], null));
      out.push(seg('barricade', ox + 40, oy + h - 60, 4, 'h', 0.3));
      out.rooms = [
        room('workbay', bays.cells[0].x, bays.cells[0].y, bays.cells[0].w, bays.cells[0].h),
        room('garage',  bays.cells[1].x, bays.cells[1].y, bays.cells[1].w, bays.cells[1].h),
        room('workbay', bays.cells[2].x, bays.cells[2].y, bays.cells[2].w, bays.cells[2].h),
        room('storeroom', bays.cells[3].x, bays.cells[3].y, bays.cells[3].w, bays.cells[3].h),
      ];
      return out;
    },

    /* ---------- watermill ----------
       A stone mill with a flooded undercroft. Wet floor, so it is the one
       building where a Diver keeps their footing. */
    watermill(ox, oy) {
      const w = 380, h = 420;
      const out = shell(ox, oy, w, h, 'wood', 0.4, [
        { side: 'n', at: 180, type: 'door', len: 2 }, { side: 'e', at: 300 },
      ]);
      out.push(...partition('wood', ox + 14, oy + 200, w - 28, 'h', 0.3, [110], 'door'));
      out.push(seg('rwall', ox + 250, oy + 214, 4.5, 'v', 0.4));
      // the wheel housing outside
      out.push(seg('wood', ox + w, oy + 120, 4, 'v', 0.35));
      out.push(seg('wood', ox + w, oy + 120, 2.4, 'h', 0.35));
      out.rooms = [
        room('storeroom', ox + 30, oy + 30, w - 60, 150),
        room('workbay',   ox + 30, oy + 220, 200, 170),
        room('safe',      ox + 265, oy + 230, 95, 160),
      ];
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
    /* apartments: eight flats off a central stair, two floors' worth of
       doorways on one plane */
    apartments(ox, oy) {
      const w = 820, h = 460;
      const out = shell(ox, oy, w, h, 'wood', 0.45, [
        { side: 'w', at: 210 }, { side: 'e', at: 210 }, { side: 'n', at: 400 },
      ]);
      out.push(...partition('wood', ox + 14, oy + 180, w - 28, 'h', 0.3, [110, 310, 510, 710], 'door'));
      out.push(...partition('wood', ox + 14, oy + 280, w - 28, 'h', 0.3, [110, 310, 510, 710], 'door'));
      const top = roomGrid('wood', ox + 14, oy + 14, w - 28, 166, 4, 1, { access: 's' });
      const bot = roomGrid('wood', ox + 14, oy + 294, w - 28, h - 308, 4, 1, { access: 'n' });
      out.push(...top.parts, ...bot.parts);
      // windows down both long faces
      for (const dx of [90, 300, 520, 720]) {
        out.push(seg('window', ox + dx, oy + 12, 1.6, 'h', 0.15));
        out.push(seg('window', ox + dx, oy + h - 12, 1.6, 'h', 0.15));
      }
      out.rooms = [...cellRooms(top.cells, 'apartment'), ...cellRooms(bot.cells, 'apartment')];
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
      // barn behind the yard fence, and the coop nobody thinks to check
      out.push(...shell(ox + 500, oy + 60, 320, 260, 'wood', 0.35, [{ side: 'w', at: 120, type: 'door', len: 2 }]));
      out.push(...shell(ox + 520, oy + 380, 130, 110, 'wood', 0.2, [{ side: 'n', at: 60 }]));
      out.rooms = [
        // the farmhouse is a House, so it is furnished as one rather than as
        // a single room called "house"
        room('bedroom',     ox + 20,  oy + 20,  170, 125),
        room('bedroom',     ox + 20,  oy + 155, 170, 125),
        room('kitchen',     ox + 215, oy + 20,  185, 125),
        room('bathroom',    ox + 215, oy + 155, 185, 125),
        room('wheatField',  ox - 40,  oy + 360, 360, 220),
        room('wheatField',  ox + 340, oy + 360, 340, 220),
        room('barn',        ox + 520, oy + 80,  280, 220),
        room('chickenCoop', ox + 535, oy + 395, 100, 80),
      ];
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

    /* command-center: hardened command hub with briefing room, offices, and secure core */
    'command-center'(ox, oy) {
      const w = 680, h = 520;
      const out = shell(ox, oy, w, h, 'metal', 0.5, [
        { side: 'n', at: 260, type: 'rdoor', len: 2.5 },
        { side: 'e', at: 220, type: 'door' },
      ]);
      out.push(seg('metal', ox + 180, oy + 60, 5.4, 'v', 0.35)); // office corridor
      out.push(seg('metal', ox + 180, oy + 60, 3.6, 'h', 0.35));
      out.push(seg('metal', ox + 180, oy + 220, 3.6, 'h', 0.35));
      out.push(seg('window', ox + 40, oy + 260, 2.6, 'h', 0.2));
      out.push(seg('window', ox + 420, oy + 260, 2.6, 'h', 0.2));
      out.push(seg('rwall', ox + 380, oy + 140, 4, 'h', 0.4));
      out.push(seg('rwall', ox + 380, oy + 140, 3.2, 'v', 0.4));
      out.push(seg('rdoor', ox + 430, oy + 140, 1.2, 'h'));
      const desk = seg('desk', ox + 120, oy + 100, 1.5, 'h', 0.2);
      out.push(desk);
      out.push(seg('locker', ox + 140, oy + 260, 1.8, 'h', 0.25));
      return out;
    },

    /* vault: underground-style reinforced vault with a secret inner room */
    vault(ox, oy) {
      const w = 520, h = 520;
      const out = shell(ox, oy, w, h, 'rwall', 0.6, [
        { side: 'n', at: 240, type: 'rdoor', len: 1.8 },
      ]);
      out.push(seg('window', ox + 80, oy + 120, 2.2, 'h', 0.2));
      out.push(seg('window', ox + 80, oy + 400, 2.2, 'h', 0.2));
      out.push(seg('rwall', ox + 180, oy + 160, 3.4, 'h', 0.5));
      out.push(seg('rwall', ox + 180, oy + 160, 2.8, 'v', 0.5));
      const secret = seg('door', ox + 320, oy + 210, 1.4, 'v');
      secret.secret = true;
      secret.underground = true;
      out.push(secret);
      // hidden subterranean vault chamber
      const v1 = seg('rwall', ox + 300, oy + 230, 2, 'h', 0.5); v1.underground = true; out.push(v1);
      const v2 = seg('rwall', ox + 300, oy + 270, 2, 'h', 0.5); v2.underground = true; out.push(v2);
      const v3 = seg('rwall', ox + 280, oy + 250, 1.6, 'v', 0.5); v3.underground = true; out.push(v3);
      const v4 = seg('rwall', ox + 320, oy + 250, 1.6, 'v', 0.5); v4.underground = true; out.push(v4);
      out.push(seg('desk', ox + 220, oy + 380, 2.2, 'h', 0.2));
      out.push(seg('locker', ox + 120, oy + 320, 2.2, 'h', 0.25));
      return out;
    },

    /* subway: underground transport hub with platforms, corridors, and exits */
    subway(ox, oy) {
      const w = 820, h = 360;
      const out = shell(ox, oy, w, h, 'metal', 0.45, [
        { side: 'n', at: 220 }, { side: 'n', at: 580 },
        { side: 's', at: 240 }, { side: 's', at: 620 },
      ]);
      // platform edges and rail barriers
      out.push(seg('metal', ox + 60, oy + 140, 7.2, 'h', 0.35));
      out.push(seg('metal', ox + 60, oy + 220, 7.2, 'h', 0.35));
      out.push(seg('window', ox + 260, oy + 70, 3.4, 'h', 0.2));
      out.push(seg('window', ox + 520, oy + 70, 3.4, 'h', 0.2));
      out.push(seg('desk', ox + 400, oy + 280, 2.4, 'h', 0.2));
      out.push(prop('crate', ox + 160, oy + 180, 28, 1.0));
      out.push(prop('ammoBox', ox + 620, oy + 180, 28, 1.0));
      // emergency exit corridors into the surrounding terrain
      out.push(seg('door', ox + 40, oy + 320, 1.5, 'h'));
      out.push(seg('door', ox + w - 40, oy + 320, 1.5, 'h'));
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
    /* hospital: a corridor of wards down one side, theatre and dispensary the
       other. Bandages and adrenaline live here, and so does the reason to
       stay — see BUILDING_EFFECTS. */
    hospital(ox, oy) {
      const w = 720, h = 500;
      const out = shell(ox, oy, w, h, 'wood', 0.4, [
        { side: 'n', at: 300, type: 'door', len: 3 },
        { side: 's', at: 300 }, { side: 'e', at: 300, type: 'door' },
      ]);
      // spine corridor running east-west across the middle
      out.push(...partition('wood', ox + 14, oy + 250, w - 28, 'h', 0.28,
        [140, 340, 560], 'door'));
      // four wards north of it, theatre and dispensary south
      const north = roomGrid('wood', ox + 14, oy + 14, w - 28, 236, 4, 1, { access: 's' });
      const south = roomGrid('wood', ox + 14, oy + 262, w - 28, h - 276, 3, 1, { access: 'n' });
      out.push(...north.parts, ...south.parts);
      out.rooms = [
        ...cellRooms(north.cells, 'ward'),
        room('surgery',    south.cells[0].x, south.cells[0].y, south.cells[0].w, south.cells[0].h),
        room('dispensary', south.cells[1].x, south.cells[1].y, south.cells[1].w, south.cells[1].h),
        room('lobby',      south.cells[2].x, south.cells[2].y, south.cells[2].w, south.cells[2].h),
      ];
      return out;
    },

    /* workshop: industrial metal structure, tight corridors, high loot density */
    workshop(ox, oy) {
      const w = 760, h = 520;
      const out = shell(ox, oy, w, h, 'metal', 0.5, [
        { side: 'n', at: 300, type: 'rdoor', len: 3 },
        { side: 's', at: 200, type: 'rdoor', len: 2 },
        { side: 'w', at: 240, type: 'door' },
      ]);
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
    /* prison: two blocks of cells facing a guarded corridor. Everything is
       reinforced, so getting in wants C4 or the right tool. */
    prison(ox, oy) {
      const w = 840, h = 620;
      const out = shell(ox, oy, w, h, 'rwall', 0.5, [
        { side: 'n', at: 360, type: 'rdoor', len: 2 },
        { side: 's', at: 240, type: 'rdoor' },
      ]);
      // corridor down the middle, cells either side
      out.push(...partition('rwall', ox + 14, oy + 250, w - 28, 'h', 0.4, [180, 480, 700], 'rdoor'));
      out.push(...partition('rwall', ox + 14, oy + 370, w - 28, 'h', 0.4, [180, 480, 700], 'rdoor'));
      const top = roomGrid('rwall', ox + 14, oy + 14, w - 28, 236, 5, 1, { access: 's', thickness: 0.35, doorType: 'rdoor' });
      const bot = roomGrid('rwall', ox + 14, oy + 384, w - 28, h - 398, 5, 1, { access: 'n', thickness: 0.35, doorType: 'rdoor' });
      out.push(...top.parts, ...bot.parts);
      // guard post in the corridor, and sandbags at the yard end
      out.push(seg('sandbag', ox + 380, oy + 300, 3, 'h', 0.5));
      out.push(seg('sandbag', ox + 380, oy + 300, 1.5, 'v', 0.5));
      out.rooms = [
        ...cellRooms(top.cells, 'cell'),
        ...cellRooms(bot.cells, 'cell'),
        room('guardRoom', ox + 360, oy + 268, 200, 90),
      ];
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
      // teller windows and secure counter lines
      out.push(seg('barricade', ox + 140, oy + 120, 2.2, 'h', 0.25));
      out.push(seg('window', ox + 180, oy + 110, 1.2, 'h', 0.12));
      // vault room (ultra-secure)
      out.push(seg('rwall', ox + 320, oy + 120, 4, 'h', 0.5));
      out.push(seg('rwall', ox + 320, oy + 120, 3.2, 'v', 0.5));
      const vd = seg('rdoor', ox + 360, oy + 120, 1, 'h');  // narrow vault entrance
      vd.locked = true; out.push(vd);
      // subterranean safe-room under the vault core (secret access)
      const br1 = seg('rwall', ox + 340, oy + 180, 1.8, 'h', 0.5); br1.underground = true; out.push(br1);
      const br2 = seg('rwall', ox + 340, oy + 220, 1.8, 'h', 0.5); br2.underground = true; out.push(br2);
      const br3 = seg('rwall', ox + 320, oy + 200, 1.6, 'v', 0.5); br3.underground = true; out.push(br3);
      const br4 = seg('rwall', ox + 360, oy + 200, 1.6, 'v', 0.5); br4.underground = true; out.push(br4);
      const sdoor = seg('door', ox + 340, oy + 200, 1, 'h'); sdoor.secret = true; sdoor.underground = true; out.push(sdoor);
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
    /* school: classrooms off a central corridor, a hall at one end */
    school(ox, oy) {
      const w = 760, h = 560;
      const out = shell(ox, oy, w, h, 'wood', 0.4, [
        { side: 'n', at: 300, type: 'door', len: 2 },
        { side: 's', at: 380 }, { side: 'w', at: 280, type: 'door' },
      ]);
      // the corridor, with a way through at each end and in the middle
      out.push(...partition('wood', ox + 14, oy + 230, w - 28, 'h', 0.3, [120, 380, 640], 'door'));
      out.push(...partition('wood', ox + 14, oy + 330, w - 28, 'h', 0.3, [200, 560], 'door'));
      const top = roomGrid('wood', ox + 14, oy + 14, w - 28, 216, 4, 1, { access: 's' });
      const bot = roomGrid('wood', ox + 14, oy + 344, w - 28, h - 358, 3, 1, { access: 'n' });
      out.push(...top.parts, ...bot.parts);
      // lockers line the corridor
      out.push(seg('barricade', ox + 60, oy + 280, 4, 'h', 0.25));
      out.push(seg('barricade', ox + 480, oy + 280, 4, 'h', 0.25));
      out.rooms = [
        ...cellRooms(top.cells, 'classroom'),
        room('gym',       bot.cells[0].x, bot.cells[0].y, bot.cells[0].w, bot.cells[0].h),
        room('classroom', bot.cells[1].x, bot.cells[1].y, bot.cells[1].w, bot.cells[1].h),
        room('staffRoom', bot.cells[2].x, bot.cells[2].y, bot.cells[2].w, bot.cells[2].h),
      ];
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
      /* The display hallway is the prize — a gold crate down the long east
         wing — and the main exhibit is deliberately empty, so the room that
         looks most important is the one you shouldn't linger in. */
      out.rooms = [
        room('lobby',       ox + 20,  oy + 20,  150, 260),
        room('mainExhibit', ox + 195, oy + 20,  175, 260),
        room('gunExhibit',  ox + 395, oy + 20,  170, 260),
        room('displayHall', ox + 595, oy + 20,  105, 500),
        room('washroom',    ox + 20,  oy + 320, 260, 235),
        room('washroom',    ox + 300, oy + 320, 265, 235),
      ];
      return out;
    },

    /* barracks: military dormitory, many small rooms, high-loot density */
    /* barracks: six bunk rooms off a central corridor, and the armoury at the
       end behind a reinforced door */
    barracks(ox, oy) {
      const w = 760, h = 520;
      const out = shell(ox, oy, w, h, 'metal', 0.45, [
        { side: 'w', at: 260, type: 'door' }, { side: 'e', at: 260, type: 'door' },
        { side: 'n', at: 380 },
      ]);
      out.push(...partition('metal', ox + 14, oy + 210, w - 200, 'h', 0.3, [110, 330, 490], 'door'));
      out.push(...partition('metal', ox + 14, oy + 310, w - 200, 'h', 0.3, [110, 330, 490], 'door'));
      const top = roomGrid('metal', ox + 14, oy + 14, w - 200, 196, 3, 1, { access: 's' });
      const bot = roomGrid('metal', ox + 14, oy + 324, w - 200, h - 338, 3, 1, { access: 'n' });
      out.push(...top.parts, ...bot.parts);
      // the armoury, walled off down the east end
      out.push(...partition('rwall', ox + w - 186, oy + 14, h - 28, 'v', 0.4, [h / 2], 'rdoor'));
      out.rooms = [
        ...cellRooms(top.cells, 'bunkroom'),
        ...cellRooms(bot.cells, 'bunkroom'),
        room('armoury', ox + w - 170, oy + 30, 150, h - 60),
      ];
      return out;
    },

    /* armory: weapons cache, heavily reinforced, sparse interior */
    armory(ox, oy) {
      const w = 480, h = 360;
      const out = shell(ox, oy, w, h, 'rwall', 0.55, [
        { side: 's', at: 150, type: 'rdoor', len: 1.5 },
      ]);
      // weapon racks (metal storage) and firing ports
      out.push(seg('metal', ox + 100, oy + 80, 1.8, 'h', 0.4));
      out.push(seg('metal', ox + 220, oy + 100, 1.8, 'h', 0.4));
      out.push(seg('metal', ox + 340, oy + 110, 1.8, 'h', 0.4));
      out.push(seg('window', ox + 60, oy + 40, 1.2, 'h', 0.12));
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

  /* ============================================================
     HOW EACH BUILDING LOOKS

     Every roof on the map used to be the same brown lid and every floor a
     muted brown-grey, so from above a church, a hangar and a farmhouse were
     three identically-coloured rectangles. You could not tell what you were
     about to walk into, which matters when one of them has a gold crate and
     one of them is empty.

     Each building gets a palette instead:
       floor    the ground you stand on inside
       roof     [top-left, bottom-right] of the roof gradient
       trim     the border around roof and floor — the building's accent
       pattern  how the floor is ruled: see drawFloors() in game.js
                  planks   floorboards, for anywhere domestic
                  tile     a grid, for institutional and clinical rooms
                  concrete slab joints, wide and sparse
                  metal    corrugated sheeting
                  dirt     no ruling at all, just speckle
     ============================================================ */
  const S_RESIDENTIAL = { pattern: 'planks' };
  const S_INDUSTRIAL = { pattern: 'metal' };
  const S_INSTITUTIONAL = { pattern: 'tile' };
  const S_MILITARY = { pattern: 'concrete' };

  const STYLE = {
    /* ---- residential: warm timber, terracotta and slate ---- */
    house:       { ...S_RESIDENTIAL, floor: '#7d6349', roof: ['#a4553c', '#7c3d2b'], trim: '#5a3526' },
    mansion:     { ...S_RESIDENTIAL, floor: '#8a6f4e', roof: ['#8a6aa8', '#5f4779'], trim: '#4a3560' },
    resort:      { ...S_RESIDENTIAL, floor: '#94795a', roof: ['#43a9a0', '#2b7570'], trim: '#215c58' },
    shanty:      { ...S_RESIDENTIAL, floor: '#6b5a45', roof: ['#8a7f6a', '#5f5747'], trim: '#48412f' },
    apartments:  { ...S_RESIDENTIAL, floor: '#75655a', roof: ['#9a6a52', '#6d4838'], trim: '#4d3327' },
    camp:        { ...S_RESIDENTIAL, floor: '#5f6a46', roof: ['#6f8a4e', '#4c6236'], trim: '#3a4d29', pattern: 'dirt' },
    campground:  { ...S_RESIDENTIAL, floor: '#5c6a45', roof: ['#78955a', '#51703c'], trim: '#3d5630', pattern: 'dirt' },
    farm:        { ...S_RESIDENTIAL, floor: '#7a6440', roof: ['#b4503f', '#82342a'], trim: '#5c261e' },

    /* ---- industrial: steel, rust and corrugate ---- */
    warehouse:   { ...S_INDUSTRIAL, floor: '#5a6270', roof: ['#6e7a8c', '#4c5567'], trim: '#39404e' },
    factory:     { ...S_INDUSTRIAL, floor: '#4e5666', roof: ['#5d6a7d', '#3f4859'], trim: '#2d3442' },
    workshop:    { ...S_INDUSTRIAL, floor: '#565f6b', roof: ['#7a6a52', '#55483a'], trim: '#3c332a' },
    dock:        { ...S_INDUSTRIAL, floor: '#5d6154', roof: ['#4e7d92', '#345665'], trim: '#26424e' },
    harbor:      { ...S_INDUSTRIAL, floor: '#525c68', roof: ['#3f7a90', '#2a5364'], trim: '#1f3f4c' },
    'power-plant': { ...S_INDUSTRIAL, floor: '#4a5260', roof: ['#8a8a52', '#5f5f38'], trim: '#45452a' },
    silos:       { ...S_INDUSTRIAL, floor: '#6a6250', roof: ['#c2a45c', '#8a7442'], trim: '#5f5030' },
    depot:       { ...S_INDUSTRIAL, floor: '#5a5b52', roof: ['#6f7358', '#4d503c'], trim: '#383a2b' },
    hangar:      { ...S_INDUSTRIAL, floor: '#4f5866', roof: ['#8592a4', '#5c667a'], trim: '#414b5c' },
    airfield:    { ...S_INDUSTRIAL, floor: '#4f5560', roof: ['#7d8794', '#565f6c'], trim: '#3c434e' },
    mine:        { ...S_INDUSTRIAL, floor: '#5d5852', roof: ['#5a4c40', '#3d332b'], trim: '#2c251f', pattern: 'dirt' },

    /* ---- institutional: pale stone, and an accent you can name ---- */
    hospital:    { ...S_INSTITUTIONAL, floor: '#c8d4d2', roof: ['#e8f0ee', '#b9c9c6'], trim: '#d1443f' },
    school:      { ...S_INSTITUTIONAL, floor: '#9d8f74', roof: ['#b06a3e', '#7f4629'], trim: '#5f3320' },
    church:      { ...S_INSTITUTIONAL, floor: '#a2937c', roof: ['#5a6ea8', '#3c4a76'], trim: '#caa04a' },
    museum:      { ...S_INSTITUTIONAL, floor: '#b3ada0', roof: ['#a8a29a', '#7c766d'], trim: '#c9a54e' },
    prison:      { ...S_INSTITUTIONAL, floor: '#767c84', roof: ['#5f666f', '#42474e'], trim: '#2f3339' },
    bank:        { ...S_INSTITUTIONAL, floor: '#a89b7e', roof: ['#4f6656', '#33463a'], trim: '#c9b25a' },
    vault:       { ...S_INSTITUTIONAL, floor: '#6e737f', roof: ['#575d6a', '#3b4049'], trim: '#c9b25a' },
    'command-center': { ...S_INSTITUTIONAL, floor: '#4c5164', roof: ['#4a5570', '#333c52'], trim: '#4a8fd0' },
    'train-station': { ...S_INSTITUTIONAL, floor: '#6e6a5e', roof: ['#7d6a4e', '#564733'], trim: '#3e3323' },
    subway:      { ...S_INSTITUTIONAL, floor: '#484f5c', roof: ['#3d4450', '#2a2f38'], trim: '#4a8fd0' },

    /* ---- military: olive, khaki and sandbag ---- */
    base:        { ...S_MILITARY, floor: '#575e4a', roof: ['#6b7350', '#4a5138'], trim: '#363b26' },
    fortress:    { ...S_MILITARY, floor: '#545d66', roof: ['#5d6656', '#3f473b'], trim: '#2c3228' },
    barracks:    { ...S_MILITARY, floor: '#5a5f4c', roof: ['#727a56', '#50573b'], trim: '#3a3f28' },
    armory:      { ...S_MILITARY, floor: '#4f5348', roof: ['#5c5f45', '#3e412e'], trim: '#c07a2a' },
    bunker:      { ...S_MILITARY, floor: '#4f5450', roof: ['#4a4f4a', '#333733'], trim: '#252825' },
    keep:        { ...S_MILITARY, floor: '#565b6b', roof: ['#6a6f7e', '#494e5b'], trim: '#333741' },
    checkpoint:  { ...S_MILITARY, floor: '#5c5c4c', roof: ['#6e6e52', '#4c4c38'], trim: '#c07a2a' },
    tower:       { ...S_MILITARY, floor: '#5a5a52', roof: ['#66665a', '#46463e'], trim: '#30302a' },
    'bridge-fort': { ...S_MILITARY, floor: '#5f5a52', roof: ['#6a6255', '#48423a'], trim: '#332f29' },

    clinic:      { ...S_INSTITUTIONAL, floor: '#c4d0cd', roof: ['#dfeae7', '#b0c0bd'], trim: '#d1443f' },
    library:     { ...S_INSTITUTIONAL, floor: '#9c8a6d', roof: ['#6a5a8a', '#463a5f'], trim: '#c9a54e' },
    garage:      { ...S_INDUSTRIAL, floor: '#4f545c', roof: ['#6a7078', '#474c53'], trim: '#c07a2a' },
    watermill:   { ...S_RESIDENTIAL, floor: '#6f6350', roof: ['#5a7a6a', '#3c5548'], trim: '#2e4238' },

    /* ---- commercial and one-offs ---- */
    market:      { floor: '#8a7a5c', roof: ['#d06a4a', '#9c4630'], trim: '#7a3122', pattern: 'tile' },
    'gas-station': { floor: '#5a5646', roof: ['#d8412f', '#9c2b1e'], trim: '#f0d24a', pattern: 'concrete' },
    'radio-tower': { floor: '#4c5058', roof: ['#7a4a4a', '#553232'], trim: '#e8483c', pattern: 'metal' },
    arena:       { floor: '#5a5f6b', roof: ['#8a5a8a', '#5c3a5c'], trim: '#d0a04a', pattern: 'concrete' },
  };
  const DEFAULT_STYLE = { floor: '#5f5f5f', roof: ['#6a5442', '#54402f'], trim: '#1e140c', pattern: 'planks' };
  const styleOf = (name) => STYLE[name] || DEFAULT_STYLE;

  /* ============================================================
     WHAT A BUILDING DOES FOR YOU

     Buildings were places with loot in them and nothing else, so once a room
     was cleared there was no reason to be there — you looted and left, and
     every building played the same way. These give a handful of them a reason
     to hold: somewhere to heal, somewhere to resupply, somewhere that shows
     you where everyone is.

     Deliberately not on all forty-two. A perk on every building is a perk on
     none; these are the landmarks worth crossing the map for, and everything
     else is still just cover and crates.

       heal      HP per second while inside
       adren     adrenaline per second
       resupply  seconds between magazine top-ups
       reveal    radius in px that enemies show on your minimap
       damage    multiplier on damage you take inside
       toolRate  multiplier on tool cooldowns
       speed     multiplier on your movement inside
     ============================================================ */
  const BUILDING_EFFECTS = {
    hospital:    { heal: 2.5, label: 'Field hospital — you are being treated' },
    clinic:      { heal: 1.5, label: 'Clinic — patching you up' },
    garage:      { toolRate: 0.6, label: 'Garage — the right tools for the job' },
    church:      { adren: 3, label: 'Sanctuary — adrenaline returning' },
    armory:      { resupply: 3, label: 'Armoury — magazines topping up' },
    barracks:    { resupply: 5, label: 'Barracks — resupplying' },
    'radio-tower': { reveal: 1500, label: 'Radio tower — contacts on your map' },
    'command-center': { reveal: 2200, label: 'Command centre — full sweep on your map' },
    bunker:      { damage: 0.75, label: 'Bunker — hardened against fire' },
    vault:       { damage: 0.7, label: 'Vault — nothing much gets in here' },
    workshop:    { toolRate: 0.5, label: 'Workshop — tools working twice as fast' },
    subway:      { speed: 1.15, label: 'Tunnels — quicker going underground' },
    mine:        { speed: 1.1, toolRate: 0.7, label: 'Mineshaft — room to swing' },
  };
  const effectOf = (name) => BUILDING_EFFECTS[name] || null;

  const BUILDING_DESCRIPTIONS = {
    house: 'Two-room wooden house with front and back doors. Good for quick loot and tight fights.',
    mansion: 'Large multi-wing estate with a reinforced strongroom. Great for multi-angle engagement.',
    base: 'Metal military base with wire and sandbags. Ricochets favor careful ranged play.',
    warehouse: 'Wide metal hall with staggered racks and low cover. Avoid spraying down its long axis.',
    bunker: 'Small reinforced bunker with firing step and wire apron. Doors are the real weak point.',
    tower: 'Tiny reinforced watchtower with external sandbags. Simple to hold and hard to clear.',
    shanty: 'Cluster of flimsy wooden huts. Low toughness encourages breaching and fast entry.',
    depot: 'Fuel depot with metal tanks and sandbag revetments. Open layout with low cover.',
    apartments: 'Dense residential block with central corridor. Close-quarters fights dominate here.',
    hangar: 'Massive open metal shed with blast doors. Approach paths matter more than inside cover.',
    farm: 'Wooden barn and fenced yard. Breachers and melee can make this easy to assault.',
    checkpoint: 'Sandbag chicane with a reinforced post. Controls a lane and breaks up open ground.',
    camp: 'Low tent cluster with sandbag support. Soft cover with plenty of flanking routes.',
    hospital: 'Medical complex with low walls and corridor flow. Healing loot and mobile combat.',
    factory: 'Industrial metal structure with tight corridors and reinforced control room.',
    dock: 'Waterfront warehouse with container cover. Wide exterior and enclosed warehouse interior.',
    fortress: 'Multi-layer reinforced strongpoint with sandbag perimeter. Hard to assault directly.',
    'radio-tower': 'Small fortified tower with wire perimeter. Isolated loot and strong sightlines.',
    prison: 'High-security cell block with reinforced walls. Long corridors and multiple breach points.',
    bank: 'Ultra-secure vault with minimal access and a hidden subterranean safe room beneath.',
    market: 'Open trading hall with many stalls. Multiple entrances create high-risk play.',
    school: 'Classrooms, gym, and cafeteria with open wings. Good for medium-range skirmishes.',
    church: 'Tall sanctuary with pew-line cover. Long sightlines through an open nave.',
    museum: 'Gallery halls and display cases. High-value loot with deliberate sightline funnels.',
    barracks: 'Military dormitory with many rooms and a reinforced corner armory.',
    armory: 'Heavily fortified weapons cache with sparse interior cover.',
    arena: 'Open ring with spectator barrier cover. Designed for wide engagements around a central pit.',
    'bridge-fort': 'Linear fortified bridge with sandbag strongpoints. Forces a narrow, intense fight.',
    'train-station': 'Platform terminal with multiple entrances and long horizontal sightlines.',
    'power-plant': 'Large industrial complex with turbine halls and a reinforced control room.',
    'gas-station': 'Compact convenience store and pump islands. Explosive hazard with quick loot.',
    mine: 'Underground quarry with tight passages and vertical shafts. Mixed cover and choke points.',
    workshop: 'Industrial workshop with metal racks and a reinforced control corner.',
    'command-center': 'Hardened command hub with briefing room, offices, and secure communications.',
    vault: 'Reinforced vault with a secret inner room and a heavy inner door.',
    subway: 'Underground transit hub with platforms, corridors, and emergency exits.',
  };

  /* ---------- how many of each the map must have ----------
     The design table gives exact counts, not weights: a map has five houses
     and exactly one mansion, whatever the dice say. Everything outside this
     list is still rolled procedurally to fill the space around them. */
  const ROOM_BUILDINGS = [
    ['house', 5], ['mansion', 1], ['resort', 1], ['airfield', 1],
    ['harbor', 1], ['museum', 1], ['campground', 2], ['farm', 2],
  ];

  const BUILDING_CATEGORIES = {
    tactical: ['tower', 'checkpoint', 'bunker', 'bridge-fort', 'keep'],
    residential: ['house', 'mansion', 'shanty', 'apartments', 'camp', 'campground', 'farm', 'resort'],
    industrial: ['warehouse', 'factory', 'workshop', 'dock', 'harbor', 'power-plant', 'silos', 'depot', 'hangar', 'airfield', 'garage', 'watermill'],
    institutional: ['hospital', 'clinic', 'library', 'school', 'church', 'museum', 'prison', 'bank', 'vault', 'command-center'],
    commercial: ['market', 'gas-station', 'train-station'],
    military: ['base', 'fortress', 'barracks', 'armory'],
    unique: ['radio-tower', 'arena', 'mine', 'subway'],
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
    WALL_TYPES, PROP_TYPES, BUILDINGS, BUILDING_DESCRIPTIONS, BUILDING_CATEGORIES, scatter, prop, PX_PER_M, HP_SCALE,
    STYLE, styleOf, BUILDING_EFFECTS, effectOf,
    ROOM_LOOT, ROOM_BUILDINGS, room,
    def, maxHp, toughness, ballistics, blocksSight, blocksMove, isDoor, seg, shell,
    /* place a named building and tag every piece with it. `rooms` rides along
       on the returned array — blueprints that don't declare any simply don't
       have the property, so every older blueprint is untouched. */
    place(name, ox, oy) {
      const parts = BUILDINGS[name](ox, oy);
      parts.forEach(p => { p.building = name; });
      if (parts.rooms) parts.rooms.forEach(r => { r.building = name; });
      return parts;
    },
  };
})();
