import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { NativeGitExecutor } from '../src/git-native-executor.ts'
import { nativeGitCancellation } from '../src/git-native-cancellation.ts'

class Thread extends EventEmitter {
  messages = []; referenced = false; terminations = 0
  postMessage(message) { this.messages.push(message) }
  ref() { this.referenced = true }
  unref() { this.referenced = false }
  async terminate() { this.terminations++; this.emit('exit', 0); return 0 }
  reply(value, message = this.messages.at(-1)) { this.emit('message', { type: 'result', id: message.id, value }) }
}
const request = (operation = { kind: 'head' }, signal) => ({ cwd: '/isolated/project', operation, signal })

test('one reusable thread preserves FIFO and snapshots inputs without holding idle process open', async () => {
  const thread = new Thread(); let created = 0
  const executor = new NativeGitExecutor(() => { created++; return thread })
  const op = { kind: 'entry', commit: 'a'.repeat(40), path: 'original' }
  const first = executor.execute(request()), second = executor.execute(request(op))
  op.path = 'mutated'
  assert.equal(thread.messages.length, 1)
  assert.equal(thread.referenced, true)
  thread.reply({ head: 'a'.repeat(40) })
  assert.equal((await first).value.head, 'a'.repeat(40))
  assert.equal(thread.messages.length, 2)
  assert.equal(thread.messages[1].operation.path, 'original')
  thread.reply({ entry: undefined })
  await second
  assert.equal(thread.referenced, false)
  const third = executor.execute(request())
  assert.equal(thread.referenced, true)
  thread.reply({ head: 'b'.repeat(40) })
  await third
  assert.equal(thread.referenced, false)
  assert.equal(created, 1)
  assert.equal(thread.terminations, 0)
  await executor.close()
  assert.equal(thread.terminations, 1)
})

test('queued cancellation never reaches worker or interrupts the independent active request', async () => {
  const thread = new Thread(), executor = new NativeGitExecutor(() => thread)
  const signal = new AbortController()
  const first = executor.execute(request()), second = executor.execute(request({ kind: 'head' }, signal.signal))
  const rejected = assert.rejects(second, /cancelled fixture/)
  signal.abort(new Error('cancelled fixture'))
  await rejected
  assert.equal(thread.messages.length, 1)
  assert.equal(thread.terminations, 0)
  thread.reply({ head: 'a'.repeat(40) }); await first
  await executor.close()
})

test('running cancellation retains ownership until settlement and preserves a late CAS receipt', async () => {
  const thread = new Thread(), executor = new NativeGitExecutor(() => thread)
  const signal = new AbortController()
  const first = executor.execute(request({ kind: 'publish', expectedHead: 'a'.repeat(40),
    message: 'exact', stagingRoot: '/isolated/stage', files: [] }, signal.signal))
  const second = executor.execute(request())
  signal.abort(new Error('user cancelled'))
  assert.equal(thread.messages.length, 1)
  assert.equal(Atomics.load(new Int32Array(thread.messages[0].cancelled), 0), 1)
  assert.equal(thread.terminations, 0)
  thread.reply({ commit: 'b'.repeat(40), change: 'changed' })
  assert.deepEqual(await first, { value: { commit: 'b'.repeat(40), change: 'changed' }, publicationScopeInvalidated: true })
  assert.equal(thread.messages.length, 2)
  thread.reply({ head: 'b'.repeat(40) }); await second
  await executor.close()
})

test('cancelled read is rejected only after settlement, without killing the following write', async () => {
  const thread = new Thread(), executor = new NativeGitExecutor(() => thread)
  const signal = new AbortController()
  const first = executor.execute(request({ kind: 'head' }, signal.signal))
  const rejected = assert.rejects(first, /cancelled read/)
  const second = executor.execute(request({ kind: 'publish', message: 'next', stagingRoot: '/stage', files: [] }))
  signal.abort(new Error('cancelled read'))
  assert.equal(thread.messages.length, 1)
  thread.reply({ head: 'a'.repeat(40) }); await rejected
  thread.reply({ commit: 'b'.repeat(40), change: 'changed' }); await second
  assert.equal(thread.terminations, 0)
  await executor.close()
})

