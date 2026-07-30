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
      fill: '#3b2c1b', stroke: 'rgba(214,164,94,0.55)',
      effect: 'Bullets lose 10% damage per 0.1 thickness',
    },
    metal: {
      name: 'Metal', height: 'high', hpPerThickness: 20, toughness: 4,
      bullets: 'pen', lossPerM: 1.0, reflectAbove: 0.5,
      fill: '#2b3444', stroke: 'rgba(180,200,230,0.6)',
      effect: 'Penetrable up to 0.5 thickness, then ricochets for 50%',
    },
    door: {
      name: 'Door', height: 'high', hp: 90, toughness: 1, door: true,
      bullets: 'pen', lossPerM: 1.0,            // it's wood, 0.3 thick
      defThickness: 0.3, defLength: 1.5,
      fill: '#4a3620', stroke: 'rgba(226,180,110,0.7)',
      effect: 'Opens and closes',
    },
    rdoor: {
      name: 'Reinforced Door', height: 'high', hp: 300, toughness: 5, door: true,
      bullets: 'reflect', defThickness: 0.35, defLength: 1.5,
      fill: '#37404f', stroke: 'rgba(200,215,240,0.75)',
      effect: 'Opens and closes · bullets ricochet for 50%',
    },
    rwall: {
      name: 'Reinforced Wall', height: 'high', hp: 300, toughness: 5,
      bullets: 'reflect',
      fill: '#333c4a', stroke: 'rgba(200,215,240,0.7)',
      effect: 'Bullets ricochet for 50%',
    },
    wire: {
      name: 'Barbed Wire', height: 'low', hp: 60, toughness: 5,
      bullets: 'through', passable: true, slow: 0.1, dps: 2,
      fill: 'rgba(150,165,195,0.10)', stroke: 'rgba(210,220,240,0.55)',
      effect: '90% movement slowdown · 2 damage/s',
    },
    sandbag: {
      name: 'Sand Bags', height: 'low', hp: 300, toughness: 6,
      bullets: 'stop',
      fill: '#3a3520', stroke: 'rgba(220,200,120,0.45)',
      effect: 'Stops bullets outright',
    },
    barricade: {
      name: 'Barricade', height: 'low', hp: 150, toughness: 1,
      bullets: 'pen', flatLoss: 0.5,
      fill: '#3a3040', stroke: 'rgba(196,107,255,0.4)',
      effect: 'Bullets lose 50% damage passing through',
    },
    trench: {
      name: 'Trench', height: 'under', hp: 1, toughness: 6,
      bullets: 'through', passable: true, dodge: 0.5,
      fill: 'rgba(90,66,40,0.45)', stroke: 'rgba(176,138,90,0.5)',
      effect: 'Infantry inside dodge 50% of incoming fire',
    },
  };

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

  /* ---------- DECOR ----------
     Pure dressing: never collides, never blocks a bullet or line of sight.
     It exists so the map reads as a place rather than a set of rectangles.
     `r` is the draw radius; `shadow` is how far its shadow is thrown. */
  const DECOR = {
    crate:   { icon: '📦', r: 13, shadow: 5,  tint: '#6b5636' },
    barrel:  { icon: '🛢️', r: 12, shadow: 5,  tint: '#4a5560' },
    tree:    { icon: '🌲', r: 22, shadow: 11, tint: '#2f5b3a' },
    palm:    { icon: '🌴', r: 22, shadow: 11, tint: '#3a5b2f' },
    bush:    { icon: '🌿', r: 15, shadow: 4,  tint: '#3d6b42' },
    rock:    { icon: '🪨', r: 15, shadow: 6,  tint: '#5a5f6b' },
    rubble:  { icon: '🧱', r: 12, shadow: 4,  tint: '#5c4a3f' },
    pallet:  { icon: '🪵', r: 13, shadow: 3,  tint: '#6b5636' },
    tyre:    { icon: '⚫', r: 11, shadow: 3,  tint: '#2a2d33' },
    cone:    { icon: '🔺', r: 10, shadow: 3,  tint: '#c25c1e' },
    antenna: { icon: '📡', r: 16, shadow: 7,  tint: '#5a6675' },
    sign:    { icon: '🪧', r: 13, shadow: 5,  tint: '#6b6250' },
  };
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
    WALL_TYPES, BUILDINGS, DECOR, scatter, PX_PER_M, HP_SCALE,
    def, maxHp, toughness, ballistics, blocksSight, blocksMove, isDoor, seg, shell,
    /* place a named building and tag every piece with it */
    place(name, ox, oy) {
      const parts = BUILDINGS[name](ox, oy);
      parts.forEach(p => { p.building = name; });
      return parts;
    },
  };
})();
