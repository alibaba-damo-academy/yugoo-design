/**
 * Design-panel interpreter: renders a validated PanelManifest plus Design Files
 * data as a React element tree. Phase 3 is read-only presentation; Phase 4 adds
 * the edit handlers that round-trip changes back to Design Files. Kept free of
 * dsh client plumbing so it is independently renderable and testable (SSR).
 */
import { Fragment, cloneElement, createElement, useId, useState, type ReactElement, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import type { ComponentKind, ComponentNode, EditorField, FieldOption, FormField, FormRow, FormGroup, FormTabs, PanelManifest, RowColumn } from './dsl.ts'
import { useRecordSelection, RecordWorkspace, RecordInspector, RecordPreview, RecordRelatedEditor, RelationGraph, ReferenceGraph, RecordMatrix, RecordArtifact, WorkspaceTextBlock } from './visual-components.tsx'
import { DataTable } from './data-table.tsx'
import { MathDocument } from './math-document.tsx'
import { CustomChoice } from './custom-choice.tsx'
import { NavigationWorkspace } from './navigation-workspace.tsx'
import { CompactRecordDetails } from './compact-record-details.tsx'
import { RecordMap } from './record-map.tsx'
import { BoardCard, RecordBoard } from './record-board.tsx'
import { boardDetailScope } from './board-detail-scope.ts'
import { SourceReferences } from './source-reference.tsx'
import { DocumentWorkspace } from './document-workspace.tsx'
import { ExecutionLog } from './execution-log.tsx'
import { ArtifactWorkspace } from './artifact-workspace.tsx'
import { DiagramWorkspace } from './diagram-workspace.tsx'
import { CanvasWorkspace } from './canvas-workspace.tsx'
import { PreviewWorkspace } from './preview-workspace.tsx'
import { ColorControl } from './color-control.tsx'
import { TokenList } from './token-list.tsx'
import { ComponentTabs } from './component-tabs.tsx'
import { referenceMatches } from './reference-graph.ts'
import { PanelSelect } from './panel-select.tsx'
import { PanelLocaleContext, panelText } from './panel-i18n.tsx'
import { localizePanelManifest } from './dsl.ts'
import { WORKSPACE_COMPONENT_KINDS, declarativePanelOwnsWorkspace } from './dsl.ts'
import { StandardQuestionList, StandardQuestionWorkspace, type StandardQuestionItem, type StandardQuestionWorkspaceProps } from './question-list.tsx'
import { PanelWorkspace, PanelDisclosureIcon, PanelEditableTitle, PanelRecordHeader, PanelWorkspaceGuidance } from './panel-workspace.tsx'
import {
  DECLARATIVE_PANEL_ARTIFACTS_KEY,
  prepareDeclarativeQuestionAttachment,
  previewFromArtifact,
  type PendingDeclarativeArtifact,
  type StandardQuestionAttachment,
} from './question-attachments.tsx'
import type { BinaryArtifactRead } from './client/panels/shared.ts'

import {
  pathGet, pathSet, sectionBindingOf, recordsAtPath, freshRecordId, orderedRecordIds,
  fieldIsVisible, fieldDisplayLabel, applyRecordFieldEdit, fieldValuesOf, recordDeletionUpdates, fieldsForSection, recordLabel,
  type DesignData, type DesignEdit,
} from './record-state.ts'
export {
  pathGet, pathSet, sectionBindingOf, recordsAtPath, freshRecordId, orderedRecordIds,
  fieldIsVisible, applyRecordFieldEdit, fieldValuesOf, applyDesignEditToDraft, applyPanelUpdatesToDraft,
  recordDeletionUpdates, fieldsForSection, recordLabel, type DesignData, type DesignEdit, type SectionBinding,
} from './record-state.ts'

/** Rendering options: editable mode reports field changes through onEdit. */
export interface RenderOptions {
  /** Interpreter-owned unprojected draft for atomic bound collection edits.
   * Display aliases can filter malformed records; never use them as write input.
   */
  canonicalData?: DesignData
  /** Explicit user requests only; unavailable to generated/artifact content. */
  sendPrompt?: (text: string) => void | Promise<void>
  running?: boolean
  compactFields?: boolean
  /** Host-owned save/continue transaction; artifact content cannot invoke it. */
  onSaveAndContinue?: () => void
  locale?: string
  /** Changes only on a save echo or external state replacement, not local typing. */
  collapseToken?: unknown
  /** Generated auto Panels only persist answer/detail, not attachments. */
  allowAttachments?: boolean
  readArtifact?: (path: string, revision?: string) => Promise<{ found: boolean; content: string }>
  sourceRevision?: string
  artifactActivities?: import('./client/panels/shared.ts').SkillPanelProps['artifactActivities']
  executionAttempts?: import('./client/panels/shared.ts').SkillPanelProps['executionAttempts']
  readExecutionLog?: import('./client/panels/shared.ts').SkillPanelProps['readExecutionLog']
  registerBeforeSave?: import('./client/panels/shared.ts').SkillPanelProps['registerBeforeSave']
  onStageArtifact?: (edit: import('./text-artifact-edit.ts').PendingTextArtifact) => void
  selectPanel?: (skill: string) => void
  artifactFiles?: Readonly<Record<string, string>>
  editable?: boolean
  onEdit?: (edit: DesignEdit) => void
  /** Trusted record form composes sibling field updates atomically. */
  onRecordPatch?: (patch: Record<string, unknown>) => void
  /**
   * Cross-panel option source: resolves another skill panel's section records
   * (panel_type, section_id -> recordId -> record). Absent or unknown refs
   * resolve to no options; references never copy data into this panel.
   */
  panelData?: (panelType: string, sectionId: string) => Record<string, Record<string, unknown>>
  /**
   * Panel-level updates (residue envelope: add/add_order). Emitted by
   * rowview_workbench / doc_lifecycle_studio; the host merges the partial
   * into the draft state.
   */
  onPanelUpdate?: (updates: Record<string, unknown>) => void
  /** Atomically compose field edits and panel transport updates on one draft. */
  onTransaction?: (edits: readonly DesignEdit[], updates: Record<string, unknown>) => void
  /** Merge asynchronous uploads against the current draft, not render-time captures. */
  onAppendAttachments?: (section: string, record: string, additions: readonly { ref: StandardQuestionAttachment; pending: PendingDeclarativeArtifact }[]) => void
  /** Owning Bundle id, used only to create Bundle-relative attachment paths. */
  skill?: string
  readBinaryArtifact?: (path: string) => Promise<BinaryArtifactRead>
  pendingArtifacts?: readonly PendingDeclarativeArtifact[]
}

/** Dedupe resolved options by value; earlier sources win (static, same-panel, cross-panel). */
function dedupeOptions(options: readonly FieldOption[]): readonly FieldOption[] {
  const seen = new Set<string>()
  const out: FieldOption[] = []
  for (const option of options) {
    if (seen.has(option.value)) continue
    seen.add(option.value)
    out.push(option)
  }
  return out
}

/** Resolve a choice control's options against the current record and data. */
function resolveFieldOptions(
  field: EditorField,
  record: Record<string, unknown>,
  data: DesignData,
  options?: RenderOptions,
): readonly FieldOption[] {
  const resolved: FieldOption[] = []
  for (const option of field.options ?? []) {
    const gate = option.when
    if (gate !== undefined && !gate.in.includes(String(record[gate.field] ?? ''))) continue
    resolved.push(option)
  }
  if (field.options_from_section !== undefined) {
    const records = data[field.options_from_section] ?? {}
    for (const [id, target] of Object.entries(records)) resolved.push({ value: id, label: recordLabel(target, id) })
  }
  if (field.options_from_sections) {
    for (const section of field.options_from_sections) for (const [id, target] of Object.entries(data[section] ?? {})) {
      if (referenceMatches(field.options_from_sections, id, section => data[section] ?? {}).length === 1)
        resolved.push({ value: id, label: recordLabel(target, id) })
    }
  }
  const panelRef = field.options_from_panel
  if (panelRef !== undefined && options?.panelData !== undefined) {
    const records = options.panelData(panelRef.panel_type, panelRef.section_id)
    for (const [id, target] of Object.entries(records)) resolved.push({ value: id, label: recordLabel(target, id) })
  }
  return dedupeOptions(resolved)
}

function referenceWarning(field: EditorField, value: string, data: DesignData, options?: RenderOptions): string {
  if (field.options_from_panel !== undefined && options?.panelData === undefined) return panelText('unloadedReference', options?.locale, { value })
  const ambiguous = field.options_from_sections && referenceMatches(field.options_from_sections, value, section => data[section] ?? {}).length > 1
  return panelText(ambiguous ? 'ambiguousReference' : 'staleReference', options?.locale, { value })
}

/** Single-value choice controls share the themed, accessible Panel selector. */
function renderSingleChoice(
  field: EditorField,
  record: Record<string, unknown>,
  data: DesignData,
  sectionId: string,
  recordId: string,
  options?: RenderOptions,
): ReactElement {
  const value = record[field.key]
  const text = value === undefined || value === null ? '' : String(value)
  const resolved = resolveFieldOptions(field, record, data, options)
  if (options?.editable !== true) {
    const label = resolved.find((option) => option.value === text)?.label
    return createElement('span', { className: 'dsh-design-field-value' }, label ?? (field.options_from_sections && text ? referenceWarning(field, text, data, options) : text))
  }
  // A stored value absent from the resolved options (e.g. the referenced
  // record was deleted in the source panel) stays visible as a disabled
  // stale-reference option instead of silently blanking.
  const stale = text !== '' && resolved.every((option) => option.value !== text)
  return createElement(
    PanelSelect,
    {
      className: 'dsh-design-field-input',
      'aria-label': field.label ?? field.key,
      'aria-required': field.required || undefined,
      value: text,
      options: [
        ...(field.allow_clear !== false || text === '' ? [{ value: '', label: '', disabled: field.allow_clear === false }] : []),
        ...resolved,
        ...(stale ? [{ value: text, label: referenceWarning(field, text, data, options), disabled: true }] : []),
      ],
      onValueChange: (value: string) => {
        if (field.allow_clear === false && value === '') return
        const next = value === '' ? undefined : value
        options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: next })
      },
    },
  )
}

/** Multi-value choice controls (multi_select/record_multi_select) share checkboxes. */
function renderMultiChoice(
  field: EditorField,
  record: Record<string, unknown>,
  data: DesignData,
  sectionId: string,
  recordId: string,
  options?: RenderOptions,
): ReactElement {
  const raw = record[field.key]
  // Round-trips as a string array; a comma-separated string value is an
  // accepted input contract on read (split and trimmed into the array).
  const selected = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : typeof raw === 'string' && raw !== ''
      ? raw.split(',').map((part) => part.trim())
      : []
  const resolved = resolveFieldOptions(field, record, data, options)
  if (options?.editable !== true) {
    const labels = selected.map((value) => resolved.find((option) => option.value === value)?.label ?? (field.options_from_sections ? referenceWarning(field, value, data, options) : value))
    return createElement('span', { className: 'dsh-design-field-value' }, labels.join(', '))
  }
  const staleSelected = selected.filter((value) => resolved.every((option) => option.value !== value))
  return createElement(
    'div',
    { className: `dsh-design-field-choices${field.choice_layout ? ` is-${field.choice_layout}` : ''}`, role: 'group',
      'aria-label': field.required ? panelText('requiredFieldName', options?.locale, { item: field.label ?? field.key }) : field.label ?? field.key },
    resolved.map((option) => createElement(
      'label',
      { className: 'dsh-design-field-choice', key: option.value },
      createElement('input', {
        type: 'checkbox',
        value: option.value,
        checked: selected.includes(option.value),
        onChange: (event: { target: { checked: boolean } }) => {
          const next = event.target.checked
            ? [...selected, option.value]
            : selected.filter((part) => part !== option.value)
          options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: next })
        },
      }),
      option.label,
    )),
    staleSelected.map((value) => createElement(
      'span',
      { className: 'dsh-design-field-choice-stale', key: value },
      referenceWarning(field, value, data, options),
    )),
  )
}

/**
 * Raw row values of a `rows` control. The array is kept verbatim: edits map
 * over it by index, so non-conforming members are preserved (rendered as
 * marker rows) rather than silently deleted by the next valid edit.
 */
