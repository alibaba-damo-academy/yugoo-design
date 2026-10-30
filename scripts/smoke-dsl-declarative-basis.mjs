/**
 * Declarative basis smoke (domain-neutral fixtures): upstream completeness
 * gate (14 components + 14 controls), rowview_workbench residue envelope
 * (sync aggregation + stale degradation + add-region lifecycle),
 * doc_lifecycle_studio fact table + view availability, nested rows inside
 * residue rows, and a save/restore round trip through the edit callbacks.
 * Run: node scripts/smoke-dsl-declarative-basis.mjs (after `pnpm run build`).
 */
import {
  COMPONENT_KINDS,
  CONTROL_KINDS,
  applyPanelUpdatesToDraft,
  parsePanelManifest,
  renderManifest,
  validatePanelManifest,
} from '../packages/panel/lib/index.js'

// --- Completeness gate: upstream pilot-design/v2 allowlist -----------------
const UPSTREAM_COMPONENTS = [
  'tabs', 'stack', 'record_form',
  'related_records', 'question_list', 'question_rounds', 'relation_matrix',
  'mind_map', 'bpmn_canvas', 'doc_lifecycle_studio', 'rowview_workbench',
]
const UPSTREAM_CONTROLS = [
  'text', 'textarea', 'number', 'select', 'radio', 'list', 'multi_select',
  'record_select', 'record_multi_select', 'source_list', 'artifact_ref',
  'key_value', 'toggle', 'rows',
]
for (const kind of UPSTREAM_COMPONENTS) {
  if (!COMPONENT_KINDS.includes(kind)) throw new Error(`completeness gate: component "${kind}" missing from closed set`)
}
for (const control of UPSTREAM_CONTROLS) {
  if (!CONTROL_KINDS.includes(control)) throw new Error(`completeness gate: control "${control}" missing from closed set`)
}
console.log('completeness gate: 14 components + 14 controls present')

// --- Element-tree helpers ----------------------------------------------------
function* walk(node) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return }
  if (typeof node === 'object' && 'type' in node && 'props' in node) {
    yield node
    yield* walk(node.props.children)
  }
}
const elements = (root) => [...walk(root)]
const collectText = (node) => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (node !== null && typeof node === 'object' && 'props' in node) return collectText(node.props.children)
  return ''
}
const byTestId = (root, id) => elements(root).filter((el) => el.props['data-testid'] === id)

// --- rowview_workbench: residue envelope -------------------------------------
const workbenchYaml = [
  'version: 1',
  'panel_kind: evidence_workbook',
  'sections:',
  '  - id: enhancements',
  '    title: 增强项',
  '    item_name: 增强',
  '    records_path: add.enhancements.records',
  '    fields_path: details',
  '    order: add.enhancements.record_order',
  'fields:',
  '  - key: kind',
  '    control: select',
  '    label: 类型',
  '    applies_to: [enhancements]',
  '    options:',
  '      - { value: param, label: 参数 }',
  '      - { value: sub, label: 子结构 }',
  '  - key: note',
  '    control: textarea',
  '    label: 说明',
  '    applies_to: [enhancements]',
  '    visible_when: { field: kind, in: [sub] }',
  '  - key: parts',
  '    control: rows',
  '    label: 子项',
  '    applies_to: [enhancements]',
  '    columns:',
  '      - { key: name, control: text, label: 名称 }',
  'ui:',
  '  component: rowview_workbench',
  '  id: bench',
  '  source: enhancements',
  '  title: 模块增强',
].join('\n')
const workbenchManifest = parsePanelManifest(workbenchYaml)

let workbenchState = {
  module: 'mod-x',
  residue_shape: 'mechanism_param_set',
  sync: {
    refs: [
      { concern: 'rules_panel', record_ref: 'R-1', projection: { title: '规则甲', summary: '摘要', status: '生效' } },
      { concern: 'rules_panel', record_ref: 'R-2', projection: {} },
      { concern: 'output_panel', record_ref: 'O-1' },
    ],
  },
  add: {
    enhancements: {
      id: 'enhancements',
      title: '增强项',
      records: {
        'e-1': { id: 'e-1', title: '增强一', summary: '概要', details: { kind: 'sub', parts: [{ name: '子项甲' }] } },
      },
      record_order: ['e-1'],
    },
  },
  add_order: ['enhancements'],
}

