import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { register } = await import('tsx/esm/api')
register()
const { JSDOM } = await import('jsdom')
const React = await import('react')
globalThis.React = React
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: FooterButtons } = await import('../src/client/ported/design/FooterButtons.tsx')
const { DOCK_CSS } = await import('../src/client/styles.ts')

test('shared action group uses non-wrapping row and preserves independent disabled states', () => {
  const markup = renderToStaticMarkup(React.createElement(FooterButtons, {
    disabled: true, saveDisabled: false,
    regenerateText: '撤回操作', saveText: '保存并评估下一步',
  }))
  const dom = new JSDOM(`<style>${DOCK_CSS}</style><div class="dsh-design-dock">${markup}</div>`)
  try {
    const group = dom.window.document.querySelector('.dsh-design-footer-actions')
    const style = dom.window.getComputedStyle(group)
    assert.equal(style.display, 'flex')
    assert.equal(style.flexDirection, 'row')
    assert.equal(style.flexWrap, 'nowrap')
    const [revert, save] = group.querySelectorAll('button')
    assert.equal(revert.textContent, '撤回操作')
    assert.equal(save.textContent, '保存并评估下一步')
    assert.equal(revert.disabled, true)
    assert.equal(save.disabled, false)
    assert.equal(dom.window.getComputedStyle(save).width, 'auto')
  } finally { dom.window.close() }
})

test('form inset is removed only beneath the workspace that already supplies outer padding', () => {
  const dom = new JSDOM(`<style>${DOCK_CSS}</style>
    <div class="dsh-design-workspace-inset"><div id="form" class="dsh-design-dock-panel-body"></div>
      <div id="workspace" class="dsh-design-dock-panel-body dsh-design-dock-panel-workspace"></div></div>
    <div id="standalone" class="dsh-design-dock-panel-body"></div>`)
  try {
    const css = id => dom.window.getComputedStyle(dom.window.document.getElementById(id))
    assert.equal(Number.parseFloat(css('form').paddingTop), 0)
    assert.equal(Number.parseFloat(css('form').paddingLeft), 0)
    assert.equal(Number.parseFloat(css('workspace').padding), 0)
    assert.notEqual(css('standalone').padding, css('workspace').padding)
  } finally { dom.window.close() }
})

test('Companion exposes the same scene-view capability as DSH and uses the requested brand', async () => {
  const companion = await readFile(new URL('../../companion/src/client.tsx', import.meta.url), 'utf8')
  const dsh = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(companion, /<DesignWorkspace\s+\{\.\.\.workspace\}\s+experienceAvailable\b/)
  assert.match(dsh, /<DesignWorkspace\s+experienceAvailable\b/)
  assert.ok(companion.includes('{sidebarOpen && <strong>Yugoo Design</strong>}'))
})
