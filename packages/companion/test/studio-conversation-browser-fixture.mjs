/** Isolated emitted-web / source-server UI fixture. No real native Agent is invoked. */
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import assert from 'node:assert/strict'
import { DesignProjectManager } from '../../core/lib/index.js'
import { startCompanion } from '../src/server.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createDesignMcp } from '../src/mcp.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { originalFiles, additions, pin } from './fixtures/studio-changes-fixture.mjs'

const root = await mkdtemp(join(tmpdir(), 'studio-conversation-visible-'))
const kitRoot = join(root, 'kit'), stateRoot = join(root, 'state'), projectRoot = join(root, 'project'), transcriptPath = join(root, 'scripted-native.jsonl')
await mkdir(kitRoot); await mkdir(stateRoot)
await writeFile(join(kitRoot, 'mindset.md'), '---\nname: observation_kit\nversion: "1.0"\ndescription: Record supplied observations.\n---\nPreserve supplied facts.\n<design_skills>\n## observations\nRecord supplied observations.\n</design_skills>\n')
for (const file of originalFiles) {
  const path = join(kitRoot, 'skills/observations', file.path)
  await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, Buffer.from(file.base64, 'base64'))
}
await new DesignProjectManager().create({ root: projectRoot, name: 'Studio 脚本化宿主边界检查', kit: { name: 'observation_kit', version: '1.0' }, knowledge: { provider: 'ladybug-wasm' } })
const threadId = randomUUID(), captured = new Set()
await writeFile(transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd: projectRoot } }) + '\n')
const event = async (type, message) => appendFile(transcriptPath, JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: {
  type: 'item_completed', turn_id: 'isolated-ui-fixture', item: { id: randomUUID(), type: type === 'user_message' ? 'UserMessage' : 'AgentMessage', content: [{ type: 'text', text: message }] },
} }) + '\n')
const server = await startCompanion({ projectRoot, nativeCwd: projectRoot, stateRoot, kitRoot, transcriptPath,
  staticRoot: resolve('packages/companion/dist'), indexPath: resolve('packages/companion/index.html'), browserAccess: 'local',
  knowledgeAutoRefresh: false, embedding: { provider: 'disabled' }, knowledgeRuntime: async () => { throw Error('No KAG runtime in this fixture.') }, host: 'codex',
  connection: { host: 'codex', threadId, send: async (_text, metadata) => {
    captured.add(metadata.requestId)
    await event('user_message', '[隔离工程测试] 请求已进入脚本化宿主投递边界；这不是一次真实模型调用。')
    await event('agent_message', '[脚本化宿主] 已记录本次请求。候选由测试操作员另行通过 MCP 准备，不声称原生 Agent 已完成工作。')
    console.log(JSON.stringify({ event: 'scripted-delivery', requestId: metadata.requestId }))
    return { accepted: true, status: 'submitted_unverified', threadId }
  } },
})
const call = (method, params = {}) => callCompanion(server.connectionPath, { method, params })
const copy = await call('studioInstanceCopy', { kind: 'bundle', bundle: pin, title: { zh: '观察记录 · 会话联动检查', en: 'Observations · conversation check' } })
await event('agent_message', '这是隔离的脚本化宿主边界检查；网页使用正常构建产物，未连接真实 Codex Agent。')
const mcp = createDesignMcp(), client = new Client({ name: 'studio-ui-test-operator', version: '1' })
const [left, right] = InMemoryTransport.createLinkedPair()
await Promise.all([client.connect(left), mcp.connect(right)])
const customize = (action, request, authoringRequestId) => client.callTool({ name: 'design_studio_customize', arguments: {
  connection: server.connectionPath, action, request, ...(authoringRequestId ? { authoringRequestId } : {}),
} })
console.log(JSON.stringify({ event: 'fixture-ready', url: `${server.url}?view=studio`, root, copyId: copy.id, threadId, actualNativeExecution: false }))
let closing
const close = () => closing ??= (async () => { await client.close(); await mcp.close(); await server.close(); await rm(root, { recursive: true, force: true }); console.log(JSON.stringify({ event: 'fixture-closed', rootRemoved: true })) })()
process.once('SIGINT', () => { void close().finally(() => process.exit()) })
const lines = createInterface({ input: process.stdin })
for await (const line of lines) {
  try {
    const input = JSON.parse(line)
    if (input.action === 'close') { await close(); break }
    if (input.action === 'native-prepare') {
      const current = await call('studioInstanceRead', { id: copy.id })
      const result = await customize('prepareChanges', { id: copy.id, expectedRevision: current.revision, changes: input.changes ?? additions() })
      assert.ok(!result.isError, JSON.stringify(result))
      const candidate = JSON.parse(result.content[0].text)
      assert.equal(candidate.valid, true)
      console.log(JSON.stringify({ event: 'native-candidate-prepared', authoring: candidate.authoring, digest: candidate.digest, persistedRevision: (await call('studioInstanceRead', { id: copy.id })).revision, actualNativeExecution: false }))
    } else if (input.action === 'prepare') {
      assert.equal(input.id, copy.id); assert.ok(captured.has(input.requestId)); assert.equal(input.expectedRevision, 0)
      const result = await customize('prepareChanges', { id: input.id, expectedRevision: input.expectedRevision, changes: additions() }, input.requestId)
      assert.ok(!result.isError, JSON.stringify(result)); const candidate = JSON.parse(result.content[0].text)
      console.log(JSON.stringify({ event: 'candidate-prepared', requestId: input.requestId, id: candidate.id, baseRevision: candidate.baseRevision, digest: candidate.digest, valid: candidate.valid, persistedRevision: (await call('studioInstanceRead', { id: copy.id })).revision }))
    } else if (input.action === 'check') {
      const read = await customize('read', { id: copy.id }); const record = JSON.parse(read.content[0].text)
      for (const change of additions()) {
        const file = await customize('readFile', { id: copy.id, path: change.path })
        assert.equal(JSON.parse(file.content[0].text).content, change.content)
      }
      console.log(JSON.stringify({ event: 'saved-readback', id: copy.id, revision: record.revision, allFourChangesMatch: true, capturedNativeRequests: captured.size }))
    } else throw Error('Unknown explicit fixture control')
  } catch (error) { console.log(JSON.stringify({ event: 'fixture-error', error: String(error) })) }
}
await close()
lines.close()
process.exit(0)
