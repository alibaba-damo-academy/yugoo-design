/** Actual local service + MCP/CLI, synthetic project only; no native Host/model. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { fixture } from './fixture.mjs'
import { createDesignMcp } from '../src/mcp.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { DESIGN_WORKER_EVIDENCE_GUIDANCE } from '../../core/lib/index.js'

const execute = promisify(execFile)
const bytes = value => Buffer.byteLength(JSON.stringify(value))

test('real service and model transports reduce repeated payload while preserving exact state and settlement', async t => {
  const f = await fixture({ smartQuestionsMode: 'main', withTranscript: true,
    serverOptions: { host: 'workbuddy', workbuddyProducer: true } })
  const mcp = createDesignMcp(), client = new Client({ name: 'model-transport-fixture', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const request = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const tool = async (name, params = {}) => {
    const result = await client.callTool({ name, arguments: { connection: f.server.connectionPath, ...params } })
    assert.notEqual(result.isError, true, JSON.stringify(result))
    return JSON.parse(result.content[0].text)
  }
  try {
    await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)])
    const rawPrepare = await request('prepareBundle', { skill: 'smart_questions' })
    const prepare = await tool('design_prepare_bundle', { skill: 'smart_questions' })
    assert.equal(prepare.method, rawPrepare.method, 'complete domain method and native instructions survive unchanged')
    assert.deepEqual(prepare.executionContract.validation, rawPrepare.executionContract.validation)
    assert.equal(prepare.workerMethod, undefined, 'unsupported WorkBuddy Workers add no instruction payload')
    // Reconstruct the previous wire shape from actual authoritative responses
    // and unchanged shared guidance, not a second runtime or a timed Host run.
    const legacyPrepare = { ...rawPrepare, mainAssessmentContext: { available: true, ...await request('mainContext') },
      workerMethod: DESIGN_WORKER_EVIDENCE_GUIDANCE }
    assert.ok(bytes(prepare) < bytes(legacyPrepare))

    const context = await tool('design_main_context')
    await tool('report_design_clarity', { input: context.input, summary: 'Synthetic agreed scope.',
      u: { score: 60, evidence: 'User evidence. '.repeat(100) },
      s: { score: 50, evidence: 'Structure evidence. '.repeat(100) },
      t: { score: 40, evidence: 'Acceptance evidence. '.repeat(100) } })
    const rawStatus = await request('readWorkspace', { includeServices: true, includeConversation: false })
    const legacyStatus = Object.fromEntries(['executionAttempts', 'artifactActivities', 'activeMainBundles', 'clarity',
      'continuations', 'reviews', 'reviewPolicy', 'reviewDispatchOwner', 'hostCapabilities',
      'autoPanelStates', 'autoPanelDefinitions', 'services'].map(key => [key, rawStatus[key]]))
    const status = await tool('design_status')
    assert.equal(status.projectId, rawStatus.projectId)
    assert.equal(status.checkpoint, rawStatus.checkpoint)
    assert.deepEqual(status.services.ust.assessment, rawStatus.services.ust.assessment)
    assert.deepEqual(status.reviews, rawStatus.reviews)
    assert.equal(status.clarity.assessment, undefined)
    assert.equal(status.services.gra.reviews, undefined)
    assert.equal(status.hostCapabilities.backgroundReviewProtocol.proof, undefined)
    const details = await tool('design_status', { details: true })
    assert.deepEqual(details.hostCapabilities.backgroundReviewProtocol, rawStatus.hostCapabilities.backgroundReviewProtocol)
    assert.ok(bytes(status) < bytes(legacyStatus))

    const invocation = await tool('design_begin_main_bundle', { skill: 'smart_questions' })
    const state = { questions: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`Q-${i + 1}`,
      { prompt: `Synthetic question ${i + 1}`, kind: 'text', answer: '', detail: '' }])) }
    await mkdir(join(f.options.projectRoot, 'design_files/smart_questions'), { recursive: true })
    await writeFile(join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json'), JSON.stringify(state))
    const finishParams = { invocationId: invocation.invocationId, scope: 'state', outcome: 'pause' }
    const rawFinish = await request('finishMainBundle', finishParams)
    const head = await f.server.project.store.head()
    const finish = await tool('design_finish_main_bundle', finishParams)
    assert.equal(finish.accepted, true)
    assert.equal(finish.settlement.commit, rawFinish.settlement.commit)
    assert.equal(finish.settlement.state, undefined)
    assert.equal(await f.server.project.store.head(), head, 'same finish reads its receipt without republishing')
    assert.ok(bytes(finish) < bytes(rawFinish))
    const refused = await client.callTool({ name: 'design_finish_main_bundle', arguments: {
      connection: f.server.connectionPath, invocationId: invocation.invocationId, scope: 'completion', outcome: 'complete' } })
    assert.equal(refused.isError, true, 'another outcome cannot be smuggled through compact transport')

    const path = join(f.root, 'status-request.json')
    await writeFile(path, JSON.stringify({ method: 'readWorkspace', params: { includeServices: true, includeConversation: false } }))
    const cli = fileURLToPath(new URL('../src/plugin-cli.mjs', import.meta.url))
    const argv = ['--experimental-transform-types', cli, 'call', '--connection', f.server.connectionPath, '--request', path]
    const compact = JSON.parse((await execute(process.execPath, argv, { timeout: 30_000 })).stdout)
    const full = JSON.parse((await execute(process.execPath, [...argv, '--full-response'], { timeout: 30_000 })).stdout)
    assert.equal(compact.projectId, full.projectId)
    assert.equal(compact.checkpoint, full.checkpoint)
    assert.equal(compact.design, undefined)
    assert.deepEqual(full.design.smart_questions.state, state)
    assert.deepEqual(compact.services.ust.assessment, full.services.ust.assessment)
    assert.ok(full.hostCapabilities.backgroundReviewProtocol.proof)
    assert.equal(f.messages.length, 0, 'reads, reporting and settlement launch no model, review or user continuation')
    t.diagnostic(JSON.stringify({ bytes: {
      prepare: { legacyShape: bytes(legacyPrepare), compact: bytes(prepare) },
      status: { legacyShape: bytes(legacyStatus), compact: bytes(status) },
      finish: { raw: bytes(rawFinish), compact: bytes(finish) },
      cliStatus: { full: bytes(full), compact: bytes(compact) },
    }, boundary: 'Actual temporary service fields; legacy shape reconstructed from preserved d05 fields. Byte reduction, not native latency or model-token measurement.' }))
  } finally { await client.close(); await mcp.close(); await f.close() }
})
