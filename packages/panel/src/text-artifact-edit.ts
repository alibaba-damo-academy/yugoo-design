/** Browser-only editor transport. Canonical JSON stores references, never XML. */
export const PANEL_TEXT_ARTIFACTS_KEY = '__dsh_panel_text_artifacts'
export interface TextArtifactBinding {
  recordsPath: string
  record: string
  fieldsPath?: string
  field: string
}
export interface PendingTextArtifact {
  binding: TextArtifactBinding
  path: string
  content: string
  /** Browser-only source generation for detecting external edits while dirty. */
  baseVersion?: string
  /** Images referenced by this exact scene, saved atomically with its text. */
  assets?: readonly { path: string; content: string; encoding: 'base64' }[]
}
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function at(value: unknown, path: string): unknown {
  let result = value
  for (const part of path.split('.')) {
    if (!part || forbidden.has(part) || !object(result) || !Object.hasOwn(result, part)) return undefined
    result = result[part]
  }
  return result
}
export function boundArtifactPath(state: unknown, binding: TextArtifactBinding): unknown {
  if (!binding || typeof binding.recordsPath !== 'string' || typeof binding.record !== 'string'
    || typeof binding.field !== 'string' || forbidden.has(binding.record) || forbidden.has(binding.field)) return undefined
  const records = at(state, binding.recordsPath)
  const record = object(records) && Object.hasOwn(records, binding.record) ? records[binding.record] : undefined
  const fields = binding.fieldsPath === undefined ? record : typeof binding.fieldsPath === 'string' ? at(record, binding.fieldsPath) : undefined
  return object(fields) && Object.hasOwn(fields, binding.field) ? fields[binding.field] : undefined
}
export function confinedEditableArtifact(path: string, skill: string): boolean {
  return /^[a-zA-Z0-9_-]+$/u.test(skill) && path.startsWith(`${skill}/`)
    && !/[\\:\x00-\x1f?#]/u.test(path) && path.split('/').every(part => !!part && part !== '.' && part !== '..' && !forbidden.has(part))
}
export function stageTextArtifact(state: Record<string, unknown>, skill: string, edit: PendingTextArtifact): Record<string, unknown> {
  if (!confinedEditableArtifact(edit.path, skill) || boundArtifactPath(state, edit.binding) !== edit.path) {
    throw new Error('The artifact reference changed or its record was removed. Reopen the current diagram before editing.')
  }
  if (typeof edit.content !== 'string' || edit.content.length > 5_000_000) throw new Error('Invalid or oversized diagram content.')
  const previous = state[PANEL_TEXT_ARTIFACTS_KEY]
  if (previous !== undefined && !Array.isArray(previous)) throw new Error('Invalid editor artifact transport.')
  const pending = (previous ?? []) as PendingTextArtifact[]
  return { ...state, [PANEL_TEXT_ARTIFACTS_KEY]: [...pending.filter(item => item.path !== edit.path), structuredClone(edit)] }
}
/** Remove only drafts owned by a deleted record; malformed transport stays visible. */
export function discardTextArtifactRecordEdits(raw: unknown, recordsPath: string, record: string): unknown {
  if (!Array.isArray(raw)) return raw
  return raw.filter(item => {
    if (!object(item) || !object(item.binding) || typeof item.binding.field !== 'string'
      || typeof item.path !== 'string' || typeof item.content !== 'string'
      || !confinedEditableArtifact(item.path, item.path.split('/')[0]!)
      || (item.assets !== undefined && !Array.isArray(item.assets))) return true
    return item.binding.recordsPath !== recordsPath || item.binding.record !== record
  })
}
/** Exact retained reference check prevents a deleted/repointed record restoring old files. */
export function collectTextArtifactEdits(state: Record<string, unknown>, raw: unknown): { path: string; content: string; encoding?: 'base64' }[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error('Editor artifact transport must be a list.')
  const output = new Map<string, { path: string; content: string; encoding?: 'base64' }>()
  for (const item of raw) {
    if (!object(item) || !object(item.binding) || typeof item.path !== 'string' || typeof item.content !== 'string'
      || item.content.length > 5_000_000 || !confinedEditableArtifact(item.path, item.path.split('/')[0]!)) throw new Error('Invalid editor artifact transport.')
    if (boundArtifactPath(state, item.binding as unknown as TextArtifactBinding) !== item.path) continue
    const priorText = output.get(item.path)
    if (priorText && (priorText.encoding !== undefined || priorText.content !== item.content)) throw new Error('Conflicting artifact bytes.')
    output.set(item.path, { path: item.path, content: item.content })
    if (item.assets !== undefined) {
      if (!Array.isArray(item.assets)) throw new Error('Invalid scene assets.')
      const scene: unknown = JSON.parse(item.content)
      const references = object(scene) && object(scene.files) ? Object.values(scene.files) : []
      for (const asset of item.assets) {
        if (!object(asset) || typeof asset.path !== 'string' || !confinedEditableArtifact(asset.path, item.path.split('/')[0]!)
          || asset.path === item.path || typeof asset.content !== 'string' || asset.encoding !== 'base64'
          || !asset.content.length || asset.content.length > 15_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(asset.content)
          || !references.some(reference => object(reference) && reference.path === asset.path)) throw new Error('Invalid or unreferenced scene image.')
        const prior = output.get(asset.path)
        if (prior && (prior.content !== asset.content || prior.encoding !== 'base64')) throw new Error('Conflicting scene image bytes.')
        output.set(asset.path, { path: asset.path, content: asset.content, encoding: 'base64' })
      }
    }
  }
  return [...output.values()]
}
