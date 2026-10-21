import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AcceptedAssertionRepository } from '../packages/core/src/accepted-assertions.ts'
import {
  groundAssertionCandidateDigest,
  groundAssertionClaimDigest,
  parseGroundAssertionCandidate,
  verifyTrustedGroundAuthorityEvent,
} from '../packages/core/src/ground-assertions.ts'
import {
  GroundingPinMismatchError,
  compileKitGrounding,
  parseKitGroundingDeclaration,
  projectBundleGroundCandidates,
} from '../packages/core/src/kit-grounding-mapping.ts'
import { projectDesignGraph } from '../packages/core/src/design-graph-projection.ts'
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
      entities: [
        { id: 'page', subject: '/page/id' },
        { id: 'component', subject: '/component/id' },
      ],
      assertions: [{ id: 'page-title', kind: 'fact', subjectEntity: 'page', predicate: 'title', valuePath: '/page/title', summary: 'The page title.' }],
      relationships: [{ id: 'page-supports-component', relation: 'supports', fromEntity: 'page', to: { entity: 'component' } }],
    },
  },
}))
const source = { kind: 'design_file', id: 'fixture:page-prd', revision: 'fixture-design-revision' }
const producedBy = { kind: 'grounding_result', resultId: 'fixture-result', runId: 'fixture-run', revision: 'fixture-result-revision' }

function projected(recordId, pageId, title, componentId) {
  return projectBundleGroundCandidates(compiled, 'page-prd', {
    recordId,
    record: { page: { id: pageId, title }, component: { id: componentId } },
    source,
    producedBy,
  })
}

function provenance(candidate) {
  return {
    kit: candidate.kit,
    kitVersion: candidate.kitVersion,
    bundle: candidate.bundle,
    bundleVersion: candidate.bundleVersion,
    mappingRevision: candidate.mappingRevision,
    mappingId: candidate.mappingId,
    recordId: candidate.recordId,
  }
}

function disposition(candidate, overrides = {}) {
  return {
    decision: 'accepted',
    candidateDigest: groundAssertionCandidateDigest(candidate),
    claimDigest: groundAssertionClaimDigest(candidate.claim),
    ...overrides,
  }
}

