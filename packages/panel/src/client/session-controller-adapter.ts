/** Adapt the current Session Controller selection to the root-scoped Design Panel. */

/** Public Host desktop carrier; project roots always come from the selected workspace. */
export interface PanelProjectFolderRemote {
  canOpenWorkspacePath?: () => Promise<{ ok: true; value: boolean } | { ok: false; error: { message?: string } }>
  openWorkspacePath?: (request: { path: string }) => Promise<{ ok: true; value: unknown } | { ok: false; error: { message?: string } }>
}

/** Adapt the existing native opener without shell commands or another path authority. */
export function createPanelProjectFolderActions(remote: PanelProjectFolderRemote | undefined): {
  canOpenProjectFolder?: () => Promise<boolean>
  openProjectFolder?: (path: string) => Promise<void>
} {
  const available = remote?.canOpenWorkspacePath
  const open = remote?.openWorkspacePath
  if (!available || !open) return {}
  const canOpenProjectFolder = async (): Promise<boolean> => {
    const result = await available.call(remote)
    return result.ok && result.value === true
  }
  return {
    canOpenProjectFolder,
    openProjectFolder: async path => {
      if (!path.trim() || !(await canOpenProjectFolder())) throw new Error('The Host cannot open this project folder.')
      const result = await open.call(remote, { path })
      if (!result.ok) throw new Error(result.error.message ?? 'The Host could not open this project folder.')
    },
  }
}

/** Bare observable consumed by the Panel client without exposing Cordis to components. */
export interface CurrentPanelSessionSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Current-session facts consumed by the dock and its header/composer entries. */
export interface PanelSessionInfo {
  readonly sessionId: string | undefined
  readonly hooks?: {
    readonly session?: CurrentPanelSessionSource<unknown>
  }
  readonly projections?: {
    faceOf(key: string): CurrentPanelSessionSource<unknown>
  }
}

/** Session Controller read/control surface consumed by the Panel apply layer. */
export interface PanelSessions {
  readonly list: CurrentPanelSessionSource<{ readonly current?: string }>
  binding(id: string): PanelSessionBinding | undefined
}

/** The host UI owns selection separately from the Session catalog in DSH 0.2. */
export interface PanelCurrentSessionBinding {
  readonly props: { readonly sessionId?: string }
}

/** Identity-stable binding for one selected DSH Session. */
export interface PanelSessionBinding {
  readonly session: CurrentPanelSessionSource<unknown> & {
    readonly projections: {
      faceOf(key: string): CurrentPanelSessionSource<unknown>
    }
    prompt(
      content: Array<{ type: 'text'; text: string }>,
      mode: 'queue' | 'steer',
    ): Promise<{ ok: true; value: { accepted: true } } | { ok: false; error: { code?: string; message?: string } }>
  }
}

/** Active source plus the Session-list subscription owned by the Panel fiber. */
export interface PanelSessionAdapter {
  readonly source: CurrentPanelSessionSource<PanelSessionInfo>
  dispose(): void
}

/**
 * Project the Session Controller's selected id and identity-stable binding into
 * the coarse source needed by the root-scoped Design dock.
 * @param sessions - current DSH Session Controller service.
 * @returns observable current-session projection and its disposer.
 */
export function createPanelSessionAdapter(
  sessions: PanelSessions,
  current?: CurrentPanelSessionSource<PanelCurrentSessionBinding>,
): PanelSessionAdapter {
  const listeners = new Set<() => void>()
  let sessionId: string | undefined
  let binding: PanelSessionBinding | undefined
  let snapshot: PanelSessionInfo = { sessionId: undefined }

  const reconcile = (): boolean => {
    const nextSessionId = current === undefined
      ? sessions.list.getSnapshot().current
      : current.getSnapshot().props.sessionId
    const nextBinding = nextSessionId === undefined ? undefined : sessions.binding(nextSessionId)
    if (nextSessionId === sessionId && nextBinding === binding) return false
    sessionId = nextSessionId
    binding = nextBinding
    snapshot = nextBinding === undefined
      ? { sessionId: nextSessionId }
      : {
          sessionId: nextSessionId,
          hooks: { session: nextBinding.session },
          projections: nextBinding.session.projections,
        }
    return true
  }

  reconcile()
  const publish = () => {
    if (!reconcile()) return
    for (const listener of listeners) listener()
  }
  const disposeList = sessions.list.subscribe(publish)
  const disposeCurrent = current?.subscribe(publish)
  return {
    source: {
      getSnapshot: () => {
        reconcile()
        return snapshot
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    dispose: () => {
      disposeList()
      disposeCurrent?.()
      listeners.clear()
    },
  }
}
