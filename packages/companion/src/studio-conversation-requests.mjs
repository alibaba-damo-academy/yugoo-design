/** Bounded, service-lifetime correlation of conversation requests with exact S2 receipts. */
import { createHash, randomUUID } from 'node:crypto'
import { normalizeStudioInstanceChanges } from '../../studio/src/instance-changes.ts'
import { readStudioConversationTarget, studioConversationTarget } from './studio-conversation.mjs'

export function createStudioConversationRequests({ binding, readInstance, prepareChanges }) {
  const entries = new Map()
  const maximumBytes = 24 * 1024 * 1024, maximumRequests = 16
  let closed = false
  const requireOpen = () => { if (closed) throw Error('Studio conversation service is closed.') }
  const identity = value => typeof value === 'string' && /^[\w.-]{1,128}$/.test(value)
  const requireEntry = async (requestId, target) => {
    requireOpen()
    const selected = studioConversationTarget(target), entry = entries.get(requestId)
    if (!entry) throw Error('Unknown Studio authoring request. Select the working copy and send a new request explicitly.')
    if (JSON.stringify(selected) !== JSON.stringify(entry.studio)) throw Error('Studio request target changed. Reopen the current working copy; do not reuse this request.')
    await readStudioConversationTarget({ target: selected, binding, readInstance })
    return entry
  }
  const service = {
    async register({ requestId, studio, context }) {
      requireOpen()
      if (!identity(requestId)) throw Error('An exact Studio request ID is required.')
      const target = studioConversationTarget(studio)
      const record = await readStudioConversationTarget({ target, binding, readInstance, context })
      requireOpen()
      if (entries.has(requestId)) throw Error('Studio request already submitted. Check the original conversation; do not resend.')
      if (entries.size >= maximumRequests) throw Error('Studio request correlation limit reached. No pending or reviewed request was evicted; finish this service lifecycle before opening more requests.')
      entries.set(requestId, { studio: target, kind: record.kind, prepared: null, bytes: 0 })
      return record
    },
    async prepare({ authoringRequestId, ...input }) {
      if (!identity(authoringRequestId)) throw Error('An exact authoringRequestId is required.')
      requireOpen()
      const stored = entries.get(authoringRequestId)
      if (!stored) throw Error('Unknown Studio authoring request; no candidate was associated.')
      const request = normalizeStudioInstanceChanges(input)
      if (request.id !== stored.studio.id || request.expectedRevision !== stored.studio.expectedRevision) throw Error('Candidate does not match the exact Studio request target or base revision.')
      if (stored.studio.bundle && (stored.kind === 'kit' || request.bundle !== undefined)
        && (request.bundle?.name !== stored.studio.bundle.name || request.bundle?.version !== stored.studio.bundle.version)) throw Error('Candidate preview Bundle does not match the exact Studio request pin.')
      const entry = await requireEntry(authoringRequestId, stored.studio)
      if (entry.prepared) {
        if (JSON.stringify(entry.prepared.request) !== JSON.stringify(request)) throw Error('This Studio request already has a different candidate source request. Send a new explicit request for another proposal.')
        return structuredClone(entry.prepared.candidate)
      }
      const requestKey = createHash('sha256').update(JSON.stringify(request)).digest('hex')
      if (entry.pending && entry.pending.requestKey !== requestKey) throw Error('This Studio request already has a different candidate source request. Send a new explicit request for another proposal.')
      if (!entry.pending) entry.pending = { requestKey, promise: (async () => {
        const candidate = await prepareChanges(request)
        await requireEntry(authoringRequestId, entry.studio)
        if (candidate?.id !== request.id || candidate.baseRevision !== request.expectedRevision || candidate.revision !== request.expectedRevision + 1
          || !/^[a-f0-9]{64}$/.test(candidate.digest) || (candidate.preview && candidate.preview.revision !== candidate.revision)) throw Error('S2 returned a mismatched candidate receipt.')
        const prepared = structuredClone({ request, candidate }), bytes = Buffer.byteLength(JSON.stringify(prepared))
        if (bytes + [...entries.values()].reduce((n, item) => n + (item === entry ? 0 : item.bytes), 0) > maximumBytes) throw Error('Studio candidate correlation exceeds its 24 MiB memory budget.')
        entry.prepared = prepared; entry.bytes = bytes
        return candidate
      })() }
      try { return structuredClone(await entry.pending.promise) }
      finally { entry.pending = undefined }
    },
    /** An authoring purpose, not proof of caller identity. Original RPC auth owns access. */
    async prepareForConversation(input) {
      requireOpen()
      if (!input || Object.keys(input).some(key => !['id', 'expectedRevision', 'changes', 'bundle', 'sampleSource'].includes(key))) throw Error('Invalid Studio authoring preparation request.')
      const request = normalizeStudioInstanceChanges(input)
      const record = await readInstance({ id: request.id })
      const bundle = request.bundle ?? (record?.kind === 'bundle' ? record.bundle ?? record.source?.bundle : undefined)
      const studio = studioConversationTarget({ ...binding, id: request.id, expectedRevision: request.expectedRevision, ...(bundle ? { bundle } : {}) })
      await readStudioConversationTarget({ target: studio, binding, readInstance })
      requireOpen()
      const key = createHash('sha256').update(JSON.stringify({ studio, request })).digest('hex')
      let pair = [...entries].find(([, entry]) => entry.conversationRequestKey === key)
      if (!pair) {
        if (entries.size >= maximumRequests) throw Error('Studio request correlation limit reached. No pending or reviewed request was evicted; finish this service lifecycle before opening more requests.')
        const requestId = `host-${randomUUID()}`
        const entry = { studio, kind: record.kind, prepared: null, bytes: 0, conversationRequestKey: key }
        entries.set(requestId, entry)
        pair = [requestId, entry]
      }
      const [requestId, entry] = pair
      const candidate = await service.prepare({ ...request, authoringRequestId: requestId })
      return { ...candidate, authoring: { requestId, studio: structuredClone(entry.studio) } }
    },
    async list({ studio }) {
      requireOpen()
      const selected = studioConversationTarget(studio)
      await readStudioConversationTarget({ target: selected, binding, readInstance })
      requireOpen()
      return { candidates: [...entries].filter(([, entry]) => entry.prepared && JSON.stringify(entry.studio) === JSON.stringify(selected))
        .map(([requestId, entry]) => ({ requestId, studio: structuredClone(entry.studio), digest: entry.prepared.candidate.digest,
          changedFiles: entry.prepared.candidate.diff.map(file => file.path) })) }
    },
    async read({ requestId, studio }) {
      const entry = await requireEntry(requestId, studio)
      return structuredClone({ requestId, studio: entry.studio, prepared: entry.prepared })
    },
    close() { closed = true; entries.clear() },
  }
  return service
}
