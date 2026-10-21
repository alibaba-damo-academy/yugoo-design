#!/usr/bin/env node
/** Real hook regression: independent file reads driven by the existing poll inventory. */
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
const { register } = await import('tsx/esm/api')
register()
const { useTextArtifactContents } = await import('./src/client/panels/artifact-text-hydration.ts')
const { projectArtifactExecution } = await import('./src/client/panels/artifact-status-projection.ts')
const { projectPageDesignPanelState, projectFlowDesignPanelState } = await import('./src/client/panels/artifact-activity-projection.ts')

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const root = createRoot(document.getElementById('root'))
let snapshot
function Harness(props) {
  snapshot = useTextArtifactContents(props.entries, props.read, {}, props.files)
  return null
}
const calls = []
const deferred = new Map()
const read = path => {
  calls.push(path)
  return new Promise(resolve => deferred.set(path, resolve))
}
const a = { id: 'a', path: 'a.html' }
const b = { id: 'b', path: 'b.bpmn' }
const c = { id: 'c', path: 'c.md' }
const render = (entries, files) => act(async () => {
  root.render(React.createElement(Harness, { entries, files, read }))
})
const resolve = (path, content) => act(async () => {
  deferred.get(path)({ found: true, content })
})
try {
  await render([a, b], { 'a.html': 'a1', 'b.bpmn': 'b1' })
  await resolve('a.html', '<html>A</html>')
  assert.deepEqual(snapshot, { a: '<html>A</html>' }, 'A appears while B is still in flight')
  await render([a, b, c], { 'a.html': 'a1', 'b.bpmn': 'b1' })
  assert.equal(snapshot.c, null, 'a known missing file is unavailable, not indefinitely loading')
  assert.equal(calls.filter(path => path === 'b.bpmn').length, 1, 'adding a sibling does not cancel B')
  await resolve('b.bpmn', '<xml>B</xml>')
  assert.equal(snapshot.b, '<xml>B</xml>')
  await render([a, b, c], { 'a.html': 'a1', 'b.bpmn': 'b1', 'c.md': 'c1' })
  await resolve('c.md', '# C')
  assert.equal(snapshot.c, '# C', 'file arrival retries without changing Design JSON')
  await render([a, b, c], { 'a.html': 'a2', 'b.bpmn': 'b1', 'c.md': 'c1' })
  const staleResolve = deferred.get('a.html')
  await render([a, b, c], { 'a.html': 'a3', 'b.bpmn': 'b1', 'c.md': 'c1' })
  await act(async () => staleResolve({ found: true, content: 'stale A2' }))
  assert.equal(snapshot.a, undefined, 'superseded reads cannot overwrite current content')
  await resolve('a.html', '<html>A3</html>')
  assert.equal(snapshot.a, '<html>A3</html>')
  assert.equal(calls.filter(path => path === 'b.bpmn').length, 1, 'unrelated file changes reuse B')
  await render([a, b, c], { 'b.bpmn': 'b1', 'c.md': 'c1' })
  assert.equal(snapshot.a, null, 'deleting a file removes its stale preview')

  const { requestLivePoll } = await import('dsh-design-panel/client-api')
  const realTimeout = globalThis.setTimeout
  const realNow = Date.now
  let online = false
  const reconnectRead = async () => online ? { found: true, content: 'reconnected' } : { found: false, content: '' }
  try {
    // Compress only the retry backoff; use the actual shared poll subscription.
    globalThis.setTimeout = (callback, delay, ...args) => realTimeout(callback, 0, ...args)
    await act(async () => root.render(React.createElement(Harness, { entries: [a], files: { 'a.html': 'unchanged' }, read: reconnectRead })))
    await act(async () => { await new Promise(resolve => realTimeout(resolve, 50)) })
    assert.equal(snapshot.a, null)
    online = true
    Date.now = () => realNow() + 20_000
    await act(async () => {
      requestLivePoll()
      await new Promise(resolve => realTimeout(resolve, 30))
    })
    assert.equal(snapshot.a, 'reconnected', 'a transient outage recovers without a file or JSON change')
  } finally {
    globalThis.setTimeout = realTimeout
    Date.now = realNow
  }
} finally {
  await act(async () => root.unmount())
  dom.window.close()
}

const worker = { invocationId: 'run', artifactId: 'x', artifactKind: 'test_artifact', attemptId: 'worker', role: 'worker', phase: 'working', sequence: 1, runId: 'worker-run' }
const producer = { invocationId: 'run', artifactId: 'bundle', attemptId: 'root', role: 'producer', phase: 'working', sequence: 2 }
const status = (attempts, exists) => projectArtifactExecution('x', attempts, 'test_artifact', exists).status
assert.equal(status([], false), 'pending')
assert.equal(status([], true), 'completed', 'historical files remain usable without attempts')
assert.equal(status([{ ...worker, phase: 'queued' }], false), 'queued')
assert.equal(status([worker], true), 'working', 'landed bytes do not terminate a working executor')
assert.equal(status([{ ...worker, phase: 'completed' }], false), 'failed', 'a missing output cannot be green')
assert.equal(status([{ ...worker, phase: 'completed' }], true), 'completed')
assert.equal(status([{ ...worker, phase: 'failed' }, producer], true), 'failed', 'a busy root and old file cannot disguise failure')
assert.equal(status([worker, { ...worker, attemptId: 'retry', phase: 'completed', sequence: 3 }], true), 'completed', 'new successful retry supersedes old running attempt')
assert.equal(status([{ ...worker, phase: 'failed' }, producer, { ...worker, role: 'producer', attemptId: 'takeover', sequence: 3 }], false), 'working')

for (const [project, state, kind, path, pick] of [
  [projectPageDesignPanelState, { pages: { x: { id: 'x' } } }, 'page_html', 'page_design/pages/x.html', result => result.pages.x],
  [projectFlowDesignPanelState, { processes: { x: { process_id: 'x' } } }, 'flow_bpmn', 'flow_design/x.bpmn', result => result.processes.x],
]) {
  const result = pick(project(state, [{ ...worker, artifactKind: kind, artifactFile: path }], { [path]: 'bytes' }))
  assert.equal(result.generation_status, 'working')
  assert.equal(result.artifact_file ?? result.bpmn_file, path, 'active bound files preview before canonical integration')
}
console.log('ARTIFACT FILE HYDRATION AND EXECUTION STATUS OK')
