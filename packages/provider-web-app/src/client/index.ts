/** Browser provider for the official Web App native Design panels. */
import type { Context } from '@deepseek-ai/cordis'
import type { NativePanelRegistry } from 'dsh-design-panel/client-api'
import './generated/design.tw.css'
import './ported/iconfont.css'
import './ported/design/panel-shared.css'
import './ported/design/FlowDesignPanel/bpmnStyles.ts'
import { registerWebAppNativePanels } from './packs/web-app.tsx'

export const inject = ['designNativePanels']

/** Register Web App renderers for this client plugin's lifetime. */
export function apply(ctx: Context): void {
  const registry = (ctx as unknown as { designNativePanels: NativePanelRegistry }).designNativePanels
  ctx.effect(() => registerWebAppNativePanels(registry), 'Web App native Design panels')
}
