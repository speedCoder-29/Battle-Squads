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
    document.getElementById('stat-wins').textContent = p.wins;
    document.getElementById('stat-matches').textContent = p.matches;
    document.getElementById('stat-kills').textContent = p.kills;
    // reset timer(s)
    document.getElementById('missions-reset').textContent = Progression.timeUntilReset();
    document.querySelectorAll('.missions-reset').forEach(e => e.textContent = Progression.timeUntilReset());
    renderMiniMissions();
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
      { label: 'RANGE', v: clamp01(1 - w.falloff / 0.30) },
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

  function renderLoadout() {
    const p = DB.getProfile();
    const host = document.getElementById('loadout-grid');
    host.innerHTML = '';
    const groups = Weapons.byClass();
    Object.entries(groups).forEach(([cls, weapons]) => {
      const meta = Weapons.CLASS_META[cls] || {};
      const section = document.createElement('div');
      section.className = 'wclass';
      section.innerHTML = `<h3 class="wclass__title"><span style="color:${meta.color}">${meta.icon}</span> ${cls}</h3>`;
      const row = document.createElement('div');
      row.className = 'wclass__row';
      weapons.forEach(w => {
        const unlocked = p.unlockedWeapons.includes(w.id);
        const equipped = p.weapon === w.id;
        const card = document.createElement('button');
        card.className = 'weapon-card' + (equipped ? ' is-equipped' : '') + (unlocked ? '' : ' is-locked');
        card.innerHTML = `
          <div class="weapon-card__head">
            <span class="weapon-card__icon">${w.icon}</span>
            <span class="ammo-chip" style="background:${w.ammoColor}" title="${w.ammoType} ammo"></span>
          </div>
          <div class="weapon-card__name">${w.name}</div>
          <div class="weapon-card__type">${w.type}${w.burst > 1 ? ` · ${w.burst}-rnd burst` : ''}${w.pellets > 1 ? ` · ${w.pellets} pellets` : ''}${w.explosive ? ' · 💥 explosive' : ''}</div>
          <div class="weapon-card__stats">${statBars(w)}</div>
          <div class="weapon-card__nums">
            <span>🔧 ${w.mag} mag</span><span>⏱ ${(w.reloadMs / 1000).toFixed(1)}s</span><span>⚖ ${w.weight}</span>
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

  function persistSettings() {
    const s = DB.getSettings();
    s.volume = +document.getElementById('set-volume').value;
    s.sfx = document.getElementById('set-sfx').checked;
    s.sensitivity = +document.getElementById('set-sens').value;
    s.quality = document.getElementById('set-quality').value;
    s.dmgNumbers = document.getElementById('set-dmgnum').checked;
    DB.saveSettings(s);
  }

  function init() {
    // nav
    document.querySelectorAll('.topnav__btn').forEach(b =>
      b.addEventListener('click', () => { setView(b.dataset.nav); SFX.click(); }));
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
    ['set-sfx', 'set-quality', 'set-dmgnum'].forEach(id =>
      document.getElementById(id).addEventListener('change', persistSettings));
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

  return { show, enterHome, renderAll, init, getSelectedMode, closeSettings };
})();
