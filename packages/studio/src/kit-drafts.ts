/** Kit-owned working-copy edits over retained source; never catalog publication. */
import { resolve } from 'node:path'
import { loadStudioKit } from './load.ts'
import { knowledgeDeclarationWarnings } from './validate.ts'
import { prepareStudioPanelPreview, type StudioPanelPreviewResult } from './panel-preview.ts'
import type { StudioDraftSources, StudioSourceSnapshot } from './panel-drafts.ts'
import type { DesignBundleVersionPin, DesignKitVersionPin, StudioReadFs, StudioValidationReport } from './types.ts'

export interface StudioKitDraftContent {
  readonly baseKit: DesignKitVersionPin
  readonly baseSnapshot: string
  /** Exact immutable mounts. Bundle working copies are edited independently. */
  readonly mounts: readonly DesignBundleVersionPin[]
  readonly mindsetSource: string
  /** null removes the optional Kit-owned relation vocabulary. */
  readonly relationsSource: string | null
  readonly confirmed: boolean
}
export interface StudioKitDraftRecord extends StudioKitDraftContent {
  readonly id: string
  readonly revision: number
}
export interface StudioKitDraftRepository {
  create(content: StudioKitDraftContent): Promise<StudioKitDraftRecord>
  read(id: string): Promise<StudioKitDraftRecord>
  list(): Promise<readonly StudioKitDraftRecord[]>
  /** Atomic CAS across writers; conflicts and confirmed records must not be overwritten. */
  replace(id: string, expectedRevision: number, content: StudioKitDraftContent): Promise<StudioKitDraftRecord>
}
export interface StudioKitDraftEdit {
  readonly id: string
  readonly expectedRevision: number
  readonly mindsetSource: string
  readonly relationsSource: string | null
}
export interface StudioKitDraftValidation extends StudioValidationReport {
  readonly revision: number
  /** A candidate identity, not a published/catalog-resolvable version. */
  readonly candidateKit?: DesignKitVersionPin
}

function checkText(mindset: string, relations: string | null): void {
  if (typeof mindset !== 'string' || (relations !== null && typeof relations !== 'string')
    || new TextEncoder().encode(mindset).length > 1_048_576
    || (relations !== null && new TextEncoder().encode(relations).length > 1_048_576)) {
    throw new Error('Kit-owned sources must be UTF-8 text of at most 1 MiB each.')
  }
}
function checkRevision(current: StudioKitDraftRecord, expected: number): void {
  if (!Number.isSafeInteger(expected) || current.revision !== expected) throw new Error('Draft changed elsewhere. Reopen the latest revision.')
}
function content(record: StudioKitDraftRecord): StudioKitDraftContent {
  const { id: _id, revision: _revision, ...value } = record
  return structuredClone(value)
}
function samePins(a: readonly DesignBundleVersionPin[], b: readonly DesignBundleVersionPin[]): boolean {
  const keys = (pins: readonly DesignBundleVersionPin[]) => pins.map(pin => `${pin.name}@${pin.version}`).sort()
  return JSON.stringify(keys(a)) === JSON.stringify(keys(b))
}

/** Only two Kit-owned files are overlaid; no user-supplied paths or live FS fallback. */
function overlay(snapshot: StudioSourceSnapshot, record: StudioKitDraftContent): StudioReadFs {
  const root = resolve(snapshot.root)
  const replacements = new Map([
    [resolve(root, 'mindset.md'), record.mindsetSource],
    [resolve(root, 'relations.yaml'), record.relationsSource],
  ])
  return {
    readText: path => replacements.has(resolve(path)) ? Promise.resolve(replacements.get(resolve(path)) ?? undefined) : snapshot.fs.readText(path),
    ...(snapshot.fs.readResource ? { readResource: async (path: string) => {
      if (!replacements.has(resolve(path))) return snapshot.fs.readResource!(path)
      const content = replacements.get(resolve(path))
      return content == null ? undefined : { kind: 'text' as const, content }
    } } : {}),
    async listDir(path) {
      if (resolve(path) !== root) return snapshot.fs.listDir(path)
      const entries = new Set(await snapshot.fs.listDir(path))
      entries.add('mindset.md')
      if (record.relationsSource === null) entries.delete('relations.yaml')
      else entries.add('relations.yaml')
      return [...entries].sort()
    },
    ...(snapshot.fs.isDirectory ? { isDirectory: (path: string) => replacements.has(resolve(path)) ? Promise.resolve(false) : snapshot.fs.isDirectory!(path) } : {}),
    // The retained snapshot port has already rejected links; an added relation file
    // is virtual and need not exist in the host filesystem.
    ...(snapshot.fs.realPath ? { realPath: (path: string) => replacements.has(resolve(path)) ? Promise.resolve(resolve(path)) : snapshot.fs.realPath!(path) } : {}),
  }
}

export class StudioKitDraftService {
  constructor(private readonly repository: StudioKitDraftRepository, private readonly sources: StudioDraftSources) {}

  async list(): Promise<readonly Pick<StudioKitDraftRecord, 'id' | 'revision' | 'baseKit' | 'confirmed'>[]> {
    return (await this.repository.list()).map(({ id, revision, baseKit, confirmed }) => ({ id, revision, baseKit: { ...baseKit }, confirmed }))
  }
  async read(id: string): Promise<StudioKitDraftRecord> { return structuredClone(await this.repository.read(id)) }

  async create(input: { kit: DesignKitVersionPin }): Promise<StudioKitDraftRecord> {
    const pin = { ...input.kit }
    const snapshot = await this.sources.capture(pin)
    return this.createRetained(snapshot, pin)
  }

