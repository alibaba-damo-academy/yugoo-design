import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentInstallation, AGENT_INSTALL_HOSTS, installationResult } from '../src/npm-agent-installation.mjs'
import { installerMain } from '../src/npm-installer.mjs'
import { stageDesktopPreparationMaterials } from '../npm-desktop-materials.mjs'

const identity = { name: '@test-yugoo/companion', version: '0.1.0-beta.2' }
function noOperation() { assert.fail('No package/profile/native operation is allowed') }
function nativeHarness(replies) {
  const calls = []
  return { calls, invoke: async args => { calls.push(args); assert.ok(replies.length, 'Unexpected native operation'); return replies.shift() } }
}
const valueOf = (args, key) => args[args.indexOf('--' + key) + 1]

test('missing conversation identity asks one host choice without inspecting a package, PATH or profiles', async t => {
  const root = await mkdtemp(join(tmpdir(), 'agent-host-choice-')); t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'codex'), 'installed CLI is not current-host identity')
  await writeFile(join(root, 'qodercli'), 'another installed CLI')
  const result = await installerMain(['install'], { npmRoot: join(root, 'absent package'), userRoot: join(root, 'absent profile'), qoderInstaller: noOperation, claudeAdapterFactory: noOperation, dshAdapterFactory: noOperation })
  assert.equal(result.status, 'host-selection-required'); assert.deepEqual(result.hosts, AGENT_INSTALL_HOSTS)
  assert.equal(result.host, null); assert.equal(result.usable, false); assert.equal(result.hostRegistered, false)
  assert.equal((await readdir(root)).length, 2)
  const explicit = await agentInstallation({ host: 'qoder', 'receipt-dir': '/external/receipts' }, { invoke: async args => {
    assert.equal(valueOf(args, 'host'), 'qoder'); return { hostRegistered: true, package: identity }
  } })
  assert.equal(explicit.host, 'qoder'); assert.equal(explicit.installation.usability, 'unverified')
})

test('supported hosts report only their missing prerequisites, without an automatic package or native operation', async () => {
  for (const host of AGENT_INSTALL_HOSTS) {
    const result = await agentInstallation({ host }, { npmRoot: '/not-read', invoke: noOperation, desktopPrepare: noOperation, platform: 'win32' })
    assert.equal(result.status, 'inputs-required'); assert.equal(result.hostRegistered, false)
    assert.ok(result.missing.length); assert.equal(result.usable, false)
    assert.equal(result.installation.registration, 'not-performed')
    assert.equal(result.missing.includes('qwenwork-runtime'), host === 'qwenwork')
  }
  const desktop = await installerMain(['install', '--host', 'codex-desktop'], { npmRoot: '/not-read' })
  assert.equal(desktop.status, 'inputs-required'); assert.equal(desktop.usable, false)
  assert.deepEqual(desktop.missing, ['receipt-dir', 'destination'])
  await assert.rejects(installerMain(['install', '--host', 'made-up-host'], { npmRoot: '/not-read' }), /supported host/)
})

test('native Windows desktop discovery does not request a separate Node for each adapter', async () => {
  const native = await agentInstallation({ host: 'workbuddy' }, { platform: 'win32', invoke: noOperation, desktopPrepare: noOperation })
  assert.ok(!native.missing.includes('node-executable'))
  const cross = await agentInstallation({ host: 'workbuddy' }, { platform: 'linux', invoke: noOperation, desktopPrepare: noOperation })
  assert.ok(cross.missing.includes('node-executable'))
  assert.ok(cross.missing.includes('npm-root-windows'))
  assert.ok(cross.missing.includes('destination-windows'))
})

test('cross-host flags and unknown versions are not silently ignored', async () => {
  for (const [host, extras] of [['qoder', { 'codex-executable': '/codex' }], ['codex', { profile: 'other' }],
    ['dsh', { 'disable-embedding': true }], ['claude-code', { destination: '/elsewhere' }]])
    await assert.rejects(agentInstallation({ host, ...extras }, { invoke: noOperation }), /accepts only/)
  for (const key of ['qwenwork-runtime', 'separate-mcp'])
    await assert.rejects(agentInstallation({ host: 'workbuddy', [key]: key === 'separate-mcp' ? true : '/pins' }, { invoke: noOperation }), /does not accept/)
  await assert.rejects(installerMain(['install', '--host', 'workbuddy', '--package-version', 'latest'], { npmRoot: '/not-read' }), /Unknown option/)
  await assert.rejects(installerMain(['install', '--host', 'codex', '--dry-run', '--destination', '/elsewhere'], { npmRoot: '/not-read' }), /only valid for direct desktop/)
})

