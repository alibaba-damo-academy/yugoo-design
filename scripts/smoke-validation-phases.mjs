/**
 * Smoke the lifecycle-specific validation phases.
 * Run after building core: node scripts/smoke-validation-phases.mjs
 */
import {
  parseValidationYaml,
  validateSkillDesign,
} from '../packages/core/lib/index.js'
import './smoke-referenced-files.mjs'

const schemaYaml = `
type: object
additional_properties: false
required: [draft, ready]
properties:
  draft: { type: string }
  ready: { type: string }
`

const validationYaml = `
skill: phase_fixture
rules:
  - id: draft_required
    scope: [state]
    code: fixture.state
    check: { non_empty_string: draft }
  - id: submission_required
    scope: [candidate]
    code: fixture.candidate
    check: { non_empty_string: content }
  - id: completion_required
    scope: [completion]
    code: fixture.completion
    check: { non_empty_string: ready }
`

const skill = {
  name: 'phase_fixture',
  metadata: {
    schemaYaml,
    validationYaml,
    skillManifest: { presentation: { mode: 'declarative' } },
    panelYaml: 'version: 1\nui: { type: text }\n',
  },
}

function codes(issues) {
  return issues.map((issue) => issue.code).sort()
}

function expectCodes(label, issues, expected) {
  const actual = codes(issues)
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`)
  }
}

const invalidState = { draft: '', ready: '' }

expectCodes(
  'state isolation',
  await validateSkillDesign(skill, invalidState, { scopes: ['state'] }),
  ['fixture.state'],
)

expectCodes(
  'work-item isolation',
  await validateSkillDesign(skill, undefined, {
    scopes: ['candidate'],
    candidate: { content: '', metadata: { item_id: 'item-1' } },
  }),
  ['fixture.candidate'],
)

expectCodes(
  'completion isolation',
  await validateSkillDesign(skill, invalidState, { scopes: ['completion'] }),
  ['fixture.completion'],
)

expectCodes(
  'legacy combined default',
  await validateSkillDesign(skill, invalidState),
  ['fixture.state', 'fixture.completion'],
)

expectCodes(
  'explicit combined phases',
  await validateSkillDesign(skill, invalidState, {
    scopes: ['state', 'candidate', 'completion'],
    candidate: { content: '' },
  }),
  ['fixture.state', 'fixture.candidate', 'fixture.completion'],
)

const invalidCandidateSkill = {
  ...skill,
  metadata: { ...skill.metadata, panelYaml: 'version: 2\n' },
}
for (const scope of ['state', 'completion']) {
  expectCodes(
    `${scope} candidate checks`,
    await validateSkillDesign(invalidCandidateSkill, {}, { scopes: [scope] }),
    ['schema_violation', 'panel_version', 'panel_no_ui', `fixture.${scope}`],
  )
}

expectCodes(
  'work item does not validate canonical state',
  await validateSkillDesign(invalidCandidateSkill, {}, {
    scopes: ['candidate'],
    candidate: { content: '' },
  }),
  ['fixture.candidate'],
)

try {
  await validateSkillDesign(skill, invalidState, { scopes: ['candidate'] })
  throw new Error('candidate scope accepted a missing candidate payload')
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('requires options.candidate')) throw error
}

for (const source of [
  'skill: broken\nrules:\n  - id: missing_metadata\n    scope: [candidate]\n    code: broken\n    applies_when: {}\n    check: { non_empty_string: content }\n',
  'skill: broken\nrules:\n  - id: wrong_scope\n    scope: [state]\n    code: broken\n    applies_when: { metadata: { kind: conclusion } }\n    check: { non_empty_string: content }\n',
  'skill: broken\nrules:\n  - id: unknown_condition\n    scope: [candidate]\n    code: broken\n    applies_when: { metadata: { kind: conclusion }, state: {} }\n    check: { non_empty_string: content }\n',
]) {
  try {
    parseValidationYaml(source)
    throw new Error(`invalid applies_when accepted: ${source}`)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('applies_when')) throw error
  }
}

console.log('VALIDATION PHASES OK')
