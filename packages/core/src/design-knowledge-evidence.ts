/** Compare source evidence, never lossy display fields or graph grouping. */
import { createHash } from 'node:crypto'
import type { DesignFilesStore } from './design-files.ts'

const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

export function designEvidenceSignatures(store: DesignFilesStore, signal?: AbortSignal) {
  const paths = new Map<string, Promise<Set<string>>>()
  const files = new Map<string, Promise<{ bytes: string; json?: unknown } | undefined>>()
  const signatures = new Map<string, Promise<string | undefined>>()
  return (revision: string, file: string, locator?: string): Promise<string | undefined> => {
    const key = JSON.stringify([revision, file, locator ?? null])
    let signature = signatures.get(key)
    if (signature) return signature
    signature = (async () => {
      signal?.throwIfAborted()
      const fileKey = JSON.stringify([revision, file])
      let reading = files.get(fileKey)
      if (!reading) {
        reading = (async () => {
          let listing = paths.get(revision)
          if (!listing) {
            listing = store.listPathsAt(revision, signal).then(entries => new Set(entries.map(path => path.replace(/^design_files\//u, ''))))
            paths.set(revision, listing)
          }
          if (!(await listing).has(file)) return undefined
          if (file.endsWith('.json')) {
            const text = await store.readTextAt(revision, file, signal)
            if (text === undefined) throw new Error(`Knowledge evidence blob unreadable: ${revision}:${file}`)
            // Invalid historical JSON is unverifiable, not an empty object.
            let json: unknown
            try { json = JSON.parse(text) } catch { return undefined }
            return { bytes: hash(text), json }
          }
          const bytes = await store.readBytesAt(revision, file, signal)
          if (bytes === undefined) throw new Error(`Knowledge evidence blob unreadable: ${revision}:${file}`)
          return { bytes: hash(bytes) }
        })()
        files.set(fileKey, reading)
      }
      const source = await reading
      if (!source) return undefined
      // No locator means the complete file; an empty JSON Pointer means its root.
      if (locator === undefined || (locator === '' && !file.endsWith('.json'))) return source.bytes
      if (!Object.hasOwn(source, 'json')) return undefined
      let value = source.json
      if (locator !== '') {
        if (!locator.startsWith('/') || /~(?![01])/u.test(locator)) return undefined
        for (const segment of locator.slice(1).split('/')) {
          const part = segment.replace(/~1/gu, '/').replace(/~0/gu, '~')
          if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
          if (Array.isArray(value) && !/^(0|[1-9]\d*)$/u.test(part)) return undefined
          value = (value as Record<string, unknown>)[part]
        }
      }
      return hash(canonical(value))
    })()
    signatures.set(key, signature)
    return signature
  }
}
