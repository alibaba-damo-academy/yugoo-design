import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadDesignKit } from '../src/kit-loader.ts'
import { parsePanelManifest, validatePanelManifest, localizePanelManifest } from '../src/panel-dsl.ts'

const path = new URL('../../skills-web-app/bundles/role_access/panel.yaml', import.meta.url)
const manifest = parsePanelManifest(await readFile(path, 'utf8'))
const table = value => value.ui.children.find(node => node.component === 'record_inspector').children[0]
test('authored related table loads through the real Kit loader and retains canonical fields in both locales', async () => {
  const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error } },
    listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
  const kit = await loadDesignKit(fs, fileURLToPath(new URL('../../skills-web-app/', import.meta.url)), { sourceId: 'fixture:related-table' })
  const role = kit.skills.find(skill => skill.name === 'role_access')
  for (const locale of ['zh-CN', 'en-US']) {
    const panel = localizePanelManifest(role.metadata.panelManifest, locale)
    assert.deepEqual(validatePanelManifest(panel), [])
    assert.deepEqual(table(panel).record_table.columns.flatMap(column => column.fields), ['effect', 'capability', 'applies_when', 'requirements', 'custom_requirement'])
    assert.equal(table(panel).inherit_from_graph, true)
    assert.equal(panel.ui.children[0].graph.hierarchy.parent_control, 'header')
    assert.equal(panel.fields.find(field => field.key === 'role_ref').hidden, true)
    assert.equal(table(panel).record_table.columns[3].label, locale === 'zh-CN' ? '操作前需要（可选）' : 'Before performing the action (optional)')
  }
})

test('related table refuses incomplete, hidden, duplicate, foreign and malformed column bindings', () => {
  const cases = [
    node => { node.record_table.columns.pop() },
    node => { node.record_table.columns[0].fields = ['role_ref'] },
    node => { node.record_table.columns[1].fields = ['effect'] },
    node => { node.record_table.columns[0].fields = ['assignment_rule'] },
    node => { node.record_table.columns[0].fields = ['__proto__'] },
    node => { node.record_table.columns[0].script = 'not permitted' },
    node => { node.record_table.columns = [] },
    node => { node.record_table.columns = null },
    node => { node.record_table = null },
  ]
  for (const mutate of cases) {
    const next = structuredClone(manifest); mutate(table(next))
    assert.ok(validatePanelManifest(next).some(issue => issue.includes('record_table')))
  }
  const misplaced = structuredClone(manifest)
  misplaced.ui.record_table = table(misplaced).record_table
  assert.ok(validatePanelManifest(misplaced).some(issue => issue.includes('record_table requires')))
})

test('header parent selector requires an explicit single-parent hierarchy and does not change legacy declarations', () => {
  for (const bad of ['inline', false, {}]) {
    const next = structuredClone(manifest); next.ui.children[0].graph.hierarchy.parent_control = bad
    assert.ok(validatePanelManifest(next).some(issue => issue.includes('parent_control')))
  }
  const next = structuredClone(manifest); delete next.ui.children[0].graph.hierarchy.max_parents
  assert.ok(validatePanelManifest(next).some(issue => issue.includes('parent_control')))
  delete next.ui.children[0].graph.hierarchy.parent_control
  assert.deepEqual(validatePanelManifest(next), [])
})
