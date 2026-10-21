import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, threadId } from './fixture.mjs'
import { createCompanionReviews } from '../src/reviews.mjs'
import { nativeScope } from '../src/native-identity.mjs'
import * as core from '../../core/lib/index.js'

const marker = 'INTERNAL_GRAPH_EVIDENCE_'
const body = marker.repeat(20_000)

function capturedKnowledge(project, checkpoint) {
  const graph = { revision: 'rev:fixture', entities: [{ id: 'source-record', properties: { evidence: body } }], relations: [] }
  return { project, checkpoint, sourceCheckpoint: checkpoint, knowledgeRevision: graph.revision, graph,
    context: JSON.stringify({ entities: graph.entities, relations: graph.relations }) }
}

for (const host of ['codex', 'workbuddy']) test(`${host} reviewer reads methods and exact KAG pins without preloaded or duplicate graph evidence`, async t => {
  const f = await fixture()
  t.after(() => f.close())
  const project = f.server.project
  await project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'native-reader-context' })
  const projectId = project.project.metadata.id
  const api = createCompanionReviews({ project, stateRoot: f.options.stateRoot, threadId, host,
    knowledge: { captureReview: async checkpoint => capturedKnowledge(projectId, checkpoint) } })
  const batch = await api.prepareReviews({ profiles: ['alignment'] })
  const ref = batch.requests[0]
  assert.equal(ref.dispatch, true)
  assert.equal(ref.prompt, undefined)

  const request = await api.readReview({ reviewId: ref.reviewId })
  assert.ok(request.prompt && request.schema && request.input)
  assert.equal(request.revisionChanged, false)
  assert.equal(request.superseded, false)
  assert.match(request.prompt, /design_query_knowledge/)
  assert.match(request.prompt, host === 'workbuddy' ? /Read only Design Files committed at/ : /Read current Design Files yourself/)
  assert.match(request.prompt, /main conversation must not wait/)
  assert.ok(request.prompt.startsWith(core.officialAdvisoryProfile(core.OFFICIAL_ALIGNMENT_PROFILE).prompt), 'the complete domain method is retained')
  assert.doesNotMatch(request.prompt, /Main Agents, Producers and Workers|On DSH the main Agent|Forward supplied pins to Workers/)
  assert.match(request.prompt, /KAG is an optional read-only discovery aid/)
  assert.match(request.prompt, /unchanged filters/)
  assert.match(request.prompt, /direction is STORAGE incoming\/outgoing/)
  assert.match(request.prompt, /most specific evidenced unit\/field/)
  assert.match(request.prompt, /partial page, unfinished index or isolated node is not proof of missing design/)
  assert.ok(request.prompt.includes(core.knowledgeReviewGuidance(project.kit.relationVocabulary)), 'shared relationship evidence and semantic constraints are retained')
  if (host === 'workbuddy') {
    assert.match(request.prompt, /choose relevant regular files/)
    assert.match(request.prompt, /rather than reading every file or all history by default/)
    assert.match(request.prompt, /page\.complete=true/)
    assert.match(request.prompt, /Do not omit or replace the checkpoint/)
  }
  assert.deepEqual(request.knowledge, {
    project: projectId, checkpoint: batch.revision.checkpoint,
    sourceCheckpoint: batch.revision.checkpoint, knowledgeRevision: 'rev:fixture',
  })
  const pins = request.prompt.match(/Stored KAG query pins: (\{[^\n]+?\})\./)
  assert.ok(pins)
  assert.deepEqual(JSON.parse(pins[1]), { project: projectId, checkpoint: batch.revision.checkpoint, revision: 'rev:fixture' })
  assert.equal(JSON.stringify(request).includes(marker), false)
  assert.ok(JSON.stringify(request).length < body.length / 2, 'internal graph size must not inflate reviewer startup')

  const nativeRun = { runId: '00000000-0000-4000-8000-000000000099', parentRunId: threadId,
    transcriptPath: join(f.root, 'reviewer.jsonl') }
  await api.bindReviewRun({ reviewId: ref.reviewId, nativeRun })
  assert.deepEqual((await api.readReview({ reviewId: ref.reviewId })).nativeRun, nativeRun)
  const stored = JSON.parse(await readFile(join(f.options.stateRoot, projectId, `reviews-${nativeScope(host, threadId)}.json`), 'utf8')).requests[ref.reviewId]
  assert.equal(stored.knowledge.graph.entities[0].properties.evidence, body, 'result validation retains its exact captured graph')
  assert.equal(stored.prompt.includes(marker), false)
  await assert.rejects(api.readReview({ reviewId: 'not-a-request' }), /Unknown review ID/)
})

