import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const css = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')

test('shared controls distinguish ordinary, compact inspector and dense detail variants without touching host controls', () => {
  const dom = new JSDOM(`<style>${css}</style>
    <input id="host"><div class="dsh-design-panel">
      <label class="dsh-design-field"><span class="dsh-design-field-label">Label</span><input id="text" class="dsh-design-field-input"></label>
      <textarea id="notes" class="dsh-design-field-input"></textarea>
      <select id="choice" class="dsh-design-field-input"><option>Value</option></select>
      <div class="dsh-preview-control-group"><span class="dsh-color-control"><input id="color" type="color"><input id="hex" type="text"></span><select id="compact-choice"><option>Value</option></select></div>
      <div class="dsh-standard-question-answer-shell"><textarea id="answer" class="dsh-standard-question-text"></textarea></div>
      <div class="dsh-record-board"><details class="dsh-record-board-editor"><div class="dsh-compact-record-details"><section><header><h5>Dense detail</h5></header><textarea id="dense"></textarea></section></div></details></div>
    </div>`)
  try {
    const style = id => dom.window.getComputedStyle(dom.window.document.getElementById(id))
    for (const id of ['text', 'notes', 'choice', 'hex', 'color', 'compact-choice']) assert.equal(style(id).borderRadius, '8px', id)
    for (const id of ['text', 'choice']) assert.equal(style(id).height, '36px', id)
    for (const id of ['color', 'hex', 'compact-choice']) {
      assert.equal(style(id).height, '32px', id)
      assert.equal(style(id).fontSize, '14px', 'parameter editor never falls back to browser default')
    }
    assert.equal(style('notes').minHeight, '88px', 'multiline editing space is preserved')
    assert.equal(style('notes').resize, 'vertical')
    assert.equal(style('dense').fontSize, '12px', 'approved compact content stays compact')
    assert.equal(style('dense').minHeight, '36px', 'dense text grows instead of forcing a large blank textarea')
    assert.equal(style('answer').borderTopWidth, '0px', 'answer shell owns the boundary')
    assert.match(style('answer').outline, /^0(?:px)?$/, 'answer shell owns the one focus indicator')
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('.dsh-standard-question-answer-shell')).borderRadius, '8px')
    assert.notEqual(style('host').height, '36px', 'host and user-authored preview HTML are outside this styling scope')
  } finally { dom.window.close() }
})

test('semantic spacing and focus have one shared authority while layout families retain their own geometry', () => {
  const dom = new JSDOM(`<style>${css}</style><div class="dsh-design-panel"><div class="dsh-design-record-fields has-form-body"><section class="dsh-design-form-group"><h3 class="dsh-design-form-group-title">Group</h3><div class="dsh-design-form-group-fields"></div></section></div></div>`)
  try {
    const style = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector))
    assert.equal(style('.dsh-design-panel').getPropertyValue('--ygd-panel-detail-section-gap'), '16px')
    assert.equal(style('.has-form-body').gap, 'var(--ygd-panel-detail-section-gap, 16px)')
    assert.equal(style('.dsh-design-form-group').gap, 'var(--ygd-panel-detail-control-gap, 8px)')
    assert.equal(style('.dsh-design-form-group-fields').gap, 'var(--ygd-panel-detail-section-gap, 16px)')
    assert.equal(style('.dsh-design-form-group-title').fontWeight, '500')
    assert.equal(style('.dsh-design-form-group-title').fontSize, '14px')
    assert.match(css, /\.dsh-record-workspace button:focus-visible[^{}]+\{[^}]*var\(--ygd-panel-control-focus/)
    assert.match(css, /\.dsh-standard-question-answer-shell:focus-within\s*\{[^}]*var\(--ygd-panel-control-focus/)
    assert.match(css, /\.dsh-standard-question-answer-shell \.dsh-standard-question-text:focus-visible\s*\{ outline: 0; box-shadow: none;/)
    assert.doesNotMatch(css, /outline: 2px solid #6e56cf|border-color: #663ae8/)
    assert.match(css, /\.dsh-design-form-group-content\.has-sidecar[^{}]+\{[^}]*auto-fit/,
      'meaningful edit/result preview compositions are not forced to one column')
  } finally { dom.window.close() }
})
