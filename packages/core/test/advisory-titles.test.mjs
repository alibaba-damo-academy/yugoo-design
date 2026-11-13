import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { officialAdvisoryProfile, OFFICIAL_GROUNDING_PROFILE, OFFICIAL_REFLECTION_PROFILE, OFFICIAL_ALIGNMENT_PROFILE } = await import('../src/official-advisory-profiles.ts')
const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools')
const input = { schemaVersion: 1, runId: 'title-check', resultId: 'title-result', pins: [{ source: 'design-revision', revision: '1' }], facetRefs: ['business_data', 'flow_design'] }
const cases = [
  [OFFICIAL_GROUNDING_PROFILE, 'inconsistencies', { id: 'states', facets: ['business_data', 'flow_design'], summary: 'The flow permits rejection but the request states omit it.', authoritativeReference: 'design_files/flow_design/flow_design.json', correction: 'Include the rejected outcome in the request states.', affectedFacets: ['business_data'] }, 'Include rejected requests in the saved state model'],
  [OFFICIAL_REFLECTION_PROFILE, 'researchNeeds', { id: 'delivery', facets: ['notification_design'], uncertainty: 'The provider delivery guarantee is unknown.', whyExternalKnowledge: 'The provider contract determines retry behavior.', researchQuestion: 'Does the provider guarantee idempotent delivery?', suggestedSources: ['Provider delivery documentation'] }, 'Verify the provider’s duplicate-delivery guarantee'],
  [OFFICIAL_ALIGNMENT_PROFILE, 'questions', { id: 'retention', facets: ['business_data'], decision: 'The retention duration remains undecided.', question: 'How long should requests be retained?', rationale: 'Deletion changes the history available to clients.', impact: 'Old requests may become unavailable.' }, 'Clarify how long client requests remain available'],
]
for (const [id, collection, item, title] of cases) test(`new ${collection} findings require a business title at structured capture while legacy results remain readable`, () => {
  const profile = officialAdvisoryProfile(id)
  const legacy = { schemaVersion: 1, [collection]: [item] }
  assert.ok(validateJsonSchemaValue(profile.outputSchema, legacy).some(issue => issue.includes('title')))
  assert.deepEqual(validateJsonSchemaValue(profile.outputSchema, {
    schemaVersion: 1, [collection]: [{ ...item, title }],
  }), [])
  assert.doesNotThrow(() => profile.parseOutput(legacy))
  assert.deepEqual(validateJsonSchemaValue(profile.outputSchema, { schemaVersion: 1, [collection]: [] }), [])
})
for (const [id, collection, item, title] of cases) test(`business title survives ${collection} parsing and projection without changing finding content`, () => {
  const profile = officialAdvisoryProfile(id)
  const oldOutput = { schemaVersion: 1, [collection]: [item] }, before = structuredClone(item)
  const old = profile.project(input, profile.parseOutput(oldOutput))
  const result = profile.project(input, profile.parseOutput({ schemaVersion: 1, [collection]: [{ ...item, title }] }))
  assert.equal(result.items[0].title, title)
  assert.equal(result.items[0].detail, old.items[0].detail)
  assert.deepEqual(result.items[0].references, old.items[0].references)
  assert.deepEqual(result.actionSpec, old.actionSpec)
  assert.deepEqual(item, before)
  assert.throws(() => profile.parseOutput({ schemaVersion: 1, [collection]: [{ ...item, title: '' }] }), /title/)
  assert.throws(() => profile.parseOutput({ schemaVersion: 1, [collection]: [{ ...item, title: 'x'.repeat(513) }] }), /title/)
})
for (const [id, collection, item, title] of cases) test(`${collection} generation and projected summaries present proposals without granting acceptance authority`, () => {
  const profile = officialAdvisoryProfile(id)
  const titleSchema = profile.outputSchema.properties[collection].items.properties.title
  assert.match(titleSchema.description, /proposed action and business object/)
  assert.match(profile.prompt, /Write each title as a specific proposed action/)
  assert.match(profile.prompt, /accepting the suggestion is not the user's answer/)
  const output = profile.parseOutput({ schemaVersion: 1, [collection]: [{ ...item, title }] })
  for (const [userContextSummary, pattern] of [['Review the current design.', /1 .*suggestion to consider\./], ['请检查当前设计。', /1 项.*建议。/]]) {
    const result = profile.project({ ...input, userContextSummary }, output)
    assert.match(result.summary, pattern)
    assert.equal(result.items[0].title, title, 'projection preserves the actual action title')
    assert.equal(result.authorizesDesignWrite, false)
    assert.equal(result.blocksConversation, false)
    assert.equal(result.kind, id === OFFICIAL_ALIGNMENT_PROFILE ? 'reminder' : 'suggestion', 'writing does not change the existing review type')
    if (id !== OFFICIAL_GROUNDING_PROFILE) {
      assert.match(result.acceptanceInstruction, /not its claims as facts|不代表确认其中的事实/)
      assert.equal(result.actionSpec.kind, 'review-choice')
    }
  }
  const priorTitle = 'A saved issue-style title'
  const prior = profile.project(input, profile.parseOutput({ schemaVersion: 1, [collection]: [{ ...item, title: priorTitle }] }))
  assert.equal(prior.items[0].title, priorTitle, 'existing saved wording is never rewritten during projection')
})
test('legacy long grounding explanations remain accepted without guessing a short title', () => {
  const profile = officialAdvisoryProfile(OFFICIAL_GROUNDING_PROFILE), item = { ...cases[0][2], summary: 'A'.repeat(600) }
  const result = profile.project(input, profile.parseOutput({ schemaVersion: 1, inconsistencies: [item] }))
  assert.equal(result.items[0].title, 'Cross-file inconsistency')
  assert.ok(result.items[0].detail.includes(item.summary))
})
