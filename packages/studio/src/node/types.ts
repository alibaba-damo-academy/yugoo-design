/** Public contracts for the optional Node adapter; no Host or browser coupling. */
import type { StudioPanelPreviewResult } from '../panel-preview.ts'
import type { StudioDraftSources, StudioPanelDraftRepository, StudioSourceSnapshot } from '../panel-drafts.ts'
import type { DesignBundleVersionPin, DesignKitVersionPin } from '../types.ts'
import type { StudioInstanceCandidate, StudioInstanceChangeRequest, StudioInstanceChangeReceipt, StudioInstanceFileChange, StudioInstanceSaveChanges } from '../instance-changes.ts'
import type { StudioContentArchive } from '../content-archive.ts'

export type StudioAwaitable<T> = T | Promise<T>
export interface StudioSourceEntry { readonly path: string; readonly base64: string }
export interface StudioDisplayTitle { readonly zh: string; readonly en: string }
export interface StudioRetainedSource { readonly snapshot: string; readonly sourceId: string }
export interface StudioInstalledKitCapture {
  readonly name: string
  readonly version: string | number
  readonly sourceRoot?: string
  readonly skills?: readonly { readonly name: string; readonly version: string | number; readonly catalogName?: string; readonly resourceRoot?: string }[]
}
export interface StudioNodeStorageOptions {
  /** Trusted Host adapter; defaults to the cross-platform system trash implementation. */
  readonly moveToTrash?: (file: string) => Promise<void>
  /** Absolute, host-selected state directory; never an installed source root. */
  readonly stateRoot: string
  readonly kitRoot?: string
  readonly readInstalledKit?: () => StudioAwaitable<StudioInstalledKitCapture>
  readonly readInstalledBundle?: (pin: DesignBundleVersionPin) => StudioAwaitable<{ readonly resourceRoot?: string; readonly sourceId?: string } | undefined>
}
export interface StudioInstalledStorageOptions extends StudioNodeStorageOptions {
  readonly kitRoot: string
  readonly readInstalledKit: () => StudioAwaitable<StudioInstalledKitCapture>
}
export type StudioNodeDraftSources = StudioDraftSources
export interface StudioPanelDraftPorts { readonly repository: StudioPanelDraftRepository; readonly sources: StudioNodeDraftSources }

