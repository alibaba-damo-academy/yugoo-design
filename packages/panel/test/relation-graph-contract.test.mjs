import assert from 'node:assert/strict'
import test from 'node:test'
const { register } = await import('tsx/esm/api'); register()
const React = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { RelationGraph } = await import('../src/visual-components.tsx')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
const { readFile } = await import('node:fs/promises')

function render(locale, pending = false, description) {
  const node = { id: 'graph', component: 'relation_graph', description, graph: {
    nodes: 'records', edges: 'links', source_field: 'from', target_field: 'to', label_field: 'caption',
    ...(pending ? { edge_state_field: 'status', edge_pending_values: ['unknown'] } : {}),
  } }
  const manifest = { version: 1, panel_kind: 'document', sections: [
    { id: 'records', title: 'Records' }, { id: 'links', title: 'Links' },
  ], fields: [], ui: node }
  const data = { records: {}, links: {} }
  const before = structuredClone(data)
  const html = renderToStaticMarkup(React.createElement(PanelLocaleContext.Provider, { value: locale },
    React.createElement(RelationGraph, { node, manifest, data, options: { editable: false } })))
  assert.deepEqual(data, before)
  return html
}

test('generic graph supports both locales without injecting domain-specific or pending semantics', () => {
  const english = render('en-US')
  assert.match(english, /Relationship Canvas/)
  assert.match(english, /0 nodes \/ 0 relationships/)
  assert.match(english, /Read-only view/)
  assert.doesNotMatch(english, /Dashed lines|业务对象|需要系统决定|Add relationship/)
  const chinese = render('zh-CN')
  assert.match(chinese, /关系画布/)
  assert.match(chinese, /0 个节点 \/ 0 条关系/)
  assert.doesNotMatch(chinese, /虚线|业务对象|需要系统决定/)
})

test('pending explanation is opt-in and Bundle guidance is escaped text', () => {
  const html = render('en-US', true, '<script>Example guidance</script>')
  assert.match(html, /Dashed lines indicate relationships marked as pending/)
  assert.match(html, /&lt;script&gt;Example guidance&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>Example guidance/)
})

test('shared locale keys and interpolation placeholders stay aligned', async () => {
  const [zh, en] = await Promise.all(['zh-CN', 'en-US'].map(async locale =>
    JSON.parse(await readFile(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'))))
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const key of Object.keys(zh)) {
    const tokens = text => [...text.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort()
    assert.deepEqual(tokens(zh[key]), tokens(en[key]), key)
  }
})
