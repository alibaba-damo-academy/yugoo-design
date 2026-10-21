// Run from the source workspace after installing its pinned development tools:
// node --import tsx scripts/smoke-kit-grounding-mapping.mjs
import assert from 'node:assert/strict'
import {
  GroundAssertionParseError,
  parseGroundAssertionCandidate,
} from '../packages/core/src/ground-assertions.ts'
import {
  compileKitGrounding,
  parseKitGroundingDeclaration,
  projectBundleGroundCandidates,
} from '../packages/core/src/kit-grounding-mapping.ts'
import { DesignBundleVersion, DesignKitVersion } from '../packages/core/src/types.ts'

const kitVersion = DesignKitVersion('1.0')
const pageVersion = DesignBundleVersion('1.0')
const flowVersion = DesignBundleVersion('1.0')
const kit = {
  name: 'fixture_kit',
  version: kitVersion,
  mindset: '# Fixture mindset',
  skills: [
    { name: 'page-prd', version: pageVersion, description: 'fixture page bundle', content: '', execution: { handoff: 'none' } },
    { name: 'flow-map', version: flowVersion, description: 'fixture flow bundle', content: '', execution: { handoff: 'none' } },
  ],
  resources: {},
}

const declarationValue = {
  schemaVersion: 1,
  bundles: {
    'page-prd': {
      entities: [
        { id: 'page', subject: '/page/id', when: [{ field: '/page/kind', equals: 'landing' }] },
        { id: 'section', subject: '/section/id' },
      ],
      assertions: [
        { id: 'page-title', kind: 'fact', subjectEntity: 'page', predicate: 'title', valuePath: '/page/title', summary: 'The landing page title.' },
        { id: 'section-limit', kind: 'constraint', subjectEntity: 'section', predicate: 'max-count', valuePath: '/section/maxCount', summary: 'The section count limit.' },
      ],
      relationships: [
        { id: 'page-has-section', relation: 'introduces', fromEntity: 'page', to: { entity: 'section' } },
        { id: 'section-source', relation: 'supports', fromEntity: 'section', to: { field: '/section/sourceId' } },
      ],
    },
  },
}

const source = { kind: 'design_file', id: 'fixture:page-prd-state', revision: 'fixture-state-revision' }
const producedBy = { kind: 'grounding_result', resultId: 'fixture-result', runId: 'fixture-run', revision: 'fixture-result-revision' }
const landingRecord = {
  page: { id: 'page:home', kind: 'landing', title: 'Home' },
  section: { id: 'section:hero', maxCount: 3, sourceId: 'fixture:source' },
}
const pricingRecord = {
  page: { id: 'page:pricing', kind: 'pricing', title: 'Pricing' },
  section: { id: 'section:plans', maxCount: 5, sourceId: 'fixture:source-2' },
}

const throwsParse = (value, pattern) => {
  assert.throws(() => parseKitGroundingDeclaration(value), (error) => error instanceof GroundAssertionParseError && pattern.test(error.message))
}

// --- parse: happy path and strictness ---------------------------------------
const declaration = parseKitGroundingDeclaration(declarationValue)
assert.equal(declaration.schemaVersion, 1)
assert.deepEqual(Object.keys(declaration.bundles), ['page-prd'])

