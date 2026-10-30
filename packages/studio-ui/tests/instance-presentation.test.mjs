/** Shared presentation port keeps instance identity, host callbacks and default behavior. */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { createRequire } from 'node:module'
import { StudioWorkspaceController } from '../src/controller.ts'

const requirePanel = createRequire(new URL('../../panel/package.json', import.meta.url))
const { JSDOM } = requirePanel('jsdom')
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const { StudioWorkspace } = await import('../src/StudioWorkspace.tsx')
const { act } = React
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
const record = id => ({ id, kind: 'bundle', title: { zh: '观察记录', en: id }, source: { bundle: { name: 'observations', version: '1.0' } }, revision: 0, mounts: [], refs: [], files: [{ path: 'SKILL.md', bytes: 9, editable: true }] })
async function mount(renderInstanceWorkbench, kind = 'bundle') {
  const fixture = id => kind === 'bundle' ? record(id) : { ...record(id), kind, source: { kit: { name: 'evidence', version: '1.0' } }, files: [{ path: 'mindset.md', bytes: 9, editable: true }] }
  const calls = [], dirty = [], instances = { list: async () => [fixture('first')], read: async ({ id }) => { calls.push(id); return fixture(id) }, readFile: async ({ id, path }) => ({ id, path, revision: 0, content: '# Fixture' }) }
  const client = { workspace: async query => ({ query, kits: [], bundles: [] }) }
  const controller = new StudioWorkspaceController(client)
  await controller.load(); controller.setSection(kind === 'kit' ? 'kits' : 'bundles')
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(StudioWorkspace, { client, controller, instances, locale: 'en', renderInstanceWorkbench, onDraftDirtyChange: value => dirty.push(value) })))
  return { instances, controller, calls, dirty, click: async text => { assert.ok(button(text), text); await act(async () => button(text).click()) }, close: async () => { await act(async () => root.unmount()) } }
}
test('host presentation receives full instance props, dirty guard, ID lifetime and callbacks', async () => {
  let received
  const lifetimes = []
  function Custom(props) {
    received = props
    React.useEffect(() => { lifetimes.push(['open', props.id]); return () => lifetimes.push(['close', props.id]) }, [])
    return React.createElement('main', null, props.id)
  }
  const f = await mount(props => React.createElement(Custom, props))
  try {
    await f.click('Edit')
    assert.equal(received.id, 'first'); assert.equal(received.client, f.instances); assert.equal(received.locale, 'en')
    for (const key of ['onBack', 'onChanged', 'onDirtyChange']) assert.equal(typeof received[key], 'function')
    assert.ok(Object.hasOwn(received, 'renderPreview'))
    assert.deepEqual(f.calls, [], 'custom presentation owns the supplied read port, not a hidden default workbench')
    await act(async () => received.onDirtyChange(true))
    window.confirm = () => false
    assert.ok(document.querySelector('[aria-label="Product navigation"]'))
    await act(async () => received.onBack()); assert.equal(received.id, 'first'); assert.equal(f.dirty.at(-1), true)
    await act(async () => { received.onDirtyChange(false); received.onChanged(record('second')) })
    assert.equal(document.querySelector('main h1')?.textContent, 'second', 'a different copied ID opens in read mode')
    assert.deepEqual(lifetimes, [['open', 'first'], ['close', 'first']])
    await f.click('Edit'); assert.equal(received.id, 'second')
    assert.deepEqual(lifetimes, [['open', 'first'], ['close', 'first'], ['open', 'second']])
    await act(async () => received.onBack())
    assert.ok(document.querySelector('[role=search][aria-label="Search bundles…"]'), 'leaving object editing restores its catalog context')
  } finally { await f.close() }
})
test('omitted and nullish presentation retain the standard source workbench', async () => {
  for (const render of [undefined, () => undefined, () => null]) {
    const f = await mount(render)
    try { await f.click('Edit'); assert.equal(document.querySelector('textarea[aria-label="SKILL.md"]')?.value, '# Fixture'); assert.deepEqual(f.calls, ['first']) }
    finally { await f.close() }
  }
})
test('catalog counts and empty state follow the same filtered visible working copies', async () => {
  for (const kind of ['kit', 'bundle']) {
  const f = await mount(undefined, kind)
  const label = kind === 'kit' ? 'Kits' : 'Bundles'
  try {
    assert.match(document.querySelector('.ygd-studio-catalog-tools [role=status]').textContent, new RegExp(`1 ${label.replace(/s$/, '')} in total`))
    assert.equal(document.querySelector('.ygd-studio-empty'), null)
    const input = document.querySelector('input[type=search]')
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'no match'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    assert.match(document.querySelector('.ygd-studio-catalog-tools [role=status]').textContent, new RegExp(`0 of 1 ${label}`))
    assert.ok(document.querySelector('.ygd-studio-empty')); assert.equal(document.querySelectorAll('.ygd-studio-kit-card').length, 0)
  } finally { await f.close() }
  }
})

