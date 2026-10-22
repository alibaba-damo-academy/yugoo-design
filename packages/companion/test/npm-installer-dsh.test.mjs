import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { installerMain, validateReleaseHosts } from '../src/npm-installer.mjs'
import { createDshInstallerAdapter, planDshInstallation, applyDshInstallation, inspectDshInstallation,
  executeDshInstall, DSH_INSTALL_MAX_OUTPUT_BYTES, validateReleaseHosts as validateDshReleaseHosts } from '../src/npm-installer-dsh.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => JSON.stringify(value, null, 2) + '\n'
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => sha(JSON.stringify(canonical(value)))
// Simulates only the public Loader contract. No official host/CLI is executed.
const loaderSource = `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export const resolveProfileDir = (name, home) => join(home, 'profiles', name);
export const readProfileManifest = (bin, dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
export function resolveBundleDir(bin, name, anchor, profile) {
  const dir = join(profile, 'node_modules', name);
  try { readProfileManifest(bin, dir); return dir; }
  catch (error) { if (error.code !== 'ENOENT') throw error;
    throw new Error(bin + ': cannot resolve profile bundle ' + JSON.stringify(name) + ' from the dsh installation or ' + profile); }
}
export const loadOverlayPatches = (bin, path) => JSON.parse(readFileSync(path, 'utf8'));
export const bundlePatchPaths = (dir, bundle) => (typeof bundle.patch === 'string' ? [bundle.patch] : bundle.patch).map(path => join(dir, path));
export const composeEntries = (layers, warn) => {
  const patches = layers.flat();
  assert.ok(patches.every(patch => patch && typeof patch === 'object' && !Array.isArray(patch)), 'PatchOptions[][] required, not profile-layer objects or nested lists');
  if (patches.some(patch => patch.id === 'missing-target')) warn('Patch target was skipped');
  return patches;
};
`
async function fixture(t, { loader = loaderSource, desktop = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-adapter-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, 'home with spaces'), profile = desktop ? 'desktop' : 'chosen'
  const profileDir = join(home, 'profiles', profile)
  const hostDir = desktop ? join(root, '@deepseek-ai/dsh') : join(root, 'official host')
  const bootDir = desktop ? join(root, '@deepseek-ai/dsh-app-boot') : join(root, 'loader'), calls = []
  const desktopDir = join(root, '@deepseek-ai/dsh-desktop-host')
  async function put(path, value) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value) }
  const manifestPath = join(profileDir, 'package.json')
  const manifest = { name: 'user-profile', dependencies: { '@foreign/tool': '2.0.0' },
    dsh: { profile: { bundles: ['@foreign/tool'], patchReload: 'startup' }, custom: 'keep' },
    models: { provider: 'keep-private' }, search: { provider: 'keep' }, arbitrary: { nested: true } }
  await put(manifestPath, json(manifest))
  await put(join(profileDir, 'cordis.patch.yml'), json([{ id: 'user', config: { model: 'keep' } }]))
  await put(join(home, 'cordis.patch.yml'), json([{ id: 'home', config: { search: 'keep' } }]))
  await put(join(profileDir, '.npmrc'), 'registry=https://old.example/\n')
  await put(join(profileDir, 'pnpm-workspace.yaml'), 'allowBuilds: {}\n')
  await put(join(profileDir, 'node_modules/@foreign/tool/package.json'), json({ name: '@foreign/tool', version: '2.0.0', dsh: { bundle: { patch: './patch.json' } } }))
  await put(join(profileDir, 'node_modules/@foreign/tool/patch.json'), json([{ id: 'foreign' }]))
  const paths = { node: desktop ? process.execPath : join(root, 'node'),
    cli: desktop ? join(desktopDir, 'lib/cli.js') : join(hostDir, 'bin.mjs'), hostManifest: join(hostDir, 'package.json'),
    loader: join(bootDir, 'index.mjs'), loaderManifest: join(bootDir, 'package.json') }
  if (!desktop) await put(paths.node, 'fake executable: must never launch\n')
  else {
    paths.desktopHostManifest = join(desktopDir, 'package.json')
    await put(paths.desktopHostManifest, json({ name: '@deepseek-ai/dsh-desktop-host', version: '0.1.2-rc.1' }))
    const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'electron')
    // Synthetic adapter contract only; this does not execute or validate an Electron host.
    Object.defineProperty(process.versions, 'electron', { value: 'synthetic-test', configurable: true })
    t.after(() => { if (descriptor) Object.defineProperty(process.versions, 'electron', descriptor)
      else delete process.versions.electron })
  }
  await put(paths.cli, 'throw new Error("must not execute")\n')
  await put(paths.hostManifest, json({ name: '@deepseek-ai/dsh', version: '0.1.2-rc.1', bin: { dsh: './bin.mjs' } }))
  await put(paths.loaderManifest, json({ name: '@deepseek-ai/dsh-app-boot', version: '0.1.2-rc.1', main: './index.mjs' }))
  await put(paths.loader, loader)
  const pins = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, { path, sha256: sha(await readFile(path)) }])))
  async function install(version = '1.2.3') {
    const current = JSON.parse(await readFile(manifestPath, 'utf8'))
    current.dependencies['@release/design-system-dsh'] = version
    if (!current.dsh.profile.bundles.includes('@release/design-system-dsh')) current.dsh.profile.bundles.push('@release/design-system-dsh')
    await put(manifestPath, json(current))
    const aggregateDir = join(profileDir, 'node_modules/@release/design-system-dsh')
    await put(join(aggregateDir, 'package.json'), json({ name: '@release/design-system-dsh', version, dsh: { bundle: { patch: './patch.json' } } }))
    await put(join(aggregateDir, 'patch.json'), json([{ id: 'design' }]))
  }
  let action = install
  const adapterOptions = { scope: 'isolated-test-contract', dshHome: home, ...pins,
    hostVersion: '0.1.2-rc.1', loaderVersion: '0.1.2-rc.1',
    run: async (command, args, options) => { calls.push({ command, args, options }); await action(); return { exitCode: 0 } } }
  const adapter = await createDshInstallerAdapter(adapterOptions)
  const options = { adapter, profile, aggregateSelector: '@release/design-system-dsh@1.2.3', registry: 'https://registry.npmjs.org/' }
  return { root, home, paths, pins, profileDir, manifestPath, manifest, put, install, calls, adapterOptions, options,
    setAction: value => { action = value } }
}

test('explicit plan is read-only; official argv preserves foreign config; readback is not runtime proof', async t => {
  const f = await fixture(t), before = await readFile(f.manifestPath)
  const plan = await planDshInstallation(f.options)
  assert.equal(f.calls.length, 0); assert.deepEqual(await readFile(f.manifestPath), before)
  assert.deepEqual(plan.args, [f.paths.cli, 'plugin', '--profile', 'chosen', 'add', '--workspace-root', '--save-exact', '@release/design-system-dsh@1.2.3', '--registry', 'https://registry.npmjs.org/'])
  const result = await applyDshInstallation(plan, f.options)
  assert.equal(result.status, 'registered-config-parsed'); assert.equal(result.userConfigurationPreserved, true)
  assert.equal(result.scope, 'isolated-test-contract'); assert.equal(result.runtimeMounted, false)
  assert.equal(result.releaseValidated, false); assert.equal(result.rollbackAttempted, false)
  assert.equal(f.calls[0].options.shell, false); assert.equal(f.calls[0].options.env.DSH_HOME, f.home)
  assert.equal(f.calls[0].options.env.ONNXRUNTIME_NODE_INSTALL_CUDA, 'skip')
  assert.equal(f.calls[0].options.cwd, f.profileDir)
  assert.equal(f.calls[0].options.timeout, 0)
  assert.equal(result.execution.state, 'completed')
  assert.deepEqual(f.calls[0].args, plan.args)
  const readback = await inspectDshInstallation(f.options)
  assert.equal(readback.configurationParsed, true); assert.equal(readback.launcherOverlaysInspected, false)
  const again = await planDshInstallation(f.options)
  assert.equal(again.action, 'already-registered')
  await applyDshInstallation(again, f.options); assert.equal(f.calls.length, 1)
})

