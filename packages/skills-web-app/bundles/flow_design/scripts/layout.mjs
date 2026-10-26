// Shared Flow Design BPMN auto-layout — invoked as a Bundle script subprocess.
//
// Pipeline:
//   1. Parse structure-only BPMN XML via bpmn-moddle → moddle tree
//   2. Walk the tree → build an ELK graph (nodes, edges, lane hierarchy)
//   3. Run elk.layout()  → graph annotated with x/y/width/height + edge sections
//   4. Translate ELK results back into BPMN DI elements (BPMNShape + BPMNEdge)
//   5. Re-serialize via bpmn-moddle → fully-laid-out BPMN XML
//
// Reads BPMN from the process input stream and writes laid-out BPMN to the output stream. With `--validate`,
// it only runs the authoritative bpmn-moddle import and exits on success.
// Errors → stderr + non-zero exit. Do not publish unvalidated fallback geometry.
//
// Why this exists: the pilot LLM emits BPMN structure (nodes + edges) but
// can't reliably compute coordinates that produce a clean diagram. ELK's
// layered algorithm seeds the geometry; bounded balanced reading-order search
// and route-only channel spacing produce deterministic final coordinates.
// Runtime depends on graph size and search work; there is no 150ms guarantee.
// See trial validation in conversation history (2026-05-12) — every edge
// waypoint matches its source/target shape boundary midpoint to <1px.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gridFor, seedRoutes } from './router.mjs';
import { detectFeedbackEdges } from './feedback.mjs';
import { jointSearch, routeDescent } from './search.mjs';
import { placeLabels } from './labels.mjs';
import { createReadingObjective } from './reading-order.mjs';
import { channelCrowding, spaceChannels } from './channel-spacing.mjs';
import { layoutPolicy } from './layout-policy.mjs';

// Literal imports enter the normal packaged closure. Classify only this exact
// entry's missing direct package; dependency initialization/transitive failures
// and missing emitted chunks retain their original exception.
function missingDirectDependency(error, packageName) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND'
    || error.message !== `Cannot find package '${packageName}' imported from ${fileURLToPath(import.meta.url)}`) throw error;
  process.stderr.write(`[flow_design:dependency] Missing package "${packageName}". Install the dependencies declared in the Kit package.json before running Flow layout.\n`);
  process.exit(2);
}
let BpmnModdleModule;
try { BpmnModdleModule = await import('bpmn-moddle'); }
catch (error) { missingDirectDependency(error, 'bpmn-moddle'); }
let ELK;
try { ({ default: ELK } = await import('elkjs/lib/elk.bundled.js')); }
catch (error) { missingDirectDependency(error, 'elkjs'); }

// bpmn-moddle has shipped both default and named export across versions
// (v9 → default `SimpleBpmnModdle`, v10 → named `{ BpmnModdle }`). We
// accept either so deployments aren't tied to a single version.
const BpmnModdle =
  Reflect.get(BpmnModdleModule, 'BpmnModdle') ||
  Reflect.get(BpmnModdleModule, 'default') ||
  BpmnModdleModule;

// Default sizes per BPMN element kind — matches the conventions used by
// bpmn.io's editor + the prior SKILL.md examples. ELK uses these to
// allocate space; the FE renderer uses the same numbers natively.
const NODE_SIZE = {
  'bpmn:StartEvent':             { width: 36, height: 36 },
  'bpmn:EndEvent':               { width: 36, height: 36 },
  'bpmn:IntermediateCatchEvent': { width: 36, height: 36 },
  'bpmn:IntermediateThrowEvent': { width: 36, height: 36 },
  'bpmn:BoundaryEvent':          { width: 36, height: 36 },
  'bpmn:Task':                   { width: 100, height: 80 },
  'bpmn:UserTask':               { width: 100, height: 80 },
  'bpmn:ServiceTask':            { width: 100, height: 80 },
  'bpmn:ScriptTask':             { width: 100, height: 80 },
  'bpmn:ManualTask':             { width: 100, height: 80 },
  'bpmn:SendTask':               { width: 100, height: 80 },
  'bpmn:ReceiveTask':            { width: 100, height: 80 },
  'bpmn:CallActivity':           { width: 100, height: 80 },
  'bpmn:SubProcess':             { width: 100, height: 80 },
  'bpmn:ExclusiveGateway':       { width: 50, height: 50 },
  'bpmn:ParallelGateway':        { width: 50, height: 50 },
  'bpmn:InclusiveGateway':       { width: 50, height: 50 },
  'bpmn:EventBasedGateway':      { width: 50, height: 50 },
};
const DEFAULT_NODE_SIZE = { width: 100, height: 80 };

// BPMN DI is a derived presentation artifact. Persist the layout revision on
// the document for provenance. Merely reading an older revision must NOT
// migrate or rearrange it; only explicit authoring/re-layout runs this script.
const AUTOAGENT_LAYOUT_NAMESPACE = 'https://autoagent.ai/bpmn/layout';
const AUTOAGENT_LAYOUT_REVISION = '13';

// Search uses a deterministic expansion budget, not a wall-clock deadline.
// Measure end-to-end runtime separately; grid building also consumes time.

function sizeFor(elementType) {
  return NODE_SIZE[elementType] || DEFAULT_NODE_SIZE;
}

const elk = new ELK();
const moddle = new BpmnModdle();

const inputXml = readFileSync(0, 'utf8');
const validateOnly = process.argv.includes('--validate');

// ---- 1. Parse with bpmn-moddle -----------------------------------------
let definitions;
let parseWarnings = [];
try {
  const result = await moddle.fromXML(inputXml);
  definitions = result.rootElement;
  parseWarnings = result.warnings || [];
} catch (err) {
  process.stderr.write(`[bpmn-layout] parse failed: ${err.message}\n`);
  process.exit(2);
}
for (const w of parseWarnings) {
  process.stderr.write(`[bpmn-layout:parse-warn] ${w.message}\n`);
}

// bpmn-moddle deliberately recovers from some malformed extensions as
// warnings. That recovery is useful for inspecting legacy files, but it is
// not acceptable for a newly generated or edited design artifact: the
// frontend must be able to import exactly the model that we mark complete.
if (parseWarnings.length > 0) {
  process.stderr.write(
    `[bpmn-layout] validation rejected ${parseWarnings.length} parse warning(s)\n`,
  );
  process.exit(4);
}

