/** Host-neutral orchestration over existing project serialization and embedding. */
import type { DesignFilesStore } from './design-files.ts'
import type { DesignProjectId } from './design-project.ts'
import {
  DesignKnowledgeRevision,
  type DesignKnowledgeRevision as DesignKnowledgeRevisionValue,
  type DesignKnowledgeService,
} from './design-knowledge.ts'
import type { SchemaSpec } from './schema.ts'
import type { DesignGraph, DesignGraphEdge } from './design-graph.ts'
import { materializeDesignFilesKnowledge } from './design-knowledge-projection.ts'
import { readCompleteDesignKnowledge } from './design-knowledge-snapshot.ts'
import { knowledgeSemanticInput, publishKnowledgeSemantic } from './design-knowledge-semantic.ts'
import { semanticDigest } from './design-semantic.ts'
import { designKnowledgeSourcePolicyIdentity } from './design-knowledge-source-policy.ts'
import type { DesignKnowledgeIndex } from './design-knowledge-index.ts'
import type { CompiledDesignOntologyContract } from './design-ontology.ts'

export interface KnowledgeIndexCache {
  readSemanticCache(key: string): Promise<string | undefined>
  writeSemanticCache(key: string, value: string): Promise<void>
}
const stable = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
/** Project-local pointer to the last fully published file + semantic KAG. */
export const DESIGN_KNOWLEDGE_PUBLICATION_KEY = semanticDigest('kag-semantic-publication-v3-independent-sources')

export interface DesignKnowledgePublication {
  readonly schemaVersion: 1
  readonly key: string
  readonly edges: string
  readonly checkpoint: string
  readonly revision: DesignKnowledgeRevisionValue
  readonly warnings: readonly string[]
}

function parsePublication(value: string | undefined): DesignKnowledgePublication | undefined {
  if (value === undefined) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<DesignKnowledgePublication>
    if (parsed.schemaVersion !== 1 || typeof parsed.key !== 'string' || typeof parsed.edges !== 'string'
      || typeof parsed.checkpoint !== 'string' || typeof parsed.revision !== 'string' || !Array.isArray(parsed.warnings)
      || parsed.warnings.some(warning => typeof warning !== 'string')) return undefined
    return Object.freeze({ schemaVersion: 1, key: parsed.key, edges: parsed.edges,
      checkpoint: parsed.checkpoint, revision: DesignKnowledgeRevision(parsed.revision),
      warnings: Object.freeze([...parsed.warnings]) })
  } catch { return undefined }
}

/** Read the stable publication pointer without starting projection or embedding work. */
export async function readDesignKnowledgePublication(cache?: KnowledgeIndexCache): Promise<DesignKnowledgePublication | undefined> {
  if (!cache) return undefined
  try { return parsePublication(await cache.readSemanticCache(DESIGN_KNOWLEDGE_PUBLICATION_KEY)) }
  catch { return undefined }
}

/** Project-local pointer to the last failed maintenance generation. */
export const DESIGN_KNOWLEDGE_FAILURE_KEY = semanticDigest('kag-maintenance-failure-v1')

const FAILURE_MESSAGE_LIMIT = 1_000

export interface DesignKnowledgeFailureRecord {
  readonly schemaVersion: 1
  readonly target: string
  readonly message: string
}

function parseFailure(value: string | undefined): DesignKnowledgeFailureRecord | undefined {
  if (value === undefined) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<DesignKnowledgeFailureRecord>
    if (parsed.schemaVersion !== 1 || typeof parsed.target !== 'string' || typeof parsed.message !== 'string') return undefined
    return Object.freeze({ schemaVersion: 1, target: parsed.target, message: parsed.message.slice(0, FAILURE_MESSAGE_LIMIT) })
  } catch { return undefined }
}

/** Read the durable failure pointer without starting any work. */
export async function readDesignKnowledgeFailure(cache?: KnowledgeIndexCache): Promise<DesignKnowledgeFailureRecord | undefined> {
  if (!cache) return undefined
  try { return parseFailure(await cache.readSemanticCache(DESIGN_KNOWLEDGE_FAILURE_KEY)) }
  catch { return undefined }
}

/**
 * Record one bounded failure of the exact current generation target. This is
 * derived diagnostics: an unavailable pointer degrades a restart to the honest
 * `due` state and must never break the failing maintenance path itself.
 */
export async function writeDesignKnowledgeFailure(cache: KnowledgeIndexCache | undefined, target: string, message: string): Promise<void> {
  if (!cache) return
  try {
    await cache.writeSemanticCache(DESIGN_KNOWLEDGE_FAILURE_KEY, stable(Object.freeze({
      schemaVersion: 1, target, message: message.slice(0, FAILURE_MESSAGE_LIMIT),
    })))
  } catch { /* Diagnostics are best-effort; memory state and `due` remain honest. */ }
}

