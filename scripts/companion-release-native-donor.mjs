/** Acquire reviewed native materials, never rebuild or alter their source authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile, unlink, lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { prepareCompanionNativeGit } from './companion-native-git.mjs'

export const NATIVE_DONOR = Object.freeze({
  package: '@yugoo-design/companion', version: '0.1.0-beta.16',
  url: 'https://registry.npmjs.org/@yugoo-design/companion/-/companion-0.1.0-beta.16.tgz',
  bytes: 28242724,
  integrity: 'sha512-U5cPEkywydWUjvmdWXwDZdaECgCDYuPD/GlwGEJqJKj++cM5EUvb2Vj/EDKvoEkWtB9/LP6GTb2VaHiuV2cJ3A==',
  sourceSha256: '8674944f762cd19151f84088261c20200d1da38af2cb1ca5ae303d98851d5613',
})
// Routing only. The current SOURCE.json owns the expected binary size and hash.
// This non-beta input release must exist before default public CI preparation.
export const DARWIN_NATIVE_INPUT = Object.freeze({
  url: 'https://github.com/alibaba-damo-academy/yugoo-design/releases/download/native-inputs-git-darwin-arm64-bd1cbdec/yugoo_git.darwin-arm64.node',
  path: 'native/yugoo_git.darwin-arm64.node',
})
const legacyMembers = ['native/yugoo_git.linux-x64.node', 'native/yugoo_git.win32-x64.node']
const members = [DARWIN_NATIVE_INPUT.path, ...legacyMembers].sort()
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const run = promisify(execFile)

export function verifyNativeDonor(bytes) {
  assert.equal(bytes.length, NATIVE_DONOR.bytes, 'Native donor archive size changed')
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), NATIVE_DONOR.integrity, 'Native donor archive integrity changed')
}
function currentSource(bytes) {
  const source = JSON.parse(bytes)
  assert.deepEqual(source.artifacts.map(item => item.path).sort(), members, 'Current native platform set changed')
  const targets = { 'native/yugoo_git.linux-x64.node': 'x86_64-unknown-linux-gnu',
    'native/yugoo_git.win32-x64.node': 'x86_64-pc-windows-msvc', [DARWIN_NATIVE_INPUT.path]: 'aarch64-apple-darwin' }
  for (const item of source.artifacts) {
    assert.equal(item.target, targets[item.path], 'Current native target changed')
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes > 0, 'Invalid current native byte bound')
    assert.match(item.sha256, /^[a-f0-9]{64}$/u, 'Invalid current native identity')
  }
  return source
}
async function readCurrentSource(workspace) {
  workspace = resolve(workspace)
  assert.equal(await realpath(workspace), workspace, 'Native source workspace must be canonical')
  let cursor = workspace
  for (const part of ['packages', 'git-native', 'SOURCE.json']) {
    cursor = join(cursor, part)
    const info = await lstat(cursor)
    assert.ok(!info.isSymbolicLink() && (part === 'SOURCE.json' ? info.isFile() : info.isDirectory()), 'Native SOURCE must use regular source paths')
  }
  const bytes = await readFile(cursor)
  return { bytes, source: currentSource(bytes) }
}
/** Exact historical identity, then explicit inheritance into the one current authority. */
export function verifyNativeDonorInheritance(sourceBytes, donorSourceBytes) {
  assert.equal(sha(donorSourceBytes), NATIVE_DONOR.sourceSha256, 'Native donor historical SOURCE changed')
  const source = currentSource(sourceBytes), donor = JSON.parse(donorSourceBytes)
  assert.deepEqual(donor.artifacts.map(item => item.path).sort(), legacyMembers, 'Native donor platform set changed')
  for (const item of donor.artifacts) {
    assert.deepEqual(source.artifacts.find(current => current.path === item.path), item, 'Inherited native artifact declaration changed')
  }
  return { source, sourceSha256: sha(sourceBytes), donorSourceSha256: sha(donorSourceBytes) }
}
function verifyDarwin(bytes, source) {
  assert.ok(bytes instanceof Uint8Array, 'Explicit Darwin native bytes required')
  const item = source.artifacts.find(item => item.path === DARWIN_NATIVE_INPUT.path)
  assert.equal(bytes.length, item.bytes, 'Darwin native size changed')
  assert.equal(sha(bytes), item.sha256, 'Darwin native identity changed')
  return item
}

