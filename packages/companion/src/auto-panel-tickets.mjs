/** Process-local UI requests. The caller supplies the existing mutation fence and
 * shared Core validator/cache publisher; this never dispatches a model. */
import { randomUUID, createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const failure = error => String(error?.message ?? error).slice(0, 500)

export function createAutoPanelTickets({ session, inspect, prompt, publish, mutate,
  now = Date.now, ttl = 300_000, capacity = 32 }) {
  if (typeof session !== 'string' || !session) throw new Error('auto panel: authenticated session required')
  const tickets = new Map()
  const expires = ticket => now() >= ticket.expiresAt
  const identity = current => digest({ session, projectId: current.projectId,
    definitionRevision: current.definitionRevision, sourceRevision: current.sourceRevision,
    context: current.context })
  const response = ticket => ({ status: 'awaiting-agent', requestId: ticket.id,
    projectId: ticket.projectId, skill: ticket.skill, sourceRevision: ticket.sourceRevision,
    attempt: ticket.attempt, expiresAt: ticket.expiresAt, prompt: ticket.prompt })
  const prune = () => { for (const [id, ticket] of tickets) if (expires(ticket)) tickets.delete(id) }

  return {
    prepare({ skill }) {
      return mutate(async () => {
        prune()
        const current = await inspect(skill)
        if (current.resolved.status === 'ready') return { status: 'ready', origin: current.resolved.origin }
        if (current.resolved.status === 'incompatible') throw new Error(current.resolved.reason)
        const pin = identity(current)
        for (const ticket of tickets.values()) {
          if (ticket.skill === skill && ticket.pin === pin && ticket.phase === 'awaiting-agent') return response(ticket)
        }
        // Completed records can be evicted; never evict an active request.
        if (tickets.size >= capacity) {
          for (const [id, ticket] of tickets) if (ticket.phase !== 'awaiting-agent') { tickets.delete(id); break }
        }
        if (tickets.size >= capacity) throw new Error('auto panel: request capacity reached; retry after expiry')
        const ticket = { id: randomUUID(), skill, pin, projectId: current.projectId,
          sourceRevision: current.sourceRevision, phase: 'awaiting-agent', attempt: 1,
          expiresAt: now() + ttl, prompt: prompt(current.context) }
        tickets.set(ticket.id, ticket)
        return response(ticket)
      })
    },
    submit({ requestId, components }) {
      return mutate(async () => {
        const ticket = tickets.get(requestId)
        if (!ticket || expires(ticket)) { tickets.delete(requestId); throw new Error('auto panel: request expired; prepare again') }
        const current = await inspect(ticket.skill)
        if (identity(current) !== ticket.pin) { ticket.phase = 'stale'; throw new Error('auto panel: source changed; prepare again') }
        if (current.resolved.status === 'incompatible') { ticket.phase = 'failed'; throw new Error(current.resolved.reason) }
        if (current.resolved.status === 'ready' && current.resolved.origin === 'retained') {
          ticket.phase = 'superseded'
          return { status: 'ready', origin: 'retained' }
        }
        // Size is checked before hashing or validation; shared Core also bounds
        // the complete snapshot. No payload text is interpreted as instructions.
        const bytes = JSON.stringify(components)
        const oversized = typeof bytes !== 'string' || Buffer.byteLength(bytes) > 32_768
        const payload = oversized ? undefined : digest(components)
        if (ticket.phase === 'ready') {
          if (payload !== ticket.payload) throw new Error('auto panel: completed request payload differs')
          if (current.resolved.status !== 'ready') throw new Error('auto panel: published cache unavailable; prepare again')
          return { status: 'ready', origin: 'generated', replay: true }
        }
        if (ticket.phase !== 'awaiting-agent') throw new Error('auto panel: request is no longer active; prepare again')
        try {
          if (oversized) throw Object.assign(new Error('auto panel: component payload exceeds limit'), { autoPanelValidation: true })
          await publish(current, components)
        } catch (error) {
          // Only validation failures are eligible for repair. IO failures do not
          // blame the model and do not consume the repair budget.
          if (!error?.autoPanelValidation) { ticket.phase = 'failed'; ticket.detail = failure(error); throw error }
          if (ticket.attempt === 2) {
            ticket.phase = 'failed'; ticket.detail = failure(error)
            return { status: 'failed', attempts: 2, detail: ticket.detail }
          }
          ticket.attempt = 2
          ticket.prompt = `${prompt(current.context)}\nPrevious output was rejected: ${failure(error)}. Repair once; return only a complete JSON component array.`
          return { ...response(ticket), status: 'repair-required' }
        }
        ticket.phase = 'ready'; ticket.payload = payload
        return { status: 'ready', origin: 'generated', attempts: ticket.attempt }
      })
    },
    states() {
      prune()
      const result = {}
      for (const ticket of tickets.values()) result[ticket.skill] = {
        phase: ticket.phase === 'superseded' ? 'ready' : ticket.phase === 'stale' ? 'failed' : ticket.phase,
        target: ticket.sourceRevision, attempts: ticket.attempt,
        ...(ticket.detail ? { detail: ticket.detail } : {}) }
      return result
    },
  }
}