test('CPU installation reaches the child despite inherited CUDA choices without changing other environment', async t => {
  const keys = ['ONNXRUNTIME_NODE_INSTALL_CUDA', 'npm_config_onnxruntime_node_install_cuda']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  t.after(() => { for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  } })
  for (const [cuda, desktop] of [['v11', false], ['v12', false], ['true', false], ['v12', true]]) {
    await t.test(`${desktop ? 'Desktop' : 'Web'} inherits ${cuda}`, async child => {
      const f = await fixture(child, { desktop })
      process.env.ONNXRUNTIME_NODE_INSTALL_CUDA = cuda
      process.env.npm_config_onnxruntime_node_install_cuda = 'v11'
      const before = { ...process.env }, expected = { ...before, ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip',
        DSH_HOME: f.home, ...(desktop ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }
      let calls = 0
      const adapter = await createDshInstallerAdapter({ ...f.adapterOptions, run: async (command, args, options) => {
        calls++
        assert.equal(digest(options.env), digest(expected))
        assert.equal(options.env.ONNXRUNTIME_NODE_INSTALL_CUDA, 'skip')
        assert.equal(options.shell, false)
        assert.ok(!args.some(arg => arg.startsWith('--ignore-scripts')))
        const { stdout } = await promisify(execFile)(process.execPath, ['-e', `
          const { createHash } = require('node:crypto');
          const env = Object.fromEntries(Object.keys(process.env).sort().map(key => [key, process.env[key]]));
          process.stdout.write(createHash('sha256').update(JSON.stringify(env)).digest('hex'));
        `], options)
        assert.equal(stdout, digest(expected))
        await f.install()
        return { exitCode: 0 }
      } })
      const options = { ...f.options, adapter }
      const plan = await planDshInstallation(options)
      assert.equal(digest(process.env), digest(before))
      const result = await applyDshInstallation(plan, options)
      assert.equal(result.status, 'registered-config-parsed')
      assert.equal(calls, 1)
      assert.equal(digest(process.env), digest(before))
    })
  }
})

test('missing profiles, ambiguous selectors and credential registries never initialize or execute', async t => {
  const f = await fixture(t)
  for (const override of [{ profile: 'missing' }, { profile: '../escape' }, { aggregateSelector: '@release/design-system-dsh@latest' },
    { aggregateSelector: '@release/design-system-dsh@^1.2.3' }, { registry: 'https://secret@registry.npmjs.org/' }, { registry: 'http://registry.npmjs.org/' }])
    await assert.rejects(planDshInstallation({ ...f.options, ...override }))
  assert.equal(f.calls.length, 0)
  await assert.rejects(readFile(join(f.home, 'profiles/missing/package.json')), { code: 'ENOENT' })
})

test('existing selector and foreign registration conflicts are refused before apply', async t => {
  const f = await fixture(t)
  for (const mutate of [m => { m.dependencies['@release/design-system-dsh'] = '1.2.2' },
    m => { m.dsh.profile.bundles.push('@release/design-system-dsh') },
    m => { m.optionalDependencies = { '@release/design-system-dsh': '1.2.3' } },
    m => { m.dsh.profile.bundles.push('@foreign/tool') }]) {
    const m = structuredClone(f.manifest); mutate(m); await f.put(f.manifestPath, json(m))
    await assert.rejects(planDshInstallation(f.options))
  }
  assert.equal(f.calls.length, 0)
})

test('installed wrong version or bundle patch escape is not registration success', async t => {
  const f = await fixture(t); await f.install()
  const path = join(f.profileDir, 'node_modules/@release/design-system-dsh/package.json')
  const m = JSON.parse(await readFile(path, 'utf8')); m.version = '1.2.2'
  await f.put(path, json(m)); await assert.rejects(planDshInstallation(f.options), /Installed version conflict/)
  m.version = '1.2.3'; m.dsh.bundle.patch = '../escape.json'
  await f.put(path, json(m)); await assert.rejects(planDshInstallation(f.options), /escapes package/)
  assert.equal(f.calls.length, 0)
})

test('profile Bundle string and ordered multiple patch files use the official list shape without writes', async t => {
  const f = await fixture(t); await f.install()
  const dir = join(f.profileDir, 'node_modules/@foreign/tool')
  const path = join(dir, 'package.json'), manifest = JSON.parse(await readFile(path, 'utf8'))
  const files = ['./patch.json', './presets/second.json', './presets/third.json', './presets/fourth.json', './presets/fifth.json']
  manifest.dsh.bundle.patch = files
  await f.put(path, json(manifest))
  for (const [index, file] of files.entries()) await f.put(join(dir, file), json([{ id: 'foreign-' + index }]))
  const before = await readFile(f.manifestPath)
  const expected = files.map((_, index) => ({ id: 'foreign-' + index })).concat([{ id: 'design' },
    { id: 'user', config: { model: 'keep' } }, { id: 'home', config: { search: 'keep' } }])
  const result = await inspectDshInstallation(f.options)
  assert.equal(result.configurationParsed, true)
  assert.equal(result.composedEntriesSha256, sha(JSON.stringify(expected.map(entry => Object.fromEntries(Object.entries(entry).sort())))))
  assert.deepEqual(await readFile(f.manifestPath), before)
  assert.equal(f.calls.length, 0)
  assert.equal(result.runtimeMounted, false)
})

test('invalid Bundle path lists, lexical escapes and symlink escapes never become parsed configuration', async t => {
  const f = await fixture(t); await f.install()
  const dir = join(f.profileDir, 'node_modules/@foreign/tool'), path = join(dir, 'package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  for (const patch of [null, 7, {}, [null], ['./patch.json', 7], [''], ['bad\0path'], [join(f.root, 'outside.json')]]) {
    manifest.dsh.bundle.patch = patch; await f.put(path, json(manifest))
    await assert.rejects(inspectDshInstallation(f.options), /Relative Bundle patch path or list required/)
  }
  manifest.dsh.bundle.patch = ['./patch.json', '../escape.json']; await f.put(path, json(manifest))
  await assert.rejects(inspectDshInstallation(f.options), /escapes package/)
  const outside = join(f.root, 'outside.json'); await f.put(outside, '[]\n')
  await symlink(outside, join(dir, 'escape.json'), 'file')
  manifest.dsh.bundle.patch = ['./patch.json', './escape.json']; await f.put(path, json(manifest))
  await assert.rejects(inspectDshInstallation(f.options), /resolves outside package/)
  await symlink(join(dir, 'patch.json'), join(dir, 'internal-link.json'), 'file')
  manifest.dsh.bundle.patch = ['./internal-link.json']; await f.put(path, json(manifest))
  await assert.rejects(inspectDshInstallation(f.options), /Expected regular file/)
  assert.equal(f.calls.length, 0)
})

test('multi-file Bundle composition warnings remain failed partial state after native exit zero', async t => {
  const f = await fixture(t), dir = join(f.profileDir, 'node_modules/@foreign/tool')
  const path = join(dir, 'package.json'), manifest = JSON.parse(await readFile(path, 'utf8'))
  manifest.dsh.bundle.patch = ['./patch.json', './warning.json']; await f.put(path, json(manifest))
  await f.put(join(dir, 'warning.json'), json([{ id: 'missing-target' }]))
  const result = await applyDshInstallation(await planDshInstallation(f.options), f.options)
  assert.equal(result.execution.exitCode, 0)
  assert.equal(result.status, 'failed-partial-state-retained')
  assert.equal(result.readback, null)
  assert.match(result.readbackError, /Configuration composition reported skipped patches/)
  assert.equal(result.partialStateRetained, true)
  assert.equal(f.calls.length, 1)
})

test('edited plan, changed configuration or drifted official pins cannot execute', async t => {
  const f = await fixture(t), plan = await planDshInstallation(f.options)
  const altered = structuredClone(plan); altered.args.push('--unsafe')
  // Digest comparison must bind the supplied plan itself, not only refreshed state.
  await assert.rejects(applyDshInstallation(altered, f.options), /Plan or profile changed/)
  await f.put(join(f.profileDir, 'cordis.patch.yml'), '[]\n')
  await assert.rejects(applyDshInstallation(plan, f.options), /Plan or profile changed/)
  await f.put(f.paths.cli, 'changed official CLI\n')
  await assert.rejects(planDshInstallation(f.options), /pin changed/)
  assert.equal(f.calls.length, 0)
})

test('CLI failure retains partial installation; no rollback or success is fabricated', async t => {
  const f = await fixture(t)
  f.setAction(async () => { await f.install(); throw Object.assign(new Error('sensitive CLI output not copied'), { code: 7 }) })
  const result = await applyDshInstallation(await planDshInstallation(f.options), f.options)
  assert.equal(result.status, 'failed-partial-state-retained'); assert.equal(result.exitCode, 7)
  assert.equal(result.readback.packageInstalled, true); assert.equal(result.partialStateRetained, true)
  assert.equal(result.rollbackAttempted, false); assert.equal(result.executionError, '7')
  assert.ok(!JSON.stringify(result).includes('sensitive CLI'))
})

test('foreign field or user patch mutation is detected even after CLI exit zero', async t => {
  for (const damage of ['manifest', 'patch']) {
    const f = await fixture(t)
    f.setAction(async () => {
      await f.install()
      if (damage === 'manifest') {
        const m = JSON.parse(await readFile(f.manifestPath, 'utf8')); m.models.provider = 'changed'
        await f.put(f.manifestPath, json(m))
      } else await f.put(join(f.home, 'cordis.patch.yml'), '[]\n')
    })
    const result = await applyDshInstallation(await planDshInstallation(f.options), f.options)
    assert.equal(result.status, 'failed-partial-state-retained'); assert.equal(result.userConfigurationPreserved, false)
  }
})

