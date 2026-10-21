import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { validatePanelManifest } from '../src/panel-dsl.ts'
import { localizePanelManifest } from '../src/panel-i18n.ts'
const load = skill => {
  const dir = new URL(`../../skills-web-app/bundles/${skill}/`, import.meta.url)
  const manifest = parse(readFileSync(new URL('panel.yaml', dir), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(Object.entries(manifest.i18n.locales).map(([locale, path]) => [locale, JSON.parse(readFileSync(new URL(path, dir), 'utf8'))]))
  return manifest
}
test('native presentation declarations validate and localize text without changing storage bindings', () => {
  for (const skill of ['function_modules', 'flow_design', 'ai_agent_capabilities', 'page_design']) assert.deepEqual(validatePanelManifest(load(skill)), [], skill)
  const source = load('function_modules'), localized = localizePanelManifest(source, 'en-US')
  assert.equal(localized.ui.board.request_create.prompt, 'Please add the following function')
  assert.equal(localized.ui.board.details_title, 'Function details')
  assert.equal(localizePanelManifest(source, 'zh-CN').ui.board.details_title, '功能详情')
  assert.deepEqual(localized.ui.board.request_create.fields, source.ui.board.request_create.fields)
  assert.equal(localizePanelManifest(load('flow_design'), 'en-US').ui.diagram.tags[0].labels.core, 'High')
})
test('creation cannot bind hidden, readonly, foreign, repeated or malformed fields', () => {
  for (const fields of [['missing'], ['source'], ['rejected'], [], ['function_name', 'function_name'], 'function_name', null]) {
    const manifest = load('function_modules'); manifest.ui.board.request_create.fields = fields
    assert.ok(validatePanelManifest(manifest).length, JSON.stringify(fields))
  }
  const manifest = load('flow_design'); manifest.ui.diagram.tags[0].tones.core = 'execute'
  assert.ok(validatePanelManifest(manifest).length)
})

test('navigation captions cannot expose hidden, foreign or malformed fields', () => {
  for (const fields of [['id'], ['unknown'], ['page_type', 'page_type'], 'page_type', null]) {
    const manifest = load('page_design'); manifest.ui.navigation_map.nodes.caption_fields = fields
    assert.ok(validatePanelManifest(manifest).length, JSON.stringify(fields))
  }
})

test('diagram tags and detail hints cannot reveal hidden fields', () => {
  for (const key of ['tier', 'key_features']) {
    const manifest = load('flow_design')
    manifest.fields.find(field => field.key === key).hidden = true
    assert.ok(validatePanelManifest(manifest).length, key)
  }
})

test('board detail cover requires explicit scoped child sources', () => {
  // Neutral scoped-board fixture; the Agent Bundle no longer uses a board cover.
  const manifest = {version:1,panel_kind:'evidence_workbook',sections:[
    {id:'owners',title:'Owners'}, {id:'items',title:'Items'}
  ],fields:[
    {key:'name',control:'text',applies_to:['owners','items']},
    {key:'description',control:'textarea',applies_to:['owners']},
    {key:'group',control:'text',applies_to:['owners']},
    {key:'owner',control:'record_select',readonly:true,hidden:true,options_from_section:'owners',applies_to:['items']}
  ],ui:{component:'record_board',id:'board',source:'owners',board:{
    label:'name',description:'description',group:'group',detail_presentation:'cover',
    detail_sources:[{section:'items',reference:'owner'}]
  },children:[{component:'record_workspace',id:'child',sources:['items'],children:[{component:'record_inspector',id:'detail'}]}]}}
  assert.deepEqual(validatePanelManifest(manifest),[])
  delete manifest.ui.board.detail_sources
  assert.ok(validatePanelManifest(manifest).length)
  manifest.ui.board.detail_presentation = 'tabs'
  assert.ok(validatePanelManifest(manifest).length)
})

test('fixed optional detail mode is declared presentation, with a closed vocabulary', () => {
  const manifest = load('function_modules')
  assert.equal(manifest.ui.board.detail_fields_mode, 'fixed')
  for (const mode of ['fixed', 'on_demand']) {
    manifest.ui.board.detail_fields_mode = mode
    assert.deepEqual(validatePanelManifest(manifest), [])
  }
  delete manifest.ui.board.detail_fields_mode
  assert.deepEqual(validatePanelManifest(manifest), [])
  for (const mode of ['required', false, {}, null]) {
    manifest.ui.board.detail_fields_mode = mode
    assert.ok(validatePanelManifest(manifest).some(error => error.includes('detail_fields_mode')))
  }
})

test('long textarea viewports are opt-in bounded presentation, including nested record editors', () => {
  for (const rows of [3, 8, 20]) {
    const manifest = load('ai_agent_capabilities');manifest.fields.find(f=>f.key==='system_prompt').textarea_rows=rows
    assert.deepEqual(validatePanelManifest(manifest),[])
  }
  for (const rows of [0,2,21,3.5,'8',false,null]) {
    const manifest = load('ai_agent_capabilities');manifest.fields.find(f=>f.key==='system_prompt').textarea_rows=rows
    assert.ok(validatePanelManifest(manifest).some(e=>e.includes('textarea_rows')))
  }
  const manifest=load('ai_agent_capabilities');manifest.fields.find(f=>f.key==='name').textarea_rows=8
  assert.ok(validatePanelManifest(manifest).some(e=>e.includes('textarea_rows')))
  delete manifest.fields.find(f=>f.key==='name').textarea_rows
  // Skills now own independent records; nested entry context still uses the
  // same bounded leaf editor and must reject oversized declarations.
  const nested=manifest.fields.find(f=>f.key==='entries').item_fields.find(f=>f.key==='auto_context')
  nested.textarea_rows=8
  assert.deepEqual(validatePanelManifest(manifest),[])
  nested.textarea_rows=200
  assert.ok(validatePanelManifest(manifest).some(e=>e.includes('item_fields')&&e.includes('textarea_rows')))
})


test('board grouping is optional but an authored binding must remain valid', () => {
  const manifest = load('function_modules')
  delete manifest.ui.board.group
  assert.deepEqual(validatePanelManifest(manifest), [])
  for (const group of ['', null, false, {}, 'missing', '__proto__']) {
    manifest.ui.board.group = group
    assert.ok(validatePanelManifest(manifest).length, String(group))
  }
})