function rawRows(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

/** A well-formed row is a plain object; anything else renders as preserved-invalid. */
function isRowObject(row: unknown): row is Record<string, unknown> {
  return row !== null && typeof row === 'object' && !Array.isArray(row)
}

/** Stable identity for surviving row objects across re-renders and deletes. */
const rowIdentities = new WeakMap<object, string>()
let rowIdentitySeq = 0

/**
 * Stable row key: object identity through a module-level WeakMap (a deleted
 * middle row never re-keys the rows after it); positional for scalar members.
 */
function rowKey(row: unknown, index: number): string {
  if (row !== null && typeof row === 'object') {
    let key = rowIdentities.get(row)
    if (key === undefined) {
      rowIdentitySeq += 1
      key = `row-${rowIdentitySeq}`
      rowIdentities.set(row, key)
    }
    return key
  }
  return `pos-${index}`
}

/** Resolve a `ref` column's options from this panel's sections or a cross-panel ref. */
function resolveRefColumnOptions(
  column: RowColumn,
  data: DesignData,
  options?: RenderOptions,
): readonly FieldOption[] {
  const resolved: FieldOption[] = []
  for (const sectionId of column.ref_sections ?? []) {
    const records = data[sectionId] ?? {}
    for (const [id, target] of Object.entries(records)) resolved.push({ value: id, label: recordLabel(target, id) })
  }
  const panelRef = column.options_from_panel
  if (panelRef !== undefined && options?.panelData !== undefined) {
    const records = options.panelData(panelRef.panel_type, panelRef.section_id)
    for (const [id, target] of Object.entries(records)) resolved.push({ value: id, label: recordLabel(target, id) })
  }
  return dedupeOptions(resolved)
}

const DEFAULT_MAX_ROWS = 50

/** Typed sub-table: field value = array of row objects edited cell-by-cell. */
function renderRowsControl(
  field: EditorField,
  record: Record<string, unknown>,
  data: DesignData,
  sectionId: string,
  recordId: string,
  options?: RenderOptions,
): ReactElement {
  const rows = rawRows(record, field.key)
  const columns = field.columns ?? []
  const maxRows = field.max_rows ?? DEFAULT_MAX_ROWS
  if (field.readonly) options = { ...options, editable: false }
  const editable = options?.editable === true
  // A non-conforming member disables the whole field's editing (clear
  // diagnostic, raw value preserved) instead of risking silent data loss.
  const hasInvalidRow = rows.some((row) => !isRowObject(row))
  const rowsEditable = editable && !hasInvalidRow
  const emit = (next: readonly unknown[]): void => {
    options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: next })
  }
  const renderCell = (row: Record<string, unknown>, rowIndex: number, column: RowColumn): ReactElement => {
    const cellValue = row[column.key]
    const cellText = cellValue === undefined || cellValue === null ? '' : String(cellValue)
    const accessibility = { 'aria-label': `${column.label} ${rowIndex + 1}`, ...(column.required ? { 'aria-required': true } : {}) }
    const replaceCell = (value: string): void => {
      emit(rows.map((item, index) => {
        if (index !== rowIndex) return item
        const next = { ...row, [column.key]: value }
        // Carry the row identity onto the clone so the edited row keeps its
        // React key (no remount / focus loss per keystroke).
        const identity = rowIdentities.get(row)
        if (identity !== undefined) rowIdentities.set(next, identity)
        return next
      }))
    }
    if (!rowsEditable) {
      const label = column.control === 'select' || column.control === 'ref'
        ? ((column.control === 'select'
          ? (column.options ?? [])
          : resolveRefColumnOptions(column, data, options)
        ).find((option) => option.value === cellText)?.label ?? cellText)
        : cellText
      return createElement('td', { key: column.key, className: 'dsh-design-rows-cell' }, label)
    }
    if (column.control === 'select' || column.control === 'ref') {
      const resolved = column.control === 'select'
        ? (column.options ?? []).filter((option) => {
          const gate = option.when
          return gate === undefined || gate.in.includes(String(row[gate.field] ?? ''))
        })
        : resolveRefColumnOptions(column, data, options)
      return createElement(
        'td',
        { key: column.key, className: 'dsh-design-rows-cell' },
        createElement(
          'select',
          { ...accessibility, className: 'dsh-design-field-input', value: cellText, onChange: (event: { target: { value: string } }) => { replaceCell(event.target.value) } },
          createElement('option', { value: '' }, ''),
          resolved.map((option) => createElement('option', { key: option.value, value: option.value }, option.label)),
          cellText && !resolved.some(option => option.value === cellText)
            ? createElement('option', { value: cellText, disabled: true }, panelText(
              column.options_from_panel !== undefined && options?.panelData === undefined ? 'unloadedReference' : 'staleReference',
              options?.locale, { value: cellText })) : null,
        ),
      )
    }
    if (column.control === 'textarea') {
      return createElement(
        'td',
        { key: column.key, className: 'dsh-design-rows-cell' },
        createElement('textarea', {
          ...accessibility,
          className: 'dsh-design-field-input',
          value: cellText,
          onChange: (event: { target: { value: string } }) => { replaceCell(event.target.value) },
        }),
      )
    }
    return createElement(
      'td',
      { key: column.key, className: 'dsh-design-rows-cell' },
      createElement('input', {
        ...accessibility,
        className: 'dsh-design-field-input',
        value: cellText,
        onChange: (event: { target: { value: string } }) => { replaceCell(event.target.value) },
      }),
    )
  }
  const rowName = typeof field.row_name === 'string' && field.row_name !== '' ? field.row_name : panelText('row', options?.locale)
  return createElement(
    'div',
    { className: 'dsh-design-rows', 'data-field': field.key },
    editable && hasInvalidRow
      ? createElement('div', { className: 'dsh-design-rows-diagnostic' }, panelText('invalidRows', options?.locale))
      : null,
    createElement(
      'table',
      { className: 'dsh-design-rows-table' },
      createElement('thead', null, createElement(
        'tr',
        null,
        columns.map((column) => createElement('th', { key: column.key }, column.label, column.required ? requiredMark(options?.locale) : null)),
        rowsEditable ? createElement('th', { key: '__actions' }, '') : null,
      )),
      createElement(
        'tbody',
        null,
        rows.map((row, rowIndex) => createElement(
          'tr',
          { key: rowKey(row, rowIndex) },
          isRowObject(row)
            ? columns.map((column) => renderCell(row, rowIndex, column))
            : createElement('td', {
              key: '__invalid',
              colSpan: columns.length + (rowsEditable ? 1 : 0),
              className: 'dsh-design-rows-invalid',
            }, panelText('invalidRow', options?.locale)),
          rowsEditable
            ? createElement(
              'td',
              { key: '__actions', className: 'dsh-design-rows-actions' },
              createElement('button', {
                type: 'button',
                title: panelText('remove', options?.locale, { item: rowName }),
                onClick: () => { emit(rows.filter((_, index) => index !== rowIndex)) },
              }, '×'),
            )
            : null,
        )),
      ),
    ),
    rowsEditable && rows.length < maxRows
      ? createElement('button', {
        type: 'button',
        className: 'dsh-design-rows-add',
        onClick: () => { emit([...rows, {}]) },
      }, `+ ${panelText('addItem', options?.locale, { item: rowName })}`)
      : null,
  )
}

/** Readable label for a source ref (`kind:name`); unknown kinds pass through. */
function readableSourceRef(value: string, locale?: string): string {
  const [kind, ...rest] = value.split(':')
  if (kind === 'standard') return panelText('sourceStandard', locale)
  const name = rest.join(':').trim()
  if (name === '') return value
  if (kind === 'upload') return panelText('sourceUpload', locale, { name })
  if (kind === 'user') return panelText('sourceUser', locale, { name })
  if (kind === 'research') return panelText('sourceResearch', locale, { name })
  if (kind === 'ai') return panelText('sourceAi', locale, { name })
  return value
}

/**
 * Source-reference list: value = array of `kind:name` ref strings. The array
 * is kept verbatim — non-string members render as preserved chips and are
 * never silently dropped by the next edit.
 */
function renderSourceList(
  field: EditorField,
  record: Record<string, unknown>,
  sectionId: string,
  recordId: string,
  options?: RenderOptions,
): ReactElement {
  const raw = record[field.key]
  const refs = Array.isArray(raw) ? raw : []
  const editable = options?.editable === true
  // A non-string member disables editing (clear diagnostic, raw value
  // preserved) instead of risking silent data loss on the next emit.
  const hasInvalidRef = refs.some((ref) => typeof ref !== 'string')
  const listEditable = editable && !hasInvalidRef
  const emit = (next: readonly unknown[]): void => {
    options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: next })
  }
  return createElement(
    'div',
    { className: 'dsh-design-source-list', 'data-field': field.key },
    editable && hasInvalidRef
      ? createElement('div', { className: 'dsh-design-source-diagnostic' }, panelText('invalidSourceItems', options?.locale))
      : null,
    refs.length === 0
      ? createElement('span', { className: 'dsh-design-field-value' }, '')
      : createElement(
        'ul',
        { className: 'dsh-design-source-refs' },
        refs.map((ref, index) => createElement(
          'li',
          {
            key: `${String(ref)}-${index}`,
            className: typeof ref === 'string' ? 'dsh-design-source-ref' : 'dsh-design-source-ref dsh-design-source-invalid',
            title: String(ref),
          },
          typeof ref === 'string' ? readableSourceRef(ref, options?.locale) : String(ref),
          listEditable
            ? createElement('button', {
              type: 'button',
              title: panelText('removeSource', options?.locale),
              onClick: () => { emit(refs.filter((_, i) => i !== index)) },
            }, '×')
            : null,
        )),
      ),
    listEditable
      ? createElement('input', {
        className: 'dsh-design-source-add',
        placeholder: panelText('addSourcePlaceholder', options?.locale),
        onKeyDown: (event: { key: string; target: { value: string } }) => {
          if (event.key !== 'Enter') return
          const value = event.target.value.trim()
          if (value === '') return
          emit([...refs, value])
          event.target.value = ''
        },
      })
      : null,
  )
}

const SINGLE_CHOICE_CONTROLS = new Set(['select', 'record_select'])
const MULTI_CHOICE_CONTROLS = new Set(['multi_select', 'record_multi_select'])

function requiredMark(locale?: string): ReactElement {
  return createElement('span', { className: 'dsh-design-required-mark', 'aria-hidden': true, title: panelText('requiredField', locale) }, ' *')
}

function renderField(
  field: EditorField,
  record: Record<string, unknown>,
  sectionId: string,
  recordId: string,
  data: DesignData,
  options?: RenderOptions,
): ReactElement {
  const value = record[field.key]
  const text = value === undefined || value === null ? '' : String(value)
  if (field.label_when) field = { ...field, label: fieldDisplayLabel(field, record) }
  if (field.readonly) options = { ...options, editable: false }
  const editable = options?.editable === true
  let control: ReactElement
  if (field.control === 'source_reference_map') {
    control = createElement(SourceReferences, { value, options })
  } else if (field.control === 'record_map') {
    // Multi-column scalar records share the numbered-table expression across
    // forms. Single-field captions and typed/disclosed child forms are retained.
    control = createElement(RecordMap, { field, record, compact: options?.compactFields || Boolean((field.columns?.length ?? 0) > 1 && !field.item_fields && !field.item_collapsible), editable: editable && options?.onRecordPatch !== undefined,
      onPatch: patch => options?.onRecordPatch?.(patch),
      renderItem: field.item_fields ? (id, item, change) => {
        const manifest: PanelManifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items' }],
          fields: (field.item_fields ?? []).map(child => ({ ...child, applies_to: ['items'] })), ui: { id: 'item-editor', component: 'record_form', source: 'items' } }
        return manifest.fields.filter(child => fieldIsVisible(child, item)).map(child => renderField(child, item, 'items',
          JSON.stringify([sectionId, recordId, field.key, id]), data, { ...options, editable: editable && options?.onRecordPatch !== undefined,
            onRecordPatch: undefined,
            onEdit: edit => { if (editable && options?.onRecordPatch) change(applyRecordFieldEdit(manifest, 'items', item, edit.field, edit.value)) },
          }))
      } : undefined })
  } else if (field.control === 'radio_custom') {
    control = createElement(CustomChoice, { value: text, options: resolveFieldOptions(field, record, data, options), label: field.label ?? field.key, placeholder: field.placeholder, editable,
      required: field.required, layout: field.choice_layout, customFocus: field.custom_focus,
      onChange: next => options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: next }) })
  } else if (field.control === 'token_list') {
    control = createElement(TokenList, { key: JSON.stringify([sectionId, recordId, field.key]), value, label: field.label ?? field.key, options: resolveFieldOptions(field, record, data, options), layout: field.token_layout, addMode: field.token_add_mode,
      addDescription: field.token_add_description, customIcon: field.token_custom_icon, customDescription: field.custom_description, editable, required: field.required,
      onChange: next => options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: next }) })
  } else if (field.control === 'data_table') {
    control = createElement(DataTable, { key: JSON.stringify([sectionId, recordId, field.key]), value, label: field.label ?? field.key, locale: options?.locale, editable: editable && !!options?.onEdit, registerBeforeSave: options?.registerBeforeSave,
      onChange: next => options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: next }) })
  } else if (field.control === 'rows') {
    control = renderRowsControl(field, record, data, sectionId, recordId, options)
  } else if (field.control === 'source_list') {
    control = renderSourceList(field, record, sectionId, recordId, options)
  } else if (SINGLE_CHOICE_CONTROLS.has(field.control)) {
    control = renderSingleChoice(field, record, data, sectionId, recordId, options)
  } else if (MULTI_CHOICE_CONTROLS.has(field.control)) {
    control = renderMultiChoice(field, record, data, sectionId, recordId, options)
  } else if (field.control === 'radio') {
    const resolved = resolveFieldOptions(field, record, data, options)
    const label = resolved.find((option) => option.value === text)?.label
    control = editable
      ? createElement(
        'div',
        { className: `dsh-design-field-choices${field.choice_layout ? ` is-${field.choice_layout}` : ''}`, role: 'radiogroup', 'aria-label': field.label ?? field.key,
          ...(field.required ? { 'aria-required': true } : {}) },
        resolved.map((option) => createElement(
          'label',
          { className: 'dsh-design-field-choice', key: option.value },
          createElement('input', {
            type: 'radio',
            name: `dsh-${sectionId}-${recordId}-${field.key}`,
            checked: text === option.value,
            onChange: () => {
              options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: option.value })
            },
          }),
          option.label,
        )),
      )
      : createElement('span', { className: 'dsh-design-field-value' }, label ?? text)
  } else if (field.control === 'color') {
    control = createElement(ColorControl, { value: text, label: field.label ?? field.key,
      disabled: !editable, onChange: value => options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value }) })
  } else if (field.control === 'textarea') {
    control = editable
      ? createElement('textarea', {
        rows: field.textarea_rows ?? (options?.compactFields ? 1 : undefined),
        style: field.textarea_rows === undefined ? undefined : { minHeight: `calc(${field.textarea_rows} * 1lh + 18px)` },
        className: 'dsh-design-field-input',
        value: text,
        onChange: (event: { target: { value: string } }) => {
          options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: event.target.value })
        },
      })
      : createElement('span', { className: 'dsh-design-field-value' }, text)
  } else if (field.control === 'number') {
    // A finite parse writes a Number. Empty or unparseable input clears the
    // property so it is omitted, rather than fabricating 0 or persisting NaN.
    control = editable
      ? createElement('input', {
        type: 'number',
        className: 'dsh-design-field-input',
        defaultValue: text,
        onChange: (event: { target: { value: string } }) => {
          const parsed = Number(event.target.value)
          const next = event.target.value.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined
          options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: next })
        },
      })
      : createElement('span', { className: 'dsh-design-field-value' }, text)
  } else if (field.control === 'list') {
    control = editable
      ? createElement('textarea', {
        className: 'dsh-design-field-input',
        placeholder: panelText('listPlaceholder', options?.locale),
        defaultValue: listText(value),
        onChange: (event: { target: { value: string } }) => {
          options?.onEdit?.({
            section: sectionId,
            record: recordId,
            field: field.key,
            value: event.target.value.split('\n').map((item) => item.trim()).filter((item) => item !== ''),
          })
        },
      })
      : createElement('span', { className: 'dsh-design-field-value' }, listText(value))
  } else if (field.control === 'key_value') {
    control = editable
      ? createElement('textarea', {
        className: 'dsh-design-field-input',
        placeholder: panelText('keyValuePlaceholder', options?.locale),
        defaultValue: keyValueText(value),
        onChange: (event: { target: { value: string } }) => {
          options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: parseKeyValue(event.target.value) })
        },
      })
      : createElement('span', { className: 'dsh-design-field-value' }, keyValueText(value))
  } else if (field.control === 'artifact_ref') {
    // Generated-artifact reference: display-only in every mode (upstream
    // offers no editor; the producing skill owns the value).
    control = createElement(
      'span',
      { className: 'dsh-design-field-value dsh-design-field-artifact' },
      text === '' ? panelText('notGenerated', options?.locale) : panelText('generated', options?.locale, { item: text.split('/').filter((part) => part !== '').pop() ?? text }),
    )
  } else if (field.control === 'toggle') {
    const checked = value === true || value === 'true'
    control = editable
      ? createElement('input', {
        type: 'checkbox',
        className: 'dsh-design-field-toggle',
        checked,
        onChange: (event: { target: { checked: boolean } }) => {
          options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: event.target.checked })
        },
      })
      : createElement('span', { className: 'dsh-design-field-value' }, panelText(checked ? 'yes' : 'no', options?.locale))
  } else {
    control = editable
      ? createElement('input', {
        className: 'dsh-design-field-input',
        value: text,
        onChange: (event: { target: { value: string } }) => {
          options?.onEdit?.({ section: sectionId, record: recordId, field: field.key, value: event.target.value })
        },
      })
      : createElement('span', { className: 'dsh-design-field-value' }, text)
  }
  return createElement(
    'div',
    { className: 'dsh-design-field', 'data-field': field.key, key: field.key,
      ...(field.required && ['record_map', 'rows', 'source_reference_map', 'source_list', 'color'].includes(field.control)
        ? { role: 'group', 'aria-label': panelText('requiredFieldName', options?.locale, { item: field.label ?? field.key }) } : {}) },
    createElement('span', { className: 'dsh-design-field-label' }, field.label ?? field.key, field.required ? requiredMark(options?.locale) : null),
    ['input', 'textarea', 'select'].includes(String(control.type))
      ? cloneElement(control as ReactElement<Record<string, unknown>>, { 'aria-label': field.label ?? field.key,
        ...(field.required ? { 'aria-required': true } : {}),
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        ...(field.max_length ? { maxLength: field.max_length } : {}),
        ...(field.input_type ? { type: field.input_type } : {}) })
      : control,
    field.max_length ? createElement('small', { className: 'dsh-design-field-description' }, `${text.length}/${field.max_length}`) : null,
    field.description ? createElement('p', { className: 'dsh-design-field-description' }, field.description) : null,
  )
}


