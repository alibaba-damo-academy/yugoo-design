/** Existing authenticated RPC and real disk/Core boundary, no UI or native dispatch. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DesignProjectManager } from '../../core/lib/index.js'
import { startCompanion } from '../src/server.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { staticFixture } from './static-fixture.mjs'
import { originalFiles, additions, pin } from './fixtures/studio-changes-fixture.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createDesignMcp } from '../src/mcp.mjs'

test('new instance methods use existing protected RPC, exact candidate and disk save; installed sources remain unchanged', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-changes-http-'))
  let server
  t.after(async () => { await server?.close(); await rm(root, { recursive: true, force: true }) })
  const kitRoot = join(root, 'kit'), bundleRoot = join(root, 'bundles/observations/1.0'), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
  await mkdir(kitRoot); await mkdir(stateRoot)
  await writeFile(join(kitRoot, 'mindset.md'), '---\nname: observation_kit\nversion: "1.0"\ndescription: Record observations with their supplied evidence.\n---\nPreserve user facts.\n<design_skills>\n## observations\nRecord supplied observations and select a declared status.\n</design_skills>\n')
  await writeFile(join(kitRoot, 'kit.yaml'), 'version: 1\nmounts:\n  - {bindingKey: observations, name: observations, version: "1.0"}\n')
  for (const file of originalFiles) {
    const destination = join(bundleRoot, file.path)
    await mkdir(join(destination, '..'), { recursive: true }); await writeFile(destination, Buffer.from(file.base64, 'base64'))
  }
  await new DesignProjectManager().create({ root: projectRoot, name: 'Isolated instance RPC test', kit: { name: 'observation_kit', version: '1.0' }, knowledge: { provider: 'ladybug-wasm' } })
  let notifications = 0
  server = await startCompanion({ ...await staticFixture(root), projectRoot, stateRoot, kitRoot,
    trustedContentSources: { sourceId: 'fixture:independent-kit', bundles: [{ ...pin, rootDir: bundleRoot, sourceId: 'fixture:independent-bundle' }] },
    knowledgeAutoRefresh: false, knowledgeRuntime: async () => { throw new Error('No KAG runtime in this test.') }, embedding: { provider: 'disabled' },
    host: 'claude-code', connection: { host: 'claude-code', threadId: randomUUID(), send: async () => { notifications++; throw new Error('This test must not dispatch a native Agent.') } } })
  const call = (method, params = {}) => callCompanion(server.connectionPath, { method, params })
  const connection = JSON.parse(await readFile(server.connectionPath, 'utf8'))
  for (const method of ['studioInstancePrepareChanges', 'studioInstanceSaveChanges', 'studioContentExport']) {
    const denied = await fetch(`${connection.origin}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: connection.origin }, body: JSON.stringify({ method, params: {} }) })
    assert.equal(denied.status, 403)
  }
  const copied = await call('studioInstanceCopy', { kind: 'bundle', bundle: pin })
  const input = { id: copied.id, expectedRevision: 0, changes: additions() }
  const candidate = await call('studioInstancePrepareChanges', input)
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
  assert.equal(candidate.revision, candidate.preview.revision)
  const saved = await call('studioInstanceSaveChanges', { ...input, mode: 'validated', digest: candidate.digest })
  assert.equal(saved.revision, 1); assert.equal(saved.changeReceipt.validation, 'preview_passed')
  const read = await call('studioInstanceRead', { id: copied.id })
  assert.equal(read.baseSnapshot, saved.baseSnapshot)
  for (const change of input.changes) assert.equal((await call('studioInstanceFile', { id: copied.id, path: change.path })).content, change.content)
  await assert.rejects(call('studioInstanceSaveChanges', { ...input, mode: 'validated', digest: candidate.digest }), /changed elsewhere/)
  const invalid = await call('studioInstancePrepareChanges', { id: copied.id, expectedRevision: 1, changes: [{ path: 'schema.yaml', content: null }] })
  assert.equal(invalid.valid, false)
  await assert.rejects(call('studioInstanceSaveChanges', { id: copied.id, expectedRevision: 1, changes: [{ path: 'schema.yaml', content: null }], mode: 'validated', digest: invalid.digest }), /Core preview/)
  assert.equal((await call('studioInstanceRead', { id: copied.id })).revision, 1)
  const mcp = createDesignMcp(), client = new Client({ name: 'studio-customization-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => { await client.close(); await mcp.close() })
  await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)])
  const customize = (action, request) => client.callTool({ name: 'design_studio_customize',
    arguments: { connection: server.connectionPath, action, request } })
  const tools = await client.listTools()
  assert.ok(tools.tools.some(tool => tool.name === 'design_studio_customize'))
  assert.equal((await client.callTool({ name: 'design_studio_customize', arguments: { connection: server.connectionPath,
    action: 'read', request: { id: copied.id }, authoringRequestId: 'not-a-read-authority' } })).isError, true)
  assert.equal((await customize('read', { id: copied.id, authoringRequestId: 'nested-routing-field' })).isError, true)
  assert.equal((await customize('read', { id: copied.id })).isError, undefined)
  const second = { id: copied.id, expectedRevision: 1,
    changes: [{ path: 'SKILL.md', content: Buffer.from(originalFiles[0].base64, 'base64').toString('utf8') + '\nRetain the team’s review instructions.\n' }] }
  const proposed = await customize('prepareChanges', second)
  assert.ok(!proposed.isError, JSON.stringify(proposed))
  const next = JSON.parse(proposed.content[0].text)
  assert.equal((await call('studioInstanceRead', { id: copied.id })).revision, 1, 'MCP preparation never saves')
  const applied = await customize('saveChanges', { ...second, mode: 'validated', digest: next.digest })
  assert.ok(!applied.isError, JSON.stringify(applied))
  assert.equal((await call('studioInstanceRead', { id: copied.id })).revision, 2)
  assert.equal((await call('studioInstanceFile', { id: copied.id, path: 'SKILL.md' })).content, second.changes[0].content)
  assert.equal((await customize('saveChanges', { ...second, mode: 'validated', digest: next.digest })).isError, true)
  const provenance = { source: 'synthetic saved-copy HTTP test', license: 'Apache-2.0' }
  const bundleExport = JSON.parse(await call('studioContentExport', { id: copied.id, expectedRevision: 2, provenance }))
  assert.equal(bundleExport.kind, 'bundle')
  assert.deepEqual(bundleExport.pin, copied.bundle)
  assert.equal(Buffer.from(bundleExport.files.find(file => file.path === 'SKILL.md').base64, 'base64').toString(), second.changes[0].content)
  assert.match(Buffer.from(bundleExport.files.find(file => file.path === 'schema.yaml').base64, 'base64').toString(), /review/)
  assert.equal((await call('studioContentReadArchive', { source: JSON.stringify(bundleExport) })).sha256, bundleExport.sha256)
  await assert.rejects(call('studioContentExport', { id: copied.id, expectedRevision: 1, provenance }), /revision changed/)
  for (const mixed of [
    { id: copied.id, expectedRevision: 2, kind: 'bundle', pin: copied.bundle, provenance },
    { id: copied.id, expectedRevision: 2, provenance, stateRoot: root },
    { id: copied.id, expectedRevision: -1, provenance },
    { id: copied.id, expectedRevision: 2, provenance: { ...provenance, trusted: true } },
  ]) await assert.rejects(call('studioContentExport', mixed), /mixed target|exact working-copy|declarations/)

  const kit = await call('studioInstanceCopy', { kind: 'kit', kit: { name: 'observation_kit', version: '1.0' } })
  const method = await call('studioInstanceFile', { id: kit.id, path: 'mindset.md' })
  const kitRequest = { id: kit.id, expectedRevision: 0, bundle: { name: kit.mounts[0].bundle.name, version: kit.mounts[0].bundle.version },
    changes: [{ path: 'mindset.md', content: method.content + '\nSaved Kit HTTP export amendment.\n' }] }
  const kitCandidate = await call('studioInstancePrepareChanges', kitRequest)
  assert.equal(kitCandidate.valid, true, JSON.stringify(kitCandidate.diagnostics))
  await call('studioInstanceSaveChanges', { ...kitRequest, mode: 'validated', digest: kitCandidate.digest })
  const kitExport = JSON.parse(await call('studioContentExport', { id: kit.id, expectedRevision: 1, provenance }))
  assert.equal(kitExport.kind, 'kit'); assert.deepEqual(kitExport.pin, kit.kit)
  assert.match(Buffer.from(kitExport.files.find(file => file.path === 'mindset.md').base64, 'base64').toString(), /Saved Kit HTTP export amendment/)
  assert.ok(kitExport.files.some(file => file.path.startsWith('bundles/observations/1.0/')))
  assert.equal((await call('studioContentReadArchive', { source: JSON.stringify(kitExport) })).sha256, kitExport.sha256)
  const installed = JSON.parse(await call('studioContentExport', { kind: 'kit', pin: { name: 'observation_kit', version: '1.0' }, provenance }))
  assert.equal(installed.files.some(file => Buffer.from(file.base64, 'base64').toString().includes('Saved Kit HTTP export amendment')), false)
  const installedBundle = JSON.parse(await call('studioContentExport', { kind: 'bundle', pin, provenance }))
  assert.deepEqual(installedBundle.pin, pin)
  assert.equal(Buffer.from(installedBundle.files.find(file => file.path === 'SKILL.md').base64, 'base64').toString().includes('Retain the team'), false)
  for (const file of originalFiles) assert.equal((await readFile(join(bundleRoot, file.path))).toString('base64'), file.base64)
  assert.equal(notifications, 0)
})
