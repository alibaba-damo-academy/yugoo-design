import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
const { GraphCameraTools } = await import('../src/client/graph-canvas-presentation.tsx')

test('camera names follow the current locale while retaining actions and canvas theme', async () => {
  const root = createRoot(document.getElementById('root')), calls = []
  const show = (locale, dark = false) => React.act(async () => root.render(
    React.createElement(PanelLocaleContext.Provider, { value: locale },
      React.createElement(GraphCameraTools, { dark, onToggleDark: () => calls.push('theme'),
        onZoom: value => calls.push(value), onFit: () => calls.push('fit'), onRestart: () => calls.push('reset') }))))
  try {
    await show('zh-CN')
    assert.equal(document.querySelector('[role="group"]').getAttribute('aria-label'), '画布控件')
    const originalZoom = document.querySelector('[aria-label="放大图谱"]')
    await React.act(async () => originalZoom.click())
    await show('en-US')
    assert.equal(document.querySelector('[role="group"]').getAttribute('aria-label'), 'Graph controls')
    assert.equal(document.querySelector('[aria-label="Zoom in"]'), originalZoom, 'locale changes retain the existing controls')
    assert.doesNotMatch(document.getElementById('root').textContent, /[\u4e00-\u9fff]/u)
    const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
    await React.act(async () => { document.querySelector('[aria-label="Zoom out"]').click(); button('Fit to view').click(); button('Unpin and reset layout').click(); button('Use dark canvas').click() })
    assert.deepEqual(calls, [1.25, .8, 'fit', 'reset', 'theme'])
    await show('en-US', true)
    assert.ok(button('Use light canvas'))
    await show('zh-CN', true)
    assert.ok(button('画布切换到浅色'))
    assert.deepEqual(calls, [1.25, .8, 'fit', 'reset', 'theme'], 'translation and theme labels do not invoke graph actions')
  } finally { await React.act(async () => root.unmount()) }
})
