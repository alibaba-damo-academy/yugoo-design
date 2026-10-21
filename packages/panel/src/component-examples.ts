/** Trusted, synthetic interaction examples; not a second component registry. */
import { stringify } from 'yaml'
import { PANEL_COMPONENT_CATALOG, type ComponentKind, type ComponentNode, type PanelManifest } from './dsl.ts'

export type ComponentExampleLocale = 'zh' | 'en'
export interface PanelComponentExample {
  readonly panelYaml: string
  readonly sample: Record<string, unknown>
  readonly artifacts: Readonly<Record<string, string>>
  readonly previewLayout: 'inline' | 'navigation' | 'workspace'
  /** Finite documentation transcript, never a real Host execution reference. */
  readonly logEntries?: readonly { seq: number; timestamp: number; eventType: 'message' | 'search' | 'synthesize'; message: string }[]
}

/** Display names only. Availability and generation permission come from Core. */
const TITLES: Record<ComponentKind, string> = {
  stack: '纵向布局', tabs: '页签布局', split: '双栏布局', panel_workspace: '侧栏工作区',
  text_block: '说明文字', schema_field: '单字段编辑', structured_data: '结构化数据',
  record_nav: '记录导航', record_tree: '结构树', record_form: '记录表单', related_records: '关联记录',
  grouped_records: '分组记录', nested_collection: '嵌套集合', related_artifacts: '关联产物', artifact_gallery: '产物浏览',
  question_list: '问题清单', question_rounds: '轮次导航', question_workspace: '问题工作区',
  relation_matrix: '关系矩阵', mind_map: '思维图', bpmn_canvas: '流程图', lifecycle_canvas: '生命周期图',
  doc_lifecycle_studio: '文档生命周期', rowview_workbench: '行记录工作台',
  record_workspace: '记录工作区', record_board: '记录卡片', document_workspace: '文档工作区',
  execution_log: '运行日志', artifact_workspace: '产物工作区', diagram_workspace: '流程工作区',
  canvas_workspace: '白板工作区', preview_workspace: '效果预览工作区', navigation_workspace: '导航地图',
  record_inspector: '记录详情', record_preview: '记录预览', record_related_editor: '关联记录编辑',
  relation_graph: '关系画布', reference_graph: '引用画布', record_matrix: '记录矩阵', record_artifact: '记录产物',
}

export function panelComponentTitle(kind: ComponentKind, locale: ComponentExampleLocale): string {
  return locale === 'zh' ? TITLES[kind] : kind.split('_').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' ')
}

export function panelComponentCategory(kind: ComponentKind): 'layout' | 'data' | 'workspace' {
  const entry = PANEL_COMPONENT_CATALOG[kind] as { ownsWorkspace?: boolean }
  // Display grouping is not binding or generation permission.
  if (entry.ownsWorkspace) return 'workspace'
  return ['stack', 'tabs', 'split', 'text_block'].includes(kind) ? 'layout' : 'data'
}

