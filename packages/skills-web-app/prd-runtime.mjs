/** Build-time resources for the copied PRD Bundle; never installs a browser. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const posix = path => path.replaceAll('\\', '/')

export async function preparePrdRuntime({ bundleRoot, workspaceRoot, runBuild, whiteboardEntry,
  bpmnPresentationFile = join(workspaceRoot, 'packages/panel/src/bpmn-presentation.json'),
  bpmnLabelBoundsFile = join(workspaceRoot, 'packages/panel/src/bpmn-label-bounds.mjs') }) {
  const require = createRequire(join(workspaceRoot, 'packages/skills-web-app/package.json'))
  const components = [], outputs = {}, maps = [], missingMaterials = []
  const materialRoots = new Map(), materialIdentities = new Map()
  async function put(path, bytes) {
    const target = join(bundleRoot, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
    outputs[posix(path)] = { bytes: bytes.length, sha256: sha(bytes) }
  }
  async function copy(source, path) {
    assert.ok((await lstat(source)).isFile(), `Regular PRD runtime resource required: ${path}`)
    await put(path, await readFile(source))
  }
  async function packageMaterials(root, name) {
    if (materialRoots.has(root)) return materialRoots.get(root)
    const metadata = await readFile(join(root, 'package.json'))
    const identity = JSON.parse(metadata)
    assert.equal(identity.name, name)
    const identityKey = `${name}@${identity.version}:${sha(metadata)}`
    if (materialIdentities.has(identityKey)) {
      const record = materialIdentities.get(identityKey); materialRoots.set(root, record); return record
    }
    const destination = `licenses/prd/${name.replaceAll('/', '__')}@${identity.version}`
    const materials = []
    let maintainedRoot = join(workspaceRoot, 'third-party/companion/bundled-js', `${name}@${identity.version}`)
    let materialsScope
    for (const file of (await readdir(root)).sort()) {
      if (file !== 'package.json' && !/^(?:licen[sc]e|notice|thirdpartynotices|copying)(?:[.\-_].*)?$/iu.test(file)) continue
      if (!(await lstat(join(root, file))).isFile()) continue
      const path = `${destination}/${file}`
      await copy(join(root, file), path)
      materials.push({ path, sha256: outputs[path].sha256 })
    }
    if (!materials.some(item => /\/licen[sc]e(?:[.\-_]|$)/iu.test(item.path))) {
      // Some browser packages omit their original license from npm. Reuse the
      // repository's already maintained exact-version original, never infer it
      // from a package's short SPDX declaration.
      const source = join(workspaceRoot, 'third-party/companion/bundled-js', `${name}@${identity.version}`, 'LICENSE')
      const path = `${destination}/LICENSE`
      try {
        await copy(source, path)
        materials.push({ path, sha256: outputs[path].sha256 })
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        // Retain a known repository original with its explicit correspondence
        // limitation when a publisher omits the text and its gitHead is gone.
        // This does not turn repository material into a verified npm source.
        const repositoryRoot = join(workspaceRoot, 'third-party/companion/repository-materials', name)
        try {
          const note = JSON.parse(await readFile(join(repositoryRoot, 'SOURCE.json'), 'utf8'))
          assert.equal(note.name, name); assert.equal(note.publishedPackageVersion, identity.version)
          assert.equal(note.publishedDeclaredLicense, identity.license)
          const original = await readFile(join(repositoryRoot, 'LICENSE'))
          assert.equal(sha(original), note.licenseSha256)
          await put(path, original)
          materials.push({ path, sha256: outputs[path].sha256 })
          maintainedRoot = repositoryRoot; materialsScope = note.scope
        } catch (missing) {
          if (missing.code !== 'ENOENT') throw missing
          missingMaterials.push(`${name}@${identity.version}`)
        }
      }
    }
    const sourceNote = join(maintainedRoot, 'SOURCE.json')
    const sourceNotePath = `${destination}/SOURCE.json`
    try {
      await copy(sourceNote, sourceNotePath)
      materials.push({ path: sourceNotePath, sha256: outputs[sourceNotePath].sha256 })
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const record = { name, version: identity.version, declaredLicense: identity.license,
      packageMetadataSha256: sha(metadata), materials,
      ...(materialsScope ? { materialsScope } : {}),
      sourceCorrespondence: 'Retained originals describe upstream inputs; current PRD output correspondence is recorded separately in this manifest.' }
    components.push(record); materialRoots.set(root, record); materialIdentities.set(identityKey, record)
    return record
  }

  const playwrightRoot = dirname(require.resolve('playwright/package.json'))
  const playwrightRequire = createRequire(join(playwrightRoot, 'package.json'))
  const coreRoot = dirname(playwrightRequire.resolve('playwright-core/package.json'))
  const playwright = await packageMaterials(coreRoot, 'playwright-core')
  // Preserve the official runtime layout and original prebundles. Browser
  // executables, installers, type declarations and interactive inspector/trace
  // applications are not used by this headless snapshot operation.
  const excluded = new Set(['lib/vite', 'lib/tools'])
  async function copyCore(path) {
    if (excluded.has(posix(path))) return
    const source = join(coreRoot, path), info = await lstat(source)
    assert.ok(!info.isSymbolicLink(), `Symlink in Playwright runtime: ${path}`)
    if (info.isDirectory()) {
      for (const child of (await readdir(source)).sort()) await copyCore(join(path, child))
    } else {
      assert.ok(info.isFile(), `Regular Playwright runtime resource required: ${path}`)
      await copy(source, `scripts/runtime/playwright-core/${posix(path)}`)
    }
  }
  for (const path of ['index.js', 'index.mjs', 'package.json', 'browsers.json', 'LICENSE', 'NOTICE', 'ThirdPartyNotices.txt', 'lib']) await copyCore(path)
  playwright.omitted = ['browser executables', 'bin installers', 'types', ...excluded]

  const bpmnRoot = dirname(require.resolve('bpmn-js/package.json'))
  const bpmn = await packageMaterials(bpmnRoot, 'bpmn-js')
  await copy(join(bpmnRoot, 'dist/bpmn-navigated-viewer.production.min.js'), 'scripts/assets/bpmn-viewer.js')
  bpmn.outputs = ['scripts/assets/bpmn-viewer.js']
  const presentation = await readFile(bpmnPresentationFile)
  JSON.parse(presentation) // Reject a broken maintained configuration during build.
  await put('scripts/assets/bpmn-presentation.json', presentation)
  await copy(bpmnLabelBoundsFile, 'scripts/assets/bpmn-label-bounds.mjs')

  if (whiteboardEntry !== null) {
    assert.equal(typeof runBuild, 'function', 'Normal build evidence required for Whiteboard export')
    const entry = resolve(whiteboardEntry ?? join(bundleRoot, 'scripts/whiteboard-export.mjs'))
    const outDir = join(bundleRoot, 'scripts/assets')
    const panelConfig = pathToFileURL(join(workspaceRoot, 'packages/panel/package.json')).href
    const panelRequire = createRequire(panelConfig)
    const [{ canvasBrowserAssets }, { canvasBrowserDependencies }] = await Promise.all([
      import(pathToFileURL(join(workspaceRoot, 'scripts/canvas-browser-assets.ts')).href),
      import(pathToFileURL(join(workspaceRoot, 'scripts/canvas-browser-dependencies.ts')).href),
    ])
    const canvas = canvasBrowserAssets(panelConfig, { surface: 'export' })
    const map = await runBuild('prd-whiteboard', {
      config: false, entry: { 'whiteboard-export': entry }, outDir,
      format: 'iife', platform: 'browser', target: 'es2022',
      tsconfig: false, dts: false, clean: false, minify: true,
      outputOptions: { codeSplitting: false, name: 'YugooWhiteboardModule', entryFileNames: '[name].js' },
      deps: { alwaysBundle: [/.*/], onlyBundle: false },
      define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta.env.MODE': JSON.stringify('production') },
      plugins: [{ name: 'prd-whiteboard-entry', resolveId(source) {
        return source === '@excalidraw/excalidraw' ? panelRequire.resolve(source) : null
      } }, canvasBrowserDependencies(panelConfig), canvas.plugin],
    })
    maps.push(map)
    for (const output of map.outputs) {
      await copy(join(outDir, output.fileName), `scripts/assets/${output.fileName}`)
      for (const module of output.modules ?? []) {
        if (!module.renderedLength) continue
        const match = posix(module.rawId).match(/^(.*\/node_modules\/((?:@[^/]+\/)?[^/]+))(?:\/|$)/u)
        if (match) await packageMaterials(match[1], match[2])
      }
    }
    for (const font of canvas.manifest.fonts) {
      const source = join(workspaceRoot, 'scripts/whiteboard-fonts', font.licenseFile)
      const path = `licenses/prd/fonts/${font.licenseFile}`
      const bytes = await readFile(source)
      assert.equal(sha(bytes), font.licenseSha256, 'Canvas font license drift')
      await put(path, bytes)
    }
    await put('licenses/prd/canvas-fonts.json', Buffer.from(JSON.stringify(canvas.manifest, null, 2) + '\n'))
  }

  assert.equal(missingMaterials.length, 0, `Missing original PRD runtime licenses: ${missingMaterials.join(', ')}`)
  const bytes = Object.values(outputs).reduce((total, item) => total + item.bytes, 0)
  const manifest = { version: 1, purpose: 'PRD source-visual snapshots', components,
    runtimeBytes: bytes, outputs, completeBundledInventoryVerified: false,
    browserExecutablesIncluded: false, releaseLicenseAcceptance: false }
  await put('licenses/prd-runtime.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
  return { maps, manifest }
}
