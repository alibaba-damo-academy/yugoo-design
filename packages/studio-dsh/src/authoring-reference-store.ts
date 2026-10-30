/** Host-private native addresses only; sessionQuery and S1 retain their authorities. */
import fs from 'node:fs/promises'
import { constants, type Stats } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import type { StudioAuthoringReference } from './authoring-agent.types.ts'

export interface StudioAuthoringReferenceKey {
  readonly parentSessionId: string
  readonly sessionId: string
  readonly epoch: string
}
export interface StudioAuthoringReferenceStore {
  /** Settles after file sync, no-clobber publication and platform checks; usable as S4's callback. */
  retain(reference: StudioAuthoringReference): Promise<void>
  read(key: StudioAuthoringReferenceKey): Promise<StudioAuthoringReference | undefined>
  /** Explicit parent only, deterministic key order, never a latest-session selector. */
  list(input: { readonly parentSessionId: string }): Promise<readonly StudioAuthoringReference[]>
}

export const STUDIO_AUTHORING_REFERENCE_LIMITS = Object.freeze({ references: 256, bytes: 524_288, paths: 64 })
const NAMESPACE = 'studio-authoring-references'
const FORMAT = 'studio-authoring-reference/v1'
const OWNER = `${FORMAT}\n`
const HASH = /^[a-f0-9]{64}$/u
const RECORD = /^[a-f0-9]{64}\.json$/u
const TEMP = /^\.[a-f0-9-]{36}\.tmp$/u
const WINDOWS = process.platform === 'win32'
function fail(message: string): never { throw new Error(`Studio authoring references: ${message}`) }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
type Identity = Pick<Stats, 'dev' | 'ino'>
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino

