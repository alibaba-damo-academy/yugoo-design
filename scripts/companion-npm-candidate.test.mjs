import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFile, spawnSync } from 'node:child_process'
import { watch } from 'node:fs'
import { promisify } from 'node:util'
import { buildCompanionCandidate, copyCompanionRegistration, OFFICIAL_SMALL_INPUTS } from './companion-npm-candidate.mjs'
import * as candidateAssembly from './companion-npm-candidate.mjs'
import { BUNDLED_LICENSE_PINS, BUNDLED_JS_LICENSE_NOTICE, BROWSER_LICENSE_NOTICE } from './companion-bundled-license.mjs'
import { preparePanelAuthoringMaterial } from './companion-authoring-material.mjs'
import { copyNativeExecutionReference } from '../packages/companion/build-plugin.mjs'
import { stageNativeInventoryFixture } from './test-fixtures/companion-native-inventory.mjs'

const workspace = fileURLToPath(new URL('../', import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const hosts = { codex: '.codex-plugin', 'claude-code': '.claude-plugin', qoder: '.qoder-plugin' }
let authoring
async function setup(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'companion npm fixture '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source assets')
  const put = async (path, value) => { await mkdir(dirname(join(source, path)), { recursive: true }); await writeFile(join(source, path), value) }
  await put('shared/scripts/design.mjs', "import { fileURLToPath } from 'node:url'\nconsole.log(JSON.stringify({entry:import.meta.url, root:fileURLToPath(new URL('../',import.meta.url)), cwd:process.cwd(), args:process.argv.slice(2),fixture:true}))\n")
  await put('shared/web/index.html', '<!doctype html><title>fixture only</title>')
  await put('shared/knowledge/runtime.mjs', 'export const fixture = true\n')
  await put('shared/knowledge/cli-lifecycle.mjs', 'export const fixture = true\n')
  await put('shared/knowledge/embedding-worker.js', '// fixture, no inference\n')
  await put('shared/kits/web_app/kit.yaml', 'version: 1\nmounts: []\n')
  await stageNativeInventoryFixture(join(source, 'shared'))
  authoring ??= preparePanelAuthoringMaterial(workspace)
  await put('shared/authoring/panel-components.json', (await authoring).bytes)
  for (const [host, directory] of Object.entries(hosts)) {
    await put(`overlays/${host}/${directory}/plugin.json`, JSON.stringify({ name: 'yugoo-design', version: '0.1.0+mutable', skills: './skills/', mcpServers: './.mcp.json' }))
    const overlay = { codex: 'plugin', 'claude-code': 'plugin-claude', qoder: 'plugin-qoder' }[host]
    await put(`overlays/${host}/.mcp.json`, await readFile(join(workspace, 'packages/companion', overlay, 'design-system/.mcp.json')))
    await put(`overlays/${host}/skills/yugoo/SKILL.md`, 'Fixture method')
    await put(`overlays/${host}/skills/design-panel/SKILL.md`, 'Fixture panel method')
    await put(`overlays/${host}/skills/design-panel/native-execution.md`, 'Fixture native contract')
  }
  const officialInputRoot = join(root, 'official input fixture')
  for (const path of [...Object.keys(OFFICIAL_SMALL_INPUTS.files), 'provenance.json']) {
    await mkdir(dirname(join(officialInputRoot, path)), { recursive: true })
    await cp(join(workspace, 'scripts/test-fixtures/official-dsh-json', path), join(officialInputRoot, path))
  }
  const options = { payloadSource: source, destination: join(root, 'npm package with spaces'), licenseRoot: workspace, officialInputRoot,
    scope: '@fixture-design-release', version: '0.1.0-review.1', ladybugVersion: '0.19.1-walfix.1', fixture: true }
  return { root, source, options, put }
}

test('explicit pinned release map emits a local successor without changing the maintained default', async t => {
  const { root, options } = await setup(t)
  const releaseHostsFile = join(root, 'selected-hosts.json')
  const config = { schemaVersion: 1, hosts: { dsh: { aggregatePackage: '@yugoo-design/dsh-design-system-dsh',
    aggregateVersion: '0.1.0-r1-local.20261017.2', registry: 'https://127.0.0.1:18443' } } }
  const bytes = Buffer.from(JSON.stringify(config) + '\n'), releaseHostsSha256 = sha(bytes)
  const original = await readFile(join(workspace, 'release/release-hosts.json'))
  await writeFile(releaseHostsFile, bytes)
  const result = await buildCompanionCandidate({ ...options, releaseHostsFile, releaseHostsSha256 })
  assert.deepEqual(await readFile(join(result.target, 'release-hosts.json')), bytes)
  assert.deepEqual(result.inventory.releaseHostsInput, { path: releaseHostsFile, sha256: releaseHostsSha256 })
  assert.equal(result.inventory.assets['release-hosts.json'], releaseHostsSha256)
  assert.deepEqual(await readFile(join(workspace, 'release/release-hosts.json')), original)
  assert.equal(result.inventory.publishReady, false)
})

test('external release maps require canonical regular pinned input and the existing strict schema', async t => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'companion-release-map-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const releaseHostsFile = join(root, 'selected.json')
  const config = { schemaVersion: 1, hosts: { dsh: { aggregatePackage: '@yugoo-design/dsh-design-system-dsh', aggregateVersion: '0.1.0-r1-local.20261017.1', registry: 'https://127.0.0.1:18443' } } }
  const write = async value => { const bytes = JSON.stringify(value); await writeFile(releaseHostsFile, bytes); return sha(bytes) }
  const releaseHostsSha256 = await write(config), input = { licenseRoot: root, releaseHostsFile, releaseHostsSha256 }
  assert.equal((await candidateAssembly.readCompanionReleaseHosts(input)).selection.aggregateSelector, '@yugoo-design/dsh-design-system-dsh@0.1.0-r1-local.20261017.1')
  for (const bad of [
    { ...input, releaseHostsFile: 'relative.json' },
    { ...input, releaseHostsFile: undefined },
    { ...input, releaseHostsSha256: undefined },
    { ...input, releaseHostsSha256: '0'.repeat(64) },
  ]) await assert.rejects(candidateAssembly.readCompanionReleaseHosts(bad))
  const alias = join(root, 'alias.json'); await symlink(releaseHostsFile, alias)
  await assert.rejects(candidateAssembly.readCompanionReleaseHosts({ ...input, releaseHostsFile: alias }))
  for (const mutate of [
    value => { value.hosts.dsh.registry = 'http://127.0.0.1:18443' },
    value => { value.hosts.dsh.registry = 'https://user:password@127.0.0.1:18443' },
    value => { value.hosts.dsh.aggregateVersion = 'latest' },
    value => { value.extra = true },
  ]) {
    const invalid = structuredClone(config); mutate(invalid)
    await assert.rejects(candidateAssembly.readCompanionReleaseHosts({ ...input, releaseHostsSha256: await write(invalid) }))
  }
  await write(config)
  await writeFile(releaseHostsFile, JSON.stringify({ ...config, schemaVersion: 2 }))
  await assert.rejects(candidateAssembly.readCompanionReleaseHosts(input), /changed|hash|drift/i)
})

test('assembly refuses a release map changed after output staging starts', async t => {
  const { root, options } = await setup(t)
  const releaseHostsFile = join(root, 'selected-hosts.json')
  const original = await readFile(join(workspace, 'release/release-hosts.json'))
  await writeFile(releaseHostsFile, original)
  let observer
  const mutated = new Promise((resolveMutation, rejectMutation) => {
    observer = watch(root, { persistent: false }, (_event, name) => {
      if (String(name) !== 'npm package with spaces') return
      observer.close()
      writeFile(releaseHostsFile, original.toString() + '\n').then(resolveMutation, rejectMutation)
    })
    observer.on('error', rejectMutation)
  })
  t.after(() => observer.close())
  await assert.rejects(buildCompanionCandidate({ ...options, releaseHostsFile, releaseHostsSha256: sha(original) }), /Release hosts input hash changed/)
  await mutated
  await assert.rejects(readFile(join(options.destination, 'release-manifest.json')), { code: 'ENOENT' })
})
function execute(path, args, cwd, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [path, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } })
  assert.equal(result.status, expectedStatus, result.stderr)
  return JSON.parse(result.stdout)
}

