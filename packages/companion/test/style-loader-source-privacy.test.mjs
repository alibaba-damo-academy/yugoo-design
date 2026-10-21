import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { dshClientStyles } from '../../../scripts/tsdown-client-styles.ts'

test('stylesheet virtual IDs preserve source identity without emitting checkout paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'style-source-privacy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const observed = []
  for (const checkout of ['first checkout', 'second checkout']) {
    const base = join(root, checkout)
    for (const folder of ['a', 'b']) {
      await mkdir(join(base, folder), { recursive: true })
      await writeFile(join(base, folder, 'same.css'), `.${folder} { color: red; }`)
    }
    const loader = dshClientStyles('fixture-plugin', pathToFileURL(join(base, 'config.ts')).href)
    const importer = join(base, 'client.tsx')
    const a = loader.resolveId('./a/same.css', importer)
    const b = loader.resolveId('./b/same.css', importer)
    const inline = loader.resolveId('./a/same.css?inline', importer)
    assert.notEqual(a, b)
    assert.notEqual(a, inline)
    assert.equal(loader.resolveId('./a/same.css', importer), a)
    const watches = []
    const load = id => {
      const result = loader.load.call({ addWatchFile(file) { watches.push(file) } }, id)
      assert.equal(result.meta.dshDesignCssSource, join(base, 'a/same.css'))
      return result.code
    }
    const ownedCode = load(a), inlineCode = load(inline)
    assert.match(ownedCode, /tag\.dataset\.plugin = "fixture-plugin"/)
    assert.match(inlineCode, /^export default /)
    assert.ok(ownedCode.includes('.a { color: red; }'))
    assert.ok(inlineCode.includes('.a { color: red; }'))
    assert.deepEqual(watches, [join(base, 'a/same.css'), join(base, 'a/same.css')])
    for (const emitted of [a, b, inline, ownedCode, inlineCode]) {
      assert.ok(!emitted.includes(base), 'Physical build path must not enter output')
      assert.ok(!emitted.includes(root), 'Temporary checkout root must not enter output')
    }
    assert.equal(loader.load.call({ addWatchFile() { throw Error('Unknown id watched') } }, `${a}-unknown.mjs`), null)
    observed.push({ a, b, inline, ownedCode, inlineCode })
  }
  assert.deepEqual(observed[0], observed[1], 'Equivalent checkout layouts produce stable virtual ids and style tags')
})


test('both CSS modes preserve the candidate preprocessor and physical origin', async t => {
  const root = await mkdtemp(join(tmpdir(), 'style-preprocess-origin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'style.css'); await writeFile(file, '.original {}')
  const calls = []
  const loader = dshClientStyles('preprocess-fixture', pathToFileURL(join(root, 'config.ts')).href, {
    preprocessCss(css, source) { calls.push([css, source]); return '.replacement {}' },
  })
  for (const request of ['./style.css', './style.css?inline']) {
    const id = loader.resolveId(request, join(root, 'client.tsx'))
    const loaded = loader.load.call({ addWatchFile() {} }, id)
    assert.equal(loaded.meta.dshDesignCssSource, file)
    assert.ok(loaded.code.includes('.replacement {}'))
    assert.ok(!loaded.code.includes('.original {}'))
    assert.ok(!loaded.code.includes(root)); assert.ok(!id.includes(root))
  }
  assert.deepEqual(calls, [['.original {}', file], ['.original {}', file]])
})
