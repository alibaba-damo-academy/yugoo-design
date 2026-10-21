import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AcceptedAssertionCheckpointMismatchError,
  AcceptedAssertionLockTimeoutError,
  AcceptedAssertionRepository,
  AcceptedAssertionStaleRevisionError,
} from '../packages/core/src/accepted-assertions.ts'
import {
  groundAssertionCandidateDigest,
  groundAssertionClaimDigest,
  parseGroundAssertionCandidate,
  verifyTrustedGroundAuthorityEvent,
} from '../packages/core/src/ground-assertions.ts'

const source = { kind: 'session_event', id: 'fixture-source-event', revision: 'fixture-source-revision' }
const producedBy = { kind: 'grounding_result', resultId: 'fixture-result', runId: 'fixture-run', revision: 'fixture-result-revision' }
const candidate = (overrides = {}) => ({
  schemaVersion: 1,
  id: 'ground:fixture-mode',
  kind: 'decision',
  claim: {
    subject: 'fixture:account',
    predicate: 'mode',
    value: 'organization',
    summary: 'The fixture account uses organization mode.',
  },
  sources: [source],
  producedBy,
  productAnchors: ['fixture:account'],
  projection: { path: '/account/mode' },
  supersedes: [],
  ...overrides,
})
const secondCandidate = (overrides = {}) => candidate({
  id: 'ground:fixture-mode-2',
  claim: {
    subject: 'fixture:account',
    predicate: 'mode',
    value: 'personal',
    summary: 'The fixture account uses personal mode.',
  },
  supersedes: ['ground:fixture-mode'],
  ...overrides,
})
const otherCandidate = (overrides = {}) => candidate({
  id: 'ground:fixture-retention',
  claim: {
    subject: 'fixture:retention',
    predicate: 'window-days',
    value: 90,
    summary: 'The fixture retention window is ninety days.',
  },
  productAnchors: ['fixture:retention'],
  projection: { path: '/retention/windowDays' },
  ...overrides,
})
const authorityEvent = (parsed, overrides = {}) => ({
  kind: 'user_decision_event',
  eventId: 'fixture-decision-event',
  eventRevision: 'fixture-event-revision',
  candidateDigest: groundAssertionCandidateDigest(parsed),
  claimDigest: groundAssertionClaimDigest(parsed.claim),
  decision: 'confirmed',
  ...overrides,
})
const promotionDisposition = (parsed, overrides = {}) => ({
  decision: 'accepted',
  candidateDigest: groundAssertionCandidateDigest(parsed),
  claimDigest: groundAssertionClaimDigest(parsed.claim),
  ...overrides,
})
const pin = (expectedRevision, checkpoint = 'fixture-checkpoint-1', overrides = {}) => ({
  inputProject: 'fixture-project',
  observedProject: 'fixture-project',
  inputCheckpoint: checkpoint,
  observedCheckpoint: checkpoint,
  expectedRevision,
  ...overrides,
})

