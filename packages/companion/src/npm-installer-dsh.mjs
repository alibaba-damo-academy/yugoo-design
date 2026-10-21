import { isPathWithin } from './npm-installer-paths.mjs'
import { assertWindowsPrivate } from './windows-private-storage.mjs'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const admitted = new WeakMap()
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => sha(JSON.stringify(canonical(value)))
const beneath = isPathWithin
export const DSH_INSTALL_MAX_OUTPUT_BYTES = 1024 * 1024

/** Install duration belongs to the native package manager, not a probe timer. */
export async function executeDshInstall(command, args, options, { run = exec, signal, timeoutMs = 0 } = {}) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 2147483647, 'Invalid install deadline')
  const started = performance.now(), cancellation = new AbortController()
  let requested = null, timer, pending, output = {}, failure = null, invoked = false
  const captured = { stdout: [], stderr: [] }, sizes = { stdout: 0, stderr: 0 }
  const capture = stream => chunk => {
    const bytes = Buffer.from(chunk).subarray(0, DSH_INSTALL_MAX_OUTPUT_BYTES - sizes[stream])
    if (bytes.length) { captured[stream].push(bytes); sizes[stream] += bytes.length }
  }
  const stop = reason => {
    if (requested !== null) return
    requested = reason
    cancellation.abort()
  }
  const cancel = () => stop('cancelled')
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  if (timeoutMs > 0) timer = setTimeout(() => stop('timed-out'), timeoutMs)
  try {
    cancellation.signal.throwIfAborted()
    invoked = true
    pending = run(command, args, { ...options, shell: false, timeout: 0,
      signal: cancellation.signal, maxBuffer: DSH_INSTALL_MAX_OUTPUT_BYTES })
    for (const stream of ['stdout', 'stderr']) pending.child?.[stream]?.on('data', capture(stream))
    output = await pending
  } catch (error) { failure = error; output = error }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
  const buffer = value => Buffer.isBuffer(value) ? value : Buffer.from(value ?? '')
  const stdout = sizes.stdout ? Buffer.concat(captured.stdout) : buffer(output.stdout).subarray(0, DSH_INSTALL_MAX_OUTPUT_BYTES)
  const stderr = sizes.stderr ? Buffer.concat(captured.stderr) : buffer(output.stderr).subarray(0, DSH_INSTALL_MAX_OUTPUT_BYTES)
  const overflow = failure?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    || buffer(output.stdout).length > stdout.length || buffer(output.stderr).length > stderr.length
  // DOMException.code identifies an API error, never a native process exit.
  // A pre-cancelled request has not invoked the runner even if its reason has a code.
  const observedCode = failure ? (invoked && failure.name !== 'AbortError' && !(failure instanceof DOMException)
    && Number.isInteger(failure.code) ? failure.code : null) : output.exitCode ?? output.status ?? 0
  const code = observedCode ?? 1
  const state = requested ?? (overflow ? 'output-limit' : failure?.signal ? 'terminated'
    : failure ? (failure.code === 'ENOENT' || failure.code === 'EACCES' ? 'launch-failed' : 'failed')
      : code === 0 ? 'completed' : 'failed')
  const execution = { state, elapsedMs: Math.round(performance.now() - started), timeoutMs,
    maxOutputBytesPerStream: DSH_INSTALL_MAX_OUTPUT_BYTES, exitCode: observedCode, pid: pending?.child?.pid ?? null,
    signal: failure?.signal ?? pending?.child?.signalCode ?? null, killed: pending?.child?.killed ?? failure?.killed ?? null,
    cancellationRequested: requested !== null, outputComplete: requested === null && !overflow && (!failure || observedCode !== null),
    // An AbortError or a dead parent CLI cannot establish Windows pnpm tree exit.
    processTreeState: state === 'completed' ? 'not-asserted' : 'unverified', retrySafe: false,
    output: { stdout: { bytes: stdout.length, sha256: sha(stdout) }, stderr: { bytes: stderr.length, sha256: sha(stderr) } } }
  return { execution, stdout, stderr,
    exitCode: state === 'completed' ? 0 : code || 1,
    executionError: failure ? String(failure.code ?? failure.name) : state === 'completed' ? null : state }
}

