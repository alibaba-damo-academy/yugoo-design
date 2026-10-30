/** Shared Studio feedback through Companion adapters; no browser or native Host. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
const panelRequire = createRequire(new URL('../../panel/package.json', import.meta.url))
const { JSDOM, VirtualConsole } = panelRequire('jsdom')
const reactUrls = new Map(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'react-dom/test-utils'].map(specifier => [specifier, pathToFileURL(panelRequire.resolve(specifier)).href]))
const hooks = registerHooks({ resolve(specifier, context, next) { return reactUrls.has(specifier) ? { url: reactUrls.get(specifier), shortCircuit: true } : next(specifier, context) } })
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', error => { if (error.type !== 'css parsing' && error.type !== 'unhandled exception') throw error })
const dom = new JSDOM('<div id="root"></div>', { url: 'https://studio.test/', virtualConsole })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { StudioEntryFeedback, StudioExampleBoundary } = await import('../src/studio-feedback.tsx')
const { StudioConversationLayout } = await import('../src/studio-conversation.tsx')
const { Conversation } = await import('../src/conversation.tsx')
const { StudioFeedback } = await import('../../studio-ui/src/StudioFeedback.tsx')
const h = React.createElement, host = document.getElementById('root')
const button = label => [...host.querySelectorAll('button')].find(node => node.textContent.trim() === label)
async function flush() { await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }) }
async function until(predicate) { for (let index = 0; index < 150; index++) { if (predicate()) return; await flush() } assert.fail('Studio feedback did not settle') }
async function click(label) { assert.ok(button(label), label); await React.act(async () => button(label).click()) }
after(() => { dom.window.close(); hooks.deregister() })

for (const studio of [false, true]) test(`failed sends preserve input with ${studio ? 'the Studio error card' : 'the ordinary Panel error feedback'}`, async t => {
  const root = createRoot(host); let sends = 0
  t.after(async () => { await React.act(async () => root.unmount()) })
  await React.act(async () => root.render(h(Conversation, {
    visible: true, thread: 'same-thread', onClose() {}, initialDraft: 'Keep this request', showDesignShortcut: false,
    value: { available: true, recordedStatus: 'unknown', omitted: 0, rows: [] },
    send: async () => { sends++; throw Error('Fixture transport rejected request') },
    ...(studio ? { renderError: (message, source) => h(StudioFeedback, { feedbackId: source, tone: 'error', title: 'Request failed', details: [{ message }], locale: 'en' }) } : {}),
  })))
  await React.act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await until(() => studio ? host.querySelector('.ygd-studio-error-entry') : host.querySelector('[role=alert]'))
  assert.equal(sends, 1)
  assert.equal(host.querySelector('textarea').value, 'Keep this request')
  assert.equal(host.querySelector('dialog'), null)
  if (studio) {
    assert.equal(host.querySelectorAll('.ygd-studio-error-entry').length, 1)
    assert.equal(host.querySelector('[role=alert]'), null)
    assert.doesNotMatch(host.textContent, /Fixture transport/)
    await click('View issues')
    assert.match(host.querySelector('dialog').textContent, /Fixture transport rejected request/)
  } else assert.match(host.querySelector('[role=alert]').textContent, /Fixture transport rejected request/)
})

test('handoff failures have shared styles and tokens before Workspace exists, without an automatic dialog', async t => {
  const root = createRoot(host); let catalog = 0
  t.after(async () => { await React.act(async () => root.unmount()) })
  await React.act(async () => root.render(h(StudioEntryFeedback, { error: 'Incomplete handoff reference', locale: 'en', onOpenCatalog: () => catalog++ })))
  assert.ok(host.querySelector('.ygd-studio-workspace'))
  assert.match(host.querySelector('style').textContent, /--ds-surface:/)
  assert.match(host.textContent, /proposed changes could not be opened/)
  assert.equal(host.querySelector('dialog'), null)
  await click('Open Studio catalog')
  assert.equal(catalog, 1)
  assert.equal(host.querySelector('dialog'), null)
})

test('entry binding failure retries the exact connection and admits content without sending or reading a conversation', async t => {
  const root = createRoot(host); let calls = 0, admitted = 0
  t.after(async () => { await React.act(async () => root.unmount()) })
  const binding = { bindingId: 'feedback-binding', threadId: 'feedback-thread' }
  const initialRequest = { requestId: 'feedback-request', studio: { ...binding, id: 'feedback-copy', expectedRevision: 0 } }
  const rpc = async method => {
    assert.equal(method, 'info', 'retry cannot send messages, start a model or mutate source')
    if (++calls === 1) throw Error('Connection offline')
    return { host: 'codex', threadId: binding.threadId, studioConversation: binding }
  }
  await React.act(async () => root.render(h(StudioConversationLayout, {
    rpc, initialRequest, presentation: 'content-only',
    checkConnection: async () => assert.fail('content-only handoff does not probe the Host message channel'),
    readConversation: async () => assert.fail('content-only handoff does not read native history'),
    children: () => { admitted++; return h('div', {}, 'Exact working copy admitted') },
  })))
  await until(() => button('重新核对连接'))
  assert.equal(calls, 1); assert.equal(admitted, 0)
  assert.equal(host.querySelector('dialog'), null)
  assert.ok(host.querySelector('.ygd-studio-workspace style'))
  await click('重新核对连接')
  await until(() => host.textContent.includes('Exact working copy admitted'))
  assert.equal(calls, 2)
  assert.ok(admitted > 0)
})

test('a failed component example offers a local retry while preserving its surrounding documentation', async t => {
  const root = createRoot(host); let fail = true, renders = 0
  t.mock.method(console, 'error', () => {})
  t.after(async () => { await React.act(async () => root.unmount()) })
  function Example() { renders++; if (fail) throw Error('Fixture renderer failed'); return h('div', {}, 'Example recovered') }
  await React.act(async () => root.render(h('section', {}, h('h2', {}, 'Declaration and usage'),
    h(StudioExampleBoundary, { exampleId: 'example-a', locale: 'en' }, h(Example)))))
  assert.match(host.textContent, /component example could not be displayed/)
  assert.match(host.textContent, /Declaration and usage/)
  assert.equal(host.querySelector('dialog'), null)
  const before = renders; fail = false
  await click('Reload example')
  assert.ok(renders > before)
  assert.match(host.textContent, /Example recovered/)
  assert.match(host.textContent, /Declaration and usage/)
})
