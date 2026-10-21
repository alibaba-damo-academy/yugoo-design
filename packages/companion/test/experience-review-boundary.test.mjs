/** Derived views never constitute new product evidence in either adapter. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, threadId } from './fixture.mjs'
import { createCompanionReviews } from '../src/reviews.mjs'
import { createManagedReviewScheduler } from '../src/managed-reviews.mjs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readDesignClarityAuthority } from '../../core/lib/index.js'
import { callCompanion } from '../src/connection-file.mjs'
import { register } from 'tsx/esm/api'
register()
const { operateExperience } = await import('../../core/src/experience-service.ts')
const emptyAlignment = { schemaVersion: 1, questions: [] }
const identity = r => ({ reviewId: r.reviewId, ownerId: r.execution.ownerId, attemptId: r.execution.attemptId })
const derived = (project, value) => project.store.commitExperienceFiles('demo', { '_experiences/demo/view.json': JSON.stringify({ value }) })
async function until(check) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 10)) }
  throw new Error('Timed out')
}

test('native in-flight result and persisted card pins survive derived changes, not source edits', async () => {
  const f = await fixture()
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const project = f.server.project
    await project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'initial' })
    const r = await call('prepareReview', { profile: 'grounding' })
    const nativeRun = { runId: '00000000-0000-4000-8000-000000000096', parentRunId: threadId, transcriptPath: join(f.root, 'child.jsonl') }
    await writeFile(nativeRun.transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: nativeRun.runId, cwd: f.options.projectRoot, source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n')
    await call('bindReviewRun', { reviewId: r.reviewId, nativeRun })
    await derived(project, 1)
    const result = { schemaVersion: 1, inconsistencies: [{ id: 'audience', facets: ['smart_questions', 'research'], summary: 'Mismatch', authoritativeReference: 'smart_questions/smart_questions.json', correction: 'Use saved audience', affectedFacets: ['research'] }] }
    assert.equal((await call('submitReview', { reviewId: r.reviewId, nativeRun, result })).status, 'completed')
    const before = await call('listAdvisories')
    assert.equal(before.length, 1)
    assert.equal(before[0].stale, false)
    await derived(project, 2)
    assert.deepEqual(await call('listAdvisories'), before, 'Do not rewrite persisted evidence pins')
    await writeFile(join(project.store.rootDir, 'smart_questions/smart_questions.json'), '{"questions":{"changed":true}}')
    assert.equal((await call('listAdvisories'))[0].stale, true)
  } finally { await f.close() }
})

test('in-flight managed clarity retains its actual checkpoint across derived commits; real changes reject output', async () => {
  const f = await fixture()
  try {
    const project = f.server.project
    await project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'initial' })
    const api = createCompanionReviews({ project, stateRoot: f.options.stateRoot, threadId, managedExecution: true })
    const r = await api.claimManagedReview({ profile: 'clarity', ownerId: 'test' })
    await derived(project, 1)
    const result = { summary: 'Evidence', u: { score: 10, evidence: 'Intent' }, s: { score: 0, evidence: 'No structure' }, t: { score: 0, evidence: 'No criteria' } }
    assert.equal((await api.finishManagedReview({ ...identity(r), result })).status, 'completed')
    const clarity = await api.readClarity()
    assert.equal(clarity.needsReassessment, false)
    const authority = await readDesignClarityAuthority(join(f.options.stateRoot, project.project.metadata.id), project.project.metadata.id)
    assert.equal(authority.assessedCheckpoint, r.revision.checkpoint)
    const next = await api.claimManagedReview({ profile: 'alignment', ownerId: 'test' })
    await project.savePanel({ skill: 'smart_questions', state: { questions: { goal: { prompt: 'Goal', kind: 'text', answer: 'new' } } }, eventId: 'source' })
    assert.equal((await api.finishManagedReview({ ...identity(next), result: emptyAlignment })).status, 'stale')
    assert.equal((await api.readClarity()).needsReassessment, true)
  } finally { await f.close() }
})

test('native currency ignores derived files, preserves empty/binary worktree checks and conservative old-host fallback', async () => {
  const f = await fixture()
  try {
    const project = f.server.project
    await project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'initial' })
    const api = createCompanionReviews({ project, stateRoot: f.options.stateRoot, threadId })
    const r = await api.prepareReview({ profile: 'alignment' })
    await derived(project, 1)
    assert.equal((await api.readReview({ reviewId: r.reviewId })).revisionChanged, false)
    await writeFile(join(project.store.rootDir, '_experiences/demo/view.json'), 'unpublished draft')
    assert.equal((await api.readReview({ reviewId: r.reviewId })).revisionChanged, false)
    const source = join(project.store.rootDir, 'smart_questions/extra.png')
    await writeFile(source, Buffer.alloc(0))
    assert.equal((await api.readReview({ reviewId: r.reviewId })).revisionChanged, true, 'Empty artifact addition still matters')
    const second = await api.prepareReview({ profile: 'grounding' })
    await writeFile(source, Buffer.from([0, 255, 1]))
    assert.equal((await api.readReview({ reviewId: second.reviewId })).revisionChanged, true)
    const legacyProject = { ...project, readWorkspace: async () => { const { evidenceWorktreeRevision, ...rest } = await project.readWorkspace(); return rest } }
    const legacy = createCompanionReviews({ project: legacyProject, stateRoot: f.options.stateRoot, threadId })
    const old = await legacy.prepareReview({ profile: 'reflection' })
    await writeFile(join(project.store.rootDir, '_experiences/demo/view.json'), 'another draft')
    assert.equal((await legacy.readReview({ reviewId: old.reviewId })).revisionChanged, true, 'Older host full hash is conservative')
    const missing = createCompanionReviews({ project: { ...project, readWorkspace: async () => ({ checkpoint: r.revision.checkpoint }) }, stateRoot: f.options.stateRoot, threadId })
    await assert.rejects(missing.prepareReview({ profile: 'alignment' }), /worktree revision/)
  } finally { await f.close() }
})

test('managed notify keeps derived-only work alive and cancels for source and Kit changes', async () => {
  const f = await fixture()
  let scheduler
  const signals = [], errors = []
  try {
    const project = f.server.project
    await project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'initial' })
    // The wrapper permits a Kit-change probe without mutating the loaded Kit.
    const wrapped = { ...project, kit: { ...project.kit } }
    const reviews = createCompanionReviews({ project: wrapped, stateRoot: f.options.stateRoot, threadId, managedExecution: true })
    scheduler = createManagedReviewScheduler({ project: wrapped, reviews, debounceMs: 0, onError: e => errors.push(e), execute: async ({ signal }) => {
      signals.push(signal)
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    } })
    await scheduler.notify()
    await until(() => signals.length === 1)
    await derived(project, 1)
    await scheduler.notify()
    assert.equal(signals[0].aborted, false)
    assert.equal(signals.length, 1)
    await project.savePanel({ skill: 'smart_questions', state: { questions: { goal: { prompt: 'Goal', kind: 'text', answer: 'new' } } }, eventId: 'source' })
    await scheduler.notify()
    assert.equal(signals[0].aborted, true)
    await until(() => signals.length === 2)
    wrapped.kit.version = '2.0'
    await scheduler.notify()
    assert.equal(signals[1].aborted, true)
    assert.deepEqual(errors, [])
  } finally { await scheduler?.close(); await f.close() }
})

test('Companion preserves completed review and clarity currency after a derived-only commit', async () => {
  const f = await fixture()
  try {
    const project = f.server.project
    await project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'initial' })
    const api = createCompanionReviews({ project, stateRoot: f.options.stateRoot, threadId, managedExecution: true })
    const results = {
      grounding: { schemaVersion: 1, inconsistencies: [] },
      reflection: { schemaVersion: 1, researchNeeds: [] },
      alignment: { schemaVersion: 1, questions: [] },
      clarity: { summary: 'No answered requirements', u: { score: 0, evidence: 'No answers' }, s: { score: 0, evidence: 'No structure' }, t: { score: 0, evidence: 'No criteria' } },
    }
    for (const [profile, result] of Object.entries(results)) {
      const r = await api.claimManagedReview({ profile, ownerId: 'test' })
      await api.finishManagedReview({ reviewId: r.reviewId, ownerId: r.execution.ownerId, attemptId: r.execution.attemptId, result })
    }
    assert.equal((await api.readReviewStatus()).filter(r => r.needsReview).length, 0)
    const sources = ['smart_questions/smart_questions.json']
    const draft = await operateExperience(project.store, { action: 'prepare', id: 'example', sources })
    await operateExperience(project.store, { action: 'write', id: 'example', version: draft.version, artifactId: 'view', content: '<html><body>Derived example</body></html>' })
    await operateExperience(project.store, { action: 'publish', id: 'example', version: draft.version, title: 'Example', purpose: 'Characterize currency', sections: [{ id: 'view', title: 'Example', sources, assumptions: ['Demo only'] }] })
    const due = (await api.readReviewStatus()).filter(r => r.needsReview).map(r => r.profile)
    assert.deepEqual(due, [])
    assert.equal((await api.readClarity()).needsReassessment, false)
    for (const profile of Object.keys(results)) assert.equal(await api.claimManagedReview({ profile, ownerId: 'test' }), null)
    assert.equal(f.messages.length, 0, 'No foreground notification or actual executor is launched by this test')
  } finally { await f.close() }
})
