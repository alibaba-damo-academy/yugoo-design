/** Node plugin entry. Importing the Host must not load React or renderer peers. */
import type { Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'
import { attachPackagedCssAssetRoutes } from '../../../scripts/css-asset-host.mjs'

export const name = 'dsh-design-panel'

/** Attach the optional HTTP carrier under its owning service lifecycle. */
export function apply(ctx: Context): void {
  attachPackagedCssAssetRoutes(ctx, fileURLToPath(new URL('.', import.meta.url)), [
    '/design-system-assets/dsh-design-panel-renderer/',
    '/design-system-assets/dsh-design-panel-client/',
    '/design-system-assets/dsh-design-panel-sample-preview/',
  ])
}

// Preserve the Host-side compiler and pure helpers. Rendering is an explicit
// ./ui or ./interpreter import; the installed browser plugin remains ./client.
export {
  parsePanelManifest, validatePanelManifest, PANEL_KINDS, COMPONENT_KINDS,
  PANEL_COMPONENT_CATALOG, describePanelComponents, CONTROL_KINDS, ROW_COLUMN_CONTROLS,
  type PanelKind, type ComponentKind, type ControlKind, type RowColumnControl,
  type PanelSectionRef, type FieldOption, type RowColumn, type PanelSection,
  type EditorField, type ComponentNode, type PanelManifest,
} from './dsl.ts'
export { pathGet, pathSet, sectionBindingOf, recordsAtPath, applyDesignEditToDraft, applyPanelUpdatesToDraft, type DesignData, type DesignEdit, type SectionBinding } from './record-state.ts'
export { QUESTION_MAX_ATTACHMENTS, QUESTION_MAX_ATTACHMENT_BYTES, type StandardQuestionAttachment } from './question-attachment-contract.ts'
export { clarityIndex, isClarityAssessment, parseClarityView, CLARITY_WEIGHTS, type DesignClarityAssessment, type DesignClarityView } from './client/clarity.ts'
export { workspacePollAdmission, type WorkspacePollAdmission } from './client/workspace-poll-policy.ts'
export { cancelPendingDesignNextStepQuestion, DESIGN_NEXT_STEP_QUESTION_ID, type PendingInteractionSource } from './client/next-step-question.ts'
export { canNavigate } from './client/navigation.ts'
export { NativePanelRegistry, panelPresentation, panelScrollOwner, prepareDeclarativePanelSave, type NativePanelDefinition, type NativePanelMetadata, type NativePanelFeatureEntry, type PanelPresentation } from './client/native-panel-registry.ts'
export { automaticDesignDockWidth, clampDesignDockWidth, COLLAPSED_NAV_WIDTH, CONVERSATION_MIN_WIDTH, DESIGN_DOCK_MIN_WIDTH, DESIGN_DOCK_RATIO } from './client/dock-layout.ts'
export { activateDesignDockSession, currentDockSession, rail, setDockWidthClamp, setRailWidth, setSessionDockOpen, type DockTransient, type RailState } from './client/dock-session-state.ts'
