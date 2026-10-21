/** Project/Git persistence with explicit synthetic review binding; no native Host. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, cp, readFile, symlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { DesignProjectManager, GitVersioning, nodeDesignProjectSpawn, DesignJournalStorage, DesignAdvisoryJournal } from '../../core/lib/index.js'
import { createCompanionReviews } from '../src/reviews.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'advisory-records-')); t.after(() => rm(root, { recursive: true, force: true }))
  const opened = await new DesignProjectManager().create({ root: join(root, 'project'), name: 'Advice files', knowledge: { provider: 'ladybug-wasm' } })
  const project = at => {
    const store = new GitVersioning(nodeDesignProjectSpawn, at, 'design_files')
    store.sameDesignEvidenceAt = async (a,b) => await store.designEvidenceRevisionAt(a) === await store.designEvidenceRevisionAt(b)
    return { project: { ...opened, root: at, designFilesRoot: join(at, 'design_files') }, store,
      kit: { name: 'fixture', version: '1.0', skills: [{ name: 'facts', version: '1.0' }] },
      async readWorkspace() { return { checkpoint: await store.head(), evidenceWorktreeRevision: await store.designEvidenceRevisionAt(await store.head()) } },
      mutateAssessment: operation => operation(), sendPrompt: async () => { throw new Error('No native transport in fixture') } }
  }
  const first = project(opened.root), threadId = randomUUID()
  return { root, first, project, threadId, reviews: createCompanionReviews({ project: first, stateRoot: join(root, 'machine-one'), threadId }) }
}

test('GRA suggestions and decisions are tracked and survive project copy without copying native requests', async t => {
  const f = await fixture(t), before = await f.first.store.head()
  const request = await f.reviews.prepareReview({ profile: 'alignment' })
  const nativeRun = { runId: randomUUID(), parentRunId: f.threadId, transcriptPath: join(f.root, 'synthetic-child.jsonl') }
  await f.reviews.bindReviewRun({ reviewId: request.reviewId, nativeRun })
  const result = await f.reviews.submitReview({ reviewId: request.reviewId, nativeRun, result: { schemaVersion: 1, questions: [{ id: 'audience', facets: ['facts'],
    decision: 'Personal or team scope', question: 'Who shares this notebook?', rationale: 'The saved scope is ambiguous', impact: 'Access rights differ' }] } })
  assert.equal(result.status, 'completed')
  const entries = await f.reviews.listAdvisories()
  assert.equal(entries.length, 1)
  await f.reviews.decideAdvisory({ advisoryId: entries[0].advisory.id, decision: 'rejected' })
  const git = new GitVersioning(nodeDesignProjectSpawn, f.first.project.root)
  const paths = await git.listPathsAt(await git.head())
  const record = paths.find(path => path.startsWith('design_records/reviews/') && path.endsWith('.jsonl'))
  assert.ok(record)
  assert.equal(await f.first.store.sameDesignEvidenceAt(before, await git.head()), true)
  const bytes = await readFile(join(f.first.project.root, record), 'utf8')
  assert.match(bytes, /Who shares this notebook/); assert.match(bytes, /rejected/)
  assert.equal(bytes.includes(nativeRun.runId), false)
  assert.equal(paths.some(path => /review.lock|reviews-.*\.json|native-project/.test(path)), false)
  const copy = join(f.root, 'copy'); await cp(f.first.project.root, copy, { recursive: true })
  const other = createCompanionReviews({ project: f.project(copy), stateRoot: join(f.root, 'machine-two'), threadId: randomUUID() })
  const restored = await other.listAdvisories()
  assert.deepEqual(restored, [], 'rejected advice remains durably stored but is not an active suggestion')
  const journal = new DesignAdvisoryJournal(new DesignJournalStorage(join(copy, 'design_records/reviews')))
  const history = await journal.list(`project:${f.first.project.metadata.id}`)
  assert.equal(history[0].status, 'rejected')
  assert.equal(history[0].advisory.id, entries[0].advisory.id)
  assert.ok((await other.readReviewStatus()).every(item => item.status === 'due'), 'copying durable suggestions never restores native running state')
  await assert.rejects(other.readReview({ reviewId: request.reviewId }), /Unknown review/)
})

test('project record symlinks fail before a review writes outside the project', async t => {
  const f = await fixture(t), outside = join(f.root, 'outside')
  await mkdir(outside)
  await symlink(outside, join(f.first.project.root, 'design_records'))
  await assert.rejects(f.reviews.prepareReview({ profile: 'alignment' }), /symbolic link/)
  await assert.rejects(readFile(join(outside, 'clarity.json')), { code: 'ENOENT' })
})
