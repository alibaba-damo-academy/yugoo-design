import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
const { register } = await import('tsx/esm/api'); register()
const { DESIGN_CORE_PROGRESSION_PROMPT, DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, DESIGN_INVOCATION_COMMUNICATION_GUIDANCE } = await import('../src/design-core-prompt.ts')
const { OFFICIAL_ADVISORY_PROFILES } = await import('../src/official-advisory-profiles.ts')
const { loadDesignKit } = await import('../src/kit-loader.ts')

test('shared handoff is source-backed and does not create a second store or new authority', () => {
  assert.ok(DESIGN_CORE_PROGRESSION_PROMPT.includes(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE))
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /recognizable user situation/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /no new execution authority/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /dsh-design-next-step/)
})

test('ordinary progress orients the user without creating an execution or permission prerequisite', () => {
  assert.ok(DESIGN_CORE_PROGRESSION_PROMPT.includes(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE))
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /conversation language/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /selected catalog title and useful persistent result/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /wording and its placement are guidance, not an execution prerequisite or another permission step/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /Do not ask the user to confirm an action they already authorized/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /Keep private deliberation out of user-visible messages/)
})

test('communication guidance has no correction quota', () => {
  assert.doesNotMatch(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /retry.*once|correction limit|visible acknowledgement/)
})

test('known failure permits authorized repair without ending the whole turn or inventing new authority', () => {
  assert.doesNotMatch(DESIGN_CORE_PROGRESSION_PROMPT, /A failed or refused skill ends the current turn|A genuine retry needs changed user-visible input|without automatic failure retries/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /Within existing authorization, diagnose and repair known failures or continue independent requested work/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /a new human message is not required merely for diagnosis or repair/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /Respect actual Host permission refusals, user cancellation and declared handoffs/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /never use another tool or Host to bypass a real permission boundary/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /If a submission result is unknown, inspect authoritative saved state or receipts/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /never assume the submission did not happen and automatically replay it/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /additional persistent result outside the current request/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /diagnosis and repair of the current authorized result need no new selection/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /When run_design_skill returns a user-continue action, end at that user choice/)
})

test('user-input guidance names actual controls without inventing completion or another model step', () => {
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /what the user can review or edit/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /current Host or Panel control label/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /do not invent a button, position, or route/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /Distinguish a saved proposal from an answered question or confirmed decision/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /errors, pending recovery, authorization limits and unverified outcomes explicit/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /do not reopen the Bundle or request another model turn/)
})

test('project review stays in the Design Panel while Studio links retain their authoring purpose', () => {
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /Project design results are viewed and edited in the current Design Panel/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /real Host Panel control or a returned project Panel URL/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /Design Studio manages reusable Kit\/Bundle definitions and Panel previews/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /never relabel or reuse a Studio URL for project review/)
})

test('all official reviews receive readable explanation guidance without schema/action changes', () => {
  for (const profile of Object.values(OFFICIAL_ADVISORY_PROFILES)) {
    assert.match(profile.prompt, /concrete user situation/)
    assert.match(profile.prompt, /Do not reduce the review scope/)
    assert.match(profile.prompt, /Do not merge separate action receipts/)
    assert.equal(profile.outputSchema.additionalProperties, false)
  }
})

test('neutral scene questions are reachable from the real loaded method and resource contract', async () => {
  const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
    listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
  const kit = await loadDesignKit(fs, new URL('../../skills-web-app/', import.meta.url).pathname, { sourceId: 'package:dsh-design-skills-web-app' })
  const method = kit.skills.find(skill => skill.name === 'smart_questions').content
  assert.match(method, /without a story template/)
  assert.match(method, /not a required\s+three-question interview/)
  assert.match(method, /already in the conversation and saved answers/)
  assert.match(method, /reference\/artifact-contract\.md/)
  assert.ok(kit.resources['smart_questions/reference/artifact-contract.md'])
  assert.match(kit.mindset, /reading aids, not another product\s+brief, confirmation record or required report/)
})
