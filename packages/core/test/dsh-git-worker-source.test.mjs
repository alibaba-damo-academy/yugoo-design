/** Source wire + real Git fixture only; not native ownership or installed-build proof. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { DshGitScope } from '../src/dsh-git-scope.ts'
import { GitVersioning } from '../src/git.ts'
import { DesignFilesStore } from '../src/design-files.ts'
import { nodeFs } from '../src/service-tools.ts'
import { nodeDesignProjectSpawn } from '../src/design-project.ts'
import { GIT_WORKER_TIMING_FIELDS, gitWorkerTiming, readGitFrames, writeGitFrame } from '../src/dsh-git-protocol.ts'

test('one source worker preserves real Git publication, exact binary blobs and same-event recovery', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-worker-source-'))
  let child, scope
  try {
    for (const argv of [
      ['git', 'init', '--quiet'], ['git', 'config', '--local', 'user.name', 'Fixture'],
      ['git', 'config', '--local', 'user.email', 'fixture@invalid'],
      ['git', 'commit', '--allow-empty', '-qm', 'Initial'],
    ]) assert.equal((await nodeDesignProjectSpawn({ argv, cwd: root })).exitCode, 0)
    child = spawn(process.execPath, [
      '--import', import.meta.resolve('tsx'),
      fileURLToPath(new URL('../src/dsh-git-worker.ts', import.meta.url)), root,
    ], {
      cwd: root, env: { ...scrubbedParentEnv(), DSH_SUBPROCESS_CONTROL: 'pipe' },
      stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore', 'ignore', 'pipe'],
    })
    child.stdout.resume(); child.stderr.resume()
    const done = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
    })
    scope = new DshGitScope({
      control: child.stdio[7], collected: {}, done,
      terminate() { child.kill('SIGKILL') },
      async waitForExit() { await done; return true },
    }, root, new AbortController().signal, async () => {})
    await scope.start()
    const calls = []
    const git = new GitVersioning(request => { calls.push(request.argv); return scope.spawn(request) }, root, 'design_files')
    const store = new DesignFilesStore(nodeFs, git, join(root, 'design_files'))
    const bytes = Uint8Array.from([0, 255, 13, 10, 128])
    const options = {
      origin: 'panel', settleEvent: async () => {}, audit: { kind: 'panel-save', eventId: 'one-source-event' },
      artifacts: { 'sample/image.bin': bytes }, ownedArtifacts: ['sample/image.bin'],
    }
    const saved = await store.write('sample', { title: 'UTF-8 中 "quoted"' }, options)
    assert.match(saved.commit, /^[0-9a-f]{40}$/)
    assert.deepEqual(await git.readBytesAt(saved.commit, 'sample/image.bin'), bytes)
    const updates = calls.filter(argv => argv.includes('update-ref')).length
    assert.equal(updates, 1)
    assert.equal((await store.write('sample', { title: 'UTF-8 中 "quoted"' }, options)).commit, saved.commit)
    assert.equal(calls.filter(argv => argv.includes('update-ref')).length, updates)
    await scope.close()
    await assert.rejects(scope.spawn({ argv: ['git', 'status'], cwd: root }), /scope has ended/)
  } finally {
    scope?.stop()
    await scope?.close().catch(() => {})
    child?.kill('SIGKILL')
    await rm(root, { recursive: true, force: true })
  }
})

/** Actual source worker/wire with separate observations; no native process-range claim. */
async function rawWorker(run) {
  const root = await mkdtemp(join(tmpdir(), 'git-worker-timing-'))
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'),
    fileURLToPath(new URL('../src/dsh-git-worker.ts', import.meta.url)), root], {
    cwd: root, env: { ...scrubbedParentEnv(), DSH_SUBPROCESS_CONTROL: 'pipe' },
    stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore', 'ignore', 'pipe'],
  })
  child.stdout.resume(); child.stderr.resume()
  const done = new Promise((yes, no) => { child.once('error', no); child.once('close', (exitCode, signal) => yes({ exitCode, signal })) })
  const channel = child.stdio[7], frames = readGitFrames(channel)[Symbol.asyncIterator]()
  let sequence = 0, failed = false
  try {
    assert.deepEqual((await frames.next()).value, { kind: 'json', value: { type: 'ready', version: 1 } })
    const send = async message => {
      const id = ++sequence, chunks = []
      await writeGitFrame(channel, { id, cwd: root, ...message })
      for (;;) {
        const frame = (await frames.next()).value
        if (frame === undefined) throw new Error('fixture worker channel ended')
        if (frame.kind === 'bytes') { assert.equal(frame.id, id); chunks.push(frame.bytes); continue }
        assert.equal(frame.value.type, message.type === 'native' ? 'native-result' : 'result'); assert.equal(frame.value.id, id)
        failed ||= frame.value.failure === 'execution-failed'
        return { result: frame.value, bytes: Buffer.concat(chunks) }
      }
    }
    const request = (argv, options = {}) => send({ type: 'run', argv: ['git', ...argv], env: scrubbedParentEnv(), ...options })
    request.native = (operation, options = {}) => send({ type: 'native', operation, ...options })
    request.disconnect = () => { failed = true; channel.end(); return done }
    request.root = root
    await run(request)
    if (!failed) {
      await writeGitFrame(channel, { type: 'close' })
      assert.deepEqual((await frames.next()).value, { kind: 'json', value: { type: 'closed' } })
      channel.end()
    }
    const outcome = await done
    assert.equal(outcome.exitCode, failed ? 1 : 0); assert.equal(outcome.signal, null)
  } finally { child.kill('SIGKILL'); channel.destroy(); await frames.return?.().catch(() => {}); await rm(root, { recursive: true, force: true }) }
}

