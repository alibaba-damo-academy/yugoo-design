import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePanelManifest } from '../src/panel-dsl.ts'
const make=()=>({version:1,panel_kind:'document',sections:['actors','models','tools'].map(id=>({id,title:id})),fields:[
  {key:'name',control:'text',applies_to:['actors','models','tools']},
  {key:'description',control:'textarea',applies_to:['actors','models','tools']},
  {key:'model',control:'record_select',applies_to:['actors'],options_from_section:'models'},
  {key:'tools',control:'record_multi_select',applies_to:['actors'],options_from_section:'tools'},
  {key:'entries',control:'record_map',applies_to:['actors'],item_fields:[{key:'name',control:'text'},{key:'location',control:'textarea'}]},
],ui:{component:'record_workspace',id:'workspace',sources:['actors','models','tools'],workspace_view:'switch',children:[
  {component:'reference_graph',id:'graph',references:{nodes:['actors','models','tools'].map(source=>({source,label_field:'name',description_field:'description',icon:'network'})),links:[{source:'actors',field:'model',target:'models',reverse:true},{source:'actors',field:'tools',target:'tools'}],layout:{kind:'hub',center:'actors',top:'models',right:'tools',group_by:'model',value_field:'description',entries:{field:'entries',title_field:'name',description_field:'location'}}}},
  {component:'record_inspector',id:'inspector'},
]}})
test('bounded hub layout accepts declared relationships and legacy omission',()=>{
  const panel=make();assert.deepEqual(validatePanelManifest(panel),[])
  panel.ui.children[0].references.layout.center_presentation='portrait';assert.deepEqual(validatePanelManifest(panel),[])
  delete panel.ui.children[0].references.layout;assert.deepEqual(validatePanelManifest(panel),[])
})
test('hub layout rejects invented sections, implicit groups, unknown fields and executable options',()=>{
  for(const change of [
    refs=>refs.layout=null,refs=>refs.layout=[],refs=>refs.layout.kind='script',refs=>refs.layout.code='run()',
    refs=>refs.layout.top='actors',refs=>delete refs.layout.right,refs=>refs.layout.bottom='missing',
    refs=>refs.layout.group_by='description',refs=>refs.links.shift(),refs=>refs.links[0]=null,refs=>refs.layout.value_field='tools',
    refs=>refs.layout.entries.field='description',refs=>refs.layout.entries.title_field='missing',
    refs=>refs.layout.entries.expression='run()',refs=>refs.nodes[0].icon='custom-import',
    refs=>refs.nodes[0].description_field='missing',refs=>refs.layout.center_presentation='https://avatar.example/image.svg',
  ]){const panel=make();change(panel.ui.children[0].references);assert.ok(validatePanelManifest(panel).length>0)}
})
test('kind icons bind only declared options and finite decorative symbols',()=>{
  const panel=make(),node=panel.ui.children[0].references.nodes[2]
  panel.fields.push({key:'kind',control:'radio',applies_to:['tools'],options:[{value:'library',label:'Library'},{value:'memory',label:'Memory'}]})
  node.kind_field='kind';node.kind_icons={library:'book-open',memory:'database'}
  assert.deepEqual(validatePanelManifest(panel),[])
  for(const invalid of [null,[],{unknown:'database'},{library:'https://example.test/avatar.svg'},{library:'__proto__'}]){
    node.kind_icons=invalid;assert.ok(validatePanelManifest(panel).length>0)
  }
  node.kind_icons={library:'book-open'};delete node.kind_field
  assert.ok(validatePanelManifest(panel).length>0,'cannot infer a kind from the resource name')
})
