/** Acquire reviewed native materials, never rebuild or alter their source authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { prepareCompanionNativeGit } from './companion-native-git.mjs'

export const NATIVE_DONOR = Object.freeze({
  package: '@yugoo-design/companion', version: '0.1.0-beta.16',
  url: 'https://registry.npmjs.org/@yugoo-design/companion/-/companion-0.1.0-beta.16.tgz',
  bytes: 28242724,
  integrity: 'sha512-U5cPEkywydWUjvmdWXwDZdaECgCDYuPD/GlwGEJqJKj++cM5EUvb2Vj/EDKvoEkWtB9/LP6GTb2VaHiuV2cJ3A==',
})
export function verifyNativeDonor(bytes) {
  assert.equal(bytes.length, NATIVE_DONOR.bytes, 'Native donor archive size changed')
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), NATIVE_DONOR.integrity, 'Native donor archive integrity changed')
}
const run = promisify(execFile)
const members = ['native/yugoo_git.linux-x64.node', 'native/yugoo_git.win32-x64.node']

/** tar writes only stdout. No archive paths, links or directories are extracted. */
export async function stageNativeDonor({ workspace, destination, archive }) {
  verifyNativeDonor(archive)
  await mkdir(destination) // exclusive: never reuse/overwrite an existing directory
  const tarball = join(destination, 'donor.tgz')
  await writeFile(tarball, archive, { flag: 'wx' })
  try {
    const member = async path => (await run('tar', ['-xOf', tarball, 'package/payload/shared/git-native/' + path], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 })).stdout
    const sourceBytes = await readFile(join(workspace, 'packages/git-native/SOURCE.json'))
    assert.deepEqual(await member('SOURCE.json'), sourceBytes, 'Donor SOURCE.json differs from current native source')
    const source = JSON.parse(sourceBytes)
    assert.deepEqual(source.artifacts.map(x => x.path).sort(), members)
    await mkdir(join(destination, 'native'))
    for (const item of source.artifacts) {
      const bytes = await member(item.path)
      assert.equal(bytes.length, item.bytes, 'Donor native member size changed')
      assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, 'Donor native member hash changed')
      await writeFile(join(destination, item.path), bytes, { flag: 'wx' })
    }
    // Existing gate also verifies current source, notices and Git JS materials.
    const prepared = await prepareCompanionNativeGit(workspace, { artifactRoot: destination })
    return { donor: NATIVE_DONOR, sourceSha256: prepared.sourceSha256, artifactInputs: prepared.artifactInputs }
  } finally { await unlink(tarball) }
}

export async function downloadNativeDonor() {
  const response = await fetch(NATIVE_DONOR.url, { redirect: 'error', signal: AbortSignal.timeout(300000) })
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
