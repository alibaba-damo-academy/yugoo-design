/** Real project mutation lane and persisted authority; no Host, model or browser. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { DesignProjectManager, readDesignClarityAuthority, designProjectRecordsRoot } from '../../core/lib/index.js'
import { createCompanionMainContext } from '../src/main-context.mjs'
import { createCompanionReviews } from '../src/reviews.mjs'

test('main UST uses the real project lane and a later evaluator cannot replace its current authority', { timeout: 15000 }, async t => {
  const { openCompanionProject } = await import(process.env.DSH_TEST_PROJECT_MODULE ?? '../src/project.mjs')
  const root = await mkdtemp(join(tmpdir(), 'main-ust-project-')); t.after(() => rm(root, { recursive: true, force: true }))
  const kitRoot = join(root, 'kit'), projectRoot = join(root, 'project'), stateRoot = join(root, 'runtime'), threadId = randomUUID()
  await mkdir(join(kitRoot, 'skills'), { recursive: true })
  await cp(fileURLToPath(new URL('../../skills-web-app/kits/web_app/mindset.md', import.meta.url)), join(kitRoot, 'mindset.md'))
  await cp(fileURLToPath(new URL('../../skills-web-app/bundles', import.meta.url)), join(kitRoot, 'skills'), { recursive: true })
  await new DesignProjectManager().create({ root: projectRoot, name: 'Main UST fixture', knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'web_app', version: '1.0' } })
  const connectionPath = join(root, 'private.json')
  const transcriptPath = join(root, 'synthetic-native.jsonl'); await writeFile(transcriptPath, '{}\n')
  const project = await openCompanionProject({ projectRoot, kitRoot, stateRoot, connection: { threadId, send: async () => ({ accepted: true }) }, getConnectionPath: () => connectionPath })
  const state = answer => ({ questions: { goal: { prompt: 'Goal?', kind: 'text', answer, detail: '' } } })
  const first = await project.savePanel({ skill: 'smart_questions', state: state('private notes'), eventId: 'first-save' })
  const log = { available: true, threadId, rows: [{ id: 'user-1', role: 'user', nativeTurn: 1, text: 'Design private notes' }] }
  let main, inputUnavailable = false
  const reviews = createCompanionReviews({ project, stateRoot, threadId, readMainInput: async () => {
    if (inputUnavailable) throw new Error('Current main history unavailable')
    return main.input()
  } })
  main = createCompanionMainContext({ project, stateRoot, host: 'codex', threadId, transcriptPath, readTranscript: async () => log, getConnectionPath: () => connectionPath, reviews })
  const scores = { summary: 'Saved scope assessed in the main turn.', u: { score: 80, evidence: 'Owner is explicit.' },
    s: { score: 70, evidence: 'Notes scope is saved.' }, t: { score: 60, evidence: 'Privacy needs criteria.' } }
  const args = { input: (await main.context()).input, ...scores }
  const saved = await main.report(args)
  assert.equal(saved.assessedCheckpoint, first.commit)
  assert.equal((await main.context()).clarity.state, 'current')
  const before = await readFile(join(designProjectRecordsRoot(projectRoot), 'clarity.json'), 'utf8')
  const request = await reviews.prepareReview({ profile: 'clarity' })
  const nativeRun = { runId: randomUUID(), parentRunId: threadId, transcriptPath: join(root, 'explicit-synthetic-child.jsonl') }
  await reviews.bindReviewRun({ reviewId: request.reviewId, nativeRun })
  await reviews.submitReview({ reviewId: request.reviewId, nativeRun, result: { ...scores, summary: 'Independent evaluator result.' } })
  assert.equal(await readFile(join(designProjectRecordsRoot(projectRoot), 'clarity.json'), 'utf8'), before)
  assert.equal((await reviews.readClarity()).needsReassessment, false)
  const retained = await reviews.readReview({ reviewId: request.reviewId })
  assert.equal(retained.historicalResult.summary, 'Independent evaluator result.')
  inputUnavailable = true
  const unavailable = await reviews.prepareReview({ profile: 'clarity', manualRequestId: 'unknown-main-input' })
  const otherRun = { ...nativeRun, runId: randomUUID() }
  await reviews.bindReviewRun({ reviewId: unavailable.reviewId, nativeRun: otherRun })
  await reviews.submitReview({ reviewId: unavailable.reviewId, nativeRun: otherRun, result: scores })
  assert.equal(await readFile(join(designProjectRecordsRoot(projectRoot), 'clarity.json'), 'utf8'), before)
  assert.equal((await reviews.readClarity()).needsReassessment, true, 'unknown current scope never becomes a current score')
  inputUnavailable = false
  const next = await project.savePanel({ skill: 'smart_questions', state: state('shared notes'), eventId: 'second-save' })
  assert.notEqual(next.commit, first.commit)
  await assert.rejects(main.report(args), /no longer current/)
  assert.equal((await main.context()).clarity.state, 'due')
  assert.equal((await readDesignClarityAuthority(designProjectRecordsRoot(projectRoot), project.project.metadata.id)).report.summary, scores.summary)
})