function removeBoundRecord(manifest: PanelManifest, data: DesignData, source: string, id: string, options?: RenderOptions): void {
  if (!options?.editable || !options.onPanelUpdate) return
  const section = manifest.sections.find(section => section.id === source)
  if (section?.add_mode === 'none') return
  const binding = sectionBindingOf(manifest, source)
  const record = recordsAtPath(data, binding.recordsPath)[id] ?? {}
  const plan = recordDeletionUpdates(manifest, data, source, id)
  const label = section?.form?.header?.title
  const item = label && 'field' in label ? String(fieldValuesOf(record, binding.fieldsPath)[label.field] ?? recordLabel(record, id)) : recordLabel(record, id)
  if ((section?.confirm_delete || plan.children > 0 || plan.relations > 0) && typeof window !== 'undefined'
    && !window.confirm(panelText(plan.relations ? 'removeLinkedConfirm' : plan.children ? 'removeOwnedConfirm' : 'removeConfirm', options.locale, { item, count: plan.children, relations: plan.relations }))) return
  options.onPanelUpdate(plan.updates)
}

/** Row actions and disclosure are shared by every declarative record table. */
function RecordTableRow(props: {
  id: string; label: string; cells: ReactElement[]; detail?: ReactElement;
  onRemove?: () => void; locale?: RenderOptions['locale'];
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  const actions = props.detail !== undefined || props.onRemove !== undefined
  return createElement(Fragment, null,
    createElement('tr', { 'data-record': props.id }, ...props.cells,
      actions ? createElement('td', { className: 'dsh-related-record-actions' },
        createElement('div', { className: 'dsh-design-record-actions' },
          props.detail ? createElement('button', {
            type: 'button', className: 'dsh-panel-disclosure',
            'aria-label': panelText(expanded ? 'collapse' : 'expand', props.locale, { item: props.label }),
            'aria-expanded': expanded, 'aria-controls': detailId,
            onClick: () => setExpanded(value => !value),
          }, createElement(PanelDisclosureIcon, { expanded }), panelText(expanded ? 'hideRecordDetails' : 'showRecordDetails', props.locale)) : null,
          props.onRemove ? createElement('button', {
            type: 'button', 'data-testid': `record-remove-${props.id}`,
            'aria-label': panelText('remove', props.locale, { item: props.label }), onClick: props.onRemove,
          }, createElement(Trash2, { size: 16, 'aria-hidden': true })) : null)) : null),
    // Keep the editor mounted so folding cannot discard an in-progress edit.
    props.detail ? createElement('tr', { className: 'dsh-related-record-detail', hidden: !expanded },
      createElement('td', { colSpan: props.cells.length + (actions ? 1 : 0) },
        createElement('div', { id: detailId }, props.detail))) : null)
}

function renderRecordForm(node: ComponentNode, manifest: PanelManifest, data: DesignData, options?: RenderOptions, selectedRecord?: string | readonly string[], bodyOnly = false, omittedFields: readonly string[] = [], supplement?: (id: string) => ReactElement, headerAccessory?: ReactNode, part?: 'header'): ReactElement {
  const sectionId = node.source ?? ''
  const binding = sectionBindingOf(manifest, sectionId)
  const records = recordsAtPath(data, binding.recordsPath)
  const rawOrder = binding.orderPath !== undefined
    ? pathGet(data as unknown as Record<string, unknown>, binding.orderPath)
    : undefined
  const ids = orderedRecordIds(records, Array.isArray(rawOrder)
    ? (rawOrder as unknown[]).filter((id): id is string => typeof id === 'string')
    : undefined)
  const fields = fieldsForSection(manifest.fields, sectionId).filter(field => !omittedFields.includes(field.key))
  const sectionMeta = manifest.sections.find((section) => section.id === sectionId)
  const lifecycle = options?.editable === true && options?.onPanelUpdate !== undefined && sectionMeta?.add_mode !== 'none'
  const itemName = sectionMeta?.item_name ?? sectionMeta?.title ?? sectionId
  const pathMode = options?.onPanelUpdate !== undefined
  // Action names follow the same explicit record-title binding as the header.
  // Static header text is a collection caption, not the record's identity.
  const actionLabel = (record: Record<string, unknown>, id: string): string => {
    const title = sectionMeta?.form?.header?.title
    if (title && 'field' in title && fields.some(field => field.key === title.field)) {
      const value = fieldValuesOf(record, binding.fieldsPath)[title.field]
      if (typeof value === 'string' && value.trim() !== '') return value
    }
    return recordLabel(record, id)
  }

  // With onPanelUpdate present, writes go through the section binding;
  // otherwise edits flow through the flat onEdit channel.
  const emitRecords = (nextRecords: Record<string, Record<string, unknown>>, nextOrder?: readonly string[]): void => {
    const updates: Record<string, unknown> = { [binding.recordsPath]: nextRecords }
    if (binding.orderPath !== undefined && nextOrder !== undefined) updates[binding.orderPath] = nextOrder
    options?.onPanelUpdate?.(updates)
  }
  const addRecord = (): void => {
    // Opaque UUID-based ids, collision-checked against the current map: a
    // deleted id is practically never reused, so stale cross-panel
    // references cannot silently bind a different record. Non-integer-like
    // ids keep map insertion order across JSON round-trips; durable display
    // order lives in the declared order path.
    let id = freshRecordId(sectionId, records)
    const values = { ...sectionMeta?.create?.defaults, ...(sectionMeta?.create?.id_field ? { [sectionMeta.create.id_field]: id } : {}) }
    emitRecords({ ...records, [id]: binding.fieldsPath ? pathSet({}, binding.fieldsPath, values) : values }, [...ids, id])
  }
  const removeRecord = (id: string): void => removeBoundRecord(manifest, data, sectionId, id, options)
  const moveRecord = (id: string, delta: number): void => {
    const index = ids.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= ids.length) return
    const next = ids.slice()
    next.splice(index, 1)
    next.splice(target, 0, id)
    emitRecords(records, next)
  }
  const fieldOptions = (recordId: string, record: Record<string, unknown>, values: Record<string, unknown>): RenderOptions | undefined => {
    if (!pathMode) return options
    return {
      ...options,
      onRecordPatch: patch => {
        const nextValues = { ...values, ...patch }
        const nextRecord = binding.fieldsPath ? pathSet(record, binding.fieldsPath, nextValues) : nextValues
        emitRecords({ ...records, [recordId]: nextRecord })
      },
      onEdit: (edit) => {
        const nextValues = applyRecordFieldEdit(manifest, sectionId, values, edit.field, edit.value)
        const nextRecord = binding.fieldsPath !== undefined
          ? pathSet(record, binding.fieldsPath, nextValues)
          : nextValues
        emitRecords({ ...records, [recordId]: nextRecord })
      },
    }
  }

  // A table is only another view of this exact record map. All cell edits,
  // conditional clearing, derived labels and deletion use the normal form ports.
  if (node.record_table) {
    const columns = node.record_table.columns
    return createElement('div', { className: 'dsh-design-rows dsh-related-record-table', tabIndex: 0, role: 'region', 'aria-label': node.title ?? sectionMeta?.title, 'data-section': sectionId },
      createElement('table', { className: 'dsh-design-rows-table' },
        createElement('thead', null, createElement('tr', null,
          columns.map((column, index) => createElement('th', { scope: 'col', key: index }, column.label ?? fields.find(field => field.key === column.fields[0])?.label ?? column.fields[0])),
          lifecycle || supplement ? createElement('th', { scope: 'col', className: 'dsh-related-record-actions-heading' }, panelText('recordActions', options?.locale)) : null)),
        createElement('tbody', null, ids.filter(id => selectedRecord === undefined || (Array.isArray(selectedRecord) ? selectedRecord.includes(id) : id === selectedRecord)).map(id => {
          const record = records[id]!, values = fieldValuesOf(record, binding.fieldsPath)
          const cells = columns.map((column, index) => createElement('td', { key: index }, column.fields.map(key => {
              const field = fields.find(field => field.key === key)
              if (!field || !fieldIsVisible(field, values)) return null
              const control = renderField(field, values, sectionId, id, data, fieldOptions(id, record, values))
              // Keep each editor's accessible name; the shared table heading
              // replaces only its repeated visible caption, not help or requiredness.
              return cloneElement(control, { key, className: `dsh-design-field is-label-visually_hidden${field.required ? ' has-inline-required' : ''}` },
                ...(control.props as { children: ReactElement[] }).children,
                field.required ? requiredMark(options?.locale) : null)
            })))
          return createElement(RecordTableRow, { key: `${binding.recordsPath}:${id}`, id, cells,
            label: actionLabel(record, id), locale: options?.locale, detail: supplement?.(id),
            onRemove: lifecycle ? () => removeRecord(id) : undefined })
        }))))
  }
  return createElement(
    'div',
    { className: 'dsh-design-record-form', 'data-section': sectionId },
    ids.filter(id => selectedRecord === undefined || (Array.isArray(selectedRecord) ? selectedRecord.includes(id) : id === selectedRecord)).map((id, index) => {
      const record = records[id] as Record<string, unknown>
      const values = fieldValuesOf(record, binding.fieldsPath)
      const header = sectionMeta?.form?.header
      const titleKey = header && 'field' in header.title ? header.title.field : undefined
      const titleField = titleKey ? fields.find(field => field.key === titleKey) : undefined
      const titleEditable = header && 'field' in header.title && header.title.editable === true
        && titleField?.readonly !== true && options?.editable === true
        && (options.onPanelUpdate !== undefined || options.onEdit !== undefined)
      const title = titleField
        ? titleEditable
          ? createElement(PanelEditableTitle, {
            locale: options?.locale,
            'aria-label': titleField.label ?? titleField.key,
            ...(titleField.required ? { 'aria-required': true } : {}),
            size: Math.min(50, Math.max(8, String(values[titleField.key] ?? titleField.placeholder ?? '').length)),
            ...(titleField.max_length ? { maxLength: titleField.max_length } : {}),
            placeholder: titleField.placeholder,
            type: titleField.input_type ?? 'text',
            value: values[titleField.key] == null ? '' : String(values[titleField.key]),
            onChange: (event: { target: { value: string } }) => {
              fieldOptions(id, record, values)?.onEdit?.({ section: sectionId, record: id, field: titleField.key, value: event.target.value })
            },
          })
          : createElement('span', { className: 'dsh-design-record-header-label' }, String(values[titleField.key] ?? ''))
        : header && 'text' in header.title
          ? createElement('span', { className: 'dsh-design-record-header-label' },
            header.title.numbered ? createElement('span', { className: 'dsh-design-record-header-ordinal', 'aria-hidden': true }, index + 1) : null,
            header.title.text)
          : recordLabel(record, id)
      const consumed = new Set<string>(titleField ? [titleField.key] : [])
      const renderBodyItem = (item: FormField | FormRow | FormGroup | FormTabs | { kind: 'text'; text: string }, key: string, headingOwnsRequirement = false): ReactElement | null => {
        if (item.kind === 'text') return createElement('span', { className: 'dsh-design-form-text', key }, item.text)
        if (item.kind === 'tabs') {
          // Render all pages before fallback collection, including inactive fields.
          // Shared tabs keep editors mounted; only presentation state changes.
          const pages = new Map(item.tabs.map(tab => [tab.id, createElement('div', {
            className: 'dsh-design-form-tab-content', key: tab.id,
          }, tab.items.map((child, i) => renderBodyItem(child, `${key}-${tab.id}-${i}`)))]))
          return createElement('div', { className: 'dsh-design-form-tabs', key: item.id }, createElement(ComponentTabs, {
            node: { component: 'tabs', id: item.id, title: item.title,
              children: item.tabs.map(tab => ({ component: 'stack' as const, id: tab.id, title: tab.title })) },
            render: child => pages.get(child.id)!,
          }))
        }
        if (item.kind === 'field') {
          consumed.add(item.field)
          // This exact record's editable header is the single title entrance.
          // Nested record fields and static/non-editable captions are untouched.
          if (item.field === titleField?.key && header && 'field' in header.title && header.title.editable === true) return null
          const field = fields.find(entry => entry.key === item.field)
          if (!field || !fieldIsVisible(field, values)) return null
          const element = renderField(field, values, sectionId, id, data, fieldOptions(id, record, values))
          const inlineRequired = field.required && item.label === 'visually_hidden' && !headingOwnsRequirement
          return cloneElement(element as ReactElement<Record<string, unknown>>, { key: item.field,
            className: `dsh-design-field${item.label ? ` is-label-${item.label}` : ''}${item.width ? ` is-width-${item.width}` : ''}${inlineRequired ? ' has-inline-required' : ''}`,
          }, ...(element.props as { children: ReactElement[] }).children,
          inlineRequired ? requiredMark(options?.locale) : null)
        }
        // One field needs one caption. Only exact caption duplication is
        // structural: differently named scopes and preview titles carry meaning.
        // Near-synonyms belong to author review, never Bundle-name heuristics.
        const soleItem = item.kind === 'group' && !item.sidecar && item.items.length === 1
          && item.items[0]?.kind === 'field' ? item.items[0] : undefined
        const soleField = soleItem ? fields.find(field => field.key === soleItem.field) : undefined
        const duplicateCaption = soleItem && item.kind === 'group' && !item.collapsible && soleItem.label !== 'visually_hidden' && soleField
          && item.kind === 'group' && item.title === fieldDisplayLabel(soleField, values)
        // A matching single-field group heading replaces that field's hidden
        // caption. Unrelated/multi-field groups keep per-control indicators.
        const headingTitle = item.kind === 'group' && !duplicateCaption ? item.title : undefined
        const headingKey = item.kind === 'group' && headingTitle && item.items.length === 1
          && item.items[0]?.kind === 'field' && item.items[0].label === 'visually_hidden' ? item.items[0].field : undefined
        const headingField = headingKey ? fields.find(field => field.key === headingKey && fieldDisplayLabel(field, values) === headingTitle && fieldIsVisible(field, values)) : undefined
        const headingRequired = headingField?.required === true
        const children = item.items.map((child, i) => renderBodyItem(child, `${key}-${i}`, headingRequired))
        if (item.kind === 'row') {
          const hasFields = item.items.some(child => child.kind === 'field')
          if (hasFields && !item.items.some((child, i) => child.kind === 'field' && children[i] !== null)) return null
          return createElement('div', { className: 'dsh-design-form-row', key }, children)
        }
        if (!children.some(child => child !== null)) return null
        return createElement(item.collapsible ? 'details' : 'section', { className: `dsh-design-form-group${item.separator ? ' has-separator' : ''}${item.collapsible ? ' is-collapsible' : ''}`, key },
          headingTitle ? createElement(item.collapsible ? 'summary' : 'h3', { className: `dsh-design-form-group-title${item.collapsible ? ' dsh-panel-disclosure' : ''}` },
            createElement('span', { className: item.collapsible ? 'dsh-panel-disclosure-label' : undefined }, headingTitle, headingRequired ? requiredMark(options?.locale) : null),
            item.collapsible ? createElement(PanelDisclosureIcon, { expanded: false }) : null) : null,
          item.description ? createElement('p', { className: 'dsh-design-form-group-description' }, item.description) : null,
          createElement('div', { className: `dsh-design-form-group-content${item.sidecar ? ' has-sidecar' : ''}` },
            createElement('div', { className: 'dsh-design-form-group-fields' }, children),
            item.sidecar ? createElement(RecordPreview, {
              node: { ...item.sidecar, id: `${node.id}-${key}-preview`, source: sectionId },
              manifest, data, options, record: id,
            }) : null))
      }
      // Traverse declared items before fallback: invisible referenced fields remain
      // consumed and cannot bypass their visibility rule through a second editor.
      const body = sectionMeta?.form?.body?.map((item, i) => renderBodyItem(item, `body-${i}`))
      const fallback = fields.filter(field => !consumed.has(field.key) && fieldIsVisible(field, values))
        .map(field => renderField(field, values, sectionId, id, data, fieldOptions(id, record, values)))
      const hasBody = Boolean(body?.some(Boolean) || fallback.length)
      // Preserve same-record projections without reserving empty body rows.
      if (bodyOnly && !hasBody) return null
      const recordHeader = bodyOnly ? null : createElement(
          PanelRecordHeader,
          { variant: header?.variant, placement: part === 'header' ? 'workspace' : undefined, key: id },
          title,
          headerAccessory,
          lifecycle
            ? createElement(
              'span',
              { className: 'dsh-design-record-actions' },
              // Move controls require a durable order path; without one the
              // display order is map insertion order and not reorderable.
              binding.orderPath !== undefined && sectionMeta?.form?.reorder !== false
                ? [
                  createElement('button', {
                    key: 'up',
                    type: 'button',
                    'data-testid': `record-up-${id}`,
                    title: panelText('moveUp', options?.locale),
                    'aria-label': `${panelText('moveUp', options?.locale)} ${actionLabel(record, id)}`,
                    disabled: ids.indexOf(id) === 0,
                    onClick: () => { moveRecord(id, -1) },
                  }, createElement(ArrowUp, { size: 16, 'aria-hidden': true })),
                  createElement('button', {
                    key: 'down',
                    type: 'button',
                    'data-testid': `record-down-${id}`,
                    title: panelText('moveDown', options?.locale),
                    'aria-label': `${panelText('moveDown', options?.locale)} ${actionLabel(record, id)}`,
                    disabled: ids.indexOf(id) === ids.length - 1,
                    onClick: () => { moveRecord(id, 1) },
                  }, createElement(ArrowDown, { size: 16, 'aria-hidden': true })),
                ]
                : null,
              createElement('button', {
                key: 'remove',
                type: 'button',
                'data-testid': `record-remove-${id}`,
                title: panelText('remove', options?.locale, { item: itemName }),
                'aria-label': panelText('remove', options?.locale, { item: actionLabel(record, id) }),
                onClick: () => { removeRecord(id) },
              }, createElement(Trash2, { size: 16, 'aria-hidden': true })),
            )
            : null,
        )
      if (part === 'header') return recordHeader!
      return createElement('div', {
        className: `dsh-design-record${header && !bodyOnly ? ` has-form-header is-${header.variant}` : ''}`,
        'data-record': id, key: id,
      }, recordHeader, hasBody ? createElement('div', { className: `dsh-design-record-fields${sectionMeta?.form?.body ? ' has-form-body' : ''}` }, body, fallback) : null)
    }),
    lifecycle && selectedRecord === undefined
      ? createElement('button', {
        type: 'button',
        className: 'dsh-design-record-add',
        'data-testid': `record-add-${sectionId}`,
        onClick: addRecord,
      }, `+ ${panelText('addItem', options?.locale, { item: itemName })}`)
      : null,
  )
}

