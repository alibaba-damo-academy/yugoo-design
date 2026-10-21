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

test('public README exposes composition without promising an automatic export or coding authority', async () => {
  const readme = await readFile(new URL('../../../release/README.public.md', import.meta.url), 'utf8')
  const section = readme.split('## Continue into development\n')[1].split('\n## Development and documentation')[0]
  assert.match(section, /\/yugoo compose_spec \[feature scope\]/)
  assert.match(section, /assemble the current design into a development spec/)
  assert.match(section, /authorized coding workspace/)
  assert.match(section, /prepared-task receipt is not a generated spec/)
  assert.match(section, /does not authorize implementation/)
  assert.match(section, /Spec and PRD outputs are not re-ingested into KAG/)
})