// Model each overlay's documented root-expansion rule, then launch its actual Node command.
// This does not call a host plugin installer or certify that host's MCP implementation.
async function executeMcpMetadata(registrationRoot, host, invocationCwd) {
  const metadata = JSON.parse(await readFile(join(registrationRoot, '.mcp.json'))).mcpServers['design-system']
  assert.equal(metadata.command, 'node')
  const variable = { 'claude-code': '${CLAUDE_PLUGIN_ROOT}', qoder: '${QODER_PLUGIN_ROOT}' }[host]
  const expand = value => {
    const expanded = variable ? value.replaceAll(variable, registrationRoot) : value
    assert.doesNotMatch(expanded, /\$\{/u, 'Unknown plugin-root expansion')
    return expanded
  }
  const cwd = metadata.cwd === undefined ? invocationCwd : resolve(registrationRoot, expand(metadata.cwd))
  const [entry, ...args] = metadata.args.map(expand)
  return execute(isAbsolute(entry) ? entry : resolve(cwd, entry), args, cwd)
}

test('candidate uses fixed versions and deterministic inventory; source and license bytes are preserved', async t => {
  const { root, source, options } = await setup(t)
  const originalNotice = await readFile(join(workspace, 'NOTICE'))
  const first = await buildCompanionCandidate(options)
  const second = await buildCompanionCandidate({ ...options, destination: join(root, 'second npm package') })
  assert.deepEqual(first.inventory, second.inventory)
  const manifest = JSON.parse(await readFile(join(first.target, 'package.json'), 'utf8'))
  assert.ok(manifest.files.includes('licenses'), 'npm publication must include candidate license materials')
  for (const path of ['glur/LICENSE', 'inherits/LICENSE', 'multimath/LICENSE', 'object-assign/license', 'webworkify/LICENSE', 'rolldown/LICENSE', 'rolldown/THIRD-PARTY-LICENSE']) {
    const packedPath = 'licenses/bundled-js/pica-embedded/' + path
    const original = await readFile(join(workspace, 'scripts/test-fixtures/pica-worker/source', path))
    assert.deepEqual(await readFile(join(first.target, packedPath)), original)
    assert.equal(first.inventory.assets[packedPath], sha(original))
    assert.equal(first.inventory.bundledJsLicenseMaterials.assets[packedPath], sha(original))
  }
  assert.deepEqual(await readFile(join(first.target, 'licenses/bundled-js/pica-embedded/fixture-notice-map.json')),
    await readFile(join(workspace, 'scripts/test-fixtures/fixture-notice-map.json')))
  assert.match(manifest.description, /Assembled Companion review candidate/)
  const review = manifest['x-design-release-review']
  assert.equal(review.payloadAssembled, true)
  assert.equal(Object.hasOwn(review, 'payloadImplemented'), false)
  assert.equal(review.installImplemented, false)
  assert.equal(review.releaseValidated, false)
  assert.equal(review.fixture, true)
  assert.equal(review.publishReady, false)
  assert.equal(first.inventory.publishReady, false)
  assert.equal(first.inventory.dependencyLicensesVerified, false)
  assert.equal(first.inventory.officialInputs.networkAvailabilityVerified, false)
  assert.equal(first.inventory.officialInputs.usedByBuildVerified, false)
  assert.equal(first.inventory.officialInputs.commit, 'cd5ef8148158c3a752a658978873241fdf8e2bbc')
  for (const [host, directory] of Object.entries(hosts)) {
    const candidate = JSON.parse(await readFile(join(first.target, 'payload/overlays', host, directory, 'plugin.json')))
    assert.equal(candidate.version, options.version)
    assert.equal(JSON.parse(await readFile(join(source, 'overlays', host, directory, 'plugin.json'))).version, '0.1.0+mutable')
    if (host !== 'codex') {
      const normal = join(root, 'normal-' + host)
      const method = await copyNativeExecutionReference(normal, { host })
      assert.deepEqual(await readFile(join(first.target, 'payload/overlays', host, 'skills/yugoo/native-execution.md')), await readFile(method))
      assert.ok(first.inventory.assets[`payload/overlays/${host}/skills/yugoo/native-execution.md`])
    }
  }
  for (const name of first.inventory.ownLicenseFiles) {
    const expected = name === 'NOTICE'
      ? Buffer.concat([originalNotice, Buffer.from(BUNDLED_JS_LICENSE_NOTICE), Buffer.from(BROWSER_LICENSE_NOTICE)])
      : await readFile(join(workspace, name))
    assert.deepEqual(await readFile(join(first.target, name)), expected)
    assert.deepEqual(await readFile(join(second.target, name)), expected)
  }
  assert.deepEqual(await readFile(join(workspace, 'NOTICE')), originalNotice)
  assert.deepEqual(await readFile(join(first.target, 'licenses/DSH-LICENSE')), await readFile(join(options.officialInputRoot, 'LICENSE')))
  for (const [path, hash] of Object.entries(BUNDLED_LICENSE_PINS)) {
    assert.deepEqual(await readFile(join(first.target, 'licenses/third-party', path)), await readFile(join(workspace, 'third-party/companion', path)))
    assert.equal(first.inventory.assets[`licenses/third-party/${path}`], hash)
  }
  assert.equal(first.inventory.bundledLicenseMaterials.releaseLicenseAcceptance, false)
  assert.equal(first.inventory.bundledLicenseMaterials.elkPreferredSourceCorrespondenceVerified, false)
  const releaseHosts=await readFile(join(workspace,'release/release-hosts.json'))
  assert.deepEqual(await readFile(join(first.target,'release-hosts.json')),releaseHosts)
  assert.ok(manifest.files.includes('release-hosts.json'))
  assert.equal(first.inventory.assets['release-hosts.json'],createHash('sha256').update(releaseHosts).digest('hex'))
  assert.ok(first.inventory.assets['bin/design-system.mjs'])
  const selection=execute(join(first.target,'bin/design-system.mjs'),['install'],root,2)
  assert.equal(selection.status,'host-selection-required'); assert.equal(selection.hostRegistered,false)
  assert.deepEqual(selection.hosts,['dsh','codex','codex-desktop','claude-code','qoder','qwenwork','workbuddy'])
  for (const file of ['bin/npm-codex-desktop-source.mjs','bin/npm-installer-codex-desktop.mjs'])
    assert.ok(first.inventory.assets[file], 'Acquired npm must contain its desktop preparation dependency: ' + file)
  assert.deepEqual(review.desktopPreparation['codex-desktop'], {
    source: 'npm-backed', scope: 'owned-local-source-and-personal-catalog', nativeActivationRequired: true,
  })
  const nodeSelection=execute(join(first.target,'bin/design-system.mjs'),['resolve-node','--node-executable',process.execPath],root,0)
  assert.equal(nodeSelection.kind,'node-runtime-selection'); assert.equal(nodeSelection.verified,true)
  assert.equal(nodeSelection.version,process.versions.node); assert.match(nodeSelection.sha256,/^[a-f0-9]{64}$/)
  assert.equal(nodeSelection.ownership,'external'); assert.equal(nodeSelection.installed,false)
  const desktopPending=execute(join(first.target,'bin/design-system.mjs'),['install','--host','workbuddy'],root,2)
  assert.equal(desktopPending.status,'inputs-required'); assert.equal(desktopPending.usable,false)
  assert.ok(first.inventory.assets['bin/npm-installer-dsh.mjs'])
  for (const name of ['npm-installer-dsh-desktop.mjs', 'npm-installer-paths.mjs', 'npm-agent-installation.mjs', 'npm-node-runtime.mjs', 'npm-node-registration.mjs', 'windows-private-storage.mjs', 'windows-native-platform.mjs']) {
    assert.ok(first.inventory.assets['bin/' + name])
    assert.deepEqual(await readFile(join(first.target, 'bin', name)), await readFile(join(workspace, 'packages/companion/src', name)))
  }
  assert.ok(first.inventory.assets['bin/npm-installer-claude.mjs'])
  assert.deepEqual(await readFile(join(first.target,'bin/npm-desktop-preparation.mjs')),await readFile(join(workspace,'packages/companion/src/npm-desktop-preparation.mjs')))
  const desktopMaterials=JSON.parse(await readFile(join(first.target,'payload/desktop-preparation/materials.json'),'utf8'))
  assert.equal(desktopMaterials.scope,'desktop-preparation-only')
  for(const path of ['qwenwork-template/skills/yugoo/native-execution.md','src/windows-native-platform.mjs','hosts/workbuddy/design-SKILL.md'])
    assert.equal(createHash('sha256').update(await readFile(join(first.target,'payload/desktop-preparation',path))).digest('hex'),desktopMaterials.files[path])
  assert.deepEqual(await readFile(join(first.target,'bin/npm-installer-claude.mjs')),await readFile(join(workspace,'packages/companion/src/npm-installer-claude.mjs')))

  assert.deepEqual(await readFile(join(first.target, 'bin/npm-installer-dsh.mjs')),
    await readFile(join(workspace, 'packages/companion/src/npm-installer-dsh.mjs')))
  // Exercise the generated bin's result handling separately from real host
  // execution. Keep both candidates and their inventories unchanged.
  const wrapperFixture = join(root, 'isolated wrapper fixture')
  await mkdir(wrapperFixture)
  await cp(join(first.target, 'bin/design-system.mjs'), join(wrapperFixture, 'design-system.mjs'))
  await writeFile(join(wrapperFixture, 'installer.mjs'),
    'export async function installerMain(args) { return {host:"dsh",status:args[0],runtimeMounted:false} }\n')
  for (const [status, expectedExit] of [['registered-config-parsed', 0], ['failed-partial-state-retained', 1]]) {
    const result = spawnSync(process.execPath, [join(wrapperFixture, 'design-system.mjs'), status],
      { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } })
    assert.equal(result.status, expectedExit, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { host: 'dsh', status, runtimeMounted: false })
  }
  for (const [status, expectedExit] of [['host-selection-required', 2], ['inputs-required', 2], ['runtime-not-ready', 1], ['unsupported-host', 1]]) {
    const result = spawnSync(process.execPath, [join(wrapperFixture, 'design-system.mjs'), status], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, expectedExit, result.stderr)
  }
  await writeFile(join(wrapperFixture, 'installer.mjs'),
    'export async function installerMain() { throw Object.assign(Error("native failed"), {installation:{host:"claude-code",registration:"failed-or-unconfirmed",receiptFile:"retained-receipt.json"}}) }\n')
  const failed = spawnSync(process.execPath, [join(wrapperFixture, 'design-system.mjs'), 'install'], { cwd: root, encoding: 'utf8' })
  assert.equal(failed.status, 1)
  assert.equal(JSON.parse(failed.stderr).installation.receiptFile, 'retained-receipt.json')
  await writeFile(join(wrapperFixture, 'installer.mjs'), `export async function installerMain(args,{signal}) {
    await new Promise(resolve=>{
      const keepAlive=setInterval(()=>{},1000);
      const stop=()=>{clearInterval(keepAlive);resolve()};
      if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
      process.stdout.write('ready\\n');
    });
    return {status:'failed-partial-state-retained',execution:{state:'cancelled',processTreeState:'unverified'}};
  }`)
  const cancelled = promisify(execFile)(process.execPath,
    [join(wrapperFixture, 'design-system.mjs'), 'install', '--host=dsh'], { timeout: 3000 })
  cancelled.child.stdout.once('data', () => cancelled.child.kill('SIGINT'))
  await assert.rejects(cancelled, error => {
    assert.equal(error.code, 1)
    assert.equal(JSON.parse(error.stdout.trim().split('\n').at(-1)).execution.state, 'cancelled')
    return true
  })
  assert.equal(Object.keys(first.inventory.assets).some(path => path.includes('node_modules')), false)
})

