/** Actual official factory/loop/query, scripted model and a memory storage port.
 * No installed Host/model/profile or production filesystem durability acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDshTestRuntime } from '../../../core/test/dsh-asar-test-loader.mjs'

assert.ok(Boolean(process.env.DSH_TEST_ASAR) !== Boolean(process.env.DSH_TEST_WEB_ANCHOR), 'One explicit official SDK graph is required')
const runtime = loadDshTestRuntime({ asar: process.env.DSH_TEST_ASAR, webAnchor: process.env.DSH_TEST_WEB_ANCHOR })
const { Context } = await import('@deepseek-ai/cordis')
export const { createStudioAuthoringAgent } = await import(process.env.STUDIO_AUTHORING_AGENT_BUILT === '1' ? '../../lib/authoring-agent.js' : '../../src/authoring-agent.ts')
export const [llm, sessions, prompt, tools, agents, loop, query, persistence, projections] = await Promise.all(
  ['dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop', 'dsh-session-query', 'dsh-session-persistence', 'dsh-session-projection']
    .map(name => import('@deepseek-ai/' + name)))
test.after(() => {
  if (process.env.DSH_STUDIO_AGENT_EVIDENCE) writeFileSync(process.env.DSH_STUDIO_AGENT_EVIDENCE, JSON.stringify({
    asar: process.env.DSH_TEST_ASAR, webAnchor: process.env.DSH_TEST_WEB_ANCHOR,
    boundary: 'Explicit official SDK modules, scripted LLM, memory storage and S3 ports fixtures; not production Host/model/filesystem persistence acceptance',
    modules: Object.fromEntries(runtime.observations),
  }, null, 2) + '\n')
  runtime.close()
})
const clone = value => structuredClone(value)
export const call = (name, args) => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: llm.ToolCallId(randomUUID()), name, arguments: JSON.stringify(args) } },
  { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, { type: 'finish', reason: { kind: 'tool-calls' } },
]
export const stop = () => [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, { type: 'finish', reason: { kind: 'stop' } }]
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

/** Public storage port fixture only. Agent creation, replay, loop and observation are SDK code. */
class MemoryStorage extends persistence.SessionPersistence {
  rows = new Map()
  constructor(ctx) {
    super(ctx)
    // Backend-owned routing, like the public persistence contract; no Agent/loop fake.
    ctx.on('session/event', (session, event) => {
      const row = this.rows.get(session.id)
      if (row?.writer) { persistence.assertContiguous(session.id, [event], row.events.length); row.events.push(...persistence.materializeAppendBatch([event])); row.revision++ }
    })
    ctx.on('session/flush', async session => { if (this.rows.has(session.id)) await this.flush() })
  }
  async create(header, options = {}) {
    assert.ok(!this.rows.has(header.id)); const row = { header: persistence.materializeCreateHeader(header), events: [], inherited: options.inheritedEventCount ?? 0, revision: 0, writer: false }
    this.rows.set(header.id, row); return this.handle(row, 'write')
  }
  async open(id, access) { const row = this.rows.get(id); if (!row) throw new persistence.SessionPersistenceNotFoundError(id); return this.handle(row, access) }
  handle(row, access) {
    if (access === 'write') { assert.equal(row.writer, false); row.writer = true }
    let closed = false
    const handle = { id: row.header.id, header: row.header, inheritedEventCount: row.inherited, access,
      async read(offset = 0, length = row.events.length) { assert.equal(closed, false); return { eventState: 'detached', events: clone(row.events.slice(offset, offset + length)) } },
      async append(events) { assert.equal(closed, false); assert.equal(access, 'write'); persistence.assertContiguous(row.header.id, events, row.events.length); row.events.push(...persistence.materializeAppendBatch(events)); row.revision++ },
      async flush() { assert.equal(closed, false) },
      async close() { if (!closed && access === 'write') row.writer = false; closed = true },
      async [Symbol.asyncDispose]() { await handle.close() },
    }; return handle
  }
  async flush() {}
  async stat(id) { const row = this.rows.get(id); return row ? { header: clone(row.header), revision: persistence.SessionPersistenceRevision(String(row.revision)), eventCount: row.events.length } : undefined }
  async list() { return Promise.all([...this.rows.keys()].map(id => this.stat(id))) }
}

export async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'studio-authoring-sdk-')); t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  for (const [plugin, config] of [[llm.default], [sessions.default], [prompt.default, { persona: 'Studio scripted SDK test' }], [tools.default], [projections.default],
    ...(options.noStorage ? [] : [[MemoryStorage]]), [query.default], [agents.default], [loop.default, { agents: [] }]]) await ctx.plugin(plugin, config)
  const seen = [], toolResults = [], childIds = []; let calls = 0
  class Scripted extends llm.LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(request) { seen.push(request.tools.map(tool => tool.name)); yield* await options.step(calls++, request) }
  }
  ctx.llm.registerAdapter(['studio-sdk-fixture'], new Scripted())
  const parent = await ctx.agents.create({ sessionId: sessions.SessionId(randomUUID()), meta: { cwd: root },
    agentOptions: { provider: 'studio-sdk-fixture', model: 'inherited-parent-route' } })
  t.after(() => parent.dispose())
  ctx.on('agent/created', async ({ agent }) => { if (agent !== parent.agent) { childIds.push(agent.id); await options.created?.(agent) } })
  ctx.on('tools/result', (exec, result) => toolResults.push({ name: exec.name, isError: result.isError }))
  const adapter = createStudioAuthoringAgent(ctx)
  t.after(() => options.expectedCleanupFailure
    ? assert.rejects(adapter.dispose(), error => error instanceof AggregateError && error.errors.includes(options.expectedCleanupFailure))
    : adapter.dispose())
  const scope = { id: 'instance-one', expectedRevision: 1, allowedPaths: ['panel.yaml'] }
  const portsFor = selected => ({
    async read() { return { scope: clone(selected), files: [{ path: 'panel.yaml', content: 'old source' }], components: { components: [{ type: 'Text' }] } } },
    async prepare({ changes }) { assert.ok(changes.every(change => selected.allowedPaths.includes(change.path))); return { scope: clone(selected), components: { components: [{ type: 'Text' }] }, request: { id: selected.id, expectedRevision: selected.expectedRevision, changes }, candidate: { id: selected.id, valid: true, digest: 'a'.repeat(64), diff: changes } } },
  })
  const request = { parent: parent.agent, invocationId: randomUUID(), scope, workspaceRoot: root, prompt: 'Adjust the bound Panel.', ports: portsFor(scope) }
  return { ctx, root, parent, adapter, scope, portsFor, request, seen, toolResults, childIds, calls: () => calls }
}
