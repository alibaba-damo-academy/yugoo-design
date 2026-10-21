import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, mkdir, mkdtemp, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Repository } from 'yugoo-design-git-native'
import { nativeStatus } from '../src/git-native-status.ts'

const execute = promisify(execFile)
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-native-status-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const globalConfig = join(root, 'empty.gitconfig')
  await writeFile(globalConfig, '')
  const system = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']
    .flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]]]))
  const env = { ...system, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@invalid' }
  const git = async (argv, input) => {
    const pending = execute('git', argv, { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 20 })
    if (input !== undefined) pending.child.stdin.end(input)
    return (await pending).stdout
  }
  await git(['init', '--quiet'])
  await mkdir(join(root, 'design_files'))
  for (const path of ['mod.txt', 'delete.txt', 'mode.txt', 'type.txt', 'rename.txt']) await writeFile(join(root, 'design_files', path), `baseline ${path}\n`)
  await writeFile(join(root, '.gitignore'), '*.ignore\n')
  await git(['add', '--', 'design_files', '.gitignore'])
  await git(['commit', '--quiet', '-m', 'baseline'])
  const repo = new Repository(root)
  t.after(() => repo.free())
  const oracle = async prefix => {
    const selected = prefix === undefined ? [] : ['--', `:(literal)${prefix}`]
    let cleanIndex = true
    try { await git(['diff', '--cached', '--quiet']) }
    catch (error) { if (error.code !== 1) throw error; cleanIndex = false }
    const list = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...selected])
    const rawStatus = await git(['-c', 'status.renames=false', 'status', '--porcelain=v1', '--untracked-files=all', ...selected])
    return { paths: [...new Set(list.split('\0').filter(Boolean))].sort(), cleanIndex, cleanWorktree: rawStatus === '', porcelain: rawStatus }
  }
  return { root, repo, git, oracle }
}

test('native status lists tracked/untracked paths and matches ordinary XY states in a literal scope', async t => {
  const f = await fixture(t)
  assert.deepEqual(await nativeStatus(f.repo), await f.oracle())
  await writeFile(join(f.root, 'design_files', 'mod.txt'), 'unstaged\n')
  await unlink(join(f.root, 'design_files', 'delete.txt'))
  await chmod(join(f.root, 'design_files', 'mode.txt'), 0o755)
  await unlink(join(f.root, 'design_files', 'type.txt'))
  await symlink('mod.txt', join(f.root, 'design_files', 'type.txt'))
  await writeFile(join(f.root, 'design_files', 'new.txt'), 'new\n')
  await writeFile(join(f.root, 'design_files', 'hidden.ignore'), 'ignored\n')
  await writeFile(join(f.root, 'outside.txt'), 'staged outside\n')
  await f.git(['add', '--', 'outside.txt'])
  await writeFile(join(f.root, 'design_files', 'added.txt'), 'staged\n')
  await f.git(['add', '--', 'design_files/added.txt'])
  await writeFile(join(f.root, 'design_files', 'added.txt'), 'staged plus unstaged\n')
  for (const prefix of [undefined, 'design_files', 'design_files/mod.txt', 'absent']) {
    assert.deepEqual(await nativeStatus(f.repo, prefix), await f.oracle(prefix))
  }
  assert.equal((await nativeStatus(f.repo, 'absent')).cleanIndex, false, 'foreign staging still rejects repository-wide clean-index admission')
})

test('native porcelain quotes spaces, controls and UTF-8 bytes according to core.quotepath', async t => {
  const f = await fixture(t)
  for (const path of ['a b', 'quote"name', 'tab\tname', 'line\nname', '中文', 'emoji😀', 'literal[1]*.json']) {
    await writeFile(join(f.root, 'design_files', path), 'untracked\n')
  }
  for (const setting of ['true', 'false']) {
    await f.git(['config', 'core.quotepath', setting])
    assert.deepEqual(await nativeStatus(f.repo, 'design_files'), await f.oracle('design_files'))
    assert.deepEqual(await nativeStatus(f.repo, 'design_files/literal[1]*.json'), await f.oracle('design_files/literal[1]*.json'))
  }
})

test('native status represents staged renames as truthful deletion/addition without inventing provenance', async t => {
  const f = await fixture(t)
  await rename(join(f.root, 'design_files', 'rename.txt'), join(f.root, 'design_files', 'renamed.txt'))
  await f.git(['add', '-A', '--', 'design_files'])
  const actual = await nativeStatus(f.repo, 'design_files')
  assert.deepEqual(actual, await f.oracle('design_files'))
  assert.match(actual.porcelain, /^D  design_files\/rename.txt\nA  design_files\/renamed.txt\n$/u)
  assert.match(await f.git(['-c', 'status.renames=true', 'status', '--porcelain=v1', '--untracked-files=all']), /^R /u)
})

test('native porcelain uses the seven actual conflict-stage combinations', async t => {
  const f = await fixture(t)
  const oid = (await f.git(['rev-parse', 'HEAD:design_files/mod.txt'])).trim()
  const rows = []
  for (let mask = 1; mask < 8; mask++) {
    for (let stage = 1; stage <= 3; stage++) if (mask & (1 << (stage - 1))) rows.push(`100644 ${oid} ${stage}\tdesign_files/conflict-${mask}.txt\n`)
  }
  await f.git(['update-index', '--index-info'], rows.join(''))
  assert.deepEqual(await nativeStatus(f.repo, 'design_files'), await f.oracle('design_files'))
  assert.equal((await nativeStatus(f.repo)).cleanIndex, false)
})

test('native paths include recreated untracked files after staged deletion', async t => {
  const f = await fixture(t)
  await f.git(['rm', '--quiet', '--', 'design_files/delete.txt'])
  await writeFile(join(f.root, 'design_files', 'delete.txt'), 'replacement untracked\n')
  assert.deepEqual(await nativeStatus(f.repo, 'design_files'), await f.oracle('design_files'))
})

test('native status never misreports intent-to-add as staged when its v3 index is unsupported', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, 'design_files', 'intent.txt'), 'intent\n')
  await f.git(['add', '-N', '--', 'design_files/intent.txt'])
  const expected = await f.oracle('design_files')
  assert.equal(expected.cleanIndex, true)
  assert.equal(expected.porcelain, ' A design_files/intent.txt\n')
  await assert.rejects(nativeStatus(f.repo, 'design_files'), { code: 'unsupported-index' })
})

test('native status rejects a non-UTF8 filename instead of substituting another path', async t => {
  const f = await fixture(t)
  await writeFile(Buffer.concat([Buffer.from(`${f.root}/design_files/`), Buffer.from([0xff])]), 'unknown filename\n')
  await assert.rejects(nativeStatus(f.repo), /native-operation-failed/u)
})
