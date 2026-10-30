/** Full shared page and temporary S2; catalog JSON and native responses are explicit fixtures. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { studioAuthoringLocation, studioPreparedUrl, studioAuthoringSessionLocator } from '../src/page-path.ts'
import { createSameOriginStudioAuthoringClient } from '../src/authoring.page-rpc.ts'
import { createDshStudioContent } from '../src/authoring-content.ts'
import { createStudioInstances } from 'dsh-design-studio/node'
import { encodeStudioContentZip, decodeStudioContentZip } from '../../studio-ui/src/content-zip.ts'
import { adapters, additions, pin } from '../../companion/test/fixtures/studio-changes-fixture.mjs'

const hooks = registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css?inline')) return { format: 'module', shortCircuit: true,
      source: `export default ${JSON.stringify(readFileSync(new URL(url.slice(0, -7)), 'utf8'))}` }
    return next(url, context)
  },
})
const requirePanel = createRequire(new URL('../../panel/package.json', import.meta.url))
const { JSDOM, VirtualConsole } = requirePanel('jsdom')
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', error => { if (error.type !== 'css parsing') throw error })
const dom = new JSDOM('<!doctype html><html lang="en"><body><div id="root"></div></body></html>', { url: 'https://studio.test/design-studio/', virtualConsole })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'location']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
// JSDOM has no native modal lifecycle. Keep the same focus/open contract as the shared UI tests.
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; this.querySelector('button')?.focus() }
window.HTMLDialogElement.prototype.close = function () { this.open = false }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.confirm = () => true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { DshStudioPageWorkspace } = await import('../src/page-workspace.tsx')
after(() => { dom.window.close(); hooks.deregister() })
const button = (text, scope = document) => [...scope.querySelectorAll('button')].find(node => node.textContent.trim() === text)
async function until(check) {
  for (let i = 0; i < 150; i++) {
    if (check()) return
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
  assert.fail('Shared page condition did not settle')
}
async function click(text, scope) {
  const node = button(text, scope); assert.ok(node, text); assert.equal(node.disabled, false)
  await React.act(async () => node.click())
}
async function edit(node, value) {
  assert.ok(node)
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function selectImportFile(file) {
  const input = document.querySelector('input[type=file]'); assert.ok(input)
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await React.act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
function captureDownloads(t) {
  const previous = [URL.createObjectURL, URL.revokeObjectURL, window.HTMLAnchorElement.prototype.click]
  const downloads = [], blobs = new Map()
  URL.createObjectURL = blob => { const url = `blob:page-fixture-${blobs.size}`; blobs.set(url, blob); return url }
  URL.revokeObjectURL = url => { assert.ok(blobs.has(url)) }
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, blob: blobs.get(this.href) }) }
  t.after(() => { [URL.createObjectURL, URL.revokeObjectURL, window.HTMLAnchorElement.prototype.click] = previous })
  return downloads
}
const client = {
  workspace: async query => ({ query, kits: [], bundles: [{ ...pin, title: { zh: '观察记录', en: 'Observations' }, description: 'Record supplied observations.', usedBy: [] }] }),
  readKitWorkspace: async () => { throw new Error('No Kit in this page fixture') },
  readBundleWorkspace: async () => { throw new Error('Copy uses the exact catalog pin, not a fixture workspace') },
  readBundleFile: async () => { throw new Error('No installed file read in this page fixture') },
}

test('only one explicit page Session locator enables a scoped client; URL hints supply no other authority', () => {
  assert.equal(studioAuthoringSessionLocator('https://host/design-studio/?returnTo=https://elsewhere/#agentId=other'), undefined)
  assert.equal(studioAuthoringSessionLocator('https://host/design-studio/?agentId=parent%2Fexact&expectedRevision=900&parentSessionId=other'), 'parent/exact')
  assert.equal(studioAuthoringSessionLocator('dsh-app://app/design-studio/?agentId=desktop-parent'), 'desktop-parent')
  assert.throws(() => studioAuthoringSessionLocator('https://host/design-studio/?agentId=one&agentId=two'), /one explicit/)
  assert.throws(() => studioAuthoringSessionLocator('https://host/other/?agentId=one'), /owned page/)
  for (const locator of ['', '\nparent']) assert.throws(() => createSameOriginStudioAuthoringClient({ agentId: locator }))
})

test('host candidate links carry exact locators into the complete editor; malformed or ambiguous targets fail closed', () => {
  const locator = { requestId: 'prepared-1', id: 'copy-1', expectedRevision: 3, bundle: pin, digest: 'a'.repeat(64) }
  const url = 'dsh-app://app' + studioPreparedUrl('parent/exact', locator)
  assert.deepEqual(studioAuthoringLocation(url), { presentation: 'full', initialInstance: { id: locator.id, expectedRevision: 3, bundle: pin }, preparedLocator: locator })
  assert.deepEqual(studioAuthoringLocation('https://host/design-studio/?agentId=parent'), { presentation: 'full' })
  assert.deepEqual(studioAuthoringLocation('https://host/design-studio/?agentId=parent&presentation=full'), { presentation: 'full' })
  assert.deepEqual(studioAuthoringLocation('https://host/design-studio/?agentId=parent&presentation=content-only'), { presentation: 'content-only' }, 'explicit compatibility input remains accepted')
  const bad = edit => { const target = new URL(url); edit(target.searchParams); assert.throws(() => studioAuthoringLocation(target.href)) }
  bad(p => p.delete('agentId'))
  bad(p => p.append('studioRequest', 'other'))
  bad(p => p.set('studioDigest', 'wrong'))
  bad(p => p.set('studioTarget', JSON.stringify({ id: 'copy-1', expectedRevision: -1 })))
  bad(p => p.set('studioTarget', JSON.stringify({ id: 'copy-1', expectedRevision: 3, parentSessionId: 'forged' })))
  bad(p => p.set('presentation', 'unknown'))
  const kit = new URL(url); kit.searchParams.delete('studioRequest'); kit.searchParams.delete('studioDigest')
  kit.searchParams.set('studioTarget', JSON.stringify({ id: 'kit-1', expectedRevision: 0 }))
  assert.deepEqual(studioAuthoringLocation(kit.href).initialInstance, { id: 'kit-1', expectedRevision: 0 })
})

test('unscoped full page retains shared read-only browsing and no copy or AI controls', async () => {
  const root = createRoot(document.getElementById('root'))
  try {
    await React.act(async () => root.render(React.createElement(DshStudioPageWorkspace, { client, desktop: false })))
    await until(() => button('Bundles')); await click('Bundles')
    await until(() => document.querySelector('.ygd-studio-bundle-card'))
    assert.equal(button('Copy'), undefined)
    assert.equal(button('New Kit'), undefined)
    assert.equal(button('New Bundle'), undefined)
    assert.equal(document.querySelector('section[aria-label="AI changes"]') === null, true)
    assert.ok(document.querySelector('.ygd-studio-workspace .ygd-studio-body'), 'the shared workspace owns the shell')
  } finally { await React.act(async () => root.unmount()) }
})

test('scoped shared page creates both blank kinds through the actual same-origin client and reopens their sources', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-page-create-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const storage = { stateRoot, ...adapters() }, service = await createStudioInstances(storage), calls = []
  const authoring = createSameOriginStudioAuthoringClient({ agentId: 'create-page-parent', fetch: async (_url, init) => {
    const frame = JSON.parse(init.body), { agentId, request } = frame.payload.args
    assert.equal(agentId, 'create-page-parent')
    const method = frame.method.slice('studioAuthoring/'.length); calls.push(method)
    assert.ok(['create', 'list', 'read', 'readFile', 'preview'].includes(method), 'no model or publication port: ' + method)
    return new Response(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId,
      result: { ok: true, value: await service[method](request) } }))
  } })
  for (const [tab, label, kind, file] of [['Kits', 'New Kit', 'kit', 'mindset.md'], ['Bundles', 'New Bundle', 'bundle', 'SKILL.md']]) {
    const root = createRoot(document.getElementById('root'))
    try {
      await React.act(async () => root.render(React.createElement(DshStudioPageWorkspace, { client, authoring, desktop: false })))
      await until(() => button(tab)); await click(tab)
      await until(() => button(label)); await click(label)
      await until(() => document.querySelector('.ygd-studio-instance') && button('Source Files'))
      await click('Source Files'); await until(() => button(file)); await click(file)
      await until(() => document.querySelector(`textarea[aria-label="${file}"]`))
      const records = await service.list({ kind })
      assert.equal(records.length, 1); assert.equal(records[0].createdBlank, true)
      const reopened = await createStudioInstances(storage)
      assert.equal((await reopened.read(records[0].id)).createdBlank, true)
      assert.equal((await reopened.readFile({ id: records[0].id, path: file })).content,
        document.querySelector(`textarea[aria-label="${file}"]`).value)
    } finally { await React.act(async () => root.unmount()) }
  }
  assert.equal(calls.filter(method => method === 'create').length, 2)
})

test('a validated blank Bundle reopens from durable storage with its read-only sample Panel and no native authoring', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-blank-preview-reopen-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const storage = { stateRoot, ...adapters() }, service = await createStudioInstances(storage)
  const blank = await service.create({ kind: 'bundle', title: { zh: '已保存的空白技能包', en: 'Saved blank Bundle' } })
  const name = blank.bundle.name
  const sources = {
    'SKILL.md': `---\nname: ${name}\ndescription: Record only the supplied observations.\n---\n# Observations\nRead reference/output-contract.md and preserve supplied text.\n`,
    'skill.yaml': `name: ${name}\nversion: "1.0"\ntitle: {zh: 观察记录, en: Observations}\nlabel: {zh: 观察记录, en: Observations}\npresentation: {mode: declarative}\nexecution: {mode: main, handoff: must_edit}\n`,
    'schema.yaml': 'type: object\nrequired: [items]\nproperties:\n  items:\n    type: map\n    value:\n      type: object\n      required: [title]\n      properties:\n        title: {type: string}\n',
    'validation.yaml': `skill: ${name}\nrules:\n  - id: observations_present\n    scope: [state]\n    code: observations.present\n    message: Supply at least one observation.\n    check: {non_empty_map: items}\n`,
    'panel.yaml': 'version: 1\npanel_kind: evidence_workbook\nsections:\n  - {id: items, title: Observations, add_mode: none}\nfields:\n  - {key: title, label: Title, control: text, applies_to: [items]}\nui: {component: record_form, id: observations, title: Observations, source: items}\n',
    'reference/output-contract.md': '# Output contract\nPreserve each supplied observation title in the items map.\n',
    'reference/preview.json': JSON.stringify({ items: { saved: { title: 'Persisted sample observation' } } }),
  }
  const request = { id: blank.id, expectedRevision: 0, changes: Object.entries(sources).map(([path, content]) => ({ path, content })) }
  const candidate = await service.prepareChanges(request)
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
  assert.ok(candidate.preview)
  const saved = await service.saveChanges({ ...request, digest: candidate.digest, mode: 'validated' })
  assert.equal(saved.revision, 1); assert.equal(saved.changeReceipt.validation, 'preview_passed')
  const reopened = await createStudioInstances(storage), record = await reopened.read({ id: blank.id })
  assert.equal(record.revision, 1); assert.equal(record.files.length, 7)
  for (const [path, content] of Object.entries(sources)) assert.equal((await reopened.readFile({ id: blank.id, path })).content, content)

  const calls = [], previews = []
  const authoring = createSameOriginStudioAuthoringClient({ agentId: 'read-only-reopen-parent', fetch: async (_url, init) => {
    const frame = JSON.parse(init.body), { agentId, request } = frame.payload.args
    assert.equal(agentId, 'read-only-reopen-parent')
    const method = frame.method.slice('studioAuthoring/'.length); calls.push({ method, request })
    assert.ok(['list', 'read', 'readFile', 'preview'].includes(method), 'catalog Open must not invoke mutation or native authoring: ' + method)
    const value = await reopened[method](request)
    if (method === 'preview') previews.push(value)
    return new Response(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId, result: { ok: true, value } }))
  } })
  const root = createRoot(document.getElementById('root'))
  try {
    await React.act(async () => root.render(React.createElement(DshStudioPageWorkspace, { client, authoring, desktop: false })))
    await until(() => button('Bundles')); await click('Bundles')
    const card = () => [...document.querySelectorAll('.ygd-studio-kit-card')].find(node => node.querySelector('h3')?.textContent === 'Saved blank Bundle')
    await until(card)
    const open = [...card().querySelectorAll('button')].find(node => node.textContent === 'Open')
    assert.ok(open); await React.act(async () => open.click())
    await until(() => button('Panel Preview'))
    assert.equal(button('Save'), undefined, 'catalog Open stays in the ordinary read-only view')
    await click('Panel Preview'); await until(() => previews.length > 0)
    assert.ok(previews[0].preview, 'the unchanged S2/Core preview succeeds after fresh-service reopen')
    const panel = document.querySelector('.dsh-panel-sample-preview')
    assert.ok(panel, 'the ordinary read-only page must render the successful Core preview without an authoring wrapper')
    const renderedText = panel.textContent + ' ' + [...panel.querySelectorAll('input,textarea')].map(node => node.value).join(' ')
    assert.match(renderedText, /Persisted sample observation/)
    assert.equal(document.querySelector('textarea[aria-label="panel.yaml"]').readOnly, true)
    assert.equal(button('Send'), undefined)
    assert.deepEqual(calls.find(call => call.method === 'preview').request, { id: blank.id, expectedRevision: 1, bundle: blank.bundle })
    assert.equal((await reopened.read({ id: blank.id })).baseSnapshot, record.baseSnapshot)
    assert.equal((await reopened.read({ id: blank.id })).revision, 1)
  } finally { await React.act(async () => root.unmount()) }
})

test('native scoped page imports ZIP next to New and exports the exact saved card directly', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-native-archive-page-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const service = await createStudioInstances({ stateRoot, ...adapters() })
  const copy = await service.copy({ kind: 'bundle', bundle: pin })
  const source = await service.exportArchive({ id: copy.id, expectedRevision: 0, provenance: { source: 'fixture:page', license: 'Synthetic fixture' } })
  const registered = []
  const design = { resolveKit: () => undefined, resolveBundle: () => undefined,
    registerBundleContent: content => registered.push(content), registerRetainedKit: () => assert.fail('No Kit in this Bundle fixture') }
  const content = await createDshStudioContent({ design, stateRoot, instances: service })
  const calls = [], downloads = captureDownloads(t)
  const authoring = createSameOriginStudioAuthoringClient({ agentId: 'archive-page-parent', fetch: async (_url, init) => {
    const frame = JSON.parse(init.body), args = frame.payload.args
    assert.equal(args.agentId, 'archive-page-parent')
    const method = frame.method.slice('studioAuthoring/'.length); calls.push({ method, request: args.request })
    let value
    if (method === 'list') value = await service.list()
    else {
      assert.ok(['readArchive', 'importSources', 'exportContentArchive'].includes(method), 'No model or unlisted port: ' + method)
      value = method === 'importSources' ? await service.importSources(args.request) : await content[method](args.request)
    }
    return new Response(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId, result: { ok: true, value } }))
  } })
  const root = createRoot(document.getElementById('root'))
  try {
    await React.act(async () => root.render(React.createElement(DshStudioPageWorkspace, { client, authoring, desktop: false })))
    await until(() => button('Import'))
    await click('Bundles')
    const input = document.querySelector('input[type=file]'); assert.equal(input.hidden, true)
    assert.match(input.accept, /\.zip/)
    let selections = 0; input.click = () => selections++
    await click('Import'); assert.equal(selections, 1)
    assert.equal(calls.some(call => call.method !== 'list'), false, 'opening the chooser has no content effects')
    await selectImportFile({ name: 'invalid.zip', size: 3, arrayBuffer: async () => new Uint8Array([80, 75, 0]).buffer })
    await until(() => document.body.textContent.includes('Could not import the file'))
    assert.equal(calls.some(call => call.method !== 'list'), false, 'invalid ZIP bytes fail before RPC or adoption')
    const zip = encodeStudioContentZip(source)
    await selectImportFile({ name: 'saved-bundle.zip', size: zip.byteLength, arrayBuffer: async () => zip.buffer })
    await until(() => calls.some(call => call.method === 'importSources') && !document.body.textContent.includes('Importing'))
    const imported = (await service.list()).find(record => record.id !== copy.id)
    assert.ok(imported)
    assert.equal(registered.length, 0, 'source imports do not register executable or immutable content')
    assert.ok(calls.some(call => call.method === 'readArchive'))
    assert.ok(calls.some(call => call.method === 'importSources'))
    const reopened = await createStudioInstances({ stateRoot, ...adapters() })
    assert.deepEqual(await reopened.read(imported.id), await service.read(imported.id))
    assert.equal((await service.read(copy.id)).revision, 0, 'import leaves the original S2 source unchanged')
    assert.equal(document.querySelector('.ygd-studio-conversation') === null, true)
    assert.equal(document.querySelector('dialog'), null)
    const card = [...document.querySelectorAll('.ygd-studio-kit-card')].find(node => node.querySelector('h3')?.textContent === copy.title.en)
    assert.ok(card)
    const summary = card.querySelector('summary')
    await React.act(async () => { summary.click(); button('Export', card).focus() })
    await click('Export', card)
    await until(() => downloads.length === 1)
    assert.equal(document.querySelector('dialog'), null)
    assert.deepEqual(calls.find(call => call.method === 'exportContentArchive').request,
      { id: copy.id, expectedRevision: 0 })
    assert.match(downloads[0].name, /\.zip$/); assert.equal(downloads[0].blob.type, 'application/zip')
    const downloaded = JSON.parse(decodeStudioContentZip(new Uint8Array(await downloads[0].blob.arrayBuffer())))
    assert.deepEqual(downloaded.files, JSON.parse(source).files, 'ZIP export retains all original source and binary bytes')
  } finally { await React.act(async () => root.unmount()) }
})

test('the complete editor opens the exact host candidate inline and saves only on explicit confirmation', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-native-content-page-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const storage = { stateRoot, ...adapters() }, service = await createStudioInstances(storage)
  await service.copy({ kind: 'bundle', bundle: pin }) // An unrelated copy must never replace the target.
  const record = await service.copy({ kind: 'bundle', bundle: pin })
  const request = { id: record.id, expectedRevision: 0, changes: additions() }
  const prepared = { request, candidate: await service.prepareChanges(request) }
  const locator = { id: record.id, expectedRevision: 0, bundle: record.bundle, requestId: 'page-host-candidate', digest: prepared.candidate.digest }
  let saves = 0, reads = 0, exported
  const exports = [], downloads = captureDownloads(t)
  const authoring = createSameOriginStudioAuthoringClient({ agentId: 'page-host-parent', fetch: async (_url, init) => {
    const frame = JSON.parse(init.body), args = frame.payload.args
    assert.equal(args.agentId, 'page-host-parent')
    const method = frame.method.slice('studioAuthoring/'.length)
    let value
    if (method === 'readPrepared') { assert.deepEqual(args.request, locator); reads++; value = { prepared } }
    else if (method === 'exportContentArchive') {
      exports.push(args.request)
      if (exports.length === 1) return new Response(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId,
        result: { ok: false, error: { code: 'EXPORT_UNAVAILABLE', message: 'Export unavailable', details: null } } }))
      value = exported = await service.exportArchive(args.request)
    }
    else {
      assert.ok(['list', 'read', 'readFile', 'preview', 'saveChanges'].includes(method), 'opening a host candidate does not dispatch native work')
      if (method === 'saveChanges') saves++
      value = await service[method](args.request)
    }
    return new Response(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId, result: { ok: true, value } }))
  } })
  const location = studioAuthoringLocation('dsh-app://app' + studioPreparedUrl('page-host-parent', locator))
  const root = createRoot(document.getElementById('root'))
  const oldConfirm = window.confirm
  let confirmations = 0
  window.confirm = () => { confirmations++; return true }
  try {
    await React.act(async () => root.render(React.createElement(DshStudioPageWorkspace, { client, authoring, desktop: false, location })))
    await until(() => button('Save') && !button('Save').disabled)
    assert.ok(document.querySelector('.ygd-studio-conversation'))
    assert.ok(document.querySelector('.ygd-studio-authoring-layout'))
    assert.equal(saves, 0); assert.equal(reads, 1)
    assert.equal(button('Review proposed changes'), undefined, 'the exact candidate opens directly without a second selection click')
    await click('Source Files')
    await click('Diff')
    assert.ok(document.querySelector('.ygd-studio-inline-diff'), 'the exact proposal uses inline differences in the existing source view')
    assert.equal(button('Export').disabled, true, 'unsaved candidates cannot export')
    await click('Panel Preview')
    assert.ok(document.querySelector('.dsh-panel-sample-preview'))
    assert.equal(saves, 0)
    await click('Save'); await until(() => document.body.textContent.includes('Candidate saved to the working copy.'))
    await until(() => button('Export') && !button('Export').disabled)
    const editor = document.querySelector('.ygd-studio-instance'), conversation = document.querySelector('.ygd-studio-conversation')
    await click('Export'); await until(() => button('View issues'))
    assert.equal(document.querySelector('.ygd-studio-instance'), editor)
    assert.equal(document.querySelector('.ygd-studio-conversation'), conversation, 'export preserves the editor and conversation')
    assert.equal(confirmations, 0, 'a confirmed save is not misreported as unsaved source')
    await click('View issues'); assert.match(document.body.textContent, /Export unavailable/)
    assert.equal(downloads.length, 0); assert.equal(saves, 1, 'export failure cannot repeat the confirmed save')
    await click('Export'); await until(() => downloads.length === 1)
    assert.deepEqual(exports[0], { id: record.id, expectedRevision: 1 })
    assert.deepEqual(exports, [exports[0], exports[0]], 'explicit retry retains the same saved source')
    assert.match(Buffer.from(JSON.parse(exported).files.find(file => file.path === 'schema.yaml').base64, 'base64').toString(), /review/)
    assert.match(downloads[0].name, /\.zip$/)
    assert.deepEqual(JSON.parse(decodeStudioContentZip(new Uint8Array(await downloads[0].blob.arrayBuffer()))), JSON.parse(exported))
    assert.equal(document.querySelector('.ygd-studio-instance'), editor)
    assert.equal(document.querySelector('.ygd-studio-conversation'), conversation, 'closing export preserves the same editor rather than reopening another copy')
    const reopened = await createStudioInstances(storage)
    assert.equal((await reopened.read(record.id)).revision, 1)
    assert.match((await reopened.readFile({ id: record.id, path: 'schema.yaml' })).content, /review/)
    assert.equal(saves, 1)
  } finally { await React.act(async () => root.unmount()); window.confirm = oldConfirm }
})

test('scoped full page copies exact catalog content, reviews native fixture candidate, saves and freshly reopens S2', { timeout: 20000 }, async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-full-page-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const storage = { stateRoot, ...adapters() }, service = await createStudioInstances(storage)
  let ref, prepared, starts = 0, saves = 0, copied
  const downloads = captureDownloads(t)
  const ports = {
    exportContentArchive: request => service.exportArchive(request),
    instances: { ...service,
      copy: async request => { assert.deepEqual(request, { kind: 'bundle', bundle: pin }); copied = await service.copy(request); return copied },
      saveChanges: async request => { saves++; return service.saveChanges(request) },
    },
    start: async request => {
      starts++
      assert.equal(request.id, copied.id); assert.equal(request.expectedRevision, 0); assert.deepEqual(request.bundle, copied.bundle)
      const change = { id: request.id, expectedRevision: request.expectedRevision, changes: additions() }
      prepared = { request: change, candidate: await service.prepareChanges(change) }
      ref = { sessionId: 'page-fixture-child', epoch: request.invocationId, invocationId: request.invocationId,
        parentSessionId: 'page-fixture-parent', messageId: 'page-fixture-message', afterSeq: 2,
        scope: { id: request.id, expectedRevision: request.expectedRevision, bundle: request.bundle, allowedPaths: request.paths } }
      return ref
    },
    resume: async () => { assert.fail('No automatic resume') },
    observe: async () => ({ reference: ref, status: 'completed', consumed: true, pendingInput: false, terminal: true, turn: 7, throughSeq: 10, source: 'live', durable: false }),
    readPrepared: async () => prepared,
    listReferences: async () => ref ? [ref] : [],
    cancel: async () => { assert.fail('Page teardown cannot cancel the native run') },
  }
  // Use the actual immutable transport client, including request/result codecs.
  // Native execution stays a finite fixture; S2 still owns real temporary files.
  const authoring = createSameOriginStudioAuthoringClient({ agentId: 'page-fixture-parent', fetch: async (_url, init) => {
    const frame = JSON.parse(init.body), { agentId, request } = frame.payload.args
    assert.equal(agentId, 'page-fixture-parent')
    assert.match(frame.method, /^studioAuthoring\//)
    const method = frame.method.slice('studioAuthoring/'.length)
    let value
    if (Object.hasOwn(ports.instances, method)) value = await ports.instances[method](request)
    else {
      assert.ok(Object.hasOwn(ports, method), 'No unlisted native fixture method')
      value = await ports[method](request)
      if (method === 'readPrepared') value = { prepared: value }
    }
    return new Response(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId, result: { ok: true, value } }))
  } })
  assert.equal(Object.isFrozen(authoring.instances), true, 'the production client retains its immutable method descriptors')
  const root = createRoot(document.getElementById('root'))
  try {
    await React.act(async () => root.render(React.createElement(DshStudioPageWorkspace, { client, authoring, desktop: false, location: { presentation: 'full' } })))
    await until(() => button('Bundles')); await click('Bundles'); await until(() => button('Copy')); await click('Copy')
    await until(() => document.querySelector('.ygd-studio-instance') && button('Edit'))
    assert.equal(document.querySelector('section[aria-label="AI changes"] textarea') === null, true, 'copying alone does not enter authoring')
    await click('Edit')
    await until(() => document.querySelector('section[aria-label="AI changes"] textarea'))
    assert.equal(starts, 0); assert.equal(saves, 0)
    const intent = document.querySelector('section[aria-label="AI changes"] textarea')
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(intent, 'Add a Needs review status.')
      intent.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const workplane = document.querySelector('.ygd-studio-instance')
    await until(() => button('Send') && !button('Send').disabled)
    await click('Send'); await until(() => button('Save') && !button('Save').disabled)
    assert.equal(starts, 1); assert.equal(saves, 0)
    assert.equal((await service.read({ id: copied.id })).revision, 0)
    assert.equal(button('Review proposed changes'), undefined, 'owned clean results appear inline without a review gate')
    assert.equal(document.querySelector('.ygd-studio-instance'), workplane, 'the native page retains the same working-copy DOM')
    assert.ok(button('SKILL.md'), 'review retains unchanged files in the complete tree')
    await click('Diff')
    assert.ok(document.querySelector('.ygd-studio-workspace .ygd-studio-inline-diff'))
    await click('Panel Preview'); await until(() => document.querySelector('.dsh-panel-sample-preview'))
    await click('Save'); await until(() => document.body.textContent.includes('Candidate saved to the working copy.'))
    await React.act(async () => {
      const reopened = await createStudioInstances(storage)
      assert.equal((await reopened.read({ id: copied.id })).revision, 1)
      assert.match((await reopened.readFile({ id: copied.id, path: 'schema.yaml' })).content, /review/)
    })
    assert.equal(saves, 1)
    await until(() => intent.value === '')
    await click('Export'); await until(() => downloads.length === 1)
    assert.equal(document.querySelector('dialog'), null)
    assert.equal(document.querySelector('.ygd-studio-instance'), workplane)
    assert.equal(starts, 1); assert.equal(saves, 1, 'export never repeats native work or saving')
  } finally { await React.act(async () => root.unmount()) }
})
