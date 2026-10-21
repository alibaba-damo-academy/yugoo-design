import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Repository, Signature } from 'yugoo-design-git-native'
import { GitVersioning } from '../src/git.ts'
import { executeNativeGit } from '../src/git-native.ts'
import { nativeGitOperation } from '../src/git-native-operation.ts'
import { nativeHistory } from '../src/git-native-history.ts'

const execute = promisify(execFile)
const childPath = 'facet[1]*.json'

async function fixture(t, count = 1) {
  const root = await mkdtemp(join(tmpdir(), 'native-history-page-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repo = Repository.init(root)
  t.after(() => repo.free())
  repo.config().setString('i18n.logOutputEncoding', 'UTF-8')
  const commits = []
  const append = () => {
    const number = commits.length
    const blob = repo.blob(Buffer.from(`${number}\n`))
    const subtree = repo.treebuilder()
    subtree.insert(childPath, blob, 0o100644)
    const tree = repo.treebuilder()
    tree.insert('design_files', subtree.write(), 0o040000)
    const signature = new Signature('History fixture', 'fixture@invalid', new Date((1000000000 + number) * 1000))
    const commit = repo.commit('HEAD', signature, signature, `checkpoint ${number}\n`, repo.findTree(tree.write()), commits.length ? [commits.at(-1)] : [])
    commits.push(commit)
    return commit
  }
  // Build hundreds of tiny real commits directly with the native object API;
  // this fixture never launches one CLI process per commit.
  for (let index = 0; index < count; index++) append()
  const nativeCalls = [], cliCalls = []
  const nativeSpawn = Object.assign(async () => assert.fail('native history paging launched external Git'), {
    native: async request => {
      nativeCalls.push(request.operation)
      return executeNativeGit(request.cwd, nativeGitOperation(request.operation), request.signal)
    },
  })
  const globalConfig = join(root, 'empty-fixture.gitconfig')
  await writeFile(globalConfig, '')
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
  const cliSpawn = async request => {
    cliCalls.push(request.argv)
    const output = await execute('git', request.argv.slice(1), { cwd: root, env, signal: request.signal, encoding: 'utf8', maxBuffer: 1 << 20 })
    return { exitCode: 0, stdout: output.stdout, stderr: output.stderr }
  }
  return { root, repo, commits, append, nativeCalls, cliCalls,
    native: new GitVersioning(nativeSpawn, root, 'design_files', false, 'native'),
    cli: new GitVersioning(cliSpawn, root, 'design_files', false, 'cli') }
}

test('fixed history pages continue beyond 500 matching commits with no total-history cutoff or CLI process', async t => {
  const f = await fixture(t, 515)
  const pin = f.commits.at(-1)
  const first = await f.native.historyAt(pin, 500, childPath)
  const second = await f.native.historyAt(pin, 500, childPath, undefined, 500)
  assert.equal(first.length, 500)
  assert.equal(second.length, 15)
  assert.deepEqual([...first, ...second].map(entry => entry.commit), f.commits.toReversed())
  assert.equal(new Set([...first, ...second].map(entry => entry.commit)).size, 515)
  assert.deepEqual(await f.native.historyAt(pin, 20, childPath, undefined, 515), [])
  assert.deepEqual(f.nativeCalls.map(operation => [operation.from, operation.offset]), [[pin, 0], [pin, 500], [pin, 515]])
  assert.deepEqual(second.slice(0, 3), await f.cli.historyAt(pin, 3, childPath, undefined, 500))
  assert.deepEqual(f.cliCalls, [[
    'git', 'log', '--max-count=3', '--skip=500', '--format=%H%x09%cI%x09%s', pin, '--', `:(literal)design_files/${childPath}`,
  ]])
})

test('paging from an immutable checkpoint is stable after the repository HEAD advances', async t => {
  const f = await fixture(t, 5)
  const pin = f.commits.at(-1)
  const first = await f.native.historyAt(pin, 2, childPath)
  const nextHead = f.append()
  const second = await f.native.historyAt(pin, 2, childPath, undefined, 2)
  const last = await f.native.historyAt(pin, 2, childPath, undefined, 4)
  assert.deepEqual([...first, ...second, ...last].map(entry => entry.commit), f.commits.slice(0, -1).toReversed())
  assert.deepEqual(second, await f.cli.historyAt(pin, 2, childPath, undefined, 2))
  assert.equal((await f.native.history(1, childPath))[0].commit, nextHead, 'existing history() still follows current HEAD')
  assert.equal(first[0].commit, pin)
})

test('pinned history rejects malformed revisions, unavailable commits and invalid offsets before using them', async t => {
  const f = await fixture(t)
  const pin = f.commits[0]
  await assert.rejects(f.native.historyAt('HEAD', 1), /full lowercase object id/u)
  for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    await assert.rejects(f.native.historyAt(pin, 1, undefined, undefined, offset), /history offset/u)
  }
  await assert.rejects(f.native.historyAt(pin, 0), /history limit/u)
  assert.deepEqual(f.nativeCalls, [])
  await assert.rejects(f.native.historyAt('f'.repeat(40), 1), /commit-not-found/u)
  assert.throws(() => nativeHistory(f.repo, 1, undefined, undefined, pin, -1), /invalid-request/u)
  assert.throws(() => nativeHistory(f.repo, 1, undefined, undefined, 'HEAD'), /invalid-request/u)
  for (const fields of [{ from: 'HEAD' }, { offset: -1 }, { offset: '2' }, { offset: Infinity }]) {
    assert.throws(() => nativeGitOperation({ kind: 'history', limit: 2, ...fields }), /invalid native history/u)
  }
  assert.deepEqual(nativeGitOperation({ kind: 'history', limit: 2, from: pin, offset: 501 }), { kind: 'history', limit: 2, from: pin, offset: 501 })
})

test('pinned history observes cancellation before dispatch and after an awaited native result', async t => {
  const f = await fixture(t)
  const pin = f.commits[0], controller = new AbortController(), reason = new Error('cancel history page')
  controller.abort(reason)
  await assert.rejects(f.native.historyAt(pin, 2, undefined, controller.signal), error => error === reason)
  assert.deepEqual(f.nativeCalls, [])
  const after = new AbortController()
  const spawn = Object.assign(async () => assert.fail('cancellation must not launch external Git'), {
    native: async () => { after.abort(reason); return { value: { entries: [] } } },
  })
  const git = new GitVersioning(spawn, f.root, undefined, false, 'native')
  await assert.rejects(git.historyAt(pin, 2, undefined, after.signal), error => error === reason)
})
