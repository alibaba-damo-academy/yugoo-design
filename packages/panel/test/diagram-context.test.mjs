import test from 'node:test'
import assert from 'node:assert/strict'
import { diagramContextRecords, diagramNodeForElement } from '../src/diagram-context.ts'
const manifest = { sections: [
 {id:'steps',records_path:'steps.records',fields_path:'details',order:'steps.order'},
 {id:'rules',records_path:'rules.records',fields_path:'details'}
] }
const group={source:'steps',process_field:'process',element_field:'element',label_field:'name',sections:['steps']}
const data={steps:{records:{
 a:{title:'A',details:{process:'first',element:'Task_1'}},
 b:{title:'B',details:{process:'second',element:'Task_1'}},
 c:{title:'C',details:{process:'first',element:'Task_2'}}
},order:['c','a','b']},rules:{records:{
 r1:{details:{process:'first',step:'a'}},r2:{details:{process:'first',step:'c'}},r3:{details:{process:'second',step:'a'}}
}}}
test('diagram clicks resolve in the current process, preserve order, and never mutate canonical records',()=>{
 const before=structuredClone(data)
 assert.deepEqual(diagramContextRecords(manifest,data,group,'first').map(x=>x.id),['c','a'])
 assert.equal(diagramNodeForElement(manifest,data,group,'first','Task_1')?.id,'a')
 assert.equal(diagramNodeForElement(manifest,data,group,'second','Task_1')?.id,'b')
 assert.equal(diagramNodeForElement(manifest,data,group,'first','unknown'),undefined)
 assert.deepEqual(data,before)
})
test('ambiguous node bindings never select a guessed record; related details stay scoped',()=>{
 const bad=structuredClone(data);bad.steps.records.c.details.element='Task_1'
 assert.equal(diagramNodeForElement(manifest,bad,group,'first','Task_1'),undefined)
 const rules={source:'rules',process_field:'process',node_field:'step',sections:['rules']}
 assert.deepEqual(diagramContextRecords(manifest,data,rules,'first','a').map(x=>x.id),['r1'])
 assert.deepEqual(diagramContextRecords(manifest,data,rules,'first').map(x=>x.id),['r1','r2'])
})

test('approval may resolve its process through an exact step reference without inventing missing bindings',()=>{
 const next=structuredClone(data); delete next.rules.records.r1.details.process
 const rules={source:'rules',process_field:'process',node_field:'step',sections:['rules']}
 assert.deepEqual(diagramContextRecords(manifest,next,rules,'first','a',group).map(x=>x.id),['r1'])
 next.rules.records.r1.details.step='missing'
 assert.deepEqual(diagramContextRecords(manifest,next,rules,'first','a',group),[])
})
