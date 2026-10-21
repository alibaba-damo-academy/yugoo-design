import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { installSelectDom } from './select-interaction.mjs'
import { validatePanelManifest } from '../../core/src/panel-dsl.ts'
import { projectRecordHierarchy } from '../src/record-hierarchy.ts'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window','document','HTMLElement','HTMLFormElement','Element','Node','MutationObserver','CustomEvent']) globalThis[key] = dom.window[key]
installSelectDom(dom.window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderManifest, applyPanelUpdatesToDraft } = await import('../src/interpreter.ts')
const roots=['modules','functions'], views=['moduleDetails','functionDetails']
const manifest={version:1,panel_kind:'evidence_workbook',sections:roots.flatMap((source,i)=>[
 {id:source,title:source,item_name:source,records_path:`sections.${source}.records`,create:{id_field:'id',defaults:{title:'New item',summary:''}},confirm_delete:true},
 {id:views[i],title:source,item_name:source,records_path:`sections.${source}.records`,fields_path:'details',add_mode:i?'context':'default'}]),
 fields:[{key:'title',label:'Name',control:'text',applies_to:roots},{key:'summary',label:'Description',control:'textarea',applies_to:roots},
 {key:'questions',label:'Unresolved',control:'list',applies_to:roots},{key:'parent',label:'Parent',control:'record_select',options_from_sections:views,applies_to:views},
 {key:'rule',label:'Rule',control:'text',applies_to:views}],
 ui:{id:'workspace',component:'record_workspace',sources:views,navigation_hierarchy:{field:'parent',root_source:views[0],child_source:views[1]},children:[{
 id:'inspector',component:'record_inspector',sources:roots.flatMap((s,i)=>[s,views[i]]),record_cards:{label:'title',description:'summary',details_title:'Details',attention_fields:['questions']},children:[{
 id:'children',component:'record_related_editor',title:'Functions',source:views[1],sources:[roots[1],views[1]],bindings:{reference:'parent'},record_cards:{label:'title',description:'summary',details_title:'Details',attention_fields:['questions']}}]}]}}
test('reading/navigation declaration rejects missing bindings and unrelated projections',()=>{
 assert.deepEqual(validatePanelManifest(manifest),[])
 for(const mutate of [m=>m.ui.children[0].record_cards.label='absent',m=>m.ui.navigation_hierarchy.field='rule',m=>m.ui.children[0].children[0].sources=['modules']]){
  const next=structuredClone(manifest);mutate(next);assert.ok(validatePanelManifest(next).length)
 }
})
test('hierarchy preserves unresolved, ambiguous and cyclic records instead of hiding them',()=>{
 const rows=[{section:'a',id:'root',parent:''},{section:'b',id:'leaf',parent:'root'},{section:'b',id:'orphan',parent:'missing'},
 {section:'a',id:'same',parent:''},{section:'b',id:'same',parent:''},{section:'b',id:'ambiguous',parent:'same'},
 {section:'a',id:'x',parent:'y'},{section:'b',id:'y',parent:'x'}]
 const p=projectRecordHierarchy(rows)
 assert.equal(p.parents.size,1);assert.equal(p.roots.length,7);assert.equal(p.issues.size,4)
})
test('reading cards keep canonical fields editable, create in context and delete through the existing ownership contract',async()=>{
 const root=createRoot(document.getElementById('root'))
 let data={sections:{modules:{records:{m:{id:'m',title:'Purchasing',summary:'Coordinate purchases.',questions:['Confirm scope'],source_refs:['doc:1'],details:{parent:'',rule:'Only approved items'}}}},functions:{records:{f:{id:'f',title:'Create order',summary:'Start from approved demand.',questions:[],details:{parent:'m',rule:'Preserve source demand'}}}}}}
 const show=()=>React.act(async()=>root.render(renderManifest(manifest,data,{locale:'en-US',editable:true,onPanelUpdate:updates=>{data=applyPanelUpdatesToDraft(data,updates)}})))
 try{
  await show()
  assert.equal(document.querySelectorAll('[data-board-record]').length,2)
  assert.equal(document.querySelector('.dsh-reading-card-details').open,false)
  assert.ok(document.querySelector('.dsh-reading-card-attention').textContent.includes('Confirm scope'))
  const card=document.querySelector('[data-board-record="f"]')
  const edit=card.querySelector('.dsh-record-board-actions button');await React.act(async()=>edit.click())
  const input=card.querySelector('textarea');await React.act(async()=>{
   Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(input,'Order only from accepted demand.');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}))})
  const save=[...card.querySelectorAll('button')].find(b=>b.textContent==='Save');assert.ok(save);await React.act(async()=>save.click());await show()
  assert.equal(data.sections.functions.records.f.summary,'Order only from accepted demand.')
  assert.equal(data.sections.functions.records.f.details.parent,'m')
  assert.deepEqual(data.sections.modules.records.m.source_refs,['doc:1'])
  const add=document.querySelector('.dsh-record-related-add');await React.act(async()=>add.click());await show()
  const added=Object.values(data.sections.functions.records).find(r=>r.id!=='f');assert.equal(added.details.parent,'m');assert.equal(added.title,'New item')
  // Read-only content never exposes a destructive or edit action.
  await React.act(async()=>root.render(renderManifest(manifest,data,{locale:'en-US',editable:false})))
  assert.equal(document.querySelector('.dsh-reading-card-remove'),null)
  await show();window.confirm=()=>false
  await React.act(async()=>document.querySelector('[data-board-record="f"] .dsh-reading-card-remove').click())
  assert.ok(data.sections.functions.records.f)
  window.confirm=()=>true;await React.act(async()=>document.querySelector('[data-board-record="f"] .dsh-reading-card-remove').click());assert.equal(data.sections.functions.records.f,undefined)
 } finally {await React.act(async()=>root.unmount());dom.window.close()}
})
