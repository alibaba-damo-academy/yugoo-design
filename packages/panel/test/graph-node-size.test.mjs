import test from 'node:test'
import assert from 'node:assert/strict'
import {recordReach,nodeRadius,layoutDiameter} from './graph-node-size.mjs'

test('reach counts distinct other records, not fields, containment, direction or parallel edges',()=>{
  const graph={nodes:['a','b','c','isolated'].map(id=>({id,record:true})).concat([{id:'a1'},{id:'a2'},{id:'b1'}]),edges:[
    {from:'a',to:'a1',kind:'contains'},{from:'a1',to:'a2',kind:'semantic'},
    {from:'a1',to:'b1',kind:'semantic'},{from:'a2',to:'b',kind:'identifier-match'},
    {from:'b',to:'a',kind:'semantic'},{from:'b',to:'c',kind:'knowledge'},
    {from:'a',to:'c',kind:'contains'},{from:'a',to:'missing',kind:'semantic'},
  ]}
  const owners=new Map([['a','a'],['a1','a'],['a2','a'],['b','b'],['b1','b'],['c','c'],['isolated','isolated']])
  const before=JSON.stringify(graph),counts=recordReach(graph,owners)
  assert.deepEqual([...counts],[['a',1],['b',2],['c',1],['isolated',0]])
  assert.equal(JSON.stringify(graph),before)
})

test('area encoding is monotonic, capped, and excludes children; geometry grows with radius',()=>{
  const record={id:'a',record:true},child={id:'c',record:false}
  const r=count=>nodeRadius(record,'reach',new Map([['a',count]]))
  assert.equal(r(0),2.5);assert.equal(r(48),Math.sqrt(438.25));assert.equal(r(1000),r(48))
  for(let i=1;i<=48;i++){assert.ok(r(i)>r(i-1));assert.ok(Math.abs(r(i)**2-r(i-1)**2-9)<1e-10)}
  assert.equal(nodeRadius(record,'uniform',new Map([['a',1000]])),4)
  assert.equal(nodeRadius(child,'reach',new Map([['c',1000]])),2)
  assert.equal(layoutDiameter(record),24)
  assert.equal(layoutDiameter(record,new Map([['a',12]])),48)
  assert.equal(layoutDiameter(child,new Map([['c',3]])),24)
})
