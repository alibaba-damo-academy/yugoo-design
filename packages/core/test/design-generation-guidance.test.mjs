import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
const { register } = await import('tsx/esm/api'); register()
const { DESIGN_CORE_PROGRESSION_PROMPT } = await import('../src/design-core-prompt.ts')
const { DESIGN_EXECUTOR_EVIDENCE_GUIDANCE, DESIGN_WORKER_EVIDENCE_GUIDANCE } = await import('../src/design-generation-guidance.ts')
const { KNOWLEDGE_AGENTIC_GUIDANCE } = await import('../src/design-knowledge-query.ts')
const { producerSystemPrompt, producerEvidenceTools } = await import('../src/dsh-design-execution-plugin.ts')
const { loadDesignKit } = await import('../src/kit-loader.ts')

const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (e) { if (e.code === 'ENOENT') return undefined; throw e } },
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
const kitPromise = loadDesignKit(fs, new URL('../../skills-web-app/', import.meta.url).pathname, { sourceId: 'package:dsh-design-skills-web-app' })

test('Panel save continuation consumes committed state without replaying settled Bundle tools', () => {
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /After a successful meaningful Panel save, the Design service has already validated and committed the user's edits/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /assess the newly injected saved state before your final reply or next-step recommendation/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /do not call design_validate or design_publish again for that save/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /conversation history are not current capabilities/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /scoped tools are revoked, including design_validate/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /save-and-continue message is not permission to reopen the prior Bundle/)
  assert.match(DESIGN_CORE_PROGRESSION_PROMPT, /current user request authorizes a new persistent result or an actual interrupted invocation needs recovery/)
})

test('real executor prompt preserves evidence guidance in both execution placements', async () => {
  const kit = await kitPromise
  const skill = kit.skills.find(s => s.name === 'page_design')
  for (const mode of ['main', 'subagent']) {
    const prompt = producerSystemPrompt({ ...skill, execution: { ...skill.execution, mode } },
      { allowed: ['design_query_knowledge'], unavailableOptional: [] }, '/app', false, kit.resources, '/project/design_files')
    assert.ok(prompt.includes(DESIGN_EXECUTOR_EVIDENCE_GUIDANCE))
    assert.ok(prompt.includes(KNOWLEDGE_AGENTIC_GUIDANCE))
    assert.ok(prompt.includes(skill.content))
    assert.match(prompt, /only files owned by the current Bundle/)
  }
  assert.ok(DESIGN_CORE_PROGRESSION_PROMPT.includes(DESIGN_EXECUTOR_EVIDENCE_GUIDANCE))
  assert.ok(DESIGN_CORE_PROGRESSION_PROMPT.includes(KNOWLEDGE_AGENTIC_GUIDANCE))
})

test('Producer inherits optional read-only graph access without requiring a Kit declaration or widening writes', () => {
  const declared = { producerTools: ['web_search'], optionalProducerTools: ['web_fetch'] }
  const available = new Set(['web_search', 'read', 'design_query_knowledge', 'design_refresh_knowledge', 'write'])
  const agent = { ctx: { tools: { get: name => available.has(name) ? {} : undefined } } }
  assert.deepEqual(producerEvidenceTools(agent, declared).allowed, ['web_search', 'read', 'design_query_knowledge'])
  available.add('design_git_read')
  assert.deepEqual(producerEvidenceTools(agent, declared).allowed, ['web_search', 'read', 'design_query_knowledge', 'design_git_read'])
  available.delete('design_git_read')
  available.delete('design_query_knowledge')
  assert.deepEqual(producerEvidenceTools(agent, declared).allowed, ['web_search', 'read'])
  available.delete('web_search')
  assert.throws(() => producerEvidenceTools(agent, declared), /required evidence tools/)
})

test('Producer locates installed Bundle references and validators independently of its WorkingCopy', async () => {
  const kit = await kitPromise
  const page = kit.skills.find(skill => skill.name === 'page_design')
  assert.equal(typeof kit.resources['page_design/reference/artifact-contract.md'], 'string')
  assert.equal(typeof kit.resources['page_design/scripts/page-design.mjs'], 'string')
  assert.match(page.content, /read_skill_resource\(\{path:"reference\/artifact-contract\.md"\}\)/)
  assert.match(page.content, /path:"page-design\.mjs"/)
  assert.match(page.content, /Never replace the file validator with hand-written/)
  const contract = kit.resources['page_design/reference/artifact-contract.md']
  assert.ok(contract.includes('`path:"page-design.mjs"`, not `scripts/page-design.mjs`'))
  for (const mode of ['main', 'subagent']) {
    const prompt = producerSystemPrompt({ ...page, execution: { ...page.execution, mode } },
      { allowed: [], unavailableOptional: [] }, '/app', false, kit.resources, '/project/design_files')
    assert.match(prompt, /installed Kit resources, not Design Project WorkingCopy files/)
    assert.match(prompt, /read_skill_resource using its Bundle-relative path/)
    assert.match(prompt, /run_skill_script using its path below scripts\//)
    assert.match(prompt, /page-design\.mjs \(not scripts\/page-design\.mjs\)/)
    assert.match(prompt, /input_file refers to the project artifact/)
    assert.match(prompt, /empty WorkingCopy glob\/list.*does not show that a Kit resource is missing/)
    assert.match(prompt, /Do not skip a declared validation step, invent its bindings/)
  }
})

test('loaded Page method reaches task synthesis resource without schema or version additions', async () => {
  const kit = await kitPromise
  const page = kit.skills.find(s => s.name === 'page_design')
  assert.equal(String(kit.version), '1.0')
  assert.equal(String(page.version), '1.0')
  assert.match(page.content, /reference\/task-to-page-method.md/)
  const method = kit.resources['page_design/reference/task-to-page-method.md']
  assert.equal(typeof method, 'string')
  assert.match(method, /does not automatically earn a/)
  assert.match(method, /common_spec.layout/)
  assert.match(method, /No|no schema/)
  assert.match(kit.skills.find(s => s.name === 'research').content, /own citation provenance/)
  assert.match(kit.skills.find(s => s.name === 'flow_design').content, /design_delegate_frontier/)
  assert.match(DESIGN_WORKER_EVIDENCE_GUIDANCE, /smallest relevant source record/)
})

test('loaded Research method exposes the HTML contract as an Agent review duty', async () => {
  const kit = await kitPromise
  const research = kit.skills.find(skill => skill.name === 'research')
  assert.match(research.content, /reference\/artifact-contract\.md/)
  const contract = kit.resources['research/reference/artifact-contract.md']
  assert.equal(typeof contract, 'string')
  assert.match(contract, /<!DOCTYPE html>/)
  assert.match(contract, /Before publication, the executor rereads `conclusion\.html`/)
  assert.match(contract, /repair truncated, fence-wrapped or unbalanced content/)
  assert.match(contract, /Agent review duty/)
  assert.match(contract, /rules, which do not inspect HTML structure/)
  assert.doesNotMatch(contract, /settlement gate validates the tag structure/)
})
