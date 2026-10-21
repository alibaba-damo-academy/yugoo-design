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

test('required visible design orientation is not suppressed as internal scheduling narration', () => {
  assert.ok(DESIGN_CORE_PROGRESSION_PROMPT.includes(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE))
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /Before every ordinary run_design_skill engagement/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /takes precedence over the preference to omit tool introductions/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /visible assistant text before its corresponding tool call/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /Planning, and a tool call alone are not visible acknowledgement/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /Do not ask the user to confirm an action they already authorized/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /Keep private deliberation out of user-visible messages/)
})

test('only an explicitly offered pre-engagement correction may retry once within existing authority', () => {
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /before execution and offers a correction/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /retry that same authorized engagement once/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /does not retry a failed Bundle execution/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /same Host turn and authorized project, Kit, Bundle and purpose/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /If the correction is rejected again.*stop and report/)
  assert.match(DESIGN_INVOCATION_COMMUNICATION_GUIDANCE, /Invalid names, permissions, receipts, and actual failed or cancelled execution are not this exception/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /A failed or refused skill ends the current turn/)
})

test('user-input guidance names actual controls without inventing completion or another model step', () => {
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /what the user can review or edit/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /current Host or Panel control label/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /do not invent a button, position, or route/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /Distinguish a saved proposal from an answered question or confirmed decision/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /errors, pending recovery, authorization limits and unverified outcomes explicit/)
  assert.match(DESIGN_UNDERSTANDING_HANDOFF_GUIDANCE, /do not reopen the Bundle or request another model turn/)
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
  assert.match(kit.mindset, /not a new product brief\s+database/)
})
