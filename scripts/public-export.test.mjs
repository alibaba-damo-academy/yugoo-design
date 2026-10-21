import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runPublicExport } from './public-export.mjs'

const cli = fileURLToPath(new URL('./public-export.mjs', import.meta.url))
test('CLI stages fixed source and inspects a missing target without creating it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'public-export-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source with spaces'), stage = join(root, 'new stage'), target = join(root, 'public target')
  await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid'])
  await writeFile(join(source, 'README.md'), 'Public fixture\n')
  git(['add', 'README.md']); git(['commit', '-qm', 'fixture'])
  const revision = git(['rev-parse', 'HEAD'])
  const policy = join(root, 'policy.json')
  await writeFile(policy, JSON.stringify({ version: 1, rules: [{ kind: 'file', path: 'README.md', action: 'include', reason: 'fixture' }] }))
  const staged = spawnSync(process.execPath, [cli, 'stage', '--source', source, '--revision', revision,
    '--policy', policy, '--destination', stage], { encoding: 'utf8', cwd: root })
  assert.equal(staged.status, 0, staged.stderr)
  assert.equal(JSON.parse(staged.stdout).targetCheckoutUpdated, false)
  assert.equal(await readFile(join(stage, 'README.md'), 'utf8'), 'Public fixture\n')
  const inspected = spawnSync(process.execPath, [cli, 'inspect', '--target', target, '--stage', stage], { encoding: 'utf8', cwd: root })
  assert.equal(inspected.status, 0, inspected.stderr)
  assert.equal(JSON.parse(inspected.stdout).targetExists, false)
  await assert.rejects(readFile(join(target, 'README.md')), { code: 'ENOENT' })
  const plan = JSON.parse(inspected.stdout), preparation = join(root, 'new preparation')
  const prepareArgs = ['prepare', '--stage', stage, '--target', target, '--preparation', preparation,
    '--stage-sha256', plan.stageManifestSha256, '--target-sha256', plan.targetStateSha256]
  const stale = spawnSync(process.execPath, [cli, ...prepareArgs.slice(0, -1), '0'.repeat(64)], { encoding: 'utf8' })
  assert.equal(stale.status, 1)
  await assert.rejects(readFile(join(preparation, 'prepared.json')), { code: 'ENOENT' })
  const prepared = spawnSync(process.execPath, [cli, ...prepareArgs], { encoding: 'utf8', cwd: root })
  assert.equal(prepared.status, 0, prepared.stderr)
  const receipt = JSON.parse(prepared.stdout)
  assert.equal(receipt.targetUpdated, false)
  const verified = spawnSync(process.execPath, [cli, 'verify', '--preparation', preparation,
    '--receipt-sha256', receipt.preparedSha256], { encoding: 'utf8' })
  assert.equal(verified.status, 0, verified.stderr)
  assert.equal(JSON.parse(verified.stdout).verified, true)
  assert.equal(JSON.parse(verified.stdout).applyAuthorized, false)
  await assert.rejects(readFile(join(target, 'README.md')), { code: 'ENOENT' })
  await writeFile(join(preparation, 'next/README.md'), 'tampered private marker')
  const tampered = spawnSync(process.execPath, [cli, 'verify', '--preparation', preparation,
    '--receipt-sha256', receipt.preparedSha256], { encoding: 'utf8' })
  assert.equal(tampered.status, 1)
  assert.equal(tampered.stdout, '')
  assert.ok(!tampered.stderr.includes(root) && !tampered.stderr.includes('tampered private marker'))
  await mkdir(target)
  await writeFile(join(target, 'README.md'), 'Unmanaged original\n')
  const conflict = spawnSync(process.execPath, [cli, 'inspect', '--stage', stage, '--target', target], { encoding: 'utf8' })
  assert.equal(conflict.status, 2)
  assert.equal(JSON.parse(conflict.stdout).applicable, false)
  assert.equal(await readFile(join(target, 'README.md'), 'utf8'), 'Unmanaged original\n')
  const blocked = spawnSync(process.execPath, [cli, ...prepareArgs], { encoding: 'utf8' })
  assert.equal(blocked.status, 2)
  assert.equal(JSON.parse(blocked.stdout).applicable, false)
})

