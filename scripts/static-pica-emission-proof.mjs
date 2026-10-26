/** Normal static-Worker emission proof. Historical Blob pins remain separate. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, resolve, relative } from 'node:path'
import { readdir, lstat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { build } from 'tsdown'
import { regularFile, sha256, PICA_WORKER_PINS } from './pica-worker-evidence.mjs'
import { readStaticPicaInput, compileStaticPicaWorkers, assertStaticPicaToolchain, analyzeStaticPicaWorker } from './pica-static-worker-compiler.mjs'
import { adaptStaticPicaParent, analyzeStaticPicaAuxiliary } from './pica-static-worker-adapter.mjs'
import { indexBrowserBindings, sameBrowserBindings, unparen } from './known-flat-browser-loader-proof.mjs'
import { verifyOutputModuleFiles } from './companion-output-module-map.mjs'
import { UI_BLOB_FILES, verifyUiBlobConsumer } from './ui-blob-chain-evidence.mjs'

const require = createRequire(import.meta.url)
const { parseSync } = await import(pathToFileURL(createRequire(require.resolve('tsdown')).resolve('rolldown/utils')))
const parse = code => { const result = parseSync('static-pica.js', code); assert.equal(result.errors.length, 0); return result.program }
export const STATIC_PICA_MANIFEST = 'pica-static-workers-client.json'
export const STATIC_PICA_RULE = 'pica-static-source-compiler-v1'
const sourceEntries = { standalone: ['pica', '7.1.1', 'dist/pica.js'], embedded: ['image-blob-reduce', '3.0.1', 'dist/image-blob-reduce.esm.mjs'] }
const children = node => Object.values(node).flatMap(v => Array.isArray(v) ? v.filter(x => x?.type) : v?.type ? [v] : [])
const expectedCache = new Map()
async function expectedParents(inputs) {
  const key = sha256(inputs.standalone.source) + sha256(inputs.embedded.source)
  if (!expectedCache.has(key)) expectedCache.set(key, (async () => {
    const compiled = await compileStaticPicaWorkers(inputs)
    return Object.fromEntries(await Promise.all(Object.keys(sourceEntries).map(async kind => {
      const adapted = adaptStaticPicaParent(inputs[kind], compiled[kind])
      return [kind, { adapted, program: await normalizedParent(adapted.code, kind) }]
    })))
  })())
  return expectedCache.get(key)
}

function defaultDirectories() {
  const panel = createRequire(new URL('../packages/panel/package.json', import.meta.url))
  const importer = createRequire(panel.resolve('@excalidraw/excalidraw'))
  return Object.fromEntries(Object.entries(sourceEntries).map(([kind, [name]]) => [kind, dirname(importer.resolve(name + '/package.json'))]))
}

// A bounded, write:false normalization of one already pinned parent, not a
// product build. It applies the same pinned printer/CJS lowering as emission.
async function normalizedParent(source, kind) {
  const entry = 'fixed-parent.' + (kind === 'standalone' ? 'cjs' : 'mjs')
  const bundles = await build({ config: false, entry: { parent: entry }, outDir: resolve('.unused-static-pica-proof'),
    write: false, clean: false, format: 'esm', platform: 'browser', target: 'es2024', tsconfig: false, dts: false, logLevel: 'silent',
    deps: { alwaysBundle: [/.*/], onlyBundle: false }, outputOptions: { codeSplitting: false },
    plugins: [{ name: 'source-pinned-parent-proof', resolveId(id) { if (id === entry) return '\0' + entry },
      load(id) { if (id === '\0' + entry) return source } }] })
  try {
    const chunks = bundles.flatMap(b => b.chunks).filter(c => c.type === 'chunk')
    assert.equal(chunks.length, 1, 'Unexpected parent compiler outputs')
    return parse(chunks[0].code)
  } finally { await Promise.all(bundles.map(b => b[Symbol.asyncDispose]())) }
}

function cjsFactory(program, index) {
  const last = program.body.at(-1)
  assert.equal(last.type, 'ExportDefaultDeclaration')
  const call = last.declaration
  assert.ok(call.type === 'CallExpression' && call.callee.type === 'Identifier' && call.arguments.length === 0)
  const token = index.binding(call.callee)
  assert.ok(token?.declarations.length === 1)
  const declaration = token.declarations[0].declaration
  assert.ok(declaration.type === 'VariableDeclarator' && declaration.init?.type === 'CallExpression' && declaration.init.arguments.length === 1)
  const factory = unparen(declaration.init.arguments[0])
  assert.ok(factory.type === 'ArrowFunctionExpression' && !factory.async && factory.params.length === 2
    && factory.params.every(p => p.type === 'Identifier') && factory.body.type === 'BlockStatement' && factory.body.body.length === 1)
  return { factory, declaration }
}

