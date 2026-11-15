// Pure-geometry diagram cost function for the flow_design auto-layout search.
//
// First-principles role: this module is the single measurable objective C(S)
// over a joint layout+routing state S = (node positions, lane geometry, edge
// routes). The iterative search accepts a proposed move iff C strictly
// decreases; nothing else arbitrates quality. Every term is computable from
// geometry alone, unit-testable, and doubles as a regression metric so
// improvements are measured instead of eyeballed.
//
// Term ↔ observed defect correspondence (from rendered diagrams):
//   nodeOverlap    hard constraint: an edge segment must never cut a node box
//   crossing       two edges crossing each other (or one edge crossing itself)
//   collinear      two edges running exactly on top of each other
//   parallel       two unrelated edges running near-parallel (visual bundling
//                  clutter that exact-overlap alone cannot see)
//   laneExtra      horizontal runs crossing lane dividers more often than the
//                  source→target lane distance requires (gratuitous jogs)
//   length         total wire length (compactness)
//   bend           every direction change (bpmn.io renders each as a corner)
//   extraBend      bends beyond the topological minimum for the edge class —
//                  the "unnecessary complex routing" seen in P-001/P-002
//   spacing        row gaps deviating from the target band — the uneven
//                  136px..272px vertical rhythm seen in P-001/P-002
//   spine          chain members drifting off a common x-center — the
//                  "nodes not stacked in a column" unnaturalness
//   row            same-rank nodes drifting off a common y-center — the
//                  diagonal staggering readers read as accidental
//   exterior       wire running outside the pool — loopback detours escaping
//                  the lane gutters
//   size           pool height/width — guards against runaway tall diagrams
//
// No term encodes a product decision; all are presentation-quality geometry.

export const WEIGHTS = {
  nodeOverlap: 10000,   // per violating segment/node pair
  nodeOverlapPx: 100,   // plus per px of penetration
  crossing: 64,         // per crossing pair
  collinear: 2,         // per px of shared run
  parallel: 1,          // per px of near-parallel run, scaled by closeness
  laneExtra: 32,        // per divider crossing beyond the required count
  length: 1,            // per px of wire
  bend: 24,             // per direction change
  extraBend: 40,        // per bend beyond the class minimum
  spacing: 2,           // per px of row-gap deviation from the target band
  spine: 6,             // per px of x-center deviation along a same-lane chain
                        // (single same-lane child) or of a fork's same-lane
                        // children group center vs the fork x-center
  row: 4,               // per px of y-center deviation within a topological rank
  rowCross: 2,          // per px of y-center deviation among fork siblings
                        // spread across lanes (one shared step, one row)
  lattice: 5,           // per px of x-center deviation from the node's lane
                        // column (columns = cx clusters inside one lane)
  laneFit: 8,           // per px a node crosses its lane's inner margin
                        // (16px breathing room each side of the lane)
  sideGap: 12,          // per px a side-by-side same-row pair falls short
                        // of a 32px horizontal gap — touching boxes read as
                        // a hard defect, priced above any crossing saving
  exterior: 3,          // per px of wire outside the pool (forward edges)
  exteriorFeedback: 0.5,// per px outside the pool (feedback edges: channels)
  height: 0.2,          // per px of pool height
  width: 0.05,          // per px of pool width
};

/**
 * Lane column lattice: cluster a lane's x-centers into columns (gap > 48px
 * starts a new column), then merge single-member columns into the nearest
 * column UNLESS the lone node is a true parallel sibling of a node in that
 * column — same row AND a shared forward source or forward target (the
 * fork/join signature). Side-by-side placement is a privilege of parallel
 * siblings; a sequential or feedback-only node sharing a row by accident is
 * a drifted node and owns the lane's column like everybody else. Shared by
 * the cost term and the snapColumn/rehome moves so both see one lattice.
 */