  /** Adopt retained, independently validated content; never resolve an installed pin. */
  async createFromSnapshot(input: { snapshotId: string; kit: DesignKitVersionPin }): Promise<StudioKitDraftRecord> {
    const pin = { ...input.kit }, snapshotId = input.snapshotId
    return this.createRetained(await this.sources.open(snapshotId), pin)
  }

  private async createRetained(snapshot: StudioSourceSnapshot, pin: DesignKitVersionPin): Promise<StudioKitDraftRecord> {
    const kit = await loadStudioKit(snapshot.fs, snapshot.root, snapshot.loadOptions)
    if (kit.name !== pin.name || String(kit.version) !== pin.version) throw new Error('Source does not match the selected Kit pin.')
    const mindsetSource = await snapshot.fs.readText(resolve(snapshot.root, 'mindset.md'))
    if (mindsetSource === undefined) throw new Error('Kit Mindset source is missing.')
    const relationsSource = await snapshot.fs.readText(resolve(snapshot.root, 'relations.yaml')) ?? null
    checkText(mindsetSource, relationsSource)
    return this.repository.create({ baseKit: pin, baseSnapshot: snapshot.id,
      mounts: kit.skills.map(bundle => ({ name: bundle.name, version: String(bundle.version) })),
      mindsetSource, relationsSource, confirmed: false })
  }

  /** Invalid intermediate edits can be retained, but cannot be confirmed. */
  async save(input: StudioKitDraftEdit): Promise<StudioKitDraftRecord> {
    const { id, expectedRevision, mindsetSource, relationsSource } = input
    checkText(mindsetSource, relationsSource)
    const current = await this.read(id)
    checkRevision(current, expectedRevision)
    if (current.confirmed) throw new Error('Confirmed Kit draft is locked. Fork it to continue editing.')
    return this.repository.replace(id, expectedRevision, { ...content(current), mindsetSource, relationsSource })
  }

  private async compile(current: StudioKitDraftRecord) {
    checkText(current.mindsetSource, current.relationsSource)
    const snapshot = await this.sources.open(current.baseSnapshot)
    const base = await loadStudioKit(snapshot.fs, snapshot.root, snapshot.loadOptions)
    if (base.name !== current.baseKit.name || String(base.version) !== current.baseKit.version
      || !samePins(current.mounts, base.skills.map(bundle => ({ name: bundle.name, version: String(bundle.version) })))) {
      throw new Error('Retained source does not match the working-copy base and mount pins.')
    }
    const fs = overlay(snapshot, current)
    const candidate = await loadStudioKit(fs, snapshot.root, snapshot.loadOptions)
    if (!samePins(current.mounts, candidate.skills.map(bundle => ({ name: bundle.name, version: String(bundle.version) })))) {
      throw new Error('Bundle mounts are read-only in this editor. Use an explicit catalog mount operation.')
    }
    return { snapshot, fs, candidate }
  }

  async validate(input: { id: string; expectedRevision: number }): Promise<StudioKitDraftValidation> {
    const { id, expectedRevision } = input
    const current = await this.read(id)
    checkRevision(current, expectedRevision)
    try {
      const { candidate } = await this.compile(current)
      return { valid: true, diagnostics: knowledgeDeclarationWarnings(candidate.skills), revision: current.revision, candidateKit: { name: candidate.name, version: String(candidate.version) } }
    } catch (error) {
      return { valid: false, revision: current.revision, diagnostics: [{ code: 'kit_draft.definition', message: error instanceof Error ? error.message : String(error) }] }
    }
  }

  async preview(input: { id: string; expectedRevision: number; bundle: DesignBundleVersionPin; sampleSource: string }): Promise<StudioPanelPreviewResult> {
    const { id, expectedRevision, sampleSource } = input
    const bundle = { ...input.bundle }
    const current = await this.read(id)
    checkRevision(current, expectedRevision)
    try {
      const { fs, snapshot, candidate } = await this.compile(current)
      if (!current.mounts.some(pin => pin.name === bundle.name && pin.version === bundle.version)) throw new Error('Select an exact mounted Bundle.')
      const mounted = candidate.skills.find(skill => skill.name === bundle.name && String(skill.version) === bundle.version)
      const panelSource = await fs.readText(resolve(mounted?.resourceRoot ?? resolve(snapshot.root, 'skills', bundle.name), 'panel.yaml'))
      if (panelSource === undefined) throw new Error('This Bundle has no declarative Panel preview.')
      return prepareStudioPanelPreview(fs, snapshot.root, { kit: { name: candidate.name, version: String(candidate.version) }, bundle,
        revision: current.revision, panelSource, sampleSource }, snapshot.loadOptions)
    } catch (error) {
      return { diagnostics: [{ code: 'kit_draft.preview', message: error instanceof Error ? error.message : String(error) }] }
    }
  }

  async confirm(input: { id: string; expectedRevision: number }): Promise<StudioKitDraftValidation & { draft?: StudioKitDraftRecord }> {
    const { id, expectedRevision } = input
    const current = await this.read(id)
    checkRevision(current, expectedRevision)
    const result = await this.validate({ id, expectedRevision })
    if (!result.valid) return result
    const draft = current.confirmed ? current : await this.repository.replace(id, expectedRevision, { ...content(current), confirmed: true })
    return { ...result, draft }
  }

  async fork(id: string): Promise<StudioKitDraftRecord> {
    return this.repository.create({ ...content(await this.read(id)), confirmed: false })
  }
}
