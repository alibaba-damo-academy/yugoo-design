/** Read portable sources without extracting them or deciding runtime validity. */
import type { StudioContentArchive } from 'dsh-design-studio'
import { decodeStudioContentZip, isStudioZip, readStudioZipEntries } from './content-zip.ts'

export interface StudioImportFile {
  name: string; size: number; webkitRelativePath?: string
  arrayBuffer?: () => Promise<ArrayBuffer>; text: () => Promise<string>
}
export interface StudioSourceImport {
  kind: 'kit' | 'bundle'
  files: { path: string; base64: string }[]
  title?: { zh: string; en: string }
}
const MAX_BYTES = 12 * 1024 * 1024
function base64(bytes: Uint8Array) {
  let value = ''
  for (let index = 0; index < bytes.length; index += 8192) value += String.fromCharCode(...bytes.subarray(index, index + 8192))
  return btoa(value)
}
function checkSources(input: StudioSourceImport): StudioSourceImport {
  const names = new Set<string>()
  for (const file of input.files) {
    if (/[\\\u0000-\u001f:*?"<>|]/u.test(file.path) || file.path !== file.path.normalize('NFC')
      || file.path.split('/').some(part => !part || ['.', '..', '.git', 'node_modules', '__proto__', 'prototype', 'constructor'].includes(part))) throw Error(`Unsafe file path: ${file.path}`)
    const key = file.path.toLowerCase()
    if (names.has(key)) throw Error(`Duplicate or case-conflicting file path: ${file.path}`)
    names.add(key)
  }
  if (input.files.length > 4096 || new TextEncoder().encode(JSON.stringify({ method: 'studioInstanceImportSources', params: input })).length > MAX_BYTES) throw Error('Import exceeds the 12 MiB upload limit or 4096 files. No content was truncated.')
  const required = input.kind === 'bundle' ? ['SKILL.md'] : ['mindset.md', 'kit.yaml']
  for (const path of required) if (!input.files.some(file => file.path === path)) throw Error(`Missing required file: ${path}`)
  return input
}
function normalize(kind: StudioSourceImport['kind'], files: StudioSourceImport['files']): StudioSourceImport {
  // A single enclosing download/folder directory is packaging, not source ownership.
  const core = kind === 'bundle' ? 'SKILL.md' : 'mindset.md'
  while (files.length && !files.some(file => file.path === core)) {
    const directory = files[0]!.path.split('/')[0]!
    if (['.', '..', '.git', 'node_modules', '__proto__', 'prototype', 'constructor'].includes(directory)) break
    const prefix = directory + '/'
    if (!files.every(file => file.path.startsWith(prefix))) break
    files = files.map(file => ({ ...file, path: file.path.slice(prefix.length) }))
  }
  return checkSources({ kind, files })
}
export async function readStudioImportFiles(kind: StudioSourceImport['kind'], selected: readonly StudioImportFile[], readArchive?: (source: string) => Promise<StudioContentArchive>): Promise<StudioSourceImport> {
  if (!selected.length) throw Error('No file selected.')
  if (selected.length > 4096 || selected.reduce((size, file) => size + file.size, 0) > MAX_BYTES) throw Error('Import exceeds the 12 MiB upload limit or 4096 files.')
  const loaded = await Promise.all(selected.map(async file => ({
    path: file.webkitRelativePath || file.name,
    bytes: file.arrayBuffer ? new Uint8Array(await file.arrayBuffer()) : new TextEncoder().encode(await file.text()),
  })))
  if (loaded.length === 1 && !selected[0]!.webkitRelativePath) {
    const { bytes, path } = loaded[0]!
    let archive: StudioContentArchive | undefined
    const checkedArchive = async (source: string) => {
      if (!readArchive) throw Error('This host cannot read Studio archives.')
      return readArchive(source)
    }
    if (isStudioZip(bytes)) {
      const entries = readStudioZipEntries(bytes)
      if (entries.has('studio-manifest.json')) archive = await checkedArchive(decodeStudioContentZip(bytes))
      else return normalize(kind, [...entries].filter(([name]) => !name.endsWith('/')).map(([path, data]) => ({ path, base64: base64(data) })))
    } else if (/\.json$/i.test(path)) archive = await checkedArchive(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (archive) {
      if (archive.kind !== kind) throw Error(kind === 'bundle' ? '这是设计套件，请从设计套件页面导入。' : '这是技能包，请从技能包页面导入。')
      return checkSources({ kind, files: archive.files.map(({ path, base64 }) => ({ path, base64 })),
        ...(archive.title ? { title: archive.title } : {}) })
    }
  }
  return normalize(kind, loaded.map(({ path, bytes }) => ({ path, base64: base64(bytes) })))
}