function renderGroupedRecords(node: ComponentNode, manifest: PanelManifest, data: DesignData, options?: RenderOptions): ReactElement {
  const section = node.source ?? ''
  const binding = sectionBindingOf(manifest, section)
  const records = recordsAtPath(data, binding.recordsPath)
  const groups = new Map<string, string[]>()
  for (const [id, value] of Object.entries(records)) {
    const raw = value[node.group_by ?? '']
    // Keep the group identity independent of translated fallback text.
    const name = typeof raw === 'string' && raw.trim() !== '' ? raw : ''
    groups.set(name, [...(groups.get(name) ?? []), id])
  }
  const groupViews = [...groups.entries()].map(([group, ids]) => {
    const recordViews = ids.map(id => createElement('details', { key: id, className: 'dsh-design-grouped-record' },
      createElement('summary', null, recordLabel(records[id] ?? {}, id)),
      renderRecordForm({ component: 'record_form', id: `${node.id}-${id}`, source: section }, manifest, data, options, id)))
    return createElement('details', { key: group, className: 'dsh-design-grouped-records-group', open: true },
      createElement('summary', null, group || panelText('ungrouped', options?.locale),
        createElement('span', null, readableCount(ids.length, 'item', options?.locale))),
      createElement('div', { className: 'dsh-design-grouped-records-items' }, recordViews))
  })
  return createElement('section', { className: 'dsh-design-grouped-records', 'data-section': section, 'data-node': node.id },
    renderNodeHeader(node), groupViews)
}

function renderNestedCollection(node: ComponentNode, data: DesignData, options?: RenderOptions): ReactElement {
  const parent = data[node.source ?? ''] ?? {}
  return createElement('section', { className: 'dsh-design-nested-collection', 'data-node': node.id },
    renderNodeHeader(node), Object.entries(parent).slice(0, 100).map(([id, value]) => {
      const item = value as Record<string, unknown>
      const children = item[node.children_field ?? '']
      const entries = children !== null && typeof children === 'object' && !Array.isArray(children)
        ? Object.entries(children as Record<string, unknown>) : []
      const label = String(item[node.label_field ?? ''] ?? id)
      return createElement('details', { key: id, className: 'dsh-design-nested-parent', open: true },
        createElement('summary', null, label, createElement('span', null, readableCount(entries.length, 'item', options?.locale))),
        createElement('div', { className: 'dsh-design-nested-children' },
          entries.slice(0, 100).map(([childId, childValue]) => {
            const child = childValue as Record<string, unknown>
            return createElement('details', { key: childId, className: 'dsh-design-nested-child' },
              createElement('summary', null, String(child[node.child_label_field ?? ''] ?? childId)), readableValue(child, 0, options?.locale))
          }), entries.length > 100 ? createElement('p', null, remainingItems(entries.length - 100, options?.locale)) : null))
    }), Object.keys(parent).length > 100 ? createElement('p', null, panelText('remainingRecordsOriginal', options?.locale)) : null)
}

function resolveRelatedArtifactPaths(data: DesignData, pattern: string): readonly { path: string; trail: string }[] {
  const visit = (value: unknown, parts: readonly string[], trail: readonly string[]): { path: string; trail: string }[] => {
    if (parts.length === 0) return typeof value === 'string' && value !== '' ? [{ path: value, trail: trail.join(' / ') }] : []
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
    if (parts[0] === '*') return Object.entries(value as Record<string, unknown>).flatMap(([id, child]) =>
      visit(child, parts.slice(1), [...trail, child !== null && typeof child === 'object' && !Array.isArray(child)
        ? recordLabel(child as Record<string, unknown>, id) : id]))
    return visit((value as Record<string, unknown>)[parts[0]], parts.slice(1), trail)
  }
  return visit(data, pattern.split('.'), [])
}

function renderRelatedArtifacts(node: ComponentNode, data: DesignData, options?: RenderOptions): ReactElement {
  const groups = new Map<string, string[]>()
  for (const pattern of node.paths_from ?? []) {
    for (const { path, trail } of resolveRelatedArtifactPaths(data, pattern)) {
      // Authored trails and the empty fallback key stay stable across locales.
      groups.set(trail, [...new Set([...(groups.get(trail) ?? []), path])])
    }
  }
  return createElement('section', { className: 'dsh-design-related-artifacts', 'data-node': node.id },
    renderNodeHeader(node), [...groups.entries()].map(([label, paths]) => createElement('div',
      { key: label, className: 'dsh-design-related-artifact-group' },
      createElement('h4', null, label || panelText('relatedArtifacts', options?.locale)),
      createElement(ArtifactGallery, { paths, options }))))
}

function standardQuestionFromRecord(id: string, question: Record<string, unknown>): StandardQuestionItem {
  const rawChoices = Array.isArray(question.choices) ? question.choices as readonly Record<string, unknown>[] : []
  const kind = question.kind === 'single' || question.kind === 'multiple' || question.kind === 'text'
    ? question.kind
    : rawChoices.length > 0 ? 'single' : 'text'
  const attachments = Array.isArray(question.multimodal_answer)
    ? question.multimodal_answer.filter((value): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)).flatMap(value => {
        if (typeof value.file_md5 !== 'string' || typeof value.filename !== 'string' || typeof value.mime_type !== 'string' || typeof value.size_bytes !== 'number') return []
        return [{
          type: value.type === 'image' ? 'image' as const : 'file' as const,
          file_md5: value.file_md5,
          filename: value.filename,
          mime_type: value.mime_type,
          size_bytes: value.size_bytes,
          artifact_file: typeof value.artifact_file === 'string' ? value.artifact_file : undefined,
        }]
      })
    : []
  const answer = Array.isArray(question.answer)
    ? question.answer.filter((value): value is string => typeof value === 'string')
    : typeof question.answer === 'string' ? question.answer : ''
  return {
    id,
    prompt: String(question.prompt ?? ''),
    note: typeof question.note === 'string' ? question.note : undefined,
    kind,
    recommendationVariant: id.startsWith('const_') ? 'fixed-badge' : 'inline',
    choices: rawChoices.map(choice => ({
      value: String(choice.value ?? ''),
      label: String(choice.label ?? choice.value ?? ''),
      recommended: choice.recommended === true,
    })),
    answer,
    detail: typeof question.detail === 'string' ? question.detail : '',
    round: typeof question.round === 'number' ? question.round : undefined,
    rejected: question.rejected === true,
    attachments,
    answered: (Array.isArray(answer) ? answer.some(value => value.trim() !== '') : answer.trim() !== '') || attachments.length > 0,
  }
}

function standardQuestionListElement(sectionId: string, questions: readonly StandardQuestionItem[], options?: RenderOptions, cardGroups?: StandardQuestionWorkspaceProps['cardGroups']): ReactElement {
  return standardQuestionComponent(StandardQuestionList, sectionId, questions, options, { cardGroups })
}

function standardQuestionComponent(
  component: typeof StandardQuestionList | typeof StandardQuestionWorkspace,
  sectionId: string,
  questions: readonly StandardQuestionItem[],
  options?: RenderOptions,
  workspace?: Partial<StandardQuestionWorkspaceProps>,
): ReactElement {
  const pending = options?.pendingArtifacts ?? []
  const emitAttachmentTransaction = (edit: DesignEdit, nextPending: readonly PendingDeclarativeArtifact[]): void => {
    if (options?.onTransaction) {
      options.onTransaction([edit], { [DECLARATIVE_PANEL_ARTIFACTS_KEY]: nextPending })
      return
    }
    options?.onEdit?.(edit)
    options?.onPanelUpdate?.({ [DECLARATIVE_PANEL_ARTIFACTS_KEY]: nextPending })
  }
  const replaceAttachments = (id: string, attachments: readonly StandardQuestionAttachment[]): void => {
    const identities = new Set(attachments.map(item => `${item.file_md5}/${item.filename}`))
    emitAttachmentTransaction(
      { section: sectionId, record: id, field: 'multimodal_answer', value: attachments },
      pending.filter(item => item.question_id !== id || identities.has(`${item.file_md5}/${item.filename}`)),
    )
  }
  return createElement(component, {
    questions,
    ...(workspace ?? {}),
    editable: options?.editable === true,
    collapseToken: options?.collapseToken,
    onAnswerChange: (id: string, answer: string | readonly string[]) => {
      options?.onEdit?.({ section: sectionId, record: id, field: 'answer', value: Array.isArray(answer) ? answer.join(',') : answer })
    },
    onKindChange: workspace?.allowChoiceActions === true ? (id: string, kind: 'multiple') => {
      const question = questions.find(item => item.id === id)
      if (options?.editable !== true || kind !== 'multiple' || question?.kind !== 'single' || question.rejected
        || workspace.firstRoundIds?.includes(id)) return
      const edit: DesignEdit = { section: sectionId, record: id, field: 'kind', value: kind }
      if (options.onTransaction) options.onTransaction([edit], {})
      else options.onEdit?.(edit)
    } : undefined,
    onDetailChange: (id: string, detail: string) => {
      options?.onEdit?.({ section: sectionId, record: id, field: 'detail', value: detail })
    },
    onAttachmentsChange: options?.allowAttachments === false ? undefined : replaceAttachments,
    onUploadFiles: options?.allowAttachments === false || options?.skill === undefined ? undefined : async (id: string, files: readonly File[]) => {
      const current = questions.find(question => question.id === id)?.attachments ?? []
      const additions = await Promise.all(files.map(file => prepareDeclarativeQuestionAttachment(options.skill as string, id, file)))
      if (options.onAppendAttachments) { options.onAppendAttachments(sectionId, id, additions); return }
      const nextRefs = [...current, ...additions.map(addition => addition.ref)].filter((value, index, values) =>
        values.findIndex(candidate => candidate.file_md5 === value.file_md5 && candidate.filename === value.filename) === index)
      emitAttachmentTransaction(
        { section: sectionId, record: id, field: 'multimodal_answer', value: nextRefs },
        [...pending, ...additions.map(addition => addition.pending)].filter((value, index, values) =>
          values.findIndex(candidate => candidate.path === value.path) === index),
      )
    },
    resolveAttachmentPreview: (attachment: StandardQuestionAttachment) => previewFromArtifact(attachment, pending, options?.readBinaryArtifact, options?.skill),
  })
}

