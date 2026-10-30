/** Browser transport only. Core still validates every original byte and definition. */
import { Unzip, UnzipInflate, unzipSync, zipSync } from 'fflate'
import type { StudioContentArchive } from 'dsh-design-studio'

const MANIFEST = 'studio-manifest.json'
const MAX_FILES = 4097
const MAX_BYTES = 18 * 1024 * 1024 // original content (16 MiB) plus bounded metadata
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true })

function safeEntry(name: string) {
  if (name !== name.normalize('NFC') || /[\\\u0000-\u001f:*?"<>|]/u.test(name)
    || name.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Unsafe ZIP file path.')
}
function fromBase64(value: string) {
  const text = atob(value)
  return Uint8Array.from(text, character => character.charCodeAt(0))
}
function toBase64(value: Uint8Array) {
  let text = ''
  for (let index = 0; index < value.length; index += 8192) text += String.fromCharCode(...value.subarray(index, index + 8192))
  return btoa(text)
}

/** Both ZIP readers must see the same files: central-directory offsets cannot
 * point inside another entry while the streaming reader follows local headers.
 * ZIP64/multi-volume archives are outside this small portable-content format.
 */
function verifyLocalEntries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (offset: number) => view.getUint16(offset, true)
  const u32 = (offset: number) => view.getUint32(offset, true)
  const invalid = () => { throw Error('ZIP directory does not match its files.') }
  if (bytes.length < 22) invalid()
  const lower = Math.max(0, bytes.length - 65557)
  let end = bytes.length - 22
  for (; end >= lower; end--) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break
  }
  if (end < lower || u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6)
    || u16(end + 8) !== u16(end + 10) || u16(end + 10) > MAX_FILES) invalid()
  const start = u32(end + 16), size = u32(end + 12)
  if (start + size !== end) invalid()
  const entries: { offset: number; dataEnd: number; flags: number; crc: number; compressed: number; original: number }[] = []
  let cursor = start
  for (let index = 0; index < u16(end + 10); index++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) invalid()
    const nameSize = u16(cursor + 28), next = cursor + 46 + nameSize + u16(cursor + 30) + u16(cursor + 32)
    const offset = u32(cursor + 42), flags = u16(cursor + 8), method = u16(cursor + 10)
    const crc = u32(cursor + 16), compressed = u32(cursor + 20), original = u32(cursor + 24)
    if (next > end || u16(cursor + 34) || (flags & 1) || ![0, 8].includes(method)
      || offset + 30 > start || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags
      || u16(offset + 8) !== method || u16(offset + 26) !== nameSize) invalid()
    const dataStart = offset + 30 + nameSize + u16(offset + 28), dataEnd = dataStart + compressed
    if (dataStart > start || dataEnd > start) invalid()
    for (let i = 0; i < nameSize; i++) if (bytes[cursor + 46 + i] !== bytes[offset + 30 + i]) invalid()
    if (!(flags & 8) && (u32(offset + 14) !== crc || u32(offset + 18) !== compressed || u32(offset + 22) !== original)) invalid()
    entries.push({ offset, dataEnd, flags, crc, compressed, original }); cursor = next
  }
  if (cursor !== end) invalid()
  entries.sort((a, b) => a.offset - b.offset)
  if (entries[0]?.offset !== 0) invalid()
  entries.forEach((entry, index) => {
    const next = entries[index + 1]?.offset ?? start
    if (!(entry.flags & 8)) { if (entry.dataEnd !== next) invalid(); return }
    const gap = next - entry.dataEnd
    if (gap !== 12 && gap !== 16) invalid()
    const descriptor = entry.dataEnd + (gap === 16 ? 4 : 0)
    if (gap === 16 && u32(entry.dataEnd) !== 0x08074b50) invalid()
    if (u32(descriptor) !== entry.crc || u32(descriptor + 4) !== entry.compressed || u32(descriptor + 8) !== entry.original) invalid()
  })
}

