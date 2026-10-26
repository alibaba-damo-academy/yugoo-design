/** Small immutable desktop source backed by an acquired, verified npm runtime. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isPathWithin } from './npm-installer-paths.mjs'
import { resolveNodeRuntime, verifyNodeRuntime } from './npm-node-runtime.mjs'
import { nodeRegistrationFiles } from './npm-node-registration.mjs'
import { assertDesktopNpmIdentity } from './npm-desktop-preparation.mjs'
import { assertRuntimePath, inspectRuntime, assertInstalledRuntimeReceipt } from './npm-runtime-check.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const digest = value => sha(JSON.stringify(value))
const encode = value => JSON.stringify(value, null, 2) + '\n'
export const CODEX_NPM_SOURCE_KIND = 'npm-backed'
const requiredShared = ['scripts/design.mjs', 'scripts/codex-desktop-bridge.mjs', 'scripts/codex-desktop-marketplace.mjs',
  'web/index.html', 'kits/web_app/kit.yaml', 'knowledge/runtime.mjs']

async function canonical(path) {
  assert.ok(typeof path === 'string' && isAbsolute(path), 'Absolute desktop input path required')
  await assertRuntimePath(path)
  assert.equal(await realpath(path), path, 'Canonical desktop input path required')
  return path
}
async function regular(path, budget = 16 * 1024 * 1024) {
  await assertRuntimePath(path)
  const info = await lstat(path)
  assert.ok(info.isFile() && info.size <= budget, 'Bounded regular desktop input required')
  return readFile(path)
}
async function inventory(root, includeBytes = false) {
  const files = {}
  async function visit(directory) {
    assert.ok((await lstat(directory)).isDirectory(), 'Desktop input directory required')
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name), info = await lstat(path)
      assert.ok(!info.isSymbolicLink(), 'Desktop source symlink rejected')
      if (info.isDirectory()) await visit(path)
      else {
        assert.ok(info.isFile(), 'Desktop source regular file required')
        const bytes = await readFile(path)
        files[relative(root, path).split('\\').join('/')] = includeBytes ? bytes : sha(bytes)
      }
    }
  }
  await visit(root)
  return files
}
function launcher(path) {
  return `const entry = new URL(${JSON.stringify(pathToFileURL(path).href)}); await import(entry.href)\n`
}

async function inputs({ npmRoot, packageName, packageVersion, nodeRuntime, runtimeReceipt, disableEmbedding = false }) {
  await canonical(npmRoot)
  const packageBytes = await regular(join(npmRoot, 'package.json'), 1024 * 1024)
  const manifest = JSON.parse(packageBytes)
  assert.equal(manifest.name, packageName, 'Desktop npm package name mismatch')
  assert.equal(manifest.version, packageVersion, 'Desktop npm package version mismatch')
  assertDesktopNpmIdentity(packageName, packageVersion)
  assert.equal(manifest['x-design-release-review']?.fixture, false, 'Desktop preparation requires a non-fixture acquired package')
  await verifyNodeRuntime(nodeRuntime)
  const packageInventory = await inventory(npmRoot)
  const shared = join(npmRoot, 'payload/shared'), overlay = join(npmRoot, 'payload/overlays/codex')
  for (const file of requiredShared) assert.ok(packageInventory['payload/shared/' + file], 'Missing desktop shared runtime asset: ' + file)
  const bytes = await inventory(overlay, true)
  for (const file of ['.codex-plugin/plugin.json', '.mcp.json', 'scripts/design.mjs',
    'skills/yugoo/SKILL.md', 'skills/design-panel/SKILL.md', 'skills/design-panel/codex-desktop.md'])
    assert.ok(bytes[file], 'Missing desktop overlay asset: ' + file)
  const plugin = JSON.parse(bytes['.codex-plugin/plugin.json'])
  assert.equal(plugin.name, 'yugoo-design'); assert.equal(plugin.version, packageVersion)
  assert.equal(plugin.skills, './skills/'); assert.equal(plugin.mcpServers, './.mcp.json')
  await canonical(runtimeReceipt)
  assert.ok(!isPathWithin(npmRoot, runtimeReceipt), 'Runtime receipt must remain outside npm package')
  const receiptInfo = await lstat(runtimeReceipt)
  assert.ok((process.getuid === undefined || receiptInfo.uid === process.getuid())
    && (process.platform === 'win32' || !(receiptInfo.mode & 0o022)), 'Runtime receipt must be owned and not writable by others')
  const receiptBytes = await regular(runtimeReceipt)
  const receipt = JSON.parse(receiptBytes)
  assert.equal(receipt.scope, 'installed-runtime-readonly', 'Actual installed-runtime receipt required')
  const current = await inspectRuntime({ npmRoot, host: 'codex-desktop', nodeRuntime, disableEmbedding })
  const runtime = assertInstalledRuntimeReceipt({ npmRoot, disableEmbedding }, receipt, current, sha(receiptBytes))
  return { manifest, bytes, shared, overlay, runtime, packageInventorySha256: digest(packageInventory), runtimeReceiptSha256: sha(receiptBytes) }
}

async function projectedFiles(binding, checked) {
  const files = { ...checked.bytes }
  const plugin = JSON.parse(files['.codex-plugin/plugin.json'])
  plugin.requires_local_executor = true
  files['.codex-plugin/plugin.json'] = Buffer.from(encode(plugin))
  const selected = await nodeRegistrationFiles(checked.overlay, 'codex', binding.nodeRuntime)
  files['.mcp.json'] = Buffer.from(selected['.mcp.json'])
  files['scripts/design.mjs'] = Buffer.from(launcher(join(checked.shared, 'scripts/design.mjs')))
  files['scripts/codex-desktop-bridge.mjs'] = Buffer.from(launcher(join(checked.shared, 'scripts/codex-desktop-bridge.mjs')))
  files['codex-desktop.json'] = Buffer.from(encode({ schemaVersion: 1, host: 'codex-desktop', nodeRuntime: binding.nodeRuntime,
    bridgeRuntime: 'Selected desktop-owned bundled Node, launched directly by the host; not a shared Node prerequisite.',
    nativeRegistrationVerified: false, loaded: false, source: binding }))
  return files
}

/** Recheck external npm/receipt bytes and every small source file, including extras. */
export async function verifyCodexDesktopNpmSource(source, mapping) {
  await canonical(source)
  const binding = mapping.source
  assert.equal(binding?.kind, CODEX_NPM_SOURCE_KIND)
  assert.equal(binding.schemaVersion, 1)
  assert.deepEqual(Object.keys(binding).sort(), ['schemaVersion', 'kind', 'npmRoot', 'packageName', 'packageVersion',
    'nodeRuntime', 'runtimeReceipt', 'runtimeReceiptSha256', 'packageInventorySha256', 'disableEmbedding', 'runtime'].sort(), 'Unknown npm-backed desktop source field')
  assert.deepEqual(mapping.nodeRuntime, binding.nodeRuntime, 'Desktop source Node mapping changed')
  assert.ok(!isPathWithin(source, binding.npmRoot) && !isPathWithin(binding.npmRoot, source), 'Desktop source and acquired runtime must be disjoint')
  assert.ok(!isPathWithin(source, binding.runtimeReceipt), 'Desktop runtime receipt must remain outside immutable source')
  const checked = await inputs(binding)
  assert.equal(checked.packageInventorySha256, binding.packageInventorySha256, 'Desktop acquired npm inventory changed')
  assert.equal(checked.runtimeReceiptSha256, binding.runtimeReceiptSha256, 'Desktop runtime receipt changed')
  assert.deepEqual(binding.runtime, checked.runtime, 'Desktop runtime verification changed')
  const expected = await projectedFiles(binding, checked), actual = await inventory(source)
  assert.deepEqual(actual, Object.fromEntries(Object.keys(expected).sort().map(path => [path, sha(expected[path])])), 'Desktop npm-backed source changed')
  return { npmRoot: binding.npmRoot, name: binding.packageName, version: binding.packageVersion,
    packageInventorySha256: binding.packageInventorySha256, runtimeReceiptSha256: binding.runtimeReceiptSha256 }
}

