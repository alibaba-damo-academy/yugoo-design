/** Historical-read compatibility across explicit CLI and in-library execution. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GitVersioning } from '../src/git.ts'
import { executeNativeGit } from '../src/git-native.ts'

const execute = promisify(execFile)

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-native-history-'))
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
  await writeFile(join(root, 'seed.txt'), 'seed\n')
  await git(['add', '--', 'seed.txt'])
  const tree = (await git(['write-tree'])).trim()
  const commit = async (message, parents = [], timestamp = 1000000000) => (await git([
    'commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', message,
  ], { GIT_AUTHOR_DATE: `@${timestamp} +0000`, GIT_COMMITTER_DATE: `@${timestamp} +0000` })).trim()
  const facade = backend => {
    const cliCalls = [], nativeCalls = []
    const spawn = Object.assign(async request => {
      cliCalls.push(request.argv)
      const output = await execute('git', request.argv.slice(1), {
        cwd: request.cwd, env: { ...env, ...request.env }, signal: request.signal,
        encoding: 'utf8', maxBuffer: 1 << 20,
      })
      return { exitCode: 0, stdout: output.stdout, stderr: output.stderr }
    }, { native: async request => {
      nativeCalls.push(request.operation)
      return executeNativeGit(request.cwd, request.operation, request.signal)
    } })
    return { versioning: new GitVersioning(spawn, root, undefined, false, backend), cliCalls, nativeCalls }
  }
  return { root, tree, git, commit, facade }
}

test('native facade retains default Git log marker ordering across merge and skewed timestamps', async t => {
  const f = await fixture(t)
  const base = await f.commit('base')
  const a = await f.commit('A MARK', [base], 1000000100)
  const b = await f.commit('B MARK', [base], 1000000200)
  const c = await f.commit('C', [a], 1000000250)
  const d = await f.commit('D', [b], 1000000050)
  const merge = await f.commit('merge', [c, d], 1000001000)
  const argv = ['git', 'log', '-1', '--format=%H', '--fixed-strings', '--grep=MARK', merge]
  const expected = (await f.git(argv.slice(1))).trim()
  assert.equal(expected, a, 'the default walk reaches A before the newer but hidden B')
  for (const backend of ['cli', 'native']) {
    const facade = f.facade(backend)
    assert.equal(await facade.versioning.latestCommitWithMessage(merge, 'MARK'), expected)
    assert.deepEqual(facade.cliCalls, backend === 'cli' ? [argv] : [])
    assert.deepEqual(facade.nativeCalls, backend === 'cli' ? [] : [{ kind: 'latest-marker', from: merge, marker: 'MARK' }])
  }
})

test('native facade retains Git commit-encoding conversion for historical Latin-1 messages', async t => {
  const f = await fixture(t)
  const source = join(f.root, 'latin1-message')
  await writeFile(source, Buffer.from([0x4d, 0x41, 0x52, 0x4b, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x0a]))
  const commit = (await f.git(['-c', 'i18n.commitEncoding=ISO-8859-1', 'commit-tree', f.tree, '-F', source])).trim()
  const argv = ['git', 'show', '-s', '--format=%B', commit]
  const expected = await f.git(argv.slice(1))
  assert.equal(expected, 'MARK café\n\n')
  for (const backend of ['cli', 'native']) {
    const facade = f.facade(backend)
    assert.equal(await facade.versioning.commitMessageAt(commit), expected)
    assert.deepEqual(facade.cliCalls, backend === 'cli' ? [argv] : [])
    assert.deepEqual(facade.nativeCalls, backend === 'cli' ? [] : [{ kind: 'message', commit }])
  }
})