test('missing or changed component materials reject before candidate creation', async t => {
  for (const mode of ['missing', 'changed']) {
    const { root, options } = await setup(t)
    const licenseRoot = join(root, 'license fixture')
    await mkdir(join(licenseRoot, 'third-party'), { recursive: true })
    for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await cp(join(workspace, name), join(licenseRoot, name))
    await cp(join(workspace, 'third-party/companion'), join(licenseRoot, 'third-party/companion'), { recursive: true })
    await mkdir(join(licenseRoot, 'scripts'))
    await cp(join(workspace, 'scripts/graph-layout-worker.ts'), join(licenseRoot, 'scripts/graph-layout-worker.ts'))
    const input = join(licenseRoot, 'third-party/companion/elkjs-0.10.2/LICENSE.md')
    if (mode === 'missing') await rm(input)
    else await writeFile(input, 'altered license')
    await assert.rejects(buildCompanionCandidate({ ...options, licenseRoot }))
    await assert.rejects(lstat(options.destination), { code: 'ENOENT' })
  }
})

test('candidate refuses a missing standalone lifecycle asset before output creation', async t => {
  const { source, options } = await setup(t)
  await rm(join(source, 'shared/knowledge/cli-lifecycle.mjs'))
  await assert.rejects(buildCompanionCandidate(options), /Missing candidate asset: shared\/knowledge\/cli-lifecycle.mjs/)
  await assert.rejects(lstat(options.destination), {code:'ENOENT'})
})

