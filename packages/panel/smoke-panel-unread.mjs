import assert from 'node:assert/strict'
import { panelStore, resetPanelStore, selectTab, syncProjection, editDraft } from './src/client/store.ts'

const registry = { get: () => undefined }
const entry = (state, seq, origin = 'agent') => ({ state, origin,
  skillManifest: { presentation: { mode: 'auto' } },
  ...(seq === undefined ? {} : { changedSeq: seq }),
})
const snapshot = () => panelStore.getSnapshot()

resetPanelStore()
syncProjection({ a: entry({ x: 1, y: 2 }), b: entry({ value: 1 }) }, true, registry)
syncProjection({ a: entry({ y: 2, x: 1 }, 2), b: entry({ value: 1 }, 3) }, true, registry)
assert.deepEqual(snapshot().unread, {}, 'no-op publications or key reordering do not mark NEW')
assert.equal(snapshot().flash, undefined)
syncProjection({ a: entry({ x: 2, y: 2 }, 4), b: entry({ value: 2 }) }, true, registry)
assert.equal(snapshot().unread.b, true, 'all changed panels are detected, including those without a publication sequence')
assert.equal(snapshot().flash?.skill, 'a')
selectTab('b')
assert.equal(snapshot().unread.b, undefined)

// A graph/experience/picker view is not an acknowledgement of Design content.
syncProjection({ a: entry({ x: 2, y: 2 }), b: entry({ value: 3 }) }, false, registry)
assert.equal(snapshot().unread.b, true)
assert.equal(snapshot().flash, undefined)
selectTab('b')
assert.equal(snapshot().unread.b, true, 'selection while hidden does not acknowledge')
syncProjection({ a: entry({ x: 2, y: 2 }), b: entry({ value: 3 }) }, true, registry, undefined, {}, ['a'])
assert.equal(snapshot().unread.b, true, 'an A2UI waiting/error view does not acknowledge')
syncProjection({ a: entry({ x: 2, y: 2 }), b: entry({ value: 3 }) }, true, registry, undefined, {}, ['a', 'b'])
assert.equal(snapshot().unread.b, undefined, 'the ready visible panel acknowledges')

selectTab('a')
const files = { 'b/report.md': 'digest-1', 'a/a.json': 'canonical-digest-1' }
const sameProjection = { a: entry(snapshot().originals.a), b: entry(snapshot().originals.b) }
syncProjection(sameProjection, true, registry, undefined, files)
assert.equal(snapshot().unread.b, true, 'artifact-only updates are unread')
selectTab('b')
syncProjection({ a: entry({ x: 2, y: 2 }), b: entry({ value: 3 }) }, true, registry, undefined, { ...files, 'a/a.json': 'whitespace-only-digest' })
assert.deepEqual(snapshot().unread, {}, 'canonical JSON byte changes are not double counted')
syncProjection({ a: entry({ x: 2, y: 2 }), b: entry({ value: 3 }) }, true, registry, undefined, { 'a/a.json': 'canonical-digest-1' })
assert.equal(snapshot().flash?.skill, 'b', 'artifact deletion updates the visible panel')

editDraft('b', { value: 4 })
syncProjection({ a: entry({ x: 2, y: 2 }), b: entry({ value: 4 }, 10) }, true, registry)
const nonce = snapshot().flash?.nonce
syncProjection({ a: entry({ x: 2, y: 2 }), b: entry({ value: 5 }, 11, 'panel') }, true, registry)
assert.equal(snapshot().flash?.nonce, nonce, 'own saves do not flash or create unread updates')
selectTab('a')
syncProjection({ a: entry({ x: 2, y: 2 }), b: entry({ value: 6 }, 11, 'panel') }, true, registry)
assert.equal(snapshot().unread.b, true, 'a historical panel origin does not hide later live content updates')

resetPanelStore()
syncProjection({}, false, registry)
syncProjection({ first: entry({ value: 1 }) }, false, registry)
assert.equal(snapshot().unread.first, true, 'the first new live panel while hidden is unread')
syncProjection({ first: entry({ value: 1 }), second: entry({ value: 1 }) }, false, registry)
assert.equal(snapshot().unread.second, true, 'new tabs remain unread while the dock is closed')

// Simulate browser storage and a store remount; no Design File text is persisted.
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
resetPanelStore('project-A')
syncProjection({ a: entry({ secret: 'private design text' }), b: entry({ value: 1 }) }, true, registry)
syncProjection({ a: entry({ secret: 'private design text' }), b: entry({ value: 2 }) }, true, registry)
resetPanelStore('project-A')
syncProjection({ a: entry({ secret: 'private design text' }), b: entry({ value: 2 }) }, true, registry)
assert.equal(snapshot().unread.b, true, 'unread survives refresh/session switch within the same project')
assert.equal([...storage.values()].some(value => value.includes('private design text')), false)
resetPanelStore('project-B')
syncProjection({ a: entry({ value: 1 }), b: entry({ value: 2 }) }, true, registry)
assert.deepEqual(snapshot().unread, {}, 'project read receipts do not leak across projects')
resetPanelStore('project-A')
syncProjection({ a: entry({ secret: 'private design text' }), b: entry({ value: 3 }) }, true, registry)
assert.equal(snapshot().unread.b, true, 'changes while away are detected against saved content fingerprints')
selectTab('b')
resetPanelStore('project-A')
syncProjection({ a: entry({ secret: 'private design text' }), b: entry({ value: 3 }) }, false, registry)
assert.equal(snapshot().unread.b, undefined, 'acknowledgements survive refresh')
globalThis.localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') } }
resetPanelStore('project-C')
syncProjection({ a: entry({ value: 1 }) }, true, registry)
delete globalThis.localStorage
resetPanelStore()
console.log('PANEL UNREAD OK')
