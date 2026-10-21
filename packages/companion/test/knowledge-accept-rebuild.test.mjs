import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { startCompanion } from '../src/server.mjs'
import * as runtime from '../../knowledge-ladybug/lib/index.js'

after(() => runtime.shutdownLadybugKnowledgeRuntime())

const sha256 = value => createHash('sha256').update(value).digest('hex')
const event = type => JSON.stringify({ type: 'event_msg', payload: { type } }) + '\n'
const exec = promisify(execFile)

test('fixture: accepted GRA correction survives a cold KAG rebuild while transient review edges do not', async () => {
  const f = await fixture({ serverOptions: { host: 'codex', knowledgeRuntime: async () => runtime,
    embedding: { provider: 'disabled' } } })
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'kag-accept-rebuild-evidence-'))
  const browserSession = `kag-accept-rebuild-${process.pid}`
  const browser = (...args) => exec('agent-browser', ['--session', browserSession, ...args], { timeout: 45_000, maxBuffer: 1024 * 1024 })
  let server = f.server
  let serverOpen = true
  let nextRun = 210
  const call = (method, params = {}) => callCompanion(server.connectionPath, { method, params })
  const child = async label => {
    const runId = `00000000-0000-4000-8000-${String(nextRun++).padStart(12, '0')}`
    const transcriptPath = join(f.root, `${label}-${runId}.jsonl`)
    const nativeRun = { runId, parentRunId: threadId, transcriptPath }
    await writeFile(transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: runId,
      cwd: f.options.projectRoot, source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n' + event('task_started'))
    return nativeRun
  }
  const designFile = join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json')
  const graph = async () => JSON.parse((await call('readGraph')).content)
  const graphRecord = (request, text) => request.knowledge.graph.entities.find(entity => entity.entityType === 'design-record'
    && entity.properties.fields?.some(field => field.text === text))
  const relationFor = (a, b, summary) => ({
    from: a.id, to: b.id, relationType: 'constrains', summary,
    evidence: [a, b].map(entity => {
      const field = entity.properties.fields.find(item => item.pointer.endsWith('/answer'))
      assert.ok(field, `missing answer evidence for ${entity.id}`)
      return { source: entity.properties.file, locator: field.pointer, quote: field.text }
    }),
  })
  const submitGrounding = async ({ userContext, result }) => {
    const request = await call('prepareReview', { profile: 'grounding', userContext })
    const nativeRun = await child('grounding')
    await call('bindReviewRun', { reviewId: request.reviewId, nativeRun })
    const submitted = await call('submitReview', { reviewId: request.reviewId, nativeRun,
      result: typeof result === 'function' ? result(request) : result })
    assert.equal(submitted.status, 'completed')
    return { request, nativeRun, submitted }
  }
  try {
    const initialState = { questions: {
      purpose: { prompt: '首版用户边界', kind: 'text', answer: '仅供个人研究者使用；第一版同时必须支持导师协作', detail: '' },
      retention: { prompt: '数据保留', kind: 'text', answer: '由于首版仅供个人研究者使用，研究资料默认保留 30 天', detail: '' },
    } }
    await call('savePanel', { skill: 'smart_questions', state: initialState, eventId: 'accept-rebuild-initial' })
    // Agentic trigger model: a save settlement no longer auto-starts KAG
    // maintenance; the Agent explicitly requests one bounded pass.
    assert.equal((await call('refreshKnowledge')).outcome, 'accepted')
    const beforeFile = await readFile(designFile, 'utf8')
    const beforeGraph = await graph()
    const first = await submitGrounding({ userContext: 'fixture service-chain validation before explicit acceptance', result: request => {
      const purpose = graphRecord(request, initialState.questions.purpose.answer)
      const retention = graphRecord(request, initialState.questions.retention.answer)
      assert.ok(purpose && retention)
      return { schemaVersion: 1, inconsistencies: [{
        id: 'audience-boundary', facets: ['smart_questions', 'product-boundary'],
        summary: '个人使用与首版导师协作互相冲突', authoritativeReference: 'smart_questions/smart_questions.json',
        correction: '将首版限定为个人研究者，并把导师协作推迟到后续版本', affectedFacets: ['smart_questions'],
      }], knowledgeRelations: [relationFor(purpose, retention, '首版范围约束数据策略')] }
    } })
    const firstGraph = await graph()
    assert.ok(firstGraph.edges.some(edge => edge.id.startsWith('review:')), 'real Ladybug graph contains GRA proposed relation')

    await browser('open', server.url)
    await browser('wait', '#dsh-advisory-composer-inbox .dsh-advisory-card')
    await browser('click', '.dsh-advisory-accept')
    await browser('wait', '--fn', '!document.querySelector("#dsh-advisory-composer-inbox .dsh-advisory-card")')
    assert.equal(f.messages.length, 1, 'only explicit acceptance wakes the foreground')
    // The browser established authority. Repeating the same decision only
    // reads its durable idempotent receipt and must not send another message.
    const accepted = await call('decideAdvisory', { advisoryId: first.submitted.advisoryId, decision: 'accepted' })
    assert.equal(f.messages.length, 1)
    const receipt = accepted.actionReceipts[0]
    assert.equal(receipt.state, 'ready')
    const producer = await child('producer')
    await call('registerNativeRun', { ...producer, role: 'producer', skill: 'smart_questions', artifactId: 'smart_questions' })
    assert.equal((await call('claimReviewAction', { runId: producer.runId, receiptId: receipt.receiptId })).claimed, true)

    const correctedState = { questions: {
      purpose: { ...initialState.questions.purpose, answer: '首版仅供个人研究者使用；导师协作推迟到后续版本' },
      retention: initialState.questions.retention,
    } }
    const saved = await call('savePanel', { skill: 'smart_questions', state: correctedState, eventId: 'accept-rebuild-correction' })
    await call('finishNativeRun', { runId: producer.runId })
    await appendFile(producer.transcriptPath, event('task_complete'))
    const settlement = await call('settleReviewAction', { runId: producer.runId, receiptId: receipt.receiptId })
    assert.equal(settlement.state, 'completed')

    const afterFile = await readFile(designFile, 'utf8')
    assert.notEqual(afterFile, beforeFile)
    assert.match(afterFile, /首版仅供个人研究者使用；导师协作推迟到后续版本/)
    assert.match(afterFile, /由于首版仅供个人研究者使用，研究资料默认保留 30 天/)
    assert.doesNotMatch(afterFile, /第一版同时必须支持导师协作/)

    // The explicit Agent entry replaces the removed save-time auto refresh.
    assert.equal((await call('refreshKnowledge')).outcome, 'accepted')
    let correctedGraph
    for (let attempt = 0; attempt < 80; attempt += 1) {
      correctedGraph = await graph()
      if (correctedGraph.freshness?.sourceCheckpoint === correctedGraph.freshness?.indexedCheckpoint
        && correctedGraph.nodes.some(node => node.label?.includes('首版仅供个人研究者使用'))) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.ok(correctedGraph?.nodes.some(node => node.label?.includes('首版仅供个人研究者使用')),
      'an explicit bounded refresh publishes the corrected checkpoint before a KAG-backed review')
    const second = await submitGrounding({ userContext: 'fixture relation present immediately before cold rebuild', result: request => {
      const purpose = graphRecord(request, correctedState.questions.purpose.answer)
      const retention = graphRecord(request, correctedState.questions.retention.answer)
      assert.ok(purpose && retention)
      return { schemaVersion: 1, inconsistencies: [],
        knowledgeRelations: [relationFor(purpose, retention, '个人工作台范围约束数据保留策略')] }
    } })
    const immediatelyBeforeRebuild = await graph()
    const proposed = immediatelyBeforeRebuild.edges.find(edge => edge.id.startsWith('review:'))
    assert.ok(proposed, 'a valid proposed review edge exists immediately before cold rebuild')
    assert.ok(immediatelyBeforeRebuild.nodes.some(node => node.label?.includes('首版仅供个人研究者使用')))
    assert.ok(immediatelyBeforeRebuild.nodes.some(node => node.label?.includes('由于首版仅供个人研究者使用，研究资料默认保留 30 天')))

    const projectId = server.project.project.metadata.id
    const databaseRoot = join(f.options.stateRoot, 'project-management', 'registry', 'projects', projectId, 'design-knowledge')
    const backupRoot = `${databaseRoot}.pre-cold-rebuild`
    const checkpointBeforeRebuild = immediatelyBeforeRebuild.checkpoint
    const report = {
      boundary: 'fixture service-chain regression; not a real host Agent acceptance E2E',
      realLadybug: true,
      scriptedReviewResult: true,
      scriptedBundleMutationThroughPanelApi: true,
      browserAcceptance: true,
      projectId,
      receiptId: receipt.receiptId,
      settlement,
      firstAdvisoryId: first.submitted.advisoryId,
      preRebuildReviewId: second.request.reviewId,
      preRebuildProposedRelationId: proposed.id,
      checkpointBeforeRebuild,
      knowledgeRevisionBeforeRebuild: immediatelyBeforeRebuild.knowledgeRevision,
      beforeFileSha256: sha256(beforeFile),
      correctedFileSha256: sha256(afterFile),
      databaseRoot,
      backupRoot,
      initialKnowledgeRevision: beforeGraph.knowledgeRevision,
    }
    await writeFile(join(evidenceRoot, 'before.json'), beforeFile)
    await writeFile(join(evidenceRoot, 'corrected.json'), afterFile)
    await writeFile(join(evidenceRoot, 'pre-rebuild-graph.json'), JSON.stringify(immediatelyBeforeRebuild, null, 2))

    await server.close()
    serverOpen = false
    await mkdir(dirname(backupRoot), { recursive: true })
    await rename(databaseRoot, backupRoot)
    server = await startCompanion({ ...f.options, host: 'codex', knowledgeRuntime: async () => runtime,
      embedding: { provider: 'disabled' }, knowledgeAutoRefresh: true })
    serverOpen = true
    const rebuilt = await graph()
    const rebuiltFile = await readFile(designFile, 'utf8')
    assert.equal(sha256(rebuiltFile), report.correctedFileSha256, 'cold rebuild never rewrites the Design File')
    assert.equal(rebuilt.checkpoint, checkpointBeforeRebuild)
    assert.ok(rebuilt.nodes.some(node => node.label?.includes('首版仅供个人研究者使用')))
    assert.ok(rebuilt.nodes.some(node => node.label?.includes('由于首版仅供个人研究者使用，研究资料默认保留 30 天')))
    assert.ok(!rebuilt.nodes.some(node => node.label?.includes('第一版同时必须支持导师协作')))
    assert.ok(!rebuilt.edges.some(edge => edge.id === proposed.id), 'transient GRA relation is not reconstructed from Design Files')
    report.knowledgeRevisionAfterColdRebuild = rebuilt.knowledgeRevision
    report.checkpointAfterColdRebuild = rebuilt.checkpoint
    report.rebuiltNodeCount = rebuilt.nodes.length
    report.rebuiltEdgeCount = rebuilt.edges.length
    report.proposedRelationRestored = rebuilt.edges.some(edge => edge.id === proposed.id)
    await writeFile(join(evidenceRoot, 'post-rebuild-graph.json'), JSON.stringify(rebuilt, null, 2))

    await server.close()
    serverOpen = false
    server = await startCompanion({ ...f.options, host: 'codex', knowledgeRuntime: async () => runtime,
      embedding: { provider: 'disabled' }, knowledgeAutoRefresh: true })
    serverOpen = true
    const reopened = await graph()
    assert.equal(reopened.checkpoint, rebuilt.checkpoint)
    assert.equal(reopened.knowledgeRevision, rebuilt.knowledgeRevision)
    assert.ok(reopened.nodes.some(node => node.label?.includes('首版仅供个人研究者使用')))
    report.reopenKnowledgeRevision = reopened.knowledgeRevision
    report.evidenceRoot = evidenceRoot
    await writeFile(join(evidenceRoot, 'reopen-graph.json'), JSON.stringify(reopened, null, 2))
    await writeFile(join(evidenceRoot, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`KAG_ACCEPT_REBUILD_EVIDENCE=${evidenceRoot}`)
  } finally {
    await browser('close').catch(() => {})
    if (serverOpen) await server.close().catch(() => {})
    await rm(f.root, { recursive: true, force: true })
  }
})
