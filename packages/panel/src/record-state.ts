import type { EditorField, PanelManifest } from './dsl.ts'
import { browserRandomUuid } from './browser-uuid.ts'

/** Legacy-compatible label fallback. Explicit component bindings take precedence. */
export function recordLabel(record: Record<string, unknown>, fallback: string): string {
  for (const key of ['function_name', 'name', 'prompt', 'title']) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return fallback
}

/** Pure record transactions shared by all declarative components. No React,
 * Host services, component imports, or Bundle-specific branches belong here. */
/** Design Files projected by section: sectionId -> recordId -> record. */
export type DesignData = Record<string, Record<string, Record<string, unknown>>>

/**
 * One field edit emitted from an editable panel. Scalar fields carry a string
 * value; structured fields (e.g. bpmn_canvas `steps`, rows sub-tables) carry
 * the replacement value verbatim.
 */
export interface DesignEdit {
  section: string
  record: string
  field: string
  value: unknown
}

export function fieldsForSection(fields: readonly EditorField[], sectionId: string): readonly EditorField[] {
  return fields.filter((field) => (field.applies_to ?? []).includes(sectionId))
    .map(field => {
      if (field.required_in === undefined) return field
      const { required_in, ...scoped } = field
      return { ...scoped, required: required_in.includes(sectionId) }
    })
}

/** Segments that must never traverse or define (prototype-pollution guard). */
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

/** Core-aligned segment rule: non-empty, no surrounding whitespace, not unsafe. */
function isSafeSegment(segment: string): boolean {
  return segment !== '' && segment === segment.trim() && !UNSAFE_PATH_SEGMENTS.has(segment)
}

/**
 * Read a dotted path from a state record.
 * @param root - the state record to read.
 * @param path - dotted path (e.g. `add.enhancements.records`).
 * @returns the value, or undefined for unsafe segments/missing own keys.
 */
export function pathGet(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root
  for (const segment of path.split('.')) {
    if (!isSafeSegment(segment)) return undefined
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
    const record = current as Record<string, unknown>
    if (!Object.hasOwn(record, segment)) return undefined
    current = record[segment]
  }
  return current
}

/**
 * Immutably set a dotted path, creating intermediate records as needed.
 * @param root - the state record to update (never mutated).
 * @param path - dotted path to set.
 * @param value - the value to set.
 * @returns the next state record; unsafe paths throw.
 */
export function pathSet(root: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const segments = path.split('.')
  if (segments.some((segment) => !isSafeSegment(segment))) {
    throw new Error(`unsafe state path "${path}"`)
  }
  const setAt = (node: Record<string, unknown>, index: number): Record<string, unknown> => {
    const segment = segments[index] as string
    if (index === segments.length - 1) return { ...node, [segment]: value }
    const child = Object.hasOwn(node, segment) ? node[segment] : undefined
    const nextChild = child !== null && typeof child === 'object' && !Array.isArray(child)
      ? (child as Record<string, unknown>)
      : {}
    return { ...node, [segment]: setAt(nextChild, index + 1) }
  }
  return setAt(root, 0)
}

/** Resolved storage binding of a manifest section (dotted state paths). */
export interface SectionBinding {
  recordsPath: string
  fieldsPath: string | undefined
  orderPath: string | undefined
}

/**
 * Resolve a section's storage binding.
 * @param manifest - the panel manifest declaring the section.
 * @param sectionId - the section id to resolve.
 * @returns records/fields/order paths; absent declarations default to the
 * section id at the record root.
 */
export function sectionBindingOf(manifest: PanelManifest, sectionId: string): SectionBinding {
  const meta = manifest.sections.find((section) => section.id === sectionId)
  const nonEmpty = (value: string | undefined): string | undefined =>
    typeof value === 'string' && value !== '' ? value : undefined
  return {
    recordsPath: nonEmpty(meta?.records_path) ?? sectionId,
    fieldsPath: nonEmpty(meta?.fields_path),
    orderPath: nonEmpty(meta?.order),
  }
}

/**
 * Read a record map at a dotted path, tolerantly.
 * @param data - the render data.
 * @param path - dotted path of the record map.
 * @returns recordId -> record for well-formed members; malformed members
 * are skipped, missing paths resolve to an empty map.
 */
