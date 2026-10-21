import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

test('shared canvas heading matches native input/small-action geometry without Kit selectors', () => {
  const css = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  const dom = new JSDOM('<style></style><div class="dsh-canvas-heading"><input disabled><button>Move</button><button class="dsh-canvas-delete" disabled>Delete</button></div>')
  dom.window.document.querySelector('style').textContent = css
  const style = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector))
  try {
    assert.equal(style('.dsh-canvas-heading').padding, '12px')
    assert.equal(style('.dsh-canvas-heading').gap, '8px')
    assert.equal(style('input').height, '36px')
    assert.equal(style('input').borderRadius, '8px')
    assert.equal(style('input').padding, '4px 12px')
    assert.equal(style('input').fontSize, '14px')
    assert.equal(style('input').opacity, '0.5')
    assert.equal(style('button').height, '28px')
    assert.equal(style('button').padding, '5px 12px')
    assert.equal(style('button').fontSize, '12px')
    assert.equal(style('button').lineHeight, '18px')
    assert.equal(style('.dsh-canvas-delete').borderWidth, '0px')
    assert.equal(style('.dsh-canvas-delete').backgroundColor, 'rgba(0, 0, 0, 0)')
    assert.equal(style('.dsh-canvas-delete').cursor, 'not-allowed')
    const headingRules = [...dom.window.document.styleSheets[0].cssRules].filter(rule => rule.selectorText?.includes('dsh-canvas-heading'))
    assert.ok(headingRules.every(rule => !/whiteboard|web_app|boards/.test(rule.selectorText)))
    const source = readFileSync(new URL('../src/canvas-workspace.tsx', import.meta.url), 'utf8')
    assert.match(source, /className="dsh-canvas-delete" disabled=\{!editable\}/)
  } finally { dom.window.close() }
})
