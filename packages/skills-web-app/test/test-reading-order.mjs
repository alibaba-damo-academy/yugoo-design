import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createReadingObjective, discoverReadingGroups } from '../bundles/flow_design/scripts/reading-order.mjs';
import { jointSearch, routeDescent, toCostModel } from '../bundles/flow_design/scripts/search.mjs';
import { diagramCost } from '../bundles/flow_design/scripts/cost.mjs';
import { gridFor, seedRoutes } from '../bundles/flow_design/scripts/router.mjs';
import { translateMove } from '../bundles/flow_design/scripts/moves.mjs';
import { modelFromXml } from '../bundles/flow_design/scripts/layout-metrics.mjs';

const node=(id,x,y,laneId='l',width=100,height=80)=>({id,laneId,bounds:{x,y,width,height}});
const empty=nodes=>({nodes,edges:[],lanes:[],routes:new Map()});
test('near reading rows cross lanes without domain or panel annotations',()=>{
  const state=empty([node('a',0,0,'one'),node('b',200,28,'two')]);
  assert.ok(discoverReadingGroups(state).some(g=>g.axis==='y'&&g.ids.join(',')==='a,b'));
  const objective=createReadingObjective(state),aligned=objective.moves(state)[0].apply(state);
  assert.equal(objective.error(state),28);
  assert.equal(objective.error(aligned),0);
});
test('causal ancestors are not flattened and near-pair chains do not form distant groups',()=>{
  const state=empty([node('a',0,0),node('b',200,30),node('c',400,60)]);
  assert.ok(!discoverReadingGroups(state).some(g=>g.ids.length===3));
  state.edges=[{id:'ab',sourceId:'a',targetId:'b'}];
  assert.ok(!discoverReadingGroups(state).some(g=>g.axis==='y'&&g.ids.includes('a')&&g.ids.includes('b')));
});
test('moving apart cannot erase frozen group error',()=>{
  const state=empty([node('a',0,0),node('b',200,28)]),objective=createReadingObjective(state);
  const drift=empty([state.nodes[0],node('b',200,400)]);
  assert.equal(discoverReadingGroups(drift).length,0);
  assert.equal(objective.error(drift),400);
});
test('a long same-lane spine keeps its column without merging parallel tracks',()=>{
  const state=empty([node('a',0,0,'one'),node('b',0,800,'one'),
    node('parallel',200,800,'one'),node('otherLane',0,1200,'two')]);
  const columns=discoverReadingGroups(state).filter(g=>g.axis==='x');
  assert.ok(columns.some(g=>g.ids.join(',')==='a,b'));
  assert.ok(!columns.some(g=>g.ids.includes('parallel')||g.ids.includes('otherLane')));
});
test('one row gaining alignment cannot pay for breaking an already aligned row',()=>{
  const state=empty([node('a',0,0),node('b',200,0),node('c',0,300),node('d',200,328)]);
  const initial={terms:{crossing:640,length:100},counts:{nodeOverlap:0,crossing:10}};
  const improved={terms:{crossing:0,length:50},counts:{nodeOverlap:0,crossing:0}};
  const drift=empty([state.nodes[0],node('b',200,28),state.nodes[2],node('d',200,300)]);
  for(const preference of ['alignment','balanced','routing']) {
    const objective=createReadingObjective(state,{preference,seedCost:initial});
    assert.equal(objective.error(drift),objective.error(state));
    assert.equal(objective.legalGeometry(drift),false,preference);
    assert.equal(objective.better(drift,improved,state,initial),false,preference);
  }
});
test('an alignment achieved during search cannot be spent by a later routing move',()=>{
  const state=empty([node('a',0,0),node('b',200,28)]);
  const initial={terms:{crossing:640,length:100},counts:{nodeOverlap:0,crossing:10}};
  const aligned=empty([state.nodes[0],node('b',200,0)]);
  const drift=empty([state.nodes[0],node('b',200,7)]);
  for(const preference of ['alignment','balanced','routing']) {
    const objective=createReadingObjective(state,{preference,seedCost:initial});
    assert.equal(objective.better(drift,{terms:{crossing:0,length:50},counts:{nodeOverlap:0,crossing:0}},aligned,initial),false,preference);
  }
});
test('the half-pixel lock applies both at the seed and when alignment is reached',()=>{
  const loose=empty([node('a',0,0),node('b',200,28)]);
  const aligned=empty([loose.nodes[0],node('b',200,.5)]);
  const drift=empty([loose.nodes[0],node('b',200,.51)]);
  const initial={terms:{crossing:640,length:100},counts:{nodeOverlap:0,crossing:10}};
  const improved={terms:{crossing:0,length:50},counts:{nodeOverlap:0,crossing:0}};
  for(const preference of ['alignment','balanced','routing']) {
    assert.equal(createReadingObjective(aligned,{preference,seedCost:initial}).legalGeometry(drift),false);
    assert.equal(createReadingObjective(loose,{preference,seedCost:initial}).better(drift,improved,aligned,initial),false);
  }
});
test('unaligned heuristic rows retain the original preference and routing-debt trade-offs',()=>{
  const state=empty([node('a',0,0),node('b',200,28)]);
  const shifted=empty([state.nodes[0],node('b',200,38)]);
  const initial={terms:{crossing:640,length:100},counts:{nodeOverlap:0,crossing:10}};
  const improved={terms:{crossing:0,length:50},counts:{nodeOverlap:0,crossing:0}};
  for(const preference of ['alignment','balanced','routing']) {
    const objective=createReadingObjective(state,{preference,seedCost:initial});
    assert.equal(objective.legalGeometry(shifted),true,`${preference}: an unaligned group is not a hard lock`);
    assert.equal(objective.better(shifted,improved,state,initial),preference==='routing',preference);
    assert.equal(objective.better(shifted,{...improved,counts:{nodeOverlap:1,crossing:0}},state,initial),false);
    assert.equal(objective.better(shifted,{...improved,terms:{crossing:0,length:3000}},state,initial),false);
    const excessive=empty([state.nodes[0],node('b',200,80)]);
    assert.equal(objective.better(excessive,improved,state,initial),false,'original alignment-debt bound still applies');
  }
});
test('established rows and columns can translate together without losing alignment',()=>{
  const state=empty([node('a',0,0),node('b',200,0),node('c',0,300),node('d',200,300)]);
  const moved=translateMove('test','whole group',state,new Map(state.nodes.map(n=>[n.id,{dx:12,dy:28}]))).apply(state);
  const initial={terms:{crossing:640,length:100},counts:{nodeOverlap:0,crossing:10}};
  const improved={terms:{crossing:0,length:50},counts:{nodeOverlap:0,crossing:0}};
  for(const preference of ['alignment','balanced','routing']) {
    const objective=createReadingObjective(state,{preference,seedCost:initial});
    assert.equal(objective.legalGeometry(moved),true,preference);
    assert.equal(objective.error(moved),0);
    assert.equal(objective.better(moved,improved,state,initial),true,preference);
  }
});
test('legal host/child overlap is preserved; detached children and lane escapes fail',()=>{
  const host=node('host',100,100),child={...node('boundary',132,162,'l',36,36),attachTo:'host'};
  const state={...empty([host,child]),lanes:[{id:'l',index:0,bounds:{x:0,y:0,width:500,height:500}}]};
  const objective=createReadingObjective(state);
  const moved=translateMove('test','host',state,new Map([['host',{dx:30}]] )).apply(state);
  assert.ok(moved); assert.ok(objective.legalGeometry(moved));
  assert.equal(moved.nodes[1].bounds.x,162);
  assert.equal(objective.legalGeometry({...state,nodes:[host,{...child,bounds:{...child.bounds,x:160}}]}),false);
  assert.equal(objective.legalGeometry({...state,nodes:[{...host,bounds:{...host.bounds,x:-1}},child]}),false);
});
test('reading gain cannot buy node penetration or unbounded routing deterioration',()=>{
  const cost=length=>({terms:{length},counts:{nodeOverlap:0,crossing:0}});
  const state=empty([node('a',0,0),node('b',200,28)]),o=createReadingObjective(state,{seedCost:cost(100)}),aligned=o.moves(state)[0].apply(state);
  assert.equal(o.better(aligned,cost(105),state,cost(100)),true);
  assert.equal(o.better(aligned,cost(1000),state,cost(100)),false);
  assert.equal(o.better(aligned,{...cost(100),counts:{nodeOverlap:1,crossing:0}},state,cost(100)),false);
});
test('regularity savings cannot disguise substantial alignment loss',()=>{
  const state=empty([node('a',0,0),node('b',200,28)]);
  const initial={terms:{spine:5000,length:100},counts:{nodeOverlap:0,crossing:0}};
  const o=createReadingObjective(state,{seedCost:initial});
  const drift=empty([state.nodes[0],node('b',200,100)]);
  assert.equal(o.better(drift,{terms:{spine:0,length:50},counts:initial.counts},state,initial),false);
});
test('even routing preference cannot split an established row to reduce crossings',()=>{
  const state=empty([node('a',0,0),node('b',200,0)]);
  const initial={terms:{crossing:640,length:100},counts:{nodeOverlap:0,crossing:10}};
  const shifted=empty([state.nodes[0],node('b',200,12)]);
  const improved={terms:{crossing:0,length:100},counts:{nodeOverlap:0,crossing:0}};
  for(const preference of ['alignment','balanced','routing'])
    assert.equal(createReadingObjective(state,{preference,seedCost:initial}).better(shifted,improved,state,initial),false);
});
test('small individual concessions cannot accumulate routing or alignment debt',()=>{
  const state=empty([node('a',0,0),node('b',200,28)]);
  const initial={terms:{length:100},counts:{nodeOverlap:0,crossing:0}};
  const o=createReadingObjective(state,{seedCost:initial});
  const aligned=o.moves(state)[0].apply(state);
  assert.equal(o.better(aligned,{terms:{length:140},counts:initial.counts},state,{terms:{length:130},counts:initial.counts}),false);
  const previous=empty([state.nodes[0],node('b',200,36)]),drift=empty([state.nodes[0],node('b',200,40)]);
  assert.equal(o.better(drift,{terms:{length:50},counts:initial.counts},previous,initial),false);
});
test('join rerouting keeps aligned branch nodes fixed and respects an exhausted budget',()=>{
  const state={nodes:[node('outer',290,572,'lane'),node('inner',160,572,'lane'),node('join',55,708,'lane',50,50)],lanes:[],
    edges:[{id:'a',sourceId:'outer',targetId:'join'},{id:'b',sourceId:'inner',targetId:'join'}],
    routes:new Map([['a',[{x:340,y:652},{x:340,y:688},{x:80,y:688},{x:80,y:708}]],
      ['b',[{x:210,y:652},{x:210,y:733},{x:105,y:733}]]])};
  const objective=createReadingObjective(state,{preference:'balanced'});
  assert.equal(diagramCost(toCostModel(state)).counts.crossing,1);
  const result=routeDescent(state,gridFor(state),3,objective);
  assert.equal(result.cost.counts.crossing,0);
  assert.equal(result.cost.counts.nodeOverlap,0);
  assert.equal(result.state.nodes,state.nodes);
  assert.equal(objective.error(result.state),objective.error(state));
  const exhausted=routeDescent(state,gridFor({...state,budget:{remaining:0}}),3,objective);
  assert.deepEqual(exhausted.state.routes,state.routes,'no pair fallback may bypass the routing budget');
  assert.equal(exhausted.cost.counts.crossing,1);
});
test('joint search aligns a cross-lane fork and keeps every attached orthogonal route deterministically',()=>{
  const state={nodes:[node('start',82,30,'one',36,36),node('a',50,150,'one'),node('b',250,178,'two'),node('end',282,360,'two',36,36)],
    lanes:[{id:'one',index:0,bounds:{x:0,y:0,width:200,height:460}},{id:'two',index:1,bounds:{x:200,y:0,width:200,height:460}}],
    edges:[['start','a'],['start','b'],['a','end'],['b','end']].map(([sourceId,targetId],i)=>({id:`e${i}`,sourceId,targetId})),routes:new Map()};
  seedRoutes(state,gridFor(state),state.routes);
  assert.equal(state.routes.size,4);
  for(const preference of ['alignment','balanced','routing']) {
    const objective=createReadingObjective(state,{preference});
    const options={objective,maxPasses:3,maxMovesPerPass:36,maxExpansions:150000};
    const a=jointSearch(state,options),b=jointSearch(state,options);
    assert.ok(objective.error(a.state)<objective.error(state),preference);
    assert.ok(objective.legalGeometry(a.state));
    assert.equal(diagramCost(toCostModel(a.state)).counts.nodeOverlap,0);
    assert.deepEqual(a.state,b.state);
    for(const points of a.state.routes.values())for(let i=1;i<points.length;i++)assert.ok(points[i].x===points[i-1].x||points[i].y===points[i-1].y);
  }
});
test('production layout keeps the delivery example rows and lane spines aligned through routing',async()=>{
  const file=new URL('../../../examples/design-team-delivery/design_files/flow_design/P-001.bpmn',import.meta.url);
  const input=readFileSync(file,'utf8');
  const env={...process.env};
  for(const key of Object.keys(env))if(key.startsWith('BPMN_LAYOUT_'))delete env[key];
  const run=()=>{
    const result=spawnSync(process.execPath,[new URL('../bundles/flow_design/scripts/layout.mjs',import.meta.url).pathname],
      {input,env,encoding:'utf8',timeout:60000,maxBuffer:16000000});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/layoutRevision="13"/);
    return result.stdout;
  };
  const output=run(),model=await modelFromXml(output);
  const nodes=new Map(model.nodes.map(n=>[n.id,n]));
  const center=(id,axis)=>{const b=nodes.get(id).bounds;return b[axis]+b[axis==='x'?'width':'height']/2;};
  for(const [a,b] of [['UserTask_P-001_3','ExclusiveGateway_P-001_2'],
    ['UserTask_P-001_4','UserTask_P-001_5'],['UserTask_P-001_6','ServiceTask_P-001_2']])
    assert.ok(Math.abs(center(a,'y')-center(b,'y'))<=.5,`${a}/${b}: established reading row split`);
  for(const lane of model.lanes){
    const values=model.nodes.filter(n=>n.laneId===lane.id).map(n=>center(n.id,'x'));
    assert.ok(Math.max(...values)-Math.min(...values)<=.5,`${lane.id}: single-track spine split`);
  }
  const cost=diagramCost(model);
  assert.equal(cost.counts.nodeOverlap,0);
  assert.equal(cost.counts.crossing,0);
  const attached=(point,b)=>((point.x===b.x||point.x===b.x+b.width)&&point.y>=b.y&&point.y<=b.y+b.height)
    ||((point.y===b.y||point.y===b.y+b.height)&&point.x>=b.x&&point.x<=b.x+b.width);
  for(const edge of model.edges){
    assert.ok(attached(edge.waypoints[0],nodes.get(edge.sourceId).bounds),edge.id+' source dock');
    assert.ok(attached(edge.waypoints.at(-1),nodes.get(edge.targetId).bounds),edge.id+' target dock');
    for(let i=1;i<edge.waypoints.length;i++)assert.ok(edge.waypoints[i].x===edge.waypoints[i-1].x||edge.waypoints[i].y===edge.waypoints[i-1].y);
  }
  const before=await modelFromXml(input);
  const signature=m=>({nodes:m.nodes.map(n=>[n.id,n.type,n.laneId]),edges:m.edges.map(e=>[e.id,e.sourceId,e.targetId,e.feedback])});
  assert.deepEqual(signature(model),signature(before),'roles, nodes, branches and feedback paths must not change');
  assert.equal(run(),output,'production output must remain deterministic');
  assert.equal(readFileSync(file,'utf8'),input,'a layout run must not rewrite the saved example');
});
test('production layout aligns parallel branches without introducing a shared-join crossing',async()=>{
  const file=new URL('../../../examples/research-platform-comparison/good/design_files/flow_design/P-004.bpmn',import.meta.url);
  const input=readFileSync(file,'utf8'),env={...process.env};
  for(const key of Object.keys(env))if(key.startsWith('BPMN_LAYOUT_'))delete env[key];
  const run=()=>{
    const result=spawnSync(process.execPath,[new URL('../bundles/flow_design/scripts/layout.mjs',import.meta.url).pathname],
      {input,env,encoding:'utf8',timeout:60000,maxBuffer:16000000});
    assert.equal(result.status,0,result.stderr);
    return result.stdout;
  };
  const output=run(),model=await modelFromXml(output);
  const a=model.nodes.find(n=>n.id==='ServiceTask_P-004_2').bounds;
  const b=model.nodes.find(n=>n.id==='ServiceTask_P-004_3').bounds;
  assert.ok(Math.abs(a.y+a.height/2-b.y-b.height/2)<=.5,'parallel branches stay aligned');
  const cost=diagramCost(model);
  assert.equal(cost.counts.nodeOverlap,0);
  assert.equal(cost.counts.crossing,0,'aligned branches must not regress the crossing-free join');
  const before=await modelFromXml(input);
  const signature=m=>({nodes:m.nodes.map(n=>[n.id,n.type,n.laneId]),edges:m.edges.map(e=>[e.id,e.sourceId,e.targetId,e.feedback])});
  assert.deepEqual(signature(model),signature(before));
  assert.equal(run(),output,'coupled routing remains deterministic');
  assert.equal(readFileSync(file,'utf8'),input);
});
