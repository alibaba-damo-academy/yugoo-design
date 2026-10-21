/**
 * Session-attributed Design dock state (pure; node-testable; no browser APIs).
 *
 * The dock open flag is persistent per session: a new session starts closed,
 * switching back restores that session's own flag, and one session's state
 * never leaks into another. Focus and activity projections are transient and
 * are cleared on every switch. Open/close mutations carry the sessionId that
 * triggered them; an event attributed to a non-active session is dropped so a
 * late asynchronous arrival cannot reopen the session the user moved to.
 */

/** Dock state: open flag + rendered width, consumed by toggle, dock, and drag. */
export interface RailState {
  open: boolean
  width: number
  focus?: { readonly skill: string; readonly nonce: number }
  activity?: { readonly sessionId: string; readonly seq: number }
}

/** Transient projections that never survive a session switch. */
export interface DockTransient {
  focus?: { readonly skill: string; readonly nonce: number }
  activity?: { readonly sessionId: string; readonly seq: number }
}

const DEFAULT_DOCK_WIDTH = 420

/** Persistent open flag per session; absence means closed. */
const sessionDockOpen = new Map<string, boolean>()
let activeSessionId: string | undefined
let railWidth = DEFAULT_DOCK_WIDTH
let railFocus: DockTransient['focus']
let railActivity: DockTransient['activity']
let clampWidth: (width: number) => number = (width) => width

const railListeners = new Set<() => void>()

function composeRailState(): RailState {
  return {
    open: activeSessionId !== undefined && sessionDockOpen.get(activeSessionId) === true,
    width: railWidth,
    ...(railFocus === undefined ? {} : { focus: railFocus }),
    ...(railActivity === undefined ? {} : { activity: railActivity }),
  }
}

let railSnap: RailState = composeRailState()

function publishRail(): void {
  railSnap = composeRailState()
  for (const listener of railListeners) listener()
}

/** The dock's shared store (identity-stable snapshot object per change). */
export const rail = {
  /**
   * Subscribe to dock state changes.
   * @param listener - invoked after every published change.
   * @returns the unsubscribe function.
   */
  subscribe: (listener: () => void): (() => void) => {
    railListeners.add(listener)
    return () => { railListeners.delete(listener) }
  },
  /**
   * Read the current dock snapshot.
   * @returns the identity-stable snapshot of the active session's dock state.
   */
  getSnapshot: (): RailState => railSnap,
}

/**
 * The session whose dock state mutations are currently accepted.
 * @returns the active sessionId, or undefined before any session is provided.
 */
export function currentDockSession(): string | undefined {
  return activeSessionId
}

/**
 * Install the host-side width clamp applied to every dock width change.
 * @param clamp - clamps a requested width to the host layout bounds.
 * @returns nothing.
 */
export function setDockWidthClamp(clamp: (width: number) => number): void {
  clampWidth = clamp
}

/**
 * Switch the dock to one session's own state.
 *
 * The new session opens only when its own persistent flag says so; the
 * outgoing session's transient focus/activity projections are cleared and
 * never carried across.
 * @param sessionId - the session becoming current, or undefined for none.
 * @returns nothing.
 */
export function activateDesignDockSession(sessionId: string | undefined): void {
  if (sessionId === activeSessionId) return
  activeSessionId = sessionId
  railFocus = undefined
  railActivity = undefined
  publishRail()
}

/**
 * Persist one session's dock open flag with optional transient projections.
 *
 * Mutations attributed to a non-active session are dropped, so late
 * asynchronous events cannot change the session the user moved to.
 * @param sessionId - the session that triggered the change.
 * @param open - the session's new persistent open flag.
 * @param transient - optional focus/activity projections to publish with it.
 * @returns nothing.
 */
export function setSessionDockOpen(
  sessionId: string | undefined,
  open: boolean,
  transient: DockTransient = {},
): void {
  if (sessionId === undefined || sessionId !== activeSessionId) return
  sessionDockOpen.set(sessionId, open)
  if ('focus' in transient) railFocus = transient.focus
  if ('activity' in transient) railActivity = transient.activity
  publishRail()
}

/**
 * Set the page-global dock width through the installed clamp.
 * @param width - the requested width in pixels.
 * @returns nothing.
 */
export function setRailWidth(width: number): void {
  const clamped = clampWidth(width)
  if (clamped === railWidth) return
  railWidth = clamped
  publishRail()
}
