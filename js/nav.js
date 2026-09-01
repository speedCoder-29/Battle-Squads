/* ============================================================
   nav.js — navigation grid and pathfinding.

   Bots used to walk straight at whatever they wanted and sidestep
   when a wall stopped them, which meant they got stuck on building
   corners and never went round anything. This builds a coarse grid
   of the map, marks the cells walls sit in as blocked, and runs A*
   over it, so a bot can route around a warehouse instead of
   grinding into its side.

   The grid is deliberately coarse (one cell is a bit wider than a
   player) — it only has to be good enough to pick a way round;
   local collision still does the fine work.

   Costs are weighted so bots prefer open ground and roads over
   squeezing past cover, which also makes them look less robotic.
   ============================================================ */
const Nav = (() => {
  /* Px per cell. This was 90, which is wider than a doorway: a 62px opening
     and the wall either side of it landed in the same cell, the cell was
     marked blocked, and the route through the door did not exist. Bots could
     not find their way through a building at all — they fell back on walking
     at the target and grinding along the outside of it.

     45 is one and a half body widths, so a doorway now occupies cells of its
     own and a corridor is two cells across. The grid is four times as many
     cells, which A* handles fine at this size and the per-frame path budget
     already caps. */
  const CELL = 45;
  const DIAG = Math.SQRT2;
  /* A* node budget, so a hopeless path bails rather than hanging the frame.

     6000 was far too small and it was failing silently. The domination grid is
     165x165, and a uniform A* front that has expanded 6000 nodes is a disc
     about 44 cells across — roughly 2000px. Every goal further away than that
     ran out of budget and returned null, which is *most* of them: measured
     over a real match, 4822 of 4929 searches failed. Bots were not navigating
     badly, they were almost never navigating at all, and what looked like
     pathing behaviour was the fallback steering underneath it. */
  const MAX_STEPS = 20000;

  /* Weighted A*. A weight of 1 is the textbook admissible heuristic: it
     guarantees the shortest path and pays for that guarantee by expanding
     almost every cell that is closer to the start than the goal is. Nothing
     here needs the shortest path — it needs a sensible one, now, for fifteen
     bots at once. Overweighting the heuristic makes the search drive at the
     goal and only spread out when it hits something, which is what cuts the
     expansions by an order of magnitude on an open map.

     2.4 is high. At 1.6 the map was connected but the searches that still
     failed were expanding 28,000 nodes each and costing 10ms a run, which is
     not a budget fifteen bots can share. Overweighting further trades route
     quality for reach, and route quality is not what is being asked for here:
     nobody is grading a bot on whether it took the shortest way to B, only on
     whether it got there without walking into a wall. */
  const HEUR_W = 2.4;

  /* Why searches fail, so the next person to ask does not have to guess. */
  let stat = { runs: 0, solved: 0, noEnd: 0, exhausted: 0, steps: 0 };

  /* Half a player, plus a little. A cell counts as walkable when someone
     standing at its centre would actually fit there, so this is the distance
     every sample has to keep from a wall. */
  const PAD = 18;

  /* ---------- build ---------- */
  /* rects: everything solid. costAt(x, y): optional extra cost per cell.

     A cell used to be blocked if a wall touched it anywhere. On a map with
     1500 pieces of cover that marked three quarters of the world impassable —
     one 12px wall closed a 90px corridor, one crate closed the cell it sat in
     — and A* simply failed, which is why bots ground into buildings instead
     of walking round them.

     So a cell is blocked when a player at its *centre* would be inside
     something, and a move between two cells is blocked when the midpoint
     between them would be. Cover you can walk past no longer seals the
     corridor it stands in, and a wall still can't be walked through: padded by
     PAD, even the thinnest one covers more ground than the 45px between
     samples, so there is nowhere for it to hide. */
  function build(w, h, rects, costAt) {
    const cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL);
    const blocked = new Uint8Array(cols * rows);
    const eastWall = new Uint8Array(cols * rows);    // move to (cx+1, cy) blocked
    const southWall = new Uint8Array(cols * rows);   // move to (cx, cy+1) blocked
    const seWall = new Uint8Array(cols * rows);      // move to (cx+1, cy+1) blocked
    const neWall = new Uint8Array(cols * rows);      // move to (cx+1, cy-1) blocked
    const cost = new Float32Array(cols * rows).fill(1);

    /* the padded rects, bucketed, so a straight-line test can ask about a
       point exactly rather than about the cell it happens to land in */
    const solids = new Map();
    const bucket = (cx, cy) => {
      const k = cy * cols + cx;
      let a = solids.get(k);
      if (!a) { a = []; solids.set(k, a); }
      return a;
    };

    for (const r of rects) {
      const x0 = Math.max(0, Math.floor((r.x - PAD) / CELL) - 1);
      const x1 = Math.min(cols - 1, Math.floor((r.x + r.w + PAD) / CELL) + 1);
      const y0 = Math.max(0, Math.floor((r.y - PAD) / CELL) - 1);
      const y1 = Math.min(rows - 1, Math.floor((r.y + r.h + PAD) / CELL) + 1);
      const l = r.x - PAD, t = r.y - PAD, ri = r.x + r.w + PAD, b = r.y + r.h + PAD;
      const hits = (px, py) => px >= l && px <= ri && py >= t && py <= b;
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (hits(cx * CELL + CELL / 2, cy * CELL + CELL / 2)) blocked[cy * cols + cx] = 1;
          // only bucket cells the rect really overlaps
          if (l < (cx + 1) * CELL && ri > cx * CELL && t < (cy + 1) * CELL && b > cy * CELL) {
            bucket(cx, cy).push([l, t, ri, b]);
          }
        }
      }
    }

    /* Now the moves. A step from one cell to the next is only allowed if the
       line between their centres is clear of everything — checked once here
       rather than every time A* considers the move. */
    const grid = { cols, rows, w, h, blocked, eastWall, southWall, seWall, neWall, cost, solids };
    const shut = (i) => { eastWall[i] = southWall[i] = seWall[i] = neWall[i] = 1; };
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        if (blocked[i]) { shut(i); continue; }
        const a = centre(cx, cy);
        const to = (nx, ny) => blocked[ny * cols + nx] || !clearLine(grid, a, centre(nx, ny)) ? 1 : 0;
        if (cx < cols - 1) eastWall[i] = to(cx + 1, cy);
        if (cy < rows - 1) southWall[i] = to(cx, cy + 1);
        // the diagonals get their own test: a crate sitting exactly on a cell
        // corner blocks neither neighbour and neither way round, but a route
        // cutting the corner would still walk straight into it
        if (cx < cols - 1 && cy < rows - 1) seWall[i] = to(cx + 1, cy + 1);
        if (cx < cols - 1 && cy > 0) neWall[i] = to(cx + 1, cy - 1);
      }
    }
    if (costAt) {
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const i = cy * cols + cx;
          if (!blocked[i]) cost[i] = Math.max(0.2, costAt(cx * CELL + CELL / 2, cy * CELL + CELL / 2));
        }
      }
    }
    return grid;
  }

  const idx = (g, cx, cy) => cy * g.cols + cx;
  const inBounds = (g, cx, cy) => cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows;
  const cellOf = (x, y) => [Math.floor(x / CELL), Math.floor(y / CELL)];
  const centre = (cx, cy) => ({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });
  const isBlocked = (g, cx, cy) => !inBounds(g, cx, cy) || !!g.blocked[idx(g, cx, cy)];

  /* is there a wall between these two neighbouring cells? each edge is stored
     once, so a move west asks its western neighbour's east edge */
  function edgeBlocked(g, cx, cy, dx, dy) {
    if (!g.eastWall) return false;                       // grid built before edges existed
    if (!dy) return !!g.eastWall[idx(g, cx + (dx > 0 ? 0 : -1), cy)];
    if (!dx) return !!g.southWall[idx(g, cx, cy + (dy > 0 ? 0 : -1))];
    // diagonals: south-east and north-east, read from whichever end owns it
    if (dx > 0 && dy > 0) return !!g.seWall[idx(g, cx, cy)];
    if (dx < 0 && dy < 0) return !!g.seWall[idx(g, cx - 1, cy - 1)];
    if (dx > 0 && dy < 0) return !!g.neWall[idx(g, cx, cy)];
    return !!g.neWall[idx(g, cx - 1, cy + 1)];
  }

  /* nearest open cell, for when someone is standing in a wall */
  function nearestOpen(g, cx, cy, maxRing) {
    if (!isBlocked(g, cx, cy)) return [cx, cy];
    for (let r = 1; r <= (maxRing || 6); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;   // ring only
          const nx = cx + dx, ny = cy + dy;
          if (!isBlocked(g, nx, ny)) return [nx, ny];
        }
      }
    }
    return null;
  }

  /* ---------- A* ----------
     Returns world-space waypoints from (sx,sy) to (tx,ty), or null. */
  /* Working set for one search, kept on the grid and reused.

     Three typed arrays of 27,000 entries were being allocated *and filled with
     Infinity* on every single call — hundreds of times a second, all of it
     garbage a moment later. A generation stamp does the same job for free: a
     cell's score counts only if it was written during this run, so nothing has
     to be cleared between runs. */
  function scratch(g) {
    if (!g._gScore || g._gScore.length !== g.cols * g.rows) {
      const n = g.cols * g.rows;
      g._gScore = new Float32Array(n);
      g._fScore = new Float32Array(n);
      g._came = new Int32Array(n);
      g._seen = new Int32Array(n);
      g._gen = 0;
      g._heap = new MinHeap();
    }
    g._gen++;
    g._heap.items.length = 0; g._heap.prio.length = 0;
    return g._gen;
  }

  function findPath(g, sx, sy, tx, ty, budget) {
    if (!g) return null;
    const cap = Math.max(400, Math.min(MAX_STEPS, budget || MAX_STEPS));
    stat.runs++;
    let [scx, scy] = cellOf(sx, sy);
    let [tcx, tcy] = cellOf(tx, ty);
    const s = nearestOpen(g, scx, scy);
    const t = nearestOpen(g, tcx, tcy);
    if (!s || !t) { stat.noEnd++; return null; }
    [scx, scy] = s; [tcx, tcy] = t;
    if (scx === tcx && scy === tcy) {
      stat.solved++;
      return clearLine(g, { x: sx, y: sy }, { x: tx, y: ty }) ? [{ x: tx, y: ty }] : [centre(tcx, tcy)];
    }

    const gen = scratch(g);
    const gScore = g._gScore, fScore = g._fScore, came = g._came, seen = g._seen;
    const open = g._heap;

    const start = idx(g, scx, scy), goal = idx(g, tcx, tcy);
    const heur = (cx, cy) => {
      const dx = Math.abs(cx - tcx), dy = Math.abs(cy - tcy);
      return (dx + dy) + (DIAG - 2) * Math.min(dx, dy);      // octile
    };
    seen[start] = gen; came[start] = -1;
    gScore[start] = 0;
    fScore[start] = heur(scx, scy) * HEUR_W;
    open.push(start, fScore[start]);

    let steps = 0;
    while (open.size && steps++ < cap) {
      const cur = open.pop();
      if (cur === goal) {
        stat.solved++; stat.steps += steps; stat.lastSteps = steps;
        return rebuild(g, came, cur, tx, ty);
      }
      const cx = cur % g.cols, cy = (cur / g.cols) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (isBlocked(g, nx, ny)) continue;
          // don't cut a diagonal through a wall corner
          if (dx && dy && (isBlocked(g, cx + dx, cy) || isBlocked(g, cx, cy + dy))) continue;
          // and don't step through a wall standing between the two cells
          if (edgeBlocked(g, cx, cy, dx, dy)) continue;
          const ni = idx(g, nx, ny);
          const step = (dx && dy ? DIAG : 1) * g.cost[ni];
          const tentative = gScore[cur] + step;
          if (seen[ni] === gen && tentative >= gScore[ni]) continue;
          seen[ni] = gen;
          came[ni] = cur;
          gScore[ni] = tentative;
          fScore[ni] = tentative + heur(nx, ny) * HEUR_W;
          open.push(ni, fScore[ni]);
        }
      }
    }
    stat.exhausted++; stat.steps += steps; stat.lastSteps = steps;
    return null;
  }

  function rebuild(g, came, cur, tx, ty) {
    const cells = [];
    while (cur !== -1) { cells.push(cur); cur = came[cur]; }
    cells.reverse();
    const pts = cells.map(i => centre(i % g.cols, (i / g.cols) | 0));
    /* Finish at the real target, but only if we can actually walk the last
       stretch to it. Asking for somewhere tucked behind a wall used to append
       it regardless, and that one segment went straight through. */
    const last = pts[pts.length - 1];
    if (clearLine(g, last, { x: tx, y: ty })) pts.push({ x: tx, y: ty });
    return simplify(g, pts);
  }

  /* Drop waypoints we can walk straight past. A path of cell centres zig-zags;
     this turns it back into the few corners that actually matter. */
  function simplify(g, pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) if (clearLine(g, pts[i], pts[j])) break;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
  /* would a player standing here be inside something? exact, not per-cell */
  function pointBlocked(g, x, y) {
    if (!g.solids) return isBlocked(g, ...cellOf(x, y));
    const arr = g.solids.get(Math.floor(y / CELL) * g.cols + Math.floor(x / CELL));
    if (!arr) return false;
    for (const [l, t, r, b] of arr) if (x >= l && x <= r && y >= t && y <= b) return true;
    return false;
  }

  /* Walk the line itself rather than the cells it passes over: shortcutting a
     path is only safe if nothing is actually in the way, and a cell can be
     walkable at its centre while a wall crosses its corner. */
  function clearLine(g, a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(d / (PAD * 1.2)));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      if (pointBlocked(g, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }

  /* ---------- a small binary heap, so A* isn't O(n) per pop ---------- */
  class MinHeap {
    constructor() { this.items = []; this.prio = []; }
    get size() { return this.items.length; }
    push(item, p) {
      this.items.push(item); this.prio.push(p);
      let i = this.items.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (this.prio[parent] <= this.prio[i]) break;
        this.swap(i, parent); i = parent;
      }
    }
    pop() {
      const top = this.items[0];
      const lastItem = this.items.pop(), lastPrio = this.prio.pop();
      if (this.items.length) {
        this.items[0] = lastItem; this.prio[0] = lastPrio;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let small = i;
          if (l < this.items.length && this.prio[l] < this.prio[small]) small = l;
          if (r < this.items.length && this.prio[r] < this.prio[small]) small = r;
          if (small === i) break;
          this.swap(i, small); i = small;
        }
      }
      return top;
    }
    swap(a, b) {
      [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
      [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
    }
  }

  /* ---------- doorways ----------
     A door is genuinely a way through, and the grid has to agree.

     It did not. Measured on three maps, the nav grid came out in ~145
     disconnected pieces, every one of them a room inside a building, with 12%
     of the walkable world unreachable from where the player stood. No doorway
     was *blocked* — each one had an open cell in it — but an open cell is not
     a route. A doorway is 62px and a cell is 45px, so whether the two cells
     either side of a door can reach each other depends on where the lattice
     happens to fall relative to the jambs, and on a clear-line test between
     centres 45px apart that passes within PAD of both of them. Often enough,
     they could not, and the room behind was sealed.

     So the doorway is opened explicitly rather than left to the sampling: the
     cells across the gap are marked walkable and the moves between them are
     unblocked, in a short line running perpendicular to the wall. This is not
     a fudge — it is the grid being told a fact about the world that its
     resolution is too coarse to discover on its own. */
  function openDoorways(g, doors) {
    if (!g) return 0;
    let opened = 0;
    for (const d of doors) {
      const horizontal = d.w >= d.h;          // wall runs east-west: pass north-south
      const mx = d.x + d.w / 2, my = d.y + d.h / 2;
      const [dcx, dcy] = cellOf(mx, my);
      /* Far enough either side to stand clear of the wall's own padding: the
         jamb is PAD deep, so one cell each way is not always enough. */
      const span = 2;
      const line = [];
      for (let k = -span; k <= span; k++) {
        const cx = horizontal ? dcx : dcx + k;
        const cy = horizontal ? dcy + k : dcy;
        if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) { line.length = 0; break; }
        line.push([cx, cy]);
      }
      if (line.length < 2) continue;
      // walkable...
      for (const [cx, cy] of line) g.blocked[cy * g.cols + cx] = 0;
      // ...and connected to each other, in both directions
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, ay] = line[i];
        const ai = ay * g.cols + ax;
        if (horizontal) g.southWall[ai] = 0; else g.eastWall[ai] = 0;
      }
      opened++;
    }
    return opened;
  }

  const lastSteps = () => stat.lastSteps || 0;
  const stats = () => ({ ...stat, avgSteps: stat.runs ? Math.round(stat.steps / stat.runs) : 0 });
  const resetStats = () => { stat = { runs: 0, solved: 0, noEnd: 0, exhausted: 0, steps: 0 }; };

  return { CELL, PAD, build, findPath, cellOf, centre, isBlocked, pointBlocked, nearestOpen, clearLine, MinHeap, stats, resetStats, openDoorways, lastSteps, MAX_STEPS };
})();