throwsParse({ ...declarationValue, extra: 1 }, /unknown field "extra"/)
throwsParse({ schemaVersion: 2, bundles: {} }, /schemaVersion/)
throwsParse({ schemaVersion: 1, bundles: { 'page-prd': { entities: [], bogus: true } } }, /unknown field "bogus"/)
throwsParse(
  { schemaVersion: 1, bundles: { 'page-prd': { entities: [{ id: 'page', subject: '/page/id', when: [{ field: '/page/kind', equals: 'landing', extra: 1 }] }] } } },
  /unknown field "extra"/,
)
throwsParse(
  { schemaVersion: 1, bundles: { 'page-prd': { assertions: [{ id: 'a', kind: 'assumption', subjectEntity: 'page', predicate: 'p', valuePath: '/v', summary: 's' }], entities: [{ id: 'page', subject: '/page/id' }] } } },
  /assumption can never be declared/,
)
throwsParse(
  { schemaVersion: 1, bundles: { 'page-prd': { assertions: [{ id: 'a', kind: 'opinion', subjectEntity: 'page', predicate: 'p', valuePath: '/v', summary: 's' }], entities: [{ id: 'page', subject: '/page/id' }] } } },
  /unsupported value "opinion"/,
)
throwsParse(
  { schemaVersion: 1, bundles: { 'page-prd': { entities: [{ id: 'page', subject: '/page/id' }], relationships: [{ id: 'r', relation: 'blocks', fromEntity: 'page', to: { field: '/x' } }] } } },
  /unsupported value "blocks"/,
)
throwsParse(
  { schemaVersion: 1, bundles: { 'page-prd': { entities: [{ id: 'page', subject: '/page/id' }, { id: 'page', subject: '/other/id' }] } } },
  /duplicate mapping id "page"/,
)
throwsParse(
  { schemaVersion: 1, bundles: { 'page-prd': { assertions: [{ id: 'a', kind: 'fact', subjectEntity: 'missing', predicate: 'p', valuePath: '/v', summary: 's' }] } } },
  /subjectEntity "missing" is not an entity mapping/,
)
throwsParse(
  { schemaVersion: 1, bundles: { 'page-prd': { entities: [{ id: 'page', subject: '/page/id' }], relationships: [{ id: 'r', relation: 'supports', fromEntity: 'page', to: { entity: 'missing' } }] } } },
  /to\.entity "missing" is not an entity mapping/,
)
throwsParse(
  { schemaVersion: 1, bundles: { 'page-prd': { entities: [{ id: 'Bad_ID', subject: '/page/id' }] } } },
  /expected a lowercase mapping id/,
)
throwsParse({ schemaVersion: 1, bundles: { 'page-prd': { entities: [{ id: 'page', subject: '/' }] } } }, /non-root RFC 6901 pointer/)
throwsParse({ schemaVersion: 1, bundles: { 'page-prd': { entities: [{ id: 'page', subject: 'no-slash' }] } } }, /non-root RFC 6901 pointer/)
throwsParse({ schemaVersion: 1, bundles: { 'page-prd': { entities: [{ id: 'page', subject: '/a/~2' }] } } }, /invalid RFC 6901 escape/)
throwsParse({ schemaVersion: 1, bundles: { 'page-prd': { entities: [{ id: 'page', subject: '/__proto__/x' }] } } }, /unsafe path segment/)
throwsParse(
  { schemaVersion: 1, bundles: { 'page-prd': { entities: [{ id: 'page', subject: '/page/id', when: [{ field: '/page/kind' }] }] } } },
  /expected an explicit JSON value/,
)
throwsParse({ schemaVersion: 1, bundles: { 'PAGE-PRD': {} } }, /invalid Bundle name/)

// --- compile: determinism, pins, empty capability, fail-loud -----------------
const compiled = compileKitGrounding(kit, declaration)
assert.equal(compiled.kit, 'fixture_kit')
assert.equal(compiled.kitVersion, kitVersion)
assert.match(compiled.mappingRevision, /^[0-9a-f]{64}$/)

// Deterministic: a second compile and a key-reordered declaration agree.
const reordered = parseKitGroundingDeclaration({
  bundles: {
    'page-prd': {
      relationships: declarationValue.bundles['page-prd'].relationships,
      entities: declarationValue.bundles['page-prd'].entities,
      assertions: declarationValue.bundles['page-prd'].assertions,
    },
  },
  schemaVersion: 1,
})
assert.equal(compileKitGrounding(kit, declaration).mappingRevision, compiled.mappingRevision)
assert.equal(compileKitGrounding(kit, reordered).mappingRevision, compiled.mappingRevision)

// Any mapping change moves the mapping revision.
const changed = parseKitGroundingDeclaration({
  ...declarationValue,
  bundles: {
    'page-prd': {
      ...declarationValue.bundles['page-prd'],
      assertions: [
        { ...declarationValue.bundles['page-prd'].assertions[0], summary: 'A changed summary.' },
        declarationValue.bundles['page-prd'].assertions[1],
      ],
    },
  },
})
assert.notEqual(compileKitGrounding(kit, changed).mappingRevision, compiled.mappingRevision)

// Compiled bundles pin exact versions and cover every real Kit Bundle.
assert.deepEqual(Object.keys(compiled.bundles).sort(), ['flow-map', 'page-prd'])
assert.equal(compiled.bundles['page-prd'].bundleVersion, pageVersion)
assert.equal(compiled.bundles['flow-map'].bundleVersion, flowVersion)

// Undeclared Bundle compiles to explicit empty mappings.
assert.deepEqual(compiled.bundles['flow-map'].entities, [])
assert.deepEqual(compiled.bundles['flow-map'].assertions, [])
assert.deepEqual(compiled.bundles['flow-map'].relationships, [])

// Declaring a Bundle the Kit does not contain fails loud.
assert.throws(
  () => compileKitGrounding(kit, parseKitGroundingDeclaration({ schemaVersion: 1, bundles: { 'ghost-bundle': { entities: [] } } })),
  (error) => error instanceof GroundAssertionParseError && /Bundle the Kit does not contain/.test(error.message),
)

