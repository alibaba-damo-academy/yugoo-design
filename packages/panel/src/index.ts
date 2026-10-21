/**
 * dsh-design-panel/ui — React library and Node rendering/test API.
 *
 * This explicit entry retains the component/interpreter exports. The package
 * root uses host.ts so discovering the browser plugin needs no renderer peers.
 */
export { name, apply } from './host.ts'

export {
  parsePanelManifest,
  validatePanelManifest,
  PANEL_KINDS,
  COMPONENT_KINDS,
  PANEL_COMPONENT_CATALOG,
  describePanelComponents,
  CONTROL_KINDS,
  ROW_COLUMN_CONTROLS,
  type PanelKind,
  type ComponentKind,
  type ControlKind,
  type RowColumnControl,
  type PanelSectionRef,
  type FieldOption,
  type RowColumn,
  type PanelSection,
  type EditorField,
  type ComponentNode,
  type PanelManifest,
} from './dsl.ts'
export {
  renderManifest,
  renderNode,
  PANEL_COMPONENT_RENDERERS,
  type PanelComponentRenderer,
  pathGet,
  pathSet,
  sectionBindingOf,
  recordsAtPath,
  applyDesignEditToDraft,
  applyPanelUpdatesToDraft,
  readResidueEnvelope,
  type DesignData,
  type DesignEdit,
  type RenderOptions,
  type SectionBinding,
  type ResidueEnvelope,
  type ResidueSyncRef,
  type ResidueSyncProjection,
  type ResidueRecord,
  type ResidueAddSection,
} from './interpreter.ts'
export {
  StandardQuestionList,
  StandardQuestionWorkspace,
  standardQuestionAnswered,
  standardQuestionSummary,
  type StandardQuestionChoice,
  type StandardQuestionItem,
  type StandardQuestionKind,
  type StandardQuestionLabels,
  type StandardQuestionListProps,
  type StandardQuestionGroup,
  type StandardQuestionWorkspaceProps,
} from './question-list.tsx'
export {
  PanelWorkspace,
  PanelWorkspaceNavigation,
  PanelWorkspaceTip,
  type PanelWorkspaceNavItem,
} from './panel-workspace.tsx'
export {
  QuestionAttachments,
  QUESTION_MAX_ATTACHMENTS,
  QUESTION_MAX_ATTACHMENT_BYTES,
  type StandardQuestionAttachment,
} from './question-attachments.tsx'
export {
  clarityIndex,
  isClarityAssessment,
  parseClarityView,
  CLARITY_WEIGHTS,
  type DesignClarityAssessment,
  type DesignClarityView,
} from './client/clarity.ts'
/** Browser dock action-bar clarity readout, exported here for node-side acceptance smokes. */
export { ClarityDockReadout } from './client/clarity-dock.tsx'
/** Pending human-review advisory card + pure selection/delivery helpers. */
export {
  AdvisoryReviewCard,
  adjacentAdvisoryIndex,
  resolveAdvisoryExpandedRect,
  resolveAdvisoryIndex,
  selectPendingAdvisories,
  deliverAdvisoryAcceptance,
  completeAdvisoryAcceptance,
  renderAdvisoryAcceptancePrompt,
  type AdvisoryCardItem,
  type AdvisoryCardView,
  type AdvisoryEntryStatus,
  type AdvisoryReviewEntry,
  type AdvisoryDismissDecision,
  type AdvisoryAcceptanceResult,
  type AdvisoryAcceptanceAuthority,
  type AdvisoryActionReceipt,
  type AdvisoryExecutionStatus,
  type AdvisoryLayoutRect,
  type AdvisoryExpandedRect,
  type IAdvisoryReviewCardProps,
} from './client/ported/design/AdvisoryReviewCard.tsx'
/** Persistent sidebar advisory entry + current pending-count helper. */
export {
  AdvisorySidebarEntry,
  pendingAdvisoryCount,
  type AdvisorySidebarEntryProps,
} from './client/advisory-sidebar-entry.tsx'
export {
  designProjectRecoveryCommand,
  DesignProjectSidebarEntry,
  sortDesignProjectsNewestFirst,
  type DesignProjectSidebarEntryProps,
} from './client/design-project-sidebar-entry.tsx'
export { workspacePollAdmission, type WorkspacePollAdmission } from './client/workspace-poll-policy.ts'
export {
  cancelPendingDesignNextStepQuestion,
  DESIGN_NEXT_STEP_QUESTION_ID,
  type PendingInteractionSource,
} from './client/next-step-question.ts'
/** Cross-panel navigation guard (pure; node-testable). */
export { canNavigate } from './client/navigation.ts'
/** Native panel registry + presentation resolution (node-testable; no browser APIs). */
export {
  NativePanelRegistry,
  panelPresentation,
  panelScrollOwner,
  prepareDeclarativePanelSave,
  type NativePanelDefinition,
  type NativePanelMetadata,
  type NativePanelFeatureEntry,
  type PanelPresentation,
} from './client/native-panel-registry.ts'
/** Automatic host-layout sizing when a Design File opens the primary workspace. */
export {
  automaticDesignDockWidth,
  clampDesignDockWidth,
  COLLAPSED_NAV_WIDTH,
  CONVERSATION_MIN_WIDTH,
  DESIGN_DOCK_MIN_WIDTH,
  DESIGN_DOCK_RATIO,
} from './client/dock-layout.ts'
/** Native composer continuation bar, exported here for node-side acceptance smokes. */
export {
  continuationDismissKey,
  continuationLabelOf,
  continuationSkillTitleOf,
  DesignContinuationBar,
  designContinuationOf,
  type IDesignContinuationBarProps,
} from './client/design-continuation-bar.tsx'
/** Session-attributed Design dock state (node-testable; no browser APIs). */
export {
  activateDesignDockSession,
  currentDockSession,
  rail,
  setDockWidthClamp,
  setRailWidth,
  setSessionDockOpen,
  type DockTransient,
  type RailState,
} from './client/dock-session-state.ts'
