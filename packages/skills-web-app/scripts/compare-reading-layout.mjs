// Read-only A/B experiment. BPMN outputs stay in memory; inputs are never overwritten.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import BpmnModdle from 'bpmn-moddle';
import assert from 'node:assert/strict';
import { modelFromXml } from '../bundles/flow_design/scripts/layout-metrics.mjs';
import { diagramCost } from '../bundles/flow_design/scripts/cost.mjs';
import { READING_PREFERENCES } from '../bundles/flow_design/scripts/reading-order.mjs';

const script=fileURLToPath(new URL('../bundles/flow_design/scripts/layout.mjs',import.meta.url));
const examples=fileURLToPath(new URL('../../../examples/research-platform-comparison/good/design_files/flow_design/',import.meta.url));
const channelsOnly=process.argv.includes('--channels');
const profiles=channelsOnly?['balanced','balanced-channels']:['baseline','alignment','balanced','routing'];
const paths=process.argv.slice(2).filter(p=>p!=='--channels');
if(!paths.length)paths.push(...readdirSync(examples).filter(n=>/^P-00\d\.bpmn$/.test(n)).sort().map(n=>`${examples}/${n}`));
async function signature(xml) {
  const {rootElement:r}=await new BpmnModdle().fromXML(xml);
  // Serialize the complete semantic document, including extension attributes,
  // while ignoring only derived diagrams and our layout revision annotation.
  r.diagrams=[];
  delete r.$attrs['autoagent:layoutRevision'];
  const result=await new BpmnModdle().toXML(r,{format:false});
  return result.xml.replace(/\s+[\w-]+:layoutRevision="[^"]*"/g,'').replace(/\s+xmlns:[\w-]+="https:\/\/autoagent.ai\/bpmn\/layout"/g,'');
}
function dock(p,b) {
  return ((Math.abs(p.x-b.x)<1||Math.abs(p.x-b.x-b.width)<1)&&p.y>=b.y-1&&p.y<=b.y+b.height+1)
    ||((Math.abs(p.y-b.y)<1||Math.abs(p.y-b.y-b.height)<1)&&p.x>=b.x-1&&p.x<=b.x+b.width+1);
}
const rows=[];
for(const path of paths) {
  const input=readFileSync(path,'utf8'),outputs=[];
  const parsed=await new BpmnModdle().fromXML(input);
  const expectedEdges=parsed.rootElement.rootElements.find(e=>e.$type==='bpmn:Process').flowElements.filter(e=>e.$type==='bpmn:SequenceFlow').length;
  for(const preference of profiles) {
    const start=performance.now();
    const run=spawnSync(process.execPath,[script],{input,encoding:'utf8',timeout:60000,maxBuffer:16000000,env:{...process.env,BPMN_LAYOUT_READING:preference==='baseline'?'0':'1',BPMN_LAYOUT_PREFERENCE:preference==='balanced-channels'?'balanced':preference==='baseline'?'alignment':preference,BPMN_LAYOUT_CHANNELS:preference==='balanced-channels'?'1':'0',BPMN_LAYOUT_READING_REPORT:'1',BPMN_LAYOUT_EXPERIMENT_BUDGET:'1'}});
    assert.equal(run.status,0,run.stderr);
    const model=await modelFromXml(run.stdout),cost=diagramCost(model);
    assert.equal(model.edges.length,expectedEdges,'missing input sequence flow route');
    assert.equal(await signature(run.stdout),await signature(input),'semantic BPMN changed');
    const nodes=new Map(model.nodes.map(n=>[n.id,n]));
    assert.equal(cost.counts.nodeOverlap,0,'edge penetrated a node');
    for(const e of model.edges) {
      assert.ok(dock(e.waypoints[0],nodes.get(e.sourceId).bounds)&&dock(e.waypoints.at(-1),nodes.get(e.targetId).bounds),'detached edge');
      for(let i=1;i<e.waypoints.length;i++)assert.ok(e.waypoints[i].x===e.waypoints[i-1].x||e.waypoints[i].y===e.waypoints[i-1].y,'nonorthogonal edge');
    }
    const metrics=JSON.parse(run.stderr.match(/reading-metrics (\{[^\n]+\})/)[1]);
    outputs.push({model,cost,ms:Math.round(performance.now()-start),preference,metrics});
  }
  const [base,...trials]=outputs;
  for(const trial of trials) {
    assert.equal(base.model.edges.length,trial.model.edges.length,'missing routes');
    assert.equal(base.metrics.seedDeviation,trial.metrics.seedDeviation,'different comparison seed');
    const policy=READING_PREFERENCES[trial.metrics.preference];
    assert.ok(trial.metrics.meanDeviation<=trial.metrics.seedMeanDeviation+policy.tolerancePx+1e-6,'alignment debt exceeded');
    assert.ok(trial.metrics.crossings<=trial.metrics.seedCrossings+policy.crossingDebt,'crossing debt exceeded');
    if(channelsOnly) {
      assert.deepEqual(trial.model.nodes,base.model.nodes,'channel spacing moved a node');
      assert.deepEqual(trial.model.lanes,base.model.lanes,'channel spacing changed a lane');
      assert.ok(trial.cost.counts.crossing<=base.cost.counts.crossing,'channel spacing added a crossing');
      assert.ok(trial.metrics.channelCrowding<=base.metrics.channelCrowding+1e-6,'channel spacing increased crowding');
    }
  }
  const row={file:path.split('/').at(-1),variants:Object.fromEntries(outputs.map(v=>[v.preference,{ms:v.ms,total:Math.round(v.cost.total),wireLength:v.cost.terms.length,bends:v.cost.counts.bend,...v.metrics}]))};
  rows.push(row); console.log(JSON.stringify(row));
}
console.log(JSON.stringify({summary:{files:rows.length,variants:Object.fromEntries(profiles.map(p=>[p,{ms:rows.reduce((s,r)=>s+r.variants[p].ms,0),deviation:rows.reduce((s,r)=>s+r.variants[p].deviation,0),crossings:rows.reduce((s,r)=>s+r.variants[p].crossings,0),channelCrowding:rows.reduce((s,r)=>s+r.variants[p].channelCrowding,0),wireLength:rows.reduce((s,r)=>s+r.variants[p].wireLength,0),bends:rows.reduce((s,r)=>s+r.variants[p].bends,0)}]))}}));
