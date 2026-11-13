import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installSelectDom } from './select-interaction.mjs'
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
installSelectDom(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderManifest } = await import('../src/interpreter.ts')
const { pathSet } = await import('../src/record-state.ts')
const { parsePanelManifest } = await import('../../core/src/panel-dsl.ts')
const { createPanelComponentExample } = await import('../src/component-examples.ts')
const { ArtifactWorkspace } = await import('../src/artifact-workspace.tsx')
const { PanelRecordHeader, PanelEditableTitle } = await import('../src/panel-workspace.tsx')
after(() => dom.window.close())

function manifestFor(bundle) {
  const base = new URL(`../../skills-web-app/bundles/${bundle}/`, import.meta.url)
  const manifest = parsePanelManifest(readFileSync(new URL('panel.yaml', base), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(['zh-CN', 'en-US'].map(locale => [locale,
    JSON.parse(readFileSync(new URL(`locales/${locale}.json`, base), 'utf8'))]))
  return manifest
}
const click = element => React.act(async () => { assert.ok(element); element.click() })
const input = (element, value) => React.act(async () => {
  assert.ok(element)
  const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
})
const findButton = label => [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label)

test('artifact business IDs preserve round-scoped keys through plan edits, publication, details and reopening', async () => {
  let root = createRoot(document.getElementById('root'))
  const node = manifestFor('research').ui
  const direction = title => ({ direction_id: 'not-the-map-key', title, research_points: ['Preserve this question'], findings_file: null, source_urls: [] })
  let data = { rounds: {
    'R-011': { topic: 'First round', directions: { 'D-005': direction('First direction') }, direction_order: ['D-005'], conclusion_file: null },
    'R-021': { topic: 'Other round', directions: { 'D-005': direction('Other direction') }, direction_order: ['D-005'], conclusion_file: null },
  }, round_order: ['R-011', 'R-021'], current_round_id: 'R-011' }
  const original = structuredClone(data), patches = [], titles = []
  let files = {}
  const readArtifact = async path => ({ found: true, content: `# ${path}` })
  const show = showIds => React.act(async () => root.render(React.createElement(ArtifactWorkspace, {
    node: { ...node, artifacts: { ...node.artifacts, show_ids: showIds } }, data,
    options: { skill: 'research', locale: 'en-US', editable: true, artifactFiles: files, readArtifact,
      onPanelUpdate: patch => { patches.push(patch); for (const [path, value] of Object.entries(patch)) data = pathSet(data, path, value) } },
    render(fields, titleField, value, id, change, part, actions, recordId) {
      if (part !== 'header') return React.createElement('p', null, value.research_points?.join('\n'))
      titles.push({ id, recordId })
      return React.createElement(PanelRecordHeader, { placement: 'workspace', recordId },
        React.createElement(PanelEditableTitle, { value: value[titleField], onChange: event => change(current => ({ ...current, [titleField]: event.target.value })) }), actions)
    },
  })))
  const headerId = () => document.querySelector('[data-panel-title-role="workspace"] .dsh-record-board-id')?.textContent
  try {
    await show()
    assert.equal(headerId(), undefined)
    await show(true)
    assert.equal(headerId(), 'R-011')
    await click(findButton('First direction'))
    assert.equal(headerId(), 'R-011/D-005')
    assert.deepEqual(titles.at(-1), { id: 'R-011/D-005', recordId: 'R-011/D-005' }, 'the editing locator retains parent scope, separate from the visible business number')
    await input(document.querySelector('[data-panel-title="editable"]'), 'Revised first direction')
    await show(true)
    assert.equal(headerId(), 'R-011/D-005')
    assert.equal(data.rounds['R-011'].directions['D-005'].title, 'Revised first direction')
    assert.deepEqual(data.rounds['R-021'], original.rounds['R-021'])
    assert.equal(data.rounds['R-011'].directions['D-005'].direction_id, 'not-the-map-key', 'presentation does not rewrite a saved field')
    const file = 'research/R-011/D-005.md'
    data = pathSet(data, 'rounds', { ...data.rounds, 'R-011': { ...data.rounds['R-011'], directions: {
      ...data.rounds['R-011'].directions, 'D-005': { ...data.rounds['R-011'].directions['D-005'], findings_file: file },
    } } })
    files = { [file]: 'published' }
    await show(true)
    assert.equal(document.querySelector('.dsh-artifact-plan'), null)
    assert.equal(document.querySelector('.dsh-document-toolbar .dsh-record-board-id').textContent, 'R-011/D-005', 'the report uses the same number as the plan')
    assert.equal(document.querySelectorAll('.dsh-record-board-id').length, 1)
    const details = document.querySelector('.dsh-artifact-toolbar-actions button[aria-pressed]')
    await click(details)
    assert.ok(document.querySelector('.dsh-artifact-details'))
    assert.equal(headerId(), 'R-011/D-005')
    await click(details)
    assert.equal(headerId(), 'R-011/D-005')
    await click(findButton('Other round'))
    assert.equal(headerId(), 'R-021')
    await click(findButton('Other direction'))
    assert.equal(headerId(), 'R-021/D-005')
    assert.equal(document.querySelector('[data-panel-title="editable"]').value, 'Other direction')
    assert.deepEqual(titles.at(-1), { id: 'R-021/D-005', recordId: 'R-021/D-005' })
    const afterEdit = structuredClone(data)
    await show(false)
    assert.equal(headerId(), undefined)
    assert.equal(patches.length, 1, 'number display and navigation never emit writes')
    assert.deepEqual(data, afterEdit)
    await React.act(async () => root.unmount())
    root = createRoot(document.getElementById('root'))
    await show(true)
    assert.equal(headerId(), 'R-011')
    await click(findButton('Revised first direction'))
    assert.equal(headerId(), 'R-011/D-005')
    assert.deepEqual(data, afterEdit, 'reopening keeps existing IDs, references and order')
  } finally { await React.act(async () => root.unmount()) }
})

test('failed direction keeps its draft plan and opens real historical activity without reviving rolling progress', async () => {
  const root = createRoot(document.getElementById('root')), manifest = manifestFor('research')
  let data = { rounds: { R: { topic: 'Round', stage: 'confirmed', conclusion_file: null,
    directions: { D: { title: 'Missing material', research_points: ['Keep the requested source; no substitute.'], findings_file: null, source_urls: [] } }, direction_order: ['D'] } }, round_order: ['R'], current_round_id: 'R' }
  const logs = [], historyReads = []
  const readArtifactHistory = async skill => { historyReads.push(skill); return [{ skill, artifactId: 'R/D', artifactKind: 'research_direction',
    artifactFile: 'research/R/failed.md', invocationId: 'old-invocation', runId: 'old-failed-worker', parentRunId: 'main', phase: 'failed', timestamp: 1 }] }
  const readExecutionLog = async (run, after, target) => { logs.push([run, target]); return { found: true, revision: 'old-log', reset: true,
    entries: [{ seq: 1, timestamp: 1, eventType: 'fetch', message: 'Retrieved the exact specified missing URL', url: 'https://example.org/missing' },
      { seq: 2, timestamp: 2, eventType: 'error', message: 'HTTP 400; no report was written.' }] } }
  const show = () => React.act(async () => root.render(renderManifest(manifest, data, { skill: 'research', locale: 'en-US', editable: true,
    artifactFiles: {}, readArtifact: async () => ({ found: false, content: '' }), readArtifactHistory, readExecutionLog,
    onPanelUpdate: patch => { for (const [path, value] of Object.entries(patch)) data = pathSet(data, path, value) } })))
  try {
    await show(); await click(findButton('Missing material'))
    assert.ok(findButton('Details'), 'failed output has the existing Details entry even with null findings')
    assert.deepEqual(logs, [], 'historical status never restarts automatic progress')
    await input(document.querySelector('.dsh-string-list textarea'), 'My unsaved plan\nstays intact')
    await show(); const savedDraft = structuredClone(data)
    await click(findButton('Details'))
    assert.match(document.querySelector('.dsh-artifact-details').textContent, /HTTP 400/)
    assert.equal(document.querySelector('.dsh-artifact-plan'), null, 'Details is read-only')
    assert.equal(logs[0][0], 'old-failed-worker')
    await click(findButton('Plan'))
    assert.match(document.querySelector('.dsh-string-list textarea').value, /My unsaved plan\nstays intact/)
    assert.deepEqual(data, savedDraft)
    assert.equal(historyReads.length, 1, 'ordinary draft rerender does not reload history')
    assert.equal(data.rounds.R.directions.D.findings_file, null, 'failure is not converted to a report')
  } finally { await React.act(async () => root.unmount()) }
})

test('real Research plan edits the selected canonical round/direction, keeping siblings, references and complete list entries', async () => {
  let root = createRoot(document.getElementById('root'))
  const manifest = manifestFor('research')
  const direction = title => ({ direction_id: 'D', title, research_points: ['  first\nsecond  ', 'duplicate', 'duplicate'], findings_file: null, source_urls: ['https://example.com/original'] })
  let data = { schema_version: 3, rounds: {
    first: { round_id: 'first', topic: 'Original scope', stage: 'identified', directions: { D: direction('First direction'), other: direction('Other direction') }, direction_order: ['D', 'other'], conclusion_file: null },
    second: { round_id: 'second', topic: 'Other round', stage: 'confirmed', directions: { D: direction('Same id in another round') }, direction_order: ['D'], conclusion_file: 'research/second/conclusion.html' },
  }, round_order: ['first', 'second'], current_round_id: 'first', provenance: { keep: true } }
  const original = structuredClone(data), patches = []
  const show = (editable = true) => React.act(async () => root.render(renderManifest(manifest, data, {
    skill: 'research', locale: 'en-US', editable, onPanelUpdate: patch => {
      patches.push(patch)
      for (const [path, value] of Object.entries(patch)) data = pathSet(data, path, value)
    },
  })))
  try {
    await show()
    assert.equal(document.querySelector('[data-panel-title="editable"]').value, 'Original scope')
    await input(document.querySelector('[data-panel-title="editable"]'), 'Focused scope')
    await show()
    assert.equal(document.querySelectorAll('[data-panel-title="editable"]').length, 1)
    assert.equal(document.querySelector('[data-testid^="record-remove-"]'), null, 'no invented plan lifecycle')
    await click(findButton('First direction'))
    assert.equal(document.querySelector('.dsh-artifact-plan').hidden, false, 'plan is usable before a report exists')
    assert.deepEqual([...document.querySelectorAll('.dsh-string-list textarea')].map(input => input.value), original.rounds.first.directions.D.research_points)
    await input(document.querySelector('[data-panel-title="editable"]'), 'Focused direction')
    await show()
    await input(document.querySelector('.dsh-string-list textarea'), '  revised\nquestion  ')
    await show()
    await click(document.querySelectorAll('.dsh-string-list-item button[aria-label^="Delete "]')[1])
    await show()
    assert.deepEqual(data.rounds.first.directions.D.research_points, ['  revised\nquestion  ', 'duplicate'])
    await click(document.querySelector('.dsh-string-list > button'))
    await show()
    await input([...document.querySelectorAll('.dsh-string-list textarea')].at(-1), 'Final question')
    await show()
    const edited = structuredClone(data.rounds.first.directions.D)
    await click(findButton('Other direction'))
    await click(findButton('Focused direction'))
    assert.deepEqual([...document.querySelectorAll('.dsh-string-list textarea')].map(input => input.value), edited.research_points)
    assert.deepEqual(data.rounds.second, original.rounds.second, 'round-scoped duplicate ids cannot overwrite another round')
    assert.deepEqual(data.rounds.first.directions.other, original.rounds.first.directions.other)
    assert.deepEqual(data.rounds.first.direction_order, original.rounds.first.direction_order)
    assert.deepEqual(data.round_order, original.round_order)
    assert.equal(data.rounds.first.stage, 'identified')
    assert.equal(data.rounds.first.conclusion_file, null)
    assert.equal(edited.findings_file, null)
    assert.deepEqual(edited.source_urls, original.rounds.first.directions.D.source_urls)
    assert.deepEqual(data.provenance, original.provenance)
    assert.ok(patches.every(patch => Object.keys(patch).join() === 'rounds'), 'only the bound canonical collection is emitted')
    // Exercise the existing host save/reopen boundary as a serialized draft,
    // not a claim of native-agent or disk acceptance.
    data = JSON.parse(JSON.stringify(data))
    await React.act(async () => root.unmount())
    root = createRoot(document.getElementById('root'))
    await show()
    await click(findButton('Focused direction'))
    assert.deepEqual([...document.querySelectorAll('.dsh-string-list textarea')].map(input => input.value), edited.research_points)
    const count = patches.length
    await show(false)
    assert.equal(document.querySelector('input, textarea'), null)
    assert.equal(document.querySelector('.dsh-string-list > button'), null)
    assert.equal(patches.length, count)
  } finally { await React.act(async () => root.unmount()) }
})

test('published artifact details are read-only; conclusions have no details and nested drafts survive publication', async () => {
  const root = createRoot(document.getElementById('root'))
  const example = createPanelComponentExample('artifact_workspace', 'en')
  const manifest = parsePanelManifest(example.panelYaml)
  manifest.ui.artifacts.records_path = 'model.reports'
  manifest.ui.artifacts.children.records_field = 'plan.directions'
  manifest.ui.artifacts.children.points_field = 'points'
  const report = example.sample.reports['R-001']
  let data = { model: { keep: 'untouched', reports: { reading: { ...report, plan: { keep: 'nested context', directions: report.directions } }, other: { title: 'Other report', file: null, plan: { directions: {} } } } } }
  delete data.model.reports.reading.directions
  let files = { [report.file]: 'first' }, fail = false
  let activities = []
  const logRequests = []
  const readExecutionLog = async (runId, _after, target) => {
    logRequests.push({ runId, target })
    return { found: true, revision: 'saved-direction-log', entries: [
      { seq: 1, timestamp: 1, eventType: 'search', message: 'Observed direction search' },
    ] }
  }
  const readArtifact = async path => fail ? Promise.reject(new Error('read failed')) : ({ found: true, content: `<html><body>${path}</body></html>` })
  const show = (editable = true, declared = true) => React.act(async () => root.render(renderManifest(declared ? manifest : {
    ...manifest, ui: { ...manifest.ui, artifacts: { ...manifest.ui.artifacts, fields: undefined, children: { ...manifest.ui.artifacts.children, fields: undefined } } },
  }, data, { skill: 'component_example', locale: 'en-US', editable, artifactFiles: files, readArtifact, artifactActivities: activities, readExecutionLog,
    onPanelUpdate: patch => { for (const [path, value] of Object.entries(patch)) data = pathSet(data, path, value) } })))
  try {
    await show()
    const frame = document.querySelector('iframe')
    assert.ok(frame)
    assert.ok(document.querySelector('.dsh-artifact-content.is-reading'), 'published output uses the shared report surface')
    assert.equal(document.querySelector('[data-panel-title="editable"]'), null, 'a published conclusion is a reader')
    assert.equal(document.querySelector('header header'), null, 'shared header owns the toolbar without a second nested header')
    assert.equal(findButton('Details'), undefined, 'the conclusion has no plan/details toggle')
    assert.equal(document.querySelector('[data-execution-log]'), null)
    assert.deepEqual(logRequests, [], 'a conclusion never reads a direction or parent execution log')
    await click(findButton('Planned organization research'))
    await input(document.querySelector('.dsh-string-list textarea'), 'Keep this draft\nexactly')
    await show()
    data.model.reports.reading.plan.directions['D-002'].file = 'component_example/planned.html'
    files = { ...files, 'component_example/planned.html': 'new', [report.file]: 'new-conclusion' }
    await show()
    assert.equal(document.querySelector('[data-panel-title="editable"]'), null, 'published directions no longer expose the plan editor')
    assert.equal(document.querySelector('.dsh-artifact-plan'), null)
    const plannedFrame = document.querySelector('iframe')
    assert.ok(findButton('Details'), 'published directions expose their read-only details')
    await click(findButton('Details'))
    assert.equal(document.querySelector('.dsh-artifact-output').hidden, true)
    assert.equal(document.querySelector('.dsh-artifact-content.is-reading'), null, 'read-only activity details retain their own surface')
    assert.match(document.querySelector('.dsh-artifact-details').textContent, /Keep this draft\s+exactly/)
    assert.equal(document.querySelector('.dsh-artifact-details input, .dsh-artifact-details textarea'), null)
    assert.match(document.querySelector('.dsh-artifact-details-hint').textContent, /not linked to .*questions/)
    assert.match(document.querySelector('.dsh-artifact-details').textContent, /No activity log is available/, 'missing real logs are reported rather than invented')
    assert.equal(data.model.reports.reading.plan.directions['D-002'].points[0], 'Keep this draft\nexactly')
    activities = [{ executor: 'main', projectId: 'project', skill: 'component_example', invocationId: 'observed-invocation',
      runId: 'existing-native-run', artifactId: 'reading/D-002', artifactKind: 'direction', artifactFile: 'component_example/planned.html',
      active: false, available: true, nativeStatus: 'completed', sequence: 1,
      logTarget: { artifactId: 'reading/D-002', invocationId: 'observed-invocation' } }]
    await show()
    assert.match(document.querySelector('.dsh-artifact-details').textContent, /Observed direction search/)
    assert.deepEqual(logRequests[0], { runId: 'existing-native-run', target: activities[0].logTarget }, 'Details reads the existing scoped direction log without inventing question targets')
    assert.equal(data.model.keep, 'untouched')
    assert.equal(data.model.reports.reading.plan.keep, 'nested context')
    await click(findButton('Content Preview'))
    assert.ok(document.querySelector('.dsh-artifact-content.is-reading'))
    assert.equal(document.querySelector('iframe'), plannedFrame, 'details never recreates the existing iframe')
    fail = true
    await click(findButton('Refresh'))
    assert.equal(document.querySelector('iframe'), plannedFrame)
    assert.match(document.querySelector('.dsh-artifact-preview').textContent, /document is unavailable/)
    await show(false, false)
    assert.equal(document.querySelector('.dsh-artifact-plan'), null, 'undeclared reader keeps its original presentation')
    assert.equal(document.querySelector('[data-panel-title="editable"]'), null)
  } finally { await React.act(async () => root.unmount()) }
})

test('Page list, nested Data options and schema_field share complete string entries without normalization', async () => {
  const root = createRoot(document.getElementById('root'))
  const page = manifestFor('page_design')
  const dataPanel = manifestFor('business_data')
  const list = ['  keep\nnew line  ', 'same', 'same']
  const pageField = page.fields.find(field => field.key === 'key_content')
  const optionsField = dataPanel.fields.find(field => field.key === 'fields').item_fields.find(field => field.key === 'options')
  try {
    for (const field of [pageField, optionsField]) {
      // The real Bundle's field declaration exercises ordinary and nested
      // record bindings; the fixture avoids unrelated canvas operations.
      const nested = field === optionsField
      const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'records', title: 'Records' }],
        fields: [{ ...(nested ? dataPanel.fields.find(field => field.key === 'fields') : field), applies_to: ['records'] }],
        ui: { id: 'form', component: 'record_form', source: 'records' } }
      let data = { records: { item: nested ? { fields: { choice: { id: 'choice', name: 'Choice', value_type: 'single_choice', options: list } }, field_order: ['choice'] } : { key_content: list } } }
      const show = () => React.act(async () => root.render(renderManifest(manifest, data, { locale: 'en-US', editable: true, onPanelUpdate: patch => { data = { ...data, ...patch } } })))
      await show()
      assert.deepEqual([...document.querySelectorAll('.dsh-string-list textarea')].map(input => input.value), list)
      await input(document.querySelector('.dsh-string-list textarea'), '  changed\nentry  ')
      await show()
      assert.deepEqual(nested ? data.records.item.fields.choice.options : data.records.item.key_content, ['  changed\nentry  ', 'same', 'same'])
    }
    const manifest = { version: 1, panel_kind: 'document', sections: [], fields: [], ui: { id: 'list', component: 'schema_field', title: 'Lines', path: 'model.lines', control: 'list' } }
    let data = { model: { lines: list } }
    const show = editable => React.act(async () => root.render(renderManifest(manifest, data, { locale: 'en-US', editable, onPanelUpdate: patch => { for (const [path, value] of Object.entries(patch)) data = pathSet(data, path, value) } })))
    await show(true)
    assert.equal(document.querySelector('.dsh-design-schema-field').tagName, 'DIV', 'a collection is not a label wrapping several controls')
    await click(document.querySelectorAll('.dsh-string-list-item button[aria-label^="Delete "]')[1])
    await show(true)
    assert.deepEqual(data.model.lines, [list[0], 'same'])
    await show(false)
    assert.equal(document.querySelector('textarea'), null)
    assert.deepEqual([...document.querySelectorAll('.dsh-string-list-read li')].map(item => item.textContent), data.model.lines)
  } finally { await React.act(async () => root.unmount()) }
})