async function retainCommandOutput(directory, command) {
  if (directory === undefined) return
  await safeDirectory(directory)
  if (process.platform === 'win32') await assertWindowsPrivate(directory, { directory: true })
  const id = randomUUID()
  for (const stream of ['stdout', 'stderr']) {
    const path = join(directory, `${id}.dsh-${stream}.log`)
    await writeFile(path, command[stream], { flag: 'wx', mode: 0o600 })
    command.execution.output[stream].path = path
  }
}

async function regular(path, optional = false) {
  try { assert.ok((await lstat(path)).isFile(), 'Expected regular file'); return await readFile(path) }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error }
}
async function safeDirectory(path) {
  assert.ok(isAbsolute(path), 'Explicit absolute directory required')
  assert.equal(await realpath(path), path, 'Symlink directory rejected')
  assert.ok((await lstat(path)).isDirectory(), 'Existing directory required')
}
async function checkPin(pin) {
  assert.ok(pin && isAbsolute(pin.path), 'Explicit absolute official file pin required')
  assert.match(pin.sha256 ?? '', /^[a-f0-9]{64}$/u, 'SHA-256 pin required')
  // Official npm dependency directories may be pnpm symlinks; bind resolved bytes.
  assert.equal(sha(await regular(await realpath(pin.path))), pin.sha256, 'Official file pin changed')
}

// Only DSH consumes this local product mapping. Older candidates retain their
// explicit selector/registry route; preparation values never imply a release.
export function validateReleaseHosts(config) {
  assert.ok(config && typeof config==='object' && !Array.isArray(config),'Release hosts object required')
  assert.deepEqual(Object.keys(config).sort(),['hosts','schemaVersion'],'Unknown release hosts fields')
  assert.equal(config.schemaVersion,1,'Unsupported release hosts schema')
  assert.ok(config.hosts && typeof config.hosts==='object' && !Array.isArray(config.hosts),'Release hosts map required')
  assert.deepEqual(Object.keys(config.hosts),['dsh'],'Release mapping currently supports DSH only')
  const dsh=config.hosts.dsh
  assert.ok(dsh && typeof dsh==='object' && !Array.isArray(dsh),'DSH release mapping required')
  assert.deepEqual(Object.keys(dsh).sort(),['aggregatePackage','aggregateVersion','registry'],'Unknown DSH release fields')
  assert.match(dsh.aggregatePackage ?? '',/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u,'Exact aggregate package name required')
  if(dsh.aggregateVersion===null && dsh.registry===null)return null
  assert.match(dsh.aggregateVersion ?? '',/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u,'Exact aggregate version required')
  assert.equal(typeof dsh.registry,'string','Bound HTTPS registry required')
  const url=new URL(dsh.registry)
  assert.ok(url.protocol==='https:' && !url.username && !url.password && !url.search && !url.hash,'Credential-free HTTPS registry required')
  return {aggregateSelector:`${dsh.aggregatePackage}@${dsh.aggregateVersion}`,registry:url.href}
}

async function boundedFile(path) {
  assert.ok(isAbsolute(path), 'Explicit absolute ownership file required')
  await safeDirectory(dirname(path))
  const info = await lstat(path)
  assert.ok(info.isFile() && info.size <= 1024 * 1024, 'Bounded regular ownership file required')
  return regular(path)
}