test('Codex direct install retains owning plan and runtime receipt before one native apply', async () => {
  const h = nativeHarness([{ planFile: '/receipts/exact.plan.json', applySupported: true, package: identity },
    { status: 'disabled', receiptFile: '/receipts/runtime.json' }, { phase: 'verified', hostRegistered: true, receiptPath: '/receipts/native.json' }])
  const result = await agentInstallation({ host: 'codex', 'receipt-dir': '/receipts', 'codex-executable': '/native/codex', 'disable-embedding': true, 'node-executable': '/public-node/bin/node' }, h)
  assert.equal(h.calls.length, 3); assert.ok(h.calls[0].includes('--dry-run'))
  assert.equal(h.calls[1][0], 'check-runtime'); assert.ok(h.calls[1].includes('--disable-embedding'))
  assert.equal(valueOf(h.calls[1], 'plan'), '/receipts/exact.plan.json', 'check the same selected Node retained by the plan')
  assert.ok(h.calls[2].includes('--apply')); assert.equal(valueOf(h.calls[2], 'plan'), '/receipts/exact.plan.json')
  assert.equal(valueOf(h.calls[2], 'runtime-receipt'), '/receipts/runtime.json')
  assert.ok(!h.calls[2].includes('--disable-embedding'))
  assert.equal(valueOf(h.calls[0], 'node-executable'), '/public-node/bin/node')
  assert.ok(!h.calls[2].includes('--node-executable'), 'apply consumes the saved selection without reselecting Node')
  assert.equal(result.installation.registration, 'verified'); assert.equal(result.installation.acquisition, 'available')
  assert.equal(result.installation.registryAcquisitionVerified, false)
  assert.equal(result.installation.activation, 'required'); assert.equal(result.installation.usability, 'unverified'); assert.equal(result.usable, false)
})

test('failed runtime or unadmitted native adapter never falls back or invokes apply', async () => {
  const h = nativeHarness([{ planFile: '/receipts/plan', applySupported: true }, { status: 'missing', receiptFile: '/receipts/runtime' }])
  const result = await agentInstallation({ host: 'codex', 'receipt-dir': '/receipts', 'codex-executable': '/native/codex' }, h)
  assert.equal(result.status, 'runtime-not-ready'); assert.equal(h.calls.length, 2)
  assert.equal(result.runtimeReceipt.receiptFile, '/receipts/runtime'); assert.equal(result.usable, false)
  const unadmitted = nativeHarness([{ planFile: '/receipts/plan', applySupported: false }])
  await assert.rejects(agentInstallation({ host: 'codex', 'receipt-dir': '/receipts', 'codex-executable': '/native/codex' }, unadmitted), /not admitted/)
  assert.equal(unadmitted.calls.length, 1)
})

test('DSH direct install reuses exact mapping and saved plan with exclusive per-operation receipts', async () => {
  const h = nativeHarness([{ planFile: '/receipts/one/plan', package: identity },
    { status: 'registered-config-parsed', readback: { bundleRegistered: true }, receiptFile: '/receipts/one/result' }])
  const result = await agentInstallation({ host: 'dsh', profile: 'existing', 'dsh-config': '/pinned/config.json', 'receipt-dir': '/receipts' }, h)
  assert.equal(h.calls.length, 2); assert.ok(h.calls[0].includes('--dry-run')); assert.ok(h.calls[1].includes('--apply'))
  assert.equal(valueOf(h.calls[0], 'receipt-dir'), valueOf(h.calls[1], 'receipt-dir'))
  assert.equal(dirname(valueOf(h.calls[0], 'receipt-dir')), '/receipts')
  assert.equal(valueOf(h.calls[1], 'plan'), '/receipts/one/plan'); assert.equal(valueOf(h.calls[1], 'profile'), 'existing')
  assert.ok(!h.calls.some(args => args.includes('--runtime-receipt') || args[0] === 'check-runtime'))
  assert.equal(result.installation.registration, 'verified'); assert.equal(result.usable, false)
})

test('DSH partial failure preserves the original receipt and does not roll back or retry', async () => {
  const h = nativeHarness([{ planFile: '/receipts/plan', package: identity },
    { status: 'failed-partial-state-retained', partialStateRetained: true, rollbackAttempted: false, receiptFile: '/receipts/failure' }])
  const result = await agentInstallation({ host: 'dsh', profile: 'existing', 'dsh-config': '/pins', 'receipt-dir': '/receipts' }, h)
  assert.equal(h.calls.length, 2); assert.equal(result.receiptFile, '/receipts/failure')
  assert.equal(result.installation.registration, 'failed-partial-state-retained'); assert.equal(result.usable, false)
  assert.equal(result.installation.nextActions[0].path, '/receipts/failure'); assert.equal(result.rollbackAttempted, false)
})