test('only bound adapters and unchanged official identity pins are admitted', async t => {
  const f = await fixture(t)
  await assert.rejects(planDshInstallation({ ...f.options, adapter: {} }), /Pinned DSH adapter/)
  await assert.rejects(createDshInstallerAdapter({ ...f.adapterOptions, scope: 'official-pinned' }), /not an injected runner/)
  await assert.rejects(createDshInstallerAdapter({ ...f.adapterOptions, hostVersion: 'other' }))
})

test('missing official ordered Bundle path interface fails admission without an invented fallback', async t => {
  await assert.rejects(fixture(t, { loader: loaderSource.replace('export const bundlePatchPaths', 'const bundlePatchPaths') }),
    /Missing official Loader interface: bundlePatchPaths/)
})

async function productFixture(t) {
  const f=await fixture(t), npmRoot=join(f.root,'product'), configPath=join(f.root,'pins.json')
  await f.put(join(npmRoot,'package.json'),json({name:'@release/companion',version:'0.1.0-beta.1',
    dependencies:{'@ladybugdb/wasm-core':'0.21.1','@huggingface/transformers':'3.8.1','onnxruntime-common':'1.21.0',undici:'8.10.2'}}))
  for(const file of ['design-system.mjs','installer.mjs','npm-installer-dsh.mjs','npm-agent-installation.mjs'])
    await f.put(join(npmRoot,'bin',file),'// isolated product entry '+file+'\n')
  await f.put(configPath,json({dshHome:f.home,...f.pins,hostVersion:f.adapterOptions.hostVersion,loaderVersion:f.adapterOptions.loaderVersion}))
  const mapping={schemaVersion:1,hosts:{dsh:{aggregatePackage:'@release/design-system-dsh',aggregateVersion:'1.2.3',registry:'https://registry.npmjs.org/'}}}
  const mappingPath=join(npmRoot,'release-hosts.json')
  await f.put(mappingPath,json(mapping))
  const receiptRoot=await mkdtemp(join(tmpdir(),'dsh-product-receipts-'))
  t.after(()=>rm(receiptRoot,{recursive:true,force:true}))
  const args=['install','--host','dsh','--dsh-config',configPath,'--profile','chosen','--receipt-dir',join(receiptRoot,'receipts')]
  let factories=0
  const context={npmRoot,dshAdapterFactory:async()=>{factories++;return f.options.adapter}}
  return {...f,mapping,mappingPath,receiptRoot,args,context,factories:()=>factories}
}

test('direct Agent entry composes owning DSH plan/apply and repeats without re-executing native install',async t=>{
  const f=await productFixture(t)
  const first=await installerMain(f.args,f.context)
  assert.equal(first.status,'registered-config-parsed'); assert.equal(first.installation.registration,'verified')
  assert.equal(first.installation.acquisition,'available'); assert.equal(first.installation.activation,'required')
  assert.equal(first.usable,false); assert.equal(first.runtimeMounted,false)
  assert.equal(f.calls.length,1)
  assert.equal(JSON.parse(await readFile(first.receiptFile)).planSha256,first.planSha256)
  const again=await installerMain(f.args,f.context)
  assert.equal(again.status,'registered-config-parsed'); assert.equal(f.calls.length,1)
  assert.notEqual(again.receiptFile,first.receiptFile)
  assert.equal(again.userConfigurationPreserved,true)
})

test('product DSH mapping supplies exact official command; overrides and saved-plan drift cannot execute',async t=>{
  const f=await productFixture(t)
  const plan=await installerMain([...f.args,'--dry-run'],f.context)
  assert.deepEqual(plan.args,[f.paths.cli,'plugin','--profile','chosen','add','--workspace-root','--save-exact','@release/design-system-dsh@1.2.3','--registry','https://registry.npmjs.org/'])
  assert.equal(f.calls.length,0)
  await assert.rejects(installerMain([...f.args,'--apply','--plan',plan.planFile,'--aggregate-selector','@release/design-system-dsh@1.2.4'],f.context),/override differs/)
  assert.equal(f.factories(),1)
  await assert.rejects(installerMain([...f.args,'--apply','--plan',plan.planFile,'--registry','https://other.example/'],f.context),/Saved registry mismatch/)
  f.mapping.hosts.dsh.aggregateVersion='1.2.4';await f.put(f.mappingPath,json(f.mapping))
  await assert.rejects(installerMain([...f.args,'--apply','--plan',plan.planFile],f.context),/Saved aggregate selector mismatch/)
  assert.equal(f.calls.length,0)
  f.mapping.hosts.dsh.aggregateVersion='1.2.3';await f.put(f.mappingPath,json(f.mapping))
  const result=await installerMain([...f.args,'--apply','--plan',plan.planFile],f.context)
  assert.equal(result.status,'registered-config-parsed');assert.equal(f.calls.length,1)
  assert.equal(result.runtimeMounted,false)
})

test('explicit mirror is pinned separately from release origin through plan, apply and owned repeat', async t => {
  const f = await productFixture(t), registry = 'https://registry.npmmirror.com/'
  const args = [...f.args, '--registry', registry]
  const plan = await installerMain([...args, '--dry-run'], f.context)
  assert.equal(plan.registry, registry)
  assert.equal(plan.product.releaseSelection.registry, f.mapping.hosts.dsh.registry)
  assert.equal(plan.aggregateSelector, f.options.aggregateSelector)
  assert.deepEqual(plan.args.slice(-3), [f.options.aggregateSelector, '--registry', registry])
  for (const changed of [f.args, [...f.args, '--registry', 'https://different.example/']])
    await assert.rejects(installerMain([...changed, '--apply', '--plan', plan.planFile], f.context), /Saved registry mismatch/)
  assert.equal(f.calls.length, 0)
  const result = await installerMain([...args, '--apply', '--plan', plan.planFile], f.context)
  assert.equal(result.status, 'registered-config-parsed'); assert.equal(result.ownershipEstablished, true)
  assert.equal(result.source.expected.registry, registry)
  const again = await installerMain([...args, '--previous-receipt', result.receiptFile], f.context)
  assert.equal(again.operation, 'already-registered'); assert.equal(again.ownershipEstablished, true)
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].args, plan.args)
  await assert.rejects(installerMain([...f.args, '--previous-receipt', result.receiptFile, '--dry-run'], f.context), /Registry migration/)
})

test('direct mirror install forwards transport and never retries a failed mirror at the default origin', async t => {
  const f = await productFixture(t), registry = 'https://registry.npmmirror.com/'
  f.setAction(() => { throw Object.assign(new Error('mirror unavailable'), { code: 'ECONNREFUSED' }) })
  const result = await installerMain([...f.args, '--registry', registry], f.context)
  assert.equal(result.status, 'failed-partial-state-retained')
  assert.equal(result.planSnapshot.registry, registry)
  assert.equal(result.planSnapshot.product.releaseSelection.registry, f.mapping.hosts.dsh.registry)
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].args.at(-1), registry)
})

test('mirrors still reject unsafe URLs, wrong versions and malformed release mapping', async t => {
  const f = await productFixture(t)
  for (const registry of ['http://registry.npmmirror.com/', 'https://secret@registry.npmmirror.com/',
    'https://registry.npmmirror.com/?token=secret', 'https://registry.npmmirror.com/#fragment', 'not-a-url']) {
    await assert.rejects(installerMain([...f.args, '--registry', registry, '--dry-run'], f.context))
    await assert.rejects(planDshInstallation({ ...f.options, productRoot: f.context.npmRoot, registry }))
  }
  await assert.rejects(installerMain([...f.args, '--registry', 'https://registry.npmmirror.com/',
    '--aggregate-selector', '@release/design-system-dsh@1.2.4', '--dry-run'], f.context), /override differs/)
  f.mapping.hosts.dsh.registry = 'http://invalid.example/'
  await f.put(f.mappingPath, json(f.mapping))
  await assert.rejects(installerMain([...f.args, '--registry', 'https://registry.npmmirror.com/', '--dry-run'], f.context), /HTTPS registry/)
  assert.equal(f.calls.length, 0)
})

test('Node resolves a pnpm-style package link to pinned physical product bytes without weakening path guards', async t => {
  const f = await productFixture(t)
  const physical = join(f.root, 'consumer/node_modules/.pnpm/@release+companion@0.1.0-beta.1/node_modules/@release/companion')
  await mkdir(dirname(physical), { recursive: true }); await rename(f.context.npmRoot, physical)
  const logical = join(f.root, 'consumer/node_modules/@release/companion')
  await mkdir(dirname(logical), { recursive: true }); await symlink(physical, logical, 'dir')
  await f.put(join(physical, 'bin/design-system.mjs'), "import { fileURLToPath } from 'node:url'; export const npmRoot = fileURLToPath(new URL('../', import.meta.url));\n")
  const { npmRoot } = await import(pathToFileURL(join(logical, 'bin/design-system.mjs')).href)
  const result = await installerMain([...f.args, '--registry', 'https://registry.npmmirror.com/'], { ...f.context, npmRoot })
  assert.equal(result.product.npmRoot, physical)
  assert.equal(result.status, 'registered-config-parsed'); assert.equal(f.calls.length, 1)
  // Caller-supplied symlink roots are still rejected; the real Node entry does resolution.
  await assert.rejects(installerMain([...f.args, '--dry-run'], { ...f.context, npmRoot: logical }), /Symlink path/)
})