const panelUpdates = []
const workbenchRendered = renderManifest(workbenchManifest, workbenchState, {
  editable: true,
  onPanelUpdate: (updates) => { panelUpdates.push(updates) },
})

// Sync region: grouped refs, stale degradation, no silent drop.
if (byTestId(workbenchRendered, 'rowview-sync-region').length !== 1) throw new Error('workbench: sync region missing')
if (byTestId(workbenchRendered, 'sync-ref-row').length !== 1) throw new Error('workbench: expected 1 valid sync ref row')
const staleRows = byTestId(workbenchRendered, 'sync-ref-stale')
if (staleRows.length !== 2) throw new Error(`workbench: expected 2 stale refs, got ${staleRows.length}`)
const syncText = collectText(workbenchRendered)
if (!syncText.includes('规则甲') || !syncText.includes('生效')) throw new Error('workbench: projection title/status missing')
if (!syncText.includes('已失效引用：R-2') || !syncText.includes('已失效引用：O-1')) throw new Error('workbench: stale refs must show record_ref')
if (byTestId(workbenchRendered, 'sync-concern-jump-rules_panel').length !== 1) throw new Error('workbench: concern group label missing')

// Add region: record row, manifest fields on details, visible_when gate, nested rows.
if (byTestId(workbenchRendered, 'rowview-record-e-1').length !== 1) throw new Error('workbench: residue record row missing')
const detailInputs = elements(workbenchRendered).filter((el) => el.type === 'textarea')
if (detailInputs.length !== 1) throw new Error(`workbench: visible_when gate failed (expected 1 textarea for kind=sub), got ${detailInputs.length}`)
const nestedRowInput = elements(workbenchRendered).find((el) => el.type === 'input' && el.props.value === '子项甲')
if (nestedRowInput === undefined) throw new Error('workbench: nested rows control did not render row cell')

// Lifecycle: add record -> panel update carries new record + order (path-keyed).
const addBtn = elements(workbenchRendered).find((el) => el.type === 'button' && typeof el.props.children === 'string' && el.props.children.includes('添加增强'))
if (addBtn === undefined) throw new Error('workbench: add button missing')
addBtn.props.onClick()
const addUpdate = panelUpdates.at(-1)
const addedRecords = addUpdate?.['add.enhancements.records'] ?? {}
if (Object.keys(addedRecords).length !== 2) throw new Error('workbench: add did not emit a second record')
if (!addUpdate['add.enhancements.record_order'].includes('e-1')) throw new Error('workbench: record_order missing in update')

// Lifecycle: details field edit -> panel update rewrites the record details.
panelUpdates.length = 0
detailInputs[0].props.onChange({ target: { value: '改造说明' } })
const editUpdate = panelUpdates.at(-1)
if (editUpdate?.['add.enhancements.records']['e-1'].details.note !== '改造说明') throw new Error('workbench: details edit not persisted through panel update')

// Lifecycle: remove record.
panelUpdates.length = 0
const removeBtn = elements(workbenchRendered).find((el) => el.type === 'button' && typeof el.props.children === 'string' && el.props.children.startsWith('删除'))
if (removeBtn === undefined) throw new Error('workbench: remove button missing')
removeBtn.props.onClick()
if (Object.keys(panelUpdates.at(-1)?.['add.enhancements.records'] ?? { x: 1 }).length !== 0) throw new Error('workbench: remove did not clear the record')

// Save/restore round trip: apply updates through the shared pure helper
// (dotted storage paths), re-render, data persists.
let restored = workbenchState
for (const update of panelUpdates) restored = applyPanelUpdatesToDraft(restored, update)
const restoredRendered = renderManifest(workbenchManifest, restored, { editable: true, onPanelUpdate: () => {} })
if (byTestId(restoredRendered, 'rowview-record-e-1').length !== 0) throw new Error('restore: removed record reappeared')
console.log('rowview_workbench: sync/stale/add/edit/remove/save-restore OK')

