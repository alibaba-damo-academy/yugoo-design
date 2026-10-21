import assert from 'node:assert/strict'
import test from 'node:test'
import { Duplex, PassThrough } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DshGitScope, gitChildEnvironment, runDshGitScope } from '../src/dsh-git-scope.ts'
import { GIT_WORKER_TIMING_FIELDS, gitWorkerTiming, nativeGitFailure, nativeGitOperation, readGitFrames, writeGitFrame, writeGitBytes } from '../src/dsh-git-protocol.ts'

function fixture(run, { empty = true, deadline = 200 } = {}) {
  const up = new PassThrough(), down = new PassThrough()
  const parent = Duplex.from({ readable: down, writable: up })
  const worker = Duplex.from({ readable: up, writable: down })
  let finish
  const done = new Promise(resolve => { finish = resolve })
  let terminated = 0, exitSignal
  const handle = {
    control: parent, done, collected: {},
    terminate() { terminated++; finish({ exitCode: 0, signal: null }) },
    async waitForExit(signal) { exitSignal = signal; return empty },
  }
  const abort = new AbortController()
  let authorized = true
  const scope = new DshGitScope(handle, '/repo', abort.signal, async () => {
    if (!authorized) throw new Error('scope-ended')
  }, deadline)
  const work = (async () => {
    await writeGitFrame(worker, { type: 'ready', version: 1 })
    for await (const frame of readGitFrames(worker)) {
      assert.equal(frame.kind, 'json')
      if (frame.value.type === 'close') {
        await writeGitFrame(worker, { type: 'closed' })
        worker.end(); finish({ exitCode: 0, signal: null }); continue
      }
      await run(frame.value, worker)
    }
  })().catch(() => {})
  return { scope, abort, work, get terminated() { return terminated }, get exitSignal() { return exitSignal },
    endAuthorization() { authorized = false },
    async dispose() { scope.stop(); await scope.close().catch(() => {}); worker.destroy(); parent.destroy(); await work },
  }
}

const request = (argv = ['git', 'rev-parse', 'HEAD'], rest = {}) => ({ argv, cwd: '/repo', ...rest })
const reply = (worker, id, stdout = '') => writeGitFrame(worker, { type: 'result', id, exitCode: 0, stdout, stderr: '' })
const nativeRequest = (operation = { kind: 'head' }, rest = {}) => ({ cwd: '/repo', operation, ...rest })
const nativeReply = (worker, id, value) => writeGitFrame(worker, { type: 'native-result', id, value })

test('native operations validate structured payloads and project only finite failures', () => {
  const commit = 'a'.repeat(40)
  for (const operation of [
    { kind: 'head' }, { kind: 'entry', commit, path: 'design_files/a.json' }, { kind: 'tree', commit },
    { kind: 'blob', oid: commit, size: 0 },
    { kind: 'message', commit },
    { kind: 'publish', expectedHead: commit, message: 'Save', stagingRoot: '/frozen', files: [
      { path: 'a.json', source: '/frozen/blob-0', oid: commit, mode: 0o100644 },
      { path: 'deleted.json', mode: 0o100755 },
    ] },
  ]) assert.deepEqual(nativeGitOperation(operation), operation)
  for (const operation of [null, [], { kind: 'run', argv: ['git'] }, { kind: 'entry', commit: 'HEAD', path: 'a' },
    { kind: 'message', commit: 'HEAD' }, { kind: 'latest-message', from: commit, marker: 'event:one' },
    { kind: 'blob', oid: commit, size: -1 }, { kind: 'blob', oid: commit, size: 1.1 },
    { kind: 'publish', expectedHead: commit, message: '', stagingRoot: '/frozen', files: [
      { path: 'a', source: '/frozen/blob-0', mode: 0o100644 },
    ] },
  ]) assert.throws(() => nativeGitOperation(operation))
  assert.equal(nativeGitFailure(Object.assign(new Error('SECRET'), { code: 'stale-publication' })), 'stale-publication')
  assert.equal(nativeGitFailure(Object.assign(new Error('SECRET'), { code: 'unsupported-history' })), 'unsupported-history')
  assert.equal(nativeGitFailure(Object.assign(new Error('SECRET'), { code: 'SECRET_CODE' })), 'native-operation-failed')
  const accessor = {}; Object.defineProperty(accessor, 'code', { get() { throw Error('must not run') } })
  assert.equal(nativeGitFailure(accessor), 'native-operation-failed')
})

