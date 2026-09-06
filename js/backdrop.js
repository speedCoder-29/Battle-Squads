/* ============================================================
   backdrop.js — the moving picture behind the menus.

   The home screen was flat panels on flat colour. What it wanted was
   something alive behind them, and the honest choice for a game about an
   island is the island: a slow tactical read-out of the place you are about
   to be dropped onto.

   Drawn rather than shipped as an image, for three reasons. There is no build
   step here, so a bitmap would be a binary blob in the repo nobody can diff;
   it would need a second copy for every aspect ratio; and it could not carry
   the accent colour, so a change to the palette would leave it behind. This
   is ~120 lines, scales to any window, and is themed from the same CSS custom
   properties as everything else.

   It is deliberately quiet. A menu background that draws attention is a menu
   background that is wrong — the eye should land on the deploy button, and
   this should only be noticed when you look for it.
   ============================================================ */
const Backdrop = (() => {
  let canvas = null, ctx = null, raf = 0, t = 0;
  let W = 0, H = 0, dpr = 1;
  let contours = [], blips = [], running = false;

  /* One seeded noise field, sampled for the contour heights. Seeded so the
     island under the menu is the same island every time you open the game —
     it reads as a place rather than as static. */
  const seed = 20260904;
  let rnd = seed;
  const rand = () => {
    rnd = (rnd * 1664525 + 1013904223) >>> 0;
    return rnd / 4294967296;
  };

  const css = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };

  function build() {
    rnd = seed;
    /* Contours: concentric wobbling rings, the way a height map reads on a
       military chart. Each ring is a closed loop of radii with a little noise
       on it, so they nest without ever being circles. */
    contours = [];
    const rings = 7;
    for (let i = 0; i < rings; i++) {
      const pts = [];
      const n = 90;
      const base = 0.20 + i * 0.085;
      const wob = 0.030 + i * 0.006;
      const ph1 = rand() * 6.28, ph2 = rand() * 6.28, ph3 = rand() * 6.28;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const r = base
          + Math.sin(a * 3 + ph1) * wob
          + Math.sin(a * 5 + ph2) * wob * 0.6
          + Math.sin(a * 8 + ph3) * wob * 0.3;
        pts.push({ a, r });
      }
      contours.push({ pts, i });
    }
    /* Contacts. Slow drifting marks, most of them dim, a couple bright —
       squads moving on a map you are not in yet. */
    blips = [];
    for (let i = 0; i < 14; i++) {
      blips.push({
        a: rand() * Math.PI * 2,
        r: 0.12 + rand() * 0.62,
        sp: (0.02 + rand() * 0.05) * (rand() < 0.5 ? -1 : 1),
        hot: rand() < 0.22,
        ph: rand() * 6.28,
      });
    }
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    /* Off the bounding box, and falling back to the parent. `clientHeight`
       read 119 when this ran in the same frame the home screen became
       visible -- the element had not been laid out yet -- so the chart was
       drawn into a letterbox and stretched across the page. */
    const r = canvas.getBoundingClientRect();
    const par = canvas.parentElement;
    W = Math.round(r.width) || (par ? par.clientWidth : 0) || window.innerWidth;
    H = Math.round(r.height) || (par ? par.clientHeight : 0) || window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (!ctx || !W || !H) return;
    const accent = css('--accent', '#e8763f');
    const cx = W * 0.5, cy = H * 0.52;
    // the chart is sized off the short edge, so it never crops oddly
    const R = Math.min(W, H) * 0.92;

    ctx.clearRect(0, 0, W, H);

    /* A grid first, faint, on a slow drift. Nothing about it is exact —
       exactness would make it look like a spreadsheet. */
    const step = 46;
    const off = (t * 5) % step;
    ctx.strokeStyle = 'rgba(150,180,230,0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -off; x < W + step; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = -off; y < H + step; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    /* The contours. They breathe — each ring on its own slow phase, so the
       island seems to be surveyed rather than to be pulsing. */
    for (const c of contours) {
      const swell = 1 + Math.sin(t * 0.22 + c.i * 0.7) * 0.012;
      ctx.beginPath();
      for (let k = 0; k <= c.pts.length; k++) {
        const p = c.pts[k % c.pts.length];
        const rr = p.r * R * swell;
        const x = cx + Math.cos(p.a) * rr, y = cy + Math.sin(p.a) * rr * 0.78;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      // the outer rings fade out, so the chart sits in the dark rather than
      // stopping at an edge
      const fade = 0.16 * (1 - c.i / contours.length) + 0.03;
      ctx.strokeStyle = `rgba(150,190,255,${fade.toFixed(3)})`;
      ctx.lineWidth = c.i === 2 ? 1.6 : 1;
      ctx.stroke();
    }

    /* The sweep. One arm, one revolution every twenty seconds, with a wedge
       of afterglow behind it. This is the only thing on screen that moves
       fast enough to notice, and it is still slow. */
    const sweep = (t * 0.32) % (Math.PI * 2);
    const grad = ctx.createConicGradient
      ? ctx.createConicGradient(sweep, cx, cy)
      : null;
    if (grad) {
      grad.addColorStop(0, hexA(accent, 0.10));
      grad.addColorStop(0.06, hexA(accent, 0.0));
      grad.addColorStop(1, hexA(accent, 0.0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, R * 0.78, R * 0.78 * 0.78, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = hexA(accent, 0.22);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep) * R * 0.78, cy + Math.sin(sweep) * R * 0.78 * 0.78);
    ctx.stroke();

    /* Contacts, brightening as the sweep passes over them — which is the one
       detail that makes a radar read as a radar. */
    for (const b of blips) {
      b.a += b.sp * 0.0016;
      const x = cx + Math.cos(b.a) * b.r * R;
      const y = cy + Math.sin(b.a) * b.r * R * 0.78;
      let d = Math.abs(((b.a - sweep) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
      if (d > Math.PI) d = Math.PI * 2 - d;
      const lit = Math.max(0, 1 - d / 0.9);
      const base = b.hot ? 0.30 : 0.13;
      const alpha = base + lit * (b.hot ? 0.55 : 0.30);
      ctx.fillStyle = b.hot ? hexA(accent, alpha) : `rgba(170,205,255,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, b.hot ? 2.6 : 1.9, 0, Math.PI * 2);
      ctx.fill();
      if (lit > 0.5) {
        ctx.strokeStyle = b.hot ? hexA(accent, (lit - 0.5) * 0.5) : `rgba(170,205,255,${((lit - 0.5) * 0.3).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 5 + (1 - lit) * 10, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  /* #rrggbb + alpha, without pulling in a colour library for one function. */
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  const reduced = () => window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame() {
    if (!running) return;
    t += 1 / 60;
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    canvas = document.getElementById('home-backdrop');
    if (!canvas || running) return;
    ctx = canvas.getContext('2d');
    build();
    resize();
    // and again once layout has certainly happened
    requestAnimationFrame(() => requestAnimationFrame(resize));
    window.addEventListener('resize', resize);
    running = true;
    /* Reduced motion gets the picture and none of the movement: it is drawn
       once and left there. Removing it entirely would take away the artwork
       as well as the animation, which is not what the preference asks for. */
    if (reduced()) { draw(); running = false; return; }
    frame();
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  return { start, stop, resize };
})();
