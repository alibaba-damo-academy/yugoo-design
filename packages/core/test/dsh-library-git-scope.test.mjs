/** Local scope/authority tests; not installed Desktop acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DshLibraryGitScope } from '../src/dsh-library-git-scope.ts'
import { openDshGitScope, runDshGitScope } from '../src/dsh-git-scope.ts'

function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const tick = () => new Promise(resolve => setImmediate(resolve))
const request = (operation = { kind: 'head' }, signal) => ({ cwd: '/local/project', operation, signal })
const publication = () => ({ kind: 'publish', expectedHead: 'a'.repeat(40), stagingRoot: '/stage', message: 'save', files: [] })

test('native admission never launches/resolves a host executable and rejects argv', async () => {
  let guards = 0
  const subprocess = new Proxy({}, { get() { assert.fail('must not consult subprocess') } })
  const scope = await openDshGitScope({ subprocess, root: '/local/project', signal: new AbortController().signal,
    assertScope: async () => { guards++ }, backend: 'native' })
  assert.ok(scope instanceof DshLibraryGitScope)
  assert.equal(guards, 1)
  await assert.rejects(scope.spawn({ cwd: '/local/project', argv: ['git', 'status'] }), /external command/)
  await scope.close()
})

test('each request keeps admission/start/post guards, immutable inputs and FIFO', async () => {
  const started = deferred(), release = deferred(), seen = []; let guards = 0
  const scope = new DshLibraryGitScope('/local/project', new AbortController().signal,
    async () => { guards++ }, undefined, async input => {
      seen.push(input.operation)
      if (seen.length === 1) { started.resolve(); await release.promise }
      return { value: input.operation }
    })
  const one = scope.spawn.native(request())
  const operation = { kind: 'entry', commit: 'a'.repeat(40), path: 'original' }
  const two = scope.spawn.native(request(operation)); operation.path = 'changed'
  await started.promise; await tick()
  assert.equal(seen.length, 1)
  release.resolve(); await Promise.all([one, two])
  assert.deepEqual(seen.map(value => value.kind), ['head', 'entry'])
  assert.equal(seen[1].path, 'original')
  assert.equal(guards, 6)
  await scope.close()
  await assert.rejects(scope.spawn.native(request()), /scope has ended/)
})

test('scope changes while queued reject before execution, and never replay through another executor', async () => {
  const entered = deferred(), release = deferred(); let valid = true, calls = 0
  const scope = new DshLibraryGitScope('/local/project', new AbortController().signal,
    async () => { if (!valid) throw Error('selection changed') }, undefined, async () => {
      calls++; entered.resolve(); await release.promise; return { value: { head: 'a'.repeat(40) } }
    })
  const first = assert.rejects(scope.spawn.native(request()), /selection changed/)
  const second = assert.rejects(scope.spawn.native(request()), /selection changed|scope has ended/)
  await entered.promise; valid = false; release.resolve()
  await Promise.all([first, second]); assert.equal(calls, 1)
  await scope.close()
})

test('cancelled publication keeps its late committed receipt while close joins only its scope', async () => {
  const entered = deferred(), release = deferred(), abort = new AbortController(); let workSignal
  const scope = new DshLibraryGitScope('/local/project', abort.signal, async () => {}, undefined, async ({ signal }) => {
    workSignal = signal; entered.resolve(); await release.promise
    return { value: { commit: 'b'.repeat(40), change: 'changed' } }
  })
  const pending = scope.spawn.native(request(publication()))
  await entered.promise
  abort.abort(Error('cancel save'))
  let closed = false
  const closing = scope.close().then(() => { closed = true })
  await tick(); assert.equal(closed, false); assert.equal(workSignal.aborted, true)
  release.resolve()
  assert.deepEqual(await pending, { value: { commit: 'b'.repeat(40), change: 'changed' }, publicationScopeInvalidated: true })
  await closing; assert.equal(closed, true)
})

test('one scoped abort never cancels another scope or claims an unconfirmed write as committed', async () => {
  const entered = deferred(), release = deferred(), abort = new AbortController()
  const signals = []
  const execute = async ({ signal }) => { signals.push(signal); entered.resolve(); await release.promise; return { value: {} } }
  const a = new DshLibraryGitScope('/local/project', abort.signal, async () => {}, undefined, execute)
  const b = new DshLibraryGitScope('/local/project', new AbortController().signal, async () => {}, undefined, execute)
  const first = assert.rejects(a.spawn.native(request(publication())), /one ended/)
  const second = b.spawn.native(request())
  await entered.promise; await tick(); abort.abort(Error('one ended'))
  assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false)
  release.resolve(); await first; assert.deepEqual(await second, { value: {} })
  await Promise.all([a.close(), b.close()])
})

test('wrong-root/oversized requests never reach execution and failed operations are not retried', async () => {
  let calls = 0
  const scope = new DshLibraryGitScope('/local/project', new AbortController().signal,
    async () => {}, undefined, async () => { calls++; throw Error('native unavailable') })
  await assert.rejects(scope.spawn.native({ ...request(), cwd: '/another/project' }), /escaped/)
  await assert.rejects(scope.spawn.native(request({ ...publication(), message: 'x'.repeat(8 << 20) })), /queue budget/)
  assert.equal(calls, 0)
  await assert.rejects(scope.spawn.native(request()), /native unavailable/)
  await assert.rejects(scope.spawn.native(request()), /scope has ended/)
  assert.equal(calls, 1); await scope.close()
})

test('run wrapper preserves a settled save independently of scope cleanup', async () => {
  const scope = new DshLibraryGitScope('/local/project', new AbortController().signal,
    async () => {}, undefined, async () => ({ value: { head: 'a'.repeat(40) } }))
  const result = await runDshGitScope(scope, () => scope.spawn.native(request()), () => assert.fail('unexpected cleanup failure'))
  assert.deepEqual(result, { value: { head: 'a'.repeat(40) } })
  await assert.rejects(scope.spawn.native(request()), /scope has ended/)
})
