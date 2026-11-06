/** Isolated consumer install of one prepared archive, using the current Node.
 * Product runtime checks and the existing Ladybug WAL regression own semantics.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { isPathWithin } from '../packages/companion/src/npm-installer-paths.mjs'

const execute = promisify(execFile)
const [tarball, version, output, ...extra] = process.argv.slice(2)
assert.equal(extra.length, 0, 'Expected TARBALL VERSION ABS_OUTPUT_DIR')
assert.ok(tarball && isAbsolute(tarball), 'Absolute prepared tarball required')
assert.ok(version && typeof version === 'string', 'Expected package version required')
assert.ok(output && isAbsolute(output), 'Absolute fresh output directory required')
const workspace = fileURLToPath(new URL('../', import.meta.url))
assert.ok(!isPathWithin(workspace, output), 'Install output must be outside the checkout')
const physicalParent = await realpath(dirname(resolve(output)))
assert.ok(!isPathWithin(await realpath(workspace), join(physicalParent, basename(output))), 'Install output must be outside the checkout')
// HOME and NODE_PATH do not isolate Node's filesystem ancestor resolution.
// A missing bundled dependency must not be supplied by another local install.
for (let parent = physicalParent; ; parent = dirname(parent)) {
  try {
    await lstat(join(parent, 'node_modules'))
    throw new Error('Install output has an ancestor node_modules; choose an isolated temporary directory')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (parent === dirname(parent)) break
}
assert.equal((await stat(tarball)).isFile(), true)
await mkdir(output) // Exclusive: never replace previous installs or evidence.
const directories = Object.fromEntries(['consumer', 'home', 'tmp', 'cache', 'receipts', 'appdata', 'localappdata', 'xdg-cache', 'xdg-config', 'xdg-data', 'xdg-state'].map(key => [key, join(output, key)]))
await Promise.all(Object.values(directories).map(path => mkdir(path)))
const userconfig = join(output, 'user.npmrc'), globalconfig = join(output, 'global.npmrc')
await Promise.all([userconfig, globalconfig].map(path => writeFile(path, '')))
const node = await realpath(process.execPath)
const npmCli = process.platform === 'win32'
  ? join(dirname(node), 'node_modules/npm/bin/npm-cli.js')
  : resolve(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js')
assert.equal((await stat(npmCli)).isFile(), true, 'Use npm bundled with the tested Node')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_|^(?:PATH|NODE_OPTIONS|NODE_PATH|NPM_TOKEN|NODE_AUTH_TOKEN|ONNXRUNTIME_NODE_INSTALL_CUDA)$/iu.test(key)))
Object.assign(env, {
  PATH: dirname(node) + delimiter + (process.env.PATH ?? ''),
  HOME: directories.home, USERPROFILE: directories.home,
  APPDATA: directories.appdata, LOCALAPPDATA: directories.localappdata,
  XDG_CACHE_HOME: directories['xdg-cache'], XDG_CONFIG_HOME: directories['xdg-config'],
  XDG_DATA_HOME: directories['xdg-data'], XDG_STATE_HOME: directories['xdg-state'],
  TMPDIR: directories.tmp, TMP: directories.tmp, TEMP: directories.tmp,
})
const receipt = {
  scope: 'isolated-product-node-install', version,
  node: process.versions.node, execPath: node, platform: process.platform, arch: process.arch,
  tarball, tarballSha256: createHash('sha256').update(await readFile(tarball)).digest('hex'),
  nativeHostRegistrationVerified: false, semanticKagVerified: false, published: false,
}
async function run(label, args, extraEnv = {}) {
  receipt.stage = label
  receipt.commandLog = join(output, label + '.log')
  try {
    const result = await execute(node, args, {
      cwd: directories.consumer, env: { ...env, ...extraEnv },
      timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024,
    })
    await writeFile(join(output, label + '.log'), result.stdout + result.stderr)
    return result.stdout
  } catch (error) {
    await writeFile(join(output, label + '.log'), String(error.stdout ?? '') + String(error.stderr ?? '') + '\n' + error.message)
    // The runtime CLI returns a structured failure before exiting nonzero.
    // Retain it so CI can show the actual Git/native failure, not just exit 1.
    if (label === 'check-runtime') {
      try { receipt.runtime = JSON.parse(error.stdout) } catch { /* Raw output remains in the command log. */ }
    }
    receipt.commandStderr = String(error.stderr ?? '').slice(-4000)
    throw error
  }
}
try {
  await run('npm-install', [npmCli, 'install', '--prefix', directories.consumer, '--engine-strict', '--no-audit', '--no-fund',
    '--registry=https://registry.npmjs.org', '--userconfig', userconfig, '--globalconfig', globalconfig, '--cache', directories.cache, tarball])
  const installed = join(directories.consumer, 'node_modules/yugoo-design')
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'yugoo-design')
  assert.equal(manifest.version, version)
  receipt.installed = { root: installed, engines: manifest.engines }
  const result = JSON.parse(await run('check-runtime', [join(installed, 'bin/yugoo-design.mjs'), 'check-runtime', '--host', 'codex', '--receipt-dir', directories.receipts]))
  receipt.runtime = result
  assert.equal(result.scope, 'installed-runtime-readonly')
  assert.equal(result.observation.node, process.versions.node)
  assert.equal(await realpath(result.observation.execPath), node)
  assert.equal(result.status, 'load-verified')
  assert.equal(result.git.status, 'passed')
  assert.equal(result.git.load.childAbsent, true)
  assert.equal(result.load.childAbsent, true)
  assert.equal(result.nativeHostRegistrationVerified, false)
  assert.equal(result.semanticKagVerified, false)
  assert.equal(result.graVerified, false)
  const requireInstalled = createRequire(join(installed, 'package.json'))
  const driver = requireInstalled.resolve('@ladybugdb/wasm-core/nodejs')
  receipt.ladybugDriver = driver
  await run('ladybug-wal', ['--test', fileURLToPath(new URL('../packages/knowledge-ladybug/test/wal-same-process-reopen.test.cjs', import.meta.url))], { LADYBUG_DRIVER: driver })
  receipt.status = 'passed'
} catch (error) {
  receipt.status = 'failed'
  receipt.error = error.message
  console.error(JSON.stringify({
    status: 'failed', stage: receipt.stage, error: receipt.error.slice(0, 4000),
    runtimeReason: receipt.runtime?.reason?.slice(0, 4000),
    gitReason: receipt.runtime?.git?.reason?.slice(0, 4000),
    loadReason: receipt.runtime?.load?.reason?.slice(0, 4000),
    stderr: receipt.commandStderr, commandLog: receipt.commandLog,
  }))
  process.exitCode = 1
} finally {
  const file = join(output, 'node-runtime-receipt.json')
  await writeFile(file, JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify({ status: receipt.status, node: receipt.node, version, receipt: file }))
}