export function recordsAtPath(data: Record<string, unknown>, path: string): Record<string, Record<string, unknown>> {
  const value = pathGet(data, path)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  // Computed-spread build: a persisted id of `__proto__` defines an own key
  // instead of invoking the prototype setter.
  let out: Record<string, Record<string, unknown>> = {}
  for (const [id, record] of Object.entries(value as Record<string, unknown>)) {
    if (record !== null && typeof record === 'object' && !Array.isArray(record)) {
      out = { ...out, [id]: record as Record<string, unknown> }
    }
  }
  return out
}

/**
 * Generate an opaque record id: a platform UUID suffixed to a stable
 * section-derived prefix, collision-checked against the current map. Ids
 * are not deterministically re-derivable, so deleted ids are practically
 * never reused and stale cross-panel references cannot silently rebind.
 * @param prefix - stable section-derived prefix for readability.
 * @param records - the current record map.
 * @returns an id unique within the current map.
 */
export function freshRecordId(prefix: string, records: Record<string, Record<string, unknown>>): string {
  let id = `${prefix}-${browserRandomUuid()}`
  while (Object.hasOwn(records, id)) {
    id = `${prefix}-${browserRandomUuid()}`
  }
  return id
}

/** Record ids in durable order (declared order first, deduped, then remaining). */
export function orderedRecordIds(records: Record<string, Record<string, unknown>>, order: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  const requested: string[] = []
  for (const id of order ?? []) {
    if (typeof id !== 'string' || seen.has(id) || !Object.hasOwn(records, id)) continue
    seen.add(id)
    requested.push(id)
  }
  const rest = Object.keys(records).filter((id) => !seen.has(id))
  return [...requested, ...rest]
}

/**
 * Apply one field value to a values record; `undefined` clears the property
 * so optional fields omit on the JSON wire instead of carrying null.
 * @param values - the current field values.
 * @param key - the field key.
 * @param value - the new value, or undefined to clear.
 * @returns the next values record.
 */
function withFieldValue(values: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  if (value === undefined) {
    const next = { ...values }
    delete next[key]
    return next
  }
  return { ...values, [key]: value }
}

export function fieldIsVisible(field: EditorField, values: Record<string, unknown>): boolean {
  if (field.hidden) return false
  const gate = field.visible_when
  if (!gate) return true
  const conditions = 'all' in gate ? gate.all : [gate]
  return conditions.every(condition => {
    const value = values[condition.field]
    return Array.isArray(value) ? value.some(item => typeof item === 'string' && condition.in.includes(item)) : condition.in.includes(String(value ?? ''))
  })
}

/** Display-only; never rewrite the field binding or saved value. */
export function fieldDisplayLabel(field: EditorField, values: Record<string, unknown>): string {
  return field.label_when?.find(variant => {
    const value = values[variant.field]
    return Array.isArray(value) ? value.some(item => typeof item === 'string' && variant.in.includes(item))
      : variant.in.includes(String(value ?? ''))
  })?.label ?? field.label ?? field.key
}

/** Atomic, explicitly declared dependent edits; never normalize existing records on mount. */
export function applyRecordFieldEdit(manifest: PanelManifest, section: string, values: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  let next = withFieldValue(values, key, value)
  for (const field of fieldsForSection(manifest.fields ?? [], section)) {
    const gate = field.visible_when
    const dependencyEdited = gate && ('all' in gate ? gate.all.some(condition => condition.field === key) : gate.field === key)
    if (field.clear_when_hidden && dependencyEdited && !fieldIsVisible(field, next)) next = withFieldValue(next, field.key,
      field.clear_when_hidden === 'omit' ? undefined : field.control === 'list' ? [] : '')
  }
  const derived = manifest.sections.find(item => item.id === section)?.derived_fields ?? {}
  for (const [target, definition] of Object.entries(derived)) {
    if (!definition.parts.some(part => part.field === key)) continue
    next[target] = definition.parts.map(part => {
      const text = typeof next[part.field] === 'string' ? next[part.field] as string : ''
      return part.values ? (Object.hasOwn(part.values, text) ? part.values[text] : part.fallback ?? text) : text || part.fallback || ''
    }).join(definition.separator ?? '')
  }
  return next
}

