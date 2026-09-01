/* ============================================================
   coach.js — the guided match: a real game with somebody
   standing behind you.

   Basic Training teaches the verbs one at a time in an empty
   field. It cannot teach the thing that actually loses new
   players their first ten matches, which is *when* to do any of
   it: when to break contact, when to reload, when to leave a
   fight you are winning because the point is somewhere else.

   So the guided match is not a tutorial. It is an ordinary
   Domination game — real bots, real score, real XP at the end —
   with two things added: a coach that watches the match and says
   one useful thing at a time, and a debrief afterwards that is
   computed from what you actually did rather than from what the
   scoreboard says.

   Every prompt below is a rule with a condition, a priority and
   a cooldown. The engine shows the most urgent rule that fires
   and then shuts up: a coach that talks constantly is noise, and
   noise is indistinguishable from no coach at all.
   ============================================================ */
const Coach = (() => {

  const key = (id) => (typeof Controls !== 'undefined' ? Controls.labelFor(id) : '?');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  let api = null;
  let running = false;
  let cur = null;              // the tip on screen
  let curT = 0;                // ...and how long it has left
  let sinceTip = 99;           // seconds since the last one ended
  const cd = {};               // per-rule cooldown clocks
  const fired = {};            // how many times each rule has fired

  /* What the debrief is built from. Sampled as the match runs, because none
     of it can be recovered afterwards from the scoreboard. */
  let tally = null;
  const freshTally = () => ({
    t: 0, onPointT: 0, lowHpT: 0, aliveT: 0,
    deaths: 0, deathsWithHeal: 0, deathsInOpen: 0,
    grenades: 0, heals: 0, captures: 0,
    prompts: 0, startedWithGrenades: 0,
  });

  /* ---------- reading the match ---------- */
  const mates = () => api.agents.filter(a => a.alive && a.team === api.player.team && a !== api.player && !a.isVehicle);
  const foes = () => api.agents.filter(a => a.alive && a.team !== api.player.team && !a.isVehicle);
  function nearestFoe() {
    let best = null, bd = Infinity;
    for (const f of foes()) { const d = dist(api.player, f); if (d < bd) { bd = d; best = f; } }
    return { foe: best, d: bd };
  }
  const seenFoe = (f) => f && api.hasLOS(api.player.x, api.player.y, f.x, f.y);
  const onPoint = () => api.objectives.find(o => dist(api.player, o) < o.r) || null;
  /* Where the score is: an enemy-held or neutral point, nearest first. Ours
     with a capture running against it counts as well — that is the one that is
     actively being taken off us. */
  function pushTarget() {
    let best = null, bd = Infinity;
    for (const o of api.objectives) {
      const contested = o.owner === api.player.team && o.progress > 20 && o.capTeam !== api.player.team;
      if (o.owner === api.player.team && !contested) continue;
      const d = dist(api.player, o);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  const held = () => api.objectives.filter(o => o.owner === api.player.team).length;
  const healSlot = () => (api.player.inv && api.player.inv.heal) || null;
  const nadeSlot = () => (api.player.inv && api.player.inv.grenade) || null;
  const hasHeal = () => { const s = healSlot(); return !!(s && s.id && s.n > 0); };
  const hasNade = () => { const s = nadeSlot(); return !!(s && s.id && s.n > 0); };
  const hpFrac = () => api.player.hp / Math.max(1, api.player.maxHp);
  const ammoFrac = () => api.player.ammo / Math.max(1, api.player.weapon.mag);
  const metres = (px) => Math.round(px / api.PX_PER_M);
  function nearestCrate() {
    let best = null, bd = Infinity;
    for (const c of api.crates) {
      if (c.opened) continue;
      const d = dist(api.player, c);
      if (d < bd) { bd = d; best = c; }
    }
    return { crate: best, d: bd };
  }
  const downedMate = () => mates().find(m => m.downed && dist(api.player, m) < 900) || null;

  /* ============================================================
     THE RULES

     `pri` is urgency, lowest first — a rule can only interrupt a
     tip that is less urgent than it is. `cool` is how long before
     the same rule may fire again, so the coach never nags.
     ============================================================ */
  const RULES = [
    /* ---- staying alive ---- */
    {
      id: 'heal-now', pri: 1, cool: 14, life: 5, tone: 'warn',
      when: () => api.player.alive && hpFrac() < 0.42 && hasHeal() && !api.player.channel,
      text: () => `${Math.round(api.player.hp)} HP. Break line of sight and heal — you do not win this trade.`,
      keys: () => [key('heal')],
    },
    {
      id: 'in-the-open', pri: 2, cool: 26, life: 5, tone: 'warn',
      when: () => {
        const { foe, d } = nearestFoe();
        return api.player.alive && api.player.hurtT < 1.5 && foe && d < 900 && seenFoe(foe);
      },
      text: () => 'You are being shot at in the open. Put a wall between you and them, then fight from it.',
      keys: () => ['W', 'A', 'S', 'D'],
    },
    {
      id: 'reload', pri: 4, cool: 20, life: 4, tone: 'info',
      when: () => {
        const { d } = nearestFoe();
        return api.player.alive && ammoFrac() <= 0.3 && api.player.reloadTimer <= 0 && d > 700;
      },
      text: () => `${api.player.ammo} rounds left. Reload now, not at the next corner.`,
      keys: () => [key('reload')],
    },

    /* ---- the objective, which is the whole mode ---- */
    {
      id: 'take-point', pri: 5, cool: 24, life: 6, tone: 'info',
      when: () => api.player.alive && !onPoint() && !!pushTarget(),
      text: () => {
        const o = pushTarget();
        return `Point ${o.name} is ${o.owner < 0 ? 'nobody’s' : 'theirs'} — ${metres(dist(api.player, o))} m away. `
          + 'Standing in the ring is what scores; kills anywhere else do not.';
      },
      keys: () => ['W', 'A', 'S', 'D'],
      marker: () => { const o = pushTarget(); return o && { x: o.x, y: o.y, r: o.r, label: 'TAKE ' + o.name }; },
    },
    {
      id: 'hold-point', pri: 7, cool: 40, life: 5, tone: 'good',
      when: () => {
        const o = onPoint();
        return !!o && o.owner === api.player.team && held() >= 2;
      },
      text: () => 'You hold this one. Stay on it and let the score run — fight from cover on the ring, not out in front of it.',
      keys: () => [],
    },
    {
      id: 'behind', pri: 6, cool: 60, life: 6, tone: 'warn',
      when: () => {
        const mine = api.teamScores[api.player.team] || 0;
        const best = Math.max(...api.teamScores.map((s, i) => (i === api.player.team ? 0 : s)));
        return api.player.alive && best - mine > api.scoreCap * 0.18 && held() < 2;
      },
      text: () => 'You are behind, and one point will not catch up. Take a second one — two held points score twice as fast.',
      keys: () => [],
      marker: () => { const o = pushTarget(); return o && { x: o.x, y: o.y, r: o.r, label: 'TAKE ' + o.name }; },
    },
    {
      id: 'endgame', pri: 3, cool: 999, life: 7, tone: 'warn', once: true,
      when: () => api.player.alive && api.timeLeft < 90 && api.timeLeft > 0,
      text: () => (held() >= 2
        ? 'Ninety seconds. You are holding enough to win it — do not leave the points now.'
        : 'Ninety seconds left. Whatever you are doing, do it on a capture point.'),
      keys: () => [],
    },

    /* ---- your kit, which most people forget they have ---- */
    {
      id: 'use-nade', pri: 8, cool: 45, life: 5, tone: 'info',
      when: () => {
        const { foe, d } = nearestFoe();
        return api.player.alive && hasNade() && tally.grenades === 0 && foe && d < 700 && d > 220;
      },
      text: () => {
        const s = nadeSlot();
        const it = (typeof Items !== 'undefined' && Items.CONSUMABLES[s.id]) || { name: s.id };
        return `You are still carrying ${s.n}× ${it.name}. It lands where your cursor is — use it on a room you do not want to walk into.`;
      },
      keys: () => [key('grenade')],
    },
    {
      id: 'get-armour', pri: 9, cool: 50, life: 5, tone: 'info',
      when: () => {
        const { crate, d } = nearestCrate();
        return api.player.alive && !api.player.vest && crate && d < 800 && nearestFoe().d > 800;
      },
      text: () => `Crate ${metres(nearestCrate().d)} m away and you have no vest. Armour is the difference between losing a fight and surviving it.`,
      keys: () => [key('interact')],
      marker: () => { const { crate } = nearestCrate(); return crate && { x: crate.x, y: crate.y, r: 46, label: 'LOOT' }; },
    },
    {
      id: 'ads', pri: 10, cool: 35, life: 4, tone: 'info',
      when: () => {
        const { foe, d } = nearestFoe();
        return api.player.alive && foe && seenFoe(foe) && d > 620 && !api.input.ads;
      },
      text: () => 'That is a long shot standing up. Hold right click — aiming tightens your cone and halves the penalty for moving.',
      keys: () => ['R-Click'],
    },

    /* ---- the squad ---- */
    {
      id: 'revive', pri: 2, cool: 18, life: 6, tone: 'good',
      when: () => api.player.alive && !!downedMate(),
      text: () => {
        const m = downedMate();
        return `${m.name || 'A squadmate'} is down ${metres(dist(api.player, m))} m away. Stand over them until the bar fills — a revived mate is worth more than the kill you are chasing.`;
      },
      keys: () => [],
      marker: () => { const m = downedMate(); return m && { x: m.x, y: m.y, r: 60, label: 'REVIVE' }; },
    },

    /* ---- after something happened ---- */
    {
      id: 'died', pri: 1, cool: 8, life: 6, tone: 'bad',
      when: (s) => !api.player.alive && s.justDied,
      text: () => {
        const r = api.deathRecap;
        if (!r) return 'Down. You come back in a few seconds — this mode forgives that.';
        /* The recap already quotes its distance in metres and knows what the
           killer had left, which is the number that says whether that fight
           was close or was never yours. */
        return `${r.killer} killed you from ${r.dist} m with ${r.weapon}`
          + (r.killerHp !== null && r.killerHp !== undefined ? `, finishing on ${r.killerHp} HP` : '')
          + '. Come back a different way, not the same one.';
      },
      keys: () => [],
    },
    {
      id: 'captured', pri: 3, cool: 20, life: 4, tone: 'good',
      when: (s) => s.justCaptured,
      text: () => 'Point taken — that is where your score comes from. Now hold it: the bar bleeds back the moment it is contested.',
      keys: () => [],
    },
    {
      id: 'first-blood', pri: 6, cool: 999, life: 4, tone: 'good', once: true,
      when: (s) => s.justKilled,
      text: () => 'Good trade. Reload before you push on — the next one is already looking at that doorway.',
      keys: () => [key('reload')],
    },

    /* ---- the opening line, so the match starts with a plan ---- */
    {
      id: 'opening', pri: 1, cool: 999, life: 9, tone: 'info', once: true,
      when: () => api.player.alive && tally.t > 1.5,
      text: () => 'Guided match: real bots, real score, real XP. Three points on the map — hold two of them and you win. '
        + 'I will only speak up when there is something worth saying.',
      keys: () => [],
      marker: () => { const o = pushTarget(); return o && { x: o.x, y: o.y, r: o.r, label: 'START HERE' }; },
    },
  ];

  /* ============================================================
     RUNNING IT
     ============================================================ */
  let last = null;
  function begin(worldApi) {
    api = worldApi;
    running = true;
    cur = null; curT = 0; sinceTip = 99;
    for (const k of Object.keys(cd)) delete cd[k];
    for (const k of Object.keys(fired)) delete fired[k];
    tally = freshTally();
    tally.startedWithGrenades = hasNade() ? nadeSlot().n : 0;
    last = {
      alive: true, captures: api.stats.captures, kills: api.stats.kills,
      grenade: tally.startedWithGrenades, heal: hasHeal() ? healSlot().n : 0,
    };
  }
  function stop() { running = false; cur = null; api = null; }

  const MIN_GAP = 3;          // seconds of quiet between two tips
  let evalT = 0;

  function update(dt) {
    if (!running || !api || !api.player) return;
    sample(dt);
    if (curT > 0) { curT -= dt; if (curT <= 0) { cur = null; sinceTip = 0; } }
    else sinceTip += dt;
    for (const id of Object.keys(cd)) cd[id] = Math.max(0, cd[id] - dt);

    /* Rules are cheap but not free — line of sight and nearest-anything walk
       the agent list — and nothing about advice needs sixty answers a second. */
    evalT -= dt;
    if (evalT > 0) return;
    evalT = 0.2;

    const s = events();
    for (const r of RULES) {
      if (cd[r.id] > 0) continue;
      if (r.once && fired[r.id]) continue;
      if (cur && r.pri >= cur.pri) continue;          // never interrupt for something less urgent
      if (!cur && sinceTip < MIN_GAP && r.pri > 3) continue;
      let ok = false;
      try { ok = !!r.when(s); } catch (e) { console.warn('[coach]', r.id, e); }
      if (!ok) continue;
      show(r);
      break;
    }
  }

  function show(r) {
    let text = '', keys = [];
    try { text = r.text(); keys = (r.keys && r.keys()) || []; }
    catch (e) { console.warn('[coach]', r.id, e); return; }
    cur = { id: r.id, pri: r.pri, tone: r.tone, text, keys, marker: r.marker || null };
    curT = r.life;
    cd[r.id] = r.cool;
    fired[r.id] = (fired[r.id] || 0) + 1;
    tally.prompts++;
    if (typeof SFX !== 'undefined') SFX.click();
  }

  /* One-frame events the rules read: things that just happened rather than
     things that are true. Derived by watching the numbers move, so nothing in
     game.js has to call us. */
  function events() {
    const p = api.player;
    const s = { justDied: false, justCaptured: false, justKilled: false };
    if (last.alive && !p.alive) { s.justDied = true; onDeath(); }
    last.alive = p.alive;
    if (api.stats.captures > last.captures) { s.justCaptured = true; tally.captures++; }
    last.captures = api.stats.captures;
    if (api.stats.kills > last.kills) s.justKilled = true;
    last.kills = api.stats.kills;
    return s;
  }

  /* Per-frame sampling for the debrief. */
  function sample(dt) {
    const p = api.player;
    tally.t += dt;
    if (p.alive) {
      tally.aliveT += dt;
      if (onPoint()) tally.onPointT += dt;
      if (hpFrac() < 0.4) tally.lowHpT += dt;
    }
    const n = hasNade() ? nadeSlot().n : 0;
    if (n < last.grenade) tally.grenades += last.grenade - n;
    last.grenade = n;
    const h = hasHeal() ? healSlot().n : 0;
    if (h < last.heal) tally.heals += last.heal - h;
    last.heal = h;
  }

  function onDeath() {
    tally.deaths++;
    if (hasHeal()) tally.deathsWithHeal++;
  }

  /* ============================================================
     THE DEBRIEF

     Written from what was sampled, not from the scoreline. Three
     to five lines, each one a thing to do differently, and each
     one carrying the number it is based on so it can be argued
     with rather than just believed.
     ============================================================ */
  function debriefLines() {
    if (!tally || tally.t < 5) return [];
    const st = api ? api.stats : { shots: 0, hits: 0, kills: 0, captures: 0 };
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : null;
    const onPct = tally.aliveT > 0 ? Math.round((tally.onPointT / tally.aliveT) * 100) : 0;
    const out = [];

    if (onPct < 25) {
      out.push({ tone: 'bad', head: `${onPct}% of your match on a point`,
        body: 'Domination pays for standing in the ring and nothing else. Fight *from* the point rather than on the way to it.' });
    } else if (onPct > 45) {
      out.push({ tone: 'good', head: `${onPct}% of your match on a point`,
        body: 'That is where the score came from. Keep doing that.' });
    }

    if (acc !== null && st.shots > 25) {
      if (acc < 20) {
        out.push({ tone: 'bad', head: `${acc}% accuracy — ${st.hits} of ${st.shots} rounds`,
          body: 'Short bursts, and hold right click past about 20 m. Firing while running opens your cone more than anything else you can do.' });
      } else if (acc > 38) {
        out.push({ tone: 'good', head: `${acc}% accuracy — ${st.hits} of ${st.shots} rounds`,
          body: 'Well disciplined. Most of a new player’s magazine goes into the scenery.' });
      }
    }

    if (tally.deathsWithHeal >= 2) {
      out.push({ tone: 'bad', head: `${tally.deathsWithHeal} deaths with a heal still in your kit`,
        body: `Below about 40 HP you lose the trade whatever you do. Break contact, press ${key('heal')}, come back.` });
    }

    if (tally.startedWithGrenades > 0 && tally.grenades === 0) {
      out.push({ tone: 'warn', head: 'You finished with every grenade you started with',
        body: `${key('grenade')} throws to where the cursor is. A room you do not want to walk into is exactly what it is for.` });
    }

    if (tally.captures > 0) {
      out.push({ tone: 'good', head: `${tally.captures} capture${tally.captures > 1 ? 's' : ''}`,
        body: 'Captures are worth more to your squad than the kills are. That is the habit worth keeping.' });
    }

    if (!out.length) {
      out.push({ tone: 'good', head: 'A clean match',
        body: 'Nothing to pick at: you held ground, you used your kit and you did not throw fights you were winning.' });
    }
    return out.slice(0, 4);
  }

  /* Rendered into the results panel by game.js at the end of a guided match. */
  function renderDebrief(box) {
    if (!box) return;
    const lines = debriefLines();
    if (!lines.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<h4 class="debrief__title">Coach’s debrief</h4>'
      + lines.map(l => `<div class="debrief__row debrief__row--${l.tone}">`
        + `<b>${l.head}</b><span>${l.body}</span></div>`).join('');
    /* The match is over and the panel now says everything the card would.
       Leaving the card live would draw it behind the results box for as long
       as they sit there. The tally stays, because the debrief is built from
       it every time it is asked for. */
    cur = null; running = false;
    markDone();
  }

  function markDone() {
    try {
      const p = DB.getProfile();
      if (p && !p.guidedDone) { p.guidedDone = true; DB.saveProfile(p); }
    } catch (e) { console.warn('[coach]', e); }
  }

  /* ============================================================
     DRAWING
     ============================================================ */
  const TONE = {
    info: { ink: '#7ff2c1', mark: 'THIS HELPS' },
    warn: { ink: '#ffcf4a', mark: 'WATCH OUT' },
    good: { ink: '#4be08a', mark: 'GOOD' },
    bad: { ink: '#ff7a7a', mark: 'THAT COST YOU' },
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/);
    const out = []; let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; }
      else line = t;
    }
    if (line) out.push(line);
    return out;
  }
  function drawCap(ctx, label, x, y, ink) {
    ctx.font = 'bold 11px Azeret Mono, ui-monospace, monospace';
    const w = Math.max(24, ctx.measureText(label).width + 16), h = 20;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = ink; ctx.lineWidth = 1.1;
    roundRect(ctx, x, y, w, h, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
    return w + 6;
  }

  /* The ring on the ground the current tip is pointing at. */
  function drawWorld(ctx, t) {
    if (!running || !api || !cur || !cur.marker) return;
    let m = null;
    try { m = cur.marker(); } catch (e) { return; }
    if (!m) return;
    const pulse = 0.55 + 0.45 * Math.sin(t / 280);
    const ink = (TONE[cur.tone] || TONE.info).ink;
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.35 * pulse;
    ctx.strokeStyle = ink; ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r || 60, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (m.label) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = ink;
      ctx.font = 'bold 13px Outfit, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(m.label, m.x, m.y - (m.r || 60) - 12);
    }
    ctx.restore();
  }

  /* The card itself: bottom centre, above the key legend, wide enough for a
     sentence and never more than three lines of one. */
  const CARD_W = 560;
  function drawHud(ctx, W, H) {
    if (!running || !api) return;
    // a standing chip, so it is always clear this match is being coached
    ctx.save();
    ctx.font = 'bold 10px Outfit, Segoe UI, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(127,242,193,0.55)';
    ctx.fillText('GUIDED MATCH', W / 2, 96);
    ctx.restore();

    if (!cur) return;
    const tone = TONE[cur.tone] || TONE.info;
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.font = '13.5px Outfit, Segoe UI, sans-serif';
    const lines = wrap(ctx, cur.text, CARD_W - 40);
    const h = 46 + lines.length * 20 + (cur.keys.length ? 28 : 0);
    const x = (W - CARD_W) / 2, y = H - h - 96;
    const fade = clamp(curT / 0.6, 0, 1);
    ctx.globalAlpha = fade;

    ctx.fillStyle = 'rgba(10,14,24,0.90)';
    roundRect(ctx, x, y, CARD_W, h, 12); ctx.fill();
    ctx.strokeStyle = tone.ink; ctx.lineWidth = 1.4; ctx.stroke();
    // the coloured spine, so the kind of advice reads before the words do
    ctx.fillStyle = tone.ink;
    roundRect(ctx, x, y + 10, 3, h - 20, 2); ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = 'bold 9.5px Outfit, Segoe UI, sans-serif';
    ctx.fillStyle = tone.ink;
    ctx.fillText('COACH  ·  ' + tone.mark, x + 20, y + 22);

    let ty = y + 42;
    ctx.font = '13.5px Outfit, Segoe UI, sans-serif';
    ctx.fillStyle = 'rgba(226,236,255,0.92)';
    for (const ln of lines) { ctx.fillText(ln, x + 20, ty); ty += 20; }

    if (cur.keys.length) {
      let cx = x + 20;
      for (const k of cur.keys) cx += drawCap(ctx, k, cx, ty - 4, tone.ink);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  return {
    begin, stop, update, drawWorld, drawHud, renderDebrief,
    isActive: () => running,
    /* for the console and for tests */
    debug: () => ({
      running, tip: cur && cur.id, prompts: tally ? tally.prompts : 0,
      tally: tally && Object.assign({}, tally),
      lines: running || tally ? debriefLines().map(l => l.head) : [],
    }),
  };
})();
