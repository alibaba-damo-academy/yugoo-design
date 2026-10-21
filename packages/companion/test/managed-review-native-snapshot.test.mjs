/** Core-backed immutable snapshot boundary; not an installed host acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, stat, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GitVersioning } from '../../core/lib/index.js'
import { reviewSnapshot } from '../src/managed-reviews.mjs'

const exec = promisify(execFile)
async function fixture(t, files = { 'design_files/example/content.json': Buffer.from('{}\n') }) {
  const root = await mkdtemp(join(tmpdir(), 'native-review-fixture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = async (...argv) => (await exec('git', ['-C', root, ...argv], { timeout: 10000 })).stdout.trim()
  await git('init', '--quiet')
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  await git('add', '--', 'design_files')
  const commit = async () => {
    await git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  return { root, git, commit }
}

async function withoutExternalGit(run) {
  const path = process.env.PATH, backend = process.env.YUGOO_GIT_BACKEND
  process.env.PATH = ''
  process.env.YUGOO_GIT_BACKEND = 'native'
  try { return await run() }
  finally {
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path
    if (backend === undefined) delete process.env.YUGOO_GIT_BACKEND; else process.env.YUGOO_GIT_BACKEND = backend
  }
}

test('review snapshot preserves committed binary/executable paths and excludes derived files without Git executable', async t => {
  const bytes = Buffer.from([0, 255, 128, 13, 10, 0])
  const f = await fixture(t, {
    'design_files/example/中文 data.bin': bytes,
    'design_files/example/run.sh': '#!/bin/sh\n',
    'design_files/_experiences/example/derived.json': '{}',
  })
  await chmod(join(f.root, 'design_files/example/run.sh'), 0o755)
  await f.git('update-index', '--chmod=+x', 'design_files/example/run.sh')
  const checkpoint = await f.commit()
  await writeFile(join(f.root, 'design_files/example/中文 data.bin'), 'unpublished')
  const snapshot = await withoutExternalGit(() => reviewSnapshot(f.root, checkpoint))
  t.after(snapshot.close)
  assert.deepEqual(await readFile(join(snapshot.root, 'design_files/example/中文 data.bin')), bytes)
  assert.equal(await readFile(join(snapshot.root, 'design_files/example/run.sh'), 'utf8'), '#!/bin/sh\n')
  if (process.platform !== 'win32') assert.equal((await stat(join(snapshot.root, 'design_files/example/run.sh'))).mode & 0o777, 0o400)
  await assert.rejects(access(join(snapshot.root, 'design_files/_experiences')))
  await assert.rejects(access(join(snapshot.root, '.git')))
})

test('review snapshot rejects committed symlinks even in excluded derived paths', async t => {
  for (const path of ['design_files/example/link', 'design_files/_experiences/example/link']) {
    const f = await fixture(t)
    const target = join(f.root, 'symlink-content')
    await writeFile(target, '/outside/private')
    const oid = await f.git('hash-object', '-w', target)
    await f.git('update-index', '--add', '--cacheinfo', `120000,${oid},${path}`)
    const checkpoint = await f.commit()
    await withoutExternalGit(() => assert.rejects(reviewSnapshot(f.root, checkpoint), /regular committed files/))
  }
})

test('review snapshot rejects a committed blob beyond its 16 MiB read limit', async t => {
  const f = await fixture(t, { 'design_files/example/oversized.bin': Buffer.alloc((16 << 20) + 1, 1) })
  const checkpoint = await f.commit()
  await withoutExternalGit(() => assert.rejects(reviewSnapshot(f.root, checkpoint), /limit|budget|large|size/i))
})

test('snapshot retains metadata/file/aggregate bounds and checks paths before writing', async t => {
  let entries = [], totalReads = 0
  t.mock.method(GitVersioning.prototype, 'listEntriesAt', async (_checkpoint, signal, maxBytes) => {
    assert.equal(maxBytes, 2 << 20)
    assert.equal(signal instanceof AbortSignal, true)
    return entries
  })
  t.mock.method(GitVersioning.prototype, 'readBytesAt', async (_checkpoint, _path, signal, maxBytes) => {
    assert.equal(maxBytes, 16 << 20)
    assert.equal(signal instanceof AbortSignal, true)
    totalReads++
    return Buffer.alloc(16 << 20)
  })
  const entry = path => ({ path, mode: 0o100644, type: 'blob', oid: 'a'.repeat(40) })
  entries = [entry('../outside')]
  await assert.rejects(reviewSnapshot('/fixture', 'a'.repeat(40)), /Unsafe snapshot path/)
  assert.equal(totalReads, 0)
  entries = [entry('_experiences/example/derived.json')]
  await assert.rejects(reviewSnapshot('/fixture', 'a'.repeat(40)), /No published Design Files/)
  assert.equal(totalReads, 0)
  entries = Array.from({ length: 10001 }, (_, i) => entry(`example/${i}.json`))
  await assert.rejects(reviewSnapshot('/fixture', 'a'.repeat(40)), /file limit/)
  assert.equal(totalReads, 0)
  entries = Array.from({ length: 9 }, (_, i) => entry(`example/${i}.bin`))
  await assert.rejects(reviewSnapshot('/fixture', 'a'.repeat(40)), /size limit/)
  assert.equal(totalReads, 9)
})

test('snapshot rejects pre-aborted requests without invoking repository reads', async t => {
  t.mock.method(GitVersioning.prototype, 'listEntriesAt', () => { throw Error('must not read') })
  await assert.rejects(reviewSnapshot('/fixture', 'a'.repeat(40), AbortSignal.abort(new Error('cancelled fixture'))), /cancelled fixture/)
})
