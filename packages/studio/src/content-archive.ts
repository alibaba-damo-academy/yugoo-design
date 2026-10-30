/** Portable regular-file content, not a plugin installer or publication format. */
import { createHash } from 'node:crypto'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { DesignBundleVersion, DesignKitVersion, loadDesignBundle, type KitFsLike, type KitResourceContent } from 'dsh-design-core'
import { loadStudioKit } from './load.ts'
import type { DesignBundleVersionPin, StudioDiagnostic, StudioReadFs } from './types.ts'

export interface StudioArchivePin { readonly name: string; readonly version: string }
export interface StudioArchiveFile {
  readonly path: string
  readonly base64: string
  readonly bytes: number
  readonly sha256: string
}
export interface StudioContentArchive {
  readonly format: 'studio-content-archive/v1'
  readonly kind: 'kit' | 'bundle'
  readonly pin: StudioArchivePin
  /** Optional bilingual working-copy display name, independent of catalog/runtime identity. */
  readonly title?: { readonly zh: string; readonly en: string }
  /** Declared provenance, not verified authorship or redistribution permission. */
  readonly provenance?: { readonly source?: string; readonly license?: string }
  /** Kit membership pins in catalog order; Bundle explicitly declared requirements. */
  readonly dependencies: readonly DesignBundleVersionPin[]
  readonly files: readonly StudioArchiveFile[]
  /** SHA-256 of the canonical envelope excluding this field; not a signature. */
  readonly sha256: string
}
export interface StudioArchiveBundleSource extends StudioArchivePin {
  readonly sourceId: string
  readonly snapshot: StudioArchiveSource
}
export interface StudioArchiveSource {
  readonly sourceId?: string
  /** Explicit standalone source, not an invented Kit or a fallback after Kit validation. */
  readonly bundle?: StudioArchivePin
  /** Trusted immutable Bundle snapshots, never paths supplied by an archive. */
  readonly bundles?: readonly StudioArchiveBundleSource[]
  readonly root: string
  readonly fs: StudioReadFs
  /** Host supplies a complete, immutable regular-file snapshot; no live fallback. */
  listFiles(): Promise<readonly string[]>
  /** Byte-preserving read. Host rejects links and non-regular files before reading. */
  readBytes(path: string): Promise<Uint8Array>
}
export interface StudioPreparedContentImport {
  readonly archive: StudioContentArchive
  /** Files relative to Kit root, or standalone Bundle root, respectively. */
  readonly files: readonly StudioArchiveFile[]
  /** Independently retainable content, only populated after definition validation. */
  readonly contents: readonly { readonly kind: 'kit' | 'bundle'; readonly pin: StudioArchivePin; readonly files: readonly StudioArchiveFile[] }[]
  readonly executionGranted: false
  /** Includes scripts and provider/driver references; host approval is separate. */
  readonly requiresTrustReview: boolean
  readonly validation: { readonly valid: boolean; readonly diagnostics: readonly StudioDiagnostic[] }
}
const MAX_BYTES = 16 * 1024 * 1024
const MAX_JSON = 32 * 1024 * 1024
const MAX_FILES = 4096
const HASH = /^[0-9a-f]{64}$/
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

// Explicit byte assets only. Unknown resources, methods and scripts remain strict text.
const OPAQUE_RESOURCE_EXTENSIONS = new Set(['.bin', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.wasm'])

/** Shared by archive capture and virtual import; full bytes and directory entries remain intact. */
export function readStudioArchiveResource(path: string, bytes: Uint8Array): KitResourceContent {
  return OPAQUE_RESOURCE_EXTENSIONS.has(extname(path).toLowerCase())
    ? { kind: 'opaque', byteLength: bytes.byteLength }
    : { kind: 'text', content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid archive object.')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).length !== allowed.length || allowed.some(key => !Object.hasOwn(value, key))) throw Error('Unknown or missing archive fields.')
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > limit || /[\u0000-\u001f\u007f]/u.test(value)) throw Error('Invalid archive metadata text.')
  return value
}
function metadataText(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 2048) throw Error('Invalid archive metadata text.')
  return value
}
function pin(value: unknown, kind: 'kit' | 'bundle'): StudioArchivePin {
  const data = object(value); keys(data, ['name', 'version'])
  const name = text(data.name, 128), version = text(data.version, 32)
  // This is the current loader's directory identity, not a new namespace scheme.
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw Error('Unsupported archive content identity.')
  safePath(name); safePath(version)
  if (kind === 'kit') DesignKitVersion(version); else DesignBundleVersion(version)
  return Object.freeze({ name, version })
}
function safePath(value: unknown): string {
  const path = text(value, 1024)
  if (path !== path.normalize('NFC') || /[\\:*?"<>|]/u.test(path)) throw Error('Unsafe archive path.')
  if (/\.(exe|dll|node|so|dylib|com|msi|sys)$/iu.test(path)) throw Error('Native executable payload propagation is unsupported.')
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || ['.git', 'node_modules'].includes(part.toLowerCase())
      || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)) throw Error('Unsafe archive path.')
  }
  return path
}
function canonical(data: Omit<StudioContentArchive, 'sha256'>): string { return JSON.stringify(data) }