test('service-managed reviewers retain their existing supplied graph context and snapshot', async t => {
  const f = await fixture()
  t.after(() => f.close())
  const project = f.server.project
  await project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'managed-reader-context' })
  const api = createCompanionReviews({ project, stateRoot: f.options.stateRoot, threadId, managedExecution: true,
    knowledge: { captureReview: async checkpoint => capturedKnowledge(project.project.metadata.id, checkpoint) } })
  const request = await api.claimManagedReview({ profile: 'alignment', ownerId: 'fixture-owner' })
  assert.equal(request.status, 'running')
  assert.ok(request.prompt.includes(marker), 'the service-managed supplied-context path is unchanged')
  assert.equal(request.knowledge.graph.entities[0].properties.evidence, body)
  assert.ok(request.prompt.includes(core.KNOWLEDGE_AGENTIC_GUIDANCE), 'managed execution retains its original complete guidance')
  assert.match(request.prompt, /Return only the requested JSON result directly\. The service collects your output/)
  assert.doesNotMatch(request.prompt, /retry the same review at most once|Use that existing binding/)
})

test('all native GRA profiles retain their methods and bounded submission guidance without KAG', async t => {
  const f = await fixture()
  t.after(() => f.close())
  const project = f.server.project
  await project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'native-review-completion' })
  const api = createCompanionReviews({ project, stateRoot: f.options.stateRoot, threadId, host: 'workbuddy' })
  const profiles = { grounding: core.OFFICIAL_GROUNDING_PROFILE, reflection: core.OFFICIAL_REFLECTION_PROFILE, alignment: core.OFFICIAL_ALIGNMENT_PROFILE }
  const batch = await api.prepareReviews({ profiles: Object.keys(profiles), userContext: 'Review existing saved evidence only.' })
  assert.equal(batch.requests.length, 3)
  for (const ref of batch.requests) {
    const request = await api.readReview({ reviewId: ref.reviewId })
    assert.equal(request.knowledge, undefined)
    assert.ok(request.prompt.startsWith(core.officialAdvisoryProfile(profiles[request.profile]).prompt))
    assert.deepEqual(request.schema, core.officialAdvisoryProfile(profiles[request.profile]).outputSchema)
    assert.match(request.prompt, /Current user context: Review existing saved evidence only/)
    assert.match(request.prompt, /choose relevant regular files/)
    assert.match(request.prompt, /registered nativeRun from design_read_review/)
    assert.match(request.prompt, /if still unbound, report pending binding and yield without polling/)
    assert.match(request.prompt, /numbers remain numbers, booleans remain booleans, and arrays remain arrays/)
    assert.match(request.prompt, /correct the identified field .* retry the same review at most once/)
    assert.match(request.prompt, /submission delivery\/acceptance is uncertain, stop and return the concrete diagnostic/)
    assert.match(request.prompt, /Do not restart the review, blindly replay a submission/)
    assert.match(request.prompt, /internal state or sibling transcripts through shell commands/)
    assert.match(request.prompt, /accepted advisory with knowledgeError is already submitted/)
    assert.match(request.prompt, /claim completion only after a successful submission receipt/)
    assert.match(request.prompt, /main conversation must not wait/)
  }
})

test('the shared native reviewer reference keeps autonomous evidence and bounded correction guidance', async () => {
  const text = await readFile(new URL('../plugin/design-system/skills/design-panel/native-execution.md', import.meta.url), 'utf8')
  assert.match(text, /reading every project file,[\s\S]*is not a submission prerequisite/)
  assert.match(text, /does not repeat the Producer\/Worker setup/)
  assert.match(text, /service owns\s+identity and freshness validation/)
  assert.match(text, /`schemaVersion` is the number `1`, not `"1"`/)
  assert.match(text, /one correction of the identified[\s\S]*one retry of the same review/)
  assert.match(text, /or delivery\/acceptance is uncertain, return the concrete diagnostic/)
  assert.match(text, /not permission for the main conversation to wait,[\s\S]*submit the child's result on its behalf/)
  assert.match(text, /accepted advisory with `knowledgeError` is already submitted/)
})
