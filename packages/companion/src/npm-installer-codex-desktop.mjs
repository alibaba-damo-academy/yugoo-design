/** Acquired npm -> small desktop source -> existing owned marketplace transaction. */
import assert from 'node:assert/strict'
import { readFile, lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { prepareCodexDesktopNpmSource, CODEX_NPM_SOURCE_KIND } from './npm-codex-desktop-source.mjs'
import { assertRuntimePath } from './npm-runtime-check.mjs'
import { planCodexDesktopMarketplace, saveCodexDesktopMarketplacePlan, applyCodexDesktopMarketplace } from './npm-installer-codex.mjs'

const common = { host: 'codex-desktop', hostRegistered: false, installed: false, loaded: false, usable: false }
export const CODEX_DESKTOP_INSTALL_OPTIONS = ['host', 'dry-run', 'apply', 'plan', 'receipt-dir', 'user-root', 'destination',
  'node-executable', 'runtime-receipt', 'previous-receipt', 'disable-embedding']
function display(plan, extras) {
  return { ...common, package: { name: plan.npmPackage?.name, version: plan.version },
    source: plan.source, selector: plan.selector, version: plan.version, action: plan.action,
    marketplacePath: plan.marketplacePath, ...extras }
}
async function readJson(path) {
  assert.ok(typeof path === 'string' && isAbsolute(path), 'Absolute desktop receipt/plan path required')
  await assertRuntimePath(path)
  assert.equal(await realpath(path), path, 'Canonical desktop receipt/plan required')
  const info = await lstat(path)
  assert.ok(info.isFile() && info.size <= 16 * 1024 * 1024, 'Bounded regular desktop receipt/plan required')
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function installCodexDesktopFromNpm(values, { npmRoot, userRoot = homedir(), invokeRuntime } = {}) {
  for (const key of Object.keys(values)) assert.ok(CODEX_DESKTOP_INSTALL_OPTIONS.includes(key), 'Unsupported Codex Desktop option --' + key)
  assert.equal(values.host, 'codex-desktop')
  assert.ok(values['receipt-dir'], 'External --receipt-dir required')
  assert.ok(!(values.apply && values['dry-run']), 'Choose prepare or apply, not both')
  const receiptDirectory = resolve(values['receipt-dir'])
  if (values.apply) {
    assert.ok(values.plan, '--apply requires the exact saved --plan')
    for (const key of ['destination', 'node-executable', 'runtime-receipt', 'previous-receipt', 'disable-embedding'])
      assert.ok(!Object.hasOwn(values, key), 'Saved desktop plan cannot be combined with --' + key)
    const plan = await readJson(resolve(values.plan))
    const mapping = await readJson(join(plan.source, 'codex-desktop.json'))
    assert.equal(mapping.source?.kind, CODEX_NPM_SOURCE_KIND, 'Acquired-npm desktop plan required')
    assert.equal(mapping.source.npmRoot, resolve(npmRoot), 'Desktop plan belongs to another acquired npm version')
    if (values['user-root']) assert.equal(plan.userRoot, resolve(values['user-root']), 'Desktop profile differs from saved plan')
    const receipt = await applyCodexDesktopMarketplace(plan, { receiptDirectory })
    return display(plan, { status: 'prepared-native-install-pending', marketplacePrepared: receipt.marketplacePrepared,
      receiptPath: receipt.receiptPath, next: receipt.next })
  }
  assert.ok(!values.plan, '--plan is only valid with --apply')
  assert.ok(values.destination, 'New immutable --destination required')
  const manifest = await readJson(join(resolve(npmRoot), 'package.json'))
  let runtimeReceipt = values['runtime-receipt']
  if (!runtimeReceipt) {
    assert.equal(typeof invokeRuntime, 'function', 'Normal runtime checker or exact --runtime-receipt required')
    const args = ['check-runtime', '--host', 'codex-desktop', '--receipt-dir', join(receiptDirectory, 'runtime')]
    if (values['node-executable']) args.push('--node-executable', values['node-executable'])
    if (values['disable-embedding']) args.push('--disable-embedding')
    const runtime = await invokeRuntime(args)
    assert.ok(['load-verified', 'disabled'].includes(runtime.status), 'Desktop npm runtime is not ready')
    runtimeReceipt = runtime.receiptFile
  }
  const source = await prepareCodexDesktopNpmSource({ npmRoot: resolve(npmRoot), packageName: manifest.name, packageVersion: manifest.version,
    destination: resolve(values.destination), userRoot: resolve(values['user-root'] ?? userRoot),
    nodeExecutable: values['node-executable'], runtimeReceipt: resolve(runtimeReceipt), disableEmbedding: values['disable-embedding'] ?? false })
  const plan = await planCodexDesktopMarketplace({ pluginRoot: source.source, userRoot: resolve(values['user-root'] ?? userRoot),
    previousReceipt: values['previous-receipt'] ? resolve(values['previous-receipt']) : undefined })
  const planFile = await saveCodexDesktopMarketplacePlan(plan, { receiptDirectory })
  if (values['dry-run']) return display(plan, { package: source.package, status: 'desktop-plan-ready',
    planFile, planSha256: plan.planSha256, marketplacePrepared: false, applySupported: true,
    applyScope: 'owned personal catalog preparation; native installation/activation remains pending' })
  const receipt = await applyCodexDesktopMarketplace(plan, { receiptDirectory })
  return display(plan, { package: source.package, status: 'prepared-native-install-pending', planFile,
    marketplacePrepared: receipt.marketplacePrepared, receiptPath: receipt.receiptPath, next: receipt.next })
}