/** Ordinary ZIP with readable source tree and a version/integrity manifest. */
export function encodeStudioContentZip(source: string): Uint8Array {
  const archive = JSON.parse(source) as StudioContentArchive
  if (archive.format !== 'studio-content-archive/v1' || !Array.isArray(archive.files)) throw Error('Unsupported content archive.')
  const entries: Record<string, Uint8Array> = Object.create(null)
  const files = archive.files.map(({ base64, ...file }) => {
    const name = `content/${file.path}`; safeEntry(name)
    if (entries[name]) throw Error('Duplicate ZIP file path.')
    entries[name] = fromBase64(base64)
    return file
  })
  entries[MANIFEST] = encoder.encode(JSON.stringify({ format: 'studio-content-zip/v1', archive: { ...archive, files } }, null, 2))
  if (Object.keys(entries).length > MAX_FILES || Object.values(entries).reduce((sum, bytes) => sum + bytes.length, 0) > MAX_BYTES) throw Error('ZIP content exceeds the supported size or file count.')
  return zipSync(entries, { level: 6 })
}

/** Bounded ZIP -> existing JSON transport; never extracts to a filesystem. */
export function readStudioZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length > 12 * 1024 * 1024) throw Error('ZIP file exceeds the 12 MiB upload limit.')
  verifyLocalEntries(bytes)
  const expected = new Map<string, number>(), names = new Set<string>()
  let declared = 0
  // Inspect the central directory without allocating decompressed files.
  unzipSync(bytes, { filter(file) {
    safeEntry(file.name.endsWith('/') ? file.name.slice(0, -1) : file.name)
    const folded = file.name.toLowerCase()
    if (names.has(folded)) throw Error('Duplicate or case-conflicting ZIP file paths.')
    names.add(folded); expected.set(file.name, file.originalSize); declared += file.originalSize
    if (expected.size > MAX_FILES || declared > MAX_BYTES) throw Error('ZIP content exceeds the supported size or file count.')
    return false
  } })
  const entries = new Map<string, Uint8Array>(), started = new Set<string>()
  let total = 0
  const stream = new Unzip(file => {
    if (!expected.has(file.name) || started.has(file.name)) throw Error('ZIP directory does not match its files.')
    started.add(file.name)
    const chunks: Uint8Array[] = []; let length = 0
    file.ondata = (error, data, final) => {
      if (error) throw error
      length += data.length; total += data.length
      if (length > expected.get(file.name)! || total > MAX_BYTES) { file.terminate(); throw Error('ZIP expanded content exceeds its declared size.') }
      chunks.push(data)
      if (final) {
        if (length !== expected.get(file.name)) throw Error('ZIP file is incomplete.')
        const value = new Uint8Array(length); let offset = 0
        for (const chunk of chunks) { value.set(chunk, offset); offset += chunk.length }
        entries.set(file.name, value)
      }
    }
    file.start()
  })
  stream.register(UnzipInflate)
  // Limit expansion per push even if a local header lies about its size.
  for (let offset = 0; offset < bytes.length; offset += 1024) stream.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length)
  if (entries.size !== expected.size) throw Error('ZIP file is incomplete.')
  return entries
}

export function decodeStudioContentZip(bytes: Uint8Array): string {
  const entries = readStudioZipEntries(bytes)
  if (!entries.has(MANIFEST)) throw Error('Missing required file: studio-manifest.json')
  for (const name of entries.keys()) if (name.endsWith('/')) entries.delete(name)
  const manifest = JSON.parse(decoder.decode(entries.get(MANIFEST)!))
  if (manifest.format !== 'studio-content-zip/v1' || !Array.isArray(manifest.archive?.files)) throw Error('Unsupported ZIP manifest.')
  const used = new Set([MANIFEST])
  const files = manifest.archive.files.map((file: Record<string, unknown>) => {
    if (typeof file.path !== 'string' || Object.hasOwn(file, 'base64')) throw Error('Invalid ZIP file manifest.')
    const name = `content/${file.path}`; safeEntry(name)
    const data = entries.get(name)
    if (!data || used.has(name)) throw Error(`Missing or duplicate ZIP content: ${file.path}`)
    if (data.length !== file.bytes) throw Error(`ZIP file size mismatch: ${file.path}`)
    used.add(name)
    return { ...file, base64: toBase64(data) }
  })
  if (used.size !== entries.size) throw Error('ZIP contains files that are not listed in its manifest.')
  return JSON.stringify({ ...manifest.archive, files })
}

export function isStudioZip(bytes: Uint8Array): boolean { return bytes[0] === 0x50 && bytes[1] === 0x4b }
