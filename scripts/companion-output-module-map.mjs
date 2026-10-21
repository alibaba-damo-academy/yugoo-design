/** Bundler-reported chunk membership, not complete retained-code or license proof. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const sortedStrings = (values, field) => {
  assert.ok(Array.isArray(values) && values.every(value => typeof value === 'string'), `Invalid ${field}`)
  return [...values].sort(compare)
}
function outputPath(value) {
  assert.ok(typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && !value.includes('\\') && !isAbsolute(value) && !/^[A-Za-z]:/u.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid output relative path')
  return value
}
function identity(rawId, workspaceRoot) {
  assert.ok(typeof rawId === 'string' && rawId.length > 0, 'Invalid module identity')
  if (rawId.includes('\0')) return { id: `virtual:${rawId}`, identityKind: 'virtual', rawId }
  if (isAbsolute(rawId)) {
    const path = relative(workspaceRoot, rawId).split(sep).join('/')
    if (path && path !== '..' && !path.startsWith('../') && !isAbsolute(path)) {
      return { id: `workspace:${path}`, identityKind: 'workspace-file', rawId }
    }
    return { id: `outside-root:${sha(rawId)}`, identityKind: 'outside-root-opaque', rawId }
  }
  return { id: `opaque:${rawId}`, identityKind: 'opaque', rawId }
}

/** All lazy fields are read synchronously. No output handles or source bytes escape. */
export function captureOutputModuleMap(label, outputs, { workspaceRoot, outputRoot }) {
  assert.ok(typeof label === 'string' && label.length > 0, 'Build label required')
  assert.ok(isAbsolute(workspaceRoot) && isAbsolute(outputRoot), 'Absolute collection roots required')
  assert.ok(Array.isArray(outputs), 'Output array required')
  workspaceRoot = resolve(workspaceRoot); outputRoot = resolve(outputRoot)
  const seen = new Set(), records = []
  for (const output of outputs) {
    assert.ok(output && ['chunk', 'asset'].includes(output.type), 'Unknown output type')
    const fileName = outputPath(output.fileName)
    assert.ok(!seen.has(fileName), 'Duplicate output identity'); seen.add(fileName)
    assert.ok(typeof output.outDir === 'string' && resolve(output.outDir) === outputRoot, 'Output root mismatch')
    const source = output.type === 'chunk' ? output.code : output.source
    assert.ok(typeof source === 'string' || output.type === 'asset' && source instanceof Uint8Array, 'Invalid output bytes')
    const bytes = Buffer.from(source)
    const record = { fileName, type: output.type, utf8Bytes: bytes.length, sha256: sha(bytes) }
    if (output.type === 'asset') {
      record.moduleMapping = 'asset-source-unavailable'
    } else {
      assert.ok(typeof output.isEntry === 'boolean' && typeof output.isDynamicEntry === 'boolean', 'Invalid chunk entry flags')
      record.isEntry = output.isEntry; record.isDynamicEntry = output.isDynamicEntry
      assert.ok(output.facadeModuleId === null || typeof output.facadeModuleId === 'string', 'Invalid facade identity')
      record.facade = output.facadeModuleId === null ? null : identity(output.facadeModuleId, workspaceRoot)
      record.imports = sortedStrings(output.imports, 'imports')
      record.dynamicImports = sortedStrings(output.dynamicImports, 'dynamicImports')
      const moduleIds = output.moduleIds
      record.moduleIds = sortedStrings(moduleIds, 'moduleIds').map(id => identity(id, workspaceRoot))
      const modules = output.modules
      if (modules === undefined || modules === null) {
        record.moduleMapping = 'mapping-unavailable'; record.modules = []
        record.moduleIdsKeySetStatus = 'unavailable'
      } else {
        assert.ok(typeof modules === 'object' && !Array.isArray(modules), 'Invalid chunk modules')
        const ids = new Set()
        record.modules = Object.entries(modules).map(([rawId, module]) => {
          const id = identity(rawId, workspaceRoot)
          assert.ok(!ids.has(id.id), 'Duplicate normalized module identity'); ids.add(id.id)
          assert.ok(module && typeof module === 'object', 'Invalid rendered module')
          const code = module.code, length = module.renderedLength
          assert.ok(code === null || typeof code === 'string', 'Invalid rendered code')
          assert.ok(Number.isSafeInteger(length) && length >= 0, 'Invalid rendered length')
          if (code !== null) assert.equal(length, code.length, 'Rendered length mismatch')
          return { ...id, association: 'chunk-membership',
            codeState: code === null ? 'rendered-code-unavailable' : code.length ? 'rendered-code-observed' : 'empty-rendered-code-observed',
            renderedLength: length, renderedExports: sortedStrings(module.renderedExports, 'renderedExports'),
            renderedCodeSha256: code === null ? null : sha(code),
            innerInventory: 'not-inventoried' }
        }).sort((a, b) => compare(a.id, b.id))
        const metadataIds = Object.keys(modules).sort(compare)
        record.moduleIdsKeySetStatus = JSON.stringify(metadataIds) === JSON.stringify([...moduleIds].sort(compare)) ? 'equal' : 'mismatch'
        record.moduleMapping = 'bundler-reported-membership'
      }
    }
    records.push(record)
  }
  records.sort((a, b) => compare(a.fileName, b.fileName))
  const outputNames = new Set(records.map(record => record.fileName))
  for (const record of records.filter(record => record.type === 'chunk')) {
    record.dependencyReferences = [...record.imports.map(specifier => ({ kind: 'static', specifier })),
      ...record.dynamicImports.map(specifier => ({ kind: 'dynamic', specifier }))]
      .map(ref => {
        const targetName = ref.specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(record.fileName), ref.specifier)) : ref.specifier
        return { ...ref, target: outputNames.has(targetName) ? 'sibling-output' : 'external-or-unresolved' }
      })
  }
  // Private raw paths are useful for joining to observed input hashes, but are
  // excluded from canonical portable identity. Out-of-root IDs stay opaque.
  const portable = JSON.parse(JSON.stringify(records, (key, value) => key === 'rawId' ? undefined : value))
  return { kind: 'emitted-output-module-associations', label, outputRoot, outputs: records,
    canonicalSha256: sha(JSON.stringify({ label, outputs: portable })),
    diskAssociationVerified: false, actualGetterLifetimeVerified: false,
    completeBundledInventory: false, releaseLicenseAcceptance: false }
}

