/** Presentation bridge only: delegates to the mounted workspace's existing controls. */
import type { DesignWorkspaceControls } from '../../panel/src/client/workspace.tsx'

export interface TrialPanelBinding { readonly trialId: string; readonly parentOrigin: string; readonly locale?: 'zh-CN' | 'en-US' }

export function createTrialPanelBridge(scope: Window, binding: TrialPanelBinding) {
  const parentOrigin = new URL(binding.parentOrigin)
  if (parentOrigin.protocol !== 'http:' || parentOrigin.hostname !== '127.0.0.1' || parentOrigin.origin !== binding.parentOrigin
    || !binding.trialId || scope.parent === scope) throw new Error('An exact owned trial parent is required.')
  let controls: DesignWorkspaceControls | undefined, disposed = false
  const consumed = new Set<string>()
  const publish = () => {
    if (disposed) return
    scope.parent.postMessage({ type: 'yugoo-design:trial-panel-state', trialId: binding.trialId,
      dirty: controls?.dirty ?? false, saving: controls?.saving ?? false,
      saveDisabled: controls?.saveDisabled ?? true, retractDisabled: controls?.retractDisabled ?? true,
      ...(controls?.error ? { error: controls.error } : {}) }, binding.parentOrigin)
  }
  const receive = (event: MessageEvent) => {
    if (disposed || event.source !== scope.parent || event.origin !== binding.parentOrigin) return
    const data = event.data
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || Object.keys(data).some(key => !['type', 'trialId', 'requestId', 'action'].includes(key))
      || data.type !== 'yugoo-design:trial-panel-action' || data.trialId !== binding.trialId
      || typeof data.requestId !== 'string' || !data.requestId || data.requestId.length > 128
      || !['save', 'retract', 'read-state'].includes(data.action)) return
    if (data.action === 'read-state') { publish(); return }
    if (consumed.has(data.requestId)) return
    consumed.add(data.requestId) // A disabled/uncertain action is not automatically retried.
    if (!controls || controls.saving) { publish(); return }
    if (data.action === 'save' && !controls.saveDisabled) controls.save()
    if (data.action === 'retract' && !controls.retractDisabled) controls.retract()
    publish()
  }
  scope.addEventListener('message', receive)
  return {
    update(value: DesignWorkspaceControls | undefined) { controls = value; publish() },
    dispose() { if (disposed) return; controls = undefined; publish(); disposed = true; scope.removeEventListener('message', receive) },
  }
}
