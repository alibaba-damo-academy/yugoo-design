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
        assert.equal(header.textContent, expected)
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
