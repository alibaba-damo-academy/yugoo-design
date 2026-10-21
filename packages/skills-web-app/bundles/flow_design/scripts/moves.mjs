// Move set for the joint layout+routing local search.
//
// First-principles role: these are the degrees of freedom the search may
// exercise. The prior outer loop could only propose X-column reassignment,
// which is why it never touched the visible defects (all Y/spacing/alignment).
// Every proposer here is defect-targeted: it only emits moves for objects that
// currently contribute to a cost term, so the proposal count is bounded by the
// defects present, not by n_nodes x n_move_classes.
//
// A move is { kind, ids, apply(state) -> newState | null } where state =
// { nodes, lanes, edges, routes }. apply returns a shallow-copied state with
// new bounds/waypoints for the touched objects only; null = illegal move.
// The search evaluates the full-diagram cost delta and accepts or drops.

import { boxOverlap, segments } from './router.mjs';
import { SPACING_BAND, forwardRanks, laneColumns, siblingGroups } from './cost.mjs';

const ROW_TARGET = Math.round((SPACING_BAND.min + SPACING_BAND.max) / 2);
const NUDGE_DY = [-56, -28, 28, 56];
const NUDGE_DX = [-30, 30];
const ALIGN_MAX_DY = 48;

function cloneNodes(nodes, ids, fn) {
  return nodes.map((n) => (ids.has(n.id) ? fn(n) : n));
}

function nodeCollision(nodes, moved) {
  for (const a of moved) {
    for (const b of nodes) {
      if (a.id === b.id) continue;
      if (a.attachTo === b.id || b.attachTo === a.id) continue;
      if (boxOverlap(a.bounds, b.bounds)) return true;
    }
  }
  return false;
}

/** Attached presentation children (boundary events) must translate exactly
 *  with their host, or the marker detaches from the activity edge. */
function followAttached(prev, deltas) {
  const full = new Map(deltas);
  for (const n of prev.nodes) {
    if (n.attachTo && deltas.has(n.attachTo) && !full.has(n.id)) full.set(n.id, deltas.get(n.attachTo));
  }
  return full;
}

/** Apply a per-node translation map (attached children follow their host).
 *  Returns the new state or null when the result collides or leaves a lane. */
function translateState(prev, baseDeltas) {
  const deltas = followAttached(prev, baseDeltas);
  const nodes = cloneNodes(prev.nodes, new Set(deltas.keys()), (n) => {
    const d = deltas.get(n.id);
    return { ...n, bounds: { ...n.bounds, x: n.bounds.x + (d.dx || 0), y: n.bounds.y + (d.dy || 0) } };
  });
  const moved = nodes.filter((n) => deltas.has(n.id));
  if (nodeCollision(nodes, moved) || !insideLanes(prev.lanes, moved)) return null;
  return { ...prev, nodes };
}

function insideLanes(lanes, moved) {
  const laneById = new Map(lanes.map((l) => [l.id, l]));
  for (const n of moved) {
    const lane = laneById.get(n.laneId);
    if (!lane) continue;
    const b = n.bounds;
    if (b.x < lane.bounds.x || b.x + b.width > lane.bounds.x + lane.bounds.width) return false;
    if (b.y < lane.bounds.y || b.y + b.height > lane.bounds.y + lane.bounds.height) return false;
  }
  return true;
}

function rowsOfLane(nodes, laneId) {
  const rows = new Map();
  for (const n of nodes) {
    if (n.laneId !== laneId) continue;
    // rowKey lets attached presentation children (boundary events) join
    // their host's row so row moves keep the attachment intact.
    const key = n.rowKey ?? Math.round(n.bounds.y);
    const row = rows.get(key) || { y: n.bounds.y, bottom: 0, ids: [] };
    row.bottom = Math.max(row.bottom, n.bounds.y + n.bounds.height);
    row.ids.push(n.id);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.y - b.y);
}

function deviatingGaps(nodes, lanes) {
  const out = [];
  for (const lane of lanes) {
    const rows = rowsOfLane(nodes, lane.id);
    for (let i = 1; i < rows.length; i += 1) {
      const gap = rows[i].y - rows[i - 1].bottom;
      const dev = Math.max(0, SPACING_BAND.min - gap) + Math.max(0, gap - SPACING_BAND.max);
      if (dev > 0.5) out.push({ laneId: lane.id, rowY: rows[i].y, delta: ROW_TARGET - gap });
    }
  }
  return out.sort((a, b) => a.laneId.localeCompare(b.laneId) || a.rowY - b.rowY);
}

