import { createHash, randomUUID, randomInt } from 'node:crypto'
import { mkdir, stat, readFile, open, rename, lstat, copyFile, rm } from 'node:fs/promises'
import { constants, createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  queryKnowledgeSnapshot,
  DesignKnowledgeCheckpointConflictError,
  DesignKnowledgeMutationId,
  DesignKnowledgeProposalDigest,
  assertDesignKnowledgeDecisionAuthority,
  designKnowledgeProposalDigest,
  DesignKnowledgeMutationConflictError,
  DesignKnowledgeRevision,
  DesignKnowledgeRevisionConflictError,
  type DesignKnowledgeDelta,
  type DesignKnowledgeArchive,
  type DesignKnowledgeDecision,
  type DesignKnowledgeEntity,
  type DesignKnowledgeImpactRequest,
  type DesignKnowledgeImportReport,
  type DesignKnowledgeMutationResult,
  type DesignKnowledgeQuery,
  type DesignKnowledgeQueryResult,
  type DesignKnowledgeRelation,
  type DesignKnowledgeTraceRequest,
  type DesignKnowledgeTraceResult,
  type DesignKnowledgeProposal,
  type DesignKnowledgeProposalBatch,
  type DesignKnowledgeProposalBatchResult,
  type DesignKnowledgeRevision as DesignKnowledgeRevisionValue,
  type DesignKnowledgeService,
  type DesignProjectId,
} from 'dsh-design-core'
import lockfile from 'proper-lockfile'
import { canonicalJson, decodeDecision, decodeEntity, decodeProposal, decodeRelation, decisionRequestDigest, encodeProposal, encodeRecord, mutationDigest, proposalBatchRequestDigest } from './codec.ts'
import { resolveLadybugKnowledgeConfig, type LadybugKnowledgeConfig, type LadybugKnowledgeConfigInput } from './config.ts'
import { syncKnowledgeFile, syncKnowledgeDirectory } from './durability.ts'

interface LadybugResult {
  isSuccess(): boolean
  getErrorMessage(): Promise<string>
  getAllObjects(): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

interface LadybugPrepared {
  isSuccess(): boolean
  getErrorMessage(): Promise<string>
  close(): Promise<void>
}

interface LadybugConnection {
  init(): Promise<void>
  query(statement: string): Promise<LadybugResult>
  prepare(statement: string): Promise<LadybugPrepared>
  execute(statement: LadybugPrepared, parameters: Record<string, unknown>): Promise<LadybugResult>
  close(): Promise<void>
}

interface LadybugDatabase {
  close(): Promise<void>
}

interface LadybugModule {
  readonly Database: new (path: string) => LadybugDatabase
  readonly Connection: new (database: LadybugDatabase) => LadybugConnection
  close(): Promise<void>
}

const require = createRequire(import.meta.url)
const ladybug = require('@ladybugdb/wasm-core/nodejs') as LadybugModule
let openProviderCount = 0
let runtimeStopped = false

const AUTHORITATIVE = new Set(['accepted', 'rejected', 'superseded'])
const WRITE_BUSY = 'Only one write transaction at a time'

/** Current on-disk schema accepted by the provider. */
export const LADYBUG_KNOWLEDGE_SCHEMA_VERSION = 2

/** The per-project cross-process owner could not be acquired. */
export class LadybugProjectLockError extends Error {
  constructor(readonly databasePath: string, options?: ErrorOptions) {
    super(`Ladybug Design Knowledge project is already open at ${JSON.stringify(databasePath)}`, options)
    this.name = 'LadybugProjectLockError'
  }
}

/** The bounded serialized-writer acquisition budget was exhausted. */
export class LadybugWriterBusyError extends Error {
  constructor(readonly attempts: number) {
    super(`Ladybug Design Knowledge could not acquire its writer after ${attempts} attempts`)
    this.name = 'LadybugWriterBusyError'
  }
}

/** Existing durable bytes do not identify the requested project and schema. */
export class LadybugSchemaMismatchError extends Error {
  constructor(readonly databasePath: string, detail: string, options?: ErrorOptions) {
    super(`Ladybug Design Knowledge database ${JSON.stringify(databasePath)} ${detail}`, options)
    this.name = 'LadybugSchemaMismatchError'
  }
}

export interface LadybugRecoveryState {
  state: 'rebuilding' | 'ready' | 'error'
  message: string
  generation?: string
}
export interface LadybugRecoveryOptions {
  retryFailed?: boolean
  /** Rebuild only from current Design Files. Return a last-moment source fence. */
  rebuild(provider: LadybugDesignKnowledgeProvider): Promise<() => Promise<void>>
  onState?(state: LadybugRecoveryState): void
}
interface RecoveryManifest {
  format: 1
  projectId: string
  generation: string
  state: 'backed-up' | 'building' | 'active' | 'failed'
  baseline: number
  backup?: string
  backupFiles?: Record<string, string>
  error?: string
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
}

/** Only known durable-format failures permit discarding a derived index. */
export function isRecoverableLadybugError(error: unknown): boolean {
  const chain: Error[] = []
  const seen = new Set<unknown>()
  for (let e = error; e instanceof Error && !seen.has(e); e = e.cause) { seen.add(e); chain.push(e) }
  const text = chain.map(e => e.message).join('\n')
  if (/EACCES|EPERM|ENOSPC|EROFS|EMFILE|ENOMEM|permission|disk.*full|out of memory|already open|identity|project metadata|does not identify/i.test(text)) return false
  return /memory access out of bounds|different storage version|unsupported storage version|database.*(corrupt|invalid header)|incompatible knowledge schema/i.test(text)
}

async function readRecovery(path: string, projectId: string): Promise<RecoveryManifest | undefined> {
  let bytes: string
  try { if (!(await lstat(path)).isFile()) throw new Error('Invalid Knowledge recovery manifest'); bytes = await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const data = JSON.parse(bytes) as RecoveryManifest
  if (data.format !== 1 || data.projectId !== projectId || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(data.generation)
    || !['backed-up', 'building', 'active', 'failed'].includes(data.state) || !Number.isSafeInteger(data.baseline) || data.baseline < 1
    || (data.backup !== undefined && !new RegExp(`^${databaseName(projectId).replace('.', '\\.') }\\.backup-[a-f0-9-]{36}$`).test(data.backup))) throw new Error('Invalid Knowledge recovery identity')
  return data
}
async function writeRecovery(path: string, data: RecoveryManifest): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(data)); await file.sync() } finally { await file.close() }
  await rename(temporary, path)
  await syncKnowledgeDirectory(dirname(path))
}

/** Implemented subset in the first production slice. */
export type LadybugDesignKnowledgeService = DesignKnowledgeService

/** Stop the package-global Ladybug worker after every project provider closes. */
export async function shutdownLadybugKnowledgeRuntime(): Promise<void> {
  if (openProviderCount !== 0) throw new Error(`cannot stop Ladybug Design Knowledge runtime with ${openProviderCount} open provider(s)`)
  if (runtimeStopped) return
  runtimeStopped = true
  await ladybug.close()
}

interface VersionRow {
  readonly id: string
  readonly revision: number
  readonly tombstone: boolean
  readonly payload: unknown
}

function asNumber(value: unknown, name: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Ladybug Design Knowledge ${name} is corrupt`)
  return number
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Ladybug Design Knowledge ${name} is corrupt`)
  return value
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Ladybug Design Knowledge ${name} is corrupt`)
  return value
}

function parseRevision(value: DesignKnowledgeRevisionValue): number {
  const match = /^rev:(0|[1-9]\d*)$/u.exec(value)
  if (match === null) throw new Error(`invalid Design Knowledge revision ${JSON.stringify(value)}`)
  return asNumber(match[1], 'revision')
}

function databaseName(projectId: string): string {
  return `${createHash('sha256').update(projectId).digest('hex')}.lbdb`
}

function uniqueIds(values: readonly { readonly id: string }[], kind: string): void {
  const ids = new Set<string>()
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`Ladybug Design Knowledge delta contains duplicate ${kind} ${JSON.stringify(value.id)}`)
    ids.add(value.id)
  }
}

function uniqueStrings(values: readonly string[], kind: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Ladybug Design Knowledge delta contains duplicate removed ${kind}`)
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Private embedded provider for revisioned Design Knowledge projection. */
export class LadybugDesignKnowledgeProvider implements LadybugDesignKnowledgeService {
  recovery?: LadybugRecoveryState
  #baseline = 0
  readonly #projectId: DesignProjectId
  readonly #config: LadybugKnowledgeConfig
  readonly #databasePath: string
  readonly #database: LadybugDatabase
  readonly #connection: LadybugConnection
  #releaseLock: () => Promise<void>
  #closed = false
  #closing = false
  #connectionClosed = false
  #databaseClosed = false
  #lockReleased = false
  #runtimeCountReleased = false
  #closeTail: Promise<void> = Promise.resolve()
  #operationTail: Promise<void> = Promise.resolve()
  #writeTransaction = false
  // A complete read pages one immutable revision through query(). Repeating
  // the historical-version scan for every page dominates Graph loading time.
  // Keep only one small decoded snapshot; never cache across a write boundary.
  #visibleCache?: { revision: number; generation?: string; baseline: number; entities: DesignKnowledgeEntity[]; relations: DesignKnowledgeRelation[] }

  private constructor(
    projectId: DesignProjectId,
    config: LadybugKnowledgeConfig,
    databasePath: string,
    database: LadybugDatabase,
    connection: LadybugConnection,
    releaseLock: () => Promise<void>,
  ) {
    this.#projectId = projectId
    this.#config = config
    this.#databasePath = databasePath
    this.#database = database
    this.#connection = connection
    this.#releaseLock = releaseLock
  }