test('official engine selection keeps package, payload manifest and inventory consistent', async t => {
  const { options, put, root } = await setup(t)
  const { ladybugVersion: _legacy, ...official } = options
  official.ladybugDependency = '0.21.1'
  const dependencies = { '@ladybugdb/wasm-core': '0.21.1', '@huggingface/transformers': '3.8.1', 'onnxruntime-common': '1.21.0', undici: '8.10.2' }
  await assert.rejects(buildCompanionCandidate(official), /requires a knowledge runtime manifest/u)
  await assert.rejects(lstat(official.destination), { code: 'ENOENT' })
  await put('shared/knowledge/runtime-manifest.json', JSON.stringify({ runtimeDependencies: dependencies }))
  const { target, inventory } = await buildCompanionCandidate(official)
  assert.deepEqual(JSON.parse(await readFile(join(target, 'package.json'))).dependencies, dependencies)
  assert.deepEqual(inventory.dependencies, dependencies)
  assert.equal(inventory.ladybugDependency, '0.21.1')
  assert.deepEqual(JSON.parse(await readFile(join(target, 'payload/shared/knowledge/runtime-manifest.json'))).runtimeDependencies, dependencies)
  assert.equal(inventory.publishReady, false)
  assert.equal(inventory.fixture, true)
  const normal = { ...official, fixture: false, scope: '@example-release', packageName: '@example-release/yugoo-design-companion', version: '1.0.0-rc.1', destination: join(root, 'explicit unpublished candidate') }
  const assembled = await buildCompanionCandidate(normal)
  const manifest = JSON.parse(await readFile(join(assembled.target, 'package.json')))
  assert.equal(manifest.name, normal.packageName)
  assert.equal(manifest.version, normal.version)
  assert.deepEqual(manifest.dependencies, dependencies)
  assert.equal(manifest['x-design-release-review'].fixture, false)
  assert.equal(manifest['x-design-release-review'].releaseValidated, false)
  assert.equal(assembled.inventory.fixture, false)
  assert.equal(assembled.inventory.publishReady, false)
  assert.deepEqual(assembled.inventory.dependencies, dependencies)
  const candidateCopy = await readFile(join(assembled.target, 'README.md'), 'utf8')
  assert.match(candidateCopy, /unpublished/iu)
  assert.match(candidateCopy, /ONNXRUNTIME_NODE_INSTALL_CUDA=skip/u)
  assert.match(candidateCopy, /npm install --ignore-scripts=false --save-exact/u)
  assert.match(candidateCopy, /before.*(?:acquisition|install)/iu)
  assert.match(candidateCopy, /bare npm\/npx.*not.*automatically/iu)
  const beta = await buildCompanionCandidate({ ...normal, distribution: 'beta', version: '0.1.0-beta.1', destination: join(root, 'explicit beta delivery') })
  const betaManifest = JSON.parse(await readFile(join(beta.target, 'package.json')))
  assert.equal(betaManifest['x-design-release-review'].distribution, 'beta')
  assert.equal(betaManifest['x-design-release-review'].fixture, false)
  assert.equal(betaManifest['x-design-release-review'].releaseValidated, false)
  assert.deepEqual(betaManifest.publishConfig, { access: 'public', tag: 'beta' })
  assert.equal(beta.inventory.publishReady, false)
  const betaCopy = await readFile(join(beta.target, 'README.md'), 'utf8')
  assert.match(betaCopy, /ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --ignore-scripts=false --save-exact @example-release\/yugoo-design-companion@0\.1\.0-beta\.1/)
  assert.match(betaCopy, /\$env:ONNXRUNTIME_NODE_INSTALL_CUDA/u)
  assert.doesNotMatch(betaCopy, /npm install --ignore-scripts\s/u)
  assert.doesNotMatch(betaCopy, /unpublished|tarball|<package-selector>/iu)
  const maintained = await readFile(join(workspace, 'packages/companion/README.md'), 'utf8')
  const section = maintained.split('<!-- npm-package-guide:start -->')[1].split('<!-- npm-package-guide:end -->')[0].trim()
  assert.equal(betaCopy, `# Yugoo Design Companion — beta\n\nPackage: \`${normal.packageName}@0.1.0-beta.1\`.\n\n` + section.replaceAll('<package-selector>', `${normal.packageName}@0.1.0-beta.1`) + '\n')
  assert.equal(beta.inventory.readmeSource.sourceSha256, sha(maintained))
  assert.equal(beta.inventory.readmeSource.sectionSha256, sha(section))
  const hostGuide = await readFile(join(workspace, 'packages/companion/HOSTS.md'), 'utf8')
  const prompts = [...hostGuide.matchAll(/```text\n([\s\S]*?)\n```/gu)].map(match => match[1])
  assert.equal(prompts.length, 2)
  for (const prompt of prompts) {
    assert.ok(prompt.indexOf('ONNXRUNTIME_NODE_INSTALL_CUDA=skip') >= 0)
    assert.ok(prompt.indexOf('ONNXRUNTIME_NODE_INSTALL_CUDA=skip') < prompt.indexOf('https://registry.npmjs.org'))
  }
  for (const changes of [{ fixture: true }, { version: '0.1.0' }, { version: '0.1.0-rc.1' }, { distribution: 'published' }]) {
    const destination = join(root, 'refused delivery mode')
    await assert.rejects(buildCompanionCandidate({ ...normal, distribution: 'beta', version: '0.1.0-beta.1', ...changes, destination }), /fixture|Distribution|beta prerelease/)
    await assert.rejects(lstat(destination), { code: 'ENOENT' })
  }
  for (const [changes, pattern] of [
    [{ packageName: undefined }, /explicit npm package name/u],
    [{ packageName: '@other/yugoo-design-companion' }, /match the explicit scope/u],
    [{ scope: '@fixture-example', packageName: '@fixture-example/companion' }, /Fixture scopes/u],
    [{ ladybugDependency: 'npm:@example-release/ladybug@0.21.1' }, /official exact Ladybug/u],
    [{ fixture: undefined }, /Explicit fixture/u],
  ]) {
    const destination = join(root, 'rejected non-fixture candidate')
    await assert.rejects(buildCompanionCandidate({ ...normal, ...changes, destination }), pattern)
    await assert.rejects(lstat(destination), { code: 'ENOENT' })
  }
  const mismatched = join(root, 'must not create mismatched candidate')
  await put('shared/knowledge/runtime-manifest.json', JSON.stringify({ runtimeDependencies: { ...dependencies, '@ladybugdb/wasm-core': 'npm:@fixture/engine@0.19.1' } }))
  await assert.rejects(buildCompanionCandidate({ ...official, destination: mismatched }), /must match selected/u)
  await assert.rejects(lstat(mismatched), { code: 'ENOENT' })
  await assert.rejects(buildCompanionCandidate({ ...options, ladybugDependency: '0.21.1', destination: mismatched }), /Conflicting Ladybug/u)
  await assert.rejects(buildCompanionCandidate({ ...official, ladybugDependency: 'file:/tmp/engine', destination: mismatched }), /Explicit Ladybug/u)
})

