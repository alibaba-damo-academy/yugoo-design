import test from 'node:test';
import assert from 'node:assert/strict';
import {channelCrowding,spaceChannels} from '../bundles/flow_design/scripts/channel-spacing.mjs';
const node=(id,x,y)=>({id,bounds:{x,y,width:100,height:80}});
function fixture(){return {nodes:[node('s',0,0),node('a',0,400),node('b',200,400)],lanes:[],
  edges:[{id:'e1',sourceId:'s',targetId:'a'},{id:'e2',sourceId:'s',targetId:'b'}],
  routes:new Map([['e1',[{x:50,y:80},{x:50,y:400}]],['e2',[{x:54,y:80},{x:54,y:380},{x:250,y:380},{x:250,y:400}]]])};}
test('long parallel branches remain chargeable even when they share a source',()=>{
  assert.ok(channelCrowding(fixture()).severity>200);
});
test('short proximity at a shared dock is exempt, unrelated docks are not',()=>{
  const s=fixture();s.routes=new Map([['e1',[{x:50,y:80},{x:50,y:98}]],['e2',[{x:54,y:80},{x:54,y:98}]]]);
  assert.equal(channelCrowding(s).severity,0);
  s.edges[1]={...s.edges[1],sourceId:'another'};assert.ok(channelCrowding(s).severity>0);
});
test('route-only separation improves readability without changing geometry, docks or crossings',()=>{
  const s=fixture(),r=spaceChannels(s),again=spaceChannels(s);
  assert.ok(r.metrics.after<r.metrics.before);
  assert.ok(r.metrics.accepted>0);
  assert.equal(r.state.nodes,s.nodes);assert.equal(r.state.lanes,s.lanes);assert.equal(r.state.edges,s.edges);
  assert.equal(r.cost.counts.crossing,0);assert.equal(r.cost.counts.nodeOverlap,0);
  for(const e of s.edges){const a=s.routes.get(e.id),b=r.state.routes.get(e.id);assert.deepEqual(a[0],b[0]);assert.deepEqual(a.at(-1),b.at(-1));}
  assert.deepEqual(r,again);
  assert.deepEqual(s,fixture(),'input must not be mutated');
});
test('already separated routes remain unchanged and candidate work is bounded',()=>{
  const s=fixture();s.routes.set('e2',[{x:85,y:80},{x:85,y:380},{x:250,y:380},{x:250,y:400}]);
  assert.equal(spaceChannels(s).metrics.accepted,0);
  assert.ok(spaceChannels(fixture(),{maxPasses:2,maxCandidates:3}).metrics.evaluated<=6);
});