test('invalid/duplicate options and incomplete apply fail before filesystem work', async () => {
  for (const args of [[], ['apply'], ['inspect', '--stage', 'x', '--stage', 'y'],
    ['inspect', '--stage', 'x', '--unknown', 'y'], ['inspect', '--stage', '--target', '--target', 'y'],
    ['stage', '--source', 'x', '--revision', 'x', '--policy', 'x', '--public-documents', 'true'],
    ['stage', '--source', 'x', '--revision', 'x', '--policy', 'x', '--destination', 'x', '--public-documents', 'yes'],
    ['inspect', '--stage', 'x', '--target', 'x', '--public-documents', 'true']]) {
    await assert.rejects(runPublicExport(args), /Invalid export arguments/)
  }
  const error = spawnSync(process.execPath, [cli, 'inspect', '--stage', '/private-test-marker', '--target', '/unused'], { encoding: 'utf8' })
  assert.equal(error.status, 1)
  assert.equal(error.stdout, '')
  assert.ok(!error.stderr.includes('/private-test-marker'))
  const missing = spawnSync(process.execPath, [cli, 'verify', '--preparation', '/private-preparation-marker', '--receipt-sha256', '0'.repeat(64)], { encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.equal(missing.stdout, '')
  assert.ok(!missing.stderr.includes('/private-preparation-marker'))
  assert.ok(!missing.stderr.includes('no target checkout was updated'))
})

async function syncFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'public-export-apply-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), target = join(root, 'target'), policy = join(root, 'policy.json')
  await mkdir(join(source, 'docs'), { recursive: true })
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid'])
  git(['config', 'commit.gpgsign', 'false'])
  await writeFile(policy, JSON.stringify({ version: 1, rules: ['docs/a', 'docs/b'].map(path => ({ kind: 'file', path, action: 'include', reason: 'fixture' })) }))
  const call = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: root })
  let generation = 0
  const prepare = async (newRevision = true) => {
    if (newRevision) { git(['add', '-A']); git(['commit', '--allow-empty', '-qm', 'fixture']) }
    const stage = join(root, `stage-${++generation}`), preparation = join(root, `prepared-${generation}`)
    const staged = call(['stage', '--source', source, '--revision', git(['rev-parse', 'HEAD']), '--policy', policy, '--destination', stage])
    assert.equal(staged.status, 0, staged.stderr)
    const inspected = call(['inspect', '--stage', stage, '--target', target]); assert.equal(inspected.status, 0, inspected.stderr)
    const plan = JSON.parse(inspected.stdout)
    const prepared = call(['prepare', '--stage', stage, '--target', target, '--preparation', preparation,
      '--stage-sha256', plan.stageManifestSha256, '--target-sha256', plan.targetStateSha256])
    assert.equal(prepared.status, 0, prepared.stderr)
    const receipt = JSON.parse(prepared.stdout)
    return ['apply', '--preparation', preparation, '--receipt-sha256', receipt.preparedSha256,
      '--stage-sha256', plan.stageManifestSha256, '--target-sha256', plan.targetStateSha256]
  }
  return { root, source, target, call, prepare }
}

