/** Trusted Loader activation. Path policy and native authoring keep their existing owners. */
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { DshStudioAuthoringService, type DshStudioAuthoringServiceConfig } from './authoring-service.ts'
import { prepareStudioAuthoringDirectory } from './authoring-reference-store.ts'

export type DshStudioAuthoringEntryConfig = Partial<DshStudioAuthoringServiceConfig>
export const name = 'studio-authoring'
export const inject = [...DshStudioAuthoringService.inject]

/**
 * Prepare private single-leaf roots, then mount the one existing Service.
 * Failed or interrupted initialization preserves already-created directories
 * and namespace metadata; no rollback or automatic retry is attempted.
 * Async keeps this plugin callback non-constructible for Cordis activation.
 */
export async function apply(ctx: Context, config: DshStudioAuthoringEntryConfig = {}): Promise<void> {
  let closed = false
  let child: ReturnType<Context['plugin']> | undefined
  let initialization: Promise<void> | undefined
  let shutdown: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (shutdown) return shutdown
    closed = true
    const completion = Promise.withResolvers<void>()
    shutdown = completion.promise
    void shutdown.catch(() => {})
    // Start child disposal synchronously, before joining bootstrap. The child
    // Service owns native admission and its raw Host initialization join.
    let stop: Promise<void> | undefined
    try { stop = child?.dispose() } catch (error) { stop = Promise.reject(error) }
    void Promise.allSettled([stop, initialization?.then(() => undefined, () => undefined)]).then(results => {
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason)
      if (failures.length) throw new AggregateError(failures, 'Studio authoring entry cleanup failed')
    }).then(completion.resolve, completion.reject)
    return shutdown
  }
  // Registered before path resolution, queued work, directory I/O or Service init.
  ctx.effect(() => close, 'studio-authoring-entry')
  // Public disposal notification fires when uid is cleared, including while
  // LOADING would defer a status transition. Events start closing; cleanup joins.
  ctx.on('internal/plugin', fiber => { if (fiber === ctx.fiber && fiber.uid === null) void close() })
  // Public FiberState const-enum values: UNLOADING=5, DISPOSED=4; no runtime export.
  ctx.on('internal/status', fiber => { if (fiber === ctx.fiber && (fiber.state === 5 || fiber.state === 4)) void close() })
  try {
    if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('Studio authoring entry requires a trusted configuration object')
    const roots = Object.freeze({
      stateRoot: config.stateRoot === undefined ? dshHomePath('yugoo-design-studio') : config.stateRoot,
      workspaceRoot: config.workspaceRoot === undefined ? dshHomePath('yugoo-design-studio-workspace') : config.workspaceRoot,
    })
    const active = () => { if (closed || ctx.fiber.uid === null) throw new Error('Studio authoring entry closed during initialization') }
    // Assign the original pending task before its first operation can run. It
    // never waits for close(), so shutdown can join it without a self-cycle.
    initialization = Promise.resolve().then(async () => {
      active()
      const stateRoot = await prepareStudioAuthoringDirectory(roots.stateRoot)
      active()
      const workspaceRoot = await prepareStudioAuthoringDirectory(roots.workspaceRoot)
      active()
      child = ctx.plugin(DshStudioAuthoringService, { stateRoot, workspaceRoot })
      await child
      active()
    })
  } catch (error) { initialization = Promise.reject(error) }
  void initialization.catch(() => {})
  return initialization
}

export default { name, inject, apply }
