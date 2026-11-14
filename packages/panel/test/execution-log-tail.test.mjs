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

test('system log labels change language immediately while native messages stay exact', async () => {
  const root = createRoot(document.getElementById('root'))
  let reads = 0
  const snapshot = { found: true, reset: true, revision: 'same-recorded-revision', entries: [
    { seq: 1, timestamp: 1, eventType: 'synthesize', message: '修改文件 · 已完成',
      messageText: { zh: '修改文件 · 已完成', en: 'Edit files · Completed' } },
    { seq: 2, timestamp: 2, eventType: 'message', message: '原始消息：修改文件，已完成。',
      messageText: { zh: '不应显示', en: 'Must not replace native text' } },
    { seq: 3, timestamp: 3, eventType: 'synthesize', message: '原始工具文字：已完成' },
  ] }
  const original = JSON.stringify(snapshot)
  const readExecutionLog = async () => { reads++; return snapshot }
  const show = (locale, presentation = 'panel') => React.act(async () => root.render(React.createElement(ExecutionRollingLog, {
    runId: 'bilingual', active: true, presentation, readExecutionLog, locale,
  })))
  try {
    await show('en')
    assert.match(document.body.textContent, /Edit files · Completed/)
    assert.match(document.body.textContent, /原始消息：修改文件，已完成。/)
    assert.match(document.body.textContent, /原始工具文字：已完成/)
    assert.doesNotMatch(document.body.textContent, /Must not replace native text|修改文件 · 已完成/)
    const initialReads = reads
    await show('zh')
    assert.match(document.body.textContent, /修改文件 · 已完成/)
    await show('en', 'conversation')
    assert.match(document.body.textContent, /Edit files · Completed/)
    assert.equal(reads, initialReads, 'locale switches reuse the exact cached log')
    assert.equal(JSON.stringify(snapshot), original)
  } finally { await React.act(async () => root.unmount()) }
})

test('rolling log follows the tail, preserves manual scroll, bounds cursor deltas and folds only on lifecycle changes', async () => {
  const root = createRoot(document.getElementById('root'))
  let sequence = 1
  const read = async (_run, afterSeq) => ({ found: true, reset: afterSeq === undefined, revision: String(sequence),
    entries: [{ seq: sequence, timestamp: sequence, eventType: 'message', message: `row-${sequence}`, url: 'javascript:should-never-be-a-link()' }] })
  const render = async (active, artifactId = 'A', retainHistory = false) => React.act(async () => root.render(React.createElement(ExecutionRollingLog, {
    runId: 'shared-main', logTarget: { artifactId, invocationId: 'actual-invocation' }, active, retainHistory,
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
    assert.equal(document.querySelector('[data-execution-log]') === null, true, 'terminal activity removes its runtime log, including the collapsed header')
    assert.equal(livePollSubscriberCount(), 0, 'a settled runtime log releases polling')
    await render(false, 'B', true)
    assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'false', 'an explicitly retained history starts folded')
    await React.act(async () => document.querySelector('button').click())
    await render(false, 'B', true)
    assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'true', 'explicit historical logs remain manually readable')
  } finally {
    await React.act(async () => root.unmount())
    assert.equal(livePollSubscriberCount(), 0)
  }
})

test('historical panel reading starts at the first activity while live activity still follows its tail', async () => {
  const root = createRoot(document.getElementById('root'))
  const original = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollHeight')
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() {
    return this.classList.contains('dsh-execution-activity-entries') ? 2000 : original?.get?.call(this) ?? 0
  } })
  let sequence = 1
  const readExecutionLog = async () => ({ found: true, reset: true, revision: String(sequence),
    entries: [{ seq: sequence, timestamp: 1, eventType: 'search', message: 'Observed search' }] })
  const show = (active, runId = 'original-run') => React.act(async () => root.render(React.createElement(ExecutionRollingLog, {
    runId, active, retainHistory: true, presentation: 'panel', readExecutionLog,
  })))
  try {
    await show(false)
    assert.equal(document.querySelector('.dsh-execution-activity-entries').scrollTop, 0, 'history opens at the search, not the closing receipt')
    sequence++
    await show(true)
    assert.equal(document.querySelector('.dsh-execution-activity-entries').scrollTop, 2000, 'active progress keeps following new activity')
    sequence++
    await show(false)
    assert.equal(document.querySelector('.dsh-execution-activity-entries').scrollTop, 2000, 'settling does not jump away from the current reading position')
    await show(false, 'another-history')
    assert.equal(document.querySelector('.dsh-execution-activity-entries').scrollTop, 0, 'a different historical task opens at its own beginning')
  } finally {
    await React.act(async () => root.unmount())
    if (original) Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', original)
    else delete window.HTMLElement.prototype.scrollHeight
  }
})

