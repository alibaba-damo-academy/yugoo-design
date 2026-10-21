import type { EditorField, PanelSection, RowColumn } from './panel-dsl.ts'

/** Shape guard: a manifest section entry carrying a non-empty string id. */
export function isPanelSection(value: unknown): value is PanelSection {
  return value !== null && typeof value === 'object'
    && typeof (value as PanelSection).id === 'string' && (value as PanelSection).id !== ''
}

/** Shape guard: a manifest field entry carrying a non-empty string key. */
export function isEditorField(value: unknown): value is EditorField {
  return value !== null && typeof value === 'object'
    && typeof (value as EditorField).key === 'string' && (value as EditorField).key !== ''
}

/** Shape guard: a rows column entry carrying a non-empty string key. */
export function isRowColumn(value: unknown): value is RowColumn {
  return value !== null && typeof value === 'object'
    && typeof (value as RowColumn).key === 'string' && (value as RowColumn).key !== ''
}

/**
 * Runtime string-list check. A bare `Array.isArray` narrowing of a declared
 * readonly array intersects it with `any[]` under this compiler, so callback
 * parameters would lose their types; this predicate keeps them.
 */
export function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function isUnsafePanelKey(value: string): boolean { return UNSAFE_PATH_SEGMENTS.has(value) }

export function isSafeDottedPath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value !== value.trim()) return false
  return value.split('.').every((segment) => segment !== '' && segment === segment.trim() && !isUnsafePanelKey(segment))
}

export function validateScalarDefaults(value: unknown, path: string, allowLists = true): string[] {
  const errors: string[] = []
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${path} must be a scalar map`); return errors }
    for (const [key, item] of Object.entries(value)) {
      if (!isSafeDottedPath(key) || key.includes('.') || (!['string', 'number', 'boolean'].includes(typeof item) && !(allowLists && isStringList(item)))
        || (typeof item === 'number' && !Number.isFinite(item))) errors.push(`${path}: invalid scalar default ${key}`)
    }
  return errors
}
