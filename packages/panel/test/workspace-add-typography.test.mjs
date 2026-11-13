import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installSelectDom } from './select-interaction.mjs'
const dom = new JSDOM('<!doctype html><style></style><div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLFormElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
installSelectDom(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderNode } = await import('../src/interpreter.ts')
const { parsePanelManifest, localizePanelManifest } = await import('../../core/src/panel-dsl.ts')
document.querySelector('style').textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')

test('actual AI and Function navigation use the same ordinary Add text role', async () => {
  const root = createRoot(document.getElementById('root'))
  try {
    for (const [bundle, data] of [
      ['ai_agent_capabilities', { agents: { a: { id: 'a', name: 'Research agent', purpose: 'Research' } } }],
      ['function_modules', { functions: { f: { function_id: 'f', function_name: 'Submit', function_description: 'Submit a request', function_epic: 'Requests' } } }],
    ]) {
      let m = parsePanelManifest(readFileSync(new URL(`../../skills-web-app/bundles/${bundle}/panel.yaml`, import.meta.url), 'utf8'))
      m.i18n.messages = { 'en-US': JSON.parse(readFileSync(new URL(`../../skills-web-app/bundles/${bundle}/locales/en-US.json`, import.meta.url), 'utf8')) }
      m = localizePanelManifest(m, 'en-US')
      await React.act(() => root.render(React.createElement('div', { className: 'dsh-design-panel' }, renderNode(m.ui, m, data,
        { locale: 'en-US', editable: true, onPanelUpdate() {}, sendPrompt() {} }))))
      const buttons = [...document.querySelectorAll('.dsh-panel-workspace-tree-add')]
      assert.ok(buttons.length > 0, `${bundle} Add must be reachable in its real composition`)
      for (const button of buttons) {
        const computed = window.getComputedStyle(button)
        assert.equal(computed.fontWeight, '400', `${bundle}: ${button.textContent}`)
        assert.equal(computed.lineHeight, '20px')
        assert.equal(button.querySelector('strong,b'), null)
        assert.ok(button.textContent.trim())
      }
    }
  } finally { await React.act(() => root.unmount()); dom.window.close() }
})
