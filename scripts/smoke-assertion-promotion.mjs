import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AcceptedAssertionCheckpointMismatchError,
  AcceptedAssertionProjectMismatchError,
  AcceptedAssertionRepository,
  AcceptedAssertionStaleRevisionError,
} from '../packages/core/src/accepted-assertions.ts'
import {
  groundAssertionCandidateDigest,
  groundAssertionClaimDigest,
  verifyTrustedGroundAuthorityEvent,
} from '../packages/core/src/ground-assertions.ts'
import {
  GroundingPinMismatchError,
  compileKitGrounding,
  parseKitGroundingDeclaration,
  projectBundleGroundCandidates,
  requireGroundingPinMatch,
} from '../packages/core/src/kit-grounding-mapping.ts'
import { DesignBundleVersion, DesignKitVersion } from '../packages/core/src/types.ts'

const kitVersion = DesignKitVersion('1.0')
const bundleVersion = DesignBundleVersion('1.0')
const kit = {
  name: 'fixture_kit',
  version: kitVersion,
  mindset: '# Fixture',
  skills: [{ name: 'page-prd', version: bundleVersion, description: 'Fixture', content: '', execution: { handoff: 'none' } }],
  resources: {},
}
const compiled = compileKitGrounding(kit, parseKitGroundingDeclaration({
  schemaVersion: 1,
  bundles: {
    'page-prd': {
      entities: [{ id: 'page', subject: '/page/id' }],
      assertions: [{ id: 'page-title', kind: 'fact', subjectEntity: 'page', predicate: 'title', valuePath: '/page/title', summary: 'The page title.' }],
    },
  },
}))
const source = { kind: 'design_file', id: 'fixture:page-prd', revision: 'fixture-design-revision' }
const producedBy = { kind: 'grounding_result', resultId: 'fixture-result', runId: 'fixture-run', revision: 'fixture-result-revision' }

function projected(recordId, pageId, title) {
  return projectBundleGroundCandidates(compiled, 'page-prd', {
    recordId,
    record: { page: { id: pageId, title } },
    source,
    producedBy,
  }).assertions[0]
}

function provenance(value, overrides = {}) {
  return {
    kit: value.kit,
    kitVersion: value.kitVersion,
    bundle: value.bundle,
    bundleVersion: value.bundleVersion,
    mappingRevision: value.mappingRevision,
    mappingId: value.mappingId,
    recordId: value.recordId,
    ...overrides,
  }
}

function disposition(candidate, decision = 'accepted', overrides = {}) {
  return {
    decision,
    candidateDigest: groundAssertionCandidateDigest(candidate),
    claimDigest: groundAssertionClaimDigest(candidate.claim),
    ...(decision === 'rejected' ? { rejectionReason: 'The user rejected this candidate.' } : {}),
    ...overrides,
  }
}

function pin(expectedRevision, overrides = {}) {
  return {
    inputProject: 'fixture-project',
    observedProject: 'fixture-project',
    inputCheckpoint: 'fixture-checkpoint',
    observedCheckpoint: 'fixture-checkpoint',
    expectedRevision,
    ...overrides,
  }
}

function humanEvidence(candidate, eventId) {
  return verifyTrustedGroundAuthorityEvent(candidate, {
    kind: 'user_decision_event',
    eventId,
    eventRevision: `${eventId}-revision`,
    candidateDigest: groundAssertionCandidateDigest(candidate),
    claimDigest: groundAssertionClaimDigest(candidate.claim),
    decision: 'confirmed',
  })
}

async function rejectsWithoutWrite(repository, ledgerPath, operation, predicate) {
  const before = await readFile(ledgerPath, 'utf8')
  const revision = (await repository.read()).revision
  await assert.rejects(operation(), predicate)
  assert.equal(await readFile(ledgerPath, 'utf8'), before)
  assert.equal((await repository.read()).revision, revision)
}

