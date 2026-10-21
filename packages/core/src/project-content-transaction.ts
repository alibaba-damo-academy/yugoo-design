/** Recoverable same-project content adoption. Git is the publication authority. */
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { GitVersioning, type SpawnFn } from './git.ts'
import { parseDesignProjectJson } from './design-project.ts'

export interface ProjectContentAdoptionReceipt {
  readonly operationId: string
  readonly projectId: string
  readonly sourceCheckpoint: string
  readonly checkpoint: string
  readonly contentHash: string
}
interface Entry { readonly path: string; readonly before: string | null; readonly after: string | null }
interface Pending {
  readonly formatVersion: 1
  readonly operationId: string
  readonly projectId: string
  readonly sourceCheckpoint: string
  readonly contentHash: string
  readonly entries: readonly Entry[]
  readonly journalOwner?: string
}
const marker = (root: string) => join(root, '.git', 'design-system-content-adoption')
const pendingPath = (root: string) => join(marker(root), 'pending.json')

/** Every ordinary project read fails closed while crash/journal reconciliation is pending. */
export async function assertProjectContentSettled(root: string): Promise<void> {
  try { await lstat(marker(root)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new Error('project content: adoption reconciliation is pending; recover this exact project before reading or writing')
}

function target(root: string, path: string): string {
  if (path !== 'project.json' && !path.startsWith('design_files/')) throw new Error('project content: adoption path is outside project content')
  if (/[\\:\u0000-\u001f]/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('project content: unsafe adoption path')
  }
  const result = resolve(root, path), rel = relative(root, result)
  if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('project content: adoption path escapes project')
  return result
}
async function readOptional(path: string): Promise<Buffer | undefined> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('project content: expected a regular file')
    return await readFile(path)
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
async function noSymlinkParents(root: string, path: string): Promise<void> {
  for (let current = dirname(path); current !== root; current = dirname(current)) {
    try { if (!(await lstat(current)).isDirectory()) throw new Error('project content: unsafe parent directory') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}
async function durableWrite(path: string, bytes: Uint8Array): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`
  const file = await open(temp, 'wx', 0o600)
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
  try { await rename(temp, path) } finally { await rm(temp, { force: true }) }
}
const encoded = (bytes: Uint8Array | undefined) => bytes === undefined ? null : Buffer.from(bytes).toString('base64')
const decoded = (bytes: string | null) => bytes === null ? undefined : Buffer.from(bytes, 'base64')
const same = (left: Uint8Array | undefined, right: Uint8Array | undefined) =>
  left === undefined ? right === undefined : right !== undefined && Buffer.from(left).equals(Buffer.from(right))

export interface ProjectContentTransactionOptions {
  readonly root: string
  readonly spawn: SpawnFn
  /** Reuse the owning project's mutation queue, including Panel saves. */
  readonly mutate: <T>(operation: () => Promise<T>) => Promise<T>
  /** Must append idempotently by operationId/checkpoint in the existing DesignJournal. */
  readonly record: (receipt: ProjectContentAdoptionReceipt, journalOwner?: string) => Promise<void>
  /** Preserve the original journal conversation across restart from another session. */
  readonly journalOwner?: string
  /** Test fault injection and bounded integration lifecycle observation. */
  readonly boundary?: (phase: 'prepared' | 'committed' | 'files-synced' | 'journal-recorded') => Promise<void>
}

/** No registry change, new project identity, serial pin update or second model authority. */
export class ProjectContentTransaction {
  private readonly git: GitVersioning
  constructor(private readonly options: ProjectContentTransactionOptions) {
    if (!isAbsolute(options.root)) throw new Error('project content: root must be absolute')
    this.git = new GitVersioning(options.spawn, options.root)
  }
  async adopt(input: {
    readonly projectId: string; readonly sourceCheckpoint: string; readonly contentHash: string
    readonly files: ReadonlyMap<string, Uint8Array | undefined>
    /** Full target validation, native semantic evidence and liveness/unsaved-edit guards. */
    readonly validate: (files: ReadonlyMap<string, Uint8Array | undefined>) => Promise<void>
  }): Promise<ProjectContentAdoptionReceipt> {
    return this.options.mutate(async () => {
      await assertProjectContentSettled(this.options.root)
      if (!input.files.has('project.json') || input.files.size > 4096 || !/^[a-f0-9]{64}$/u.test(input.contentHash)) {
        throw new Error('project content: invalid bounded candidate adoption')
      }
      if (await this.git.head() !== input.sourceCheckpoint) throw new Error('project content: stale migration checkpoint')
      // Freeze candidate bytes before any await; validation must inspect this same captured map.
      const files = new Map([...input.files].map(([path, bytes]) => [path, bytes === undefined ? undefined : Buffer.from(bytes)]))
      const sourceText = await this.git.readTextAt(input.sourceCheckpoint, 'project.json')
      const targetBytes = files.get('project.json')
      if (!sourceText || !targetBytes) throw new Error('project content: source and target metadata are required')
      const source = parseDesignProjectJson(sourceText), metadata = parseDesignProjectJson(targetBytes.toString('utf8'))
      if (source.id !== input.projectId || metadata.id !== source.id || metadata.createdAt !== source.createdAt
        || metadata.name !== source.name || metadata.knowledge.provider !== source.knowledge.provider
        || metadata.kit?.contentHash !== input.contentHash) throw new Error('project content: candidate must preserve project identity and own the target fingerprint')
      let total = 0
      const entries: Entry[] = []
      for (const [path, after] of files) {
        const livePath = target(this.options.root, path)
        await noSymlinkParents(this.options.root, livePath)
        const before = await this.git.readBytesAt(input.sourceCheckpoint, path, undefined, 64 * 1024 * 1024)
        if (!same(before, await readOptional(livePath))) throw new Error(`project content: uncommitted edit at ${path}; preserve it before migration`)
        total += (before?.byteLength ?? 0) + (after?.byteLength ?? 0)
        if (total > 128 * 1024 * 1024) throw new Error('project content: migration receipt exceeds byte limit')
        entries.push({ path, before: encoded(before), after: encoded(after) })
      }
      await input.validate(files)
      if (await this.git.head() !== input.sourceCheckpoint) throw new Error('project content: stale migration checkpoint')
      for (const entry of entries) if (!same(decoded(entry.before), await readOptional(target(this.options.root, entry.path)))) {
        throw new Error(`project content: edit arrived during validation at ${entry.path}`)
      }
      const pending: Pending = { formatVersion: 1, operationId: randomUUID(), projectId: input.projectId,
        sourceCheckpoint: input.sourceCheckpoint, contentHash: input.contentHash, entries,
        ...(this.options.journalOwner === undefined ? {} : { journalOwner: this.options.journalOwner }) }
      // Publish a complete nonempty gate atomically. A crash cannot leave an empty
      // canonical gate that has no receipt from which to recover.
      const staging = `${marker(this.options.root)}-${pending.operationId}.tmp`
      await mkdir(staging)
      try {
        await durableWrite(join(staging, 'pending.json'), Buffer.from(JSON.stringify(pending)))
        await rename(staging, marker(this.options.root))
      } finally { await rm(staging, { recursive: true, force: true }) }
      await this.options.boundary?.('prepared')
      // Commit all new canonical bytes and the new pin in one CAS before live materialization.
      // An exception after Git update-ref leaves the durable receipt for reconciliation.
      await this.git.commitExact(`design: content upgrade ${pending.operationId}`, files, input.sourceCheckpoint)
      await this.options.boundary?.('committed')
      return this.reconcile(pending)
    })
  }
  async recover(): Promise<ProjectContentAdoptionReceipt | undefined> {
    return this.options.mutate(async () => {
      const bytes = await readOptional(pendingPath(this.options.root))
      if (!bytes) { await assertProjectContentSettled(this.options.root); return undefined }
      if (bytes.length > 180 * 1024 * 1024) throw new Error('project content: oversized recovery receipt')
      const pending = JSON.parse(bytes.toString('utf8')) as Pending
      const base64 = (value: unknown): value is string | null => value === null || typeof value === 'string'
        && Buffer.from(value, 'base64').toString('base64') === value
      if (pending.formatVersion !== 1 || !Array.isArray(pending.entries) || !pending.entries.length || pending.entries.length > 4096
        || !/^[a-f0-9]{64}$/u.test(pending.contentHash) || !/^[a-f0-9-]{36}$/u.test(pending.operationId)
        || !/^[a-f0-9-]{36}$/u.test(pending.projectId) || !/^[a-f0-9]{40,64}$/u.test(pending.sourceCheckpoint)
        || pending.journalOwner !== undefined && (typeof pending.journalOwner !== 'string' || !pending.journalOwner || pending.journalOwner.length > 256 || /[\u0000-\u001f]/u.test(pending.journalOwner))
        || !pending.entries.some(entry => entry.path === 'project.json')
        || new Set(pending.entries.map(entry => entry.path)).size !== pending.entries.length
        || pending.entries.some(entry => typeof entry.path !== 'string' || !base64(entry.before) || !base64(entry.after))) {
        throw new Error('project content: invalid recovery receipt')
      }
      const metadataEntry = pending.entries.find(entry => entry.path === 'project.json')!
      const beforeMetadata = decoded(metadataEntry.before), afterMetadata = decoded(metadataEntry.after)
      if (!beforeMetadata || !afterMetadata || !same(beforeMetadata, await this.git.readBytesAt(pending.sourceCheckpoint, 'project.json'))) {
        throw new Error('project content: recovery source metadata does not match its checkpoint')
      }
      const before = parseDesignProjectJson(beforeMetadata.toString('utf8')), after = parseDesignProjectJson(afterMetadata.toString('utf8'))
      if (before.id !== pending.projectId || after.id !== pending.projectId || before.name !== after.name
        || before.createdAt !== after.createdAt || before.knowledge.provider !== after.knowledge.provider
        || after.kit?.contentHash !== pending.contentHash) throw new Error('project content: invalid recovery identity/fingerprint')
      const head = await this.git.head()
      const history = await this.git.history(1)
      const published = history[0]?.subject === `design: content upgrade ${pending.operationId}`
      if (!published) {
        // Pre-publication crash: live content was never touched.
        for (const entry of pending.entries) {
          if (!same(decoded(entry.before), await readOptional(target(this.options.root, entry.path)))
            || !same(decoded(entry.before), head ? await this.git.readBytesAt(head, entry.path) : undefined)) {
            throw new Error('project content: external edit conflicts with recovery; preserve it before retry')
          }
        }
        await rm(marker(this.options.root), { recursive: true })
        return undefined
      }
      return this.reconcile(pending)
    })
  }
  private async reconcile(pending: Pending): Promise<ProjectContentAdoptionReceipt> {
    const checkpoint = await this.git.head()
    if (!checkpoint || checkpoint === pending.sourceCheckpoint) throw new Error('project content: adoption did not publish a checkpoint')
    const history = await this.git.history(2)
    if (history[0]?.commit !== checkpoint || history[1]?.commit !== pending.sourceCheckpoint
      || history[0]?.subject !== `design: content upgrade ${pending.operationId}`) {
      throw new Error('project content: HEAD changed after adoption; reconcile the exact checkpoint before continuing')
    }
    // Preflight every path before repairing any. External edits are never silently overwritten.
    for (const entry of pending.entries) {
      const path = target(this.options.root, entry.path)
      await noSymlinkParents(this.options.root, path)
      const live = await readOptional(path), after = decoded(entry.after)
      if (!same(after, await this.git.readBytesAt(checkpoint, entry.path))) throw new Error('project content: receipt does not match committed candidate')
      if (!same(live, decoded(entry.before)) && !same(live, after)) throw new Error(`project content: external edit conflicts at ${entry.path}`)
    }
    for (const entry of pending.entries) {
      const path = target(this.options.root, entry.path), bytes = decoded(entry.after)
      if (bytes === undefined) await rm(path, { force: true })
      else { await mkdir(dirname(path), { recursive: true }); await durableWrite(path, bytes) }
    }
    await this.options.boundary?.('files-synced')
    const receipt = { operationId: pending.operationId, projectId: pending.projectId,
      sourceCheckpoint: pending.sourceCheckpoint, checkpoint, contentHash: pending.contentHash }
    await this.options.record(receipt, pending.journalOwner)
    await this.options.boundary?.('journal-recorded')
    await rm(marker(this.options.root), { recursive: true })
    return receipt
  }
}
