/**
 * DSL expressiveness slice smoke: rows/source_list controls, visible_when
 * gating, option-level `when`, same-section and cross-panel option sources.
 * Asserts on the interpreter's React element tree directly (no DOM needed).
 * Run: node scripts/smoke-dsl-expressiveness.mjs (after `pnpm run build`).
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parsePanelManifest, renderManifest, validatePanelManifest } from '../packages/panel/lib/index.js'

const yamlText = await readFile(fileURLToPath(new URL('../packages/panel/fixtures/dsl-expressiveness.panel.yaml', import.meta.url)), 'utf8')
const data = JSON.parse(await readFile(fileURLToPath(new URL('../packages/panel/fixtures/dsl-expressiveness.data.json', import.meta.url)), 'utf8'))

const manifest = parsePanelManifest(yamlText)
const issues = validatePanelManifest(manifest)
if (issues.length > 0) throw new Error(`fixture manifest invalid: ${issues.join('; ')}`)

/** Cross-panel source: function_modules panel's functions section. */
const panelData = (panelType, sectionId) =>
  panelType === 'function_modules' && sectionId === 'functions'
    ? { 'fn-9': { function_name: '用户管理' } }
    : {}

/** Depth-first walk over a React element tree (elements, arrays, text). */
function* walk(node) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child)
    return
  }
  if (typeof node === 'object' && 'type' in node && 'props' in node) {
    yield node
    yield* walk(node.props.children)
  }
}

const elements = (root) => [...walk(root)]
const collectText = (node) => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (node !== null && typeof node === 'object' && 'props' in node) {
    return collectText(node.props.children)
  }
  return ''
}

// --- Editable render -------------------------------------------------------
const editable = renderManifest(manifest, data, { editable: true, panelData })
const editableElements = elements(editable)

// visible_when: `detail` renders only for the record whose decision is `adapt`.
const detailFields = editableElements.filter((el) => el.props['data-field'] === 'detail')
if (detailFields.length !== 1) throw new Error(`visible_when: expected 1 detail field, got ${detailFields.length}`)

// Option-level when: `defer` option exists only under decision_scope=optional.
const deferOptions = editableElements.filter((el) => el.type === 'option' && el.props.value === 'defer')
if (deferOptions.length !== 1) throw new Error(`option when: expected 1 defer option, got ${deferOptions.length}`)

// options_from_section: same-panel section records become options.
const editableText = collectText(editable)
if (!editableText.includes('GB/T 1234')) throw new Error('options_from_section: standard record label missing')

// options_from_panel: cross-panel records become options through panelData.
if (!editableText.includes('用户管理')) throw new Error('options_from_panel: cross-panel record label missing')
const noCross = collectText(renderManifest(manifest, data, { editable: true }))
if (noCross.includes('用户管理')) throw new Error('options_from_panel: label leaked without panelData resolver')

// rows control: typed sub-table with add affordance in editable mode.
if (!editableElements.some((el) => el.props.className === 'dsh-design-rows-table')) throw new Error('rows: table missing')
if (!editableElements.some((el) => el.type === 'input' && el.props.value === '拆分模块')) throw new Error('rows: row cell value missing')
if (!editableText.includes('+ 添加步骤')) throw new Error('rows: add button missing (row_name/max_rows)')

// source_list: readable kind-prefixed chips + editable add input.
if (!editableText.includes('标准参考')) throw new Error('source_list: standard ref label missing')
if (!editableText.includes('登录调研 · 调研')) throw new Error('source_list: research ref label missing')
if (!editableText.includes('需求文档.pdf · 上传材料')) throw new Error('source_list: upload ref label missing')
if (!editableElements.some((el) => el.props.className === 'dsh-design-source-add')) throw new Error('source_list: add input missing')

// --- Read-only render ------------------------------------------------------
const readonly = renderManifest(manifest, data, { panelData })
const readonlyElements = elements(readonly)
const readonlyText = collectText(readonly)
if (readonlyElements.some((el) => el.props.className === 'dsh-design-rows-add')) throw new Error('rows: add button rendered read-only')
if (readonlyElements.some((el) => el.props.className === 'dsh-design-source-add')) throw new Error('source_list: add input rendered read-only')
// ref column resolves record ids to labels in read-only cells.
if (!readonlyText.includes('GB/T 1234')) throw new Error('rows ref column: resolved label missing in read-only')

