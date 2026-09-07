/* ============================================================
   loading.js — the deployment screen.

   Building an island is synchronous and takes a few hundred milliseconds; the
   screen swap either side of it takes longer. None of that used to be covered,
   so pressing deploy froze the menu and then jump-cut into a match that was
   already running.

   The only real trick here is yielding. Worldgen blocks the main thread, so an
   overlay that is shown and then immediately followed by Game.start never gets
   painted at all — the browser goes straight from "class added" to "frame
   done", and you see nothing. Every phase therefore hands control back to the
   compositor (two animation frames: one to apply the style, one to paint it)
   before the blocking work starts.
   ============================================================ */
const Loading = (() => {

  /* Things worth knowing, shown while there is nothing else to look at. Kept
     specific — "hold F to heal" is worth reading, "get ready!" is not. */
  const TIPS = [
    'Middle-click to ping. Clicking the minimap pings anywhere on the map.',
    'Metal walls ricochet rounds. Wood stops them. Neither is cover you can trust for long.',
    'A crate you cannot reach on foot is usually a crate with a door you have not found.',
    'Vaulting a window is faster than walking round the building, and quieter than the door.',
    'Gold crates are rare on purpose. A legendary is roughly one crate in a hundred.',
    'Standing still on grass in a ghillie suit makes you very hard to see. Moving does not.',
    'Objectives take longer to flip the more people are contesting them.',
    'Your squad can deploy on you if you have not been shot at recently.',
    'Suppressed weapons do not draw bots to your position.',
    'A trench protects you from fire across the field, not from someone standing on the lip.',
  ];

  const el = (id) => document.getElementById(id);
  let open = false;

  /* Two frames: the first applies the class, the second lets the compositor
     put it on the glass. One is not enough. */
  const paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  function show(title) {
    const box = el('overlay-loading');
    if (!box) return;
    open = true;
    el('loading-title').textContent = title || 'Deploying';
    el('loading-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    step('Preparing', 0);
    box.classList.add('is-open');
    box.setAttribute('aria-hidden', 'false');
  }

  function step(label, pct) {
    if (!open) return;
    const sub = el('loading-sub'), fill = el('loading-fill');
    if (sub) sub.textContent = label;
    if (fill) fill.style.width = Math.round(pct * 100) + '%';
  }

  /* ---------------- the approach ----------------
     The briefing map is not a picture, it is the run in.

     A static chart told you where you were going and nothing else. This draws
     the same information as an arrival: the boat comes in off the open sea,
     the recon sweep walks across the island revealing the buildings as it
     passes, and the compound is picked out last -- so by the time the screen
     lifts you have watched the approach rather than read a diagram.

     It is the one place in the game where an animation is doing a job. The
     order things appear in is the order you are told them: the sea, then the
     island, then what is on it, then the thing you are here for, then where
     you land. Reduced motion gets the finished frame immediately.

     Animated on the canvas the static version already used, so nothing else
     had to change. */
  /* Honours the accessibility preference. Declared here because the rewrite
     of the briefing swallowed the original declaration further down -- the
     briefing threw a ReferenceError on its first line and the deploy path
     caught it silently, so the map simply stayed black. */
  const reduced = () => window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let briefRaf = 0;

  function stopBrief() {
    if (briefRaf) cancelAnimationFrame(briefRaf);
    briefRaf = 0;
  }

  function brief(m, world) {
    const box = el('loading-brief');
    if (!box || !m) return;
    box.hidden = false;
    el('brief-tag').textContent = m.name.toUpperCase();
    el('brief-line').textContent = m.brief;

    /* The details that turn a sentence into an order: how long you have, how
       many of them there are, and how far you have to walk. All of it is
       known once the world exists, and none of it was being shown. */
    const facts = el('brief-facts');
    if (facts && world) {
      const km = world.core && world.land
        ? Math.round(Math.hypot(world.core.x - world.land.x, world.core.y - world.land.y) / 50)
        : 0;
      const mins = Math.floor((m.seconds || 600) / 60);
      facts.innerHTML = [
        ['Window', mins + ' min'],
        ['Garrison', (world.garrison || '?') + ' hostiles'],
        ['Approach', km + ' tiles on foot'],
        ['Extraction', 'at the landing point'],
      ].map(([k, v]) => `<div class="brief__fact"><span>${k}</span><b>${v}</b></div>`).join('');
    }

    const cv = el('brief-map');
    if (!cv || !world) return;
    const g = cv.getContext('2d');
    const S = cv.width / Math.max(world.w, world.h);
    const cw = cv.width, ch = cv.height;

    /* The boat comes from the open sea on the far side of the landing point,
       so its track ends where you come ashore. */
    const land = world.land || { x: world.w / 2, y: world.h / 2 };
    const core = world.core || { x: world.w / 2, y: world.h / 2 };
    const inAng = Math.atan2(land.y - core.y, land.x - core.x);
    const from = { x: land.x + Math.cos(inAng) * world.w * 0.5,
      y: land.y + Math.sin(inAng) * world.h * 0.5 };

    const DUR = 3.4;                       // seconds, matched to the hold
    let t0 = null;

    const frame = (now) => {
      if (t0 === null) t0 = now;
      const t = Math.min(1, (now - t0) / (DUR * 1000));
      paintBrief(g, cw, ch, S, world, land, core, from, t);
      if (t < 1) briefRaf = requestAnimationFrame(frame);
      else briefRaf = 0;
    };

    stopBrief();
    if (reduced()) { paintBrief(g, cw, ch, S, world, land, core, from, 1); return; }
    briefRaf = requestAnimationFrame(frame);
  }

  /* One frame of the approach. `t` runs 0..1 across the whole thing; each
     element has its own slice of it, which is what staggers them. */
  function paintBrief(g, cw, ch, S, world, land, core, from, t) {
    const ease = (v) => 1 - Math.pow(1 - Math.max(0, Math.min(1, v)), 3);
    const seg = (a, b) => ease((t - a) / (b - a));

    g.clearRect(0, 0, cw, ch);

    // the sea, always
    g.fillStyle = 'rgba(18,30,52,0.55)';
    g.fillRect(0, 0, cw, ch);

    /* The island, rising out of it. Drawn as the hull of the buildings rather
       than as a shape we do not have -- close enough at this size, and it
       means the landmass matches the map. */
    const isle = seg(0.0, 0.32);
    if (isle > 0) {
      g.save();
      g.globalAlpha = isle;
      g.fillStyle = 'rgba(120,150,200,0.13)';
      g.beginPath();
      g.ellipse(cw / 2, ch / 2, cw * 0.44 * isle, ch * 0.44 * isle, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    /* The recon sweep. A line walks across the island and the buildings it has
       passed stay drawn -- so the map is revealed rather than switched on. */
    const sweep = seg(0.18, 0.72);
    if (sweep > 0) {
      const edge = sweep * cw;
      g.fillStyle = 'rgba(200,222,255,0.42)';
      for (const b of world.buildings) {
        const bx = b.x * S;
        if (bx > edge) continue;
        g.fillRect(bx, b.y * S, Math.max(2, b.w * S), Math.max(2, b.h * S));
      }
      if (sweep < 1) {
        const grd = g.createLinearGradient(edge - 26, 0, edge, 0);
        grd.addColorStop(0, 'rgba(127,242,193,0)');
        grd.addColorStop(1, 'rgba(127,242,193,0.5)');
        g.fillStyle = grd;
        g.fillRect(edge - 26, 0, 26, ch);
      }
    }

    /* The compound, marked last and locked onto -- the reticle closes rather
       than appearing, which is the difference between "here it is" and "we
       have found it". */
    const lock = seg(0.62, 0.9);
    if (lock > 0 && core) {
      const x = core.x * S, y = core.y * S;
      const r = 26 + (1 - lock) * 60;
      g.strokeStyle = `rgba(232,118,63,${(0.35 + lock * 0.6).toFixed(2)})`;
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.setLineDash([3, 3]);
      g.beginPath(); g.arc(x, y, r * 1.9, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      // corner ticks, so it reads as a mark and not as a ripple
      g.beginPath();
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        g.moveTo(x + dx * r, y + dy * (r - 7));
        g.lineTo(x + dx * r, y + dy * r);
        g.lineTo(x + dx * (r - 7), y + dy * r);
      }
      g.stroke();
      if (lock > 0.75) {
        g.fillStyle = '#e8763f';
        g.font = 'bold 9px Azeret Mono, ui-monospace, monospace';
        g.textAlign = 'center';
        g.globalAlpha = (lock - 0.75) * 4;
        g.fillText('OBJECTIVE', x, y - r - 8);
        g.globalAlpha = 1;
      }
    }

    /* And the boat, running its track in. The wake is the track behind it,
       which is also the line you will walk back along on the way out. */
    const run = seg(0.30, 0.95);
    if (run > 0) {
      const bx = from.x + (land.x - from.x) * run;
      const by = from.y + (land.y - from.y) * run;
      g.strokeStyle = 'rgba(127,242,193,0.30)';
      g.lineWidth = 1.5;
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(from.x * S, from.y * S);
      g.lineTo(bx * S, by * S);
      g.stroke();
      g.setLineDash([]);

      const ang = Math.atan2(land.y - from.y, land.x - from.x);
      g.save();
      g.translate(bx * S, by * S);
      g.rotate(ang);
      g.fillStyle = '#7ff2c1';
      g.beginPath();
      g.moveTo(6, 0); g.lineTo(-4, 3.4); g.lineTo(-4, -3.4);
      g.closePath(); g.fill();
      g.restore();

      if (run >= 1) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
        g.strokeStyle = `rgba(127,242,193,${(0.4 + pulse * 0.5).toFixed(2)})`;
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(land.x * S, land.y * S, 5 + pulse * 4, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#7ff2c1';
        g.font = 'bold 8px Azeret Mono, ui-monospace, monospace';
        g.textAlign = 'center';
        g.fillText('LANDING', land.x * S, land.y * S + 18);
      }
    }
  }

  function hide() {
    const box = el('overlay-loading');
    if (!box) return;
    open = false;
    box.classList.remove('is-open');
    box.setAttribute('aria-hidden', 'true');
    stopBrief();
    const br = el('loading-brief');
    if (br) br.hidden = true;
  }

  /* Run `phases` — [label, fraction, fn] — with the overlay up, painting
     between each so the labels are actually seen rather than all landing in
     the same frame as the work. */
  /* `hold` keeps the screen up after the work is done. A mission briefing is
     something to read, and a screen that vanishes the instant the island
     finishes generating gives you a tenth of a second to read it. */
  async function run(title, phases, hold) {
    show(title);
    await paint();
    for (const [label, pct, fn] of phases) {
      step(label, pct);
      await paint();
      try { fn(); } catch (e) { console.error('deploy phase failed:', label, e); hide(); throw e; }
    }
    step('Ready', 1);
    // let the first frame of the match land underneath before lifting
    await paint();
    await new Promise(r => setTimeout(r, hold || 260));
    hide();
  }

  return { show, step, hide, run, brief, TIPS };
})();
