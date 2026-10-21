/** Shared interpretation of existing KAG records. Never creates relationships. */
import type { DesignKnowledgeRelation } from './design-knowledge.ts'
import { parsePinnedDesignRelation, resolveDesignRelation, type CompiledDesignRelationVocabulary, type DesignRelationClassification } from './design-relation-vocabulary.ts'

export interface KnowledgeRelationReading {
  relationType: string; meaning: string
  origin: 'file' | 'embedding' | 'agent' | 'human' | 'unknown'
  direction: 'forward' | 'symmetric' | 'unknown'; lifecycle: string
  classification: DesignRelationClassification
  vocabularyRevision: string
  kit?: string
  kitVersion?: string
}
export function knowledgeRelationReading(edge: Pick<DesignKnowledgeRelation, 'relationType' | 'provenance' | 'properties' | 'lifecycle'>,
  vocabulary?: CompiledDesignRelationVocabulary): KnowledgeRelationReading {
  const producer = edge.provenance.producer
  const origin = producer === 'design-file-projection' ? 'file'
    : producer === 'source-analysis' && edge.properties?.projection === 'embedding-v1' ? 'embedding'
      : ['grounding', 'reflection', 'alignment'].includes(producer) ? 'agent'
        : producer === 'human-decision' ? 'human' : 'unknown'
  const resolved = parsePinnedDesignRelation(edge.properties?.relationSemantics, edge.relationType)
    ?? resolveDesignRelation(edge.relationType, vocabulary)
  return { ...resolved, origin, lifecycle: edge.lifecycle }
}
