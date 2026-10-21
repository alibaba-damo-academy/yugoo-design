import test from 'node:test'
import assert from 'node:assert/strict'
import {stressPositions} from './preview-stress.mjs'
const nodes=Array.from({length:4},(_,i)=>({id:String(i)}))
const edges=nodes.flatMap((a,i)=>nodes.slice(i+1).map(b=>({from:a.id,to:b.id})))
test('2D/3D stress: deterministic, same inputs preserved, genuinely spatial solution',()=>{
  const graph=structuredClone({nodes,edges}), before=JSON.stringify(graph)
  for(const node of graph.nodes)Object.freeze(node)
  for(const edge of graph.edges)Object.freeze(edge)
  Object.freeze(graph.nodes);Object.freeze(graph.edges);Object.freeze(graph)
  const two=stressPositions(graph,'stress2'), three=stressPositions(graph,'stress3')
  assert.deepEqual(three,stressPositions(graph,'stress3'))
  assert.equal(JSON.stringify(graph),before)
  assert.ok(two.every(([,p])=>p.z===0))
  assert.ok(three.every(([,p])=>Object.values(p).every(Number.isFinite)))
  const p=three.map(([,p])=>p)
  // Complete graph K4 should fit a tetrahedron with edge length 140.
  for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)assert.ok(Math.abs(Math.hypot(p[i].x-p[j].x,p[i].y-p[j].y,p[i].z-p[j].z)-140)<1)
  assert.ok(Math.max(...p.map(p=>p.z))-Math.min(...p.map(p=>p.z))>50)
})
test('empty, isolated, duplicate and missing endpoints are safe',()=>{
  assert.deepEqual(stressPositions({nodes:[],edges:[]},'stress3'),[])
  const result=stressPositions({nodes,edges:[edges[0],edges[0],{from:'0',to:'missing'}]},'stress3')
  assert.equal(result.length,4)
  assert.ok(result.every(([,p])=>Object.values(p).every(Number.isFinite)))
})
test('restored views keep graph facts and support both dimensions',()=>{
  const graph={nodes:nodes.map((n,i)=>({...n,file:i<2?'a.json':'b.json'})),edges:edges.slice(0,4)}
  const before=JSON.stringify(graph)
  for(const dimension of ['stress2','stress3']){
    const base=stressPositions(graph,dimension)
    for(const view of ['original','focus','natural','source']){
      const result=stressPositions(graph,dimension+'-'+view)
      assert.equal(result.length,4)
      assert.ok(result.every(([,p])=>Object.values(p).every(Number.isFinite)))
      if(view==='natural'||view==='source')assert.notDeepEqual(result,base)
      if(dimension==='stress2')assert.ok(result.every(([,p])=>p.z===0))
    }
    const renamed={...graph,nodes:graph.nodes.map(n=>({...n,file:n.file==='a.json'?'z.json':'a.json'}))}
    assert.deepEqual(stressPositions(graph,dimension+'-source'),stressPositions(renamed,dimension+'-source'))
  }
  assert.equal(JSON.stringify(graph),before)
})
test('source cohesion crosses disconnected graph components without inventing edges',()=>{
  const graph={nodes:[
    {id:'a',file:'shared.json'},{id:'x',file:'x.json'},
    {id:'b',file:'shared.json'},{id:'y',file:'y.json'},
  ],edges:[{from:'a',to:'x'},{from:'b',to:'y'}]}
  const distance=(positions,a,b)=>{const p=new Map(positions);return Math.hypot(p.get(a).x-p.get(b).x,p.get(a).y-p.get(b).y,p.get(a).z-p.get(b).z)}
  for(const dimension of ['stress2','stress3']){
    const base=stressPositions(graph,dimension),source=stressPositions(graph,dimension+'-source')
    assert.ok(distance(source,'a','b')<distance(base,'a','b')*.75)
    assert.ok(distance(source,'a','b')<140)
  }
  assert.deepEqual(graph.edges,[{from:'a',to:'x'},{from:'b',to:'y'}])
})
test('large expanded graphs use bounded landmark stress',()=>{
  const nodes=Array.from({length:720},(_,i)=>({id:String(i),file:`${i%12}.json`}))
  const graph={nodes,edges:nodes.slice(1).map((node,i)=>({from:String(i),to:node.id}))}
  const started=Date.now(),result=stressPositions(graph,'stress2-source')
  assert.equal(result.length,nodes.length)
  assert.ok(result.every(([,point])=>Object.values(point).every(Number.isFinite)))
  assert.ok(Date.now()-started<5000)
})
