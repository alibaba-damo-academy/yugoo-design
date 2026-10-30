/** One isolated same-source exploratory build. No install, host configuration or model execution. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'tsdown'
import { valid } from 'semver'
import { buildCompanionCandidate, validateCompanionDistribution, readCompanionReleaseHosts } from './companion-npm-candidate.mjs'
import { validateLadybugDependency } from './companion-ladybug-dependency.mjs'
import { packageKnowledge } from '../packages/companion/package-knowledge.mjs'
import { copyNativeHookModules } from '../packages/companion/build-plugin.mjs'
import { copyComponentSkill } from '../packages/companion/component-skill-package.mjs'
import { OWN_LICENSE_FILES } from './release-own-license.mjs'
import { inspectBundledModuleLicense, LADYBUG_MATERIAL_FILES, LADYBUG_MATERIAL_DIRECTORY, EMBEDDED_PICA_LICENSE_SOURCE_PATHS } from './companion-bundled-license.mjs'
import { captureOutputModuleMap, verifyOutputModuleFiles } from './companion-output-module-map.mjs'
import { checkEmitted } from './emitted-loader-check.mjs'
import { PACKAGED_CLI_LIFECYCLE_IMPORT } from './companion-packaged-knowledge.mjs'
import { artifactInventory, inventorySha256, regularFile, sha256, validatePicaWorkerEvidence, PICA_WORKER_PINS } from './pica-worker-evidence.mjs'
import { panelAuthoringInputPaths, preparePanelAuthoringMaterial, writePanelAuthoringMaterial } from './companion-authoring-material.mjs'
import { studioAuthoringInputPaths, prepareStudioAuthoringMaterial, writeStudioAuthoringMaterial } from './studio-authoring-material.mjs'
import { prepareCompanionNativeGit, stageCompanionNativeGit, verifyCompanionNativeGit, COMPANION_NATIVE_GIT_IMPORT, isNativeGitBuildCache } from './companion-native-git.mjs'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const companion = join(workspace, 'packages/companion')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const rootRequire = createRequire(import.meta.url)
const inputRoots = [
  'packages/git-native', 'scripts/companion-native-git.mjs', 'scripts/companion-source-labels.mjs',
  'packages/companion/build-plugin.mjs', 'packages/companion/codex-desktop-package.mjs', 'packages/companion/qwenwork-package.mjs',
  'packages/companion/README.md',
  'scripts/companion-output-module-map.mjs',
  'scripts/companion-bundled-license.mjs', 'third-party/companion',
  ...EMBEDDED_PICA_LICENSE_SOURCE_PATHS,
  ...LADYBUG_MATERIAL_FILES.map(path => `third-party/native/${LADYBUG_MATERIAL_DIRECTORY}/${path}`),
  'packages/companion/src', 'packages/companion/index.html', 'packages/companion/tsdown.config.ts', 'packages/companion/tsdown.server.config.ts', 'packages/companion/package-knowledge.mjs',
  'packages/companion/plugin', 'packages/companion/plugin-claude', 'packages/companion/plugin-qoder',
  ...['core', 'knowledge-ladybug', 'panel', 'provider-web-app', 'studio', 'studio-ui'].flatMap(name => [`packages/${name}/src`, `packages/${name}/package.json`]),
  'packages/provider-web-app/tsdown.config.ts', 'packages/skills-web-app/kits/web_app', 'packages/skills-web-app/package.json', 'packages/skills-web-app/bundles',
  ...OWN_LICENSE_FILES.map(name => `packages/skills-web-app/${name}`),
  'scripts/tsdown-client-styles.ts', 'scripts/component-skill-resource.ts', 'packages/companion/component-skill-package.mjs', 'scripts/graph-layout-worker.ts', 'scripts/graph-browser-dependencies.ts', 'scripts/official-dsh-json-input.mjs',
  'scripts/known-browser-loader-proof.mjs', 'scripts/companion-packaged-knowledge.mjs', 'scripts/emitted-loader-check.mjs', 'scripts/release-own-license.mjs', 'scripts/companion-npm-candidate.mjs', 'scripts/build-companion-npm-candidate.mjs', 'scripts/test-fixtures/official-dsh-json',
  'scripts/pica-worker-evidence.mjs', 'scripts/probe-companion-pica-worker.mjs',
  'scripts/static-pica-emission-proof.mjs', 'scripts/pica-static-worker-compiler.mjs',
  'scripts/pica-static-worker-adapter.mjs', 'scripts/canvas-browser-dependencies.ts', 'scripts/known-flat-browser-loader-proof.mjs',
  'scripts/known-node-loader-proof.mjs',
  'scripts/companion-ladybug-dependency.mjs',
  'scripts/embedded-image-loader-proof.mjs', 'scripts/ui-blob-chain-evidence.mjs', 'scripts/probe-companion-ui-blob-chain.mjs',
  'scripts/product-release.mjs', 'release/release-hosts.json', 'release/product.json', 'release/product-package-template.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', ...OWN_LICENSE_FILES,
]

export async function snapshotCompanionInputs(nativeGitArtifactRoot, { releaseHostsFile } = {}) {
  const files = {}
  async function walk(path) {
    if (path.startsWith('packages/git-native/') && isNativeGitBuildCache(path.slice('packages/git-native/'.length))) return
    let info
    try { info = await lstat(join(workspace, path)) } catch (error) { if (error.code !== 'ENOENT') throw error; files[path] = null; return }
    assert.ok(!info.isSymbolicLink(), `Source symlink rejected: ${path}`)
    if (info.isDirectory()) for (const name of (await readdir(join(workspace, path))).sort()) await walk(`${path}/${name}`)
    else { assert.ok(info.isFile()); files[path] = sha(await readFile(join(workspace, path))) }
  }
  for (const path of new Set([...inputRoots, ...await panelAuthoringInputPaths(workspace), ...await studioAuthoringInputPaths(workspace)])) await walk(path)
  if (releaseHostsFile !== undefined) {
    assert.ok(isAbsolute(releaseHostsFile), 'Absolute release hosts input required')
    assert.equal(await realpath(releaseHostsFile), releaseHostsFile, 'Canonical release hosts input required')
    assert.ok((await lstat(releaseHostsFile)).isFile(), 'Regular release hosts input required')
    files['external-release-hosts:' + releaseHostsFile] = sha(await readFile(releaseHostsFile))
  }
  const native = await prepareCompanionNativeGit(workspace, { artifactRoot: nativeGitArtifactRoot })
  for (const [path, identity] of Object.entries(native.artifactInputs)) files['native-material-input:' + path] = identity.sha256
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
}

/** CSS virtual modules keep physical origin only in private build metadata. */
export async function resolveBundledLicenseSource(id, moduleInfo) {
  if (!id.startsWith('\0dsh-design-css:')) return id
  const origin = moduleInfo?.meta?.dshDesignCssSource
  assert.ok(typeof origin === 'string' && isAbsolute(origin) && !origin.includes('\0') && origin.endsWith('.css'), 'Virtual CSS requires a physical CSS source in build metadata')
  const info = await lstat(origin)
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Virtual CSS source must be a regular non-symlink file')
  return origin
}

