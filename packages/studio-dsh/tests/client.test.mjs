/** Built acceptance for the DSH Studio launcher and shared client mapping. */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createDshStudioClient,
  DshStudioSettingsSection,
  registerDshStudioSettings,
  renderStudioLauncher,
  renderStudioReturnNavigation,
  STUDIO_PAGE_URL,
} from '../lib/client-adapter.js'
import TYPERT_REMOTE from '../lib/typert.remote-client.js'

assert.deepEqual(
  TYPERT_REMOTE.descriptors.map(descriptor => ({
    method: descriptor.method,
    invocation: descriptor.invocation.kind,
    hasScope: Object.hasOwn(descriptor, 'scope'),
    parameterSources: descriptor.parameters.map(parameter => parameter.source),
  })),
  [
    { method: 'workspace', invocation: 'direct', hasScope: false, parameterSources: ['json'] },
    { method: 'readKitWorkspace', invocation: 'direct', hasScope: false, parameterSources: ['json', 'json'] },
    { method: 'readKitFiles', invocation: 'direct', hasScope: false, parameterSources: ['json', 'json'] },
    { method: 'readKitFile', invocation: 'direct', hasScope: false, parameterSources: ['json', 'json', 'json'] },
    { method: 'readBundleWorkspace', invocation: 'direct', hasScope: false, parameterSources: ['json', 'json'] },
    { method: 'readBundleFile', invocation: 'direct', hasScope: false, parameterSources: ['json', 'json', 'json'] },
  ],
  'the read-only surface keeps six scope-free methods with their business inputs on the JSON wire',
)

for (const [method, names] of [
  ['readKitFiles', ['name', 'version']],
  ['readKitFile', ['name', 'version', 'path']],
]) {
  const descriptor = TYPERT_REMOTE.descriptors.find(candidate => candidate.method === method)
  assert.deepEqual(descriptor.parameters.map(parameter => parameter.name), names)
  for (const parameter of descriptor.parameters) {
    assert.equal(parameter.acceptsUndefined, undefined, `${method}/${parameter.name} is required on the wire`)
    for (const invalid of [undefined, null, 1]) {
      assert.throws(() => parameter.codec.create().parse(invalid), /required|invalid/iu, `${method}/${parameter.name} requires a string`)
    }
    assert.equal(parameter.codec.create().parse('exact-value'), 'exact-value')
  }
}

const empty = { query: '', kits: [], bundles: [] }
const readResult = { diagnostics: [] }
const kitWorkspaceResult = { workspace: { name: 'web_app', version: '1.0', description: '', mindsetSource: '---\n---\n', mounts: [], resources: [] }, diagnostics: [] }
const normalizedKitWorkspaceResult = {
  workspace: {
    ...kitWorkspaceResult.workspace,
    relationVocabulary: { schemaVersion: 1, pin: 'legacy-unavailable', relations: [] },
  },
  diagnostics: [],
}
const bundleWorkspaceResult = { workspace: { name: 'flows', version: '1.0', kit: 'web_app', description: '', files: [] }, diagnostics: [] }
const bundleFileResult = { file: { path: 'SKILL.md', content: '# flows\n' }, diagnostics: [] }
const kitFilesResult = ['kit.yaml', 'mindset.md', 'reference/guide.md']
const kitFileResult = { content: 'schemaVersion: 1\nname: web_app\n' }
const kitReadCalls = []
const client = createDshStudioClient({
  async workspace(query) { return { ok: true, value: { ...empty, query } } },
  async readKitWorkspace() { return { ok: true, value: kitWorkspaceResult } },
  async readKitFiles(name, version) { kitReadCalls.push(['readKitFiles', name, version]); return { ok: true, value: kitFilesResult } },
  async readKitFile(name, version, path) { kitReadCalls.push(['readKitFile', name, version, path]); return { ok: true, value: kitFileResult } },
  async readBundleWorkspace() { return { ok: true, value: bundleWorkspaceResult } },
  async readBundleFile() { return { ok: true, value: bundleFileResult } },
})
assert.deepEqual(Object.keys(client).sort(), ['readBundleFile', 'readBundleWorkspace', 'readKitFile', 'readKitFiles', 'readKitWorkspace', 'workspace'], 'the shared client exposes exactly the six read-only methods')
assert.equal((await client.workspace('flow')).query, 'flow')
assert.deepEqual(await client.readKitWorkspace('web_app', '1.0'), normalizedKitWorkspaceResult, 'older hosts are normalized only at the browser adapter boundary')
assert.deepEqual(await client.readKitFiles({ name: 'web_app', version: '1.0' }), kitFilesResult)
assert.deepEqual(await client.readKitFile({ name: 'web_app', version: '1.0', path: 'kit.yaml' }), kitFileResult)
assert.deepEqual(kitReadCalls, [
  ['readKitFiles', 'web_app', '1.0'],
  ['readKitFile', 'web_app', '1.0', 'kit.yaml'],
], 'the UI input objects map to the exact Kit pin and relative path Remote arguments')
assert.deepEqual(await client.readBundleWorkspace('flows'), bundleWorkspaceResult)
assert.deepEqual(await client.readBundleFile({ name: 'flows', path: 'SKILL.md' }), bundleFileResult)