test('disposal stops admission but waits for a running publication receipt before termination', async () => {
  const thread = new Thread(), executor = new NativeGitExecutor(() => thread)
  const first = executor.execute(request({ kind: 'publish', message: 'next', stagingRoot: '/stage', files: [] }))
  const closing = executor.close()
  assert.equal(thread.terminations, 0)
  await assert.rejects(executor.execute(request()), /executor has ended/)
  thread.reply({ commit: 'b'.repeat(40), change: 'changed' })
  assert.equal((await first).publicationScopeInvalidated, true)
  await closing
  assert.equal(thread.terminations, 1)
})

test('queue budget is bounded and failed or mismatched requests are never replayed', async () => {
  const thread = new Thread(), executor = new NativeGitExecutor(() => thread)
  await assert.rejects(executor.execute(request({ kind: 'publish', message: 'x'.repeat(8 << 20) })), /queue budget/)
  const pending = Array.from({ length: 128 }, () => executor.execute(request()))
  const rejected = Promise.all(pending.map(item => assert.rejects(item, /did not match/)))
  await assert.rejects(executor.execute(request()), /queue is full/)
  thread.emit('message', { type: 'result', id: 9999, value: {} })
  await rejected
  assert.equal(thread.messages.length, 1)
  assert.equal(thread.terminations, 1)
  await executor.close()
})

test('shared cancellation is observed synchronously at the implementation fence', () => {
  const flag = new Int32Array(new SharedArrayBuffer(4))
  const signal = nativeGitCancellation(flag)
  signal.throwIfAborted()
  Atomics.store(flag, 0, 1)
  assert.throws(() => signal.throwIfAborted(), { name: 'AbortError' })
  assert.equal(signal.aborted, true)
})

test('worker failures only surface the shared bounded error codes', async () => {
  const thread = new Thread(), executor = new NativeGitExecutor(() => thread)
  for (const failure of ['private-native-diagnostic', 'native-unavailable']) {
    const operation = executor.execute(request())
    const rejection = assert.rejects(operation, error => {
      assert.equal(error.message, `design git native: ${failure === 'native-unavailable' ? failure : 'native-operation-failed'}`)
      return true
    })
    thread.emit('message', { type: 'result', id: thread.messages.at(-1).id, failure })
    await rejection
  }
  await executor.close()
})

test('actual dispatch rechecks queued authority without replaying or poisoning unrelated requests', async () => {
  const thread = new Thread(), executor = new NativeGitExecutor(() => thread)
  let authorized = true, checks = 0
  const first = executor.execute(request())
  const second = executor.execute(request(), async () => { checks++; if (!authorized) throw Error('queued scope revoked') })
  const rejected = assert.rejects(second, /queued scope revoked/)
  const third = executor.execute(request())
  assert.equal(checks, 0)
  authorized = false
  thread.reply({ head: 'a'.repeat(40) }); await first; await rejected
  assert.equal(checks, 1)
  assert.equal(thread.messages.length, 2)
  assert.equal(thread.messages[1].id, 3)
  thread.reply({ head: 'b'.repeat(40) }); await third
  assert.equal(thread.terminations, 0)
  await executor.close()
})

test('an explicit null cancellation reason is retained for queued and running reads', async () => {
  const thread = new Thread(), executor = new NativeGitExecutor(() => thread)
  const active = new AbortController(), queued = new AbortController()
  const first = executor.execute(request({ kind: 'head' }, active.signal)).then(() => assert.fail('cancelled read succeeded'), error => assert.equal(error, null))
  const second = executor.execute(request({ kind: 'head' }, queued.signal)).then(() => assert.fail('cancelled queued read succeeded'), error => assert.equal(error, null))
  active.abort(null); queued.abort(null)
  thread.reply({ head: 'a'.repeat(40) })
  await Promise.all([first, second])
  assert.equal(thread.messages.length, 1)
  await executor.close()
})
