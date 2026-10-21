/** Lease exact upstream registry faces. System/local faces are excluded by the facade. */
const key = Symbol.for('dsh-design.scene-font-broker.v1')
function stateOf(document) {
  let registry = globalThis[key]
  if (registry !== undefined && (registry.version !== 1 || !(registry.documents instanceof WeakMap))) throw Error('Incompatible scene font ownership registry')
  if (registry === undefined) {
    registry = Object.freeze({version: 1, documents: new WeakMap()})
    Object.defineProperty(globalThis, key, {value: registry, configurable: false, writable: false})
  }
  let state = registry.documents.get(document)
  if (!state) { state = {faces: new Map(), owners: new Map(), retired: new WeakSet()}; registry.documents.set(document, state) }
  return state
}
function ownerOf(owner) { if (!owner || typeof owner !== 'object') throw TypeError('Scene font owner must be an opaque object') }
function live(state, record) { return record.leases.size > 0 && state.faces.get(record.face) === record }
function settle(record, status, error) {
  if (!record.settled) {record.settled = true; record.resolve(Object.freeze(error === undefined ? {status} : {status,error}))}
}
function removeOwned(document, record) {
  if (record.added) { document.fonts.delete(record.face); record.added = false }
}
function release(document, state, lease) {
  if (lease.released) return
  lease.released = true
  const owners = state.owners.get(lease.owner); owners?.delete(lease)
  if (owners?.size === 0) state.owners.delete(lease.owner)
  for (const record of lease.records) {
    record.leases.delete(lease)
    if (record.leases.size === 0) {
      if (state.faces.get(record.face) === record) state.faces.delete(record.face)
      settle(record, 'released')
      removeOwned(document, record)
    }
  }
}
/** Insertion remains synchronous, as in upstream loadFontFaces, before native loading. */
export function acquireSceneFontFaces(document, faces, owner) {
  ownerOf(owner)
  if (!document || !document.fonts || !['has','add','delete'].every(name => typeof document.fonts[name] === 'function')) throw TypeError('Scene font requires a document FontFaceSet')
  if (!Array.isArray(faces) || faces.some(face => !face || typeof face.load !== 'function')) throw TypeError('Scene registry requires exact FontFace objects')
  const state = stateOf(document)
  if (state.retired.has(owner)) return Object.freeze({ready:Promise.resolve(Object.freeze({status:'released'})),release(){}})
  const lease = {owner, records:[], released:false}, fresh=[]
  const owned = state.owners.get(owner) ?? new Set(); owned.add(lease); state.owners.set(owner,owned)
  try {
    for (const face of new Set(faces)) {
      let record = state.faces.get(face)
      if (!record) {
        let resolve; const ready=new Promise(done => {resolve=done})
        record={face,leases:new Set(),added:false,ready,resolve,settled:false}
        state.faces.set(face,record); fresh.push(record)
      }
      record.leases.add(lease); lease.records.push(record)
      if (fresh.includes(record) && !document.fonts.has(face)) {document.fonts.add(face);record.added=true}
    }
    for (const record of fresh) {
      void Promise.resolve().then(() => live(state,record) ? record.face.load() : undefined).then(() => {
        if (live(state,record)) settle(record,'loaded')
      }, error => {
        if (live(state,record)) {removeOwned(document,record);settle(record,'failed',error)}
      })
    }
  } catch (error) {release(document,state,lease);throw error}
  const ready=Promise.all(lease.records.map(record=>record.ready)).then(results => results.find(result=>result.status==='failed') ?? results.find(result=>result.status==='released') ?? Object.freeze({status:'loaded'}))
  return Object.freeze({ready,release:()=>release(document,state,lease)})
}
/** Snapshot identities fence a previously queued scene load across unload/reacquire. */
export function sceneFontGeneration(document, faces) {
  const state=stateOf(document), records=[...new Set(faces)].map(face=>state.faces.get(face))
  return () => records.length > 0 && records.every(record=>record !== undefined && live(state,record))
}
export function releaseSceneFontOwner(document,owner) {
  ownerOf(owner); if (!document) return
  const state=stateOf(document);state.retired.add(owner)
  for (const lease of [...(state.owners.get(owner) ?? [])]) release(document,state,lease)
}
