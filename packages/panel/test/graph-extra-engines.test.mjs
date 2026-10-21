import test from 'node:test'
import assert from 'node:assert/strict'
import {calculateLive} from './graph-extra-engines.mjs'
import {initialPositions} from './layout-comparison-engines.mjs'

for(const engine of ['WebCoLa','ELK Stress'])test(engine+' preserves graph facts and gives repeatable finite layouts',async()=>{
  const cases=[{nodes:[],edges:[]},{nodes:[{id:'single',record:true}],edges:[]},{
    nodes:[{id:'record',record:true},{id:'child',record:false,parentId:'record'},{id:'other',record:true},{id:'isolate',record:true}],
    edges:[{from:'record',to:'child',kind:'contains'},{from:'child',to:'other',kind:'semantic'},
      {from:'child',to:'other',kind:'identifier-match'},{from:'other',to:'other',kind:'semantic'}],
  }]
  for(const scope of cases){
    const initial=initialPositions(scope,42),before=JSON.stringify(scope),initialBefore=JSON.stringify([...initial])
    const first=await calculateLive(engine,scope,initial),second=await calculateLive(engine,scope,initial)
    assert.equal(JSON.stringify(scope),before);assert.equal(JSON.stringify([...initial]),initialBefore)
    assert.equal(first.positions.size,scope.nodes.length)
    assert.deepEqual(first.positions,second.positions)
    for(const node of scope.nodes){const p=first.positions.get(node.id);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y))}
  }
})
