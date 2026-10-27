/** DSH CI preparation and read-only registry guards. Publication lives only in Actions. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { appendFile, cp, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { validateReleaseVersion } from './prepare-companion-release.mjs'

export const DSH_SOURCE_PACKAGES = Object.freeze(['yugoo-design-git-native', 'dsh-design-core', 'dsh-design-knowledge-ladybug', 'dsh-design-panel', 'dsh-design-provider-web-app', 'dsh-design-skills-web-app', 'dsh-design-studio', 'dsh-design-studio-ui', 'dsh-design-studio-dsh', 'dsh-design-system-dsh'])
export const REGISTRY = 'https://registry.npmjs.org'
export const REPOSITORY = 'alibaba-damo-academy/yugoo-design'
const workspace = fileURLToPath(new URL('../', import.meta.url))
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const git = args => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' }).trim()

export function selectDshRelease({ manifest, expectedVersion, releaseRef, requireTag = false }) {
  assert.equal(manifest?.schemaVersion, 1)
  assert.equal(manifest.hosts?.dsh?.aggregatePackage, '@yugoo-design/dsh-design-system-dsh')
  assert.equal(manifest.hosts.dsh.registry, REGISTRY)
  const version = validateReleaseVersion(manifest.hosts.dsh.aggregateVersion)
  if (expectedVersion !== undefined && expectedVersion !== '') assert.equal(validateReleaseVersion(expectedVersion), version, 'Expected version must match release/release-hosts.json')
  assert.equal(typeof requireTag, 'boolean')
  assert.ok(releaseRef === undefined || releaseRef === '' || typeof releaseRef === 'string' && /^refs\/(heads|tags)\//u.test(releaseRef), 'Expected branch or tag ref')
  if (requireTag || releaseRef?.startsWith('refs/tags/')) assert.equal(releaseRef, `refs/tags/dsh-v${version}`, 'DSH tag must match release-hosts exactly')
  return { version }
}

/** Runtime and required own peers both participate; aggregate is always last. */
export function publicationOrder(entries) {
  assert.deepEqual(entries.map(x => x.sourceName).sort(), [...DSH_SOURCE_PACKAGES].sort(), 'Exactly ten DSH packages required')
  const byName = new Map(entries.map(x => [x.name, x]))
  assert.equal(byName.size, 10)
  for (const entry of entries) {
    assert.equal(entry.name, '@yugoo-design/' + entry.sourceName)
    validateReleaseVersion(entry.version)
    assert.equal(entry.version, entries[0].version, 'DSH release versions must be uniform')
    assert.ok(Array.isArray(entry.dependencies) && new Set(entry.dependencies).size === entry.dependencies.length)
    for (const dependency of entry.dependencies) assert.ok(byName.has(dependency) && dependency !== entry.name, 'Unknown or self dependency')
  }
  const aggregate = '@yugoo-design/dsh-design-system-dsh'
  const pending = new Set(byName.keys()), ordered = []
  while (pending.size) {
    const next = [...pending].sort().find(name => (name !== aggregate || pending.size === 1) && byName.get(name).dependencies.every(dep => !pending.has(dep)))
    assert.ok(next, 'Cyclic DSH publication graph')
    ordered.push(byName.get(next)); pending.delete(next)
  }
  return ordered
}

export async function verifyDshReceipt(receiptFile, { sourceCommit = git(['rev-parse', 'HEAD']) } = {}) {
  const receipt = await json(receiptFile)
  assert.equal(receipt.kind, 'dsh-same-source-release')
  assert.equal(receipt.sourceCommit, sourceCommit, 'Prepared source commit changed')
  assert.equal(receipt.registry, REGISTRY)
  assert.equal(receipt.published, false)
  validateReleaseVersion(receipt.version)
  const ordered = publicationOrder(receipt.entries)
  assert.deepEqual(receipt.entries, ordered, 'Receipt publication order changed')
  for (const entry of ordered) {
    assert.equal(entry.version, receipt.version)
    assert.equal(entry.filename, entry.name.slice(1).replace('/', '-') + '-' + entry.version + '.tgz')
    assert.equal(basename(entry.filename), entry.filename)
    const path = join(dirname(receiptFile), 'distribution/tarballs', entry.filename)
    assert.ok((await lstat(path)).isFile() && !(await lstat(path)).isSymbolicLink(), 'Regular prepared archive required')
    const bytes = await readFile(path)
    assert.equal(bytes.length, entry.bytes)
    assert.equal(sha256(bytes), entry.sha256, 'Prepared tarball changed')
    assert.equal(integrity(bytes), entry.integrity, 'Prepared integrity changed')
  }
  return receipt
}

