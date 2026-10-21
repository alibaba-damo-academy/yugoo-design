/** Public host-neutral Studio UI surface shared by embedded and companion hosts. */
export type {
  StudioClientFailure,
  StudioManagementClient,
} from './types.ts'
export type {
  StudioManagementFailure,
} from 'dsh-design-studio'
export type {
  StudioBundleFileViewerState,
  StudioKitWorkspaceTab,
  StudioSection,
  StudioWorkspaceState,
} from './controller.ts'
export { StudioWorkspaceController } from './controller.ts'
export { StudioPanelDraftController } from './panel-draft-controller.ts'
export type { StudioPanelDraftState, StudioPanelPreviewClient } from './panel-draft-controller.ts'
export type { StudioWorkspaceProps } from './StudioWorkspace.tsx'
export type { StudioSelectProps, StudioSelectRenderer } from './StudioSelect.tsx'
export type { StudioComponentLibrary, StudioComponentEntry, StudioUiLibrary, StudioComponentDirectoryProps } from './ComponentLibrary.tsx'
export type { StudioAuthoring, StudioAuthoringClient } from './PanelDraftWorkbench.tsx'
export { StudioWorkspace } from './StudioWorkspace.tsx'
export type { StudioInstanceClient, StudioInstance } from './InstanceWorkbench.tsx'
export { STUDIO_WORKSPACE_CSS } from './styles.ts'

export type { StudioKitAuthoring, StudioKitAuthoringClient } from './KitDraftWorkbench.tsx'
export { StudioKitDraftController } from './KitDraftWorkbench.tsx'
export { MindsetInlineEditor } from './MindsetInlineEditor.tsx'
export type { MindsetInlineEditorProps } from './MindsetInlineEditor.tsx'
export { StudioTrialController, checkStudioTrialConnection, localTrialUrl, trialActive } from './trial-controller.ts'
export type { StudioTrialClient, StudioTrialRecord, StudioTrialSource, StudioTrialState } from './trial-controller.ts'
export { ContentArchiveWorkbench, StudioContentArchiveController, assertStudioImportRequestSize } from './ContentArchiveWorkbench.tsx'
export type { StudioContentClient, StudioContentImportRecord, StudioContentImportSummary, StudioContentAdoptionResult } from './ContentArchiveWorkbench.tsx'