const failed = createDshStudioClient({
  async workspace() { return { ok: false, error: { code: 'offline', message: 'connection unavailable' } } },
  async readKitWorkspace() { return { ok: true, value: kitWorkspaceResult } },
  async readKitFiles() { return { ok: false, error: { code: 'studio.kit_missing', message: 'Kit source is unavailable' } } },
  async readKitFile() { return { ok: false, error: { code: 'studio.kit_file_unsafe', message: 'Kit file path is unsafe' } } },
  async readBundleWorkspace() { return { ok: true, value: bundleWorkspaceResult } },
  async readBundleFile() { return { ok: true, value: bundleFileResult } },
})
await assert.rejects(failed.workspace(''), /connection unavailable/)
await assert.rejects(failed.readKitFiles({ name: 'web_app', version: '1.0' }), /studioManagement\/readKitFiles: Kit source is unavailable/u)
await assert.rejects(failed.readKitFile({ name: 'web_app', version: '1.0', path: '../outside' }), /studioManagement\/readKitFile: Kit file path is unsafe/u)
console.log('the shared client maps Remote outcomes and normalizes legacy Kit relation projections')

const launcher = renderToStaticMarkup(renderStudioLauncher({ close() {} }))
assert.match(launcher, /Open Design Studio/)
assert.match(launcher, new RegExp(`href="${STUDIO_PAGE_URL}"`), 'the launcher is a real navigable link to the owned route')
assert.match(launcher, /target="_blank"/)
assert.match(launcher, /rel="noopener noreferrer"/, 'the Studio page never holds the host window opener')
assert.match(launcher, new RegExp(STUDIO_PAGE_URL.replace(/\//gu, '\\/')), 'the exact URL stays copyable')
assert.doesNotMatch(launcher, /window\.open|role="alert"/, 'no popup heuristics or blocked-state inference')

for (const href of ['https://host.example/conversation/123', 'http://127.0.0.1:3000/']) {
  const web = renderToStaticMarkup(renderStudioLauncher({ close() {} }, false, href))
  assert.match(web, /target="_blank"/u, 'HTTP(S) retains the independent Web page')
  assert.match(web, /rel="noopener noreferrer"/u)
  assert.equal(renderStudioReturnNavigation(false, href), null, 'Web keeps its original conversation tab')
}

for (const href of ['dsh-app://app/', 'dsh-app://app/conversation/123?private=value#fragment']) {
  const desktop = renderToStaticMarkup(renderStudioLauncher({ close() {} }, true, href))
  assert.match(desktop, /href="\/design-studio\/" target="_self"/u, 'Desktop uses the existing same-window app route')
  assert.match(desktop, /当前窗口/u)
  assert.match(desktop, /返回对话/u)
  assert.doesNotMatch(desktop, /_blank|private=value|fragment|不会中断/u, 'no new-window assumption or copied host URL data')
}

for (const href of [
  'dsh-app://app/design-studio/',
  'dsh-app://app/design-studio?returnTo=https://evil.example/#private=value',
  'dsh-app://app/design-studio/?returnTo=%2F%2Fevil.example',
]) {
  const back = renderToStaticMarkup(renderStudioReturnNavigation(true, href))
  assert.match(back, /aria-label="应用导航"/u)
  assert.match(back, /href="\/" target="_self"/u, 'return always resolves to the trusted application root')
  assert.match(back, /返回对话/u)
  assert.doesNotMatch(back, /returnTo|evil|private|_blank/u, 'caller-controlled redirects and credentials are never propagated')
}
assert.match(renderToStaticMarkup(renderStudioReturnNavigation(false, 'dsh-app://app/design-studio/')), /Back to conversation/u)

for (const href of [
  'invalid-url', 'file:///design-studio/', 'https://app/design-studio/',
  'dsh-app://other/design-studio/', 'dsh-app://app.evil/design-studio/',
  'dsh-app://app:3000/design-studio/', 'dsh-app://user:secret@app/design-studio/',
]) {
  assert.equal(renderStudioReturnNavigation(false, href), null, 'no return control on an unrecognized app authority')
  assert.match(renderToStaticMarkup(renderStudioLauncher({ close() {} }, false, href)), /target="_blank"/u)
}
assert.equal(renderStudioReturnNavigation(false, 'dsh-app://app/other/'), null, 'return belongs only to the Studio page')

// Settings uses the actual browser location without requiring a new host service.
{
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'dsh-app://app/' } })
    assert.match(renderToStaticMarkup(renderStudioLauncher({ close() {} })), /target="_self"/u)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor)
    else delete globalThis.location
  }
}
console.log('Desktop navigation stays on the app protocol with a fixed root return; Web retains noopener navigation')

