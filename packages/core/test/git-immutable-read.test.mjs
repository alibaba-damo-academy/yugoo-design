import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The same actual-Git cases also exercise the package's compiled public entry.
const { GitVersioning, GitBlobSizeLimitError, collectGitStdout } = await import(new URL(
  process.env.YUGOO_GIT_READ_MODULE ?? '../src/git.ts', import.meta.url))

async function subprocess({ argv, cwd, signal, env, binaryStdout }) {
  const child = spawn(argv[0], argv.slice(1), { cwd, signal,
    env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const [exitCode, output] = await Promise.all([
    new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) }),
    collectGitStdout(child.stdout, binaryStdout),
  ])
  return { exitCode, ...output, stderr }
}

async function fixture(t, format = 'sha1') {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-git-immutable-read-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const command = async (...args) => {
    const result = await subprocess({ argv: ['git', ...args], cwd: root })
    assert.equal(result.exitCode, 0, result.stderr)
    return result.stdout.trim()
  }
  const initialized = await subprocess({ argv: ['git', 'init', '--quiet',
    ...(format === 'sha1' ? [] : [`--object-format=${format}`])], cwd: root })
  if (format === 'sha256' && initialized.exitCode !== 0 && /unknown option.*object-format/.test(initialized.stderr)) {
    t.skip('the configured Git predates SHA-256 repositories')
    return
  }
  assert.equal(initialized.exitCode, 0, initialized.stderr)
  const files = new Map([
    ['sample/raw.bin', Buffer.from([0, 255, 128, 13, 10, 195, 169])],
    ['sample/empty.bin', Buffer.alloc(0)],
    ['sample/中文 空白😀.bin', Buffer.from('中文\nUnicode 😀\r\n')],
    ['sample/[x].bin', Buffer.from('literal brackets')],
    ['sample/x.bin', Buffer.from('a pathspec must not select this')],
    ['sample/-leading.bin', Buffer.from('leading dash')],
  ])
  if (process.platform !== 'win32') {
    files.set('sample/[x]*?.bin', Buffer.from('literal bracket, star and question mark'))
    files.set('sample/:literal.bin', Buffer.from('literal colon'))
  }
  // Build immutable fixture objects without relying on checkout conversion.
  for (const [path, bytes] of files) {
    const source = join(root, 'fixture-blob')
    await writeFile(source, bytes)
    const oid = await command('hash-object', '--no-filters', '-w', '--', source)
    await command('update-index', '--add', '--cacheinfo', `${path === 'sample/-leading.bin' ? '100755' : '100644'},${oid},design_files/${path}`)
  }
  const tree = await command('write-tree')
  const commit = await command('-c', 'user.name=test', '-c', 'user.email=test@local', 'commit-tree', tree, '-m', 'immutable read fixture')
  return { root, command, commit, files,
    reader: adapter => new GitVersioning(adapter ?? subprocess, root, 'design_files') }
}

test('one immutable path list validates the commit in a single Git command', async t => {
  const f = await fixture(t)
  const calls = []
  const reader = f.reader(request => { calls.push(request); return subprocess(request) })
  assert.deepEqual(await reader.listPathsAt(f.commit), [...f.files.keys()].sort())
  assert.equal(calls.length, 1, 'one uncached path list must launch only one Git subprocess')
  assert.deepEqual(calls[0].argv, ['git', 'ls-tree', '-r', '-z', '--name-only', `${f.commit}^{commit}`])
  assert.equal(calls[0].binaryStdout, undefined)
})

