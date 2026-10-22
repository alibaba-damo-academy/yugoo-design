import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { registerServiceTools } = await import('../src/service-tools.ts')
const { registerDshProducerDesignTools } = await import('../src/dsh-producer-design-tools.ts')
const { renderDesignSkillCatalog, DESIGN_CORE_PROGRESSION_PROMPT } = await import('../src/design-core-prompt.ts')
const { DESIGN_SKILL_RESOURCE_GUIDANCE } = await import('../src/design-generation-guidance.ts')
const { producerSystemPrompt } = await import('../src/dsh-design-execution-plugin.ts')

function registry() {
  const definitions = new Map()
  return { definitions, ctx: { tools: { register(tool) { definitions.set(tool.name, tool); return () => {} } } } }
}
const skill = name => ({ name, title: { zh: name, en: name }, label: { zh: name, en: name },
  description: 'A bounded design capability.', content: 'Domain method, injected only into execution.',
  execution: { mode: 'main', handoff: 'none' } })
const exec = { agent: {}, signal: new AbortController().signal }

test('mounted entry stays generic, with full methods limited to the selected executor', () => {
  for (const name of ['warehouse_planning', 'community_events']) {
    const selected = skill(name)
    const catalog = renderDesignSkillCatalog({ skills: [selected] })
    assert.match(catalog, /already mounted/)
    assert.match(catalog, /Read-only consultation does not require an invocation/)
    assert.ok(catalog.includes(`id: ${name}`))
    assert.ok(!catalog.includes(selected.content), 'catalog must not preload every professional method')
    for (const mode of ['main', 'subagent']) {
      const prompt = producerSystemPrompt({ ...selected, execution: { ...selected.execution, mode } },
        { allowed: [], unavailableOptional: [] }, '/application', false, {}, '/project/design_files')
      assert.ok(prompt.includes(selected.content))
      assert.equal(prompt.split(DESIGN_SKILL_RESOURCE_GUIDANCE).length, 2)
    }
  }
  assert.equal(DESIGN_CORE_PROGRESSION_PROMPT.split(DESIGN_SKILL_RESOURCE_GUIDANCE).length, 2)
  assert.ok(DESIGN_CORE_PROGRESSION_PROMPT.indexOf('Design skills create or revise persistent Design Files;')
    < DESIGN_CORE_PROGRESSION_PROMPT.indexOf('Only for an explicitly requested reconstruction'))
})

test('reconstruction retains the same resource entry without injecting the forward method', () => {
  const selected = { ...skill('warehouse_planning'),
    metadata: { schemaYaml: 'type: object', validationYaml: 'skill: warehouse_planning\nrules: []' } }
  for (const mode of ['main', 'subagent']) {
    const prompt = producerSystemPrompt({ ...selected, execution: { ...selected.execution, mode } },
      { allowed: [], unavailableOptional: [] }, '/application', true,
      { 'warehouse_planning/reference/artifact-contract.md': 'Synthetic output contract.' }, '/project/design_files')
    assert.equal(prompt.split(DESIGN_SKILL_RESOURCE_GUIDANCE).length, 2)
    assert.ok(!prompt.includes(selected.content), 'reconstruction keeps its own evidence-conversion method')
    assert.match(prompt, /reference\/artifact-contract\.md/)
    assert.match(prompt, /Script execution never publishes Design Files/)
  }
  assert.throws(() => producerSystemPrompt(skill('warehouse_planning'),
    { allowed: [], unavailableOptional: [] }, '/application', true), /missing its loaded schema or validation contract/)
})

test('main discovery uses the current pinned Kit, preserves full pages, and reports missing resources without filesystem fallback', async () => {
  const r = registry(), selected = skill('warehouse_planning')
  const original = '中文🧭方法'.repeat(4000)
  let active = { skills: [selected], resources: { 'warehouse_planning/reference/guide.md': original } }
  registerServiceTools(r.ctx, { kitForAgent: () => active })
  const tool = r.definitions.get('read_skill_resource')
  const args = { skill: selected.name, path: 'reference/guide.md', max_chars: 1000 }
  const first = await tool.execute(args, exec)
  assert.equal(first.complete, false)
  assert.ok(tool.output.render(args, first)[0].text.includes(first.content), 'render must not truncate at 400 characters')
  const second = await tool.execute({ ...args, offset: first.next_offset }, exec)
  assert.equal(second.offset, 1000)
  let content = first.content, page = first
  while (!page.complete) {
    page = await tool.execute({ ...args, offset: page.next_offset }, exec)
    content += page.content
  }
  assert.equal(content, original, 'all Unicode pages retain the exact mounted resource')
  assert.equal(page.next_offset, undefined)
  await assert.rejects(tool.execute({ ...args, max_chars: 0 }, exec), /max_chars/)
  await assert.rejects(tool.execute({ ...args, offset: -1 }, exec), /offset/)
  active = { ...active, resources: { 'warehouse_planning/reference/guide.md': 'new exact pin' } }
  assert.equal((await tool.execute(args, exec)).content, 'new exact pin')
  await assert.rejects(tool.execute({ ...args, path: 'reference/missing.mjs' }, exec), error => {
    assert.match(error.message, /resource not found/)
    assert.match(error.message, /mounted Bundle/)
    assert.match(error.message, /run_design_skill supplies that method/)
    return true
  })
  await assert.rejects(tool.execute({ ...args, path: '../outside' }, exec), /inside the skill package/)
  await assert.rejects(tool.execute({ ...args, skill: 'another_bundle' }, exec), /not in the active kit/)
  active = undefined
  await assert.rejects(tool.execute(args, exec), /not in the active kit/)
})

test('engaged resource reads retain bound authority and the same missing-resource recovery', async () => {
  const r = registry(), reads = []
  registerDshProducerDesignTools(r.ctx, {}, { async read(path) {
    reads.push(path); return path === 'reference/guide.md' ? 'bound method reference' : undefined
  } }, 'none', {})
  const tool = r.definitions.get('read_skill_resource')
  assert.equal((await tool.execute({ path: 'reference/guide.md' }, exec)).content, 'bound method reference')
  await assert.rejects(tool.execute({ path: 'reference/missing.mjs' }, exec), /do not search installation directories/)
  const before = reads.length
  for (const path of ['../outside', '/absolute', 'C:\\outside', '', 'reference/../outside']) {
    await assert.rejects(tool.execute({ path }, exec), /skill package|relative path|relative|resource paths/)
  }
  assert.equal(reads.length, before, 'invalid paths never reach the resource port')
})