/**
 * M4 row-gap stretch/compress: shift the target lane's rows at/below `rowY`
 * by delta and grow lane bounds to fit. Targets the spacing term directly.
 */
function rowGapMoves(state, cost) {
  if ((cost.counts.spacing || 0) === 0) return [];
  const gaps = deviatingGaps(state.nodes, state.lanes);
  const out = [];
  for (const g of gaps.slice(0, 3)) {
    // Full step plus a half step: large compressions often fail the routing
    // feasibility guard, and a feasible half step still reduces the term.
    for (const delta of [g.delta, Math.round(g.delta / 2 / 4) * 4]) {
      if (Math.abs(delta) < 8) continue;
      out.push(rowGapMove(state, g, delta));
    }
  }
  return out;
}

function rowGapMove(state, g, delta) {
  return {
    kind: 'rowGap',
    label: `rowGap ${g.laneId}@${Math.round(g.rowY)} ${delta > 0 ? '+' : ''}${Math.round(delta)}`,
    movedNodeIds: () => new Set(state.nodes.filter((n) => n.laneId === g.laneId && n.bounds.y >= g.rowY - 0.5).map((n) => n.id)),
    apply(prev) {
      // Shift only the target lane's rows at/below rowY: rows are per-lane
      // structures, a global y-threshold would slice another lane's row.
      const ids = new Set(
        prev.nodes.filter((n) => n.laneId === g.laneId && n.bounds.y >= g.rowY - 0.5).map((n) => n.id),
      );
      if (ids.size === 0) return null;
      const nodes = cloneNodes(prev.nodes, ids, (n) => ({ ...n, bounds: { ...n.bounds, y: n.bounds.y + delta } }));
      const moved = nodes.filter((n) => ids.has(n.id));
      if (nodeCollision(nodes, moved)) return null;
      const maxY = Math.max(...nodes.map((n) => n.bounds.y + n.bounds.height));
      const lanes = prev.lanes.map((l) => ({
        ...l,
        bounds: { ...l.bounds, height: Math.max(l.bounds.height, maxY - l.bounds.y + 40) },
      }));
      if (!insideLanes(lanes, moved)) return null;
      return { ...prev, nodes, lanes };
    },
  };
}

/**
 * M6 cross-lane center alignment: for a cross-lane edge whose endpoints are
 * nearly but not exactly level, move the target vertically onto the source
 * center so the connection becomes a straight horizontal dock.
 */
function alignMoves(state, cost) {
  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));
  const laneById = new Map(state.nodes.map((n) => [n.id, n.laneId]));
  const out = [];
  for (const edge of state.edges) {
    const s = nodeById.get(edge.sourceId);
    const t = nodeById.get(edge.targetId);
    if (!s || !t || edge.feedback) continue;
    if (laneById.get(s.id) === laneById.get(t.id)) continue;
    const scy = s.bounds.y + s.bounds.height / 2;
    const tcy = t.bounds.y + t.bounds.height / 2;
    const scx = s.bounds.x + s.bounds.width / 2;
    const tcx = t.bounds.x + t.bounds.width / 2;
    const dy = scy - tcy;
    if (Math.abs(dy) < 2 || Math.abs(dy) > ALIGN_MAX_DY) continue;
    if (Math.abs(scx - tcx) <= 2) continue;
    const base = new Map([[t.id, { dx: 0, dy }]]);
    const ids = new Set(followAttached(state, base).keys());
    out.push({
      kind: 'align',
      label: `align ${t.id} dy=${Math.round(dy)}`,
      movedNodeIds: () => new Set(ids),
      apply(prev) {
        return translateState(prev, base);
      },
    });
  }
  void cost;
  return out.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 6);
}

/**
 * M6x horizontal center alignment: an edge whose endpoints are nearly but not
 * exactly vertically aligned needs an avoidable elbow; sliding one endpoint
 * onto the other's center X removes it. This is the X degree of freedom the
 * legacy outer loop exercised by column reassignment, expressed as a
 * defect-targeted move.
 */