for (const format of ['sha1', 'sha256']) test(`${format} path lists preserve literal names, prefixes and commit-only revisions`, async t => {
  const f = await fixture(t, format)
  if (!f) return
  const expected = [...f.files.keys()].sort()
  const reader = f.reader()
  assert.deepEqual(await reader.listPathsAt(f.commit), expected)
  assert.equal(Object.isFrozen(await reader.listPathsAt(f.commit)), true)
  assert.deepEqual(await new GitVersioning(subprocess, f.root).listPathsAt(f.commit), expected.map(path => `design_files/${path}`))
  assert.deepEqual(await new GitVersioning(subprocess, f.root, 'design_files/sample').listPathsAt(f.commit),
    expected.map(path => path.slice('sample/'.length)).sort())
  assert.deepEqual(await new GitVersioning(subprocess, f.root, 'missing').listPathsAt(f.commit), [])
  const tree = await f.command('rev-parse', `${f.commit}^{tree}`)
  const blob = await f.command('rev-parse', `${f.commit}:design_files/sample/raw.bin`)
  for (const revision of ['f'.repeat(f.commit.length), tree, blob, 'HEAD', f.commit.slice(0, 12), f.commit.toUpperCase()]) {
    await assert.rejects(reader.listPathsAt(revision))
  }
  for (const [name, target, accepted] of [['list-commit', f.commit, true], ['list-tree', tree, false], ['list-blob', blob, false]]) {
    await f.command('-c', 'user.name=test', '-c', 'user.email=test@local', '-c', 'tag.gpgsign=false', 'tag', '-a', name, '-m', name, target)
    const oid = await f.command('rev-parse', `refs/tags/${name}`)
    if (accepted) assert.deepEqual(await reader.listPathsAt(oid), expected)
    else await assert.rejects(reader.listPathsAt(oid))
  }
  const tag = await f.command('rev-parse', 'refs/tags/list-commit')
  await f.command('-c', 'user.name=test', '-c', 'user.email=test@local', '-c', 'tag.gpgsign=false', 'tag', '-a', 'list-nested', '-m', 'nested tag', tag)
  assert.deepEqual(await reader.listPathsAt(await f.command('rev-parse', 'refs/tags/list-nested')), expected)
  const emptyTree = await f.command('mktree')
  const emptyCommit = await f.command('-c', 'user.name=test', '-c', 'user.email=test@local', 'commit-tree', emptyTree, '-m', 'empty tree')
  assert.deepEqual(await reader.listPathsAt(emptyCommit), [])
})

test('path listing retains symlink and gitlink names without treating them as readable regular files', async t => {
  const f = await fixture(t)
  const oid = await f.command('rev-parse', `${f.commit}:design_files/sample/[x].bin`)
  await f.command('update-index', '--add', '--cacheinfo', `120000,${oid},design_files/sample/link`)
  await f.command('update-index', '--add', '--cacheinfo', `160000,${f.commit},design_files/sample/gitlink`)
  const tree = await f.command('write-tree')
  const commit = await f.command('-c', 'user.name=test', '-c', 'user.email=test@local', 'commit-tree', tree, '-m', 'listed entry kinds')
  const reader = f.reader()
  assert.deepEqual(await reader.listPathsAt(commit), [...f.files.keys(), 'sample/link', 'sample/gitlink'].sort())
  await assert.rejects(reader.readBytesAt(commit, 'sample/link'), /not a regular file/)
  await assert.rejects(reader.readBytesAt(commit, 'sample/gitlink'), /not a regular file/)
})

test('path lists reject unsafe or malformed paths before prefix filtering', async () => {
  const valid = 'design_files/z\0elsewhere/safe\0design_files/:literal\0design_files/a\0'
  let output = valid
  const reader = new GitVersioning(async request => ({ exitCode: 0,
    stdout: request.argv[1] === 'ls-tree' ? output : '', stderr: '' }), '/unused', 'design_files')
  assert.deepEqual(await reader.listPathsAt('a'.repeat(64)), [':literal', 'a', 'z'])
  for (output of [valid.slice(0, -1), 'design_files/a\0design_files/a\0',
    ...['/absolute', 'trailing/', 'elsewhere/../bad', 'elsewhere/./bad', 'elsewhere//bad',
      'elsewhere/.git/config', 'elsewhere/back\\slash', 'elsewhere/line\nbreak', 'elsewhere/del\x7f'].map(path => `${path}\0`)]) {
    await assert.rejects(reader.listPathsAt('a'.repeat(64)), /unsafe path|non-terminated|repeated path/)
  }
  output = ''
  assert.deepEqual(await reader.listPathsAt('a'.repeat(40)), [])
})

