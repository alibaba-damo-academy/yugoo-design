import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { prepareCodexDesktopNpmSource, verifyCodexDesktopNpmSource } from '../src/npm-codex-desktop-source.mjs'
import { planCodexDesktopMarketplace, applyCodexDesktopMarketplace } from '../src/npm-installer-codex.mjs'
import { installerMain } from '../src/npm-installer.mjs'
import { agentInstallation } from '../src/npm-agent-installation.mjs'
import { assertDesktopNpmIdentity } from '../src/npm-desktop-preparation.mjs'

test('desktop preparation requests bounded inputs and never substitutes CLI registration', async () => {
  for (const version of ['latest', '1.02.3', '1.2.3-01', '1.2.3+bad..part'])
    assert.throws(() => assertDesktopNpmIdentity('@test/companion', version))
  const missing = await agentInstallation({ host: 'codex-desktop' }, { npmRoot: '/not-read' })
  assert.equal(missing.status, 'inputs-required')
  assert.deepEqual(missing.missing, ['receipt-dir', 'destination'])
  assert.equal(missing.hostRegistered, false)
  await assert.rejects(agentInstallation({ host: 'codex-desktop', 'codex-executable': '/not-run' }), /unsupported/)
  const result = await agentInstallation({ host: 'codex-desktop', destination: '/source', 'receipt-dir': '/receipts' }, {
    codexDesktopPrepare: async () => ({ status: 'prepared-native-install-pending', marketplacePrepared: true,
      hostRegistered: false, installed: false, loaded: false }),
  })
  assert.equal(result.installation.registration, 'not-performed')
  assert.equal(result.installation.activation, 'required')
  assert.equal(result.usable, false)
  assert.equal(result.installation.nextActions[0].action, 'activate-native-plugin')
})

