/** Complete package-owned Kit/Bundle output. Runtime loading never installs dependencies. */
import assert from 'node:assert/strict'
import { cp, lstat, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'tsdown'
import { withNormalBuildEvidence } from '../../scripts/normal-build-module-evidence.mjs'
import { captureOutputModuleMap, verifyOutputModuleFiles } from '../../scripts/companion-output-module-map.mjs'
import { copyOwnLicenseMaterials, OWN_LICENSE_FILES } from '../../scripts/release-own-license.mjs'
import { writeFlowScriptMaterials } from '../../scripts/companion-bundled-license.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const workspace = resolve(here, '../..')

async function runNormalBuild(label, config) {
  const bundles = await build(withNormalBuildEvidence(`dsh-release-skills-web-app-${label}`, config))
  try {
    const snapshot = captureOutputModuleMap(label, bundles.flatMap(bundle => bundle.chunks), { workspaceRoot: workspace, outputRoot: config.outDir })
    return await verifyOutputModuleFiles(snapshot)
  } finally {
    const cleanup = await Promise.allSettled(bundles.map(bundle => bundle[Symbol.asyncDispose]()))
    const failure = cleanup.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
  }
}

export async function buildFlowScripts(source, outDir, { runBuild = runNormalBuild } = {}) {
  const maps = []
  // Independent CLI modules preserve import.meta.url. Inlining metrics into
  // search would activate metrics' entry guard with search's CLI arguments.
  for (const name of ['layout', 'layout-metrics', 'layout-search']) {
    const entry = join(source, `${name}.mjs`)
    maps.push(await runBuild(`flow-${name}`, {
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
    }))
  }
  return maps
}

async function copyTree(source, target) {
  const info = await lstat(source)
  assert.ok(!info.isSymbolicLink(), 'Content source symlink rejected')
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true })
    for (const name of (await readdir(source)).sort()) {
      assert.notEqual(name, 'node_modules')
      await copyTree(join(source, name), join(target, name))
    }
  } else {
    assert.ok(info.isFile(), 'Regular content source required')
    await cp(source, target, { force: false, errorOnExist: true })
  }
}

/** Shared by the npm content package and both Companion packaging routes. */
export async function buildWebAppContent(target, options = {}) {
  await copyTree(join(here, 'kits'), join(target, 'kits'))
  await copyTree(join(here, 'bundles'), join(target, 'bundles'))
  for (const name of OWN_LICENSE_FILES) await copyTree(join(here, name), join(target, 'kits/web_app', name))
  const maps = await buildFlowScripts(join(here, 'bundles/flow_design/scripts'), join(target, 'bundles/flow_design/scripts'), options)
  const flow = join(target, 'bundles/flow_design')
  await copyOwnLicenseMaterials(here, flow)
  await writeFlowScriptMaterials(workspace, flow, maps)
  return maps
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Only the package's rebuildable output is replaced, never a project copy.
  const target = join(here, 'lib')
  await rm(target, { recursive: true, force: true })
  await buildWebAppContent(target)
}