// The same BPMN engine that lays out a diagram is the semantic authority for
// worker-produced XML. Validation intentionally happens before all layout
// assumptions, so callers can distinguish an invalid model from a temporary
// ELK/runtime failure.
if (validateOnly) {
  process.exit(0);
}

// ---- 2. Find process + extract structure -------------------------------
const collaboration = (definitions.rootElements || []).find(
  (e) => e.$type === 'bpmn:Collaboration',
);
const processes = (definitions.rootElements || []).filter(
  (e) => e.$type === 'bpmn:Process',
);
if (processes.length === 0) {
  process.stderr.write('[bpmn-layout] no bpmn:Process found in input\n');
  process.exit(3);
}
// Lay out the FIRST process (matches bpmn-auto-layout's documented behavior).
// AutoAgent's flow_design emits one process per .bpmn file so this is fine.
const process_ = processes[0];

const laneByNodeId = new Map();
let lanes = [];
for (const laneSet of process_.laneSets || []) {
  for (const lane of laneSet.lanes || []) {
    lanes.push(lane);
    for (const ref of lane.flowNodeRef || []) {
      laneByNodeId.set(ref.id, lane.id);
    }
  }
}

const flowElements = process_.flowElements || [];
// Canonicalize every topology-bearing collection before it reaches DFS or
// ELK. bpmn-moddle preserves XML declaration order, while model-generated
// BPMN may serialize the same graph in many equivalent orders. Layout is a
// derived artifact, so those permutations must produce identical DI.
const nodes = flowElements
  .filter((e) => e.$type !== 'bpmn:SequenceFlow')
  .sort((a, b) => a.id.localeCompare(b.id));
const edges = flowElements
  .filter((e) => e.$type === 'bpmn:SequenceFlow')
  .sort((a, b) => a.id.localeCompare(b.id));
const boundaryEvents = nodes.filter(
  (node) => node.$type === 'bpmn:BoundaryEvent' && node.attachedToRef,
);
const boundaryHostById = new Map(
  boundaryEvents.map((event) => [event.id, event.attachedToRef.id]),
);

// A boundary event belongs to its activity's lane even when the XML omits a
// redundant flowNodeRef for the event itself.  Treating it as an orphan and
// assigning it from its outgoing neighbour places timer/error markers in the
// exception handler's lane instead of on the activity boundary.
for (const event of boundaryEvents) {
  const hostLaneId = laneByNodeId.get(event.attachedToRef.id);
  if (hostLaneId) laneByNodeId.set(event.id, hostLaneId);
}

process.stderr.write(
  `[bpmn-layout] process=${process_.id} lanes=${lanes.length} ` +
    `nodes=${nodes.length} edges=${edges.length}\n`,
);

// ---- 2b. Pre-flight orphan-node repair ---------------------------------
// Common LLM failure mode: the model defines a flow node in
// <bpmn:process> body AND references it from a <bpmn:sequenceFlow>, but
// forgets to add it to any <bpmn:lane>/<bpmn:flowNodeRef>. ELK uses lanes
// as hierarchical containers — when an edge references a node not found
// in any lane subtree, ELK throws "Referenced shape does not exist" and
// the whole layout fails. flow_design SKILL.md "Pre-Output Structural
// Checklist" rule already demands "every flow node id appears in exactly
// one lane's flowNodeRef", but Kimi-K2 / Sonnet violate it on long files.
//
// Rather than fail the layout, auto-attach each orphan to the lane it
// most plausibly belongs to: prefer a lane already containing one of the
// orphan's edge neighbors (most LLM-orphans connect to existing lane
// members); fall back to the first lane when no neighbor signal exists.
// Mutating the moddle tree before ELK build means downstream containers
// (laneByNodeId, lane.children, BPMNShape parenting) all see the fix.
if (lanes.length > 0) {
  const orphans = nodes.filter((n) => !laneByNodeId.has(n.id));
  for (const orphan of orphans) {
    let neighborLane = null;
    for (const edge of edges) {
      const srcId = edge.sourceRef && edge.sourceRef.id;
      const tgtId = edge.targetRef && edge.targetRef.id;
      if (srcId === orphan.id && laneByNodeId.has(tgtId)) {
        neighborLane = laneByNodeId.get(tgtId);
        break;
      }
      if (tgtId === orphan.id && laneByNodeId.has(srcId)) {
        neighborLane = laneByNodeId.get(srcId);
        break;
      }
    }
    const chosenLaneId = neighborLane || lanes[0].id;
    const chosenLane = lanes.find((l) => l.id === chosenLaneId);
    if (!chosenLane) continue;
    chosenLane.flowNodeRef = chosenLane.flowNodeRef || [];
    chosenLane.flowNodeRef.push(orphan);
    laneByNodeId.set(orphan.id, chosenLaneId);
    process.stderr.write(
      `[bpmn-layout:repair] orphan ${orphan.$type}#${orphan.id} → ` +
        `attached to lane ${chosenLaneId} ` +
        `(via ${neighborLane ? 'neighbor' : 'first-lane-fallback'})\n`,
    );
  }
}

const hasAuthoredSwimlanes = lanes.length > 0;
const SYNTHETIC_LANE_ID = '__autoagent_laneless__';
if (!hasAuthoredSwimlanes) {
  const syntheticLane = { id: SYNTHETIC_LANE_ID, name: '', flowNodeRef: [...nodes] };
  lanes = [syntheticLane];
  for (const node of nodes) laneByNodeId.set(node.id, SYNTHETIC_LANE_ID);
}