test('native and CLI operations share FIFO and keep distinct typed results', async () => {
  const seen = []
  const f = fixture(async (message, worker) => {
    seen.push(message); await sleep(1)
    if (message.type === 'native') await nativeReply(worker, message.id, message.operation.kind === 'head' ? 'a'.repeat(40) : ['tree-entry'])
    else await reply(worker, message.id, 'cli')
  })
  try {
    await f.scope.start()
    const results = await Promise.all([
      f.scope.spawn.native(nativeRequest()), f.scope.spawn(request()),
      f.scope.spawn.native(nativeRequest({ kind: 'tree', commit: 'a'.repeat(40) })),
    ])
    assert.deepEqual(results, [{ value: 'a'.repeat(40) }, { exitCode: 0, stdout: 'cli', stderr: '' }, { value: ['tree-entry'] }])
    assert.deepEqual(seen.map(value => [value.type, value.id]), [['native', 1], ['run', 2], ['native', 3]])
    assert.equal(seen[0].argv, undefined); assert.equal(seen[0].env, undefined)
    await f.scope.close()
    await assert.rejects(f.scope.spawn.native(nativeRequest()), /scope has ended/)
  } finally { await f.dispose() }
})

test('native raw blobs use bounded byte frames and exact declared sizes', async () => {
  const bytes = Buffer.from([0, 255, 10, 128])
  for (const size of [bytes.length, bytes.length - 1, bytes.length + 1]) {
    const f = fixture(async (message, worker) => {
      await writeGitBytes(worker, message.id, bytes); await nativeReply(worker, message.id, null)
    })
    try {
      await f.scope.start()
      const result = f.scope.spawn.native(nativeRequest({ kind: 'blob', oid: 'a'.repeat(40), size }))
      if (size === bytes.length) assert.deepEqual(await result, { value: null, bytes })
      else await assert.rejects(result, /declared blob size|blob size mismatch/)
    } finally { await f.dispose() }
  }
})

test('native admission, finite failures and abort never replay a publication', async () => {
  for (const mode of ['wrong-root', 'ended', 'failure', 'abort']) {
    let calls = 0, admitted
    const called = new Promise(resolve => { admitted = resolve })
    const f = fixture(async (message, worker) => {
      calls++; admitted()
      if (mode === 'failure') await writeGitFrame(worker, { type: 'native-result', id: message.id, failure: 'stale-publication' })
      else await sleep(20)
    })
    try {
      await f.scope.start()
      if (mode === 'ended') f.endAuthorization()
      const pending = f.scope.spawn.native(nativeRequest(undefined, mode === 'wrong-root' ? { cwd: '/other' } : {}))
      if (mode === 'abort') { await called; f.abort.abort(new Error('cancelled-native')) }
      await assert.rejects(pending, mode === 'wrong-root' ? /escaped/ : mode === 'ended' ? /scope-ended/
        : mode === 'failure' ? /design git native: stale-publication/ : /cancelled-native/)
      assert.equal(calls, mode === 'wrong-root' || mode === 'ended' ? 0 : 1)
    } finally { await f.dispose() }
  }
})

test('native post-publication scope failure preserves only a confirmed commit receipt', async () => {
  for (const value of [{ commit: 'b'.repeat(40), change: 'changed' }, {},
    { commit: 'b'.repeat(40), change: 'unknown' }, { commit: 'HEAD', change: 'changed' }]) {
    let calls = 0
    const f = fixture(async (message, worker) => {
      calls++; f.endAuthorization()
      await nativeReply(worker, message.id, value)
    })
    try {
      await f.scope.start()
      const pending = f.scope.spawn.native(nativeRequest({ kind: 'publish', expectedHead: 'a'.repeat(40),
        message: 'Save', stagingRoot: '/frozen', files: [] }))
      if (value.change === 'changed' && value.commit === 'b'.repeat(40)) {
        assert.deepEqual(await pending, { value, publicationScopeInvalidated: true })
      } else await assert.rejects(pending, /scope-ended/)
      assert.equal(calls, 1)
      assert.ok(f.terminated > 0)
    } finally { await f.dispose() }
  }
})