/** Explicit acquired npm inputs; not a fixture standing in for a native Host. */
const realInputs = process.env.YUGOO_CODEX_DESKTOP_NPM_TEST_INPUTS
test('direct source entry checks the acquired runtime before preparing the catalog', { skip: !realInputs }, async t => {
  const config = JSON.parse(await readFile(realInputs, 'utf8'))
  const directory = await mkdtemp(join(config.evidenceDirectory ?? tmpdir(), 'codex-npm-direct-'))
  if (!config.evidenceDirectory) t.after(() => rm(directory, { recursive: true, force: true }))
  const home = join(directory, 'home'), receipts = join(directory, 'receipts')
  await mkdir(home); await mkdir(receipts)
  const source = join(home, 'source')
  const result = await installerMain(['install', '--host', 'codex-desktop', '--user-root', home,
    '--destination', source, '--receipt-dir', receipts, '--node-executable', config.nodeExecutable], { npmRoot: config.B.npmRoot })
  assert.equal(result.marketplacePrepared, true)
  for (const key of ['hostRegistered', 'installed', 'loaded', 'usable']) assert.equal(result[key], false)
  const mapping = JSON.parse(await readFile(join(source, 'codex-desktop.json')))
  assert.ok(mapping.source.runtimeReceipt.startsWith(join(receipts, 'runtime/')))
  const runtime = JSON.parse(await readFile(mapping.source.runtimeReceipt))
  assert.equal(runtime.scope, 'installed-runtime-readonly'); assert.equal(runtime.status, 'load-verified')
  assert.equal(runtime.git.status, 'passed'); assert.equal(runtime.git.load.childAbsent, true)
  assert.equal(runtime.load.childAbsent, true)
  if (config.evidenceDirectory) await writeFile(join(directory, 'direct-observation.json'), JSON.stringify({
    scope: 'new source entry default runtime-check path with actual acquired npm B', result,
    runtimeReceipt: mapping.source.runtimeReceipt, runtimeIdentitySha256: runtime.identitySha256,
    nativeActivationVerified: false,
  }, null, 2) + '\n')
})
test('transported small source launches the acquired runtime after cache relocation', { skip: !realInputs }, async t => {
  const config = JSON.parse(await readFile(realInputs, 'utf8'))
  const directory = await mkdtemp(join(config.evidenceDirectory ?? tmpdir(), 'codex-npm-launcher-'))
  if (!config.evidenceDirectory) t.after(() => rm(directory, { recursive: true, force: true }))
  const home = join(directory, 'home'); await mkdir(home)
  const source = join(home, 'source')
  await prepareCodexDesktopNpmSource({ ...config.A, nodeExecutable: config.nodeExecutable, userRoot: home, destination: source })
  const cache = join(home, 'transported-cache'); await cp(source, cache, { recursive: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:CODEX_|OPENAI_)/u.test(key)))
  Object.assign(env, { HOME: home, USERPROFILE: home })
  const result = await promisify(execFile)(config.nodeExecutable, [join(cache, 'scripts/design.mjs'), '--help'], { env, cwd: directory, timeout: 30000 })
  assert.ok(result.stdout.includes('serve') && result.stdout.includes('mcp'))
  const mapping = JSON.parse(await readFile(join(cache, 'codex-desktop.json')))
  await verifyCodexDesktopNpmSource(cache, mapping)
  if (config.evidenceDirectory) await writeFile(join(directory, 'launcher-observation.json'), JSON.stringify({
    scope: 'small source file transport and actual acquired CLI help only', source, cache, exitCode: 0,
    sharedEntry: join(config.A.npmRoot, 'payload/shared/scripts/design.mjs'), nativeCacheLoadingVerified: false,
  }, null, 2) + '\n')
})
test('real acquired npm A/B prepare, saved-plan apply, owned update and rejection boundaries', { skip: !realInputs }, async t => {
  const config = JSON.parse(await readFile(realInputs, 'utf8'))
  const directory = await mkdtemp(join(config.evidenceDirectory ?? tmpdir(), 'codex-npm-source-'))
  if (!config.evidenceDirectory) t.after(() => rm(directory, { recursive: true, force: true }))
  const home = join(directory, 'home'), receipts = join(directory, 'receipts')
  await mkdir(home); await mkdir(join(home, 'sources')); await mkdir(receipts)
  const catalog = join(home, '.agents/plugins/marketplace.json')
  await mkdir(join(home, '.agents/plugins'), { recursive: true })
  const unrelated = { name: 'retained-example', source: { source: 'local', path: './retained' } }
  await writeFile(catalog, JSON.stringify({ name: 'personal', plugins: [unrelated] }))
  const observations = { scope: 'source-API-with-real-acquired-npm-inputs', directory,
    newInstalledCliVerified: false, nativeActivationVerified: false, checks: [] }
  const input = (choice, destination) => ({ ...config[choice], userRoot: home, destination,
    nodeExecutable: config.nodeExecutable })
  const args = (choice, destination) => ['install', '--host', 'codex-desktop', '--receipt-dir', receipts,
    '--user-root', home, '--destination', destination, '--node-executable', config.nodeExecutable,
    '--runtime-receipt', config[choice].runtimeReceipt]
  let sourceA, sourceB, receiptA, receiptB
  await t.test('normal source API prepares A and applies its exact saved plan without native activation', async () => {
    sourceA = join(home, 'sources/A')
    const plan = await installerMain([...args('A', sourceA), '--dry-run'], { npmRoot: config.A.npmRoot })
    assert.equal(plan.status, 'desktop-plan-ready'); assert.equal(plan.applyScope.includes('catalog'), true)
    assert.equal(plan.marketplacePrepared, false); assert.equal(plan.applySupported, true)
    const applied = await installerMain(['install', '--host', 'codex-desktop', '--apply', '--plan', plan.planFile,
      '--receipt-dir', receipts, '--user-root', home], { npmRoot: config.A.npmRoot })
    assert.equal(applied.marketplacePrepared, true); assert.equal(applied.hostRegistered, false)
    assert.equal(applied.installed, false); assert.equal(applied.loaded, false)
    assert.equal(applied.package.name, config.A.packageName)
    receiptA = applied.receiptPath
    observations.A = { plan, applied }
    const sourceFiles = await readdir(sourceA)
    assert.ok(!sourceFiles.includes('web') && !sourceFiles.includes('node_modules'), 'No copied runtime or fake web assets')
    const launch = await readFile(join(sourceA, 'scripts/design.mjs'), 'utf8')
    assert.ok(launch.includes(config.A.npmRoot)); assert.ok(!launch.includes('../../../shared'))
  })
  await t.test('normal B entry uses the exact previous receipt, preserves A and unrelated entries', async () => {
    sourceB = join(home, 'sources/B')
    const applied = await installerMain([...args('B', sourceB), '--previous-receipt', receiptA], { npmRoot: config.B.npmRoot })
    assert.equal(applied.action, 'update'); assert.equal(applied.marketplacePrepared, true)
    for (const key of ['hostRegistered', 'installed', 'loaded', 'usable']) assert.equal(applied[key], false)
    assert.equal(applied.installation.registration, 'not-performed')
    receiptB = applied.receiptPath; observations.B = applied
    const current = JSON.parse(await readFile(catalog))
    assert.deepEqual(current.plugins.find(p => p.name === unrelated.name), unrelated)
    assert.equal(current.plugins.filter(p => p.name === 'yugoo-design').length, 1)
    assert.equal(current.plugins.find(p => p.name === 'yugoo-design').source.path, './sources/B')
    const oldMapping = JSON.parse(await readFile(join(sourceA, 'codex-desktop.json')))
    const preserved = await verifyCodexDesktopNpmSource(sourceA, oldMapping)
    assert.equal(preserved.npmRoot, config.A.npmRoot); assert.equal(preserved.version, config.A.packageVersion)
  })
  await t.test('wrong package identity and version cannot create an output source', async () => {
    for (const bad of [{ packageName: '@wrong/companion' }, { packageVersion: '9.9.9' }])
      await assert.rejects(prepareCodexDesktopNpmSource({ ...input('B', join(home, 'sources/wrong')), ...bad }), /package (name|version) mismatch/)
    await assert.rejects(readdir(join(home, 'sources/wrong')), { code: 'ENOENT' })
  })
  await t.test('missing runtime assets, receipts and symlink/alias paths are rejected', async () => {
    const incomplete = join(directory, 'incomplete-npm'); await mkdir(incomplete)
    await writeFile(join(incomplete, 'package.json'), await readFile(join(config.B.npmRoot, 'package.json')))
    await assert.rejects(prepareCodexDesktopNpmSource({ ...input('B', join(home, 'sources/missing-runtime')), npmRoot: incomplete }), /Missing desktop shared runtime asset/)
    await assert.rejects(prepareCodexDesktopNpmSource({ ...input('B', join(home, 'sources/missing-receipt')), runtimeReceipt: join(directory, 'absent-receipt') }), /ENOENT/)
    const alias = join(directory, 'npm-alias'); await symlink(config.B.npmRoot, alias, 'dir')
    await assert.rejects(prepareCodexDesktopNpmSource({ ...input('B', join(home, 'sources/alias')), npmRoot: alias }), /symlink|Canonical/)
    const parentAlias = join(home, 'source-alias'); await symlink(join(home, 'sources'), parentAlias, 'dir')
    await assert.rejects(prepareCodexDesktopNpmSource(input('B', join(parentAlias, 'nested'))), /symlink|Canonical/)
  })
  await t.test('inventory tampering and same-version relocation preserve the existing catalog', async () => {
    const probe = join(home, 'sources/B-probe')
    await prepareCodexDesktopNpmSource(input('B', probe))
    const mapping = JSON.parse(await readFile(join(probe, 'codex-desktop.json')))
    const before = await readFile(catalog)
    await assert.rejects(verifyCodexDesktopNpmSource(probe, { ...mapping,
      source: { ...mapping.source, packageInventorySha256: '0'.repeat(64) } }), /inventory changed/)
    await assert.rejects(planCodexDesktopMarketplace({ pluginRoot: probe, userRoot: home, previousReceipt: receiptB }), /new exact version/)
    await writeFile(join(probe, 'scripts/design.mjs'), '// foreign edit retained\n')
    await assert.rejects(planCodexDesktopMarketplace({ pluginRoot: probe, userRoot: home }), /source changed/)
    assert.deepEqual(await readFile(catalog), before)
  })
  await t.test('another acquired npm version cannot apply an A plan', async () => {
    await assert.rejects(installerMain(['install', '--host', 'codex-desktop', '--apply', '--plan', observations.A.plan.planFile,
      '--receipt-dir', receipts], { npmRoot: config.B.npmRoot }), /another acquired npm version/)
  })
  await t.test('foreign catalog edits survive rejected apply; immutable A/B sources remain valid', async () => {
    const plan = await planCodexDesktopMarketplace({ pluginRoot: sourceB, userRoot: home })
    const external = JSON.parse(await readFile(catalog)); external.plugins.push({ name: 'external-edit', source: { source: 'local', path: './external' } })
    const bytes = JSON.stringify(external); await writeFile(catalog, bytes)
    await assert.rejects(applyCodexDesktopMarketplace(plan, { receiptDirectory: receipts }), /package or marketplace changed/)
    assert.equal(await readFile(catalog, 'utf8'), bytes)
    for (const source of [sourceA, sourceB]) await verifyCodexDesktopNpmSource(source, JSON.parse(await readFile(join(source, 'codex-desktop.json'))))
    observations.finalCatalogSha256 = createHash('sha256').update(bytes).digest('hex')
  })
  observations.checks = ['See actual TAP subtest results; these observations do not imply native activation.']
  if (config.evidenceDirectory) await writeFile(join(directory, 'observations.json'), JSON.stringify(observations, null, 2) + '\n')
})
