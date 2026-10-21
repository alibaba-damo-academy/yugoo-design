/** Real Companion HTTP/RPC and source React consumer, with synthetic native-format
 * transcript events. This verifies the bridge, not a live Host/model execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createDesignMcp } from '../src/mcp.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
const requirePanel = createRequire(new URL('../../panel/package.json', import.meta.url))
const { JSDOM } = requirePanel('jsdom')
const React = requirePanel('react')
const { createRoot } = requirePanel('react-dom/client')
const { register } = await import('tsx/esm/api'); register()
globalThis.React = React
const { renderToStaticMarkup } = requirePanel('react-dom/server')
const { BackgroundReviewPanel } = await import('../src/background-reviews.tsx')
const { ExecutionTrace } = await import('../../panel/src/artifact-workspace.tsx')
const { requestLivePoll, livePollSubscriberCount } = await import('../../panel/src/client/live-poll.ts')
let clock = 0
const event = (type, item) => JSON.stringify({ type: 'event_msg', timestamp: new Date(1700000000000 + ++clock).toISOString(), payload: { type, ...(item ? { item } : {}) } }) + '\n'
const message = text => event('item_completed', { type: 'AgentMessage', id: text, content: [{ type: 'text', text }] })
const focus = id => ({ artifactKind: 'direction', artifactId: `R-001/${id}`, artifactFile: `research/R-001/${id}.md` })

test('review labels distinguish confirmed main checks from native background binding without dispatching', () => {
  const render = (reviews, disconnected = false) => renderToStaticMarkup(React.createElement(BackgroundReviewPanel, { value: { reviews, rows: [] }, disconnected }))
  const foreground = render([{ profile: 'grounding', status: 'prepared', executionMode: 'foreground' }])
  assert.match(foreground, /等待主对话同步评审/)
  assert.doesNotMatch(foreground, /等待原生绑定|后台运行中/)
  assert.match(render([{ profile: 'grounding', status: 'prepared', executionMode: 'background' }]), /等待原生绑定/)
  const completed = render([{ profile: 'alignment', status: 'completed', executionMode: 'foreground' }])
  assert.match(completed, /已完成/)
  assert.doesNotMatch(completed, /companion-spinner/)
  assert.match(render([{ profile: 'reflection', status: 'due', executionAvailability: 'unavailable' }]), /手动检查仍可用/)
  const disconnected = render([{ profile: 'grounding', status: 'running', executionMode: 'foreground' }], true)
  assert.match(disconnected, /状态同步已断开/)
  assert.match(disconnected, /主对话同步评审中/)
  assert.doesNotMatch(disconnected, /companion-spinner/)
})

test('MCP discovery returns the compiled Core execution_log catalog without claiming generation or edit access', async () => {
  const server = createDesignMcp(), client = new Client({ name: 'log-discovery-test', version: '1' })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(st); await client.connect(ct)
    const response = await client.callTool({ name: 'design_list_panel_components', arguments: { name: 'execution_log' } })
    assert.ok(!response.isError, JSON.stringify(response))
    const result = JSON.parse(response.content[0].text)
    assert.equal(result.components.length, 1)
    assert.equal(result.components[0].name, 'execution_log')
    assert.equal(result.components[0].generated, false)
    assert.equal(result.components[0].sourceBound, false)
    assert.match(result.components[0].description, /Host-owned/)
  } finally { await client.close(); await server.close() }
})

test('shared artifact log reads exact main segments over RPC, resets on focus and recovers without bleeding late rows', async () => {
  const f = await fixture({ withTranscript: true, researchMode: 'main' })
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const control = async (method, params) => React.act(async () => { await call(method, params) })
  const mutate = async operation => React.act(async () => { await operation() })
  let holdLate = false, release, lateStarted = false
  const calls = []
  const read = async (runId, afterSeq, target) => {
    calls.push({ runId, afterSeq, target })
    const result = await call('readExecutionLog', { runId, afterSeq, ...target })
    if (holdLate && target.artifactId === 'R-001/A') {
      lateStarted = true
      await new Promise(resolve => { release = resolve })
    }
    return result
  }
  const until = async predicate => {
    for (let index = 0; index < 80 && !predicate(); index++) await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
    assert.ok(predicate(), 'bounded bridge observation did not arrive')
  }
  let invocationId
  const render = async (id, status = 'working') => {
    const item = { ...focus(id), id, title: id, points: [], links: [], status, runId: threadId,
      logTarget: { artifactId: focus(id).artifactId, invocationId } }
    await React.act(async () => root.render(React.createElement(ExecutionTrace, { item, read })))
  }
  const poll = async () => React.act(async () => requestLivePoll())
  try {
    await appendFile(f.options.transcriptPath, event('task_started') + message('UNRELATED-PRIVATE-PREFIX'))
    invocationId = (await call('beginMainBundle', { skill: 'research' })).invocationId
    await call('focusArtifact', { invocationId, ...focus('A') })
    await appendFile(f.options.transcriptPath, message('**A-FIRST**'))
    await render('A')
    await until(() => document.body.textContent.includes('A-FIRST'))
    assert.equal(document.querySelector('strong').textContent, 'A-FIRST', 'real bridge rows use shared Markdown rendering')
    assert.doesNotMatch(document.body.textContent, /UNRELATED-PRIVATE-PREFIX/)
    assert.deepEqual(calls[0].target, { artifactId: 'R-001/A', invocationId })

    const savedTranscript = await readFile(f.options.transcriptPath, 'utf8')
    await mutate(() => writeFile(f.options.transcriptPath, '{unavailable-native-transcript\n'))
    const beforeFailure = calls.length
    await poll(); await until(() => calls.length > beforeFailure && document.querySelector('[role=status]'))
    assert.match(document.body.textContent, /A-FIRST/, 'temporarily unreadable native logs retain the last readable rows')
    await mutate(() => writeFile(f.options.transcriptPath, savedTranscript + message('A-RECOVERED')))
    await poll(); await until(() => document.body.textContent.includes('A-RECOVERED'))
    assert.equal(document.querySelectorAll('.dsh-execution-log-markdown').length, 2, 'reset snapshots never duplicate accumulated rows')

    holdLate = true
    await poll(); await until(() => lateStarted)
    await control('focusArtifact', { invocationId, ...focus('B') })
    await mutate(() => appendFile(f.options.transcriptPath, message('B-ONLY')))
    await render('B')
    assert.doesNotMatch(document.body.textContent, /A-FIRST|A-RECOVERED/, 'the old scope is removed before B arrives')
    await until(() => document.body.textContent.includes('B-ONLY'))
    holdLate = false
    await React.act(async () => release())
    assert.doesNotMatch(document.body.textContent, /A-FIRST|A-RECOVERED/, 'late A response cannot overwrite B')
    assert.deepEqual(calls.at(-1).target, { artifactId: 'R-001/B', invocationId })

    await control('focusArtifact', { invocationId, ...focus('A') })
    await mutate(() => appendFile(f.options.transcriptPath, Array.from({ length: 205 }, (_, index) => message(`A-TAIL-${index}`)).join('')))
    await render('A'); await until(() => document.body.textContent.includes('A-TAIL-204'))
    assert.equal(document.querySelectorAll('.dsh-execution-log-markdown').length, 200)
    assert.doesNotMatch(document.body.textContent, /B-ONLY|UNRELATED-PRIVATE-PREFIX|A-FIRST|A-RECOVERED/)
    await control('finishMainBundle', { invocationId, outcome: 'cancelled' })
    await render('A', 'failed')
    assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'false')
    await React.act(async () => document.querySelector('button').click())
    await until(() => document.body.textContent.includes('A-TAIL-204'))
    assert.equal(f.messages.length, 0, 'read-only logs send no Host messages')
  } finally {
    release?.()
    await React.act(async () => root.unmount())
    assert.equal(livePollSubscriberCount(), 0)
    await f.close(); dom.window.close()
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