export function laneColumns(nodes, edges, cx, cy, ranks, lanes) {
  const COLUMN_GAP = 48;
  const ROW_BAND = 24;
  const laneById = new Map((lanes || []).map((l) => [l.id, l]));
  const fwdOut = new Map();
  const fwdIn = new Map();
  for (const e of edges) {
    if (e.feedback || e.sourceId === e.targetId) continue;
    if (!fwdOut.has(e.sourceId)) fwdOut.set(e.sourceId, []);
    if (!fwdIn.has(e.targetId)) fwdIn.set(e.targetId, []);
    fwdOut.get(e.sourceId).push(e.targetId);
    fwdIn.get(e.targetId).push(e.sourceId);
  }
  const byLane = new Map();
  for (const n of nodes) {
    const key = n.laneId || '';
    if (!byLane.has(key)) byLane.set(key, []);
    byLane.get(key).push(n);
  }
  const out = new Map();
  for (const [lane, group] of byLane) {
    if (group.length < 3) continue;
    const sorted = [...group].sort((a, b) => cx(a) - cx(b));
    const columns = [];
    for (const n of sorted) {
      const last = columns.at(-1);
      if (last && cx(n) - last.max <= COLUMN_GAP) {
        last.max = cx(n);
        last.members.push(n);
      } else {
        columns.push({ max: cx(n), members: [n] });
      }
    }
    const centerOf = (col) => {
      const centers = col.members.map(cx).sort((a, b) => a - b);
      return centers[Math.floor(centers.length / 2)];
    };
    const merged = [];
    for (const col of columns) {
      if (col.members.length > 1) {
        merged.push(col);
        continue;
      }
      const lone = col.members[0];
      const nearest = merged
        .filter((c) => c.members.length > 1 || c !== col)
        .sort((a, b) => Math.abs(centerOf(a) - cx(lone)) - Math.abs(centerOf(b) - cx(lone)))[0];
      let parallelSibling = false;
      if (nearest) {
        for (const m of nearest.members) {
          if (Math.abs(cy(m) - cy(lone)) > ROW_BAND) continue;
          const outs = fwdOut.get(lone.id) || [];
          const ins = fwdIn.get(lone.id) || [];
          const mOuts = fwdOut.get(m.id) || [];
          const mIns = fwdIn.get(m.id) || [];
          if (outs.some((t) => t === m.id) || ins.some((t) => t === m.id)) continue;
          const forkSignature =
            outs.some((t) => mOuts.includes(t)) || ins.some((t) => mIns.includes(t));
          // A same-lane same-rank row collision is the other legitimate
          // reason two nodes sit side by side — but only when the lane is
          // wide enough to hold both with a 32px gap and 16px margins. If it
          // is not, side-by-side is a squeeze, not a layout: the node owns
          // the lane column and takes its own row instead.
          const lane = laneById.get(lone.laneId || '');
          const feasible = !!lane &&
            lone.bounds.width + m.bounds.width + 32 <= lane.bounds.width - 32;
          if (forkSignature && feasible) {
            parallelSibling = true;
            break;
          }
        }
      }
      if (parallelSibling) merged.push(col);
      else if (nearest) nearest.members.push(lone);
      else merged.push(col);
    }
    out.set(lane, merged);
  }
  return out;
}

/**
 * Visual sibling groups: nodes sharing a common forward source (fork
 * children) or a common forward target (join parents). These are the only
 * node sets a reader expects on one shared row.
 */