function renderQuestionList(node: ComponentNode, _manifest: PanelManifest, data: DesignData, options?: RenderOptions): ReactElement {
  const sectionId = node.source ?? ''
  const records = data[sectionId] ?? {}
  const questions = Object.entries(records).map(([id, question]) => standardQuestionFromRecord(id, question))
  return createElement(
    'div',
    { className: 'dsh-design-question-list', 'data-section': sectionId },
    renderNodeHeader(node),
    standardQuestionListElement(sectionId, questions, options, node.card_groups?.map(group => ({ id: group.id, title: group.title, questionIds: group.question_ids,
      presentation: group.presentation ? { alwaysExpanded: group.presentation.always_expanded, showDetail: group.presentation.show_detail, showAttachments: group.presentation.show_attachments } : undefined }))),
  )
}

function questionWorkspaceProps(node: ComponentNode, sectionId: string, options?: RenderOptions, data?: DesignData): Partial<StandardQuestionWorkspaceProps> {
  const roundsSource = typeof node.rounds_source === 'string' ? node.rounds_source : undefined
  return {
    title: node.title ?? panelText('questions', options?.locale),
    sidebarIcon: node.sidebar_icon,
    description: node.guidance,
    rounds: roundsSource === undefined ? undefined : Object.fromEntries(Object.entries(data?.[roundsSource] ?? {}).flatMap(([id, value]) =>
      value && typeof value.title === 'string' && typeof value.description === 'string' ? [[id, { title: value.title, description: value.description }]] : [])),
    cardGroups: node.card_groups?.map(group => ({ id: group.id, title: group.title, questionIds: group.question_ids,
      presentation: group.presentation ? { alwaysExpanded: group.presentation.always_expanded, showDetail: group.presentation.show_detail, showAttachments: group.presentation.show_attachments } : undefined })),
    firstRoundIds: node.question_policy?.first_round_ids,
    protectedQuestionIds: node.question_policy?.protected_ids,
    historyReadonly: node.question_policy?.history_readonly,
    numberedRounds: node.question_policy?.numbered_rounds,
    allowChoiceActions: node.question_policy?.allow_choice_actions === true,
    onRejectedChange: node.question_policy?.allow_rejection ? (id, rejected) => options?.onEdit?.({ section: sectionId, record: id, field: 'rejected', value: rejected }) : undefined,
  }
}

function renderQuestionWorkspace(node: ComponentNode, _manifest: PanelManifest, data: DesignData, options?: RenderOptions): ReactElement {
  const sectionId = node.source ?? ''
  const records = data[sectionId] ?? {}
  const questions = Object.entries(records).map(([id, question]) => standardQuestionFromRecord(id, question))
  return createElement(
    'div',
    { className: 'dsh-design-question-workspace', 'data-section': sectionId },
    standardQuestionComponent(StandardQuestionWorkspace, sectionId, questions, options, questionWorkspaceProps(node, sectionId, options, data)),
  )
}

/** A matrix dimension column declaration. */
interface MatrixDimension {
  field: string
  label?: string
}

function renderRelationMatrix(node: ComponentNode, _manifest: PanelManifest, data: DesignData): ReactElement {
  const sectionId = node.source ?? ''
  const records = data[sectionId] ?? {}
  const dimensions = (node.matrix_dimensions ?? []) as readonly MatrixDimension[]
  return createElement(
    'table',
    { className: 'dsh-design-relation-matrix', 'data-section': sectionId },
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        createElement('th', { className: 'dsh-design-matrix-rowhead' }, ''),
        dimensions.map((dim) => createElement('th', { key: dim.field }, dim.label ?? dim.field)),
      ),
    ),
    createElement(
      'tbody',
      null,
      Object.entries(records).map(([id, record]) => createElement(
        'tr',
        { key: id, 'data-record': id },
        createElement('td', { className: 'dsh-design-matrix-rowhead' }, recordLabel(record, id)),
        dimensions.map((dim) => createElement(
          'td',
          { key: dim.field, className: 'dsh-design-matrix-cell' },
          String(record[dim.field] ?? ''),
        )),
      )),
    ),
  )
}

function renderMindMap(node: ComponentNode, _manifest: PanelManifest, data: DesignData): ReactElement {
  const sectionId = node.source ?? ''
  const records = data[sectionId] ?? {}
  const parentField = typeof node.parent_field === 'string' ? node.parent_field : 'parent'
  const childrenOf = new Map<string, Array<[string, Record<string, unknown>]>>()
  const roots: Array<[string, Record<string, unknown>]> = []
  for (const [id, record] of Object.entries(records)) {
    const parent = typeof record[parentField] === 'string' ? (record[parentField] as string) : ''
    if (parent === '' || !(parent in records)) {
      roots.push([id, record])
    } else {
      if (!childrenOf.has(parent)) childrenOf.set(parent, [])
      childrenOf.get(parent)?.push([id, record])
    }
  }
  const renderRecord = (entry: [string, Record<string, unknown>]): ReactElement => {
    const [id, record] = entry
    const children = childrenOf.get(id)
    return createElement(
      'li',
      { key: id, 'data-record': id, className: 'dsh-design-mind-map-node' },
      createElement('span', { className: 'dsh-design-mind-map-label' }, recordLabel(record, id)),
      children !== undefined && children.length > 0
        ? createElement('ul', { className: 'dsh-design-mind-map-children' }, children.map(renderRecord))
        : null,
    )
  }
  return createElement(
    'div',
    { className: 'dsh-design-mind-map', 'data-section': sectionId },
    createElement('ul', { className: 'dsh-design-mind-map-root' }, roots.map(renderRecord)),
  )
}

/** A bpmn step kind, mirroring the flow-design schema enum. */
type BpmnStepKind = 'task' | 'gateway' | 'event'

const BPMN_KINDS: readonly BpmnStepKind[] = ['task', 'gateway', 'event']

function normalizeBpmnSteps(process: Record<string, unknown>): readonly Record<string, unknown>[] {
  return Array.isArray(process.steps) ? (process.steps as readonly Record<string, unknown>[]) : []
}

function bpmnKindOf(step: Record<string, unknown>): BpmnStepKind {
  return BPMN_KINDS.includes(step.kind as BpmnStepKind) ? (step.kind as BpmnStepKind) : 'task'
}

function emitSteps(
  options: RenderOptions | undefined,
  sectionId: string,
  recordId: string,
  steps: readonly Record<string, unknown>[],
): void {
  options?.onEdit?.({ section: sectionId, record: recordId, field: 'steps', value: steps })
}

/** One step row of the editable canvas: shape marker, name, kind, and position controls. */
function renderBpmnStepRow(
  step: Record<string, unknown>,
  index: number,
  steps: readonly Record<string, unknown>[],
  sectionId: string,
  recordId: string,
  options: RenderOptions | undefined,
): ReactElement {
  const replace = (next: Record<string, unknown>): void => {
    emitSteps(options, sectionId, recordId, steps.map((item, i) => (i === index ? next : item)))
  }
  const move = (delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= steps.length) return
    const next = [...steps]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    emitSteps(options, sectionId, recordId, next)
  }
  const remove = (): void => {
    emitSteps(options, sectionId, recordId, steps.filter((_, i) => i !== index))
  }
  return createElement(
    'div',
    { className: `dsh-design-bpmn-step dsh-design-bpmn-${bpmnKindOf(step)} dsh-design-bpmn-step-row`, key: index },
    createElement('input', {
      className: 'dsh-design-bpmn-step-name',
      value: String(step.name ?? ''),
      placeholder: '步骤名',
      onChange: (event: { target: { value: string } }) => {
        replace({ ...step, name: event.target.value })
      },
    }),
    createElement(
      'select',
      {
        className: 'dsh-design-bpmn-step-kind',
        value: bpmnKindOf(step),
        onChange: (event: { target: { value: string } }) => {
          replace({ ...step, kind: event.target.value })
        },
      },
      BPMN_KINDS.map((kind) => createElement('option', { key: kind, value: kind }, kind)),
    ),
    createElement(
      'span',
      { className: 'dsh-design-bpmn-step-actions' },
      createElement('button', { type: 'button', title: '上移', onClick: () => { move(-1) } }, '↑'),
      createElement('button', { type: 'button', title: '下移', onClick: () => { move(1) } }, '↓'),
      createElement('button', { type: 'button', title: '删除', onClick: remove }, '×'),
    ),
  )
}

function renderBpmnCanvas(node: ComponentNode, _manifest: PanelManifest, data: DesignData, options?: RenderOptions): ReactElement {
  const sectionId = node.source ?? ''
  const records = data[sectionId] ?? {}
  const editable = options?.editable === true
  return createElement(
    'div',
    { className: 'dsh-design-bpmn-canvas', 'data-section': sectionId },
    Object.entries(records).map(([id, process]) => {
      const steps = normalizeBpmnSteps(process)
      return createElement(
        'div',
        { className: 'dsh-design-bpmn-process', 'data-record': id, key: id },
        editable
          ? createElement('input', {
            className: 'dsh-design-bpmn-process-name dsh-design-bpmn-process-name-input',
            value: String(process.name ?? ''),
            onChange: (event: { target: { value: string } }) => {
              options?.onEdit?.({ section: sectionId, record: id, field: 'name', value: event.target.value })
            },
          })
          : createElement('div', { className: 'dsh-design-bpmn-process-name' }, recordLabel(process, id)),
        createElement(
          'div',
          { className: 'dsh-design-bpmn-flow' },
          steps.map((step, index) => createElement(
            'div',
            { key: index },
            editable
              ? renderBpmnStepRow(step, index, steps, sectionId, id, options)
              : createElement('div', { className: `dsh-design-bpmn-step dsh-design-bpmn-${bpmnKindOf(step)}` }, String(step.name ?? '')),
            index < steps.length - 1 ? createElement('div', { className: 'dsh-design-bpmn-arrow' }, '↓') : null,
          )),
          editable
            ? createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-design-bpmn-add-step',
                onClick: () => { emitSteps(options, sectionId, id, [...steps, { name: '', kind: 'task' }]) },
              },
              '+ 添加步骤',
            )
            : null,
        ),
      )
    }),
  )
}

function renderLifecycleCanvas(node: ComponentNode, _manifest: PanelManifest, data: DesignData): ReactElement {
  const sectionId = node.source ?? ''
  const records = data[sectionId] ?? {}
  return createElement(
    'div',
    { className: 'dsh-design-lifecycle-canvas', 'data-section': sectionId },
    createElement(
      'div',
      { className: 'dsh-design-lifecycle-stages' },
      Object.entries(records).map(([id, stage]) => createElement(
        'div',
        { className: 'dsh-design-lifecycle-stage', 'data-record': id, key: id },
        recordLabel(stage, id),
      )),
    ),
  )
}

function renderQuestionRounds(node: ComponentNode, _manifest: PanelManifest, data: DesignData, options?: RenderOptions): ReactElement {
  const sectionId = node.source ?? ''
  const records = data[sectionId] ?? {}
  return createElement(
    'div',
    { className: 'dsh-design-question-rounds', 'data-section': sectionId },
    standardQuestionComponent(
      StandardQuestionWorkspace,
      sectionId,
      Object.entries(records).map(([id, question]) => standardQuestionFromRecord(id, question)),
      options,
      questionWorkspaceProps({ ...node, title: node.title ?? '问题轮次' }, sectionId, options, data),
    ),
  )
}

function renderRelatedRecords(node: ComponentNode, _manifest: PanelManifest, data: DesignData): ReactElement {
  const sectionId = node.source ?? ''
  const records = data[sectionId] ?? {}
  return createElement(
    'div',
    { className: 'dsh-design-related-records', 'data-section': sectionId },
    createElement(
      'ul',
      null,
      Object.entries(records).map(([id, record]) => createElement(
        'li',
        { 'data-record': id, key: id },
        recordLabel(record, id),
      )),
    ),
  )
}

// ── Residue envelope (upstream A11 frozen shape; FE recognizes shape only) ──

/** Render-time projection of a cross-panel sync reference. */
export interface ResidueSyncProjection {
  title?: string
  summary?: string
  status?: string | null
}

/** One read-only aggregation reference (value lives in the concern panel). */
export interface ResidueSyncRef {
  concern: string
  record_ref: string
  projection?: ResidueSyncProjection
}

/** An evidence record of the editable residue region. */
export interface ResidueRecord {
  id: string
  title: string
  summary?: string
  details?: Record<string, unknown>
  readonly [extra: string]: unknown
}

/** An editable residue section (records + ordering). */
export interface ResidueAddSection {
  id: string
  title?: string
  records?: Record<string, ResidueRecord>
  record_order?: readonly string[]
  readonly [extra: string]: unknown
}

/** Panel-level residue envelope carried by the draft's top-level keys. */
export interface ResidueEnvelope {
  module?: string
  residue_shape?: string
  sync?: { refs?: readonly ResidueSyncRef[] }
  add?: Record<string, ResidueAddSection>
  add_order?: readonly string[]
}

/** Tolerant envelope read: malformed members normalize empty, never throw. */
export function readResidueEnvelope(data: Record<string, unknown>): ResidueEnvelope {
  const envelope: ResidueEnvelope = {}
  if (typeof data.module === 'string') envelope.module = data.module
  if (typeof data.residue_shape === 'string') envelope.residue_shape = data.residue_shape
  const sync = data.sync
  if (sync !== null && typeof sync === 'object' && Array.isArray((sync as { refs?: unknown }).refs)) {
    const refs = (sync as { refs: unknown[] }).refs
      .filter((ref): ref is Record<string, unknown> => ref !== null && typeof ref === 'object')
      .map((ref) => ({
        concern: typeof ref.concern === 'string' ? ref.concern : '',
        record_ref: typeof ref.record_ref === 'string' ? ref.record_ref : '',
        projection: ref.projection !== null && typeof ref.projection === 'object'
          ? (ref.projection as ResidueSyncProjection)
          : undefined,
      }))
    envelope.sync = { refs }
  }
  const add = data.add
  if (add !== null && typeof add === 'object' && !Array.isArray(add)) {
    const sections: Record<string, ResidueAddSection> = {}
    for (const [id, raw] of Object.entries(add as Record<string, unknown>)) {
      if (raw === null || typeof raw !== 'object') continue
      const section = raw as ResidueAddSection
      const records: Record<string, ResidueRecord> = {}
      if (section.records !== null && typeof section.records === 'object') {
        for (const [recordId, record] of Object.entries(section.records)) {
          if (record !== null && typeof record === 'object') records[recordId] = { ...(record as ResidueRecord), id: recordId }
        }
      }
      sections[id] = { ...section, id, records }
    }
    envelope.add = sections
  }
  if (Array.isArray(data.add_order)) {
    envelope.add_order = (data.add_order as unknown[]).filter((id): id is string => typeof id === 'string')
  }
  return envelope
}

/** Group sync refs by concern, preserving first-seen order. */
function groupSyncRefs(refs: readonly ResidueSyncRef[]): { concern: string; refs: ResidueSyncRef[] }[] {
  const groups: { concern: string; refs: ResidueSyncRef[] }[] = []
  for (const ref of refs) {
    const group = groups.find((item) => item.concern === ref.concern)
    if (group !== undefined) group.refs.push(ref)
    else groups.push({ concern: ref.concern, refs: [ref] })
  }
  return groups
}

