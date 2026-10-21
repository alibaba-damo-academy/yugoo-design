import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('shared artifact and matrix messages localize without rereading artifacts or changing facts', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { renderManifest } = await import('../src/interpreter.ts')
  const root = createRoot(document.getElementById('root'))
  const manifest = {
    version: 1, panel_kind: 'neutral_records', sections: [{ id: 'items', title: 'Authored title' }],
    fields: [{ key: 'artifact_file', control: 'text', applies_to: ['items'] }],
    ui: { id: 'workspace', component: 'record_workspace', sources: ['items'], children: [
      { id: 'preview', component: 'record_artifact', source: 'items', artifact: { field: 'artifact_file' } },
    ] },
  }
  const data = { items: { a: { name: 'User label {row}', artifact_file: 'neutral_records/a.html' } } }
  const before = structuredClone(data)
  let reads = 0
  const options = { editable: false, artifactFiles: { 'neutral_records/a.html': 'pinned-1' },
    readArtifact: async () => { reads++; return { found: false, content: '' } },
    onEdit: () => assert.fail('locale changes cannot edit') }
  try {
    await act(async () => root.render(renderManifest(manifest, data, { ...options, locale: 'en-US' })))
    assert.match(document.querySelector('[role="alert"]').textContent, /missing or cannot be read/)
    assert.match(document.querySelector('.dsh-record-artifact').textContent, /Retry preview/)
    assert.equal(reads, 1)
    await act(async () => root.render(renderManifest(manifest, data, { ...options, locale: 'zh-CN' })))
    assert.match(document.querySelector('[role="alert"]').textContent, /不存在或不可读取/)
    assert.equal(reads, 1, 'translation must not refetch or reinterpret an already pinned artifact')
    assert.deepEqual(data, before)

    const matrix = structuredClone(manifest)
    matrix.fields = [{ key: 'cells', control: 'rows', applies_to: ['items'], columns: [
      { key: 'row', control: 'text' }, { key: 'column', control: 'text' }, { key: 'value', control: 'text' },
    ] }]
    matrix.ui.children = [{ id: 'matrix', component: 'record_matrix', source: 'items',
      matrix: { field: 'cells', row: 'row', column: 'column', value: 'value' } }]
    const values = { items: { a: { name: 'Original label', cells: [
      { row: 'r1', column: 'c1', value: '17' }, { row: 'r1', column: 'c1', value: '18' },
      { row: 'r2', column: 'c2', value: '19' },
    ] } } }
    const original = structuredClone(values)
    for (const [locale, duplicate, missing, hint] of [
      ['en-US', '2 duplicate entries', 'r1 / c2 missing', 'missing, not zero'],
      ['zh-CN', '重复 2 项', 'r1 / c2 未提供', '未提供，不代表零'],
    ]) {
      await act(async () => root.render(renderManifest(matrix, values, { locale, editable: false })))
      assert.ok(document.querySelector('.dsh-record-matrix').textContent.includes(duplicate))
      assert.ok(document.querySelector('.dsh-record-matrix').textContent.includes(hint))
      assert.ok([...document.querySelectorAll('td')].some(cell => cell.getAttribute('aria-label') === missing))
      for (const input of document.querySelectorAll('.dsh-record-matrix input')) assert.ok(input.readOnly)
      assert.deepEqual(values, original)
    }
    const hierarchy = structuredClone(manifest)
    hierarchy.fields = [
      { key: 'name', control: 'text', applies_to: ['items'] },
      { key: 'category', control: 'text', label: 'Original category', applies_to: ['items'] },
      { key: 'parent', control: 'record_select', options_from_section: 'items', applies_to: ['items'],
        hierarchy: { label_field: 'name', group_label: 'Authored children', inherit_fields: ['category'] } },
    ]
    hierarchy.ui.children = []
    await act(async () => root.render(renderManifest(hierarchy, data, { locale: 'en-US', editable: true,
      onPanelUpdate: () => assert.fail('opening or localizing a create sheet cannot edit facts') })))
    const add = document.querySelector('[aria-label="Create Authored children"]')
    assert.ok(add, 'real hierarchical create control must be available')
    await act(async () => add.click())
    assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-label'), 'Create record')
    assert.ok(document.querySelector('[role="dialog"]').textContent.includes('Inherits: Original category.'))
    assert.ok(document.querySelector('[role="dialog"]').textContent.includes('User label {row}'))
    await act(async () => root.render(renderManifest(hierarchy, data, { locale: 'zh-CN', editable: true,
      onPanelUpdate: () => assert.fail('language switch cannot create a record') })))
    assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-label'), '创建记录')
    assert.ok(document.querySelector('[role="dialog"]').textContent.includes('创建后沿用：Original category'))
    assert.deepEqual(data, before)
  } finally { await act(async () => root.unmount()); dom.window.close() }
})