// No declaration is an explicit empty capability with a deterministic revision.
const emptyCompiled = compileKitGrounding(kit)
assert.equal(emptyCompiled.mappingRevision, compileKitGrounding(kit).mappingRevision)
assert.notEqual(emptyCompiled.mappingRevision, compiled.mappingRevision)
assert.deepEqual(emptyCompiled.bundles['page-prd'].entities, [])

// --- projection: landing record matches the conditioned page entity ----------
const landingProjection = projectBundleGroundCandidates(compiled, 'page-prd', { recordId: 'record:landing-1', record: landingRecord, source, producedBy })
assert.equal(landingProjection.assertions.length, 2)
assert.equal(landingProjection.relationships.length, 2)

const pageTitle = landingProjection.assertions[0]
assert.equal(pageTitle.mappingId, 'page-title')
assert.equal(pageTitle.recordId, 'record:landing-1')
assert.deepEqual(pageTitle.candidate.claim, { subject: 'page:home', predicate: 'title', value: 'Home', summary: 'The landing page title.' })
assert.equal(pageTitle.candidate.kind, 'fact')
assert.deepEqual(pageTitle.candidate.sources, [source])
assert.deepEqual(pageTitle.candidate.producedBy, producedBy)
assert.deepEqual(pageTitle.candidate.productAnchors, [])
assert.deepEqual(pageTitle.candidate.supersedes, [])
assert.equal(pageTitle.candidate.projection, undefined)
// Provenance rides on the projection wrapper.
assert.equal(pageTitle.kit, 'fixture_kit')
assert.equal(pageTitle.kitVersion, kitVersion)
assert.equal(pageTitle.bundle, 'page-prd')
assert.equal(pageTitle.bundleVersion, pageVersion)
assert.equal(pageTitle.mappingRevision, compiled.mappingRevision)

// Every assertion candidate survives the strict candidate parser unchanged.
assert.deepEqual(parseGroundAssertionCandidate(pageTitle.candidate), pageTitle.candidate)
assert.deepEqual(parseGroundAssertionCandidate(landingProjection.assertions[1].candidate), landingProjection.assertions[1].candidate)

// Derived ids are valid GroundAssertion identities and unique per mapping.
const groundIdRe = /^ground:[a-z0-9][a-z0-9._:-]{0,126}$/
for (const projected of landingProjection.assertions) {
  assert.match(projected.candidate.id, groundIdRe)
  assert.ok(projected.candidate.id.length <= 128)
}
assert.notEqual(landingProjection.assertions[0].candidate.id, landingProjection.assertions[1].candidate.id)

const sectionLimit = landingProjection.assertions[1]
assert.equal(sectionLimit.mappingId, 'section-limit')
assert.deepEqual(sectionLimit.candidate.claim.value, 3)

// Relationships carry both endpoints, relation, source, producer, and provenance.
const introduces = landingProjection.relationships[0]
assert.deepEqual(introduces, {
  id: introduces.id,
  relation: 'introduces',
  from: 'page:home',
  to: 'section:hero',
  recordId: 'record:landing-1',
  mappingId: 'page-has-section',
  source,
  producedBy,
  kit: 'fixture_kit',
  kitVersion,
  bundle: 'page-prd',
  bundleVersion: pageVersion,
  mappingRevision: compiled.mappingRevision,
})
assert.match(introduces.id, groundIdRe)
assert.equal(landingProjection.relationships[1].relation, 'supports')
assert.equal(landingProjection.relationships[1].to, 'fixture:source')
assert.notEqual(introduces.id, landingProjection.relationships[1].id)

// --- projection: deterministic and record-sensitive ---------------------------
const again = projectBundleGroundCandidates(compiled, 'page-prd', { recordId: 'record:landing-1', record: landingRecord, source, producedBy })
assert.deepEqual(again, landingProjection)
const otherRecordId = projectBundleGroundCandidates(compiled, 'page-prd', { recordId: 'record:landing-2', record: landingRecord, source, producedBy })
assert.notEqual(otherRecordId.assertions[0].candidate.id, pageTitle.candidate.id)

// --- projection: unmatched entity gates its assertions and relationships -----
const pricingProjection = projectBundleGroundCandidates(compiled, 'page-prd', { recordId: 'record:pricing-1', record: pricingRecord, source, producedBy })
assert.equal(pricingProjection.assertions.length, 1)
assert.equal(pricingProjection.assertions[0].mappingId, 'section-limit')
assert.equal(pricingProjection.assertions[0].candidate.claim.subject, 'section:plans')
// The page relationship is skipped because its origin entity did not match.
assert.equal(pricingProjection.relationships.length, 1)
assert.equal(pricingProjection.relationships[0].mappingId, 'section-source')

