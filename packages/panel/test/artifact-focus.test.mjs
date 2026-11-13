import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { projectArtifactExecution, projectArtifactFile } from '../src/artifact-execution.ts'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { ExecutionTrace, ArtifactWorkspace, artifactGroups } = await import('../src/artifact-workspace.tsx')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
after(() => dom.window.close())

test('Details prefers a current artifact run over a loaded historical run', async () => {
  const root = createRoot(document.getElementById('root')), logs = []
  const node = { id: 'history-current', component: 'artifact_workspace', artifacts: { records_path: 'rounds', title_field: 'title', file_field: 'file', artifact_kind: 'summary',
    children: { records_field: 'directions', title_field: 'title', file_field: 'file', artifact_kind: 'direction', scoped_ids: true } } }
  const data = { rounds: { R: { title: 'Round', directions: { D: { title: 'Direction', file: 'research/R/D.md' } } } } }
  const options = { skill: 'research', artifactFiles: { 'research/R/D.md': 'current-bytes' },
    readArtifact: async () => ({ found: true, content: '# Result' }),
    executionAttempts: [{ skill: 'research', role: 'worker', artifactKind: 'direction', artifactId: 'R/D', artifactFile: 'research/R/D.md',
      invocationId: 'current', attemptId: 'current-attempt', runId: 'current-run', phase: 'completed', sequence: 1 }],
    readArtifactHistory: async () => [{ skill: 'research', artifactId: 'R/D', artifactKind: 'direction', artifactFile: 'research/R/D.md', invocationId: 'old', runId: 'old-run', phase: 'completed', timestamp: 1 }],
    readExecutionLog: async run => { logs.push(run); return { found: true, revision: 'native', reset: true, entries: [{ seq: 1, timestamp: 1, eventType: 'search', message: 'Current search' }] } },
  }
  try {
    await React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(ArtifactWorkspace, { node, data, options }))))
    await React.act(async () => document.querySelector('button[aria-label="Direction"]').click())
    assert.deepEqual(logs, [])
    await React.act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Details').click())
    assert.deepEqual(logs, ['current-run'])
  } finally { await React.act(async () => root.unmount()) }
})
test('serial fallback files remain readable and counted while failed Worker records stay failed', async () => {
  const root = createRoot(document.getElementById('root'))
  const summary = 'research/R/summary.html', first = 'research/R/A.md', second = 'research/R/B.md'
  const node = { id: 'serial-fallback', component: 'artifact_workspace', artifacts: {
    records_path: 'rounds', title_field: 'title', file_field: 'file', artifact_kind: 'round',
    children: { records_field: 'directions', title_field: 'title', file_field: 'file', artifact_kind: 'direction', scoped_ids: true },
  } }
  const data = { rounds: { R: { title: 'Summary', file: summary, directions: {
    A: { title: 'Direction A', file: first }, B: { title: 'Direction B', file: second },
  } } } }
  const before = structuredClone(data)
  const executionAttempts = ['A', 'B'].map((id, sequence) => ({ skill: 'research', role: 'worker',
    artifactKind: 'direction', artifactId: `R/${id}`, artifactFile: `research/R/${id}.md`,
    invocationId: 'native-main', attemptId: `worker-${id}`, runId: `worker-${id}`, phase: 'failed', sequence }))
  try {
    for (const [locale, warning, available] of [
      ['zh-CN', '1/2 个子项产物可用', '产物可阅读；存在执行失败记录'],
      ['en-US', '1/2 child outputs are available', 'Artifact available; a failed execution is recorded'],
    ]) {
      const options = { skill: 'research', executionAttempts, artifactFiles: { [summary]: 'summary', [first]: 'serial-fallback' },
        readArtifact: async path => ({ found: true, content: path.endsWith('.md') ? '# Serial fallback result' : '<html>Summary</html>' }) }
      const groups = artifactGroups(data, node.artifacts, options.skill, executionAttempts, options.artifactFiles)
      assert.equal(groups[0].children[0].fileAvailable, true)
      assert.equal(groups[0].children[1].fileAvailable, false)
      assert.equal(groups[0].children[0].status, 'failed', 'file availability never rewrites the Worker outcome')
      assert.equal(groups[0].children[0].runId, 'worker-A')
      const render = async () => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
        React.createElement(ArtifactWorkspace, { node, data, options }))))
      await render()
      await React.act(async () => document.querySelector('button[aria-label="Summary"]').click())
      assert.match(document.querySelector('.dsh-artifact-warning').textContent, new RegExp(warning))
      await React.act(async () => document.querySelector('button[aria-label="Direction A"]').click())
      assert.equal(document.querySelector('.dsh-document-toolbar [role="status"]').textContent, available)
      assert.equal(document.querySelector('button[aria-label="Direction A"] [data-execution-status]').dataset.executionStatus, 'failed')
      assert.equal(document.querySelector('.dsh-artifact-markdown h1').textContent, 'Serial fallback result')
      options.artifactFiles = { ...options.artifactFiles, [second]: 'second-serial-fallback' }
      await render()
      await React.act(async () => document.querySelector('button[aria-label="Summary"]').click())
      assert.equal(Boolean(document.querySelector('.dsh-artifact-warning')), false, 'both observed files are available despite failed attempts')
    }
    assert.deepEqual(data, before)
    assert.ok(executionAttempts.every(attempt => attempt.phase === 'failed'))
  } finally { await React.act(async () => root.unmount()) }
})
test('top artifact toolbar refresh keeps the same readable document after failure and never retries automatically', async () => {
  const root = createRoot(document.getElementById('root'))
  let fail = false, calls = 0
  const file = 'research/report.md'
  const readArtifact = async path => {
    assert.equal(path, file); calls++
    if (fail) throw Error('synthetic read failure')
    return { found: true, content: calls === 1 ? '# Original source' : '# Updated source' }
  }
  const node = { id: 'reader', component: 'artifact_workspace', artifacts: {
    records_path: 'rounds', title_field: 'title', file_field: 'file', artifact_kind: 'round',
    children: { records_field: 'children', title_field: 'title', file_field: 'file', artifact_kind: 'direction' },
  } }
  const data = { rounds: { one: { title: 'Report', file, children: {} } } }
  try {
    await React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' },
      React.createElement(ArtifactWorkspace, { node, data, options: { skill: 'research', artifactFiles: { [file]: 'source' }, readArtifact } }))))
    assert.equal(document.querySelector('.dsh-artifact-markdown h1').textContent, 'Original source')
    assert.equal(document.querySelector('.dsh-artifact-preview button'), null, 'no intervening refresh row')
    const refresh = document.querySelector('.dsh-document-toolbar button')
    assert.equal(refresh.textContent, 'Refresh')
    fail = true
    await React.act(async () => refresh.click())
    assert.equal(document.querySelector('.dsh-artifact-markdown h1').textContent, 'Original source')
    assert.equal(document.querySelector('.dsh-artifact-preview').getAttribute('aria-busy'), 'false')
    assert.equal(calls, 2, 'a failed refresh does not start retries')
    fail = false
    await React.act(async () => refresh.click())
    assert.equal(calls, 3)
    assert.equal(document.querySelector('.dsh-artifact-markdown h1').textContent, 'Updated source')
  } finally { await React.act(async () => root.unmount()) }
})
const activity = (id, overrides = {}) => ({ artifactId: id, artifactKind: 'direction', artifactFile: `research/${id}.md`,
  skill: 'research', projectId: 'actual-project', invocationId: 'actual-invocation', executor: 'main', runId: 'actual-main',
  sequence: 1, active: true, available: true, nativeStatus: 'running', logTarget: { artifactId: id, invocationId: 'actual-invocation' }, ...overrides })