export function siblingGroups(nodes, edges) {
  const bySource = new Map();
  const byTarget = new Map();
  for (const e of edges) {
    if (e.feedback || e.sourceId === e.targetId) continue;
    if (!bySource.has(e.sourceId)) bySource.set(e.sourceId, []);
    if (!byTarget.has(e.targetId)) byTarget.set(e.targetId, []);
    bySource.get(e.sourceId).push(e.targetId);
    byTarget.get(e.targetId).push(e.sourceId);
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const groups = [];
  // Join parents (common direct target): converging siblings end one step
  // together — same row, side by side when in one lane.
  for (const ids of byTarget.values()) {
    if (ids.length >= 2) groups.push(ids.map((id) => nodeById.get(id)).filter(Boolean));
  }
  // Diamond fork children (common source AND common direct target): the
  // parallel alternatives of one decision, drawn side by side on one row.
  // Plain same-lane fork children are stacked branch chains: NO row rule.
  for (const [src, childIds] of bySource) {
    if (childIds.length < 2) continue;
    // children that all feed one common target (fork-join diamond)
    const feedCount = new Map();
    for (const cid of childIds) {
      for (const t of (bySource.get(cid) || [])) feedCount.set(t, (feedCount.get(t) || 0) + 1);
    }
    const commonTarget = [...feedCount.entries()].find(([, c]) => c >= 2);
    if (commonTarget) {
      groups.push(childIds.map((id) => nodeById.get(id)).filter(Boolean));
    }
  }
  return groups;
}

export const SPACING_BAND = { min: 40, max: 96 };
export const PARALLEL_MARGIN = 12;

const EPS = 0.01;
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export function segmentsOf(waypoints) {
  const out = [];
  for (let i = 1; i < waypoints.length; i += 1) out.push([waypoints[i - 1], waypoints[i]]);
  return out;
}
export function lengthOf(waypoints) {
  return segmentsOf(waypoints).reduce((n, [a, b]) => n + dist(a, b), 0);
}

// Orthogonal-segment predicates (same conventions as the prior router:
// crossings are open-interval, shared runs are closed-overlap length).
function cross(a, b, c, d) {
  if ((a.y === b.y) === (c.y === d.y)) return false;
  if (a.y !== b.y) return cross(c, d, a, b);
  return (
    c.x > Math.min(a.x, b.x) + EPS &&
    c.x < Math.max(a.x, b.x) - EPS &&
    a.y > Math.min(c.y, d.y) + EPS &&
    a.y < Math.max(c.y, d.y) - EPS
  );
}
function shared(a, b, c, d) {
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    return Math.max(
      0,
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)),
    );
  }
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    return Math.max(
      0,
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)),
    );
  }
  return 0;
}
// Penetration length of an orthogonal segment through an axis-aligned rect.
function segmentRectOverlap(a, b, r) {
  if (a.y === b.y) {
    if (a.y <= r.y + EPS || a.y >= r.y + r.height - EPS) return 0;
    return Math.max(0, Math.min(Math.max(a.x, b.x), r.x + r.width) - Math.max(Math.min(a.x, b.x), r.x));
  }
  if (a.x === b.x) {
    if (a.x <= r.x + EPS || a.x >= r.x + r.width - EPS) return 0;
    return Math.max(0, Math.min(Math.max(a.y, b.y), r.y + r.height) - Math.max(Math.min(a.y, b.y), r.y));
  }
  return 0;
}
// Portion of an orthogonal segment lying outside a rect (exterior wire).
function segmentExterior(a, b, r) {
  const total = dist(a, b);
  if (total <= EPS) return 0;
  if (a.y === b.y) {
    if (a.y <= r.y || a.y >= r.y + r.height) return total;
    const inside = Math.max(0, Math.min(Math.max(a.x, b.x), r.x + r.width) - Math.max(Math.min(a.x, b.x), r.x));
    return Math.max(0, total - inside);
  }
  if (a.x === b.x) {
    if (a.x <= r.x || a.x >= r.x + r.width) return total;
    const inside = Math.max(0, Math.min(Math.max(a.y, b.y), r.y + r.height) - Math.max(Math.min(a.y, b.y), r.y));
    return Math.max(0, total - inside);
  }
  return 0;
}

/** Count segment/node penetrations of one route, ignoring its endpoints. */
export function routePenetration(waypoints, nodes, skipIds) {
  let count = 0;
  for (const [a, b] of segmentsOf(waypoints)) {
    for (const node of nodes) {
      if (skipIds.has(node.id)) continue;
      if (segmentRectOverlap(a, b, node.bounds) > EPS) count += 1;
    }
  }
  return count;
}

/**
 * Longest-path ranks over the forward (non-feedback) edges. Feedback edges
 * are loopbacks by definition, so the forward subgraph is acyclic; anything
 * left over after Kahn's algorithm (defensive) keeps rank -1 and is ignored.
 * Shared by the cost terms and the snap moves so both measure the same rows.
 */
