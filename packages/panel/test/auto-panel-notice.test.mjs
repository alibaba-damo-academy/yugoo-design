import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<div id="root"></div>')
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { AutoPanelNotice } = await import('../src/auto-panel-notice.tsx')
const { panelText } = await import('../src/panel-i18n.tsx')

test('retention chrome respects host capability, read-only, pending, provenance and locale', async () => {
  const root = createRoot(document.getElementById('root'))
  let calls = 0
  const render = async props => React.act(async () => root.render(React.createElement(AutoPanelNotice, props)))
  try {
    for (const locale of ['en-US', 'zh-CN']) {
      const props = { locale, origin: 'generated', onRetain: () => { calls++ } }
      await render({ locale, origin: 'generated' })
      assert.equal(document.querySelector('button'), null, 'host without persistence capability has no action')
      await render(props)
      assert.equal(document.querySelector('button').textContent, panelText('retainPanel', locale))
      const before = calls
      await React.act(async () => document.querySelector('button').click())
      assert.equal(calls, before + 1)
      for (const flags of [{ readOnly: true }, { retaining: true }]) {
        await render({ ...props, ...flags })
        assert.equal(document.querySelector('button').disabled, true)
        await React.act(async () => document.querySelector('button').click())
        assert.equal(calls, before + 1)
      }
      assert.equal(document.querySelector('button').textContent, panelText('retainingPanel', locale))
      await render({ ...props, origin: 'retained', sourceChanged: true,
        generation: { phase: 'ready', durationMs: 99000, attempts: 99, fallbackReason: 'obsolete failure' } })
      assert.equal(document.querySelector('button'), null)
      assert.equal(document.querySelector('details'), null, 'retained definition must not inherit obsolete generation errors')
      assert.ok(document.body.textContent.includes(panelText('retainedPanel', locale)))
      assert.ok(document.body.textContent.includes(panelText('retainedSourceChanged', locale)))
      assert.ok(!document.body.textContent.includes('99'))
      await render({ ...props, generation: { phase: 'ready', durationMs: 1200, attempts: 2, fallbackReason: '<script>unsafe</script>' } })
      assert.ok(document.body.textContent.includes(panelText('autoPanelDuration', locale, { seconds: '1.2' })))
      assert.ok(document.body.textContent.includes(panelText('autoPanelAttempts', locale, { count: 2 })))
      assert.equal(document.querySelector('script'), null)
      assert.ok(document.querySelector('details').textContent.includes('<script>unsafe</script>'))
    }
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
