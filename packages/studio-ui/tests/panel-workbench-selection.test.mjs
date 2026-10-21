/** Source-plane mounted selection/save regression; not installed or native acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { register } from 'tsx/esm/api'

const require = createRequire(new URL('../../panel/package.json', import.meta.url))
const { JSDOM } = require('jsdom')
const React = require('react')
const source = process.env.STUDIO_PANEL_WORKBENCH_SOURCE
  ? pathToFileURL(process.env.STUDIO_PANEL_WORKBENCH_SOURCE).href
  : new URL('../src/PanelDraftWorkbench.tsx', import.meta.url).href
const loader = register({ namespace: 'panel-workbench-selection' })
const { PanelDraftWorkbench } = await loader.import(source, import.meta.url)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const record = id => ({ id, revision: 0, confirmed: false, kit: { name: 'synthetic', version: '1.0' },
  bundle: { name: id, version: '1.0' }, panelSource: 'initial', sampleSource: '{}' })

async function fixture(overrides = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:32123/' })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'React', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys.slice(0, 5)) globalThis[key] = dom.window[key]
  globalThis.React = React; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = require('react-dom/client')
  const root = createRoot(document.getElementById('root')), save = deferred(), saves = []
  const authoring = { client: {
    read: async id => record(id), save: input => { saves.push(input); return save.promise },
    preview: async request => ({ diagnostics: [], preview: { ...request, kit: record(request.id).kit, bundle: record(request.id).bundle, sample: {} } }),
    ...overrides,
  }, renderPreview: () => React.createElement('div', {}, 'Synthetic preview') }
  const render = id => React.act(async () => root.render(React.createElement(PanelDraftWorkbench, { authoring, initialId: id, locale: 'en', onDirtyChange: () => {} })))
  const heading = () => document.querySelector('.ygd-studio-editor-heading strong')?.textContent
  const editAndSave = async () => {
    await React.act(async () => wait(470))
    const input = document.querySelector('textarea')
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'edited')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await React.act(async () => wait(470))
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === 'Save Panel')
    assert.equal(button?.disabled, false)
    await React.act(async () => button.click())
    assert.equal(saves.length, 1)
  }
  const close = async () => {
    await React.act(async () => root.unmount()); dom.window.close()
    for (const key of keys) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key] }
  }
  return { render, heading, editAndSave, save, saves, close }
}

test('a late A save must not reopen A after selecting and loading B', async () => {
  const f = await fixture()
  try {
    await f.render('A'); await f.editAndSave(); await f.render('B')
    assert.equal(f.heading(), 'Edit Panel · B')
    await React.act(async () => f.save.resolve({ ...record('A'), revision: 1, panelSource: 'edited' }))
    assert.equal(f.heading(), 'Edit Panel · B')
    assert.equal(document.querySelector('textarea').value, 'initial')
    assert.deepEqual(f.saves[0], { id: 'A', expectedRevision: 0, panelSource: 'edited', sampleSource: '{}' }, 'original CAS save remains unchanged')
  } finally { await f.close() }
})

test('selection clears the old editor while B is loading, including late A save', async () => {
  const loading = deferred(), f = await fixture({ read: id => id === 'B' ? loading.promise : Promise.resolve(record(id)) })
  try {
    await f.render('A'); await f.editAndSave(); await f.render('B')
    assert.equal(document.querySelector('textarea'), null, 'old A is no longer editable while B loads')
    await React.act(async () => f.save.resolve({ ...record('A'), revision: 1, panelSource: 'edited' }))
    assert.equal(document.querySelector('textarea'), null)
    await React.act(async () => loading.resolve(record('B')))
    assert.equal(f.heading(), 'Edit Panel · B')
  } finally { await f.close() }
})

test('a wrong-ID save response cannot replace the selected editor', async () => {
  const f = await fixture()
  try {
    await f.render('A'); await f.editAndSave()
    await React.act(async () => f.save.resolve({ ...record('B'), revision: 1, panelSource: 'edited' }))
    assert.equal(f.heading(), 'Edit Panel · A')
    assert.equal(document.querySelector('textarea').value, 'edited')
  } finally { await f.close() }
})

test('the matching active save still adopts its new authoritative revision', async () => {
  const f = await fixture()
  try {
    await f.render('A'); await f.editAndSave()
    await React.act(async () => f.save.resolve({ ...record('A'), revision: 1, panelSource: 'edited' }))
    assert.equal(f.heading(), 'Edit Panel · A')
    assert.equal(document.querySelector('textarea').value, 'edited')
    assert.match(document.querySelector('.ygd-studio-yaml-pane header').textContent, /Saved/)
  } finally { await f.close() }
})

/** The unified installed preview must retain the old workbench's selection guards. */
async function inlineFixture({ recoverable = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:32123/' })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'React', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys.slice(0, 5)) globalThis[key] = dom.window[key]
  globalThis.React = React; globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.confirm = () => true
  // Studio imports react-dom portals. Initialize the DOM before that import so
  // React's input-event capability detection tests the mounted environment.
  const { StudioWorkspace } = await loader.import(new URL('../src/StudioWorkspace.tsx', import.meta.url).href, import.meta.url)
  const { StudioWorkspaceController } = await loader.import(new URL('../src/controller.ts', import.meta.url).href, import.meta.url)
  const { createRoot } = require('react-dom/client')
  const root = createRoot(document.getElementById('root')), save = deferred(), restore = deferred(), calls = []
  const kit = { name: 'synthetic', version: '1.0' }, pin = name => ({ name, version: '1.0' })
  const rec = (name, revision = 0) => ({ ...record(`draft-${name}`), kit, bundle: pin(name), revision, panelSource: revision ? 'edited A' : `initial ${name}` })
  const client = {
    workspace: async () => ({ kits: [kit], bundles: ['A', 'B'].map(name => ({ ...pin(name), description: name, usedBy: [kit] })), query: '' }),
    readKitWorkspace: async () => ({ workspace: { ...kit, mindsetSource: '# Synthetic', mounts: [], resources: [] }, diagnostics: [] }),
    readBundleWorkspace: async name => ({ workspace: { ...pin(name), kit: kit.name, description: name, files: [{ path: 'panel.yaml', bytes: 9 }],
      manifest: { ...pin(name), presentation: { mode: 'declarative' } }, schema: { type: 'object' }, validation: { rules: 0, drivers: [] }, panel: { kind: 'declarative' } }, diagnostics: [] }),
    readBundleFile: async ({ name, path }) => ({ file: { path, content: `initial ${name}` }, diagnostics: [] }),
  }
  const authoring = { client: {
    previewInstalled: async input => ({ diagnostics: [], preview: { ...input, sample: {} } }),
    create: async input => { calls.push({ create: input }); return { ...rec(input.bundle.name), ...(recoverable ? { id: 'draft-new' } : {}) } },
    list: async () => recoverable ? [rec('A')] : [], read: async () => restore.promise,
    preview: async input => ({ diagnostics: [], preview: { ...input, kit, bundle: pin(input.id === 'draft-new' ? 'A' : input.id.slice(6)), sample: {} } }),
    save: input => { calls.push({ save: input }); return save.promise },
  }, renderPreview: () => React.createElement('div', {}, 'Synthetic preview') }
  const trials = { list: async () => [], checkConnection: async () => ({ status: 'available' }),
    start: async input => { calls.push({ start: input }); return { id: 'synthetic-trial', source: input.source, status: 'completed', task: 'synthetic input' } },
    read: async () => { throw Error('unused') },
  }
  const controller = new StudioWorkspaceController(client)
  const click = async text => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === text)
    assert.ok(button, `button exists: ${text}`); assert.equal(button.disabled, false, `button enabled: ${text}`)
    await React.act(async () => button.click())
  }
  const edit = async text => React.act(async () => {
    const input = document.querySelector('textarea[aria-label="Panel YAML"]')
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const open = async () => {
    await React.act(async () => { root.render(React.createElement(StudioWorkspace, { client, controller, authoring, trials, locale: 'en' }));
      await controller.load(); await controller.selectKit(kit.name, kit.version); await controller.openBundleWorkspace('A', '1.0') })
    await click('Panel preview')
    assert.equal(calls.length, 0, 'viewing installed YAML creates no draft or trial')
  }
  const close = async () => {
    await React.act(async () => root.unmount()); dom.window.close()
    for (const key of keys) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key] }
  }
  return { calls, controller, save, restore, rec, kit, pin, open, click, edit, close }
}