export interface StudioInstanceMount {
  readonly bindingKey?: string
  readonly bundle: DesignBundleVersionPin & { readonly source?: StudioRetainedSource; readonly instanceId?: string; readonly revision?: number }
  /** Retained legacy record fields, consumed only by explicit migration. */
  readonly instanceId?: string
  readonly revision?: number
}
export interface StudioInstanceStoredRecord {
  readonly id: string
  readonly revision: number
  readonly recordVersion?: 1 | 2
  readonly kind: 'kit' | 'bundle'
  readonly title: StudioDisplayTitle
  readonly source: { readonly kit?: DesignKitVersionPin; readonly bundle?: DesignBundleVersionPin }
  readonly kit?: DesignKitVersionPin
  readonly bundle?: DesignBundleVersionPin
  readonly runtimeName?: string
  readonly sourceId?: string
  readonly baseSnapshot: string
  readonly overlays: Readonly<Record<string, string>>
  readonly mounts: readonly StudioInstanceMount[]
  readonly current?: boolean
  /** Provenance of an unfinished source authoring template; not definition validity. */
  readonly createdBlank?: boolean
  /** Original imported bytes retained by the existing S2 snapshot store. */
  readonly importedFromSnapshot?: string
  readonly createdAt?: string
  readonly deletedAt?: string
  readonly bundlePath?: string
  readonly forkedFrom?: { readonly id: string; readonly revision: number; readonly pin: DesignBundleVersionPin | DesignKitVersionPin }
  readonly migration?: { readonly fromRevision: number; readonly fromSnapshot: string }
}
export type StudioInstanceContent = Omit<StudioInstanceStoredRecord, 'id' | 'revision'>
export interface StudioInstanceTransaction {
  read(id: string): Promise<StudioInstanceStoredRecord>
  list(): Promise<readonly StudioInstanceStoredRecord[]>
  create(content: StudioInstanceContent): Promise<StudioInstanceStoredRecord>
  replace(id: string, expectedRevision: number, content: StudioInstanceContent): Promise<StudioInstanceStoredRecord>
  retainTree(entries: readonly StudioSourceEntry[]): Promise<StudioSourceSnapshot>
  migrate(id: string, expectedRevision: number, content: StudioInstanceContent): Promise<StudioInstanceStoredRecord>
}
export interface StudioInstanceRepository extends Omit<StudioInstanceTransaction, 'retainTree' | 'migrate'> {
  /** Existing exclusive lock, not a multi-record rollback or publication transaction. */
  transaction<T>(operation: (transaction: StudioInstanceTransaction) => Promise<T>): Promise<T>
}
export interface StudioInstanceDraftPorts {
  readonly repository: StudioInstanceRepository
  readonly sources: StudioNodeDraftSources & { retainTree(entries: readonly StudioSourceEntry[]): Promise<StudioSourceSnapshot> }
}
export interface StudioInstanceBundleChoice extends DesignBundleVersionPin {
  readonly title: StudioDisplayTitle
  readonly runtimeName: string
  /** Read-only picker copy from the existing Bundle source; never a mount pin. */
  readonly description?: string
  readonly displayDescription?: StudioDisplayTitle
  readonly instanceId?: string
  readonly revision?: number
}
export interface StudioInstanceDescription extends Omit<StudioInstanceStoredRecord, 'overlays' | 'importedFromSnapshot'> {
  /** Same-identity editable projection of a catalog source. */
  readonly current?: boolean
  readonly refs: readonly { readonly id: string; readonly title: StudioDisplayTitle }[]
  readonly readiness?: {
    readonly ready: boolean
    readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly path?: string; readonly severity?: 'error' | 'warning' }[]
  }
  readonly requiresMigration?: boolean
  readonly description?: string
  readonly displayDescription?: StudioDisplayTitle
  readonly files?: readonly { readonly path: string; readonly bytes: number; readonly editable: boolean }[]
  readonly availableBundles?: readonly StudioInstanceBundleChoice[]
}
export interface StudioBundleCapture { readonly files: readonly StudioSourceEntry[]; readonly sourceId: string }
export type StudioBundleResolver = (pin: DesignBundleVersionPin) => StudioAwaitable<StudioBundleCapture | undefined>
export interface StudioKitCompositionInput {
  readonly kit: DesignKitVersionPin
  readonly kitFiles: readonly StudioSourceEntry[]
  readonly mounts: readonly StudioInstanceMount[]
  readonly resolveBundle: StudioBundleResolver
}
export type StudioInstancePreviewInput = (
  { readonly kind: 'kit' } & StudioKitCompositionInput
  | { readonly kind: 'bundle'; readonly bundleFiles: readonly StudioSourceEntry[]; readonly runtimeName?: string; readonly sourceId: string }
) & { readonly bundle: DesignBundleVersionPin; readonly revision: number; readonly sampleSource?: string }
export interface StudioInstanceCatalog {
  listBundles(): Promise<readonly StudioInstanceBundleChoice[]>
  captureBundle(pin: DesignBundleVersionPin): Promise<StudioBundleCapture & Pick<StudioInstanceBundleChoice, 'title' | 'runtimeName' | 'description' | 'displayDescription'>>
  captureKit(pin: DesignKitVersionPin): Promise<{ readonly files: readonly StudioSourceEntry[]; readonly title?: StudioDisplayTitle; readonly mounts: readonly (DesignBundleVersionPin & { readonly bindingKey: string })[] }>
}
export interface StudioInstanceComposition {
  loadKit?(input: StudioKitCompositionInput): Promise<import('dsh-design-core').DesignKit>
  forkBundle(input: { readonly files: readonly StudioSourceEntry[]; readonly from: DesignBundleVersionPin; readonly to: DesignBundleVersionPin; readonly runtimeName: string }): Promise<readonly StudioSourceEntry[]>
  /** Draft projection is allowed for Node-owned blank sources and still-incomplete imported Kits. */
  projectMounts(input: { readonly allowEmptyDraft?: boolean; readonly kit: DesignKitVersionPin; readonly kitFiles: readonly StudioSourceEntry[]; readonly mounts: readonly (DesignBundleVersionPin & { readonly bindingKey: string })[]; readonly resolveBundle?: StudioBundleResolver }): Promise<readonly StudioSourceEntry[]>
  /** Partial source import; identity projection does not validate or grant execution. */
  projectSourceIdentity?(input: { readonly kind: 'kit' | 'bundle'; readonly files: readonly StudioSourceEntry[]; readonly identity: DesignBundleVersionPin | DesignKitVersionPin }): StudioAwaitable<readonly StudioSourceEntry[]>
  validateBundle?(input: { readonly bundle: DesignBundleVersionPin; readonly bundleFiles: readonly StudioSourceEntry[]; readonly sourceId: string; readonly runtimeName: string }): Promise<void>
  validateKit(input: StudioKitCompositionInput): Promise<void>
  preview?(input: StudioInstancePreviewInput): Promise<StudioPanelPreviewResult>
}
export interface StudioInstanceTrustedCaptures {
  listBundles(): StudioAwaitable<readonly DesignBundleVersionPin[]>
  captureBundle(pin: DesignBundleVersionPin): StudioAwaitable<StudioBundleCapture>
  captureKit(pin: DesignKitVersionPin): StudioAwaitable<{ readonly files: readonly StudioSourceEntry[]; readonly title?: StudioDisplayTitle }>
  preview?(input: StudioInstancePreviewInput): StudioAwaitable<StudioPanelPreviewResult>
}
export interface StudioInstanceAdapters { readonly catalog: StudioInstanceCatalog; readonly composition: StudioInstanceComposition }
export interface StudioInstancesOptions extends StudioNodeStorageOptions, StudioInstanceAdapters {}
export interface StudioInstanceArchiveRequest {
  readonly id: string
  readonly expectedRevision: number
  readonly provenance?: StudioContentArchive['provenance']
  readonly dependencies?: readonly DesignBundleVersionPin[]
}
export interface StudioInstanceCopyRequest {
  readonly kind: 'kit' | 'bundle'
  readonly kit?: DesignKitVersionPin
  readonly bundle?: DesignBundleVersionPin
  readonly sourceId?: string
  readonly expectedRevision?: number
  readonly title?: StudioDisplayTitle
}
export interface StudioInstanceRevision { readonly id: string; readonly expectedRevision: number }
export interface StudioInstanceReadFile { readonly id: string; readonly revision: number; readonly path: string; readonly content: string }
export type StudioSourceReadFile = { readonly path: string; readonly exists: false } | { readonly path: string; readonly exists: true; readonly content: string }
export interface StudioSourceFileInfo { readonly path: string; readonly bytes: number; readonly readable: boolean }
export interface StudioMountedBundleReadRequest extends StudioInstanceRevision {
  readonly bindingKey: string
  /** Omit to discover files without reading their content. */
  readonly paths?: readonly string[]
}
export interface StudioMountedBundleRead {
  readonly id: string
  readonly revision: number
  readonly bindingKey: string
  readonly bundle: DesignBundleVersionPin
  readonly sourceId: string
  readonly readOnly: true
  readonly availableFiles: readonly StudioSourceFileInfo[]
  readonly files: readonly StudioSourceReadFile[]
}
export interface StudioInstanceImportRequest {
  readonly kind: 'kit' | 'bundle'
  readonly files: readonly StudioSourceEntry[]
  readonly title?: StudioDisplayTitle
}
export interface StudioInstances {
  editCurrent(input: { readonly kind: 'kit' | 'bundle'; readonly kit?: DesignKitVersionPin; readonly bundle?: DesignBundleVersionPin }): Promise<StudioInstanceDescription>
  captureKit(input: { readonly id: string; readonly expectedRevision?: number }): Promise<StudioKitCompositionInput>
  loadKit(input: { readonly id: string; readonly expectedRevision?: number }): Promise<import('dsh-design-core').DesignKit>
  importSources(input: StudioInstanceImportRequest): Promise<StudioInstanceDescription>
  create(input: { readonly kind: 'kit' | 'bundle'; readonly title: StudioDisplayTitle }): Promise<StudioInstanceDescription>
  read(input: string | { readonly id: string }): Promise<StudioInstanceDescription>
  /** Metadata-only discovery may omit readiness validation; loading still checks definitions. */
  list(input?: { readonly kind?: 'kit' | 'bundle'; readonly includeReadiness?: boolean }): Promise<readonly StudioInstanceDescription[]>
  listBundles(): Promise<readonly StudioInstanceBundleChoice[]>
  copy(input: StudioInstanceCopyRequest): Promise<StudioInstanceDescription>
  rename(input: StudioInstanceRevision & { readonly title: StudioDisplayTitle }): Promise<StudioInstanceDescription>
  remove(input: StudioInstanceRevision): Promise<{ readonly id: string; readonly revision: number; readonly trashed: true }>
  readFile(input: { readonly id: string; readonly path: string }): Promise<StudioInstanceReadFile>
  readMountedBundle(input: StudioMountedBundleReadRequest): Promise<StudioMountedBundleRead>
  saveFile(input: StudioInstanceRevision & { readonly path: string; readonly content: string }): Promise<StudioInstanceDescription>
  exportArchive(input: StudioInstanceArchiveRequest): Promise<string>
  prepareChanges(input: StudioInstanceChangeRequest): Promise<StudioInstanceCandidate>
  saveChanges(input: StudioInstanceSaveChanges): Promise<StudioInstanceDescription & { readonly changeReceipt: StudioInstanceChangeReceipt }>
  updateMounts(input: StudioInstanceRevision & { readonly bundles: readonly (DesignBundleVersionPin & { readonly bindingKey?: string; readonly instanceId?: string; readonly revision?: number })[] }): Promise<StudioInstanceDescription>
  preview(input: StudioInstanceRevision & { readonly bundle?: DesignBundleVersionPin; readonly sampleSource?: string }): Promise<StudioPanelPreviewResult>
  migrate(input: StudioInstanceRevision): Promise<StudioInstanceDescription>
}

