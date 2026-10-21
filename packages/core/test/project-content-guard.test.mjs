import test from 'node:test'
import assert from 'node:assert/strict'
import { ProjectContentPanelGuard } from '../lib/index.js'

test('a displayed Panel without an actual controls observation blocks adoption', () => {
  const guard = new ProjectContentPanelGuard('project')
  guard.observe({ projectId: 'project', pageId: '11111111-1111-4111-8111-111111111111', sequence: 1, dirty: false, saving: false, lifecycle: 'opened' })
  assert.throws(() => guard.assertQuiescent(), /missing/)
})

test('clean page lifecycle retires pages; unknown/dirty closure never grants upgrade and explicit discard is CAS fenced', () => {
  let time = 0
  const guard = new ProjectContentPanelGuard('project', 1000, () => time)
  guard.assertQuiescent() // A model status read without a browser creates no page.
  const page = { projectId: 'project', pageId: '11111111-1111-4111-8111-111111111111', dirty: false, saving: false }
  for (let i = 0; i < 80; i++) {
    guard.observe({ ...page, sequence: i * 3 + 1, lifecycle: 'opened' })
    assert.throws(() => guard.assertQuiescent(), /missing/)
    guard.observe({ ...page, sequence: i * 3 + 2 }); guard.assertQuiescent()
    guard.observe({ ...page, sequence: i * 3 + 3, lifecycle: 'closed' })
    time += 1001; guard.assertQuiescent()
  }
  guard.observe({ ...page, sequence: 241, dirty: true })
  assert.throws(() => guard.observe({ ...page, sequence: 242, lifecycle: 'closed' }), /cannot discard/)
  time += 1001
  const stale = guard.disconnected(); assert.equal(stale.length, 1)
  assert.throws(() => guard.assertQuiescent(), /disconnected/)
  guard.observe({ ...page, sequence: 243, dirty: true })
  assert.throws(() => guard.discardDisconnected(stale), /changed/)
  assert.throws(() => guard.assertQuiescent(), /draft/)
  time += 1001; guard.discardDisconnected(guard.disconnected()); guard.assertQuiescent()
  assert.throws(() => guard.observe({ ...page, sequence: 243 }), /stale/, 'a delayed heartbeat cannot resurrect a discarded page')
})

test('all Panel pages must have fresh clean observations; expiry never means saved', () => {
  let time = 100
  const guard = new ProjectContentPanelGuard('project', 1000, () => time)
  const page = { projectId: 'project', pageId: '11111111-1111-4111-8111-111111111111', sequence: 1, dirty: false, saving: false }
  guard.observe(page); guard.assertQuiescent()
  assert.throws(() => guard.observe({ ...page, projectId: 'other' }), /bound Panel/)
  assert.throws(() => guard.observe(page), /stale/)
  guard.observe({ ...page, sequence: 2, dirty: true })
  guard.observe({ ...page, pageId: '22222222-2222-4222-8222-222222222222' })
  assert.throws(() => guard.assertQuiescent(), /every Panel draft/)
  guard.observe({ ...page, sequence: 3, saving: true })
  assert.throws(() => guard.assertQuiescent(), /every Panel draft/)
  guard.observe({ ...page, sequence: 4 }); guard.assertQuiescent()
  time += 1001
  assert.throws(() => guard.assertQuiescent(), /disconnected/)
  guard.observe({ ...page, sequence: 5 })
  assert.throws(() => guard.assertQuiescent(), /disconnected/, 'one reconnected page cannot clear another unknown page')
})