/** The sub-record a section's fields edit (fields_path), or the record root. */
export function fieldValuesOf(record: Record<string, unknown>, fieldsPath: string | undefined): Record<string, unknown> {
  if (fieldsPath === undefined) return record
  const value = pathGet(record, fieldsPath)
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Apply one field edit through the owning section's storage binding (pure).
 * Default bindings write `draft[section][record][field]`; declared
 * records_path/fields_path route the value into nested storage.
 * @param draft - the current panel draft state.
 * @param manifest - the panel manifest owning the section binding.
 * @param edit - the field edit emitted by the interpreter.
 * @returns the next draft state (input is never mutated).
 */
export function applyDesignEditToDraft(draft: Record<string, unknown>, manifest: PanelManifest, edit: DesignEdit): Record<string, unknown> {
  const binding = sectionBindingOf(manifest, edit.section)
  const records = recordsAtPath(draft as unknown as DesignData, binding.recordsPath)
  const record = Object.hasOwn(records, edit.record) ? records[edit.record] : {}
  const values = fieldValuesOf(record, binding.fieldsPath)
  const nextValues = applyRecordFieldEdit(manifest, edit.section, values, edit.field, edit.value)
  // Without a fields_path, `values` is the whole record, so nextValues is
  // the complete next record (spreading `record` would resurrect cleared keys).
  const nextRecord = binding.fieldsPath !== undefined
    ? pathSet(record, binding.fieldsPath, nextValues)
    : nextValues
  return pathSet(draft, binding.recordsPath, { ...records, [edit.record]: nextRecord })
}

/**
 * Apply path-keyed panel updates (pure; dotted keys set immutably).
 * @param draft - the current panel draft state.
 * @param updates - update entries keyed by dotted state paths.
 * @returns the next draft state (input is never mutated).
 */
export function applyPanelUpdatesToDraft(draft: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  let next = draft
  for (const [key, value] of Object.entries(updates)) next = pathSet(next, key, value)
  return next
}

/** Plan one atomic deletion, restricted to explicitly declared ownership edges. */
export function recordDeletionUpdates(manifest: PanelManifest, data: DesignData, sectionId: string, id: string): { updates: Record<string, unknown>; children: number; relations: number } {
  const updates: Record<string, unknown> = {}
  let children = 0, relations = 0
  const remove = (section: string, ids: Set<string>) => {
    const binding = sectionBindingOf(manifest, section)
    const current = recordsAtPath(data, binding.recordsPath)
    updates[binding.recordsPath] = Object.fromEntries(Object.entries(current).filter(([key]) => !ids.has(key)))
    if (binding.orderPath) {
      const order = pathGet(data, binding.orderPath)
      updates[binding.orderPath] = orderedRecordIds(current, Array.isArray(order) ? order : undefined).filter(key => !ids.has(key))
    }
  }
  const owner = sectionBindingOf(manifest, sectionId)
  if (!Object.hasOwn(recordsAtPath(data, owner.recordsPath), id)) return { updates, children, relations }
  remove(sectionId, new Set([id]))
  for (const child of manifest.sections.find(section => section.id === sectionId)?.delete_children ?? []) {
    const binding = sectionBindingOf(manifest, child.section)
    const ids = Object.entries(recordsAtPath(data, binding.recordsPath)).filter(([, value]) => fieldValuesOf(value, binding.fieldsPath)[child.reference_field] === id).map(([key]) => key)
    children += ids.length
    if (ids.length) remove(child.section, new Set(ids))
  }
  for (const link of manifest.sections.find(section => section.id === sectionId)?.delete_relations ?? []) {
    const binding = sectionBindingOf(manifest, link.section)
    const ids = Object.entries(recordsAtPath(data, binding.recordsPath)).filter(([, value]) => {
      const fields = fieldValuesOf(value, binding.fieldsPath)
      return link.reference_fields.some(key => fields[key] === id)
    }).map(([key]) => key)
    relations += ids.length
    if (ids.length) remove(link.section, new Set(ids))
  }
  return { updates, children, relations }
}
