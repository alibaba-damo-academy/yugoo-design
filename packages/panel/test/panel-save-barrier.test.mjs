import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { createPanelSaveBarrier } = await import('../src/panel-save-barrier.ts')

test('save waits for every editor and observes the serialized draft, with optional skill scope', async () => {
  const barrier = createPanelSaveBarrier()
  const draft = {}
  let release
  barrier.register('diagram', () => new Promise(resolve => { release = () => { draft.xml = 'last command'; resolve() } }))
  barrier.register('notes', async () => { draft.notes = 'text' })
  let saved = false
  const pending = barrier.flush('diagram').then(() => { assert.equal(draft.xml, 'last command'); saved = true })
  await Promise.resolve()
  assert.equal(saved, false)
  assert.equal(draft.notes, undefined)
  release()
  await pending
  await barrier.flush('notes')
  assert.equal(draft.notes, 'text')
})

test('a failing serialization waits for siblings before rejecting, without reporting success', async () => {
  const barrier = createPanelSaveBarrier()
  let release, finished = false
  barrier.register('a', () => { throw Error('export failed') })
  barrier.register('b', () => new Promise(resolve => { release = () => { finished = true; resolve() } }))
  const pending = barrier.flush()
  await Promise.resolve()
  assert.equal(finished, false)
  release()
  await assert.rejects(pending, /export failed/)
  assert.equal(finished, true)
})

test('effect unregister/register replay works; removed editors do not run', async () => {
  const barrier = createPanelSaveBarrier()
  let calls = 0
  const flush = async () => { calls++ }
  const remove = barrier.register('a', flush)
  remove(); remove()
  const replayRemove = barrier.register('a', flush)
  remove() // late duplicate cleanup must not unregister the replacement editor
  await barrier.flush()
  assert.equal(calls, 1)
  replayRemove()
  await barrier.flush()
  assert.equal(calls, 1)
})

test('disposing while serialization is pending invalidates the save', async () => {
  const barrier = createPanelSaveBarrier()
  let release
  barrier.register('a', () => new Promise(resolve => { release = resolve }))
  const pending = barrier.flush()
  await Promise.resolve()
  barrier.dispose()
  release()
  await assert.rejects(pending, /workspace changed/)
  await assert.rejects(barrier.flush(), /workspace changed/)
})

test('focused editor pending signals enable save without writing a draft and clear per registration', async () => {
  const barrier = createPanelSaveBarrier()
  let writes = 0, notifications = 0
  const unsubscribe = barrier.subscribe(() => { notifications++ })
  const first = barrier.register('diagram', async () => { writes++; first.setPending(false) })
  const second = barrier.register('diagram', async () => {})
  assert.equal(barrier.hasPendingChanges(), false)
  first.setPending(true); first.setPending(true)
  second.setPending(true)
  assert.equal(writes, 0, 'input notification does not serialize or mutate a draft')
  assert.equal(notifications, 2)
  await barrier.flush()
  assert.equal(writes, 1)
  assert.equal(barrier.hasPendingChanges(), true, 'another editor remains pending')
  second()
  assert.equal(barrier.hasPendingChanges(), false)
  first(); first.setPending(true)
  assert.equal(barrier.hasPendingChanges(), false, 'retired input cannot dirty the workspace')
  unsubscribe()
})

test('disposing clears pending editor signals and ignores stale input', () => {
  const barrier = createPanelSaveBarrier()
  const remove = barrier.register('diagram', async () => {})
  remove.setPending(true)
  barrier.dispose()
  assert.equal(barrier.hasPendingChanges(), false)
  remove.setPending(true)
  assert.equal(barrier.hasPendingChanges(), false)
})
