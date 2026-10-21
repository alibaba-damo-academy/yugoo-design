// Orthogonal A* router core + incremental reroute API.
//
// Evolved from orthogonal-routing.mjs: the proven grid/A* search core moves
// here unchanged in semantics, wrapped by an incremental API the joint search
// needs — route one edge against the current routes of all others, or reroute
// only the edges a layout move disturbed, instead of always rerouting the
// whole diagram.
//
// model contract (plain geometry, no moddle):
//   { nodes: [{ id, bounds:{x,y,width,height} }],
//     edges: [{ id, sourceId, targetId, feedback }],
//     budget?: { remaining:number } }

export const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const segments = (p) => p.slice(1).map((b, i) => [p[i], b]);
export const length = (p) => segments(p).reduce((n, [a, b]) => n + distance(a, b), 0);
export const boxOverlap = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
export const hit = (a, b, r) =>
  a.y === b.y
    ? a.y > r.y + 0.01 && a.y < r.y + r.height - 0.01 &&
      Math.max(a.x, b.x) > r.x + 0.01 && Math.min(a.x, b.x) < r.x + r.width - 0.01
    : a.x > r.x + 0.01 && a.x < r.x + r.width - 0.01 &&
      Math.max(a.y, b.y) > r.y + 0.01 && Math.min(a.y, b.y) < r.y + r.height - 0.01;
function cross(a, b, c, d) {
  if ((a.y === b.y) === (c.y === d.y)) return false;
  if (a.y !== b.y) return cross(c, d, a, b);
  return (
    c.x > Math.min(a.x, b.x) + 0.01 && c.x < Math.max(a.x, b.x) - 0.01 &&
    a.y > Math.min(c.y, d.y) + 0.01 && a.y < Math.max(c.y, d.y) - 0.01
  );
}
function shared(a, b, c, d) {
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    return Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)));
  }
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    return Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)));
  }
  return 0;
}
export function simplify(p) {
  const out = [];
  for (const point of p) {
    if (out.length && distance(out.at(-1), point) < 0.01) continue;
    out.push(point);
    while (out.length > 2) {
      const [a, b, c] = out.slice(-3);
      if ((a.x === b.x && b.x === c.x || a.y === b.y && b.y === c.y) && distance(a, b) + distance(b, c) === distance(a, c)) out.splice(-2, 1);
      else break;
    }
  }
  return out;
}
class Heap {
  a = [];
  push(v) { let i = this.a.length; this.a.push(v); while (i) { const p = (i - 1) >> 1; if (this.a[p].f <= v.f) break; this.a[i] = this.a[p]; i = p; } this.a[i] = v; }
  pop() { const first = this.a[0]; const v = this.a.pop(); if (this.a.length) { let i = 0; while (i * 2 + 1 < this.a.length) { let c = i * 2 + 1; if (c + 1 < this.a.length && this.a[c + 1].f < this.a[c].f) c += 1; if (this.a[c].f >= v.f) break; this.a[i] = this.a[c]; i = c; } this.a[i] = v; } return first; }
}
export class RoutingBudgetExceeded extends Error {}

export function ports(bounds) {
  const r = bounds;
  const m = 20;
  return [
    { side: 'bottom', dock: { x: r.x + r.width / 2, y: r.y + r.height }, stub: { x: r.x + r.width / 2, y: r.y + r.height + m }, dir: 1 },
    { side: 'top', dock: { x: r.x + r.width / 2, y: r.y }, stub: { x: r.x + r.width / 2, y: r.y - m }, dir: 3 },
    { side: 'left', dock: { x: r.x, y: r.y + r.height / 2 }, stub: { x: r.x - m, y: r.y + r.height / 2 }, dir: 2 },
    { side: 'right', dock: { x: r.x + r.width, y: r.y + r.height / 2 }, stub: { x: r.x + r.width + m, y: r.y + r.height / 2 }, dir: 0 },
  ];
}