  /** Open one exclusively owned project database and initialize its strict schema. */
  static async open(projectId: DesignProjectId, input: LadybugKnowledgeConfigInput, recovery?: LadybugRecoveryOptions): Promise<LadybugDesignKnowledgeProvider> {
    if (runtimeStopped) throw new Error('Ladybug Design Knowledge runtime has been stopped')
    if (projectId.trim() === '') throw new TypeError('Ladybug Design Knowledge project id must not be empty')
    const config = resolveLadybugKnowledgeConfig(input)
    await mkdir(config.databaseRoot, { recursive: true })
    const databasePath = join(config.databaseRoot, databaseName(projectId))
    let releaseLock: (() => Promise<void>) | undefined
    try {
      releaseLock = await lockfile.lock(databasePath, {
        realpath: false,
        stale: config.projectLockStaleMs,
        update: Math.max(1_000, Math.floor(config.projectLockStaleMs / 2)),
        retries: {
          retries: config.projectLockRetries,
          factor: 1,
          minTimeout: config.projectLockMinTimeoutMs,
          maxTimeout: config.projectLockMinTimeoutMs,
        },
      })
    } catch (error) {
      throw new LadybugProjectLockError(databasePath, { cause: error })
    }
    // Hold the logical project's lock across failure, rebuild, verification and
    // publication. A generation is a private DB, never another source of truth.
    const manifestPath = `${databasePath}.recovery.json`
    let candidate: LadybugDesignKnowledgeProvider | undefined
    let manifest: RecoveryManifest | undefined
    let backup: string | undefined
    let backupFiles: Record<string, string> | undefined
    const candidateRoot = (generation: string) => join(config.databaseRoot, `${databaseName(projectId)}.generations`, generation)
    const openCandidate = async (generation: string) => {
      const root = candidateRoot(generation)
      for (const path of [join(config.databaseRoot, `${databaseName(projectId)}.generations`), root]) {
        await mkdir(path, { recursive: true })
        if (!(await lstat(path)).isDirectory()) throw new Error('Invalid Knowledge recovery directory')
      }
      if (await fileExists(join(root, databaseName(projectId) + '.recovery.json'))) throw new Error('Nested Knowledge recovery generation is invalid')
      return this.open(projectId, { ...config, databaseRoot: root })
    }
    const adopt = (provider: LadybugDesignKnowledgeProvider) => {
      const releaseCandidate = provider.#releaseLock
      let candidateReleased = false
      provider.#releaseLock = async () => { if (!candidateReleased) { await releaseCandidate(); candidateReleased = true }; await releaseLock!() }
      return provider
    }
    try {
      manifest = await readRecovery(manifestPath, projectId)
      if (manifest?.state === 'backed-up') {
        backup = manifest.backup
        if (!backup || !await fileExists(join(config.databaseRoot, backup, databaseName(projectId)))) throw new Error('Knowledge recovery backup is missing')
        if (!(await lstat(join(config.databaseRoot, backup))).isDirectory()) throw new Error('Invalid Knowledge recovery backup directory')
        backupFiles = manifest.backupFiles
        if (!backupFiles || !backupFiles['']) throw new Error('Knowledge recovery backup inventory is missing')
        for (const [suffix, digest] of Object.entries(backupFiles)) {
          if (!['', '.wal', '.shadow'].includes(suffix) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid Knowledge recovery backup inventory')
          const path = join(config.databaseRoot, backup, databaseName(projectId) + suffix)
          if (!(await lstat(path)).isFile() || await fileDigest(path) !== digest) throw new Error('Knowledge recovery backup verification failed')
        }
        manifest = undefined
      }
      if (manifest?.state === 'failed') {
        if (!recovery?.retryFailed) throw new Error(typeof manifest.error === 'string' ? manifest.error : '知识库自动恢复失败；旧库已保留。请检查运行环境后重试恢复。')
        manifest = { ...manifest, generation: randomUUID(), state: 'building', baseline: Math.max(manifest.baseline + 1_000_000, Date.now() * 1024 + randomInt(1024)) }
        await writeRecovery(manifestPath, manifest)
      }
      if (manifest?.state === 'active') {
        try {
          if (!await fileExists(join(candidateRoot(manifest.generation), databaseName(projectId)))) throw new Error('Active Knowledge generation is missing')
          candidate = await openCandidate(manifest.generation)
          if (await candidate.#revisionNumber() < manifest.baseline) throw new Error('Active Knowledge generation is missing its verified revision')
          candidate.recovery = { state: 'ready', generation: manifest.generation, message: '图谱已从设计文件恢复，旧知识库已保留。' }
          candidate.#baseline = manifest.baseline
          recovery?.onState?.(candidate.recovery)
          return adopt(candidate)
        } catch (error) {
          if (!recovery || (!isRecoverableLadybugError(error) && !(error as Error).message.startsWith('Active Knowledge generation is missing'))) throw error
          await candidate?.close(); candidate = undefined
          manifest = { ...manifest, generation: randomUUID(), state: 'building', baseline: Math.max(manifest.baseline + 1_000_000, Date.now() * 1024 + randomInt(1024)) }
          await writeRecovery(manifestPath, manifest)
        }
      }
      if (!manifest) {
        // Opening/replaying itself can change bytes. Preserve the complete old
        // durable file set BEFORE calling the native runtime, under its owner lock.
        if (recovery && !backup && await fileExists(databasePath)) {
          backup = `${databaseName(projectId)}.backup-${randomUUID()}`
          backupFiles = {}
          const directory = join(config.databaseRoot, backup)
          await mkdir(directory, { mode: 0o700 })
          for (const suffix of ['', '.wal', '.shadow']) {
            const source = databasePath + suffix
            if (!await fileExists(source)) continue
            if (!(await lstat(source)).isFile()) throw new Error('Invalid Knowledge database file')
            await copyFile(source, join(directory, databaseName(projectId) + suffix), constants.COPYFILE_FICLONE)
            await syncKnowledgeFile(join(directory, databaseName(projectId) + suffix))
            backupFiles[suffix] = await fileDigest(join(directory, databaseName(projectId) + suffix))
          }
          await syncKnowledgeDirectory(directory)
          // Publish only a complete backup, before native open/replay can mutate
          // the source. A crashed open must retain this first byte snapshot.
          await writeRecovery(manifestPath, { format: 1, projectId, generation: randomUUID(), state: 'backed-up', baseline: Date.now() * 1024 + randomInt(1024), backup, backupFiles })
        }
        try {
          const healthy = await this.#openLocked(projectId, config, databasePath, releaseLock)
          if (backup) {
            await rm(manifestPath).catch(() => {})
            // Keep the backup if its registration could not be removed.
            if (!await fileExists(manifestPath)) await rm(join(config.databaseRoot, backup), { recursive: true, force: true }).catch(() => {})
          }
          return healthy
        }
        catch (error) {
          if (!recovery || !isRecoverableLadybugError(error)) throw error
          manifest = { format: 1, projectId, generation: randomUUID(), state: 'building', baseline: Date.now() * 1024 + randomInt(1024), backup, backupFiles }
          await writeRecovery(manifestPath, manifest)
        }
      }
      if (!recovery) throw new Error('知识库恢复尚未完成，请通过设计系统继续恢复。')
      recovery.onState?.({ state: 'rebuilding', generation: manifest.generation, message: '旧知识库不可读，正在从设计文件自动恢复；你可以继续设计。' })
      candidate = await openCandidate(manifest.generation)
      if (await candidate.#revisionNumber() === 0) await candidate.#rows('MATCH (m:KnowledgeMeta {project: $project}) SET m.revision = $revision;', { project: projectId, revision: manifest.baseline })
      candidate.#baseline = manifest.baseline
      candidate.recovery = { state: 'rebuilding', generation: manifest.generation, message: '正在从设计文件重建图谱' }
      for (let attempt = 0; ; attempt++) {
        try {
          const validateSource = await recovery.rebuild(candidate)
          const before = await candidate.exportProject(projectId)
          await candidate.close(); candidate = undefined
          candidate = await openCandidate(manifest.generation)
          candidate.#baseline = manifest.baseline
          candidate.recovery = { state: 'rebuilding', generation: manifest.generation, message: '正在验证重建图谱' }
          const after = await candidate.exportProject(projectId)
          if (canonicalJson(before) !== canonicalJson(after)) throw new Error('Knowledge recovery reopen verification failed')
          await validateSource()
          break
        } catch (error) {
          if (!candidate || !/checkpoint changed/i.test(String((error as Error).message))) throw error
          if (attempt >= 2) throw new Error('设计文件持续变化，恢复暂未完成；请稍后重试恢复。', { cause: error })
          // Writes during recovery are expected; catch up in the same private
          // generation, bounded, without another backup or restoring stale facts.
        }
      }
      await writeRecovery(manifestPath, { ...manifest, state: 'active' })
      candidate.recovery = { state: 'ready', generation: manifest.generation, message: '图谱已从设计文件恢复，旧知识库已保留。' }
      recovery.onState?.(candidate.recovery)
      return adopt(candidate)
    } catch (error) {
      await candidate?.close().catch(() => {})
      if (manifest?.state === 'building') await writeRecovery(manifestPath, { ...manifest, state: 'failed', error: String(error instanceof Error ? error.message : error).slice(0, 1000) }).catch(() => {})
      recovery?.onState?.({ state: 'error', message: error instanceof Error ? error.message : String(error), generation: manifest?.generation })
      await releaseLock().catch(() => {})
      throw error
    }
  }

  static async #openLocked(projectId: DesignProjectId, config: LadybugKnowledgeConfig, databasePath: string, releaseLock: () => Promise<void>): Promise<LadybugDesignKnowledgeProvider> {
    let isNew: boolean | undefined
    let database: LadybugDatabase | undefined
    let connection: LadybugConnection | undefined
    try {
      isNew = !(await fileExists(databasePath))
      database = new ladybug.Database(databasePath)
      connection = new ladybug.Connection(database)
      await connection.init()
      const provider = new LadybugDesignKnowledgeProvider(projectId, config, databasePath, database, connection, releaseLock)
      await provider.#initializeSchema(isNew)
      openProviderCount += 1
      return provider
    } catch (error) {
      await connection?.close().catch(() => {})
      await database?.close().catch(() => {})
      if (isNew === false && !(error instanceof LadybugSchemaMismatchError)) {
        throw new LadybugSchemaMismatchError(databasePath, 'cannot be opened as a supported project database', { cause: error })
      }
      throw error
    }
  }

  /** Close the database, release project ownership, and stop the shared worker when unused. */
  async close(): Promise<void> {
    const execution = this.#closeTail.then(() => this.#closeOnce(), () => this.#closeOnce())
    this.#closeTail = execution.then(() => undefined, () => undefined)
    return execution
  }

  async #closeOnce(): Promise<void> {
    if (this.#closed) return
    this.#closing = true
    await this.#operationTail
    this.#visibleCache = undefined
    let primary: unknown
    for (const cleanup of [
      { done: () => this.#connectionClosed, mark: () => { this.#connectionClosed = true }, run: () => this.#connection.close() },
      { done: () => this.#databaseClosed, mark: () => { this.#databaseClosed = true }, run: () => this.#database.close() },
      { done: () => this.#lockReleased, mark: () => { this.#lockReleased = true }, run: () => this.#releaseLock() },
    ]) {
      if (cleanup.done()) continue
      try {
        await cleanup.run()
        cleanup.mark()
      } catch (error) {
        primary ??= error
      }
    }
    if (!this.#runtimeCountReleased) {
      this.#runtimeCountReleased = true
      openProviderCount -= 1
    }
    this.#closed = this.#connectionClosed && this.#databaseClosed && this.#lockReleased
    if (primary !== undefined) throw primary
  }

  async revision(projectId: Parameters<DesignKnowledgeService['revision']>[0]): Promise<DesignKnowledgeRevisionValue> {
    return this.#serialized(async () => {
      this.#assertProject(projectId)
      return DesignKnowledgeRevision(`rev:${await this.#revisionNumber()}`)
    })
  }

  async applyDelta(delta: DesignKnowledgeDelta): Promise<DesignKnowledgeMutationResult> {
    return this.#serialized(() => this.#applyDelta(delta))
  }

  /** Disposable vector cache in the same project DB, outside fact revisions/journal. */
  async readSemanticCache(key: string): Promise<string | undefined> {
    if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('Invalid semantic cache key')
    return this.#serialized(async () => {
      this.#assertProject(this.#projectId)
      await this.#fixed('CREATE NODE TABLE IF NOT EXISTS DesignSemanticCacheV1(key STRING, payload STRING, PRIMARY KEY(key));')
      const rows = await this.#rows('MATCH (c:DesignSemanticCacheV1 {key: $key}) RETURN c.payload AS payload;', { key })
      return rows.length ? String(rows[0].payload) : undefined
    })
  }
  async writeSemanticCache(key: string, value: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/u.test(key) || Buffer.byteLength(value) > 250_000) throw new Error('Invalid semantic cache entry')
    await this.#serialized(async () => {
      this.#assertProject(this.#projectId)
      await this.#fixed('CREATE NODE TABLE IF NOT EXISTS DesignSemanticCacheV1(key STRING, payload STRING, PRIMARY KEY(key));')
      await this.#rows('MERGE (c:DesignSemanticCacheV1 {key: $key}) SET c.payload = $payload;', { key, payload: value })
    })
  }

  async #applyDelta(delta: DesignKnowledgeDelta): Promise<DesignKnowledgeMutationResult> {
    this.#assertProject(delta.pin.projectId)
    uniqueIds(delta.upsertEntities, 'entity')
    uniqueIds(delta.upsertRelations, 'relation')
    uniqueStrings(delta.removeEntities, 'entity')
    uniqueStrings(delta.removeRelations, 'relation')
    if (delta.upsertEntities.some((entity) => delta.removeEntities.includes(entity.id))) throw new Error('Ladybug Design Knowledge delta cannot upsert and remove the same entity')
    if (delta.upsertRelations.some((relation) => delta.removeRelations.includes(relation.id))) throw new Error('Ladybug Design Knowledge delta cannot upsert and remove the same relation')
    if (delta.pin.inputCheckpoint !== delta.pin.observedCheckpoint) {
      throw new DesignKnowledgeCheckpointConflictError(delta.pin.inputCheckpoint, delta.pin.observedCheckpoint)
    }
    const digest = mutationDigest(delta)
    await this.#beginWrite()
    try {
      const replay = await this.#rows('MATCH (m:KnowledgeMutation {id: $id}) RETURN m.digest AS digest, m.revision AS revision;', { id: delta.mutationId })
      if (replay.length > 0) {
        await this.#rollback()
        if (asString(replay[0].digest, 'mutation digest') !== digest) throw new DesignKnowledgeMutationConflictError(delta.mutationId)
        return { revision: DesignKnowledgeRevision(`rev:${asNumber(replay[0].revision, 'mutation revision')}`), replayed: true }
      }
      const current = await this.#revisionNumber()
      const expected = parseRevision(delta.pin.expectedRevision)
      if (expected !== current) {
        await this.#rollback()
        throw new DesignKnowledgeRevisionConflictError(delta.pin.expectedRevision, DesignKnowledgeRevision(`rev:${current}`))
      }
      const before = await this.#visibleAt(current)
      this.#validateDelta(delta, before)
      const revision = current + 1
      for (const entity of delta.upsertEntities) {
        await this.#ensureEntityIdentity(entity.id)
        await this.#rows('CREATE (:KnowledgeEntityVersion {key: $key, entityId: $id, revision: $revision, tombstone: false, payload: $payload});', {
          key: `${entity.id}@${revision}`, id: entity.id, revision, payload: encodeRecord(entity),
        })
      }
      for (const relation of delta.upsertRelations) {
        await this.#rows('MATCH (source:KnowledgeEntityIdentity {id: $from}), (target:KnowledgeEntityIdentity {id: $to}) CREATE (source)-[:KnowledgeRelationVersion {key: $key, relationId: $id, revision: $revision, tombstone: false, payload: $payload}]->(target);', {
          from: relation.from, to: relation.to, key: `${relation.id}@${revision}`, id: relation.id, revision, payload: encodeRecord(relation),
        })
      }
      for (const id of delta.removeRelations) {
        const relation = before.relations.find((candidate) => candidate.id === id)
        if (relation === undefined) continue
        await this.#rows('MATCH (source:KnowledgeEntityIdentity {id: $from}), (target:KnowledgeEntityIdentity {id: $to}) CREATE (source)-[:KnowledgeRelationVersion {key: $key, relationId: $id, revision: $revision, tombstone: true, payload: $payload}]->(target);', {
          from: relation.from, to: relation.to, key: `${id}@${revision}`, id, revision, payload: '',
        })
      }
      for (const id of delta.removeEntities) {
        await this.#rows('CREATE (:KnowledgeEntityVersion {key: $key, entityId: $id, revision: $revision, tombstone: true, payload: $payload});', {
          key: `${id}@${revision}`, id, revision, payload: '',
        })
      }
      await this.#rows('CREATE (:KnowledgeMutation {id: $id, digest: $digest, revision: $revision});', { id: delta.mutationId, digest, revision })
      await this.#rows('MATCH (m:KnowledgeMeta {project: $project}) SET m.revision = $revision;', { project: this.#projectId, revision })
      await this.#commit()
      await this.#cacheCommittedSnapshot(revision, before, delta.upsertEntities, delta.upsertRelations, delta.removeEntities, delta.removeRelations)
      return { revision: DesignKnowledgeRevision(`rev:${revision}`), replayed: false }
    } catch (error) {
      await this.#rollback().catch(() => {})
      throw error
    }
  }

  async query(request: DesignKnowledgeQuery): Promise<DesignKnowledgeQueryResult> {
    return this.#serialized(async () => {
      this.#assertProject(request.projectId)
      this.#validateQuery(request)
      if (request.offset !== undefined && (!Number.isSafeInteger(request.offset) || request.offset < 0)) throw new Error('Knowledge query offset must be a non-negative safe integer')
      if ((request.offset ?? 0) > 0 && request.revision === undefined) throw new Error('Knowledge continuation requires a pinned revision')
      const current = await this.#revisionNumber()
      const at = request.revision === undefined ? current : parseRevision(request.revision)
      if (at > current) throw new DesignKnowledgeRevisionConflictError(request.revision!, DesignKnowledgeRevision(`rev:${current}`))
      const visible = await this.#visibleAt(at)
      if (at < this.#baseline) throw new Error('Knowledge revision belongs to an earlier database generation')
      return { ...queryKnowledgeSnapshot({ ...visible, revision: DesignKnowledgeRevision(`rev:${at}`) }, request),
        ...(this.recovery?.generation ? { generation: this.recovery.generation } : {}) }
    })
  }

  async trace(request: DesignKnowledgeTraceRequest): Promise<DesignKnowledgeTraceResult> {
    return this.#serialized(async () => {
      this.#assertProject(request.projectId)
      const current = await this.#revisionNumber()
      const at = request.revision === undefined ? current : parseRevision(request.revision)
      if (at > current) throw new DesignKnowledgeRevisionConflictError(request.revision!, DesignKnowledgeRevision(`rev:${current}`))
      const visible = await this.#visibleAt(at)
      const record = request.target === 'entity'
        ? visible.entities.find((value) => value.id === request.entityId)
        : visible.relations.find((value) => value.id === request.relationId)
      if (record === undefined) throw new Error(`Ladybug Design Knowledge ${request.target} is not visible at rev:${at}`)
      return Object.freeze({ revision: DesignKnowledgeRevision(`rev:${at}`), evidence: Object.freeze([...record.provenance.evidence]) })
    })
  }

  async impact(request: DesignKnowledgeImpactRequest): Promise<DesignKnowledgeQueryResult> {
    return this.#serialized(async () => {
      this.#assertProject(request.projectId)
      if (!Number.isSafeInteger(request.depth) || request.depth < 0 || request.depth > this.#config.maxImpactDepth) throw new RangeError(`Ladybug Design Knowledge impact depth must be between 0 and ${this.#config.maxImpactDepth}`)
      if (request.entityIds.length + request.relationIds.length > this.#config.maxImpactSeeds) throw new RangeError(`Ladybug Design Knowledge impact seeds exceed ${this.#config.maxImpactSeeds}`)
      if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > this.#config.maxQueryLimit) throw new RangeError(`Ladybug Design Knowledge impact limit must be between 1 and ${this.#config.maxQueryLimit}`)
      const current = await this.#revisionNumber()
      const at = request.revision === undefined ? current : parseRevision(request.revision)
      if (at > current) throw new DesignKnowledgeRevisionConflictError(request.revision!, DesignKnowledgeRevision(`rev:${current}`))
      const visible = await this.#visibleAt(at)
      const entityIds = new Set<string>(request.entityIds)
      const relationIds = new Set<string>(request.relationIds)
      for (const relation of visible.relations) if (relationIds.has(relation.id)) { entityIds.add(relation.from); entityIds.add(relation.to) }
      for (let depth = 0; depth < request.depth; depth += 1) {
        for (const relation of visible.relations) {
          if (entityIds.has(relation.from) || entityIds.has(relation.to)) {
            relationIds.add(relation.id); entityIds.add(relation.from); entityIds.add(relation.to)
          }
        }
      }
      return Object.freeze({
        revision: DesignKnowledgeRevision(`rev:${at}`),
        entities: Object.freeze(visible.entities.filter((value) => entityIds.has(value.id)).slice(0, request.limit)),
        relations: Object.freeze(visible.relations.filter((value) => relationIds.has(value.id)).slice(0, request.limit)),
      })
    })
  }

  async propose(proposal: DesignKnowledgeProposal, pin: Parameters<DesignKnowledgeService['propose']>[1]): Promise<DesignKnowledgeMutationResult> {
    const result = await this.proposeBatch({
      mutationId: DesignKnowledgeMutationId(proposal.id),
      proposals: Object.freeze([proposal]),
      pin,
    })
    return Object.freeze({ revision: result.revision, replayed: result.replayed })
  }

  async proposeBatch(batch: DesignKnowledgeProposalBatch): Promise<DesignKnowledgeProposalBatchResult> {
    return this.#serialized(async () => {
      const { pin, proposals } = batch
      this.#assertProject(pin.projectId)
      if (proposals.length === 0) throw new Error('Ladybug Design Knowledge proposal batch must not be empty')
      uniqueIds(proposals, 'proposal')
      uniqueIds(proposals.flatMap((proposal) => proposal.entities), 'proposal entity')
      uniqueIds(proposals.flatMap((proposal) => proposal.relations), 'proposal relation')
      const encoded = proposals.map((proposal) => {
        this.#assertProject(proposal.projectId)
        if (proposal.checkpoint !== pin.inputCheckpoint || pin.inputCheckpoint !== pin.observedCheckpoint) throw new DesignKnowledgeCheckpointConflictError(pin.inputCheckpoint, pin.observedCheckpoint)
        if (proposal.summary.trim() === '' || Buffer.byteLength(proposal.summary, 'utf8') > this.#config.maxTextBytes) throw new RangeError('Ladybug Design Knowledge proposal summary is empty or exceeds the text budget')
        const value = encodeProposal(proposal)
        decodeProposal(value.payload, proposal.id, value.digest)
        return Object.freeze({ proposal, ...value })
      })
      const replayDigest = proposalBatchRequestDigest(batch)
      await this.#beginWrite()
      try {
        const replay = await this.#rows('MATCH (m:KnowledgeMutation {id: $id}) RETURN m.digest AS digest, m.revision AS revision;', { id: batch.mutationId })
        if (replay.length > 0) {
          await this.#rollback()
          if (replay.length !== 1 || replay[0].digest !== replayDigest) throw new DesignKnowledgeMutationConflictError(batch.mutationId)
          const revision = DesignKnowledgeRevision(`rev:${asNumber(replay[0].revision, 'proposal batch revision')}`)
          const receipts = []
          for (const item of encoded) {
            const rows = await this.#rows('MATCH (p:KnowledgeProposal {id: $id}) RETURN p.digest AS digest, p.revision AS revision, p.payload AS payload;', { id: item.proposal.id })
            if (rows.length !== 1 || rows[0].digest !== item.digest || asNumber(rows[0].revision, 'proposal revision') !== parseRevision(revision)) {
              throw new Error(`Ladybug Design Knowledge proposal batch ${JSON.stringify(batch.mutationId)} has corrupt replay state`)
            }
            decodeProposal(rows[0].payload, item.proposal.id, item.digest)
            receipts.push(Object.freeze({ proposalId: item.proposal.id, proposalRevision: revision, proposalDigest: DesignKnowledgeProposalDigest(item.digest) }))
          }
          return Object.freeze({ revision, replayed: true, receipts: Object.freeze(receipts) })
        }
        const current = await this.#revisionNumber(); this.#assertExpected(pin.expectedRevision, current)
        for (const item of encoded) {
          const existing = await this.#rows('MATCH (p:KnowledgeProposal {id: $id}) RETURN p.id AS id;', { id: item.proposal.id })
          if (existing.length > 0) throw new DesignKnowledgeMutationConflictError(DesignKnowledgeMutationId(item.proposal.id))
        }
        const before = await this.#visibleAt(current)
        const entities = proposals.flatMap((proposal) => proposal.entities)
        const relations = proposals.flatMap((proposal) => proposal.relations)
        this.#validateDelta({ mutationId: batch.mutationId, pin, upsertEntities: entities, upsertRelations: relations, removeRelations: [], removeEntities: [] }, before)
        const revision = current + 1
        await this.#appendVersions(entities, relations, [], [], before, revision)
        for (const item of encoded) {
          await this.#rows('CREATE (:KnowledgeProposal {id: $id, digest: $digest, requestDigest: $requestDigest, revision: $revision, payload: $payload});', { id: item.proposal.id, digest: item.digest, requestDigest: replayDigest, revision, payload: item.payload })
        }
        await this.#rows('CREATE (:KnowledgeMutation {id: $id, digest: $digest, revision: $revision});', { id: batch.mutationId, digest: replayDigest, revision })
        await this.#advance(revision); await this.#commit()
        await this.#cacheCommittedSnapshot(revision, before, entities, relations)
        const brandedRevision = DesignKnowledgeRevision(`rev:${revision}`)
        return Object.freeze({
          revision: brandedRevision,
          replayed: false,
          receipts: Object.freeze(encoded.map((item) => Object.freeze({
            proposalId: item.proposal.id,
            proposalRevision: brandedRevision,
            proposalDigest: DesignKnowledgeProposalDigest(item.digest),
          }))),
        })
      } catch (error) { await this.#rollback().catch(() => {}); throw error }
    })
  }

  async applyDecision(decision: DesignKnowledgeDecision, pin: Parameters<DesignKnowledgeService['applyDecision']>[1]): Promise<DesignKnowledgeMutationResult> {
    return this.#serialized(async () => {
      this.#assertProject(decision.projectId); this.#assertProject(pin.projectId)
      if (decision.checkpoint !== pin.inputCheckpoint || pin.inputCheckpoint !== pin.observedCheckpoint) throw new DesignKnowledgeCheckpointConflictError(pin.inputCheckpoint, pin.observedCheckpoint)
      const key = createHash('sha256').update(canonicalJson([decision.journal, decision.journalRevision])).digest('hex')
      const digest = decisionRequestDigest(decision, pin)
      await this.#beginWrite()
      try {
        const replay = await this.#rows('MATCH (d:KnowledgeDecision {key: $key}) RETURN d.requestDigest AS requestDigest, d.revision AS revision, d.payload AS payload;', { key })
        if (replay.length > 0) {
          await this.#rollback()
          if (replay.length !== 1 || replay[0].requestDigest !== digest) throw new DesignKnowledgeMutationConflictError(DesignKnowledgeMutationId(key))
          if (canonicalJson(decodeDecision(replay[0].payload)) !== canonicalJson(decision)) throw new Error('Ladybug Design Knowledge replayed decision payload is corrupt')
          return { revision: DesignKnowledgeRevision(`rev:${asNumber(replay[0].revision, 'decision revision')}`), replayed: true }
        }
        const current = await this.#revisionNumber(); this.#assertExpected(pin.expectedRevision, current)
        const proposals = await this.#rows('MATCH (p:KnowledgeProposal {id: $id}) RETURN p.digest AS digest, p.revision AS revision, p.payload AS payload;', { id: decision.proposalId })
        if (proposals.length !== 1 || proposals[0].digest !== decision.proposalDigest || asNumber(proposals[0].revision, 'proposal revision') !== parseRevision(decision.proposalRevision)) throw new Error('Ladybug Design Knowledge decision does not bind a visible immutable proposal')
        const proposal = decodeProposal(proposals[0].payload, decision.proposalId, decision.proposalDigest)
        const prior = await this.#rows('MATCH (d:KnowledgeDecision) RETURN d.payload AS payload;', {})
        if (prior.map((row) => decodeDecision(row.payload)).some((value) => value.proposalId === decision.proposalId && value.decision !== 'deferred')) throw new Error('Ladybug Design Knowledge proposal already has a terminal decision')
        const revision = current + 1
        let committedSnapshot: { before: { entities: DesignKnowledgeEntity[]; relations: DesignKnowledgeRelation[] }; entities: DesignKnowledgeEntity[]; relations: DesignKnowledgeRelation[] } | undefined
        if (decision.decision !== 'deferred') {
          const lifecycle = decision.decision
          const evidence = Object.freeze([...proposal.entities.flatMap((value) => value.provenance.evidence), { source: decision.journal, revision: String(decision.journalRevision) }])
          const provenance = Object.freeze({ producer: 'human-decision' as const, checkpoint: decision.checkpoint, evidence })
          const entities = proposal.entities.map((value) => Object.freeze({ ...value, lifecycle, provenance }))
          const relations = proposal.relations.map((value) => Object.freeze({ ...value, lifecycle, provenance }))
          const before = await this.#visibleAt(current)
          assertDesignKnowledgeDecisionAuthority(proposal, decision, before.entities)
          this.#assertNoAuthoritativeOverwrite(entities, relations, before)
          this.#assertEndpointIntegrity(entities, relations, before)
          await this.#appendVersions(entities, relations, [], [], before, revision)
          committedSnapshot = { before, entities, relations }
        } else {
          // A deferred decision advances metadata but appends no fact versions.
          // Carry forward an existing derived projection without forcing a
          // historical scan on the decision path.
          const before = await this.#readVisibleSidecar(current)
          if (before) committedSnapshot = { before, entities: [], relations: [] }
        }
        await this.#rows('CREATE (:KnowledgeDecision {key: $key, requestDigest: $requestDigest, revision: $revision, payload: $payload});', { key, requestDigest: digest, revision, payload: canonicalJson(decision) })
        await this.#advance(revision); await this.#commit()
        if (committedSnapshot) await this.#cacheCommittedSnapshot(revision, committedSnapshot.before, committedSnapshot.entities, committedSnapshot.relations)
        return { revision: DesignKnowledgeRevision(`rev:${revision}`), replayed: false }
      } catch (error) { await this.#rollback().catch(() => {}); throw error }
    })
  }

  async exportProject(projectId: DesignProjectId, requested?: DesignKnowledgeRevisionValue): Promise<DesignKnowledgeArchive> {
    return this.#serialized(async () => {
      this.#assertProject(projectId)
      const current = await this.#revisionNumber(); const at = requested === undefined ? current : parseRevision(requested)
      if (at > current) throw new DesignKnowledgeRevisionConflictError(requested!, DesignKnowledgeRevision(`rev:${current}`))
      const visible = await this.#visibleAt(at)
      const proposalRows = await this.#rows('MATCH (p:KnowledgeProposal) WHERE p.revision <= $revision RETURN p.id AS id, p.digest AS digest, p.revision AS revision, p.payload AS payload ORDER BY revision, id;', { revision: at })
      const decisionRows = await this.#rows('MATCH (d:KnowledgeDecision) WHERE d.revision <= $revision RETURN d.revision AS revision, d.payload AS payload ORDER BY revision, d.key;', { revision: at })
      return Object.freeze({
        formatVersion: 1 as const, projectId: this.#projectId, revision: DesignKnowledgeRevision(`rev:${at}`),
        entities: Object.freeze(visible.entities), relations: Object.freeze(visible.relations),
        proposals: Object.freeze(proposalRows.map((row) => Object.freeze({ proposal: decodeProposal(row.payload, asString(row.id, 'proposal id'), asString(row.digest, 'proposal digest')), proposalRevision: DesignKnowledgeRevision(`rev:${asNumber(row.revision, 'proposal revision')}`), proposalDigest: DesignKnowledgeProposalDigest(asString(row.digest, 'proposal digest')) }))),
        decisions: Object.freeze(decisionRows.map((row) => decodeDecision(row.payload))),
      })
    })
  }

  /**
   * Discard this project's derived cache before restoring its project archive.
   * Call only before exposing the provider to readers; the project files and
   * their Git history are never touched. Existing provider serialization and
   * project ownership cover reset plus the caller's subsequent import.
   */
  async resetCache(projectId: DesignProjectId): Promise<void> {
    return this.#serialized(async () => {
      this.#assertProject(projectId)
      await this.#fixed('CREATE NODE TABLE IF NOT EXISTS DesignSemanticCacheV1(key STRING, payload STRING, PRIMARY KEY(key));')
      await rm(this.#visibleSidecarPath(), { force: true })
      await this.#beginWrite()
      try {
        await this.#rows('MATCH ()-[v:KnowledgeRelationVersion]->() DELETE v;', {})
        for (const table of ['KnowledgeEntityVersion', 'KnowledgeEntityIdentity', 'KnowledgeMutation', 'KnowledgeProposal', 'KnowledgeDecision', 'DesignSemanticCacheV1']) {
          await this.#fixed(`MATCH (n:${table}) DELETE n;`)
        }
        await this.#rows('MATCH (m:KnowledgeMeta {project: $project}) SET m.revision = $revision;', { project: this.#projectId, revision: this.#baseline })
        await this.#commit()
      } catch (error) { await this.#rollback().catch(() => {}); throw error }
    })
  }

  async importProject(archive: DesignKnowledgeArchive): Promise<DesignKnowledgeImportReport> {
    return this.#serialized(async () => {
      this.#assertProject(archive.projectId)
      const validated = this.#validateArchive(archive)
      await this.#beginWrite()
      try {
        const current = await this.#revisionNumber()
        const occupied = await Promise.all([
          this.#rows('MATCH (p:KnowledgeProposal) RETURN count(p) AS count;', {}),
          this.#rows('MATCH (d:KnowledgeDecision) RETURN count(d) AS count;', {}),
          this.#rows('MATCH (v:KnowledgeEntityVersion) RETURN count(v) AS count;', {}),
          this.#rows('MATCH ()-[v:KnowledgeRelationVersion]->() RETURN count(v) AS count;', {}),
          this.#rows('MATCH (m:KnowledgeMutation) RETURN count(m) AS count;', {}),
        ])
        if (current !== this.#baseline || occupied.some((rows) => asNumber(rows[0]?.count, 'namespace record count') !== 0)) throw new Error('Ladybug Design Knowledge import requires an empty project namespace')
        let target = current
        const mapping: Record<string, DesignKnowledgeRevisionValue> = {}
        const proposalItems = [...validated.proposals].sort((left, right) => parseRevision(left.proposalRevision) - parseRevision(right.proposalRevision))
        const proposalEntityIds = new Set(proposalItems.flatMap((value) => value.proposal.entities.map((entity) => entity.id as string)))
        const proposalRelationIds = new Set(proposalItems.flatMap((value) => value.proposal.relations.map((relation) => relation.id as string)))
        const baseEntities = validated.entities.filter((value) => !proposalEntityIds.has(value.id))
        const nonProposalRelations = validated.relations.filter((value) => !proposalRelationIds.has(value.id))
        const baseRelations = nonProposalRelations.filter((value) => !proposalEntityIds.has(value.from) && !proposalEntityIds.has(value.to))
        const dependentRelations = nonProposalRelations.filter((value) => proposalEntityIds.has(value.from) || proposalEntityIds.has(value.to))
        for (const entity of validated.entities) await this.#ensureEntityIdentity(entity.id)
        if (baseEntities.length + baseRelations.length > 0) { target += 1; await this.#appendVersions(baseEntities, baseRelations, [], [], { entities: [], relations: [] }, target); await this.#advance(target) }
        for (let index = 0; index < proposalItems.length;) {
          const sourceRevision = proposalItems[index]!.proposalRevision
          const group = proposalItems.filter((item) => item.proposalRevision === sourceRevision)
          target += 1
          const checkpoint = group[0]!.proposal.checkpoint
          if (group.some((item) => item.proposal.checkpoint !== checkpoint)) throw new Error('Ladybug Design Knowledge archive proposal batch checkpoints disagree')
          await this.#appendVersions(group.flatMap((item) => item.proposal.entities), group.flatMap((item) => item.proposal.relations), [], [], await this.#visibleAt(target - 1), target)
          const importPin = { projectId: archive.projectId, inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: DesignKnowledgeRevision(`rev:${target - 1}`) }
          const requestDigest = proposalBatchRequestDigest({ mutationId: DesignKnowledgeMutationId(`import:${sourceRevision}`), proposals: group.map((item) => item.proposal), pin: importPin })
          for (const item of group) {
            await this.#rows('CREATE (:KnowledgeProposal {id: $id, digest: $digest, requestDigest: $requestDigest, revision: $revision, payload: $payload});', { id: item.proposal.id, digest: item.proposalDigest, requestDigest, revision: target, payload: encodeProposal(item.proposal).payload })
          }
          mapping[sourceRevision] = DesignKnowledgeRevision(`rev:${target}`)
          await this.#advance(target)
          index += group.length
        }
        if (dependentRelations.length > 0) { target += 1; await this.#appendVersions([], dependentRelations, [], [], await this.#visibleAt(target - 1), target); await this.#advance(target) }
        for (const decision of validated.decisions) {
          target += 1
          const item = proposalItems.find((value) => value.proposal.id === decision.proposalId)!
          if (decision.decision !== 'deferred') {
            const lifecycle = decision.decision
            const evidence = Object.freeze([...item.proposal.entities.flatMap((value) => value.provenance.evidence), { source: decision.journal, revision: String(decision.journalRevision) }])
            const provenance = Object.freeze({ producer: 'human-decision' as const, checkpoint: decision.checkpoint, evidence })
            await this.#appendVersions(item.proposal.entities.map((value) => ({ ...value, lifecycle, provenance })), item.proposal.relations.map((value) => ({ ...value, lifecycle, provenance })), [], [], await this.#visibleAt(target - 1), target)
          }
          const remapped = Object.freeze({ ...decision, proposalRevision: mapping[decision.proposalRevision] })
          const key = createHash('sha256').update(canonicalJson([decision.journal, decision.journalRevision])).digest('hex')
          const pin = { projectId: archive.projectId, inputCheckpoint: decision.checkpoint, observedCheckpoint: decision.checkpoint, expectedRevision: DesignKnowledgeRevision(`rev:${target - 1}`) }
          await this.#rows('CREATE (:KnowledgeDecision {key: $key, requestDigest: $requestDigest, revision: $revision, payload: $payload});', { key, requestDigest: decisionRequestDigest(remapped, pin), revision: target, payload: canonicalJson(remapped) })
          await this.#advance(target)
        }
        const reconstructed = await this.#visibleAt(target)
        const changedEntities = validated.entities.filter((value) => { const currentValue = reconstructed.entities.find((candidate) => candidate.id === value.id); return currentValue === undefined || canonicalJson(currentValue) !== canonicalJson(value) })
        const changedRelations = validated.relations.filter((value) => { const currentValue = reconstructed.relations.find((candidate) => candidate.id === value.id); return currentValue === undefined || canonicalJson(currentValue) !== canonicalJson(value) })
        const finalEntityIds = new Set(validated.entities.map((value) => value.id as string)); const finalRelationIds = new Set(validated.relations.map((value) => value.id as string))
        const removeEntities = reconstructed.entities.filter((value) => !finalEntityIds.has(value.id)).map((value) => value.id)
        const removeRelations = reconstructed.relations.filter((value) => !finalRelationIds.has(value.id)).map((value) => value.id)
        if (changedEntities.length + changedRelations.length + removeEntities.length + removeRelations.length > 0) {
          target += 1; await this.#appendVersions(changedEntities, changedRelations, removeRelations, removeEntities, reconstructed, target); await this.#advance(target)
        }
        mapping[archive.revision] ??= DesignKnowledgeRevision(`rev:${target}`)
        await this.#commit()
        return Object.freeze({ revision: DesignKnowledgeRevision(`rev:${target}`), sourceToTargetRevisions: Object.freeze(mapping) })
      } catch (error) { await this.#rollback().catch(() => {}); throw error }
    })
  }

  async #initializeSchema(isNew: boolean): Promise<void> {
    if (!isNew) {
      let schema: Record<string, unknown>[]
      try {
        schema = await this.#rows('MATCH (s:KnowledgeSchema) RETURN s.key AS key, s.schemaVersion AS schemaVersion, s.project AS project;', {})
      } catch (error) {
        throw new LadybugSchemaMismatchError(this.#databasePath, 'has no supported schema identity', { cause: error })
      }
      if (schema.length !== 1
        || schema[0].key !== 'singleton'
        || schema[0].project !== this.#projectId) {
        throw new LadybugSchemaMismatchError(this.#databasePath, `does not identify schema ${LADYBUG_KNOWLEDGE_SCHEMA_VERSION} for project ${JSON.stringify(this.#projectId)}`)
      }
      if (asNumber(schema[0].schemaVersion, 'schema version') !== LADYBUG_KNOWLEDGE_SCHEMA_VERSION) {
        throw new LadybugSchemaMismatchError(this.#databasePath, 'has incompatible Knowledge schema')
      }
      await this.#assertMetaIdentity()
      return
    }
    await this.#fixed('CREATE NODE TABLE KnowledgeSchema(key STRING, schemaVersion INT64, project STRING, PRIMARY KEY(key));')
    await this.#fixed('CREATE NODE TABLE IF NOT EXISTS KnowledgeMeta(project STRING, revision INT64, PRIMARY KEY(project));')
    await this.#fixed('CREATE NODE TABLE IF NOT EXISTS KnowledgeMutation(id STRING, digest STRING, revision INT64, PRIMARY KEY(id));')
    await this.#fixed('CREATE NODE TABLE IF NOT EXISTS KnowledgeProposal(id STRING, digest STRING, requestDigest STRING, revision INT64, payload STRING, PRIMARY KEY(id));')
    await this.#fixed('CREATE NODE TABLE IF NOT EXISTS KnowledgeDecision(key STRING, requestDigest STRING, revision INT64, payload STRING, PRIMARY KEY(key));')
    await this.#fixed('CREATE NODE TABLE IF NOT EXISTS KnowledgeEntityIdentity(id STRING, PRIMARY KEY(id));')
    await this.#fixed('CREATE NODE TABLE IF NOT EXISTS KnowledgeEntityVersion(key STRING, entityId STRING, revision INT64, tombstone BOOL, payload STRING, PRIMARY KEY(key));')
    await this.#fixed('CREATE REL TABLE IF NOT EXISTS KnowledgeRelationVersion(FROM KnowledgeEntityIdentity TO KnowledgeEntityIdentity, key STRING, relationId STRING, revision INT64, tombstone BOOL, payload STRING);')
    await this.#rows('CREATE (:KnowledgeSchema {key: $key, schemaVersion: $schemaVersion, project: $project});', {
      key: 'singleton', schemaVersion: LADYBUG_KNOWLEDGE_SCHEMA_VERSION, project: this.#projectId,
    })
    await this.#rows('CREATE (:KnowledgeMeta {project: $project, revision: 0});', { project: this.#projectId })
    await this.#assertMetaIdentity()
  }

  async #assertMetaIdentity(): Promise<void> {
    const rows = await this.#rows('MATCH (m:KnowledgeMeta) RETURN m.project AS project, m.revision AS revision;', {})
    if (rows.length !== 1 || rows[0].project !== this.#projectId) {
      throw new LadybugSchemaMismatchError(this.#databasePath, `has invalid project metadata for ${JSON.stringify(this.#projectId)}`)
    }
    asNumber(rows[0].revision, 'meta revision')
  }

  async #beginWrite(): Promise<void> {
    for (let attempt = 1; attempt <= this.#config.writerAttempts; attempt += 1) {
      try {
        await this.#fixed('BEGIN TRANSACTION;')
        this.#visibleCache = undefined
        this.#writeTransaction = true
        return
      } catch (error) {
        if (!String((error as Error).message).includes(WRITE_BUSY)) throw error
        if (attempt < this.#config.writerAttempts) await new Promise((resolve) => setTimeout(resolve, this.#config.writerRetryMs))
      }
    }
    throw new LadybugWriterBusyError(this.#config.writerAttempts)
  }

  async #commit(): Promise<void> { try { await this.#fixed('COMMIT;') } finally { this.#visibleCache = undefined; this.#writeTransaction = false } }
  async #rollback(): Promise<void> { try { await this.#fixed('ROLLBACK;') } finally { this.#visibleCache = undefined; this.#writeTransaction = false } }

  async #revisionNumber(): Promise<number> {
    const rows = await this.#rows('MATCH (m:KnowledgeMeta {project: $project}) RETURN m.revision AS revision;', { project: this.#projectId })
    if (rows.length !== 1) throw new Error(`Ladybug Design Knowledge meta for ${JSON.stringify(this.#projectId)} is missing or duplicated`)
    return asNumber(rows[0].revision, 'meta revision')
  }

  async #visibleAt(revision: number): Promise<{ entities: DesignKnowledgeEntity[]; relations: DesignKnowledgeRelation[] }> {
    const cached = this.#visibleCache
    if (cached?.revision === revision && cached.generation === this.recovery?.generation && cached.baseline === this.#baseline) {
      return structuredClone({ entities: cached.entities, relations: cached.relations })
    }
    // The append-only historical tables are expensive to fold after a process
    // restart. This optional sidecar is a derived snapshot, not Knowledge
    // authority: it is tied to the actual database inode, generation, and
    // revision, and any absent/corrupt/mismatched bytes fall back to the scan.
    // A write transaction reads the *old* current snapshot before appending
    // versions. The sidecar's version counts reject it if facts were already
    // written in this transaction, so it is safe to reuse here as well.
    const currentRead = revision === await this.#revisionNumber()
    if (currentRead) {
      const persisted = await this.#readVisibleSidecar(revision)
      if (persisted !== undefined) {
        if (!this.#writeTransaction && persisted.entities.length + persisted.relations.length <= 5_000) {
          this.#visibleCache = { revision, generation: this.recovery?.generation, baseline: this.#baseline, ...structuredClone(persisted) }
        }
        return persisted
      }
    }
    const entityRows = await this.#rows('MATCH (v:KnowledgeEntityVersion) WHERE v.revision <= $revision RETURN v.entityId AS id, v.revision AS revision, v.tombstone AS tombstone, v.payload AS payload ORDER BY id, revision DESC;', { revision })
    const relationRows = await this.#rows('MATCH (:KnowledgeEntityIdentity)-[v:KnowledgeRelationVersion]->(:KnowledgeEntityIdentity) WHERE v.revision <= $revision RETURN v.relationId AS id, v.revision AS revision, v.tombstone AS tombstone, v.payload AS payload ORDER BY id, revision DESC;', { revision })
    const visible = {
      entities: this.#fold(entityRows, 'entity').map((row) => decodeEntity(row.payload, row.id)),
      relations: this.#fold(relationRows, 'relation').map((row) => decodeRelation(row.payload, row.id)),
    }
    if (!this.#writeTransaction && visible.entities.length + visible.relations.length <= 5_000) {
      this.#visibleCache = { revision, generation: this.recovery?.generation, baseline: this.#baseline, ...structuredClone(visible) }
    }
    if (currentRead && !this.#writeTransaction) await this.#writeVisibleSidecar(revision, visible, [entityRows.length, relationRows.length])
    return visible
  }

  async #cacheCommittedSnapshot(
    revision: number,
    before: { entities: DesignKnowledgeEntity[]; relations: DesignKnowledgeRelation[] },
    entities: readonly DesignKnowledgeEntity[], relations: readonly DesignKnowledgeRelation[],
    removedEntities: readonly string[] = [], removedRelations: readonly string[] = [],
  ): Promise<void> {
    try {
      const entityMap = new Map(before.entities.map((item) => [item.id as string, item]))
      const relationMap = new Map(before.relations.map((item) => [item.id as string, item]))
      for (const id of removedEntities) entityMap.delete(id)
      for (const id of removedRelations) relationMap.delete(id)
      for (const item of entities) entityMap.set(item.id, item)
      for (const item of relations) relationMap.set(item.id, item)
      const visible = {
        entities: [...entityMap.values()].sort((a, b) => compareIds(String(a.id), String(b.id))),
        relations: [...relationMap.values()].sort((a, b) => compareIds(String(a.id), String(b.id))),
      }
      if (visible.entities.length + visible.relations.length <= 5_000) {
        this.#visibleCache = { revision, generation: this.recovery?.generation, baseline: this.#baseline, ...structuredClone(visible) }
      }
      await this.#writeVisibleSidecar(revision, visible, await this.#versionCounts())
    } catch {
      // A derived cache cannot turn a committed fact mutation into an error.
    }
  }

  #visibleSidecarPath(): string { return `${this.#databasePath}.visible-v1.gz` }

  async #databaseIdentity(): Promise<string> {
    const file = await stat(this.#databasePath)
    // Windows filesystems may report a zero/non-unique inode. Creation time
    // distinguishes an atomically replaced DB even when revision numbers are
    // reused; the fallback size/mtime is only for filesystems lacking both.
    const birth = Number.isFinite(file.birthtimeMs) ? file.birthtimeMs : 0
    return `${file.dev}:${file.ino}:${birth}:${file.ino === 0 && birth === 0 ? `${file.size}:${file.mtimeMs}` : ''}`
  }

  async #readVisibleSidecar(revision: number): Promise<{ entities: DesignKnowledgeEntity[]; relations: DesignKnowledgeRelation[] } | undefined> {
    try {
      const path = this.#visibleSidecarPath()
      const input = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      let compressed: Buffer
      try {
        const file = await input.stat()
        if (!file.isFile() || file.size > 16 * 1024 * 1024) return undefined
        compressed = Buffer.alloc(file.size)
        for (let position = 0; position < compressed.length;) {
          const { bytesRead } = await input.read(compressed, position, compressed.length - position, position)
          if (bytesRead === 0) return undefined
          position += bytesRead
        }
      } finally { await input.close() }
      const parsed = JSON.parse(gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8')) as {
        schemaVersion?: unknown; project?: unknown; database?: unknown; generation?: unknown; baseline?: unknown; revision?: unknown;
        digest?: unknown; entities?: unknown; relations?: unknown; versionCounts?: unknown
      }
      if (parsed.schemaVersion !== 1 || parsed.project !== this.#projectId
        || parsed.database !== await this.#databaseIdentity()
        || parsed.generation !== (this.recovery?.generation ?? null)
        || parsed.baseline !== this.#baseline || parsed.revision !== revision
        || !Array.isArray(parsed.entities) || !Array.isArray(parsed.relations)
        || !Array.isArray(parsed.versionCounts) || parsed.versionCounts.length !== 2) return undefined
      // Legacy or external writers can add fact rows at the same meta
      // revision. Cheap counts detect that without fetching every old payload;
      // semantic-cache writes do not alter these fact tables.
      const counts = await this.#versionCounts()
      if (parsed.versionCounts[0] !== counts[0] || parsed.versionCounts[1] !== counts[1]) return undefined
      const content = JSON.stringify({ entities: parsed.entities, relations: parsed.relations })
      if (parsed.digest !== createHash('sha256').update(content).digest('hex')) return undefined
      // The digest detects accidental byte damage, not an invalid but
      // self-consistent projection. A sidecar is never an authority source:
      // validate every record just as we do when folding durable versions.
      const entities: DesignKnowledgeEntity[] = []
      const relations: DesignKnowledgeRelation[] = []
      const entityIds = new Set<string>()
      const relationIds = new Set<string>()
      for (const raw of parsed.entities) {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !('id' in raw) || typeof raw.id !== 'string' || entityIds.has(raw.id)) return undefined
        const entity = decodeEntity(canonicalJson(raw), raw.id)
        entityIds.add(entity.id)
        entities.push(entity)
      }
      for (const raw of parsed.relations) {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !('id' in raw) || typeof raw.id !== 'string' || relationIds.has(raw.id)) return undefined
        const relation = decodeRelation(canonicalJson(raw), raw.id)
        if (!entityIds.has(relation.from) || !entityIds.has(relation.to)) return undefined
        relationIds.add(relation.id)
        relations.push(relation)
      }
      return { entities, relations }
    } catch {
      return undefined
    }
  }

  async #versionCounts(): Promise<readonly [number, number]> {
    const entities = await this.#rows('MATCH (v:KnowledgeEntityVersion) RETURN count(v) AS n;', {})
    const relations = await this.#rows('MATCH ()-[v:KnowledgeRelationVersion]->() RETURN count(v) AS n;', {})
    return [asNumber(entities[0]?.n, 'entity version count'), asNumber(relations[0]?.n, 'relation version count')]
  }

  async #writeVisibleSidecar(revision: number, visible: { entities: DesignKnowledgeEntity[]; relations: DesignKnowledgeRelation[] }, versionCounts: readonly [number, number]): Promise<void> {
    let temporary: string | undefined
    try {
      const content = JSON.stringify(visible)
      if (Buffer.byteLength(content) > 64 * 1024 * 1024) return
      const payload = gzipSync(JSON.stringify({ schemaVersion: 1, project: this.#projectId,
        database: await this.#databaseIdentity(), generation: this.recovery?.generation ?? null,
        baseline: this.#baseline, revision, versionCounts, digest: createHash('sha256').update(content).digest('hex'), ...visible }))
      if (payload.byteLength > 16 * 1024 * 1024) return
      temporary = `${this.#visibleSidecarPath()}.${randomUUID()}.tmp`
      const output = await open(temporary, 'wx', 0o600)
      try { await output.writeFile(payload); await output.sync() } finally { await output.close() }
      await rename(temporary, this.#visibleSidecarPath())
      temporary = undefined
    } catch {
      // Cache maintenance is best-effort; Knowledge reads remain authoritative.
    } finally {
      if (temporary !== undefined) await rm(temporary, { force: true }).catch(() => {})
    }
  }

  #fold(rows: readonly Record<string, unknown>[], kind: 'entity' | 'relation'): VersionRow[] {
    const latest = new Map<string, VersionRow>()
    for (const row of rows) {
      const value = { id: asString(row.id, `${kind} id`), revision: asNumber(row.revision, `${kind} revision`), tombstone: asBoolean(row.tombstone, `${kind} tombstone`), payload: row.payload }
      if (!latest.has(value.id)) latest.set(value.id, value)
    }
    return [...latest.values()].filter((row) => !row.tombstone).sort((left, right) => compareIds(left.id, right.id))
  }

  #validateDelta(delta: DesignKnowledgeDelta, before: { entities: DesignKnowledgeEntity[]; relations: DesignKnowledgeRelation[] }): void {
    for (const record of [...delta.upsertEntities, ...delta.upsertRelations]) {
      if (record.lifecycle !== 'observed' && record.lifecycle !== 'proposed') {
        throw new Error(`Ladybug Design Knowledge delta cannot write authoritative lifecycle ${JSON.stringify(record.lifecycle)}`)
      }
    }
    const removeEntities = new Set<string>(delta.removeEntities)
    const removeRelations = new Set<string>(delta.removeRelations)
    for (const entity of before.entities) {
      if (AUTHORITATIVE.has(entity.lifecycle) && (removeEntities.has(entity.id) || delta.upsertEntities.some((candidate) => candidate.id === entity.id))) {
        throw new Error(`Ladybug Design Knowledge delta cannot overwrite or remove authoritative entity ${JSON.stringify(entity.id)}`)
      }
    }
    for (const relation of before.relations) {
      if (AUTHORITATIVE.has(relation.lifecycle) && (removeRelations.has(relation.id) || delta.upsertRelations.some((candidate) => candidate.id === relation.id))) {
        throw new Error(`Ladybug Design Knowledge delta cannot overwrite or remove authoritative relation ${JSON.stringify(relation.id)}`)
      }
    }
    const entities = new Set(before.entities.map((entity) => entity.id as string))
    for (const id of delta.removeEntities) entities.delete(id)
    for (const entity of delta.upsertEntities) entities.add(entity.id)
    const relations = new Map(before.relations.map((relation) => [relation.id as string, relation]))
    for (const id of delta.removeRelations) relations.delete(id)
    for (const relation of delta.upsertRelations) relations.set(relation.id, relation)
    for (const relation of relations.values()) {
      if (!entities.has(relation.from) || !entities.has(relation.to)) {
        throw new Error(`Ladybug Design Knowledge relation ${JSON.stringify(relation.id)} has an endpoint absent from the same revision`)
      }
    }
  }

  #assertExpected(expectedRevision: DesignKnowledgeRevisionValue, current: number): void {
    if (parseRevision(expectedRevision) !== current) throw new DesignKnowledgeRevisionConflictError(expectedRevision, DesignKnowledgeRevision(`rev:${current}`))
  }

  #assertNoAuthoritativeOverwrite(entities: readonly DesignKnowledgeEntity[], relations: readonly DesignKnowledgeRelation[], before: { entities: DesignKnowledgeEntity[]; relations: DesignKnowledgeRelation[] }): void {
    for (const entity of entities) if (before.entities.some((value) => value.id === entity.id && AUTHORITATIVE.has(value.lifecycle))) throw new Error(`Ladybug Design Knowledge decision cannot overwrite authoritative entity ${JSON.stringify(entity.id)}`)
    for (const relation of relations) if (before.relations.some((value) => value.id === relation.id && AUTHORITATIVE.has(value.lifecycle))) throw new Error(`Ladybug Design Knowledge decision cannot overwrite authoritative relation ${JSON.stringify(relation.id)}`)
  }

  #assertEndpointIntegrity(entities: readonly DesignKnowledgeEntity[], relations: readonly DesignKnowledgeRelation[], before: { entities: DesignKnowledgeEntity[]; relations: DesignKnowledgeRelation[] }): void {
    const visibleEntityIds = new Set(before.entities.map((value) => value.id as string))
    for (const entity of entities) visibleEntityIds.add(entity.id)
    const visibleRelations = new Map(before.relations.map((value) => [value.id as string, value]))
    for (const relation of relations) visibleRelations.set(relation.id, relation)
    for (const relation of visibleRelations.values()) if (!visibleEntityIds.has(relation.from) || !visibleEntityIds.has(relation.to)) throw new Error(`Ladybug Design Knowledge decision relation ${JSON.stringify(relation.id)} has an endpoint absent from the same revision`)
  }

  async #advance(revision: number): Promise<void> {
    await this.#rows('MATCH (m:KnowledgeMeta {project: $project}) SET m.revision = $revision;', { project: this.#projectId, revision })
  }

  async #appendVersions(
    entities: readonly DesignKnowledgeEntity[], relations: readonly DesignKnowledgeRelation[],
    removeRelations: readonly string[], removeEntities: readonly string[],
    before: { entities: DesignKnowledgeEntity[]; relations: DesignKnowledgeRelation[] }, revision: number,
  ): Promise<void> {
    for (const entity of entities) {
      await this.#ensureEntityIdentity(entity.id)
      await this.#rows('CREATE (:KnowledgeEntityVersion {key: $key, entityId: $id, revision: $revision, tombstone: false, payload: $payload});', { key: `${entity.id}@${revision}`, id: entity.id, revision, payload: encodeRecord(entity) })
    }
    for (const relation of relations) {
      await this.#rows('MATCH (source:KnowledgeEntityIdentity {id: $from}), (target:KnowledgeEntityIdentity {id: $to}) CREATE (source)-[:KnowledgeRelationVersion {key: $key, relationId: $id, revision: $revision, tombstone: false, payload: $payload}]->(target);', { from: relation.from, to: relation.to, key: `${relation.id}@${revision}`, id: relation.id, revision, payload: encodeRecord(relation) })
    }
    for (const id of removeRelations) {
      const relation = before.relations.find((value) => value.id === id)
      if (relation !== undefined) await this.#rows('MATCH (source:KnowledgeEntityIdentity {id: $from}), (target:KnowledgeEntityIdentity {id: $to}) CREATE (source)-[:KnowledgeRelationVersion {key: $key, relationId: $id, revision: $revision, tombstone: true, payload: $payload}]->(target);', { from: relation.from, to: relation.to, key: `${id}@${revision}`, id, revision, payload: '' })
    }
    for (const id of removeEntities) await this.#rows('CREATE (:KnowledgeEntityVersion {key: $key, entityId: $id, revision: $revision, tombstone: true, payload: $payload});', { key: `${id}@${revision}`, id, revision, payload: '' })
  }

  #validateArchive(archive: DesignKnowledgeArchive): DesignKnowledgeArchive {
    if (archive.formatVersion !== 1 || archive.projectId !== this.#projectId) throw new Error('Ladybug Design Knowledge archive identity is invalid')
    const finalRevision = parseRevision(archive.revision)
    const count = archive.entities.length + archive.relations.length + archive.proposals.length + archive.decisions.length
    if (count > this.#config.maxArchiveRecords) throw new RangeError(`Ladybug Design Knowledge archive exceeds ${this.#config.maxArchiveRecords} records`)
    uniqueIds(archive.entities, 'archive entity'); uniqueIds(archive.relations, 'archive relation')
    const entityIds = new Set(archive.entities.map((value) => value.id as string))
    for (const entity of archive.entities) decodeEntity(canonicalJson(entity), entity.id)
    for (const relation of archive.relations) {
      decodeRelation(canonicalJson(relation), relation.id)
      if (!entityIds.has(relation.from) || !entityIds.has(relation.to)) throw new Error(`Ladybug Design Knowledge archive relation ${JSON.stringify(relation.id)} has an absent endpoint`)
    }
    const proposals = new Map<string, typeof archive.proposals[number]>()
    const ownedEntityIds = new Set<string>(); const ownedRelationIds = new Set<string>()
    for (const item of archive.proposals) {
      if (item.proposal.projectId !== archive.projectId || item.proposalDigest !== designKnowledgeProposalDigest(item.proposal)) throw new Error('Ladybug Design Knowledge archive proposal digest or project is invalid')
      const sourceRevision = parseRevision(item.proposalRevision)
      if (sourceRevision < 1 || sourceRevision > finalRevision) throw new Error('Ladybug Design Knowledge archive proposal revision is invalid')
      decodeProposal(canonicalJson(item.proposal), item.proposal.id, item.proposalDigest)
      for (const entity of item.proposal.entities) {
        if (ownedEntityIds.has(entity.id)) throw new Error('Ladybug Design Knowledge archive proposal entity ownership overlaps')
        ownedEntityIds.add(entity.id)
      }
      for (const relation of item.proposal.relations) {
        if (ownedRelationIds.has(relation.id)) throw new Error('Ladybug Design Knowledge archive proposal relation ownership overlaps')
        ownedRelationIds.add(relation.id)
      }
      const ids = new Set([...entityIds, ...item.proposal.entities.map((value) => value.id as string)])
      for (const relation of item.proposal.relations) if (!ids.has(relation.from) || !ids.has(relation.to)) throw new Error('Ladybug Design Knowledge archive proposal relation has an absent endpoint')
      if (proposals.has(item.proposal.id)) throw new Error('Ladybug Design Knowledge archive proposal id is duplicated')
      proposals.set(item.proposal.id, item)
    }
    const journalKeys = new Set<string>(); const terminal = new Set<string>()
    for (const decision of archive.decisions) {
      const item = proposals.get(decision.proposalId)
      if (decision.projectId !== archive.projectId || item === undefined || decision.proposalRevision !== item.proposalRevision || decision.proposalDigest !== item.proposalDigest) throw new Error('Ladybug Design Knowledge archive decision does not bind an archived proposal')
      const key = canonicalJson([decision.journal, decision.journalRevision])
      if (journalKeys.has(key)) throw new Error('Ladybug Design Knowledge archive journal decision is duplicated')
      journalKeys.add(key)
      if (terminal.has(decision.proposalId)) throw new Error('Ladybug Design Knowledge archive has a decision after a terminal decision')
      if (decision.decision !== 'deferred') {
        terminal.add(decision.proposalId)
        for (const entity of item.proposal.entities) if (archive.entities.find((value) => value.id === entity.id)?.lifecycle !== decision.decision) throw new Error('Ladybug Design Knowledge archive terminal entity lifecycle is inconsistent')
        for (const relation of item.proposal.relations) if (archive.relations.find((value) => value.id === relation.id)?.lifecycle !== decision.decision) throw new Error('Ladybug Design Knowledge archive terminal relation lifecycle is inconsistent')
      }
    }
    for (const entity of archive.entities) if (AUTHORITATIVE.has(entity.lifecycle)) {
      const owner = archive.proposals.find((value) => value.proposal.entities.some((candidate) => candidate.id === entity.id))
      if (owner === undefined || !archive.decisions.some((value) => value.proposalId === owner.proposal.id && value.decision === entity.lifecycle)) throw new Error('Ladybug Design Knowledge archive authoritative entity lacks its journal decision')
    }
    for (const relation of archive.relations) if (AUTHORITATIVE.has(relation.lifecycle)) {
      const owner = archive.proposals.find((value) => value.proposal.relations.some((candidate) => candidate.id === relation.id))
      if (owner === undefined || !archive.decisions.some((value) => value.proposalId === owner.proposal.id && value.decision === relation.lifecycle)) throw new Error('Ladybug Design Knowledge archive authoritative relation lacks its journal decision')
    }
    return archive
  }

  #validateQuery(request: DesignKnowledgeQuery): void {
    if (request.direction !== undefined && (!['incoming', 'outgoing', 'both'].includes(request.direction) || request.incidentTo === undefined)) {
      throw new TypeError('Knowledge direction requires incidentTo and must be incoming, outgoing or both')
    }
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > this.#config.maxQueryLimit) {
      throw new RangeError(`Ladybug Design Knowledge query limit must be between 1 and ${this.#config.maxQueryLimit}`)
    }
    if (request.text !== undefined && Buffer.byteLength(request.text, 'utf8') > this.#config.maxTextBytes) {
      throw new RangeError(`Ladybug Design Knowledge query text exceeds ${this.#config.maxTextBytes} bytes`)
    }
    for (const [name, values] of [
      ['entityIds', request.entityIds],
      ['relationIds', request.relationIds],
      ['incidentTo', request.incidentTo],
      ['sourceFiles', request.sourceFiles],
      ['entityTypes', request.entityTypes],
      ['ontologyTypes', request.ontologyTypes],
      ['recordKinds', request.recordKinds],
      ['identityQualities', request.identityQualities],
      ['relationTypes', request.relationTypes],
      ['relationMeanings', request.relationMeanings],
      ['relationOrigins', request.relationOrigins],
      ['lifecycles', request.lifecycles],
    ] as const) {
      if (values !== undefined && (!Array.isArray(values) || values.some(value => typeof value !== 'string'))) {
        throw new TypeError(`Ladybug Design Knowledge query ${name} must be a string array`)
      }
      if (values !== undefined && values.length > this.#config.maxFilterValues) {
        throw new RangeError(`Ladybug Design Knowledge query ${name} exceeds ${this.#config.maxFilterValues} values`)
      }
    }
  }

  async #ensureEntityIdentity(id: string): Promise<void> {
    const existing = await this.#rows('MATCH (e:KnowledgeEntityIdentity {id: $id}) RETURN e.id AS id;', { id })
    if (existing.length === 0) await this.#rows('CREATE (:KnowledgeEntityIdentity {id: $id});', { id })
  }

  async #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationTail
    let release!: () => void
    this.#operationTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async #fixed(statement: string): Promise<void> {
    const result = await this.#connection.query(statement)
    try {
      if (!result.isSuccess()) throw new Error(await result.getErrorMessage())
    } finally {
      await result.close()
    }
  }

  async #rows(statement: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const prepared = await this.#connection.prepare(statement)
    try {
      if (!prepared.isSuccess()) throw new Error(await prepared.getErrorMessage())
      const result = await this.#connection.execute(prepared, parameters)
      try {
        if (!result.isSuccess()) throw new Error(await result.getErrorMessage())
        return await result.getAllObjects()
      } finally {
        await result.close()
      }
    } finally {
      await prepared.close()
    }
  }

  #assertProject(projectId: string): void {
    if (projectId !== this.#projectId) throw new Error(`Ladybug Design Knowledge provider owns ${JSON.stringify(this.#projectId)}, not ${JSON.stringify(projectId)}`)
    if (this.#closing) throw new Error('Ladybug Design Knowledge provider is closing or closed')
  }
}
