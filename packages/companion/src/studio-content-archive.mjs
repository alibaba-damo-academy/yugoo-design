/**
 * Trusted byte snapshots and inert import preparation. No extraction/installation.
 * Offline envelope limits do not expand Companion's existing 12 MiB HTTP limit.
 * Exports retain no source copies; imports retain only envelopes and receipts.
 * Limits: 32 immutable new identities / 128 MiB total, no automatic deletion.
 */
import { constants } from 'node:fs'
import { lstat, realpath, readdir, mkdir, open, link, unlink, rmdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { exportStudioContentArchive, prepareStudioContentImport, readStudioContentArchive, readStudioArchiveResource } from '../../studio/src/content-archive.ts'
import { loadStudioKit } from '../../studio/src/load.ts'
import { assertWindowsPrivate, ensureWindowsPrivateDirectory } from './windows-private-storage.mjs'

const MAX_BYTES = 16 * 1024 * 1024, MAX_FILES = 4096
const MAX_RECORD = 33 * 1024 * 1024, MAX_STORE = 128 * 1024 * 1024, MAX_IMPORTS = 32
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) }
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs

async function noLinks(path) {
  let current = resolve(path)
  while (true) {
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw Error('Archive paths must not use source or storage symlinks.')
    const parent = dirname(current); if (parent === current) break; current = parent
  }
  if (await realpath(path) !== resolve(path)) throw Error('Archive path must be canonical, not an alias.')
}
async function privateDirectory(path) {
  await noLinks(path)
  if (process.platform === 'win32') return assertWindowsPrivate(path, { directory: true })
  const info = await lstat(path)
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('Archive storage requires an existing private owned directory; permissions are not repaired.')
  return info
}
async function regularBytes(path, limit, { privateFile = false } = {}) {
  await noLinks(path)
  const before = await lstat(path)
  if (!before.isFile() || before.size > limit) throw Error('Archive source must be a bounded regular file.')
  if (privateFile) {
    if (process.platform === 'win32') await assertWindowsPrivate(path)
    else if (before.uid !== process.getuid() || (before.mode & 0o177)) throw Error('Archive record permissions must be private and non-executable.')
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    if (!same(before, await handle.stat())) throw Error('Archive file identity changed before reading.')
    const bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw Error('Archive source changed during reading.')
      offset += bytesRead
    }
    if (!same(before, await handle.stat()) || !same(before, await lstat(path))) throw Error('Archive file changed during reading.')
    return { bytes, stat: before }
  } finally { await handle.close() }
}

/** Complete immutable bytes retained in memory before any Core/content parsing. */
async function capture(kitRoot, budget = { bytes: 0, files: 0 }) {
  const files = new Map(), stats = new Map()
  const visit = async directory => {
    await noLinks(directory)
    stats.set(directory, await lstat(directory))
    for (const name of (await readdir(directory)).sort()) {
      // Repository metadata and package-manager dependencies are not Kit content.
      if (name === '.git' || name === 'node_modules') continue
      const path = join(directory, name), info = await lstat(path)
      if (info.isSymbolicLink()) throw Error('Archive snapshot refuses source symlinks.')
      if (info.isDirectory()) await visit(path)
      else {
        if (budget.files >= MAX_FILES) throw Error('Archive snapshot exceeds 4096 files.')
        const { bytes, stat } = await regularBytes(path, MAX_BYTES - budget.bytes)
        budget.bytes += bytes.length; budget.files++
        const key = relative(kitRoot, path).split(sep).join('/')
        files.set(key, bytes); stats.set(path, stat)
      }
    }
  }
  await visit(kitRoot)
  for (const [path, stat] of stats) if (!same(stat, await lstat(path))) throw Error('Archive snapshot source changed before completion.')
  const keyOf = path => {
    const absolute = resolve(path)
    if (!inside(kitRoot, absolute)) throw Error('Archive loader escaped its captured source.')
    return relative(kitRoot, absolute).split(sep).join('/')
  }
  const children = path => {
    const key = keyOf(path), prefix = key ? `${key}/` : ''
    return [...new Set([...files.keys()].filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length).split('/')[0]))].sort()
  }
  return { root: kitRoot, async listFiles() { return [...files.keys()] }, async readBytes(path) {
    const bytes = files.get(keyOf(path)); if (!bytes) throw Error('Missing captured source file.'); return Buffer.from(bytes)
  }, fs: {
    async readText(path) { const bytes = files.get(keyOf(path)); return bytes === undefined ? undefined : new TextDecoder('utf8', { fatal: true }).decode(bytes) },
    async readResource(path) { const bytes = files.get(keyOf(path)); return bytes === undefined ? undefined : readStudioArchiveResource(path, bytes) },
    async listDir(path) { return children(path) }, async isDirectory(path) { return children(path).length > 0 },
    async realPath(path) { keyOf(path); return resolve(path) },
  } }
}