/** Compare metadata AND downloaded bytes. No error except a version 404 means absent. */
export async function registryState(entry, { fetchImpl = fetch, maxBytes = 128 * 1024 * 1024 } = {}) {
  assert.ok(DSH_SOURCE_PACKAGES.includes(entry.sourceName))
  assert.equal(entry.name, '@yugoo-design/' + entry.sourceName)
  validateReleaseVersion(entry.version)
  assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/u)
  const options = { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000) }
  const response = await fetchImpl(`${REGISTRY}/${encodeURIComponent(entry.name)}/${entry.version}`, { ...options, headers: { accept: 'application/json' } })
  if (response.status === 404) return 'absent'
  assert.equal(response.status, 200, `Registry lookup failed for ${entry.name}: HTTP ${response.status}`)
  const data = await response.json()
  assert.equal(data.name, entry.name); assert.equal(data.version, entry.version)
  assert.equal(data.dist?.integrity, entry.integrity, `Published integrity differs: ${entry.name}@${entry.version}`)
  const url = new URL(data.dist.tarball)
  assert.equal(url.origin, REGISTRY, 'Official registry tarball required')
  assert.equal(url.username + url.password + url.search + url.hash, '', 'Unexpected tarball URL credentials/query/fragment')
  assert.equal(url.pathname, `/${entry.name}/-/${entry.sourceName}-${entry.version}.tgz`, 'Unexpected registry tarball path')
  const tar = await fetchImpl(url.href, { ...options, signal: AbortSignal.timeout(30000) })
  assert.equal(tar.status, 200, `Registry tarball failed: HTTP ${tar.status}`)
  assert.ok(entry.bytes > 0 && entry.bytes <= maxBytes, 'Archive exceeds registry comparison bound')
  const hash = createHash('sha512'); let size = 0
  try {
    for await (const chunk of tar.body) {
      size += chunk.length
      assert.ok(size <= entry.bytes && size <= maxBytes, 'Registry tarball exceeds expected size')
      hash.update(chunk)
    }
  } finally { if (size > entry.bytes) await tar.body?.cancel?.().catch(() => {}) }
  assert.equal(size, entry.bytes, 'Published tarball size differs')
  assert.equal('sha512-' + hash.digest('base64'), entry.integrity, 'Actual published tarball integrity differs')
  return 'identical'
}

export async function preflight(entries, options) {
  publicationOrder(entries)
  const states = []
  for (const entry of entries) states.push({ name: entry.name, version: entry.version, state: await registryState(entry, options) })
  return states // write only after all ten succeed; no publication callback exists
}
export async function nextPublication(receipt, index, options) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < 10, 'DSH package index required')
  publicationOrder(receipt.entries)
  const entry = receipt.entries[index]
  const state = await registryState(entry, options)
  if (state === 'identical') return { action: 'skip', entry }
  for (const name of entry.dependencies) {
    assert.equal(await registryState(receipt.entries.find(x => x.name === name), options), 'identical', `Required dependency is not published: ${name}`)
  }
  return { action: 'publish', entry }
}
export async function confirmPublication(entry, { attempts = 5, wait = () => delay(2000), ...options } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (await registryState(entry, options) === 'identical') return
    if (i + 1 < attempts) await wait()
  }
  assert.fail(`Published version is not visible; stop without republishing: ${entry.name}`)
}

