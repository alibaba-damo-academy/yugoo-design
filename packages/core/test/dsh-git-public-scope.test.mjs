/** Retained process-adapter fixtures only; not the default library route or installed-Host acceptance. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Import the actual runtime before emulating Windows. Each fixture has its own
// process, environment, platform descriptor, diagnostics sink and fake channel.
const prelude = `
import assert from 'node:assert/strict';
import { Duplex, PassThrough, Writable } from 'node:stream';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import { openDshProcessGitScope as openDshGitScope } from './src/dsh-git-scope.ts';
import { readGitFrames, writeGitFrame, writeGitBytes } from './src/dsh-git-protocol.ts';
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
Object.defineProperty(process, 'platform', { value: 'win32' });
const output = Object.getOwnPropertyDescriptor(process, 'stdout');
const lines = [];
const sink = new Writable({ write(chunk, _encoding, done) { lines.push(chunk.toString()); done(); } });
Object.defineProperty(process, 'stdout', { value: sink });
const records = () => lines.flatMap(line => line.trim().split(String.fromCharCode(10)).map(row => JSON.parse(row)));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const root = '/PRIVATE_REPOSITORY';
const controller = new AbortController();
const base = { root, signal: controller.signal, assertScope: async () => {}, scopeId: 7 };
function fixture({ ready = { type: 'ready', version: 1 }, control = true, range = true, handler } = {}) {
  const up = new PassThrough(), down = new PassThrough();
  const parent = Duplex.from({ readable: down, writable: up });
  const worker = Duplex.from({ readable: up, writable: down });
  // Rejected admission has no scope reader to observe this fixture's Duplex abort.
  parent.on('error', () => {});
  const ended = deferred(), launches = [], frames = [], waits = [], resolutions = [];
  let terminations = 0;
  const handle = { control: control ? parent : undefined, collected: {}, done: ended.promise,
    terminate() { terminations++; ended.resolve({ exitCode: 1, signal: null }); parent.destroy(); worker.destroy(); },
    async waitForExit(signal) { waits.push(signal); if (range instanceof Error) throw range; return range; } };
  const local = Object.create(LocalSubprocessRuntime.prototype);
  local.spawnNativeContained = undefined;
  local.resolveExecutable = async (...args) => { resolutions.push(args); return '/resolved/node.exe'; };
  function launch(route, spec) {
    launches.push({ route, spec });
    if (control) setImmediate(() => { void writeGitFrame(worker, ready).catch(() => {}); });
    return handle;
  }
  local.spawn = spec => launch('public', spec);
  const work = (async () => {
    for await (const frame of readGitFrames(worker)) {
      assert.equal(frame.kind, 'json'); frames.push(frame.value);
      if (frame.value.type === 'close') {
        await writeGitFrame(worker, { type: 'closed' });
        worker.end(); ended.resolve({ exitCode: 0, signal: null });
      } else if (handler) await handler(frame.value, worker);
      else if (frame.value.type === 'native') await writeGitFrame(worker, { type: 'native-result', id: frame.value.id, value: 'a'.repeat(40) });
      else await writeGitFrame(worker, { type: 'result', id: frame.value.id, exitCode: 0, stdout: 'cli', stderr: '' });
    }
  })().catch(error => { if (!parent.destroyed) throw error; });
  return { local, launch, launches, frames, resolutions, waits, get terminations() { return terminations; },
    async dispose(scope) { if (scope) { scope.stop(); await scope.close().catch(() => {}); } parent.destroy(); worker.destroy(); ended.resolve({ exitCode: 0, signal: null }); await work; } };
}
function routesAre(route) {
  const scoped = records().filter(row => row.tag === 'yugoo-git-scope' && row.route !== undefined);
  assert.ok(scoped.length > 0);
  assert.ok(scoped.every(row => row.route === route), JSON.stringify(scoped));
  assert.ok(records().every(row => row.containment === undefined));
  assert.doesNotMatch(JSON.stringify(records()), /PRIVATE|windows-job|linux-scope|argv|env/);
}
`

function run(body) {
  const env = { ...process.env, YUGOO_DSH_TIMING_DIAGNOSTICS: '1' }
  env.YUGOO_GIT_BACKEND = 'cli'
  const script = prelude + '\n' + body + `
Object.defineProperty(process, 'platform', originalPlatform);
Object.defineProperty(process, 'stdout', output); sink.destroy();
`
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 30_000,
  })
  assert.equal(result.status, 0, `${result.stderr}\n${result.error ?? ''}`)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
}

test('explicit native uses the real local runtime public spawn with bounded control and Electron launch environment', () => {
  for (const electron of [false, true]) run(`
    ${electron ? "Object.defineProperty(process.versions, 'electron', { value: 'fixture-electron', configurable: true });" : ''}
    const f = fixture(); let scope;
    try {
      scope = await openDshGitScope({ ...base, subprocess: f.local, backend: 'native' });
      assert.ok(scope); assert.equal(f.launches.length, 1); assert.equal(f.launches[0].route, 'public');
      const spec = f.launches[0].spec;
      assert.deepEqual(f.resolutions, [[process.execPath, undefined, controller.signal]]);
      assert.equal(spec.argv[0], '/resolved/node.exe'); assert.match(spec.argv[1], /dsh-git-worker\\.js$/);
      assert.equal(spec.argv[2], root); assert.equal(spec.cwd, root); assert.equal(spec.signal, controller.signal);
      assert.equal(spec.graceMs, 5000);
      assert.deepEqual(spec.stdio, { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 4096 }, control: 'pipe' });
      assert.deepEqual(spec.env, ${electron ? "{ ELECTRON_RUN_AS_NODE: '1' }" : 'undefined'});
      assert.deepEqual(await scope.spawn.native({ cwd: root, operation: { kind: 'head' } }), { value: 'a'.repeat(40) });
      await scope.close(); assert.equal(f.waits.length, 1); assert.equal(f.waits[0].aborted, false);
      assert.notEqual(f.waits[0], controller.signal); assert.equal(f.terminations, 0);
      assert.ok(records().some(row => row.phase === 'route-selected' && row.reason === 'public-api'));
      assert.ok(records().some(row => row.phase === 'range-end' && row.rangeOutcome === 'confirmed'));
      routesAre('host-managed');
    } finally { await f.dispose(scope); }
  `)
})

test('the admitted public route keeps one FIFO for native blobs and residual CLI requests', () => run(`
  const first = deferred(), release = deferred(), bytes = Buffer.from([0, 255, 10, 128]);
  const f = fixture({ handler: async (message, worker) => {
    if (message.id === 1) { first.resolve(); await release.promise; }
    if (message.type === 'run') await writeGitFrame(worker, { type: 'result', id: message.id, exitCode: 0, stdout: 'cli', stderr: '' });
    else if (message.operation.kind === 'blob') {
      await writeGitBytes(worker, message.id, bytes);
      await writeGitFrame(worker, { type: 'native-result', id: message.id, value: null });
    } else await writeGitFrame(worker, { type: 'native-result', id: message.id, value: 'a'.repeat(40) });
  } }); let scope;
  try {
    scope = await openDshGitScope({ ...base, subprocess: f.local, backend: 'native' });
    const pending = [
      scope.spawn.native({ cwd: root, operation: { kind: 'head' } }),
      scope.spawn({ cwd: root, argv: ['git', 'status', '--short'] }),
      scope.spawn.native({ cwd: root, operation: { kind: 'blob', oid: 'b'.repeat(40), size: bytes.length } }),
    ];
    await first.promise; await tick(); assert.equal(f.frames.length, 1);
    release.resolve();
    assert.deepEqual(await Promise.all(pending), [{ value: 'a'.repeat(40) },
      { exitCode: 0, stdout: 'cli', stderr: '' }, { value: null, bytes }]);
    assert.deepEqual(f.frames.map(row => [row.type, row.id]), [['native', 1], ['run', 2], ['native', 3]]);
    await scope.close();
    assert.ok(records().some(row => row.tag === 'yugoo-git' && row.route === 'host-managed' && row.completed === true));
    routesAre('host-managed');
  } finally { release.resolve(); await f.dispose(scope); }
`))

test('absent strict API never starts public spawn by default or for CLI, and explicit CLI overrides the native environment', () => run(`
  const f = fixture();
  try {
    f.local.resolveExecutable = () => assert.fail('CLI/default must not resolve the public helper');
    for (const backend of [undefined, 'cli']) {
      assert.equal(await openDshGitScope({ ...base, subprocess: f.local, ...(backend === undefined ? {} : { backend }) }), undefined);
    }
    process.env.YUGOO_GIT_BACKEND = 'native';
    assert.equal(await openDshGitScope({ ...base, subprocess: f.local, backend: 'cli' }), undefined);
    assert.equal(f.launches.length, 0);
    assert.ok(records().some(row => row.route === 'fallback' && row.reason === 'missing-native-api'));
  } finally { await f.dispose(); }
`))

test('native environment opt-in is admitted but another runtime identity or platform is not', () => run(`
  const f = fixture(); let scope;
  try {
    process.env.YUGOO_GIT_BACKEND = 'native';
    scope = await openDshGitScope({ ...base, subprocess: f.local }); assert.ok(scope); await scope.close();
    const other = { spawn() { assert.fail('structural lookalike must not launch'); }, resolveExecutable() { assert.fail('must not resolve'); } };
    assert.equal(await openDshGitScope({ ...base, subprocess: other, backend: 'native' }), undefined);
    Object.defineProperty(process, 'platform', { value: 'linux' });
    assert.equal(await openDshGitScope({ ...base, subprocess: f.local, backend: 'native' }), undefined);
    assert.equal(f.launches.length, 1);
    assert.ok(records().some(row => row.reason === 'different-runtime'));
    assert.ok(records().some(row => row.reason === 'non-windows'));
  } finally { await f.dispose(scope); }
`))

test('a present strict API has priority, and its launch refusal never replays through public spawn', () => run(`
  const f = fixture(); let scope;
  try {
    f.local.spawnNativeContained = spec => f.launch('strict', spec);
    f.local.spawn = () => assert.fail('strict route must not replay through public spawn');
    scope = await openDshGitScope({ ...base, subprocess: f.local, backend: 'native' });
    assert.equal(f.launches[0].route, 'strict'); await scope.close(); routesAre('scoped-native');
    const failure = Error('strict-launch-refusal'); let calls = 0;
    f.local.spawnNativeContained = () => { calls++; throw failure; };
    await assert.rejects(openDshGitScope({ ...base, subprocess: f.local, backend: 'native' }), error => error === failure);
    assert.equal(calls, 1); assert.equal(f.launches.length, 1);
  } finally { await f.dispose(scope); }
`))

test('public launch errors, aborted callers and rejected scope guards are not retried or converted to CLI', () => run(`
  const f = fixture();
  try {
    const failure = Error('public-launch-refusal'); let calls = 0;
    f.local.spawn = () => { calls++; throw failure; };
    await assert.rejects(openDshGitScope({ ...base, subprocess: f.local, backend: 'native' }), error => error === failure);
    assert.equal(calls, 1);
    const unauthorized = Error('scope-ended');
    await assert.rejects(openDshGitScope({ ...base, subprocess: f.local, backend: 'native', assertScope: async () => { throw unauthorized; } }), error => error === unauthorized);
    controller.abort(Error('caller-aborted'));
    await assert.rejects(openDshGitScope({ ...base, subprocess: f.local, backend: 'native' }), /caller-aborted/);
    assert.equal(calls, 1); assert.equal(f.resolutions.length, 1);
    assert.ok(records().some(row => row.phase === 'spawn-end' && row.completed === false && row.route === 'host-managed'));
  } finally { await f.dispose(); }
`))

test('missing public control channel terminates and only range confirmation determines cleanup success', () => {
  for (const confirmed of [true, false]) run(`
    const f = fixture({ control: false, range: ${confirmed} });
    try {
      await assert.rejects(openDshGitScope({ ...base, subprocess: f.local, backend: 'native' }), error => {
        ${confirmed ? "assert.equal(error instanceof AggregateError, false); assert.match(String(error), /no control channel/);" : "assert.ok(error instanceof AggregateError); assert.match(String(error.cause), /no control channel/); assert.match(String(error.errors[1]), /not confirmed/);"}
        return true;
      });
      assert.equal(f.launches.length, 1); assert.ok(f.terminations > 0); assert.equal(f.waits.length, 1);
      assert.equal(f.waits[0].aborted, false); assert.notEqual(f.waits[0], controller.signal);
      const range = records().find(row => row.phase === 'range-end');
      assert.equal(range.rangeConfirmed, ${confirmed}); assert.equal(range.completed, ${confirmed});
      assert.equal(range.rangeOutcome, '${confirmed ? 'confirmed' : 'not-confirmed'}');
      routesAre('host-managed');
    } finally { await f.dispose(); }
  `)
})

test('invalid public readiness fails startup and still joins the host-managed range without another launch', () => run(`
  const f = fixture({ ready: { type: 'ready', version: 2 } });
  try {
    await assert.rejects(openDshGitScope({ ...base, subprocess: f.local, backend: 'native' }), /invalid worker lifecycle/);
    assert.equal(f.launches.length, 1); assert.ok(f.terminations > 0); assert.equal(f.waits.length, 1);
    assert.ok(records().some(row => row.phase === 'ready-end' && row.completed === false));
    assert.ok(records().some(row => row.phase === 'range-end' && row.rangeConfirmed === true));
    routesAre('host-managed');
  } finally { await f.dispose(); }
`))


test('abort or authorization loss during executable resolution fences both public and strict launch', () => {
  for (const route of ['public', 'strict']) for (const failure of ['abort', 'authorization']) run(`
    const f = fixture();
    try {
      if ('${route}' === 'strict') f.local.spawnNativeContained = spec => f.launch('strict', spec);
      let authorized = true, checks = 0;
      const problem = Error('${failure}-during-resolve');
      f.local.resolveExecutable = async (...args) => {
        f.resolutions.push(args); await tick();
        if ('${failure}' === 'abort') controller.abort(problem); else authorized = false;
        return '/resolved/node.exe';
      };
      await assert.rejects(openDshGitScope({ ...base, subprocess: f.local, backend: 'native',
        assertScope: async () => { checks++; if (!authorized) throw problem; }
      }), error => error === problem);
      assert.equal(f.resolutions.length, 1); assert.equal(f.launches.length, 0);
      assert.equal(f.waits.length, 0); assert.equal(f.terminations, 0);
      assert.ok(checks >= 1);
      assert.ok(records().some(row => row.phase === 'resolve-end' && row.completed === true));
      assert.equal(records().some(row => row.phase === 'spawn-start'), false);
    } finally { await f.dispose(); }
  `)
})
