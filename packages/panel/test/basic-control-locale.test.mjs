import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderManifest } from '../src/interpreter.ts'
globalThis.React = React

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
