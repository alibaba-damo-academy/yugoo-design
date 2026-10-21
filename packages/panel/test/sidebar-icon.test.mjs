import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SIDEBAR_ICONS, parsePanelManifest, localizePanelManifest } from '../../core/src/panel-dsl.ts'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sidebarIcon } from '../src/sidebar-icon.tsx'
import { renderManifest } from '../src/interpreter.ts'
import { StandardQuestionWorkspace } from '../src/question-list.tsx'
import { graphManifest } from './fixtures/declarative-visuals.mjs'

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'CustomEvent']) {
  if (globalThis[key] === undefined) globalThis[key] = dom.window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')

test('every finite name maps to one decorative 16px icon; unsafe names are not imported', () => {
  assert.equal(sidebarIcon(), undefined)
  for (const name of SIDEBAR_ICONS) {
    const html = renderToStaticMarkup(sidebarIcon(name))
    const svg = new JSDOM(html).window.document.querySelector('svg')
    assert.equal(svg.getAttribute('data-sidebar-icon'), name)
    assert.equal(svg.getAttribute('width'), '16')
    assert.equal(svg.getAttribute('height'), '16')
    assert.equal(svg.getAttribute('aria-hidden'), 'true')
    assert.equal(svg.getAttribute('focusable'), 'false')
  }
  for (const name of ['__proto__', 'constructor', 'toString', 'missing', '<svg/>', null, 'https://example.test/a.svg']) {
    assert.throws(() => sidebarIcon(name), /Unknown sidebar icon/)
  }
})

test('every applicable public Web App Bundle renders its icon only in a sidebar title, without editing canonical preview facts', async () => {
  const web = ['ai_agent_capabilities', 'business_data', 'business_rules', 'design_style', 'flow_design', 'function_modules',
    'integration_design', 'notification_design', 'page_design', 'quality_acceptance', 'research', 'role_access',
    'smart_questions', 'web_app_prd_assembly', 'whiteboard']
  for (const [directory, names] of [['skills-web-app/bundles', web]]) {
    for (const name of names) {
      const root = new URL(`../../${directory}/${name}/`, import.meta.url)
      const manifest = parsePanelManifest(await readFile(new URL('panel.yaml', root), 'utf8'))
      const data = JSON.parse(await readFile(new URL('reference/preview.json', root), 'utf8'))
      const before = JSON.stringify(data)
      for (const locale of ['zh-CN', 'en-US']) {
        const localized = localizePanelManifest(manifest, locale)
        const html = renderToStaticMarkup(renderManifest(localized, data, { locale, editable: false }))
        const document = new JSDOM(html).window.document
        const icons = document.querySelectorAll('[data-sidebar-icon]')
        assert.ok(icons.length >= 1, `${name}/${locale}: icon rendered`)
        for (const icon of icons) {
          assert.ok(icon.closest('.dsh-panel-workspace-tree > header, .dsh-panel-workspace-navigation h2, .dsh-preview-presets-title'), `${name}: header only`)
        }
        const legacy = structuredClone(localized)
        const remove = node => { delete node.sidebar_icon; for (const child of node.children ?? []) remove(child); for (const child of Object.values(node.slots ?? {})) remove(child) }
        remove(legacy.ui)
        const old = new JSDOM(renderToStaticMarkup(renderManifest(legacy, data, { locale, editable: false }))).window.document
        assert.equal(old.querySelectorAll('[data-sidebar-icon]').length, 0, 'omitted declaration has no selected icon')
        assert.equal(document.body.textContent, old.body.textContent, `${name}: unchanged titles, labels and copy`)
        assert.deepEqual([...document.querySelectorAll('button')].map(button => button.textContent), [...old.querySelectorAll('button')].map(button => button.textContent), `${name}: unchanged actions`)
      }
      assert.equal(JSON.stringify(data), before, `${name}: canonical remains unchanged`)
    }
  }
})

test('question title icon preserves accessible navigation and canonical answer callback', async () => {
  const root = createRoot(document.getElementById('root'))
  const questions = [{ id: 'one', prompt: 'First question', kind: 'single', answer: '', choices: [{ value: 'user-choice', label: 'User choice' }] }, { id: 'two', prompt: 'Second question', kind: 'text', answer: '' }]
  const changes = []
  await act(async () => root.render(React.createElement(StandardQuestionWorkspace, {
    title: 'Question navigator', sidebarIcon: 'message-circle-question', questions,
    editable: true, onAnswerChange: (...args) => changes.push(args),
  })))
  const nav = document.querySelector('nav[aria-label="Question navigator"]')
  assert.ok(nav)
  assert.equal(nav.querySelectorAll('h2 [data-sidebar-icon]').length, 1)
  assert.equal(nav.querySelectorAll('[data-sidebar-icon]').length, 1, 'not copied to entries')
  assert.ok(nav.querySelector('button'), 'existing navigation retained')
  const input = document.querySelector('input[type="radio"]')
  assert.ok(input)
  await act(async () => input.click())
  assert.deepEqual(questions[0].answer, '', 'presentation does not mutate caller facts')
  assert.deepEqual(changes, [['one', 'user-choice']], 'original answer flow remains live')
  await act(async () => root.unmount())
})

test('question_rounds and both record navigation layouts consume the same finite title icon', async () => {
  const questionRoot = new URL('../../skills-web-app/bundles/smart_questions/', import.meta.url)
  const question = parsePanelManifest(await readFile(new URL('panel.yaml', questionRoot), 'utf8'))
  const facts = JSON.parse(await readFile(new URL('reference/preview.json', questionRoot), 'utf8'))
  question.ui.component = 'question_rounds'
  const rounds = new JSDOM(renderToStaticMarkup(renderManifest(question, facts))).window.document
  assert.equal(rounds.querySelector('nav h2 [data-sidebar-icon]').getAttribute('data-sidebar-icon'), 'message-circle-question')
  const objects = structuredClone(graphManifest)
  for (const layout of ['tree', 'list']) {
    objects.ui.navigation_layout = layout
    const document = new JSDOM(renderToStaticMarkup(renderManifest(objects, {}))).window.document
    assert.equal(document.querySelectorAll('[data-sidebar-icon="network"]').length, 1, layout)
  }
})

test('semantic title chrome is scoped and does not override the existing narrow-container header rule', async () => {
  const css = await readFile(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  assert.match(css, /\.dsh-panel-workspace-tree > :where\(header:has\(> \[data-sidebar-icon\]\)\) \{ display: flex; align-items: center; gap: 8px;/)
  assert.match(css, /\.dsh-panel-workspace-sidebar \[data-sidebar-icon\]\[aria-hidden\] \{ flex: none; width: 16px; height: 16px; color: var\(--ds-text-tertiary, #777\);/)
  assert.match(css, /@container[^{}]*\([^)]*620px[^)]*\)[\s\S]*?\.dsh-panel-workspace-tree > header \{ display: none; \}/)
  // :where keeps the conditional icon layout at one class of specificity;
  // the existing narrow rule (one class + header) remains authoritative.
})