// ---- 3. Build + run layout (lane-aware) --------------------------------
// Two-phase strategy because elkjs lacks a true swimlane primitive:
//   Phase 1 — lanes first. Each lane gets its OWN ELK layered RIGHT
//             layout over its intra-lane subgraph. Lane Y positions are
//             then assigned manually (stacked top-to-bottom in laneSet
//             order); lane widths are unified to the max content width
//             so every lane spans the full diagram horizontally.
//   Phase 2 — cross-lane edges. ELK only routed edges whose source AND
//             target were inside the same lane's sub-layout. Edges
//             crossing lanes get Manhattan-routed in this script: dock
//             at right-mid of source → vertical run through the gap →
//             horizontal align with target → dock at left-mid of target.
//
// Why the previous one-graph + partitioning attempt failed: elkjs
// ignores `org.eclipse.elk.partitioning.activate`, so all nodes ended
// up on the same Y band. Hierarchy-compound layout collapsed the same
// way whenever the flow re-entered a lane (Student → System → Student
// loops produce nested lane bounds). The only reliable path with the
// elkjs feature set is to take lane placement out of ELK's hands.
const lanePadding = { top: 30, left: 30, bottom: 30, right: 30 };
// Lanes inside a Participant frame tile the frame edge-to-edge — no gap
// between consecutive lanes, no outer padding around the lane stack.
// The Participant rectangle IS the union of the lane rectangles. This is
// the standard BPMN swimlane convention; visual gaps between lanes are a
// reliable "this layout is broken" signal to users.
const LANE_GAP = 0;
// bpmn-js renders a Participant with a left header strip (~30px) for the
// rotated participant label.  Lanes sit INSIDE the Participant content
// area, so every Lane (and its children / edges) must be offset by this
// amount.  We apply it uniformly in Section 6 (DI output), leaving the
// internal layout math untouched.
const PARTICIPANT_HEADER_WIDTH = 30;
const LANE_HEADER_HEIGHT = 42;
const CROSS_EDGE_PAD = 20;     // dock-stub length on cross-lane edges
// Keep layout coordinates intrinsic to the process. The frontend owns the
// actual viewport and uses bpmn-js's fit-viewport; stretching a diagram to a
// presumed canvas aspect makes dense swimlane diagrams unreadable elsewhere.
const baseLayered = {
  'elk.algorithm': 'org.eclipse.elk.layered',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.spacing.nodeNode': '40',
  'elk.padding': '[top=30,left=30,bottom=30,right=30]',
  'elk.edgeRouting': 'ORTHOGONAL',
};

function elkNodeForFlowNode(flowNode) {
  const size = sizeFor(flowNode.$type);
  return {
    id: flowNode.id,
    width: size.width,
    height: size.height,
    layoutOptions: { 'elk.portConstraints': 'FREE' },
  };
}

function edgeForElk(edge) {
  return {
    id: edge.id,
    sources: [edge.sourceRef.id],
    targets: [edge.targetRef.id],
  };
}

