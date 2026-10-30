/** JSON/wire boundary with actual S2 storage; native references/HTTP replies are explicit fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStudioInstances } from 'dsh-design-studio/node'
import { adapters, additions, pin, originalFiles } from '../../companion/test/fixtures/studio-changes-fixture.mjs'
import { createDshStudioContent } from '../src/authoring-content.ts'
import { createSameOriginStudioAuthoringClient } from '../src/authoring.page-rpc.ts'
import { STUDIO_AUTHORING_REMOTE, STUDIO_AUTHORING_RPC_SCHEMAS } from '../src/authoring.remote-client.ts'
import { createSameOriginStudioRemote } from '../src/page-rpc.ts'

const parent = 'native-parent-one'
const reference = { sessionId: 'child-one', parentSessionId: parent, invocationId: 'invocation-one', epoch: 'epoch-one',
  messageId: 'message-one', afterSeq: -1, scope: { id: 'working-copy-one', expectedRevision: 0, allowedPaths: ['panel.yaml'], bundle: pin } }
const address = { sessionId: reference.sessionId, epoch: reference.epoch }
const observation = { reference, status: 'completed', consumed: true, turn: 1, terminal: true, throughSeq: 5,
  source: 'live', durable: true, pendingInput: false }
function reply(request, value) {
  return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value } }), { status: 200 })
}
function clientFor(handler) {
  const calls = [], options = { agentId: parent,
    fetch: async (url, init) => { const request = JSON.parse(init.body); calls.push({ url, init, request }); return handler(request) } }
  return { client: createSameOriginStudioAuthoringClient(options), calls, options }
}
const start = { invocationId: reference.invocationId, id: reference.scope.id, expectedRevision: 0,
  paths: ['panel.yaml'], bundle: pin, prompt: 'Review this exact source.' }

test('remove reports system Trash success and rejects obsolete soft-delete receipts', async () => {
  const input = { id: 'working-copy-one', expectedRevision: 3 }
  const success = clientFor(request => reply(request, { id: input.id, revision: 3, trashed: true }))
  assert.deepEqual(await success.client.instances.remove(input), { id: input.id, revision: 3, trashed: true })
  const obsolete = clientFor(request => reply(request, { id: input.id, revision: 4, deletedAt: '2026-10-30', recoverable: true }))
  await assert.rejects(obsolete.client.instances.remove(input))
})

test('archive export wire accepts an exact installed Bundle and rejects mixed copy/path authority', async () => {
  const input = { kind: 'bundle', pin, provenance: { source: 'fixture:installed', license: 'Apache-2.0' } }
  const f = clientFor(async request => {
    assert.equal(request.payload.args.agentId, parent)
    assert.deepEqual(STUDIO_AUTHORING_RPC_SCHEMAS.exportContentArchive.request.parse(request.payload.args.request), input)
    return reply(request, 'archive bytes')
  })
  assert.equal(await f.client.content.export(input), 'archive bytes')
  for (const extra of [{ id: 'copy', expectedRevision: 0 }, { resourceRoot: '/untrusted' }, { agentId: 'other' }]) {
    await assert.rejects(f.client.content.export({ ...input, ...extra }))
  }
  assert.equal(f.calls.length, 1)
})

test('DSH current Bundle export preserves exact bytes through S2 and stateless decoding', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-current-export-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const instances = await createStudioInstances({ stateRoot, ...adapters() })
  const service = await createDshStudioContent({ instances })
  const input = { kind: 'bundle', pin, provenance: { source: 'fixture:installed', license: 'Apache-2.0' } }
  const archive = JSON.parse(await service.exportContentArchive(input))
  assert.deepEqual(archive.pin, pin)
  assert.deepEqual(archive.files.map(f => ({ path: f.path, base64: f.base64 })), [...originalFiles].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  assert.equal((await service.readArchive({ source: JSON.stringify(archive) })).sha256, archive.sha256)
  const current = await instances.editCurrent({ kind: 'bundle', bundle: pin })
  assert.equal((await instances.list()).length, 1)
  assert.equal(current.current, true)
  await assert.rejects(service.exportContentArchive({ ...input, pin: { ...pin, version: '1.0', name: 'missing' } }), /Missing fixture pin/)
})

test('saved Kit and Bundle titles cross stateless archive and source-import wire codecs', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-title-wire-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const instances = await createStudioInstances({ stateRoot, ...adapters() })
  const content = await createDshStudioContent({ stateRoot, instances, design: {
    resolveBundle: () => undefined, resolveKit: () => undefined,
    registerBundleContent() {}, registerRetainedKit() {},
  } })
  const f = clientFor(async request => {
    const method = request.method.split('/')[1], spec = STUDIO_AUTHORING_RPC_SCHEMAS[method]
    const service = method in content ? content : instances
    return reply(request, await service[method](spec.request.parse(request.payload.args.request)))
  })
  for (const kind of ['kit', 'bundle']) {
    const title = { zh: kind === 'kit' ? '阅读套件' : '阅读笔记', en: kind === 'kit' ? 'Reading kit' : 'Reading notes' }
    const record = await instances.create({ kind, title })
    const source = await f.client.content.export({ id: record.id, expectedRevision: record.revision })
    const archive = await f.client.content.readArchive({ source })
    assert.deepEqual(archive.title, title)
    const copy = await f.client.instances.importSources({ kind, title: archive.title,
      files: archive.files.map(({ path, base64 }) => ({ path, base64 })) })
    assert.deepEqual(copy.title, { zh: title.zh + ' (2)', en: title.en + ' (2)' })
    assert.notEqual(copy.id, record.id)
  }
})

test('all optional endpoints declare the real native lookup and leave the original six-method client intact', () => {
  assert.equal(STUDIO_AUTHORING_REMOTE.descriptors.length, 22)
  assert.equal(new Set(STUDIO_AUTHORING_REMOTE.descriptors.map(item => item.id)).size, 22)
  for (const descriptor of STUDIO_AUTHORING_REMOTE.descriptors) {
    assert.equal(descriptor.namespace, 'studioAuthoring')
    assert.deepEqual(descriptor.scope, { context: 'agent', wire: 'agentId' })
    assert.deepEqual({ ...descriptor.parameters[0], codec: undefined }, {
      name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: undefined,
    })
    assert.equal(descriptor.parameters[0].codec.typeSymbol, '@deepseek-ai/dsh-session/types#SessionId')
    assert.equal(descriptor.parameters[0].codec.mode, 'strict')
    assert.equal(descriptor.result.mode, 'strict')
  }
  assert.deepEqual(Object.keys(createSameOriginStudioRemote()).sort(), [
    'readBundleFile', 'readBundleWorkspace', 'readKitFile', 'readKitFiles', 'readKitWorkspace', 'workspace',
  ])
})

test('blank Kit and Bundle creation use exact-parent codecs and reopen without copying installed source', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-create-wire-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, ...adapters() }, service = await createStudioInstances(options)
  const f = clientFor(async request => {
    assert.equal(request.payload.args.agentId, parent)
    const method = request.method.split('/')[1], spec = STUDIO_AUTHORING_RPC_SCHEMAS[method]
    return reply(request, await service[method](spec.request.parse(request.payload.args.request)))
  })
  for (const kind of ['kit', 'bundle']) {
    const created = await f.client.instances.create({ kind, title: { zh: '新方法', en: 'New method' } })
    assert.equal(created.kind, kind); assert.equal(created.createdBlank, true); assert.equal(created.revision, 0)
    assert.deepEqual(created.source, {}); assert.deepEqual(created.mounts, [])
    assert.deepEqual(await (await createStudioInstances(options)).read(created.id), await service.read(created.id))
  }
  assert.deepEqual(f.calls.map(c => c.request.method), ['studioAuthoring/create', 'studioAuthoring/create'])
  for (const input of [{ kind: 'mindset', title: { zh: '', en: '' } }, { kind: 'kit' },
    { kind: 'bundle', title: { zh: '', en: '' }, agentId: 'forged-parent' },
    { kind: 'kit', title: { zh: '', en: '' }, stateRoot: '/untrusted' }]) {
    await assert.rejects(f.client.instances.create(input))
  }
  assert.equal(f.calls.length, 2, 'invalid fields fail before the transport')
})

test('actual copy, full candidate/preview, explicit save and fresh reopen survive strict request/result codecs', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-authoring-wire-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, ...adapters() }, service = await createStudioInstances(options)
  const f = clientFor(async request => {
    assert.equal(request.payload.args.agentId, parent)
    const method = request.method.split('/')[1], spec = STUDIO_AUTHORING_RPC_SCHEMAS[method]
    const input = spec.request.parse(request.payload.args.request)
    return reply(request, await service[method](input))
  })
  const copied = await f.client.instances.copy({ kind: 'bundle', bundle: pin })
  assert.equal(copied.recordVersion, 2); assert.ok(copied.baseSnapshot)
  assert.deepEqual(await f.client.instances.read({ id: copied.id }), await service.read({ id: copied.id }))
  const request = { id: copied.id, expectedRevision: 0, changes: additions() }
  const prepared = await f.client.instances.prepareChanges(request)
  assert.equal(prepared.valid, true); assert.equal(prepared.preview.revision, 1)
  assert.equal((await service.read(copied.id)).revision, 0, 'transporting the candidate does not save')
  const saved = await f.client.instances.saveChanges({ ...request, mode: 'validated', digest: prepared.digest })
  assert.equal(saved.changeReceipt.digest, prepared.digest); assert.equal(saved.revision, 1)
  const reopened = await createStudioInstances(options)
  assert.deepEqual(await reopened.read(copied.id), savedWithoutReceipt(saved))
  const preview = await f.client.instances.preview({ id: saved.id, expectedRevision: 1, bundle: saved.bundle, locale: 'en-US' })
  assert.equal(preview.preview.revision, 1)
  assert.equal(Object.hasOwn(f.calls.at(-1).request.payload.args.request, 'locale'), false, 'renderer locale is not a new S2 source parameter')
  for (const change of additions()) assert.equal((await reopened.readFile({ id: saved.id, path: change.path })).content, change.content)
})
function savedWithoutReceipt(saved) { const { changeReceipt, ...record } = saved; return record }

test('retained synthetic preview files cross strict source-candidate codecs without admitting an arbitrary reader', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-sample-artifact-wire-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, ...adapters() }, service = await createStudioInstances(options)
  const record = await service.copy({ kind: 'bundle', bundle: pin })
  const path = 'observations/artifacts/teaching.html', resource = 'reference/preview-artifacts/teaching.html'
  const request = { id: record.id, expectedRevision: record.revision, changes: [
    { path: 'reference/preview-artifacts.json', content: JSON.stringify({ version: 1, files: { [path]: resource } }) },
    { path: resource, content: '<h1>Retained synthetic teaching chart</h1>' },
  ] }
  const f = clientFor(async input => {
    const method = input.method.split('/')[1]
    return reply(input, await service[method](STUDIO_AUTHORING_RPC_SCHEMAS[method].request.parse(input.payload.args.request)))
  })
  const candidate = await f.client.instances.prepareChanges(request)
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
  assert.deepEqual(candidate.preview.artifacts, { [path]: request.changes[1].content })
  const saved = await f.client.instances.saveChanges({ ...request, mode: 'validated', digest: candidate.digest })
  assert.equal(saved.changeReceipt.validation, 'preview_passed')
  const reopened = await createStudioInstances(options)
  assert.deepEqual({ ...(await reopened.preview({ id: saved.id, expectedRevision: saved.revision })).preview.artifacts }, candidate.preview.artifacts)
  for (const artifacts of [{ [path]: 42 }, [], null]) {
    await assert.rejects(clientFor(input => reply(input, { ...candidate,
      preview: { ...candidate.preview, artifacts } })).client.instances.prepareChanges(request), /invalid/iu)
  }
  await assert.rejects(clientFor(input => reply(input, { ...candidate,
    preview: { ...candidate.preview, readArtifact: 'arbitrary-reader' } })).client.instances.prepareChanges(request), /unrecognized/iu)
})

test('real Kit definition-only prepare/save/reopen preserves the exact new receipt through strict codecs', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-kit-definition-wire-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, ...adapters() }, service = await createStudioInstances(options)
  const blank = await service.create({ kind: 'kit', title: { zh: '测试方法', en: 'Test method' } })
  const f = clientFor(async request => {
    const method = request.method.split('/')[1], spec = STUDIO_AUTHORING_RPC_SCHEMAS[method]
    return reply(request, await service[method](spec.request.parse(request.payload.args.request)))
  })
  const record = await f.client.instances.updateMounts({ id: blank.id, expectedRevision: 0, bundles: [pin] })
  const file = await f.client.instances.readFile({ id: record.id, path: 'mindset.md' })
  const request = { id: record.id, expectedRevision: record.revision,
    changes: [{ path: file.path, content: file.content + '\nPreserve user-confirmed facts.\n' }] }
  const candidate = await f.client.instances.prepareChanges(request)
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
  assert.equal(Object.hasOwn(candidate, 'preview'), false)
  const save = { ...request, mode: 'validated', digest: candidate.digest }
  const saved = await f.client.instances.saveChanges(save)
  assert.equal(saved.changeReceipt.validation, 'definition_passed')
  const reopened = await createStudioInstances(options)
  assert.equal((await reopened.readFile({ id: record.id, path: file.path })).content, request.changes[0].content)
  assert.deepEqual(await reopened.read(record.id), savedWithoutReceipt(saved))
  for (const validation of ['definition_ignored', 'passed', true, null, {}]) {
    await assert.rejects(clientFor(input => reply(input, { ...saved,
      changeReceipt: { ...saved.changeReceipt, validation } })).client.instances.saveChanges(save), /invalid/iu)
  }
  await assert.rejects(clientFor(input => reply(input, { ...saved,
    changeReceipt: { ...saved.changeReceipt, unexpected: true } })).client.instances.saveChanges(save), /unrecognized/iu)
})

test('blank provenance survives real S2 read/save/reopen codecs without weakening strict optional boolean validation', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-blank-wire-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, ...adapters() }, service = await createStudioInstances(options)
  const blank = await service.create({ kind: 'kit', title: { zh: '空白方法', en: 'Blank method' } })
  const f = clientFor(async request => {
    const method = request.method.split('/')[1], input = STUDIO_AUTHORING_RPC_SCHEMAS[method].request.parse(request.payload.args.request)
    return reply(request, await service[method](input))
  })
  const read = await f.client.instances.read({ id: blank.id })
  assert.equal(read.createdBlank, true)
  assert.equal((await f.client.instances.list()).find(item => item.id === blank.id).createdBlank, true)
  const file = await service.readFile({ id: blank.id, path: 'mindset.md' })
  const request = { id: blank.id, expectedRevision: blank.revision,
    changes: [{ path: file.path, content: file.content + '\nExplain the Kit purpose.\n' }] }
  const prepared = await f.client.instances.prepareChanges(request)
  const saved = await f.client.instances.saveChanges({ ...request, mode: 'draft', digest: prepared.digest })
  assert.equal(saved.createdBlank, true)
  assert.equal((await (await createStudioInstances(options)).read({ id: blank.id })).createdBlank, true)
  const { createdBlank, ...older } = read
  assert.deepEqual(STUDIO_AUTHORING_RPC_SCHEMAS.read.result.parse(older), older, 'older records may omit provenance')
  assert.equal(STUDIO_AUTHORING_RPC_SCHEMAS.read.result.parse({ ...older, createdBlank: false }).createdBlank, false)
  for (const value of ['true', 1, null, {}]) {
    await assert.rejects(clientFor(request => reply(request, { ...read, createdBlank: value })).client.instances.read({ id: blank.id }), /invalid|boolean/iu)
  }
  await assert.rejects(clientFor(request => reply(request, { ...read, unexpected: true })).client.instances.read({ id: blank.id }), /unrecognized/iu)
})

test('native wire returns references/observations without interpreting native completion as save', async () => {
  const f = clientFor(request => reply(request, request.method.endsWith('/observe') || request.method.endsWith('/cancel')
    ? observation : request.method.endsWith('/listReferences') ? [reference] : request.method.endsWith('/readPrepared') ? {} : reference))
  f.options.agentId = 'another-parent'
  assert.deepEqual(await f.client.start(start), reference)
  assert.deepEqual(await f.client.resume({ ...start, previous: address, explicit: true }), reference)
  assert.deepEqual(await f.client.observe(address), observation)
  assert.deepEqual(await f.client.cancel(address, { expectedTurn: 1 }), observation)
  assert.equal(await f.client.readPrepared(address), undefined)
  assert.deepEqual(await f.client.listReferences(), [reference])
  for (const { url, init, request } of f.calls) {
    assert.equal(url.pathname, `/api/${request.method}`); assert.equal(init.method, 'POST')
    assert.equal(request.type, 'client-request'); assert.match(request.rpcId, /^[a-f0-9-]{36}$/u)
    assert.equal(request.payload.args.agentId, parent, 'parent locator is captured at client construction')
    assert.deepEqual(Object.keys(request.payload), ['args'])
    assert.ok(!request.method.includes('save'))
  }
  assert.deepEqual(f.calls[2].request.payload, { args: { agentId: parent, request: address } })
  assert.deepEqual(f.calls.at(-1).request.payload, { args: { agentId: parent } })
})

test('full references, foreign scope fields, implicit resume and cancellation-address overrides reject before sending', async () => {
  const f = clientFor(request => reply(request, reference))
  await assert.rejects(f.client.observe(reference))
  await assert.rejects(f.client.observe({ ...address, parentSessionId: 'other' }))
  await assert.rejects(f.client.start({ ...start, scope: reference.scope }))
  await assert.rejects(f.client.resume({ ...start, previous: address, explicit: false }))
  await assert.rejects(f.client.cancel(address, { expectedTurn: 1, sessionId: 'other' }))
  await assert.rejects(f.client.instances.saveChanges({ id: start.id, expectedRevision: 0, changes: additions(), mode: 'validated' }))
  assert.equal(f.calls.length, 0)
})

test('shared carrier preserves Web/Desktop origin, correlation and strict native-result failures', async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'location')
  try {
    for (const [location, expected] of [
      [{ href: 'dsh-app://app/design-studio/', origin: 'null' }, 'dsh-app://app/api/studioAuthoring/observe'],
      [{ href: 'https://host.example:8443/design-studio/', origin: 'https://host.example:8443' }, 'https://host.example:8443/api/studioAuthoring/observe'],
    ]) {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: location })
      const f = clientFor(request => reply(request, observation)); await f.client.observe(address)
      assert.equal(f.calls[0].url.href, expected)
    }
  } finally { if (old) Object.defineProperty(globalThis, 'location', old); else delete globalThis.location }
  await assert.rejects(clientFor(request => reply({ ...request, rpcId: 'different' }, observation)).client.observe(address), /rpcId mismatch/u)
  await assert.rejects(clientFor(request => reply(request, { ...observation, unexpected: 'hidden' })).client.observe(address), /unrecognized/iu)
  await assert.rejects(clientFor(request => reply(request, { ...observation, durable: 'yes' })).client.observe(address), /invalid/iu)
})

test('transport or gateway uncertainty never resends a native start or an already committed save', async t => {
  const native = clientFor(() => new Response('', { status: 503 }))
  await assert.rejects(native.client.start(start), /HTTP 503/u); assert.equal(native.calls.length, 1)
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-authoring-wire-unknown-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, ...adapters() }, service = await createStudioInstances(options)
  const record = await service.copy({ kind: 'bundle', bundle: pin })
  const request = { id: record.id, expectedRevision: 0, changes: additions() }, candidate = await service.prepareChanges(request)
  const save = clientFor(async input => {
    await service.saveChanges(input.payload.args.request)
    return new Response('', { status: 502 })
  })
  await assert.rejects(save.client.instances.saveChanges({ ...request, mode: 'validated', digest: candidate.digest }), /HTTP 502/u)
  assert.equal(save.calls.length, 1)
  assert.equal((await (await createStudioInstances(options)).read(record.id)).revision, 1, 'reopen reveals the committed save despite a lost response')
  const failure = clientFor(input => new Response(JSON.stringify({ type: 'server-response', rpcId: input.rpcId,
    result: { ok: false, error: { code: 'gateway/lookup-not-found', message: 'Native parent unavailable', details: { privateTrace: 'not shown' } } } })))
  await assert.rejects(failure.client.start(start), error => error.message.includes('Native parent unavailable') && !error.message.includes('privateTrace'))
  assert.equal(failure.calls.length, 1)
})

test('strict mount-choice codecs preserve optional descriptions without accepting them as mount pins', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-choice-copy-wire-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const service = await createStudioInstances({ stateRoot, ...adapters() })
  const kit = await service.create({ kind: 'kit', title: { zh: '挂载测试', en: 'Mount choices' } })
  const current = await service.read({ id: kit.id }), base = current.availableBundles[0]
  assert.equal(typeof base.description, 'string', 'real installed projection survives the normal result codec')
  const choice = { ...base, description: 'Exact source wording.\nSecond line.', displayDescription: { zh: '技能简介', en: 'Bundle introduction' } }
  const legacy = { name: 'legacy_method', version: '1.0', runtimeName: 'legacy_method', title: { zh: '旧方法', en: 'Legacy method' } }
  const value = { ...current, availableBundles: [choice, legacy] }
  const read = async record => clientFor(request => reply(request, record)).client.instances.read({ id: kit.id })
  assert.deepEqual((await read(value)).availableBundles, [choice, legacy])
  for (const fields of [
    { description: null }, { description: 123 }, { description: {} },
    { displayDescription: null }, { displayDescription: 'text' }, { displayDescription: { zh: '不完整' } },
    { displayDescription: { zh: 1, en: 'wrong' } }, { displayDescription: { zh: '中文', en: 'English', fr: 'unexpected' } },
    { authority: 'not display copy' },
  ]) {
    await assert.rejects(read({ ...value, availableBundles: [{ ...choice, ...fields }] }), /invalid|unrecognized/iu)
  }
  for (const fields of [{ description: 'not a pin' }, { displayDescription: choice.displayDescription }]) {
    assert.equal(STUDIO_AUTHORING_RPC_SCHEMAS.updateMounts.request.safeParse({ id: kit.id, expectedRevision: 0, bundles: [{ ...pin, ...fields }] }).success, false)
  }
})


test('source import wire returns the real editable copy and preserves readiness on read/list and metadata-free export', async t => {
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'studio-import-wire-')))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const instances = await createStudioInstances({ stateRoot, ...adapters() })
  const input = { kind: 'bundle', files: [{ path: 'SKILL.md', base64: Buffer.from('---\nname: source_method\ndescription: Imported method\n---\n# Method\nPreserve this source.\n').toString('base64') }] }
  const f = clientFor(async request => {
    const method = request.method.split('/').at(-1), args = request.payload.args.request
    if (method === 'importSources') return reply(request, await instances.importSources(args))
    if (method === 'read') return reply(request, await instances.read(args))
    if (method === 'list') return reply(request, await instances.list(args))
    if (method === 'exportContentArchive') return reply(request, await instances.exportArchive(args))
    throw Error('Unexpected method ' + method)
  })
  const record = await f.client.instances.importSources(input)
  assert.equal(record.revision, 0)
  assert.equal(record.readiness.ready, false)
  assert.ok(record.files.some(file => file.path === 'SKILL.md'))
  assert.deepEqual(f.calls[0].request.payload.args.request, input)
  assert.deepEqual((await f.client.instances.read({ id: record.id })).readiness, record.readiness)
  assert.deepEqual((await f.client.instances.list()).find(row => row.id === record.id).readiness, record.readiness)
  const exported = JSON.parse(await f.client.content.export({ id: record.id, expectedRevision: 0 }))
  assert.equal(exported.provenance, undefined)
  assert.equal(Buffer.from(exported.files.find(file => file.path === 'SKILL.md').base64, 'base64').toString(), Buffer.from(input.files[0].base64, 'base64').toString())
})
