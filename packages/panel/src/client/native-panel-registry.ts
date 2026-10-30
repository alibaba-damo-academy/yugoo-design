/** Lifecycle-owned registry for trusted native design-panel implementations. */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import type { SkillPanelProps } from './panels/shared.ts'
import { ComponentPackageError, validateComponentPackageClosure, type ComponentPackagePin, type ComponentPackageSource, type ValidatedComponentPackage } from '../../../core/src/component-package.ts'
import { DECLARATIVE_PANEL_ARTIFACTS_KEY, type PendingDeclarativeArtifact } from '../question-attachment-contract.ts'
import { PANEL_TEXT_ARTIFACTS_KEY, collectTextArtifactEdits } from '../text-artifact-edit.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser registry populated by installed native Panel provider plugins. */
    designNativePanels: NativePanelRegistry
  }
}

/** Native presentation selected by a Bundle's projected `skill.yaml`. */
export interface NativePanelPresentation {
  readonly mode: 'native'
  readonly renderer: string | undefined
}

/** Declarative presentation rendered by the generic interpreter. */
export interface DeclarativePanelPresentation {
  readonly mode: 'declarative'
}

/** Explicit absence of an interactive panel. */
export interface NoPanelPresentation {
  readonly mode: 'none'
}

/** Explicit opt-in to a generated Panel; an unready spec is read-only. */
export interface AutoPanelPresentation {
  readonly mode: 'auto'
}

/** Invalid projected metadata; rendered as an explicit client diagnostic. */
export interface InvalidPanelPresentation {
  readonly mode: 'invalid'
  readonly reason: string
}

/** Presentation modes consumed by the browser workspace and draft store. */
export type PanelPresentation = NativePanelPresentation | DeclarativePanelPresentation | AutoPanelPresentation | NoPanelPresentation | InvalidPanelPresentation

/** Services and state supplied to every trusted native renderer. */
export interface NativePanelRenderProps extends SkillPanelProps {
  readonly skill: string
  readonly running: boolean
  readonly sendPrompt: (text: string) => void
  readonly selectPanel: (skill: string) => void
  readonly panelData: (panelType: string, sectionId: string) => Record<string, Record<string, unknown>>
  readonly onAction: (() => void) | undefined
}

/** Host operations available to an optional driver-owned action. */
export interface NativePanelActionHost {
  readonly saveAndRegenerate: () => void
}

/** Feature-popover entry contributed by a trusted pack (no skill names in generic workspace code). */
export interface NativePanelFeatureEntry {
  /** The skill this feature entry engages. */
  readonly skill: string
  /** Sort order within the feature popover. */
  readonly order: number
  /** i18n key for the popover label while the skill is not engaged. */
  readonly labelKey: string
  /** i18n key for the quick prompt sent when the inactive entry is picked. */
  readonly quickPromptKey: string
}

/** Optional descriptive properties for native panel chrome and diagnostics. */
export interface NativePanelMetadata {
  /** Byte-validated trusted Provider provenance, projected from the existing registry. */
  readonly componentPackage?: ValidatedComponentPackage
  readonly editable?: boolean
  readonly artifactBacked?: boolean
  /** Official feature-popover entry; absent for non-feature renderers. */
  readonly feature?: NativePanelFeatureEntry
}

/** One trusted native panel implementation keyed by its manifest renderer id. */
export interface NativePanelDefinition {
  readonly id: string
  /** Element that owns vertical scrolling for this renderer. */
  readonly scrollOwner: 'workspace' | 'panel'
  readonly render: (props: NativePanelRenderProps) => ReactElement
  readonly equalsDraft?: (draft: unknown, original: unknown) => boolean
  /** Browser-only serialization for native editors with file-backed text artifacts. */
  readonly prepareSave?: (draft: unknown) => {
    readonly state: unknown
    readonly artifacts?: readonly NativePanelSaveArtifact[]
  }
  readonly action?: (host: NativePanelActionHost) => void
  readonly metadata?: NativePanelMetadata
}

/** Actual runtime references supplied by trusted Host/Provider code, not manifest strings. */
export interface NativePanelPackageRuntime {
  readonly hostReact: { readonly version: string }
  readonly providerReact: object
  readonly hostReactDOM: { readonly version: string }
  readonly providerReactDOM: object
}

/** One browser-prepared file persisted atomically with its owning panel state. */
export interface NativePanelSaveArtifact {
  readonly path: string
  readonly content: string
  /** Omitted means UTF-8 text; base64 carries arbitrary file bytes. */
  readonly encoding?: 'base64'
}

/** Serialize one panel draft without teaching the generic workspace its Bundle schema. */
export function prepareNativePanelSave(
  presentation: PanelPresentation,
  registry: NativePanelRegistry,
  draft: unknown,
): { readonly state: unknown; readonly artifacts?: readonly NativePanelSaveArtifact[] } {
  if (presentation.mode === 'declarative') return prepareDeclarativePanelSave(draft)
  if (presentation.mode !== 'native' || presentation.renderer === undefined) return { state: draft }
  return registry.get(presentation.renderer)?.prepareSave?.(draft) ?? { state: draft }
}

