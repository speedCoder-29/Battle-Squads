/* ============================================================
   game.js — the actual 2D top-down team shooter.
   Two modes:
     • domination  — capture & hold objectives, first to score cap
     • elimination — last squad standing, no respawns
   Single-player vs bots (real multiplayer needs a server — see README).
   ============================================================ */
const Game = (() => {
  // domination is fought over a much bigger board than the elimination arena
  /* Map sizes live in the shared sim so a host and its peers agree on the
     coordinate space. They used to be declared here and again in the server,
     which meant an online match simulated in one size and rendered in another. */
  const MAP_SIZES = (typeof RoomSim !== 'undefined' && RoomSim.MAP_SIZES)
    ? RoomSim.MAP_SIZES
    : { domination: { w: 7400, h: 7400 }, elimination: { w: 5200, h: 5200 } };

  /* ---------------- world seed ----------------
     Every client builds its own copy of the map, so the two have to agree
     exactly. Generation draws on Math.random in five different modules, so
     rather than thread a generator through all of them we swap Math.random
     for a seeded one for the duration of generation and put it straight back.
     Generation is synchronous, so nothing else can observe the swap. */
  let worldSeed = 1;
  function withSeed(seed, fn) {
    const real = Math.random;
    let s = (seed >>> 0) || 1;
    Math.random = () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    try { return fn(); } finally { Math.random = real; }
  }
  let MAP_W = MAP_SIZES.domination.w, MAP_H = MAP_SIZES.domination.h;
  const SCORE_CAP = 1000;             // domination win score
  const MATCH_SECONDS = 8 * 60;      // time limit
  const TEAM_COLORS = ['#3d7bff', '#ff4b5c', '#4be08a', '#c46bff', '#ffa726', '#35e0ff'];
  const TEAM_NAMES  = ['Blue', 'Red', 'Green', 'Violet', 'Amber', 'Cyan'];
  /* Colour for a team index, safe for the -1 an unclaimed vehicle carries. */
  const NEUTRAL_INK = '#9aa3b5';
  const teamInk = (t) => (t >= 0 ? TEAM_COLORS[t % TEAM_COLORS.length] : NEUTRAL_INK);
  // squad setup per mode
  /* How many squads, and how many in each. These are the defaults per mode;
     the player can override both from the lobby, and an override is kept in
     the profile so it survives a reload.

     Bounded rather than free: one team is not a match, and the spawn ring
     places squads around the island by corner, so past six they start sharing
     ground. The per-team cap is what the agent list and the bot AI stay
     comfortable with on a browser frame budget. */
  const TEAM_SETUP = { domination: { teams: 4, perTeam: 4 }, elimination: { teams: 6, perTeam: 4 } };
  const TEAM_LIMITS = { teams: [2, 20], perTeam: [1, 8] };

  /* The setup a match should actually use: the mode's default, with whatever
     the player chose laid over it and clamped to what the game can stage. */
  function setupFor(m) {
    const base = TEAM_SETUP[m] || TEAM_SETUP.domination;
    let pick = null;
    try { pick = (DB.getProfile() || {}).matchSetup; } catch (e) { pick = null; }
    const lim = (v, d, [lo, hi]) => clamp(Math.round(v === undefined || v === null ? d : v), lo, hi);
    return {
      teams: lim(pick && pick.teams, base.teams, TEAM_LIMITS.teams),
      perTeam: lim(pick && pick.perTeam, base.perTeam, TEAM_LIMITS.perTeam),
    };
  }
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
  /* survev shows you a fairly tight slice of the world — a player is a good
     fraction of the screen height. BASE_ZOOM sets that framing; the binoculars
     and ADS still scale relative to it. */
  const BASE_ZOOM = 1.45;
  let zoom = BASE_ZOOM, zoomTarget = BASE_ZOOM;
  let teamScores = [];
  let player = null;
  let matchStats = { kills: 0, captures: 0 };
  /* One tile, the unit everything spatial is measured in: weapon ranges
     (weapons.js), blast radii (items.js) and the map itself, which is 128
     tiles across. */
  const TILE = 50;
  /* Infantry hitbox radius. Smaller than a tile by a good margin — a body is
     something you fit through a doorway with, not something that fills one.
     Shrinking it also widens the world without touching the camera: at 0.3
     tiles a player is a target you have to aim at across a courtyard rather
     than a blob you can hardly miss. Bullets are stepped along their flight
     (see BULLET_STEP) so a hitbox this small still can't be flown through. */
  const BODY_R = 15;

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
  /* Objectives live inside the landmark buildings, so capturing one means
     holding a factory floor or a keep rather than standing in a field. If a
     landmark somehow failed to place, we fall back to open ground. */
  function objectiveAnchors() {
    const names = ['A', 'B', 'C'];
    if (landmarks.length >= 3) {
      return landmarks.slice(0, 3).map((l, i) => {
        const r = Math.max(150, Math.min(l.w, l.h) * 0.30);
        const p = spotInsideBuilding(l, r);
        return { name: names[i], x: p.x, y: p.y, r, building: l.name, inside: true };
      });
    }
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
  /* ---------------- landmarks ----------------
     One of each, placed first so they get the room they need, spread across
     the map. In domination these are also where the objectives go: capturing
     means holding a building, not standing in a field. */
  /* The three capture points are purpose-built now rather than whichever
     large building happened to be placed first. Each is a different problem —
     a tower you fight up, an open floor you fight across, and a walled keep
     you fight into — so holding A does not feel like holding C. */
  const LANDMARKS = ['obj-relay', 'obj-refinery', 'obj-citadel'];

  function placeLandmarks() {
    const anchors = [
      { x: MAP_W * 0.26, y: MAP_H * 0.70 },
      { x: MAP_W * 0.52, y: MAP_H * 0.40 },
      { x: MAP_W * 0.76, y: MAP_H * 0.72 },
    ];
    landmarks = [];
    LANDMARKS.forEach((name, i) => {
      const anchor = anchors[i % anchors.length];
      for (let ring = 0; ring <= 30; ring++) {
        for (let k = 0; k < 12; k++) {
          const ang = (k / 12) * Math.PI * 2 + ring;
          const d = ring * 140;
          const x = anchor.x + Math.cos(ang) * d - 300;
          const y = anchor.y + Math.sin(ang) * d - 250;
          const parts = placeBuilding(name, x, y);
          if (!parts.length) continue;
          const bb = boundsOf(parts);
          if (landmarks.some(l => padOverlap(bb, l, 260))) continue;
          const pid = 'L' + i;
          for (const p of parts) { p.placement = pid; p.landmark = true; genAdd(p); }
          obstacles.push(...parts);
          invalidateRects();
          const lst = Structures.shadeStyle(Structures.styleOf(name), Math.random);
          const rec = { name, placement: pid, ...bb, style: lst, floor: lst.floor, landmark: true, rooms: parts.rooms };
          landmarks.push(rec);
          buildings.push(rec);
          furnish(name, bb, parts.rooms);
          return;
        }
      }
    });
  }
  let landmarks = [];

  /* Somewhere inside a landmark that a capture point can actually sit: not on
     one of its internal walls, and as near the middle as we can manage. Big
     buildings have spines and inner rooms, so the geometric centre is often
     solid brick. */
  function spotInsideBuilding(l, r) {
    const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
    const clear = (x, y) => {
      if (pointInObstacle(x, y)) return false;
      // keep the disc inside the building's footprint
      return x - r > l.x - 20 && x + r < l.x + l.w + 20 &&
             y - r > l.y - 20 && y + r < l.y + l.h + 20;
    };
    if (clear(cx, cy)) return { x: cx, y: cy };
    for (let ring = 1; ring <= 14; ring++) {
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2 + ring * 0.4;
        const d = ring * 34;
        const x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d;
        if (clear(x, y)) return { x, y };
      }
    }
    return { x: cx, y: cy };            // bulldozing will make room
  }

  function placeObjectives() { return withSeed(worldSeed ^ 0x5bf0, placeObjectivesInner); }
  function placeObjectivesInner() {
    const clearAt = (x, y, r) => {
      if (!Terrain.isSpawnable(terrain, x, y)) return false;
      if (x < r + 60 || y < r + 60 || x > MAP_W - r - 60 || y > MAP_H - r - 60) return false;
      const disc = { x: x - r, y: y - r, w: r * 2, h: r * 2 };
      return !structureRects().some(o => padOverlap(disc, o, 0));
    };
    const pick = (a) => {
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
      // A dense map can genuinely have no gap wide enough for a 350px disc.
      // Rather than dropping the objective into a wall, bulldoze the site:
      // an objective you can't stand on isn't an objective.
      return Terrain.isSpawnable(terrain, a.x, a.y)
        ? a
        : { ...a, x: clamp(a.x, MAP_W * 0.3, MAP_W * 0.7), y: clamp(a.y, MAP_H * 0.3, MAP_H * 0.7) };
    };
    // Pick the best spot, then clear it regardless. Relying on the search alone
    // left a rare case where an objective sat inside a wall; bulldozing makes it
    // impossible rather than unlikely.
    objectiveSpotsCache = objectiveAnchors().map(a => {
      // An objective inside a landmark stays put — the whole point is that you
      // fight for the building. Clear only the clutter in the middle of it,
      // never the shell you're meant to be holding.
      if (a.inside) { clearObjectiveSite(a); return a; }
      const spot = pick(a);
      bulldoze(spot.x, spot.y, spot.r);
      return spot;
    });
    return objectiveSpotsCache;
  }

  /* Make a capture point usable. Inside a landmark we keep the shell — holding
     the building is the point — but if the spot still lands on one of its
     internal walls, punch through that: an unreachable objective is worse than
     a doorway in a spine. */
  function clearObjectiveSite(o) {
    bulldoze(o.x, o.y, o.r, !!o.inside);
    // If the point is still covered — usually by one of the landmark's own
    // internal walls — carve out just the offending pieces. Escalating through
    // bulldoze() would take the whole placement with it and delete the very
    // building the objective is supposed to be inside.
    for (let r = 70; r <= 220 && pointInObstacle(o.x, o.y); r += 50) carveOut(o.x, o.y, r);
  }

  /* Remove individual wall pieces overlapping a disc, without the whole-
     placement cascade bulldoze() does. Used to open a doorway through a
     building we want to keep standing. */
  function carveOut(x, y, r) {
    const disc = { x: x - r, y: y - r, w: r * 2, h: r * 2 };
    obstacles = obstacles.filter(o => !padOverlap(disc, o, 0));
    for (let i = deployables.length - 1; i >= 0; i--) {
      const dp = deployables[i];
      if (dp.type === 'wall' && dp.rect && padOverlap(disc, dp.rect, 0)) deployables.splice(i, 1);
    }
    invalidateRects();
  }

  /* clear every wall out of a disc, dropping whole buildings rather than
     leaving half of one standing */
  function bulldoze(x, y, r, keepLandmark) {
    const disc = { x: x - r, y: y - r, w: r * 2, h: r * 2 };
    const doomed = new Set();
    for (const o of obstacles) {
      if (keepLandmark && o.landmark) continue;
      if (o.placement && padOverlap(disc, o, 0)) doomed.add(o.placement);
    }
    obstacles = obstacles.filter(o => {
      if (keepLandmark && o.landmark) return true;
      if (o.placement && doomed.has(o.placement)) return false;
      return !padOverlap(disc, o, 0);
    });
    // deployed walls count too — solidRects includes them, so leaving one
    // behind would still block the point
    for (let i = deployables.length - 1; i >= 0; i--) {
      const dp = deployables[i];
      if (dp.type === 'wall' && dp.rect && padOverlap(disc, dp.rect, 0)) deployables.splice(i, 1);
    }
    // furniture in the capture area would just be in the way
    decor = decor.filter(d => !(d.indoors &&
      d.x > disc.x && d.x < disc.x + disc.w && d.y > disc.y && d.y < disc.y + disc.h));
    invalidateRects();
  }

  /* How much of everything a map gets, per million pixels of playable ground.
     Everything scales from the board size, so making the map bigger fills it
     instead of stretching it thin. */
  /* Loose cover and scenery scattered across the open map, per million px².
     Cover and props are both down: buildings are bigger and now carry their
     own arranged yards, so the ground between them was getting cluttered
     enough that crossing it was an obstacle course rather than a risk. Less
     out here also makes the organised stuff round a building read as
     deliberate rather than as more of the same. */
  const DENSITY = {
    buildings: 3.2,
    cover: 6.5,
    crates: 4.2,
    /* Props are counted per million px², and they got a lot bigger when they
       were sized against the real thing — a tree went from 1.8m across to
       4.6m, which is nearly four times the ground it covers. Keeping the old
       count would have put the same number of much larger objects on the map:
       the same field, four times as full. Fewer, bigger things is the same
       coverage and a far cheaper map to generate. */
    props: 34,         // was 78, when a tree was the size of a shrub
    groves: 2.0,       // stands of trees, per million px²
    grassPatches: 2.4,
  };
  /* the buildings that can be rolled, and how common each is */
  const BUILDING_MIX = [
    ['house', 14], ['shanty', 12], ['camp', 10], ['checkpoint', 10],
    ['farm', 9], ['tower', 9], ['apartments', 7], ['warehouse', 7],
    ['depot', 7], ['bunker', 6], ['mansion', 5], ['hangar', 4], ['base', 4],
    ['train-station', 4], ['school', 4], ['market', 4], ['power-plant', 4], ['dock', 4],
    ['workshop', 3], ['museum', 3], ['barracks', 3], ['armory', 3], ['church', 3],
    ['gas-station', 3], ['fortress', 2], ['arena', 2], ['radio-tower', 2], ['mine', 2],
    ['vault', 2], ['subway', 2], ['command-center', 2],
    /* These have blueprints and were never rolled: hospital, prison, bank and
       bridge-fort had no entry here and are not landmarks either, so forty
       generated maps in a row contained none of them. The four after those are
       new. A building nothing can place is a building nobody has ever seen. */
    ['hospital', 5], ['prison', 3], ['bank', 3], ['bridge-fort', 2],
    ['clinic', 7], ['library', 5], ['garage', 6], ['watermill', 4], ['bunker-complex', 5],
  ];
  const COVER_MIX = [
    ['sandbag', 26], ['barricade', 22], ['wire', 20], ['wood', 16], ['metal', 10], ['rwall', 6],
  ];

  const BUILDING_CATEGORIES = Structures.BUILDING_CATEGORIES;
  const BUILDING_WEIGHT_BY_NAME = Object.fromEntries(BUILDING_MIX);
  const BUILDING_CATEGORY_LIST = Object.fromEntries(
    Object.entries(BUILDING_CATEGORIES).map(([cat, names]) => [cat, names.filter(name => BUILDING_WEIGHT_BY_NAME[name] !== undefined)])
  );

  function buildMap() { withSeed(worldSeed, buildMapInner); }
  function buildMapInner() {
    obstacles = []; trenches = []; decor = []; grass = [];
    buildings = []; landmarks = []; pendingIndoorCrates = [];
    requiredPlacements = []; pendingRoomVehicles = []; basements = [];
    requiredTally = {}; pendingYards = []; roomAnchors = new WeakMap(); upperFloors = [];
    for (const k in sizeCache) delete sizeCache[k];
    genReset();
    invalidateRects();
    terrain = Terrain.generate(MAP_W, MAP_H, worldSeed);

    // playable ground is the grass interior, not the whole rectangle
    const playW = MAP_W - Terrain.BEACH_INSET * 2;
    const playH = MAP_H - Terrain.BEACH_INSET * 2;
    const area = (playW * playH) / 1e6;                  // in millions of px

    placeTeamBases();                                   // one per squad, at their corner
    placeLandmarks();                                   // the big one-offs get first pick
    placeRequiredBuildings();                           // then the ones the map must have
    placeBuildingsProcedural(Math.round(area * DENSITY.buildings));
    layOutYards();                                      // now that nothing else needs the ground
    placeCover(Math.round(area * DENSITY.cover));
    placeGrass(Math.round(area * DENSITY.grassPatches));
    placeGroves(Math.round(area * DENSITY.groves));
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

  /* ---------------- generation-time overlap index ----------------
     Placing ~1700 walls by testing each candidate against every wall already
     down is quadratic, and it showed: map generation was taking over a second.
     This is a coarse bucket grid maintained during generation, so a candidate
     only checks the walls near it. */
  const GEN_CELL = 200;
  let genGrid = null;
  const genReset = () => { genGrid = new Map(); };
  const genKey = (cx, cy) => cx + ',' + cy;
  function genAdd(r) {
    if (!genGrid) genReset();
    const x0 = Math.floor(r.x / GEN_CELL), x1 = Math.floor((r.x + r.w) / GEN_CELL);
    const y0 = Math.floor(r.y / GEN_CELL), y1 = Math.floor((r.y + r.h) / GEN_CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = genKey(cx, cy);
        let arr = genGrid.get(k);
        if (!arr) { arr = []; genGrid.set(k, arr); }
        arr.push(r);
      }
    }
  }
  /* does this rect (plus padding) hit anything already placed? */
  function genHits(r, pad) {
    if (!genGrid) return false;
    const p = pad || 0;
    const x0 = Math.floor((r.x - p) / GEN_CELL), x1 = Math.floor((r.x + r.w + p) / GEN_CELL);
    const y0 = Math.floor((r.y - p) / GEN_CELL), y1 = Math.floor((r.y + r.h + p) / GEN_CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = genGrid.get(genKey(cx, cy));
        if (!arr) continue;
        for (const o of arr) if (padOverlap(r, o, p)) return true;
      }
    }
    return false;
  }

  /* Place a building only where the terrain allows it, and keep it whole.
     Filtering segment-by-segment would carve holes in anything straddling the
     river, so a placement either lands entirely or is rejected. */
  /* `pad` is the clear space demanded around the footprint. The default keeps
     buildings comfortably apart; the required-building fallback lowers it,
     because a map that is short of a museum is worse than one where the
     museum is a bit close to its neighbour. */
  let lastReject = '';
  function placeBuilding(name, x, y, pad) {
    /* Sight the footprint before drawing the building. Constructing the
       blueprint is by far the most expensive step, and measured over a real
       generation ~97% of candidates are then thrown away for clearance — so
       nearly all of that work was being done only to be discarded. A blueprint
       scales about its own origin, so its bounding box is known from the
       origin alone, and the box can be tested first. The margin keeps this
       strictly conservative: it may let a doomed candidate through to the real
       check below, but it can never reject one that would have fitted. */
    const guess = placedSize(name);
    if (guess.w) {
      const pb = { x: x + guess.x, y: y + guess.y, w: guess.w, h: guess.h };
      if (pb.x < 16 || pb.y < 16 || pb.x + pb.w > MAP_W - 16 || pb.y + pb.h > MAP_H - 16) { lastReject = 'offMap'; return []; }
      if (genHits(pb, Math.max(0, (pad === undefined ? 120 : pad) - 24))) { lastReject = 'occupied'; return []; }
    }
    const parts = Structures.place(name, x, y);
    if (!parts.length) { lastReject = 'blueprint'; return []; }
    const bb = boundsOf(parts);
    if (bb.x < 40 || bb.y < 40 || bb.x + bb.w > MAP_W - 40 || bb.y + bb.h > MAP_H - 40) { lastReject = 'offMap'; return []; }
    // Cheap rejections first. Most candidates fail, and the per-segment terrain
    // check below runs a distance-to-river test per probe — doing that for a
    // building that already overlaps something was most of the generation cost.
    if (genHits(bb, pad === undefined ? 120 : pad)) { lastReject = 'occupied'; return []; }
    if (!Terrain.isBuildable(terrain, bb.x + bb.w / 2, bb.y + bb.h / 2, 10)) { lastReject = 'terrain'; return []; }
    // Check every segment, not just the bounding box: a river bending through
    // the middle of a large building passes between the corners unnoticed, and
    // half a warehouse standing in the water is worse than not placing it.
    for (const s of parts) {
      if (!Terrain.isBuildable(terrain, s.x + s.w / 2, s.y + s.h / 2, 8)
        || !Terrain.isBuildable(terrain, s.x, s.y, 4)
        || !Terrain.isBuildable(terrain, s.x + s.w, s.y + s.h, 4)) { lastReject = 'terrain'; return []; }
    }
    lastReject = '';
    return parts;
  }

  /* ---------------- building interiors ----------------
     survev buildings aren't just a ring of walls: they have a floor you can
     see you're standing on, a roof that hides the inside until you walk in,
     furniture, and loot worth going in for. Each placement records its
     footprint so all three can be drawn and stocked. */
  let buildings = [];

  /* what furnishes each kind of building, and how much loot it's worth */
  const FURNISH = {
    house:      { props: ['bed', 'table', 'chair', 'shelf', 'stove', 'toilet', 'plant'], n: 12, loot: 3, floor: '#6b5741' },
    mansion:    { props: ['bed', 'table', 'chair', 'plant', 'shelf', 'desk'], n: 22, loot: 6, floor: '#7a6448' },
    apartments: { props: ['bed', 'table', 'chair', 'stove', 'toilet', 'shelf', 'plant'], n: 26, loot: 7, floor: '#6b5741' },
    shanty:     { props: ['rubble', 'stove', 'shelf', 'crate', 'pallet'], n: 10, loot: 3, floor: '#5f4e3b' },
    warehouse:  { props: ['pallet', 'pallet', 'crate', 'barrel', 'shelf'], n: 24, loot: 7, floor: '#4e5666' },
    hangar:     { props: ['tyre', 'pallet', 'barrel', 'ammoBox', 'cone'], n: 22, loot: 7, floor: '#4a5260' },
    bunker:     { props: ['ammoBox', 'locker', 'sandpile', 'crate'], n: 12, loot: 5, floor: '#454d5a' },
    base:       { props: ['locker', 'ammoBox', 'desk', 'chair', 'bed'], n: 20, loot: 6, floor: '#4e5666' },
    tower:      { props: ['ammoBox', 'desk', 'chair', 'crate'], n: 5, loot: 2, floor: '#454d5a' },
    farm:       { props: ['pallet', 'shelf', 'stove', 'table', 'crate', 'barrel'], n: 12, loot: 3, floor: '#665338' },
    depot:      { props: ['pallet', 'barrel', 'crate', 'container'], n: 10, loot: 4, floor: '#5a5646' },
    camp:       { props: ['tent', 'bed', 'crate', 'stump', 'shelf'], n: 8, loot: 3, floor: '#5c5a44' },
    checkpoint: { props: ['sandpile', 'ammoBox', 'desk', 'cone'], n: 5, loot: 2, floor: '#4d5462' },
    'train-station': { props: ['chair', 'chair', 'sign', 'crate', 'pallet'], n: 18, loot: 5, floor: '#4a5260' },
    school:     { props: ['desk', 'chair', 'chair', 'shelf', 'locker'], n: 18, loot: 5, floor: '#6b5741' },
    market:     { props: ['table', 'table', 'crate', 'barrel', 'plant', 'shelf'], n: 18, loot: 5, floor: '#6b5a44' },
    church:     { props: ['chair', 'chair', 'table', 'plant', 'shelf'], n: 14, loot: 5, floor: '#5a5f7a' },
    museum:     { props: ['table', 'plant', 'locker', 'sign', 'chair'], n: 18, loot: 6, floor: '#5d5c6b' },
    barracks:   { props: ['bed', 'locker', 'ammoBox', 'chair', 'shelf'], n: 20, loot: 6, floor: '#4e5666' },
    armory:     { props: ['locker', 'ammoBox', 'ammoBox', 'crate', 'shelf'], n: 14, loot: 8, floor: '#4a5260' },
    workshop:   { props: ['tyre', 'ammoBox', 'pallet', 'barrel', 'locker'], n: 20, loot: 7, floor: '#4b4f5a' },
    vault:      { props: ['locker', 'locker', 'ammoBox', 'crate'], n: 12, loot: 8, floor: '#4b4f60' },
    subway:     { props: ['chair', 'sign', 'rubble', 'crate', 'locker'], n: 16, loot: 7, floor: '#4a5260' },
    'command-center': { props: ['desk', 'chair', 'locker', 'ammoBox', 'table'], n: 18, loot: 8, floor: '#4c5164' },
    'power-plant': { props: ['barrel', 'ammoBox', 'pallet', 'rubble', 'desk'], n: 20, loot: 6, floor: '#4a5260' },
    'gas-station': { props: ['barrel', 'tyre', 'shelf', 'desk', 'crate'], n: 10, loot: 4, floor: '#5a5646' },
    mine:       { props: ['rock', 'rubble', 'pallet', 'barrel', 'crate'], n: 12, loot: 5, floor: '#5d5852' },
    vault:      { props: ['locker', 'locker', 'ammoBox', 'crate'], n: 10, loot: 9, floor: '#4b4f60' },
    subway:     { props: ['chair', 'sign', 'rubble', 'crate', 'locker'], n: 14, loot: 6, floor: '#4a5260' },
    'command-center': { props: ['desk', 'chair', 'locker', 'ammoBox', 'table'], n: 18, loot: 7, floor: '#4c5164' },
    workshop:   { props: ['tyre', 'ammoBox', 'pallet', 'barrel', 'locker'], n: 18, loot: 6, floor: '#4b4f5a' },
    dock:       { props: ['crate', 'pallet', 'barrel', 'container', 'tyre'], n: 16, loot: 6, floor: '#5a5646' },
    fortress:   { props: ['ammoBox', 'sandpile', 'locker', 'crate'], n: 10, loot: 7, floor: '#545d66' },
    arena:      { props: ['chair', 'chair', 'crate', 'barrel', 'sign'], n: 16, loot: 5, floor: '#5a5f6b' },
    /* Buildings whose interiors are now proper rooms, and the ones that never
       had a furniture list at all — a hospital and a prison were being drawn
       as empty shells with no floor, because `floor` came from this table and
       neither had an entry in it. */
    hospital:   { props: ['bed', 'bed', 'shelf', 'locker', 'chair', 'desk'], n: 34, loot: 0, floor: '#c8d4d2' },
    prison:     { props: ['bed', 'locker', 'toilet', 'desk', 'rubble'], n: 36, loot: 0, floor: '#767c84' },
    bank:       { props: ['desk', 'chair', 'locker', 'plant', 'table'], n: 22, loot: 8, floor: '#a89b7e' },
    'radio-tower': { props: ['desk', 'ammoBox', 'locker', 'rubble', 'chair'], n: 12, loot: 5, floor: '#4c5058' },
    'bridge-fort': { props: ['sandpile', 'ammoBox', 'crate', 'barrel'], n: 14, loot: 6, floor: '#5f5a52' },
    clinic:     { props: ['bed', 'shelf', 'locker', 'chair', 'desk'], n: 16, loot: 0, floor: '#c4d0cd' },
    library:    { props: ['shelf', 'shelf', 'desk', 'chair', 'table', 'plant'], n: 32, loot: 0, floor: '#9c8a6d' },
    garage:     { props: ['tyre', 'tyre', 'barrel', 'ammoBox', 'pallet'], n: 26, loot: 0, floor: '#4f545c' },
    'obj-relay':    { props: ['desk', 'locker', 'ammoBox', 'crate', 'shelf'], n: 18, loot: 0, floor: '#4a5260' },
    'obj-refinery': { props: ['barrel', 'pallet', 'crate', 'tyre', 'shelf'], n: 24, loot: 0, floor: '#544e46' },
    'obj-citadel':  { props: ['ammoBox', 'locker', 'crate', 'shelf', 'barrel'], n: 22, loot: 0, floor: '#4c4a52' },
    'bunker-complex': { props: ['ammoBox', 'crate', 'locker', 'barrel'], n: 14, loot: 0, floor: '#3e4147' },
    watermill:  { props: ['pallet', 'barrel', 'shelf', 'crate', 'rubble'], n: 20, loot: 0, floor: '#6f6350' },
    /* The table's buildings. `loot` is ignored for these — their rooms say
       exactly what they hold — but they still want furniture and a floor. */
    resort:     { props: ['bed', 'table', 'chair', 'plant', 'toilet', 'shelf'], n: 54, loot: 0, floor: '#6b5747' },
    airfield:   { props: ['cone', 'crate', 'pallet', 'tyre', 'desk', 'chair'], n: 40, loot: 0, floor: '#4f5560' },
    harbor:     { props: ['container', 'crate', 'pallet', 'barrel', 'tyre'], n: 46, loot: 0, floor: '#4a5260' },
    campground: { props: ['tent', 'tent', 'bed', 'stump', 'bush', 'crate'], n: 34, loot: 0, floor: '#5c6446' },
    /* landmarks: much bigger footprints, so much more inside */
    factory:    { props: ['barrel', 'pallet', 'ammoBox', 'crate', 'tyre', 'rubble'], n: 46, loot: 12, floor: '#4a5260' },
    keep:       { props: ['table', 'chair', 'locker', 'ammoBox', 'rubble'], n: 40, loot: 11, floor: '#565b6b' },
    silos:      { props: ['barrel', 'barrel', 'pallet', 'crate'], n: 30, loot: 9, floor: '#5a5646' },
  };

  /* ---------------- rooms ----------------
     A building that declares rooms is stocked from the sub-building table
     instead of by the old "n crates at a random tier" rule. That is the
     difference between knowing a kitchen is worth three crates and finding
     out by walking in.

     Everything is placed inside the room's own rectangle, so the loot is
     where the room is rather than scattered through the footprint. */
  /* Somewhere inside this room a crate will fit. Random darts first, because
     scattered loot reads better than loot on a grid; a systematic sweep only
     as the fallback, so a room the table says holds five crates holds five
     crates even when it is a bathroom with furniture down one wall. */
  function freeSpotIn(r, inset, spot, taken) {
    /* Crates aren't obstacles until the map is finished, so the collision
       probe can't see the ones already put down — without `taken`, a room
       that falls back to the sweep drops its whole allocation on the first
       free cell and ten crates become one. */
    const clear = (x, y) => !genHits({ x: x - 14, y: y - 14, w: 28, h: 28 }, 4)
      && !taken.some(t => dist2(t.x, t.y, x, y) < 34 * 34);
    for (let tries = 0; tries < 30; tries++) {
      const p = spot();
      if (clear(p.x, p.y)) return p;
    }
    const step = 26;
    for (let y = r.y + inset; y <= r.y + r.h - inset; y += step) {
      for (let x = r.x + inset; x <= r.x + r.w - inset; x += step) {
        if (clear(x, y)) return { x, y };
      }
    }
    return null;      // genuinely no room in the room
  }

  /* ---------------- what goes in each kind of room ----------------
     A building's furniture used to be one prop list scattered across the
     whole footprint, so a bathroom could end up with a workbench in it and a
     bunk room with a toilet. Rooms know what they are, so they can be dressed
     as what they are — beds in bedrooms, stalls with tables, lockers in bunk
     rooms — and every room gets a light, which is what makes the interior
     lighting mean anything. */
  const ROOM_PROPS = {
    bedroom:     { props: ['bed', 'shelf', 'chair', 'plant'], n: 4, lamps: 1 },
    apartment:   { props: ['bed', 'table', 'chair', 'stove', 'shelf', 'plant'], n: 6, lamps: 1 },
    bathroom:    { props: ['toilet', 'shelf'], n: 2, lamps: 1 },
    washroom:    { props: ['toilet', 'shelf'], n: 5, lamps: 2 },
    kitchen:     { props: ['stove', 'table', 'shelf', 'chair'], n: 6, lamps: 1 },
    backKitchen: { props: ['stove', 'table', 'shelf', 'crate'], n: 8, lamps: 2 },
    dining:      { props: ['table', 'chair', 'chair', 'plant'], n: 9, lamps: 2 },
    diningLobby: { props: ['table', 'chair', 'chair', 'plant'], n: 12, lamps: 3 },
    lounge:      { props: ['chair', 'table', 'plant', 'shelf'], n: 7, lamps: 2 },
    lobby:       { props: ['chair', 'plant', 'desk', 'table'], n: 6, lamps: 2 },
    hall:        { props: ['plant'], n: 2, lamps: 3, strip: true },
    living:      { props: ['chair', 'chair', 'table', 'shelf', 'plant'], n: 7, lamps: 2 },
    foyer:       { props: ['plant', 'plant', 'chair', 'table'], n: 4, lamps: 2 },
    study:       { props: ['desk', 'chair', 'shelf', 'shelf', 'plant'], n: 6, lamps: 1 },
    pantry:      { props: ['shelf', 'crate', 'stove'], n: 4, lamps: 1 },
    opsRoom:     { props: ['table', 'chair', 'chair', 'desk', 'locker'], n: 8, lamps: 2 },
    briefing:    { props: ['chair', 'chair', 'chair', 'table', 'desk'], n: 10, lamps: 2 },
    mess:        { props: ['table', 'table', 'chair', 'chair', 'stove', 'shelf'], n: 12, lamps: 2 },
    radioRoom:   { props: ['desk', 'ammoBox', 'chair', 'locker'], n: 6, lamps: 2 },
    motorPool:   { props: ['tyre', 'barrel', 'ammoBox', 'pallet'], n: 8, lamps: 2 },
    watchPost:   { props: ['ammoBox', 'crate', 'chair'], n: 3, lamps: 1 },
    /* Lit end to end, because a passage you cannot see down is a passage
       nobody walks. Sparse otherwise — it is a route, not a room. */
    tunnel:      { props: ['crate', 'barrel', 'ammoBox'], n: 5, lamps: 5, strip: true },
    passage:     { props: ['crate', 'shelf', 'barrel'], n: 3, lamps: 2, strip: true },
    office:      { props: ['desk', 'chair', 'shelf', 'locker', 'plant'], n: 6, lamps: 1 },
    controlRoom: { props: ['desk', 'chair', 'ammoBox', 'locker'], n: 6, lamps: 2 },
    classroom:   { props: ['desk', 'chair', 'chair', 'shelf'], n: 8, lamps: 1 },
    staffRoom:   { props: ['table', 'chair', 'shelf', 'plant'], n: 5, lamps: 1 },
    ward:        { props: ['bed', 'shelf', 'chair'], n: 4, lamps: 1 },
    surgery:     { props: ['bed', 'locker', 'shelf'], n: 4, lamps: 2 },
    dispensary:  { props: ['shelf', 'locker', 'crate'], n: 6, lamps: 1 },
    bunkroom:    { props: ['bed', 'locker', 'chair'], n: 6, lamps: 1 },
    cell:        { props: ['bed', 'toilet'], n: 2, lamps: 1 },
    guardRoom:   { props: ['desk', 'chair', 'locker', 'ammoBox'], n: 5, lamps: 2 },
    armoury:     { props: ['locker', 'ammoBox', 'crate'], n: 7, lamps: 2 },
    stall:       { props: ['table', 'crate', 'shelf'], n: 4, lamps: 1 },
    storeroom:   { props: ['crate', 'pallet', 'shelf', 'barrel'], n: 7, lamps: 1 },
    workbay:     { props: ['ammoBox', 'pallet', 'tyre', 'barrel', 'crate'], n: 6, lamps: 1 },
    gym:         { props: ['crate', 'chair', 'plant'], n: 6, lamps: 2 },
    barn:        { props: ['crate', 'pallet', 'barrel', 'shelf'], n: 8, lamps: 1 },
    lodge:       { props: ['table', 'chair', 'shelf', 'plant'], n: 6, lamps: 1 },
    safe:        { props: ['locker', 'crate'], n: 3, lamps: 1 },
    strongroom:  { props: ['locker', 'ammoBox', 'crate'], n: 4, lamps: 1 },
    mainExhibit: { props: ['plant', 'table', 'crate'], n: 6, lamps: 3 },
    gunExhibit:  { props: ['locker', 'table', 'ammoBox'], n: 5, lamps: 2 },
    displayHall: { props: ['plant', 'table'], n: 5, lamps: 3 },
    tent:        { props: ['bed', 'crate'], n: 2, lamps: 0 },
    plane:       { props: ['chair', 'chair', 'crate'], n: 8, lamps: 1 },
  };

  /* Dress a room as what it is, and light it. */
  /* What a room holds is mostly decided by what kind of room it is — but a
     store room in a garage and a store room in a hospital are not the same
     store room. The building mixes a couple of its own signature props into
     every room, so the place still reads as itself once you are inside it.

     Only for the generic rooms. A bathroom is a bathroom wherever it is, and
     salting it with tyres because it happens to be in a workshop would be
     worse than the flat list it replaced. */
  /* Where each kind of thing belongs in a room, and what has to be put down
     before what. Beds, shelves, lockers, desks and stoves go against a wall;
     a toilet or a pot plant goes in a corner; a table sits in the middle with
     the chairs pulled up to it. */
  const PLACEMENT = {
    bed: 'wall', shelf: 'wall', locker: 'wall', desk: 'wall', stove: 'wall',
    toilet: 'corner', plant: 'corner', ammoBox: 'corner', barrel: 'corner',
    table: 'centre',
    chair: 'byTable',
    /* A light is on a wall or a ceiling. Dropping one in the middle of a
       corridor put a 44px obstacle in a 68px passage, which is a blocked
       hallway — the same mistake as a support post on the centreline. */
    lamp: 'wall', striplight: 'wall',
  };
  // tables and desks first, then wall furniture, then the chairs that go with them
  const rank = (kind) => (PLACEMENT[kind] === 'centre' ? 0
    : PLACEMENT[kind] === 'wall' ? 1
      : PLACEMENT[kind] === 'byTable' ? 3 : 2);

  const GENERIC_ROOMS = new Set([
    'storeroom', 'office', 'lobby', 'hall', 'workbay', 'guardRoom',
    'controlRoom', 'strongroom', 'safe', 'stall', 'gym',
  ]);

  /* Furniture you can go through. A locker, a cabinet, a desk and a shelf are
     the things a person would actually rifle through on the way past, so a
     share of them are made searchable — one quick roll on the furniture
     table. They are spawned as crates rather than as decor, which is what
     makes them work online for free: the room already arbitrates who opened
     which crate, so two players cannot both loot the same locker. */
  const SEARCHABLE = { locker: 0.75, shelf: 0.4, desk: 0.5, crate: 0.5, ammoBox: 0.6, barrel: 0.25 };

  /* What got put in each room, so the loot pass can stack against it. Keyed by
     the room object itself — rooms are generated fresh each map, so the map is
     cleared with the world rather than accumulating across generations. */
  let roomAnchors = new WeakMap();
  function anchorsFor(r) {
    let a = roomAnchors.get(r);
    if (!a) { a = []; roomAnchors.set(r, a); }
    return a;
  }

  function dressRoom(r, building, phase) {
    const conf = ROOM_PROPS[r.kind];
    if (!conf) return;
    const doFurniture = phase !== 'lights';
    const doLights = phase !== 'furniture';
    let props = conf.props;
    if (building && GENERIC_ROOMS.has(r.kind)) {
      const own = (FURNISH[building] || {}).props || [];
      // the building's first two are its signature; one copy each is enough
      // to flavour the room without drowning what the room is for
      props = props.concat(own.slice(0, 2));
    }
    // a cellar is pitch dark otherwise, and unlit loot is loot nobody finds
    const lamps = (conf.lamps || 0) + (r.basement ? 2 : 0);
    const inset = Math.min(20, r.w / 5, r.h / 5);
    const spot = () => ({
      x: rand(r.x + inset, r.x + r.w - inset),
      y: rand(r.y + inset, r.y + r.h - inset),
    });
    /* Furniture goes where furniture goes. Nobody puts a bed in the middle of
       a room at 43 degrees, and a room full of things at random angles is the
       single thing that most makes a generated interior read as generated.
       Each prop knows whether it belongs against a wall, tucked in a corner,
       out in the middle, or pulled up to a table, and everything is square to
       the room it is in. */
    const placed = [];
    const put = (kind, m) => {
      const how = PLACEMENT[kind] || 'free';
      const pad = m.r + 5;
      if (r.w < pad * 2.4 || r.h < pad * 2.4) return spot();      // too tight to be fussy
      if (how === 'wall') {
        /* Furniture of a kind lines up together. Lockers come in banks, shelves
           come in runs, and the second one goes next to the first rather than
           on the opposite wall — which is what a room full of individually
           wall-hugging props looked like: tidy, and arranged by nobody.

           So the first of a kind picks the wall, and the rest of that kind
           continue along it at a regular pitch. */
        const prev = placed.filter(q => q.kind === kind);
        const last = prev[prev.length - 1];
        if (last && last.side) {
          const pitch = m.r * 2 + 8;
          const next = { kind, side: last.side, rot: last.rot };
          if (last.side === 'n' || last.side === 's') {
            next.x = last.x + pitch; next.y = last.y;
            if (next.x < r.x + r.w - pad) return next;
          } else {
            next.x = last.x; next.y = last.y + pitch;
            if (next.y < r.y + r.h - pad) return next;
          }
          // ran out of wall — start a new bank on another one
        }
        const side = ['n', 's', 'w', 'e'][Math.floor(Math.random() * 4)];
        if (side === 'n') return { side, x: rand(r.x + pad, r.x + r.w * 0.6), y: r.y + pad, rot: 0 };
        if (side === 's') return { side, x: rand(r.x + pad, r.x + r.w * 0.6), y: r.y + r.h - pad, rot: Math.PI };
        if (side === 'w') return { side, x: r.x + pad, y: rand(r.y + pad, r.y + r.h * 0.6), rot: Math.PI / 2 };
        return { side, x: r.x + r.w - pad, y: rand(r.y + pad, r.y + r.h * 0.6), rot: -Math.PI / 2 };
      }
      if (how === 'corner') {
        const cx = Math.random() < 0.5 ? r.x + pad : r.x + r.w - pad;
        const cy = Math.random() < 0.5 ? r.y + pad : r.y + r.h - pad;
        return { x: cx, y: cy, rot: cy < r.y + r.h / 2 ? 0 : Math.PI };
      }
      if (how === 'centre') {
        return {
          x: r.x + r.w / 2 + rand(-r.w / 8, r.w / 8),
          y: r.y + r.h / 2 + rand(-r.h / 8, r.h / 8),
          rot: r.w >= r.h ? 0 : Math.PI / 2,
        };
      }
      if (how === 'byTable') {
        // a chair belongs at a table, on one of its four sides, facing it
        const t = placed.filter(q => q.kind === 'table' || q.kind === 'desk');
        if (t.length) {
          const at = t[Math.floor(Math.random() * t.length)];
          const tr = Sprites.META[at.kind].r;
          const a2 = Math.floor(Math.random() * 4) * (Math.PI / 2);
          return {
            x: at.x + Math.cos(a2) * (tr + m.r * 0.8),
            y: at.y + Math.sin(a2) * (tr + m.r * 0.8),
            rot: a2 + Math.PI,
          };
        }
        /* No table in here — a bedroom's chair isn't a dining chair. Put it
           against a wall rather than leaving it adrift in the middle. */
        const side = ['n', 's', 'w', 'e'][Math.floor(Math.random() * 4)];
        if (side === 'n') return { x: rand(r.x + pad, r.x + r.w - pad), y: r.y + pad, rot: Math.PI };
        if (side === 's') return { x: rand(r.x + pad, r.x + r.w - pad), y: r.y + r.h - pad, rot: 0 };
        if (side === 'w') return { x: r.x + pad, y: rand(r.y + pad, r.y + r.h - pad), rot: -Math.PI / 2 };
        return { x: r.x + r.w - pad, y: rand(r.y + pad, r.y + r.h - pad), rot: Math.PI / 2 };
      }
      const p = spot();
      p.rot = Math.round(Math.random() * 4) * (Math.PI / 2);   // still square to the room
      return p;
    };
    /* Tables before chairs, so the chairs have something to be pulled up to —
       and wall furniture comes in twos, so a room gets a bank of lockers and a
       run of shelving rather than one of each standing alone. Placing one of
       every kind in turn is what made the banking code above almost never
       fire: nothing was ever put down next to another of its own kind. */
    const order = [];
    for (const k of props.slice().sort((a, b) => rank(a) - rank(b))) {
      order.push(k);
      if (PLACEMENT[k] === 'wall') order.push(k);
    }
    /* How much furniture, scaled by how big the room actually is. The counts
       in ROOM_PROPS were written against the old even-thirds rooms; the floor
       plans that replaced them size a room by what it is for, so a briefing
       room is now several times the floor of a bathroom and both were getting
       the same handful of props. A big room with six things in it reads as
       empty, which is the opposite of the problem the table was tuned for. */
    const REF_AREA = 34000;               // px², about a modest bedroom
    const nProps = Math.round(conf.n * clamp((r.w * r.h) / REF_AREA, 0.7, 2.1));
    for (let i = 0; doFurniture && i < nProps; i++) {
      const kind = order[i % order.length];
      const m = Sprites.META[kind];
      if (!m) continue;
      for (let tries = 0; tries < 16; tries++) {
        const p = put(kind, m);
        if (p.x < r.x || p.y < r.y || p.x > r.x + r.w || p.y > r.y + r.h) continue;
        const box = { x: p.x - m.r * 0.7, y: p.y - m.r * 0.7, w: m.r * 1.4, h: m.r * 1.4 };
        if (genHits(box, 6)) continue;
        // `side` rides along so the next of this kind can continue the bank
        const item = { kind, x: p.x, y: p.y, rot: p.rot || 0, scale: 1, indoors: true, side: p.side };
        /* Some of it is worth going through. A searchable piece becomes a
           crate that draws as this furniture, so it is one object rather than
           a box parked on top of a locker. */
        if (Math.random() < (SEARCHABLE[kind] || 0)) {
          pendingIndoorCrates.push({
            x: p.x, y: p.y, tier: 'furniture', room: r.kind,
            look: kind, rot: p.rot || 0,
          });
        } else {
          decor.push(item);
        }
        placed.push(item);
        anchorsFor(r).push(item);
        break;
      }
    }
    /* Lights are obstacles rather than decor, because you can shoot them out
       and the lighting pass reads them off the obstacle list. */
    const lampKind = conf.strip ? 'striplight' : 'lamp';
    for (let i = 0; doLights && i < lamps; i++) {
      for (let tries = 0; tries < 16; tries++) {
        const p = put(lampKind, Sprites.META[lampKind]);
        const s2 = Structures.prop(lampKind, p.x, p.y, Sprites.META[lampKind].r * 2, 1);
        // a strip light runs along the wall it is fixed to, not across it
        s2.rot = p.rot || 0;
        if (genHits(s2, 6)) continue;
        s2.building = r.building;
        genAdd(s2); obstacles.push(s2);
        break;
      }
    }
  }

  /* A building's grade bends its rooms' loot. The room table says what kind
     of room it is; the grade says whether this is the bank's strongroom or a
     shack's. Rich buildings upgrade some crates and add a few; poor ones send
     some the other way — so where you are is worth as much as what you found. */
  const TIER_UP = { regular: 'silver', silver: 'gold', gold: 'gold' };
  const TIER_DOWN = { gold: 'silver', silver: 'regular', regular: 'regular' };
  function gradeTier(tier, grade) {
    const g = Structures.GRADE_LOOT[grade] || {};
    if (g.upgrade && Math.random() < g.upgrade) return TIER_UP[tier] || tier;
    if (g.downgrade && Math.random() < g.downgrade) return TIER_DOWN[tier] || tier;
    return tier;
  }

  function stockRooms(rooms, grade, building) {
    if (!rooms || !rooms.length) return;
    for (const r of rooms) {
      // a cellar is its own floor, and always needs its own light
      if (r.basement) basements.push({ x: r.x, y: r.y, w: r.w, h: r.h });
      // an upper floor is the same idea the other way up: its own enclosed
      // plane, but the brightest part of the building rather than the darkest
      if (r.upstairs) upperFloors.push({ x: r.x, y: r.y, w: r.w, h: r.h });
    }
    /* Furniture, then loot against it, then the lights.

       Loot used to go down first, on the open floor, because lamps are
       obstacles and dressing a room first meant they took the space the crates
       needed. That fixed the count and left the arrangement wrong: crates in
       the middle of the floor and the shelving round the edge, as if the two
       had nothing to do with each other. Nobody stacks supplies in the middle
       of a room — they go against the shelf, beside the lockers, under the
       workbench.

       So the furniture goes first (it is decor and blocks nothing), the loot
       is placed against it, and the lamps go last so they still cannot steal
       the floor. */
    for (const r of rooms) dressRoom(r, building, 'furniture');
    for (const r of rooms) {
      const spec = Structures.ROOM_LOOT[r.kind];
      if (!spec) continue;
      const inset = Math.min(22, r.w / 4, r.h / 4);
      /* Stack it against the furniture. Supplies go beside the shelving and
         under the bench, not marooned in the middle of the floor — so a spot
         is chosen next to a piece of furniture that is already in the room,
         on the side of it that faces into the room. Open floor is the
         fallback, not the rule. */
      const anchors = anchorsFor(r);
      const spot = () => {
        if (anchors.length && Math.random() < 0.8) {
          const a = anchors[Math.floor(Math.random() * anchors.length)];
          const m = Sprites.META[a.kind] || { r: 20 };
          const off = m.r + 19;
          // push away from the nearest wall, so the crate lands in the room
          const towardX = a.x < r.x + r.w / 2 ? 1 : -1;
          const towardY = a.y < r.y + r.h / 2 ? 1 : -1;
          const along = Math.random() < 0.5;
          const p = along
            ? { x: a.x + towardX * off, y: a.y + rand(-off * 0.4, off * 0.4) }
            : { x: a.x + rand(-off * 0.4, off * 0.4), y: a.y + towardY * off };
          if (p.x > r.x + 12 && p.x < r.x + r.w - 12 && p.y > r.y + 12 && p.y < r.y + r.h - 12) return p;
        }
        return {
          x: rand(r.x + inset, r.x + r.w - inset),
          y: rand(r.y + inset, r.y + r.h - inset),
        };
      };
      const taken = [];
      for (const [tier, count] of spec.crates || []) {
        for (let i = 0; i < count; i++) {
          /* Small rooms are tight — a bathroom is barely wider than the crate
             plus its clearance — so keep trying, and probe with the crate's
             own footprint rather than a padded one. Giving up quietly is how
             a room ends up holding less than the table says it does. */
          const p = freeSpotIn(r, inset, spot, taken);
          if (!p) continue;
          taken.push(p);
          /* A shipped container is the one room with a roll in it: fifteen of
             them, one gold. Everything else is exactly what the table says. */
          let t = gradeTier(tier, grade);
          if (spec.chance && Math.random() < spec.chance.odds) t = spec.chance.tier;
          pendingIndoorCrates.push({ x: p.x, y: p.y, tier: t, room: r.kind, needs: spec.needs });
        }
      }
      /* ...and a rich building has a bit more of it. One extra crate per
         room, some of the time, rather than a second full set. */
      const extra = (Structures.GRADE_LOOT[grade] || {}).extra || 0;
      if (extra > 0 && (spec.crates || []).length && Math.random() < extra) {
        const p = freeSpotIn(r, inset, spot, taken);
        if (p) {
          taken.push(p);
          pendingIndoorCrates.push({
            x: p.x, y: p.y, tier: gradeTier(spec.crates[0][0], grade),
            room: r.kind, needs: spec.needs,
          });
        }
      }
      for (const [vtype, count] of spec.vehicles || []) {
        for (let i = 0; i < count; i++) {
          const p = spot();
          pendingRoomVehicles.push({ x: p.x, y: p.y, vtype });
        }
      }
    }
    for (const r of rooms) dressRoom(r, building, 'lights');
  }
  let pendingRoomVehicles = [];
  /* The hulls this map was generated with, kept after they are placed so the
     room can be told about them (see netVehicles). */
  let parkedVehicles = [];

  /* Fill a building: furniture against the inside of the walls, loot in the
     middle where you have to commit to grabbing it. */
  /* ---------------- what's outside the door ----------------
     Buildings sat on bare grass, so every approach was open ground and the
     fight only started once you were through the doorway. A ring of clutter
     round the outside gives the approach some cover of its own — and it tells
     you what the building is before you go in: barrels and pallets at a
     depot, tyres at a garage, bushes and stumps round a farmhouse. */

  /* Clutter arranged rather than sprinkled. Random scatter round a perimeter
     reads as litter — it tells you a building is there and nothing else. Real
     yards are organised: things are stacked against a wall, piled in a corner,
     or set out either side of the door.

     Three arrangements, picked per wall:
       row      a line parallel to the wall, evenly spaced
       corner   a tight cluster at one end
       gate     a symmetrical pair flanking the entrance

     Everything still respects the body-width clearance, so none of these can
     build a pocket you get stuck in. */
  const CLUTTER_GAP = BODY_R * 2 + 8;
  /* Things that grew where they are, rather than being put there. These keep a
     random angle; everything man-made gets squared to the wall it is against. */
  const NATURAL_PROPS = new Set(['tree', 'palm', 'bush', 'rock', 'stump', 'rubble', 'sandpile']);

  /* `jitter` moves a prop along the line it belongs to, never across it.
     Scattering it on both axes was enough to stop a row of six looking like a
     row at all: the eye reads the straight edge, and fourteen pixels of wobble
     perpendicular to the wall is what turns a stack of crates against a shed
     into a handful of crates near a shed. Clusters, which are meant to look
     piled, pass `spread` instead. */
  function placeProp(kind, x, y, name, jitter, axis, spread) {
    const m = Sprites.META[kind];
    if (!m) return false;
    const along = jitter ? rand(-jitter, jitter) : 0;
    const px = x + (axis === 'v' ? (spread ? rand(-spread, spread) : 0) : along);
    const py = y + (axis === 'v' ? along : (spread ? rand(-spread, spread) : 0));
    if (!Terrain.isSpawnable(terrain, px, py)) return false;
    /* Never inside a building — anyone's. A yard prop only has to miss the
       *walls* to be legal, and the inside of a neighbour is empty space, so a
       crate could land in someone else's hallway and pinch it below a body's
       width. Measured: one base corridor narrowed to 29px that way. */
    if (insideAnyBuilding(px, py, 8)) return false;
    const s2 = Structures.prop(kind, px, py, m.r * 2, 0.85 + Math.random() * 0.35);
    /* Square it to the wall it is stacked against. Crates, pallets, containers
       and tyres were being drawn at a fully random angle, so even a row placed
       on a dead straight line read as a heap — the positions were aligned and
       nothing else was. Trees, bushes and rubble keep their random angle,
       because a bush lined up with a wall looks stranger than one that isn't. */
    if (!NATURAL_PROPS.has(kind)) {
      s2.rot = (axis === 'v' ? Math.PI / 2 : 0) + (Math.random() < 0.5 ? 0 : Math.PI);
    }
    if (genHits(s2, CLUTTER_GAP)) return false;
    s2.building = name;
    genAdd(s2); obstacles.push(s2);
    return true;
  }

  /* Is this spot inside a building? The outdoor scatter passes only ever
     tested "does this overlap existing geometry", and the inside of a building
     is empty space — so loose cover, scenery and a neighbour's yard props
     could all legally land in somebody's hallway. Measured, that narrowed a
     base corridor to 24px, which is narrower than a body: the building was
     impassable through its own spine. */
  const insideAnyBuilding = (x, y, pad) => {
    const q = pad || 0;
    for (const b of buildings) {
      if (x > b.x - q && x < b.x + b.w + q && y > b.y - q && y < b.y + b.h + q) return true;
    }
    return false;
  };

  function clutterAround(name, bb) {
    // what this particular building keeps outside its door — see Structures.DECOR
    const kinds = Structures.decorFor(name);
    const pick = () => kinds[Math.floor(Math.random() * kinds.length)];
    // the signature prop leads each arrangement, so a yard reads as one idea
    const lead = kinds[0];

    const sides = [
      { horiz: true, y: bb.y - 62, x0: bb.x, x1: bb.x + bb.w },
      { horiz: true, y: bb.y + bb.h + 62, x0: bb.x, x1: bb.x + bb.w },
      { horiz: false, x: bb.x - 62, y0: bb.y, y1: bb.y + bb.h },
      { horiz: false, x: bb.x + bb.w + 62, y0: bb.y, y1: bb.y + bb.h },
    ];

    for (const side of sides) {
      const span = side.horiz ? side.x1 - side.x0 : side.y1 - side.y0;
      if (span < 140) continue;
      /* A long frontage gets two arrangements rather than one. A single row of
         six along a 1500px harbor wall left most of it bare, because the
         number of props was fixed by the arrangement and not by how much wall
         there was to dress. */
      const passes = span > 620 ? 2 : 1;
      for (let pass = 0; pass < passes; pass++) {
      const layout = Math.random();
      const at = (t) => (side.horiz
        ? { x: side.x0 + span * t, y: side.y }
        : { x: side.x, y: side.y0 + span * t });

      // which way this row runs, so jitter can be kept along it
      const axis = side.horiz ? 'h' : 'v';
      if (layout < 0.45) {
        // a row stacked along the wall, evenly spaced and on one line
        const n = Math.max(2, Math.min(6, Math.floor(span / 150)));
        for (let i = 0; i < n; i++) {
          const p2 = at((i + 0.5) / n);
          placeProp(i === 0 ? lead : pick(), p2.x, p2.y, name, 12, axis, 0);
        }
      } else if (layout < 0.75) {
        /* A stack piled into one end. Tight rather than spread, but still on
           the wall's line: things stacked in a yard are stacked *against*
           something, and letting them wander off the line perpendicular to
           the wall was the last thing out here that read as scattered. */
        const end = Math.random() < 0.5 ? 0.12 : 0.88;
        const p2 = at(end);
        const pitch = 34;
        for (let i = 0; i < 3; i++) {
          const off = (i - 1) * pitch;
          placeProp(i === 0 ? lead : pick(),
            p2.x + (axis === 'h' ? off : 0), p2.y + (axis === 'v' ? off : 0),
            name, 10, axis, 0);
        }
      } else {
        // a matched pair either side of the middle, like a gateway
        const a2 = at(0.36), b2 = at(0.64);
        placeProp(lead, a2.x, a2.y, name, 8, axis, 0);
        placeProp(lead, b2.x, b2.y, name, 8, axis, 0);
      }
      }
    }
    /* And a screen of planting at one corner: somewhere to lie up that is not
       a wall, so approaching a building is not purely a question of crossing
       open ground.

       Deliberately not tagged as this building's decor. A yard prop is
       supposed to say what the building is — barrels at a depot, tyres at a
       garage — and planting says nothing about any of them, so booking it
       against the building's own list only made every building look like it
       had strays in the yard. */
    const corner = Math.floor(Math.random() * 4);
    const cx = corner % 2 ? bb.x + bb.w + 86 : bb.x - 86;
    const cy = corner < 2 ? bb.y - 86 : bb.y + bb.h + 86;
    for (let i = 0; i < 3; i++) {
      placeProp('bush', cx + rand(-70, 70), cy + rand(-70, 70), null, 0, 'h', 0);
    }
  }

  let pendingYards = [];
  function layOutYards() {
    for (const y of pendingYards) clutterAround(y.name, y.bb);
    pendingYards = [];
  }

  function furnish(name, bb, rooms) {
    /* Rooms replace the loot roll entirely — a resort's ten bedrooms are ten
       crates because the table says so, not because the footprint is big. */
    if (rooms && rooms.length) stockRooms(rooms, Structures.purposeOf(name).grade, name);
    /* The yard waits until every building has its ground. A building's clutter
       sits up to ~100px outside its walls and goes into the same collision grid
       the placer reads, so furnishing as we went meant each finished building
       pushed the next one further away — with bigger buildings that was enough
       to cost the map a museum outright. Nothing outside a building should
       outrank a building. Deferring also makes the yards tidier: by the time
       they are laid out, every neighbour exists, so a prop can no longer be
       dropped where a wall is about to appear. */
    pendingYards.push({ name, bb });
    const conf = FURNISH[name];
    if (!conf) return;
    const inset = 46;
    const spot = () => ({
      x: rand(bb.x + inset, bb.x + bb.w - inset),
      y: rand(bb.y + inset, bb.y + bb.h - inset),
    });
    /* Only for buildings with no rooms of their own. A building that declares
       rooms has already been furnished a room at a time, each piece against
       the wall or corner it belongs to — scattering another two dozen props
       across the same floor on top of that put furniture in doorways and
       undid the arrangement. */
    for (let i = 0; i < (rooms && rooms.length ? 0 : conf.n); i++) {
      for (let tries = 0; tries < 20; tries++) {
        const p = spot();
        const kind = conf.props[Math.floor(Math.random() * conf.props.length)];
        const m = Sprites.META[kind];
        if (!m) break;
        const box = { x: p.x - m.r, y: p.y - m.r, w: m.r * 2, h: m.r * 2 };
        if (genHits(box, 8)) continue;
        if (decor.some(d => dist2(d.x, d.y, p.x, p.y) < 46 * 46)) continue;
        // square to the building, even with no room to be square to
        decor.push({ kind, x: p.x, y: p.y, rot: Math.round(Math.random() * 4) * (Math.PI / 2), scale: 1, indoors: true });
        break;
      }
    }
    // loot crates: the reason to go inside. Skipped for buildings whose rooms
    // already say precisely what they hold.
    for (let i = 0; i < (rooms && rooms.length ? 0 : conf.loot); i++) {
      for (let tries = 0; tries < 20; tries++) {
        const p = spot();
        const box = { x: p.x - 20, y: p.y - 20, w: 40, h: 40 };
        if (genHits(box, 10)) continue;
        // Loot gets better the harder the building is to hold: landmarks are
        // where the gold crates live, which is what makes them worth taking.
        /* Buildings with no room manifest still roll their loot, but the
           grade decides the odds rather than a hardcoded list of three
           landmark names. */
        const grade = Structures.purposeOf(name).grade;
        const roll = Math.random();
        const tier = grade === 'rich'
          ? (roll < 0.42 ? 'gold' : roll < 0.78 ? 'silver' : 'regular')
          : grade === 'poor'
            ? (roll < 0.05 ? 'gold' : roll < 0.28 ? 'silver' : 'regular')
            : (roll < 0.18 ? 'gold' : roll < 0.52 ? 'silver' : 'regular');
        pendingIndoorCrates.push({ x: p.x, y: p.y, tier });
        break;
      }
    }
  }
  let pendingIndoorCrates = [];

  /* is anyone inside this building? the roof lifts when they are */
  const insideBuilding = (b, a) =>
    a && a.alive && a.x > b.x && a.x < b.x + b.w && a.y > b.y && a.y < b.y + b.h;

  /* ---------------- what the building you're in does for you ----------------
     A few buildings are worth holding rather than just looting: a hospital
     treats you, an armoury refills you, a radio tower shows you where everyone
     is. See Structures.BUILDING_EFFECTS.

     Tracked as "which building am I in", recomputed once a frame rather than
     per effect, and announced once on the way in so you know it is happening. */
  let hereBuilding = null, hereEffect = null, resupplyT = 0;

  function updateBuildingEffect(dt) {
    if (!player || !player.alive) { hereBuilding = null; hereEffect = null; return; }
    let found = null;
    for (const b of buildings) { if (insideBuilding(b, player)) { found = b; break; } }
    if (found !== hereBuilding) {
      hereBuilding = found;
      hereEffect = found ? Structures.effectOf(found.name) : null;
      resupplyT = 0;
      if (hereEffect) { hudMsg(hereEffect.label); SFX.click(); }
    }
    const e = hereEffect;
    if (!e) return;
    if (e.heal && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + e.heal * dt);
      if (Math.random() < dt * 2) spawnFx(player.x, player.y, '#8ff0c0', 1);
    }
    if (e.adren) player.adrenaline = Math.min(Combat.ADREN_MAX, player.adrenaline + e.adren * dt);
    if (e.resupply) {
      resupplyT += dt;
      if (resupplyT >= e.resupply) {
        resupplyT = 0;
        if (player.ammo < player.weapon.mag) {
          player.ammo = player.weapon.mag; updateWeaponHud(); hudMsg('Magazine topped up');
        } else {
          const kit = Items.CONSUMABLES[player.cls.consumable];
          if (kit) addItem(kit.cat, player.cls.consumable, 1);
        }
      }
    }
  }
  /* the multipliers other systems ask about */
  const hereDamageMult = () => (hereEffect && hereEffect.damage) || 1;
  const hereToolRate = () => (hereEffect && hereEffect.toolRate) || 1;
  const hereSpeed = () => (hereEffect && hereEffect.speed) || 1;
  const hereReveal = () => (hereEffect && hereEffect.reveal) || 0;

  /* Scatter buildings across the island: valid terrain, clear of each other,
     clear of the objectives, and never sliced by the river. */
  /* ---------------- the buildings a map must have ----------------
     The design table gives counts, not odds: five houses, one mansion, one
     resort, and so on. Rolling for them means a map that happens to contain
     no mansion and therefore no gold crate behind a reinforced door, which
     makes the loot table a suggestion rather than a plan.

     These are placed after the landmarks and before the procedural fill, so
     they get the pick of the open ground, and each gets a generous number of
     attempts because the big ones (a harbor is 1700px across) need somewhere
     that will actually take them. */
  /* ---------------- a base for each squad ----------------
     Everyone used to spawn on open grass, so the first thirty seconds of a
     match were four squads standing in a field. Each team now lands at a
     fortified base of their own: somewhere to gear up, a wall to put your back
     to, and a resupply point that is yours because you started next to it.

     Placed first, before the landmarks, because their positions are fixed by
     the spawn ring and everything else can move out of the way. */
  function placeTeamBases() {
    for (let t = 0; t < nTeams; t++) {
      const sp = spawnPoint(t);
      let done = false;
      for (let tries = 0; tries < 200 && !done; tries++) {
        // spiral outward from the spawn until the base fits
        const d = tries * 9;
        const a2 = tries * 0.7;
        const x = clamp(sp.x + Math.cos(a2) * d - 330, Terrain.BEACH_INSET, MAP_W - Terrain.BEACH_INSET);
        const y = clamp(sp.y + Math.sin(a2) * d - 220, Terrain.BEACH_INSET, MAP_H - Terrain.BEACH_INSET);
        const parts = placeBuilding('base', x, y);
        if (!parts.length) continue;
        const bb = boundsOf(parts);
        const pid = 'tb' + t;
        for (const part of parts) { part.placement = pid; part.teamBase = t; genAdd(part); }
        obstacles.push(...parts);
        invalidateRects();
        const st = Structures.shadeStyle(Structures.styleOf('base'), Math.random);
        const rec = { name: 'base', placement: pid, ...bb, style: st, floor: st.floor, teamBase: t, rooms: parts.rooms };
        buildings.push(rec);
        requiredPlacements.push(bb);
        furnish('base', bb, parts.rooms);
        done = true;
      }
    }
  }

  function placeRequiredBuildings() {
    /* Biggest first, for the same reason landmarks go before everything else:
       a harbor is fifteen hundred pixels across and needs an unbroken stretch
       of ground with no river through it. Placing the five houses first ate
       exactly the open space it needed, and the harbor — the one building
       holding thirty containers and both warehouses — never made it onto a
       single map. */
    const footprint = (name) => {
      const parts = Structures.BUILDINGS[name](0, 0);
      const bb = boundsOf(parts);
      return bb.w * bb.h;
    };
    const order = Structures.ROOM_BUILDINGS
      .filter(([name]) => Structures.BUILDINGS[name])
      .map(([name, count]) => [name, count, footprint(name)])
      .sort((a, b) => b[2] - a[2]);
    for (const [name, count] of order) {
      if (!Structures.BUILDINGS[name]) continue;
      let missed = 0;
      for (let made = 0; made < count;) {
        let placedOne = false;
        for (let tries = 0; tries < 400 && !placedOne; tries++) {
          /* The ring is where this building *wants* to be, not a rule it must
             obey. A harbor is fifteen hundred pixels across and its band is a
             narrow annulus with landmarks and four team bases already in it —
             holding it to that band meant it simply never got placed, and the
             map lost a required building and seven room types with it. Try the
             ring first, then take anywhere that will have it. */
          /* Both the position and the elbow room get less fussy as the budget
             runs down. Holding out for a 120px margin is right on an empty map
             and hopeless on a full one: measured over a whole required pass,
             97% of candidates were being turned down for clearance alone, and
             the museum — 813px across, on a map with room for it — used all
             900 of its attempts without once being offered a spot it would
             accept. First choice is still a generous gap in its own ring;
             last resort is a building that is merely close to its neighbour,
             which beats a map with no museum on it. */
          const spot = tries < 150 ? ringSpot(name) : fittingSpot(name);
          const pad = tries < 150 ? 120 : tries < 280 ? 84 : 54;
          const parts = placeBuilding(name, spot.x, spot.y, pad);
          if (!parts.length) { tally(name, lastReject); continue; }
          const bb = boundsOf(parts);
          if (requiredPlacements.some(b => padOverlap(bb, b, Math.min(104, pad)))) { tally(name, 'spacing'); continue; }
          if (landmarks.some(l => padOverlap(bb, l, tries < 150 ? 200 : 120))) { tally(name, 'landmark'); continue; }
          tally(name, 'placed');
          requiredPlacements.push(bb);
          const pid = 'r' + requiredPlacements.length;
          for (const part of parts) { part.placement = pid; genAdd(part); }
          obstacles.push(...parts);
          invalidateRects();
          const conf = FURNISH[name];
          const st = Structures.shadeStyle(Structures.styleOf(name), Math.random);
      buildings.push({ name, placement: pid, ...bb, style: st, floor: st.floor, rooms: parts.rooms });
          furnish(name, bb, parts.rooms);
          placedOne = true;
        }
        /* Don't give up on the rest because one didn't fit. Each instance gets
           its own budget of attempts — abandoning the remaining four houses
           because the third couldn't find a gap is how a map ends up short of
           the buildings it is required to have. */
        made++;
        if (!placedOne) missed++;
      }
      /* Anything that still didn't fit gets one more pass with no ring and
         tighter spacing — a required building is required. */
      for (let i = 0; i < missed; i++) {
        let done = false;
        for (let tries = 0; tries < 500 && !done; tries++) {
          const spot = fittingSpot(name);
          const parts = placeBuilding(name, spot.x, spot.y, tries < 250 ? 80 : 34);
          if (!parts.length) { tally(name, lastReject); continue; }
          const bb = boundsOf(parts);
          if (requiredPlacements.some(b => padOverlap(bb, b, tries < 250 ? 70 : 30))) { tally(name, 'spacing'); continue; }
          if (landmarks.some(l => padOverlap(bb, l, 120))) { tally(name, 'landmark'); continue; }
          done = commitRequired(name, parts, bb);
        }
        /* Last resort: walk the map instead of sampling it. Throwing more darts
           has diminishing returns on a crowded map — a thousand random spots
           can all miss the one gap the museum would have fitted in, which is
           exactly how a seed here and there ended up with no museum on it. A
           sweep either finds that gap or proves there wasn't one. */
        if (!done) done = sweepFor(name);
        if (!done) console.warn('[worldgen] no room for required building:', name);
      }
    }
  }
  /* add a placed required building to the world */
  function commitRequired(name, parts, bb) {
    tally(name, 'placed');
    requiredPlacements.push(bb);
    const pid = 'r' + requiredPlacements.length;
    for (const part of parts) { part.placement = pid; genAdd(part); }
    obstacles.push(...parts);
    invalidateRects();
    const st = Structures.shadeStyle(Structures.styleOf(name), Math.random);
    buildings.push({ name, placement: pid, ...bb, style: st, floor: st.floor, rooms: parts.rooms });
    furnish(name, bb, parts.rooms);
    return true;
  }

  /* Walk the map on a coarse lattice and take the first spot that will hold
     this building, easing the clearance on each sweep. Deterministic: if a
     gap exists at the loosest setting, this finds it. */
  const SWEEP_STEP = 110;
  function sweepFor(name) {
    const sz = placedSize(name);
    const lo = Terrain.BEACH_INSET;
    for (const pad of [60, 34, 16]) {
      // start the lattice at a different offset each sweep so a building that
      // just missed on a cell boundary gets a second look half a cell over
      const jx = (pad % 3) * (SWEEP_STEP / 3), jy = (pad % 2) * (SWEEP_STEP / 2);
      for (let y = lo + jy; y < MAP_H - lo - sz.h; y += SWEEP_STEP) {
        for (let x = lo + jx; x < MAP_W - lo - sz.w; x += SWEEP_STEP) {
          const parts = placeBuilding(name, x, y, pad);
          if (!parts.length) continue;
          const bb = boundsOf(parts);
          if (requiredPlacements.some(b => padOverlap(bb, b, Math.min(pad, 30)))) continue;
          if (landmarks.some(l => padOverlap(bb, l, Math.min(pad, 60)))) continue;
          return commitRequired(name, parts, bb);
        }
      }
    }
    return false;
  }

  let requiredPlacements = [];
  /* why each required building's candidate spots were turned down, kept from
     the last map build so a short map can be diagnosed instead of guessed at */
  let requiredTally = {};
  function tally(name, reason) {
    const t2 = requiredTally[name] || (requiredTally[name] = { offMap: 0, terrain: 0, occupied: 0, spacing: 0, landmark: 0, placed: 0 });
    t2[reason] = (t2[reason] || 0) + 1;
  }

  /* How big this building actually lands, so a position can be chosen with
     room for it. Blueprints grow from their origin rightwards and downwards,
     so sampling an origin uniformly across the map means every spot within a
     footprint's width of the right or bottom edge is a guaranteed rejection —
     a dead band that got wider as the buildings did, and quietly ate most of
     the attempt budget the required pass had to work with. */
  const sizeCache = {};
  function placedSize(name) {
    if (!sizeCache[name]) {
      const parts = Structures.place(name, 0, 0);
      sizeCache[name] = parts.length ? boundsOf(parts) : { w: 0, h: 0 };
    }
    return sizeCache[name];
  }

  /* a uniform spot that leaves room for the whole building */
  function fittingSpot(name) {
    const sz = placedSize(name);
    const lo = Terrain.BEACH_INSET;
    return {
      x: rand(lo, Math.max(lo + 1, MAP_W - lo - sz.w)),
      y: rand(lo, Math.max(lo + 1, MAP_H - lo - sz.h)),
    };
  }

  /* Somewhere inside the band this building belongs in. The angle is free —
     only the distance from the middle is constrained — so a ring reads as a
     belt of similar places rather than a circle drawn on the map. */
  function ringSpot(name) {
    const band = Structures.RINGS[Structures.purposeOf(name).ring] || Structures.RINGS.mid;
    const cx = MAP_W / 2, cy = MAP_H / 2;
    const maxR = Math.min(cx, cy) - Terrain.BEACH_INSET;
    const r = (band[0] + Math.random() * (band[1] - band[0])) * maxR;
    const a2 = Math.random() * Math.PI * 2;
    const sz = placedSize(name);
    return {
      x: clamp(cx + Math.cos(a2) * r, Terrain.BEACH_INSET, Math.max(Terrain.BEACH_INSET, MAP_W - Terrain.BEACH_INSET - sz.w)),
      y: clamp(cy + Math.sin(a2) * r, Terrain.BEACH_INSET, Math.max(Terrain.BEACH_INSET, MAP_H - Terrain.BEACH_INSET - sz.h)),
    };
  }

  function placeBuildingsProcedural(count) {
    const placed = [];
    const seen = {};
    /* Bigger buildings mean more candidate positions are rejected, so the
       same budget of attempts finished short of `count` and the map lost the
       kinds that hadn't come up yet. */
    let guard = count * 95;
    while (placed.length < count && guard-- > 0) {
      // Early on, favour a type that hasn't appeared yet. Pure weighted rolling
      // leaves a small map with only three or four kinds on it; this guarantees
      // variety without flattening the weights once every type is represented.
      const missing = BUILDING_MIX.filter(m => !seen[m[0]]);
      const missingCategoryLists = Object.values(BUILDING_CATEGORY_LIST)
        .map(names => names.filter(name => !seen[name]))
        .filter(list => list.length);
      let categoryName = null;
      if (missingCategoryLists.length && placed.length < count * 0.6) {
        const choice = missingCategoryLists[Math.floor(Math.random() * missingCategoryLists.length)];
        categoryName = choice[Math.floor(Math.random() * choice.length)];
      }
      const name = (missing.length && placed.length < count * 0.7)
        ? missing[Math.floor(Math.random() * missing.length)][0]
        : categoryName || rollMix(BUILDING_MIX);
      // most of the time in its own band; occasionally anywhere, so a crowded
      // ring doesn't starve the map of that kind of building entirely
      /* Breathing room, in px of empty ground between two footprints — and it
         relaxes as the budget runs down, exactly as the required pass does.
         Held at a flat 112 this pass was placing about three buildings a map:
         the required buildings, the team bases and the landmarks take their
         ground first, and what is left of a map is gaps rather than fields.
         Three placements is too few rolls for the mix to mean anything, and
         the rarer entries in it — the garage, the workshop, the filling
         station — went whole runs of maps without ever being built. */
      const easing = guard < count * 20 ? (guard < count * 8 ? 2 : 1) : 0;
      const pad = [120, 78, 48][easing];
      const gap = [112, 74, 46][easing];
      const spot = (Math.random() < 0.82 && !easing) ? ringSpot(name) : fittingSpot(name);
      const parts = placeBuilding(name, spot.x, spot.y, pad);
      if (!parts.length) continue;
      const bb = boundsOf(parts);
      if (placed.some(b => padOverlap(bb, b, gap))) continue;
      if (requiredPlacements.some(b => padOverlap(bb, b, gap))) continue;
      if (landmarks.some(l => padOverlap(bb, l, easing ? 120 : 200))) continue;
      placed.push(bb);
      seen[name] = (seen[name] || 0) + 1;
      const pid = 'p' + placed.length;
      for (const part of parts) { part.placement = pid; genAdd(part); }
      obstacles.push(...parts);
      invalidateRects();
      const conf = FURNISH[name];
      const st = Structures.shadeStyle(Structures.styleOf(name), Math.random);
      buildings.push({ name, placement: pid, ...bb, style: st, floor: st.floor, rooms: parts.rooms });
      furnish(name, bb, parts.rooms);
    }
  }

  /* ---------------- cover, laid out rather than dropped ----------------
     Loose cover used to be one run put down at a random point, on a random
     axis, at a random length. Barbed wire came off worst: wire is a fence —
     a continuous line strung along an approach, doing a job — and what the
     map actually had was a field of disconnected stubs pointing every way,
     none of them lining up with each other or with anything they were
     supposedly protecting.

     Cover now goes down as runs of segments laid end to end, and every run
     starts on a shared grid, so two parallel lines are actually parallel
     rather than eleven pixels out. Wire is strung along a building's frontage
     at a fixed standoff, which is where wire belongs and also what makes it
     read as a perimeter instead of as scenery. */
  const COVER_GRID = 20;          // px; runs start on it, so parallel lines line up
  const WIRE_STANDOFF = 104;      // px of open ground between a wall and its wire
  const snapTo = (v) => Math.round(v / COVER_GRID) * COVER_GRID;

  /* Lay `segs` segments end to end from (x, y). Stops at the first one that
     will not fit, so a run is always continuous — a fence with a hole in the
     middle of it is not a fence. */
  function coverRun(type, x, y, axis, segs, lenM, th) {
    const out = [];
    let cx = snapTo(x), cy = snapTo(y);
    for (let i = 0; i < segs; i++) {
      const s = Structures.seg(type, cx, cy, lenM, axis, th);
      if (s.x < 20 || s.y < 20 || s.x + s.w > MAP_W - 20 || s.y + s.h > MAP_H - 20) break;
      if (!Terrain.isSpawnable(terrain, s.x + s.w / 2, s.y + s.h / 2)) break;
      if (insideAnyBuilding(s.x + s.w / 2, s.y + s.h / 2, 12)) break;
      if (genHits(s, 22)) break;
      out.push(s);
      if (axis === 'h') cx += s.w; else cy += s.h;
    }
    return out;
  }
  const commitRun = (run) => { for (const s of run) { obstacles.push(s); genAdd(s); } };

  /* A wire fence along one face of a building, parallel to the wall and the
     length of it. */
  function wireAlong(b) {
    const LEN_M = 4;                                   // 160px per segment
    const per = LEN_M * Structures.PX_PER_M;
    const side = ['n', 's', 'w', 'e'][Math.floor(Math.random() * 4)];
    if (side === 'n' || side === 's') {
      const y = snapTo(side === 'n' ? b.y - WIRE_STANDOFF : b.y + b.h + WIRE_STANDOFF);
      return coverRun('wire', b.x - 30, y, 'h', Math.max(2, Math.round(b.w / per)), LEN_M, 0.4);
    }
    const x = snapTo(side === 'w' ? b.x - WIRE_STANDOFF : b.x + b.w + WIRE_STANDOFF);
    return coverRun('wire', x, b.y - 30, 'v', Math.max(2, Math.round(b.h / per)), LEN_M, 0.4);
  }

  function placeCover(count) {
    let guard = count * 30;
    let made = 0;
    /* Wire goes up first and against the buildings, because that is the only
       placement for it that means anything. The rest of the budget is spent
       on runs out in the open. */
    const fences = Math.round(count * 0.3);
    for (let i = 0; i < fences && buildings.length; i++) {
      const b = buildings[Math.floor(Math.random() * buildings.length)];
      const run = wireAlong(b);
      if (run.length < 2) continue;
      commitRun(run);
      made += run.length;
    }
    while (made < count && guard-- > 0) {
      const type = rollMix(COVER_MIX);
      const x = rand(Terrain.BEACH_INSET, MAP_W - Terrain.BEACH_INSET);
      const y = rand(Terrain.BEACH_INSET, MAP_H - Terrain.BEACH_INSET);
      if (!Terrain.isSpawnable(terrain, x, y)) continue;
      if (insideAnyBuilding(x, y, 12)) continue;      // cover belongs outside, not in a corridor
      const axis = Math.random() < 0.5 ? 'h' : 'v';
      const th = type === 'metal' ? 0.6 : type === 'wire' ? 0.4 : type === 'sandbag' ? 0.5 : 0.3;
      /* Two to four lengths in a line. A single stub is litter; a line is a
         thing to fight from one side of. */
      const segs = type === 'wire' ? 3 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 3);
      const run = coverRun(type, x, y, axis, segs, 3 + Math.random() * 2, th);
      if (!run.length) continue;
      commitRun(run);
      made += run.length;
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

  /* ---------------- woodland ----------------
     Trees scattered one at a time across the whole island give you a field
     with the occasional tree in it. Trees grow in stands, and a stand is worth
     far more than the same trees spread out: it is a piece of the map you can
     cross without being seen, with an edge that has to be watched.

     A grove is a loose cluster with a fringe of scrub around it, which is also
     how a real treeline looks from above — dense in the middle, ragged where
     it meets the grass. */
  function placeGroves(count) {
    /* Keep trying for a spot. A grove wants clear ground, and asking for a
       point 200px from any building on a map with thirty-odd of them rejects
       almost everywhere — the first version of this planted twenty-three trees
       across the whole island because nearly every centre it rolled was inside
       somebody's keep-out. Fewer demands, more attempts. */
    let guard = count * 12, made = 0;
    while (made < count && guard-- > 0) {
      const cx = rand(Terrain.BEACH_INSET, MAP_W - Terrain.BEACH_INSET);
      const cy = rand(Terrain.BEACH_INSET, MAP_H - Terrain.BEACH_INSET);
      if (!Terrain.isSpawnable(terrain, cx, cy)) continue;
      if (insideAnyBuilding(cx, cy, 90)) continue;    // not in somebody's yard
      made++;
      const spread = 190 + Math.random() * 220;
      const trunks = 6 + Math.floor(Math.random() * 7);
      for (let t = 0; t < trunks; t++) {
        // polar, so the stand is round rather than a square patch
        const a2 = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * spread;
        const x = cx + Math.cos(a2) * rr, y = cy + Math.sin(a2) * rr;
        if (!Terrain.isSpawnable(terrain, x, y) || Terrain.onRoad(terrain, x, y)) continue;
        if (insideAnyBuilding(x, y, 20)) continue;
        /* What grows here. The Ashfields have burnt stumps where a temperate
           map has oak and the Jungle Coast has palm — same generator, three
           different-looking islands. */
        const kind = (terrain.biome && terrain.biome.tree) || 'tree';
        const pr = Structures.prop(kind, x, y, Sprites.META[kind].r * 2, 0.8 + Math.random() * 0.4);
        if (genHits(pr, 8)) continue;
        obstacles.push(pr); genAdd(pr);
      }
      // scrub around the edge of the stand: cover you can actually lie up in
      const scrub = 4 + Math.floor(Math.random() * 5);
      for (let b = 0; b < scrub; b++) {
        const a2 = Math.random() * Math.PI * 2;
        const rr = spread * (0.75 + Math.random() * 0.5);
        const x = cx + Math.cos(a2) * rr, y = cy + Math.sin(a2) * rr;
        if (!Terrain.isSpawnable(terrain, x, y) || Terrain.onRoad(terrain, x, y)) continue;
        if (insideAnyBuilding(x, y, 20)) continue;
        const pr = Structures.prop('bush', x, y, Sprites.META.bush.r * 2, 0.85 + Math.random() * 0.4);
        if (genHits(pr, 6)) continue;
        obstacles.push(pr); genAdd(pr);
      }
    }
  }

  /* dressing: woodland inland, driftwood and palms along the sand */
  function placeProps(count) {
    // Interactive props (crates, barrels, trees, rocks, containers, bushes) are
    // real obstacles you can shoot, break and hide behind. The rest — pallets,
    // tyres, cones, signs, rubble, stumps — stay pure dressing.
    const live = ['tree', 'tree', 'bush', 'bush', 'rock', 'crate', 'crate', 'barrel', 'container'];
    const biomeScatter = (terrain && terrain.biome && terrain.biome.scatter) || [];
    const dressing = ['pallet', 'tyre', 'sign', 'cone', 'antenna', 'tent'].concat(biomeScatter);

    const liveCount = Math.round(count * 0.45);
    for (let i = 0; i < liveCount; i++) {
      const type = live[Math.floor(Math.random() * live.length)];
      const x = rand(Terrain.BEACH_INSET, MAP_W - Terrain.BEACH_INSET);
      const y = rand(Terrain.BEACH_INSET, MAP_H - Terrain.BEACH_INSET);
      if (!Terrain.isSpawnable(terrain, x, y)) continue;
      if (Terrain.onRoad(terrain, x, y)) continue;
      if (insideAnyBuilding(x, y, 10)) continue;      // not in somebody's hallway
      /* Sized from the sprite table, not from four numbers written here. This
         line was quietly overriding it: whatever a tree was declared to be, it
         was built at 64px — 1.6m — so raising the canopy in Sprites.META did
         nothing at all out in the field where nearly every tree on the map is.
         Scale varies the individual, the table decides the species. */
      const scale = 0.82 + Math.random() * 0.36;
      const pr = Structures.prop(type, x, y, (Sprites.META[type] || { r: 23 }).r * 2, scale);
      if (genHits(pr, 12)) continue;
      obstacles.push(pr);
      genAdd(pr);
    }

    for (let i = 0; i < count - liveCount; i++) {
      const kind = dressing[Math.floor(Math.random() * dressing.length)];
      decor.push({
        kind,
        x: rand(Terrain.BEACH_INSET - 40, MAP_W - Terrain.BEACH_INSET + 40),
        y: rand(Terrain.BEACH_INSET - 40, MAP_H - Terrain.BEACH_INSET + 40),
        // man-made scenery sits square; only the natural stuff is random
        rot: NATURAL_PROPS.has(kind)
          ? Math.random() * Math.PI * 2
          : Math.round(Math.random() * 4) * (Math.PI / 2),
        scale: 0.8 + Math.random() * 0.4,
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
    let w = isPlayer && profile
      ? Weapons.configure(base, { attachments: profile.attachments[base.id], ammo: profile.ammo[base.id] })
      : base;
    /* The equipped skin's id, kept alongside the resolved skin: the weapon's
       outline is built from the gun *and* the skin, so the drawing code needs
       to know which skin rather than only its colours. */
    const skinId = profile ? Skins.equipped(profile, base.id) : 'default';
    const skin = Skins.get(skinId);
    // the one passive you deploy with; bots run bare (js/perks.js)
    const perk = isPlayer ? ((profile && profile.perk) || Perks.DEFAULT) : Perks.DEFAULT;
    // Bullet Strap is the one perk that rewrites the gun rather than the body
    w = Perks.applyToWeapon(w, perk);
    const cls = Classes.forWeapon(w);      // your gun decides your class
    return {
      team, isPlayer, alive: true, skinId,
      x: 0, y: 0, r: BODY_R, angle: 0,
      klass: 'infantry',                                    // see Combat.TARGETS
      // Beefy is the one perk that moves max HP
      hp: Combat.maxHpFor('infantry', perk), maxHp: Combat.maxHpFor('infantry', perk),
      vest: 0, helmet: 0, bag: 0,                           // armour tiers 0-3 (vest, helmet, bag)
      perk,
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
      /* fixed per bot so a squad spreads out instead of stacking, and so each
         one searches a different arc for cover */
      flankBias: rand(-1, 1), coverSeed: Math.random() * Math.PI * 2,
      lastSeen: null, coverPt: null, coverT: 0,
      name: isPlayer ? 'You' : `${TEAM_NAMES[team]}-${Math.floor(rand(1, 99))}`,
      // scoreboard: kills/deaths persist across respawns, streak resets on death
      kills: 0, deaths: 0, streak: 0,
    };
  }

  function setupTeams() {
    agents = [];
    const profile = DB.getProfile();
    const playerWeapon = (profile && Weapons.byId[profile.weapon]) ? profile.weapon : Weapons.default;

    const setup = setupFor(mode);
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
      // Clear the ground under the objectives that actually ship. Doing it here,
      // on the final list, means no ordering or caching subtlety upstream can
      // leave a capture point sitting inside a wall.
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
    a.standT = 0;                 // a fresh body isn't running on borrowed time
    // you never respawn still sitting in something
    if (a.riding) { a.riding.driver = null; a.riding = null; }
    // One ejection pass can push you out of one wall and straight into another,
    // so push until you're clear; if the spot is hopeless, clear it.
    for (let i = 0; i < 6 && pointInObstacle(a.x, a.y); i++) resolveObstacles(a);
    resolveObstacles(a);
    if (pointInObstacle(a.x, a.y)) bulldoze(a.x, a.y, a.r + 30);
  }

  /* ---------------- start / stop ---------------- */
  function start(selectedMode, seed) {
    mode = selectedMode;
    Screens.show('game');
    if (!canvas) {
      canvas = document.getElementById('game-canvas');
      ctx = canvas.getContext('2d');
      bindInput();
    }
    bindRoomChip();
    bindLobby();
    showLobby(false);      // an offline match never has one
    resize();
    window.addEventListener('resize', resize);

    MAP_W = MAP_SIZES[mode].w; MAP_H = MAP_SIZES[mode].h;
    worldSeed = (seed >>> 0) || ((Math.random() * 0xffffffff) >>> 0);
    botLevel = DB.getSettings().botLevel || BotAI.DEFAULT;
    squadIntel = [];
    buildMap();
    setupTeams();
    bullets = []; fx = []; dmgNums = [];
    grenades = []; deployables = []; smokes = []; drops = []; airstrikes = []; chainQueue = []; flashOverlay = 0;
    zoom = zoomTarget = BASE_ZOOM;
    hudMessage = ''; hudMessageT = 0;
    killFeed = []; killBanner = null; soundPings = [];
    hereBuilding = null; hereEffect = null; resupplyT = 0;
    marks = []; emotes = []; wheel = null; commsCd = 0;
    online = null;
    spawnCrates(Math.round(((MAP_W - Terrain.BEACH_INSET * 2) * (MAP_H - Terrain.BEACH_INSET * 2) / 1e6) * DENSITY.crates));
    // Last of all, once every generator and spawner has run: clear the ground
    // under the capture points. Doing this earlier left a window for a later
    // pass to drop a wall back on top of one.
    for (const o of objectives) clearObjectiveSite(o);
    stampWorldIds();     // the wall list is final, so it can be named now
    buildNav();          // the world is final now, so the grid matches it
    // starting tactical kit = whatever your class deploys with
    player.inv = {
      grenade:  { id: null, n: 0 },
      tactical: { id: null, n: 0 },
      heal:     { id: null, n: 0 },
      tokens: [],
    };
    const kit = Items.CONSUMABLES[player.cls.consumable];
    if (kit) player.inv[kit.cat] = { id: player.cls.consumable, n: Classes.startFor(player.cls, carryTier(player), player.perk) };
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
    renderHint();
    hint.style.display = ''; hint.classList.remove('is-faded');
    setTimeout(() => hint.classList.add('is-faded'), 12000);
    updateWeaponHud();

    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  /* The on-screen legend, written from the bindings actually in force. It used
     to be hardcoded markup, so rebinding a key left the HUD confidently
     telling you to press the wrong one. */
  function renderHint() {
    const hint = document.getElementById('hud-hint');
    if (!hint) return;
    const k = (id) => Controls.labelFor(id);
    /* The four movement keys read as one cluster ("W A S D"), unless they've
       been bound to something long enough that spelling them out is clearer. */
    const move = [Controls.all().up[0], Controls.all().left[0], Controls.all().down[0], Controls.all().right[0]]
      .map(Controls.label).join(' ');
    const groups = [
      ['MOVE', move, `${k('dash')} dash`],
      ['FIGHT', 'L-click fire', 'R-click aim', `${k('reload')} reload`],
      ['ACTIONS', `${k('tool')} tool`, `${k('grenade')} grenade`, `${k('tactical')} tactical`,
        `${k('heal')} heal`, `${k('token')} call-in`],
      ['SQUAD', 'Middle-click ping', `${k('ping')} ping wheel`, `${k('emote')} emote`],
      ['WORLD', `${k('interact')} door/crate/vehicle`, `${k('pause')} pause`],
    ];
    hint.innerHTML = groups.map(([head, ...rest]) =>
      `<span class="hint-group"><b>${head}</b> ${rest.join(' · ')}</span>`).join('');
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    document.getElementById('game-pause').classList.toggle('is-open', paused);
    if (!paused) { lastTime = performance.now(); requestAnimationFrame(loop); }
  }

  function quitMatch() {
    running = false; paused = false;
    /* Leaving an online match has to hang up, not just walk away from the
       screen. A host that stayed registered kept handing its code out to a
       room nobody was simulating; a guest that stayed connected left a body
       standing in everyone else's game. */
    if (typeof P2P !== 'undefined' && P2P.isActive()) P2P.stop();
    online = null;
    showLobby(false);
    document.getElementById('game-pause').classList.remove('is-open');
    Screens.enterHome();
  }

  /* ---------------- input ----------------
     Nothing here knows which physical key does what — it asks Controls, which
     owns the table and the player's overrides (js/controls.js). Rebinding a
     key takes effect on the next press; there is no reload and no restart. */
  function bindInput() {
    window.addEventListener('keydown', e => {
      if (!running) return;
      const act = Controls.actionFor(e.code);
      switch (act) {
        case 'up': input.up = true; break;
        case 'down': input.down = true; break;
        case 'left': input.left = true; break;
        case 'right': input.right = true; break;
        case 'reload': startReload(hudSubject()); break;   // the gun you're actually firing
        case 'dash': dash(); break;
        case 'grenade': throwGrenade(); break;
        case 'heal': useHeal(); break;
        case 'tactical': deployTactical(); break;
        case 'token': useToken(); break;
        case 'interact': interact(); break;
        case 'tool': useTool(); break;
        case 'airstrike': callAirstrike(); break;
        case 'ping': openWheel('ping'); break;
        case 'emote': openWheel('emote'); break;
        case 'scoreboard': showScores = true; e.preventDefault(); break;
        case 'pause': wheel ? closeWheel(false) : togglePause(); break;
        default:
          // 1-8 pick straight off an open wheel, for anyone who'd rather not aim
          if (wheel && e.code.startsWith('Digit')) {
            const n = +e.code.slice(5) - 1;
            const items = wheel.kind === 'ping' ? Comms.PINGS : Comms.EMOTES;
            if (n >= 0 && n < items.length) {
              const w = wheel; wheel = null;
              if (w.kind === 'ping') sendMark(w.at.x / zoom + camX, w.at.y / zoom + camY, items[n].id);
              else sendEmote(items[n].id);
            }
          }
      }
    });
    window.addEventListener('keyup', e => {
      switch (Controls.actionFor(e.code)) {
        case 'up': input.up = false; break;
        case 'down': input.down = false; break;
        case 'left': input.left = false; break;
        case 'right': input.right = false; break;
        // let go of the wheel key and whatever you were pointing at is sent
        case 'ping': if (wheel && wheel.kind === 'ping') closeWheel(true); break;
        case 'emote': if (wheel && wheel.kind === 'emote') closeWheel(true); break;
        case 'scoreboard': showScores = false; e.preventDefault(); break;
      }
    });
    /* Rebinding mid-match must not leave a key stuck down: if "move left" was
       held when it stopped being "move left", nothing will ever clear it. */
    Controls.onChange(() => { input.up = input.down = input.left = input.right = false; });
    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      input.mx = e.clientX - rect.left; input.my = e.clientY - rect.top;
    });
    canvas.addEventListener('mousedown', e => {
      if (!running || paused) return;
      if (wheel) { if (e.button === 0) closeWheel(true); e.preventDefault(); return; }
      if (e.button === 0) { input.shooting = true; input.fireEdge = true; }   // left = fire
      if (e.button === 1) { quickMark(); e.preventDefault(); }                // middle = quick ping
      if (e.button === 2) input.ads = true;                                    // right = aim
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) input.shooting = false;
      if (e.button === 2) input.ads = false;
    });
    // middle-click scrolls the page otherwise, which drags the whole match
    canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
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
  /* Falloff: a round carries full damage for the first FALLOFF_START of its
     gun's range, then sheds the gun's falloff% every FALLOFF_STEP travelled,
     down to FALLOFF_MIN. Measured in tiles so the curve keeps its shape
     whatever the range: an AKM at its 27-tile limit still lands 81% of its
     damage, an M870 pellet at 13 tiles lands 68%. */
  const FALLOFF_STEP = TILE * 4, FALLOFF_START = 0.45, FALLOFF_MIN = 0.4;
  /* How far a round may move between collision tests. Has to stay under the
     smallest thing it can hit — a BODY_R hitbox, or the thinnest wall — or
     fast rounds fly straight through. */
  const BULLET_STEP = 10;
  /* How far a settled bot gets toward its gun's full ADS cone (0 = always
     hipfire, 1 = as steady as a scoped player). */
  const BOT_STEADY = 0.55;

  /* True for the player, and for a vehicle the player is driving — both are
     "your gun" as far as sound, the ammo counter and auto-reload go. */
  const isYours = (a) => a.isPlayer || !!(a.driver && a.driver.isPlayer);

  function startReload(a) {
    if (a.reloadTimer > 0 || a.ammo >= a.weapon.mag) return;
    // online our magazine belongs to the host, so ask rather than assume
    if (online && a.isPlayer) online.transport.send('reload', {});
    // Adren%/2 reload speedup, and whatever the perk takes off on top
    a.reloadTimer = a.weapon.reloadMs / Combat.adrenaline(a.adrenaline, a.perk).reload
      * Perks.mod(a, 'reloadMult', 1);
    a.burstLeft = 0;
    if (isYours(a)) { SFX.reload(); updateWeaponHud(); }
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
    /* Recoil you can feel, scaled off the gun's own kick — a Barrett should
       move the camera and a Makarov should not. */
    if (a.isPlayer) addShake(1.1 + (w.recoil || 0.05) * 16);

    /* Aimed fire tightens the cone. The player holds right mouse for it and
       gets the gun's full ADS benefit.

       A bot that has stopped and held the contact settles too, but only part
       of the way there — BOT_STEADY of the distance from hip to ADS. Without
       any of this a bot is harmless at the ranges these guns now reach (a
       hipfired M16 cone is ±44px at 25 tiles, wider than the body it's aiming
       at); with all of it, a bot marksman never misses and squads evaporate.
       Partway leaves them dangerous when they set up and sloppy on the move,
       which is what the difficulty traits in botai.js are trying to say. */
    const speed = Math.hypot(a.vx || 0, a.vy || 0);
    /* A vehicle's gun is on a mount, so it settles on its own terms — slow
       down and it steadies, whoever is driving. Keying it off contactT the way
       a bot does would leave a player-driven vehicle reading whatever aim
       state the bot happened to leave behind. */
    const settled = a.isVehicle
      ? speed < 60
      : (!a.isPlayer && a.contactT > 0.35 && speed < 40);
    const ads = a.isPlayer ? input.ads : settled;
    const aimMult = a.isPlayer
      ? (ads ? w.adsMult : 1)
      : (settled ? 1 - BOT_STEADY * (1 - w.adsMult) : 1);
    // moving widens the cone by the gun's own moveSpread — a MAC-10 sprays at
    // a run, a QBB bullpup barely notices. ADS steadies both.
    const moving = clamp(speed / 200, 0, 1);
    const cone = w.spreadBase * aimMult
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
        // a round dies at its gun's effective range, not on a shared timer.
        // A fuzed round is on a timer instead — it is going off in 5s wherever
        // it has bounced to by then, so its range never ends the flight.
        life: w.fuze ? w.fuze : Math.min(2.4, (w.range * 1.15) / w.bulletSpeed),
        owner: a, color: (a.skin && a.skin.tracer) || w.ammoColor,
        tracer: !!w.tracer,
        // specialized-ammo behaviour the flight loop has to know about
        hitR: w.hitboxMult || 1, fuze: w.fuze || 0, antiTank: !!w.antiTank,
      });
    }
    a.bloom = Math.min(w.bloomMax, a.bloom + w.recoilKick);
    spawnFx(a.x + Math.cos(a.angle) * a.r, a.y + Math.sin(a.angle) * a.r, '#ffd36a', pellets > 1 ? 5 : 3);
    // a suppressor really does keep you quiet: bots only "hear" loud shots
    if ((!w.audio || w.audio > 0.5) && !Perks.mod(a, 'silent', false)) alertNearbyBots(a);
    logGunshot(a);
    if (isYours(a)) { SFX.shoot(); if (a.ammo === 0) startReload(a); updateWeaponHud(); }
  }

  /* Gunfire is a giveaway: bots within earshot of an unsuppressed shot look
     your way. A Suppressor drops the report below that threshold entirely. */
  /* ---------------- Portable Satellite ----------------
     A shot you can hear becomes a shot you can see. Every report inside
     earshot is logged, and the HUD draws a marker on the rim of the screen
     pointing at it with the distance in tiles — so the perk turns the audio
     cue the game already gives you into something you can act on without
     having to guess a direction from a stereo pan.

     Kept short: a contact two seconds old is history, not intelligence. */
  const PING_LIFE = 2.5;
  let soundPings = [];
  function logGunshot(shooter) {
    if (!player || !player.alive || shooter === player) return;
    if (!Perks.mod(player, 'sound', false)) return;
    if (shooter.team === player.team) return;           // your own squad isn't a contact
    if (dist2(shooter.x, shooter.y, player.x, player.y) > (TILE * 30) ** 2) return;
    soundPings.push({ x: shooter.x, y: shooter.y, life: PING_LIFE });
    if (soundPings.length > 24) soundPings.shift();
  }
  const updateSoundPings = (dt) => {
    for (let i = soundPings.length - 1; i >= 0; i--) {
      if ((soundPings[i].life -= dt) <= 0) soundPings.splice(i, 1);
    }
  };

  function drawSoundPings() {
    if (!soundPings.length || !player) return;
    const cx = W / 2, cy = H / 2, rim = Math.min(W, H) * 0.36;
    ctx.save();
    for (const s of soundPings) {
      const a = Math.atan2(s.y - player.y, s.x - player.x);
      const tiles = Math.round(Math.hypot(s.x - player.x, s.y - player.y) / TILE);
      const fade = Math.min(1, s.life / PING_LIFE);
      const px = cx + Math.cos(a) * rim, py = cy + Math.sin(a) * rim;
      ctx.globalAlpha = fade;
      // a chevron pointing the way, and how far
      ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = '#ffcf4a';
      ctx.beginPath();
      ctx.moveTo(11, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7);
      ctx.closePath(); ctx.fill();
      ctx.rotate(-a); ctx.translate(-px, -py);
      ctx.font = 'bold 10px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(`${tiles}`, px + Math.cos(a) * 17 + 1, py + Math.sin(a) * 17 + 1);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(`${tiles}`, px + Math.cos(a) * 17, py + Math.sin(a) * 17);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function alertNearbyBots(shooter) {
    const earshot = (TILE * 22) ** 2;   // a shot carries about a screen and a half
    for (const o of agents) {
      if (!o.alive || o.isPlayer || o.team === shooter.team || o.isVehicle) continue;
      if (dist2(o.x, o.y, shooter.x, shooter.y) > earshot) continue;
      o.aiTargetPt = { x: shooter.x + rand(-60, 60), y: shooter.y + rand(-60, 60) };
      o.aiRepath = rand(1.5, 3);
    }
  }

  /* Explosion from launcher rounds — AoE damage that falls off with distance. */
  /* `kind` overrides how the blast is rated against structures. C4 is the one
     charge on the toughness ladder that opens tier 5, so it has to say so —
     rated as an ordinary explosive it would bounce off a vault it is
     specifically the answer to. */
  function explode(x, y, baseDmg, radius, team, owner, type = 'explosive', kind = null) {
    /* Felt, not just seen. Scaled by distance, so a grenade at your feet is a
       different event from one across the compound. */
    if (player) {
      const d = Math.hypot(player.x - x, player.y - y);
      if (d < radius * 3) addShake(11 * (1 - Math.min(1, d / (radius * 3))));
    }
    spawnFx(x, y, '#ff9d3b', 22);
    for (const a of agents) {
      if (!a.alive || a.riding) continue;      // the hull eats it, not the driver
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < radius) {
        const dmg = baseDmg * (1 - d / radius) * (a.team === team ? 0.5 : 1);
        // blasts always count as body hits — no lucky head/limb rolls from splash
        if (dmg > 1) applyDamage(a, dmg, owner, type, 'body');
      }
    }
    // blasts tear up cover and sentries too — that's how you make an entry point
    const src = { kind: kind || (type === 'heat' ? 'heat' : 'explosive') };
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

  /* ---------------- kill feed ----------------
     Every elimination in the match, newest first, under the minimap. Rows the
     player is in are drawn with a highlight — in a 24-agent firefight the feed
     scrolls fast, and the one line that matters is the one with your name in
     it. Entries are fed from two places: applyDamage() offline, and the
     server's `kill` events online, so both modes read identically. */
  const KILL_FEED_MAX = 5;          // rows kept on screen
  const KILL_FEED_LIFE = 6;         // seconds before a row fades out
  let killFeed = [];
  /* A separate, louder callout for the player's own kills and deaths, centred
     over the action rather than tucked in the corner. */
  let killBanner = null;

  /* Online, a kill can name someone who has already left the room, and the
     world itself kills nobody by name at all — so never assume there is one. */
  const nameOf = (a, fallback) => (a && a.name) || fallback;

  function pushKill(killer, victim, zone) {
    const mine = !!(killer && killer.isPlayer);
    const victimIsMe = !!(victim && victim.isPlayer);
    killFeed.unshift({
      killer: nameOf(killer, 'The world'),
      killerTeam: killer ? killer.team : -1,
      victim: nameOf(victim, '?'),
      victimTeam: victim ? victim.team : -1,
      headshot: zone === 'head', mine, victimIsMe, t: KILL_FEED_LIFE,
    });
    if (killFeed.length > KILL_FEED_MAX) killFeed.length = KILL_FEED_MAX;

    if (mine) {
      killer.streak = (killer.streak || 0) + 1;
      noteKill();                    // ...and was that two in four seconds?
      killBanner = {
        text: 'ELIMINATED ' + nameOf(victim, '').toUpperCase(),
        sub: (zone === 'head' ? 'HEADSHOT' : '')
          + (killer.streak > 1 ? (zone === 'head' ? '  ·  ' : '') + killer.streak + ' KILL STREAK' : ''),
        good: true, t: 2.2,
      };
    } else if (victimIsMe) {
      // also the one place an online death resets the streak: our HP comes from
      // the server, so applyDamage never runs for us in a network match
      victim.streak = 0;
      killBanner = {
        text: 'ELIMINATED BY ' + nameOf(killer, 'the world').toUpperCase(),
        sub: zone === 'head' ? 'HEADSHOT' : '', good: false, t: 2.2,
      };
    }
  }

  function updateKillFeed(dt) {
    for (let i = killFeed.length - 1; i >= 0; i--) {
      killFeed[i].t -= dt;
      if (killFeed[i].t <= 0) killFeed.splice(i, 1);
    }
    if (killBanner) { killBanner.t -= dt; if (killBanner.t <= 0) killBanner = null; }
  }

  const worldMouse = () => ({ x: input.mx / zoom + camX, y: input.my / zoom + camY });
  const near2 = (a, b, r) => dist2(a.x, a.y, b.x, b.y) < r * r;

  /* Add to a slot. Nothing is ever silently destroyed: if the slot already
     holds something else, that stack is dropped at your feet, and anything
     over the carry limit drops too. Walk over a drop and press E to take it. */
  /* A bigger bag is worth nothing if it only helps with what you pick up
     next, so equipping one tops your class kit straight up to its new
     ceiling. Looted odds and ends keep whatever count they had — the bag
     raises their cap, it doesn't conjure them. */
  function refillFromBag() {
    const kit = Items.CONSUMABLES[player.cls.consumable];
    if (!kit) return;
    const slot = player.inv[kit.cat];
    if (!slot || slot.id !== player.cls.consumable) return;
    slot.n = Math.max(slot.n || 0, Classes.startFor(player.cls, carryTier(player), player.perk));
  }

  /* How much you can hold, as a bag tier. A Mule counts as wearing one bag
     better than they are — including no bag at all, which becomes a T1. */
  const carryTier = (a) => Math.min(3, a.bag || 0);

  function addItem(cat, id, n, at) {
    const slot = player.inv[cat];
    if (!slot) return 0;
    const cap = Classes.limitFor(player.cls, id, carryTier(player), player.perk);
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
    /* One pile, one taker. Taking it locally let two people both pick up the
       same stack, and then the next snapshot put it back on the floor for
       whichever of them the room had said no to. */
    if (online) { online.transport.send('grab', {}); SFX.click(); return true; }
    const it = Items.CONSUMABLES[best.id];
    const slot = player.inv[best.cat];
    const cap = Classes.limitFor(player.cls, best.id, carryTier(player), player.perk);
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
    // a different gun is a different outline — drop the cached one
    a.gunProfile = null;
    a.reloadTimer = 0; a.burstLeft = 0; a.postBurstCd = 0;
    if (a.isPlayer) updateWeaponHud();
  }

  /* ================= CLASS TOOLS ([V]) ================= */
  /* Gadget tools (binoculars, goggles, ghillie) toggle; the rest swing. */
  /* ---- what each class's gadget looks like when it goes off ----
     Ten classes shared one click and one grey HUD line, so using the thing
     that defines your class felt the same whichever class you were. Each now
     has its own flare, its own colour and its own line — the effect is
     cosmetic, the ability itself is unchanged. */
  const TOOL_FX = {
    'bayonet':      { color: '#e8eef8', n: 10, ring: 0, msg: 'Bayonet — in close' },
    'binoculars':   { color: '#8fd8ff', n: 14, ring: 220, msg: 'Glassing the ground ahead' },
    'trench-spade': { color: '#b08a5a', n: 22, ring: 60,  msg: 'Digging in' },
    'fire-axe':     { color: '#ff9d3b', n: 14, ring: 0,   msg: 'Axe — through the wall' },
    'riot-shield':  { color: '#cfd8ee', n: 8,  ring: 40,  msg: 'Shield up' },
    'nvg':          { color: '#6bff9d', n: 12, ring: 260, msg: 'Night vision — contacts marked' },
    'ghillie':      { color: '#7fbf5a', n: 18, ring: 90,  msg: 'Ghillie — hold still and vanish' },
    'stone-hammer': { color: '#d8c8a8', n: 16, ring: 0,   msg: 'Hammer — breaking stone' },
    'defibrillator':{ color: '#ffe066', n: 16, ring: 120, msg: 'Paddles charged' },
    'heat-goggles': { color: '#ff6ad5', n: 12, ring: 260, msg: 'Thermal — heat through cover' },
  };

  function toolFx(a, on) {
    const fx = TOOL_FX[a.tool && a.tool.id];
    if (!fx) return;
    spawnFx(a.x, a.y, fx.color, fx.n);
    // a sweep gadget shows you how far it reaches; a swung one does not
    if (fx.ring && on !== false) {
      toolRings.push({ x: a.x, y: a.y, r: 12, max: fx.ring, color: fx.color, t: 0 });
    }
    if (a.isPlayer) {
      hudMsg(fx.msg + (on === false ? ' — off' : ''));
      addShake(fx.ring ? 1.2 : 2.4);
    }
  }
  /* Expanding rings from the sweep gadgets, drawn under the agents. */
  let toolRings = [];
  function updateToolRings(dt) {
    for (let i = toolRings.length - 1; i >= 0; i--) {
      const r = toolRings[i];
      r.t += dt;
      r.r += (r.max - r.r) * Math.min(1, dt * 4.5);
      if (r.t > 0.9) toolRings.splice(i, 1);
    }
  }
  function drawToolRings() {
    for (const r of toolRings) {
      const k = 1 - r.t / 0.9;
      ctx.globalAlpha = k * 0.55;
      ctx.strokeStyle = r.color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function useTool() {
    if (!canAct()) return;
    const t = player.tool;
    if (t.passive) {
      player.toolActive = !player.toolActive;
      // gadgets aren't just a toggle: switching one on sweeps for contacts and
      // marks what it finds for the whole squad
      if (player.toolActive) markContacts(player);
      toolFx(player, player.toolActive);
      SFX.click();
      return;
    }
    if (player.toolCd > 0) return;
    /* Online the room swings for us. It knows our class, so it knows the tool,
       its reach and what it can breach — and it is the only place that can see
       the people we're swinging at, or agree that the wall we just cut is gone.
       Swinging locally as well would break cover only on our own screen and
       then have the room push us back out of the hole. */
    if (online) {
      online.transport.send('melee', {});
      player.toolCd = player.tool.cooldown * hereToolRate();      // local rate limit, so the arc animates once
      player.swingT = 0.18;
      toolFx(player, true);
      SFX.click();
      return;
    }
    toolFx(player, true);
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
  const invalidateRects = () => {
    rectCache = solidCache = sightCache = solidGrid = sightGrid = bulletGrid = null;
    lightCache = null;      // a lamp that just got shot out stops lighting the room
  };

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
  /* ---------------- naming the world for the network ----------------
     Every client generates the same map from the room's seed, in the same
     order, so position in `obstacles` is a name all of them agree on. Stamped
     once the map is final; destroying a wall never renumbers the rest, so
     "wall 214 is down" means the same thing on every screen.

     netWorld() is what the host hands the simulation: enough of each wall for
     it to stop a player and chew a bullet, and nothing about how it's drawn. */
  function stampWorldIds() { for (let i = 0; i < obstacles.length; i++) obstacles[i].nid = i; }
  function netWorld() {
    /* Only what the simulation can act on. A lamp, a chair and a traffic cone
       are passable, don't stop a round and can't hurt anybody, so to the room
       they are a rect it will never touch — and the map now has hundreds of
       them. Sending those was pure weight on the wire and on the room's
       spatial index, for geometry that does nothing there. */
    const matters = (o) => {
      const k = kindOf(o);
      return Structures.blocksMove(o) || Structures.ballistics(o).mode !== 'through'
        || k.slow || k.dps || k.explodes || k.drops || Structures.isDoor(o);
    };
    return obstacles.filter(matters).map(o => {
      const bal = Structures.ballistics(o);
      const k = kindOf(o);
      return {
        id: o.nid, x: o.x, y: o.y, w: o.w, h: o.h,
        solid: Structures.blocksMove(o),
        mode: bal.mode, keep: bal.keep,
        hp: o.hp, type: o.type, toughness: o.toughness,
        // the room needs to know which rects can be opened, so it can let
        // someone walk through one instead of hauling them back into it
        door: Structures.isDoor(o),
        /* What this piece does beyond being in the way, looked up here so the
           room never has to know the wall table. Barbed wire slows and cuts;
           a barrel goes off when it comes apart. Without these the room saw a
           rect you could walk through and nothing else, so online the wire was
           a decal and the barrels were crates. */
        slow: k.slow || 0, dps: k.dps || 0,
        explodes: k.explodes || null,
        /* Whether you can see over it. The room needs this now that it decides
           who a flashbang blinds and what a sentry can shoot at — both of
           which are line-of-sight questions it could not previously ask. */
        tall: Structures.blocksSight(o),
      };
    });
  }
  /* Where the loot is. Rolled by the room, not by each client: two people
     walking up to the same gold crate both used to get a legendary out of it,
     because each of them opened their own private copy. Position in the list
     is the name both ends use, exactly as with the walls. */
  const netCrates = () => crates.map(c => ({
    x: c.x, y: c.y, tier: c.tier, needs: c.needs || null,
    look: c.look || null, rot: c.rot || 0,
  }));
  /* The hulls parked on the map — garage jeeps, a camp's car park. They belong
     to nobody until somebody climbs in, which is what makes crossing the map
     for a parking lot worth doing, and online that was worth nothing at all:
     startOnline() strips every non-player agent, so the room never heard about
     them and every garage stood empty. */
  const netVehicles = () => parkedVehicles.slice();
  /* Trenches are dug during the match rather than generated, so this is
     normally empty at hand-over — it exists so a host that reloads the world
     mid-match doesn't fill in everyone's cover. */
  const netTrenches = () =>
    trenches.map(t => ({ x: t.x, y: t.y, r: t.r, dodge: Structures.WALL_TYPES.trench.dodge }));
  /* capture points, in generation order — the sim reports them back by index */
  const netObjectives = () => objectives.map(o => ({ name: o.name, x: o.x, y: o.y, r: o.r }));

  /* the host said this one came down — take it down here too */
  function netDestroyWall(id) {
    const s = obstacles.find(o => o.nid === id);
    if (s) destroyStructure(s, true);
  }
  /* The room's blast, drawn where the room put it. */
  function netBoom(x, y, r) {
    spawnFx(x, y, '#ff9d3b', 22);
    // only audible if it was near enough to matter — r is the blast radius
    if (player && dist2(player.x, player.y, x, y) < (r + 400) ** 2) SFX.kill();
  }
  /* Somebody dug in. Same circle on every screen, because the room is rolling
     a dodge against it. */
  function netTrench(e) {
    if (trenches.some(t => t.x === e.x && t.y === e.y && t.r === e.r)) return;
    trenches.push({ x: e.x, y: e.y, r: e.r });
    spawnFx(e.x, e.y, '#b08a5a', 10);
  }

  /* A tool can only work a wall its Structure Pierce out-rates, unless it has
     an explicit clearing effect for that type (bayonet→wire, spade→sandbags). */
  /* A Breacher's tool out-rates one more rung of the toughness ladder than it
     otherwise would — the difference between bouncing off a metal wall and
     opening it. */
  const canBreach = (t, s, who) => Combat.canDamageStructure(s, {
    kind: 'melee', pierce: t.pierce + Perks.mod(who, 'piercePlus', 0), clears: t.clears,
  });
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
      if (!canBreach(t, s, a)) { tooTough = s; continue; }
      seen.push(s);
      damageStructure(s, toolStructureDamage(t, s), x, y, a);
    }
    if (!seen.length && tooTough && a.isPlayer) {
      hudMsg(`${t.name} can't breach ${kindOf(tooTough).name} (toughness ${tooTough.toughness})`);
    }
    return { hit: seen.length, blocked: !!tooTough };
  }
  function damageStructure(s, dmg, hx, hy, who) {
    s.hp -= dmg * Perks.mod(who, 'structureMult', 1);
    if (who) s.lastAttacker = who;      // credited for the salvage, and the blast
    spawnFx(hx === undefined ? s.x + s.w / 2 : hx, hy === undefined ? s.y + s.h / 2 : hy, '#cfd8ee', 5);
    if (s.hp <= 0) destroyStructure(s);
  }
  /* `echo` = the room already decided this one and we are only catching up.
     Everything a wall does on the way out — spilling loot, cooking off, taking
     the barrels beside it with it — is the room's to run when online, and it
     has already run it: the damage is in the snapshot and the fireball arrives
     as its own event. Doing it again here would take the health off a second
     time on our own screen and destroy a neighbouring barrel the room still
     believes in. */
  function destroyStructure(s, echo) {
    navDirty = true;                 // a hole in a wall is a new route
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const k = kindOf(s);
    spawnFx(cx, cy, k.stroke && k.stroke[0] === '#' ? k.stroke : '#8ea0c9', s.isProp ? 18 : 14);
    invalidateRects();
    if (s.dp) { const i = deployables.indexOf(s.dp); if (i >= 0) deployables.splice(i, 1); return; }
    const i = obstacles.indexOf(s); if (i >= 0) obstacles.splice(i, 1);
    if (echo) return;

    // survev-style props do something on the way out
    if (k.drops) spillLoot(cx, cy, k.drops);
    if (k.explodes) cookOff(s, cx, cy, k.explodes);
    /* Scavenger: anything you break might have had something in it. Only for
       things that don't already drop loot — a crate is not worth breaking
       twice — and only for whoever actually broke it. */
    if (!k.drops) {
      const by = s.lastAttacker;
      const odds = Perks.mod(by, 'salvage', 0);
      if (odds > 0 && Math.random() < odds) {
        spillLoot(cx, cy, 'regular');
        if (by.isPlayer) hudMsg('Salvaged something from the wreckage');
      }
    }
  }

  /* a broken crate scatters what a crate of that tier would have held */
  function spillLoot(x, y, tier) {
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const entry = Items.rollLoot(tier);
      let id = entry.id;
      if (id === 'classConsumable') id = Items.classConsumableFor(player.cls.name);
      if (id === 'ammo' || id === 'legendary' || id === 'jeep' || id === 'tank' ||
          id.startsWith('armor')) id = 'bandage';        // ground drops are consumables only
      const it = Items.CONSUMABLES[id];
      if (it) dropItem(it.cat, id, 1, { x, y });
    }
    SFX.reward();
  }

  /* a barrel cooks off, and the blast sets off any barrel next to it */
  function cookOff(source, x, y, conf) {
    if (source.cooking) return;
    source.cooking = true;

    // Claim the neighbours *before* the blast goes off. The explosion itself
    // destroys nearby barrels, so gathering them afterwards found nothing and
    // they vanished silently instead of chaining.
    for (const o of structureRects()) {
      if (o === source || o.cooking) continue;
      const ok = kindOf(o);
      if (!ok.explodes) continue;
      const ox = o.x + o.w / 2, oy = o.y + o.h / 2;
      if (dist2(ox, oy, x, y) > conf.radius * conf.radius) continue;
      o.cooking = true;                       // stops destroyStructure double-firing it
      chainQueue.push({ s: o, x: ox, y: oy, conf: ok.explodes, t: 0.12 + Math.random() * 0.18 });
    }

    explode(x, y, conf.damage, conf.radius, -1, source.lastAttacker || null, 'explosive');
  }
  let chainQueue = [];
  function updateChains(dt) {
    for (let i = chainQueue.length - 1; i >= 0; i--) {
      const c = chainQueue[i];
      c.t -= dt;
      if (c.t > 0) continue;
      chainQueue.splice(i, 1);
      const idx = obstacles.indexOf(c.s);
      if (idx >= 0) { obstacles.splice(idx, 1); invalidateRects(); }
      c.s.cooking = false;                 // let destroyStructure's guard pass
      c.s.cooking = true;
      explode(c.x, c.y, c.conf.damage, c.conf.radius, -1, null, 'explosive');
      spawnFx(c.x, c.y, '#ff9d3b', 18);
    }
  }

  /* Bushes hide you the way the ghillie suit does, but for anyone: stand still
     inside one and bots lose you. */
  function inConcealment(a) {
    // a Ghost doesn't have to stop to disappear into a bush
    if (!Perks.mod(a, 'moveConceal', false) && (a.stillT === undefined || a.stillT < 0.35)) return false;
    const arr = gridAt(bulletIndex(), a.x, a.y);
    if (!arr) return false;
    return arr.some(o => kindOf(o).conceals && inRect(a.x, a.y, o));
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
    if (trenches.some(t => dist2(t.x, t.y, a.x, a.y) < 40 * 40)) return;
    /* Online the room owns the hole, because the room is the thing rolling the
       dodge for anyone standing in it. Ask for it and draw it when the event
       comes back, rather than digging one only we can see. The offline cap
       doesn't apply: the room keeps its own, and dropping the oldest here
       would take away cover the room still honours. */
    if (online) { online.transport.send('dig', { r: 48 }); return; }
    if (trenches.length > 14) trenches.shift();
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
    /* Online the room throws it. It owns the grenade from the moment it leaves
       your hand — where it lands, who it catches, whether you still had one to
       throw — and it caps the range itself, so the target below is a request,
       not a destination. Lobbing a local copy alongside would draw two of
       them and hurt nobody on anyone else's screen. */
    if (online) {
      online.transport.send('throw', { x: Math.round(t.x), y: Math.round(t.y) });
      SFX.click();
      return;
    }
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
    // the room runs the clock, so being shot mid-drink is decided in one place
    if (online) { online.transport.send('heal', {}); SFX.reload(); return; }
    player.channel = {
      t: it.time, total: it.time, label: it.name,
      onDone: () => {
        if (it.hp) player.hp = Math.min(player.maxHp, player.hp + it.hp);
        /* Stacking past 100 is the whole point of the top band: it buys the
           last stand, and it drains twice as fast while you hold it. Capping
           at 100 here made that band unreachable. */
        if (it.adr) player.adrenaline = Math.min(Combat.ADREN_MAX, player.adrenaline + it.adr);
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
    /* A mine has to trigger for everyone or nobody, and a sentry has to shoot
       at people this client cannot even see. Both belong to the room. */
    if (online) { online.transport.send('deploy', {}); SFX.capture(); return; }
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

  /* ---------------- vehicles ----------------
     One table per vehicle, so what a jeep "is" lives in one place: how tough
     it is, what it drives like, and what it shoots. HP and the armour profile
     both come from combat.js — a tank is not hard to kill because of a big
     health pool, it's hard to kill because rifle rounds do 0% to it, and the
     HUD reads that straight out of Combat.TARGETS rather than restating it. */
  const VEHICLES = {
    /* Sized against the real thing, at 40px to the metre like everything
       else. They were 1.45m and 1.7m across — a tank was barely wider than two
       men standing together, which made the one heavy asset on the map read as
       a go-kart. A light 4x4 is about 2m wide and a main battle tank about
       3.6m over the tracks, and since collision here is a circle these are the
       radii that put the hull where the hull should be.

       The consequence is deliberate: a tank at 2.8m across no longer fits down
       a 2.2m corridor, and has to go round buildings rather than through the
       doorways. That is what a tank should be. */
    jeep: {
      vtype: 'jeep', name: 'Armored Jeep', icon: '🚙', klass: 'jeep',
      weapon: 'm249', r: 42, speed: 175,                  // ~2.1m across
      blurb: 'Fast and open-topped — a mounted LMG on wheels',
    },
    tank: {
      vtype: 'tank', name: 'Tank', icon: '🛡️', klass: 'tank',
      weapon: 'qlz-87', r: 56, speed: 110,                // ~2.8m across
      blurb: 'Small arms bounce off — only HEAT and explosives bite',
    },
  };
  const vehicleDef = (v) => VEHICLES[v && v.vtype] || VEHICLES.jeep;

  /* --- call in a vehicle token at the cursor --- */
  function useToken() {
    if (!canAct()) return;
    if (!player.inv.tokens.length) { hudMsg('No call-in tokens (open crates!)'); return; }
    const p = worldMouse();
    if (online) {
      online.transport.send('token', { x: Math.round(p.x), y: Math.round(p.y) });
      SFX.win();
      return;
    }
    const t = player.inv.tokens.shift();
    const v = spawnVehicle(player.team, t, p.x, p.y);
    hudMsg(`${vehicleDef(v).name} called in — press E to get in`); SFX.win();
  }
  /* `team` of -1 parks it unclaimed: a garage jeep or one of the four in a
     camp's car park belongs to whoever reaches it first, and until then it is
     hostile hardware to everybody — anyone can shoot it, anyone can take it. */
  function spawnVehicle(team, vtype, x, y) {
    const conf = VEHICLES[vtype] || VEHICLES.jeep;
    const v = makeAgent(Math.max(0, team), false, conf.weapon);
    // parked, not patrolling: the squad AI leaves an unclaimed hull alone
    if (team < 0) { v.team = -1; v.neutral = true; v.aiHold = Infinity; }
    const hp = Combat.maxHpFor(conf.klass);
    v.isVehicle = true; v.vtype = conf.vtype; v.klass = conf.klass;
    v.maxHp = hp; v.hp = hp; v.r = conf.r; v.vspeed = conf.speed;
    v.name = conf.name;
    v.hullAngle = 0;                       // hull points where it drives, turret where you aim
    v.x = clamp(x, v.r, MAP_W - v.r); v.y = clamp(y, v.r, MAP_H - v.r);
    agents.push(v);
    return v;
  }

  /* --- getting in and out ---------------------------------------------
     Riding is modelled as the player agent being carried by the vehicle: it
     keeps its position in sync so the camera, the minimap and the capture
     logic all keep working untouched, and `riding` marks it as no longer a
     target — you are inside the armour, so the armour is what gets shot. */
  /* How far a bot will go out of its way for a vehicle. Far enough to cross a
     compound for a tank, not so far that the map empties of infantry.

     900 was too short to ever fire: nineteen hulls spread over a 7400px map
     sit about 1700px apart, so a bot was almost never within range of one at
     the moment it happened to look. */
  /* Measured: at 1800 every bot on the map had a hull in range at all times,
     so they all abandoned what they were doing to walk at one and none of them
     entered a building any more — bots indoors went from 7 of 15 to 0. A
     divert has to be opportunistic, not a standing order. */
  const BOT_RIDE_RANGE = 430;
  /* How far a bot will go to pick somebody up, and how far it will go to
     finish somebody off. Reviving reaches further because it is worth more. */
  const BOT_REVIVE_RANGE = 1100;
  const BOT_FINISH_RANGE = 620;

  /* The nearest hull this bot could take: unclaimed, or its own squad's. */
  function botNearestRide(a, range) {
    let best = null, bd = range * range;
    for (const v of agents) {
      if (!v.isVehicle || !v.alive || v.driver) continue;
      if (!v.neutral && v.team !== a.team) continue;
      const dd = dist2(a.x, a.y, v.x, v.y);
      if (dd < bd) { bd = dd; best = v; }
    }
    return best;
  }

  /* Put a bot in the driver's seat. Offline only — online the room decides who
     is driving what, and a client claiming a seat for a bot it does not own is
     exactly the kind of thing the room exists to arbitrate. */
  function botBoard(a, v) {
    if (online || v.driver || !v.alive) return;
    a.riding = v; v.driver = a;
    v.team = a.team; v.neutral = false;
    a.path = null; a.pathTarget = null;
  }

  function nearestRide(x, y, range) {
    let best = null, bd = range * range;
    for (const a of agents) {
      if (!a.isVehicle || !a.alive || a.driver) continue;
      // your squad's, or one nobody has claimed yet
      if (!a.neutral && a.team !== player.team) continue;
      const d = dist2(x, y, a.x, a.y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  function boardVehicle(v) {
    /* Who is in the driver's seat is the room's to say — two people cannot
       both be driving the same jeep, and only the room can arbitrate that. */
    if (online) { online.transport.send('ride', {}); SFX.click(); return; }
    // getting in claims an unclaimed hull for your squad
    if (v.neutral) { v.neutral = false; v.team = player.team; v.aiHold = 0; }
    player.riding = v; v.driver = player;
    v.hullAngle = v.angle;
    player.x = v.x; player.y = v.y;
    player.vx = player.vy = 0;
    input.ads = false;                     // no aiming down sights from a turret
    player.toolActive = false;
    updateWeaponHud();
    hudMsg(`${vehicleDef(v).name} — WASD drive · mouse aim · E to get out`);
    SFX.click();
  }

  /* `thrown` is the blast that killed the vehicle: you come out hurt and to
     the side rather than standing on the wreck. */
  /* Get whoever is actually in the seat out of it.

     This used to be written only for the player: it read `player.riding`,
     moved `player` and damaged `player`. That was safe while the player was
     the only thing that could drive, and it stopped being true the moment
     bots were allowed to take vehicles. A bot's hull brewing up anywhere on
     the map called it, and if you happened to be riding something of your own
     at that moment it threw *you* out of *your* vehicle and put 35 damage on
     you from an explosion you were nowhere near — while the driver of the
     actual wreck stayed welded to it. */
  function ejectDriver(v, thrown) {
    if (!v) return;
    const who = v.driver;
    if (!who || who.riding !== v) return;
    who.riding = null; v.driver = null;
    v.aiHold = 6;
    const side = v.angle + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
    who.x = v.x + Math.cos(side) * (v.r + who.r + 6);
    who.y = v.y + Math.sin(side) * (v.r + who.r + 6);
    resolveObstacles(who);
    if (pointInObstacle(who.x, who.y)) { who.x = v.x; who.y = v.y; }
    if (who.isPlayer) updateWeaponHud();
    if (thrown) {
      applyDamage(who, 35, null, 'true', 'body');
      spawnFx(who.x, who.y, '#ff9d3b', 12);
      if (who.isPlayer) hudMsg('Thrown clear of the wreck');
    } else if (who.isPlayer) {
      hudMsg('Dismounted');
    }
  }

  function exitVehicle(thrown) {
    const v = player.riding;
    if (!v) return;
    // same message both ways: the room knows whether you are in a seat
    if (online && !thrown) { online.transport.send('ride', {}); return; }
    player.riding = null; v.driver = null;
    /* Hold the AI off it for a few seconds. Without this the squad takes the
       vehicle over on the very next frame and drives away, so hopping out to
       grab a crate means losing it — you couldn't even get back in. */
    v.aiHold = 6;
    // step out beside the hull, and never inside a wall
    const side = v.angle + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
    player.x = v.x + Math.cos(side) * (v.r + player.r + 6);
    player.y = v.y + Math.sin(side) * (v.r + player.r + 6);
    resolveObstacles(player);
    if (pointInObstacle(player.x, player.y)) { player.x = v.x; player.y = v.y; }
    updateWeaponHud();
    if (thrown) {
      applyDamage(player, 35, null, 'true', 'body');
      spawnFx(player.x, player.y, '#ff9d3b', 12);
      hudMsg('Thrown clear of the wreck');
    } else {
      hudMsg('Dismounted');
    }
    SFX.click();
  }

  /* Drive: WASD moves the hull, the mouse swings the turret, left click fires
     whatever the vehicle is armed with. */
  function driveVehicle(v, dt) {
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const m = Math.hypot(dx, dy);
    if (m > 0) {
      // one surface model for hulls and bodies alike — see RoomSim.surfaceSpeedFor
      const surf = terrain ? Terrain.surfaceAt(terrain, v.x, v.y) : null;
      const spd = v.vspeed * RoomSim.surfaceSpeedFor(v, surf) * dt;
      const px = v.x, py = v.y;
      v.x += (dx / m) * spd; v.y += (dy / m) * spd;
      resolveObstacles(v);
      v.hullAngle = Math.atan2(dy, dx);
      v.vx = (v.x - px) / dt; v.vy = (v.y - py) / dt;
    } else { v.vx = 0; v.vy = 0; }

    // the player rides along, so the camera and everything keyed off the
    // player's position follow the vehicle for free
    player.x = v.x; player.y = v.y;
    player.vx = v.vx; player.vy = v.vy;

    const psx = (v.x - camX) * zoom, psy = (v.y - camY) * zoom;
    v.angle = Math.atan2(input.my - psy, input.mx - psx);
    player.angle = v.angle;

    if (v.weapon.action === 'auto') { if (input.shooting) triggerFire(v); }
    else if (input.fireEdge) { triggerFire(v); }
    input.fireEdge = false;
  }

  /* --- doors --- */
  const doorCentre = (d) => ({ x: d.x + d.w / 2, y: d.y + d.h / 2 });
  function nearestDoor(x, y, range) {
    let best = null, bd = range * range;
    for (const s of structureRects()) {
      if (!Structures.isDoor(s)) continue;
      // a secret door you haven't noticed yet isn't a door, it's a wall
      if (s.secret && !s.found) continue;
      const c = doorCentre(s);
      const d = dist2(x, y, c.x, c.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /* ---------------- secret doors ----------------
     A hidden door draws as the wall it is set into until you are close enough
     to see the seam. Walking past one at range tells you nothing; standing on
     it announces itself once, and from then on it opens like any other door.

     Checked against the player only — a bot has no business finding these. */
  function findSecrets() {
    if (!player || !player.alive) return;
    const r = Structures.FIND_SECRET;
    for (const s of nearRects(bulletIndex(), player.x, player.y, r)) {
      if (!s.secret || s.found) continue;
      const c = doorCentre(s);
      if (dist2(player.x, player.y, c.x, c.y) > r * r) continue;
      s.found = true;
      invalidateRects();
      hudMsg('You notice a seam in the wall — [E] to open');
      SFX.reward();
      spawnFx(c.x, c.y, '#ffcf4a', 10);
    }
  }
  function toggleDoor(d, who) {
    d.open = !d.open;
    /* Online the room owns the door too, or we'd be the only ones who can walk
       through it. We still swing it open here and now — waiting a round trip
       to touch a door feels broken — and the room's event confirms the same
       state a moment later, so applying it twice changes nothing. */
    if (online && who && who.isPlayer) online.transport.send('door', { id: d.nid, open: d.open });
    invalidateRects();
    const c = doorCentre(d);
    spawnFx(c.x, c.y, '#e2b46e', 5);
    if (who && who.isPlayer) { hudMsg((d.open ? 'Opened ' : 'Closed ') + kindOf(d).name); SFX.click(); }
  }

  /* somebody else worked a door — match it, quietly */
  function netSetDoor(id, open) {
    const s = obstacles.find(o => o.nid === id);
    if (!s || s.open === !!open) return;
    s.open = !!open;
    invalidateRects();
    const c = doorCentre(s);
    spawnFx(c.x, c.y, '#e2b46e', 4);
  }

  /* --- interact (E): doors, crates, ammo boxes --- */
  function interact() {
    // in a vehicle, E is the way out — checked before canAct(), which is false
    // for anyone in a seat
    if (running && !paused && player && player.alive && player.riding) { exitVehicle(false); return; }
    if (!canAct()) return;
    // standing next to a friendly vehicle, E means get in: it outranks loot,
    // because nobody presses E beside a tank hoping for a bandage
    const ride = nearestRide(player.x, player.y, 110);
    if (ride) { boardVehicle(ride); return; }
    // dropped kit first — it's what you most often want when you press E
    if (grabDrop()) return;
    const door = nearestDoor(player.x, player.y, 70);
    if (door) { toggleDoor(door, player); return; }
    let best = null, bi = -1, bd = 95 * 95;
    for (let i = 0; i < crates.length; i++) {
      const c = crates[i];
      if (c.opened) continue;
      const d = dist2(player.x, player.y, c.x, c.y);
      if (d < bd) { bd = d; best = c; bi = i; }
    }
    if (best) {
      /* Online the crate is opened by index, by the room. It rolls the loot and
         it decides who got there first — opening our own copy meant two people
         walking up to the same gold crate each came away with a legendary. */
      if (online) { online.transport.send('crate', { i: bi }); SFX.click(); return; }
      openCrate(best);
      return;
    }
    for (const dp of deployables) {
      if (dp.type === 'ammo' && dp.supply > 0 && near2(dp, player, 95)) {
        player.ammo = player.weapon.mag; dp.supply -= player.weapon.mag;
        updateWeaponHud(); hudMsg('Resupplied'); SFX.reload(); return;
      }
    }
    hudMsg('Nothing to interact with');
  }

  function spawnCrates(n) { withSeed(worldSeed ^ 0x9e37, () => spawnCratesInner(n)); }
  function spawnCratesInner(n) {
    crates = [];
    // Buildings stocked their own loot while the map was generated, but cover
    // placed afterwards can land on top of it — re-check now that the world
    // is final rather than trusting where they were put.
    for (const c of pendingIndoorCrates) {
      if (pointInObstacle(c.x, c.y)) continue;
      crates.push({
        x: c.x, y: c.y, tier: c.tier, opened: false, indoors: true, room: c.room, needs: c.needs,
        // searchable furniture draws as itself rather than as a box
        look: c.look || null, rot: c.rot || 0,
      });
    }
    /* Garages and car parks come with hulls in them. They belong to nobody
       until someone climbs in, which is what makes a camp's parking lot worth
       crossing the map for. */
    parkedVehicles = [];
    for (const v of pendingRoomVehicles) {
      if (pointInObstacle(v.x, v.y)) continue;
      const car = spawnVehicle(-1, v.vtype, v.x, v.y);
      /* Remembered separately from `agents`, because startOnline() clears that
         list — the host supplies everyone in it. The hulls the *map* came with
         are not somebody's agent, they are part of the world, so they have to
         reach the room the same way the walls and the crates do. Without this
         every garage and car park was empty online while being full offline. */
      parkedVehicles.push({ vtype: car.vtype, x: Math.round(car.x), y: Math.round(car.y) });
    }
    pendingRoomVehicles = [];
    for (let i = 0; i < n; i++) {
      let x, y, tries = 0;
      do { x = rand(200, MAP_W - 200); y = rand(200, MAP_H - 200); tries++; }
      while (tries < 40 && (pointInObstacle(x, y) || !Terrain.isSpawnable(terrain, x, y)));
      crates.push({ x, y, tier: Items.rollCrateTier(), opened: false });
    }
  }
  function openCrate(c) {
    /* Some crates want a perk. The pool's silver sits at the bottom of the
       water, so only a Diver gets it — the crate stays shut for everyone else
       rather than quietly not existing. */
    if (c.needs && !Perks.has(player, c.needs)) {
      hudMsg(`Needs the ${Perks.byId(c.needs).name} perk`);
      SFX.click();
      return;
    }
    c.opened = true;
    /* A chest pays out several times over; a locker you have rifled through
       pays out once and quietly. */
    const pay = Items.payoutFor(c.tier);
    for (let i = 0; i < pay.rolls; i++) grantLoot(Items.rollLoot(c.tier));
    // a Scavenger finds the thing at the bottom of the box
    if (Perks.has(player, 'scavenger')) grantLoot(Items.rollLoot(c.tier));
    // ...and a Lockpick finds the false bottom in the furniture
    if (c.tier === 'furniture' && Perks.has(player, 'lockpick')) grantLoot(Items.rollLoot(c.tier));
    if (c.tier === 'chest') hudMsg('Chest opened');
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
        // upgrade whichever of the three pieces is furthest behind
        const slots = [
          { k: 'vest', v: player.vest || 0 },
          { k: 'helmet', v: player.helmet || 0 },
          { k: 'bag', v: player.bag || 0 },
        ].sort((a, b) => a.v - b.v);
        const slot = slots[0].k;
        if (player[slot] >= tier) { hudMsg('Already better equipped'); break; }
        player[slot] = tier;
        if (slot === 'bag') {
          // a bigger bag tops you straight up to its new ceiling
          const b = Combat.bag(tier);
          refillFromBag();
          hudMsg(`${b.name} equipped (×${b.capacity} carry capacity)`);
        } else {
          const piece = slot === 'vest' ? Combat.vest(tier) : Combat.helmet(tier);
          hudMsg(`${piece.name} equipped (${Math.round(piece.speed * -100)}% speed)`);
        }
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

  /* Item slots, tools and call-ins are all on-foot actions — you can't reach
     any of them from a driver's seat. Getting out (E) is handled before this
     check, so it stays available. */
  // on the floor you can crawl and nothing else — no gun, no tool, no boarding
  const canAct = () => running && !paused && player && player.alive && player.inv && !player.riding && !player.downed;

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
    if (g.mode === 'fuze' || g.mode === 'impact' || g.mode === 'c4') {
      // C4 is the demolition charge — it opens what ordinary explosives can't
      explode(g.x, g.y, it.damage, it.radius, g.team, g.owner, 'explosive', g.mode === 'c4' ? 'c4' : null);
      SFX.kill();
    }
    else if (g.mode === 'smoke') smokes.push({ x: g.x, y: g.y, r: it.radius, life: it.duration, max: it.duration });
    else if (g.mode === 'flash') flashDetonate(g.x, g.y, it.radius, it.blind, g.team);
  }
  function flashDetonate(x, y, radius, blind, team) {
    spawnFx(x, y, '#ffffff', 26);
    for (const a of agents) {
      if (!a.alive || a.riding) continue;      // buttoned up behind armour
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
      vx: Math.cos(ang) * TILE * 48, vy: Math.sin(ang) * TILE * 48, sx: s.x, sy: s.y,
      team: s.team, dmg: s.item.damage, falloff: 0.04, range: s.item.range,
      splash: 0, splashR: 0, life: 1.2, owner: s.owner, color: '#35e0ff',
    });
    spawnFx(s.x + Math.cos(ang) * 20, s.y + Math.sin(ang) * 20, '#ffd36a', 2);
  }

  /* barbed wire: slows and cuts anyone standing in it (damage applied in chunks) */
  /* What the ground you are standing on does to you, as a plain lookup with no
     side effects — the prediction path needs to ask this about a position that
     isn't anybody's yet (see predictedPosition), and the room asks the same
     question of its own copy of the map (RoomSim hazardAt).

     Indexed rather than swept. This used to walk all ~1700 obstacles for every
     agent every frame; with a full lobby of bots that is tens of thousands of
     rect tests a frame, spent almost entirely on walls nowhere near anyone.

     Guarded per field, too: only wire declares `slow`, so a Math.min against a
     bush's undefined turned the whole thing into NaN and quietly cancelled the
     slow of any wire you were standing in at the same time. */
  function hazardAt(x, y) {
    const arr = gridAt(bulletIndex(), x, y);
    if (!arr) return null;
    let slow = 1, dps = 0;
    for (const o of arr) {
      if (isSolid(o) || !inRect(x, y, o)) continue;
      const k = kindOf(o);
      if (k.slow) slow = Math.min(slow, k.slow);
      if (k.dps) dps += k.dps;
    }
    return slow < 1 || dps > 0 ? { slow, dps } : null;
  }
  /* barbed wire: slows and cuts anyone standing in it (damage applied in chunks) */
  function wireAt(a, dt) {
    const hz = hazardAt(a.x, a.y);
    if (!hz) return 1;
    /* A Trench Runner crosses wire at walking pace. Both ends have to agree,
       which is why the perk is synced — the room applies the same exemption in
       its own movement step. */
    const ignoreSlow = !!Perks.mod(a, 'ignoreHazardSlow');
    /* Online the room is the one that cuts you — it runs this same wire against
       the same map, and its number is the one the snapshot carries. Applying it
       here as well would take the HP off twice on our own screen and then have
       it corrected back, which reads as flickering health. The slow we do keep:
       both sides predict it, which is what makes it safe to. */
    if (!online && hz.dps > 0) {
      a.wireAcc = (a.wireAcc || 0) + hz.dps * dt;
      // environmental: no hit-zone roll, no armour — the wire just cuts you
      if (a.wireAcc >= 4) { applyDamage(a, a.wireAcc, null, 'true'); a.wireAcc = 0; }
    }
    return ignoreSlow ? 1 : hz.slow;
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
    !camouflaged(b) && !inConcealment(b) &&
    hasLOS(a.x, a.y, b.x, b.y) && !smokeBlocks(a.x, a.y, b.x, b.y);

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
      // someone inside a vehicle isn't a target; the vehicle is
      if (!o.alive || o.team === a.team || o.riding) continue;
      const d = dist2(a.x, a.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    return { enemy: best, d: Math.sqrt(bd) };
  }

  /* ---------------- squad intel (teamwork trait) ----------------
     High-teamwork bots share contacts and pile onto the same target. */
  /* ---------------- pings and emotes ----------------
     Marks are your squad's, so offline they go straight in and online they
     come back from the host, which is the only thing that decides who hears
     them. Either way nothing renders until the mark exists on this client, so
     what you see is what your team sees. */
  let showScores = false;                    // Tab: who's winning, and who's carrying
  let marks = [];                            // pings on the field
  let emotes = [];                           // bubbles over heads, by agent id
  let wheel = null;                          // { kind: 'ping'|'emote', at, hot }
  let commsCd = 0;                           // local cooldown, mirrors the room's

  function addMark(x, y, kind, by, mine) {
    // one ping per person at a time: a new one replaces the last
    if (by) marks = marks.filter(m => m.by !== by);
    marks.push({ x, y, kind, by, life: Comms.MARK_LIFE, mine: !!mine });
    if (marks.length > 12) marks.shift();
    SFX.click();
    const def = Comms.pingById[kind];
    if (def && by) hudMsg(`${by}: ${def.say}`);
    // bots hear an enemy call and go and look
    if ((kind === 'enemy' || kind === 'attack') && player) {
      squadIntel[player.team] = { target: null, x, y, t: 6 };
    }
  }
  function addEmote(agentId, id) {
    emotes = emotes.filter(e => e.agentId !== agentId);
    emotes.push({ agentId, id, life: Comms.EMOTE_LIFE });
  }
  function updateComms(dt) {
    if (commsCd > 0) commsCd -= dt;
    for (let i = marks.length - 1; i >= 0; i--) { marks[i].life -= dt; if (marks[i].life <= 0) marks.splice(i, 1); }
    for (let i = emotes.length - 1; i >= 0; i--) { emotes[i].life -= dt; if (emotes[i].life <= 0) emotes.splice(i, 1); }
  }

  /* Send a ping, or place it ourselves when there is nobody to ask. */
  function sendMark(x, y, kind) {
    if (commsCd > 0 || !player.alive) return;
    commsCd = Comms.COOLDOWN;
    if (online) online.transport.send('mark', { x: Math.round(x), y: Math.round(y), kind });
    else addMark(x, y, kind, 'You', true);
  }
  function sendEmote(id) {
    if (commsCd > 0 || !player.alive) return;
    commsCd = Comms.COOLDOWN;
    if (online) online.transport.send('emote', { id });
    else addEmote('me', id);
  }

  /* The quick ping reads what you pointed at, so the common calls need no
     wheel at all: an enemy under the cursor is "enemy", a crate or a drop is
     "loot", open ground is "on my way". */
  function quickMark() {
    const w = worldMouse();
    let kind = 'going';
    const enemy = agents.find(a => a.alive && a.team !== player.team && dist2(a.x, a.y, w.x, w.y) < 90 * 90);
    const remoteEnemy = online && (online.remote || []).find(
      a => a.alive && a.team !== player.team && dist2(a.x, a.y, w.x, w.y) < 90 * 90);
    const loot = crates.find(c => dist2(c.x, c.y, w.x, w.y) < 70 * 70)
      || drops.find(d => dist2(d.x, d.y, w.x, w.y) < 70 * 70);
    if (enemy || remoteEnemy) kind = 'enemy';
    else if (loot) kind = 'loot';
    sendMark(w.x, w.y, kind);
  }

  /* Wheels open where the cursor is and resolve on release. */
  function openWheel(kind) {
    if (wheel || !running || paused) return;
    wheel = { kind, at: { x: input.mx, y: input.my }, hot: -1 };
  }
  function closeWheel(commit) {
    if (!wheel) return;
    const items = wheel.kind === 'ping' ? Comms.PINGS : Comms.EMOTES;
    const hot = Comms.pick(items, wheel.at.x, wheel.at.y, input.mx, input.my);
    const w = wheel;
    wheel = null;
    if (!commit || hot < 0) return;
    if (w.kind === 'ping') {
      // the ping lands where the wheel was opened, not where you released
      const pt = { x: w.at.x / zoom + camX, y: w.at.y / zoom + camY };
      sendMark(pt.x, pt.y, items[hot].id);
    } else {
      sendEmote(items[hot].id);
    }
  }

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
  /* ---------------- what a bot knows and where it hides ----------------
     The bots could aim, lead a target and hold a standoff distance, but they
     fought in the open and forgot a contact the instant a wall came between
     them. Three things change that: they remember where they last saw you,
     they look for something to stand behind, and a squad approaches from more
     than one angle instead of filing down the same line.

     All of it keys off the existing difficulty traits, so a level-2 bot still
     blunders and a level-10 one does this properly. */

  /* Somewhere near `a` that breaks line of sight to `from`. Samples a ring of
     candidate spots rather than reasoning about geometry — cheap, and good
     enough that the bot ends up behind the wall rather than beside it. */
  const COVER_R = 210;
  function findCover(a, from) {
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + a.coverSeed;
      const r = COVER_R * (0.45 + (i % 3) * 0.28);
      const x = a.x + Math.cos(ang) * r, y = a.y + Math.sin(ang) * r;
      if (x < 40 || y < 40 || x > MAP_W - 40 || y > MAP_H - 40) continue;
      if (pointInObstacle(x, y)) continue;
      if (hasLOS(x, y, from.x, from.y)) continue;         // still exposed
      // prefer close cover, and cover that isn't further into the open
      const score = -dist2(a.x, a.y, x, y) / 1000;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    return best;
  }

  /* A squad that all walks the same bearing gets shot one at a time. Each bot
     carries a fixed offset so the four of them arrive spread across an arc. */
  function flankPoint(a, target, spread) {
    const base = Math.atan2(a.y - target.y, a.x - target.x);
    const ang = base + a.flankBias * spread;
    const r = Math.max(140, Math.hypot(a.x - target.x, a.y - target.y) * 0.85);
    return {
      x: clamp(target.x + Math.cos(ang) * r, 40, MAP_W - 40),
      y: clamp(target.y + Math.sin(ang) * r, 40, MAP_H - 40),
    };
  }

  function updateBot(a, dt) {
    /* Down: no fighting, just dragging yourself toward someone who can pick
       you up. The squad's own logic walks over on its own, because a downed
       teammate is just an agent they can path to. */
    if (a.downed) {
      const mate = agents.find(q => q.alive && !q.downed && !q.isVehicle && q.team === a.team && q !== a);
      if (mate) {
        const ang = Math.atan2(mate.y - a.y, mate.x - a.x);
        const spd = a.weapon.moveSpeed * 0.72 * CRAWL * dt;
        a.x += Math.cos(ang) * spd; a.y += Math.sin(ang) * spd;
        resolveObstacles(a);
        a.angle = ang;
      }
      return;
    }
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

    /* ---- a hull sitting there is a hull worth taking ----
       Garages, car parks and the objective buildings come with unclaimed
       vehicles in them, and until now only a human ever got into one: bots
       walked past a tank to go and fight on foot. A bot heading somewhere
       anyway will divert for one that is roughly on its way, and once it is
       in, the rest of updateBot drives it — a vehicle is an agent like any
       other, so everything below already works from the driver's seat. */
    if (!a.isVehicle && !a.riding && a.alive) {
      a.rideLook = (a.rideLook || 0) - dt;
      if (a.rideLook <= 0) {
        a.rideLook = 1.2;
        /* Opportunistic only: a hull you have practically walked into, and
           only when nothing is shooting at you. Anything more eager and the
           divert stops being a divert — at a 1800px range every bot on the
           map had one in reach permanently, walked at it instead of doing its
           job, and the number that ever got inside a building went from 7 of
           15 to none. */
        const v = botNearestRide(a, BOT_RIDE_RANGE);
        if (v && !(enemy && d < 600)) a.rideWant = v; else a.rideWant = null;
      }
      const want = a.rideWant;
      if (want && want.alive && !want.driver) {
        const dv = Math.hypot(want.x - a.x, want.y - a.y);
        if (dv < a.r + want.r + 34) {
          botBoard(a, want);
          a.rideWant = null;
          return;                              // spend this frame getting in
        }
        // otherwise walk to it, using the same pathing and the same speed
        // model as every other bot movement below
        if (ensurePath(a, want.x, want.y)) {
          const step = followPath(a);
          if (step !== null && step !== undefined) {
            const base = a.weapon.moveSpeed * 0.72 * a.cls.speed
              * Combat.armorSpeed(a) * Combat.adrenaline(a.adrenaline).speed;
            const surf = terrain ? Terrain.surfaceAt(terrain, a.x, a.y) : null;
            const spd = base * (a.wireSlow || 1) * (surf ? surf.speed : 1) * dt;
            const px = a.x, py = a.y;
            a.x += Math.cos(step) * spd; a.y += Math.sin(step) * spd;
            resolveObstacles(a);
            trackStuck(a, px, py, spd, dt);
            a.angle = step;
            return;
          }
        }
      } else if (want) {
        a.rideWant = null;
      }
    }

    /* ---- read the situation before picking a goal ----
       Two things a competent squad does that these bots did not: they pick
       their own people up, and they finish the ones they put down. Both are
       decisions about the *state of the fight* rather than about aim, which
       is what separates a hard bot from an accurate one.

       Reviving comes first, because a squadmate back on their feet is worth
       more than any position on the map. */
    if (!a.isVehicle && !a.riding) {
      a.tacticT = (a.tacticT || 0) - dt;
      if (a.tacticT <= 0) {
        a.tacticT = 0.6;
        a.tacticPt = null;
        // a squadmate on the floor, close enough to be worth the walk
        let best = null, bd = BOT_REVIVE_RANGE * BOT_REVIVE_RANGE;
        for (const q of agents) {
          if (!q.alive || !q.downed || q.team !== a.team || q === a) continue;
          const dd = dist2(a.x, a.y, q.x, q.y);
          if (dd < bd) { bd = dd; best = q; }
        }
        if (best) a.tacticPt = { x: best.x, y: best.y, revive: true };
        else {
          /* Nobody to pick up: finish anyone we have put down. A downed enemy
             is both a kill waiting to happen and bait for whoever comes to
             get them, so closing on one is rarely the wrong move. */
          let kill = null, kd = BOT_FINISH_RANGE * BOT_FINISH_RANGE;
          for (const q of agents) {
            if (!q.alive || !q.downed || q.team === a.team || q.isVehicle) continue;
            const dd = dist2(a.x, a.y, q.x, q.y);
            if (dd < kd) { kd = dd; kill = q; }
          }
          if (kill) a.tacticPt = { x: kill.x, y: kill.y, finish: true };
        }
      }
      /* Walking to a downed body outranks the objective, but never outranks
         someone shooting at you right now. */
      if (a.tacticPt && !(enemy && d < 300)) {
        const tp = a.tacticPt;
        const near = dist2(a.x, a.y, tp.x, tp.y) < (tp.revive ? 60 * 60 : 90 * 90);
        if (!near && ensurePath(a, tp.x, tp.y)) {
          const step = followPath(a);
          if (step !== null && step !== undefined) {
            const base = a.weapon.moveSpeed * 0.72 * a.cls.speed
              * Combat.armorSpeed(a) * Combat.adrenaline(a.adrenaline).speed;
            const surf = terrain ? Terrain.surfaceAt(terrain, a.x, a.y) : null;
            const spd = base * (a.wireSlow || 1) * (surf ? surf.speed : 1) * dt;
            const px = a.x, py = a.y;
            a.x += Math.cos(step) * spd; a.y += Math.sin(step) * spd;
            resolveObstacles(a);
            trackStuck(a, px, py, spd, dt);
            a.angle = step;
            return;                    // committed to it this frame
          }
        }
      }
    }

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
    if (canSee) {
      a.contactT = (a.contactT || 0) + dt;
      shareContact(a, target);
      /* Remember where they were. Losing sight used to wipe the contact
         entirely, so a bot that ducked behind a wall was instantly forgotten
         and the bot outside wandered off — you could break every engagement
         by stepping sideways. */
      a.lastSeen = { x: target.x, y: target.y, t: 0 };
    } else {
      a.contactT = 0;
      if (a.lastSeen) {
        a.lastSeen.t += dt;
        // TEAMWORK — how long they hold the memory scales with the level
        if (a.lastSeen.t > 2 + TEAM.cohesion * 4) a.lastSeen = null;
      }
    }
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
      /* SURVIVAL — take cover rather than standing in the open trading shots.
         Three reasons to break contact: hurt, empty, or simply having stood
         in the open too long.

         That last one uses `exposureTolerance`, a trait that has always been
         in the difficulty table — "seconds they'll stay exposed before
         looking for cover" — and was read by nothing. A level-10 bot ducks
         after 1.2s of being visible; a level-1 bot stands there for six. */
      a.exposedT = canSee ? (a.exposedT || 0) + dt : 0;
      const needsCover = retreating
        || (a.ammo <= 0 && a.weapon.mag > 1)
        || a.exposedT > SURV.exposureTolerance;
      if (SURV.reloadsInCover && needsCover) {
        a.coverT = (a.coverT || 0) - dt;
        if (!a.coverPt || a.coverT <= 0) {
          a.coverPt = findCover(a, target);
          a.coverT = 1.2;
        }
        if (a.coverPt) {
          const ca = Math.atan2(a.coverPt.y - a.y, a.coverPt.x - a.x);
          moveX += Math.cos(ca) * 1.4; moveY += Math.sin(ca) * 1.4;
          // arrived: the clock resets, and they lean back out to fight
          if (dist2(a.x, a.y, a.coverPt.x, a.coverPt.y) < 60 * 60) {
            a.coverPt = null; a.exposedT = 0;
          }
        }
      } else { a.coverPt = null; }
      // reload the moment you're out of their sight, not only while running
      if (SURV.reloadsInCover && a.ammo < a.weapon.mag && (!canSee || needsCover)) startReload(a);
    } else {
      // Not fighting: route somewhere. Head for the objective if there is one,
      // otherwise toward the nearest enemy — but *around* the buildings rather
      // than into them.
      /* Where to go when nobody is in sight. In order: the place we last saw
         somebody (they are probably still near it), then the objective, then
         the nearest enemy — and the approach is offset so a squad arrives on
         a front rather than in single file. */
      let goal = a.aiTargetPt || (enemy ? { x: enemy.x, y: enemy.y } : null);
      if (a.lastSeen && a.lastSeen.t < 3) {
        goal = { x: a.lastSeen.x, y: a.lastSeen.y };
      } else if (enemy && !a.aiTargetPt && TEAM.sharesContacts) {
        goal = flankPoint(a, enemy, 0.9);
      }
      if (goal) {
        let dir = null;
        // a clear straight line is cheaper than a path, and looks better
        if (navGrid && Nav.clearLine(navGrid, a, goal)) {
          const ang = Math.atan2(goal.y - a.y, goal.x - a.x);
          dir = { x: Math.cos(ang), y: Math.sin(ang) };
          a.path = null;
        } else if (ensurePath(a, goal.x, goal.y)) {
          dir = followPath(a);
        }
        if (dir) {
          a.angle = Math.atan2(dir.y, dir.x);
          moveX += dir.x; moveY += dir.y;
        } else {
          // no route at all — fall back to nosing toward it
          const ang = Math.atan2(goal.y - a.y, goal.x - a.x);
          a.angle = ang; moveX += Math.cos(ang); moveY += Math.sin(ang);
        }
        if (a.aiTargetPt && dist2(a.x, a.y, a.aiTargetPt.x, a.aiTargetPt.y) < 90 * 90) {
          a.aiTargetPt = null; a.path = null;
        }
      }
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
  /* ---------------- bot navigation ----------------
     A nav grid is built once per match; bots request a path to wherever they
     want to be and follow the waypoints. Recomputes are staggered and budgeted
     so twenty-odd bots don't all run A* on the same frame. */
  let navGrid = null;
  let pathBudget = 0;
  let navDirty = false, navRebuildIn = 0, navChanges = 0;

  function buildNav() {
    /* Doors are a way in, not a wall. Route through them and open them on
       arrival — otherwise every building is sealed, and since the capture
       points sit inside buildings, nothing could reach an objective at all. */
    navGrid = Nav.build(MAP_W, MAP_H, solidRects().filter(s => !Structures.isDoor(s)));
    if (!terrain) return;
    // Stamp costs by walking the paths rather than asking the terrain about
    // every cell: surfaceAt does a distance-to-polyline test, and running that
    // 5000 times per rebuild was the single most expensive thing in the frame.
    const g = navGrid;
    const stamp = (pts, halfWidth, value) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (Nav.CELL * 0.5));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
          const spread = Math.ceil(halfWidth / Nav.CELL);
          const [ccx, ccy] = Nav.cellOf(x, y);
          for (let dy = -spread; dy <= spread; dy++) {
            for (let dx = -spread; dx <= spread; dx++) {
              const cx = ccx + dx, cy = ccy + dy;
              if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) continue;
              const idx = cy * g.cols + cx;
              if (!g.blocked[idx]) g.cost[idx] = value;
            }
          }
        }
      }
    };
    for (const r of terrain.rivers) stamp(r.pts, r.width / 2, 4);      // avoid swimming
    for (const rd of terrain.roads) stamp(rd.pts, rd.width / 2, 0.7);  // prefer roads
    for (const b of terrain.bridges) {                                  // bridges are fine
      const [cx, cy] = Nav.cellOf(b.x, b.y);
      const spread = Math.ceil(Math.max(b.w, b.h) / 2 / Nav.CELL);
      for (let dy = -spread; dy <= spread; dy++) {
        for (let dx = -spread; dx <= spread; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
          const idx = ny * g.cols + nx;
          if (!g.blocked[idx]) g.cost[idx] = 0.7;
        }
      }
    }
  }

  /* Ask for a path, respecting the per-frame budget. Returns true if the bot
     has a usable route. */
  function ensurePath(a, tx, ty) {
    if (!navGrid) return false;
    const moved = !a.pathTarget || dist2(a.pathTarget.x, a.pathTarget.y, tx, ty) > 240 * 240;
    a.pathAge = (a.pathAge || 0) - 1;
    if (a.path && a.path.length && !moved && a.pathAge > 0) return true;
    if (pathBudget <= 0) return !!(a.path && a.path.length);   // keep the old route this frame

    pathBudget--;
    a.pathTarget = { x: tx, y: ty };
    a.pathAge = 90 + Math.floor(Math.random() * 60);           // ~1.5-2.5s
    a.path = Nav.findPath(navGrid, a.x, a.y, tx, ty) || null;
    a.pathI = 0;
    return !!(a.path && a.path.length);
  }

  /* direction to the next waypoint, advancing as they're reached */
  function followPath(a) {
    if (!a.path || a.pathI >= a.path.length) return null;
    let wp = a.path[a.pathI];
    /* Reached means reached. At 70px a waypoint standing in a doorway counted
       as arrived while the bot was still outside the room, so it skipped to
       the next one and cut the corner straight into the door frame. A doorway
       is 62px, so the radius has to be comfortably inside that. */
    while (wp && dist2(a.x, a.y, wp.x, wp.y) < 34 * 34) {
      a.pathI++;
      wp = a.path[a.pathI];
    }
    if (!wp) { a.path = null; return null; }
    const ang = Math.atan2(wp.y - a.y, wp.x - a.x);
    return { x: Math.cos(ang), y: Math.sin(ang), wp };
  }

  /* Bots walk in straight lines, so a building corner can pin them. If a bot
     barely moves while trying to, give it a sidestep heading for a moment —
     unless what stopped it was a door, in which case it opens the door. */
  function trackStuck(a, px, py, spd, dt) {
    const moved = Math.hypot(a.x - px, a.y - py);
    if (a.stuckDir) { a.stuckT -= dt; if (a.stuckT <= 0) a.stuckDir = 0; return; }
    a.stuckAcc = moved < spd * 0.35 ? (a.stuckAcc || 0) + dt : 0;
    if (a.stuckAcc > 0.2) {
      const d = nearestDoor(a.x + Math.cos(a.angle) * 40, a.y + Math.sin(a.angle) * 40, 60);
      if (d && !d.open) { toggleDoor(d, a); a.stuckAcc = 0; return; }
    }
    if (a.stuckAcc > 0.45) {
      a.stuckDir = a.angle + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
      a.stuckT = 0.9; a.stuckAcc = 0;
    }
  }
  const obj_jitter = (o) => o.x + rand(-o.r * 0.5, o.r * 0.5);
  const obj_jitterY = (o) => o.y + rand(-o.r * 0.5, o.r * 0.5);
  /* Bots engage inside their own gun's effective range, clamped to something
     sane. The ceiling is deliberately about one screen: a sniper bot's rifle
     reaches 56 tiles, but being shot by something you have no way of seeing
     isn't a fight, so they hold until you're on their screen too. */
  const botRange = (w) => clamp(w.range * 0.8, TILE * 8, TILE * 25);

  /* ---------------- update ---------------- */
  function update(dt) {
    updateFeel(dt);
    updateToolRings(dt);
    invalidateRects();
    pathBudget = 2;      // at most two A* runs a frame, spread across the bots          // walls can be built, blown up or opened any frame
    /* Online the match clock belongs to whoever is hosting, and we only read
       it. Counting down locally as well meant the displayed time was our own
       guess for most of every 50ms between snapshots, and a player who joined
       late sat on 8:00 until the first one landed. */
    if (online) timeLeft = onlineClock();
    else timeLeft -= dt;
    if (input.dashCd > 0) input.dashCd -= dt;

    // player status timers
    // adrenaline heals — but spends itself doing it, so it only drains while
    // you're actually hurt. At full health it just sits there buffing you.
    for (const a of agents) {
      if (a.alive) updateLastStand(a, dt);
      if (a.alive) updateDowned(a, dt);
      if (!a.alive || a.isVehicle || !a.adrenaline) continue;
      const adr = Combat.adrenaline(a.adrenaline);
      if (a.hp < a.maxHp) {
        a.hp = Math.min(a.maxHp, a.hp + adr.regen * dt);
        a.adrenaline = Math.max(0, a.adrenaline - 0.1*adr.burn * dt);
        if (a.isPlayer && Math.random() < dt * 3) spawnFx(a.x, a.y, '#4be08a', 1);
      } else {
        a.adrenaline = Math.max(0, a.adrenaline - 0.2 * dt);   // slow idle decay
      }
    }
    if (player.channel) { player.channel.t -= dt; if (player.channel.t <= 0) { player.channel.onDone(); player.channel = null; } }
    if (flashOverlay > 0) flashOverlay -= dt;
    if (hudMessageT > 0) hudMessageT -= dt;
    updateKillFeed(dt);
    updateSoundPings(dt);
    updateBuildingEffect(dt);
    findSecrets();

    // player control — frozen while the lobby is up, so nobody gets a head
    // start wandering off before the match has been started
    if (lobbyOpen()) {
      input.shooting = false; input.fireEdge = false;
      player.vx = player.vy = 0;
    } else if (player.alive && player.riding) {
      // behind the wheel the whole control scheme changes hands: the vehicle
      // moves, aims and shoots, and the player just rides along inside it
      driveVehicle(player.riding, dt);
    } else if (player.alive) {
      const tool = player.tool, gadget = player.toolActive;
      let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      const m = Math.hypot(dx, dy);
      // "standing still" powers the ghillie suit
      player.stillT = m > 0 ? 0 : player.stillT + dt;
      if (m > 0) {
        let base;
        if (online) {
          /* Online we predict with the room's own formula (roomsim.js
             moveSpeedFor) rather than our richer local one. The terms it leaves
             out — channelling, a raised gadget — are states the room has never
             been told about, so applying them here only makes our prediction
             wrong and gets us yanked back.
             Barbed wire used to be in that list, which is why online you walked
             through it as if it were paint. The room runs it now, so we predict
             it too: both sides read the same rect off the same map. */
          base = RoomSim.moveSpeedFor(player, input.ads) * (player.wireSlow || 1);
        } else {
          const adr = Combat.adrenaline(player.adrenaline);
          base = player.weapon.moveSpeed * player.cls.speed;   // class base speed
          base *= Combat.armorSpeed(player);           // vest + helmet weigh you down
          base *= adr.speed;                           // Adren%/2 movement speedup
          if (input.ads) base *= 0.55;                 // aiming slows you
          if (input.ads && player.weapon.scopeMoveMult !== undefined) base *= player.weapon.scopeMoveMult;  // bipod
          if (player.channel) base *= 0.4;             // channeling a heal
          if (gadget && tool.slow) base *= tool.slow;  // binoculars up / shield out
          if (tool.shield && input.ads) base *= tool.slow;
          base *= (player.wireSlow || 1);
        }
        // terrain applies either way: the room is handed the same lookup, so
        // both sides slow down in the same river
        const surf = terrain ? Terrain.surfaceAt(terrain, player.x, player.y) : null;
        /* On the floor you crawl. Slow enough that going down matters, quick
           enough to drag yourself out of the open while help arrives. */
        const spd = base * RoomSim.surfaceSpeedFor(player, surf) * hereSpeed()
          * (player.downed ? CRAWL : 1) * dt;
        const px = player.x, py = player.y;
        /* Clamped to the same bounds the room uses. Without this the client
           walked on past the map edge while the room stopped at the boundary,
           so pressing into the edge opened a gap of a hundred pixels and the
           reconciler spent the whole time dragging you back. Only the
           prediction replay clamped; the live step did not. */
        player.x = clamp(player.x + (dx / m) * spd, BODY_R, MAP_W - BODY_R);
        player.y = clamp(player.y + (dy / m) * spd, BODY_R, MAP_H - BODY_R);
        resolveObstacles(player);
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
    // driving pulls the view out a little: you're bigger, faster, and the
    // things that can hurt you are further away
    if (player.alive && player.riding) zoomTarget = BASE_ZOOM * 0.85;
    else if (player.alive && player.toolActive && player.tool.zoom) zoomTarget = BASE_ZOOM / player.tool.zoom;
    else if (player.alive && input.ads) zoomTarget = BASE_ZOOM * clamp(0.45 + player.weapon.scope * 0.30, 0.45, 1);
    else zoomTarget = BASE_ZOOM;
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
      a.wireSlow = (a.alive && !a.isVehicle && !a.riding) ? wireAt(a, dt) : 1;
      if (!a.isPlayer) a.stillT = Math.hypot(a.vx || 0, a.vy || 0) < 12 ? (a.stillT || 0) + dt : 0;
      if (a.reloadTimer > 0) { a.reloadTimer -= ms; if (a.reloadTimer <= 0) { a.ammo = a.weapon.mag; if (isYours(a)) updateWeaponHud(); } }
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
      // a vehicle the player is driving takes its orders from the player, and
      // one they just stepped out of waits a moment before the squad claims it
      if (a.aiHold > 0) { a.aiHold -= dt; a.vx = a.vy = 0; continue; }
      /* Online there are no bots — the only agents left are you and the hulls
         mirrored out of the snapshot, and every one of those belongs to the
         room. Letting the local AI take the wheel of a networked jeep because
         its driver had stepped out meant this client drove it somewhere nobody
         else could see, and then the next snapshot dragged it back. */
      if (online) continue;
      if (!a.isPlayer && !a.driver) updateBot(a, dt);
    }

    // bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.life -= dt;
      let dead = b.life <= 0;
      /* Walk the round along its flight in short hops instead of teleporting it
         a whole frame. A Barrett round covers 5000px/s — 83px per frame, nearly
         three body-widths — so a single end-of-frame position test would let it
         pass clean through a player, or through a 10px barricade, without ever
         registering; measured, it landed dead-centre shots barely a third of the
         time. Every hop is short enough that nothing can be skipped. */
      let remaining = dead ? 0 : dt;
      while (remaining > 1e-6) {
        const speed = Math.hypot(b.vx, b.vy) || 1;
        const hop = Math.min(remaining, BULLET_STEP / speed);
        remaining -= hop;
        b.px = b.x; b.py = b.y;                // remembered so ricochets know which face was hit
        b.x += b.vx * hop; b.y += b.vy * hop;

        if (b.x < 0 || b.y < 0 || b.x > MAP_W || b.y > MAP_H) { dead = true; break; }
        if (bulletVsWall(b)) { dead = true; break; }

        // a fuzed charge goes off on its timer, so it bounces past people too
        for (const a of (b.fuze ? [] : agents)) {
          if (!a.alive || a.team === b.team || a.riding) continue;
          // Tracer rounds are fatter, so they connect where a normal one misses
          const hitR = a.r * (b.hitR || 1);
          if (dist2(a.x, a.y, b.x, b.y) < hitR * hitR) {
            /* Anti-Tank through a person: it is built for armour and simply
               isn't stopped by infantry. It punches through for a flat 50 and
               carries on as an ordinary round, having spent what made it
               special — so the tank behind them no longer gets the bonus. */
            if (b.antiTank && !a.isVehicle) {
              if (!online) applyDamage(a, Weapons.ANTI_TANK_PASSTHROUGH, b.owner, 'normal');
              spawnFx(b.x, b.y, teamInk(a.team), 6);
              b.antiTank = false; b.dmgType = 'normal';
              continue;                      // still flying
            }
            if (!b.splash) {   // explosives deal their damage via the blast below
              // falloff starts partway into the gun's own effective range
              const travelled = Math.hypot(b.x - b.sx, b.y - b.sy);
              const start = (b.range || FALLOFF_STEP * 6) * FALLOFF_START;
              const steps = Math.max(0, travelled - start) / FALLOFF_STEP;
              const mult = Math.max(FALLOFF_MIN, 1 - b.falloff * steps);
              // armour is what this round is for: double against a hull
              const at = b.antiTank && a.isVehicle ? 2 : 1;
              /* Online our own rounds are drawn, not adjudicated. The room has
                 already resolved this shot against its own copy of the world
                 and the result is in the snapshot; taking the health off here
                 as well meant a hull's bar dropped twice and sprang back, and
                 a vehicle could be "destroyed" on this screen alone — which
                 threw its driver out of a seat they were still sitting in. */
              if (!online) applyDamage(a, b.dmg * mult * at, b.owner, b.dmgType);
              spawnFx(b.x, b.y, teamInk(a.team), 4);
            }
            dead = true; break;
          }
        }
        if (dead) break;

        for (let k = deployables.length - 1; k >= 0; k--) {
          const dp = deployables[k];
          if (dp.type !== 'sentry' || dp.team === b.team) continue;
          if (dist2(dp.x, dp.y, b.x, b.y) < 18 * 18) {
            if (!b.splash) { if (!online) dp.hp -= b.dmg; spawnFx(b.x, b.y, '#35e0ff', 4); }
            // online the sentry list is the room's; it will report the wreck
            if (!online && dp.hp <= 0) { spawnFx(dp.x, dp.y, '#ff9d3b', 12); deployables.splice(k, 1); }
            dead = true; break;
          }
        }
        if (dead) break;
      }
      if (dead) {
        // online the room bursts it and sends the fireball back as an event
        if (b.splash && !online) explode(b.x, b.y, b.dmg, b.splashR, b.team, b.owner, b.dmgType);
        else if (b.splash) spawnFx(b.x, b.y, '#ff9d3b', 22);
        bullets.splice(i, 1);
      }
    }

    // objectives (domination) — online the host owns them, and the snapshot
    // brings back who holds what
    if (mode === 'domination' && !online) updateObjectives(dt);

    // tactical layer
    updateComms(dt);
    updateSquadIntel(dt);
    /* Online every one of these belongs to the room, and the snapshot rewrites
       our copy of them each tick (see netSyncEntities). Running them here as
       well would fly the same grenade twice, trigger our own private copy of a
       mine that has already gone off, and rot loot the room still says is
       there. Offline, nothing has changed. */
    if (!online) {
      updateGrenades(dt);
      updateDrops(dt);
      updateChains(dt);
    }
    // rebuild the nav grid a beat after the world changes, not on every hit
    // Rebuilding the whole grid for every broken crate is wasted work; wait
    // until a few things have changed and then do it once.
    if (navDirty) { navChanges++; navDirty = false; }
    if (navChanges >= 6 && navRebuildIn <= 0) navRebuildIn = 3;
    if (navRebuildIn > 0) {
      navRebuildIn -= dt;
      if (navRebuildIn <= 0) { buildNav(); navChanges = 0; }
    }
    updateAirstrikes(dt);
    if (!online) { updateDeployables(dt); updateSmokes(dt); }

    // fx + damage numbers
    for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.x += f.vx * dt; f.y += f.vy * dt; f.life -= dt; if (f.life <= 0) fx.splice(i, 1); }
    for (let i = dmgNums.length - 1; i >= 0; i--) { const d = dmgNums[i]; d.y -= 30 * dt; d.life -= dt; if (d.life <= 0) dmgNums.splice(i, 1); }

    // camera follow (player, or a living teammate if player is down in elimination)
    const focus = player.alive ? player : (agents.find(a => a.alive && a.team === 0) || player);
    const vw = W / zoom, vh = H / zoom;
    camX = clamp(focus.x - vw / 2, 0, Math.max(0, MAP_W - vw));
    camY = clamp(focus.y - vh / 2, 0, Math.max(0, MAP_H - vh));

    onlineTick(dt);
    if (!online) checkWinConditions();
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
    // Online the room owns wall HP and tells everyone when one falls. Chewing
    // through it locally as well would leave each client with different cover.
    if (!b.splash && !online && Combat.canDamageStructure(wall, src)) {
      wall.lastAttacker = b.owner;
      damageStructure(wall, b.dmg, b.x, b.y);
    }

    /* A fuzed round doesn't care what it hit — it is going off on its timer,
       not on contact — so anything that would normally stop or swallow it
       becomes something to bounce off instead. That is the whole point of the
       ammo: put a charge somewhere you have no line on. */
    if (b.fuze && bal.mode !== 'through') return fuzeBounce(b, wall);

    if (bal.mode === 'stop') { if (!b.splash) spawnFx(b.x, b.y, '#8ea0c9', 3); return true; }

    if (bal.mode === 'pen') {
      // AP/Slug penetration cuts the damage the wall steals; HP/Birdshot adds to it
      const loss = Math.max(0, Math.min(1, (1 - bal.keep) / (1 + (b.pen || 0))));
      b.dmg *= (1 - loss);
      spawnFx(b.x, b.y, '#cfd8ee', 2);
      return b.dmg < 1;                          // spent rounds stop in the wall
    }

    return ricochet(b, wall, bal);
  }

  /* A fuzed round rebounding off cover. Same geometry as a ricochet, but it
     keeps its damage — it hasn't gone off yet, it has only bounced — and it
     sheds speed each time so it settles in a room instead of pinballing
     across the map for the full five seconds. */
  const FUZE_BOUNCE_KEEP = 0.55;
  function fuzeBounce(b, wall) {
    const cameFromSide = b.px === undefined
      ? wall.w < wall.h
      : (b.px < wall.x || b.px > wall.x + wall.w);
    if (cameFromSide) b.vx = -b.vx; else b.vy = -b.vy;
    b.vx *= FUZE_BOUNCE_KEEP; b.vy *= FUZE_BOUNCE_KEEP;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    b.x += (b.vx / sp) * BULLET_STEP * 1.5; b.y += (b.vy / sp) * BULLET_STEP * 1.5;
    b.inWall = null;
    spawnFx(b.x, b.y, '#ffd36a', 2);
    return false;                    // still live, still counting down
  }

  function ricochet(b, wall, bal) {
    // bounce off whichever face the round actually crossed
    const cameFromSide = b.px === undefined
      ? wall.w < wall.h                                  // no history: use the wall's long axis
      : (b.px < wall.x || b.px > wall.x + wall.w);
    if (cameFromSide) b.vx = -b.vx; else b.vy = -b.vy;
    b.dmg *= bal.keep;
    /* Step back off the surface by a fixed nudge rather than a slice of time —
       scaled by velocity, a fast round used to bounce half a room clear. A
       round is never more than one BULLET_STEP deep into the wall it hit, so
       one and a half of them is enough to be certain it is back outside and
       won't ricochet off the same face twice. */
    const sp = Math.hypot(b.vx, b.vy) || 1;
    b.x += (b.vx / sp) * BULLET_STEP * 1.5; b.y += (b.vy / sp) * BULLET_STEP * 1.5;
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
  /* ---------------- last stand ----------------
     Above 100 adrenaline a hit that would kill you doesn't, yet: you keep
     fighting on (Adrenaline−100)/5 seconds of borrowed time, held at 1 HP.
     Heal past it and you keep the life; run out and you drop where you stand.

     It is deliberately a *reward for hoarding* rather than a safety net — the
     same top band drains twice as fast, so the seconds are being spent the
     whole time you hold them. */
  /* ============================================================
     KNOCKED OUT — the shot that puts you down does not have to finish you.

     A squad game where the first hit removes you for good is a game where
     losing a fight is the end of the fight. Going down instead gives your
     squad something to do about it and gives the other side a reason to push
     rather than back off: a downed enemy is bait, and the person crawling to
     them is the shot you actually wanted.

     Down means: on the floor, no weapon, crawling at a fraction of pace, and
     bleeding out on a clock. A teammate standing over you for REVIVE_SECS
     brings you back on a sliver of health. Nobody revives themselves.
     ============================================================ */
  const BLEED_OUT = 22;          // seconds on the floor before it is over
  const REVIVE_SECS = 3.2;       // how long a teammate has to stand there
  const REVIVE_REACH = 74;       // and how close
  const REVIVE_HP = 0.35;        // what you come back on
  const CRAWL = 0.32;            // fraction of normal pace while down

  function knockOut(a, owner) {
    if (a.isVehicle || a.riding) return false;      // hulls brew up, they don't bleed
    if (a.downed) return false;                     // already down: this one finishes it
    if (mode !== 'domination' && !a.isPlayer && !squadOf(a).length) return false;
    a.downed = true;
    a.bleed = BLEED_OUT;
    a.reviveT = 0;
    a.hp = 1;                                       // alive, but only just
    a.toolActive = false;
    a.path = null;
    spawnFx(a.x, a.y, '#ff4b5c', 18);
    if (owner) { owner.streak = owner.streak || 0; }
    if (a.isPlayer) {
      hudMsg('DOWN — hold on, someone can bring you back');
      SFX.hurt(); addShake(6);
    } else if (a.team === (player && player.team)) {
      hudMsg(nameOf(a, 'A teammate') + ' is down');
    }
    return true;
  }

  /* Everyone on your side who is up and can reach you. */
  const squadOf = (a) => agents.filter(q => q.alive && !q.downed && !q.isVehicle && q.team === a.team && q !== a);

  /* Finish what the knockdown started. */
  function bleedOut(a) {
    a.downed = false; a.reviveT = 0;
    a.hp = 0;
    killAgent(a, a.lastAttacker || null, null);
  }

  /* Back on your feet. */
  function reviveAgent(a, by) {
    a.downed = false; a.bleed = 0; a.reviveT = 0;
    a.hp = Math.round(a.maxHp * REVIVE_HP);
    a.adrenaline = 0;
    spawnFx(a.x, a.y, '#4be08a', 20);
    if (a.isPlayer || (by && by.isPlayer)) SFX.reward();
    if (a.isPlayer) { hudMsg('BACK UP — ' + a.hp + ' HP'); addShake(3); }
    else if (by && by.isPlayer) hudMsg('Revived ' + nameOf(a, 'a teammate'));
    if (by) { by.revives = (by.revives || 0) + 1; if (by.isPlayer) matchStats.revives = (matchStats.revives || 0) + 1; }
  }

  /* Tick every downed agent: bleed, and count anyone working on them. A medic
     with the paddles does it in half the time — the class whose whole tool is
     bringing people back should be the best at bringing people back. */
  function updateDowned(a, dt) {
    if (!a.downed || !a.alive) return;
    const helpers = agents.filter(q => q.alive && !q.downed && !q.isVehicle && !q.riding
      && q.team === a.team && q !== a
      && dist2(q.x, q.y, a.x, a.y) < REVIVE_REACH * REVIVE_REACH);
    if (helpers.length) {
      const fast = helpers.some(q => q.tool && q.tool.id === 'defibrillator') ? 2 : 1;
      a.reviveT += dt * fast * Math.min(2, helpers.length);
      if (a.isPlayer && Math.random() < dt * 6) spawnFx(a.x, a.y, '#4be08a', 1);
      if (a.reviveT >= REVIVE_SECS) { reviveAgent(a, helpers[0]); return; }
    } else if (a.reviveT > 0) {
      a.reviveT = Math.max(0, a.reviveT - dt * 1.5);   // interrupted, but not from scratch
    }
    a.bleed -= dt;
    if (a.bleed <= 0) bleedOut(a);
  }

  function lastStand(a) {
    if (a.isVehicle) return false;
    if (a.standT > 0) { a.hp = 1; return true; }      // already on borrowed time
    const secs = Combat.adrenaline(a.adrenaline).lastStand;
    if (secs <= 0) return false;
    a.standT = secs;
    a.hp = 1;
    spawnFx(a.x, a.y, '#ff4b5c', 16);
    if (a.isPlayer) { hudMsg(`LAST STAND — ${secs.toFixed(1)}s`); SFX.hurt(); }
    return true;
  }

  /* Burn down the borrowed time. Ticked for every agent each frame; when it
     runs out, whatever was keeping them up stops. */
  function updateLastStand(a, dt) {
    if (!a.standT || a.standT <= 0) return;
    a.standT -= dt;
    if (a.isPlayer && Math.random() < dt * 8) spawnFx(a.x, a.y, '#ff4b5c', 1);
    if (a.standT <= 0) {
      a.standT = 0;
      /* The adrenaline went into staying upright, so it is gone. That is also
         what stops this repeating: with none left there is no second stand to
         enter on the way down. */
      a.adrenaline = 0;
      // out of time: finish what the killing blow started
      applyDamage(a, 999, a.lastHitBy || null, 'true');
    }
  }

  function applyDamage(a, dmg, owner, type = 'normal', zone = null) {
    /* Feedback, before any of the mitigation below can turn the number into a
       zero: you still want to know you connected with a shot that a vest ate. */
    if (owner && owner.isPlayer && a !== player && !a.isPlayer) {
      addHitMarker(a.hp - dmg <= 0 ? 'kill' : (zone === 'head' ? 'head' : 'normal'));
      SFX.click();
    }
    if (a.isPlayer) {
      if (owner) addHurtArc(owner.x, owner.y);
      addShake(Math.min(7, 2 + dmg * 0.09));
    }
    dmg *= shieldFactor(a, owner);
    // hardened cover: a bunker or a vault takes some of it for you
    if (a.isPlayer) dmg *= hereDamageMult();
    /* Dug in. A trench is a hole in the ground, so what protects you is that
       most of you is below the line the round is travelling on — and that
       depends on where the round came from. Somebody firing across the field
       is shooting at a helmet; somebody standing on the lip is shooting down
       at all of you, and the hole is worth nothing.

       So the dodge is the table's value at range and falls away to nothing up
       close, rather than being a flat coin flip whoever is shooting and from
       where. Explosions ignore it entirely: a trench is the worst place to be
       when something goes off in it. */
    if (!a.isVehicle && inTrench(a) && type !== 'explosive' && type !== 'heat') {
      const base = Structures.WALL_TYPES.trench.dodge;
      const range = owner ? Math.hypot(owner.x - a.x, owner.y - a.y) : 900;
      // no cover from someone on top of you; full cover from 500px out
      const grazing = clamp((range - 90) / 410, 0, 1);
      // ...and none at all from someone else who is also down in the ditch
      const alsoDug = owner && inTrench(owner) ? 0.35 : 1;
      if (Math.random() < base * grazing * alsoDug) {
        spawnFx(a.x, a.y, '#b08a5a', 4);
        if (a.isPlayer) addShake(1.5);
        return;
      }
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
    if (owner) a.lastHitBy = owner;      // credited if a last stand runs out
    if (DB.getSettings().dmgNumbers) {
      dmgNums.push({
        x: a.x, y: a.y - a.r, val: Math.round(dmg), life: 0.7,
        crit: hit.zone === 'head', zone: hit.zone,
      });
    }
    if (hit.zone === 'head' && owner && owner.isPlayer) SFX.reward();
    if (a.isPlayer) SFX.hurt();
    if (a.hp <= 0 && lastStand(a)) return;   // running on adrenaline, not blood
    if (a.hp <= 0 && knockOut(a, owner)) return;   // down, not dead — yet
    if (a.hp <= 0) killAgent(a, owner, hit.zone);
  }

  /* The one place an agent actually dies. Pulled out of applyDamage so that
     bleeding out on the floor goes through exactly the same path — the score,
     the kill feed and the respawn clock should not depend on whether the last
     point of damage or the bleed timer was what finished it. */
  function killAgent(a, owner, zone) {
    if (!a.alive) return;
    a.hp = 0; a.alive = false;
    a.downed = false; a.reviveT = 0;
    a.deaths++; a.streak = 0;
    a.standT = 0;
    spawnFx(a.x, a.y, teamInk(a.team), 14);
    if (owner) { owner.kills++; if (owner.isPlayer) { matchStats.kills++; SFX.kill(); } }
    pushKill(owner, a, zone);
    if (mode === 'domination') a.respawnTimer = 3;
    if (a.isPlayer) SFX.hurt();
    // brewed up with someone inside: throw the driver clear rather than
    // leaving them welded to a dead agent with no way out
    if (a.isVehicle && a.driver && a.driver.riding === a) {
      explode(a.x, a.y, 60, a.r * 3, a.team, owner, 'explosive');
      ejectDriver(a, true);          // whoever was in *this* hull, not the player
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

  /* ---------------- final leaderboard ----------------
     Every operator in the match, best first. Offline that's the agent list;
     online it's the roster the server sends with its `end` message, which is
     authoritative and includes players who already left. Both shapes are just
     { name, team, kills, deaths }, so one renderer covers them. */
  function buildLeaderboard(roster) {
    const rows = roster
      ? roster.map(r => ({
        name: r.name, team: r.team, kills: r.kills || 0, deaths: r.deaths || 0,
        isPlayer: !!(online && r.id === online.id),
      }))
      : agents.filter(a => !a.isVehicle).map(a => ({
        name: a.name, team: a.team, kills: a.kills || 0, deaths: a.deaths || 0,
        isPlayer: !!a.isPlayer,
      }));
    // most kills wins; fewest deaths breaks the tie, then name so it's stable
    rows.sort((x, y) => y.kills - x.kills || x.deaths - y.deaths || x.name.localeCompare(y.name));
    return rows;
  }

  function renderLeaderboard(rows) {
    const box = document.getElementById('res-board');
    if (!box) return;
    const esc = (s) => String(s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    box.innerHTML = rows.map((r, i) => {
      const kd = r.deaths ? (r.kills / r.deaths).toFixed(2) : r.kills.toFixed(2);
      const colour = TEAM_COLORS[r.team] || '#8ea0c9';
      const squad = TEAM_NAMES[r.team] || '—';
      return `<div class="board__row${r.isPlayer ? ' is-you' : ''}">
        <span class="board__rank">${i + 1}</span>
        <span class="board__name">${esc(r.name)}${r.isPlayer ? ' <em>(you)</em>' : ''}</span>
        <span class="board__squad"><i style="background:${colour}"></i>${squad}</span>
        <span class="board__num">${r.kills}</span>
        <span class="board__num">${r.deaths}</span>
        <span class="board__num">${kd}</span>
      </div>`;
    }).join('');

  }

  /* Scroll your own row into view. A 24-player board only shows eight rows at a
     time, and finishing 24th means the one row you actually want to read is the
     one you'd have to go looking for.

     This has to run *after* the results panel is shown: while it's still
     hidden the list has no clientHeight, so the arithmetic below lands on
     scrollTop 0 and the row stays buried. */
  function scrollBoardToPlayer() {
    const box = document.getElementById('res-board');
    const you = box && box.querySelector('.is-you');
    if (!you || !box.clientHeight) return;
    const target = you.offsetTop - (box.clientHeight - you.offsetHeight) / 2;
    box.scrollTop = Math.max(0, Math.min(target, box.scrollHeight - box.clientHeight));
  }

  /* ---------------- match end + rewards ---------------- */
  function endMatch(won, roster) {
    if (!running) return;
    running = false;
    input.shooting = false;
    showLobby(false);
    // snapshot the board before `online` is torn down by the caller
    const board = buildLeaderboard(roster);

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
    renderLeaderboard(board);
    document.getElementById('game-results').classList.add('is-open');
    requestAnimationFrame(scrollBoardToPlayer);   // needs the panel laid out first
    won ? SFX.win() : SFX.lose();

    /* Close the room down with the match. It used to outlive it: the two
       intervals kept stepping, the code stayed registered with the broker, and
       hosting again just abandoned the first room rather than replacing it —
       so anyone still holding the old code joined a game that no longer had a
       host in it. The delay lets the final `end` message reach everyone before
       the connection they'd receive it on goes away. */
    if (typeof P2P !== 'undefined' && P2P.isActive()) setTimeout(() => P2P.stop(), 2000);
  }

  /* ---------------- fx ---------------- */
  function spawnFx(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(30, 160);
      fx.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.5), color, r: rand(1.5, 3.5) });
    }
  }

  /* ---------------- HUD ---------------- */
  /* While driving, the bottom HUD describes the vehicle rather than the
     player: its gun is the one that fires, its magazine is the one that runs
     out, and its hull is the health that matters. */
  const hudSubject = () => (player && player.riding) || player;

  function updateWeaponHud() {
    if (!player) return;
    const s = hudSubject();
    const name = s.isVehicle ? `${vehicleDef(s).icon} ${s.weapon.name}` : s.weapon.name;
    document.getElementById('hud-weapon').textContent = name;
    document.getElementById('hud-ammo').textContent = s.reloadTimer > 0 ? '⟳' : s.ammo;
    document.getElementById('hud-ammomax').textContent = '/' + s.weapon.mag;
  }

  /* ---------------- hosted-match chip ----------------
     The join code used to exist only in the lobby's status line, which is
     behind the game screen from the moment you deploy — so a host had no way
     to read out the one thing anyone needs in order to join them. It lives on
     the HUD for the whole match now, with a live headcount, and clicking it
     copies the invite link. */
  let roomChipCode = null;
  function updateRoomChip() {
    const el = document.getElementById('hud-room');
    if (!el) return;
    const info = (typeof P2P !== 'undefined' && online) ? P2P.roomInfo() : null;
    if (!info || !info.code || info.local) { el.hidden = true; roomChipCode = null; return; }
    el.hidden = false;
    const players = info.hosting ? info.players : Math.max(1, (online.remote || []).length + 1);
    // rebuilding the markup every frame would fight the copy click
    const label = `${info.hosting ? 'HOSTING' : 'ROOM'} ${info.code} · ${players}`;
    if (el.dataset.label !== label) {
      el.dataset.label = label;
      el.innerHTML = `${info.hosting ? 'HOSTING' : 'ROOM'} ${info.code}`
        + `<span class="hud__room-n">${players} in game</span>`;
    }
    roomChipCode = info.code;
  }

  function bindRoomChip() {
    const el = document.getElementById('hud-room');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', () => {
      if (!roomChipCode) return;
      const link = `${location.origin}${location.pathname}?game=${roomChipCode}`;
      if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
      Toast.show('Invite link copied — code ' + roomChipCode);
    });
  }

  function updateHud() {
    // health + ammo track whatever you're currently fighting from
    const s = hudSubject();
    document.getElementById('hud-hpfill').style.width = clamp(s.hp / s.maxHp * 100, 0, 100) + '%';
    document.getElementById('hud-ammo').textContent = s.reloadTimer > 0 ? '⟳' : s.ammo;
    // timer
    const t = Math.max(0, Math.floor(timeLeft));
    document.getElementById('hud-gametimer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    updateRoomChip();
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
      /* Who holds this, shown as something physical rather than only as a
         tinted circle. A captured point gets a planted standard in the
         holder's colour with a claimed base ring; a contested one shows the
         attacker's colour bleeding into it. Standing on a letter told you
         where you were, not whose it was. */
      ctx.fillStyle = col; ctx.font = 'bold 40px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.5; ctx.fillText(obj.name, obj.x, obj.y); ctx.globalAlpha = 1;

      if (obj.owner >= 0) {
        // a ring of claim markers around the point: this ground is taken
        const pegs = 8;
        for (let i = 0; i < pegs; i++) {
          const a2 = (i / pegs) * Math.PI * 2 + (obj.owner * 0.4);
          const px = obj.x + Math.cos(a2) * (obj.r - 14);
          const py = obj.y + Math.sin(a2) * (obj.r - 14);
          ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fillStyle = hexA(col, 0.9); ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
        }
        // and a standard planted in the middle of it, flying their colour
        const fy = obj.y - 34;
        ctx.strokeStyle = '#6d6a63'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(obj.x, obj.y + 6); ctx.lineTo(obj.x, fy - 26); ctx.stroke();
        // the banner ripples, so a held point reads as alive from a distance
        const wave = Math.sin(performance.now() / 320 + obj.x) * 4;
        ctx.beginPath();
        ctx.moveTo(obj.x + 2, fy - 26);
        ctx.quadraticCurveTo(obj.x + 26, fy - 22 + wave, obj.x + 46, fy - 16);
        ctx.lineTo(obj.x + 46, fy - 2);
        ctx.quadraticCurveTo(obj.x + 26, fy - 8 + wave, obj.x + 2, fy - 4);
        ctx.closePath();
        ctx.fillStyle = hexA(col, 0.95); ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke();
        ctx.fillStyle = '#12161f'; ctx.font = 'bold 15px Segoe UI';
        ctx.fillText(obj.name, obj.x + 22, fy - 13);
      } else if (obj.progress > 0 && obj.capTeam >= 0) {
        // being taken: the attacker's colour creeping in from the edge
        const take = TEAM_COLORS[obj.capTeam];
        ctx.globalAlpha = 0.16 + (obj.progress / 100) * 0.24;
        ctx.beginPath(); ctx.arc(obj.x, obj.y, obj.r * (obj.progress / 100), 0, Math.PI * 2);
        ctx.fillStyle = take; ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    drawBasements();   // cellar floors, below everything
    drawUpperFloors();  // ...and the storeys above them
    perfMark('floors', drawFloors);        // building interiors, under everything in them
    perfMark('light', drawInteriorLight);  // and how well lit they are
    drawBasementLight();
    // decor sits on the ground, under the walls and everyone
    perfMark('decor', drawDecor);
    // every shadow in one pass, then the things that cast them
    perfMark('structShadows', drawStructureShadows);
    perfMark('structures', () => {
      let n = 0;
      for (const o of obstacles) if (rectOnScreen(o)) { drawStructure(o); n++; }
      drawObjectiveFlags();
      perfCount('structuresDrawn', n);
    });

    drawToolRings();
    drawCratesAndDeployables();
    drawDrops();

    // fx under agents
    for (const f of fx) { ctx.globalAlpha = clamp(f.life * 2.5, 0, 1); ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;

    // bullets — ours, predicted locally so firing feels instant
    for (const b of bullets) {
      ctx.strokeStyle = b.ricochet ? 'rgba(255,207,74,0.95)' : hexA(TEAM_COLORS[b.team], 0.9);
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02); ctx.stroke();
    }
    /* ...and everyone else's, straight from the room. The snapshot has always
       carried these and nothing ever read them, so in an online match you took
       fire from an enemy without a single round being drawn — people were
       being shot by an empty field. Ours are filtered out by owner because we
       already drew them above. */
    if (online && online.bullets) {
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const b of online.bullets) {
        // the round's own tracer colour, not a flat team stripe — see netBullets
        ctx.strokeStyle = hexA(b.color, 0.9);
        ctx.lineWidth = 2 * (b.wide || 1);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - Math.cos(b.a) * b.len, b.y - Math.sin(b.a) * b.len);
        ctx.stroke();
      }
      ctx.lineWidth = 2;
    }
    drawGrenades();

    // agents
    for (const a of agents) {
      if (!a.alive) {
        if (mode === 'domination' && !a.isVehicle) { // respawn marker
          ctx.globalAlpha = 0.25; ctx.fillStyle = teamInk(a.team);
          ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
        continue;
      }
      if (a.isVehicle) { drawUnitShadow(a.x, a.y, a.r * 1.15); drawVehicle(a); continue; }
      if (a.riding) continue;                 // inside the hull, not on the field
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
      /* The weapon, drawn to its own outline. Every gun used to be the same
         white 12px line at 5px wide, so a Makarov and a Barrett looked
         identical and you could not tell what anyone was carrying. The shape
         comes from Skins.profileFor — length, thickness, stock, magazine,
         optic and muzzle — and a bought skin repaints it without changing it. */
      drawWeapon(a);
      /* Down: flat on the floor, so it reads as a body rather than a player
         who happens to be standing still. */
      if (a.downed) {
        ctx.save();
        ctx.translate(a.x, a.y); ctx.rotate(a.angle);
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.ellipse(0, 0, a.r * 1.25, a.r * 0.6, 0, 0, Math.PI * 2);
        ctx.fillStyle = teamInk(a.team); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
        ctx.restore();
        // bleed-out clock, draining; and the revive filling over the top of it
        const bw = 34;
        const bx = a.x - bw / 2, by = a.y - a.r - 14;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, by, bw, 5);
        ctx.fillStyle = '#ff4b5c';
        ctx.fillRect(bx, by, bw * clamp(a.bleed / BLEED_OUT, 0, 1), 5);
        if (a.reviveT > 0) {
          ctx.fillStyle = '#4be08a';
          ctx.fillRect(bx, by, bw * clamp(a.reviveT / REVIVE_SECS, 0, 1), 5);
        }
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Segoe UI'; ctx.textAlign = 'center';
        ctx.fillText(a.team === (player && player.team) ? 'DOWN' : 'DOWNED', a.x, by - 6);
        ctx.globalAlpha = 1;
        return;
      }
      // body
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.fillStyle = teamInk(a.team); ctx.fill();
      ctx.lineWidth = a.isPlayer ? 4 : 2;
      ctx.strokeStyle = a.isPlayer ? '#fff' : 'rgba(0,0,0,0.4)'; ctx.stroke();
      // player glow ring
      if (a.isPlayer) { ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 6, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(53,224,255,0.6)'; ctx.lineWidth = 2; ctx.stroke(); }
      // health bar — kept proportional to the body it sits over
      const hpw = 26;
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

    drawRemotePlayers();  // server-owned players in an online match
    drawVisionTools();   // heat / night vision markers sit over the units
    drawMarks();         // your squad's pings, over the world they point at
    drawEmotes();        // and what everyone is saying about it

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

    drawBuildingShadows();   // the roofs' own shadows, under them
    perfMark('roofs', drawRoofs);   // roofs hide interiors until you step inside
    drawSmokes();   // smoke sits above units to obscure them

    ctx.restore();

    // dead overlay hint
    if (!player.alive && running) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 34px Segoe UI';
      // online the host decides when you're back, so show its count, not ours
      const left = online ? online.respawn : Math.ceil(player.respawnTimer || 0);
      ctx.fillText(
        mode === 'domination' ? (left > 0 ? `RESPAWNING IN ${left}` : 'RESPAWNING…')
          : 'ELIMINATED — spectating',
        W / 2, H / 2);
    }

    // night-vision tint is a screen-space wash
    if (player.alive && player.toolActive && player.tool.nightFov) {
      ctx.fillStyle = 'rgba(75,224,138,0.12)'; ctx.fillRect(0, 0, W, H);
    }

    drawTacticalHud();
    perfMark('sight', drawSightShadows);   // hide what the walls stand in front of
    drawSoundPings();
    drawMinimap();
    drawKillFeed();
    drawKillBanner();
    drawOffscreenMarks();   // pings behind you still have to be findable
    drawScoreboard();       // hold Tab
    drawWheel();            // the ping / emote wheel, when one is open

    // flashbang whiteout (screen space, over everything)
    if (flashOverlay > 0) { ctx.fillStyle = `rgba(255,255,255,${clamp(flashOverlay / 1.5, 0, 0.96)})`; ctx.fillRect(0, 0, W, H); }
  }

  /* ---------------- the island ----------------
     Painted in bands from the outside in, the way the terrain is generated:
     ocean, then beach, then grass, then the river cut through it, then the
     bridges and roads laid on top. */
  function drawIsland() {
    const T = terrain; if (!T) return;
    /* This island's palette, not the global one: the biome the seed rolled
       overrides the colours it changes and inherits the rest. */
    const C = (terrain && terrain.colors) || Terrain.COLORS;

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
      ctx.fillStyle = C.bridge;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.strokeStyle = C.bridgeEdge; ctx.lineWidth = 5;
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
    /* A trench is a hole, so it is drawn as one: spoil heaped on the rim,
       the cut face catching the light on one side and in shadow on the other,
       and the floor darker than the ground around it. It used to be a flat
       brown disc, which read as a stain rather than as something you get
       down into. */
    for (const t of trenches) {
      // spoil — the earth that came out of it, piled around the lip
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r + 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(122,96,62,0.55)'; ctx.fill();
      // the cut: lit from the same low sun everything else uses
      const g = ctx.createLinearGradient(t.x, t.y - t.r, t.x, t.y + t.r);
      g.addColorStop(0, 'rgba(38,28,18,0.82)');      // far wall, in shadow
      g.addColorStop(0.55, 'rgba(66,50,32,0.7)');
      g.addColorStop(1, 'rgba(104,82,54,0.6)');      // near lip, catching light
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      // and a hard edge, so the drop is legible from above
      ctx.strokeStyle = 'rgba(24,18,12,0.75)'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r - 3, Math.PI * 0.15, Math.PI * 0.85);
      ctx.strokeStyle = 'rgba(190,158,110,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  /* ---------------- shadows & decor ----------------
     One low sun, so everything casts the same way. Shadows are drawn as a
     separate pass under the objects that cast them, which keeps them from
     ever landing on top of something they should be beneath. */
  /* One sun for the whole map, and one set of constants for what it does, so
     a crate, a wall, a building and a player all throw their shadow the same
     way and the same distance per unit of height. Before this the buildings
     — the biggest things on the map — cast nothing at all, and round props
     got rectangular shadows while identical props in `decor` got round ones. */
  const SUN = { dx: 0.55, dy: 0.38 };          // direction shadows are thrown
  const SHADOW = 'rgba(0,0,0,0.34)';
  const SHADOW_SOFT = 'rgba(0,0,0,0.22)';
  const SHADOW_FLATTEN = 0.58;                 // a low sun squashes a ground shadow
  const LIFT_WALL = 26;                        // px of throw per metre of thickness
  const LIFT_LOW = 6;                          // low cover barely lifts off the floor
  const LIFT_BUILDING = 22;                    // a roof stands well clear of the ground

  /* an ellipse on the ground, flattened the way the sun says */
  function groundShadow(x, y, r, throwPx, fill) {
    ctx.save();
    ctx.fillStyle = fill || SHADOW;
    ctx.translate(x + SUN.dx * throwPx, y + SUN.dy * throwPx);
    ctx.scale(1, SHADOW_FLATTEN);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

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
      const lift = (s.thickness || 0.3) * LIFT_WALL;       // thicker wall, longer shadow
      // a round prop throws a round shadow, not a rectangular one
      if (k.round) { groundShadow(s.x + s.w / 2, s.y + s.h / 2, s.w * 0.46, lift); continue; }
      roundRect(s.x + SUN.dx * lift, s.y + SUN.dy * lift, s.w, s.h, 5);
      ctx.fill();
      ctx.fillStyle = SHADOW;
    }
    // low cover gets a tighter, softer shadow
    ctx.fillStyle = SHADOW_SOFT;
    for (const s of structureRects()) {
      const k = kindOf(s);
      if (k.height !== 'low' || k.passable) continue;
      if (!rectOnScreen(s)) continue;
      if (k.round) { groundShadow(s.x + s.w / 2, s.y + s.h / 2, s.w * 0.44, LIFT_LOW, SHADOW_SOFT); continue; }
      roundRect(s.x + SUN.dx * LIFT_LOW, s.y + SUN.dy * LIFT_LOW, s.w, s.h, 3);
      ctx.fill();
      ctx.fillStyle = SHADOW_SOFT;
    }
  }

  /* The buildings themselves. A roof is the tallest thing on the map and used
     to throw nothing, so a warehouse read as flat paint on the grass while the
     fence beside it had a shadow. Drawn under the roofs, and only while the
     roof is actually up — once it lifts for you, the shadow goes with it. */
  function drawBuildingShadows() {
    ctx.fillStyle = SHADOW;
    for (const b of buildings) {
      if (!rectOnScreen(b)) continue;
      const a2 = b.roofAlpha === undefined ? 1 : b.roofAlpha;
      if (a2 < 0.03) continue;
      ctx.globalAlpha = a2;
      roundRect(b.x - 8 + SUN.dx * LIFT_BUILDING, b.y - 8 + SUN.dy * LIFT_BUILDING,
        b.w + 16, b.h + 16, 6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* props: shadow first, then the prop, so a tree never shades itself */
  function drawDecor() {
    if (!decor.length) return;
    // shadows
    for (const d of decor) {
      const m = Sprites.META[d.kind]; if (!m) continue;
      const r = m.r * d.scale;
      if (!onScreen(d.x, d.y, r + m.shadow)) continue;
      groundShadow(d.x, d.y, r * 0.85, m.shadow);
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
    groundShadow(x, y, r * 1.02, 7);
  }

  /* ---------------- floors & roofs ----------------
     A building reads as a place you go inside: its floor is a different
     material from the ground outside, and its roof sits over the top until
     you (or a squadmate) step in, at which point it lifts. */
  /* Each building rules its floor its own way, so what you are standing in is
     legible from the material rather than from remembering the layout: boards
     in a house, tiles in a hospital, slab joints in a bunker, corrugate in a
     hangar, and bare speckled ground in a camp. */
  function drawFloorPattern(b, st) {
    const p = st.pattern || 'planks';
    if (p === 'dirt') {
      // no ruling — a handful of stones, seeded off the position so they
      // don't crawl about between frames
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      let n = (b.x * 73856093) ^ (b.y * 19349663);
      for (let i = 0; i < 26; i++) {
        n = (n * 1103515245 + 12345) & 0x7fffffff;
        const px = b.x + (n % b.w), py = b.y + ((n >> 8) % b.h);
        ctx.fillRect(px, py, 3, 2);
      }
      return;
    }
    ctx.beginPath();
    if (p === 'planks') {
      ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth = 1;
      for (let x = b.x + 40; x < b.x + b.w; x += 40) { ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.h); }
    } else if (p === 'tile') {
      ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 1;
      for (let x = b.x + 34; x < b.x + b.w; x += 34) { ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.h); }
      for (let y = b.y + 34; y < b.y + b.h; y += 34) { ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.w, y); }
    } else if (p === 'concrete') {
      ctx.strokeStyle = 'rgba(0,0,0,0.20)'; ctx.lineWidth = 2;
      for (let x = b.x + 96; x < b.x + b.w; x += 96) { ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.h); }
      for (let y = b.y + 96; y < b.y + b.h; y += 96) { ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.w, y); }
    } else {                                  // metal: tight corrugation
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 3;
      for (let x = b.x + 14; x < b.x + b.w; x += 22) { ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.h); }
    }
    ctx.stroke();
  }

  function drawFloors() {
    for (const b of buildings) {
      if (!b.floor || !rectOnScreen(b)) continue;
      const st = b.style || Structures.styleOf(b.name);
      ctx.fillStyle = b.floor;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      drawFloorPattern(b, st);
      /* Then each room lays its own floor on top. A building used to be one
         slab of colour wall to wall, so from inside you could not see where
         the kitchen stopped and the hallway began — the rooms were in the
         collision data and nowhere on screen. Tile in the bathroom, boards in
         the bedroom, concrete in the store, and a darker line round each so
         the shape and size of the room are things you can actually read. */
      for (const r of b.rooms || []) {
        if (r.basement) continue;              // cellars draw their own floor
        const rs = Structures.roomStyleOf(r.kind);
        if (!rs || !rectOnScreen(r)) continue;
        const pad = 6;
        const rx = r.x - pad, ry = r.y - pad, rw = r.w + pad * 2, rh = r.h + pad * 2;
        ctx.fillStyle = rs.floor;
        ctx.fillRect(rx, ry, rw, rh);
        drawFloorPattern({ x: rx, y: ry, w: rw, h: rh }, rs);
        // a firm edge, so the size and shape of the room are unambiguous
        ctx.strokeStyle = 'rgba(0,0,0,0.42)'; ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);
      }
      // the building's own accent runs round the whole slab
      ctx.strokeStyle = hexA(st.trim, 0.55); ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }
  }

  function drawRoofs() {
    for (const b of buildings) {
      if (!rectOnScreen(b)) continue;
      // lift the roof for whoever is inside — you and anyone on your team
      const occupied = insideBuilding(b, player) ||
        agents.some(a => a.team === player.team && !a.isVehicle && insideBuilding(b, a));
      b.roofAlpha = b.roofAlpha === undefined ? 1 : b.roofAlpha;
      const target = occupied ? 0 : 1;
      b.roofAlpha += (target - b.roofAlpha) * 0.18;      // fade rather than snap
      if (b.roofAlpha < 0.02) continue;

      ctx.save();
      ctx.globalAlpha = b.roofAlpha;
      /* The roof is the building's colour, and from the air it is the only
         thing you can see — so a hospital reads white, a church slate blue and
         a gas station red long before you are close enough to read a sign. */
      const st = b.style || Structures.styleOf(b.name);
      const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
      g.addColorStop(0, st.roof[0]);
      g.addColorStop(1, st.roof[1]);
      ctx.fillStyle = g;
      ctx.fillRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16);
      // ridge lines and a border so it reads as a roof, not a lid
      ctx.strokeStyle = 'rgba(0,0,0,0.26)'; ctx.lineWidth = 2;
      ctx.beginPath();
      const ridge = st.pattern === 'metal' ? 24 : st.pattern === 'tile' ? 34 : 46;
      for (let y = b.y; y < b.y + b.h; y += ridge) { ctx.moveTo(b.x - 8, y); ctx.lineTo(b.x + b.w + 8, y); }
      ctx.stroke();
      /* Things that actually sit on a roof. A flat coloured slab with lines
         across it reads as a lid; what makes it a building from above is the
         clutter — a ridge down the spine, vents, a skylight over the middle of
         a big span, and a gutter shadow inside the eaves.

         Seeded off the building's own position, so a roof looks the same every
         frame and every client draws the same one. */
      const rr = ((Math.abs(b.x * 7 + b.y * 13) | 0) % 997) / 997;
      const wide = b.w >= b.h;
      // ridge down the long axis
      ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 3;
      ctx.beginPath();
      if (wide) { ctx.moveTo(b.x - 8, b.y + b.h / 2); ctx.lineTo(b.x + b.w + 8, b.y + b.h / 2); }
      else { ctx.moveTo(b.x + b.w / 2, b.y - 8); ctx.lineTo(b.x + b.w / 2, b.y + b.h + 8); }
      ctx.stroke();
      // gutter shadow just inside the eaves
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 6;
      ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
      // roof furniture: vents along the ridge, and a skylight on a big span
      const vents = Math.max(1, Math.min(5, Math.floor((wide ? b.w : b.h) / 240)));
      for (let i = 0; i < vents; i++) {
        const t = (i + 0.5 + rr * 0.3) / vents;
        const vx = wide ? b.x + b.w * t : b.x + b.w / 2 + (i % 2 ? 22 : -22);
        const vy = wide ? b.y + b.h / 2 + (i % 2 ? 20 : -20) : b.y + b.h * t;
        ctx.fillStyle = hexA(st.trim, 0.55);
        roundRect(vx - 9, vy - 7, 18, 14, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      if (b.w > 340 && b.h > 260) {
        const sw = Math.min(120, b.w * 0.22), sh = Math.min(90, b.h * 0.2);
        ctx.fillStyle = 'rgba(180,220,255,0.20)';
        roundRect(b.x + b.w * 0.5 - sw / 2, b.y + b.h * 0.28 - sh / 2, sw, sh, 4); ctx.fill();
        ctx.strokeStyle = hexA(st.trim, 0.7); ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.strokeStyle = hexA(st.trim, 0.9); ctx.lineWidth = 4;
      ctx.strokeRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16);
      ctx.restore();
    }
  }

  /* ---------------- interior lighting ----------------
     A building's inside was as bright as the field outside it, which made a
     warehouse and a meadow read the same and wasted the fact that you can't
     see in until the roof lifts. Interiors are dimmed a little, and lamps push
     that back — so a lit corridor is legible, an unlit store room is murk, and
     shooting the lamp out is a thing you might actually want to do.

     Drawn over the floor and under everything standing on it, and clipped to
     the building so the light never spills onto the grass. Deliberately gentle:
     this is atmosphere, not a stealth mechanic — you can always see enough to
     fight. */
  /* How dark an unlit interior gets. Tuned down from 0.34 once rooms started
     laying their own floors: at a third opacity a pale ward and a pale surgery
     both resolved to the same mid-grey, which threw away the thing the room
     colours are there to tell you. Low enough now that the material reads,
     dark enough that a lamp still matters. */
  const INTERIOR_DIM = 0.20;

  /* Basements aren't inside a building's footprint — they sit below it — so
     they get their own floor and their own, deeper, darkness. Whatever lamps
     are down there are the only light there is. */
  const BASEMENT_DIM = 0.62;
  /* An upper floor reads as a floor you are looking down on rather than one
     you are looking into: a lighter deck than the ground around it, and a
     drawn edge so the drop is legible. */
  /* The mast beside each capture point, flying the letter and — once somebody
     has taken it — their colour. You could previously only tell A from C by
     looking at the minimap; this puts the answer on the building. */
  function drawObjectiveFlags() {
    for (const o of obstacles) {
      if (!o.flag || !rectOnScreen(o)) continue;
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      const obj = objectives.find(q => q.name === o.label);
      const col = obj && obj.owner >= 0 ? TEAM_COLORS[obj.owner] : '#c9d4e6';
      // pole
      ctx.strokeStyle = '#6d6a63'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx, cy + 10); ctx.lineTo(cx, cy - 46); ctx.stroke();
      // banner, in the holder's colour
      ctx.fillStyle = hexA(col, 0.95);
      ctx.beginPath();
      ctx.moveTo(cx + 2, cy - 46); ctx.lineTo(cx + 40, cy - 36); ctx.lineTo(cx + 2, cy - 24);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
      // and the letter, so it reads at a glance
      ctx.fillStyle = '#12161f'; ctx.font = 'bold 15px Segoe UI';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.label, cx + 15, cy - 36);
    }
  }

  function drawUpperFloors() {
    for (const r of upperFloors) {
      if (!rectOnScreen(r)) continue;
      ctx.fillStyle = '#6b6357';
      ctx.fillRect(r.x - 20, r.y - 20, r.w + 40, r.h + 40);
      ctx.strokeStyle = 'rgba(255,240,210,0.22)'; ctx.lineWidth = 3;
      ctx.strokeRect(r.x - 20, r.y - 20, r.w + 40, r.h + 40);
    }
  }

  function drawBasements() {
    for (const r of basements) {
      if (!rectOnScreen(r)) continue;
      ctx.fillStyle = '#3a352e';
      ctx.fillRect(r.x - 18, r.y - 18, r.w + 36, r.h + 36);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 18, r.y - 18, r.w + 36, r.h + 36);
    }
  }
  function drawBasementLight() {
    for (const r of basements) {
      if (!rectOnScreen(r)) continue;
      const box = { x: r.x - 18, y: r.y - 18, w: r.w + 36, h: r.h + 36 };
      ctx.save();
      ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
      ctx.fillStyle = `rgba(4,6,14,${BASEMENT_DIM})`;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.globalCompositeOperation = 'destination-out';
      for (const o of obstacles) {
        const lit = kindOf(o).lights;
        if (!lit) continue;
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        if (cx < box.x || cx > box.x + box.w || cy < box.y || cy > box.y + box.h) continue;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, lit);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.5, 'rgba(0,0,0,0.7)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, lit, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
  }
  let basements = [];
  let upperFloors = [];

  /* A lamp's glow is the same gradient wherever it stands, so build one per
     radius and move it into place rather than constructing two gradients per
     lamp per frame. A canvas gradient is fixed in the space it was made in, so
     these are made about the origin and the context is translated to the lamp.

     Interiors got busier — more rooms means more lamps — and this pass was
     rebuilding a couple of hundred gradient objects every frame, which cost
     about ten frames a second on a map full of lit buildings. */
  const lampGrads = new Map();
  function lampGradient(r, warm) {
    const key = (warm ? 'w' : 'c') + Math.round(r);
    let g = lampGrads.get(key);
    if (!g) {
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      if (warm) {
        g.addColorStop(0, 'rgba(255,206,120,0.20)');
        g.addColorStop(1, 'rgba(255,206,120,0)');
      } else {
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.72)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
      }
      lampGrads.set(key, g);
    }
    return g;
  }
  /* Is any of this lamp's glow on screen? A big building can be half off the
     edge with most of its lamps out of view, and those were all being drawn. */
  function lightOnScreen(o) {
    const r = o.lightR;
    return o.x + o.w + r > camX && o.x - r < camX + W / zoom
      && o.y + o.h + r > camY && o.y - r < camY + H / zoom;
  }

  /* Per-pass frame timing, off unless someone asks for it. Frame rate on its
     own tells you the map got heavier; it does not tell you which pass to
     look at, and the two answers are rarely the same. */
  let perfOn = false;
  const perfAcc = {};
  function perfMark(name, fn) {
    if (!perfOn) { fn(); return; }
    const t = performance.now();
    fn();
    perfAcc[name] = (perfAcc[name] || 0) + (performance.now() - t);
  }
  function perfCount(name, n) { if (perfOn) perfAcc[name] = (perfAcc[name] || 0) + n; }

  function drawInteriorLight() {
    for (const b of buildings) {
      if (!b.floor || !rectOnScreen(b)) continue;
      ctx.save();
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      // the gloom
      ctx.fillStyle = `rgba(6,10,22,${INTERIOR_DIM})`;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      /* Lamps cut it back out. `destination-out` erases the gloom rather than
         painting yellow over it, so a lit patch shows the real floor colour
         instead of a wash. */
      ctx.globalCompositeOperation = 'destination-out';
      for (const o of lightsIn(b)) {
        if (!lightOnScreen(o)) continue;
        ctx.save();
        ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
        ctx.fillStyle = lampGradient(o.lightR, false);
        ctx.beginPath(); ctx.arc(0, 0, o.lightR, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
      // and a warm tint where they are, so a lamp reads as a lamp
      for (const o of lightsIn(b)) {
        if (!lightOnScreen(o)) continue;
        ctx.save();
        ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
        ctx.fillStyle = lampGradient(o.lightR, true);
        ctx.beginPath(); ctx.arc(0, 0, o.lightR, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  /* Lamps standing in this building. Cached per building and rebuilt whenever
     the world changes, because this runs every frame for every building on
     screen and a map has two thousand obstacles. */
  let lightCache = null;
  function lightsIn(b) {
    if (!lightCache) {
      lightCache = new Map();
      for (const o of obstacles) {
        const lit = kindOf(o).lights;
        if (!lit) continue;
        o.lightR = lit;
        for (const bb of buildings) {
          if (o.x < bb.x || o.x > bb.x + bb.w || o.y < bb.y || o.y > bb.y + bb.h) continue;
          if (!lightCache.has(bb)) lightCache.set(bb, []);
          lightCache.get(bb).push(o);
          break;
        }
      }
    }
    return lightCache.get(b) || [];
  }

  /* ---------------- what you can actually see ----------------
     You used to see the whole screen regardless of what was in the way: a
     warehouse wall stopped your bullets and your bots' line of sight, but not
     your eyes, so an enemy behind it was drawn as plainly as one in the open.
     Cover was something that mattered to the simulation and not to the player
     looking at it.

     Every high wall now throws a shadow away from you, and what falls inside
     one is hidden. The technique is silhouette projection rather than a full
     visibility polygon: for each blocker, find the two corners it presents to
     you, push them out past the view edge, and fill the quad between. That is
     a handful of triangles per wall instead of a sort over every corner in
     the level, which is what keeps it inside a frame at two thousand
     obstacles.

     Deliberately not pitch black — SIGHT_DARK leaves enough to read the
     terrain and your own minimap knowledge. This is "you cannot see who is
     back there", not "the screen is off". */
  const SIGHT_R = 1500;              // how far you can see at all
  const SIGHT_DARK = 0.82;           // how completely a shadow hides things

  /* The two corners of a rect that form its silhouette from a point.

     Measured relative to the bearing of the rect's centre, which sidesteps the
     wrap at ±π and turns the job into "smallest and largest offset" — four
     atan2 calls rather than the twelve an all-pairs search costs. This runs
     for every wall on screen every frame, so the constant matters. */
  const CORNER = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  function silhouette(s, px, py) {
    const mid = Math.atan2(s.y + s.h / 2 - py, s.x + s.w / 2 - px);
    let lo = 0, hi = 0, loX = s.x, loY = s.y, hiX = s.x, hiY = s.y;
    for (let i = 0; i < 4; i++) {
      const cx = i === 1 || i === 2 ? s.x + s.w : s.x;
      const cy = i >= 2 ? s.y + s.h : s.y;
      let d = Math.atan2(cy - py, cx - px) - mid;
      if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
      if (d < lo) { lo = d; loX = cx; loY = cy; }
      if (d > hi) { hi = d; hiX = cx; hiY = cy; }
    }
    CORNER[0].x = loX; CORNER[0].y = loY;
    CORNER[1].x = hiX; CORNER[1].y = hiY;
    return CORNER;
  }

  function drawSightShadows() {
    if (!player || !player.alive) return;
    const px = player.x, py = player.y;
    const g = sightIndex();
    if (!g.cells.size) return;
    /* Only walls actually on screen can shadow anything you can see, so the
       query is the view rather than the full sight radius — off-screen walls
       used to be projected and then clipped away, which is the same work for
       nothing. */
    const reach = Math.min(SIGHT_R, Math.hypot(W / zoom, H / zoom) * 0.75);
    const blockers = nearRects(g, px, py, reach);
    if (!blockers.length) return;

    /* Built on an offscreen layer: the shadows are unioned there first, so
       overlapping walls don't darken the same ground twice and show their
       seams. */
    const layer = sightLayer();
    const lx = layer.getContext('2d');
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.clearRect(0, 0, layer.width, layer.height);
    lx.save();
    lx.scale(zoom, zoom);
    lx.translate(-camX, -camY);
    lx.fillStyle = '#000';
    lx.beginPath();
    const FAR = SIGHT_R * 2.2;
    for (const s of blockers) {
      if (s.open || !rectOnScreen(s)) continue;
      // standing inside the wall itself: it can't shadow you
      if (px > s.x && px < s.x + s.w && py > s.y && py < s.y + s.h) continue;
      const [p1, p2] = silhouette(s, px, py);
      const a1 = Math.atan2(p1.y - py, p1.x - px);
      const a2 = Math.atan2(p2.y - py, p2.x - px);
      const f1 = { x: px + Math.cos(a1) * FAR, y: py + Math.sin(a1) * FAR };
      const f2 = { x: px + Math.cos(a2) * FAR, y: py + Math.sin(a2) * FAR };
      lx.moveTo(p1.x, p1.y);
      lx.lineTo(f1.x, f1.y);
      lx.lineTo(f2.x, f2.y);
      lx.lineTo(p2.x, p2.y);
      lx.closePath();
    }
    lx.fill();
    lx.restore();

    /* Fade the shadow out at the edge of sight, so the world doesn't end in a
       hard ring — beyond SIGHT_R everything is dim anyway. */
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    /* 5. SCREEN SHAKE. Applied to the world transform only — the HUD must not
       move, or reading your own ammo count becomes a chore in a firefight. */
    if (shake.mag > 0.2) {
      const a2 = shake.t * 47;
      ctx.translate(Math.cos(a2) * shake.mag, Math.sin(a2 * 1.7) * shake.mag);
    }
    ctx.globalAlpha = SIGHT_DARK;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* the offscreen canvas the shadow volumes are unioned on */
  let _sightLayer = null;
  function sightLayer() {
    if (!_sightLayer) _sightLayer = document.createElement('canvas');
    if (_sightLayer.width !== canvas.width || _sightLayer.height !== canvas.height) {
      _sightLayer.width = canvas.width;
      _sightLayer.height = canvas.height;
    }
    return _sightLayer;
  }

  function drawStructure(s) {
    /* An undiscovered secret door wears the wall it is set into — same fill,
       same stroke, no handle dot — so it is invisible until you are on top of
       it. Once found, it draws as itself and gets a hint of gold. */
    const k = (s.secret && !s.found && s.hides)
      ? Structures.def(s.hides)
      : kindOf(s);

    // world props draw as their sprite, with damage shown by shrinking and
    // reddening rather than a bar across a crate
    if (s.isProp) {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const hurt = s.maxHp ? clamp(1 - s.hp / s.maxHp, 0, 1) : 0;
      ctx.save();
      if (hurt > 0.02) ctx.globalAlpha = 1 - hurt * 0.35;
      Sprites.draw(ctx, k.prop, cx, cy, (s.scale || 1) * (1 - hurt * 0.12), s.rot * 0.25);
      ctx.restore();
      if (hurt > 0.35) {                       // cracks show before it goes
        ctx.strokeStyle = `rgba(255,90,70,${hurt * 0.7})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - s.w * 0.25, cy - s.h * 0.2);
        ctx.lineTo(cx + s.w * 0.15, cy + s.h * 0.25);
        ctx.stroke();
      }
      return;
    }
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

    /* A secret door nobody has spotted: draw it as a plain run of the wall it
       hides in, with no swing, no handle and no prompt. */
    if (Structures.isDoor(s) && s.secret && !s.found) {
      roundRect(s.x, s.y, s.w, s.h, 2);
      ctx.fillStyle = k.fill; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = k.stroke; ctx.stroke();
      return;
    }

    if (Structures.isDoor(s)) {       // open doors swing out of the frame
      const c = doorCentre(s);
      // found but still shut: a gold seam, so you can see what you noticed
      if (s.secret) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,207,74,0.85)'; ctx.lineWidth = 2;
        ctx.strokeRect(s.x - 1, s.y - 1, s.w + 2, s.h + 2);
        ctx.restore();
      }
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
    drawWallDetail(s, k, along);
    if (dmg > 0.02) {   // damage bleeds along the length of the piece
      ctx.fillStyle = `rgba(255,75,92,${0.12 + dmg * 0.3})`;
      if (along) ctx.fillRect(s.x + 1, s.y + 1, (s.w - 2) * dmg, Math.max(2, s.h - 2));
      else ctx.fillRect(s.x + 1, s.y + 1, Math.max(2, s.w - 2), (s.h - 2) * dmg);
    }
  }

  /* ---- what a wall is made of ----
     Every wall was a flat rectangle in its material's colour, so a plank
     fence, a brick vault and a steel shed differed only in hue. Real
     construction has a grain you read before you read the colour: courses in
     masonry, boards in timber, panel seams and rivets in sheet steel.

     Drawn as short strokes along the piece, spaced by material, and clipped to
     the wall so nothing bleeds into the room. Skipped on short pieces — a
     doorway jamb with two bricks on it is noise, not detail. */
  const WALL_GRAIN = {
    wood:      { step: 15, line: 'rgba(60,40,22,0.34)', edge: 'rgba(210,175,130,0.16)' },
    rwall:     { step: 20, line: 'rgba(18,22,30,0.34)', edge: 'rgba(225,235,250,0.13)', stagger: true },
    metal:     { step: 26, line: 'rgba(14,20,28,0.34)', edge: 'rgba(220,238,255,0.18)', rivets: true },
    rock:      { step: 24, line: 'rgba(30,32,36,0.36)', edge: 'rgba(220,226,236,0.12)', stagger: true },
    barricade: { step: 12, line: 'rgba(50,34,18,0.34)', edge: 'rgba(214,182,140,0.16)' },
    sandbag:   { step: 17, line: 'rgba(60,52,34,0.30)', edge: 'rgba(226,208,166,0.18)', stagger: true },
  };

  function drawWallDetail(s, k, along) {
    const gr = WALL_GRAIN[s.type];
    if (!gr) return;
    const len = along ? s.w : s.h;
    const thick = along ? s.h : s.w;
    if (len < gr.step * 1.6 || thick < 5) return;
    ctx.save();
    roundRect(s.x, s.y, s.w, s.h, k.height === 'low' ? 3 : 5);
    ctx.clip();
    ctx.lineWidth = 1;
    let row = 0;
    for (let i = gr.step; i < len; i += gr.step) {
      // masonry is laid in courses, so every other joint is offset
      const off = gr.stagger && (row++ % 2) ? gr.step * 0.5 : 0;
      const at = i + off;
      if (at >= len) continue;
      ctx.strokeStyle = gr.line;
      ctx.beginPath();
      if (along) { ctx.moveTo(s.x + at, s.y + 1); ctx.lineTo(s.x + at, s.y + s.h - 1); }
      else { ctx.moveTo(s.x + 1, s.y + at); ctx.lineTo(s.x + s.w - 1, s.y + at); }
      ctx.stroke();
      // a lit edge just past each joint, so the grain has depth
      ctx.strokeStyle = gr.edge;
      ctx.beginPath();
      if (along) { ctx.moveTo(s.x + at + 1, s.y + 1); ctx.lineTo(s.x + at + 1, s.y + s.h - 1); }
      else { ctx.moveTo(s.x + 1, s.y + at + 1); ctx.lineTo(s.x + s.w - 1, s.y + at + 1); }
      ctx.stroke();
    }
    // a course line down the middle of thick masonry, and rivets on steel
    if (gr.stagger && thick > 13) {
      ctx.strokeStyle = gr.line;
      ctx.beginPath();
      if (along) { ctx.moveTo(s.x, s.y + s.h / 2); ctx.lineTo(s.x + s.w, s.y + s.h / 2); }
      else { ctx.moveTo(s.x + s.w / 2, s.y); ctx.lineTo(s.x + s.w / 2, s.y + s.h); }
      ctx.stroke();
    }
    if (gr.rivets && thick >= 8) {
      ctx.fillStyle = gr.edge;
      for (let i = gr.step * 0.5; i < len; i += gr.step) {
        const rx = along ? s.x + i : s.x + s.w / 2;
        const ry = along ? s.y + s.h / 2 : s.y + i;
        ctx.beginPath(); ctx.arc(rx, ry, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
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


  /* One gun, drawn from its profile, in the operator's own frame: +x is where
     they are pointing, so every piece is placed along the barrel rather than
     recomputed with sin and cos. */
  function drawWeapon(a) {
    const gp = a.gunProfile || (a.gunProfile = Skins.profileFor(a.weapon, a.skinId || 'default'));
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.angle);
    const r = a.r, len = gp.len, w = gp.w;
    if (gp.glow) { ctx.shadowColor = gp.accent; ctx.shadowBlur = 10; }
    ctx.lineCap = 'round';

    // stock, behind the grip — what makes a rifle read as a rifle
    if (gp.stock) {
      ctx.strokeStyle = gp.barrel; ctx.lineWidth = w * 0.85;
      ctx.beginPath(); ctx.moveTo(-gp.stock, 0); ctx.lineTo(r * 0.4, 0); ctx.stroke();
    }
    // magazine, hanging below the receiver
    if (gp.mag) {
      ctx.fillStyle = gp.barrel;
      roundRect(r * 0.35, w * 0.45, w * 1.5, w * 1.5, 1.5); ctx.fill();
    }
    // the barrel itself
    ctx.strokeStyle = gp.barrel; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(r * 0.2, 0); ctx.lineTo(r + len, 0); ctx.stroke();
    // optic, sitting on top of the receiver
    if (gp.optic) {
      ctx.fillStyle = gp.accent;
      roundRect(r + len * 0.18, -w * 0.95, len * 0.26, w * 0.7, 1.5); ctx.fill();
    }
    // a bought skin's contrasting wrap
    if (gp.stripes) {
      ctx.strokeStyle = gp.accent; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(r + len * 0.45, 0); ctx.lineTo(r + len * 0.62, 0); ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // and the business end
    const tip = r + len;
    ctx.fillStyle = gp.accent;
    if (gp.muzzle === 'brake') {
      roundRect(tip - w * 0.7, -w * 0.8, w * 1.4, w * 1.6, 1.5); ctx.fill();
    } else if (gp.muzzle === 'tube') {
      ctx.strokeStyle = gp.accent; ctx.lineWidth = w * 1.35;
      ctx.beginPath(); ctx.moveTo(tip - w, 0); ctx.lineTo(tip, 0); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(tip, 0, Math.max(2, w * 0.45), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------- tactical rendering helpers ---------------- */
  function drawCratesAndDeployables() {
    // crates
    for (const c of crates) {
      if (!onScreen(c.x, c.y, 40)) continue;
      const st = Items.CRATE_STYLE[c.tier];
      ctx.globalAlpha = c.opened ? 0.3 : 1;
      /* Searchable furniture is a crate wearing a locker's clothes. It draws
         as the thing it is rather than as a box, because a room full of boxes
         labelled "locker" is not a furnished room — but it rides the same
         synced pipeline as every other crate, so the room decides who got
         there first exactly as it does for a gold crate. */
      if (c.look) {
        const m = Sprites.META[c.look] || { r: 20 };
        Sprites.draw(ctx, c.look, c.x, c.y, 1, c.rot || 0);
        if (!c.opened) {
          // a searched-through look: a glint, so you can tell it from scenery
          ctx.beginPath(); ctx.arc(c.x + m.r * 0.55, c.y - m.r * 0.55, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,224,150,0.9)'; ctx.fill();
          if (near2(player, c, 95)) {
            ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Segoe UI';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('[E] Search', c.x, c.y - m.r - 14);
          }
        }
        ctx.globalAlpha = 1;
        continue;
      }
      const half = c.tier === 'chest' ? 20 : 15;
      roundRect(c.x - half, c.y - half, half * 2, half * 2, 6);
      ctx.fillStyle = c.opened ? '#37456b' : hexA(st.color, 0.95); ctx.fill();
      ctx.lineWidth = c.tier === 'chest' ? 3 : 2; ctx.strokeStyle = st.color; ctx.stroke();
      if (!c.opened) {
        ctx.font = (c.tier === 'chest' ? '23px' : '18px') + ' Segoe UI';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(st.icon, c.x, c.y + 1);
        // interact prompt when player is close
        if (near2(player, c, 95)) { ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Segoe UI'; ctx.fillText('[E] ' + st.name, c.x, c.y - half - 11); }
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
    const col = teamInk(a.team);
    const def = vehicleDef(a);
    // hull points where it's driving, turret where it's aiming — so you can
    // read a vehicle's heading and its threat separately
    ctx.save();
    ctx.translate(a.x, a.y); ctx.rotate(a.hullAngle !== undefined ? a.hullAngle : a.angle);
    roundRect(-a.r, -a.r * 0.8, a.r * 2, a.r * 1.6, 5);
    ctx.fillStyle = a.vtype === 'tank' ? '#2c3a24' : '#243a2c'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
    ctx.restore();
    // turret
    ctx.save();
    ctx.translate(a.x, a.y); ctx.rotate(a.angle);
    ctx.fillStyle = '#e9f0ff'; ctx.fillRect(0, -3, a.r + 16, 6);
    ctx.beginPath(); ctx.arc(0, 0, a.r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = a.vtype === 'tank' ? '#3a4a30' : '#2f4a38'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
    ctx.restore();
    // icon + hp
    ctx.font = '16px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, a.x, a.y);
    const hpw = 46;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(a.x - hpw / 2, a.y - a.r - 14, hpw, 5);
    ctx.fillStyle = col; ctx.fillRect(a.x - hpw / 2, a.y - a.r - 14, hpw * (a.hp / a.maxHp), 5);
    // you're in this one
    if (a.driver && a.driver.isPlayer) {
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(53,224,255,0.65)'; ctx.lineWidth = 2; ctx.stroke();
    } else if (a.team === player.team && !a.driver && near2(player, a, 110) && !player.riding) {
      // close enough to climb in
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Segoe UI';
      ctx.fillText('[E] ' + def.name, a.x, a.y - a.r - 26);
    }
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
    if (p.riding) {
      // the item slots are out of reach from the seat, so the bar is replaced
      // by what the vehicle brings instead
      drawVehicleStatus(p.riding);
    } else {
      drawStatusStack(p);
      drawActionBar(p);
    }
    drawChannelRing(p);
    drawFeel();
    drawHudMessage();
  }

  /* ---------------- vehicle panel ----------------
     What this vehicle actually gives you, while you're in it: its gun, its
     hull, how fast it is, and — the part that decides whether you should be
     here at all — which damage types can hurt it. The resistances are read
     live from combat.js, so this panel can't drift from the calculator. */
  function drawVehicleStatus(v) {
    const def = vehicleDef(v);
    const x = HUD.statusLeft;
    let y = H - 78;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

    // what can hurt it: every damage type that does anything, and how much
    const mult = Combat.targetOf(v).mult;
    const names = { normal: 'Bullets', ap: 'AP', explosive: 'Explosive', heat: 'HEAT' };
    const parts = Object.keys(names).map(k => {
      const pct = Math.round((mult[k] !== undefined ? mult[k] : 1) * 100);
      return { label: names[k], pct };
    });
    ctx.font = 'bold 11px Segoe UI';
    let px = x;
    for (const p of parts) {
      const txt = `${p.label} ${p.pct}%`;
      ctx.fillStyle = p.pct === 0 ? '#4be08a' : p.pct <= 25 ? '#9fd8ff' : p.pct <= 50 ? '#ffcf4a' : '#ff6b78';
      ctx.fillText(txt, px, y);
      px += ctx.measureText(txt).width + 14;
    }
    y -= HUD.rowH;

    // hull integrity, separate from the HTML bar so the number is readable
    const bw = 200;
    ctx.fillStyle = 'rgba(20,30,55,0.8)'; roundRect(x, y - 5, bw, 10, 5); ctx.fill();
    const frac = clamp(v.hp / v.maxHp, 0, 1);
    ctx.fillStyle = frac > 0.5 ? '#4be08a' : frac > 0.25 ? '#ffcf4a' : '#ff4b5c';
    roundRect(x, y - 5, bw * frac, 10, 5); ctx.fill();
    ctx.font = 'bold 10px Segoe UI'; ctx.fillStyle = '#cfd8ee';
    // speed in tiles/s, the unit weapon ranges and blast radii are quoted in
    ctx.fillText(`HULL ${Math.round(v.hp)}/${v.maxHp}  ·  ${(v.vspeed / TILE).toFixed(1)} tiles/s`, x + bw + 10, y);
    y -= HUD.rowH;

    // name, gun and the way out
    ctx.font = 'bold 13px Segoe UI'; ctx.fillStyle = teamInk(v.team);
    const title = `${def.icon} ${def.name}`;
    ctx.fillText(title, x, y);
    const tw = ctx.measureText(title).width;
    ctx.font = 'bold 11px Segoe UI'; ctx.fillStyle = '#cfd8ee';
    ctx.fillText(`${v.weapon.icon} ${v.weapon.name}  ·  ${v.ammo}/${v.weapon.mag}   [E] get out`, x + tw + 12, y);
    y -= HUD.rowH;

    ctx.font = '11px Segoe UI'; ctx.fillStyle = 'rgba(207,216,238,0.7)';
    ctx.fillText(def.blurb, x, y);
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
    if (p.vest || p.helmet || p.bag) {
      ctx.font = 'bold 11px Segoe UI'; ctx.fillStyle = '#9fd8ff';
      const bits = [];
      if (p.vest) bits.push(`🦺 T${p.vest} ${Math.round(Combat.vest(p.vest).body * 100)}% body`);
      if (p.helmet) bits.push(`⛑ T${p.helmet} ${Math.round(Combat.helmet(p.helmet).head * 100)}% head`);
      if (p.bag) bits.push(`🎒 T${p.bag} ×${Combat.bag(p.bag).capacity} carry`);
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

  /* ============================================================
     FEEL — the five things every shooter has and this one did not.

     None of it changes a number in the simulation. All of it is feedback:
     telling you that you hit, that you are being hit and from where, that you
     are nearly dead, and that the last three seconds went well. A shooter
     without these reads as unresponsive even when the shooting itself is
     perfectly good, because the player is being asked to infer everything
     from health bars and corpses.
     ============================================================ */

  /* 1. HITMARKERS — did that connect? */
  let hitMarkers = [];                      // { t, life, kind }
  function addHitMarker(kind) {
    hitMarkers.push({ t: 0, life: kind === 'kill' ? 0.5 : 0.28, kind });
    if (hitMarkers.length > 8) hitMarkers.shift();
  }

  /* 2. DAMAGE DIRECTION — who is shooting me, and from where? */
  let hurtArcs = [];                        // { ang, t, life }
  function addHurtArc(fromX, fromY) {
    if (!player) return;
    const ang = Math.atan2(fromY - player.y, fromX - player.x);
    // one arc per direction: being shot four times from the same window is one
    // piece of information, not four
    const near = hurtArcs.find(h => Math.abs(angDiff(h.ang, ang)) < 0.5);
    if (near) { near.t = 0; near.life = 1.5; return; }
    hurtArcs.push({ ang, t: 0, life: 1.5 });
    if (hurtArcs.length > 6) hurtArcs.shift();
  }
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  /* 3. SCREEN SHAKE — weight behind the gun and the explosions */
  let shake = { mag: 0, t: 0 };
  function addShake(mag) { shake.mag = Math.min(14, shake.mag + mag); }

  /* 4. MULTI-KILLS — the last few seconds, called out */
  let multiKill = { n: 0, until: 0 };
  const MULTI_NAMES = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL', 'MULTI KILL'];
  function noteKill() {
    const now = performance.now();
    multiKill.n = now < multiKill.until ? multiKill.n + 1 : 1;
    multiKill.until = now + 4000;           // the window every shooter uses
    if (multiKill.n >= 2) {
      const label = MULTI_NAMES[Math.min(multiKill.n, MULTI_NAMES.length - 1)];
      streakBanner = { text: label, t: 1.8 };
      SFX.reward();
    }
  }
  let streakBanner = null;

  function updateFeel(dt) {
    for (let i = hitMarkers.length - 1; i >= 0; i--) {
      hitMarkers[i].t += dt;
      if (hitMarkers[i].t >= hitMarkers[i].life) hitMarkers.splice(i, 1);
    }
    for (let i = hurtArcs.length - 1; i >= 0; i--) {
      hurtArcs[i].t += dt;
      if (hurtArcs[i].t >= hurtArcs[i].life) hurtArcs.splice(i, 1);
    }
    if (shake.mag > 0) { shake.t += dt; shake.mag = Math.max(0, shake.mag - dt * 26); }
    if (streakBanner) { streakBanner.t -= dt; if (streakBanner.t <= 0) streakBanner = null; }
  }

  /* Drawn in screen space, over everything. */
  function drawFeel() {
    const cx = W / 2, cy = H / 2;

    // 1. hitmarkers on the crosshair
    for (const h of hitMarkers) {
      const k = 1 - h.t / h.life;
      const gap = 7 + (1 - k) * 5, len = 7;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.strokeStyle = h.kind === 'kill' ? '#ff5470' : h.kind === 'head' ? '#ffcf4a' : '#ffffff';
      ctx.lineWidth = h.kind === 'normal' ? 2 : 3; ctx.lineCap = 'round';
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * gap, cy + sy * gap);
        ctx.lineTo(cx + sx * (gap + len), cy + sy * (gap + len));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 2. where it came from
    for (const h of hurtArcs) {
      const k = 1 - h.t / h.life;
      const r0 = Math.min(W, H) * 0.20, r1 = r0 + 34;
      ctx.globalAlpha = k * 0.75;
      const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(h.ang) * r1, cy + Math.sin(h.ang) * r1);
      g.addColorStop(0, 'rgba(255,60,60,0)');
      g.addColorStop(1, 'rgba(255,70,70,0.95)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r1, h.ang - 0.34, h.ang + 0.34);
      ctx.arc(cx, cy, r0, h.ang + 0.34, h.ang - 0.34, true);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 3. low health: the edges close in, and pulse as it gets worse
    if (player && player.alive) {
      const frac = player.hp / player.maxHp;
      if (frac < 0.45) {
        const bite = (0.45 - frac) / 0.45;
        const pulse = 0.72 + 0.28 * Math.sin(performance.now() / (120 + frac * 420));
        const g = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.30, cx, cy, Math.max(W, H) * 0.62);
        g.addColorStop(0, 'rgba(140,0,0,0)');
        g.addColorStop(1, 'rgba(150,10,10,' + (bite * 0.72 * pulse).toFixed(3) + ')');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
    }

    // 4. the callout
    if (streakBanner) {
      const k = Math.min(1, streakBanner.t / 0.4);
      ctx.globalAlpha = k;
      ctx.font = 'bold 34px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffcf4a';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 5;
      const yy = cy - Math.min(W, H) * 0.22 + (1 - k) * 14;
      ctx.strokeText(streakBanner.text, cx, yy);
      ctx.fillText(streakBanner.text, cx, yy);
      ctx.globalAlpha = 1;
    }
  }

  function drawHudMessage() {
    if (hudMessageT <= 0) return;
    ctx.globalAlpha = clamp(hudMessageT, 0, 1);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(hudMessage, W / 2, hudBarY() - 24);
    ctx.globalAlpha = 1;
  }

  /* ---------------- kill feed ----------------
     Sits directly under the minimap, top-right, newest at the top. Each row is
     "killer ▸ victim" with both names in their team colour, so you can read who
     is winning a fight without reading the words. */
  function drawKillFeed() {
    if (!killFeed.length) return;
    const pad = 16, rowH = 24, right = W - pad;
    let y = pad + 40 + MINIMAP_W * (MAP_H / MAP_W) + 14;   // below the minimap

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px Segoe UI';
    for (const k of killFeed) {
      const fade = clamp(k.t, 0, 1);               // last second fades out
      ctx.globalAlpha = fade;

      const killer = k.killer, victim = k.victim;
      const arrow = k.headshot ? '  ⌖  ' : '  ▸  ';
      const wk = ctx.measureText(killer).width;
      const wv = ctx.measureText(victim).width;
      const wa = ctx.measureText(arrow).width;
      const boxW = wk + wa + wv + 20;
      const x0 = right - boxW;

      // rows you're in are called out; everything else is quiet background
      ctx.fillStyle = k.mine ? 'rgba(75,224,138,0.22)'
        : k.victimIsMe ? 'rgba(255,75,92,0.22)' : 'rgba(26,38,66,0.72)';
      roundRect(x0, y - rowH / 2, boxW, rowH, 6); ctx.fill();
      if (k.mine || k.victimIsMe) {
        ctx.strokeStyle = k.mine ? 'rgba(75,224,138,0.85)' : 'rgba(255,75,92,0.85)';
        ctx.lineWidth = 1.5; ctx.stroke();
      }

      // your own name goes white: a team colour on the tinted row it sits in
      // is the one thing in the feed that has to stay readable
      const teamInk = (t) => (t >= 0 ? TEAM_COLORS[t] : '#8ea0c9');
      let x = x0 + 10;
      ctx.textAlign = 'left';
      ctx.fillStyle = k.mine ? '#fff' : teamInk(k.killerTeam);
      ctx.fillText(killer, x, y); x += wk;
      ctx.fillStyle = k.headshot ? '#ffcf4a' : 'rgba(207,216,238,0.9)';
      ctx.fillText(arrow, x, y); x += wa;
      ctx.fillStyle = k.victimIsMe ? '#fff' : teamInk(k.victimTeam);
      ctx.fillText(victim, x, y);

      y += rowH + 4;
    }
    ctx.restore();
  }

  /* The player's own kills and deaths, called out over the middle of the screen
     where they can't be missed. */
  function drawKillBanner() {
    if (!killBanner) return;
    const b = killBanner;
    const fade = clamp(b.t / 0.5, 0, 1);          // hold, then fade
    const rise = (1 - clamp(b.t / 2.2, 0, 1)) * 10;
    const cy = H * 0.30 - rise;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 30px Segoe UI';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(6,12,26,0.75)';
    ctx.strokeText(b.text, W / 2, cy);
    ctx.fillStyle = b.good ? '#4be08a' : '#ff6b78';
    ctx.fillText(b.text, W / 2, cy);
    if (b.sub) {
      ctx.font = 'bold 16px Segoe UI';
      ctx.lineWidth = 4;
      ctx.strokeText(b.sub, W / 2, cy + 28);
      ctx.fillStyle = '#ffcf4a';
      ctx.fillText(b.sub, W / 2, cy + 28);
    }
    ctx.restore();
  }

  const MINIMAP_W = 180;
  function drawMinimap() {
    const mw = MINIMAP_W, mh = mw * (MAP_H / MAP_W), pad = 16;
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
    /* Your squad, always. Enemies only when something is showing them to you —
       a radio tower, a command centre, or a squadmate's ping.

       This used to draw every living agent regardless of team, so offline you
       always knew where all fifteen opponents were and there was nothing to
       scout. Online never did that, because the host only sends your own
       squad. This is the online rule, applied to both. */
    const reveal = hereReveal();
    for (const a of agents) {
      if (!a.alive || a.isVehicle) continue;
      if (!a.isPlayer && a.team !== player.team) {
        if (!reveal || dist2(a.x, a.y, player.x, player.y) > reveal * reveal) continue;
        // seen by the tower rather than by you: a ring, not a dot
        ctx.beginPath(); ctx.arc(ox + a.x * sx, oy + a.y * sy, 2.6, 0, Math.PI * 2);
        ctx.strokeStyle = teamInk(a.team); ctx.lineWidth = 1.4; ctx.stroke();
        continue;
      }
      ctx.beginPath(); ctx.arc(ox + a.x * sx, oy + a.y * sy, a.isPlayer ? 3 : 2, 0, Math.PI * 2);
      ctx.fillStyle = a.isPlayer ? '#fff' : teamInk(a.team); ctx.fill();
    }
    if (reveal) {
      ctx.beginPath();
      ctx.arc(ox + player.x * sx, oy + player.y * sy, reveal * sx, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(74,143,208,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    }
    /* Online the other players come from the host, not from `agents` — without
       this the minimap showed you alone on an empty island. Only your own
       squad: an enemy is on there when somebody has pinged them, not always. */
    if (online) {
      for (const a of online.remote) {
        if (!a.alive || a.team !== player.team) continue;
        ctx.beginPath(); ctx.arc(ox + a.x * sx, oy + a.y * sy, 2, 0, Math.PI * 2);
        ctx.fillStyle = teamInk(a.team); ctx.fill();
      }
    }
    // your squad's pings
    for (const m of marks) {
      const def = Comms.pingById[m.kind];
      if (!def) continue;
      const mx = ox + m.x * sx, my = oy + m.y * sy;
      ctx.globalAlpha = clamp(m.life / 1.5, 0, 1);
      ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = def.color; ctx.fill();
      ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2);
      ctx.strokeStyle = def.color; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ---------------- pings and emotes on screen ---------------- */
  function drawMarks() {
    const t = performance.now() / 1000;
    for (const m of marks) if (onScreen(m.x, m.y, 80)) Comms.drawMark(ctx, m, t);
  }
  function drawOffscreenMarks() {
    for (const m of marks) {
      if (onScreen(m.x, m.y, 80)) continue;
      Comms.drawOffscreenMark(ctx, m, (m.x - camX) * zoom, (m.y - camY) * zoom, W, H);
    }
  }
  /* An emote belongs to whoever sent it, wherever they are now: our own
     player, a bot, or someone the host is telling us about. */
  function emoteAnchor(agentId) {
    if (agentId === 'me') return player;
    if (online) {
      const r = (online.remote || []).find(a => a.id === agentId);
      if (r) return { x: r.x, y: r.y, r: BODY_R };
    }
    return agents.find(a => a.netId === agentId || a.id === agentId) || null;
  }
  function drawEmotes() {
    for (const e of emotes) {
      const a = emoteAnchor(e.agentId);
      if (!a || !onScreen(a.x, a.y, 60)) continue;
      Comms.drawEmote(ctx, e, a.x, a.y - (a.r || BODY_R) - 30);
    }
  }
  /* ---------------- scoreboard (hold Tab) ----------------
     Online this is the roster the host is already sending in every snapshot,
     so it is live rather than a guess; offline it's the agent list. Either
     way it's the same table, sorted by kills. */
  function scoreRows() {
    if (online) {
      const mine = { name: 'You', team: player.team, kills: 0, deaths: 0, alive: player.alive, you: true };
      const rows = (online.remote || []).map(a => ({
        name: a.name, team: a.team, kills: a.kills || 0, deaths: a.deaths || 0, alive: a.alive,
      }));
      const me = (online.transport.snapshots.length
        ? (online.transport.snapshots.at(-1).data.agents || []).find(a => a.id === online.id) : null);
      if (me) { mine.kills = me.kills || 0; mine.deaths = me.deaths || 0; }
      rows.push(mine);
      return rows;
    }
    return agents.filter(a => !a.isVehicle).map(a => ({
      name: a.isPlayer ? 'You' : a.name, team: a.team,
      kills: a.kills || 0, deaths: a.deaths || 0, alive: a.alive, you: a.isPlayer,
    }));
  }
  function drawScoreboard() {
    if (!showScores) return;
    const rows = scoreRows().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const rowH = 24, headH = 62, w = 420;
    const h = headH + rows.length * rowH + 14;
    const x = (W - w) / 2, y = Math.max(20, (H - h) / 2 - 40);
    ctx.save();
    ctx.fillStyle = 'rgba(10,16,30,0.88)'; roundRect(x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(175,210,255,0.45)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#dce8ff'; ctx.font = 'bold 15px Segoe UI'; ctx.textAlign = 'left';
    ctx.fillText(mode === 'domination' ? 'DOMINATION' : 'ELIMINATION', x + 16, y + 20);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9fb4d8'; ctx.font = '12px Segoe UI';
    ctx.fillText(online ? `${online.ping}ms · ${rows.length} players` : `${rows.length} operators`, x + w - 16, y + 20);

    // team scores across the top
    ctx.textAlign = 'left';
    let tx = x + 16;
    for (let t = 0; t < teamScores.length; t++) {
      ctx.fillStyle = TEAM_COLORS[t];
      ctx.font = 'bold 13px Segoe UI';
      const label = `${TEAM_NAMES[t]} ${Math.round(teamScores[t])}`;
      ctx.fillText(label, tx, y + 42);
      tx += ctx.measureText(label).width + 18;
    }

    ctx.fillStyle = 'rgba(175,210,255,0.25)';
    ctx.fillRect(x + 14, y + headH - 8, w - 28, 1);
    ctx.font = '11px Segoe UI'; ctx.fillStyle = '#9fb4d8';
    ctx.fillText('OPERATOR', x + 34, y + headH + 4);
    ctx.textAlign = 'right';
    ctx.fillText('K', x + w - 92, y + headH + 4);
    ctx.fillText('D', x + w - 52, y + headH + 4);
    ctx.fillText('K/D', x + w - 16, y + headH + 4);

    rows.forEach((r, i) => {
      const ry = y + headH + 22 + i * rowH;
      if (r.you) {
        ctx.fillStyle = 'rgba(53,224,255,0.10)';
        ctx.fillRect(x + 10, ry - rowH / 2 + 2, w - 20, rowH - 4);
      }
      ctx.globalAlpha = r.alive === false ? 0.45 : 1;
      ctx.beginPath(); ctx.arc(x + 24, ry, 5, 0, Math.PI * 2);
      ctx.fillStyle = TEAM_COLORS[r.team % TEAM_COLORS.length]; ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = r.you ? '#fff' : '#dce8ff';
      ctx.font = `${r.you ? 'bold ' : ''}13px Segoe UI`;
      ctx.fillText(r.name, x + 38, ry);
      ctx.textAlign = 'right'; ctx.fillStyle = '#dce8ff'; ctx.font = '13px Segoe UI';
      ctx.fillText(r.kills, x + w - 92, ry);
      ctx.fillText(r.deaths, x + w - 52, ry);
      ctx.fillStyle = '#9fb4d8';
      ctx.fillText(r.deaths ? (r.kills / r.deaths).toFixed(2) : r.kills.toFixed(2), x + w - 16, ry);
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  function drawWheel() {
    if (!wheel) return;
    const items = wheel.kind === 'ping' ? Comms.PINGS : Comms.EMOTES;
    const hot = Comms.pick(items, wheel.at.x, wheel.at.y, input.mx, input.my);
    Comms.drawWheel(ctx, items, wheel.at.x, wheel.at.y, hot,
      wheel.kind === 'ping' ? 'PING' : 'EMOTE');
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

  /* ================= ONLINE MATCH =================
     The server owns the world here. We keep our own map (both sides generate
     from the same seed), send inputs at a fixed rate, and draw the agents the
     server tells us about, interpolated ~100ms behind so movement is smooth
     between the 20 snapshots a second. Local simulation of other players is
     off entirely — no prediction of anyone but ourselves. */
  let online = null;
  let peerStatusBound = false;
  /* ---------- reconciliation ----------
     How hard we pull toward where the room says we should be, and the gap past
     which we stop easing and just accept the jump (a respawn, or being thrown
     out of a wreck).

     The teleports came from *what* we were pulling toward. The room's position
     for us was being read out of the interpolated pair — which is deliberately
     rendered 100ms in the past, because that is what makes everyone else move
     smoothly. Reconciling against it meant chasing where we were a tenth of a
     second ago while still walking forward, so the correction never converged:
     it pulled backwards the whole time we moved, proportional to speed, and
     every hitch in the snapshot stream turned that steady drag into a visible
     yank. Walking in a straight line was enough to trigger it.

     What we chase now is the newest snapshot with our own inputs replayed on
     top of it — see predictedPosition(). In steady state the error is a pixel
     or two rather than a moving target, so the easing has nothing left to
     fight and there is nothing to snap. */
  const NET_EASE = 12, NET_SNAP = 400;
  const HISTORY_MS = 1500;      // how much of our own input we keep, for replay

  /* ---------- the host's match clock ----------
     One countdown, owned by the host, read by everyone. We take the host's
     figure and carry it forward with our own elapsed time between snapshots,
     which keeps the HUD smooth at 20Hz without ever inventing time of our own.

     The host rounds to whole seconds on the wire, so a fresh reading can land
     up to half a second *behind* where we already had it and make the clock
     visibly tick back up. Readings that would do that are ignored in favour of
     what we already have; only a real correction — a new match, a rejoin, a
     host that shortened the round — is big enough to win. */
  const CLOCK_RESET = 3;      // seconds of disagreement that counts as a jump
  const CLOCK_LAG_MAX = 1;    // how far our smoothing may fall behind the host
  function onlineClock() {
    if (!online || online.clockAt == null) return timeLeft;
    // nothing is running yet in a lobby, so the clock sits where the host put it
    if (online.phase === 'lobby') return online.clockLeft;
    return Math.max(0, online.clockLeft - (performance.now() - online.clockAt) / 1000);
  }
  function setOnlineClock(left) {
    if (!online || typeof left !== 'number') return;
    const current = onlineClock();
    const jumped = online.clockAt == null || Math.abs(left - current) > CLOCK_RESET;
    /* Prefer what we already had over a reading that would tick the display
       upward — but never let that preference accumulate. Carrying our own
       drifted value forward every time meant the two figures walked apart
       until they were three seconds out, at which point the correction fired
       and the clock jumped; it did that over and over. Clamping to within a
       second of the host keeps the display monotonic *and* honest. */
    online.clockLeft = jumped ? left : Math.min(left, Math.max(current, left - CLOCK_LAG_MAX));
    online.clockAt = performance.now();
  }

  /* Takes either a WebSocket to the dedicated server, or a transport object
     from js/p2p.js when another browser is hosting. The rest of the online
     path can't tell the two apart. */
  function startOnline(connection, selectedMode, seed) {
    start(selectedMode, seed);                    // build the world and HUD as usual
    agents = agents.filter(a => a.isPlayer); // the host supplies everyone else

    const isSocket = typeof connection.send === 'function' && 'readyState' in connection;
    const transport = isSocket
      ? Object.assign(new Net.SocketTransport(Net.serverUrl()), { ws: connection, connected: true })
      : connection;

    online = {
      socket: isSocket ? connection : null,
      transport,
      peer: !isSocket,
      id: null, roster: [], lastSend: 0, ping: 0, lastPingAt: 0,
      remote: [],
      clockLeft: MATCH_SECONDS, clockAt: null,   // filled by the host's welcome
      history: [], netErr: 0, wasDead: false,    // input replay — see reconcile()
      // our input packet counter, and the highest of them the room has run
      seq: 0, ack: 0,
      // which snapshot the mirrored world was last rebuilt from
      mirrorTick: -1,
    };

    if (isSocket) {
      connection.onmessage = (ev) => onlineMessage(ev.data);
      connection.onclose = () => {
        if (!online) return;
        hudMsg('Disconnected — finishing offline');
        online = null;
      };
      hudMsg('Online match — squad up');
    } else {
      // peer transports hand us parsed objects rather than socket frames
      P2P.on('message', (msg) => onlineMessage(msg));
      /* If the host closes their tab the match simply stopped arriving, and
         the world froze with no explanation. Say what happened and finish the
         round locally rather than leaving everyone staring at it. */
      // once only: P2P keeps status listeners across matches for the lobby
      if (!peerStatusBound) {
        peerStatusBound = true;
        P2P.on('status', (s) => {
          if (!online || !s || !s.disconnected) return;
          hudMsg('The host left — match over');
          const roster = online.roster;
          online = null;
          endMatch(false, roster);
        });
      }
      hudMsg(P2P.isHosting() ? 'Hosting — waiting for players' : 'Connected to host');
    }
    // hosting: the room was created before the map existed, so give it the
    // world we just built. Without this the sim has no geometry and players
    // walk through the buildings everyone can see.
    publishWorld();
  }

  function publishWorld() {
    if (typeof P2P !== 'undefined' && P2P.isHosting()) {
      /* The room needs the terrain too, not just the walls. It can't derive it
         — but we can, because we built this map from the room's own seed, and
         so did every guest. Handing the lookup over is what stops a player
         wading through a river at full speed on the host's copy while their
         own screen slows them to 0.55. */
      P2P.provideWorld({
        walls: netWorld(),
        objectives: netObjectives(),
        trenches: netTrenches(),
        crates: netCrates(),
        vehicles: netVehicles(),
        surface: (x, y) => (terrain ? Terrain.surfaceAt(terrain, x, y) : null),
      });
    }
  }

  /* Throw away the world we generated locally and rebuild it exactly as the
     host has it. Cheap enough to do once on join (~0.4s) and far simpler than
     streaming the map across the wire. */
  function rebuildWorld(seed, hostMode, hostMap) {
    worldSeed = seed >>> 0;
    if (hostMode && hostMode !== mode) {
      mode = hostMode;
      /* The mode came from the host, so the things the menu set from *our*
         choice have to follow it: how many squads there are, and what the HUD
         calls the match we're actually in. */
      /* Online the host's room decides the squad count, not our menu — ours
         is a preference for the matches we start ourselves. */
      nTeams = (TEAM_SETUP[mode] || TEAM_SETUP.domination).teams;
      teamScores = new Array(nTeams).fill(0);
      document.getElementById('hud-gamemode').textContent =
        mode === 'domination' ? 'DOMINATION' : 'ELIMINATION';
    }
    if (hostMap && hostMap.w && hostMap.h) { MAP_W = hostMap.w; MAP_H = hostMap.h; }
    buildMap();
    spawnCrates(Math.round(((MAP_W - Terrain.BEACH_INSET * 2) * (MAP_H - Terrain.BEACH_INSET * 2) / 1e6) * DENSITY.crates));
    if (mode === 'domination') {
      objectives = objectiveSpots().map(o => ({ ...o, owner: -1, progress: 0, capTeam: -1 }));
      for (const o of objectives) clearObjectiveSite(o);
    }
    stampWorldIds();
    buildNav();
    publishWorld();
    hudMsg('Synced to the host’s map');
  }

  function onlineMessage(raw) {
    if (!online) return;
    let msg;
    if (typeof raw === 'string') { try { msg = JSON.parse(raw); } catch (e) { return; } }
    else msg = raw;
    if (!msg) return;
    if (msg.t === 'welcome') {
      online.id = msg.id;
      online.roster = msg.roster || [];
      online.teams = msg.teams || nTeams;
      online.capacity = msg.capacity || 0;
      online.phase = msg.phase || 'live';
      if (player) player.team = msg.team;
      /* Start this match's clock where the host's already is, rather than at a
         full 8:00 until the first snapshot arrives. */
      setOnlineClock(msg.timeLeft);
      /* We built a world the moment we joined, before the host had told us
         which one. Rebuild it from the host's seed so everybody is standing
         on the same map — without this each client generated its own and
         players appeared to be in completely different places.

         The seed is not the only thing that has to match: we picked the mode
         from our own menu, and domination and elimination are different sizes
         of map. Joining a host who chose the other one left us simulating a
         6400px world while they ran a 4500px one. */
      /* Size the scoreboard to the match we actually joined. With more squads
         than we assumed, the extra ones had nowhere to put their score. */
      if (msg.teams > 0 && msg.teams !== nTeams) {
        nTeams = msg.teams;
        teamScores = new Array(nTeams).fill(0);
      }
      const wantMode = msg.mode || mode;
      const wantMap = msg.map && msg.map.w ? msg.map : { w: MAP_W, h: MAP_H };
      if ((typeof msg.seed === 'number' && msg.seed !== worldSeed)
        || wantMode !== mode || wantMap.w !== MAP_W || wantMap.h !== MAP_H) {
        rebuildWorld(typeof msg.seed === 'number' ? msg.seed : worldSeed, wantMode, wantMap);
      }
      /* Stand where the room put us. We spawned ourselves on joining, before
         we knew our team, so without this a guest starts at another squad's
         spawn point and is dragged across the map by the reconciler. */
      if (player && typeof msg.x === 'number') {
        player.x = msg.x; player.y = msg.y;
        player.vx = player.vy = 0;
        resolveObstacles(player);
      }
      // cover that was already shot away before we arrived, and doors the
      // people already here have opened
      for (const id of msg.downed || []) netDestroyWall(id);
      for (const id of msg.openDoors || []) netSetDoor(id, true);
      // and the cover people have dug, so we can see why they're hard to hit
      trenches.length = 0;
      for (const t of msg.trenches || []) trenches.push({ x: t.x, y: t.y, r: t.r });
      // crates already emptied, so nobody crosses the map for one with nothing in it
      for (const i of msg.opened || []) if (crates[i]) crates[i].opened = true;
      if (msg.you) netSyncSelf(msg.you);
      // last, so the lobby is drawn against the host's mode and squad count
      // rather than whatever we had picked on our own menu
      showLobby(online.phase === 'lobby');
    } else if (msg.t === 'mark') {
      // only ever sent to our own squad, so anything that arrives is ours
      addMark(msg.x, msg.y, msg.kind, msg.byId === online.id ? 'You' : msg.by, msg.byId === online.id);
    } else if (msg.t === 'snapshot') {
      /* Only the part that is ours is applied the instant it lands: what we
         are carrying, and how much of our input the room has run. Everything
         positional waits for onlineTick, which draws it on the same delayed,
         interpolated clock as the players — see netSyncEntities. */
      if (msg.you) netSyncSelf(msg.you);
      online.transport.snapshots.push({ at: performance.now(), data: msg });
      while (online.transport.snapshots.length > 32) online.transport.snapshots.shift();
      setOnlineClock(msg.timeLeft);
      /* Captures are decided by the host, not by each client guessing from the
         handful of players it can see. Everything about a point except where
         it is comes down the wire. */
      if (msg.objectives) {
        msg.objectives.forEach((s, i) => {
          const o = objectives[i];
          if (!o) return;
          if (o.owner !== s.o && s.o >= 0) Toast.show(`${TEAM_NAMES[s.o]} captured objective ${o.name}`);
          o.owner = s.o; o.progress = s.p; o.capTeam = s.c;
        });
      }
      if (msg.scores) for (let t = 0; t < teamScores.length; t++) teamScores[t] = msg.scores[t] || 0;
      for (const e of msg.events || []) {
        if (e.e === 'kill') onlineKill(e);
        else if (e.e === 'emote') addEmote(e.byId === online.id ? 'me' : e.byId, e.id);
        else if (e.e === 'wall') netDestroyWall(e.id);
        else if (e.e === 'door') netSetDoor(e.id, e.open);
        /* A blast the room worked out. Only the picture arrives — the damage
           and the cover it tore up are already in the snapshot — so this draws
           it and nothing else. Without it a barrel going off next to you took
           half your health with no fireball to explain why. */
        else if (e.e === 'boom') netBoom(e.x, e.y, e.r);
        else if (e.e === 'trench') netTrench(e);
        else if (e.e === 'flash') spawnFx(e.x, e.y, '#ffffff', 26);
        else if (e.e === 'crate') { if (crates[e.i]) crates[e.i].opened = true; }
        else if (e.e === 'loot' && e.id === online.id) hudMsg('Got ' + (e.label || e.got));
        else if (e.e === 'legendary') {
          if (e.id === online.id) { hudMsg('LEGENDARY! ' + e.name); SFX.reward(); }
        } else if (e.e === 'pickup' && e.id === online.id) {
          const it = Items.CONSUMABLES[e.kind];
          hudMsg(`Picked up ${it ? it.name : e.kind} ×${e.n}`);
        } else if (e.e === 'revive' && e.id === online.id) hudMsg('Revived by ' + e.by);
        else if (e.e === 'wreck') spawnFx(0, 0, '#ff9d3b', 0);
        else if (e.e === 'join') hudMsg(`${e.name} joined`);
        else if (e.e === 'leave') hudMsg(`${e.name} left`);
      }
    } else if (msg.t === 'lobby') {
      online.roster = msg.roster || [];
      online.teams = msg.teams || online.teams;
      online.capacity = msg.capacity || online.capacity;
      if (lobbyOpen()) renderLobby();
      updateRoomChip();
    } else if (msg.t === 'start') {
      // the host said go: everyone drops in on the same clock, together
      online.phase = 'live';
      online.roster = msg.roster || online.roster;
      online.history.length = 0;              // nothing before this counts
      setOnlineClock(msg.timeLeft);
      showLobby(false);
      hudMsg('Match started — good hunting');
      SFX.click();
    } else if (msg.t === 'rejected') {
      // the room turned us away — say why rather than sitting in an empty world
      hudMsg(msg.reason || 'The host turned you away');
      Toast.show(msg.reason || 'Could not join');
      online = null;
      quitMatch();
    } else if (msg.t === 'pong') {
      online.ping = Math.round(performance.now() - msg.c);
    } else if (msg.t === 'blind') {
      /* A flashbang that the room decided could see us. Line of sight is its
         call — it is the only place that has geometry everyone agrees on. */
      flashOverlay = Math.max(flashOverlay, msg.s || 0);
    } else if (msg.t === 'end') {
      const mine = (msg.scores || {})[player.team] || 0;
      const best = Math.max(0, ...Object.values(msg.scores || {}));
      const roster = msg.roster;          // read before `online` is cleared
      const won = mine >= best;
      endMatch(won, roster);
      online = null;
    }
  }

  /* ---------- the room's world, in the shapes the renderer already draws ----------
     Every one of these lists used to be simulated locally and was therefore a
     private fiction online: your grenades hurt nobody, your mines never went
     off, the loot on your floor was not on anyone else's. They are the room's
     now, so the client's job is to mirror them rather than to run them.

     Rebuilt into the same arrays the offline game uses, which is what lets the
     drawing code stay exactly as it was. `item` is looked up locally from the
     shared table rather than sent, because it never changes. */
  /* Driven from the two snapshots the renderer is drawing between, not from
     the newest one as it lands.

     That was the bug behind most of the remaining jitter. Remote players come
     from the interpolated pair, so they are drawn smoothly at a fixed lag
     behind the room. Everything else was written straight out of the newest
     snapshot the moment it arrived, so it moved in twenty steps a second while
     the players around it glided — and worse, the two were on different
     clocks: a passenger was drawn a tenth of a second behind the jeep he was
     sitting in, trailing along beside it like a shadow.

     One timeline for the whole world. `a` and `b` straddle render time and `k`
     is how far between them we are. */
  function netSyncEntities(a, b, k) {
    const msg = b;
    /* Two speeds. Things that move — grenades in flight, hulls being driven —
       are interpolated every frame, because that is the whole point. Things
       that only ever change when a snapshot says so — loot on the floor, a
       mine, a cloud of smoke — are rebuilt once per snapshot instead of sixty
       times a second for the same answer. */
    const fresh = b.tick !== online.mirrorTick;
    online.mirrorTick = b.tick;
    if (fresh && msg.drops) {
      const before = new Map(drops.map(d => [d.nid, d]));
      drops.length = 0;
      for (const d of msg.drops) {
        const old = before.get(d.i);
        drops.push({
          nid: d.i, x: d.x, y: d.y, id: d.k, n: d.n,
          cat: (Items.CONSUMABLES[d.k] || {}).cat || 'heal',
          // keep the bob running rather than resetting the animation every tick
          life: 99, bob: old ? old.bob : Math.random() * Math.PI * 2,
        });
      }
    }
    if (fresh && msg.smokes) {
      smokes.length = 0;
      for (const s of msg.smokes) smokes.push({ x: s.x, y: s.y, r: s.r, life: s.l, max: s.l });
    }
    if (msg.nades) {
      // a grenade covers 33px between snapshots — stepped, that reads as a
      // stutter rather than a throw
      const prev = byId(a && a.nades);
      grenades.length = 0;
      for (const g of msg.nades) {
        const it = Items.CONSUMABLES[g.k];
        if (!it) continue;
        const p = prev.get(g.i);
        grenades.push({
          x: p ? p.x + (g.x - p.x) * k : g.x,
          y: p ? p.y + (g.y - p.y) * k : g.y,
          mode: it.mode, item: it, team: g.tm, arrived: true,
        });
      }
    }
    if (fresh && msg.deploys) {
      /* A barricade is real geometry: it has to reach solidRects() or we
         predict our own movement straight through the thing the room is
         stopping us with. Rebuilt from the rect the room reports rather than
         re-derived, so both sides use the same rectangle to the pixel. */
      deployables.length = 0;
      let sig = '';
      for (const d of msg.deploys) {
        const it = Items.CONSUMABLES[d.k];
        if (!it) continue;
        const dp = {
          nid: d.i, type: it.mode, x: d.x, y: d.y, team: d.tm, item: it,
          life: 99, angle: d.a, hp: d.hp, maxHp: it.hp || d.hp, arm: 0, supply: 1,
        };
        if (it.mode === 'wall' && d.w > 0) {
          dp.rect = {
            x: d.rx, y: d.ry, w: d.w, h: d.h, type: 'barricade',
            thickness: 0.3, axis: d.w > d.h ? 'h' : 'v',
            hp: d.hp || 150, maxHp: 150, toughness: 1, dp,
          };
          sig += d.i + ',';
        }
        deployables.push(dp);
      }
      /* Only when the set of deployed *walls* actually changes. This runs every
         frame now rather than every snapshot, and invalidating unconditionally
         meant rebuilding the spatial index over seventeen hundred rects sixty
         times a second for as long as a single barricade stood anywhere on the
         map — which is a stutter far worse than the one it was drawn to stop. */
      if (sig !== barricadeSig) { barricadeSig = sig; invalidateRects(); }
    }
    if (msg.cars) netSyncVehicles(a && a.cars, msg.cars, k, fresh);
  }
  const byId = (list) => {
    const m = new Map();
    if (list) for (const e of list) m.set(e.i, e);
    return m;
  };

  /* The tracers to draw this frame, with the look of whatever fired them.
     Nothing about the gun travels on the wire: the shooter is in the same
     snapshot, so their weapon and skin are one lookup away, and a Gold rifle's
     round is gold on every screen for free. */
  const SENTRY_TRACER = '#35e0ff';
  function netBullets(a, b, k) {
    const out = [];
    const prev = byId(a && a.bullets);
    const shooters = new Map();
    for (const ag of (b.agents || [])) shooters.set(ag.id, ag);
    for (const bl of (b.bullets || [])) {
      // our own gunfire is already on screen — but our sentry's is not
      if (bl.o === online.id && !bl.s) continue;
      const p = prev.get(bl.i);
      const shooter = shooters.get(bl.o);
      const gun = bl.s || !shooter ? null : gunFor(shooter.weaponId, shooter.skin).weapon;
      out.push({
        x: p ? p.x + (bl.x - p.x) * k : bl.x,
        y: p ? p.y + (bl.y - p.y) * k : bl.y,
        a: bl.a, team: bl.team,
        color: bl.s ? SENTRY_TRACER : ((gun && gun.ammoColor) || '#ffd36a'),
        // a Tracer round is fatter, and a slower round draws a shorter streak
        wide: gun ? (gun.hitboxMult || 1) : 1,
        len: gun ? Math.max(14, Math.min(40, gun.bulletSpeed / 90)) : 26,
      });
    }
    return out;
  }
  // which barricades are standing, so the index is only rebuilt when that changes
  let barricadeSig = '';

  /* Hulls are agents on the client, because that is what the renderer, the
     camera and the damage numbers all expect one to be. Matched by id so a
     jeep keeps its identity across ticks instead of being rebuilt each frame. */
  function netSyncVehicles(was, cars, k, fresh) {
    const prev = byId(was);
    const live = new Set();
    for (const c of cars) {
      live.add(c.i);
      let v = agents.find(a => a.isVehicle && a.nid === c.i);
      if (!v) {
        v = spawnVehicle(c.tm, c.v, c.x, c.y);
        v.nid = c.i;
        v.neutral = c.tm < 0;
      }
      v.hp = c.hp; v.maxHp = c.mx; v.team = c.tm; v.alive = c.hp > 0;
      v.neutral = c.tm < 0;
      /* The mounted gun's magazine belongs to the room, like every other
         magazine. The driver's client was keeping its own count as it fired,
         so the two drifted apart and the HUD showed rounds that were not
         there — and a reload nobody had started. */
      if (c.am !== undefined) {
        v.ammo = c.am;
        v.reloadTimer = c.rl ? Math.max(v.reloadTimer, 1) : 0;
      }
      /* Whether *we* are the one driving. The room decides that, so a client
         that asked to get in only actually gets in when the answer comes back. */
      const mine = c.d && online && c.d === online.id;
      v.driver = c.d ? (mine ? player : { id: c.d }) : null;
      if (mine && player.riding !== v) { player.riding = v; input.ads = false; updateWeaponHud(); }
      if (!mine && player.riding === v) { player.riding = null; updateWeaponHud(); }

      if (mine) {
        /* The hull we are driving is predicted locally, exactly like our own
           body — driveVehicle() has already moved it this frame. Writing the
           room's position over the top would put the vehicle a full round trip
           behind the wheel, which is the difference between driving and
           steering a photograph. The room still has the last word; it just
           gets it gently. See reconcileRide(). */
        continue;
      }
      const p = prev.get(c.i);
      if (p) {
        v.x = p.x + (c.x - p.x) * k;
        v.y = p.y + (c.y - p.y) * k;
        v.angle = p.a + angleDiff(c.a, p.a) * k;
        v.hullAngle = p.ha + angleDiff(c.ha, p.ha) * k;
      } else {
        v.x = c.x; v.y = c.y; v.angle = c.a; v.hullAngle = c.ha;
      }
    }
    for (let i = agents.length - 1; i >= 0; i--) {
      const a = agents[i];
      if (!a.isVehicle) continue;
      if (live.has(a.nid)) { a.gone = 0; continue; }
      /* Not in this snapshot. That usually means it was destroyed, but it also
         means it fell outside the cull radius — and a hull parked right on that
         boundary would otherwise be torn down and rebuilt twenty times a second
         as you shifted a step back and forth. Give it a few snapshots' grace. */
      // counted in snapshots, not frames — this runs every frame now
      if (fresh) a.gone = (a.gone || 0) + 1;
      if ((a.gone || 0) < 4) continue;
      if (player.riding === a) player.riding = null;
      agents.splice(i, 1);
    }
  }

  /* Our own hull, eased onto the room's answer rather than snapped to it.
     Same shape as reconcile() for the body: take the newest snapshot we hold —
     not the delayed pair the others are drawn from — and close the gap
     exponentially so a correction is a drift rather than a jerk. */
  function reconcileRide(dt) {
    const v = player.riding;
    if (!v || !v.nid) return;
    const snaps = online.transport.snapshots;
    const newest = snaps.length ? snaps[snaps.length - 1].data : null;
    const auth = newest && (newest.cars || []).find(c => c.i === v.nid);
    if (!auth) return;
    const err = Math.hypot(auth.x - v.x, auth.y - v.y);
    if (err > NET_SNAP) { v.x = auth.x; v.y = auth.y; return; }
    if (err < 0.5) return;
    const kk = 1 - Math.exp(-NET_EASE * dt);
    v.x += (auth.x - v.x) * kk;
    v.y += (auth.y - v.y) * kk;
    // the driver rides inside the hull, so they move with it
    player.x = v.x; player.y = v.y;
  }

  /* The half of the snapshot that is only ours: what we are carrying, and how
     much of our own input the room has acted on. */
  function netSyncSelf(you) {
    online.ack = you.ack || 0;
    const inv = you.inv;
    if (!inv || !player || !player.inv) return;
    player.inv.grenade.id = inv.g; player.inv.grenade.n = inv.gn;
    player.inv.tactical.id = inv.t; player.inv.tactical.n = inv.tn;
    player.inv.heal.id = inv.h; player.inv.heal.n = inv.hn;
    player.inv.tokens = inv.tk || [];
  }

  /* A kill the server reported. The event carries names and ids but not teams,
     so we resolve each side against the live snapshot (falling back to the
     roster for someone who has since left) and hand it to the same feed the
     offline game uses. */
  function onlineKill(e) {
    const find = (id, fallbackName) => {
      if (id != null && online) {
        if (id === online.id) return player;
        const live = (online.remote || []).find(r => r.id === id);
        if (live) return { name: live.name, team: live.team };
        const known = (online.roster || []).find(r => r.id === id);
        if (known) return { name: known.name, team: known.team };
      }
      return fallbackName ? { name: fallbackName, team: -1 } : null;
    };
    const killer = find(e.byId, e.by);
    const victim = find(e.victimId, e.victim);
    if (killer && killer.isPlayer) matchStats.kills++;
    pushKill(killer, victim, e.zone);
  }

  /* push our intent to the server, and pull the interpolated world back */
  function onlineTick(dt) {
    if (!online) return;
    const t = performance.now();

    if (t - online.lastSend > 1000 / Net.SEND_RATE) {
      online.lastSend = t;
      const i = input;
      /* Every packet is numbered, and the room echoes back the highest number
         it has acted on. That is what lets reconcile() replay exactly the
         inputs still in flight instead of everything sent in the last half
         ping — see predictedPosition. */
      online.seq++;
      recordInput(online.seq);
      online.transport.send('input', {
        seq: online.seq,
        up: i.up, down: i.down, left: i.left, right: i.right,
        shooting: i.shooting, ads: i.ads, angle: player.angle,
        fire: i.fireEdge,
      });
    }
    if (t - online.lastPingAt > 2000) {
      online.lastPingAt = t;
      online.transport.send('ping', { c: t });
    }

    // rebuild the visible roster from the two snapshots straddling render time
    const pair = online.transport.interpolated();
    if (!pair) return;
    const lerped = Net.lerpAgents(pair.a, pair.b, pair.t);
    online.remote = lerped.filter(a => a.id !== online.id);
    // the rest of the world, on the same clock the players are drawn on
    netSyncEntities(pair.a, pair.b, pair.t);
    /* Rounds other people have in the air. Taken from the newer snapshot
       rather than interpolated — bullets carry no stable id, so there is
       nothing to match up between two frames, and at 20Hz a tracer is a
       streak either way. */
    /* Rounds other people have in the air, and the ones our own kit fired
       without us pulling the trigger.

       The filter used to be "not mine", which was right for a gun — we drew
       that shot the moment we fired it — and wrong for everything else we own.
       A sentry's rounds are stamped with the player who deployed it, so the
       one person guaranteed to be watching the turret was the only person it
       appeared to be firing blanks at.

       Interpolated on the same clock as everything else now that a round
       carries an id. At 20Hz an unmatched tracer moves a couple of hundred
       pixels between snapshots, which reads as a dotted line rather than a
       shot. */
    online.bullets = netBullets(pair.a, pair.b, pair.t);

    /* Our own agent is authoritative on the server too: take its HP and ammo
       from the room, but keep a locally-predicted position so aiming and
       movement stay responsive.

       Everything except position comes from the interpolated pair, because
       those are cosmetic and smoothness matters more than freshness. Position
       does not: it comes from the newest snapshot we hold, replayed forward.
       Mixing the two is what caused the rubber-banding. */
    const mine = lerped.find(a => a.id === online.id);
    if (mine && player) {
      player.hp = mine.hp;
      player.alive = mine.alive;
      online.respawn = mine.respawn || 0;   // the host owns the clock, not us
      player.ammo = mine.ammo;
      player.adrenaline = mine.adrenaline;
      player.vest = mine.vest; player.helmet = mine.helmet; player.bag = mine.bag || 0;
      // behind the wheel it is the hull that gets corrected, and we ride it
      if (player.riding) reconcileRide(dt);
      else reconcile(dt);
    }
  }

  /* One entry per distinct thing we asked for, stamped with when we asked.
     Runs of identical input collapse into one entry, so holding W for ten
     seconds is a single record rather than three hundred. */
  /* One entry per packet we actually sent, stamped with its sequence number
     and when it left. Recorded on send rather than every frame, so an entry
     corresponds one-for-one with something the room will acknowledge — a
     history keyed on time could only ever be matched to an ack by guessing. */
  function recordInput(seq) {
    const h = online.history;
    h.push({
      seq, at: performance.now(),
      up: input.up, down: input.down, left: input.left, right: input.right, ads: input.ads,
    });
    // drop what the room has confirmed, keeping one entry either side of the
    // boundary so the replay has something to start from
    while (h.length > 2 && h[1].seq <= (online.ack || 0)) h.shift();
    const cutoff = performance.now() - HISTORY_MS;
    while (h.length > 2 && h[1].at < cutoff) h.shift();
  }

  /* Where the room would say we are *now*, given where it said we were and
     everything we have asked for since.

     A snapshot describes the world as it was when the host built it, which is
     already one network trip in the past by the time we hold it. Replaying our
     own inputs across that window — from when the host sampled us up to this
     frame — reconstructs the position the room is about to agree with, instead
     of the one it has already moved on from. */
  /* The room advances everyone in fixed 1/60s steps and pushes them out of the
     walls after each one. Replaying in one jump per input instead was the last
     big source of rubber-banding, and the worst of it was against a wall.

     Walk diagonally into a building: the room slides you along the face, so the
     authoritative position stops advancing into it. The replay, which knew
     nothing about walls, kept adding the full diagonal for the whole
     round-trip — so the target it produced was tens of pixels *inside* the
     wall. That is well under NET_SNAP (400px), so it never resolved as a jump;
     instead reconcile() eased toward the wall interior every frame and
     resolveObstacles() shoved back out every frame, all match. Measured with a
     100ms round trip and a player leaning into a corner: a standing error of
     ~35px that never converged, which is the shudder people were reporting.

     Stepping the replay the way the room steps costs nine collision queries per
     frame for a 150ms window, and produces the position the room is actually
     going to report. */
  const REPLAY_STEP = 1 / 60;
  function predictedPosition(ax, ay) {
    const nowMs = performance.now();
    const h = online.history;
    /* Where the replay starts. The room tells us the last input packet it
       acted on, so the authoritative position we are replaying from already
       includes everything up to and including that packet — and what is left
       to reapply is precisely the packets after it.

       This used to be `snapAt - ping/2`: a guess at when the host sampled us,
       from a ping measured every two seconds. Whenever the real latency
       differed from that average the replay covered slightly the wrong span,
       so the predicted position sat a little ahead of or behind the truth and
       the reconciler pulled at us the whole time. An ack is not an estimate. */
    const ack = online.ack || 0;
    // a stand-in body so resolveObstacles can push it around without touching us
    const probe = { x: ax, y: ay, r: BODY_R };
    for (let i = 0; i < h.length; i++) {
      if (h[i].seq <= ack) continue;             // the room already ran this one
      const from = h[i].at;
      const to = (i + 1 < h.length ? h[i + 1].at : nowMs);
      if (to <= from) continue;
      const dx = (h[i].right ? 1 : 0) - (h[i].left ? 1 : 0);
      const dy = (h[i].down ? 1 : 0) - (h[i].up ? 1 : 0);
      const m = Math.hypot(dx, dy);
      if (!m) continue;
      let left = (to - from) / 1000;
      while (left > 1e-6) {
        const step = Math.min(left, REPLAY_STEP);
        left -= step;
        // the room's own movement model, terrain and wire and all — see
        // roomsim.moveSpeedFor, Room.surfaceAt and Room.hazardAt
        const surf = terrain ? Terrain.surfaceAt(terrain, probe.x, probe.y) : null;
        const hz = hazardAt(probe.x, probe.y);
        const spd = RoomSim.moveSpeedFor(player, h[i].ads)
          * RoomSim.surfaceSpeedFor(player, surf) * (hz ? hz.slow : 1) * step;
        probe.x = clamp(probe.x + (dx / m) * spd, BODY_R, MAP_W - BODY_R);
        probe.y = clamp(probe.y + (dy / m) * spd, BODY_R, MAP_H - BODY_R);
        resolveObstacles(probe);
      }
    }
    return { x: probe.x, y: probe.y };
  }

  function reconcile(dt) {
    const snaps = online.transport.snapshots;
    const newest = snaps.length ? snaps[snaps.length - 1] : null;
    if (!newest) return;
    const auth = (newest.data.agents || []).find(a => a.id === online.id);
    if (!auth) return;

    /* Dead players don't predict — there is nothing to predict — and coming
       back is a genuine teleport, so take the room's word for it outright. */
    if (!auth.alive) {
      player.x = auth.x; player.y = auth.y;
      online.history.length = 0; online.wasDead = true;
      return;
    }
    if (online.wasDead) { online.wasDead = false; online.history.length = 0; }

    const target = predictedPosition(auth.x, auth.y);
    const err = Math.hypot(target.x - player.x, target.y - player.y);
    online.netErr = err;                       // reported by netDebug()
    if (err > NET_SNAP) {
      // a respawn, or a correction so large that easing would look worse
      player.x = target.x; player.y = target.y;
      online.history.length = 0;
    } else if (err > 0.5) {
      /* Exponential, so the pull is frame-rate independent: at 30fps and at
         240fps the error decays at the same rate per second rather than per
         frame. */
      const k = 1 - Math.exp(-NET_EASE * dt);
      player.x += (target.x - player.x) * k;
      player.y += (target.y - player.y) * k;
    }
    resolveObstacles(player);
  }

  /* ================= LOBBY =================
     Everyone waits here until the host starts the match, so a round begins
     with the squads that are actually going to play it, on a clock that
     starts when the fighting does. Drawn over the match rather than as its
     own screen: the world is already built and the snapshots are already
     flowing, so there is nothing to tear down when it goes away. */
  function lobbyOpen() { return !!(online && online.phase === 'lobby'); }

  function showLobby(on) {
    const el = document.getElementById('game-lobby');
    if (el) el.classList.toggle('is-open', !!on);
    if (on) renderLobby();
  }

  function renderLobby() {
    if (!online) return;
    const info = (typeof P2P !== 'undefined' && P2P.roomInfo()) || {};
    const roster = online.roster || [];
    const teams = online.teams || nTeams;
    const cap = online.capacity || 0;

    const codeEl = document.getElementById('lobby-code-v');
    if (codeEl) codeEl.textContent = info.local ? 'LOCAL' : (info.code || '-----');
    document.getElementById('lobby-count').textContent =
      `${roster.length} ${roster.length === 1 ? 'player' : 'players'}${cap ? ` · room fits ${cap}` : ''}`
      + ` · ${mode === 'domination' ? 'Domination' : 'Elimination'}`;

    const host = info.hosting;
    const sub = document.getElementById('lobby-sub');
    sub.textContent = host
      ? (roster.length > 1
        ? 'Everyone deploys together when you start.'
        : 'Share the code — the match starts when you say so.')
      : 'Waiting for the host to start the match.';

    /* One card per squad, including the empty ones, so it reads as a set of
       teams filling up rather than a flat list of names. */
    const box = document.getElementById('lobby-squads');
    let html = '';
    for (let t = 0; t < teams; t++) {
      const members = roster.filter(r => r.team === t);
      const colour = TEAM_COLORS[t % TEAM_COLORS.length];
      html += `<div class="lobby__squad" style="border-left-color:${colour}">
        <h4 style="color:${colour}">${TEAM_NAMES[t % TEAM_NAMES.length].toUpperCase()}</h4><ul>`;
      html += members.length
        ? members.map(r => `<li class="${r.id === online.id ? 'is-you' : ''}">${escapeHtml(r.name)}`
          + `${r.id === online.id ? '<span class="lobby__tag">YOU</span>' : ''}</li>`).join('')
        : '<li class="is-empty">empty</li>';
      html += '</ul></div>';
    }
    box.innerHTML = html;

    const startBtn = document.getElementById('btn-lobby-start');
    startBtn.style.display = host ? '' : 'none';
    startBtn.textContent = roster.length > 1 ? `Start Match · ${roster.length} players` : 'Start Match';
  }

  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function bindLobby() {
    const start = document.getElementById('btn-lobby-start');
    if (!start || start.dataset.bound) return;
    start.dataset.bound = '1';
    start.addEventListener('click', () => {
      if (typeof P2P === 'undefined' || !P2P.startMatch()) return;
      SFX.click();
    });
    document.getElementById('btn-lobby-leave').addEventListener('click', () => {
      showLobby(false);
      quitMatch();
    });
    document.getElementById('lobby-code').addEventListener('click', () => {
      const info = (typeof P2P !== 'undefined' && P2P.roomInfo()) || {};
      if (!info.code || info.local) return;
      const link = `${location.origin}${location.pathname}?game=${info.code}`;
      if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
      Toast.show('Invite link copied — code ' + info.code);
    });
  }

  /* What the netcode currently thinks, for diagnosing sync complaints without
     having to guess from the outside. */
  function netDebug() {
    if (!online) return null;
    const snaps = online.transport.snapshots;
    return {
      id: online.id, ping: online.ping,
      x: Math.round(player.x), y: Math.round(player.y),
      err: Math.round((online.netErr || 0) * 10) / 10,
      players: (online.remote || []).length + 1,
      snapshots: snaps.length,
      history: online.history.length,
      timeLeft: Math.round(timeLeft),
    };
  }

  /* ---------- somebody else's gun ----------
     A snapshot names a weapon and a skin; drawWeapon wants the weapon object
     and a cached profile. Resolving that is a table lookup and a shape build,
     so the result is kept per weapon-and-skin rather than per player per
     frame — a full lobby is a handful of distinct guns, not two dozen.

     A looted legendary is the one id that is not in the weapon table: it is
     minted at pickup as `<base>-gold` (see Items.makeLegendary), so it is
     rebuilt here the same way rather than falling back to a stock rifle. */
  const gunCache = new Map();
  function gunFor(weaponId, skinId) {
    const key = weaponId + '|' + skinId;
    let g = gunCache.get(key);
    if (g) return g;
    let w = Weapons.byId[weaponId];
    if (!w && typeof weaponId === 'string' && weaponId.endsWith('-gold')) {
      const base = Weapons.byId[weaponId.slice(0, -5)];
      if (base) w = Items.makeLegendary(base);
    }
    if (!w) w = Weapons.byId[Weapons.default];
    g = { weapon: w, profile: Skins.profileFor(w, skinId || 'default') };
    gunCache.set(key, g);
    return g;
  }
  /* A snapshot agent dressed up as something drawWeapon can take. */
  const remoteProbe = { x: 0, y: 0, angle: 0, r: BODY_R, weapon: null, gunProfile: null };
  function remoteGun(a) {
    const g = gunFor(a.weaponId, a.skin);
    remoteProbe.x = a.x; remoteProbe.y = a.y; remoteProbe.angle = a.angle;
    remoteProbe.weapon = g.weapon; remoteProbe.gunProfile = g.profile;
    return remoteProbe;
  }

  /* remote players, drawn from the server's snapshot */
  function drawRemotePlayers() {
    if (!online) return;
    for (const a of online.remote) {
      if (!a.alive || !onScreen(a.x, a.y, 40)) continue;
      const col = TEAM_COLORS[a.team % TEAM_COLORS.length];
      // same body size as a local agent — a remote player must be the same
      // target the server is hit-testing
      drawUnitShadow(a.x, a.y, BODY_R);
      /* The gun they are actually carrying, in the skin they bought for it.
         Both have been in the snapshot all along and neither was ever drawn:
         everyone else on the island held the same white stick, so you could
         not tell a shotgun closing on you from a sniper lining you up, and a
         Gold rifle looked like everybody else's. Same routine the local agents
         use, so a remote player and a bot are drawn by one piece of code. */
      drawWeapon(remoteGun(a));
      ctx.beginPath(); ctx.arc(a.x, a.y, BODY_R, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
      const hpw = 26;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(a.x - hpw / 2, a.y - BODY_R - 12, hpw, 5);
      ctx.fillStyle = a.hp > 50 ? '#4be08a' : a.hp > 25 ? '#ffcf4a' : '#ff4b5c';
      ctx.fillRect(a.x - hpw / 2, a.y - BODY_R - 12, hpw * clamp(a.hp / 100, 0, 1), 5);
      // name tag, so you can tell your squad apart
      ctx.fillStyle = a.team === player.team ? '#9fe8b4' : '#ffd0d4';
      ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(a.name || '', a.x, a.y - BODY_R - 20);
    }
  }

  const isOnline = () => !!online;

  /* ---------------- tuning hook ----------------
     A window onto the player and the rounds in flight, and a way to put them
     into a specific state. The damage tables have a lot of rows that only
     show themselves in rare moments — a last stand, a fuzed round mid-bounce,
     an Anti-Tank round meeting a person — and waiting for those to happen
     naturally is not a way to check them. Read-mostly, and it changes nothing
     about how the game plays unless something calls it. */
  const debug = {
    state() {
      if (!player) return null;
      const kit = player.inv && Items.CONSUMABLES[player.cls.consumable];
      const slot = kit && player.inv[kit.cat];
      return {
        hp: Math.round(player.hp), alive: player.alive,
        adrenaline: Math.round(player.adrenaline), standT: player.standT || 0,
        vest: player.vest, helmet: player.helmet, bag: player.bag, perk: player.perk,
        maxHp: player.maxHp, mag: player.weapon.mag,
        cls: player.cls.name, weapon: player.weapon.name,
        ammoName: player.weapon.ammoName || null, fuze: player.weapon.fuze || 0,
        antiTank: !!player.weapon.antiTank, mag: player.weapon.mag,
        kit: slot ? slot.n : 0,
      };
    },
    set(patch) {
      if (!player) return;
      for (const k of ['hp', 'adrenaline', 'vest', 'helmet', 'bag', 'perk', 'x', 'y', 'angle']) {
        if (patch[k] !== undefined) player[k] = patch[k];
      }
      if (patch.bag !== undefined) refillFromBag();
      if (patch.x !== undefined || patch.y !== undefined) resolveObstacles(player);
    },
    hit(dmg, type) { if (player) applyDamage(player, dmg, null, type || 'normal', 'body'); },
    // swap the loaded specialized ammo without going back to the gunsmith
    setAmmo(name) {
      if (!player) return;
      const base = Weapons.byId[player.baseWeapon.id] || player.baseWeapon;
      equipWeapon(player, Weapons.configure(base, { ammo: name || null }));
    },
    respawn() { if (player) { player.alive = true; respawnAgent(player); } },
    fire(n) {
      let fired = 0;
      for (let i = 0; i < (n || 1); i++) { const before = bullets.length; fireOnce(player); if (bullets.length > before) fired++; }
      return fired;
    },
    bullets: () => bullets.length,
    // rebuild the player from the current perk — Beefy and Bullet Strap are
    // applied when an agent is made, not every frame
    respawnFresh() {
      if (!player) return;
      const perk = player.perk;
      player.maxHp = Combat.maxHpFor('infantry', perk);
      player.hp = player.maxHp;
      player.weapon = Perks.applyToWeapon(player.baseWeapon || player.weapon, perk);
      player.ammo = player.weapon.mag;
    },
    buildings: () => buildings.map(b => ({ name: b.name, x: b.x, y: b.y, w: b.w, h: b.h })),
    interior() {
      const counts = {};
      for (const d of decor) counts[d.kind] = (counts[d.kind] || 0) + 1;
      for (const o of obstacles) if (o.isProp) counts[kindOf(o).prop] = (counts[kindOf(o).prop] || 0) + 1;
      return {
        buildings: buildings.length, obstacles: obstacles.length, decor: decor.length,
        lights: obstacles.filter(o => kindOf(o).lights).length,
        windows: obstacles.filter(o => o.type === 'window').length,
        doors: obstacles.filter(o => Structures.isDoor(o)).length,
        kinds: Object.keys(counts).sort(), counts,
      };
    },
    purpose() {
      const cx = MAP_W / 2, cy = MAP_H / 2;
      const byGrade = {};
      const rows = buildings.map(b => {
        const pu = Structures.purposeOf(b.name);
        const d = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) / (Math.min(cx, cy));
        (byGrade[pu.grade] = byGrade[pu.grade] || []).push(d);
        return { name: b.name, grade: pu.grade, ring: pu.ring, dist: +d.toFixed(2), team: b.teamBase };
      });
      const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
      return {
        rows,
        meanDist: Object.fromEntries(Object.entries(byGrade).map(([g, a]) => [g, +mean(a).toFixed(2)])),
        teamBases: rows.filter(r => r.team !== undefined).map(r => r.team).sort(),
        basements: basements.length,
        hatches: obstacles.filter(o => o.hatch).length,
        crates: crates.reduce((m, c) => { m[c.tier] = (m[c.tier] || 0) + 1; return m; }, {}),
      };
    },
    lootByGrade() {
      const out = {};
      for (const c of crates) {
        const b = buildings.find(bb => c.x >= bb.x && c.x <= bb.x + bb.w && c.y >= bb.y && c.y <= bb.y + bb.h);
        if (!b) continue;
        const g = Structures.purposeOf(b.name).grade;
        out[g] = out[g] || { good: 0, total: 0 };
        out[g].total++;
        /* Only the tiers that are actually better. Searchable furniture is a
           crate with a locker's face on it, not a prize — counting it as one
           put a shed full of shelving on a par with a vault. */
        if (c.tier === 'silver' || c.tier === 'gold' || c.tier === 'chest') out[g].good++;
      }
      return out;
    },
    variance() {
      const floors = new Set(), roofs = new Set(), byName = {};
      let rooms = 0, styledRooms = 0, sig = '';
      for (const b of buildings) {
        floors.add(b.floor); roofs.add(b.style.roof.join(''));
        (byName[b.name] = byName[b.name] || []).push(b.floor);
        sig += b.name + b.floor + b.style.roof.join('');
        for (const r of b.rooms || []) { rooms++; if (Structures.roomStyleOf(r.kind)) styledRooms++; }
      }
      const repeats = {};
      for (const [n, list] of Object.entries(byName)) {
        if (list.length > 1) repeats[n] = { count: list.length, distinct: new Set(list).size };
      }
      let h = 2166136261;
      for (const ch of sig) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
      return {
        total: buildings.length, kinds: new Set(buildings.map(b => b.name)).size,
        floors: floors.size, roofs: roofs.size, repeats, rooms, styledRooms,
        signature: (h >>> 0).toString(16) + ':' + buildings.length,
      };
    },
    decorByBuilding() {
      const rows = [];
      const profiles = new Set();
      for (const b of buildings) {
        const want = Structures.decorFor(b.name);
        /* Only what is genuinely OUTSIDE the walls, and not a light — lamps
           are interior fittings that also carry a building name, and counting
           them as exterior clutter says a resort's front garden is made of
           twenty-one lamps. */
        const outside = (o) => o.x < b.x || o.x > b.x + b.w || o.y < b.y || o.y > b.y + b.h;
        const near = obstacles.filter(o => o.isProp && o.building === b.name
          && !kindOf(o).lights && outside(o)
          && o.x > b.x - 140 && o.x < b.x + b.w + 140
          && o.y > b.y - 140 && o.y < b.y + b.h + 140);
        const counts = {};
        for (const o of near) { const k = kindOf(o).prop; counts[k] = (counts[k] || 0) + 1; }
        const top = Object.entries(counts).sort((x, y) => y[1] - x[1]).slice(0, 3).map(e => `${e[0]}x${e[1]}`);
        const offList = near.filter(o => !want.includes(kindOf(o).prop)).length;
        rows.push({ name: b.name, n: near.length, top, offList });
        profiles.add(Object.keys(counts).sort().join(','));
      }
      return { rows, profiles: profiles.size };
    },
    newBits() {
      const kinds = new Set();
      for (const b of buildings) for (const r of b.rooms || []) kinds.add(r.kind);
      return {
        kinds: [...kinds],
        posts: obstacles.filter(o => o.type === 'post' || o.type === 'pillar').length,
      };
    },
    /* a spot with clear sight, and a spot the same wall hides */
    behindWall() {
      for (const o of obstacles) {
        if (!Structures.blocksSight(o) || o.w < 60) continue;
        const cx = o.x + o.w / 2;
        const from = { x: cx, y: o.y - 150 };
        const lit = { x: cx + 220, y: o.y - 150 };
        const shadowed = { x: cx, y: o.y + o.h + 130 };
        if (pointInObstacle(from.x, from.y) || pointInObstacle(lit.x, lit.y)) continue;
        if (pointInObstacle(shadowed.x, shadowed.y)) continue;
        if (hasLOS(from.x, from.y, shadowed.x, shadowed.y)) continue;
        return { from, lit, shadowed };
      }
      return null;
    },
    sampleBrightness(a2, b2) {
      const g = canvas.getContext('2d');
      const at = (wx, wy) => {
        const sx = Math.round((wx - camX) * zoom), sy = Math.round((wy - camY) * zoom);
        if (sx < 2 || sy < 2 || sx > canvas.width - 2 || sy > canvas.height - 2) return -1;
        const d = g.getImageData(sx - 2, sy - 2, 5, 5).data;
        let t = 0;
        for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2];
        return Math.round(t / (d.length / 4) / 3);
      };
      return { lit: at(a2.x, a2.y), shadowed: at(b2.x, b2.y) };
    },
    botBrains() {
      let remembering = 0, takingCover = 0, flanking = false, inContact = 0, exposed = 0;
      for (const a2 of agents) {
        if (!a2.alive || a2.isPlayer || a2.isVehicle) continue;
        if (a2.lastSeen) remembering++;
        if (a2.coverPt) takingCover++;
        if (a2.contactT > 0) inContact++;
        if ((a2.exposedT || 0) > 0.5) exposed++;
        if (a2.flankBias !== undefined && Math.abs(a2.flankBias) > 0.3) flanking = true;
      }
      return { remembering, takingCover, flanking, inContact, exposed };
    },
    vehicleDoors: () => obstacles.filter(o => o.type === 'garage-door').length,
    vehicleSizes() {
      const M = Structures.PX_PER_M;
      const list = agents.filter(a => a.isVehicle).map(v => ({
        name: v.name, m: +((v.r * 2) / M).toFixed(2),
        insideGeometry: pointInObstacle(v.x, v.y),
      }));
      const seen = {};
      return { list: list.filter(v => (seen[v.name] ? false : (seen[v.name] = true))) };
    },
    objectiveState: () => ({
      total: objectives.length,
      owned: objectives.filter(o => o.owner >= 0).length,
      names: objectives.map(o => o.name + ':' + (o.owner >= 0 ? 'T' + o.owner : '-')),
    }),
    captureAll() { for (const o of objectives) { o.owner = 0; o.progress = 100; } return true; },
    /* Reproduce the teleport: blow up a bot-driven hull while the player is
       riding a different one, and see whether the player gets thrown out of
       their own vehicle by an explosion they were nowhere near. */
    wreckTest() {
      const hulls = agents.filter(a => a.isVehicle && a.alive);
      if (hulls.length < 2) return { error: 'need two hulls' };
      const mine = hulls[0], theirs = hulls[1];
      // put the player in one, a bot in the other, far apart
      const bot = agents.find(a => !a.isPlayer && !a.isVehicle && a.alive);
      mine.x = player.x; mine.y = player.y;
      theirs.x = player.x + 3000; theirs.y = player.y + 3000;
      player.riding = mine; mine.driver = player;
      bot.riding = theirs; theirs.driver = bot;
      const before = { x: player.x, y: player.y, hp: player.hp, riding: !!player.riding };
      killAgent(theirs, null, null);            // their hull brews up, far away
      const after = { x: player.x, y: player.y, hp: player.hp, riding: !!player.riding };
      const moved = Math.round(Math.hypot(after.x - before.x, after.y - before.y));
      const botFreed = !bot.riding;
      // tidy up
      if (player.riding) { player.riding.driver = null; player.riding = null; }
      return { playerMoved: moved, playerLostHp: before.hp - after.hp,
               playerStillRiding: after.riding, botFreedFromWreck: botFreed };
    },
    roster() {
      const live = agents.filter(a => !a.isVehicle);
      const byTeam = {};
      for (const a of live) byTeam[a.team] = (byTeam[a.team] || 0) + 1;
      const counts = Object.values(byTeam);
      return {
        teams: counts.length, perTeam: counts[0] || 0,
        total: live.length, even: counts.every(c => c === counts[0]),
      };
    },
    biome: () => (terrain && terrain.biome
      ? { name: terrain.biome.name, tree: terrain.biome.tree, grass: terrain.colors.grass }
      : null),
    /* Trench cover by range, a wall from a barricade, and an effect for every
       class tool. */
    realismTest() {
      const out = { toolsWithFx: 0, tools: 0, missing: [] };
      for (const id of Object.keys(Classes.TOOLS || {})) {
        out.tools++;
        if (TOOL_FX[id]) out.toolsWithFx++; else out.missing.push(id);
      }
      // a deployed barricade has to reach the collision world as a real wall
      out.barricadeIsWall = solidRects().some(r => r.type === 'barricade' && r.deployed);
      return out;
    },
    /* Cover from a trench, sampled at three ranges. */
    trenchTest() {
      const t = { x: player.x, y: player.y, r: 48 };
      trenches.push(t);
      const shots = (range) => {
        let saved = 0;
        const shooter = { x: player.x + range, y: player.y, isPlayer: false };
        for (let i = 0; i < 400; i++) {
          const hp0 = player.hp;
          applyDamage(player, 1, shooter, 'normal');
          if (player.hp === hp0) saved++;
          player.hp = player.maxHp;
        }
        return Math.round(saved / 4);
      };
      const res = { pointBlank: shots(60), mid: shots(300), across: shots(700) };
      trenches.pop();
      player.hp = player.maxHp;
      return res;
    },
    /* Does going down actually work: down, crawl, revive, bleed out? */
    downTest() {
      const mate = agents.find(q => q.alive && !q.isPlayer && !q.isVehicle && q.team === player.team);
      if (!mate) return { error: 'no teammate on this map' };
      const out = {};
      // put them down rather than killing them
      mate.x = player.x + 40; mate.y = player.y;
      mate.hp = 1;
      applyDamage(mate, 999, null, 'normal');
      out.downedNotDead = !!(mate.downed && mate.alive);
      out.deathsUnchanged = mate.deaths === 0;
      // stand over them and count them back up
      for (let i = 0; i < 90 && mate.downed; i++) updateDowned(mate, 0.05);
      out.revivedByStandingOver = !mate.downed && mate.alive;
      out.reviveHp = mate.hp;
      // and bleeding out goes through the same death path as a kill
      mate.hp = 1; applyDamage(mate, 999, null, 'normal');
      const wasDowned = !!mate.downed;
      mate.x = player.x + 4000; mate.y = player.y + 4000;   // nobody near
      for (let i = 0; i < 600 && mate.alive; i++) updateDowned(mate, 0.05);
      out.bleedsOutAlone = wasDowned && !mate.alive && mate.deaths > 0;
      return out;
    },
    /* Do the five feedback systems actually fire? */
    feelTest() {
      hitMarkers = []; hurtArcs = []; shake = { mag: 0, t: 0 }; streakBanner = null;
      addHitMarker('head');
      addHurtArc(player.x + 300, player.y + 120);
      addShake(8);
      multiKill = { n: 1, until: performance.now() + 4000 };
      noteKill();
      const lowHp = player.maxHp * 0.2;
      return {
        hitmarkers: hitMarkers.length,
        damageArcs: hurtArcs.length,
        screenShake: +shake.mag.toFixed(1),
        multiKillCallout: streakBanner ? streakBanner.text : 'none',
        lowHealthAt: lowHp < player.maxHp * 0.45,
      };
    },
    /* Are the bots getting into buildings, and are they driving? */
    botNav() {
      let bots = 0, everIndoors = 0, withPath = 0, stuck = 0, botDriven = 0;
      let vehicles = 0, unclaimed = 0;
      for (const a2 of agents) {
        if (a2.isVehicle) {
          vehicles++;
          if (!a2.driver) unclaimed++;
          else if (!a2.driver.isPlayer) botDriven++;
          continue;
        }
        if (a2.isPlayer || !a2.alive) continue;
        bots++;
        if (insideAnyBuilding(a2.x, a2.y, -10)) a2.everIndoors = true;
        if (a2.everIndoors) everIndoors++;
        if (a2.path && a2.path.length) withPath++;
        if ((a2.stuckAcc || 0) > 0.6) stuck++;
      }
      return { bots, everIndoors, withPath, stuck, botDriven, vehicles, unclaimed };
    },
    /* Are the props the size of the things they are, can you hide in the ones
       you should be able to, and do the solid ones actually stop you? */
    propAudit() {
      const M = Structures.PX_PER_M;
      const props = obstacles.filter(o => o.isProp);
      const by = {};
      for (const o of props) {
        const k = o.type;
        by[k] = by[k] || { n: 0, w: 0, h: 0, solid: Structures.blocksMove(o), conceals: !!kindOf(o).conceals };
        by[k].n++; by[k].w += o.w; by[k].h += o.h;
      }
      const rows = Object.entries(by).map(([k, v]) => ({
        kind: k, n: v.n,
        m: +((v.w / v.n) / M).toFixed(2),          // mean footprint in metres
        tall: +((v.h / v.n) / M).toFixed(2),
        solid: v.solid, conceals: v.conceals,
      })).sort((a2, b2) => b2.m - a2.m);
      // a bush has to be wider than the body standing in it, or it hides nobody
      const bush = rows.find(r => r.kind === 'bush');
      const body = (BODY_R * 2) / M;
      return {
        rows, body: +body.toFixed(2),
        bushCoversBody: bush ? bush.m > body * 1.6 : false,
        solidKinds: rows.filter(r => r.solid).length,
        passableKinds: rows.filter(r => !r.solid).length,
      };
    },
    /* Stand in the nearest bush and see whether it hides you. */
    hideTest() {
      let best = null, bd = Infinity;
      for (const o of obstacles) {
        if (!o.isProp || !kindOf(o).conceals) continue;
        const d = dist2(player.x, player.y, o.x + o.w / 2, o.y + o.h / 2);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) return null;
      const before = inConcealment(player);
      player.x = best.x + best.w / 2; player.y = best.y + best.h / 2;
      player.stillT = 5;                          // as if you had stopped in it
      const after = inConcealment(player);
      return { kind: best.type, hiddenBefore: before, hiddenInside: after };
    },
    /* Is the outdoor dressing actually lined up? Three questions: does a run
       of wire join end to end, does it run parallel to the building it is
       protecting, and do the props in a yard row share a line. */
    alignment() {
      const wire = obstacles.filter(o => o.type === 'wire' && !o.underground);
      const joins = (a, b) => (Math.abs(a.y - b.y) < 3 && (Math.abs((a.x + a.w) - b.x) < 6 || Math.abs((b.x + b.w) - a.x) < 6))
        || (Math.abs(a.x - b.x) < 3 && (Math.abs((a.y + a.h) - b.y) < 6 || Math.abs((b.y + b.h) - a.y) < 6));
      const inRun = wire.filter(a => wire.some(b => b !== a && joins(a, b))).length;

      // wire whose line is parallel to, and a consistent distance from, a wall
      let alongBuilding = 0;
      for (const s of wire) {
        const horiz = s.w >= s.h;
        const hit = buildings.some((b) => {
          if (horiz) {
            const overlap = Math.min(s.x + s.w, b.x + b.w) - Math.max(s.x, b.x);
            if (overlap < s.w * 0.5) return false;
            return Math.abs(s.y - (b.y - WIRE_STANDOFF)) < 26 || Math.abs(s.y - (b.y + b.h + WIRE_STANDOFF)) < 26;
          }
          const overlap = Math.min(s.y + s.h, b.y + b.h) - Math.max(s.y, b.y);
          if (overlap < s.h * 0.5) return false;
          return Math.abs(s.x - (b.x - WIRE_STANDOFF)) < 26 || Math.abs(s.x - (b.x + b.w + WIRE_STANDOFF)) < 26;
        });
        if (hit) alongBuilding++;
      }

      /* Yard props that share a line with another prop of the same building:
         same x or same y to within a few pixels, which is what a row is. */
      const yard = obstacles.filter(o => o.isProp && o.building);
      let lined = 0;
      for (const a of yard) {
        const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
        if (yard.some((b) => {
          if (b === a || b.building !== a.building) return false;
          const bx = b.x + b.w / 2, by = b.y + b.h / 2;
          const d = Math.hypot(bx - ax, by - ay);
          /* 240px was too tight a window: a row of six spread along a
             1500px harbor frontage sits 250px apart, so props that were
             perfectly in line were being counted as scattered. */
          return d < 420 && (Math.abs(bx - ax) < 8 || Math.abs(by - ay) < 8);
        })) lined++;
      }

      // furniture of a kind standing together in a bank along one wall
      /* Searchable pieces are furniture too — they left `decor` for `crates`
         when they were made lootable, and counting only what stayed behind
         measured about half the furniture in the building. */
      const inside = decor.filter(d => d.indoors && PLACEMENT[d.kind] === 'wall')
        .concat(crates.filter(c => c.look && PLACEMENT[c.look] === 'wall')
          .map(c => ({ kind: c.look, x: c.x, y: c.y })));
      let banked = 0;
      for (const a of inside) {
        if (inside.some((b) => b !== a && b.kind === a.kind
          && Math.hypot(b.x - a.x, b.y - a.y) < 90
          && (Math.abs(b.x - a.x) < 6 || Math.abs(b.y - a.y) < 6))) banked++;
      }
      // man-made yard props should be square to the wall they are stacked on
      const manMade = yard.filter(o => !NATURAL_PROPS.has(o.type));
      const square = manMade.filter((o) => {
        const q = Math.abs(((o.rot || 0) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2));
        return q < 0.02 || Math.PI / 2 - q < 0.02;
      }).length;
      return {
        wire: wire.length, wireInRun: inRun, wireAlongBuilding: alongBuilding,
        yard: yard.length, yardLined: lined,
        manMade: manMade.length, manMadeSquare: square,
        wallFurniture: inside.length, inBanks: banked,
      };
    },
    /* Where the loot ended up, and whether the new routes exist. */
    lootLayout() {
      const byTier = crates.reduce((m, c) => { m[c.tier] = (m[c.tier] || 0) + 1; return m; }, {});
      const furn = decor.filter(d => d.indoors);
      const searchable = crates.filter(c => c.look);
      let near = 0, indoor = 0;
      for (const c of crates) {
        if (!c.indoors || c.look) continue;
        indoor++;
        // "with the decor" means within a body's width of a piece of furniture,
        // whether that is a shelf or another searchable piece
        const close = (q) => dist2(q.x, q.y, c.x, c.y) < 78 * 78;
        if (furn.some(close) || searchable.some(close)) near++;
      }
      const rooms = [].concat(...buildings.map(b => b.rooms || []));
      return {
        byTier,
        chests: byTier.chest || 0,
        searchable: searchable.length,
        searchableLooks: [...new Set(searchable.map(c => c.look))],
        nearFurniture: near, indoor,
        tunnels: rooms.filter(r => r.kind === 'tunnel').length,
        passages: rooms.filter(r => r.kind === 'passage').length,
        hatches: obstacles.filter(o => o.hatch).length,
      };
    },
    /* How much one crate is worth against one chest, counted in items granted
       rather than inferred from the tables. */
    payoutTest() {
      const real = grantLoot;
      let n = 0;
      grantLoot = () => { n++; };
      try {
        n = 0; openCrate({ tier: 'regular', opened: false }); const crate = n;
        n = 0; openCrate({ tier: 'chest', opened: false }); const chest = n;
        return { crate, chest };
      } finally { grantLoot = real; }
    },
    /* Walk to the nearest searchable piece of furniture and search it. */
    searchNearestFurniture() {
      let best = null, bd = Infinity;
      for (const c of crates) {
        if (!c.look || c.opened) continue;
        const d = dist2(player.x, player.y, c.x, c.y);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) return null;
      const real = grantLoot;
      let got = null;
      grantLoot = (entry) => { got = entry.label; };
      try { openCrate(best); } finally { grantLoot = real; }
      return got;
    },
    /* Time each render pass over `frames` frames, in ms per frame. */
    perf(frames) {
      return new Promise((resolve) => {
        for (const k in perfAcc) delete perfAcc[k];
        perfOn = true;
        let n = 0;
        const step = () => {
          if (++n >= (frames || 120)) {
            perfOn = false;
            const out = {};
            for (const k in perfAcc) out[k] = +(perfAcc[k] / n).toFixed(2);
            out.obstacles = obstacles.length;
            resolve(out);
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    },
    /* Every rect that can stop a body, for comparing one tab's world against
       another's. */
    solidWorld: () => obstacles.filter(o => !o.dead && Structures.blocksMove(o))
      .map(o => ({ x: o.x, y: o.y, w: o.w, h: o.h })),
    /* Is this point inside something solid? Used to check that a test's
       hard-coded coordinate is still standing on clear ground. */
    blockedAt: (x, y) => pointInObstacle(x, y),
    /* Did the furniture end up where furniture goes? */
    decorPlacement() {
      const inside = (d) => buildings.find(b => d.x >= b.x && d.x <= b.x + b.w && d.y >= b.y && d.y <= b.y + b.h);
      const roomOf = (d) => {
        const b = inside(d);
        if (!b) return null;
        return (b.rooms || []).find(r => d.x >= r.x && d.x <= r.x + r.w && d.y >= r.y && d.y <= r.y + r.h);
      };
      const res = { total: 0, wallOk: 0, wallTotal: 0, cornerOk: 0, cornerTotal: 0, chairOk: 0, chairTotal: 0, square: 0 };
      const tables = decor.filter(d => d.indoors && (d.kind === 'table' || d.kind === 'desk'));
      for (const d of decor) {
        if (!d.indoors) continue;
        res.total++;
        // square to the room: a right-angle multiple, within a degree
        const q = Math.abs(((d.rot || 0) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2));
        if (q < 0.02 || Math.PI / 2 - q < 0.02) res.square++;
        const r = roomOf(d);
        if (!r) continue;
        const m = Sprites.META[d.kind] || { r: 16 };
        const near = m.r + 14;
        const dW = d.x - r.x, dE = r.x + r.w - d.x, dN = d.y - r.y, dS = r.y + r.h - d.y;
        const touchesWall = Math.min(dW, dE, dN, dS) <= near;
        const inCorner = Math.min(dW, dE) <= near && Math.min(dN, dS) <= near;
        const how = PLACEMENT[d.kind];
        if (how === 'wall') { res.wallTotal++; if (touchesWall) res.wallOk++; }
        if (how === 'corner') { res.cornerTotal++; if (inCorner) res.cornerOk++; }
        /* A chair is placed if it is pulled up to a table or stood against a
           wall. A bedroom has a chair and no table, and that chair belongs by
           the wall — counting it as misplaced would be measuring the wrong
           thing. */
        if (how === 'byTable') {
          res.chairTotal++;
          if (tables.some(t => dist2(t.x, t.y, d.x, d.y) < 90 * 90) || touchesWall) res.chairOk++;
        }
      }
      return res;
    },
    /* Why did a required building come up short? Every candidate spot the
       generator turned down, bucketed by the reason it said no — "the map is
       full" told apart from "the terrain won't have it". */
    requiredReport: () => requiredTally,
    tidy() {
      const halls = [];
      let postsInCentre = 0;
      for (const b of buildings) {
        for (const r of b.rooms || []) {
          if (r.kind !== 'hall') continue;
          // walk the corridor and find the narrowest gap a body could pass
          let clear = Math.min(r.w, r.h);
          const along = r.w >= r.h;
          const steps = 24;
          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const cx = along ? r.x + r.w * t : r.x + r.w / 2;
            const cy = along ? r.y + r.h / 2 : r.y + r.h * t;
            // widest free span across the corridor at this point
            let span = 0, best = 0;
            const across = along ? r.h : r.w;
            for (let k = 0; k <= 20; k++) {
              const u = k / 20;
              const px = along ? cx : r.x + r.w * u;
              const py = along ? r.y + r.h * u : cy;
              if (pointInObstacle(px, py)) { span = 0; } else { span += across / 20; best = Math.max(best, span); }
            }
            clear = Math.min(clear, best);
          }
          halls.push({ building: b.name, w: Math.round(r.w), h: Math.round(r.h), clear: Math.round(clear) });
          // a post within a fifth of the corridor's centreline is in the way
          for (const o of obstacles) {
            if (o.type !== 'post' && o.type !== 'pillar') continue;
            const ox2 = o.x + o.w / 2, oy2 = o.y + o.h / 2;
            if (ox2 < r.x || ox2 > r.x + r.w || oy2 < r.y || oy2 > r.y + r.h) continue;
            const off = along ? Math.abs(oy2 - (r.y + r.h / 2)) / (r.h / 2)
              : Math.abs(ox2 - (r.x + r.w / 2)) / (r.w / 2);
            if (off < 0.35) postsInCentre++;
          }
        }
      }
      const yardProps = obstacles.filter(o => o.isProp && o.building).length;
      const looseOutdoor = obstacles.filter(o => o.isProp && !o.building).length;
      const mean = (f) => Math.round(buildings.reduce((t2, b) => t2 + f(b), 0) / Math.max(1, buildings.length));
      return {
        count: buildings.length, meanW: mean(b => b.w), meanH: mean(b => b.h),
        halls, postsInCentre, yardProps, looseOutdoor,
        prevLooseEstimate: Math.round(looseOutdoor * 120 / 78),
      };
    },
    secrets: () => obstacles.filter(o => o.secret)
      .map(o => ({ x: o.x + o.w / 2, y: o.y + o.h / 2, hides: o.hides, found: !!o.found })),
    breakALight() {
      const i = obstacles.findIndex(o => kindOf(o).lights);
      if (i < 0) return false;
      destroyStructure(obstacles[i]);
      return true;
    },
    buildingStyles: () => buildings.map(b => ({ name: b.name, style: !!b.style, floor: b.floor, roof: b.style && b.style.roof.join('') })),
    hereBuilding: () => (hereBuilding ? hereBuilding.name : null),
    wallsInBuildings() {
      const counts = buildings.map(b => obstacles.filter(o =>
        o.building === b.name && o.x >= b.x - 20 && o.x <= b.x + b.w + 20
        && o.y >= b.y - 20 && o.y <= b.y + b.h + 20).length);
      counts.sort((x, y) => x - y);
      return { total: counts.reduce((x, y) => x + y, 0), median: counts[Math.floor(counts.length / 2)] || 0 };
    },
    carryLimit: () => (player ? Classes.limitFor(player.cls, player.cls.consumable, carryTier(player), player.perk) : 0),
    soundPings: () => soundPings.length,
    // a contact somewhere off to the east, for the Portable Satellite
    enemyShot() {
      if (!player) return;
      logGunshot({ x: player.x + 600, y: player.y, team: (player.team + 1) % 4 });
    },
    // only the rounds on a timer, so a count isn't polluted by everyone else's
    fuzedBullets: () => bullets.filter(b => b.fuze).length,
    // what the water under a swimmer does to them, for the Diver perk
    swimSpeed: () => RoomSim.surfaceSpeedFor(player, { kind: 'river', speed: 0.55, swim: true }),
    // the first crate on the map that wants a perk to open
    poolCrate() {
      const i = crates.findIndex(c => c.needs && !c.opened);
      return i < 0 ? null : { i, tier: crates[i].tier, needs: crates[i].needs };
    },
    tryOpen(i) {
      const c = crates[i];
      if (!c) return false;
      openCrate(c);
      return !!c.opened;
    },
    // how many items one crate hands over — Scavenger should double it
    lootFrom() {
      let n = 0;
      const real = grantLoot;
      grantLoot = () => { n++; };
      try { openCrate({ tier: 'regular', opened: false }); } finally { grantLoot = real; }
      return n;
    },
    // the exact number the movement code is using this frame
    moveSpeed: () => (player ? RoomSim.moveSpeedFor(player, false) : 0),
    /* What the generator actually built: which buildings, and what each kind
       of room ended up holding. The loot table is a set of counts, and counts
       are only worth writing down if you can check them. */
    world() {
      const byName = {};
      for (const b of buildings) byName[b.name] = (byName[b.name] || 0) + 1;
      const byRoom = {};
      for (const c of crates) {
        if (!c.room) continue;
        (byRoom[c.room] = byRoom[c.room] || {})[c.tier] = (byRoom[c.room][c.tier] || 0) + 1;
      }
      return {
        buildings: byName, roomCrates: byRoom,
        crates: crates.length,
        neutralVehicles: agents.filter(a => a.isVehicle && a.neutral).length,
      };
    },
  };

  return {
    start, startOnline, isOnline, netDebug, debug,
    setupFor,
    TEAM_LIMITS,
    // the map, as the simulation needs to see it (see netWorld above)
    netWorld, netObjectives, netCrates, netVehicles,
  };
})();