// --- Option dedupe (static wins over same-panel section) --------------------
// Three std-1 options total: standard_ref renders per record (ad-1, ad-2 —
// each deduped from static + section sources) plus the rows ref column.
const stdOptions = editableElements.filter((el) => el.type === 'option' && el.props.value === 'std-1')
if (stdOptions.length !== 3) throw new Error(`dedupe: expected 3 std-1 options across controls, got ${stdOptions.length}`)
if (stdOptions[0].props.children !== '静态标准') throw new Error('dedupe: earlier source (static) must win')

// --- Invalid members disable editing, preserve values ----------------------
const rowA = { title: '甲', kind: 'dev', owner: 'std-1' }
const rowB = { title: '乙', kind: 'test', owner: 'std-1' }
const rowC = { title: '丙', kind: 'dev', owner: 'std-1' }
const corruptData = {
  standards: { 'std-1': { name: 'GB/T 1234' } },
  adaptations: {
    'ad-1': { name: '登录适配', decision: 'adopt', decision_scope: 'mandatory', steps: [rowA, 'corrupt-member', rowC], sources: ['research:调研', 42] },
  },
}
const corrupt = renderManifest(manifest, corruptData, { editable: true, panelData })
const corruptElements = elements(corrupt)
if (!corruptElements.some((el) => typeof el.props.className === 'string' && el.props.className.includes('dsh-design-rows-diagnostic'))) throw new Error('rows: invalid-member diagnostic missing')
if (corruptElements.some((el) => el.props.className === 'dsh-design-rows-add')) throw new Error('rows: add button rendered despite invalid member')
if (corruptElements.some((el) => el.type === 'button' && el.props.title === '删除步骤')) throw new Error('rows: delete buttons rendered despite invalid member')
if (!collectText(corrupt).includes('无效行数据')) throw new Error('rows: preserved invalid row marker missing')
if (!corruptElements.some((el) => typeof el.props.className === 'string' && el.props.className.includes('dsh-design-source-diagnostic'))) throw new Error('source_list: invalid-member diagnostic missing')
if (corruptElements.some((el) => el.props.className === 'dsh-design-source-add')) throw new Error('source_list: add input rendered despite invalid member')
// Raw value survives: emit nothing, re-read the same data.
if (corruptData.adaptations['ad-1'].steps.length !== 3) throw new Error('rows: raw value not preserved')

// --- multi_select array round-trip ------------------------------------------
const multiEdits = []
const multiRendered = renderManifest(manifest, data, { editable: true, panelData, onEdit: (edit) => { multiEdits.push(edit) } })
const t2Checkbox = elements(multiRendered).find((el) => el.type === 'input' && el.props.type === 'checkbox' && el.props.checked === false)
if (t2Checkbox === undefined) throw new Error('multi_select: unchecked checkbox missing')
t2Checkbox.props.onChange({ target: { checked: true } })
const tagsEdit = multiEdits.find((edit) => edit.field === 'tags')
if (tagsEdit === undefined) throw new Error('multi_select: edit not emitted')
if (!Array.isArray(tagsEdit.value) || tagsEdit.value.join(',') !== 't1,t2') throw new Error(`multi_select: expected array round-trip [t1,t2], got ${JSON.stringify(tagsEdit.value)}`)

// --- WeakMap row keys survive a middle-row delete ----------------------------
const rowsData = {
  standards: { 'std-1': { name: 'GB/T 1234' } },
  adaptations: { 'ad-1': { name: '登录适配', decision: 'adopt', decision_scope: 'mandatory', steps: [rowA, rowB, rowC] } },
}
const trKeys = (root) => elements(root).filter((el) => el.type === 'tr' && typeof el.key === 'string' && el.key.startsWith('row-')).map((el) => el.key)
const beforeKeys = trKeys(renderManifest(manifest, rowsData, { editable: true, panelData }))
if (beforeKeys.length !== 3) throw new Error(`rows: expected 3 keyed rows, got ${beforeKeys.length}`)
rowsData.adaptations['ad-1'].steps = [rowA, rowC] // delete middle row B
const afterKeys = trKeys(renderManifest(manifest, rowsData, { editable: true, panelData }))
if (afterKeys.length !== 2) throw new Error(`rows: expected 2 keyed rows after delete, got ${afterKeys.length}`)
if (afterKeys[0] !== beforeKeys[0] || afterKeys[1] !== beforeKeys[2]) throw new Error('rows: surviving row keys changed after middle delete')

