import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isBuiltin, createRequire } from 'node:module'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { proveKnownBrowserLoaders } from './known-browser-loader-proof.mjs'
import { proveKnownNodeLoaders } from './known-node-loader-proof.mjs'
import { proveEmbeddedImageLoader, EMBEDDED_IMAGE_PINS } from './embedded-image-loader-proof.mjs'

const require = createRequire(import.meta.url)
const { parseSync } = await import(pathToFileURL(createRequire(require.resolve('tsdown')).resolve('rolldown/utils')))

// Deliberately recognize one dispatcher implementation, not arbitrary functions
// named require. Whitespace/locations are immaterial; code changes need review.
export const BROWSERIFY_DISPATCHER = `function() {
  function r(e, n, t) {
    function o(i, f) {
      if (!n[i]) {
        if (!e[i]) {
          var c = "function" == typeof __require && __require;
          if (!f && c) return c(i, !0);
          if (u) return u(i, !0);
          var a = new Error("Cannot find module '" + i + "'");
          throw a.code = "MODULE_NOT_FOUND", a;
        }
        var p = n[i] = { exports: {} };
        e[i][0].call(p.exports, function(r) {
          var n = e[i][1][r];
          return o(n || r);
        }, p, p.exports, r, e, n, t);
      }
      return n[i].exports;
    }
    for (var u = "function" == typeof __require && __require, i = 0; i < t.length; i++) o(t[i]);
    return o;
  }
  return r;
}`
const parse = code => {
  const result = parseSync('emitted.js', code)
  assert.equal(result.errors.length, 0, 'Cannot parse emitted JavaScript')
  return result.program
}
const shape = node => JSON.stringify(node, (key, value) =>
  ['start', 'end', 'loc', 'raw', 'comments', 'leadingComments', 'trailingComments'].includes(key) ? undefined : value)
const dispatcherShape = shape(parse(`(${BROWSERIFY_DISPATCHER})`).body[0].expression)
const functions = new Set(['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'])
const loaderName = name => /^(?:require|_dereq_|__require(?:\$\d+)?|createRequire(?:\$\d+)?)$/u.test(name)
const literal = node => typeof node?.value === 'string' || typeof node?.value === 'number' ? node.value : undefined
const key = property => property.computed ? literal(property.key) : property.key.name ?? literal(property.key)
const moduleId = value => typeof value === 'number' ? Number.isSafeInteger(value) && value > 0 : typeof value === 'string' && value.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(value)
const children = node => Object.entries(node).flatMap(([field, value]) =>
  field === 'parent' ? [] : Array.isArray(value) ? value.filter(x => x?.type) : value?.type ? [value] : [])