function graphGuard(label, records) {
  const modules = new Set()
  const bundledLicenseInputs = new Map()
  const cssOrigins = new Map()
  return {
    name: `same-source-${label}-module-inputs`,
    async transform(_code, id) {
      modules.add(id)
      const sourceId = await resolveBundledLicenseSource(id, this.getModuleInfo(id))
      if (sourceId !== id) cssOrigins.set(id, sourceId)
      const attribution = await inspectBundledModuleLicense(sourceId)
      if (attribution) bundledLicenseInputs.set(attribution.root, attribution)
      const normalized = sourceId.replaceAll('\\', '/')
      for (const name of ['core', 'knowledge-ladybug', 'panel', 'provider-web-app', 'studio', 'studio-ui']) {
        assert.ok(!normalized.startsWith(`${workspace.replaceAll('\\', '/')}/packages/${name}/lib/`), `Stale own lib input rejected: ${id}`)
      }
      return null
    },
    generateBundle() { records.push({ label, modules: [...modules].sort(), bundledLicenseInputs: [...bundledLicenseInputs.values()], cssOrigins: [...cssOrigins].map(([virtualId, physicalOrigin]) => ({ virtualId, physicalOrigin })) }) },
  }
}

/** Consume completed output handles only; never starts a build. Used by buildInto and fake-output tests. */
export async function recordCompletedBuildOutputs(label, bundles, outputRoot, records) {
  try {
    assert.ok(!records.some(record => record.label === label), 'Duplicate emitted build label')
    const snapshot = captureOutputModuleMap(label, bundles.flatMap(bundle => bundle.chunks), { workspaceRoot: workspace, outputRoot })
    const mapping = await verifyOutputModuleFiles(snapshot)
    records.push(mapping)
    return mapping
  } finally {
    // A mapping failure must not leave other returned bundles undisposed.
    const cleanup = await Promise.allSettled(bundles.map(bundle => Promise.resolve().then(() => bundle[Symbol.asyncDispose]())))
    const failure = cleanup.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
  }
}