/** A ref whose projection carries no displayable content is stale. */
function isStaleRef(ref: ResidueSyncRef): boolean {
  const projection = ref.projection
  return projection === undefined || (!projection.title && !projection.summary && !projection.status)
}


/** The details sub-record of a residue/evidence record (tolerant). */
function detailsOf(record: Record<string, unknown>): Record<string, unknown> {
  const details = record.details
  return details !== null && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : {}
}

/** `list` control text form: one item per line (string members only). */
function listText(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').join('\n')
    : ''
}

/** `key_value` control text form: one `key: value` per line. */
function keyValueText(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ''
  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${key}: ${entry === null || entry === undefined ? '' : String(entry)}`)
    .join('\n')
}

/** Parse `key: value` lines into a map; lines without a key are dropped. */
function parseKeyValue(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    if (key === '') continue
    out[key] = line.slice(separator + 1).trim()
  }
  return out
}

/** Optional node header (title + description), upstream studio/workbench chrome. */
function renderNodeHeader(node: ComponentNode): ReactElement | null {
  if (node.title === undefined && node.description === undefined) return null
  return createElement(
    'header',
    { className: 'dsh-design-node-header' },
    node.title !== undefined ? createElement('h3', { className: 'dsh-design-node-title' }, node.title) : null,
    node.description !== undefined ? createElement('p', { className: 'dsh-design-node-description' }, node.description) : null,
  )
}

/**
 * Row-view workbench (A11 envelope): top read-only sync aggregation grouped
 * by concern (stale refs degrade to a warning row, never dropped), bottom
 * exclusive residue edit region bound to the owned section's storage paths
 * (records_path/fields_path/order). Writes emit path-keyed panel updates
 * through `onPanelUpdate`; sync/meta read the envelope top level.
 */
function renderRowViewWorkbench(node: ComponentNode, manifest: PanelManifest, data: DesignData, options?: RenderOptions): ReactElement {
  const envelope = readResidueEnvelope(data as unknown as Record<string, unknown>)
  const editable = options?.editable === true && options?.onPanelUpdate !== undefined
  const syncGroups = groupSyncRefs(envelope.sync?.refs ?? [])
  // The workbench consumes only its declared `source` section; the compiler
  // rejects a workbench without one (fail loud, no implicit fallback).
  const ownedSection = typeof node.source === 'string' ? node.source : ''
  const sectionMeta = manifest.sections.find((section) => section.id === ownedSection)
  const binding = sectionBindingOf(manifest, ownedSection)
  const residueRecords = recordsAtPath(data, binding.recordsPath)
  const rawOrder = binding.orderPath !== undefined
    ? pathGet(data as unknown as Record<string, unknown>, binding.orderPath)
    : undefined
  const residueIds = orderedRecordIds(residueRecords, Array.isArray(rawOrder)
    ? (rawOrder as unknown[]).filter((id): id is string => typeof id === 'string')
    : undefined)
  const itemName = sectionMeta?.item_name ?? sectionMeta?.title ?? ownedSection

  const emitResidue = (nextRecords: Record<string, Record<string, unknown>>, nextOrder?: readonly string[]): void => {
    const updates: Record<string, unknown> = { [binding.recordsPath]: nextRecords }
    if (binding.orderPath !== undefined && nextOrder !== undefined) updates[binding.orderPath] = nextOrder
    options?.onPanelUpdate?.(updates)
  }
  const addRecord = (): void => {
    // Opaque collision-checked id (practically never reused after delete);
    // an empty store bootstraps through this path.
    const id = freshRecordId(`add-${ownedSection}`, residueRecords)
    const record: ResidueRecord = { id, title: `新${itemName} ${Object.keys(residueRecords).length + 1}`, summary: '', details: {} }
    emitResidue({ ...residueRecords, [id]: record }, [...residueIds, id])
  }
  const removeRecord = (id: string): void => {
    const next = { ...residueRecords }
    delete next[id]
    emitResidue(next, residueIds.filter((entry) => entry !== id))
  }

  return createElement(
    'div',
    {
      className: 'dsh-design-rowview-workbench',
      'data-module': envelope.module ?? '',
      'data-residue-shape': envelope.residue_shape ?? '',
      'data-testid': 'rowview-workbench',
    },
    renderNodeHeader(node),
    createElement(
      'section',
      { className: 'dsh-design-rowview-sync', 'aria-label': '只读聚合', 'data-testid': 'rowview-sync-region' },
      createElement('div', { className: 'dsh-design-rowview-sync-title' }, '只读聚合'),
      syncGroups.length === 0
        ? createElement('p', { className: 'dsh-design-muted' }, '暂无聚合记录。')
        : syncGroups.map((group) => createElement(
          'div',
          { className: 'dsh-design-rowview-sync-group', key: group.concern },
          createElement('span', { className: 'dsh-design-rowview-concern', 'data-testid': `sync-concern-jump-${group.concern}` }, group.concern),
          group.refs.map((ref, index) => isStaleRef(ref)
            ? createElement('div', {
              key: `${ref.record_ref}-${index}`,
              role: 'alert',
              'data-testid': 'sync-ref-stale',
              className: 'dsh-design-rowview-stale',
            }, `已失效引用：${ref.record_ref}`)
            : createElement(
              'div',
              { key: `${ref.record_ref}-${index}`, 'data-testid': 'sync-ref-row', className: 'dsh-design-rowview-sync-ref' },
              createElement('div', { className: 'dsh-design-rowview-sync-ref-title' }, ref.projection?.title || ref.record_ref),
              ref.projection?.summary ? createElement('div', { className: 'dsh-design-rowview-sync-ref-summary' }, ref.projection.summary) : null,
              ref.projection?.status ? createElement('span', { className: 'dsh-design-rowview-sync-ref-status' }, ref.projection.status) : null,
            )),
        )),
    ),
    createElement(
      'section',
      { className: 'dsh-design-rowview-add', 'aria-label': '残余编辑区', 'data-testid': 'rowview-add-region' },
      createElement(
        'div',
        { className: 'dsh-design-rowview-section', key: ownedSection },
        createElement(
          'div',
          { className: 'dsh-design-rowview-section-head' },
          createElement('span', { className: 'dsh-design-rowview-section-title' }, itemName),
          editable
            ? createElement('button', {
              type: 'button',
              className: 'dsh-design-rowview-add-btn',
              'aria-label': `添加${itemName}`,
              onClick: addRecord,
            }, `+ 添加${itemName}`)
            : null,
        ),
        residueIds.length === 0
          ? createElement('p', { className: 'dsh-design-muted' }, `还没有${itemName}，点击上方添加。`)
          : residueIds.map((id) => {
            const record = residueRecords[id] as Record<string, unknown>
            const values = fieldValuesOf(record, binding.fieldsPath)
            const rowFields = fieldsForSection(manifest.fields, ownedSection).filter((field) => {
              return fieldIsVisible(field, values)
            })
            const summary = typeof record.summary === 'string' && record.summary !== '' ? record.summary : undefined
            return createElement(
              'details',
              { className: 'dsh-design-rowview-record', key: id, 'data-testid': `rowview-record-${id}` },
              createElement(
                'summary',
                { className: 'dsh-design-rowview-record-summary' },
                createElement('span', { className: 'dsh-design-rowview-record-title' }, recordLabel(record, id)),
                summary !== undefined ? createElement('span', { className: 'dsh-design-rowview-record-excerpt' }, summary) : null,
              ),
              createElement(
                'div',
                { className: 'dsh-design-rowview-record-detail' },
                rowFields.map((field) => renderField(field, values, ownedSection, id, data, {
                  ...options,
                  onEdit: (edit) => {
                    const nextValues = applyRecordFieldEdit(manifest, ownedSection, values, edit.field, edit.value)
                    const nextRecord = binding.fieldsPath !== undefined
                      ? pathSet(record, binding.fieldsPath, nextValues)
                      : nextValues
                    emitResidue({ ...residueRecords, [id]: nextRecord })
                  },
                })),
                editable
                  ? createElement('button', {
                    type: 'button',
                    className: 'dsh-design-rowview-remove',
                    onClick: () => { removeRecord(id) },
                  }, `删除${recordLabel(record, id)}`)
                  : null,
              ),
            )
          }),
      ),
    ),
  )
}

/** Ordered records of a DesignData section (insertion order). */
function sectionRecords(data: DesignData, sectionId: string): [string, Record<string, unknown>][] {
  return Object.entries(data[sectionId] ?? {})
}

/**
 * Document lifecycle studio: one fact table (actions × state axes with
 * per-cell effects) plus process/derivation/ledger projections, all derived
 * at render time from the objects/axes/actions sections. Unavailable views
 * render disabled with a reason, never silently hidden.
 */
function renderDocLifecycleStudio(node: ComponentNode, _manifest: PanelManifest, data: DesignData, options?: RenderOptions): ReactElement {
  return createElement(DocLifecycleStudio, { node, manifest: _manifest, data, options })
}

function DocLifecycleStudio({ node, manifest: _manifest, data, options }: {
  node: ComponentNode; manifest: PanelManifest; data: DesignData; options?: RenderOptions
}): ReactElement {
  const { selected } = useRecordSelection()
  const bindings = node.bindings ?? {}
  const objectRefField = bindings.object_ref ?? 'object_ref'
  const nodeRefField = bindings.process_node_ref ?? 'process_node_ref'
  const effectsField = bindings.axis_effects ?? 'axis_effects'
  const signField = bindings.movement_sign
  const qtyField = bindings.movement_qty ?? 'movement_qty'
  const editable = options?.editable === true
  const objects = sectionRecords(data, 'objects')
  const allAxes = sectionRecords(data, 'axes')
  const allActions = sectionRecords(data, 'actions')
  const selectedKind = selected && ['objects', 'axes', 'actions'].find(section =>
    sectionBindingOf(_manifest, section).recordsPath === sectionBindingOf(_manifest, selected.section).recordsPath)
  const selectedRecord = selectedKind === 'axes' ? allAxes.find(([id]) => id === selected?.record)?.[1]
    : selectedKind === 'actions' ? allActions.find(([id]) => id === selected?.record)?.[1] : undefined
  const objectId = selectedKind === 'objects' ? selected?.record : selectedRecord ? String(detailsOf(selectedRecord).object_ref ?? '') : undefined
  const ownAxes = new Set(allAxes.filter(([id, axis]) => selectedKind === 'axes'
    ? id === selected?.record : detailsOf(axis).object_ref === objectId).map(([id]) => id))
  const actionEffects = (action: Record<string, unknown>): Record<string, string> => {
    const value = detailsOf(action)[effectsField]
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {}
  }
  const actions = !selectedKind ? allActions : allActions.filter(([id, action]) => selectedKind === 'actions'
    ? id === selected?.record
    : (selectedKind === 'objects' && detailsOf(action).object_ref === objectId)
      || Object.keys(actionEffects(action)).some(axis => ownAxes.has(axis)))
  // Include effects on other documents: a scoped view must not hide a cross-document consequence.
  const affectedAxes = new Set(actions.flatMap(([, action]) => Object.keys(actionEffects(action))))
  const axes = !selectedKind ? allAxes : allAxes.filter(([id]) => ownAxes.has(id) || affectedAxes.has(id))
  const objectLabel = (id: unknown): string => String(objects.find(([key]) => key === id)?.[1]?.title ?? id ?? '')
  const axisLabel = (id: string, axis: Record<string, unknown>): string => {
    const owner = detailsOf(axis).object_ref
    const title = String(axis.title ?? id)
    return selectedKind && owner && owner !== objectId ? `${objectLabel(owner)} · ${title}` : title
  }

  // Axis names belong to the canonical record, even when its business fields
  // are exposed through a nested section projection.
  const axesBinding = sectionBindingOf(_manifest, 'axes')
  const titleSection = axesBinding.fieldsPath === undefined ? 'axes' : _manifest.sections.find(section =>
    sectionBindingOf(_manifest, section.id).recordsPath === axesBinding.recordsPath
    && section.fields_path === undefined
    && fieldsForSection(_manifest.fields, section.id).some(field => field.key === 'title' && field.readonly !== true))?.id

  const setActionEffects = (actionId: string, effects: Record<string, string>): void => {
    options?.onEdit?.({ section: 'actions', record: actionId, field: effectsField, value: effects })
  }

  const matrixView = createElement(
    'table',
    { className: 'dsh-design-studio-matrix dsh-design-rows-table', 'data-testid': 'studio-matrix', key: selected ? `${selected.section}:${selected.record}` : 'all' },
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        createElement('th', null, '动作'),
        axes.map(([axisId, axis]) => createElement(
          'th',
          { key: axisId },
          editable && titleSection !== undefined && !selectedKind
            ? createElement('input', {
              className: 'dsh-design-studio-axis-title dsh-design-field-input',
              'aria-label': `重命名状态轴 ${String(axis.title ?? axisId)}`,
              defaultValue: String(axis.title ?? axisId),
              onChange: (event: { target: { value: string } }) => {
                options?.onEdit?.({ section: titleSection!, record: axisId, field: 'title', value: event.target.value })
              },
            })
            : axisLabel(axisId, axis),
        )),
      ),
    ),
    createElement(
      'tbody',
      null,
      actions.map(([actionId, action]) => {
        const details = detailsOf(action)
        const effects = details[effectsField]
        const effectMap = effects !== null && typeof effects === 'object' && !Array.isArray(effects)
          ? (effects as Record<string, string>)
          : {}
        return createElement(
          'tr',
          { key: actionId, 'data-record': actionId },
          createElement('td', { className: 'dsh-design-studio-action' }, String(action.title ?? actionId),
            selectedKind && details.object_ref && details.object_ref !== objectId
              ? createElement('div', { className: 'dsh-design-field-description' }, objectLabel(details.object_ref)) : null),
          axes.map(([axisId]) => createElement(
            'td',
            { key: axisId, className: 'dsh-design-studio-cell' },
            editable
              ? createElement('input', {
                className: 'dsh-design-field-input',
                placeholder: '不改变',
                'aria-label': `${String(action.title ?? actionId)} 在 ${String(axes.find(([id]) => id === axisId)?.[1]?.title ?? axisId)} 的效果`,
                defaultValue: effectMap[axisId] ?? '',
                onChange: (event: { target: { value: string } }) => {
                  const next = { ...effectMap }
                  if (event.target.value === '') delete next[axisId]
                  else next[axisId] = event.target.value
                  setActionEffects(actionId, next)
                },
              })
              : (effectMap[axisId] ?? ''),
          )),
        )
      }),
    ),
  )

  const processField = _manifest.fields.find(field => field.key === nodeRefField && field.options_from_panel)
  const processRecords = processField?.options_from_panel ? options?.panelData?.(processField.options_from_panel.panel_type, processField.options_from_panel.section_id) : undefined
  const processRefs = actions
    .map(([actionId, action]) => ({ actionId, title: String(action.title ?? actionId), ref: detailsOf(action)[nodeRefField] }))
    .filter((entry) => typeof entry.ref === 'string' && entry.ref !== '')
  const processView = processRefs.length === 0
    ? createElement('p', { className: 'dsh-design-studio-unavailable', 'data-testid': 'studio-process-missing' }, '相关流程不可用：尚无动作引用流程节点。')
    : createElement(
      'ul',
      { className: 'dsh-design-studio-process', 'data-testid': 'studio-process' },
      processRefs.map((entry) => createElement(
        'li',
        { key: entry.actionId, className: 'dsh-design-studio-process-chip' },
        `${entry.title} → ${String(processRecords?.[String(entry.ref)]?.title ?? entry.ref)}`,
      )),
    )

  const derivationEdges = objects
    .map(([objectId, object]) => ({ objectId, title: String(object.title ?? objectId), target: detailsOf(object)[objectRefField] }))
    .filter((entry) => typeof entry.target === 'string' && entry.target !== ''
      && (!selectedKind || entry.objectId === objectId || entry.target === objectId))
  const derivationView = derivationEdges.length === 0
    ? createElement('p', { className: 'dsh-design-studio-unavailable', 'data-testid': 'studio-derivations-missing' }, '上下游单据不可用：尚无单据引用上游对象。')
    : createElement(
      'ul',
      { className: 'dsh-design-studio-derivations', 'data-testid': 'studio-derivations' },
      derivationEdges.map((entry) => createElement(
        'li',
        { key: entry.objectId },
        `${objectLabel(entry.target)} → ${entry.title}`,
      )),
    )

  const ledgerRows = signField === undefined
    ? []
    : actions
      .map(([objectId, action]) => ({ objectId, title: String(action.title ?? objectId), details: detailsOf(action) }))
      .filter((entry) => entry.details[signField] !== undefined)
  const ledgerView = signField === undefined || ledgerRows.length === 0
    ? createElement('p', { className: 'dsh-design-studio-unavailable', 'data-testid': 'studio-ledger-missing' }, '移动台账不可用：未绑定 movement_sign 或无移动记录。')
    : createElement(
      'table',
      { className: 'dsh-design-studio-ledger dsh-design-rows-table', 'data-testid': 'studio-ledger' },
      createElement('tbody', null, ledgerRows.map((entry) => {
        const inbound = String(entry.details[signField as string]) !== '-'
        return createElement(
          'tr',
          { key: entry.objectId },
          createElement('td', null, entry.title),
          createElement('td', { 'aria-label': `${entry.title} 方向：${inbound ? '入库（+）' : '出库（−）'}` }, inbound ? '入库（+）' : '出库（−）'),
          createElement(
            'td',
            null,
            editable
              ? createElement('input', {
                'aria-label': `${entry.title} 数量说明`,
                defaultValue: String(entry.details[qtyField] ?? ''),
                onChange: (event: { target: { value: string } }) => {
                  options?.onEdit?.({ section: 'actions', record: entry.objectId, field: qtyField, value: event.target.value })
                },
              })
              : String(entry.details[qtyField] ?? ''),
          ),
        )
      })),
    )

  const envelope = readResidueEnvelope(data as unknown as Record<string, unknown>)
  const views: [string, ReactElement][] = [
    ['状态与动作', actions.length && axes.length ? matrixView : createElement('p', { className: 'dsh-design-field-description' }, '尚未登记可比较的状态与动作，可从左侧添加；未知状态不自动补全。')],
    ['相关流程', processView],
    ['上下游单据', derivationView],
    ['移动台账', ledgerView],
  ]
  return createElement(
    'div',
    { className: selectedKind ? 'dsh-record-inspector-views' : 'dsh-design-studio', 'data-testid': 'doc-lifecycle-studio', 'data-module': envelope.module ?? '' },
    selectedKind ? null : renderNodeHeader(node),
    selectedKind ? null : createElement(
      'div',
      { className: 'dsh-design-studio-meta', 'data-testid': 'studio-meta' },
      envelope.module !== undefined ? createElement('span', { className: 'dsh-design-studio-meta-chip' }, envelope.module) : null,
      envelope.residue_shape !== undefined ? createElement('span', { className: 'dsh-design-studio-meta-chip' }, envelope.residue_shape) : null,
    ),
    views.map(([label, view], index) => createElement(
      'details',
      { className: 'dsh-design-form-group is-collapsible', key: label, open: index === 0 },
      createElement('summary', { className: 'dsh-design-form-group-title dsh-panel-disclosure' },
        createElement('span', { className: 'dsh-panel-disclosure-label' }, label),
        createElement(PanelDisclosureIcon, { expanded: index === 0 })),
      index === 0
        ? createElement('div', { className: 'dsh-matrix-scroll' },
            createElement('p', { className: 'dsh-design-field-description' }, '行是动作，列是状态。空白表示不改变；带单据名称的列表示对其他单据的影响。直接改写结果值即可。'),
            view)
        : view,
    )),
  )
}

function keyed(element: ReactElement, key: string): ReactElement {
  return cloneElement(element, { key })
}

function readableCount(count: number, kind: 'item' | 'field', locale?: string): string {
  return panelText(kind === 'item'
    ? (count === 1 ? 'itemCountOne' : 'itemCountMany')
    : (count === 1 ? 'fieldCountOne' : 'fieldCountMany'), locale, { count })
}

function remainingItems(count: number, locale?: string, original = false): string {
  return panelText(original
    ? (count === 1 ? 'moreItemsOriginalOne' : 'moreItemsOriginalMany')
    : (count === 1 ? 'moreItemsOne' : 'moreItemsMany'), locale, { count })
}

/** Schema-backed facts remain in Design JSON; this is only a bounded reading
 * view. Nested values are expandable instead of dumped as a JSON string. */
function readableValue(value: unknown, depth = 0, locale?: string): ReactElement {
  if (value === null || typeof value !== 'object') {
    return createElement('span', { className: 'dsh-design-field-value' }, value === null ? '—' : String(value))
  }
  if (depth >= 8) return createElement('span', null, panelText('contentTooDeep', locale))
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item] as const)
    : Object.entries(value as Record<string, unknown>)
  return createElement('div', { className: 'dsh-design-structured-list' },
    entries.slice(0, 100).map(([key, item]) => createElement('div', { className: 'dsh-design-structured-row', key },
      createElement('span', { className: 'dsh-design-field-label' }, key.replace(/[_-]/gu, ' ')),
      item !== null && typeof item === 'object'
        ? createElement('details', { className: 'dsh-design-structured-branch' },
          createElement('summary', null, Array.isArray(item)
            ? readableCount(item.length, 'item', locale) : readableCount(Object.keys(item).length, 'field', locale)),
          readableValue(item, depth + 1, locale))
        : readableValue(item, depth + 1, locale))),
    entries.length > 100 ? createElement('p', null, remainingItems(entries.length - 100, locale, true)) : null)
}

function ArtifactGallery({ paths, options }: { paths: readonly string[]; options?: RenderOptions }): ReactElement {
  const [preview, setPreview] = useState<{ path: string; text?: string; dataUrl?: string; error?: string;
    errorKey?: 'galleryArtifactMissing' | 'galleryArtifactUnreadable' }>()
  const open = async (path: string): Promise<void> => {
    if (!options?.artifactFiles?.[path]) return
    try {
      if (/\.(?:png|jpe?g|webp|pdf)$/iu.test(path) && options.readBinaryArtifact) {
        const result = await options.readBinaryArtifact(path)
        setPreview(result.found ? { path, dataUrl: `data:${result.mediaType};base64,${result.base64}` }
          : { path, errorKey: 'galleryArtifactMissing' })
      } else {
        const result = await options.readArtifact?.(path)
        setPreview(result?.found ? { path, text: result.content } : { path, errorKey: 'galleryArtifactUnreadable' })
      }
    } catch (error) { setPreview({ path, error: error instanceof Error ? error.message : String(error) }) }
  }
  return createElement('section', { className: 'dsh-design-artifact-gallery' },
    createElement('div', { className: 'dsh-design-artifact-list' }, paths.map(path => createElement('button', {
      key: path, type: 'button', onClick: () => { void open(path) }, disabled: options?.artifactFiles?.[path] === undefined,
    }, path.split('/').pop() ?? path))),
    preview === undefined ? null : createElement('div', { className: 'dsh-design-artifact-preview' },
      createElement('strong', null, preview.path),
      preview.errorKey ? createElement('p', null, panelText(preview.errorKey, options?.locale))
        : preview.error ? createElement('p', null, preview.error)
        : preview.dataUrl ? (/\.pdf$/iu.test(preview.path)
          ? createElement('iframe', { src: preview.dataUrl, title: preview.path })
          : createElement('img', { src: preview.dataUrl, alt: preview.path }))
          : createElement('pre', null, preview.text ?? '')))
}

function renderSchemaField(node: ComponentNode, data: DesignData, options?: RenderOptions): ReactElement {
  const path = node.path ?? ''
  const value = pathGet(data as unknown as Record<string, unknown>, path)
  const label = node.title ?? path.split('.').pop() ?? path
  const emit = (next: unknown): void => { if (options?.editable) options.onPanelUpdate?.({ [path]: next }) }
  const editable = options?.editable === true && options.onPanelUpdate !== undefined
  let control: ReactElement
  if (!editable) control = createElement('span', { className: 'dsh-design-field-value' },
    Array.isArray(value) ? value.join(panelText('listSeparator', options?.locale)) : String(value ?? '—'))
  else if (node.control === 'color') control = createElement(ColorControl, { value: String(value ?? ''), label, onChange: emit })
  else if (node.control === 'toggle') control = createElement('input', { type: 'checkbox', 'aria-label': label, checked: value === true,
    onChange: (event: { target: { checked: boolean } }) => emit(event.target.checked) })
  else if (node.control === 'select') control = createElement(PanelSelect, { className: 'dsh-design-field-input', 'aria-label': label,
    value: String(value ?? ''), options: node.options ?? [], onValueChange: emit })
  else if (node.control === 'textarea' || node.control === 'list') control = createElement('textarea', {
    className: 'dsh-design-field-input', 'aria-label': label,
    value: node.control === 'list' && Array.isArray(value) ? value.join('\n') : String(value ?? ''),
    onChange: (event: { target: { value: string } }) => emit(node.control === 'list'
      ? event.target.value.split('\n').map(item => item.trim()).filter(Boolean) : event.target.value),
  })
  else control = createElement('input', { className: 'dsh-design-field-input', 'aria-label': label, type: node.control === 'number' ? 'number' : 'text', value: String(value ?? ''),
    onChange: (event: { target: { value: string } }) => emit(node.control === 'number'
      ? Number(event.target.value) : event.target.value) })
  return createElement('label', { className: 'dsh-design-field dsh-design-schema-field', 'data-node': node.id },
    createElement('span', { className: 'dsh-design-field-label' }, label), control)
}

/**
 * Render one component node against the manifest and data.
 * @param node - the UI tree node.
 * @param manifest - the owning panel manifest.
 * @param data - Design Files projected by section.
 * @returns the rendered element.
 */
export function renderNode(node: ComponentNode, manifest: PanelManifest, data: DesignData, options?: RenderOptions): ReactElement {
  const render = Object.prototype.hasOwnProperty.call(PANEL_COMPONENT_RENDERERS, node.component)
    ? PANEL_COMPONENT_RENDERERS[node.component] : undefined
  if (!render) throw new Error(`No registered panel component renderer: ${String(node.component)}`)
  const content = render(node, manifest, data, options)
  const ownsWorkspace = declarativePanelOwnsWorkspace({ ...manifest, ui: node })
  const guided = node.guidance && !WORKSPACE_COMPONENT_KINDS.includes(node.component)
    ? createElement('div', { className: 'dsh-panel-guided-content', 'data-layout': ownsWorkspace ? 'workspace' : 'document' },
      createElement('div', { className: 'dsh-panel-guided-body' }, content),
      createElement(PanelWorkspaceGuidance, { key: node.id, children: node.guidance }))
    : content
  // The catalog's existing workspace ownership governs layout as well as the
  // host scroll boundary. Wrappers and view switches cannot drop the allocated
  // height; ordinary document nodes keep their natural flow.
  return ownsWorkspace
    ? createElement('div', { className: 'dsh-design-workspace-surface', 'data-workspace-node': node.id }, guided)
    : guided
}

/** Trusted renderer contract. All data writes still go through RenderOptions
 * and the owning manifest/schema; registering a renderer grants no authority.
 */
export type PanelComponentRenderer = (
  node: ComponentNode, manifest: PanelManifest, data: DesignData, options?: RenderOptions,
) => ReactElement

/** Complete renderer table: adding a catalog name without implementing its
 * renderer fails type checking rather than silently rendering a placeholder.
 * Shared with authored and A2UI-projected panels.
 */
/** Reuse the native function-card interaction without flattening nested facts. */
function renderReadingCards(node: ComponentNode, sources: readonly string[], ids: readonly string[], manifest: PanelManifest, data: DesignData, options?: RenderOptions): ReactElement {
  const card = node.record_cards!
  const source = sources.find(source => {
    const fields = fieldsForSection(manifest.fields, source)
    return fields.some(field => field.key === card.label) && fields.some(field => field.key === card.description)
  })!
  const binding = sectionBindingOf(manifest, source)
  const records = recordsAtPath(data, binding.recordsPath)
  const attention = card.attention_fields ?? []
  return createElement('div', { className: 'dsh-record-board-cards dsh-record-reading-cards', 'data-section': source },
    ...ids.filter(id => Object.hasOwn(records, id)).map(id => {
      const record = records[id]!, values = fieldValuesOf(record, binding.fieldsPath)
      // Both card text and nested controls use the existing canonical mutation port.
      const cardOptions = options?.onPanelUpdate ? { ...options, onTransaction: (edits: readonly DesignEdit[], updates: Record<string, unknown>) => {
        if (!options.editable) return
        if (options.onTransaction) { options.onTransaction(edits, updates); return }
        let next = values
        for (const edit of edits) {
          if (edit.section !== source || edit.record !== id) throw Error('Out-of-scope reading card edit')
          next = applyRecordFieldEdit(manifest, source, next, edit.field, edit.value)
        }
        options.onPanelUpdate!({ [binding.recordsPath]: { ...records, [id]: binding.fieldsPath ? pathSet(record, binding.fieldsPath, next) : next } })
      } } : options
      const shownAttention = attention.filter(key => {
        const value = values[key]
        return value !== undefined && value !== '' && !(Array.isArray(value) && !value.length)
      })
      const section = manifest.sections.find(section => section.id === source)
      const attentionOptions = options?.onPanelUpdate ? { ...options,
        onEdit: (edit: DesignEdit) => cardOptions?.onTransaction?.([edit], {}),
        onRecordPatch: (patch: Record<string, unknown>) => cardOptions?.onTransaction?.(Object.entries(patch).map(([field, value]) => ({ section: source, record: id, field, value })), {}),
      } : options
      return createElement(BoardCard, { key: `${source}:${id}`, id, record: values,
        binding: { label: card.label, description: card.description }, section: source, manifest, options: cardOptions, onEditing: () => {},
        actions: options?.editable && options.onPanelUpdate && section?.add_mode !== 'none'
          ? createElement('button', { type: 'button', className: 'dsh-reading-card-remove',
            'aria-label': panelText('remove', options.locale, { item: String(values[card.label] ?? id) }),
            title: panelText('remove', options.locale, { item: section?.item_name ?? section?.title ?? source }),
            onClick: () => removeBoundRecord(manifest, data, source, id, options),
          }, createElement(Trash2, { size: 16, 'aria-hidden': true })) : null },
        ...shownAttention.map(key => createElement('div', { key, className: 'dsh-reading-card-attention' },
          renderField(fieldsForSection(manifest.fields, source).find(field => field.key === key)!, values, source, id, data, attentionOptions))),
        createElement('details', { className: 'dsh-record-board-editor dsh-reading-card-details' },
          createElement('summary', { className: 'dsh-panel-disclosure' }, card.details_title, createElement(PanelDisclosureIcon)),
          createElement('div', { className: 'dsh-record-inspector-views' }, ...sources.map(view => keyed(renderRecordForm({ component: 'record_form', id: `${node.id}-${view}`, source: view }, manifest, data, options, id, true,
            view === source ? [card.label, card.description, ...shownAttention] : []), view)))))
    }))
}

export const PANEL_COMPONENT_RENDERERS: Readonly<Record<ComponentKind, PanelComponentRenderer>> = Object.freeze({
  navigation_workspace: (node, manifest, data, options) => createElement(NavigationWorkspace, { node, manifest, data, options,
    children: (node.children ?? []).map(child => createElement('details', { key: child.id },
      createElement('summary', null, child.title ?? child.id), renderNode(child, manifest, data, options))),
    render: (section, id, editOptions, displayData) => renderRecordForm({ component: 'record_form', id: `${node.id}-${section}`, source: section }, manifest, (displayData ?? data) as DesignData, editOptions, id) }),
  text_block: node => createElement(WorkspaceTextBlock, { id: node.id }, node.text ?? ''),
  structured_data: (node, _manifest, data, options) => createElement('section', { className: 'dsh-design-structured-data', 'data-node': node.id },
    renderNodeHeader(node), readableValue(pathGet(data as unknown as Record<string, unknown>, node.source ?? ''), 0, options?.locale)),
  schema_field: (node, _manifest, data, options) => renderSchemaField(node, data, options),
  artifact_gallery: (node, _manifest, _data, options) => createElement('section', { className: 'dsh-design-artifact-section', 'data-node': node.id },
    renderNodeHeader(node), createElement(ArtifactGallery, { paths: node.paths ?? [], options })),
  related_artifacts: (node, _manifest, data, options) => renderRelatedArtifacts(node, data, options),
  record_form: renderRecordForm,
  document_workspace: (node, _manifest, data, options) => createElement(DocumentWorkspace, { node, data, options }),
  execution_log: (node, _manifest, data, options) => createElement(ExecutionLog, { node, data, options }),
  artifact_workspace: (node, _manifest, data, options) => createElement(ArtifactWorkspace, { node, data, options }),
  canvas_workspace: (node, manifest, data, options) => createElement(CanvasWorkspace, { node, manifest, data, options }),
  preview_workspace: (node, manifest, data, options) => createElement(PreviewWorkspace, { node, data, options,
    children: (node.children ?? []).map((child, index) => createElement('details', { key: child.id, className: 'dsh-preview-control-group', open: index === 0 },
      createElement('summary', null, child.title ?? child.id),
      child.description ? createElement('p', null, child.description) : null,
      renderNode(child, manifest, data, options))) }),
  diagram_workspace: (node, manifest, data, options) => createElement(DiagramWorkspace, { node, manifest, data, options,
    render: (id, section = node.source!, editable = false) => renderRecordForm({ component: 'record_form', id: node.id, source: section }, manifest, data, { ...options, editable: editable && options?.editable }, id) }),
  record_board: (node, manifest, data, options) => createElement(RecordBoard, { node, manifest, data, options,
    renderDetails: node.board?.detail_sources ? (id, overrides) => {
      const detailOptions = overrides ?? options
      const writable = detailOptions?.editable === true
      const scope = boardDetailScope(manifest, data, node.board!.detail_sources, id)
      const scopedOptions = { ...detailOptions,
        canonicalData: scope.data as DesignData,
        onRecordPatch: undefined,
        onEdit: writable && detailOptions?.onEdit ? (edit: DesignEdit) => {
          if (!scope.allowsEdit(edit.section, edit.record, edit.field)) throw Error('Out-of-scope board detail edit')
          detailOptions.onEdit!(edit)
        } : undefined,
        onPanelUpdate: writable && detailOptions?.onPanelUpdate ? (updates: Record<string, unknown>) => detailOptions.onPanelUpdate!(scope.merge(updates)) : undefined,
        onTransaction: writable && detailOptions?.onTransaction ? (edits: readonly DesignEdit[], updates: Record<string, unknown>) => {
          if (edits.some(edit => !scope.allowsEdit(edit.section, edit.record, edit.field))) throw Error('Out-of-scope board detail transaction')
          detailOptions.onTransaction!(edits, scope.merge(updates))
        } : undefined,
      }
      return createElement('div', { key: id, className: 'dsh-board-detail-workspace' },
        ...(node.children ?? []).map(child => renderNode(child, manifest, scope.data, scopedOptions)))
    } : undefined,
    render: (section, id, overrides) => {
      // Header/description controls already own these fields; the detail fold
      // must not introduce a second editor or record lifecycle actions.
      const storage = sectionBindingOf(manifest, section)
      const record = recordsAtPath(data, storage.recordsPath)[id] ?? {}
      const values = fieldValuesOf(record, storage.fieldsPath)
      const detailOptions = overrides ?? options
      const labelField = fieldsForSection(manifest.fields, section).find(field => field.key === node.board?.label)
      const titleInHeader = !!options?.editable && !!options.onTransaction && labelField?.control === 'text'
        && !labelField.readonly && !labelField.hidden && !(node.board?.rejected && values[node.board.rejected] === true)
      const consumed = [node.board?.description, node.board?.badge, node.board?.rejected, ...(titleInHeader ? [node.board?.label] : [])]
      const fields = fieldsForSection(manifest.fields, section).filter(field =>
        section !== node.source || (node.board?.detail_fields ? node.board.detail_fields.includes(field.key) && !(titleInHeader && field.key === node.board.label) : !consumed.includes(field.key)))
      const change = (field: EditorField, value: unknown) => {
        if (!detailOptions?.editable || field.readonly || field.hidden) return
        detailOptions.onEdit?.({ section, record: id, field: field.key, value })
      }
      return createElement(CompactRecordDetails, { fields, values, optional: section !== node.source && node.board?.detail_fields_mode !== 'fixed',
        editable: !!detailOptions?.editable && !!detailOptions.onEdit, change,
        render: field => renderField(field, values, section, id, data, { ...detailOptions, compactFields: true,
          onRecordPatch: patch => {
            if (!detailOptions?.editable || field.readonly || field.hidden) return
            const edits = Object.entries(patch).map(([key, value]) => ({ section, record: id, field: key,
              value: section !== node.source && key === field.key && value && typeof value === 'object' && Object.keys(value).length === 0 ? undefined : value }))
            detailOptions.onTransaction?.(edits, {})
          },
        }),
      })
    } }),
  grouped_records: renderGroupedRecords,
  nested_collection: (node, _manifest, data, options) => renderNestedCollection(node, data, options),
  record_workspace: (node, manifest, data, options) => createElement(RecordWorkspace, { node, manifest, data, options, key: node.id,
    renderHeader: selected => renderRecordForm({ component: 'record_form', id: `${node.id}-header`, source: selected.section }, manifest, data, options, selected.record, false, [], undefined, undefined, 'header'),
    children: (node.children ?? []).map(child => keyed(renderNode(child, manifest, data, options), child.id)) }),
  record_inspector: (node, manifest, data, options) => createElement(RecordInspector, { node, manifest, data, options,
    render: (selected, headerAccessory, headerOutside) => {
      // Explicit same-record projections share one selection and the original
      // section edit bindings; no flattened copy or second data authority.
      const selectedPath = sectionBindingOf(manifest, selected.section).recordsPath
      const sources = node.sources?.filter(source => sectionBindingOf(manifest, source).recordsPath === selectedPath)
      const views = sources?.length ? sources : [selected.section]
      if (node.record_cards) return renderReadingCards(node, views, [selected.record], manifest, data, options)
      const forms = views.map((source, index) => keyed(
        renderRecordForm({ component: 'record_form', id: `${node.id}-${source}`, source }, manifest, data, options, selected.record, index > 0 || headerOutside === true, [], undefined, index === 0 ? headerAccessory : undefined), source))
      return forms.length === 1 ? forms[0]! : createElement('div', { className: 'dsh-record-inspector-views' }, ...forms)
    },
    children: (node.children ?? []).map(child => keyed(renderNode(child, manifest, data, options), child.id)) }),
  math_document: (node, manifest, data, options) => createElement(RecordInspector, { node, manifest, data, options, render: selection => {
    if (selection.section !== node.source) return renderRecordForm({ component: 'record_form', id: node.id, source: selection.section }, manifest, data, options, selection.record)
    const binding = sectionBindingOf(manifest, selection.section)
    const record = fieldValuesOf(recordsAtPath(data, binding.recordsPath)[selection.record] ?? {}, binding.fieldsPath)
    return createElement(MathDocument, { key: `${selection.section}/${selection.record}`, node, manifest, value: record,
      editable: options?.editable === true && !!options.onEdit,
      collapseToken: options?.collapseToken,
      artifactContext: options,
      onChange: (field, value) => { if (options?.editable && !field.readonly && !field.hidden) options.onEdit?.({ section: selection.section, record: selection.record, field: field.key, value }) },
      renderField: field => renderField(field, record, selection.section, selection.record, data, options),
    })
  } }),
  record_preview: (node, manifest, data, options) => createElement(RecordPreview, { node, manifest, data, options }),
  record_related_editor: (node, manifest, data, options) => createElement(RecordRelatedEditor, { node, manifest, data, options,
    render: (ids, readonly = false) => {
      const editOptions = readonly ? { ...options, editable: false, onEdit: undefined, onPanelUpdate: undefined, onTransaction: undefined } : options
      const views = node.sources ?? [node.source!]
      if (node.record_table) return renderRecordForm({ ...node, component: 'record_form' }, manifest, data, editOptions, ids, false, [],
        node.sources?.some(source => source !== node.source) ? id => createElement('div', null, ...views.filter(source => source !== node.source).map(source => keyed(renderRecordForm({ component: 'record_form', id: `${node.id}-${source}`, source }, manifest, data, editOptions, id), source))) : undefined)
      if (node.record_cards) return renderReadingCards(node, views, ids, manifest, data, editOptions)
      const forms = views.map((source, index) => keyed(
        renderRecordForm({ component: 'record_form', id: `${node.id}-${source}`, source }, manifest, data, editOptions, ids, index > 0), source))
      return forms.length === 1 ? forms[0]! : createElement('div', { className: 'dsh-record-inspector-views' }, ...forms)
    } }),
  relation_graph: (node, manifest, data, options) => createElement(RelationGraph, { node, manifest, data, options }),
  reference_graph: (node, manifest, data, options) => createElement(ReferenceGraph, { node, manifest, data, options }),
  data_table: (node, manifest, data, options) => createElement(RecordInspector, { node, manifest, data, options, render: selection => {
    if (selection.section !== node.source) return createElement('p', null, panelText('matrixSelectRecord', options?.locale))
    const binding = sectionBindingOf(manifest, selection.section)
    const record = fieldValuesOf(recordsAtPath(data, binding.recordsPath)[selection.record] ?? {}, binding.fieldsPath)
    const field = manifest.fields.find(field => field.key === node.table?.field && field.applies_to?.includes(selection.section))
    return field ? renderField(field, record, selection.section, selection.record, data, options) : createElement('p', null, panelText('matrixSelectRecord', options?.locale))
  } }),
  record_matrix: (node, manifest, data, options) => createElement(RecordMatrix, { node, manifest, data, options }),
  record_artifact: (node, manifest, data, options) => createElement(RecordArtifact, { node, manifest, data, options }),
  question_list: renderQuestionList,
  question_workspace: renderQuestionWorkspace,
  stack: (node, manifest, data, options) => createElement('div', { className: 'dsh-design-stack' },
    (node.children ?? []).map(child => keyed(renderNode(child, manifest, data, options), child.id))),
  tabs: (node, manifest, data, options) => createElement(ComponentTabs, { node,
    render: child => renderNode(child, manifest, data, options) }),
  panel_workspace: (node, manifest, data, options) => {
    const main = node.slots?.main
    const content = main ? keyed(renderNode(main, manifest, data, options), 'main') : null
    return createElement(PanelWorkspace, {
      guidance: node.guidance,
      sidebar: node.slots?.sidebar ? keyed(renderNode(node.slots.sidebar, manifest, data, options), 'sidebar') : null,
    }, main && declarativePanelOwnsWorkspace({ ...manifest, ui: main }) ? content
      : createElement('div', { className: 'dsh-panel-workspace-content' }, content))
  },
  relation_matrix: renderRelationMatrix,
  mind_map: renderMindMap,
  bpmn_canvas: renderBpmnCanvas,
  related_records: renderRelatedRecords,
  question_rounds: renderQuestionRounds,
  lifecycle_canvas: renderLifecycleCanvas,
  doc_lifecycle_studio: renderDocLifecycleStudio,
  rowview_workbench: renderRowViewWorkbench,
})


/**
 * Project state into logical section data: every declared section id maps to
 * the records at its records_path (nested storage included), while top-level
 * keys (residue envelope, scalars) pass through untouched.
 * @param manifest - the panel manifest declaring the sections.
 * @param data - the raw draft state.
 * @returns section-addressable render data.
 */
function logicalSectionData(manifest: PanelManifest, data: DesignData): DesignData {
  const logical: Record<string, Record<string, Record<string, unknown>>> = {
    ...(data as unknown as Record<string, Record<string, Record<string, unknown>>>),
  }
  for (const section of manifest.sections) {
    const recordsPath = sectionBindingOf(manifest, section.id).recordsPath
    // Direct canonical collections retain absence semantics. In particular,
    // an unedited derived layout is not the same as a saved empty collection.
    // Nested storage still receives its logical section alias as before.
    if (recordsPath === section.id && !Object.hasOwn(data, section.id)) continue
    logical[section.id] = recordsAtPath(data, recordsPath)
  }
  return logical
}

/**
 * Render a complete panel manifest.
 * @param manifest - a validated panel manifest.
 * @param data - Design Files projected by section.
 * @returns the panel element tree.
 */
export function renderManifest(manifest: PanelManifest, data: DesignData, options?: RenderOptions): ReactElement {
  manifest = localizePanelManifest(manifest, options?.locale)
  const logical = logicalSectionData(manifest, data)
  return createElement(PanelLocaleContext.Provider, { value: options?.locale ?? 'zh-CN' }, createElement(
    'div',
    { className: 'dsh-design-panel', 'data-panel-kind': manifest.panel_kind, 'data-layout': declarativePanelOwnsWorkspace(manifest) ? 'workspace' : 'document' },
    renderNode(manifest.ui, manifest, logical, { ...options, canonicalData: data }),
  ))
}