export function analyzeEmittedLoaders(code, knownProof) {
  const program = parse(code), parents = new WeakMap(), factoryMaps = new WeakMap(), dispatchers = new WeakSet()
  const loads = [], internalLoads = [], resolveOnly = [], unverified = [], browserify = [], codeEvaluations = []
  const knownLoaderIds = new WeakSet()
  function index(node) { for (const child of children(node)) { parents.set(child, node); index(child) } }
  index(program)
  const nodeCreateRequire = new Set(program.body.filter(node => node.type === 'ImportDeclaration' && node.source.value === 'node:module').flatMap(node =>
    node.specifiers.filter(spec => spec.type === 'ImportSpecifier' && spec.imported.name === 'createRequire').map(spec => spec.local.name)))
  function knownHelpers(node) {
    if (node.type === 'VariableDeclarator' && /^__require(?:\$\d+)?$/u.test(node.id.name)) {
      for (const name of nodeCreateRequire) {
        const expected = parse(`(()=>${name}(import.meta.url))()`).body[0].expression
        if (shape(node.init) === shape(expected)) knownLoaderIds.add(node.id)
      }
    }
    for (const child of children(node)) knownHelpers(child)
  }
  knownHelpers(program)
  function discover(node) {
    if (node.type === 'CallExpression' && node.callee.type === 'CallExpression' &&
        node.callee.arguments.length === 0 && (shape(node.callee.callee) === dispatcherShape || knownProof?.browserifyDispatchers?.some(range => range.start === node.callee.callee.start && range.end === node.callee.callee.end))) {
      const [table, cache, entries] = node.arguments, invoke = parents.get(node)
      assert.equal(node.arguments.length, 3, 'Unverified Browserify dispatcher arguments')
      assert.ok(table?.type === 'ObjectExpression' && cache?.type === 'ObjectExpression' && cache.properties.length === 0 && entries?.type === 'ArrayExpression', 'Unverified Browserify table/cache/entries')
      assert.ok(invoke?.type === 'CallExpression' && invoke.callee === node && invoke.arguments.length === 1, 'Unverified Browserify entry invocation')
      const modules = new Map()
      for (const property of table.properties) {
        assert.ok(property.type === 'Property' && !property.computed && property.kind === 'init', 'Unverified Browserify module property')
        const id = String(key(property)), pair = property.value
        assert.ok(moduleId(key(property)) && !modules.has(id) && pair.type === 'ArrayExpression' && pair.elements.length === 2, 'Invalid Browserify module')
        const [factory, mapping] = pair.elements
        assert.ok(factory.type === 'FunctionExpression' && factory.params.length === 3 && ['require', '_dereq_'].includes(factory.params[0].name) && factory.params.every(p => p.type === 'Identifier') && new Set(factory.params.map(p => p.name)).size === 3 && mapping.type === 'ObjectExpression', 'Unverified Browserify factory')
        const map = new Map()
        for (const link of mapping.properties) {
          assert.ok(link.type === 'Property' && !link.computed && link.kind === 'init' && moduleId(literal(link.value)) && !map.has(String(key(link))), 'Invalid Browserify mapping')
          map.set(String(key(link)), String(literal(link.value)))
        }
        modules.set(id, { factory, map })
      }
      for (const { factory, map } of modules.values()) {
        for (const target of map.values()) assert.ok(modules.has(target), `Missing Browserify mapping target: ${target}`)
        factoryMaps.set(factory, map)
      }
      for (const entry of [...entries.elements, ...invoke.arguments]) assert.ok(literal(entry) !== undefined && modules.has(String(literal(entry))), 'Missing Browserify entry target')
      dispatchers.add(node.callee.callee)
      browserify.push({ modules: [...modules.keys()], entry: literal(invoke.arguments[0]), externalFallback: 'closed by checked literal mappings; nonliteral or escaped loaders block acceptance' })
    }
    for (const child of children(node)) discover(child)
  }
  discover(program)
  const bindings = new WeakMap()
  function pattern(node, names) {
    if (!node) return
    if (node.type === 'Identifier') names.add(node.name)
    else for (const child of children(node)) pattern(child, names)
  }
  function scopeBindings(scope) {
    if (bindings.has(scope)) return bindings.get(scope)
    const names = new Set()
    if (functions.has(scope.type)) scope.params.forEach(p => pattern(p, names))
    function gather(node) {
      if (node !== scope && functions.has(node.type)) { if (node.type === 'FunctionDeclaration') pattern(node.id, names); return }
      if (node.type === 'VariableDeclarator') pattern(node.id, names)
      if (node.type === 'ImportDeclaration') node.specifiers.forEach(s => pattern(s.local, names))
      if (node.type === 'CatchClause') pattern(node.param, names)
      for (const child of children(node)) gather(child)
    }
    gather(scope); bindings.set(scope, names); return names
  }
  function binding(node, name) {
    for (let current = parents.get(node); current; current = parents.get(current)) {
      if ((functions.has(current.type) || current.type === 'Program') && scopeBindings(current).has(name)) return current
    }
  }
  function classify(node, name, argument, kind) {
    const source = literal(argument), owner = binding(node, name), map = factoryMaps.get(owner)
    if (map && name === owner.params[0].name) {
      if (typeof source !== 'string' || !map.has(source)) unverified.push({ kind, source, start: node.start, reason: 'Browserify loader has no proven literal mapping' })
      else (kind === 'resolve' ? resolveOnly : internalLoads).push({ kind, source, target: map.get(source), start: node.start })
    } else if (owner && owner.type !== 'Program') unverified.push({ kind, source, start: node.start, reason: 'Unknown locally bound loader' })
    else if (typeof source !== 'string') unverified.push({ kind, start: node.start, reason: 'Nonliteral external loader' })
    else (kind === 'resolve' ? resolveOnly : loads).push({ kind, source })
  }
  function visit(node) {
    if (knownProof?.skip.some(range => range.start === node.start && range.end === node.end)) return
    if (dispatchers.has(node)) return // implementation checked above; every factory is still visited
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) loads.push({ kind: 'esm', source: literal(node.source) })
    if (node.type === 'ImportExpression') classify(node, '', node.source, 'dynamic-import')
    if (node.type === 'CallExpression') {
      const callee = node.callee
      if (callee.type === 'Identifier' && ['eval', 'Function'].includes(callee.name)) codeEvaluations.push({ start: node.start, kind: callee.name, verified: false })
      if (callee.type === 'Identifier' && /^(?:require|_dereq_|__require(?:\$\d+)?)$/u.test(callee.name)) classify(node, callee.name, node.arguments[0], 'require')
      if (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'require' && callee.object.type !== 'ThisExpression') classify(node, '', node.arguments[0], 'member-require')
      if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && loaderName(callee.object.name) && callee.property.name === 'resolve') classify(node, callee.object.name, node.arguments[0], 'resolve')
      if (callee.type === 'CallExpression' && callee.callee.type === 'Identifier' && /^createRequire(?:\$\d+)?$/u.test(callee.callee.name)) classify(node, callee.callee.name, node.arguments[0], 'require')
    }
    if (node.type === 'Identifier' && loaderName(node.name)) {
      const parent = parents.get(node)
      const grandparent = parents.get(parent)
      const nonReference = parent?.type === 'MemberExpression' && !parent.computed && parent.property === node || ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && !parent.computed && parent.key === node && !parent.shorthand || functions.has(parent?.type) && parent.id === node
      const allowed = nonReference || knownLoaderIds.has(node) || knownProof?.definitions.some(id => id.start === node.start && id.end === node.end) || parent?.type === 'CallExpression' && parent.callee === node || parent?.type === 'MemberExpression' && parent.object === node && parent.property.name === 'resolve' && grandparent?.type === 'CallExpression' && grandparent.callee === parent || functions.has(parent?.type) && parent.params.includes(node) || parent?.type === 'ImportSpecifier' || parent?.type === 'ImportDefaultSpecifier' || knownProof && parent?.type === 'ExportSpecifier' && parent.local === node && knownProof.definitions.some(id => id.name === node.name)
      if (!allowed) unverified.push({ start: node.start, reason: 'Loader reference or alias is not verified', name: node.name })
    }
    if (node.type === 'Identifier' && node.name === 'arguments') {
      let owner = parents.get(node)
      while (owner && !['FunctionExpression', 'FunctionDeclaration'].includes(owner.type)) owner = parents.get(owner)
      if (factoryMaps.has(owner)) unverified.push({ start: node.start, reason: 'Browserify factory extra dispatcher arguments may escape' })
    }
    for (const child of children(node)) visit(child)
  }
  visit(program)
  loads.push(...(knownProof?.trackedLoads ?? []))
  return { loads, internalLoads, resolveOnly, unverified, browserify, codeEvaluations,
    knownBrowserProofs: (knownProof?.proof ?? []).filter(p => p.kind === 'known-browser-loader-chain'),
    knownNodeProofs: (knownProof?.proof ?? []).filter(p => p.kind === 'known-node-loader-chain'),
    knownEmbeddedImageProofs: (knownProof?.proof ?? []).filter(p => p.kind === 'known-embedded-image-loader'), dynamicClosureVerified: false }
}