test('catalog copy sends exact Kit and Bundle pins without display metadata', async () => {
  for (const kind of ['kit', 'bundle']) {
    const pin = { name: kind === 'kit' ? 'evidence' : 'observations', version: '1.0' }
    const entry = { ...pin, description: 'Display description', displayDescription: { zh: '显示说明', en: 'Display copy' },
      ...(kind === 'bundle' ? { title: { zh: '观察记录', en: 'Observations' }, usedBy: [] } : {}) }
    const client = { workspace: async query => ({ query, kits: kind === 'kit' ? [entry] : [], bundles: kind === 'bundle' ? [entry] : [] }) }
    const controller = new StudioWorkspaceController(client); await controller.load(); controller.setSection(kind === 'kit' ? 'kits' : 'bundles')
    const calls = [], copied = record('copied-' + kind)
    const instances = { list: async () => [], read: async () => copied,
      readFile: async ({ id, path }) => ({ id, path, revision: 0, content: '# Copied source' }),
      copy: async input => { calls.push(structuredClone(input)); return copied },
    }
    const root = createRoot(document.getElementById('root'))
    try {
      await act(async () => root.render(React.createElement(StudioWorkspace, { client, controller, instances, locale: 'en' })))
      assert.ok(button('Copy')); await act(async () => button('Copy').click())
      assert.deepEqual(calls, [{ kind, [kind]: pin }], 'display copy cannot enter the canonical source-pin transport')
    } finally { await act(async () => root.unmount()) }
  }
})


test('exact handoff refuses stale revisions and wrong pins; a pinless Kit remains in source files', async () => {
  for (const scenario of ['stale', 'wrong-pin', 'source-kit']) {
    const value = { ...record('handed-off'), kind: 'kit', source: { kit: { name: 'example', version: '1.0' } }, mounts: [{ bundle: { name: 'observations', version: '1.0' } }] }
    let filesRead = 0, previews = 0
    const instances = { list: async () => [value], read: async () => value,
      readFile: async ({ id, path }) => { filesRead++; return { id, path, revision: 0, content: '# Supplied method' } },
      preview: async () => { previews++; throw Error('No preview selected') },
    }
    const initialInstance = { id: value.id, expectedRevision: scenario === 'stale' ? 1 : 0,
      ...(scenario === 'wrong-pin' ? { bundle: { name: 'observations', version: '2.0' } } : {}) }
    const root = createRoot(document.getElementById('root'))
    try {
      await act(async () => root.render(React.createElement(StudioWorkspace, { client: { workspace: async () => ({ query: '', kits: [], bundles: [] }) }, instances, initialInstance, locale: 'en' })))
      if (scenario === 'source-kit') {
        assert.equal(document.querySelector('textarea[aria-label="SKILL.md"]')?.value, '# Supplied method')
        assert.equal(button('Panel Preview'), undefined, 'Kit authoring has no Panel preview')
        assert.equal(document.querySelector('.ygd-studio-file-info'), null, 'editing does not duplicate catalog descriptions')
        assert.equal(filesRead, 1)
      } else {
        await act(async () => button('View issues').click())
        assert.match(document.querySelector('.ygd-studio-error-details')?.textContent ?? '', /handed-off revision or Bundle changed/)
        assert.equal(filesRead, 0)
        assert.equal(document.querySelector('textarea'), null)
      }
      assert.equal(previews, 0, 'neither an invalid handoff nor a source-only Kit selects an arbitrary mounted preview')
    } finally { await act(async () => root.unmount()) }
  }
})


