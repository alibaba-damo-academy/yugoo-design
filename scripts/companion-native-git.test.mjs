import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { prepareCompanionNativeGit, stageCompanionNativeGit, verifyCompanionNativeGit } from './companion-native-git.mjs'
import { checkRuntime, inspectRuntime, assertGitRuntimeReceipt } from '../packages/companion/src/npm-runtime-check.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'companion-native-assets-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'packages/git-native'), artifacts = join(root, 'prebuilds'), shared = join(root, 'runtime')
  const put = async (base, path, bytes) => { await mkdir(dirname(join(base, path)), { recursive: true }); await writeFile(join(base, path), bytes) }
  const loader = await readFile(new URL('../packages/git-native/index.cjs', import.meta.url))
  await put(join(root, 'packages/core'), 'package.json', '{}')
  for (const name of ['iconv-lite', 'isomorphic-git']) {
    const base = join(root, 'packages/core/node_modules', name)
    await put(base, 'package.json', JSON.stringify({ name, version: '0.0.0-fixture', main: 'index.js', license: 'MIT' }))
    await put(base, 'index.js', '// inventory fixture'); await put(base, 'LICENSE', 'fixture license')
  }
  for (const name of ['native-source', 'third-party', 'scripts']) await mkdir(join(source, name), { recursive: true })
  for (const [name, bytes] of Object.entries({ 'package.json': JSON.stringify({ name: 'yugoo-design-git-native', version: '0.1.0-beta.2', license: 'MIT' }),
    'index.cjs': loader, 'index.d.ts': '// fixture types', LICENSE: 'fixture MIT', NOTICE: 'fixture source notice' })) await put(source, name, bytes)
  const builds = []
  for (const platform of ['linux-x64', 'win32-x64', 'darwin-arm64']) {
    const path = `native/yugoo_git.${platform}.node`, bytes = Buffer.from(`inventory fixture ${platform}; not executable`)
    await put(artifacts, path, bytes)
    builds.push({ path, bytes: bytes.length, sha256: sha(bytes) })
  }
  await put(source, 'SOURCE.json', JSON.stringify({ inputs: [{ path: 'index.cjs', sha256: sha(loader) }], artifacts: builds }))
  await mkdir(join(shared, 'scripts'), { recursive: true })
  await put(shared, 'scripts/git-native-worker.js', '// inventory-only fixture, not worker execution\n')
  await put(shared, 'scripts/git-runtime-check.mjs', '// inventory-only fixture, not runtime execution\n')
  return { root, source, artifacts, shared, put, prepare: () => prepareCompanionNativeGit(root, { artifactRoot: artifacts }) }
}

test('native Git physical closure preserves the original loader/materials and all three exact prebuilds', async t => {
  const f = await fixture(t), prepared = await f.prepare()
  const receipt = await stageCompanionNativeGit(f.shared, prepared)
  const result = await verifyCompanionNativeGit(f.shared)
  assert.equal(result.files, prepared.files.size)
  assert.deepEqual(result.platformsExecuted, [])
  assert.equal(result.loaderSha256, receipt.files['index.cjs'].sha256)
  assert.deepEqual(receipt.supported, ['linux-gnu-x64', 'windows-msvc-x64', 'macos-arm64'])
  assert.equal(receipt.scope, 'unchanged-source-binding-and-three-pinned-prebuilds')
  assert.deepEqual(await readFile(join(f.shared, 'git-native/index.cjs')), await readFile(join(f.source, 'index.cjs')))
})

test('missing or changed prebuild fails before staging, without a CLI fallback', async t => {
  const f = await fixture(t)
  await rm(join(f.artifacts, 'native/yugoo_git.win32-x64.node'))
  await assert.rejects(f.prepare(), /ENOENT/)
  await f.put(f.artifacts, 'native/yugoo_git.win32-x64.node', 'wrong binary')
  await assert.rejects(f.prepare(), /prebuild size changed/)
})

