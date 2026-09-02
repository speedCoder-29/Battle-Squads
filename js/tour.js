/* ============================================================
   tour.js — the base tour: the half of the tutorial that happens
   before you deploy.

   Basic Training covers the match. Everything around the match —
   six tabs, two currencies, a battle pass, a gunsmith, presets,
   missions, a shop that deliberately sells nothing that helps you
   win — was left for the player to find on their own, and most of
   it is only legible once somebody says what it is for.

   So this walks the home screen: it dims the page, cuts a hole
   over the thing being talked about, and says one paragraph about
   it. Steps drive the real interface (switching tabs through
   Screens.setView) rather than showing pictures of it, so the tour
   ends with the player looking at the panel they were just told
   about, on their own account, with their own numbers in it.

   A step whose element is missing is skipped rather than pointed
   at, which is what keeps the tour honest if a panel is ever
   renamed or removed.
   ============================================================ */
const Tour = (() => {

  const $ = (sel) => document.querySelector(sel);
  const el = (id) => document.getElementById(id);
  const key = (id) => (typeof Controls !== 'undefined' ? Controls.labelFor(id) : '?');

  /* ---------- the script ----------
     `view` switches the home screen to that tab before the step is shown;
     `sel` is what gets the spotlight. Order follows the way somebody actually
     reads the screen: who you are, what you are about to play, then the tabs
     that change what you take into it. */
  const STEPS = [
    {
      sel: '.topbar', title: 'This is your base',
      body: 'Everything outside a match lives here: who you are, what you have earned, what you take '
        + 'into the next game. Six tabs across the top, your account on the right. '
        + 'I will walk you through all of it — Skip is always in the corner.',
    },
    {
      sel: '.career', title: 'Your career',
      body: 'Your callsign, your rank and your account level. Every match pays XP, and levels are the '
        + 'slow track — they say how long you have been playing rather than how much you have spent.',
    },
    {
      sel: '.wallet', title: 'Two currencies',
      body: '🪙 Credits come out of matches and missions and buy most of the shop. 💎 Squad coins are '
        + 'the rare one, for the best-looking things in it. Neither buys a combat advantage — there is '
        + 'no weapon, no perk and no armour anywhere in the shop.',
    },
    {
      sel: '.stat-row', title: 'Your record',
      body: 'Wins, matches and eliminations for this account, for as long as it exists. '
        + 'Underneath, further down this column, the last few matches you played and the numbers worth beating.',
    },
    {
      sel: '.mode-grid', title: 'The two modes',
      body: 'Domination is the forgiving one: capture and hold three points, respawn when you die, first '
        + 'squad to the score cap wins. Elimination is one life each and the last squad standing. '
        + 'Click either card to pick it.',
    },
    {
      sel: '#setupbar', title: 'How big a match',
      body: 'Squads, and how many to a squad. This is your game, so you decide: a two-on-two skirmish or '
        + 'twenty squads on one island. Online, whoever is hosting decides instead.',
    },
    {
      sel: '#botpick', title: 'How hard the bots are',
      body: 'Ten levels. Level 1 is a distracted rookie who fights alone; level 10 reacts in 90 ms, leads '
        + 'every shot, heals, and focus-fires with its squad. Move it until the fights feel fair — there '
        + 'is no prize for losing to level 10.',
    },
    {
      sel: '#kitstrip', title: 'What you are deploying with',
      body: 'Your class, your weapon and your perk, on the way out of the door. Your weapon *is* your '
        + 'class here, so changing the gun changes your speed, your tool and the kit you spawn with.',
    },
    {
      sel: '#btn-queue', title: 'Deploy',
      body: 'One button. Offline it builds an island and drops you into it against bots; with a server '
        + 'configured it puts you in a real match against people.',
    },
    {
      sel: '#trainbar', title: 'Training, and the manual',
      body: 'Where you are now. Basic Training is the guided match you are about to play, Guided Match is '
        + 'a real game with a coach watching it, and How to Play is the written reference — every table '
        + 'in it generated from the game’s own numbers.',
    },
    {
      sel: '#btn-range', title: 'The firing range',
      body: 'Thirty weapons and no way to find out what any of them feels like except by dying with it. '
        + 'The range is targets at 10–120 m with a damage and time-to-kill readout. Try a gun here before '
        + 'you take it anywhere that matters.',
    },
    {
      sel: '#party', title: 'Playing with people',
      body: 'Create a party and share the five-character code, or host a game straight from this page — '
        + 'one browser runs the match and everyone else connects to it. There is a two-tab button for '
        + 'seeing the netcode work on one machine.',
    },
    {
      sel: '.panel--missions', title: 'Daily missions',
      body: 'Three a day, refreshed on a clock, each worth credits and battle pass XP. They are how you '
        + 'earn without grinding: play the way you were going to and most of them complete themselves.',
    },
    {
      view: 'missions', sel: '.mission-columns', title: 'Dailies and weeklies',
      body: 'The full board. Dailies reset every day; weeklies are bigger and pay more. Progress is '
        + 'counted at the end of every match, including the ones you lose.',
    },
    {
      view: 'battlepass', sel: '.bp-progress', title: 'Battle pass — the XP track',
      body: 'One bar, one tier at a time. Matches and missions both feed it, and the tier you are on is '
        + 'the only thing that decides what has unlocked.',
    },
    {
      view: 'battlepass', sel: '#bp-track', title: 'What the pass pays out',
      body: 'Every tier carries something: credits, squad coins, avatars, tags, tracers and weapon skins. '
        + 'The free track runs the whole way — the premium column is extra, not a gate.',
    },
    {
      view: 'loadout', sel: '#loadout-grid', title: 'Loadout — your gun is your class',
      body: 'Thirty weapons in ten classes. Picking an M16 deploys you as a Rifleman with a bayonet and '
        + 'frags; picking a P90 makes you Assault with a fire axe and smoke. Speed, tool and starting kit '
        + 'all come with the gun.',
    },
    {
      view: 'loadout', sel: '#loadout-smith', title: 'The gunsmith',
      body: 'Attachments, specialized ammo and skins for the weapon you have selected, with the stat '
        + 'change shown live as you toggle each one. A suppressor really does keep bots from turning '
        + 'round; slug rounds really do turn a shotgun into a rifle.',
    },
    {
      view: 'loadout', sel: '#presets', title: 'Saved kits',
      body: 'Three slots. Build a set — weapon, attachments, ammo, perk — name it, and switch to it in '
        + 'one click instead of rebuilding it every time you change your mind.',
    },
    {
      view: 'shop', sel: '#shop-tabs', title: 'The shop',
      body: 'Seven categories and over forty items: weapon skins, avatars, name tags, tracers, emotes, '
        + 'squad banners, and the utility shelf — preset slots, XP boosts, credit bundles. '
        + 'Nothing in here changes a combat stat, and there is a test in the repo asserting it.',
    },
    {
      view: 'ranks', sel: '.lb', title: 'The leaderboard',
      body: 'Standings on this machine, sortable by wins, eliminations or level. Anyone generated to fill '
        + 'a lobby is marked as such — a board that quietly counts bots as people is lying to you.',
    },
    {
      view: 'play', sel: '#btn-settings', title: 'Settings',
      body: 'Sensitivity, field of view, crosshair, damage numbers, colour-blind team colours, and every '
        + 'keybind in the game — including moving dash off ' + key('dash') + ' if your browser eats it. '
        + 'Bot difficulty lives in there too, as the same number you saw on the deploy bar.',
    },
    {
      sel: '#trainbar', title: 'That is the base',
      body: 'Next is Basic Training: the same island, one lesson at a time, nobody shooting at you until '
        + 'the last one. After that, a guided match with a coach in it.',
      last: true,
    },
  ];

  /* ---------- state ---------- */
  let steps = [];
  let i = 0;
  let running = false;
  let onDone = null;
  let raf = 0;

  /* ---------- geometry ----------
     The spotlight is one element with a very large box-shadow, so the "hole"
     is the element's own box and the dimming is the shadow around it. Four
     positioned panels would need four sets of arithmetic and would seam. */
  const PAD = 8;
  function place() {
    if (!running) return;
    const s = steps[i];
    const target = s && s.sel ? $(s.sel) : null;
    const ring = el('tour-ring'), card = el('tour-card');
    if (!ring || !card) return;
    const vw = window.innerWidth, vh = window.innerHeight;

    if (!target) {
      // nothing to point at: dim everything and centre the card
      ring.style.width = ring.style.height = '0px';
      ring.style.left = (vw / 2) + 'px'; ring.style.top = (vh / 2) + 'px';
      card.style.left = Math.round(vw / 2 - card.offsetWidth / 2) + 'px';
      card.style.top = Math.round(vh / 2 - card.offsetHeight / 2) + 'px';
      return;
    }
    const r = target.getBoundingClientRect();
    const x = Math.max(4, r.left - PAD), y = Math.max(4, r.top - PAD);
    const w = Math.min(vw - x - 4, r.width + PAD * 2), h = Math.min(vh - y - 4, r.height + PAD * 2);
    ring.style.left = x + 'px'; ring.style.top = y + 'px';
    ring.style.width = w + 'px'; ring.style.height = h + 'px';

    /* The card goes under the target, or over it when there is no room, and is
       clamped into the viewport either way — a tooltip half off the screen is
       worse than one that has moved. */
    const cw = card.offsetWidth || 380, ch = card.offsetHeight || 200;
    let cy = y + h + 14;
    if (cy + ch > vh - 10) cy = y - ch - 14;
    if (cy < 10) cy = Math.min(vh - ch - 10, Math.max(10, y + h + 14));
    let cx = r.left + r.width / 2 - cw / 2;
    cx = Math.max(12, Math.min(vw - cw - 12, cx));
    card.style.left = Math.round(cx) + 'px';
    card.style.top = Math.round(cy) + 'px';
  }

  /* ---------- running it ---------- */
  function run(opts) {
    const box = el('tour');
    if (!box) { finish(opts && opts.onDone); return; }
    steps = STEPS.slice();
    i = 0;
    onDone = (opts && opts.onDone) || null;
    running = true;
    box.hidden = false;
    box.classList.add('is-open');
    bind();
    show();
    tick();
  }

  function tick() {
    if (!running) return;
    place();                       // follow layout, animation and scrolling
    raf = requestAnimationFrame(tick);
  }

  /* Move to a step: switch tab if it asks for one, bring the target into
     view, then paint. Two frames, because the panel it wants may not have
     been laid out until the tab switch has rendered. */
  function show() {
    const s = steps[i];
    if (!s) return end(true, true);
    if (s.view && typeof Screens !== 'undefined' && Screens.setView) {
      try { Screens.setView(s.view); } catch (e) { console.warn('[tour]', e); }
    }
    el('tour-count').textContent = (i + 1) + ' / ' + steps.length;
    el('tour-title').textContent = s.title;
    el('tour-body').textContent = s.body;
    el('tour-back').disabled = i === 0;
    el('tour-next').textContent = s.last ? 'Start training' : 'Next';
    requestAnimationFrame(() => {
      const t = s.sel ? $(s.sel) : null;
      if (t && t.scrollIntoView) {
        const r = t.getBoundingClientRect();
        if (r.top < 60 || r.bottom > window.innerHeight - 60) {
          try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { t.scrollIntoView(); }
        }
      }
      requestAnimationFrame(place);
    });
    if (typeof SFX !== 'undefined') SFX.click();
  }

  /* A step pointing at something that is not on the page is skipped rather
     than shown pointing at nothing. */
  function step(delta) {
    let n = i + delta;
    while (n >= 0 && n < steps.length) {
      const s = steps[n];
      if (!s.sel) break;
      if (s.view && typeof Screens !== 'undefined' && Screens.setView) {
        try { Screens.setView(s.view); } catch (e) { /* fall through to the check */ }
      }
      const t = $(s.sel);
      if (t && (t.offsetWidth > 0 || t.offsetHeight > 0)) break;
      n += delta;
    }
    if (n < 0) return;
    if (n >= steps.length) return end(true, true);
    i = n;
    show();
  }

  /* `completed` says whether the tour was seen through to the end — which is
     what gets remembered. `cont` says whether to carry on into the field
     training afterwards: skipping the tour does (that is what "skip to
     training" means), pressing Escape does not, because Escape means out. */
  function end(completed, cont) {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    const box = el('tour');
    if (box) { box.classList.remove('is-open'); box.hidden = true; }
    unbind();
    if (typeof Screens !== 'undefined' && Screens.setView) {
      try { Screens.setView('play'); } catch (e) { /* nothing to do */ }
    }
    if (completed) {
      try {
        const p = DB.getProfile();
        if (p && !p.tourDone) { p.tourDone = true; DB.saveProfile(p); }
      } catch (e) { console.warn('[tour]', e); }
    }
    if (cont) finish(onDone);
    else onDone = null;
  }

  function finish(fn) { onDone = null; if (typeof fn === 'function') fn(); }

  /* ---------- input ----------
     Arrows and Enter, because a walkthrough somebody has to reach for the
     mouse on every paragraph is one they will abandon halfway. */
  function onKey(e) {
    if (!running) return;
    if (e.code === 'Escape') { e.preventDefault(); end(false, false); return; }
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'ArrowRight') { e.preventDefault(); step(1); return; }
    if (e.code === 'ArrowLeft') { e.preventDefault(); step(-1); }
  }
  let bound = false;
  function bind() {
    if (!bound) {
      window.addEventListener('keydown', onKey);
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
      const next = el('tour-next'), back = el('tour-back'), skip = el('tour-skip');
      if (next) next.addEventListener('click', () => step(1));
      if (back) back.addEventListener('click', () => step(-1));
      if (skip) skip.addEventListener('click', () => end(false, true));
      bound = true;
    }
  }
  function unbind() { /* the listeners are idempotent and cheap; keep them bound */ }

  return {
    run, end,
    isActive: () => running,
    steps: () => STEPS.length,
    debug: () => ({ running, i, total: steps.length || STEPS.length, id: steps[i] && steps[i].title }),
  };
})();
