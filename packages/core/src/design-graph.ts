/** Read-only record projection. Files are facts; no approval layer or Bundle-name dispatch. */
import { createHash } from 'node:crypto'
import { isIndependentDesignSource } from './design-knowledge-source-policy.ts'
import { appendDesignSourceReferenceEdges } from './design-source-projection.ts'
import type { DesignFilesStore } from './design-files.ts'
import type { DesignKnowledgeQueryResult } from './design-knowledge.ts'
import type { SchemaSpec } from './schema.ts'
import { knowledgeRelationReading, type KnowledgeRelationReading } from './design-knowledge-reading.ts'
import { semanticRecordUnits, semanticNodeContext, type SemanticUnit, type SemanticStatus } from './design-semantic.ts'
import { isRecord, topLevelRecords, recordLabel, sourceRecordLabel, contentLeaves, nestedContent, knowledgeContent, schemaAtPointer } from './design-graph-content.ts'
import { designOntologySchemaPointers, resolveDesignOntologyType,
  type CompiledDesignOntologyContract, type DesignIdentityQuality, type DesignKnowledgeRecordKind } from './design-ontology.ts'

export interface DesignGraphNode { id: string; label: string; sourceLabel?: string; file: string; pointer: string; context: string; owner: string; record: boolean; recordId?: string; parentId?: string; contentKind?: 'container' | 'unit'; fields?: { pointer: string; text: string }[]; source?: { digest: string; byteLength: number; encoding: 'utf8' | 'binary' }
  recordKind?: DesignKnowledgeRecordKind; ontologyType?: string; identityQuality?: DesignIdentityQuality; schemaPointer?: string; ontologyRevision?: string }