// --- doc_lifecycle_studio ----------------------------------------------------
const studioYaml = [
  'version: 1',
  'panel_kind: lifecycle',
  'sections:',
  '  - { id: objects, title: 单据 }',
  '  - { id: axes, title: 状态轴 }',
  '  - { id: actions, title: 动作 }',
  'fields: []',
  'ui:',
  '  component: doc_lifecycle_studio',
  '  id: studio',
  '  title: 单据生命周期',
  '  bindings:',
  '    object_ref: object_ref',
  '    process_node_ref: process_node_ref',
  '    axis_effects: axis_effects',
  '    movement_sign: move_sign',
  '    movement_qty: move_qty',
].join('\n')
const studioManifest = parsePanelManifest(studioYaml)
const studioData = {
  module: 'doc-mod',
  residue_shape: 'substructure_recordset',
  objects: {
    'obj-1': { title: '采购订单', details: { object_ref: 'obj-0', move_sign: '+', move_qty: '按单' } },
    'obj-2': { title: '入库单', details: { move_sign: '-' } },
  },
  axes: {
    'ax-1': { title: '草稿' },
    'ax-2': { title: '生效' },
  },
  actions: {
    'act-1': { title: '提交审批', details: { axis_effects: { 'ax-1': '→草稿', 'ax-2': '→生效' }, process_node_ref: 'proc-1:Task_1' } },
    'act-2': { title: '撤回', details: {} },
  },
}
const studioEdits = []
const studioRendered = renderManifest(studioManifest, studioData, {
  editable: true,
  onEdit: (edit) => { studioEdits.push(edit) },
})

if (byTestId(studioRendered, 'doc-lifecycle-studio').length !== 1) throw new Error('studio: root missing')
if (!collectText(studioRendered).includes('doc-mod')) throw new Error('studio: meta chip missing')
// Matrix: action rows × axis columns, effect cells editable.
const matrix = byTestId(studioRendered, 'studio-matrix')
if (matrix.length !== 1) throw new Error('studio: matrix missing')
const effectInput = elements(studioRendered).find((el) => el.type === 'input' && el.props.defaultValue === '→生效')
if (effectInput === undefined) throw new Error('studio: effect cell missing')
effectInput.props.onChange({ target: { value: '→作废' } })
const effectEdit = studioEdits.at(-1)
if (effectEdit?.section !== 'actions' || effectEdit.field !== 'axis_effects' || effectEdit.value['ax-2'] !== '→作废') throw new Error('studio: effect edit wrong shape')
// Empty value deletes the axis key.
effectInput.props.onChange({ target: { value: '' } })
if ('ax-2' in studioEdits.at(-1).value) throw new Error('studio: empty cell must drop the axis key')
// Axis rename.
const axisInput = elements(studioRendered).find((el) => el.type === 'input' && el.props.defaultValue === '草稿')
if (axisInput === undefined) throw new Error('studio: axis title input missing')
axisInput.props.onChange({ target: { value: '拟定' } })
const axisEdit = studioEdits.at(-1)
if (axisEdit?.section !== 'axes' || axisEdit.field !== 'title' || axisEdit.value !== '拟定') throw new Error('studio: axis rename wrong')
// Process view: only actions with a node ref.
const processList = byTestId(studioRendered, 'studio-process')
if (processList.length !== 1) throw new Error('studio: process view missing')
const processText = collectText(processList[0])
if (!processText.includes('提交审批 → proc-1:Task_1') || processText.includes('撤回')) throw new Error('studio: process view content wrong')
// Derivations: objects with object_ref.
const derivations = byTestId(studioRendered, 'studio-derivations')
if (derivations.length !== 1 || !collectText(derivations[0]).includes('采购订单 → obj-0')) throw new Error('studio: derivations wrong')
// Ledger: sign-bound objects with direction + qty edit.
const ledger = byTestId(studioRendered, 'studio-ledger')
if (ledger.length !== 1) throw new Error('studio: ledger missing')
const ledgerText = collectText(ledger[0])
if (!ledgerText.includes('入库（+）') || !ledgerText.includes('出库（−）')) throw new Error('studio: ledger directions wrong')
const qtyInput = elements(studioRendered).find((el) => el.type === 'input' && el.props.defaultValue === '按单')
qtyInput.props.onChange({ target: { value: '按批' } })
const qtyEdit = studioEdits.at(-1)
if (qtyEdit?.section !== 'objects' || qtyEdit.field !== 'move_qty' || qtyEdit.value !== '按批') throw new Error('studio: qty edit wrong')