// --- projection: conjunctive conditions and all-match semantics --------------
const conjunctive = parseKitGroundingDeclaration({
  schemaVersion: 1,
  bundles: {
    'flow-map': {
      entities: [
        { id: 'step', subject: '/step/id', when: [{ field: '/step/kind', equals: 'review' }, { field: '/step/blocking', equals: true }] },
        { id: 'lane', subject: '/lane/id' },
      ],
      assertions: [
        { id: 'step-owner', kind: 'requirement', subjectEntity: 'step', predicate: 'owner', valuePath: '/step/owner', summary: 'The review step owner.' },
        { id: 'lane-name', kind: 'fact', subjectEntity: 'lane', predicate: 'name', valuePath: '/lane/name', summary: 'The lane name.' },
      ],
    },
  },
})
const conjunctiveCompiled = compileKitGrounding(kit, conjunctive)
const fullMatch = projectBundleGroundCandidates(conjunctiveCompiled, 'flow-map', {
  recordId: 'record:flow-1',
  record: { step: { id: 'step:signoff', kind: 'review', blocking: true, owner: 'review-board' }, lane: { id: 'lane:qa', name: 'QA' } },
  source,
  producedBy,
})
// Both entity mappings produce; there is no first-match-wins.
assert.equal(fullMatch.assertions.length, 2)
assert.deepEqual(fullMatch.assertions.map((projected) => projected.mappingId), ['step-owner', 'lane-name'])
const partialMatch = projectBundleGroundCandidates(conjunctiveCompiled, 'flow-map', {
  recordId: 'record:flow-2',
  record: { step: { id: 'step:signoff', kind: 'review', blocking: false, owner: 'review-board' }, lane: { id: 'lane:qa', name: 'QA' } },
  source,
  producedBy,
})
// One unmet condition blocks the whole entity mapping.
assert.deepEqual(partialMatch.assertions.map((projected) => projected.mappingId), ['lane-name'])
const missingField = projectBundleGroundCandidates(conjunctiveCompiled, 'flow-map', {
  recordId: 'record:flow-3',
  record: { step: { id: 'step:signoff', kind: 'review' }, lane: { id: 'lane:qa', name: 'QA' } },
  source,
  producedBy,
})
assert.deepEqual(missingField.assertions.map((projected) => projected.mappingId), ['lane-name'])

// --- projection: fail-loud on unmatched declarations --------------------------
assert.throws(
  () => projectBundleGroundCandidates(compiled, 'ghost-bundle', { recordId: 'record:x', record: {}, source, producedBy }),
  (error) => error instanceof GroundAssertionParseError && /not part of the compiled Kit grounding/.test(error.message),
)
assert.throws(
  () => projectBundleGroundCandidates(compiled, 'page-prd', { recordId: '', record: landingRecord, source, producedBy }),
  (error) => error instanceof GroundAssertionParseError && /recordId/.test(error.message),
)
// A matched entity whose declared value pointer does not resolve fails loud.
assert.throws(
  () => projectBundleGroundCandidates(compiled, 'page-prd', {
    recordId: 'record:broken',
    record: { page: { id: 'page:home', kind: 'landing' }, section: { id: 'section:hero', maxCount: 3, sourceId: 'fixture:source' } },
    source,
    producedBy,
  }),
  (error) => error instanceof GroundAssertionParseError && /valuePath.*does not resolve/.test(error.message),
)
// A matched entity whose subject is not a non-empty string fails loud.
assert.throws(
  () => projectBundleGroundCandidates(compiled, 'page-prd', {
    recordId: 'record:bad-subject',
    record: { page: { id: 42, kind: 'landing', title: 'Home' }, section: { id: 'section:hero', maxCount: 3, sourceId: 'fixture:source' } },
    source,
    producedBy,
  }),
  (error) => error instanceof GroundAssertionParseError && /entity page\.subject/.test(error.message),
)
// A field-targeted relationship whose pointer does not resolve fails loud.
assert.throws(
  () => projectBundleGroundCandidates(compiled, 'page-prd', {
    recordId: 'record:bad-to-field',
    record: { page: { id: 'page:home', kind: 'pricing', title: 'Home' }, section: { id: 'section:hero', maxCount: 3 } },
    source,
    producedBy,
  }),
  (error) => error instanceof GroundAssertionParseError && /relationship section-source\.to\.field/.test(error.message),
)

// --- projection: undeclared Bundle is an explicit empty capability ------------
const emptyProjection = projectBundleGroundCandidates(compiled, 'flow-map', { recordId: 'record:flow-empty', record: {}, source, producedBy })
assert.deepEqual(emptyProjection.assertions, [])
assert.deepEqual(emptyProjection.relationships, [])

console.log('smoke-kit-grounding-mapping: ok')
