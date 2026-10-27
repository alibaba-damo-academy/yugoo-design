import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { stageDesktopPreparationMaterials } from '../npm-desktop-materials.mjs'
import { prepareDesktopPackage } from '../src/npm-desktop-preparation.mjs'
import { installerMain, INSTALL_HOSTS } from '../src/npm-installer.mjs'
import { readQwenWorkRuntimePins, inspectQwenWorkProcess } from '../src/qwenwork-connection.mjs'
const hash = b => createHash('sha256').update(b).digest('hex')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
async function fixture(t, version = '1.2.3', { legacyMarket = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-preparation-fixture-')); t.after(() => rm(root, { recursive: true, force: true }))
  const npmRoot = join(root, 'npm package'), destination = join(root, 'prepared'), runtime = join(npmRoot, 'payload/shared')
  for (const dir of ['scripts', 'knowledge', 'kits/web_app']) await mkdir(join(runtime, dir), { recursive: true })
  await writeFile(join(npmRoot, 'package.json'), JSON.stringify({ name: 'yugoo-design', version, type: 'module', 'x-design-release-review': { fixture: false } }))
  await writeFile(join(runtime, 'scripts/design.mjs'), '// isolated runtime fixture: no host/model\n')
  await writeFile(join(runtime, 'scripts/workbuddy-panel-service.mjs'), '// isolated service fixture\n')
  await writeFile(join(runtime, 'knowledge/runtime-manifest.json'), '{}'); await writeFile(join(runtime, 'kits/web_app/kit.yaml'), 'name: web_app\n')
  await stageDesktopPreparationMaterials(join(npmRoot, 'payload/desktop-preparation'))
  if (legacyMarket) {
    // Model the earlier shipped helper default in this isolated acquired package.
    // Keep its material inventory valid; production verification is unchanged.
    const materials = join(npmRoot, 'payload/desktop-preparation'), helper = join(materials, 'workbuddy-package.mjs')
    const source = await readFile(helper, 'utf8'), legacy = source.replace("WORKBUDDY_TEST_MARKET = 'yugoo-design'", "WORKBUDDY_TEST_MARKET = 'yugoo-workbuddy-test'")
    assert.notEqual(legacy, source); await writeFile(helper, legacy)
    const manifest = await json(join(materials, 'materials.json')); manifest.files['workbuddy-package.mjs'] = hash(legacy)
    await writeFile(join(materials, 'materials.json'), JSON.stringify(manifest, null, 2) + '\n')
  }
  const options = { npmRoot, destination, packageName: 'yugoo-design', packageVersion: version, suiteVersion: '0.3.22', target: 'workbuddy',
    nodeExecutable: "C:\\Tools\\Jeff's node\\node.exe", npmRootWindows: 'D:\\Yugoo\\npm-v123', destinationWindows: 'D:\\Yugoo\\prepared' }
  return { root, npmRoot, destination, runtime, options }
}

test('WorkBuddy stages from exact acquired package, retaining native protocol and a preparation-only receipt', async t => {
  const f = await fixture(t), before = await readFile(join(f.npmRoot, 'package.json'))
  const result = await prepareDesktopPackage(f.options)
  assert.equal(result.status, 'prepared'); assert.equal(result.nativeRegistered, false); assert.equal(result.loadedVersionVerified, false); assert.equal(result.runtimeAdmissionVerified, false)
  assert.equal(result.package.version, '1.2.3'); assert.equal(result.suiteVersion, '0.3.22'); assert.equal(result.windows.targetPathsVerified, process.platform === 'win32')
  const market = await json(join(result.nativeImport.market, '.codebuddy-plugin/marketplace.json'))
  assert.equal(market.name, 'yugoo-design'); assert.equal(result.nativeImport.marketName, 'yugoo-design'); assert.equal(market.plugins[0].version, '0.3.22')
  const suite = join(result.nativeImport.market, market.plugins[0].source), mcp = await json(join(suite, '.mcp.json'))
  assert.equal(mcp.mcpServers['design-system-workbuddy-probe'].args[0], 'D:\\Yugoo\\npm-v123\\payload\\shared\\scripts\\design.mjs')
  assert.ok((await readFile(join(suite, 'skills/yugoo/SKILL.md'), 'utf8')).includes('present_files'))
  const sharedPath = 'plugin/design-system/skills/design-panel/native-execution.md'
  const shared = await readFile(new URL('../' + sharedPath, import.meta.url))
  const staged = join(f.npmRoot, 'payload/desktop-preparation')
  assert.deepEqual(await readFile(join(staged, sharedPath)), shared)
  assert.equal((await json(join(staged, 'materials.json'))).files[sharedPath], hash(shared))
  assert.deepEqual(await readFile(join(suite, 'skills/yugoo/native-execution.md')), shared, 'actual staged marketplace helper resolves the maintained shared method')
  for (const event of Object.values((await json(join(suite, 'hooks/hooks.json'))).hooks)) assert.equal(event[0].hooks[0].asyncRewake, undefined)
  assert.deepEqual(await readFile(join(f.npmRoot, 'package.json')), before)
  const receipt = await json(result.receiptFile); assert.equal(receipt.sha256, result.receiptSha256); assert.equal(receipt.body.package.runtimeEntrySha256, hash(await readFile(join(f.runtime, 'scripts/design.mjs'))))
  assert.equal(INSTALL_HOSTS.includes('workbuddy'), false, 'Preparation must not invent generic native apply support')
  if (process.platform !== 'win32') {
    assert.equal(result.windows.nodeRuntime.verified, false)
    assert.equal(result.windows.nodeRuntime.version, null)
    assert.equal(result.windows.nodeRuntime.source, 'explicit-cross-platform')
  }
  assert.equal(result.windows.nodeRuntime.ownership, 'external')
  assert.equal(result.windows.nodeRuntime.installed, false)
})

test('Preview Node is rejected before desktop import files or ownership are created', async t => {
  const f = await fixture(t), manifest = await readFile(join(f.npmRoot, 'package.json'))
  await assert.rejects(prepareDesktopPackage({ ...f.options,
    nodeExecutable: 'C:\\Users\\me\\AppData\\Local\\YuGoo\\QwenWorkPreview\\tools\\node.exe' }), /Preview/)
  await assert.rejects(readFile(join(f.destination, '.preparation-owner.json')), { code: 'ENOENT' })
  assert.deepEqual(await readFile(join(f.npmRoot, 'package.json')), manifest)
})

test('exact npm prerelease preparation and update retain prior runtime without accepting unresolved tags', async t => {
  const f = await fixture(t, '0.1.0-beta.1'), first = await prepareDesktopPackage(f.options)
  assert.equal(first.package.version, '0.1.0-beta.1')
  await assert.rejects(prepareDesktopPackage({ ...f.options, packageVersion: 'beta', destination: join(f.root, 'unresolved-tag') }))
  await assert.rejects(prepareDesktopPackage({ ...f.options, suiteVersion: '0.3.22-beta.1', destination: join(f.root, 'unsupported-native-version') }))
  const newer = join(f.root, 'beta next'); await cp(f.npmRoot, newer, { recursive: true })
  const manifest = await json(join(newer, 'package.json')); manifest.version = '0.1.0-beta.2'; await writeFile(join(newer, 'package.json'), JSON.stringify(manifest))
  const next = await prepareDesktopPackage({ ...f.options, npmRoot: newer, packageVersion: manifest.version, suiteVersion: '0.3.23', npmRootWindows: 'D:\\Yugoo\\npm-beta2', previousReceiptFile: first.receiptFile })
  assert.equal(next.package.version, '0.1.0-beta.2'); assert.equal(next.priorReceiptSha256, first.receiptSha256)
  assert.equal((await json(join(f.npmRoot, 'package.json'))).version, '0.1.0-beta.1')
})

test('owned WorkBuddy update keeps one stable market and old runtime/suite while issuing a new version receipt', async t => {
  const f = await fixture(t), first = await prepareDesktopPackage(f.options), oldManifest = await readFile(join(f.npmRoot, 'package.json'))
  const newer = join(f.root, 'npm new version'); await cp(f.npmRoot, newer, { recursive: true }); const manifest = await json(join(newer, 'package.json')); manifest.version = '1.2.4'; await writeFile(join(newer, 'package.json'), JSON.stringify(manifest))
  const foreignReceipts = f.destination + '-sibling'; await mkdir(foreignReceipts)
  const foreignReceipt = join(foreignReceipts, 'preparation.json'); await cp(first.receiptFile, foreignReceipt)
  await assert.rejects(prepareDesktopPackage({ ...f.options, npmRoot: newer, packageVersion: '1.2.4', suiteVersion: '0.3.23', previousReceiptFile: foreignReceipt }), /receipt is outside/)
  const next = await prepareDesktopPackage({ ...f.options, npmRoot: newer, npmRootWindows: 'D:\\Yugoo\\npm-v124', packageVersion: '1.2.4', suiteVersion: '0.3.23', previousReceiptFile: first.receiptFile })
  assert.equal(next.nativeImport.market, first.nativeImport.market); assert.equal(next.priorReceiptSha256, first.receiptSha256)
  assert.equal(next.nativeImport.marketName, first.nativeImport.marketName)
  const market = await json(join(next.nativeImport.market, '.codebuddy-plugin/marketplace.json')); assert.equal(market.plugins.length, 1); assert.equal(market.plugins[0].version, '0.3.23')
  assert.equal((await json(join(next.nativeImport.market, market.plugins[0].source, '.mcp.json'))).mcpServers['design-system-workbuddy-probe'].args[0], 'D:\\Yugoo\\npm-v124\\payload\\shared\\scripts\\design.mjs')
  assert.ok(await readFile(join(first.nativeImport.market, first.nativeImport.pluginSource, 'skills/yugoo/SKILL.md')))
  assert.deepEqual(await readFile(join(f.npmRoot, 'package.json')), oldManifest)
  await assert.rejects(prepareDesktopPackage({ ...f.options, previousReceiptFile: first.receiptFile }), /artifacts changed/)
  await assert.rejects(prepareDesktopPackage({ ...f.options, npmRoot: newer, packageVersion: '1.2.4', previousReceiptFile: next.receiptFile }), /new stable npm directory/)
  const relocation = join(f.root, 'same-version relocated'); await cp(newer, relocation, { recursive: true })
  await assert.rejects(prepareDesktopPackage({ ...f.options, npmRoot: relocation, packageVersion: '1.2.4', previousReceiptFile: next.receiptFile }), /new exact package version/)
})

test('updating an owned legacy preparation preserves its original market identity', async t => {
  const legacy = await fixture(t, '0.1.0-beta.9', { legacyMarket: true }), first = await prepareDesktopPackage(legacy.options)
  assert.equal(first.nativeImport.marketName, 'yugoo-workbuddy-test')
  const current = await fixture(t, '0.1.0-beta.10')
  const next = await prepareDesktopPackage({ ...legacy.options, npmRoot: current.npmRoot, packageVersion: '0.1.0-beta.10', suiteVersion: '0.3.23', npmRootWindows: 'D:\\Yugoo\\npm-beta10', previousReceiptFile: first.receiptFile })
  assert.equal(next.nativeImport.market, first.nativeImport.market)
  assert.equal(next.nativeImport.marketName, 'yugoo-workbuddy-test')
  assert.equal(next.priorReceiptSha256, first.receiptSha256)
  const market = await json(join(next.nativeImport.market, '.codebuddy-plugin/marketplace.json'))
  assert.equal(market.name, 'yugoo-workbuddy-test'); assert.equal(market.plugins[0].version, '0.3.23')
  const guide = await readFile(join(next.nativeImport.market, next.nativeImport.pluginSource, 'README.md'), 'utf8')
  assert.match(guide, /uses the yugoo-workbuddy-test market/)
  assert.ok(await readFile(join(first.nativeImport.market, first.nativeImport.pluginSource, '.codebuddy-plugin/plugin.json')))
})

test('QwenWork ZIP is independently readable, thin, pinned externally and supports separate organization connector', async t => {
  const f = await fixture(t), pins = { nodeExecutable: f.options.nodeExecutable, executable: 'C:\\Qwen\\QwenWorkCN.exe', worker: 'C:\\Qwen\\worker.mjs', executableSha256: hash('host'), workerSha256: hash('worker') }
  const result = await prepareDesktopPackage({ ...f.options, target: 'qwenwork', suiteVersion: '0.2.1', destinationWindows: 'D:\\Yugoo\\prepared with spaces', qwenworkRuntime: pins, includeMcp: false })
  const native = result.nativeImport, location = await json(join(native.suite, 'scripts/runtime-location.json'))
  assert.equal(location.runtimeRoot, 'D:\\Yugoo\\npm-v123\\payload\\shared'); assert.ok(location.runtimeBootstrap.endsWith('runtime-bootstrap.mjs'))
  assert.ok(location.runtimeBootstrap.startsWith('file:///D:/'), 'Windows Node --import requires a file URL, not a drive-letter module specifier')
  assert.ok(location.runtimeBootstrap.includes('prepared%20with%20spaces/'), 'Standard URL conversion must encode spaces for Windows Node --import')
  await assert.rejects(readFile(join(native.suite, '.mcp.json')), { code: 'ENOENT' }); await assert.rejects(readFile(join(f.runtime, 'scripts/qwenwork-runtime.json')), { code: 'ENOENT' })
  const connector = await json(native.connector); assert.deepEqual(connector.mcpServers['design-system'].args.slice(0, 2), ['--import', location.runtimeBootstrap])
  const checked = spawnSync('python3', ['-c', 'import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))', native.archive], { encoding: 'utf8' })
  assert.equal(checked.status, 0, checked.stderr); const members = JSON.parse(checked.stdout)
  assert.ok(members.includes('skills/yugoo/native-execution.md')); assert.ok(members.includes('.claude-plugin/plugin.json')); assert.ok(!members.some(p => /node_modules|web\/|kits\//.test(p)))
  assert.ok(members.includes('skills/design-component/SKILL.md'))
  assert.equal((await json(join(native.suite, '.claude-plugin/plugin.json'))).version, '0.2.1')
  assert.ok((await readFile(join(native.suite, 'skills/yugoo/SKILL.md'), 'utf8')).includes('--import RUNTIME_BOOTSTRAP'))
  assert.equal((await json(join(native.suite, 'hooks/hooks.json'))).hooks.FileChanged[0].hooks[0].asyncRewake, true)
})

test('preparation rejects wrong identity/version/resources, profiles, existing outputs and symlinks before native effects', async t => {
  const f = await fixture(t)
  await assert.rejects(prepareDesktopPackage({ ...f.options, destination: f.root }), /outside npm package/)
  await assert.rejects(prepareDesktopPackage({ ...f.options, destination: join(f.npmRoot, 'inside') }), /outside npm package/)
  for (const override of [{ packageVersion: 'latest' }, { packageVersion: '1.2.4' }, { packageName: '@foreign/pkg' }, { packageName: 'foreign-package' }, { packageName: '../yugoo-design' }, { packageName: 'yugoo-design@0.1.0' }, { suiteVersion: '../overwrite' }, { target: 'codex' }, { destination: join(f.root, '.workbuddy/plugins') }]) await assert.rejects(prepareDesktopPackage({ ...f.options, ...override }))
  await mkdir(f.destination); await writeFile(join(f.destination, 'foreign.txt'), 'preserved'); await assert.rejects(prepareDesktopPackage(f.options), { code: 'EEXIST' }); assert.equal(await readFile(join(f.destination, 'foreign.txt'), 'utf8'), 'preserved')
  const alias = join(f.root, 'symlink'); await symlink(f.npmRoot, alias); await assert.rejects(prepareDesktopPackage({ ...f.options, npmRoot: alias }), /symlink/)
  await writeFile(join(f.npmRoot, 'payload/desktop-preparation/workbuddy-package.mjs'), 'changed')
  await assert.rejects(prepareDesktopPackage({ ...f.options, destination: join(f.root, 'fresh') }), /bytes changed/)
})

test('old preparation receipt cannot adopt a modified runtime or silently cover native config extras', async t => {
  const f = await fixture(t), first = await prepareDesktopPackage(f.options)
  const newer = join(f.root, 'new npm'); await cp(f.npmRoot, newer, { recursive: true }); const manifest = await json(join(newer, 'package.json')); manifest.version = '1.2.4'; await writeFile(join(newer, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(f.runtime, 'scripts/design.mjs'), 'replaced old runtime')
  await assert.rejects(prepareDesktopPackage({ ...f.options, npmRoot: newer, packageVersion: '1.2.4', suiteVersion: '0.3.23', previousReceiptFile: first.receiptFile }), /Previous acquired runtime changed/)
  const pins = { nodeExecutable: f.options.nodeExecutable, executable: 'C:\\Qwen\\app.exe', worker: 'C:\\Qwen\\worker.mjs', executableSha256: hash('host'), workerSha256: hash('worker'), token: 'must-not-be-copied' }
  await assert.rejects(prepareDesktopPackage({ ...f.options, target: 'qwenwork', qwenworkRuntime: pins, destination: join(f.root, 'separate') }), /Only native path and byte pins/)
  await assert.rejects(readFile(join(f.root, 'separate', '.preparation-owner.json')), { code: 'ENOENT' })
})

test('external Qwen configuration is an explicit locator, never native process admission', async () => {
  const pins = { executable: 'C:\\Qwen\\app.exe', worker: 'C:\\Qwen\\worker.mjs', executableSha256: hash('fixed'), workerSha256: hash('fixed') }
  let path
  assert.deepEqual(await readQwenWorkRuntimePins({ platform: 'win32', environment: {}, read: async p => { path = p; return JSON.stringify(pins) } }), pins); assert.ok(path instanceof URL)
  assert.deepEqual(await readQwenWorkRuntimePins({ platform: 'win32', environment: { YUGOO_QWENWORK_RUNTIME_CONFIG: 'D:\\owned\\pins.json' }, read: async p => { path = p; return JSON.stringify(pins) } }), pins); assert.equal(path, 'D:\\owned\\pins.json')
  await assert.rejects(readQwenWorkRuntimePins({ platform: 'win32', environment: { YUGOO_QWENWORK_RUNTIME_CONFIG: 'relative.json' } }), /absolute/)
  await assert.rejects(readQwenWorkRuntimePins({ platform: 'linux' }), /Windows/)
  await assert.rejects(readQwenWorkRuntimePins({ platform: 'win32', environment: {}, read: async () => { const e = Error('missing'); e.code = 'ENOENT'; throw e } }), { code: 'ENOENT' })
  await assert.rejects(readQwenWorkRuntimePins({ platform: 'win32', environment: {}, read: async () => 'invalid json' }), SyntaxError)
  const native = { executable: pins.executable, commandLine: '"C:\\Qwen\\app.exe"', procStart: '1', parent: 1 }
  const options = { snapshot: async () => native, canonical: async p => p, bytes: async () => Buffer.from('changed') }
  await assert.rejects(inspectQwenWorkProcess(42, pins, options), /bytes changed/)
  assert.equal((await inspectQwenWorkProcess(42, pins, { ...options, snapshot: async () => ({ ...native, executable: 'C:\\foreign.exe' }) })).supported, false)
})

test('owning preparation CLI requires exact inputs without extending native install enum', async t => {
  const help = await installerMain(['prepare-desktop', '--help'], { npmRoot: '/nonexistent-help-package' }); assert.equal(help.status, 'not-applicable'); assert.ok(help.options['--previous-receipt'])
  const f = await fixture(t), result = await installerMain(['prepare-desktop', '--target', 'workbuddy', '--package-name', f.options.packageName, '--package-version', f.options.packageVersion,
    '--suite-version', f.options.suiteVersion, '--destination', f.destination, '--node-executable', f.options.nodeExecutable, '--npm-root-windows', f.options.npmRootWindows, '--destination-windows', f.options.destinationWindows], { npmRoot: f.npmRoot })
  assert.equal(result.status, 'prepared'); assert.equal(result.nativeRegistered, false)
  await assert.rejects(installerMain(['prepare-desktop', '--target', 'workbuddy', '--host', 'codex'], { npmRoot: f.npmRoot }), /Unknown option/)
  await assert.rejects(installerMain(['prepare-desktop', '--target', 'workbuddy', '--market-name', 'foreign-market'], { npmRoot: f.npmRoot }), /Unknown option/)
})
