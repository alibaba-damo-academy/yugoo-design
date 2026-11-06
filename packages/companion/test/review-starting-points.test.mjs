/** Real preparation/persistence against a tiny pinned evidence adapter; no Host/model. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeDesignReviewPolicy, designProjectRecordsRoot } from '../../core/lib/index.js'
import { createCompanionReviews } from '../src/reviews.mjs'

test('prepared depth and starting points use existing pinned evidence and survive replay', async t => {
  const root = await mkdtemp(join(tmpdir(), 'review-starting-points-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const checkpoint = 'a'.repeat(40), future = 'b'.repeat(40)
  let latest = { skill: 'changed', commit: checkpoint }
  const lists = []
  const project = {
    project: { root, metadata: { id: '00000000-0000-4000-8000-000000000002' } },
    kit: { name: 'fixture', version: '1.0', skills: [{ name: 'changed' }, { name: 'related' }] },
    readWorkspace: async () => ({ checkpoint, worktreeRevision: 'pinned-worktree' }),
    readDesignJournal: async () => ({ snapshot: { latestDesignChange: latest } }),
    store: {
      designEvidenceRevisionAt: async value => value,
      sameDesignEvidenceAt: async (a, b) => a === b,
      listPathsAt: async value => { lists.push(value); return ['changed/changed.json', 'related/related.json', '_experiences/demo.json'] },
    },
  }
  const records = join(designProjectRecordsRoot(root), 'reviews')
  await writeDesignReviewPolicy(records, { mode: 'off', depth: 'light', autoMergeWindowMs: 30000 }, root)
  const reviews = createCompanionReviews({ project, stateRoot: join(root, 'runtime'), threadId: '00000000-0000-4000-8000-000000000001' })
  const first = await reviews.prepareReview({ profile: 'alignment', manualRequestId: 'light-request',
    activeWork: [{ skill: 'related' }, { skill: 'missing' }] })
  assert.equal(first.depth, 'light')
  assert.ok(first.input.pins.some(pin => pin.source === 'review-depth' && pin.revision === 'light'))
  const startingLine = first.prompt.split('\n').find(line => line.startsWith('Priority investigation starting points'))
  assert.match(startingLine, /design_files\/changed\/changed.json/)
  assert.match(startingLine, /design_files\/related\/related.json/)
  assert.doesNotMatch(startingLine, /missing|_experiences/)
  assert.deepEqual(lists, [checkpoint])
  await writeDesignReviewPolicy(records, { mode: 'off', depth: 'thorough', autoMergeWindowMs: 30000 }, root)
  latest = { skill: 'related', commit: future }
  const replay = await reviews.prepareReview({ profile: 'alignment', manualRequestId: 'light-request' })
  assert.equal(replay.reviewId, first.reviewId)
  assert.equal(replay.depth, 'light')
  assert.equal(replay.prompt, first.prompt)
  const next = await reviews.prepareReview({ profile: 'alignment', manualRequestId: 'thorough-request' })
  assert.equal(next.depth, 'thorough')
  assert.doesNotMatch(next.prompt, /Priority investigation starting points/, 'a newer live journal change cannot describe this older pinned snapshot')
  assert.match(next.prompt, /known consequential risk beyond/)
  assert.deepEqual(lists, [checkpoint], 'absent valid focus does not scan files for a replacement target')
  project.readDesignJournal = async () => { throw new Error('Optional starting locator unavailable') }
  const unavailable = await reviews.prepareReview({ profile: 'alignment', manualRequestId: 'no-locator-request' })
  assert.doesNotMatch(unavailable.prompt, /Priority investigation starting points/)
  assert.match(unavailable.prompt, /known consequential risk beyond/)
  const assessment = await reviews.prepareReview({ profile: 'clarity' })
  // Legacy observed-work identity for this fixed evidence revision and empty context.
  assert.equal(assessment.requestKey, 'a1d1b7363d7f748bcbee5a7aed750580088e99a5a2e4233c05b0571b2df5c884')
  assert.equal(assessment.depth, undefined)
  assert.doesNotMatch(assessment.prompt, /User-selected review depth|Priority investigation starting points/)
  await writeDesignReviewPolicy(records, { mode: 'off', depth: 'light', autoMergeWindowMs: 30000 }, root)
  const reopened = createCompanionReviews({ project, stateRoot: join(root, 'runtime'), threadId: '00000000-0000-4000-8000-000000000001' })
  const sameAssessment = await reopened.prepareReview({ profile: 'clarity' })
  assert.equal(sameAssessment.reviewId, assessment.reviewId, 'changing GRA depth cannot invalidate an unchanged Clarity request after reopen')
})
