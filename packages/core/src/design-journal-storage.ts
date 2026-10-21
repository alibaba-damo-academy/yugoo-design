/** Filesystem JSONL storage for host-neutral per-conversation design journals. */
import { appendFile, mkdir, readFile, stat, truncate } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { resolveConfinedFilePath } from './confined-fs.ts'
import {
  DESIGN_JOURNAL_SCHEMA_VERSION,
  applyDesignJournalRecord,
  foldDesignJournal,
  parseDesignJournalFact,
  parseDesignJournalRecord,
  type DesignJournalRecord,
  type DesignJournalSnapshot,
} from './design-journal.ts'

/** Resource bounds applied before journal data is returned or appended. */
export interface DesignJournalStorageLimits {
  readonly maxRecords?: number
  readonly maxRecordBytes?: number
  readonly maxJournalBytes?: number
  readonly maxSnapshotBytes?: number
}

/** Complete read result for one conversation journal. */
export interface DesignJournalRead {
  readonly revision: number
  readonly records: readonly DesignJournalRecord[]
  readonly snapshot: DesignJournalSnapshot
}

/**
 * Decides the next append from the exact current read model. Must be a
 * synchronous pure decision: no external effects, no async work. Returning
 * undefined appends nothing and notifies no subscriber.
 */
export type DesignJournalMutator = (current: DesignJournalRead) => unknown

/** Outcome of one atomic compare/fold+append operation. */
export interface DesignJournalMutation {
  readonly changed: boolean
  readonly read: DesignJournalRead
}

/** Listener invoked after one append is persisted and folded. */
export type DesignJournalSubscriber = (value: DesignJournalRead) => void

const DEFAULT_LIMITS = Object.freeze({
  maxRecords: 10_000,
  maxRecordBytes: 1_048_576,
  maxJournalBytes: 67_108_864,
  maxSnapshotBytes: 8_388_608,
})

interface ParsedJsonl extends DesignJournalRead {
  readonly validBytes: number
  readonly needsDelimiter: boolean
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`design journal storage: ${name} must be a positive safe integer`)
  }
  return resolved
}

function snapshotBytes(snapshot: DesignJournalSnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
}

function conversationFileName(conversation: string): string {
  if (conversation.length === 0) throw new Error('design journal storage: conversation identity must not be empty')
  const bytes = Buffer.from(conversation, 'utf8')
  if (bytes.byteLength > 512) throw new Error('design journal storage: conversation identity exceeds 512 UTF-8 bytes')
  return `${bytes.toString('base64url')}.jsonl`
}

function isSafelyTornJsonObject(line: string, error: SyntaxError): boolean {
  if (!line.startsWith('{')) return false
  if (/Unexpected end of JSON input|Unterminated string/.test(error.message)) return true
  const position = /at position ([0-9]+)/.exec(error.message)?.[1]
  return position !== undefined && Number(position) >= line.length
}

/**
 * Bounded append-only JSONL journals keyed by an opaque conversation identity.
 * Reads and appends are serialized independently per conversation. A syntactically torn
 * unterminated final fragment is ignored on read and truncated before append;
 * malformed complete lines and semantically invalid final values fail loud.
 * The root and its existing files are trusted caller-controlled storage and
 * must not be writable by untrusted processes.
 */
export class DesignJournalStorage {
  private readonly root: string
  private readonly maxRecords: number
  private readonly maxRecordBytes: number
  private readonly maxJournalBytes: number
  private readonly maxSnapshotBytes: number
  private readonly queues = new Map<string, Promise<void>>()
  private readonly subscribers = new Map<string, Set<DesignJournalSubscriber>>()
  private readonly publication?: {
    readonly projectRoot: string
    readonly afterAppend?: (file: string) => Promise<void>
  }

