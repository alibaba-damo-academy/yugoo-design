/** Editor/preview coordination; persistence remains an explicit host operation. */
import type { StudioPanelPreview, StudioPanelPreviewRequest, StudioPanelPreviewResult, StudioDiagnostic } from 'dsh-design-studio'

export interface StudioPanelPreviewClient {
  preparePreview(request: StudioPanelPreviewRequest): Promise<StudioPanelPreviewResult>
}

export interface StudioPanelDraftState {
  readonly request: StudioPanelPreviewRequest
  readonly phase: 'editing' | 'previewing' | 'ready' | 'invalid'
  readonly preview?: StudioPanelPreview
  readonly diagnostics: readonly StudioDiagnostic[]
}

/**
 * One isolated editor. An older async compilation must never replace a newer
 * edit or resurrect a preview after the author has left this workspace.
 * `ready` means a definition and sample compiled, not saved/published or run.
 */
export class StudioPanelDraftController {
  readonly #client: StudioPanelPreviewClient
  readonly #listeners = new Set<() => void>()
  #state: StudioPanelDraftState
  #generation = 0
  #disposed = false

  constructor(client: StudioPanelPreviewClient, seed: StudioPanelPreviewRequest) {
    this.#client = client
    this.#state = this.#snapshot({ request: seed, phase: 'editing', diagnostics: [] })
  }

  getSnapshot = (): StudioPanelDraftState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => {}
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Replace either source; both are carried by the same editor revision. */
  edit(change: { panelSource?: string; sampleSource?: string }): void {
    if (this.#disposed) return
    const panelSource = change.panelSource ?? this.#state.request.panelSource
    const sampleSource = change.sampleSource ?? this.#state.request.sampleSource
    if (panelSource === this.#state.request.panelSource && sampleSource === this.#state.request.sampleSource) return
    ++this.#generation
    this.#set({
      request: { ...this.#state.request, panelSource, sampleSource, revision: this.#state.request.revision + 1 },
      phase: 'editing', diagnostics: [],
    })
  }

  async preview(): Promise<void> {
    if (this.#disposed) return
    const generation = ++this.#generation
    const request = this.#state.request
    this.#set({ request, phase: 'previewing', diagnostics: [] })
    try {
      const result = await this.#client.preparePreview(request)
      if (this.#disposed || generation !== this.#generation) return
      const preview = result.preview
      if (preview && (preview.revision !== request.revision
        || preview.kit?.name !== request.kit.name || preview.kit?.version !== request.kit.version
        || preview.bundle.name !== request.bundle.name || preview.bundle.version !== request.bundle.version)) {
        this.#set({ request, phase: 'invalid', diagnostics: [{ code: 'preview.identity', message: 'Preview does not match the current draft revision.' }] })
        return
      }
      if (!preview || result.diagnostics.length > 0) {
        this.#set({ request, phase: 'invalid', diagnostics: result.diagnostics.length ? result.diagnostics : [{ code: 'preview.empty', message: 'No preview was returned.' }] })
        return
      }
      this.#set({ request, phase: 'ready', preview, diagnostics: [] })
    } catch (error) {
      if (this.#disposed || generation !== this.#generation) return
      this.#set({ request, phase: 'invalid', diagnostics: [{ code: 'preview.request_failed', message: error instanceof Error ? error.message : String(error) }] })
    }
  }

  dispose(): void {
    this.#disposed = true
    ++this.#generation
    this.#listeners.clear()
  }

  #snapshot(value: StudioPanelDraftState): StudioPanelDraftState {
    return Object.freeze({
      ...value,
      request: Object.freeze({ ...value.request, kit: Object.freeze({ ...value.request.kit }), bundle: Object.freeze({ ...value.request.bundle }) }),
      diagnostics: Object.freeze(value.diagnostics.map(diagnostic => Object.freeze({ ...diagnostic }))),
    })
  }

  #set(value: StudioPanelDraftState): void {
    this.#state = this.#snapshot(value)
    for (const listener of this.#listeners) listener()
  }
}
