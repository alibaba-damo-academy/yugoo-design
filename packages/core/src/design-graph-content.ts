/** Record boundaries come from existing schemas, never Bundle names. */
import type { SchemaSpec } from './schema.ts'
import { createHash } from 'node:crypto'
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
export const pointerKey = (s: string) => s.replaceAll('~', '~0').replaceAll('/', '~1')
export interface ContentRecord { value: unknown; pointer: string; key: string; schema?: SchemaSpec; array: boolean; member?: boolean }
const childSchema = (spec: SchemaSpec | undefined, key: string) => spec?.properties?.[key] ?? spec?.value

/** Unknown fields remain content. Only the owning contract can declare metadata. */
export function knowledgeContent(value: unknown, schema?: SchemaSpec): unknown {
  if (schema?.knowledge?.role === 'metadata') return undefined
  if (Array.isArray(value)) return value.map(v => knowledgeContent(v, schema?.items) ?? null)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const content = knowledgeContent(child, childSchema(schema, key))
    return content === undefined ? [] : [[key, content]]
  }))
}
export function schemaAtPointer(schema: SchemaSpec | undefined, pointer: string): SchemaSpec | undefined {
  for (const key of pointer ? pointer.slice(1).split('/').map(k => k.replaceAll('~1', '/').replaceAll('~0', '~')) : []) {
    schema = schema?.type === 'array' ? schema.items : childSchema(schema, key)
  }
  return schema
}

/** The existing question-list contract is the sole content-selection exception. */
export function questionRecord(value: Record<string, unknown>): boolean {
  return typeof value.prompt === 'string' && ('answer' in value || 'choices' in value)
}
export function questionContent(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const raw = typeof value.answer === 'string' ? value.answer.trim() : ''
  const detail = typeof value.detail === 'string' ? value.detail.trim() : ''
  const attachments = Array.isArray(value.multimodal_answer) ? value.multimodal_answer : []
  // Supplements alone are not an answered question. Never promote them to an answer.
  if (!raw) return
  const choices = Array.isArray(value.choices) ? value.choices.filter(isRecord) : []
  const answer = raw && choices.length ? raw.split(',').map(s => {
    const selected = choices.find(c => c.value === s.trim())
    return selected && typeof selected.label === 'string' ? selected.label : s.trim()
  }).join('；') : raw
  return { prompt: value.prompt, ...(answer ? { answer } : {}), ...(detail ? { detail } : {}), ...(attachments.length ? { multimodal_answer: attachments } : {}) }
}