test('actual worker rejects malformed native requests before loading a binding and preserves CLI behavior', { timeout: 15000 }, async () => rawWorker(async request => {
  for (const operation of [{ kind: 'run', argv: ['git', 'status'] }, { kind: 'blob', oid: 'a'.repeat(40), size: -1 }]) {
    const { result, bytes } = await request.native(operation)
    assert.deepEqual(result, { type: 'native-result', id: result.id, failure: 'invalid-request' })
    assert.equal(bytes.length, 0)
  }
  const wrongRoot = await request.native({ kind: 'head' }, { cwd: '/different-repository' })
  assert.equal(wrongRoot.result.failure, 'invalid-request')
  const cli = await request(['--version'])
  assert.match(cli.result.stdout, /^git version /)
}))

test('actual native worker publishes frozen blobs, streams exact chunks and refuses stale publication', { timeout: 15000 }, async () => rawWorker(async request => {
  for (const argv of [['init', '--quiet'], ['config', '--local', 'user.name', 'Fixture'],
    ['config', '--local', 'user.email', 'fixture@invalid'], ['commit', '--allow-empty', '-qm', 'Initial']]) {
    assert.equal((await request(argv)).result.exitCode, 0)
  }
  const head = (await request.native({ kind: 'head' })).result.value.head
  assert.match(head, /^[0-9a-f]{40}$/u)
  const stagingRoot = await mkdtemp(join(tmpdir(), 'native-git-worker-frozen-'))
  try {
    const bytes = Buffer.alloc((128 << 10) + 3)
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256
    const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    const source = join(stagingRoot, 'blob-0')
    await writeFile(source, bytes)
    const operation = { kind: 'publish', expectedHead: head, message: 'Native event:fixture', stagingRoot,
      files: [{ path: 'design_files/sample/image.bin', source, oid, mode: 0o100644 }] }
    const published = await request.native(operation)
    assert.equal(published.result.failure, undefined)
    const commit = published.result.value.commit
    assert.match(commit, /^[0-9a-f]{40}$/u)
    assert.equal((await request.native({ kind: 'head' })).result.value.head, commit)
    const entry = await request.native({ kind: 'entry', commit, path: operation.files[0].path })
    assert.deepEqual(entry.result.value, { commitFound: true, entry: { oid, mode: 0o100644 } })
    const blob = await request.native({ kind: 'blob', oid, size: bytes.length })
    assert.deepEqual(blob.bytes, bytes)
    assert.equal(blob.result.value.size, bytes.length)
    assert.deepEqual((await request(['cat-file', 'blob', oid], { binaryMax: bytes.length })).bytes, bytes)
    assert.ok((await request.native({ kind: 'tree', commit })).result.value.entries.some(entry => entry.path === operation.files[0].path && entry.oid === oid))
    const stale = await request.native(operation)
    assert.equal(stale.result.failure, 'stale-publication')
    assert.equal((await request(['rev-parse', 'HEAD'])).result.stdout.trim(), commit)
  } finally { await rm(stagingRoot, { recursive: true, force: true }) }
}))