export function forwardRanks(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (e.feedback || e.sourceId === e.targetId) continue;
    if (!indeg.has(e.sourceId) || !indeg.has(e.targetId)) continue;
    indeg.set(e.targetId, indeg.get(e.targetId) + 1);
    adj.get(e.sourceId).push(e.targetId);
  }
  const rank = new Map(ids.map((id) => [id, 0]));
  let queue = ids.filter((id) => indeg.get(id) === 0).sort();
  const seen = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    for (const next of adj.get(id).sort()) {
      rank.set(next, Math.max(rank.get(next), rank.get(id) + 1));
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0 && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  for (const id of ids) if (!seen.has(id)) rank.set(id, -1);
  return rank;
}

function minBendsFor(edge, src, tgt, laneById) {
  const scx = src.x + src.width / 2;
  const scy = src.y + src.height / 2;
  const tcx = tgt.x + tgt.width / 2;
  const tcy = tgt.y + tgt.height / 2;
  // Straight shot: aligned centers dock side-to-side or top-to-bottom.
  if (Math.abs(scy - tcy) <= 2 || Math.abs(scx - tcx) <= 2) return 0;
  if (edge.feedback) return laneById.get(edge.sourceId) === laneById.get(edge.targetId) ? 2 : 3;
  return 2;
}

/**
 * Evaluate C(S) for a laid-out diagram.
 *
 * model = {
 *   nodes: [{ id, type?, laneId, bounds: {x,y,width,height} }],
 *   edges: [{ id, sourceId, targetId, feedback, waypoints: [{x,y},...] }],
 *   lanes: [{ id, index, bounds: {x,y,width,height} }],
 * }
 * Returns { total, terms, counts } with one entry per cost term.
 */
