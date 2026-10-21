/** Source contract and mounted React checks; no Host, model, save or job execution. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseClarityView, equalClarityViews } from '../src/client/clarity.ts'
import { equalWorkspaceEmission } from '../src/client/types.ts'
import { ClarityDockReadout, CLARITY_DOCK_CSS } from '../src/client/clarity-dock.tsx'
import { DesignDockMeta } from '../src/client/dock-action-meta.tsx'
import { bindDesignHostLocale } from '../src/client/ported/host.ts'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'en-US' } })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const assessment = { kit: 'fixture', version: '1.0', u: 80, s: 60, t: 40 }
const explanation = { summary: 'Saved assessment', u: 'Intent evidence', s: 'Structure evidence',
  t: 'Observable checks', assessedCheckpoint: 'old-checkpoint' }
const phases = ['queued', 'running', 'failed', 'stale', 'unavailable']
const labels = ['Saved · awaiting assessment', 'Assessing', 'Assessment failed', 'Assessment out of date', 'Assessment unavailable']
const view = (activity, oldAssessment = null) => ({ assessment: oldAssessment, needsReassessment: oldAssessment !== null,
  ...(oldAssessment ? { explanation } : {}), ...(activity ? { activity } : {}) })
const activity = phase => ({ phase, checkpoint: 'saved-checkpoint', summary: 'A bounded diagnostic, not a new score.' })
const indicator = () => document.querySelector('[data-testid="design-clarity-dock-activity"]')
const mount = () => createRoot(document.getElementById('root'))
after(() => dom.window.close())

test('strict activity projection accepts each known phase with or without saved scores', () => {
  for (const phase of phases) {
    for (const saved of [null, assessment]) {
      const input = view(activity(phase), saved)
      assert.deepEqual(parseClarityView(input), input)
      assert.deepEqual(input.activity, activity(phase), 'parsing does not rewrite observed inputs')
    }
  }
  assert.deepEqual(parseClarityView(view({ phase: 'queued', checkpoint: 'c' })), view({ phase: 'queued', checkpoint: 'c' }))
})

test('foreign and malformed activity is rejected, retaining pre-existing negative wire guards', () => {
  const invalid = [null, [], 'running', {}, { phase: 'done', checkpoint: 'c' },
    { phase: 'running' }, { phase: 'running', checkpoint: '' }, { phase: 'running', checkpoint: '  ' },
    { phase: 'running', checkpoint: 3 }, { phase: 'running', checkpoint: 'c', summary: 1 },
    { phase: 'running', checkpoint: 'c', percent: 20 }, Object.create({ phase: 'running', checkpoint: 'c' })]
  for (const value of invalid) assert.equal(parseClarityView({ ...view(), activity: value }), undefined)
  assert.equal(parseClarityView({ assessment: null, needsReassessment: true, activity: activity('running') }), undefined)
  assert.equal(parseClarityView({ assessment: null, needsReassessment: false, explanation, activity: activity('queued') }), undefined)
  assert.equal(parseClarityView(assessment), undefined)
  assert.equal(parseClarityView({ ...view(activity('running')), extra: true }), undefined)
  assert.equal(parseClarityView({ ...view(activity('running'), assessment), assessment: { ...assessment, u: 101 } }), undefined)
  assert.equal(parseClarityView({ ...view(activity('running'), assessment), assessment: { ...assessment, extra: true } }), undefined)
})

test('activity-only phase, target, detail, arrival and removal changes survive both poll dedupe boundaries', () => {
  const baseline = view(activity('queued'))
  const snapshot = { projectId: 'project', projectName: 'Demo', projectPath: '/isolated/project', checkpoint: 'c',
    worktreeRevision: 'tree', access: { mode: 'unconfigured', writable: false }, executionRevision: 0,
    journalRevision: 3, design: {}, continuations: [], mustEditHandoffs: [], clarity: baseline }
  assert.equal(equalClarityViews(baseline, structuredClone(baseline)), true)
  assert.equal(equalWorkspaceEmission(snapshot, structuredClone(snapshot)), true)
  const changes = [view(), view({ ...baseline.activity, phase: 'running' }),
    view({ ...baseline.activity, checkpoint: 'new-target' }), view({ ...baseline.activity, summary: 'New detail' }),
    view({ phase: 'queued', checkpoint: baseline.activity.checkpoint })]
  for (const changed of changes) {
    assert.equal(equalClarityViews(baseline, changed), false)
    assert.equal(equalClarityViews(changed, baseline), false)
    assert.equal(equalWorkspaceEmission(snapshot, { ...snapshot, clarity: changed }), false)
  }
  assert.equal(equalClarityViews(view(), structuredClone(view())), true)
  assert.equal(equalClarityViews(view(activity('running'), assessment), view(activity('queued'), assessment)), false)
})

test('each unassessed activity renders a real named status, never a fabricated score or progress percentage', async () => {
  const root = mount()
  try {
    for (const [index, phase] of phases.entries()) {
      await act(async () => root.render(React.createElement(ClarityDockReadout, { value: view(activity(phase)), singleLine: true })))
      assert.equal(indicator().dataset.phase, phase)
      assert.equal(indicator().querySelector('.dsh-clarity-dock-activity-label').textContent, labels[index])
      assert.equal(indicator().querySelector('[aria-live="polite"]').getAttribute('aria-atomic'), 'true')
      assert.equal(document.querySelector('[data-testid="design-clarity-dock-score"]'), null)
      assert.equal(document.querySelector('[role="progressbar"], [aria-valuenow]'), null)
      assert.equal(document.querySelector('[data-testid="design-clarity-dock-unassessed"]'), null)
      assert.equal(document.querySelector('.animate-spin') !== null, phase === 'running')
      assert.equal(document.querySelector('button, a, input'), null, 'activity display cannot execute or retry work')
    }
  } finally { await act(async () => root.unmount()) }
})

test('previous scores remain explicit and unchanged, in the original two-line project header', async () => {
  const root = mount()
  try {
    for (const phase of phases) {
      await act(async () => root.render(React.createElement(DesignDockMeta, {
        clarity: view(activity(phase), assessment), projectName: 'Fixture project', projectPath: '/isolated/fixture',
      })))
      const meta = document.querySelector('[data-testid="design-dock-meta"]')
      assert.equal(meta.children.length, 2, 'no third row is added to the project header')
      assert.equal(meta.children[0].dataset.singleLine, 'true')
      assert.equal(meta.children[0].querySelector('.dsh-clarity-dock-label').textContent, 'Previous')
      assert.equal(meta.children[0].querySelector('.dsh-clarity-dock-label').getAttribute('aria-label'), 'Previous assessment')
      assert.equal(meta.querySelector('[data-testid="design-clarity-dock-score"]').textContent, '64')
      for (const [key, score] of [['u', 80], ['s', 60], ['t', 40]]) {
        const dimension = meta.querySelector(`[data-testid="design-clarity-dock-${key}"]`)
        assert.equal(dimension.getAttribute('aria-valuenow'), String(score))
        assert.match(dimension.getAttribute('aria-label'), /^Previous assessment · /)
      }
      assert.equal(meta.querySelector('[data-testid="design-clarity-dock-stale"]'), null, 'one current activity label, not duplicate badges')
      assert.equal(meta.children[1].querySelector('[data-testid="design-dock-meta-name"]').textContent, 'Design project: Fixture project')
      assert.doesNotMatch(meta.textContent, /\/isolated\/fixture/, 'the native folder path does not become another metadata line')
    }
  } finally { await act(async () => root.unmount()) }
})

test('activity details are keyboard accessible, escaped, viewport bounded and dismissible without a job action', async () => {
  const root = mount(), detail = '<script>diagnostic</script>' + ' Long detail.'.repeat(300)
  try {
    await act(async () => root.render(React.createElement(ClarityDockReadout, {
      value: view({ ...activity('failed'), summary: detail }), singleLine: true,
    })))
    assert.equal(document.querySelector('[role="tooltip"]'), null)
    assert.equal(indicator().textContent, '×Assessment failed', 'engineering detail is not primary status copy')
    indicator().getBoundingClientRect = () => ({ left: 1000, top: 20, bottom: 40 })
    await act(async () => indicator().focus())
    const tooltip = document.querySelector('[role="tooltip"]')
    assert.ok(tooltip.textContent.includes(detail), 'full observed detail remains available on demand')
    assert.ok(tooltip.textContent.includes('Your saved design is unchanged'))
    assert.equal(document.querySelector('script'), null)
    assert.equal(indicator().getAttribute('aria-describedby'), tooltip.id)
    assert.ok(parseFloat(tooltip.style.left) + 360 <= window.innerWidth - 12)
    await act(async () => tooltip.focus())
    await act(async () => tooltip.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(document.querySelector('[role="tooltip"]'), null)
    assert.equal(document.activeElement, indicator())
  } finally { await act(async () => root.unmount()) }
})

test('locale and real lifecycle updates preserve mounted project state and remove obsolete detail', async () => {
  const root = mount(), listeners = new Set()
  let language = 'zh-CN'
  const unbind = bindDesignHostLocale({ getSnapshot: () => ({ active: language }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } })
  try {
    const render = phase => act(async () => root.render(React.createElement(DesignDockMeta, {
      clarity: view(phase ? activity(phase) : undefined, assessment), projectName: '同一个项目', projectPath: '/isolated/project',
    })))
    await render('queued')
    assert.match(indicator().textContent, /已保存，待评估/)
    assert.equal(document.querySelector('.dsh-clarity-dock-label').textContent, '上次评估')
    await act(async () => indicator().focus())
    assert.ok(document.querySelector('[role="tooltip"]'))
    await render('running')
    assert.equal(document.querySelector('[role="tooltip"]'), null, 'late detail is dismissed on a new observed phase')
    assert.match(indicator().textContent, /评估中/)
    await act(async () => { language = 'en-US'; for (const notify of listeners) notify() })
    assert.equal(indicator().querySelector('.dsh-clarity-dock-activity-label[role="status"]').textContent, 'Assessing')
    assert.equal(document.querySelector('[data-testid="design-dock-meta-name"]').textContent, 'Design project: 同一个项目')
    await render(undefined)
    assert.equal(indicator(), null)
    assert.equal(document.querySelector('.dsh-clarity-dock-label').textContent, 'Design completion')
    assert.equal(document.querySelector('[data-testid="design-clarity-dock-score"]').textContent, '64')
    assert.equal(document.querySelector('[data-testid="design-clarity-dock-stale"]').textContent, 'Needs reassessment',
      'activity removal does not silently clear the Host currentness flag')
  } finally { await act(async () => root.unmount()); unbind() }
})

test('existing absent, unassessed and rejected render branches remain distinct; reduced motion is scoped to activity', async () => {
  const root = mount()
  try {
    for (const value of [undefined, null, { ...view(activity('running')), foreign: true }]) {
      await act(async () => root.render(React.createElement(ClarityDockReadout, { value })))
      assert.equal(document.getElementById('root').innerHTML, '')
    }
    await act(async () => root.render(React.createElement(ClarityDockReadout, { value: view() })))
    assert.equal(document.querySelector('[data-testid="design-clarity-dock-unassessed"]').textContent, 'Not assessed yet')
    assert.match(CLARITY_DOCK_CSS, /prefers-reduced-motion: reduce[^}]+\.dsh-clarity-dock-activity \.animate-spin \{ animation: none;/)
    assert.match(CLARITY_DOCK_CSS, /\.dsh-clarity-dock-activity[^}]+font-size: 12px;/)
    assert.match(CLARITY_DOCK_CSS, /\.dsh-clarity-dock\[data-single-line=true\]\{flex-wrap:nowrap\}/)
  } finally { await act(async () => root.unmount()) }
})
