/** Full host Session history across supported DSH event-access APIs. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'

interface SessionHistory {
  snapshotEvents?: () => readonly SessionEvent[]
  readonly events?: readonly SessionEvent[]
}

/** Read the full log, including inherited events; never substitute ownEvents(). */
export function designSessionEvents(session: SessionHistory): readonly SessionEvent[] {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  if (Array.isArray(session.events)) return session.events
  throw new Error('design: host Session provides neither snapshotEvents() nor events')
}
