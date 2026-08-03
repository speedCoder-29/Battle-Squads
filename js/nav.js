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
  const CELL = 90;                   // px per cell — ~2 player widths
  const DIAG = Math.SQRT2;
  const MAX_STEPS = 6000;            // A* node budget, so a hopeless path bails

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
  function findPath(g, sx, sy, tx, ty) {
    if (!g) return null;
    let [scx, scy] = cellOf(sx, sy);
    let [tcx, tcy] = cellOf(tx, ty);
    const s = nearestOpen(g, scx, scy);
    const t = nearestOpen(g, tcx, tcy);
    if (!s || !t) return null;
    [scx, scy] = s; [tcx, tcy] = t;
    if (scx === tcx && scy === tcy) {
      return clearLine(g, { x: sx, y: sy }, { x: tx, y: ty }) ? [{ x: tx, y: ty }] : [centre(tcx, tcy)];
    }

    const n = g.cols * g.rows;
    const gScore = new Float32Array(n).fill(Infinity);
    const fScore = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const open = new MinHeap();

    const start = idx(g, scx, scy), goal = idx(g, tcx, tcy);
    const heur = (cx, cy) => {
      const dx = Math.abs(cx - tcx), dy = Math.abs(cy - tcy);
      return (dx + dy) + (DIAG - 2) * Math.min(dx, dy);      // octile
    };
    gScore[start] = 0;
    fScore[start] = heur(scx, scy);
    open.push(start, fScore[start]);

    let steps = 0;
    while (open.size && steps++ < MAX_STEPS) {
      const cur = open.pop();
      if (cur === goal) return rebuild(g, came, cur, tx, ty);
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
          if (tentative >= gScore[ni]) continue;
          came[ni] = cur;
          gScore[ni] = tentative;
          fScore[ni] = tentative + heur(nx, ny);
          open.push(ni, fScore[ni]);
        }
      }
    }
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

  return { CELL, PAD, build, findPath, cellOf, centre, isBlocked, pointBlocked, nearestOpen, clearLine, MinHeap };
})();
