import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  if (globalThis[key] === undefined) globalThis[key] = dom.window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { FunctionDetailsEditor, FunctionDetailUIContext } = await import('../src/client/panels/function-details.tsx')
const container = document.querySelector('#root'), root = createRoot(container)
const module = { function_id: 'F-1', function_name: 'Evidence', function_description: 'Find evidence and preserve the full explanation.\n'.repeat(12), function_epic: 'Research', priority: 'Medium', rejected: false, source: 'ai', reason: 'A proposed capability',
  details: { behaviors: { 'B-1': { description: 'Inspect original evidence' } }, outputs: { 'O-1': { description: 'Original citation' } } },
  references: { 'R-1': { file: 'context/context.json', revision: 'a'.repeat(40), pointer: '/records/r1' } } }
let draft = structuredClone(module)
const render = async (enabled, disabled = false) => React.act(async () => root.render(React.createElement(FunctionDetailUIContext.Provider, { value: enabled },
  React.createElement(FunctionDetailsEditor, { module: draft, disabled, onChange: next => { draft = next } }))))

test('inline details preserve description, identity and sources across edits and folding', async () => {
  await render(false); assert.equal(container.querySelector('[aria-label="核心行为 1"]'), null)
  await render(true)
  assert.equal(container.querySelector('details').open, false)
  await React.act(async () => { container.querySelector('details').open = true; container.querySelector('details').dispatchEvent(new dom.window.Event('toggle')) })
  assert.equal(container.querySelector('select'), null, 'details never require dropdown switching')
  assert.equal(container.querySelector('[aria-label="用途"]'), null, 'missing optional dimensions are not six empty templates')
  const field = container.querySelector('[aria-label="核心行为 1"]')
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(field, 'Read claim evidence')
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  assert.equal(draft.details.behaviors['B-1'].description, 'Read claim evidence')
  assert.deepEqual(draft.details.outputs, module.details.outputs)
  assert.deepEqual(draft.references, module.references)
  await render(true)
  const add = [...container.querySelectorAll('button')].find(button => button.textContent === '＋ 添加核心行为')
  await React.act(async () => add.click())
  assert.equal(Object.keys(draft.details.behaviors).length, 2)
  assert.ok(Object.keys(draft.details.behaviors).includes('B-1'))
  assert.ok(Object.keys(draft.details.behaviors).some(id => id !== 'B-1' && id.startsWith('B-')))
  await render(true)
  const reason = container.querySelector('[aria-label="设计原因"]')
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(reason, 'Updated rationale')
    reason.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  assert.equal(draft.reason, 'Updated rationale')
  assert.equal(draft.function_description, module.function_description)
  assert.deepEqual(draft.references, module.references)
  await render(true)
  await React.act(async () => { container.querySelector('details').open = false; container.querySelector('details').dispatchEvent(new dom.window.Event('toggle')) })
  assert.equal(container.querySelector('[aria-label="设计原因"]'), null)
  await React.act(async () => { container.querySelector('details').open = true; container.querySelector('details').dispatchEvent(new dom.window.Event('toggle')) })
  assert.equal(container.querySelector('[aria-label="设计原因"]').value, 'Updated rationale')
  await render(true, true)
  assert.ok([...container.querySelectorAll('textarea')].every(field => field.disabled))
  assert.equal([...container.querySelectorAll('button')].some(button => button.textContent.includes('添加') || button.textContent.includes('移除')), false)
  await React.act(async () => root.unmount()); dom.window.close()
})