export function gridFor(model) {
  const allPorts = model.nodes.flatMap((n) => ports(n.bounds));
  const obstacles = model.nodes.map((n) => ({ ...n.bounds, x: n.bounds.x - 10, y: n.bounds.y - 10, width: n.bounds.width + 20, height: n.bounds.height + 20 }));
  const xs = [...new Set([...allPorts.map((p) => p.stub.x), ...obstacles.flatMap((r) => [r.x - 2, r.x + r.width + 2])])].sort((a, b) => a - b);
  const ys = [...new Set([...allPorts.map((p) => p.stub.y), ...obstacles.flatMap((r) => [r.y - 2, r.y + r.height + 2])])].sort((a, b) => a - b);
  if (xs.length * ys.length > 250000) throw new Error('BPMN routing grid exceeds the supported geometry budget');
  const points = ys.flatMap((y) => xs.map((x) => ({ x, y })));
  const valid = points.map((p) => !obstacles.some((r) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height));
  const adj = points.map(() => []);
  for (let i = 0; i < points.length; i += 1) {
    if (!valid[i]) continue;
    const x = i % xs.length;
    const y = Math.floor(i / xs.length);
    for (const [dx, dy, dir] of [[1, 0, 0], [0, 1, 1], [-1, 0, 2], [0, -1, 3]]) {
      if (x + dx < 0 || x + dx >= xs.length || y + dy < 0 || y + dy >= ys.length) continue;
      const j = (y + dy) * xs.length + x + dx;
      if (valid[j] && !obstacles.some((r) => hit(points[i], points[j], r))) adj[i].push({ j, dir, len: distance(points[i], points[j]) });
    }
  }
  return {
    points, adj,
    budget: model.budget || { remaining: 750000 },
    index: (p) => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x),
  };
}

export function search(grid, sp, tp, existing = [], cap = Infinity) {
  const start = grid.index(sp.stub);
  const end = grid.index(tp.stub);
  const endDir = (tp.dir + 2) % 4;
  const heap = new Heap();
  const dist = new Map();
  const prev = new Map();
  const lens = new Map();
  const cache = new Map();
  const initial = start * 4 + sp.dir;
  dist.set(initial, 0);
  lens.set(initial, 0);
  heap.push({ key: initial, f: distance(sp.stub, tp.stub), g: 0 });
  let found;
  while (heap.a.length) {
    // Graceful exhaustion: a failed search is "no route", not a crash. The
    // joint search treats null as an infeasible candidate and moves on.
    if (--grid.budget.remaining < 0) return null;
    const cur = heap.pop();
    if (dist.get(cur.key) !== cur.g) continue;
    const i = Math.floor(cur.key / 4);
    const last = cur.key % 4;
    if (i === end && last !== tp.dir) { found = cur.key; break; }
    for (const a of grid.adj[i]) {
      if (a.dir === (last + 2) % 4) continue;
      const nextLen = lens.get(cur.key) + a.len;
      if (nextLen + distance(grid.points[a.j], tp.stub) > cap) continue;
      const key = a.j * 4 + a.dir;
      const edgeKey = `${i}:${a.j}`;
      let congestion = cache.get(edgeKey);
      if (congestion === undefined) {
        const p = grid.points[i];
        const q = grid.points[a.j];
        congestion = 0;
        for (const [c, d] of existing) {
          congestion += shared(p, q, c, d) * 2;
          const horizontal = p.y === q.y;
          if (horizontal !== (c.y === d.y)) {
            const v = horizontal ? c.x : c.y;
            const lo = horizontal ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
            const hi = horizontal ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
            const fixed = horizontal ? p.y : p.x;
            const elo = horizontal ? Math.min(c.y, d.y) : Math.min(c.x, d.x);
            const ehi = horizontal ? Math.max(c.y, d.y) : Math.max(c.x, d.x);
            if (v > lo && v <= hi && fixed > elo && fixed < ehi) congestion += 64;
          }
        }
        cache.set(edgeKey, congestion);
      }
      const cost = cur.g + a.len + (last !== a.dir ? 24 : 0) + congestion + (a.j === end && a.dir !== endDir ? 24 : 0);
      if (cost >= (dist.get(key) ?? Infinity)) continue;
      dist.set(key, cost);
      lens.set(key, nextLen);
      prev.set(key, cur.key);
      heap.push({ key, g: cost, f: cost + distance(grid.points[a.j], tp.stub) });
    }
  }
  if (found === undefined) return null;
  const path = [];
  for (let k = found; k !== undefined; k = prev.get(k)) path.push(grid.points[Math.floor(k / 4)]);
  return simplify([sp.dock, ...path.reverse(), tp.dock]);
}

export function routeQuality(path, others) {
  let crossings = 0;
  let overlap = 0;
  for (const [a, b] of segments(path)) {
    for (const [c, d] of others) {
      if (cross(a, b, c, d)) crossings += 1;
      overlap += shared(a, b, c, d);
    }
  }
  return length(path) + (path.length - 2) * 24 + crossings * 64 + overlap * 2;
}

const nodeMapOf = (model) => new Map(model.nodes.map((n) => [n.id, n]));

export function routesSegments(routes, skipId) {
  const out = [];
  for (const [id, waypoints] of routes) {
    if (id === skipId) continue;
    for (const s of segments(waypoints)) out.push(s);
  }
  return out;
}