  /**
   * Create storage rooted at a trusted caller-owned directory.
   * @param root - directory containing encoded per-conversation JSONL files.
   * @param limits - optional deployment resource limits.
   */
  constructor(root: string, limits: DesignJournalStorageLimits = {}, publication?: {
    readonly projectRoot: string
    readonly afterAppend?: (file: string) => Promise<void>
  }) {
    if (root.length === 0) throw new Error('design journal storage: root must not be empty')
    this.root = root
    this.publication = publication
    this.maxRecords = positiveLimit(limits.maxRecords, DEFAULT_LIMITS.maxRecords, 'maxRecords')
    this.maxRecordBytes = positiveLimit(limits.maxRecordBytes, DEFAULT_LIMITS.maxRecordBytes, 'maxRecordBytes')
    this.maxJournalBytes = positiveLimit(limits.maxJournalBytes, DEFAULT_LIMITS.maxJournalBytes, 'maxJournalBytes')
    this.maxSnapshotBytes = positiveLimit(limits.maxSnapshotBytes, DEFAULT_LIMITS.maxSnapshotBytes, 'maxSnapshotBytes')
  }

  /**
   * Read and strictly fold one conversation journal.
   * @param conversation - opaque caller-owned conversation identity.
   * @returns records and snapshot at the same exact revision.
   */
  async read(conversation: string): Promise<DesignJournalRead> {
    const file = this.pathFor(conversation)
    return this.enqueue(conversation, async () => { await this.checkProjectPath(file); return this.readFile(file) })
  }

  /**
   * Append one fact after all earlier appends for this conversation.
   * @param conversation - opaque caller-owned conversation identity.
   * @param candidate - untrusted fact without an assigned revision.
   * @returns records and snapshot including the persisted append.
   */
  async append(conversation: string, candidate: unknown): Promise<DesignJournalRead> {
    const fact = parseDesignJournalFact(candidate)
    return (await this.atomicMutate(conversation, () => fact)).read
  }

  /**
   * Atomically compare the exact current read model and append for one
   * conversation. The read, mutator decision, strict fold, and write run as
   * one queued operation, so operations sharing this DesignJournalStorage
   * instance observe a total per-conversation order and a decision can never
   * race a concurrent append. This is in-instance serialization only: it
   * provides no cross-process or separate-instance locking. A mutator
   * throwing appends nothing and fails loud.
   * @param conversation - opaque caller-owned conversation identity.
   * @param mutator - receives the exact current read; undefined skips append.
   * @returns whether an append persisted, with the exact read model either way.
   */
  async atomicMutate(conversation: string, mutator: DesignJournalMutator): Promise<DesignJournalMutation> {
    const file = this.pathFor(conversation)
    return this.enqueue(conversation, async () => {
      await this.checkProjectPath(file)
      await mkdir(this.root, { recursive: true })
      await this.checkProjectPath(file)
      const current = await this.readFile(file)
      const candidate = mutator(current)
      if (candidate === undefined) {
        if (current.revision) await this.publication?.afterAppend?.(file)
        return Object.freeze({ changed: false, read: current })
      }
      const fact = parseDesignJournalFact(candidate)
      if (fact.type === 'design/advisory-set-published') {
        throw new Error('design journal storage: legacy advisory-set facts are read-only and cannot be appended')
      }
      if (current.records.length >= this.maxRecords) {
        throw new Error(`design journal storage: journal reached the ${this.maxRecords} record limit`)
      }
      const record = Object.freeze({
        schemaVersion: DESIGN_JOURNAL_SCHEMA_VERSION,
        revision: current.revision + 1,
        ...(fact.type === 'design/advisory-published' ? { publishedAt: Date.now() } : {}),
        ...fact,
      }) as DesignJournalRecord
      const line = `${JSON.stringify(record)}\n`
      const bytes = Buffer.byteLength(line, 'utf8')
      if (bytes > this.maxRecordBytes) {
        throw new Error(`design journal storage: record exceeds ${this.maxRecordBytes} bytes`)
      }
      const encoded = parseDesignJournalRecord(JSON.parse(line))
      const snapshot = applyDesignJournalRecord(current.snapshot, encoded)
      this.assertSnapshotBound(snapshot)
      const prefix = current.needsDelimiter ? '\n' : ''
      if (current.validBytes + Buffer.byteLength(prefix + line, 'utf8') > this.maxJournalBytes) {
        throw new Error(`design journal storage: journal exceeds ${this.maxJournalBytes} bytes`)
      }
      const existingBytes = await this.fileBytes(file)
      if (current.validBytes < existingBytes) await truncate(file, current.validBytes)
      await appendFile(file, `${prefix}${line}`, 'utf8')
      await this.publication?.afterAppend?.(file)
      const result = Object.freeze({
        revision: encoded.revision,
        records: Object.freeze([...current.records, encoded]),
        snapshot,
      })
      for (const listener of this.subscribers.get(conversation) ?? []) listener(result)
      return Object.freeze({ changed: true, read: result })
    })
  }