/** Parse a bounded JSON envelope; hashes include metadata and every original byte. */
export function readStudioContentArchive(source: string): StudioContentArchive {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_JSON) throw Error('Archive JSON exceeds 32 MiB.')
  const raw = object(JSON.parse(source))
  keys(raw, ['format', 'kind', 'pin', ...(Object.hasOwn(raw, 'title') ? ['title'] : []), ...(Object.hasOwn(raw, 'provenance') ? ['provenance'] : []), 'dependencies', 'files', 'sha256'])
  if (raw.format !== 'studio-content-archive/v1' || (raw.kind !== 'kit' && raw.kind !== 'bundle')) throw Error('Unsupported archive format.')
  const identity = pin(raw.pin, raw.kind)
  let title: StudioContentArchive['title']
  if (raw.title !== undefined) {
    const names = object(raw.title); keys(names, ['zh', 'en'])
    title = Object.freeze({ zh: text(names.zh, 800), en: text(names.en, 800) })
    if (title.zh.length > 200 || title.en.length > 200) throw Error('Archive display title exceeds 200 characters.')
  }
  let origin: StudioContentArchive['provenance']
  if (raw.provenance !== undefined) {
    const provenance = object(raw.provenance)
    keys(provenance, ['source', 'license'].filter(key => Object.hasOwn(provenance, key)))
    origin = Object.freeze({
      ...(provenance.source === undefined ? {} : { source: metadataText(provenance.source) }),
      ...(provenance.license === undefined ? {} : { license: metadataText(provenance.license) }),
    })
  }
  if (!Array.isArray(raw.dependencies) || raw.dependencies.length > MAX_FILES) throw Error('Invalid archive dependencies.')
  const dependencies = raw.dependencies.map(value => pin(value, 'bundle'))
  const names = new Set<string>()
  for (const dependency of dependencies) {
    if (names.has(dependency.name) || (raw.kind === 'bundle' && dependency.name === identity.name)) throw Error('Duplicate or self archive dependency.')
    names.add(dependency.name)
  }
  if (!Array.isArray(raw.files) || !raw.files.length || raw.files.length > MAX_FILES) throw Error('Invalid archive file count.')
  let total = 0
  const paths = new Map<string, string>()
  const prefixes = new Map<string, string>()
  const directories = new Set<string>()
  const files = raw.files.map(value => {
    const entry = object(value); keys(entry, ['path', 'base64', 'bytes', 'sha256'])
    const path = safePath(entry.path), folded = path.toLowerCase()
    const segments = path.split('/')
    for (let index = 1; index <= segments.length; index++) {
      const prefix = segments.slice(0, index).join('/'), foldedPrefix = prefix.toLowerCase()
      if (prefixes.has(foldedPrefix) && prefixes.get(foldedPrefix) !== prefix) throw Error('Case-conflicting archive path segments.')
      prefixes.set(foldedPrefix, prefix)
    }
    if (paths.has(folded)) throw Error('Duplicate or case-conflicting archive paths.')
    paths.set(folded, path)
    const parts = folded.split('/'); parts.pop()
    while (parts.length) { directories.add(parts.join('/')); parts.pop() }
    if (!Number.isSafeInteger(entry.bytes) || (entry.bytes as number) < 0 || (entry.bytes as number) > MAX_BYTES - total) throw Error('Archive content exceeds 16 MiB or has an invalid byte count.')
    if (typeof entry.base64 !== 'string' || entry.base64.length > Math.ceil(MAX_BYTES / 3) * 4 || entry.base64.length % 4
      || !/^[A-Za-z0-9+/]*={0,2}$/u.test(entry.base64)) throw Error('Invalid archive base64.')
    const bytes = Buffer.from(entry.base64, 'base64')
    if (bytes.toString('base64') !== entry.base64 || entry.bytes !== bytes.length || typeof entry.sha256 !== 'string'
      || !HASH.test(entry.sha256) || sha(bytes) !== entry.sha256) throw Error('Archive file integrity mismatch.')
    total += bytes.length
    if (total > MAX_BYTES) throw Error('Archive content exceeds 16 MiB.')
    return Object.freeze({ path, base64: entry.base64, bytes: bytes.length, sha256: entry.sha256 })
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  if ([...directories].some(path => paths.has(path))) throw Error('Archive file/directory collision.')
  const data: Omit<StudioContentArchive, 'sha256'> = { format: raw.format, kind: raw.kind, pin: identity,
    ...(title === undefined ? {} : { title }),
    ...(origin === undefined ? {} : { provenance: origin }), dependencies: Object.freeze(dependencies), files: Object.freeze(files) }
  if (typeof raw.sha256 !== 'string' || !HASH.test(raw.sha256) || sha(canonical(data)) !== raw.sha256) throw Error('Archive envelope integrity mismatch.')
  return Object.freeze({ ...data, sha256: raw.sha256 })
}

/** Pure virtual source: explicit text reads stay strict; attached byte assets remain opaque. */
function virtualSource(files: readonly StudioArchiveFile[], root: string): StudioReadFs {
  const map = new Map(files.map(file => [file.path, file.base64]))
  const key = (path: string): string => {
    const result = relative(root, resolve(path))
    if (isAbsolute(result) || result === '..' || result.startsWith(`..${sep}`)) throw Error('Archive validation path escapes source.')
    return result.split(sep).join('/')
  }
  const children = (path: string): string[] => {
    const prefix = key(path); const head = prefix ? `${prefix}/` : ''
    return [...new Set([...map.keys()].filter(file => file.startsWith(head)).map(file => file.slice(head.length).split('/')[0]))].sort()
  }
  return { async readText(path) {
    const content = map.get(key(path))
    return content === undefined ? undefined : new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(content, 'base64'))
  }, async readResource(path) {
    const content = map.get(key(path))
    return content === undefined ? undefined : readStudioArchiveResource(path, Buffer.from(content, 'base64'))
  }, async listDir(path) { return children(path) }, async isDirectory(path) { return children(path).length > 0 },
  async realPath(path) { key(path); return resolve(path) } }
}

