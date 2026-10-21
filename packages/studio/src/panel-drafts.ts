/** Host-neutral, versioned Panel working copies; not Kit publication. */
import { join } from 'node:path'
import { loadStudioKit, type StudioKitLoadOptions } from './load.ts'
import { prepareStudioPanelPreview, type StudioPanelPreviewResult } from './panel-preview.ts'
import type { DesignBundleVersionPin, DesignKitVersionPin, StudioReadFs } from './types.ts'

export interface StudioPanelDraftContent {
  readonly kit: DesignKitVersionPin
  readonly bundle: DesignBundleVersionPin
  readonly baseSnapshot: string
  readonly panelSource: string
  readonly sampleSource: string
  /** A confirmed snapshot is locked, but is NOT published into the Kit catalog. */
  readonly confirmed: boolean
}
export interface StudioPanelDraftRecord extends StudioPanelDraftContent {
  readonly id: string
  readonly revision: number
}
export type StudioPanelDraftSummary = Pick<StudioPanelDraftRecord, 'id' | 'revision' | 'kit' | 'bundle' | 'confirmed'>
export interface StudioPanelDraftRepository {
  create(content: StudioPanelDraftContent): Promise<StudioPanelDraftRecord>
  read(id: string): Promise<StudioPanelDraftRecord>
  list(): Promise<readonly StudioPanelDraftRecord[]>
  /** Atomic, cross-process CAS: must fail without writing if revision differs. */
  replace(id: string, expectedRevision: number, content: StudioPanelDraftContent): Promise<StudioPanelDraftRecord>
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
  /** Host resolves exact installed pin, captures all source bytes and retains them. */
  capture(kit: DesignKitVersionPin): Promise<StudioSourceSnapshot>
  open(id: string): Promise<StudioSourceSnapshot>
}
export interface StudioPanelDraftEdit {
  readonly id: string
  readonly expectedRevision: number
  readonly panelSource: string
  readonly sampleSource: string
}

function checkText(panelSource: string, sampleSource: string): void {
  if (typeof panelSource !== 'string' || typeof sampleSource !== 'string'
    || new TextEncoder().encode(panelSource).length > 1_048_576
    || new TextEncoder().encode(sampleSource).length > 262_144) {
    throw new Error('Panel source must be text ≤1 MiB; sample JSON text ≤256 KiB.')
  }
}
function checkRevision(record: StudioPanelDraftRecord, expected: number): void {
  if (!Number.isSafeInteger(expected) || record.revision !== expected) throw new Error('Draft changed elsewhere. Reopen the latest revision before saving.')
}
function content(record: StudioPanelDraftRecord): StudioPanelDraftContent {
  const { id: _id, revision: _revision, ...value } = record
  return value
}

/** Shared semantics used by host adapters; no filesystem or runtime tool access. */
export class StudioPanelDraftService {
  constructor(private readonly repository: StudioPanelDraftRepository, private readonly sources: StudioDraftSources) {}

  async list(): Promise<readonly StudioPanelDraftSummary[]> {
    return (await this.repository.list()).map(({ id, revision, kit, bundle, confirmed }) => ({ id, revision, kit, bundle, confirmed }))
  }
  read(id: string): Promise<StudioPanelDraftRecord> { return this.repository.read(id) }

  async create(input: { kit: DesignKitVersionPin; bundle: DesignBundleVersionPin; sampleSource?: string }): Promise<StudioPanelDraftRecord> {
    const kitPin = { ...input.kit }, bundlePin = { ...input.bundle }
    if (!/^[a-z][a-z0-9_]*$/.test(bundlePin.name)) throw new Error('Select an exact Bundle identity.')
    const sampleSource = input.sampleSource
    const snapshot = await this.sources.capture(kitPin)
    return this.createRetained(snapshot, kitPin, bundlePin, sampleSource)
  }

