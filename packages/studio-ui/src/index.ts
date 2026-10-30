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
export type { StudioWorkspaceProps, StudioObjectAuthoringContext } from './StudioWorkspace.tsx'
export type { StudioSelectProps, StudioSelectRenderer } from './StudioSelect.tsx'
export type { StudioComponentLibrary, StudioComponentEntry, StudioUiLibrary, StudioComponentDirectoryProps } from './ComponentLibrary.tsx'
export type { StudioAuthoring, StudioAuthoringClient } from './authoring.ts'
export { StudioWorkspace } from './StudioWorkspace.tsx'
export type { StudioInstanceClient, StudioInstance, InstanceWorkbenchProps } from './InstanceWorkbench.tsx'
export { InstanceWorkbench } from './InstanceWorkbench.tsx'
export type { StudioPreparedSourceChanges } from './source-candidate-state.ts'
export { STUDIO_WORKSPACE_CSS } from './styles.ts'
export { StudioEmptyState } from './StudioEmptyState.tsx'
export { ConversationActivity, ConversationMessage, ConversationMessages, CONVERSATION_ACTIVITY_CSS } from './ConversationActivity.tsx'
export type { AgentConversationRow } from './ConversationActivity.tsx'
export { StudioFeedback } from './StudioFeedback.tsx'
export { StudioErrorDialog } from './StudioErrorDialog.tsx'
export type { StudioErrorDialogProps } from './StudioErrorDialog.tsx'
export type { StudioFeedbackProps, StudioFeedbackAction, StudioFeedbackDetail } from './StudioFeedback.tsx'

export { StudioTrialController, checkStudioTrialConnection, localTrialUrl, trialActive } from './trial-controller.ts'
export type { StudioTrialClient, StudioTrialRecord, StudioTrialSource, StudioTrialState } from './trial-controller.ts'
export { assertStudioImportRequestSize } from './content-transfer.ts'
export type { StudioContentClient, StudioContentExportInput, StudioInstanceExportTarget } from './content-transfer.ts'
