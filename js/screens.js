/* ============================================================
   screens.js — screen navigation + home page rendering + settings
   ============================================================ */

/* ---------- Toast notifications ---------- */
const Toast = (() => {
  const wrap = () => document.getElementById('toast-wrap');
  function show(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ` toast--${kind}` : '');
    el.textContent = msg;
    wrap().appendChild(el);
    if (kind === 'reward') SFX.reward();
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(-10px)'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }
  return { show };
})();

/* ---------- Screens ---------- */
const Screens = (() => {
  let selectedMode = 'domination';

  function show(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('is-active'));
    document.getElementById('screen-' + name).classList.add('is-active');
  }

  function enterHome() {
    const profile = DB.getProfile();
    if (!profile) { show('auth'); return; }
    Progression.ensureMissions(profile);
    Progression.ensureLoadout(profile);
    show('home');
    setView('play');
    renderAll();
  }

  /* ---- top nav view switching (play / missions / battlepass / loadout) ---- */
  function setView(view) {
    document.querySelector('.home').dataset.view = view;
    document.querySelectorAll('.topnav__btn').forEach(b =>
      b.classList.toggle('is-active', b.dataset.nav === view));
    if (view === 'missions') renderMissions();
    if (view === 'battlepass') renderBattlePass();
    if (view === 'loadout') renderLoadout();
    if (view === 'shop') renderShop();
    if (view === 'ranks') renderLeaderboard();
  }

  /* ---- leaderboard ----
     Standings from the profiles this machine actually has, plus the roster the
     matchmaker fills a game with, so a new player sees a board with names on
     it rather than one row containing themselves. Anyone generated is marked,
     because a leaderboard that quietly counts bots as people is lying. */
  let lbSort = 'wins';
  const LB_SORTS = [
    { id: 'wins', label: 'Wins' },
    { id: 'kills', label: 'Eliminations' },
    { id: 'level', label: 'Level' },
    { id: 'ratio', label: 'Elims per match' },
  ];

  function leaderboardRows() {
    const me = DB.getProfile();
    const rows = [];
    const all = (typeof DB.allProfiles === 'function') ? DB.allProfiles() : [me];
    for (const p of all) {
      if (!p) continue;
      rows.push({
        name: p.username, avatar: p.avatar, level: p.level || 1,
        wins: p.wins || 0, matches: p.matches || 0, kills: p.kills || 0,
        you: me && p.username === me.username, real: true,
      });
    }
    /* Padding, drawn from the same bot roster a match is filled with, so the
       names match the people you actually played against. */
    const pool = (typeof Matchmaking !== 'undefined' && Matchmaking.BOT_NAMES)
      ? Matchmaking.BOT_NAMES : ['Vega', 'Rook', 'Ash', 'Juno', 'Kite', 'Nomad', 'Slate', 'Wren'];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; rows.length < 12 && i < pool.length * 2; i++) {
      const nm = pool[i % pool.length] + (i >= pool.length ? ' II' : '');
      if (rows.some(r => r.name === nm)) continue;
      const matches = 4 + Math.floor(rnd() * 40);
      rows.push({
        name: nm, avatar: '🎯', level: 1 + Math.floor(rnd() * 22),
        wins: Math.floor(matches * (0.2 + rnd() * 0.45)), matches,
        kills: Math.floor(matches * (1.5 + rnd() * 5)), you: false, real: false,
      });
    }
    for (const r of rows) {
      r.ratio = r.matches ? r.kills / r.matches : 0;
      r.winPct = r.matches ? Math.round((r.wins / r.matches) * 100) : 0;
    }
    rows.sort((a, b) => (b[lbSort] || 0) - (a[lbSort] || 0));
    return rows;
  }

  function renderLeaderboard() {
    const tabs = document.getElementById('lb-tabs');
    const body = document.getElementById('lb-body');
    if (!tabs || !body) return;
    tabs.innerHTML = '';
    for (const t of LB_SORTS) {
      const b = document.createElement('button');
      b.className = 'btn btn--ghost btn--tiny' + (lbSort === t.id ? ' is-active' : '');
      b.textContent = t.label;
      b.addEventListener('click', () => { lbSort = t.id; renderLeaderboard(); SFX.click(); });
      tabs.appendChild(b);
    }
    body.innerHTML = '';
    leaderboardRows().forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.you) tr.className = 'is-you';
      tr.style.animationDelay = (i * 0.02) + 's';
      const cell = (txt, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.textContent = txt;
        return td;
      };
      tr.appendChild(cell(String(i + 1), 'lb__rank' + (i < 3 ? ' lb__rank--' + (i + 1) : '')));
      const who = document.createElement('td');
      who.innerHTML = '<span class="lb__who"><span class="lb__av"></span><span></span></span>';
      who.querySelector('.lb__av').textContent = r.avatar || '🎯';
      who.querySelector('.lb__who span:last-child').textContent = r.name + (r.real ? '' : ' ·');
      who.title = r.real ? 'Played on this machine' : 'Filled from the bot roster';
      tr.appendChild(who);
      tr.appendChild(cell(r.level));
      tr.appendChild(cell(r.wins));
      tr.appendChild(cell(r.matches));
      tr.appendChild(cell(r.kills));
      tr.appendChild(cell(r.ratio.toFixed(1)));
      tr.appendChild(cell(r.winPct + '%'));
      body.appendChild(tr);
    });
  }

  /* ---- shop ---- */
  let shopCat = 'skin';
  function renderShop() {
    const p = DB.getProfile();
    const tabs = document.getElementById('shop-tabs');
    const grid = document.getElementById('shop-grid');
    if (!tabs || !grid) return;

    tabs.innerHTML = '';
    Shop.CATEGORIES.forEach(c => {
      const b = document.createElement('button');
      b.className = 'shop-tab' + (c.id === shopCat ? ' is-active' : '');
      b.innerHTML = `${c.icon} ${c.name}`;
      b.addEventListener('click', () => { shopCat = c.id; SFX.click(); renderShop(); });
      tabs.appendChild(b);
    });

    grid.innerHTML = '';
    const list = Shop.items(shopCat);
    if (!list.length) { grid.innerHTML = '<p class="shop-empty">Nothing here yet.</p>'; return; }

    list.forEach(item => {
      const owned = Shop.isOwned(p, item);
      const afford = Shop.wallet(p, item.cur) >= item.price;
      const card = document.createElement('div');
      card.className = 'shop-card' + (owned ? ' is-owned' : '') + (!owned && !afford ? ' is-broke' : '');
      const swatch = item.cat === 'skin'
        ? `<span class="shop-swatch" style="background:linear-gradient(90deg,${item.barrel},${item.accent})"></span>`
        : item.color
          ? `<span class="shop-swatch" style="background:${item.color}"></span>`
          : '';
      const rarity = item.rarity ? Skins.RARITIES[item.rarity] : null;
      card.innerHTML = `
        <div class="shop-card__icon">${item.icon}</div>
        <div class="shop-card__name">${item.name}</div>
        ${rarity ? `<div class="shop-card__rarity" style="color:${rarity.color}">${rarity.name}</div>` : ''}
        ${swatch}
        <div class="shop-card__desc">${item.desc || ''}</div>
        <button class="shop-card__buy">${owned ? '✓ Owned'
          : `${item.cur === 'gems' ? '💎' : '🪙'} ${item.price}`}</button>`;
      const buy = card.querySelector('.shop-card__buy');
      if (owned) buy.disabled = true;
      else buy.addEventListener('click', () => {
        const r = Shop.purchase(p, item);
        if (!r.ok) { Toast.show(r.error); SFX.lose(); return; }
        DB.saveProfile(p);
        Toast.show(`${item.name} unlocked!`, 'reward');
        // equipping is the natural next step for the cosmetic categories
        if (item.cat === 'avatar') { p.avatar = item.icon; DB.saveProfile(p); }
        if (item.cat === 'nametag') { p.nametag = item.id; DB.saveProfile(p); }
        if (item.cat === 'tracer') { p.tracer = item.id; DB.saveProfile(p); }
        renderAll(); renderShop();
      });
      grid.appendChild(card);
    });
  }

  /* ---- render everything on the home screen ---- */
  function renderAll() {
    const p = DB.getProfile();
    if (!p) return;
    // profile chip + wallet
    document.getElementById('hud-name').textContent = p.username;
    document.getElementById('hud-level').textContent = p.level;
    document.getElementById('hud-avatar').textContent = p.avatar;
    document.getElementById('hud-credits').textContent = p.credits;
    document.getElementById('hud-gems').textContent = p.gems;
    // lifetime stats
    countUp(document.getElementById('stat-wins'), p.wins);
    countUp(document.getElementById('stat-matches'), p.matches);
    countUp(document.getElementById('stat-kills'), p.kills);
    // multiplayer status — tells you plainly whether you're online or on bots
    const chip = document.getElementById('net-chip');
    if (chip) {
      const url = Net.serverUrl();
      chip.textContent = url ? `🟢 Multiplayer · ${shortHost(url)}` : '⚫ Offline vs bots';
      chip.className = 'net-chip' + (url ? ' is-online' : '');
      chip.title = url
        ? `Connecting to ${url} when you deploy. Falls back to bots if it's unreachable.`
        : 'No multiplayer server configured. See server/README.md, or add ?server=wss://your-host to the URL.';
    }
    /* Until somebody has been through training once, the home screen says so.
       After that it is just another thing on the menu. */
    const badge = document.getElementById('train-badge');
    if (badge) badge.hidden = !!p.tutorialDone;
    const trainbar = document.getElementById('trainbar');
    if (trainbar) trainbar.classList.toggle('is-recommended', !p.tutorialDone);
    bindPointerGlow();
    renderCareer(p);
    renderKit(p);
    renderSetup();
    renderIntel();
    renderHistory(p);
    // season strip mirrors the battle-pass numbers rather than inventing its own
    const st = document.getElementById('season-tier');
    if (st) {
      st.textContent = p.bpTier || 1;
      const need = 1000;
      const have = p.bpXp || 0;
      const b2 = document.getElementById('season-bar');
      if (b2) b2.style.width = Math.max(2, Math.min(100, (have / need) * 100)) + '%';
      const x2 = document.getElementById('season-xp');
      if (x2) x2.textContent = have + ' / ' + need + ' XP';
    }
    // reset timer(s)
    document.getElementById('missions-reset').textContent = Progression.timeUntilReset();
    document.querySelectorAll('.missions-reset').forEach(e => e.textContent = Progression.timeUntilReset());
    renderMiniMissions();
  }

  const shortHost = (url) => String(url).replace(/^wss?:\/\//, '').split('/')[0];

  /* ---- the last few matches ----
     Written by game.js at the end of every match. Newest first, with the
     numbers that say how the game went rather than only whether you won it. */
  const MODE_LABEL = { domination: 'Domination', elimination: 'Elimination', range: 'Firing Range' };
  function agoText(ms) {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
  }
  function renderHistory(p) {
    const host = document.getElementById('history-list');
    if (!host) return;
    const rows = (p.history || []).filter(h => h.mode !== 'range').slice(0, 6);
    const best = p.best || {};
    const hint = document.getElementById('history-best');
    if (hint) {
      hint.textContent = best.kills
        ? `best ${best.kills} elims · ${best.streak} streak`
        : '';
    }
    if (!rows.length) {
      host.innerHTML = '<li class="history__empty">No matches yet — deploy and this fills in.</li>';
      return;
    }
    host.innerHTML = rows.map(h => {
      const kd = h.deaths ? (h.kills / h.deaths).toFixed(2) : h.kills.toFixed(2);
      return `<li class="history__row ${h.won ? 'is-win' : 'is-loss'}">
        <span class="history__res">${h.won ? 'W' : 'L'}</span>
        <span class="history__mode">${MODE_LABEL[h.mode] || h.mode}<i>${agoText(h.at)}</i></span>
        <span class="history__kd"><b>${h.kills}</b> / ${h.deaths}<i>${kd} K/D</i></span>
        <span class="history__streak">${h.streak > 1 ? h.streak + '×' : '—'}<i>streak</i></span>
      </li>`;
    }).join('');
  }

  /* ---- who you are, and how far along ---- */
  const RANKS = ['Recruit', 'Trooper', 'Corporal', 'Sergeant', 'Lieutenant', 'Captain', 'Major', 'Colonel', 'Commander'];
  function renderCareer(p) {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('career-name', p.username);
    set('career-avatar', p.avatar);
    set('career-level', p.level);
    set('career-rank', RANKS[Math.min(RANKS.length - 1, Math.floor((p.level - 1) / 3))]);
    /* The same curve awardXp() levels you up on — 500 xp times your level — so
       the bar cannot drift from the number beside it. */
    const need = p.level * 500;
    const have = p.xp || 0;
    const bar = document.getElementById('career-xpbar');
    if (bar) bar.style.width = Math.max(2, Math.min(100, (have / Math.max(1, need)) * 100)) + '%';
    set('career-xptext', have + ' / ' + need + ' XP');
  }

  /* ---- what you are deploying with ---- */
  function renderKit(p) {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const lo = p.loadout || {};
    const cls = lo.klass || lo.class || (typeof Classes !== 'undefined' ? Object.keys(Classes.CLASSES)[0] : '—');
    set('kit-class', cls);
    const w = lo.weapon && typeof Weapons !== 'undefined' && Weapons.byId[lo.weapon];
    set('kit-weapon', w ? w.name : (lo.weapon || 'Class default'));
    const perk = lo.perk && typeof Perks !== 'undefined' && Perks.byId(lo.perk);
    set('kit-perk', perk ? perk.name : 'None');
  }

  /* ---- the pointer-lit edge ----
     Panels carry a highlight that follows the cursor. Done with two custom
     properties rather than a repaint, so it costs a style recalculation and
     nothing else. */
  function bindPointerGlow() {
    const sel = '.panel, .mode-card';
    document.querySelectorAll(sel).forEach((el) => {
      if (el.dataset.glow) return;
      el.dataset.glow = '1';
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  /* ---- numbers that arrive ----
     A career stat that counts up reads as a result; the same number written
     straight in reads as a placeholder. Short, eased, and it never overshoots
     the real figure. */
  function countUp(el, to) {
    const from = 0;
    if (!el || to === from) { if (el) el.textContent = to; return; }
    const t0 = performance.now(), ms = 620;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * eased);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---- how big a match you want ----
     Written to the profile, so the choice survives a reload, and read back by
     Game.setupFor when a match actually starts. Clamped there as well as
     here — the menu is a convenience, not the authority. */
  function matchSetup() {
    const p = DB.getProfile() || {};
    /* Its own reader rather than the `selectedMode` further down this file:
       that one is a const declared after this runs, so calling it from here
       threw on every render. */
    const card = document.querySelector('.mode-card.is-selected');
    const mode = (card && card.dataset.mode) || 'domination';
    const base = Game.setupFor ? Game.setupFor(mode) : { teams: 4, perTeam: 4 };
    return Object.assign({}, base, p.matchSetup || {});
  }
  function renderSetup() {
    const lim = (Game.TEAM_LIMITS) || { teams: [2, 20], perTeam: [1, 8] };
    const cur = matchSetup();
    // which mode's card to relabel — read here, since matchSetup keeps its own
    const card = document.querySelector('.mode-card.is-selected');
    const mode = (card && card.dataset.mode) || 'domination';
    const t = document.getElementById('setup-teams');
    const q = document.getElementById('setup-perteam');
    if (!t || !q) return;
    t.textContent = cur.teams;
    q.textContent = cur.perTeam;
    const total = cur.teams * cur.perTeam;
    const tot = document.getElementById('setup-total');
    if (tot) tot.textContent = total + ' in the match · you + ' + (total - 1) + ' bots';
    /* The mode card says what the match will actually be, not a fixed string.
       It read "3v3v3" while domination has been four squads of four for as
       long as it has existed, and now that the size is adjustable a hardcoded
       label would go stale the moment anybody touched the steppers. */
    const meta = document.getElementById('mode-meta-' + mode);
    if (meta) {
      meta.textContent = cur.teams <= 4
        ? new Array(cur.teams).fill(cur.perTeam).join('v')
        : cur.teams + ' squads of ' + cur.perTeam;
    }
    // grey the buttons out at the ends rather than letting them do nothing
    document.querySelectorAll('.stepper__btn').forEach((b) => {
      const key = b.dataset.setup, d = +b.dataset.delta;
      const [lo, hi] = lim[key];
      b.disabled = (cur[key] + d) < lo || (cur[key] + d) > hi;
    });
  }

  function bumpSetup(key, delta) {
    const lim = (Game.TEAM_LIMITS) || { teams: [2, 20], perTeam: [1, 8] };
    const p = DB.getProfile();
    const cur = matchSetup();
    const [lo, hi] = lim[key];
    const next = Math.max(lo, Math.min(hi, cur[key] + delta));
    p.matchSetup = Object.assign({}, p.matchSetup, { teams: cur.teams, perTeam: cur.perTeam });
    p.matchSetup[key] = next;
    DB.saveProfile(p);
    renderSetup();
    SFX.click();
  }

  /* ---- what is out on the map ----
     Counted from the tables the generator actually reads, so the panel cannot
     claim content the game does not have. */
  function renderIntel() {
    const ul = document.getElementById('intel-list');
    if (!ul || typeof Structures === 'undefined') return;
    const nBuildings = Object.keys(Structures.BUILDINGS).length;
    const nRooms = Object.keys(Structures.ROOM_LOOT).length;
    const nPerks = (typeof Perks !== 'undefined' && Perks.list) ? Perks.list.length : 0;
    const nGuns = (typeof Weapons !== 'undefined' && Weapons.list) ? Weapons.list.length : 0;
    const rows = [
      { icon: '🏚️', name: 'Building types', note: 'houses, bases, bunkers, the lot', n: nBuildings },
      { icon: '🚪', name: 'Room types', note: 'each stocked to its own table', n: nRooms },
      { icon: '🧰', name: 'Chests', note: 'three rolls, in the rooms worth reaching', n: '★' },
      { icon: '🕳️', name: 'Tunnels', note: 'go under the field, come up elsewhere', n: '★' },
      { icon: '🚗', name: 'Garages', note: 'vehicle doors you can drive through', n: '★' },
      { icon: '🎖️', name: 'Perks', note: 'one pick, whole match', n: nPerks },
      { icon: '🔫', name: 'Weapons', note: 'across every class', n: nGuns },
    ];
    ul.innerHTML = '';
    for (const r of rows) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="intel__icon"></span><span class="intel__body">'
        + '<span class="intel__name"></span><span class="intel__note"></span></span>'
        + '<span class="intel__count"></span>';
      li.querySelector('.intel__icon').textContent = r.icon;
      li.querySelector('.intel__name').textContent = r.name;
      li.querySelector('.intel__note').textContent = r.note;
      li.querySelector('.intel__count').textContent = r.n;
      ul.appendChild(li);
    }
    const tips = [
      'Lockers, shelves and desks can be searched — the glint means there is something in it.',
      'A chest pays out three times. Opening one in the open is a decision.',
      'Every building has a hatch or a back way. The front door is rarely the best one.',
      'Wire slows you and cuts you. Go round it, or blow a gap in it.',
      'Bunker complexes run a tunnel between two blockhouses. Nothing above ground can see you down there.',
      'Buildings closer to the middle of the island hold better loot.',
    ];
    const tip = document.getElementById('intel-tip');
    if (tip) tip.textContent = '💡 ' + tips[Math.floor(Math.random() * tips.length)];
  }

  function missionItem(m, mini = false) {
    const li = document.createElement('li');
    li.className = 'mini-mission' + (m.done ? ' is-done' : '');
    const pct = Math.round((m.progress / m.goal) * 100);
    li.innerHTML = `
      <div class="mini-mission__top">
        <span>${m.text}</span>
        <span class="mini-mission__reward">${m.done ? '✓' : '+' + m.reward + ' 🪙'}</span>
      </div>
      <div class="bar"><div class="bar__fill" style="width:${pct}%"></div></div>
      ${mini ? '' : `<div style="font-size:12px;color:var(--muted);margin-top:6px">${m.progress} / ${m.goal}</div>`}
    `;
    return li;
  }

  function renderMiniMissions() {
    const p = DB.getProfile();
    const ul = document.getElementById('mini-mission-list');
    ul.innerHTML = '';
    p.missions.daily.forEach(m => ul.appendChild(missionItem(m, true)));
  }

  function renderMissions() {
    const p = DB.getProfile();
    const daily = document.getElementById('mission-list-daily');
    const weekly = document.getElementById('mission-list-weekly');
    daily.innerHTML = ''; weekly.innerHTML = '';
    p.missions.daily.forEach(m => daily.appendChild(missionItem(m)));
    p.weekly.forEach(m => weekly.appendChild(missionItem(m)));
  }

  function renderBattlePass() {
    const p = DB.getProfile();
    document.getElementById('bp-tier').textContent = p.bpTier;
    document.getElementById('bp-xp').textContent = p.bpXp;
    document.getElementById('bp-xpmax').textContent = Progression.BP_XP_PER_TIER;
    document.getElementById('bp-bar').style.width = (p.bpXp / Progression.BP_XP_PER_TIER * 100) + '%';
    const track = document.getElementById('bp-track');
    track.innerHTML = '';
    Progression.BP_TIERS.forEach((t, i) => {
      const tier = i + 1;
      const unlocked = tier <= p.bpTier;
      const div = document.createElement('div');
      div.className = 'bp-tier ' + (unlocked ? 'is-unlocked' : 'is-locked');
      div.innerHTML = `
        <div class="bp-tier__num">TIER ${tier}</div>
        <div class="bp-tier__reward">
          <div class="bp-tier__icon">${t.icon}</div>
          <div class="bp-tier__name">${t.name}</div>
          ${unlocked ? '' : `<div class="bp-tier__lock">🔒 locked</div>`}
        </div>`;
      track.appendChild(div);
    });
  }

  // 0..1 normalized bars for the four headline stats
  function statBars(w) {
    const dps = w.damage * w.pellets * w.burst * w.firerate;          // rough throughput
    const bars = [
      { label: 'DMG',   v: clamp01((w.damage * w.pellets * w.burst) / 130) },
      { label: 'ROF',   v: clamp01(w.firerate / 18) },
      /* Range means how far the gun is worth using, not how gently its damage
         decays. Reading it off falloff gave the three shotguns — 10%, 7% and
         5% — the three *best* range bars on the screen, which is the exact
         opposite of the truth: their pellet fan makes them five-tile weapons.
         `effectiveRange` is the number the bots now use as well, so the bar
         and the AI finally agree about what a gun is for. */
      { label: 'RANGE', v: clamp01((w.effectiveRange || w.range) / 2800) },
      { label: 'MOBIL', v: clamp01((w.moveSpeed - 120) / 135) },
      { label: 'CTRL',  v: clamp01(1 - w.recoilRaw / 4.5) },
    ];
    return bars.map(b => `
      <div class="wstat">
        <span class="wstat__l">${b.label}</span>
        <div class="wstat__bar"><div class="wstat__fill" style="width:${Math.round(b.v * 100)}%"></div></div>
      </div>`).join('');
  }
  const clamp01 = (v) => Math.max(0.04, Math.min(1, v));

  function ratingBadges(w) {
    const L = Weapons.RATING_LABELS;
    const row = (codes, kind) => codes.map(c =>
      `<span class="rbadge rbadge--${kind}" title="${L[c] || c}">${kind === 'pos' ? '▲' : kind === 'neg' ? '▼' : '＝'} ${L[c] || c}</span>`).join('');
    if (!w.ratings.pos.length && !w.ratings.neg.length) return '';
    return `<div class="rbadges">${row(w.ratings.pos, 'pos')}${row(w.ratings.neg, 'neg')}</div>`;
  }

  /* "3× Frag (max 6)" */
  function consumableChip(c) {
    const it = Items.CONSUMABLES[c.consumable];
    return `${it ? it.icon : '🎒'} ${c.startCount}× ${it ? it.name : c.consumable} <b>(max ${c.limit})</b>`;
  }
  /* melee / structure line + effect badges for a tool */
  function toolLine(t) {
    const breaches = Object.keys(Structures.WALL_TYPES)
      .filter(k => Structures.WALL_TYPES[k].toughness !== undefined && minToughness(k) <= t.pierce)
      .map(k => Structures.WALL_TYPES[k].name);
    const nums = t.melee > 0
      ? `<span>🗡 ${t.melee} dmg</span><span>📏 ${Math.round(t.range / Classes.RANGE_UNIT)} range</span>
         <span>🧱 ${t.structure} structure</span><span>⏱ ${t.cooldown}s</span>
         <span title="Structure Pierce beats a wall's Toughness">⇢ pierce ${t.pierce} — breaches ${breaches.join(', ') || 'nothing'}</span>`
      : (t.revive ? `<span>⚡ instant revive</span><span>⏱ ${t.cooldown}s</span>` : `<span>gadget — press <b>V</b> in match</span>`);
    return `<div class="tool-nums">${nums}</div>
      <div class="tool-fx">${t.effects.map(e => `<span class="tool-badge">${e}</span>`).join('')}</div>`;
  }
  /* the easiest version of a wall type — wood gets tougher as it gets thicker */
  function minToughness(type) {
    const t = Structures.WALL_TYPES[type].toughness;
    return typeof t === 'function' ? t(0.1) : t;
  }

  /* ---- gunsmith: skin / attachments / ammo for the weapon you're carrying ---- */
  function renderGunsmith() {
    const p = DB.getProfile();
    const host = document.getElementById('loadout-smith');
    const base = Weapons.byId[p.weapon];
    if (!host || !base) return;

    const skinId = Skins.equipped(p, base.id);
    const skin = Skins.get(skinId);
    const chosen = p.attachments[base.id] || [];
    const ammo = p.ammo[base.id] || null;
    const built = Weapons.configure(base, { attachments: chosen, ammo });

    // what the attachments/ammo actually did to the numbers
    const delta = (label, now, was, lowerIsBetter, unit = '') => {
      const d = now - was;
      if (Math.abs(d) < 0.005) return `<span class="gs-stat">${label} <b>${fmt(now)}${unit}</b></span>`;
      const good = lowerIsBetter ? d < 0 : d > 0;
      return `<span class="gs-stat ${good ? 'is-up' : 'is-down'}">${label} <b>${fmt(now)}${unit}</b>
        <i>${d > 0 ? '+' : ''}${fmt(d)}</i></span>`;
    };
    const fmt = (v) => (Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 100) / 100);

    host.innerHTML = `
      <div class="gs-head">
        <div class="gs-title">
          <span class="gs-icon" style="color:${skin.barrel}">${base.icon}</span>
          <div>
            <h3>${base.name}<span class="gs-skin-tag" style="background:${skin.accent};color:#0b1020">${skin.name}</span></h3>
            <p>${base.type} · ${base.className} · <b>${built.dmgType.toUpperCase()}</b> rounds</p>
          </div>
        </div>
        <div class="gs-preview" style="--barrel:${skin.barrel};--accent:${skin.accent}">
          <span class="gs-barrel"></span><span class="gs-muzzle"></span>
        </div>
      </div>

      <div class="gs-stats">
        ${delta('DMG', built.damage * built.pellets, base.damage * base.pellets, false)}
        ${delta('SPREAD', built.spreadBase, base.spreadBase, true)}
        ${delta('RECOIL', built.recoilRaw, base.recoilRaw, true)}
        ${delta('RELOAD', built.reloadMs / 1000, base.reloadMs / 1000, true, 's')}
        ${delta('MOBIL', built.moveSpeed, base.moveSpeed, false)}
        ${delta('HANDLING', built.handling, base.handling, true, 's')}
        ${delta('PEN', (built.penetration || 0) * 100, 0, false, '%')}
      </div>

      <div class="gs-section">
        <h4>Perk <span class="gs-hint">one only — carried whatever you're holding</span></h4>
        <div class="gs-row" id="gs-perks"></div>
      </div>

      <div class="gs-section">
        <h4>Skin <span class="gs-hint">cosmetic only — never changes a stat</span></h4>
        <div class="gs-row" id="gs-skins"></div>
      </div>

      ${base.attachments.length ? `
      <div class="gs-section">
        <h4>Attachments <span class="gs-hint">every buff costs you a debuff</span></h4>
        <div class="gs-row" id="gs-attach"></div>
      </div>` : ''}

      ${base.specialAmmo.length ? `
      <div class="gs-section">
        <h4>Specialized Ammo <span class="gs-hint">one type at a time</span></h4>
        <div class="gs-row" id="gs-ammo"></div>
      </div>` : ''}
    `;

    // --- perks ---
    /* Not weapon-specific: you carry one perk, whatever you're holding. It
       lives in the gunsmith panel because that is where a loadout decision
       belongs, but it is saved on the profile rather than per weapon. */
    const perkRow = host.querySelector('#gs-perks');
    if (perkRow) Perks.list.forEach(perk => {
      const on = (p.perk || Perks.DEFAULT) === perk.id;
      const b = document.createElement('button');
      b.className = 'gs-mod gs-perk' + (on ? ' is-on' : '');
      b.innerHTML = `
        <span class="gs-mod-head">${perk.icon} ${perk.name}${perk.extra ? '<i class="gs-perk-x">EXTRA</i>' : ''}</span>
        <span class="gs-mod-buff">${perk.effects.map(x => '▲ ' + x).join('<br>') || '—'}</span>
        <span class="gs-perk-blurb">${perk.blurb}</span>`;
      b.addEventListener('click', () => {
        p.perk = on ? Perks.DEFAULT : perk.id;
        DB.saveProfile(p); SFX.click(); renderGunsmith();
      });
      perkRow.appendChild(b);
    });

    // --- skins ---
    const skinRow = host.querySelector('#gs-skins');
    Skins.forWeapon(base).forEach(id => {
      const s = Skins.get(id), owned = Skins.owns(p, id), on = id === skinId;
      const b = document.createElement('button');
      b.className = 'gs-skin' + (on ? ' is-on' : '') + (owned ? '' : ' is-locked');
      b.style.setProperty('--barrel', s.barrel);
      b.style.setProperty('--accent', s.accent);
      b.innerHTML = `
        <span class="gs-swatch"></span>
        <span class="gs-skin-name">${s.name}</span>
        <span class="gs-skin-meta" style="color:${Skins.rarityOf(id).color}">
          ${owned ? (on ? 'EQUIPPED' : 'Equip') : '🪙 ' + Skins.priceOf(id)}
        </span>`;
      b.addEventListener('click', () => {
        if (!owned) {
          const r = Skins.purchase(p, id);
          if (!r.ok) { Toast.show(r.error, 'warn'); SFX.lose(); return; }
          Toast.show(`${s.name} unlocked for ${r.price} credits`, 'reward');
        }
        p.weaponSkins[base.id] = id;
        DB.saveProfile(p); SFX.click();
        renderAll(); renderLoadout();          // renderLoadout re-runs the gunsmith
      });
      skinRow.appendChild(b);
    });

    // --- attachments ---
    const attachRow = host.querySelector('#gs-attach');
    if (attachRow) base.attachments.forEach(name => {
      const at = Weapons.ATTACHMENTS[name];
      if (!at) return;
      const on = chosen.includes(name);
      const b = document.createElement('button');
      b.className = 'gs-mod' + (on ? ' is-on' : '');
      b.innerHTML = `
        <span class="gs-mod-head">${at.icon} ${at.name}</span>
        <span class="gs-mod-buff">${at.buffs.map(x => '▲ ' + x).join('<br>')}</span>
        <span class="gs-mod-debuff">${at.debuffs.map(x => '▼ ' + x).join('<br>')}</span>`;
      b.addEventListener('click', () => {
        p.attachments[base.id] = on ? chosen.filter(x => x !== name) : chosen.concat(name);
        DB.saveProfile(p); SFX.click(); renderGunsmith();
      });
      attachRow.appendChild(b);
    });

    // --- specialized ammo ---
    const ammoRow = host.querySelector('#gs-ammo');
    if (ammoRow) base.specialAmmo.forEach(name => {
      const am = Weapons.AMMO_TYPES[name];
      if (!am) return;
      const on = ammo === name;
      const b = document.createElement('button');
      b.className = 'gs-mod' + (on ? ' is-on' : '');
      b.innerHTML = `
        <span class="gs-mod-head">${am.icon} ${am.name}</span>
        <span class="gs-mod-buff">${am.buffs.map(x => '▲ ' + x).join('<br>')}</span>
        <span class="gs-mod-debuff">${am.debuffs.map(x => '▼ ' + x).join('<br>')}</span>`;
      b.addEventListener('click', () => {
        if (on) delete p.ammo[base.id]; else p.ammo[base.id] = name;
        DB.saveProfile(p); SFX.click(); renderGunsmith();
      });
      ammoRow.appendChild(b);
    });
  }

  /* ---- saved kits ----
     Create-a-class, in three slots. A preset holds the two things that
     actually define how you play — the gun (which picks your class, tool and
     consumable) and the passive. Attachments, ammo and skins are already
     stored against the weapon itself, so they come along with it.

     Saving overwrites the slot you press, which is what a save button should
     do; loading equips it and re-renders. */
  const PRESET_SLOTS = 3;
  function presetLabel(slot) {
    if (!slot) return 'Empty';
    const w = Weapons.byId[slot.weapon];
    return w ? w.name : 'Unknown';
  }
  function renderPresets() {
    const host = document.getElementById('presets');
    if (!host) return;
    const p = DB.getProfile();
    if (!Array.isArray(p.presets)) p.presets = [null, null, null];
    while (p.presets.length < PRESET_SLOTS) p.presets.push(null);
    host.innerHTML = '';
    for (let i = 0; i < PRESET_SLOTS; i++) {
      const slot = p.presets[i];
      const w = slot && Weapons.byId[slot.weapon];
      const perk = slot && typeof Perks !== 'undefined' && Perks.byId(slot.perk);
      // "live" = the current loadout already matches this slot
      const live = !!(slot && slot.weapon === p.weapon && (slot.perk || 'none') === (p.perk || 'none'));
      const card = document.createElement('div');
      card.className = 'preset' + (slot ? '' : ' is-empty') + (live ? ' is-live' : '');
      card.innerHTML = `
        <div class="preset__head"><span class="preset__n">KIT ${String.fromCharCode(65 + i)}</span>
          ${live ? '<span class="preset__live">EQUIPPED</span>' : ''}</div>
        <div class="preset__name">${w ? `${w.icon} ${w.name}` : 'Empty slot'}</div>
        <div class="preset__sub">${w ? `${w.type} · ${perk ? perk.name : 'No perk'}` : 'Save your current loadout here'}</div>
        <div class="preset__btns">
          <button class="btn btn--ghost btn--tiny" data-preset-load="${i}"${slot ? '' : ' disabled'}>Equip</button>
          <button class="btn btn--ghost btn--tiny" data-preset-save="${i}">Save current</button>
        </div>`;
      host.appendChild(card);
    }
    host.querySelectorAll('[data-preset-save]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.presetSave;
      const prof = DB.getProfile();
      prof.presets[i] = { weapon: prof.weapon, perk: prof.perk || 'none' };
      DB.saveProfile(prof);
      SFX.click();
      Toast.show(`Kit ${String.fromCharCode(65 + i)} saved.`);
      renderPresets();
    }));
    host.querySelectorAll('[data-preset-load]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.presetLoad;
      const prof = DB.getProfile();
      const slot = prof.presets[i];
      if (!slot) return;
      prof.weapon = slot.weapon;
      prof.perk = slot.perk || 'none';
      prof.activePreset = i;
      DB.saveProfile(prof);
      SFX.click();
      Toast.show(`Kit ${String.fromCharCode(65 + i)} equipped.`);
      renderLoadout();
      renderKit(DB.getProfile());
    }));
  }

  function renderLoadout() {
    renderPresets();
    renderGunsmith();
    const p = DB.getProfile();
    const host = document.getElementById('loadout-grid');
    host.innerHTML = '';
    const groups = Weapons.byClass();
    Object.entries(groups).forEach(([cls, weapons]) => {
      const meta = Weapons.CLASS_META[cls] || {};
      const c = Classes.byName(cls);
      const active = weapons.some(w => w.id === p.weapon);
      const section = document.createElement('div');
      section.className = 'wclass' + (active ? ' is-active' : '');
      section.innerHTML = `
        <h3 class="wclass__title"><span style="color:${meta.color}">${meta.icon}</span> ${cls}
          ${active ? '<span class="wclass__tag">DEPLOYED</span>' : ''}</h3>
        <p class="wclass__desc">${c.desc}</p>
        <div class="wclass__kit">
          <span class="kit-chip" title="Base movement speed">🏃 ${c.speed}× speed</span>
          <span class="kit-chip" title="${c.tool.effects.join(' · ')}">${c.tool.icon} ${c.tool.name}</span>
          <span class="kit-chip">${consumableChip(c)}</span>
        </div>
        <div class="wclass__tool">${toolLine(c.tool)}</div>`;
      const row = document.createElement('div');
      row.className = 'wclass__row';
      weapons.forEach(w => {
        const unlocked = p.unlockedWeapons.includes(w.id);
        const equipped = p.weapon === w.id;
        const wSkin = Skins.get(Skins.equipped(p, w.id));
        const card = document.createElement('button');
        card.className = 'weapon-card' + (equipped ? ' is-equipped' : '') + (unlocked ? '' : ' is-locked');
        card.style.setProperty('--skin', wSkin.accent);
        card.innerHTML = `
          <div class="weapon-card__head">
            <span class="weapon-card__icon" style="color:${wSkin.barrel}">${w.icon}</span>
            <span class="ammo-chip" style="background:${w.ammoColor}" title="${w.ammoType} ammo"></span>
          </div>
          ${wSkin.free ? '' : `<span class="weapon-card__skin" style="background:${wSkin.accent}">${wSkin.name}</span>`}
          <div class="weapon-card__name">${w.name}</div>
          <div class="weapon-card__type">${w.type}${w.burst > 1 ? ` · ${w.burst}-rnd burst` : ''}${w.pellets > 1 ? ` · ${w.pellets} pellets` : ''}${w.explosive ? ' · 💥 explosive' : ''}</div>
          <div class="weapon-card__stats">${statBars(w)}</div>
          <div class="weapon-card__nums">
            <span>🔧 ${w.mag} mag</span><span>⏱ ${(w.reloadMs / 1000).toFixed(1)}s</span><span>⚖ ${w.weight}</span><span>↔ ${Math.round((w.effectiveRange || w.range) / 50)}t</span>
          </div>
          ${ratingBadges(w)}
          <div class="weapon-card__badge">${equipped ? '✓ EQUIPPED' : unlocked ? 'Equip' : '🔒 Locked'}</div>`;
        if (unlocked) card.addEventListener('click', () => {
          p.weapon = w.id; DB.saveProfile(p); SFX.click(); renderLoadout();
        });
        row.appendChild(card);
      });
      section.appendChild(row);
      host.appendChild(section);
    });
  }

  /* ---- mode selection ---- */
  function selectMode(mode) {
    selectedMode = mode;
    document.querySelectorAll('.mode-card').forEach(c => c.classList.toggle('is-selected', c.dataset.mode === mode));
    const label = mode === 'domination' ? 'Domination' : 'Elimination';
    document.getElementById('queue-mode-label').textContent = label;
    SFX.click();
  }
  const getSelectedMode = () => selectedMode;

  /* ---- settings modal ---- */
  const AVATARS = ['🎯', '💀', '🤖', '🐺', '🦅', '🔥', '⚡', '👑', '🎮', '🥷', '🛡️', '☠️'];
  function openSettings() {
    const s = DB.getSettings();
    const p = DB.getProfile();
    document.getElementById('set-name').value = p.username;
    document.getElementById('set-volume').value = s.volume;
    document.getElementById('val-volume').textContent = s.volume + '%';
    document.getElementById('set-sfx').checked = s.sfx;
    document.getElementById('set-sens').value = s.sensitivity;
    document.getElementById('val-sens').textContent = (s.sensitivity / 100).toFixed(1) + '×';
    document.getElementById('set-quality').value = s.quality;
    document.getElementById('set-dmgnum').checked = s.dmgNumbers;
    // stored as the opt-out, shown as the feature: checked means raised
    document.getElementById('set-depth').checked = !s.flatWorld;
    // sight options
    document.getElementById('set-fov').value = s.fov;
    document.getElementById('val-fov').textContent = s.fov;
    document.getElementById('set-teamcolors').value = s.teamColors;
    document.getElementById('set-foecolor').value = s.foeColor;
    document.getElementById('set-crosshair').value = s.crosshair;
    document.getElementById('set-chsize').value = s.crosshairSize;
    document.getElementById('val-chsize').textContent = s.crosshairSize;
    document.getElementById('set-chcolor').value = s.crosshairColor;
    syncSightRows();
    document.getElementById('set-botlevel').value = s.botLevel || BotAI.DEFAULT;
    renderBotLevel(s.botLevel || BotAI.DEFAULT);
    renderKeybinds();
    // avatar picker
    const picker = document.getElementById('avatar-picker');
    picker.innerHTML = '';
    AVATARS.forEach(a => {
      const b = document.createElement('button');
      b.textContent = a;
      b.className = a === p.avatar ? 'is-active' : '';
      b.addEventListener('click', () => {
        p.avatar = a; DB.saveProfile(p);
        picker.querySelectorAll('button').forEach(x => x.classList.remove('is-active'));
        b.classList.add('is-active');
        renderAll();
      });
      picker.appendChild(b);
    });
    document.getElementById('modal-settings').classList.add('is-open');
  }
  function closeSettings() { document.getElementById('modal-settings').classList.remove('is-open'); }

  /* difficulty slider readout: name, blurb, and the three trait bars */
  function renderBotLevel(lvl) {
    const d = BotAI.profile(+lvl);
    document.getElementById('val-botlevel').textContent = `${d.level} · ${d.name}`;
    document.getElementById('note-botlevel').textContent = d.blurb;
    const host = document.getElementById('diff-traits');
    // 0..1 per track, so the three bars show what the level actually buys you
    const t = (d.level - 1) / 9;
    const rows = [
      { label: 'Aim', v: t, detail: `${Math.round(d.aim.reaction * 1000)}ms reaction · ${d.aim.lead > 0.05 ? 'leads shots' : 'no lead'}` },
      { label: 'Survival', v: t, detail: d.survival.usesHeals ? `heals at ${Math.round(d.survival.healAt * 100)}% HP` : 'never heals' },
      { label: 'Teamwork', v: t, detail: d.teamwork.sharesContacts ? 'shares contacts, focus-fires' : 'fights alone' },
    ];
    host.innerHTML = rows.map(r => `
      <div class="diff-trait">
        <span class="diff-trait__l">${r.label}</span>
        <div class="diff-trait__bar"><div class="diff-trait__fill" style="width:${Math.round(r.v * 100)}%"></div></div>
        <span class="diff-trait__d">${r.detail}</span>
      </div>`).join('');
  }

  /* ---- keybinds ----
     One row per action, two slots each. Click a slot, press a key, done —
     no modal, no confirm step, and Escape backs out without changing
     anything. The rows are generated from Controls.ACTIONS so the panel and
     the game can't disagree about what is bindable. */
  let listening = null;              // { actionId, slot, el } while capturing
  function renderKeybinds() {
    const host = document.getElementById('keybind-list');
    if (!host) return;
    const map = Controls.all();
    let html = '', group = null;
    for (const a of Controls.ACTIONS) {
      if (a.group !== group) { group = a.group; html += `<h4 class="keybinds__group">${group}</h4>`; }
      const slots = [0, 1].map(i => {
        const code = map[a.id][i];
        return `<button class="keybind__key${code ? '' : ' is-empty'}" data-act="${a.id}" data-slot="${i}"
          title="${code ? 'Click to rebind' : 'Click to add a second key'}">${Controls.label(code)}</button>`;
      }).join('');
      html += `<div class="keybind"><span class="keybind__name">${a.name}</span>
        <span class="keybind__keys">${slots}</span></div>`;
    }
    host.innerHTML = html;
    host.querySelectorAll('.keybind__key').forEach(b =>
      b.addEventListener('click', () => beginCapture(b.dataset.act, +b.dataset.slot, b)));
  }

  const keyHint = (msg, bad) => {
    const el = document.getElementById('val-keybind');
    if (el) { el.textContent = msg; el.classList.toggle('is-bad', !!bad); }
  };

  function beginCapture(actionId, slot, el) {
    if (listening) cancelCapture();
    listening = { actionId, slot, el };
    el.classList.add('is-listening');
    el.textContent = 'Press a key…';
    keyHint(`Press the new key for “${Controls.byId[actionId].name}” · Esc to cancel · Backspace to clear`);
    /* Capture phase, so the key never reaches the page underneath — otherwise
       binding Tab would tab out of the panel on the way past. */
    window.addEventListener('keydown', onCapture, true);
  }
  function cancelCapture() {
    if (!listening) return;
    window.removeEventListener('keydown', onCapture, true);
    listening = null;
    renderKeybinds();
    keyHint('Click a key, then press the new one');
  }
  function onCapture(e) {
    if (!listening) return;
    e.preventDefault(); e.stopPropagation();
    const { actionId, slot } = listening;
    if (e.code === 'Escape') return cancelCapture();
    if (e.code === 'Backspace') {
      Controls.clear(actionId, slot);
      window.removeEventListener('keydown', onCapture, true);
      listening = null; renderKeybinds();
      return keyHint('Cleared.');
    }
    if (!Controls.isBindable(e.code)) {
      return keyHint(`${Controls.label(e.code)} belongs to the browser — pick another`, true);
    }
    const res = Controls.bind(actionId, slot, e.code);
    window.removeEventListener('keydown', onCapture, true);
    listening = null;
    renderKeybinds();
    if (!res.ok) return keyHint(res.error, true);
    keyHint(res.stolenFrom
      ? `${Controls.label(e.code)} bound — taken off “${res.stolenFrom}”`
      : `${Controls.label(e.code)} bound to “${Controls.byId[actionId].name}”`);
  }

  /* The enemy-colour row only means anything in friend/foe mode. */
  function syncSightRows() {
    const row = document.getElementById('row-foecolor');
    if (row) row.hidden = document.getElementById('set-teamcolors').value !== 'friendfoe';
    const sizeRow = document.getElementById('set-chsize');
    if (sizeRow) sizeRow.disabled = document.getElementById('set-crosshair').value === 'system';
  }

  function persistSettings() {
    const s = DB.getSettings();
    s.botLevel = +document.getElementById('set-botlevel').value;
    s.volume = +document.getElementById('set-volume').value;
    s.sfx = document.getElementById('set-sfx').checked;
    s.sensitivity = +document.getElementById('set-sens').value;
    s.quality = document.getElementById('set-quality').value;
    s.dmgNumbers = document.getElementById('set-dmgnum').checked;
    s.flatWorld = !document.getElementById('set-depth').checked;
    s.fov = +document.getElementById('set-fov').value;
    s.teamColors = document.getElementById('set-teamcolors').value;
    s.foeColor = document.getElementById('set-foecolor').value;
    s.crosshair = document.getElementById('set-crosshair').value;
    s.crosshairSize = +document.getElementById('set-chsize').value;
    s.crosshairColor = document.getElementById('set-chcolor').value;
    DB.saveSettings(s);
    syncSightRows();
    /* The sight settings are cached inside the game loop, so tell it to re-read
       them. Without this, changing your crosshair mid-match does nothing until
       the next one. */
    if (typeof Game !== 'undefined' && Game.refreshView) Game.refreshView();
  }

  /* ============================================================
     HOW TO PLAY — the written half of the tutorial.

     Basic Training teaches the verbs by making you do them. This is
     everything a match has no time to stop and explain: the two win
     conditions, the ten classes, the damage model, what the ground and the
     walls do to you. It is generated from the game's own tables — Controls,
     Classes, Combat, Items — rather than written out by hand, so a rebound
     key or a retuned vest shows up here instead of quietly going stale.
     ============================================================ */
  const HOWTO_TABS = [
    { id: 'basics',   label: 'Basics' },
    { id: 'controls', label: 'Controls' },
    { id: 'modes',    label: 'Modes' },
    { id: 'classes',  label: 'Classes' },
    { id: 'combat',   label: 'Damage' },
    { id: 'world',    label: 'The map' },
    { id: 'tips',     label: 'Tips' },
  ];
  let howtoTab = 'basics';

  const hSection = (title, lede, body) =>
    `<section class="howto__sec"><h3>${title}</h3>${lede ? `<p class="howto__lede">${lede}</p>` : ''}${body}</section>`;
  const hTable = (heads, rows) =>
    `<div class="howto__tablewrap"><table class="howto__table"><thead><tr>${
      heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
      rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const hList = (items) => `<ul class="howto__list">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
  const kbd = (t) => `<kbd>${t}</kbd>`;
  const kAct = (id) => (Controls.all()[id] || []).map(k => kbd(Controls.label(k))).join(' <i>/</i> ') || '—';
  const pct = (v) => Math.round(v * 100) + '%';

  const HOWTO_BODY = {
    basics: () => hSection('The thirty-second version',
      'Two squads or six, one island, and a fight over either ground or survival.',
      hList([
        'Pick a mode, check your loadout, hit <b>Deploy</b>. Offline you fight bots; online you fight whoever is in the room.',
        'The <b>weapon you equip is your class</b> — it decides your speed, your tool on ' + kAct('tool') + ' and the consumable you spawn with. Change the gun and all three change with it.',
        'You have <b>100 HP</b> and no regeneration. Healing comes out of your kit on ' + kAct('heal') + ', armour comes out of crates, and both are worth going out of your way for.',
        'Everything on the map is solid and most of it is destructible — walls, doors, trees, crates, barrels. Cover is where fights are won.',
        'Go <b>down</b> before you die: a squadmate standing over you for a few seconds picks you back up. Alone, you bleed out.',
      ]) +
      hSection('Your first ten minutes',
        '',
        hList([
          'Run <b>Basic Training</b> — it walks you through every key in a real match with nobody shooting at you.',
          'Take the <b>Firing Range</b> to feel out a gun at 10–120 m before you take it into a match.',
          'Start in <b>Domination</b>: you respawn, so a mistake costs seconds rather than the whole game.',
          'Turn bot difficulty down in <b>Settings</b> (⚙️) until the fights feel fair. Level 1 is a distracted rookie, level 10 reacts in 90 ms.',
        ]))),

    controls: () => hSection('Keyboard',
      'These are your bindings, live — change any of them in Settings (⚙️) and this table changes with them.',
      ['Movement', 'Combat', 'World'].map(group => hTable(
        [group, 'Key'],
        Controls.ACTIONS.filter(a => a.group === group).map(a => [a.name, kAct(a.id)]),
      )).join('')) +
      hSection('Mouse', 'Fixed, and deliberately: these three never move.', hTable(
        ['Action', 'Button'],
        [
          ['Fire — hold for automatics, click for everything else', kbd('Left')],
          ['Aim down sights — tighter cone, slower feet', kbd('Right')],
          ['Ping what you are looking at, for the whole squad', kbd('Middle')],
        ])),

    modes: () => hSection('Domination', 'The long game, and the forgiving one.', hList([
      'Three capture points. Stand inside a ring to take it; more of you on it takes it faster, and one enemy standing there stops you dead.',
      'Held points score continuously. First squad to the cap wins, and the clock decides it if nobody gets there.',
      '<b>You respawn.</b> Dying costs you a few seconds and the walk back, not the match.',
      'Down and waiting? ' + kAct('deploy') + ' over a squadmate deploys you on them instead of at your own lines.',
    ])) +
      hSection('Elimination', 'Six squads of four, one life each.', hList([
        'No respawns and no timer worth waiting on: the last squad with anybody standing wins.',
        'Loot early, fight late. Armour and a full kit matter far more here than in Domination.',
        'Being downed is not being dead — but only if somebody is close enough to pick you up.',
      ])) +
      hSection('Practice', '', hList([
        '<b>Basic Training</b> — a guided match, one mechanic at a time, nobody shooting until the last lesson.',
        '<b>Firing Range</b> — targets at 10–120 m with a damage and time-to-kill readout, so you can feel out a gun before you commit to it.',
      ])),

    classes: () => hSection('Ten classes, and your gun picks one',
      'Every weapon in the roster belongs to a class. Equip an M16 and you deploy as a Rifleman; equip a P90 and you are Assault. Speed is a multiplier on the weapon’s own.',
      hTable(['Class', 'Speed', 'Tool (' + Controls.labelFor('tool') + ')', 'Spawns with'],
        Classes.list.map(c => [
          `${c.icon} <b>${c.name}</b><span class="howto__sub">${c.desc}</span>`,
          c.speed + '×',
          `${c.tool.icon || ''} ${c.tool.name}<span class="howto__sub">${(c.tool.effects || []).join(', ')}</span>`,
          `${Classes.startFor(c, 0, 'none')}× ${(Items.CONSUMABLES[c.consumable] || {}).name || c.consumable}`,
        ]))),

    combat: () => hSection('What a hit is worth',
      'Every point of damage in the game goes through one calculation: raw damage, then the damage type against what it hit, then the hit zone, then armour, then adrenaline.',
      hTable(['Target', 'HP'].concat(['normal', 'ap', 'explosive', 'heat'].map(t => t.toUpperCase())),
        Object.values(Combat.TARGETS).map(t =>
          [t.name, t.hp].concat(['normal', 'ap', 'explosive', 'heat'].map(k => pct(t.mult[k])))))
      + '<p class="howto__note">A tank is not tough because of its health bar — rifle rounds do literally nothing to it. Bring HEAT (the RPG-7) or at least explosives.</p>') +
      hSection('Hit zones', 'There is no vertical aim in a top-down game, so each hit rolls a zone by size. They average to exactly 1× — zones add variance and a headshot payoff, not power.',
        hTable(['Zone', 'Damage', 'Chance'],
          Combat.HIT_ZONES.map(z => [z.zone, z.mult + '×', pct(z.size)]))) +
      hSection('Armour', 'Out of crates. Vests scale body damage, helmets replace the 200% headshot multiplier, and both cost you speed. Penetration does nothing against armour.',
        hTable(['Tier', 'Vest', 'Speed', 'Helmet', 'Speed'],
          [1, 2, 3].map(t => [
            'T' + t,
            pct(Combat.VESTS[t].body) + ' body damage', pct(Combat.VESTS[t].speed),
            pct(Combat.HELMETS[t].head) + ' head damage', pct(Combat.HELMETS[t].speed),
          ]))) +
      hSection('Adrenaline', 'From pills, soda, stim or a planted flag. It is a ladder — each band keeps everything below it.',
        hList([
          '<b>25</b> — Adren/2 movement speed, 5% damage reduction.',
          '<b>50</b> — and Adren/2 reload speed, 15% reduction.',
          '<b>75</b> — and Adren/2 handling speed, 30% reduction.',
          '<b>100</b> — and a last stand: seconds of life at 0 HP.',
        ])),

    world: () => hSection('The ground', 'Every island is generated fresh, and what you are standing on changes how fast you cross it.',
      hTable(['Surface', 'Speed'], [
        ['Road', '1.12× — the fast way across the map'],
        ['Grass / bridge', 'normal'],
        ['Beach', '0.92× — sand drags'],
        ['River', '0.55×, swimming'],
        ['Ocean', '0.45×, swimming — the map border'],
      ])) +
      hSection('Walls, and what breaks them',
        'Every wall, tree, crate and barrel has health and a <b>toughness</b>, and toughness decides what can get through it at all.',
        hTable(['Toughness', 'What gets through'],
          Object.keys(Combat.TOUGHNESS_MEANING).map(k => ['T' + k, Combat.TOUGHNESS_MEANING[k]]))
        + hList([
          'Thin wood lets rounds <b>through</b>, bleeding damage. Metal and reinforced walls <b>ricochet</b> them back at you.',
          'Normal rounds only demolish the flimsiest cover — you can shoot through a house, but you cannot level one with a rifle.',
          'Doors open and close with ' + kAct('interact') + '. So do crates, vehicles and the climb over low cover.',
          'Barrels cook off for heavy damage and set off any barrel near them. A fuel depot goes up in a chain.',
          'Bushes hide anyone standing still inside them — which is exactly what the Sniper’s ghillie suit does out in the grass.',
        ])) +
      hSection('Loot', '',
        hList([
          'Crates come in <b>regular, silver and gold</b>. Gold can drop a legendary version of the best gun in your class, or a vehicle token.',
          'Armour, ammo, heals, grenades and tactical gear all come out of crates — and out of lockers, shelves and desks inside buildings.',
          'Nothing is ever silently destroyed: picking up more than you can carry drops the excess at your feet.',
          'A <b>supply drop</b> parachutes in mid-match and is worth the fight over it.',
        ])),

    tips: () => hSection('Things nobody tells you', '', hList([
      'Firing while moving opens your cone of fire. Stop, or aim down sights — it halves the penalty.',
      'Reload in cover. A magazine is the longest you are ever defenceless, and ' + kAct('reload') + ' keeps the rounds already in the mag.',
      'Fights are decided by who is behind something. Break line of sight and heal rather than trading the last 20 HP.',
      'Unsuppressed shots make nearby bots turn and investigate. A suppressor genuinely keeps you quiet.',
      'Grenades land where your cursor is, not at a fixed range — point further out to throw further.',
      'In Domination, a point you are standing on cannot be taken off you. Bodies on the point beat kills anywhere else.',
      'Check the minimap for the letters, not the dots: it tells you which point is which.',
      Controls.labelFor('scoreboard') + ' shows the scoreboard mid-match; ' + kAct('ping') + ' opens the ping wheel and ' + kAct('emote') + ' the emotes.',
      'Your tool is not decoration. A fire axe opens a wall, a hammer builds one, a spade digs a trench that halves incoming fire.',
    ])),
  };

  function renderHowTo() {
    const tabs = document.getElementById('howto-tabs');
    const body = document.getElementById('howto-body');
    if (!tabs || !body) return;
    tabs.innerHTML = HOWTO_TABS.map(t =>
      `<button class="howto__tab ${t.id === howtoTab ? 'is-active' : ''}" data-howto="${t.id}">${t.label}</button>`).join('');
    tabs.querySelectorAll('[data-howto]').forEach(b => b.addEventListener('click', () => {
      howtoTab = b.dataset.howto; SFX.click(); renderHowTo();
      body.scrollTop = 0;
    }));
    try { body.innerHTML = (HOWTO_BODY[howtoTab] || HOWTO_BODY.basics)(); }
    catch (e) { console.warn('[howto]', e); body.innerHTML = '<p>Nothing to show here.</p>'; }
  }

  function openHowTo(tab) {
    if (tab) howtoTab = tab;
    renderHowTo();
    document.getElementById('modal-howto').classList.add('is-open');
  }
  const closeHowTo = () => document.getElementById('modal-howto').classList.remove('is-open');

  /* Starting the guided match from anywhere that offers it. */
  function startTutorial() {
    SFX.click();
    closeHowTo();
    Game.start('tutorial');
  }

  function init() {
    // nav
    document.querySelectorAll('.topnav__btn').forEach(b =>
      b.addEventListener('click', () => { setView(b.dataset.nav); SFX.click(); }));
    // match size steppers
    document.querySelectorAll('.stepper__btn').forEach(b =>
      b.addEventListener('click', () => bumpSetup(b.dataset.setup, +b.dataset.delta)));
    // and the totals follow the mode you pick, since the defaults differ
    document.querySelectorAll('.mode-card').forEach(c =>
      c.addEventListener('click', () => setTimeout(renderSetup, 0)));
    // mode cards
    document.querySelectorAll('.mode-card').forEach(c =>
      c.addEventListener('click', () => selectMode(c.dataset.mode)));
    // settings
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('btn-profile').addEventListener('click', openSettings);
    document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeSettings));
    // live settings updates
    document.getElementById('set-volume').addEventListener('input', e => {
      document.getElementById('val-volume').textContent = e.target.value + '%'; persistSettings();
    });
    document.getElementById('set-sens').addEventListener('input', e => {
      document.getElementById('val-sens').textContent = (e.target.value / 100).toFixed(1) + '×'; persistSettings();
    });
    document.getElementById('set-botlevel').addEventListener('input', e => {
      renderBotLevel(e.target.value); persistSettings();
    });
    document.getElementById('set-fov').addEventListener('input', e => {
      document.getElementById('val-fov').textContent = e.target.value; persistSettings();
    });
    document.getElementById('set-chsize').addEventListener('input', e => {
      document.getElementById('val-chsize').textContent = e.target.value; persistSettings();
    });
    ['set-sfx', 'set-quality', 'set-dmgnum',
      'set-teamcolors', 'set-foecolor', 'set-crosshair', 'set-chcolor'].forEach(id =>
      document.getElementById(id).addEventListener('change', persistSettings));
    // the firing range starts immediately — there is nothing to queue for
    const range = document.getElementById('btn-range');
    if (range) range.addEventListener('click', () => { SFX.click(); Game.start('range'); });
    // ...and so does training, for the same reason
    const train = document.getElementById('btn-tutorial');
    if (train) train.addEventListener('click', startTutorial);
    const trainFromHowTo = document.getElementById('btn-howto-train');
    if (trainFromHowTo) trainFromHowTo.addEventListener('click', startTutorial);
    const howto = document.getElementById('btn-howto');
    if (howto) howto.addEventListener('click', () => { SFX.click(); openHowTo(); });
    ['btn-howto-x', 'btn-howto-done'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.addEventListener('click', () => { SFX.click(); closeHowTo(); });
    });
    // clicking the backdrop, and Escape, both close it — a reference nobody
    // can get out of is worse than no reference
    const howtoModal = document.getElementById('modal-howto');
    if (howtoModal) howtoModal.addEventListener('click', (e) => { if (e.target === howtoModal) closeHowTo(); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && howtoModal && howtoModal.classList.contains('is-open')) closeHowTo();
    });
    document.getElementById('btn-keys-reset').addEventListener('click', () => {
      cancelCapture(); Controls.reset(); renderKeybinds();
      keyHint('Back to the defaults.'); Toast.show('Keybinds reset.');
    });
    // closing the panel mid-capture must not leave the listener armed
    document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', cancelCapture));
    // rename
    document.getElementById('set-name').addEventListener('change', e => {
      const newName = e.target.value.trim();
      const p = DB.getProfile();
      if (newName.length >= 3) { p.username = newName; DB.saveProfile(p); renderAll(); Toast.show('Callsign updated.'); }
    });
    // reset progress
    document.getElementById('btn-reset-progress').addEventListener('click', () => {
      if (!confirm('Reset all progress for this account? This cannot be undone.')) return;
      const p = DB.getProfile();
      const fresh = DB.freshProfile(p.username);
      fresh.avatar = p.avatar;
      DB.saveProfile(fresh);
      Progression.ensureMissions(DB.getProfile());
      renderAll(); closeSettings();
      Toast.show('Progress reset.');
    });
  }

  return { show, enterHome, renderAll, init, getSelectedMode, closeSettings, openHowTo, startTutorial };
})();
