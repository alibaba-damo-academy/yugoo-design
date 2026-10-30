import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, unzipSync } from 'fflate'
import { readStudioContentArchive } from '../../studio/lib/index.js'
import { encodeStudioContentZip, decodeStudioContentZip } from '../src/content-zip.ts'
import { formatStudioImportError } from '../src/content-transfer.ts'
import { archiveFixture } from './content-archive-fixture.mjs'

test('download is an ordinary ZIP with byte-exact text/assets, version and source metadata', () => {
  const source = archiveFixture(), zip = encodeStudioContentZip(source), files = unzipSync(zip)
  assert.deepEqual([...zip.subarray(0, 4)], [80, 75, 3, 4])
  assert.equal(new TextDecoder().decode(files['content/SKILL.md']), '# Original method\n')
  assert.deepEqual([...files['content/reference/pixel.png']], [137, 80, 78, 71, 0, 255])
  const manifest = JSON.parse(new TextDecoder().decode(files['studio-manifest.json']))
  assert.deepEqual(manifest.archive.pin, { name: 'demo', version: '1.0' })
  assert.equal(Object.hasOwn(manifest.archive.files[0], 'base64'), false, 'source bytes are real files, not duplicated JSON blobs')
  assert.deepEqual(readStudioContentArchive(decodeStudioContentZip(zip)), readStudioContentArchive(source), 'existing Core-backed integrity parser remains authority')
})

test('incomplete, unexpected and unsafe ZIP contents fail before preparing an import', () => {
  const files = unzipSync(encodeStudioContentZip(archiveFixture()))
  const missing = { ...files }; delete missing['content/SKILL.md']
  assert.throws(() => decodeStudioContentZip(zipSync(missing)), /Missing or duplicate ZIP content/)
  assert.throws(() => decodeStudioContentZip(zipSync({ ...files, 'content/extra.txt': new Uint8Array() })), /not listed/)
  assert.throws(() => decodeStudioContentZip(zipSync({ ...files, '../outside': new Uint8Array() })), /Unsafe ZIP/)
  assert.throws(() => decodeStudioContentZip(zipSync({ ...files, 'content/skill.md': new Uint8Array() })), /case-conflicting/)
  assert.throws(() => decodeStudioContentZip(zipSync({ 'content/SKILL.md': new Uint8Array() })), /studio-manifest.json/)
  assert.match(formatStudioImportError('Missing required file: studio-manifest.json', 'zh'), /缺少必需文件：studio-manifest.json/)
  const zip = encodeStudioContentZip(archiveFixture())
  assert.throws(() => decodeStudioContentZip(zip.subarray(0, zip.length - 25)))
})

test('expanded-size limits and existing SHA checks reject bombs and tampered source', () => {
  assert.throws(() => decodeStudioContentZip(zipSync({ 'studio-manifest.json': new Uint8Array(19 * 1024 * 1024) })), /exceeds/)
  const files = unzipSync(encodeStudioContentZip(archiveFixture()))
  files['content/SKILL.md'][0] = 33
  assert.throws(() => readStudioContentArchive(decodeStudioContentZip(zipSync(files))), /integrity mismatch/)
})

test('central offsets cannot disagree with the sequential local files', () => {
  const zip = encodeStudioContentZip(archiveFixture({ 'a.txt': 'AAAA', 'b.txt': 'BBBB' }))
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let cursor = view.getUint32(zip.length - 22 + 16, true)
  const first = cursor
  cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true)
  const offset = view.getUint32(first + 42, true)
  view.setUint32(first + 42, view.getUint32(cursor + 42, true), true)
  view.setUint32(cursor + 42, offset, true)
  assert.equal(new TextDecoder().decode(unzipSync(zip)['content/a.txt']), 'BBBB', 'ordinary ZIP reader sees the swapped payload')
  assert.throws(() => decodeStudioContentZip(zip), /directory does not match/)
})

test('streaming ZIP data descriptors retain portable roundtrip support', async () => {
  const { Zip, ZipDeflate } = await import('fflate'), chunks = []
  const stream = new Zip((error, bytes) => { if (error) throw error; chunks.push(bytes) })
  for (const [name, bytes] of Object.entries(unzipSync(encodeStudioContentZip(archiveFixture())))) {
    const file = new ZipDeflate(name); stream.add(file); file.push(bytes, true)
  }
  stream.end()
  assert.deepEqual(readStudioContentArchive(decodeStudioContentZip(Buffer.concat(chunks))), readStudioContentArchive(archiveFixture()))
})