export async function prepareDshRelease({ version, output, npmCli }) {
  validateReleaseVersion(version)
  selectDshRelease({ manifest: await json(join(workspace, 'release/release-hosts.json')), expectedVersion: version })
  assert.ok(isAbsolute(output) && !resolve(output).startsWith(resolve(workspace) + '/') && resolve(output) !== resolve(workspace), 'Absolute external output required')
  assert.ok(isAbsolute(npmCli), 'Absolute npm CLI required')
  assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'Clean tracked source required before preparation')
  const sourceCommit = git(['rev-parse', 'HEAD'])
  if (process.env.GITHUB_SHA) assert.equal(sourceCommit, process.env.GITHUB_SHA, 'Actions checkout differs from fixed source')
  await mkdir(output)
  const { acquireNativeInputs } = await import('./companion-release-native-donor.mjs')
  const native = await acquireNativeInputs({ workspace, destination: join(output, 'native-artifacts') })
  const nativeSource = await json(join(workspace, 'packages/git-native/SOURCE.json'))
  for (const item of nativeSource.artifacts) {
    const destination = join(workspace, 'packages/git-native', item.path)
    await mkdir(dirname(destination), { recursive: true })
    await cp(join(output, 'native-artifacts', item.path), destination, { force: false, errorOnExist: true })
  }
  const { releasePackagesFor } = await import('./release-consumer-config.mjs')
  const { readNpmCandidates } = await import('./release-npm-candidates.mjs')
  const { assembleDshDistribution, createDshDistributionManifest } = await import('./assemble-dsh-distribution.mjs')
  const report = await readNpmCandidates(workspace, { scope: '@yugoo-design', version, ladybugVersion: '0.21.1', ladybugSource: 'registry' })
  const manifests = Object.fromEntries(DSH_SOURCE_PACKAGES.map(name => [name, createDshDistributionManifest(report, name)]))
  const graph = DSH_SOURCE_PACKAGES.map(sourceName => ({ sourceName, name: manifests[sourceName].name, version, dependencies: Object.keys({ ...manifests[sourceName].dependencies, ...manifests[sourceName].optionalDependencies, ...manifests[sourceName].peerDependencies }).filter(name => name.startsWith('@yugoo-design/')) }))
  const ordered = publicationOrder(graph)
  const buildSteps = []
  for (const entry of ordered) {
    const directory = join(workspace, releasePackagesFor({ ladybugSource: 'registry' })[entry.sourceName])
    const manifest = await json(join(directory, 'package.json'))
    if (!manifest.scripts?.build) continue
    const result = spawnSync('pnpm', ['--dir', directory, 'run', 'build'], { cwd: workspace, stdio: 'inherit', env: { ...process.env, YUGOO_BUILD_MODULE_EVIDENCE_DIR: join(output, 'normal-build') } })
    if (result.error) throw result.error
    assert.equal(result.status, 0, `Normal build failed: ${entry.sourceName}`)
    buildSteps.push(entry.sourceName)
  }
  const { observeDshBuild } = await import('./dsh-release-observations.mjs')
  const observationFile = join(output, 'material-observations.json')
  const observations = await observeDshBuild({ workspace, report, evidenceDirectory: join(output, 'normal-build'), sourceCommit })
  await writeFile(observationFile, JSON.stringify(observations, null, 2) + '\n', { flag: 'wx' })
  const distribution = await assembleDshDistribution({ source: workspace, destination: join(output, 'distribution'), npmCli, scope: '@yugoo-design', version, observationFile, observationSha256: sha256(await readFile(observationFile)) })
  const entries = []
  for (const entry of ordered) {
    const packed = distribution.archives.find(x => x.name === entry.name)
    const bytes = await readFile(packed.archive)
    entries.push({ ...entry, filename: basename(packed.archive), bytes: bytes.length, sha256: sha256(bytes), integrity: integrity(bytes) })
  }
  assert.equal(git(['rev-parse', 'HEAD']), sourceCommit)
  assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'Build changed tracked source')
  const receipt = { kind: 'dsh-same-source-release', version, sourceCommit, registry: REGISTRY, nativeMaterials: native, buildSteps,
    observationSha256: sha256(await readFile(observationFile)), entries,
    published: false, installedHostAccepted: false, completeBundledInventoryVerified: false, releaseLicenseAcceptance: false }
  await writeFile(join(output, 'release-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, file, argument] = process.argv.slice(2)
    if (command === 'select') {
      assert.equal(file, undefined)
      const requireTag = process.env.REQUIRE_RELEASE_TAG ?? 'false'
      assert.ok(['true', 'false'].includes(requireTag))
      const selected = selectDshRelease({ manifest: await json(join(workspace, 'release/release-hosts.json')), expectedVersion: process.env.EXPECTED_RELEASE_VERSION, releaseRef: process.env.RELEASE_REF, requireTag: requireTag === 'true' })
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${selected.version}\n`)
      console.log(JSON.stringify(selected))
    } else if (command === 'prepare') {
      const receipt = await prepareDshRelease({ version: file, output: resolve(argument), npmCli: process.env.NPM_CLI })
      console.log(JSON.stringify(receipt))
    } else {
      assert.ok(['preflight', 'next', 'confirm', 'complete'].includes(command), 'Use select, prepare, preflight, next, confirm or complete; no local publish command')
      const receiptFile = resolve(file), receipt = await verifyDshReceipt(receiptFile)
      selectDshRelease({ manifest: await json(join(workspace, 'release/release-hosts.json')), expectedVersion: receipt.version, releaseRef: process.env.RELEASE_REF, requireTag: process.env.REQUIRE_RELEASE_TAG === 'true' })
      if (command === 'preflight' || command === 'complete') {
        const states = await preflight(receipt.entries)
        if (command === 'complete') assert.ok(states.every(x => x.state === 'identical'), 'Incomplete DSH publication')
        await writeFile(join(dirname(receiptFile), `${command}-registry.json`), JSON.stringify({ sourceCommit: receipt.sourceCommit, states }, null, 2) + '\n', { flag: 'wx' })
        console.log(JSON.stringify(states))
      } else {
        const index = Number(argument)
        assert.match(argument ?? '', /^(?:[0-9])$/u, 'Index from 0 through 9 required')
        if (command === 'confirm') await confirmPublication(receipt.entries[index])
        else {
          const checked = await json(join(dirname(receiptFile), 'preflight-registry.json'))
          assert.equal(checked.sourceCommit, receipt.sourceCommit)
          assert.deepEqual(checked.states.map(x => x.name), receipt.entries.map(x => x.name), 'Full preflight required')
          const next = await nextPublication(receipt, index)
          console.log(JSON.stringify({ action: next.action, tarball: join(dirname(receiptFile), 'distribution/tarballs', next.entry.filename) }))
        }
      }
    }
  } catch (error) { console.error(error); process.exitCode = 1 }
}