test('native worker channel EOF aborts an admitted publication before its commit fence', { timeout: 15000 }, async () => rawWorker(async request => {
  for (const argv of [['init', '--quiet'], ['config', '--local', 'user.name', 'Fixture'],
    ['config', '--local', 'user.email', 'fixture@invalid'], ['commit', '--allow-empty', '-qm', 'Initial']]) {
    assert.equal((await request(argv)).result.exitCode, 0)
  }
  const head = (await request(['rev-parse', 'HEAD'])).result.stdout.trim()
  const stagingRoot = await mkdtemp(join(tmpdir(), 'native-git-worker-aborted-'))
  try {
    const bytes = Buffer.from('must remain unpublished')
    const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    const source = join(stagingRoot, 'blob-0')
    await writeFile(source, bytes)
    const pending = request.native({ kind: 'publish', expectedHead: head, message: 'Aborted publication', stagingRoot,
      files: [{ path: 'design_files/aborted.json', source, oid, mode: 0o100644 }] })
    const exited = request.disconnect()
    const result = await pending.catch(() => undefined)
    await exited
    assert.equal(result?.result.value?.commit, undefined)
    const actual = await nodeDesignProjectSpawn({ argv: ['git', 'rev-parse', 'HEAD'], cwd: request.root })
    assert.equal(actual.exitCode, 0)
    assert.equal(actual.stdout.trim(), head)
  } finally { await rm(stagingRoot, { recursive: true, force: true }) }
}))

function checkedTiming(result) {
  assert.deepEqual(gitWorkerTiming(result.timing), result.timing)
  assert(Object.keys(result.timing).length > 0)
  for (const [name, value] of Object.entries(result.timing)) {
    assert(GIT_WORKER_TIMING_FIELDS.includes(name)); assert(Number.isSafeInteger(value) && value >= 0 && value <= 0x7fffffff)
    assert(value <= result.timing.workerUntilReplyStartMs)
  }
  return result.timing
}

test('actual worker default request/result/ready fields remain unchanged without exact per-run opt-in', { timeout: 15000 }, async () => rawWorker(async request => {
  for (const options of [{}, { timing: false }, { timing: 'true' }]) {
    const { result } = await request(['--version'], options)
    assert.match(result.stdout, /^git version /)
    assert.equal(result.timing, undefined)
    assert.deepEqual(Object.keys(result), ['type', 'id', 'exitCode', 'stdout', 'stderr'])
    assert.equal(JSON.stringify(result), JSON.stringify({ type: 'result', id: result.id, exitCode: 0, stdout: result.stdout, stderr: '' }))
  }
}))

test('actual worker opt-in marks existing output/drain/exit boundaries and never invents first-output zeroes', { timeout: 15000 }, async () => rawWorker(async request => {
  const quiet = await request(['init', '--quiet'], { timing: true })
  const empty = checkedTiming(quiet.result)
  assert.equal(quiet.result.stdout, ''); assert.equal(quiet.result.stderr, '')
  assert.equal(empty.workerFirstStdoutMs, undefined); assert.equal(empty.workerFirstStderrMs, undefined)
  for (const field of ['workerSpawnReturnMs', 'workerSpawnEventMs', 'workerExitMs', 'workerCloseMs', 'workerStdoutDrainedMs', 'workerStderrDrainedMs']) assert.equal(typeof empty[field], 'number')
  const text = await request(['--version'], { timing: true }), marks = checkedTiming(text.result)
  assert.equal(typeof marks.workerFirstStdoutMs, 'number'); assert.equal(marks.workerFirstStderrMs, undefined)
  const error = await request(['--not-a-git-option'], { timing: true }), errorMarks = checkedTiming(error.result)
  assert.notEqual(error.result.exitCode, 0); assert.equal(typeof errorMarks.workerFirstStderrMs, 'number')
  const binary = await request(['--version'], { timing: true, binaryMax: 1024 })
  assert.match(binary.bytes.toString('utf8'), /^git version /); assert.equal(binary.result.stdout, ''); checkedTiming(binary.result)
  const overflow = await request(['--version'], { timing: true, binaryMax: 0 })
  assert.equal(overflow.result.failure, 'binary-overflow'); assert.equal(overflow.bytes.length, 0); checkedTiming(overflow.result)
}))

test('actual worker spawn failure carries only reached marks and does not replace the existing failure frame', { timeout: 15000 }, async () => rawWorker(async request => {
  const { result } = await request(['--version'], { timing: true, env: { ...scrubbedParentEnv(), PATH: '/nonexistent-yugoo-worker-fixture' } })
  assert.equal(result.failure, 'execution-failed'); assert.equal(result.stdout, undefined)
  const timing = checkedTiming(result)
  assert.equal(typeof timing.workerSpawnReturnMs, 'number'); assert.equal(timing.workerSpawnEventMs, undefined)
  assert.doesNotMatch(JSON.stringify(timing), /path|argv|env|error|nonexistent/i)
}))
