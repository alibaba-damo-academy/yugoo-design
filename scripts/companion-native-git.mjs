/** Physical delivery of Core's unchanged native Git binding; no Git implementation. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

export const COMPANION_NATIVE_GIT_IMPORT = '../git-native/index.cjs'
export const COMPANION_GIT_WORKER = 'git-native-worker.js'
const ARTIFACTS = ['native/yugoo_git.darwin-arm64.node', 'native/yugoo_git.linux-x64.node', 'native/yugoo_git.win32-x64.node']
const SUPPORTED = ['linux-gnu-x64', 'windows-msvc-x64', 'macos-arm64']
export const isNativeGitBuildCache = path => path === 'native-source/target'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const safe = path => typeof path === 'string' && path && !isAbsolute(path)
  && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..')
async function regular(root, path) {
  assert.ok(safe(path), 'Unsafe native Git material path')
  let cursor = root
  for (const part of path.split('/')) {
    cursor = join(cursor, part)
    assert.ok(!(await lstat(cursor)).isSymbolicLink(), 'Native Git material symlink rejected')
  }
  assert.ok((await lstat(cursor)).isFile(), 'Native Git material must be a regular file')
  return readFile(cursor)
}

/** Original license texts for Core's JS Git dependencies bundled into the worker. */
async function gitJsMaterials(workspaceRoot, files, inputs) {
  const seen = new Set()
  async function visit(name, from) {
    const require = createRequire(join(from, 'package.json'))
    let entry
    try { entry = require.resolve(name + '/package.json') } catch (error) {
      if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
      entry = require.resolve(name)
    }
    let root = dirname(entry), manifest, bytes
    while (true) {
      try { bytes = await readFile(join(root, 'package.json')); manifest = JSON.parse(bytes); if (manifest.name === name) break } catch (e) { if (e.code !== 'ENOENT') throw e }
      const parent = dirname(root); assert.notEqual(parent, root, 'Missing Git JS dependency manifest'); root = parent
    }
    if (seen.has(root)) return
    seen.add(root)
    const id = `${manifest.name.replaceAll('/', '__')}@${manifest.version}`
    assert.match(id, /^[@a-zA-Z0-9_.+-]+$/u)
    inputs[join(root, 'package.json')] = { bytes: bytes.length, sha256: sha(bytes) }
    const paths = await readdir(root)
    const licenses = paths.filter(path => /^(?:license|notice|copying|authors)(?:[.-].*)?$/iu.test(path)).sort()
    // Some published packages omit a standalone grant. Preserve their original
    // declarations and README (plus inline notices), without inventing a grant
    // or claiming that material collection establishes license acceptance.
    const readmes = paths.filter(path => /^readme(?:\..*)?$/iu.test(path))
    const selected = [...new Set(['package.json', ...licenses, ...readmes,
      ...paths.filter(path => /^(?:diff3|onp)\.js$/u.test(path))])].sort()
    const materials = {}
    for (const path of selected) {
      const bytes = await regular(root, path)
      files.set(`third-party/javascript/${id}/${path}`, bytes)
      inputs[join(root, path)] = materials[path] = { bytes: bytes.length, sha256: sha(bytes) }
    }
    files.set(`third-party/javascript/${id}/SOURCE.json`, Buffer.from(JSON.stringify({ name, version: manifest.version, license: manifest.license,
      manifestSha256: sha(bytes), scope: 'original declared Git JS dependency materials; resolved module inputs are recorded separately, not a retained-code inventory',
      standaloneLicenseFilePresent: licenses.some(path => /^(?:license|copying)(?:[.-].*)?$/iu.test(path)),
      attributionFilePresent: licenses.some(path => /^(?:notice|authors)(?:[.-].*)?$/iu.test(path)),
      originalReadmePreserved: readmes.length > 0, licenseObligationsAccepted: false, materials }, null, 2) + '\n'))
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) await visit(dependency, root)
  }
  for (const name of ['iconv-lite', 'isomorphic-git']) await visit(name, join(workspaceRoot, 'packages/core'))
}

