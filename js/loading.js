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

  /* The briefing. Only the mission mode has one, and it is only meaningful
     after the world exists -- so it is filled in by the phase that generates
     the map, not when the screen opens.

     The map is drawn here rather than reusing the in-game minimap because it
     is answering a different question: not "where am I" but "what am I about
     to be dropped into". Buildings, the compound, and nothing else. */
  function brief(m, world) {
    const box = el('loading-brief');
    if (!box || !m) return;
    box.hidden = false;
    el('brief-tag').textContent = m.name.toUpperCase();
    el('brief-line').textContent = m.brief;

    const cv = el('brief-map');
    if (!cv || !world) return;
    const g = cv.getContext('2d');
    const S = cv.width / Math.max(world.w, world.h);
    g.clearRect(0, 0, cv.width, cv.height);
    // the island
    g.fillStyle = 'rgba(120,150,200,0.10)';
    g.fillRect(0, 0, cv.width, cv.height);
    // every building the recon flight picked up
    g.fillStyle = 'rgba(200,222,255,0.42)';
    for (const b of world.buildings) {
      g.fillRect(b.x * S, b.y * S, Math.max(2, b.w * S), Math.max(2, b.h * S));
    }
    // the compound, ringed
    if (world.core) {
      g.strokeStyle = 'rgba(232,118,63,0.9)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(world.core.x * S, world.core.y * S, 26, 0, Math.PI * 2); g.stroke();
      g.setLineDash([3, 3]);
      g.beginPath(); g.arc(world.core.x * S, world.core.y * S, 48, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#e8763f';
      g.font = 'bold 9px Azeret Mono, ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillText('OBJECTIVE', world.core.x * S, world.core.y * S - 34);
    }
    // and where you come ashore
    if (world.land) {
      g.fillStyle = '#7ff2c1';
      g.beginPath(); g.arc(world.land.x * S, world.land.y * S, 4, 0, Math.PI * 2); g.fill();
    }
  }

  function hide() {
    const box = el('overlay-loading');
    if (!box) return;
    open = false;
    box.classList.remove('is-open');
    box.setAttribute('aria-hidden', 'true');
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
