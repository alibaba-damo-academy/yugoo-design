import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const css = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
const dom = new JSDOM('<style></style><div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
document.querySelector('style').textContent = css
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { PanelWorkspaceNavigation } = await import('../src/panel-workspace.tsx')
const { StandardQuestionWorkspace } = await import('../src/question-list.tsx')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')

test('shared navigation optional slots, explicit markers and native base styles work for neutral records', async () => {
  const root = createRoot(document.getElementById('root'))
  const selected = []
  const items = [
    { id: 'plain', label: 'Plain record' },
    { id: 'display', label: 'Detailed record', description: 'Existing supporting description', supporting: '4 outputs', current: true, status: 'complete', statusLabel: 'Ready' },
    { id: 'marker', label: 'Explicit status', status: 'partial', statusIndicator: true, meta: '1/2' },
    { id: 'no-state', label: 'No inferred status', statusIndicator: true },
  ]
  const before = structuredClone(items)
  try {
    await React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' },
      React.createElement(PanelWorkspaceNavigation, { title: 'Neutral navigation', items, selectedId: 'display', onSelect: id => selected.push(id),
        actions: React.createElement('button', { className: 'dsh-record-workspace-flat-add', type: 'button' }, 'Add record') }))))
    const buttons = [...document.querySelectorAll('nav button')]
    assert.equal(buttons[0].querySelector('.dsh-panel-workspace-nav-footer'), null)
    assert.equal(buttons[0].hasAttribute('data-status'), false)
    assert.equal(buttons[1].querySelector('.dsh-panel-workspace-nav-description').title, items[1].description)
    assert.equal(buttons[1].querySelector('.dsh-panel-workspace-current').textContent, 'Current')
    assert.equal(buttons[1].querySelector('.dsh-panel-workspace-nav-footer').textContent, '4 outputsReady')
    assert.equal(buttons[1].querySelector('.dsh-panel-workspace-nav-status'), null, 'a real status alone does not authorize a dot')
    assert.equal(buttons[2].querySelectorAll('.dsh-panel-workspace-nav-status').length, 1)
    assert.equal(buttons[3].querySelector('.dsh-panel-workspace-nav-status'), null, 'indicator without status never manufactures a dot')
    assert.equal(document.querySelectorAll('[aria-current=page]').length, 1)
    const style = window.getComputedStyle(buttons[1])
    assert.equal(style.display, 'block')
    assert.equal(style.minHeight, '36px')
    assert.equal(style.paddingLeft, '8px')
    assert.equal(style.paddingTop, '8px')
    assert.equal(style.backgroundColor, 'rgb(243, 240, 255)')
    assert.equal(style.color, 'rgb(16, 8, 43)')
    assert.equal(window.getComputedStyle(buttons[1].querySelector('.dsh-panel-workspace-nav-label')).fontSize, '14px')
    assert.equal(window.getComputedStyle(buttons[1].querySelector('.dsh-panel-workspace-nav-label')).fontWeight, '500')
    assert.equal(window.getComputedStyle(document.querySelector('.dsh-panel-workspace-nav-items')).gap, '4px')
    assert.equal(/\.dsh-panel-workspace-nav-items button(?::|\[)[^{}]*::before/.test(css), false, 'no compulsory pseudo status marker')
    await React.act(async () => buttons[0].click())
    assert.deepEqual(selected, ['plain'])
    assert.deepEqual(items, before)
    assert.equal(document.querySelector('.dsh-record-workspace-flat-add').textContent, 'Add record')
  } finally { await React.act(async () => root.unmount()) }
})

test('question navigation shows only localized rounds and titles while preserving history and answer progress', async () => {
  const root = createRoot(document.getElementById('root'))
  const questions = [
    { id: 'latest', prompt: 'Current evidence question', kind: 'text', answer: 'Evidence', round: 2 },
    { id: 'rejected', prompt: 'Rejected evidence', kind: 'text', answer: '', rejected: true, round: 2 },
    { id: 'history', prompt: 'Prior question', kind: 'text', answer: 'Prior answer', round: 1 },
    { id: 'fixed', prompt: 'Retained configuration', kind: 'text', answer: 'Preserved' },
  ]
  const before = structuredClone(questions)
  const updates = []
  const show = locale => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
    React.createElement(StandardQuestionWorkspace, { questions, numberedRounds: true, firstRoundIds: ['fixed'], protectedQuestionIds: ['fixed'],
      historyReadonly: true, editable: true, onAnswerChange: (...args) => updates.push(args) }))))
  try {
    await show('en-US')
    const buttons = () => [...document.querySelectorAll('.dsh-panel-workspace-nav-items button')]
    assert.equal(buttons().length, 2)
    assert.equal(buttons()[0].querySelector('.dsh-panel-workspace-nav-eyebrow').textContent, 'Round 2')
    assert.equal(buttons()[0].querySelector('.dsh-panel-workspace-nav-label').textContent, 'Current evidence question')
    assert.equal(buttons()[1].querySelector('.dsh-panel-workspace-nav-eyebrow').textContent, 'Round 1')
    assert.equal(buttons()[1].querySelector('.dsh-panel-workspace-nav-label').textContent, 'Prior question')
    const number = buttons()[0].querySelector('.dsh-panel-workspace-nav-eyebrow')
    assert.equal(number, buttons()[0].firstElementChild, 'number precedes the primary title in visual and reading order')
    assert.equal(window.getComputedStyle(number).display, 'block')
    assert.equal(window.getComputedStyle(number).fontSize, '12px')
    assert.equal(window.getComputedStyle(number).fontWeight, '400')
    assert.equal(window.getComputedStyle(buttons()[0].querySelector('.dsh-panel-workspace-nav-label')).whiteSpace, 'normal', 'titles wrap when the sidebar is resized')
    assert.equal(document.querySelector('.dsh-panel-workspace-nav-description'), null)
    assert.equal(document.querySelector('.dsh-panel-workspace-nav-footer'), null)
    assert.equal(document.querySelector('.dsh-question-workspace-header h2').textContent, 'Current evidence question')
    assert.equal(document.querySelector('.dsh-question-workspace-header > span').textContent, '1/2 answered', 'progress remains in the content header')
    assert.equal(document.querySelector('.dsh-panel-workspace-nav-status'), null)
    await React.act(async () => buttons()[1].click())
    assert.ok(document.querySelector('[data-question-id="history"]'))
    assert.ok(document.querySelector('[data-question-id="fixed"]'))
    assert.equal(document.querySelector('[data-question-id="latest"]'), null)
    assert.equal(document.querySelector('.dsh-standard-question-list input,.dsh-standard-question-list textarea'), null, 'history remains readonly')
    await show('zh-CN')
    assert.equal(buttons()[1].getAttribute('aria-current'), 'page', 'locale does not reset manual selection')
    assert.equal(buttons()[0].querySelector('.dsh-panel-workspace-nav-eyebrow').textContent, '第 2 轮')
    assert.equal(buttons()[0].querySelector('.dsh-panel-workspace-nav-label').textContent, 'Current evidence question')
    assert.equal(document.querySelector('.dsh-panel-workspace-current'), null)
    assert.deepEqual(updates, [])
    assert.deepEqual(questions, before)
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
