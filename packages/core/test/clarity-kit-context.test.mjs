import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { renderDesignClarityKitContext, renderDesignClarityUserContext, designClarityScopeDigest, designClarityHostTurn } from '../src/design-clarity-context.ts'
import { designClarityDigest, parseDesignClarityReported, parseDesignClarityMeta, designClarityInputMatches } from '../src/design-clarity-report.ts'

test('clarity retains explicit scope before a continuation control without treating other events as human authority', () => {
  const human = text => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  const events = [human('Only list and detail; no registration or login.'),
    { type: 'user/message', data: { source: { kind: 'tool' }, content: [{ type: 'text', text: 'Implement registration.' }] } },
    { type: 'assistant/message', data: { content: [{ type: 'text', text: 'Require an admin.' }] } },
    human('Generate Pages')]
  const context = JSON.parse(renderDesignClarityUserContext(events))
  assert.deepEqual(context.messages, ['Only list and detail; no registration or login.', 'Generate Pages'])
  assert.equal(context.order, 'oldest-to-newest')
  assert.equal(context.earlierMessagesOmitted, false)
  const bounded = JSON.parse(renderDesignClarityUserContext(Array.from({ length: 10 }, (_, i) => human(`${i}:${'x'.repeat(7000)}`))))
  assert.equal(bounded.messages.length, 8)
  assert.equal(bounded.earlierMessagesOmitted, true)
  assert.ok(bounded.messages.every(text => text.length === 6000))
  assert.equal(renderDesignClarityUserContext([]), undefined)
})

test('scope identity ignores only the logged save controls, not actual new intent or user decisions', () => {
  const human = text => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  const scope = [human('A local prototype; no real customer data.')]
  const original = designClarityScopeDigest(scope)
  assert.match(original, /^[0-9a-f]{64}$/)
  assert.equal(designClarityScopeDigest([...scope, human('保存并继续设计')]), original)
  assert.equal(designClarityScopeDigest([...scope, human('Save and continue designing')]), original)
  assert.notEqual(designClarityScopeDigest([...scope, human('Use production customer data instead.')]), original)
  assert.notEqual(designClarityScopeDigest([...scope, human('Generate Pages')]), original)
  assert.equal(designClarityScopeDigest([...scope, { type: 'tool/result', data: { text: 'new advice' } }]), original)
  assert.equal(designClarityHostTurn([{ type: 'turn/start', data: { turn: 39 } }, { type: 'tool/call', data: { turn: 40 } }]), 40)
  assert.equal(designClarityHostTurn([]), 0)
})

test('scope is host-owned report identity and unknown scope is not silently invented', () => {
  const assessment = { summary: 'Bounded evidence.', u: { score: 60, evidence: 'Intent' }, s: { score: 40, evidence: 'Structure' }, t: { score: 20, evidence: 'Checks' } }
  const report = { origin: 'evaluator', turn: 2, callId: 'actual-child-id', kit: 'fixture', version: '1.0',
    ...assessment, digest: designClarityDigest(assessment, 'fixture', '1.0') }
  assert.equal(parseDesignClarityReported(report).scopeDigest, undefined)
  const pinned = { ...report, scopeDigest: designClarityScopeDigest([]) }
  assert.equal(parseDesignClarityReported(pinned).scopeDigest, pinned.scopeDigest)
  assert.throws(() => parseDesignClarityReported({ ...report, scopeDigest: 'untrusted scope' }), /scopeDigest/)
})

test('existing non-Web Kit contracts calibrate without new author configuration', () => {
  const kit = { name: 'decision_modeling', version: '1.0', mindset: 'Compare options for one bounded decision.',
    skills: [{ name: 'decision', description: 'Record alternatives and decision criteria.', metadata: {
      schemaYaml: 'type: object\nproperties:\n  alternatives:\n    type: array\n    items:\n      type: string',
      validationYaml: 'skill: decision\nrules: []',
    }, content: 'DO NOT INCLUDE THIS EXECUTION METHOD' }], resources: { 'private.txt': 'DO NOT INCLUDE RESOURCE DUMP' } }
  const before = JSON.stringify(kit)
  const text = renderDesignClarityKitContext(kit)
  const snapshot = JSON.parse(text.split('\n')[1])
  assert.equal(snapshot.name, 'decision_modeling')
  assert.equal(snapshot.mindset, kit.mindset)
  assert.equal(snapshot.bundles[0].schema, kit.skills[0].metadata.schemaYaml)
  assert.equal(snapshot.bundles[0].validation, kit.skills[0].metadata.validationYaml)
  assert.doesNotMatch(text, /DO NOT INCLUDE/)
  assert.match(text, /not product evidence or permission/)
  assert.match(text, /does not prove.*user confirmed/)
  assert.equal(JSON.stringify(kit), before)
})