async function buildInto(label, config, records, emittedMaps = []) {
  assert.equal(config.config, false)
  assert.equal(config.clean, false)
  assert.ok(isAbsolute(config.outDir))
  for (const path of Object.values(config.entry)) assert.ok(isAbsolute(path))
  const result = await build({ ...config, plugins: [...(config.plugins ?? []), graphGuard(label, records)] })
  await recordCompletedBuildOutputs(label, result, config.outDir, emittedMaps)
}

export async function buildFlowScripts(source, outDir, records = [], emittedMaps = []) {
  // Independent CLI modules preserve import.meta.url. Inlining metrics into
  // search would activate metrics' entry guard with search's CLI arguments.
  for (const name of ['layout', 'layout-metrics', 'layout-search']) {
    const entry = join(source, `${name}.mjs`)
    await buildInto(`flow-${name}`, {
      config: false, entry: { [name]: entry }, outDir, format: 'esm', platform: 'node', target: 'node22',
      tsconfig: false, dts: false, clean: false, failOnWarn: true,
      // Each entry is an independent Node CLI; keep its dynamic imports and
      // loader helper inside that artifact. Search retains its explicit sibling
      // metrics import below, rather than exposing internal loader exports.
      outputOptions: { codeSplitting: false },
      deps: { alwaysBundle: [/.*/], onlyBundle: false },
      plugins: [{
        name: 'standalone-kit-no-runtime-imports',
        resolveId(specifier, importer) {
          if (name === 'layout-search' && importer === entry && specifier === './layout-metrics.mjs') return { id: specifier, external: true }
          return null
        },
        async generateBundle(_options, bundle) {
          for (const output of Object.values(bundle)) if (output.type === 'chunk') {
            for (const dependency of [...output.imports, ...output.dynamicImports]) {
              if (dependency.startsWith('node:') || bundle[dependency]) continue
              assert.ok(name === 'layout-search' && dependency === './layout-metrics.mjs', `Unbundled Kit dependency: ${dependency}`)
              const info = await lstat(join(outDir, 'layout-metrics.mjs'))
              assert.ok(info.isFile() && !info.isSymbolicLink(), 'Missing standalone metrics artifact')
            }
          }
        },
      }],
    }, records, emittedMaps)
  }
}

async function copyTree(source, target) {
  const info = await lstat(source)
  assert.ok(!info.isSymbolicLink(), 'Copied source symlink rejected')
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true })
    for (const name of (await readdir(source)).sort()) { assert.notEqual(name, 'node_modules'); await copyTree(join(source, name), join(target, name)) }
  } else { assert.ok(info.isFile()); await mkdir(dirname(target), { recursive: true }); await cp(source, target, { force: false, errorOnExist: true }) }
}

