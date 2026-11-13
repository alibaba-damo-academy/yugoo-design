import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { preparePrdRuntime } from '../prd-runtime.mjs'

const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url))
test('copied PRD browser runtime resolves without ancestor node_modules or browser installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-prd-runtime-'))
  try {
    for (let current = root; ; current = dirname(current)) {
      await assert.rejects(access(join(current, 'node_modules')))
      if (current === dirname(current)) break
    }
    const config = join(root, 'presentation.json')
    await writeFile(config, JSON.stringify({ defaultStyle: { fontSize: 12 } }))
    const bundleRoot = join(root, 'prd'); await mkdir(bundleRoot)
    const { manifest } = await preparePrdRuntime({ bundleRoot, workspaceRoot,
      bpmnPresentationFile: config, whiteboardEntry: null })
    assert.ok(manifest.runtimeBytes < 10 * 1024 * 1024)
    assert.equal(manifest.browserExecutablesIncluded, false)
    assert.ok(manifest.components.some(item => item.name === 'playwright-core'))
    const { chromium } = await import(pathToFileURL(join(bundleRoot, 'scripts/runtime/playwright-core/index.mjs')))
    assert.equal(typeof chromium.launch, 'function')
    // Deliberately unavailable binary: exercise the real copied launch path.
    // No fallback, downloader or developer package lookup may turn it into success.
    await assert.rejects(chromium.launch({ executablePath: join(root, 'absent-browser') }), /[Ee]xecutable.*(?:exist|not found)/)
    const viewer = await readFile(join(bundleRoot, 'scripts/assets/bpmn-viewer.js'), 'utf8')
    assert.match(viewer, /BpmnJS/)
    assert.deepEqual(JSON.parse(await readFile(join(bundleRoot, 'scripts/assets/bpmn-presentation.json'))), { defaultStyle: { fontSize: 12 } })
    const adapter = join(bundleRoot, 'scripts/assets/bpmn-label-bounds.mjs')
    assert.equal(await readFile(adapter, 'utf8'), await readFile(new URL('../../panel/src/bpmn-label-bounds.mjs', import.meta.url), 'utf8'))
    assert.equal(typeof (await import(pathToFileURL(adapter))).createBpmnLabelBoundsModule, 'function')
    const adapterBytes = await readFile(adapter)
    const binding = { bytes: adapterBytes.length, sha256: createHash('sha256').update(adapterBytes).digest('hex') }
    assert.deepEqual(manifest.outputs['scripts/assets/bpmn-label-bounds.mjs'], binding)
    console.log('PRD_SHARED_LABEL_ADAPTER', JSON.stringify({ source: 'packages/panel/src/bpmn-label-bounds.mjs', output: 'scripts/assets/bpmn-label-bounds.mjs', ...binding }))
    for (const component of manifest.components) for (const item of component.materials) await access(join(bundleRoot, item.path))
    await assert.rejects(access(join(bundleRoot, 'scripts/runtime/playwright-core/node_modules')))
    await assert.rejects(access(join(bundleRoot, 'scripts/runtime/playwright-core/bin')))
  } finally { await rm(root, { recursive: true, force: true }) }
})
