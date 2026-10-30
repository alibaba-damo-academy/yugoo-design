/** Run after the normal interpreter/sample-preview ESM configurations.
 * PANEL_BROWSER_ESM_LIB may select another complete normal emitted lib for
 * read-only reuse; it is not a source alias or an installed-package check. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { isAbsolute, resolve, sep } from 'node:path'
import vm from 'node:vm'
import * as React from 'react'
import { analyzeEmittedLoaders, proveKnownBrowserLodash } from '../../../scripts/emitted-loader-check.mjs'

const outputRoot = process.env.PANEL_BROWSER_ESM_LIB
assert.ok(outputRoot === undefined || isAbsolute(outputRoot), 'An alternate normal output root must be absolute')
const lib = outputRoot === undefined ? new URL('../lib/', import.meta.url) : pathToFileURL(resolve(outputRoot) + sep)
const require = createRequire(import.meta.url)
const { parseSync } = await import(pathToFileURL(createRequire(require.resolve('tsdown')).resolve('rolldown/utils')))
// The same lib also contains the native client CJS factory and Node entries.
// Follow the actual two public browser graphs, including their lazy imports,
// so a reachable CJS dependency still fails the peer checks below.
const files = new Map(), pendingFiles = ['interpreter.js', 'sample-preview.js']
while (pendingFiles.length) {
  const name = pendingFiles.pop()
  if (files.has(name)) continue
  const url = new URL(name, lib), code = await readFile(url, 'utf8')
  files.set(name, code)
  const parsed = parseSync(name, code)
  assert.deepEqual(parsed.errors, [], 'Normal browser output must parse: ' + name)
  const nodes = [parsed.program], imports = []
  while (nodes.length) {
    const node = nodes.pop()
    if (node.type === 'ImportExpression') {
      assert.equal(typeof node.source?.value, 'string', name + ': lazy imports must be explicit')
      imports.push(node.source.value)
    } else if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
      imports.push(node.source.value)
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) nodes.push(...value.filter(child => child?.type))
      else if (value?.type) nodes.push(value)
    }
  }
  for (const specifier of imports) if (specifier.startsWith('.')) {
    const target = new URL(specifier, url)
    assert.ok(target.href.startsWith(lib.href) && target.href.endsWith('.js'), name + ': unexpected local browser edge ' + specifier)
    pendingFiles.push(decodeURIComponent(target.href.slice(lib.href.length)))
  }
}

test('normal public ESM graphs retain the React peer instead of opaque requires or an embedded React runtime', () => {
  assert.ok(files.has('interpreter.js') && files.has('sample-preview.js'))
  for (const [name, code] of files) {
    assert.doesNotMatch(code, /\b(?:__require(?:\$\d+)?|require)\s*\(\s*["']react["']/u, name + ' must not require a browser peer')
    assert.doesNotMatch(code, /\/node_modules\/react\/cjs\/react\./u, name + ' must not embed another React runtime')
  }
  assert.match(files.get('sample-preview.js'), /from ["']react["']/u)
  assert.ok([...files].some(([name, code]) => name.startsWith('excalidraw-surface-') && /from ["']react["']/u.test(code)), 'The normal canvas graph imports the external React peer')
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