test('unbound and missing mappings retain explicit compatibility; malformed mapping never falls back',async t=>{
  const f=await productFixture(t)
  const explicit=['--aggregate-selector',f.options.aggregateSelector,'--registry',f.options.registry]
  for(const mode of ['unbound','missing']) {
    if(mode==='unbound'){f.mapping.hosts.dsh.aggregateVersion=null;f.mapping.hosts.dsh.registry=null;await f.put(f.mappingPath,json(f.mapping))}
    else await rm(f.mappingPath)
    const before=f.factories()
    await assert.rejects(installerMain([...f.args,'--dry-run'],f.context),/unbound or missing/)
    assert.equal(f.factories(),before)
    // Separate external output avoids overwriting a prior saved plan.
    const args=[...f.args];args[args.length-1]=join(f.receiptRoot,mode+' receipts')
    const plan=await installerMain([...args,'--dry-run',...explicit],f.context)
    assert.equal(plan.aggregateSelector,f.options.aggregateSelector)
  }
  f.mapping.hosts.dsh.aggregateVersion='latest';f.mapping.hosts.dsh.registry='https://registry.npmjs.org/'
  await f.put(f.mappingPath,json(f.mapping))
  const before=f.factories()
  await assert.rejects(installerMain([...f.args,'--dry-run',...explicit],f.context),/Exact aggregate version/)
  assert.equal(f.factories(),before);assert.equal(f.calls.length,0)
  await assert.rejects(installerMain(['install','--host','qoder','--dry-run',...explicit],f.context),/DSH flags are only valid/)
})


test('retained installation registers one official link, remains idempotent and binds local bytes', async t => {
  const f = await fixture(t), retained = join(f.root, 'retained installation', 'aggregate')
  await f.put(join(retained, 'package.json'), json({ name:'@release/design-system-dsh', version:'1.2.3', dsh:{bundle:{patch:'./patch.json'}} }))
  await f.put(join(retained, 'patch.json'), json([{id:'design'}]))
  const options = {...f.options, aggregateDirectory:retained}
  const plan = await planDshInstallation(options)
  assert.equal(plan.args[7], 'link:' + retained)
  assert.equal(f.calls.length, 0)
  await f.put(join(retained, 'patch.json'), json([{id:'changed'}]))
  await assert.rejects(applyDshInstallation(plan, options), /Plan or profile changed/)
  await f.put(join(retained, 'patch.json'), json([{id:'design'}]))
  f.setAction(async () => {
    const m = JSON.parse(await readFile(f.manifestPath, 'utf8'))
    m.dependencies['@release/design-system-dsh'] = 'link:' + retained
    m.dsh.profile.bundles.push('@release/design-system-dsh')
    await f.put(f.manifestPath, json(m))
    const link = join(f.profileDir, 'node_modules/@release/design-system-dsh')
    await mkdir(dirname(link), {recursive:true}); await symlink(retained, link, 'dir')
  })
  const result = await applyDshInstallation(plan, options)
  assert.equal(result.status, 'registered-config-parsed')
  assert.equal(result.userConfigurationPreserved, true)
  const again = await planDshInstallation(options)
  assert.equal(again.action, 'already-registered')
  await applyDshInstallation(again, options)
  assert.equal(f.calls.length, 1)
  const wrong = join(f.root, 'different aggregate')
  await f.put(join(wrong,'package.json'), await readFile(join(retained,'package.json')))
  await f.put(join(wrong,'patch.json'), await readFile(join(retained,'patch.json')))
  await assert.rejects(planDshInstallation({...options, aggregateDirectory:wrong}), /link conflict/)
})

test('product discovers the aggregate in its retained npm installation without a registry selector install', async t => {
  const f = await productFixture(t)
  const retained = join(f.context.npmRoot, 'node_modules/@release/design-system-dsh')
  await f.put(join(retained, 'package.json'), json({name:'@release/design-system-dsh',version:'1.2.3',dsh:{bundle:{patch:'./patch.json'}}}))
  await f.put(join(retained, 'patch.json'), '[]\n')
  const plan = await installerMain([...f.args,'--dry-run'], f.context)
  assert.equal(plan.aggregateDirectory, retained)
  assert.equal(plan.args[7], 'link:' + retained)
  assert.equal(f.calls.length, 0)
})

async function updateFixture(t, registry) {
  const f = await productFixture(t)
  if (registry) f.args.push('--registry', registry)
  const first = await installerMain(f.args, f.context)
  const npmRoot = join(f.root, 'product B')
  const manifest = JSON.parse(await readFile(join(f.context.npmRoot, 'package.json'), 'utf8'))
  manifest.version = '0.1.0-beta.2'
  await f.put(join(npmRoot, 'package.json'), json(manifest))
  await f.put(join(npmRoot, 'release-hosts.json'), json({ ...f.mapping, hosts: { dsh: { ...f.mapping.hosts.dsh, aggregateVersion: '1.2.4' } } }))
  for (const file of ['design-system.mjs', 'installer.mjs', 'npm-installer-dsh.mjs', 'npm-agent-installation.mjs'])
    await f.put(join(npmRoot, 'bin', file), await readFile(join(f.context.npmRoot, 'bin', file)))
  f.setAction(async () => {
    await f.install('1.2.4')
    await f.put(join(f.profileDir, 'node_modules/@release/design-system-dsh/patch.json'), json([{ id: 'design B' }]))
  })
  return { ...f, first, nextRoot: npmRoot, nextContext: { ...f.context, npmRoot },
    nextArgs: [...f.args, '--previous-receipt', first.receiptFile] }
}

async function resealReceipt(f, path, mutate) {
  const receipt = JSON.parse(await readFile(path, 'utf8'))
  mutate(receipt)
  const { planSha256, ...planBody } = receipt.planSnapshot
  receipt.planSha256 = receipt.planSnapshot.planSha256 = digest(planBody)
  const { receiptSha256, ...body } = receipt
  receipt.receiptSha256 = digest(body)
  await f.put(path, json(receipt))
  return receipt
}

test('unbound product compatibility installation cannot mint an update owner', async t => {
  const f = await productFixture(t)
  f.mapping.hosts.dsh.aggregateVersion = null; f.mapping.hosts.dsh.registry = null
  await f.put(f.mappingPath, json(f.mapping))
  const explicit = ['--aggregate-selector', f.options.aggregateSelector, '--registry', f.options.registry]
  const result = await installerMain([...f.args, ...explicit], f.context)
  assert.equal(result.status, 'registered-config-parsed'); assert.equal(result.ownershipEstablished, false)
  assert.equal(result.product.releaseSelection, null)
  assert.ok(result.product.releaseMapSha256) // Existing bytes alone do not establish a bound release.
  f.mapping.hosts.dsh.aggregateVersion = '1.2.3'; f.mapping.hosts.dsh.registry = 'https://registry.npmjs.org/'
  await f.put(f.mappingPath, json(f.mapping))
  await assert.rejects(installerMain([...f.args, '--previous-receipt', result.receiptFile, '--dry-run'], f.context),
    /ownership was not established/)
  assert.equal(f.calls.length, 1)
})

test('direct plan API consumes the same exact product mapping validator as the public entry', async t => {
  assert.equal(validateReleaseHosts, validateDshReleaseHosts)
  const f = await productFixture(t)
  for (const override of [{ aggregateSelector: '@release/design-system-dsh@1.2.4' }])
    await assert.rejects(planDshInstallation({ ...f.options, productRoot: f.context.npmRoot, ...override }),
      /differs from product release/)
  const mirror = await planDshInstallation({ ...f.options, productRoot: f.context.npmRoot, registry: 'https://registry.npmmirror.com/' })
  assert.equal(mirror.registry, 'https://registry.npmmirror.com/')
  assert.equal(mirror.product.releaseSelection.registry, f.options.registry)
  f.mapping.hosts.dsh.aggregateVersion = 'latest'; await f.put(f.mappingPath, json(f.mapping))
  await assert.rejects(planDshInstallation({ ...f.options, productRoot: f.context.npmRoot }), /Exact aggregate version/)
  assert.equal(f.calls.length, 0)
})

