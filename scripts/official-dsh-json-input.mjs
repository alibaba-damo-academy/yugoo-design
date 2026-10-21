/** Fixed, licensed upstream utility input. Offline and read-only; never falls back to a host tree. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const OFFICIAL_DSH_JSON_AUTHORITY = Object.freeze({
  repository: 'https://github.com/deepseek-ai/deepseek-harness',
  commit: 'cd5ef8148158c3a752a658978873241fdf8e2bbc',
  files: Object.freeze({
    'packages/core/session/src/json.ts': 'cbb271dadd2f476a4d19a2b22ac606db6887ed70367b86d6c13ddf1d102d36ba',
    LICENSE: 'ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be',
  }),
})

export const DEFAULT_OFFICIAL_DSH_JSON_ROOT = fileURLToPath(new URL('./test-fixtures/official-dsh-json/', import.meta.url))
const JSON_PATH = 'packages/core/session/src/json.ts'
async function readRegular(root, path) {
  let current = root
  const parts = path.split('/')
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    const info = await lstat(current)
    assert.ok(!info.isSymbolicLink(), `Official input symlink rejected: ${path}`)
    assert.ok(index === parts.length - 1 ? info.isFile() : info.isDirectory(), `Official input must be regular: ${path}`)
  }
  return readFile(current)
}

export async function readOfficialDshJsonInput({ inputRoot = DEFAULT_OFFICIAL_DSH_JSON_ROOT } = {}) {
  const root = resolve(inputRoot)
  assert.ok((await lstat(root)).isDirectory(), 'Official input root must be a regular directory, not a symlink')
  assert.equal(await realpath(root), root, 'Official input root must be canonical')
  const provenance = JSON.parse(await readRegular(root, 'provenance.json'))
  assert.equal(provenance.repository, OFFICIAL_DSH_JSON_AUTHORITY.repository, 'Official input repository mismatch')
  assert.equal(provenance.commit, OFFICIAL_DSH_JSON_AUTHORITY.commit, 'Official input commit mismatch')
  assert.equal(provenance.license, 'MIT', 'Official input license mismatch')
  assert.deepEqual(Object.keys(provenance.files ?? {}).sort(), Object.keys(OFFICIAL_DSH_JSON_AUTHORITY.files).sort(), 'Official input file set mismatch')
  const bytes = {}
  for (const [path, expected] of Object.entries(OFFICIAL_DSH_JSON_AUTHORITY.files)) {
    assert.equal(provenance.files[path].sha256, expected, `Official input provenance hash mismatch: ${path}`)
    assert.equal(provenance.files[path].url, `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${OFFICIAL_DSH_JSON_AUTHORITY.commit}/${path}`, `Official input URL mismatch: ${path}`)
    bytes[path] = await readRegular(root, path)
    assert.equal(createHash('sha256').update(bytes[path]).digest('hex'), expected, `Official input hash mismatch: ${path}`)
  }
  const jsonPath = join(root, JSON_PATH)
  return {
    root, jsonPath, licensePath: join(root, 'LICENSE'), authority: OFFICIAL_DSH_JSON_AUTHORITY,
    jsonBytes: bytes[JSON_PATH], licenseBytes: bytes.LICENSE,
    resolveId(source) {
      if (source === '@deepseek-ai/dsh-session') return jsonPath
      if (source.startsWith('@deepseek-ai/dsh-')) throw new Error(`Companion must not load DSH runtime: ${source}`)
      return null
    },
  }
}
