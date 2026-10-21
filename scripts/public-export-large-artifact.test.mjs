import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stagePublicSnapshot, inspectPublicSync } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { verifyPreparedPublicSync } from './public-sync-receipt.mjs'

test('reviewed 12 MiB binary survives staging, inspection, preparation and receipt verification', async t => {
  const root = await mkdtemp(join(tmpdir(), 'public-large-fixture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q'])
  const bytes = Buffer.alloc(12 * 1024 * 1024)
  await writeFile(join(source, 'fixture.wasm'), bytes)
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
  const revision = git(['rev-parse', 'HEAD']), oid = git(['rev-parse', `${revision}:fixture.wasm`])
  const policy = { version: 1, rules: [{ kind: 'file', path: 'fixture.wasm', action: 'include', reason: 'Synthetic runtime fixture' }],
    reviewedFiles: [{ path: 'fixture.wasm', oid, bytes: bytes.length, findings: ['large_file_manual_review'], reason: 'Synthetic bytes only; no product license claim' }] }
  await assert.rejects(stagePublicSnapshot({ source, revision, policy: { ...policy, reviewedFiles: [] }, destination: join(root, 'blocked') }), /incomplete/)
  const stage = await stagePublicSnapshot({ source, revision, policy, destination: join(root, 'stage') })
  const digest = value => createHash('sha256').update(value).digest('hex')
  assert.equal(stage.manifest.files['fixture.wasm'].sha256, digest(bytes))
  const target = join(root, 'missing-target')
  const approvedPlan = await inspectPublicSync({ stageRoot: stage.target, targetRoot: target })
  const prepared = await preparePublicSync({ approvedPlan, preparationRoot: join(root, 'prepared') })
  assert.equal((await verifyPreparedPublicSync(prepared)).verified, true)
  assert.equal(digest(await readFile(join(prepared.preparationRoot, 'next/fixture.wasm'))), digest(bytes))
  await assert.rejects(readFile(join(target, 'fixture.wasm')), { code: 'ENOENT' })
  assert.equal(prepared.targetUpdated, false)
})
