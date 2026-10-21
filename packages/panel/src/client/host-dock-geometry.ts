/** Geometry of the resident Host header, not its display:contents slot wrapper. */
export interface HostDockGeometry {
  readonly top: number
  readonly headerHeight: number
}

const HEADER_SLOT = '[data-slot="conversation.header"]'
const OVERLAY = '[data-shell-overlay]'
const ANCHORS = `${HEADER_SLOT},${OVERLAY}`
const DEFAULT_HEADER_HEIGHT = 64
const MIN_HEADER_HEIGHT = 48

function targets(document: Document): {
  overlay: HTMLElement | null
  frame: HTMLElement | null
  header: HTMLElement | null
} {
  const overlay = document.querySelector<HTMLElement>(OVERLAY)
  const frame = overlay?.parentElement ?? null
  // Only a visible resident conversation in this shell is an alignment owner.
  const header = Array.from(frame?.querySelectorAll<HTMLElement>(HEADER_SLOT) ?? [])
    .map(slot => slot.querySelector<HTMLElement>('header'))
    .find(element => element !== null && element.getBoundingClientRect().width > 0) ?? null
  return { overlay, frame, header }
}

/** Keep top and height independent: an empty Header still clears desktop chrome. */
export function readHostDockGeometry(document: Document): HostDockGeometry {
  const { overlay, frame, header } = targets(document)
  if (overlay === null) return { top: 0, headerHeight: DEFAULT_HEADER_HEIGHT }
  const rect = overlay.getBoundingClientRect()
  const origin = rect.top + overlay.clientTop - overlay.scrollTop
  const available = Math.max(0, overlay.clientHeight || rect.height - 2 * overlay.clientTop)
  const headerRect = header?.getBoundingClientRect()
  const padding = frame === null ? 0 : Number.parseFloat(document.defaultView?.getComputedStyle(frame).paddingTop ?? '0') || 0
  const contentTop = frame === null ? origin : frame.getBoundingClientRect().top + frame.clientTop + padding
  const top = (headerRect !== undefined && Number.isFinite(headerRect.top) ? headerRect.top : contentTop) - origin
  const height = headerRect?.height
  return {
    top: Math.min(available, Math.max(0, Number.isFinite(top) ? top : 0)),
    headerHeight: height !== undefined && Number.isFinite(height) && height > 0
      ? Math.max(MIN_HEADER_HEIGHT, height) : DEFAULT_HEADER_HEIGHT,
  }
}

/** Observe only geometry/anchor changes; ordinary streamed messages do not remeasure. */
export function observeHostDockGeometry(document: Document, update: (geometry: HostDockGeometry) => void): () => void {
  const view = document.defaultView
  if (view === null) return () => {}
  let disposed = false
  let queued: number | undefined
  let current: HostDockGeometry | undefined
  let observed: readonly HTMLElement[] = []
  let root: HTMLElement | null = null
  let parent: HTMLElement | null = null
  const resize = new view.ResizeObserver(() => schedule())
  const relevantNode = (node: Node): boolean => node instanceof view.Element
    && (node.matches(ANCHORS) || node.querySelector(ANCHORS) !== null)
  const anchorsChanged = (records: readonly MutationRecord[]): void => {
    if (records.some(record => record.target instanceof view.Element && record.target.matches(HEADER_SLOT)
      || Array.from(record.addedNodes).some(relevantNode) || Array.from(record.removedNodes).some(relevantNode))) schedule()
  }
  const mounts = new view.MutationObserver(anchorsChanged)
  const frameMounts = new view.MutationObserver(anchorsChanged)
  const chrome = new view.MutationObserver(() => schedule())
  const reconcile = (): void => {
    queued = undefined
    if (disposed) return
    const { overlay, frame, header } = targets(document)
    const nextRoot = frame ?? document.querySelector<HTMLElement>('[data-slot="root"]') ?? document.body
    const nextParent = frame?.parentElement ?? null
    if (root !== nextRoot) {
      mounts.disconnect()
      if (nextRoot !== null) mounts.observe(nextRoot, { childList: true, subtree: true })
      root = nextRoot
    }
    if (parent !== nextParent) {
      frameMounts.disconnect()
      if (nextParent !== null) frameMounts.observe(nextParent, { childList: true })
      parent = nextParent
    }
    const nextObserved = [overlay, frame, header].filter((element): element is HTMLElement => element !== null)
    if (nextObserved.length !== observed.length || nextObserved.some((element, index) => element !== observed[index])) {
      resize.disconnect()
      for (const element of nextObserved) resize.observe(element)
      observed = nextObserved
    }
    const geometry = readHostDockGeometry(document)
    if (current === undefined || current.top !== geometry.top || current.headerHeight !== geometry.headerHeight) {
      current = geometry
      update(geometry)
    }
  }
  function schedule(): void {
    if (!disposed && queued === undefined) queued = view!.requestAnimationFrame(reconcile)
  }
  chrome.observe(document.documentElement, { attributes: true,
    attributeFilter: ['data-windows-titlebar', 'data-fullscreen', 'data-platform', 'class', 'style'] })
  view.addEventListener('resize', schedule)
  reconcile()
  return () => {
    disposed = true
    resize.disconnect(); mounts.disconnect(); frameMounts.disconnect(); chrome.disconnect()
    view.removeEventListener('resize', schedule)
    if (queued !== undefined) view.cancelAnimationFrame(queued)
  }
}
