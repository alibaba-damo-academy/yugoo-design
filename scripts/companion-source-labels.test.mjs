import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build } from 'tsdown'
import { companionSourceLabels } from './companion-source-labels.mjs'
import { classifyPicaWorker, PICA_WORKER_PINS, sha256 } from './pica-worker-evidence.mjs'

test('only real resolved-module region comments change; strings and licenses retain their bytes', () => {
  const root = '/source', id = '/donor/node_modules/.pnpm/pica@7.1.1/node_modules/pica/dist/pica.js'
  const region = '//#region ../donor/node_modules/.pnpm/pica@7.1.1/node_modules/pica/dist/pica.js'
  const code = '/*! original license */\n' + region + '\nexport const text = `' + region + '\n`;\n'
  const plugin = companionSourceLabels(root)
  assert.equal(plugin.renderChunk(code, { fileName: 'chunk.js', modules: {} }), null)
  const result = plugin.renderChunk(code, { fileName: 'chunk.js', modules: { [id]: {} } })
  assert.equal(result.code, code.replace(region, '//#region node_modules/.pnpm/pica@7.1.1/node_modules/pica/dist/pica.js'))
  assert.ok(result.code.includes('`' + region + '\n`'))
  assert.equal(plugin.renderChunk(region, { fileName: 'chunk.js', modules: { '/unrelated/source.js': {} } }), null)
  assert.equal(plugin.renderChunk(code.replaceAll('7.1.1','7.1.2'), { fileName: 'chunk.js', modules: { [id.replace('7.1.1','7.1.2')]: {} } }), null)
})

test('original reviewed Pica bytes stay fixed and a code mutation still fails the original worker gate', async () => {
  const original = await readFile(new URL('./test-fixtures/pica-worker/pica-DGw4b28J.js', import.meta.url), 'utf8')
  assert.equal(sha256(original), PICA_WORKER_PINS.artifact)
  const canonical = '//#region node_modules/.pnpm/pica@7.1.1/node_modules/pica/dist/pica.js'
  const donor = canonical.replace('node_modules/', '../donor/node_modules/')
  const chunk = { fileName: 'pica.js', modules: { '/donor/node_modules/.pnpm/pica@7.1.1/node_modules/pica/dist/pica.js': {} } }
  const plugin = companionSourceLabels('/source')
  assert.equal(plugin.renderChunk(original, chunk), null)
  const restored = plugin.renderChunk(original.replace(canonical,donor),chunk).code
  assert.equal(restored,original)
  assert.equal(classifyPicaWorker(restored).dynamicClosureVerified,false)
  const mutated = plugin.renderChunk(original.replace(canonical,donor)+'\nthrow Error("controlled mutation");\n',chunk).code
  assert.throws(()=>classifyPicaWorker(mutated),/Unreviewed pica artifact bytes/)
})

test('ordinary bundler output is identical for read-only dependency donors in different directories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-source-labels-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const outputs = []
  for (const name of ['donor-one', 'another-donor']) {
    const entry = join(root, name, 'node_modules/.pnpm/pica@7.1.1/node_modules/pica/dist/pica.js'), outDir = join(root, name, 'output')
    await mkdir(dirname(entry), { recursive: true })
    await writeFile(entry, '/*! original license */\nexport const value = 42;\n')
    await build({ config: false, entry: { example: entry }, outDir, clean: false, format: 'esm', platform: 'browser', dts: false,
      plugins: [companionSourceLabels(process.cwd())] })
    const code = await readFile(join(outDir, 'example.js'), 'utf8')
    assert.ok(code.includes('//#region node_modules/.pnpm/pica@7.1.1/node_modules/pica/dist/pica.js'))
    assert.ok(code.includes('original license'))
    assert.ok(code.includes('value = 42'))
    outputs.push(code)
  }
  assert.equal(outputs[0], outputs[1])
})
