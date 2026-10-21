import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { validatePanelManifest } from '../../core/src/panel-dsl.ts'
const dom=new JSDOM('<div id="root"></div>',{url:'https://panel.test/'})
for(const key of ['window','document','HTMLElement','Element','Node'])globalThis[key]=dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react');globalThis.React=React
const {createRoot}=await import('react-dom/client')
const {renderManifest,applyPanelUpdatesToDraft}=await import('../src/interpreter.ts')
const {insertVisualRecord}=await import('../src/visual-components.tsx')
const manifest={version:1,panel_kind:'evidence_workbook',sections:[
 {id:'systems',title:'系统',records_path:'sections.systems.records',create:{id_field:'id',defaults:{title:'新系统',source_refs:[]}},form:{header:{variant:'detail',title:{field:'title',editable:true}}}},
 {id:'systemDetails',title:'职责',records_path:'sections.systems.records',fields_path:'details',add_mode:'none'},
 {id:'exchanges',title:'交换',records_path:'sections.exchanges.records',create:{id_field:'id',defaults:{title:'新交换',source_refs:[]}},form:{header:{variant:'detail',title:{field:'title',editable:true}}}},
 {id:'exchangeDetails',title:'交换',records_path:'sections.exchanges.records',fields_path:'details',navigation:'contextual',add_mode:'context',create:{defaults:{}}},
 {id:'unrelated',title:'其他'},
],fields:[
 {key:'title',label:'名称',control:'text',applies_to:['systems','exchanges']},
 {key:'responsibility',label:'负责什么',control:'text',applies_to:['systemDetails']},
 {key:'parent',label:'来源系统',control:'record_multi_select',options_from_section:'systems',applies_to:['exchangeDetails']},
 {key:'purpose',label:'交换目的',control:'text',applies_to:['exchangeDetails']},
],ui:{id:'workspace',component:'record_workspace',sources:['systems','exchangeDetails'],children:[{id:'inspector',component:'record_inspector',sources:['systems','systemDetails','exchanges','exchangeDetails']}]}}
test('same-record projections reject unrelated, unknown and duplicate sources',()=>{
 assert.deepEqual(validatePanelManifest(manifest),[])
 for(const sources of [['unrelated'],['absent'],['systems','systems'],[]]){
  const p=structuredClone(manifest);p.ui.children[0].sources=sources;assert.ok(validatePanelManifest(p).length,JSON.stringify(sources))
 }
})
test('inspector displays root title and nested business fields; contextual creation keeps root identity and existing data',async()=>{
 const root=createRoot(document.getElementById('root'))
 let data={sections:{systems:{records:{erp:{id:'erp',title:'ERP',source_refs:['proof:erp'],details:{responsibility:'管理供应商'}}}},exchanges:{records:{x:{id:'x',title:'准入回传',source_refs:['proof:x'],details:{parent:['erp'],purpose:'同步供应商编码'}}}}}}
 const before=structuredClone(data)
 const options={editable:true,locale:'zh-CN',onPanelUpdate:changes=>{data=applyPanelUpdatesToDraft(data,changes)}}
 const show=()=>React.act(async()=>root.render(renderManifest(manifest,data,options)))
 try{
  await show()
  assert.equal(document.querySelector('input[aria-label="名称"]').value,'ERP')
  assert.equal(document.querySelector('[data-field="responsibility"] input').value,'管理供应商')
  assert.equal(document.querySelectorAll('.dsh-record-inspector .dsh-design-record-title').length,1)
  assert.equal(document.querySelector('[data-section="systems"] .dsh-design-record-fields'),null,'a title-only projection adds no empty body or spacing row')
  const child=[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('aria-label')==='准入回传');assert.ok(child)
  await React.act(async()=>child.click())
  assert.equal(document.querySelector('.dsh-record-inspector-back'),null,'the workspace navigator already owns navigation; references do not create a second back trail')
  assert.equal(document.querySelector('input[aria-label="名称"]').value,'准入回传')
  const input=document.querySelector('[data-field="purpose"] input')
  await React.act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'改为人工确认后同步');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}))})
  assert.equal(data.sections.exchanges.records.x.details.purpose,'改为人工确认后同步')
  assert.deepEqual(data.sections.exchanges.records.x.source_refs,before.sections.exchanges.records.x.source_refs)
  assert.deepEqual(data.sections.systems,before.sections.systems)
  const id=insertVisualRecord({manifest,data,options,node:manifest.ui},'exchangeDetails',{parent:['erp']})
  assert.equal(data.sections.exchanges.records[id].id,id)
  assert.equal(data.sections.exchanges.records[id].title,'新交换')
  assert.deepEqual(data.sections.exchanges.records[id].details,{parent:['erp']})
  assert.deepEqual(data.sections.exchanges.records[id].source_refs,[])
 }finally{await React.act(async()=>root.unmount());dom.window.close()}
})
