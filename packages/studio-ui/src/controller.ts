/** Observable interaction controller shared by every Studio presentation mode. */
import type {
  StudioBundleWorkspaceView,
  StudioDiagnostic,
  StudioKitWorkspaceView,
  StudioWorkspaceView,
} from 'dsh-design-studio'
import type { StudioClientFailure, StudioManagementClient } from './types.ts'

/** Read-only viewer state of one authored Bundle file. */
export interface StudioBundleFileViewerState {
  /** Bundle id owning the file. */
  readonly name: string
  /** Slash-separated path relative to the Bundle root. */
  readonly path: string
  /** Complete UTF-8 file content, byte-exact from the source. */
  readonly content: string
}

/** Second-level Kit Workspace section; the Mindset source is the default foreground. */
export type StudioKitWorkspaceTab = 'mindset' | 'relations' | 'mounts'

/** Top-level Studio section; Kits is the entry view. */
export type StudioSection = 'kits' | 'bundles'

/** Complete immutable controller snapshot. */
export interface StudioWorkspaceState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error'
  readonly query: string
  readonly view?: StudioWorkspaceView
  /** Open top-level Studio section. */
  readonly section: StudioSection
  /** Installed Kit identity whose workspace is open; undefined shows the Kit list. */
  readonly selectedKit?: string
  /** Read-only workspace of the selected installed Kit. */
  readonly kitWorkspace?: StudioKitWorkspaceView
  /** Open second-level section of the Kit Workspace. */
  readonly kitTab: StudioKitWorkspaceTab
  /** Filter applied to the top-level Bundles list. */
  readonly bundleQuery: string
  /** Bundle workspace overlay opened from the Kit Workspace mounts or the Bundles list. */
  readonly bundleWorkspace?: StudioBundleWorkspaceView
  /** Open read-only Bundle file viewer. */
  readonly bundleFile?: StudioBundleFileViewerState
  readonly diagnostics: readonly StudioDiagnostic[]
  readonly failure?: StudioClientFailure
}

function state(value: StudioWorkspaceState): StudioWorkspaceState {
  return Object.freeze({ ...value, diagnostics: Object.freeze([...value.diagnostics]) })
}

function requestFailed(error: unknown): StudioClientFailure {
  return Object.freeze({ code: 'request_failed' as const, message: error instanceof Error ? error.message : String(error) })
}

/**
 * Host-neutral state machine for the read-only Kit-first Studio workspace.
 * Studio 1.0 inspects installed content: every method is a read, and leaving
 * any context discards in-flight reads. Kits and Bundles are the top-level
 * entries; a Bundle workspace overlays the section it was opened from.
 */
export class StudioWorkspaceController {
  readonly #client: StudioManagementClient
  readonly #listeners = new Set<() => void>()
  #state: StudioWorkspaceState = state({ phase: 'idle', query: '', kitTab: 'mindset', section: 'kits', bundleQuery: '', diagnostics: [] })
  #request = 0
  /** Bumped exactly when the user leaves an open context; in-flight work settling afterwards is discarded. */
  #context = 0

  /** @param client - embedded or companion implementation of the same service API. */
  constructor(client: StudioManagementClient) {
    this.#client = client
  }

  /** Subscribe to immutable state changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Read the current identity-stable snapshot. */
  getSnapshot = (): StudioWorkspaceState => this.#state

