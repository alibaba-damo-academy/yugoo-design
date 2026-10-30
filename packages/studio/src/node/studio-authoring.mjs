/**
 * Read/prepare capability for one trusted Studio instance revision.
 *
 * The host authenticates and binds the native invocation before constructing this
 * adapter. Scope is never a model argument. Pass only the existing instance
 * read/readFile/prepareChanges ports and a same-build component catalog reader
 * returning the JSON projection used by design_list_panel_components.
 *
 * read({paths?}) returns coherent, bounded source text plus the actual catalog.
 * allowedPaths seeds the initial read; the current instance and revision bind
 * subsequent legal reads, replacements and new files.
 * prepare({changes}) returns {request,candidate}: request.changes contains full
 * replacement files for the existing UI's saveChanges path, while candidate is
 * S1's exact diff/preview/digest. Neither operation saves, publishes, dispatches
 * a model, or proves native execution. This first capability excludes deletion.
 */
import { normalizeStudioInstanceChanges, STUDIO_INSTANCE_CHANGE_LIMITS } from '../instance-changes.ts'

const object = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Reflect.ownKeys(value).some(key => !keys.includes(key))) throw new Error(`Invalid ${label}; scope and authority cannot be supplied by the caller.`)
  return value
}
const samePin = (a, b) => a?.name === b?.name && a?.version === b?.version
const changed = () => new Error('Authoring instance changed. Reopen and explicitly bind the current revision; do not retry this scope automatically.')

export function createStudioAuthoring({ scope, instances, readComponents } = {}) {
  object(scope, ['id', 'expectedRevision', 'allowedPaths', 'bundle'], 'trusted authoring scope')
  if (!instances || !['read', 'readFile', 'prepareChanges'].every(key => typeof instances[key] === 'function')
    || typeof readComponents !== 'function' || !Array.isArray(scope.allowedPaths)) throw new Error('Authoring requires existing instance read/prepare ports, an initial reading focus and the actual component catalog reader.')
  // Reuse S1's path, pin, revision and count guards; copy before any host await.
  const normalized = normalizeStudioInstanceChanges({ id: scope.id, expectedRevision: scope.expectedRevision,
    changes: scope.allowedPaths.map(path => ({ path, content: '' })), ...(scope.bundle === undefined ? {} : { bundle: scope.bundle }) })
  const binding = Object.freeze({ id: normalized.id, expectedRevision: normalized.expectedRevision,
    allowedPaths: Object.freeze(normalized.changes.map(change => change.path)), ...(normalized.bundle ? { bundle: normalized.bundle } : {}) })
  // Do not expose the full mutable service, its repository, or any write method.
  const readInstance = instances.read.bind(instances), readFile = instances.readFile.bind(instances)
  const prepareChanges = instances.prepareChanges.bind(instances)
  const requestFor = changes => normalizeStudioInstanceChanges({ id: binding.id, expectedRevision: binding.expectedRevision,
    changes, ...(binding.bundle ? { bundle: binding.bundle } : {}) })
  const checkPaths = paths => {
    const normalized = requestFor(paths.map(path => ({ path, content: '' }))).changes.map(change => change.path)
    return normalized
  }
  const current = async () => {
    const record = await readInstance({ id: binding.id })
    if (!record || record.id !== binding.id || record.revision !== binding.expectedRevision || record.deletedAt) throw changed()
    if (!['kit', 'bundle'].includes(record.kind) || !Array.isArray(record.files)) throw new Error('Authoring requires a current complete-source working copy.')
    if (binding.bundle && (record.kind === 'bundle' ? !samePin(binding.bundle, record.bundle)
      : !record.mounts?.some(mount => samePin(binding.bundle, mount.bundle)))) throw new Error('Authoring preview Bundle is outside this exact instance.')
    return record
  }
  const components = async () => {
    // No cache, fallback vocabulary or second component registration authority.
    const value = await readComponents()
    if (!value || !Array.isArray(value.components) || !value.components.length) throw new Error('The actual authoring component catalog is unavailable.')
    const text = JSON.stringify(value)
    if (Buffer.byteLength(text) > STUDIO_INSTANCE_CHANGE_LIMITS.sampleBytes) throw new Error('Authoring component catalog exceeds the 256 KiB response budget.')
    return JSON.parse(text)
  }
  return Object.freeze({
    async read(input = {}) {
      object(input, ['paths'], 'authoring read request')
      if (input.paths !== undefined && !Array.isArray(input.paths)) throw new Error('Select an exact list of scoped source paths.')
      const paths = checkPaths(input.paths ?? binding.allowedPaths)
      const record = await current()
      const selected = paths.map(path => ({ path, file: record.files.find(file => file.path === path) }))
      if (selected.some(({ file }) => file && (!file.editable || !Number.isSafeInteger(file.bytes) || file.bytes < 0
        || file.bytes > STUDIO_INSTANCE_CHANGE_LIMITS.fileBytes))) throw new Error('Scoped source must be editable UTF-8 text of at most 1 MiB per file.')
      if (selected.reduce((bytes, { file }) => bytes + (file?.bytes ?? 0), 0) > STUDIO_INSTANCE_CHANGE_LIMITS.totalBytes) throw new Error('Authoring read exceeds the 4 MiB text budget; select fewer paths.')
      const catalog = await components()
      const files = await Promise.all(selected.map(async ({ path, file }) => {
        if (!file) return { path, exists: false }
        const value = await readFile({ id: binding.id, path })
        if (value?.id !== binding.id || value.revision !== binding.expectedRevision || value.path !== path) throw changed()
        return { path, exists: true, content: value.content }
      }))
      const existing = files.filter(file => file.exists)
      if (existing.length) requestFor(existing.map(({ path, content }) => ({ path, content })))
      // Monotonic CAS revisions plus every file's receipt and this final check
      // prevent returning a mixed revision. This does not acquire a write lock.
      await current()
      return { scope: binding, files, components: catalog }
    },
    async prepare(input) {
      object(input, ['changes'], 'authoring prepare request')
      if (!Array.isArray(input.changes)) throw new Error('Provide scoped complete-file replacements.')
      for (const change of input.changes) {
        object(change, ['path', 'content'], 'authoring file replacement')
        if (change.content === null) throw new Error('File deletion is not granted by this authoring capability.')
      }
      const request = requestFor(input.changes)
      await current()
      const catalog = await components()
      // S1 owns full-source overlay, Kit guards, real Core preview, diff and digest.
      const candidate = await prepareChanges(request)
      await current()
      if (candidate?.id !== binding.id || candidate.baseRevision !== binding.expectedRevision
        || candidate.revision !== binding.expectedRevision + 1 || typeof candidate.valid !== 'boolean'
        || !/^[a-f0-9]{64}$/.test(candidate.digest) || !Array.isArray(candidate.diagnostics) || !Array.isArray(candidate.diff)
        || candidate.diff.some(file => !request.changes.some(change => change.path === file.path))
        || (candidate.preview && candidate.preview.revision !== candidate.revision)) throw new Error('Prepared candidate does not match this authoring revision and file set.')
      return { scope: binding, components: catalog, request, candidate: structuredClone(candidate) }
    },
  })
}
