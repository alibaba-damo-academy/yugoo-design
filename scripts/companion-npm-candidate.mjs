/** Light candidate assembly from supplied assets. Never builds, installs or registers a host. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFile, cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { valid, prerelease } from 'semver'
import { copyOwnLicenseMaterials, OWN_LICENSE_FILES } from './release-own-license.mjs'
import { OFFICIAL_DSH_JSON_AUTHORITY, readOfficialDshJsonInput } from './official-dsh-json-input.mjs'
import { selectCandidateLadybug } from './companion-ladybug-dependency.mjs'
import { prepareBundledJsLicenseMaterials, copyBundledJsLicenseMaterials, BUNDLED_JS_LICENSE_NOTICE, prepareBundledLicenseMaterials, copyBundledLicenseMaterials, prepareBrowserLicenseMaterials, copyBrowserLicenseMaterials, BROWSER_LICENSE_NOTICE, prepareLadybugLicenseMaterials, copyLadybugLicenseMaterials, LADYBUG_MATERIAL_DIRECTORY } from './companion-bundled-license.mjs'
import { PANEL_AUTHORING_RESOURCE, preparePanelAuthoringMaterial, verifyPanelAuthoringMaterial } from './companion-authoring-material.mjs'

import { validateReleaseHosts } from '../packages/companion/src/npm-installer.mjs'
import { stageDesktopPreparationMaterials } from '../packages/companion/npm-desktop-materials.mjs'
import { copyNativeExecutionReference } from '../packages/companion/build-plugin.mjs'
import { verifyCompanionNativeGit } from './companion-native-git.mjs'

const HOSTS = { codex: '.codex-plugin', 'claude-code': '.claude-plugin', qoder: '.qoder-plugin' }
export const OFFICIAL_SMALL_INPUTS = OFFICIAL_DSH_JSON_AUTHORITY
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
function launcher(entry) {
  return `import { existsSync } from 'node:fs'\nconst entry = new URL(${JSON.stringify(entry)}, import.meta.url)\nif (!existsSync(entry)) throw new Error('Missing shared Companion entry: ' + entry.href + '; retain or restore the registered npm version')\nawait import(entry.href)\n`
}

/** Delivery copy is distinct from validation or permission to publish. */
export function validateCompanionDistribution(distribution, { fixture, version }) {
  assert.ok(['candidate', 'beta'].includes(distribution), 'Distribution must be candidate or beta')
  if (distribution === 'beta') {
    assert.equal(fixture, false, 'A fixture cannot become a beta package')
    assert.ok(typeof version === 'string' && prerelease(version)?.[0] === 'beta', 'Beta delivery requires an exact beta prerelease version')
  }
}

async function betaReadme(packageName, version) {
  const source = 'packages/companion/README.md'
  const bytes = await readFile(new URL('../' + source, import.meta.url))
  const text = bytes.toString('utf8')
  const begin = '<!-- npm-package-guide:start -->', end = '<!-- npm-package-guide:end -->'
  assert.equal(text.split(begin).length, 2, 'One maintained npm guide start required')
  assert.equal(text.split(end).length, 2, 'One maintained npm guide end required')
  const start = text.indexOf(begin) + begin.length, stop = text.indexOf(end)
  assert.ok(stop > start, 'Maintained npm guide boundaries are reversed')
  const section = text.slice(start, stop).trim()
  assert.ok(section.includes('<package-selector>'), 'Maintained npm guide requires an exact package selector')
  return {
    text: `# Yugoo Design Companion — beta\n\nPackage: \`${packageName}@${version}\`.\n\n` + section.replaceAll('<package-selector>', `${packageName}@${version}`) + '\n',
    source: { path: source, sourceSha256: sha(bytes), sectionSha256: sha(section) },
  }
}

async function files(root, prefix = '') {
  assert.ok((await lstat(join(root, prefix))).isDirectory(), 'Payload root must be a regular directory, not a symlink')
  const result = []
  for (const name of (await readdir(join(root, prefix))).sort()) {
    assert.notEqual(name, 'node_modules', 'Build-machine node_modules must not enter the payload')
    const path = join(prefix, name)
    const info = await lstat(join(root, path))
    assert.ok(!info.isSymbolicLink(), `Symlink input rejected: ${path}`)
    if (info.isDirectory()) result.push(...await files(root, path))
    else { assert.ok(info.isFile(), 'Only regular payload files accepted'); result.push(path) }
  }
  return result
}

