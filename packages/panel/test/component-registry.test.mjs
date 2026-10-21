import assert from 'node:assert/strict'
import test from 'node:test'
const { register } = await import('tsx/esm/api')
register()
const { COMPONENT_KINDS } = await import('../../core/src/panel-component-catalog.ts')
const { PANEL_COMPONENT_RENDERERS, renderNode } = await import('../src/interpreter.ts')
const { renderToStaticMarkup } = await import('../node_modules/react-dom/server.js')

test('every catalog component has exactly one immutable renderer entry', () => {
  assert.deepEqual(Object.keys(PANEL_COMPONENT_RENDERERS).sort(), [...COMPONENT_KINDS].sort())
  assert.ok(Object.isFrozen(PANEL_COMPONENT_RENDERERS))
  for (const name of COMPONENT_KINDS) assert.equal(typeof PANEL_COMPONENT_RENDERERS[name], 'function')
})

test('unregistered and inherited component names fail explicitly', () => {
  for (const component of ['not_installed', '__proto__', 'constructor', 'toString']) {
    assert.throws(() => renderNode({ id: 'invalid', component }, {}, {}), /No registered panel component renderer/)
  }
})

test('nested dispatch uses the same renderer registry and escapes content', () => {
  const node = { id: 'root', component: 'stack', children: [
    { id: 'guidance', component: 'text_block', text: '<script>bad()</script>' },
  ] }
  const html = renderToStaticMarkup(renderNode(node, {}, {}))
  assert.ok(html.includes('dsh-design-stack'))
  assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'))
  assert.ok(!html.includes('<script>'))
})
