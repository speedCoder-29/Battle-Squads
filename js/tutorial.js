/* ============================================================
   tutorial.js — Basic Training: the guided first match.

   A new player opening this game is handed thirty weapons, ten
   classes, twenty keys, destructible buildings, armour tiers and
   two modes with different win conditions. The HUD legend lists
   the keys and nothing explains what any of them are *for*.

   This is a real match — same simulation, same physics, same
   damage calculator — running one lesson at a time in a cleared
   training ground. Every step names a mechanic, tells you which
   key it lives on, and then watches the world until you have
   actually done it. Nothing is faked: the crate you open rolls
   off the real loot table, the wall you break has the real HP,
   and the three hostiles at the end are ordinary bots.

   The state machine here only *observes*. It polls the world
   through the small read-only api game.js hands it, so teaching
   a new lesson never means threading another callback through
   the twelve thousand lines next door.
   ============================================================ */
const Tutorial = (() => {

  /* Key names come from Controls, never from a string in this file: someone
     who moved dash off Shift must be told to press what they actually bound. */
  const key = (id) => (typeof Controls !== 'undefined' ? Controls.labelFor(id) : '?');

  let api = null;                 // the world, handed over by game.js
  let steps = [];
  let idx = 0;                    // which step we are on
  let memo = {};                  // per-step scratch, cleared on entry
  let doneT = 0;                  // >0 while the "completed" flash plays
  let running = false;
  let finished = false;
  let toastT = 0, toastText = '';

  /* ---------- small geometry / drawing helpers ----------
     Deliberately local. game.js has its own copies, but the point of this
     file is that it can be read, changed or deleted on its own. */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (x, y) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)));

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* Greedy wrap. The bodies are two or three sentences and the card is a
     fixed width, so anything cleverer would be effort spent on nothing. */
  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  /* A key drawn as a key: a rounded cap with the label in it. Returns the
     width used so a row of them can be laid out left to right. */
  function drawCap(ctx, label, x, y) {
    ctx.font = 'bold 12px Azeret Mono, ui-monospace, monospace';
    const w = Math.max(26, ctx.measureText(label).width + 18);
    const h = 22;
    ctx.fillStyle = 'rgba(127,242,193,0.14)';
    ctx.strokeStyle = 'rgba(127,242,193,0.55)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, x, y, w, h, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#7ff2c1';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
    return w + 6;
  }

  /* ---------- world lookups the steps share ---------- */
  const tag = (a, t) => a.agents.find(x => x.tutorTag === t) || null;
  const downed = (a, t) => { const d = tag(a, t); return !d || !d.alive; };
  const slotHas = (a, cat) => {
    const inv = a.player.inv && a.player.inv[cat];
    return !!(inv && inv.id && inv.n > 0);
  };

  /* ============================================================
     THE LESSONS

     Each step is: what it teaches, which keys it lives on, and a
     `test` that reads the world. `setup` runs once on entry,
     `progress` drives the bar, `marker` puts a ring on the ground.
     A step with `skipIf` is dropped when it cannot apply — a class
     with no tactical item is not asked to deploy one.
     ============================================================ */
  const STEPS = [
    {
      id: 'intro',
      title: 'Welcome to Basic Training',
      body: () => 'A real match, on a real island, with nobody shooting at you yet. '
        + 'Each card teaches one thing and waits until you have done it. Enter skips '
        + 'a step you already know; ' + key('pause') + ' leaves at any time.',
      goal: 'Press Enter when you are ready',
      keys: () => ['Enter'],
      test: () => false,            // Enter advances it; see the key handler
    },

    {
      id: 'move',
      title: 'Move',
      body: () => 'You run with ' + key('up') + ' ' + key('left') + ' ' + key('down') + ' '
        + key('right') + '. The ground matters: roads are the fast way across the map, '
        + 'sand drags, and deep water slows you to a swim. Walk to the marker.',
      goal: 'Reach the marker',
      keys: () => ['W', 'A', 'S', 'D'],
      marker: (a) => ({ x: a.arena.walk.x, y: a.arena.walk.y, r: 70 }),
      setup: (a, m) => { m.d0 = Math.max(1, dist(a.player, a.arena.walk)); },
      progress: (a, m) => 1 - clamp(dist(a.player, a.arena.walk) / m.d0, 0, 1),
      test: (a) => dist(a.player, a.arena.walk) < 70,
    },

    {
      id: 'aim',
      title: 'Aim',
      body: () => 'There is no aim key — your operator always faces the cursor and the '
        + 'gun fires down that line. Put the crosshair on the near target.',
      goal: 'Hold the crosshair on the target',
      keys: () => ['Mouse'],
      marker: (a) => tag(a, 'near'),
      progress: (a, m) => clamp((m.held || 0) / 0.6, 0, 1),
      test: (a, m, dt) => {
        const d = tag(a, 'near');
        if (!d) return true;
        const want = Math.atan2(d.y - a.player.y, d.x - a.player.x);
        m.held = angDiff(want, a.player.angle) < 0.16 ? (m.held || 0) + dt : 0;
        return m.held >= 0.6;
      },
    },

    {
      id: 'shoot',
      title: 'Shoot',
      body: (a) => 'Left click fires. ' + (a.player.weapon.action === 'auto'
        ? 'Yours is automatic — hold it down, but a long burst walks off target.'
        : 'Yours fires one round per click.')
        + ' Rounds and magazine are bottom left. Drop the near target.',
      goal: 'Knock down the near target',
      keys: () => ['L-Click'],
      marker: (a) => tag(a, 'near'),
      test: (a) => downed(a, 'near'),
    },

    {
      id: 'reload',
      title: 'Reload',
      body: () => 'Press ' + key('reload') + '. Do it in cover and not in the open — a '
        + 'magazine is the longest you are ever defenceless.',
      goal: 'Reload your weapon',
      keys: () => [key('reload')],
      test: (a) => a.player.reloadTimer > 0,
    },

    {
      id: 'ads',
      title: 'Aim down sights',
      body: () => 'Hold right click. Your cone of fire tightens and firing on the move '
        + 'stops costing you as much accuracy — at the price of speed. Take the far '
        + 'target down while aiming.',
      goal: 'Aim, then drop the far target',
      keys: () => ['R-Click'],
      marker: (a) => tag(a, 'far'),
      progress: (a, m) => clamp(((m.held || 0) / 0.8) * 0.5, 0, 0.5) + (downed(a, 'far') ? 0.5 : 0),
      test: (a, m, dt) => {
        if (a.input.ads) m.held = (m.held || 0) + dt;
        return (m.held || 0) >= 0.8 && downed(a, 'far');
      },
    },

    {
      id: 'dash',
      title: 'Dash',
      body: () => key('dash') + ' throws you a short distance instantly, then goes on '
        + 'cooldown. It is how you cross the last stretch of open ground into cover.',
      goal: 'Dash once',
      keys: () => [key('dash')],
      test: (a) => a.input.dashCd > 0,
    },

    {
      id: 'cover',
      title: 'Cover is destructible',
      body: () => 'Every wall, crate, tree and barrel here has health and a toughness. '
        + 'Rounds stop dead in timber, skip off metal and lose half their damage through '
        + 'a barricade — and the flimsiest cover comes down under rifle fire. Shoot it down.',
      goal: 'Destroy the barricade',
      keys: () => ['L-Click'],
      marker: (a) => (a.arena.wall && a.arena.wall.hp > 0
        ? { x: a.arena.wall.x + a.arena.wall.w / 2, y: a.arena.wall.y + a.arena.wall.h / 2, r: 60 }
        : null),
      progress: (a) => (a.arena.wall ? 1 - clamp(a.arena.wall.hp / a.arena.wall.maxHp, 0, 1) : 1),
      test: (a) => !a.arena.wall || a.arena.wall.hp <= 0 || a.obstacles.indexOf(a.arena.wall) < 0,
    },

    {
      id: 'door',
      title: 'Doors and buildings',
      body: () => 'Buildings are places you go inside — out on the map the roof lifts as '
        + 'you step in, and the loot is worth the risk of being cornered. ' + key('interact')
        + ' opens a door. Or breach a wall and come in where nobody is watching.',
      goal: 'Open the door',
      keys: () => [key('interact')],
      marker: (a) => (a.arena.door
        ? { x: a.arena.door.x + a.arena.door.w / 2, y: a.arena.door.y + a.arena.door.h / 2, r: 60 }
        : null),
      test: (a) => !a.arena.door || a.arena.door.open || a.arena.door.hp <= 0,
    },

    {
      id: 'crate',
      title: 'Loot',
      body: () => 'Crates hold armour, ammo, heals, grenades — and out of a gold one, a '
        + 'legendary version of the best gun in your class. Stand on it and press '
        + key('interact') + '. Armour buys survivability and costs you speed.',
      goal: 'Open the crate',
      keys: () => [key('interact')],
      marker: (a) => (a.arena.crate && !a.arena.crate.opened
        ? { x: a.arena.crate.x, y: a.arena.crate.y, r: 55 } : null),
      test: (a) => !a.arena.crate || a.arena.crate.opened,
    },

    {
      id: 'tool',
      title: 'Your class tool',
      body: (a) => 'Your gun decides your class, and every class carries one tool on '
        + key('tool') + '. Yours is the ' + a.player.tool.name
        + ((a.player.tool.effects || []).length
          ? ' — ' + a.player.tool.effects.join(', ').toLowerCase() + '.' : '.'),
      goalOf: (a) => 'Use the ' + a.player.tool.name,
      keys: () => [key('tool')],
      setup: (a, m) => { m.was = !!a.player.toolActive; },
      test: (a, m) => a.player.swingT > 0 || (!!a.player.toolActive !== m.was) || a.player.toolCd > 0,
    },

    {
      id: 'grenade',
      title: 'Grenades',
      body: () => key('grenade') + ' throws whatever is in your grenade slot, and it '
        + 'lands where the cursor is — point further out to throw further. Blasts are '
        + 'checked against real line of sight, so a wall between you and it saves you.',
      goal: 'Throw a grenade',
      keys: () => [key('grenade')],
      skipIf: (a) => !slotHas(a, 'grenade'),
      setup: (a, m) => { m.n = a.grenades.length; },
      test: (a, m) => {
        const grew = a.grenades.length > m.n;
        m.n = Math.max(m.n, a.grenades.length);
        return grew;
      },
    },

    {
      id: 'tactical',
      title: 'Tactical deploys',
      body: () => key('tactical') + ' puts your tactical item on the ground where you '
        + 'stand — mines, sentry guns, ammo boxes, barricades. They stay there until '
        + 'they are used, triggered or shot off the map.',
      goalOf: () => 'Deploy your tactical',
      keys: () => [key('tactical')],
      skipIf: (a) => !slotHas(a, 'tactical'),
      setup: (a, m) => { m.n = a.deployables.length; },
      test: (a, m) => a.deployables.length > m.n,
    },

    {
      id: 'heal',
      title: 'Healing',
      body: () => 'You have been hit. ' + key('heal') + ' uses your heal — it channels, '
        + 'and it slows you while it runs, so break contact first. Boosts (pills, soda, '
        + 'stim) give adrenaline instead: speed, faster reloads, damage reduction.',
      goal: 'Heal back up',
      keys: () => [key('heal')],
      setup: (a, m) => {
        a.hurtPlayer(a.player.maxHp * 0.55);
        m.hp = a.player.hp;
        a.msg('You are hurt — press ' + key('heal'));
      },
      progress: (a, m) => clamp((a.player.hp - m.hp) / Math.max(1, a.player.maxHp - m.hp), 0, 1),
      test: (a, m) => a.player.hp >= Math.min(a.player.maxHp, m.hp + 15) || a.player.adrenaline > 5,
    },

    {
      id: 'ping',
      title: 'Talk to your squad',
      body: () => 'Middle click marks whatever you are looking at for the whole squad. '
        + key('ping') + ' opens the full ping wheel (enemy here, need help, rally), '
        + key('emote') + ' the emotes, and ' + key('scoreboard') + ' shows the scores.',
      goal: 'Place a ping',
      keys: () => ['M-Click', key('ping')],
      setup: (a, m) => { m.n = a.marks.length; },
      test: (a, m) => a.marks.length > m.n,
    },

    {
      id: 'capture',
      title: 'Objectives',
      body: () => 'This ring is a capture point, and it is the whole of Domination: '
        + 'stand in it to take it, hold it to score, first squad to the cap wins. More '
        + 'of you on it takes it faster; one enemy standing on it stops you dead.',
      goal: 'Capture the point',
      keys: () => ['W', 'A', 'S', 'D'],
      marker: (a) => (a.objectives[0]
        ? { x: a.objectives[0].x, y: a.objectives[0].y, r: a.objectives[0].r, soft: true } : null),
      progress: (a) => {
        const o = a.objectives[0];
        return !o ? 1 : o.owner === 0 ? 1 : clamp(o.progress / 100, 0, 1);
      },
      test: (a) => !a.objectives[0] || a.objectives[0].owner === 0,
    },

    {
      id: 'fight',
      title: 'Contact',
      body: () => 'Three hostiles, and these ones shoot back. Use the cover you have — '
        + 'they aim, they flank, they heal and they will push you if you stand still. '
        + 'Head hits do double, limbs half, and armour changes both.',
      goalOf: () => 'Eliminate the hostiles',
      keys: () => ['L-Click'],
      setup: (a, m) => { m.foes = a.spawnHostiles(3); a.msg('Contact — three hostiles'); },
      progress: (a, m) => 1 - (m.foes || []).filter(f => f.alive).length / Math.max(1, (m.foes || []).length),
      count: (a, m) => (m.foes || []).filter(f => f.alive).length + ' left',
      test: (a, m) => (m.foes || []).length > 0 && (m.foes || []).every(f => !f.alive),
    },

    {
      id: 'done',
      title: 'Training complete',
      body: () => 'That is the game. Domination: hold the points to the score cap. '
        + 'Elimination: last squad standing, no respawns. Next is a guided match — a real '
        + 'game, three a side, five minutes, with a coach calling out what to do and why.',
      goal: 'Enter — start the guided match',
      keys: () => ['Enter'],
      test: () => false,
      final: true,
    },
  ];

  /* ============================================================
     RUNNING IT
     ============================================================ */
  function begin(worldApi) {
    api = worldApi;
    steps = STEPS.slice();
    idx = 0; memo = {}; doneT = 0;
    running = true; finished = false;
    toastT = 0;
    bindKeys();
    enter();
  }

  function stop() { running = false; api = null; }

  /* A step whose lesson does not apply to this loadout is dropped rather than
     stared at: a Rifleman carries no tactical item, so "deploy your tactical"
     would be an instruction nobody could follow. */
  function enter() {
    while (idx < steps.length && steps[idx].skipIf && safe(() => steps[idx].skipIf(api), false)) idx++;
    memo = {}; doneT = 0;
    const s = steps[idx];
    if (!s) { finished = true; running = false; return; }
    if (s.setup) safe(() => s.setup(api, memo));
    if (s.final) { finished = true; markComplete(); }
    if (typeof SFX !== 'undefined') SFX.click();
  }

  function advance() {
    if (!steps[idx] || steps[idx].final) return;    // the last card is the end of the road
    idx++;
    enter();
  }

  /* Errors inside one lesson must not take the match down with them: a step
     that throws is treated as passed and the training carries on. */
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { console.warn('[tutorial]', e); return fallback; }
  }

  function update(dt) {
    if (!running || !api || !api.player) return;
    if (toastT > 0) toastT -= dt;
    const s = steps[idx];
    if (!s) return;
    if (doneT > 0) {
      doneT -= dt;
      if (doneT <= 0) advance();
      return;
    }
    if (safe(() => !!s.test(api, memo, dt), false)) {
      doneT = 1.1;
      toastText = s.title + ' — done';
      toastT = 2.2;
      if (typeof SFX !== 'undefined') SFX.reward();
    }
  }

  /* Enter is the one key this file owns: it advances the two cards that have
     nothing to do, and skips a lesson somebody cannot or would rather not
     finish. Every step is skippable on purpose — being stuck in a tutorial is
     worse than missing one of its lessons. */
  let keysBound = false;
  function bindKeys() {
    if (keysBound) return;
    keysBound = true;
    window.addEventListener('keydown', (e) => {
      if (!running || !api) return;
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      e.preventDefault();
      const s = steps[idx];
      if (s && s.final) { api.deploy(); return; }
      if (doneT > 0) { doneT = 0; }
      advance();
    });
  }

  /* Finishing is remembered, so the home screen can stop recommending it and
     a returning player is not nagged about it forever. */
  function markComplete() {
    try {
      const p = DB.getProfile();
      if (p && !p.tutorialDone) {
        p.tutorialDone = true;
        DB.saveProfile(p);
        if (typeof Toast !== 'undefined') Toast.show('Basic Training complete', 'reward');
      }
    } catch (e) { console.warn('[tutorial]', e); }
  }

  /* ============================================================
     DRAWING — world markers first, then the card
     ============================================================ */
  function drawWorld(ctx, t) {
    if (!running || !api || !steps[idx]) return;
    const s = steps[idx];
    // the three practice targets carry their distance, the way the range does
    for (const d of api.agents) {
      if (!d.tutorTag || !d.alive) continue;
      ctx.save();
      ctx.fillStyle = 'rgba(226,236,255,0.7)';
      ctx.font = 'bold 12px Azeret Mono, ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(dist(api.player, d) / api.PX_PER_M) + ' m', d.x, d.y - 34);
      ctx.restore();
    }
    const m = s.marker ? safe(() => s.marker(api, memo), null) : null;
    if (!m) return;
    const pulse = 0.55 + 0.45 * Math.sin(t / 260);
    ctx.save();
    ctx.strokeStyle = 'rgba(127,242,193,' + (0.35 + 0.4 * pulse).toFixed(3) + ')';
    ctx.fillStyle = 'rgba(127,242,193,0.10)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r || 60, 0, Math.PI * 2);
    if (!m.soft) ctx.fill();
    ctx.stroke();
    // a beacon over it, so a marker behind a building is still findable
    if (!m.soft) {
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - 54 - 8 * pulse);
      ctx.lineTo(m.x - 9, m.y - 74 - 8 * pulse);
      ctx.lineTo(m.x + 9, m.y - 74 - 8 * pulse);
      ctx.closePath();
      ctx.fillStyle = 'rgba(127,242,193,0.9)'; ctx.fill();
    }
    ctx.restore();
  }

  const CARD_W = 372;
  function drawHud(ctx, W, H, t) {
    if (!running || !api || !steps[idx]) return;
    const s = steps[idx];
    const done = doneT > 0;
    const body = safe(() => (typeof s.body === 'function' ? s.body(api, memo) : s.body), '');
    const goal = safe(() => (s.goalOf ? s.goalOf(api, memo) : s.goal), '') || '';
    const caps = safe(() => (typeof s.keys === 'function' ? s.keys(api) : s.keys), []) || [];
    const prog = s.progress ? clamp(safe(() => s.progress(api, memo), 0) || 0, 0, 1) : null;
    const count = s.count ? safe(() => s.count(api, memo), '') : '';

    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.font = '13px Outfit, Segoe UI, sans-serif';
    const lines = wrap(ctx, body, CARD_W - 36);
    const h = 104 + lines.length * 19 + (caps.length ? 30 : 0) + (goal ? 26 : 0) + (prog !== null ? 16 : 0);
    const x = 22, y = Math.max(96, H / 2 - h / 2);

    ctx.fillStyle = 'rgba(10,14,24,0.88)';
    roundRect(ctx, x, y, CARD_W, h, 12); ctx.fill();
    ctx.strokeStyle = done ? 'rgba(127,242,193,0.9)' : 'rgba(127,242,193,0.35)';
    ctx.lineWidth = done ? 2 : 1.3; ctx.stroke();

    // step counter, and a run of dots beside it so the length is visible
    ctx.textAlign = 'left';
    ctx.font = 'bold 10px Outfit, Segoe UI, sans-serif';
    ctx.fillStyle = 'rgba(200,212,232,0.55)';
    ctx.fillText('BASIC TRAINING  ·  ' + Math.min(idx + 1, steps.length) + ' / ' + steps.length,
      x + 18, y + 24);
    for (let i = 0; i < steps.length; i++) {
      ctx.fillStyle = i < idx ? 'rgba(127,242,193,0.75)'
        : i === idx ? '#7ff2c1' : 'rgba(200,212,232,0.22)';
      ctx.beginPath(); ctx.arc(x + 20 + i * 10, y + 36, i === idx ? 3.4 : 2.2, 0, Math.PI * 2); ctx.fill();
    }

    let ty = y + 66;
    ctx.font = 'bold 19px Outfit, Segoe UI, sans-serif';
    ctx.fillStyle = done ? '#7ff2c1' : '#f4f8ff';
    ctx.fillText((done ? '✔  ' : '') + s.title, x + 18, ty);
    ty += 24;

    ctx.font = '13px Outfit, Segoe UI, sans-serif';
    ctx.fillStyle = 'rgba(214,226,246,0.85)';
    for (const ln of lines) { ctx.fillText(ln, x + 18, ty); ty += 19; }

    if (caps.length) {
      ty += 8;
      let cx = x + 18;
      for (const c of caps) cx += drawCap(ctx, c, cx, ty - 15);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ty += 22;
    }

    if (goal) {
      ty += 6;
      ctx.font = 'bold 12px Outfit, Segoe UI, sans-serif';
      ctx.fillStyle = done ? 'rgba(127,242,193,0.9)' : '#ffcf4a';
      ctx.fillText('▸ ' + goal + (count ? '   ·   ' + count : ''), x + 18, ty);
      ty += 12;
    }

    if (prog !== null) {
      const bw = CARD_W - 36;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      roundRect(ctx, x + 18, ty, bw, 5, 3); ctx.fill();
      ctx.fillStyle = done ? '#7ff2c1' : 'rgba(127,242,193,0.75)';
      roundRect(ctx, x + 18, ty, Math.max(4, bw * (done ? 1 : prog)), 5, 3); ctx.fill();
    }

    // the escape hatch, always on the card
    ctx.font = '10px Outfit, Segoe UI, sans-serif';
    ctx.fillStyle = 'rgba(200,212,232,0.45)';
    ctx.fillText(s.final
      ? 'Enter — start the guided match   ·   ' + key('pause') + ' — back to base'
      : 'Enter — skip this step   ·   ' + key('pause') + ' — pause / leave',
      x + 18, y + h - 13);

    // the completed-step banner, up where the eye already is
    if (toastT > 0 && !s.final) {
      ctx.globalAlpha = clamp(toastT, 0, 1);
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px Outfit, Segoe UI, sans-serif';
      ctx.fillStyle = '#7ff2c1';
      ctx.fillText(toastText, W / 2, 118);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  return {
    begin, stop, update, drawWorld, drawHud,
    isActive: () => running,
    isFinished: () => finished,
    stepId: () => (steps[idx] ? steps[idx].id : null),
    /* for tests and the console: how long the training is, and where in it we are */
    debug: () => ({ idx, total: steps.length, id: steps[idx] && steps[idx].id, finished }),
  };
})();
