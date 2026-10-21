import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { nativeExecutionContract } from '../src/native-execution-contract.mjs'

const input = { skill: 'example_bundle', projectRoot: '/projects/a space', designFiles: '/projects/a space/design_files',
  kitRoot: '/installed runtime/Kit', stateRoot: '/nondefault content store',
  cliEntry: '/installed runtime/scripts/design.mjs', executable: '/verified Node/node' }

for (const host of ['codex', 'claude-code', 'qoder', 'qwenwork', 'workbuddy']) {
  for (const mode of ['main', 'subagent']) test(`${host}/${mode}: shared operations map without changing ownership or placement`, () => {
    const c = nativeExecutionContract({ ...input, host, mode })
    assert.equal(c.host, host)
    assert.equal(c.mode, mode)
    assert.equal(c.canonicalFile, '/projects/a space/design_files/example_bundle/example_bundle.json')
    assert.equal(c.finishTool, mode === 'main' ? 'design_finish_main_bundle' : 'design_finish_run')
    assert.deepEqual(c.validation, { executable: input.executable,
      argv: [input.cliEntry, 'validate', '--project', input.projectRoot, '--kit', input.kitRoot,
        '--state-root', input.stateRoot, '--skill', input.skill, '--scope', 'completion'] })
    assert.match(c.instructions, /native filesystem write\/edit tools/)
    assert.match(c.instructions, /no standalone MCP tool with this name/)
    assert.match(c.instructions, /same executor for repair/)
    assert.match(c.instructions, /actual native tool names, error and Agent type\/tool restrictions/)
    assert.match(c.instructions, /caller must not repair a subagent Bundle in main/)
    assert.match(c.instructions, /do not bypass approval, use content-upgrade tools/)
    assert.match(c.instructions, /Do not reapply user Panel saves/)
    if (host === 'workbuddy' && mode === 'subagent') {
      assert.match(c.instructions, /after the Producer returns, main calls design_finish_run/)
      assert.match(c.instructions, /Main does not edit the Producer files/)
    } else assert.doesNotMatch(c.instructions, /This caller settlement/)
  })
}

test('incomplete separate CLI context never fabricates paths or skips finish validation', () => {
  for (const missing of ['cliEntry', 'kitRoot', 'stateRoot']) {
    const c = nativeExecutionContract({ ...input, [missing]: undefined, host: 'workbuddy', mode: 'subagent' })
    assert.equal(c.validation, undefined)
    assert.match(c.instructions, /Do not guess an installed path, Kit or content store, or install one/)
    assert.match(c.instructions, /finish operation below still performs the full authoritative validation/)
  }
  assert.throws(() => nativeExecutionContract({ ...input, host: 'workbuddy', mode: 'background' }), /placement/)
})

test('installed WorkBuddy instructions forward the shared contract rather than invent a second mapping', async () => {
  const skill = await readFile(new URL('../hosts/workbuddy/design-SKILL.md', import.meta.url), 'utf8')
  assert.match(skill, /complete returned (?:Bundle )?`method`/)
  assert.match(skill, /`executionContract`/)
  assert.match(skill, /Do not choose a read-only research Agent/)
  assert.match(skill, /MCP tools alone cannot/)
  assert.match(skill, /WorkBuddy does not use\s+Codex `launchCallId`/)
})

test('installed Host entry examples use the shared canonical Kit command', async () => {
  for (const path of [
    '../plugin/design-system/skills/yugoo/SKILL.md',
    '../plugin/design-system/README.md',
    '../plugin-claude/design-system/skills/yugoo/SKILL.md',
    '../plugin-qoder/design-system/skills/yugoo/SKILL.md',
    '../plugin-qoder/design-system/commands/yugoo.md',
    '../plugin-qwenwork/design-system/skills/yugoo/SKILL.md',
    '../hosts/workbuddy/design-SKILL.md',
  ]) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /\bkit (?:web_app|<kit>)/, path)
    assert.doesNotMatch(source, /\bmindset web_app\b/, path)
  }
})