test('panel and conversation logs expose real HTTP source links while rejecting executable and local URLs', async () => {
  const urls = ['https://example.com/source?q=observed', 'http://example.org/evidence',
    'javascript:should-never-be-a-link()', 'data:text/html,unsafe', 'file:///private/transcript',
    '//example.com/protocol-relative', '/relative/source', 'mailto:private@example.com']
  const logTarget = { artifactId: 'round/direction', invocationId: 'actual-invocation' }
  for (const presentation of ['panel', 'conversation']) {
    const root = createRoot(document.getElementById('root'))
    const calls = []
    const readExecutionLog = async (...args) => {
      calls.push(args)
      return { found: true, reset: true, revision: 'source-links', entries: urls.map((url, index) => ({
        seq: index + 1, timestamp: index + 1, eventType: 'fetch', message: `Observed source ${index + 1}`, url,
      })) }
    }
    try {
      await React.act(async () => root.render(React.createElement(ExecutionRollingLog, {
        runId: 'actual-session', logTarget, active: true, locale: 'en', presentation, readExecutionLog,
      })))
      assert.deepEqual(calls[0], ['actual-session', undefined, logTarget], 'links do not change the owning artifact log target')
      const links = [...document.querySelectorAll('a')]
      assert.deepEqual(links.map(link => link.getAttribute('href')), urls.slice(0, 2), `${presentation} keeps the HTTP-only link boundary`)
      for (const link of links) {
        assert.equal(link.target, '_blank')
        assert.equal(link.rel, 'noopener noreferrer')
        assert.equal(link.getAttribute('aria-label'), 'Open link')
      }
      assert.match(document.body.textContent, /Observed source 8/, 'an unsafe URL does not hide the activity text')
    } finally {
      await React.act(async () => root.unmount())
      assert.equal(livePollSubscriberCount(), 0)
    }
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


test('settled runtime logs release polling and ignore a pending read, while a new active run still works', async () => {
  const root = createRoot(document.getElementById('root'))
  let resolveOld
  const calls = []
  const readExecutionLog = async run => {
    calls.push(run)
    if (run === 'old-run') return new Promise(resolve => { resolveOld = resolve })
    return { found: true, reset: true, revision: run, entries: [{ seq: 1, timestamp: 1, eventType: 'message', message: run }] }
  }
  const show = (active, runId = 'old-run') => React.act(async () => root.render(React.createElement(ExecutionRollingLog, {
    runId, active, readExecutionLog, presentation: 'conversation', locale: 'en',
  })))
  try {
    await show(true)
    assert.ok(resolveOld)
    assert.ok(livePollSubscriberCount() > 0)
    await show(false)
    assert.equal(document.querySelector('[data-execution-log]') === null, true)
    assert.equal(livePollSubscriberCount(), 0)
    await show(true, 'new-run')
    await React.act(async () => resolveOld({ found: true, reset: true, revision: 'late', entries: [{ seq: 1, eventType: 'message', message: 'late-old-row' }] }))
    assert.match(document.body.textContent, /new-run/)
    assert.doesNotMatch(document.body.textContent, /late-old-row/)
    await show(false, 'new-run')
    const before = calls.length
    await React.act(async () => { requestLivePoll(); await new Promise(resolve => setTimeout(resolve, 25)) })
    assert.equal(calls.length, before, 'completion must not keep polling for a terminal transcript')
    assert.equal(document.body.textContent, '')
  } finally { await React.act(async () => root.unmount()) }
})


for (const presentation of ['panel', 'conversation']) test(`${presentation} history relabels loaded system activity when locale changes, preserving prose and reading state`, async () => {
  const root = createRoot(document.getElementById('root'))
  const prose = '搜索：这是实际 Worker 正文，do not translate it.'
  const items = [
    ['search', '搜索：用户反馈 {detail}', { kind: 'search', detail: '用户反馈 {detail}' }, 'Search: 用户反馈 {detail}'],
    ['fetch', '读取：https://example.com/source', { kind: 'fetch', detail: 'https://example.com/source' }, 'Read: https://example.com/source'],
    ['synthesize', '读取文件：reference/artifact-contract.md', { kind: 'read-file', detail: 'reference/artifact-contract.md' }, 'Read file: reference/artifact-contract.md'],
    ['synthesize', '写入文件：design_files/反馈.json', { kind: 'write-file', detail: 'design_files/反馈.json' }, 'Write file: design_files/反馈.json'],
    ['synthesize', '运行脚本：scripts/check.mjs', { kind: 'run-script', detail: 'scripts/check.mjs' }, 'Run script: scripts/check.mjs'],
    ['synthesize', '整理并校验结果', { kind: 'structured-output', detail: '' }, 'Organize and validate results'],
    ['synthesize', '运行：design_worker_read_artifact', { kind: 'run-tool', detail: 'design_worker_read_artifact' }, 'Run: design_worker_read_artifact'],
    ['error', 'read_file · failed (E_READ)', { kind: 'tool-failed', detail: 'read_file (E_READ)' }, 'Failed: read_file (E_READ)'],
    ['synthesize', '搜索：legacy or Companion tool text', undefined, '搜索：legacy or Companion tool text'],
    ['synthesize', 'Unknown native activity', { kind: 'future-activity', detail: 'do not guess' }, 'Unknown native activity'],
    ['message', prose, undefined, prose],
  ]
  const snapshot = { found: true, reset: true, revision: 'historical-run:11', entries: items.map(([eventType, message, activity], index) => ({
    seq: index + 1, timestamp: index + 1, eventType, message, ...(activity ? { activity } : {}),
  })) }
  const original = JSON.stringify(snapshot)
  let reads = 0
  const readExecutionLog = async () => { reads++; return snapshot }
  const show = locale => React.act(async () => root.render(React.createElement(ExecutionRollingLog, {
    runId: 'settled-original-run', active: false, retainHistory: true, presentation, locale, readExecutionLog,
  })))
  try {
    await show('zh')
    if (presentation === 'conversation') await React.act(async () => document.querySelector('button').click())
    const scroll = presentation === 'panel' ? document.querySelector('.dsh-execution-activity-entries') : document.querySelector('[data-execution-log] > div')
    await React.act(async () => { scroll.scrollTop = 37; scroll.dispatchEvent(new window.Event('scroll', { bubbles: true })) })
    const beforeReads = reads
    await show('en')
    for (const item of items) assert.ok(document.body.textContent.includes(item[3]), item[3])
    assert.equal(reads, beforeReads, 'locale changes relabel the loaded history without fetching or resetting it')
    assert.equal(scroll.scrollTop, 37, 'locale switches preserve the reading position')
    if (presentation === 'conversation') assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'true')
    await show('zh')
    assert.ok(document.body.textContent.includes('搜索：用户反馈 {detail}'))
    assert.ok(document.body.textContent.includes('读取文件：reference/artifact-contract.md'))
    assert.ok(document.body.textContent.includes('失败：read_file (E_READ)'))
    assert.ok(document.body.textContent.includes(prose))
    assert.equal(JSON.stringify(snapshot), original, 'rendering never changes source entries or user content')
  } finally {
    await React.act(async () => root.unmount())
    assert.equal(livePollSubscriberCount(), 0)
  }
})
