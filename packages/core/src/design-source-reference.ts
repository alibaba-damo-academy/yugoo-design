/** Versioned source locations, not product facts or inferred KAG relations. */
import { requireDesignFileRelativePath } from './design-file-path.ts'

export interface DesignSourceReference {
  readonly file: string
  readonly pointer?: string
  readonly revision: string
  readonly note?: string
  readonly subject_pointer?: string
}

export interface DesignSourceReferenceRead {
  readonly historical: 'found' | 'missing' | 'unreadable'
  readonly current: 'matching' | 'changed' | 'missing' | 'historical-only' | 'unreadable'
  readonly historicalValue?: unknown
  readonly currentValue?: unknown
  readonly message?: string
}

type VersionReader = (revision: string, file: string, signal?: AbortSignal) => Promise<string | undefined>
const pointerParts = (pointer: string): string[] => {
  if (pointer === '') return []
  if (!pointer.startsWith('/') || /~(?![01])/u.test(pointer)) throw new Error('source reference: invalid JSON Pointer')
  return pointer.slice(1).split('/').map(part => part.replace(/~1/gu, '/').replace(/~0/gu, '~'))
}

export function validateDesignSourceReference(reference: DesignSourceReference): void {
  requireDesignFileRelativePath(reference.file)
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(reference.revision)) throw new Error('source reference: an exact commit is required')
  if (reference.pointer !== undefined) {
    if (!reference.file.endsWith('.json')) throw new Error('source reference: JSON Pointer requires a JSON source')
    pointerParts(reference.pointer)
  }
  if (reference.subject_pointer !== undefined) pointerParts(reference.subject_pointer)
}

/** Check a local subject against its actual owning record, never the target file. */
export function validateDesignSourceReferenceSubject(reference: DesignSourceReference, owner: unknown): void {
  validateDesignSourceReference(reference)
  if (reference.subject_pointer === undefined) return
  const subject = locate(owner, reference.subject_pointer)
  if (!subject.found) throw new Error('source reference: subject pointer does not exist in its owning record')
  if (subject.positional) throw new Error('source reference: subject must not use a positional array identity')
}

function locate(root: unknown, pointer: string): { found: boolean; value?: unknown; positional: boolean } {
  let value = root, positional = false
  for (const part of pointerParts(pointer)) {
    if (Array.isArray(value)) {
      positional = true
      if (!/^(?:0|[1-9]\d*)$/u.test(part)) return { found: false, positional }
    }
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return { found: false, positional }
    value = (value as Record<string, unknown>)[part]
  }
  return { found: true, value, positional }
}

const canonical = (value: unknown) => JSON.stringify(value, (_key, entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry)

/**
 * v1 current resolution supports only non-positional paths. Array elements,
 * even those containing an id, remain historical evidence until an explicit
 * identity-bearing locator contract exists. No display-name/position guessing.
 * The caller supplies the already project-confined DesignFilesStore reader.
 */
export async function readDesignSourceReference(
  reference: DesignSourceReference,
  currentRevision: string,
  read: VersionReader,
  signal?: AbortSignal,
): Promise<DesignSourceReferenceRead> {
  validateDesignSourceReference(reference)
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(currentRevision)) throw new Error('source reference: current revision must be an exact commit')
  const load = async (revision: string) => {
    signal?.throwIfAborted()
    const content = await read(revision, reference.file, signal)
    signal?.throwIfAborted()
    if (content === undefined) return undefined
    if (reference.pointer === undefined) return { found: true, value: content, positional: false }
    return locate(JSON.parse(content), reference.pointer)
  }
  let historical
  try { historical = await load(reference.revision) }
  catch { signal?.throwIfAborted(); return { historical: 'unreadable', current: 'historical-only', message: 'Referenced version cannot be read; no current identity is inferred.' } }
  if (!historical?.found) return { historical: 'missing', current: 'historical-only', message: 'Referenced source was not found at its pinned version.' }
  if (historical.positional) return { historical: 'found', current: 'historical-only', historicalValue: historical.value,
    message: 'An array index is a historical position, not a stable current record identity.' }
  let current
  try { current = reference.revision === currentRevision ? historical : await load(currentRevision) }
  catch { signal?.throwIfAborted(); return { historical: 'found', current: 'unreadable', historicalValue: historical.value } }
  if (!current?.found) return { historical: 'found', current: 'missing', historicalValue: historical.value }
  if (current.positional) return { historical: 'found', current: 'historical-only', historicalValue: historical.value }
  return { historical: 'found', current: canonical(historical.value) === canonical(current.value) ? 'matching' : 'changed',
    historicalValue: historical.value, currentValue: current.value }
}