test('a worker cannot claim the parent-only publication scope marker', async () => {
  const f = fixture(async (message, worker) => {
    await writeGitFrame(worker, { type: 'native-result', id: message.id,
      value: { head: 'a'.repeat(40) }, publicationScopeInvalidated: true })
  })
  try {
    await f.scope.start()
    assert.deepEqual(await f.scope.spawn.native(nativeRequest()), { value: { head: 'a'.repeat(40) } })
    await f.scope.close()
  } finally { await f.dispose() }
})

test('worker timing is a nonthrowing fixed-scalar projection, never another result validator', () => {
  const valid = Object.fromEntries(GIT_WORKER_TIMING_FIELDS.map((field, index) => [field, index]))
  const input = { ...valid, secretPath: '/PRIVATE', argv: ['PRIVATE'], toJSON() { throw Error('must not invoke') } }
  Object.defineProperty(input, 'privateGetter', { get() { throw Error('must not invoke') } })
  assert.deepEqual(gitWorkerTiming(input), valid)
  assert.deepEqual(gitWorkerTiming({ workerUntilReplyStartMs: 0 }), { workerUntilReplyStartMs: 0 })
  for (const field of GIT_WORKER_TIMING_FIELDS) {
    for (const value of [-1, NaN, Infinity, 0.1, 0x80000000, '1', null]) assert.equal(gitWorkerTiming({ ...valid, [field]: value }), undefined)
    const getter = { ...valid }; Object.defineProperty(getter, field, { get() { throw Error('known getter must not run') } })
    assert.equal(gitWorkerTiming(getter), undefined)
  }
  assert.equal(gitWorkerTiming({ workerSpawnReturnMs: 1 }), undefined)
  assert.equal(gitWorkerTiming({ workerUntilReplyStartMs: 1, workerCloseMs: 2 }), undefined)
  assert.equal(gitWorkerTiming(new Proxy({}, { getPrototypeOf() { throw Error('observer failed') } })), undefined)
})

test('Windows case-insensitive overrides and tombstones match the original environment contract', () => {
  assert.deepEqual(gitChildEnvironment({ Path: 'new', USER: undefined, GIT_INDEX_FILE: 'temporary' },
    { PATH: 'old', User: 'ambient', HOME: '/account' }, 'win32'),
  { HOME: '/account', Path: 'new', GIT_INDEX_FILE: 'temporary' })
  assert.deepEqual(gitChildEnvironment({ Path: 'new', USER: undefined }, { PATH: 'old', USER: 'ambient' }, 'linux'), { PATH: 'old', Path: 'new' })
})

test('concurrent commands preserve argv/cwd, distinct results and one-at-a-time execution', async () => {
  const seen = []
  const f = fixture(async (message, worker) => {
    seen.push(message)
    await sleep(1)
    await reply(worker, message.id, message.argv.at(-1))
  })
  try {
    await f.scope.start()
    const results = await Promise.all([
      f.scope.spawn(request(['git', 'show', 'one space'])),
      f.scope.spawn(request(['git', 'show', 'two"quotes'], { env: { GIT_INDEX_FILE: '/private/index' } })),
    ])
    assert.deepEqual(results.map(value => value.stdout), ['one space', 'two"quotes'])
    assert.deepEqual(seen.map(value => value.cwd), ['/repo', '/repo'])
    assert.equal(seen[0].env.GIT_INDEX_FILE, undefined)
    assert.equal(seen[1].env.GIT_INDEX_FILE, '/private/index')
    await f.scope.close()
    await assert.rejects(f.scope.spawn(request()), /scope has ended/)
    assert.equal(f.exitSignal.aborted, false)
  } finally { await f.dispose() }
})

