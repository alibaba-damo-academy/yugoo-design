import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalBuildModuleEvidence } from './normal-build-module-evidence.mjs'

test('normal build observation is opt-in and confined outside the workspace', () => {
  assert.deepEqual(normalBuildModuleEvidence('web', { evidenceDirectory: undefined }), {})
  for (const path of ['', 'relative', '/workspace', '/workspace/sub', '/']) {
    assert.throws(() => normalBuildModuleEvidence('web', { evidenceDirectory: path, workspaceRoot: '/workspace' }))
  }
  assert.throws(() => normalBuildModuleEvidence('../escape', { evidenceDirectory: '/evidence', workspaceRoot: '/workspace' }))
})

test('hook detaches getters, verifies emitted bytes and writes private evidence once without claiming license coverage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'normal-build-evidence-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspaceRoot = join(root, 'workspace'), outputRoot = join(workspaceRoot, 'dist'), evidenceDirectory = join(root, 'evidence')
  await mkdir(outputRoot, { recursive: true })
  const code = 'export const ok = true;\n'
  await writeFile(join(outputRoot, 'client.mjs'), code)
  let alive = true
  const moduleId = join(workspaceRoot, 'client.ts')
  const chunk = { type: 'chunk', fileName: 'client.mjs', outDir: outputRoot, code,
    isEntry: true, isDynamicEntry: false, facadeModuleId: moduleId,
    moduleIds: [moduleId], imports: [], dynamicImports: [],
    get modules() { assert.ok(alive); return { [moduleId]: { code, renderedLength: code.length, renderedExports: ['ok'] } } },
  }
  const run = normalBuildModuleEvidence('web', { evidenceDirectory, workspaceRoot })['build:done']
  const pending = run({ chunks: [chunk], options: { outDir: outputRoot } })
  alive = false
  await pending
  const file = join(evidenceDirectory, 'web-output-modules.json')
  const bytes = await readFile(file), result = JSON.parse(bytes)
  assert.equal(result.diskAssociationVerified, true)
  for (const key of ['actualGetterLifetimeVerified', 'completeBundledInventory', 'releaseLicenseAcceptance']) assert.equal(result[key], false)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  alive = true
  await assert.rejects(run({ chunks: [chunk], options: { outDir: outputRoot } }), { code: 'EEXIST' })
  assert.deepEqual(await readFile(file), bytes)
  await writeFile(join(outputRoot, 'client.mjs'), 'drift')
  await assert.rejects(run({ chunks: [chunk], options: { outDir: outputRoot } }), /byte length drift/)
  assert.deepEqual(await readFile(file), bytes)
})

test('installed tsdown invokes the observer on real isolated emitted outputs', async t => {
  const { build } = await import('tsdown')
  const root = await mkdtemp(join(tmpdir(), 'normal-build-real-hook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspaceRoot = join(root, 'workspace'), outputRoot = join(workspaceRoot, 'dist'), evidenceDirectory = join(root, 'evidence')
  await mkdir(workspaceRoot)
  const entry = join(workspaceRoot, 'entry.mjs')
  await writeFile(entry, 'export const value = 42;\n')
  const bundles = await build({ config: false, entry: { entry }, outDir: outputRoot,
    format: 'esm', platform: 'node', target: 'node22', tsconfig: false, dts: false, clean: false,
    hooks: normalBuildModuleEvidence('isolated', { evidenceDirectory, workspaceRoot }),
  })
  try {
    const result = JSON.parse(await readFile(join(evidenceDirectory, 'isolated-output-modules.json'), 'utf8'))
    const chunk = result.outputs.find(row => row.type === 'chunk')
    assert.ok(chunk)
    assert.equal(result.diskAssociationVerified, true)
    assert.ok(chunk.moduleIds.some(row => row.rawId === entry))
    assert.equal(result.completeBundledInventory, false)
    assert.equal(result.releaseLicenseAcceptance, false)
  } finally {
    await Promise.all(bundles.map(bundle => bundle[Symbol.asyncDispose]()))
  }
})