test('local Open is read-only and host-free; Copy can duplicate a local copy before explicit Edit', async () => {
  let authoring = 0, received
  const f = await mount(props => { authoring++; received = props; return React.createElement('main', null, 'Host editor') })
  const copies = []
  f.instances.copy = async request => { copies.push(request); return record('second') }
  try {
    assert.deepEqual([...document.querySelector('.ygd-studio-kit-card-actions').querySelectorAll('button')].map(node => node.textContent), ['Open', 'Copy', 'Edit', 'Move to Trash'])
    assert.ok(document.querySelector('summary[aria-label="More actions"]'))
    await f.click('Open')
    assert.equal(authoring, 0, 'opening source must not activate a native host presentation')
    assert.equal(button('Save'), undefined); assert.equal(button('Revert'), undefined)
    assert.equal(document.querySelector('[aria-label=Rename]'), null)
    await f.click('Source')
    assert.equal(document.querySelector('textarea').readOnly, true)
    await f.click('Copy')
    assert.deepEqual(copies, [{ kind: 'bundle', kit: undefined, bundle: { name: 'observations', version: '1.0' }, sourceId: 'first' }])
    assert.equal(authoring, 0, 'a copied object starts in ordinary browsing')
    assert.equal(document.querySelector('main h1').textContent, 'second')
    await f.click('Edit')
    assert.ok(authoring > 0); assert.equal(received.id, 'second'); assert.equal(received.readOnly, false)
    assert.ok(document.querySelector('[aria-label="Product navigation"]'))
    assert.ok(document.querySelector('.ygd-studio-topbar'))
  } finally { await f.close() }
})

test('a pending copy disables the read-only Edit transition until its receipt settles', async () => {
  let hostEntries = 0, finish
  const f = await mount(props => { hostEntries++; return React.createElement('main', null, props.id) })
  f.instances.copy = () => new Promise(resolve => { finish = resolve })
  try {
    await f.click('Open'); await f.click('Copy')
    assert.equal(button('Edit').disabled, true)
    await act(async () => button('Edit').click())
    assert.equal(hostEntries, 0, 'a source mutation cannot be detached by switching read mode to editing')
    await act(async () => finish(record('settled-copy')))
    assert.equal(document.querySelector('main h1').textContent, 'settled-copy')
    assert.equal(button('Edit').disabled, false)
  } finally { await f.close() }
})

test('a durable catalog deletion refreshes the list after switching sections without taking over navigation', async () => {
  const f = await mount(undefined)
  let finish, rows = [record('first')], request
  f.instances.list = async () => rows
  f.instances.remove = input => { request = input; return new Promise(resolve => { finish = () => { rows = []; resolve({ id: input.id, revision: 0, trashed: true }) } }) }
  let confirmation
  window.confirm = message => { confirmation = message; return true }
  try {
    assert.equal(button('Move to Trash').dataset.tone, 'danger')
    await f.click('Move to Trash')
    assert.match(confirmation, /system Trash/)
    assert.doesNotMatch(confirmation, /retains recoverable/)
    assert.equal(document.querySelector('[role=status]')?.textContent?.includes('Moved to the system Trash') ?? false, false)
    assert.deepEqual(request, { id: 'first', expectedRevision: 0 })
    await f.click('Kits')
    await act(async () => finish())
    assert.match(document.querySelector('[role=status]')?.textContent ?? '', /Moved to the system Trash/)
    assert.ok(document.querySelector('[role=search][aria-label="Search kits…"]'), 'a late removal receipt cannot change the current section')
    await f.click('Bundles')
    assert.equal(document.querySelectorAll('article').length, 0, 'returning to a catalog cannot resurrect the deleted card')
    assert.ok(document.querySelector('.ygd-studio-empty'))
  } finally { await f.close() }
})