test('repeated observations keep the latest actual native update owner and permit the next update without historical roots', async t => {
  const f = await updateFixture(t), b = await installerMain(f.nextArgs, f.nextContext)
  let input = b
  for (let round = 0; round < 3; round++) {
    const repeat = await installerMain([...f.args, '--previous-receipt', input.receiptFile], f.nextContext)
    assert.equal(repeat.operation, 'already-registered'); assert.equal(repeat.ownershipEstablished, true)
    assert.equal(repeat.planSnapshot.previousReceipt, input.receiptFile)
    assert.equal(repeat.planSnapshot.previousInputSha256, sha(await readFile(input.receiptFile)))
    assert.equal(repeat.planSnapshot.previous.receiptFile, b.receiptFile)
    assert.equal(repeat.planSnapshot.previous.receiptSha256, sha(await readFile(b.receiptFile)))
    if (round === 0) {
      // Owned fixture history can disappear: a no-command input reads itself
      // and B, never B's earlier A receipt or A's product tree.
      await rm(f.context.npmRoot, { recursive: true })
      await rm(f.first.receiptFile)
    }
    input = repeat
  }
  const root = join(f.root, 'product C')
  const m = JSON.parse(await readFile(join(f.nextRoot, 'package.json'), 'utf8')); m.version = '0.1.0-beta.3'
  await f.put(join(root, 'package.json'), json(m))
  const mapping = JSON.parse(await readFile(join(f.nextRoot, 'release-hosts.json'), 'utf8')); mapping.hosts.dsh.aggregateVersion = '1.2.5'
  await f.put(join(root, 'release-hosts.json'), json(mapping))
  for (const file of ['design-system.mjs', 'installer.mjs', 'npm-installer-dsh.mjs', 'npm-agent-installation.mjs'])
    await f.put(join(root, 'bin', file), await readFile(join(f.nextRoot, 'bin', file)))
  f.setAction(() => f.install('1.2.5'))
  const c = await installerMain([...f.args, '--previous-receipt', input.receiptFile], { ...f.context, npmRoot: root })
  assert.equal(c.operation, 'update'); assert.equal(c.ownershipEstablished, true)
  assert.equal(c.planSnapshot.previous.receiptFile, b.receiptFile)
  assert.equal(c.readback.installed.version, '1.2.5'); assert.equal(f.calls.length, 3)
})

test('self-consistent no-command receipts cannot mint ownership using absent or empty references', async t => {
  for (const mode of ['missing', 'empty']) {
    const f = await productFixture(t); await f.install()
    const r = await installerMain(f.args, f.context)
    await resealReceipt(f, r.receiptFile, body => {
      body.ownershipEstablished = true
      if (mode === 'empty') body.planSnapshot.previous = {}
      else delete body.planSnapshot.previous
    })
    await assert.rejects(installerMain([...f.args, '--previous-receipt', r.receiptFile, '--dry-run'], f.context),
      /Actual native owner/)
    assert.equal(f.calls.length, 0)
  }
})

test('a native update receipt also requires its successful owner reference rather than an empty marker', async t => {
  const f = await updateFixture(t), b = await installerMain(f.nextArgs, f.nextContext)
  await resealReceipt(f, b.receiptFile, body => { body.planSnapshot.previous = {} })
  await assert.rejects(installerMain([...f.args, '--previous-receipt', b.receiptFile, '--dry-run'], f.nextContext),
    /Actual native owner file required/)
  assert.equal(f.calls.length, 2)
})

test('native owner references reject missing, failed, prepared, wrong-hash, wrong-identity and observation anchors', async t => {
  for (const mode of ['missing', 'failed', 'prepared', 'hash', 'identity', 'observation', 'exit']) {
    const f = await updateFixture(t), b = await installerMain(f.nextArgs, f.nextContext)
    const r = await installerMain([...f.args, '--previous-receipt', b.receiptFile], f.nextContext)
    if (mode === 'missing') await rm(b.receiptFile)
    if (mode === 'failed') await resealReceipt(f, b.receiptFile, body => { body.status = 'failed-partial-state-retained' })
    let alternate
    if (mode === 'observation') alternate = await installerMain([...f.args, '--previous-receipt', r.receiptFile], f.nextContext)
    if (mode === 'exit') await resealReceipt(f, b.receiptFile, body => { body.execution.exitCode = 7 })
    const preparedHash = mode === 'prepared' ? sha(await readFile(b.preparedRecordFile)) : null
    await resealReceipt(f, r.receiptFile, body => {
      const ref = body.planSnapshot.previous
      if (mode === 'prepared') {
        ref.receiptFile = b.preparedRecordFile
        ref.receiptSha256 = preparedHash
        // The prepared body is deliberately not a successful terminal receipt.
      }
      if (mode === 'hash') ref.receiptSha256 = '0'.repeat(64)
      if (mode === 'identity') ref.owned.installed.version = '9.9.9'
      if (alternate) Object.assign(ref, { receiptFile: alternate.receiptFile,
        receiptSha256: '0'.repeat(64),
        planSha256: alternate.planSha256 })
    })
    if (alternate || mode === 'exit') {
      // Refresh only the reference hash, so rejection tests the actual native
      // completion requirement rather than stopping at an incidental byte drift.
      const target = alternate?.receiptFile ?? b.receiptFile
      const hash = sha(await readFile(target))
      await resealReceipt(f, r.receiptFile, body => { body.planSnapshot.previous.receiptSha256 = hash })
    }
    await assert.rejects(installerMain([...f.args, '--previous-receipt', r.receiptFile, '--dry-run'], f.nextContext))
    assert.equal(f.calls.length, 2)
  }
})

test('saved plans independently bind the explicit observation and the actual native anchor bytes', async t => {
  for (const target of ['input', 'anchor']) {
    const f = await updateFixture(t), b = await installerMain(f.nextArgs, f.nextContext)
    const r = await installerMain([...f.args, '--previous-receipt', b.receiptFile], f.nextContext)
    const args = [...f.args, '--previous-receipt', r.receiptFile]
    const plan = await installerMain([...args, '--dry-run'], f.nextContext)
    await writeFile(target === 'input' ? r.receiptFile : b.receiptFile, ' ', { flag: 'a' })
    await assert.rejects(installerMain([...args, '--apply', '--plan', plan.planFile], f.nextContext), /drifted|Native owner reference changed/)
    assert.equal(f.calls.length, 2)
  }
})

test('normal product registry A to B update needs no co-installed aggregate and preserves current user facts', async t => {
  const f = await updateFixture(t)
  for (const root of [f.context.npmRoot, f.nextRoot]) {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    assert.equal(Object.keys(manifest.dependencies).length, 4)
    await assert.rejects(readFile(join(root, 'node_modules/@release/design-system-dsh/package.json')), { code: 'ENOENT' })
  }
  assert.equal(f.first.ownershipEstablished, true)
  assert.equal(f.first.source.expected.kind, 'registry-selector')
  const edited = JSON.parse(await readFile(f.manifestPath, 'utf8'))
  edited.models.provider = 'user edit since A'; edited.extra = { keep: true }
  await f.put(f.manifestPath, json(edited))
  await f.put(join(f.home, 'cordis.patch.yml'), json([{ id: 'new user patch' }]))
  const plan = await installerMain([...f.nextArgs, '--dry-run'], f.nextContext)
  assert.equal(plan.action, 'update'); assert.equal(plan.aggregateDirectory, undefined)
  assert.equal(plan.aggregateManifestSha256, undefined)
  assert.equal(plan.before.installed.version, '1.2.3')
  assert.equal(plan.args[7], '@release/design-system-dsh@1.2.4')
  assert.equal(plan.previousReceipt, f.first.receiptFile)
  assert.equal(f.calls.length, 1)
  const result = await installerMain([...f.nextArgs, '--apply', '--plan', plan.planFile], f.nextContext)
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1].args, plan.args)
  assert.equal(result.operation, 'update'); assert.equal(result.status, 'registered-config-parsed')
  assert.equal(result.ownershipEstablished, true); assert.equal(result.userConfigurationPreserved, true)
  assert.equal(result.source.observed.installed.version, '1.2.4')
  assert.notEqual(result.source.observed.installed.patchSha256, f.first.source.observed.installed.patchSha256)
  assert.equal(result.registryAcquisitionVerified, false); assert.equal(result.runtimeMounted, false)
  assert.equal(result.releaseValidated, false)
  assert.deepEqual(result.readback.bundles, edited.dsh.profile.bundles)
  assert.equal(JSON.parse(await readFile(f.manifestPath, 'utf8')).models.provider, 'user edit since A')
  const prepared = JSON.parse(await readFile(result.preparedRecordFile, 'utf8'))
  assert.equal(prepared.phase, 'prepared'); assert.equal(prepared.ownershipEstablished, false)
  assert.equal(prepared.planSha256, result.planSha256)
  const againArgs = [...f.args, '--previous-receipt', result.receiptFile]
  const again = await installerMain(againArgs, f.nextContext)
  assert.equal(again.operation, 'already-registered'); assert.equal(again.ownershipEstablished, true)
  assert.equal(f.calls.length, 2)
})

test('direct registry update forwards previous ownership through its two owning calls', async t => {
  const f = await updateFixture(t)
  const result = await installerMain(f.nextArgs, f.nextContext)
  assert.equal(result.operation, 'update'); assert.equal(result.ownershipEstablished, true)
  assert.equal(result.installation.registration, 'verified'); assert.equal(result.usable, false)
  assert.equal(f.calls.length, 2)
  assert.equal(result.planSnapshot.previousReceipt, f.first.receiptFile)
})

