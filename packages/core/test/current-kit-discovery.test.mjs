/** Actual SDK prompt assembly and Core discovery; finite library metadata, no model. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import DesignService from '../src/design-service.ts'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'current-kit-discovery-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(SystemPrompt, { persona: 'Kit discovery test' })
  ctx.provide('tools', { register() {}, get() {} })
  ctx.provide('subprocess', {})
  const service = new DesignService(ctx, { stateRoot: join(root, 'state'), projectsRoot: join(root, 'projects'), hostInstanceId: 'discovery-test' })
  const installed = { name: 'installed_kit', version: '1.0', description: 'Installed source', mindset: 'Installed method', skills: [] }
  service.kits.set(installed.name, { latestVersion: installed.version, versions: new Map([[installed.version, installed]]) })
  const assemble = async (agent, signal) => (await ctx.systemPrompt.assemble({ agent, signal })).sections.find(section => section.name === 'design:mindset')?.text
  return { ctx, service, installed, assemble }
}

test('prompt assembly and project picker discover current imports and observe later saves without a cache', async t => {
  const { service, assemble, installed } = await fixture(t)
  let current = [{ name: 'local_kit', version: '1.0', description: 'Locally imported method' }]
  let loads = 0
  const dispose = service.registerCurrentKitSource({ list: async () => current, load: async () => { loads++; return undefined } })
  const agent = { id: 'unselected', session: { header: {} } }
  let prompt = await assemble(agent)
  assert.match(prompt, /local_kit: Locally imported method/)
  assert.match(prompt, /installed_kit: Installed source/)
  assert.doesNotMatch(prompt, /\[object Promise\]/)
  const choices = await service.listCurrentKits()
  assert.deepEqual((await service.listProjectCatalog(agent)).mindsets, choices)
  assert.equal(loads, 0, 'discovery never loads or activates a Kit')
  current = [{ name: installed.name, version: '1.0', description: 'Saved local customization' }]
  prompt = await assemble(agent)
  assert.match(prompt, /installed_kit: Saved local customization/)
  assert.doesNotMatch(prompt, /local_kit|Installed source/)
  assert.equal((await service.listCurrentKits()).length, 1, 'current local source overrides the same installed identity')
  dispose()
  assert.match(await assemble(agent), /installed_kit: Installed source/)
})

test('local-only discovery works and an unavailable listing stays explicit without blocking normal conversation', async t => {
  const { service, assemble } = await fixture(t)
  service.kits.clear()
  const agent = { id: 'local-only', session: { header: {} } }
  let fail = false
  service.registerCurrentKitSource({ list: async () => { if (fail) throw new Error('fixture source unavailable'); return [{ name: 'local_only', version: '1.0' }] }, load: async () => undefined })
  assert.equal(await assemble(), '', 'diagnostic assembly without an Agent does not read local storage')
  assert.match(await assemble(agent), /local_only/)
  fail = true
  assert.match(await assemble(agent), /Local Kit discovery is temporarily unavailable/)
  await assert.rejects(service.listCurrentKits(), /fixture source unavailable/, 'explicit catalog reads report failure')
  const controller = new AbortController(); controller.abort(new Error('request cancelled'))
  await assert.rejects(assemble(agent, controller.signal), /request cancelled/)
})

test('discovery never replaces active project source, an unavailable project pin, or a child prompt', async t => {
  const { service, assemble, installed } = await fixture(t)
  let lists = 0
  service.registerCurrentKitSource({ list: async () => { lists++; return [{ name: 'local', version: '1.0' }] }, load: async () => undefined })
  const agent = { id: 'active', session: { header: {} } }
  service.kitForAgent = value => value === agent ? installed : undefined
  service.activeWorkspaces.set(agent, { project: { kit: { name: installed.name, version: installed.version } } })
  assert.match(await assemble(agent), /active_design_mindset/)
  service.kitForAgent = () => undefined
  assert.match(await assemble(agent), /design_kit_unavailable/)
  const child = { id: 'child', session: { header: { origin: 'subagent' } } }
  assert.doesNotMatch(await assemble(child), /- local/)
  assert.equal(lists, 0)
})