/** Host passes trusted roots; request bodies never supply filesystem destinations. */
export async function createStudioContentArchives({ stateRoot, kitRoot, readInstalledKit, sourceId, bundles }) {
  if (!isAbsolute(stateRoot) || !isAbsolute(kitRoot) || typeof readInstalledKit !== 'function') throw Error('Archives require trusted absolute roots and an installed Kit reader.')
  stateRoot = resolve(stateRoot); kitRoot = resolve(kitRoot)
  await noLinks(kitRoot)
  if (!(await lstat(kitRoot)).isDirectory()) throw Error('Installed Kit root must be a directory.')
  if (inside(kitRoot, stateRoot) || inside(stateRoot, kitRoot)) throw Error('Archive state and installed Kit must not be nested.')
  await privateDirectory(stateRoot)
  const root = join(stateRoot, 'studio-content-imports')
  if (process.platform === 'win32') await ensureWindowsPrivateDirectory(root)
  else await mkdir(root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  await privateDirectory(root)
  const captureInstalled = async () => {
    // Compiled Kit definitions contain functions; retain only their exact pin.
    const installed = readInstalledKit(), selected = { name: installed?.name, version: String(installed?.version) }
    const budget = { bytes: 0, files: 0 }, snapshot = await capture(kitRoot, budget)
    snapshot.sourceId = sourceId
    if (bundles !== undefined) {
      if (!Array.isArray(bundles) || !Array.isArray(installed.skills)) throw Error('Independent archive capture requires a compiled Kit and trusted Bundle sources.')
      snapshot.bundles = []
      for (const skill of installed.skills) {
        const name = skill.catalogName ?? skill.name, version = String(skill.version)
        const matches = bundles.filter(bundle => bundle.name === name && bundle.version === version)
        if (matches.length !== 1) throw Error('Missing or ambiguous exact Bundle source for archive.')
        const binding = matches[0]
        if (!isAbsolute(binding.rootDir) || typeof binding.sourceId !== 'string' || !binding.sourceId) throw Error('Bundle archive sources require trusted absolute roots and source identity.')
        const bundleRoot = resolve(binding.rootDir)
        if (inside(bundleRoot, stateRoot) || inside(stateRoot, bundleRoot)) throw Error('Archive state and Bundle sources must not be nested.')
        snapshot.bundles.push({ name, version, sourceId: binding.sourceId, snapshot: await capture(bundleRoot, budget) })
      }
    }
    const captured = await loadStudioKit({
      readText: path => sourceFor(path).fs.readText(path),
      readResource: path => sourceFor(path).fs.readResource(path),
      listDir: path => sourceFor(path).fs.listDir(path),
      isDirectory: path => sourceFor(path).fs.isDirectory(path),
      realPath: path => sourceFor(path).fs.realPath(path),
    }, snapshot.root, { sourceId, bundles: snapshot.bundles?.map(bundle => ({ name: bundle.name, version: bundle.version,
      rootDir: bundle.snapshot.root, sourceId: bundle.sourceId })) })
    function sourceFor(path) {
      const sources = [...(snapshot.bundles ?? []).map(bundle => bundle.snapshot), snapshot].sort((a,b) => b.root.length - a.root.length)
      const source = sources.find(source => inside(source.root, resolve(path)))
      if (!source) throw Error('Archive loader escaped captured sources.')
      return source
    }
    if (captured.name !== selected.name || String(captured.version) !== selected.version) throw Error('Captured source disagrees with installed Kit pin.')
    return { snapshot, selected }
  }
  const pathOf = id => { if (typeof id !== 'string' || !UUID.test(id)) throw Error('Invalid import identity.'); return join(root, `${id}.json`) }
  const contextHash = async snapshot => {
    const entries = []
    for (const source of [{ snapshot, sourceId: snapshot.sourceId }, ...(snapshot.bundles ?? [])]) {
      const files = []
      for (const path of (await source.snapshot.listFiles()).sort()) files.push([path, hash(await source.snapshot.readBytes(join(source.snapshot.root, path)))])
      entries.push({ name: source.name, version: source.version, sourceId: source.sourceId, files })
    }
    return hash(JSON.stringify(entries))
  }
  const withLock = async operation => {
    await privateDirectory(root)
    const lock = join(root, 'write.lock')
    try { await mkdir(lock, { mode: 0o700 }) } catch (error) { if (error.code === 'EEXIST') throw Error('Archive store is busy; retry after the existing writer settles.'); throw error }
    try { return await operation() } finally { await rmdir(lock) }
  }
  const readImport = async id => {
    await privateDirectory(root)
    const { bytes } = await regularBytes(pathOf(id), MAX_RECORD, { privateFile: true })
    const record = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes))
    const { sha256, ...data } = record
    if (record.format !== 'studio-content-import/v1' || record.id !== id || hash(JSON.stringify(data)) !== sha256
      || record.executionGranted !== false || typeof record.requiresTrustReview !== 'boolean'
      || typeof record.validation?.valid !== 'boolean' || !Array.isArray(record.validation?.diagnostics)) throw Error('Import record integrity or shape mismatch.')
    readStudioContentArchive(JSON.stringify(record.archive))
    return record
  }
  return {
    async exportArchive(request) {
      const input = structuredClone(request)
      const { snapshot, selected: installed } = await captureInstalled()
      // A Kit export must resolve the currently installed pin, not a guessed path.
      if (input.kind === 'kit' && (input.pin?.name !== installed.name || input.pin?.version !== String(installed.version))) throw Error('Select the exact installed Kit pin.')
      return exportStudioContentArchive(snapshot, input)
    },
    async prepareImport({ source, validateAgainstInstalled = false }) {
      if (typeof validateAgainstInstalled !== 'boolean') throw Error('Explicit validation-context selection must be boolean.')
      // Parse first so oversized/unsafe input does not cause a source snapshot read.
      const archive = readStudioContentArchive(source)
      const validationContext = archive.kind === 'bundle' && validateAgainstInstalled ? (await captureInstalled()).snapshot : undefined
      const prepared = await prepareStudioContentImport(JSON.stringify(archive), { validationContext })
      return withLock(async () => {
        const names = await readdir(root)
        if (names.filter(name => name.endsWith('.json')).length >= MAX_IMPORTS) throw Error('Archive import limit reached (32).')
        let stored = 0
        for (const name of names) { const info = await lstat(join(root, name)); if (info.isSymbolicLink()) throw Error('Unsafe archive store member.'); if (info.isFile()) stored += info.size }
        const id = randomUUID(), data = { format: 'studio-content-import/v1', id, archive: prepared.archive,
          ...(validationContext ? { validationContextHash: await contextHash(validationContext) } : {}),
          validation: prepared.validation, executionGranted: false, requiresTrustReview: prepared.requiresTrustReview }
        const json = JSON.stringify({ ...data, sha256: hash(JSON.stringify(data)) })
        if (Buffer.byteLength(json) > MAX_RECORD || stored + Buffer.byteLength(json) > MAX_STORE) throw Error('Archive record/store size limit exceeded.')
        const temporary = join(root, `${randomUUID()}.tmp`)
        let handle
        try {
          handle = await open(temporary, 'wx', 0o600)
          await handle.writeFile(json, 'utf8'); await handle.sync(); await handle.close(); handle = undefined
          if (process.platform === 'win32') await assertWindowsPrivate(temporary)
          // Hard-link publication is atomic and never overwrites an existing id.
          await link(temporary, pathOf(id))
        } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
        return readImport(id)
      })
    },
    readImport,
    async revalidateImport(id) {
      const record = await readImport(id)
      const validationContext = record.validationContextHash ? (await captureInstalled()).snapshot : undefined
      if (validationContext && await contextHash(validationContext) !== record.validationContextHash) throw Error('Installed validation context changed; prepare this import again.')
      return prepareStudioContentImport(JSON.stringify(record.archive), { validationContext })
    },
    async listImports() {
      await privateDirectory(root)
      const names = (await readdir(root)).filter(name => name.endsWith('.json') && UUID.test(name.slice(0, -5))).sort()
      if (names.length > MAX_IMPORTS) throw Error('Archive import count exceeds limit.')
      return Promise.all(names.map(async name => { const record = await readImport(name.slice(0, -5));
        return { id: record.id, kind: record.archive.kind, pin: record.archive.pin, validation: record.validation,
          executionGranted: false, requiresTrustReview: record.requiresTrustReview } }))
    },
  }
}