/** Clear the failure pointer when a new attempt is admitted or completes. */
export async function clearDesignKnowledgeFailure(cache: KnowledgeIndexCache | undefined): Promise<void> {
  if (!cache) return
  try { await cache.writeSemanticCache(DESIGN_KNOWLEDGE_FAILURE_KEY, '') }
  catch { /* Best-effort diagnostics. */ }
}

/** Advance a complete publication after a same-checkpoint GRA writeback. */
export async function advanceDesignKnowledgePublication(
  cache: KnowledgeIndexCache | undefined,
  checkpoint: string,
  revision: DesignKnowledgeRevisionValue,
  sameEvidence?: (left: string, right: string) => Promise<boolean>,
): Promise<void> {
  const publication = await readDesignKnowledgePublication(cache)
  if (!cache || !publication || (publication.checkpoint !== checkpoint
    && !await sameEvidence?.(publication.checkpoint, checkpoint))) return
  await writePublication(cache, { ...publication, revision })
}

/** Read only the last complete KAG generation. The caller decides how to expose staleness. */
export async function readPublishedDesignKnowledge(options: {
  service: DesignKnowledgeService
  cache?: KnowledgeIndexCache
  projectId: DesignProjectId
  limit?: number
  signal?: AbortSignal
}) {
  const publication = await readDesignKnowledgePublication(options.cache)
  const snapshot = await readCompleteDesignKnowledge(options.service, {
    projectId: options.projectId,
    ...(publication ? { revision: publication.revision } : {}),
    limit: options.limit ?? 100,
  }, options.signal)
  return { publication, snapshot }
}
const edgeDigest = (snapshot: Awaited<ReturnType<typeof readCompleteDesignKnowledge>>) => semanticDigest(stable(snapshot.relations
  .filter(edge => edge.provenance.producer === 'source-analysis' && edge.properties.projection === 'embedding-v1').sort((a, b) => a.id.localeCompare(b.id))))

async function writePublication(
  cache: KnowledgeIndexCache,
  publication: DesignKnowledgePublication,
  signal?: AbortSignal,
): Promise<void> {
  let failure: unknown
  // The graph mutation may already be durable when its derived pointer is
  // written. Bound transient cache recovery here; never report a generation
  // ready while readers still resolve an older publication.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal?.throwIfAborted()
    try {
      await cache.writeSemanticCache(DESIGN_KNOWLEDGE_PUBLICATION_KEY, stable(publication))
      return
    } catch (error) { failure = error }
  }
  throw new Error('KAG complete-publication pointer is unavailable after bounded retry', { cause: failure })
}

export interface DesignKnowledgeRefreshOptions {
  projectId: DesignProjectId
  service: DesignKnowledgeService
  store: DesignFilesStore
  schemas?: Record<string, SchemaSpec>
  ontology?: CompiledDesignOntologyContract
  signal?: AbortSignal
  /**
   * Mutation boundary supplied by the host. KAG uses a dedicated project
   * scheduler so derived work cannot block authoritative Design Files.
   */
  mutate<T>(operation: () => Promise<T>): Promise<T>
  /** Existing embedding worker/job implementation, optional when disabled. */
  compute?: (graph: DesignGraph, signal?: AbortSignal) => Promise<{ edges: DesignGraphEdge[] }>
  /** Model + similarity policy identity, not credentials or presentation settings. */
  identity?: string
  cache?: KnowledgeIndexCache
  indexer?: DesignKnowledgeIndex
  background?: boolean
  /** Observable operational phase only; never a design or Knowledge fact. */
  report?: (phase: 'projection' | 'semantic' | 'publication' | 'ready' | 'error' | 'disabled') => void
  /** Save the settled graph to the project's Git-tracked record, within mutate. */
  persist?: (publication: DesignKnowledgePublication | undefined, signal?: AbortSignal) => Promise<void>
}

async function sameCheckpoint(store: DesignFilesStore, left: string, right: string | undefined, signal?: AbortSignal): Promise<boolean> {
  return right !== undefined && (left === right || !!await store.sameDesignEvidenceAt?.(left, right, signal))
}