export interface DesignGraphEdge { id: string; from: string; to: string; kind: 'contains' | 'identifier-match' | 'knowledge' | 'semantic'; label: string; evidence: string; reading?: KnowledgeRelationReading; relationType?: 'references' }
export interface DesignGraph { checkpoint: string; generation?: string; nodes: DesignGraphNode[]; edges: DesignGraphEdge[]; warnings: string[]; semanticUnits?: SemanticUnit[]; semantic?: SemanticStatus }
/** Exact diagnostic identity shared with the later checkpoint-artifact resolution. */
export const unresolvedDesignReferenceWarning = (file: string, pointer: string): string =>
  file + '#' + pointer + ': 引用目标未在当前投影中解析，原文已保留。'
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const canonical = (v: unknown): string => JSON.stringify(v, (_key, value) => isRecord(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
/** Storage projection shares record identity with the view, never its display budgets. */
export interface DesignGraphProjectionOptions { readonly purpose?: 'view' | 'storage'; readonly ontology?: CompiledDesignOntologyContract }

/** Maps retain keyed identity. Arrays retain explicit IDs or content identity, not position. */
export function projectDesignGraph(files: Record<string, unknown>, checkpoint: string, schemas: Record<string, SchemaSpec> = {}, options: DesignGraphProjectionOptions = {}): DesignGraph {
  files = Object.fromEntries(Object.entries(files).filter(([file]) => isIndependentDesignSource(file, schemas)))
  schemas = Object.fromEntries(Object.entries(schemas).filter(([file]) => isIndependentDesignSource(file, schemas)))
  const storage = options.purpose === 'storage'
  const graph: DesignGraph = { checkpoint, nodes: [], edges: [], warnings: [], semanticUnits: [] }
  let contextBudget = storage ? Infinity : 1_000_000
  let recordCount = 0
  let childCount = 0
  const warn = (s: string) => { if (graph.warnings.length < 40 && !graph.warnings.includes(s)) graph.warnings.push(s) }
  const identifiers = new Map<string, Set<string>>()
  const remember = (key: string, id: string) => { if (key) identifiers.set(key, new Set([...(identifiers.get(key) ?? []), id])) }
  const projected: Record<string, unknown> = {}
  // Declared targets have structural identity even when their display text matches
  // an ancestor (or contains only settings). Collect before visiting any file.
  const referenceCollections = new Map<string, Set<string>>()
  let unscopedReference = false
  for (const [file, schema] of Object.entries(schemas)) {
    const pending = [schema], seen = new Set<SchemaSpec>()
    while (pending.length) {
      const spec = pending.pop()!
      if (seen.has(spec)) continue
      seen.add(spec)
      pending.push(...Object.values(spec.properties ?? {}), ...[spec.value, spec.items].filter((s): s is SchemaSpec => !!s))
      const semantics = spec.knowledge
      if (semantics?.role !== 'reference') continue
      if (!semantics.target) { unscopedReference = true; continue }
      const target = semantics.target.startsWith('#') ? file + semantics.target : semantics.target
      const separator = target.indexOf('#'), targetFile = target.slice(0, separator), pointer = target.slice(separator + 1)
      if (!referenceCollections.has(targetFile)) referenceCollections.set(targetFile, new Set())
      referenceCollections.get(targetFile)!.add(pointer)
    }
  }
  if (unscopedReference) for (const file of Object.keys(files)) {
    if (!referenceCollections.has(file)) referenceCollections.set(file, new Set())
  }
  if (unscopedReference) for (const [file, root] of Object.entries(files)) {
    const pending: { value: unknown; spec: SchemaSpec | undefined; depth: number }[] = [{ value: root, spec: schemas[file], depth: 0 }]
    const seen = new Set<object>()
    let visited = 0
    while (pending.length) {
      const { value, spec, depth } = pending.pop()!
      if (!storage && (++visited > 20000 || depth > 32)) break
      if (spec?.knowledge?.role === 'metadata') continue
      if (spec?.knowledge?.role === 'reference' && !spec.knowledge.target && typeof value === 'string') {
        for (const targetFile of Object.keys(files)) {
          referenceCollections.get(targetFile)!.add('@id:' + value)
          const prefix = targetFile.split('/')[0] + ':'
          if (value.startsWith(prefix)) referenceCollections.get(targetFile)!.add('@id:' + value.slice(prefix.length))
        }
      }
      if (!value || typeof value !== 'object' || seen.has(value)) continue
      seen.add(value)
      if (isRecord(value) && (value.deleted === true || value.rejected === true)) continue
      for (const [key, child] of Object.entries(value)) pending.push({ value: child, spec: Array.isArray(value) ? spec?.items : spec?.properties?.[key] ?? spec?.value, depth: depth + 1 })
    }
  }
  for (const [file, root] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (storage && !isRecord(root)) throw new Error(`Knowledge canonical state must be an object: ${file}`)
    const pending: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }]
    const visited = new WeakSet<object>()
    let inspected = 0, valid = true
    while (pending.length) {
      const item = pending.pop()!
      if (!storage && (++inspected > 20000 || item.depth > 32)) { valid = false; break }
      if (item.value && typeof item.value === 'object') {
        if (storage && visited.has(item.value)) throw new Error(`Knowledge input must be a JSON tree: ${file}`)
        visited.add(item.value)
        const children = Object.values(item.value)
        if (!storage && children.length + pending.length > 20000) { valid = false; break }
        for (const value of children) pending.push({ value, depth: item.depth + 1 })
      }
    }
    if (!valid) {
      if (storage) throw new Error(`Incomplete Knowledge projection: ${file} exceeds traversal safety bounds`)
      warn(file + ': 内容过深或过宽，未展开。'); continue
    }
    if (!schemas[file]) warn(file + ': 无可用 schema，保留对象/集合内容但不推断引用；请核对粒度。')
    const content = knowledgeContent(root, schemas[file])
    projected[file] = content
    const schemaPointers = schemas[file] ? designOntologySchemaPointers(schemas[file]) : new Map()
    const records = topLevelRecords(content, schemas[file], storage)
    const identities = records.map(r => r.array ? r.pointer.slice(0, r.pointer.lastIndexOf('/')) + '/' + (isRecord(r.value) && typeof r.value.id === 'string' ? 'id:' + r.value.id : 'value:' + hash(canonical(r.value))) : r.pointer)
    const counts = new Map<string, number>()
    for (const identity of identities) counts.set(identity, (counts.get(identity) ?? 0) + 1)
    for (let i = 0; i < records.length; i++) {
      if (!storage && recordCount >= 300) { warn('设计记录达到300上限，当前为部分图谱。'); break }
      const record = records[i], identity = identities[i]
      if (counts.get(identity)! > 1) {
        if (storage) throw new Error(`Ambiguous Knowledge record identity: ${file}#${identity}`)
        warn(file + ': 重复记录身份未展开，避免错误匹配。'); continue
      }
      const targetRecord = referenceCollections.get(file)?.has(record.pointer.slice(0, record.pointer.lastIndexOf('/')))
        || referenceCollections.get(file)?.has('@id:' + record.key)
        || (isRecord(record.value) && typeof record.value.id === 'string' && referenceCollections.get(file)?.has('@id:' + record.value.id))
      const label = recordLabel(record) || (storage || targetRecord ? record.key || record.pointer || file : '')
      if (!label) { warn(file + '#' + record.pointer + ': 无可读记录名称，未将编号或元数据单独建点。'); continue }
      const id = 'record:' + hash(file + ':' + identity)
      const fields = contentLeaves(record.value, record.pointer)
      const context = fields.map(f => f.pointer + ': ' + f.text).join('\n').slice(0, storage ? Infinity : Math.min(contextBudget, 12000))
      contextBudget -= context.length
      if (!contextBudget) warn('原文展示达到总预算；请从所示文件路径查看完整原文。')
      const recordKind: Exclude<DesignKnowledgeRecordKind, 'design-artifact'> = record.schema?.knowledge?.role === 'content'
        && record.schema.knowledge.granularity !== 'property' ? 'design-content' : 'design-record'
      const schemaPointer = record.schema ? schemaPointers.get(record.schema) : undefined
      const identityQuality: DesignIdentityQuality = record.member
        ? record.array && (!isRecord(record.value) || typeof record.value.id !== 'string') ? 'anonymous' : 'stable'
        : 'structural'
      const policy = record.schema?.knowledge
      graph.nodes.push({ id, recordId: id, label, file, pointer: record.pointer, owner: file.split('/')[0], context, record: true, fields,
        recordKind, ontologyType: resolveDesignOntologyType(options.ontology, file, schemaPointer, recordKind), identityQuality,
        ...(schemaPointer !== undefined ? { schemaPointer } : {}), ...(options.ontology ? { ontologyRevision: options.ontology.revision } : {}),
        ...(policy?.role === 'content' && policy.granularity !== 'property' ? { contentKind: policy.granularity, sourceLabel: sourceRecordLabel(record) } : {}) }); recordCount++
      const children = nestedContent(record, referenceCollections.get(file)), added = new Set<string>([''])
      for (const child of children) {
        if (!storage && childCount >= 1200) { warn('子内容节点达到1200上限，当前为部分展开。'); break }
        if (!added.has(child.parent)) continue
        const childId = 'content:' + hash(id + child.identity), parentId = child.parent ? 'content:' + hash(id + child.parent) : id
        const text = child.fields.map(f => f.pointer + ': ' + f.text).join('\n').slice(0, storage ? Infinity : Math.min(contextBudget, 12000))
        contextBudget -= text.length
        graph.nodes.push({ id: childId, recordId: id, parentId, label: child.label, file, pointer: child.pointer, owner: file.split('/')[0], context: text, record: false, fields: child.fields,
          recordKind: 'design-content', ontologyType: resolveDesignOntologyType(options.ontology, file,
            child.schema ? schemaPointers.get(child.schema) : undefined, 'design-content'), identityQuality: child.identityQuality,
          ...(child.schema && schemaPointers.get(child.schema) !== undefined ? { schemaPointer: schemaPointers.get(child.schema) } : {}),
          ...(options.ontology ? { ontologyRevision: options.ontology.revision } : {}),
          ...(child.contentKind ? { contentKind: child.contentKind } : {}), ...(child.sourceLabel ? { sourceLabel: child.sourceLabel } : {}) })
        childCount++
        graph.edges.push({ id: 'contains:' + childId, from: parentId, to: childId, kind: 'contains', label: '包含内容', evidence: file + '#' + child.pointer })
        added.add(child.identity)
      }
    }
  }
  const valueAt = (file: string, pointer: string): unknown => pointer.split('/').slice(1).reduce<any>((v, k) => v?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], projected[file])
  // Only collection members define identifiers, not arbitrary aggregate field names.
  for (const node of graph.nodes) {
    if (!node.pointer) continue
    const parent = node.pointer.slice(0, node.pointer.lastIndexOf('/'))
    const container = valueAt(node.file, parent), value = valueAt(node.file, node.pointer)
    const spec = schemaAtPointer(schemas[node.file], parent)
    const collection = spec ? ['map', 'array'].includes(spec.type ?? '')
      : Array.isArray(container) || (isRecord(container) && Object.values(container).every(isRecord))
    if (!collection || !isRecord(value)) continue
    const keys = [!Array.isArray(container) ? node.pointer.slice(node.pointer.lastIndexOf('/') + 1).replaceAll('~1', '/').replaceAll('~0', '~') : '', typeof value.id === 'string' ? value.id : '']
    for (const key of keys) if (key) { remember(key, node.id); remember(node.owner + ':' + key, node.id) }
  }
  const isReference = (file: string, pointer: string) => schemaAtPointer(schemas[file], pointer)?.knowledge?.role === 'reference'
  // Declared reference leaves stay on their owner as evidence, not separate prose nodes.
  const references = new Set(graph.nodes.filter(n => !n.record && n.fields?.length === 1 && n.pointer === n.fields[0].pointer && isReference(n.file, n.pointer)).map(n => n.id))
  graph.nodes = graph.nodes.filter(n => !references.has(n.id))
  graph.edges = graph.edges.filter(e => !references.has(e.from) && !references.has(e.to))
  // Each leaf belongs to its most specific content node; ancestors don't duplicate it.
  const fieldOwners = new Map<string, DesignGraphNode>()
  for (const node of [...graph.nodes].sort((a, b) => a.pointer.length - b.pointer.length)) for (const field of node.fields ?? []) fieldOwners.set(node.file + '#' + field.pointer, node)
  const chunks: SemanticUnit[][] = []
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  for (const node of graph.nodes) {
    const own = (node.fields ?? []).filter(f => fieldOwners.get(node.file + '#' + f.pointer)?.id === node.id)
    if (!own.length) continue
    const contextLabel = semanticNodeContext(node, byId)
    // Embedding is a downstream indexing task; its per-call budget cannot truncate storage.
    if (storage) continue
    const extracted = semanticRecordUnits(node.id, node.file, node.pointer, contextLabel, own)
    if (extracted.truncated) warn(node.file + '#' + node.pointer + ': 内容单元达到分块预算，当前为部分覆盖。')
    chunks.push(extracted.units)
  }
  // Give every content node its first chunk before admitting later chunks of long nodes.
  for (let round = 0; round < 8; round++) for (const units of chunks) if (units[round]) {
    if (graph.semanticUnits!.length < 300) graph.semanticUnits!.push(units[round])
    else warn('语义内容分块达到300上限，当前为部分覆盖。')
  }
  // Equality alone is not reference semantics. Require a declared reference field;
  // a target collection disambiguates repeated IDs without inventing a business relation.
  const pairs = new Map<string, { from: string; to: string; sources: string[] }>()
  for (const node of graph.nodes) for (const field of node.fields ?? []) {
    if (fieldOwners.get(node.file + '#' + field.pointer)?.id !== node.id) continue
    const semantics = schemaAtPointer(schemas[node.file], field.pointer)?.knowledge
    if (semantics?.role !== 'reference' || typeof valueAt(node.file, field.pointer) !== 'string') continue
    const target = semantics.target?.startsWith('#') ? node.file + semantics.target : semantics.target
    if (!field.text.trim()) continue
    const matches = [...(identifiers.get(field.text) ?? [])].filter(id => {
      const candidate = byId.get(id)
      return candidate && (!target || candidate.file + '#' + candidate.pointer.slice(0, candidate.pointer.lastIndexOf('/')) === target)
    })
    if (matches.length !== 1) {
      warn(matches.length ? node.file + '#' + field.pointer + ': 引用存在多个候选，未连边。'
        : unresolvedDesignReferenceWarning(node.file, field.pointer))
      continue
    }
    const to = matches[0]
    if (to === node.id || to === node.recordId) continue
    const key = node.id + ':' + to, previous = pairs.get(key)
    if (previous) previous.sources.push(node.file + '#' + field.pointer)
    else pairs.set(key, { from: node.id, to, sources: [node.file + '#' + field.pointer] })
  }
  for (const [id, pair] of pairs) graph.edges.push({ id: 'match:' + id, from: pair.from, to: pair.to, kind: 'identifier-match', label: '标识符匹配（非业务确认）', evidence: JSON.stringify(pair.sources) })
  for (const edge of graph.edges) edge.reading = knowledgeRelationReading({ relationType: edge.kind, lifecycle: edge.kind === 'contains' ? 'observed' : 'proposed',
    properties: {}, provenance: { producer:'design-file-projection',checkpoint,evidence:[] } })
  return graph
}

