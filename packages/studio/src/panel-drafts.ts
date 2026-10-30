/** Retained source and historical Panel-trial record contracts. */
import type { StudioKitLoadOptions } from './load.ts'
import type { DesignBundleVersionPin, DesignKitVersionPin, StudioReadFs } from './types.ts'

export interface StudioPanelDraftContent {
  readonly kit: DesignKitVersionPin
  readonly bundle: DesignBundleVersionPin
  readonly baseSnapshot: string
  readonly panelSource: string
  readonly sampleSource: string
  /** Historical metadata only; never used to lock current authoring. */
  readonly confirmed?: boolean
}
export interface StudioPanelDraftRecord extends StudioPanelDraftContent {
  readonly id: string
  readonly revision: number
}
export type StudioPanelDraftSummary = Pick<StudioPanelDraftRecord, 'id' | 'revision' | 'kit' | 'bundle' | 'confirmed'>
export interface StudioPanelDraftRepository {
  read(id: string): Promise<StudioPanelDraftRecord>
  list(): Promise<readonly StudioPanelDraftRecord[]>
}
export interface StudioSourceSnapshot {
  readonly id: string
  readonly fs: StudioReadFs
  readonly root: string
  /** Bounded closure root; the Kit and independently retained Bundles may be siblings. */
  readonly storageRoot?: string
  readonly loadOptions?: StudioKitLoadOptions
}
export interface StudioDraftSources {
  /** Host captures complete current installed source bytes for an isolated Bundle trial. */
  capture(kit: DesignKitVersionPin): Promise<StudioSourceSnapshot>
  open(id: string): Promise<StudioSourceSnapshot>
}
