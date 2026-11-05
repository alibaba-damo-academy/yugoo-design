import { createElement, type ReactElement } from 'react'
import type { ReadField } from './dsl.ts'
import { panelText } from './panel-i18n.tsx'
import { PanelContentGroup, PanelDisclosureIcon } from './panel-workspace.tsx'

export function readableCount(count: number, kind: 'item' | 'field', locale?: string): string {
  return panelText(kind === 'item'
    ? (count === 1 ? 'itemCountOne' : 'itemCountMany')
    : (count === 1 ? 'fieldCountOne' : 'fieldCountMany'), locale, { count })
}

export function remainingItems(count: number, locale?: string, original = false): string {
  return panelText(original
    ? (count === 1 ? 'moreItemsOriginalOne' : 'moreItemsOriginalMany')
    : (count === 1 ? 'moreItemsOne' : 'moreItemsMany'), locale, { count })
}

/** A bounded reading projection. Neither declarations nor browsing alter saved facts. */
export function readableValue(value: unknown, depth = 0, locale?: string, presentation?: {
  fields?: readonly ReadField[]
  referenceLabel?: (section: string, id: string) => string | undefined
}): ReactElement {
  const named = presentation?.fields !== undefined
  const scalar = (item: unknown, section?: string): ReactElement => {
    const id = String(item)
    const label = section && typeof item === 'string' ? presentation?.referenceLabel?.(section, item) : undefined
    return createElement('span', { className: 'dsh-design-field-value' }, item === null ? '—'
      : label && label !== id ? `${label} (${id})` : id)
  }
  const render = (item: unknown, level: number, fields?: readonly ReadField[], itemLabel?: string,
    section?: string, omit?: string): ReactElement => {
    if (item === null || typeof item !== 'object') return scalar(item, section)
    if (level >= 8) return createElement('span', null, panelText('contentTooDeep', locale))
    const truncated = (count: number) => count > 100
      ? createElement('p', null, remainingItems(count - 100, locale, true)) : null
    if (named && Array.isArray(item)) {
      return createElement('div', { className: 'dsh-design-structured-list' },
        createElement('ul', { className: 'dsh-panel-reading-list' }, item.slice(0, 100).map((entry, index) => {
          const candidate = entry && typeof entry === 'object' && !Array.isArray(entry) && itemLabel
            && Object.hasOwn(entry, itemLabel) ? entry[itemLabel] : undefined
          const title = typeof candidate === 'string' && candidate.trim() || typeof candidate === 'number'
            ? String(candidate) : undefined
          return createElement('li', { key: index, className: entry !== null && typeof entry === 'object'
            ? 'dsh-panel-content-card dsh-design-structured-record' : 'dsh-panel-reading-item' },
            title ? createElement('h4', { className: 'dsh-design-form-group-title' }, title) : null,
            render(entry, level + 1, fields, undefined, section, title ? itemLabel : undefined))
        })), truncated(item.length))
    }
    const record = item as Record<string, unknown>
    const entries: readonly (readonly [string, unknown])[] = Array.isArray(item)
      ? item.map((entry, index) => [String(index + 1), entry] as const)
      : [
          ...(fields ?? []).filter(field => field.key !== omit && Object.hasOwn(record, field.key)).map(field => [field.key, record[field.key]] as const),
          ...Object.entries(record).filter(([key]) => key !== omit && !fields?.some(field => field.key === key)),
        ]
    return createElement('div', { className: 'dsh-design-structured-list' },
      entries.slice(0, 100).map(([key, entry]) => {
        const field = fields?.find(field => field.key === key)
        const label = field?.label ?? (named ? key : key.replace(/[_-]/gu, ' '))
        const nested = entry !== null && typeof entry === 'object'
        const body = render(entry, level + 1, field?.fields, field?.item_label_field, field?.options_from_section)
        // Declared content is directly readable unless explicitly folded. Unknown
        // nested content retains the existing expandable fallback, including keys.
        const folded = field?.collapsed ?? (!field && nested)
        // Named top-level reading sections use the same group/body composition
        // as forms. Nested fields stay ordinary fields; object depth does not
        // introduce another surface. A collection already owns its record cards.
        if (named && level === depth) return createElement(PanelContentGroup, {
          key, title: label, defaultOpen: !folded,
          preview: !field && nested ? createElement('small', { className: 'dsh-design-form-group-preview' },
            readableCount(Object.keys(entry).length, Array.isArray(entry) ? 'item' : 'field', locale)) : undefined,
        }, createElement('div', { className: 'dsh-design-form-group-content' },
          Array.isArray(entry) ? body : createElement('div', { className: 'dsh-panel-content-card' }, body)))
        return createElement('div', { className: 'dsh-design-structured-row', key },
          folded ? null : createElement('span', { className: 'dsh-design-field-label' }, label),
          folded ? createElement('details', { className: 'dsh-design-structured-branch' },
            createElement('summary', { className: 'dsh-panel-disclosure' },
              createElement('span', { className: 'dsh-panel-disclosure-label' }, label),
              !field && nested ? createElement('small', { className: 'dsh-design-form-group-preview' },
                readableCount(Object.keys(entry).length, Array.isArray(entry) ? 'item' : 'field', locale)) : null,
              createElement(PanelDisclosureIcon, { expanded: false })),
            createElement('div', { className: 'dsh-design-structured-branch-body' }, body)) : body)
      }), truncated(entries.length))
  }
  return render(value, depth, presentation?.fields)
}