test('text tail semantics retain a split multibyte character and invalid UTF-8 replacement bytes', async () => {
  for (const raw of [Buffer.from('中'.repeat(349526)).subarray(-(1 << 20)), Buffer.alloc(1 << 20, 0xff)]) {
    const text = raw.toString('utf8')
    const f = fixture((message, worker) => reply(worker, message.id, text))
    try {
      await f.scope.start()
      assert.equal((await f.scope.spawn(request())).stdout, text)
      await f.scope.close()
    } finally { await f.dispose() }
  }
})

test('binary stdout remains exact and rejects before retaining more than its declared size', async () => {
  const data = Buffer.from([0, 255, 10, 128])
  for (const maxBytes of [4, 3]) {
    const f = fixture(async (message, worker) => {
      await writeGitBytes(worker, message.id, data)
      await reply(worker, message.id)
    })
    try {
      await f.scope.start()
      const pending = f.scope.spawn(request(['git', 'cat-file', 'blob', 'oid'], { binaryStdout: { maxBytes } }))
      if (maxBytes === 4) assert.deepEqual(Buffer.from((await pending).stdoutBytes), data)
      else await assert.rejects(pending, /declared blob size/)
    } finally { await f.dispose() }
  }
})

test('missing ACK rejects once, terminates and never replays the update-ref command', async () => {
  let calls = 0
  const f = fixture(async (_message, worker) => { calls++; worker.destroy() })
  try {
    await f.scope.start()
    await assert.rejects(f.scope.spawn(request(['git', 'update-ref', 'HEAD', 'new', 'old'])))
    assert.equal(calls, 1)
    assert.ok(f.terminated > 0)
  } finally { await f.dispose() }
})

test('operation abort rejects an in-flight request and cleanup uses an independent signal', async () => {
  let admitted
  const called = new Promise(resolve => { admitted = resolve })
  const f = fixture(async () => { admitted(); await sleep(20) })
  try {
    await f.scope.start()
    const pending = f.scope.spawn(request())
    await called
    f.abort.abort(new Error('cancelled'))
    await assert.rejects(pending, /cancelled/)
    await f.scope.close()
    assert.equal(f.exitSignal.aborted, false)
    assert.ok(f.terminated > 0)
  } finally { await f.dispose() }
})

test('close bounds an unfinished queue and still terminates and observes the range', async () => {
  let admitted
  const called = new Promise(resolve => { admitted = resolve })
  const f = fixture(async () => { admitted(); await sleep(100) }, { deadline: 15 })
  try {
    await f.scope.start()
    const pending = f.scope.spawn(request())
    void pending.catch(() => {})
    await called
    await assert.rejects(f.scope.close(), /drain timed out/)
    await assert.rejects(pending, /drain timed out/)
    assert.ok(f.terminated > 0)
    assert.equal(f.exitSignal.aborted, false)
  } finally { await f.dispose() }
})

test('cleanup rejection cannot replace a known commit, settlement error or its recovery receipt', async () => {
  const receipt = { commit: 'known-commit' }, failure = Object.assign(new Error('settlement failed'), { result: receipt })
  for (const original of [undefined, failure]) {
    let stops = 0
    const scope = { stop(reason) { assert.equal(reason, failure); stops++ }, async close() { throw new Error('unknown range') } }
    let publications = 0
    const operation = () => { publications++; return original === undefined ? Promise.resolve(receipt) : Promise.reject(original) }
    const run = runDshGitScope(scope, operation, () => { throw new Error('logger failure') })
    if (original === undefined) assert.equal(await run, receipt)
    else await assert.rejects(run, error => error === failure && error.result === receipt)
    assert.equal(stops, original === undefined ? 0 : 1)
    assert.equal(publications, 1, 'cleanup failure never replays a publication')
  }
})

test('the authority guard rejects captured calls before executing Git', async () => {
  let calls = 0
  const f = fixture(async (message, worker) => { calls++; await reply(worker, message.id) })
  try {
    await f.scope.start()
    f.endAuthorization()
    await assert.rejects(f.scope.spawn(request()), /scope-ended/)
    assert.equal(calls, 0)
  } finally { await f.dispose() }
})

