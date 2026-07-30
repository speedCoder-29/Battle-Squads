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

  /* shared palette so everything feels like one set */
  const P = {
    wood: '#8a6234', woodDark: '#5e4222', woodLight: '#a87b45',
    leaf: '#4a8f3c', leafDark: '#33682a', leafLight: '#62ab4e',
    stone: '#8792a5', stoneDark: '#5d6675', stoneLight: '#a3aebf',
    metal: '#7b8798', metalDark: '#525c6b', metalLight: '#9aa6b8',
    rust: '#a2542e', rustDark: '#6f3719',
    sand: '#d8b36a', sandDark: '#a8873f',
    cloth: '#5f6b7d', clothDark: '#3f4857',
    hot: '#e2622f', hotDark: '#a63f18',
    dark: 'rgba(0,0,0,0.35)',
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
    /* a tree from above: trunk ring under two offset canopy blobs */
    tree(ctx, r) {
      circle(ctx, 0, 0, r * 0.30, P.woodDark, null);
      circle(ctx, -r * 0.16, -r * 0.12, r * 0.74, P.leafDark, null);
      circle(ctx, r * 0.14, r * 0.10, r * 0.66, P.leaf, P.leafDark, 2);
      circle(ctx, -r * 0.22, -r * 0.24, r * 0.30, P.leafLight, null);
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
    /* boulder: an irregular polygon so it doesn't read as a ball */
    rock(ctx, r) {
      ctx.beginPath();
      const pts = [[-0.9, -0.2], [-0.55, -0.8], [0.2, -0.95], [0.85, -0.4],
                   [0.9, 0.35], [0.35, 0.9], [-0.45, 0.8], [-0.9, 0.3]];
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px * r, py * r) : ctx.moveTo(px * r, py * r)));
      ctx.closePath();
      shape(ctx, P.stone, P.stoneDark, 2.5);
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.35); ctx.lineTo(r * 0.1, -r * 0.55); ctx.lineTo(r * 0.25, -r * 0.1);
      ctx.closePath();
      shape(ctx, P.stoneLight, null);
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
    /* oil drum: concentric rings, viewed from directly above */
    barrel(ctx, r) {
      circle(ctx, 0, 0, r, P.rust, P.rustDark, 2.5);
      circle(ctx, 0, 0, r * 0.72, P.metal, P.metalDark, 1.8);
      circle(ctx, 0, 0, r * 0.30, P.metalDark, null);
      circle(ctx, -r * 0.3, -r * 0.3, r * 0.18, P.metalLight, null);
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
    /* bare stump */
    stump(ctx, r) {
      circle(ctx, 0, 0, r * 0.8, P.wood, P.woodDark, 2.5);
      circle(ctx, 0, 0, r * 0.5, P.woodLight, P.woodDark, 1.5);
      circle(ctx, 0, 0, r * 0.18, P.woodDark, null);
    },
  };

  /* metadata the world uses: draw radius, shadow throw, and whether it's tall */
  const META = {
    tree:      { r: 26, shadow: 12, tall: true },
    palm:      { r: 26, shadow: 12, tall: true },
    bush:      { r: 17, shadow: 5 },
    rock:      { r: 16, shadow: 7 },
    crate:     { r: 15, shadow: 6 },
    barrel:    { r: 13, shadow: 6 },
    pallet:    { r: 15, shadow: 3 },
    tyre:      { r: 12, shadow: 3 },
    cone:      { r: 10, shadow: 3 },
    rubble:    { r: 14, shadow: 4 },
    antenna:   { r: 17, shadow: 8, tall: true },
    sign:      { r: 14, shadow: 5 },
    tent:      { r: 24, shadow: 8, tall: true },
    sandpile:  { r: 18, shadow: 4 },
    container: { r: 22, shadow: 9, tall: true },
    stump:     { r: 13, shadow: 3 },
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

  return { DRAW, META, P, kinds, has, draw, circle, box };
})();
