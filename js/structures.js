/* ============================================================
   structures.js — wall types, their ballistics, and the buildings
   the map is made out of.

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
      fill: '#6d5334', stroke: 'rgba(240,198,132,0.85)',
      effect: 'Bullets lose 10% damage per 0.1 thickness',
    },
    metal: {
      name: 'Metal', height: 'high', hpPerThickness: 20, toughness: 4,
      bullets: 'pen', lossPerM: 1.0, reflectAbove: 0.5,
      fill: '#546480', stroke: 'rgba(210,228,255,0.85)',
      effect: 'Penetrable up to 0.5 thickness, then ricochets for 50%',
    },
    door: {
      name: 'Door', height: 'high', hp: 90, toughness: 1, door: true,
      bullets: 'pen', lossPerM: 1.0,            // it's wood, 0.3 thick
      defThickness: 0.3, defLength: 1.5,
      fill: '#7d5c31', stroke: 'rgba(255,210,140,0.9)',
      effect: 'Opens and closes',
    },
    rdoor: {
      name: 'Reinforced Door', height: 'high', hp: 300, toughness: 5, door: true,
      bullets: 'reflect', defThickness: 0.35, defLength: 1.5,
      fill: '#5d6b82', stroke: 'rgba(225,238,255,0.9)',
      effect: 'Opens and closes · bullets ricochet for 50%',
    },
    rwall: {
      name: 'Reinforced Wall', height: 'high', hp: 300, toughness: 5,
      bullets: 'reflect',
      fill: '#58657d', stroke: 'rgba(220,235,255,0.85)',
      effect: 'Bullets ricochet for 50%',
    },
    wire: {
      name: 'Barbed Wire', height: 'low', hp: 60, toughness: 5,
      bullets: 'through', passable: true, slow: 0.1, dps: 2,
      fill: 'rgba(190,205,235,0.14)', stroke: 'rgba(235,245,255,0.8)',
      effect: '90% movement slowdown · 2 damage/s',
    },
    sandbag: {
      name: 'Sand Bags', height: 'low', hp: 300, toughness: 6,
      bullets: 'stop',
      fill: '#6b6236', stroke: 'rgba(240,224,150,0.8)',
      effect: 'Stops bullets outright',
    },
    barricade: {
      name: 'Barricade', height: 'low', hp: 150, toughness: 1,
      bullets: 'pen', flatLoss: 0.5,
      fill: '#63526f', stroke: 'rgba(214,150,255,0.75)',
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
      fill: '#8a6234', stroke: '#5e4222',
      effect: 'Breaks open and spills loot',
    },
    barrel: {
      name: 'Barrel', height: 'low', hp: 70, toughness: 1, prop: 'barrel',
      bullets: 'stop', explodes: { damage: 85, radius: 165 },
      fill: '#a2542e', stroke: '#6f3719',
      effect: 'Cooks off when destroyed — and sets off its neighbours',
    },
    tree: {
      name: 'Tree', height: 'high', hp: 160, toughness: 2, prop: 'tree',
      bullets: 'stop', round: true, drops: null,
      fill: '#4a8f3c', stroke: '#33682a',
      effect: 'Blocks sight and gunfire until it comes down',
    },
    rock: {
      name: 'Boulder', height: 'low', hp: 400, toughness: 4, prop: 'rock',
      bullets: 'stop', round: true,
      fill: '#8792a5', stroke: '#5d6675',
      effect: 'Hard cover — takes HEAT or a hammer',
    },
    container: {
      name: 'Container', height: 'high', hp: 500, toughness: 4, prop: 'container',
      bullets: 'reflect',
      fill: '#3f7ea8', stroke: '#28536f',
      effect: 'Steel box: bullets ricochet off it',
    },
    bush: {
      name: 'Bush', height: 'low', hp: 40, toughness: 1, prop: 'bush',
      bullets: 'through', passable: true, conceals: true, round: true,
      fill: 'rgba(74,143,60,0.35)', stroke: 'rgba(51,104,42,0.6)',
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