test('path-list cache retains exact revision scope and does not retain command or parser failures', async () => {
  const calls = []
  let exitCode = 72, output = 'design_files/a\0'
  const adapter = async request => {
    calls.push(request)
    return request.argv[1] === 'ls-tree' ? { exitCode, stdout: output, stderr: 'fixture failure' }
      : { exitCode: 0, stdout: '', stderr: '' }
  }
  const reader = new GitVersioning(adapter, '/unused', 'design_files', true)
  const revision = 'a'.repeat(40)
  await assert.rejects(reader.listPathsAt(revision), /exited 72/)
  exitCode = 0; output = 'design_files/a'
  await assert.rejects(reader.listPathsAt(revision), /non-terminated/)
  output = 'design_files/a\0'
  const paths = await reader.listPathsAt(revision)
  const warmCalls = calls.length
  assert.deepEqual(await reader.listPathsAt(revision), ['a'])
  assert.equal(calls.length, warmCalls)
  assert.throws(() => paths.push('mutated'), TypeError)
  const cancelled = new AbortController(); cancelled.abort(new Error('cancel cached listing'))
  await assert.rejects(reader.listPathsAt(revision, cancelled.signal), /cancel cached listing/)
  assert.equal(calls.length, warmCalls)
  await reader.listPathsAt('b'.repeat(40))
  assert.equal(calls.filter(call => call.argv[1] === 'ls-tree').length, 4, 'a different immutable revision must be read')
  assert.deepEqual(await new GitVersioning(adapter, '/other', 'other', true).listPathsAt(revision), [])
  assert.equal(calls.filter(call => call.argv[1] === 'ls-tree').length, 5, 'cache entries must not leak across instances')
})

test('path-list cancellation launches nothing when pre-aborted and cancels an active Git read', async t => {
  const f = await fixture(t)
  let calls = 0
  const cancelled = new AbortController(); cancelled.abort(new Error('cancel before listing'))
  const reader = f.reader(request => { calls++; return subprocess(request) })
  await assert.rejects(reader.listPathsAt(f.commit, cancelled.signal), /cancel before listing/)
  assert.equal(calls, 0)
  const during = new AbortController()
  const active = f.reader(request => {
    calls++
    const running = subprocess(request)
    during.abort(new Error('cancel active listing'))
    return running
  })
  await assert.rejects(active.listPathsAt(f.commit, during.signal), error => error.name === 'AbortError')
  assert.equal(calls, 1)
})

test('a listing cancelled at completion never becomes a successful cached result', async () => {
  const controller = new AbortController()
  let cancel = true, calls = 0
  const reader = new GitVersioning(async request => {
    calls++
    if (cancel) { cancel = false; controller.abort(new Error('cancel completed listing')) }
    return { exitCode: 0, stdout: request.argv[1] === 'ls-tree' ? 'design_files/a\0' : '', stderr: '' }
  }, '/unused', 'design_files', true)
  const revision = 'a'.repeat(40)
  await assert.rejects(reader.listPathsAt(revision, controller.signal), /cancel completed listing/)
  const beforeRetry = calls
  assert.deepEqual(await reader.listPathsAt(revision), ['a'])
  assert.ok(calls > beforeRetry, 'the cancelled operation must be retried')
  const warmCalls = calls
  assert.deepEqual(await reader.listPathsAt(revision), ['a'])
  assert.equal(calls, warmCalls)
})

