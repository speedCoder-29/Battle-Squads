/* ============================================================
   game.js — the actual 2D top-down team shooter.
   Two modes:
     • domination  — capture & hold objectives, first to score cap
     • elimination — last squad standing, no respawns
   Single-player vs bots (real multiplayer needs a server — see README).
   ============================================================ */
const Game = (() => {
  // domination is fought over a much bigger board than the elimination arena
  const MAP_SIZES = { domination: { w: 6400, h: 4300 }, elimination: { w: 4400, h: 3000 } };
  let MAP_W = MAP_SIZES.domination.w, MAP_H = MAP_SIZES.domination.h;
  const SCORE_CAP = 1000;             // domination win score
  const MATCH_SECONDS = 8 * 60;      // time limit
  const TEAM_COLORS = ['#3d7bff', '#ff4b5c', '#4be08a', '#c46bff', '#ffa726', '#35e0ff'];
  const TEAM_NAMES  = ['Blue', 'Red', 'Green', 'Violet', 'Amber', 'Cyan'];
  // squad setup per mode
  const TEAM_SETUP = { domination: { teams: 4, perTeam: 4 }, elimination: { teams: 6, perTeam: 4 } };
  let nTeams = 4;
  let botLevel = BotAI.DEFAULT;      // 1-10 bot difficulty — see js/botai.js

  let canvas, ctx, W, H;
  let mode = 'domination';
  let running = false, paused = false;
  let lastTime = 0;
  let camX = 0, camY = 0;
  let timeLeft = MATCH_SECONDS;

  let agents = [], bullets = [], obstacles = [], objectives = [], fx = [], dmgNums = [];
  let grenades = [], deployables = [], smokes = [], crates = [], drops = [], airstrikes = [];
  let grass = [], trenches = [], decor = [];                       // terrain + dressing
  let terrain = null;                                              // island: ocean/beach/grass/river/roads
  let flashOverlay = 0;                                            // player blind timer (s)
  let zoom = 1, zoomTarget = 1;                                    // binoculars pull the camera back
  let teamScores = [];
  let player = null;
  let matchStats = { kills: 0, captures: 0 };
  const TILE = 50;

  /* Every wall on the map is a Structures.seg — see js/structures.js for the
     wall-type table (height, HP, toughness, ballistics). */
  const kindOf = (s) => Structures.def(s.type);
  const isSolid = (s) => Structures.blocksMove(s);

  const input = { up: false, down: false, left: false, right: false, shooting: false, fireEdge: false, ads: false, mx: 0, my: 0, dashCd: 0 };

  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- setup ---------------- */
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  /* Where the domination objectives sit. Needed before the map is built so the
     generator can keep those approaches clear, and again when teams are set up. */
  function objectiveAnchors() {
    return [
      { name: 'A', x: MAP_W * 0.24, y: MAP_H * 0.70, r: 165 },
      { name: 'B', x: MAP_W * 0.50, y: MAP_H * 0.44, r: 175 },
      { name: 'C', x: MAP_W * 0.77, y: MAP_H * 0.30, r: 165 },
    ];
  }
  let objectiveSpotsCache = [];
  const objectiveSpots = () => objectiveSpotsCache;

  /* Objectives are positioned *after* the map exists, by walking out from each
     anchor until the disc is clear of walls and out of the water. Reserving
     ground up front and filtering afterwards meant every new placer had to
     remember the rule; this way an objective simply cannot be inside a wall. */
  function placeObjectives() {
    const clearAt = (x, y, r) => {
      if (!Terrain.isSpawnable(terrain, x, y)) return false;
      if (x < r + 60 || y < r + 60 || x > MAP_W - r - 60 || y > MAP_H - r - 60) return false;
      const disc = { x: x - r, y: y - r, w: r * 2, h: r * 2 };
      return !structureRects().some(o => padOverlap(disc, o, 0));
    };
    objectiveSpotsCache = objectiveAnchors().map(a => {
      if (clearAt(a.x, a.y, a.r)) return a;
      // spiral outward from the anchor for the nearest spot that works
      for (let ring = 1; ring <= 40; ring++) {
        for (let k = 0; k < 16; k++) {
          const ang = (k / 16) * Math.PI * 2 + ring * 0.3;
          const d = ring * 90;
          const x = a.x + Math.cos(ang) * d, y = a.y + Math.sin(ang) * d;
          if (clearAt(x, y, a.r)) return { ...a, x, y };
        }
      }
      return a;                                  // map is impossibly dense; fall back
    });
    return objectiveSpotsCache;
  }

  /* How much of everything a map gets, per million pixels of playable ground.
     Everything scales from the board size, so making the map bigger fills it
     instead of stretching it thin. */
  const DENSITY = {
    buildings: 3.2,
    cover: 11.0,
    crates: 4.2,
    props: 120,
    grassPatches: 2.4,
  };
  /* the buildings that can be rolled, and how common each is */
  const BUILDING_MIX = [
    ['house', 16], ['shanty', 12], ['camp', 10], ['checkpoint', 10],
    ['farm', 9], ['tower', 9], ['apartments', 7], ['warehouse', 7],
    ['depot', 7], ['bunker', 6], ['mansion', 5], ['hangar', 4], ['base', 4],
  ];
  const COVER_MIX = [
    ['sandbag', 26], ['barricade', 22], ['wire', 20], ['wood', 16], ['metal', 10], ['rwall', 6],
  ];

  function buildMap() {
    obstacles = []; trenches = []; decor = []; grass = [];
    invalidateRects();
    terrain = Terrain.generate(MAP_W, MAP_H, mode === 'domination' ? 20260730 : 90210);

    // playable ground is the grass interior, not the whole rectangle
    const playW = MAP_W - Terrain.BEACH_INSET * 2;
    const playH = MAP_H - Terrain.BEACH_INSET * 2;
    const area = (playW * playH) / 1e6;                  // in millions of px

    placeBuildingsProcedural(Math.round(area * DENSITY.buildings));
    placeCover(Math.round(area * DENSITY.cover));
    placeGrass(Math.round(area * DENSITY.grassPatches));
    placeProps(Math.round(area * DENSITY.props));

    // Loose cover isn't part of a building, so a piece that landed somewhere it
    // shouldn't can just be dropped — buildings go through placeBuilding() and
    // stay whole. Two things disqualify a loose piece: standing in water, or
    // sitting on an objective. The placers already reject both, but this is the
    // backstop that makes it true by construction rather than by argument.
    // loose cover that landed in the water can just be dropped; buildings go
    // through placeBuilding() and are already verified whole
    obstacles = obstacles.filter(o =>
      o.building || Terrain.isSpawnable(terrain, o.x + o.w / 2, o.y + o.h / 2));
    invalidateRects();

    // now that the walls exist, put the objectives somewhere clear
    placeObjectives();
  }

  /* pick from a [name, weight] list */
  function rollMix(mix) {
    const total = mix.reduce((n, m) => n + m[1], 0);
    let r = Math.random() * total;
    for (const m of mix) { if ((r -= m[1]) <= 0) return m[0]; }
    return mix[0][0];
  }
  const boundsOf = (parts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const padOverlap = (a, b, pad) =>
    a.x - pad < b.x + b.w && a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;

  /* Place a building only where the terrain allows it, and keep it whole.
     Filtering segment-by-segment would carve holes in anything straddling the
     river, so a placement either lands entirely or is rejected. */
  function placeBuilding(name, x, y) {
    const parts = Structures.place(name, x, y);
    if (!parts.length) return [];
    const bb = boundsOf(parts);
    if (bb.x < 40 || bb.y < 40 || bb.x + bb.w > MAP_W - 40 || bb.y + bb.h > MAP_H - 40) return [];
    // Check every segment, not just the bounding box: a river bending through
    // the middle of a large building passes between the corners unnoticed, and
    // half a warehouse standing in the water is worse than not placing it.
    for (const s of parts) {
      if (!Terrain.isBuildable(terrain, s.x + s.w / 2, s.y + s.h / 2, 8)) return [];
      if (!Terrain.isBuildable(terrain, s.x, s.y, 4)) return [];
      if (!Terrain.isBuildable(terrain, s.x + s.w, s.y + s.h, 4)) return [];
    }
    return parts;
  }

  /* Scatter buildings across the island: valid terrain, clear of each other,
     clear of the objectives, and never sliced by the river. */
  function placeBuildingsProcedural(count) {
    const placed = [];
    const seen = {};
    let guard = count * 60;
    while (placed.length < count && guard-- > 0) {
      // Early on, favour a type that hasn't appeared yet. Pure weighted rolling
      // leaves a small map with only three or four kinds on it; this guarantees
      // variety without flattening the weights once every type is represented.
      const missing = BUILDING_MIX.filter(m => !seen[m[0]]);
      const name = (missing.length && placed.length < count * 0.7)
        ? missing[Math.floor(Math.random() * missing.length)][0]
        : rollMix(BUILDING_MIX);
      const x = rand(Terrain.BEACH_INSET, MAP_W - Terrain.BEACH_INSET);
      const y = rand(Terrain.BEACH_INSET, MAP_H - Terrain.BEACH_INSET);
      const parts = placeBuilding(name, x, y);
      if (!parts.length) continue;
      const bb = boundsOf(parts);
      if (placed.some(b => padOverlap(bb, b, 130))) continue;          // breathing room
      placed.push(bb);
      seen[name] = (seen[name] || 0) + 1;
      const pid = 'p' + placed.length;
      for (const part of parts) part.placement = pid;
      obstacles.push(...parts);
    }
  }

  /* loose walls, sandbag lines and wire in the gaps between buildings */
  function placeCover(count) {
    let guard = count * 40;
    let made = 0;
    while (made < count && guard-- > 0) {
      const type = rollMix(COVER_MIX);
      const x = rand(Terrain.BEACH_INSET, MAP_W - Terrain.BEACH_INSET);
      const y = rand(Terrain.BEACH_INSET, MAP_H - Terrain.BEACH_INSET);
      if (!Terrain.isSpawnable(terrain, x, y)) continue;
      const len = 3 + Math.random() * 6;
      const axis = Math.random() < 0.5 ? 'h' : 'v';
      const th = type === 'metal' ? 0.6 : type === 'wire' ? 0.4 : type === 'sandbag' ? 0.5 : 0.3;
      const seg = Structures.seg(type, x, y, len, axis, th);
      // A run is up to 9m long, so test the whole rect, not the origin: it can
      // otherwise reach off the map edge or into an objective from a valid start.
      if (seg.x < 20 || seg.y < 20 || seg.x + seg.w > MAP_W - 20 || seg.y + seg.h > MAP_H - 20) continue;
      if (!Terrain.isSpawnable(terrain, seg.x + seg.w / 2, seg.y + seg.h / 2)) continue;
      // don't drop a wall on top of a building
      if (structureRects().some(o => padOverlap(seg, o, 24))) continue;
      obstacles.push(seg);
      invalidateRects();
      made++;
    }
  }

  /* grass the ghillie suit hides in */
  function placeGrass(count) {
    for (let i = 0; i < count; i++) {
      const w = 240 + Math.random() * 240, h = 200 + Math.random() * 220;
      const x = rand(Terrain.BEACH_INSET, MAP_W - Terrain.BEACH_INSET - w);
      const y = rand(Terrain.BEACH_INSET, MAP_H - Terrain.BEACH_INSET - h);
      if (!Terrain.isSpawnable(terrain, x + w / 2, y + h / 2)) continue;
      grass.push({ x, y, w, h });
    }
  }

  /* dressing: woodland inland, driftwood and palms along the sand */
  function placeProps(count) {
    const inland = ['tree', 'tree', 'bush', 'bush', 'rock', 'stump',
                    'crate', 'barrel', 'pallet', 'tyre', 'rubble', 'sign', 'cone',
                    'container', 'antenna', 'tent', 'sandpile'];
    for (let i = 0; i < count; i++) {
      const kind = inland[Math.floor(Math.random() * inland.length)];
      decor.push({
        kind,
        x: rand(Terrain.BEACH_INSET - 40, MAP_W - Terrain.BEACH_INSET + 40),
        y: rand(Terrain.BEACH_INSET - 40, MAP_H - Terrain.BEACH_INSET + 40),
        rot: Math.random() * Math.PI * 2,
        scale: 0.75 + Math.random() * 0.5,
      });
    }
    decor.push(...beachDecor());
    // keep props on the board and out of walls, water and the road
    const edge = 30;
    decor = decor
      .map(d => ({ ...d, x: clamp(d.x, edge, MAP_W - edge), y: clamp(d.y, edge, MAP_H - edge) }))
      .filter(d => Sprites.has(d.kind))
      .filter(d => !pointInObstacle(d.x, d.y))
      .filter(d => Terrain.isSpawnable(terrain, d.x, d.y))
      .filter(d => !Terrain.onRoad(terrain, d.x, d.y));
  }

  /* palms and driftwood along the sand ring */
  function beachDecor() {
    const out = [];
    const band = (Terrain.BEACH_INSET + Terrain.OCEAN_INSET) / 2;
    const kinds = ['palm', 'rock', 'stump', 'crate'];
    for (let i = 0; i < 90; i++) {
      const k = kinds[Math.floor(Math.random() * kinds.length)];
      const side = Math.floor(Math.random() * 4);
      const along = rand(band, (side % 2 ? MAP_H : MAP_W) - band);
      const off = rand(Terrain.OCEAN_INSET + 30, Terrain.BEACH_INSET - 30);
      const p = side === 0 ? { x: along, y: off }
        : side === 1 ? { x: MAP_W - off, y: along }
        : side === 2 ? { x: along, y: MAP_H - off }
        : { x: off, y: along };
      out.push({ kind: k, x: p.x, y: p.y, rot: Math.random() * Math.PI * 2, scale: 0.8 + Math.random() * 0.4 });
    }
    return out;
  }
  const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const onGrass = (a) => grass.some(g => inRect(a.x, a.y, g));
  const inTrench = (a) => trenches.some(t => dist2(a.x, a.y, t.x, t.y) < t.r * t.r);

  /* Spread the squads evenly around the edge of the map, whatever the team count. */
  function spawnPoint(team) {
    const cx = MAP_W / 2, cy = MAP_H / 2;
    const rx = MAP_W / 2 - 240, ry = MAP_H / 2 - 240;
    const ang = -Math.PI / 2 + (team / Math.max(1, nTeams)) * Math.PI * 2;
    return { x: cx + Math.cos(ang) * rx + rand(-70, 70), y: cy + Math.sin(ang) * ry + rand(-70, 70) };
  }

  function makeAgent(team, isPlayer, weaponId) {
    const base = Weapons.byId[weaponId] || Weapons.byId[Weapons.default];
    // the player's saved attachments / ammo / skin are baked in at spawn
    const profile = isPlayer ? DB.getProfile() : null;
    const w = isPlayer && profile
      ? Weapons.configure(base, { attachments: profile.attachments[base.id], ammo: profile.ammo[base.id] })
      : base;
    const skin = Skins.get(profile ? Skins.equipped(profile, base.id) : 'default');
    const cls = Classes.forWeapon(w);      // your gun decides your class
    return {
      team, isPlayer, alive: true,
      x: 0, y: 0, r: 16, angle: 0,
      klass: 'infantry',                                    // see Combat.TARGETS
      hp: Combat.maxHpFor('infantry'), maxHp: Combat.maxHpFor('infantry'),
      vest: 0, helmet: 0,                                   // armour tiers 0-3
      weaponId: w.id, weapon: w,
      cls, tool: cls.tool, skin,                            // class kit + weapon skin
      diff: BotAI.individual(botLevel),                     // aim / survival / teamwork
      vx: 0, vy: 0, contactT: 0, healCd: 0,
      toolCd: 0, toolActive: false, swingT: 0, builds: 0, stillT: 0,
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

    const setup = TEAM_SETUP[mode];
    nTeams = setup.teams;

    if (mode === 'domination') {
      teamScores = new Array(nTeams).fill(0);
      for (let t = 0; t < nTeams; t++) {
        for (let i = 0; i < setup.perTeam; i++) {
          const isPlayer = (t === 0 && i === 0);
          const a = makeAgent(t, isPlayer, isPlayer ? playerWeapon : pickBotWeapon());
          respawnAgent(a, true);
          if (isPlayer) player = a;
          agents.push(a);
        }
      }
      // objectives sit in the open ground the map generator kept clear
      objectives = objectiveSpots().map(o =>
        ({ ...o, owner: -1, progress: 0, capTeam: -1 }));
    } else {
      teamScores = new Array(nTeams).fill(0);
      for (let t = 0; t < nTeams; t++) {
        for (let i = 0; i < setup.perTeam; i++) {
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
    // re-roll the drop point a few times rather than landing inside a building
    let sp = spawnPoint(a.team);
    for (let i = 0; i < 12 && pointInObstacle(sp.x, sp.y); i++) sp = spawnPoint(a.team);
    a.x = sp.x; a.y = sp.y;
    a.hp = a.maxHp; a.alive = true;
    a.ammo = a.weapon.mag; a.reloadTimer = 0; a.fireCd = 0;
    a.bloom = 0; a.burstLeft = 0; a.burstCd = 0; a.postBurstCd = 0;
    a.toolCd = 0; a.toolActive = false; a.swingT = 0;
    a.respawnTimer = 0;
    resolveObstacles(a);        // never spawn stuck inside a building
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

    MAP_W = MAP_SIZES[mode].w; MAP_H = MAP_SIZES[mode].h;
    botLevel = DB.getSettings().botLevel || BotAI.DEFAULT;
    squadIntel = [];
    buildMap();
    setupTeams();
    bullets = []; fx = []; dmgNums = [];
    grenades = []; deployables = []; smokes = []; drops = []; airstrikes = []; flashOverlay = 0;
    zoom = zoomTarget = 1;
    hudMessage = ''; hudMessageT = 0;
    spawnCrates(Math.round(((MAP_W - Terrain.BEACH_INSET * 2) * (MAP_H - Terrain.BEACH_INSET * 2) / 1e6) * DENSITY.crates));
    // starting tactical kit = whatever your class deploys with
    player.inv = {
      grenade:  { id: null, n: 0 },
      tactical: { id: null, n: 0 },
      heal:     { id: null, n: 0 },
      tokens: [],
    };
    const kit = Items.CONSUMABLES[player.cls.consumable];
    if (kit) player.inv[kit.cat] = { id: player.cls.consumable, n: Classes.startFor(player.cls) };
    // everyone also deploys with a couple of bandages so you're never stranded
    if (kit && kit.cat !== 'heal') player.inv.heal = { id: 'bandage', n: 2 };
    player.baseWeapon = player.weapon;   // remember base so a looted legendary can revert
    timeLeft = MATCH_SECONDS;
    matchStats = { kills: 0, captures: 0 };
    paused = false; running = true;

    document.getElementById('hud-gamemode').textContent = mode === 'domination' ? 'DOMINATION' : 'ELIMINATION';
    document.getElementById('game-pause').classList.remove('is-open');
    document.getElementById('game-results').classList.remove('is-open');
    // legend is loud for the first few seconds, then fades back (hover to read)
    const hint = document.getElementById('hud-hint');
    hint.style.display = ''; hint.classList.remove('is-faded');
    setTimeout(() => hint.classList.add('is-faded'), 12000);
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
        case 'KeyV': useTool(); break;
        case 'KeyG': callAirstrike(); break;
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
  const FALLOFF_UNIT = 210, FALLOFF_MIN = 0.4;   // falloff start is per-gun now

  function startReload(a) {
    if (a.reloadTimer > 0 || a.ammo >= a.weapon.mag) return;
    a.reloadTimer = a.weapon.reloadMs / Combat.adrenaline(a.adrenaline).reload;   // Adren%/2 reload speedup
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
    // moving widens the cone by the gun's own moveSpread — a MAC-10 sprays at
    // a run, a QBB bullpup barely notices. ADS steadies both.
    const speed = Math.hypot(a.vx || 0, a.vy || 0);
    const moving = clamp(speed / 200, 0, 1);
    const cone = w.spreadBase * (ads ? w.adsMult : 1)
      + (w.moveSpread || 0) * moving * (ads ? 0.45 : 1)
      + a.bloom;
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const jitter = (Math.random() - 0.5) * cone * 2 + (Math.random() - 0.5) * w.pelletSpread * 2;
      const ang = a.angle + jitter;
      bullets.push({
        x: a.x + Math.cos(ang) * (a.r + 4),
        y: a.y + Math.sin(ang) * (a.r + 4),
        vx: Math.cos(ang) * w.bulletSpeed, vy: Math.sin(ang) * w.bulletSpeed,
        sx: a.x, sy: a.y,
        team: a.team, dmg: w.damage, falloff: w.falloff, range: w.range,
        splash: w.splashRadius, splashR: w.splashRadius,
        dmgType: w.dmgType, pen: w.penetration || 0,
        // a round dies at its gun's effective range, not on a shared timer
        life: Math.min(2.4, (w.range * 1.15) / w.bulletSpeed),
        owner: a, color: (a.skin && a.skin.tracer) || w.ammoColor,
        tracer: !!w.tracer,
      });
    }
    a.bloom = Math.min(w.bloomMax, a.bloom + w.recoilKick);
    spawnFx(a.x + Math.cos(a.angle) * a.r, a.y + Math.sin(a.angle) * a.r, '#ffd36a', pellets > 1 ? 5 : 3);
    // a suppressor really does keep you quiet: bots only "hear" loud shots
    if (!w.audio || w.audio > 0.5) alertNearbyBots(a);
    if (a.isPlayer) { SFX.shoot(); if (a.ammo === 0) startReload(a); updateWeaponHud(); }
  }

  /* Gunfire is a giveaway: bots within earshot of an unsuppressed shot look
     your way. A Suppressor drops the report below that threshold entirely. */
  function alertNearbyBots(shooter) {
    const earshot = 700 * 700;
    for (const o of agents) {
      if (!o.alive || o.isPlayer || o.team === shooter.team || o.isVehicle) continue;
      if (dist2(o.x, o.y, shooter.x, shooter.y) > earshot) continue;
      o.aiTargetPt = { x: shooter.x + rand(-60, 60), y: shooter.y + rand(-60, 60) };
      o.aiRepath = rand(1.5, 3);
    }
  }

  /* Explosion from launcher rounds — AoE damage that falls off with distance. */
  function explode(x, y, baseDmg, radius, team, owner, type = 'explosive') {
    spawnFx(x, y, '#ff9d3b', 22);
    for (const a of agents) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < radius) {
        const dmg = baseDmg * (1 - d / radius) * (a.team === team ? 0.5 : 1);
        // blasts always count as body hits — no lucky head/limb rolls from splash
        if (dmg > 1) applyDamage(a, dmg, owner, type, 'body');
      }
    }
    // blasts tear up cover and sentries too — that's how you make an entry point
    const src = { kind: type === 'heat' ? 'heat' : 'explosive' };
    for (const s of structureRects().slice()) {
      const cx = clamp(x, s.x, s.x + s.w), cy = clamp(y, s.y, s.y + s.h);
      const d = Math.hypot(cx - x, cy - y);
      if (d < radius && Combat.canDamageStructure(s, src)) damageStructure(s, baseDmg * (1 - d / radius) * 1.5, cx, cy);
    }
    for (let i = deployables.length - 1; i >= 0; i--) {
      const dp = deployables[i];
      if (dp.type !== 'sentry') continue;
      const d = Math.hypot(dp.x - x, dp.y - y);
      if (d < radius) { dp.hp -= baseDmg * (1 - d / radius); if (dp.hp <= 0) { spawnFx(dp.x, dp.y, '#ff9d3b', 12); deployables.splice(i, 1); } }
    }
  }

  /* ================= CONSUMABLES / TACTICAL LAYER ================= */
  let hudMessage = '', hudMessageT = 0;
  function hudMsg(t) { hudMessage = t; hudMessageT = 2; }
  const worldMouse = () => ({ x: input.mx / zoom + camX, y: input.my / zoom + camY });
  const near2 = (a, b, r) => dist2(a.x, a.y, b.x, b.y) < r * r;

  /* Add to a slot. Nothing is ever silently destroyed: if the slot already
     holds something else, that stack is dropped at your feet, and anything
     over the carry limit drops too. Walk over a drop and press E to take it. */
  function addItem(cat, id, n, at) {
    const slot = player.inv[cat];
    if (!slot) return 0;
    const cap = Classes.limitFor(player.cls, id);
    const where = at || player;

    // a different item in this slot? put the old one on the ground, don't bin it
    if (slot.id && slot.id !== id && slot.n > 0) {
      dropItem(cat, slot.id, slot.n, where);
      slot.n = 0;
    }
    slot.id = id;
    const room = Math.max(0, cap - (slot.n || 0));
    const taken = Math.min(room, n);
    slot.n = (slot.n || 0) + taken;
    const overflow = n - taken;
    if (overflow > 0) dropItem(cat, id, overflow, where);     // full — the rest hits the floor
    return overflow;
  }

  /* ---------------- ground drops ---------------- */
  function dropItem(cat, id, n, at) {
    if (!id || n <= 0) return;
    const a = Math.random() * Math.PI * 2, d = rand(18, 40);
    const x = clamp((at.x || 0) + Math.cos(a) * d, 20, MAP_W - 20);
    const y = clamp((at.y || 0) + Math.sin(a) * d, 20, MAP_H - 20);
    // merge into a nearby identical pile rather than littering. The radius has
    // to comfortably exceed the scatter above, or two drops from the same spot
    // can land far enough apart to stay separate.
    for (const dr of drops) {
      if (dr.id === id && dist2(dr.x, dr.y, x, y) < 100 * 100) { dr.n += n; dr.life = DROP_LIFE; return; }
    }
    drops.push({ x, y, cat, id, n, life: DROP_LIFE, bob: Math.random() * Math.PI * 2 });
  }
  const DROP_LIFE = 90;              // seconds a dropped stack survives

  function updateDrops(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.life -= dt; d.bob += dt * 2.5;
      if (d.life <= 0) drops.splice(i, 1);
    }
  }

  /* pick up the nearest drop; returns true if we took something */
  function grabDrop() {
    let best = null, bd = 78 * 78, bi = -1;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      const dd = dist2(player.x, player.y, d.x, d.y);
      if (dd < bd) { bd = dd; best = d; bi = i; }
    }
    if (!best) return false;
    const it = Items.CONSUMABLES[best.id];
    const slot = player.inv[best.cat];
    const cap = Classes.limitFor(player.cls, best.id);
    // already full of this exact item? leave it where it is
    if (slot && slot.id === best.id && slot.n >= cap) { hudMsg(`Can't carry more ${it.name}`); return false; }
    drops.splice(bi, 1);
    const left = addItem(best.cat, best.id, best.n);
    hudMsg(`Picked up ${it.name} ×${best.n - left}`);
    SFX.click();
    return true;
  }
  function equipWeapon(a, w) {
    a.weapon = w; a.weaponId = w.id; a.ammo = w.mag;
    a.reloadTimer = 0; a.burstLeft = 0; a.postBurstCd = 0;
    if (a.isPlayer) updateWeaponHud();
  }

  /* ================= CLASS TOOLS ([V]) ================= */
  /* Gadget tools (binoculars, goggles, ghillie) toggle; the rest swing. */
  function useTool() {
    if (!canAct()) return;
    const t = player.tool;
    if (t.passive) {
      player.toolActive = !player.toolActive;
      // gadgets aren't just a toggle: switching one on sweeps for contacts and
      // marks what it finds for the whole squad
      if (player.toolActive) markContacts(player);
      hudMsg(t.name + (player.toolActive ? ' — ON' : ' — off'));
      SFX.click();
      return;
    }
    if (player.toolCd > 0) return;
    swingTool(player);
  }

  /* Each vision gadget spots at a different range and through different things,
     and every spot is shared with the squad for a few seconds. */
  function markContacts(a) {
    const t = a.tool;
    const range = t.heat ? t.heat : t.zoom ? 1500 : t.nightFov ? 620 * (1 + t.nightFov) : 0;
    if (!range) return;
    let found = 0;
    for (const o of agents) {
      if (!o.alive || o.team === a.team) continue;
      if (dist2(o.x, o.y, a.x, a.y) > range * range) continue;
      // heat sees through walls; the others need line of sight
      if (!t.heat && !hasLOS(a.x, a.y, o.x, o.y)) continue;
      o.markedUntil = Math.max(o.markedUntil || 0, 6);
      found++;
    }
    if (a.isPlayer) hudMsg(found ? `${found} contact${found > 1 ? 's' : ''} marked for the squad` : 'No contacts');
  }

  /* Flare Launcher: one airstrike per match, called in on your cursor. */
  function callAirstrike() {
    if (!canAct()) return false;
    if (!player.weapon.airstrike) return false;
    if (player.airstrikeUsed) { hudMsg('Flare already spent'); return true; }
    player.airstrikeUsed = true;
    const p = worldMouse();
    airstrikes.push({ x: p.x, y: p.y, team: player.team, owner: player, delay: 3.5, hits: 6 });
    hudMsg('Flare away — airstrike inbound');
    SFX.win();
    return true;
  }
  function updateAirstrikes(dt) {
    for (let i = airstrikes.length - 1; i >= 0; i--) {
      const s = airstrikes[i];
      s.delay -= dt;
      if (s.delay > 0) continue;
      // walk a line of blasts across the marked point
      const a = Math.random() * Math.PI * 2;
      const off = rand(0, 150);
      explode(s.x + Math.cos(a) * off, s.y + Math.sin(a) * off, 90, 150, s.team, s.owner, 'explosive');
      if (--s.hits <= 0) airstrikes.splice(i, 1);
      else s.delay = 0.35;
    }
  }

  /* One swing: hits enemies in a forward arc, then chews structures. */
  function swingTool(a) {
    const t = a.tool;
    const reach = t.range + a.r;
    a.swingT = 0.18;

    // defibrillator — instant revive instead of a melee hit
    if (t.revive) {
      const mate = agents.find(o => !o.alive && !o.isVehicle && o.team === a.team && near2(o, a, reach + o.r));
      if (!mate) { a.toolCd = 1.5; if (a.isPlayer) hudMsg('No downed teammate in reach'); return; }
      a.toolCd = t.cooldown;
      mate.alive = true; mate.hp = mate.maxHp; mate.ammo = mate.weapon.mag; mate.respawnTimer = 0;
      mate.x = a.x + rand(-26, 26); mate.y = a.y + rand(-26, 26);
      spawnFx(mate.x, mate.y, '#4be08a', 16);
      if (a.isPlayer) { hudMsg('Revived ' + mate.name); SFX.reward(); }
      return;
    }

    a.toolCd = t.cooldown;
    if (a.isPlayer) SFX.click();

    // enemies in a ~100° arc in front
    let hitSomething = false;
    for (const o of agents) {
      if (!o.alive || o.team === a.team) continue;
      const d = Math.hypot(o.x - a.x, o.y - a.y);
      if (d > reach + o.r) continue;
      if (Math.abs(angleDiff(Math.atan2(o.y - a.y, o.x - a.x), a.angle)) > 0.9) continue;
      applyDamage(o, t.melee, a);
      spawnFx(o.x, o.y, '#ffffff', 6);
      hitSomething = true;
    }
    // walls straight ahead (pierce = the toughest wall this tool can work)
    if (t.structure > 0) {
      const r = hitStructures(a, t, reach);
      if (r.hit > 0 || r.blocked) hitSomething = true;
    }

    // hammer builds and spade digs only when the swing hit nothing
    if (!hitSomething && t.builds) buildWall(a);
    else if (!hitSomething && t.digs) digTrench(a);
  }

  const angleDiff = (x, y) => Math.atan2(Math.sin(x - y), Math.cos(x - y));

  /* Every damageable rect on the map: map cover + deployed/built walls.
     A map full of buildings is a few hundred segments and these lists are hit
     per bullet and per bot, so they're rebuilt once per frame, not per call. */
  let rectCache = null, solidCache = null, sightCache = null;
  let solidGrid = null, sightGrid = null, bulletGrid = null;
  const invalidateRects = () => { rectCache = solidCache = sightCache = solidGrid = sightGrid = bulletGrid = null; };

  /* ---------------- spatial index ----------------
     A map is 300+ wall segments now, and line of sight samples 16 points per
     check, per bot, per frame. Scanning every rect each time was the single
     hottest thing in the frame, so rects are bucketed into a coarse grid and
     each query only looks at the cells it actually touches. */
  const CELL = 220;
  function buildGrid(rects) {
    const g = { cols: Math.ceil(MAP_W / CELL) + 1, rows: Math.ceil(MAP_H / CELL) + 1, cells: new Map() };
    for (const s of rects) {
      const x0 = Math.max(0, Math.floor(s.x / CELL)), x1 = Math.floor((s.x + s.w) / CELL);
      const y0 = Math.max(0, Math.floor(s.y / CELL)), y1 = Math.floor((s.y + s.h) / CELL);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const k = cy * g.cols + cx;
          let arr = g.cells.get(k);
          if (!arr) { arr = []; g.cells.set(k, arr); }
          arr.push(s);
        }
      }
    }
    return g;
  }
  const gridAt = (g, x, y) => g.cells.get(Math.floor(y / CELL) * g.cols + Math.floor(x / CELL));
  const solidIndex = () => (solidGrid || (solidGrid = buildGrid(solidRects())));
  const sightIndex = () => (sightGrid || (sightGrid = buildGrid(sightRects())));
  // bullets care about every wall that isn't underground or an open door
  const bulletIndex = () => (bulletGrid || (bulletGrid = buildGrid(structureRects())));
  /* every rect in the cells a circle overlaps */
  function nearRects(g, x, y, r) {
    const out = [];
    const x0 = Math.max(0, Math.floor((x - r) / CELL)), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.max(0, Math.floor((y - r) / CELL)), y1 = Math.floor((y + r) / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = g.cells.get(cy * g.cols + cx);
        if (arr) for (const s of arr) if (!out.includes(s)) out.push(s);
      }
    }
    return out;
  }
  function structureRects() {
    if (!rectCache) {
      rectCache = obstacles.slice();
      for (const dp of deployables) if (dp.type === 'wall') rectCache.push(dp.rect);
    }
    return rectCache;
  }
  /* A tool can only work a wall its Structure Pierce out-rates, unless it has
     an explicit clearing effect for that type (bayonet→wire, spade→sandbags). */
  const canBreach = (t, s) => Combat.canDamageStructure(s, { kind: 'melee', pierce: t.pierce, clears: t.clears });
  function toolStructureDamage(t, s) {
    if (t.clears === s.type) return s.maxHp;             // clearing tools cut straight through
    return t.structure * ((t.vs && t.vs[s.type]) || 1);
  }
  function hitStructures(a, t, reach) {
    const rects = structureRects();
    const seen = [];
    let tooTough = null;
    for (let d = a.r; d <= reach; d += 8) {
      const x = a.x + Math.cos(a.angle) * d, y = a.y + Math.sin(a.angle) * d;
      const s = rects.find(r => inRect(x, y, r));
      if (!s || seen.includes(s) || s === tooTough) continue;
      if (!canBreach(t, s)) { tooTough = s; continue; }
      seen.push(s);
      damageStructure(s, toolStructureDamage(t, s), x, y);
    }
    if (!seen.length && tooTough && a.isPlayer) {
      hudMsg(`${t.name} can't breach ${kindOf(tooTough).name} (toughness ${tooTough.toughness})`);
    }
    return { hit: seen.length, blocked: !!tooTough };
  }
  function damageStructure(s, dmg, hx, hy) {
    s.hp -= dmg;
    spawnFx(hx === undefined ? s.x + s.w / 2 : hx, hy === undefined ? s.y + s.h / 2 : hy, '#cfd8ee', 5);
    if (s.hp <= 0) destroyStructure(s);
  }
  function destroyStructure(s) {
    spawnFx(s.x + s.w / 2, s.y + s.h / 2, '#8ea0c9', 14);
    invalidateRects();
    if (s.dp) { const i = deployables.indexOf(s.dp); if (i >= 0) deployables.splice(i, 1); return; }
    const i = obstacles.indexOf(s); if (i >= 0) obstacles.splice(i, 1);
  }

  /* Engineer: hammer up a wall section where you're facing. */
  function buildWall(a) {
    const b = a.tool.builds;
    if (a.builds >= b.max) { if (a.isPlayer) hudMsg('Wall limit reached'); return; }
    const ang = a.angle;
    const cx = a.x + Math.cos(ang) * (a.r + 46), cy = a.y + Math.sin(ang) * (a.r + 46);
    // lay the wall across your facing
    const horizontal = Math.abs(Math.cos(ang)) < 0.707;
    const lenM = b.length, rect = horizontal
      ? Structures.seg(b.type, cx - lenM * Structures.PX_PER_M / 2, cy, lenM, 'h', b.thickness)
      : Structures.seg(b.type, cx, cy - lenM * Structures.PX_PER_M / 2, lenM, 'v', b.thickness);
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > MAP_W || rect.y + rect.h > MAP_H) return;
    for (const s of structureRects()) if (rectsOverlap(rect, s)) { if (a.isPlayer) hudMsg('No room to build'); return; }
    const dp = { type: 'wall', built: true, x: cx, y: cy, item: { name: kindOf(rect).name }, life: 9999, rect, owner: a };
    rect.dp = dp;
    deployables.push(dp);
    invalidateRects();
    a.builds++;
    if (a.isPlayer) { hudMsg(kindOf(rect).name + ' wall built'); SFX.capture(); }
  }
  const rectsOverlap = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  /* Gunner: dig in — a trench halves incoming damage while you're in it. */
  function digTrench(a) {
    if (trenches.length > 14) trenches.shift();
    if (trenches.some(t => dist2(t.x, t.y, a.x, a.y) < 40 * 40)) return;
    trenches.push({ x: a.x, y: a.y, r: 48 });
    spawnFx(a.x, a.y, '#b08a5a', 8);
    if (a.isPlayer) hudMsg('Trench dug — take cover');
  }

  /* is this agent hidden by their ghillie suit right now? */
  const camouflaged = (a) => !!(a.toolActive && a.tool.camo && a.stillT > 0.4 && onGrass(a));

  /* --- throw the equipped grenade toward the cursor --- */
  function throwGrenade() {
    if (!canAct()) return;
    const slot = player.inv.grenade;
    if (!slot || !slot.id || slot.n <= 0) { hudMsg('No grenade equipped'); return; }
    const it = Items.CONSUMABLES[slot.id];
    const t = worldMouse();
    let dx = t.x - player.x, dy = t.y - player.y; const d = Math.hypot(dx, dy) || 1;
    // a Grenade Launcher launches them: further, faster, and flat instead of lobbed
    const gl = !!player.weapon.launchGrenades;
    const range = (it.throwRange || 520) * (gl ? 1.9 : 1);
    const dist = Math.min(d, range);
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
      const horizontal = Math.abs(Math.cos(player.angle)) < 0.707;
      const lenM = it.w / Structures.PX_PER_M;
      const rect = horizontal
        ? Structures.seg('barricade', wx - it.w / 2, wy, lenM, 'h', 0.3)
        : Structures.seg('barricade', wx, wy - it.w / 2, lenM, 'v', 0.3);
      const dp = { type: 'wall', x: wx, y: wy, item: it, life: it.life, rect };
      rect.dp = dp; deployables.push(dp); invalidateRects();
    }
    else if (it.mode === 'ammo') deployables.push({ type: 'ammo', x: player.x, y: player.y, team: player.team, item: it, supply: it.supply, life: it.life });
    else if (it.mode === 'flag') deployables.push({ type: 'flag', x: player.x, y: player.y, team: player.team, item: it, life: it.life });
    else if (it.mode === 'sentry') deployables.push({
      type: 'sentry', x: player.x, y: player.y, team: player.team, owner: player, item: it,
      hp: it.hp, maxHp: it.hp, life: it.life, angle: player.angle, cd: 0,
    });
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
    // HP comes from the damage table; what makes a tank tough is that rifle
    // rounds do 0% to it, not a huge health pool
    const conf = vtype === 'tank'
      ? { weapon: 'qlz-87', r: 26, speed: 110 }
      : { weapon: 'm249', r: 22, speed: 175 };
    const v = makeAgent(team, false, conf.weapon);
    const hp = Combat.maxHpFor(vtype);
    v.isVehicle = true; v.vtype = vtype; v.klass = vtype;
    v.maxHp = hp; v.hp = hp; v.r = conf.r; v.vspeed = conf.speed;
    v.name = (vtype === 'tank' ? 'Tank' : 'Jeep');
    v.x = clamp(x, v.r, MAP_W - v.r); v.y = clamp(y, v.r, MAP_H - v.r);
    agents.push(v);
  }

  /* --- doors --- */
  const doorCentre = (d) => ({ x: d.x + d.w / 2, y: d.y + d.h / 2 });
  function nearestDoor(x, y, range) {
    let best = null, bd = range * range;
    for (const s of structureRects()) {
      if (!Structures.isDoor(s)) continue;
      const c = doorCentre(s);
      const d = dist2(x, y, c.x, c.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function toggleDoor(d, who) {
    d.open = !d.open;
    invalidateRects();
    const c = doorCentre(d);
    spawnFx(c.x, c.y, '#e2b46e', 5);
    if (who && who.isPlayer) { hudMsg((d.open ? 'Opened ' : 'Closed ') + kindOf(d).name); SFX.click(); }
  }

  /* --- interact (E): doors, crates, ammo boxes --- */
  function interact() {
    if (!canAct()) return;
    // dropped kit first — it's what you most often want when you press E
    if (grabDrop()) return;
    const door = nearestDoor(player.x, player.y, 70);
    if (door) { toggleDoor(door, player); return; }
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
      while (tries < 40 && (pointInObstacle(x, y) || !Terrain.isSpawnable(terrain, x, y)));
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
      case 'classConsumable': {
        const cid = Items.classConsumableFor(player.cls.name);   // your own kit, topped up
        const it = Items.CONSUMABLES[cid];
        addItem(it.cat, cid, 2);
        hudMsg('Class drop: ' + it.name + ' ×2'); break;
      }
      case 'legendary': {
        const cls = (Weapons.byId[player.baseWeapon.id] || player.weapon).className;
        const gold = Items.makeLegendary(Items.bestOfClass(cls));
        equipWeapon(player, gold); hudMsg('LEGENDARY! ' + gold.name); break;
      }
      case 'armorT1': case 'armorT2': case 'armorT3': {
        const tier = +entry.id.slice(-1);
        // upgrade whichever piece is further behind
        const slot = (player.vest <= player.helmet) ? 'vest' : 'helmet';
        if (player[slot] >= tier) { hudMsg('Already better armored'); break; }
        player[slot] = tier;
        const piece = slot === 'vest' ? Combat.vest(tier) : Combat.helmet(tier);
        hudMsg(`${piece.name} equipped (${Math.round(piece.speed * -100)}% speed)`);
        break;
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
      } else if (dp.type === 'sentry') {
        updateSentry(dp, dt);
      }
    }
  }

  /* Engineer sentry: auto-tracks and fires at the nearest visible enemy. */
  function updateSentry(s, dt) {
    s.cd -= dt;
    let best = null, bd = s.item.range * s.item.range;
    for (const a of agents) {
      if (!a.alive || a.team === s.team || camouflaged(a)) continue;
      const d = dist2(a.x, a.y, s.x, s.y);
      if (d < bd && hasLOS(s.x, s.y, a.x, a.y) && !smokeBlocks(s.x, s.y, a.x, a.y)) { bd = d; best = a; }
    }
    if (!best) return;
    const target = Math.atan2(best.y - s.y, best.x - s.x);
    s.angle += angleDiff(target, s.angle) * Math.min(1, 7 * dt);   // turret traverse
    if (s.cd > 0 || Math.abs(angleDiff(target, s.angle)) > 0.12) return;
    s.cd = 1 / s.item.rof;
    const ang = s.angle + (Math.random() - 0.5) * 0.05;
    bullets.push({
      x: s.x + Math.cos(ang) * 20, y: s.y + Math.sin(ang) * 20,
      vx: Math.cos(ang) * 900, vy: Math.sin(ang) * 900, sx: s.x, sy: s.y,
      team: s.team, dmg: s.item.damage, falloff: 0.04,
      splash: 0, splashR: 0, life: 1.2, owner: s.owner, color: '#35e0ff',
    });
    spawnFx(s.x + Math.cos(ang) * 20, s.y + Math.sin(ang) * 20, '#ffd36a', 2);
  }

  /* barbed wire: slows and cuts anyone standing in it (damage applied in chunks) */
  function wireAt(a, dt) {
    let slow = 1, dps = 0;
    for (const o of obstacles) {
      if (isSolid(o) || !inRect(a.x, a.y, o)) continue;
      const k = kindOf(o);
      slow = Math.min(slow, k.slow); dps += k.dps;
    }
    if (dps > 0) {
      a.wireAcc = (a.wireAcc || 0) + dps * dt;
      // environmental: no hit-zone roll, no armour — the wire just cuts you
      if (a.wireAcc >= 4) { applyDamage(a, a.wireAcc, null, 'true'); a.wireAcc = 0; }
    }
    return slow;
  }
  function updateSmokes(dt) {
    for (let i = smokes.length - 1; i >= 0; i--) { smokes[i].life -= dt; if (smokes[i].life <= 0) smokes.splice(i, 1); }
  }
  const activeWalls = () => deployables.filter(d => d.type === 'wall').map(d => d.rect);
  const solidRects = () => (solidCache || (solidCache = structureRects().filter(Structures.blocksMove)));
  const sightRects = () => (sightCache || (sightCache = structureRects().filter(Structures.blocksSight)));
  function smokeBlocks(x1, y1, x2, y2) {
    if (!smokes.length) return false;
    for (let t = 0.15; t < 1; t += 0.12) {
      const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
      for (const s of smokes) if (dist2(px, py, s.x, s.y) < (s.r * 0.85) ** 2) return true;
    }
    return false;
  }
  // a ghillied target sitting still in grass simply isn't there as far as bots are concerned
  const botCanSee = (a, b) =>
    !camouflaged(b) && hasLOS(a.x, a.y, b.x, b.y) && !smokeBlocks(a.x, a.y, b.x, b.y);

  /* ---------------- collision helpers ---------------- */
  function resolveObstacles(a) {
    a.x = clamp(a.x, a.r, MAP_W - a.r);
    a.y = clamp(a.y, a.r, MAP_H - a.r);
    for (const o of nearRects(solidIndex(), a.x, a.y, a.r + 4)) {
      const cx = clamp(a.x, o.x, o.x + o.w);
      const cy = clamp(a.y, o.y, o.y + o.h);
      const dx = a.x - cx, dy = a.y - cy;
      const d = Math.hypot(dx, dy);
      if (d < a.r && d > 0) {
        a.x = cx + (dx / d) * a.r;
        a.y = cy + (dy / d) * a.r;
      } else if (d === 0) {
        // fully inside the wall (spawned there, or it was built on top of us):
        // shove out through whichever face is closest
        const left = a.x - o.x, right = o.x + o.w - a.x;
        const top = a.y - o.y, bottom = o.y + o.h - a.y;
        const min = Math.min(left, right, top, bottom);
        if (min === left) a.x = o.x - a.r;
        else if (min === right) a.x = o.x + o.w + a.r;
        else if (min === top) a.y = o.y - a.r;
        else a.y = o.y + o.h + a.r;
      }
    }
  }

  function pointInObstacle(x, y) {
    const arr = gridAt(solidIndex(), x, y);
    if (!arr) return false;
    for (const o of arr) if (inRect(x, y, o)) return true;
    return false;
  }

  /* only "high" walls block sight — you can see (and shoot) over sandbags and wire.
     Walks the line and only tests walls in the cell each sample lands in. */
  function hasLOS(ax, ay, bx, by) {
    const g = sightIndex();
    if (!g.cells.size) return true;
    const steps = 16;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const arr = gridAt(g, x, y);
      if (!arr) continue;
      for (const o of arr) if (inRect(x, y, o)) return false;
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

  /* ---------------- squad intel (teamwork trait) ----------------
     High-teamwork bots share contacts and pile onto the same target. */
  let squadIntel = [];                       // one entry per team
  function shareContact(a, enemy) {
    if (!a.diff.teamwork.sharesContacts) return;
    squadIntel[a.team] = { target: enemy, x: enemy.x, y: enemy.y, t: a.diff.teamwork.intelMemory };
  }
  function squadTarget(a) {
    const intel = squadIntel[a.team];
    if (!intel || intel.t <= 0 || !intel.target || !intel.target.alive) return null;
    return intel;
  }
  function updateSquadIntel(dt) {
    for (const s of squadIntel) if (s && s.t > 0) s.t -= dt;
  }
  /* how far the nearest living squadmate is, and which way */
  function nearestMate(a) {
    let best = null, bd = Infinity;
    for (const o of agents) {
      if (o === a || !o.alive || o.team !== a.team || o.isVehicle) continue;
      const d = dist2(a.x, a.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    return { mate: best, d: Math.sqrt(bd) };
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

    // point blank? use the tool — melee beats reloading
    const reach = a.tool.melee > 0 ? a.tool.range + a.r : 0;
    if (enemy && reach > 0 && d < reach + enemy.r && a.toolCd <= 0 && !a.isVehicle) {
      a.angle = Math.atan2(enemy.y - a.y, enemy.x - a.x);
      swingTool(a);
    }

    const D = a.diff, AIM = D.aim, SURV = D.survival, TEAM = D.teamwork;
    const range = botRange(a.weapon);

    // TEAMWORK — prefer whatever the squad is already shooting at
    let target = enemy, td = d;
    if (enemy && Math.random() < TEAM.focusFire * dt * 4) {
      const intel = squadTarget(a);
      if (intel && intel.target !== enemy) {
        const id = Math.hypot(intel.target.x - a.x, intel.target.y - a.y);
        if (id < range * 1.2) { target = intel.target; td = id; }
      }
    }

    const canSee = target && botCanSee(a, target);
    // AIM — reaction time: they must have held the contact before they shoot
    if (canSee) { a.contactT = (a.contactT || 0) + dt; shareContact(a, target); }
    else a.contactT = 0;
    const reacted = a.contactT >= AIM.reaction;

    // SURVIVAL — hurt bots use a heal, then break contact
    const hpFrac = a.hp / a.maxHp;
    if (SURV.usesHeals && hpFrac < SURV.healAt && !a.healCd) {
      a.hp = Math.min(a.maxHp, a.hp + 35); a.healCd = 14;
      spawnFx(a.x, a.y, '#4be08a', 8);
    }
    if (a.healCd > 0) a.healCd -= dt;
    const retreating = hpFrac < SURV.retreatAt;

    if (target && td < range * AIM.rangeDiscipline && canSee) {
      const baseAng = Math.atan2(target.y - a.y, target.x - a.x);
      // SURVIVAL — hold your weapon's preferred distance; back off entirely if hurt
      const ideal = range * SURV.standoff;
      if (retreating) { moveX -= Math.cos(baseAng); moveY -= Math.sin(baseAng); }
      else if (td > ideal + 40) { moveX += Math.cos(baseAng); moveY += Math.sin(baseAng); }
      else if (td < ideal - 40) { moveX -= Math.cos(baseAng); moveY -= Math.sin(baseAng); }
      // SURVIVAL — strafing is a dodge skill
      a.strafeTimer -= dt;
      if (a.strafeTimer <= 0) { a.strafeDir *= -1; a.strafeTimer = rand(0.6, 1.6); }
      moveX += Math.cos(baseAng + Math.PI / 2) * a.strafeDir * SURV.strafe;
      moveY += Math.sin(baseAng + Math.PI / 2) * a.strafeDir * SURV.strafe;

      // AIM — lead a moving target, then swing onto it at your turn rate
      let wantAng = baseAng;
      if (AIM.lead > 0) {
        const flight = td / a.weapon.bulletSpeed;
        const lx = target.x + (target.vx || 0) * flight * AIM.lead;
        const ly = target.y + (target.vy || 0) * flight * AIM.lead;
        wantAng = Math.atan2(ly - a.y, lx - a.x);
      }
      a.aimError = (a.aimError === undefined || Math.random() < dt * 2)
        ? (Math.random() - 0.5) * 2 * AIM.error : a.aimError;
      const goal = wantAng + a.aimError;
      a.angle += angleDiff(goal, a.angle) * Math.min(1, AIM.turnRate * dt);

      // AIM — only fire once aimed in, reacted, and inside your discipline range
      const onTarget = Math.abs(angleDiff(goal, a.angle)) < 0.18;
      if (reacted && onTarget && !retreating && td < range * AIM.rangeDiscipline * 0.95) {
        if (a.weapon.action === 'auto' && Math.random() > AIM.triggerControl) {
          // poor trigger discipline: keep holding it down and eat the bloom
          triggerFire(a);
        } else triggerFire(a);
      }
      // SURVIVAL — reload when you've broken off rather than mid-fight
      if (SURV.reloadsInCover && retreating && a.ammo < a.weapon.mag) startReload(a);
    } else if (a.aiTargetPt) {
      const ang = Math.atan2(a.aiTargetPt.y - a.y, a.aiTargetPt.x - a.x);
      a.angle = ang; moveX += Math.cos(ang); moveY += Math.sin(ang);
      if (dist2(a.x, a.y, a.aiTargetPt.x, a.aiTargetPt.y) < 60 * 60) a.aiTargetPt = null;
    } else if (enemy) {
      // roam toward enemy
      const ang = Math.atan2(enemy.y - a.y, enemy.x - a.x);
      a.angle = ang; moveX += Math.cos(ang); moveY += Math.sin(ang);
    }

    // TEAMWORK — stick with the squad, but not close enough to share a grenade
    if (!a.isVehicle && TEAM.cohesion > 0) {
      const { mate, d: md } = nearestMate(a);
      if (mate) {
        const ang = Math.atan2(mate.y - a.y, mate.x - a.x);
        if (md > TEAM.spacing * 2.5) { moveX += Math.cos(ang) * TEAM.cohesion; moveY += Math.sin(ang) * TEAM.cohesion; }
        else if (md < TEAM.spacing) { moveX -= Math.cos(ang) * TEAM.cohesion; moveY -= Math.sin(ang) * TEAM.cohesion; }
      }
    }

    // shove open any door in the way, and sidestep if a wall has us pinned
    if (!a.isVehicle) {
      const d = nearestDoor(a.x, a.y, 56);
      if (d && !d.open) toggleDoor(d, a);
      if (a.stuckDir) { moveX += Math.cos(a.stuckDir); moveY += Math.sin(a.stuckDir); }
    }

    const m = Math.hypot(moveX, moveY);
    if (m > 0) {
      const base = a.isVehicle ? a.vspeed
        : a.weapon.moveSpeed * 0.72 * a.cls.speed * Combat.armorSpeed(a) * Combat.adrenaline(a.adrenaline).speed;
      const surf = terrain ? Terrain.surfaceAt(terrain, a.x, a.y) : null;
      const spd = base * (a.wireSlow || 1) * (surf ? surf.speed : 1) * dt;
      const px = a.x, py = a.y;
      a.x += (moveX / m) * spd; a.y += (moveY / m) * spd;
      resolveObstacles(a);
      trackStuck(a, px, py, spd, dt);
      // velocity, so bots good enough to lead their shots have something to lead
      a.vx = (a.x - px) / dt; a.vy = (a.y - py) / dt;
    } else { a.vx = 0; a.vy = 0; }
    if (a.ammo <= 0) startReload(a);
  }
  /* Bots walk in straight lines, so a building corner can pin them. If a bot
     barely moves while trying to, give it a sidestep heading for a moment. */
  function trackStuck(a, px, py, spd, dt) {
    const moved = Math.hypot(a.x - px, a.y - py);
    if (a.stuckDir) { a.stuckT -= dt; if (a.stuckT <= 0) a.stuckDir = 0; return; }
    a.stuckAcc = moved < spd * 0.35 ? (a.stuckAcc || 0) + dt : 0;
    if (a.stuckAcc > 0.45) {
      a.stuckDir = a.angle + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
      a.stuckT = 0.9; a.stuckAcc = 0;
    }
  }
  const obj_jitter = (o) => o.x + rand(-o.r * 0.5, o.r * 0.5);
  const obj_jitterY = (o) => o.y + rand(-o.r * 0.5, o.r * 0.5);
  // bots engage inside their own gun's effective range, clamped to something sane
  const botRange = (w) => clamp(w.range * 0.85, 260, 900);

  /* ---------------- update ---------------- */
  function update(dt) {
    invalidateRects();          // walls can be built, blown up or opened any frame
    timeLeft -= dt;
    if (input.dashCd > 0) input.dashCd -= dt;

    // player status timers
    // adrenaline heals — but spends itself doing it, so it only drains while
    // you're actually hurt. At full health it just sits there buffing you.
    for (const a of agents) {
      if (!a.alive || a.isVehicle || !a.adrenaline) continue;
      const adr = Combat.adrenaline(a.adrenaline);
      if (a.hp < a.maxHp) {
        a.hp = Math.min(a.maxHp, a.hp + adr.regen * dt);
        a.adrenaline = Math.max(0, a.adrenaline - 0.375*adr.burn * dt);
        if (a.isPlayer && Math.random() < dt * 3) spawnFx(a.x, a.y, '#4be08a', 1);
      } else {
        a.adrenaline = Math.max(0, a.adrenaline - 0.375 * dt);   // slow idle decay
      }
    }
    if (player.channel) { player.channel.t -= dt; if (player.channel.t <= 0) { player.channel.onDone(); player.channel = null; } }
    if (flashOverlay > 0) flashOverlay -= dt;
    if (hudMessageT > 0) hudMessageT -= dt;

    // player control
    if (player.alive) {
      const tool = player.tool, gadget = player.toolActive;
      let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      const m = Math.hypot(dx, dy);
      // "standing still" powers the ghillie suit
      player.stillT = m > 0 ? 0 : player.stillT + dt;
      if (m > 0) {
        const adr = Combat.adrenaline(player.adrenaline);
        let base = player.weapon.moveSpeed * player.cls.speed;   // class base speed
        base *= Combat.armorSpeed(player);           // vest + helmet weigh you down
        base *= adr.speed;                           // Adren%/2 movement speedup
        if (input.ads) base *= 0.55;                 // aiming slows you
        if (input.ads && player.weapon.scopeMoveMult !== undefined) base *= player.weapon.scopeMoveMult;  // bipod
        if (player.channel) base *= 0.4;             // channeling a heal
        if (gadget && tool.slow) base *= tool.slow;  // binoculars up / shield out
        if (tool.shield && input.ads) base *= tool.slow;
        const surf = terrain ? Terrain.surfaceAt(terrain, player.x, player.y) : null;
        const spd = base * (player.wireSlow || 1) * (surf ? surf.speed : 1) * dt;
        const px = player.x, py = player.y;
        player.x += (dx / m) * spd; player.y += (dy / m) * spd; resolveObstacles(player);
        player.vx = (player.x - px) / dt; player.vy = (player.y - py) / dt;
      } else { player.vx = 0; player.vy = 0; }
      // aim toward cursor (world space, so it survives the binocular zoom)
      const psx = (player.x - camX) * zoom, psy = (player.y - camY) * zoom;
      player.angle = Math.atan2(input.my - psy, input.mx - psx);
      // fire: automatics fire while held; everything else one shot per click.
      // Can't shoot mid-heal, with binoculars up, or off-scope behind a riot shield.
      const blocked = player.channel || (gadget && tool.noFire) || (tool.adsOnlyFire && !input.ads);
      if (!blocked) {
        if (player.weapon.action === 'auto') { if (input.shooting) triggerFire(player); }
        else if (input.fireEdge) { triggerFire(player); }
      } else if (input.fireEdge && tool.adsOnlyFire && !input.ads) {
        hudMsg('Raise the shield (right-click) to shoot');
      }
      input.fireEdge = false;
    } else {
      input.fireEdge = false;
    }

    // camera zoom: binoculars pull back, scoping a long gun pulls out to its
    // scope stat (snipers ~0.16 = a lot of magnification, pistols ~2 = none)
    if (player.alive && player.toolActive && player.tool.zoom) zoomTarget = 1 / player.tool.zoom;
    else if (player.alive && input.ads) zoomTarget = clamp(0.35 + player.weapon.scope * 0.32, 0.4, 1);
    else zoomTarget = 1;
    zoom += (zoomTarget - zoom) * Math.min(1, 9 * dt);

    // agents timers + AI
    for (const a of agents) {
      const ms = dt * 1000;
      if (a.fireCd > 0) a.fireCd -= ms;
      if (a.postBurstCd > 0) a.postBurstCd -= ms;
      if (a.blindTimer > 0) a.blindTimer -= dt;
      if (a.toolCd > 0) a.toolCd -= dt;
      if (a.markedUntil > 0) a.markedUntil -= dt;
      if (a.swingT > 0) a.swingT -= dt;
      if (a.bloom > 0) a.bloom = Math.max(0, a.bloom - a.bloom * 7 * dt);
      a.wireSlow = (a.alive && !a.isVehicle) ? wireAt(a, dt) : 1;
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
      b.px = b.x; b.py = b.y;                  // remembered so ricochets know which face was hit
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0 || b.x < 0 || b.y < 0 || b.x > MAP_W || b.y > MAP_H;
      if (!dead && bulletVsWall(b)) dead = true;
      if (!dead) {
        for (const a of agents) {
          if (!a.alive || a.team === b.team) continue;
          if (dist2(a.x, a.y, b.x, b.y) < a.r * a.r) {
            if (!b.splash) {   // explosives deal their damage via the blast below
              // falloff starts partway into the gun's own effective range
              const travelled = Math.hypot(b.x - b.sx, b.y - b.sy);
              const start = (b.range || FALLOFF_UNIT * 2) * 0.45;
              const steps = Math.max(0, travelled - start) / FALLOFF_UNIT;
              const mult = Math.max(FALLOFF_MIN, 1 - b.falloff * steps);
              applyDamage(a, b.dmg * mult, b.owner, b.dmgType);
              spawnFx(b.x, b.y, TEAM_COLORS[a.team], 4);
            }
            dead = true; break;
          }
        }
      }
      if (!dead) {
        for (let k = deployables.length - 1; k >= 0; k--) {
          const dp = deployables[k];
          if (dp.type !== 'sentry' || dp.team === b.team) continue;
          if (dist2(dp.x, dp.y, b.x, b.y) < 18 * 18) {
            if (!b.splash) { dp.hp -= b.dmg; spawnFx(b.x, b.y, '#35e0ff', 4); }
            if (dp.hp <= 0) { spawnFx(dp.x, dp.y, '#ff9d3b', 12); deployables.splice(k, 1); }
            dead = true; break;
          }
        }
      }
      if (dead) {
        if (b.splash) explode(b.x, b.y, b.dmg, b.splashR, b.team, b.owner, b.dmgType);
        bullets.splice(i, 1);
      }
    }

    // objectives (domination)
    if (mode === 'domination') updateObjectives(dt);

    // tactical layer
    updateSquadIntel(dt);
    updateGrenades(dt);
    updateDrops(dt);
    updateAirstrikes(dt);
    updateDeployables(dt);
    updateSmokes(dt);

    // fx + damage numbers
    for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.x += f.vx * dt; f.y += f.vy * dt; f.life -= dt; if (f.life <= 0) fx.splice(i, 1); }
    for (let i = dmgNums.length - 1; i >= 0; i--) { const d = dmgNums[i]; d.y -= 30 * dt; d.life -= dt; if (d.life <= 0) dmgNums.splice(i, 1); }

    // camera follow (player, or a living teammate if player is down in elimination)
    const focus = player.alive ? player : (agents.find(a => a.alive && a.team === 0) || player);
    const vw = W / zoom, vh = H / zoom;
    camX = clamp(focus.x - vw / 2, 0, Math.max(0, MAP_W - vw));
    camY = clamp(focus.y - vh / 2, 0, Math.max(0, MAP_H - vh));

    checkWinConditions();
    updateHud();
  }

  /* ---------------- bullets vs walls ----------------
     Wall type decides what happens: absorbed, punched through for a slice of
     the damage, or bounced back off at 50%. Returns true if the round dies. */
  function bulletVsWall(b) {
    // only the walls in this bullet's own cell, not all 300 of them
    const arr = gridAt(bulletIndex(), b.x, b.y);
    let wall = null;
    if (arr) {
      for (const s of arr) {
        if (kindOf(s).height === 'under' || s.open) continue;
        if (inRect(b.x, b.y, s)) { wall = s; break; }
      }
    }
    if (!wall) { b.inWall = null; return false; }
    if (b.inWall === wall) return false;        // already resolved on the way in
    b.inWall = wall;

    const bal = Structures.ballistics(wall);
    if (bal.mode === 'through') return false;

    // a round only chews the wall if its damage type out-ranks the toughness
    const src = { kind: b.dmgType === 'heat' ? 'heat' : b.splash ? 'explosive' : 'bullet', ap: b.dmgType === 'ap' };
    if (!b.splash && Combat.canDamageStructure(wall, src)) damageStructure(wall, b.dmg, b.x, b.y);

    if (bal.mode === 'stop') { if (!b.splash) spawnFx(b.x, b.y, '#8ea0c9', 3); return true; }

    if (bal.mode === 'pen') {
      // AP/Slug penetration cuts the damage the wall steals; HP/Birdshot adds to it
      const loss = Math.max(0, Math.min(1, (1 - bal.keep) / (1 + (b.pen || 0))));
      b.dmg *= (1 - loss);
      spawnFx(b.x, b.y, '#cfd8ee', 2);
      return b.dmg < 1;                          // spent rounds stop in the wall
    }

    // ricochet — bounce off whichever face the round actually crossed
    const cameFromSide = b.px === undefined
      ? wall.w < wall.h                                  // no history: use the wall's long axis
      : (b.px < wall.x || b.px > wall.x + wall.w);
    if (cameFromSide) b.vx = -b.vx; else b.vy = -b.vy;
    b.dmg *= bal.keep;
    b.x += b.vx * 0.02; b.y += b.vy * 0.02;      // clear the surface
    b.sx = b.x; b.sy = b.y;                      // falloff restarts from the bounce
    b.inWall = null;
    b.ricochet = true;
    spawnFx(b.x, b.y, '#ffd36a', 5);
    return b.dmg < 1;
  }

  /* Riot shield: while scoping, shots from the front are stopped cold.
     Bots don't get the full 100% — half, or they'd be unkillable head-on. */
  function shieldFactor(a, owner) {
    if (!a.tool || !a.tool.shield || !owner) return 1;
    const scoping = a.isPlayer ? input.ads : true;
    if (!scoping) return 1;
    const fromAng = Math.atan2(owner.y - a.y, owner.x - a.x);
    if (Math.abs(angleDiff(fromAng, a.angle)) > Math.PI / 2) return 1;   // hit from behind
    return a.isPlayer ? 0 : 0.5;
  }

  /* The one place damage is applied. Everything upstream just says how much
     raw damage of what type; combat.js decides what actually lands. */
  function applyDamage(a, dmg, owner, type = 'normal', zone = null) {
    dmg *= shieldFactor(a, owner);
    // dug in: infantry in a trench dodge half of what comes at them
    if (!a.isVehicle && inTrench(a) && Math.random() < Structures.WALL_TYPES.trench.dodge) {
      spawnFx(a.x, a.y, '#b08a5a', 4);
      return;
    }
    // damage type vs target class, hit zone, armour, adrenaline
    const hit = Combat.resolve({ damage: dmg, type, zone }, a);
    dmg = hit.damage;
    if (dmg <= 0) {
      // a round that simply cannot hurt this target (rifle fire on a tank)
      spawnFx(a.x + rand(-a.r, a.r), a.y + rand(-a.r, a.r), '#cfd8ee', 4);
      if (owner && owner.isPlayer) hudMsg(`${Combat.targetOf(a).name} shrugs it off — you need ${a.klass === 'tank' ? 'HEAT' : 'explosives'}`);
      return;
    }
    a.hp -= dmg;
    if (DB.getSettings().dmgNumbers) {
      dmgNums.push({
        x: a.x, y: a.y - a.r, val: Math.round(dmg), life: 0.7,
        crit: hit.zone === 'head', zone: hit.zone,
      });
    }
    if (hit.zone === 'head' && owner && owner.isPlayer) SFX.reward();
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
    ctx.scale(zoom, zoom);          // binoculars pull the whole world back
    ctx.translate(-camX, -camY);

    updateViewBounds();
    drawIsland();      // ocean, beach, grass, river, bridges, roads
    drawTerrain();     // grass patches the ghillie uses, and dug trenches

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

    // decor sits on the ground, under the walls and everyone
    drawDecor();
    // every shadow in one pass, then the things that cast them
    drawStructureShadows();
    for (const o of obstacles) if (rectOnScreen(o)) drawStructure(o);

    drawCratesAndDeployables();
    drawDrops();

    // fx under agents
    for (const f of fx) { ctx.globalAlpha = clamp(f.life * 2.5, 0, 1); ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;

    // bullets
    for (const b of bullets) {
      ctx.strokeStyle = b.ricochet ? 'rgba(255,207,74,0.95)' : hexA(TEAM_COLORS[b.team], 0.9);
      ctx.lineWidth = 3; ctx.lineCap = 'round';
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
      if (a.isVehicle) { drawUnitShadow(a.x, a.y, a.r * 1.15); drawVehicle(a); continue; }
      const hidden = camouflaged(a);
      if (!hidden) drawUnitShadow(a.x, a.y, a.r);
      if (hidden) ctx.globalAlpha = a.isPlayer ? 0.45 : 0.12;   // ghillied: barely there
      // tool swing arc
      if (a.swingT > 0) {
        const reach = a.tool.range + a.r;
        ctx.beginPath(); ctx.arc(a.x, a.y, reach, a.angle - 0.9, a.angle + 0.9);
        ctx.strokeStyle = `rgba(255,255,255,${clamp(a.swingT * 4, 0, 0.7)})`; ctx.lineWidth = 4; ctx.stroke();
      }
      // riot shield plate
      if (a.tool.shield && (a.isPlayer ? input.ads : true)) {
        ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.angle);
        ctx.fillStyle = 'rgba(207,216,238,0.75)'; roundRect(a.r - 2, -16, 7, 32, 3); ctx.fill();
        ctx.restore();
      }
      // barrel, painted with the equipped skin
      const sk = a.skin || Skins.get('default');
      const bx = a.x + Math.cos(a.angle) * (a.r + 12), by = a.y + Math.sin(a.angle) * (a.r + 12);
      if (sk.glow) { ctx.shadowColor = sk.accent; ctx.shadowBlur = 10; }
      ctx.strokeStyle = sk.barrel; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bx, by); ctx.stroke();
      if (sk.stripes) {   // a contrasting wrap partway down the barrel
        ctx.strokeStyle = sk.accent; ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(a.x + Math.cos(a.angle) * (a.r + 4), a.y + Math.sin(a.angle) * (a.r + 4));
        ctx.lineTo(a.x + Math.cos(a.angle) * (a.r + 8), a.y + Math.sin(a.angle) * (a.r + 8));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      // muzzle tip in the skin accent
      ctx.fillStyle = sk.accent;
      ctx.beginPath(); ctx.arc(bx, by, 2.5, 0, Math.PI * 2); ctx.fill();
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
      // armour pips above the health bar
      if (a.vest || a.helmet) {
        ctx.fillStyle = '#9fd8ff';
        for (let p = 0; p < a.vest; p++) ctx.fillRect(a.x - hpw / 2 + p * 5, a.y - a.r - 18, 4, 3);
        ctx.fillStyle = '#ffcf4a';
        for (let p = 0; p < a.helmet; p++) ctx.fillRect(a.x + hpw / 2 - 4 - p * 5, a.y - a.r - 18, 4, 3);
      }
      ctx.globalAlpha = 1;
    }

    // contacts a squadmate's gadget has marked — visible to the whole team
    for (const a of agents) {
      if (!a.alive || a.team === player.team || !(a.markedUntil > 0)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(a.markedUntil * 6);
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 12 + pulse * 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,120,60,${clamp(a.markedUntil / 3, 0.2, 0.9)})`;
      ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = `rgba(255,150,90,${clamp(a.markedUntil / 3, 0.2, 0.9)})`;
      ctx.font = 'bold 13px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText('▼', a.x, a.y - a.r - 24);
    }

    drawVisionTools();   // heat / night vision markers sit over the units

    // damage numbers
    for (const d of dmgNums) {
      ctx.globalAlpha = clamp(d.life * 1.6, 0, 1);
      // head = gold and big, limb = dim and small, body = plain
      ctx.fillStyle = d.zone === 'head' ? '#ffcf4a' : d.zone === 'limb' ? '#9aa7bd' : '#fff';
      ctx.font = `bold ${d.zone === 'head' ? 22 : d.zone === 'limb' ? 13 : 16}px Segoe UI`;
      ctx.textAlign = 'center';
      ctx.fillText(d.zone === 'head' ? d.val + '!' : d.val, d.x, d.y);
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

    // night-vision tint is a screen-space wash
    if (player.alive && player.toolActive && player.tool.nightFov) {
      ctx.fillStyle = 'rgba(75,224,138,0.12)'; ctx.fillRect(0, 0, W, H);
    }

    drawTacticalHud();
    drawMinimap();

    // flashbang whiteout (screen space, over everything)
    if (flashOverlay > 0) { ctx.fillStyle = `rgba(255,255,255,${clamp(flashOverlay / 1.5, 0, 0.96)})`; ctx.fillRect(0, 0, W, H); }
  }

  /* ---------------- the island ----------------
     Painted in bands from the outside in, the way the terrain is generated:
     ocean, then beach, then grass, then the river cut through it, then the
     bridges and roads laid on top. */
  function drawIsland() {
    const T = terrain; if (!T) return;
    const C = Terrain.COLORS;

    // ocean fills everything; the bands paint over it
    ctx.fillStyle = C.oceanDeep;
    ctx.fillRect(-400, -400, MAP_W + 800, MAP_H + 800);
    ctx.fillStyle = C.ocean;
    ctx.fillRect(-200, -200, MAP_W + 400, MAP_H + 400);

    // beach
    const bi = T.oceanInset;
    ctx.fillStyle = C.beach;
    ctx.fillRect(bi, bi, MAP_W - bi * 2, MAP_H - bi * 2);
    ctx.strokeStyle = C.beachEdge; ctx.lineWidth = 3;
    ctx.strokeRect(bi, bi, MAP_W - bi * 2, MAP_H - bi * 2);

    // grass interior
    const gi = T.beachInset;
    ctx.fillStyle = C.grass;
    ctx.fillRect(gi, gi, MAP_W - gi * 2, MAP_H - gi * 2);

    // tonal patches so the field isn't a flat slab
    ctx.save();
    ctx.beginPath(); ctx.rect(gi, gi, MAP_W - gi * 2, MAP_H - gi * 2); ctx.clip();
    for (const p of T.patches) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.light ? C.grassLight : C.grassAlt;
      ctx.globalAlpha = 0.35; ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // river, drawn as a thick stroked polyline with a lighter bank
    for (const r of T.rivers) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      r.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = C.riverEdge; ctx.lineWidth = r.width + 12; ctx.stroke();
      ctx.strokeStyle = C.river; ctx.lineWidth = r.width; ctx.stroke();
    }

    // roads
    for (const rd of T.roads) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      rd.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = C.road; ctx.lineWidth = rd.width; ctx.stroke();
      // centre line
      ctx.setLineDash([26, 26]);
      ctx.strokeStyle = C.roadLine; ctx.lineWidth = 3; ctx.stroke();
      ctx.setLineDash([]);
    }

    // bridges over the river
    for (const b of T.bridges) {
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(b.angle);
      ctx.fillStyle = Terrain.COLORS.bridge;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.strokeStyle = Terrain.COLORS.bridgeEdge; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-b.w / 2, -b.h / 2); ctx.lineTo(b.w / 2, -b.h / 2);
      ctx.moveTo(-b.w / 2, b.h / 2); ctx.lineTo(b.w / 2, b.h / 2);
      ctx.stroke();
      // planking
      ctx.strokeStyle = 'rgba(94,70,41,0.5)'; ctx.lineWidth = 2;
      for (let i = -b.w / 2 + 14; i < b.w / 2; i += 28) {
        ctx.beginPath(); ctx.moveTo(i, -b.h / 2); ctx.lineTo(i, b.h / 2); ctx.stroke();
      }
      ctx.restore();
    }

    // map edge
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, MAP_W, MAP_H);
  }

  /* ---------------- terrain & structures ---------------- */
  function drawTerrain() {
    // grass (ghillie cover)
    for (const g of grass) {
      if (!rectOnScreen(g)) continue;
      roundRect(g.x, g.y, g.w, g.h, 18);
      ctx.fillStyle = 'rgba(96,214,132,0.16)'; ctx.fill();
      ctx.strokeStyle = 'rgba(110,230,150,0.30)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // dug trenches
    for (const t of trenches) {
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(90,66,40,0.45)'; ctx.fill();
      ctx.strokeStyle = 'rgba(176,138,90,0.5)'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  /* ---------------- shadows & decor ----------------
     One low sun, so everything casts the same way. Shadows are drawn as a
     separate pass under the objects that cast them, which keeps them from
     ever landing on top of something they should be beneath. */
  const SUN = { dx: 0.55, dy: 0.38 };          // direction shadows are thrown
  const SHADOW = 'rgba(0,0,0,0.34)';

  /* ---------------- viewport culling ----------------
     A domination map carries ~700 wall pieces and ~2000 props. Only a fraction
     is on screen at any moment, so everything world-space checks the view
     bounds first — without this the draw cost scales with the map, not the
     screen. Recomputed once per frame in render(). */
  let viewX0 = 0, viewY0 = 0, viewX1 = 0, viewY1 = 0;
  function updateViewBounds() {
    const vw = W / zoom, vh = H / zoom;
    const pad = 80;
    viewX0 = camX - pad; viewY0 = camY - pad;
    viewX1 = camX + vw + pad; viewY1 = camY + vh + pad;
  }
  const onScreen = (x, y, r) =>
    x + (r || 0) >= viewX0 && x - (r || 0) <= viewX1 &&
    y + (r || 0) >= viewY0 && y - (r || 0) <= viewY1;
  const rectOnScreen = (s) =>
    s.x + s.w >= viewX0 && s.x <= viewX1 && s.y + s.h >= viewY0 && s.y <= viewY1;

  /* offset silhouettes of every solid wall, drawn before the walls themselves */
  function drawStructureShadows() {
    ctx.fillStyle = SHADOW;
    for (const s of structureRects()) {
      const k = kindOf(s);
      if (k.height !== 'high' || s.open) continue;         // only tall things cast
      if (!rectOnScreen(s)) continue;
      const lift = (s.thickness || 0.3) * 26;              // thicker wall, longer shadow
      roundRect(s.x + SUN.dx * lift, s.y + SUN.dy * lift, s.w, s.h, 5);
      ctx.fill();
    }
    // low cover gets a tighter, softer shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (const s of structureRects()) {
      const k = kindOf(s);
      if (k.height !== 'low' || k.passable) continue;
      if (!rectOnScreen(s)) continue;
      roundRect(s.x + SUN.dx * 6, s.y + SUN.dy * 6, s.w, s.h, 3);
      ctx.fill();
    }
  }

  /* props: shadow first, then the prop, so a tree never shades itself */
  function drawDecor() {
    if (!decor.length) return;
    // shadows
    for (const d of decor) {
      const m = Sprites.META[d.kind]; if (!m) continue;
      const r = m.r * d.scale;
      if (!onScreen(d.x, d.y, r + m.shadow)) continue;
      ctx.save();
      ctx.fillStyle = SHADOW;
      ctx.translate(d.x + SUN.dx * m.shadow, d.y + SUN.dy * m.shadow);
      ctx.scale(1, 0.55);                                  // flattened, like a low sun
      ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // the props themselves, drawn as vector sprites
    for (const d of decor) {
      const m = Sprites.META[d.kind]; if (!m) continue;
      if (!onScreen(d.x, d.y, m.r * d.scale)) continue;
      Sprites.draw(ctx, d.kind, d.x, d.y, d.scale, d.rot * 0.25);
    }
  }

  /* soft ground shadow under a unit */
  function drawUnitShadow(x, y, r) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.translate(x + SUN.dx * 7, y + SUN.dy * 7);
    ctx.scale(1, 0.6);
    ctx.beginPath(); ctx.arc(0, 0, r * 1.02, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawStructure(s) {
    const k = kindOf(s);
    const dmg = s.maxHp ? clamp(1 - s.hp / s.maxHp, 0, 1) : 0;
    const along = s.w >= s.h;

    if (s.type === 'wire') {          // hatched strip you can walk (slowly) through
      ctx.strokeStyle = k.stroke; ctx.lineWidth = 2;
      ctx.beginPath();
      const len = along ? s.w : s.h;
      for (let i = 0; i <= len; i += 14) {
        if (along) { ctx.moveTo(s.x + i, s.y); ctx.lineTo(s.x + i + 8, s.y + s.h); ctx.moveTo(s.x + i + 8, s.y); ctx.lineTo(s.x + i, s.y + s.h); }
        else { ctx.moveTo(s.x, s.y + i); ctx.lineTo(s.x + s.w, s.y + i + 8); ctx.moveTo(s.x, s.y + i + 8); ctx.lineTo(s.x + s.w, s.y + i); }
      }
      ctx.stroke();
      return;
    }

    if (Structures.isDoor(s)) {       // open doors swing out of the frame
      const c = doorCentre(s);
      ctx.save(); ctx.translate(c.x, c.y);
      if (s.open) ctx.rotate((along ? 1 : -1) * Math.PI / 2 * 0.75);
      const w = along ? s.w : s.h, h = along ? s.h : s.w;
      ctx.globalAlpha = s.open ? 0.55 : 1;
      if (along) { roundRect(-w / 2, -h / 2, w, h, 3); } else { roundRect(-h / 2, -w / 2, h, w, 3); }
      ctx.fillStyle = k.fill; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = k.stroke; ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
      // handle dot so a door reads as a door at a glance
      ctx.beginPath(); ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = k.stroke; ctx.fill();
      if (player && player.alive && near2({ x: c.x, y: c.y }, player, 70)) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'center';
        ctx.fillText(s.open ? '[E] Close' : '[E] Open', c.x, c.y - 18);
      }
      return;
    }

    roundRect(s.x, s.y, s.w, s.h, k.height === 'low' ? 3 : 5);
    ctx.fillStyle = k.fill; ctx.fill();
    ctx.lineWidth = k.height === 'low' ? 1.5 : 2;
    ctx.strokeStyle = k.stroke; ctx.stroke();
    // reinforced/metal get a bright inner line so ricochet walls are readable
    if (s.type === 'rwall' || s.type === 'metal') {
      ctx.strokeStyle = 'rgba(220,235,255,0.22)'; ctx.lineWidth = 1;
      ctx.strokeRect(s.x + 3, s.y + 3, Math.max(0, s.w - 6), Math.max(0, s.h - 6));
    }
    if (dmg > 0.02) {   // damage bleeds along the length of the piece
      ctx.fillStyle = `rgba(255,75,92,${0.12 + dmg * 0.3})`;
      if (along) ctx.fillRect(s.x + 1, s.y + 1, (s.w - 2) * dmg, Math.max(2, s.h - 2));
      else ctx.fillRect(s.x + 1, s.y + 1, Math.max(2, s.w - 2), (s.h - 2) * dmg);
    }
  }

  /* dropped stacks: bob gently, fade as they time out, prompt when you're close */
  function drawDrops() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const d of drops) {
      const it = Items.CONSUMABLES[d.id]; if (!it) continue;
      const lift = Math.sin(d.bob) * 3;
      ctx.globalAlpha = d.life < 8 ? clamp(d.life / 8, 0.15, 1) : 1;
      drawUnitShadow(d.x, d.y + 6, 11);
      // little pedestal so it reads as loot rather than scenery
      ctx.beginPath(); ctx.arc(d.x, d.y + lift, 14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,28,48,0.8)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(120,200,255,0.6)'; ctx.stroke();
      ctx.font = '17px Segoe UI'; ctx.fillText(it.icon, d.x, d.y + lift + 1);
      if (d.n > 1) {
        ctx.font = 'bold 10px Segoe UI'; ctx.fillStyle = '#fff';
        ctx.fillText('×' + d.n, d.x + 13, d.y + lift - 10);
      }
      if (player && player.alive && near2(d, player, 78)) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Segoe UI';
        ctx.fillText(`[E] ${it.name}`, d.x, d.y - 26);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------- tactical rendering helpers ---------------- */
  function drawCratesAndDeployables() {
    // crates
    for (const c of crates) {
      if (!onScreen(c.x, c.y, 40)) continue;
      const st = Items.CRATE_STYLE[c.tier];
      ctx.globalAlpha = c.opened ? 0.3 : 1;
      roundRect(c.x - 15, c.y - 15, 30, 30, 6);
      ctx.fillStyle = c.opened ? '#37456b' : hexA(st.color, 0.95); ctx.fill();
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
        drawStructure(dp.rect);
      } else if (dp.type === 'sentry') {
        ctx.save();
        ctx.translate(dp.x, dp.y); ctx.rotate(dp.angle);
        ctx.fillStyle = '#e9f0ff'; ctx.fillRect(0, -3, 26, 6);          // barrel
        ctx.restore();
        ctx.beginPath(); ctx.arc(dp.x, dp.y, 13, 0, Math.PI * 2);
        ctx.fillStyle = '#243044'; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = TEAM_COLORS[dp.team]; ctx.stroke();
        ctx.beginPath(); ctx.arc(dp.x, dp.y, dp.item.range, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(TEAM_COLORS[dp.team], 0.08); ctx.lineWidth = 1; ctx.stroke();
        const hw = 30;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(dp.x - hw / 2, dp.y - 24, hw, 4);
        ctx.fillStyle = '#35e0ff'; ctx.fillRect(dp.x - hw / 2, dp.y - 24, hw * clamp(dp.hp / dp.maxHp, 0, 1), 4);
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
  /* Marksman NVG / Demolitionist heat goggles — both mark enemies, drawn in world space. */
  function drawVisionTools() {
    const p = player;
    if (!p || !p.alive || !p.toolActive) return;
    const t = p.tool;
    if (t.heat) {                     // heat signatures bleed through walls
      for (const a of agents) {
        if (!a.alive || a.team === p.team) continue;
        if (dist2(a.x, a.y, p.x, p.y) > t.heat * t.heat) continue;
        const g = ctx.createRadialGradient(a.x, a.y, 2, a.x, a.y, a.r + 16);
        g.addColorStop(0, 'rgba(255,120,60,0.85)');
        g.addColorStop(1, 'rgba(255,80,40,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 16, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (t.nightFov) {                 // 25% further spotting, and smoke doesn't hide them
      const range = 620 * (1 + t.nightFov);
      for (const a of agents) {
        if (!a.alive || a.team === p.team) continue;
        if (dist2(a.x, a.y, p.x, p.y) > range * range) continue;
        if (!hasLOS(p.x, p.y, a.x, a.y)) continue;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(120,255,170,0.9)'; ctx.lineWidth = 2; ctx.stroke();
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

  /* ---------------- action HUD ----------------
     Everything the player can *do* lives in one centred action bar, and
     everything about their *state* lives in one left-hand stack, so the two
     never interleave. Layout constants are here so the whole bar moves
     together instead of each piece carrying its own magic offsets. */
  const HUD = {
    slotW: 72, slotH: 66, gap: 8,
    barBottom: 26,        // gap from the bottom of the screen to the action bar
    statusLeft: 22,
    rowH: 18,
  };
  const hudBarY = () => H - HUD.barBottom - HUD.slotH;

  function drawTacticalHud() {
    const p = player; if (!p || !p.inv) return;
    drawStatusStack(p);
    drawActionBar(p);
    drawChannelRing(p);
    drawHudMessage();
  }

  /* left column: class → armour → adrenaline, one aligned stack */
  function drawStatusStack(p) {
    const adr = Combat.adrenaline(p.adrenaline);
    const x = HUD.statusLeft;
    // the HTML health bar occupies the bottom ~46px, so stack upward from there
    let y = H - 78;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

    // adrenaline (only while you have some) — bar plus what it's currently giving
    if (adr.amount > 0) {
      const bw = 200;
      ctx.fillStyle = 'rgba(20,30,55,0.8)'; roundRect(x, y - 4, bw, 8, 4); ctx.fill();
      ctx.fillStyle = p.hp < p.maxHp ? '#4be08a' : '#ffcf4a';    // green while it's healing you
      roundRect(x, y - 4, bw * (adr.amount / 100), 8, 4); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      for (const t of [25, 50, 75]) ctx.fillRect(x + bw * (t / 100), y - 4, 1, 8);
      ctx.font = 'bold 10px Segoe UI'; ctx.fillStyle = p.hp < p.maxHp ? '#4be08a' : '#ffcf4a';
      const healing = p.hp < p.maxHp ? ` · +${adr.regen.toFixed(1)} HP/s` : '';
      ctx.fillText(`ADR ${Math.round(adr.amount)} · +${Math.round((adr.speed - 1) * 100)}% · -${Math.round(adr.dr * 100)}% dmg${healing}`, x + bw + 10, y);
      y -= HUD.rowH;
    }
    // armour
    if (p.vest || p.helmet) {
      ctx.font = 'bold 11px Segoe UI'; ctx.fillStyle = '#9fd8ff';
      const bits = [];
      if (p.vest) bits.push(`🦺 T${p.vest} ${Math.round(Combat.vest(p.vest).body * 100)}% body`);
      if (p.helmet) bits.push(`⛑ T${p.helmet} ${Math.round(Combat.helmet(p.helmet).head * 100)}% head`);
      ctx.fillText(bits.join('   '), x, y);
      y -= HUD.rowH;
    }
    // class + tool
    ctx.font = 'bold 12px Segoe UI'; ctx.fillStyle = p.cls.color;
    ctx.fillText(`${p.cls.icon} ${p.cls.name.toUpperCase()}`, x, y);
    ctx.font = '11px Segoe UI'; ctx.fillStyle = '#8ea0c9';
    ctx.fillText(`${p.cls.speed}× · ${p.tool.name}`, x + ctx.measureText(`${p.cls.icon} ${p.cls.name.toUpperCase()}`).width + 44, y);
  }

  /* one centred row of every action, in the order you use them */
  function drawActionBar(p) {
    const t = p.tool;
    const slots = [
      {
        key: 'V', icon: t.icon, label: t.name,
        cd: p.toolCd, cdMax: t.cooldown, active: p.toolActive, accent: p.cls.color,
      },
      slotFor('Q', p.inv.grenade), slotFor('C', p.inv.tactical), slotFor('F', p.inv.heal),
    ];
    if (p.inv.tokens.length) {
      const tk = Items.CONSUMABLES[p.inv.tokens[0]];
      slots.push({ key: 'B', icon: tk.icon, label: 'Call-in', n: p.inv.tokens.length, accent: '#ffcf4a' });
    }

    const { slotW: sw, slotH: sh, gap } = HUD;
    const totalW = slots.length * sw + (slots.length - 1) * gap;
    let x = W / 2 - totalW / 2;
    const y = hudBarY();
    for (const s of slots) { drawActionSlot(s, x, y, sw, sh); x += sw + gap; }
  }
  function slotFor(key, slot) {
    const it = slot && slot.id ? Items.CONSUMABLES[slot.id] : null;
    return { key, icon: it ? it.icon : '—', label: it ? it.name : '', n: it ? slot.n : 0, empty: !it };
  }

  function drawActionSlot(s, x, y, sw, sh) {
    const ready = !s.cd || s.cd <= 0;
    const usable = !s.empty && ready;
    ctx.fillStyle = 'rgba(28,40,70,0.82)'; roundRect(x, y, sw, sh, 10); ctx.fill();
    ctx.lineWidth = s.active ? 2 : 1;
    ctx.strokeStyle = s.active ? (s.accent || '#fff')
      : s.empty ? 'rgba(160,200,255,0.25)' : 'rgba(170,210,255,0.55)';
    ctx.stroke();

    // cooldown drains from the bottom up
    if (!ready && s.cdMax) {
      ctx.save(); ctx.beginPath(); roundRect(x, y, sw, sh, 10); ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, y, sw, sh * clamp(s.cd / s.cdMax, 0, 1));
      ctx.restore();
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '23px Segoe UI';
    ctx.globalAlpha = usable ? 1 : 0.45;
    ctx.fillStyle = s.empty ? '#3b4666' : '#fff';
    ctx.fillText(s.icon, x + sw / 2, y + 27);
    ctx.globalAlpha = 1;

    ctx.font = 'bold 9px Segoe UI'; ctx.fillStyle = s.empty ? '#3b4666' : '#8ea0c9';
    const label = s.label.length > 14 ? s.label.slice(0, 13) + '…' : s.label;
    ctx.fillText(label, x + sw / 2, y + 50);

    // keybind top-left, count top-right
    ctx.textAlign = 'left'; ctx.font = 'bold 10px Segoe UI';
    ctx.fillStyle = usable ? '#ffcf4a' : '#6a789c';
    ctx.fillText(s.key, x + 7, y + 11);
    if (s.n) {
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
      ctx.fillText('×' + s.n, x + sw - 7, y + 11);
    } else if (!ready && s.cdMax >= 5) {
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
      ctx.fillText(Math.ceil(s.cd) + 's', x + sw - 7, y + 11);
    }
    ctx.textAlign = 'center';
  }

  /* channel ring (heal progress) sits just above the action bar */
  function drawChannelRing(p) {
    if (!p.channel) return;
    const cx = W / 2, cy = hudBarY() - 62, rad = 26;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 6; ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + (1 - p.channel.t / p.channel.total) * Math.PI * 2);
    ctx.strokeStyle = '#4be08a'; ctx.lineWidth = 6; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.channel.label, cx, cy + rad + 16);
  }

  function drawHudMessage() {
    if (hudMessageT <= 0) return;
    ctx.globalAlpha = clamp(hudMessageT, 0, 1);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(hudMessage, W / 2, hudBarY() - 24);
    ctx.globalAlpha = 1;
  }

  function drawMinimap() {
    const mw = 180, mh = mw * (MAP_H / MAP_W), pad = 16;
    const ox = W - mw - pad, oy = pad + 40;
    ctx.save();
    ctx.fillStyle = 'rgba(26,38,66,0.78)'; roundRect(ox, oy, mw, mh, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(175,210,255,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    const sx = mw / MAP_W, sy = mh / MAP_H;
    // building footprints, so you can read the map at a glance
    ctx.fillStyle = 'rgba(205,225,255,0.38)';
    for (const s of structureRects()) {
      if (kindOf(s).height !== 'high') continue;
      ctx.fillRect(ox + s.x * sx, oy + s.y * sy, Math.max(1, s.w * sx), Math.max(1, s.h * sy));
    }
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

  return { start, setupFor: (m) => TEAM_SETUP[m] || TEAM_SETUP.domination };
})();
