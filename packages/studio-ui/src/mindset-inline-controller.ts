import type { DesignKitVersionPin, StudioKitDraftRecord } from 'dsh-design-studio'
import type { StudioKitAuthoringClient } from './KitDraftWorkbench.tsx'

export interface MindsetSegment { readonly protected: boolean; readonly text: string }

/** Slice original offsets; never trim, parse/re-serialize YAML, or discard prose. */
export function splitMindsetSource(source: string): readonly MindsetSegment[] {
  const segments: MindsetSegment[] = []
  let offset = 0
  if (/^(?:\uFEFF)?---(?:\r?\n|$)/.test(source)) {
    const opening = /^(?:\uFEFF)?---\r?\n/.exec(source)
    if (!opening) throw new Error('Incomplete Mindset frontmatter.')
    const end = /^---(?:\r?\n|$)/m.exec(source.slice(opening[0].length))
    if (!end) throw new Error('Incomplete Mindset frontmatter.')
    offset = opening[0].length + end.index + end[0].length
    segments.push({ protected: true, text: source.slice(0, offset) })
  }
  const body = source.slice(offset)
  const markers = [...body.matchAll(/<\/?design_skills\b[^>]*>/g)]
  if ([...body.matchAll(/<\/?design_skills\b/g)].length !== 2 || markers.length !== 2 || markers[0]?.[0] !== '<design_skills>' || markers[1]?.[0] !== '</design_skills>') {
    throw new Error('Mindset must have one unambiguous complete design_skills block; editing is unavailable.')
  }
  const start = offset + markers[0].index!, end = offset + markers[1].index! + markers[1][0].length
  segments.push({ protected: false, text: source.slice(offset, start) })
  segments.push({ protected: true, text: source.slice(start, end) })
  segments.push({ protected: false, text: source.slice(end) })
  return segments
}

type Client = Pick<StudioKitAuthoringClient, 'create' | 'read' | 'save'>
export interface MindsetInlineState {
  readonly editing: boolean
  readonly busy: boolean
  readonly dirty: boolean
  readonly unpublished: boolean
  readonly source: string
  readonly segments: readonly MindsetSegment[]
  readonly error?: string
}

/** A local editor session; persistence and concurrency remain the existing Kit service's authority. */
export class MindsetInlineController {
  private state: MindsetInlineState
  private record?: StudioKitDraftRecord
  private generation = 0
  private active = true
  private listeners = new Set<() => void>()
  private readonly kit: DesignKitVersionPin
  constructor(private client: Client, kit: DesignKitVersionPin, source: string, private onSource: (source: string) => void,
    private options: { initialId?: string; onRecord?: (record: StudioKitDraftRecord) => void } = {}) {
    this.kit = { ...kit }
    this.state = { editing: false, busy: false, dirty: false, unpublished: false, source, segments: [] }
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  activate() {
    const wasActive = this.active
    this.active = true
    // React 18 StrictMode may dispose/re-activate while the initial read is pending.
    if (!wasActive && this.state.busy) this.update({ busy: false })
  }
  dispose() { this.active = false; this.generation++; this.listeners.clear() }
  private update(patch: Partial<MindsetInlineState>) {
    if (!this.active) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  private check(record: StudioKitDraftRecord) {
    if (!record.id || !Number.isSafeInteger(record.revision) || record.revision < 0 || !record.baseSnapshot
      || record.baseKit.name !== this.kit.name || record.baseKit.version !== this.kit.version || record.confirmed) {
      throw new Error('Mindset draft identity mismatched or locked.')
    }
    splitMindsetSource(record.mindsetSource)
  }
  async begin() {
    if (!this.active || this.state.busy || this.state.editing) return
    const token = ++this.generation
    this.update({ busy: true, error: undefined })
    try {
      // Reject ambiguous installed source before allocating a persistent record.
      splitMindsetSource(this.state.source)
      const requestedId = this.record?.id ?? this.options.initialId
      const record = requestedId ? await this.client.read(requestedId) : await this.client.create({ kit: { ...this.kit } })
      if (!this.active || token !== this.generation) return
      this.check(record)
      if (requestedId && record.id !== requestedId) throw new Error('Mindset draft does not match the selected record.')
      if (!requestedId && record.mindsetSource !== this.state.source) throw new Error('Installed Mindset changed. Reload the Kit before editing.')
      this.record = structuredClone(record)
      this.update({ editing: true, unpublished: true, source: record.mindsetSource, segments: splitMindsetSource(record.mindsetSource), dirty: false })
      if (requestedId) this.onSource(record.mindsetSource)
      this.options.onRecord?.(structuredClone(record))
    } catch (failure) {
      if (token === this.generation) this.update({ error: failure instanceof Error ? failure.message : String(failure) })
    } finally { if (token === this.generation) this.update({ busy: false }) }
  }
  edit(index: number, text: string) {
    if (!this.active || !this.state.editing || this.state.busy || this.state.segments[index]?.protected !== false) return
    const segments = this.state.segments.map((segment, i) => i === index ? { ...segment, text } : segment)
    this.update({ segments, dirty: segments.map(segment => segment.text).join('') !== this.record?.mindsetSource, error: undefined })
  }
  cancel() {
    if (!this.active || this.state.busy) return
    this.generation++
    this.update({ editing: false, dirty: false, segments: [], error: undefined })
  }
  async save() {
    if (!this.active || this.state.busy || !this.state.editing || !this.state.dirty || !this.record) return
    const token = ++this.generation, record = this.record
    const source = this.state.segments.map(segment => segment.text).join('')
    this.update({ busy: true, error: undefined })
    try {
      const protectedBytes = (segments: readonly MindsetSegment[]) => segments.filter(segment => segment.protected).map(segment => segment.text)
      if (JSON.stringify(protectedBytes(splitMindsetSource(source))) !== JSON.stringify(protectedBytes(splitMindsetSource(record.mindsetSource)))) {
        throw new Error('Frontmatter and design_skills must remain byte-identical.')
      }
      const saved = await this.client.save({ id: record.id, expectedRevision: record.revision, mindsetSource: source, relationsSource: record.relationsSource })
      if (!this.active || token !== this.generation) return
      this.check(saved)
      if (saved.id !== record.id || saved.revision !== record.revision + 1 || saved.baseSnapshot !== record.baseSnapshot
        || JSON.stringify(saved.mounts) !== JSON.stringify(record.mounts) || saved.mindsetSource !== source || saved.relationsSource !== record.relationsSource) {
        throw new Error('Saved Mindset does not match the requested source and revision.')
      }
      this.record = structuredClone(saved)
      this.update({ editing: false, dirty: false, unpublished: true, source: saved.mindsetSource, segments: [] })
      this.onSource(saved.mindsetSource)
      this.options.onRecord?.(structuredClone(saved))
    } catch (failure) {
      if (token === this.generation) this.update({ error: failure instanceof Error ? failure.message : String(failure) })
    } finally { if (token === this.generation) this.update({ busy: false }) }
  }
}
