/** Project-owned neutral Knowledge archive; provider databases are disposable caches. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveConfinedFilePath } from './confined-fs.ts'
import { parseDesignProjectJson, type DesignProjectId } from './design-project.ts'
import { DesignKnowledgeRevision, type DesignKnowledgeArchive, type DesignKnowledgeImportReport, type DesignKnowledgeService } from './design-knowledge.ts'
import { DESIGN_KNOWLEDGE_PUBLICATION_KEY, type DesignKnowledgePublication, type KnowledgeIndexCache } from './design-knowledge-refresh.ts'

export const DESIGN_KNOWLEDGE_RECORDS_PATH = 'design_records/knowledge/archive.json'
export const DESIGN_KNOWLEDGE_RECORDS_MAX_BYTES = 64 * 1024 * 1024
/** Cache bookkeeping only: never a Design checkpoint or project-file authority. */
export const DESIGN_KNOWLEDGE_RECORDS_CACHE_KEY = createHash('sha256').update('design-project-knowledge-archive-cache-v1').digest('hex')

export interface DesignKnowledgeProjectRecords {
  readonly formatVersion: 1
  readonly archive: DesignKnowledgeArchive
  /** Only a complete publication of the archived final snapshot can be restored. */
  readonly publication?: DesignKnowledgePublication
}

interface RecordsLocation {
  readonly projectRoot: string
  readonly projectId: DesignProjectId
  /** Tests and stricter embeddings may lower, but never raise, the read/write bound. */
  readonly maxBytes?: number
}

function byteLimit(options: RecordsLocation): number {
  const limit = options.maxBytes ?? DESIGN_KNOWLEDGE_RECORDS_MAX_BYTES
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DESIGN_KNOWLEDGE_RECORDS_MAX_BYTES) throw new RangeError('Knowledge archive byte limit is invalid')
  return limit
}

async function readBounded(projectRoot: string, relativePath: string, limit: number): Promise<Buffer | undefined> {
  const path = await resolveConfinedFilePath(projectRoot, relativePath)
  let handle
  try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Knowledge archive must be a regular file')
    if (info.size > limit) throw new RangeError(`Knowledge archive exceeds ${limit} bytes`)
    // Bound the actual read too, including a file that grows after stat(). A
    // changed length is rejected rather than allocating against untrusted growth.
    const bytes = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length !== info.size) throw new Error('Knowledge archive changed during read')
    return bytes.subarray(0, length)
  } finally { await handle.close() }
}

