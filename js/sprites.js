/* ============================================================
   sprites.js — the game's art, drawn as vectors.

   Everything used to be an emoji, which looked like a mixed bag of
   fonts and rendered differently on every machine. This replaces the
   lot with hand-drawn canvas sprites in a consistent top-down style:
   flat fills, a darker outline, one light source, simple shapes.

   Nothing is loaded from disk or the network — every sprite is a few
   canvas paths, so the game stays a zero-asset static site and looks
   identical everywhere.

   Each sprite is drawn centred on (0,0) at a nominal radius of `r`,
   with the caller handling translate/rotate/scale.
   ============================================================ */
const Sprites = (() => {

  /* shared palette so everything feels like one set (survev.io-inspired) */
  const P = {
    /* wood: warm, readable, slightly worn */
    wood: '#9a7542', woodDark: '#6b5231', woodLight: '#c49060',
    /* vegetation: saturated greens for visibility */
    leaf: '#5ab947', leafDark: '#2d7a1a', leafLight: '#7cd347',
    /* stone: neutral grays with subtle warmth */
    stone: '#9ca5b5', stoneDark: '#6a7382', stoneLight: '#b8c2d2',
    /* metal: cool, gunmetal appearance */
    metal: '#6b7f99', metalDark: '#3d4f68', metalLight: '#9bacc9',
    /* rust: oxidized metal, distinctive */
    rust: '#c25e3a', rustDark: '#7a3a1f',
    /* sand: warm, visible against grass */
    sand: '#e8c76d', sandDark: '#b89d47',
    /* cloth/fabric: survev-style muted blue */
    cloth: '#5a7190', clothDark: '#2f4052',
    /* fire/hot: bright warning color */
    hot: '#ff6b35', hotDark: '#cc4422',
    /* shadows: subtle depth */
    dark: 'rgba(0,0,0,0.40)',
  };

  /* helper: filled path with a darker outline, the look of the whole set */
  function shape(ctx, fill, stroke, lw) {
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function circle(ctx, x, y, r, fill, stroke, lw) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); shape(ctx, fill, stroke, lw);
  }
  function box(ctx, x, y, w, h, fill, stroke, lw, rad) {
    const r = rad === undefined ? 2 : rad;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    shape(ctx, fill, stroke, lw, r);
  }

  /* ---------- the sprites ----------
     Signature is always (ctx, r) with the transform already applied. */
  const DRAW = {
    /* a tree from above: dense canopy with dark shadow base for depth */
    tree(ctx, r) {
      circle(ctx, 0, 0, r * 0.35, P.woodDark, null);        // trunk
      circle(ctx, -r * 0.18, -r * 0.14, r * 0.78, P.leafDark, null);   // back shadow
      circle(ctx, r * 0.16, r * 0.12, r * 0.70, P.leaf, P.leafDark, 2.5);  // main canopy
      circle(ctx, -r * 0.20, -r * 0.26, r * 0.32, P.leafLight, null);  // highlight
      circle(ctx, r * 0.24, r * 0.20, r * 0.18, P.leafLight, null);    // rim light
    },
    /* palm: a starburst of fronds */
    palm(ctx, r) {
      circle(ctx, 0, 0, r * 0.22, P.woodDark, null);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        ctx.save(); ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(r * 0.52, 0, r * 0.50, r * 0.20, 0, 0, Math.PI * 2);
        shape(ctx, i % 2 ? P.leaf : P.leafDark, P.leafDark, 1.5);
        ctx.restore();
      }
      circle(ctx, 0, 0, r * 0.20, P.woodLight, P.woodDark, 1.5);
    },
    /* low scrub: a cluster of small blobs */
    bush(ctx, r) {
      circle(ctx, -r * 0.30, r * 0.10, r * 0.52, P.leafDark, null);
      circle(ctx, r * 0.28, r * 0.16, r * 0.46, P.leafDark, null);
      circle(ctx, 0, -r * 0.16, r * 0.60, P.leaf, P.leafDark, 2);
      circle(ctx, -r * 0.18, -r * 0.30, r * 0.22, P.leafLight, null);
    },
    /* boulder: irregular polygon with strong shading for tactical clarity */
    rock(ctx, r) {
      ctx.beginPath();
      const pts = [[-0.9, -0.2], [-0.55, -0.8], [0.2, -0.95], [0.85, -0.4],
                   [0.9, 0.35], [0.35, 0.9], [-0.45, 0.8], [-0.9, 0.3]];
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px * r, py * r) : ctx.moveTo(px * r, py * r)));
      ctx.closePath();
      shape(ctx, P.stone, P.stoneDark, 3);  // thicker outline for visibility
      // large highlight on top-left for depth perception
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, -r * 0.40); ctx.lineTo(r * 0.15, -r * 0.60); ctx.lineTo(r * 0.30, -r * 0.05);
      ctx.closePath();
      shape(ctx, P.stoneLight, null);
      // smaller rim light
      circle(ctx, r * 0.45, r * 0.35, r * 0.12, P.stoneLight, null);
    },
    /* wooden crate: planks and a cross brace */
    crate(ctx, r) {
      box(ctx, -r, -r, r * 2, r * 2, P.wood, P.woodDark, 2.5, 3);
      ctx.strokeStyle = P.woodDark; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.33); ctx.lineTo(r, -r * 0.33);
      ctx.moveTo(-r, r * 0.33); ctx.lineTo(r, r * 0.33);
      ctx.stroke();
      ctx.strokeStyle = P.woodLight; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-r * 0.8, -r * 0.8); ctx.lineTo(r * 0.8, r * 0.8); ctx.stroke();
    },
    /* oil drum: survev-style explosive hazard, immediately recognizable */
    barrel(ctx, r) {
      circle(ctx, 0, 0, r, P.rust, P.rustDark, 3);  // outer rim, thicker
      circle(ctx, 0, 0, r * 0.68, P.metal, P.metalDark, 2);  // band
      circle(ctx, 0, 0, r * 0.25, P.metalDark, null);  // center cap
      circle(ctx, -r * 0.35, -r * 0.35, r * 0.20, P.metalLight, null);  // highlight
      // warning stripe across top
      ctx.strokeStyle = P.hotDark; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-r * 0.8, -r * 0.2); ctx.lineTo(r * 0.8, r * 0.2); ctx.stroke();
    },
    /* stack of planks */
    pallet(ctx, r) {
      box(ctx, -r, -r * 0.7, r * 2, r * 1.4, P.woodDark, P.woodDark, 2, 2);
      ctx.fillStyle = P.wood;
      for (let i = 0; i < 4; i++) ctx.fillRect(-r * 0.92, -r * 0.6 + i * r * 0.35, r * 1.84, r * 0.22);
    },
    /* tyre */
    tyre(ctx, r) {
      circle(ctx, 0, 0, r, '#2c2f36', '#1a1c21', 2);
      circle(ctx, 0, 0, r * 0.45, '#464b55', '#1a1c21', 1.5);
    },
    /* traffic cone */
    cone(ctx, r) {
      box(ctx, -r * 0.9, -r * 0.9, r * 1.8, r * 1.8, P.hotDark, null, 0, 3);
      circle(ctx, 0, 0, r * 0.72, P.hot, P.hotDark, 2);
      circle(ctx, 0, 0, r * 0.32, '#f6f1e6', P.hotDark, 1.5);
    },
    /* broken masonry */
    rubble(ctx, r) {
      circle(ctx, -r * 0.35, r * 0.2, r * 0.44, P.stoneDark, null);
      box(ctx, -r * 0.1, -r * 0.7, r * 0.85, r * 0.6, '#9a5f4a', '#6d3f2f', 2, 2);
      box(ctx, -r * 0.85, -r * 0.25, r * 0.7, r * 0.5, '#8c5744', '#6d3f2f', 2, 2);
      circle(ctx, r * 0.45, r * 0.45, r * 0.3, P.stone, P.stoneDark, 1.5);
    },
    /* radio mast seen from above */
    antenna(ctx, r) {
      ctx.strokeStyle = P.metalDark; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke();
      }
      circle(ctx, 0, 0, r * 0.4, P.metal, P.metalDark, 2);
      circle(ctx, 0, 0, r * 0.16, '#ff5a5a', null);
    },
    /* signboard */
    sign(ctx, r) {
      box(ctx, -r * 0.85, -r * 0.6, r * 1.7, r * 1.2, '#c9b47e', '#6f6146', 2.5, 2);
      ctx.fillStyle = '#6f6146';
      ctx.fillRect(-r * 0.55, -r * 0.28, r * 1.1, r * 0.16);
      ctx.fillRect(-r * 0.55, r * 0.06, r * 0.7, r * 0.16);
    },
    /* canvas tent */
    tent(ctx, r) {
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(r, r * 0.8); ctx.lineTo(-r, r * 0.8);
      ctx.closePath(); shape(ctx, P.cloth, P.clothDark, 2.5);
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(0, r * 0.8);
      ctx.strokeStyle = P.clothDark; ctx.lineWidth = 2; ctx.stroke();
    },
    /* sandbag pile */
    sandpile(ctx, r) {
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.translate((i - 1) * r * 0.5, (i % 2) * r * 0.25 - r * 0.1);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.52, r * 0.34, 0.2, 0, Math.PI * 2);
        shape(ctx, i % 2 ? P.sand : P.sandDark, P.sandDark, 1.8);
        ctx.restore();
      }
    },
    /* shipping container */
    container(ctx, r) {
      box(ctx, -r * 1.3, -r * 0.8, r * 2.6, r * 1.6, '#3f7ea8', '#28536f', 2.5, 2);
      ctx.strokeStyle = '#28536f'; ctx.lineWidth = 1.4;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.36, -r * 0.75); ctx.lineTo(i * r * 0.36, r * 0.75); ctx.stroke();
      }
    },
    /* ---------- interior furniture ---------- */
    table(ctx, r) {
      box(ctx, -r, -r * 0.65, r * 2, r * 1.3, P.wood, P.woodDark, 2.5, 3);
      ctx.strokeStyle = P.woodDark; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.6); ctx.lineTo(-r * 0.55, r * 0.6);
      ctx.moveTo(r * 0.55, -r * 0.6); ctx.lineTo(r * 0.55, r * 0.6);
      ctx.stroke();
    },
    shelf(ctx, r) {
      box(ctx, -r, -r * 0.45, r * 2, r * 0.9, P.woodDark, '#3a2916', 2, 2);
      ctx.fillStyle = P.wood;
      for (let i = 0; i < 3; i++) ctx.fillRect(-r * 0.9, -r * 0.34 + i * r * 0.28, r * 1.8, r * 0.16);
    },
    locker(ctx, r) {
      box(ctx, -r * 0.7, -r, r * 1.4, r * 2, P.metal, P.metalDark, 2.5, 2);
      ctx.strokeStyle = P.metalDark; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(0, r * 0.9); ctx.stroke();
      circle(ctx, -r * 0.2, 0, r * 0.1, P.metalLight, null);
      circle(ctx, r * 0.2, 0, r * 0.1, P.metalLight, null);
    },
    bed(ctx, r) {
      box(ctx, -r * 0.7, -r, r * 1.4, r * 2, '#6d5334', '#3a2916', 2.5, 3);
      box(ctx, -r * 0.6, -r * 0.9, r * 1.2, r * 0.7, '#c9d4e6', '#8a97ad', 2, 3);
      box(ctx, -r * 0.6, -r * 0.1, r * 1.2, r * 1.0, '#5b6d8a', '#3f4d63', 2, 3);
    },
    stove(ctx, r) {
      box(ctx, -r * 0.85, -r * 0.85, r * 1.7, r * 1.7, P.metalDark, '#2c333d', 2.5, 3);
      for (const [dx, dy] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) {
        circle(ctx, dx * r, dy * r, r * 0.22, '#2c333d', P.metalLight, 1.5);
      }
    },
    /* a structural post seen from above: a squat column with a base ring */
    post(ctx, r) {
      circle(ctx, 0, 0, r * 0.95, 'rgba(0,0,0,0.18)', null);
      circle(ctx, 0, 0, r * 0.78, P.stoneDark, '#3f4652', 2);
      circle(ctx, 0, 0, r * 0.54, P.stone, null);
      circle(ctx, -r * 0.14, -r * 0.14, r * 0.26, P.stoneLight, null);
    },
    /* a timber pillar: square section, banded */
    pillar(ctx, r) {
      box(ctx, -r * 0.62, -r * 0.62, r * 1.24, r * 1.24, P.woodDark, '#3a2c1c', 2, 3);
      box(ctx, -r * 0.4, -r * 0.4, r * 0.8, r * 0.8, P.wood, null, 0, 2);
      box(ctx, -r * 0.66, -r * 0.14, r * 1.32, r * 0.28, '#4a3a24', null, 0, 2);
    },
    /* a chair from above: seat, back, four legs poking out */
    chair(ctx, r) {
      ctx.globalAlpha = 0.9;
      box(ctx, -r * 0.62, -r * 0.62, r * 1.24, r * 0.22, P.woodDark, '#3e2f1f', 2, 2);   // back
      ctx.globalAlpha = 1;
      box(ctx, -r * 0.55, -r * 0.4, r * 1.1, r * 1.0, P.wood, '#4a3722', 2, 3);          // seat
      for (const [sx, sy] of [[-0.44, -0.28], [0.44, -0.28], [-0.44, 0.44], [0.44, 0.44]]) {
        circle(ctx, r * sx, r * sy, r * 0.09, '#3e2f1f', null);
      }
    },
    /* a potted plant: terracotta pot, three fronds */
    plant(ctx, r) {
      circle(ctx, 0, 0, r * 0.92, 'rgba(45,122,26,0.30)', null);
      for (let i = 0; i < 5; i++) {
        const a2 = (i / 5) * Math.PI * 2 + 0.3;
        ctx.save(); ctx.rotate(a2);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.5, r * 0.26, r * 0.52, 0, 0, Math.PI * 2);
        shape(ctx, i % 2 ? P.leaf : P.leafDark, null, 0);
        ctx.restore();
      }
      circle(ctx, 0, 0, r * 0.42, P.rust, P.rustDark, 2);
      circle(ctx, 0, 0, r * 0.28, '#4a2f1a', null);
    },
    /* a floor lamp seen from above: shade, and the pool of light it throws
       (the glow itself is drawn by the lighting pass, not here) */
    lamp(ctx, r) {
      circle(ctx, 0, 0, r * 0.95, 'rgba(255,214,130,0.16)', null);
      circle(ctx, 0, 0, r * 0.62, '#ffdf9a', '#c9a24a', 2);
      circle(ctx, 0, 0, r * 0.26, '#fff6de', null);
      for (const [sx, sy] of [[-0.5, 0.5], [0.5, 0.5], [0, -0.6]]) {
        circle(ctx, r * sx, r * sy, r * 0.1, '#7a6338', null);
      }
    },
    /* a wall-mounted strip light, for corridors */
    striplight(ctx, r) {
      box(ctx, -r * 0.9, -r * 0.24, r * 1.8, r * 0.48, '#fff3d2', '#b9a36a', 2, 3);
      box(ctx, -r * 0.7, -r * 0.1, r * 1.4, r * 0.2, '#ffffff', null, 0, 2);
    },
    toilet(ctx, r) {
      box(ctx, -r * 0.5, -r * 0.9, r, r * 0.7, '#e6ecf5', '#a8b4c6', 2, 3);
      ctx.beginPath(); ctx.ellipse(0, r * 0.25, r * 0.55, r * 0.7, 0, 0, Math.PI * 2);
      shape(ctx, '#f2f6fb', '#a8b4c6', 2);
    },
    desk(ctx, r) {
      box(ctx, -r, -r * 0.55, r * 2, r * 1.1, '#4a5568', '#2f3745', 2.5, 3);
      box(ctx, -r * 0.75, -r * 0.35, r * 0.8, r * 0.55, '#26303d', '#1a222c', 1.5, 2);
      circle(ctx, r * 0.45, 0, r * 0.18, '#8a97ad', '#2f3745', 1.5);
    },
    ammoBox(ctx, r) {
      box(ctx, -r * 0.85, -r * 0.6, r * 1.7, r * 1.2, '#4a5a3a', '#2c3722', 2.5, 2);
      ctx.fillStyle = '#c9d48a';
      ctx.fillRect(-r * 0.5, -r * 0.15, r, r * 0.18);
      ctx.strokeStyle = '#2c3722'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-r * 0.85, -r * 0.25); ctx.lineTo(r * 0.85, -r * 0.25); ctx.stroke();
    },

    /* bare stump */
    stump(ctx, r) {
      circle(ctx, 0, 0, r * 0.8, P.wood, P.woodDark, 2.5);
      circle(ctx, 0, 0, r * 0.5, P.woodLight, P.woodDark, 1.5);
      circle(ctx, 0, 0, r * 0.18, P.woodDark, null);
    },
  };

  /* metadata the world uses: draw radius, shadow throw, and whether it's tall */
  /* ---------- how big a thing is ----------
     `r` is the half-width in pixels, and at 40px to the metre it is also a
     statement about the real object. Most of these were drawn to look right
     next to each other rather than measured, and the results did not survive
     contact with a 30px body: a tree was 1.8m across, so it read as a shrub
     and could not hide anybody, and a bush at 1.2m was narrower than the
     player standing in it — which made the concealment it grants something
     you could see straight past.

     Sizes are now taken from the real thing and noted in metres. Trees are
     the striking change: a mature canopy is four to five metres, which is
     nearly four times the footprint it had. */
  const META = {
    tree:      { r: 92, shadow: 26, tall: true },     // 4.6m canopy
    palm:      { r: 84, shadow: 24, tall: true },     // 4.2m fronds
    bush:      { r: 46, shadow: 8 },                  // 2.3m — wide enough to lie up in
    rock:      { r: 34, shadow: 10 },                 // 1.7m boulder
    crate:     { r: 21, shadow: 6 },                  // 1.05m
    barrel:    { r: 13, shadow: 5 },                  // 0.65m drum
    pallet:    { r: 24, shadow: 3 },                  // 1.2m
    tyre:      { r: 15, shadow: 3 },                  // 0.75m
    cone:      { r: 9,  shadow: 2 },                  // 0.45m
    rubble:    { r: 28, shadow: 5 },                  // 1.4m heap
    antenna:   { r: 14, shadow: 10, tall: true },     // 0.7m mast base
    sign:      { r: 17, shadow: 5 },                  // 0.85m board
    tent:      { r: 58, shadow: 12, tall: true },     // 2.9m — you can get inside it
    sandpile:  { r: 40, shadow: 7 },                  // 2.0m heap
    container: { r: 49, shadow: 14, tall: true },     // 2.44m across (see PROP_BOX)
    stump:     { r: 17, shadow: 3 },                  // 0.85m
    table:     { r: 31, shadow: 4 },
    shelf:     { r: 34, shadow: 4 },
    locker:    { r: 25, shadow: 6, tall: true },
    bed:       { r: 34, shadow: 4 },
    stove:     { r: 28, shadow: 5 },
    toilet:    { r: 21, shadow: 4 },
    desk:      { r: 31, shadow: 4 },
    ammoBox:   { r: 22, shadow: 4 },
    post:      { r: 15, shadow: 8, tall: true },
    pillar:    { r: 17, shadow: 9, tall: true },
    chair:     { r: 17, shadow: 3 },
    plant:     { r: 20, shadow: 4 },
    lamp:      { r: 16, shadow: 3, light: 190 },      // light = glow radius in px
    striplight: { r: 22, shadow: 2, light: 150 },
  };

  /* Things that are not square. A shipping container is 2.44m by 6.06m and a
     bed is 1m by 2m; drawing them inside a square box made the container a
     cube and cost the bed its shape. The numbers are the footprint in pixels;
     the sprite still draws from `r`, this is what the collision box uses. */
  const PROP_BOX = {
    container: { w: 98, h: 242 },
    tent:      { w: 96, h: 116 },
    bed:       { w: 42, h: 82 },
    shelf:     { w: 72, h: 26 },
    desk:      { w: 64, h: 34 },
    locker:    { w: 38, h: 22 },
    pallet:    { w: 48, h: 40 },
    sign:      { w: 34, h: 12 },
  };

  const kinds = Object.keys(META);
  const has = (k) => !!DRAW[k];

  /* draw one sprite at a world position */
  function draw(ctx, kind, x, y, scale, rot) {
    const fn = DRAW[kind]; if (!fn) return;
    const m = META[kind];
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.lineJoin = 'round';
    fn(ctx, m.r * (scale || 1));
    ctx.restore();
  }

  return { DRAW, META, PROP_BOX, P, kinds, has, draw, circle, box };
})();
