/** Explicit, versioned source locations; no Bundle-name or causal inference. */
import { createHash } from 'node:crypto'
import { isIndependentDesignSource } from './design-knowledge-source-policy.ts'
import type { SchemaSpec } from './schema.ts'
import type { DesignGraph } from './design-graph.ts'
import { isRecord, pointerKey } from './design-graph-content.ts'
import { readDesignSourceReference, validateDesignSourceReferenceSubject, type DesignSourceReference } from './design-source-reference.ts'
import { knowledgeRelationReading } from './design-knowledge-reading.ts'

export async function appendDesignSourceReferenceEdges(graph: DesignGraph, files: Record<string, unknown>, schemas: Record<string, SchemaSpec>,
  read: (revision: string, file: string) => Promise<string | undefined>, signal?: AbortSignal): Promise<void> {
  const specific = [...graph.nodes].sort((a,b) => b.pointer.length-a.pointer.length)
  const reads = new Map<string, Promise<string | undefined>>()
  const cachedRead = (revision: string, file: string) => {
    const key = JSON.stringify([revision,file])
    if (!reads.has(key)) reads.set(key,read(revision,file))
    return reads.get(key)!
  }
  // Only actual projected content can be an endpoint. Metadata/choices cannot
  // acquire a relation merely because a nearby ancestor is visible.
  const endpoint = (file: string, pointer: string) => specific.find(node => node.file === file && (node.pointer === pointer
    || node.fields?.some(field => field.pointer === pointer)))
  const warn = (file: string, pointer: string, reason: string) => {
    const message = `${file}#${pointer}: 来源引用${reason}；保留原文，不推断当前关系。`
    if (!graph.warnings.includes(message)) graph.warnings.push(message)
  }
  const visit = async (file: string, value: unknown, spec: SchemaSpec | undefined, pointer: string, owner: unknown, ownerPointer: string): Promise<void> => {
    signal?.throwIfAborted()
    if (spec?.knowledge?.source_reference === true) {
      if (!isRecord(value)) { warn(file,pointer,'格式无效'); return }
      for (const [key, raw] of Object.entries(value)) {
        const locator = `${pointer}/${pointerKey(key)}`
        try {
          if (!isRecord(raw)) throw new Error('Invalid locator')
          const reference = raw as unknown as DesignSourceReference
          validateDesignSourceReferenceSubject(reference,owner)
          const resolved = await readDesignSourceReference(reference,graph.checkpoint,cachedRead,signal)
          if (resolved.current !== 'matching' && resolved.current !== 'changed') { warn(file,locator,'仅有历史依据或暂不可解析'); continue }
          const from = endpoint(file,ownerPointer + (reference.subject_pointer ?? ''))
          const to = endpoint(reference.file,reference.pointer ?? '')
          if (!from || !to) { warn(file,locator,'端点未在当前内容中解析'); continue }
          if (from.id === to.id) continue
          const id = 'source-ref:' + createHash('sha256').update(JSON.stringify([file,locator,from.id,to.id])).digest('hex')
          graph.edges.push({ id,from:from.id,to:to.id,kind:'identifier-match',relationType:'references',label:'来源引用（非确认）',
            evidence:JSON.stringify({source:file,locator,reference,current:resolved.current}),
            reading:knowledgeRelationReading({relationType:'references',lifecycle:'observed',properties:{},provenance:{producer:'design-file-projection',checkpoint:graph.checkpoint,evidence:[]}}) })
        } catch { signal?.throwIfAborted(); warn(file,locator,'格式无效或不可读取') }
      }
      return
    }
    if (spec?.knowledge?.role === 'metadata' || !value || typeof value !== 'object') return
    if (isRecord(value) && (value.rejected === true || value.deleted === true)) return
    for (const [key,child] of Object.entries(value)) {
      const childSpec = Array.isArray(value) ? spec?.items : spec?.properties?.[key] ?? spec?.value
      await visit(file,child,childSpec,`${pointer}/${pointerKey(key)}`,value,pointer)
    }
  }
  for (const [file,value] of Object.entries(files)) if (isIndependentDesignSource(file, schemas)) await visit(file,value,schemas[file],'',undefined,'')
}
