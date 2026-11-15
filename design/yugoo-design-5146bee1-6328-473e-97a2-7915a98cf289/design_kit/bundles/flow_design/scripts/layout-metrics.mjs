// Regression ruler for the flow_design auto-layout.
//
// Reads laid-out BPMN file(s), extracts the DI geometry, and prints the
// per-term cost breakdown from cost.mjs plus pool dimensions and wall time.
// Read-only: never writes BPMN. Used to establish baselines before a layout
// change and to verify improvements after it.
//
// Usage: node layout-metrics.mjs <file.bpmn> [more.bpmn ...]
//        node layout-metrics.mjs --json <file.bpmn> ...

import * as BpmnModdleModule from 'bpmn-moddle';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { detectFeedbackEdges } from './feedback.mjs';
import { diagramCost } from './cost.mjs';

const BpmnModdle =
  Reflect.get(BpmnModdleModule, 'BpmnModdle') || Reflect.get(BpmnModdleModule, 'default') || BpmnModdleModule;
const moddle = new BpmnModdle();

export async function modelFromXml(xml) {
  const { rootElement } = await moddle.fromXML(xml);
  const process_ = (rootElement.rootElements || []).find((e) => e.$type === 'bpmn:Process');
  if (!process_) throw new Error('no bpmn:Process');

  const laneByNodeId = new Map();
  const lanesMeta = [];
  for (const laneSet of process_.laneSets || []) {
    for (const lane of laneSet.lanes || []) {
      lanesMeta.push(lane);
      for (const ref of lane.flowNodeRef || []) laneByNodeId.set(ref.id, lane.id);
    }
  }

  const nodes = [];
  const edges = [];
  const shapeBounds = new Map();
  const laneBounds = new Map();
  const edgeWaypoints = new Map();

  for (const diagram of rootElement.diagrams || []) {
    for (const plane of diagram.plane ? [diagram.plane] : []) {
      for (const el of plane.planeElement || []) {
        if (el.$type === 'bpmndi:BPMNShape' && el.bounds) {
          const b = { x: el.bounds.x, y: el.bounds.y, width: el.bounds.width, height: el.bounds.height };
          if (laneByNodeId.has(el.bpmnElement?.id) || lanesMeta.some((l) => l.id === el.bpmnElement?.id)) {
            if (lanesMeta.some((l) => l.id === el.bpmnElement?.id)) laneBounds.set(el.bpmnElement.id, b);
            else shapeBounds.set(el.bpmnElement.id, b);
          } else if (el.bpmnElement?.$type) {
            shapeBounds.set(el.bpmnElement.id, b);
          }
        } else if (el.$type === 'bpmndi:BPMNEdge' && el.waypoint) {
          edgeWaypoints.set(el.bpmnElement.id, el.waypoint.map((w) => ({ x: w.x, y: w.y })));
        }
      }
    }
  }

  for (const fe of process_.flowElements || []) {
    if (fe.$type === 'bpmn:SequenceFlow') {
      edges.push({ id: fe.id, sourceId: fe.sourceRef?.id, targetId: fe.targetRef?.id });
    } else if (shapeBounds.has(fe.id)) {
      nodes.push({
        id: fe.id,
        type: fe.$type,
        laneId: laneByNodeId.get(fe.id) || null,
        bounds: shapeBounds.get(fe.id),
      });
    }
  }

  // Semantic feedback classification shared with the layout pipeline, so the
  // ruler and the search measure extraBend against identical definitions.
  const hostOf = new Map();
  for (const fe of process_.flowElements || []) {
    if (fe.attachedToRef?.id) hostOf.set(fe.id, fe.attachedToRef.id);
  }
  const feedbackIds = detectFeedbackEdges(
    nodes.map((n) => ({ id: n.id, type: n.type })),
    edges.map((e) => ({ id: e.id, sourceId: e.sourceId, targetId: e.targetId })),
    hostOf,
  );
  for (const edge of edges) {
    edge.feedback = feedbackIds.has(edge.id);
    edge.waypoints = edgeWaypoints.get(edge.id) || [];
  }

  const lanes = [...laneBounds].map(([id, bounds], index) => ({ id, index, bounds }))
    .sort((a, b) => a.bounds.x - b.bounds.x)
    .map((l, index) => ({ ...l, index }));

  return { nodes, edges: edges.filter((e) => e.waypoints.length > 1), lanes };
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isEntry) {
  // Imported as a library (e.g. by layout-search.mjs): expose only the parser.
} else {
  await runCli();
}

async function runCli() {
const asJson = process.argv.includes('--json');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const rows = [];
for (const file of files) {
  const started = process.hrtime.bigint();
  const model = await modelFromXml(readFileSync(file, 'utf8'));
  const result = diagramCost(model);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const pool = model.lanes.length
    ? {
        w: Math.max(...model.lanes.map((l) => l.bounds.x + l.bounds.width)) - Math.min(...model.lanes.map((l) => l.bounds.x)),
        h: Math.max(...model.lanes.map((l) => l.bounds.y + l.bounds.height)) - Math.min(...model.lanes.map((l) => l.bounds.y)),
      }
    : { w: 0, h: 0 };
  rows.push({ file, ms: Math.round(ms * 10) / 10, pool, nodes: model.nodes.length, edges: model.edges.length, ...result });
}

if (asJson) {
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
} else {
  const termNames = ['nodeOverlap', 'crossing', 'collinear', 'parallel', 'laneExtra', 'length', 'bend', 'extraBend', 'spacing', 'exterior', 'size', 'spine', 'row', 'rowCross', 'lattice', 'laneFit', 'sideGap'];
  const nameW = Math.max(...rows.map((r) => r.file.split('/').pop().length));
  process.stdout.write(`${'file'.padEnd(nameW)}  ${'total'.padStart(9)}  ${'pool'.padStart(11)}  ${'ms'.padStart(6)}  breakdown(term=value, count where relevant)\n`);
  for (const r of rows) {
    const parts = termNames
      .filter((t) => r.terms[t] > 0.005)
      .map((t) => `${t}=${Math.round(r.terms[t])}${r.counts[t] !== undefined && r.counts[t] > 0 ? `(${r.counts[t]})` : ''}`);
    process.stdout.write(
      `${r.file.split('/').pop().padEnd(nameW)}  ${String(Math.round(r.total)).padStart(9)}  ${`${r.pool.w}x${r.pool.h}`.padStart(11)}  ${String(r.ms).padStart(6)}  ${parts.join(' ')}\n`,
    );
  }
}
}
