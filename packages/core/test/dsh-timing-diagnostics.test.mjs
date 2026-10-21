/** Isolated streams and scripted producer calls, never a running Host. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Writable } from 'node:stream'
import { once } from 'node:events'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createDshTimingDiagnostics } from '../src/dsh-timing-diagnostics.ts'
import { GIT_WORKER_TIMING_FIELDS } from '../src/dsh-git-protocol.ts'

const panel = { tag: 'yugoo-panel-save', phase: 'request', at: '2026-10-15T16:00:00.000Z', elapsedMs: 1 }
const git = { tag: 'yugoo-git', operation: 'cat-file', at: panel.at, elapsedMs: 2, spawnMs: 1,
  exitCode: 0, completed: true, cancelled: false }
const tick = () => new Promise(resolve => setImmediate(resolve))

function fixture(t, options = {}) {
  const lines = []
  const output = new Writable({ highWaterMark: 1 << 22, write(chunk, _encoding, done) { lines.push(chunk.toString()); done() } })
  const sink = createDshTimingDiagnostics({ enabled: true, output, ...options })
  t.after(() => { sink.stop(); output.destroy() })
  return { output, sink, lines, records: () => lines.map(line => JSON.parse(line)) }
}

test('default-disabled factory touches neither records nor output listeners', t => {
  const f = fixture(t, { enabled: false })
  f.sink.emit(new Proxy({}, { getOwnPropertyDescriptor() { throw Error('must not inspect') } }))
  f.sink.emit(panel)
  assert.deepEqual(f.lines, [])
  assert.equal(f.output.listenerCount('error'), 0)
  assert.equal(f.output.listenerCount('drain'), 0)
})

test('both schemas copy only enumerated scalars, without invoking unrelated getters or toJSON', t => {
  const f = fixture(t)
  const privateFields = { session: 'SECRET_SESSION', skill: 'SECRET_SKILL', path: 'SECRET_PATH',
    argv: ['SECRET_ARG'], env: { SECRET_KEY: 'SECRET' }, error: 'SECRET_ERROR', rawlogger: 'SECRET_LOG' }
  const input = { ...panel, ...privateFields, toJSON() { throw Error('must not call toJSON') } }
  Object.defineProperty(input, 'privateGetter', { enumerable: true, get() { throw Error('must not read') } })
  f.sink.emit(input)
  f.sink.emit({ ...git, ...privateFields })
  assert.deepEqual(f.records(), [panel, git])
  assert.doesNotMatch(f.lines.join(''), /SECRET|session|skill|path|argv|env|error|rawlogger/)
  assert.ok(f.lines.every(line => line.endsWith('\n') && line.split('\n').length === 2))
})

test('unknown tags/phases/operations and invalid scalar fields are dropped', t => {
  const f = fixture(t)
  for (const record of [null, [], 'raw logger text', { ...panel, tag: 'unrelated' },
    { ...panel, phase: 'SECRET' }, { ...git, operation: 'SECRET' },
    ...[-1, NaN, Infinity, 0.2, 0x80000000, '1'].map(elapsedMs => ({ ...panel, elapsedMs })),
    { ...panel, at: '2026-02-30T00:00:00.000Z' }, { ...panel, at: '2026-10-15T16:00:00Z' },
    { ...git, exitCode: '0' }, { ...git, spawnMs: -1 }, { ...git, completed: 1 },
    { ...git, cancelled: 'false' }, Object.assign(Object.create({}), panel)]) f.sink.emit(record)
  const getter = { ...panel }
  Object.defineProperty(getter, 'phase', { get() { throw Error('must not read') } })
  f.sink.emit(getter)
  assert.deepEqual(f.lines, [])
  f.sink.emit({ ...git, exitCode: null })
  assert.equal(f.records()[0].exitCode, null)
})

test('unknown-field proxies cannot throw through the caller', t => {
  const f = fixture(t)
  assert.doesNotThrow(() => f.sink.emit(new Proxy({}, { getPrototypeOf() { throw Error('SECRET') } })))
  f.sink.emit(panel)
  assert.equal(f.lines.length, 0, 'malformed object fails closed without another write')
})

test('anonymous scope, lifecycle enums and per-Git wall durations copy only fixed scalars', t => {
  const f = fixture(t)
  const scope = { tag: 'yugoo-git-scope', scopeId: 7, phase: 'route-selected', at: panel.at, elapsedMs: 3,
    route: 'fallback', reason: 'non-windows', completed: true }
  const scopedGit = { ...git, scopeId: 7, route: 'scoped-native', sequence: 0xffffffff,
    queueMs: 1, preGuardMs: 2, requestRttMs: 3, postGuardMs: 4, totalMs: 12 }
  const privateFields = { session: 'SECRET_SESSION', project: 'SECRET_PROJECT', path: 'SECRET_PATH',
    argv: ['SECRET_ARG'], env: { SECRET_KEY: 'SECRET' }, error: 'SECRET_ERROR', cpuMs: 999 }
  const input = { ...scope, ...privateFields, toJSON() { throw Error('must not call') } }
  Object.defineProperty(input, 'privateGetter', { enumerable: true, get() { throw Error('must not read') } })
  f.sink.emit(input); f.sink.emit({ ...scopedGit, ...privateFields })
  const publicScope = { ...scope, route: 'host-managed', reason: 'public-api' }
  const publicGit = { ...scopedGit, route: 'host-managed' }
  f.sink.emit({ ...publicScope, containment: 'windows-job' })
  f.sink.emit({ ...publicGit, containment: 'windows-job' })
  f.sink.emit({ ...panel, scopeId: 7 }); f.sink.emit(panel); f.sink.emit(git)
  assert.deepEqual(f.records(), [scope, scopedGit, publicScope, publicGit, { ...panel, scopeId: 7 }, panel, git])
  assert.doesNotMatch(f.lines.join(''), /containment|windows-job/)
  assert.doesNotMatch(f.lines.join(''), /SECRET|session|project|path|argv|env|error|cpuMs/)
})

test('new timing schema rejects invalid identities, reasons, phases, routes and not-yet-valid durations', t => {
  const f = fixture(t), scope = { tag: 'yugoo-git-scope', scopeId: 1, phase: 'ready-end', at: panel.at, elapsedMs: 1 }
  for (const value of [0, -1, 1.5, 0x80000000, '1', null]) {
    f.sink.emit({ ...scope, scopeId: value }); f.sink.emit({ ...panel, scopeId: value }); f.sink.emit({ ...git, scopeId: value })
  }
  for (const record of [{ ...scope, phase: 'SECRET' }, { ...scope, reason: 'SECRET_ERROR' }, { ...scope, route: 'SECRET_HOST' },
    { ...scope, route: 'windows-job' },
    { ...scope, completed: 'yes' }, { ...scope, rangeConfirmed: 1 }, { ...git, route: 'unknown' }]) f.sink.emit(record)
  for (const sequence of [0, -1, 1.5, 0x100000000, '1']) f.sink.emit({ ...git, sequence })
  for (const field of ['queueMs', 'preGuardMs', 'requestRttMs', 'postGuardMs', 'totalMs']) {
    for (const value of [-1, NaN, 0.5, 0x80000000, '1']) f.sink.emit({ ...git, [field]: value })
    const getter = { ...git }; Object.defineProperty(getter, field, { get() { throw Error('must not read') } }); f.sink.emit(getter)
  }
  assert.deepEqual(f.lines, [])
})

test('all lifecycle stages and fixed route reasons retain the existing bounded sink behavior', t => {
  const f = fixture(t), scope = { tag: 'yugoo-git-scope', scopeId: 1, at: panel.at, elapsedMs: 0 }
  const phases = ['registered-open-start', 'registered-open-end', 'route-start', 'route-selected', 'route-refused',
    'resolve-start', 'resolve-end', 'spawn-start', 'spawn-end', 'ready-start', 'ready-end', 'close-start', 'close-ack', 'close-end', 'range-start', 'range-end']
  for (const phase of phases) f.sink.emit({ ...scope, phase })
  for (const reason of ['non-windows', 'optional-package-missing', 'different-runtime', 'missing-native-api', 'native-api', 'public-api', 'module-import-failed']) {
    f.sink.emit({ ...scope, phase: 'route-selected', reason })
  }
  assert.equal(f.lines.length, phases.length + 7)
  const limited = fixture(t, { limits: { maxRecords: 1 } })
  limited.sink.emit({ ...scope, phase: 'range-end', rangeConfirmed: false }); limited.sink.emit(git)
  assert.equal(limited.lines.length, 1)
})

test('range outcome is a fixed enum and false without an aborted wait is not reported as a rejection or timeout', t => {
  const f = fixture(t), record = { tag: 'yugoo-git-scope', scopeId: 1, phase: 'range-end', at: panel.at, elapsedMs: 2 }
  for (const rangeOutcome of ['confirmed', 'wait-aborted', 'rejected', 'not-confirmed']) f.sink.emit({ ...record, rangeOutcome })
  for (const rangeOutcome of ['private error text', 1, null]) f.sink.emit({ ...record, rangeOutcome })
  assert.deepEqual(f.records().map(row => row.rangeOutcome), ['confirmed', 'wait-aborted', 'rejected', 'not-confirmed'])
})

test('worker observation and residual fields stay bounded and private extras never reach the existing sink', t => {
  const f = fixture(t), metrics = Object.fromEntries([...GIT_WORKER_TIMING_FIELDS, 'wireParentResidualMs'].map(field => [field, 1]))
  f.sink.emit({ ...git, ...metrics, rawError: 'SECRET', cpuMs: 99 })
  assert.deepEqual(f.records(), [{ ...git, ...metrics }])
  assert.doesNotMatch(f.lines[0], /SECRET|rawError|cpuMs/)
  for (const field of [...GIT_WORKER_TIMING_FIELDS, 'wireParentResidualMs']) {
    for (const value of [-1, NaN, Infinity, 0.1, 0x80000000, '1']) f.sink.emit({ ...git, [field]: value })
  }
  assert.equal(f.lines.length, 1)
})

test('every existing phase and Git operation is accepted without broadening the schemas', t => {
  const f = fixture(t)
  const phases = ['request', 'project-resolved', 'mutation-entered', 'publication-start', 'commit-accepted',
    'journal-settled', 'committed-diff-read', 'handoff-settled', 'returned', 'failed']
  const operations = ['rev-parse', 'cat-file', 'ls-tree', 'ls-files', 'log', 'show', 'diff', 'read-tree',
    'write-tree', 'hash-object', 'update-index', 'commit-tree', 'update-ref', 'status', 'merge-base', 'other']
  for (const phase of phases) f.sink.emit({ ...panel, phase })
  for (const operation of operations) f.sink.emit({ ...git, operation })
  assert.equal(f.lines.length, phases.length + operations.length)
  assert.deepEqual(f.records().slice(0, phases.length).map(row => row.phase), phases)
})

test('record and byte budgets stop permanently, including an overlarge first record', t => {
  const byCount = fixture(t, { limits: { maxRecords: 2 } })
  for (let i = 0; i < 5; i++) byCount.sink.emit(panel)
  assert.equal(byCount.lines.length, 2)
  const size = Buffer.byteLength(JSON.stringify(panel) + '\n')
  const byBytes = fixture(t, { limits: { maxBytes: size } })
  byBytes.sink.emit(panel); byBytes.sink.emit(panel)
  assert.equal(byBytes.lines.length, 1)
  const tooSmall = fixture(t, { limits: { maxBytes: size - 1 } })
  tooSmall.sink.emit(panel)
  assert.equal(tooSmall.lines.length, 0)
})

test('monotonic elapsed budget and invalid limits fail closed', t => {
  let now = 0
  const f = fixture(t, { now: () => now, limits: { maxMs: 100 } })
  f.sink.emit(panel)
  now = 99; f.sink.emit(panel)
  now = 100; f.sink.emit(panel)
  now = 1; f.sink.emit(panel)
  assert.equal(f.lines.length, 2)
  for (const limits of [{ maxMs: 0 }, { maxRecords: 5001 }, { maxBytes: 2 ** 21 + 1 }, { maxMs: NaN }]) {
    const invalid = fixture(t, { limits }); invalid.sink.emit(panel)
    assert.equal(invalid.lines.length, 0)
    assert.equal(invalid.output.listenerCount('error'), 0)
  }
})

test('wall-clock window ends even when no further records are emitted', async t => {
  const f = fixture(t, { limits: { maxMs: 5 } })
  f.sink.emit(panel)
  await new Promise(resolve => setTimeout(resolve, 20))
  f.sink.emit(panel)
  assert.equal(f.lines.length, 1)
  assert.equal(f.output.listenerCount('drain'), 0)
})

test('backpressure drops rather than queues, then resumes only after drain', async t => {
  const chunks = [], releases = []
  const output = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) { chunks.push(chunk.toString()); releases.push(done) } })
  const sink = createDshTimingDiagnostics({ enabled: true, output })
  t.after(() => { sink.stop(); for (const done of releases.splice(0)) done(); output.destroy() })
  sink.emit(panel)
  const length = output.writableLength
  for (let i = 0; i < 1000; i++) sink.emit(panel)
  assert.equal(chunks.length, 1)
  assert.equal(output.writableLength, length, 'no diagnostic backlog is added')
  const drained = once(output, 'drain'); releases.shift()(); await drained
  sink.emit(git)
  assert.equal(chunks.length, 2)
  assert.deepEqual(JSON.parse(chunks[1]), git)
})

test('pre-existing backpressure is not amplified and does not attach listeners', async t => {
  let release
  const output = new Writable({ highWaterMark: 1, write(_chunk, _encoding, done) { release = done } })
  const sink = createDshTimingDiagnostics({ enabled: true, output })
  t.after(() => { sink.stop(); release?.(); output.destroy() })
  output.write('existing traffic')
  const length = output.writableLength
  sink.emit(panel)
  assert.equal(output.writableLength, length)
  assert.equal(output.listenerCount('error'), 0)
})

test('synchronous write failures stop without propagating or closing the shared stream', t => {
  const f = fixture(t)
  f.output.write = () => { throw Error('SECRET_IO') }
  assert.doesNotThrow(() => f.sink.emit(panel))
  assert.doesNotThrow(() => f.output.emit('error', Error('late owned I/O failure')))
  f.sink.emit(git)
  assert.equal(f.lines.length, 0)
  assert.equal(f.output.destroyed, false)
})

test('asynchronous write errors after record-limit/disposal stay contained through close', async t => {
  let writes = 0
  const output = new Writable({ write(_chunk, _encoding, done) { writes++; setImmediate(() => done(Error('SECRET_ASYNC_IO'))) } })
  const sink = createDshTimingDiagnostics({ enabled: true, output, limits: { maxRecords: 1 } })
  t.after(() => { sink.stop(); output.destroy() })
  const closed = new Promise(resolve => output.once('close', resolve))
  assert.doesNotThrow(() => sink.emit(panel))
  sink.stop() // A callback may run before Writable emits its deferred error.
  await closed
  sink.emit(git)
  assert.equal(writes, 1)
  assert.equal(output.listenerCount('error'), 0, 'the passive error guard retires only at close')
})

test('ended/closed streams and explicit stop never get another diagnostic write', async t => {
  const f = fixture(t)
  f.output.end(); f.sink.emit(panel)
  assert.equal(f.lines.length, 0)
  const active = fixture(t)
  active.sink.emit(panel); active.sink.stop(); active.sink.emit(git)
  assert.equal(active.lines.length, 1)
  assert.equal(active.output.writableEnded, false, 'stop never ends the shared stdout')
  assert.equal(active.output.listenerCount('error'), 1, 'one bounded guard, never one listener per record')
  active.output.destroy(); await tick()
  assert.equal(active.output.listenerCount('error'), 0)
})

test('real scripted DSH producer methods preserve logger/results and require exact startup opt-in', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { allocateDshSaveScopeId } from './packages/core/src/dsh-timing-diagnostics.ts';
    import DesignService from './packages/core/src/design-service.ts';
    import { DesignPanelRemote } from './packages/core/src/panel-remote.ts';
    const messages = [];
    const firstScope = allocateDshSaveScopeId();
    assert.equal(firstScope, process.env.YUGOO_DSH_TIMING_DIAGNOSTICS === '1' ? 1 : undefined);
    const design = Object.create(DesignService.prototype);
    design.context = { logger: { info: line => messages.push(JSON.parse(line)) }, subprocess: {
      spawn: () => ({ done: Promise.resolve({ exitCode: 0 }), collected: {
        stdout: { readFrom: () => ({ text: 'SECRET_OUTPUT' }) }, stderr: { readFrom: () => ({ text: 'SECRET_STDERR' }) } } }) } };
    const result = await design.spawnAdapter()({ argv: ['git', 'status', 'SECRET_ARG'], cwd: '/SECRET_PATH', env: { SECRET_KEY: 'SECRET' } });
    assert.equal(result.stdout, 'SECRET_OUTPUT'); assert.equal(result.stderr, 'SECRET_STDERR');
    const remote = Object.create(DesignPanelRemote.prototype);
    remote.hostContext = { logger: { info: line => messages.push(JSON.parse(line)) } };
    await assert.rejects(remote.savePanel({ id: 'SECRET_SESSION' }, 'SECRET_SKILL', {}, undefined), /save signal is required/);
    assert.equal(messages.length, 2); assert.equal(messages[1].session, 'SECRET_SESSION');
    assert.equal(messages[1].skill, 'SECRET_SKILL');
    // The switch is a launch-time snapshot, not a runtime settings toggle.
    process.env.YUGOO_DSH_TIMING_DIAGNOSTICS = '1';
    assert.equal(allocateDshSaveScopeId(), firstScope === undefined ? undefined : 3);
    await design.spawnAdapter()({ argv: ['git', 'status'], cwd: '/SECRET_PATH' });
    assert.equal(messages.length, 3);
  `
  for (const flag of [undefined, '0', 'true', '1']) {
    const env = { ...process.env }
    delete env.YUGOO_DSH_TIMING_DIAGNOSTICS
    if (flag !== undefined) env.YUGOO_DSH_TIMING_DIAGNOSTICS = flag
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)), env, encoding: 'utf8', timeout: 30_000,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const records = result.stdout.trim() ? result.stdout.trim().split('\n').map(line => JSON.parse(line)) : []
    assert.equal(records.length, flag === '1' ? 3 : 0)
    assert.doesNotMatch(result.stdout, /SECRET|session|skill|path|argv|env|error|rawlogger/)
    if (flag === '1') assert.deepEqual(records.map(record => record.tag), ['yugoo-git', 'yugoo-panel-save', 'yugoo-git'])
  }
})

test('real save threads one opt-in scope through fresh registered open and the unchanged fallback route', () => {
  const env = { ...process.env, YUGOO_DSH_TIMING_DIAGNOSTICS: '1' }
  delete env.NODE_TEST_CONTEXT // This is a deliberate independent runner, not the parent's worker.
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-name-pattern=ordinary single-file save',
    'packages/core/test/panel-save-journal-cost.test.mjs'], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)), env,
    encoding: 'utf8', timeout: 30000,
  })
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /# pass 1\b/)
  const records = result.stdout.split('\n').filter(line => line.startsWith('# {"tag":')).map(line => JSON.parse(line.slice(2)))
  const requests = records.filter(row => row.tag === 'yugoo-panel-save' && row.phase === 'request')
  assert.equal(requests.length, 2)
  assert.deepEqual(requests.map(row => row.scopeId), [1, 2])
  for (const request of requests) {
    const own = records.filter(row => row.scopeId === request.scopeId)
    const openStart = own.findIndex(row => row.phase === 'registered-open-start')
    const openEnd = own.findIndex(row => row.phase === 'registered-open-end')
    const route = own.findIndex(row => row.phase === 'route-selected')
    assert(openStart > own.findIndex(row => row.phase === 'mutation-entered'))
    assert(openEnd > openStart && route > openEnd)
    assert.equal(own[openEnd].completed, true)
    assert.equal(own[route].route, 'fallback'); assert.equal(own[route].reason, 'non-windows')
    assert(own.some(row => row.phase === 'returned'))
  }
  // Fallback keeps the existing cache/SpawnFn and old uncorrelated Git schema.
  assert.equal(records.filter(row => row.tag === 'yugoo-git').every(row => row.scopeId === undefined), true)
})

test('route diagnostics distinguish absent, old and refused providers without introducing fallback after native refusal', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { registerHooks, createRequire } from 'node:module';
    import { Writable } from 'node:stream';
    const { LocalSubprocessRuntime } = await import(createRequire(new URL('./packages/core/src/dsh-git-scope.ts', import.meta.url)).resolve('@deepseek-ai/dsh-subprocess-local'));
    const original = Object.getOwnPropertyDescriptor(process, 'platform'), output = Object.getOwnPropertyDescriptor(process, 'stdout'), records = [];
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const sink = new Writable({ write(bytes, _encoding, done) { records.push(JSON.parse(bytes)); done(); } });
    Object.defineProperty(process, 'stdout', { value: sink, configurable: true });
    const options = (subprocess, scopeId) => ({ subprocess, scopeId, root: '/SECRET_ROOT', signal: new AbortController().signal, assertScope: async () => {} });
    const { openDshGitScope } = await import('./packages/core/src/dsh-git-scope.ts');
    assert.equal(await openDshGitScope(options({}, 1)), undefined);
    const old = Object.create(LocalSubprocessRuntime.prototype); old.spawnNativeContained = undefined;
    assert.equal(await openDshGitScope(options(old, 2)), undefined);
    for (const [id, missing] of [[3, '@deepseek-ai/dsh-subprocess-local'], [4, 'SECRET_TRANSITIVE']]) {
      const hook = registerHooks({ resolve(specifier, context, next) {
        if (specifier === '@deepseek-ai/dsh-subprocess-local') throw Object.assign(Error("Cannot find package '" + missing + "' imported from SECRET"), { code: 'ERR_MODULE_NOT_FOUND' });
        return next(specifier, context);
      } });
      try {
        const { openDshGitScope: open } = await import('./packages/core/src/dsh-git-scope.ts?diagnostic=' + id);
        if (id === 3) assert.equal(await open(options({}, id)), undefined);
        else await assert.rejects(open(options({}, id)), /SECRET_TRANSITIVE/);
      } finally { hook.deregister(); }
    }
    const failure = Error('SECRET_REFUSAL'), local = Object.create(LocalSubprocessRuntime.prototype);
    local.resolveExecutable = async value => value;
    local.spawn = () => assert.fail('must not fall back'); local.spawnNativeContained = () => { throw failure; };
    await assert.rejects(openDshGitScope(options(local, 5)), error => error === failure);
    assert.deepEqual(records.filter(row => row.phase === 'route-selected').map(row => row.reason),
      ['different-runtime', 'missing-native-api', 'optional-package-missing', 'native-api']);
    assert.equal(records.find(row => row.phase === 'route-refused').reason, 'module-import-failed');
    assert.equal(records.find(row => row.phase === 'spawn-end').completed, false);
    assert.equal(records.filter(row => row.scopeId === 5 && row.route === 'fallback').length, 0);
    assert.doesNotMatch(JSON.stringify(records), /SECRET|argv|env|path|error/i);
    Object.defineProperty(process, 'platform', original); Object.defineProperty(process, 'stdout', output); sink.destroy();
    console.log('routes preserved');
  `
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)), env: { ...process.env, YUGOO_DSH_TIMING_DIAGNOSTICS: '1' },
    encoding: 'utf8', timeout: 30000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'routes preserved')
})

test('scripted native calls keep their original outcomes when the opted-in stdout fails asynchronously', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { Writable } from 'node:stream';
    import DesignService from './packages/core/src/design-service.ts';
    import { DesignPanelRemote } from './packages/core/src/panel-remote.ts';
    let writes = 0;
    const broken = new Writable({ write(_chunk, _encoding, done) { writes++; setImmediate(() => done(Error('SECRET_IO'))); } });
    Object.defineProperty(process, 'stdout', { value: broken });
    const closed = new Promise(resolve => broken.once('close', resolve));
    const design = Object.create(DesignService.prototype);
    design.context = { logger: { info() { throw Error('SECRET_LOGGER'); } }, subprocess: {
      spawn: () => ({ done: Promise.resolve({ exitCode: 0 }), collected: {
        stdout: { readFrom: () => ({ text: 'SECRET_OUTPUT' }) }, stderr: { readFrom: () => ({ text: '' }) } } }) } };
    assert.equal((await design.spawnAdapter()({ argv: ['git', 'status'] })).stdout, 'SECRET_OUTPUT');
    await closed;
    const failure = Error('SECRET_NATIVE_FAILURE');
    design.context.subprocess.spawn = () => { throw failure; };
    await assert.rejects(design.spawnAdapter()({ argv: ['git', 'status'] }), error => error === failure);
    const remote = Object.create(DesignPanelRemote.prototype);
    remote.hostContext = design.context;
    await assert.rejects(remote.savePanel({ id: 'SECRET_SESSION' }, 'SECRET_SKILL', {}, undefined), /save signal is required/);
    assert.equal(writes, 1);
  `
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    env: { ...process.env, YUGOO_DSH_TIMING_DIAGNOSTICS: '1' }, encoding: 'utf8', timeout: 30_000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '', 'no uncaught EPIPE/async stream error or secret stderr')
})

test('a real broken stdout pipe returns EPIPE to the write callback without crashing its process', { timeout: 15_000 }, async t => {
  const script = `
    import { once } from 'node:events';
    import { emitDshTimingDiagnostic } from './packages/core/src/dsh-timing-diagnostics.ts';
    let writeError;
    const originalWrite = process.stdout.write;
    process.stdout.write = function(chunk, callback) {
      return originalWrite.call(this, chunk, error => { writeError = error?.code; callback(error); });
    };
    const release = once(process, 'message');
    process.send({ ready: true });
    await release;
    const closed = new Promise(resolve => process.stdout.once('close', resolve));
    emitDshTimingDiagnostic(${JSON.stringify(panel)});
    await closed;
    // No extra error listener or emit override: the helper contains the real
    // native error. Observe its write callback, not stdio's reset flags.
    process.send({ code: writeError });
    process.disconnect();
  `
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    env: { ...process.env, YUGOO_DSH_TIMING_DIAGNOSTICS: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill() })
  let stderr = ''
  child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderr += text })
  const exited = once(child, 'close')
  assert.deepEqual((await once(child, 'message'))[0], { ready: true })
  const pipeClosed = once(child.stdout, 'close')
  child.stdout.destroy(); await pipeClosed
  const receipt = once(child, 'message')
  child.send('closed')
  assert.deepEqual((await receipt)[0], { code: 'EPIPE' })
  assert.deepEqual(await exited, [0, null])
  assert.equal(stderr, '')
})