test('same-mirror owned update preserves canonical origin and rejects a release-origin migration', async t => {
  const registry = 'https://registry.npmmirror.com/', f = await updateFixture(t, registry)
  const result = await installerMain(f.nextArgs, f.nextContext)
  assert.equal(result.operation, 'update'); assert.equal(result.ownershipEstablished, true)
  assert.equal(result.planSnapshot.registry, registry)
  assert.equal(result.product.releaseSelection.registry, f.options.registry)
  assert.equal(f.calls.length, 2)
  const g = await updateFixture(t, registry)
  const mapping = structuredClone(g.mapping); mapping.hosts.dsh.aggregateVersion = '1.2.4'
  mapping.hosts.dsh.registry = 'https://changed-origin.example/'
  await g.put(join(g.nextRoot, 'release-hosts.json'), json(mapping))
  await assert.rejects(installerMain([...g.nextArgs, '--dry-run'], g.nextContext), /Release registry migration/)
  assert.equal(g.calls.length, 1)
})

test('different selector without proof and sparse, failed or edited receipts never authorize registry replacement', async t => {
  for (const mode of ['missing', 'sparse', 'failed', 'wrong host', 'wrong profile', 'digest']) {
    const f = await updateFixture(t)
    if (mode !== 'missing') {
      const receipt = JSON.parse(await readFile(f.first.receiptFile, 'utf8'))
      if (mode === 'sparse') { delete receipt.product; receipt.schemaVersion = 1 }
      if (mode === 'failed') receipt.status = 'failed-partial-state-retained'
      if (mode === 'wrong host') receipt.host = 'other'
      if (mode === 'wrong profile') {
        receipt.planSnapshot.profile = 'other'
        const { planSha256, ...body } = receipt.planSnapshot
        receipt.planSha256 = receipt.planSnapshot.planSha256 = digest(body)
      }
      if (mode === 'digest') receipt.source.observed.installed.patchSha256 = '0'.repeat(64)
      else {
        const { receiptSha256, ...body } = receipt
        receipt.receiptSha256 = digest(body)
      }
      await f.put(f.first.receiptFile, json(receipt))
    }
    const args = mode === 'missing' ? f.args : f.nextArgs
    await assert.rejects(installerMain([...args, '--dry-run'], f.nextContext))
    assert.equal(f.calls.length, 1)
  }
})

test('same-version product relocation and registry or source-kind migrations remain refused', async t => {
  for (const mode of ['same version', 'registry', 'link']) {
    const f = await updateFixture(t)
    const mappingPath = join(f.nextRoot, 'release-hosts.json')
    const mapping = JSON.parse(await readFile(mappingPath, 'utf8'))
    if (mode === 'same version') mapping.hosts.dsh.aggregateVersion = '1.2.3'
    if (mode === 'registry') mapping.hosts.dsh.registry = 'https://different.example/'
    await f.put(mappingPath, json(mapping))
    if (mode === 'link') {
      const retained = join(f.nextRoot, 'node_modules/@release/design-system-dsh')
      await f.put(join(retained, 'package.json'), json({ name: '@release/design-system-dsh', version: '1.2.4', dsh: { bundle: { patch: './patch.json' } } }))
      await f.put(join(retained, 'patch.json'), '[]\n')
    }
    await assert.rejects(installerMain([...f.nextArgs, '--dry-run'], f.nextContext), /Same-version relocation|Registry migration|Release registry migration|Source-kind migration/)
    assert.equal(f.calls.length, 1)
  }
})

test('update plans and diagnostics cannot be written inside either retained product', async t => {
  const f = await updateFixture(t)
  const args = [...f.nextArgs]; args[args.indexOf('--receipt-dir') + 1] = join(f.context.npmRoot, 'new output')
  await assert.rejects(installerMain([...args, '--dry-run'], f.nextContext), /output overlaps/)
  await assert.rejects(readFile(join(f.context.npmRoot, 'new output/package.json')), { code: 'ENOENT' })
  const plan = await installerMain([...f.nextArgs, '--dry-run'], f.nextContext)
  const saved = JSON.parse(await readFile(plan.planFile, 'utf8'))
  for (const logDirectory of [f.context.npmRoot, f.nextRoot])
    await assert.rejects(applyDshInstallation(saved, { adapter: f.options.adapter, logDirectory }), /overlap host inputs/)
  assert.equal(f.calls.length, 1)
})

test('owned retained-link update remains a separate optional co-install branch', async t => {
  const f = await productFixture(t)
  async function retained(root, version) {
    const dir = join(root, 'node_modules/@release/design-system-dsh')
    await f.put(join(dir, 'package.json'), json({ name: '@release/design-system-dsh', version, dsh: { bundle: { patch: './patch.json' } } }))
    await f.put(join(dir, 'patch.json'), json([{ id: 'retained ' + version }]))
    return dir
  }
  async function linkInstall(dir) {
    const m = JSON.parse(await readFile(f.manifestPath, 'utf8'))
    m.dependencies['@release/design-system-dsh'] = 'link:' + dir
    if (!m.dsh.profile.bundles.includes('@release/design-system-dsh')) m.dsh.profile.bundles.push('@release/design-system-dsh')
    await f.put(f.manifestPath, json(m))
    const link = join(f.profileDir, 'node_modules/@release/design-system-dsh')
    await mkdir(dirname(link), { recursive: true })
    await rm(link, { force: true }); await symlink(dir, link, 'dir')
  }
  const a = await retained(f.context.npmRoot, '1.2.3')
  f.setAction(() => linkInstall(a))
  const first = await installerMain(f.args, f.context)
  const bRoot = join(f.root, 'retained B')
  const m = JSON.parse(await readFile(join(f.context.npmRoot, 'package.json'), 'utf8')); m.version = '0.1.0-beta.2'
  await f.put(join(bRoot, 'package.json'), json(m))
  await f.put(join(bRoot, 'release-hosts.json'), json({ ...f.mapping, hosts: { dsh: { ...f.mapping.hosts.dsh, aggregateVersion: '1.2.4' } } }))
  for (const file of ['design-system.mjs', 'installer.mjs', 'npm-installer-dsh.mjs', 'npm-agent-installation.mjs'])
    await f.put(join(bRoot, 'bin', file), await readFile(join(f.context.npmRoot, 'bin', file)))
  const b = await retained(bRoot, '1.2.4'); f.setAction(() => linkInstall(b))
  const result = await installerMain([...f.args, '--previous-receipt', first.receiptFile], { ...f.context, npmRoot: bRoot })
  assert.equal(result.status, 'registered-config-parsed'); assert.equal(result.operation, 'update')
  assert.equal(result.source.expected.kind, 'retained-link'); assert.equal(result.ownershipEstablished, true)
  assert.equal(result.source.observed.installed.realPackageDir, b)
  assert.equal(f.calls[1].args[7], 'link:' + b); assert.equal(f.calls.length, 2)
})

test('no-command observations and prepared records cannot adopt a foreign registration as an owner', async t => {
  const f = await productFixture(t); await f.install()
  const observation = await installerMain(f.args, f.context)
  assert.equal(observation.operation, 'already-registered'); assert.equal(observation.ownershipEstablished, false)
  assert.equal(f.calls.length, 0)
  for (const receipt of [observation.receiptFile, observation.preparedRecordFile])
    await assert.rejects(installerMain([...f.args, '--previous-receipt', receipt, '--dry-run'], f.context),
      /ownership was not established|digest mismatch/)
  assert.equal(f.calls.length, 0)
})

test('owned A package, source product, profile registration or after-plan inputs must not drift', async t => {
  for (const mode of ['aggregate', 'product A', 'unregistered', 'patch', 'product B', 'previous receipt']) {
    const f = await updateFixture(t)
    const plan = await installerMain([...f.nextArgs, '--dry-run'], f.nextContext)
    if (mode === 'aggregate') await f.put(join(f.profileDir, 'node_modules/@release/design-system-dsh/patch.json'), '[]\n')
    if (mode === 'product A') await f.put(join(f.context.npmRoot, 'bin/installer.mjs'), '// edited A\n')
    if (mode === 'unregistered') {
      const m = JSON.parse(await readFile(f.manifestPath, 'utf8')); m.dsh.profile.bundles.pop(); await f.put(f.manifestPath, json(m))
    }
    if (mode === 'patch') await f.put(join(f.home, 'cordis.patch.yml'), '[]\n')
    if (mode === 'product B') await f.put(join(f.nextRoot, 'bin/installer.mjs'), '// edited B\n')
    if (mode === 'previous receipt') await writeFile(f.first.receiptFile, ' ', { flag: 'a' })
    await assert.rejects(installerMain([...f.nextArgs, '--apply', '--plan', plan.planFile], f.nextContext),
      /Owned A|product changed|drifted/)
    assert.equal(f.calls.length, 1)
  }
})