test('DSH owned update forwards one previous receipt to the exact owning dry-run and apply', async () => {
  const h = nativeHarness([{ planFile: '/receipts/update/plan', package: identity },
    { status: 'registered-config-parsed', readback: { bundleRegistered: true }, receiptFile: '/receipts/update/result' }])
  await agentInstallation({ host: 'dsh', profile: 'existing', 'dsh-config': '/pins',
    'receipt-dir': '/receipts', 'previous-receipt': '/receipts/A/result' }, h)
  assert.equal(h.calls.length, 2)
  for (const args of h.calls) assert.equal(valueOf(args, 'previous-receipt'), '/receipts/A/result')
  assert.equal(valueOf(h.calls[1], 'plan'), '/receipts/update/plan')
})

test('Claude and Qoder keep their owning direct registration and session activation boundaries', async () => {
  for (const host of ['claude-code', 'qoder']) {
    const h = nativeHarness([{ hostRegistered: true, package: identity, status: 'registered' }])
    const result = await agentInstallation({ host, 'receipt-dir': '/receipts', ...(host === 'claude-code' ? { 'claude-executable': '/claude' } : {}) }, h)
    assert.equal(h.calls.length, 1); assert.ok(!h.calls[0].includes('--plugin-dir'))
    assert.equal(result.installation.registration, 'verified'); assert.equal(result.installation.activation, 'required')
    assert.equal(result.installation.nextActions[0].action, 'activate-native-session'); assert.equal(result.usable, false)
  }
  const prepared = installationResult('qoder', { status: 'prepared', package: identity })
  assert.equal(prepared.installation.registration, 'not-performed'); assert.equal(prepared.usable, false)
  for (const host of ['qwenwork', 'workbuddy']) {
    const misleading = installationResult(host, { status: 'prepared', package: identity, hostRegistered: true, registryAcquisitionVerified: true })
    assert.equal(misleading.installation.registration, 'not-performed')
    assert.equal(misleading.installation.registryAcquisitionVerified, false); assert.equal(misleading.usable, false)
  }
})

test('thrown native errors retain owned recovery references without replaying an uncertain action', async () => {
  const failure = Object.assign(Error('native uncertain failure'), { receiptFile: '/receipts/owned.claude.json' })
  let calls = 0
  await assert.rejects(agentInstallation({ host: 'claude-code', 'claude-executable': '/claude', 'receipt-dir': '/receipts' }, { invoke: async () => { calls++; throw failure } }), error => {
    assert.equal(error, failure); assert.equal(error.installation.receiptFile, failure.receiptFile)
    assert.equal(error.installation.registration, 'failed-or-unconfirmed'); assert.equal(error.installation.usability, 'unverified')
    assert.match(error.installation.nextActions[0].message, /existing recover/); return true
  })
  assert.equal(calls, 1)
})

async function desktopFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agent-desktop-entry-')); t.after(() => rm(root, { recursive: true, force: true }))
  const npmRoot = join(root, 'npm package'), runtime = join(npmRoot, 'payload/shared')
  for (const dir of ['scripts', 'knowledge', 'kits/web_app']) await mkdir(join(runtime, dir), { recursive: true })
  await writeFile(join(npmRoot, 'package.json'), JSON.stringify({ ...identity, type: 'module', 'x-design-release-review': { fixture: false } }))
  for (const file of ['scripts/design.mjs', 'scripts/workbuddy-panel-service.mjs']) await writeFile(join(runtime, file), '// isolated material fixture, no host/model\n')
  await writeFile(join(runtime, 'knowledge/runtime-manifest.json'), '{}'); await writeFile(join(runtime, 'kits/web_app/kit.yaml'), 'name: web_app\n')
  await stageDesktopPreparationMaterials(join(npmRoot, 'payload/desktop-preparation'))
  const destination = join(root, 'prepared'), args = ['install', '--host', 'workbuddy', '--destination', destination,
    '--node-executable', "C:\\Tools\\Jeff's node\\node.exe", '--suite-version', '0.3.22', '--npm-root-windows', 'D:\\Yugoo\\beta2', '--destination-windows', 'D:\\Yugoo\\prepared']
  return { root, npmRoot, runtime, destination, args }
}

