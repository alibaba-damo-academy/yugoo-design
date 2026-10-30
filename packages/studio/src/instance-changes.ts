/** Bounded edits to the existing complete Studio working copy, not publication. */
import type { DesignBundleVersionPin, StudioDiagnostic } from './types.ts'
import type { StudioPanelPreview } from './panel-preview.ts'

export const STUDIO_INSTANCE_CHANGE_LIMITS = Object.freeze({ files: 64, fileBytes: 1_048_576, totalBytes: 4_194_304, diffBytes: 8_388_608, sampleBytes: 262_144 })
export interface StudioInstanceFileChange {
  readonly path: string
  /** UTF-8 replacement/addition; null explicitly removes a text file. */
  readonly content: string | null
}
export interface StudioInstanceChangeRequest {
  readonly id: string
  readonly expectedRevision: number
  readonly changes: readonly StudioInstanceFileChange[]
  readonly bundle?: DesignBundleVersionPin
  readonly sampleSource?: string
}
export interface StudioInstanceFileDiff {
  readonly path: string
  /** Missing means the file is added/removed; empty text remains an existing file. */
  readonly before?: string
  readonly after?: string
}
export interface StudioInstanceCandidate {
  readonly id: string
  readonly baseRevision: number
  readonly revision: number
  /** Binds the exact base, full candidate source, mount pins and preview sample. */
  readonly digest: string
  readonly diff: readonly StudioInstanceFileDiff[]
  /** Core definition passed; declarative Bundles and explicitly selected Kit previews also require a valid Panel/sample. */
  readonly valid: boolean
  readonly diagnostics: readonly StudioDiagnostic[]
  readonly preview?: StudioPanelPreview
}
/** Draft is the default; validated requests require the exact prepared digest. */
export type StudioInstanceSaveChanges = StudioInstanceChangeRequest & (
  { readonly mode?: 'draft'; readonly digest?: string }
  | { readonly mode: 'validated'; readonly digest: string }
)
export interface StudioInstanceChangeReceipt {
  readonly baseRevision: number
  readonly revision: number
  readonly digest: string
  readonly mode: 'draft' | 'validated'
  /** Neither mode publishes or grants execution authority. */
  readonly validation: 'not_requested' | 'definition_passed' | 'preview_passed'
}

/** Copy before any asynchronous host work so callers cannot mutate an in-flight edit. */
export function normalizeStudioInstanceChanges(value: StudioInstanceChangeRequest): StudioInstanceChangeRequest {
  const { files, fileBytes, totalBytes, sampleBytes } = STUDIO_INSTANCE_CHANGE_LIMITS
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 128
    || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || value.expectedRevision >= Number.MAX_SAFE_INTEGER
    || !Array.isArray(value.changes) || !value.changes.length || value.changes.length > files) throw new Error(`Select an instance revision and 1–${files} file changes.`)
  const seen = new Set<string>(), encoder = new TextEncoder()
  let bytes = 0
  const changes = value.changes.map(change => {
    const { path, content } = change ?? {}
    if (typeof path !== 'string' || !path || path.length > 1024 || /[\\:\u0000-\u001f\u007f]/u.test(path)
      || path.split('/').length > 32 || path.split('/').some(part => !part || ['.', '..', '.git', 'node_modules', '__proto__', 'constructor', 'prototype'].includes(part))
      || seen.has(path)) throw new Error('Invalid or duplicate instance source path.')
    seen.add(path)
    if (content !== null && (typeof content !== 'string' || content.length > fileBytes || !content.isWellFormed()
      || content.includes('\0') || encoder.encode(content).length > fileBytes)) throw new Error('Source must be UTF-8 text of at most 1 MiB per file.')
    bytes += encoder.encode(path).length + (content === null ? 0 : encoder.encode(content).length)
    if (bytes > totalBytes) throw new Error('Instance changes exceed the 4 MiB total text budget.')
    return Object.freeze({ path, content })
  })
  if (value.sampleSource !== undefined && (typeof value.sampleSource !== 'string' || value.sampleSource.length > sampleBytes
    || !value.sampleSource.isWellFormed() || encoder.encode(value.sampleSource).length > sampleBytes)) throw new Error('Isolated preview sample must be UTF-8 JSON text of at most 256 KiB.')
  const bundle = value.bundle
  if (bundle !== undefined && (typeof bundle.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(bundle.name)
    || typeof bundle.version !== 'string' || !/^\d+\.\d+$/.test(bundle.version))) throw new Error('Select an exact preview Bundle pin.')
  return Object.freeze({ id: value.id, expectedRevision: value.expectedRevision, changes: Object.freeze(changes),
    ...(bundle ? { bundle: Object.freeze({ name: bundle.name, version: bundle.version }) } : {}),
    ...(value.sampleSource === undefined ? {} : { sampleSource: value.sampleSource }) })
}
