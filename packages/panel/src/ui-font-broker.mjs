/** Document-local ownership for the replacement UI font. No registration on import. */
const registryKey = Symbol.for('dsh-design.ui-font-broker.v1')
const registryVersion = 1

function registries() {
  const existing = globalThis[registryKey]
  if (existing !== undefined) {
    if (existing.version !== registryVersion || !(existing.documents instanceof WeakMap)) {
      throw new Error('Incompatible UI font broker registry')
    }
    return existing.documents
  }
  const value = Object.freeze({ version: registryVersion, documents: new WeakMap() })
  Object.defineProperty(globalThis, registryKey, { value, configurable: false, writable: false })
  return value.documents
}

function descriptorOf(input) {
  if (input === null || typeof input !== 'object') throw new TypeError('UI font descriptor required')
  const descriptor = Object.fromEntries(['family', 'source', 'sha256', 'style', 'weight', 'display'].map(key => [key, input[key]]))
  if (Object.values(descriptor).some(value => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError('UI font descriptor fields must be nonempty strings')
  }
  if (!/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
      !/^url\("data:font\/woff2;base64,[A-Za-z0-9+/]+={0,2}"\)$/.test(descriptor.source)) {
    throw new TypeError('UI font requires a verified SHA and an inline WOFF2 URL source')
  }
  return Object.freeze(descriptor)
}

function identityOf(descriptor) {
  return JSON.stringify([descriptor.family, descriptor.sha256, descriptor.style, descriptor.weight, descriptor.display])
}

function ownerOf(owner) {
  if (typeof owner !== 'object' || owner === null) {
    throw new TypeError('UI font owner must be an opaque object')
  }
  return owner
}

function stateOf(document) {
  const documents = registries()
  let state = documents.get(document)
  if (state === undefined) {
    state = { records: new Map(), owners: new Map(), retiredObjects: new WeakSet() }
    documents.set(document, state)
  }
  return state
}

function settle(record, value) {
  if (!record.settled) {
    record.settled = true
    record.resolve(Object.freeze(value))
  }
}

function live(state, record) {
  return !record.disposed && record.leases.size > 0 && state.records.get(record.key) === record
}

function removeOwnedFace(document, record) {
  if (record.added) {
    document.fonts.delete(record.face)
    record.added = false
  }
}

function releaseLease(document, state, lease) {
  if (lease.released) return
  lease.released = true
  const owned = state.owners.get(lease.owner)
  owned?.delete(lease)
  if (owned?.size === 0) state.owners.delete(lease.owner)
  const record = lease.record
  record.leases.delete(lease)
  if (record.leases.size !== 0) return
  // Invalidate before cleanup: native load promises cannot be cancelled.
  record.disposed = true
  if (state.records.get(record.key) === record) state.records.delete(record.key)
  settle(record, { status: 'released' })
  removeOwnedFace(document, record)
}

async function load(document, state, record, FontFace) {
  for (let attempt = 0; attempt < 2 && live(state, record); attempt += 1) {
    try {
      const descriptor = record.descriptor
      const face = new FontFace(descriptor.family, descriptor.source, {
        style: descriptor.style, weight: descriptor.weight, display: descriptor.display,
      })
      record.face = face
      await face.load()
      if (!live(state, record)) return
      document.fonts.add(face)
      record.added = true
      settle(record, { status: 'loaded' })
      return
    } catch (error) {
      if (!live(state, record)) return
      removeOwnedFace(document, record)
      if (attempt === 1) settle(record, { status: 'failed', error })
    }
  }
}

/**
 * Acquire one component lease. Descriptors must originate from the verified build
 * manifest; this module checks identity/shape, not font bytes or license authority.
 * Readiness is a typed result so the consumer can retain fallback rendering.
 */
export function acquireUiFont(document, input, owner) {
  const descriptor = descriptorOf(input)
  ownerOf(owner)
  if (document == null) {
    return Object.freeze({ ready: Promise.resolve(Object.freeze({ status: 'unavailable' })), release() {} })
  }
  if (typeof document !== 'object' || document.fonts == null ||
      typeof document.fonts.add !== 'function' || typeof document.fonts.delete !== 'function') {
    throw new TypeError('UI font requires a document FontFaceSet')
  }
  const FontFace = document.defaultView?.FontFace
  if (typeof FontFace !== 'function') {
    return Object.freeze({ ready: Promise.resolve(Object.freeze({ status: 'unavailable' })), release() {} })
  }
  const state = stateOf(document)
  if (state.retiredObjects.has(owner)) {
    return Object.freeze({ ready: Promise.resolve(Object.freeze({ status: 'released' })), release() {} })
  }
  const key = identityOf(descriptor)
  let record = state.records.get(key)
  if (record !== undefined && record.descriptor.source !== descriptor.source) {
    throw new Error('UI font descriptor SHA/source identity conflict')
  }
  const fresh = record === undefined
  if (fresh) {
    let resolve
    const ready = new Promise(done => { resolve = done })
    record = { key, descriptor, ready, resolve, leases: new Set(), disposed: false, settled: false, face: undefined, added: false }
    state.records.set(key, record)
  }
  const lease = { owner, record, released: false }
  record.leases.add(lease)
  let owned = state.owners.get(owner)
  if (owned === undefined) { owned = new Set(); state.owners.set(owner, owned) }
  owned.add(lease)
  if (fresh) void load(document, state, record, FontFace)
  return Object.freeze({ ready: record.ready, release: () => releaseLease(document, state, lease) })
}

/** Release this plugin/root generation without touching another owner's leases. */
export function releaseFontOwner(document, owner) {
  ownerOf(owner)
  if (document == null) return
  if (typeof document !== 'object') throw new TypeError('UI font document must be an object')
  const state = stateOf(document)
  state.retiredObjects.add(owner)
  const leases = [...(state.owners.get(owner) ?? [])]
  for (const lease of leases) releaseLease(document, state, lease)
}
