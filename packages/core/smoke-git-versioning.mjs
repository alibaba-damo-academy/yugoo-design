import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { DesignFilesStore, GitVersioning, nodeDesignProjectSpawn } from './lib/index.js'

const exec = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'dsh-git-smoke-'))
const spawn = async ({ argv, cwd, signal, env, binaryStdout }) => {
  if (binaryStdout !== undefined) return nodeDesignProjectSpawn({ argv, cwd, signal, env, binaryStdout })
  try {
    const result = await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env }, encoding: 'utf8' })
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return { exitCode: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) }
  }
}

try {
  const git = new GitVersioning(spawn, root)
  await git.ensureRepo()
  await writeFile(join(root, 'design.txt'), 'base\n')
  const first = await git.commitExact('base', new Map([['design.txt', 'base\n']]), undefined)
  assert.ok(first)
  assert.equal((await exec('git', ['status', '--porcelain=v1'], { cwd: root })).stdout, '', 'a temporary-index commit keeps the ordinary index aligned')

  const emptyAudit = await git.commitExact('empty terminal audit', new Map(), first, undefined, true)
  assert.ok(emptyAudit)
  assert.notEqual(emptyAudit, first, 'a forced audit may record an unchanged tree')
  assert.equal(
    (await exec('git', ['rev-parse', `${first}^{tree}`], { cwd: root })).stdout,
    (await exec('git', ['rev-parse', `${emptyAudit}^{tree}`], { cwd: root })).stdout,
    'an empty terminal audit preserves the exact tree',
  )
  assert.equal((await exec('git', ['status', '--porcelain=v1'], { cwd: root })).stdout, '', 'an empty audit also keeps the ordinary index aligned')

  await writeFile(join(root, 'design.txt'), 'external staged\n')
  await exec('git', ['add', '--', 'design.txt'], { cwd: root })
  const second = await git.commitExact('published', new Map([['design.txt', 'published\n']]), emptyAudit)
  assert.ok(second)
  assert.equal((await exec('git', ['show', ':design.txt'], { cwd: root })).stdout, 'external staged\n')
  assert.equal(await git.readTextAt(second, 'design.txt'), 'published\n')
  assert.equal(await readFile(join(root, 'design.txt'), 'utf8'), 'external staged\n')

  await writeFile(join(root, 'project.json'), '{"kit":"next"}\n')
  const third = await git.commit('kit update', ['project.json'])
  assert.ok(third)
  assert.equal(await git.isAncestor(first, third), true)
  assert.equal(await git.isAncestor(third, first), false)
  await assert.rejects(git.isAncestor('HEAD', third), /full lowercase object id/)
  assert.equal(await git.readTextAt(third, 'project.json'), '{"kit":"next"}\n')
  assert.equal((await exec('git', ['show', ':design.txt'], { cwd: root })).stdout, 'external staged\n')

  const designRoot = join(root, 'design_files')
  const designGit = new GitVersioning(spawn, root, 'design_files')
  const fs = {
    async readText(path) {
      try { return await readFile(path, 'utf8') } catch (error) {
        if (error.code === 'ENOENT') return undefined
        throw error
      }
    },
    async writeText(path, content) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
    },
    async readBytes(path) {
      try { return await readFile(path) } catch (error) {
        if (error.code === 'ENOENT') return undefined
        throw error
      }
    },
    async writeBytes(path, content) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
    },
    async ensureDir(path) { await mkdir(path, { recursive: true }) },
    async removeFile(path) { await unlink(path) },
  }
  const store = new DesignFilesStore(fs, designGit, designRoot)
  await mkdir(join(designRoot, 'questions'), { recursive: true })
  await writeFile(join(designRoot, 'questions', 'metadata.txt'), 'metadata\n')
  const workingFiles = await designGit.listWorkingFiles()
  const metadataFile = workingFiles.find(file => file.path === 'questions/metadata.txt')
  assert.equal(metadataFile?.size, Buffer.byteLength('metadata\n'))
  assert.equal(typeof metadataFile?.mtimeMs, 'number', 'worktree metadata can invalidate byte caches without reading bytes')
  await unlink(join(designRoot, 'questions', 'metadata.txt'))
  const panelEvent = { eventId: 'panel-save-stable-1', kind: 'panel-save' }
  const panelOptions = {
    origin: 'panel',
    audit: panelEvent,
    settleEvent: async () => {},
  }
  const panelFirst = await store.write('questions', { round: 1 }, panelOptions)
  const panelRetry = await store.write('questions', { round: 1 }, panelOptions)
  assert.equal(panelRetry.commit, panelFirst.commit, 'a repeated panel event id resolves to its first audit commit')
  assert.equal(await designGit.head(), panelFirst.commit, 'an idempotent panel retry creates no second commit')
  await assert.rejects(
    store.write('questions', { round: 2 }, panelOptions),
    /event id was reused with different bytes/,
  )

  for (const [index, outcome] of ['failed', 'cancelled', 'no-progress'].entries()) {
    await writeFile(join(designRoot, 'questions', 'attempt.txt'), `${outcome}\n`, 'utf8')
    const before = await designGit.head()
    const audit = await store.auditInvocation('questions', {
      eventId: `invocation-${index + 1}`,
      outcome,
    })
    assert.notEqual(audit.commit, before, `${outcome} must create one truthful terminal audit commit`)
    assert.equal(await designGit.readTextAt(audit.commit, 'questions/attempt.txt'), `${outcome}\n`)
    const retried = await store.auditInvocation('questions', {
      eventId: `invocation-${index + 1}`,
      outcome,
    })
    assert.equal(retried.commit, audit.commit, `${outcome} audit retry must be idempotent`)
    assert.equal(await designGit.head(), audit.commit)
  }
  console.log('DSH GIT VERSIONING OK')
} finally {
  await rm(root, { recursive: true, force: true })
}
