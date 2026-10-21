/** Real React state transitions using scheduler snapshots, without Host/model execution. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AdvisorySidebarEntry, hasVisibleAdvisorySidebarEntry, observeAdvisorySidebarVisibility } from '../src/client/advisory-sidebar-entry.tsx'
import { equalWorkspaceEmission } from '../src/client/types.ts'
import { bindDesignHostLocale } from '../src/client/ported/host.ts'
import { advisoryEntries } from '../fixtures/advisory-review.mjs'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'en-US' } })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
after(() => dom.window.close())
const profiles = ['grounding', 'reflection', 'alignment']
const runtime = phases => ({ available: true, profiles,
  phase: phases.includes('running') ? 'running' : phases.includes('scheduled') ? 'scheduled' : phases.includes('failed') ? 'failed' : 'idle',
  profileStatus: phases.map((phase, i) => ({ profile: profiles[i], phase, latestRevision: 10 })),
})
const button = () => document.querySelector('button')
const status = () => document.querySelector('[role="status"]')
const phase = () => document.querySelector('.dsh-advisory-sidebar-entry')?.dataset.reviewPhase
const working = () => document.querySelectorAll('[data-execution-status="working"]').length
async function withEntry(run) {
  const root = createRoot(document.getElementById('root'))
  const render = async props => act(async () => root.render(React.createElement(AdvisorySidebarEntry,
    { wide: true, entries: [], expanded: false, onToggle() {}, ...props })))
  try { await run(render) } finally { await act(async () => root.unmount()) }
}

test('zero pending advice can be scheduled or running, with counts and accessible status', async () => withEntry(async render => {
  await render({ runtime: runtime(['scheduled', 'scheduled', 'scheduled']) })
  assert.equal(phase(), 'scheduled')
  assert.match(button().getAttribute('aria-label'), /0 design advisories pending.*Reviews scheduled · 3/)
  assert.equal(working(), 0, 'queued work is not animated as running')
  assert.equal(document.querySelector('.dsh-advisory-sidebar-badge'), null)
  await render({ runtime: runtime(['running', 'running', 'running']) })
  assert.equal(phase(), 'running')
  assert.match(status().textContent, /Reviewing · 3/)
  assert.equal(status().getAttribute('aria-live'), 'polite')
  assert.equal(status().getAttribute('aria-atomic'), 'true')
  assert.equal(working(), 1)
  assert.equal(button().getAttribute('title'), button().getAttribute('aria-label'))
  assert.equal(button().disabled, false)
}))

test('concurrent completions, queued work and failures do not clear still-running work or hide failures', async () => withEntry(async render => {
  for (const [phases, label] of [
    [['running', 'running', 'idle'], 'Reviewing · 2'],
    [['running', 'scheduled', 'failed'], 'Reviewing · 1 · 1 failed · 1 scheduled'],
    [['idle', 'scheduled', 'failed'], 'Reviews scheduled · 1 · 1 failed'],
    [['idle', 'idle', 'failed'], 'Review failed · 1'],
  ]) {
    await render({ runtime: runtime(phases) })
    assert.equal(status().textContent, phases.includes('failed') && !phases.includes('running') && !phases.includes('scheduled') ? `×${label}` : label)
    assert.equal(working(), phases.includes('running') ? 1 : 0)
    assert.ok(button().getAttribute('aria-label').includes(label))
  }
  await render({ runtime: runtime(['idle', 'idle', 'idle']) })
  assert.equal(phase(), 'idle')
  assert.equal(status().textContent, '')
  assert.equal(working(), 0)
  assert.doesNotMatch(button().getAttribute('aria-label'), /completed|successful|failed|Reviewing/)
}))

test('cancellation/reset, scope replacement and fresh mounts leave no remembered activity', async () => {
  await withEntry(async render => {
    await render({ key: 'session-a:project-a', runtime: runtime(['running', 'running', 'running']) })
    assert.equal(working(), 1)
    await render({ key: 'session-a:project-a', runtime: runtime([]) })
    assert.equal(working(), 0, 'the scheduler reset is enough; no timer or artificial success is needed')
    await render({ key: 'session-a:project-b' })
    assert.equal(phase(), undefined)
    assert.equal(status().textContent, '')
    assert.equal(working(), 0)
  })
  await withEntry(async render => {
    await render({ runtime: runtime(['idle', 'idle', 'idle']) })
    assert.equal(working(), 0)
    await render({ runtime: runtime(['running', 'idle', 'idle']) })
    assert.equal(working(), 1, 'reopening reads the supplied actual snapshot')
  })
})

test('aggregate-only scheduler reports activity without fabricating profile counts', async () => withEntry(async render => {
  for (const [phase, label] of [['scheduled', 'Reviews scheduled'], ['running', 'Reviewing'], ['failed', 'Review failed']]) {
    await render({ runtime: { available: true, profiles, phase } })
    assert.ok(button().getAttribute('aria-label').endsWith(` · ${label}`))
    assert.equal(working(), phase === 'running' ? 1 : 0)
  }
}))

test('disconnection and unavailable scheduler stop stale animation; reconnection uses fresh status', async () => withEntry(async render => {
  const snapshot = runtime(['running', 'running', 'running'])
  await render({ runtime: snapshot })
  await render({ runtime: snapshot, disconnected: true })
  assert.equal(phase(), 'unavailable')
  assert.equal(working(), 0)
  assert.match(button().getAttribute('aria-label'), /Review status disconnected/)
  assert.doesNotMatch(status().textContent, /Reviewing/)
  await render({ runtime: { available: false, profiles: [], phase: 'failed', lastError: 'not installed' } })
  assert.equal(phase(), 'unavailable')
  assert.match(status().textContent, /Background reviews unavailable/)
  await render({ runtime: runtime(['idle', 'idle', 'idle']) })
  assert.equal(status().textContent, '')
  assert.equal(working(), 0)
}))

test('pending-advice count and click behavior remain independent in wide and icon-rail modes', async () => withEntry(async render => {
  let toggles = 0
  for (const wide of [true, false]) {
    await render({ wide, entries: advisoryEntries, runtime: runtime(['running', 'idle', 'idle']), onToggle: () => toggles++ })
    assert.equal(document.querySelector('.dsh-advisory-sidebar-badge').textContent, '3')
    assert.match(button().getAttribute('aria-label'), /3 design advisories pending.*Reviewing/)
    assert.equal(button().getAttribute('aria-controls'), 'dsh-advisory-composer-inbox')
    assert.equal(document.querySelectorAll('[data-advisory-id]').length, 0, 'no second review card is introduced')
    await act(async () => button().click())
    assert.equal(document.querySelector('.dsh-advisory-sidebar-label') !== null, wide)
    assert.equal(working(), 1)
  }
  assert.equal(toggles, 2, 'the original inbox toggle is the only user action')
}))

test('composer-free inbox is anchored, non-modal and leaves native settings Escape to its owner', async () => {
  const priorNode = globalThis.Node, priorResize = globalThis.ResizeObserver
  globalThis.Node = window.Node
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  const outside = document.createElement('button')
  outside.textContent = 'Design field'
  document.body.append(outside)
  try {
    await withEntry(async render => {
      let toggles = 0
      const onToggle = () => toggles++
      const content = React.createElement('section', { id: 'dsh-advisory-composer-inbox' },
        React.createElement('button', null, 'Review action'),
        React.createElement('dialog', { open: true }, 'Settings'))
      await render({ wide: false, expanded: false, popoverContent: content, onToggle })
      const trigger = button()
      trigger.getBoundingClientRect = () => ({ left: 900, right: 936, top: 660, bottom: 700, width: 36, height: 40 })
      outside.focus()
      await render({ wide: false, expanded: true, popoverContent: content, onToggle })
      const popup = document.querySelector('.dsh-advisory-sidebar-popover')
      assert.equal(popup.parentElement, document.body)
      assert.equal(popup.getAttribute('aria-modal'), null, 'no modal focus isolation or backdrop')
      assert.equal(popup.style.left, '332px', 'the right rail lightbulb keeps an 8px gap')
      assert.equal(document.activeElement, outside, 'a new automatic arrival never steals editing focus')
      assert.equal(document.querySelectorAll('#dsh-advisory-composer-inbox').length, 1)
      popup.getBoundingClientRect = () => ({ height: 500 })
      await act(async () => window.dispatchEvent(new window.Event('resize')))
      assert.equal(popup.style.top, '200px', 'content growth repositions within the viewport')
      await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      assert.equal(toggles, 0, 'the settings modal handles its own Escape before the parent')
      popup.querySelector('dialog').removeAttribute('open')
      popup.focus()
      await act(async () => popup.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      assert.equal(toggles, 1)
      assert.equal(document.activeElement, trigger, 'Escape from the popup restores the lightbulb')
      await render({ wide: false, expanded: false, popoverContent: content, onToggle })
      assert.equal(document.querySelector('.dsh-advisory-sidebar-popover'), null)
      trigger.focus()
      await act(async () => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
      assert.equal(toggles, 2)
      await render({ wide: false, expanded: true, popoverContent: content, onToggle })
      assert.equal(document.activeElement, document.querySelector('.dsh-advisory-sidebar-popover'), 'keyboard open focuses only after visible positioning commits')
      await render({ wide: false, expanded: false, popoverContent: content, onToggle })
      outside.focus()
      await render({ wide: false, expanded: true, popoverContent: content, onToggle })
      document.querySelector('.dsh-advisory-sidebar-popover dialog').removeAttribute('open')
      await act(async () => outside.dispatchEvent(new window.Event('pointerdown', { bubbles: true })))
      assert.equal(toggles, 3)
      assert.equal(document.activeElement, outside, 'outside close preserves the user target focus')
      await render({ wide: false, expanded: false, popoverContent: content, onToggle })
      outside.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
      assert.equal(toggles, 3, 'closing removes popup document listeners')
    })
  } finally {
    outside.remove()
    globalThis.Node = priorNode
    globalThis.ResizeObserver = priorResize
  }
})

test('composer keeps its label available for container adaptation without changing sidebar rail or review state', async () => withEntry(async render => {
  let toggles = 0
  await render({ wide: false, location: 'composer', entries: advisoryEntries,
    runtime: runtime(['running', 'idle', 'failed']), expanded: true, onToggle: () => toggles++ })
  const entry = document.querySelector('[data-advisory-entry="composer"]')
  assert.ok(entry)
  assert.equal(entry.querySelector('.dsh-advisory-sidebar-label').textContent, 'Design advisories', 'CSS can reveal the real label in a wide composer')
  assert.equal(entry.querySelector('.dsh-advisory-sidebar-badge').textContent, '3')
  assert.match(button().getAttribute('aria-label'), /3 design advisories pending.*Reviewing.*1 failed/)
  assert.equal(button().getAttribute('aria-controls'), 'dsh-advisory-composer-inbox')
  assert.equal(button().getAttribute('aria-expanded'), 'true')
  assert.equal(working(), 1)
  await act(async () => button().click())
  assert.equal(toggles, 1)
  await render({ wide: false, entries: advisoryEntries, runtime: runtime(['running', 'idle', 'failed']) })
  assert.equal(document.querySelector('.dsh-advisory-sidebar-label'), null, 'normal icon rail remains icon-only')
  assert.equal(document.querySelector('.dsh-advisory-sidebar-badge').textContent, '3')
  assert.equal(working(), 1)
}))

test('activity icon is centered in the composer without inheriting the sidebar rail corner anchor', async () => withEntry(async render => {
  const css = await readFile(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
  const activityRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector, declarations]) => selector.includes('.dsh-advisory-sidebar-activity') && /position:absolute/.test(declarations))
  const anchored = activity => activityRules.some(([, selector]) => activity.matches(selector.trim()))
  for (const location of ['sidebar', 'composer']) {
    await render({ wide: false, location, runtime: runtime(['running', 'idle', 'idle']) })
    const activity = document.querySelector('.dsh-advisory-sidebar-activity')
    assert.equal(anchored(activity), location === 'sidebar', 'only the real sidebar rail uses a bottom-corner activity anchor')
    const icon = activity.querySelector('.dsh-advisory-sidebar-activity-icon')
    assert.ok(icon?.querySelector('[data-execution-status="working"]'), 'the shared status icon has a local flex wrapper, not a text baseline wrapper')
  }
  assert.match(css, /\.dsh-advisory-sidebar-activity-icon\{[^}]*display:inline-flex;[^}]*align-items:center;[^}]*line-height:0/)
  await render({ wide: false, location: 'composer', runtime: runtime([]) })
  assert.equal(document.querySelector('.dsh-advisory-sidebar-activity-icon'), null, 'no wrapper or stale spinner remains after settlement')
}))

test('a live locale change updates activity and accessible names without resetting work', async () => {
  let language = 'en-US'
  const listeners = new Set()
  const release = bindDesignHostLocale({ getSnapshot: () => ({ active: language }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } })
  try {
    await withEntry(async render => {
      await render({ runtime: runtime(['running', 'idle', 'failed']) })
      await act(async () => { language = 'zh-CN'; for (const fn of listeners) fn() })
      assert.match(button().getAttribute('aria-label'), /设计建议 · 0 条设计建议待处理 · 正在评审 · 1 项 · 1 项失败/)
      assert.equal(working(), 1)
    })
  } finally { release() }
})

test('runtime-only transitions are listener-visible even with unchanged project, files, journal and U/S/T', () => {
  const workspace = { projectId: 'a', checkpoint: 'commit', journalRevision: 10, design: {},
    clarity: { assessment: null, needsReassessment: false }, advisoryRuntime: runtime(['scheduled', 'scheduled', 'scheduled']) }
  assert.equal(equalWorkspaceEmission(workspace, structuredClone(workspace)), true)
  for (const activity of [undefined, runtime(['running', 'running', 'running']), runtime([]),
    runtime(['failed', 'idle', 'idle']), { available: false, profiles: [], phase: 'failed' }]) {
    assert.equal(equalWorkspaceEmission(workspace, { ...workspace, advisoryRuntime: activity }), false)
  }
})

test('Host supplies existing scheduler and disconnection state; shared styles respect reduced motion', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/client/styles.ts', import.meta.url), 'utf8'),
  ])
  const host = source.slice(source.indexOf('function AdvisorySidebarHost('), source.indexOf('function DesignSidebarActionsHost('))
  assert.match(host, /runtime=\{projectId \? workspace\?\.advisoryRuntime : undefined\}/)
  assert.match(host, /usePanelWorkspaceFailure\(sessionId\)/)
  assert.match(host, /disconnected=\{failure !== undefined\}/)
  assert.match(source, /slots\.inject\('conversation\.input\.left',[\s\S]*?id: 'design-advisory-entry',[\s\S]*?AdvisoryComposerEntry/)
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.dsh-advisory-sidebar-entry\[data-review-phase=running\] \.dsh-advisory-sidebar-icon[^}]*dsh-advisory-sidebar-activity \.animate-spin\{animation:none\}/)
})

test('sidebar availability follows actual target and ancestor clips, not wide/rail state', () => {
  const host = document.createElement('aside')
  host.innerHTML = '<div data-advisory-entry="sidebar"><button class="dsh-advisory-sidebar-trigger"></button></div>'
  document.body.append(host)
  const trigger = host.querySelector('button')
  const rect = (left = 0, top = 0, width = 36, height = 36) => ({ left, top, width, height, right: left + width, bottom: top + height })
  trigger.getBoundingClientRect = () => rect()
  host.getBoundingClientRect = () => rect(0, 0, 250, 500)
  try {
    assert.equal(hasVisibleAdvisorySidebarEntry(document), true, 'icon rail remains a usable entry')
    trigger.getBoundingClientRect = () => rect(0, 0, 240, 42)
    assert.equal(hasVisibleAdvisorySidebarEntry(document), true, 'wide sidebar uses the same test')
    for (const css of ['display:none', 'visibility:hidden', 'opacity:0']) {
      host.style.cssText = css
      assert.equal(hasVisibleAdvisorySidebarEntry(document), false, css)
    }
    // jsdom does not expand overflow shorthand into computed axis values.
    host.style.cssText = 'overflow-x:hidden;overflow-y:hidden'
    host.getBoundingClientRect = () => rect(0, 0, 0, 500)
    assert.equal(hasVisibleAdvisorySidebarEntry(document), false, 'mounted action can be fully clipped')
    host.getBoundingClientRect = () => rect(0, 0, 36, 500)
    assert.equal(hasVisibleAdvisorySidebarEntry(document), true, 'a clipped wide label still leaves a usable icon target')
    host.style.cssText = ''
    trigger.getBoundingClientRect = () => rect(-300)
    assert.equal(hasVisibleAdvisorySidebarEntry(document), false, 'offscreen translated sidebar cannot retain the only entry')
    trigger.getBoundingClientRect = () => rect()
    host.setAttribute('inert', '')
    // jsdom has no inert implementation; browser exposes the inherited action gate.
    host.inert = true
    assert.equal(hasVisibleAdvisorySidebarEntry(document), false)
  } finally { host.remove() }
  assert.equal(hasVisibleAdvisorySidebarEntry(document), false, 'unmounted sidebar needs the composer fallback')
})

test('visibility observation retargets mounted ancestors and stops after disposal', async () => {
  const originalResize = window.ResizeObserver
  let observer
  window.ResizeObserver = class {
    targets = new Set()
    constructor(callback) { this.notify = callback; observer = this }
    observe(element) { this.targets.add(element) }
    disconnect() { this.targets.clear() }
  }
  const sidebar = document.createElement('aside')
  sidebar.style.cssText = 'overflow-x:hidden;overflow-y:hidden'
  sidebar.innerHTML = '<div data-advisory-entry="sidebar"><button class="dsh-advisory-sidebar-trigger"></button></div>'
  const rect = width => ({ left: 0, top: 0, right: width, bottom: 36, width, height: 36 })
  let width = 36
  let measurements = 0
  const trigger = sidebar.querySelector('button')
  trigger.getBoundingClientRect = () => { measurements++; return rect(36) }
  sidebar.getBoundingClientRect = () => rect(width)
  document.body.append(sidebar)
  const values = []
  const stop = observeAdvisorySidebarVisibility(document, visible => values.push(visible))
  const settle = () => new Promise(resolve => window.requestAnimationFrame(() => resolve()))
  try {
    assert.deepEqual(values, [true])
    assert.ok(observer.targets.has(sidebar) && observer.targets.has(trigger), 'observe actual action and clipping ancestors')
    const before = measurements
    const composer = document.createElement('div')
    composer.innerHTML = '<div data-advisory-entry="composer"><button class="dsh-advisory-sidebar-trigger"></button></div>'
    document.body.append(composer)
    composer.style.display = 'none'
    composer.dispatchEvent(new window.Event('scroll', { bubbles: true }))
    await settle()
    assert.equal(measurements, before, 'fallback and unrelated content do not observe themselves')
    composer.remove()
    width = 0
    observer.notify()
    await settle()
    assert.deepEqual(values, [true, false], 'ancestor resize can hide an unchanged mounted action')
    width = 36
    window.dispatchEvent(new window.Event('resize'))
    await settle()
    assert.deepEqual(values, [true, false, true])
    sidebar.hidden = true
    await settle()
    assert.deepEqual(values, [true, false, true, false], 'ancestor attribute changes are observed')
    sidebar.hidden = false
    await settle()
    sidebar.remove()
    await settle()
    assert.equal(observer.targets.size, 0, 'unmounted ancestors are released')
    document.body.append(sidebar)
    await settle()
    assert.equal(values.at(-1), true, 'Host remount restores sidebar availability')
    stop()
    assert.equal(observer.targets.size, 0)
    const count = values.length
    sidebar.hidden = true
    window.dispatchEvent(new window.Event('resize'))
    await settle()
    assert.equal(values.length, count, 'disposal removes mutation, resize and pending-frame callbacks')
  } finally {
    stop()
    sidebar.remove()
    window.ResizeObserver = originalResize
  }
})

test('composer fallback mounts only while sidebar unavailable and keeps the same toggle, status and focus', async () => {
  const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  const visibilityStart = source.indexOf('let advisoryInboxVisibilityRevision = 0')
  const visibilityEnd = source.indexOf('/** Reveal the single Design-advisory', visibilityStart)
  const hostStart = source.indexOf('function AdvisorySidebarHost(')
  const hostEnd = source.indexOf('/** Keep the two independent Design sidebar', hostStart)
  assert.ok(visibilityStart >= 0 && visibilityEnd > visibilityStart && hostEnd > hostStart)
  let reads = 0, refreshes = 0
  let snapshot = runtime(['running', 'idle', 'failed'])
  let failure
  const context = {
    React, document, AdvisorySidebarEntry, hasVisibleAdvisorySidebarEntry, observeAdvisorySidebarVisibility,
    useState: React.useState, useRef: React.useRef, useLayoutEffect: React.useLayoutEffect, useSyncExternalStore: React.useSyncExternalStore,
    useObservable: () => ({ sessionId: 'fallback-test' }), ABSENT: {},
    runtime: { sessions: { currentProvideInfo: {} } },
    useAdvisoryEntries: () => { reads++; return { entries: advisoryEntries, refresh: async () => { refreshes++ } } },
    advisoryReviewEntries: entries => entries,
    usePanelWorkspace: () => ({ projectId: 'same-project', advisoryRuntime: snapshot }),
    usePanelWorkspaceFailure: () => failure,
  }
  const code = ts.transpileModule(`${source.slice(visibilityStart, visibilityEnd)}\n${source.slice(hostStart, hostEnd)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  const { Entry, visibility } = runInNewContext(`${code}\n({ Entry: AdvisoryComposerEntry, visibility: advisoryInboxVisibility })`, context)
  const sidebar = document.createElement('aside')
  sidebar.innerHTML = '<div data-advisory-entry="sidebar"><button class="dsh-advisory-sidebar-trigger">Sidebar</button></div>'
  const trigger = sidebar.querySelector('button')
  trigger.getBoundingClientRect = () => ({ left: 0, top: 0, right: 36, bottom: 36, width: 36, height: 36 })
  document.body.append(sidebar)
  const root = createRoot(document.getElementById('root'))
  const render = async () => act(async () => root.render(React.createElement(Entry)))
  const settle = async () => act(async () => { await new Promise(resolve => window.requestAnimationFrame(() => resolve())) })
  const fallback = () => document.querySelector('[data-advisory-entry="composer"] button')
  try {
    await render()
    assert.equal(fallback(), null)
    assert.equal(reads, 0, 'visible sidebar adds no projection reader')
    trigger.focus()
    sidebar.hidden = true
    await settle()
    assert.ok(fallback())
    assert.equal(document.activeElement, fallback(), 'keyboard focus follows the hidden sidebar entry into the composer')
    assert.match(fallback().getAttribute('aria-label'), /3 design advisories pending.*Reviewing.*1 failed/)
    assert.equal(fallback().getAttribute('aria-controls'), 'dsh-advisory-composer-inbox')
    await act(async () => fallback().click())
    assert.equal(visibility.isExpanded('fallback-test'), true)
    assert.equal(refreshes, 1)
    assert.equal(fallback().getAttribute('aria-expanded'), 'true')
    fallback().focus()
    sidebar.hidden = false
    await settle()
    assert.equal(fallback(), null, 'restore removes the duplicate actionable entry')
    assert.equal(document.activeElement, trigger, 'keyboard focus follows the restored entry')
    assert.equal(visibility.isExpanded('fallback-test'), true, 'entry switching does not close or reopen review')
    const previousReads = reads
    await render()
    assert.equal(reads, previousReads)
    sidebar.remove()
    await settle()
    assert.ok(fallback(), 'Host unmount is observed')
    assert.equal(fallback().getAttribute('aria-expanded'), 'true')
    failure = new Error('offline')
    await render()
    assert.match(fallback().getAttribute('aria-label'), /Review status disconnected/)
    assert.equal(working(), 0, 'composer does not retain a disconnected spinner')
    failure = undefined
    snapshot = runtime(['idle', 'idle', 'idle'])
    await render()
    assert.doesNotMatch(fallback().getAttribute('aria-label'), /Reviewing|failed/)
    await act(async () => fallback().click())
    assert.equal(visibility.isExpanded('fallback-test'), false)
  } finally {
    await act(async () => root.unmount())
    sidebar.remove()
  }
})