test('explicit main activity drives shared artifact projection without a Producer attempt or inferred completion', () => {
  const a = activity('R-001/A')
  const project = (activities, exists = false) => projectArtifactExecution(a.artifactId, [], a.artifactKind, exists, 'pending', a.artifactFile, activities)
  assert.equal(project([a]).status, 'working')
  assert.deepEqual(project([a]).logTarget, a.logTarget)
  assert.equal(project([{ ...a, nativeStatus: 'completed' }]).status, 'pending')
  assert.equal(project([{ ...a, nativeStatus: 'unknown' }]).status, 'unknown')
  assert.equal(project([{ ...a, nativeStatus: 'unknown' }], true).status, 'unknown', 'existing bytes cannot conceal unknown native activity')
  assert.equal(project([{ ...a, available: false }]).status, 'unknown')
  for (const nativeStatus of ['idle', 'pending', 'unrecognized']) {
    assert.equal(project([{ ...a, nativeStatus }], true).status, 'unknown', 'unrecognized native phases must not report completion or running')
  }
  assert.equal(project([{ ...a, active: false }]).status, 'pending')
  assert.equal(project([{ ...a, active: false }], true).status, 'completed', 'file availability is an independent fact')
  assert.equal(projectArtifactFile(a.artifactId, [], a.artifactKind, { [a.artifactFile]: 'digest' }, undefined, [a]), a.artifactFile)
  const groups = artifactGroups({ rounds: { 'R-001': { directions: { A: { title: 'A' }, B: { title: 'B' } } } } },
    { records_path: 'rounds', title_field: 'title', file_field: 'file', artifact_kind: 'round',
      children: { records_field: 'directions', title_field: 'title', file_field: 'file', artifact_kind: 'direction', scoped_ids: true } }, 'research', [], {}, [a])
  assert.equal(groups[0].children[0].status, 'working')
  assert.equal(groups[0].children[1].status, 'pending')
  assert.deepEqual(groups[0].children[0].logTarget, a.logTarget)
})

