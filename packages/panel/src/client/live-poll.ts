/** One browser-wide clock for every Design live projection. */

const LIVE_POLL_MS = 1000

type LivePollListener = () => void

const listeners = new Set<LivePollListener>()
let timer: number | undefined
let listening = false

function clearTimer(): void {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = undefined
}

function schedule(delay: number): void {
  if (listeners.size === 0 || document.visibilityState === 'hidden') return
  clearTimer()
  timer = window.setTimeout(() => {
    timer = undefined
    for (const listener of [...listeners]) {
      try { listener() } catch {
        // One panel projection must never stop the shared clock for siblings.
      }
    }
    schedule(LIVE_POLL_MS)
  }, delay)
}

function resume(): void {
  if (document.visibilityState === 'hidden') {
    clearTimer()
    return
  }
  schedule(0)
}

function attachBrowserListeners(): void {
  if (listening) return
  listening = true
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('focus', resume)
}

function detachBrowserListeners(): void {
  if (!listening) return
  listening = false
  document.removeEventListener('visibilitychange', resume)
  window.removeEventListener('focus', resume)
}

/**
 * Subscribe one lightweight read to the shared clock. The clock owns the only
 * recurring timer; subscribers still guard their own in-flight request.
 */
export function subscribeLivePoll(listener: LivePollListener): () => void {
  const first = listeners.size === 0
  listeners.add(listener)
  if (first) {
    attachBrowserListeners()
    schedule(0)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size !== 0) return
    clearTimer()
    detachBrowserListeners()
  }
}

/** Coalesce explicit saves, focus changes, and lifecycle transitions. */
export function requestLivePoll(): void {
  schedule(0)
}

/** Test-only observation without exposing subscriber identities. */
export function livePollSubscriberCount(): number {
  return listeners.size
}
