/** Installed-package diagnostic using the same Core executor and read capability. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GitVersioning, readDesignGit } from '../../core/lib/index.js'

export async function checkLibraryGit() {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-native-git-check-'))
  const prior = process.env.YUGOO_GIT_BACKEND
  process.env.YUGOO_GIT_BACKEND = 'native'
  let externalGitCalls = 0
  const git = new GitVersioning(() => { externalGitCalls++; throw Error('System Git is forbidden in this diagnostic') }, root)
  try {
    await git.ensureRepo()
    const path = 'design_files/runtime-check/example.txt', file = join(root, path)
    await mkdir(join(root, 'design_files/runtime-check'), { recursive: true })
    await writeFile(file, 'first\n')
    await git.commitExact('library runtime first', new Map([[path, 'first\n']]), await git.head())
    const first = await git.head()
    assert.match(first, /^[a-f0-9]{40}$/)
    await writeFile(file, 'second\n')
    await git.commitExact('library runtime second', new Map([[path, 'second\n']]), first)
    const second = await git.head()
    assert.notEqual(second, first)
    const ports = { git, projectId: 'isolated-runtime-check', status: () => { throw Error('Live project status is outside this diagnostic') } }
    const read = args => readDesignGit(ports, { project: ports.projectId, checkpoint: second, ...args })
    assert.ok((await read({ action: 'history' })).entries.length >= 2)
    assert.match((await read({ action: 'diff', from: first, path })).text, /second/)
    assert.equal((await read({ action: 'read', path, checkpoint: first })).text, 'first\n')
    assert.equal((await read({ action: 'read', path })).text, 'second\n')
    for (const args of [{ action: 'write' }, { action: 'read', path, root }, { action: 'read', path, argv: ['git', 'show'] }, { action: 'read', path, project: 'another-project' }]) await assert.rejects(read(args))
    assert.equal(await git.head(), second, 'Read capability must not publish')
    assert.equal(externalGitCalls, 0)
    return { status: 'passed', backend: 'native', externalGitCalls,
      observation: { execPath: process.execPath, node: process.versions.node, platform: process.platform, arch: process.arch },
      checks: ['init', 'publish', 'history', 'diff', 'read', 'agent-read-arguments', 'project-pin', 'read-no-publication'],
      scope: 'installed Core operations and Agent read helper; not native Host/MCP transport or model acceptance',
      nativeHostAgentVerified: false, mcpTransportVerified: false }
  } finally {
    if (prior === undefined) delete process.env.YUGOO_GIT_BACKEND; else process.env.YUGOO_GIT_BACKEND = prior
    await rm(root, { recursive: true, force: true })
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.stdout.write(JSON.stringify(await checkLibraryGit()) + '\n')
}