/** Exact field evidence resolves to its owning record; removed/option fields cannot resolve. */
export function attachKnowledgeGraph(graph: DesignGraph, knowledge: DesignKnowledgeQueryResult): void {
  const specific = [...graph.nodes].sort((a, b) => b.pointer.length - a.pointer.length)
  const locate = (e: { source: string; revision: string; locator?: string }) => e.revision === graph.checkpoint
    ? specific.find(n => n.file === e.source && (n.pointer === e.locator || n.fields?.some(f => f.pointer === e.locator))) : undefined
  const located = new Map<string, string>()
  for (const entity of knowledge.entities) {
    if (entity.provenance.checkpoint !== graph.checkpoint || !entity.provenance.evidence.length || !entity.provenance.evidence.every(locate)) continue
    const node = locate(entity.provenance.evidence[0])
    if (node) located.set(entity.id, node.id)
  }
  for (const relation of knowledge.relations) {
    const from = located.get(relation.from), to = located.get(relation.to)
    if (!from || !to || from === to || relation.provenance.checkpoint !== graph.checkpoint || !relation.provenance.evidence.length || !relation.provenance.evidence.every(locate)) continue
    graph.edges.push({ id: 'knowledge:' + relation.id, from, to, kind: 'knowledge', label: relation.relationType + ' (' + relation.lifecycle + ')', evidence: JSON.stringify(relation.provenance.evidence), reading: knowledgeRelationReading(relation) })
  }
}

