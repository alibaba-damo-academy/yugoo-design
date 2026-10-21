/** Focused DOM smoke for the persistent sidebar Design-advisory entry. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import {
  AdvisorySidebarEntry,
  pendingAdvisoryCount,
} from './lib/index.js'
import { advisoryEntries } from './fixtures/advisory-review.mjs'

const [clientSource, stylesSource] = await Promise.all([
  readFile(new URL('./src/client/index.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./src/client/styles.ts', import.meta.url), 'utf8'),
])
// Execute the production visibility store, not a duplicate fixture policy.
const visibilityStart = clientSource.indexOf('let advisoryInboxVisibilityRevision = 0')
const visibilityEnd = clientSource.indexOf('/** Share one per-session inbox toggle', visibilityStart)
assert.ok(visibilityStart >= 0 && visibilityEnd > visibilityStart)
const visibilityCode = ts.transpileModule(
  clientSource.slice(visibilityStart, visibilityEnd),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText
const visibility = runInNewContext(`${visibilityCode}\nadvisoryInboxVisibility`)
assert.equal(visibility.isExpanded(undefined), false)
assert.equal(visibility.isExpanded('new-session'), false, 'entering a session must not open the advice window')
assert.equal(visibility.toggle('new-session'), true, 'the first explicit sidebar click opens the window')
assert.equal(visibility.isExpanded('other-session'), false, 'a different session does not inherit open state')
visibility.setExpanded('new-session', false)
assert.equal(visibility.isExpanded('new-session'), false, 'close/Later keeps the current session collapsed')
assert.equal(visibility.toggle('new-session'), true, 'the user can reopen a collapsed window')
// Exercise the production effect's asynchronous snapshot boundary: advice
// already present when entering is not a newly published notification.
const observationStart = clientSource.indexOf('    const previous = observedAdvisories.current')
const observationEnd = clientSource.indexOf('  }, [actionableIdKey', observationStart)
assert.ok(observationStart >= 0 && observationEnd > observationStart)
const observationCode = clientSource.slice(observationStart, observationEnd)
const autoOpened = []
const observation = {
  observedAdvisories: { current: { scope: 'entry:project', ids: new Set(), initialized: false } },
  advisoryScope: 'entry:project', actionableIds: [], entries: [], loaded: false,
  expanded: false, sessionId: 'entry',
  selectPendingAdvisories: list => list.map(entry => ({ ...entry.advisory, status: entry.status })),
  advisoryInboxVisibility: { setExpanded: (...args) => autoOpened.push(args) },
}
const observe = () => runInNewContext(`(() => {${observationCode}})()`, observation)
observe()
observation.loaded = true
observation.entries = [{ status: 'pending', advisory: { id: 'existing-advice' } }]
observation.actionableIds = ['existing-advice']
observe()
assert.equal(autoOpened.length, 0, 'the first async snapshot of existing advice must stay collapsed')
observation.entries.push({ status: 'pending', advisory: { id: 'new-advice' } })
observation.actionableIds.push('new-advice')
observe()
assert.equal(autoOpened.length, 1, 'a genuinely new advice still opens after the initial snapshot')
assert.equal(autoOpened[0][2], 'new-advice')
observation.advisoryScope = 'other-entry:project'
observation.sessionId = 'other-entry'
observation.actionableIds = ['other-existing-advice']
observation.entries = [{ status: 'pending', advisory: { id: 'other-existing-advice' } }]
observe()
assert.equal(autoOpened.length, 1, 'entering a different scope only establishes its baseline')
assert.match(
  clientSource,
  /slots\.inject\('sidebar\.footer\.action',[\s\S]*?id: 'design-sidebar-actions',[\s\S]*?order: 90,[\s\S]*?DesignSidebarActionsHost/,
  'the grouped Design actions must occupy the persistent sidebar footer-action slot',
)
assert.match(
  clientSource,
  /dsh-design-sidebar-actions[\s\S]*?<DesignProjectSidebarHost wide=\{wide\} \/>[\s\S]*?<AdvisorySidebarHost wide=\{wide\} \/>/,
  'Design Projects must stack above the independent Design Advisories button',
)
assert.doesNotMatch(
  clientSource,
  /if \(entry\.stale \|\|/,
  'a stale advisory remains visible and is revalidated only after the user accepts it',
)
assert.match(stylesSource, /\.dsh-design-sidebar-actions\{[^}]*flex-direction:column/)
assert.match(stylesSource, /\.dsh-advisory-sidebar-entry\[data-empty\] \.dsh-advisory-sidebar-trigger/)
assert.match(stylesSource, /\.dsh-advisory-sidebar-entry-rail \.dsh-advisory-sidebar-badge\{position:absolute/)
const composerTrigger = stylesSource.match(/\.dsh-advisory-composer-entry \.dsh-advisory-sidebar-trigger\{([^}]+)\}/)?.[1]
assert.match(composerTrigger, /height:28px/)
assert.match(composerTrigger, /padding:0 4px 0 8px/)
assert.match(composerTrigger, /font-size:13px;line-height:20px/)
assert.match(composerTrigger, /border-radius:var\(--dsw-radius-sm,8px\)/)
assert.match(stylesSource, /\.dsh-advisory-composer-entry \.dsh-advisory-sidebar-icon\{width:14px;height:14px\}/)
assert.match(stylesSource, /@container \(max-width:460px\)\{\.dsh-advisory-composer-entry \.dsh-advisory-sidebar-label\{display:none\}\}/,
  'the composer label follows the Host tool-row size container, matching its permission control')
assert.doesNotMatch(stylesSource, /@media[^{}]*width[^{}]*\{[^{}]*dsh-advisory-composer-entry/,
  'whole-window width must not decide the composer label')

assert.equal(pendingAdvisoryCount(advisoryEntries), 3, 'count excludes accepted and terminal review entries')
assert.equal(pendingAdvisoryCount([]), 0)

const noop = async () => {}
const pendingHtml = renderToStaticMarkup(createElement(AdvisorySidebarEntry, {
  wide: true,
  entries: advisoryEntries,
  expanded: true,
  onToggle: noop,
}))
assert.match(pendingHtml, /class="dsh-advisory-sidebar-label">Design advisories<\/span>/)
assert.match(pendingHtml, /class="dsh-advisory-sidebar-badge" aria-hidden="true">3<\/span>/)
assert.match(pendingHtml, /aria-controls="dsh-advisory-composer-inbox"/)
assert.match(pendingHtml, /aria-expanded="true"/)
assert.doesNotMatch(pendingHtml, /aria-haspopup/)
assert.doesNotMatch(pendingHtml, /dsh-advisory-card|dsh-advisory-sidebar-popover/)
assert.doesNotMatch(pendingHtml, /data-empty/)

const emptyHtml = renderToStaticMarkup(createElement(AdvisorySidebarEntry, {
  wide: false,
  entries: [],
  expanded: true,
  onToggle: noop,
}))
assert.match(emptyHtml, /dsh-advisory-sidebar-entry-rail/)
assert.match(emptyHtml, /data-empty="true"/)
assert.doesNotMatch(emptyHtml, /dsh-advisory-sidebar-badge/)
assert.match(emptyHtml, /aria-expanded="true"/)
assert.doesNotMatch(emptyHtml, /disabled=""/)

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
})
for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'PointerEvent', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: dom.window[name] ?? dom.window.MouseEvent,
  })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const calls = []
const container = document.querySelector('#root')
assert.ok(container instanceof HTMLElement)
const root = createRoot(container)
await act(async () => {
  root.render(createElement(AdvisorySidebarEntry, {
    wide: true,
    entries: advisoryEntries,
    expanded: true,
    onToggle: () => { calls.push('toggle') },
  }))
})

const trigger = container.querySelector('.dsh-advisory-sidebar-trigger')
assert.ok(trigger instanceof HTMLElement)
await act(async () => { trigger.click() })
assert.deepEqual(calls, ['toggle'], 'click toggles the single composer inbox without rendering a second review card')
assert.equal(container.querySelector('[data-testid="dsh-advisory-sidebar-popover"]'), null)
assert.equal(container.querySelector('[data-advisory-id]'), null)
await act(async () => { root.unmount() })
dom.window.close()

console.log('ADVISORY SIDEBAR ENTRY OK')