function alignXMoves(state, cost) {
  if ((cost.counts.bend || 0) === 0) return [];
  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));
  const laneById = new Map(state.lanes.map((l) => [l.id, l]));
  const out = [];
  for (const edge of state.edges) {
    const s = nodeById.get(edge.sourceId);
    const t = nodeById.get(edge.targetId);
    if (!s || !t || s.id === t.id) continue;
    const waypoints = state.routes.get(edge.id);
    const bends = waypoints ? waypoints.length - 2 : 0;
    if (bends < 2) continue;
    const scx = s.bounds.x + s.bounds.width / 2;
    const tcx = t.bounds.x + t.bounds.width / 2;
    const dx = tcx - scx;
    if (Math.abs(dx) < 2 || Math.abs(dx) > 96) continue;
    for (const [node, delta] of [[t, -dx], [s, dx]]) {
      if (out.length >= 8) break;
      const lane = laneById.get(node.laneId);
      const nx = node.bounds.x + delta;
      if (lane && (nx < lane.bounds.x || nx + node.bounds.width > lane.bounds.x + lane.bounds.width)) continue;
      const base = new Map([[node.id, { dx: delta, dy: 0 }]]);
      const ids = new Set(followAttached(state, base).keys());
      out.push({
        kind: 'alignX',
        label: `alignX ${node.id} ${delta > 0 ? '+' : ''}${Math.round(delta)}`,
        movedNodeIds: () => new Set(ids),
        apply(prev) {
          return translateState(prev, base);
        },
      });
    }
  }
  return out;
}

/**
 * M7 row column permutation: within one lane row, reassign column centers so
 * each node sits near the median of its same-lane neighbors. Columns come
 * from ALL lane members (not just the row), and each row consumes distinct
 * columns — the exact freedom the legacy outer loop exercised. It stays a
 * measurable proposal: the search routes it and the global cost gate decides.
 */
function neighborMedianX(state, lane, nodeById, n, direction) {
  const values = [];
  for (const e of state.edges) {
    let other = null;
    if (e.targetId === n.id && nodeById.get(e.sourceId)?.laneId === lane.id) other = nodeById.get(e.sourceId);
    else if (direction === 'both' && e.sourceId === n.id && nodeById.get(e.targetId)?.laneId === lane.id) {
      other = nodeById.get(e.targetId);
    }
    if (other && (direction === 'both' || other.bounds.y < n.bounds.y)) {
      values.push(other.bounds.x + other.bounds.width / 2);
    }
  }
  values.sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : n.bounds.x + n.bounds.width / 2;
}

/** Lane-wide column centers available to any row of that lane. */
function laneCenters(state, lane) {
  return [...new Set(
    state.nodes.filter((n) => n.laneId === lane.id).map((n) => n.bounds.x + n.bounds.width / 2),
  )].sort((a, b) => a - b);
}

function laneRows(state, lane) {
  const rows = new Map();
  for (const n of state.nodes.filter((m) => m.laneId === lane.id)) {
    const row = rows.get(n.bounds.y) || [];
    row.push(n);
    rows.set(n.bounds.y, row);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]);
}

/** Assign distinct lane columns to one row, nearest-preference first. */
function assignRowColumns(state, lane, nodeById, row, direction, centers) {
  const preferred = new Map(row.map((n) => [n.id, neighborMedianX(state, lane, nodeById, n, direction)]));
  const order = [...row].sort((a, b) => preferred.get(a.id) - preferred.get(b.id) || a.id.localeCompare(b.id));
  const available = [...centers];
  const assign = new Map();
  for (const n of order) {
    const want = preferred.get(n.id);
    available.sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b);
    assign.set(n.id, available.shift());
  }
  return assign;
}

function permuteDeltas(state, lane, nodeById, row, direction, centers) {
  if (centers.length < row.length) return null;
  const assign = assignRowColumns(state, lane, nodeById, row, direction, centers);
  const base = new Map();
  for (const n of row) {
    const dx = assign.get(n.id) - (n.bounds.x + n.bounds.width / 2);
    if (Math.abs(dx) >= 0.5) base.set(n.id, { dx, dy: 0 });
  }
  return base.size > 0 ? base : null;
}

export function translateMove(kind, label, state, base) {
  const ids = new Set(followAttached(state, base).keys());
  return {
    kind,
    label,
    movedNodeIds: () => new Set(ids),
    apply(prev) {
      return translateState(prev, base);
    },
  };
}

