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
    /* A vehicle-width roller door. Wide enough to drive a jeep through, which
       is what makes a garage a garage rather than a room with a car in it —
       and wide enough that it is a real opening in a wall, so a garage reads
       as a way into the building and not just a place to loot. */
    'garage-door': {
      name: 'Garage Door', height: 'high', tableHp: 60, toughness: 2, door: true,
      bullets: 'pen', lossPerM: 1.6, defThickness: 0.4, defLength: 5,
      fill: '#8a939c', stroke: 'rgba(225,238,250,0.9)',
      effect: 'Opens and closes · wide enough for a vehicle',
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
      bullets: 'through',        // A stack of tyres is waist high and does not move.

      fill: '#2d2d2d', stroke: '#0f0f0f',
      effect: 'Light cover with visibility gaps.',
    },
    rubble: {
      name: 'Rubble', height: 'low', hp: 45, toughness: 1, prop: 'rubble',
      bullets: 'through',        // A heap of masonry is something you climb over, not through.

      fill: '#8f8f8f', stroke: '#5d5d5d',
      effect: 'Debris that slows movement and blocks little.',
    },
    container: {
      name: 'Container', height: 'high', hp: 500, toughness: 4, prop: 'container',
      bullets: 'reflect',
      fill: '#2d5a8a', stroke: '#1a3f5a',
      effect: 'Steel box: bullets ricochet off it',
    },
    post: {
      name: 'Support Post', height: 'high', hp: 240, toughness: 4, prop: 'post',
      bullets: 'stop', round: true,
      fill: '#9ca5b5', stroke: '#3f4652',
      effect: 'Concrete column — hard cover, and it blocks sight',
    },
    pillar: {
      name: 'Timber Pillar', height: 'high', hp: 150, toughness: 2, prop: 'pillar',
      bullets: 'stop',
      fill: '#6b5231', stroke: '#3a2c1c',
      effect: 'Roof support — cover you can get behind, or cut down',
    },
    chair: {
      name: 'Chair', height: 'low', hp: 25, toughness: 1, prop: 'chair',
      bullets: 'through', passable: true,
      fill: '#9a7542', stroke: '#4a3722',
      effect: 'Furniture — you walk straight over it',
    },
    plant: {
      name: 'Potted Plant', height: 'low', hp: 30, toughness: 1, prop: 'plant',
      bullets: 'through', passable: true, conceals: true, round: true,
      fill: 'rgba(90,185,71,0.45)', stroke: 'rgba(45,122,26,0.7)',
      effect: 'Hides anyone standing still behind it',
    },
    lamp: {
      name: 'Lamp', height: 'low', hp: 20, toughness: 1, prop: 'lamp',
      bullets: 'through', passable: true, lights: 190,
      fill: '#ffdf9a', stroke: '#c9a24a',
      effect: 'Lights the room — shoot it out to darken it',
    },
    striplight: {
      name: 'Strip Light', height: 'low', hp: 15, toughness: 1, prop: 'striplight',
      bullets: 'through', passable: true, lights: 150,
      fill: '#fff3d2', stroke: '#b9a36a',
      effect: 'Lights a corridor — and goes out when shot',
    },
    palm: {
      name: 'Palm', height: 'high', hp: 140, toughness: 2, prop: 'palm',
      bullets: 'stop', round: true,
      fill: '#5ab947', stroke: '#2d7a1a',
      effect: 'Blocks sight and gunfire until it comes down',
    },
    tent: {
      name: 'Tent', height: 'low', hp: 45, toughness: 1, prop: 'tent',
      bullets: 'through', passable: true, conceals: true,
      fill: 'rgba(90,113,144,0.55)', stroke: 'rgba(47,64,82,0.85)',
      effect: 'Canvas — hides you, stops nothing',
    },
    antenna: {
      name: 'Antenna Mast', height: 'low', hp: 90, toughness: 3, prop: 'antenna',
      bullets: 'stop', round: true,
      fill: '#8ea0c9', stroke: '#4a5568',
      effect: 'A steel mast — thin, but solid',
    },
    sign: {
      name: 'Sign', height: 'low', hp: 30, toughness: 1, prop: 'sign',
      bullets: 'through', passable: true,
      fill: '#b9a36a', stroke: '#6b5a33',
      effect: 'Tells you where you are and nothing else',
    },
    stump: {
      name: 'Tree Stump', height: 'low', hp: 120, toughness: 2, prop: 'stump',
      bullets: 'stop', round: true,
      fill: '#6b5433', stroke: '#43331f',
      effect: 'What is left of a tree — still stops a round',
    },
    cone: {
      name: 'Traffic Cone', height: 'low', hp: 20, toughness: 1, prop: 'cone',
      bullets: 'through', passable: true,
      fill: '#e8642a', stroke: '#a8401a',
      effect: 'Marks the spot and nothing else',
    },
    sandpile: {
      name: 'Sand Pile', height: 'low', hp: 200, toughness: 4, prop: 'sandpile',
      bullets: 'stop', round: true,
      fill: '#c2a45c', stroke: '#8a7442',
      effect: 'Soaks up whatever you put into it',
    },
    bush: {
      name: 'Bush', height: 'low', hp: 40, toughness: 1, prop: 'bush',
      bullets: 'through', passable: true, conceals: true, round: true,
      fill: 'rgba(90,185,71,0.40)', stroke: 'rgba(45,122,26,0.70)',
      effect: 'Hides anyone standing still inside it',
    },
  };
  /* wall types that are really world props, drawn with a sprite */
  const PROP_TYPES = ['crate', 'barrel', 'tree', 'rock', 'container', 'bush', 'desk', 'locker', 'ammoBox', 'pallet', 'tyre', 'rubble', 'stump', 'cone', 'sandpile', 'chair', 'plant', 'lamp', 'striplight', 'palm', 'tent', 'antenna', 'sign', 'post', 'pillar'];

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
    const sc = scale || 1;
    const half = (size || 34) * sc / 2;
    /* A container is 2.44m by 6.06m and a bed is 1m by 2m. Boxing everything
       as a square made the long things square, so a container was a cube you
       could walk round in one step and a bed took the floor of a wardrobe.
       Sprites.PROP_BOX carries the footprint for the ones that have a shape. */
    const box = (typeof Sprites !== 'undefined' && Sprites.PROP_BOX) ? Sprites.PROP_BOX[type] : null;
    const hw = box ? box.w * sc / 2 : half;
    const hh = box ? box.h * sc / 2 : half;
    const s = { x: x - hw, y: y - hh, w: hw * 2, h: hh * 2 };
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
    safe:           { name: 'Safe',            crates: [['chest', 1]] },
    tunnel:         { name: 'Tunnel',          crates: [['regular', 2], ['silver', 1]] },
    passage:        { name: 'Service Passage', crates: [['regular', 1]] },
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
    hall:           { name: 'Hallway',         crates: [] },

    /* Rooms with a job, rather than a generic box. Each one is somewhere you
       recognise on sight: a foyer is the wide open bit inside the front door,
       an ops room is a map table ringed by chairs, a mess is long tables. */
    living:         { name: 'Living Room',     crates: [['regular', 2]] },
    foyer:          { name: 'Foyer',           crates: [['regular', 1]] },
    study:          { name: 'Study',           crates: [['silver', 1]] },
    pantry:         { name: 'Pantry',          crates: [['regular', 2]] },
    opsRoom:        { name: 'Operations Room', crates: [['silver', 1]] },
    briefing:       { name: 'Briefing Room',   crates: [['regular', 2]] },
    mess:           { name: 'Mess Hall',       crates: [['regular', 3]] },
    radioRoom:      { name: 'Radio Room',      crates: [['silver', 1]] },
    motorPool:      { name: 'Motor Pool',      crates: [['regular', 2]] },
    watchPost:      { name: 'Watch Post',      crates: [['regular', 1]] },

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
    armoury:        { name: 'Armoury',         crates: [['chest', 1], ['regular', 1]] },
    cell:           { name: 'Cell',            crates: [['regular', 1]] },
    guardRoom:      { name: 'Guard Room',      crates: [['silver', 1]] },
    apartment:      { name: 'Apartment',       crates: [['regular', 2]] },
    stall:          { name: 'Market Stall',    crates: [['regular', 2]] },
    office:         { name: 'Office',          crates: [['regular', 1]] },
    strongroom:     { name: 'Strongroom',      crates: [['chest', 1]] },
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

  /* ---------- how thick a wall is ----------
     Real construction has a clear hierarchy and the blueprints did not: they
     picked a thickness per wall by eye, so an internal partition in one
     building was heavier than another building's external wall and nothing
     you could see told you which walls held the place up.

     The standards are: a stud partition finishes about 120mm, a load-bearing
     internal wall about 170mm, and an external masonry wall 300mm or more.
     Those ratios are what is reproduced here, not the absolute numbers — a
     120mm partition is 4.8px at this scale, and the movement code resolves a
     collision by pushing you back out of the wall you stepped into, which
     needs the wall to be thicker than one step. Eight pixels is the floor, so
     partitions sit on it and everything else scales up from there in the same
     proportion as the real thing. */
  const WALL_T = {
    partition: 0.20,      // 8px — the thinnest wall the physics can hold
    interior: 0.26,       // load-bearing internal
    exterior: 0.36,       // external envelope
    fortified: 0.5,       // concrete: bunkers, vaults, cell blocks
  };

  function runAt(type, x, y, axis, offsetPx, lenPx, thickness) {
    return axis === 'h'
      ? seg(type, x + offsetPx, y, lenPx / PX_PER_M, 'h', thickness)
      : seg(type, x, y + offsetPx, lenPx / PX_PER_M, 'v', thickness);
  }

  /* `doors` are offsets in px along the run where a gap goes. `doorType` fills
     the gap with something openable; leave it out for an open archway. */
  /* A door may be given as a bare offset, or as { at, type } when that one
     opening wants to be something other than the run's default — a strongroom
     off an ordinary corridor should be behind a reinforced door, not the same
     plywood one as the broom cupboard. */
  function partition(type, x, y, lengthPx, axis, thickness, doors, doorType) {
    const out = [];
    const stops = (doors || [])
      .map(d => (typeof d === 'number' ? { at: d, type: doorType }
        : { at: d.at, type: d.type === undefined ? doorType : d.type }))
      .sort((a, b) => a.at - b.at);
    let cursor = 0;
    for (const d of stops) {
      const start = Math.max(0, Math.min(lengthPx - DOORWAY, d.at - DOORWAY / 2));
      if (start - cursor > 6) out.push(runAt(type, x, y, axis, cursor, start - cursor, thickness));
      if (d.type) out.push(runAt(d.type, x, y, axis, start, DOORWAY, 0.3));
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
  /* ---------- how big a room ought to be ----------
     Real floor plans size a room by what happens in it, and the numbers are
     well established: a bedroom is about 3.0 x 3.6m, a living room 5.4 x 7.2m,
     a bathroom can be as little as 1.5 x 2.0m, a two-car garage is 6 x 6m, and
     a corridor only has to be wide enough to walk down. Dividing a footprint
     into equal cells — which is what roomGrid does — gives a bathroom the same
     floor as a ballroom, and the result reads as a spreadsheet rather than a
     building.

     Sizes are in metres, [short, long]. PX_PER_M converts. They are treated as
     proportions rather than absolutes: a plan scales them to fill the space it
     actually has, so the relative sense of a room — that a pantry is small and
     a hall is big — survives whatever footprint it ends up in. */
  const ROOM_SIZE = {
    bathroom: [1.5, 2.0], washroom: [2.4, 4.0], pantry: [1.6, 2.4],
    bedroom: [3.0, 3.6], bunkroom: [3.4, 5.0], apartment: [3.6, 5.4],
    kitchen: [3.0, 4.0], backKitchen: [3.6, 5.0], dining: [3.6, 4.8],
    living: [5.4, 7.2], lounge: [4.5, 6.0], foyer: [2.4, 3.6],
    lobby: [4.8, 7.2], diningLobby: [5.4, 8.0], hall: [1.6, 12.0],
    study: [3.0, 3.6], office: [3.0, 3.6], staffRoom: [3.6, 4.5],
    classroom: [5.4, 7.2], ward: [3.6, 6.0], surgery: [4.0, 5.0],
    dispensary: [2.4, 3.6], cell: [2.0, 2.6], guardRoom: [3.0, 4.0],
    armoury: [3.6, 5.0], opsRoom: [4.5, 6.0], briefing: [5.0, 7.0],
    mess: [5.4, 8.0], radioRoom: [3.0, 3.6], motorPool: [6.0, 9.0],
    watchPost: [2.4, 3.0], controlRoom: [3.6, 4.5], storeroom: [3.0, 4.5],
    workbay: [4.5, 6.0], garage: [6.0, 6.0], gym: [5.4, 8.0],
    safe: [2.4, 2.4], strongroom: [3.0, 3.6], stall: [2.4, 3.0],
    displayHall: [5.4, 9.0], gunExhibit: [4.0, 6.0], mainExhibit: [6.0, 10.0],
    lodge: [4.0, 5.4], barn: [6.0, 9.0], tent: [2.4, 2.4], plane: [4.0, 12.0],
  };
  const DEFAULT_ROOM = [3.6, 4.5];
  /* A room narrower than this is a cupboard. It is also the floor under every
     room's size, so it has to stay below the smallest room that legitimately
     exists: at 74 a 1.5m bathroom was being clamped up to the size of a
     kitchen, which inverted the one size relationship anybody would notice. */
  const MIN_ROOM = 62;

  /* ---------- public, service, private ----------
     Buildings are zoned before they are dimensioned: the public rooms sit by
     the way in, the private ones are kept away from it, and the service
     spaces fill in between. It is the first thing a plan decides and it was
     the one thing these plans did not do — a bank's vault was as likely to be
     inside the front door as the lobby was, and a resort's bedrooms were laid
     out in whatever order the list happened to be written in.

     Lower number = closer to the entrance. */
  const ZONE = {
    lobby: 0, foyer: 0, diningLobby: 0, hall: 0, stall: 0, market: 0,
    reception: 0, washroom: 1, lounge: 1, living: 1, dining: 1, classroom: 1,
    mainExhibit: 1, displayHall: 1, gunExhibit: 1, gym: 1, mess: 1, plane: 1,
    kitchen: 2, backKitchen: 2, pantry: 2, office: 2, staffRoom: 2, workbay: 2,
    garage: 2, motorPool: 2, storeroom: 2, dispensary: 2, guardRoom: 2,
    briefing: 2, opsRoom: 2, lodge: 2, barn: 2,
    bedroom: 3, apartment: 3, bunkroom: 3, ward: 3, study: 3, bathroom: 3,
    surgery: 3, radioRoom: 3, controlRoom: 3, cell: 3,
    armoury: 4, strongroom: 4, safe: 4,
  };
  const zoneOf = (kind) => (ZONE[kind] === undefined ? 2 : ZONE[kind]);

  /* Rooms whose door is part of what the room is. A strongroom behind a
     plywood door isn't a strongroom, and a cell you can kick open isn't a
     cell — so these get a reinforced one wherever they are laid out. */
  const SECURE_DOOR = {
    safe: 'rdoor', strongroom: 'rdoor', armoury: 'rdoor', cell: 'rdoor',
    controlRoom: 'rdoor', radioRoom: 'rdoor',
  };

  /* the extent this room wants along a strip `depth` px deep */
  function roomExtent(kind, depth) {
    const s = ROOM_SIZE[kind] || DEFAULT_ROOM;
    const short = Math.min(s[0], s[1]) * PX_PER_M, long = Math.max(s[0], s[1]) * PX_PER_M;
    // lay the room down the way it fits: if the strip is deep enough to take
    // its long side across, it only needs its short side along
    return Math.max(MIN_ROOM, depth >= long * 0.85 ? short : long);
  }

  /* ---------- floor plans ----------
     A building described as the rooms it contains rather than as the walls
     that happen to be in it.

     Blueprints used to hand-place a wall run, then separately declare a `room`
     rect for the loot pass to fill — and nothing checked that the two agreed.
     They frequently didn't: the house declared its living room and one of its
     bedrooms at exactly the same rectangle, and its foyer overlapped its
     bathroom, because the rects were eyeballed against walls placed earlier.
     A room that doesn't match its walls is a room you can't tell you're in.

     `floorPlan` takes one description and derives all three from it — the
     dividing walls, the rects the loot and lighting passes use, and a door
     from every room onto the corridor. They agree by construction. Rooms are
     sized against ROOM_SIZE, so a plan of "bathroom, bedroom, living room"
     produces a small one, a middling one and a big one rather than three
     identical thirds.

     opts:
       corridor  { axis:'h'|'v', width } — the spine, centred by `at` (0..1)
       a, b      the room kinds either side of it (a = north/west)
       type      wall type, thickness, doorType as elsewhere */
  function floorPlan(type, ox, oy, w, h, opts = {}) {
    /* Two thicknesses, not one. The walls between rooms are partitions; the
       walls that line the corridor carry the building and are heavier. Using
       a single figure for both is what made every wall inside a building look
       the same weight, so nothing about a plan told you what was structural. */
    const th = opts.thickness || WALL_T.interior;
    const thP = opts.partition || Math.min(opts.thickness || WALL_T.partition, WALL_T.partition);
    const doorType = opts.doorType === null ? null : (opts.doorType || 'door');
    const co = opts.corridor || { axis: 'h', width: 88 };
    const horiz = co.axis === 'h';
    const at = co.at === undefined ? 0.5 : co.at;
    const inset = opts.inset === undefined ? 10 : opts.inset;
    const parts = [], rooms = [], garages = [];

    // `along` runs down the corridor, `across` is perpendicular to it
    const run = horiz ? w : h;
    const across = horiz ? h : w;
    /* A corridor has to stay walkable once it has been lit and furnished: a
       body is 30px and the walls eat some of the nominal width, so anything
       under this is a passage you get stuck in rather than one you move
       through. */
    const cw = Math.max(88, Math.min(co.width, across - MIN_ROOM * 2));
    const mid = across * at;
    const aDepth = Math.max(0, mid - cw / 2);
    const bStart = mid + cw / 2;
    const bDepth = Math.max(0, across - bStart);
    // (along, across) -> world
    const P = (a, b) => (horiz ? { x: ox + a, y: oy + b } : { x: ox + b, y: oy + a });

    /* Lay one band out along the run, each room sized by what it is for.
       Returns the offsets its doors want in the corridor wall. */
    const layBand = (kinds, bandAt, depth, outerSide, filler) => {
      const doors = [];
      if (!kinds || !kinds.length || depth < MIN_ROOM) return doors;
      kinds = kinds.slice();
      /* Zoned along the run: public by the way in, private at the far end.
         `entrance` says which end of the run the front door is on. */
      /* Zoned around the way in. Sorting the public rooms to one end of the
         run is only right when the front door is at that end — and most of
         these buildings are entered through the middle of a long wall, so
         doing it that way actually put the lobby further from the door than
         the bedrooms were. Instead the rooms are ranked by zone and then laid
         outward from the entrance in both directions, so the public end up
         beside the door and the private at the far ends whichever wall you
         come in through. */
      if (opts.entrance !== null) {
        const front = opts.entrance === undefined ? 0.5 : opts.entrance;
        const ranked = kinds.slice().sort((k1, k2) => zoneOf(k1) - zoneOf(k2));
        if (front <= 0.02 || front >= 0.98) {
          kinds = front >= 0.98 ? ranked.reverse() : ranked;
        } else {
          // deal outward from the middle: public at the door, private at the ends
          const left = [], right = [];
          ranked.forEach((k, i) => (i % 2 ? left : right).push(k));
          kinds = left.reverse().concat(right);
        }
      }
      const usable = run - inset * 2;
      const sum = () => kinds.reduce((t, k) => t + roomExtent(k, depth), 0);
      /* A band with a lot of run and few rooms in it has to stretch them, and
         past a point that stops looking like a bigger house and starts looking
         like a bathroom the size of a ballroom — it also makes the two sides of
         the corridor disagree, so a kitchen on the crowded side ends up smaller
         than a bathroom on the empty one. A real building solves a long side by
         putting another room on it, so that is what this does. */
      const fill = filler || 'storeroom';
      while (usable / sum() > 1.6 && kinds.length < 9) kinds.push(fill);
      const MAX_ASPECT = 3.0;
      const want = kinds.map(k => roomExtent(k, depth));
      const total = want.reduce((t, v) => t + v, 0);
      const k2 = usable / total;                 // fill the run, keep the ratios
      /* Then hold every room to a shape. A room's extent along the run comes
         from what it is for, but its depth is whatever the band happens to
         be, so a small room in a deep band came out as a slot — the mansion's
         strongroom was 68px across and 269 deep, which is a corridor with a
         door on it. Anything under the limit is widened and the space is
         taken off the largest rooms, which have it to spare. The floor has to
         be applied after the run is scaled to fit, not before: scaling to fill
         is what was crushing them in the first place. */
      const ext = want.map(v => v * k2);
      // the rect is inset 8px a side, so solve the limit for the *rect*
      const minE = Math.min((depth - 16) / MAX_ASPECT + 16, usable / kinds.length);
      for (let i = 0; i < ext.length; i++) {
        let need = minE - ext[i];
        if (need <= 0.5) continue;
        ext[i] = minE;
        for (let guard = 0; need > 0.5 && guard < 20; guard++) {
          let j = -1, biggest = minE;
          for (let q = 0; q < ext.length; q++) if (q !== i && ext[q] > biggest) { biggest = ext[q]; j = q; }
          if (j < 0) break;
          const take = Math.min(need, ext[j] - minE);
          ext[j] -= take; need -= take;
        }
      }
      let cursor = inset;
      kinds.forEach((kind, i) => {
        const e = ext[i];
        // the wall that closes this room off from the one before it
        if (i > 0) {
          const p = P(cursor, bandAt);
          parts.push(...partition(type, p.x, p.y, depth, horiz ? 'v' : 'h', thP, [], null));
        }
        const p0 = P(cursor, bandAt);
        rooms.push(horiz
          ? room(kind, p0.x + 8, p0.y + 8, e - 16, depth - 16)
          : room(kind, p0.x + 8, p0.y + 8, depth - 16, e - 16));
        doors.push({ at: cursor + e / 2, type: SECURE_DOOR[kind] || doorType });
        /* A garage opens to the outside as well as to the house: a roller door
           through the shell wall in front of it, wide enough to drive through.
           The caller punches it, because the shell is the caller's to build. */
        if (kind === 'garage') {
          const len = Math.min(e - 30, 200);
          if (len > 90) garages.push({ side: outerSide, at: cursor + e / 2 - len / 2, len: len / PX_PER_M, type: 'garage-door' });
        }
        cursor += e;
      });
      return doors;
    };

    /* ---------- the service passage ----------
       A narrow way along the back of one band, behind the rooms, joining the
       two ends of the building without going down the main corridor.

       A building with a single spine is a building with a single approach:
       whoever holds the middle of it holds all of it, and the only way to the
       far end is to walk the length of their sightline. A back passage gives
       the place a second route, which is what turns holding a building into a
       decision rather than a formality — the flanking path that room-and-
       corridor layouts in real level design always have.

       It is taken out of the depth of a band rather than added to the
       footprint, so the building does not grow to get one — which means it
       has to be measured out before the rooms are, or the rooms are laid at
       the full depth and the passage is cut straight through them. */
    const sideA = horiz ? 'n' : 'w', sideB = horiz ? 's' : 'e';
    let passage = null, aAt = 0, aD = aDepth, bAt = bStart, bD = bDepth;
    const pw = opts.passageWidth || 72;
    const onA = opts.passage === 'a';
    if (opts.passage && (onA ? aDepth : bDepth) > MIN_ROOM + pw) {
      if (onA) { aAt = pw; aD = aDepth - pw; } else { bD = bDepth - pw; }
      const at = onA ? 0 : across - pw;
      const inner = onA ? pw : across - pw;
      const c0 = P(0, inner);
      /* Doors at the ends only. A passage you can step into from every room it
         runs behind is just a wider room; two ways in, at the far corners, is
         a route you have to commit to. */
      parts.push(...partition(type, c0.x, c0.y, run, horiz ? 'h' : 'v', th,
        [inset + 60, run - inset - 60], doorType));
      const p0 = P(inset, at);
      passage = horiz
        ? { x: p0.x, y: p0.y + 8, w: run - inset * 2, h: pw - 16 }
        : { x: p0.x + 8, y: p0.y, w: pw - 16, h: run - inset * 2 };
    }

    const doorsA = layBand(opts.a, aAt, aD, sideA, opts.fillA);
    const doorsB = layBand(opts.b, bAt, bD, sideB, opts.fillB);
    if (passage) rooms.push(room('passage', passage.x, passage.y, passage.w, passage.h));

    /* The corridor itself: a wall each side with a doorway opposite the middle
       of every room, so every room the plan lays out has a way in. */
    const cA = P(0, aDepth), cB = P(0, bStart);
    if (aDepth >= MIN_ROOM) parts.push(...partition(type, cA.x, cA.y, run, horiz ? 'h' : 'v', th, doorsA, doorType));
    if (bDepth >= MIN_ROOM) parts.push(...partition(type, cB.x, cB.y, run, horiz ? 'h' : 'v', th, doorsB, doorType));

    /* The corridor rect stops short of both ends. The corridor wall runs the
       full width of the building, but the floor you can walk on does not — the
       shell walls close it off at each end. A rect that included them reported
       a hallway blocked at both ends, because it was: by its own end walls. */
    const cap = inset + 12;
    const corner = P(0, aDepth);
    const corridor = horiz
      ? { x: corner.x + cap, y: corner.y + 8, w: run - cap * 2, h: cw - 16 }
      : { x: corner.x + 8, y: corner.y + cap, w: cw - 16, h: run - cap * 2 };
    if (opts.corridorKind !== null) rooms.push(room(opts.corridorKind || 'hall', corridor.x, corridor.y, corridor.w, corridor.h));

    return { parts, rooms, doorsA, doorsB, corridor, garages };
  }

  /* ---------- hallways ----------
     A corridor is two parallel walls with doorways in them and a strip of
     floor between — the thing that turns a block of rooms into a building you
     move through rather than a grid you clip across. `doors` are offsets along
     the run where each side opens.

     Returns the parts plus the corridor rect, so the caller can light it and
     the loot pass can leave it alone. */
  function hallway(type, x, y, lengthPx, width, axis, opts = {}) {
    const th = opts.thickness || 0.28;
    const doorType = opts.doorType === null ? null : (opts.doorType || 'door');
    const a = opts.doorsA || [], b = opts.doorsB || [];
    const parts = axis === 'h'
      ? [...partition(type, x, y, lengthPx, 'h', th, a, doorType),
        ...partition(type, x, y + width, lengthPx, 'h', th, b, doorType)]
      : [...partition(type, x, y, lengthPx, 'v', th, a, doorType),
        ...partition(type, x + width, y, lengthPx, 'v', th, b, doorType)];
    const rect = axis === 'h'
      ? { x, y: y + 8, w: lengthPx, h: width - 16 }
      : { x: x + 8, y, w: width - 16, h: lengthPx };
    return { parts, rect };
  }

  /* ---------- basements ----------
     A sealed room with exactly one way in: a hatch in the floor above it. The
     engine draws one plane, so a basement is modelled as what it plays like —
     an enclosed space you can only reach through a single opening, cut off
     from every sightline in the building around it.

     That makes it the safest place on the map to loot and the worst place to
     be caught, which is what a basement is for. They are lightless by
     construction (`dark`), so whatever lamps get put down there are the only
     lamps there are.

     `hatchType` is what covers the stairs: a plain door for a cellar you can
     see, or a secret one for a vault nobody knows about. */
  /* Rooms that are not enclosed spaces: circulation, and the open air. These
     are meant to be long, and dividing them is how you ruin them. */
  const OPEN_ROOMS = new Set(['hall', 'passage', 'tunnel', 'track', 'dock', 'plane',
    'pool', 'wheatField', 'shippingCrate', 'shippedCrate', 'gate', 'courtyard']);

  /* The wall type a building is mostly made of, for pieces added after the
     fact that should match it. */
  function commonestWall(parts) {
    const tally = {};
    for (const p of parts) {
      if (p.isProp || isDoor(p) || !p.thickness) continue;
      tally[p.type] = (tally[p.type] || 0) + 1;
    }
    let best = 'wood', n = 0;
    for (const k in tally) if (tally[k] > n) { n = tally[k]; best = k; }
    return best;
  }

  /* One long room, divided into the several rooms it should have been.

     A 780px by 117px store is not a room, it is a corridor somebody put
     shelves in — and several blueprints declared exactly that, because it is
     easier to write one big rect than to work out where the walls go. This
     cuts it down its long axis into rooms of a sensible proportion and builds
     the partitions between them, with a doorway through each so the run is
     still walkable end to end. */
  function splitLong(type, r, opts = {}) {
    const target = opts.aspect || 1.7;
    const horiz = r.w >= r.h;
    const long = horiz ? r.w : r.h, short = horiz ? r.h : r.w;
    const n = Math.max(1, Math.round(long / (short * target)));
    if (n < 2) return { parts: [], rooms: [room(opts.kind || r.kind, r.x, r.y, r.w, r.h)] };
    const th = opts.thickness || WALL_T.partition;
    const doorType = opts.doorType === undefined ? 'door' : opts.doorType;
    const step = long / n;
    const parts = [], rooms = [];
    for (let i = 0; i < n; i++) {
      const a = i * step;
      rooms.push(horiz
        ? room(opts.kind || r.kind, r.x + a + 6, r.y, step - 12, r.h)
        : room(opts.kind || r.kind, r.x, r.y + a + 6, r.w, step - 12));
      if (i === 0) continue;
      parts.push(...(horiz
        ? partition(type, r.x + a, r.y, r.h, 'v', th, [r.h / 2], doorType)
        : partition(type, r.x, r.y + a, r.w, 'h', th, [r.w / 2], doorType)));
    }
    return { parts, rooms };
  }

  /* ---------- structural grid ----------
     A wide-span building stands on a regular grid of columns, and the spacing
     is not a matter of taste: industrial bays run about 7.5 to 12m, office
     frames 6 to 7.5m. A warehouse's columns are the most legible thing in it —
     they tell you the size of the space before you have crossed it, and the
     aisles are laid out between them.

     The posts in these buildings used to be placed by hand, a few at a time,
     wherever there was room. This puts them where a frame would actually put
     them: on a grid, aligned to the building, inset half a bay from the walls
     so no column lands in a doorway. */
  /* Real industrial bays run 7.5 to 12m. These sheds are only 15 to 25m
     across, so at the top of that range a warehouse gets a single column
     standing on its own, which reads as something dropped rather than as a
     frame. 6m is the bottom of the office range and the smallest spacing that
     is still a real one — and it is what actually produces a grid at this
     size. */
  const BAY = { industrial: 240, frame: 210 };     // px: 6.0m and 5.25m

  function columnGrid(x, y, w, h, opts = {}) {
    const bay = opts.bay || BAY.industrial;
    const kind = opts.kind || 'post';
    const size = opts.size || 30;
    const out = [];
    // column *lines*, not bays: a span of 2.3 bays carries two of them
    const cols = Math.max(1, Math.ceil(w / bay) - 1);
    const rows = Math.max(1, Math.ceil(h / bay) - 1);
    if (cols < 1 || rows < 1) return out;
    for (let cy = 1; cy <= rows; cy++) {
      for (let cx = 1; cx <= cols; cx++) {
        out.push(prop(kind, x + (w / (cols + 1)) * cx, y + (h / (rows + 1)) * cy, size));
      }
    }
    return out;
  }

  /* ---------- tunnels ----------
     A basement you can walk down rather than stand in: a sealed passage with
     a way in at each end. That makes it the one piece of the map that is a
     route rather than a room — you go under the ground at one place and come
     up somewhere else, and while you are down there nobody above can see you
     and you cannot see them.

     Built from the same pieces as a basement, because it plays as the same
     thing: an enclosed space cut off from every sightline around it. What
     makes it a tunnel rather than a cellar is the second hatch.

     `axis` is the direction it runs; `width` is the passage, not the
     footprint. */
  function tunnel(kind, x, y, lengthPx, axis, opts = {}) {
    const wallType = opts.wall || 'rwall';
    const th = opts.thickness || 0.4;
    const wd = opts.width || 96;
    const horiz = axis === 'h';
    const w = horiz ? lengthPx : wd;
    const h = horiz ? wd : lengthPx;
    const parts = [];
    parts.push(...partition(wallType, x, y, w, 'h', th, [], null));
    parts.push(...partition(wallType, x, y + h, w, 'h', th, [], null));
    parts.push(...partition(wallType, x, y, h, 'v', th, [], null));
    parts.push(...partition(wallType, x + w, y, h, 'v', th, [], null));
    /* A hatch at each end, on the side wall, so the passage is entered from
       the surface rather than from the room it happens to run past. */
    const ends = opts.ends === undefined ? [0.12, 0.88] : opts.ends;
    for (const t of ends) {
      const hatch = horiz
        ? seg('door', x + lengthPx * t - 31, y, 1.6, 'h', 0.3)
        : seg('door', x, y + lengthPx * t - 31, 1.6, 'v', 0.3);
      hatch.underground = true;
      hatch.hatch = true;
      parts.push(hatch);
    }
    for (const p of parts) p.underground = true;
    const rect = room(kind || 'tunnel', x + 16, y + 16, w - 32, h - 32);
    rect.dark = true;
    rect.basement = true;
    return { parts, room: rect };
  }

  function basement(kind, x, y, w, h, opts = {}) {
    const wallType = opts.wall || 'rwall';
    const th = opts.thickness || 0.4;
    const parts = [];
    // four walls, sealed
    parts.push(...partition(wallType, x, y, w, 'h', th, [], null));
    parts.push(...partition(wallType, x, y + h, w, 'h', th, [], null));
    parts.push(...partition(wallType, x, y, h, 'v', th, [], null));
    parts.push(...partition(wallType, x + w, y, h, 'v', th, [], null));
    // the only way in
    const hx = x + (opts.hatchAt === undefined ? w / 2 : opts.hatchAt);
    const hatch = opts.hatchType === 'secret'
      ? secretDoor(wallType, hx, y, 1.6, 'h', th)
      : seg('door', hx, y, 1.6, 'h', 0.3);
    hatch.underground = true;
    hatch.hatch = true;
    parts.push(hatch);
    for (const p of parts) p.underground = true;
    const rect = room(kind, x + 18, y + 18, w - 36, h - 36);
    rect.dark = true;
    rect.basement = true;
    return { parts, room: rect };
  }

  /* ---------- secret rooms ----------
     A hidden door that reads as the wall around it until you are close enough
     to notice the seam. The `secret` flag existed on three doors already and
     nothing ever looked at it, so a "secret room" was a door like any other
     with a property nobody read. This makes it mean something: game.js draws
     it as its host wall until you are within FIND_SECRET of it, and it can't
     be opened until it has been spotted.

     `hides` names the wall type it disguises itself as, so a secret door in a
     concrete wall looks like concrete rather than like a door. */
  function secretDoor(hides, x, y, lengthM, axis, thickness) {
    const d = seg('door', x, y, lengthM, axis, thickness || 0.3);
    d.secret = true;
    d.hides = hides;
    return d;
  }
  const FIND_SECRET = 96;      // px at which the seam becomes visible

  /* turn grid cells into rooms of a kind, in order */
  const cellRooms = (cells, kinds) =>
    cells.map((c, i) => room(typeof kinds === 'string' ? kinds : kinds[i % kinds.length], c.x, c.y, c.w, c.h));

  /* ---------- one dial for how big a building is ----------
     Every blueprint lays its interior out in absolute pixels from its own
     origin — partitions, doorways and room rects all carry hardcoded offsets.
     Editing `w` and `h` in thirty-three of them would leave every one of those
     offsets pointing at the wrong place, which is a long afternoon and a lot
     of walls in doorways.

     So the blueprint is drawn at its authored size and then scaled as a whole,
     about its own origin. Walls, doors, props and room rects all move
     together, so a building gets roomier without a single interior offset
     needing to change. Thickness scales too, which is right: a bigger building
     has heavier walls.

     A doorway is 62px authored, so at this factor it is 74 — comfortably wide
     for a 30px body, and wider than it was.

     The factor tapers with size. Growing everything by the same 1.2 multiplies
     floor area by 1.44, and the map has a fixed amount of ground: the giants
     (harbor, factory, the 900px-plus blueprints) ate the space the rest needed,
     and the generator ran out of room before it had placed a museum or a bank.
     A shanty at 380px gets the full 1.2 because it has the least to lose from
     being cramped; a harbor already sprawls and takes 1.06. Everything is
     bigger, nothing is bigger at the map's expense. */
  const BUILDING_SCALE = 1.2;      // the factor for the smallest blueprints
  const BIG_SCALE = 1.06;          // ...and for the ones already at SCALE_BIG
  const SCALE_SMALL = 380, SCALE_BIG = 900;   // authored long side, px

  function scaleFor(parts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s2 of parts) {
      x0 = Math.min(x0, s2.x); y0 = Math.min(y0, s2.y);
      x1 = Math.max(x1, s2.x + s2.w); y1 = Math.max(y1, s2.y + s2.h);
    }
    const long = Math.max(x1 - x0, y1 - y0);
    const t = Math.min(1, Math.max(0, (long - SCALE_SMALL) / (SCALE_BIG - SCALE_SMALL)));
    return BUILDING_SCALE + (BIG_SCALE - BUILDING_SCALE) * t;
  }

  function scalePlacement(parts, ox, oy, k) {
    if (k === 1) return parts;
    for (const s2 of parts) {
      s2.x = ox + (s2.x - ox) * k;
      s2.y = oy + (s2.y - oy) * k;
      s2.w *= k; s2.h *= k;
      if (s2.thickness) s2.thickness *= k;
    }
    for (const r of parts.rooms || []) {
      r.x = ox + (r.x - ox) * k;
      r.y = oy + (r.y - oy) * k;
      r.w *= k; r.h *= k;
    }
    return parts;
  }

  const BUILDINGS = {
    /* a plain wooden house: one front door, one back door, a divided interior */
    /* A family house, laid out the way a floor plan actually is: a central
       hallway front to back, the living space and garage on one side, the
       bedrooms and bathroom on the other. Room sizes come from ROOM_SIZE, so
       the bathroom is the small one and the living room the big one — they are
       no longer equal thirds of a rectangle.

       The plan derives the dividing walls, the room rects and a door from
       every room onto the hallway from one description, so the walls and the
       rooms cannot disagree. They used to: the living room and one bedroom
       were declared at the same rectangle, and the foyer overlapped the
       bathroom. */
    house(ox, oy) {
      const w = 530, h = 360;
      const plan = floorPlan('wood', ox, oy, w, h, {
        corridor: { axis: 'h', at: 0.52, width: 78 },
        a: ['bedroom', 'bedroom', 'bathroom'],
        b: ['living', 'kitchen', 'garage'],
        fillA: 'study', fillB: 'pantry',
        thickness: 0.2,
      });
      const out = shell(ox, oy, w, h, 'wood', WALL_T.exterior, [
        { side: 'w', at: h * 0.52 - 30 },              // front door, onto the hall
        { side: 'e', at: h * 0.52 - 30 },              // back door, same hall
        ...plan.garages,                                // the roller door
      ]);
      out.push(...plan.parts);
      // windows down the bedroom side, and one over the kitchen
      out.push(seg('window', ox + 90, oy, 1.2, 'h', 0.15));
      out.push(seg('window', ox + 300, oy, 1.2, 'h', 0.15));
      out.push(seg('window', ox + 250, oy + h, 1.2, 'h', 0.15));
      // a cellar under the back of the house, reached by a hatch you can see
      const cellar = basement('storeroom', ox + 80, oy + h + 46, 300, 180,
        { wall: 'wood', thickness: 0.35, hatchAt: 150 });
      out.push(...cellar.parts);
      out.rooms = [cellar.room, ...plan.rooms];
      return out;
    },

    /* mansion: thicker walls, a reinforced core room, four ways in */
    /* mansion: four bedrooms off a hallway upstairs-side, kitchen and dining
       east, pool and garage across the back, the safe behind a reinforced
       door — and a study whose back wall isn't quite what it looks like. */
    /* A country house on the standard plan: bedrooms and a bathroom along the
       front, the reception rooms and the garage along the back, one hallway
       running the length of it. The strongroom is off the study behind a
       reinforced door, and the study's back wall is not quite what it looks
       like.

       The rooms used to be hand-placed rects that didn't match the walls —
       both bathrooms were declared inside the hallway. */
    mansion(ox, oy) {
      const w = 800, h = 570;
      const plan = floorPlan('wood', ox, oy, w, h, {
        corridor: { axis: 'h', at: 0.45, width: 84 },
        a: ['bedroom', 'bedroom', 'bathroom', 'bedroom', 'bedroom'],
        b: ['living', 'dining', 'kitchen', 'study', 'safe', 'garage'],
        fillA: 'study', fillB: 'pantry', thickness: 0.3,
        passage: 'a',       // servants' corridor behind the bedrooms
      });
      const out = shell(ox, oy, w, h, 'wood', 0.4, [
        { side: 'w', at: h * 0.45 - 30, type: 'door', len: 2 },
        { side: 'e', at: h * 0.45 - 30, type: 'door', len: 2 },
        { side: 'n', at: 300, type: 'door' },
        ...plan.garages,
      ]);
      out.push(...plan.parts);
      // the strongroom is reinforced on every side, not just its door
      const safe = plan.rooms.find(r => r.kind === 'safe');
      if (safe) {
        out.push(...partition('rwall', safe.x - 8, safe.y - 8, safe.h + 16, 'v', 0.45, [], null));
        out.push(...partition('rwall', safe.x + safe.w + 8, safe.y - 8, safe.h + 16, 'v', 0.45, [], null));
        // and the study next door has a shelf that swings
        out.push(secretDoor('wood', safe.x - 8, safe.y + safe.h * 0.55, 1.6, 'v', 0.3));
      }
      for (const dx of [90, 320, 560, 790]) out.push(seg('window', ox + dx, oy, 1.6, 'h', 0.15));
      /* The pool the design table calls for: grounds rather than a room, walled
         low enough to shoot over and open at one corner. */
      out.push(seg('barricade', ox + w + 60, oy + 300, 6, 'h', 0.3));
      out.push(seg('barricade', ox + w + 60, oy + 480, 6, 'h', 0.3));
      out.push(seg('barricade', ox + w + 60, oy + 300, 4.5, 'v', 0.3));
      const cellar = basement('strongroom', ox + 120, oy + h + 50, 300, 190,
        { wall: 'rwall', thickness: 0.4, hatchAt: 150 });
      out.push(...cellar.parts);
      out.rooms = [...plan.rooms, cellar.room, room('pool', ox + w + 80, oy + 320, 200, 140)];
      return out;
    },

    /* ---------- resort ----------
       The biggest residential building on the map and the densest bedroom
       count: ten rooms off one long corridor, so it fights like a hotel —
       doorway after doorway, nowhere to shoot from range. The lounge and the
       dock are what make crossing it worth the risk. */
    /* ---------- resort ----------
       The densest bedroom count on the map: rooms off one long corridor, so it
       fights like a hotel — doorway after doorway, nowhere to shoot from
       range. The public rooms are along the back with the dining lobby in the
       middle of them. */
    resort(ox, oy) {
      const w = 1050, h = 620;
      const plan = floorPlan('wood', ox, oy, w, h, {
        corridor: { axis: 'h', at: 0.44, width: 84 },
        a: ['bedroom', 'bedroom', 'bedroom', 'bedroom', 'bedroom'],
        b: ['washroom', 'diningLobby', 'lounge', 'backKitchen', 'bedroom'],
        fillA: 'bedroom', fillB: 'washroom', thickness: 0.25,
        passage: 'b',       // service corridor behind the public rooms
      });
      const out = shell(ox, oy, w, h, 'wood', 0.4, [
        { side: 'w', at: h * 0.44 - 30, type: 'door', len: 2 },
        { side: 'e', at: h * 0.44 - 30, type: 'door', len: 2 },
        { side: 's', at: 420, type: 'door', len: 2 },
      ]);
      out.push(...plan.parts);
      for (const dx of [120, 400, 700, 980]) out.push(seg('window', ox + dx, oy, 1.6, 'h', 0.15));
      out.rooms = [
        ...plan.rooms,
        room('pool', ox + w + 60, oy + 120, 260, 200),
        room('dock', ox + w + 60, oy + 360, 300, 150),
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
      out.push(...shell(ox + 940, oy + 40, 380, 280, 'wood', WALL_T.exterior, [
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
      const out = shell(ox, oy, w, h, 'wood', WALL_T.exterior, [
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
    /* library: long parallel stacks, reading rooms off a hall at the back,
       and an archive nobody has the key to */
    library(ox, oy) {
      const w = 660, h = 490;
      const plan = floorPlan('wood', ox, oy, w, h, {
        corridor: { axis: 'h', at: 0.66, width: 74 },
        a: ['classroom', 'classroom'],
        b: ['study', 'staffRoom', 'strongroom'],
        fillA: 'study', fillB: 'office', thickness: 0.25,
      });
      const out = shell(ox, oy, w, h, 'wood', WALL_T.exterior, [
        { side: 'n', at: 320, type: 'door', len: 2 },
        { side: 'e', at: h * 0.66 - 28 },
      ]);
      out.push(...plan.parts);
      /* The stacks: runs of shelving inside the reading rooms, alternating
         which end is open so the room is a set of aisles rather than a hall. */
      const reading = plan.rooms.filter(r => r.kind === 'classroom');
      reading.forEach((r, ri) => {
        const runs = Math.max(2, Math.floor(r.w / 90));
        for (let i = 1; i < runs; i++) {
          const x = r.x + (r.w / runs) * i;
          const top = (i + ri) % 2 === 0;
          out.push(seg('wood', x, top ? r.y : r.y + r.h * 0.38, (r.h * 0.62) / PX_PER_M, 'v', 0.25));
        }
      });
      // the archive: a false shelf at the end of a stack
      const arch = plan.rooms.find(r => r.kind === 'strongroom');
      if (arch) out.push(secretDoor('wood', arch.x - 8, arch.y + arch.h * 0.5, 1.6, 'v', 0.25));
      for (const dx of [60, 320, 600]) out.push(seg('window', ox + dx, oy, 1.6, 'h', 0.15));
      out.rooms = plan.rooms;
      return out;
    },

    /* ---------- garage ----------
       Four work bays, a jeep in one of them, and a wall of tools. */
    /* A working garage: bays you can drive into, a store and an office off the
       back. Every bay gets its own roller door, which is what makes the front
       of the building read as a garage from outside. */
    garage(ox, oy) {
      const w = 580, h = 400;
      const plan = floorPlan('metal', ox, oy, w, h, {
        corridor: { axis: 'h', at: 0.74, width: 72 },
        a: ['garage', 'garage', 'workbay'],
        b: ['storeroom', 'office'],
        fillA: 'workbay', fillB: 'storeroom', thickness: 0.3,
      });
      const out = shell(ox, oy, w, h, 'metal', 0.45, [
        { side: 'e', at: h * 0.74 - 26, type: 'door' },
        ...plan.garages,
      ]);
      out.push(...plan.parts);
      out.push(seg('barricade', ox + 40, oy + h + 40, 4, 'h', 0.3));
      out.rooms = plan.rooms;
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
    /* military base: metal shell that ricochets rifle fire, a barrack block
       and an ops room inside, wire and sandbags outside */
    /* military base: a working post rather than a shed with a wall round it.
       Ops room and radio down one side, briefing and mess the other, the
       motor pool at the back, and a watch post on the wire. */
    /* military base: a working post. One long spine corridor runs the whole
       width with the rooms opening off it, so the building has a spine you
       walk rather than a lobby you cross.

       The roof posts sit tight against the corridor walls — a column in the
       middle of a hallway is something you bump into on every trip through,
       which is not what cover is for. */
    base(ox, oy) {
      const w = 980, h = 660;
      const out = shell(ox, oy, w, h, 'metal', 0.6, [
        { side: 'w', at: 300, type: 'rdoor' }, { side: 'e', at: 360, type: 'rdoor' },
        { side: 'n', at: 520, type: 'rdoor' },
      ]);
      // the spine: full width, 96px clear, doors onto it from both sides
      const HALL_Y = 282, HALL_H = 96;
      const hall = hallway('metal', ox + 14, oy + HALL_Y, w - 28, HALL_H, 'h', {
        doorsA: [150, 420, 700], doorsB: [220, 500, 800],
      });
      out.push(...hall.parts);
      const north = roomGrid('metal', ox + 14, oy + 14, w - 28, HALL_Y - 14, 3, 1, { access: 's' });
      const south = roomGrid('metal', ox + 14, oy + HALL_Y + HALL_H + 14, w - 28, h - HALL_Y - HALL_H - 28, 3, 1, { access: 'n' });
      out.push(...north.parts, ...south.parts);
      // posts hard against the corridor walls, clear of the walking line
      for (const dx of [250, 620]) {
        out.push(prop('post', ox + dx, oy + HALL_Y + 20, 28));
        out.push(prop('post', ox + dx + 120, oy + HALL_Y + HALL_H - 20, 28));
      }
      // emplacements + perimeter wire
      out.push(seg('sandbag', ox - 90, oy + 100, 3.2, 'h', 0.5));
      out.push(seg('sandbag', ox - 90, oy + 520, 3.2, 'h', 0.5));
      out.push(seg('sandbag', ox + w + 20, oy + 320, 3.2, 'h', 0.5));
      out.push(seg('wire', ox - 120, oy - 60, 29, 'h', 0.4));
      out.push(seg('wire', ox - 120, oy - 60, 20, 'v', 0.4));
      // watch post out on the wire
      out.push(...partition('sandbag', ox - 130, oy + h + 90, 160, 'h', 0.5, [], null));
      out.push(...partition('sandbag', ox - 130, oy + h + 90, 120, 'v', 0.5, [], null));
      out.rooms = [
        room('opsRoom',   north.cells[0].x, north.cells[0].y, north.cells[0].w, north.cells[0].h),
        room('radioRoom', north.cells[1].x, north.cells[1].y, north.cells[1].w, north.cells[1].h),
        room('armoury',   north.cells[2].x, north.cells[2].y, north.cells[2].w, north.cells[2].h),
        room('briefing',  south.cells[0].x, south.cells[0].y, south.cells[0].w, south.cells[0].h),
        room('mess',      south.cells[1].x, south.cells[1].y, south.cells[1].w, south.cells[1].h),
        room('bunkroom',  south.cells[2].x, south.cells[2].y, south.cells[2].w, south.cells[2].h),
        room('hall',      hall.rect.x, hall.rect.y, hall.rect.w, hall.rect.h),
        room('watchPost', ox - 115, oy + h + 105, 130, 95),
      ];
      return out;
    },

    /* warehouse: one big metal hall, a mezzanine wall, wide roller doors.
       Ricochet city — think twice before spraying inside it. */
    /* warehouse: two rows of racking with a loading aisle down the middle.
       Every sightline is an aisle, so it fights as a set of parallel lanes. */
    warehouse(ox, oy) {
      const w = 700, h = 460;
      const out = shell(ox, oy, w, h, 'metal', 0.55, [
        { side: 'n', at: 280, type: 'rdoor', len: 3 },
        { side: 's', at: 140 }, { side: 'e', at: 200, type: 'rdoor' },
      ]);
      // racking: four bays a side, open onto the central aisle
      const top = roomGrid('metal', ox + 14, oy + 14, w - 28, 176, 4, 1, { access: 's', doorType: null, thickness: 0.3 });
      const bot = roomGrid('metal', ox + 14, oy + h - 190, w - 28, 176, 4, 1, { access: 'n', doorType: null, thickness: 0.3 });
      out.push(...top.parts, ...bot.parts);
      out.push(seg('sandbag', ox + 120, oy + h / 2 - 10, 3, 'h', 0.5));
      out.push(seg('barricade', ox + 460, oy + h / 2 - 10, 4, 'h', 0.3));
      // the frame the shed hangs on, at industrial bay spacing
      out.push(...columnGrid(ox, oy, w, h, { kind: 'pillar', size: 34 }));
      out.rooms = [...cellRooms(top.cells, 'storeroom'), ...cellRooms(bot.cells, 'storeroom')];
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
      /* The fighting position is the lid; the magazine is underneath. A poor
         building on the surface with something worth the climb below it. */
      const mag = basement('armoury', ox + 20, oy + h + 40, 260, 170,
        { wall: 'rwall', thickness: 0.5, hatchAt: 130 });
      out.push(...mag.parts);
      out.rooms = [mag.room, room('guardRoom', ox + 25, oy + 25, w - 50, h - 50)];
      return out;
    },

    /* ---------- bunker complex ----------
       Two concrete heads on the surface a long way apart, and a tunnel joining
       them underneath with the magazine off the middle of it. It is the only
       structure on the map that is a route: drop in at one end, come up at the
       other, and for the length of the walk nothing above ground can see you
       or shoot you. That makes it both the safest way across an open field and
       the worst place to be met coming the other way.

       The chest is at the bottom, off the passage, behind a reinforced door —
       the payoff for committing to the walk. */
    'bunker-complex'(ox, oy) {
      const out = [];
      const RUN = 900;
      // the two surface heads: squat, reinforced, one door each
      out.push(...shell(ox, oy, 200, 190, 'rwall', 0.5, [{ side: 'n', at: 70, type: 'rdoor' }]));
      out.push(...shell(ox + RUN - 40, oy, 200, 190, 'rwall', 0.5, [{ side: 'n', at: 70, type: 'rdoor' }]));
      // sandbagged approaches, so each head reads as something worth holding
      out.push(seg('sandbag', ox - 70, oy + 60, 3.5, 'v', 0.5));
      out.push(seg('sandbag', ox + RUN + 170, oy + 60, 3.5, 'v', 0.5));
      out.push(seg('wire', ox - 90, oy - 60, 6, 'h', 0.4));
      out.push(seg('wire', ox + RUN + 40, oy - 60, 6, 'h', 0.4));
      // the passage, joining the two heads underneath
      /* Close behind the blockhouses, so the way down is at the back of each
         one rather than out in the open field — the engine draws a single
         plane, so the passage sits beside what it serves rather than under it,
         the same compromise every cellar on the map makes. */
      const pass = tunnel('tunnel', ox + 60, oy + 232, RUN, 'h', { width: 104, ends: [0.04, 0.96] });
      out.push(...pass.parts);
      // the magazine, off the middle of it, behind a reinforced door
      const mag = basement('armoury', ox + 380, oy + 376, 280, 180,
        { wall: 'rwall', thickness: 0.5, hatchAt: 140 });
      out.push(...mag.parts);
      // and a store at the far end, for the people who walk the whole length
      const store = basement('storeroom', ox + RUN - 240, oy + 376, 230, 170,
        { wall: 'rwall', thickness: 0.5, hatchAt: 115 });
      out.push(...store.parts);
      out.rooms = [
        room('guardRoom', ox + 22, oy + 22, 156, 146),
        room('guardRoom', ox + RUN - 18, oy + 22, 156, 146),
        pass.room, mag.room, store.room,
      ];
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
      out.push(...partition('wood', ox + 14, oy + 180, w - 28, 'h', WALL_T.interior, [110, 310, 510, 710], 'door'));
      out.push(...partition('wood', ox + 14, oy + 280, w - 28, 'h', WALL_T.interior, [110, 310, 510, 710], 'door'));
      const top = roomGrid('wood', ox + 14, oy + 14, w - 28, 166, 4, 1, { access: 's', thickness: WALL_T.partition });
      const bot = roomGrid('wood', ox + 14, oy + 294, w - 28, h - 308, 4, 1, { access: 'n', thickness: WALL_T.partition });
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
    /* hangar: one enormous shed with a parked airframe down the middle and
       the maintenance bays along the north wall */
    hangar(ox, oy) {
      const w = 860, h = 520;
      const out = shell(ox, oy, w, h, 'metal', 0.65, [
        { side: 's', at: 360, type: 'garage-door', len: 6 },
        { side: 'w', at: 220, type: 'rdoor' },
      ]);
      // maintenance bays along the back
      const bays = roomGrid('metal', ox + 14, oy + 14, w - 28, 170, 4, 1, { access: 's', doorType: null, thickness: 0.35 });
      out.push(...bays.parts);
      // the airframe on the floor: fuselage and wings
      out.push(seg('metal', ox + 220, oy + 300, 10, 'h', 0.5));
      out.push(seg('metal', ox + 220, oy + 400, 10, 'h', 0.5));
      out.push(seg('metal', ox + 220, oy + 300, 2.5, 'v', 0.5));
      out.push(seg('metal', ox + 470, oy + 230, 4, 'v', 0.35));
      out.push(seg('sandbag', ox + 700, oy + 380, 4, 'h', 0.5));
      // a hangar is one clear span: columns only down the sides
      out.push(...columnGrid(ox, oy, w, h, { kind: 'pillar', size: 36, bay: 360 }));
      out.rooms = [
        ...cellRooms(bays.cells, 'workbay'),
        room('plane', ox + 240, oy + 315, 380, 80),
      ];
      return out;
    },

    /* farm: a big barn plus a fenced yard. Wood everywhere — a Breacher's map. */
    farm(ox, oy) {
      const plan = floorPlan('wood', ox, oy, 480, 340, {
        corridor: { axis: 'h', at: 0.5, width: 70 },
        a: ['bedroom', 'bedroom'],
        b: ['kitchen', 'bathroom'],
        fillA: 'bedroom', fillB: 'pantry', thickness: 0.25,
      });
      const out = shell(ox, oy, 480, 340, 'wood', WALL_T.exterior, [
        { side: 'w', at: 340 * 0.5 - 28, len: 2 },
        { side: 'e', at: 340 * 0.5 - 28 },
      ]);
      out.push(...plan.parts);
      // yard fence, deliberately flimsy
      out.push(seg('barricade', ox + 530, oy + 40, 8, 'v', 0.25));
      out.push(seg('barricade', ox + 530, oy + 40, 7, 'h', 0.25));
      out.push(seg('barricade', ox + 530, oy + 360, 7, 'h', 0.25));
      out.push(seg('wire', ox - 60, oy + 380, 8, 'h', 0.4));
      // barn behind the yard fence, and the coop nobody thinks to check
      out.push(...shell(ox + 560, oy + 60, 320, 260, 'wood', 0.35, [{ side: 'w', at: 120, type: 'door', len: 2 }]));
      out.push(...shell(ox + 580, oy + 400, 150, 120, 'wood', 0.2, [{ side: 'n', at: 60, len: 1.5 }]));
      out.rooms = [
        ...plan.rooms,
        room('wheatField',  ox - 40,  oy + 400, 360, 220),
        room('wheatField',  ox + 340, oy + 660, 340, 200),
        room('barn',        ox + 580, oy + 80,  280, 220),
        room('chickenCoop', ox + 596, oy + 418, 118, 86),
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
      out.push(...shell(ox + 250, oy + 60, 130, 110, 'rwall', 0.4, [{ side: 'w', at: 30, type: 'rdoor' }]));
      out.rooms = [room('guardRoom', ox + 262, oy + 72, 106, 86)];
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
    /* factory: a production hall of six bays with an office block and a
       reinforced parts store at the west end */
    factory(ox, oy) {
      const w = 1040, h = 600;
      const out = shell(ox, oy, w, h, 'metal', 0.6, [
        { side: 'n', at: 240, type: 'rdoor', len: 4 },
        { side: 'n', at: 700, type: 'rdoor', len: 4 },
        { side: 's', at: 460, type: 'rdoor', len: 4 },
        { side: 'w', at: 300, type: 'rdoor' },
      ]);
      // the hall: three bays north, three south, with a walkway between
      const hall = roomGrid('metal', ox + 240, oy + 14, w - 254, h - 180, 3, 2,
        { access: 'n', thickness: 0.35, doorType: null });
      out.push(...hall.parts);
      // offices along the west wall
      out.push(...partition('metal', ox + 226, oy + 14, h - 28, 'v', 0.4, [140, 420], 'door'));
      const offices = roomGrid('metal', ox + 14, oy + 14, 212, h - 28, 1, 3, { access: 'e' });
      out.push(...offices.parts);
      // parts store, reinforced, along the south strip
      out.push(...partition('rwall', ox + 240, oy + h - 152, w - 254, 'h', 0.4, [200, 620], 'rdoor'));
      out.rooms = [
        ...cellRooms(hall.cells, 'workbay'),
        room('office', offices.cells[0].x, offices.cells[0].y, offices.cells[0].w, offices.cells[0].h),
        room('controlRoom', offices.cells[1].x, offices.cells[1].y, offices.cells[1].w, offices.cells[1].h),
        room('office', offices.cells[2].x, offices.cells[2].y, offices.cells[2].w, offices.cells[2].h),
        room('storeroom', ox + 260, oy + h - 130, w - 300, 110),
      ];
      // the frame the shed hangs on, at industrial bay spacing
      out.push(...columnGrid(ox, oy, w, h, { kind: 'pillar', size: 34 }));
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
    /* command centre: a map room ringed by offices, and a reinforced signals
       room. Standing in it puts every contact on your minimap. */
    'command-center'(ox, oy) {
      const w = 720, h = 560;
      const out = shell(ox, oy, w, h, 'metal', 0.5, [
        { side: 'n', at: 300, type: 'rdoor', len: 2.5 },
        { side: 'e', at: 240, type: 'door' }, { side: 'w', at: 300 },
      ]);
      // offices along the north and the west
      const north = roomGrid('metal', ox + 14, oy + 14, w - 28, 150, 4, 1, { access: 's' });
      out.push(...north.parts);
      out.push(...partition('metal', ox + 14, oy + 178, w - 28, 'h', 0.35, [120, 380, 620], 'door'));
      out.push(...partition('metal', ox + 200, oy + 192, h - 206, 'v', 0.35, [180], 'door'));
      // signals room, reinforced, in the south-east
      out.push(...partition('rwall', ox + w - 220, oy + 192, h - 206, 'v', 0.4, [200], 'rdoor'));
      out.push(seg('window', ox + 60, oy + h - 12, 2.6, 'h', 0.2));
      out.push(seg('window', ox + 440, oy + h - 12, 2.6, 'h', 0.2));
      out.rooms = [
        ...cellRooms(north.cells, 'office'),
        room('controlRoom', ox + 220, oy + 210, w - 460, h - 240),
        room('armoury',     ox + w - 200, oy + 210, 175, h - 240),
        room('storeroom',   ox + 30, oy + 210, 150, h - 240),
      ];
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
      // the way into the inner room that isn't the heavy door
      const secret = secretDoor('rwall', ox + 320, oy + 210, 1.4, 'v', 0.4);
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
      const w = 760, h = 510;
      const plan = floorPlan('wood', ox, oy, w, h, {
        corridor: { axis: 'h', at: 0.47, width: 86 },
        a: ['ward', 'ward', 'ward', 'ward'],
        b: ['lobby', 'surgery', 'dispensary', 'office'],
        fillA: 'ward', fillB: 'staffRoom', thickness: 0.28,
        passage: 'a',       // the way the trolleys go
      });
      const out = shell(ox, oy, w, h, 'wood', 0.4, [
        { side: 'n', at: 340, type: 'door', len: 3 },
        { side: 'w', at: h * 0.47 - 30, type: 'door' },
        { side: 'e', at: h * 0.47 - 30, type: 'door' },
      ]);
      out.push(...plan.parts);
      for (const dx of [80, 300, 520, 740]) out.push(seg('window', ox + dx, oy, 1.6, 'h', 0.15));
      out.rooms = plan.rooms;
      return out;
    },

    /* workshop: industrial metal structure, tight corridors, high loot density */
    /* workshop: four work bays off a service aisle, a tool store and a
       reinforced control room. Tools work twice as fast in here. */
    workshop(ox, oy) {
      const w = 780, h = 540;
      const out = shell(ox, oy, w, h, 'metal', 0.5, [
        { side: 'n', at: 300, type: 'garage-door', len: 5 },
        { side: 's', at: 220, type: 'rdoor', len: 2 },
        { side: 'w', at: 260, type: 'door' },
      ]);
      const bays = roomGrid('metal', ox + 14, oy + 14, w - 200, 210, 4, 1, { access: 's', doorType: null, thickness: 0.3 });
      out.push(...bays.parts);
      out.push(...partition('metal', ox + 14, oy + 330, w - 200, 'h', 0.3, [140, 420], 'door'));
      const store = roomGrid('metal', ox + 14, oy + 344, w - 200, h - 358, 2, 1, { access: 'n' });
      out.push(...store.parts);
      // control room, reinforced, down the east end
      out.push(...partition('rwall', ox + w - 186, oy + 14, h - 28, 'v', 0.4, [h / 2], 'rdoor'));
      out.rooms = [
        // the bay behind the roller door is where the vehicle goes
        room('garage', bays.cells[0].x, bays.cells[0].y, bays.cells[0].w, bays.cells[0].h),
        ...cellRooms(bays.cells.slice(1), 'workbay'),
        room('storeroom', store.cells[0].x, store.cells[0].y, store.cells[0].w, store.cells[0].h),
        room('storeroom', store.cells[1].x, store.cells[1].y, store.cells[1].w, store.cells[1].h),
        room('controlRoom', ox + w - 170, oy + 30, 150, h - 60),
      ];
      return out;
    },

    /* dock: long wharf with crates and shipping containers, water-side hazard */
    /* dock: a transit shed of three bays, the harbourmaster's office behind
       it, and a container stack out on the quay */
    dock(ox, oy) {
      const w = 570, h = 410;
      const plan = floorPlan('metal', ox, oy, w, h, {
        corridor: { axis: 'h', at: 0.62, width: 78 },
        a: ['storeroom', 'storeroom', 'storeroom'],
        b: ['office', 'lobby'],
        fillA: 'storeroom', fillB: 'office', thickness: 0.3,
      });
      const out = shell(ox, oy, w, h, 'metal', 0.45, [
        { side: 's', at: 220, type: 'door', len: 2 },
        { side: 'w', at: h * 0.62 - 28, type: 'door' },
      ]);
      out.push(...plan.parts);
      // container stack out on the quay
      for (let i = 0; i < 3; i++) {
        const x = ox + 20 + i * 200;
        out.push(seg('metal', x, oy + 510, 4, 'h', 0.45));
        out.push(seg('metal', x, oy + 600, 4, 'h', 0.45));
        out.push(seg('metal', x, oy + 510, 2.25, 'v', 0.45));
      }
      out.push(seg('sandbag', ox + 660, oy + 280, 4, 'h', 0.5));
      out.rooms = [...plan.rooms, room('dock', ox + 40, oy + 530, 540, 60)];
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
      const w = 850, h = 620;
      const plan = floorPlan('rwall', ox, oy, w, h, {
        corridor: { axis: 'h', at: 0.5, width: 96 },
        a: ['cell', 'cell', 'cell', 'cell', 'cell', 'guardRoom'],
        b: ['cell', 'cell', 'cell', 'cell', 'cell', 'controlRoom'],
        fillA: 'cell', fillB: 'cell', thickness: 0.4, doorType: 'rdoor',
        passage: 'b',       // the guards' run behind the cells
      });
      const out = shell(ox, oy, w, h, 'rwall', 0.5, [
        { side: 'w', at: h * 0.5 - 30, type: 'rdoor', len: 2 },
        { side: 'e', at: h * 0.5 - 30, type: 'rdoor', len: 2 },
      ]);
      out.push(...plan.parts);
      // guard post in the corridor, covering its length
      out.push(seg('sandbag', ox + 400, oy + h * 0.5 - 14, 3, 'h', 0.5));
      out.push(seg('wire', ox - 70, oy - 60, 24, 'h', 0.4));
      out.push(seg('wire', ox - 70, oy - 60, 19, 'v', 0.4));
      out.rooms = plan.rooms;
      return out;
    },

    /* bank: ultra-secure vault with minimal entry points, high-tier loot */
    /* bank: a public hall behind a counter, offices along one side, and a
       vault you can either blow open or reach the quiet way if you find it */
    bank(ox, oy) {
      const w = 640, h = 470;
      const plan = floorPlan('wood', ox, oy, w, h, {
        corridor: { axis: 'h', at: 0.46, width: 80 },
        a: ['lobby', 'washroom', 'office'],
        b: ['office', 'office', 'strongroom', 'safe'],
        fillA: 'lobby', fillB: 'office', thickness: 0.35,
        passage: 'b',       // behind the counter, past the vault
      });
      const out = shell(ox, oy, w, h, 'wood', 0.45, [
        { side: 'n', at: 280, type: 'door', len: 2.5 },
        { side: 'w', at: h * 0.46 - 28 },
      ]);
      out.push(...plan.parts);
      /* The vault is reinforced all round, and there is a service passage
         behind it that the floor plan on the wall does not show. */
      const vault = plan.rooms.find(r => r.kind === 'safe');
      if (vault) {
        out.push(...partition('rwall', vault.x - 8, vault.y - 8, vault.h + 16, 'v', 0.45, [], null));
        out.push(...partition('rwall', vault.x - 8, vault.y + vault.h + 8, vault.w + 16, 'h', 0.45, [], null));
        out.push(secretDoor('rwall', vault.x - 8, vault.y + vault.h * 0.6, 1.5, 'v', 0.4));
      }
      for (const dx of [90, 480]) out.push(seg('window', ox + dx, oy, 1.8, 'h', 0.15));
      // the bullion cellar: reinforced, and the hatch is hidden
      const cellar = basement('strongroom', ox + 60, oy + h + 44, 320, 200,
        { wall: 'rwall', thickness: 0.45, hatchType: 'secret', hatchAt: 160 });
      out.push(...cellar.parts);
      out.rooms = [...plan.rooms, cellar.room];
      return out;
    },

    /* market: diverse trading post with many entry points, varied cover */
    /* market: two rows of stalls under one roof, a back office and a lock-up.
       Loud, cluttered and impossible to hold — every stall is a corner. */
    market(ox, oy) {
      const w = 740, h = 560;
      const out = shell(ox, oy, w, h, 'wood', 0.35, [
        { side: 'n', at: 180 }, { side: 'n', at: 460 },
        { side: 's', at: 240 }, { side: 'e', at: 300 },
      ]);
      const top = roomGrid('wood', ox + 14, oy + 14, w - 28, 190, 5, 1, { access: 's', doorType: null, thickness: 0.25 });
      const bot = roomGrid('wood', ox + 14, oy + 250, w - 28, 190, 5, 1, { access: 'n', doorType: null, thickness: 0.25 });
      out.push(...top.parts, ...bot.parts);
      // the counter, and the lock-up behind it
      out.push(...partition('wood', ox + 14, oy + h - 116, w - 28, 'h', 0.3, [200, 540], 'door'));
      out.push(...partition('rwall', ox + w - 210, oy + h - 116, 102, 'v', 0.4, [], 'rdoor'));
      out.rooms = [
        ...cellRooms(top.cells, 'stall'),
        ...cellRooms(bot.cells, 'stall'),
        room('office',     ox + 40,  oy + h - 100, w - 270, 82),
        room('strongroom', ox + w - 195, oy + h - 100, 175, 82),
      ];
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
    /* church: a nave of pews with a chancel behind the altar, a vestry off one
       side and the bell tower in the corner. Somewhere to get your breath. */
    church(ox, oy) {
      const w = 540, h = 660;
      const out = shell(ox, oy, w, h, 'wood', 0.45, [
        { side: 'n', at: 200, type: 'door', len: 2 },
        { side: 's', at: 240, type: 'door' }, { side: 'w', at: 480 },
      ]);
      // pews down the nave, staggered so the aisle is the only clean run
      for (let i = 0; i < 6; i++) {
        const y = oy + 210 + i * 66;
        out.push(seg('barricade', ox + 50, y, 4.2, 'h', 0.25));
        out.push(seg('barricade', ox + 300, y, 4.2, 'h', 0.25));
      }
      // chancel behind the altar rail
      out.push(...partition('wood', ox + 14, oy + 170, w - 28, 'h', 0.3, [180, 400], null));
      // vestry and bell tower
      out.push(...partition('wood', ox + 360, oy + 560, w - 374, 'h', 0.35, [], 'door'));
      out.push(...partition('wood', ox + 360, oy + 560, h - 574, 'v', 0.35, [46], 'door'));
      out.push(seg('metal', ox + 40, oy + 560, 2.4, 'h', 0.4));
      out.push(seg('metal', ox + 40, oy + 560, 2.4, 'v', 0.4));
      out.rooms = [
        room('lobby',     ox + 30,  oy + 30,  w - 60, 130),
        room('gym',       ox + 40,  oy + 200, w - 80, 340),
        room('staffRoom', ox + 375, oy + 575, 145, 70),
        room('safe',      ox + 50,  oy + 575, 100, 70),
      ];
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
        // wide enough for its gold crate to reliably find floor: at 105 it was
        // a 60px usable band once the walls were inset, and the crate that
        // makes this building worth entering sometimes had nowhere to go
        room('displayHall', ox + 580, oy + 20,  125, 500),
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
    /* arena: an open pit ringed by seating, with changing rooms and a trophy
       case tucked under the stands. The middle is deliberately naked. */
    arena(ox, oy) {
      const w = 700, h = 700;
      const out = [];
      // outer barrier
      /* The outer barrier, with a gate in each side. It used to be four
         unbroken runs — a closed box with the whole arena, and four rooms of
         loot, sealed inside it. */
      const RUN = w + 80;
      out.push(...partition('sandbag', ox - 40, oy - 40, RUN, 'h', 0.5, [RUN / 2], null));
      out.push(...partition('sandbag', ox - 40, oy + h + 40, RUN, 'h', 0.5, [RUN / 2], null));
      out.push(...partition('sandbag', ox - 40, oy - 40, RUN, 'v', 0.5, [RUN / 2], null));
      out.push(...partition('sandbag', ox + w + 40, oy - 40, RUN, 'v', 0.5, [RUN / 2], null));
      // two tiers of seating, with gangways cut through them
      for (const inset of [80, 140]) {
        const runH = w - inset * 2, runV = h - inset * 2;
        out.push(...partition('barricade', ox + inset, oy + inset, runH, 'h', 0.3, [runH / 2], null));
        out.push(...partition('barricade', ox + inset, oy + h - inset, runH, 'h', 0.3, [runH / 2], null));
        out.push(...partition('barricade', ox + inset, oy + inset, runV, 'v', 0.3, [runV / 2], null));
        out.push(...partition('barricade', ox + w - inset, oy + inset, runV, 'v', 0.3, [runV / 2], null));
      }
      /* Rooms under the stands, one in each corner: three walls and a door
         onto the concourse. They used to be drawn with two walls and no way
         in, which made four rooms of loot nobody could reach. */
      const rooms = [];
      const corner = (cx, cy, kind, doorSide) => {
        const rw = 150, rh = 120;
        out.push(...partition('wood', cx, cy, rw, 'h', WALL_T.exterior, doorSide === 'n' ? [rw / 2] : [], doorSide === 'n' ? 'door' : null));
        out.push(...partition('wood', cx, cy + rh, rw, 'h', WALL_T.exterior, doorSide === 's' ? [rw / 2] : [], doorSide === 's' ? 'door' : null));
        out.push(...partition('wood', cx, cy, rh, 'v', WALL_T.partition, doorSide === 'w' ? [rh / 2] : [], doorSide === 'w' ? 'door' : null));
        out.push(...partition('wood', cx + rw, cy, rh, 'v', WALL_T.partition, doorSide === 'e' ? [rh / 2] : [], doorSide === 'e' ? 'door' : null));
        rooms.push(room(kind, cx + 10, cy + 10, rw - 20, rh - 20));
      };
      corner(ox + 8, oy + 8, 'bunkroom', 'e');
      corner(ox + w - 158, oy + 8, 'storeroom', 'w');
      corner(ox + 8, oy + h - 128, 'strongroom', 'e');
      corner(ox + w - 158, oy + h - 128, 'gym', 'w');
      out.rooms = rooms;
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
    /* power plant: a turbine hall of four bays, switch gear along the south
       wall and a reinforced control room down the east end */
    'power-plant'(ox, oy) {
      const w = 860, h = 620;
      const out = shell(ox, oy, w, h, 'metal', 0.5, [
        { side: 'w', at: 180, type: 'rdoor' }, { side: 'e', at: 240, type: 'rdoor' },
        { side: 'n', at: 430, type: 'rdoor', len: 3 },
      ]);
      const hall = roomGrid('metal', ox + 14, oy + 14, w - 250, h - 190, 2, 2,
        { access: 'e', thickness: 0.4, doorType: null });
      out.push(...hall.parts);
      out.push(...partition('metal', ox + 14, oy + h - 162, w - 250, 'h', 0.35, [180, 460], 'door'));
      out.push(seg('barricade', ox + 60, oy + h - 90, 4, 'h', 0.3));
      out.push(seg('barricade', ox + 420, oy + h - 90, 4, 'h', 0.3));
      out.push(...partition('rwall', ox + w - 236, oy + 14, h - 28, 'v', 0.4, [(h - 28) / 2], 'rdoor'));
      out.rooms = [
        ...cellRooms(hall.cells, 'workbay'),
        room('storeroom',   ox + 40, oy + h - 145, w - 300, 120),
        room('controlRoom', ox + w - 220, oy + 30, 195, h - 60),
      ];
      // the frame the shed hangs on, at industrial bay spacing
      out.push(...columnGrid(ox, oy, w, h, { kind: 'pillar', size: 34 }));
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
      out.push(...shell(ox + 280, oy - 20, 240, 200, 'wood', WALL_T.exterior, [
        { side: 's', at: 80, type: 'door', len: 1.2 },
      ]));
      // storage tanks (hazard)
      out.push(seg('metal', ox + 480, oy + 160, 2.2, 'h', 0.4));
      out.push(seg('metal', ox + 480, oy + 160, 2.2, 'v', 0.4));
      // the service bay: a filling station with no garage is just two pumps
      out.push(...shell(ox + 280, oy + 220, 240, 210, 'metal', 0.4, [
        { side: 's', at: 20, type: 'garage-door', len: 5 },
        { side: 'n', at: 100, type: 'door', len: 1.5 },
      ]));
      out.rooms = [
        room('stall',  ox + 300, oy + 0,   200, 160),
        room('garage', ox + 300, oy + 240, 200, 170),
      ];
      return out;
    },

    /* mine: underground quarry with vertical drops and tight passages */
    /* mine: three galleries under a headframe, with the equipment store and
       the assay office cut into the rock at the back */
    mine(ox, oy) {
      const w = 700, h = 660;
      const plan = floorPlan('rock', ox, oy, w, h, {
        corridor: { axis: 'h', at: 0.72, width: 80 },
        a: ['workbay', 'workbay', 'workbay'],
        b: ['storeroom', 'safe'],
        fillA: 'workbay', fillB: 'storeroom', thickness: 0.35, doorType: null,
      });
      const out = shell(ox, oy, w, h, 'rock', 0.4, [
        { side: 'n', at: 260, type: 'door' },
        { side: 's', at: 300, type: 'door' },
        { side: 'w', at: h * 0.72 - 28, type: 'door' },
      ]);
      out.push(...plan.parts);
      // timbering across the galleries
      for (const r of plan.rooms.filter(x => x.kind === 'workbay')) {
        out.push(seg('wood', r.x + 20, r.y + r.h * 0.35, (r.w - 40) / PX_PER_M, 'h', 0.25));
      }
      out.rooms = plan.rooms;
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
    'bunker-complex': { ...S_INDUSTRIAL, floor: '#3e4147', roof: ['#575e63', '#3b4145'], trim: '#7d8a72' },
    watermill:   { ...S_RESIDENTIAL, floor: '#6f6350', roof: ['#5a7a6a', '#3c5548'], trim: '#2e4238' },

    /* ---- commercial and one-offs ---- */
    market:      { floor: '#8a7a5c', roof: ['#d06a4a', '#9c4630'], trim: '#7a3122', pattern: 'tile' },
    'gas-station': { floor: '#5a5646', roof: ['#d8412f', '#9c2b1e'], trim: '#f0d24a', pattern: 'concrete' },
    'radio-tower': { floor: '#4c5058', roof: ['#7a4a4a', '#553232'], trim: '#e8483c', pattern: 'metal' },
    arena:       { floor: '#5a5f6b', roof: ['#8a5a8a', '#5c3a5c'], trim: '#d0a04a', pattern: 'concrete' },
  };
  const DEFAULT_STYLE = { floor: '#5f5f5f', roof: ['#6a5442', '#54402f'], trim: '#1e140c', pattern: 'planks' };
  const styleOf = (name) => STYLE[name] || DEFAULT_STYLE;

  /* ---------- one house is not every house ----------
     A palette per building *type* meant the five houses on a map were five
     identical rectangles, and a street of them read as wallpaper. Each
     placement gets its own shift on top of the type's palette — a warmer roof,
     a paler floor — so the type is still legible at a glance while no two are
     the same object stamped twice.

     Rolled during generation, which is seeded, so every client shades the
     same building the same way. Rolling it at draw time would look identical
     on one screen and different on the next. */
  function shadeStyle(base, rnd) {
    const jitter = (hex, dl, dh) => shiftHex(hex, (rnd() * 2 - 1) * dl, (rnd() * 2 - 1) * dh);
    return {
      ...base,
      floor: jitter(base.floor, 15, 9),
      roof: [jitter(base.roof[0], 17, 11), jitter(base.roof[1], 17, 11)],
      trim: jitter(base.trim, 12, 8),
    };
  }

  /* nudge a hex colour by ±lightness and ±hue, both in small absolute steps */
  function shiftHex(hex, dLight, dHue) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = clamp255(r + dLight + dHue);          // hue nudge = warm/cool tilt
    g = clamp255(g + dLight);
    b = clamp255(b + dLight - dHue);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

  /* ---------- what a room's floor is made of ----------
     A building was one slab of colour from wall to wall, so from inside you
     could not tell where the kitchen stopped and the hallway began — the rooms
     existed in the collision data and nowhere on screen. Each kind lays its
     own floor, with its own material, so the interior reads as the set of
     rooms it actually is. */
  const ROOM_STYLE = {
    bedroom:     { floor: '#7a5f52', pattern: 'planks' },
    apartment:   { floor: '#7a6152', pattern: 'planks' },
    bathroom:    { floor: '#b9c6cc', pattern: 'tile' },
    washroom:    { floor: '#b3c2c8', pattern: 'tile' },
    kitchen:     { floor: '#9aa0a6', pattern: 'tile' },
    backKitchen: { floor: '#8e959c', pattern: 'tile' },
    dining:      { floor: '#8a6a4a', pattern: 'planks' },
    diningLobby: { floor: '#8f7050', pattern: 'planks' },
    lounge:      { floor: '#6f5a68', pattern: 'planks' },
    lobby:       { floor: '#9c9484', pattern: 'tile' },
    hall:        { floor: '#8d8578', pattern: 'tile' },
    living:      { floor: '#8a6a52', pattern: 'planks' },
    foyer:       { floor: '#a3907a', pattern: 'tile' },
    study:       { floor: '#6a5648', pattern: 'planks' },
    pantry:      { floor: '#8f8a72', pattern: 'tile' },
    opsRoom:     { floor: '#4a5364', pattern: 'metal' },
    briefing:    { floor: '#565f4e', pattern: 'concrete' },
    mess:        { floor: '#6e6a54', pattern: 'tile' },
    radioRoom:   { floor: '#454e5c', pattern: 'metal' },
    motorPool:   { floor: '#4a4f56', pattern: 'concrete' },
    watchPost:   { floor: '#5c604e', pattern: 'concrete' },
    office:      { floor: '#6e6a62', pattern: 'planks' },
    controlRoom: { floor: '#4e5866', pattern: 'metal' },
    classroom:   { floor: '#8a7a5e', pattern: 'planks' },
    staffRoom:   { floor: '#7d6f5c', pattern: 'planks' },
    ward:        { floor: '#c6d2d0', pattern: 'tile' },
    surgery:     { floor: '#cfdcdb', pattern: 'tile' },
    dispensary:  { floor: '#bcc9c7', pattern: 'tile' },
    bunkroom:    { floor: '#5f6450', pattern: 'concrete' },
    cell:        { floor: '#6d737a', pattern: 'concrete' },
    guardRoom:   { floor: '#5f656d', pattern: 'concrete' },
    armoury:     { floor: '#4f5446', pattern: 'metal' },
    stall:       { floor: '#8e7c5c', pattern: 'planks' },
    storeroom:   { floor: '#5a6068', pattern: 'concrete' },
    workbay:     { floor: '#4d545e', pattern: 'metal' },
    gym:         { floor: '#8a6f4e', pattern: 'planks' },
    barn:        { floor: '#6e5a3c', pattern: 'dirt' },
    lodge:       { floor: '#77603f', pattern: 'planks' },
    safe:        { floor: '#5d5a4e', pattern: 'metal' },
    strongroom:  { floor: '#5a5850', pattern: 'metal' },
    mainExhibit: { floor: '#b8b2a6', pattern: 'tile' },
    gunExhibit:  { floor: '#a49d90', pattern: 'tile' },
    displayHall: { floor: '#b0a894', pattern: 'tile' },
    tent:        { floor: '#6a6a4c', pattern: 'dirt' },
    plane:       { floor: '#565f6c', pattern: 'metal' },
    track:       { floor: '#4a4f56', pattern: 'concrete' },
    warehouse:   { floor: '#565e6a', pattern: 'concrete' },
    garage:      { floor: '#4f545c', pattern: 'concrete' },
    tunnel:      { floor: '#3e4147', pattern: 'concrete' },
    passage:     { floor: '#5c5951', pattern: 'concrete' },
    dock:        { floor: '#6a6152', pattern: 'planks' },
    pool:        { floor: '#3f7d96', pattern: 'tile' },
    gate:        { floor: '#5a5f66', pattern: 'concrete' },
    portapotty:  { floor: '#9aa8a4', pattern: 'tile' },
    wheatField:  { floor: '#9a8a44', pattern: 'dirt' },
    chickenCoop: { floor: '#6e5c3c', pattern: 'dirt' },
    parkingLot:  { floor: '#4e5158', pattern: 'concrete' },
    shippedCrate:  { floor: '#4a5460', pattern: 'metal' },
    shippingCrate: { floor: '#48525e', pattern: 'metal' },
  };
  const roomStyleOf = (kind) => ROOM_STYLE[kind] || null;

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

  /* ============================================================
     WHAT A BUILDING IS FOR

     Every building was worth roughly the same and stood roughly anywhere, so
     the map was a field of interchangeable boxes and there was no reason to
     cross it. Each one now has a grade and a place:

       grade  'rich'   gold and silver, and a fight over it
              'medium' worth a detour
              'poor'   somewhere to shelter and reload
       ring   where it belongs, measured from the middle of the island
              'centre' the contested heart
              'mid'    the working belt between
              'edge'   the quiet outskirts
              'spawn'  a team's own base, placed at their corner

     Placement reads these, so the good loot is in the middle where everyone
     can reach it and the quiet buildings are where you land. Risk buys reward
     instead of the two being unrelated.
     ============================================================ */
  const PURPOSE = {
    /* ---- the contested middle: worth dying over ---- */
    vault:        { grade: 'rich', ring: 'centre' },
    bank:         { grade: 'rich', ring: 'centre' },
    armory:       { grade: 'rich', ring: 'centre' },
    museum:       { grade: 'rich', ring: 'centre' },
    'command-center': { grade: 'rich', ring: 'centre' },
    mansion:      { grade: 'rich', ring: 'centre' },
    keep:         { grade: 'rich', ring: 'centre' },
    factory:      { grade: 'rich', ring: 'centre' },
    arena:        { grade: 'rich', ring: 'centre' },
    'radio-tower': { grade: 'medium', ring: 'centre' },
    hospital:     { grade: 'medium', ring: 'centre' },

    /* ---- the working belt ---- */
    harbor:       { grade: 'rich', ring: 'mid' },
    airfield:     { grade: 'rich', ring: 'mid' },
    resort:       { grade: 'rich', ring: 'mid' },
    prison:       { grade: 'medium', ring: 'mid' },
    warehouse:    { grade: 'medium', ring: 'mid' },
    workshop:     { grade: 'medium', ring: 'mid' },
    'power-plant': { grade: 'medium', ring: 'mid' },
    barracks:     { grade: 'medium', ring: 'mid' },
    fortress:     { grade: 'medium', ring: 'mid' },
    silos:        { grade: 'medium', ring: 'mid' },
    school:       { grade: 'medium', ring: 'mid' },
    library:      { grade: 'medium', ring: 'mid' },
    church:       { grade: 'medium', ring: 'mid' },
    market:       { grade: 'medium', ring: 'mid' },
    'train-station': { grade: 'medium', ring: 'mid' },
    subway:       { grade: 'medium', ring: 'mid' },
    mine:         { grade: 'medium', ring: 'mid' },
    hangar:       { grade: 'medium', ring: 'mid' },
    dock:         { grade: 'medium', ring: 'mid' },
    depot:        { grade: 'medium', ring: 'mid' },
    apartments:   { grade: 'medium', ring: 'mid' },
    garage:       { grade: 'medium', ring: 'mid' },
    'bridge-fort': { grade: 'medium', ring: 'mid' },
    'gas-station': { grade: 'poor', ring: 'mid' },

    /* ---- the quiet outskirts: where you land and gear up ---- */
    house:        { grade: 'poor', ring: 'edge' },
    shanty:       { grade: 'poor', ring: 'edge' },
    farm:         { grade: 'poor', ring: 'edge' },
    camp:         { grade: 'poor', ring: 'edge' },
    campground:   { grade: 'poor', ring: 'edge' },
    clinic:       { grade: 'poor', ring: 'edge' },
    watermill:    { grade: 'poor', ring: 'edge' },
    tower:        { grade: 'poor', ring: 'edge' },
    checkpoint:   { grade: 'poor', ring: 'edge' },
    bunker:       { grade: 'poor', ring: 'edge' },
    /* Worth the walk down: the magazine at the bottom holds a chest. */
    'bunker-complex': { grade: 'rich', ring: 'mid' },

    /* ---- one per team, at their spawn ---- */
    base:         { grade: 'medium', ring: 'spawn' },
  };
  const purposeOf = (name) => PURPOSE[name] || { grade: 'medium', ring: 'mid' };

  /* How far from the middle each ring sits, as a fraction of the distance
     from centre to corner. Bands overlap a little so the map doesn't read as
     three concentric circles. */
  const RINGS = {
    centre: [0.00, 0.42],
    mid:    [0.30, 0.76],
    edge:   [0.62, 1.00],
    spawn:  [0.80, 1.00],
  };

  /* What a grade is worth, applied on top of a room's own table. A rich
     building upgrades some of its crates; a poor one downgrades them. */
  const GRADE_LOOT = {
    rich:   { upgrade: 0.45, extra: 0.30 },
    medium: { upgrade: 0.15, extra: 0.10 },
    poor:   { upgrade: 0.00, extra: 0.00, downgrade: 0.35 },
  };

  /* ============================================================
     WHAT STANDS OUTSIDE A BUILDING

     The clutter round a building used to be picked from five category
     buckets, so a hospital and a church both got bushes and traffic cones and
     every industrial building got the same barrels. From outside you could
     not tell a farm from a factory until you were close enough to read the
     roof.

     Each building names its own. This is the ground you fight across on the
     way in, so it is also a label: hay bales and stumps mean a farm, shipping
     containers mean a harbour, sandbags and ammo crates mean somebody
     military lives here.

     `props` are what gets scattered; `weight` biases the roll toward the
     first entries, so the first one or two read as the building's signature
     and the rest are texture.
     ============================================================ */
  const DECOR = {
    'bunker-complex': ['sandpile', 'sandpile', 'crate', 'ammoBox', 'rubble'],
    /* ---- residential: gardens, washing lines, firewood ---- */
    house:        ['bush', 'bush', 'stump', 'plant', 'crate'],
    mansion:      ['plant', 'plant', 'bush', 'bush', 'cone'],
    shanty:       ['rubble', 'rubble', 'tyre', 'pallet', 'crate'],
    apartments:   ['bush', 'crate', 'rubble', 'cone', 'plant'],
    clinic:       ['bush', 'plant', 'cone', 'crate'],
    watermill:    ['stump', 'bush', 'barrel', 'pallet', 'crate'],

    /* ---- rural ---- */
    farm:         ['stump', 'stump', 'pallet', 'bush', 'barrel', 'crate'],
    camp:         ['tent', 'stump', 'bush', 'crate', 'rubble'],
    campground:   ['tent', 'tent', 'stump', 'bush', 'crate'],

    /* ---- industrial: pallets, drums, tyres, steel ---- */
    warehouse:    ['pallet', 'pallet', 'crate', 'barrel', 'tyre'],
    factory:      ['barrel', 'barrel', 'pallet', 'rubble', 'container'],
    workshop:     ['tyre', 'tyre', 'barrel', 'pallet', 'ammoBox'],
    garage:       ['tyre', 'tyre', 'tyre', 'barrel', 'cone', 'pallet'],
    depot:        ['crate', 'pallet', 'barrel', 'container', 'tyre'],
    'power-plant': ['barrel', 'container', 'rubble', 'cone', 'pallet'],
    silos:        ['barrel', 'pallet', 'crate', 'stump'],
    mine:         ['rock', 'rock', 'rubble', 'stump', 'barrel', 'pallet'],

    /* ---- maritime and air ---- */
    dock:         ['container', 'container', 'crate', 'pallet', 'barrel'],
    harbor:       ['container', 'container', 'container', 'pallet', 'crate', 'tyre'],
    hangar:       ['cone', 'cone', 'tyre', 'barrel', 'pallet'],
    airfield:     ['cone', 'cone', 'cone', 'tyre', 'crate', 'antenna'],

    /* ---- institutional: kept grounds, signs, a little decay ---- */
    hospital:     ['bush', 'plant', 'cone', 'sign', 'crate'],
    school:       ['bush', 'bush', 'sign', 'crate', 'cone'],
    church:       ['bush', 'stump', 'plant', 'sign'],
    library:      ['bush', 'plant', 'sign', 'crate'],
    museum:       ['plant', 'plant', 'bush', 'sign', 'cone'],
    bank:         ['plant', 'cone', 'sign', 'bush'],
    prison:       ['sandpile', 'rubble', 'cone', 'crate', 'tyre'],
    vault:        ['sandpile', 'rubble', 'cone', 'crate'],
    'train-station': ['crate', 'pallet', 'sign', 'bush', 'container'],
    subway:       ['rubble', 'rubble', 'sign', 'crate', 'cone'],
    market:       ['crate', 'crate', 'pallet', 'plant', 'barrel'],
    'gas-station': ['barrel', 'barrel', 'tyre', 'cone', 'sign'],

    /* ---- military: sandbags, ammunition, wire-adjacent clutter ---- */
    base:         ['sandpile', 'sandpile', 'ammoBox', 'crate', 'tyre'],
    barracks:     ['sandpile', 'ammoBox', 'crate', 'tyre', 'pallet'],
    armory:       ['ammoBox', 'ammoBox', 'sandpile', 'crate', 'barrel'],
    bunker:       ['sandpile', 'sandpile', 'rubble', 'ammoBox'],
    fortress:     ['sandpile', 'rubble', 'rock', 'ammoBox', 'crate'],
    keep:         ['rock', 'rubble', 'sandpile', 'crate'],
    checkpoint:   ['sandpile', 'cone', 'cone', 'ammoBox', 'tyre'],
    tower:        ['sandpile', 'crate', 'ammoBox', 'stump'],
    'bridge-fort': ['sandpile', 'rubble', 'cone', 'ammoBox'],
    'command-center': ['antenna', 'antenna', 'sandpile', 'ammoBox', 'cone'],
    'radio-tower': ['antenna', 'antenna', 'crate', 'rubble', 'sandpile'],
    arena:        ['crate', 'barrel', 'cone', 'sign', 'rubble'],
    resort:       ['plant', 'plant', 'bush', 'palm', 'cone'],
  };
  const DEFAULT_DECOR = ['crate', 'rubble', 'bush'];
  const decorFor = (name) => DECOR[name] || DEFAULT_DECOR;

  /* ---------- how many of each the map must have ----------
     The design table gives exact counts, not weights: a map has five houses
     and exactly one mansion, whatever the dice say. Everything outside this
     list is still rolled procedurally to fill the space around them. */
  /* The buildings a map must have, and how many of each.

     Everything below the first line was being rolled for rather than
     required, and on a map this size that meant never built. Measured over
     six generated maps, the procedural pass placed three or four buildings
     each — the required buildings, the four team bases and the landmarks take
     their ground first, and what is left is small gaps rather than open
     ground, so only small buildings ever fitted into them. Across those six
     maps the garage, the workshop, the hangar and the filling station were
     built exactly zero times between them, which makes the vehicle doors they
     were given decoration nobody would ever see. They are the four buildings
     you can drive into, so they are worth requiring. */
  const ROOM_BUILDINGS = [
    ['house', 5], ['mansion', 1], ['resort', 1], ['airfield', 1],
    ['harbor', 1], ['museum', 1], ['campground', 2], ['farm', 2],
    ['garage', 1], ['workshop', 1], ['gas-station', 1], ['hangar', 1],
    /* The only underground route on the map, so leaving it to a weighted roll
       meant most maps had no tunnel on them at all. */
    ['bunker-complex', 1],
  ];

  const BUILDING_CATEGORIES = {
    tactical: ['tower', 'checkpoint', 'bunker', 'bunker-complex', 'bridge-fort', 'keep'],
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
    BUILDING_SCALE, scaleFor, STYLE, styleOf, shadeStyle, ROOM_STYLE, roomStyleOf, BUILDING_EFFECTS, effectOf, secretDoor, FIND_SECRET, hallway, partition, roomGrid, floorPlan, ROOM_SIZE, tunnel, columnGrid, splitLong, WALL_T, ZONE, zoneOf, BAY,
    PURPOSE, purposeOf, RINGS, GRADE_LOOT, basement, DECOR, decorFor,
    ROOM_LOOT, ROOM_BUILDINGS, room,
    def, maxHp, toughness, ballistics, blocksSight, blocksMove, isDoor, seg, shell,
    /* place a named building and tag every piece with it. `rooms` rides along
       on the returned array — blueprints that don't declare any simply don't
       have the property, so every older blueprint is untouched. */
    place(name, ox, oy) {
      const parts = BUILDINGS[name](ox, oy);
      /* A room declared as one long strip is divided into the rooms it should
         have been, with partitions and doorways between them. Several
         blueprints wrote a single rect where a building would have three
         rooms — a 784 by 117 store is a corridor somebody put shelves in —
         because one rect is easier to write than working out where the walls
         go. Done here rather than in each blueprint so it holds for all of
         them, and before the placement is scaled so the new walls scale with
         everything else. */
      if (parts.rooms && parts.rooms.length) {
        const wallType = commonestWall(parts);
        const kept = [], added = [];
        for (const r of parts.rooms) {
          const asp = Math.max(r.w, r.h) / Math.max(1, Math.min(r.w, r.h));
          if (r.basement || OPEN_ROOMS.has(r.kind) || asp <= 3.0) { kept.push(r); continue; }
          const sp = splitLong(wallType, r, { aspect: 1.8 });
          added.push(...sp.parts);
          for (const nr of sp.rooms) { nr.dark = r.dark; nr.basement = r.basement; kept.push(nr); }
        }
        if (added.length) parts.push(...added);
        parts.rooms = kept;
      }
      scalePlacement(parts, ox, oy, scaleFor(parts));
      parts.forEach(p => { p.building = name; });
      if (parts.rooms) parts.rooms.forEach(r => { r.building = name; });
      return parts;
    },
  };
})();
