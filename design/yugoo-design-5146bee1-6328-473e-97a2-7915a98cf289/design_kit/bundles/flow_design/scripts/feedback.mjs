// Feedback (back-)edge detection shared by the layout pipeline and the
// metrics ruler, so both measure extraBend against the SAME semantic
// classification. A geometric proxy (target above source) mislabels upward
// branches and under-labels loopbacks that route around lanes.
//
// Detection is SCC-based rather than DFS-stack based. A DFS can break an
// approval cycle at an arbitrary edge selected by id/declaration order;
// SCCs first isolate genuine cycles, then shortest distance from the start
// identifies the edge(s) that return to an earlier business step.
//
// Contract:
//   nodes:  [{ id, type }]          type is the BPMN $type (root detection)
//   edges:  [{ id, sourceId, targetId }]
//   hostOf: Map(boundaryEventId -> hostId)   optional
// Returns Set<edgeId>.

/**
 * @param {{id:string,type?:string}[]} nodes
 * @param {{id:string,sourceId:string,targetId:string}[]} edges
 * @param {Map<string,string>} [hostOf]
 * @returns {Set<string>}
 */
export function detectFeedbackEdges(nodes, edges, hostOf = new Map()) {
  const topologyNodeId = (nodeId) => hostOf.get(nodeId) || nodeId;
  const topologyNodes = nodes.filter((node) => !hostOf.has(node.id));
  const adj = new Map();
  for (const n of topologyNodes) adj.set(n.id, []);
  for (const e of edges) {
    const sourceId = topologyNodeId(e.sourceId);
    const targetId = topologyNodeId(e.targetId);
    if (sourceId !== targetId && adj.has(sourceId) && adj.has(targetId)) {
      adj.get(sourceId).push({ target: targetId, edgeId: e.id });
    }
  }
  for (const neighbours of adj.values()) {
    neighbours.sort((a, b) =>
      a.target.localeCompare(b.target) || a.edgeId.localeCompare(b.edgeId),
    );
  }

  const distance = new Map(topologyNodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  let roots = topologyNodes
    .filter((node) => node.type === 'bpmn:StartEvent')
    .map((node) => node.id);
  if (roots.length === 0 && topologyNodes.length > 0) roots = [topologyNodes[0].id];
  const queue = [...roots].sort();
  for (const root of queue) distance.set(root, 0);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const source = queue[cursor];
    for (const { target } of adj.get(source) || []) {
      const nextDistance = distance.get(source) + 1;
      if (nextDistance < distance.get(target)) {
        distance.set(target, nextDistance);
        queue.push(target);
      }
    }
  }

  let tarjanIndex = 0;
  const indexByNode = new Map();
  const lowLink = new Map();
  const stack = [];
  const onStack = new Set();
  const componentByNode = new Map();
  const components = [];
  function strongConnect(id) {
    indexByNode.set(id, tarjanIndex);
    lowLink.set(id, tarjanIndex);
    tarjanIndex += 1;
    stack.push(id);
    onStack.add(id);
    for (const { target } of adj.get(id) || []) {
      if (!indexByNode.has(target)) {
        strongConnect(target);
        lowLink.set(id, Math.min(lowLink.get(id), lowLink.get(target)));
      } else if (onStack.has(target)) {
        lowLink.set(id, Math.min(lowLink.get(id), indexByNode.get(target)));
      }
    }
    if (lowLink.get(id) === indexByNode.get(id)) {
      const component = [];
      while (stack.length > 0) {
        const member = stack.pop();
        onStack.delete(member);
        componentByNode.set(member, components.length);
        component.push(member);
        if (member === id) break;
      }
      components.push(component);
    }
  }
  for (const node of topologyNodes) {
    if (!indexByNode.has(node.id)) strongConnect(node.id);
  }

  // Natural BPMN loops return to a node that dominates the loop source.
  // Dominators distinguish that edge from a long branch entering a merge
  // whose shortest-path rank may also be lower than the branch source.
  const allNodeIds = new Set(topologyNodes.map((node) => node.id));
  const predecessors = new Map(topologyNodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    const sourceId = topologyNodeId(edge.sourceId);
    const targetId = topologyNodeId(edge.targetId);
    if (sourceId !== targetId && predecessors.has(targetId)) {
      predecessors.get(targetId).push(sourceId);
    }
  }
  const rootIds = new Set(roots);
  const dominators = new Map();
  for (const node of topologyNodes) {
    dominators.set(node.id, rootIds.has(node.id) ? new Set([node.id]) : new Set(allNodeIds));
  }
  let dominatorsChanged = true;
  while (dominatorsChanged) {
    dominatorsChanged = false;
    for (const node of topologyNodes) {
      if (rootIds.has(node.id)) continue;
      const preds = predecessors.get(node.id) || [];
      let intersection = preds.length > 0
        ? new Set(dominators.get(preds[0]) || [])
        : new Set();
      for (const predecessor of preds.slice(1)) {
        const predecessorDominators = dominators.get(predecessor) || new Set();
        intersection = new Set(
          [...intersection].filter((candidate) => predecessorDominators.has(candidate)),
        );
      }
      intersection.add(node.id);
      const previous = dominators.get(node.id);
      if (
        previous.size !== intersection.size ||
        [...previous].some((candidate) => !intersection.has(candidate))
      ) {
        dominators.set(node.id, intersection);
        dominatorsChanged = true;
      }
    }
  }

  const feedbackEdgeIds = new Set();
  for (const edge of edges) {
    const sourceId = topologyNodeId(edge.sourceId);
    const targetId = topologyNodeId(edge.targetId);
    if (edge.sourceId === edge.targetId) {
      feedbackEdgeIds.add(edge.id);
      continue;
    }
    if (sourceId === targetId) continue;
    const componentId = componentByNode.get(sourceId);
    if (componentId !== componentByNode.get(targetId)) continue;
    const component = components[componentId] || [];
    const isCycle = component.length > 1 || sourceId === targetId;
    if (!isCycle) continue;
    if (
      Number.isFinite(distance.get(sourceId)) &&
      dominators.get(sourceId)?.has(targetId)
    ) {
      feedbackEdgeIds.add(edge.id);
    }
  }
  // Structured BPMN normally has natural loops, but parallel rework can be
  // irreducible (the loop target is only one branch and therefore does not
  // dominate the join). Repeatedly extract one residual cycle and remove its
  // maximum rank-drop edge until the graph is genuinely acyclic.
  function findResidualCycle() {
    const outgoing = new Map(topologyNodes.map((node) => [node.id, []]));
    for (const edge of edges) {
      const sourceId = topologyNodeId(edge.sourceId);
      const targetId = topologyNodeId(edge.targetId);
      if (!feedbackEdgeIds.has(edge.id) && sourceId !== targetId && outgoing.has(sourceId)) {
        outgoing.get(sourceId).push({ edge, sourceId, targetId });
      }
    }
    for (const values of outgoing.values()) {
      values.sort((a, b) =>
        a.targetId.localeCompare(b.targetId) || a.edge.id.localeCompare(b.edge.id),
      );
    }
    const color = new Map(topologyNodes.map((node) => [node.id, 0]));
    const parentEdge = new Map();
    function visit(id) {
      color.set(id, 1);
      for (const item of outgoing.get(id) || []) {
        const { edge, targetId: target } = item;
        if (color.get(target) === 0) {
          parentEdge.set(target, item);
          const found = visit(target);
          if (found) return found;
        } else if (color.get(target) === 1) {
          const cycle = [item];
          let cursor = id;
          while (cursor !== target) {
            const parent = parentEdge.get(cursor);
            if (!parent) break;
            cycle.push(parent);
            cursor = parent.sourceId;
          }
          return cycle;
        }
      }
      color.set(id, 2);
      return null;
    }
    const orderedIds = [
      ...roots.filter((id) => color.has(id)),
      ...topologyNodes.map((node) => node.id).filter((id) => !rootIds.has(id)),
    ];
    for (const id of orderedIds) {
      if (color.get(id) !== 0) continue;
      const cycle = visit(id);
      if (cycle) return cycle;
    }
    return null;
  }
  for (let guard = 0; guard < edges.length; guard += 1) {
    const cycle = findResidualCycle();
    if (!cycle) break;
    const fallback = [...cycle].sort((a, b) => {
      const aDrop = distance.get(a.sourceId) - distance.get(a.targetId);
      const bDrop = distance.get(b.sourceId) - distance.get(b.targetId);
      return bDrop - aDrop || b.edge.id.localeCompare(a.edge.id);
    })[0];
    feedbackEdgeIds.add(fallback.edge.id);
  }
  return feedbackEdgeIds;
}