test('changing artifacts in the same native run sends the exact log target and immediately discards old entries', async () => {
  const root = createRoot(document.getElementById('root'))
  const calls = []
  let release
  const read = async (runId, cursor, target) => {
    calls.push({ runId, cursor, target })
    if (target.artifactId === 'B') await new Promise(resolve => { release = resolve })
    return { found: true, revision: 1, reset: true, entries: [{ seq: 1, timestamp: 0, eventType: 'message', message: `log-${target.artifactId}` }] }
  }
  const item = id => ({ id, title: id, points: [], links: [], status: 'working', runId: 'actual-main',
    logTarget: { artifactId: id, invocationId: 'actual-invocation' } })
  try {
    await React.act(async () => root.render(React.createElement(ExecutionTrace, { item: item('A'), read })))
    assert.match(document.body.textContent, /log-A/)
    await React.act(async () => root.render(React.createElement(ExecutionTrace, { item: item('B'), read })))
    assert.doesNotMatch(document.body.textContent, /log-A/)
    assert.deepEqual(calls.at(-1), { runId: 'actual-main', cursor: undefined, target: item('B').logTarget })
    await React.act(async () => release())
    assert.match(document.body.textContent, /log-B/)
  } finally { await React.act(async () => root.unmount()) }
})

test('retained focus never masks current-invocation Worker status or attaches its old main log', () => {
  for (const executor of ['main', 'producer']) {
    const old = activity('R-001/A', { executor, active: false, nativeStatus: 'completed' })
    for (const phase of ['working', 'failed', 'completed']) {
      const worker = { role: 'worker', artifactId: old.artifactId, artifactKind: old.artifactKind,
        artifactFile: old.artifactFile, attemptId: 'actual-worker', runId: 'actual-worker',
        invocationId: 'new-invocation', skill: 'research', sequence: 2, phase }
      const result = projectArtifactExecution(old.artifactId, [worker], old.artifactKind, true, 'pending', old.artifactFile, [old])
      assert.equal(result.status, phase)
      assert.equal(result.runId, worker.runId)
      assert.equal(result.logTarget, undefined, 'the Worker log must not receive an old main artifact locator')
      assert.equal(projectArtifactExecution(old.artifactId, [worker], old.artifactKind, false, 'pending', old.artifactFile, [old]).status,
        phase === 'completed' ? 'failed' : phase, 'existing bytes do not convert a failed Worker to completion')
      const concurrent = { ...old, active: true, nativeStatus: 'running', invocationId: worker.invocationId }
      assert.equal(projectArtifactExecution(old.artifactId, [worker], old.artifactKind, true, 'pending', old.artifactFile, [concurrent]).runId, worker.runId)
      assert.equal(projectArtifactExecution(old.artifactId, [worker], old.artifactKind, true, 'pending', old.artifactFile, [{ ...concurrent, nativeStatus: 'unknown' }]).status, phase)
    }
  }
})