async function ordinaryOutput(root, name) {
  const path = resolve(root, outputPath(name)), parts = path.split(sep).filter(Boolean)
  let current = path.startsWith(sep) ? sep : ''
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i])
    const info = await lstat(current)
    assert.ok(!info.isSymbolicLink() && (i === parts.length - 1 ? info.isFile() : info.isDirectory()), 'Nonregular emitted output')
  }
  return readFile(path)
}

/** Read-only file association. Does not promote any build/release acceptance. */
export async function verifyOutputModuleFiles(snapshot) {
  snapshot = structuredClone(snapshot) // snapshot caller-owned metadata before any await
  assert.equal(snapshot.kind, 'emitted-output-module-associations')
  assert.ok(isAbsolute(snapshot.outputRoot), 'Absolute output root required')
  const outputs = snapshot.outputs.map(row => ({ fileName: outputPath(row.fileName), utf8Bytes: row.utf8Bytes, sha256: row.sha256 }))
  const names = new Set()
  for (const row of outputs) {
    assert.ok(!names.has(row.fileName), 'Duplicate output identity'); names.add(row.fileName)
    assert.ok(Number.isSafeInteger(row.utf8Bytes) && row.utf8Bytes >= 0 && /^[a-f0-9]{64}$/u.test(row.sha256), 'Invalid output association')
  }
  const root = snapshot.outputRoot
  for (const row of outputs) {
    const bytes = await ordinaryOutput(root, row.fileName)
    assert.equal(bytes.length, row.utf8Bytes, 'Emitted output byte length drift')
    assert.equal(sha(bytes), row.sha256, 'Emitted output hash drift')
  }
  return { ...snapshot, diskAssociationVerified: true,
    actualGetterLifetimeVerified: false, completeBundledInventory: false, releaseLicenseAcceptance: false }
}
