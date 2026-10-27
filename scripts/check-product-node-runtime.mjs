/** Isolated consumer install of one prepared archive, using the current Node.
 * Product runtime checks and the existing Ladybug WAL regression own semantics.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
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
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_|^(?:PATH|NODE_OPTIONS|NODE_PATH|NPM_TOKEN|NODE_AUTH_TOKEN)$/iu.test(key)))
Object.assign(env, {
  PATH: dirname(node) + delimiter + (process.env.PATH ?? ''),
  HOME: directories.home, USERPROFILE: directories.home,
  APPDATA: directories.appdata, LOCALAPPDATA: directories.localappdata,
  XDG_CACHE_HOME: directories['xdg-cache'], XDG_CONFIG_HOME: directories['xdg-config'],
  XDG_DATA_HOME: directories['xdg-data'], XDG_STATE_HOME: directories['xdg-state'],
  TMPDIR: directories.tmp, TMP: directories.tmp, TEMP: directories.tmp,
  ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip',
})
const receipt = {
  scope: 'isolated-product-node-install', version,
  node: process.versions.node, execPath: node, platform: process.platform, arch: process.arch,
  tarball, tarballSha256: createHash('sha256').update(await readFile(tarball)).digest('hex'),
  nativeHostRegistrationVerified: false, semanticKagVerified: false, published: false,
}
async function run(label, args, extraEnv = {}) {
  try {
    const result = await execute(node, args, {
      cwd: directories.consumer, env: { ...env, ...extraEnv },
      timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024,
    })
    await writeFile(join(output, label + '.log'), result.stdout + result.stderr)
    return result.stdout
  } catch (error) {
    await writeFile(join(output, label + '.log'), String(error.stdout ?? '') + String(error.stderr ?? '') + '\n' + error.message)
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
  receipt.runtime = result
  const requireInstalled = createRequire(join(installed, 'package.json'))
  const driver = requireInstalled.resolve('@ladybugdb/wasm-core/nodejs')
  receipt.ladybugDriver = driver
  await run('ladybug-wal', ['--test', fileURLToPath(new URL('../packages/knowledge-ladybug/test/wal-same-process-reopen.test.cjs', import.meta.url))], { LADYBUG_DRIVER: driver })
  receipt.status = 'passed'
} catch (error) {
  receipt.status = 'failed'
  receipt.error = error.message
  process.exitCode = 1
} finally {
  const file = join(output, 'node-runtime-receipt.json')
  await writeFile(file, JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify({ status: receipt.status, node: receipt.node, version, receipt: file }))
}
