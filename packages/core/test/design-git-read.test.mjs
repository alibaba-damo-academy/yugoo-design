import test from 'node:test'
import assert from 'node:assert/strict'
import { readDesignGit, designGitReadArguments } from '../src/design-git-read.ts'

const head = 'a'.repeat(40), old = 'b'.repeat(40), projectId = 'project-one'
function fixture() {
  const calls = []
  const git = new Proxy({
    head: async () => head,
    isAncestor: async (from, to) => from === old && to === head,
    historyAt: async () => [],
    commitMessageAt: async () => 'Complete message\n\nFull body\n',
    diffCommit: async () => '+current\n',
    diffBetween: async () => '-before\n+after\n',
    listEntriesAt: async () => [],
    readBytesAt: async () => Buffer.from('committed file\n'),
    blobOidAt: async () => 'c'.repeat(40),
  }, { get(target, name) { return typeof target[name] === 'function' ? (...args) => { calls.push([name, ...args]); return target[name](...args) } : target[name] } })
  return { git, projectId, calls, status: async () => ({ head, porcelain: '' }) }
}

test('complete diff and historical text round trip through pinned Unicode-safe pages', async () => {
  const f = fixture(), text = 'x'.repeat(16383) + '😀' + '中文\n'.repeat(18000)
  f.git.diffBetween = async () => text
  f.git.readBytesAt = async () => Buffer.from(text)
  for (const action of ['diff', 'read']) {
    let offset = 0, assembled = '', count = 0
    do {
      const result = await readDesignGit(f, { action, checkpoint: old, project: projectId,
        ...(action === 'diff' ? { from: head } : {}), path: 'design_files/example/content.json', offset })
      assert.equal(result.checkpoint, old)
      assert.equal(result.page.offsetUnit, 'utf16-code-units')
      assert.ok(result.text.length <= 16384)
      assert.equal(result.text.includes('\uFFFD'), false)
      assembled += result.text; count++
      if (result.page.complete) { assert.equal(result.page.nextOffset, null); break }
      offset = result.page.nextOffset
    } while (count < 20)
    assert.equal(assembled, text)
    assert.ok(count > 1)
  }
})

test('history pages retain the original commit when HEAD advances and expose further entries', async () => {
  const f = fixture()
  const entries = Array.from({ length: 120 }, (_, n) => ({ commit: n.toString(16).padStart(40, '0'), subject: String(n), committedAt: '2026-10-16T00:00:00Z' }))
  f.git.historyAt = async (commit, limit, path, _signal, offset) => {
    assert.equal(commit, old); assert.equal(path, 'design_files/example'); return entries.slice(offset, offset + limit)
  }
  let offset = 0, read = []
  do {
    const result = await readDesignGit(f, { action: 'history', checkpoint: old, path: 'design_files/example', offset, limit: 50 })
    read.push(...result.entries)
    if (result.page.complete) break
    offset = result.page.nextOffset
  } while (read.length < 150)
  assert.deepEqual(read, entries)
  assert.equal(f.calls.some(([name]) => ['publish', 'commit', 'spawn'].includes(name)), false)
})

test('tool input rejects mutation, arbitrary roots, traversal, symbolic revisions and unpinned pages before reading', async () => {
  const f = fixture()
  for (const args of [
    { action: 'commit' }, { action: 'rollback' }, { action: 'status', root: '/other' },
    { action: 'read', path: '../outside' }, { action: 'read', path: 'C:/private' },
    { action: 'read', path: '.GIT/config' }, { action: 'read', path: 'a\\b' },
    { action: 'read' }, { action: 'diff', checkpoint: 'HEAD~1' },
    { action: 'diff', offset: 1 }, { action: 'diff', path: 'a' },
    { action: 'history', limit: 51 }, { action: 'history', offset: -1 },
    { action: 'status', from: old }, { action: 'message', path: 'a' },
    { action: 'read', path: 'a', project: 'other' },
  ]) await assert.rejects(readDesignGit(f, args))
  assert.equal(f.calls.length, 0)
  assert.deepEqual(designGitReadArguments({ action: 'read', path: 'design_files/a.json' }), { action: 'read', path: 'design_files/a.json' })
})

test('list metadata remains bounded and scoped without exposing repository internals', async () => {
  const f = fixture()
  f.git.listEntriesAt = async (checkpoint, _signal, maxBytes, path) => {
    assert.equal(checkpoint, head); assert.equal(maxBytes, 2 << 20)
    assert.equal(path, 'design_files', 'scope must reach traversal before its metadata budget')
    return [{ path: 'project.json' }, { path: 'design_files/a.json' }, { path: 'design_files/sub/b.json' }]
  }
  const first = await readDesignGit(f, { action: 'list', path: 'design_files', limit: 1 })
  assert.deepEqual(first.entries, [{ path: 'design_files/a.json' }])
  assert.equal(first.page.complete, false)
  const second = await readDesignGit(f, { action: 'list', path: 'design_files', limit: 1, offset: first.page.nextOffset, checkpoint: first.checkpoint })
  assert.deepEqual(second.entries, [{ path: 'design_files/sub/b.json' }]); assert.equal(second.page.complete, true)
})

test('historical reads reject unsupported bytes before capture and never pretend binary data is text', async () => {
  const f = fixture()
  f.git.readBytesAt = async (_commit, _path, _signal, maxBytes) => { assert.equal(maxBytes, 16 << 20); return Buffer.from([0, 255]) }
  const value = await readDesignGit(f, { action: 'read', checkpoint: old, path: 'design_files/image.bin' })
  assert.equal(value.kind, 'binary'); assert.equal(value.contentIncluded, false); assert.equal(value.text, undefined)
  f.git.readBytesAt = async () => { throw Error('blob size exceeds bound') }
  await assert.rejects(readDesignGit(f, { action: 'read', path: 'design_files/large.txt' }), /exceeds/)
  f.git.readBytesAt = async () => undefined
  assert.equal((await readDesignGit(f, { action: 'read', path: 'design_files/missing' })).found, false)
})

test('live status rejects changing HEAD, historical status and out-of-history commit pins', async () => {
  const f = fixture()
  assert.equal((await readDesignGit(f, { action: 'status' })).live, true)
  f.status = async () => ({ head: old, porcelain: ' M state.json' })
  await assert.rejects(readDesignGit(f, { action: 'status' }), /changed/)
  await assert.rejects(readDesignGit(f, { action: 'status', checkpoint: old }), /historical/)
  await assert.rejects(readDesignGit(f, { action: 'message', checkpoint: 'd'.repeat(40) }), /outside/)
  await assert.rejects(readDesignGit(f, { action: 'diff', from: 'd'.repeat(40) }), /outside/)
})

test('cancellation cannot return a late read result as success', async () => {
  const f = fixture(), controller = new AbortController()
  f.git.commitMessageAt = async () => { controller.abort(new Error('cancelled fixture')); return 'late text' }
  await assert.rejects(readDesignGit(f, { action: 'message' }, controller.signal), /cancelled fixture/)
  const g = fixture()
  await assert.rejects(readDesignGit(g, { action: 'status' }, AbortSignal.abort(new Error('pre-aborted'))), /pre-aborted/)
  assert.equal(g.calls.length, 0)
})
