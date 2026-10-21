import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fixture } from './fixture.mjs'
const exec = promisify(execFile)

test('Companion reads exact committed source versions rather than silently substituting worktree bytes', async () => {
  const f = await fixture()
  try {
    const cwd = f.options.projectRoot
    const path = 'context/context.json', absolute = join(cwd, 'design_files', path)
    await mkdir(join(cwd, 'design_files/context'), { recursive: true })
    await writeFile(absolute, JSON.stringify({ records: { r1: 'Historical evidence' } }))
    await exec('git', ['add', 'design_files/context/context.json'], { cwd })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Pinned source fixture'], { cwd })
    const revision = (await exec('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim()
    await writeFile(absolute, JSON.stringify({ records: { r1: 'Unpublished current draft' } }))
    assert.equal(JSON.parse((await f.server.project.readArtifact({ path, revision })).content).records.r1, 'Historical evidence')
    assert.equal(JSON.parse((await f.server.project.readArtifact({ path })).content).records.r1, 'Unpublished current draft')
    await assert.rejects(f.server.project.readArtifact({ path, revision: 'HEAD' }), /revision|commit|version/i)
    await assert.rejects(f.server.project.readArtifact({ path: '../outside.json', revision }), /artifact|path|design_files/i)
  } finally { await f.close() }
})
