import assert from 'node:assert/strict'
import { createPanelSessionAdapter, createPanelProjectFolderActions } from './src/client/session-controller-adapter.ts'

function observable(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish: next => {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

function binding(name) {
  const session = observable({ running: false })
  session.projections = { faceOf: key => observable(`${name}:${key}`) }
  session.prompt = async () => ({ ok: true, value: { accepted: true } })
  return { session }
}

const list = observable({ current: undefined })
const bindings = new Map()
const adapter = createPanelSessionAdapter({
  list,
  binding: id => bindings.get(id),
})

assert.deepEqual(adapter.source.getSnapshot(), { sessionId: undefined })
let notifications = 0
adapter.source.subscribe(() => { notifications += 1 })

const first = binding('first')
bindings.set('session-a', first)
list.publish({ current: 'session-a' })
assert.equal(notifications, 1)
assert.equal(adapter.source.getSnapshot().sessionId, 'session-a')
assert.equal(adapter.source.getSnapshot().hooks.session, first.session)
assert.equal(adapter.source.getSnapshot().projections, first.session.projections)

list.publish({ current: 'session-a' })
assert.equal(notifications, 1, 'an unchanged selected binding must retain its snapshot')

const replacement = binding('replacement')
bindings.set('session-a', replacement)
list.publish({ current: 'session-a' })
assert.equal(notifications, 2, 'a replacement binding for the selected id must publish')
assert.equal(adapter.source.getSnapshot().hooks.session, replacement.session)

list.publish({ current: undefined })
assert.equal(notifications, 3)
assert.deepEqual(adapter.source.getSnapshot(), { sessionId: undefined })

adapter.dispose()
list.publish({ current: 'session-a' })
assert.equal(notifications, 3, 'disposed adapters must stop publishing')

for (const host of ['Desktop 0.2.0-rc.2', 'Web public adapter.current']) {
// DSH 0.2 has a catalog without `current`; uiSession owns view selection.
const catalog = observable({ current: 'stale-legacy-session', ids: ['session-a', 'session-b'], byId: {}, phase: 'ready' })
const current = observable({ props: {} })
const modernBindings = new Map([['session-a', first], ['session-b', replacement]])
const uiSession = { adapter: { current }, get current() { throw new Error('private current must not be read') } }
const modern = createPanelSessionAdapter({ list: catalog, binding: id => modernBindings.get(id) }, uiSession.adapter.current)
assert.deepEqual(modern.source.getSnapshot(), { sessionId: undefined }, 'new source absence must not fall back to a stale legacy selection')
let modernNotifications = 0
modern.source.subscribe(() => { modernNotifications += 1 })
current.publish({ props: { sessionId: 'session-a' } })
assert.equal(modern.source.getSnapshot().hooks.session, first.session)
catalog.publish({ ids: ['session-a', 'session-b'], byId: {}, phase: 'ready' })
assert.equal(modernNotifications, 1, 'catalog updates do not change selection')
current.publish({ props: { sessionId: 'session-b' } })
assert.equal(modern.source.getSnapshot().sessionId, 'session-b')
assert.equal(modern.source.getSnapshot().hooks.session, replacement.session)
modernBindings.set('session-b', first)
catalog.publish({ ids: ['session-a', 'session-b'], byId: {}, phase: 'ready' })
assert.equal(modern.source.getSnapshot().hooks.session, first.session, 'catalog replacement refreshes selected binding')
current.publish({ props: {} })
assert.deepEqual(modern.source.getSnapshot(), { sessionId: undefined })
assert.equal(modernNotifications, 4)
modern.dispose()
current.publish({ props: { sessionId: 'session-a' } })
catalog.publish({ ids: [], byId: {}, phase: 'ready' })
assert.equal(modernNotifications, 4, 'dispose removes both subscriptions')
}
assert.deepEqual(createPanelProjectFolderActions(undefined), {})
assert.deepEqual(createPanelProjectFolderActions({ canOpenWorkspacePath: async () => ({ ok: true, value: true }) }), {})
const opened = []
const remote = {
  available: true,
  canOpenWorkspacePath: async function () { return { ok: true, value: this.available } },
  openWorkspacePath: async function (request) { assert.equal(this, remote); opened.push(request); return { ok: true, value: { opened: true } } },
}
const folders = createPanelProjectFolderActions(remote)
const exactPath = 'D:\\设计项目\\a & b (draft)'
assert.equal(await folders.canOpenProjectFolder(), true)
await folders.openProjectFolder(exactPath)
assert.deepEqual(opened, [{ path: exactPath }], 'native Host receives the exact project root, not a shell command, URL, reveal-parent action or workspace cwd')
remote.available = false
await assert.rejects(folders.openProjectFolder(exactPath), /cannot open/)
assert.equal(opened.length, 1)
await assert.rejects(folders.openProjectFolder(''), /cannot open/)
const refused = createPanelProjectFolderActions({
  canOpenWorkspacePath: async () => ({ ok: true, value: true }),
  openWorkspacePath: async () => ({ ok: false, error: { message: 'native denied' } }),
})
await assert.rejects(refused.openProjectFolder(exactPath), /native denied/)
console.log('SESSION CONTROLLER ADAPTER AND PROJECT FOLDER ACTION OK')
