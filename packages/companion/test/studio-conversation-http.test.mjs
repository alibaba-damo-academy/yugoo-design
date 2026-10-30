/** Real HTTP, MCP, Core candidate, and retained disk; native delivery is scripted. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { DesignProjectManager } from '../../core/lib/index.js'
import { createDesignMcp } from '../src/mcp.mjs'
import { startCompanion } from '../src/server.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { staticFixture } from './static-fixture.mjs'
import { originalFiles, additions, pin, adapters } from './fixtures/studio-changes-fixture.mjs'
import { createStudioInstances } from '../src/studio-instances.mjs'

async function setup(t, result = { accepted: true, status: 'submitted_unverified' }) {
  const root = await mkdtemp(join(tmpdir(), 'studio-conversation-http-'))
  let server
  t.after(async () => { await server?.close(); await rm(root, { recursive: true, force: true }) })
  const kitRoot = join(root, 'content/kits/observation_kit'), bundleRoot = join(root, 'content/bundles/observations'), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
  await mkdir(kitRoot, { recursive: true }); await mkdir(stateRoot)
  await writeFile(join(kitRoot, 'mindset.md'), '---\nname: observation_kit\nversion: "1.0"\ndescription: Record supplied observations.\n---\nPreserve supplied facts.\n<design_skills>\n## observations\nRecord supplied observations.\n</design_skills>\n')
  await writeFile(join(kitRoot, 'kit.yaml'), 'version: 1\nmounts:\n  - {bindingKey: observations, name: observations, version: "1.0"}\n')
  for (const file of originalFiles) {
    const path = join(bundleRoot, file.path)
    await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, Buffer.from(file.base64, 'base64'))
  }
  await new DesignProjectManager().create({ root: projectRoot, name: 'Isolated Studio conversation', kit: { name: 'observation_kit', version: '1.0' }, knowledge: { provider: 'ladybug-wasm' } })
  const messages = [], threadId = randomUUID()
  server = await startCompanion({ ...await staticFixture(root), projectRoot, nativeCwd: projectRoot, stateRoot, kitRoot,
    browserAccess: 'local', knowledgeAutoRefresh: false, embedding: { provider: 'disabled' },
    knowledgeRuntime: async () => { throw Error('No KAG runtime in this fixture.') }, host: 'codex',
    connection: { host: 'codex', threadId, send: async (text, metadata) => { messages.push({ text, metadata }); return { ...result, threadId } } },
  })
  const call = (method, params = {}) => callCompanion(server.connectionPath, { method, params })
  const browser = async (method, params = {}) => {
    const response = await fetch(`${server.url}api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: server.origin, 'X-Design-Browser': '1' }, body: JSON.stringify({ method, params }) })
    const value = await response.json()
    if (!response.ok) throw Error(value.error)
    return value
  }
  return { server, root, kitRoot, bundleRoot, projectRoot, stateRoot, messages, threadId, call, browser }
}

test('Studio request -> same main transport -> MCP S2 prepare -> exact UI review -> explicit save shares one copy', async t => {
  const f = await setup(t)
  const info = await f.browser('info'), copy = await f.browser('studioInstanceCopy', { kind: 'bundle', bundle: pin })
  const studio = { ...info.studioConversation, id: copy.id, expectedRevision: copy.revision }
  const requestId = 'authoring-one'
  const runtime = await f.call('savePanel', { skill: 'observations', eventId: 'runtime-save-before-authoring', includeDerivedStatus: false,
    state: { items: { item_01: { title: 'Runtime observation stays unchanged', status: 'open' } } } })
  const runtimeFile = join(f.projectRoot, 'design_files/observations/observations.json')
  const runtimeBytes = await readFile(runtimeFile)
  const receipt = await f.browser('sendPrompt', { requestId, studio, context: { intent: 'edit', currentFile: 'SKILL.md' }, text: 'Propose an additional review status. I will inspect it before saving.' })
  assert.equal(receipt.status, 'submitted_unverified')
  assert.equal(f.messages.length, 1)
  assert.deepEqual(f.messages[0].metadata.saved, [])
  assert.doesNotMatch(f.messages[0].text, /Runtime observation stays unchanged/)
  assert.match(f.messages[0].text, /Studio Kit\/Bundle customization/)
  assert.ok(f.messages[0].text.includes(JSON.stringify(copy.title)))
  assert.match(f.messages[0].text, /"intent":"edit","currentFile":"SKILL.md"/)
  assert.match(f.messages[0].text, /design_list_panel_components/)
  assert.match(f.messages[0].text, /reference=contract\/docs\/examples/)
  assert.match(f.messages[0].text, /authoringRequestId "authoring-one"/)
  assert.doesNotMatch(f.messages[0].text, /Read the current Design Files|turn off automatic GRA|native-execution reference for Bundle work/)
  assert.equal((await f.browser('studioAuthoringCandidateRead', { requestId, studio })).prepared, null)

  const client = new Client({ name: 'studio-main-test', version: '1' })
  if (process.env.STUDIO_MCP_ENTRY) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [process.env.STUDIO_MCP_ENTRY, 'mcp'], stderr: 'pipe' })
    t.after(async () => { await client.close(); await transport.close() })
    await client.connect(transport)
  } else {
    const mcp = createDesignMcp(), [left, right] = InMemoryTransport.createLinkedPair()
    t.after(async () => { await client.close(); await mcp.close() })
    await Promise.all([client.connect(left), mcp.connect(right)])
  }
  const customize = (action, request, association) => client.callTool({ name: 'design_studio_customize', arguments: {
    connection: f.server.connectionPath, action, request, ...(association ? { authoringRequestId: association } : {}),
  } })
  const input = { id: copy.id, expectedRevision: copy.revision, changes: additions() }
  const proposed = await customize('prepareChanges', input, requestId)
  assert.ok(!proposed.isError, JSON.stringify(proposed))
  const candidate = JSON.parse(proposed.content[0].text)
  assert.equal(candidate.valid, true)
  assert.equal((await f.browser('studioInstanceRead', { id: copy.id })).revision, copy.revision, 'prepare did not save')
  const read = await f.browser('studioAuthoringCandidateRead', { requestId, studio })
  assert.deepEqual(read.prepared.request, input)
  assert.equal(read.prepared.candidate.digest, candidate.digest)
  assert.equal(read.prepared.candidate.preview.revision, candidate.revision)
  await assert.rejects(f.browser('studioAuthoringCandidateRead', { requestId: 'guessed-latest', studio }), /Unknown Studio/)
  await assert.rejects(f.browser('studioAuthoringCandidateRead', { requestId, studio: { ...studio, expectedRevision: 1 } }), /target changed/)
  await assert.rejects(f.browser('studioAuthoringCandidateRead', { requestId, studio: { ...studio, bindingId: 'old-service' } }), /target changed/)
  const unknown = await customize('prepareChanges', input, 'unknown-request')
  assert.equal(unknown.isError, true)

  // This explicit fixture save represents the reviewer's click, not model auto-save.
  const saved = await f.browser('studioInstanceSaveChanges', { ...read.prepared.request, digest: candidate.digest, mode: 'validated' })
  assert.equal(saved.changeReceipt.validation, 'preview_passed')
  assert.equal(saved.changeReceipt.digest, candidate.digest)
  const reopened = await customize('read', { id: copy.id })
  assert.equal(JSON.parse(reopened.content[0].text).revision, saved.revision)
  for (const change of input.changes) {
    const fromMain = await customize('readFile', { id: copy.id, path: change.path })
    assert.equal(JSON.parse(fromMain.content[0].text).content, change.content)
  }
  await assert.rejects(f.browser('studioAuthoringCandidateRead', { requestId, studio }), /changed/)
  for (const file of originalFiles) assert.equal((await readFile(join(f.bundleRoot, file.path))).toString('base64'), file.base64)
  assert.equal(f.messages.length, 1, 'prepare, review, save, and readback never dispatch another native message')
  assert.deepEqual(await readFile(runtimeFile), runtimeBytes, 'Studio authoring never writes running Design Files')
  const workspace = await f.call('readWorkspace', { includeConversation: false })
  assert.equal(workspace.checkpoint, runtime.commit)
  assert.equal(workspace.savedContinuations.find(item => item.eventId === 'runtime-save-before-authoring').retryable, true,
    'Studio send did not consume the unrelated pending Design save')
})

test('create is available through the existing browser and MCP routes, and editing hints cannot select a foreign file', async t => {
  const f = await setup(t), customize = await nativeCustomize(t, f)
  const kit = await f.browser('studioInstanceCreate', { kind: 'kit', title: { zh: '新方法', en: 'New method' } })
  const bundle = await customize('create', { kind: 'bundle', title: { zh: '新模块', en: 'New Bundle' } })
  assert.equal(kit.createdBlank, true); assert.equal(bundle.createdBlank, true)
  assert.notEqual(kit.id, bundle.id)
  const info = await f.browser('info'), studio = { ...info.studioConversation, id: kit.id, expectedRevision: kit.revision }
  await assert.rejects(f.browser('sendPrompt', { requestId: 'foreign-file', studio, context: { intent: 'create', currentFile: '../SKILL.md' }, text: 'Edit this method' }), /changed/)
  await assert.rejects(f.browser('sendPrompt', { requestId: 'scope-forged', studio, context: { intent: 'create', dirty: false }, text: 'Edit this method' }), /Invalid Studio editing/)
  assert.equal(f.messages.length, 0)
  await f.browser('sendPrompt', { requestId: 'new-kit', studio, context: { intent: 'create', currentFile: 'mindset.md' }, text: 'Clarify this method; prepare only.' })
  assert.equal(f.messages.length, 1)
  assert.match(f.messages[0].text, /"intent":"create","currentFile":"mindset.md"/)
  assert.ok(f.messages[0].text.includes(JSON.stringify(kit.title)))
  assert.match(f.messages[0].text, /Kit-owned source authoring may omit/)
  assert.equal((await f.call('studioInstanceRead', { id: kit.id })).revision, kit.revision)
})

test('stale service/copy and duplicate uncertain requests are rejected without native redelivery', async t => {
  const f = await setup(t, { accepted: false, status: 'unknown' })
  const info = await f.browser('info'), copy = await f.call('studioInstanceCopy', { kind: 'bundle', bundle: pin })
  const studio = { ...info.studioConversation, id: copy.id, expectedRevision: 0 }
  await assert.rejects(f.browser('sendPrompt', { requestId: 'wrong', studio: { ...studio, bindingId: 'old' }, text: 'One intent' }), /changed/)
  await assert.rejects(f.browser('sendPrompt', { requestId: 'stale', studio: { ...studio, expectedRevision: 4 }, text: 'One intent' }), /changed/)
  assert.equal(f.messages.length, 0)
  const receipt = await f.browser('sendPrompt', { requestId: 'uncertain', studio, text: 'One intent' })
  assert.equal(receipt.status, 'unknown')
  await assert.rejects(f.browser('sendPrompt', { requestId: 'uncertain', studio, text: 'One intent' }), /already submitted/)
  assert.equal(f.messages.length, 1)
  assert.equal((await f.call('studioInstanceRead', { id: copy.id })).revision, 0)
})

test('Kit authoring binds its mounted preview pin and saves the same Core-validated candidate', async t => {
  const f = await setup(t), info = await f.browser('info')
  const copy = await f.browser('studioInstanceCopy', { kind: 'kit', kit: { name: 'observation_kit', version: '1.0' } })
  assert.ok(copy.mounts.some(mount => mount.bundle.name === pin.name && mount.bundle.version === pin.version))
  const studio = { ...info.studioConversation, id: copy.id, expectedRevision: copy.revision, bundle: pin }
  await assert.rejects(f.browser('sendPrompt', { requestId: 'wrong-pin', studio: { ...studio, bundle: { ...pin, version: '2.0' } }, text: 'Propose a method clarification.' }), /changed/)
  assert.equal(f.messages.length, 0)
  await f.browser('sendPrompt', { requestId: 'kit-authoring', studio, text: 'Clarify the Kit method; prepare only.' })
  assert.match(f.messages[0].text, /"bundle":\{"name":"observations","version":"1.0"\}/)
  const file = await f.call('studioInstanceFile', { id: copy.id, path: 'mindset.md' })
  const input = { id: copy.id, expectedRevision: copy.revision, bundle: pin,
    changes: [{ path: 'mindset.md', content: file.content + '\nExplain which supplied evidence supports each observation.\n' }] }
  await assert.rejects(f.call('studioInstancePrepareChanges', { ...input, authoringRequestId: 'kit-authoring', bundle: { ...pin, version: '2.0' } }), /preview Bundle/)
  const candidate = await f.call('studioInstancePrepareChanges', { ...input, authoringRequestId: 'kit-authoring' })
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
  assert.equal((await f.browser('studioInstanceRead', { id: copy.id })).revision, copy.revision)
  const read = await f.browser('studioAuthoringCandidateRead', { requestId: 'kit-authoring', studio })
  assert.equal(read.prepared.candidate.digest, candidate.digest)
  const saved = await f.browser('studioInstanceSaveChanges', { ...read.prepared.request, mode: 'validated', digest: candidate.digest })
  assert.equal(saved.revision, copy.revision + 1)
  assert.equal((await f.call('studioInstanceFile', { id: copy.id, path: 'mindset.md' })).content, input.changes[0].content)
  assert.equal(f.messages.length, 1)
})

async function nativeCustomize(t, f) {
  const client = new Client({ name: 'studio-host-candidate-test', version: '1' })
  const mcp = createDesignMcp(), [left, right] = InMemoryTransport.createLinkedPair()
  t.after(async () => { await client.close(); await mcp.close() })
  await Promise.all([client.connect(left), mcp.connect(right)])
  return async (action, request) => {
    const result = await client.callTool({ name: 'design_studio_customize', arguments: { connection: f.server.connectionPath, action, request } })
    if (result.isError) throw Error(result.content[0].text)
    return JSON.parse(result.content[0].text)
  }
}

test('ordinary Host MCP prepare discovers the same S2 candidate and saves/reopens only through explicit existing save', async t => {
  const f = await setup(t), customize = await nativeCustomize(t, f)
  const copy = await customize('copy', { kind: 'bundle', bundle: pin })
  const info = await f.browser('info'), studio = { ...info.studioConversation, id: copy.id, expectedRevision: copy.revision, bundle: copy.bundle ?? copy.source.bundle }
  const input = { id: copy.id, expectedRevision: copy.revision, changes: additions() }
  const direct = await f.browser('studioInstancePrepareChanges', input)
  assert.equal(direct.authoring, undefined, 'ordinary file editor remains outside conversation correlation')
  assert.deepEqual(await f.browser('studioAuthoringCandidateList', { studio }), { candidates: [] })
  const candidate = await customize('prepareChanges', input)
  assert.equal(candidate.digest, direct.digest, 'one original S2 preparation authority and digest')
  assert.equal(candidate.valid, true)
  assert.deepEqual(candidate.authoring.studio, studio)
  const { requestId, url } = candidate.authoring
  const entry = new URL(url)
  assert.equal(entry.origin, f.server.origin)
  assert.equal(entry.pathname, new URL(f.server.url).pathname)
  assert.equal(entry.hash, '')
  assert.equal(entry.searchParams.get('view'), 'studio')
  assert.equal(entry.searchParams.get('presentation'), 'conversation')
  assert.deepEqual(JSON.parse(entry.searchParams.get('studioTarget')), studio)
  assert.equal(entry.searchParams.get('studioRequest'), requestId)
  assert.equal(f.messages.length, 0, 'prepare creates no new model dispatch or conversation delivery')
  assert.equal((await f.call('studioInstanceRead', { id: copy.id })).revision, copy.revision)
  const repeated = await customize('prepareChanges', input)
  assert.equal(repeated.authoring.requestId, requestId)
  assert.equal(repeated.digest, candidate.digest)
  assert.deepEqual(await f.browser('studioAuthoringCandidateList', { studio }), { candidates: [{ requestId, studio, digest: candidate.digest,
    changedFiles: candidate.diff.map(file => file.path) }] })
  const read = await f.browser('studioAuthoringCandidateRead', { requestId, studio })
  assert.deepEqual(read.prepared.request, input)
  assert.equal(read.prepared.candidate.digest, candidate.digest)
  assert.equal(read.prepared.candidate.authoring, undefined)
  await assert.rejects(f.browser('studioInstanceSaveChanges', { ...input, mode: 'validated', digest: '0'.repeat(64) }), /digest|candidate/i)
  await assert.rejects(f.call('studioInstanceSaveChanges', { ...input, mode: 'validated', digest: candidate.digest, authoringRequestId: requestId }), /Only prepareChanges/)
  assert.equal((await f.call('studioInstanceRead', { id: copy.id })).revision, copy.revision)
  const saved = await f.browser('studioInstanceSaveChanges', { ...read.prepared.request, mode: 'validated', digest: candidate.digest })
  assert.equal(saved.revision, copy.revision + 1)
  assert.equal(saved.changeReceipt.digest, candidate.digest)
  const reopened = await createStudioInstances({ stateRoot: f.stateRoot, ...adapters() })
  assert.equal((await reopened.read({ id: copy.id })).revision, saved.revision)
  for (const change of input.changes) assert.equal((await reopened.readFile({ id: copy.id, path: change.path })).content, change.content)
  await assert.rejects(f.browser('studioAuthoringCandidateList', { studio }), /changed/)
  await assert.rejects(f.browser('studioAuthoringCandidateRead', { requestId, studio }), /changed/)
})

test('native candidate discovery retains authentication, exact binding/revision/pin and explicit UI request guards', async t => {
  const f = await setup(t), other = await setup(t), customize = await nativeCustomize(t, f)
  const copy = await f.call('studioInstanceCopy', { kind: 'bundle', bundle: pin })
  const info = await f.browser('info'), studio = { ...info.studioConversation, id: copy.id, expectedRevision: copy.revision, bundle: copy.bundle ?? copy.source.bundle }
  const input = { id: copy.id, expectedRevision: copy.revision, changes: additions() }
  const candidate = await customize('prepareChanges', input)
  for (const wrong of [{ bindingId: 'wrong-service' }, { threadId: 'wrong-thread' }, { expectedRevision: 7 }, { bundle: { ...pin, version: '2.0' } }]) {
    await assert.rejects(f.browser('studioAuthoringCandidateList', { studio: { ...studio, ...wrong } }), /changed/)
    await assert.rejects(f.browser('studioAuthoringCandidateRead', { requestId: candidate.authoring.requestId, studio: { ...studio, ...wrong } }), /changed/)
  }
  await assert.rejects(other.call('studioAuthoringCandidateList', { studio }), /changed/)
  await assert.rejects(other.call('studioAuthoringCandidateRead', { requestId: candidate.authoring.requestId, studio }), /Unknown/)
  await assert.rejects(f.browser('studioAuthoringPrepareChanges', input), /not available to the browser/)
  await assert.rejects(f.call('studioAuthoringPrepareChanges', { ...input, origin: 'native' }), /Invalid/)
  await assert.rejects(f.call('studioInstancePrepareChanges', { ...input, authoringRequestId: 'guessed-latest' }), /Unknown/)
  await assert.rejects(customize('prepareChanges', { ...input, expectedRevision: 8 }), /changed/)
  await assert.rejects(customize('prepareChanges', { ...input, bundle: { ...pin, version: '2.0' } }), /changed/)
  const denied = await fetch(`${f.server.origin}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.server.origin },
    body: JSON.stringify({ method: 'studioAuthoringPrepareChanges', params: input }) })
  assert.equal(denied.status, 403)
  assert.equal((await f.call('studioInstanceRead', { id: copy.id })).revision, copy.revision)
  assert.equal((await f.browser('studioAuthoringCandidateList', { studio })).candidates.length, 1)
  assert.equal(f.messages.length, 0)
})

test('Kit without a preview Bundle keeps original S2 source-review semantics', async t => {
  const f = await setup(t), customize = await nativeCustomize(t, f)
  const copy = await customize('copy', { kind: 'kit', kit: { name: 'observation_kit', version: '1.0' } })
  const file = await f.call('studioInstanceFile', { id: copy.id, path: 'mindset.md' })
  const input = { id: copy.id, expectedRevision: copy.revision, changes: [{ path: 'mindset.md', content: file.content + '\nClarify the supplied evidence.\n' }] }
  const direct = await f.call('studioInstancePrepareChanges', input), candidate = await customize('prepareChanges', input)
  assert.equal(candidate.authoring.studio.bundle, undefined)
  assert.equal(candidate.digest, direct.digest)
  assert.deepEqual(candidate.preview, direct.preview)
  assert.deepEqual(candidate.diagnostics, direct.diagnostics)
  assert.equal(candidate.valid, direct.valid)
  assert.equal((await f.browser('studioAuthoringCandidateList', { studio: candidate.authoring.studio })).candidates.length, 1)
  assert.equal((await f.browser('studioAuthoringCandidateList', { studio: { ...candidate.authoring.studio, bundle: pin } })).candidates.length, 0)
})
