/** Exact file references extend the stored graph; filenames never imply semantics. */
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { DesignFilesStore } from './design-files.ts'
import { unresolvedDesignReferenceWarning, type DesignGraph } from './design-graph.ts'
import { schemaAtPointer } from './design-graph-content.ts'
import type { CompiledDesignOntologyContract } from './design-ontology.ts'
import { resolveDesignRelation } from './design-relation-vocabulary.ts'
import type { SchemaSpec } from './schema.ts'
import { isIndependentDesignSource } from './design-knowledge-source-policy.ts'

export async function appendReferencedKnowledgeArtifacts(store: DesignFilesStore, graph: DesignGraph, signal?: AbortSignal,
  ontology?: CompiledDesignOntologyContract, schemas: Record<string, SchemaSpec> = {}) {
  const paths = new Set((await store.listPathsAt(graph.checkpoint, signal)).map(p => p.replace(/^design_files\//u, ''))
    .filter(p => !p.startsWith('_') && !p.split('/').some(part => part === '..') && isIndependentDesignSource(p, schemas)))
  // Empty canonical files may produce no nodes; never reclassify them as artifacts.
  const canonical = new Set([...paths].filter(path => {
    const parts = path.split('/')
    return parts.length === 2 && parts[1] === parts[0] + '.json'
  }))
  const references = new Map<string, { nodeId: string; locator: string; file: string }[]>()
  const fieldOwners = new Map<string, string>()
  for (const node of [...graph.nodes].sort((a,b) => a.pointer.length - b.pointer.length)) {
    for (const field of node.fields ?? []) fieldOwners.set(JSON.stringify([node.file, field.pointer]), node.id)
  }
  for (const node of graph.nodes) for (const field of node.fields ?? []) {
    if (fieldOwners.get(JSON.stringify([node.file, field.pointer])) !== node.id) continue
    const text = field.text.trim()
    const candidates = [...new Set([posix.normalize(text.replace(/^design_files\//u, '')), posix.normalize(posix.join(posix.dirname(node.file), text))])]
      .filter(path => paths.has(path) && !canonical.has(path))
    // An ambiguous relative path is not permission to choose an arbitrary asset.
    if (candidates.length !== 1) continue
    const path = candidates[0]
    references.set(path, [...(references.get(path) ?? []), { nodeId: node.id, locator: field.pointer, file: node.file }])
  }
  for (const [path, refs] of [...references].sort(([a],[b]) => a.localeCompare(b))) {
    signal?.throwIfAborted()
    const bytes = await store.readBytesAt(graph.checkpoint, path, signal)
    if (!bytes) throw new Error(`Incomplete Knowledge projection: missing artifact ${path}`)
    const digest = createHash('sha256').update(bytes).digest('hex')
    let text: string | undefined
    try { const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (!decoded.includes('\0')) text = decoded } catch { /* Binary content is hashed, never fabricated as text. */ }
    const id = 'artifact:' + createHash('sha256').update(path).digest('hex')
    graph.nodes.push({ id, recordId: id, label: posix.basename(path), file: path, pointer: '', owner: path.split('/')[0], record: true,
      recordKind: 'design-artifact', ontologyType: 'design/artifact#file', identityQuality: 'stable',
      ...(ontology ? { ontologyRevision: ontology.revision } : {}),
      context: '', fields: text === undefined ? [] : [{ pointer: '', text }], source: { digest, byteLength: bytes.byteLength, encoding: text === undefined ? 'binary' : 'utf8' } })
    for (const ref of refs) {
      graph.edges.push({ id: 'artifact-ref:' + createHash('sha256').update(JSON.stringify([ref.nodeId, ref.locator, path])).digest('hex'),
        from: ref.nodeId, to: id, kind: 'knowledge', label: '引用产物', reading: {...resolveDesignRelation('references-artifact'),origin:'file',lifecycle:'observed'}, evidence: JSON.stringify({ source: ref.file, locator: ref.locator, target: path, digest }) })
      // Only a uniquely resolved, readable independent file can settle this field's
      // missing target. Explicit collection targets and ambiguous IDs remain errors.
      const semantics = schemaAtPointer(schemas[ref.file], ref.locator)?.knowledge
      if (semantics?.role === 'reference' && !semantics.target) {
        const resolved = unresolvedDesignReferenceWarning(ref.file, ref.locator)
        graph.warnings = graph.warnings.filter(warning => warning !== resolved)
      }
    }
  }
}