export interface StudioAuthoringScope extends StudioInstanceRevision {
  readonly allowedPaths: readonly string[]
  readonly bundle?: DesignBundleVersionPin
}
export interface StudioAuthoringComponentCatalog {
  readonly components: readonly { readonly name: string; readonly [key: string]: unknown }[]
  readonly [key: string]: unknown
}
export interface StudioAuthoringRecord {
  readonly id: string
  readonly revision: number
  readonly kind: 'kit' | 'bundle'
  readonly deletedAt?: string
  readonly bundle?: DesignBundleVersionPin
  readonly files?: readonly { readonly path: string; readonly bytes: number; readonly editable: boolean }[]
  readonly mounts?: readonly { readonly bindingKey?: string; readonly bundle: DesignBundleVersionPin }[]
}
export interface StudioAuthoringOptions {
  readonly scope: StudioAuthoringScope
  readonly instances: {
    read(input: { readonly id: string }): Promise<StudioAuthoringRecord>
    readFile(input: { readonly id: string; readonly path: string }): Promise<StudioInstanceReadFile>
    readMountedBundle?(input: StudioMountedBundleReadRequest): Promise<StudioMountedBundleRead>
    prepareChanges(input: StudioInstanceChangeRequest): Promise<StudioInstanceCandidate>
  }
  readonly readComponents: () => StudioAwaitable<StudioAuthoringComponentCatalog>
}
export type StudioAuthoringReplacement = StudioInstanceFileChange & { readonly content: string }
export interface StudioAuthoringRead {
  readonly paths?: readonly string[]
  readonly mount?: { readonly bindingKey: string; readonly paths?: readonly string[] }
}
export interface StudioAuthoring {
  read(input?: StudioAuthoringRead): Promise<{
    readonly scope: StudioAuthoringScope
    readonly files: readonly StudioSourceReadFile[]
    readonly components: StudioAuthoringComponentCatalog
    readonly availableFiles?: readonly StudioSourceFileInfo[]
    readonly mounts?: readonly { readonly bindingKey?: string; readonly bundle: DesignBundleVersionPin }[]
    readonly mountedBundle?: Omit<StudioMountedBundleRead, 'files'>
  }>
  prepare(input: { readonly changes: readonly StudioAuthoringReplacement[] }): Promise<{
    readonly scope: StudioAuthoringScope
    readonly components: StudioAuthoringComponentCatalog
    readonly request: StudioInstanceChangeRequest
    readonly candidate: StudioInstanceCandidate
  }>
}
