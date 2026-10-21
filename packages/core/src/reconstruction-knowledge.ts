/** Small evidence batches over the existing provider-neutral graph service. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import {
  DesignKnowledgeEntityId, DesignKnowledgeRelationId, DesignKnowledgeMutationId,
  type DesignKnowledgeService, type DesignKnowledgeEvidence,
} from './design-knowledge.ts'
import type { DesignProjectId } from './design-project.ts'
import { resolveDesignRelation, type CompiledDesignRelationVocabulary } from './design-relation-vocabulary.ts'

export interface ReconstructionEvidence { readonly path: string; readonly quote: string }
export interface ReconstructionEntity {
  readonly id: string
  readonly kind: string
  readonly summary: string
  readonly evidence: readonly ReconstructionEvidence[]
}
export interface ReconstructionRelation {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly kind: string
  readonly summary: string
  readonly evidence: readonly ReconstructionEvidence[]
}
export interface ReconstructionKnowledgeInput {
  readonly text?: string
  readonly entities?: readonly ReconstructionEntity[]
  readonly relations?: readonly ReconstructionRelation[]
}
const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

async function sourceFile(root: string, path: string): Promise<{ path: string; bytes: Buffer }> {
  const singleFile = (await stat(root)).isFile()
  const canonical = await realpath(singleFile && path === '.' ? root : resolve(singleFile ? dirname(root) : root, path))
  const local = relative(root, canonical)
  if (singleFile ? canonical !== root : local === '..' || local.startsWith('../') || isAbsolute(local)) throw new Error('Evidence must be inside the specified source directory or match the exact source file')
  const info = await stat(canonical)
  if (!info.isFile() || info.size > 2_000_000) throw new Error('Evidence must be a file of at most 2 MB')
  return { path: canonical, bytes: await readFile(canonical) }
}

/** Quotes prove bytes were present, not that an AI interpretation is correct. */
export async function reconstructionKnowledge(
  service: DesignKnowledgeService,
  projectId: DesignProjectId,
  checkpoint: string,
  root: string,
  input: ReconstructionKnowledgeInput,
  relationVocabulary?: CompiledDesignRelationVocabulary,
): Promise<unknown> {
  const prefix = `source:${digest(root).slice(0, 16)}:`
  const entities = input.entities ?? []
  const relations = input.relations ?? []
  if (entities.length + relations.length > 40) throw new Error('Use at most 40 graph records per batch')
  const evidence = async (items: readonly ReconstructionEvidence[]): Promise<readonly DesignKnowledgeEvidence[]> => {
    if (items.length === 0 || items.length > 4) throw new Error('Each graph record needs 1–4 source references')
    return Promise.all(items.map(async item => {
      if (item.quote.trim() === '' || item.quote.length > 1200) throw new Error('Provide a nonempty source quote of at most 1200 characters')
      const file = await sourceFile(root, item.path)
      if (!file.bytes.toString('utf8').includes(item.quote)) throw new Error(`Evidence quote does not match ${item.path}; reread the source`)
      return { source: file.path, revision: `sha256:${digest(file.bytes)}`, locator: item.quote }
    }))
  }
  const provenance = async (items: readonly ReconstructionEvidence[]) => ({
    producer: 'source-analysis' as const, checkpoint, evidence: await evidence(items),
  })
  const checkText = (item: { id: string; kind: string; summary: string }): void => {
    if (!item.id.trim() || !item.kind.trim() || !item.summary.trim() || item.summary.length > 2000) throw new Error('Graph id, kind and summary must be nonempty; keep summaries under 2000 characters')
  }
  const upsertEntities = await Promise.all(entities.map(async item => {
    checkText(item)
    return {
      id: DesignKnowledgeEntityId(prefix + item.id), entityType: item.kind, label: item.summary,
      lifecycle: 'proposed' as const, properties: { sourceRoot: root }, provenance: await provenance(item.evidence),
    }
  }))
  const upsertRelations = await Promise.all(relations.map(async item => {
    checkText(item)
    return {
      id: DesignKnowledgeRelationId(prefix + item.id), relationType: item.kind,
      from: DesignKnowledgeEntityId(prefix + item.from), to: DesignKnowledgeEntityId(prefix + item.to),
      lifecycle: 'proposed' as const, properties: {
        sourceRoot: root,
        summary: item.summary,
        relationSemantics: { ...resolveDesignRelation(item.kind, relationVocabulary) },
      }, provenance: await provenance(item.evidence),
    }
  }))
  if (upsertEntities.length + upsertRelations.length > 0) {
    const before = await service.query({
      projectId,
      entityIds: upsertEntities.map(item => item.id),
      relationIds: upsertRelations.map(item => item.id),
      limit: Math.max(1, upsertEntities.length + upsertRelations.length),
    })
    const stable = (value: unknown): string => JSON.stringify(value, (_key, entry) => (
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)))
        : entry
    ))
    const priorEntities = new Map(before.entities.map(item => [item.id, item]))
    const priorRelations = new Map(before.relations.map(item => [item.id, item]))
    const changedEntities = upsertEntities.filter(item => stable(priorEntities.get(item.id)) !== stable(item))
    const changedRelations = upsertRelations.filter(item => stable(priorRelations.get(item.id)) !== stable(item))
    if (changedEntities.length + changedRelations.length > 0) {
      await service.applyDelta({
        mutationId: DesignKnowledgeMutationId(`source-analysis:${randomUUID()}`),
        pin: { projectId, inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: before.revision },
        upsertEntities: changedEntities, upsertRelations: changedRelations, removeEntities: [], removeRelations: [],
      })
    }
  }
  const graph = await service.query({ projectId, limit: 50, ...(input.text?.trim() ? { text: input.text.trim() } : {}) })
  const freshness = new Map<string, Promise<boolean>>()
  const current = async (refs: readonly DesignKnowledgeEvidence[]): Promise<boolean> => (await Promise.all(refs.map(ref => {
    const key = ref.source + '\n' + ref.revision
    let value = freshness.get(key)
    if (value === undefined) {
      value = sourceFile(root, ref.source).then(file => `sha256:${digest(file.bytes)}` === ref.revision, () => false)
      freshness.set(key, value)
    }
    return value
  }))).every(Boolean)
  const decorate = async <T extends { provenance: { evidence: readonly DesignKnowledgeEvidence[] } }>(record: T) => ({ ...record, evidenceCurrent: await current(record.provenance.evidence) })
  return {
    revision: graph.revision,
    note: 'Bounded retrieval, not a completeness verdict. AI interpretations remain proposed. evidenceCurrent checks file bytes only; verify meaning against source. Tool inputs retain quotes in the native session log for rebuilding this optional graph.',
    entities: await Promise.all(graph.entities.filter(x => x.id.startsWith(prefix)).map(decorate)),
    relations: await Promise.all(graph.relations.filter(x => x.id.startsWith(prefix)).map(decorate)),
  }
}