test('real shared artifact consumer shows unknown activity in both locales while keeping existing content readable', async () => {
  const root = createRoot(document.getElementById('root'))
  const file = 'research/R-001/conclusion.html'
  const a = activity('R-001', { artifactKind: 'round', artifactFile: file })
  const node = { id: 'research', component: 'artifact_workspace', artifacts: {
    records_path: 'rounds', title_field: 'title', file_field: 'file', artifact_kind: 'round',
    children: { records_field: 'directions', title_field: 'title', file_field: 'file', artifact_kind: 'direction', scoped_ids: true },
  } }
  const data = { rounds: { 'R-001': { title: 'Actual existing conclusion', file, directions: {} } } }
  const readArtifact = async () => ({ found: true, content: '<html><body>EXISTING-READABLE-CONTENT</body></html>' })
  try {
    for (const [locale, unknownLabel, workingLabel, availableLabel] of [
      ['zh-CN', '执行状态未知', '执行中', '可阅读'],
      ['en-US', 'Execution status unknown', 'Working', 'Available'],
    ]) {
      for (const [nativeStatus, active, available, expected] of [
        ['unknown', true, true, unknownLabel],
        ['idle', true, true, unknownLabel],
        ['pending', true, true, unknownLabel],
        ['running', true, false, unknownLabel],
        ['running', true, true, workingLabel],
        ['unknown', false, true, availableLabel],
      ]) {
        await React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
          React.createElement(ArtifactWorkspace, { node, data, options: { skill: 'research',
            artifactFiles: { [file]: 'observed-digest' }, readArtifact,
            artifactActivities: [{ ...a, nativeStatus, active, available }] } }))))
        const header = document.querySelector('.dsh-document-toolbar [role="status"]')
        // Completed files use the existing navigation icon instead of a
        // redundant toolbar status. Unknown/active states remain explicit.
        if (expected === availableLabel) {
          assert.equal(header, null)
          assert.equal(document.querySelector('[data-execution-status="completed"]').getAttribute('aria-label'), expected)
        } else assert.equal(header.textContent, expected)
        assert.equal(document.querySelector('.dsh-panel-workspace-tree-record-toggle'), null, 'a report without directions has no empty disclosure')
        assert.match(document.querySelector('iframe').srcdoc, /EXISTING-READABLE-CONTENT/)
      }
    }
  } finally { await React.act(async () => root.unmount()) }
})

test('active new main scopes status, file and log to its invocation rather than the last historical Worker', () => {
  const main = activity('R-001/A', { invocationId: 'new-main', artifactFile: 'research/R-002/A.md',
    logTarget: { artifactId: 'R-001/A', invocationId: 'new-main' } })
  const oldWorker = { role: 'worker', artifactId: main.artifactId, artifactKind: main.artifactKind,
    artifactFile: 'research/R-001/A.md', attemptId: 'old-worker', runId: 'old-worker', invocationId: 'old',
    skill: 'research', sequence: 1, phase: 'completed' }
  for (const artifactFile of [undefined, main.artifactFile]) {
    const worker = { ...oldWorker, ...(artifactFile === main.artifactFile ? { artifactFile } : {}) }
    const result = projectArtifactExecution(main.artifactId, [worker], main.artifactKind, true, 'pending', artifactFile, [main])
    assert.equal(result.status, 'working')
    assert.equal(result.runId, main.runId)
    assert.deepEqual(result.logTarget, main.logTarget)
    const files = { [main.artifactFile]: 'new-bytes', [oldWorker.artifactFile]: 'old-bytes' }
    assert.equal(projectArtifactFile(main.artifactId, [worker], main.artifactKind, files, artifactFile, [main]), main.artifactFile)
    assert.equal(projectArtifactFile(main.artifactId, [worker], main.artifactKind, { [oldWorker.artifactFile]: 'old-bytes' }, artifactFile, [main]), undefined,
      'unpublished new main artifact must not reuse an old Worker file')
    const currentWorker = { ...worker, invocationId: main.invocationId, runId: 'current-worker', attemptId: 'current-worker',
      artifactFile: main.artifactFile, phase: 'working', sequence: 2 }
    const current = projectArtifactExecution(main.artifactId, [oldWorker, currentWorker], main.artifactKind, true, 'pending', artifactFile, [main])
    assert.equal(current.runId, currentWorker.runId)
    assert.equal(current.logTarget, undefined)
  }
})