/** Pin the acquired product, not an aggregate that a registry operation has yet to acquire. */
async function productIdentity(root) {
  if (root === undefined) return null
  assert.ok(isAbsolute(root), 'Explicit absolute acquired product required')
  await safeDirectory(root)
  const manifestBytes = await boundedFile(join(root, 'package.json')), manifest = JSON.parse(manifestBytes)
  assert.equal(typeof manifest.name, 'string'); assert.equal(typeof manifest.version, 'string')
  let releaseMap = null
  try { releaseMap = await boundedFile(join(root, 'release-hosts.json')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const entries = {}
  for (const file of ['design-system.mjs', 'installer.mjs', 'npm-installer-dsh.mjs', 'npm-agent-installation.mjs'])
    entries[file] = sha(await boundedFile(join(root, 'bin', file)))
  return { npmRoot: root, name: manifest.name, version: manifest.version, manifestSha256: sha(manifestBytes),
    releaseMapSha256: releaseMap === null ? null : sha(releaseMap),
    releaseSelection: releaseMap === null ? null : validateReleaseHosts(JSON.parse(releaseMap)), entries }
}

function expectedSource(input) {
  return { kind: input.aggregateDirectory ? 'retained-link' : 'registry-selector',
    aggregateSelector: input.aggregateSelector, registry: input.registry,
    ...(input.aggregateDirectory ? { aggregateDirectory: input.aggregateDirectory,
      aggregateManifestSha256: input.aggregateManifestSha256, aggregatePatchSha256: input.aggregatePatchSha256 } : {}) }
}
function ownedState(current) {
  return { dependency: current.dependency, installed: current.installed, registered: current.registered }
}

function ownerReference(record) {
  return { receiptFile: record.path, receiptSha256: sha(record.bytes), planSha256: record.plan.planSha256,
    product: record.plan.product, owned: record.receipt.source.observed }
}
function assertOwnerReference(reference) {
  assert.ok(reference && typeof reference === 'object', 'Actual native owner reference required')
  assert.ok(typeof reference.receiptFile === 'string' && isAbsolute(reference.receiptFile), 'Actual native owner file required')
  for (const key of ['receiptSha256', 'planSha256']) assert.match(reference[key] ?? '', /^[a-f0-9]{64}$/u, 'Native owner hash required')
  assert.ok(reference.product && reference.owned?.installed && reference.owned.registered, 'Native owner identity required')
}

// This validates a saved fact without reading historical product directories or
// following its earlier owner. Only the selected current product is reread below.
async function readOwnedReceipt(path, state, profile, currentProduct) {
  assert.ok(typeof path === 'string' && isAbsolute(path), 'Explicit absolute previous receipt required')
  for (const root of [state.dshHome, currentProduct.npmRoot, ...Object.values(state.pins).map(pin => dirname(pin.path))])
    assert.ok(!beneath(root, path), 'Previous receipt overlaps host or product inputs')
  if (process.platform === 'win32') await assertWindowsPrivate(dirname(path), { directory: true })
  const bytes = await boundedFile(path), receipt = JSON.parse(bytes)
  const { receiptSha256, ...body } = receipt
  assert.equal(receipt.schemaVersion, 2, 'Ownership proof required; sparse or manual receipts cannot be adopted')
  assert.equal(digest(body), receiptSha256, 'Previous receipt digest mismatch')
  assert.equal(receipt.kind, 'dsh-installation'); assert.equal(receipt.host, 'dsh')
  assert.equal(receipt.route, 'official-dsh-bundle'); assert.equal(receipt.scope, state.identity.scope)
  assert.match(receipt.id ?? '', /^[0-9a-f-]{36}$/u)
  assert.equal(receipt.receiptPath, path)
  assert.equal(join(dirname(path), receipt.id + '.dsh-result.json'), path)
  assert.equal(receipt.status, 'registered-config-parsed', 'Successful owned installation required')
  assert.equal(receipt.ownershipEstablished, true, 'Previous installation ownership was not established')
  assert.equal(receipt.exitCode, 0); assert.equal(receipt.partialStateRetained, false)
  assert.equal(receipt.userConfigurationPreserved, true)
  const old = receipt.planSnapshot, { planSha256, ...unsigned } = old ?? {}
  assert.equal(planSha256, receipt.planSha256); assert.equal(digest(unsigned), planSha256, 'Previous plan digest mismatch')
  assert.deepEqual(old.protocol, state.identity, 'Previous official profile or protocol differs')
  assert.equal(old.profile, profile, 'Previous profile differs')
  assert.deepEqual(receipt.product, old.product, 'Previous product identity mismatch')
  assert.ok(old.product?.releaseSelection, 'Previous product was not release-bound')
  assert.ok(!beneath(old.product.npmRoot, path), 'Previous receipt overlaps its acquired product')
  const selected = await selectorInput({ profile: old.profile, aggregateSelector: old.aggregateSelector, registry: old.registry })
  assert.deepEqual(old.package, selected.package, 'Previous selected package differs')
  // A receipt pins both the canonical release origin and the effective download
  // registry. They may differ for an explicitly selected mirror, never in version.
  assert.deepEqual(old.product.releaseSelection, validateReleaseHosts({ schemaVersion: 1, hosts: { dsh: {
    aggregatePackage: selected.package.name, aggregateVersion: selected.package.version,
    registry: old.product.releaseSelection.registry } } }), 'Previous product selection mismatch')
  assert.deepEqual(receipt.source?.expected, expectedSource(old), 'Previous selected source differs')
  assert.deepEqual(receipt.source?.observed, ownedState(receipt.readback), 'Previous installed source differs')
  assert.equal(receipt.readback?.configurationParsed, true)
  assert.equal(receipt.readback?.packageInstalled, true); assert.equal(receipt.readback?.bundleRegistered, true)
  assert.equal(receipt.readback.installed?.name, selected.package.name)
  assert.equal(receipt.readback.installed?.version, selected.package.version)
  assert.equal(receipt.readback.registered, true)
  if (old.aggregateDirectory) {
    assert.equal(receipt.readback.installed.realPackageDir, old.aggregateDirectory)
    assert.ok(receipt.readback.dependency.startsWith('link:'))
  } else assert.equal(receipt.readback.dependency, selected.package.version)
  return { path, bytes, receipt, plan: old }
}
function assertNativeOwner(record) {
  const { receipt, plan } = record
  assert.equal(receipt.execution?.state, 'completed', 'Owner must be an actual completed native operation')
  assert.equal(receipt.execution.exitCode, 0, 'Native owner must have exited successfully')
  if (plan.action === 'install') {
    assert.ok(!plan.before.installed && !plan.before.registered && plan.before.dependency === null,
      'Native install owner must start with an absent aggregate')
  } else {
    assert.equal(plan.action, 'update', 'A no-command observation is not a native owner')
    assertOwnerReference(plan.previous)
    assert.deepEqual(ownedState(plan.before), plan.previous.owned, 'Native update before-state differs from its owner')
    assert.notEqual(plan.before.installed.version, receipt.readback.installed.version)
    assert.notEqual(plan.previous.product.version, plan.product.version)
    assert.equal(plan.previous.product.name, plan.product.name)
  }
}

async function previousOwnership(path, state, input, product) {
  assert.ok(product?.releaseSelection, 'Owned update requires a release-bound acquired product')
  const selected = await readOwnedReceipt(path, state, input.profile, product)
  let anchor = selected
  if (selected.plan.action !== 'install') {
    const reference = selected.plan.previous
    assertOwnerReference(reference)
    // Read exactly one native anchor. Never follow its own earlier reference.
    const native = await readOwnedReceipt(reference.receiptFile, state, input.profile, product)
    assert.deepEqual(ownerReference(native), reference, 'Native owner reference changed')
    assertNativeOwner(native)
    assert.deepEqual(ownedState(selected.plan.before), reference.owned, 'Previous before-state differs from its native owner')
    if (selected.plan.action === 'already-registered') {
      assert.equal(selected.receipt.execution?.state, 'not-needed')
      assert.deepEqual(selected.plan.product, native.plan.product, 'Observation product differs from its native owner')
      assert.deepEqual(selected.receipt.source, native.receipt.source, 'Observation source differs from its native owner')
      anchor = native
    } else assertNativeOwner(selected)
  } else assertNativeOwner(selected)
  assert.deepEqual(await productIdentity(selected.plan.product.npmRoot), selected.plan.product, 'Previous acquired product changed')
  assert.equal(selected.plan.product.name, product.name, 'Previous product name differs')
  const oldInput = await selectorInput(selected.plan)
  assert.equal(oldInput.package.name, input.package.name, 'Previous aggregate name differs')
  assert.equal(selected.plan.product.releaseSelection.registry, product.releaseSelection.registry,
    'Release registry migration requires a separate route')
  assert.equal(oldInput.registry, input.registry, 'Registry migration requires a separate route')
  assert.equal(Boolean(oldInput.aggregateDirectory), Boolean(input.aggregateDirectory), 'Source-kind migration requires a separate route')
  if (oldInput.package.version === input.package.version)
    assert.deepEqual(product, selected.plan.product, 'Same-version relocation is not an owned update')
  else assert.notEqual(product.version, selected.plan.product.version, 'An update requires a new exact product version')
  return { input: oldInput, inputSha256: sha(selected.bytes), reference: ownerReference(anchor) }
}

/** Pins are caller-selected release inputs, not host discovery or publication proof. */
export async function createDshInstallerAdapter({ scope = 'official-pinned', dshHome,
  node, cli, hostManifest, loader, loaderManifest, desktopHostManifest, hostVersion, loaderVersion,
  run = exec }) {
  assert.ok(['official-pinned', 'isolated-test-contract'].includes(scope), 'Unknown adapter scope')
  assert.ok(scope === 'isolated-test-contract' || run === exec, 'Production uses execFile, not an injected runner')
  await safeDirectory(dshHome)
  const pins = structuredClone({ node, cli, hostManifest, loader, loaderManifest, ...(desktopHostManifest ? { desktopHostManifest } : {}) })
  for (const pin of Object.values(pins)) await checkPin(pin)
  const host = JSON.parse(await regular(hostManifest.path))
  const boot = JSON.parse(await regular(loaderManifest.path))
  assert.equal(host.name, '@deepseek-ai/dsh'); assert.equal(host.version, hostVersion)
  assert.equal(boot.name, '@deepseek-ai/dsh-app-boot'); assert.equal(boot.version, loaderVersion)
  if (desktopHostManifest) {
    const desktop = JSON.parse(await regular(desktopHostManifest.path))
    assert.equal(desktop.name, '@deepseek-ai/dsh-desktop-host')
    assert.equal(desktop.version, hostVersion, 'Desktop CLI and host versions must match')
    assert.equal(loaderVersion, hostVersion, 'Desktop Loader and host versions must match')
    assert.equal(resolve(dirname(desktopHostManifest.path), '..', 'dsh-app-boot', 'package.json'), resolve(loaderManifest.path), 'Desktop Loader must use the same installed DSH tree')
    assert.equal(await realpath(cli.path), await realpath(resolve(dirname(desktopHostManifest.path), 'lib/cli.js')), 'CLI must be the official Desktop entry')
    assert.equal(resolve(dirname(desktopHostManifest.path), '..', 'dsh', 'package.json'), resolve(hostManifest.path), 'Desktop CLI must use the same installed DSH tree')
    assert.ok(process.versions.electron, 'Desktop ASAR inputs require the selected Electron Node runtime')
    assert.equal(await realpath(node.path), await realpath(process.execPath), 'Desktop uses the selected Electron executable')
  } else {
    assert.equal(await realpath(cli.path), await realpath(resolve(dirname(hostManifest.path), host.bin?.dsh)), 'CLI must be the pinned official public bin')
  }
  assert.equal(await realpath(loader.path), await realpath(resolve(dirname(loaderManifest.path), boot.main)), 'Loader must be the pinned public entry')
  const api = await import(pathToFileURL(await realpath(loader.path)).href)
  for (const key of ['resolveProfileDir', 'readProfileManifest', 'resolveBundleDir', 'bundlePatchPaths', 'loadOverlayPatches', 'composeEntries'])
    assert.equal(typeof api[key], 'function', `Missing official Loader interface: ${key}`)
  const adapter = Object.freeze({ scope, hostVersion, loaderVersion })
  admitted.set(adapter, { pins, api, dshHome, run, identity: { scope, dshHome, hostVersion, loaderVersion, pins } })
  return adapter
}

async function protocol(adapter) {
  const state = admitted.get(adapter)
  assert.ok(state, 'Pinned DSH adapter required')
  for (const pin of Object.values(state.pins)) await checkPin(pin)
  return state
}
async function selectorInput({ profile, aggregateSelector, registry, aggregateDirectory }) {
  assert.match(profile ?? '', /^[A-Za-z0-9][A-Za-z0-9_-]*$/u, 'Explicit safe profile required')
  const match = /^(?<name>(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/u.exec(aggregateSelector ?? '')
  assert.ok(match, 'Explicit exact registry package selector required; no aliases, tags or ranges')
  const url = new URL(registry)
  assert.equal(url.protocol, 'https:', 'Explicit HTTPS registry required')
  assert.ok(!url.username && !url.password && !url.search && !url.hash, 'Registry must not contain credentials or query')
  const input = { profile, aggregateSelector, registry: url.href, package: { ...match.groups } }
  if (aggregateDirectory !== undefined) {
    await safeDirectory(aggregateDirectory)
    const bytes = await regular(join(aggregateDirectory, 'package.json'))
    const manifest = JSON.parse(bytes)
    assert.equal(manifest.name, input.package.name, 'Retained aggregate name mismatch')
    assert.equal(manifest.version, input.package.version, 'Retained aggregate version mismatch')
    const patch = manifest.dsh?.bundle?.patch
    assert.ok(typeof patch === 'string' && !isAbsolute(patch), 'Retained aggregate bundle declaration required')
    const patchPath = resolve(aggregateDirectory, patch)
    assert.ok(beneath(aggregateDirectory, patchPath), 'Retained aggregate patch escapes package')
    assert.ok(beneath(aggregateDirectory, await realpath(patchPath)), 'Retained aggregate patch resolves outside package')
    Object.assign(input, { aggregateDirectory, aggregateManifestSha256:sha(bytes), aggregatePatchSha256:sha(await regular(patchPath)) })
  }
  return input
}
function foreignManifest(manifest, name) {
  const foreign = structuredClone(manifest)
  if (foreign.dependencies) { delete foreign.dependencies[name]; if (!Object.keys(foreign.dependencies).length) delete foreign.dependencies }
  if (foreign.dsh?.profile?.bundles) foreign.dsh.profile.bundles = foreign.dsh.profile.bundles.filter(item => item !== name)
  return foreign
}
async function snapshot(state, input) {
  const dir = resolve(state.api.resolveProfileDir(input.profile, state.dshHome))
  assert.equal(dir, join(state.dshHome, 'profiles', input.profile), 'Unexpected official profile path')
  await safeDirectory(dir) // Do not let the official CLI initialize a missing profile.
  const manifestBytes = await regular(join(dir, 'package.json'))
  const manifest = state.api.readProfileManifest('dsh', dir)
  assert.equal(digest(manifest), digest(JSON.parse(manifestBytes)), 'Loader manifest read mismatch')
  const bundles = manifest.dsh?.profile?.bundles
  assert.ok(Array.isArray(bundles) && bundles.every(x => typeof x === 'string') && new Set(bundles).size === bundles.length, 'Explicit unambiguous bundle list required')
  assert.ok(manifest.dsh.profile.patchReload === undefined || ['live', 'startup'].includes(manifest.dsh.profile.patchReload), 'Unknown profile patch lifecycle')
  const name = input.package.name, dependency = manifest.dependencies?.[name]
  for (const field of ['devDependencies', 'optionalDependencies', 'peerDependencies'])
    assert.ok(!Object.hasOwn(manifest[field] ?? {}, name), 'Foreign aggregate dependency conflict')
  if (dependency !== undefined) {
    if (input.aggregateDirectory) {
      assert.ok(typeof dependency === 'string' && dependency.startsWith('link:'), 'Existing aggregate must link to the retained installation')
      assert.equal(await realpath(resolve(dir, dependency.slice(5))), input.aggregateDirectory, 'Existing retained aggregate link conflict')
    } else assert.equal(dependency, input.package.version, 'Existing selector conflict; replacement requires separate approval')
  }
  assert.ok(!bundles.includes(name) || dependency !== undefined, 'Foreign bundle registration conflict')
  const patches = {}
  for (const path of [join(dir, 'cordis.patch.yml'), join(state.dshHome, 'cordis.patch.yml')]) {
    const bytes = await regular(path, true); patches[path] = bytes === null ? null : sha(bytes)
  }
  const configPins = {}
  for (const path of [join(dir, '.npmrc'), join(dir, 'pnpm-workspace.yaml'), join(state.dshHome, '.npmrc')]) {
    const bytes = await regular(path, true); configPins[path] = bytes === null ? null : sha(bytes)
  }
  let packageDir = null
  try { packageDir = state.api.resolveBundleDir('dsh', name, state.pins.hostManifest.path, dir) }
  catch (error) {
    // This exact pinned official interface throws this diagnostic for absence.
    if (!String(error.message).startsWith(`dsh: cannot resolve profile bundle ${JSON.stringify(name)} from `)) throw error
  }
  let installed = null
  if (packageDir !== null) {
    const realPackageDir = await realpath(packageDir)
    assert.equal(await realpath(join(dir, 'node_modules', name)), realPackageDir, 'Official resolution is not the direct profile package')
    if (input.aggregateDirectory) assert.equal(await realpath(packageDir), input.aggregateDirectory, 'Resolved aggregate differs from retained installation')
    const bytes = await regular(join(packageDir, 'package.json')), value = JSON.parse(bytes)
    assert.equal(value.name, name, 'Resolved package identity conflict')
    assert.equal(value.version, input.package.version, 'Installed version conflict; use replacement route')
    assert.ok(dependency !== undefined, 'Foreign installed aggregate conflict')
    const patch = value.dsh?.bundle?.patch
    assert.ok(typeof patch === 'string' && !isAbsolute(patch), 'Aggregate must declare a relative dsh.bundle.patch')
    const patchPath = resolve(packageDir, patch)
    assert.ok(beneath(resolve(packageDir), patchPath), 'Aggregate patch escapes package')
    assert.ok(beneath(await realpath(packageDir), await realpath(patchPath)), 'Aggregate patch resolves outside package')
    installed = { name, version: value.version, packageDir, realPackageDir, manifestSha256: sha(bytes), patchPath, patchSha256: sha(await regular(patchPath)) }
  } else assert.equal(dependency, undefined, 'Existing aggregate dependency is unresolved; repair separately')
  const lock = await regular(join(dir, 'pnpm-lock.yaml'), true)
  return { dir, manifestSha256: sha(manifestBytes), foreignSha256: digest(foreignManifest(manifest, name)),
    patches, configPins, installed, dependency: dependency ?? null, bundles: [...bundles],
    lockfileSha256: lock === null ? null : sha(lock), registered: bundles.includes(name) }
}

/** Read-only plan. Does not initialize profiles, install packages or write configuration. */
export async function planDshInstallation(options) {
  const state = await protocol(options.adapter), input = await selectorInput(options)
  if (state.pins.desktopHostManifest) assert.equal(input.profile, 'desktop', 'Desktop registration requires its reserved profile')
  const product = await productIdentity(options.productRoot ?? options.product?.npmRoot)
  if (product?.releaseSelection) {
    assert.equal(input.aggregateSelector, product.releaseSelection.aggregateSelector, 'Selected aggregate differs from product release')
    // selectorInput already admits only credential-free HTTPS transport. Keep
    // this choice separate from the immutable release origin in product identity.
  }
  const previous = options.previousReceipt === undefined ? null
    : await previousOwnership(options.previousReceipt, state, input, product)
  const before = await snapshot(state, previous?.input ?? input)
  if (previous) assert.deepEqual(ownedState(before), previous.reference.owned, 'Owned A installation changed')
  const plan = { schemaVersion: 2, host: 'dsh', route: 'official-dsh-bundle', ...input, product,
    ...(previous ? { previousReceipt: options.previousReceipt, previousInputSha256: previous.inputSha256, previous: previous.reference } : {}),
    protocol: structuredClone(state.identity), before, command: state.pins.node.path,
    // Official profiles contain pnpm-workspace.yaml; explicitly target their root.
    args: [...state.pins.desktopHostManifest ? ['--expose-internals'] : [], state.pins.cli.path, 'plugin', '--profile', input.profile, 'add', '--workspace-root', '--save-exact', input.aggregateDirectory ? 'link:' + input.aggregateDirectory : input.aggregateSelector, '--registry', input.registry],
    action: previous && previous.input.package.version !== input.package.version ? 'update'
      : before.installed && before.registered ? 'already-registered' : 'install',
    runtimeMounted: false, bundleCycleVerified: false, releaseValidated: false }
  return { ...plan, planSha256: digest(plan) }
}

/** Configuration parsing only, never Loader boot or loadProfile (which may write). */
export async function inspectDshInstallation(options) {
  const state = await protocol(options.adapter), input = await selectorInput(options)
  const current = await snapshot(state, input)
  let configurationParsed = false, composedEntriesSha256 = null
  if (current.installed && current.registered) {
    const manifest = state.api.readProfileManifest('dsh', current.dir)
    const layers = []
    for (const name of manifest.dsh.profile.bundles) {
      const dir = state.api.resolveBundleDir('dsh', name, state.pins.hostManifest.path, current.dir)
      const bundle = state.api.readProfileManifest('dsh', dir), declared = bundle.dsh?.bundle?.patch
      const files = typeof declared === 'string' ? [declared] : declared
      assert.ok(Array.isArray(files) && files.every(file => typeof file === 'string'
        && file.length > 0 && !file.includes('\0') && !isAbsolute(file)), 'Relative Bundle patch path or list required')
      // Keep the official file order and one PatchOptions[] per file. Its
      // composeEntries flattens these lists once, as loadProfileDirectory does.
      for (const path of state.api.bundlePatchPaths(dir, bundle.dsh.bundle)) {
        assert.ok(beneath(resolve(dir), path), 'Bundle patch escapes package')
        assert.ok(beneath(await realpath(dir), await realpath(path)), 'Bundle patch resolves outside package')
        await regular(path) // Reject patch symlinks/special files before the Loader reads them.
        layers.push(state.api.loadOverlayPatches('dsh', path))
      }
    }
    for (const [path, pin] of Object.entries(current.patches)) if (pin !== null) layers.push(state.api.loadOverlayPatches('dsh', path))
    const warnings = []
    const entries = state.api.composeEntries(layers, warning => warnings.push(warning))
    assert.equal(warnings.length, 0, 'Configuration composition reported skipped patches')
    composedEntriesSha256 = digest(entries); configurationParsed = true
    assert.deepEqual(await snapshot(state, input), current, 'Readback unexpectedly changed profile state')
  }
  return { ...current, packageInstalled: current.installed !== null, bundleRegistered: current.registered,
    configurationParsed, composedEntriesSha256, launcherOverlaysInspected: false,
    runtimeMounted: false, bundleCycleVerified: false, releaseValidated: false }
}

/** Runs only the pinned public CLI; retains partial state on failure, never rolls back. */
export async function applyDshInstallation(plan, { adapter, signal, timeoutMs = 0, logDirectory } = {}) {
  plan = structuredClone(plan)
  const { planSha256, ...unsigned } = plan
  assert.equal(digest(unsigned), planSha256, 'Plan or profile changed; replan before execution')
  const state = await protocol(adapter)
  const fresh = await planDshInstallation({ ...plan, adapter })
  assert.equal(fresh.planSha256, plan.planSha256, 'Plan or profile changed; replan before execution')
  if (logDirectory !== undefined) {
    await safeDirectory(logDirectory)
    for (const root of [state.dshHome, plan.product?.npmRoot, plan.previous?.product.npmRoot,
      ...Object.values(state.pins).map(pin => dirname(pin.path))].filter(Boolean))
      assert.ok(!beneath(root, logDirectory) && !beneath(logDirectory, root), 'Command logs overlap host inputs')
    if (process.platform === 'win32') await assertWindowsPrivate(logDirectory, { directory: true })
  }
  let exitCode = 0, executionError = null, execution = { state: 'not-needed', retrySafe: false }, diagnosticError = null
  if (fresh.action !== 'already-registered') {
    const command = await executeDshInstall(fresh.command, fresh.args, { cwd: fresh.before.dir,
      // ORT's supported policy skips its extra CUDA download, not dependency lifecycle scripts.
      env: { ...process.env, ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip', DSH_HOME: state.dshHome,
        ...(state.pins.desktopHostManifest ? { ELECTRON_RUN_AS_NODE: '1' } : {}) } },
    { run: state.run, signal, timeoutMs })
    ;({ exitCode, executionError, execution } = command)
    try { await retainCommandOutput(logDirectory, command) }
    catch (error) { diagnosticError = String(error.code ?? error.name) }
  }
  let readback = null, readbackError = null, userConfigurationPreserved = false
  try {
    readback = await inspectDshInstallation({ ...plan, adapter })
    userConfigurationPreserved = readback.foreignSha256 === plan.before.foreignSha256
      && digest(readback.patches) === digest(plan.before.patches) && digest(readback.configPins) === digest(plan.before.configPins)
      && (plan.action !== 'update' || digest(readback.bundles) === digest(plan.before.bundles))
  } catch (error) { readbackError = error.message }
  const succeeded = exitCode === 0 && diagnosticError === null && userConfigurationPreserved && readback?.configurationParsed === true
  const ownershipEstablished = Boolean(succeeded && plan.product?.releaseSelection && (plan.previous
    || plan.action === 'install' && !plan.before.installed && !plan.before.registered && execution.state === 'completed'))
  return { schemaVersion: 2, kind: 'dsh-installation', host: 'dsh', route: 'official-dsh-bundle',
    product: plan.product, planSnapshot: plan, planSha256: plan.planSha256, operation: plan.action,
    ownershipEstablished, source: { expected: expectedSource(plan), observed: readback === null ? null : ownedState(readback) },
    registryAcquisitionVerified: false, scope: adapter.scope, status: succeeded ? 'registered-config-parsed' : 'failed-partial-state-retained',
    exitCode, executionError, execution, diagnosticError, readbackError, readback, userConfigurationPreserved,
    userConfigurationStatus: readback === null ? 'unverified' : userConfigurationPreserved ? 'observed-matching' : 'changed',
    rollbackAttempted: false, rollbackScope: 'adapter-only; official CLI may perform limited compatibility restoration', partialStateRetained: !succeeded,
    runtimeMounted: false, bundleCycleVerified: false, releaseValidated: false }
}