export async function refreshDesignKnowledge(options: DesignKnowledgeRefreshOptions) {
  const { projectId, service, store, mutate, signal } = options
  const epoch = options.indexer?.capture(projectId)
  options.report?.('projection')
  const prepared = await mutate(async () => {
    const previous = await readDesignKnowledgePublication(options.cache)
    const head = await store.head(signal)
    // Keep the existing Design commit when only assessment/advisory/archive
    // records advanced Git. This prevents a successful archive save from
    // invalidating its own projection or recomputing embeddings on reopen.
    const checkpoint = previous && await sameCheckpoint(store, previous.checkpoint, head, signal) ? previous.checkpoint : undefined
    const source = await materializeDesignFilesKnowledge({ ...options, ...(checkpoint ? { checkpoint } : {}) })
    const snapshot = await readCompleteDesignKnowledge(service, { projectId, limit: 100 }, signal)
    const input = knowledgeSemanticInput(snapshot, source.checkpoint, !!options.compute)
    const key = semanticDigest(stable(['kag-index-v3-independent-sources', designKnowledgeSourcePolicyIdentity(options.schemas), projectId, input.checkpoint, input.generation,
      options.ontology?.revision ?? 'ontology-unavailable', options.identity,
      input.semanticUnits?.map(unit => [unit.id, unit.nodeId, unit.file, unit.pointer, unit.fieldPointers, unit.digest])]))
    const edges = edgeDigest(snapshot)
    let completed = false
    if (options.compute && options.cache && options.identity) {
      try {
        const publication = parsePublication(await options.cache.readSemanticCache(DESIGN_KNOWLEDGE_PUBLICATION_KEY))
        completed = publication?.key === key && publication.edges === edges && publication.checkpoint === source.checkpoint
      }
      catch { /* Derived cache unavailable: use current files, never claim ready. */ }
    }
    return { source, input, key, edges, completed }
  })
  if (epoch !== undefined) options.indexer!.assertCurrent(projectId, epoch)
  if (!options.compute) {
    if (!options.cache) {
      await mutate(() => options.persist?.(undefined, signal) ?? Promise.resolve())
      options.report?.('disabled'); return { ...prepared.source, semantic: 'disabled' as const }
    }
    const result = await mutate(async () => {
      if (epoch !== undefined) options.indexer!.assertCurrent(projectId, epoch)
      signal?.throwIfAborted()
      const checkpoint = await store.head(signal)
      if (!await sameCheckpoint(store, prepared.source.checkpoint, checkpoint, signal)) throw new Error('Design checkpoint changed during KAG publication')
      // A same-checkpoint GRA write may have landed after file projection. Pin
      // the pointer to the latest serialized revision so its accepted evidence
      // cannot disappear from the published graph.
      const snapshot = await readCompleteDesignKnowledge(service, { projectId, limit: 100 }, signal)
      const edges = edgeDigest(snapshot)
      const publication: DesignKnowledgePublication = {
        schemaVersion: 1,
        key: prepared.key,
        edges,
        checkpoint: prepared.source.checkpoint,
        revision: snapshot.revision,
        warnings: prepared.source.warnings,
      }
      await writePublication(options.cache!, publication, signal)
      await options.persist?.(publication, signal)
      return { ...prepared.source, revision: snapshot.revision, semantic: 'disabled' as const }
    })
    options.report?.('disabled')
    return result
  }
  // Verify the stored candidate set as well as the input: deletion or replacement
  // requires repair even at the same file revision. Failures still dedupe by input.
  if (prepared.completed) {
    await mutate(async () => options.persist?.(await readDesignKnowledgePublication(options.cache), signal))
    options.indexer?.ready(projectId, prepared.key, prepared.edges, epoch)
    options.report?.('ready')
    return { ...prepared.source, semantic: 'ready' as const }
  }
  let revision = prepared.source.revision
  const operation = async (jobSignal?: AbortSignal) => {
    try {
      jobSignal?.throwIfAborted()
      options.report?.('semantic')
      // Inference is independent background work; user writes can proceed meanwhile.
      const result = await options.compute!(prepared.input, jobSignal)
      options.report?.('publication')
      const published = await mutate(async () => {
        jobSignal?.throwIfAborted()
        const checkpoint = await store.head(jobSignal)
        if (!checkpoint) throw new Error('Design checkpoint disappeared during indexing')
        if (!await sameCheckpoint(store, prepared.source.checkpoint, checkpoint, jobSignal)) throw new Error('Design checkpoint changed during semantic indexing')
        // Auxiliary record commits do not change the captured Design input.
        const settled = await publishKnowledgeSemantic({ service, projectId, input: prepared.input, edges: result.edges, currentCheckpoint: prepared.source.checkpoint, signal: jobSignal })
        revision = settled.revision
        const snapshot = await readCompleteDesignKnowledge(service, { projectId, limit: 100 }, jobSignal)
        const edges = edgeDigest(snapshot)
        let warning: string | undefined
        jobSignal?.throwIfAborted()
        let publication: DesignKnowledgePublication | undefined
        if (options.cache && options.identity) {
          publication = {
            schemaVersion: 1,
            key: prepared.key,
            edges,
            checkpoint: prepared.source.checkpoint,
            revision: snapshot.revision,
            warnings: prepared.source.warnings,
          }
          await writePublication(options.cache, publication, jobSignal)
        }
        await options.persist?.(publication, jobSignal)
        return { artifact: edges, warning }
      })
      options.report?.('ready')
      return published
    } catch (error) {
      options.report?.('error')
      throw error
    }
  }
  let warning: string | undefined
  const semantic = options.indexer ? await options.indexer.run(projectId, prepared.key, prepared.edges, operation, options.background, signal, epoch)
    : (warning = (await operation(signal)).warning, 'ready' as const)
  warning ??= options.indexer?.warning(projectId, prepared.key)
  if (warning) prepared.source.warnings.push(warning)
  return { ...prepared.source, revision, semantic }
}
