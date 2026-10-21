/** Local storage ports for the shared Studio draft service. No project writes. */
import { readFile, readdir, lstat, realpath, mkdir, open, rename, unlink, rmdir } from 'node:fs/promises'
import { join, resolve, relative, sep, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { StudioPanelDraftService } from '../../studio/src/panel-drafts.ts'
import { StudioKitDraftService } from '../../studio/src/kit-drafts.ts'
import { readStudioContentArchive, readStudioArchiveResource } from '../../studio/src/content-archive.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HASH = /^[0-9a-f]{64}$/
const MAX_SOURCE_BYTES = 16 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
const inside = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) }
const hash = value => createHash('sha256').update(value).digest('hex')

/** Explicit stateRoot only; neither the installed Kit nor project is a storage target. */
export async function createStudioPanelDrafts({ stateRoot, kitRoot, readInstalledKit, readInstalledBundle }) {
  const { repository, sources } = await createStudioDraftPorts({ stateRoot, kitRoot, readInstalledKit, readInstalledBundle }, 'panel')
  return new StudioPanelDraftService(repository, sources)
}

export async function createStudioKitDrafts({ stateRoot, kitRoot, readInstalledKit, readInstalledBundle }) {
  const { repository, sources } = await createStudioDraftPorts({ stateRoot, kitRoot, readInstalledKit, readInstalledBundle }, 'kit')
  return new StudioKitDraftService(repository, sources)
}