export function diagramCost(model, weights = WEIGHTS) {
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const laneById = new Map(model.nodes.map((n) => [n.id, n.laneId]));
  const terms = {
    nodeOverlap: 0, crossing: 0, collinear: 0, parallel: 0, laneExtra: 0,
    length: 0, bend: 0, extraBend: 0, spacing: 0, exterior: 0, size: 0,
    spine: 0, row: 0, rowCross: 0, lattice: 0, laneFit: 0, sideGap: 0,
  };
  const counts = {
    nodeOverlap: 0, crossing: 0, parallel: 0, laneExtra: 0,
    bend: 0, extraBend: 0, spacing: 0, spine: 0, row: 0, rowCross: 0,
    lattice: 0, laneFit: 0, sideGap: 0,
  };

  // ---- flatten segments -------------------------------------------------
  const segs = []; // {edge, i, a, b, horizontal}
  for (const edge of model.edges) {
    const list = segmentsOf(edge.waypoints);
    terms.length += list.reduce((n, [a, b]) => n + dist(a, b), 0);
    const bends = Math.max(0, edge.waypoints.length - 2);
    terms.bend += bends * weights.bend;
    counts.bend += bends;
    const src = nodeById.get(edge.sourceId);
    const tgt = nodeById.get(edge.targetId);
    if (src && tgt) {
      const extra = Math.max(0, bends - minBendsFor(edge, src.bounds, tgt.bounds, laneById));
      terms.extraBend += extra * weights.extraBend;
      counts.extraBend += extra;
    }
    list.forEach(([a, b], i) => segs.push({ edge, i, a, b, horizontal: a.y === b.y }));
  }

  // ---- edge vs node penetration (hard constraint) ------------------------
  for (const s of segs) {
    for (const node of model.nodes) {
      if (node.id === s.edge.sourceId || node.id === s.edge.targetId) continue;
      const pen = segmentRectOverlap(s.a, s.b, node.bounds);
      if (pen > EPS) {
        terms.nodeOverlap += weights.nodeOverlap + pen * weights.nodeOverlapPx;
        counts.nodeOverlap += 1;
      }
    }
  }

  // ---- segment pairs: crossings, collinear runs, near-parallel runs ------
  const sharesNode = (e1, e2) =>
    e1.sourceId === e2.sourceId || e1.sourceId === e2.targetId ||
    e2.sourceId === e1.targetId || e1.targetId === e2.targetId;
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const p = segs[i];
      const q = segs[j];
      const sameEdge = p.edge.id === q.edge.id;
      if (sameEdge && Math.abs(p.i - q.i) === 1) continue; // adjacent segments meet at a dock
      if (cross(p.a, p.b, q.a, q.b)) {
        terms.crossing += weights.crossing;
        counts.crossing += 1;
      }
      if (!sameEdge) {
        const run = shared(p.a, p.b, q.a, q.b);
        if (run > EPS) terms.collinear += run * weights.collinear;
        if (!sharesNode(p.edge, q.edge) && p.horizontal === q.horizontal) {
          if (p.horizontal) {
            const d = Math.abs(p.a.y - q.a.y);
            if (d > EPS && d < PARALLEL_MARGIN) {
              const runP = Math.max(0,
                Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x)) -
                Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x)));
              if (runP > 1) {
                terms.parallel += (1 - d / PARALLEL_MARGIN) * runP * weights.parallel;
                counts.parallel += 1;
              }
            }
          } else {
            const d = Math.abs(p.a.x - q.a.x);
            if (d > EPS && d < PARALLEL_MARGIN) {
              const runP = Math.max(0,
                Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y)) -
                Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y)));
              if (runP > 1) {
                terms.parallel += (1 - d / PARALLEL_MARGIN) * runP * weights.parallel;
                counts.parallel += 1;
              }
            }
          }
        }
      }
    }
  }

  // ---- lane divider crossings beyond topological necessity ---------------
  const lanes = [...model.lanes].sort((a, b) => a.index - b.index);
  const laneIndexById = new Map(lanes.map((l) => [l.id, l.index]));
  const gaps = [];
  for (let i = 1; i < lanes.length; i += 1) {
    const prev = lanes[i - 1].bounds;
    const cur = lanes[i].bounds;
    gaps.push({ lo: prev.x + prev.width, hi: cur.x });
  }
  if (gaps.length > 0) {
    for (const edge of model.edges) {
      let occurrences = 0;
      for (const s of segs) {
        if (s.edge.id !== edge.id || !s.horizontal) continue;
        const xlo = Math.min(s.a.x, s.b.x);
        const xhi = Math.max(s.a.x, s.b.x);
        for (const gap of gaps) {
          if (gap.hi - gap.lo <= 0) continue;
          if (xlo < gap.hi - EPS && xhi > gap.lo + EPS) occurrences += 1;
        }
      }
      const srcLane = laneIndexById.get(laneById.get(edge.sourceId));
      const tgtLane = laneIndexById.get(laneById.get(edge.targetId));
      const required = srcLane === undefined || tgtLane === undefined
        ? 0 : Math.abs(srcLane - tgtLane);
      const extra = Math.max(0, occurrences - required);
      if (extra > 0) {
        terms.laneExtra += extra * weights.laneExtra;
        counts.laneExtra += extra;
      }
    }
  }

  // ---- exterior wire + pool size ------------------------------------------
  if (lanes.length > 0) {
    const pool = {
      x: Math.min(...lanes.map((l) => l.bounds.x)),
      y: Math.min(...lanes.map((l) => l.bounds.y)),
    };
    pool.width = Math.max(...lanes.map((l) => l.bounds.x + l.bounds.width)) - pool.x;
    pool.height = Math.max(...lanes.map((l) => l.bounds.y + l.bounds.height)) - pool.y;
    for (const s of segs) {
      const ext = segmentExterior(s.a, s.b, pool);
      if (ext > EPS) {
        terms.exterior += ext * (s.edge.feedback ? weights.exteriorFeedback : weights.exterior);
      }
    }
    terms.size = pool.height * weights.height + pool.width * weights.width;
  }

  // ---- per-lane row spacing rhythm ----------------------------------------
  for (const lane of lanes) {
    const laneNodes = model.nodes.filter((n) => n.laneId === lane.id);
    const rows = new Map();
    for (const n of laneNodes) {
      const key = Math.round(n.bounds.y);
      const row = rows.get(key) || { y: n.bounds.y, bottom: 0 };
      row.bottom = Math.max(row.bottom, n.bounds.y + n.bounds.height);
      rows.set(key, row);
    }
    const sorted = [...rows.values()].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i].y - sorted[i - 1].bottom;
      const dev = Math.max(0, SPACING_BAND.min - gap) + Math.max(0, gap - SPACING_BAND.max);
      if (dev > EPS) {
        terms.spacing += dev * weights.spacing;
        counts.spacing += 1;
      }
    }
  }

  // ---- structural regularity: spine columns and rank rows ----------------
  // Readers expect a causal chain inside one lane to fall on a single
  // vertical spine and same-rank nodes to share a horizontal row. Chain
  // edges exclude forks/joins (degree > 1): parallel siblings must stay
  // side-by-side, and forcing them onto one x would only create overlaps.
  const cx = (n) => n.bounds.x + n.bounds.width / 2;
  const cy = (n) => n.bounds.y + n.bounds.height / 2;
  const chainEdges = model.edges.filter((e) =>
    !e.feedback && e.sourceId !== e.targetId &&
    laneById.get(e.sourceId) === laneById.get(e.targetId) &&
    nodeById.get(e.sourceId) && nodeById.get(e.targetId));
  const chainOut = new Map();
  const chainIn = new Map();
  const childrenBySource = new Map();
  for (const e of chainEdges) {
    chainOut.set(e.sourceId, (chainOut.get(e.sourceId) || 0) + 1);
    chainIn.set(e.targetId, (chainIn.get(e.targetId) || 0) + 1);
    if (!childrenBySource.has(e.sourceId)) childrenBySource.set(e.sourceId, []);
    childrenBySource.get(e.sourceId).push(e);
  }
  // Column discipline, three cases, each matching what a reader expects:
  //  - a node with exactly one same-lane child continues the column: the
  //    child's x-center must equal the parent's (the classical spine);
  //  - a fork whose same-lane children sit side by side keeps the group
  //    centered under the fork (symmetry), never drifting to one side;
  //  - join targets stay unconstrained: a Z into a join is the human pattern.
  for (const [sourceId, children] of childrenBySource) {
    const src = nodeById.get(sourceId);
    if (children.length === 1) {
      const e = children[0];
      if ((chainIn.get(e.targetId) || 0) !== 1) continue;
      const dev = Math.abs(cx(src) - cx(nodeById.get(e.targetId)));
      if (dev > EPS) {
        terms.spine += dev * weights.spine;
        counts.spine += 1;
      }
    } else {
      const mean = children.reduce((n, e) => n + cx(nodeById.get(e.targetId)), 0) / children.length;
      const dev = Math.abs(mean - cx(src));
      if (dev > EPS) {
        terms.spine += dev * weights.spine;
        counts.spine += 1;
      }
    }
  }
  // Fork siblings spread across lanes are one shared step: readers expect
  // them on one row. Groups are fork arity (small), unlike rank groups, so
  // this cannot resurrect the cross-lane over-penalization of chains.
  for (const [, children] of childrenBySource) {
    const lanes = new Set(children.map((e) => nodeById.get(e.targetId).laneId));
    if (lanes.size < 2) continue;
    const targets = children.map((e) => nodeById.get(e.targetId));
    const centers = targets.map(cy).sort((a, b) => a - b);
    const median = centers[Math.floor(centers.length / 2)];
    for (const t of targets) {
      const dev = Math.abs(cy(t) - median);
      if (dev > EPS) {
        terms.rowCross += dev * weights.rowCross;
        counts.rowCross += 1;
      }
    }
  }
  // Rows are judged among VISUAL siblings only: nodes forking from a common
  // source or converging into a common target are one shared step and sit on
  // one row (per lane). Topological rank is not a visual relation — two nodes
  // that merely share a rank owe each other nothing, and rank rows locked
  // feedback/annotation nodes into rows they could not share without
  // overlapping their own column.
  const rowRanks = forwardRanks(model.nodes, model.edges);
  for (const raw of siblingGroups(model.nodes, model.edges)) {
    // Parallel siblings share a forward rank; a skip-edge parent of a join
    // is an ancestor, not a sibling — split groups by rank so those drop out.
    const byRankSib = new Map();
    for (const n of raw) {
      const r = rowRanks.get(n.id);
      const key = r === undefined ? -1 : r;
      if (!byRankSib.has(key)) byRankSib.set(key, []);
      byRankSib.get(key).push(n);
    }
    for (const group of byRankSib.values()) {
    const byLaneSib = new Map();
    for (const n of group) {
      const key = n.laneId || '';
      if (!byLaneSib.has(key)) byLaneSib.set(key, []);
      byLaneSib.get(key).push(n);
    }
    for (const members of byLaneSib.values()) {
      if (members.length < 2) continue;
      const centers = members.map(cy).sort((a, b) => a - b);
      const median = centers[Math.floor(centers.length / 2)];
      for (const n of members) {
        const dev = Math.abs(cy(n) - median);
        if (dev > EPS) {
          terms.row += dev * weights.row;
          counts.row += 1;
        }
      }
    }
    }
  }

  // ---- lane column lattice ------------------------------------------------
  // Readers hold a mental grid: each lane has a few columns and every node
  // sits on one of them. Cluster the x-centers of a lane's nodes (gap > 48px
  // starts a new column) and penalize deviation from the owning column
  // center. This covers the cases chain-spine deliberately exempts (feeds
  // into joins, single children of forks) because column membership is a
  // property of the lane, not of edge degrees.
  const columnsByLane = laneColumns(
    model.nodes, model.edges, cx, cy, forwardRanks(model.nodes, model.edges), model.lanes,
  );
  for (const columns of columnsByLane.values()) {
    for (const col of columns) {
      const centers = col.members.map(cx).sort((a, b) => a - b);
      const center = centers[Math.floor(centers.length / 2)];
      for (const n of col.members) {
        const dev = Math.abs(cx(n) - center);
        if (dev > EPS) {
          terms.lattice += dev * weights.lattice;
          counts.lattice += 1;
        }
      }
    }
  }

  // ---- lane fit and side-by-side gap --------------------------------------
  // A node belongs to its lane visually: crossing the lane's inner margin
  // (16px) reads as "wrong lane". And two nodes sharing a row must breathe:
  // less than 32px between them reads as touching boxes.
  const LANE_MARGIN = 16;
  const SIDE_GAP = 32;
  const laneById2 = new Map((model.lanes || []).map((l) => [l.id, l]));
  const byLaneNodes = new Map();
  for (const n of model.nodes) {
    const key = n.laneId || '';
    if (!byLaneNodes.has(key)) byLaneNodes.set(key, []);
    byLaneNodes.get(key).push(n);
  }
  for (const n of model.nodes) {
    const lane = laneById2.get(n.laneId || '');
    if (!lane) continue;
    const over = Math.max(0, n.bounds.x + n.bounds.width - (lane.bounds.x + lane.bounds.width - LANE_MARGIN))
      + Math.max(0, (lane.bounds.x + LANE_MARGIN) - n.bounds.x);
    if (over > EPS) {
      terms.laneFit += over * weights.laneFit;
      counts.laneFit += 1;
    }
  }
  for (const group of byLaneNodes.values()) {
    // Cluster the lane's nodes into row bands first (cy chain, 24px), then
    // check horizontal gaps between cx-neighbours INSIDE a row: sorting the
    // whole lane by cx would interleave other rows' columns and hide the
    // touching pair.
    const byCy = [...group].sort((a, b) => cy(a) - cy(b));
    const rows = [];
    for (const n of byCy) {
      const last = rows.at(-1);
      if (last && Math.abs(cy(n) - last.cy) <= 24) {
        last.members.push(n);
      } else {
        rows.push({ cy: cy(n), members: [n] });
      }
    }
    for (const row of rows) {
      const rowSorted = [...row.members].sort((a, b) => cx(a) - cx(b));
      for (let i = 1; i < rowSorted.length; i += 1) {
        const a = rowSorted[i - 1];
        const b = rowSorted[i];
        const gap = b.bounds.x - (a.bounds.x + a.bounds.width);
        if (gap < SIDE_GAP - EPS) {
          terms.sideGap += (SIDE_GAP - gap) * weights.sideGap;
          counts.sideGap += 1;
        }
      }
    }
  }

  let total = 0;
  for (const value of Object.values(terms)) total += value;
  return { total, terms, counts };
}