test('CLI explicit public documents preserve relocation provenance through approved prepare and apply', async t => {
  const f = await syncFixture(t)
  await mkdir(join(f.source, 'release'))
  await writeFile(join(f.source, 'docs/a'), 'Public guide\n')
  await writeFile(join(f.source, 'README.md'), 'Internal README\n')
  const names = ['README', 'CONTRIBUTING', 'SECURITY']
  for (const name of names) await writeFile(join(f.source, 'release', `${name}.public.md`),
    name === 'README' ? '# Public project\n[Guide](../docs/a) [Contribute](CONTRIBUTING.public.md)\n' : '[Home](README.public.md)\n')
  const policy = join(f.root, 'document-policy.json')
  await writeFile(policy, JSON.stringify({ version: 1, rules: ['README.md', 'docs/a', ...names.map(name => `release/${name}.public.md`)]
    .map(path => ({ kind: 'file', path, action: 'include', reason: 'reviewed fixture public documentation' })) }))
  execFileSync('git', ['-C', f.source, 'add', '.'])
  execFileSync('git', ['-C', f.source, 'commit', '-qm', 'public document fixture'])
  const revision = execFileSync('git', ['-C', f.source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const stage = join(f.root, 'document-stage'), preparation = join(f.root, 'document-preparation')
  const staged = f.call(['stage', '--source', f.source, '--revision', revision, '--policy', policy,
    '--destination', stage, '--public-documents', 'true'])
  assert.equal(staged.status, 0, staged.stderr)
  const stagedResult = JSON.parse(staged.stdout)
  assert.equal(stagedResult.manifest.transforms.length, 3)
  assert.equal(await readFile(join(stage, 'README.md'), 'utf8'), '# Public project\n[Guide](docs/a) [Contribute](CONTRIBUTING.md)\n')
  const inspected = f.call(['inspect', '--stage', stage, '--target', f.target])
  assert.equal(inspected.status, 0, inspected.stderr)
  const plan = JSON.parse(inspected.stdout)
  const prepared = f.call(['prepare', '--stage', stage, '--target', f.target, '--preparation', preparation,
    '--stage-sha256', plan.stageManifestSha256, '--target-sha256', plan.targetStateSha256])
  assert.equal(prepared.status, 0, prepared.stderr)
  const receipt = JSON.parse(prepared.stdout)
  await assert.rejects(lstat(f.target), { code: 'ENOENT' })
  const applied = f.call(['apply', '--preparation', preparation, '--receipt-sha256', receipt.preparedSha256,
    '--stage-sha256', plan.stageManifestSha256, '--target-sha256', plan.targetStateSha256])
  assert.equal(applied.status, 0, applied.stderr)
  assert.equal(JSON.parse(applied.stdout).publicationReady, false)
  const manifest = JSON.parse(await readFile(join(f.target, '.yugoo-export.json'), 'utf8'))
  assert.deepEqual(manifest.transforms, stagedResult.manifest.transforms)
  assert.equal(manifest.files['README.md'].sha256, stagedResult.manifest.files['README.md'].sha256)
  assert.equal(await readFile(join(f.source, 'README.md'), 'utf8'), 'Internal README\n')
  await assert.rejects(lstat(join(f.target, 'release/README.public.md')), { code: 'ENOENT' })
})

test('CLI applies explicit fixed-source receipts, renames managed files and preserves Git/user data', async t => {
  const f = await syncFixture(t)
  await writeFile(join(f.source, 'docs/a'), 'initial')
  const first = f.call(await f.prepare()); assert.equal(first.status, 0, first.stderr)
  const result = JSON.parse(first.stdout)
  assert.equal(result.wholeSyncCompleted, true); assert.equal(result.lockReleased, true); assert.equal(result.publicationReady, false)
  await mkdir(join(f.target, '.git')); await writeFile(join(f.target, '.git/config'), 'private Git config')
  await writeFile(join(f.target, 'user.txt'), 'user content')
  await rm(join(f.source, 'docs/a')); await writeFile(join(f.source, 'docs/b'), 'renamed')
  const second = f.call(await f.prepare()); assert.equal(second.status, 0, second.stderr)
  await assert.rejects(lstat(join(f.target, 'docs/a')), { code: 'ENOENT' })
  assert.equal(await readFile(join(f.target, 'docs/b'), 'utf8'), 'renamed')
  assert.equal(await readFile(join(f.target, 'user.txt'), 'utf8'), 'user content')
  assert.equal(await readFile(join(f.target, '.git/config'), 'utf8'), 'private Git config')
  const repeated = f.call(await f.prepare(false)); assert.equal(repeated.status, 0, repeated.stderr)
  assert.equal(JSON.parse(repeated.stdout).noChanges, true)
  assert.equal(JSON.parse(repeated.stdout).targetUpdated, false)
})

test('CLI rejects stale/malformed apply approvals without creating the target or leaking errors', async t => {
  const f = await syncFixture(t)
  await writeFile(join(f.source, 'docs/a'), 'approved')
  const args = await f.prepare()
  for (const key of ['--receipt-sha256', '--stage-sha256', '--target-sha256']) {
    for (const value of ['0'.repeat(64), 'not-a-hash']) {
      const altered = [...args]; altered[altered.indexOf(key) + 1] = value
      const result = f.call(altered)
      assert.equal(result.status, 1); assert.equal(result.stdout, '')
      assert.ok(!result.stderr.includes(f.root))
      assert.ok(!result.stderr.includes('no target checkout was updated'))
      await assert.rejects(lstat(f.target), { code: 'ENOENT' })
    }
  }
  const result = f.call(args); assert.equal(result.status, 0, result.stderr)
  assert.equal(await readFile(join(f.target, 'docs/a'), 'utf8'), 'approved')
})

test('CLI source config opt-in composes with document opt-in using immutable inputs only', async t => {
  const f = await syncFixture(t)
  const texts = {
    'package.json': JSON.stringify({ private: true, scripts: { build: 'pnpm -r build' } }),
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    'packages/knowledge-ladybug/package.json': JSON.stringify({ name: 'knowledge', dependencies: { '@ladybugdb/wasm-core': 'file:../../vendor/ladybug/runtime' } }),
    'release/public-source-baseline.json': JSON.stringify({ kind: 'proposed-public-source-dependency-baseline', schemaVersion: 1, releaseApproved: false,
      registry: 'https://registry.npmjs.org', ladybugSource: 'registry', ladybugVersion: '0.21.1', officialVersions: {}, rootScripts: ['build'], reviewedWorkspaceOverrides: {} }),
    'release/public-source-test-selection.json': JSON.stringify({ kind: 'proposed-public-source-root-test-selection', schemaVersion: 1, releaseApproved: false, rootScriptFileExclusions: {} }),
    'release/README.public.md': '# Public\n[Contribute](CONTRIBUTING.public.md)\n',
    'release/CONTRIBUTING.public.md': '[Home](README.public.md)\n',
    'release/SECURITY.public.md': '[Home](README.public.md)\n',
    'pnpm-lock.yaml': 'development lock preserved\n',
  }
  for (const [path, text] of Object.entries(texts)) { await mkdir(join(f.source, path, '..'), { recursive: true }); await writeFile(join(f.source, path), text) }
  const git = args => execFileSync('git', ['-C', f.source, ...args], { encoding: 'utf8' }).trim()
  git(['add', '.']); git(['commit', '-qm', 'reviewed source fixture'])
  const revision = git(['rev-parse', 'HEAD']), policy = join(f.root, 'source-policy.json')
  await writeFile(policy, JSON.stringify({ version: 1, rules: Object.keys(texts).map(path => ({ kind: 'file', path,
    action: path === 'pnpm-lock.yaml' ? 'exclude' : 'include', reason: 'explicit fixture decision' })) }))
  await writeFile(join(f.source, 'release/public-source-baseline.json'), 'dirty selection')
  const base = ['stage', '--source', f.source, '--revision', revision, '--policy', policy]
  const only = f.call([...base, '--destination', join(f.root, 'source-only'), '--public-source-config', 'true'])
  assert.equal(only.status, 0, only.stderr)
  const first = JSON.parse(only.stdout)
  assert.equal(first.manifest.sourceConfig.releaseApproved, false)
  assert.equal(first.manifest.transforms.length, 0)
  const both = f.call([...base, '--destination', join(f.root, 'source-and-docs'), '--public-source-config', 'true', '--public-documents', 'true'])
  assert.equal(both.status, 0, both.stderr)
  const second = JSON.parse(both.stdout)
  assert.equal(second.manifest.transforms.length, 3)
  assert.equal(second.manifest.sourceConfig.lockAction, 'regenerate-in-isolated-source-candidate')
  assert.equal(JSON.parse(await readFile(join(second.target, 'packages/knowledge-ladybug/package.json'), 'utf8')).dependencies['@ladybugdb/wasm-core'], '0.21.1')
  const inspected = f.call(['inspect', '--stage', second.target, '--target', join(f.root, 'not-created')])
  assert.equal(inspected.status, 0, inspected.stderr)
  assert.equal(JSON.parse(inspected.stdout).releaseApproved, false)
  const bad = f.call([...base, '--destination', join(f.root, 'invalid-source-option'), '--public-source-config', 'yes'])
  assert.equal(bad.status, 1)
  await assert.rejects(readFile(join(f.root, 'invalid-source-option', '.yugoo-export.json')), { code: 'ENOENT' })
  assert.equal(await readFile(join(f.source, 'pnpm-lock.yaml'), 'utf8'), texts['pnpm-lock.yaml'])
})