function rowPermuteMoves(state, cost) {
  if ((cost.counts.bend || 0) === 0 && (cost.counts.crossing || 0) === 0) return [];
  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));
  const out = [];
  for (const lane of state.lanes) {
    const laneCenterList = laneCenters(state, lane);
    for (const [y, row] of laneRows(state, lane)) {
      if (row.length < 2) continue;
      const rowCenterList = [...new Set(row.map((n) => n.bounds.x + n.bounds.width / 2))].sort((a, b) => a - b);
      for (const direction of ['incoming', 'both']) {
        if (out.length >= 12) return out;
        // Two freedoms per row: permute within the row's own columns (safe,
        // small), or draw from every lane column (the legacy outer-loop move).
        for (const [scope, centers] of [['row', rowCenterList], ['lane', laneCenterList]]) {
          const base = permuteDeltas(state, lane, nodeById, row, direction, centers);
          if (!base) continue;
          const label = `rowPermute${scope === 'lane' ? 'Lane' : ''} ${lane.id}@${Math.round(y)} ${direction}`;
          if (out.some((m) => m.label === label)) continue;
          out.push(translateMove('rowPermute', label, state, base));
        }
      }
    }
  }
  return out;
}

/**
 * M7all whole-diagram column permutation: exactly one legacy outer-loop
 * trial as one move — permute every multi-node row of every lane toward the
 * neighbor-median preference, then let the global cost gate decide. Single
 * rows rarely improve alone; the coordinated permutation can.
 */
function rowPermuteAllMoves(state, cost) {
  if ((cost.counts.bend || 0) === 0 && (cost.counts.crossing || 0) === 0) return [];
  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));
  const out = [];
  for (const direction of ['incoming', 'both']) {
    const base = new Map();
    for (const lane of state.lanes) {
      const laneCenterList = laneCenters(state, lane);
      for (const [, row] of laneRows(state, lane)) {
        if (row.length < 2) continue;
        const rowBase = permuteDeltas(state, lane, nodeById, row, direction, laneCenterList);
        if (rowBase) for (const [id, d] of rowBase) base.set(id, d);
      }
    }
    if (base.size === 0) continue;
    out.push(translateMove('rowPermuteAll', `rowPermuteAll ${direction} (${base.size} nodes)`, state, base));
  }
  return out;
}

/**
 * M1/M3 node nudge: endpoints of edges carrying extra bends, crossings or
 * parallel runs get small vertical/horizontal nudges. This is the generic
 * escape hatch the old outer loop lacked entirely.
 */
function nudgeMoves(state, cost) {
  const bad = new Set();
  for (const edge of state.edges) {
    const wps = state.routes.get(edge.id) || [];
    const bends = Math.max(0, wps.length - 2);
    const minB = edge.feedback ? 2 : 0;
    if (bends > minB + 1) { bad.add(edge.sourceId); bad.add(edge.targetId); }
  }
  if ((cost.counts.crossing || 0) > 0 || (cost.counts.parallel || 0) > 0) {
    // endpoints of every edge participate; bounded by slice below
    for (const edge of state.edges) { bad.add(edge.sourceId); bad.add(edge.targetId); }
  }
  const ids = [...bad].sort();
  const out = [];
  for (const id of ids.slice(0, 8)) {
    for (const dy of NUDGE_DY) out.push(nudge(state, id, 0, dy));
    for (const dx of NUDGE_DX) out.push(nudge(state, id, dx, 0));
  }
  return out;
}

function nudge(state, id, dx, dy) {
  const base = new Map([[id, { dx, dy }]]);
  return translateMove('nudge', `nudge ${id} ${dx > 0 ? '+' : ''}${dx},${dy > 0 ? '+' : ''}${dy}`, state, base);
}

/**
 * M8 routing moves: re-route one over-bent edge against the current others.
 * Geometry is untouched; the move only names the edge, and the search's
 * forced replacement computes the fresh route under the global cost gate.
 */