test('Darwin is mandatory in the normal inventory and its runtime bytes stay pinned', async t => {
  const f = await fixture(t), path = 'native/yugoo_git.darwin-arm64.node'
  const bytes = await readFile(join(f.artifacts, path))
  await rm(join(f.artifacts, path))
  await assert.rejects(f.prepare(), /ENOENT/)
  await f.put(f.artifacts, path, bytes)
  await stageCompanionNativeGit(f.shared, await f.prepare())
  await f.put(f.shared, 'git-native/' + path, Buffer.from(bytes.map(byte => byte ^ 1)))
  await assert.rejects(verifyCompanionNativeGit(f.shared), /runtime bytes changed/)
})

test('dependency notices and original README do not masquerade as a standalone license file', async t => {
  const f = await fixture(t), base = join(f.root, 'packages/core/node_modules/iconv-lite')
  await rm(join(base, 'LICENSE'))
  await f.put(base, 'NOTICE', 'original attribution')
  await f.put(base, 'README.md', 'original usage and attribution')
  const prepared = await f.prepare(), prefix = 'third-party/javascript/iconv-lite@0.0.0-fixture/'
  const source = JSON.parse(prepared.files.get(prefix + 'SOURCE.json'))
  assert.equal(source.standaloneLicenseFilePresent, false)
  assert.equal(source.attributionFilePresent, true)
  assert.equal(source.originalReadmePreserved, true)
  assert.equal(source.licenseObligationsAccepted, false)
  assert.equal(prepared.files.get(prefix + 'README.md').toString(), 'original usage and attribution')
})

test('changed source loader is refused even with the original binary receipts', async t => {
  const f = await fixture(t)
  await f.put(f.source, 'index.cjs', 'module.exports = {}')
  await assert.rejects(f.prepare(), /source input changed/)
})

test('installed .cjs bytes, missing worker and extra native files are checked independently', async t => {
  const f = await fixture(t)
  await stageCompanionNativeGit(f.shared, await f.prepare())
  await f.put(f.shared, 'git-native/unlisted.node', 'extra')
  await assert.rejects(verifyCompanionNativeGit(f.shared), /inventory changed/)
  await rm(join(f.shared, 'git-native/unlisted.node'))
  const loader = await readFile(join(f.shared, 'git-native/index.cjs'))
  await f.put(f.shared, 'git-native/index.cjs', Buffer.concat([loader, Buffer.from('\n// changed')]))
  await assert.rejects(verifyCompanionNativeGit(f.shared), /runtime size changed/)
  await f.put(f.shared, 'git-native/index.cjs', loader)
  await rm(join(f.shared, 'scripts/git-native-worker.js'))
  await assert.rejects(verifyCompanionNativeGit(f.shared), /ENOENT/)
})

test('native artifact symlinks cannot import an external runtime through the manifest', async t => {
  const f = await fixture(t), path = 'native/yugoo_git.linux-x64.node'
  const bytes = await readFile(join(f.artifacts, path))
  await f.put(f.root, 'outside.node', bytes)
  await rm(join(f.artifacts, path))
  await symlink(join(f.root, 'outside.node'), join(f.artifacts, path))
  await assert.rejects(f.prepare(), /symlink rejected/)
})

test('Rust target cache is excluded while a changed actual Cargo input remains a refusal', async t => {
  const f = await fixture(t), cargo = Buffer.from('[package]\nname="fixture"\n')
  await f.put(f.source, 'native-source/Cargo.toml', cargo)
  const source = JSON.parse(await readFile(join(f.source, 'SOURCE.json'), 'utf8'))
  source.inputs.push({ path: 'native-source/Cargo.toml', sha256: sha(cargo) })
  await f.put(f.source, 'SOURCE.json', JSON.stringify(source))
  await f.put(f.source, 'native-source/target/sentinel-cache', 'must not be read or staged')
  const prepared = await f.prepare()
  assert.equal([...prepared.files.keys()].some(path => path.startsWith('native-source/target/')), false)
  assert.ok(prepared.files.has('native-source/Cargo.toml'))
  await f.put(f.source, 'native-source/Cargo.toml', 'changed Cargo source')
  await assert.rejects(f.prepare(), /source input changed/)
})

