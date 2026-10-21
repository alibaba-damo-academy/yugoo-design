/**
 * Phase 3 smoke: render panel manifests + sample Design Files data to static
 * markup through the interpreter. Web App Bundles are native and ship no
 * panel.yaml, so the manifests are inline. Run (from packages/panel):
 *   node smoke-render.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { parsePanelManifest, renderManifest } from './lib/index.js'

// record_tree grouped by an epic-style parent field (function_modules shape).
const fmManifest = parsePanelManifest([
  'version: 1',
  'panel_kind: capability_map',
  'sections:',
  '  - { id: functions, title: 功能模块 }',
  'fields:',
  '  - { key: function_name, control: text, label: 功能名, applies_to: [functions] }',
  '  - { key: function_epic, control: text, label: Epic 分组, applies_to: [functions] }',
  '  - key: priority',
  '    control: radio',
  '    label: 优先级',
  '    applies_to: [functions]',
  '    options:',
  '      - { value: High, label: 高 }',
  '      - { value: Medium, label: 中 }',
  'ui:',
  '  component: record_tree',
  '  id: functions-view',
  '  source: functions',
  '  row_group:',
  '    source: functions',
  '    parent_field: function_epic',
].join('\n'))
const fmHtml = renderToStaticMarkup(renderManifest(fmManifest, {
  functions: {
    'F-001': { function_name: '记账录入', function_epic: '账本管理', priority: 'High' },
    'F-002': { function_name: '账目浏览', function_epic: '账本管理', priority: 'Medium' },
  },
}))
if (!fmHtml.includes('记账录入')) throw new Error('record_tree missing record label')
if (!fmHtml.includes('账本管理')) throw new Error('record_tree missing epic group')
if (!fmHtml.includes('dsh-design-record-tree')) throw new Error('record_tree component not rendered')
console.log('record_tree row grouping: OK')

// question_rounds (dynamic rounds over a questions collection, smart_questions shape).
const sqManifest = parsePanelManifest([
  'version: 1',
  'panel_kind: evidence_workbook',
  'sections:',
  '  - { id: questions, title: 问题 }',
  'fields:',
  '  - { key: prompt, control: textarea, label: 问题, applies_to: [questions] }',
  '  - { key: answer, control: text, label: 回答, applies_to: [questions] }',
  'ui:',
  '  component: question_rounds',
  '  id: questions-view',
  '  source: questions',
].join('\n'))
const sqHtml = renderToStaticMarkup(renderManifest(sqManifest, {
  questions: { q1: { prompt: '是否需要注册登录？', answer: 'anonymous' } },
}))
if (!sqHtml.includes('是否需要注册登录？')) throw new Error('question_rounds missing prompt')
if (!sqHtml.includes('dsh-design-question-rounds')) throw new Error('question_rounds component not rendered')
console.log('question_rounds: OK')

// split(record_nav | record_form) over canonical processes (flow_design shape).
const fdManifest = parsePanelManifest([
  'version: 1',
  'panel_kind: process',
  'sections:',
  '  - { id: processes, title: 流程 }',
  'fields:',
  '  - { key: title, control: text, label: 名称, applies_to: [processes] }',
  '  - { key: description, control: textarea, label: 描述, applies_to: [processes] }',
  'ui:',
  '  component: split',
  '  id: root',
  '  slots:',
  '    sidebar: { component: record_nav, id: process-nav, source: processes }',
  '    main: { component: record_form, id: process-form, source: processes }',
].join('\n'))
const fdHtml = renderToStaticMarkup(renderManifest(fdManifest, {
  processes: {
    'P-001': { title: '订单下单', description: '用户选择商品并完成支付。', tier: 'core' },
  },
}))
if (!fdHtml.includes('dsh-design-split')) throw new Error('split layout not rendered')
if (!fdHtml.includes('dsh-design-record-nav')) throw new Error('process nav not rendered')
if (!fdHtml.includes('订单下单')) throw new Error('process title missing')
console.log('split nav/form: OK')

// bpmn_canvas bidirectional editing stays covered via an inline manifest: the
// migrated flow_design kit renders BPMN through the dedicated bpmn-js
// component (M3), so the DSL canvas is exercised standalone here.
const bpmnManifest = parsePanelManifest([
  'version: 1',
  'panel_kind: process',
  'sections:',
  '  - { id: processes, title: Processes }',
  'fields:',
  '  - { key: name, control: text, applies_to: [processes] }',
  'ui:',
  '  component: bpmn_canvas',
  '  id: bpmn-view',
  '  source: processes',
].join('\n'))
const bpmnHtml = renderToStaticMarkup(renderManifest(bpmnManifest, {
  processes: {
    'P-001': { name: '订单下单', steps: [{ name: '选择商品' }, { name: '确认订单' }, { name: '支付' }] },
  },
}))
if (!bpmnHtml.includes('dsh-design-bpmn-canvas')) throw new Error('bpmn_canvas not rendered')
if (!bpmnHtml.includes('dsh-design-bpmn-step')) throw new Error('bpmn_canvas missing steps')
if (!bpmnHtml.includes('支付')) throw new Error('bpmn_canvas missing step content')
if (!bpmnHtml.includes('dsh-design-bpmn-task')) throw new Error('bpmn_canvas missing kind shape class')
console.log('bpmn_canvas flow: OK')

// editable bpmn_canvas: steps render as edit rows (name input + kind select + move/remove), plus add-step
const fdEditHtml = renderToStaticMarkup(renderManifest(bpmnManifest, {
  processes: {
    'P-001': { name: '订单下单', steps: [{ name: '选择商品', kind: 'task' }, { name: '是否会员？', kind: 'gateway' }] },
  },
}, { editable: true, onEdit: () => {} }))
if (!fdEditHtml.includes('dsh-design-bpmn-step-row')) throw new Error('editable bpmn_canvas missing step rows')
if (!fdEditHtml.includes('dsh-design-bpmn-step-kind')) throw new Error('editable bpmn_canvas missing kind select')
if (!fdEditHtml.includes('dsh-design-bpmn-add-step')) throw new Error('editable bpmn_canvas missing add-step button')
if (!fdEditHtml.includes('dsh-design-bpmn-process-name-input')) throw new Error('editable bpmn_canvas missing process name input')
console.log('editable bpmn_canvas: OK')

// relation_matrix rich component (role x permission matrix)
const matrixManifest = parsePanelManifest([
  'version: 1',
  'panel_kind: evidence_workbook',
  'sections:',
  '  - { id: roles, title: Roles }',
  'fields:',
  '  - { key: name, control: text, applies_to: [roles] }',
  'ui:',
  '  component: relation_matrix',
  '  id: role-matrix',
  '  source: roles',
  '  matrix_dimensions:',
  '    - { field: can_create, label: 可创建 }',
  '    - { field: can_approve, label: 可审批 }',
].join('\n'))
const matrixHtml = renderToStaticMarkup(renderManifest(matrixManifest, {
  roles: {
    accountant: { name: '会计', can_create: '是', can_approve: '是' },
    manager: { name: '财务经理', can_create: '否', can_approve: '是' },
  },
}))
if (!matrixHtml.includes('dsh-design-relation-matrix')) throw new Error('relation_matrix not rendered')
if (!matrixHtml.includes('可创建') || !matrixHtml.includes('财务经理')) throw new Error('matrix missing headers/rows')
console.log('relation_matrix rich component: OK')

// mind_map rich component (nested hierarchy via parent_field)
const mindManifest = parsePanelManifest([
  'version: 1',
  'panel_kind: capability_map',
  'sections:',
  '  - { id: nodes, title: Nodes }',
  'fields:',
  '  - { key: name, control: text, applies_to: [nodes] }',
  'ui:',
  '  component: mind_map',
  '  id: node-map',
  '  source: nodes',
  '  parent_field: parent',
].join('\n'))
const mindHtml = renderToStaticMarkup(renderManifest(mindManifest, {
  nodes: {
    root: { name: '产品' },
    auth: { name: '认证', parent: 'root' },
    login: { name: '登录', parent: 'auth' },
  },
}))
if (!mindHtml.includes('dsh-design-mind-map')) throw new Error('mind_map not rendered')
if (!mindHtml.includes('dsh-design-mind-map-children')) throw new Error('mind_map missing nested children')
if (!mindHtml.includes('登录')) throw new Error('mind_map missing leaf node')
console.log('mind_map rich component: OK')

// editable mode: record_form fields render as inputs (edit round-trip foundation)
const editManifest = parsePanelManifest([
  'version: 1',
  'panel_kind: evidence_workbook',
  'sections:',
  '  - { id: items, title: Items }',
  'fields:',
  '  - { key: name, control: text, applies_to: [items] }',
  'ui:',
  '  component: record_form',
  '  id: items-form',
  '  source: items',
].join('\n'))
let capturedEdit = null
const editHtml = renderToStaticMarkup(renderManifest(editManifest, {
  items: { i1: { name: '登录' } },
}, { editable: true, onEdit: (edit) => { capturedEdit = edit } }))
if (!editHtml.includes('dsh-design-field-input')) throw new Error('editable mode did not render inputs')
console.log('editable record_form renders inputs: OK')

console.log('RENDER OK')