test('trashing a directly opened working copy returns to its own catalog', async () => {
  for (const kind of ['bundle', 'kit']) {
    const value = { ...record('direct-copy'), kind }
    let rows = [value]
    const instances = { list: async () => rows, read: async () => value,
      readFile: async ({ id, path }) => ({ id, path, revision: 0, content: '# Fixture' }),
      remove: async () => { rows = []; return { id: value.id, revision: 0, trashed: true } },
    }
    const root = createRoot(document.getElementById('root'))
    window.confirm = () => true
    try {
      await act(async () => root.render(React.createElement(StudioWorkspace, {
        client: { workspace: async () => ({ query: '', kits: [], bundles: [] }) }, instances,
        initialInstance: { id: value.id, expectedRevision: 0 }, locale: 'en',
      })))
      await act(async () => button('Move to Trash').click())
      assert.ok(document.querySelector(`[role=search][aria-label="Search ${kind === 'bundle' ? 'bundles' : 'kits'}…"]`))
      assert.match(document.querySelector('[role=status]')?.textContent ?? '', /Moved to the system Trash/)
    } finally { await act(async () => root.unmount()) }
  }
})

test('Kit editing separates source and mount tabs, guards unsaved mounts, and saves exact pins with revision CAS', async () => {
  const f = await mount(undefined, 'kit')
  let value = { ...record('first'), kind: 'kit', source: { kit: { name: 'evidence', version: '1.0' } },
    files: [{ path: 'mindset.md', bytes: 9, editable: true }],
    mounts: [{ bundle: { name: 'observations', version: '1.0' } }],
    availableBundles: [{ name: 'observations', version: '1.0', title: { zh: '观察', en: 'Observations' } },
      { name: 'rules', version: '2.0', title: { zh: '规则', en: 'Rules' } }] }
  let finish, mutation
  f.instances.read = async () => value
  f.instances.readFile = async ({ id, path }) => ({ id, path, revision: value.revision, content: '# Saved method' })
  f.instances.updateMounts = input => { mutation = input; return new Promise(resolve => { finish = () => { value = { ...value, revision: 1, mounts: input.bundles.map(bundle => ({ bundle })) }; resolve(value) } }) }
  try {
    await f.click('Edit')
    assert.deepEqual([...document.querySelector('.ygd-studio-workplane-bar').querySelectorAll('button')].map(b => b.textContent), ['Source Files', 'Mount management'])
    assert.equal(button('Panel Preview'), undefined)
    await f.click('Mount management')
    assert.equal(document.querySelector('.ygd-studio-file-tree-pane'), null)
    assert.equal(document.querySelector('input[type=checkbox]'), null)
    assert.equal(document.querySelectorAll('[aria-label="Available Bundles"] article').length, 1, 'already mounted Bundles never appear among candidates')
    await f.click('Add')
    assert.equal(document.querySelectorAll('[aria-label="Available Bundles"] article').length, 0)
    assert.equal(document.querySelectorAll('[aria-label="Mounted Bundles"] article').length, 2)
    const added = [...document.querySelectorAll('[aria-label="Mounted Bundles"] article')].find(card => card.querySelector('h3').textContent === 'Rules')
    await act(async () => added.querySelector('button').click())
    assert.equal(document.querySelectorAll('[aria-label="Available Bundles"] article').length, 1, 'removing returns the card to candidates')
    await f.click('Add')
    assert.match(document.querySelector('.ygd-studio-mounts-change-status').textContent, /Unsaved.*1 added.*0 removed/)
    assert.ok(button('Save').closest('.ygd-studio-content-header'), 'mounts use the global editor actions')
    window.confirm = () => true
    await f.click('Revert')
    assert.equal(button('Mount management').getAttribute('aria-pressed'), 'true', 'reverting stays on the current view')
    assert.equal(document.querySelectorAll('[aria-label="Mounted Bundles"] article').length, 1)
    await f.click('Add')

    assert.equal(f.dirty.at(-1), true)
    window.confirm = () => false
    await f.click('Source Files')
    assert.equal(button('Mount management').getAttribute('aria-pressed'), 'true', 'declining leave keeps the mount selection')
    assert.equal(document.querySelectorAll('[aria-label="Mounted Bundles"] article').length, 2)
    const search = document.querySelector('[aria-label="Available Bundles"] input[type=search]')
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, 'no match'); search.dispatchEvent(new Event('input', { bubbles: true })) })
    assert.equal(document.querySelectorAll('[aria-label="Available Bundles"] article').length, 0)
    assert.equal(document.querySelectorAll('[aria-label="Mounted Bundles"] article').length, 2, 'left search never hides mounted cards')
    assert.equal(document.querySelector('[aria-label="Mounted Bundles"] input[type=search]'), null)
    await f.click('Save')
    assert.deepEqual(mutation, { id: 'first', expectedRevision: 0, bundles: [{ name: 'observations', version: '1.0' }, { name: 'rules', version: '2.0' }] })
    assert.equal(button('Source Files').disabled, true)
    assert.equal(document.querySelector('[aria-label=Back]').disabled, true)
    await act(async () => finish())
    assert.equal(button('Mount management').getAttribute('aria-pressed'), 'true', 'saving stays on the current task tab')
    assert.equal(button('Save').disabled, true)
    await f.click('Source Files')
    assert.equal(document.querySelector('textarea[aria-label="mindset.md"]').value, '# Saved method')
    assert.equal(document.querySelector('.ygd-studio-file-info'), null)
  } finally { await f.close() }
})