/** tar writes only stdout. No archive paths, links or directories are extracted. */
export async function stageNativeDonor({ workspace, destination, archive, darwinBytes }) {
  archive = Buffer.from(archive)
  verifyNativeDonor(archive)
  const { bytes: sourceBytes, source } = await readCurrentSource(workspace)
  verifyDarwin(darwinBytes, source)
  // Own a stable copy across awaits; final preparation verifies the disk bytes again.
  darwinBytes = Buffer.from(darwinBytes)
  assert.ok(isAbsolute(destination), 'Absolute native destination required')
  assert.equal(await realpath(dirname(destination)), dirname(destination), 'Native destination parent must be canonical')
  await mkdir(destination) // exclusive: never reuse/overwrite an existing directory
  const tarball = join(destination, 'donor.tgz')
  await writeFile(tarball, archive, { flag: 'wx' })
  try {
    const member = async path => (await run('tar', ['-xOf', tarball, 'package/payload/shared/git-native/' + path], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 })).stdout
    const inherited = verifyNativeDonorInheritance(sourceBytes, await member('SOURCE.json'))
    await mkdir(join(destination, 'native'))
    for (const path of legacyMembers) {
      const item = source.artifacts.find(item => item.path === path), bytes = await member(path)
      assert.equal(bytes.length, item.bytes, 'Donor native member size changed')
      assert.equal(sha(bytes), item.sha256, 'Donor native member hash changed')
      await writeFile(join(destination, path), bytes, { flag: 'wx' })
    }
    await writeFile(join(destination, DARWIN_NATIVE_INPUT.path), darwinBytes, { flag: 'wx' })
    // The unchanged final gate verifies current source, all three binaries,
    // notices and Git JS materials. Never copy the donor's old wrapper/SOURCE.
    const prepared = await prepareCompanionNativeGit(workspace, { artifactRoot: destination })
    assert.equal(prepared.sourceSha256, inherited.sourceSha256, 'Current native SOURCE changed during staging')
    return { donor: NATIVE_DONOR, donorSourceSha256: inherited.donorSourceSha256,
      darwin: { url: DARWIN_NATIVE_INPUT.url, ...source.artifacts.find(item => item.path === DARWIN_NATIVE_INPUT.path) },
      sourceSha256: prepared.sourceSha256, artifactInputs: prepared.artifactInputs }
  } finally { await unlink(tarball) }
}

const cdnHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com'])
async function abortable(promise, signal) {
  signal.throwIfAborted()
  let rejectAbort
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(signal.reason); signal.addEventListener('abort', rejectAbort, { once: true }) })
  try { return await Promise.race([promise, aborted]) } finally { signal.removeEventListener('abort', rejectAbort) }
}
function cancelBody(response) { response?.body?.cancel().catch(() => {}) }
/** Unauthenticated, bounded transport. Tests may narrow, never remove, its deadline. */
export async function downloadDarwinNativeInput({ workspace, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000, 'Invalid native input timeout')
  const { source } = await readCurrentSource(workspace)
  const item = source.artifacts.find(item => item.path === DARWIN_NATIVE_INPUT.path)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Native input deadline exceeded', 'TimeoutError')), timeoutMs)
  let response, reader
  try {
    let url = new URL(DARWIN_NATIVE_INPUT.url)
    for (let attempt = 0; ; attempt += 1) {
      controller.signal.throwIfAborted()
      response = await abortable(Promise.resolve().then(() => fetchImpl(url.href, {
        redirect: 'manual', credentials: 'omit', signal: controller.signal,
        headers: { accept: 'application/octet-stream' },
      })), controller.signal)
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      cancelBody(response)
      assert.equal(attempt, 0, 'Additional native input redirect rejected')
      const location = response.headers.get('location')
      assert.ok(location, 'Missing native input redirect target')
      url = new URL(location, url)
      assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.port && cdnHosts.has(url.hostname), 'Native input redirect must use the reviewed HTTPS GitHub CDN')
    }
    assert.equal(response.status, 200, 'Darwin native input download failed')
    const length = response.headers.get('content-length')
    if (length !== null) assert.equal(length, String(item.bytes), 'Darwin native response size changed')
    assert.ok(response.body, 'Missing Darwin native response body')
    reader = response.body.getReader()
    const chunks = []; let size = 0
    while (true) {
      const { done, value } = await abortable(reader.read(), controller.signal)
      if (done) break
      assert.ok(value instanceof Uint8Array && value.length > 0, 'Native input body must make byte progress')
      size += value.length
      assert.ok(size <= item.bytes, 'Darwin native response exceeds pinned size')
      chunks.push(Buffer.from(value))
    }
    const bytes = Buffer.concat(chunks)
    verifyDarwin(bytes, source)
    return bytes
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (reader) { reader.cancel().catch(() => {}); reader.releaseLock() } else cancelBody(response)
  }
}
export async function downloadNativeDonor({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(NATIVE_DONOR.url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(300000) })
  assert.equal(response.status, 200, 'Native donor download failed')
  const chunks = []; let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    assert.ok(size <= NATIVE_DONOR.bytes, 'Native donor exceeds pinned size')
    chunks.push(chunk)
  }
  const archive = Buffer.concat(chunks)
  verifyNativeDonor(archive)
  return archive
}
/** No fallback: an unavailable Darwin input fails before the large donor download. */
export async function acquireNativeInputs({ workspace, destination, fetchImpl = fetch } = {}) {
  const darwinBytes = await downloadDarwinNativeInput({ workspace, fetchImpl })
  const archive = await downloadNativeDonor({ fetchImpl })
  return stageNativeDonor({ workspace, destination, archive, darwinBytes })
}
