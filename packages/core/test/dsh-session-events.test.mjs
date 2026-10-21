import assert from 'node:assert/strict'
import test from 'node:test'
const { register } = await import('tsx/esm/api'); register()
const { designSessionEvents } = await import('../src/dsh-session-events.ts')

test('official snapshot accessor keeps inherited history and receiver binding', () => {
  const inherited = { type: 'user/message', seq: 0 }, own = { type: 'turn/start', seq: 1 }
  const session = {
    log: [inherited, own],
    snapshotEvents() { return Object.freeze([...this.log]) },
    ownEvents() { throw new Error('must not replace full history with child-only events') },
    get events() { throw new Error('legacy getter must not run on official host') },
  }
  assert.deepEqual(designSessionEvents(session), [inherited, own])
  const snapshot = designSessionEvents(session)
  session.log.push({ type: 'turn/end', seq: 2 })
  assert.equal(snapshot.length, 2)
  assert.equal(designSessionEvents(session).length, 3)
})

test('legacy events accessor remains supported without an ownEvents fallback', () => {
  const events = [{ type: 'turn/start' }]
  assert.equal(designSessionEvents({ events }), events)
  assert.throws(() => designSessionEvents({ ownEvents: () => [] }), /neither snapshotEvents\(\) nor events/)
})
