import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadingObjective, discoverReadingGroups } from '../bundles/flow_design/scripts/reading-order.mjs';
import { jointSearch, toCostModel } from '../bundles/flow_design/scripts/search.mjs';
import { diagramCost } from '../bundles/flow_design/scripts/cost.mjs';
import { gridFor, seedRoutes } from '../bundles/flow_design/scripts/router.mjs';
import { translateMove } from '../bundles/flow_design/scripts/moves.mjs';

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
test('routing preference permits a small offset for a clear crossing reduction',()=>{
  const state=empty([node('a',0,0),node('b',200,0)]);
  const initial={terms:{crossing:640,length:100},counts:{nodeOverlap:0,crossing:10}};
  const shifted=empty([state.nodes[0],node('b',200,12)]);
  const improved={terms:{crossing:0,length:100},counts:{nodeOverlap:0,crossing:0}};
  assert.equal(createReadingObjective(state,{preference:'routing',seedCost:initial}).better(shifted,improved,state,initial),true);
  assert.equal(createReadingObjective(state,{preference:'alignment',seedCost:initial}).better(shifted,improved,state,initial),false);
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