const bundlePin = (skill: { name: string; catalogName?: string; version: unknown }): StudioArchivePin =>
  ({ name: skill.catalogName ?? skill.name, version: String(skill.version) })
const samePin = (left: StudioArchivePin, right: StudioArchivePin): boolean => left.name === right.name && left.version === right.version
const bundlePrefix = (identity: StudioArchivePin): string => `bundles/${identity.name}/${identity.version}/`
const within = (root: string, path: string): boolean => {
  const rel = relative(root, resolve(path)); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

/** All reads dispatch to captured bytes; there is no live filesystem fallback. */
function sourceView(snapshot: StudioArchiveSource) {
  const bundles = snapshot.bundles ?? []
  const sources = [...bundles.map(bundle => bundle.snapshot), snapshot].sort((a, b) => b.root.length - a.root.length)
  const owner = (path: string): StudioArchiveSource => {
    const source = sources.find(source => within(source.root, path))
    if (!source) throw Error('Archive validation path escapes captured sources.')
    return source
  }
  const fs: StudioReadFs = {
    readText: path => owner(path).fs.readText(path),
    async readResource(path) {
      const source = owner(path)
      if (typeof source.readBytes === 'function') return readStudioArchiveResource(path, await source.readBytes(path))
      // Legacy context ports without byte snapshots preserve their existing behavior.
      if (source.fs.readResource) return source.fs.readResource(path)
      const content = await source.fs.readText(path)
      return content === undefined ? undefined : { kind: 'text', content }
    },
    listDir: path => owner(path).fs.listDir(path),
    async isDirectory(path) { const source = owner(path); return source.fs.isDirectory ? source.fs.isDirectory(path) : (await source.fs.listDir(path)).length > 0 },
    async realPath(path) { const source = owner(path); return source.fs.realPath ? source.fs.realPath(path) : resolve(path) },
  }
  return { fs, options: { sourceId: snapshot.sourceId, bundles: bundles.map(bundle => ({ name: bundle.name, version: bundle.version,
    rootDir: bundle.snapshot.root, sourceId: bundle.sourceId })) } }
}

function archiveSnapshot(archive: StudioContentArchive): StudioArchiveSource {
  const root = resolve('/studio-content-archive-virtual')
  const sourceId = `archive:untrusted:${archive.sha256}`
  const independent = archive.kind === 'kit' && archive.files.some(file => file.path === 'kit.yaml')
  const filesAt = (files: readonly StudioArchiveFile[], root: string): StudioArchiveSource => {
    const fs = virtualSource(files, root)
    return { root, sourceId, fs, async listFiles() { return files.map(file => file.path) }, async readBytes(path) {
      const file = files.find(file => resolve(root, file.path) === resolve(path))
      if (!file) throw Error('Missing archive source file.')
      return Buffer.from(file.base64, 'base64')
    } }
  }
  if (!independent) return filesAt(archive.files, root)
  const bundleFiles = new Set<string>()
  const bundles = archive.dependencies.map(identity => {
    const prefix = bundlePrefix(identity)
    const files = archive.files.filter(file => file.path.startsWith(prefix)).map(file => {
      bundleFiles.add(file.path); return Object.freeze({ ...file, path: file.path.slice(prefix.length) })
    })
    if (!files.length) throw Error(`Archive is missing exact Bundle content: ${identity.name}@${identity.version}`)
    return { ...identity, sourceId, snapshot: filesAt(files, resolve(root, prefix)) }
  })
  if (archive.files.some(file => file.path.startsWith('bundles/') && !bundleFiles.has(file.path))) throw Error('Archive contains unreferenced Bundle content.')
  return { ...filesAt(archive.files.filter(file => !bundleFiles.has(file.path)), root), bundles }
}

/** No writes, extraction, permission restoration, script execution, installation or publication. */
export async function prepareStudioContentImport(
  source: string,
  options: { validationContext?: StudioArchiveSource | { root: string; fs: StudioReadFs } } = {},
): Promise<StudioPreparedContentImport> {
  const archive = readStudioContentArchive(source)
  let validation: StudioPreparedContentImport['validation']
  let contents: StudioPreparedContentImport['contents'] = Object.freeze([])
  let requiresTrustReview = archive.files.some(file => /\.(m?js|cjs|[cm]?tsx?|sh|ps1|cmd|bat|py|wasm)$/iu.test(file.path))
  try {
    const snapshot = archiveSnapshot(archive), view = sourceView(snapshot)
    const selected = []
    if (archive.kind === 'kit') {
      const kit = await loadStudioKit(view.fs, snapshot.root, view.options)
      selected.push(...kit.skills)
      if (kit.name !== archive.pin.name || String(kit.version) !== archive.pin.version) throw Error('Archive Kit identity disagrees with source.')
      if (JSON.stringify(kit.skills.map(bundlePin)) !== JSON.stringify(archive.dependencies)) throw Error('Archive Kit member pins disagree with source.')
      if (snapshot.bundles) {
        const kitFiles = archive.files.filter(file => !file.path.startsWith('bundles/'))
        contents = Object.freeze([
          Object.freeze({ kind: 'kit' as const, pin: archive.pin, files: Object.freeze(kitFiles) }),
          ...snapshot.bundles.map(bundle => Object.freeze({ kind: 'bundle' as const, pin: Object.freeze({ name: bundle.name, version: bundle.version }),
            files: Object.freeze(archive.files.filter(file => file.path.startsWith(bundlePrefix(bundle))).map(file =>
              Object.freeze({ ...file, path: file.path.slice(bundlePrefix(bundle).length) }))) })),
        ])
      } else contents = Object.freeze([Object.freeze({ kind: 'kit', pin: archive.pin, files: archive.files })])
    } else {
      const bundle = await loadDesignBundle(snapshot.fs as KitFsLike, { rootDir: snapshot.root, sourceId: snapshot.sourceId! }, archive.pin)
      selected.push(bundle.skill)
      const context = options.validationContext
      if (archive.dependencies.length && (!context || !isAbsolute(context.root))) throw Error('Independent Bundle dependency validation requires a host-resolved immutable Kit context.')
      if (context) {
        if (!isAbsolute(context.root)) throw Error('Archive context must have a host-resolved absolute root.')
        const contextView = sourceView(context as StudioArchiveSource)
        const kit = await loadStudioKit(contextView.fs, context.root, contextView.options)
        if (archive.dependencies.some(dependency => !kit.skills.some(skill => samePin(bundlePin(skill), dependency)))) throw Error('Archive Bundle dependency is unresolved in context.')
        const existing = kit.skills.find(skill => samePin(bundlePin(skill), archive.pin))
        if (existing?.resourceRoot) {
          // Validate replacement against its existing context, never keeping deleted files.
          const local = virtualSource(archive.files, existing.resourceRoot)
          const owns = (path: string) => within(existing.resourceRoot!, path)
          const overlay: StudioReadFs = {
            readText: path => owns(path) ? local.readText(path) : contextView.fs.readText(path),
            readResource: path => owns(path) ? local.readResource!(path) : contextView.fs.readResource!(path),
            listDir: path => owns(path) ? local.listDir(path) : contextView.fs.listDir(path),
            async isDirectory(path) { return owns(path) ? local.isDirectory!(path) : contextView.fs.isDirectory!(path) },
            async realPath(path) { return owns(path) ? resolve(path) : contextView.fs.realPath!(path) },
          }
          await loadStudioKit(overlay, context.root, contextView.options)
        }
      }
      contents = Object.freeze([Object.freeze({ kind: 'bundle', pin: archive.pin, files: archive.files })])
    }
    requiresTrustReview ||= selected.some(skill => {
      const manifest = skill.metadata?.skillManifest as { presentation?: { mode?: string } } | undefined
      const rules = skill.metadata?.validationDocument as { rules?: { check?: { driver?: unknown } }[] } | undefined
      return manifest?.presentation?.mode === 'native' || !!rules?.rules?.some(rule => typeof rule.check?.driver === 'string')
    })
    validation = Object.freeze({ valid: true, diagnostics: Object.freeze([]) })
  } catch (error) {
    contents = Object.freeze([])
    validation = Object.freeze({ valid: false, diagnostics: Object.freeze([Object.freeze({ code: 'archive.definition', message: error instanceof Error ? error.message : String(error), subject: archive.pin.name })]) })
  }
  return Object.freeze({ archive, files: archive.files, contents, executionGranted: false, requiresTrustReview, validation })
}

/** Capture only immutable host snapshots, preserving full exact referenced trees. */
export function exportStudioContentArchive(
  snapshot: StudioArchiveSource,
  input: StudioArchiveExportInput,
): Promise<string> {
  return exportArchive(snapshot, input, true)
}

/** Capture saved source bytes, including incomplete working copies, without definition validation. */
export function exportStudioSourceArchive(snapshot: StudioArchiveSource, input: StudioArchiveExportInput): Promise<string> {
  return exportArchive(snapshot, input, false)
}

interface StudioArchiveExportInput {
  kind: 'kit' | 'bundle'
  pin: StudioArchivePin
  title?: StudioContentArchive['title']
  provenance?: StudioContentArchive['provenance']
  dependencies?: readonly DesignBundleVersionPin[]
}

async function exportArchive(
  snapshot: StudioArchiveSource,
  input: StudioArchiveExportInput,
  validateDefinition: boolean,
): Promise<string> {
  const request = JSON.parse(JSON.stringify(input)) as typeof input
  if (!isAbsolute(snapshot.root)) throw Error('Archive source root must be host-resolved absolute.')
  const standalone = snapshot.bundle !== undefined
  if (standalone && (request.kind !== 'bundle' || !samePin(snapshot.bundle!, request.pin))) throw Error('Standalone Bundle snapshot pin disagrees with export.')
  const view = validateDefinition ? sourceView(snapshot) : undefined
  const kit = !validateDefinition || standalone ? undefined : await loadStudioKit(view!.fs, snapshot.root, view!.options)
  const selected = !validateDefinition ? undefined : standalone ? (await loadDesignBundle(view!.fs, { rootDir: snapshot.root, sourceId: snapshot.sourceId ?? 'studio:exact-instance' }, request.pin)).skill
    : request.kind === 'kit' ? kit : kit!.skills.find(skill => samePin(bundlePin(skill), request.pin))
  if (validateDefinition && (!selected || !samePin(request.kind === 'kit' ? { name: selected.name, version: String(selected.version) } : bundlePin(selected), request.pin))) throw Error('Export pin disagrees with snapshot.')
  const files: StudioArchiveFile[] = []
  let total = 0
  const append = async (source: StudioArchiveSource, prefix: string, selectPrefix = '') => {
    const all = await source.listFiles()
    if (all.length > MAX_FILES) throw Error('Snapshot file count exceeds 4096.')
    for (const path of [...all].sort()) {
      safePath(path)
      if (selectPrefix && !path.startsWith(selectPrefix)) continue
      const target = prefix + path.slice(selectPrefix.length)
      safePath(target)
      const bytes = await source.readBytes(resolve(source.root, path))
      total += bytes.byteLength
      if (total > MAX_BYTES || files.length >= MAX_FILES) throw Error('Archive content exceeds 16 MiB or 4096 files.')
      files.push({ path: target, base64: Buffer.from(bytes).toString('base64'), bytes: bytes.byteLength, sha256: sha(bytes) })
    }
  }
  if (!validateDefinition) {
    await append(snapshot, '')
    if (request.kind === 'kit') for (const bundle of snapshot.bundles ?? []) await append(bundle.snapshot, bundlePrefix(bundle))
  } else if (standalone) await append(snapshot, '')
  else if (snapshot.bundles) {
    const referenced = kit!.skills.map(skill => {
      const identity = bundlePin(skill), matches = snapshot.bundles!.filter(bundle => samePin(bundle, identity))
      if (matches.length !== 1) throw Error('Missing or ambiguous exact Bundle snapshot.')
      return matches[0]!
    })
    if (request.kind === 'kit') {
      if ((await snapshot.listFiles()).some(path => path === 'bundles' || path.startsWith('bundles/'))) throw Error('Kit-owned files collide with archive Bundle transport paths.')
      await append(snapshot, '')
      for (const bundle of referenced) await append(bundle.snapshot, bundlePrefix(bundle))
    } else await append(referenced.find(bundle => samePin(bundle, request.pin))!.snapshot, '')
  } else await append(snapshot, '', request.kind === 'bundle' ? `skills/${selected!.name}/` : '')
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const data: Omit<StudioContentArchive, 'sha256'> = { format: 'studio-content-archive/v1', kind: request.kind, pin: request.pin,
    ...(request.title === undefined ? {} : { title: { zh: request.title.zh, en: request.title.en } }),
    ...(request.provenance === undefined ? {} : { provenance: request.provenance }),
    dependencies: request.kind === 'kit' && validateDefinition ? kit!.skills.map(bundlePin) : request.dependencies ?? (request.kind === 'kit' ? snapshot.bundles?.map(bundle => ({ name: bundle.name, version: bundle.version })) ?? [] : []), files }
  if (validateDefinition && request.kind === 'kit' && request.dependencies !== undefined && JSON.stringify(request.dependencies) !== JSON.stringify(data.dependencies)) throw Error('Explicit Kit pins disagree with source membership.')
  const serialized = JSON.stringify({ ...data, sha256: sha(canonical(data)) })
  if (!validateDefinition) {
    readStudioContentArchive(serialized)
    return serialized
  }
  const prepared = await prepareStudioContentImport(serialized, { validationContext: standalone ? undefined : snapshot })
  if (!prepared.validation.valid) throw Error(prepared.validation.diagnostics[0]!.message)
  return serialized
}