/**
 * Route one edge against the current routes of all others.
 *
 * Two phases, exactly as the proven per-edge strategy:
 *  1. Baseline: congestion-free searches over every LEGAL port pair establish
 *     the obstacle-only detour cap (min length * 1.5 + 40). Port legality
 *     encodes flow direction (forward edges leave bottom/sides and enter
 *     top/sides; upward edges the reverse), self-loop sides, and rejects
 *     docks whose stub segment would cut through a shape (boundary hosts).
 *  2. Refinement: the three shortest baselines are re-searched WITH the
 *     current routes as congestion, under cap - 40, so avoiding a crossing
 *     can never buy an arbitrarily long detour.
 * The best candidate by congestion-aware quality wins; the caller decides
 * acceptance (local quality in rerouteSet, global cost in routeDescent).
 */
// ---- straight-channel probe and notch absorption -------------------------
// Readers read a zero-bend straight wire as "obvious"; any bend where a clear
// straight channel exists is noise. When source and target spans overlap on
// the flow axis and the channel between them is free of shapes AND free of
// congestion (no crossing, no shared run with an existing route), the straight
// dock-to-dock segment is the only acceptable route. Sliding the dock along
// the entry side (instead of insisting on side centers) is what makes most
// near-miss pairs straightenable.
const DOCK_INSET = 8;

function channelClear(model, edge, a, b) {
  return !model.nodes.some(
    (n) => n.id !== edge.sourceId && n.id !== edge.targetId && hit(a, b, n.bounds),
  );
}
function congestionFree(a, b, others) {
  for (const [c, d] of others) {
    if (cross(a, b, c, d)) return false;
    if (shared(a, b, c, d) > 0.01) return false;
  }
  return true;
}

function straightProbe(model, edge, others) {
  const nodeById = nodeMapOf(model);
  const s = nodeById.get(edge.sourceId);
  const t = nodeById.get(edge.targetId);
  if (!s || !t || s === t) return null;
  const sb = s.bounds;
  const tb = t.bounds;
  const inside = (v, span) => v >= span[0] && v <= span[1];
  let a = null;
  let b = null;
  if (tb.y > sb.y || tb.y + tb.height < sb.y) {
    const forward = tb.y > sb.y;
    const sy = forward ? sb.y + sb.height : sb.y;
    const ty = forward ? tb.y : tb.y + tb.height;
    const sSpan = [sb.x + DOCK_INSET, sb.x + sb.width - DOCK_INSET];
    const tSpan = [tb.x + DOCK_INSET, tb.x + tb.width - DOCK_INSET];
    const cxS = sb.x + sb.width / 2;
    const cxT = tb.x + tb.width / 2;
    let x = null;
    if (inside(cxS, tSpan)) x = cxS;
    else if (inside(cxT, sSpan)) x = cxT;
    if (x !== null) {
      a = { x, y: sy };
      b = { x, y: ty };
    }
  } else if (tb.x > sb.x || tb.x + tb.width < sb.x) {
    const rightward = tb.x > sb.x;
    const sx = rightward ? sb.x + sb.width : sb.x;
    const tx = rightward ? tb.x : tb.x + tb.width;
    const sSpan = [sb.y + DOCK_INSET, sb.y + sb.height - DOCK_INSET];
    const tSpan = [tb.y + DOCK_INSET, tb.y + tb.height - DOCK_INSET];
    const cyS = sb.y + sb.height / 2;
    const cyT = tb.y + tb.height / 2;
    let y = null;
    if (inside(cyS, tSpan)) y = cyS;
    else if (inside(cyT, sSpan)) y = cyT;
    if (y !== null) {
      a = { x: sx, y };
      b = { x: tx, y };
    }
  }
  if (!a || !b) return null;
  if (!channelClear(model, edge, a, b)) return null;
  if (!congestionFree(a, b, others)) return null;
  return [a, b];
}

// A* on a coarse grid leaves staircase notches: a few-px run between two
// collinear-direction segments. Collapse any short interior run by moving the
// pair of corners onto one of the neighbouring axes, keeping orthogonality
// and re-checking shape clearance.
const NOTCH_PX = 10;
function absorbNotches(model, edge, path) {
  let out = path.map((point) => ({ ...point }));
  for (let guard = 0; guard < 8; guard += 1) {
    let changed = false;
    for (let i = 1; i + 2 < out.length; i += 1) {
      if (distance(out[i], out[i + 1]) >= NOTCH_PX) continue;
      const p0 = out[i - 1];
      const p3 = out[i + 2];
      for (const q of [{ x: p0.x, y: p3.y }, { x: p3.x, y: p0.y }]) {
        if (distance(p0, q) < 0.01 || distance(q, p3) < 0.01) continue;
        if (p0.x === q.x && q.x === p3.x) continue; // already collinear
        if (p0.y === q.y && q.y === p3.y) continue;
        if (!channelClear(model, edge, p0, q) || !channelClear(model, edge, q, p3)) continue;
        out = [...out.slice(0, i), q, ...out.slice(i + 2)];
        changed = true;
        break;
      }
      if (changed) break;
    }
    out = simplify(out);
    if (!changed) break;
  }
  return out;
}