// --- Validation failures (fail loud) ---------------------------------------
const base = { version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], ui: { component: 'record_form', id: 'r', source: 'a' } }
const expectError = (fields, needle) => {
  const errors = validatePanelManifest({ ...base, fields })
  if (!errors.some((error) => error.includes(needle))) {
    throw new Error(`expected validation error containing "${needle}", got: ${errors.join('; ')}`)
  }
}
expectError([{ key: 'x', control: 'rows', applies_to: ['a'] }], 'requires columns')
expectError([{ key: 'x', control: 'rows', applies_to: ['a'], columns: { c: {} } }], 'columns must be a list')
expectError([{ key: 'x', control: 'rows', applies_to: ['a'], columns: [{ key: 'c', control: 'text', label: 'C' }, { key: 'c', control: 'text', label: 'C2' }] }], 'duplicates rows column')
expectError([{ key: 'x', control: 'rows', applies_to: ['a'], columns: [{ key: 'c', control: 'date', label: 'C' }] }], 'unknown control')
expectError([{ key: 'x', control: 'rows', applies_to: ['a'], columns: [{ key: 'c', control: 'ref', label: 'C' }] }], 'exactly one of ref_sections or options_from_panel')
expectError([{ key: 'x', control: 'rows', applies_to: ['a'], columns: [{ key: 'c', control: 'ref', label: 'C', ref_sections: ['a'], options_from_panel: { panel_type: 'p', section_id: 's' } }] }], 'exactly one of ref_sections or options_from_panel')
expectError([{ key: 'x', control: 'rows', applies_to: ['a'], columns: [{ key: 'c', control: 'ref', label: 'C', ref_sections: 'a' }] }], 'ref_sections must be a non-empty string list')
expectError([{ key: 'x', control: 'rows', applies_to: ['a'], columns: [{ key: 'c', control: 'ref', label: 'C', ref_sections: [] }] }], 'ref_sections must be a non-empty string list')
expectError([{ key: 'x', control: 'rows', applies_to: ['a'], columns: [{ key: 'c', control: 'ref', label: 'C', ref_sections: ['a'], options_from_panel: null }] }], 'options_from_panel needs non-empty')
expectError([{ key: 'x', control: 'rows', applies_to: ['a'], columns: [{ key: 'c', control: 'select', label: 'C', options: [{ value: 'v', label: 'V' }, { value: 'v', label: 'V2' }] }] }], 'duplicates option value')
expectError([{ key: 'x', control: 'rows', applies_to: ['a'], columns: [{ key: 'c', control: 'text', label: 'C' }], max_rows: 0 }], 'max_rows must be a positive integer')
expectError([{ key: 'x', control: 'rows', applies_to: ['a'], columns: [{ key: 'c', control: 'select', label: 'C', options: [{ value: 'v', label: 'V', when: { field: 'ghost', in: ['y'] } }] }] }], 'when must reference a column of the same rows field')
expectError([{ key: 'x', control: 'text', applies_to: ['a'], visible_when: { field: 'ghost', in: ['y'] } }], 'visible_when must reference a declared field sharing a section')
// Declared but in a different section: unreachable gate.
expectError([{ key: 'x', control: 'text', applies_to: ['a'], visible_when: { field: 'y', in: ['v'] } }, { key: 'y', control: 'text', applies_to: ['b'] }], 'visible_when must reference a declared field sharing a section')
expectError([{ key: 'x', control: 'text', applies_to: ['a'], visible_when: { field: 'x', in: [] } }], 'visible_when.in must be a non-empty string list')
expectError([{ key: 'x', control: 'select', applies_to: ['a'], options_from_section: 'ghost' }], 'options_from_section references unknown section')
expectError([{ key: 'x', control: 'select', applies_to: ['a'], options_from_panel: { panel_type: '', section_id: 's' } }], 'options_from_panel needs non-empty')
expectError([{ key: 'x', control: 'text', applies_to: ['a'] }, { key: 'x', control: 'text', applies_to: ['a'] }], 'duplicate field key')
expectError([{ key: 'x', control: 'select', applies_to: ['a'], options: [{ value: 'v', label: 'V' }, { value: 'v', label: 'V2' }] }], 'duplicates option value')
expectError([{ key: 'x', control: 'select', applies_to: ['a'], options: [{ value: 'v', label: 'V', when: { field: 'ghost', in: ['y'] } }] }], 'when must reference a declared field sharing a section')
expectError([{ key: 'x', control: 'select', applies_to: ['a'], options: 'not-a-list' }], 'options must be a list')
// The validator itself must never throw on malformed shapes.
for (const malformed of [
  { ...base, fields: { not: 'a list' } },
  { ...base, sections: { not: 'a list' }, fields: [] },
  { ...base, fields: [{ key: 'x', control: 'rows', applies_to: ['a'], columns: [{ key: 'c', control: 'ref', label: 'C', ref_sections: { 0: 'a' } }] }] },
  { ...base, fields: [{ key: 'x', control: 'select', applies_to: ['a'], options: [{ value: 'v', label: 'V', when: null }] }] },
  { ...base, fields: [{ key: 'x', control: 'select', applies_to: ['a'], options_from_panel: null }] },
  { ...base, fields: [{ key: 'x', control: 'text', applies_to: ['a'], visible_when: null }] },
]) {
  const errors = validatePanelManifest(malformed)
  if (errors.length === 0) throw new Error('malformed manifest validated empty')
}
// Duplicate section ids fail loud.
const dupSections = validatePanelManifest({ ...base, sections: [{ id: 'a', title: 'A' }, { id: 'a', title: 'A2' }], fields: [] })
if (!dupSections.some((error) => error.includes('duplicate section id'))) throw new Error('duplicate section id not rejected')

