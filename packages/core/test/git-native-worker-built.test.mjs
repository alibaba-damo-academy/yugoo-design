/** Built worker boundary only; not installed Windows/host acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeGitExecutor } from '../src/git-native-executor.ts'

test('packaged worker runs structured init, publish and exact blob reads without PATH Git', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-worker-built-'))
  let starts = 0
  const executor = new NativeGitExecutor(() => {
    starts++
    return new Worker(new URL('../lib/git-native-worker.js', import.meta.url), {
      execArgv: [], env: { PATH: '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' },
    })
  })
  t.after(async () => { await executor.close(); await rm(root, { recursive: true, force: true }) })
  const run = operation => executor.execute({ cwd: root, operation })
  const init = (await run({ kind: 'init' })).value
  assert.equal(init.head, undefined)
  const stagingRoot = join(root, 'staged')
  await mkdir(stagingRoot)
  const source = join(stagingRoot, 'exact')
  const bytes = Buffer.from([0, 128, 255, 13, 10, 0])
  await writeFile(source, bytes)
  const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  const result = (await run({ kind: 'publish', message: 'fixture', stagingRoot,
    files: [{ path: 'design_files/example/data.bin', source, mode: 0o100644, oid }] })).value
  assert.match(result.commit, /^[0-9a-f]{40}$/)
  assert.equal((await run({ kind: 'inspect' })).value.head, result.commit)
  const actual = await run({ kind: 'blob', oid, size: bytes.length })
  assert.deepEqual(Buffer.from(actual.bytes), bytes)
  await assert.rejects(run({ kind: 'publish', message: 'stale', stagingRoot, files: [] }), /stale-publication/)
  assert.equal((await run({ kind: 'head' })).value.head, result.commit)
  assert.equal(starts, 1)
})

test('built default project manager creates, opens and reports fresh status with no Git executable', async t => {
  const { DesignProjectManager, GitVersioning } = await import('../lib/index.js')
  const directory = await mkdtemp(join(tmpdir(), 'native-manager-built-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = process.env.PATH, backend = process.env.YUGOO_GIT_BACKEND
  const spawn = () => { throw Error('external Git is forbidden in this fixture') }
  try {
    process.env.PATH = ''; delete process.env.YUGOO_GIT_BACKEND
    const manager = new DesignProjectManager({ spawn })
    const root = join(directory, 'project')
    const project = await manager.create({ root, name: 'Library Git', knowledge: { provider: 'test-embedded' } })
    const initial = await manager.status(project)
    assert.equal(initial.dirty, false)
    assert.equal(initial.porcelain, '')
    assert.match(initial.head, /^[0-9a-f]{40}$/)
    assert.equal((await new GitVersioning(spawn, root).history(5)).length, 1)
    await writeFile(join(root, 'design_files', 'new.json'), '{}')
    const current = await manager.status(project)
    assert.equal(current.head, initial.head)
    assert.equal(current.dirty, true)
    assert.match(current.porcelain, /\?\? design_files\/new.json/)
    assert.equal((await manager.open(root)).metadata.id, project.metadata.id)
  } finally {
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path
    if (backend === undefined) delete process.env.YUGOO_GIT_BACKEND; else process.env.YUGOO_GIT_BACKEND = backend
  }
})