  /** Open only the retained snapshot; imported/template pins need not be installed. */
  async createFromSnapshot(input: { snapshotId: string; kit: DesignKitVersionPin; bundle: DesignBundleVersionPin; sampleSource?: string }): Promise<StudioPanelDraftRecord> {
    const kit = { ...input.kit }, bundle = { ...input.bundle }, sampleSource = input.sampleSource
    if (!/^[a-z][a-z0-9_]*$/.test(bundle.name)) throw new Error('Select an exact Bundle identity.')
    return this.createRetained(await this.sources.open(input.snapshotId), kit, bundle, sampleSource)
  }

  private async createRetained(snapshot: StudioSourceSnapshot, kitPin: DesignKitVersionPin, bundlePin: DesignBundleVersionPin, sampleSource?: string): Promise<StudioPanelDraftRecord> {
    const kit = await loadStudioKit(snapshot.fs, snapshot.root, snapshot.loadOptions)
    if (kit.name !== kitPin.name || String(kit.version) !== kitPin.version) throw new Error('Source does not match selected Kit pin.')
    const bundle = kit.skills.find(entry => entry.name === bundlePin.name && String(entry.version) === bundlePin.version)
    if (!bundle || typeof bundle.metadata?.panelYaml !== 'string') throw new Error('Select an installed declarative Bundle version.')
    const panelSource = await snapshot.fs.readText(join(bundle.resourceRoot ?? join(snapshot.root, 'skills', bundlePin.name), 'panel.yaml'))
    if (panelSource === undefined) throw new Error('Panel source is missing.')
    const panel = bundle.metadata.panelManifest as { initial_values?: Record<string, unknown> }
    const sample = sampleSource ?? JSON.stringify(panel.initial_values ?? {}, null, 2)
    checkText(panelSource, sample)
    return this.repository.create({ kit: kitPin, bundle: bundlePin, baseSnapshot: snapshot.id, panelSource, sampleSource: sample, confirmed: false })
  }

  /** Saving incomplete source is allowed; confirmation requires successful compilation. */
  async save(input: StudioPanelDraftEdit): Promise<StudioPanelDraftRecord> {
    const { id, expectedRevision, panelSource, sampleSource } = input
    checkText(panelSource, sampleSource)
    const current = await this.repository.read(id)
    checkRevision(current, expectedRevision)
    if (current.confirmed) throw new Error('Confirmed snapshot is locked. Create a new draft to edit it.')
    return this.repository.replace(id, expectedRevision, { ...content(current), panelSource, sampleSource })
  }

  /** Compile an unsaved editor revision without persisting or touching any project. */
  async preview(input: StudioPanelDraftEdit & { revision: number }): Promise<StudioPanelPreviewResult> {
    const { id, expectedRevision, panelSource, sampleSource, revision } = input
    checkText(panelSource, sampleSource)
    const current = await this.repository.read(id)
    checkRevision(current, expectedRevision)
    const snapshot = await this.sources.open(current.baseSnapshot)
    return prepareStudioPanelPreview(snapshot.fs, snapshot.root, {
      kit: current.kit, bundle: current.bundle, revision, panelSource, sampleSource,
    }, snapshot.loadOptions)
  }

  async confirm(input: { id: string; expectedRevision: number }): Promise<{ draft?: StudioPanelDraftRecord } & StudioPanelPreviewResult> {
    const { id, expectedRevision } = input
    const current = await this.repository.read(id)
    checkRevision(current, expectedRevision)
    const result = await this.preview({ ...current, expectedRevision })
    if (!result.preview || result.diagnostics.length) return result
    const draft = current.confirmed ? current : await this.repository.replace(id, expectedRevision, { ...content(current), confirmed: true })
    return { ...result, draft }
  }

  /** Start another editable revision, sharing the immutable base bytes. */
  async fork(id: string): Promise<StudioPanelDraftRecord> {
    const current = await this.repository.read(id)
    return this.repository.create({ ...content(current), confirmed: false })
  }
}
