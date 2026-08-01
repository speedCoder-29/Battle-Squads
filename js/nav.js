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

  /* ---------- build ---------- */
  /* rects: everything solid. costAt(x, y): optional extra cost per cell. */
  function build(w, h, rects, costAt) {
    const cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL);
    const blocked = new Uint8Array(cols * rows);
    const cost = new Float32Array(cols * rows).fill(1);

    for (const r of rects) {
      // pad by half a cell so bots don't clip corners they can't fit through
      const x0 = Math.max(0, Math.floor((r.x - CELL * 0.35) / CELL));
      const x1 = Math.min(cols - 1, Math.floor((r.x + r.w + CELL * 0.35) / CELL));
      const y0 = Math.max(0, Math.floor((r.y - CELL * 0.35) / CELL));
      const y1 = Math.min(rows - 1, Math.floor((r.y + r.h + CELL * 0.35) / CELL));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) blocked[cy * cols + cx] = 1;
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
    return { cols, rows, w, h, blocked, cost };
  }

  const idx = (g, cx, cy) => cy * g.cols + cx;
  const inBounds = (g, cx, cy) => cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows;
  const cellOf = (x, y) => [Math.floor(x / CELL), Math.floor(y / CELL)];
  const centre = (cx, cy) => ({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });
  const isBlocked = (g, cx, cy) => !inBounds(g, cx, cy) || !!g.blocked[idx(g, cx, cy)];

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
    if (scx === tcx && scy === tcy) return [{ x: tx, y: ty }];

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
    pts.push({ x: tx, y: ty });                 // finish at the real target
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
  function clearLine(g, a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(d / (CELL * 0.5)));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const [cx, cy] = cellOf(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      if (isBlocked(g, cx, cy)) return false;
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

  return { CELL, build, findPath, cellOf, centre, isBlocked, nearestOpen, clearLine, MinHeap };
})();
