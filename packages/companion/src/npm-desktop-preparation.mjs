/** Prepare native desktop imports from an explicitly acquired npm version. No registration. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { deflateRawSync } from 'node:zlib'
import { createReadStream } from 'node:fs'
import { isPathWithin } from './npm-installer-paths.mjs'
import { resolveDesktopNodeRuntime, verifyNodeRuntime } from './npm-node-runtime.mjs'

const encode = value => JSON.stringify(value, null, 2) + '\n'
const sha = value => createHash('sha256').update(value).digest('hex')
const digest = value => sha(encode(value))
async function streamHash(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex') }
const suiteVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const packageVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const licenses = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']
function confined(root, path) { return relative(root, path) !== '' && isPathWithin(root, path) }
async function safe(path) {
  for (let p = resolve(path);; p = dirname(p)) {
    try { assert.ok(!(await lstat(p)).isSymbolicLink(), 'Preparation symlink rejected') } catch (e) { if (e.code !== 'ENOENT') throw e }
    if (p === dirname(p)) break
  }
}
async function file(path) {
  await safe(path); const info = await lstat(path)
  assert.ok(info.isFile() && info.size <= 4 * 1024 * 1024, 'Expected bounded regular preparation file')
  return readFile(path)
}
async function inventory(root, excluded = []) {
  const result = {}; let bytes = 0
  async function visit(dir) {
    for (const name of (await readdir(dir)).sort()) {
      if (dir === root && excluded.includes(name)) continue
      const path = join(dir, name), info = await lstat(path)
      assert.ok(!info.isSymbolicLink(), 'Preparation asset symlink rejected')
      if (info.isDirectory()) await visit(path)
      else {
        assert.ok(info.isFile() && info.size <= 4 * 1024 * 1024, 'Expected bounded regular preparation asset')
        bytes += info.size; assert.ok(bytes <= 50 * 1024 * 1024, 'Desktop preparation exceeds native import bound')
        result[relative(root, path).split('\\').join('/')] = sha(await readFile(path))
      }
    }
  }
  await visit(root); return result
}
async function verifyMaterials(root) {
  const bytes = await file(join(root, 'materials.json')), manifest = JSON.parse(bytes)
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.scope, 'desktop-preparation-only')
  const actual = await inventory(root, ['materials.json'])
  assert.deepEqual(actual, manifest.files, 'Desktop template/helper bytes changed')
  for (const path of ['qwenwork-package.mjs', 'workbuddy-package.mjs', 'qwenwork-template/skills/yugoo/native-execution.md', 'hosts/workbuddy/design-SKILL.md']) assert.ok(actual[path], 'Missing desktop preparation material')
  return sha(bytes)
}
function windowsPath(value) { assert.ok(typeof value === 'string' && win32.isAbsolute(value) && !/[\r\n\0]/.test(value), 'Explicit absolute Windows preparation path required'); return win32.normalize(value) }
async function qwenNodeConfiguration(configuration, node) {
  const projected = structuredClone(configuration)
  const supplied = process.platform === 'win32' ? await realpath(windowsPath(projected.nodeExecutable)) : windowsPath(projected.nodeExecutable)
  assert.equal(win32.normalize(supplied).toLowerCase(), node.toLowerCase(), 'QwenWork Node configuration mismatch')
  // Resolve a version manager's junction without changing the caller's config
  // or any of its native executable/worker identity and byte pins.
  projected.nodeExecutable = node
  return projected
}
function outsideHostProfile(path) {
  const parts = path.split(/[\\/]/).map(p => p.toLowerCase())
  return !parts.some(p => ['.workbuddy', '.qwenworkcn', '.codebuddy'].includes(p)) && !(parts.includes('appdata') && parts.some(p => ['qwenworkcn', 'workbuddy', 'codebuddy'].includes(p)))
}

// Standard bounded ZIP/DEFLATE container for the existing QwenWork native importer.
// Members come only from the exclusive small suite, never from npm/runtime or a user path.
async function writeSuiteZip(suite, destination) {
  const entries = Object.keys(await inventory(suite)), local = [], central = []; let offset = 0
  assert.ok(entries.length <= 4096, 'Too many expert-suite members')
  for (const name of entries) {
    const data = await file(join(suite, name)), zipped = deflateRawSync(data), filename = Buffer.from(name)
    let crc = 0xffffffff
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    crc = (crc ^ 0xffffffff) >>> 0
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8)
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(zipped.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26)
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10)
    directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(zipped.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42)
    local.push(header, filename, zipped); central.push(directory, filename); offset += header.length + filename.length + zipped.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  const zip = Buffer.concat([...local, directory, end]); assert.ok(zip.length < 50 * 1024 * 1024, 'Expert-suite ZIP exceeds import limit')
  await writeFile(destination, zip, { flag: 'wx' }); return { bytes: zip.length, sha256: sha(zip) }
}
async function priorReceipt(path) {
  const envelope = JSON.parse(await file(path))
  assert.equal(envelope.sha256, digest(envelope.body), 'Preparation receipt changed')
  assert.equal(envelope.body.kind, 'desktop-package-preparation'); assert.equal(envelope.body.status, 'prepared')
  assert.ok(confined(envelope.body.destination, resolve(path)), 'Previous receipt is outside its owned preparation')
  assert.deepEqual(await inventory(envelope.body.destination, ['receipts', '.preparation.lock']), envelope.body.assets, 'Previous prepared artifacts changed; preserve and inspect them')
  const old = envelope.body.package, manifest = await file(join(old.npmRoot, 'package.json'))
  assert.equal(sha(manifest), old.manifestSha256, 'Previous acquired npm version changed')
  assert.equal(sha(await file(join(old.npmRoot, 'payload/shared/scripts/design.mjs'))), old.runtimeEntrySha256, 'Previous acquired runtime changed')
  assert.equal(await verifyMaterials(join(old.npmRoot, 'payload/desktop-preparation')), old.materialSha256, 'Previous desktop resources changed')
  return envelope
}

export async function prepareDesktopPackage({ npmRoot, packageName, packageVersion, target, destination, nodeExecutable,
  suiteVersion, npmRootWindows, destinationWindows, qwenworkRuntime, includeMcp = true, previousReceiptFile } = {}) {
  assert.ok(['qwenwork', 'workbuddy'].includes(target), 'Explicit desktop preparation target required')
  assert.ok(isAbsolute(npmRoot ?? '') && isAbsolute(destination ?? ''), 'Absolute npm/output roots required')
  assert.match(packageName ?? '', /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/); assert.match(packageVersion ?? '', packageVersionPattern)
  assert.ok(packageVersion.length < 128, 'Package version too long')
  const [versionCore, metadata] = packageVersion.split('+'), pre = versionCore.split('-').slice(1).join('-')
  if (pre) assert.ok(pre.split('.').every(part => /^[0-9A-Za-z-]+$/.test(part) && !/^0[0-9]+$/.test(part)), 'Noncanonical npm prerelease version')
  if (metadata) assert.ok(metadata.split('.').every(part => /^[0-9A-Za-z-]+$/.test(part)), 'Noncanonical npm version metadata')
  assert.match(suiteVersion ?? '', suiteVersionPattern); assert.ok(suiteVersion.length < 64, 'Suite version too long')
  assert.equal(typeof includeMcp, 'boolean'); assert.ok(target === 'qwenwork' || qwenworkRuntime === undefined && includeMcp, 'QwenWork configuration cannot apply to WorkBuddy')
  const root = resolve(npmRoot), output = resolve(destination)
  await safe(root); await safe(output); assert.equal(await realpath(root), root)
  assert.ok(!confined(root, output) && output !== root && !confined(output, root), 'Preparation must be outside npm package')
  assert.ok(outsideHostProfile(output), 'Do not prepare inside native host profiles')
  const manifestBytes = await file(join(root, 'package.json')), manifest = JSON.parse(manifestBytes)
  assert.equal(manifest.name, packageName, 'Acquired npm package identity mismatch'); assert.equal(manifest.version, packageVersion, 'Acquired npm package version mismatch')
  assert.equal(manifest['x-design-release-review']?.fixture, false, 'Fixture packages cannot prepare desktop imports')
  const runtime = join(root, 'payload/shared'), materials = join(root, 'payload/desktop-preparation')
  const entry = await file(join(runtime, 'scripts/design.mjs'))
  if (target === 'workbuddy') await file(join(runtime, 'scripts/workbuddy-panel-service.mjs'))
  await file(join(runtime, 'knowledge/runtime-manifest.json')); await file(join(runtime, 'kits/web_app/kit.yaml'))
  const materialSha256 = await verifyMaterials(materials)
  const windowsNpm = windowsPath(npmRootWindows ?? (process.platform === 'win32' ? root : undefined))
  const windowsOutput = windowsPath(destinationWindows ?? (process.platform === 'win32' ? output : undefined))
  assert.ok(outsideHostProfile(windowsOutput), 'Do not prepare inside native host profiles')
  if (process.platform === 'win32') { assert.equal(windowsNpm.toLowerCase(), win32.normalize(root).toLowerCase()); assert.equal(windowsOutput.toLowerCase(), win32.normalize(output).toLowerCase()) }
  const nodeRuntime = await resolveDesktopNodeRuntime(nodeExecutable ?? qwenworkRuntime?.nodeExecutable)
  const node = windowsPath(nodeRuntime.executable), runtimeWindows = win32.join(windowsNpm, 'payload/shared')
  const prior = previousReceiptFile ? await priorReceipt(resolve(previousReceiptFile)) : undefined
  if (prior) {
    assert.equal(prior.body.destination, output); assert.equal(prior.body.target, target); assert.equal(prior.body.package.name, packageName)
    assert.notEqual(prior.body.package.npmRoot, root, 'An update requires a new stable npm directory')
    assert.equal(prior.body.windows.destination, windowsOutput); assert.notEqual(prior.body.package.version, packageVersion, 'An npm update requires a new exact package version')
    const old = prior.body.suiteVersion.split('.').map(BigInt), next = suiteVersion.split('.').map(BigInt)
    assert.ok(next.some((part, i) => part > old[i] && next.slice(0, i).every((n, j) => n === old[j])), 'Native suite update requires a greater release version')
  }
  const qwen = target === 'qwenwork' ? await import(pathToFileURL(join(materials, 'qwenwork-package.mjs'))) : undefined
  if (qwen) {
    qwen.validateQwenWorkRuntime(qwenworkRuntime)
    assert.deepEqual(Object.keys(qwenworkRuntime).sort(), ['executable', 'executableSha256', 'nodeExecutable', 'worker', 'workerSha256'], 'Only native path and byte pins belong in preparation configuration')
    qwenworkRuntime = await qwenNodeConfiguration(qwenworkRuntime, node)
    if (process.platform === 'win32') for (const [path, expected] of [[qwenworkRuntime.executable, qwenworkRuntime.executableSha256], [qwenworkRuntime.worker, qwenworkRuntime.workerSha256]]) assert.equal(await streamHash(path), expected, 'QwenWork native bytes do not match provided pins')
  }
  if (!prior) await mkdir(output)
  const lock = join(output, '.preparation.lock'), owner = randomUUID()
  await writeFile(lock, owner, { flag: 'wx', mode: 0o600 })
  let body
  try {
    if (prior) assert.deepEqual(await inventory(output, ['receipts', '.preparation.lock']), prior.body.assets, 'Preparation changed while acquiring its lock')
    else await writeFile(join(output, '.preparation-owner.json'), encode({ kind: 'yugoo-design-desktop-preparation', target, owner }), { flag: 'wx' })
    const slot = `${packageVersion}_${suiteVersion}`, release = join(output, 'releases', slot), releaseWindows = win32.join(windowsOutput, 'releases', slot)
    await mkdir(release, { recursive: true })
    let nativeImport
    if (qwen) {
      const source = join(release, 'configured-template'), suite = join(release, 'yugoo-design')
      await cp(join(materials, 'qwenwork-template'), source, { recursive: true, errorOnExist: true, force: false })
      const plugin = JSON.parse(await readFile(join(source, '.claude-plugin/plugin.json'), 'utf8')); plugin.version = suiteVersion
      await writeFile(join(source, '.claude-plugin/plugin.json'), encode(plugin))
      await qwen.configureQwenWorkPackage(source, qwenworkRuntime)
      await qwen.packageQwenWorkExpertKit(source, suite, runtimeWindows, { includeMcp })
      await writeFile(join(release, 'runtime-pins.json'), encode(qwenworkRuntime), { flag: 'wx' })
      await writeFile(join(release, 'runtime-bootstrap.mjs'), "import {fileURLToPath} from 'node:url'\nprocess.env.YUGOO_QWENWORK_RUNTIME_CONFIG=fileURLToPath(new URL('./runtime-pins.json',import.meta.url))\n", { flag: 'wx' })
      const bootstrap = pathToFileURL(win32.join(releaseWindows, 'runtime-bootstrap.mjs'), { windows: true }).href, locationFile = join(suite, 'scripts/runtime-location.json')
      const location = JSON.parse(await readFile(locationFile, 'utf8')); location.runtimeBootstrap = bootstrap; await writeFile(locationFile, encode(location))
      const skillFile = join(suite, 'skills/yugoo/SKILL.md'), skill = await readFile(skillFile, 'utf8')
      const prefix = 'Use its `nodeExecutable` instead of assuming `node` is on PATH. Execute that packaged script:'
      assert.equal(skill.split(prefix).length, 2, 'QwenWork entry configuration instruction changed')
      await writeFile(skillFile, skill.replace(prefix, 'Use its `nodeExecutable` instead of assuming `node` is on PATH. Read `runtimeBootstrap` from the same location file and insert `--import RUNTIME_BOOTSTRAP` after nodeExecutable for every shared CLI example below. This selects the preparation\'s external native pins while the npm runtime remains immutable; it does not grant native admission or select a conversation. Do not omit this prefix or copy configuration into the npm runtime. Execute that packaged script:'))
      const connector = qwen.qwenWorkConnectorConfiguration(runtimeWindows, qwenworkRuntime)
      connector.mcpServers['design-system'].args.unshift('--import', bootstrap)
      await writeFile(join(release, 'design-system-mcp.json'), encode(connector), { flag: 'wx' })
      if (includeMcp) await writeFile(join(suite, '.mcp.json'), encode(connector))
      const archive = join(release, 'yugoo-design.zip'), zip = await writeSuiteZip(suite, archive)
      nativeImport = { suite, archive, ...zip, connector: join(release, 'design-system-mcp.json'), includeMcp, registration: 'not-performed', next: 'Use the existing Expert Kits importer for this ZIP; keep one connector. Actual imported version and original-session delivery require native verification.' }
    } else {
      const helper = await import(pathToFileURL(join(materials, 'workbuddy-package.mjs')))
      const staged = join(release, 'staged-market')
      // A new default must not rename an already owned/registered marketplace.
      const marketName = prior?.body.nativeImport.marketName
      if (prior) {
        assert.ok(typeof marketName === 'string' && marketName.length, 'Previous WorkBuddy market identity required')
        const previousMarket = JSON.parse(await file(join(output, 'market/.codebuddy-plugin/marketplace.json')))
        assert.equal(previousMarket.name, marketName, 'Previous WorkBuddy market identity mismatch')
      }
      await helper.packageWorkBuddyProbeMarketplace(staged, { nodeExecutable: node, runtimeRoot: runtimeWindows, version: suiteVersion, browserAccess: 'local', ...(prior ? { marketName } : {}) })
      const market = join(output, 'market'), mf = '.codebuddy-plugin/marketplace.json'
      const next = JSON.parse(await readFile(join(staged, mf), 'utf8')), pluginSource = next.plugins[0].source
      for (const name of licenses) await cp(join(materials, name), join(staged, pluginSource, name), { errorOnExist: true, force: false })
      if (!prior) await cp(staged, market, { recursive: true, errorOnExist: true, force: false })
      else {
        await cp(join(staged, pluginSource), join(market, pluginSource), { recursive: true, errorOnExist: true, force: false })
        const temp = join(market, '.codebuddy-plugin', `marketplace-${owner}.json`)
        await writeFile(temp, encode(next), { flag: 'wx' }); await rename(temp, join(market, mf))
      }
      nativeImport = { market, marketName: next.name, pluginSource, registration: 'not-performed', next: prior ? 'Refresh this same market, update the existing suite, then verify the actually loaded version in the original host.' : 'Import this stable market directory using the existing native importer, then verify the actually loaded suite.' }
    }
    assert.equal(sha(await file(join(root, 'package.json'))), sha(manifestBytes), 'Acquired npm manifest changed during preparation')
    assert.equal(sha(await file(join(runtime, 'scripts/design.mjs'))), sha(entry), 'Acquired runtime changed during preparation')
    assert.equal(await verifyMaterials(materials), materialSha256, 'Acquired desktop resources changed during preparation')
    if (nodeRuntime.verified) await verifyNodeRuntime(nodeRuntime)
    body = { schemaVersion: 1, kind: 'desktop-package-preparation', status: 'prepared', target, destination: output, suiteVersion,
      package: { name: packageName, version: packageVersion, npmRoot: root, manifestSha256: sha(manifestBytes), runtimeEntrySha256: sha(entry), materialSha256 },
      windows: { npmRoot: windowsNpm, destination: windowsOutput, nodeExecutable: node, nodeRuntime, runtimeRoot: runtimeWindows, targetPathsVerified: process.platform === 'win32' },
      priorReceiptSha256: prior?.sha256 ?? null, nativeImport, assets: await inventory(output, ['receipts', '.preparation.lock']),
      acquiredManifestVerified: true, registryAcquisitionVerified: false, nativeRegistered: false, loadedVersionVerified: false, runtimeAdmissionVerified: false, releaseValidated: false }
    await mkdir(join(output, 'receipts'), { recursive: true })
    const receiptSha256 = digest(body), receiptFile = join(output, 'receipts', receiptSha256 + '.preparation.json')
    await writeFile(receiptFile, encode({ body, sha256: receiptSha256 }), { flag: 'wx', mode: 0o600 })
    return { ...body, receiptFile, receiptSha256 }
  } catch (error) {
    error.message += '; partial preparation may be retained at ' + output + '. Do not import or automatically retry it.'
    throw error
  } finally {
    if ((await readFile(lock, 'utf8')) === owner) await unlink(lock)
  }
}

function preparationArguments(args) {
  const { values, positionals } = parseArgs({ args, options: { help: { type: 'boolean', short: 'h' }, target: { type: 'string' }, 'package-name': { type: 'string' }, 'package-version': { type: 'string' },
    destination: { type: 'string' }, 'node-executable': { type: 'string' }, 'suite-version': { type: 'string' }, 'npm-root-windows': { type: 'string' }, 'destination-windows': { type: 'string' },
    'qwenwork-runtime': { type: 'string' }, 'separate-mcp': { type: 'boolean' }, 'previous-receipt': { type: 'string' } }, allowPositionals: true })
  assert.equal(positionals.length, 0, 'No positional preparation arguments allowed')
  return values
}

/** Same-version reuse under the owning preparation lease; no artifact or receipt rewrite. */
export async function desktopPreparationReuseMain(args, { npmRoot } = {}) {
  const values = preparationArguments(args)
  if (!values['previous-receipt']) return null
  const output = resolve(values.destination), root = resolve(npmRoot)
  await safe(root); await safe(output)
  assert.equal(await realpath(root), root)
  assert.ok(output !== root && !confined(root, output) && !confined(output, root), 'Preparation must be outside npm package')
  assert.ok(outsideHostProfile(output), 'Do not prepare inside native host profiles')
  const prior = await priorReceipt(resolve(values['previous-receipt'])), body = prior.body
  const manifestBytes = await file(join(npmRoot, 'package.json')), manifest = JSON.parse(manifestBytes)
  if (manifest.version !== body.package.version) return null // The existing preparer owns new-version updates.
  assert.equal(manifest.name, values['package-name']); assert.equal(manifest.version, values['package-version'])
  assert.equal(manifest['x-design-release-review']?.fixture, false, 'Fixture packages cannot reuse desktop imports')
  assert.equal(body.package.npmRoot, resolve(npmRoot), 'Same-version reuse requires the same retained npm directory')
  assert.equal(body.package.manifestSha256, sha(manifestBytes), 'Same-version acquired manifest changed')
  assert.equal(body.target, values.target); assert.equal(body.destination, resolve(values.destination))
  assert.equal(body.suiteVersion, values['suite-version'], 'Same npm version cannot change the native suite version')
  const windowsNpm = windowsPath(values['npm-root-windows'] ?? (process.platform === 'win32' ? npmRoot : undefined))
  const windowsOutput = windowsPath(values['destination-windows'] ?? (process.platform === 'win32' ? body.destination : undefined))
  assert.ok(outsideHostProfile(windowsOutput), 'Do not prepare inside native host profiles')
  if (process.platform === 'win32') { assert.equal(windowsNpm.toLowerCase(), win32.normalize(root).toLowerCase()); assert.equal(windowsOutput.toLowerCase(), win32.normalize(output).toLowerCase()) }
  assert.equal(body.windows.npmRoot, windowsNpm); assert.equal(body.windows.destination, windowsOutput)
  const nodeRuntime = await resolveDesktopNodeRuntime(values['node-executable'] ?? body.windows.nodeExecutable)
  assert.equal(body.windows.nodeExecutable, windowsPath(nodeRuntime.executable), 'Same-version Node path changed')
  if (body.windows.nodeRuntime?.verified) await verifyNodeRuntime(body.windows.nodeRuntime)
  if (body.target === 'qwenwork') {
    assert.equal(body.nativeImport.includeMcp, !values['separate-mcp'], 'Same-version connector policy changed')
    const nativePins = await qwenNodeConfiguration(JSON.parse(await file(resolve(values['qwenwork-runtime']))), nodeRuntime.executable)
    assert.deepEqual(nativePins, JSON.parse(await file(join(dirname(body.nativeImport.suite), 'runtime-pins.json'))), 'Same-version native pins changed')
    if (process.platform === 'win32') for (const [path, expected] of [[nativePins.executable, nativePins.executableSha256], [nativePins.worker, nativePins.workerSha256]])
      assert.equal(await streamHash(path), expected, 'QwenWork native bytes do not match provided pins')
  }
  const lock = join(output, '.preparation.lock'), owner = randomUUID()
  // The inventory excludes this transient file, so bytes alone cannot admit a
  // repeat while another preparation is active or interrupted. Reuse its exact
  // exclusive boundary and recheck the snapshot under our own reservation.
  await writeFile(lock, owner, { flag: 'wx', mode: 0o600 })
  try {
    assert.deepEqual(await priorReceipt(resolve(values['previous-receipt'])), prior, 'Preparation changed while acquiring its reuse lock')
    return { ...body, receiptFile: resolve(values['previous-receipt']), receiptSha256: prior.sha256, idempotent: true }
  } finally {
    assert.equal((await file(lock)).toString(), owner, 'Preparation reuse lock ownership changed; retained for inspection')
    await unlink(lock)
  }
}

