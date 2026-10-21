import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'getComputedStyle']) {
  if (globalThis[key] === undefined) globalThis[key] = dom.window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { FunctionSourceCard, FunctionSourceReaderContext } = await import('../src/client/panels/function-source.tsx')

test('source reading is lazy, pinned, escaped and canceled when closed', async () => {
  const container = document.querySelector('#root'), root = createRoot(container)
  const past = 'a'.repeat(40), current = 'b'.repeat(40), calls = []
  let resolveDelayed
  const reader = { revision: current, readArtifact: async (file, revision) => {
    calls.push({file,revision})
    if (revision === current) return { found: true, content: JSON.stringify({ records: { r1: 'Current user intent' } }) }
    return await new Promise(resolve => { resolveDelayed = resolve })
  } }
  const reference = { file: 'context/context.json', pointer: '/records/r1', revision: past }
  await React.act(async () => root.render(React.createElement(FunctionSourceReaderContext.Provider, { value: reader },
    React.createElement(FunctionSourceCard, { reference }))))
  assert.equal(calls.length, 0)
  const toggle = async open => React.act(async () => {
    const details = container.querySelector('details'); details.open = open
    details.dispatchEvent(new dom.window.Event('toggle'))
  })
  await toggle(true); assert.equal(calls.length, 1); assert.equal(calls[0].revision, past)
  await toggle(false)
  await React.act(async () => resolveDelayed({found:true,content:JSON.stringify({records:{r1:'Canceled evidence'}})}))
  assert.equal(calls.length, 1, 'cancel must not proceed to a current read')
  assert.ok(!container.textContent.includes('Canceled evidence'))
  await toggle(true)
  await React.act(async () => resolveDelayed({found:true,content:JSON.stringify({records:{r1:'<img src=x onerror=alert(1)> Historical'}})}))
  assert.equal(calls.at(-1).revision, current)
  assert.ok(container.textContent.includes('当前来源已变化'))
  assert.ok(container.textContent.includes('Current user intent'))
  assert.ok(container.textContent.includes('<img src=x'))
  assert.equal(container.querySelector('img'), null)
  await React.act(async () => root.unmount()); dom.window.close()
})
