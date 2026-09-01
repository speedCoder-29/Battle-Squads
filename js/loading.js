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

  function hide() {
    const box = el('overlay-loading');
    if (!box) return;
    open = false;
    box.classList.remove('is-open');
    box.setAttribute('aria-hidden', 'true');
  }

  /* Run `phases` — [label, fraction, fn] — with the overlay up, painting
     between each so the labels are actually seen rather than all landing in
     the same frame as the work. */
  async function run(title, phases) {
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
    await new Promise(r => setTimeout(r, 260));
    hide();
  }

  return { show, step, hide, run, TIPS };
})();
