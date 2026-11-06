/** Release assembly of the upstream Node/CPU entry. Never builds on the user's machine. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const PREBUILT_EMBEDDING_INPUTS = Object.freeze([
  { name: '@huggingface/transformers', version: '3.8.1', filename: 'huggingface-transformers-3.8.1.tgz',
    integrity: 'sha512-tsTk4zVjImqdqjS8/AOZg2yNLd1z9S5v+7oUPpXaasDRwEDhB+xnglK1k5cad26lL5/ZIaeREgWWy0bs9y9pPA==' },
  { name: 'onnxruntime-node', version: '1.21.0', filename: 'onnxruntime-node-1.21.0.tgz',
    integrity: 'sha512-NeaCX6WW2L8cRCSqy3bInlo5ojjQqu2fD3D+9W5qb5irwxhEyWKXeH2vZ8W9r6VxaMPUan+4/7NDwZMtouZxEw==' },
  { name: 'sharp', version: '0.34.5', filename: 'sharp-0.34.5.tgz',
    integrity: 'sha512-Ou9I5Ft9WNcCbXrU9cMgPBcCK8LiwLqcbywW3t4oDV37n1pzpuNLsYiAV8eODnjbtQlSDwZ2cUEeQz4E54Hltg==' },
])
export const PREBUILT_EMBEDDING_PLATFORMS = Object.freeze(['linux/x64', 'win32/x64', 'darwin/arm64'])
const supportDependencies = Object.freeze({ 'onnxruntime-common': '1.21.0', '@img/colour': '1.1.0', 'detect-libc': '2.1.2', semver: '7.8.5' })
const platformDependencies = Object.freeze({
  '@img/sharp-linux-x64': '0.34.5', '@img/sharp-libvips-linux-x64': '1.2.4',
  '@img/sharp-win32-x64': '0.34.5',
  '@img/sharp-darwin-arm64': '0.34.5', '@img/sharp-libvips-darwin-arm64': '1.2.4',
})
const notices = Object.freeze({
  'onnxruntime-1.21.0.LICENSE': '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
  'onnxruntime-1.21.0.ThirdPartyNotices.txt': '8c06e8cff286a4a117b3b246a4c7da68428a144af757823db50e3d6520941ec6',
})
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** Apply only to release metadata; development packages keep ordinary upstream dependencies. */
export function prebuiltEmbeddingManifest(original) {
  const manifest = structuredClone(original)
  assert.equal(manifest.dependencies?.['@huggingface/transformers'], '3.8.1', 'Reviewed Transformers Node entry required')
  for (const input of PREBUILT_EMBEDDING_INPUTS) {
    assert.ok(manifest.dependencies[input.name] === undefined || manifest.dependencies[input.name] === input.version,
      'Conflicting embedding dependency: ' + input.name)
    manifest.dependencies[input.name] = input.version
  }
  for (const [name, version] of Object.entries(supportDependencies)) {
    assert.ok(manifest.dependencies[name] === undefined || manifest.dependencies[name] === version, 'Conflicting embedding dependency: ' + name)
    manifest.dependencies[name] = version
  }
  manifest.optionalDependencies = { ...manifest.optionalDependencies, ...platformDependencies }
  manifest.bundledDependencies = [...new Set([...(manifest.bundledDependencies ?? []), ...PREBUILT_EMBEDDING_INPUTS.map(input => input.name)])]
  manifest.files = [...new Set([...(manifest.files ?? []), 'licenses/prebuilt-embedding'])]
  if (manifest['x-design-release-review']) manifest['x-design-release-review'].platformStrategy =
    'Verified registry archives supply the prebuilt Node/CPU bundle; npm installs platform-specific sharp assets and remaining dependencies; no build-machine node_modules'
  return manifest
}

/** The official prebuilt Node entry embeds Jinja and has no onnxruntime-web import. */
export function selectEmbeddingMember(name, member) {
  assert.ok(member.startsWith('package/') && !member.includes('\\'), 'Unexpected upstream archive root')
  const path = member.slice('package/'.length)
  assert.ok(path && !path.startsWith('/') && !path.split('/').some(part => part === '..' || part === '.'), 'Unsafe upstream archive member')
  if (member.endsWith('/')) return false
  if (name === '@huggingface/transformers') return ['package.json', 'README.md', 'LICENSE'].includes(path)
    || path.startsWith('types/') || /^dist\/transformers\.node\.(?:mjs|cjs)(?:\.map)?$/u.test(path)
  if (name === 'onnxruntime-node') return !path.startsWith('bin/')
    || PREBUILT_EMBEDDING_PLATFORMS.some(platform => path.startsWith('bin/napi-v3/' + platform + '/'))
  assert.equal(name, 'sharp', 'Unknown embedding package')
  return true
}