for (const mode of ['late-save', 'active-save', 'wrong-id']) test(`inline preview ${mode} preserves the current exact trial source`, async () => {
  const f = await inlineFixture()
  try {
    await f.open(); await f.edit('edited A'); await React.act(async () => wait(470)); await f.click('Save Panel')
    assert.deepEqual(f.calls.find(call => call.save).save, { id: 'draft-A', expectedRevision: 0, panelSource: 'edited A', sampleSource: '{}' }, 'original CAS save remains unchanged')
    if (mode === 'late-save') {
      await React.act(async () => document.querySelector('button[aria-label="Back"]').click())
      await React.act(async () => f.controller.openBundleWorkspace('B', '1.0'))
    }
    await React.act(async () => f.save.resolve(mode === 'wrong-id' ? { ...f.rec('A', 1), id: 'foreign-id' } : f.rec('A', 1)))
    if (mode !== 'late-save') {
      assert.match(document.querySelector('.ygd-studio-yaml-pane header').textContent, mode === 'wrong-id' ? /Unsaved/ : /Saved/)
      assert.equal(document.querySelector('textarea').value, 'edited A')
    }
    await f.click('Trial run')
    const starts = f.calls.filter(call => call.start)
    assert.equal(starts.length, mode === 'wrong-id' ? 0 : 1)
    if (mode !== 'wrong-id') assert.deepEqual(starts[0].start.source, mode === 'late-save'
      ? { kind: 'installed', kit: f.kit, bundle: f.pin('B') }
      : { kind: 'panel-draft', id: 'draft-A', expectedRevision: 1, kit: f.kit, bundle: f.pin('A') })
  } finally { await f.close() }
})

test('inline recovery cannot replace subsequent typing or a newly created local copy', async () => {
  const f = await inlineFixture({ recoverable: true })
  try {
    await f.open(); await f.click('Continue local copy'); await f.edit('first edit')
    await React.act(async () => wait(470)); await f.edit('latest edit')
    await React.act(async () => f.restore.resolve(f.rec('A')))
    assert.equal(document.querySelector('textarea').value, 'latest edit')
    assert.equal(f.calls.filter(call => call.create).length, 1, 'continuous typing creates only one isolated draft')
    assert.equal(f.calls.filter(call => call.start).length, 0, 'recovery and typing never launch a trial')
  } finally { await f.close() }
})

test.after(async () => loader.unregister())
