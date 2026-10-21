import test, {after} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
const dom=new JSDOM('<div id="root"></div>',{url:'https://panel.test/'})
for(const key of ['window','document','HTMLElement','Element','Node'])globalThis[key]=dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react');globalThis.React=React
const {createRoot}=await import('react-dom/client')
const {renderManifest,applyDesignEditToDraft}=await import('../src/interpreter.ts')
test('lifecycle matrix edits the root axis title and nested action effect without splitting facts',async()=>{
 const manifest={version:1,panel_kind:'lifecycle',sections:[
  {id:'axisRecords',title:'轴',records_path:'facts.axes'},
  {id:'axes',title:'轴属性',records_path:'facts.axes',fields_path:'details'},
  {id:'objects',title:'单据',records_path:'facts.objects'},
  {id:'actions',title:'动作',records_path:'facts.actions',fields_path:'details'},
 ],fields:[{key:'title',label:'名称',control:'text',applies_to:['axisRecords']},{key:'axis_effects',label:'状态变化',control:'key_value',applies_to:['actions']}],ui:{id:'lifecycle',component:'doc_lifecycle_studio'}}
 let data={facts:{axes:{response:{id:'response',title:'响应状态',source_refs:['proof:axis'],details:{object_ref:'order'}}},objects:{order:{id:'order',title:'订单'}},actions:{confirm:{id:'confirm',title:'确认订单',details:{axis_effects:{response:'已确认'}}}}}}
 const root=createRoot(document.getElementById('root'));const edits=[]
 const render=()=>React.act(async()=>root.render(renderManifest(manifest,data,{editable:true,onEdit:edit=>{edits.push(edit);data=applyDesignEditToDraft(data,manifest,edit)}})))
 const fill=async(selector,value)=>React.act(async()=>{const el=document.querySelector(selector);assert.ok(el,selector);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}))})
 try{
  await render();await fill('.dsh-design-studio-axis-title','供应商响应阶段');await render()
  assert.equal(edits[0].section,'axisRecords');assert.equal(data.facts.axes.response.title,'供应商响应阶段');assert.equal(data.facts.axes.response.details.title,undefined);assert.deepEqual(data.facts.axes.response.source_refs,['proof:axis'])
  await fill('input[aria-label="确认订单 在 供应商响应阶段 的效果"]','确认完成');await render()
  assert.equal(data.facts.actions.confirm.details.axis_effects.response,'确认完成');assert.equal(data.facts.axes.response.details.object_ref,'order')
 }finally{await React.act(async()=>root.unmount())}
})

after(()=>dom.window.close())

test('selected document scopes its matrix but retains cross-document effects, edits and action ledger',async()=>{
 const manifest={version:1,panel_kind:'lifecycle',sections:[
  {id:'documents',title:'单据',records_path:'facts.objects'},
  {id:'objects',title:'单据属性',records_path:'facts.objects',fields_path:'details'},
  {id:'axes',title:'状态',records_path:'facts.axes',fields_path:'details'},
  {id:'actions',title:'动作',records_path:'facts.actions',fields_path:'details'},
 ],fields:[{key:'title',label:'名称',control:'text',applies_to:['documents']},{key:'axis_effects',label:'状态变化',control:'key_value',applies_to:['actions']},{key:'qty_note',label:'数量',control:'text',applies_to:['actions']}],
 ui:{id:'workspace',component:'record_workspace',sources:['documents'],children:[{id:'detail',component:'record_inspector',children:[{id:'lifecycle',component:'doc_lifecycle_studio',bindings:{movement_sign:'movement_sign',movement_qty:'qty_note',object_ref:'parent_object_ref'}}]}]}}
 let data={facts:{objects:{order:{id:'order',title:'订单',details:{}},line:{id:'line',title:'订单行',details:{parent_object_ref:'order'}},receipt:{id:'receipt',title:'收货',details:{}}},axes:{main:{id:'main',title:'整单状态',details:{object_ref:'order'}},line:{id:'line',title:'行状态',details:{object_ref:'line'}},received:{id:'received',title:'收货状态',details:{object_ref:'receipt'}}},actions:{confirm:{id:'confirm',title:'确认所选行',details:{object_ref:'order',axis_effects:{main:'按行汇总',line:'已确认'}}},deliver:{id:'deliver',title:'记录收货',details:{object_ref:'receipt',movement_sign:'+',qty_note:'实际数量',axis_effects:{received:'已收货'}}}}}}
 const root=createRoot(document.getElementById('root'));const edits=[]
 const render=async(editable=true)=>React.act(async()=>root.render(renderManifest(manifest,data,{editable,onEdit:edit=>{edits.push(edit);data=applyDesignEditToDraft(data,manifest,edit)}})))
 const click=async(label)=>React.act(async()=>{const e=document.querySelector(`button[aria-label="${label}"]`);assert.ok(e,label);e.click()})
 const fill=async(selector,value)=>React.act(async()=>{const el=document.querySelector(selector);assert.ok(el,selector);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}))})
 try{
  await render()
  assert.match(document.querySelector('[data-testid="studio-matrix"]').textContent,/订单行 · 行状态/)
  assert.doesNotMatch(document.querySelector('[data-testid="studio-matrix"]').textContent,/记录收货|收货状态/)
  await fill('input[aria-label="确认所选行 在 行状态 的效果"]','仅所选行已确认');await render()
  assert.equal(data.facts.actions.confirm.details.axis_effects.line,'仅所选行已确认')
  await click('订单行')
  assert.match(document.querySelector('[data-testid="studio-matrix"]').textContent,/确认所选行/)
  assert.match(document.querySelector('[data-testid="studio-matrix"]').textContent,/订单 · 整单状态/)
  await click('收货')
  assert.doesNotMatch(document.querySelector('[data-testid="studio-matrix"]').textContent,/确认所选行/)
  assert.match(document.querySelector('[data-testid="studio-ledger"]').textContent,/记录收货/)
  await fill('input[aria-label="记录收货 数量说明"]','按实收数量');await render()
  assert.equal(data.facts.actions.deliver.details.qty_note,'按实收数量')
  assert.equal(data.facts.objects.receipt.details.qty_note,undefined)
  await render(false)
  assert.equal(document.querySelectorAll('[data-testid="doc-lifecycle-studio"] input').length,0)
  assert.match(document.querySelector('[data-testid="studio-ledger"]').textContent,/按实收数量/)
  assert.equal(edits.length,2)
 }finally{await React.act(async()=>root.unmount())}
})