const locale = {
  getSnapshot: () => ({ active: 'zh', revision: 0 }),
  subscribe() { return () => {} },
}
const section = renderToStaticMarkup(createElement(DshStudioSettingsSection, {
  close() {}, locale,
}))
assert.match(section, /打开 Design Studio/)
assert.match(section, /Kit 与 Bundle 工作区/)
assert.doesNotMatch(section, /GRA 设计建议|当前建议最大条数|type="number"/)
assert.doesNotMatch(section, /Bundle catalog/, 'Settings renders only the launcher, never the embedded workspace')

let registration
let disposed = false
registerDshStudioSettings({
  locale,
  slots: {
    inject(injectName, install) {
      assert.equal(injectName, 'settings.section')
      const dispose = install()
      registration.dispose = dispose
    },
    register(spec, component) {
      registration = { ...registration, spec, component }
      return () => { disposed = true }
    },
  },
})
assert.deepEqual(
  { id: registration.spec.id, name: registration.spec.name, order: registration.spec.order, label: registration.spec.label() },
  { id: 'design-studio', name: 'settings.section', order: 40, label: '设计工作室' },
)
assert.deepEqual(registration.spec.inject(), {}, 'the launcher needs no embedded management client')
assert.equal(typeof registration.component, 'function')
registration.dispose()
assert.equal(disposed, true)
disposed = false
registerDshStudioSettings({
  locale,
  slots: {
    inject(injectName, install) {
      assert.equal(injectName, 'settings.section')
      const dispose = install()
      registration.dispose = dispose
    },
    register(spec, component) {
      registration = { spec, component }
      return () => { disposed = true }
    },
  },
})
assert.equal(registration.spec.id, 'design-studio', 'service re-attach installs the same launcher identity')
assert.match(renderToStaticMarkup(createElement(registration.component, { close() {} })), /打开 Design Studio/u)
registration.dispose()
assert.equal(disposed, true, 're-attached launcher registration still withdraws on teardown')
console.log('Settings contributes one lifecycle-owned Studio launcher without atomic G/R/A preferences')
