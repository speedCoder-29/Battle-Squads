/* ============================================================
   game.js — the actual 2D top-down team shooter.
   Two modes:
     • domination  — capture & hold objectives, first to score cap
     • elimination — last squad standing, no respawns
   Single-player vs bots (real multiplayer needs a server — see README).
   ============================================================ */
const Game = (() => {
  const MAP_W = 2400, MAP_H = 1600;
  const SCORE_CAP = 100;             // domination win score
  const MATCH_SECONDS = 8 * 60;      // time limit
  const TEAM_COLORS = ['#3d7bff', '#ff4b5c', '#4be08a', '#c46bff'];
  const TEAM_NAMES  = ['Blue', 'Red', 'Green', 'Violet'];

  let canvas, ctx, W, H;
  let mode = 'domination';
  let running = false, paused = false;
  let lastTime = 0;
  let camX = 0, camY = 0;
  let timeLeft = MATCH_SECONDS;

  let agents = [], bullets = [], obstacles = [], objectives = [], fx = [], dmgNums = [];
  let grenades = [], deployables = [], smokes = [], crates = [];   // tactical layer
  let flashOverlay = 0;                                            // player blind timer (s)
  let teamScores = [];
  let player = null;
  let matchStats = { kills: 0, captures: 0 };
  const TILE = 50;

  const input = { up: false, down: false, left: false, right: false, shooting: false, fireEdge: false, ads: false, mx: 0, my: 0, dashCd: 0 };

  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- setup ---------------- */
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function buildMap() {
    obstacles = [];
    // border-ish scattered cover; deterministic-ish layout with some randomness
    const layout = [
      [300, 300, 180, 60], [1900, 300, 180, 60], [300, 1240, 180, 60], [1900, 1240, 180, 60],
      [1100, 200, 200, 60], [1100, 1340, 200, 60],
      [600, 700, 60, 220], [1740, 700, 60, 220],
      [1120, 760, 160, 80], [1000, 600, 80, 80], [1300, 900, 80, 80],
      [700, 1050, 220, 60], [1480, 500, 220, 60],
      [450, 900, 120, 120], [1830, 550, 120, 120],
    ];
    layout.forEach(([x, y, w, h]) => obstacles.push({ x, y, w, h }));
  }

  function spawnPoint(team, nTeams) {
    // spread team spawns around the map corners/edges
    const spots = [
      { x: 220, y: 220 }, { x: MAP_W - 220, y: MAP_H - 220 },
      { x: MAP_W - 220, y: 220 }, { x: 220, y: MAP_H - 220 },
    ];
    const s = spots[team % spots.length];
    return { x: s.x + rand(-70, 70), y: s.y + rand(-70, 70) };
  }

  function makeAgent(team, isPlayer, weaponId) {
    const w = Weapons.byId[weaponId] || Weapons.byId[Weapons.default];
    return {
      team, isPlayer, alive: true,
      x: 0, y: 0, r: 16, angle: 0,
      hp: 100, maxHp: 100,
      weaponId: w.id, weapon: w,
      ammo: w.mag, reloadTimer: 0, fireCd: 0,
      bloom: 0, burstLeft: 0, burstCd: 0, postBurstCd: 0,   // firing state
      adrenaline: 0, blindTimer: 0, channel: null,          // status effects
      respawnTimer: 0, lives: 1,
      // ai
      strafeDir: Math.random() < 0.5 ? 1 : -1, strafeTimer: rand(0.5, 2), aiRepath: 0, aiTargetPt: null,
      name: isPlayer ? 'You' : `${TEAM_NAMES[team]}-${Math.floor(rand(1, 99))}`,
      kills: 0,
    };
  }

  function setupTeams() {
    agents = [];
    const profile = DB.getProfile();
    const playerWeapon = (profile && Weapons.byId[profile.weapon]) ? profile.weapon : Weapons.default;

    if (mode === 'domination') {
      const nTeams = 3, perTeam = 3;
      teamScores = new Array(nTeams).fill(0);
      for (let t = 0; t < nTeams; t++) {
        for (let i = 0; i < perTeam; i++) {
          const isPlayer = (t === 0 && i === 0);
          const a = makeAgent(t, isPlayer, isPlayer ? playerWeapon : pickBotWeapon());
          respawnAgent(a, true);
          if (isPlayer) player = a;
          agents.push(a);
        }
      }
      // objectives A/B/C
      objectives = [
        { name: 'A', x: 600,  y: 500,  r: 120, owner: -1, progress: 0, capTeam: -1 },
        { name: 'B', x: 1200, y: 800,  r: 130, owner: -1, progress: 0, capTeam: -1 },
        { name: 'C', x: 1800, y: 1100, r: 120, owner: -1, progress: 0, capTeam: -1 },
      ];
    } else {
      const nTeams = 4, perTeam = 2;
      teamScores = new Array(nTeams).fill(0);
      for (let t = 0; t < nTeams; t++) {
        for (let i = 0; i < perTeam; i++) {
          const isPlayer = (t === 0 && i === 0);
          const a = makeAgent(t, isPlayer, isPlayer ? playerWeapon : pickBotWeapon());
          a.lives = 1;
          respawnAgent(a, true);
          if (isPlayer) player = a;
          agents.push(a);
        }
      }
      objectives = [];
    }
  }

  function pickBotWeapon() { return Weapons.randomBot(); }

  function respawnAgent(a, initial = false) {
    const sp = spawnPoint(a.team);
    a.x = sp.x; a.y = sp.y;
    a.hp = a.maxHp; a.alive = true;
    a.ammo = a.weapon.mag; a.reloadTimer = 0; a.fireCd = 0;
    a.bloom = 0; a.burstLeft = 0; a.burstCd = 0; a.postBurstCd = 0;
    a.respawnTimer = 0;
  }

  /* ---------------- start / stop ---------------- */
  function start(selectedMode) {
    mode = selectedMode;
    Screens.show('game');
    if (!canvas) {
      canvas = document.getElementById('game-canvas');
      ctx = canvas.getContext('2d');
      bindInput();
    }
    resize();
    window.addEventListener('resize', resize);

    buildMap();
    setupTeams();
    bullets = []; fx = []; dmgNums = [];
    grenades = []; deployables = []; smokes = []; flashOverlay = 0;
    hudMessage = ''; hudMessageT = 0;
    spawnCrates(mode === 'domination' ? 6 : 8);
    // starting tactical kit
    player.inv = {
      grenade:  { id: 'frag',   n: 2 },
      tactical: { id: 'smoke',  n: 1 },
      heal:     { id: 'medkit', n: 1 },
      tokens: [],
    };
    player.baseWeapon = player.weapon;   // remember base so a looted legendary can revert
    timeLeft = MATCH_SECONDS;
    matchStats = { kills: 0, captures: 0 };
    paused = false; running = true;

    document.getElementById('hud-gamemode').textContent = mode === 'domination' ? 'DOMINATION' : 'ELIMINATION';
    document.getElementById('game-pause').classList.remove('is-open');
    document.getElementById('game-results').classList.remove('is-open');
    document.getElementById('hud-hint').style.display = '';
    updateWeaponHud();

    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    document.getElementById('game-pause').classList.toggle('is-open', paused);
    if (!paused) { lastTime = performance.now(); requestAnimationFrame(loop); }
  }

  function quitMatch() {
    running = false; paused = false;
    document.getElementById('game-pause').classList.remove('is-open');
    Screens.enterHome();
  }

  /* ---------------- input ---------------- */
  function bindInput() {
    window.addEventListener('keydown', e => {
      if (!running) return;
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': input.up = true; break;
        case 'KeyS': case 'ArrowDown': input.down = true; break;
        case 'KeyA': case 'ArrowLeft': input.left = true; break;
        case 'KeyD': case 'ArrowRight': input.right = true; break;
        case 'KeyR': startReload(player); break;
        case 'ShiftLeft': case 'ShiftRight': dash(); break;
        case 'KeyQ': throwGrenade(); break;
        case 'KeyF': useHeal(); break;
        case 'KeyC': deployTactical(); break;
        case 'KeyB': useToken(); break;
        case 'KeyE': interact(); break;
        case 'Escape': togglePause(); break;
      }
    });
    window.addEventListener('keyup', e => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': input.up = false; break;
        case 'KeyS': case 'ArrowDown': input.down = false; break;
        case 'KeyA': case 'ArrowLeft': input.left = false; break;
        case 'KeyD': case 'ArrowRight': input.right = false; break;
      }
    });
    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      input.mx = e.clientX - rect.left; input.my = e.clientY - rect.top;
    });
    canvas.addEventListener('mousedown', e => {
      if (!running || paused) return;
      if (e.button === 0) { input.shooting = true; input.fireEdge = true; }   // left = fire
      if (e.button === 2) input.ads = true;                                    // right = aim
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) input.shooting = false;
      if (e.button === 2) input.ads = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());  // don't pop menu on right-click
    // buttons
    document.getElementById('btn-resume').addEventListener('click', togglePause);
    document.getElementById('btn-quit').addEventListener('click', quitMatch);
    document.getElementById('btn-continue').addEventListener('click', () => {
      document.getElementById('game-results').classList.remove('is-open');
      Screens.enterHome();
    });
  }

  function dash() {
    if (!player.alive || input.dashCd > 0) return;
    const s = DB.getSettings();
    input.dashCd = 2.5;
    // dash in movement direction (or aim if idle)
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dx === 0 && dy === 0) { dx = Math.cos(player.angle); dy = Math.sin(player.angle); }
    const m = Math.hypot(dx, dy) || 1;
    player.x += (dx / m) * 120; player.y += (dy / m) * 120;
    resolveObstacles(player);
    spawnFx(player.x, player.y, '#35e0ff', 8);
  }

  /* ---------------- shooting ---------------- */
  const FALLOFF_START = 170, FALLOFF_UNIT = 210, FALLOFF_MIN = 0.4;

  function startReload(a) {
    if (a.reloadTimer > 0 || a.ammo >= a.weapon.mag) return;
    a.reloadTimer = a.weapon.reloadMs;
    a.burstLeft = 0;
    if (a.isPlayer) SFX.reload();
  }

  /* Pull the trigger: routes to a burst or a single shot depending on action. */
  function triggerFire(a) {
    if (!a.alive || a.reloadTimer > 0 || a.postBurstCd > 0 || a.burstLeft > 0) return;
    if (a.ammo <= 0) { startReload(a); return; }
    if (a.weapon.action === 'burst') { a.burstLeft = a.weapon.burst; a.burstCd = 0; }
    else if (a.fireCd <= 0) fireOnce(a);
  }

  /* Emit one shot (or one pellet spread). */
  function fireOnce(a) {
    if (a.ammo <= 0) { startReload(a); return; }
    const w = a.weapon;
    a.fireCd = w.fireInterval;
    a.ammo--;

    const ads = a.isPlayer && input.ads;
    const cone = w.spreadBase * (ads ? w.adsMult : 1) + a.bloom;
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const jitter = (Math.random() - 0.5) * cone * 2 + (Math.random() - 0.5) * w.pelletSpread * 2;
      const ang = a.angle + jitter;
      bullets.push({
        x: a.x + Math.cos(ang) * (a.r + 4),
        y: a.y + Math.sin(ang) * (a.r + 4),
        vx: Math.cos(ang) * w.bulletSpeed, vy: Math.sin(ang) * w.bulletSpeed,
        sx: a.x, sy: a.y,
        team: a.team, dmg: w.damage, falloff: w.falloff,
        splash: w.splashRadius, splashR: w.splashRadius,
        life: 1.6, owner: a, color: w.ammoColor,
      });
    }
    a.bloom = Math.min(w.bloomMax, a.bloom + w.recoilKick);
    spawnFx(a.x + Math.cos(a.angle) * a.r, a.y + Math.sin(a.angle) * a.r, '#ffd36a', pellets > 1 ? 5 : 3);
    if (a.isPlayer) { SFX.shoot(); if (a.ammo === 0) startReload(a); updateWeaponHud(); }
  }

  /* Explosion from launcher rounds — AoE damage that falls off with distance. */
  function explode(x, y, baseDmg, radius, team, owner) {
    spawnFx(x, y, '#ff9d3b', 22);
    for (const a of agents) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < radius) {
        const dmg = baseDmg * (1 - d / radius) * (a.team === team ? 0.5 : 1);
        if (dmg > 1) applyDamage(a, dmg, owner);
      }
    }
  }

  /* ================= CONSUMABLES / TACTICAL LAYER ================= */
  let hudMessage = '', hudMessageT = 0;
  function hudMsg(t) { hudMessage = t; hudMessageT = 2; }
  const worldMouse = () => ({ x: input.mx + camX, y: input.my + camY });
  const near2 = (a, b, r) => dist2(a.x, a.y, b.x, b.y) < r * r;

  function addItem(cat, id, n) {
    const slot = player.inv[cat];
    if (!slot) return;
    if (!slot.id || slot.id === id) { slot.id = id; slot.n = (slot.n || 0) + n; }
    else { slot.id = id; slot.n = n; }        // replace whatever was there
  }
  function equipWeapon(a, w) {
    a.weapon = w; a.weaponId = w.id; a.ammo = w.mag;
    a.reloadTimer = 0; a.burstLeft = 0; a.postBurstCd = 0;
    if (a.isPlayer) updateWeaponHud();
  }

  /* --- throw the equipped grenade toward the cursor --- */
  function throwGrenade() {
    if (!canAct()) return;
    const slot = player.inv.grenade;
    if (!slot || !slot.id || slot.n <= 0) { hudMsg('No grenade equipped'); return; }
    const it = Items.CONSUMABLES[slot.id];
    const t = worldMouse();
    let dx = t.x - player.x, dy = t.y - player.y; const d = Math.hypot(dx, dy) || 1;
    const range = it.throwRange || 520; const dist = Math.min(d, range);
    grenades.push({
      x: player.x, y: player.y, tx: player.x + dx / d * dist, ty: player.y + dy / d * dist,
      vx: dx / d * 660, vy: dy / d * 660, mode: it.mode, item: it,
      team: player.team, owner: player, arrived: false, fuzeLeft: it.fuze || 0,
    });
    slot.n--; if (slot.n <= 0) slot.id = null;
    hudMsg('Threw ' + it.name); SFX.click();
  }

  /* --- channel a heal / boost item --- */
  function useHeal() {
    if (!canAct() || player.channel) return;
    const slot = player.inv.heal;
    if (!slot || !slot.id || slot.n <= 0) { hudMsg('No heal item'); return; }
    const it = Items.CONSUMABLES[slot.id];
    player.channel = {
      t: it.time, total: it.time, label: it.name,
      onDone: () => {
        if (it.hp) player.hp = Math.min(player.maxHp, player.hp + it.hp);
        if (it.adr) player.adrenaline = Math.min(100, player.adrenaline + it.adr);
        if (it.revive) reviveTeammate();
        hudMsg(it.name + ' used');
      },
    };
    slot.n--; if (slot.n <= 0) slot.id = null;
    SFX.reload();
  }
  function reviveTeammate() {
    for (const a of agents) {
      if (!a.alive && !a.isVehicle && a.team === player.team && near2(a, player, 150)) {
        a.alive = true; a.hp = a.maxHp * 0.5; a.ammo = a.weapon.mag;
        a.x = player.x + rand(-30, 30); a.y = player.y + rand(-30, 30);
        hudMsg('Revived ' + a.name); return;
      }
    }
  }

  /* --- deploy the equipped tactical item --- */
  function deployTactical() {
    if (!canAct()) return;
    const slot = player.inv.tactical;
    if (!slot || !slot.id || slot.n <= 0) { hudMsg('No tactical item'); return; }
    const it = Items.CONSUMABLES[slot.id];
    if (it.mode === 'mine') deployables.push({ type: 'mine', x: player.x, y: player.y, team: player.team, owner: player, item: it, arm: it.arm, life: 60 });
    else if (it.mode === 'wall') {
      const wx = player.x + Math.cos(player.angle) * 42, wy = player.y + Math.sin(player.angle) * 42;
      deployables.push({ type: 'wall', x: wx, y: wy, item: it, life: it.life, rect: { x: wx - it.w / 2, y: wy - it.h / 2, w: it.w, h: it.h } });
    }
    else if (it.mode === 'ammo') deployables.push({ type: 'ammo', x: player.x, y: player.y, team: player.team, item: it, supply: it.supply, life: it.life });
    else if (it.mode === 'flag') deployables.push({ type: 'flag', x: player.x, y: player.y, team: player.team, item: it, life: it.life });
    slot.n--; if (slot.n <= 0) slot.id = null;
    hudMsg('Deployed ' + it.name); SFX.capture();
  }

  /* --- call in a vehicle token at the cursor --- */
  function useToken() {
    if (!canAct()) return;
    if (!player.inv.tokens.length) { hudMsg('No call-in tokens (open crates!)'); return; }
    const t = player.inv.tokens.shift();
    const p = worldMouse();
    spawnVehicle(player.team, t, p.x, p.y);
    hudMsg((t === 'tank' ? 'Tank' : 'Armored Jeep') + ' called in!'); SFX.win();
  }
  function spawnVehicle(team, vtype, x, y) {
    const conf = vtype === 'tank'
      ? { hp: 600, weapon: 'qlz-87', r: 26, speed: 110 }
      : { hp: 320, weapon: 'm249', r: 22, speed: 175 };
    const v = makeAgent(team, false, conf.weapon);
    v.isVehicle = true; v.vtype = vtype; v.maxHp = conf.hp; v.hp = conf.hp; v.r = conf.r; v.vspeed = conf.speed;
    v.name = (vtype === 'tank' ? 'Tank' : 'Jeep');
    v.x = clamp(x, v.r, MAP_W - v.r); v.y = clamp(y, v.r, MAP_H - v.r);
    agents.push(v);
  }

  /* --- interact (E): open a crate or grab from an ammo box --- */
  function interact() {
    if (!canAct()) return;
    let best = null, bd = 95 * 95;
    for (const c of crates) if (!c.opened) { const d = dist2(player.x, player.y, c.x, c.y); if (d < bd) { bd = d; best = c; } }
    if (best) { openCrate(best); return; }
    for (const dp of deployables) {
      if (dp.type === 'ammo' && dp.supply > 0 && near2(dp, player, 95)) {
        player.ammo = player.weapon.mag; dp.supply -= player.weapon.mag;
        updateWeaponHud(); hudMsg('Resupplied'); SFX.reload(); return;
      }
    }
    hudMsg('Nothing to interact with');
  }

  function spawnCrates(n) {
    crates = [];
    for (let i = 0; i < n; i++) {
      let x, y, tries = 0;
      do { x = rand(200, MAP_W - 200); y = rand(200, MAP_H - 200); tries++; }
      while (pointInObstacle(x, y) && tries < 20);
      crates.push({ x, y, tier: Items.rollCrateTier(), opened: false });
    }
  }
  function openCrate(c) {
    c.opened = true;
    const entry = Items.rollLoot(c.tier);
    grantLoot(entry);
    SFX.reward();
  }
  function grantLoot(entry) {
    switch (entry.id) {
      case 'ammo': { player.ammo = player.weapon.mag; addItem('grenade', player.inv.grenade.id || 'frag', 1); hudMsg('Ammo + spare mag'); break; }
      case 'classConsumable': { const cid = Items.randomClassConsumable(); const it = Items.CONSUMABLES[cid]; addItem(it.cat, cid, 2); hudMsg('Class drop: ' + it.name + ' ×2'); break; }
      case 'legendary': {
        const cls = (Weapons.byId[player.baseWeapon.id] || player.weapon).className;
        const gold = Items.makeLegendary(Items.bestOfClass(cls));
        equipWeapon(player, gold); hudMsg('LEGENDARY! ' + gold.name); break;
      }
      case 'jeep': player.inv.tokens.push('jeep'); hudMsg('Jeep token — press B to call in'); break;
      case 'tank': player.inv.tokens.push('tank'); hudMsg('Tank token — press B to call in'); break;
      case 'flag': addItem('tactical', 'flag', 1); hudMsg('Got Cool Flag'); break;
      default: {
        const it = Items.CONSUMABLES[entry.id];
        if (it) { addItem(it.cat, entry.id, 1); hudMsg('Got ' + it.name); }
        else hudMsg('Got ' + entry.label);
      }
    }
  }

  const canAct = () => running && !paused && player && player.alive && player.inv;

  /* --- per-frame updates for the tactical entities --- */
  function updateGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i];
      if (!g.arrived) {
        const dx = g.tx - g.x, dy = g.ty - g.y, dd = Math.hypot(dx, dy), step = 660 * dt;
        // impact grenades blow on contact with an enemy or wall
        if (g.mode === 'impact' && (pointInObstacle(g.x, g.y) || hitsEnemy(g))) { detonate(g); grenades.splice(i, 1); continue; }
        if (dd <= step) { g.x = g.tx; g.y = g.ty; g.arrived = true; }
        else { g.x += g.vx * dt; g.y += g.vy * dt; }
      } else {
        if (g.mode === 'impact') { detonate(g); grenades.splice(i, 1); continue; }
        g.fuzeLeft -= dt;
        if (g.fuzeLeft <= 0) { detonate(g); grenades.splice(i, 1); }
      }
    }
  }
  function hitsEnemy(g) {
    for (const a of agents) if (a.alive && a.team !== g.team && near2(a, g, a.r + 6)) return true;
    return false;
  }
  function detonate(g) {
    const it = g.item;
    if (g.mode === 'fuze' || g.mode === 'impact' || g.mode === 'c4') { explode(g.x, g.y, it.damage, it.radius, g.team, g.owner); SFX.kill(); }
    else if (g.mode === 'smoke') smokes.push({ x: g.x, y: g.y, r: it.radius, life: it.duration, max: it.duration });
    else if (g.mode === 'flash') flashDetonate(g.x, g.y, it.radius, it.blind, g.team);
  }
  function flashDetonate(x, y, radius, blind, team) {
    spawnFx(x, y, '#ffffff', 26);
    for (const a of agents) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < radius && hasLOS(x, y, a.x, a.y)) {
        const dur = blind * (1 - d / radius);
        if (a.isPlayer) flashOverlay = Math.max(flashOverlay, dur);
        else a.blindTimer = Math.max(a.blindTimer, dur);
      }
    }
  }
  function updateDeployables(dt) {
    for (let i = deployables.length - 1; i >= 0; i--) {
      const dp = deployables[i];
      dp.life -= dt;
      if (dp.life <= 0) { deployables.splice(i, 1); continue; }
      if (dp.type === 'mine') {
        if (dp.arm > 0) { dp.arm -= dt; continue; }
        for (const a of agents) {
          if (a.alive && a.team !== dp.team && near2(a, dp, dp.item.trigger)) {
            explode(dp.x, dp.y, dp.item.damage, dp.item.radius, dp.team, dp.owner);
            deployables.splice(i, 1); break;
          }
        }
      } else if (dp.type === 'flag') {
        for (const a of agents) if (a.alive && a.team === dp.team && near2(a, dp, dp.item.radius)) a.adrenaline = Math.max(a.adrenaline, 25);
      }
    }
  }
  function updateSmokes(dt) {
    for (let i = smokes.length - 1; i >= 0; i--) { smokes[i].life -= dt; if (smokes[i].life <= 0) smokes.splice(i, 1); }
  }
  const activeWalls = () => deployables.filter(d => d.type === 'wall').map(d => d.rect);
  function smokeBlocks(x1, y1, x2, y2) {
    if (!smokes.length) return false;
    for (let t = 0.15; t < 1; t += 0.12) {
      const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
      for (const s of smokes) if (dist2(px, py, s.x, s.y) < (s.r * 0.85) ** 2) return true;
    }
    return false;
  }
  const botCanSee = (a, b) => hasLOS(a.x, a.y, b.x, b.y) && !smokeBlocks(a.x, a.y, b.x, b.y);

  /* ---------------- collision helpers ---------------- */
  function resolveObstacles(a) {
    a.x = clamp(a.x, a.r, MAP_W - a.r);
    a.y = clamp(a.y, a.r, MAP_H - a.r);
    const rects = obstacles.concat(activeWalls());
    for (const o of rects) {
      const cx = clamp(a.x, o.x, o.x + o.w);
      const cy = clamp(a.y, o.y, o.y + o.h);
      const dx = a.x - cx, dy = a.y - cy;
      const d = Math.hypot(dx, dy);
      if (d < a.r && d > 0) {
        a.x = cx + (dx / d) * a.r;
        a.y = cy + (dy / d) * a.r;
      } else if (d === 0) {
        a.x += a.r; // dead center — nudge out
      }
    }
  }

  function pointInObstacle(x, y) {
    for (const o of obstacles) if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return true;
    for (const o of activeWalls()) if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return true;
    return false;
  }

  function hasLOS(ax, ay, bx, by) {
    const steps = 12;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (pointInObstacle(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }

  function nearestEnemy(a) {
    let best = null, bd = Infinity;
    for (const o of agents) {
      if (!o.alive || o.team === a.team) continue;
      const d = dist2(a.x, a.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    return { enemy: best, d: Math.sqrt(bd) };
  }

  /* ---------------- bot AI ---------------- */
  function updateBot(a, dt) {
    // flashed: stumble blindly, can't fight
    if (a.blindTimer > 0) {
      const spd = (a.isVehicle ? a.vspeed : a.weapon.moveSpeed * 0.5) * dt;
      a.x += Math.cos(a.angle + a.strafeDir) * spd * 0.3;
      a.y += Math.sin(a.angle + a.strafeDir) * spd * 0.3;
      resolveObstacles(a);
      return;
    }
    const { enemy, d } = nearestEnemy(a);
    let moveX = 0, moveY = 0;

    // choose a goal point
    a.aiRepath -= dt;
    if (mode === 'domination') {
      // head to the nearest objective not fully owned by us, unless enemy is very close
      if (!a.aiTargetPt || a.aiRepath <= 0) {
        let bestObj = null, bo = Infinity;
        for (const obj of objectives) {
          if (obj.owner === a.team && obj.progress >= 100) continue;
          const dd = dist2(a.x, a.y, obj.x, obj.y);
          if (dd < bo) { bo = dd; bestObj = obj; }
        }
        a.aiTargetPt = bestObj ? { x: obj_jitter(bestObj), y: obj_jitterY(bestObj) } : null;
        a.aiRepath = rand(2, 4);
      }
    }

    const range = botRange(a.weapon);
    if (enemy && d < range && botCanSee(a, enemy)) {
      // combat: face + shoot, keep preferred distance, strafe
      const baseAng = Math.atan2(enemy.y - a.y, enemy.x - a.x);
      const ideal = range * 0.55;
      if (d > ideal + 40) { moveX += Math.cos(baseAng); moveY += Math.sin(baseAng); }
      else if (d < ideal - 40) { moveX -= Math.cos(baseAng); moveY -= Math.sin(baseAng); }
      a.strafeTimer -= dt;
      if (a.strafeTimer <= 0) { a.strafeDir *= -1; a.strafeTimer = rand(0.6, 1.6); }
      moveX += Math.cos(baseAng + Math.PI / 2) * a.strafeDir * 0.8;
      moveY += Math.sin(baseAng + Math.PI / 2) * a.strafeDir * 0.8;
      // aim with a little human error, then pull the trigger
      a.angle = baseAng + (Math.random() - 0.5) * 0.11;
      if (d < range * 0.92) triggerFire(a);
    } else if (a.aiTargetPt) {
      const ang = Math.atan2(a.aiTargetPt.y - a.y, a.aiTargetPt.x - a.x);
      a.angle = ang; moveX += Math.cos(ang); moveY += Math.sin(ang);
      if (dist2(a.x, a.y, a.aiTargetPt.x, a.aiTargetPt.y) < 60 * 60) a.aiTargetPt = null;
    } else if (enemy) {
      // roam toward enemy
      const ang = Math.atan2(enemy.y - a.y, enemy.x - a.x);
      a.angle = ang; moveX += Math.cos(ang); moveY += Math.sin(ang);
    }

    const m = Math.hypot(moveX, moveY);
    if (m > 0) {
      const spd = (a.isVehicle ? a.vspeed : a.weapon.moveSpeed * 0.72) * dt;
      a.x += (moveX / m) * spd; a.y += (moveY / m) * spd;
      resolveObstacles(a);
    }
    if (a.ammo <= 0) startReload(a);
  }
  const obj_jitter = (o) => o.x + rand(-o.r * 0.5, o.r * 0.5);
  const obj_jitterY = (o) => o.y + rand(-o.r * 0.5, o.r * 0.5);
  function botRange(w) {
    const byType = { 'Shotgun': 280, 'SMG': 380, 'Pistol': 360, 'Assault Rifle': 540, 'Burst Rifle': 540,
      'Carbine': 500, 'LMG': 580, 'DMR': 720, 'Sniper Rifle': 860, 'Launcher': 520 };
    return byType[w.type] || 520;
  }

  /* ---------------- update ---------------- */
  function update(dt) {
    timeLeft -= dt;
    if (input.dashCd > 0) input.dashCd -= dt;

    // player status timers
    if (player.adrenaline > 0) player.adrenaline = Math.max(0, player.adrenaline - 5 * dt);
    if (player.channel) { player.channel.t -= dt; if (player.channel.t <= 0) { player.channel.onDone(); player.channel = null; } }
    if (flashOverlay > 0) flashOverlay -= dt;
    if (hudMessageT > 0) hudMessageT -= dt;

    // player control
    if (player.alive) {
      let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      const m = Math.hypot(dx, dy);
      if (m > 0) {
        let base = player.weapon.moveSpeed;
        if (input.ads) base *= 0.55;                 // aiming slows you
        if (player.adrenaline > 0) base *= 1.25;     // adrenaline speed boost
        if (player.channel) base *= 0.4;             // channeling a heal
        const spd = base * dt;
        player.x += (dx / m) * spd; player.y += (dy / m) * spd; resolveObstacles(player);
      }
      // aim toward cursor
      const psx = player.x - camX, psy = player.y - camY;
      player.angle = Math.atan2(input.my - psy, input.mx - psx);
      // fire: automatics fire while held; everything else one shot per click. Can't shoot mid-heal.
      if (!player.channel) {
        if (player.weapon.action === 'auto') { if (input.shooting) triggerFire(player); }
        else if (input.fireEdge) { triggerFire(player); }
      }
      input.fireEdge = false;
    } else {
      input.fireEdge = false;
    }

    // agents timers + AI
    for (const a of agents) {
      const ms = dt * 1000;
      if (a.fireCd > 0) a.fireCd -= ms;
      if (a.postBurstCd > 0) a.postBurstCd -= ms;
      if (a.blindTimer > 0) a.blindTimer -= dt;
      if (a.bloom > 0) a.bloom = Math.max(0, a.bloom - a.bloom * 7 * dt);
      if (a.reloadTimer > 0) { a.reloadTimer -= ms; if (a.reloadTimer <= 0) { a.ammo = a.weapon.mag; if (a.isPlayer) updateWeaponHud(); } }
      // drive an in-progress burst
      if (a.burstLeft > 0) {
        a.burstCd -= ms;
        if (a.burstCd <= 0 && a.reloadTimer <= 0) {
          if (a.ammo > 0) { fireOnce(a); a.burstLeft--; a.burstCd = a.weapon.fireInterval; if (a.burstLeft === 0) a.postBurstCd = a.weapon.burstDelay; }
          else { a.burstLeft = 0; startReload(a); }
        }
      }
      if (!a.alive) {
        if (mode === 'domination' && !a.isVehicle) { a.respawnTimer -= dt; if (a.respawnTimer <= 0) respawnAgent(a); }
        continue;
      }
      if (!a.isPlayer) updateBot(a, dt);
    }

    // bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0 || b.x < 0 || b.y < 0 || b.x > MAP_W || b.y > MAP_H;
      let hitObstacle = false;
      if (!dead && pointInObstacle(b.x, b.y)) { dead = true; hitObstacle = true; if (!b.splash) spawnFx(b.x, b.y, '#8ea0c9', 3); }
      if (!dead) {
        for (const a of agents) {
          if (!a.alive || a.team === b.team) continue;
          if (dist2(a.x, a.y, b.x, b.y) < a.r * a.r) {
            if (!b.splash) {   // explosives deal their damage via the blast below
              const travelled = Math.hypot(b.x - b.sx, b.y - b.sy);
              const steps = Math.max(0, travelled - FALLOFF_START) / FALLOFF_UNIT;
              const mult = Math.max(FALLOFF_MIN, 1 - b.falloff * steps);
              applyDamage(a, b.dmg * mult, b.owner);
              spawnFx(b.x, b.y, TEAM_COLORS[a.team], 4);
            }
            dead = true; break;
          }
        }
      }
      if (dead) {
        if (b.splash) explode(b.x, b.y, b.dmg, b.splashR, b.team, b.owner);
        bullets.splice(i, 1);
      }
    }

    // objectives (domination)
    if (mode === 'domination') updateObjectives(dt);

    // tactical layer
    updateGrenades(dt);
    updateDeployables(dt);
    updateSmokes(dt);

    // fx + damage numbers
    for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.x += f.vx * dt; f.y += f.vy * dt; f.life -= dt; if (f.life <= 0) fx.splice(i, 1); }
    for (let i = dmgNums.length - 1; i >= 0; i--) { const d = dmgNums[i]; d.y -= 30 * dt; d.life -= dt; if (d.life <= 0) dmgNums.splice(i, 1); }

    // camera follow (player, or a living teammate if player is down in elimination)
    const focus = player.alive ? player : (agents.find(a => a.alive && a.team === 0) || player);
    camX = clamp(focus.x - W / 2, 0, Math.max(0, MAP_W - W));
    camY = clamp(focus.y - H / 2, 0, Math.max(0, MAP_H - H));

    checkWinConditions();
    updateHud();
  }

  function applyDamage(a, dmg, owner) {
    a.hp -= dmg;
    if (DB.getSettings().dmgNumbers) dmgNums.push({ x: a.x, y: a.y - a.r, val: Math.round(dmg), life: 0.7, crit: dmg >= 40 });
    if (a.isPlayer) SFX.hurt();
    if (a.hp <= 0) {
      a.hp = 0; a.alive = false;
      spawnFx(a.x, a.y, TEAM_COLORS[a.team], 14);
      if (owner) { owner.kills++; if (owner.isPlayer) { matchStats.kills++; SFX.kill(); } }
      if (mode === 'domination') a.respawnTimer = 3;
      if (a.isPlayer) SFX.hurt();
    }
  }

  function updateObjectives(dt) {
    for (const obj of objectives) {
      // who is contesting?
      const counts = {};
      let contenders = 0;
      for (const a of agents) {
        if (!a.alive) continue;
        if (dist2(a.x, a.y, obj.x, obj.y) < obj.r * obj.r) { counts[a.team] = (counts[a.team] || 0) + 1; }
      }
      const teamsPresent = Object.keys(counts);
      if (teamsPresent.length === 1) {
        const t = +teamsPresent[0];
        if (obj.owner !== t) {
          // capture toward team t
          if (obj.capTeam !== t) { obj.capTeam = t; }
          obj.progress += 45 * dt * counts[t];
          if (obj.progress >= 100) {
            obj.progress = 100; const prev = obj.owner; obj.owner = t;
            // player capture credit
            const playerNear = dist2(player.x, player.y, obj.x, obj.y) < obj.r * obj.r;
            if (t === 0 && playerNear) { matchStats.captures++; }
            if (t === 0) SFX.capture();
            Toast.show(`${TEAM_NAMES[t]} captured objective ${obj.name}`);
          }
        }
      } else if (teamsPresent.length === 0 && obj.owner === -1) {
        obj.progress = Math.max(0, obj.progress - 20 * dt);
      }
      // owned objectives generate score
      if (obj.owner >= 0) teamScores[obj.owner] += 4 * dt;
    }
  }

  function checkWinConditions() {
    if (!running) return;
    if (mode === 'domination') {
      for (let t = 0; t < teamScores.length; t++) {
        if (teamScores[t] >= SCORE_CAP) return endMatch(t === 0);
      }
      if (timeLeft <= 0) {
        const maxScore = Math.max(...teamScores);
        return endMatch(teamScores[0] === maxScore);
      }
    } else {
      // elimination: count teams with living members
      const alive = new Set();
      for (const a of agents) if (a.alive) alive.add(a.team);
      // also a team is "out" only if all its members are dead (lives=1, no respawn)
      if (alive.size <= 1) {
        return endMatch(alive.has(0));
      }
      if (timeLeft <= 0) {
        // time out — most members alive wins
        const counts = new Array(teamScores.length).fill(0);
        agents.forEach(a => { if (a.alive) counts[a.team]++; });
        const max = Math.max(...counts);
        return endMatch(counts[0] === max && counts[0] > 0);
      }
    }
  }

  /* ---------------- match end + rewards ---------------- */
  function endMatch(won) {
    if (!running) return;
    running = false;
    input.shooting = false;

    const profile = DB.getProfile();
    const score = mode === 'domination' ? Math.round(teamScores[0]) : matchStats.kills * 10;
    const xp = 100 + matchStats.kills * 25 + (won ? 150 : 0);
    const credits = 50 + matchStats.kills * 10 + (won ? 100 : 0);

    // update lifetime stats
    profile.matches++;
    profile.kills += matchStats.kills;
    if (won) profile.wins++;
    profile.credits += credits;

    // missions
    const metrics = {
      kills: matchStats.kills, matches: 1, wins: won ? 1 : 0, captures: matchStats.captures,
      domMatches: mode === 'domination' ? 1 : 0, elimMatches: mode === 'elimination' ? 1 : 0,
    };
    const bonusCredits = Progression.applyMissionProgress(profile, metrics);
    profile.credits += bonusCredits;

    // xp / battle pass / level
    Progression.awardXp(profile, xp);
    DB.saveProfile(profile);

    // results UI
    const title = document.getElementById('result-title');
    title.textContent = won ? 'VICTORY' : 'DEFEAT';
    title.className = won ? 'is-victory' : 'is-defeat';
    document.getElementById('result-sub').textContent = won
      ? (mode === 'domination' ? 'Your squad held the objectives.' : 'Last squad standing — GG.')
      : 'Better luck next deployment, soldier.';
    document.getElementById('res-kills').textContent = matchStats.kills;
    document.getElementById('res-score').textContent = score;
    document.getElementById('res-xp').textContent = '+' + xp;
    document.getElementById('res-credits').textContent = '+' + (credits + bonusCredits);
    document.getElementById('game-results').classList.add('is-open');
    won ? SFX.win() : SFX.lose();
  }

  /* ---------------- fx ---------------- */
  function spawnFx(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(30, 160);
      fx.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.5), color, r: rand(1.5, 3.5) });
    }
  }

  /* ---------------- HUD ---------------- */
  function updateWeaponHud() {
    if (!player) return;
    document.getElementById('hud-weapon').textContent = player.weapon.name;
    document.getElementById('hud-ammo').textContent = player.reloadTimer > 0 ? '⟳' : player.ammo;
    document.getElementById('hud-ammomax').textContent = '/' + player.weapon.mag;
  }

  function updateHud() {
    // health
    document.getElementById('hud-hpfill').style.width = clamp(player.hp / player.maxHp * 100, 0, 100) + '%';
    document.getElementById('hud-ammo').textContent = player.reloadTimer > 0 ? '⟳' : player.ammo;
    // timer
    const t = Math.max(0, Math.floor(timeLeft));
    document.getElementById('hud-gametimer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    // scores
    const wrap = document.getElementById('hud-scores');
    if (mode === 'domination') {
      wrap.innerHTML = teamScores.map((s, t) =>
        `<div class="score-pill ${t === 0 ? 'is-you' : ''}"><span class="dot" style="background:${TEAM_COLORS[t]}"></span>${Math.round(s)}</div>`
      ).join('');
    } else {
      const counts = new Array(teamScores.length).fill(0);
      agents.forEach(a => { if (a.alive) counts[a.team]++; });
      wrap.innerHTML = counts.map((c, t) =>
        `<div class="score-pill ${t === 0 ? 'is-you' : ''}"><span class="dot" style="background:${TEAM_COLORS[t]}"></span>${c} alive</div>`
      ).join('');
    }
  }

  /* ---------------- render ---------------- */
  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(-camX, -camY);

    // ground
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, MAP_W, MAP_H);
    // grid
    ctx.strokeStyle = 'rgba(120,160,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= MAP_W; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); }
    for (let y = 0; y <= MAP_H; y += 80) { ctx.moveTo(0, y); ctx.lineTo(MAP_W, y); }
    ctx.stroke();
    // border
    ctx.strokeStyle = 'rgba(120,160,255,0.25)'; ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, MAP_W, MAP_H);

    // objectives
    for (const obj of objectives) {
      const col = obj.owner >= 0 ? TEAM_COLORS[obj.owner] : '#8ea0c9';
      ctx.beginPath(); ctx.arc(obj.x, obj.y, obj.r, 0, Math.PI * 2);
      ctx.fillStyle = hexA(col, 0.10); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = hexA(col, 0.5); ctx.stroke();
      // capture ring
      if (obj.owner === -1 && obj.progress > 0) {
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, obj.r - 6, -Math.PI / 2, -Math.PI / 2 + (obj.progress / 100) * Math.PI * 2);
        ctx.lineWidth = 6; ctx.strokeStyle = obj.capTeam >= 0 ? TEAM_COLORS[obj.capTeam] : '#fff'; ctx.stroke();
      }
      ctx.fillStyle = col; ctx.font = 'bold 40px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.5; ctx.fillText(obj.name, obj.x, obj.y); ctx.globalAlpha = 1;
    }

    // obstacles
    for (const o of obstacles) {
      roundRect(o.x, o.y, o.w, o.h, 6);
      ctx.fillStyle = '#1a2542'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(120,160,255,0.25)'; ctx.stroke();
    }

    drawCratesAndDeployables();

    // fx under agents
    for (const f of fx) { ctx.globalAlpha = clamp(f.life * 2.5, 0, 1); ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;

    // bullets
    for (const b of bullets) {
      ctx.strokeStyle = hexA(TEAM_COLORS[b.team], 0.9); ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02); ctx.stroke();
    }
    drawGrenades();

    // agents
    for (const a of agents) {
      if (!a.alive) {
        if (mode === 'domination' && !a.isVehicle) { // respawn marker
          ctx.globalAlpha = 0.25; ctx.fillStyle = TEAM_COLORS[a.team];
          ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
        continue;
      }
      if (a.isVehicle) { drawVehicle(a); continue; }
      // barrel
      ctx.strokeStyle = '#e9f0ff'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + Math.cos(a.angle) * (a.r + 12), a.y + Math.sin(a.angle) * (a.r + 12)); ctx.stroke();
      // body
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.fillStyle = TEAM_COLORS[a.team]; ctx.fill();
      ctx.lineWidth = a.isPlayer ? 4 : 2;
      ctx.strokeStyle = a.isPlayer ? '#fff' : 'rgba(0,0,0,0.4)'; ctx.stroke();
      // player glow ring
      if (a.isPlayer) { ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 6, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(53,224,255,0.6)'; ctx.lineWidth = 2; ctx.stroke(); }
      // health bar
      const hpw = 34;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(a.x - hpw / 2, a.y - a.r - 12, hpw, 5);
      ctx.fillStyle = a.hp > 50 ? '#4be08a' : a.hp > 25 ? '#ffcf4a' : '#ff4b5c';
      ctx.fillRect(a.x - hpw / 2, a.y - a.r - 12, hpw * (a.hp / a.maxHp), 5);
    }

    // damage numbers
    for (const d of dmgNums) {
      ctx.globalAlpha = clamp(d.life * 1.6, 0, 1);
      ctx.fillStyle = d.crit ? '#ffcf4a' : '#fff';
      ctx.font = `bold ${d.crit ? 22 : 16}px Segoe UI`; ctx.textAlign = 'center';
      ctx.fillText(d.val, d.x, d.y);
    }
    ctx.globalAlpha = 1;

    drawSmokes();   // smoke sits above units to obscure them

    ctx.restore();

    // dead overlay hint
    if (!player.alive && running) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 34px Segoe UI';
      ctx.fillText(mode === 'domination' ? 'RESPAWNING…' : 'ELIMINATED — spectating', W / 2, H / 2);
    }

    drawTacticalHud();
    drawMinimap();

    // flashbang whiteout (screen space, over everything)
    if (flashOverlay > 0) { ctx.fillStyle = `rgba(255,255,255,${clamp(flashOverlay / 1.5, 0, 0.96)})`; ctx.fillRect(0, 0, W, H); }
  }

  /* ---------------- tactical rendering helpers ---------------- */
  function drawCratesAndDeployables() {
    // crates
    for (const c of crates) {
      const st = Items.CRATE_STYLE[c.tier];
      ctx.globalAlpha = c.opened ? 0.3 : 1;
      roundRect(c.x - 15, c.y - 15, 30, 30, 6);
      ctx.fillStyle = c.opened ? '#20283f' : hexA(st.color, 0.9); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = st.color; ctx.stroke();
      if (!c.opened) {
        ctx.font = '18px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(st.icon, c.x, c.y + 1);
        // interact prompt when player is close
        if (near2(player, c, 95)) { ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Segoe UI'; ctx.fillText('[E] ' + st.name, c.x, c.y - 26); }
      }
      ctx.globalAlpha = 1;
    }
    // deployables
    for (const dp of deployables) {
      if (dp.type === 'wall') {
        const r = dp.rect; roundRect(r.x, r.y, r.w, r.h, 4);
        ctx.fillStyle = '#3a4a6a'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#6f86b8'; ctx.stroke();
      } else if (dp.type === 'mine') {
        ctx.beginPath(); ctx.arc(dp.x, dp.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = dp.arm > 0 ? '#7a8699' : '#ff4b5c'; ctx.fill();
        if (dp.arm <= 0) { ctx.beginPath(); ctx.arc(dp.x, dp.y, dp.item.trigger, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,75,92,0.15)'; ctx.lineWidth = 1; ctx.stroke(); }
      } else if (dp.type === 'ammo') {
        ctx.font = '22px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('📦', dp.x, dp.y);
        if (near2(player, dp, 95)) { ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Segoe UI'; ctx.fillText('[E] Ammo', dp.x, dp.y - 22); }
      } else if (dp.type === 'flag') {
        ctx.beginPath(); ctx.arc(dp.x, dp.y, dp.item.radius, 0, Math.PI * 2);
        ctx.fillStyle = hexA(TEAM_COLORS[dp.team], 0.06); ctx.fill();
        ctx.strokeStyle = hexA(TEAM_COLORS[dp.team], 0.4); ctx.lineWidth = 2; ctx.stroke();
        ctx.font = '26px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🚩', dp.x, dp.y);
      }
    }
  }
  function drawGrenades() {
    for (const g of grenades) {
      ctx.beginPath(); ctx.arc(g.x, g.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = g.mode === 'smoke' ? '#cfd8ee' : g.mode === 'flash' ? '#fff' : '#ff9d3b';
      ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  function drawSmokes() {
    for (const s of smokes) {
      const a = clamp(s.life / 2, 0, 0.9) * (s.life < s.max ? 1 : 0.6);
      const grad = ctx.createRadialGradient(s.x, s.y, s.r * 0.2, s.x, s.y, s.r);
      grad.addColorStop(0, `rgba(200,208,225,${a})`);
      grad.addColorStop(1, 'rgba(200,208,225,0)');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawVehicle(a) {
    const col = TEAM_COLORS[a.team];
    ctx.save();
    ctx.translate(a.x, a.y); ctx.rotate(a.angle);
    // hull
    roundRect(-a.r, -a.r * 0.8, a.r * 2, a.r * 1.6, 5);
    ctx.fillStyle = a.vtype === 'tank' ? '#2c3a24' : '#243a2c'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
    // barrel
    ctx.fillStyle = '#e9f0ff'; ctx.fillRect(0, -3, a.r + 16, 6);
    ctx.restore();
    // icon + hp
    ctx.font = '16px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(a.vtype === 'tank' ? '🛡️' : '🚙', a.x, a.y);
    const hpw = 46;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(a.x - hpw / 2, a.y - a.r - 14, hpw, 5);
    ctx.fillStyle = col; ctx.fillRect(a.x - hpw / 2, a.y - a.r - 14, hpw * (a.hp / a.maxHp), 5);
  }

  /* on-canvas HUD for the tactical kit (inventory, adrenaline, channel, messages) */
  function drawTacticalHud() {
    const p = player; if (!p || !p.inv) return;
    // adrenaline bar (above the HTML health bar area)
    if (p.adrenaline > 0) {
      const bx = 22, by = H - 66, bw = 220;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(bx, by, bw, 8, 4); ctx.fill();
      ctx.fillStyle = '#ffcf4a'; roundRect(bx, by, bw * (p.adrenaline / 100), 8, 4); ctx.fill();
    }
    // inventory slots bottom-center
    const slots = [
      { key: 'Q', s: p.inv.grenade }, { key: 'C', s: p.inv.tactical }, { key: 'F', s: p.inv.heal },
    ];
    const sw = 74, gap = 10, totalW = slots.length * sw + (slots.length - 1) * gap + (p.inv.tokens.length ? sw + gap : 0);
    let x = W / 2 - totalW / 2; const y = H - 92;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const sl of slots) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(x, y, sw, 70, 10); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(120,160,255,0.3)'; ctx.stroke();
      const it = sl.s && sl.s.id ? Items.CONSUMABLES[sl.s.id] : null;
      ctx.font = '24px Segoe UI'; ctx.fillStyle = it ? '#fff' : '#3b4666';
      ctx.fillText(it ? it.icon : '—', x + sw / 2, y + 28);
      ctx.font = 'bold 11px Segoe UI'; ctx.fillStyle = '#8ea0c9';
      ctx.fillText(it ? `${it.name}` : '', x + sw / 2, y + 52);
      ctx.fillStyle = '#ffcf4a'; ctx.font = 'bold 11px Segoe UI';
      ctx.textAlign = 'left'; ctx.fillText('[' + sl.key + ']', x + 6, y + 12);
      if (it && sl.s.n) { ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText('×' + sl.s.n, x + sw - 6, y + 12); }
      ctx.textAlign = 'center';
      x += sw + gap;
    }
    // token slot
    if (p.inv.tokens.length) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(x, y, sw, 70, 10); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = '#ffcf4a'; ctx.stroke();
      ctx.font = '24px Segoe UI'; ctx.fillStyle = '#fff';
      ctx.fillText(Items.CONSUMABLES[p.inv.tokens[0]].icon, x + sw / 2, y + 28);
      ctx.font = 'bold 11px Segoe UI'; ctx.fillStyle = '#8ea0c9'; ctx.fillText('Call-in', x + sw / 2, y + 52);
      ctx.textAlign = 'left'; ctx.fillStyle = '#ffcf4a'; ctx.fillText('[B]', x + 6, y + 12);
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText('×' + p.inv.tokens.length, x + sw - 6, y + 12);
      ctx.textAlign = 'center';
    }
    // channel ring (heal progress)
    if (p.channel) {
      const cx = W / 2, cy = H / 2 + 70, rad = 26;
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 6; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + (1 - p.channel.t / p.channel.total) * Math.PI * 2);
      ctx.strokeStyle = '#4be08a'; ctx.lineWidth = 6; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText(p.channel.label, cx, cy + rad + 16);
    }
    // transient message
    if (hudMessageT > 0) {
      ctx.globalAlpha = clamp(hudMessageT, 0, 1);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(hudMessage, W / 2, H - 130);
      ctx.globalAlpha = 1;
    }
  }

  function drawMinimap() {
    const mw = 180, mh = mw * (MAP_H / MAP_W), pad = 16;
    const ox = W - mw - pad, oy = pad + 40;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ox, oy, mw, mh, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(120,160,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    const sx = mw / MAP_W, sy = mh / MAP_H;
    for (const obj of objectives) {
      ctx.beginPath(); ctx.arc(ox + obj.x * sx, oy + obj.y * sy, 4, 0, Math.PI * 2);
      ctx.fillStyle = obj.owner >= 0 ? TEAM_COLORS[obj.owner] : '#8ea0c9'; ctx.fill();
    }
    for (const a of agents) {
      if (!a.alive) continue;
      ctx.beginPath(); ctx.arc(ox + a.x * sx, oy + a.y * sy, a.isPlayer ? 3 : 2, 0, Math.PI * 2);
      ctx.fillStyle = a.isPlayer ? '#fff' : TEAM_COLORS[a.team]; ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------- canvas helpers ---------------- */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ---------------- loop ---------------- */
  function loop(now) {
    if (!running) { render(); return; }   // draw final frame under results
    if (paused) return;
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    dt = Math.min(dt, 0.05);
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  return { start };
})();