async function newDestination(destination, sourceRoots) {
  const target = resolve(destination)
  const parent = await realpath(dirname(target))
  assert.equal(parent, dirname(target), 'Destination parent must be canonical, without symlink aliases')
  for (const source of sourceRoots) {
    const delta = relative(await realpath(source), target)
    assert.ok(delta && (delta === '..' || delta.startsWith(`..${sep}`) || isAbsolute(delta)), 'Destination must be outside inputs')
  }
  await mkdir(target) // exclusive: an existing directory is never replaced or removed
  return target
}

/** Explicit local selections use the same product validator as the maintained mapping. */
export async function readCompanionReleaseHosts({ licenseRoot, releaseHostsFile, releaseHostsSha256 }) {
  const explicit = releaseHostsFile !== undefined || releaseHostsSha256 !== undefined
  const path = explicit ? releaseHostsFile : join(licenseRoot, 'release/release-hosts.json')
  if (explicit) {
    assert.ok(typeof path === 'string' && isAbsolute(path), 'Absolute release hosts input required')
    assert.match(releaseHostsSha256 ?? '', /^[a-f0-9]{64}$/u, 'Exact release hosts input SHA-256 required')
    assert.equal(await realpath(path), path, 'Canonical release hosts input required')
    assert.ok((await lstat(path)).isFile(), 'Regular release hosts input required')
  }
  let bytes
  try { bytes = await readFile(path) }
  catch (error) { if (explicit || error.code !== 'ENOENT') throw error }
  if (!bytes) return { bytes: undefined, source: null, selection: null }
  const hash = sha(bytes)
  if (explicit) assert.equal(hash, releaseHostsSha256, 'Release hosts input hash changed')
  return { bytes, source: { path, sha256: hash }, selection: validateReleaseHosts(JSON.parse(bytes)) }
}