test('artifact navigation restores rightmost native lifecycle icons and does not hide active work behind old content', async () => {
  const root = createRoot(document.getElementById('root'))
  const file = 'research/round.html'
  const node = { id: 'status-parity', component: 'artifact_workspace', artifacts: {
    records_path: 'rounds', title_field: 'title', file_field: 'file', artifact_kind: 'round',
    children: { records_field: 'directions', title_field: 'title', file_field: 'file', artifact_kind: 'direction', scoped_ids: true },
  } }
  const data = { rounds: { R: { title: 'Round', file, directions: { A: { title: 'Direction' } } } } }
  const before = structuredClone(data)
  const worker = { skill: 'research', role: 'worker', attemptId: 'worker', invocationId: 'invocation', runId: 'worker-run',
    artifactKind: 'direction', artifactId: 'R/A', sequence: 2 }
  const producer = { ...worker, role: 'producer', artifactKind: undefined, artifactId: 'research', attemptId: 'producer', runId: 'producer-run', sequence: 1 }
  try {
    for (const phase of ['pending', 'queued', 'working', 'completed', 'failed']) {
      const attempts = phase === 'pending' ? [] : [{ ...producer, phase }, { ...worker, phase }]
      const files = phase === 'completed' ? { [file]: 'round-bytes', 'research/A.md': 'direction-bytes' } : { [file]: 'old-round-bytes' }
      const fixtureData = phase === 'completed' ? { rounds: { R: { ...data.rounds.R, directions: { A: { title: 'Direction', file: 'research/A.md' } } } } } : data
      await React.act(async () => root.render(React.createElement(ArtifactWorkspace, { node, data: fixtureData,
        options: { skill: 'research', executionAttempts: attempts, artifactFiles: files } })))
      const row = document.querySelector('button[aria-label="Direction"]')
      const icon = row.lastElementChild.firstElementChild
      assert.ok(row.lastElementChild.classList.contains('dsh-panel-workspace-tree-trailing'), 'lifecycle marker stays in the shared trailing slot')
      assert.equal(icon.dataset.executionStatus, phase)
      assert.equal(icon.style.width, '12px')
      assert.equal(icon.style.height, '12px')
      assert.equal(row.querySelector('small'), null)
      if (['working', 'queued', 'failed'].includes(phase)) {
        assert.equal(document.querySelector('button[aria-label="Round"] .dsh-panel-workspace-tree-trailing [data-execution-status]').dataset.executionStatus, phase,
          'native Producer status takes precedence even with existing conclusion bytes')
      }
    }
    await React.act(async () => root.render(React.createElement(ArtifactWorkspace, { node, data,
      options: { skill: 'research', artifactFiles: { [file]: 'old-round-bytes' }, artifactActivities: [activity('R/A', { artifactKind: 'direction' })] } })))
    assert.equal(document.querySelector('button[aria-label="Round"] .dsh-panel-workspace-tree-trailing [data-execution-status]').dataset.executionStatus, 'working',
      'active direction remains visible beside an existing conclusion')
    assert.deepEqual(data, before)
  } finally { await React.act(async () => root.unmount()) }
})


test('Producer terminal observations stop an older Worker but do not hide a newer retry when old events arrive late', () => {
  const producer = { role: 'producer', skill: 'test_bundle', invocationId: 'current', attemptId: 'producer', runId: 'producer', sequence: 1, phase: 'working' }
  const worker = { ...producer, role: 'worker', artifactKind: 'document', artifactId: 'item', artifactFile: 'test_bundle/item.html', attemptId: 'worker', runId: 'worker', sequence: 2 }
  const project = attempts => projectArtifactExecution('item', attempts, 'document', true, 'pending', worker.artifactFile)
  assert.equal(project([producer, worker]).status, 'working')
  for (const phase of ['completed', 'failed', 'cancelled']) {
    const terminal = { ...producer, phase, sequence: 3 }
    assert.equal(project([terminal, worker, producer]).status, 'failed', 'a closed Producer cannot keep its older Worker spinner alive')
    const retry = { ...worker, attemptId: 'retry', runId: 'retry-run', sequence: 4, phase: 'queued' }
    const observed = project([retry, terminal, worker, producer])
    assert.equal(observed.status, 'queued')
    assert.equal(observed.runId, 'retry-run', 'an older Producer completion arriving later in the array cannot replace the actual newer retry')
  }
})