test('registry updates retain partial failures, foreign mutation and official-style restoration without retry', async t => {
  for (const mode of ['foreign', 'order', 'wrong version', 'nonzero', 'restored A']) {
    const f = await updateFixture(t)
    f.setAction(async () => {
      await f.install(mode === 'restored A' ? '1.2.3' : mode === 'wrong version' ? '1.2.5' : '1.2.4')
      if (mode === 'foreign' || mode === 'order') {
        const m = JSON.parse(await readFile(f.manifestPath, 'utf8'))
        if (mode === 'foreign') m.models.provider = 'unexpected'
        else m.dsh.profile.bundles.reverse()
        await f.put(f.manifestPath, json(m))
      }
      if (mode === 'nonzero' || mode === 'restored A') throw Object.assign(Error('official command failed'), { code: 1 })
    })
    const result = await installerMain(f.nextArgs, f.nextContext)
    assert.equal(result.status, 'failed-partial-state-retained'); assert.equal(result.ownershipEstablished, false)
    assert.equal(result.partialStateRetained, true); assert.equal(result.rollbackAttempted, false)
    assert.equal(result.execution.retrySafe, false); assert.equal(f.calls.length, 2)
    await assert.rejects(installerMain([...f.args, '--previous-receipt', result.receiptFile, '--dry-run'], f.nextContext),
      /Successful owned installation required/)
    assert.equal(f.calls.length, 2)
  }
})

test('DSH previous ownership is an install-only exception to the desktop option guard', async t => {
  const f = await productFixture(t)
  for (const args of [
    ['install', '--host', 'codex', '--dry-run', '--previous-receipt', '/not-read'],
    ['recover', '--host', 'dsh', '--previous-receipt', '/not-read'],
    [...f.args, '--dry-run', '--destination', '/not-used'],
  ]) await assert.rejects(installerMain(args, f.context), /only valid for direct desktop install/)
  assert.equal(f.calls.length, 0)
})

test('official Loader fallback cannot substitute for the aggregate direct profile slot', async t => {
  const loader = loaderSource.replace('return dir;',
    "return name === '@release/design-system-dsh' ? join(profile, 'host fallback', name) : dir;")
  const f = await fixture(t, { loader }); await f.install()
  const direct = join(f.profileDir, 'node_modules/@release/design-system-dsh')
  const fallback = join(f.profileDir, 'host fallback/@release/design-system-dsh')
  for (const file of ['package.json', 'patch.json']) await f.put(join(fallback, file), await readFile(join(direct, file)))
  await assert.rejects(inspectDshInstallation(f.options), /not the direct profile package/)
  assert.equal(f.calls.length, 0)
})

test('cancellation after registry replacement keeps the prepared evidence and never creates an owner', async t => {
  const f = await updateFixture(t), cancellation = new AbortController()
  f.setAction(async () => { await f.install('1.2.4'); cancellation.abort() })
  const result = await installerMain(f.nextArgs, { ...f.nextContext, signal: cancellation.signal })
  assert.equal(result.status, 'failed-partial-state-retained'); assert.equal(result.ownershipEstablished, false)
  assert.equal(result.execution.state, 'cancelled'); assert.equal(result.execution.processTreeState, 'unverified')
  assert.equal(result.readback.installed.version, '1.2.4'); assert.equal(result.execution.retrySafe, false)
  assert.equal(JSON.parse(await readFile(result.preparedRecordFile)).ownershipEstablished, false)
  assert.equal(f.calls.length, 2)
})

test('terminal receipt failure exposes the exact prepared record after a registry update changed state', async t => {
  const f = await updateFixture(t), output = join(f.receiptRoot, 'terminal output')
  const args = [...f.nextArgs]; args[args.indexOf('--receipt-dir') + 1] = output
  const plan = await installerMain([...args, '--dry-run'], f.nextContext)
  let preparedPath
  f.setAction(async () => {
    await f.install('1.2.4')
    const names = await readdir(output)
    preparedPath = join(output, names.find(name => name.endsWith('.dsh-prepared.json')))
    const prepared = JSON.parse(await readFile(preparedPath, 'utf8'))
    await mkdir(prepared.receiptPath) // Owned fixture obstruction, no unrelated files are removed.
  })
  await assert.rejects(installerMain([...args, '--apply', '--plan', plan.planFile], f.nextContext), error => {
    assert.equal(error.receiptPath, preparedPath)
    assert.equal(error.planFile, plan.planFile)
    return true
  })
  assert.equal(f.calls.length, 2)
  assert.equal((await inspectDshInstallation({ ...f.options, aggregateSelector: '@release/design-system-dsh@1.2.4' })).installed.version, '1.2.4')
  assert.equal(JSON.parse(await readFile(preparedPath)).ownershipEstablished, false)
})

test('controlled native commands wait for completion and distinguish deadline, cancellation, exit and output limit', async () => {
  const normal = await executeDshInstall(process.execPath, ['-e', 'setTimeout(()=>{process.stdout.write("finished")},80)'], {})
  assert.equal(normal.execution.state, 'completed'); assert.equal(normal.execution.timeoutMs, 0)
  assert.equal(normal.execution.killed, false)
  assert.equal(normal.stdout.toString(), 'finished')
  const timeout = await executeDshInstall(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {}, { timeoutMs: 40 })
  assert.equal(timeout.execution.state, 'timed-out'); assert.notEqual(timeout.exitCode, 0)
  assert.equal(timeout.execution.exitCode, null); assert.equal(timeout.execution.outputComplete, false)
  assert.equal(timeout.execution.processTreeState, 'unverified'); assert.equal(timeout.execution.retrySafe, false)
  const cancel = new AbortController()
  const pending = executeDshInstall(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {}, { signal: cancel.signal })
  cancel.abort()
  assert.equal((await pending).execution.state, 'cancelled')
  const failed = await executeDshInstall(process.execPath, ['-e', 'process.stderr.write("native reason");process.exit(7)'], {})
  assert.equal(failed.execution.state, 'failed'); assert.equal(failed.exitCode, 7)
  assert.equal(failed.execution.exitCode, 7)
  assert.equal(failed.stderr.toString(), 'native reason')
  const overflow = await executeDshInstall(process.execPath, ['-e', `process.stdout.write('x'.repeat(${DSH_INSTALL_MAX_OUTPUT_BYTES + 65536}))`], {})
  assert.equal(overflow.execution.state, 'output-limit'); assert.notEqual(overflow.exitCode, 0)
  assert.ok(overflow.stdout.length <= DSH_INSTALL_MAX_OUTPUT_BYTES)
  const missing = await executeDshInstall(join(process.cwd(), 'absent-dsh-command'), [], {})
  assert.equal(missing.execution.state, 'launch-failed')
})

test('an already cancelled request does not spawn, and abort retains observed output without claiming tree exit', async () => {
  const cancel = new AbortController(); cancel.abort()
  const result = await executeDshInstall('must-not-run', [], {}, { signal: cancel.signal,
    run: () => assert.fail('cancelled command spawned') })
  assert.equal(result.execution.state, 'cancelled')
  assert.equal(result.execution.killed, null) // No child was created.
  assert.equal(result.execution.exitCode, null)
  assert.equal(result.exitCode, 1)
  const coded = new AbortController(); coded.abort(Object.assign(Error('pre-cancelled'), { code: 7 }))
  const codedResult = await executeDshInstall('must-not-run', [], {}, { signal: coded.signal,
    run: () => assert.fail('pre-cancelled custom reason spawned') })
  assert.equal(codedResult.execution.exitCode, null)
  assert.equal(codedResult.exitCode, 1)
  const live = new AbortController(), run = promisify(execFile)
  const output = await executeDshInstall(process.execPath,
    ['-e', 'process.stdout.write("before cancellation");setInterval(()=>{},1000)'], {}, {
      signal: live.signal,
      run: (...args) => {
        const pending = run(...args)
        pending.child.stdout.once('data', () => live.abort())
        return pending
      },
    })
  assert.equal(output.execution.state, 'cancelled')
  assert.equal(output.execution.killed, true) // Observed direct-child kill, not descendant exit.
  assert.equal(output.stdout.toString(), 'before cancellation')
  assert.equal(output.execution.processTreeState, 'unverified')
})

test('API exception codes are not native exits; admitted isolated runner integer failures are retained', async () => {
  for (const name of ['AbortError', 'SecurityError']) {
    const result = await executeDshInstall('isolated-runner', [], {}, { run: async () => { throw new DOMException('API error', name) } })
    assert.equal(result.execution.exitCode, null)
    assert.equal(result.exitCode, 1)
  }
  for (const run of [() => { throw Object.assign(Error('native contract'), { code: 7 }) },
    async () => { throw Object.assign(Error('native contract'), { code: 7 }) }]) {
    const result = await executeDshInstall('isolated-runner', [], {}, { run })
    assert.equal(result.execution.exitCode, 7)
    assert.equal(result.exitCode, 7)
  }
})