function routingMoves(state, cost) {
  void cost;
  const out = [];
  const scored = state.edges
    .map((edge) => {
      const wps = state.routes.get(edge.id) || [];
      return { edge, bends: Math.max(0, wps.length - 2) };
    })
    .sort((a, b) => b.bends - a.bends || a.edge.id.localeCompare(b.edge.id));
  for (const { edge, bends } of scored.slice(0, 8)) {
    out.push({
      kind: 'reroute',
      label: `reroute ${edge.id}`,
      movedNodeIds: () => new Set(),
      edgeIds: () => new Set([edge.id]),
      apply(prev) {
        return { ...prev };
      },
    });
    // Waypoint-drop edits: removing one interior bend is legal only when the
    // shortcut stays orthogonal and penetrates no node. routeEdit moves carry
    // their own routes; the search skips forced replacement for them.
    const wps = state.routes.get(edge.id) || [];
    for (let i = 1; i < wps.length - 1 && out.length < 40; i += 1) {
      const cand = [...wps.slice(0, i), ...wps.slice(i + 1)];
      if (cand.length < 2) continue;
      let orthogonal = true;
      for (let k = 0; k + 1 < cand.length; k += 1) {
        if (cand[k].x !== cand[k + 1].x && cand[k].y !== cand[k + 1].y) { orthogonal = false; break; }
      }
      if (!orthogonal) continue;
      if (state.nodes.some((n) => n.id !== edge.sourceId && n.id !== edge.targetId
        && cand.some((p, k) => k + 1 < cand.length && segmentHitsBox(p, cand[k + 1], n.bounds)))) continue;
      const nodeById = new Map(state.nodes.map((n) => [n.id, n]));
      const sB = nodeById.get(edge.sourceId)?.bounds;
      const tB = nodeById.get(edge.targetId)?.bounds;
      if (!sB || !tB) continue;
      if (!dockOn(cand[0], sB) || !dockOn(cand[cand.length - 1], tB)) continue;
      if (bends - 1 <= 0) continue;
      out.push({
        kind: 'dropWaypoint',
        label: `drop ${edge.id}#${i}`,
        movedNodeIds: () => new Set(),
        edgeIds: () => new Set(),
        routeEdit: true,
        apply(prev) {
          const routes = new Map(prev.routes);
          routes.set(edge.id, cand);
          return { ...prev, routes };
        },
      });
    }
  }
  return out;
}

function segmentHitsBox(a, b, box) {
  const minX = box.x - 0.5;
  const minY = box.y - 0.5;
  const maxX = box.x + box.width + 0.5;
  const maxY = box.y + box.height + 0.5;
  if (a.x === b.x) {
    if (a.x <= minX || a.x >= maxX) return false;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return hi > minY && lo < maxY;
  }
  if (a.y <= minY || a.y >= maxY) return false;
  const lo = Math.min(a.x, b.x);
  const hi = Math.max(a.x, b.x);
  return hi > minX && lo < maxX;
}

function dockOn(point, bounds) {
  const onLeft = Math.abs(point.x - bounds.x) <= 1;
  const onRight = Math.abs(point.x - (bounds.x + bounds.width)) <= 1;
  const onTop = Math.abs(point.y - bounds.y) <= 1;
  const onBottom = Math.abs(point.y - (bounds.y + bounds.height)) <= 1;
  const withinX = point.x >= bounds.x - 1 && point.x <= bounds.x + bounds.width + 1;
  const withinY = point.y >= bounds.y - 1 && point.y <= bounds.y + bounds.height + 1;
  return (onLeft || onRight) && withinY || (onTop || onBottom) && withinX;
}

