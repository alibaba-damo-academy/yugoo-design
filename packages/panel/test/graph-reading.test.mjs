import test from 'node:test'
import assert from 'node:assert/strict'
import {createReadingIndex,readingEdgeActive,withReadingMembers} from './graph-reading.mjs'
import {register} from 'tsx/esm/api'
register()
const {projectRecords,recordOwner}=await import('../src/client/graph-model.ts')
const node=(id,record=false)=>({id,label:id,record})
const edge=(id,from,to,kind='semantic')=>({id,from,to,kind})
test('record neighborhood follows nested fields and preserves evidence identity in overview',()=>{
  const source={nodes:[node('a',true),node('a1'),node('a2'),node('b',true),node('b1'),node('c',true),node('z',true)],edges:[edge('p1','a','a1','contains'),edge('p2','a1','a2','contains'),edge('p3','b','b1','contains'),edge('s1','a2','b1'),edge('s2','b','a1','reference'),edge('s3','a','c'),edge('internal','a1','a2'),edge('bad','a','missing')]}
  const before=JSON.stringify(source),owner=new Map([['a','a'],['a1','a'],['a2','a'],['b','b'],['b1','b'],['c','c'],['z','z']])
  const index=createReadingIndex(source,owner)
  assert.equal(index.relations('a').length,2)
  assert.equal(index.relations('a1').length,2)
  assert.equal(index.relations('a')[0].edges.length,2)
  const all=index.neighborhood('a')
  assert.deepEqual([...all.visible].sort(),['a','a1','a2','b','b1','c'])
  assert.ok(!all.edgeIds.has('internal'))
  const selected=index.neighborhood('a','b','s1')
  assert.deepEqual([...selected.edgeIds].sort(),['p1','p2','p3','s1'])
  assert.ok(readingEdgeActive({id:'aggregate',members:[{id:'s1'}]},selected))
  assert.ok(!readingEdgeActive({id:'s3'},selected))
  assert.deepEqual(index.unresolved,['bad'])
  assert.deepEqual(index.relations('z'),[])
  assert.equal(JSON.stringify(source),before)
})
test('cyclic malformed containment cannot loop; unknown selection stays empty',()=>{
  const source={nodes:[node('a',true),node('x'),node('y'),node('b',true)],edges:[edge('p1','y','x','contains'),edge('p2','x','y','contains'),edge('s','x','b')]}
  const index=createReadingIndex(source,new Map([['a','a'],['x','a'],['y','a'],['b','b']]))
  assert.equal(index.neighborhood('a').visible.size,4)
  assert.equal(index.neighborhood('missing').visible.size,0)
})
test('real projection deduplication cannot discard selected original edge IDs',()=>{
  const source={nodes:[node('a',true),{...node('a1'),recordId:'a'},node('b',true)],edges:[edge('p','a','a1','contains'),{...edge('s1','a1','b'),evidence:'same'},{...edge('s2','a1','b'),evidence:'same'}]}
  const before=JSON.stringify(source),owner=new Map(source.nodes.map(n=>[n.id,recordOwner(source,n.id)])),index=createReadingIndex(source,owner)
  for(const expanded of [false,true]){
    const raw=projectRecords(source,expanded),scope=withReadingMembers(raw,source,owner)
    assert.equal(raw.edges.length,scope.edges.length)
    for(const id of ['s1','s2'])assert.ok(scope.edges.some(e=>e.kind==='semantic'&&e.members.some(m=>m.id===id)&&readingEdgeActive(e,index.neighborhood('a','b',id))))
  }
  assert.equal(JSON.stringify(source),before)
})