/** Return undefined rather than fabricate a working standalone preview. */
export function createPanelComponentExample(kind: ComponentKind, locale: ComponentExampleLocale): PanelComponentExample | undefined {
  const zh = locale === 'zh'
  const text = (chinese: string, english: string) => zh ? chinese : english
  const note: ComponentNode = { id: 'note', component: 'text_block', text: text('这是固定样例，可以切换视图或展开内容；不会修改真实设计。', 'This fixed example supports navigation and expansion without changing a real design.') }
  const field: ComponentNode = { id: 'name', component: 'schema_field', title: text('名称', 'Name'), path: 'name', control: 'text' }
  const form: ComponentNode = { id: 'form', component: 'record_form', source: 'items' }
  const inspector: ComponentNode = { id: 'inspector', component: 'record_inspector' }
  const workspace = (child: ComponentNode): ComponentNode => ({ id: 'workspace', component: 'record_workspace', title: text('记录', 'Records'), sidebar_icon: 'blocks', sources: ['items'], children: [child] })
  const graph: ComponentNode = { id: 'graph', component: 'relation_graph', graph: { nodes: 'items', edges: 'links', source_field: 'from', target_field: 'to', label_field: 'title', edge_kind_field: 'kind' } }
  const question: ComponentNode = { id: 'questions', component: kind, source: 'questions',
    ...(['question_workspace', 'question_rounds'].includes(kind) ? { rounds_source: 'rounds', question_policy: { numbered_rounds: true } } : {}) }
  let ui: ComponentNode
  switch (kind) {
    case 'stack': ui = { id: 'stack', component: kind, children: [note, field] }; break
    case 'tabs': ui = { id: 'tabs', component: kind, children: [{ id: 'edit', component: 'stack', title: text('编辑', 'Edit'), children: [field] }, { id: 'read', component: 'structured_data', title: text('数据', 'Data'), source: 'items' }] }; break
    case 'split': ui = { id: 'split', component: kind, slots: { sidebar: note, main: form } }; break
    case 'panel_workspace': ui = { id: 'panel', component: kind, slots: { sidebar: note, main: form } }; break
    case 'text_block': ui = note; break
    case 'schema_field': ui = field; break
    case 'structured_data': ui = { id: 'data', component: kind, source: 'items' }; break
    case 'record_form': ui = form; break
    case 'grouped_records': ui = { id: 'groups', component: kind, source: 'items', group_by: 'category' }; break
    case 'nested_collection': ui = { id: 'nested', component: kind, source: 'folders', children_field: 'children', label_field: 'title', child_label_field: 'title' }; break
    case 'record_nav': case 'record_tree': ui = { id: 'navigation', component: kind, source: 'items' }; break
    case 'question_list': case 'question_rounds': case 'question_workspace': ui = question; break
    case 'record_workspace': ui = workspace(inspector); break
    case 'record_inspector': ui = workspace(inspector); break
    case 'record_preview': ui = workspace({ id: 'preview', component: kind, source: 'items', preview: { title: 'title', body: 'description', empty: text('请选择一条记录', 'Select a record') } }); break
    case 'relation_graph': ui = { ...workspace(graph), sources: ['items', 'links'], children: [graph, inspector] }; break
    case 'record_board': ui = { id: 'board', component: kind, source: 'items', board: { label: 'title', description: 'description', group: 'category' } }; break
    case 'mind_map': ui = { id: 'map', component: kind, source: 'items' }; break
    case 'artifact_gallery': ui = { id: 'gallery', component: kind, paths: ['example.md'] }; break
    case 'related_artifacts': ui = { id: 'artifacts', component: kind, paths_from: ['items.*.file'] }; break
    case 'document_workspace': ui = { id: 'document', component: kind, document: { path: 'document', allowed_files: ['component_example/document.html'] } }; break
    case 'related_records': ui = { id: 'related', component: kind, source: 'items' }; break
    case 'relation_matrix': ui = { id: 'matrix', component: kind, source: 'items', matrix_dimensions: [{ field: 'category', label: text('分组', 'Group') }, { field: 'description', label: text('说明', 'Description') }] }; break
    case 'bpmn_canvas': ui = { id: 'process', component: kind, source: 'items' }; break
    case 'lifecycle_canvas': ui = { id: 'lifecycle', component: kind, source: 'items' }; break
    case 'doc_lifecycle_studio': ui = { id: 'lifecycle', component: kind, bindings: { movement_sign: 'direction', movement_qty: 'quantity' } }; break
    case 'rowview_workbench': ui = { id: 'workbench', component: kind, source: 'items' }; break
    case 'record_related_editor': ui = { ...workspace(inspector), sources: ['items', 'notes'], children: [{ ...inspector, children: [{ id: 'related', component: kind, source: 'notes', bindings: { reference: 'owner' }, record_table: { columns: [{ fields: ['title'] }, { fields: ['description'] }] } }] }] }; break
    case 'reference_graph': ui = { ...workspace(inspector), sources: ['items', 'notes'], children: [{ id: 'references', component: kind, references: { nodes: [{ source: 'items', label_field: 'title', description_field: 'description' }, { source: 'notes', label_field: 'title' }], links: [{ source: 'notes', field: 'owner', target: 'items', label: text('属于', 'Belongs To') }] } }, inspector] }; break
    case 'record_matrix': ui = workspace({ id: 'matrix', component: kind, source: 'items', matrix: { field: 'cells', row: 'material', column: 'progress', value: 'value' } }); break
    case 'record_artifact': ui = workspace({ id: 'artifact', component: kind, source: 'items', artifact: { field: 'file' } }); break
    case 'artifact_workspace': ui = { id: 'artifacts', component: kind, sidebar_icon: 'search', artifacts: { records_path: 'reports', title_field: 'title', file_field: 'file', artifact_kind: 'report', children: { records_field: 'directions', title_field: 'title', file_field: 'file', artifact_kind: 'direction', scoped_ids: true } } }; break
    case 'diagram_workspace': ui = { id: 'diagram', component: kind, source: 'items', sidebar_icon: 'workflow', diagram: { format: 'bpmn', file_field: 'file', label_field: 'title', artifact_kind: 'process', summary_fields: ['description'] } }; break
    case 'canvas_workspace': ui = { id: 'canvas', component: kind, source: 'items', sidebar_icon: 'pen-tool', canvas: { format: 'excalidraw', file_field: 'file', label_field: 'title', id_field: 'id', scene_directory: 'scenes', asset_directory: 'images', new_title: text('阅读计划', 'Reading Plan') } }; break
    case 'preview_workspace': ui = { id: 'preview', component: kind, live_preview: { file_path: 'preview.file', title_path: 'preview.title', design_width: 640, tokens: [] } }; break
    case 'navigation_workspace': ui = { id: 'navigation', component: kind, sidebar_icon: 'map', navigation_map: { nodes: { path: 'items', order: 'item_order', label: 'title', position: 'position' }, edges: { path: 'links', order: 'link_order', source: 'from', target: 'to', label: 'title' }, frames: { path: 'frames', label: 'title', members: 'members', position: 'position', size: 'size' } } }; break
    case 'execution_log': ui = { id: 'log-example', component: 'stack', children: [{ id: 'log-note', component: 'text_block', text: text('静态日志样例，不连接宿主，也不运行 Agent。', 'Static transcript example. No Host connection or Agent execution.') }, { id: 'log', component: kind, title: text('阅读整理过程', 'Reading Activity'), log: { scope: 'producer', max_entries: 20 } }] }; break
    default: return undefined
  }
  const manifest: PanelManifest = {
    version: 1, panel_kind: 'capability_map',
    sections: [
      { id: 'items', title: text('记录', 'Records'), item_name: text('记录', 'record'), form: { reorder: false, header: { variant: 'detail', title: { field: 'title', editable: true } } } },
      { id: 'links', title: text('关系', 'Relations'), navigation: 'contextual' },
      { id: 'questions', title: text('问题', 'Questions') },
      { id: 'rounds', title: text('轮次', 'Rounds') },
      { id: 'folders', title: text('文件夹', 'Folders') },
    ],
    fields: [
      { key: 'title', label: text('名称', 'Name'), control: 'text', applies_to: ['items', 'links', 'folders', 'rounds'] },
      { key: 'description', label: text('说明', 'Description'), control: 'textarea', applies_to: ['items', 'rounds'] },
      { key: 'category', label: text('分组', 'Group'), control: 'text', applies_to: ['items'] },
      { key: 'from', label: text('起点', 'From'), control: 'record_select', options_from_section: 'items', applies_to: ['links'] },
      { key: 'to', label: text('终点', 'To'), control: 'record_select', options_from_section: 'items', applies_to: ['links'] },
      { key: 'kind', label: text('类型', 'Kind'), control: 'text', applies_to: ['links'] },
    ], ui,
  }
  const sample: Record<string, unknown> = {
    name: text('共享组件示例', 'Shared component example'),
    items: {
      first: { title: text('阅读计划', 'Reading Plan'), description: text('整理本周需要阅读的材料。', 'Organize this week’s reading material.'), category: text('计划', 'Planning'), file: 'example.md' },
      second: { title: text('阅读笔记', 'Reading Notes'), description: text('保留重点，便于之后回顾。', 'Keep useful points for later review.'), category: text('知识', 'Knowledge') },
    },
    links: { relation: { title: text('形成', 'Produces'), from: 'first', to: 'second', kind: text('关联', 'Related') } },
    questions: {
      question_one: { prompt: text('你更希望先整理什么？', 'What would you like to organize first?'), kind: 'single', options: { plan: text('阅读计划', 'Reading plan'), notes: text('笔记', 'Notes') }, round: 1, answer: 'plan', detail: '' },
      question_two: { prompt: text('还有哪些需要补充？', 'What else should be included?'), kind: 'text', round: 2, answer: text('保留每篇材料的重点笔记。', 'Keep key notes for each document.'), detail: '' },
    },
    rounds: { '1': { title: text('整理重点', 'Reading Focus'), description: text('明确希望优先整理的阅读材料。', 'Identify which reading material to organize first.') }, '2': { title: text('补充需求', 'Additional Needs'), description: text('补充阅读整理时需要保留的信息。', 'Clarify which information should be kept.') } },
    folders: { folder: { title: text('资料', 'Material'), children: { document: { title: text('阅读笔记', 'Reading Notes'), description: text('一条嵌套记录', 'A nested record') } } } },
    document: 'component_example/document.html',
  }
  const items = sample.items as Record<string, Record<string, unknown>>
  const extendFields = (keys: readonly string[], source: string) => {
    manifest.fields = manifest.fields.map(field => keys.includes(field.key) ? { ...field, applies_to: [...field.applies_to ?? [], source] } : field)
  }
  if (['record_related_editor', 'reference_graph'].includes(kind)) {
    manifest.sections = [...manifest.sections, { id: 'notes', title: text('关联笔记', 'Related Notes'), navigation: 'contextual' }]
    manifest.fields = [...manifest.fields, { key: 'owner', label: text('所属记录', 'Parent Record'), control: 'record_select', options_from_section: 'items', hidden: kind === 'record_related_editor', readonly: kind === 'record_related_editor', applies_to: ['notes'] }]
    extendFields(['title', 'description'], 'notes')
    sample.notes = { key_point: { title: text('重点摘要', 'Key Summary'), description: text('每天安排十五分钟阅读，并保留重点。', 'Read for fifteen minutes daily and keep the key points.'), owner: 'first' } }
  }
  if (kind === 'record_matrix') {
    manifest.fields = [...manifest.fields, { key: 'cells', label: text('阅读进度', 'Reading Progress'), control: 'rows', applies_to: ['items'], columns: [{ key: 'material', label: text('材料', 'Material'), control: 'text' }, { key: 'progress', label: text('阶段', 'Stage'), control: 'text' }, { key: 'value', label: text('进度', 'Progress'), control: 'text' }] }]
    items.first!.cells = [{ material: text('文章', 'Articles'), progress: text('计划', 'Planned'), value: '3' }, { material: text('文章', 'Articles'), progress: text('完成', 'Completed'), value: '2' }, { material: text('书籍', 'Books'), progress: text('计划', 'Planned'), value: '1' }, { material: text('书籍', 'Books'), progress: text('完成', 'Completed'), value: '1' }]
  }
  if (['record_artifact', 'diagram_workspace', 'canvas_workspace'].includes(kind)) {
    manifest.fields = [...manifest.fields, { key: 'file', label: text('文件', 'File'), control: 'artifact_ref', applies_to: ['items'] }]
    // Keep the document surface focused on a populated example, not an empty sibling.
    delete items.second
    items.first!.file = kind === 'diagram_workspace' ? 'component_example/reading.bpmn' : kind === 'canvas_workspace' ? 'component_example/scenes/first.json' : 'component_example/document.html'
  }
  if (kind === 'canvas_workspace') {
    manifest.sections.find(section => section.id === 'items')!.order = 'item_order'
    manifest.fields = [...manifest.fields, { key: 'id', label: text('标识', 'Identifier'), control: 'text', applies_to: ['items'] }]
    items.first!.id = 'first'; sample.item_order = ['first']
  }
  if (kind === 'navigation_workspace') {
    manifest.sections = [...manifest.sections, { id: 'frames', title: text('区域', 'Frames') }]
    extendFields(['title'], 'frames')
    sample.item_order = ['first', 'second']; sample.link_order = ['relation']; sample.frames = {}
    items.first!.position = { x: 60, y: 80 }; items.second!.position = { x: 360, y: 80 }
  }
  if (kind === 'bpmn_canvas') {
    delete items.second
    items.first!.steps = [{ kind: 'start', name: text('开始阅读', 'Start Reading') }, { kind: 'task', name: text('整理重点', 'Summarize Key Points') }, { kind: 'end', name: text('保存笔记', 'Keep Notes') }]
  }
  if (kind === 'rowview_workbench') sample.sync = { refs: [{ concern: text('阅读计划', 'Reading Plan'), record_ref: 'sample/plan', projection: { title: text('每日阅读', 'Daily Reading'), summary: text('每天十五分钟', 'Fifteen minutes each day'), status: text('已确认', 'Confirmed') } }] }
  if (kind === 'doc_lifecycle_studio') {
    manifest.sections = [...manifest.sections, ...['objects', 'axes', 'actions'].map(id => ({ id, title: id }))]
    sample.objects = { note: { title: text('阅读笔记', 'Reading Note'), details: { object_ref: text('阅读材料', 'Reading Material'), direction: '+', quantity: '1' } } }
    sample.axes = { status: { title: text('笔记状态', 'Note Status') } }
    sample.actions = { complete: { title: text('整理完成', 'Complete Summary'), details: { process_node_ref: text('阅读整理 / 保存笔记', 'Reading / Keep Notes'), axis_effects: { status: text('草稿 → 已完成', 'Draft → Completed') } } } }
  }
  sample.preview = { title: text('阅读卡片', 'Reading Card'), file: 'component_example/card.html' }
  sample.reports = { reading: { title: text('阅读资料整理', 'Reading Review'), file: 'component_example/report.md', directions: { summary: { title: text('重点摘要', 'Key Summary'), file: 'component_example/summary.md' } } } }
  const previewLayout = panelComponentCategory(ui.component) === 'workspace' || ['split', 'mind_map'].includes(ui.component) ? 'workspace'
    : ['record_nav', 'record_tree', 'question_rounds'].includes(ui.component) ? 'navigation' : 'inline'
  return { panelYaml: stringify(manifest), sample, previewLayout, ...(kind === 'execution_log' ? { logEntries: [
    { seq: 1, timestamp: 1791676800000, eventType: 'message' as const, message: text('正在整理阅读材料，先确认需要保留的信息。', 'Review reading material and identify the information to retain.') },
    { seq: 2, timestamp: 1791676801000, eventType: 'search' as const, message: text('从样例材料中查找相关要点。', 'Find relevant points in the sample material.') },
    { seq: 3, timestamp: 1791676802000, eventType: 'synthesize' as const, message: text('已整理为阅读计划和重点笔记。', 'Organized into a reading plan and key notes.') },
  ] } : {}), artifacts: {
    'example.md': text('# 阅读笔记\n\n这是隔离的组件示例，不来自真实项目。', '# Reading Notes\n\nThis isolated example does not come from a real project.'),
    'component_example/document.html': text('<html><body><h1>阅读笔记</h1><h2>目标</h2><p>理解并试用组件。</p><h2>下一步</h2><p>复制声明，在真实 schema 上验证绑定。</p></body></html>', '<html><body><h1>Reading Notes</h1><h2>Goal</h2><p>Explore the shared component.</p><h2>Next Steps</h2><p>Copy the declaration and validate its bindings against your schema.</p></body></html>'),
    'component_example/report.md': text('# 阅读资料整理\n\n## 整理目标\n\n将阅读材料转化为可回顾的知识。\n\n## 整理结果\n\n- 建立阅读计划\n- 保留重点笔记', '# Reading Review\n\n## Goal\n\nTurn reading material into reusable knowledge.\n\n## Result\n\n- Create a reading plan\n- Keep key notes'),
    'component_example/summary.md': text('# 重点摘要\n\n每天安排十五分钟阅读；读完后记录三个关键观点。', '# Key Summary\n\nRead for fifteen minutes daily and capture three key points.'),
    'component_example/card.html': `<html><head><style>body{margin:0;padding:36px;font:16px/1.6 system-ui,sans-serif;background:#f6f4fa;color:#292333}article{max-width:480px;margin:auto;background:white;padding:28px;border:1px solid #e6e0ee;border-radius:12px}h1{font-size:24px;margin:0 0 12px}p{margin:0;color:#695f75}small{display:block;margin-top:24px;color:#663ae8}</style></head><body><article><h1>${text('阅读计划', 'Reading Plan')}</h1><p>${text('每天十五分钟，积累可回顾的知识。', 'Fifteen minutes a day to build reusable knowledge.')}</p><small>${text('固定组件样例', 'Fixed Component Example')}</small></article></body></html>`,
    'component_example/reading.bpmn': `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_Example" targetNamespace="urn:component-example"><bpmn:process id="Reading" isExecutable="false"><bpmn:startEvent id="Start"/><bpmn:task id="Read" name="${text('阅读材料', 'Read Material')}"/><bpmn:task id="Summarize" name="${text('整理重点', 'Summarize')}"/><bpmn:endEvent id="End"/><bpmn:sequenceFlow id="Flow_1" sourceRef="Start" targetRef="Read"/><bpmn:sequenceFlow id="Flow_2" sourceRef="Read" targetRef="Summarize"/><bpmn:sequenceFlow id="Flow_3" sourceRef="Summarize" targetRef="End"/></bpmn:process><bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Reading"><bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="50" y="112" width="36" height="36"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="Read_di" bpmnElement="Read"><dc:Bounds x="130" y="90" width="120" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="Summarize_di" bpmnElement="Summarize"><dc:Bounds x="300" y="90" width="120" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="End_di" bpmnElement="End"><dc:Bounds x="470" y="112" width="36" height="36"/></bpmndi:BPMNShape><bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="86" y="130"/><di:waypoint x="130" y="130"/></bpmndi:BPMNEdge><bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint x="250" y="130"/><di:waypoint x="300" y="130"/></bpmndi:BPMNEdge><bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3"><di:waypoint x="420" y="130"/><di:waypoint x="470" y="130"/></bpmndi:BPMNEdge></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`,
    'component_example/scenes/first.json': JSON.stringify({ elements: [
      { id: 'reading-card', type: 'rectangle', x: 60, y: 60, width: 320, height: 140, angle: 0, strokeColor: '#663ae8', backgroundColor: '#f1eafd', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: { type: 3 }, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: true },
      { id: 'reading-text', type: 'text', x: 88, y: 108, width: 264, height: 50, angle: 0, strokeColor: '#292333', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 2, version: 1, versionNonce: 2, isDeleted: false, boundElements: null, updated: 1, link: null, locked: true, text: text('阅读计划\n每天十五分钟', 'Reading Plan\nFifteen minutes each day'), originalText: text('阅读计划\n每天十五分钟', 'Reading Plan\nFifteen minutes each day'), fontSize: 20, fontFamily: 6, textAlign: 'left', verticalAlign: 'top', containerId: null, autoResize: true, lineHeight: 1.25 },
    ], appState: { viewBackgroundColor: '#ffffff' }, files: {} }),
  } }
}