function collectArtifactReferences(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectArtifactReferences(entry, output)
    return output
  }
  if (value === null || typeof value !== 'object') return output
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'artifact_file' && typeof entry === 'string') output.add(entry)
    else if (key !== DECLARATIVE_PANEL_ARTIFACTS_KEY) collectArtifactReferences(entry, output)
  }
  return output
}

/** Strip browser-only declarative attachment bytes and persist referenced files atomically. */
export function prepareDeclarativePanelSave(draft: unknown): {
  readonly state: unknown
  readonly artifacts?: readonly NativePanelSaveArtifact[]
} {
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) return { state: draft }
  const source = draft as Record<string, unknown>
  const raw = source[DECLARATIVE_PANEL_ARTIFACTS_KEY]
  const state = { ...source }
  delete state[DECLARATIVE_PANEL_ARTIFACTS_KEY]
  delete state[PANEL_TEXT_ARTIFACTS_KEY]
  const artifacts: NativePanelSaveArtifact[] = collectTextArtifactEdits(state, source[PANEL_TEXT_ARTIFACTS_KEY])
  if (raw === undefined) return { state, ...(artifacts.length ? { artifacts } : {}) }
  if (!Array.isArray(raw)) throw new Error('declarative panel artifact transport must be a list')
  const referenced = collectArtifactReferences(state)
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid declarative panel artifact transport entry')
    const pending = entry as Partial<PendingDeclarativeArtifact>
    if (typeof pending.path !== 'string' || typeof pending.content !== 'string' || pending.encoding !== 'base64') {
      throw new Error('invalid declarative panel artifact bytes')
    }
    if (!referenced.has(pending.path)) continue
    const previous = artifacts.find(artifact => artifact.path === pending.path)
    if (previous && (previous.encoding !== 'base64' || previous.content !== pending.content)) throw new Error('Conflicting declarative artifact bytes')
    if (!previous) artifacts.push({ path: pending.path, content: pending.content, encoding: 'base64' })
  }
  return { state, ...(artifacts.length > 0 ? { artifacts } : {}) }
}

/** Mutable registry data retained by the providing service instance. */
interface NativePanelRegistryState {
  readonly definitions: Map<string, NativePanelDefinition>
  readonly listeners: Set<() => void>
  revision: number
}

function publishRegistryChange(state: NativePanelRegistryState): void {
  state.revision += 1
  for (const listener of state.listeners) listener()
}

/** Resolve the one vertical scroll owner for a projected panel. */
export function panelScrollOwner(
  presentation: PanelPresentation,
  registry: NativePanelRegistry,
): 'workspace' | 'panel' {
  if (presentation.mode === 'declarative') return 'panel'
  if (presentation.mode !== 'native' || presentation.renderer === undefined) return 'workspace'
  return registry.get(presentation.renderer)?.scrollOwner ?? 'workspace'
}

/** Effect-scoped native panel definitions installed by browser provider plugins. */
export class NativePanelRegistry extends Service {
  private readonly state: NativePanelRegistryState = {
    definitions: new Map(),
    listeners: new Set(),
    revision: 0,
  }

  /** @param ctx - client plugin context that provides `ctx.designNativePanels`. */
  constructor(ctx: Context) {
    super(ctx, 'designNativePanels')
  }

  /**
   * Register one unique native renderer for the caller's effect lifetime.
   * @param definition - trusted renderer contribution.
   * @returns idempotent disposer.
   */
  register(definition: NativePanelDefinition): () => void {
    const { state } = this
    if (definition.id.trim() === '') throw new Error('design panel: native renderer id must not be empty')
    if (state.definitions.has(definition.id)) {
      throw new Error(`design panel: native renderer ${JSON.stringify(definition.id)} is already registered`)
    }
    // Trusted contributions are immutable: freeze the definition (metadata
    // included) so post-registration mutation cannot alter feature/action/
    // renderer behavior.
    if (definition.metadata !== undefined) {
      if (definition.metadata.feature !== undefined) Object.freeze(definition.metadata.feature)
      Object.freeze(definition.metadata)
    }
    Object.freeze(definition)
    const dispose = this.ctx.effect(function* () {
      // Cordis must own cleanup before synchronous observers can throw or unload
      // the provider while publication is in progress.
      let setupFailed = false
      yield () => {
        if (state.definitions.get(definition.id) !== definition) return
        state.definitions.delete(definition.id)
        try { publishRegistryChange(state) } catch (error) {
          if (!setupFailed) throw error
        }
      }
      state.definitions.set(definition.id, definition)
      try { publishRegistryChange(state) } catch (error) {
        setupFailed = true
        throw error
      }
    }, `designNativePanels.register(${JSON.stringify(definition.id)})`)
    return () => { void dispose() }
  }

