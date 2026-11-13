/** Focused regression for the persistent Design Project directory. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import {
  designProjectMigrationCommand,
  DesignProjectSidebarEntry,
  sortDesignProjectsNewestFirst,
} from './lib/index.js'

const clientSource = await readFile(new URL('./src/client/index.tsx', import.meta.url), 'utf8')
const sidebarSource = await readFile(new URL('./src/client/design-project-sidebar-entry.tsx', import.meta.url), 'utf8')
assert.match(clientSource, /id: 'design-sidebar-actions',[\s\S]*?order: 90,[\s\S]*?DesignSidebarActionsHost/)
assert.match(clientSource, /dsh-design-sidebar-actions[\s\S]*?<DesignProjectSidebarHost wide=\{wide\} \/>[\s\S]*?<AdvisorySidebarHost wide=\{wide\} \/>/)
assert.match(clientSource, /listProjects: async \(sessionId\)[\s\S]*?designPanel\.listProjects/)

const projects = [
  { projectId: 'old', name: 'Old', root: '/old', updatedAt: '2026-01-01T00:00:00.000Z' },
  { projectId: 'new', name: 'New', root: '/new', updatedAt: '2026-02-01T00:00:00.000Z' },
]
assert.deepEqual(sortDesignProjectsNewestFirst(projects).map(project => project.projectId), ['new', 'old'])
assert.equal(designProjectMigrationCommand('/projects/legacy project'), '/yugoo migrate /projects/legacy project')
assert.doesNotMatch(sidebarSource, /disabled=\{!canRecover\}/)

const html = renderToStaticMarkup(createElement(DesignProjectSidebarEntry, {
  wide: true,
  expanded: false,
  catalog: { currentProjectId: 'new', projects, mindsets: [{ name: 'web_app', version: '1.0' }] },
  loading: false,
  onToggle: () => {},
  onRefresh: () => {},
  onCommand: () => {},
}))
assert.match(html, /dsh-project-sidebar-trigger/)
assert.match(html, /aria-haspopup="dialog"/)
assert.match(html, />Design projects<|>设计项目</)

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.Node = dom.window.Node
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const root = createRoot(document.querySelector('#root'))
const commands = []
let trigger = { left: 16, right: 176, bottom: 64 }
let popup = { width: 360, height: 420 }
let observedResize
let observerDisconnected = false
globalThis.ResizeObserver = class {
  constructor(callback) { observedResize = callback }
  observe() {}
  disconnect() { observerDisconnected = true }
}
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  return this.classList.contains('dsh-project-catalog') ? popup : trigger
}
Object.assign(window, { innerWidth: 1280, innerHeight: 800 })
try {
  for (const [language, title, action] of [['en-US', 'Kit', 'Select kit'], ['zh-CN', '设计套件', '选择设计套件']]) {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language } })
    await act(async () => root.render(createElement(DesignProjectSidebarEntry, {
      key: language, wide: true, expanded: true,
      catalog: { currentProjectId: 'new', projects, mindsets: [{ name: 'web_app', version: '1.0' }] },
      loading: false, onToggle() {}, onRefresh() {}, onCommand: command => commands.push(command),
    })))
    const footer = document.querySelector('.dsh-project-mindset')
    assert.equal(footer.querySelector('strong').textContent, title)
    const select = footer.querySelector('select')
    assert.equal(select.getAttribute('aria-label'), action)
    assert.equal(select.options[0].textContent, `${action}…`)
    assert.equal(select.options[1].value, 'web_app', 'catalog identity remains exact')
    await act(async () => {
      select.value = 'web_app'
      select.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
    await act(async () => footer.querySelector('button').click())
    const migrate = document.querySelector('.dsh-project-row:last-child .dsh-project-migrate')
    assert.equal(migrate.textContent, language === 'zh-CN' ? '迁移' : 'Migrate')
    assert.equal(migrate.getAttribute('aria-label'), language === 'zh-CN' ? '迁移 Old' : 'Migrate Old')
    assert.equal(migrate.disabled, false, 'migration remains available without changing the existing action geometry')
    await act(async () => migrate.click())
  }
  assert.deepEqual(commands, ['/yugoo kit web_app', '/yugoo migrate /old', '/yugoo kit web_app', '/yugoo migrate /old'],
    'Kit selection and bilingual migration use the canonical Host commands')
  const catalogStyle = () => document.querySelector('.dsh-project-catalog').style
  assert.equal(catalogStyle().top, '8px', 'a top sidebar trigger keeps the catalog header onscreen')
  assert.equal(catalogStyle().left, '184px')
  assert.equal(catalogStyle().bottom, '', 'top positioning replaces the legacy bottom anchor')
  trigger = { left: 16, right: 176, bottom: 784 }
  await act(async () => window.dispatchEvent(new window.Event('resize')))
  assert.equal(catalogStyle().top, '364px', 'a bottom sidebar trigger retains bottom alignment')
  popup = { width: 360, height: 500 }
  await act(async () => observedResize())
  assert.equal(catalogStyle().top, '284px', 'catalog growth repositions its header')
  Object.assign(window, { innerWidth: 390, innerHeight: 700 })
  trigger = { left: 16, right: 176, bottom: 64 }
  await act(async () => window.dispatchEvent(new window.Event('resize')))
  assert.equal(catalogStyle().left, '22px', 'narrow viewports keep the right edge visible')
  assert.equal(catalogStyle().top, '8px')
} finally {
  await act(async () => root.unmount())
  assert.ok(observerDisconnected, 'unmount releases the catalog observer')
  delete globalThis.ResizeObserver
  dom.window.close()
}

console.log('DESIGN PROJECT SIDEBAR OK')
