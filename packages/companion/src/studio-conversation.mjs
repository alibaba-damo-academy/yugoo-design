/** Studio target metadata only. Source, candidate and save authority stay in S2. */
const object = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key))
const identity = value => typeof value === 'string' && /^[\w.-]{1,128}$/.test(value)
const samePin = (a, b) => a?.name === b?.name && a?.version === b?.version
const changed = () => Object.assign(Error('Studio connection or working copy changed. Reopen its current binding; your unsent message is preserved.'), { code: 'STUDIO_BINDING_CHANGED' })

export function studioConversationScopeMatches(scope, target) {
  return !!target && scope?.record?.id === target.id && scope.record.revision === target.expectedRevision
    && samePin(scope.previewBundle, target.bundle)
}

/** Event-time guard: rendered button state and a later effect are not authority. */
export function studioCandidateForReview(scope, request, prepared) {
  const target = request?.studio
  if (!studioConversationScopeMatches(scope, target) || scope.dirty || scope.busy
    || prepared?.request?.id !== target.id || prepared.request.expectedRevision !== target.expectedRevision
    || prepared.candidate?.id !== target.id || prepared.candidate.baseRevision !== target.expectedRevision
    || !/^[a-f0-9]{64}$/.test(prepared.candidate.digest)) throw changed()
  return structuredClone(prepared)
}

export function studioConversationTarget(value) {
  if (!object(value, ['bindingId', 'threadId', 'id', 'expectedRevision', 'bundle'])
    || !identity(value.bindingId) || !identity(value.threadId) || !identity(value.id)
    || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) throw Error('Invalid Studio conversation target.')
  if (value.bundle !== undefined && (!object(value.bundle, ['name', 'version']) || !/^[a-z][a-z0-9_]*$/.test(value.bundle.name)
    || typeof value.bundle.version !== 'string' || !/^\d+\.\d+$/.test(value.bundle.version))) throw Error('Invalid Studio preview Bundle pin.')
  return Object.freeze({ bindingId: value.bindingId, threadId: value.threadId, id: value.id, expectedRevision: value.expectedRevision,
    ...(value.bundle === undefined ? {} : { bundle: Object.freeze({ name: value.bundle.name, version: value.bundle.version }) }) })
}

/** Editing hints only; source scope and candidate identity remain the exact target. */
export function studioEditingContext(value) {
  if (value === undefined) return undefined
  if (!object(value, ['intent', 'currentFile']) || !['create', 'edit'].includes(value.intent)
    || (value.currentFile !== undefined && (typeof value.currentFile !== 'string' || !value.currentFile || value.currentFile.length > 1024))) {
    throw Error('Invalid Studio editing context.')
  }
  return Object.freeze({ intent: value.intent, ...(value.currentFile === undefined ? {} : { currentFile: value.currentFile }) })
}

/** A URL locates a candidate only; the live connection and S2 validate it again. */
export function studioConversationHandoff(search) {
  const query = new URLSearchParams(search)
  if (!query.has('studioTarget') && !query.has('studioRequest')) return undefined
  if (query.getAll('studioTarget').length !== 1 || query.getAll('studioRequest').length !== 1
    || !identity(query.get('studioRequest'))) throw Error('Invalid Studio candidate link.')
  return { requestId: query.get('studioRequest'), studio: studioConversationTarget(JSON.parse(query.get('studioTarget'))) }
}

/** Read the exact copy in the existing service; never resolve a latest object. */
export async function readStudioConversationTarget({ target, binding, readInstance, context }) {
  const selected = studioConversationTarget(target)
  const editing = studioEditingContext(context)
  if (selected.bindingId !== binding.bindingId || selected.threadId !== binding.threadId) throw changed()
  const record = await readInstance({ id: selected.id })
  if (record?.id !== selected.id || record.revision !== selected.expectedRevision || record.deletedAt
    || !['kit', 'bundle'].includes(record.kind)) throw changed()
  if (selected.bundle && !(record.kind === 'bundle' ? samePin(selected.bundle, record.bundle ?? record.source?.bundle)
    : record.mounts?.some(mount => samePin(selected.bundle, mount.bundle)))) throw changed()
  if (editing?.currentFile && !record.files?.some(file => file.path === editing.currentFile)) throw changed()
  return { ...selected, kind: record.kind, title: record.title, ...(editing ? { context: editing } : {}) }
}

/** UI transport over the already bound Companion; no retry or model client. */
export function createStudioConversationClient({ rpc, requestId, onRequest }) {
  let binding
  const readBinding = async () => {
    const info = await rpc('info', {})
    const value = info?.studioConversation
    if (!identity(info?.threadId) || !identity(value?.bindingId) || value.threadId !== info.threadId) throw Error('Studio conversation binding is unavailable in this Companion.')
    return { bindingId: value.bindingId, threadId: info.threadId, host: info.host }
  }
  return {
    async connect() { const next = await readBinding(); if (binding && (next.bindingId !== binding.bindingId || next.threadId !== binding.threadId)) throw changed(); binding = next; return { ...next } },
    async send({ text, id, expectedRevision, bundle, context, beforeSend }) {
      if (!binding) throw Error('Read the exact Studio conversation binding before sending.')
      if (typeof text !== 'string' || !text.trim() || new TextEncoder().encode(text).length > 32768) throw Error('Provide a Studio request of at most 32 KiB.')
      const editing = studioEditingContext(context)
      const target = studioConversationTarget({ bindingId: binding.bindingId, threadId: binding.threadId, id, expectedRevision, ...(bundle ? { bundle } : {}) })
      const next = await readBinding()
      if (next.bindingId !== binding.bindingId || next.threadId !== binding.threadId) throw changed()
      beforeSend?.()
      const operationId = requestId()
      onRequest?.(operationId, target)
      return rpc('sendPrompt', { text, requestId: operationId, studio: target, ...(editing ? { context: editing } : {}) })
    },
  }
}
