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
    document.getElementById('stat-wins').textContent = p.wins;
    document.getElementById('stat-matches').textContent = p.matches;
    document.getElementById('stat-kills').textContent = p.kills;
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
    // reset timer(s)
    document.getElementById('missions-reset').textContent = Progression.timeUntilReset();
    document.querySelectorAll('.missions-reset').forEach(e => e.textContent = Progression.timeUntilReset());
    renderMiniMissions();
  }

  const shortHost = (url) => String(url).replace(/^wss?:\/\//, '').split('/')[0];

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
        <span class="gs-mod-head">${perk.icon} ${perk.name}</span>
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

  function renderLoadout() {
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

  function persistSettings() {
    const s = DB.getSettings();
    s.botLevel = +document.getElementById('set-botlevel').value;
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
    document.getElementById('set-botlevel').addEventListener('input', e => {
      renderBotLevel(e.target.value); persistSettings();
    });
    ['set-sfx', 'set-quality', 'set-dmgnum'].forEach(id =>
      document.getElementById(id).addEventListener('change', persistSettings));
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

  return { show, enterHome, renderAll, init, getSelectedMode, closeSettings };
})();