// ---- structural regularity moves -----------------------------------------
// The spine/row cost terms make misalignment measurable; these moves give the
// search the ability to actually remove it: snap a whole causal chain onto
// one x-center, or a whole topological rank onto one y-center. Gated on the
// matching term being positive so aligned diagrams pay no move spam.
function snapChainMoves(state, cost) {
  if ((cost.terms.spine || 0) <= 0.01) return [];
  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));
  // Single-child continuation: pull the child onto the parent's column.
  // Fork symmetry: center the same-lane children group under the fork.
  const sameLaneChildren = new Map();
  for (const e of state.edges) {
    if (e.feedback || e.sourceId === e.targetId) continue;
    const sN = nodeById.get(e.sourceId);
    const tN = nodeById.get(e.targetId);
    if (!sN || !tN || sN.laneId !== tN.laneId) continue;
    if (!sameLaneChildren.has(e.sourceId)) sameLaneChildren.set(e.sourceId, []);
    sameLaneChildren.get(e.sourceId).push(tN);
  }
  const out0 = [];
  for (const [sourceId, children] of sameLaneChildren) {
    const src = nodeById.get(sourceId);
    const scx = src.bounds.x + src.bounds.width / 2;
    if (children.length === 1) {
      const child = children[0];
      const ccx = child.bounds.x + child.bounds.width / 2;
      const dx = scx - ccx;
      if (Math.abs(dx) >= 1) {
        out0.push(translateMove(
          'snapChain',
          `snapChain ${child.id} -> column of ${sourceId}`,
          state,
          new Map([[child.id, { dx, dy: 0 }]]),
        ));
      }
    } else {
      const mean = children.reduce((n, c) => n + c.bounds.x + c.bounds.width / 2, 0) / children.length;
      const dx = scx - mean;
      if (Math.abs(dx) >= 1) {
        const base = new Map();
        for (const c of children) base.set(c.id, { dx, dy: 0 });
        out0.push(translateMove(
          'snapChain',
          `snapChain fork ${sourceId} children centered`,
          state,
          base,
        ));
      }
    }
  }
  const chainEdges = state.edges.filter((e) =>
    !e.feedback && e.sourceId !== e.targetId &&
    nodeById.get(e.sourceId) && nodeById.get(e.targetId) &&
    nodeById.get(e.sourceId).laneId === nodeById.get(e.targetId).laneId);
  const outDeg = new Map();
  const inDeg = new Map();
  for (const e of chainEdges) {
    outDeg.set(e.sourceId, (outDeg.get(e.sourceId) || 0) + 1);
    inDeg.set(e.targetId, (inDeg.get(e.targetId) || 0) + 1);
  }
  const visited = new Set();
  const out = [];
  for (const e of chainEdges) {
    if (visited.has(e.id)) continue;
    if ((inDeg.get(e.sourceId) || 0) === 1) continue; // not a chain head
    const members = [e.sourceId];
    let cursor = e;
    while (
      cursor &&
      (outDeg.get(cursor.sourceId) || 0) === 1 &&
      (inDeg.get(cursor.targetId) || 0) === 1
    ) {
      members.push(cursor.targetId);
      visited.add(cursor.id);
      cursor = chainEdges.find((x) => x.sourceId === cursor.targetId && !visited.has(x.id));
    }
    visited.add(e.id);
    if (members.length < 2) continue;
    const centers = members.map((id) => {
      const b = nodeById.get(id).bounds;
      return b.x + b.width / 2;
    });
    if (Math.max(...centers) - Math.min(...centers) < 2) continue;
    const sorted = [...centers].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const target of [centers[0], median]) {
      const base = new Map();
      for (const id of members) {
        const b = nodeById.get(id).bounds;
        const dx = target - (b.x + b.width / 2);
        if (Math.abs(dx) >= 1) base.set(id, { dx, dy: 0 });
      }
      if (base.size > 0) {
        out.push(translateMove(
          'snapChain',
          `snapChain ${members.join('>')} -> x${Math.round(target)}`,
          state,
          base,
        ));
      }
    }
  }
  return [...out0, ...out];
}