export async function checkEmitted(root, allowedPackages, { packageRoot = root, relativeArtifacts = {}, knownBrowserShims = false, knownNodeRuntime = false, picaWorkerEvidenceRequired = false, embeddedImageEvidenceRequired = false } = {}) {
  assert.ok(!picaWorkerEvidenceRequired || knownBrowserShims, 'Pica staging requires the ordinary browser forwarding-chain checks')
  assert.ok(!embeddedImageEvidenceRequired || knownBrowserShims, 'Embedded staging requires the ordinary browser forwarding-chain checks')
  const records = []
  const artifacts = new Map(Object.entries(relativeArtifacts))
  root = resolve(root); packageRoot = resolve(packageRoot)
  const boundary = await realpath(packageRoot)
  assert.equal(boundary, packageRoot, 'Package root must be canonical without symlinks')
  assert.equal(await realpath(root), root, 'Output root must be canonical without symlinks')
  assert.ok((await lstat(root)).isDirectory(), 'Output root must be a regular directory')
  const rootRelative = relative(boundary, root)
  assert.ok(rootRelative !== '..' && !rootRelative.startsWith('../'), 'Output root escapes package')
  const files = new Map()
  async function collect(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = resolve(directory, name), info = await lstat(path)
      assert.ok(!info.isSymbolicLink() && (info.isDirectory() || info.isFile()), 'Nonregular emitted input or symlink')
      if (info.isDirectory()) await collect(path)
      else if (/\.(?:mjs|js)$/u.test(name)) files.set(path, await readFile(path, 'utf8'))
    }
  }
  if (knownBrowserShims || knownNodeRuntime) await collect(root)
  const proofs = knownBrowserShims ? proveKnownBrowserLoaders(files, { parse, shape, dispatcher: BROWSERIFY_DISPATCHER }) : new Map()
  if (knownNodeRuntime) for (const [path, nodeProof] of proveKnownNodeLoaders(files, { parse, shape })) {
    const browserProof = proofs.get(path)
    proofs.set(path, browserProof ? { ...nodeProof,
      skip: [...browserProof.skip, ...nodeProof.skip], definitions: [...browserProof.definitions, ...nodeProof.definitions],
      trackedLoads: [...browserProof.trackedLoads, ...nodeProof.trackedLoads], proof: [...browserProof.proof, ...nodeProof.proof] } : nodeProof)
  }
  let uiInputs
  if (embeddedImageEvidenceRequired) {
    // This helper imports the checker: defer until this async entry executes.
    const { verifyUiBlobInputs } = await import('./ui-blob-chain-evidence.mjs')
    uiInputs = await verifyUiBlobInputs(root)
  }
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = resolve(directory, name), info = await lstat(path)
      assert.ok(!info.isSymbolicLink() && (info.isDirectory() || info.isFile()), 'Nonregular emitted input or symlink')
      if (info.isDirectory()) { await walk(path); continue }
      if (!/\.(?:mjs|js)$/u.test(name)) continue
      const code = files.get(path) ?? await readFile(path, 'utf8')
      let proof = proofs?.get(path), embeddedProof
      if (embeddedImageEvidenceRequired && createHash('sha256').update(code).digest('hex') === EMBEDDED_IMAGE_PINS.artifact) {
        embeddedProof = proveEmbeddedImageLoader(code, { parse, shape, dispatcher: BROWSERIFY_DISPATCHER })
        proof = proof ? { ...proof, browserifyDispatchers: [...(proof.browserifyDispatchers ?? []), ...embeddedProof.browserifyDispatchers],
          proof: [...proof.proof, ...embeddedProof.proof] } : embeddedProof
      }
      const result = analyzeEmittedLoaders(code, proof)
      if (embeddedProof) {
        assert.deepEqual(result.unverified, embeddedProof.proof[0].staticUnknown, 'Embedded findings changed')
        assert.deepEqual(result.unverified, uiInputs.staticUnknown)
        result.runtimeEvidenceRequired = { kind:'injected-ui-blob-chain', artifactSha256:EMBEDDED_IMAGE_PINS.artifact,
          staticUnknown:result.unverified, consumer:uiInputs.consumer, moduleInputs:uiInputs.files,
          embeddedDefaultWorkerStatus:'unresolved', browserExecutionVerified:false, boundedImageTaskVerified:false, dynamicClosureVerified:false }
      }
      if (result.unverified.length && picaWorkerEvidenceRequired && !embeddedProof) {
        // Explicit staging mode, never a generic factory whitelist. The fixed
        // classifier throws on changed bytes, unrelated findings or mappings.
        const { classifyPicaWorker, PICA_WORKER_PINS } = await import('./pica-worker-evidence.mjs')
        if (createHash('sha256').update(code).digest('hex') === PICA_WORKER_PINS.artifact) {
          try {
            result.runtimeEvidenceRequired = classifyPicaWorker(code)
            assert.deepEqual(result.unverified, result.runtimeEvidenceRequired.staticUnknown)
          } catch (error) { throw new Error(`Pica classification rejected in ${path}: ${error.message}`, { cause: error }) }
        }
      }
      if (!result.runtimeEvidenceRequired) assert.equal(result.unverified.length, 0, `Unverified emitted loader in ${path}: ${JSON.stringify(result.unverified.slice(0, 3))}`)
      for (const { source } of [...result.loads, ...result.resolveOnly.filter(load => !load.target)]) {
        // Node's authoritative predicate also covers prefix-only builtins such
        // as node:sqlite, which older builtinModules lists intentionally omit.
        if (isBuiltin(source)) continue
        if (source.startsWith('.')) {
          const target = resolve(dirname(path), source), rel = relative(root, target)
          if (rel === '..' || rel.startsWith('../')) {
            assert.ok(artifacts.has(source), `Import escapes output: ${source}`)
            assert.equal(target, resolve(packageRoot, artifacts.get(source)), `Unexpected package artifact target: ${source}`)
            const inPackage = relative(boundary, target)
            assert.ok(inPackage !== '..' && !inPackage.startsWith('../'), `Import escapes package: ${source}`)
            const info = await lstat(target)
            assert.ok(info.isFile() && !info.isSymbolicLink(), `Missing regular package artifact: ${source}`)
            assert.equal(await realpath(target), target, `Package artifact follows a symlink: ${source}`)
          } else {
            const info = await lstat(target)
            assert.ok(info.isFile() && !info.isSymbolicLink(), `Missing regular emitted dependency: ${source}`)
            assert.equal(await realpath(target), target, `Emitted dependency follows a symlink: ${source}`)
          }
        } else assert.ok([...allowedPackages].some(pkg => source === pkg || source.startsWith(pkg + '/')), `Undeclared emitted runtime dependency: ${source} in ${path}`)
      }
      records.push({ file: relative(root, path), ...result })
    }
  }
  await walk(root)
  return records
}
