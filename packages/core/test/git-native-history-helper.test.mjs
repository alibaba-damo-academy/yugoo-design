/** Focused CLI-oracle checks for the native historical-read helpers. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Repository } from 'yugoo-design-git-native'
import iconv from 'iconv-lite'
import { nativeCommitMessage, nativeLatestMarker, nativeHistory } from '../src/git-native-history.ts'

const execute = promisify(execFile)

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-native-history-helper-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const globalConfig = join(root, 'empty.gitconfig')
  await writeFile(globalConfig, '')
  const system = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']
    .flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]]]))
  const env = { ...system, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@invalid' }
  const git = async (argv, extra = {}) => (await execute('git', argv, {
    cwd: root, env: { ...env, ...extra }, encoding: 'utf8', maxBuffer: 1 << 20,
  })).stdout
  await git(['init', '--quiet'])
  // The native config reader sees this explicit setting even when a test host
  // has its own global encoding preferences.
  await git(['config', 'i18n.logOutputEncoding', 'UTF-8'])
  let sequence = 0
  const tree = async (files = {}) => {
    await git(['read-tree', '--empty'])
    for (const [path, value] of Object.entries(files)) {
      const source = join(root, `.fixture-blob-${sequence++}`)
      await writeFile(source, typeof value === 'string' ? value : value.content)
      const oid = (await git(['hash-object', '-w', '--', source])).trim()
      await git(['update-index', '--add', '--cacheinfo', `${typeof value === 'string' ? '100644' : value.mode},${oid},${path}`])
    }
    return (await git(['write-tree'])).trim()
  }
  const seed = await tree({ 'seed.txt': 'seed\n' })
  const commit = async (message, parents = [], timestamp = 1000000000, selectedTree = seed, options = {}) => {
    const source = join(root, `.fixture-message-${sequence++}`)
    await writeFile(source, message)
    return (await git([
      ...(options.encoding ? ['-c', `i18n.commitEncoding=${options.encoding}`] : []),
      'commit-tree', selectedTree, ...parents.flatMap(parent => ['-p', parent]), '-F', source,
    ], { GIT_AUTHOR_DATE: `@${timestamp} ${options.zone ?? '+0000'}`, GIT_COMMITTER_DATE: `@${timestamp} ${options.zone ?? '+0000'}` })).trim()
  }
  const repo = new Repository(root)
  t.after(() => repo.free())
  const latest = async (from, marker) => (await git(['log', '-1', '--format=%H', '--fixed-strings', `--grep=${marker}`, from])).trim() || undefined
  const history = async (limit, prefix, path) => {
    const selected = path === undefined ? prefix : prefix === undefined ? path : `${prefix}/${path}`
    const result = await git(['log', `--max-count=${limit}`, '--format=%H%x09%cI%x09%s', ...(selected === undefined ? [] : ['--', `:(literal)${selected}`])])
    return result === '' ? [] : result.trimEnd().split('\n').map(line => {
      const first = line.indexOf('\t'), second = line.indexOf('\t', first + 1)
      return { commit: line.slice(0, first), committedAt: line.slice(first + 1, second), subject: line.slice(second + 1) }
    })
  }
  return { root, repo, git, seed, tree, commit, latest, history }
}

test('native marker walk preserves Git default merge order under clock skew', async t => {
  const f = await fixture(t)
  const base = await f.commit('base')
  const a = await f.commit('A MARK', [base], 1000000100)
  const b = await f.commit('B MARK', [base], 1000000200)
  const c = await f.commit('C', [a], 1000000250)
  const d = await f.commit('D', [b], 1000000050)
  const merge = await f.commit('merge', [c, d], 1000001000)
  assert.equal(await f.latest(merge, 'MARK'), a)
  for (const marker of ['MARK', 'B MARK', 'C', 'merge', 'absent']) {
    assert.equal(nativeLatestMarker(f.repo, merge, marker), await f.latest(merge, marker))
  }
  await f.git(['update-ref', 'HEAD', merge])
  assert.deepEqual(nativeHistory(f.repo, 100), await f.history(100))
})

test('native merge frontier has Git stable parent order for equal timestamps', async t => {
  const f = await fixture(t)
  const base = await f.commit('base')
  const a = await f.commit('first MARK', [base], 1000000001)
  const b = await f.commit('second MARK', [base], 1000000001)
  const merge = await f.commit('merge', [a, b], 1000000001)
  await f.git(['update-ref', 'HEAD', merge])
  assert.equal(nativeLatestMarker(f.repo, merge, 'MARK'), await f.latest(merge, 'MARK'))
  assert.deepEqual(nativeHistory(f.repo, 100), await f.history(100))
})

test('native messages retain raw framing and decode declared Latin-1 without substituting Windows-1252', async t => {
  const f = await fixture(t)
  const bytes = Buffer.from([0x0a, 0x4d, 0x41, 0x52, 0x4b, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x80, 0x0a, 0x0a, 0x62, 0x6f, 0x64, 0x79, 0x0a])
  const commit = await f.commit(bytes, [], 1000000000, f.seed, { encoding: 'ISO-8859-1' })
  assert.equal(nativeCommitMessage(f.repo, commit), await f.git(['show', '-s', '--format=%B', commit]))
  assert.ok(nativeCommitMessage(f.repo, commit).includes('café\u0080'))
  assert.equal(nativeLatestMarker(f.repo, commit, 'café'), await f.latest(commit, 'café'))
  await f.git(['config', 'i18n.logOutputEncoding', 'ISO-8859-1'])
  assert.equal(nativeCommitMessage(f.repo, commit), await f.git(['show', '-s', '--format=%B', commit]))
  assert.equal(nativeLatestMarker(f.repo, commit, 'café'), await f.latest(commit, 'café'))
})

test('native history handles configured output encodings, invalid input and unrepresentable output like Git', async t => {
  const f = await fixture(t)
  for (const [message, encoding] of [
    [iconv.encode('相談 MARK\n', 'Shift_JIS'), 'Shift_JIS'],
    [Buffer.from([0x87, 0x90, 0x20, 0x4d, 0x41, 0x52, 0x4b, 0x0a]), 'CP932'],
    [Buffer.from([0x4d, 0x41, 0x52, 0x4b, 0xff, 0x0a]), 'UTF-8'],
    [Buffer.from('MARK 中文\n'), 'UTF-8'],
  ]) {
    const commit = await f.commit(message, [], 1000000000, f.seed, { encoding })
    for (const output of ['UTF-8', 'ISO-8859-1', 'Shift_JIS', 'unsupported-fixture-encoding']) {
      await f.git(['config', 'i18n.logOutputEncoding', output])
      assert.equal(nativeCommitMessage(f.repo, commit), await f.git(['show', '-s', '--format=%B', commit]), `${encoding} → ${output}`)
      assert.equal(nativeLatestMarker(f.repo, commit, 'MARK'), await f.latest(commit, 'MARK'))
    }
  }
})

test('native history preserves subject formatting and commit timezone', async t => {
  const f = await fixture(t)
  let head
  for (const message of ['\n\n  subject\t with  spaces  \n continued\t \n\nbody\n', 'subject\r\nsecond\r\n\r\nbody\r\n', '\n\n', 'plain']) {
    head = await f.commit(message, head ? [head] : [], 1000000000, f.seed, { zone: '-0730' })
    await f.git(['update-ref', 'HEAD', head])
    assert.deepEqual(nativeHistory(f.repo, 100), await f.history(100))
  }
})

test('literal path history prunes TREESAME merges and follows changed subtrees, deletes and modes', async t => {
  const f = await fixture(t)
  const baseTree = await f.tree({ 'design_files/a[1].json': 'one', 'other.txt': 'base' })
  const leftTree = await f.tree({ 'design_files/a[1].json': 'two', 'other.txt': 'base' })
  const rightTree = await f.tree({ 'design_files/a[1].json': 'one', 'other.txt': 'changed' })
  const bothTree = await f.tree({ 'design_files/a[1].json': 'two', 'other.txt': 'changed' })
  const mergedTree = await f.tree({ 'design_files/a[1].json': 'three', 'other.txt': 'changed' })
  const executableTree = await f.tree({ 'design_files/a[1].json': { content: 'three', mode: '100755' }, 'other.txt': 'changed' })
  const deletedTree = await f.tree({ 'other.txt': 'changed' })
  const base = await f.commit('base', [], 1000000000, baseTree)
  const left = await f.commit('left', [base], 1000000200, leftTree)
  const right = await f.commit('right', [base], 1000000300, rightTree)
  const merge = await f.commit('merge unchanged selected path', [left, right], 1000000400, bothTree)
  const evil = await f.commit('merge new selected content', [merge, base], 1000000500, mergedTree)
  const mode = await f.commit('mode', [evil], 1000000600, executableTree)
  const deletion = await f.commit('delete', [mode], 1000000700, deletedTree)
  await f.git(['update-ref', 'HEAD', deletion])
  for (const [prefix, path] of [[undefined, undefined], ['design_files', undefined], ['design_files', 'a[1].json'], [undefined, 'other.txt'], [undefined, 'absent']]) {
    for (const limit of [1, 3, 100]) assert.deepEqual(nativeHistory(f.repo, limit, prefix, path), await f.history(limit, prefix, path), `${prefix}/${path}:${limit}`)
  }
})

test('native history observes shallow boundaries even when parent objects are locally available', async t => {
  const f = await fixture(t)
  const base = await f.commit('base MARK')
  const tip = await f.commit('tip', [base], 1000000100)
  await f.git(['update-ref', 'HEAD', tip])
  await writeFile(join(f.root, '.git', 'shallow'), `${tip}\n`)
  assert.equal(nativeLatestMarker(f.repo, tip, 'MARK'), await f.latest(tip, 'MARK'))
  assert.deepEqual(nativeHistory(f.repo, 100), await f.history(100))
})

test('historical helpers reject malformed or unavailable commit ids and invalid query bounds', async t => {
  const f = await fixture(t)
  assert.throws(() => nativeCommitMessage(f.repo, 'HEAD'), /invalid-request/u)
  assert.throws(() => nativeCommitMessage(f.repo, 'f'.repeat(40)), /commit-not-found/u)
  assert.throws(() => nativeLatestMarker(f.repo, 'f'.repeat(40), 'MARK'), /commit-not-found/u)
  assert.throws(() => nativeLatestMarker(f.repo, 'f'.repeat(40), ''), /invalid-request/u)
  assert.throws(() => nativeHistory(f.repo, 0), /invalid-request/u)
  assert.throws(() => nativeHistory(f.repo, 1, '../escape'), /invalid-request/u)
})
