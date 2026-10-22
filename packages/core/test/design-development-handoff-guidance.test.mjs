import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { register } = await import('tsx/esm/api')
const unregister = register()
const { DESIGN_CORE_PROGRESSION_PROMPT, DESIGN_DEVELOPMENT_HANDOFF_GUIDANCE: guidance } = await import('../src/design-core-prompt.ts')
unregister()

test('executed shared progression reaches task-scoped development handoff', () => {
  assert.equal(DESIGN_CORE_PROGRESSION_PROMPT.split(guidance).length, 2)
  assert.match(guidance, /published design checkpoint/)
  assert.match(guidance, /unavailable or partial knowledge does not prevent reading the files/)
})

test('existing repository spec conventions keep requirement, proposal and task boundaries', () => {
  for (const path of ['specs/<feature>/spec.md', 'openspec/specs/<domain>/spec.md', 'openspec/changes/<change>/', '.kiro/specs/<feature>/requirements.md']) assert.ok(guidance.includes(path), path)
  assert.match(guidance, /current-spec versus proposed-change distinction/)
  assert.match(guidance, /discovery hints, not permission to create every file/)
  assert.match(guidance, /For compose_spec with no existing convention, use Spec Kit's spec.md \/ plan.md \/ tasks.md organization/)
  assert.match(guidance, /an ordinary development brief may instead use plain Markdown/)
  assert.match(guidance, /Resolve the output location before writing/)
})

test('Markdown references and bounded edits preserve design and coding authority', () => {
  for (const text of ['ordinary Markdown links', 'record IDs or JSON pointers', 'verified published checkpoint', 'observable acceptance criteria', 'Existing user authorization carries forward', 'report checks actually run']) assert.ok(guidance.includes(text), text)
  assert.match(guidance, /disclose external project paths instead of claiming they are portable/)
  assert.match(guidance, /Updating target specs or code requires that workspace's authorization/)
  assert.match(guidance, /owning Bundle's ordinary validation and publication route/)
  assert.match(guidance, /do not write back to Design Files/)
  assert.match(guidance, /No second requirements store, automatic bidirectional synchronization/)
})

test('native host entry skills reach the same handoff method as DSH progression', async () => {
  const common = await readFile(new URL('../../companion/plugin/design-system/skills/design-panel/native-execution.md', import.meta.url), 'utf8')
  const body = guidance.replace('<design_development_handoff>\n', '').replace('\n</design_development_handoff>', '')
  assert.ok(common.includes(body), 'Native method must preserve shared handoff guidance')
  for (const host of ['plugin', 'plugin-claude', 'plugin-qoder', 'plugin-qwenwork']) {
    const skill = await readFile(new URL(`../../companion/${host}/design-system/skills/yugoo/SKILL.md`, import.meta.url), 'utf8')
    const reference = host === 'plugin' ? '../design-panel/native-execution.md' : 'native-execution.md'
    assert.ok(skill.includes(`${reference}#development-handoff-and-existing-specs`), host)
  }
})
