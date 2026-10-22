import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { register } = await import('tsx/esm/api')
register()
const { parseDesignCommand, runDesignProjectCommand } = await import('../src/design-project-adapter.ts')

test('compose_spec pins published design and prepares existing-convention composition without writes', async () => {
  const calls = []
  const ctx = {
    conversation: { current: async () => ({ projectId: 'p1' }) },
    projects: {
      open: async id => { calls.push(['open', id]); return { name: 'Example', root: '/design/example', kit: { name: 'web_app', version: '1' } } },
      snapshot: async id => { calls.push(['snapshot', id]); return { checkpoint: 'published-123', bundleStates: {} } },
    },
  }
  const parsed = parseDesignCommand('compose_spec Activity browsing')
  assert.deepEqual(parsed, { verb: 'compose_spec', argument: 'Activity browsing' })
  const result = await runDesignProjectCommand(parsed, ctx)
  assert.equal(result.kind, 'success')
  assert.match(result.text, /尚未生成或写入 Spec/)
  for (const value of ['/design/example', 'published-123', 'web_app@1', 'Activity browsing', 'Spec Kit', 'OpenSpec', 'Kiro', 'artifacts']) assert.ok(result.conversationPrompt.includes(value), value)
  assert.match(result.conversationPrompt, /保持 Design Files.*只读/)
  assert.match(result.conversationPrompt, /仅在用户另有实现授权/)
  assert.deepEqual(calls, [['open', 'p1'], ['snapshot', 'p1']])
  assert.equal(result.sourceRevision, undefined)
})

test('compose_spec requires a selected project and allows an omitted brief', async () => {
  const result = await runDesignProjectCommand(parseDesignCommand('compose_spec'), {
    conversation: { current: async () => undefined }, projects: {},
  })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /先使用/)
  assert.deepEqual(parseDesignCommand('compose_spec'), { verb: 'compose_spec' })
})

test('canonical public documentation exposes composition without promising an automatic export or coding authority', async () => {
  for (const name of ['README.md', 'README.en.md']) {
    const readme = await readFile(new URL(`../../../${name}`, import.meta.url), 'utf8')
    assert.match(readme, /docs\/design-development-handoff\.md/)
  }
  const guide = await readFile(new URL('../../../docs/design-development-handoff.md', import.meta.url), 'utf8')
  assert.match(guide, /\/yugoo compose_spec \[功能范围\]/)
  assert.match(guide, /已授权的代码工作区/)
  assert.match(guide, /没有既有\s*规范时采用 Spec Kit/)
  assert.doesNotMatch(guide, /不是.*默认选型|不代表产品默认采用 Spec Kit/)
  assert.match(guide, /不授权开始编码/)
  assert.match(guide, /不修改 Design Files/)
  const command = await readFile(new URL('../../../docs/design-command-agent-entry.md', import.meta.url), 'utf8')
  assert.match(command, /command\s+receipt is not generated files/)
  assert.match(command, /does not authorize implementation/)
  const policy = await readFile(new URL('../../../docs/wiki/project-files.md', import.meta.url), 'utf8')
  assert.match(policy, /PRD.*汇总产物.*不能反过来覆盖.*不作为新的独立 KAG 事实源/)
})