// ui tree structural checks never throw on arbitrary YAML.
const expectManifestError = (patch, needle) => {
  const errors = validatePanelManifest({ ...base, fields: [], ...patch })
  if (!errors.some((error) => error.includes(needle))) {
    throw new Error(`expected ui validation error containing "${needle}", got: ${errors.join('; ')}`)
  }
}
expectManifestError({ ui: undefined }, 'missing component node')
expectManifestError({ ui: null }, 'component node must be an object')
expectManifestError({ ui: { component: 'stack', id: 's', children: 'nope' } }, 'children must be a list')
expectManifestError({ ui: { component: 'panel_workspace', id: 's', slots: null } }, 'slots must be an object')
expectManifestError({ ui: { component: 'panel_workspace', id: 's', sources: 'nope' } }, 'sources must be a list')

// A column option `when` may reference a later-declared column (precomputed key set).
const forwardRef = validatePanelManifest({
  ...base,
  fields: [{
    key: 'x', control: 'rows', applies_to: ['a'],
    columns: [
      { key: 'first', control: 'select', label: 'F', options: [{ value: 'v', label: 'V', when: { field: 'second', in: ['y'] } }] },
      { key: 'second', control: 'text', label: 'S' },
    ],
  }],
})
if (forwardRef.length !== 0) throw new Error(`forward column when reference wrongly rejected: ${forwardRef.join('; ')}`)

// --- Row identity survives a cell edit (clone carries the WeakMap key) ------
const editCapture = []
const identityRendered = renderManifest(manifest, rowsData, {
  editable: true,
  panelData,
  onEdit: (edit) => { editCapture.push(edit) },
})
const firstCellInput = elements(identityRendered).find((el) => el.type === 'input' && el.props.value === '甲')
if (firstCellInput === undefined) throw new Error('rows: first cell input missing')
const keysBeforeEdit = trKeys(identityRendered)
firstCellInput.props.onChange({ target: { value: '甲改' } })
const editedRows = editCapture.at(-1)?.value
if (!Array.isArray(editedRows) || editedRows.length !== 2) throw new Error('rows: cell edit did not emit row array')
rowsData.adaptations['ad-1'].steps = editedRows
const keysAfterEdit = trKeys(renderManifest(manifest, rowsData, { editable: true, panelData }))
if (keysAfterEdit[0] !== keysBeforeEdit[0] || keysAfterEdit[1] !== keysBeforeEdit[1]) throw new Error('rows: edited row lost its stable key (clone identity not transferred)')

console.log('DSL expressiveness OK')
