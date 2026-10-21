/** Shared by hosts: retained DSL wins over disposable A2UI cache. No generation
 * or writes occur while resolving a panel. All callers use authoritative context. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { loadSavedAutoPanel, saveAutoPanelDefinition } from './saved-auto-panel-store.ts'
import { readAutoPanelCache } from './auto-panel-cache.ts'
import { autoPanelManifest, validateAutoPanelEdit, type AutoPanelContext } from './auto-panel-spec.ts'
import type { PanelManifest } from './panel-dsl.ts'

export type AutoPanelResolution =
  | { status: 'needs-generation'; reason: string }
  | { status: 'incompatible'; reason: string }
  | { status: 'ready'; origin: 'retained' | 'generated'; manifest: PanelManifest; definitionRevision: string; sourceChanged: boolean }

export interface AutoPanelRoots {
  /** Project-owned definitions, portable between hosts. */
  definitionRoot: string
  /** Disposable generation cache owned by the current host. */
  cacheRoot: string
}

export async function resolveAutoPanel(roots: AutoPanelRoots, context: AutoPanelContext): Promise<AutoPanelResolution> {
  const retained = await loadSavedAutoPanel(roots.definitionRoot, context)
  if (retained.status === 'incompatible') return retained
  let manifest: PanelManifest, origin: 'retained' | 'generated', sourceChanged = false
  if (retained.status === 'ready') {
    manifest = retained.manifest; origin = 'retained'; sourceChanged = retained.sourceChanged
  } else {
    const cached = await readAutoPanelCache(roots.cacheRoot, context)
    if (cached.status !== 'ready') return { status: 'needs-generation', reason: cached.status === 'stale' ? cached.reason : 'No panel definition' }
    manifest = autoPanelManifest(cached.snapshot, context); origin = 'generated'
  }
  const definitionRevision = createHash('sha256').update(JSON.stringify([
    origin, context.kit, context.kitVersion, context.bundle, context.bundleVersion, context.schema, manifest,
  ])).digest('hex')
  return { status: 'ready', origin, manifest, sourceChanged, definitionRevision }
}

/** Retain exactly the visible generated definition, never arbitrary client DSL.
 * The host must validate project/source identity and call inside its mutation
 * fence with current authoritative context, as for assertResolvedAutoPanelSave.
 */
export async function retainResolvedAutoPanel(request: {
  roots: AutoPanelRoots; context: AutoPanelContext; definitionRevision: string
}): Promise<{ retained: true }> {
  const visible = await resolveAutoPanel(request.roots, request.context)
  if (visible.status !== 'ready' || visible.definitionRevision !== request.definitionRevision) {
    throw new Error('auto panel: definition changed or unavailable; reload before retaining')
  }
  if (visible.origin === 'retained') return { retained: true }
  const cached = await readAutoPanelCache(request.roots.cacheRoot, request.context)
  if (cached.status !== 'ready') throw new Error('auto panel: generated definition unavailable')
  if (!isDeepStrictEqual(autoPanelManifest(cached.snapshot, request.context), visible.manifest)) {
    throw new Error('auto panel: generated definition changed; reload before retaining')
  }
  await saveAutoPanelDefinition(request.roots.definitionRoot, cached.snapshot, request.context)
  return { retained: true }
}

/** Hosts must run this inside their existing project mutation fence immediately
 * before saving, with published current data and the visible worktree snapshot.
 * A retained definition changes presentation persistence, never edit authority.
 */
export async function assertResolvedAutoPanelSave(request: {
  roots: AutoPanelRoots; context: AutoPanelContext; before: unknown; visibleState: unknown;
  after: unknown; definitionRevision: string
}): Promise<void> {
  if (!isDeepStrictEqual(request.context.state, request.before)
    || !isDeepStrictEqual(request.context.state, request.visibleState)) {
    throw new Error('auto panel: source changed; reload before saving')
  }
  const panel = await resolveAutoPanel(request.roots, request.context)
  if (panel.status !== 'ready' || panel.definitionRevision !== request.definitionRevision) {
    throw new Error('auto panel: definition changed or unavailable; reload before saving')
  }
  validateAutoPanelEdit(request.context.state, request.after, request.context, panel.manifest)
}
