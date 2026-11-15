// Joint layout+routing local search driver.
//
// The confirmed paradigm, completed: propose -> measure -> accept/roll back,
// over a state space that spans BOTH layout and routing degrees of freedom,
// with cost.mjs as the default arbiter, or an explicit experimental preference.
// Deterministic: fixed proposer order, sorted ids, strict-improvement
// acceptance, bounded passes and a shared A* budget.

import { diagramCost, routePenetration } from './cost.mjs';
import { gridFor, routeEdge } from './router.mjs';
import { proposeMoves, affectedEdgeIds } from './moves.mjs';

// A route must start/end on its endpoint node's boundary. A stale route kept
// after a failed reroute stays attached to the node's OLD position: it does
// not penetrate anything, it just dangles in space — invisible to the
// penetration guard, obvious in a rendered diagram.
function dockAttached(point, bounds) {
  const onLeft = Math.abs(point.x - bounds.x) <= 1 && point.y >= bounds.y - 1 && point.y <= bounds.y + bounds.height + 1;
  const onRight = Math.abs(point.x - (bounds.x + bounds.width)) <= 1 && point.y >= bounds.y - 1 && point.y <= bounds.y + bounds.height + 1;
  const onTop = Math.abs(point.y - bounds.y) <= 1 && point.x >= bounds.x - 1 && point.x <= bounds.x + bounds.width + 1;
  const onBottom = Math.abs(point.y - (bounds.y + bounds.height)) <= 1 && point.x >= bounds.x - 1 && point.x <= bounds.x + bounds.width + 1;
  return onLeft || onRight || onTop || onBottom;
}

export function toCostModel(state) {
  return {
    nodes: state.nodes.map((n) => ({ id: n.id, type: n.type, laneId: n.laneId, bounds: n.bounds })),
    edges: state.edges.map((e) => ({
      id: e.id,
      sourceId: e.sourceId,
      targetId: e.targetId,
      feedback: !!e.feedback,
      waypoints: state.routes.get(e.id) || [],
    })),
    lanes: state.lanes.map((l) => ({ id: l.id, index: l.index, bounds: l.bounds })),
  };
}

/**
 * Route coordinate descent at fixed geometry: reroute one edge at a time,
 * With a reading objective, try bounded shared-end pairs when single-edge
 * descent stalls at a crossing instead of breaking aligned geometry.
 * Keep a candidate only when the FULL diagram objective strictly improves.
 * The legacy inner loop accepted by a local quality proxy; the global cost is
 * the same arbiter here as for every layout move.
 */