const root = await mkdtemp(join(tmpdir(), 'accepted-assertions-'))
try {
  const repository = new AcceptedAssertionRepository(root)
  const ledgerPath = join(root, 'accepted-assertions.jsonl')

  const empty = await repository.read()
  assert.equal(empty.revision, 0)
  assert.equal(empty.checkpoint, undefined)
  assert.deepEqual(empty.assertions, [])

  const retained = await repository.retainCandidate(parseGroundAssertionCandidate(otherCandidate()), 'proposed', pin(0))
  assert.equal(retained.revision, 1)
  assert.equal(retained.checkpoint, 'fixture-checkpoint-1')
  assert.equal(retained.records[0].kind, 'retention')
  assert.equal(retained.records[0].entries[0].origin, 'retained')
  assert.equal(retained.assertions[0].lifecycle, 'proposed')
  assert.equal(retained.assertions[0].authority, 'agent_proposed')

  const rejected = await repository.retainCandidate(parseGroundAssertionCandidate(otherCandidate({ id: 'ground:fixture-discarded' })), 'rejected', pin(1))
  assert.equal(rejected.revision, 2)
  assert.equal(rejected.assertions[1].lifecycle, 'rejected')

  const parsedFirst = parseGroundAssertionCandidate(candidate())
  const verifiedFirst = verifyTrustedGroundAuthorityEvent(parsedFirst, authorityEvent(parsedFirst))
  const accepted = await repository.acceptCandidate(parsedFirst, verifiedFirst, pin(2), promotionDisposition(parsedFirst))
  assert.equal(accepted.revision, 3)
  const acceptedAssertion = accepted.assertions.find((assertion) => assertion.id === 'ground:fixture-mode')
  assert.equal(acceptedAssertion.lifecycle, 'accepted')
  assert.equal(acceptedAssertion.authority, 'human_confirmed')
  assert.equal(accepted.records.at(-1).kind, 'promotion')
  assert.equal(accepted.records.at(-1).entries[0].origin, 'accepted')

  // Checkpoint CAS: a mismatched observed checkpoint fails loud with zero writes.
  await assert.rejects(
    repository.retainCandidate(parseGroundAssertionCandidate(otherCandidate({ id: 'ground:fixture-stale-checkpoint' })), 'proposed', pin(3, 'fixture-checkpoint-1', { observedCheckpoint: 'fixture-checkpoint-2' })),
    (error) => error instanceof AcceptedAssertionCheckpointMismatchError && error.inputCheckpoint === 'fixture-checkpoint-1' && error.observedCheckpoint === 'fixture-checkpoint-2',
  )
  assert.equal(await readFile(ledgerPath, 'utf8'), serializeRecords(accepted.records))
  assert.equal((await repository.read()).revision, 3)

  // Revision CAS: a stale expectedRevision fails loud even when checkpoints match.
  await assert.rejects(
    repository.retainCandidate(parseGroundAssertionCandidate(otherCandidate({ id: 'ground:fixture-stale-revision' })), 'proposed', pin(2)),
    (error) => error instanceof AcceptedAssertionStaleRevisionError && error.expected === 2 && error.actual === 3,
  )
  assert.equal((await repository.read()).revision, 3)

  // Atomic supersession: the replacement and the superseded mark land in one transaction.
  const parsedSecond = parseGroundAssertionCandidate(secondCandidate())
  const verifiedSecond = verifyTrustedGroundAuthorityEvent(parsedSecond, authorityEvent(parsedSecond, { eventId: 'fixture-decision-event-2' }))
  const supersededRead = await repository.acceptCandidate(parsedSecond, verifiedSecond, pin(3), promotionDisposition(parsedSecond))
  assert.equal(supersededRead.revision, 4)
  const supersession = supersededRead.records[3]
  assert.equal(supersession.kind, 'promotion')
  assert.equal(supersession.entries.length, 2)
  assert.equal(supersession.entries[0].assertion.id, 'ground:fixture-mode')
  assert.equal(supersession.entries[0].assertion.lifecycle, 'superseded')
  assert.equal(supersession.entries[1].assertion.id, 'ground:fixture-mode-2')
  assert.equal(supersededRead.assertions.find((assertion) => assertion.id === 'ground:fixture-mode').lifecycle, 'superseded')
  assert.equal(supersededRead.assertions.find((assertion) => assertion.id === 'ground:fixture-mode-2').lifecycle, 'accepted')

  // The durable file holds transaction revisions only: no addressable mid-state.
  const fileLines = (await readFile(ledgerPath, 'utf8')).trimEnd().split('\n')
  assert.equal(fileLines.length, 4)
  fileLines.forEach((line, index) => assert.equal(JSON.parse(line).revision, index + 1))
  assert.equal(JSON.parse(fileLines[3]).entries.length, 2)

  // readAt on both sides of the supersession transaction folds a fully valid set.
  const beforeSupersession = await repository.readAt(3)
  assert.equal(beforeSupersession.assertions.find((assertion) => assertion.id === 'ground:fixture-mode').lifecycle, 'accepted')
  assert.ok(beforeSupersession.assertions.every((assertion) => assertion.id !== 'ground:fixture-mode-2'))
  const atSupersession = await repository.readAt(4)
  assert.equal(atSupersession.assertions.find((assertion) => assertion.id === 'ground:fixture-mode').lifecycle, 'superseded')
  assert.equal(atSupersession.assertions.find((assertion) => assertion.id === 'ground:fixture-mode-2').lifecycle, 'accepted')
  await assert.rejects(repository.readAt(99), /was never committed/)
  await assert.rejects(repository.readAt(-1), /was never committed/)

  // Supersession targets must already be accepted.
  const parsedBadTarget = parseGroundAssertionCandidate(secondCandidate({ id: 'ground:fixture-mode-3', supersedes: ['ground:fixture-retention'] }))
  const verifiedBadTarget = verifyTrustedGroundAuthorityEvent(parsedBadTarget, authorityEvent(parsedBadTarget, { eventId: 'fixture-decision-event-3' }))
  await assert.rejects(repository.acceptCandidate(parsedBadTarget, verifiedBadTarget, pin(4), promotionDisposition(parsedBadTarget)), /not accepted/)
  assert.equal((await repository.read()).revision, 4)

  // Conflicting rewrite of an existing identity fails loud.
  await assert.rejects(
    repository.retainCandidate(parseGroundAssertionCandidate(otherCandidate({ claim: { subject: 'fixture:retention', predicate: 'window-days', value: 30, summary: 'Changed.' } })), 'proposed', pin(4)),
    /conflicting rewrite/,
  )
  // Illegal lifecycle transition fails loud: rejected is terminal.
  await assert.rejects(
    repository.retainCandidate(parseGroundAssertionCandidate(otherCandidate({ id: 'ground:fixture-discarded' })), 'rejected', pin(4)),
    /illegal lifecycle transition/,
  )
  assert.equal((await repository.read()).revision, 4)

  // Restart safety: a fresh instance over the same root folds identical state.
  const reopened = new AcceptedAssertionRepository(root)
  const reread = await reopened.read()
  assert.equal(reread.revision, 4)
  assert.deepEqual(reread.assertions, supersededRead.assertions)

  // Separate repository instances serialize on the project lock. Exactly one
  // expectedRevision=0 mutation commits; the loser rereads revision 1 and
  // fails stale without corrupting the ledger.
  const concurrentRoot = await mkdtemp(join(tmpdir(), 'accepted-assertions-concurrent-'))
  try {
    const first = new AcceptedAssertionRepository(concurrentRoot)
    const second = new AcceptedAssertionRepository(concurrentRoot)
    const concurrent = await Promise.allSettled([
      first.retainCandidate(parseGroundAssertionCandidate(otherCandidate({ id: 'ground:fixture-concurrent-a' })), 'proposed', pin(0, 'fixture-concurrent-checkpoint')),
      second.retainCandidate(parseGroundAssertionCandidate(otherCandidate({ id: 'ground:fixture-concurrent-b' })), 'proposed', pin(0, 'fixture-concurrent-checkpoint')),
    ])
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
    const rejectedConcurrent = concurrent.find((result) => result.status === 'rejected')
    assert.ok(rejectedConcurrent.reason instanceof AcceptedAssertionStaleRevisionError)
    assert.equal(rejectedConcurrent.reason.expected, 0)
    assert.equal(rejectedConcurrent.reason.actual, 1)
    const concurrentReopened = await new AcceptedAssertionRepository(concurrentRoot).read()
    assert.equal(concurrentReopened.revision, 1)
    assert.equal(concurrentReopened.records.length, 1)
    assert.equal((await readFile(join(concurrentRoot, 'accepted-assertions.jsonl'), 'utf8')).trimEnd().split('\n').length, 1)
    const afterStaleRelease = await new AcceptedAssertionRepository(concurrentRoot).retainCandidate(
      parseGroundAssertionCandidate(otherCandidate({ id: 'ground:fixture-concurrent-after-stale' })),
      'proposed',
      pin(1, 'fixture-concurrent-checkpoint'),
    )
    assert.equal(afterStaleRelease.revision, 2)
  } finally {
    await rm(concurrentRoot, { recursive: true, force: true })
  }

  // One parsed Grounding batch is one revision. Replaying the exact batch with
  // its original pin is a zero-write success; other stale or conflicting
  // batches still fail loud.
  const batchRoot = await mkdtemp(join(tmpdir(), 'accepted-assertions-batch-'))
  try {
    const batchRepository = new AcceptedAssertionRepository(batchRoot)
    const firstBatchCandidate = parseGroundAssertionCandidate(otherCandidate({
      id: 'ground:batch-a',
      producedBy: { ...producedBy, resultId: 'batch-result', runId: 'batch-run' },
    }))
    const secondBatchCandidate = parseGroundAssertionCandidate(otherCandidate({
      id: 'ground:batch-b',
      claim: { subject: 'fixture:batch-b', predicate: 'enabled', value: true, summary: 'Batch B is enabled.' },
      productAnchors: ['fixture:batch-b'],
      projection: { path: '/batchB/enabled' },
      producedBy: { ...producedBy, resultId: 'batch-result', runId: 'batch-run' },
    }))
    const batchPin = pin(0, 'fixture-batch-checkpoint')
    const retainedBatch = await batchRepository.retainCandidates([firstBatchCandidate, secondBatchCandidate], batchPin)
    assert.equal(retainedBatch.revision, 1)
    assert.equal(retainedBatch.records[0].entries.length, 2)
    assert.deepEqual(retainedBatch.assertions.map((assertion) => assertion.id), ['ground:batch-a', 'ground:batch-b'])
    assert.equal(retainedBatch.assertions[0].producedBy.runId, 'batch-run')
    assert.deepEqual(retainedBatch.assertions[0].sources, [source])
    const batchFile = join(batchRoot, 'accepted-assertions.jsonl')
    const committedText = await readFile(batchFile, 'utf8')
    const exactRetry = await batchRepository.retainCandidates([firstBatchCandidate, secondBatchCandidate], batchPin)
    assert.equal(exactRetry.revision, 1)
    assert.equal(await readFile(batchFile, 'utf8'), committedText)
    await assert.rejects(
      batchRepository.retainCandidates([firstBatchCandidate, secondBatchCandidate], pin(-1, 'fixture-batch-checkpoint')),
      /expectedRevision must be a non-negative safe integer/,
    )
    await assert.rejects(
      batchRepository.retainCandidates([firstBatchCandidate, secondBatchCandidate], pin(7, 'fixture-batch-checkpoint')),
      (error) => error instanceof AcceptedAssertionStaleRevisionError && error.expected === 7 && error.actual === 1,
    )
    await assert.rejects(
      batchRepository.retainCandidates([parseGroundAssertionCandidate(otherCandidate({ id: 'ground:batch-c' }))], batchPin),
      (error) => error instanceof AcceptedAssertionStaleRevisionError && error.expected === 0 && error.actual === 1,
    )
    await assert.rejects(batchRepository.retainCandidates([
      parseGroundAssertionCandidate(otherCandidate({
        id: 'ground:batch-a',
        claim: { subject: 'fixture:retention', predicate: 'window-days', value: 30, summary: 'Changed batch content.' },
        producedBy: { ...producedBy, resultId: 'batch-result', runId: 'batch-run' },
      })),
    ], pin(1, 'fixture-batch-checkpoint')), /conflicting rewrite/)
    assert.equal((await batchRepository.read()).revision, 1)
  } finally {
    await rm(batchRoot, { recursive: true, force: true })
  }

  // A torn unterminated final line is ignored on read and truncated before append.
  await writeFile(ledgerPath, `${await readFile(ledgerPath, 'utf8')}{"schemaVersion": 2, "revis`)
  const torn = await repository.read()
  assert.equal(torn.revision, 4)
  const afterTorn = await repository.retainCandidate(parseGroundAssertionCandidate(otherCandidate({ id: 'ground:fixture-after-torn' })), 'proposed', pin(4))
  assert.equal(afterTorn.revision, 5)
  assert.ok((await readFile(ledgerPath, 'utf8')).includes('ground:fixture-after-torn'))

  // A malformed complete line fails loud.
  const corruptRoot = await mkdtemp(join(tmpdir(), 'accepted-assertions-corrupt-'))
  try {
    await writeFile(join(corruptRoot, 'accepted-assertions.jsonl'), 'not-json\n')
    await assert.rejects(new AcceptedAssertionRepository(corruptRoot).read(), /malformed JSON on complete line 1/)
  } finally {
    await rm(corruptRoot, { recursive: true, force: true })
  }

  // A schema-1 record on disk fails loud: the pre-release ledger has no
  // compatibility path.
  const v1Root = await mkdtemp(join(tmpdir(), 'accepted-assertions-v1-'))
  try {
    const v1Line = JSON.stringify({ schemaVersion: 1, revision: 1, checkpoint: 'fixture-checkpoint-1', entries: [structuredClone(retained.records[0].entries[0])] })
    await writeFile(join(v1Root, 'accepted-assertions.jsonl'), `${v1Line}\n`)
    await assert.rejects(new AcceptedAssertionRepository(v1Root).read(), /invalid transaction on line 1/)
  } finally {
    await rm(v1Root, { recursive: true, force: true })
  }

  // A complete row whose origin contradicts its assertion state fails loud.
  const badOriginRoot = await mkdtemp(join(tmpdir(), 'accepted-assertions-origin-'))
  try {
    const badOriginRepository = new AcceptedAssertionRepository(badOriginRoot)
    await badOriginRepository.retainCandidate(parseGroundAssertionCandidate(otherCandidate({ id: 'ground:fixture-bad-origin' })), 'proposed', pin(0))
    const badOriginPath = join(badOriginRoot, 'accepted-assertions.jsonl')
    const badOriginRecord = JSON.parse((await readFile(badOriginPath, 'utf8')).trimEnd())
    badOriginRecord.entries[0].origin = 'accepted'
    await writeFile(badOriginPath, `${JSON.stringify(badOriginRecord)}\n`)
    await assert.rejects(new AcceptedAssertionRepository(badOriginRoot).read(), /invalid transaction on line 1/)
    const acceptedAsRetained = structuredClone(accepted.records[2])
    acceptedAsRetained.revision = 1
    acceptedAsRetained.entries[0].origin = 'retained'
    await writeFile(badOriginPath, `${JSON.stringify(acceptedAsRetained)}\n`)
    await assert.rejects(new AcceptedAssertionRepository(badOriginRoot).read(), /invalid transaction on line 1/)
  } finally {
    await rm(badOriginRoot, { recursive: true, force: true })
  }

  // File creation followed by interruption before the first byte is an empty
  // ledger, not a malformed complete line.
  const emptyRoot = await mkdtemp(join(tmpdir(), 'accepted-assertions-empty-'))
  try {
    await writeFile(join(emptyRoot, 'accepted-assertions.jsonl'), '')
    const emptyReopened = await new AcceptedAssertionRepository(emptyRoot).read()
    assert.equal(emptyReopened.revision, 0)
    assert.deepEqual(emptyReopened.assertions, [])
    const firstAfterEmpty = await new AcceptedAssertionRepository(emptyRoot).retainCandidate(
      parseGroundAssertionCandidate(otherCandidate({ id: 'ground:fixture-after-empty' })),
      'proposed',
      pin(0),
    )
    assert.equal(firstAfterEmpty.revision, 1)
  } finally {
    await rm(emptyRoot, { recursive: true, force: true })
  }

  // Locks are never stolen silently. An orphan remains inspectable and a
  // bounded wait fails explicitly until an operator removes it.
  const lockedRoot = await mkdtemp(join(tmpdir(), 'accepted-assertions-locked-'))
  try {
    await mkdir(join(lockedRoot, '.accepted-assertions.lock'))
    const locked = new AcceptedAssertionRepository(lockedRoot, { lockTimeoutMs: 20, lockRetryMs: 5 })
    await assert.rejects(
      locked.retainCandidate(parseGroundAssertionCandidate(otherCandidate({ id: 'ground:fixture-lock-timeout' })), 'proposed', pin(0)),
      (error) => error instanceof AcceptedAssertionLockTimeoutError && error.timeoutMs === 20,
    )
  } finally {
    await rm(lockedRoot, { recursive: true, force: true })
  }

  // A non-sequential on-disk revision fails loud.
  const gapRoot = await mkdtemp(join(tmpdir(), 'accepted-assertions-gap-'))
  try {
    const firstLine = JSON.stringify({ ...afterTorn.records[0], revision: 2 })
    await writeFile(join(gapRoot, 'accepted-assertions.jsonl'), `${firstLine}\n`)
    await assert.rejects(new AcceptedAssertionRepository(gapRoot).read(), /invalid transaction on line 1/)
  } finally {
    await rm(gapRoot, { recursive: true, force: true })
  }

  console.log('accepted-assertions smoke ok')
} finally {
  await rm(root, { recursive: true, force: true })
}

function serializeRecords(records) {
  return records.map((record) => `${JSON.stringify(record)}\n`).join('')
}
