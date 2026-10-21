/** Native factory boundary tests with a scripted Agent, not a real model acceptance claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNativeContentMigration } from '../lib/dsh-design-execution-plugin.js'
import { ProjectContentCandidate } from '../lib/index.js'

async function fixture(t, terminal = 'completed') {
  const root = await mkdtemp(join(tmpdir(), 'content-native-factory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const candidateRoot = join(root, 'candidate'), definitions = join(root, 'definitions.json')
  await mkdir(join(candidateRoot, 'design_files', 'example'), { recursive: true })
  await writeFile(join(candidateRoot, 'design_files/example/example.json'), '{"oldName":"saved fact"}')
  await writeFile(definitions, JSON.stringify({ source: { method: 'full source method', resources: { contract: 'preserve facts' } }, target: { method: 'full target method' } }))
  const tools = new Map(), restrictions = [], events = [], validations = []
  let disposed = false, created
  const child = { session: { events, append: (type, data) => events.push({ type, data }) }, cancel() {}, followup() {},
    async whenIdle() {
      const call = (name, args) => tools.get(name).execute(args, {})
      await assert.rejects(call('write_upgrade_file', { path: '../live/project.json', content: '{}' }), /relative path/)
      await assert.rejects(call('write_upgrade_file', { path: '/tmp/live', content: '{}' }), /relative path/)
      await assert.rejects(call('validate_upgrade', { status: 'equivalent', summary: 'test', sources: [], unresolvedFacts: [] }), /complete required methods/)
      for (const side of ['source', 'target']) {
        let offset = 0
        do { const result = JSON.parse((await call('read_upgrade_definition', { side, offset })).content); offset = result.nextOffset } while (offset !== null)
      }
      const evidence = { status: 'equivalent', summary: 'Rename only, preserve the saved fact', sources: [{ file: 'design_files/example/example.json', explanation: 'same meaning' }], unresolvedFacts: [] }
      const invalid = await call('validate_upgrade', evidence)
      assert.equal(JSON.parse(invalid.content).accepted, false)
      await call('write_upgrade_file', { path: 'example/example.json', content: '{"newName":"saved fact"}' })
      assert.match((await call('validate_upgrade', evidence)).content, /accepted/)
      events.push({ type: 'turn/end', data: { reason: { kind: terminal } } })
    } }
  const parent = { options: { provider: 'existing-host-route', model: 'existing-host-model' },
    session: { id: 'parent-native', header: { id: 'parent-native', cwd: root }, requestHeader: () => undefined },
    ctx: { get: () => undefined, agents: { async create(request) {
      created = request
      await request.setup({ get: () => undefined, on() {},
        systemPrompt: { getContextOrder() { return 0 }, getSectionOrder() { return 0 }, context() {}, section() {} }, tools: { register(tool) { tools.set(tool.name, tool) }, restrict(filter) { restrictions.push(filter); return () => {} } } }, child)
      return { agent: child, async dispose() { disposed = true } }
    } } } }
  const candidate = new ProjectContentCandidate(candidateRoot, definitions)
  const migration = { async candidate() { return candidate }, async validateCandidate(id) {
    validations.push(id)
    const state = JSON.parse(await readFile(join(candidateRoot, 'design_files/example/example.json'), 'utf8'))
    if (state.newName !== 'saved fact') throw new Error('target contract: newName must preserve saved fact')
  } }
  const run = () => runNativeContentMigration({ parent, migration, signal: new AbortController().signal,
    plan: { id: 'candidate-id', projectId: 'same-project', sourceCheckpoint: 'pinned-source', candidateRoot, definitions, method: 'Complete source and target semantic conversion.' } })
  return { run, tools, restrictions, validations, created: () => created, disposed: () => disposed }
}

test('native factory installs only candidate capabilities; same child repairs and normal terminal owns proof', async t => {
  const f = await fixture(t), result = await f.run()
  assert.deepEqual(f.restrictions, [{ allow: [] }])
  assert.deepEqual([...f.tools.keys()], ['read_upgrade_definition', 'list_upgrade_files', 'read_upgrade_file', 'write_upgrade_file', 'validate_upgrade'])
  assert.equal(f.created().agentOptions.provider, 'existing-host-route')
  assert.equal(f.created().agentOptions.model, 'existing-host-model')
  assert.equal(f.validations.length, 2, 'repair remains in this factory-created child')
  assert.equal(result.proof.sessionId, f.created().sessionId)
  assert.equal(result.proof.parentSessionId, 'parent-native')
  assert.equal(result.evidence.status, 'equivalent')
  assert.equal(f.disposed(), true)
})

test('an abnormal native terminal cannot become an adoption receipt despite valid candidate bytes', async t => {
  const f = await fixture(t, 'cancelled')
  await assert.rejects(f.run(), /did not complete normally/)
  assert.equal(f.disposed(), true)
})