test('each relative overlay shim actually imports shared entry after relocation and cwd change, with spaces', async t => {
  const { root, options } = await setup(t)
  const { target } = await buildCompanionCandidate(options)
  const relocated = join(root, 'relocated npm root with spaces')
  await rename(target, relocated)
  const cwd = join(root, 'unrelated cwd'); await mkdir(cwd)
  for (const host of Object.keys(hosts)) {
    const output = execute(join(relocated, 'payload/overlays', host, 'scripts/design.mjs'), ['mcp'], cwd)
    assert.equal(output.root, join(relocated, 'payload/shared/'))
    assert.equal(output.cwd, cwd)
    assert.deepEqual(output.args, ['mcp'])
  }
})

test('copied registration imports the fixed npm root and receipt matches entry, independent of cwd', async t => {
  const { root, options } = await setup(t)
  const { target } = await buildCompanionCandidate(options)
  for (const host of Object.keys(hosts)) {
    const copied = join(root, `copied ${host} registration`)
    const receipt = await copyCompanionRegistration({ npmRoot: target, destination: copied, host })
    const output = execute(join(copied, 'scripts/design.mjs'), ['serve'], root)
    assert.equal(output.entry, receipt.sharedEntry)
    assert.equal(receipt.npmRoot, target)
    assert.equal(receipt.version, options.version)
    assert.equal(receipt.installed, false)
    assert.deepEqual(JSON.parse(await readFile(join(copied, 'candidate-registration-receipt.json'))), receipt)
  }
})