export async function readDesignGraph(store: DesignFilesStore, checkpoint: string, signal?: AbortSignal, schemas: Record<string, SchemaSpec> = {}, options: DesignGraphProjectionOptions = {}): Promise<DesignGraph> {
  const storage = options.purpose === 'storage'
  const files: Record<string, unknown> = {}, warnings: string[] = []
  const paths = (await store.listPathsAt(checkpoint, signal)).map(p => p.replace(/^design_files\//u, '')).filter(p => { const parts = p.split('/'); return parts.length === 2 && !parts[0].startsWith('_') && parts[1] === parts[0] + '.json' }).sort()
  let bytes = 0
  for (const path of paths) {
    signal?.throwIfAborted()
    if (!isIndependentDesignSource(path, schemas)) continue
    const text = await store.readTextAt(checkpoint, path, signal)
    if (!text) {
      if (storage) throw new Error(`Incomplete Knowledge projection: missing ${path} at ${checkpoint}`)
      continue
    }
    bytes += Buffer.byteLength(text)
    if (!storage && bytes > 4_000_000) { warnings.push('设计内容超过读取预算，部分文件未展开。'); break }
    try { files[path] = JSON.parse(text) } catch {
      if (storage) throw new Error(`Incomplete Knowledge projection: invalid JSON in ${path}`)
      warnings.push(path + ': JSON 无法解析。')
    }
  }
  signal?.throwIfAborted()
  const graph = projectDesignGraph(files, checkpoint, schemas, options)
  await appendDesignSourceReferenceEdges(graph, files, schemas, (revision, file) => store.readTextAt(revision, file, signal), signal)
  graph.warnings.push(...warnings, '概览聚合到设计记录，展开呈现有意义子内容；标识符匹配和语义相近不代表确定的业务关系。')
  return graph
}