export function verifyEmbeddingArchive(input, bytes) {
  assert.ok(PREBUILT_EMBEDDING_INPUTS.includes(input), 'Reviewed registry input required')
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), input.integrity,
    'Prebuilt registry archive integrity differs: ' + input.name)
}

async function inventory(root, prefix = '') {
  const entries = {}
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = join(prefix, name), info = await lstat(join(root, path))
    assert.ok(!info.isSymbolicLink(), 'Prebuilt input must not contain symlinks')
    if (info.isDirectory()) Object.assign(entries, await inventory(root, path))
    else {
      assert.ok(info.isFile(), 'Prebuilt input must contain regular files')
      entries[path.replaceAll('\\', '/')] = { bytes: info.size, sha256: sha256(await readFile(join(root, path))) }
    }
  }
  return entries
}

/**
 * Fetch exact registry archives through npm's existing cache, or reuse verified archives.
 * Only these intentionally assembled bundles enter node_modules. Never copy a local install.
 * Returns metadata and byte inventories, not runtime/platform acceptance.
 */
export async function stagePrebuiltEmbedding({ target, npmCli, inputsDirectory, sourceRoot = fileURLToPath(new URL('../', import.meta.url)) }) {
  assert.equal(await realpath(target), resolve(target), 'Prebuilt target must be canonical')
  await mkdir(join(target, 'node_modules')) // Exclusive: never adopt/copy an existing install.
  const temporary = await mkdtemp(join(tmpdir(), 'yugoo-prebuilt-embedding-'))
  try {
    const inputs = inputsDirectory === undefined ? temporary : resolve(inputsDirectory)
    if (inputsDirectory === undefined) {
      assert.ok(typeof npmCli === 'string', 'Release preparation needs the existing npm CLI')
      execFileSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--registry=https://registry.npmjs.org',
        '--pack-destination', temporary, ...PREBUILT_EMBEDDING_INPUTS.map(input => input.name + '@' + input.version)],
      { cwd: temporary, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    }
    const records = []
    for (const input of PREBUILT_EMBEDDING_INPUTS) {
      const archive = join(inputs, input.filename), bytes = await readFile(archive)
      verifyEmbeddingArchive(input, bytes)
      const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim().split('\n')
        .filter(member => selectEmbeddingMember(input.name, member))
      assert.ok(members.includes('package/package.json'), 'Upstream manifest missing')
      const destination = join(target, 'node_modules', input.name)
      await mkdir(dirname(destination), { recursive: true }); await mkdir(destination)
      const selected = join(temporary, 'members.txt'); await writeFile(selected, members.join('\n') + '\n')
      execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', destination, '-T', selected])
      const manifest = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'))
      assert.equal(manifest.name, input.name); assert.equal(manifest.version, input.version)
      // Upstream manifests and scripts remain byte-identical. npm/pnpm treat the
      // enclosing bundle as prebuilt and do not run nested dependency lifecycles.
      const files = await inventory(destination)
      if (input.name === 'onnxruntime-node') for (const platform of PREBUILT_EMBEDDING_PLATFORMS)
        assert.ok(files['bin/napi-v3/' + platform + '/onnxruntime_binding.node'], 'Missing CPU platform: ' + platform)
      if (input.name === '@huggingface/transformers') assert.ok(files['dist/transformers.node.mjs'], 'Missing prebuilt Node entry')
      records.push({ ...input, registry: 'https://registry.npmjs.org', archiveBytes: bytes.length,
        selectedBytes: Object.values(files).reduce((total, file) => total + file.bytes, 0), files })
    }
    const licenseRoot = join(target, 'licenses/prebuilt-embedding'); await mkdir(licenseRoot, { recursive: true })
    for (const [name, expected] of Object.entries(notices)) {
      const source = join(sourceRoot, 'third-party/companion/prebuilt-embedding', name)
      assert.equal(sha256(await readFile(source)), expected, 'Upstream notice changed: ' + name)
      await cp(source, join(licenseRoot, name), { errorOnExist: true, force: false })
    }
    const result = { schemaVersion: 1, mode: 'upstream-prebuilt-node-cpu', platforms: PREBUILT_EMBEDDING_PLATFORMS,
      packages: records, notices: Object.fromEntries(Object.entries(notices).map(([name, digest]) => [name, {
        sha256: digest, source: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.21.0/'
          + (name.endsWith('.LICENSE') ? 'LICENSE' : 'ThirdPartyNotices.txt'),
      }])), runtimeVerified: false }
    await writeFile(join(licenseRoot, 'SOURCE.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    return result
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