function verifyParent(actual, expected, kind, runtimeFile) {
  const a = indexBrowserBindings(actual), b = indexBrowserBindings(expected)
  if (kind === 'embedded') {
    assert.ok(sameBrowserBindings(actual, expected, a, b), 'Static embedded parent AST/binding drift')
    return
  }
  assert.equal(actual.body.length, 3, 'Extra standalone parent code')
  const imp = actual.body[0]
  assert.ok(imp.type === 'ImportDeclaration' && imp.source.value === './' + runtimeFile && imp.specifiers.length === 2)
  const imports = new Map(imp.specifiers.map(s => { assert.equal(s.type, 'ImportSpecifier'); return [s.imported.name, s.local] }))
  assert.deepEqual([...imports.keys()].sort(), ['i', 't'], 'Unknown standalone runtime helpers')
  const { factory: af, declaration } = cjsFactory(actual, a), { factory: bf } = cjsFactory(expected, b)
  assert.ok(actual.body[1].type === 'VariableDeclaration' && actual.body[1].kind === 'var'
    && actual.body[1].declarations.length === 1 && actual.body[1].declarations[0] === declaration
    && a.binding(declaration.init.callee) === a.binding(imports.get('t')), 'Standalone CJS owner drift')
  const expectedRequire = b.binding((b.identifiers.get('__require') ?? [])[0])
  assert.ok(expectedRequire, 'Expected compiler runtime helper missing')
  const roots = new Map([[b.binding(bf.params[0]), a.binding(af.params[0])], [b.binding(bf.params[1]), a.binding(af.params[1])],
    [expectedRequire, a.binding(imports.get('i'))]])
  assert.ok(sameBrowserBindings(af.body.body[0], bf.body.body[0], a, b, new Map(), roots), 'Static standalone parent AST/binding drift')
}

function actualScripts(program, adapted, input) {
  const strings = []
  const walk = node => { if (node.type === 'Literal' && typeof node.value === 'string') strings.push(node.value); children(node).forEach(walk) }
  walk(program)
  const result = {}
  for (const role of ['task', 'probe', 'auxiliary']) {
    const expected = adapted.scripts[role].code
    const encoded = role === 'auxiliary' ? Buffer.from(expected, 'latin1').toString('base64') : expected
    const found = strings.filter(value => value === encoded)
    assert.equal(found.length, 1, 'Missing or duplicate actual Worker script: ' + role)
    const code = role === 'auxiliary' ? Buffer.from(found[0], 'base64').toString('latin1') : found[0]
    const analysis = role === 'auxiliary' ? analyzeStaticPicaAuxiliary(code, { input }) : analyzeStaticPicaWorker(code, { role, input })
    assert.equal(analysis.sha256, adapted.scripts[role].sha256, 'Actual Worker compiler-byte drift')
    result[role] = { bytes: analysis.bytes, sha256: analysis.sha256, parsedActualScript: true }
  }
  return result
}

function loaderProof(program, code) {
  const tables = []
  const walk = node => {
    if (node.type === 'CallExpression' && node.arguments.length === 3
      && node.arguments[0]?.type === 'ObjectExpression' && node.arguments[0].properties.length === 25
      && node.callee.type === 'CallExpression' && node.callee.arguments.length === 0) tables.push(node)
    children(node).forEach(walk)
  }
  walk(program)
  assert.equal(tables.length, 1, 'Expected one source-verified parent module table')
  const dispatcher = tables[0].callee.callee
  // No factory is skipped. The ordinary checker still validates all literal
  // mappings and visits every factory after this whole-parent AST proof.
  return { staticPicaSource: { sha256: sha256(code) }, skip: [], definitions: [], trackedLoads: [],
    browserifyDispatchers: [{ start: dispatcher.start, end: dispatcher.end }], proof: [] }
}

function verifyConsumer(code, names) {
  const program = parse(code), declarations = program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations)
  const candidate = declarations.filter(n => n.id.type === 'Identifier' && n.id.name === '_Y')
  assert.equal(candidate.length, 1, 'Expected one fixed UI consumer')
  const owner = candidate[0], imports = []
  const walk = node => { if (node.type === 'ImportExpression' && ['./' + names.standalone, './' + names.embedded].includes(node.source?.value)) imports.push(node); children(node).forEach(walk) }
  walk(program)
  assert.deepEqual(imports.map(n => n.source.value), ['./' + names.standalone, './' + names.embedded], 'Ambiguous static UI routes')
  assert.ok(imports.every(n => owner.start <= n.start && n.end <= owner.end), 'UI route escaped its fixed consumer')
  let normalized = code.slice(owner.start, owner.end)
  for (const [i, old] of [[1, UI_BLOB_FILES.image], [0, UI_BLOB_FILES.pica]]) {
    const node = imports[i].source
    normalized = normalized.slice(0, node.start - owner.start) + JSON.stringify('./' + old) + normalized.slice(node.end - owner.start)
  }
  const proof = verifyUiBlobConsumer('var ' + normalized + ';')
  return { ...proof, clientSha256: sha256(code), start: owner.start, end: owner.end, actualRoutes: names,
    routeNamesNormalizedOnly: true }
}

