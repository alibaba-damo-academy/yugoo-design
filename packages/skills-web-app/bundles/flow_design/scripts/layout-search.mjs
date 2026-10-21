// Stage-2 proof harness: run the joint local search over an EXISTING laid-out
// BPMN file and report the measured cost delta. Read the DI geometry as the
// seed state, search, then serialize the improved DI back out.
//
// Usage: node layout-search.mjs <in.bpmn> <out.bpmn> [--passes N] [--trace]

import * as BpmnModdleModule from 'bpmn-moddle';
import { readFileSync, writeFileSync } from 'node:fs';
import { diagramCost } from './cost.mjs';
import { jointSearch, toCostModel } from './search.mjs';
import { modelFromXml } from './layout-metrics.mjs';

const BpmnModdle =
  Reflect.get(BpmnModdleModule, 'BpmnModdle') || Reflect.get(BpmnModdleModule, 'default') || BpmnModdleModule;
const moddle = new BpmnModdle();

const argv = process.argv.slice(2);
const passesIdx = argv.indexOf('--passes');
const maxPasses = passesIdx >= 0 ? Number(argv[passesIdx + 1]) : 3;
const trace = argv.includes('--trace');
const files = argv.filter((a) => !a.startsWith('--') && (passesIdx < 0 || a !== argv[passesIdx + 1]));
const [inPath, outPath] = files;
if (!inPath || !outPath) {
  process.stderr.write('usage: layout-search.mjs <in.bpmn> <out.bpmn> [--passes N] [--trace]\n');
  process.exit(2);
}

const xml = readFileSync(inPath, 'utf8');
const model = await modelFromXml(xml);
const { rootElement } = await moddle.fromXML(xml);

const routes = new Map(model.edges.map((e) => [e.id, e.waypoints]));
const state = { nodes: model.nodes, edges: model.edges, lanes: model.lanes, routes };
const before = diagramCost(toCostModel(state));

const started = process.hrtime.bigint();
const result = jointSearch(state, { maxPasses, trace });
const ms = Number(process.hrtime.bigint() - started) / 1e6;

// ---- serialize improved DI back into the moddle tree --------------------
const nodeById = new Map(result.state.nodes.map((n) => [n.id, n]));
const laneById = new Map(result.state.lanes.map((l) => [l.id, l]));
for (const diagram of rootElement.diagrams || []) {
  for (const plane of diagram.plane ? [diagram.plane] : []) {
    for (const el of plane.planeElement || []) {
      const id = el.bpmnElement?.id;
      if (el.$type === 'bpmndi:BPMNShape' && el.bounds) {
        const target = nodeById.get(id) || laneById.get(id);
        if (target) {
          el.bounds.x = Math.round(target.bounds.x);
          el.bounds.y = Math.round(target.bounds.y);
          el.bounds.width = Math.round(target.bounds.width);
          el.bounds.height = Math.round(target.bounds.height);
        }
      } else if (el.$type === 'bpmndi:BPMNEdge') {
        const waypoints = result.state.routes.get(id);
        if (waypoints) {
          el.waypoint = waypoints.map((w) => moddle.create('dc:Point', { x: Math.round(w.x), y: Math.round(w.y) }));
        }
      }
    }
  }
}
const { xml: outXml } = await moddle.toXML(rootElement, { format: true });
writeFileSync(outPath, outXml, 'utf8');

const termNames = ['nodeOverlap', 'crossing', 'collinear', 'parallel', 'laneExtra', 'length', 'bend', 'extraBend', 'spacing', 'exterior', 'size'];
const fmt = (r) => termNames.filter((t) => r.terms[t] > 0.005).map((t) => `${t}=${Math.round(r.terms[t])}${r.counts[t] ? `(${r.counts[t]})` : ''}`).join(' ');
process.stdout.write(`before total=${Math.round(before.total)}  ${fmt(before)}\n`);
process.stdout.write(`after  total=${Math.round(result.cost.total)}  ${fmt(result.cost)}\n`);
process.stdout.write(`search ${Math.round(ms)}ms, ${result.history.length - 1} accepted moves\n`);
for (const h of result.history.slice(1)) process.stdout.write(`  pass${h.pass} ${h.move} -> ${h.total}\n`);