test('one immutable binary read launches only metadata and raw blob Git commands', async t => {
  const f = await fixture(t)
  const calls = []
  const reader = f.reader(request => { calls.push(request); return subprocess(request) })
  assert.deepEqual(Buffer.from(await reader.readBytesAt(f.commit, 'sample/raw.bin')), f.files.get('sample/raw.bin'))
  assert.equal(calls.length, 2, 'one immutable read must launch two Git subprocesses')
  assert.deepEqual(calls[0].argv, ['git', 'ls-tree', '-l', '-z', `${f.commit}^{commit}`, '--', ':(literal)design_files/sample/raw.bin'])
  assert.deepEqual(calls[1].argv.slice(0, 3), ['git', 'cat-file', 'blob'])
  assert.deepEqual(calls[1].binaryStdout, { maxBytes: f.files.get('sample/raw.bin').length })
})

test('one immutable text read uses two Git commands with a text-only adapter', async t => {
  const f = await fixture(t)
  const calls = []
  const reader = f.reader(async request => {
    assert.equal(request.binaryStdout, undefined, 'text reads must not require raw-byte adapter support')
    calls.push(request)
    const result = await subprocess(request)
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  })
  assert.equal(await reader.readTextAt(f.commit, 'sample/中文 空白😀.bin'), f.files.get('sample/中文 空白😀.bin').toString('utf8'))
  assert.equal(calls.length, 2, 'one committed text read must launch only metadata and blob subprocesses')
  assert.equal(calls[0].argv[1], 'ls-tree')
  assert.deepEqual(calls[1].argv.slice(0, 3), ['git', 'cat-file', 'blob'])
})

for (const format of ['sha1', 'sha256']) test(`${format} text reads preserve decoded bytes, literal paths and revision errors`, async t => {
  const f = await fixture(t, format)
  if (!f) return
  const reader = f.reader()
  for (const [path, bytes] of f.files) assert.equal(await reader.readTextAt(f.commit, path), bytes.toString('utf8'), path)
  assert.equal(await reader.readTextAt(f.commit, 'sample/missing.bin'), undefined)
  await assert.rejects(reader.readTextAt('f'.repeat(f.commit.length), 'sample/raw.bin'))
  const tree = await f.command('rev-parse', `${f.commit}^{tree}`)
  const blob = await f.command('rev-parse', `${f.commit}:design_files/sample/raw.bin`)
  await assert.rejects(reader.readTextAt(tree, 'sample/raw.bin'))
  await assert.rejects(reader.readTextAt(blob, 'sample/raw.bin'))
  for (const revision of ['HEAD', f.commit.slice(0, 12), f.commit.toUpperCase()]) {
    await assert.rejects(reader.readTextAt(revision, 'sample/raw.bin'), /full lowercase object id/)
  }
  for (const path of ['../sample/raw.bin', '/sample/raw.bin', 'sample/../raw.bin', 'sample\\raw.bin', 'sample/', 'sample/line\nbreak']) {
    await assert.rejects(reader.readTextAt(f.commit, path), /unsafe path/)
  }
  assert.equal(await new GitVersioning(subprocess, f.root).readTextAt(f.commit, 'design_files/sample/[x].bin'), 'literal brackets')
})

test('text reads retain symlink blobs and peeled commit tags while rejecting nonblobs', async t => {
  const f = await fixture(t)
  const oid = await f.command('rev-parse', `${f.commit}:design_files/sample/[x].bin`)
  await f.command('update-index', '--add', '--cacheinfo', `120000,${oid},design_files/sample/link`)
  await f.command('update-index', '--add', '--cacheinfo', `160000,${f.commit},design_files/sample/gitlink`)
  const tree = await f.command('write-tree')
  const linked = await f.command('-c', 'user.name=test', '-c', 'user.email=test@local', 'commit-tree', tree, '-p', f.commit, '-m', 'text entry kinds')
  const reader = f.reader()
  assert.equal(await reader.readTextAt(linked, 'sample/link'), 'literal brackets')
  await assert.rejects(reader.readTextAt(linked, 'sample'))
  await assert.rejects(reader.readTextAt(linked, 'sample/gitlink'))
  for (const [name, target, readable] of [['commit-tag', linked, true], ['tree-tag', tree, false], ['blob-tag', oid, false]]) {
    await f.command('-c', 'user.name=test', '-c', 'user.email=test@local', '-c', 'tag.gpgsign=false', 'tag', '-a', name, '-m', name, target)
    const tag = await f.command('rev-parse', `refs/tags/${name}`)
    if (readable) assert.equal(await reader.readTextAt(tag, 'sample/link'), 'literal brackets')
    else await assert.rejects(reader.readTextAt(tag, 'sample/link'))
  }
})