test('failure receipts reference private bounded logs, preserve partial state and never echo CLI text', async t => {
  const f = await productFixture(t)
  f.setAction(async () => {
    await f.install()
    throw Object.assign(new Error('do not echo'), { code: 7, stdout: 'sensitive native stdout', stderr: 'sensitive native stderr' })
  })
  const result = await installerMain(f.args, f.context)
  assert.equal(result.status, 'failed-partial-state-retained'); assert.equal(result.execution.state, 'failed')
  assert.equal(result.userConfigurationStatus, 'observed-matching')
  assert.equal(result.rollbackAttempted, false); assert.equal(result.execution.retrySafe, false)
  for (const stream of ['stdout', 'stderr']) {
    const log = result.execution.output[stream]
    const bytes = await readFile(log.path)
    assert.equal(bytes.toString(), `sensitive native ${stream}`)
    assert.equal(sha(bytes), log.sha256)
    if (process.platform !== 'win32') assert.equal((await stat(log.path)).mode & 0o777, 0o600)
  }
  assert.ok(!JSON.stringify(result).includes('sensitive native'))
  assert.deepEqual(JSON.parse(await readFile(result.receiptFile)).execution, result.execution)
})

test('cancellation propagates through direct orchestration and cannot turn a partial installation into success', async t => {
  const f = await productFixture(t), cancellation = new AbortController()
  f.setAction(async () => { await f.install(); cancellation.abort() })
  const result = await installerMain(f.args, { ...f.context, signal: cancellation.signal })
  assert.equal(result.status, 'failed-partial-state-retained')
  assert.equal(result.execution.state, 'cancelled'); assert.equal(result.execution.retrySafe, false)
  assert.equal(result.readback.packageInstalled, true); assert.equal(result.rollbackAttempted, false)
  assert.equal(f.calls[0].options.signal.aborted, true)
})

test('unavailable readback means unverified preservation, and foreign partial ownership remains refused', async t => {
  const f = await fixture(t)
  f.setAction(async () => {
    await f.install()
    await f.put(f.manifestPath, json(f.manifest))
    throw Object.assign(new Error('partial'), { code: 1 })
  })
  const result = await applyDshInstallation(await planDshInstallation(f.options), f.options)
  assert.equal(result.status, 'failed-partial-state-retained')
  assert.equal(result.userConfigurationStatus, 'unverified')
  assert.equal(result.readback, null); assert.match(result.readbackError, /Foreign installed aggregate conflict/)
  await assert.rejects(planDshInstallation(f.options), /Foreign installed aggregate conflict/)
  assert.equal(f.calls.length, 1)
})

test('successful native exit does not approve workspace configuration drift', async t => {
  const f = await fixture(t)
  f.setAction(async () => {
    await f.install()
    await f.put(join(f.profileDir, 'pnpm-workspace.yaml'), 'minimumReleaseAgeExclude:\n  - example-package\n')
  })
  const result = await applyDshInstallation(await planDshInstallation(f.options), f.options)
  assert.equal(result.execution.state, 'completed')
  assert.equal(result.status, 'failed-partial-state-retained')
  assert.equal(result.userConfigurationStatus, 'changed')
  assert.equal(result.userConfigurationPreserved, false)
})

test('command logs cannot target host inputs or symlink directories before execution', async t => {
  const f = await fixture(t), plan = await planDshInstallation(f.options)
  for (const logDirectory of [f.home, dirname(f.paths.cli)])
    await assert.rejects(applyDshInstallation(plan, { ...f.options, logDirectory }), /overlap host inputs/)
  const target=join(f.root,'log target'),link=join(f.root,'log link')
  await mkdir(target); await symlink(target,link,'dir')
  await assert.rejects(applyDshInstallation(plan,{...f.options,logDirectory:link}),/Symlink directory rejected/)
  assert.equal(f.calls.length,0)
})

async function windowsSecurityFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-windows-security-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  // Use the actual ACL policy with controlled OS facts on Linux. Only platform
  // selection and native inspection are synthetic; no actual Windows proof.
  const source = new URL('../src/', import.meta.url), facts = join(root, 'facts.json')
  await writeFile(facts, json({ mode: 'private' }))
  await writeFile(join(root, 'windows-private-storage.mjs'), await readFile(new URL('windows-private-storage.mjs', source)))
  await writeFile(join(root, 'windows-native-platform.mjs'), `
    import {readFile} from 'node:fs/promises';
    const sid='S-1-5-21-101-202-303-1001';
    export const windowsCurrentSid=async()=>sid;
    export async function windowsSecurityFacts(paths) {
      const {mode}=JSON.parse(await readFile(new URL('./facts.json',import.meta.url)));
      const privateAcl='O:'+sid+'G:SYD:P(A;OICI;FA;;;'+sid+')';
      const target=mode==='public'?privateAcl+'(A;;FR;;;WD)':mode==='inherited'?privateAcl.replace('D:P','D:AI'):privateAcl;
      return paths.flatMap((_,index)=>['16',index===0?target:privateAcl]);
    }
    export const windowsPowerShell=()=>{throw Error('Unexpected permission mutation or inspection')};
    export const windowsSystemTool=()=>{throw Error('Unexpected ACL tool invocation')};
    export const powerShellLiteral=String;
  `)
  for (const name of ['npm-installer-dsh.mjs', 'npm-installer.mjs']) {
    const text = (await readFile(new URL(name, source), 'utf8'))
      .replace(/process\.platform\s*===\s*'win32'/g, 'true')
      .replace(/from '\.\/([^']+)'/g, (match, dependency) => dependency === 'windows-private-storage.mjs'
        ? match : `from '${new URL(dependency, source).href}'`)
    await writeFile(join(root, name), text)
  }
  return { dsh: await import(pathToFileURL(join(root, 'npm-installer-dsh.mjs'))),
    main: await import(pathToFileURL(join(root, 'npm-installer.mjs'))),
    setMode: mode => writeFile(facts, json({ mode })), facts }
}

test('Windows receipt and diagnostic boundaries reject public or inherited ACLs without executing or repairing them', async t => {
  const f = await productFixture(t), security = await windowsSecurityFixture(t)
  const logDirectory = join(f.receiptRoot, 'receipts'); await mkdir(logDirectory)
  const adapter = await security.dsh.createDshInstallerAdapter(f.adapterOptions)
  const plan = await security.dsh.planDshInstallation({ ...f.options, adapter })
  for (const mode of ['public', 'inherited']) {
    await security.setMode(mode)
    const before = await readFile(security.facts)
    const rejected = mode === 'public' ? /another principal/ : /inheritance mismatch/
    await assert.rejects(security.main.installerMain([...f.args, '--dry-run'], f.context), rejected)
    await assert.rejects(security.dsh.applyDshInstallation(plan, { adapter, logDirectory }), rejected)
    assert.deepEqual(await readFile(security.facts), before)
    assert.deepEqual(await readdir(logDirectory), [])
  }
  assert.equal(f.calls.length, 0)
})

test('Windows raw diagnostics require private ACLs again after the native command', async t => {
  const f = await productFixture(t), security = await windowsSecurityFixture(t)
  const logDirectory = join(f.receiptRoot, 'logs'); await mkdir(logDirectory)
  const adapter = await security.dsh.createDshInstallerAdapter(f.adapterOptions)
  const plan = await security.dsh.planDshInstallation({ ...f.options, adapter })
  f.setAction(async () => { await f.install(); await security.setMode('public') })
  const result = await security.dsh.applyDshInstallation(plan, { adapter, logDirectory })
  assert.equal(f.calls.length, 1)
  assert.equal(result.execution.state, 'completed')
  assert.equal(result.status, 'failed-partial-state-retained')
  assert.equal(result.diagnosticError, 'Error')
  assert.equal(result.execution.output.stdout.path, undefined)
  assert.deepEqual(await readdir(logDirectory), [])
})

test('Windows private diagnostics reuse the shared ACL policy and retain bounded output', async t => {
  const f = await productFixture(t), security = await windowsSecurityFixture(t)
  const logDirectory = join(f.receiptRoot, 'logs'); await mkdir(logDirectory)
  const adapter = await security.dsh.createDshInstallerAdapter(f.adapterOptions)
  f.setAction(async () => {
    await f.install()
    throw Object.assign(Error('not echoed'), { code: 7, stdout: 'private stdout', stderr: 'private stderr' })
  })
  const result = await security.dsh.applyDshInstallation(await security.dsh.planDshInstallation({ ...f.options, adapter }), { adapter, logDirectory })
  assert.equal(result.diagnosticError, null)
  assert.equal(result.execution.state, 'failed')
  for (const stream of ['stdout', 'stderr']) {
    const log = result.execution.output[stream]
    assert.equal(await readFile(log.path, 'utf8'), `private ${stream}`)
    assert.equal(sha(await readFile(log.path)), log.sha256)
  }
  assert.ok(!JSON.stringify(result).includes('private stdout'))
})