/** Map membership locates modules. Actual pinned-source/compiler ASTs prove them. */
export async function verifyStaticPicaEmission(webRoot, { moduleMap, sourceDirectories = defaultDirectories() } = {}) {
  assert.ok(moduleMap, 'Static Pica requires the normal emitted module map')
  assert.equal(moduleMap.kind, 'emitted-output-module-associations')
  assert.equal(moduleMap.label, 'web')
  webRoot = resolve(webRoot)
  const mapping = await verifyOutputModuleFiles({ ...moduleMap, outputRoot: webRoot })
  const javascript = []
  async function walk(dir) { for (const name of (await readdir(dir)).sort()) {
    const path = resolve(dir, name), info = await lstat(path)
    assert.ok(!info.isSymbolicLink() && (info.isFile() || info.isDirectory()), 'Nonregular static emission')
    if (info.isDirectory()) await walk(path); else if (/\.(?:mjs|js)$/u.test(name)) javascript.push(relative(webRoot, path).replaceAll('\\', '/'))
  } }
  await walk(webRoot)
  assert.deepEqual(javascript.sort(), mapping.outputs.filter(o => /\.(?:mjs|js)$/u.test(o.fileName)).map(o => o.fileName).sort(), 'Unmapped or duplicate emitted JavaScript')
  const manifestBytes = await regularFile(webRoot, STATIC_PICA_MANIFEST), manifest = JSON.parse(manifestBytes)
  assert.ok(manifestBytes.length <= 1024 * 1024, 'Static manifest budget exceeded')
  assert.equal(manifest.version, 1); assert.deepEqual(manifest.entries, ['client']); assert.equal(manifest.browserExecuted, false)
  assert.equal(manifest.sources.length, 2)
  assert.deepEqual(manifest.sources.map(s => s.manifest.kind).sort(), ['embedded', 'standalone'], 'Missing/duplicate static source role')
  const manifestOutput = mapping.outputs.filter(o => o.fileName === STATIC_PICA_MANIFEST)
  assert.equal(manifestOutput.length, 1); assert.equal(manifestOutput[0].sha256, sha256(manifestBytes))
  const inputs = Object.fromEntries(await Promise.all(Object.keys(sourceEntries).map(async kind => [kind,
    await readStaticPicaInput({ kind, directory: sourceDirectories[kind] })])))
  const expected = await expectedParents(inputs), names = {}, pending = [], loaderProofs = {}
  const runtime = mapping.outputs.filter(o => o.type === 'chunk' && o.sha256 === PICA_WORKER_PINS.runtime
    && o.moduleIds?.some(id => id.rawId === '\0rolldown/runtime.js'))
  assert.equal(runtime.length, 1, 'Missing/duplicate reviewed runtime')
  for (const kind of ['standalone', 'embedded']) {
    const [name, version, entry] = sourceEntries[kind], record = manifest.sources.find(s => s.manifest.kind === kind)
    assert.deepEqual(record.source, { package: name, version, entry })
    assertStaticPicaToolchain(record.manifest.toolchain)
    const { adapted, program } = expected[kind]
    assert.deepEqual(record.manifest, { ...adapted.manifest, toolchain: { ...adapted.manifest.toolchain, node: record.manifest.toolchain.node } }, 'Static source/compiler manifest drift')
    assert.deepEqual(record.workers, adapted.scripts, 'Static Worker source or declared status drift')
    const rows = mapping.outputs.filter(o => o.type === 'chunk' && o.facade?.rawId?.replaceAll('\\', '/').endsWith('/node_modules/' + name + '/' + entry))
    assert.equal(rows.length, 1, 'Missing/duplicate exact parent source')
    const row = rows[0]
    assert.equal(mapping.outputs.filter(o => o.type === 'chunk' && o.sha256 === row.sha256).length, 1, 'Duplicate parent artifact bytes')
    assert.ok(row.moduleIds.length === 1 && row.moduleIds[0].rawId === row.facade.rawId, 'Parent membership is ambiguous')
    names[kind] = row.fileName
    const code = (await regularFile(webRoot, row.fileName)).toString('utf8')
    assert.ok(Buffer.byteLength(code) <= 512 * 1024, 'Static parent budget exceeded')
    const actual = parse(code)
    verifyParent(actual, program, kind, runtime[0].fileName)
    loaderProofs[row.fileName] = loaderProof(actual, code)
    const scripts = actualScripts(actual, adapted, inputs[kind])
    pending.push({ file: row.fileName, kind: 'static-pica-worker-task', rule: STATIC_PICA_RULE, sourceKind: kind,
      artifactSha256: sha256(code), manifestSha256: sha256(manifestBytes), source: structuredClone(adapted.manifest.source), scripts,
      parentWorkerBindingVerified: true, browserExecutionVerified: false, boundedWorkerTaskVerified: false, dynamicClosureVerified: false })
  }
  const client = mapping.outputs.filter(o => o.fileName === 'client.js' && o.isEntry)
  assert.equal(client.length, 1, 'Missing exact UI client entry')
  const consumer = verifyConsumer((await regularFile(webRoot, 'client.js')).toString('utf8'), names)
  return { pending, consumer, loaderProofs, dynamicClosureVerified: false }
}