/** Source identities and prebuild identities are separate, explicit build inputs. */
export async function prepareCompanionNativeGit(workspaceRoot, { artifactRoot = join(workspaceRoot, 'packages/git-native') } = {}) {
  const sourceRoot = join(workspaceRoot, 'packages/git-native'), files = new Map()
  const manifest = JSON.parse(await regular(sourceRoot, 'package.json'))
  assert.equal(manifest.name, 'yugoo-design-git-native')
  assert.equal(manifest.license, 'MIT')
  const source = JSON.parse(await regular(sourceRoot, 'SOURCE.json'))
  assert.deepEqual(source.artifacts.map(item => item.path).sort(), ARTIFACTS)
  for (const item of source.inputs) assert.equal(sha(await regular(sourceRoot, item.path)), item.sha256, 'Native Git source input changed: ' + item.path)
  async function add(path) {
    if (isNativeGitBuildCache(path)) return
    const info = await lstat(join(sourceRoot, path))
    assert.ok(!info.isSymbolicLink(), 'Native Git source symlink rejected')
    if (info.isDirectory()) for (const name of (await readdir(join(sourceRoot, path))).sort()) await add(path + '/' + name)
    else files.set(path, await regular(sourceRoot, path))
  }
  for (const path of ['package.json', 'index.cjs', 'index.d.ts', 'LICENSE', 'NOTICE', 'SOURCE.json', 'native-source', 'third-party', 'scripts']) await add(path)
  const artifactInputs = {}
  for (const item of source.artifacts) {
    const bytes = await regular(artifactRoot, item.path)
    assert.equal(bytes.length, item.bytes, 'Native Git prebuild size changed')
    assert.equal(sha(bytes), item.sha256, 'Native Git prebuild identity changed')
    files.set(item.path, bytes)
    artifactInputs[resolve(artifactRoot, item.path)] = { bytes: bytes.length, sha256: sha(bytes) }
  }
  await gitJsMaterials(workspaceRoot, files, artifactInputs)
  return { files, artifactInputs, sourceRoot, artifactRoot: resolve(artifactRoot), sourceSha256: sha(await regular(sourceRoot, 'SOURCE.json')), version: manifest.version }
}

export async function stageCompanionNativeGit(sharedRoot, prepared) {
  const root = join(sharedRoot, 'git-native')
  await mkdir(root)
  const files = {}
  for (const [path, bytes] of prepared.files) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), bytes, { flag: 'wx' })
    files[path] = { bytes: bytes.length, sha256: sha(bytes) }
  }
  const receipt = { schemaVersion: 1, sourceSha256: prepared.sourceSha256, version: prepared.version,
    scope: 'unchanged-source-binding-and-three-pinned-prebuilds', files,
    supported: [...SUPPORTED], platformsExecuted: [] }
  await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  await mkdir(join(sharedRoot, 'scripts'), { recursive: true })
  await writeFile(join(sharedRoot, 'scripts/package.json'), '{"type":"module"}\n', { flag: 'wx' })
  return receipt
}

/** Narrow .cjs/native check; deliberately not a generic emitted-loader exception. */
export async function verifyCompanionNativeGit(sharedRoot) {
  const root = join(sharedRoot, 'git-native')
  const receipt = JSON.parse(await regular(root, 'runtime-manifest.json'))
  assert.equal(receipt.schemaVersion, 1)
  const source = JSON.parse(await regular(root, 'SOURCE.json'))
  assert.equal(sha(await regular(root, 'SOURCE.json')), receipt.sourceSha256)
  assert.equal(JSON.parse(await regular(sharedRoot, 'scripts/package.json')).type, 'module')
  assert.ok(receipt.files['index.cjs'] && receipt.files.LICENSE && receipt.files.NOTICE)
  assert.deepEqual(source.artifacts.map(x => x.path).sort(), ARTIFACTS)
  assert.equal(receipt.scope, 'unchanged-source-binding-and-three-pinned-prebuilds')
  assert.deepEqual(receipt.supported, SUPPORTED)
  const actual = []
  async function walk(path = '') {
    for (const name of await readdir(join(root, path))) {
      const child = path ? path + '/' + name : name, info = await lstat(join(root, child))
      assert.ok(!info.isSymbolicLink(), 'Native Git runtime symlink rejected')
      if (info.isDirectory()) await walk(child)
      else { assert.ok(info.isFile()); if (child !== 'runtime-manifest.json') actual.push(child) }
    }
  }
  await walk()
  assert.deepEqual(actual.sort(), Object.keys(receipt.files).sort(), 'Native Git runtime inventory changed')
  for (const [path, expected] of Object.entries(receipt.files)) {
    const bytes = await regular(root, path)
    assert.equal(bytes.length, expected.bytes, 'Native Git runtime size changed: ' + path)
    assert.equal(sha(bytes), expected.sha256, 'Native Git runtime bytes changed: ' + path)
  }
  for (const item of [...source.inputs, ...source.artifacts]) assert.equal(sha(await regular(root, item.path)), item.sha256, 'Native Git recorded input/prebuild changed')
  const worker = await regular(sharedRoot, 'scripts/' + COMPANION_GIT_WORKER)
  await regular(sharedRoot, 'scripts/git-runtime-check.mjs')
  assert.ok(worker.length, 'Missing Core native Git worker')
  return { files: actual.length, loaderSha256: receipt.files['index.cjs'].sha256,
    workerSha256: sha(worker), supported: receipt.supported, platformsExecuted: [] }
}
