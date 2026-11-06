/** Actual source component interaction; no browser or native Host acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { register } from 'tsx/esm/api'
const panelRequire = createRequire(new URL('../../panel/package.json', import.meta.url))
const { JSDOM } = panelRequire('jsdom')
const reactUrls = new Map(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client']
  .map(name => [name, pathToFileURL(panelRequire.resolve(name)).href]))
const hooks = registerHooks({ resolve(name, context, next) {
  return reactUrls.has(name) ? { url: reactUrls.get(name), shortCircuit: true } : next(name, context)
} })
test.after(() => hooks.deregister())
const dom = new JSDOM('<div id="root"></div>', { url: 'https://conversation.test/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
const React = await import('react')
// Compatible with the original pre-localization component and the automatic JSX source check.
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const loader = register({ namespace: 'conversation-shortcut', tsconfig: new URL('../../panel/tsconfig.json', import.meta.url).pathname })
const { Conversation } = await loader.import('../src/conversation.tsx', import.meta.url)

test('failed design shortcut shows a composer error, retains the unsent draft and never retries itself', async () => {
  const root = createRoot(document.getElementById('root')), sent = []
  try {
    await React.act(async () => root.render(React.createElement(Conversation, {
      locale: 'en', hostLabel: 'Codex', thread: 'test-thread', visible: true, onClose() {},
      value: { available: true, rows: [], omitted: 0 }, initialDraft: 'Keep my separate unsent request.',
      send: async text => { sent.push(text); throw new Error('Fixture transport disconnected. Reconnect before trying again.') },
    })))
    await React.act(async () => { document.querySelector('.companion-notify').click(); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(sent.length, 1)
    assert.match(document.querySelector('[role="alert"]').textContent, /Fixture transport disconnected/)
    assert.equal(document.querySelector('textarea').value, 'Keep my separate unsent request.')
    assert.equal(document.querySelector('.companion-notify').disabled, false)
    await React.act(async () => { await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(sent.length, 1, 'recovery requires another explicit user action')
  } finally {
    await React.act(async () => root.unmount())
    dom.window.close(); loader.unregister()
  }
})
