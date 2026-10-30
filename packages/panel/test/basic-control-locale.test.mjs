import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderManifest } from '../src/interpreter.ts'
globalThis.React = React

test('missing cross-panel port is unavailable, while complete empty data is stale and read errors propagate', () => {
  const panelRef = { panel_type: 'other', section_id: 'records' }
  const manifest = { version: 1, panel_kind: 'neutral_records', sections: [{ id: 'items' }],
    fields: [
      { key: 'one', control: 'record_select', options_from_panel: panelRef, applies_to: ['items'] },
      { key: 'many', control: 'record_multi_select', options_from_panel: panelRef, applies_to: ['items'] },
      { key: 'rows', control: 'rows', columns: [{ key: 'ref', label: 'Target', control: 'ref', options_from_panel: panelRef }], applies_to: ['items'] },
    ], ui: { id: 'form', component: 'record_form', source: 'items' } }
  const state = { items: { a: { one: 'kept', many: ['kept'], rows: [{ ref: 'kept' }] } } }, before = structuredClone(state)
  for (const [locale, unloaded, stale] of [
    ['zh-CN', '引用来源未加载', '已失效引用'], ['en-US', 'reference source not loaded', 'invalid reference'],
  ]) {
    const render = panelData => renderToStaticMarkup(renderManifest(manifest, state, {
      locale, editable: true, panelData, onEdit: () => assert.fail('reading must not edit saved references'),
    }))
    const missing = render(undefined)
    assert.equal(missing.split(unloaded).length - 1, 3)
    assert.ok(!missing.includes(stale))
    const absent = render(() => ({}))
    assert.equal(absent.split(stale).length - 1, 3)
    const valid = render((bundle, section) => {
      assert.equal(bundle, 'other'); assert.equal(section, 'records')
      return { kept: { title: 'Actual target' } }
    })
    assert.equal(valid.split('Actual target').length - 1, 3)
    assert.ok(!valid.includes(stale) && !valid.includes(unloaded))
    assert.throws(() => render(() => { throw Error('source read failed') }), /source read failed/)
    assert.deepEqual(state, before)
  }
})

test('shared reference, row and source controls translate diagnostics without rewriting preserved values', () => {
  const manifest = { version: 1, panel_kind: 'neutral_records', sections: [{ id: 'items', title: 'User section' }],
    fields: [
      { key: 'choice', control: 'select', options: [{ value: 'known', label: 'Authored option' }], applies_to: ['items'] },
      { key: 'choices', control: 'multi_select', options: [{ value: 'known', label: 'Authored option' }], applies_to: ['items'] },
      { key: 'rows', control: 'rows', columns: [{ key: 'title', control: 'text', label: 'User column' }], applies_to: ['items'] },
      { key: 'sources', control: 'source_list', applies_to: ['items'] },
    ], ui: { id: 'form', component: 'record_form', source: 'items' } }
  const state = { items: { a: { title: 'Original user text', choice: 'lost', choices: ['lost'],
    rows: [{ title: 'Preserved row' }, 42], sources: ['upload:Original {name}', 'custom:Unchanged', 7] } } }
  const before = structuredClone(state)
  for (const [locale, stale, rowError, sourceError, sourceLabel] of [
    ['en-US', 'lost (invalid reference)', 'Invalid row data', 'Invalid source items', 'Original {name} · Uploaded material'],
    ['zh-CN', 'lost（已失效引用）', '无效行数据', '无效来源项', 'Original {name} · 上传材料'],
  ]) {
    const html = renderToStaticMarkup(renderManifest(manifest, state, { locale, editable: true,
      onEdit: () => assert.fail('render must not edit facts') }))
    for (const text of [stale, rowError, sourceError, sourceLabel, 'custom:Unchanged', 'Preserved row']) assert.ok(html.includes(text), text)
    assert.ok(!html.includes('dsh-design-rows-add'), 'malformed rows must remain non-editable')
    assert.deepEqual(state, before)
    const valid = { items: { a: { rows: [{ title: 'Valid row' }], sources: ['user:User text'] } } }
    const actions = renderToStaticMarkup(renderManifest(manifest, valid, { locale, editable: true }))
    assert.ok(actions.includes(locale === 'en-US' ? 'Add row' : '添加行'))
    assert.ok(actions.includes(locale === 'en-US' ? 'Remove source' : '移除来源'))
    assert.ok(actions.includes('User text'))
  }
})