export function routeDescent(state, grid, passes = 2, objective) {
  let routes = new Map(state.routes);
  let cost = diagramCost(toCostModel({ ...state, routes }));
  const routeModel = { nodes: state.nodes.map((n) => ({ id: n.id, bounds: n.bounds })), edges: state.edges };
  const better = (trial, trialCost) => objective
    ? objective.better({...state,routes:trial},trialCost,{...state,routes},cost)
    : trialCost.total < cost.total - 0.01;
  for (let pass = 0; pass < passes; pass += 1) {
    let improved = false;
    const ids = state.edges
      .map((e) => ({ id: e.id, bends: (routes.get(e.id)?.length || 2) - 2 }))
      .sort((a, b) => b.bends - a.bends || a.id.localeCompare(b.id))
      .map((entry) => entry.id);
    for (const id of ids) {
      const edge = state.edges.find((e) => e.id === id);
      const candidate = routeEdge(
        routeModel,
        grid,
        edge,
        routes,
      );
      if (!candidate) continue;
      const trial = new Map(routes);
      trial.set(id, candidate);
      const trialCost = diagramCost(toCostModel({ ...state, routes: trial }));
      if (better(trial, trialCost)) {
        routes = trial;
        cost = trialCost;
        improved = true;
      }
    }
    if (objective && !improved && cost.counts.crossing > 0 && grid.budget.remaining > 0) {
      // At a fork/join the routes compete for the same docks. Either edge
      // alone can be locally optimal while swapping both removes a crossing.
      // Release both old routes and try both deterministic orders atomically:
      // no intermediate regression is committed and no aligned node moves.
      // Limit candidates as well as A* expansions; do not turn descent into
      // an unbounded all-edge permutation search.
      const edges = [...state.edges].sort((a,b)=>a.id.localeCompare(b.id));
      let pairs = 0;
      pairsLoop: for (let i=0;i<edges.length;i++) for (let j=i+1;j<edges.length;j++) {
        const a=edges[i],b=edges[j];
        if(a.sourceId!==b.sourceId && a.targetId!==b.targetId)continue;
        if(!routes.has(a.id)||!routes.has(b.id))continue;
        const pairCost=diagramCost({nodes:[],lanes:[],edges:[a,b].map(e=>({...e,waypoints:routes.get(e.id)}))});
        if(pairCost.counts.crossing===0)continue;
        if(pairs++>=8 || grid.budget.remaining<=0)break pairsLoop;
        for(const order of [[a,b],[b,a]]) {
          const trial=new Map(routes);
          trial.delete(a.id);trial.delete(b.id);
          for(const edge of order) {
            const fresh=routeEdge(routeModel,grid,edge,trial);
            if(!fresh)break;
            trial.set(edge.id,fresh);
          }
          if(!trial.has(a.id)||!trial.has(b.id))continue;
          const trialCost=diagramCost(toCostModel({...state,routes:trial}));
          if(trialCost.counts.nodeOverlap>0 || !better(trial,trialCost))continue;
          routes=trial;cost=trialCost;improved=true;
        }
      }
    }
    if (!improved) break;
  }
  return { state: { ...state, routes }, cost };
}

