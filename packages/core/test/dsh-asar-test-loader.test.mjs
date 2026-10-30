/** Project-authored, disposable ASAR fixtures. No official archive, SDK, profiles or native addon is loaded. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { registerHooks } from 'node:module'
import { loadDshAsar } from './dsh-asar-test-loader.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const manifest = value => JSON.stringify(value)
let serial = 0
function writeAsar(path, members) {
  const tree = { files: {} }, bodies = []
  let offset = 0
  for (const [path, input] of Object.entries(members)) {
    const parts = path.split('/'), name = parts.pop()
    let parent = tree
    for (const part of parts) parent = parent.files[part] ??= { files: {} }
    if (typeof input === 'object' && !Buffer.isBuffer(input) && input.entry) {
      parent.files[name] = input.entry
      continue
    }
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === 'object' ? input.content : input)
    parent.files[name] = { size: bytes.length, offset: String(offset), integrity: { algorithm: 'SHA256', hash: typeof input === 'object' && input.hash ? input.hash : digest(bytes) } }
    bodies.push(bytes); offset += bytes.length
  }
  const header = Buffer.from(JSON.stringify(tree)), prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(8 + header.length, 4)
  prefix.writeUInt32LE(header.length, 12)
  writeFileSync(path, Buffer.concat([prefix, header, ...bodies]), { mode: 0o600 })
}
function fixture(t, build) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-asar-boundary-')), archive = join(root, 'fixture.asar')
  const oldTmp = Object.fromEntries(['TMPDIR', 'TMP', 'TEMP'].map(key => [key, process.env[key]]))
  for (const key of Object.keys(oldTmp)) process.env[key] = root
  const name = '@deepseek-ai/asar_probe_' + ++serial, pkg = 'dsh/node_modules/' + name
  const trace = []
  let runtime, observer
  t.after(() => {
    observer?.deregister(); runtime?.close()
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith('dsh-asar-cjs-')), [], 'close removes owned staging even after rejection')
    for (const [key, value] of Object.entries(oldTmp)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    rmSync(root, { recursive: true, force: true })
  })
  const members = build({ root, name, pkg })
  writeAsar(archive, members)
  runtime = loadDshAsar(archive)
  observer = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.includes('dsh-asar-cjs-')) trace.push({ specifier, parentURL: context.parentURL, conditions: [...context.conditions] })
    return next(specifier, context)
  } })
  return { root, name, pkg, runtime, trace }
}

test('import versus require conditions and relative extensionless CJS resolve in one verified archive', async t => {
  const f = fixture(t, ({ name, pkg }) => ({
    [pkg + '/package.json']: manifest({ name, type: 'module', exports: { '.': { import: './esm.js', require: './cjs.cjs' }, './caller': './caller.cjs' } }),
    [pkg + '/esm.js']: 'export const branch = "import"',
    [pkg + '/cjs.cjs']: 'exports.branch = "require"',
    [pkg + '/caller.cjs']: 'module.exports = { branch: require(' + JSON.stringify(name) + ').branch, helper: require("./helper").value }',
    [pkg + '/helper.js']: 'exports.value = 42',
  }))
  assert.equal((await import(f.name)).branch, 'import')
  // helper must be .cjs-compatible under a nearest CommonJS manifest.
  // This package intentionally uses type:module to check that .js honors it.
  await assert.rejects(import(f.name + '/caller'), /exports is not defined|require.*ES Module|ERR_REQUIRE/iu)
  t.diagnostic(JSON.stringify({ trace: f.trace }))
})

test('CommonJS .js plus extensionless relative dependency works and close removes staged bytes', async t => {
  const f = fixture(t, ({ name, pkg }) => ({
    [pkg + '/package.json']: manifest({ name, type: 'commonjs', exports: { '.': { require: './index.js', import: './index.js' } } }),
    [pkg + '/index.js']: 'module.exports = require("./helper").value',
    [pkg + '/helper.js']: 'exports.value = 42',
  }))
  assert.equal((await import(f.name)).default, 42)
})

test('tampered ordinary member rejects before executing it', async t => {
  const f = fixture(t, ({ name, pkg }) => ({
    [pkg + '/package.json']: manifest({ name, type: 'commonjs', main: './index.cjs' }),
    [pkg + '/index.cjs']: { content: 'module.exports = "tampered"', hash: '0'.repeat(64) },
  }))
  await assert.rejects(import(f.name), /integrity mismatch/iu)
})

for (const kind of ['link', 'unpacked']) test(kind + ' members reject through explicit read and cannot execute', async t => {
  const f = fixture(t, ({ name, pkg }) => ({
    [pkg + '/package.json']: manifest({ name, type: 'commonjs', main: './entry.cjs' }),
    [pkg + '/entry.cjs']: { entry: kind === 'link' ? { link: 'somewhere.cjs' } : { unpacked: true, size: 5, offset: '0', integrity: { hash: '0'.repeat(64) } } },
  }))
  assert.throws(() => f.runtime.readPackageFile(f.name, 'entry.cjs'), /bounded ordinary/iu)
  await assert.rejects(import(f.name))
})

test('CJS cannot fall through to a controlled external bare package', async t => {
  const f = fixture(t, ({ root, name, pkg }) => {
    const external = join(root, 'node_modules', 'cx2-external')
    mkdirSync(external, { recursive: true })
    writeFileSync(join(external, 'package.json'), manifest({ name: 'cx2-external', type: 'commonjs', main: 'index.cjs' }))
    writeFileSync(join(external, 'index.cjs'), 'module.exports = "EXTERNAL_BARE_EXECUTED"')
    return { [pkg + '/package.json']: manifest({ name, type: 'commonjs', main: './index.cjs' }), [pkg + '/index.cjs']: 'module.exports = require("cx2-external")' }
  })
  try { await assert.rejects(import(f.name), /outside|archive|closure|not found/iu) }
  finally { t.diagnostic(JSON.stringify({ trace: f.trace })) }
})

test('CJS cannot require an absolute controlled external source file', async t => {
  const f = fixture(t, ({ root, name, pkg }) => {
    const external = join(root, 'external.cjs')
    writeFileSync(external, 'module.exports = "EXTERNAL_ABSOLUTE_EXECUTED"')
    return { [pkg + '/package.json']: manifest({ name, type: 'commonjs', main: './index.cjs' }), [pkg + '/index.cjs']: 'module.exports = require(' + JSON.stringify(external) + ')' }
  })
  try { await assert.rejects(import(f.name), /outside|archive|closure|not found/iu) }
  finally { t.diagnostic(JSON.stringify({ trace: f.trace })) }
})

for (const type of ['commonjs', 'module']) test('.node entry is rejected regardless of package type=' + type, async t => {
  const f = fixture(t, ({ name, pkg }) => ({
    [pkg + '/package.json']: manifest({ name, type, exports: './entry.node' }),
    // Plain JS sentinel avoids loading any real native addon. Execution still proves the extension guard failed.
    [pkg + '/entry.node']: type === 'module' ? 'export const nativeGuardBypassed = true' : 'module.exports = { nativeGuardBypassed: true }',
  }))
  await assert.rejects(import(f.name), /native|ordinary|module|extension|ENOENT/iu)
})

for (const budget of ['files', 'bytes']) test('failed ' + budget + ' budget cannot be bypassed by a second import of its partially staged package', async t => {
  const f = fixture(t, ({ name, pkg }) => {
    const result = { [pkg + '/package.json']: manifest({ name, type: 'commonjs', main: './index.cjs' }), [pkg + '/index.cjs']: 'module.exports = "PARTIAL_PACKAGE_EXECUTED"' }
    if (budget === 'files') for (let i = 0; i < 511; i++) result[pkg + '/extra-' + i + '.txt'] = 'x'
    else for (let i = 0; i < 3; i++) result[pkg + '/extra-' + i + '.txt'] = Buffer.alloc(3 * 1024 ** 2, 0x61)
    return result
  })
  await assert.rejects(import(f.name), /exceeds budget/iu)
  await assert.rejects(import(f.name), /exceeds budget|incomplete|failed/iu)
})

test('positive import and require branches plus extensionless CommonJS preserve actual values', async t => {
  const f = fixture(t, ({ name, pkg }) => ({
    [pkg + '/package.json']: manifest({ name, type: 'commonjs', exports: { '.': { import: './esm.mjs', require: './cjs.js' }, './caller': './caller.cjs' } }),
    [pkg + '/esm.mjs']: 'export const branch = "import"',
    [pkg + '/cjs.js']: 'exports.branch = "require"',
    [pkg + '/caller.cjs']: 'module.exports = { branch: require(' + JSON.stringify(name) + ').branch, helper: require("./helper").value }',
    [pkg + '/helper.js']: 'exports.value = 42',
  }))
  assert.equal((await import(f.name)).branch, 'import')
  assert.deepEqual((await import(f.name + '/caller')).default, { branch: 'require', helper: 42 })
})

test('later ordinary asset integrity failure cannot publish an earlier valid entry on retry', async t => {
  const f = fixture(t, ({ name, pkg }) => ({
    [pkg + '/package.json']: manifest({ name, type: 'commonjs', main: './index.cjs' }),
    [pkg + '/index.cjs']: 'module.exports = "PARTIAL_INTEGRITY_PACKAGE_EXECUTED"',
    [pkg + '/corrupt.txt']: { content: 'bad bytes', hash: '0'.repeat(64) },
  }))
  await assert.rejects(import(f.name), /integrity mismatch/iu)
  await assert.rejects(import(f.name), /integrity mismatch|failed|incomplete/iu)
})

test('missing required archived dependency cannot publish the staged parent on retry', async t => {
  const f = fixture(t, ({ name, pkg }) => ({
    [pkg + '/package.json']: manifest({ name, type: 'commonjs', main: './index.cjs', dependencies: { 'cx2-missing-archived': '1' } }),
    [pkg + '/index.cjs']: 'module.exports = "PARTIAL_DEPENDENCY_PACKAGE_EXECUTED"',
  }))
  await assert.rejects(import(f.name), /Missing archived CJS dependency/iu)
  await assert.rejects(import(f.name), /Missing archived CJS dependency|failed|incomplete/iu)
})

test('legitimate declared CJS dependency cycle terminates staging and stays usable', async t => {
  const f = fixture(t, ({ name, pkg }) => {
    const b = name + '_dependency', bp = 'dsh/node_modules/' + b
    return {
      [pkg + '/package.json']: manifest({ name, type: 'commonjs', main: './index.cjs', dependencies: { [b]: '1' } }),
      [pkg + '/index.cjs']: 'module.exports = { name: "A", peer: require(' + JSON.stringify(b) + ').name }',
      [bp + '/package.json']: manifest({ name: b, type: 'commonjs', main: './index.cjs', dependencies: { [name]: '1' } }),
      [bp + '/index.cjs']: 'exports.name = "B"',
    }
  })
  assert.deepEqual((await import(f.name)).default, { name: 'A', peer: 'B' })
})

test('changing staged ordinary source after resolve rejects before execution', async t => {
  const f = fixture(t, ({ name, pkg }) => ({
    [pkg + '/package.json']: manifest({ name, type: 'commonjs', main: './index.cjs' }),
    [pkg + '/index.cjs']: 'module.exports = "original"',
  }))
  let changed = false
  const mutator = registerHooks({ load(url, context, next) {
    if (!changed && url.includes('dsh-asar-cjs-') && url.endsWith('/index.cjs')) {
      changed = true
      chmodSync(new URL(url), 0o600)
      writeFileSync(new URL(url), 'module.exports = "tampered staged source"')
    }
    return next(url, context)
  } })
  t.after(() => mutator.deregister())
  await assert.rejects(import(f.name), /Staged ASAR member changed/iu)
  assert.equal(changed, true)
})

test('failed new closure removes only its own files and preserves committed data and remaining budget', async t => {
  let bad, good
  const f = fixture(t, ({ name, pkg }) => {
    bad = name + '_bad'; good = name + '_good'
    const bp = 'dsh/node_modules/' + bad, gp = 'dsh/node_modules/' + good
    const members = {
      [pkg + '/package.json']: manifest({ name, type: 'commonjs', main: './index.cjs' }),
      [pkg + '/index.cjs']: 'module.exports = "COMMITTED_OLD"',
      [bp + '/package.json']: manifest({ name: bad, type: 'commonjs', main: './index.cjs' }),
      [bp + '/index.cjs']: 'module.exports = "MUST_NOT_EXECUTE"',
      [gp + '/package.json']: manifest({ name: good, type: 'commonjs', main: './index.cjs' }),
      [gp + '/index.cjs']: 'module.exports = "UNRELATED_GOOD"',
    }
    for (let i = 0; i < 511; i++) members[bp + '/extra-' + i + '.txt'] = 'x'
    return members
  })
  assert.equal((await import(f.name)).default, 'COMMITTED_OLD')
  const stagedRoot = join(f.root, readdirSync(f.root).find(name => name.startsWith('dsh-asar-cjs-')))
  const oldPath = join(stagedRoot, f.pkg, 'index.cjs'), before = readFileSync(oldPath)
  await assert.rejects(import(bad), /exceeds budget/iu)
  assert.deepEqual(readFileSync(oldPath), before, 'previously committed bytes survive rollback')
  assert.equal(existsSync(join(stagedRoot, 'dsh/node_modules/' + bad)), false, 'failed closure files are removed immediately')
  assert.equal((await import(good)).default, 'UNRELATED_GOOD', 'failed local counts do not consume remaining committed budget')
})
