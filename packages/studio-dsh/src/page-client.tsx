/** Standalone Design Studio page: thin same-origin RPC over the shared UI. */
import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { StudioWorkspace, type StudioManagementClient } from 'dsh-design-studio-ui'
import { PanelSelect, PANEL_SELECT_MENU_CSS } from 'dsh-design-panel/select'
import { createDshStudioClient, renderStudioReturnNavigation } from './client-adapter.tsx'
import { createSameOriginStudioRemote } from './page-rpc.ts'
import { studioConversationReturnPath } from './page-path.ts'

/** Only Desktop needs a return affordance; locale follows the shared UI's public props. */
function DesktopStudioPage({ client }: { readonly client: StudioManagementClient }): ReactElement {
  const [locale, setLocale] = useState<'zh' | 'en'>(() => (
    (document.documentElement.lang || navigator.language || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  ))
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    {renderStudioReturnNavigation(locale === 'zh')}
    <div style={{ flex: '1 1 auto', minHeight: 0 }}>
      <StudioWorkspace client={client} locale={locale} onLocaleChange={setLocale} renderSelect={PanelSelect} />
    </div>
  </div>
}

/** Render the shared workspace over the host /api transport; no DSH client plugin boots. */
function main(): void {
  const container = document.getElementById('root')
  if (container === null) throw new Error('design studio page: #root mount point is missing')
  const client = createDshStudioClient(createSameOriginStudioRemote())
  const root = createRoot(container)
  root.render(<><style>{PANEL_SELECT_MENU_CSS}</style>{studioConversationReturnPath() === undefined
    ? <StudioWorkspace client={client} renderSelect={PanelSelect} />
    : <DesktopStudioPage client={client} />}</>)
  window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const container = document.getElementById('root')
  if (container !== null) container.textContent = `Design Studio failed to start: ${message}`
  console.error(error)
}
