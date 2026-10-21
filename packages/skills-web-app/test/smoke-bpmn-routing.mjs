import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import BpmnModdle from 'bpmn-moddle';
import {gridFor, seedRoutes, routeEdge} from '../bundles/flow_design/scripts/router.mjs';

const script=new URL('../bundles/flow_design/scripts/layout.mjs',import.meta.url);
const run=input=>{
  const p=spawnSync(process.execPath,[script.pathname],{input,encoding:'utf8',timeout:60000,maxBuffer:8000000});
  assert.equal(p.status,0,p.stderr);return p.stdout;
};
const hit=(a,b,r)=>a.y===b.y?a.y>r.y&&a.y<r.y+r.height&&Math.max(a.x,b.x)>r.x&&Math.min(a.x,b.x)<r.x+r.width:a.x===b.x&&a.x>r.x&&a.x<r.x+r.width&&Math.max(a.y,b.y)>r.y&&Math.min(a.y,b.y)<r.y+r.height;
function xml(nodes,edges,lanes=true,participant=false){
  const groups=lanes?`<bpmn:laneSet id="ls">${[0,1].map(l=>`<bpmn:lane id="lane${l}" name="角色${l}">${nodes.filter(n=>(n.lane||0)===l).map(n=>`<bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`).join('')}</bpmn:lane>`).join('')}</bpmn:laneSet>`:'';
  return `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="urn:test">${participant?'<bpmn:collaboration id="col"><bpmn:participant id="pool" processRef="p" name="项目"/></bpmn:collaboration>':''}<bpmn:process id="p" isExecutable="false">${groups}${nodes.map(n=>`<bpmn:${n.type||'task'} id="${n.id}" name="${n.name||n.id}" ${n.host?`attachedToRef="${n.host}"`:''}/>`).join('')}${edges.map(([s,t],i)=>`<bpmn:sequenceFlow id="e${i}" sourceRef="${s}" targetRef="${t}"/>`).join('')}</bpmn:process></bpmn:definitions>`;
}
async function verify(name,input){
  const output=run(input),moddle=new BpmnModdle();
  assert.match(output,/layoutRevision="12"/);
  const {rootElement:r,warnings}=await moddle.fromXML(output);assert.equal(warnings.length,0);
  const shapes=r.diagrams[0].plane.planeElement.filter(e=>e.$type==='bpmndi:BPMNShape'&&!['bpmn:Lane','bpmn:Participant'].includes(e.bpmnElement.$type));
  const edges=r.diagrams[0].plane.planeElement.filter(e=>e.$type==='bpmndi:BPMNEdge');
  for(const e of edges)for(let i=1;i<e.waypoint.length;i++){
    const a=e.waypoint[i-1],b=e.waypoint[i];
    assert.ok(a.x===b.x||a.y===b.y,name+' nonorthogonal');
    assert.ok(!shapes.some(n=>hit(a,b,n.bounds)),name+' node collision '+e.bpmnElement.id);
  }
  assert.equal(run(input),output,name+' repeat');
  const process=r.rootElements.find(e=>e.$type==='bpmn:Process');
  process.flowElements.reverse();
  for(const ls of process.laneSets||[])for(const lane of ls.lanes)lane.flowNodeRef.reverse();
  r.diagrams=[];
  const permuted=run((await moddle.toXML(r,{format:true})).xml);
  const geometry=async value=>{
    const {rootElement:d}=await new BpmnModdle().fromXML(value);
    return d.diagrams[0].plane.planeElement.map(e=>({id:e.bpmnElement.id,b:e.bounds&&[e.bounds.x,e.bounds.y,e.bounds.width,e.bounds.height],p:e.waypoint?.map(p=>[p.x,p.y]),label:e.label?.bounds&&[e.label.bounds.x,e.label.bounds.y,e.label.bounds.width,e.label.bounds.height]})).sort((a,b)=>a.id.localeCompare(b.id));
  };
  assert.deepEqual(await geometry(permuted),await geometry(output),name+' permutation');
  console.log('BPMN ROUTING OK:',name);
}
const basic=[{id:'start',type:'startEvent'},{id:'task',lane:1},{id:'end',type:'endEvent',lane:1}];
await verify('lane-less',xml(basic,[['start','task'],['task','end']],false));
await verify('participant and long label',xml(basic.map(n=>({...n,name:'这是一个用于验证中文外置名称布局的业务节点'})),[['start','task'],['task','end']],true,true));
await verify('self loop',xml(basic,[['start','task'],['task','task'],['task','end']]));
await verify('boundary event',xml([...basic,{id:'boundary',type:'boundaryEvent',host:'task',lane:1},{id:'handler'}],[['start','task'],['task','end'],['boundary','handler'],['handler','end']]));
const branch=[{id:'start',type:'startEvent'},{id:'fork',type:'parallelGateway'},{id:'join',type:'parallelGateway',lane:1},{id:'end',type:'endEvent',lane:1},...Array.from({length:5},(_,i)=>({id:'task'+i,lane:i%2}))];
await verify('five parallel branches',xml(branch,[['start','fork'],...Array.from({length:5},(_,i)=>['fork','task'+i]),...Array.from({length:5},(_,i)=>['task'+i,'join']),['join','end']]));
await verify('nested cross-lane cycles',xml([...basic,{id:'a'},{id:'b',lane:1},{id:'c'}],[['start','a'],['a','b'],['b','c'],['c','b'],['c','task'],['task','a'],['task','end']]));

// Router unit semantics: a spent expansion budget yields NO routes at all
// (the pipeline then refuses to publish a partial diagram, exit 6), and a
// funded grid seeds every edge with an orthogonal, cap-respecting baseline.
const unitNodes=[{id:'s',bounds:{x:0,y:0,width:100,height:80}},{id:'t',bounds:{x:0,y:200,width:100,height:80}}];
const unitModel={nodes:unitNodes,edges:[{id:'e',sourceId:'s',targetId:'t',feedback:false}]};
const dead=gridFor({nodes:unitNodes,budget:{remaining:0}});
const deadRoutes=new Map();
seedRoutes(unitModel,dead,deadRoutes);
assert.equal(deadRoutes.size,0,'spent budget must seed nothing');
assert.equal(routeEdge(unitModel,dead,unitModel.edges[0],deadRoutes),null);
const live=gridFor({nodes:unitNodes,budget:{remaining:750000}});
const liveRoutes=new Map();
seedRoutes(unitModel,live,liveRoutes);
const path=liveRoutes.get('e');
assert.ok(path&&path.length>=2,'funded grid must seed the edge');
for(let i=1;i<path.length;i++)assert.ok(path[i-1].x===path[i].x||path[i-1].y===path[i].y,'seed orthogonal');
const routed=routeEdge(unitModel,live,unitModel.edges[0],liveRoutes);
assert.ok(routed&&routed.length>=2,'routeEdge must return a path on a funded grid');
console.log('BPMN ROUTING OK: router budget semantics');