test('unavailable mounted sources remain visible and cannot be silently dropped by saving another selection', async () => {
  const f = await mount(undefined, 'kit')
  const value = { ...record('first'), kind: 'kit', source: { kit: { name: 'evidence', version: '1.0' } },
    mounts: [{ bundle: { name: 'unavailable', version: '1.0' } }],
    availableBundles: [{ name: 'rules', version: '2.0', title: { zh: '规则', en: 'Rules' }, description: 'Concrete rules' }] }
  const mutations = []
  f.instances.read = async () => value
  f.instances.updateMounts = async request => { mutations.push(request); return { ...value, revision: 1, mounts: request.bundles.map(bundle => ({ bundle })) } }
  try {
    await f.click('Edit'); await f.click('Mount management'); await f.click('Add')
    assert.equal(document.querySelectorAll('[aria-label="Mounted Bundles"] article').length, 2)
    assert.match(document.querySelector('[aria-label="Mounted Bundles"]').textContent, /Source unavailable/)
    assert.equal(button('Save').disabled, false)
    await f.click('Save')
    assert.deepEqual(mutations, [{ id: 'first', expectedRevision: 0, bundles: [{ name: 'unavailable', version: '1.0' }, { name: 'rules', version: '2.0' }] }], 'unavailable existing mounts are preserved rather than forcing their removal')
  } finally { await f.close() }
})


test('library Edit keeps identity, replaces its catalog card and reopens the same current record', async () => {
  for (const kind of ['kit', 'bundle']) {
    const pin = { name: kind === 'kit' ? 'evidence' : 'observations', version: '1.0' }
    const entry = { ...pin, description: 'Current library item', title: { zh: '测试', en: 'Current library item' }, usedBy: [] }
    let stored
    const requests = [], copies = []
    const instances = {
      list: async () => stored ? [stored] : [],
      editCurrent: async input => { requests.push(input); stored ??= { ...record('current-item'), kind, current: true, [kind]: pin, source: { [kind]: pin } }; return stored },
      copy: async input => { copies.push(input); throw Error('Edit must not copy') },
    }
    const client = { workspace: async () => ({ kits: kind === 'kit' ? [entry] : [], bundles: kind === 'bundle' ? [entry] : [] }) }
    const controller = new StudioWorkspaceController(client); await controller.load(); controller.setSection(kind === 'kit' ? 'kits' : 'bundles')
    let editor
    const root = createRoot(document.getElementById('root'))
    try {
      await act(async () => root.render(React.createElement(StudioWorkspace, { client, controller, instances, locale: 'en', renderInstanceWorkbench: props => { editor = props; return React.createElement('main', null, props.id) } })))
      await act(async () => button('Edit').click())
      assert.equal(editor.id, 'current-item'); assert.deepEqual(requests, [{ kind, [kind]: pin }]); assert.deepEqual(copies, [])
      await act(async () => editor.onBack())
      assert.equal(document.querySelectorAll('.ygd-studio-kit-card').length, 1, 'current content replaces the installed card')
      assert.doesNotMatch(document.querySelector('.ygd-studio-kit-card').textContent, /unpublished|Version|copy it before editing/i)
      assert.equal(document.querySelector('.ygd-studio-version-picker'), null)
      await act(async () => button('Edit').click())
      assert.equal(editor.id, 'current-item'); assert.equal(requests.length, 1, 'reopening the known record needs no second materialization')
    } finally { await act(async () => root.unmount()) }
  }
})
