/** Source-loader contracts. Real browser, save/reopen and Native checks are separate. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { register } from 'tsx/esm/api'

register()
const { loadDesignBundle } = await import('../../core/src/kit-loader.ts')
const { validatorFromSchemaYaml } = await import('../../core/src/schema.ts')
const { parseValidationYaml, evaluateValidationRules } = await import('../../core/src/validation-rules.ts')
const { renderDeclarativeState } = await import('../../core/src/renderer.ts')
const { localizePanelManifest } = await import('../../core/src/panel-i18n.ts')
const { applyDesignEditToDraft } = await import('../../panel/src/record-state.ts')
const fs = {
  readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
}
const rootDir = fileURLToPath(new URL('../bundles/flow_design/', import.meta.url))
const { skill, resources } = await loadDesignBundle(fs, { rootDir, sourceId: 'flow-node-content-test' })
const preview = JSON.parse(resources['reference/preview.json'])
const validate = validatorFromSchemaYaml(skill.metadata.schemaYaml)
const rules = parseValidationYaml(skill.metadata.validationYaml)

test('the actual loader keeps old Flow content valid without adding node records', async () => {
  const legacy = structuredClone(preview); delete legacy.nodes; delete legacy.node_order
  const bytes = JSON.stringify(legacy)
  assert.deepEqual(validate(legacy), { ok: true })
  assert.deepEqual(await evaluateValidationRules(rules, { state: legacy }, 'state'), [])
  assert.equal(JSON.stringify(legacy), bytes)
  assert.ok(resources['reference/artifact-contract.md'].includes('## Step supplements'))
  assert.ok(skill.content.includes('reference/artifact-contract.md#step-supplements'))
  assert.ok(resources['reference/canvas-guide.md'].includes('artifact-contract.md#step-supplements'))
})

test('node supplements have exact references and optional meaningful text; shape errors fail', async () => {
  assert.deepEqual(validate(preview), { ok: true })
  for (const field of ['process_ref', 'bpmn_element_ref']) {
    const bad = structuredClone(preview); delete bad.nodes['N-002'][field]
    assert.equal(validate(bad).ok, false)
  }
  const bad = structuredClone(preview); bad.nodes['N-002'].entry_condition = []
  assert.equal(validate(bad).ok, false)
  const minimal = structuredClone(preview)
  minimal.nodes['N-002'] = { process_ref: 'P-001', bpmn_element_ref: 'UserTask_P-PREVIEW-001_2' }
  assert.deepEqual(validate(minimal), { ok: true }, 'blank optional prose does not prevent saving')
  const wrongOrder = structuredClone(preview); wrongOrder.node_order.push('missing')
  assert.ok((await evaluateValidationRules(rules, { state: wrongOrder }, 'state')).some(issue => issue.code === 'flow_design.node_order_invalid'))
})

test('editing a retained orphan uses the same canonical record and preserves parent/unknown content', () => {
  const original = structuredClone(preview)
  original.nodes['saved-orphan'] = { process_ref: 'removed-process', bpmn_element_ref: 'removed-element',
    activity: 'Saved explanation', remarks: 'Unknown mapping', source_refs: { original: { source: 'saved-source', locator: '/step' } } }
  original.node_order.push('saved-orphan')
  const beforeParent = JSON.stringify(original.processes)
  const result = applyDesignEditToDraft(original, skill.metadata.panelManifest, {
    section: 'nodes', record: 'saved-orphan', field: 'remarks', value: 'Preserved pending mapping',
  })
  assert.equal(result.nodes['saved-orphan'].remarks, 'Preserved pending mapping')
  assert.deepEqual(result.nodes['saved-orphan'].source_refs, original.nodes['saved-orphan'].source_refs)
  assert.equal(JSON.stringify(result.processes), beforeParent)
  assert.deepEqual(result.nodes['N-001'], original.nodes['N-001'])
  assert.equal(original.nodes['saved-orphan'].remarks, 'Unknown mapping')
  assert.deepEqual(validate(result), { ok: true })
})

test('node controls and model summary expose the supplements without a second editable topology', () => {
  for (const locale of ['en-US', 'zh-CN']) {
    const panel = localizePanelManifest(skill.metadata.panelManifest, locale)
    assert.equal(panel.ui.diagram.inspector.presentation, 'document')
    assert.ok(Object.values(panel.ui.diagram.inspector.migration).every(value => typeof value === 'string' && !value.startsWith('$t:')))
    const body = panel.sections.find(section => section.id === 'processes').form.body
    assert.deepEqual(body.filter(item => item.kind === 'field').map(item => item.field), ['description', 'stakeholders', 'business_rules', 'trigger_hints', 'exception_handling'])
    assert.equal(body.some(item => item.kind === 'group'), false)
    const row = body.find(item => item.kind === 'row')
    assert.deepEqual(row.items.map(item => item.field), ['tier', 'process_type'])
    assert.equal(panel.fields.find(field => field.key === 'business_rules').control, 'list')
    assert.ok(!panel.fields.some(field => ['system_responsibilities', 'key_features'].includes(field.key)))
    const fields = panel.fields.filter(field => field.applies_to?.includes('nodes'))
    assert.equal(fields.some(field => ['title', 'name', 'role', 'node_kind', 'next'].includes(field.key)), false)
    assert.ok(fields.every(field => !field.label.startsWith('$t:')))
    assert.ok(fields.filter(field => !field.hidden).every(field => !field.readonly && !field.required))
    assert.ok(fields.filter(field => ['process_ref', 'bpmn_element_ref'].includes(field.key)).every(field => field.hidden && field.readonly))
  }
  const summary = renderDeclarativeState(preview, skill).join('\n')
  assert.ok(summary.includes('N-001'))
  assert.ok(summary.includes(preview.nodes['N-001'].activity))
  assert.ok(summary.includes(preview.nodes['N-002'].exit_condition))
  assert.ok(summary.indexOf('N-001') < summary.indexOf('N-002'))
})
