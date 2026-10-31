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

  /* ---------- the light ----------
     The header above has always claimed "one light source", but the set did
     not actually obey it: the tree put its shadowed mass up and to the left
     and its highlight in the same place, the boulder had a rim light on the
     side facing away from the sun, and the crate wore a bright diagonal
     straight across its face. Read together, the props looked lit from
     everywhere, which is the same as looking lit from nowhere — it is why the
     world read flat however carefully any single sprite was drawn.

     So the direction is written down here and every sprite is drawn to it.
     The sun is high and behind the player's left shoulder: highlights up and
     to the left, shadow down and to the right, always.

     LX/LY are in units of the sprite's own radius, so they scale with it.

     There is a catch, and it is the reason fixing the sprites one by one was
     not enough. Props are drawn rotated — a tree, a bush and a boulder each
     get a random angle so that a row of them does not look stamped — and a
     highlight drawn inside a rotated sprite rotates with it. Every tree on the
     map was therefore lit from a different direction, which is exactly the
     "lit from everywhere" problem, arriving through the back door.

     `lit()` runs a drawing pass with the sprite's own rotation undone. The
     silhouette keeps its random angle; the light does not. */
  const LX = -0.38, LY = -0.34;
  let curRot = 0;
  function lit(ctx, fn) {
    if (!curRot) { fn(); return; }
    ctx.save(); ctx.rotate(-curRot); fn(); ctx.restore();
  }

  /* shared palette so everything feels like one set (survev.io-inspired) */
  const P = {
    /* wood: warm, readable, slightly worn */
    wood: '#9a7542', woodDark: '#6b5231', woodLight: '#c49060',
    /* vegetation: saturated greens for visibility */
    leaf: '#5ab947', leafDark: '#2d7a1a', leafLight: '#7cd347',
    /* moss/lichen: the fleck that makes a rock look like it sits somewhere
       rather than everywhere -- how much of it shows is biome weather, not
       chance, so the same boulder is bone-dry in the Basin and furred green
       on the Jungle Coast. */
    moss: '#5e7a3e',
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
    /* Shadows carry the hue of the ground they fall on. Pure black on a green
       field reads as a hole punched through the world rather than shade; a
       cool, slightly blue dark reads as an absence of sunlight, which is what
       a shadow actually is. */
    dark: 'rgba(22, 30, 48, 0.38)',
  };
  const BASE_P = Object.assign({}, P);

  /* ---------- a palette per climate ----------
     The ground already changes with the biome -- grass, sand and water all
     roll their own colours in terrain.js -- but every prop standing on that
     ground was drawing from the one fixed palette above, so a boulder on the
     Ashfields and a boulder on the Jungle Coast were the identical grey. Only
     the materials that are actually *of* the place are overridden: living
     wood, foliage, bare stone, loose sand. Manufactured things -- a crate's
     metal band, a tent's canvas, a warning stripe -- stay the same colour
     anywhere, because a crate does not know what climate it washed up in. */
  const BIOME_PALETTES = {
    arid: {       // Arid Basin: sun-bleached and dust-dry
      leaf: '#93a84f', leafDark: '#657328', leafLight: '#b0c467',
      moss: '#9c8a4e',
      stone: '#c3b28c', stoneDark: '#8f7e5c', stoneLight: '#dbcba4',
      wood: '#b28c54', woodDark: '#7c5e36', woodLight: '#d3ae78',
      sand: '#edd27a', sandDark: '#c3a558',
      rust: '#c96a3e',
    },
    tundra: {     // Frozen Flats: cold, blue-leaning, frost over everything
      leaf: '#4f8072', leafDark: '#2e5248', leafLight: '#78aa98',
      moss: '#8fa8b0',
      stone: '#aebccb', stoneDark: '#717f8e', stoneLight: '#d2e3ee',
      wood: '#7c6c59', woodDark: '#4f4336', woodLight: '#9d8c76',
      sand: '#e9eff2', sandDark: '#c4cfd6',
      metal: '#7f93ab', metalDark: '#4c5c70', metalLight: '#aebdd0',
    },
    tropic: {     // Jungle Coast: saturated and overgrown
      leaf: '#2f9e3a', leafDark: '#146b1e', leafLight: '#5cc85a',
      moss: '#357a2e',
      stone: '#7f9684', stoneDark: '#506458', stoneLight: '#9fbaa1',
      wood: '#7a5a38', woodDark: '#4a3420', woodLight: '#a2804e',
      sand: '#f0dca0', sandDark: '#cdb476',
      rust: '#a8512e', rustDark: '#5e2a14',
    },
    volcanic: {   // Ashfields: scorched, ashen, almost no green left
      leaf: '#6e6b3a', leafDark: '#454326', leafLight: '#8c8a52',
      moss: '#5a5648',
      stone: '#5a5650', stoneDark: '#343229', stoneLight: '#78746a',
      wood: '#4a3c30', woodDark: '#281f17', woodLight: '#6b5844',
      sand: '#8a8278', sandDark: '#625c52',
      rust: '#8a4530', rustDark: '#451d10',
    },
  };
  /* Swap the live palette to match the match's climate. Called once, right
     after worldgen rolls the biome -- not per-sprite -- so every prop reads
     it the same way `lit()` reads `curRot`: ambient state the draw calls
     trust rather than a parameter every one of them has to thread through. */
  function setBiome(id) {
    Object.assign(P, BASE_P, BIOME_PALETTES[id] || {});
  }

  /* blend two '#rrggbb' colours -- t=0 is c1, t=1 is c2 */
  function mix(c1, c2, t) {
    const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
    return `rgb(${r},${g},${bl})`;
  }

  /* helper: filled path with a darker outline, the look of the whole set */
  function shape(ctx, fill, stroke, lw) {
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  /* helper: a scatter of small flecks for grain/grit/lichen -- the texture a
     flat fill cannot carry on its own. Positioned and sized off `v` and the
     fleck's own index, so the same prop always grows the same texture but no
     two props share one. */
  function speckle(ctx, r, v, n, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 0.3 : alpha;
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const a = ((v * (19 + i * 37)) % 1) * Math.PI * 2;
      const rr = Math.sqrt((v * (11 + i * 53)) % 1) * r * 0.82;
      const sz = r * (0.035 + ((v * (7 + i * 29)) % 1) * 0.03);
      ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, sz, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
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

  /* ---------- individuality ----------
     Every tree on the map used to be the same tree: same clump offsets, same
     crown proportions, every time, with only the caller's random rotation
     telling two of them apart. That hides the repeat from some angles but
     not from a glance at a treeline, and it does nothing at all for a prop
     like the stump below, whose rings are concentric circles — a shape that
     looks identical at every rotation, so a hundred stumps were a hundred
     copies of one.

     `hash01` turns a prop's own world position into a stable 0..1 value, the
     same way every time the same spot is drawn, without storing anything on
     the prop itself. Natural shapes below use it to flex their own
     proportions — a clump a little bigger here, a frond count one short
     there, rings off-centre a different way each time — so a map planted
     with the same handful of prop kinds still reads as individually grown
     rather than stamped. */
  function hash01(x, y) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* ---------- the sprites ----------
     Signature is always (ctx, r, v), with the transform already applied and
     v a stable 0..1 roll for this prop's own position — unused by anything
     that has no reason to vary (furniture of the same model looks the same
     model to model; it's the grown things that shouldn't). */
  const DRAW = {
    /* A tree from above. The shadowed mass sits away from the sun — down and
       right — with the lit crown up and left over it, and the trunk showing
       through the middle where the canopy parts. Two offset clumps keep the
       outline from being a plain circle without costing another fill. */
    tree(ctx, r, v) {
      const v2 = (v * 7) % 1, v3 = (v * 13) % 1;
      // the silhouette turns with the prop...
      circle(ctx, -r * (0.38 + v * 0.14), r * (0.28 + v2 * 0.14), r * (0.22 + v2 * 0.10), P.leafDark, null);   // clump, breaks the circle
      circle(ctx, r * (0.04 + v3 * 0.14), -r * (0.34 + v * 0.12), r * (0.20 + v3 * 0.10), P.leafDark, null);
      // ...the light does not
      lit(ctx, () => {
        circle(ctx, r * 0.17, r * 0.16, r * (0.76 + v3 * 0.08), P.leafDark, null);      // mass in shade
        circle(ctx, LX * r * 0.30, LY * r * 0.30, r * (0.68 + v2 * 0.08), P.leaf, P.leafDark, 2.5);
        circle(ctx, LX * r * 0.78, LY * r * 0.80, r * (0.26 + v * 0.08), P.leafLight, null);  // lit crown
        speckle(ctx, r * 0.7, v, 6, P.leafLight, 0.22);   // dappled light through the gaps
        circle(ctx, 0, 0, r * 0.15, P.woodDark, null);                    // trunk through the gap
      });
    },
    /* palm: a starburst of fronds */
    palm(ctx, r, v) {
      const n = 6 + Math.floor(v * 3);              // 6, 7 or 8 fronds
      const flen = 0.46 + ((v * 7) % 1) * 0.10;      // a shorter or fuller crown
      circle(ctx, 0, 0, r * 0.22, P.woodDark, null);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.save(); ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(r * flen, 0, r * flen * 0.96, r * 0.20, 0, 0, Math.PI * 2);
        shape(ctx, i % 2 ? P.leaf : P.leafDark, P.leafDark, 1.5);
        ctx.restore();
      }
      lit(ctx, () => {
        circle(ctx, 0, 0, r * 0.20, P.woodLight, P.woodDark, 1.5);
        circle(ctx, LX * r * 0.16, LY * r * 0.16, r * 0.10, '#d8b98a', null);
      });
    },
    /* low scrub: a cluster of small blobs */
    bush(ctx, r, v) {
      const v2 = (v * 7) % 1;
      circle(ctx, -r * (0.24 + v * 0.10), r * (0.06 + v2 * 0.08), r * (0.44 + v2 * 0.12), P.leafDark, null);
      circle(ctx, r * (0.22 + v2 * 0.10), r * (0.10 + v * 0.10), r * (0.38 + v * 0.12), P.leafDark, null);
      lit(ctx, () => {
        circle(ctx, LX * r * 0.12, LY * r * 0.12, r * (0.54 + v * 0.10), P.leaf, P.leafDark, 2);
        circle(ctx, LX * r * 0.62, LY * r * 0.70, r * (0.16 + v2 * 0.10), P.leafLight, null);
        speckle(ctx, r * 0.6, v, 4, P.leafLight, 0.20);
      });
    },
    /* boulder: irregular polygon with strong shading for tactical clarity */
    rock(ctx, r, v) {
      // most boulders are plain stone; some carry a patch of lichen, and how
      // much is a climate question -- lush on the Jungle Coast, nearly none
      // on the sun-blasted Basin or the ashfields.
      const weathered = mix(P.stone, P.moss, ((v * 31) % 1) * 0.32);
      ctx.beginPath();
      const pts = [[-0.9, -0.2], [-0.55, -0.8], [0.2, -0.95], [0.85, -0.4],
                   [0.9, 0.35], [0.35, 0.9], [-0.45, 0.8], [-0.9, 0.3]];
      // each vertex gets its own stable nudge, so no two boulders share an
      // outline -- a fixed octagon rotated is still a fixed octagon
      pts.forEach(([px, py], i) => {
        const j = 0.86 + (((v * (i * 5 + 3)) % 1)) * 0.26;
        const x = px * r * j, y = py * r * j;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
      shape(ctx, weathered, P.stoneDark, 3);  // thicker outline for visibility
      lit(ctx, () => {
        // the sunlit face, up and to the left
        ctx.beginPath();
        ctx.moveTo(-r * 0.35, -r * 0.40); ctx.lineTo(r * 0.15, -r * 0.58); ctx.lineTo(r * 0.28, -r * 0.05);
        ctx.closePath();
        shape(ctx, P.stoneLight, null);
        /* ...and the face turned away from it. This used to be a second
           highlight, which lit the boulder from both sides at once. */
        ctx.beginPath();
        ctx.moveTo(r * 0.28, r * 0.05); ctx.lineTo(r * 0.30, r * 0.72); ctx.lineTo(-r * 0.40, r * 0.66);
        ctx.closePath();
        shape(ctx, P.stoneDark, null);
      });
      // a crack, because a weathered face is never perfectly smooth
      ctx.globalAlpha = 0.45; ctx.strokeStyle = P.stoneDark; ctx.lineWidth = 1.3;
      const ca = (v * 47) % 1 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ca) * r * 0.12, Math.sin(ca) * r * 0.12);
      ctx.lineTo(Math.cos(ca + 0.5) * r * 0.78, Math.sin(ca + 0.5) * r * 0.78);
      ctx.stroke();
      ctx.globalAlpha = 1;
      speckle(ctx, r * 0.8, v, 5, P.stoneDark, 0.22);
    },
    /* wooden crate: planks and a cross brace */
    crate(ctx, r, v) {
      box(ctx, -r, -r, r * 2, r * 2, P.wood, P.woodDark, 2.5, 3);
      ctx.strokeStyle = P.woodDark; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.33); ctx.lineTo(r, -r * 0.33);
      ctx.moveTo(-r, r * 0.33); ctx.lineTo(r, r * 0.33);
      ctx.stroke();
      /* The lit edges, along the two sides facing the sun. This was a bright
         diagonal drawn corner to corner, which is not something light does to
         a box — it read as a scratch. */
      ctx.strokeStyle = P.woodLight; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-r * 0.86, r * 0.86); ctx.lineTo(-r * 0.86, -r * 0.86); ctx.lineTo(r * 0.86, -r * 0.86);
      ctx.stroke();
      speckle(ctx, r * 0.85, v, 3, P.woodDark, 0.18);  // grain fleck
    },

    /* ---------- loot crates, by tier ----------
       Every tier used to be the same flat rounded square with a different
       fill colour and an emoji dropped on top -- a box wearing a sticker,
       not a sprite. The tier still has to read at a glance across a room,
       but now it reads from the crate's own shape and material rather than
       from a glyph: a reinforced case, a gilded strongbox, a proper chest.
       Colour still carries the tier (silver, gold), it just isn't the only
       thing carrying it any more. */

    /* silver: a reinforced case, not a fancier box -- corner brackets and a
       centre latch, the language a padlocked container already speaks */
    crateSilver(ctx, r, v) {
      box(ctx, -r, -r, r * 2, r * 2, P.metal, P.metalDark, 2.5, 4);
      /* Inset, not flush with the box's own border -- drawn on the edge
         these landed exactly on top of the stroke already there and never
         showed up at all. A bracket has to sit inside the case to read as
         one. */
      ctx.strokeStyle = P.metalLight; ctx.lineWidth = 2.2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(sx * r * 0.82, sy * r * 0.5); ctx.lineTo(sx * r * 0.82, sy * r * 0.82); ctx.lineTo(sx * r * 0.5, sy * r * 0.82);
        ctx.stroke();
      }
      lit(ctx, () => {
        box(ctx, -r * 0.86, -r * 0.86, r * 1.72, r * 0.5, P.metalLight, null, 0, 2);
        box(ctx, -r * 0.18, -r * 0.12, r * 0.36, r * 0.24, P.stoneLight, P.metalDark, 1.5, 2);  // latch
      });
      speckle(ctx, r * 0.85, v, 4, P.metalDark, 0.2);
    },
    /* gold: the wood crate's own shape, trimmed in gilt so it reads as the
       one worth crossing the room for -- fixed colour, not biome-tinted,
       because gold should look like gold on every island */
    crateGold(ctx, r, v) {
      const GOLD = '#e8bb3c', GOLD_DARK = '#8a6418', GOLD_LIGHT = '#ffe488';
      box(ctx, -r, -r, r * 2, r * 2, P.woodDark, GOLD_DARK, 2.5, 3);
      // inset from the box's own border, the same fix crateSilver needed --
      // flush with the edge, this stroke landed on top of that one and vanished
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.6;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(sx * r * 0.84, sy * r * 0.46); ctx.lineTo(sx * r * 0.84, sy * r * 0.84); ctx.lineTo(sx * r * 0.46, sy * r * 0.84);
        ctx.stroke();
      }
      ctx.fillStyle = GOLD_DARK; ctx.fillRect(-r * 0.14, -r, r * 0.28, r * 2);   // banded clasp strip
      lit(ctx, () => {
        ctx.fillStyle = GOLD; ctx.fillRect(-r * 0.12, -r * 0.98, r * 0.24, r * 1.96);
        circle(ctx, 0, 0, r * 0.22, GOLD_LIGHT, GOLD_DARK, 1.5);                 // the lock
      });
      speckle(ctx, r * 0.8, v, 3, GOLD_DARK, 0.15);
    },
    /* chest: the biggest container in the game and the only one with a lid
       drawn as a lid -- a domed top, strapped in the same gilt the gold
       crate wears, because a chest is what a gold crate is trying to be */
    lootChest(ctx, r, v) {
      box(ctx, -r, -r * 0.62, r * 2, r * 1.5, P.woodDark, '#3a2916', 2.5, 4);
      lit(ctx, () => box(ctx, -r * 0.9, -r * 0.5, r * 1.8, r * 0.5, P.woodLight, null, 0, 3));
      ctx.beginPath(); ctx.ellipse(0, -r * 0.62, r * 0.92, r * 0.5, 0, Math.PI, 0, false);
      shape(ctx, P.wood, '#3a2916', 2.5);
      lit(ctx, () => {
        ctx.beginPath(); ctx.ellipse(-r * 0.1, -r * 0.75, r * 0.55, r * 0.28, 0, Math.PI, 0, false);
        shape(ctx, P.woodLight, null);
      });
      const GOLD = '#e8bb3c', GOLD_DARK = '#8a6418';
      for (const sx of [-0.55, 0.55]) { ctx.fillStyle = GOLD; ctx.fillRect(sx * r - r * 0.07, -r * 1.1, r * 0.14, r * 2); }
      box(ctx, -r * 0.2, -r * 0.14, r * 0.4, r * 0.32, GOLD, GOLD_DARK, 1.5, 3);
      circle(ctx, 0, 0, r * 0.12, GOLD_DARK, null);
      speckle(ctx, r * 0.9, v, 4, '#3a2916', 0.15);
    },
    /* airdrop: a military crate marked the way something dropped from a
       plane actually is -- hazard stripes and strap buckles, olive rather
       than the warm woods everything else on the ground uses */
    crateAirdrop(ctx, r, v) {
      box(ctx, -r, -r, r * 2, r * 2, '#5a6248', '#363c29', 2.5, 3);
      lit(ctx, () => box(ctx, -r * 0.86, -r * 0.86, r * 1.72, r * 0.5, '#707a59', null, 0, 2));
      ctx.save();
      ctx.beginPath(); ctx.rect(-r * 0.92, -r * 0.22, r * 1.84, r * 0.44); ctx.clip();
      ctx.strokeStyle = '#e8c23c'; ctx.lineWidth = r * 0.22;
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath(); ctx.moveTo(i * r * 0.4 - r, -r); ctx.lineTo(i * r * 0.4 + r, r); ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = '#2c3022'; ctx.lineWidth = 1.5;
      ctx.strokeRect(-r * 0.92, -r * 0.22, r * 1.84, r * 0.44);
      for (const sy of [-0.74, 0.74]) { ctx.fillStyle = '#2c3022'; ctx.fillRect(-r * 0.86, sy * r - r * 0.07, r * 1.72, r * 0.14); }
      speckle(ctx, r * 0.85, v, 4, '#363c29', 0.2);
    },

    /* dropped loot pouch: what a stray consumable actually sits in on the
       ground -- an open canvas sack with the item's own icon drawn into its
       mouth, rather than a coin floating over a dark disc. The disc used to
       be the whole sprite: a flat circle that could have been standing in
       for anything, with no material of its own to read at a glance the way
       a crate's wood or a chest's gilt does. */
    dropPouch(ctx, r, v) {
      // burlap, not uniform-cloth blue -- a sack reads as a sack against
      // grass partly because it's a different material from everything else
      // standing on the field, the way the crate's wood and the chest's gilt
      // each claim their own colour.
      const SACK = '#8a7850', SACK_DARK = '#564a2e', SACK_LIGHT = '#c2ac78';
      // two overlapping blobs rather than one perfect oval -- a dropped sack
      // slumps unevenly, the way bush() avoids a circle for the same reason.
      // A first version drew the body, its highlight and its mouth as three
      // ellipses centred on each other, which is literally a target: body,
      // rim, bullseye. Nothing here is concentric with anything else now.
      ctx.beginPath();
      ctx.ellipse(r * 0.18, r * 0.14, r * 0.62, r * 0.56, 0, 0, Math.PI * 2);
      shape(ctx, SACK_DARK, null, 0);
      ctx.beginPath();
      ctx.ellipse(-r * 0.2, r * 0.08, r * 0.78, r * 0.6, 0, 0, Math.PI * 2);
      shape(ctx, SACK, SACK_DARK, 2);
      lit(ctx, () => {
        ctx.beginPath();
        ctx.ellipse(-r * 0.4, -r * 0.1, r * 0.46, r * 0.34, 0, 0, Math.PI * 2);
        shape(ctx, SACK_LIGHT, null, 0);
      });
      // the neck, cinched and knotted shut above the body -- a separate
      // shape rather than a ring inset into it, so it reads as tied off
      // rather than as a hole
      ctx.beginPath();
      ctx.ellipse(r * 0.12, -r * 0.4, r * 0.24, r * 0.18, 0.4, 0, Math.PI * 2);
      shape(ctx, SACK_DARK, null, 0);
      // the drawstring, trailing loose off to one side
      ctx.strokeStyle = SACK_DARK; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(r * 0.3, -r * 0.42); ctx.quadraticCurveTo(r * 0.52, -r * 0.22, r * 0.38, r * 0.02);
      ctx.stroke();
      ctx.lineCap = 'butt';
      speckle(ctx, r * 0.85, v, 4, SACK_DARK, 0.18);
    },

    /* oil drum: survev-style explosive hazard, immediately recognizable */
    barrel(ctx, r, v) {
      circle(ctx, 0, 0, r, P.rust, P.rustDark, 3);  // outer rim, thicker
      speckle(ctx, r * 0.95, v, 4, P.rustDark, 0.3);  // corrosion pitting
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
    rubble(ctx, r, v) {
      const v2 = (v * 7) % 1, v3 = (v * 13) % 1;
      circle(ctx, -r * (0.28 + v * 0.12), r * (0.14 + v2 * 0.10), r * (0.36 + v2 * 0.12), P.stoneDark, null);
      box(ctx, -r * (0.04 + v * 0.10), -r * 0.7, r * (0.72 + v3 * 0.18), r * 0.6, '#9a5f4a', '#6d3f2f', 2, 2);
      box(ctx, -r * (0.76 + v2 * 0.14), -r * 0.25, r * (0.58 + v * 0.18), r * 0.5, '#8c5744', '#6d3f2f', 2, 2);
      circle(ctx, r * (0.36 + v3 * 0.14), r * 0.45, r * (0.22 + v * 0.12), P.stone, P.stoneDark, 1.5);
      speckle(ctx, r * 0.9, v, 6, P.stoneDark, 0.25);  // grit and chip
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
    sandpile(ctx, r, v) {
      const n = 2 + Math.floor(v * 3);    // 2 to 4 bags -- not every pile is the same size
      for (let i = 0; i < n; i++) {
        ctx.save(); ctx.translate((i - (n - 1) / 2) * r * 0.5, (i % 2) * r * 0.25 - r * 0.1);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.52, r * 0.34, 0.2, 0, Math.PI * 2);
        shape(ctx, i % 2 ? P.sand : P.sandDark, P.sandDark, 1.8);
        // wind ripples, the texture a dune actually has rather than a plain fill
        ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.ellipse(0, k * r * 0.1, r * (0.44 - Math.abs(k) * 0.08), r * 0.2, 0.2, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    },
    /* shipping container */
    container(ctx, r, v) {
      box(ctx, -r * 1.3, -r * 0.8, r * 2.6, r * 1.6, '#3f7ea8', '#28536f', 2.5, 2);
      ctx.strokeStyle = '#28536f'; ctx.lineWidth = 1.4;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.36, -r * 0.75); ctx.lineTo(i * r * 0.36, r * 0.75); ctx.stroke();
      }
      // the corrugation catches the sun along its upper edge
      ctx.strokeStyle = 'rgba(190, 224, 245, 0.30)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 1.24, -r * 0.72); ctx.lineTo(r * 1.24, -r * 0.72); ctx.stroke();
      // a weathered one streaks rust down from a seam -- not every box is new
      if (v > 0.5) {
        ctx.strokeStyle = 'rgba(140, 80, 50, 0.35)'; ctx.lineWidth = 3;
        const sx = (((v * 7) % 1) - 0.5) * r * 2.2;
        ctx.beginPath(); ctx.moveTo(sx, -r * 0.7); ctx.lineTo(sx + r * 0.08, r * 0.75); ctx.stroke();
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

    /* ---------- more of the world ----------
       The prop pool was twenty-five kinds, and a handful of them did most of
       the work: nearly every yard on the map was crates, barrels and tyres.
       These are the things that actually stand around outside the buildings
       they belong to, so a farmyard stops looking like a warehouse yard with
       different walls. */

    /* wheelie bin: the most reliable sign of somewhere people live */
    bin(ctx, r) {
      box(ctx, -r * 0.62, -r * 0.78, r * 1.24, r * 1.56, '#3f5a46', '#22332a', 2, 3);
      lit(ctx, () => {
        // the lid, catching the light, with its lip along the front
        box(ctx, -r * 0.58, -r * 0.74, r * 1.16, r * 1.1, '#4d6d56', '#22332a', 1.5, 3);
        ctx.strokeStyle = 'rgba(200,230,210,0.30)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.68); ctx.lineTo(r * 0.5, -r * 0.68);
        ctx.stroke();
      });
      circle(ctx, -r * 0.45, r * 0.66, r * 0.16, '#1b2620', null);   // wheels
      circle(ctx, r * 0.45, r * 0.66, r * 0.16, '#1b2620', null);
    },

    /* round hay bale, seen from above: concentric wound straw */
    hayBale(ctx, r) {
      circle(ctx, 0, 0, r, '#c2a75c', '#8a7538', 2.5);
      lit(ctx, () => {
        circle(ctx, LX * r * 0.2, LY * r * 0.2, r * 0.72, '#d4bb72', null);
        circle(ctx, LX * r * 0.3, LY * r * 0.3, r * 0.42, '#e0cb8c', null);
      });
      ctx.strokeStyle = 'rgba(110,92,44,0.5)'; ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
        ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
        ctx.stroke();
      }
    },

    /* a stack of pipe, chocked so it does not roll */
    pipes(ctx, r) {
      const rr = r * 0.30;
      const rows = [[-1, -0.5], [0, -0.5], [1, -0.5], [-0.5, 0.4], [0.5, 0.4]];
      for (const [ox2, oy2] of rows) {
        circle(ctx, ox2 * rr * 2, oy2 * rr * 2, rr, '#8d97a5', '#4a525d', 2);
        circle(ctx, ox2 * rr * 2, oy2 * rr * 2, rr * 0.55, '#3d444d', null);
      }
      // the chock along the front
      box(ctx, -r * 0.95, r * 0.72, r * 1.9, r * 0.2, '#6b5231', '#3a2c1c', 1.5, 1);
    },

    /* site generator: a box with a radiator grille and an exhaust */
    generator(ctx, r) {
      box(ctx, -r * 0.9, -r * 0.62, r * 1.8, r * 1.24, '#e8bb52', '#7a6224', 2.5, 3);
      lit(ctx, () => {
        box(ctx, -r * 0.82, -r * 0.54, r * 1.64, r * 0.5, '#f0cf7c', null, 0, 2);
      });
      // grille
      ctx.strokeStyle = '#5f4d1c'; ctx.lineWidth = 1.6;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.28, -r * 0.34); ctx.lineTo(i * r * 0.28, r * 0.5);
        ctx.stroke();
      }
      circle(ctx, r * 0.68, -r * 0.46, r * 0.16, '#3a3a3a', '#1e1e1e', 1.5);  // exhaust
    },

    /* park bench: slats and two legs */
    bench(ctx, r) {
      box(ctx, -r, -r * 0.34, r * 2, r * 0.68, P.woodDark, '#3a2c1c', 2, 2);
      ctx.fillStyle = P.wood;
      for (let i = 0; i < 3; i++) ctx.fillRect(-r * 0.94, -r * 0.26 + i * r * 0.2, r * 1.88, r * 0.12);
      ctx.fillStyle = '#4a5260';
      ctx.fillRect(-r * 0.78, r * 0.3, r * 0.16, r * 0.16);
      ctx.fillRect(r * 0.62, r * 0.3, r * 0.16, r * 0.16);
    },

    /* bare stump */
    stump(ctx, r, v) {
      /* A ring pattern reads as identical at any rotation, so this was the
         one sprite that rotating its prop did nothing at all for -- a
         hundred stumps really were a hundred copies of one. Off-centring the
         grain, the way a real cut trunk's rings never land dead centre,
         gives it an outline that actually changes from instance to
         instance. */
      const ox = (v - 0.5) * r * 0.16, oy = (((v * 7) % 1) - 0.5) * r * 0.16;
      circle(ctx, 0, 0, r * (0.76 + v * 0.08), P.wood, P.woodDark, 2.5);
      circle(ctx, ox, oy, r * (0.44 + ((v * 7) % 1) * 0.10), P.woodLight, P.woodDark, 1.5);
      // a third ring, faint, so the grain reads as rings rather than a target
      ctx.globalAlpha = 0.35; ctx.strokeStyle = P.woodDark; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ox * 0.6, oy * 0.6, r * (0.60 + ((v * 13) % 1) * 0.08), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      circle(ctx, ox * 1.5, oy * 1.5, r * 0.16, P.woodDark, null);
      // radial checks where the cut dried and split
      ctx.strokeStyle = P.woodDark; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        const a = ((v * (29 + i * 41)) % 1) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(ox + Math.cos(a) * r * 0.1, oy + Math.sin(a) * r * 0.1);
        ctx.lineTo(ox + Math.cos(a) * r * 0.7, oy + Math.sin(a) * r * 0.7);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
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
    crateSilver: { r: 21, shadow: 6 },
    crateGold:   { r: 21, shadow: 6 },
    lootChest:   { r: 27, shadow: 8 },
    crateAirdrop:{ r: 23, shadow: 7 },
    dropPouch: { r: 15, shadow: 5 },                  // a loose consumable's own sack
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
    bin:       { r: 16, shadow: 6, tall: true },      // 0.8m wheelie bin
    hayBale:   { r: 30, shadow: 8, tall: true },      // 1.5m round bale
    pipes:     { r: 26, shadow: 5 },                  // 1.3m stack
    generator: { r: 22, shadow: 6 },                  // 1.1m site genset
    bench:     { r: 24, shadow: 3 },                  // 1.2m seat
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
    bench:     { w: 48, h: 18 },
    bin:       { w: 24, h: 30 },
    generator: { w: 40, h: 28 },
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
    curRot = rot || 0;              // remembered so lit() can undo it
    if (curRot) ctx.rotate(curRot);
    ctx.lineJoin = 'round';
    fn(ctx, m.r * (scale || 1), hash01(x, y));
    ctx.restore();
    curRot = 0;
  }

  return { DRAW, META, PROP_BOX, P, kinds, has, draw, circle, box, setBiome };
})();