async function assertProject(options: RecordsLocation): Promise<void> {
  const bytes = await readBounded(options.projectRoot, 'project.json', 1024 * 1024)
  if (bytes === undefined || parseDesignProjectJson(bytes.toString('utf8')).id !== options.projectId) throw new Error('Knowledge archive project identity does not match project.json')
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid Knowledge archive ${label}`)
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new Error('Invalid Knowledge archive fields')
}

/** Validate the existing archive envelope, leaving graph semantics to importProject. */
function parseRecords(value: unknown, projectId: DesignProjectId): DesignKnowledgeProjectRecords {
  const records = object(value, 'record')
  keys(records, ['formatVersion', 'archive'], ['publication'])
  const archive = object(records.archive, 'body')
  keys(archive, ['formatVersion', 'projectId', 'revision', 'entities', 'relations', 'proposals', 'decisions'])
  if (records.formatVersion !== 1 || archive.formatVersion !== 1 || archive.projectId !== projectId || typeof archive.revision !== 'string'
    || ![archive.entities, archive.relations, archive.proposals, archive.decisions].every(Array.isArray)) throw new Error('Invalid Knowledge archive format or project identity')
  DesignKnowledgeRevision(archive.revision)
  for (const item of archive.proposals as unknown[]) {
    if (object(object(item, 'proposal').proposal, 'proposal body').projectId !== projectId) throw new Error('Knowledge archive proposal project identity does not match')
  }
  for (const item of archive.decisions as unknown[]) {
    if (object(item, 'decision').projectId !== projectId) throw new Error('Knowledge archive decision project identity does not match')
  }
  if (records.publication !== undefined) {
    const publication = object(records.publication, 'publication')
    keys(publication, ['schemaVersion', 'key', 'edges', 'checkpoint', 'revision', 'warnings'])
    if (publication.schemaVersion !== 1 || typeof publication.key !== 'string' || typeof publication.edges !== 'string' || typeof publication.checkpoint !== 'string'
      || publication.revision !== archive.revision || !Array.isArray(publication.warnings) || publication.warnings.some(warning => typeof warning !== 'string')) {
      throw new Error('Knowledge archive publication must describe its final snapshot')
    }
  }
  return records as unknown as DesignKnowledgeProjectRecords
}

const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const marker = (identity: string, revision: string): string => JSON.stringify({ identity, revision })

async function readRecords(options: RecordsLocation): Promise<{ records: DesignKnowledgeProjectRecords; identity: string } | undefined> {
  byteLimit(options)
  await assertProject(options)
  const bytes = await readBounded(options.projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH, byteLimit(options))
  if (bytes === undefined) return undefined
  return { records: parseRecords(JSON.parse(bytes.toString('utf8')), options.projectId), identity: digest(bytes) }
}

/** Pure bounded read; a missing project archive never promotes an external database. */
export async function readDesignKnowledgeRecords(options: RecordsLocation): Promise<DesignKnowledgeProjectRecords | undefined> {
  return (await readRecords(options))?.records
}

/**
 * Call inside the existing project mutation lane. persist uses the owning Git
 * publication helper; failures propagate and never mark the cache synchronized.
 */
export async function saveDesignKnowledgeRecords(options: RecordsLocation & {
  readonly service: Pick<DesignKnowledgeService, 'exportProject'>
  readonly publication?: DesignKnowledgePublication
  readonly cache?: KnowledgeIndexCache
  readonly persist?: (paths: readonly string[]) => Promise<unknown>
}): Promise<DesignKnowledgeProjectRecords> {
  const limit = byteLimit(options)
  await assertProject(options)
  const archive = await options.service.exportProject(options.projectId)
  const records = parseRecords({ formatVersion: 1, archive, ...(options.publication === undefined ? {} : { publication: options.publication }) }, options.projectId)
  const bytes = Buffer.from(`${JSON.stringify(records, null, 2)}\n`, 'utf8')
  if (bytes.length > limit) throw new RangeError(`Knowledge archive exceeds ${limit} bytes`)
  const initial = await resolveConfinedFilePath(options.projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH)
  await mkdir(dirname(initial), { recursive: true })
  const path = await resolveConfinedFilePath(options.projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH)
  const temporary = join(dirname(path), `.archive.${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    await assertProject(options)
    await resolveConfinedFilePath(options.projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH)
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
  await options.persist?.([DESIGN_KNOWLEDGE_RECORDS_PATH])
  await options.cache?.writeSemanticCache(DESIGN_KNOWLEDGE_RECORDS_CACHE_KEY, marker(digest(bytes), archive.revision))
  return records
}

/**
 * Restore before exposing a provider, under its existing owner serialization.
 * The marker is only a cache shortcut; mismatched bytes/revisions, Git rollback,
 * and a missing archive all discard cached facts through the supplied reset.
 */
export async function restoreDesignKnowledgeRecords(options: RecordsLocation & {
  readonly service: Pick<DesignKnowledgeService, 'revision' | 'importProject'>
  readonly cache?: KnowledgeIndexCache
  readonly resetCache: () => Promise<void>
}): Promise<{ readonly restored: boolean; readonly records?: DesignKnowledgeProjectRecords; readonly revision: ReturnType<typeof DesignKnowledgeRevision>; readonly report?: DesignKnowledgeImportReport }> {
  const loaded = await readRecords(options)
  const identity = loaded?.identity ?? 'missing'
  let revision = await options.service.revision(options.projectId)
  const expectedMarker = marker(identity, revision)
  if (options.cache && await options.cache.readSemanticCache(DESIGN_KNOWLEDGE_RECORDS_CACHE_KEY) === expectedMarker) {
    return { restored: false, ...(loaded ? { records: loaded.records } : {}), revision }
  }
  await options.resetCache()
  const report = loaded ? await options.service.importProject(loaded.records.archive) : undefined
  revision = report?.revision ?? await options.service.revision(options.projectId)
  if (options.cache && loaded?.records.publication) {
    // The archive stores the final snapshot. A proposal revision map can name
    // an earlier reconstruction step; the imported final snapshot is report.revision.
    await options.cache.writeSemanticCache(DESIGN_KNOWLEDGE_PUBLICATION_KEY, JSON.stringify({ ...loaded.records.publication, revision }))
  }
  await options.cache?.writeSemanticCache(DESIGN_KNOWLEDGE_RECORDS_CACHE_KEY, marker(identity, revision))
  return { restored: true, ...(loaded ? { records: loaded.records } : {}), revision, ...(report ? { report } : {}) }
}