function pin(expectedRevision) {
  return {
    inputProject: 'fixture-project',
    observedProject: 'fixture-project',
    inputCheckpoint: 'fixture-checkpoint',
    observedCheckpoint: 'fixture-checkpoint',
    expectedRevision: expectedRevision,
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

const root = await mkdtemp(join(tmpdir(), 'design-graph-projection-'))
try {
  const repository = new AcceptedAssertionRepository(root)

  const firstProjection = projected('record:first', 'page:home', 'Home', 'component:nav')
  const first = firstProjection.assertions[0]
  const firstCandidate = first.candidate
  const relationship = firstProjection.relationships[0]
  await repository.retainCandidate(firstCandidate, 'proposed', pin(0))
  await repository.acceptCandidate(firstCandidate, humanEvidence(firstCandidate, 'decision:first'), pin(1), disposition(firstCandidate, { mapping: provenance(first) }), compiled)

  const secondCandidate = projected('record:second', 'page:pricing', 'Pricing', 'component:nav').assertions[0].candidate
  await repository.retainCandidate(secondCandidate, 'proposed', pin(2))
  await repository.acceptCandidate(secondCandidate, humanEvidence(secondCandidate, 'decision:second'), pin(3), disposition(secondCandidate), compiled)

  const thirdCandidate = projected('record:third', 'page:discarded', 'Discarded', 'component:nav').assertions[0].candidate
  await repository.retainCandidate(thirdCandidate, 'rejected', pin(4))

  const supersedingRaw = projected('record:fourth', 'page:pricing', 'Pricing v2', 'component:nav').assertions[0].candidate
  const supersedingCandidate = parseGroundAssertionCandidate({ ...supersedingRaw, supersedes: [secondCandidate.id] })
  await repository.retainCandidate(supersedingCandidate, 'proposed', pin(5))
  await repository.acceptCandidate(supersedingCandidate, humanEvidence(supersedingCandidate, 'decision:fourth'), pin(6), disposition(supersedingCandidate), compiled)

  const read = await repository.read()
  const input = {
    project: 'fixture-project',
    assertionRevision: read.revision,
    checkpoint: read.checkpoint,
    assertions: read.assertions,
    records: read.records,
    relationships: [relationship],
    grounding: compiled,
  }
  const graph = projectDesignGraph(input)

  // Lifecycle gate: only the two live accepted assertions become rationale
  // nodes; the rejected and the superseded assertion are skipped.
  assert.equal(graph.skippedAssertions, 2)
  const rationaleNodes = graph.nodes.filter((node) => node.domain === 'rationale')
  assert.deepEqual(rationaleNodes.map((node) => node.id).sort(), [firstCandidate.id, supersedingCandidate.id].sort())
  const productNodes = graph.nodes.filter((node) => node.domain === 'product')
  assert.deepEqual(productNodes.map((node) => node.subject).sort(), ['component:nav', 'page:home', 'page:pricing'].sort())
  productNodes.forEach((node) => assert.ok(node.id.startsWith('node:graph.product.')))
  productNodes.forEach((node) => {
    assert.deepEqual(node.producedBy, producedBy)
    assert.ok(node.sources.length >= 1)
    assert.deepEqual(node.sources[0], source)
  })

  // Rationale provenance: the mapping-pinned acceptance retains its exact
  // promotion identity and persisted Kit/G2 pins; the mapping-less acceptance
  // keeps its promotion identity without inventing pins.
  const pinnedNode = rationaleNodes.find((node) => node.id === firstCandidate.id)
  assert.equal(pinnedNode.promotion.revision, 2)
  assert.equal(pinnedNode.promotion.candidateDigest, groundAssertionCandidateDigest(firstCandidate))
  assert.equal(pinnedNode.promotion.claimDigest, groundAssertionClaimDigest(firstCandidate.claim))
  assert.deepEqual(pinnedNode.promotion.mapping, provenance(first))
  const mappingLessNode = rationaleNodes.find((node) => node.id === supersedingCandidate.id)
  assert.equal(mappingLessNode.promotion.revision, 7)
  assert.equal(mappingLessNode.promotion.mapping, undefined)

  // Exactly one edge per relationship candidate with complete provenance.
  assert.equal(graph.edges.length, 1)
  const edge = graph.edges[0]
  assert.equal(edge.id, relationship.id)
  assert.equal(edge.relation, 'supports')
  assert.equal(edge.from, 'page:home')
  assert.equal(edge.to, 'component:nav')
  assert.equal(edge.mappingId, 'page-supports-component')
  assert.equal(edge.kitVersion, compiled.kitVersion)
  assert.equal(edge.bundleVersion, compiled.bundles['page-prd'].bundleVersion)
  assert.equal(edge.mappingRevision, compiled.mappingRevision)

  // Determinism: repeated and permuted inputs rebuild the identical graph.
  const permuted = projectDesignGraph({
    ...input,
    assertions: [...input.assertions].reverse(),
    records: [...input.records].reverse(),
    relationships: [...input.relationships],
  })
  assert.equal(permuted.graphRevision, graph.graphRevision)
  assert.deepEqual(permuted.nodes, graph.nodes)
  assert.deepEqual(permuted.edges, graph.edges)
  assert.ok(/^[a-f0-9]{64}$/.test(graph.graphRevision))

  // The revision digest binds project, ledger pins, and content.
  for (const variant of [
    { ...input, project: 'other-project' },
    { ...input, assertionRevision: read.revision + 1 },
    { ...input, checkpoint: 'other-checkpoint' },
    { ...input, relationships: [] },
  ]) {
    assert.notEqual(projectDesignGraph(variant).graphRevision, graph.graphRevision)
  }

  // Edge pin checks fail loud on every stale provenance field.
  for (const [overrides, field] of [
    [{ kit: 'other_kit' }, 'kit'],
    [{ kitVersion: DesignKitVersion('2.0') }, 'kitVersion'],
    [{ bundle: 'missing-bundle' }, 'bundle'],
    [{ bundleVersion: DesignBundleVersion('2.0') }, 'bundleVersion'],
    [{ mappingRevision: 'f'.repeat(64) }, 'mappingRevision'],
    [{ mappingId: 'missing-mapping' }, 'mappingId'],
  ]) {
    assert.throws(
      () => projectDesignGraph({ ...input, relationships: [{ ...relationship, ...overrides }] }),
      (error) => error instanceof GroundingPinMismatchError && error.field === field,
    )
  }
  assert.throws(
    () => projectDesignGraph({ ...input, relationships: [relationship, relationship] }),
    /duplicate relationship identity/,
  )

  // Contradictory persisted promotion pins fail loud before any node lands.
  const staleRecords = read.records.map((record) => {
    if (record.kind !== 'promotion' || record.disposition.mapping === undefined) return record
    return { ...record, disposition: { ...record.disposition, mapping: { ...record.disposition.mapping, mappingRevision: 'f'.repeat(64) } } }
  })
  assert.throws(
    () => projectDesignGraph({ ...input, records: staleRecords }),
    (error) => error instanceof GroundingPinMismatchError && error.field === 'mappingRevision',
  )

  // An accepted assertion without its promotion record fails loud.
  assert.throws(
    () => projectDesignGraph({ ...input, records: read.records.filter((record) => record.kind !== 'promotion') }),
    /requires exactly one promotion transaction/,
  )

  // Ledger pins fail loud.
  assert.throws(() => projectDesignGraph({ ...input, project: '  ' }), /project/)
  assert.throws(() => projectDesignGraph({ ...input, assertionRevision: -1 }), /assertionRevision/)
  assert.throws(() => projectDesignGraph({ ...input, checkpoint: '' }), /checkpoint/)

  // Empty inputs rebuild a stable empty graph.
  const empty = projectDesignGraph({ project: 'fixture-project', assertionRevision: 0, checkpoint: 'fixture-checkpoint', assertions: [], records: [], relationships: [], grounding: compiled })
  assert.equal(empty.nodes.length, 0)
  assert.equal(empty.edges.length, 0)
  assert.equal(empty.skippedAssertions, 0)
  assert.equal(projectDesignGraph({ project: 'fixture-project', assertionRevision: 0, checkpoint: 'fixture-checkpoint', assertions: [], records: [], relationships: [], grounding: compiled }).graphRevision, empty.graphRevision)

  console.log('design-graph-projection smoke ok')
} finally {
  await rm(root, { recursive: true, force: true })
}