// View availability: without movement_sign binding the ledger degrades, never hides.
const noLedgerManifest = parsePanelManifest(studioYaml.replace('    movement_sign: move_sign\n', '').replace('    movement_qty: move_qty\n', ''))
const noLedgerRendered = renderManifest(noLedgerManifest, studioData, { editable: true })
if (byTestId(noLedgerRendered, 'studio-ledger-missing').length !== 1) throw new Error('studio: unavailable ledger must render a reason')
// Manifest validation: studio requires objects/axes/actions sections.
const missingSections = validatePanelManifest({
  version: 1, panel_kind: 'lifecycle', sections: [{ id: 'objects', title: 'O' }], fields: [],
  ui: { component: 'doc_lifecycle_studio', id: 's' },
})
if (!missingSections.some((error) => error.includes('requires section "axes"'))) throw new Error('studio: missing-section validation failed')
// A workbench without a declared source section is rejected (fail loud).
const workbenchNoSource = validatePanelManifest({
  version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'enhancements', title: 'E' }], fields: [],
  ui: { component: 'rowview_workbench', id: 'bench' },
})
if (!workbenchNoSource.some((error) => error.includes('rowview_workbench requires a source'))) throw new Error('workbench: missing source must be rejected')
console.log('doc_lifecycle_studio: matrix/axis/process/derivations/ledger/availability OK')

// --- record_form generic lifecycle -------------------------------------------
const lifecycleYaml = [
  'version: 1',
  'panel_kind: evidence_workbook',
  'sections:',
  '  - id: items',
  '    title: 条目',
  '    item_name: 条目',
  '    order: items_order',
  'fields:',
  '  - { key: name, control: text, label: 名称, applies_to: [items] }',
  'ui:',
  '  component: record_form',
  '  id: form',
  '  source: items',
].join('\n')
const lifecycleManifest = parsePanelManifest(lifecycleYaml)
const lifecycleState = { items_order: ['i-1', 'i-2', 'i-3'], items: { 'i-1': { name: '甲' }, 'i-2': { name: '乙' }, 'i-3': { name: '丙' } } }
const lifecycleUpdates = []
const renderedLifecycle = renderManifest(lifecycleManifest, lifecycleState, {
  editable: true,
  onPanelUpdate: (updates) => { lifecycleUpdates.push(updates) },
})

// Add: whole-section rewrite with one more record.
byTestId(renderedLifecycle, 'record-add-items')[0].props.onClick()
const addLifecycle = lifecycleUpdates.at(-1)
if (addLifecycle?.items === undefined || Object.keys(addLifecycle.items).length !== 4) throw new Error('record lifecycle: add did not rewrite the section with 4 records')

// Remove: middle record gone, siblings kept.
lifecycleUpdates.length = 0
byTestId(renderedLifecycle, 'record-remove-i-2')[0].props.onClick()
const removeLifecycle = lifecycleUpdates.at(-1)
if ('i-2' in removeLifecycle.items || Object.keys(removeLifecycle.items).length !== 2) throw new Error('record lifecycle: remove wrong')

// Reorder: move the first record down (the order array is the durable truth).
lifecycleUpdates.length = 0
byTestId(renderedLifecycle, 'record-down-i-1')[0].props.onClick()
const reorderLifecycle = lifecycleUpdates.at(-1)
if (reorderLifecycle.items_order.join(',') !== 'i-2,i-1,i-3') throw new Error(`record lifecycle: reorder wrong (${reorderLifecycle.items_order})`)

// Boundary: moving the first record up emits nothing.
lifecycleUpdates.length = 0
byTestId(renderedLifecycle, 'record-up-i-1')[0].props.onClick()
if (lifecycleUpdates.length !== 0) throw new Error('record lifecycle: boundary move must not emit')

// Save/restore: applying the reorder and re-rendering keeps the new order.
const reorderedState = { ...lifecycleState, ...reorderLifecycle }
const reorderedRendered = renderManifest(lifecycleManifest, reorderedState, { editable: true, onPanelUpdate: () => {} })
const recordOrder = elements(reorderedRendered)
  .filter((el) => el.props.className === 'dsh-design-record')
  .map((el) => el.props['data-record'])
if (recordOrder.join(',') !== 'i-2,i-1,i-3') throw new Error('record lifecycle: restored order wrong')

// Read-only mode renders no lifecycle affordances.
const readonlyLifecycle = renderManifest(lifecycleManifest, lifecycleState, {})
if (byTestId(readonlyLifecycle, 'record-add-items').length !== 0) throw new Error('record lifecycle: add rendered read-only')
if (byTestId(readonlyLifecycle, 'record-remove-i-1').length !== 0) throw new Error('record lifecycle: remove rendered read-only')

