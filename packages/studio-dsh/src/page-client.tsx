/** Standalone Design Studio page: thin same-origin RPC over the shared UI. */
import { createRoot, type Root } from 'react-dom/client'
import { StudioFeedback, STUDIO_WORKSPACE_CSS } from 'dsh-design-studio-ui'
import { PANEL_SELECT_MENU_CSS } from 'dsh-design-panel/select'
import { createDshStudioClient } from './client-adapter.tsx'
import { createSameOriginStudioRemote } from './page-rpc.ts'
import { studioAuthoringLocation, studioAuthoringSessionLocator, studioConversationReturnPath } from './page-path.ts'
import { createSameOriginStudioAuthoringClient } from './authoring.page-rpc.ts'
import { DshStudioPageWorkspace } from './page-workspace.tsx'

/** Render the shared workspace over the host /api transport; no DSH client plugin boots. */
let mountedRoot: Root | undefined
function main(): void {
  const container = document.getElementById('root')
  if (container === null) throw new Error('design studio page: #root mount point is missing')
  const client = createDshStudioClient(createSameOriginStudioRemote())
  const agentId = studioAuthoringSessionLocator()
  const authoring = agentId === undefined ? undefined : createSameOriginStudioAuthoringClient({ agentId })
  const root = mountedRoot = createRoot(container)
  root.render(<><style>{PANEL_SELECT_MENU_CSS}</style><DshStudioPageWorkspace client={client}
    authoring={authoring} location={studioAuthoringLocation()} desktop={studioConversationReturnPath() !== undefined} /></>)
  window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const container = document.getElementById('root')
  if (container !== null) {
    const locale = (document.documentElement.lang || navigator.language || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
    ;(mountedRoot ??= createRoot(container)).render(<section className="ygd-studio-workspace"><style>{STUDIO_WORKSPACE_CSS}</style><main className="ygd-studio-main">
      <StudioFeedback feedbackId="studio-start" tone="error" locale={locale} title={locale === 'zh' ? '未能打开设计工作室' : 'Studio could not be opened'} message={message}
        actions={[{ label: locale === 'zh' ? '重新加载' : 'Reload', onClick: () => window.location.reload() }]} />
    </main></section>)
  }
  console.error(error)
}