  /**
   * Subscribe to persisted appends for one conversation.
   * @param conversation - opaque caller-owned conversation identity.
   * @param listener - callback receiving an exact post-append read model.
   * @returns a disposer for this listener.
   */
  subscribe(conversation: string, listener: DesignJournalSubscriber): () => void {
    this.pathFor(conversation)
    const listeners = this.subscribers.get(conversation) ?? new Set<DesignJournalSubscriber>()
    listeners.add(listener)
    this.subscribers.set(conversation, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.subscribers.delete(conversation)
    }
  }

  private pathFor(conversation: string): string {
    return join(this.root, conversationFileName(conversation))
  }

  private async checkProjectPath(file: string): Promise<void> {
    if (this.publication) await resolveConfinedFilePath(this.publication.projectRoot,
      relative(this.publication.projectRoot, file).split(sep).join('/'))
  }

  private async fileBytes(file: string): Promise<number> {
    try {
      return (await stat(file)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  }

  private async readFile(file: string): Promise<ParsedJsonl> {
    const size = await this.fileBytes(file)
    if (size > this.maxJournalBytes) {
      throw new Error(`design journal storage: journal exceeds ${this.maxJournalBytes} bytes`)
    }
    let bytes: Buffer
    try {
      bytes = await readFile(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const snapshot = foldDesignJournal([])
      return Object.freeze({ revision: 0, records: Object.freeze([]), snapshot, validBytes: 0, needsDelimiter: false })
    }
    if (bytes.byteLength > this.maxJournalBytes) {
      throw new Error(`design journal storage: journal exceeds ${this.maxJournalBytes} bytes`)
    }
    const text = bytes.toString('utf8')
    const terminated = text.endsWith('\n')
    const segments = text.split('\n')
    if (terminated) segments.pop()
    let validBytes = 0
    let needsDelimiter = false
    const records: DesignJournalRecord[] = []
    for (const [index, line] of segments.entries()) {
      const finalUnterminated = !terminated && index === segments.length - 1
      const lineBytes = Buffer.byteLength(line, 'utf8')
      if (lineBytes + 1 > this.maxRecordBytes) {
        throw new Error(`design journal storage: line ${index + 1} exceeds ${this.maxRecordBytes} bytes`)
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(line)
      } catch (error) {
        if (finalUnterminated && error instanceof SyntaxError && isSafelyTornJsonObject(line, error)) break
        throw new Error(`design journal storage: malformed JSON on complete line ${index + 1}`, { cause: error })
      }
      let record: DesignJournalRecord
      try {
        record = parseDesignJournalRecord(decoded)
      } catch (error) {
        throw new Error(`design journal storage: invalid record on line ${index + 1}`, { cause: error })
      }
      records.push(record)
      validBytes += lineBytes
      if (!finalUnterminated) validBytes += 1
      else needsDelimiter = true
      if (records.length > this.maxRecords) {
        throw new Error(`design journal storage: journal exceeds the ${this.maxRecords} record limit`)
      }
    }
    const snapshot = foldDesignJournal(records)
    this.assertSnapshotBound(snapshot)
    return Object.freeze({
      revision: snapshot.revision,
      records: Object.freeze(records),
      snapshot,
      validBytes,
      needsDelimiter,
    })
  }

  private assertSnapshotBound(snapshot: DesignJournalSnapshot): void {
    if (snapshotBytes(snapshot) > this.maxSnapshotBytes) {
      throw new Error(`design journal storage: folded snapshot exceeds ${this.maxSnapshotBytes} bytes`)
    }
  }

  private enqueue<T>(conversation: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(conversation) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const settled = result.then(() => undefined, () => undefined)
    this.queues.set(conversation, settled)
    void settled.then(() => {
      if (this.queues.get(conversation) === settled) this.queues.delete(conversation)
    })
    return result
  }
}
