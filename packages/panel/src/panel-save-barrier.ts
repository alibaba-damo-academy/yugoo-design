import type { BeforeSaveRegistration } from './client/panels/shared.ts'

/** A mounted workspace's editor flush barrier. No callbacks enter Design JSON. */
export function createPanelSaveBarrier() {
  const editors = new Map<string, Set<{ flush: () => Promise<void>; discard?: () => void }>>()
  const pendingEditors = new Set<object>(), listeners = new Set<() => void>()
  const notify = () => { for (const listener of listeners) listener() }
  let disposed = false
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    hasPendingChanges: () => pendingEditors.size > 0,
    register(skill: string, flush: () => Promise<void>, discard?: () => void): BeforeSaveRegistration {
      if (disposed) return () => {}
      const callbacks = editors.get(skill) ?? new Set()
      const editor = { flush: async () => { if (live && !disposed) await flush() }, discard }
      callbacks.add(editor); editors.set(skill, callbacks)
      const identity = {}, remove: BeforeSaveRegistration = () => {
        live = false
        if (pendingEditors.delete(identity)) notify()
        callbacks.delete(editor); if (!callbacks.size && editors.get(skill) === callbacks) editors.delete(skill)
      }
      let live = true
      remove.setPending = pending => {
        if (!live || disposed || pendingEditors.has(identity) === pending) return
        pending ? pendingEditors.add(identity) : pendingEditors.delete(identity)
        notify()
      }
      return remove
    },
    discard(): void {
      if (disposed) return
      for (const callbacks of editors.values()) for (const editor of [...callbacks]) editor.discard?.()
    },
    async flush(skill?: string): Promise<void> {
      if (disposed) throw Error('The design workspace changed before saving.')
      const pending = skill === undefined ? [...editors.values()].flatMap(set => [...set]) : [...(editors.get(skill) ?? [])]
      // Finish all already-started serializations before returning a failure.
      const results = await Promise.allSettled(pending.map(editor => Promise.resolve().then(editor.flush)))
      if (disposed) throw Error('The design workspace changed before saving.')
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    },
    dispose() { disposed = true; editors.clear(); pendingEditors.clear(); notify() },
  }
}
