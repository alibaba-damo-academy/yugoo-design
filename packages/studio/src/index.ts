/**
 * dsh-design-studio: host-neutral Design Studio domain.
 *
 * Inspects installed Design Kits and Bundles: the compiled catalog workspace,
 * exact Kit source workspaces, and real Bundle source files with
 * loader-compiled summaries. Pure domain library: no Agent Host, Cordis,
 * session, or `node:fs` coupling; the Design Core loader and validation remain
 * the single Kit/Bundle authority. Drafts use separate injected persistence.
 */
export type {
  DesignBundleVersionPin,
  DesignKitVersionPin,
  StudioDiagnostic,
  StudioReadFs,
  StudioValidationReport,
} from './types.ts'
export { StudioBinaryContentError } from './types.ts'
export type {
  DesignBundleSnapshot,
  DesignCatalogSnapshot,
  DesignKitSnapshot,
  StudioCatalogSnapshotPort,
} from './snapshot.ts'
export { snapshotKit } from './snapshot.ts'
export { loadStudioKit } from './load.ts'
export { validateBundle, validateKit } from './validate.ts'
export { prepareStudioPanelPreview } from './panel-preview.ts'
export type { StudioPanelPreviewRequest, StudioPanelPreview, StudioPanelPreviewResult } from './panel-preview.ts'
export { exportStudioContentArchive, exportStudioSourceArchive, readStudioContentArchive } from './content-archive.ts'
export type { StudioArchivePin, StudioArchiveFile, StudioContentArchive, StudioArchiveSource } from './content-archive.ts'
export type { StudioPanelDraftContent, StudioPanelDraftRecord, StudioPanelDraftSummary, StudioPanelDraftRepository, StudioDraftSources, StudioSourceSnapshot } from './panel-drafts.ts'
export type {
  StudioBundleView,
  StudioBundleMountView,
  StudioKitView,
  StudioKitWorkspaceResult,
  StudioKitWorkspaceView,
  StudioManagementFailure,
  StudioResourceRefView,
  StudioRelationView,
  StudioRelationVocabularyView,
  StudioWorkspaceView,
} from './management.ts'
export { StudioManagementService } from './management.ts'
export type {
  StudioBundleVersionEntry,
  StudioCompositionCatalog,
} from './composition.ts'
export {
  buildStudioCompositionCatalog,
  searchStudioBundles,
} from './composition.ts'
export type {
  StudioBundleFileRefView,
  StudioBundleFileResult,
  StudioBundleFileView,
  StudioBundlePanelView,
  StudioBundleSourcePort,
  StudioBundleValidationSummary,
  StudioBundleWorkspaceResult,
  StudioBundleWorkspaceView,
} from './bundle-source.ts'
export { StudioBundleSourceService } from './bundle-source.ts'
export { normalizeStudioInstanceChanges, STUDIO_INSTANCE_CHANGE_LIMITS } from './instance-changes.ts'
export type { StudioInstanceFileChange, StudioInstanceChangeRequest, StudioInstanceFileDiff, StudioInstanceCandidate, StudioInstanceSaveChanges, StudioInstanceChangeReceipt } from './instance-changes.ts'
