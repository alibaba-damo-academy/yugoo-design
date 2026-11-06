/** Source React checks; actual Host restoration is recorded in task 81015eebf56d. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
const environment = new JSDOM('<!doctype html><div></div>', { url: 'https://panel.test/' })
globalThis.window = environment.window; globalThis.document = environment.window.document
const React = await import('react'), { act } = React
const { createRoot } = await import('react-dom/client')
const { WorkspaceReadBoundary } = await import('../src/client/workspace-read-boundary.tsx')
const { bindDesignHostLocale, useLang } = await import('../src/client/ported/host.ts')
globalThis.React = React
after(() => environment.window.close())

test('first read distinguishes pending, failure/retry and a confirmed empty workspace', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  let locale = { active: 'en' }, retries = 0, mounts = 0
  const listeners = new Set()
  const release = bindDesignHostLocale({ getSnapshot: () => locale, subscribe: listener => {
    listeners.add(listener); return () => listeners.delete(listener)
  } })
  function EmptyWorkspace() {
    const t = useLang()
    React.useEffect(() => { mounts++ }, [])
    return React.createElement('p', { id: 'empty' }, t.design_empty_panels)
  }
  const show = (loaded, failure) => act(async () => root.render(React.createElement(WorkspaceReadBoundary,
    { loaded, failure, onRetry: () => retries++ }, React.createElement(EmptyWorkspace))))
  try {
    await show(false)
    assert.equal(document.querySelector('[data-content-state]').dataset.contentState, 'loading')
    assert.match(document.querySelector('[role=status]').textContent, /Loading design panels/)
    assert.equal(document.querySelector('#empty'), null)
    assert.equal(mounts, 0, 'pending reads cannot mount the empty-workspace branch')
    await show(false, 'Host connection interrupted')
    assert.equal(document.querySelector('[data-content-state]').dataset.contentState, 'error')
    assert.match(document.querySelector('[role=alert]').textContent, /Host connection interrupted/)
    assert.equal(document.querySelector('#empty'), null)
    await act(async () => document.querySelector('button').click())
    assert.equal(retries, 1)
    await act(async () => {
      locale = { active: 'zh' }; for (const listener of listeners) listener()
    })
    assert.match(document.querySelector('[role=alert]').textContent, /无法加载设计面板/)
    assert.equal(document.querySelector('button').textContent, '重试')
    await show(false)
    assert.match(document.querySelector('[role=status]').textContent, /正在加载设计面板/)
    await show(true)
    assert.equal(document.querySelector('[data-content-state]'), null)
    assert.match(document.querySelector('#empty').textContent, /暂无设计面板/)
    assert.equal(mounts, 1, 'a completed empty snapshot retains the real empty state')
  } finally { await act(async () => root.unmount()); release(); dom.window.close() }
})

test('refresh failure and recovery retain the mounted workspace and unsaved input', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  const root = createRoot(document.getElementById('root'))
  let mounts = 0, cleanups = 0
  function Draft() {
    React.useEffect(() => { mounts++; return () => { cleanups++ } }, [])
    return React.createElement('input', { defaultValue: 'Saved value', 'aria-label': 'Draft' })
  }
  const show = failure => act(async () => root.render(React.createElement(WorkspaceReadBoundary,
    { loaded: true, failure, onRetry: () => assert.fail('loaded workspace must not be replaced') }, React.createElement(Draft))))
  try {
    await show()
    const input = document.querySelector('input')
    input.value = 'Human unsaved edit'
    input.focus()
    await show('Background refresh failed')
    assert.equal(document.querySelector('input'), input)
    assert.equal(input.value, 'Human unsaved edit')
    assert.equal(document.activeElement, input)
    assert.equal(document.querySelector('[data-content-state]'), null)
    await show()
    assert.equal(document.querySelector('input'), input)
    assert.equal(mounts, 1)
    assert.equal(cleanups, 0)
  } finally { await act(async () => root.unmount()); dom.window.close() }
})

test('dock passes actual first-snapshot readiness and retry through the shared boundary', () => {
  const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /<WorkspaceReadBoundary loaded=\{workspace !== undefined\} failure=\{workspaceFailure\}/)
  assert.match(source, /if \(info.sessionId !== undefined\) refreshPanelWorkspace\(info.sessionId\)/)
  assert.doesNotMatch(source, /border-red-200 bg-red-50/)
})
