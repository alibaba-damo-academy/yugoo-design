import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
const { register } = await import('tsx/esm/api'); register()
const dom = new JSDOM('<div id="root"></div>')
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { act } = await import('react-dom/test-utils')
const { createRoot } = await import('react-dom/client')
const { PanelSaveError } = await import('../src/client/panel-save-error.tsx')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')

test('host-owned feedback removes only the exact duplicate, without clearing error authority', async () => {
  assert.match(React.version, /^18\./, 'exercise the supported host React')
  const root = createRoot(document.getElementById('root'))
  const saved = Object.freeze({ error: 'Native notification rejected', dirty: false, checkpoint: 'saved' })
  const show = hostReportedError => act(async () => root.render(React.createElement(PanelSaveError, { error: saved.error, hostReportedError })))
  try {
    await show(undefined)
    assert.equal(document.querySelector('.dsh-design-save-error').textContent, saved.error, 'hosts without their own feedback retain inline errors')
    await show(saved.error)
    assert.equal(document.querySelector('.dsh-design-save-error'), null)
    assert.equal(saved.error, 'Native notification rejected')
    assert.equal(saved.dirty, false)
    assert.equal(saved.checkpoint, 'saved')
    await show('Some other error')
    assert.equal(document.querySelector('.dsh-design-save-error').textContent, saved.error)
    await act(async () => root.render(React.createElement(PanelSaveError, { hostReportedError: saved.error })))
    assert.equal(document.querySelector('.dsh-design-save-error'), null)
    for (const [locale, expected] of [['en-US', /Your draft is preserved.*Cancel/], ['zh-CN', /草稿已保留.*取消/]]) {
      await act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
        React.createElement(PanelSaveError, { error: 'PANEL_SAVE_CONFLICT: example changed' }))))
      assert.match(document.querySelector('[role=alert]').textContent, expected)
      assert.doesNotMatch(document.querySelector('[role=alert]').textContent, /PANEL_SAVE_CONFLICT/)
    }
  } finally { await act(async () => root.unmount()); dom.window.close() }
})
