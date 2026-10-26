/** Run after the normal interpreter ESM configuration. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import vm from 'node:vm'
import * as React from 'react'
import ts from 'typescript'
import { analyzeEmittedLoaders, proveKnownBrowserLodash } from '../../../scripts/emitted-loader-check.mjs'

const lib = new URL('../lib/', import.meta.url)
// A normal Panel build also emits Node UI chunks and the DSH module-table
// factory. Only the browser interpreter's static and lazy ESM imports belong
// to this peer boundary; DSH's injected require is a different public entry.
const available = new Set(await readdir(lib))
const files = new Map()
const pending = ['interpreter.js']
while (pending.length) {
  const name = pending.pop()
  if (files.has(name)) continue
  assert.ok(available.has(name), 'Missing normal interpreter dependency: ' + name)
  const code = await readFile(new URL(name, lib), 'utf8')
  files.set(name, code)
  // Embedded Browserify require tables are verified by loader proofs below;
  // they are not relative ESM chunks. Keep the scanner's JS require mode off.
  for (const dependency of ts.preProcessFile(code, true, false).importedFiles) {
    if (!dependency.fileName.startsWith('./') || !dependency.fileName.endsWith('.js')) continue
    const relative = new URL(dependency.fileName, new URL(name, lib)).href
    assert.ok(relative.startsWith(lib.href), 'Interpreter import must stay in its normal output')
    pending.push(relative.slice(lib.href.length))
  }
}
assert.ok(files.size > 1, 'Exercise the real interpreter dependency graph')

test('normal public ESM graphs retain the React peer instead of opaque requires or an embedded React runtime', () => {
  assert.ok(files.has('interpreter.js'), 'The normal interpreter entry must be present')
  for (const [name, code] of files) {
    assert.equal(/\b(?:__require(?:\$\d+)?|require)\s*\(\s*["']react["']/u.test(code), false, name + ' must not require a browser peer')
    assert.equal(/\/node_modules\/react\/cjs\/react\./u.test(code), false, name + ' must not embed another React runtime')
  }
  assert.ok([...files].some(([name, code]) => name.startsWith('excalidraw-surface-') && /from ["']react["']/u.test(code)),
    'The normal interpreter canvas graph must import the external React peer')
})

function region(code, marker) {
  const hit = code.indexOf(marker)
  assert.ok(hit >= 0, 'Missing emitted dependency region: ' + marker)
  const start = code.lastIndexOf('//#region', hit), end = code.indexOf('//#endregion', hit)
  assert.ok(start >= 0 && end > start)
  return code.slice(start, end)
}

test('exact emitted lazy-store factories initialize with actual React18 and no require global', () => {
  assert.match(React.version, /^18\./u)
  const leaves = [...files].filter(([name]) => name.startsWith('excalidraw-surface-'))
  assert.ok(leaves.length, 'Normal canvas lazy leaf must be present')
  for (const [name, code] of leaves) {
    const runtime = /from ["'](\.\/rolldown-runtime-[^"']+)["']/u.exec(code)?.[1]
    assert.ok(runtime, name + ': expected normal Rolldown helper module')
    const common = /var __commonJSMin =[^\n]+/u.exec(files.get(runtime.slice(2)))?.[0]
    assert.ok(common)
    const peer = /import \* as ([\w$]+) from ["']react["']/u.exec(code)?.[1]
    assert.ok(peer)
    const bridge = region(code, 'builtin:esm-external-require-react')
    const shim = region(code, '/cjs/use-sync-external-store-shim.')
    const index = region(code, '/use-sync-external-store/shim/index.js')
    const selector = region(code, '/cjs/use-sync-external-store-shim/with-selector.')
    const shimName = /var (require_[\w$]+) =/u.exec(shim)?.[1]
    const selectorName = /var (require_[\w$]+) =/u.exec(selector)?.[1]
    assert.ok(shimName && selectorName)
    const result = vm.runInNewContext([common, bridge, shim, index, selector,
      `({shim:${shimName}(),selector:${selectorName}()})`].join('\n'), { [peer]: React }, { timeout: 1000 })
    assert.equal(result.shim.useSyncExternalStore, React.useSyncExternalStore, 'The factory must use the existing peer hook identity')
    assert.equal(typeof result.selector.useSyncExternalStoreWithSelector, 'function')
  }
})

test('real emitted lodash helpers obtain only exact browser-guard proofs', () => {
  let count = 0
  for (const [name, code] of files) if (/\.require\(["']util["']\)/u.test(code)) {
    const proof = proveKnownBrowserLodash(code, { fileName: name })
    assert.ok(proof.proof.length, name + ' needs a complete lexical guard proof')
    const result = analyzeEmittedLoaders(code, proof)
    assert.equal(result.loads.some(load => load.source === 'util'), false)
    assert.deepEqual(result.unverified, [])
    count += proof.proof.length
  }
  assert.ok(count > 0, 'The normal dependency graph must exercise the proof')
})