/** Same locking, snapshot and confinement implementation; separate draft namespaces. */
export async function createStudioDraftPorts({ stateRoot, kitRoot, readInstalledKit, readInstalledBundle }, kind) {
  if (!['kit', 'panel', 'instance'].includes(kind)) throw new Error('Select the Kit, Panel or instance draft namespace.')
  if (!isAbsolute(stateRoot)) throw new Error('Studio requires an explicit absolute state directory.')
  const kitRootReal = kind === 'instance' && kitRoot === undefined ? undefined : await realpath(kitRoot)
  if (kitRootReal && inside(kitRootReal, resolve(stateRoot))) throw new Error('Studio drafts must not live inside the installed Kit.')
  await mkdir(stateRoot, { recursive: true, mode: 0o700 })
  const state = await realpath(stateRoot)
  const root = join(state, `studio-${kind}-drafts`)
  const format = `studio-${kind}-draft/v1`
  if (kitRootReal && inside(kitRootReal, root)) throw new Error('Studio drafts must not live inside the installed Kit.')
  await mkdir(root, { recursive: true, mode: 0o700 })
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Studio storage cannot be a symlink.')
  const snapshots = join(root, 'snapshots')
  await mkdir(snapshots, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  if (!(await lstat(snapshots)).isDirectory() || (await lstat(snapshots)).isSymbolicLink()) throw new Error('Unsafe Studio snapshot directory.')

  const withLock = async operation => {
    const lock = join(root, 'write.lock')
    try { await mkdir(lock, { mode: 0o700 }) }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Studio is being saved elsewhere. Retry; after a crash, stop Studio before clearing its empty write.lock directory.'); throw error }
    try { return await operation() } finally { await rmdir(lock) }
  }
  const readRegular = async (file, limit) => {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Invalid or oversized Studio file.')
    return readFile(file, 'utf8')
  }
  const writeAtomic = async (file, text) => {
    const temporary = join(root, `${randomUUID()}.tmp`)
    let handle
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(text, 'utf8'); await handle.sync(); await handle.close(); handle = undefined
      await rename(temporary, file)
    } finally {
      await handle?.close()
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
  }
  const draftPath = id => {
    if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Invalid Studio draft identity.')
    return join(root, `${id}.json`)
  }
  const read = async id => {
    const record = JSON.parse(await readRegular(draftPath(id), MAX_DOCUMENT_BYTES))
    const pin = value => typeof value?.name === 'string' && typeof value?.version === 'string'
    const validContent = kind === 'panel'
      ? typeof record.panelSource === 'string' && typeof record.sampleSource === 'string' && pin(record.kit) && pin(record.bundle)
      : kind === 'instance'
        ? ['kit', 'bundle'].includes(record.kind)
          && (record.recordVersion === 2
            ? pin(record[record.kind]) && typeof record.sourceId === 'string'
              && record.sourceId === `local:${record.kind}:${record[record.kind].name}`
              && (record.kind !== 'bundle' || typeof record.runtimeName === 'string')
            : (record.recordVersion === undefined || record.recordVersion === 1) && pin(record.source?.kit)
              && (record.kind !== 'bundle' || (pin(record.source?.bundle) && typeof record.bundlePath === 'string')))
          && typeof record.title?.zh === 'string' && typeof record.title?.en === 'string'
          && record.overlays !== null && typeof record.overlays === 'object' && !Array.isArray(record.overlays)
          && Object.values(record.overlays).every(value => typeof value === 'string')
          && Array.isArray(record.mounts) && record.mounts.every(mount => pin(mount.bundle))
          && (record.recordVersion !== 2 || record.mounts.every(mount => typeof mount.bindingKey === 'string'
            && HASH.test(mount.bundle.source?.snapshot) && typeof mount.bundle.source?.sourceId === 'string'
            && (mount.bundle.instanceId === undefined || UUID.test(mount.bundle.instanceId))
            && (mount.bundle.revision === undefined || (Number.isSafeInteger(mount.bundle.revision) && mount.bundle.revision >= 0))))
        : typeof record.mindsetSource === 'string' && (record.relationsSource === null || typeof record.relationsSource === 'string')
        && pin(record.baseKit) && Array.isArray(record.mounts) && record.mounts.every(pin)
    if (record.format !== format || record.id !== id || !Number.isSafeInteger(record.revision) || record.revision < 0
      || !HASH.test(record.baseSnapshot) || typeof record.confirmed !== 'boolean' || !validContent) throw new Error('Invalid Studio draft record.')
    const { format: _format, ...value } = record
    return value
  }
  const persist = async record => {
    const text = JSON.stringify({ format, ...record })
    if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) throw new Error('Studio draft is too large.')
    await writeAtomic(draftPath(record.id), text)
    return record
  }
  const repository = {
    read,
    async list() {
      const ids = (await readdir(root)).filter(name => name.endsWith('.json') && UUID.test(name.slice(0, -5))).sort()
      return Promise.all(ids.map(name => read(name.slice(0, -5))))
    },
    create: content => withLock(() => createUnlocked(content)),
    replace: (id, expectedRevision, content) => withLock(() => replaceUnlocked(id, expectedRevision, content)),
  }
  const createUnlocked = async content => {
      if ((await repository.list()).length >= 128) throw new Error('Studio draft limit reached (128). Archive unused drafts before creating more.')
      return persist({ ...content, id: randomUUID(), revision: 0 })
  }
  const replaceUnlocked = async (id, expectedRevision, content) => {
      const current = await read(id)
      if (current.revision !== expectedRevision || current.confirmed) throw new Error('Studio draft changed or was confirmed elsewhere. Reopen it before saving.')
      return persist({ ...content, id, revision: expectedRevision + 1 })
  }
  // Instance reference checks and their single-record write share this lock.
  // This is a guarded transaction, not a multi-record rollback mechanism.
  if (kind === 'instance') repository.transaction = operation => withLock(() => operation({
    read, list: repository.list, create: createUnlocked, replace: replaceUnlocked,
    retainTree: entries => retainEntriesUnlocked(checkEntries(entries)),
    async migrate(id, expectedRevision, content) {
      const current = await read(id)
      if (current.revision !== expectedRevision || current.recordVersion === 2) throw new Error('Legacy instance changed or was already migrated.')
      const backup = join(root, `${id}.legacy-v1.json`)
      const original = JSON.stringify({ format, ...current })
      // A recoverable original is durable before replacing the visible record.
      try { if (await readRegular(backup, MAX_DOCUMENT_BYTES) !== original) throw new Error('Existing legacy recovery backup differs from the current record.') }
      catch (error) { if (error.code !== 'ENOENT') throw error; await writeAtomic(backup, original) }
      return replaceUnlocked(id, expectedRevision, content)
    },
  }))
  const openSnapshot = async id => {
    if (typeof id !== 'string' || !HASH.test(id)) throw new Error('Invalid Studio source snapshot.')
    const text = await readRegular(join(snapshots, `${id}.json`), MAX_SOURCE_BYTES * 2)
    if (hash(text) !== id) throw new Error('Studio source snapshot integrity check failed.')
    const document = JSON.parse(text)
    const closure = Array.isArray(document) ? undefined : document
    if (closure && closure.format !== 'studio-source-closure/v1') throw new Error('Invalid Studio source closure.')
    const entries = closure ? closure.entries : document
    const files = new Map(entries)
    // Virtual root is only used by the existing loader; no filesystem fallback.
    const virtualRoot = resolve(root, 'virtual-source', id)
    const keyOf = path => {
      const absolute = resolve(path)
      if (!inside(virtualRoot, absolute)) throw new Error('Preview path escapes its source snapshot.')
      return relative(virtualRoot, absolute).split(sep).join('/')
    }
    const children = path => {
      const key = keyOf(path), prefix = key ? `${key}/` : ''
      return [...new Set([...files.keys()].filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length).split('/')[0]))].sort()
    }
    const snapshotRoot = closure ? resolve(virtualRoot, closure.kitPath) : virtualRoot
    keyOf(snapshotRoot)
    const loadOptions = closure ? { sourceId: closure.sourceId, bundles: closure.bundles.map(bundle => {
      const rootDir = resolve(virtualRoot, bundle.path); keyOf(rootDir)
      return { name: bundle.name, version: bundle.version, sourceId: bundle.sourceId, rootDir }
    }) } : undefined
    return { id, root: snapshotRoot, storageRoot: virtualRoot, ...(loadOptions ? { loadOptions } : {}), fs: {
      async readBytes(path) { const bytes = files.get(keyOf(path)); return bytes === undefined ? undefined : Buffer.from(bytes, 'base64') },
      async readText(path) { const bytes = files.get(keyOf(path)); return bytes === undefined ? undefined : new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes, 'base64')) },
      async readResource(path) { const bytes = files.get(keyOf(path)); return bytes === undefined ? undefined : readStudioArchiveResource(path, Buffer.from(bytes, 'base64')) },
      async listDir(path) { return children(path) },
      async isDirectory(path) { return children(path).length > 0 },
      async realPath(path) { keyOf(path); return resolve(path) },
    } }
  }
  // One canonical snapshot writer for installed capture and archive adoption.
  // The archive reader owns regular-file paths, canonical base64 and byte hashes.
  const checkEntries = entries => {
    if (!Array.isArray(entries) || entries.length > 4096) throw new Error('Source tree exceeds 4096 files.')
    const seen = new Set(); let bytes = 0
    return entries.map(entry => {
      const { path, base64 } = entry ?? {}
      if (typeof path !== 'string' || !path || path.length > 1024 || /[\\:\u0000-\u001f\u007f]/u.test(path)
        || path.split('/').some(part => !part || ['.', '..', '.git', 'node_modules'].includes(part)) || seen.has(path)
        || typeof base64 !== 'string' || Buffer.from(base64, 'base64').toString('base64') !== base64) throw new Error('Invalid source tree entry.')
      seen.add(path); bytes += Buffer.byteLength(base64, 'base64')
      if (bytes > MAX_SOURCE_BYTES) throw new Error('Source tree exceeds 16 MiB.')
      return [path, base64]
    }).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  }
  const retainEntriesUnlocked = async (entries, closure) => {
    const text = JSON.stringify(closure ? { ...closure, entries } : entries), id = hash(text), destination = join(snapshots, `${id}.json`)
      try { if (hash(await readRegular(destination, MAX_SOURCE_BYTES * 2)) !== id) throw new Error('Studio snapshot content mismatch.'); return openSnapshot(id) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      const retained = (await readdir(snapshots)).filter(name => name.endsWith('.json') && HASH.test(name.slice(0, -5)))
      const countLimit = kind === 'instance' ? 1024 : 16
      if (retained.length >= countLimit) throw new Error(`Studio source snapshot limit reached (${countLimit}).`)
      if (kind === 'instance') {
        let total = Buffer.byteLength(text)
        for (const name of retained) total += (await lstat(join(snapshots, name))).size
        if (total > 128 * 1024 * 1024) throw new Error('Studio instance snapshots exceed the 128 MiB retained-storage limit.')
      }
      await writeAtomic(destination, text)
    return openSnapshot(id)
  }
  const retainEntries = (entries, closure) => withLock(() => retainEntriesUnlocked(entries, closure))
  const sources = {
    open: openSnapshot,
    ...(kind === 'instance' ? { retainTree: entries => withLock(() => retainEntriesUnlocked(checkEntries(entries))) } : {}),
    /** Full Kit envelope only: standalone Bundles require an explicit composed Kit context. */
    async retain(archiveSource) {
      const archive = readStudioContentArchive(archiveSource)
      if (archive.kind !== 'kit') throw new Error('Retain requires a complete Kit archive; compose standalone Bundle context explicitly.')
      return retainEntries(archive.files.map(file => [file.path, file.base64]))
    },
    async capture(pin) {
      if (!kitRootReal || typeof readInstalledKit !== 'function') throw new Error('Installed Kit capture is not configured for this storage port.')
      const installed = await readInstalledKit()
      if (pin.name !== installed.name || pin.version !== String(installed.version)) throw new Error('Select an exact installed Kit version.')
      const entries = [], ignored = new Set(['.git', 'node_modules'])
      let total = 0, nodes = 0
      const walk = async (directory, base, prefix) => {
        if (++nodes > 8192 || relative(base, directory).split(sep).length > 32) throw new Error('Studio source tree exceeds directory limits.')
        for (const name of (await readdir(directory)).sort()) {
          if (ignored.has(name)) continue
          const file = join(directory, name), info = await lstat(file)
          if (info.isSymbolicLink()) throw new Error('Studio cannot snapshot source symlinks.')
          if (info.isDirectory()) await walk(file, base, prefix)
          else if (info.isFile()) {
            if (total + info.size > MAX_SOURCE_BYTES || entries.length >= 4096) throw new Error('Kit preview snapshot exceeds 16 MiB or 4096 files.')
            const bytes = await readFile(file)
            total += bytes.length
            if (total > MAX_SOURCE_BYTES) throw new Error('Kit preview snapshot exceeds 16 MiB.')
            entries.push([prefix + relative(base, file).split(sep).join('/'), bytes.toString('base64')])
          } else throw new Error('Studio sources must be regular files or directories.')
        }
      }
      const sourceRoot = resolve(installed.sourceRoot ?? kitRootReal)
      if (await realpath(sourceRoot) !== sourceRoot) throw new Error('Studio cannot snapshot source symlinks.')
      const manifest = await readFile(join(sourceRoot, 'kit.yaml'), 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
      if (manifest === undefined) {
        await walk(sourceRoot, sourceRoot, '')
        return retainEntries(entries)
      }
      if (!Array.isArray(installed.skills)) throw new Error('Independent capture requires compiled mounted Bundles.')
      const kitPath = `kits/${installed.name}`, bundles = []
      await walk(sourceRoot, sourceRoot, `${kitPath}/`)
      for (const skill of installed.skills) {
        const pin = { name: skill.catalogName ?? skill.name, version: String(skill.version) }
        const retained = await readInstalledBundle?.(pin)
        const bundleRoot = resolve(retained?.resourceRoot ?? skill.resourceRoot ?? '')
        if (!retained?.resourceRoot && !skill.resourceRoot) throw new Error('Mounted Bundle source root is missing.')
        if (await realpath(bundleRoot) !== bundleRoot) throw new Error('Studio cannot snapshot source symlinks.')
        const path = `bundles/${pin.name}`
        await walk(bundleRoot, bundleRoot, `${path}/`)
        bundles.push({ ...pin, path, sourceId: retained?.sourceId ?? 'companion:explicit-kit' })
      }
      const checked = checkEntries(entries.map(([path, base64]) => ({ path, base64 })))
      return retainEntries(checked, { format: 'studio-source-closure/v1', kitPath, sourceId: 'companion:explicit-kit', bundles })
    },
  }
  return { repository, sources }
}
