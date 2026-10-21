/** Mounted shared-workspace integration; no native host or real publication. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { StudioWorkspaceController } from '../src/controller.ts'

const requirePanel = createRequire(new URL('../../panel/package.json', import.meta.url))
const { JSDOM } = requirePanel('jsdom')
const dom = new JSDOM('<html lang="en"><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const { StudioWorkspace } = await import('../src/StudioWorkspace.tsx')
const { act } = React
const pin = { name: 'archive_kit', version: '2.0' }
const record = { id: 'archive-retained-id', archive: { kind: 'kit', pin, provenance: { source: 'fixture', license: 'Apache-2.0' }, files: [], dependencies: [] }, validation: { valid: true, diagnostics: [] }, executionGranted: false, requiresTrustReview: false }
const draft = { id: 'archive-adopted-draft', revision: 0, confirmed: false, baseKit: pin, mindsetSource: '# Imported mindset', relationsSource: null, mounts: [] }
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text)
const click = async text => { assert.ok(button(text), text); await act(async () => button(text).click()) }
const edit = async (label, value) => {
  const element = document.querySelector(`[aria-label="${label}"]`); assert.ok(element, label)
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
}

async function fixture({ content = true, kitAuthoring = true, componentLibrary = false, kind = 'kit' } = {}) {
  const calls = [], dirty = []
  let retained = false
  const importRecord = { ...record, archive: { ...record.archive, kind } }
  const receipt = { importId: record.id, contents: [{ kind, pin }], ...(kind === 'kit' ? { draft } : {}), executionGranted: false, requiresTrustReview: false }
  const client = {
    workspace: async () => ({ query: '', kits: [], bundles: retained && kind === 'bundle' ? [{ ...pin, description: 'Independent content', usedBy: [] }] : [] }),
    readBundleWorkspace: async (name, version) => {
      calls.push(['read-bundle', { name, version }])
      return { workspace: { ...pin, description: 'Independent content', files: [], panel: { kind: 'native', renderer: 'fixture' } }, diagnostics: [] }
    },
  }
  const controller = new StudioWorkspaceController(client)
  await controller.load()
  const contentClient = {
    list: async () => { calls.push(['list']); return [] },
    prepare: async input => { calls.push(['prepare', input]); return importRecord },
    read: async () => importRecord,
    export: async input => { calls.push(['export', input]); return '{}' },
    adopt: async input => { calls.push(['adopt', input]); retained = true; return receipt },
  }
  const authoring = { client: {
    list: async () => [draft],
    read: async id => { calls.push(['read-draft', id]); assert.equal(id, draft.id); return draft },
  }, renderPreview: () => React.createElement('div') }
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(StudioWorkspace, {
    client, controller, locale: 'en', contentClient: content ? contentClient : undefined,
    componentLibrary: componentLibrary ? { entries: () => [], skillSource: '', renderExample: () => React.createElement('div') } : undefined,
    kitAuthoring: kitAuthoring ? authoring : undefined, onDraftDirtyChange: value => dirty.push(value),
  })))
  return { calls, dirty, contentClient, client, controller, receipt, close: async () => { await act(async () => root.unmount()) } }
}

test('archive capability wires toolbar → prepare → explicit adoption → exact Kit editor', async () => {
  const f = await fixture()
  try {
    assert.deepEqual([...document.querySelectorAll('[aria-label="Studio sections"] button')].map(el => el.textContent), ['Kits', 'Bundles'])
    assert.equal(f.calls.length, 0, 'archive RPC is not polled while its workbench is closed')
    await click('Content archives')
    assert.equal(document.querySelector('main h1').textContent, 'Content Archives')
    assert.equal(f.calls.length, 1)
    await edit('Archive JSON', '{}')
    assert.equal(f.dirty.at(-1), true)
    await click('Prepare import')
    assert.equal(f.dirty.at(-1), false)
    assert.equal(f.calls.some(([name]) => name === 'adopt'), false)
    await click('Adopt Kit and create working copy')
    assert.deepEqual(f.calls.filter(([name]) => name === 'adopt'), [['adopt', { id: record.id }]])
    assert.deepEqual(f.calls.filter(([name]) => name === 'read-draft'), [['read-draft', draft.id]])
    assert.equal(document.querySelector('textarea[aria-label="mindset.md"]').value, draft.mindsetSource)
    assert.equal(document.querySelector('main h1').textContent, 'Kit Working Copies')
  } finally { await f.close() }
})

test('archive draft participates in back, refresh and sidebar discard guards', async () => {
  const f = await fixture()
  try {
    await click('Content archives'); await edit('Archive JSON', 'unprepared')
    let confirmations = 0
    window.confirm = () => { confirmations++; return false }
    for (const label of ['Back to workspace', 'Refresh content', 'Bundles', 'Kits']) {
      await click(label)
      assert.equal(document.querySelector('textarea[aria-label="Archive JSON"]').value, 'unprepared')
    }
    assert.equal(confirmations, 4)
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true)
    window.confirm = () => true; await click('Back to workspace')
    assert.equal(document.querySelector('textarea[aria-label="Archive JSON"]'), null)
    assert.equal(f.dirty.at(-1), false)
  } finally { await f.close() }
})

test('late adoption receipt cannot navigate back from a different workspace', async () => {
  const f = await fixture()
  try {
    await click('Content archives'); await edit('Archive JSON', '{}'); await click('Prepare import')
    let finish
    f.contentClient.adopt = () => new Promise(resolve => { finish = resolve })
    await click('Adopt Kit and create working copy'); await click('Bundles')
    await act(async () => finish(f.receipt))
    assert.equal(f.calls.some(([name]) => name === 'read-draft'), false)
    assert.equal(document.querySelector('main h1').textContent, 'Bundles')
  } finally { await f.close() }
})

test('missing archive or Kit-authoring ports preserve capability boundaries', async () => {
  const absent = await fixture({ content: false })
  try { assert.equal(button('Content archives'), undefined); assert.equal(absent.calls.length, 0) }
  finally { await absent.close() }
  const readonly = await fixture({ kitAuthoring: false })
  try {
    await click('Content archives'); await edit('Archive JSON', '{}'); await click('Prepare import')
    assert.equal(button('Adopt Kit and create working copy').disabled, true)
    assert.equal(readonly.calls.some(([name]) => name === 'adopt'), false)
  } finally { await readonly.close() }
})

test('component library and archives remain separate, guarded workspaces', async () => {
  const f = await fixture({ componentLibrary: true })
  try {
    await click('Panel Component Library')
    assert.equal(document.querySelector('main h1').textContent, 'Panel Component Library')
    await click('Content archives')
    assert.equal(document.querySelector('main h1').textContent, 'Content Archives')
    await edit('Archive JSON', '{}')
    window.confirm = () => false; await click('Panel Component Library')
    assert.equal(document.querySelector('main h1').textContent, 'Content Archives')
    window.confirm = () => true; await click('Panel Component Library')
    assert.equal(document.querySelector('main h1').textContent, 'Panel Component Library')
    await click('Kits')
    assert.equal(document.querySelector('main h1').textContent, 'Kits')
  } finally { await f.close() }
})


test('independent Bundle adoption refreshes the catalog and opens the exact pin without a Kit editor', async () => {
  const f = await fixture({ kind: 'bundle', kitAuthoring: false })
  try {
    await click('Content archives'); await edit('Archive JSON', '{}'); await click('Prepare import')
    await click('Adopt Bundle')
    assert.deepEqual(f.calls.filter(([name]) => name === 'adopt'), [['adopt', { id: record.id }]])
    assert.deepEqual(f.calls.filter(([name]) => name === 'read-bundle'), [['read-bundle', pin]])
    assert.equal(f.calls.some(([name]) => name === 'read-draft'), false)
    const snapshot = f.controller.getSnapshot()
    assert.equal(snapshot.section, 'bundles')
    assert.deepEqual(snapshot.view.bundles[0].usedBy, [])
    assert.equal(snapshot.bundleWorkspace.name, pin.name)
    assert.equal(document.querySelector('select[aria-label="Bundle version"]').value, pin.version)
    assert.equal(document.querySelector('textarea[aria-label="Archive JSON"]'), null)
  } finally { await f.close() }
})

test('late catalog refresh after Bundle adoption cannot override user navigation', async () => {
  const f = await fixture({ kind: 'bundle', kitAuthoring: false })
  try {
    await click('Content archives'); await edit('Archive JSON', '{}'); await click('Prepare import')
    let finish
    f.client.workspace = () => new Promise(resolve => { finish = resolve })
    await click('Adopt Bundle')
    await click('Kits')
    await act(async () => finish({ query: '', kits: [], bundles: [] }))
    assert.equal(f.calls.some(([name]) => name === 'read-bundle'), false)
    assert.equal(document.querySelector('main h1').textContent, 'Kits')
  } finally { await f.close() }
})
