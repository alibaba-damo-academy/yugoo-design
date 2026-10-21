import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { companionPackagedKnowledge, KNOWLEDGE_SOURCE_PATH, PACKAGED_KNOWLEDGE_IMPORT, PACKAGED_CLI_LIFECYCLE_IMPORT, COMPANION_CLI_SOURCE_PATH } from './companion-packaged-knowledge.mjs'
import { checkEmitted } from './emitted-loader-check.mjs'

test('published transform is exact-module only and rejects changed development loader', async () => {
  const source = await readFile(KNOWLEDGE_SOURCE_PATH, 'utf8'), plugin = companionPackagedKnowledge()
  assert.equal(plugin.transform(source, KNOWLEDGE_SOURCE_PATH + '.other'), null)
  assert.equal(plugin.resolveId(PACKAGED_KNOWLEDGE_IMPORT, KNOWLEDGE_SOURCE_PATH), null)
  const output = plugin.transform(source, KNOWLEDGE_SOURCE_PATH).code
  assert.ok(output.includes("return import('../knowledge/runtime.mjs')"))
  assert.ok(!output.includes('../../knowledge-ladybug/lib/index.js'))
  assert.equal(plugin.resolveId(PACKAGED_KNOWLEDGE_IMPORT, 'other.mjs'), null)
  assert.equal(plugin.resolveId('missing-package', KNOWLEDGE_SOURCE_PATH), null)
  assert.deepEqual(plugin.resolveId('./cli-lifecycle.mjs', COMPANION_CLI_SOURCE_PATH), {id:PACKAGED_CLI_LIFECYCLE_IMPORT,external:true})
  for (const [source, importer] of [['./cli-lifecycle.mjs', KNOWLEDGE_SOURCE_PATH], ['./cli-lifecycle.mjs', COMPANION_CLI_SOURCE_PATH+'.other'], ['./other.mjs', COMPANION_CLI_SOURCE_PATH]]) assert.equal(plugin.resolveId(source, importer), null)
  assert.deepEqual(plugin.resolveId(PACKAGED_KNOWLEDGE_IMPORT, KNOWLEDGE_SOURCE_PATH), {id:PACKAGED_KNOWLEDGE_IMPORT, external:true})
  assert.throws(() => plugin.transform(source.replace('existsSync(packaged)', 'different(packaged)'), KNOWLEDGE_SOURCE_PATH), /source changed/)
  assert.equal(await readFile(KNOWLEDGE_SOURCE_PATH, 'utf8'), source)
})

test('compiled published loader consumes package runtime and rejects a missing artifact', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-packaged-loader-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const scripts = join(root, 'scripts'), knowledge = join(root, 'knowledge')
  await mkdir(knowledge); await writeFile(join(knowledge, 'runtime.mjs'), 'export const fixture="packaged-runtime"\n')
  // Native build output must stay outside the test worker's serialized stdout.
  const buildProgram = `
    import { readFile } from 'node:fs/promises'
    const { build } = await import(process.argv[1])
    const { companionPackagedKnowledge, KNOWLEDGE_SOURCE_PATH } = await import(process.argv[2])
    const source = await readFile(KNOWLEDGE_SOURCE_PATH, 'utf8')
    const loader = source.slice(source.indexOf('export function companionKnowledgeRuntimeUrl()'), source.indexOf('\\nexport function createCompanionKnowledge'))
    const bundles = await build({ config:false, entry:{design:KNOWLEDGE_SOURCE_PATH}, outDir:process.argv[3], clean:false, platform:'node', format:'esm', target:'node22', tsconfig:false, dts:false, failOnWarn:true,
      deps:{alwaysBundle:[/.*/],onlyBundle:false}, plugins:[{name:'runtime-fixture-source',load(id){if(id===KNOWLEDGE_SOURCE_PATH)return loader+'\\nexport const load=runtime\\n'}}, companionPackagedKnowledge()] })
    for (const bundle of bundles) await bundle[Symbol.asyncDispose]()
  `
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const compiled = spawnSync(process.execPath, ['--input-type=module', '-e', buildProgram,
    import.meta.resolve('tsdown'), new URL('./companion-packaged-knowledge.mjs', import.meta.url).href, scripts],
  { env, encoding:'utf8', stdio:'pipe', maxBuffer:4_000_000 })
  assert.ifError(compiled.error)
  assert.equal(compiled.signal, null)
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout)
  const code = await readFile(join(scripts,'design.mjs'),'utf8')
  assert.ok(code.includes(PACKAGED_KNOWLEDGE_IMPORT)); assert.ok(!code.includes('knowledge-ladybug/lib'))
  const options={packageRoot:root,relativeArtifacts:{'../knowledge/runtime.mjs':'knowledge/runtime.mjs'}}
  assert.equal((await checkEmitted(scripts,new Set(),options))[0].loads[0].source,PACKAGED_KNOWLEDGE_IMPORT)
  const module = await import(pathToFileURL(join(scripts,'design.mjs')))
  assert.equal((await module.load()).fixture,'packaged-runtime')
  await rm(join(knowledge,'runtime.mjs'))
  await assert.rejects(checkEmitted(scripts,new Set(),options), /ENOENT/)
  const missing = spawnSync(process.execPath, ['--input-type=module', '-e', `const module=await import(${JSON.stringify(pathToFileURL(join(scripts,'design.mjs')).href)}); await module.load()`], {env, encoding:'utf8'})
  assert.equal(missing.status,1)
  assert.match(missing.stderr,/ERR_MODULE_NOT_FOUND/)
})

test('same-package exception cannot permit repository fallback or arbitrary escape', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-artifact-boundary-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const scripts=join(root,'scripts');await mkdir(scripts)
  const options={packageRoot:root,relativeArtifacts:{'../knowledge/runtime.mjs':'knowledge/runtime.mjs'}}
  for(const spec of ['../../knowledge-ladybug/lib/index.js','../other/runtime.mjs']) {
    await writeFile(join(scripts,'entry.mjs'),`export const load=()=>import('${spec}')`)
    await assert.rejects(checkEmitted(scripts,new Set(),options),/Import escapes output/)
  }
})

test('Knowledge lifecycle asset emits only Node builtins and the existing public database dependency', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-cli-lifecycle-loader-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const program = `
    const { build } = await import(process.argv[1])
    const bundles = await build({ config:false, entry:{lifecycle:process.argv[2]}, outDir:process.argv[3], platform:'node', format:'esm', target:'node22', tsconfig:false, dts:false, failOnWarn:true, deps:{alwaysBundle:[/.*/],onlyBundle:false} })
    for (const bundle of bundles) await bundle[Symbol.asyncDispose]()
  `
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
  const compiled = spawnSync(process.execPath, ['--input-type=module', '-e', program, import.meta.resolve('tsdown'),
    fileURLToPath(new URL('../packages/companion/src/cli-lifecycle.mjs', import.meta.url)), root], {env, encoding:'utf8', maxBuffer:4_000_000})
  assert.ifError(compiled.error)
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout)
  const records = await checkEmitted(root, new Set(['@ladybugdb/wasm-core']))
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].loads.filter(load => !load.source.startsWith('node:')), [{kind:'require', source:'@ladybugdb/wasm-core/nodejs'}])
  assert.deepEqual(records[0].unverified, [])
  await assert.rejects(checkEmitted(root, new Set()), /Undeclared emitted runtime dependency/)
})