test('same-source input snapshot excludes only the native Rust target cache', { timeout: 60000 }, async t => {
  const { snapshotCompanionInputs } = await import('./build-companion-npm-candidate.mjs')
  const workspace = fileURLToPath(new URL('../', import.meta.url)), target = join(workspace, 'packages/git-native/native-source/target')
  // Exclusive creation: never touch a contributor's existing build cache.
  await mkdir(target)
  t.after(() => rm(target, { recursive: true, force: true }))
  const before = await snapshotCompanionInputs(process.env.YUGOO_NATIVE_GIT_ARTIFACT_ROOT)
  await writeFile(join(target, 'sentinel-cache'), 'a cache is not a source input')
  const after = await snapshotCompanionInputs(process.env.YUGOO_NATIVE_GIT_ARTIFACT_ROOT)
  assert.deepEqual(after, before)
  assert.ok(Object.hasOwn(after, 'packages/git-native/native-source/Cargo.toml'))
  assert.ok(Object.hasOwn(after, 'packages/git-native/index.cjs'))
  assert.ok(Object.keys(after).some(path => path.startsWith('native-material-input:')))
})

test('normal source worker and installed diagnostic use Core without system Git, independently of embedding', { timeout: 60000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'companion-installed-library-git-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = fileURLToPath(new URL('../', import.meta.url)), shared = join(root, 'consumer/payload/shared')
  const { build } = await import('tsdown')
  const config = (await import('../packages/companion/tsdown.server.config.ts')).default
  const modules = new Set()
  await build({ ...config, config: false, clean: false, outDir: join(shared, 'scripts'),
    entry: { 'git-native-worker': join(workspace, 'packages/core/src/git-native-worker.ts'), 'git-runtime-check': join(workspace, 'packages/companion/src/git-runtime-check.mjs') },
    plugins: [...config.plugins, { name: 'git-test-source-inputs', transform(_code, id) {
      assert.doesNotMatch(id, /\/packages\/core\/lib\//, 'Worker test cannot consume old compiled Core')
      modules.add(id)
    } }] })
  assert.ok([...modules].some(id => id.endsWith('/core/src/git-native-worker.ts')))
  assert.ok([...modules].some(id => id.endsWith('/core/src/design-git-read.ts')))
  await stageCompanionNativeGit(shared, await prepareCompanionNativeGit(workspace, { artifactRoot: process.env.YUGOO_NATIVE_GIT_ARTIFACT_ROOT }))
  await verifyCompanionNativeGit(shared)
  const npmRoot = join(root, 'consumer'), receiptDirectory = join(root, 'receipts')
  await writeFile(join(npmRoot, 'package.json'), JSON.stringify({ name: 'isolated-real-git-runtime-check', type: 'module', 'x-design-release-review': { nativeGit: 'shared-core-library' } }))
  const options = { npmRoot, receiptDirectory, disableEmbedding: true }
  const receipt = await checkRuntime(options), fresh = await inspectRuntime(options)
  assert.equal(receipt.status, 'disabled', receipt.git?.reason)
  assert.equal(receipt.git.status, 'passed', receipt.git?.reason)
  assert.equal(receipt.git.load.childAbsent, true)
  assert.equal(receipt.git.load.externalGitCalls, 0)
  assert.equal(receipt.nativeHostRegistrationVerified, false)
  assertGitRuntimeReceipt(receipt, fresh)
  for (const mutate of [r => { delete r.git }, r => { r.git.status = 'failed' }, r => { r.git.load.childAbsent = false },
    r => { r.git.load.observation.node = '0.0.0' }, r => { r.git.load.signal = 'SIGTERM' }, r => { r.git.load.code = 'ETIMEDOUT' },
    r => { r.git.identitySha256 = '0'.repeat(64) }, r => { r.scope = 'isolated-test-contract' }]) {
    const changed = structuredClone(receipt); mutate(changed)
    assert.throws(() => assertGitRuntimeReceipt(changed, fresh))
  }
  const worker = join(shared, 'scripts/git-native-worker.js'), bytes = await readFile(worker)
  await writeFile(worker, Buffer.concat([bytes, Buffer.from('\n// drift')]))
  assert.throws(() => assertGitRuntimeReceipt(receipt, { ...fresh, gitPrerequisites: { ...fresh.gitPrerequisites, worker: { ...fresh.gitPrerequisites.worker, sha256: '1'.repeat(64) } } }))
  await rm(worker)
  const missing = await checkRuntime(options)
  assert.equal(missing.status, 'failed'); assert.equal(missing.git.status, 'failed')
})