export function jointSearch(state, opts = {}) {
  const maxPasses = opts.maxPasses ?? 4;
  const maxMovesPerPass = opts.maxMovesPerPass ?? 60;
  const objective = opts.objective;
  const better = (next, nextCost, prev, prevCost) => objective
    ? objective.better(next,nextCost,prev,prevCost) : nextCost.total < prevCost.total - .01;
  // Deterministic work cap: every A* expansion draws from one shared budget
  // (the semantics the legacy router proved), so identical input yields
  // identical output regardless of machine load. The budget is the ONLY stop
  // condition: a wall-clock valve was tried and removed because it made the
  // output load-dependent (a saturated machine truncated the search once and
  // produced a divergent diagram), while the budget already bounds runaway
  // work by construction.
  const workBudget = { remaining: opts.maxExpansions ?? 3000000 };
  const trace = opts.trace ? [] : null;

  let cur = { ...state };
  let cost = diagramCost(toCostModel(cur));
  let grid = null;
  const history = [{ pass: -1, move: 'seed', total: Math.round(cost.total) }];

  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (workBudget.remaining <= 0) break;
    let improved = false;
    const moves = [...(objective?.moves(cur) ?? []), ...proposeMoves(cur, cost)].slice(0, maxMovesPerPass);
    for (const move of moves) {
      // Once the shared expansion budget is spent, every further evaluation
      // degenerates into grid building and null routes; stop cleanly instead.
      if (workBudget.remaining <= 0) break;
      const nextBase = move.apply(cur);
      if (!nextBase) continue;
      if (objective && !objective.legalGeometry(nextBase)) continue;
      const movedIds = move.movedNodeIds();
      const edgeIds = move.edgeIds ? move.edgeIds() : affectedEdgeIds(cur, movedIds);
      if (edgeIds.size === 0 && !move.routeEdit) continue;

      // Rebuild the routing grid only when geometry actually changed.
      // Each grid carries its own A* budget: one failed search must not
      // starve the rest of the pass.
      let moveGrid = grid;
      if (movedIds.size > 0 || moveGrid === null) {
        try {
          moveGrid = gridFor({
            nodes: nextBase.nodes.map((n) => ({ id: n.id, bounds: n.bounds })),
            budget: workBudget,
          });
        } catch {
          continue;
        }
      }
      const routes = new Map(nextBase.routes || cur.routes);
      // Route-edit moves (waypoint drops) carry their own routes and skip the
      // forced replacement; the global cost gate still judges them.
      // Forced replacement: affected edges MUST get fresh routes anchored at
      // the moved geometry. rerouteSet's improve-only gate would keep stale
      // (now dangling) routes whenever the fresh one is locally worse; the
      // global delta-C gate below is the only acceptance arbiter.
      const routeModel = {
        nodes: nextBase.nodes.map((n) => ({ id: n.id, bounds: n.bounds })),
        edges: nextBase.edges,
      };
      if (!move.routeEdit) {
        for (const id of [...edgeIds].sort()) {
          const edge = routeModel.edges.find((e) => e.id === id);
          if (!edge) continue;
          const fresh = routeEdge(routeModel, moveGrid, edge, routes);
          if (fresh) routes.set(id, fresh);
        }
      }
      // Penetration guard: every route (rerouted or kept) must stay clear of
      // the moved nodes; a failed reroute (null) keeps a stale route that now
      // cuts through the moved box, which invalidates the whole candidate.
      let legal = true;
      for (const id of edgeIds) {
        if (!routes.get(id)) { legal = false; break; }
      }
      if (legal && movedIds.size > 0) {
        const movedNodes = nextBase.nodes.filter((n) => movedIds.has(n.id));
        for (const edge of cur.edges) {
          const wp = routes.get(edge.id);
          if (!wp) { legal = false; break; }
          if (routePenetration(wp, movedNodes, new Set([edge.sourceId, edge.targetId])) > 0) {
            legal = false;
            break;
          }
        }
      }
      if (!legal) continue;
      // Attachment guard: every route's first/last waypoint must sit on its
      // endpoint node's current boundary (catches stale routes after moves).
      const nodeById = new Map(nextBase.nodes.map((n) => [n.id, n]));
      for (const edge of cur.edges) {
        const wp = routes.get(edge.id);
        const s = nodeById.get(edge.sourceId);
        const t = nodeById.get(edge.targetId);
        if (!wp || wp.length < 2 || !s || !t) { legal = false; break; }
        if (!dockAttached(wp[0], s.bounds) || !dockAttached(wp[wp.length - 1], t.bounds)) {
          legal = false;
          break;
        }
      }
      if (!legal) continue;
      const cand = { ...nextBase, routes };
      let candCost = diagramCost(toCostModel(cand));
      let best = cand;
      // Rescue descent: a coordinated multi-node move (whole-row permutation)
      // leaves the congestion pattern far from converged after one forced
      // reroute per edge. Before rejecting, give large moves the same bounded
      // descent the legacy trials received, and keep whichever is better.
      if (!better(cand,candCost,cur,cost) && movedIds.size >= 3 && workBudget.remaining > 0) {
        const rescued = routeDescent(cand, moveGrid, 2);
        if (rescued.cost.total < candCost.total) {
          best = rescued.state;
          candCost = rescued.cost;
        }
      }
      const accepted = better(best,candCost,cur,cost);
      if (trace) {
        trace.push({ pass, move: move.label, total: Math.round(candCost.total), accepted,
          ...(objective?{reading:objective.reading(best,candCost),routing:objective.routing(candCost)}:{}) });
      }
      if (accepted) {
        cur = best;
        cost = candCost;
        grid = moveGrid;
        improved = true;
        history.push({ pass, move: move.label, total: Math.round(cost.total),
          ...(objective?{reading:objective.reading(cur,cost),routing:objective.routing(cost)}:{}) });
      }
    }
    if (!improved) break;
  }
  return { state: cur, cost, history, trace };
}