test('real overlay MCP metadata launches relative and copied registrations from another cwd', async t => {
  const { root, options } = await setup(t)
  const { target } = await buildCompanionCandidate(options)
  const relocated = join(root, 'metadata npm root with spaces')
  await rename(target, relocated)
  const invocationCwd = join(root, 'other metadata cwd'); await mkdir(invocationCwd)
  for (const host of Object.keys(hosts)) {
    const registration = join(relocated, 'payload/overlays', host)
    const output = await executeMcpMetadata(registration, host, invocationCwd)
    assert.equal(output.root, join(relocated, 'payload/shared/'))
    assert.deepEqual(output.args, ['mcp'])
    const copied = join(root, `metadata copied ${host}`)
    const receipt = await copyCompanionRegistration({ npmRoot: relocated, destination: copied, host })
    const copiedOutput = await executeMcpMetadata(copied, host, invocationCwd)
    assert.equal(copiedOutput.entry, receipt.sharedEntry)
    assert.deepEqual(copiedOutput.args, ['mcp'])
    assert.equal(copiedOutput.cwd, host === 'codex' ? copied : invocationCwd)
  }
})

test('public bin routes pending Companion plans and requires explicit DSH and Claude inputs', async t => {
  const { root, options } = await setup(t)
  const { target } = await buildCompanionCandidate(options)
  const relocated = join(root, 'installer relocated with spaces')
  await rename(target, relocated)
  const bin = join(relocated, 'bin/design-system.mjs')
  const userRoot = join(root, 'isolated home'); await mkdir(userRoot)
  const receipts = join(root, 'external receipts')
  const before = await readFile(join(relocated, 'release-manifest.json'))
  // Exercise the shipped bin, retaining the existing host overlays and shared shim.
  for(const host of ['claude-code','qoder']) {
    const prefix=host==='claude-code'?'claude':'qoder'
    const pluginRoot=join(relocated,'payload/overlays',host)
    const original=join(workspace,'packages/companion',`plugin-${prefix}`,'design-system')
    await cp(join(original,'hooks'),join(pluginRoot,'hooks'),{recursive:true})
    await cp(join(original,'scripts'),join(pluginRoot,'scripts'),{recursive:true})
    if(host==='qoder')await cp(join(original,'commands'),join(pluginRoot,'commands'),{recursive:true})
    for(const file of ['native-hook-transport.mjs', 'windows-private-storage.mjs', 'windows-native-platform.mjs',`${prefix}-connection.mjs`,`${prefix}-hook-transport.mjs`])
      await cp(join(workspace,'packages/companion/src',file),join(pluginRoot,'scripts',file))
    await writeFile(join(pluginRoot,'skills/yugoo/native-execution.md'),'fixture shared contract')
    const result=execute(bin,['plugin-directory','--host',host],root)
    assert.equal(result.status,'plugin-directory-ready')
    assert.deepEqual(result.launch.args,['--plugin-dir',pluginRoot])
    assert.equal(result.hostRegistered,false)
    assert.deepEqual((await executeMcpMetadata(pluginRoot,host,root)).args,['mcp'])
  }
  for (const host of [...Object.keys(hosts).filter(host=>!['claude-code','qoder'].includes(host)), 'qwenwork']) {
    const output = execute(bin, ['install', '--dry-run', '--host', host, '--receipt-dir', receipts, '--user-root', userRoot], root)
    assert.equal(output.hostRegistered, false)
    assert.equal(output.applySupported, false)
    assert.equal(output.registrationPending, true)
    assert.equal(output.route, 'companion-registration')
    assert.equal(output.npmRoot, relocated)
    assert.equal(JSON.parse(await readFile(output.planFile)).planSha256, output.planSha256)
  }
  const desktop=spawnSync(process.execPath,[bin,'install','--dry-run','--host','codex-desktop','--receipt-dir',receipts,'--user-root',userRoot],{cwd:root,encoding:'utf8'})
  assert.notEqual(desktop.status,0);assert.match(desktop.stderr,/New immutable --destination required/)
  const dshReceipts=join(root,'DSH rejected receipts')
  const qoder=spawnSync(process.execPath,[bin,'install','--dry-run','--host','qoder','--receipt-dir',receipts],{cwd:root,encoding:'utf8'})
  assert.notEqual(qoder.status,0);assert.match(qoder.stderr,/Qoder install accepts only/)
  const dsh=spawnSync(process.execPath,[bin,'install','--dry-run','--host','dsh','--receipt-dir',dshReceipts],{cwd:root,encoding:'utf8'})
  assert.notEqual(dsh.status,0);assert.match(dsh.stderr,/DSH install requires --dsh-config/)
  await assert.rejects(readdir(dshReceipts),{code:'ENOENT'})
  const claude=spawnSync(process.execPath,[bin,'install','--dry-run','--host','claude-code','--receipt-dir',receipts,'--user-root',userRoot],{cwd:root,encoding:'utf8'})
  assert.notEqual(claude.status,0);assert.match(claude.stderr,/Explicit Claude executable required/)
  assert.deepEqual(await readFile(join(relocated, 'release-manifest.json')), before)
  await assert.rejects(readFile(join(userRoot, '.agents/plugins/marketplace.json')), { code: 'ENOENT' })
  assert.notEqual(spawnSync(process.execPath, [bin, 'install', '--host', 'codex'], { encoding: 'utf8' }).status, 0)
  assert.notEqual(spawnSync(process.execPath, [bin, 'install', '--dry-run', '--host', 'unknown'], { encoding: 'utf8' }).status, 0)
  // The inventory fixture has no executable Git diagnostic. Disabling an
  // unrelated embedding provider must not promote this new package to ready.
  const gitMissing=execute(bin,['check-runtime','--host','codex','--disable-embedding','--receipt-dir',join(root,'runtime receipts')],root,1)
  assert.equal(gitMissing.status,'failed')
  assert.equal(gitMissing.git.status,'failed')
  // Keep the older-package Sharp/disabled contract covered separately; it is
  // explicitly not evidence that an undeclared Git runtime works.
  const packageFile=join(relocated,'package.json'),legacy=JSON.parse(await readFile(packageFile,'utf8'))
  delete legacy['x-design-release-review'].nativeGit
  await writeFile(packageFile,JSON.stringify(legacy))
  const disabled=execute(bin,['check-runtime','--host','codex','--disable-embedding','--receipt-dir',join(root,'legacy runtime receipts')],root)
  assert.equal(disabled.status,'disabled');assert.equal(disabled.git.status,'not-declared')
  assert.equal(disabled.embedding.runningServerConfigurationVerified,false)
  const missing=spawnSync(process.execPath,[bin,'check-runtime','--host','codex','--receipt-dir',join(root,'missing runtime receipts')],{cwd:root,encoding:'utf8'})
  assert.equal(missing.status,1,missing.stderr)
  assert.equal(JSON.parse(missing.stdout).status,'missing')
  assert.notEqual(spawnSync(process.execPath, [bin, 'install', '--apply', '--host', 'codex'], { encoding: 'utf8' }).status, 0)
})

