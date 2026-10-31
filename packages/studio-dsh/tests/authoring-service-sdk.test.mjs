/** Actual official Gateway/Agent lookup and native loop, scripted model, real S2/S5a disk.
 * Connection/peer and installed Fs/registry are explicit fixtures; no HTTP/profile acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { fixture as sdkFixture, call, stop, deferred, sessions, llm } from './fixtures/authoring-sdk.mjs'

const { Service } = await import('@deepseek-ai/cordis')
const { remoteMethods } = await import('@deepseek-ai/dsh-typert-protocol')
const { default: Registry } = await import('@deepseek-ai/dsh-typert-registry')
const { default: Gateway } = await import('@deepseek-ai/dsh-api-gateway')
const built = process.env.STUDIO_AUTHORING_SERVICE_BUILT === '1'
const { default: NativeService } = await import(new URL(built ? '../lib/authoring-service.js' : '../src/authoring-service.ts', import.meta.url).href)
const { DshStudioManagementService: ManagementService } = await import(new URL(built ? '../lib/index.js' : '../src/service.ts', import.meta.url).href)
const { default: TYPERT } = await import(new URL(built ? '../lib/typert.host.js' : '../src/typert.host.ts', import.meta.url).href)
const { createSameOriginStudioAuthoringClient } = await import(new URL(built ? '../lib/authoring.page-rpc.js' : '../src/authoring.page-rpc.ts', import.meta.url).href)
const { originalFiles, additions, pin } = await import('../../companion/test/fixtures/studio-changes-fixture.mjs')
const { loadDesignBundle } = await import('dsh-design-core')
const { queryPanelAuthoringReference } = await import('dsh-design-core/dsl')
const sequence = n => [call('studio_authoring_read', {}), call('studio_authoring_prepare', { changes: additions() }), stop()][n % 3]
const addressOf = r => ({ sessionId: r.sessionId, epoch: r.epoch })

async function sources() {
  const root = '/fixture/service-source', files = new Map(originalFiles.map(f => [root + '/' + f.path, Buffer.from(f.base64, 'base64')]))
  const dirs = new Set([root]), keys = new Map(), paths = new Map()
  for (const file of files.keys()) for (let i = file.lastIndexOf('/'); i > 0; i = file.lastIndexOf('/', i - 1)) dirs.add(file.slice(0, i))
  const target = path => { if (!keys.has(path)) { const t = { targetKey: 'service-opaque:' + keys.size, displayPath: 'fixture://source' }; keys.set(path, t); paths.set(t.targetKey, path) } return keys.get(path) }
  const port = {
    resolve: async path => target(path),
    contains: (a, b) => paths.get(b.targetKey).startsWith(paths.get(a.targetKey) + '/') || a.targetKey === b.targetKey,
    stat: async t => files.has(paths.get(t.targetKey)) ? { type: 'file', version: 'v1', size: files.get(paths.get(t.targetKey)).length } : dirs.has(paths.get(t.targetKey)) ? { type: 'directory', version: 'v1' } : undefined,
    readBytes: async (t, _signal, max) => { const bytes = files.get(paths.get(t.targetKey)); assert.ok(bytes.length <= max); return Buffer.from(bytes) },
    listDir: async t => { const prefix = paths.get(t.targetKey) + '/', names = new Set(); for (const p of [...dirs, ...files.keys()]) if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0]); return [...names].map(name => ({ name, type: dirs.has(prefix + name) ? 'directory' : 'file', target: target(prefix + name) })) },
  }
  const content = await loadDesignBundle({ readText: async p => files.get(p)?.toString('utf8'), readBytes: async p => files.get(p),
    listDir: async p => (await port.listDir(target(p))).map(e => e.name), isDirectory: async p => dirs.has(p), realPath: async p => p },
  { rootDir: root, sourceId: 'trusted:service-source-fixture' }, pin)
  return { design: { registerCurrentKitSource: () => () => {}, listKits: () => [],
    listCurrentKits: async () => [{ name: 'local_imported_kit', version: '1.0', description: 'Imported customer feedback' }],
    listBundles: () => [content.skill], resolveBundle: p => p.name === pin.name && p.version === pin.version ? content : undefined, resolveKit: () => undefined }, fs: port }
}

async function fixture(t, options = {}) {
  const sdk = await sdkFixture(t, { step: options.step ?? sequence }), source = await sources()
  if (options.withWebServer) {
    const { WebServer } = await import('@deepseek-ai/dsh-host-webserver')
    await sdk.ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  }
  for (const name of ['design', 'fs']) {
    class Source extends Service { constructor(ctx) { super(ctx, name); Object.assign(this, source[name]) } }
    await sdk.ctx.plugin(Source)
  }
  if (options.withManagement) await sdk.ctx.plugin(ManagementService, { followInstalledSources: true })
  let carrier
  const peerSignal = new AbortController().signal
  class Connection extends Service {
    constructor(ctx) { super(ctx, 'connection'); carrier = this }
    get rpc() { return { intercept: (_channel, _matches, handler) => this.ctx.effect(() => {
      this.asPeer = (endpoint, payload, signal, principal) => handler(endpoint, payload, signal,
        { id: 'service-test-operator', ctx: this.ctx, principal, signal: peerSignal, dispose: async () => {} })
      this.handler = (endpoint, payload, signal) => this.asPeer(endpoint, payload, signal, { kind: 'owner' })
      return () => { this.handler = undefined; this.asPeer = undefined }
    }) } }
    requestRejection() { return undefined }
  }
  await sdk.ctx.plugin(Registry)
  sdk.ctx.typert.register(TYPERT)
  // RC3 Gateway requires its real access service. The explicit transport
  // fixture models the same owner Peer as before; non-owner denial stays real.
  const withRemoteAccess = Gateway.inject?.includes('remoteAccess')
  if (withRemoteAccess) await sdk.ctx.plugin((await import('@deepseek-ai/dsh-api-remote-access')).default)
  await sdk.ctx.plugin(Connection); await sdk.ctx.plugin(Gateway)
  assert.equal(await sdk.ctx.typert.lookups.get('agent').resolve(sdk.parent.agent.id), sdk.parent.agent)
  const stateRoot = join(await fs.realpath(sdk.root), 'private-service'), workspaceRoot = join(sdk.root, 'isolated-service')
  await fs.mkdir(workspaceRoot, { mode: 0o700 })
  const config = { stateRoot, workspaceRoot }
  let owner
  const activate = async () => { owner = sdk.ctx.plugin(NativeService, config); await owner; return owner }
  t.after(async () => { await owner?.dispose() })
  const wire = async (endpoint, args) => carrier.handler(endpoint, { args }, new AbortController().signal)
  const wireAs = async (endpoint, args, principal) => carrier.asPeer(endpoint, { args }, new AbortController().signal, principal)
  const client = agentId => createSameOriginStudioAuthoringClient({ agentId, fetch: async (_url, init) => {
    const frame = JSON.parse(init.body), result = await carrier.handler(frame.method, frame.payload, new AbortController().signal)
    return new Response(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId, result }))
  } })
  if (!options.deferService) await activate()
  return { ...sdk, config, stateRoot, source, activate, get owner() { return owner }, client: client(String(sdk.parent.agent.id)), clientFor: client, wire, wireAs, withRemoteAccess }
}

test('native parent stateless archives import through S2 and preserve exact saved bytes on reopen', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  const bundle = await f.client.instances.copy({ kind: 'bundle', bundle: pin })
  const provenance = { source: 'fixture:archive', license: 'Synthetic fixture only' }
  const source = await f.client.content.export({ id: bundle.id, expectedRevision: 0, provenance })
  const archive = await f.client.content.readArchive({ source })
  const imported = await f.client.instances.importSources({ kind: archive.kind, title: archive.title,
    files: archive.files.map(({ path, base64 }) => ({ path, base64 })) })
  assert.notEqual(imported.id, bundle.id)
  const original = await f.client.instances.readFile({ id: imported.id, path: 'SKILL.md' })
  await f.client.instances.saveFile({ id: imported.id, expectedRevision: 0, path: original.path,
    content: original.content + '\nA saved user amendment.\n' })
  await assert.rejects(f.client.content.export({ id: imported.id, expectedRevision: 0, provenance }), /revision changed/)
  const saved = await f.client.content.export({ id: imported.id, expectedRevision: 1, provenance })
  const parsed = await f.client.content.readArchive({ source: saved })
  assert.match(Buffer.from(parsed.files.find(file => file.path === 'SKILL.md').base64, 'base64').toString(), /A saved user amendment/)
  assert.deepEqual(Buffer.from(parsed.files.find(file => file.path === 'reference/preserved.bin').base64, 'base64'), Buffer.from([0, 255, 128, 10]))
  await assert.rejects(f.client.content.readArchive({ source: JSON.stringify({ ...parsed, sha256: '0'.repeat(64) }) }), /integrity/)
  await assert.rejects(f.clientFor('not-a-live-parent').content.readArchive({ source }), /request failed|Agent|agent/)
  assert.equal(f.calls(), 0, 'archive and source ports do not create model work')
  await f.owner.dispose(); await f.activate()
  assert.match((await f.client.instances.readFile({ id: imported.id, path: 'SKILL.md' })).content, /A saved user amendment/)
})
async function until(operation, ready) {
  for (let i = 0; i < 100; i++) { const value = await operation(); if (ready(value)) return value; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.fail('Expected native observation did not settle')
}

test('actual Gateway creates blank working copies through guarded native parents and preserves them after service reopen', { timeout: 20000 }, async t => {
  const f = await fixture(t), created = []
  for (const kind of ['kit', 'bundle']) {
    const record = await f.client.instances.create({ kind, title: { zh: '新方法', en: 'New method' } })
    assert.equal(record.kind, kind); assert.equal(record.createdBlank, true); assert.equal(record.revision, 0)
    assert.deepEqual(record.source, {}); assert.deepEqual(record.mounts, [])
    created.push(record)
  }
  const service = f.ctx.get('studioAuthoring'), input = { kind: 'kit', title: { zh: '调用时标题', en: 'Call-time title' } }
  const creating = service.create(f.parent.agent, input)
  input.kind = 'bundle'; input.title.en = 'Unsubmitted mutation'
  const captured = await creating
  assert.equal(captured.kind, 'kit'); assert.equal(captured.title.en, 'Call-time title')
  const missing = await f.wire('studioAuthoring/create', { agentId: randomUUID(), request: { kind: 'kit', title: { zh: '', en: '' } } })
  assert.equal(missing.ok, false); assert.equal(missing.error.code, 'gateway/lookup-not-found')
  const forged = await f.wire('studioAuthoring/create', { agentId: String(f.parent.agent.id),
    request: { kind: 'kit', title: { zh: '', en: '' }, parentSessionId: randomUUID(), stateRoot: '/untrusted' } })
  assert.equal(forged.ok, false)
  if (f.withRemoteAccess) {
    const denied = await f.wireAs('studioAuthoring/create', { agentId: String(f.parent.agent.id),
      request: { kind: 'kit', title: { zh: '', en: '' } } }, { kind: 'studio-fixture-guest' })
    assert.equal(denied.ok, false)
  }
  assert.equal((await f.client.instances.list()).length, 3, 'rejected requests never create another working copy')
  assert.equal(f.calls(), 0); assert.equal(f.childIds.length, 0, 'creation never dispatches a native model')
  await f.owner.dispose()
  await assert.rejects(f.client.instances.create({ kind: 'kit', title: { zh: '', en: '' } }))
  await f.activate()
  for (const record of created) assert.equal((await f.client.instances.read({ id: record.id })).createdBlank, true)
})

test('Host conversation reads packaged creator methods without widening source or native authority', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  const execute = request => f.ctx.tools.execute({ callId: llm.ToolCallId(randomUUID()), name: 'studio_customize',
    arguments: { action: 'read', request }, agent: f.parent.agent, signal: new AbortController().signal })
  const copied = await f.client.instances.copy({ kind: 'bundle', bundle: pin })
  if (f.withRemoteAccess) {
    const denied = await f.wireAs('studioAuthoring/list', { agentId: String(f.parent.agent.id) }, { kind: 'studio-fixture-guest' })
    assert.match(JSON.stringify(denied), /remote-access\/denied|access denied/, 'the official RC3 access service still rejects ungranted non-owner Peers')
  }
  const response = await execute({ authoring: {} })
  assert.equal(response.isError, false)
  assert.equal(JSON.parse(response.content.find(block => block.type === 'text').text).studioUrl,
    `/design-studio/?agentId=${encodeURIComponent(String(f.parent.agent.id))}`,
    'a Host without an HTTP server retains its route locator instead of inventing a port')
  const index = JSON.parse(response.content.find(block => block.type === 'text').text).result
  assert.equal(index.resource, 'index.md')
  assert.deepEqual(index.skills.map(skill => skill.name).sort(), ['design-bundle-creator', 'design-kit-creator', 'design-skill-creator'])
  const method = await execute({ authoring: { resource: index.skills.find(skill => skill.name === 'design-bundle-creator').method } })
  assert.equal(method.isError, false); assert.match(JSON.stringify(method), /Bundle/)
  const components = await execute({ components: {} })
  assert.equal(components.isError, false); assert.match(JSON.stringify(components), /record_board/)
  const material = JSON.parse(await fs.readFile(new URL('../lib/authoring/panel-components.json', import.meta.url), 'utf8'))
  const readComponents = async selectors => {
    let offset = 0, content = '', totalBytes
    for (;;) {
      const reply = await execute({ components: { ...selectors, ...(offset ? { offset } : {}) } })
      assert.equal(reply.isError, false)
      const data = JSON.parse(reply.content.find(block => block.type === 'text').text).result
      if (data.format !== 'json') { assert.equal(offset, 0); return data }
      assert.equal(data.component, selectors.name); assert.equal(data.reference, selectors.reference)
      assert.equal(data.offset, offset); assert.equal(Buffer.byteLength(data.content), data.bytes)
      assert.ok(data.bytes > 0 && data.bytes <= 16 * 1024)
      totalBytes ??= data.totalBytes; assert.equal(data.totalBytes, totalBytes)
      content += data.content
      if (data.nextOffset === undefined) { assert.equal(Buffer.byteLength(content), totalBytes); return JSON.parse(content) }
      assert.equal(data.nextOffset, offset + data.bytes); assert.ok(data.nextOffset < totalBytes)
      offset = data.nextOffset
    }
  }
  for (const reference of ['contract', 'docs', 'examples']) {
    const data = await readComponents({ name: 'record_board', reference })
    const expected = JSON.parse(JSON.stringify(queryPanelAuthoringReference(material, 'record_board', reference)))
    assert.deepEqual(data, expected, 'the Host tool returns the complete packaged JSON reference')
    assert.equal(data.component, 'record_board')
    if (reference === 'contract') {
      assert.ok(data.contracts.length > 0)
      const declaration = await execute({ components: data.contracts[0].read })
      assert.equal(declaration.isError, false); assert.match(JSON.stringify(declaration), /declaration/)
    }
    if (reference === 'docs') assert.ok(data.documentation.sections.length > 0)
    if (reference === 'examples') assert.ok(data.examples.length > 0)
  }
  for (const request of [{ authoring: { resource: '/etc/passwd' } }, { authoring: { resource: '../SKILL.md' } },
    { authoring: {}, id: copied.id }, { authoring: { agentId: 'foreign' } }, { authoring: { offset: -1 } },
    { components: {}, authoring: {} }, { components: { name: '../record_board', reference: 'contract' } },
    { components: { name: 'record_board', reference: 'docs', type: 'foreign' } },
    { components: { name: 'record_board', reference: 'contract', type: 'foreign' } }]) {
    assert.equal((await execute(request)).isError, true)
  }
  assert.equal((await f.client.instances.read({ id: copied.id })).revision, 0)
  assert.equal(f.calls(), 0, 'method reads do not dispatch a model')
  assert.equal((await execute({ id: copied.id })).isError, false, 'ordinary exact-copy reads retain their existing shape')
  const invalidRename = await f.ctx.tools.execute({ callId: llm.ToolCallId(randomUUID()), name: 'studio_customize',
    arguments: { action: 'rename', request: { id: copied.id, title: { zh: '改名', en: 'Rename' } } },
    agent: f.parent.agent, signal: new AbortController().signal })
  assert.equal(invalidRename.isError, true, 'request examples never relax revision guards')
})

test('Host conversation tool and Studio RPC edit and reopen the same working-copy revisions', { timeout: 20000 }, async t => {
  const f = await fixture(t, { withManagement: true, withWebServer: true })
  const execute = (action, request, agent = f.parent.agent) => f.ctx.tools.execute({
    callId: llm.ToolCallId(randomUUID()), name: 'studio_customize', arguments: { action, request },
    agent, signal: new AbortController().signal,
  })
  assert.ok(f.ctx.tools.get('studio_customize', f.parent.agent))
  assert.ok(f.parent.agent.ctx.tools.schemas(f.parent.agent).some(tool => tool.name === 'studio_customize'))
  const listing = await execute('list', {})
  const studioUrl = new URL(JSON.parse(listing.content.find(block => block.type === 'text').text).studioUrl)
  assert.equal(studioUrl.origin, `http://127.0.0.1:${f.ctx.webServer.port}`)
  assert.equal(studioUrl.pathname, '/design-studio/')
  assert.equal(studioUrl.searchParams.get('agentId'), String(f.parent.agent.id))
  const catalog = await execute('catalog', {})
  assert.equal(catalog.isError, false)
  assert.match(JSON.stringify(catalog), /observations/)
  assert.match(JSON.stringify(catalog), /currentKits.*local_imported_kit/)
  assert.match(JSON.stringify(await execute('catalog', { query: 'customer feedback' })), /local_imported_kit/)
  assert.doesNotMatch(JSON.stringify(await execute('catalog', { query: 'not-in-this-catalog' })), /local_imported_kit/)

  // Copy through the Host tool, inspect through the page's actual Gateway client.
  const copied = await execute('copy', { kind: 'bundle', bundle: pin })
  assert.equal(copied.isError, false)
  const [record] = await f.client.instances.list()
  assert.ok(record?.id)
  assert.equal(record.revision, 0)
  const request = { id: record.id, expectedRevision: 0, changes: additions() }
  const preparation = await execute('prepareChanges', request)
  assert.equal(preparation.isError, false)
  assert.equal((await f.client.instances.read({ id: record.id })).revision, 0, 'preparation never saves')
  const prepared = await f.client.instances.prepareChanges(request)
  assert.ok(JSON.stringify(preparation).includes(prepared.digest), 'the Host renders the same candidate shown in Studio')
  const toolResult = JSON.parse(preparation.content.find(block => block.type === 'text').text)
  const { authoring } = toolResult.result
  assert.equal(toolResult.studioUrl, new URL(authoring.url, studioUrl.origin).href)
  assert.equal(new URL(toolResult.studioUrl).search, new URL(authoring.url, studioUrl.origin).search,
    'the clickable conversation link retains the exact candidate and native parent')
  assert.deepEqual(authoring.studio, { id: record.id, expectedRevision: 0, bundle: record.bundle })
  assert.equal(prepared.authoring.requestId, authoring.requestId, 'the same exact parent/request/digest reuses its bounded receipt')
  const locator = { ...authoring.studio, requestId: authoring.requestId, digest: prepared.digest }
  assert.deepEqual(await f.client.readPrepared(locator), { request, candidate: Object.fromEntries(Object.entries(prepared).filter(([key]) => key !== 'authoring')) })
  await assert.rejects(f.client.readPrepared({ ...locator, digest: 'f'.repeat(64) }), /locator|pin/)
  await assert.rejects(f.client.readPrepared({ ...locator, bundle: { ...pin, version: 'other' } }), /locator|pin/)
  const other = await f.ctx.agents.create({ sessionId: sessions.SessionId(randomUUID()), meta: { cwd: f.root }, agentOptions: { provider: 'studio-sdk-fixture', model: 'inherited-parent-route' } })
  t.after(() => other.dispose())
  await assert.rejects(f.clientFor(String(other.agent.id)).readPrepared(locator), /exact live parent/)
  assert.equal((await f.client.instances.read({ id: record.id })).revision, 0, 'locator reads and rejected foreign requests never save')
  const saved = await f.client.instances.saveChanges({ ...request, mode: 'validated', digest: prepared.digest })
  assert.equal(saved.revision, 1)
  await assert.rejects(f.client.readPrepared(locator), /changed|revision/i, 'a stale receipt cannot follow the newest source')
  const fromConversation = await execute('readFile', { id: record.id, path: 'schema.yaml' })
  assert.equal(fromConversation.isError, false)
  assert.match(JSON.stringify(fromConversation), /review/)

  // Next revision is saved from the Host conversation and immediately read in Studio.
  const second = { id: record.id, expectedRevision: 1,
    changes: [{ path: 'SKILL.md', content: '---\nname: observations\ndescription: Preserve supplied evidence.\n---\nKeep the user-selected review status and explain the evidence.\n' }] }
  const candidate = await f.client.instances.prepareChanges(second)
  const secondLocator = { ...candidate.authoring.studio, requestId: candidate.authoring.requestId, digest: candidate.digest }
  assert.deepEqual((await f.client.readPrepared(secondLocator)).request, second)
  assert.equal((await execute('saveChanges', { ...second, mode: 'validated', digest: candidate.digest })).isError, false)
  assert.equal((await f.client.instances.read({ id: record.id })).revision, 2)
  assert.equal((await f.client.instances.readFile({ id: record.id, path: 'SKILL.md' })).content, second.changes[0].content)
  assert.equal((await execute('saveChanges', { ...request, mode: 'validated', digest: prepared.digest })).isError, true, 'stale Host saves cannot overwrite newer Studio revisions')
  assert.equal((await execute('read', { id: record.id, agentId: randomUUID() })).isError, true, 'model arguments cannot replace Host identity')
  assert.equal(f.calls(), 0, 'direct Host customization does not launch a second model or child')

  await f.owner.dispose()
  assert.equal(f.ctx.tools.get('studio_customize', f.parent.agent), undefined, 'the owning Service unload removes its tool')
  await f.activate()
  await assert.rejects(f.client.readPrepared(secondLocator), /exact live parent/, 'ephemeral receipts do not survive service replacement')
  assert.equal((await f.client.instances.read({ id: record.id })).revision, 2)
  assert.equal((await f.client.instances.readFile({ id: record.id, path: 'SKILL.md' })).content, second.changes[0].content)
  assert.equal((await execute('read', { id: record.id })).isError, false)
})

test('the existing Host Agent discovers and consumes customization through its normal native loop', { timeout: 20000 }, async t => {
  const f = await fixture(t, { withManagement: true,
    step: n => n === 0 ? call('studio_customize', { action: 'catalog', request: {} }) : stop() })
  f.parent.agent.followup(llm.createUserMessage({ source: { kind: 'yugoo-design' },
    content: [{ type: 'text', text: 'Show the reusable Kits and Bundles I can customize in Studio.' }] }))
  await f.parent.agent.whenIdle()
  assert.ok(f.seen.some(names => names.includes('studio_customize')))
  assert.ok(f.toolResults.some(result => result.name === 'studio_customize' && !result.isError))
  assert.equal(f.calls(), 2)
  assert.equal(f.childIds.length, 0, 'the conversation uses its existing model route without spawning another Agent')
  // This case runs the parent loop itself. Close it while its projections are
  // still registered, before the fixture tears down the enclosing SDK scope.
  await f.parent.dispose()
})

test('actual Gateway resolves the original Agent and connects native prepare to explicit shared save/reopen', { timeout: 20000 }, async t => {
  const release = deferred(); t.after(() => release.resolve())
  const f = await fixture(t, { async step(n) { if (n === 2) await release.promise; return sequence(n) } })
  assert.equal(TYPERT.invocations.filter(d => d.namespace === 'studioManagement').length, 6)
  const authoringMethods = ['list', 'read', 'create', 'importSources', 'copy', 'editCurrent', 'rename', 'remove',
    'readFile', 'saveFile', 'prepareChanges', 'saveChanges', 'updateMounts', 'preview', 'start', 'resume', 'observe',
    'cancel', 'readPrepared', 'listReferences', 'exportContentArchive', 'readArchive'].sort()
  assert.deepEqual(TYPERT.invocations.filter(d => d.namespace === 'studioAuthoring').map(d => d.method).sort(), authoringMethods)
  assert.deepEqual(remoteMethods(f.ctx.get('studioAuthoring')).map(d => d.method).sort(), authoringMethods)
  const record = await f.client.instances.copy({ kind: 'bundle', bundle: pin })
  const reference = await f.client.start({ invocationId: randomUUID(), id: record.id, expectedRevision: 0,
    paths: additions().map(c => c.path), prompt: 'Refine this exact retained source.' })
  assert.equal(reference.parentSessionId, String(f.parent.agent.id))
  const prepared = await until(() => f.client.readPrepared(addressOf(reference)), value => value !== undefined)
  assert.ok(f.seen.every(names => !names.includes('studio_customize')), 'the authoring child never inherits the main conversation save tool')
  assert.equal(prepared.candidate.valid, true)
  assert.equal((await f.client.instances.read({ id: record.id })).revision, 0)
  assert.equal((await f.client.observe(addressOf(reference))).terminal, false, 'start/prepare did not wait for native completion')
  const saved = await f.client.instances.saveChanges({ ...prepared.request, mode: 'validated', digest: prepared.candidate.digest })
  assert.equal(saved.revision, 1)
  release.resolve()
  await until(() => f.client.observe(addressOf(reference)), value => value.terminal)
  await f.owner.dispose(); await f.activate()
  for (const change of additions()) assert.equal((await f.client.instances.readFile({ id: saved.id, path: change.path })).content, change.content)
  assert.equal((await f.client.observe(addressOf(reference))).status, 'completed')
  await assert.rejects(f.client.readPrepared(addressOf(reference)), /exact owned/)
  assert.equal((await f.client.listReferences()).length, 1)
})

test('actual lookup rejects missing parent/foreign references and native cancellation keeps the parent alive', { timeout: 20000 }, async t => {
  const entered = deferred()
  const f = await fixture(t, { async step(_n, request) { entered.resolve(); await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true })); return stop() } })
  const record = await f.client.instances.copy({ kind: 'bundle', bundle: pin })
  const reference = await f.client.start({ invocationId: randomUUID(), id: record.id, expectedRevision: 0,
    paths: ['panel.yaml'], prompt: 'Observe cancellation.' }); await entered.promise
  const missing = await f.wire('studioAuthoring/list', { agentId: randomUUID() })
  assert.equal(missing.ok, false); assert.equal(missing.error.code, 'gateway/lookup-not-found')
  const forged = await f.wire('studioAuthoring/observe', { agentId: String(f.parent.agent.id), request: reference })
  assert.equal(forged.ok, false)
  const other = await f.ctx.agents.create({ sessionId: sessions.SessionId(randomUUID()), meta: { cwd: f.root }, agentOptions: { provider: 'studio-sdk-fixture', model: 'inherited-parent-route' } }); t.after(() => other.dispose())
  await assert.rejects(f.clientFor(String(other.agent.id)).observe(addressOf(reference)), /another exact parent/)
  const observation = await f.client.observe(addressOf(reference))
  await f.client.cancel(addressOf(reference), { expectedTurn: observation.turn })
  assert.equal((await f.client.observe(addressOf(reference))).status, 'cancelled')
  assert.equal(f.ctx.agents.get(f.parent.agent.id), f.parent.agent)
  assert.equal((await f.client.instances.read({ id: record.id })).revision, 0)
})

test('actual owner unload joins raw initialization before completing and never opens native admission', { timeout: 20000 }, async t => {
  const f = await fixture(t, { deferService: true }), entered = deferred(), release = deferred()
  const mkdir = fs.mkdir; t.after(() => release.resolve())
  t.mock.method(fs, 'mkdir', async (path, ...args) => { if (path === f.stateRoot) { entered.resolve(); await release.promise } return mkdir(path, ...args) })
  const loading = f.ctx.plugin(NativeService, f.config)
  const initialized = Promise.resolve(loading).then(() => ({ ok: true }), error => ({ ok: false, error }))
  await entered.promise
  let disposed = false
  const unloading = loading.dispose().then(() => { disposed = true })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(disposed, false, 'unload must join in-flight storage initialization')
  release.resolve()
  const outcome = await initialized; await unloading
  assert.equal(outcome.ok, false)
  assert.equal(f.calls(), 0); assert.equal(f.childIds.length, 0)
  assert.equal(f.ctx.agents.get(f.parent.agent.id), f.parent.agent)
})


test('public Service snapshots direct caller intent before queued admission, keeping invalid input asynchronous', { timeout: 20000 }, async t => {
  const f = await fixture(t), service = f.ctx.get('studioAuthoring')
  const record = await f.client.instances.copy({ kind: 'bundle', bundle: pin })
  const save = { id: record.id, expectedRevision: 0, path: 'SKILL.md', content: 'call-time intent' }
  const saving = service.saveFile(f.parent.agent, save)
  save.content = 'after-call mutation'; save.path = 'unintended-file.md'
  const saved = await saving
  assert.equal((await f.client.instances.readFile({ id: saved.id, path: 'SKILL.md' })).content, 'call-time intent')
  const changes = { id: saved.id, expectedRevision: saved.revision, changes: additions() }
  const originalPaths = changes.changes.map(change => change.path).sort()
  const preparing = service.prepareChanges(f.parent.agent, changes)
  changes.changes[0].path = '../not-the-submitted-path'
  const candidate = await preparing
  assert.deepEqual(candidate.diff.map(change => change.path).sort(), originalPaths)
  assert.equal(candidate.valid, true)
  assert.equal((await f.client.instances.read({ id: saved.id })).revision, saved.revision, 'preparation still does not save')
  const request = { invocationId: randomUUID(), id: saved.id, expectedRevision: saved.revision,
    paths: additions().map(c => c.path), prompt: 'Refine this exact retained source.' }
  const expected = structuredClone(request)
  const starting = service.start(f.parent.agent, request)
  request.paths[0] = '../later-mutation'; request.expectedRevision = 0; request.invocationId = randomUUID()
  const reference = await starting
  assert.equal(reference.invocationId, expected.invocationId)
  assert.equal(reference.scope.expectedRevision, expected.expectedRevision)
  assert.deepEqual([...reference.scope.allowedPaths].sort(), [...expected.paths].sort())
  let invalid
  assert.doesNotThrow(() => { invalid = service.saveFile(f.parent.agent, { ...save, expectedRevision: -1 }) })
  await assert.rejects(invalid, /Too small|>=0|nonnegative/i)
})