function simplifyWaypoints(points) {
  const compact = [];
  for (const point of points || []) {
    const previous = compact[compact.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    compact.push(point);
    while (compact.length >= 3) {
      const a = compact[compact.length - 3];
      const b = compact[compact.length - 2];
      const c = compact[compact.length - 1];
      const continuesVertically = a.x === b.x && b.x === c.x &&
        (b.y - a.y) * (c.y - b.y) >= 0;
      const continuesHorizontally = a.y === b.y && b.y === c.y &&
        (b.x - a.x) * (c.x - b.x) >= 0;
      // Preserve a collinear reversal. It is not a redundant waypoint: the
      // turn proves that the route approached an endpoint from its outward
      // side. Removing it can collapse the final segment through the node.
      if (continuesVertically || continuesHorizontally) {
        compact.splice(compact.length - 2, 1);
      } else {
        break;
      }
    }
  }
  return compact;
}

const shapeBounds = new Map();
const edgeWaypoints = new Map();
// Cumulative lane offset state — populated as we walk lanes in order.
const laneAbsBounds = new Map(); // lane.id → {x, y, width, height}
let layoutDirection = 'DOWN';
let swimlanesAreHorizontal = false;
let diagramOffset = { x: 0, y: PARTICIPANT_HEADER_WIDTH };

function placeBoundaryEventsOnHosts() {
  const eventsByHost = new Map();
  for (const event of boundaryEvents) {
    const hostId = boundaryHostById.get(event.id);
    if (!eventsByHost.has(hostId)) eventsByHost.set(hostId, []);
    eventsByHost.get(hostId).push(event);
  }
  for (const [hostId, hostEvents] of eventsByHost) {
    const host = shapeBounds.get(hostId);
    if (!host) continue;
    hostEvents.sort((a, b) => a.id.localeCompare(b.id));
    const markerWidth = sizeFor(hostEvents[0].$type).width;
    const usableSpan = host.width - markerWidth;
    const requiredSpan = (hostEvents.length - 1) * (markerWidth + 8);
    const span = hostEvents.length === 1 ? 0 : Math.max(usableSpan, requiredSpan);
    const firstCenterX = host.x + host.width / 2 - span / 2;
    for (const [index, event] of hostEvents.entries()) {
      const size = sizeFor(event.$type);
      const centerX = hostEvents.length === 1
        ? host.x + host.width / 2
        : firstCenterX + (span * index) / (hostEvents.length - 1);
      shapeBounds.set(event.id, {
        x: centerX - size.width / 2,
        y: host.y + host.height - size.height / 2,
        width: size.width,
        height: size.height,
      });
    }
  }
}

function laneSpanCost(order) {
  const position = new Map(order.map((lane, index) => [lane.id, index]));
  let cost = 0;
  for (const edge of edges) {
    const sourceLane = laneByNodeId.get(edge.sourceRef.id);
    const targetLane = laneByNodeId.get(edge.targetRef.id);
    if (!sourceLane || !targetLane || sourceLane === targetLane) continue;
    cost += Math.abs(position.get(sourceLane) - position.get(targetLane));
  }
  return cost;
}

function canonicalLaneOrder(sourceLanes) {
  if (sourceLanes.length < 2) return [...sourceLanes];
  const stable = [...sourceLanes].sort((a, b) => a.id.localeCompare(b.id));
  const startLaneId = laneByNodeId.get(
    nodes.find((node) => node.$type === 'bpmn:StartEvent')?.id,
  );
  const anchor = stable.find((lane) => lane.id === startLaneId) || stable[0];
  const movable = stable.filter((lane) => lane.id !== anchor.id);

  if (stable.length <= 7) {
    let best = null;
    function visit(prefix, remaining) {
      if (remaining.length === 0) {
        const candidate = [anchor, ...prefix];
        const score = laneSpanCost(candidate);
        const key = candidate.map((lane) => lane.id).join('|');
        if (!best || score < best.score || (score === best.score && key < best.key)) {
          best = { candidate, score, key };
        }
        return;
      }
      for (let index = 0; index < remaining.length; index += 1) {
        visit(
          [...prefix, remaining[index]],
          [...remaining.slice(0, index), ...remaining.slice(index + 1)],
        );
      }
    }
    visit([], movable);
    return best.candidate;
  }

  // Deterministic barycenter sweep for unusually large role sets. The
  // initiating lane remains the reading anchor; every tie falls back to id.
  let ordered = [anchor, ...movable];
  for (let sweep = 0; sweep < 8; sweep += 1) {
    const position = new Map(ordered.map((lane, index) => [lane.id, index]));
    const barycenter = new Map();
    for (const lane of movable) {
      const neighbours = [];
      for (const edge of edges) {
        const sourceLane = laneByNodeId.get(edge.sourceRef.id);
        const targetLane = laneByNodeId.get(edge.targetRef.id);
        if (sourceLane === lane.id && targetLane !== lane.id && position.has(targetLane)) {
          neighbours.push(position.get(targetLane));
        } else if (targetLane === lane.id && sourceLane !== lane.id && position.has(sourceLane)) {
          neighbours.push(position.get(sourceLane));
        }
      }
      barycenter.set(
        lane.id,
        neighbours.length > 0
          ? neighbours.reduce((sum, value) => sum + value, 0) / neighbours.length
          : position.get(lane.id),
      );
    }
    ordered = [
      anchor,
      ...movable.sort((a, b) =>
        barycenter.get(a.id) - barycenter.get(b.id) || a.id.localeCompare(b.id),
      ),
    ];
  }
  return ordered;
}

const hasSwimlanes = lanes.length > 0;
const t0 = Date.now();

if (hasSwimlanes) {
  // Phase 0 — detect feedback (back-)edges so we can strip them from
  // the layered-pass input. BPMN loopback edges (gateway → target that
  // re-enters an earlier step, e.g. "validation fails → retry input")
  // create cycles. ELK's layered algorithm handles cycles by reversing
  // SOME edge in each cycle — but its choice is opaque and often
  // produces visually surprising layerings (the "final" step landing
  // far left, the "first attempt" step landing far right). Removing
  // the back-edges before layout gives ELK a clean DAG; we then route
  // those edges manually as U-shape loopbacks in the edge pass below.
  //
  // Detection is SCC-based rather than DFS-stack based. A DFS can break an
  // approval cycle at an arbitrary edge selected by id/declaration order;
  // SCCs first isolate genuine cycles, then shortest distance from the start
  // identifies the edge(s) that return to an earlier business step.
  const topologyNodeId = (nodeId) => boundaryHostById.get(nodeId) || nodeId;
  const topologyNodes = nodes.filter((node) => !boundaryHostById.has(node.id));
  // Shared semantic detection: the metrics ruler classifies feedback edges
  // with the exact same function, so extraBend is measured identically on
  // both sides of the regression harness.
  const feedbackEdgeIds = detectFeedbackEdges(
    nodes.map((node) => ({ id: node.id, type: node.$type })),
    edges.map((edge) => ({ id: edge.id, sourceId: edge.sourceRef.id, targetId: edge.targetRef.id })),
    boundaryHostById,
  );
  if (feedbackEdgeIds.size > 0) {
    process.stderr.write(
      `[bpmn-layout] detected ${feedbackEdgeIds.size} feedback edge(s): ` +
        `${[...feedbackEdgeIds].join(',')}\n`,
    );
  }

  // Phase 1 — GLOBAL ELK layered pass over ALL nodes and FORWARD edges
  // only (feedbacks stripped). We discard ELK's Y output entirely and
  // keep only the X coordinate per node. This ensures the layered
  // ordering reflects the full topology — including cross-lane edges —
  // so an end-event in lane L whose only incoming edge crosses from
  // lane M still gets its X placed AFTER M's nodes (= far right of
  // the diagram). Without this, per-lane ELK runs put orphan-by-lane
  // nodes (those whose only edges leave their lane) at arbitrary X,
  // typically the lane's top-left.
  const forwardEdges = edges.filter((e) => !feedbackEdgeIds.has(e.id));
  // ELK's network-simplex layer assignment may intentionally delay a short
  // branch so it rejoins near a longer sibling.  In a process diagram that
  // turns an otherwise direct gateway branch into a line that runs through
  // the sibling task.  Compute the semantic topological rank independently:
  // every forward edge advances at least one row, while ELK remains
  // responsible for deterministic order within a row.
  const rankedNodes = nodes.filter((node) => !boundaryHostById.has(node.id));
  const forwardIncoming = new Map(rankedNodes.map((node) => [node.id, 0]));
  const forwardOutgoing = new Map(rankedNodes.map((node) => [node.id, []]));
  for (const edge of forwardEdges) {
    const sourceId = boundaryHostById.get(edge.sourceRef.id) || edge.sourceRef.id;
    const targetId = boundaryHostById.get(edge.targetRef.id) || edge.targetRef.id;
    if (sourceId === targetId || !forwardOutgoing.has(sourceId) || !forwardIncoming.has(targetId)) {
      continue;
    }
    forwardOutgoing.get(sourceId).push(targetId);
    forwardIncoming.set(targetId, forwardIncoming.get(targetId) + 1);
  }
  for (const targets of forwardOutgoing.values()) targets.sort();
  const rankReady = rankedNodes
    .filter((node) => forwardIncoming.get(node.id) === 0)
    .map((node) => node.id)
    .sort();
  const semanticRank = new Map(rankedNodes.map((node) => [node.id, 0]));
  const rankedNodeIds = new Set();
  while (rankReady.length > 0) {
    const sourceId = rankReady.shift();
    rankedNodeIds.add(sourceId);
    for (const targetId of forwardOutgoing.get(sourceId)) {
      semanticRank.set(
        targetId,
        Math.max(semanticRank.get(targetId), semanticRank.get(sourceId) + 1),
      );
      forwardIncoming.set(targetId, forwardIncoming.get(targetId) - 1);
      if (forwardIncoming.get(targetId) === 0) {
        rankReady.push(targetId);
        rankReady.sort();
      }
    }
  }
  if (rankedNodeIds.size !== rankedNodes.length) {
    const unresolved = rankedNodes
      .map((node) => node.id)
      .filter((nodeId) => !rankedNodeIds.has(nodeId))
      .sort();
    throw new Error(
      `feedback normalization left a cyclic forward graph: ${unresolved.join(',')}`,
    );
  }
  for (const [eventId, hostId] of boundaryHostById) {
    semanticRank.set(eventId, semanticRank.get(hostId) || 0);
  }
  lanes = canonicalLaneOrder(lanes);
  // Flow Design uses one stable reading convention: top-to-bottom process
  // progression with vertical swimlanes.  Direction is a product-level
  // convention, not a per-diagram viewport guess; mixing RIGHT and DOWN in
  // one design set makes cross-process comparison needlessly expensive.
  layoutDirection = 'DOWN';
  swimlanesAreHorizontal = false;
  diagramOffset = hasAuthoredSwimlanes
    ? { x: 0, y: PARTICIPANT_HEADER_WIDTH }
    : { x: 0, y: 0 };
  process.stderr.write(
    `[bpmn-layout] direction=${layoutDirection} laneOrder=` +
      `${lanes.map((lane) => lane.id).join('>')}\n`,
  );
  const globalGraph = {
    id: 'global',
    layoutOptions: {
      ...baseLayered,
      'elk.direction': layoutDirection,
      ...(layoutDirection === 'DOWN'
        ? { 'elk.layered.spacing.nodeNodeBetweenLayers': '40' }
        : {}),
    },
    children: topologyNodes.map(elkNodeForFlowNode),
    edges: forwardEdges
      .map((edge) => ({
        id: edge.id,
        sources: [topologyNodeId(edge.sourceRef.id)],
        targets: [topologyNodeId(edge.targetRef.id)],
      }))
      .filter((edge) => edge.sources[0] !== edge.targets[0]),
  };
  let globalOut;
  try {
    globalOut = await elk.layout(globalGraph);
  } catch (err) {
    process.stderr.write(`[bpmn-layout] global layered failed: ${err.message}\n`);
    process.exit(4);
  }
  // Capture the global X ordering.  A global layered pass is still needed so
  // cross-lane dependencies place their targets after their sources.  Its Y
  // coordinates, however, describe one flattened graph; reusing them inside
  // every individual lane needlessly imports vertical gaps from other lanes
  // and makes a multi-lane diagram shrink to unreadable text on fit.
  const nodePosById = new Map();
  for (const child of globalOut.children || []) {
    nodePosById.set(child.id, { x: child.x || 0, y: child.y || 0 });
  }

  if (layoutDirection === 'DOWN') {
    // Native vertical swimlanes: lanes are columns and the primary process
    // axis is ELK DOWN. This is not a coordinate transpose: node dimensions,
    // docking faces, lane containment and loopback routing are all computed
    // in their final orientation.
    const TRACK_GAP = 30;
    const TRACK_CLEARANCE_Y = 30;
    const activeLaneHeaderHeight = hasAuthoredSwimlanes ? LANE_HEADER_HEIGHT : 0;
    // Named sequence flows need a real annotation band between ranks. A 30px
    // gap only fits the smallest one-line label with no breathing room and
    // turns ordinary orthogonal connectors into tiny elbows. Keep enough
    // vertical clearance for a two-line label plus routing separation.
    const ROW_GAP = 56;
    const rankHeight = new Map();
    for (const node of rankedNodes) {
      const size = sizeFor(node.$type);
      const boundaryOverhang = boundaryEvents.some(
        (event) => boundaryHostById.get(event.id) === node.id,
      )
        ? Math.max(...boundaryEvents
            .filter((event) => boundaryHostById.get(event.id) === node.id)
            .map((event) => sizeFor(event.$type).height / 2))
        : 0;
      const rank = semanticRank.get(node.id);
      rankHeight.set(rank, Math.max(rankHeight.get(rank) || 0, size.height + boundaryOverhang));
    }
    const rankY = new Map();
    let rankCursorY = 0;
    for (const rank of [...rankHeight.keys()].sort((a, b) => a - b)) {
      rankY.set(rank, rankCursorY);
      rankCursorY += rankHeight.get(rank) + ROW_GAP;
    }
    const laneContentExtents = new Map();
    for (const lane of lanes) {
      const laneNodeIds = new Set((lane.flowNodeRef || []).map((ref) => ref.id));
      const laneNodes = nodes.filter(
        (node) => laneNodeIds.has(node.id) && !boundaryHostById.has(node.id),
      );
      if (laneNodes.length === 0) {
        laneContentExtents.set(lane.id, {
          contentWidth: 100,
          xByNodeId: new Map(),
          yByNodeId: new Map(),
        });
        continue;
      }
      const orderedNodes = [...laneNodes].sort((a, b) => {
        const aPos = nodePosById.get(a.id) || { x: 0, y: 0 };
        const bPos = nodePosById.get(b.id) || { x: 0, y: 0 };
        return (
          semanticRank.get(a.id) - semanticRank.get(b.id) ||
          aPos.x - bPos.x ||
          a.id.localeCompare(b.id)
        );
      });
      const tracks = [];
      const yByNodeId = new Map();
      for (const node of orderedNodes) {
        const size = sizeFor(node.$type);
        const nodeY = rankY.get(semanticRank.get(node.id));
        let track = tracks.find((candidate) =>
          nodeY >= candidate.bottom + TRACK_CLEARANCE_Y,
        );
        if (!track) {
          track = { bottom: -Infinity, width: 0, nodes: [] };
          tracks.push(track);
        }
        track.bottom = nodeY + size.height;
        track.width = Math.max(track.width, size.width);
        track.nodes.push(node);
        yByNodeId.set(node.id, nodeY);
      }
      const xByNodeId = new Map();
      let contentWidth = 0;
      for (const track of tracks) {
        for (const node of track.nodes) {
          const size = sizeFor(node.$type);
          // A track is a visual process spine. Center events, gateways and
          // activities on that spine instead of sharing their left edge;
          // otherwise every 36→50→100px shape transition creates a pair of
          // tiny, meaningless elbows.
          xByNodeId.set(node.id, contentWidth + (track.width - size.width) / 2);
        }
        contentWidth += track.width + TRACK_GAP;
      }
      laneContentExtents.set(lane.id, {
        contentWidth: Math.max(100, contentWidth - TRACK_GAP),
        xByNodeId,
        yByNodeId,
      });
    }

    const maxBottom = Math.max(
      0,
      ...nodes.filter((node) => !boundaryHostById.has(node.id)).map((node) => {
        const extent = laneContentExtents.get(laneByNodeId.get(node.id));
        const y = extent?.yByNodeId.get(node.id) ?? rankY.get(semanticRank.get(node.id));
        return y + sizeFor(node.$type).height;
      }),
    );
    const fullHeight = activeLaneHeaderHeight + lanePadding.top + maxBottom + lanePadding.bottom;
    const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
    const loopbackEdges = edges.filter((edge) => {
      if (feedbackEdgeIds.has(edge.id)) return true;
      const source = nodePosById.get(edge.sourceRef.id);
      const target = nodePosById.get(edge.targetRef.id);
      return source && target && target.y < source.y;
    });
    const LOOPBACK_MARGIN = 25;
    const LOOPBACK_TRACK_GAP = 20;
    const LOOPBACK_EDGE_INSET = 15;
    let leftCount = 0;
    let rightCount = 0;
    const sideIntervals = { left: [], right: [] };
    for (const edge of loopbackEdges) {
      const sourceLane = laneIndex.get(laneByNodeId.get(edge.sourceRef.id));
      const targetLane = laneIndex.get(laneByNodeId.get(edge.targetRef.id));
      let preferredSide;
      if (targetLane < sourceLane) preferredSide = 'left';
      else if (targetLane > sourceLane) preferredSide = 'right';
      else preferredSide = sourceLane < lanes.length / 2 ? 'left' : 'right';
      const sourceY = nodePosById.get(edge.sourceRef.id)?.y || 0;
      const targetY = nodePosById.get(edge.targetRef.id)?.y || 0;
      const interval = [Math.min(sourceY, targetY), Math.max(sourceY, targetY)];
      const sideScore = (side) => {
        const overlaps = sideIntervals[side].filter(
          ([start, end]) => interval[0] < end && interval[1] > start,
        ).length;
        return overlaps * 100 + (side === preferredSide ? 0 : 1) + sideIntervals[side].length * 0.01;
      };
      const side = sideScore('left') <= sideScore('right') ? 'left' : 'right';
      // Estimate exterior breathing room only; no edge is forced into it.
      if (side === 'left') leftCount++; else rightCount++;
      sideIntervals[side].push(interval);
    }
    const leftChannelSpace = leftCount > 0
      ? LOOPBACK_EDGE_INSET + LOOPBACK_MARGIN + (leftCount - 1) * LOOPBACK_TRACK_GAP
      : 0;
    const rightChannelSpace = rightCount > 0
      ? LOOPBACK_EDGE_INSET + LOOPBACK_MARGIN + (rightCount - 1) * LOOPBACK_TRACK_GAP
      : 0;

    let cumulativeX = 0;
    for (const [currentLaneIndex, lane] of lanes.entries()) {
      const extent = laneContentExtents.get(lane.id);
      const laneLeftGutter = currentLaneIndex === 0 ? leftChannelSpace : 0;
      const laneRightGutter = currentLaneIndex === lanes.length - 1
        ? rightChannelSpace
        : 0;
      const laneWidth = laneLeftGutter + lanePadding.left + extent.contentWidth +
        lanePadding.right + laneRightGutter;
      const laneNodeIds = new Set((lane.flowNodeRef || []).map((ref) => ref.id));
      const contentOffsetX = cumulativeX + laneLeftGutter + lanePadding.left;
      for (const node of nodes.filter((candidate) => laneNodeIds.has(candidate.id))) {
        const size = sizeFor(node.$type);
        shapeBounds.set(node.id, {
          x: contentOffsetX + (extent.xByNodeId.get(node.id) || 0),
          y: activeLaneHeaderHeight + lanePadding.top + (extent.yByNodeId.get(node.id) || 0),
          width: size.width,
          height: size.height,
        });
      }
      laneAbsBounds.set(lane.id, {
        x: cumulativeX,
        y: 0,
        width: laneWidth,
        height: fullHeight,
      });
      cumulativeX += laneWidth + LANE_GAP;
    }

    // Boundary events are presentation children of their attached activity,
    // not independent boxes in the layered lane tracks.  ELK still sees them
    // while ranking their exception path; DI pins the marker to the bottom
    // edge of the host after the host itself has been placed.
    placeBoundaryEventsOnHosts();

    // Phase R — joint layout+routing search. The seed (global rank + per-lane
    // track packing) is a starting point, not a verdict: one measurable cost
    // over node positions, lane geometry and edge routes drives
    // propose -> measure -> accept-or-rollback until convergence or budget.
    // Fixed rules only seed; they never patch the result afterwards.
    const searchNodes = [...shapeBounds]
      .map(([id, bounds]) => ({
        id,
        laneId: laneByNodeId.get(id) || null,
        bounds: { ...bounds },
        ...(boundaryHostById.has(id)
          ? {
            rowKey: Math.round(shapeBounds.get(boundaryHostById.get(id)).y),
            attachTo: boundaryHostById.get(id),
          }
          : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const searchLanes = lanes.map((lane, index) => ({
      id: lane.id,
      index,
      bounds: { ...laneAbsBounds.get(lane.id) },
    }));
    const searchEdges = edges
      .map((edge) => ({
        id: edge.id,
        sourceId: edge.sourceRef && edge.sourceRef.id,
        targetId: edge.targetRef && edge.targetRef.id,
        feedback: feedbackEdgeIds.has(edge.id),
      }))
      .filter((edge) => edge.sourceId && edge.targetId)
      .sort((a, b) => a.id.localeCompare(b.id));
    const seedModel = {
      nodes: searchNodes.map((n) => ({ id: n.id, bounds: n.bounds })),
      edges: searchEdges,
      budget: { remaining: 900000 },
    };
    const phaseT0 = Date.now();
    const seedGrid = gridFor(seedModel);
    const seedRouteMap = new Map();
    seedRoutes(seedModel, seedGrid, seedRouteMap);
    const phaseT1 = Date.now();
    const seedState = {
      nodes: searchNodes, edges: searchEdges, lanes: searchLanes, routes: seedRouteMap,
    };
    const descended = routeDescent(seedState, seedGrid, 6);
    const policy=layoutPolicy();
    const reportingObjective = (policy.reading || policy.report) ? createReadingObjective(descended.state, {
      preference: policy.preference, seedCost: descended.cost,
    }) : undefined;
    const readingObjective = policy.reading ? reportingObjective : undefined;
    const experimentalBudget = policy.boundedSearch;
    const phaseT2 = Date.now();
    const searched = jointSearch(descended.state, {
      maxPasses: experimentalBudget ? 3 : 5,
      maxMovesPerPass: experimentalBudget ? 36 : 60,
      maxExpansions: experimentalBudget ? 600000 : 2000000,
      objective: readingObjective,
      trace: process.env.BPMN_LAYOUT_TRACE ? true : null,
    });
    if (searched.trace) {
      for (const entry of searched.trace) {
        process.stderr.write(`[bpmn-layout] trace p${entry.pass} ${entry.accepted ? 'ACCEPT' : 'reject'} ${entry.move} -> ${entry.total}\n`);
      }
    }
    // Final route polish at the settled geometry: layout moves change which
    // corridors are free, so descent runs again after the search converges.
    const finalGrid = gridFor({
      nodes: searched.state.nodes.map((n) => ({ id: n.id, bounds: n.bounds })),
      budget: { remaining: 900000 },
    });
    const phaseT3 = Date.now();
    let polished = routeDescent(searched.state, finalGrid, 3, readingObjective);
    let channels;
    if (policy.channels) {
      const spaced=spaceChannels(polished.state,{allowsCost:readingObjective?.allowsCost});
      polished=spaced;channels=spaced.metrics;
    }
    if (readingObjective || policy.report) {
      const o=reportingObjective;
      process.stderr.write(`[bpmn-layout] reading-metrics ${JSON.stringify({preference:o.preference,groups:o.groups.length,seedDeviation:o.error(descended.state),seedMeanDeviation:o.alignment(descended.state),deviation:o.error(polished.state),meanDeviation:o.alignment(polished.state),reading:o.reading(polished.state,polished.cost),routing:o.routing(polished.cost),seedCrossings:descended.cost.counts.crossing,crossings:polished.cost.counts.crossing,channelCrowding:channelCrowding(polished.state).severity,...(channels?{channels}: {})})}\n`);
    }
    process.stderr.write(
      `[bpmn-layout] phase ms: seed=${phaseT1 - phaseT0} descent=${phaseT2 - phaseT1} ` +
        `search=${phaseT3 - phaseT2} polish=${Date.now() - phaseT3}\n`,
    );
    for (const node of polished.state.nodes) shapeBounds.set(node.id, { ...node.bounds });
    for (const lane of polished.state.lanes) laneAbsBounds.set(lane.id, { ...lane.bounds });
    for (const edge of searchEdges) {
      const waypoints = polished.state.routes.get(edge.id);
      if (waypoints && waypoints.length >= 2) edgeWaypoints.set(edge.id, waypoints);
    }
    process.stderr.write(
      `[bpmn-layout] joint search: seed=${Math.round(searched.history[0].total)} -> ` +
        `${Math.round(polished.cost.total)} in ${searched.history.length - 1} accepted moves\n`,
    );
  }

} else {
  // No-lane / single-lane path: ELK lays the whole graph out flat.
  const elkGraph = {
    id: 'root',
    layoutOptions: { ...baseLayered, 'elk.direction': 'DOWN' },
    children: nodes.map(elkNodeForFlowNode),
    edges: edges.map(edgeForElk),
  };
  let laidOut;
  try {
    laidOut = await elk.layout(elkGraph);
  } catch (err) {
    process.stderr.write(`[bpmn-layout] elk.layout failed: ${err.message}\n`);
    process.exit(4);
  }
  for (const child of laidOut.children || []) {
    shapeBounds.set(child.id, {
      x: child.x || 0,
      y: child.y || 0,
      width: child.width,
      height: child.height,
    });
  }
  for (const event of boundaryEvents) {
    const host = shapeBounds.get(boundaryHostById.get(event.id));
    if (!host) continue;
    const size = sizeFor(event.$type);
    shapeBounds.set(event.id, {
      x: host.x + host.width / 2 - size.width / 2,
      y: host.y + host.height - size.height / 2,
      width: size.width,
      height: size.height,
    });
  }
  for (const edge of laidOut.edges || []) {
    const wps = [];
    for (const section of edge.sections || []) {
      wps.push({ x: section.startPoint.x, y: section.startPoint.y });
      for (const bp of section.bendPoints || []) wps.push({ x: bp.x, y: bp.y });
      wps.push({ x: section.endPoint.x, y: section.endPoint.y });
    }
    edgeWaypoints.set(edge.id, simplifyWaypoints(wps));
  }
}

// A spent routing budget must fail loudly, never publish a partial diagram:
// every sequence flow needs visible geometry or the output is a lie.
const unrouted = edges.filter((edge) => !(edgeWaypoints.get(edge.id)?.length >= 2));
if (unrouted.length > 0) {
  process.stderr.write(
    `[bpmn-layout] routing incomplete: ${unrouted.map((edge) => edge.id).join(',')} ` +
      `have no waypoints; refusing to emit a partial diagram\n`,
  );
  process.exit(6);
}

process.stderr.write(
  `[bpmn-layout] computed: ${shapeBounds.size} shapes, ${edgeWaypoints.size} edges\n`,
);

// ---- 6. Inject BPMNDiagram + BPMNShape + BPMNEdge into the moddle tree -
const planeBpmnElement = collaboration || process_;
const bpmnPlane = moddle.create('bpmndi:BPMNPlane', {
  id: `BPMNPlane_${process_.id}`,
  bpmnElement: planeBpmnElement,
  planeElement: [],
});

// Participant shape (if collaboration) — exactly equals the union of
// lane bounds. NO outer padding: the BPMN swimlane convention is that
// the Participant rectangle IS the lane stack, edge to edge. Any
// padding here would re-introduce a visible gap between the Participant
// border and the topmost/bottommost lane.
// The width is extended by PARTICIPANT_HEADER_WIDTH so the left header
// strip doesn't overlap with the lanes inside.
if (collaboration) {
  for (const participant of collaboration.participants || []) {
    const laneList = [...laneAbsBounds.values()];
    const allBounds = laneList.length > 0
      ? laneList
      : [...shapeBounds.values()];
    if (allBounds.length === 0) continue;
    const maxX = Math.max(...allBounds.map((b) => b.x + b.width));
    const maxY = Math.max(...allBounds.map((b) => b.y + b.height));
    bpmnPlane.planeElement.push(
      moddle.create('bpmndi:BPMNShape', {
        id: `${participant.id}_di`,
        bpmnElement: participant,
        isHorizontal: swimlanesAreHorizontal,
        bounds: moddle.create('dc:Bounds', {
          x: Math.min(...allBounds.map((b) => b.x)),
          y: Math.min(...allBounds.map((b) => b.y)),
          width:
            maxX - Math.min(...allBounds.map((b) => b.x)) +
            (swimlanesAreHorizontal ? PARTICIPANT_HEADER_WIDTH : 0),
          height:
            maxY - Math.min(...allBounds.map((b) => b.y)) +
            (swimlanesAreHorizontal ? 0 : PARTICIPANT_HEADER_WIDTH),
        }),
      }),
    );
  }
}

// Lane shapes — emit pre-computed lane bounds from the per-lane stacking
// phase. All lanes share the same X / width by construction; Y / height
// are each lane's own ELK content extent.
// Lanes are offset by PARTICIPANT_HEADER_WIDTH so they sit inside the
// Participant's content area (after the left header strip).
for (const lane of lanes) {
  // The synthetic lane is an internal layout partition for lane-less BPMN.
  // It has no semantic bpmn:lane element and therefore must never leak into
  // BPMN DI as a bpmnElement reference.
  if (lane.id === SYNTHETIC_LANE_ID) continue;
  const bounds = laneAbsBounds.get(lane.id);
  if (!bounds) continue;
  bpmnPlane.planeElement.push(
    moddle.create('bpmndi:BPMNShape', {
      id: `${lane.id}_di`,
      bpmnElement: lane,
      isHorizontal: swimlanesAreHorizontal,
      bounds: moddle.create('dc:Bounds', {
        x: bounds.x + diagramOffset.x,
        y: bounds.y + diagramOffset.y,
        width: bounds.width,
        height: bounds.height,
      }),
    }),
  );
}

// Flow node shapes.
// Offset by PARTICIPANT_HEADER_WIDTH to sit inside lanes.
for (const node of nodes) {
  const b = shapeBounds.get(node.id);
  if (!b) continue;
  const isGateway = node.$type.endsWith('Gateway');
  bpmnPlane.planeElement.push(
    moddle.create('bpmndi:BPMNShape', {
      id: `${node.id}_di`,
      bpmnElement: node,
      bounds: moddle.create('dc:Bounds', {
        x: Math.round(b.x + diagramOffset.x),
        y: Math.round(b.y + diagramOffset.y),
        width: Math.round(b.width),
        height: Math.round(b.height),
      }),
      ...(isGateway ? { isMarkerVisible: true } : {}),
    }),
  );
}


// Sequence flow edges with proper docking from ELK. Geometry is offset by the
// participant header on the same axes as the node and lane shapes.
for (const edge of edges) {
  const wps = edgeWaypoints.get(edge.id);
  if (!wps || wps.length < 2) continue;
  bpmnPlane.planeElement.push(
    moddle.create('bpmndi:BPMNEdge', {
      id: `${edge.id}_di`,
      bpmnElement: edge,
      waypoint: wps.map((p) =>
        moddle.create('dc:Point', {
          x: Math.round(p.x + diagramOffset.x),
          y: Math.round(p.y + diagramOffset.y),
        }),
      ),
    }),
  );
}

const bpmnDiagram = moddle.create('bpmndi:BPMNDiagram', {
  id: `BPMNDiagram_${process_.id}`,
  plane: bpmnPlane,
});
// External event/gateway names occupy space as well as branch labels. Place
// both against final node and wire geometry, not just other branch labels.
const labelNodes = bpmnPlane.planeElement.filter(element =>
  element.$type === 'bpmndi:BPMNShape' &&
  !['bpmn:Lane', 'bpmn:Participant'].includes(element.bpmnElement.$type),
).sort((a, b) => a.bpmnElement.id.localeCompare(b.bpmnElement.id));
const labelLanes = bpmnPlane.planeElement.filter(element => element.bpmnElement.$type === 'bpmn:Lane');
if (labelNodes.length) {
  const bounds = labelNodes.map(node => node.bounds);
  const x = Math.min(...bounds.map(b => b.x)) - 100;
  const y = Math.min(...bounds.map(b => b.y)) - 50;
  placeLabels({
    moddle, nodes: labelNodes,
    edges: bpmnPlane.planeElement.filter(element => element.$type === 'bpmndi:BPMNEdge')
      .sort((a, b) => a.bpmnElement.id.localeCompare(b.bpmnElement.id)),
    lanes: labelLanes.length ? labelLanes : [{ bounds: {
      x, y, width: Math.max(...bounds.map(b => b.x + b.width)) - x + 100,
      height: Math.max(...bounds.map(b => b.y + b.height)) - y + 100,
    } }],
  });
}
definitions.diagrams = [bpmnDiagram];
definitions.$attrs['xmlns:autoagent'] = AUTOAGENT_LAYOUT_NAMESPACE;
definitions.$attrs['autoagent:layoutRevision'] = AUTOAGENT_LAYOUT_REVISION;
definitions.$attrs['autoagent:layoutDirection'] = layoutDirection;
if (hasAuthoredSwimlanes) {
  definitions.$attrs['autoagent:laneHeaderHeight'] = String(LANE_HEADER_HEIGHT);
}

// ---- 7. Serialize back -------------------------------------------------
try {
  const { xml: outputXml } = await moddle.toXML(definitions, { format: true });
  process.stdout.write(outputXml);
} catch (err) {
  process.stderr.write(`[bpmn-layout] toXML failed: ${err.message}\n`);
  process.exit(5);
}