test('immutable readers may retrieve exact contracts without repeating them in Kit calibration', () => {
  const kit = { name: 'bounded_decision', version: '1.0', description: 'Compare an explicit decision.',
    mindset: 'Retain every domain principle and the complete capability catalog.', skills: [
      { name: 'zeta', description: 'Keep this capability too.', metadata: { schemaYaml: 'ZETA_SCHEMA', validationYaml: 'ZETA_VALIDATION' } },
      { name: 'alpha', description: 'Bounded options and criteria.', metadata: { schemaYaml: 'ALPHA_SCHEMA', validationYaml: 'ALPHA_VALIDATION' } },
    ] }
  const before = JSON.stringify(kit)
  const original = renderDesignClarityKitContext(kit)
  assert.equal(original, renderDesignClarityKitContext(kit, { contracts: 'inline' }), 'default callers retain the same inline contracts')
  assert.equal(original, [
    'Kit calibration snapshot (scope and output contracts, not product evidence or permission to run tools):',
    JSON.stringify({ name: kit.name, version: kit.version, description: kit.description, mindset: kit.mindset, bundles: [
      { name: 'alpha', description: 'Bounded options and criteria.', schema: 'ALPHA_SCHEMA', validation: 'ALPHA_VALIDATION' },
      { name: 'zeta', description: 'Keep this capability too.', schema: 'ZETA_SCHEMA', validation: 'ZETA_VALIDATION' },
    ] }),
    'Use this snapshot to interpret which structures and outcomes apply. A declared field, method or example does not prove the product contains it or the user confirmed it. Do not execute Kit methods during assessment.',
  ].join('\n'), 'default rendering remains byte-identical to its existing contract')
  const resources = renderDesignClarityKitContext(kit, { contracts: 'resources' })
  const snapshot = JSON.parse(resources.split('\n')[1])
  assert.equal(snapshot.mindset, kit.mindset)
  assert.deepEqual(snapshot.bundles, [{ name: 'alpha', description: 'Bounded options and criteria.' },
    { name: 'zeta', description: 'Keep this capability too.' }])
  assert.doesNotMatch(resources, /ALPHA_SCHEMA|ALPHA_VALIDATION|ZETA_SCHEMA|ZETA_VALIDATION/)
  assert.match(resources, /read_skill_resource/)
  assert.match(resources, /manifest-listed/)
  assert.match(resources, /schema\.yaml/)
  assert.match(resources, /validation\.yaml/)
  assert.match(resources, /not.*product evidence/)
  assert.equal(JSON.stringify(kit), before)
})

test('known assessment input is separate from score-content digest and survives strict metadata', () => {
  const assessment = { summary: 'Same assessed scores.', u: { score: 60, evidence: 'Intent' },
    s: { score: 40, evidence: 'Structure' }, t: { score: 20, evidence: 'Checks' } }
  const report = { origin: 'main-agent', turn: 2, callId: 'actual-call', kit: 'fixture', version: '1.0',
    ...assessment, digest: designClarityDigest(assessment, 'fixture', '1.0'),
    scopeDigest: 'a'.repeat(64), kitContentHash: 'b'.repeat(64) }
  assert.deepEqual(parseDesignClarityReported(report), report)
  assert.deepEqual(parseDesignClarityMeta({ kind: 'design/clarity', v: 1, ...report }), report)
  assert.equal(designClarityInputMatches(report, { ...report }), true)
  assert.equal(designClarityInputMatches(report, { ...report, kitContentHash: 'c'.repeat(64) }), false)
  assert.equal(designClarityInputMatches(report, { ...report, scopeDigest: 'c'.repeat(64) }), true,
    'conversational metadata is not a native reporting/currentness gate')
  const { scopeDigest, kitContentHash, ...unknown } = report
  assert.equal(designClarityInputMatches(unknown, unknown), false)
  assert.equal(designClarityInputMatches(unknown, report), false)
  assert.equal(designClarityDigest({ ...report, scopeDigest: 'c'.repeat(64) }, 'fixture', '1.0'), report.digest)
  assert.throws(() => parseDesignClarityReported({ ...report, kitContentHash: 'unknown' }), /kitContentHash/)
  assert.throws(() => parseDesignClarityMeta({ kind: 'design/clarity', v: 1, ...report, unknown: true }), /invalid envelope/)
})

test('minimal Kit and deterministic ordering do not invent contracts', () => {
  const kit = { name: 'minimal', version: '1.0', mindset: 'One bounded outcome.', skills: [
    { name: 'zeta', description: 'Z' }, { name: 'alpha', description: 'A' },
  ] }
  const a = renderDesignClarityKitContext(kit)
  assert.equal(a, renderDesignClarityKitContext({ ...kit, skills: [...kit.skills].reverse() }))
  const snapshot = JSON.parse(a.split('\n')[1])
  assert.deepEqual(snapshot.bundles, [{ name: 'alpha', description: 'A' }, { name: 'zeta', description: 'Z' }])
})

test('shared rubric and both runtime callers carry cross-Kit guidance', async () => {
  const root = new URL('../../../', import.meta.url)
  const read = path => readFile(new URL(path, root), 'utf8')
  const rubric = await read('packages/core/src/design-core-prompt.ts')
  assert.match(rubric, /not a universal Web App checklist/)
  assert.match(rubric, /never mandatory artifacts for every Kit/)
  assert.match(rubric, /Do not reward file count/)
  assert.match(rubric, /contradict user intent or each other/)
  assert.match(rubric, /absent or failed assessment is not a fabricated zero score/)
  const execution = await read('packages/core/src/dsh-design-execution-plugin.ts')
  assert.doesNotMatch(execution, /await clarity\.assess\(/, 'saved Bundle completion never waits for a second scoring Agent')
  assert.match(execution, /status: 'pending' as const/)
  assert.match(execution, /no second assessment Agent is required for completion/)
  assert.match(rubric, /including within the same turn/)
  assert.match(rubric, /no native log, turn identity or separate authorization ticket is required/)
})