test('unified WorkBuddy entry prepares actual import materials, repeats read-only, and updates one stable market', async t => {
  const f = await desktopFixture(t), first = await installerMain(f.args, { npmRoot: f.npmRoot })
  assert.equal(first.status, 'prepared'); assert.equal(first.nativeRegistered, false); assert.equal(first.loadedVersionVerified, false)
  assert.equal(first.installation.registration, 'not-performed'); assert.equal(first.installation.activation, 'required'); assert.equal(first.usable, false)
  assert.equal(first.installation.nextActions[0].path, first.nativeImport.market)
  const repeatArgs = [...f.args, '--previous-receipt', first.receiptFile]
  const repeat = await installerMain(repeatArgs, { npmRoot: f.npmRoot })
  assert.equal(repeat.idempotent, true); assert.equal(repeat.receiptSha256, first.receiptSha256)
  assert.deepEqual(await readdir(join(f.destination, 'receipts')), [first.receiptSha256 + '.preparation.json'])
  await assert.rejects(readFile(join(f.destination, '.preparation.lock')), { code: 'ENOENT' })
  const receiptBeforeBusy = await readFile(first.receiptFile), lock = join(f.destination, '.preparation.lock')
  for (const marker of ['other-active-preparation', 'interrupted-preparation-retained']) {
    await writeFile(lock, marker, { flag: 'wx' })
    await assert.rejects(installerMain(repeatArgs, { npmRoot: f.npmRoot }), { code: 'EEXIST' })
    assert.equal(await readFile(lock, 'utf8'), marker)
    assert.deepEqual(await readFile(first.receiptFile), receiptBeforeBusy)
    await rm(lock) // Remove only this test's own marker after its preservation assertion.
  }
  await assert.rejects(installerMain(repeatArgs.map(arg => arg === '0.3.22' ? '0.3.23' : arg), { npmRoot: f.npmRoot }), /cannot change the native suite/)
  const newer = join(f.root, 'npm beta3'); await cp(f.npmRoot, newer, { recursive: true })
  const manifest = JSON.parse(await readFile(join(newer, 'package.json'))); manifest.version = '0.1.0-beta.3'; await writeFile(join(newer, 'package.json'), JSON.stringify(manifest))
  const next = await installerMain(repeatArgs.map(arg => arg === '0.3.22' ? '0.3.23' : arg === 'D:\\Yugoo\\beta2' ? 'D:\\Yugoo\\beta3' : arg), { npmRoot: newer })
  assert.equal(next.package.version, '0.1.0-beta.3'); assert.equal(next.nativeImport.market, first.nativeImport.market)
  assert.equal(next.nativeRegistered, false); assert.equal(next.usable, false)
  const receiptBefore = await readFile(first.receiptFile); await writeFile(join(next.nativeImport.market, '.codebuddy-plugin/marketplace.json'), '{}')
  await assert.rejects(installerMain([...f.args, '--previous-receipt', first.receiptFile], { npmRoot: f.npmRoot }), /artifacts changed/)
  assert.deepEqual(await readFile(first.receiptFile), receiptBefore)
})

test('unified QwenWork entry includes one MCP connector or an explicit organization-policy alternative', async t => {
  const f = await desktopFixture(t), config = join(f.root, 'native pins.json')
  const pins = { executable: 'C:\\Apps\\QwenWorkCN.exe', executableSha256: 'a'.repeat(64), worker: 'C:\\Apps\\worker.js', workerSha256: 'b'.repeat(64), nodeExecutable: "C:\\Tools\\Jeff's node\\node.exe" }
  await writeFile(config, JSON.stringify(pins))
  const args = f.args.map(arg => arg === 'workbuddy' ? 'qwenwork' : arg)
  args.push('--qwenwork-runtime', config)
  const result = await installerMain(args, { npmRoot: f.npmRoot })
  assert.equal(result.nativeImport.includeMcp, true); assert.ok(result.nativeImport.archive.endsWith('.zip'))
  const bundled = JSON.parse(await readFile(join(result.nativeImport.suite, '.mcp.json')))
  assert.deepEqual(bundled, JSON.parse(await readFile(result.nativeImport.connector)))
  assert.equal(result.installation.registration, 'not-performed'); assert.equal(result.usable, false)
  const repeat = await installerMain([...args, '--previous-receipt', result.receiptFile], { npmRoot: f.npmRoot })
  assert.equal(repeat.idempotent, true)
  await assert.rejects(installerMain([...args, '--previous-receipt', result.receiptFile, '--separate-mcp'], { npmRoot: f.npmRoot }), /connector policy changed/)
  const other = args.map(arg => arg === f.destination ? join(f.root, 'organization preparation') : arg === 'D:\\Yugoo\\prepared' ? 'D:\\Yugoo\\organization' : arg)
  const separate = await installerMain([...other, '--separate-mcp'], { npmRoot: f.npmRoot })
  assert.equal(separate.nativeImport.includeMcp, false)
  await assert.rejects(readFile(join(separate.nativeImport.suite, '.mcp.json')), { code: 'ENOENT' })
  assert.ok(separate.nativeImport.connector); assert.equal(separate.usable, false)
})
