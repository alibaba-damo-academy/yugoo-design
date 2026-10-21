import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { GitVersioning } from '../src/git.ts'

const exec = promisify(execFile)
const result = (stdout = '', exitCode = 0) => ({ stdout, exitCode, stderr: '' })
const isCombined = argv => argv[1] === 'rev-parse' && argv.includes('--show-object-format') && argv.includes('--verify')

async function spawn(request) {
  try {
    return { exitCode: 0, ...await exec(request.argv[0], request.argv.slice(1), {
      cwd: request.cwd, signal: request.signal, encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...request.env },
    }) }
  } catch (error) {
    if (typeof error.code !== 'number') throw error
    return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

async function fixture(t, { format = 'sha1', born = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-publication-preparation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const command = (...args) => spawn({ argv: ['git', ...args], cwd: root })
  const initialized = await command('init', '--quiet', ...(format === 'sha1' ? [] : [`--object-format=${format}`]))
  if (format === 'sha256' && initialized.exitCode !== 0 && /unknown option.*object-format/.test(initialized.stderr)) {
    t.skip('the configured Git predates SHA-256 repositories')
    return
  }
  assert.equal(initialized.exitCode, 0, initialized.stderr)
  const checked = async (...args) => {
    const value = await command(...args)
    assert.equal(value.exitCode, 0, value.stderr)
    return value.stdout.trim()
  }
  let head
  if (born) {
    await writeFile(join(root, 'design.txt'), 'base\n')
    await checked('add', '--', 'design.txt')
    await checked('-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '--quiet', '-m', 'base')
    head = await checked('rev-parse', 'HEAD')
  }
  const calls = []
  let before, after
  const git = new GitVersioning(async request => {
    calls.push(request)
    const replacement = await before?.(request)
    const value = replacement ?? await spawn(request)
    return await after?.(request, value) ?? value
  }, root)
  return { root, head, calls, git, checked,
    before(callback) { before = callback }, after(callback) { after = callback } }
}

for (const format of ['sha1', 'sha256']) for (const born of [false, true]) {
  test(`${format} ${born ? 'existing' : 'unborn'} publication reads explicit format and fresh HEAD together`, async t => {
    const f = await fixture(t, { format, born })
    if (!f) return
    const receipt = await f.git.commitExactReceipt('next', new Map([['design.txt', 'next\n']]), f.head)
    assert.ok(receipt.commit)
    assert.equal(receipt.indexMaintenance, undefined)
    const probes = f.calls.filter(call => call.argv.includes('--show-object-format'))
    assert.equal(probes.length, 1)
    assert.deepEqual(probes[0].argv, ['git', 'rev-parse', '--show-object-format', '--verify', '--quiet', 'HEAD'])
    const cas = f.calls.findIndex(call => call.argv[1] === 'update-ref')
    assert.equal(f.calls.slice(0, cas).filter(call => call.argv.at(-1) === 'HEAD').length, 1)
    assert.equal(f.calls.slice(cas + 1).filter(call => call.argv.at(-1) === 'HEAD').length, 2,
      'ordinary-index maintenance keeps both live HEAD fences')
    assert.equal(await f.checked('rev-parse', 'HEAD'), receipt.commit)
    if (born) assert.equal(await readFile(join(f.root, 'design.txt'), 'utf8'), 'base\n')
    else await assert.rejects(readFile(join(f.root, 'design.txt')), { code: 'ENOENT' })
    assert.equal(await f.checked('show', ':design.txt'), 'next')
    assert.equal(receipt.commit.length, format === 'sha1' ? 40 : 64)
  })
}

// The deliberate stale baseline stops accepted probe responses before writes.
function protocol(response, { files = new Map([['design.txt', 'next']]), force = false, signal, abort } = {}) {
  const calls = []
  const git = new GitVersioning(async request => {
    calls.push(request)
    if (isCombined(request.argv)) { abort?.(); return response }
    // Parent-source red checks retain its valid separate probes.
    if (request.argv.includes('--show-object-format')) { abort?.(); return result('sha1\n') }
    if (request.argv.at(-1) === 'HEAD') return result('a'.repeat(40) + '\n')
    throw new Error('unexpected operation after publication preparation')
  }, '/unused')
  return { calls, pending: git.commitExactReceipt('probe', files, 'c'.repeat(40), signal, force) }
}

test('combined publication probe retains full OIDs without adding a format-length coupling', async () => {
  for (const [text, exitCode, latest] of [
    [`sha1\n${'a'.repeat(40)}\n`, 0, JSON.stringify('a'.repeat(40))],
    [`sha256\r\n${'a'.repeat(64)}\r\n`, 0, JSON.stringify('a'.repeat(64))],
    [`sha1\n${'b'.repeat(64)}\n`, 0, JSON.stringify('b'.repeat(64))],
    ['sha256\n', 1, 'undefined'],
  ]) {
    const run = protocol(result(text, exitCode))
    await assert.rejects(run.pending, error => error.message.includes('publication revision is stale') && error.message.endsWith(`latest is ${latest}`))
    assert.equal(run.calls.length, 1)
  }
})

test('combined publication probe rejects malformed output and fatal exits before any write', async () => {
  const oid = 'a'.repeat(40)
  for (const [text, exitCode] of [
    ['', 0], ['sha512\n', 1], [`sha512\n${oid}\n`, 0], ['sha1\n', 0],
    [`sha1\n${oid}\nextra\n`, 0], [`sha1\n${oid}\n\n`, 0], [`sha1\n${oid}\n`, 1],
    ['sha1\nextra\n', 1], [`sha1\n${'A'.repeat(40)}\n`, 0], ['sha1\nshort\n', 0],
    ['sha1\n', 128], ['sha1\n', 72], [`sha1\n${oid}\n`, null],
  ]) {
    const run = protocol(result(text, exitCode))
    await assert.rejects(run.pending, /unsupported object format|invalid publication|full lowercase object id|exited (128|72|null)/)
    assert.equal(run.calls.length, 1, 'invalid metadata must not start index reads or writers')
  }
})

test('delete-only and empty forced publications still reject unsupported storage algorithms', async () => {
  for (const files of [new Map([['design.txt', undefined]]), new Map()]) {
    const run = protocol(result('sha512\n', 1), { files, force: true })
    await assert.rejects(run.pending, /unsupported object format/)
    assert.equal(run.calls.length, 1)
  }
})

test('publication cancellation before or just after the combined probe cannot enter writers', async () => {
  const before = new AbortController(); before.abort(new Error('cancel before publication probe'))
  const cold = protocol(result('sha1\n'), { signal: before.signal })
  await assert.rejects(cold.pending, /cancel before publication probe/)
  assert.equal(cold.calls.length, 0)
  const during = new AbortController()
  const active = protocol(result(`sha1\n${'a'.repeat(40)}\n`), {
    signal: during.signal, abort: () => during.abort(new Error('cancel completed publication probe')),
  })
  await assert.rejects(active.pending, /cancel completed publication probe/)
  assert.equal(active.calls.length, 1)
})

test('fresh combined HEAD rejects stale input and final CAS still rejects an external winner', async t => {
  const f = await fixture(t)
  const newer = await f.git.commitExactReceipt('newer', new Map([['design.txt', 'one\n']]), f.head)
  f.calls.length = 0
  await assert.rejects(f.git.commitExactReceipt('stale', new Map([['design.txt', 'two\n']]), f.head), /revision is stale/)
  assert.equal(f.calls.length, 1)
  let winner
  f.before(async request => {
    if (request.argv[1] !== 'update-ref') return
    const tree = await f.checked('rev-parse', `${newer.commit}^{tree}`)
    winner = await f.checked('-c', 'user.name=test', '-c', 'user.email=test@local', 'commit-tree', tree, '-p', newer.commit, '-m', 'external winner')
    await f.checked('update-ref', 'HEAD', winner, newer.commit)
  })
  await assert.rejects(f.git.commitExactReceipt('loser', new Map([['design.txt', 'two\n']]), newer.commit), /update-ref/)
  assert.equal(await f.checked('rev-parse', 'HEAD'), winner)
  assert.equal(await f.checked('show', ':design.txt'), 'one')
})

test('real malformed and unresolved HEAD retain their fatal and absent-head boundaries', async t => {
  const f = await fixture(t)
  const before = await readFile(join(f.root, '.git/index'))
  await writeFile(join(f.root, '.git/HEAD'), 'not a valid ref\n')
  await assert.rejects(f.git.commitExactReceipt('invalid HEAD', new Map([['design.txt', 'next']]), f.head), /exited 128/)
  assert.equal(f.calls.length, 1)
  assert.equal(isCombined(f.calls[0].argv), true)
  assert.deepEqual(await readFile(join(f.root, '.git/index')), before)
  f.calls.length = 0
  await writeFile(join(f.root, '.git/HEAD'), 'ref: refs/heads/unresolved\n')
  await assert.rejects(f.git.commitExactReceipt('unresolved HEAD', new Map([['design.txt', 'next']]), f.head),
    error => error.message.includes('revision is stale') && error.message.endsWith('latest is undefined'))
  assert.equal(f.calls.length, 1)
  assert.deepEqual(await readFile(join(f.root, '.git/index')), before)
})

const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function pairHarness(t, paths = ['design.txt']) {
  const controller = new AbortController(), firstRead = deferred()
  const gates = new Map(paths.flatMap(path => ['index', 'tree'].map(kind => [`${kind}:${path}`, deferred()])))
  const calls = [], started = []
  let finished = false
  const git = new GitVersioning(async request => {
    calls.push(request)
    if (isCombined(request.argv)) return result(`sha1\n${'a'.repeat(40)}\n`)
    const kind = request.argv[1] === 'ls-files' ? 'index' : request.argv[1] === 'ls-tree' ? 'tree' : undefined
    if (kind !== undefined && request.env === undefined) {
      const key = `${kind}:${request.argv.at(-1)}`
      assert.ok(gates.has(key), key)
      started.push(key); firstRead.resolve()
      assert.equal(request.signal, controller.signal)
      return gates.get(key).promise
    }
    throw new Error('stopped at first writer')
  }, '/unused')
  const pending = git.commitExactReceipt('paired reads', new Map(paths.map(path => [path, 'next'])), 'a'.repeat(40), controller.signal)
  void pending.then(() => { finished = true }, error => { finished = true; firstRead.reject(error) })
  const release = key => {
    const [kind, path] = key.split(':')
    gates.get(key).resolve(result(kind === 'index'
      ? `100644 ${'b'.repeat(40)} 0\t${path}\n` : `100644 blob ${'b'.repeat(40)}\t${path}\n`))
  }
  const close = async () => { for (const key of gates.keys()) release(key); await pending.catch(() => {}) }
  t.after(close)
  return { pending, calls, started, controller, firstRead: firstRead.promise, release,
    reject(key, error) { gates.get(key).reject(error) }, finished: () => finished,
    writers: () => calls.filter(call => !isCombined(call.argv) && !['ls-files', 'ls-tree'].includes(call.argv[1])) }
}

async function assertFirstPairStarted(h) {
  await h.firstRead
  await tick()
  assert.deepEqual(h.started, ['index:design.txt', 'tree:design.txt'], 'both independent reads must start before either is released')
  assert.equal(h.writers().length, 0)
}

for (const first of ['index', 'tree']) test(`paired preparation waits for ${first === 'index' ? 'tree' : 'index'} after ${first} succeeds`, async t => {
  const h = pairHarness(t)
  await assertFirstPairStarted(h)
  h.release(`${first}:design.txt`)
  await tick()
  assert.equal(h.finished(), false)
  assert.equal(h.writers().length, 0)
  h.release(`${first === 'index' ? 'tree' : 'index'}:design.txt`)
  await assert.rejects(h.pending, /stopped at first writer/)
  assert.equal(h.writers().length, 1)
})

for (const failed of ['index', 'tree']) test(`paired preparation drains its sibling when ${failed} fails`, async t => {
  const h = pairHarness(t)
  await assertFirstPairStarted(h)
  h.reject(`${failed}:design.txt`, new Error(`${failed} failed`))
  await tick()
  assert.equal(h.finished(), false, 'a rejection must not release the owner while its sibling is still pending')
  assert.equal(h.writers().length, 0)
  h.release(`${failed === 'index' ? 'tree' : 'index'}:design.txt`)
  await assert.rejects(h.pending, new RegExp(`${failed} failed`))
  assert.equal(h.writers().length, 0)
})

test('paired preparation drains both failures and preserves the original index-error priority', async t => {
  const h = pairHarness(t)
  await assertFirstPairStarted(h)
  h.reject('tree:design.txt', new Error('tree failed first'))
  await tick()
  assert.equal(h.finished(), false)
  h.reject('index:design.txt', new Error('index failure has original precedence'))
  await assert.rejects(h.pending, /index failure has original precedence/)
  assert.equal(h.writers().length, 0)
})

for (const first of ['index', 'tree']) test(`paired preparation drains cancellation with ${first} already completed`, async t => {
  const h = pairHarness(t)
  await assertFirstPairStarted(h)
  h.release(`${first}:design.txt`)
  h.controller.abort(new Error('cancel paired preparation'))
  await tick()
  assert.equal(h.finished(), false, 'even an adapter completing after cancellation must be drained')
  assert.equal(h.writers().length, 0)
  h.release(`${first === 'index' ? 'tree' : 'index'}:design.txt`)
  await assert.rejects(h.pending, /cancel paired preparation/)
  assert.equal(h.writers().length, 0)
})

test('paired preparation keeps paths sequential and starts no writer before every pair settles', async t => {
  const h = pairHarness(t, ['design.txt', 'other.txt'])
  await assertFirstPairStarted(h)
  h.release('index:design.txt')
  await tick()
  assert.deepEqual(h.started, ['index:design.txt', 'tree:design.txt'])
  h.release('tree:design.txt')
  await tick()
  assert.deepEqual(h.started, ['index:design.txt', 'tree:design.txt', 'index:other.txt', 'tree:other.txt'])
  h.release('tree:other.txt')
  await tick()
  assert.equal(h.writers().length, 0)
  h.release('index:other.txt')
  await assert.rejects(h.pending, /stopped at first writer/)
})

test('an external stage while the immutable baseline read is pending survives reconciliation', async t => {
  const f = await fixture(t)
  const indexRead = deferred(), treeStarted = deferred(), releaseTree = deferred()
  let held = false
  f.before(async request => {
    if (request.argv[1] === 'ls-tree' && !held) {
      held = true; treeStarted.resolve(); await releaseTree.promise
    }
  })
  f.after((request, value) => {
    if (request.argv[1] === 'ls-files' && request.env === undefined) indexRead.resolve()
    return value
  })
  const pending = f.git.commitExactReceipt('external stage', new Map([['design.txt', 'frozen design\n']]), f.head)
  void pending.catch(error => { indexRead.reject(error); treeStarted.reject(error) })
  try {
    await Promise.all([indexRead.promise, treeStarted.promise])
    await writeFile(join(f.root, 'design.txt'), 'external staged\n')
    await f.checked('add', '--', 'design.txt')
    releaseTree.resolve()
    const receipt = await pending
    assert.ok(receipt.commit)
    assert.equal(await f.checked('show', ':design.txt'), 'external staged')
    assert.equal(await f.checked('show', `${receipt.commit}:design.txt`), 'frozen design')
    assert.equal(await readFile(join(f.root, 'design.txt'), 'utf8'), 'external staged\n')
  } finally { releaseTree.resolve(); await pending.catch(() => {}) }
})