const root = await mkdtemp(join(tmpdir(), 'assertion-promotion-'))
try {
  const repository = new AcceptedAssertionRepository(root)
  const ledgerPath = join(root, 'accepted-assertions.jsonl')
  const first = projected('record:first', 'page:home', 'Home')
  const firstMapping = provenance(first)
  requireGroundingPinMatch(compiled, firstMapping)

  const retained = await repository.retainCandidate(first.candidate, 'proposed', pin(0))
  assert.equal(retained.revision, 1)
  assert.equal(retained.project, 'fixture-project')
  assert.equal(retained.records[0].schemaVersion, 3)
  assert.equal(retained.records[0].kind, 'retention')
  assert.equal('disposition' in retained.records[0], false)

  const firstDisposition = disposition(first.candidate, 'accepted', { mapping: firstMapping })
  const accepted = await repository.acceptCandidate(first.candidate, humanEvidence(first.candidate, 'decision:first'), pin(1), firstDisposition, compiled)
  assert.equal(accepted.revision, 2)
  const acceptedRecord = accepted.records[1]
  assert.equal(acceptedRecord.kind, 'promotion')
  assert.equal(acceptedRecord.entries.length, 1)
  assert.equal(acceptedRecord.entries[0].origin, 'accepted')
  assert.equal(acceptedRecord.entries[0].assertion.lifecycle, 'accepted')
  assert.deepEqual(acceptedRecord.disposition, firstDisposition)
  const durableLines = (await readFile(ledgerPath, 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line))
  assert.equal(durableLines.length, 2)
  assert.equal(durableLines[1].entries.length, 1)
  assert.deepEqual(durableLines[1].disposition, firstDisposition)
  assert.equal((await repository.readAt(1)).assertions[0].lifecycle, 'proposed')
  assert.equal((await repository.readAt(2)).assertions[0].lifecycle, 'accepted')

  const second = projected('record:second', 'page:pricing', 'Pricing')
  await repository.retainCandidate(second.candidate, 'proposed', pin(2))
  const rejectedDisposition = disposition(second.candidate, 'rejected', { mapping: provenance(second) })
  const rejected = await repository.rejectCandidate(second.candidate, pin(3), rejectedDisposition, compiled)
  assert.equal(rejected.revision, 4)
  const rejectedRecord = rejected.records[3]
  assert.equal(rejectedRecord.kind, 'promotion')
  assert.equal(rejectedRecord.entries.length, 1)
  assert.equal(rejectedRecord.entries[0].origin, 'rejected')
  assert.equal(rejectedRecord.entries[0].assertion.lifecycle, 'rejected')
  assert.deepEqual(rejectedRecord.disposition, rejectedDisposition)

  const third = projected('record:third', 'page:about', 'About')
  const thirdEvidence = humanEvidence(third.candidate, 'decision:third')
  const thirdDisposition = disposition(third.candidate, 'accepted', { mapping: provenance(third) })

  await rejectsWithoutWrite(
    repository,
    ledgerPath,
    () => repository.acceptCandidate(third.candidate, thirdEvidence, pin(4, { observedProject: 'other-project' }), thirdDisposition, compiled),
    (error) => error instanceof AcceptedAssertionProjectMismatchError,
  )
  await rejectsWithoutWrite(
    repository,
    ledgerPath,
    () => repository.acceptCandidate(third.candidate, thirdEvidence, pin(4, { inputProject: 'other-project', observedProject: 'other-project' }), thirdDisposition, compiled),
    (error) => error instanceof AcceptedAssertionProjectMismatchError && error.observedProject === 'fixture-project',
  )
  await rejectsWithoutWrite(
    repository,
    ledgerPath,
    () => repository.acceptCandidate(third.candidate, thirdEvidence, pin(4, { observedCheckpoint: 'other-checkpoint' }), thirdDisposition, compiled),
    (error) => error instanceof AcceptedAssertionCheckpointMismatchError,
  )
  await rejectsWithoutWrite(
    repository,
    ledgerPath,
    () => repository.acceptCandidate(third.candidate, thirdEvidence, pin(3), thirdDisposition, compiled),
    (error) => error instanceof AcceptedAssertionStaleRevisionError && error.actual === 4,
  )
  await rejectsWithoutWrite(
    repository,
    ledgerPath,
    () => repository.acceptCandidate(third.candidate, thirdEvidence, pin(4), { ...thirdDisposition, candidateDigest: '0'.repeat(64) }, compiled),
    /does not bind the decided candidate/,
  )
  await rejectsWithoutWrite(
    repository,
    ledgerPath,
    () => repository.acceptCandidate(third.candidate, thirdEvidence, pin(4), { ...thirdDisposition, claimDigest: '0'.repeat(64) }, compiled),
    /does not bind the decided claim/,
  )
  await rejectsWithoutWrite(
    repository,
    ledgerPath,
    () => repository.acceptCandidate(third.candidate, thirdEvidence, pin(4), thirdDisposition),
    /current compiled Kit grounding is required/,
  )
  await rejectsWithoutWrite(
    repository,
    ledgerPath,
    () => repository.acceptCandidate(third.candidate, thirdEvidence, pin(4), {
      ...thirdDisposition,
      mapping: { ...thirdDisposition.mapping, mappingRevision: 'f'.repeat(64) },
    }, compiled),
    (error) => error instanceof GroundingPinMismatchError && error.field === 'mappingRevision',
  )
  await rejectsWithoutWrite(
    repository,
    ledgerPath,
    () => repository.acceptCandidate(third.candidate, thirdEvidence, pin(4), {
      ...thirdDisposition,
      mapping: { ...thirdDisposition.mapping, mappingId: 'missing-mapping' },
    }, compiled),
    (error) => error instanceof GroundingPinMismatchError && error.field === 'mappingId',
  )

  // Mapping provenance is optional for a candidate that did not originate
  // through G2; the disposition and assertion still land atomically.
  const optionalMappingDisposition = disposition(third.candidate)
  const acceptedWithoutMapping = await repository.acceptCandidate(third.candidate, thirdEvidence, pin(4), optionalMappingDisposition)
  assert.equal(acceptedWithoutMapping.revision, 5)
  assert.equal(acceptedWithoutMapping.records[4].kind, 'promotion')
  assert.equal(acceptedWithoutMapping.records[4].disposition.mapping, undefined)

  const reopened = await new AcceptedAssertionRepository(root).read()
  assert.equal(reopened.revision, 5)
  assert.equal(reopened.project, 'fixture-project')
  assert.deepEqual(reopened.records, acceptedWithoutMapping.records)

  // Promotion rows are indivisible and strict: a missing disposition or a
  // digest that does not bind the decided assertion fails on restart.
  const corruptRoot = await mkdtemp(join(tmpdir(), 'assertion-promotion-corrupt-'))
  try {
    const missingDisposition = structuredClone(acceptedRecord)
    missingDisposition.revision = 1
    delete missingDisposition.disposition
    await writeFile(join(corruptRoot, 'accepted-assertions.jsonl'), `${JSON.stringify(missingDisposition)}\n`)
    await assert.rejects(new AcceptedAssertionRepository(corruptRoot).read(), /invalid transaction on line 1/)
    const badDigest = structuredClone(acceptedRecord)
    badDigest.revision = 1
    badDigest.disposition.candidateDigest = '0'.repeat(64)
    await writeFile(join(corruptRoot, 'accepted-assertions.jsonl'), `${JSON.stringify(badDigest)}\n`)
    await assert.rejects(new AcceptedAssertionRepository(corruptRoot).read(), /invalid transaction on line 1/)
  } finally {
    await rm(corruptRoot, { recursive: true, force: true })
  }

  assert.throws(
    () => requireGroundingPinMatch(compiled, { ...firstMapping, bundleVersion: DesignBundleVersion('2.0') }),
    (error) => error instanceof GroundingPinMismatchError && error.field === 'bundleVersion',
  )
  console.log('assertion-promotion smoke ok')
} finally {
  await rm(root, { recursive: true, force: true })
}
