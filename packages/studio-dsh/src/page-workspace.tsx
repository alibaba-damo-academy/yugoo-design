/** Standalone browser composition; the existing shared workspace owns its shell. */
import { useState, type ReactElement } from 'react'
import { StudioWorkspace, type StudioManagementClient } from 'dsh-design-studio-ui'
import { PanelSelect } from 'dsh-design-panel/select'
import { PanelSamplePreview } from 'dsh-design-panel/sample-preview'
import { renderStudioReturnNavigation } from './client-adapter.tsx'
import { StudioAuthoringWorkbench, StudioAuthoringPromptContext } from './authoring-workbench.tsx'
import type { StudioPageAuthoringClient } from './authoring.page-rpc.ts'
import type { StudioAuthoringLocation } from './page-path.ts'

export interface DshStudioPageWorkspaceProps {
  readonly client: StudioManagementClient
  /** Captured once from an explicit native Session locator when the page opens. */
  readonly authoring?: StudioPageAuthoringClient
  readonly desktop: boolean
  readonly location?: StudioAuthoringLocation
}

export function DshStudioPageWorkspace({ client, authoring, desktop, location }: DshStudioPageWorkspaceProps): ReactElement {
  const [locale, setLocale] = useState<'zh' | 'en'>(() => (
    (document.documentElement.lang || navigator.language || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  ))
  const workspace = <StudioWorkspace client={client} locale={locale} onLocaleChange={setLocale}
    renderContent={(content, context) => <StudioAuthoringPromptContext.Provider value={context.initialPrompt}>{content}</StudioAuthoringPromptContext.Provider>}
    renderPreview={(preview, _adopt, options) => <PanelSamplePreview skill={preview.bundle.name} panelYaml={preview.panelYaml}
      sample={preview.sample} artifacts={preview.artifacts} locale={locale === 'zh' ? 'zh-CN' : 'en-US'} readOnly={options.readOnly} />}
    renderSelect={PanelSelect} instances={authoring?.instances} contentClient={authoring?.content} initialInstance={authoring ? location?.initialInstance : undefined}
    renderInstanceWorkbench={authoring === undefined ? undefined : props =>
      <StudioAuthoringWorkbench {...props} client={authoring} presentation={location?.presentation ?? 'full'}
        preparedLocator={location?.preparedLocator?.id === props.id ? location.preparedLocator : undefined} />} />
  if (!desktop) return workspace
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    {renderStudioReturnNavigation(locale === 'zh')}
    <div style={{ flex: '1 1 auto', minHeight: 0 }}>{workspace}</div>
  </div>
}