test('an explicit null cancellation reason is preserved and never reported as a successful result', async () => {
  let admitted
  const called = new Promise(resolve => { admitted = resolve })
  const f = fixture(async () => { admitted(); await sleep(20) })
  try {
    await f.scope.start()
    const pending = f.scope.spawn(request())
    await called
    f.abort.abort(null)
    await pending.then(() => assert.fail('cancelled call must reject'), error => assert.equal(error, null))
    await f.scope.close()
  } finally { await f.dispose() }
})

test('corrupt, oversized and truncated frames reject before an unbounded payload is retained', async () => {
  const header = (kind, length) => { const bytes = Buffer.alloc(5); bytes[0] = kind; bytes.writeUInt32BE(length, 1); return bytes }
  for (const bytes of [header(0, (8 << 20) + 1), header(2, 0), header(1, (64 << 10) + 5), Buffer.concat([header(0, 4), Buffer.from('{}')])]) {
    await assert.rejects(async () => { for await (const _frame of readGitFrames((async function* () { yield bytes })())) assert.fail('invalid frame') })
  }
})

test('opted-in scoped timing correlates actual wire ids and wall phases without changing FIFO, failure or cleanup', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { Writable, Duplex, PassThrough } from 'node:stream';
    import { setTimeout as sleep } from 'node:timers/promises';
    import { DshGitScope } from './packages/core/src/dsh-git-scope.ts';
    import { readGitFrames, writeGitFrame } from './packages/core/src/dsh-git-protocol.ts';
    const records = [], original = Object.getOwnPropertyDescriptor(process, 'stdout');
    const output = new Writable({ write(bytes, _encoding, done) { records.push(JSON.parse(bytes)); done(); } });
    Object.defineProperty(process, 'stdout', { value: output, configurable: true });
    async function fixture(id, range = true, failureAt) {
      const up = new PassThrough(), down = new PassThrough();
      const parent = Duplex.from({ readable: down, writable: up }), worker = Duplex.from({ readable: up, writable: down });
      let finish, guards = 0, waits = 0;
      const done = new Promise(resolve => { finish = resolve; }), error = new Error('SECRET_GUARD');
      const handle = { control: parent, done, collected: {}, terminate() { finish({ exitCode: 0, signal: null }); },
        async waitForExit(signal) { waits++; assert.equal(signal.aborted, false); await sleep(8); return range; } };
      const scope = new DshGitScope(handle, '/SECRET_PATH', new AbortController().signal, async () => {
        await sleep(12); if (++guards === failureAt) throw error;
      }, 200, id);
      const work = (async () => {
        await writeGitFrame(worker, { type: 'ready', version: 1 });
        for await (const frame of readGitFrames(worker)) {
          if (frame.value.type === 'close') { await writeGitFrame(worker, { type: 'closed' }); worker.end(); finish({ exitCode: 0, signal: null }); continue; }
          await sleep(15); await writeGitFrame(worker, { type: 'result', id: frame.value.id, exitCode: 0, stdout: 'SECRET_OUTPUT', stderr: '' });
        }
      })().catch(() => {});
      await scope.start();
      return { scope, error, waits: () => waits, async dispose() { scope.stop(); await scope.close().catch(() => {}); worker.destroy(); parent.destroy(); await work; } };
    }
    const request = { argv: ['git', 'status', 'SECRET_ARG'], cwd: '/SECRET_PATH', env: { SECRET_KEY: 'SECRET' } };
    const good = await fixture(91);
    try {
      assert.deepEqual((await Promise.all([good.scope.spawn(request), good.scope.spawn(request)])).map(row => row.stdout), ['SECRET_OUTPUT', 'SECRET_OUTPUT']);
      await good.scope.close(); await good.scope.close(); assert.equal(good.waits(), 1);
      await assert.rejects(good.scope.spawn(request), /scope has ended/);
    } finally { await good.dispose(); }
    for (const failureAt of [1, 2]) {
      const f = await fixture(91 + failureAt, false, failureAt);
      try {
        await assert.rejects(f.scope.spawn(request), error => error === f.error);
        await assert.rejects(f.scope.close(), /range exit was not confirmed/);
      } finally { await f.dispose(); }
    }
    const git = records.filter(row => row.tag === 'yugoo-git' && row.scopeId === 91);
    assert.equal(git.length, 3); assert.deepEqual(git.slice(0, 2).map(row => row.sequence), [1, 2]);
    for (const row of git.slice(0, 2)) {
      assert.equal(row.route, 'scoped-native'); assert.equal(row.operation, 'status'); assert.equal(row.completed, true);
      assert.equal(row.exitCode, 0); assert.equal(row.totalMs, row.elapsedMs);
      assert(row.preGuardMs >= 8 && row.requestRttMs >= 10 && row.postGuardMs >= 8);
      assert(row.totalMs >= row.requestRttMs);
    }
    assert(git[1].queueMs >= 20); assert.equal(git[2].completed, false);
    for (const field of ['sequence', 'queueMs', 'preGuardMs', 'requestRttMs', 'postGuardMs']) assert.equal(git[2][field], undefined);
    const beforeWire = records.find(row => row.tag === 'yugoo-git' && row.scopeId === 92);
    assert.equal(beforeWire.sequence, undefined); assert.equal(beforeWire.requestRttMs, undefined); assert.equal(beforeWire.postGuardMs, undefined);
    const afterWire = records.find(row => row.tag === 'yugoo-git' && row.scopeId === 93);
    assert.equal(afterWire.sequence, 1); assert.equal(afterWire.exitCode, 0); assert.equal(afterWire.completed, false);
    assert(afterWire.requestRttMs >= 10 && afterWire.postGuardMs >= 8);
    const ranges = records.filter(row => row.phase === 'range-end');
    assert.deepEqual(ranges.map(row => row.rangeConfirmed), [true, false, false, false]);
    assert.deepEqual(ranges.map(row => row.rangeOutcome), ['confirmed', 'not-confirmed', 'not-confirmed', 'not-confirmed']);
    assert.deepEqual(records.filter(row => row.phase === 'close-ack').map(row => row.scopeId), [91, 92]);
    // The pre-guard failure still sends/receives close, but that ACK cannot certify range exit.
    assert.equal(records.find(row => row.phase === 'range-end' && row.scopeId === 92).rangeConfirmed, false);
    assert.equal(records.filter(row => row.phase === 'close-start' && row.scopeId === 91).length, 1);
    assert.doesNotMatch(JSON.stringify(records), /SECRET|argv|env|path|error|cpu/i);
    Object.defineProperty(process, 'stdout', original); output.destroy();
    console.log(JSON.stringify({ records: records.length, wireIds: git.slice(0, 2).map(row => row.sequence), preserved: true }));
  `
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)), env: { ...process.env, YUGOO_DSH_TIMING_DIAGNOSTICS: '1' },
    encoding: 'utf8', timeout: 30000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).wireIds, [1, 2])
  assert.equal(JSON.parse(result.stdout).preserved, true)
})

/** Separate ACK, direct outcome and managed-range evidence; neither can synthesize the other. */
async function closeFixture({ budget = 120, ack = true, range, onTerminate } = {}) {
  const up = new PassThrough(), down = new PassThrough()
  const parent = Duplex.from({ readable: down, writable: up }), worker = Duplex.from({ readable: up, writable: down })
  let resolveDone, rejectDone, acknowledge, enteredRange, terminated = 0
  const done = new Promise((yes, no) => { resolveDone = yes; rejectDone = no })
  const acknowledged = new Promise(resolve => { acknowledge = resolve })
  const rangeEntered = new Promise(resolve => { enteredRange = resolve }), waits = [], caller = new AbortController()
  const scope = new DshGitScope({ control: parent, collected: {}, done,
    terminate() { terminated++; onTerminate?.(); },
    waitForExit(signal) { waits.push(signal); enteredRange(); return range?.(signal, waits.length) ?? Promise.resolve(true) },
  }, '/repo', caller.signal, async () => {}, budget)
  const work = (async () => {
    await writeGitFrame(worker, { type: 'ready', version: 1 })
    for await (const frame of readGitFrames(worker)) {
      if (frame.value.type !== 'close') { await reply(worker, frame.value.id, 'committed'); continue }
      if (!ack) continue
      await writeGitFrame(worker, { type: 'closed' }); acknowledge(); worker.end()
    }
  })().catch(() => {})
  await scope.start()
  return { scope, caller, waits, acknowledged, rangeEntered, resolveDone, rejectDone, get terminated() { return terminated },
    async dispose() { scope.stop(); await scope.close().catch(() => {}); worker.destroy(); parent.destroy(); await work },
  }
}

test('ACK precedes delayed direct+range settlement; graceful close never sends the destructive early terminate', async () => {
  let resolveRange, rejectRange
  const range = new Promise((yes, no) => { resolveRange = yes; rejectRange = no })
  const f = await closeFixture({ budget: 300, range: () => range, onTerminate: () => rejectRange(Error('early terminate destroyed observation')) })
  try {
    const closing = f.scope.close(); await f.acknowledged; await f.rangeEntered
    assert.equal(f.terminated, 0); assert.equal(f.waits.length, 1)
    assert.notEqual(f.waits[0], f.caller.signal); assert.equal(f.waits[0].aborted, false)
    let closed = false; closing.then(() => { closed = true })
    f.resolveDone({ exitCode: 0, signal: null }); await sleep(15)
    assert.equal(closed, false, 'direct done cannot replace range emptiness')
    resolveRange(true); await closing; assert.equal(f.terminated, 0)
    assert.equal(f.scope.close(), closing)
  } finally { await f.dispose() }
})

test('done exit 0 cannot turn false or rejected range observation into cleanup success', async () => {
  for (const mode of ['false', 'reject']) {
    const failure = Error('private range failure')
    const f = await closeFixture({ range: () => mode === 'false' ? Promise.resolve(false) : Promise.reject(failure) })
    try {
      f.resolveDone({ exitCode: 0, signal: null })
      await assert.rejects(f.scope.close(), error => mode === 'false' ? /not confirmed/.test(String(error)) : error === failure)
      assert.ok(f.terminated > 0); assert.equal(f.waits.length, 2)
      assert.notEqual(f.waits[0], f.waits[1]); assert.notEqual(f.waits[1], f.caller.signal)
    } finally { await f.dispose() }
  }
})

test('the range is observed while direct done is pending, and an ignoring provider is bounded by one total budget', async () => {
  const f = await closeFixture({ budget: 60, range: () => new Promise(() => {}) })
  try {
    const started = performance.now(), closing = f.scope.close()
    await f.rangeEntered; assert.equal(f.terminated, 0)
    await assert.rejects(closing, /timed out/)
    assert(performance.now() - started < 250, 'no sequential unbounded done or provider wait')
    assert.ok(f.terminated > 0); assert.equal(f.waits.length, 2)
    assert(f.waits.every(signal => signal.aborted)); assert.notEqual(f.waits[0], f.waits[1])
  } finally { await f.dispose() }
})

test('missing close ACK, abnormal exit and rejected direct outcome escalate then independently confirm range', async () => {
  for (const mode of ['no-ack', 'exit', 'reject']) {
    const failure = Error('direct failure')
    const f = await closeFixture({ budget: 80, ack: mode !== 'no-ack' })
    try {
      const closing = f.scope.close()
      if (mode !== 'no-ack') await f.acknowledged
      if (mode === 'exit') f.resolveDone({ exitCode: 1, signal: null })
      if (mode === 'reject') f.rejectDone(failure)
      await assert.rejects(closing, error => mode === 'reject' ? error === failure : /worker close timed out|exited abnormally/.test(String(error)))
      assert.ok(f.terminated > 0); assert(f.waits.length >= 1)
      assert(f.waits.every(signal => signal !== f.caller.signal))
    } finally { await f.dispose() }
  }
})

test('caller abort after ACK escalates immediately and uses a fresh non-caller bound for range observation', async () => {
  const failure = Error('cancel after ACK')
  const f = await closeFixture({ range: (_signal, attempt) => attempt === 1 ? new Promise(() => {}) : Promise.resolve(true) })
  try {
    const closing = f.scope.close(); await f.rangeEntered
    f.caller.abort(failure)
    await assert.rejects(closing, error => error === failure)
    assert.ok(f.terminated > 0); assert.equal(f.waits.length, 2)
    assert.notEqual(f.waits[1], f.caller.signal)
  } finally { await f.dispose() }
})

test('worker metrics require this pending opt-in; invalid observations never replace Git outcomes or invent negative residuals', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { Writable, Duplex, PassThrough } from 'node:stream';
    import { setTimeout as sleep } from 'node:timers/promises';
    import { DshGitScope } from './packages/core/src/dsh-git-scope.ts';
    import { GIT_WORKER_TIMING_FIELDS, readGitFrames, writeGitFrame } from './packages/core/src/dsh-git-protocol.ts';
    const enabled = process.env.YUGOO_DSH_TIMING_DIAGNOSTICS === '1', records = [], seen = [];
    const original = Object.getOwnPropertyDescriptor(process, 'stdout');
    const output = new Writable({ write(bytes, _encoding, done) { records.push(JSON.parse(bytes)); done(); } });
    Object.defineProperty(process, 'stdout', { value: output, configurable: true });
    const up = new PassThrough(), down = new PassThrough();
    const parent = Duplex.from({ readable: down, writable: up }), worker = Duplex.from({ readable: up, writable: down });
    let finish; const done = new Promise(resolve => { finish = resolve; });
    const scope = new DshGitScope({ control: parent, collected: {}, done,
      terminate() { finish({ exitCode: 0, signal: null }); }, async waitForExit() { return true; }
    }, '/PRIVATE_ROOT', new AbortController().signal, async () => {}, 200, 123);
    const responses = [
      { workerUntilReplyStartMs: 1, workerSpawnReturnMs: 0, PRIVATE: 'never log this', argv: ['PRIVATE'] },
      { workerUntilReplyStartMs: 1, workerSpawnReturnMs: -1 },
      { workerUntilReplyStartMs: 2147483647 },
      { workerUntilReplyStartMs: 0 },
    ];
    const work = (async () => {
      await writeGitFrame(worker, { type: 'ready', version: 1 });
      for await (const frame of readGitFrames(worker)) {
        if (frame.value.type === 'close') { await writeGitFrame(worker, { type: 'closed' }); worker.end(); finish({ exitCode: 0, signal: null }); continue; }
        seen.push(frame.value.timing); await sleep(4);
        const result = frame.value.id === 4 ? { failure: 'execution-failed' } : { exitCode: 0, stdout: 'retained', stderr: '' };
        await writeGitFrame(worker, { type: 'result', id: frame.value.id, ...result, timing: responses[frame.value.id - 1] });
      }
    })().catch(() => {});
    try {
      await scope.start();
      for (let i = 0; i < 3; i++) assert.deepEqual(await scope.spawn({ argv: ['git', 'status'], cwd: '/PRIVATE_ROOT' }), { exitCode: 0, stdout: 'retained', stderr: '' });
      await assert.rejects(scope.spawn({ argv: ['git', 'status'], cwd: '/PRIVATE_ROOT' }), /worker command failed/);
      await scope.close();
      assert.deepEqual(seen, Array(4).fill(enabled ? true : undefined));
      const git = records.filter(row => row.tag === 'yugoo-git');
      if (enabled) {
        assert.equal(git.length, 4); assert.equal(git[0].workerSpawnReturnMs, 0);
        assert.equal(git[0].wireParentResidualMs, git[0].requestRttMs - 1);
        for (const field of [...GIT_WORKER_TIMING_FIELDS, 'wireParentResidualMs']) assert.equal(git[1][field], undefined);
        assert.equal(git[2].workerUntilReplyStartMs, 2147483647); assert.equal(git[2].wireParentResidualMs, undefined);
        assert.equal(git[3].completed, false); assert.equal(git[3].workerUntilReplyStartMs, 0);
        assert.doesNotMatch(JSON.stringify(records), /PRIVATE|argv|env|path|error|cpu/i);
      } else assert.deepEqual(records, []);
    } finally { scope.stop(); await scope.close().catch(() => {}); worker.destroy(); parent.destroy(); await work; Object.defineProperty(process, 'stdout', original); output.destroy(); }
    console.log('worker timing boundary preserved');
  `
  for (const flag of ['0', '1']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)), env: { ...process.env, YUGOO_DSH_TIMING_DIAGNOSTICS: flag },
      encoding: 'utf8', timeout: 30000,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'worker timing boundary preserved')
  }
})
