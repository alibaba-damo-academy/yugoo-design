import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { officialAdvisoryProfile, OFFICIAL_GROUNDING_PROFILE } = await import('../src/official-advisory-profiles.ts')
const { analyzeDshDesignAdvisory } = await import('../src/dsh-advisory-runner.ts')
const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools')

const input = {
  schemaVersion: 1, runId: 'target-review', resultId: 'result',
  pins: [{ source: 'design-revision', revision: '1' }],
  facetRefs: ['flow_design', 'business_rules'],
}
const finding = {
  id: 'duplicate', title: 'Remove the duplicate return notification',
  facets: ['flow_design/P-001', 'business_rules/BR-001'],
  summary: 'The process sends the return notification twice.',
  authoritativeReference: 'business_rules/business_rules.json#/rules/BR-001',
  correction: 'Keep the single notification required by the saved rule.',
  affectedFacets: ['flow_design'],
}
const output = item => ({ schemaVersion: 1, inconsistencies: [item] })

test('grounding capture rejects file/entity targets and unknown Bundles without aliasing them', () => {
  const profile = officialAdvisoryProfile(OFFICIAL_GROUNDING_PROFILE, input)
  for (const target of ['flow_design/P-001', 'other_kit_bundle']) {
    const value = output({ ...finding, affectedFacets: [target] })
    assert.ok(validateJsonSchemaValue(profile.outputSchema, value).length > 0, target)
    assert.throws(() => profile.parseOutput(value), /exact owning Bundle name/, target)
  }
})

test('exact single and multiple Bundle targets preserve their actual evidence references', () => {
  const profile = officialAdvisoryProfile(OFFICIAL_GROUNDING_PROFILE, input)
  for (const affectedFacets of [['flow_design'], ['flow_design', 'business_rules']]) {
    const value = output({ ...finding, affectedFacets })
    assert.deepEqual(validateJsonSchemaValue(profile.outputSchema, value), [])
    const advisory = profile.project(input, profile.parseOutput(value))
    assert.deepEqual(advisory.actionSpec.targets.map(target => target.skillName).sort(), [...affectedFacets].sort())
    assert.deepEqual(advisory.items[0].references, [finding.authoritativeReference, ...finding.facets])
  }
  const another = officialAdvisoryProfile(OFFICIAL_GROUNDING_PROFILE, { facetRefs: ['custom_owner'] })
  assert.doesNotThrow(() => another.parseOutput(output({ ...finding, affectedFacets: ['custom_owner'] })))
  assert.throws(() => profile.parseOutput(output({ ...finding, affectedFacets: ['custom_owner'] })), /exact owning Bundle name/)
})

function request(extra = {}) {
  return { profile: OFFICIAL_GROUNDING_PROFILE, input, parent: {}, provider: 'spawn',
    design: {}, projectRoot: '/test-project', designFilesRoot: '/test-project/design_files',
    reviewCommit: 'a'.repeat(40), signal: new AbortController().signal,
    stillCurrent: () => true, ...extra }
}

for (const knowledgeContext of [undefined, 'Bounded stored KAG context']) {
  test(`runner binds the same target contract at capture and final parsing (KAG ${!!knowledgeContext})`, async () => {
    let disposed = 0
    const outcome = await analyzeDshDesignAdvisory(request({ knowledgeContext }), {
      async start(_provider, captured) {
        const invalid = output({ ...finding, affectedFacets: ['flow_design/P-001'] })
        assert.ok(validateJsonSchemaValue(captured.outputSchema, invalid).length > 0)
        assert.throws(() => captured.validateOutput(invalid), /exact owning Bundle name/)
        captured.validateOutput(output(finding))
        return { id: 'test-child', result: Promise.resolve({ stopReason: 'completed', structured: output(finding) }),
          async dispose() { disposed++ } }
      },
    })
    assert.equal(outcome.status, 'produced')
    assert.equal(outcome.advisory.actionSpec.targets[0].skillName, 'flow_design')
    assert.equal(disposed, 1)
  })
}

test('a transport bypassing capture validation still cannot publish a malformed target', async () => {
  let disposed = 0
  await assert.rejects(analyzeDshDesignAdvisory(request(), {
    async start() {
      return { id: 'test-child', result: Promise.resolve({ stopReason: 'completed',
        structured: output({ ...finding, affectedFacets: ['flow_design/P-001'] }) }),
      async dispose() { disposed++ } }
    },
  }), /exact owning Bundle name/)
  assert.equal(disposed, 1)
})

test('an empty project can return no findings without an empty schema enum', async () => {
  const emptyInput = { ...input, facetRefs: [] }
  const profile = officialAdvisoryProfile(OFFICIAL_GROUNDING_PROFILE, emptyInput)
  const empty = { schemaVersion: 1, inconsistencies: [] }
  assert.deepEqual(validateJsonSchemaValue(profile.outputSchema, empty), [])
  assert.doesNotMatch(JSON.stringify(profile.outputSchema), /"enum":\[\]/)
  assert.doesNotThrow(() => profile.parseOutput(empty))
  assert.throws(() => profile.parseOutput(output(finding)), /exact owning Bundle name/)
  const outcome = await analyzeDshDesignAdvisory(request({ input: emptyInput }), {
    async start(_provider, captured) {
      captured.validateOutput(empty)
      return { id: 'test-child', result: Promise.resolve({ stopReason: 'completed', structured: empty }), async dispose() {} }
    },
  })
  assert.equal(outcome.status, 'produced')
  assert.deepEqual(outcome.advisory.items, [])
})
