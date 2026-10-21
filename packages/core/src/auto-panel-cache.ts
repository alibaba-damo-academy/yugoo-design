/** Project-scoped derived A2UI cache. Design Files remain the sole product fact. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  autoPanelSnapshot,
  autoPanelManifest,
  validateAutoPanelEdit,
  validateAutoPanelSnapshot,
  type AutoPanelContext,
  type AutoPanelSnapshot,
} from './auto-panel-spec.ts'
import { isDeepStrictEqual } from 'node:util'

const MAX_CACHE_BYTES = 32_768

export type AutoPanelCacheRead =
  | { readonly status: 'missing' }
  | { readonly status: 'stale'; readonly reason: string }
  | { readonly status: 'ready'; readonly snapshot: AutoPanelSnapshot }

function cachePath(stateRoot: string, bundle: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(bundle)) throw new Error('auto panel: invalid Bundle id')
  return join(stateRoot, 'generated-panels', `${bundle}.json`)
}

/** A stale or malformed generated view never becomes a Design File read failure. */
export async function readAutoPanelCache(stateRoot: string, context: AutoPanelContext): Promise<AutoPanelCacheRead> {
  const path = cachePath(stateRoot, context.bundle)
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_CACHE_BYTES) return { status: 'stale', reason: 'invalid cache file' }
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    validateAutoPanelSnapshot(value, context)
    return { status: 'ready', snapshot: value }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return { status: 'missing' }
    return { status: 'stale', reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Write authority is derived from current facts, never the generated layout. */
export async function assertAutoPanelSave(request: {
  readonly stateRoot: string
  readonly context: AutoPanelContext
  readonly before: unknown
  readonly visibleState: unknown
  readonly after: unknown
}): Promise<void> {
  const current = request.context.state
  if (!isDeepStrictEqual(current, request.before)) {
    throw new Error('auto panel: Design File changed since the panel was opened; reload before saving')
  }
  if (!isDeepStrictEqual(current, request.visibleState)) {
    throw new Error('auto panel: uncommitted Design File changes require reload before saving')
  }
  const cache = await readAutoPanelCache(request.stateRoot, request.context)
  if (cache.status !== 'ready') throw new Error('auto panel: generated view is missing or stale; reload before saving')
  validateAutoPanelEdit(current, request.after, request.context, autoPanelManifest(cache.snapshot, request.context))
}

/** Call only after generation and source-revision fencing; the file is disposable. */
export async function publishAutoPanelCache(
  stateRoot: string,
  context: AutoPanelContext,
  messages: readonly unknown[],
): Promise<AutoPanelSnapshot> {
  const snapshot = autoPanelSnapshot(context, messages)
  const path = cachePath(stateRoot, context.bundle)
  const bytes = `${JSON.stringify(snapshot)}\n`
  if (Buffer.byteLength(bytes, 'utf8') > MAX_CACHE_BYTES) throw new Error('auto panel: snapshot exceeds cache limit')
  const directory = join(stateRoot, 'generated-panels')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.${context.bundle}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error
    })
  }
  return snapshot
}
