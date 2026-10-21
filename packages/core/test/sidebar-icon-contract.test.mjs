import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { SIDEBAR_ICONS, validatePanelManifest, localizePanelManifest } from '../src/panel-dsl.ts'
import { SIDEBAR_TITLE_COMPONENT_KINDS } from '../src/panel-component-catalog.ts'
import { loadDesignKit } from '../src/kit-loader.ts'
import { questionContext as context } from './fixtures/declarative-question.mjs'
import { basicGenericManifest } from '../src/auto-panel-generation.ts'
import { autoPanelSnapshot } from '../src/auto-panel-spec.ts'

const fs = {
  readText: async path => {
    try { return await readFile(path, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  },
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
}
function nodes(node) {
  return [node, ...(node.children ?? []).flatMap(nodes), ...Object.values(node.slots ?? {}).flatMap(nodes)]
}
const simple = (component = 'question_workspace', icon) => ({
  version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'questions', title: 'Questions' }], fields: [],
  ui: { id: 'questions', component, source: 'questions', title: 'Questions', ...(icon === undefined ? {} : { sidebar_icon: icon }) },
})

test('authored sidebar icon vocabulary is finite and supports only owning titles', () => {
  assert.equal(new Set(SIDEBAR_ICONS).size, SIDEBAR_ICONS.length)
  assert.equal(SIDEBAR_ICONS.length, 21)
  assert.equal(SIDEBAR_TITLE_COMPONENT_KINDS.length, 10)
  for (const icon of SIDEBAR_ICONS) assert.deepEqual(validatePanelManifest(simple('question_workspace', icon)), [])
  assert.deepEqual(validatePanelManifest(simple()), [], 'legacy omission remains valid')
  for (const kind of SIDEBAR_TITLE_COMPONENT_KINDS) {
    // Component-specific bindings remain independently validated; this checks
    // the finite-property permission rather than suppressing those errors.
    assert.ok(!validatePanelManifest(simple(kind, 'bell')).some(error => error.includes('sidebar_icon')), kind)
  }
  for (const bad of ['', 'unknown', '__proto__', 'constructor', 'toString', 'https://example.test/icon.svg',
    '<svg/>', 'import("icons")', '$t:icon', null, false, 16, [], { name: 'bell' }]) {
    assert.ok(validatePanelManifest(simple('question_workspace', bad)).some(error => error.includes('invalid sidebar_icon')), JSON.stringify(bad))
  }
  for (const kind of ['stack', 'panel_workspace', 'record_form', 'question_list', 'text_block']) {
    assert.ok(validatePanelManifest(simple(kind, 'bell')).some(error => error.includes('requires a component with a sidebar title')), kind)
  }
  const nested = simple('stack')
  nested.ui.slots = { main: { id: 'wrong', component: 'text_block', sidebar_icon: 'bell' } }
  assert.ok(validatePanelManifest(nested).some(error => error.includes('ui.slots.main: sidebar_icon')))
})

test('all 15 public Web App Bundles validate localized icons; pure-form panels are not given sidebars', async () => {
  const expected = {
    ai_agent_capabilities: ['bot'], business_data: ['database'], business_rules: ['list-checks'],
    design_style: ['palette'], flow_design: ['workflow'], function_modules: ['blocks'], integration_design: ['plug'],
    notification_design: ['bell'], page_design: ['map'], quality_acceptance: ['clipboard-check'], research: ['search'],
    role_access: ['users'], smart_questions: ['message-circle-question'], web_app_prd_assembly: ['file-text'], whiteboard: ['pen-tool'],
  }
  let count = 0
  for (const [directory, total] of [['skills-web-app', 15]]) {
    const root = fileURLToPath(new URL(`../../${directory}/`, import.meta.url))
    const kit = await loadDesignKit(fs, root, { sourceId: `fixture:sidebar-icons:${directory}` })
    assert.equal(kit.skills.length, total)
    for (const skill of kit.skills) {
      for (const locale of ['zh-CN', 'en-US']) {
        const panel = localizePanelManifest(skill.metadata.panelManifest, locale)
        assert.deepEqual(validatePanelManifest(panel), [], `${skill.name}/${locale}`)
        assert.deepEqual(nodes(panel.ui).filter(node => node.sidebar_icon !== undefined).map(node => node.sidebar_icon), expected[skill.name], skill.name)
        for (const node of nodes(panel.ui)) {
          if (SIDEBAR_TITLE_COMPONENT_KINDS.includes(node.component)) assert.ok(node.sidebar_icon, `${skill.name}/${node.id}: explicit owning title`)
        }
      }
      count++
    }
  }
  assert.equal(count, 15)
})

test('generated A2UI rejects an authored icon without widening the component subset', async () => {
  const manifest = basicGenericManifest(context)
  const question = nodes(manifest.ui).find(node => node.component === 'question_workspace')
  assert.ok(question)
  const messages = [{ version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest }] } }]
  assert.doesNotThrow(() => autoPanelSnapshot(context, messages), 'unchanged generated panel accepted')
  question.sidebar_icon = 'message-circle-question'
  assert.deepEqual(validatePanelManifest(manifest), [], 'static capability is valid')
  assert.throws(() => autoPanelSnapshot(context, messages), /authored sidebar icons are not supported/)
})