const baselineCache = new WeakMap(); // grid -> Map(edgeId -> { baselines, cap })

/**
 * Congestion-free baseline routes for one edge on one grid. They depend only
 * on geometry, so every later call (descent passes, search candidates) reuses
 * them instead of paying up to 16 extra A* searches per invocation.
 */
function baselinesFor(model, grid, edge) {
  let perGrid = baselineCache.get(grid);
  if (!perGrid) {
    perGrid = new Map();
    baselineCache.set(grid, perGrid);
  }
  const cached = perGrid.get(edge.id);
  if (cached) return cached;
  const nodeById = nodeMapOf(model);
  const s = nodeById.get(edge.sourceId);
  const t = nodeById.get(edge.targetId);
  if (!s || !t) return null;
  const forward = t.bounds.y > s.bounds.y;
  const pairs = [];
  for (const sp of ports(s.bounds)) {
    for (const tp of ports(t.bounds)) {
      if (s === t && sp.side === tp.side) continue;
      if (forward && (sp.side === 'top' || tp.side === 'bottom')) continue;
      if (!forward && (sp.side === 'bottom' || tp.side === 'top')) continue;
      // A legal grid path is insufficient if its docking stubs cross a shape
      // (notably a boundary event's attached activity). Reject those ports.
      if (model.nodes.some((n) => hit(sp.dock, sp.stub, n.bounds) || hit(tp.stub, tp.dock, n.bounds))) continue;
      pairs.push({ sp, tp, estimate: distance(sp.stub, tp.stub) });
    }
  }
  pairs.sort((a, b) => a.estimate - b.estimate);
  const baselines = [];
  for (const pair of pairs.slice(0, 16)) {
    const path = search(grid, pair.sp, pair.tp);
    if (path) baselines.push({ ...pair, path });
  }
  if (baselines.length === 0) {
    perGrid.set(edge.id, null);
    return null;
  }
  baselines.sort((a, b) => routeQuality(a.path, []) - routeQuality(b.path, []) || length(a.path) - length(b.path));
  const cap = Math.min(...baselines.map((b) => length(b.path))) * 1.5 + 40;
  const entry = { baselines, cap };
  perGrid.set(edge.id, entry);
  return entry;
}

export function routeEdge(model, grid, edge, routes, pairLimit = 4) {
  // A spent budget means the router is fully dead, probe included: the probe
  // is routing work too, and "budget exhausted seeds nothing" is the contract
  // the partial-diagram guard (layout exit 6) relies on.
  if ((grid.budget ? grid.budget.remaining : 1) <= 0) return null;
  const others = routesSegments(routes, edge.id);
  const probe = straightProbe(model, edge, others);
  if (probe) return probe; // unobstructed straight channel: zero bends wins
  const entry = baselinesFor(model, grid, edge);
  if (!entry) return null;
  const { baselines, cap } = entry;
  const candidates = baselines.map((b) => b.path);
  for (const pair of baselines.slice(0, 3)) {
    const path = search(grid, pair.sp, pair.tp, others, cap - 40);
    if (path && length(path) <= cap) candidates.push(path);
  }
  candidates.sort((a, b) => routeQuality(a, others) - routeQuality(b, others) || length(a) - length(b));
  const withinCap = candidates.filter((p) => length(p) <= cap);
  const chosen = withinCap[0] || candidates[0] || null;
  return chosen ? absorbNotches(model, edge, chosen) : null;
}

/**
 * The proven baseline: route every edge congestion-free and pick the best
 * obstacle-only path, exactly like the legacy seeding pass. Congestion is
 * resolved afterwards by descent, not baked into the seed.
 */
export function seedRoutes(model, grid, routes) {
  const order = [...model.edges].sort((a, b) => Number(b.feedback || false) - Number(a.feedback || false)
    || (model.nodes.find((n) => n.id === a.sourceId)?.bounds.y || 0) - (model.nodes.find((n) => n.id === b.sourceId)?.bounds.y || 0)
    || a.id.localeCompare(b.id));
  const dead = (grid.budget ? grid.budget.remaining : 1) <= 0;
  for (const edge of order) {
    if (dead) break;
    const probe = straightProbe(model, edge, routesSegments(routes, edge.id));
    if (probe) {
      routes.set(edge.id, probe);
      continue;
    }
    const entry = baselinesFor(model, grid, edge);
    if (!entry) continue;
    const { baselines, cap } = entry;
    const pick = baselines.map((b) => b.path).find((p) => length(p) <= cap);
    if (pick) routes.set(edge.id, absorbNotches(model, edge, pick));
  }
  return routes;
}