export async function desktopPreparationMain(args, { npmRoot } = {}) {
  const values = preparationArguments(args)
  if (values.help) return { kind: 'desktop-preparation-help', status: 'not-applicable', usage: 'design-system prepare-desktop --target qwenwork|workbuddy --package-name EXACT_SCOPED_NAME --package-version EXACT_NPM_VERSION --suite-version NATIVE_RELEASE_VERSION --destination EXTERNAL_DIRECTORY [--node-executable ABSOLUTE_WINDOWS_NODE]',
    options: { '--node-executable': 'Reuse an existing Node >=22.19.0. On Windows, omission discovers a compatible public installation; cross-platform preparation requires an explicit Windows locator and does not verify its executable. Preview/plugin/temporary runtimes are rejected. No Node is downloaded or owned.', '--qwenwork-runtime': 'Explicit JSON with existing QwenWork executable/worker/Node paths and exact executable/worker hashes.', '--separate-mcp': 'QwenWork only: omit the suite connector and emit one external connector JSON for organization policy.', '--previous-receipt': 'Verified successful preparation receipt for an owned new-version update; preserves the same WorkBuddy market.', '--npm-root-windows, --destination-windows': 'Explicit target path mapping required for cross-platform preparation; native Windows paths must match actual roots.' },
    limits: ['Preparation does not acquire from registry, register a host, grant native admission, verify loaded versions or alter a host profile.', 'Acquire the exact npm release first; retain its durable installation and old version until the native update is verified.'] }
  return prepareDesktopPackage({ npmRoot, target: values.target, packageName: values['package-name'], packageVersion: values['package-version'], destination: values.destination,
    nodeExecutable: values['node-executable'], suiteVersion: values['suite-version'], npmRootWindows: values['npm-root-windows'], destinationWindows: values['destination-windows'],
    qwenworkRuntime: values['qwenwork-runtime'] ? JSON.parse(await file(resolve(values['qwenwork-runtime']))) : undefined, includeMcp: !values['separate-mcp'], previousReceiptFile: values['previous-receipt'] })
}
