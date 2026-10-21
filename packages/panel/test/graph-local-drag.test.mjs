import test from 'node:test'
import assert from 'node:assert/strict'
import {solveLocalDrag,dragNeighbors} from './graph-local-drag.mjs'
test('native fCoSE local drag changes neighbors, not remote nodes or graph facts',()=>{
  const scope={nodes:['a','b','c','d','z'].map(id=>({id,record:true})),edges:[{from:'a',to:'b',kind:'contains'},{from:'b',to:'c',kind:'semantic'},{from:'c',to:'d',kind:'semantic'}]}
  const positions=new Map([['a',{x:0,y:0}],['b',{x:80,y:0}],['c',{x:220,y:0}],['d',{x:360,y:0}],['z',{x:0,y:400}]])
  const before=JSON.stringify(scope),p=JSON.stringify([...positions]),point={x:0,y:100}
  const result=solveLocalDrag(scope,positions,'a',point)
  assert.deepEqual([...dragNeighbors(scope,'a')],['b'])
  assert.deepEqual(result.positions.get('a'),point)
  for(const id of ['c','d','z'])assert.deepEqual(result.positions.get(id),positions.get(id))
  assert.ok(Math.hypot(result.positions.get('b').x-80,result.positions.get('b').y)>1)
  assert.ok([...result.positions.values()].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))
  assert.equal(JSON.stringify(scope),before);assert.equal(JSON.stringify([...positions]),p)
})
test('isolate drag has no relaxation and scaled coordinates keep remote anchors exact',()=>{
  const scope={nodes:[{id:'a'},{id:'b'}],edges:[]},positions=new Map([['a',{x:10,y:15}],['b',{x:200,y:300}]])
  const result=solveLocalDrag(scope,positions,'a',{x:80,y:90},{spacing:1.5})
  assert.equal(result.milliseconds,0);assert.equal(result.moving.size,0)
  assert.deepEqual(result.positions.get('b'),positions.get('b'))
  assert.throws(()=>solveLocalDrag(scope,positions,'missing',{x:0,y:0}))
  for(const spacing of [Infinity,NaN,0,-1])assert.throws(()=>solveLocalDrag(scope,positions,'a',{x:0,y:0},{spacing}))
  assert.throws(()=>solveLocalDrag({nodes:[],edges:[]},positions,'a',{x:0,y:0}))
})