/** Select an explicit package identity; selection never grants release acceptance. */
export function parseSameSourceBuildArgs(args) {
  const flags = {}
  const allowed = ['--ladybug-dependency', '--candidate-mode', '--package-name', '--version', '--distribution', '--native-git-artifacts', '--release-hosts-file', '--release-hosts-sha256']
  assert.ok(args.length % 2 === 0, 'Build options require values')
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    assert.ok(allowed.includes(key) && !Object.hasOwn(flags, key), 'Unknown or duplicate build option')
    assert.ok(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), `Missing value for ${key}`)
    flags[key] = value
  }
  const ladybugDependency = validateLadybugDependency(flags['--ladybug-dependency'])
  const nativeGitArtifactRoot = flags['--native-git-artifacts']
  if (nativeGitArtifactRoot !== undefined) assert.ok(isAbsolute(nativeGitArtifactRoot), 'Native Git artifact root must be absolute')
  const releaseHostsFile = flags['--release-hosts-file'], releaseHostsSha256 = flags['--release-hosts-sha256']
  const releaseHosts = releaseHostsFile === undefined && releaseHostsSha256 === undefined ? {} : { releaseHostsFile, releaseHostsSha256 }
  if (Object.keys(releaseHosts).length) {
    assert.ok(typeof releaseHostsFile === 'string' && isAbsolute(releaseHostsFile), 'Absolute release hosts input required')
    assert.match(releaseHostsSha256 ?? '', /^[a-f0-9]{64}$/u, 'Exact release hosts input SHA-256 required')
  }
  const mode = flags['--candidate-mode'] ?? 'fixture'
  assert.ok(['fixture', 'non-fixture'].includes(mode), 'Candidate mode must be fixture or non-fixture')
  const version = flags['--version']
  const distribution = flags['--distribution']
  if (distribution !== undefined) validateCompanionDistribution(distribution, { fixture: mode === 'fixture', version })
  if (version !== undefined) assert.equal(valid(version), version, 'Explicit canonical candidate version required')
  if (mode === 'fixture') {
    assert.equal(flags['--package-name'], undefined, 'Fixture names are generated, not supplied')
    return { ladybugDependency, ...(nativeGitArtifactRoot ? { nativeGitArtifactRoot } : {}), ...releaseHosts, candidate: { fixture: true, scope: '@fixture-design-release', ...(version ? { version } : {}), ...(distribution ? { distribution } : {}) } }
  }
  const packageName = flags['--package-name']
  assert.match(packageName ?? '', /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u, 'Explicit candidate package name required')
  const scope = packageName.startsWith('@') ? packageName.split('/')[0] : '@yugoo-design'
  assert.ok(!scope.startsWith('@fixture'), 'Fixture scopes cannot identify a non-fixture candidate')
  assert.ok(version, 'Non-fixture candidate requires an explicit version')
  assert.equal(ladybugDependency, '0.21.1', 'Non-fixture candidate requires the official exact Ladybug dependency')
  return { ladybugDependency, ...(nativeGitArtifactRoot ? { nativeGitArtifactRoot } : {}), ...releaseHosts, candidate: { fixture: false, scope, packageName, version, ...(distribution ? { distribution } : {}) } }
}

