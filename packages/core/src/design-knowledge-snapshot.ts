/** Complete revision-pinned reads shared by ingestion, indexing and review. */
import type { DesignKnowledgeService, DesignKnowledgeQuery, DesignKnowledgeEntity, DesignKnowledgeRelation } from './design-knowledge.ts'

export async function readCompleteDesignKnowledge(
  service: Pick<DesignKnowledgeService, 'revision' | 'query'>,
  request: Omit<DesignKnowledgeQuery, 'offset'>,
  signal?: AbortSignal,
) {
  const revision = request.revision ?? await service.revision(request.projectId)
  const { limit } = request
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Knowledge page size must be a positive integer')
  const entities: DesignKnowledgeEntity[] = [], relations: DesignKnowledgeRelation[] = []
  let totals: { totalEntities: number; totalRelations: number } | undefined
  let offset: number | null = 0
  let generation: string | undefined
  do {
    signal?.throwIfAborted()
    const result = await service.query({ ...request, revision, offset })
    if (offset === 0) generation = result.generation
    else if (generation !== result.generation) throw new Error('Knowledge generation changed during pagination')
    const page = result.page
    if (!page || result.revision !== revision || page.offset !== offset
      || !Number.isSafeInteger(page.totalEntities) || page.totalEntities < 0
      || !Number.isSafeInteger(page.totalRelations) || page.totalRelations < 0
      || (totals && (totals.totalEntities !== page.totalEntities || totals.totalRelations !== page.totalRelations))
      || result.entities.length !== Math.min(limit, Math.max(0, page.totalEntities - offset))
      || result.relations.length !== Math.min(limit, Math.max(0, page.totalRelations - offset))
      || page.nextOffset !== (offset + limit < Math.max(page.totalEntities, page.totalRelations) ? offset + limit : null)) {
      throw new Error('Knowledge provider cannot prove complete snapshot pagination')
    }
    totals = page
    entities.push(...result.entities); relations.push(...result.relations)
    offset = page.nextOffset
  } while (offset !== null)
  if (new Set(entities.map(node => node.id)).size !== entities.length
    || new Set(relations.map(edge => edge.id)).size !== relations.length) {
    throw new Error('Knowledge snapshot pagination contains duplicate identities')
  }
  signal?.throwIfAborted()
  return { revision, entities, relations, ...(generation ? { generation } : {}) }
}
