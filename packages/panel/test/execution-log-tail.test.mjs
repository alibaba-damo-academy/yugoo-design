/** React/DOM lifecycle test with controlled scroll dimensions; no browser-layout claim. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { ExecutionRollingLog } = await import('../src/client/execution-rolling-log.tsx')
const { renderNode } = await import('../src/interpreter.ts')
const { requestLivePoll, livePollSubscriberCount } = await import('../src/client/live-poll.ts')
after(() => dom.window.close())

test('rolling log follows the tail, preserves manual scroll, bounds cursor deltas and folds only on lifecycle changes', async () => {
  const root = createRoot(document.getElementById('root'))
  let sequence = 1
  const read = async (_run, afterSeq) => ({ found: true, reset: afterSeq === undefined, revision: String(sequence),
    entries: [{ seq: sequence, timestamp: sequence, eventType: 'message', message: `row-${sequence}`, url: 'javascript:should-never-be-a-link()' }] })
  const render = async (active, artifactId = 'A') => React.act(async () => root.render(React.createElement(ExecutionRollingLog, {
    runId: 'shared-main', logTarget: { artifactId, invocationId: 'actual-invocation' }, active,
    presentation: 'conversation', maxEntries: 2, readExecutionLog: read,
  })))
  const poll = async () => React.act(async () => { requestLivePoll(); await new Promise(resolve => setTimeout(resolve, 25)) })
  try {
    await render(true)
    assert.equal(document.querySelector('a'), null, 'the shared reader retains the artifact trace HTTP-only URL boundary')
    const scroll = document.querySelector('[data-execution-log] > div')
    let height = 80
    Object.defineProperties(scroll, { scrollHeight: { get: () => height }, clientHeight: { get: () => 20 } })
    sequence++
    await poll()
    assert.equal(scroll.scrollTop, height, 'at the bottom, new rows follow the tail')
    await React.act(async () => { scroll.scrollTop = 5; scroll.dispatchEvent(new window.Event('scroll', { bubbles: true })) })
    height = 160; sequence++
    await poll()
    assert.equal(scroll.scrollTop, 5, 'new rows do not drag a reader away from an earlier entry')
    assert.deepEqual([...document.querySelectorAll('.dsh-execution-log-markdown')].map(row => row.textContent), ['row-2', 'row-3'])
    await React.act(async () => { scroll.scrollTop = height - 20; scroll.dispatchEvent(new window.Event('scroll', { bubbles: true })) })
    height = 200; sequence++
    await poll()
    assert.equal(scroll.scrollTop, height, 'returning to the bottom resumes follow')

    await React.act(async () => document.querySelector('button').click())
    sequence++; await poll()
    assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'false', 'manual collapse survives stable activity')
    await render(true, 'B')
    assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'true', 'new active artifact opens its own log')
    assert.doesNotMatch(document.body.textContent, /row-3|row-4/)
    await render(false, 'B')
    assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'false', 'terminal activity folds once')
    await React.act(async () => document.querySelector('button').click())
    await render(false, 'B')
    assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'true', 'historical logs remain manually readable')
  } finally {
    await React.act(async () => root.unmount())
    assert.equal(livePollSubscriberCount(), 0)
  }
})

test('authored execution_log renderer uses the owning Bundle activity and unavailable state without writes', async () => {
  const root = createRoot(document.getElementById('root'))
  const config = { id: 'progress', component: 'execution_log', log: { scope: 'artifact', artifact_id: 'round/A' } }
  const activity = { skill: 'example', artifactId: 'round/A', artifactKind: 'direction', artifactFile: 'example/A.md',
    invocationId: 'actual-main', runId: 'actual-session', executor: 'main', sequence: 1, active: true, available: true, nativeStatus: 'running',
    logTarget: { artifactId: 'round/A', invocationId: 'actual-main' } }
  const calls = []
  const data = { retained_fact: 'untouched' }
  const readExecutionLog = async (...args) => {
    calls.push(args)
    return { found: true, reset: true, revision: '1', entries: [{ seq: 1, timestamp: 1, eventType: 'message', message: 'authored-actual-read' }] }
  }
  try {
    await React.act(async () => root.render(renderNode(config, {}, data, { skill: 'example', artifactActivities: [activity], readExecutionLog })))
    assert.match(document.body.textContent, /authored-actual-read/)
    assert.deepEqual(calls[0], ['actual-session', undefined, activity.logTarget])
    await React.act(async () => root.render(renderNode(config, {}, data, { skill: 'other', artifactActivities: [activity], readExecutionLog })))
    assert.doesNotMatch(document.body.textContent, /authored-actual-read/)
    assert.match(document.querySelector('[role=status]').textContent, /不可用/)
    assert.deepEqual(data, { retained_fact: 'untouched' })
  } finally { await React.act(async () => root.unmount()) }
})