/** No business field-name whitelist. Prefer required prose, then existing scalar prose. */
export function recordLabel(record: ContentRecord): string {
  const value = record.value
  const policy = record.schema?.knowledge
  if (policy?.role === 'content' && policy.label) return (policy.label + (record.key && record.member && policy.granularity === 'unit' ? ` · ${record.key}` : '')).slice(0, 100)
  if (!isRecord(value)) return contentLeaves(value, record.pointer)[0]?.text.slice(0, 100) ?? ''
  if (questionRecord(value)) return String(questionContent(value)?.answer || value.prompt).slice(0, 100)
  const candidates = Object.entries(value).filter(([key, v]) => typeof v === 'string' && v.trim() && v !== record.key && key !== 'id' && childSchema(record.schema, key)?.type !== 'enum')
  const prose = (v: string) => !/^[\w.:/\\-]+$/u.test(v) && !/^\s*[<#]/u.test(v)
  const required = candidates.filter(([key]) => record.schema?.required?.includes(key))
  const choose = (items: typeof candidates) => items.find(([, v]) => prose(String(v))) ?? items.find(([, v]) => !/[\d_/:\\]|^[A-Z]+-/u.test(String(v)))
  const chosen = choose(required) ?? choose(candidates)
  if (chosen) return String(chosen[1]).trim().slice(0, 100)
  // A valid aggregate may have no direct name. Its nested content must survive.
  // Prefer prose from that content; otherwise show an actual setting, not an ID node.
  const nested = contentLeaves(value, record.pointer).filter(f => {
    const key = f.pointer.slice(f.pointer.lastIndexOf('/') + 1)
    return key !== 'id' && f.text !== record.key
  })
  const readable = nested.find(f => prose(f.text))
  if (readable) return readable.text.slice(0, 100)
  const setting = nested.find(f => !/^[A-Z]+[-_]?[0-9]+$/u.test(f.text))
  return setting ? (setting.pointer.slice(record.pointer.length + 1) + '：' + setting.text).slice(0, 100) : ''
}

/** Source caption is distinct from a contract's grouping label. */
export function sourceRecordLabel(record: ContentRecord): string {
  return recordLabel({ ...record, schema: record.schema ? { ...record.schema, knowledge: undefined } : undefined })
}

/** Arrays/maps of records expand once; nested content belongs to that record. */
export function topLevelRecords(root: unknown, schema?: SchemaSpec, complete = false): ContentRecord[] {
  if (!isRecord(root)) return []
  const result: ContentRecord[] = []
  const add = (value: unknown, pointer: string, key: string, spec?: SchemaSpec, array = false, member = false) => {
    const explicit = spec?.knowledge?.role === 'content' && spec.knowledge.granularity !== 'property'
    if ((!isRecord(value) && !explicit) || !contentLeaves(value, pointer).length) return
    if (isRecord(value) && (value.deleted === true || value.rejected === true || (questionRecord(value) && !questionContent(value)))) return
    result.push({ value, pointer, key, schema: spec, array, member })
  }
  // The same declaration has the same meaning at root, top level and nested.
  if (schema?.knowledge?.role === 'content') { add(root, '', '', schema); return result }
  const collections = Object.entries(root).filter(([key, value]) => {
    const spec = schema?.properties?.[key]
    if (spec?.knowledge?.role === 'content') return false
    if (spec) return (spec.type === 'map' && spec.value?.type === 'object') || (spec.type === 'array' && spec.items?.type === 'object')
    return Array.isArray(value) ? value.some(isRecord) : isRecord(value) && Object.values(value).length > 0 && Object.values(value).every(isRecord)
  })
  for (const [key, value] of collections) {
    const spec = schema?.properties?.[key], pointer = '/' + pointerKey(key)
    if (Array.isArray(value)) value.forEach((v, i) => add(v, pointer + '/' + i, '', spec?.items, true, true))
    else if (isRecord(value)) for (const [id, v] of Object.entries(value)) add(v, pointer + '/' + pointerKey(id), id, spec?.value, false, true)
  }
  for (const [key, value] of Object.entries(root)) {
    if (collections.some(([k]) => k === key)) continue
    const spec = schema?.properties?.[key]
    if (spec?.knowledge?.role === 'content') {
      if (spec.knowledge.granularity !== 'property') add(value, '/' + pointerKey(key), key, spec)
    } else if (isRecord(value) && (!schema || spec?.type === 'object')) add(value, '/' + pointerKey(key), key, spec)
  }
  if (!result.length && !collections.length) add(root, '', '', schema)
  // Rendering may emphasize named collections. Storage must also retain saved
  // root settings/scalar arrays alongside those collections, without duplicating
  // records or resurrecting unanswered/deleted records from excluded collections.
  if (complete && !result.some(record => record.pointer === '')) {
    const remaining = Object.fromEntries(Object.entries(root).filter(([key]) =>
      !collections.some(([collection]) => collection === key)
      && !result.some(record => record.pointer === '/' + pointerKey(key))))
    if (contentLeaves(remaining, '').length) add(remaining, '', '', schema)
  }
  return result
}

/** Keep subfield provenance. Question supplements stay separate from the answer. */
export function contentLeaves(value: unknown, pointer: string, out: { pointer: string; text: string }[] = []): typeof out {
  if (isRecord(value)) {
    if (value.deleted === true || value.rejected === true) return out
    const content = questionRecord(value) ? questionContent(value) : value
    if (content) for (const [key, child] of Object.entries(content)) contentLeaves(child, pointer + '/' + pointerKey(key), out)
  } else if (Array.isArray(value)) value.forEach((child, i) => contentLeaves(child, pointer + '/' + i, out))
  else if (value !== null && value !== undefined && String(value).trim()) out.push({ pointer, text: String(value) })
  return out
}

/** Content nodes, not JSON plumbing. Labels come from source text, never business-name dispatch. */
export interface NestedContent {
  identity: string; parent: string; pointer: string; label: string
  sourceLabel?: string; contentKind?: 'container' | 'unit'; fields: { pointer: string; text: string }[]
  schema?: SchemaSpec
  identityQuality: 'stable' | 'structural' | 'anonymous'
}
export function nestedContent(record: ContentRecord, referenceCollections: ReadonlySet<string> = new Set()): NestedContent[] {
  const result: NestedContent[] = []
  const textContent = (value: unknown, spec?: SchemaSpec): value is string => typeof value === 'string' && spec?.type !== 'enum'
    && /[\p{L}]/u.test(value)
    && !/^\s*(?:[<#]|https?:\/\/|file:|\/)/u.test(value)
    && !/^[\w./\\:-]*[_/\\.][\w./\\:-]*$/u.test(value)
    && !/^[A-Za-z]+-?\d+$/u.test(value)
  const canonical = (value: unknown) => JSON.stringify(value, (_key, v) => isRecord(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
  const visit = (value: unknown, pointer: string, identity: string, parent: string, parentLabel: string, spec?: SchemaSpec, properties = false, memberKey = '', member = false) => {
    const policy = spec?.knowledge?.role === 'content' ? spec.knowledge : undefined
    const explicitNode = policy?.granularity === 'unit' || policy?.granularity === 'container'
    const suppress = !explicitNode && (properties || policy?.granularity === 'property')
    const childProperties = policy?.granularity === 'unit' || policy?.granularity === 'property' || (properties && policy?.granularity !== 'container')
    if (Array.isArray(value)) {
      if (identity && explicitNode && contentLeaves(value, pointer).length) {
        const label = policy.label ?? pointer.slice(pointer.lastIndexOf('/') + 1)
        result.push({ identity, parent, pointer, label, contentKind: policy.granularity as 'container' | 'unit', fields: contentLeaves(value, pointer),
          schema: spec, identityQuality: member ? (memberKey ? 'stable' : 'anonymous') : 'structural' })
        parent = identity; parentLabel = label
      }
      const keys = value.map(v => isRecord(v) && typeof v.id === 'string' ? 'id:' + v.id : 'value:' + createHash('sha256').update(canonical(v)).digest('hex'))
      const counts = new Map<string, number>(); for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
      value.forEach((v, i) => { if (counts.get(keys[i]) === 1) visit(v, pointer + '/' + i, identity + '/' + keys[i], parent, parentLabel, spec?.items, childProperties, isRecord(v) && typeof v.id === 'string' ? v.id : '', true) })
      return
    }
    if (isRecord(value)) {
      if (value.deleted === true || value.rejected === true) return
      const question = questionRecord(value), content = question ? questionContent(value) : value
      if (!content) return
      const direct = Object.entries(content).filter(([key, v]) => key !== 'id' && (!question || key !== 'prompt') && textContent(v, childSchema(spec, key)))
      let owner = parent, label = parentLabel
      const referenced = referenceCollections.has(pointer.slice(0, pointer.lastIndexOf('/'))) || (member && (referenceCollections.has('@id:' + memberKey)
        || (typeof content.id === 'string' && referenceCollections.has('@id:' + content.id))))
      if (identity && ((!suppress && (direct.length || explicitNode)) || referenced) && contentLeaves(content, pointer).length) {
        label = recordLabel({ value: content, pointer, key: memberKey, schema: spec, array: false, member }) || (referenced ? pointer.slice(pointer.lastIndexOf('/') + 1) : '')
        if (label && (label !== parentLabel || referenced || explicitNode)) {
          result.push({ identity, parent, pointer, label, ...(explicitNode ? { contentKind: policy.granularity as 'container' | 'unit', sourceLabel: sourceRecordLabel({ value: content, pointer, key: memberKey, schema: spec, array: false }) } : {}), fields: contentLeaves(content, pointer),
            schema: spec, identityQuality: member ? (memberKey ? 'stable' : 'anonymous') : 'structural' }); owner = identity
        }
      }
      for (const [key, v] of Object.entries(content)) {
        if (key === 'id' || (question && key === 'prompt')) continue
        const collection = spec ? spec.type === 'map' : Object.values(content).length > 0 && Object.values(content).every(isRecord)
        visit(v, pointer + '/' + pointerKey(key), identity + '/' + pointerKey(key), owner, label, childSchema(spec, key), childProperties, collection ? key : '', collection)
      }
    } else if (identity && ((explicitNode && contentLeaves(value, pointer).length) || (!suppress && textContent(value, spec) && value.trim().slice(0, 100) !== parentLabel && value !== record.key))) {
      result.push({ identity, parent, pointer, label: policy?.label ?? String(value).trim().slice(0, 100), ...(explicitNode ? { contentKind: 'unit' as const } : {}), fields: [{ pointer, text: String(value) }],
        schema: spec, identityQuality: member ? (memberKey ? 'stable' : 'anonymous') : 'structural' })
    }
  }
  visit(record.value, record.pointer, '', '', recordLabel(record), record.schema)
  return result
}
