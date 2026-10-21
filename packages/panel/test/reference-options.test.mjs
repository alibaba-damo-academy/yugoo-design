import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderManifest } from '../src/interpreter.ts'

const view={version:1,panel_kind:'document',sections:[{id:'groups',title:'Groups'},{id:'items',title:'Items'}],fields:[
 {key:'name',control:'text',applies_to:['groups','items']},
 {key:'parent',label:'Parent',control:'record_select',applies_to:['items'],options_from_sections:['groups','items']},
 {key:'related',label:'Related',control:'record_multi_select',applies_to:['items'],options_from_sections:['groups','items']},
],ui:{id:'form',component:'record_form',source:'items'}}
test('finite reference choices retain ambiguous and missing saved values without clearing or guessing',()=>{
 const data={groups:{group:{name:'Group'},shared:{name:'Group shared'}},items:{item:{name:'Item',parent:'shared',related:['missing','shared']},shared:{name:'Item shared'}}}
 const before=structuredClone(data),edits=[]
 const html=renderToStaticMarkup(renderManifest(view,data,{editable:true,locale:'en-US',onEdit:edit=>edits.push(edit)}))
 assert.match(html,/shared \(ambiguous reference; clarify the target\)/)
 assert.match(html,/missing \(invalid reference\)/)
 assert.doesNotMatch(html,/Group shared|Item shared<\/span>.*role="option"/)
 assert.deepEqual(edits,[]);assert.deepEqual(data,before)
 const readonly=renderToStaticMarkup(renderManifest(view,data,{locale:'en-US'}))
 assert.match(readonly,/ambiguous reference/);assert.match(readonly,/invalid reference/)
})
