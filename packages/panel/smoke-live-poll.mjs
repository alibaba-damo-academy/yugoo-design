import assert from 'node:assert/strict'

let nextTimer = 1
const timers = new Map()
const events = new Map()
globalThis.window = {
  setTimeout(callback) {
    const id = nextTimer++
    timers.set(id, callback)
    return id
  },
  clearTimeout(id) { timers.delete(id) },
  addEventListener(name, callback) { events.set(`window:${name}`, callback) },
  removeEventListener(name) { events.delete(`window:${name}`) },
}
globalThis.document = {
  visibilityState: 'visible',
  addEventListener(name, callback) { events.set(`document:${name}`, callback) },
  removeEventListener(name) { events.delete(`document:${name}`) },
}

const { livePollSubscriberCount, subscribeLivePoll } = await import('./src/client/live-poll.ts')
let left = 0
let right = 0
const stopLeft = subscribeLivePoll(() => { left += 1 })
const stopRight = subscribeLivePoll(() => { right += 1 })
assert.equal(livePollSubscriberCount(), 2)
assert.equal(timers.size, 1, 'all live projections share one recurring timer')

const first = timers.entries().next().value
timers.delete(first[0])
first[1]()
assert.deepEqual([left, right], [1, 1])
assert.equal(timers.size, 1, 'one shared timer rearms after a tick')

document.visibilityState = 'hidden'
events.get('document:visibilitychange')()
assert.equal(timers.size, 0, 'hidden pages keep no polling timer')

document.visibilityState = 'visible'
events.get('document:visibilitychange')()
events.get('window:focus')()
assert.equal(timers.size, 1, 'visibility and focus coalesce into one immediate refresh')

stopLeft()
assert.equal(livePollSubscriberCount(), 1)
assert.equal(timers.size, 1)
stopRight()
assert.equal(livePollSubscriberCount(), 0)
assert.equal(timers.size, 0, 'the final unsubscribe tears down polling')

console.log('shared live poll smoke test passed')
