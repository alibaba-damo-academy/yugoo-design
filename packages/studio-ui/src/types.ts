/** Transport-neutral client and outcome types consumed by the shared Studio UI. */
import type {
  StudioBundleFileResult,
  StudioBundleWorkspaceResult,
  StudioKitWorkspaceResult,
  StudioManagementFailure,
  StudioWorkspaceView,
} from 'dsh-design-studio'

/** UI name for the canonical management failure. */
export type StudioClientFailure = StudioManagementFailure

/** Shared read-only service API implemented by embedded and companion host adapters. */
export interface StudioManagementClient {
  readKitFiles?(input: { name: string; version: string }): Promise<readonly string[]>
  readKitFile?(input: { name: string; version: string; path: string }): Promise<{ content: string }>
  /** Read the current JSON-only management workspace. */
  workspace(query: string): Promise<StudioWorkspaceView>
  /** Read one exact installed Kit version's workspace: complete raw mindset source plus read-only mounts. */
  readKitWorkspace(name: string, version: string): Promise<StudioKitWorkspaceResult>
  /** Read one Bundle's read-only source workspace: physical file tree plus compiled summaries. */
  readBundleWorkspace(name: string, version?: string): Promise<StudioBundleWorkspaceResult>
  /** Read one complete Bundle file byte-exactly as UTF-8 text. */
  readBundleFile(input: { name: string; path: string; version?: string }): Promise<StudioBundleFileResult>
}