test('published Details retains the real scoped search history after runtime progress has ended', async () => {
  const root = createRoot(document.getElementById('root'))
  const file = 'example/round/A.md'
  const node = { id: 'history', component: 'artifact_workspace', artifacts: {
    records_path: 'rounds', title_field: 'title', file_field: 'file', artifact_kind: 'round',
    children: { records_field: 'directions', title_field: 'title', file_field: 'file', artifact_kind: 'direction', scoped_ids: true, points_field: 'questions' },
  } }
  const data = { rounds: { R: { title: 'Round', directions: { A: { title: 'Direction', file, questions: ['Preserved saved question'] } } } } }
  const before = structuredClone(data), calls = []
  const logTarget = { artifactId: 'R/A', invocationId: 'finished-invocation' }
  const options = { skill: 'example', locale: 'en-US', artifactFiles: { [file]: 'saved' },
    artifactActivities: [{ executor: 'main', projectId: 'project', skill: 'example', invocationId: logTarget.invocationId,
      runId: 'finished-run', artifactId: 'R/A', artifactKind: 'direction', artifactFile: file,
      sequence: 1, active: false, available: true, nativeStatus: 'completed', logTarget }],
    readArtifact: async () => ({ found: true, content: '# Saved findings' }),
    readExecutionLog: async (...args) => { calls.push(args); return { found: true, revision: 'saved', reset: true,
      entries: [{ seq: 1, timestamp: 1, eventType: 'search', message: 'Actual saved search', url: 'https://example.com/source' }] } },
  }
  try {
    await React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(ArtifactWorkspace, { node, data, options }))))
    await React.act(async () => document.querySelector('button[aria-label="Direction"]').click())
    assert.equal(calls.length, 0, 'reading the saved artifact does not mount a permanent trace')
    const details = [...document.querySelectorAll('button')].find(button => button.textContent === 'Details')
    await React.act(async () => details.click())
    const region = document.querySelector('.dsh-artifact-details')
    assert.match(region.textContent, /Preserved saved question/)
    assert.match(region.textContent, /Actual saved search/)
    assert.ok(region.querySelector('.dsh-execution-activity'), 'the explicit Details history keeps its reader after completion')
    assert.deepEqual(calls[0], ['finished-run', undefined, logTarget])
    assert.deepEqual(data, before)
  } finally { await React.act(async () => root.unmount()) }
})


test('ordinary artifact parent and child use real runtime logs, centered without output and beside landed reports', async () => {
  const root = createRoot(document.getElementById('root')), file = 'example/R/A.md', calls = []
  const node = { id: 'runtime-artifact', component: 'artifact_workspace', artifacts: {
    records_path: 'rounds', title_field: 'title', file_field: 'file', artifact_kind: 'round',
    children: { records_field: 'directions', title_field: 'title', file_field: 'file', artifact_kind: 'direction', scoped_ids: true },
  } }
  const data = { rounds: { R: { title: 'Round', directions: { A: { title: 'Direction', file: null } } } } }, before = structuredClone(data)
  const producer = { skill: 'example', role: 'producer', invocationId: 'actual', artifactId: 'example', attemptId: 'producer', runId: 'producer-run', phase: 'working', sequence: 1 }
  const worker = { ...producer, role: 'worker', artifactId: 'R/A', artifactKind: 'direction', artifactFile: file, attemptId: 'worker', runId: 'worker-run', phase: 'queued', sequence: 2 }
  let executionAttempts = [producer, worker], artifactFiles = {}
  const readArtifact = async () => ({ found: true, content: '# LANDED-REPORT-CONTENT' })
  const readExecutionLog = async runId => { calls.push(runId); return { found: true, reset: true, revision: runId, entries: [{ seq: 1, timestamp: 1, eventType: 'message', message: `actual-${runId}` }] } }
  const show = () => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' },
    React.createElement(ArtifactWorkspace, { node, data, options: { skill: 'example', artifactFiles, executionAttempts, readArtifact, readExecutionLog } }))))
  try {
    await show()
    assert.match(document.querySelector('.dsh-artifact-placeholder').textContent, /actual-producer-run/, 'a parent binds the real active Producer, never the main conversation')
    await React.act(async () => document.querySelector('button[aria-label="Direction"]').click())
    const placeholder = document.querySelector('.dsh-artifact-output .dsh-artifact-placeholder')
    assert.ok(placeholder?.querySelector('[data-content-state]'))
    assert.match(placeholder.textContent, /actual-worker-run/, 'the selected child uses its exact queued Worker')
    assert.equal(calls.at(-1), worker.runId)
    artifactFiles = { [file]: 'landed' }
    executionAttempts = [producer, { ...worker, phase: 'working', sequence: 3 }]
    await show()
    const report = document.querySelector('.dsh-artifact-markdown')
    assert.match(report.textContent, /LANDED-REPORT-CONTENT/)
    assert.ok(document.querySelector('.dsh-artifact-preview > [data-execution-log]'), 'progress is beside readable content, not overlaid on it')
    for (const phase of ['completed', 'failed', 'cancelled']) {
      executionAttempts = [{ ...producer, phase, sequence: 5 }, { ...worker, phase, sequence: 4 }]
      await show()
      assert.equal(document.querySelector('.dsh-artifact-output [data-execution-log]') === null, true, `${phase} clears the ordinary runtime region`)
      assert.equal(document.querySelector('.dsh-artifact-markdown'), report, 'settling retains the readable report')
    }
    assert.deepEqual(data, before, 'runtime logs and landed file projection do not write canonical data')
  } finally { await React.act(async () => root.unmount()) }
})