test('committed text paths remain repository-relative when the adapter cwd is a subdirectory', async t => {
  const f = await fixture(t)
  const cwd = join(f.root, 'nested-cwd')
  await mkdir(cwd)
  const reader = new GitVersioning(subprocess, cwd, 'design_files')
  assert.equal(await reader.readTextAt(f.commit, 'sample/[x].bin'), 'literal brackets')
})

test('text reads retain absent-object behavior for incomplete commits and gitlinks', async t => {
  const f = await fixture(t)
  const missing = 'f'.repeat(f.commit.length)
  const commitFile = join(f.root, 'incomplete-commit')
  await writeFile(commitFile, `tree ${missing}\nauthor test <test@local> 1 +0000\ncommitter test <test@local> 1 +0000\n\nMissing tree\n`)
  const withoutTree = await f.command('hash-object', '-t', 'commit', '-w', '--', commitFile)
  const reader = f.reader()
  assert.equal(await reader.readTextAt(withoutTree, 'sample/raw.bin'), undefined)
  await f.command('update-index', '--add', '--cacheinfo', `100644,${missing},design_files/sample/missing-object`)
  await f.command('update-index', '--add', '--cacheinfo', `160000,${missing},design_files/sample/missing-gitlink`)
  const tree = await f.command('write-tree', '--missing-ok')
  const incomplete = await f.command('-c', 'user.name=test', '-c', 'user.email=test@local', 'commit-tree', tree, '-m', 'missing objects')
  assert.equal(await reader.readTextAt(incomplete, 'sample/missing-object'), undefined)
  assert.equal(await reader.readTextAt(incomplete, 'sample/missing-gitlink'), undefined)
})

test('text metadata accepts full SHA-256 ids and rejects mismatched or malformed entries', async () => {
  const commit = 'a'.repeat(64), oid = 'b'.repeat(64)
  const valid = `120000 blob ${oid} 4\tdesign_files/sample/link\0`
  const calls = []
  let metadata = valid
  const reader = new GitVersioning(async request => {
    calls.push(request)
    return { exitCode: 0, stdout: request.argv[1] === 'ls-tree' ? metadata : 'text', stderr: '' }
  }, '/unused', 'design_files')
  assert.equal(await reader.readTextAt(commit, 'sample/link'), 'text')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].argv.at(-1), oid)
  // Parser/dispatch compatibility only: this does not exercise a real dual-hash repository.
  assert.equal(await reader.readTextAt('a'.repeat(40), 'sample/link'), 'text')
  assert.equal(calls.at(-1).argv.at(-1), oid)
  for (metadata of [valid.slice(0, -1), valid + valid, valid.replace('sample/link', 'sample/other'),
    valid.replace(oid, 'b'.repeat(39)), valid.replace(' 4\t', ' -\t'), valid.replace(' 4\t', ' 9007199254740992\t')]) {
    calls.length = 0
    await assert.rejects(reader.readTextAt(commit, 'sample/link'), /invalid/)
    assert.equal(calls.length, 1, 'invalid metadata must not select a blob or use the exceptional fallback')
  }
})