export async function buildCompanionCandidate({ payloadSource, destination, licenseRoot, officialInputRoot, scope, packageName, version, ladybugVersion, ladybugDependency, fixture, distribution = 'candidate', releaseHostsFile, releaseHostsSha256 }) {
  assert.equal(typeof fixture, 'boolean', 'Explicit fixture or non-fixture candidate mode required')
  assert.match(scope ?? '', /^@[a-z0-9][a-z0-9._-]*$/u)
  assert.ok(typeof version === 'string' && valid(version) === version, 'Explicit canonical versions required')
  validateCompanionDistribution(distribution, { fixture, version })
  const maintainedReadme = distribution === 'beta' ? await betaReadme(packageName, version) : undefined
  const selectedLadybug = selectCandidateLadybug({ ladybugDependency, ladybugVersion, scope })
  if (!fixture) {
    assert.match(packageName ?? '', /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u, 'Non-fixture candidate requires an explicit npm package name')
    assert.ok(packageName.startsWith(scope + '/'), 'Package name must match the explicit scope')
    assert.ok(!scope.startsWith('@fixture'), 'Fixture scopes cannot identify a non-fixture candidate')
    assert.equal(selectedLadybug, '0.21.1', 'Non-fixture candidate requires the official exact Ladybug dependency')
  } else assert.equal(packageName, undefined, 'Fixture names are generated from the fixture scope')
  const releaseHosts = await readCompanionReleaseHosts({ licenseRoot, releaseHostsFile, releaseHostsSha256 })
  const payloadFiles = await files(payloadSource)
  await verifyCompanionNativeGit(join(payloadSource, 'shared'))
  const required = ['shared/scripts/design.mjs', 'shared/web/index.html', 'shared/knowledge/runtime.mjs', 'shared/knowledge/embedding-worker.js', 'shared/knowledge/cli-lifecycle.mjs', 'shared/kits/web_app/kit.yaml']
  required.push(`shared/${PANEL_AUTHORING_RESOURCE}`)
  for (const host of Object.keys(HOSTS)) required.push(`overlays/${host}/${HOSTS[host]}/plugin.json`, `overlays/${host}/.mcp.json`)
  const portableFiles = new Set(payloadFiles.map(path => path.split(sep).join('/')))
  for (const path of required) assert.ok(portableFiles.has(path), `Missing candidate asset: ${path}`)
  await verifyPanelAuthoringMaterial(join(payloadSource, 'shared'), await preparePanelAuthoringMaterial(fileURLToPath(new URL('../', import.meta.url))))
  const officialInputs = await readOfficialDshJsonInput({ inputRoot: officialInputRoot })
  for (const name of OWN_LICENSE_FILES) await readFile(join(licenseRoot, name))
  const bundledLicenseEntries = await prepareBundledLicenseMaterials(licenseRoot)
  const bundledJsLicenseEntries = await prepareBundledJsLicenseMaterials(licenseRoot)
  const browserLicenseEntries = await prepareBrowserLicenseMaterials(licenseRoot)
  const ladybugLicenseEntries = selectedLadybug === '0.21.1' ? await prepareLadybugLicenseMaterials(licenseRoot) : null
  const releaseHostsBytes = releaseHosts.bytes
  const template = JSON.parse(await readFile(new URL('../docs/companion-npm-fixture-2026-09-30.json', import.meta.url), 'utf8'))
  template.name = fixture ? `${scope}/design-system-companion` : packageName
  template.version = version
  if(releaseHostsBytes)template.files=[...new Set([...template.files,'release-hosts.json'])]
  template.description = distribution === 'beta'
    ? 'Yugoo Design Companion beta: interactive Design Projects and Panels in supported native Agent Hosts.'
    : fixture
    ? 'Assembled Companion review candidate; installation and release validation remain incomplete.'
    : 'yugoo-design unpublished npm candidate; installation and release validation remain incomplete.'
  delete template['x-design-release-review'].payloadImplemented
  Object.assign(template['x-design-release-review'], { fixture, distribution, payloadAssembled:true, installImplemented:false, releaseValidated:false })
  template['x-design-release-review'].nativeGit = 'shared-core-library'
  if (distribution === 'beta') template.publishConfig = { access: 'public', tag: 'beta' }
  template.dependencies['@ladybugdb/wasm-core'] = selectedLadybug
  if (selectedLadybug === '0.21.1') assert.ok(portableFiles.has('shared/knowledge/runtime-manifest.json'), 'Official Ladybug candidate requires a knowledge runtime manifest')
  if (portableFiles.has('shared/knowledge/runtime-manifest.json')) {
    const runtime = JSON.parse(await readFile(join(payloadSource, 'shared/knowledge/runtime-manifest.json'), 'utf8'))
    assert.deepEqual(runtime.runtimeDependencies, template.dependencies, 'Knowledge runtime dependencies must match selected candidate dependencies')
  }
  const target = await newDestination(destination, [payloadSource, licenseRoot, officialInputRoot])
  if(releaseHostsBytes)await writeFile(join(target,'release-hosts.json'),releaseHostsBytes,{flag:'wx'})
  await mkdir(join(target, 'payload'))
  for (const path of payloadFiles) {
    await mkdir(dirname(join(target, 'payload', path)), { recursive: true })
    await cp(join(payloadSource, path), join(target, 'payload', path), { errorOnExist: true, force: false })
  }
  await stageDesktopPreparationMaterials(join(target, 'payload/desktop-preparation'), { licenseRoot })
  for (const [host, directory] of Object.entries(HOSTS)) {
    const overlay = join(target, 'payload/overlays', host)
    const path = join(overlay, directory, 'plugin.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(manifest.name, 'yugoo-design', 'Host overlay must declare the current plugin identity')
    manifest.version = version
    await writeFile(path, JSON.stringify(manifest, null, 2) + '\n')
    if (host !== 'codex') await copyNativeExecutionReference(overlay, { host })
    await mkdir(join(overlay, 'scripts'), { recursive: true })
    // Replace only our candidate shim; never touch the source overlay.
    await writeFile(join(overlay, 'scripts/design.mjs'), launcher('../../../shared/scripts/design.mjs'))
  }
  await copyOwnLicenseMaterials(licenseRoot, target)
  await mkdir(join(target, 'licenses'))
  await writeFile(join(target, 'licenses/DSH-LICENSE'), officialInputs.licenseBytes, { flag: 'wx' })
  const bundledLicenseMaterials = await copyBundledLicenseMaterials(bundledLicenseEntries, target)
  const bundledJsLicenseMaterials = await copyBundledJsLicenseMaterials(bundledJsLicenseEntries, target)
  await appendFile(join(target, 'NOTICE'), BUNDLED_JS_LICENSE_NOTICE)
  const browserLicenseMaterials = await copyBrowserLicenseMaterials(browserLicenseEntries, target)
  await appendFile(join(target, 'NOTICE'), BROWSER_LICENSE_NOTICE)
  const ladybugLicenseMaterials = ladybugLicenseEntries ? await copyLadybugLicenseMaterials(ladybugLicenseEntries, target) : null
  if (ladybugLicenseMaterials) await appendFile(join(target, 'NOTICE'), `\nOfficial @ladybugdb/wasm-core@0.21.1 license and source notices: licenses/${LADYBUG_MATERIAL_DIRECTORY}/. See LICENSE, README.md, SOURCE.json, BUILD-SOURCE.json and source-materials/ indexes in that directory. Original third-party texts remain separately licensed; this material does not establish complete binary inventory or release license acceptance.\n`)
  await json(join(target, 'package.json'), template)
  await writeFile(join(target, 'README.md'), maintainedReadme?.text ?? (fixture
    ? 'Review fixture only. Use the single authoritative installation guide. No host was installed.\n'
    : [
      '# yugoo-design Companion — unpublished npm candidate',
      '',
      `Candidate: ${packageName}@${version}. This package is not a published or approved release.`,
      '',
      '## Start with the installed CLI',
      '',
      'First-release local embedding runs on CPU. Before the first acquisition, set ONNXRUNTIME_NODE_INSTALL_CUDA=skip in the installation child environment and retain normal dependency lifecycle scripts. For POSIX shells:',
      '',
      '```sh',
      'ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --ignore-scripts=false --save-exact /absolute/path/to/received-exact-candidate.tgz',
      '```',
      '',
      'For Windows PowerShell, set `$env:ONNXRUNTIME_NODE_INSTALL_CUDA = "skip"` around acquisition and restore its previous Process environment value afterwards. Preserve all other environment values. Apply this policy to subsequent host-installation children that acquire dependencies too. The maintained DSH adapter supplies it to the official CLI for both Web and Desktop.',
      '',
      'A bare npm/npx acquisition does not select this CPU installation policy automatically: dependencies install before this package CLI can run. Do not substitute blanket ignore-scripts or a later parent postinstall. This skips the extra CUDA download, preserves upstream packages, and does not remove the separate embedding-model download/cache step. The default product does not provision GPU runtimes; optional GPU support and configurable or user-local model selection are future work.',
      '',
      'After installing this exact candidate tarball in your chosen test directory, run from that directory:',
      '',
      '```sh',
      'npx --no-install design-system --help',
      '```',
      '',
      'This prints the current commands, required host-specific inputs and limitations without registering a host. Do not substitute a fixture package or an unpinned latest version.',
      '',
      'Claude Code: run `npx --no-install design-system install --host claude-code --claude-executable /absolute/path/to/claude --receipt-dir /absolute/external/receipts` once. Qoder CLI: run `npx --no-install design-system install --host qoder --qoder-executable /absolute/path/to/qodercli --receipt-dir /absolute/external/receipts` once. These use native user-scope persistent registration. Then start the host normally in your project and use `/yugoo-design:yugoo`; no --plugin-dir is required. Keep the npm installation at its registered path. Qoder supports an optional existing --qoder-config-dir; omission preserves native defaults. Qoder registration is not a runtime readiness test: use check-runtime separately. Claude direct install checks runtime before applying. No model is launched by registration. Linux CLI is the existing tested scope.',
      '',
      'The optional `plugin-directory --host claude-code` (or qoder) command returns a session-only diagnostic entry, not installation. Codex retains its saved-plan and matching runtime-receipt route. Claude also supports saved plans and owned receipt recovery/uninstall. Qoder preserves unknown or modified registrations and requires explicit native uninstall before replacement. DSH uses this product entry to install its mapped aggregate and internal modules automatically into an existing external DSH host; official CLI/Loader pins and an existing profile are required. Bound release-hosts.json supplies its aggregate selector and registry. DSH failures retain partial state without rollback.',
      '',
      'Recovery/uninstall require the matching owned receipt. Retain project data and the registered shared npm version; do not delete profiles or retry an unknown delivery automatically.',
      '',
      'Assembly does not verify host registration, runtime loading, models, platforms or release approval. No host was installed.',
      '',
    ].join('\n')), { flag: 'wx' })
  await mkdir(join(target, 'bin'))
  // The installer imports these helpers independently of the payload Hooks.
  for(const name of ['windows-private-storage.mjs','windows-native-platform.mjs'])
    await cp(new URL('../packages/companion/src/'+name,import.meta.url),join(target,'bin',name),{errorOnExist:true,force:false})
  for(const [source,name] of [['npm-installer.mjs','installer.mjs'],['npm-agent-installation.mjs','npm-agent-installation.mjs'],['npm-desktop-preparation.mjs','npm-desktop-preparation.mjs'],['npm-installer-codex.mjs','npm-installer-codex.mjs'],['npm-installer-dsh.mjs','npm-installer-dsh.mjs'],['npm-installer-dsh-desktop.mjs','npm-installer-dsh-desktop.mjs'],['npm-installer-claude.mjs','npm-installer-claude.mjs'],['npm-installer-qoder.mjs','npm-installer-qoder.mjs'],['npm-runtime-check.mjs','npm-runtime-check.mjs'],['npm-installer-paths.mjs','npm-installer-paths.mjs']]) {
    await cp(new URL('../packages/companion/src/'+source,import.meta.url),join(target,'bin',name),{errorOnExist:true,force:false})
  }
  const bin = `#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { installerMain } from './installer.mjs'
const args=process.argv.slice(2)
const dshInstall=args[0]==='install'&&args.some((arg,index)=>arg==='--host=dsh'||arg==='--host'&&args[index+1]==='dsh')
const cancellation=new AbortController()
const cancel=()=>cancellation.abort()
if(dshInstall) { process.on('SIGINT',cancel);process.on('SIGTERM',cancel) }
try {
  const result=await installerMain(args,{npmRoot:fileURLToPath(new URL('../',import.meta.url)),signal:dshInstall?cancellation.signal:undefined})
  console.log(JSON.stringify(result))
  if(process.argv[2]==='check-runtime'&&!['load-verified','disabled','not-applicable'].includes(result.status))process.exitCode=1
  if(result.status==='failed-partial-state-retained')process.exitCode=1
  if(['runtime-not-ready','unsupported-host'].includes(result.status))process.exitCode=1
  if(['host-selection-required','inputs-required'].includes(result.status))process.exitCode=2
} catch(error) {
  console.error(error.installation ? JSON.stringify({error:error.message,installation:error.installation}) : error.message)
  process.exitCode=1
} finally {
  if(dshInstall) { process.off('SIGINT',cancel);process.off('SIGTERM',cancel) }
}
`
  await writeFile(join(target, 'bin/design-system.mjs'), bin, { flag: 'wx', mode: 0o755 })
  const currentReleaseHosts = await readCompanionReleaseHosts({ licenseRoot, releaseHostsFile, releaseHostsSha256 })
  assert.deepEqual(currentReleaseHosts.source, releaseHosts.source, 'Release hosts input drift during assembly')
  const assets = {}
  for (const path of await files(target)) assets[path.split(sep).join('/')] = sha(await readFile(join(target, path)))
  const inventory = {
    schemaVersion: 1, fixture, distribution, publishReady: false, version,
    ...(maintainedReadme ? { readmeSource: maintainedReadme.source } : {}),
    assets, dependencies: template.dependencies, ladybugDependency: selectedLadybug,
    ...(releaseHosts.source ? { releaseHostsInput: releaseHosts.source } : {}),
    dependencyLicensesVerified: false, nativeDependenciesVerified: false, platformsVerified: [],
    ownLicenseFiles: OWN_LICENSE_FILES,
    bundledLicenseMaterials,
    bundledJsLicenseMaterials,
    browserLicenseMaterials,
    ladybugLicenseMaterials,
    officialInputs: { ...OFFICIAL_SMALL_INPUTS, contentHashesVerified: true, networkAvailabilityVerified: false, usedByBuildVerified: false },
    missingValidation: ['Actual production bundle/third-party license inventory', 'Public registry/native lifecycle/common runtime', 'Model/CPU inference', 'Host configuration and complete Bundle/GRA/KAG acceptance'],
  }
  await json(join(target, 'release-manifest.json'), inventory)
  return { target, inventory }
}

/** Prepare a copied registration candidate only. The caller supplies an exclusive owned target. */
export async function copyCompanionRegistration({ npmRoot, destination, host }) {
  assert.ok(Object.hasOwn(HOSTS, host), 'Unknown Companion host')
  const root = await realpath(npmRoot)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest['x-design-release-review']?.fixture, true)
  const source = join(root, 'payload/overlays', host)
  const paths = await files(source)
  const target = await newDestination(destination, [root])
  for (const path of paths) {
    await mkdir(dirname(join(target, path)), { recursive: true })
    await cp(join(source, path), join(target, path), { errorOnExist: true, force: false })
  }
  const entry = pathToFileURL(join(root, 'payload/shared/scripts/design.mjs')).href
  await writeFile(join(target, 'scripts/design.mjs'), launcher(entry))
  const receipt = { fixture: true, installed: false, host, package: manifest.name, version: manifest.version, sharedEntry: entry, npmRoot: root }
  await json(join(target, 'candidate-registration-receipt.json'), receipt)
  return receipt
}