export async function buildSameSourceCandidate({ ladybugDependency, nativeGitArtifactRoot, releaseHostsFile, releaseHostsSha256, candidate = { fixture: true, scope: '@fixture-design-release' } } = {}) {
  const selectedLadybug = validateLadybugDependency(ladybugDependency)
  const root = await mkdtemp(join(await realpath(tmpdir()), 'dsh-companion-same-source-build-'))
  const report = { root, kind: 'same-source-exploratory-build', candidateAccepted: false, dynamicClosureVerified: false, publishReady: false, registryChecked: false, nativeDependenciesVerified: false, dependencyLicensesVerified: false, platformsVerified: [], steps: [], moduleInputs: [], emittedModuleMaps: [] }
  const save = name => writeFile(join(root, name), JSON.stringify(report, null, 2) + '\n')
  let before
  try {
    const releaseHosts = await readCompanionReleaseHosts({ licenseRoot: workspace, releaseHostsFile, releaseHostsSha256 })
    report.releaseHostsInput = releaseHosts.source
    before = await snapshotCompanionInputs(nativeGitArtifactRoot, { releaseHostsFile })
    await writeFile(join(root, 'inputs-before.json'), JSON.stringify(before, null, 2) + '\n', { flag: 'wx' })
    report.head = spawnSync('git', ['--no-optional-locks', 'rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).stdout.trim()
    report.dirty = Boolean(spawnSync('git', ['--no-optional-locks', 'status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).stdout.trim())
    report.node = process.versions.node
    report.toolchain = { tsdownEntry: rootRequire.resolve('tsdown'), rolldownUtils: createRequire(rootRequire.resolve('tsdown')).resolve('rolldown/utils') }
    const template = JSON.parse(await readFile(join(workspace, 'release/product-package-template.json'), 'utf8'))
    template.dependencies['@ladybugdb/wasm-core'] = selectedLadybug
    report.runtimeDependencies = template.dependencies
    report.ladybugDependency = selectedLadybug
    report.candidateSelection = { ...candidate, version: candidate.version ?? template.version }
    // The nested layout worker is emitted as a virtual string, so its modules
    // are not all visible to the outer graph guard. Resolve from its importer.
    report.nestedElkLicenseInput = await inspectBundledModuleLicense(createRequire(join(workspace, 'packages/panel/src/client/graph-layout.mjs')).resolve('elkjs/lib/elk.bundled.js'))
    assert.ok(report.nestedElkLicenseInput, 'Missing nested worker ELK source identity')
    const source = join(root, 'payload-input'), shared = join(source, 'shared')
    await mkdir(shared, { recursive: true })
    const native = await prepareCompanionNativeGit(workspace, { artifactRoot: nativeGitArtifactRoot })
    report.nativeGitArtifactInputs = native.artifactInputs
    report.nativeGitMaterials = await stageCompanionNativeGit(shared, native)
    await writePanelAuthoringMaterial(shared, await preparePanelAuthoringMaterial(workspace))
    const creatorMethods = await prepareStudioAuthoringMaterial(workspace)
    await writeStudioAuthoringMaterial(shared, creatorMethods, { skills: false })
    const server = (await import(pathToFileURL(join(companion, 'tsdown.server.config.ts')))).default
    const web = (await import(pathToFileURL(join(companion, 'tsdown.config.ts')))).default
    assert.equal(server.failOnWarn, true); assert.equal(web.failOnWarn, true)
    assert.ok((await readFile(join(workspace, 'scripts/graph-layout-worker.ts'), 'utf8')).includes('write: false'), 'Nested graph worker must not write to source output')
    const stage = async (name, work) => { const start = Date.now(); try { await work(); report.steps.push({ name, status: 'completed', elapsedMs: Date.now() - start }) } catch (error) { report.steps.push({ name, status: 'failed', message: error.message }); throw error } }
    await stage('server', () => buildInto('server', { ...server, config: false, entry: Object.fromEntries(Object.entries(server.entry).map(([name, path]) => [name, resolve(companion, path)])), outDir: join(shared, 'scripts'), clean: false }, report.moduleInputs, report.emittedModuleMaps))
    await stage('web', () => buildInto('web', { ...web, config: false, entry: { client: join(companion, 'src/client.tsx') }, outDir: join(shared, 'web'), clean: false }, report.moduleInputs, report.emittedModuleMaps))
    await cp(join(companion, 'index.html'), join(shared, 'web/index.html'))
    await stage('knowledge', async () => {
      const result = await packageKnowledge(undefined, { mode: 'portable', outputDirectory: join(shared, 'knowledge'), runtimeDependencies: template.dependencies,
        buildImpl: config => buildInto('knowledge-' + Object.keys(config.entry)[0], config, report.moduleInputs, report.emittedModuleMaps) })
      assert.deepEqual(result.manifest.runtimeDependencies, template.dependencies)
      report.knowledgeBuildAdapter = result.manifest.buildAdapter // instrumented real tsdown adapter is explicitly labelled injected
    })
    const kit = join(shared, 'kits/web_app'); await mkdir(kit, { recursive: true })
    await copyTree(join(workspace, 'packages/skills-web-app/kits/web_app'), kit)
    await copyTree(join(workspace, 'packages/skills-web-app/bundles'), join(shared, 'bundles'))
    for (const name of OWN_LICENSE_FILES) await copyTree(join(workspace, 'packages/skills-web-app', name), join(kit, name))
    await stage('flow-layout', () => buildFlowScripts(join(workspace, 'packages/skills-web-app/bundles/flow_design/scripts'), join(shared, 'bundles/flow_design/scripts'), report.moduleInputs, report.emittedModuleMaps))
    for (const [host, overlay] of Object.entries({ codex: 'plugin', 'claude-code': 'plugin-claude', qoder: 'plugin-qoder' })) {
      const target = join(source, 'overlays', host)
      await copyTree(join(companion, overlay, 'design-system'), target)
      // Native plugin materialization projects overlays, not the shared runtime tree.
      await writeStudioAuthoringMaterial(target, creatorMethods)
      if (host !== 'codex') await copyComponentSkill(target, join(companion, 'plugin/design-system/skills/design-component/SKILL.md'))
      if (host !== 'codex') await copyNativeHookModules(target, { host, sourceDirectory: join(companion, 'src') })
    }
    await stage('residual-imports', async () => {
      report.emitted = await inspectStagedPayload(shared, template.dependencies, {
        webModuleMap: report.emittedModuleMaps.find(mapping => mapping.label === 'web'),
      })
      report.pendingTasks = pendingRuntimeTasks(report.emitted)
      // Historical compatibility projection: this field has held pending task
      // records, not raw loader ranges. Each emitted record keeps its actual
      // unverified array; static-Worker tasks do not invent legacy unknowns.
      report.staticUnknown = report.pendingTasks
      report.nonliteralLoadCallsVerified = false
    })
    await stage('candidate', async () => {
      const candidate = await buildCompanionCandidate({ payloadSource: source, destination: join(root, 'candidate'), licenseRoot: workspace, officialInputRoot: join(workspace, 'scripts/test-fixtures/official-dsh-json'), ...report.candidateSelection, ladybugDependency: selectedLadybug, releaseHostsFile, releaseHostsSha256 })
      report.candidate = candidate.target
      assert.deepEqual(candidate.inventory.dependencies, template.dependencies)
      const runtime = JSON.parse(await readFile(join(candidate.target, 'payload/shared/knowledge/runtime-manifest.json'), 'utf8'))
      assert.deepEqual(runtime.runtimeDependencies, candidate.inventory.dependencies)
      report.candidateInputs = await artifactInventory(candidate.target)
      report.candidateInventorySha256 = inventorySha256(report.candidateInputs)
      report.workerTaskGate = 'runtime-evidence-required'
    })
    report.buildCompleted = true
  } catch (error) { report.buildCompleted = false; report.error = { name: error.name, message: error.message } }
  finally {
    try {
      const after = await snapshotCompanionInputs(nativeGitArtifactRoot, { releaseHostsFile })
      await writeFile(join(root, 'inputs-after.json'), JSON.stringify(after, null, 2) + '\n', { flag: 'wx' })
      report.sourceStable = before !== undefined && JSON.stringify(before) === JSON.stringify(after)
      report.sourceDrift = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].filter(path => before?.[path] !== after[path])
    } catch (error) { report.sourceStable = false; report.snapshotError = error.message }
    report.sameSourceBuildCompleted = report.buildCompleted === true && report.sourceStable === true
    report.emittedModuleMaps.sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
    await save('build-report.json')
  }
  return report
}


/** Ordinary checks remain active; the two fixed task boundaries stay pending. */
export async function inspectStagedPayload(shared, runtimeDependencies, { embeddedImageEvidenceRequired = true, webModuleMap } = {}) {
  await verifyCompanionNativeGit(shared)
  const emitted = {
    server: await checkEmitted(join(shared, 'scripts'), new Set(), { packageRoot: shared, knownNodeRuntime: true, relativeArtifacts: { '../knowledge/runtime.mjs': 'knowledge/runtime.mjs', [PACKAGED_CLI_LIFECYCLE_IMPORT]: 'knowledge/cli-lifecycle.mjs', [COMPANION_NATIVE_GIT_IMPORT]: 'git-native/index.cjs' } }),
    web: await checkEmitted(join(shared, 'web'), new Set(), { knownBrowserShims: true, picaWorkerEvidenceRequired: true, embeddedImageEvidenceRequired, staticPicaModuleMap: webModuleMap }),
    knowledge: await checkEmitted(join(shared, 'knowledge'), new Set(Object.keys(runtimeDependencies))),
    flow: await checkEmitted(join(shared, 'bundles/flow_design/scripts'), new Set()),
  }
  pendingRuntimeTasks(emitted, embeddedImageEvidenceRequired)
  return emitted
}

export function pendingRuntimeTasks(emitted, embedded = true) {
  const pending = emitted.web.filter(record => record.runtimeEvidenceRequired)
  const staticTasks = pending.filter(record => record.runtimeEvidenceRequired.kind === 'static-pica-worker-task')
  if (staticTasks.length) {
    assert.ok(embedded, 'Legacy single-worker evidence cannot certify static Pica tasks')
    assert.equal(pending.length, 2, 'Static Pica cannot mix with legacy runtime tasks')
    assert.deepEqual(staticTasks.map(record => record.runtimeEvidenceRequired.sourceKind).sort(), ['embedded', 'standalone'], 'Exact static source roles required')
    for (const record of staticTasks) {
      const task = record.runtimeEvidenceRequired
      assert.equal(record.unverified.length, 0, 'Static tasks cannot mask unknown loaders')
      assert.equal(task.rule, 'pica-static-source-compiler-v1')
      assert.equal(task.parentWorkerBindingVerified, true)
      assert.equal(task.browserExecutionVerified, false); assert.equal(task.boundedWorkerTaskVerified, false)
      assert.equal(task.dynamicClosureVerified, false)
    }
    return pending.map(record => ({ file: record.file, ...record.runtimeEvidenceRequired }))
  }
  assert.equal(pending.length, embedded ? 2 : 1, 'Exact fixed runtime finding groups required')
  const ui = pending.filter(record => record.runtimeEvidenceRequired.kind === 'injected-ui-blob-chain')
  assert.equal(ui.length, embedded ? 1 : 0, 'Exact embedded UI finding group required')
  assert.equal(pending.filter(record => record.runtimeEvidenceRequired.rule === PICA_WORKER_PINS.rule).length, 1, 'Exact standalone pica group required')
  return pending.map(record => ({ file: record.file, ...record.runtimeEvidenceRequired }))
}

/** Read-only post-probe gate; no browser launch or mutation of candidate/report. */
export async function verifySameSourceCandidateEvidence({ buildReportFile, buildReportSha256, ...evidence }) {
  assert.match(buildReportSha256 ?? '', /^[a-f0-9]{64}$/u, 'Explicit build report hash required')
  const reportPath = resolve(buildReportFile)
  const bytes = await regularFile(dirname(reportPath), relative(dirname(reportPath), reportPath))
  assert.equal(sha256(bytes), buildReportSha256, 'Build report drift')
  const report = JSON.parse(bytes)
  assert.equal(report.kind, 'same-source-exploratory-build')
  assert.equal(report.candidateAccepted, false)
  assert.equal(report.sameSourceBuildCompleted, true); assert.equal(report.sourceStable, true)
  assert.equal(report.workerTaskGate, 'runtime-evidence-required')
  assert.equal(report.dynamicClosureVerified, false)
  assert.equal(report.staticUnknown?.length, 1, 'Legacy single-Pica verifier rejects multi-task reports')
  const candidate = resolve(report.candidate)
  const inventory = await artifactInventory(candidate)
  assert.deepEqual(inventory, report.candidateInputs)
  assert.equal(inventorySha256(inventory), report.candidateInventorySha256, 'Candidate inventory drift')
  const manifest = JSON.parse(await regularFile(candidate, 'package.json'))
  assert.deepEqual(manifest.dependencies, report.runtimeDependencies)
  const emitted = await inspectStagedPayload(join(candidate, 'payload/shared'), report.runtimeDependencies, { embeddedImageEvidenceRequired:false })
  assert.deepEqual(pendingRuntimeTasks(emitted, false), report.staticUnknown, 'Static finding association drift')
  const result = await validatePicaWorkerEvidence({ ...evidence, candidateDirectory: candidate, candidateInventorySha256: report.candidateInventorySha256 })
  return { scope: 'same-source-static-and-pica-evidence-associations', candidateAccepted: false,
    evidenceAssociationsVerified: true, browserExecutionVerified: false,
    staticUnknown: report.staticUnknown, dynamicClosureVerified: false, boundedWorkerTaskVerified: false,
    evidence: result, publishReady: false, nativeDependenciesVerified: false, dependencyLicensesVerified: false,
    bundlePanelGraKagVerified: false }
}

/** Static staged-file associations only. Neither a probe nor runtime acceptance. */
export async function verifyStagedUiCandidateAssociations({ buildReportFile, buildReportSha256 }) {
  assert.match(buildReportSha256 ?? '', /^[a-f0-9]{64}$/u, 'Explicit build report hash required')
  const path = resolve(buildReportFile), bytes = await regularFile(dirname(path), relative(dirname(path),path))
  assert.equal(sha256(bytes),buildReportSha256,'Build report drift')
  const report = JSON.parse(bytes)
  assert.equal(report.kind,'same-source-exploratory-build'); assert.equal(report.candidateAccepted,false)
  assert.equal(report.sameSourceBuildCompleted,true); assert.equal(report.sourceStable,true)
  assert.equal(report.workerTaskGate,'runtime-evidence-required'); assert.equal(report.dynamicClosureVerified,false)
  const candidate = resolve(report.candidate), inventory = await artifactInventory(candidate)
  assert.deepEqual(inventory,report.candidateInputs)
  assert.equal(inventorySha256(inventory),report.candidateInventorySha256,'Candidate inventory drift')
  assert.deepEqual(JSON.parse(await regularFile(candidate,'package.json')).dependencies,report.runtimeDependencies)
  const webMaps = (report.emittedModuleMaps ?? []).filter(mapping => mapping.label === 'web')
  assert.ok(webMaps.length <= 1, 'Duplicate web module map')
  if (report.staticUnknown?.some(task => task.kind === 'static-pica-worker-task')) assert.equal(webMaps.length, 1, 'Static report requires its captured web module map')
  const emitted = await inspectStagedPayload(join(candidate,'payload/shared'),report.runtimeDependencies, { webModuleMap: webMaps[0] })
  const pending = pendingRuntimeTasks(emitted)
  assert.deepEqual(pending,report.staticUnknown,'Static finding association drift')
  if (Object.hasOwn(report, 'pendingTasks')) assert.deepEqual(pending, report.pendingTasks, 'Pending task association drift')
  return { scope:'staged-static-runtime-task-associations',evidenceAssociationsVerified:true,staticUnknown:pending,pendingTasks:pending,
    browserExecutionVerified:false,injectedUiBlobChainVerified:false,embeddedDefaultWorkerVerified:false,
    candidateAccepted:false,dynamicClosureVerified:false,bundlePanelGraKagVerified:false,publishReady:false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await buildSameSourceCandidate(parseSameSourceBuildArgs(process.argv.slice(2)))
  console.log(JSON.stringify({ root: report.root, buildCompleted: report.buildCompleted, sourceStable: report.sourceStable, sameSourceBuildCompleted: report.sameSourceBuildCompleted, candidateAccepted: report.candidateAccepted, workerTaskGate: report.workerTaskGate, candidateInventorySha256: report.candidateInventorySha256, steps: report.steps, error: report.error, sourceDrift: report.sourceDrift }, null, 2))
  if (!report.sameSourceBuildCompleted) process.exitCode = 1
}
