/** Actual installed factory/tools/loop, scripted LLM; not live-model or GUI acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, readFile, readdir, stat, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDshTestRuntime } from './dsh-asar-test-loader.mjs'

assert.ok(Boolean(process.env.DSH_TEST_WEB_ANCHOR) !== Boolean(process.env.DSH_TEST_ASAR), 'exactly one explicit installed Host graph is required')
const runtime = loadDshTestRuntime({ webAnchor: process.env.DSH_TEST_WEB_ANCHOR, asar: process.env.DSH_TEST_ASAR })
const { Context } = await import('@deepseek-ai/cordis')
const { createDshAdvisoryAgent, dshAdvisoryBackend } = await import('../src/dsh-advisory-agent.ts')
const { analyzeDshDesignAdvisory } = await import('../src/dsh-advisory-runner.ts')
const { OFFICIAL_GROUNDING_PROFILE } = await import('../src/official-advisory-profiles.ts')
const { evaluatePublishedDesignClarity } = await import('../src/dsh-clarity-evaluator.ts')
const { createAdvisoryEvidence } = await import('../src/advisory-evidence.ts')
const { loadDesignKit, createDirectoryBundleResolver } = await import('../src/kit-loader.ts')
const { projectKitContentHash } = await import('../src/project-content.ts')
const { advisoryKnowledgeModelContext, readAdvisoryDesignKnowledge } = await import('../src/advisory-knowledge.ts')
const [llm, sessions, prompt, tools, agents, loop, projections, subagents, query] = await Promise.all(
  ['dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop', 'dsh-session-projection', 'dsh-subagent', 'dsh-session-query']
    .map(name => import('@deepseek-ai/' + name)))
test.after(() => runtime.close())
const factoryBackend = dshAdvisoryBackend(subagents.default.prototype) === 'agent-factory'
const schema = { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } }
const call = (name, args) => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: llm.ToolCallId(randomUUID()), name, arguments: JSON.stringify(args) } },
  { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, { type: 'finish', reason: { kind: 'tool-calls' } },
]
const stop = () => [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, { type: 'finish', reason: { kind: 'stop' } }]

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'advisory-sdk-')); t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  for (const [plugin, config] of [[llm.default], [sessions.default], [prompt.default, { persona: 'review isolation test' }],
    [tools.default], [projections.default], [query.default], [agents.default], [loop.default, { agents: [] }]]) await ctx.plugin(plugin, config)
  // RC3 requires the public working-directory service. Its real filesystem
  // implementation is rooted in this test's owned directory, not a Host profile.
  if (subagents.default.inject?.includes('workingDirectory')) {
    const [fs, directory] = await Promise.all(['dsh-fs-local', 'dsh-working-directory'].map(name => import('@deepseek-ai/' + name)))
    await ctx.plugin(fs.default, { cwd: root })
    await ctx.plugin(directory.default, { defaultDirectory: root })
  }
  await ctx.plugin(subagents.default)
  let requests = 0
  const seen = [], results = [], children = [], modelErrors = [], nativeStarts = [], nativeEnds = []
  ctx.on('subagent/start', info => nativeStarts.push(info))
  ctx.on('subagent/end', info => nativeEnds.push(info))
  class Scripted extends llm.LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(request) {
      seen.push(request.tools.map(t => t.name))
      try { yield* await options.step(requests++, request) }
      catch (error) { modelErrors.push(error); throw error }
    }
  }
  ctx.llm.registerAdapter(['review-fixture'], new Scripted())
  const parent = await ctx.agents.create({ sessionId: sessions.SessionId(randomUUID()), meta: { cwd: root },
    agentOptions: { provider: 'review-fixture', model: 'same-native-route' } })
  t.after(() => parent.dispose())
  ctx.on('tools/result', (exec, result) => { results.push({ name: exec.name, isError: result.isError }) })
  ctx.on('agent/created', async ({ agent }) => {
    if (agent === parent.agent) return
    children.push(agent)
    assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'sandbox/mode').at(-1).data.mode, 'read-only')
    assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'approval/policy').at(-1).data.policy, 'never')
    await options.created?.(agent)
  })
  const evidence = options.evidence ?? { manifest: { checkpoint: 'a'.repeat(40), paths: ['project.json'] }, list: () => ['project.json'],
    read: async () => ({ content: 'committed fact' }), search: async () => ({ matches: [] }), resource: () => ({ content: 'exact pinned method' }) }
  const port = createDshAdvisoryAgent(options.evidenceFor ?? (async () => evidence))
  const request = { parent: parent.agent, reviewCommit: 'a'.repeat(40), label: 'Read-only test',
    signal: AbortSignal.timeout(15000), outputSchema: schema, prompt: [{ type: 'text', text: 'Read and report.' }] }
  return { ctx, root, parent, port, request, seen, results, children, modelErrors, nativeStarts, nativeEnds }
}

test('unknown runtime shapes reject rather than choosing an exception fallback', () => {
  for (const shape of [undefined, {}, { start: 'not callable' }, { startActivation() {} }]) {
    assert.throws(() => dshAdvisoryBackend(shape), /unavailable|unsupported/)
  }
})

test('RC3 factory has real readonly child lifecycle without manager catalog, events or parent wake', { skip: !factoryBackend }, async t => {
  let entered, release
  const inModel = new Promise(resolve => { entered = resolve })
  const finish = new Promise(resolve => { release = resolve })
  t.after(() => release())
  const f = await fixture(t, { async step() { entered(); await finish; return call('structured_output', { value: 'factory' }) } })
  const providers = f.ctx.subagents.list()
  const run = await f.port.start('spawn', f.request)
  try {
    await inModel
    assert.equal(f.children.length, 1)
    const child = f.children[0]
    assert.equal(run.id, child.id)
    assert.equal(child.session.header.parentSession, f.parent.agent.id)
    assert.equal(child.options.provider, f.parent.agent.options.provider)
    assert.equal(child.options.model, f.parent.agent.options.model)
    assert.equal(child.session.header.delegationDepth, 1)
    assert.equal(f.ctx.agents.get(run.id), child)
    assert.equal(child.session.snapshotEvents().filter(e => e.type === 'turn/start').length, 1)
    assert.equal(child.session.snapshotEvents().filter(e => e.type === 'turn/end').length, 0)
    assert.equal(child.session.snapshotEvents().filter(e => e.type === 'subagent/descriptor').length, 0)
    assert.deepEqual(await f.ctx.subagents.listChildren(f.parent.agent.id), [])
    assert.deepEqual(f.ctx.subagents.list(), providers)
    assert.equal(f.nativeStarts.length, 0)
    release()
    assert.deepEqual(await run.result, { stopReason: 'completed', structured: { value: 'factory' } })
    assert.equal(agents.foldConsumedWork(child.session.snapshotEvents()).end.data.reason.kind, 'completed')
  } finally { await Promise.all([run.dispose(), run.dispose()]) }
  assert.equal(f.ctx.agents.get(run.id), undefined)
  assert.equal(f.nativeEnds.length, 0)
  assert.deepEqual(await f.ctx.subagents.listChildren(f.parent.agent.id), [])
  assert.equal(f.parent.agent.session.snapshotEvents().filter(e => e.type === 'turn/start').length, 0)
  assert.equal(f.parent.agent.inbox.nextTurn.length, 0)
  assert.equal(f.parent.agent.inbox.nextStep.length, 0)
})

test('readonly startup rejects non-live parent, depth overflow and pre-abort before evidence or child creation', async t => {
  let reads = 0
  const f = await fixture(t, { evidenceFor: async () => { reads++; throw Error('must not load evidence') }, step: () => stop() })
  await assert.rejects(f.port.start('spawn', { ...f.request, parent: { ...f.parent.agent } }), /parent|UNAUTHORIZED/)
  await assert.rejects(f.port.start('spawn', { ...f.request, maxDepth: 0 }), /depth/)
  for (const maxDepth of [-1, NaN, Infinity, 1.5]) {
    await assert.rejects(f.port.start('spawn', { ...f.request, maxDepth }), /[Dd]epth/)
  }
  await assert.rejects(f.port.start('spawn', { ...f.request, signal: AbortSignal.abort(Error('pre-abort')) }), /pre-abort/)
  assert.equal(reads, 0)
  assert.equal(f.children.length, 0)
  assert.equal(f.seen.length, 0)
})

test('cancelled evidence load cannot publish a late native child', async t => {
  const abort = new AbortController()
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const pending = new Promise(resolve => { release = resolve })
  const f = await fixture(t, { async evidenceFor() { enter(); await pending; return { manifest: {}, list: () => [] } }, step: () => stop() })
  const run = f.port.start('spawn', { ...f.request, signal: abort.signal })
  await entered
  abort.abort(Error('cancelled while loading evidence'))
  release()
  await assert.rejects(run, /cancelled while loading evidence/)
  assert.equal(f.children.length, 0)
  assert.equal(f.ctx.subagents.list().length, 0)
})

test('native route snapshot precedes a parent model switch during evidence loading', { skip: !factoryBackend }, async t => {
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const pending = new Promise(resolve => { release = resolve })
  const f = await fixture(t, { async evidenceFor() { enter(); await pending; return { manifest: {}, list: () => [] } },
    step(_n, request) { return request.tools.some(tool => tool.name === 'structured_output') ? call('structured_output', { value: 'pinned route' }) : stop() } })
  const runPromise = f.port.start('spawn', f.request)
  await entered
  agents.installModelSelection(f.parent.agent.ctx, { current: { provider: 'review-fixture', model: 'changed-after-start' } })
  f.parent.agent.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'Scripted model switch.' }], source: { kind: 'user' } }))
  await f.parent.agent.whenIdle()
  assert.equal(f.parent.agent.session.requestHeader().config.model, 'changed-after-start')
  release()
  const run = await runPromise
  try {
    assert.equal(f.children[0].options.model, 'same-native-route')
    assert.equal((await run.result).structured.value, 'pinned route')
  } finally { await run.dispose() }
})

test('actual SDK discovers a running readonly review and retains its native history entry after disposal', { skip: factoryBackend }, async t => {
  let entered, release
  const enteredModel = new Promise(resolve => { entered = resolve })
  const releaseModel = new Promise(resolve => { release = resolve })
  t.after(() => release())
  const f = await fixture(t, { async step() { entered(); await releaseModel; return call('structured_output', { value: 'reviewed' }) } })
  const providers = f.ctx.subagents.list()
  const run = await f.port.start('spawn', f.request)
  try {
    await enteredModel
    const children = await f.ctx.subagents.listChildren(f.parent.agent.id)
    assert.equal(children.length, 1)
    assert.equal(children[0].id, run.id)
    assert.equal(children[0].label, f.request.label)
    assert.equal(children[0].mode, 'one-shot')
    assert.equal(f.nativeStarts.length, 1)
    assert.equal(f.nativeStarts[0].id, run.id)
    assert.equal(f.nativeStarts[0].local, true)
    assert.equal(f.nativeEnds.length, 0, 'pending native review must not look settled')
    await assert.rejects(f.ctx.subagents.start(f.nativeStarts[0].provider, {
      parent: f.parent.agent, signal: f.request.signal, prompt: f.request.prompt,
    }), /no active immutable review grant/)
    assert.equal(f.nativeStarts.length, 1, 'a known provider name cannot borrow its trusted grant')
    const events = f.children[0].session.snapshotEvents()
    assert.equal(events.filter(e => e.type === 'turn/start').length, 1)
    assert.equal(events.filter(e => e.type === 'turn/end').length, 0)
    release()
    assert.equal((await run.result).structured.value, 'reviewed')
    assert.equal(f.nativeEnds.length, 1)
    assert.equal(f.nativeEnds[0].id, run.id)
    assert.equal(f.nativeEnds[0].stopReason, 'completed')
  } finally { await run.dispose() }
  assert.equal(f.ctx.agents.get(run.id), undefined)
  assert.deepEqual(f.ctx.subagents.list(), providers, 'one-run provider is released')
  const retained = await f.ctx.subagents.listChildren(f.parent.agent.id)
  assert.equal(retained.length, 1)
  assert.equal(retained[0].id, run.id, 'native parent catalog retains the exact history address')
})

test('actual SDK model loop consumes the bounded read and resource operations', async t => {
  const sequence = [call('list', {}), call('read', { path: 'project.json' }), call('grep', { text: 'fact' }),
    call('read_skill_resource', { bundle: 'example', path: 'schema.yaml' }), call('structured_output', { value: 'read result' })]
  const f = await fixture(t, { step(n) { assert.ok(sequence[n], 'bounded model script'); return sequence[n] } })
  f.parent.agent.ctx.tools.presentAs('ptc')
  const parentSchemas = f.parent.agent.ctx.tools.schemas(f.parent.agent).map(t => t.name)
  assert.ok(parentSchemas.includes('run_code'))
  const run = await f.port.start('spawn', f.request)
  try {
    assert.equal(f.children.length, 1)
    assert.equal(run.id, f.children[0].id, 'assessment provenance is the actual native child id')
    assert.equal(f.children[0].session.header.parentSession, f.parent.agent.id)
    assert.deepEqual((await run.result).structured, { value: 'read result' })
    assert.ok(f.results.every(result => !result.isError))
    assert.deepEqual([...f.seen[0]].sort(), ['grep', 'list', 'read', 'read_skill_resource', 'structured_output'])
    assert.deepEqual(f.parent.agent.ctx.tools.schemas(f.parent.agent).map(t => t.name), parentSchemas)
  } finally { await run.dispose() }
})

test('a large exact Kit reaches both native review loops through complete paged discovery', async t => {
  const oid = 'a'.repeat(40), projectId = randomUUID()
  const skills = Array.from({ length: 33 }, (_, i) => ({ name: `bundle_${i}`, version: '1.0', content: 'Full method', metadata: {} }))
  const bundles = new Map(skills.map(skill => [skill.name, { skill, resources: Object.fromEntries(Array.from({ length: 40 }, (_, i) =>
    [`reference/complete-domain-method-${i}.md`, `Exact ${skill.name} resource ${i}`])) }]))
  const kit = { name: 'large-fixture', version: '1.0', skills, resources: {} }
  const metadata = { kind: 'dsh-design-project', formatVersion: 3, id: projectId, name: 'Paged evidence',
    createdAt: '2026-10-18T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' }, kit: { name: kit.name, version: kit.version } }
  const evidence = await createAdvisoryEvidence({ commit: oid, projectId, signal: AbortSignal.timeout(15000),
    git: { listPathsAt: async () => ['project.json'], readBytesAt: async () => Buffer.from(JSON.stringify(metadata)) },
    resolveKit: () => kit, resolveBundle: pin => bundles.get(pin.name) })
  assert.equal(evidence.manifest.discovery.bundles, 33)
  const assessment = { summary: 'Paged exact evidence.', u: { score: 70, evidence: 'Bound intent.' },
    s: { score: 60, evidence: 'Bound structure.' }, t: { score: 50, evidence: 'Bound acceptance.' } }
  for (const clarity of [true, false]) {
    const pins = []
    const f = await fixture(t, { evidence, step(n, request) {
      const system = request.messages.filter(m => m.role === 'system').flatMap(m => m.content.filter(b => b.type === 'text').map(b => b.text)).join('\n')
      assert.match(system, /"discovery"/)
      const result = n > 0 ? JSON.parse(request.messages.findLast(m => m.role === 'tool').content.find(b => b.type === 'text').text) : undefined
      if (n === 0) return call('list', { kind: 'bundles', limit: 20 })
      if (n <= 2) {
        assert.equal(result.checkpoint, oid); assert.equal(result.project, projectId)
        assert.equal(result.manifestRevision, evidence.manifest.discovery.manifestRevision)
        pins.push(...result.entries)
        if (!result.complete) return call('list', { kind: 'bundles', offset: result.nextOffset, limit: 20 })
        assert.equal(pins.length, 33)
        return call('list', { kind: 'resources', bundle: 'bundle_32', limit: 100 })
      }
      if (n === 3) {
        assert.equal(result.entries.length, 41); assert.equal(result.complete, true)
        assert.ok(result.entries.some(entry => entry.path === 'reference/complete-domain-method-39.md' && entry.sha256))
        return call('read_skill_resource', { bundle: 'bundle_32', path: 'reference/complete-domain-method-39.md' })
      }
      assert.equal(n, 4); assert.equal(result.content, 'Exact bundle_32 resource 39')
      return call('structured_output', clarity ? assessment : { value: 'complete paged review' })
    } })
    if (clarity) {
      const result = await evaluatePublishedDesignClarity({ start: f.port.start, parent: f.parent.agent, provider: 'spawn',
        projectRoot: f.root, designFilesRoot: join(f.root, 'design_files'), commit: oid, kitName: kit.name,
        kitVersion: kit.version, kit, signal: f.request.signal, timeoutMs: 5000 }).catch(error => { throw f.modelErrors[0] ?? error })
      assert.deepEqual(result.assessment, assessment)
    } else {
      const run = await f.port.start('spawn', f.request)
      try { assert.deepEqual((await run.result.catch(error => { throw f.modelErrors[0] ?? error })).structured, { value: 'complete paged review' }) }
      finally { await run.dispose() }
    }
    assert.equal(f.seen.length, 5); assert.ok(f.results.every(r => !r.isError))
  }
})

test('main resource tool renders complete Unicode pages and retains active-Kit confinement', async t => {
  const { registerServiceTools } = await import('../src/service-tools.ts')
  const guide = '方法🙂'.repeat(4500) + 'FINAL_DOMAIN_METHOD'
  const kit = { name: 'fixture', version: '1.0', skills: [{ name: 'example' }], resources: { 'example/reference/guide.md': guide } }
  const f = await fixture(t, { step: () => stop() })
  registerServiceTools(f.ctx, { kitForAgent: agent => agent === f.parent.agent ? kit : undefined })
  const definition = f.ctx.tools.get('read_skill_resource', f.parent.agent)
  const exec = { agent: f.parent.agent, signal: f.request.signal }
  let offset = 0, complete = false, reconstructed = ''
  while (!complete) {
    const page = await definition.execute({ skill: 'example', path: 'reference/guide.md', offset }, exec)
    const rendered = definition.output.render({ path: 'reference/guide.md' }, page).map(b => b.text).join('\n')
    assert.ok(rendered.includes(page.content), 'all returned page bytes reach the model, beyond the former 400-character cut')
    assert.equal(page.total_chars, Array.from(guide).length)
    assert.ok(Array.from(page.content).length <= 12000)
    reconstructed += page.content; complete = page.complete; offset = page.next_offset
  }
  assert.equal(reconstructed, guide)
  const native = await f.ctx.tools.execute({ callId: llm.ToolCallId(randomUUID()), name: 'read_skill_resource',
    arguments: { skill: 'example', path: 'reference/guide.md', offset: 13500 }, ...exec })
  assert.equal(native.isError, false); assert.match(JSON.stringify(native), /FINAL_DOMAIN_METHOD/)
  for (const args of [{ skill: 'foreign', path: 'reference/guide.md' }, { skill: 'example', path: '../private' },
    { skill: 'example', path: 'reference/guide.md', offset: -1 }, { skill: 'example', path: 'reference/guide.md', max_chars: 12001 }]) {
    const result = await f.ctx.tools.execute({ callId: llm.ToolCallId(randomUUID()), name: 'read_skill_resource', arguments: args, ...exec })
    assert.equal(result.isError, true)
  }
})

test('actual SDK denies local mutators, shell, PTC and nested delegation before any workspace/temp write', async t => {
  let writes = 0, child
  const tempTarget = join(tmpdir(), 'advisory-forbidden-' + randomUUID())
  t.after(() => rm(tempTarget, { force: true }))
  const attacks = ['write', 'bash', 'subagent', 'run_code']
  const f = await fixture(t, {
    async created(agent) {
      child = agent
      const nested = await agent.ctx.tools.execute({ callId: llm.ToolCallId(randomUUID()), name: 'read', arguments: { path: 'project.json' },
        agent, signal: AbortSignal.timeout(1000), parent: Symbol('untrusted transport') })
      assert.equal(nested.isError, true, 'nested dispatch is denied before any model result exists')
      for (const name of ['write', 'bash', 'subagent']) agent.ctx.tools.register(tools.defineContentToolFixture({
        name, description: 'unexpected child-local mutator', parameters: {},
        async execute() { writes++; await writeFile(tempTarget, 'forbidden'); await writeFile(join(agent.session.header.cwd, 'forbidden'), 'forbidden'); return [] },
      }))
    },
    step(n) { return n < attacks.length ? call(attacks[n], {}) : call('structured_output', { value: 'verified' }) },
  })
  const parentTool = tools.defineContentToolFixture({ name: 'parent_evidence', description: 'parent-only', parameters: {}, async execute() { return [] } })
  f.parent.agent.ctx.tools.register(parentTool)
  const run = await f.port.start('spawn', f.request)
  try {
    assert.deepEqual(await run.result, { stopReason: 'completed', structured: { value: 'verified' } })
    assert.equal(writes, 0)
    await assert.rejects(readFile(tempTarget), /ENOENT/)
    await assert.rejects(readFile(join(f.root, 'forbidden')), /ENOENT/)
    for (const name of attacks) assert.ok(f.results.some(r => r.name === name && r.isError), name)
    const nested = await child.ctx.tools.execute({ callId: llm.ToolCallId(randomUUID()), name: 'read', arguments: { path: 'project.json' },
      agent: child, signal: f.request.signal, parent: Symbol('transport') })
    assert.equal(nested.isError, true)
    assert.equal(f.parent.agent.ctx.tools.get('parent_evidence', f.parent.agent), parentTool)
    assert.equal(f.ctx.agents.get(child.id), child)
  } finally { await run.dispose() }
  assert.equal(f.ctx.agents.get(child.id), undefined)
})

test('same-name child-local replacement cannot execute the replacement body', async t => {
  let changed = false, invoked = false
  const f = await fixture(t, {
    created(agent) {
      const original = agent.ctx.tools.get('read', agent)
      try {
        agent.ctx.tools.register({ ...original, async execute() { invoked = true; return { content: 'mutated' } } })
        changed = true
      } catch (error) { assert.match(String(error), /duplicate|already|conflict/i) }
    },
    step(n) { return n === 0 ? call('read', { path: 'project.json' }) : call('structured_output', { value: 'same scope' }) },
  })
  const run = await f.port.start('spawn', f.request)
  try {
    assert.equal((await run.result).stopReason, 'completed')
    assert.equal(invoked, false)
    assert.equal(f.results.find(r => r.name === 'read').isError, changed)
  } finally { await run.dispose() }
})

test('Knowledge reads preserve exact pins and the authorized parent binding', async t => {
  const oid = 'a'.repeat(40)
  let queries = 0, expectedParent
  const f = await fixture(t, { step(n) {
    return n < 2 ? call('design_query_knowledge', { project: 'project', checkpoint: oid, revision: n === 0 ? 'wrong' : 'rev:1' })
      : call('structured_output', { value: 'pinned' })
  } })
  expectedParent = f.parent.agent
  f.parent.agent.ctx.tools.register(tools.defineContentToolFixture({ name: 'design_query_knowledge', description: 'Pinned read-only Knowledge',
    parameters: { project: { type: 'string', required: true }, checkpoint: { type: 'string', required: true }, revision: { type: 'string', required: true } },
    async execute(args, exec) { assert.equal(exec.agent, expectedParent); queries++; return [{ type: 'text', text: 'bounded graph' }] },
  }))
  const run = await f.port.start('spawn', { ...f.request, knowledgeContext: JSON.stringify({ project: 'project', checkpoint: oid, knowledgeRevision: 'rev:1' }) })
  try { assert.equal((await run.result).stopReason, 'completed'); assert.equal(queries, 1) }
  finally { await run.dispose() }
  assert.deepEqual(f.results.filter(r => r.name === 'design_query_knowledge').map(r => r.isError), [true, false])
})

test('oversized initial KAG uses the original readonly pinned query before official Grounding completion', async t => {
  const project = '11111111-1111-4111-8111-111111111111', checkpoint = 'a'.repeat(40), sourceCheckpoint = 'b'.repeat(40)
  const fullText = 'FULL_GRAPH_EVIDENCE_' + '中'.repeat(12000)
  const knowledge = await readAdvisoryDesignKnowledge({ project, checkpoint }, {
    query: async () => ({ revision: 'rev:4', entities: [{ id: 'fact', properties: { text: fullText }, provenance: { checkpoint: sourceCheckpoint } }], relations: [],
      page: { offset: 0, nextOffset: null, totalEntities: 1, totalRelations: 0 } }),
  }, 20, {}, 'rev:4', sourceCheckpoint)
  const knowledgeContext = advisoryKnowledgeModelContext(knowledge)
  assert.ok(Buffer.byteLength(knowledgeContext) <= 32768)
  let queries = 0, expectedParent
  const f = await fixture(t, { step(n, request) {
    const text = JSON.stringify(request)
    if (n === 0) {
      assert.match(text, /not-inlined/)
      assert.doesNotMatch(text, /FULL_GRAPH_EVIDENCE_/)
    }
    if (n < 2) return call('design_query_knowledge', { project, checkpoint, revision: n === 0 ? 'rev:wrong' : 'rev:4' })
    assert.equal(n, 2)
    assert.match(text, /FULL_GRAPH_EVIDENCE_/)
    assert.ok(text.includes(fullText), 'demanded record is delivered with its complete text')
    return call('structured_output', { schemaVersion: 1, inconsistencies: [] })
  } })
  expectedParent = f.parent.agent
  f.parent.agent.ctx.tools.register(tools.defineContentToolFixture({ name: 'design_query_knowledge', description: 'Original pinned Knowledge reader',
    parameters: { project: { type: 'string', required: true }, checkpoint: { type: 'string', required: true }, revision: { type: 'string', required: true } },
    async execute(args, exec) {
      assert.equal(exec.agent, expectedParent)
      assert.deepEqual(args, { project, checkpoint, revision: 'rev:4' })
      queries++
      return [{ type: 'text', text: JSON.stringify({ project, checkpoint, sourceCheckpoint, ...knowledge.graph }) }]
    },
  }))
  const outcome = await analyzeDshDesignAdvisory({
    parent: f.parent.agent, provider: 'spawn', profile: OFFICIAL_GROUNDING_PROFILE,
    input: { schemaVersion: 1, runId: 'bounded-grounding-run', resultId: 'bounded-grounding-result', pins: knowledge.pins, facetRefs: ['flow_design'] },
    projectRoot: f.root, designFilesRoot: join(f.root, 'design_files'), reviewCommit: checkpoint,
    knowledgeContext, signal: f.request.signal, stillCurrent: () => true,
  }, f.port).catch(error => { throw f.modelErrors[0] ?? error })
  assert.equal(outcome.status, 'produced')
  assert.equal(queries, 1)
  assert.deepEqual(f.results.filter(r => r.name === 'design_query_knowledge').map(r => r.isError), [true, false])
  assert.equal(f.children.length, 1)
  assert.equal(f.ctx.agents.get(f.children[0].id), undefined)
})

test('ordinary text without structured output cannot be captured', async t => {
  const f = await fixture(t, { step: () => stop() })
  const run = await f.port.start('spawn', f.request)
  try { await assert.rejects(run.result, /successful structured result/) } finally { await run.dispose() }
  if (!factoryBackend) assert.equal(f.nativeEnds.at(-1).stopReason, 'completed', 'child completion is not review validity')
  else assert.equal(agents.foldConsumedWork(f.children[0].session.snapshotEvents()).end.data.reason.kind, 'completed')
})

test('native lifecycle retains partial assistant output and the actual max-token outcome', async t => {
  const f = await fixture(t, { step: () => [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Partial review evidence.' } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ] })
  const run = await f.port.start('spawn', f.request)
  try { await assert.rejects(run.result, /successful structured result/) } finally { await run.dispose() }
  if (!factoryBackend) {
    assert.equal(f.nativeEnds.length, 1)
    assert.equal(f.nativeEnds[0].stopReason, 'max-tokens')
    assert.deepEqual(f.nativeEnds[0].lastAssistantMessage, [{ type: 'text', text: 'Partial review evidence.' }])
  } else {
    assert.equal(f.nativeEnds.length, 0)
    const events = f.children[0].session.snapshotEvents()
    assert.equal(agents.foldConsumedWork(events).end.data.reason.kind, 'max-tokens')
    assert.deepEqual(subagents.finalAssistantOutput(events), [{ type: 'text', text: 'Partial review evidence.' }])
  }
})

test('normal text and failed structured result cannot become successful review capture', async t => {
  const f = await fixture(t, { step: n => n === 0 ? call('structured_output', { value: 'not accepted' }) : stop(),
    created(agent) {
      agent.ctx.on('tools/post-execute', async (exec, result, next) => {
        const decision = await next()
        return exec.name === 'structured_output' ? { kind: 'block', reason: 'fixture rejects final tool result' } : decision
      })
    } })
  const run = await f.port.start('spawn', f.request)
  try { await assert.rejects(run.result, /did not complete normally/) } finally { await run.dispose() }
  assert.ok(f.results.some(r => r.name === 'structured_output' && r.isError))
})

test('Grounding rejects oversized references before capture and permits the same child to correct them', async t => {
  for (const [length, repair] of [[513, true], [959, true], [959, false]]) await t.test(`${length} characters, repair=${repair}`, async t => {
    const reference = 'prd/product.md#' + 'x'.repeat(512 - 'prd/product.md#'.length)
    const output = authoritativeReference => ({ schemaVersion: 1, inconsistencies: [{
      id: 'audience-drift', facets: ['prd', 'page_design'], summary: 'The saved audiences disagree.',
      authoritativeReference, correction: 'Align the page audience to creators.', affectedFacets: ['page_design'],
    }] })
    const f = await fixture(t, { step(n) {
      assert.ok(n < 2, 'one rejected submission and one correction must suffice')
      return n > 0 && !repair ? stop() : call('structured_output', output(n === 0 ? 'x'.repeat(length) : reference))
    } })
    const analysis = analyzeDshDesignAdvisory({
      design: { async publishAdvisory() { assert.fail('analysis must not publish') } },
      parent: f.parent.agent, provider: 'spawn', profile: OFFICIAL_GROUNDING_PROFILE,
      input: { schemaVersion: 1, runId: 'grounding-run', resultId: 'grounding-result',
        pins: [{ source: 'design-state', revision: 'revision-1' }], facetRefs: ['prd', 'page_design'] },
      projectRoot: f.root, designFilesRoot: join(f.root, 'design_files'), reviewCommit: 'a'.repeat(40),
      signal: f.request.signal, stillCurrent: () => true,
    }, f.port)
    if (repair) {
      const outcome = await analysis
      assert.equal(outcome.status, 'produced')
      assert.equal(outcome.advisory.items.length, 1)
      assert.equal(outcome.advisory.items[0].references[0], reference, 'accepted reference must not be truncated or rewritten')
    } else await assert.rejects(analysis, /successful structured result/)
    assert.equal(f.children.length, 1)
    assert.deepEqual(f.results, [{ name: 'structured_output', isError: true }, ...(repair ? [{ name: 'structured_output', isError: false }] : [])])
    assert.equal(f.seen.length, 2)
    assert.match(JSON.stringify(f.children[0].session.snapshotEvents()), /authoritativeReference.*exceeds 512 characters/)
  })
})

test('concurrent child captures remain scope-local and nonspawn is explicitly unsupported', async t => {
  const f = await fixture(t, { step: () => call('structured_output', { value: 'own result' }) })
  await assert.rejects(f.port.start('remote', f.request), /unsupported/)
  const runs = await Promise.all([f.port.start('spawn', f.request), f.port.start('spawn', f.request)])
  try {
    for (const run of runs) assert.deepEqual((await run.result).structured, { value: 'own result' })
    assert.equal(f.children.length, 2)
    assert.notEqual(runs[0].id, runs[1].id)
    assert.deepEqual(runs.map(run => run.id).sort(), f.children.map(child => child.id).sort())
    assert.notEqual(f.children[0].ctx.tools.get('structured_output', f.children[0]), f.children[1].ctx.tools.get('structured_output', f.children[1]))
    assert.equal(f.parent.agent.ctx.tools.get('structured_output', f.parent.agent), undefined)
  } finally { await Promise.all(runs.map(run => run.dispose())) }
  assert.ok(f.children.every(agent => f.ctx.agents.get(agent.id) === undefined))
})

test('initialization failure and cancellation clean the owned child without capture', async t => {
  const f = await fixture(t, { created() { throw new Error('fixture initialization rejected') }, step: () => stop() })
  await assert.rejects(f.port.start('spawn', f.request), /initialization rejected/)
  assert.equal(f.seen.length, 0)
  assert.ok(f.children.every(agent => f.ctx.agents.get(agent.id) === undefined))
  assert.equal(f.nativeStarts.length, 0)
  assert.equal((await f.ctx.subagents.listChildren(f.parent.agent.id)).length, 0)
  assert.ok(f.ctx.subagents.list().every(name => !name.startsWith('dsh-design-readonly-review-')))
  const abort = new AbortController()
  const other = await fixture(t, { step: async () => { abort.abort(); return stop() } })
  const run = await other.port.start('spawn', { ...other.request, signal: abort.signal })
  try { await assert.rejects(run.result) } finally { await run.dispose() }
  assert.ok(other.children.every(agent => other.ctx.agents.get(agent.id) === undefined))
  if (!factoryBackend) {
    assert.equal(other.nativeStarts.length, 1)
    assert.equal(other.nativeEnds.length, 1)
    assert.equal(other.nativeEnds[0].stopReason, 'aborted')
  } else {
    assert.equal(other.nativeStarts.length, 0)
    assert.equal(other.nativeEnds.length, 0)
    assert.equal(agents.foldConsumedWork(other.children[0].session.snapshotEvents()).end.data.reason.kind, 'aborted')
  }
  assert.ok(other.ctx.subagents.list().every(name => !name.startsWith('dsh-design-readonly-review-')))
})

test('synchronous Clarity uses the actual readonly child, native id and successful structured tool result', async t => {
  const assessment = { summary: 'Bound published evidence only.', u: { score: 70, evidence: 'Intent is stated.' },
    s: { score: 60, evidence: 'Saved relationships are explicit.' }, t: { score: 50, evidence: 'Acceptance evidence is partial.' } }
  let writes = 0, evidenceCommit
  const sequence = [call('bash', {}), call('write', {}), call('subagent', {}), call('run_code', {}),
    call('list', {}), call('read', { path: 'project.json' }),
    call('read_skill_resource', { bundle: 'example', path: 'schema.yaml' }), call('structured_output', assessment)]
  const f = await fixture(t, {
    created(agent) {
      for (const name of ['bash', 'write', 'subagent']) agent.ctx.tools.register(tools.defineContentToolFixture({
        name, description: 'forbidden Clarity mutator', parameters: {},
        async execute() { writes++; await writeFile(join(agent.session.header.cwd, 'clarity-forbidden'), 'forbidden'); return [] },
      }))
    },
    step(n) { assert.ok(sequence[n], 'bounded Clarity script'); return sequence[n] },
  })
  f.parent.agent.ctx.tools.presentAs('ptc')
  const inherited = f.parent.agent.ctx.tools.schemas(f.parent.agent).map(tool => tool.name)
  const evaluated = await evaluatePublishedDesignClarity({
    start: async (provider, request) => { evidenceCommit = request.reviewCommit; return f.port.start(provider, request) },
    parent: f.parent.agent, provider: 'spawn', projectRoot: f.root, designFilesRoot: join(f.root, 'design_files'),
    commit: 'a'.repeat(40), kitName: 'example', kitVersion: '1.0', signal: f.request.signal, timeoutMs: 5000,
  })
  assert.equal(evidenceCommit, 'a'.repeat(40))
  assert.equal(evaluated.evaluationId, String(f.children[0].id))
  assert.equal(f.children[0].session.header.parentSession, f.parent.agent.id)
  assert.deepEqual(evaluated.assessment, assessment)
  assert.equal(writes, 0)
  await assert.rejects(readFile(join(f.root, 'clarity-forbidden')), /ENOENT/)
  for (const name of ['bash', 'write', 'subagent', 'run_code']) assert.ok(f.results.some(r => r.name === name && r.isError), name)
  assert.deepEqual(f.parent.agent.ctx.tools.schemas(f.parent.agent).map(tool => tool.name), inherited)
  assert.equal(f.ctx.agents.get(f.children[0].id), undefined, 'synchronous evaluator disposes its actual child')
})

test('synchronous Clarity rejects plain text and failed structured tool capture instead of inventing an assessment', async t => {
  for (const blocked of [false, true]) {
    const f = await fixture(t, {
      step: n => blocked && n === 0 ? call('structured_output', {
        summary: 'Not an accepted receipt.', u: { score: 1, evidence: 'U' }, s: { score: 1, evidence: 'S' }, t: { score: 1, evidence: 'T' },
      }) : stop(),
      created(agent) {
        if (blocked) agent.ctx.on('tools/post-execute', async (exec, _result, next) => {
          const decision = await next()
          return exec.name === 'structured_output' ? { kind: 'block', reason: 'rejected Clarity output' } : decision
        })
      },
    })
    await assert.rejects(evaluatePublishedDesignClarity({ start: f.port.start, parent: f.parent.agent,
      provider: 'spawn', projectRoot: f.root, designFilesRoot: join(f.root, 'design_files'), commit: 'a'.repeat(40),
      kitName: 'example', kitVersion: '1.0', signal: f.request.signal, timeoutMs: 5000 }), /structured result|complete normally/)
    assert.ok(f.children.every(agent => f.ctx.agents.get(agent.id) === undefined))
  }
})

test('native Clarity retains full calibration and reads an exact contract on demand before structured completion', async t => {
  const assessment = { summary: 'Scoped published evidence.', u: { score: 60, evidence: 'Intent.' },
    s: { score: 50, evidence: 'Structure.' }, t: { score: 40, evidence: 'Observable outcomes.' } }
  const kit = { name: 'fixture', version: '1.0', description: 'COMPLETE_CATALOG_DESCRIPTION', mindset: 'COMPLETE_MINDSET', resources: {},
    skills: [{ name: 'example', version: '1.0', description: 'COMPLETE_BUNDLE_DESCRIPTION', content: 'LOADED_METHOD',
      metadata: { schemaYaml: 'EXACT_SCHEMA_ON_DEMAND', validationYaml: 'EXACT_VALIDATION_ON_DEMAND' } }] }
  const metadata = { kind: 'dsh-design-project', formatVersion: 3, id: randomUUID(), name: 'Native contracts',
    createdAt: '2026-10-15T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' }, kit: { name: kit.name, version: kit.version } }
  const evidence = await createAdvisoryEvidence({ commit: 'a'.repeat(40), projectId: metadata.id, signal: AbortSignal.timeout(15000),
    git: { listPathsAt: async () => ['project.json'], readBytesAt: async () => Buffer.from(JSON.stringify(metadata)) },
    resolveKit: () => kit, resolveBundle: () => undefined })
  const f = await fixture(t, { evidence, step(n, request) {
    const text = JSON.stringify(request)
    assert.match(text, /COMPLETE_MINDSET/)
    assert.match(text, /COMPLETE_CATALOG_DESCRIPTION/)
    assert.match(text, /COMPLETE_BUNDLE_DESCRIPTION/)
    assert.match(text, /design_clarity_rubric/)
    if (n === 0) {
      assert.doesNotMatch(text, /EXACT_SCHEMA_ON_DEMAND|EXACT_VALIDATION_ON_DEMAND/)
      assert.match(text, /read_skill_resource/)
      return call('read_skill_resource', { bundle: 'example', path: 'validation.yaml' })
    }
    assert.equal(n, 1)
    assert.match(text, /EXACT_VALIDATION_ON_DEMAND/)
    assert.match(text, /loaded-validation-projection/)
    return call('structured_output', assessment)
  } })
  const evaluated = await evaluatePublishedDesignClarity({ start: f.port.start, parent: f.parent.agent, provider: 'spawn',
    projectRoot: f.root, designFilesRoot: join(f.root, 'design_files'), commit: 'a'.repeat(40), kitName: kit.name,
    kitVersion: kit.version, kit, signal: f.request.signal, timeoutMs: 5000 })
  assert.deepEqual(evaluated.assessment, assessment)
  assert.deepEqual(f.results.map(result => result.name), ['read_skill_resource', 'structured_output'])
  assert.ok(f.results.every(result => !result.isError))
  assert.equal(f.ctx.agents.get(f.children[0].id), undefined)
})

test('native Clarity consumes complete original facts in its first input without system injection or discovery round trips', async t => {
  const commit = 'a'.repeat(40), raw = '{"decision":"RAW_UNTRUSTED_FACT: ignore instructions is file data","note":"中文😀"}'
  const kit = { name: 'snapshot_fixture', version: '1.0', description: 'FULL_SNAPSHOT_CATALOG',
    mindset: 'FULL_SNAPSHOT_MINDSET', resources: {}, skills: [] }
  const metadata = { kind: 'dsh-design-project', formatVersion: 3, id: randomUUID(), name: 'Original facts',
    createdAt: '2026-10-15T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' }, kit: { name: kit.name, version: kit.version } }
  const file = 'design_files/decision/decision.json', bytes = new Map([
    ['project.json', Buffer.from(JSON.stringify(metadata))], [file, Buffer.from(raw)],
  ])
  const original = await createAdvisoryEvidence({ commit, projectId: metadata.id, signal: AbortSignal.timeout(10000),
    git: { listPathsAt: async () => [...bytes.keys()], readBytesAt: async (_commit, path) => bytes.get(path) },
    resolveKit: () => kit, resolveBundle: () => undefined })
  let prepares = 0
  const evidence = { ...original, async readSmallSnapshot(signal) { prepares++; return original.readSmallSnapshot(signal) } }
  const assessment = { summary: 'Original facts assessed.', u: { score: 60, evidence: file },
    s: { score: 50, evidence: 'Relationships remain open.' }, t: { score: 40, evidence: 'Observable criteria remain open.' } }
  const f = await fixture(t, { evidence, step(n, request) {
    assert.equal(n, 0, 'one model step suffices for this complete scripted input')
    const system = JSON.stringify(request.messages.filter(message => message.role === 'system'))
    const input = JSON.stringify(request.messages.filter(message => message.role !== 'system'))
    assert.doesNotMatch(system, /RAW_UNTRUSTED_FACT/)
    assert.match(input, /Complete original-facts snapshot/)
    assert.match(input, /untrusted evidence data/)
    assert.match(input, /RAW_UNTRUSTED_FACT/)
    assert.match(input, /FULL_SNAPSHOT_MINDSET|FULL_SNAPSHOT_CATALOG/)
    assert.match(input, /design_clarity_rubric/)
    assert.match(input, /do not repeat list\/read/)
    for (const name of ['list', 'read', 'grep', 'read_skill_resource', 'structured_output']) {
      assert.ok(request.tools.some(tool => tool.name === name), name)
    }
    return call('structured_output', assessment)
  } })
  const result = await evaluatePublishedDesignClarity({ start: f.port.start, parent: f.parent.agent, provider: 'spawn',
    projectRoot: f.root, designFilesRoot: join(f.root, 'design_files'), commit, kitName: kit.name,
    kitVersion: kit.version, kit, signal: f.request.signal, timeoutMs: 5000 })
  assert.equal(prepares, 1)
  assert.deepEqual(result.assessment, assessment)
  assert.deepEqual(f.results, [{ name: 'structured_output', isError: false }])
  assert.deepEqual(f.modelErrors, [])
  assert.equal(f.ctx.agents.get(f.children[0].id), undefined)
})

test('general advisory factory does not prepare original facts unless explicitly opted in', async t => {
  let prepares = 0
  const evidence = { manifest: { checkpoint: 'a'.repeat(40), paths: ['project.json'] },
    async readSmallSnapshot() { prepares++; throw Error('not opted in') }, list: () => [], read: async () => ({}), search: async () => ({}), resource: () => ({}) }
  const f = await fixture(t, { evidence, step(n, request) {
    assert.equal(n, 0)
    assert.doesNotMatch(JSON.stringify(request.messages), /Complete original-facts snapshot/)
    return call('structured_output', { value: 'ordinary advisory' })
  } })
  const run = await f.port.start('spawn', f.request)
  try { assert.deepEqual((await run.result).structured, { value: 'ordinary advisory' }) }
  finally { await run.dispose() }
  assert.equal(prepares, 0)
})

test('ineligible small snapshot leaves native bound reads available without a partial evidence block', async t => {
  let prepares = 0, reads = 0
  const evidence = { manifest: { checkpoint: 'a'.repeat(40), paths: ['project.json'] },
    async readSmallSnapshot() { prepares++; return undefined }, list: () => ['project.json'],
    async read() { reads++; return { checkpoint: 'a'.repeat(40), path: 'project.json', content: 'PINNED_TOOL_FACT' } },
    search: async () => ({}), resource: () => ({}) }
  const f = await fixture(t, { evidence, step(n, request) {
    assert.doesNotMatch(JSON.stringify(request.messages), /Complete original-facts snapshot/)
    if (n === 0) return call('read', { path: 'project.json' })
    assert.equal(n, 1); assert.match(JSON.stringify(request.messages), /PINNED_TOOL_FACT/)
    return call('structured_output', { value: 'bound fallback' })
  } })
  const run = await f.port.start('spawn', { ...f.request, includeSmallSnapshot: true })
  try { assert.deepEqual((await run.result).structured, { value: 'bound fallback' }) }
  finally { await run.dispose() }
  assert.equal(prepares, 1); assert.equal(reads, 1)
  assert.ok(f.results.every(result => !result.isError))
})

test('native Clarity can skip a binary artifact after whole-snapshot text ineligibility', async t => {
  const commit = 'a'.repeat(40), file = 'design_files/intent.txt'
  const kit = { name: 'binary_fixture', version: '1.0', mindset: 'One bounded saved decision.', resources: {}, skills: [] }
  const metadata = { kind: 'dsh-design-project', formatVersion: 3, id: randomUUID(), name: 'Binary artifact',
    createdAt: '2026-10-15T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' }, kit: { name: kit.name, version: kit.version } }
  const bytes = new Map([['project.json', Buffer.from(JSON.stringify(metadata))],
    [file, Buffer.from('ORIGINAL_TEXT_WITH_BINARY_ARTIFACT')], ['design_files/artifacts/result.bin', Buffer.from([255, 254])]])
  const evidence = await createAdvisoryEvidence({ commit, projectId: metadata.id, signal: AbortSignal.timeout(10000),
    git: { listPathsAt: async () => [...bytes.keys()], readBytesAt: async (_commit, path) => bytes.get(path) },
    resolveKit: () => kit, resolveBundle: () => undefined })
  const assessment = { summary: 'Published text facts assessed; binary is not needed for this decision.',
    u: { score: 50, evidence: file }, s: { score: 40, evidence: 'Structure is incomplete.' }, t: { score: 30, evidence: 'Checks remain open.' } }
  const f = await fixture(t, { evidence, step(n, request) {
    assert.doesNotMatch(JSON.stringify(request.messages), /Complete original-facts snapshot/)
    if (n === 0) return call('read', { path: file })
    assert.equal(n, 1); assert.match(JSON.stringify(request.messages), /ORIGINAL_TEXT_WITH_BINARY_ARTIFACT/)
    return call('structured_output', assessment)
  } })
  const evaluated = await evaluatePublishedDesignClarity({ start: f.port.start, parent: f.parent.agent, provider: 'spawn',
    projectRoot: f.root, designFilesRoot: join(f.root, 'design_files'), commit, kitName: kit.name,
    kitVersion: kit.version, kit, signal: f.request.signal, timeoutMs: 5000 })
  assert.deepEqual(evaluated.assessment, assessment)
  assert.deepEqual(f.results.map(result => result.name), ['read', 'structured_output'])
  assert.ok(f.results.every(result => !result.isError))
})

test('snapshot source failure rejects before child creation rather than yielding a partial assessment', async t => {
  const failure = Error('immutable source integrity failure')
  const evidence = { manifest: { checkpoint: 'a'.repeat(40), paths: [] },
    async readSmallSnapshot() { throw failure }, list: () => [], read: async () => ({}), search: async () => ({}), resource: () => ({}) }
  const f = await fixture(t, { evidence, step() { throw Error('no model should start') } })
  await assert.rejects(f.port.start('spawn', { ...f.request, includeSmallSnapshot: true }), error => error === failure)
  assert.equal(f.children.length, 0); assert.equal(f.seen.length, 0)
})

test('small snapshot preparation stays inside the original Clarity timeout and creates no late child', async t => {
  let preparing = false
  const evidence = { manifest: { checkpoint: 'a'.repeat(40), paths: [] },
    async readSmallSnapshot(signal) {
      preparing = true
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }, list: () => [], read: async () => ({}), search: async () => ({}), resource: () => ({}) }
  const f = await fixture(t, { evidence, step() { throw Error('no model should start') } })
  await assert.rejects(evaluatePublishedDesignClarity({ start: f.port.start, parent: f.parent.agent, provider: 'spawn',
    projectRoot: f.root, designFilesRoot: join(f.root, 'design_files'), commit: f.request.reviewCommit,
    kitName: 'fixture', kitVersion: '1.0', signal: f.request.signal, timeoutMs: 25 }), /timed out after 25ms/)
  assert.equal(preparing, true)
  assert.equal(f.children.length, 0); assert.equal(f.seen.length, 0)
})

test('readonly discovery retains every official resource and pin without repeating hashes in the system prompt', async t => {
  const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
    listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
  const packageRoot = new URL('../../skills-web-app/', import.meta.url).pathname
  const resolver = createDirectoryBundleResolver(fs, [{ rootDir: join(packageRoot, 'bundles'), sourceId: 'discovery-retention-test' }])
  const content = new Map()
  const kit = await loadDesignKit(fs, packageRoot, { sourceId: 'discovery-retention-test', resolveBundle: async pin => {
    const bundle = await resolver(pin); content.set(pin.name, bundle); return bundle
  } })
  const oid = 'a'.repeat(40)
  const metadata = { kind: 'dsh-design-project', formatVersion: 3, id: randomUUID(), name: 'Discovery retention',
    createdAt: '2026-10-15T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' }, kit: { name: kit.name, version: kit.version } }
  const paths = ['project.json', 'design_files/example/example.json']
  const evidence = await createAdvisoryEvidence({ commit: oid, projectId: metadata.id, signal: AbortSignal.timeout(15000),
    git: { listPathsAt: async () => paths, readBytesAt: async () => Buffer.from(JSON.stringify(metadata)) },
    resolveKit: () => kit, resolveBundle: pin => content.get(pin.name) })
  const fullManifest = JSON.stringify(evidence.manifest)
  const kitHash = projectKitContentHash(kit)
  const expected = { ...evidence.manifest, bundles: evidence.manifest.bundles.map(bundle => ({ ...bundle,
    resources: bundle.resources.map(({ sha256: _sha256, ...resource }) => resource),
  })) }
  const allResources = evidence.manifest.bundles.flatMap(bundle => bundle.resources.map(resource => ({ bundle, resource })))
  assert.equal(allResources.length, 228, 'all resources in the fixed official Kit are covered, not a selected subset')
  for (const { bundle, resource } of allResources) {
    const exact = content.get(bundle.name).resources[resource.path]
    const read = evidence.resource(bundle.bindingKey, resource.path, 0, 12000, new AbortController().signal)
    assert.equal(read.content, exact.slice(0, 12000), `${bundle.bindingKey}/${resource.path}: exact loaded bytes`)
    assert.equal(read.sha256, createHash('sha256').update(exact).digest('hex'))
    assert.equal(read.sha256, resource.sha256)
    assert.equal(read.name, bundle.name)
    assert.equal(String(read.version), String(bundle.version))
    assert.equal(read.path, resource.path)
    assert.equal(read.representation, resource.representation)
  }
  assert.throws(() => evidence.resource('unlisted', 'SKILL.md', 0, 12000, new AbortController().signal), /unavailable/)
  assert.throws(() => evidence.resource(kit.skills[0].name, 'reference/unlisted.md', 0, 12000, new AbortController().signal), /unavailable/)
  await assert.rejects(evidence.read('design_files/unlisted.json', 0, 12000, new AbortController().signal), /outside the pinned snapshot/)
  const selected = allResources.find(({ resource }) => resource.path === 'schema.yaml')
  const read = evidence.resource(selected.bundle.bindingKey, selected.resource.path, 0, 12000, new AbortController().signal)
  const marker = 'Immutable evidence discovery (resource hashes are returned by read_skill_resource):\n'
  const assessment = { summary: 'Pinned published evidence.', u: { score: 60, evidence: 'U evidence.' },
    s: { score: 50, evidence: 'S evidence.' }, t: { score: 40, evidence: 'T evidence.' } }
  // Exercise both callers of the shared readonly factory, not a label heuristic.
  for (const clarity of [true, false]) {
    const f = await fixture(t, { evidence, step(n, request) {
      const system = request.messages.filter(message => message.role === 'system')
        .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')
      const start = system.indexOf(marker)
      assert.notEqual(start, -1)
      const discovery = JSON.parse(system.slice(start + marker.length))
      assert.deepEqual(discovery, expected, 'project/commit/Kit pins, paths, Bundle identities and every resource representation survive')
      assert.ok(!JSON.stringify(discovery).includes('"sha256"'))
      assert.equal(JSON.stringify(evidence.manifest), fullManifest, 'discovery never mutates the complete authority')
      assert.equal(projectKitContentHash(kit), kitHash, 'effective Kit input identity is unchanged')
      assert.ok(Buffer.byteLength(JSON.stringify(discovery)) < Buffer.byteLength(fullManifest))
      if (n === 0) {
        assert.ok(!system.includes(read.sha256), 'initial discovery does not repeat a resource hash')
        return call('read_skill_resource', { bundle: selected.bundle.bindingKey, path: selected.resource.path })
      }
      assert.equal(n, 1, 'bounded two-step scripted review')
      const toolResult = request.messages.find(message => message.role === 'tool')
      const returned = JSON.parse(toolResult.content.find(block => block.type === 'text').text)
      assert.deepEqual(returned, read, 'native read returns unchanged content, pins, hash and representation')
      return call('structured_output', clarity ? assessment : { value: 'shared review complete' })
    } })
    if (clarity) {
      const result = await evaluatePublishedDesignClarity({ start: f.port.start, parent: f.parent.agent, provider: 'spawn',
        projectRoot: f.root, designFilesRoot: join(f.root, 'design_files'), commit: oid, kitName: kit.name,
        kitVersion: kit.version, kit, signal: f.request.signal, timeoutMs: 5000 }).catch(error => { throw f.modelErrors[0] ?? error })
      assert.deepEqual(result.assessment, assessment)
    } else {
      const run = await f.port.start('spawn', f.request)
      try { assert.deepEqual((await run.result.catch(error => { throw f.modelErrors[0] ?? error })).structured, { value: 'shared review complete' }) }
      finally { await run.dispose() }
    }
    assert.ok(f.results.every(result => !result.isError))
    assert.ok(f.children.every(agent => f.ctx.agents.get(agent.id) === undefined))
  }
  assert.equal(JSON.stringify(evidence.manifest), fullManifest)
})