  /** Load the current workspace; a slower obsolete request is discarded. */
  async load(query = this.#state.query): Promise<void> {
    const request = ++this.#request
    const context = this.#context
    const normalized = query.trim()
    this.#set({ ...this.#state, phase: 'loading', query: normalized, diagnostics: [], failure: undefined })
    try {
      const view = await this.#client.workspace(normalized)
      if (request !== this.#request || context !== this.#context) return
      this.#set({ ...this.#state, phase: 'ready', query: normalized, view, diagnostics: [], failure: undefined })
    } catch (error) {
      if (request !== this.#request || context !== this.#context) return
      this.#set({ ...this.#state, phase: 'error', failure: requestFailed(error) })
    }
  }

  /** Open one exact installed Kit version's read-only workspace. */
  async selectKit(name: string, version: string): Promise<void> {
    const request = ++this.#request
    const context = ++this.#context
    this.#set({
      ...this.#state,
      phase: 'loading',
      section: 'kits',
      bundleWorkspace: undefined,
      bundleFile: undefined,
      diagnostics: [],
      failure: undefined,
    })
    let result
    try {
      result = await this.#client.readKitWorkspace(name, version)
    } catch (error) {
      if (request !== this.#request || context !== this.#context) return
      this.#set({ ...this.#state, phase: 'ready', failure: requestFailed(error) })
      return
    }
    if (request !== this.#request || context !== this.#context) return
    if (result.workspace === undefined) {
      this.#set({ ...this.#state, phase: 'ready', diagnostics: [...result.diagnostics], failure: undefined })
      return
    }
    if (result.workspace.name !== name || result.workspace.version !== version) {
      this.#set({
        ...this.#state,
        phase: 'ready',
        diagnostics: [Object.freeze({
          code: 'workspace.version_mismatch',
          message: `expected Kit ${JSON.stringify(name)}@${JSON.stringify(version)}, received ${JSON.stringify(result.workspace.name)}@${JSON.stringify(result.workspace.version)}`,
          subject: version,
        })],
        failure: undefined,
      })
      return
    }
    this.#set({
      ...this.#state,
      phase: 'ready',
      section: 'kits',
      selectedKit: name,
      kitWorkspace: result.workspace,
      kitTab: 'mindset',
      diagnostics: [],
      failure: undefined,
    })
  }

  /** Switch the open second-level Kit Workspace section. */
  setKitTab(tab: StudioKitWorkspaceTab): void {
    this.#set({ ...this.#state, kitTab: tab })
  }

  /** Switch the top-level Studio section; the open workspace and in-flight reads are discarded. */
  setSection(section: StudioSection): void {
    if (this.#state.section === section) return
    this.#context += 1
    this.#set({
      ...this.#state,
      phase: 'ready',
      section,
      selectedKit: undefined,
      kitWorkspace: undefined,
      kitTab: 'mindset',
      bundleWorkspace: undefined,
      bundleFile: undefined,
      diagnostics: [],
      failure: undefined,
    })
  }

  /** Filter the top-level Bundles list. */
  setBundleQuery(bundleQuery: string): void {
    this.#set({ ...this.#state, bundleQuery })
  }

  /** Leave the Kit Workspace and return to the Kit list; in-flight reads are discarded. */
  backToList(): void {
    this.#context += 1
    this.#set({
      ...this.#state,
      phase: 'ready',
      section: 'kits',
      selectedKit: undefined,
      kitWorkspace: undefined,
      kitTab: 'mindset',
      bundleWorkspace: undefined,
      bundleFile: undefined,
      diagnostics: [],
      failure: undefined,
    })
  }

  /** Open one Bundle's read-only source workspace as an overlay on the current Kit workspace. */
  async openBundleWorkspace(name: string, version?: string): Promise<void> {
    const request = ++this.#request
    const context = ++this.#context
    this.#set({
      ...this.#state,
      phase: 'loading',
      bundleWorkspace: undefined,
      bundleFile: undefined,
      diagnostics: [],
      failure: undefined,
    })
    let result
    try {
      result = await this.#client.readBundleWorkspace(name, version)
    } catch (error) {
      if (request !== this.#request || context !== this.#context) return
      this.#set({ ...this.#state, phase: 'ready', failure: requestFailed(error) })
      return
    }
    if (request !== this.#request || context !== this.#context) return
    if (result.workspace === undefined) {
      this.#set({ ...this.#state, phase: 'ready', diagnostics: [...result.diagnostics], failure: undefined })
      return
    }
    if (result.workspace.name !== name || (version !== undefined && result.workspace.version !== version)) {
      this.#set({
        ...this.#state,
        phase: 'ready',
        diagnostics: [Object.freeze({
          code: 'bundle.name_mismatch',
          message: `expected Bundle ${JSON.stringify(name)}@${version ?? '*'}, received ${JSON.stringify(result.workspace.name)}@${result.workspace.version}`,
          subject: name,
        })],
        failure: undefined,
      })
      return
    }
    this.#set({
      ...this.#state,
      phase: 'ready',
      bundleWorkspace: result.workspace,
      bundleFile: undefined,
      diagnostics: [...result.diagnostics],
      failure: undefined,
    })
    const first = result.workspace.files[0]
    if (first !== undefined) await this.openBundleFile(first.path)
  }

  /** Open one file of the open Bundle workspace in the read-only viewer. */
  async openBundleFile(path: string): Promise<void> {
    const workspace = this.#state.bundleWorkspace
    if (workspace === undefined) return
    const request = ++this.#request
    const context = this.#context
    this.#set({ ...this.#state, phase: 'loading', failure: undefined })
    let result
    try {
      result = await this.#client.readBundleFile({ name: workspace.name, version: workspace.version, path })
    } catch (error) {
      if (request !== this.#request || context !== this.#context) return
      this.#set({ ...this.#state, phase: 'ready', failure: requestFailed(error) })
      return
    }
    if (request !== this.#request || context !== this.#context) return
    if (result.file === undefined) {
      this.#set({ ...this.#state, phase: 'ready', bundleFile: undefined, diagnostics: [...result.diagnostics], failure: undefined })
      return
    }
    this.#set({
      ...this.#state,
      phase: 'ready',
      bundleFile: Object.freeze({ name: workspace.name, path: result.file.path, content: result.file.content }),
      failure: undefined,
    })
  }

  /** Close the Bundle workspace overlay; the Kit workspace it was opened from stays open. */
  closeBundleWorkspace(): void {
    this.#context += 1
    this.#set({
      ...this.#state,
      phase: 'ready',
      bundleWorkspace: undefined,
      bundleFile: undefined,
      diagnostics: [],
      failure: undefined,
    })
  }

  #set(next: StudioWorkspaceState): void {
    this.#state = state(next)
    for (const listener of this.#listeners) listener()
  }
}