test('text-read cancellation prevents both initial metadata and subsequent blob launches', async t => {
  const f = await fixture(t)
  const cancelled = new AbortController()
  cancelled.abort(new Error('cancel before metadata'))
  let calls = 0
  const reader = f.reader(request => { calls++; return subprocess(request) })
  await assert.rejects(reader.readTextAt(f.commit, 'sample/raw.bin', cancelled.signal), /cancel before metadata/)
  assert.equal(calls, 0)
  const controller = new AbortController()
  const during = f.reader(async request => {
    calls++
    const result = await subprocess(request)
    controller.abort(new Error('cancel after text metadata'))
    return result
  })
  await assert.rejects(during.readTextAt(f.commit, 'sample/raw.bin', controller.signal), /cancel after text metadata/)
  assert.equal(calls, 1)
})

for (const format of ['sha1', 'sha256']) test(`${format} reads preserve empty, binary, Unicode and literal Git paths`, async t => {
  const f = await fixture(t, format)
  if (!f) return
  assert.equal(f.commit.length, format === 'sha1' ? 40 : 64)
  const reader = f.reader()
  for (const [path, bytes] of f.files) {
    assert.deepEqual(Buffer.from(await reader.readBytesAt(f.commit, path)), bytes, path)
  }
  assert.equal(await reader.readBytesAt(f.commit, 'sample/missing.bin'), undefined)
  assert.equal(await reader.readBytesAt('f'.repeat(f.commit.length), 'sample/raw.bin'), undefined)
  const tree = await f.command('rev-parse', `${f.commit}^{tree}`)
  assert.equal(await reader.readBytesAt(tree, 'sample/raw.bin'), undefined)
  const blob = await f.command('rev-parse', `${f.commit}:design_files/sample/raw.bin`)
  assert.equal(await reader.readBytesAt(blob, 'sample/raw.bin'), undefined)
  assert.deepEqual(Buffer.from(await new GitVersioning(subprocess, f.root).readBytesAt(f.commit, 'design_files/sample/raw.bin')), f.files.get('sample/raw.bin'))
  await assert.rejects(reader.readBytesAt('HEAD', 'sample/raw.bin'), /full lowercase object id/)
  for (const path of ['../sample/raw.bin', '/sample/raw.bin', 'sample/../raw.bin', 'sample\\raw.bin', 'sample/line\nbreak']) {
    await assert.rejects(reader.readBytesAt(f.commit, path), /unsafe path/)
  }
})