// Project lane-column outliers onto their nearest column center. Column
// membership comes from the same cx clustering the cost term uses, so the
// move removes exactly what the term measures. Overlap rejections keep the
// projection honest where a column move would collide.
function snapColumnMoves(state, cost) {
  if ((cost.terms.lattice || 0) <= 0.01) return [];
  const cxEst = (n) => n.bounds.x + n.bounds.width / 2;
  const cyEst = (n) => n.bounds.y + n.bounds.height / 2;
  const columnsByLane = laneColumns(
    state.nodes, state.edges, cxEst, cyEst,
    forwardRanks(state.nodes, state.edges), state.lanes,
  );
  const out = [];
  for (const [, columns] of columnsByLane) {
    for (const col of columns) {
      const centers = col.members.map(cxEst).sort((a, b) => a - b);
      const center = centers[Math.floor(centers.length / 2)];
      for (const n of col.members) {
        const dx = center - cxEst(n);
        if (Math.abs(dx) < 1) continue;
        out.push(translateMove(
          'snapColumn',
          `snapColumn ${n.id} -> x${Math.round(center)}`,
          state,
          new Map([[n.id, { dx, dy: 0 }]]),
        ));
        // Rehome: when the straight column snap would land on a row partner
        // (overlap), also offer the human placement — same column, own row
        // slot (midpoint of the nearest empty vertical gap in the lane).
        const laneNodes = state.nodes.filter((m) => (m.laneId || '') === (n.laneId || ''));
        const bands = laneNodes
          .filter((m) => m.id !== n.id)
          .map((m) => [m.bounds.y, m.bounds.y + m.bounds.height])
          .sort((a, b) => a[0] - b[0]);
        const slots = [];
        let cursor = -Infinity;
        for (const [top, bottom] of bands) {
          if (top - cursor > n.bounds.height + 24) slots.push((cursor + top) / 2);
          cursor = Math.max(cursor, bottom);
        }
        slots.push(cursor + 60);
        const myCy = cyEst(n);
        // Offer the three nearest empty row slots, not just one: the best
        // slot for a feedback-source node is usually ABOVE its row partner
        // (short loopback), which the single nearest slot can miss.
        for (const slot of slots.sort((a, b) => Math.abs(a - myCy) - Math.abs(b - myCy)).slice(0, 3)) {
          const dy = slot - myCy;
          if (Math.abs(dy) < 8) continue;
          out.push(translateMove(
            'snapColumn',
            `rehome ${n.id} -> x${Math.round(center)},y${Math.round(slot)}`,
            state,
            new Map([[n.id, { dx, dy }]]),
          ));
        }
      }
    }
  }
  return out;
}

function snapRowMoves(state, cost) {
  if ((cost.terms.row || 0) <= 0.01 && (cost.terms.rowCross || 0) <= 0.01) return [];
  const out = [];
  // Cross-lane fork siblings (rowCross): one shared step, one row across lanes.
  if ((cost.terms.rowCross || 0) > 0.01) {
    const sibBySource = new Map();
    for (const e of state.edges) {
      if (e.feedback || e.sourceId === e.targetId) continue;
      const tN = state.nodes.find((n) => n.id === e.targetId);
      if (!tN) continue;
      if (!sibBySource.has(e.sourceId)) sibBySource.set(e.sourceId, []);
      sibBySource.get(e.sourceId).push(tN);
    }
    for (const [, siblings] of sibBySource) {
      const lanes = new Set(siblings.map((n) => n.laneId));
      if (lanes.size < 2) continue;
      const centers = siblings.map((n) => n.bounds.y + n.bounds.height / 2);
      const sorted = [...centers].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const base = new Map();
      siblings.forEach((n, i) => {
        const dy = median - centers[i];
        if (Math.abs(dy) >= 1) base.set(n.id, { dx: 0, dy });
      });
      if (base.size > 0) {
        out.push(translateMove('snapRow', `snapRow xsiblings -> y${Math.round(median)}`, state, base));
      }
    }
  }
  // Per-lane visual siblings (row): same-rank join parents / diamond kids.
  const rowRanks = forwardRanks(state.nodes, state.edges);
  for (const raw of siblingGroups(state.nodes, state.edges)) {
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
      const centers = members.map((n) => n.bounds.y + n.bounds.height / 2);
      const sorted = [...centers].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const base = new Map();
      members.forEach((n, i) => {
        const dy = median - centers[i];
        if (Math.abs(dy) >= 1) base.set(n.id, { dx: 0, dy });
      });
      if (base.size > 0) {
        out.push(translateMove('snapRow', `snapRow siblings -> y${Math.round(median)}`, state, base));
      }
    }
    }
  }
  return out;
}

export function proposeMoves(state, cost) {
  return [
    ...snapChainMoves(state, cost),
    ...snapColumnMoves(state, cost),
    ...snapRowMoves(state, cost),
    ...rowGapMoves(state, cost),
    ...rowPermuteAllMoves(state, cost),
    ...alignMoves(state, cost),
    ...alignXMoves(state, cost),
    ...rowPermuteMoves(state, cost),
    ...nudgeMoves(state, cost),
    ...routingMoves(state, cost),
  ];
}

export function affectedEdgeIds(state, movedNodeIds) {
  const out = new Set();
  for (const edge of state.edges) {
    if (movedNodeIds.has(edge.sourceId) || movedNodeIds.has(edge.targetId)) out.add(edge.id);
  }
  return out;
}

export { segments };