  /** Admit a checked package through the same native definitions and effect lifetime. */
  async registerPackage(sources: readonly ComponentPackageSource[], root: ComponentPackagePin, createDefinitions: (value: ValidatedComponentPackage) => readonly NativePanelDefinition[], runtime: NativePanelPackageRuntime): Promise<() => void> {
    if (runtime.hostReact !== runtime.providerReact || runtime.hostReactDOM !== runtime.providerReactDOM
      || !runtime.hostReact || !runtime.hostReactDOM) {
      throw new ComponentPackageError('package.react_source', '$runtime', 'Provider must use the actual admitted Host React and ReactDOM singletons.')
    }
    // Validation runs in this registry's own artifact: no serialized certificate
    // or module-local brand is treated as admission across separate bundles.
    const rootSnapshot = { ...root }
    const closure = await validateComponentPackageClosure(sources, rootSnapshot, { nativePanelApi: 1, reactVersion: runtime.hostReact.version, reactDOMVersion: runtime.hostReactDOM.version })
    const value = closure.find(entry => entry.name === rootSnapshot.name)!
    const definitions = createDefinitions(value)
    if (!Array.isArray(definitions) || definitions.some(definition => !definition || typeof definition.render !== 'function' || !['panel', 'workspace'].includes(definition.scrollOwner))) {
      throw new ComponentPackageError('package.interface', '$definitions', 'Native-panel API 1 requires render(props) and a declared scroll owner.')
    }
    const expected = new Set(value.manifest.components.map(component => component.id))
    if (definitions.length !== expected.size || definitions.some(definition => !expected.delete(definition.id)) || expected.size) {
      throw new ComponentPackageError('package.contributions', '$definitions', 'Definitions must match every declared native component exactly once.')
    }
    for (const definition of definitions) {
      if (this.state.definitions.has(definition.id)) throw new ComponentPackageError('package.component_conflict', '$definitions', `Native component ${definition.id} is already registered.`)
      const other = this.installedDefinitions().find(entry => entry.metadata?.componentPackage?.manifest.namespace === value.manifest.namespace)
      if (other) throw new ComponentPackageError('package.namespace_conflict', '$definitions', `Namespace ${value.manifest.namespace} is already registered.`)
    }
    const disposers: (() => void)[] = []
    const disposeAll = () => {
      const errors: unknown[] = []
      for (const dispose of [...disposers].reverse()) {
        try { dispose() } catch (error) { errors.push(error) }
      }
      if (errors.length) throw new AggregateError(errors, 'Native component package cleanup failed.')
    }
    try {
      for (const definition of definitions) disposers.push(this.register({ ...definition, metadata: Object.freeze({ ...definition.metadata, componentPackage: value }) }))
    } catch (error) {
      try { disposeAll() } catch { /* Preserve the setup error after attempting every cleanup. */ }
      throw error
    }
    return disposeAll
  }

  /**
   * Observe renderer installation and disposal, including providers loaded after the Panel shell.
   * @param listener - synchronous invalidation callback.
   * @returns an idempotent unsubscribe callback.
   */
  subscribe(listener: () => void): () => void {
    const { listeners } = this.state
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  /** @returns the monotonic browser-registry revision consumed by React. */
  revision(): number {
    return this.state.revision
  }

  /** Resolve an installed renderer without substituting another presentation. */
  get(id: string): NativePanelDefinition | undefined {
    return this.state.definitions.get(id)
  }

  /** Return installed renderer ids in registration order. */
  ids(): readonly string[] {
    return [...this.state.definitions.keys()]
  }

  /** Return installed definitions in registration order. */
  installedDefinitions(): readonly NativePanelDefinition[] {
    return [...this.state.definitions.values()]
  }

}

/** Read explicit presentation metadata without selecting a fallback mode. */
export function panelPresentation(manifest: { readonly presentation?: unknown } | undefined): PanelPresentation {
  const presentation = manifest?.presentation
  if (presentation === undefined) return { mode: 'none' }
  if (presentation === null || typeof presentation !== 'object' || Array.isArray(presentation)) {
    return { mode: 'invalid', reason: 'presentation must be an object' }
  }
  const record = presentation as Record<string, unknown>
  if (record.mode === 'declarative') return { mode: 'declarative' }
  if (record.mode === 'auto') return record.renderer === undefined
    ? { mode: 'auto' }
    : { mode: 'invalid', reason: 'auto presentation cannot declare renderer' }
  if (record.mode === 'none') return { mode: 'none' }
  if (record.mode !== 'native') return { mode: 'invalid', reason: 'presentation.mode must be native, declarative, auto, or none' }
  return { mode: 'native', renderer: typeof record.renderer === 'string' ? record.renderer : undefined }
}