// Without a declared order path, move controls do not render.
const noOrderManifest = parsePanelManifest(lifecycleYaml.replace('    order: items_order\n', ''))
const noOrderRendered = renderManifest(noOrderManifest, lifecycleState, {
  editable: true,
  onPanelUpdate: (updates) => { lifecycleUpdates.push(updates) },
})
if (byTestId(noOrderRendered, 'record-down-i-1').length !== 0) throw new Error('record lifecycle: move rendered without order path')
if (byTestId(noOrderRendered, 'record-add-items').length !== 1) throw new Error('record lifecycle: add must render without order path')
console.log('record_form: add/remove/reorder/boundary/save-restore/no-order OK')

// --- Typed control output semantics (schema-compatible) -----------------------
const typedYaml = [
  'version: 1',
  'panel_kind: evidence_workbook',
  'sections:',
  '  - id: items',
  '    title: 条目',
  'fields:',
  '  - { key: count, control: number, label: 数量, applies_to: [items] }',
  '  - { key: tags, control: list, label: 标签, applies_to: [items] }',
  '  - { key: meta, control: key_value, label: 元信息, applies_to: [items] }',
  '  - { key: doc, control: artifact_ref, label: 产物, applies_to: [items] }',
  'ui:',
  '  component: record_form',
  '  id: form',
  '  source: items',
].join('\n')
const typedManifest = parsePanelManifest(typedYaml)
const typedState = { items: { 'i-1': { count: 3, tags: ['a', 'b'], meta: { 甲: '1' }, doc: 'design_files/x/report.md' } } }
const typedEdits = []
const typedRendered = renderManifest(typedManifest, typedState, {
  editable: true,
  onEdit: (edit) => { typedEdits.push(edit) },
})

// number: finite parse writes Number; empty/unparseable clears the property.
const numberInput = elements(typedRendered).find((el) => el.type === 'input' && el.props.type === 'number')
if (numberInput === undefined) throw new Error('typed: number input missing')
numberInput.props.onChange({ target: { value: '42' } })
if (typedEdits.at(-1).value !== 42) throw new Error('typed: number must emit finite Number')
numberInput.props.onChange({ target: { value: '' } })
if (typedEdits.at(-1).value !== undefined) throw new Error('typed: empty number must emit undefined (property omission)')
numberInput.props.onChange({ target: { value: 'abc' } })
if (typedEdits.at(-1).value !== undefined) throw new Error('typed: unparseable number must emit undefined, not NaN')

// list: one item per line -> string array.
const listArea = elements(typedRendered).filter((el) => el.type === 'textarea')
if (listArea.length !== 2) throw new Error(`typed: expected list + key_value textareas, got ${listArea.length}`)
listArea[0].props.onChange({ target: { value: 'x\n y \n\nz' } })
const listEdit = typedEdits.at(-1).value
if (!Array.isArray(listEdit) || listEdit.join(',') !== 'x,y,z') throw new Error(`typed: list must emit trimmed string array, got ${JSON.stringify(listEdit)}`)

// key_value: "key: value" lines -> map; keyless lines dropped.
listArea[1].props.onChange({ target: { value: '甲: 1\n乙: 2\nno-key-line' } })
const kvEdit = typedEdits.at(-1).value
if (typeof kvEdit !== 'object' || kvEdit.甲 !== '1' || kvEdit.乙 !== '2' || Object.keys(kvEdit).length !== 2) throw new Error(`typed: key_value must emit a map, got ${JSON.stringify(kvEdit)}`)

// artifact_ref: display-only even in editable mode.
const artifactInputs = elements(typedRendered).filter((el) => (el.type === 'input' || el.type === 'textarea') && (el.props.defaultValue ?? '').includes('report.md'))
if (artifactInputs.length !== 0) throw new Error('typed: artifact_ref must not render an editor')
if (!collectText(typedRendered).includes('已生成 · report.md')) throw new Error('typed: artifact_ref display missing')

// number save/restore round trip.
const typedRestored = { items: { 'i-1': { ...typedState.items['i-1'], count: 42 } } }
const typedRerender = renderManifest(typedManifest, typedRestored, { editable: true, onEdit: () => {} })
const restoredNumber = elements(typedRerender).find((el) => el.type === 'input' && el.props.type === 'number')
if (String(restoredNumber.props.defaultValue) !== '42') throw new Error('typed: number restore round trip failed')
console.log('typed controls: number/list/key_value/artifact_ref semantics OK')

console.log('DECLARATIVE BASIS OK')
