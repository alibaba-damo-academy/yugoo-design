/** Revision-pinned, provider-neutral knowledge reads for advisory consumers. */
import type {
  DesignKnowledgeImpactRequest,
  DesignKnowledgeQuery,
  DesignKnowledgeQueryResult,
  DesignKnowledgeRevision,
  DesignKnowledgeService,
  DesignKnowledgeTraceRequest,
} from './design-knowledge.ts'
import { DesignProjectId } from './design-project.ts'
import { knowledgeRelationReading } from './design-knowledge-reading.ts'

/** Selected Design Project state against which one advisory will run. */
export interface AdvisoryKnowledgeSelection {
  readonly project: string
  readonly checkpoint: string
}

/** Provider-neutral graph reads available to advisory consumers. */
export type AdvisoryKnowledgeReadPort = Pick<DesignKnowledgeService, 'revision' | 'query' | 'trace' | 'impact'>

/** One stable bounded graph snapshot shared by all advisory review loops. */
export interface AdvisoryDesignKnowledge {
  readonly project: string
  /** Original publication pin; may differ from the equivalent review commit. */
  readonly sourceCheckpoint: string
  readonly checkpoint: string
  readonly knowledgeRevision: DesignKnowledgeRevision
  readonly graph: DesignKnowledgeQueryResult
  readonly documentRef: string
  readonly pins: readonly [
    { readonly source: string; readonly revision: string },
    { readonly source: string; readonly revision: string },
  ]
  readonly context: string
}

/**
 * Read one selected project's graph at a single provider revision without
 * granting the advisory mutation authority.
 * @param selection - selected project and its current committed checkpoint.
 * @param port - provider-neutral knowledge reader.
 * @param limit - maximum entities and relations returned by the bounded query.
 * @param query - optional filters applied at the captured revision.
 * @returns an immutable revision-pinned graph snapshot.
 */
export async function readAdvisoryDesignKnowledge(
  selection: AdvisoryKnowledgeSelection,
  port: AdvisoryKnowledgeReadPort,
  limit: number,
  query: Omit<DesignKnowledgeQuery, 'projectId' | 'revision' | 'limit'> = {},
  revision?: DesignKnowledgeRevision,
  sourceCheckpoint = selection.checkpoint,
): Promise<AdvisoryDesignKnowledge> {
  const projectId = DesignProjectId(selection.project)
  const knowledgeRevision = revision ?? await port.revision(projectId)
  const graph = await port.query({ offset: 0, ...query, projectId, revision: knowledgeRevision, limit })
  if (graph.revision !== knowledgeRevision) throw new Error('advisory knowledge: provider query did not preserve the pinned revision')
  const documentRef = `design-knowledge:${encodeURIComponent(selection.project)}@${knowledgeRevision}`
  const pins = Object.freeze([
    Object.freeze({ source: `design-project:${selection.project}`, revision: selection.checkpoint }),
    Object.freeze({ source: `design-knowledge:${selection.project}`, revision: knowledgeRevision }),
  ]) as AdvisoryDesignKnowledge['pins']
  const context = JSON.stringify({
    schemaVersion: 2,
    project: selection.project,
    checkpoint: selection.checkpoint,
    sourceCheckpoint,
    ...(sourceCheckpoint === selection.checkpoint ? {} : {
      sourceEquivalence: 'The original KAG publication and this review commit have the same verified Design evidence tree. Use this snapshot for read-only context; do not write Knowledge observations against the older source checkpoint.',
    }),
    knowledgeRevision,
    entities: graph.entities,
    relations: graph.relations.map(edge => ({ ...edge, reading: knowledgeRelationReading(edge) })),
    coverage: graph.page ?? { status: 'unknown', note: 'Bounded retrieval; absence does not prove a record or relationship is missing.' },
  })
  return Object.freeze({
    project: selection.project,
    sourceCheckpoint,
    checkpoint: selection.checkpoint,
    knowledgeRevision,
    graph,
    documentRef,
    pins,
    context,
  })
}

/** Trace one record using the revision already captured by an advisory snapshot. */
export function traceAdvisoryKnowledge(
  port: AdvisoryKnowledgeReadPort,
  knowledge: AdvisoryDesignKnowledge,
  request: Omit<DesignKnowledgeTraceRequest, 'projectId' | 'revision'>,
): ReturnType<AdvisoryKnowledgeReadPort['trace']> {
  return port.trace({ ...request, projectId: DesignProjectId(knowledge.project), revision: knowledge.knowledgeRevision } as DesignKnowledgeTraceRequest)
}

/** Compute impact using the revision already captured by an advisory snapshot. */
export function impactAdvisoryKnowledge(
  port: AdvisoryKnowledgeReadPort,
  knowledge: AdvisoryDesignKnowledge,
  request: Omit<DesignKnowledgeImpactRequest, 'projectId' | 'revision'>,
): ReturnType<AdvisoryKnowledgeReadPort['impact']> {
  return port.impact({ ...request, projectId: DesignProjectId(knowledge.project), revision: knowledge.knowledgeRevision })
}

/**
 * Compare two reads for the exact inputs that authorize advisory publication.
 * @param left - snapshot captured before analysis.
 * @param right - snapshot re-read after analysis.
 * @returns whether project, review/source checkpoints, and provider revision match.
 */
export function sameAdvisoryDesignKnowledge(
  left: Pick<AdvisoryDesignKnowledge, 'project' | 'checkpoint' | 'sourceCheckpoint' | 'knowledgeRevision'>,
  right: Pick<AdvisoryDesignKnowledge, 'project' | 'checkpoint' | 'sourceCheckpoint' | 'knowledgeRevision'>,
): boolean {
  return left.project === right.project
    && left.checkpoint === right.checkpoint
    && left.sourceCheckpoint === right.sourceCheckpoint
    && left.knowledgeRevision === right.knowledgeRevision
}
