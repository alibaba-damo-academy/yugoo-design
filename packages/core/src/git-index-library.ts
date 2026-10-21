/** Node-only index codec. The caller owns disk reads, its index lock and publication. */
import { createHash, randomUUID } from 'node:crypto'
import { GitIndexManager } from 'isomorphic-git/managers'

export interface LibraryIndexUpdate {
  readonly path: string
  readonly oid?: string
  readonly mode?: number
}

const MAX_INDEX_BYTES = 32 << 20
const TREE_CACHE_SIGNATURE = Buffer.from('TREE')

export class UnsupportedLibraryIndexError extends Error {
  readonly code = 'unsupported-index'
  constructor() { super('design git: unsupported index representation') }
}

function unsupported(): never { throw new UnsupportedLibraryIndexError() }

function validateHeader(bytes: Buffer): void {
  if (bytes.length < 32 || !bytes.subarray(0, 4).equals(Buffer.from('DIRC'))
    || !createHash('sha1').update(bytes.subarray(0, -20)).digest().equals(bytes.subarray(-20))) {
    throw new Error('design git: invalid index header or checksum')
  }
  // A valid but unsupported version is a capability refusal, not corruption.
  if (bytes.readUInt32BE(4) !== 2) unsupported()
}

function requirePath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')
    || Buffer.from(path).toString('utf8') !== path) unsupported()
}

type Index = Parameters<Parameters<typeof GitIndexManager.acquire>[1]>[0]

/**
 * The library parses and serializes entries. Verify its exact entry roundtrip
 * before allowing an edit: this rejects unsupported versions, lossy paths,
 * flags or stat conversions. The only discarded extension is Git's derived
 * TREE cache. Its framing is validated here; its opaque payload is not decoded.
 */
async function validateRoundtrip(index: Index, original: Buffer | undefined): Promise<void> {
  for (const entry of index.entriesFlat) {
    requirePath(entry.path)
    if (!/^[0-9a-f]{40}$/u.test(entry.oid) || !Number.isInteger(entry.flags.stage)
      || entry.flags.stage < 0 || entry.flags.stage > 3) unsupported()
  }
  if (original === undefined) return
  const rendered = Buffer.from(await index.toObject())
  const end = rendered.length - 20
  if (original.length < rendered.length || !original.subarray(0, end).equals(rendered.subarray(0, end))) unsupported()
  let offset = end
  while (offset < original.length - 20) {
    if (original.length - 20 - offset < 8
      || !original.subarray(offset, offset + 4).equals(TREE_CACHE_SIGNATURE)) unsupported()
    const size = original.readUInt32BE(offset + 4)
    offset += 8
    if (size > original.length - 20 - offset) unsupported()
    offset += size
  }
  if (offset !== original.length - 20) unsupported()
}

async function withIndex<T>(bytes: Uint8Array | undefined, use: (index: Index) => Promise<T>): Promise<T> {
  if (bytes !== undefined && bytes.byteLength > MAX_INDEX_BYTES) unsupported()
  // Fresh cache and an isolated in-memory FS for every request. No real path is
  // opened, no lock is claimed and no stale mtime cache crosses the snapshots.
  const original = bytes === undefined ? undefined : Buffer.from(bytes)
  if (original !== undefined) validateHeader(original)
  const gitdir = `/yugoo-memory-index/${randomUUID()}`
  const check = (path: string): void => { if (path !== `${gitdir}/index`) unsupported() }
  const fs = {
    async lstat(path: string) { check(path); return null },
    async read(path: string) { check(path); return original ?? null },
    async write(_path: string, _contents: unknown) { unsupported() },
  }
  return GitIndexManager.acquire({ fs, gitdir, cache: {} }, async index => {
    await validateRoundtrip(index, original)
    // Return bytes explicitly, rather than asking the manager to persist them.
    // Mutations are to this request's in-memory object only.
    try { return await use(index) }
    finally { index._dirty = false }
  })
}

/** Exact path or descendant snapshots, including each unresolved merge stage. */
export async function readLibraryIndex(
  bytes: Uint8Array | undefined,
  paths: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  for (const path of paths) requirePath(path)
  return withIndex(bytes, async index => {
    const entries = [...index.entriesFlat].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))
      || a.flags.stage - b.flags.stage)
    const result: Record<string, string> = Object.create(null)
    for (const path of paths) {
      result[path] = entries.filter(entry => entry.path === path || entry.path.startsWith(`${path}/`))
        .map(entry => `${entry.mode.toString(8).padStart(6, '0')} ${entry.oid} ${entry.flags.stage}\t${entry.path}\n`).join('')
    }
    return Object.freeze(result)
  })
}

/** Ordered cacheinfo updates; the caller later writes returned bytes under its own lock. */
export async function updateLibraryIndex(
  bytes: Uint8Array | undefined,
  updates: readonly LibraryIndexUpdate[],
): Promise<Uint8Array> {
  for (const update of updates) {
    requirePath(update.path)
    if (update.oid !== undefined && (!/^[0-9a-f]{40}$/u.test(update.oid)
      || (update.mode !== 0o100644 && update.mode !== 0o100755))) unsupported()
  }
  return withIndex(bytes, async index => {
    for (const update of updates) {
      if (update.oid === undefined) {
        // GitIndex.delete also removes descendants when the exact key is
        // absent. A force-remove of one leaf must never do that.
        if (index.has({ filepath: update.path })) index.delete({ filepath: update.path })
      } else {
        if (index.entriesFlat.some((entry: { path: string }) => entry.path !== update.path
          && (entry.path.startsWith(`${update.path}/`) || update.path.startsWith(`${entry.path}/`)))) unsupported()
        index.insert({ filepath: update.path, stats: {
          ctimeSeconds: 0, ctimeNanoseconds: 0, mtimeSeconds: 0, mtimeNanoseconds: 0,
          dev: 0, ino: 0, uid: 0, gid: 0, size: 0, mode: update.mode,
        }, oid: update.oid })
      }
    }
    const rendered = Buffer.from(await index.toObject())
    if (rendered.length > MAX_INDEX_BYTES) unsupported()
    return rendered
  })
}
