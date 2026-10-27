import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalBuildModuleEvidence, withNormalBuildEvidence, isDeclarationOutput } from './normal-build-module-evidence.mjs'
import { verifyOutputModuleFiles } from './companion-output-module-map.mjs'

test('normal build observation is opt-in and confined outside the workspace', () => {
  assert.deepEqual(normalBuildModuleEvidence('web', { evidenceDirectory: undefined }), {})
  for (const path of ['entry.d.ts', 'entry.d.mts', 'entry.d.cts']) assert.equal(isDeclarationOutput(path), true)
  for (const path of ['entry.ts', 'entry.mjs', 'entry.d.ts.js']) assert.equal(isDeclarationOutput(path), false)
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
  const previousEvidence = process.env.YUGOO_BUILD_MODULE_EVIDENCE_DIR
  process.env.YUGOO_BUILD_MODULE_EVIDENCE_DIR = evidenceDirectory
  t.after(() => { if (previousEvidence === undefined) delete process.env.YUGOO_BUILD_MODULE_EVIDENCE_DIR; else process.env.YUGOO_BUILD_MODULE_EVIDENCE_DIR = previousEvidence })
  let existingHookCalls = 0
  const bundles = await build(withNormalBuildEvidence('isolated', { config: false, entry: { entry }, outDir: outputRoot,
    format: 'esm', platform: 'node', target: 'node22', tsconfig: false, dts: false, clean: false,
    hooks: { 'build:done': async () => { existingHookCalls++ } },
  }))
  try {
    const result = JSON.parse(await readFile(join(evidenceDirectory, 'isolated-0-output-modules.json'), 'utf8'))
    const chunk = result.outputs.find(row => row.type === 'chunk')
    assert.ok(chunk)
    assert.equal(existingHookCalls, 1)
    assert.match(result.inputFileSha256[entry], /^[a-f0-9]{64}$/u)
    assert.equal(result.diskAssociationVerified, true)
    assert.ok(chunk.moduleIds.some(row => row.rawId === entry))
    assert.equal(result.completeBundledInventory, false)
    assert.equal(result.releaseLicenseAcceptance, false)
  } finally {
    await Promise.all(bundles.map(bundle => bundle[Symbol.asyncDispose]()))
  }
})

test('real dts build retains synthetic declaration IDs without hashing them as physical runtime sources', async t => {
  const { build } = await import('tsdown')
  const root = await mkdtemp(join(tmpdir(), 'normal-build-real-dts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspaceRoot = join(root, 'workspace'), outputRoot = join(workspaceRoot, 'lib'), evidenceDirectory = join(root, 'evidence')
  await mkdir(workspaceRoot)
  await writeFile(join(workspaceRoot, 'package.json'), JSON.stringify({ name: 'real-dts-fixture', type: 'module' }))
  const entry = join(workspaceRoot, 'entry.ts'), source = join(workspaceRoot, 'accepted-assertions.ts')
  await writeFile(source, 'export interface Result { value: number }\nexport const value: number = Date.now();\n')
  await writeFile(entry, "import { value, type Result } from './accepted-assertions';\nexport const result: Result = { value };\n")
  const tsconfig = join(workspaceRoot, 'tsconfig.json')
  await writeFile(tsconfig, JSON.stringify({ compilerOptions: { declaration: true, target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler', types: [] } }))
  const bundles = await build({ config: false, cwd: workspaceRoot, entry: { entry }, outDir: outputRoot,
    format: 'esm', platform: 'node', target: 'node22', tsconfig, dts: true, fixedExtension: false, clean: false,
    hooks: normalBuildModuleEvidence('real-dts', { evidenceDirectory, workspaceRoot, hashModuleInputs: true }),
  })
  try {
    const result = JSON.parse(await readFile(join(evidenceDirectory, 'real-dts-output-modules.json'), 'utf8'))
    const declarations = result.declarationOnlyInputs
    assert.ok(declarations.length)
    const synthetic = declarations.flatMap(row => row.modules).find(row => row.rawId === join(workspaceRoot, 'accepted-assertions.d.ts'))
    assert.ok(synthetic, 'real dts plugin must expose its synthetic declaration ID')
    await assert.rejects(readFile(synthetic.rawId), { code: 'ENOENT' })
    assert.equal(Object.hasOwn(result.inputFileSha256, synthetic.rawId), false)
    assert.match(result.inputFileSha256[source], /^[a-f0-9]{64}$/u)
    assert.match(result.inputFileSha256[entry], /^[a-f0-9]{64}$/u)
    for (const row of declarations) {
      assert.equal(row.physicalInputIdentityVerified, false)
      assert.equal(row.runtimeInputHashing, 'not-applicable')
      const output = result.outputs.find(output => output.fileName === row.output)
      assert.ok(output && output.sha256, 'actual declaration bytes remain verified')
    }
    await writeFile(join(outputRoot, declarations[0].output), 'changed declaration output')
    await assert.rejects(verifyOutputModuleFiles(result), /byte length drift|digest drift/)
  } finally { await Promise.all(bundles.map(bundle => bundle[Symbol.asyncDispose]())) }
})

test('missing physical runtime inputs still fail, including declaration-looking module IDs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'normal-runtime-input-required-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspaceRoot = join(root, 'workspace'), outputRoot = join(workspaceRoot, 'lib'), evidenceDirectory = join(root, 'evidence')
  await mkdir(outputRoot, { recursive: true })
  const code = 'export const value = 1;\n'; await writeFile(join(outputRoot, 'runtime.mjs'), code)
  for (const name of ['missing.ts', 'missing.d.ts']) {
    const moduleId = join(workspaceRoot, name)
    const chunk = { type: 'chunk', fileName: 'runtime.mjs', outDir: outputRoot, code, isEntry: true, isDynamicEntry: false,
      facadeModuleId: moduleId, moduleIds: [moduleId], imports: [], dynamicImports: [],
      modules: { [moduleId]: { code, renderedLength: code.length, renderedExports: ['value'] } } }
    const hook = normalBuildModuleEvidence('runtime-required', { evidenceDirectory, workspaceRoot, hashModuleInputs: true })['build:done']
    await assert.rejects(hook({ chunks: [chunk], options: { outDir: outputRoot } }), { code: 'ENOENT' })
  }
})
