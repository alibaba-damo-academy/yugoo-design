import { useEffect, useRef, useState } from 'react'
import { subscribeLivePoll } from '../live-poll.ts'

/** One text artifact's transient panel hydration result. */
export type TextArtifactContent = string | null

/** Bounded reconnect window for one referenced text artifact. */
export const TEXT_ARTIFACT_RETRY_DELAYS_MS = Object.freeze([0, 250, 500, 1_000, 2_000, 4_000, 8_000])

/** Text reader shared by panel adapters. */
export type TextArtifactReader = (
  path: string,
) => Promise<{ found: boolean; content: string }>

/** One stable view identity and its referenced artifact path. */
export interface TextArtifactEntry {
  readonly id: string
  readonly path: string
  readonly cacheKey?: string
}

/** View-only state derived from a durable ref and one hydration result. */
export interface TextArtifactView {
  readonly content?: string
  readonly loading: boolean
  readonly available: boolean
}

/** Stable semantic epoch for JSON-shaped canonical panel state. */
export function textArtifactStateEpoch(state: unknown): string {
  try {
    return JSON.stringify(state) ?? 'undefined'
  } catch {
    // Canonical Design state is JSON; retain a safe fallback for malformed
    // transient caller input without making hydration itself fail.
    return String(state)
  }
}

/** Project the same loading/availability semantics for every text artifact. */
export function projectTextArtifactView(
  ref: string | null | undefined,
  inline: string | undefined,
  hydrated: TextArtifactContent | undefined,
): TextArtifactView {
  const hasRef = typeof ref === 'string' && ref !== ''
  const content = inline !== undefined && inline !== ''
    ? inline
    : typeof hydrated === 'string'
      ? hydrated
      : undefined
  return {
    ...(content === undefined ? {} : { content }),
    loading: hasRef && content === undefined && hydrated === undefined,
    available: hasRef && typeof content === 'string' && content.trim() !== '',
  }
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  if (delayMs === 0) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    const onAbort = () => {
      globalThis.clearTimeout(timeout)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Read one referenced artifact through a bounded reconnect window.
 * Rejections and misses retry without requiring another workspace emission.
 */
export async function readTextArtifactWithRetry(
  readArtifact: TextArtifactReader,
  path: string,
  signal: AbortSignal,
  retryDelaysMs: readonly number[] = TEXT_ARTIFACT_RETRY_DELAYS_MS,
): Promise<TextArtifactContent | undefined> {
  for (const delayMs of retryDelaysMs) {
    if (!(await waitForRetry(delayMs, signal))) return undefined
    try {
      const result = await readArtifact(path)
      if (result.found && result.content.trim() !== '') return result.content
    } catch {
      // A disconnected artifact RPC is retryable within this bounded window.
    }
  }
  return signal.aborted ? undefined : null
}

/**
 * Hydrate each file independently. Poll-provided content hashes invalidate only
 * changed files; a missing file becomes readable without a canonical JSON edit.
 * Bounded retries handle transient RPC failures without blocking sibling reads.
 */
export function useTextArtifactContents(
  entries: readonly TextArtifactEntry[],
  readArtifact: TextArtifactReader,
  originalState: unknown,
  artifactFiles?: Readonly<Record<string, string>>,
): Readonly<Record<string, TextArtifactContent>> {
  const [contents, setContents] = useState<Record<string, TextArtifactContent>>({})
  const [retryEpoch, setRetryEpoch] = useState(0)
  const pending = useRef(new Map<string, AbortController>())
  const settled = useRef(new Map<string, TextArtifactContent>())
  const stateEpoch = textArtifactStateEpoch(originalState)
  const reader = useRef(readArtifact)
  const keyed = entries.map(entry => ({ ...entry,
    key: JSON.stringify([entry.path, artifactFiles === undefined ? [entry.cacheKey, stateEpoch] : artifactFiles[entry.path] ?? null]),
    absent: artifactFiles !== undefined && artifactFiles[entry.path] === undefined,
  }))
  const entriesKey = JSON.stringify(keyed)

  useEffect(() => {
    if (reader.current !== readArtifact) {
      for (const controller of pending.current.values()) controller.abort()
      pending.current.clear()
      settled.current.clear()
      reader.current = readArtifact
    }
    const keys = new Set(keyed.map(entry => entry.key))
    for (const [key, controller] of pending.current) {
      if (!keys.has(key)) { controller.abort(); pending.current.delete(key) }
    }
    for (const key of settled.current.keys()) if (!keys.has(key)) settled.current.delete(key)
    setContents(Object.fromEntries(settled.current))
    for (const { key, path, absent } of keyed) {
      if (absent || settled.current.has(key) || pending.current.has(key)) continue
      const controller = new AbortController()
      pending.current.set(key, controller)
      void readTextArtifactWithRetry(readArtifact, path, controller.signal).then(content => {
        if (controller.signal.aborted || content === undefined) return
        pending.current.delete(key)
        settled.current.set(key, content)
        // Publish this file immediately; unrelated slow reads never hold it back.
        setContents(previous => ({ ...previous, [key]: content }))
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesKey, readArtifact, retryEpoch])

  const hasReadMiss = Object.values(contents).some(content => content === null)
  useEffect(() => {
    if (!hasReadMiss) return
    // A transport outage must not poison an unchanged file forever. Reuse the
    // shared clock, with a cooldown; known absent files never enter this cache.
    let retryAt = Date.now() + 15_000
    return subscribeLivePoll(() => {
      if (Date.now() < retryAt) return
      retryAt = Date.now() + 15_000
      for (const [key, content] of settled.current) if (content === null) settled.current.delete(key)
      setRetryEpoch(epoch => epoch + 1)
    })
  }, [hasReadMiss])

  useEffect(() => () => {
    for (const controller of pending.current.values()) controller.abort()
    pending.current.clear()
  }, [])

  return Object.fromEntries(keyed.flatMap(({ id, key, absent }) => absent
    ? [[id, null]] : contents[key] === undefined ? [] : [[id, contents[key]]]))
}