function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('expected a plain JSON object')
  const record = value as Record<string, unknown>
  if (required.some(key => !Object.hasOwn(record, key))
    || Object.keys(record).some(key => !required.includes(key) && !optional.includes(key))) fail('unexpected or missing fields')
  return record
}
function text(value: unknown, bytes = 1024): string {
  if (typeof value !== 'string' || !value || !value.isWellFormed() || Buffer.byteLength(value) > bytes
    || /[\u0000-\u001f\u007f]/u.test(value)) fail('invalid or oversized identity/path text')
  return value
}
function integer(value: unknown, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail('invalid reference integer')
  return value as number
}
/** Storage shape/budgets only. Native identity, source grants and pins are checked by S4/H2. */
function reference(value: unknown): StudioAuthoringReference {
  const r = object(value, ['sessionId', 'parentSessionId', 'invocationId', 'epoch', 'messageId', 'afterSeq', 'scope'])
  const s = object(r.scope, ['id', 'expectedRevision', 'allowedPaths'], ['bundle'])
  if (!Array.isArray(s.allowedPaths) || !s.allowedPaths.length || s.allowedPaths.length > STUDIO_AUTHORING_REFERENCE_LIMITS.paths) fail('invalid allowed-path count')
  const bundle = Object.hasOwn(s, 'bundle') ? object(s.bundle, ['name', 'version']) : undefined
  return {
    sessionId: text(r.sessionId), parentSessionId: text(r.parentSessionId), invocationId: text(r.invocationId),
    epoch: text(r.epoch), messageId: text(r.messageId), afterSeq: integer(r.afterSeq, -1),
    scope: { id: text(s.id), expectedRevision: integer(s.expectedRevision, 0),
      allowedPaths: Array.from(s.allowedPaths, path => text(path, 4096)),
      ...(bundle ? { bundle: { name: text(bundle.name), version: text(bundle.version) } } : {}) },
  }
}
function keyOf(sessionId: string, epoch: string): string { return hash(JSON.stringify([sessionId, epoch])) }
function encode(ref: StudioAuthoringReference): string {
  const result = JSON.stringify({ format: FORMAT, key: keyOf(ref.sessionId, ref.epoch), digest: hash(JSON.stringify(ref)), reference: ref }) + '\n'
  if (Buffer.byteLength(result) > STUDIO_AUTHORING_REFERENCE_LIMITS.bytes) fail('reference exceeds JSON byte budget')
  return result
}
function decode(bytes: Buffer, key: string): StudioAuthoringReference {
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const envelope = object(JSON.parse(raw), ['format', 'key', 'digest', 'reference'])
  const ref = reference(envelope.reference)
  if (envelope.format !== FORMAT || envelope.key !== key || !HASH.test(String(envelope.digest))
    || keyOf(ref.sessionId, ref.epoch) !== key || encode(ref) !== raw) fail('reference integrity mismatch')
  return ref
}
function privateMode(info: Stats, directory: boolean): void {
  if ((directory ? !info.isDirectory() : !info.isFile()) || info.isSymbolicLink()
    // Windows inherits access from the owning user's directory. POSIX mode/uid
    // are not an ACL check there; object kind and physical identity still apply.
    || (!WINDOWS && ((info.mode & 0o7777) !== (directory ? 0o700 : 0o600)
      || (process.getuid !== undefined && info.uid !== process.getuid())))) fail('storage must remain private, owned and physical')
}
async function optionalStat(path: string): Promise<Stats | undefined> {
  try { return await fs.lstat(path) } catch (error) { if (missing(error)) return; throw error }
}
async function directories(path: string): Promise<{ path: string; info: Stats }[]> {
  const root = parse(path).root, parts = path.slice(root.length).split(/[\\/]/u).filter(Boolean)
  const result: { path: string; info: Stats }[] = []
  let current = root
  for (const part of ['', ...parts]) {
    current = join(current, part)
    const info = await fs.lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) fail('directory path traverses a symlink or non-directory')
    result.push({ path: current, info })
  }
  if (await fs.realpath(path) !== path) fail('stateRoot must be a canonical physical path')
  return result
}
async function readPrivate(path: string, limit: number, expected?: Identity, sync = false): Promise<{ bytes: Buffer; info: Stats } | undefined> {
  const before = await optionalStat(path)
  if (!before) return
  privateMode(before, false)
  if (before.nlink !== 1 || before.size > limit || (expected && !same(before, expected))) fail('unsafe, replaced or oversized reference file')
  // Windows file flushing requires write access, including an idempotent retain
  // or owner-marker reopen. Observation-only reads retain read-only access.
  const access = WINDOWS && sync ? constants.O_RDWR : constants.O_RDONLY
  const handle = await fs.open(path, access | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const opened = await handle.stat(); privateMode(opened, false)
    if (!same(before, opened) || opened.nlink !== 1 || opened.size > limit) fail('reference file changed while opening')
    const bytes = Buffer.alloc(limit + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > limit) fail('reference exceeds JSON byte budget')
    if (sync) await handle.sync()
    const after = await handle.stat(), named = await fs.lstat(path)
    privateMode(after, false); privateMode(named, false)
    if (!same(opened, named) || !same(opened, after) || after.nlink !== 1 || named.nlink !== 1
      || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs
      || after.size !== named.size || after.mtimeMs !== named.mtimeMs || after.ctimeMs !== named.ctimeMs) fail('reference file changed while reading')
    return { bytes: bytes.subarray(0, length), info: after }
  } finally { await handle.close() }
}
async function syncDirectory(path: string, expected: Identity): Promise<void> {
  if (WINDOWS) {
    // Editor-level saving does not require Windows directory flushing. Keep the
    // named physical-directory check; file sync and publication failures propagate.
    const info = await fs.lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink() || !same(info, expected)) fail('directory replaced before publication')
    return
  }
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY)
  try {
    const info = await handle.stat()
    if (!info.isDirectory() || !same(info, expected)) fail('directory replaced before sync')
    await handle.sync()
  } finally { await handle.close() }
}

