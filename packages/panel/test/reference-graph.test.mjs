import test from 'node:test'
import assert from 'node:assert/strict'
import {projectReferenceGraph,referenceNodeKey} from '../src/reference-graph.ts'
test('reference projection preserves ownership, independent IDs and missing targets without writes',()=>{
 const bindings={nodes:[{source:'actors',label_field:'name'},{source:'resources',label_field:'name'}],links:[
  {source:'actors',field:'service',target:'resources',label:'Model',reverse:true},
  {source:'actors',field:'methods',target:'resources',label:'Skill'}]}
 const data={actors:{same:{id:'same',name:'Agent',service:'same',methods:['same','absent','same']}},resources:{same:{id:'same',name:'Resource',body:'Complete text'}}}
 const before=JSON.stringify(data),result=projectReferenceGraph(bindings,id=>data[id],id=>id)
 assert.equal(Object.keys(result.nodes).length,2);assert.equal(Object.keys(result.edges).length,2)
 assert.notEqual(referenceNodeKey('actors','same'),referenceNodeKey('resources','same'))
 const edge=Object.values(result.edges).find(x=>x.name==='Model')
 assert.equal(edge.source,referenceNodeKey('resources','same'))
 assert.equal(edge.target,referenceNodeKey('actors','same'))
 assert.equal(result.missing[0].id,'absent');assert.equal(result.missing[0].record,'same')
 for(const key of Object.keys(result.edges))assert.deepEqual(result.owners[key],{section:'actors',record:'same'})
 assert.equal(JSON.stringify(data),before)
})

test('nested target projection shares canonical records and never creates a second collaboration map',()=>{
 const bindings={nodes:[{source:'agents',label_field:'name'}],links:[{source:'agents',field:'handoffs',item_field:'target',target:'agents',label:'Handoff'}]}
 const data={agents:{a:{name:'A',handoffs:{one:{target:'b'},two:{target:'b'},draft:{},empty:{target:''},missing:{target:'gone'}}},b:{name:'B'}}}
 const before=structuredClone(data),result=projectReferenceGraph(bindings,id=>data[id],id=>id)
 assert.equal(Object.keys(result.edges).length,1)
 assert.equal(result.missing.length,1);assert.equal(result.missing[0].id,'gone')
 assert.deepEqual(Object.values(result.owners).at(-1),{section:'agents',record:'a'})
 assert.deepEqual(data,before)
})

test('root labels read the same canonical record without a projected title copy or write',()=>{
 const bindings={nodes:[{source:'facts',label_field:'title',label_scope:'record'}],links:[]}
 const canonical={a:{title:'Root title',details:{parent:'b'}},b:{title:' ',details:{}}}
 const before=structuredClone(canonical)
 const view=projectReferenceGraph(bindings,()=>Object.fromEntries(Object.entries(canonical).map(([id,value])=>[id,value.details])),()=>'',()=>canonical)
 assert.equal(view.nodes[referenceNodeKey('facts','a')].name,'Root title')
 assert.equal(view.nodes[referenceNodeKey('facts','b')].name,'b','empty root labels fall back to identity')
 assert.deepEqual(canonical,before)
})
test('finite target resolution keeps dangling and ambiguous values without inventing edges',()=>{
 const bindings={nodes:['groups','items'].map(source=>({source,label_field:'name'})),links:[{source:'items',field:'parent',targets:['groups','items'],reverse:true}]}
 const data={groups:{g:{name:'Group'},same:{name:'Group same'}},items:{a:{name:'A',parent:'g'},b:{name:'B',parent:'a'},c:{name:'C',parent:'gone'},d:{name:'D',parent:'same'},same:{name:'Item same'}}}
 const before=structuredClone(data),view=projectReferenceGraph(bindings,id=>data[id],id=>id)
 assert.equal(Object.keys(view.edges).length,2)
 assert.deepEqual(view.missing.map(value=>[value.id,value.reason]),[['gone','missing'],['same','ambiguous']])
 assert.deepEqual(Object.values(view.edges).map(value=>value.source),[referenceNodeKey('groups','g'),referenceNodeKey('items','a')])
 assert.deepEqual(data,before)
})
