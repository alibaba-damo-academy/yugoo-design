import { createHash } from 'node:crypto'
import type { DesignGraph, DesignGraphEdge, DesignGraphNode } from './design-graph.ts'
import { resolveDesignRelation } from './design-relation-vocabulary.ts'

export interface SemanticUnit { id: string; nodeId?: string; file: string; pointer: string; fieldPointers?: string[]; text: string; digest: string }
export interface SemanticStatus { state: 'indexing' | 'ready' | 'error' | 'disabled'; completed: number; total: number; model: string; message?: string; cache?: 'persistent' | 'memory' }
export interface SemanticGraphRuntime {
  readonly identity?: string
  publicationCache?(projectId: string): import('./design-knowledge-refresh.ts').KnowledgeIndexCache | undefined
  read(projectId: string, graph: DesignGraph): Promise<{ edges: DesignGraphEdge[]; status: SemanticStatus }>
  compute?(projectId: string, graph: DesignGraph, signal?: AbortSignal): Promise<{ edges: DesignGraphEdge[]; status: SemanticStatus }>
}
export const SEMANTIC_TEXT_VERSION = 'design-content-tree-v5-context'
export const semanticDigest = (text: string) => createHash('sha256').update(text).digest('hex')

/** Shared by canonical and persisted indexing. Context is not field ownership. */
export function semanticNodeContext(node: DesignGraphNode, nodes: ReadonlyMap<string, DesignGraphNode>): string {
  const chain: DesignGraphNode[] = [], seen = new Set<string>()
  let current: DesignGraphNode | undefined = node
  while (current && !seen.has(current.id)) {
    seen.add(current.id); chain.unshift(current)
    current = nodes.get(current.parentId ?? (current.recordId !== current.id ? current.recordId ?? '' : ''))
  }
  return `${node.file}\n` + chain.map(n => `${n.pointer || '/'} — ${n.label}${n.sourceLabel && n.sourceLabel !== n.label ? ' — ' + n.sourceLabel : ''}`).join('\n')
}

/** Long records are indexed as bounded subfield chunks, never additional graph nodes. */
export function semanticRecordUnits(nodeId: string, file: string, pointer: string, label: string, fields: { pointer: string; text: string }[], options: { complete?: boolean } = {}): { units: SemanticUnit[]; truncated: boolean } {
  const chunks: { text: string; pointers: string[] }[] = []
  let text = '', pointers: string[] = []
  const flush = () => { if (text) chunks.push({ text, pointers }); text = ''; pointers = [] }
  let truncated = false
  outer: for (const field of fields) {
    const value = field.text.normalize('NFKC')
    for (let offset = 0; offset < value.length; offset += 1000) {
      const line = field.pointer + ': ' + value.slice(offset, offset + 1000) + '\n'
      if (text && text.length + line.length > 1500) flush()
      if (!options.complete && chunks.length >= 8) { truncated = true; break outer }
      text += line; if (!pointers.includes(field.pointer)) pointers.push(field.pointer)
    }
  }
  flush()
  return { truncated, units: chunks.map((chunk, i) => {
    const text = label + '\n' + chunk.text
    return { id: nodeId + ':chunk:' + i, nodeId, file, pointer, fieldPointers: chunk.pointers, text, digest: semanticDigest(SEMANTIC_TEXT_VERSION + '\n' + text) }
  }) }
}

export function normalizeVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 8 || value.length > 8192 || !value.every(x => typeof x === 'number' && Number.isFinite(x))) throw new Error('Invalid embedding vector')
  const norm = Math.hypot(...value)
  if (!Number.isFinite(norm) || norm < 1e-12) throw new Error('Empty embedding vector')
  return value.map(x => x / norm)
}

/** Mutual nearest RECORD neighbours; aggregate chunk matches into one edge per pair. */
export function semanticEdges(units: SemanticUnit[], vectors: number[][], model: string, checkpoint: string, threshold = .8, topK = 3): DesignGraphEdge[] {
  if (units.length !== vectors.length) throw new Error('Embedding count mismatch')
  const normalized = vectors.map(normalizeVector)
  if (new Set(normalized.map(v => v.length)).size > 1) throw new Error('Embedding dimensions differ')
  type Pair = { from: string; to: string; score: number; i: number; j: number }
  const pairs = new Map<string, Pair>()
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const from = units[i].nodeId ?? units[i].id, to = units[j].nodeId ?? units[j].id
    if (from === to || units[i].file === units[j].file) continue
    const score = normalized[i].reduce((sum, x, k) => sum + x * normalized[j][k], 0)
    if (score < threshold) continue
    const key = JSON.stringify([from, to].sort()), old = pairs.get(key)
    if (!old || score > old.score) pairs.set(key, { from, to, score, i, j })
  }
  const neighbors = new Map<string, Pair[]>()
  for (const pair of pairs.values()) for (const node of [pair.from, pair.to]) neighbors.set(node, [...(neighbors.get(node) ?? []), pair])
  for (const [node, list] of neighbors) neighbors.set(node, list.sort((a, b) => b.score - a.score || JSON.stringify([a.from, a.to]).localeCompare(JSON.stringify([b.from, b.to]))).slice(0, topK))
  return [...pairs.values()].filter(pair => neighbors.get(pair.from)?.includes(pair) && neighbors.get(pair.to)?.includes(pair)).map(pair => ({
    id: 'semantic:' + semanticDigest(model + JSON.stringify([pair.from, pair.to].sort())), from: pair.from, to: pair.to, kind: 'semantic',
    label: '语义相近（候选） ' + pair.score.toFixed(3),
    reading: {...resolveDesignRelation('semantic-similarity'),origin:'embedding',lifecycle:'proposed'},
    evidence: JSON.stringify({ model, checkpoint, similarity: pair.score, meaning: '子字段语义相近，不代表确定业务关系', sources: [units[pair.i], units[pair.j]].map(u => ({ file: u.file, pointer: u.pointer, fields: u.fieldPointers ?? [u.pointer], digest: u.digest })) }),
  }))
}
