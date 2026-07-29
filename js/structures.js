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
  const HP_SCALE = 10;
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
      name: 'Door', height: 'high', hp: 30, toughness: 1, door: true,
      bullets: 'pen', lossPerM: 1.0,            // it's wood, 0.3 thick
      defThickness: 0.3, defLength: 1.5,
      fill: '#4a3620', stroke: 'rgba(226,180,110,0.7)',
      effect: 'Opens and closes',
    },
    rdoor: {
      name: 'Reinforced Door', height: 'high', hp: 100, toughness: 5, door: true,
      bullets: 'reflect', defThickness: 0.35, defLength: 1.5,
      fill: '#37404f', stroke: 'rgba(200,215,240,0.75)',
      effect: 'Opens and closes · bullets ricochet for 50%',
    },
    rwall: {
      name: 'Reinforced Wall', height: 'high', hp: 100, toughness: 5,
      bullets: 'reflect',
      fill: '#333c4a', stroke: 'rgba(200,215,240,0.7)',
      effect: 'Bullets ricochet for 50%',
    },
    wire: {
      name: 'Barbed Wire', height: 'low', hp: 30, toughness: 5,
      bullets: 'through', passable: true, slow: 0.1, dps: 2,
      fill: 'rgba(150,165,195,0.10)', stroke: 'rgba(210,220,240,0.55)',
      effect: '90% movement slowdown · 2 damage/s',
    },
    sandbag: {
      name: 'Sand Bags', height: 'low', hp: 100, toughness: 6,
      bullets: 'stop',
      fill: '#3a3520', stroke: 'rgba(220,200,120,0.45)',
      effect: 'Stops bullets outright',
    },
    barricade: {
      name: 'Barricade', height: 'low', hp: 50, toughness: 1,
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

  return {
    WALL_TYPES, BUILDINGS, PX_PER_M, HP_SCALE,
    def, maxHp, toughness, ballistics, blocksSight, blocksMove, isDoor, seg, shell,
    /* place a named building and tag every piece with it */
    place(name, ox, oy) {
      const parts = BUILDINGS[name](ox, oy);
      parts.forEach(p => { p.building = name; });
      return parts;
    },
  };
})();