test('size, cancellation, missing paths and nonregular entries stop before raw blob capture', async t => {
  const f = await fixture(t)
  const calls = []
  const reader = f.reader(request => { calls.push(request); return subprocess(request) })
  const path = 'sample/raw.bin'
  const bytes = f.files.get(path)
  for (const maxBytes of [1, bytes.length - 1, 0]) {
    calls.length = 0
    await assert.rejects(reader.readBytesAt(f.commit, path, undefined, maxBytes), error => {
      assert.ok(error instanceof GitBlobSizeLimitError)
      assert.equal(error.name, 'GitBlobSizeLimitError')
      assert.equal(error.path, path)
      assert.equal(error.size, bytes.length)
      assert.equal(error.maxBytes, maxBytes)
      assert.equal(error.message, `design git: committed artifact ${JSON.stringify(path)} exceeds ${maxBytes} bytes`)
      return true
    })
    assert.deepEqual(calls.map(request => request.argv[1]), ['ls-tree'])
    assert.equal(calls[0].binaryStdout, undefined)
  }
  calls.length = 0
  assert.deepEqual(Buffer.from(await reader.readBytesAt(f.commit, path, undefined, bytes.length)), bytes)
  assert.deepEqual(calls.map(request => request.argv[1]), ['ls-tree', 'cat-file'])
  assert.deepEqual(calls[1].binaryStdout, { maxBytes: bytes.length })
  calls.length = 0
  assert.deepEqual(Buffer.from(await reader.readBytesAt(f.commit, 'sample/empty.bin', undefined, 0)), Buffer.alloc(0))
  assert.deepEqual(calls.map(request => request.argv[1]), ['ls-tree', 'cat-file'])
  assert.deepEqual(calls[1].binaryStdout, { maxBytes: 0 })
  calls.length = 0
  const cancelled = new AbortController(); cancelled.abort(new Error('cancel immutable read'))
  await assert.rejects(reader.readBytesAt(f.commit, 'sample/raw.bin', cancelled.signal), /cancel immutable read|aborted/)
  assert.equal(calls.length, 0)
  const controller = new AbortController()
  const during = f.reader(async request => {
    const result = await subprocess(request)
    controller.abort(new Error('cancel after metadata'))
    return result
  })
  await assert.rejects(during.readBytesAt(f.commit, 'sample/raw.bin', controller.signal), /cancel after metadata|aborted/)
  const oid = await f.command('rev-parse', `${f.commit}:design_files/sample/raw.bin`)
  await f.command('update-index', '--add', '--cacheinfo', `120000,${oid},design_files/sample/link`)
  const tree = await f.command('write-tree')
  const linked = await f.command('-c', 'user.name=test', '-c', 'user.email=test@local', 'commit-tree', tree, '-p', f.commit, '-m', 'nonregular fixture')
  await assert.rejects(reader.readBytesAt(linked, 'sample/link'), /not a regular file/)
  await assert.rejects(reader.readBytesAt(f.commit, 'sample'), /not a regular file/)
})

test('malformed metadata never selects another object or bypasses the raw byte guards', async t => {
  const f = await fixture(t)
  const original = await subprocess({ argv: ['git', 'ls-tree', '-l', '-z', f.commit, '--', ':(literal)design_files/sample/raw.bin'], cwd: f.root })
  const valid = original.stdout
  const tab = valid.indexOf('\t')
  const header = valid.slice(0, tab)
  const suffix = valid.slice(tab)
  const oid = /[a-f0-9]{40}/.exec(header)[0]
  for (const stdout of [
    valid.slice(0, -1), valid + valid, valid + '\n', valid + '\0', valid.replace('design_files/sample/raw.bin', 'design_files/sample/other.bin'),
    valid.replace('100644 blob', '100644 tree'), valid.replace(oid, 'g'.repeat(40)),
    valid.replace(oid, 'a'.repeat(64)), header.replace(/\s+\d+$/, ' -1') + suffix,
    header.replace(/\s+\d+$/, ' 9007199254740992') + suffix, header.replace(/\s+\d+$/, ' 1e1') + suffix,
    header.replace(/\s+\d+$/, ' -') + suffix, 'unexpected\0',
  ]) {
    let raw = 0
    const reader = f.reader(async request => {
      if (request.argv[1] === 'ls-tree') return { ...original, stdout }
      raw += 1
      return subprocess(request)
    })
    await assert.rejects(reader.readBytesAt(f.commit, 'sample/raw.bin'), /invalid|regular file|metadata|entry|size/)
    assert.equal(raw, 0, JSON.stringify(stdout))
  }
  for (const change of ['unsupported', 'short', 'long', 'wrong']) {
    const reader = f.reader(async request => {
      const result = await subprocess(request)
      if (!request.binaryStdout) return result
      if (change === 'unsupported') return { ...result, stdoutBytes: undefined, stdout: 'decoded' }
      if (change === 'short') return { ...result, stdoutBytes: result.stdoutBytes.slice(0, -1) }
      if (change === 'long') return { ...result, stdoutBytes: Buffer.concat([result.stdoutBytes, Buffer.from([1])]) }
      return { ...result, stdoutBytes: Buffer.alloc(result.stdoutBytes.length) }
    })
    await assert.rejects(reader.readBytesAt(f.commit, 'sample/raw.bin'), /binary stdout|integrity mismatch/)
  }
})
