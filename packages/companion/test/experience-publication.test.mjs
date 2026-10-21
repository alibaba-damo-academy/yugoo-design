import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DesignProjectManager } from '../../core/lib/index.js'
import { openCompanionProject } from '../src/project.mjs'

const exec = promisify(execFile)
async function isolated(run) {
  const root = await mkdtemp(join(tmpdir(), 'companion-experience-publication-'))
  try {
    const projectRoot = join(root, 'project')
    await new DesignProjectManager().create({ root: projectRoot, name: 'Synthetic experience',
      knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'web_app', version: '1.0' } })
    const api = await openCompanionProject({ projectRoot,
      kitRoot: fileURLToPath(new URL('../../skills-web-app/', import.meta.url)),
      stateRoot: join(root, 'state'), connection: { host: 'codex', threadId: 'experience-test' } })
    const commit = async () => {
      await exec('git', ['add', 'design_files'], { cwd: projectRoot })
      await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'synthetic experience'], { cwd: projectRoot })
      return api.store.head()
    }
    await run(api, commit)
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('only committed experience paths appear, and publication cache refreshes on a new checkpoint', async () => {
  await isolated(async (api, commit) => {
    const index = '_experiences/example/view.json'
    await api.store.writeWorktreeText(index, '{"id":"example"}')
    assert.deepEqual((await api.readWorkspace()).experienceFiles, {})
    const first = await commit()
    assert.deepEqual((await api.readWorkspace()).experienceFiles, { [index]: first })
    const unpublished = '_experiences/unpublished/view.json'
    await api.store.writeWorktreeText(unpublished, '{}')
    await api.store.writeWorktreeText(index, '{"id":"uncommitted-edit"}')
    assert.deepEqual((await api.readWorkspace()).experienceFiles, { [index]: first })
    assert.equal((await api.readArtifact({ path: index, revision: first })).content, '{"id":"example"}')
    const second = await commit()
    assert.deepEqual((await api.readWorkspace()).experienceFiles, { [index]: second, [unpublished]: second })
  })
})

test('frozen image reads remain at the requested commit while ordinary and worktree reads stay live', async () => {
  await isolated(async (api, commit) => {
    const path = '_experiences/example/versions/1/image.png'
    const before = Buffer.from([137, 80, 78, 71, 1])
    const after = Buffer.from([137, 80, 78, 71, 2])
    await api.store.writeWorktreeBytes(path, before)
    const revision = await commit()
    await api.store.writeWorktreeBytes(path, after)
    assert.equal((await api.readBinaryArtifact({ path, revision })).base64, before.toString('base64'))
    assert.equal((await api.readBinaryArtifact({ path })).base64, after.toString('base64'))
    assert.equal((await api.readBinaryArtifact({ path, revision: 'worktree:live' })).base64, after.toString('base64'))
    assert.equal((await api.readBinaryArtifact({ path: '_experiences/missing.png', revision })).found, false)
  })
})

test('binary size, format and path rejection remain in force for versioned and live reads', async () => {
  await isolated(async (api, commit) => {
    const path = '_experiences/example/oversize.png'
    await api.store.writeWorktreeBytes(path, Buffer.alloc(10 * 1024 * 1024 + 1))
    await assert.rejects(api.readBinaryArtifact({ path }), /10 MiB/)
    const revision = await commit()
    await assert.rejects(api.readBinaryArtifact({ path, revision }), /limit|exceed|large|bytes/i)
    await assert.rejects(api.readBinaryArtifact({ path: '_experiences/example/file.exe', revision }), /Unsupported/)
    await assert.rejects(api.readBinaryArtifact({ path: '../outside.png', revision }), /path|travers|relative|\.\./i)
  })
})