test('missing shared root is explicit for relative and copied launchers', async t => {
  const { root, options } = await setup(t)
  const { target } = await buildCompanionCandidate(options)
  const copied = join(root, 'copied registration')
  await copyCompanionRegistration({ npmRoot: target, destination: copied, host: 'codex' })
  await rename(join(target, 'payload/shared'), join(target, 'payload/temporarily missing'))
  for (const path of [join(copied, 'scripts/design.mjs'), join(target, 'payload/overlays/codex/scripts/design.mjs')]) {
    const output = spawnSync(process.execPath, [path], { cwd: root, encoding: 'utf8' })
    assert.notEqual(output.status, 0)
    assert.match(output.stderr, /Missing shared Companion entry/u)
  }
})

test('existing output, source descendants, native copied closures, symlinks and wrong official hashes fail', async t => {
  const { source, options, put } = await setup(t)
  await buildCompanionCandidate(options)
  await assert.rejects(buildCompanionCandidate(options), { code: 'EEXIST' })
  await assert.rejects(buildCompanionCandidate({ ...options, destination: join(source, 'nested-output') }), /outside inputs/u)
  await put('shared/node_modules/bad/package.json', '{}')
  await assert.rejects(buildCompanionCandidate(options), /node_modules/u)
  await rm(join(source, 'shared/node_modules'), { recursive: true })
  await symlink(join(source, 'shared/scripts/design.mjs'), join(source, 'shared/bad-link'))
  await assert.rejects(buildCompanionCandidate(options), /Symlink input rejected/u)
  await rm(join(source, 'shared/bad-link'))
  await writeFile(join(options.officialInputRoot, 'LICENSE'), 'wrong')
  await assert.rejects(buildCompanionCandidate(options), /Official input hash mismatch/u)
  await assert.rejects(buildCompanionCandidate({ ...options, fixture: false }), /Non-fixture candidate requires an explicit npm package name/u)
})