async function preparePrivateDirectory(stateRoot: string | undefined) {
  if (typeof stateRoot !== 'string' || !isAbsolute(stateRoot) || resolve(stateRoot) !== stateRoot) fail('explicit absolute canonical stateRoot required')
  // Do not recursively create or follow an unverified ancestor.
  const parents = await directories(dirname(stateRoot))
  await fs.mkdir(stateRoot, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
  const stateInfo = await fs.lstat(stateRoot); privateMode(stateInfo, true)
  const chain = await directories(stateRoot)
  if (!same(chain.at(-1)!.info, stateInfo) || parents.some((entry, i) => !same(entry.info, chain[i].info))) fail('stateRoot changed during initialization')
  return { stateRoot, stateInfo, parents, chain }
}
async function verifyDirectories(anchors: readonly { path: string; info: Stats }[]): Promise<void> {
  for (const entry of anchors) {
    const info = await fs.lstat(entry.path)
    if (!info.isDirectory() || info.isSymbolicLink() || !same(info, entry.info)
      || (!WINDOWS && (info.mode !== entry.info.mode || info.uid !== entry.info.uid))) fail('directory identity or permissions changed')
  }
}

/** Prepare one Host-owned private leaf, without creating a store or repairing permissions.
 * The canonical physical parent must already exist. Failures can leave the leaf;
 * POSIX retries complete both sync barriers. Windows uses inherited user access
 * and physical-path checks, without a directory-flush or power-loss guarantee. */
export async function prepareStudioAuthoringDirectory(path: string): Promise<string> {
  const { stateRoot, stateInfo, parents, chain } = await preparePrivateDirectory(path)
  await verifyDirectories(chain)
  await syncDirectory(stateRoot, stateInfo)
  await syncDirectory(dirname(stateRoot), parents.at(-1)!.info)
  await verifyDirectories(chain)
  return stateRoot
}

/**
 * Explicit private stateRoot only. The marker owns this namespace, not S2 or the
 * root. No permission repair, stale-lock reclamation, SDK import or native action.
 * Path/handle checks reject detected replacement; they do not sandbox arbitrary
 * same-user mutation between filesystem syscalls. POSIX requires directory sync;
 * Windows uses ordinary user-directory access and file publication, without a
 * directory-flush requirement or cross-platform power-loss guarantee.
 */
export async function createStudioAuthoringReferenceStore(options: { readonly stateRoot: string }): Promise<StudioAuthoringReferenceStore> {
  const { stateRoot, stateInfo, parents, chain } = await preparePrivateDirectory(options?.stateRoot)
  const directory = join(stateRoot, NAMESPACE), owner = join(directory, '.owner')
  let created = false
  await fs.mkdir(directory, { mode: 0o700 }).then(() => { created = true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
  const directoryInfo = await fs.lstat(directory); privateMode(directoryInfo, true)
  if (created) {
    const handle = await fs.open(owner, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try { await handle.writeFile(OWNER) } finally { await handle.close() }
  }
  const ownership = await readPrivate(owner, Buffer.byteLength(OWNER))
  if (!ownership || ownership.bytes.toString() !== OWNER) fail('namespace ownership conflict; existing content preserved')
  const anchors = [...chain, { path: directory, info: directoryInfo }]
  const guard = async () => {
    await verifyDirectories(anchors)
    const marker = await readPrivate(owner, Buffer.byteLength(OWNER), ownership.info)
    if (!marker || marker.bytes.toString() !== OWNER) fail('namespace ownership changed')
  }
  await guard()
  // Presence does not prove that a previous factory completed initialization.
  // Verify ownership first, then complete these barriers on creation AND reopen.
  // A failed barrier leaves existing objects intact and still rejects admission.
  const retainedOwner = await readPrivate(owner, Buffer.byteLength(OWNER), ownership.info, true)
  if (!retainedOwner || retainedOwner.bytes.toString() !== OWNER) fail('namespace ownership changed')
  await guard()
  await syncDirectory(directory, directoryInfo)
  await syncDirectory(stateRoot, stateInfo)
  await syncDirectory(dirname(stateRoot), parents.at(-1)!.info)
  await guard()
  const known = new Map<string, { info: Stats; digest: string }>()
  const load = async (key: string, durable = false) => {
    const file = await readPrivate(join(directory, `${key}.json`), STUDIO_AUTHORING_REFERENCE_LIMITS.bytes, known.get(key)?.info, durable)
    if (!file) { if (known.has(key)) fail('retained reference disappeared'); return }
    const ref = decode(file.bytes, key), digest = hash(encode(ref)), prior = known.get(key)
    if (prior && prior.digest !== digest) fail('immutable reference changed')
    if (known.size >= STUDIO_AUTHORING_REFERENCE_LIMITS.references && !prior) fail('reference count exceeds budget')
    known.set(key, { info: file.info, digest })
    return ref
  }
  const keys = async () => {
    const names: string[] = []; let entries = 0
    const dir = await fs.opendir(directory)
    for await (const entry of dir) {
      if (++entries > STUDIO_AUTHORING_REFERENCE_LIMITS.references + 16) fail('directory exceeds entry budget')
      if (RECORD.test(entry.name)) names.push(entry.name.slice(0, -5))
      else if (entry.name === '.owner' || entry.name === '.write.lock' || TEMP.test(entry.name)) {
        const info = await fs.lstat(join(directory, entry.name))
        privateMode(info, entry.name === '.write.lock')
        if (entry.name !== '.write.lock' && info.nlink !== 1) fail('unsafe namespace entry')
      } else fail('unexpected namespace entry')
    }
    if (names.length > STUDIO_AUTHORING_REFERENCE_LIMITS.references) fail('reference count exceeds budget')
    return names.sort()
  }
  let lane = Promise.resolve()
  const retain = async (input: StudioAuthoringReference): Promise<void> => {
    // Snapshot before queueing or any async I/O.
    const ref = reference(input), bytes = encode(ref), key = keyOf(ref.sessionId, ref.epoch)
    const operation = lane.then(async () => {
      await guard()
      const lock = join(directory, '.write.lock')
      try { await fs.mkdir(lock, { mode: 0o700 }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('store is being retained elsewhere; no stale lock is reclaimed'); throw error }
      const lockInfo = await fs.lstat(lock); privateMode(lockInfo, true)
      let temporary: { path: string; info: Stats } | undefined
      try {
        await guard()
        const existing = await load(key, true)
        if (existing) {
          if (encode(existing) !== bytes) fail('conflicting native address; retained reference preserved')
          await syncDirectory(directory, directoryInfo)
          return
        }
        if ((await keys()).length >= STUDIO_AUTHORING_REFERENCE_LIMITS.references) fail('reference count budget reached')
        const path = join(directory, `.${randomUUID()}.tmp`)
        const handle = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
        try {
          temporary = { path, info: await handle.stat() }; privateMode(temporary.info, false)
          await handle.writeFile(bytes, 'utf8'); await handle.sync()
        } finally { await handle.close() }
        await guard()
        const current = await fs.lstat(path); privateMode(current, false)
        if (!same(current, temporary.info) || current.nlink !== 1) fail('temporary reference replaced')
        // Atomic no-clobber publication: a competing file can never be replaced.
        await fs.link(path, join(directory, `${key}.json`))
      } finally {
        if (temporary) {
          await guard()
          const info = await optionalStat(temporary.path)
          if (info) {
            privateMode(info, false)
            if (!same(info, temporary.info)) fail('temporary reference changed; preserved')
            await fs.unlink(temporary.path)
          }
        }
        await guard()
        const info = await fs.lstat(lock); privateMode(info, true)
        if (!same(info, lockInfo)) fail('write lock changed; preserved')
        await fs.rmdir(lock)
        await syncDirectory(directory, directoryInfo)
      }
      const retained = await load(key)
      if (!retained || encode(retained) !== bytes) fail('retained address verification failed')
      await guard()
    })
    lane = operation.catch(() => {})
    return operation
  }
  const read = async (input: StudioAuthoringReferenceKey) => {
    const request = object(input, ['parentSessionId', 'sessionId', 'epoch'])
    const parent = text(request.parentSessionId), key = keyOf(text(request.sessionId), text(request.epoch))
    await guard()
    const ref = await load(key)
    if (ref && ref.parentSessionId !== parent) fail('reference belongs to another exact parent')
    await guard()
    return ref
  }
  const list = async (input: { readonly parentSessionId: string }) => {
    const parent = text(object(input, ['parentSessionId']).parentSessionId)
    await guard()
    const records: StudioAuthoringReference[] = []
    for (const key of await keys()) {
      const ref = await load(key)
      if (!ref) fail('reference disappeared during list')
      if (ref.parentSessionId === parent) records.push(ref)
    }
    await guard()
    return records
  }
  return Object.freeze({ retain, read, list })
}