/** Materialize only the host overlay; acquired npm runtime/dependencies stay in place. */
export async function prepareCodexDesktopNpmSource({ npmRoot, packageName, packageVersion, destination, userRoot,
  nodeExecutable, runtimeReceipt, disableEmbedding = false }) {
  await canonical(userRoot)
  assert.ok(typeof destination === 'string' && isAbsolute(destination), 'Absolute new desktop source destination required')
  assert.ok(isPathWithin(userRoot, destination) && destination !== userRoot, 'Desktop source must be retained inside selected user home')
  assert.ok(!isPathWithin(npmRoot, destination) && !isPathWithin(destination, npmRoot), 'Desktop source must remain outside acquired npm package')
  assert.ok(!isPathWithin(destination, runtimeReceipt), 'Runtime receipt must remain outside new source')
  await assertRuntimePath(destination)
  await canonical(dirname(destination))
  try { await lstat(destination); assert.fail('Desktop source destination already exists; retained') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const nodeRuntime = await resolveNodeRuntime({ nodeExecutable })
  const checked = await inputs({ npmRoot, packageName, packageVersion, nodeRuntime, runtimeReceipt, disableEmbedding })
  const binding = { schemaVersion: 1, kind: CODEX_NPM_SOURCE_KIND, npmRoot, packageName, packageVersion, nodeRuntime,
    runtimeReceipt, runtimeReceiptSha256: checked.runtimeReceiptSha256, packageInventorySha256: checked.packageInventorySha256,
    disableEmbedding, runtime: checked.runtime }
  const files = await projectedFiles(binding, checked)
  await mkdir(destination, { mode: 0o700 })
  for (const [file, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(destination, file)), { recursive: true, mode: 0o700 })
    await writeFile(join(destination, file), bytes, { flag: 'wx', mode: 0o600 })
  }
  await verifyCodexDesktopNpmSource(destination, JSON.parse(files['codex-desktop.json']))
  return { source: destination, package: { name: packageName, version: packageVersion },
    packageInventorySha256: binding.packageInventorySha256, nodeRuntime, hostRegistered: false, installed: false, loaded: false }
}
