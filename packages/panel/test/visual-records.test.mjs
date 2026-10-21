import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { parsePanelManifest, validatePanelManifest } = await import('../../core/src/panel-dsl.ts')
const { pivotRows, replaceMatrixCell, graphRecords, relationCanvasLabel } = await import('../src/visual-records.ts')
const { applyPanelUpdatesToDraft, applyDesignEditToDraft, recordDeletionUpdates } = await import('../src/interpreter.ts')
const { insertVisualRecord } = await import('../src/visual-components.tsx')
const { boardGroups } = await import('../src/record-board.tsx')
const { documentArtifactPath } = await import('../src/document-workspace.tsx')
const { artifactGroups, confinedTextArtifact, orderedArtifactRecords } = await import('../src/artifact-workspace.tsx')
const { readFile } = await import('node:fs/promises')
const { graphManifest: objects, matrixManifest: dataPanel, artifactManifest: resultsPanel } = await import('./fixtures/declarative-visuals.mjs')

test('relation canvas labels omit redundant endpoints but retain authored meaning and source facts', () => {
  const edge = { title: '主审核人 → 申请人', kind: 'inherits', source: 'lead', target: 'applicant' }
  const before = structuredClone(edge)
  assert.equal(relationCanvasLabel(edge.title, '主审核人', '申请人', '继承权限'), '继承权限')
  for (const label of ['A → B', 'A -> B', 'A→B', 'A->B']) {
    assert.equal(relationCanvasLabel(label, 'A', 'B', 'Depends on'), 'Depends on')
    assert.equal(relationCanvasLabel(label, 'A', 'B', ''), '')
  }
  assert.equal(relationCanvasLabel(undefined, 'A', 'B', '继承权限'), '继承权限')
  assert.equal(relationCanvasLabel('A → B 时需要审批', 'A', 'B', '继承权限'), 'A → B 时需要审批')
  assert.equal(relationCanvasLabel('审核人 → 系统', 'A', 'B', '继承权限'), '审核人 → 系统')
  assert.equal(relationCanvasLabel('负责审批', 'A', 'B', '继承权限'), '负责审批')
  assert.deepEqual(edge, before, 'display simplification never renames or rewrites canonical relationships')
})

test('initial labels seed only new records with user/default priority and atomic nested order', () => {
  const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'items', title: 'Items', records_path: 'nested.items', fields_path: 'facts', order: 'nested.order', create: { id_field: 'id', defaults: { title: '' }, initial_label: { field: 'title', text: 'New requirement', numbered_text: 'New requirement {index}' } } }], fields: [], ui: { component: 'record_workspace', id: 'items', sources: ['items'] } }
  const insert = (data, values = {}, panel = manifest) => {
    const calls = []
    const before = structuredClone(data)
    const id = insertVisualRecord({ manifest: panel, data, options: { editable: true, onPanelUpdate: value => calls.push(value) } }, 'items', values)
    assert.deepEqual(data, before)
    assert.equal(calls.length, 1)
    return { id, update: calls[0], record: calls[0]['nested.items'][id].facts }
  }
  const empty = insert({ nested: { items: {}, order: [] } })
  assert.equal(empty.record.title, 'New requirement')
  assert.equal(empty.record.id, empty.id)
  assert.deepEqual(empty.update['nested.order'], [empty.id])
  const state = { nested: { items: { existing: { facts: { id: 'existing', title: 'Saved name' } } }, order: ['existing'] } }
  const next = insert(state)
  assert.equal(next.record.title, 'New requirement 2')
  assert.deepEqual(next.update['nested.items'].existing, state.nested.items.existing)
  assert.deepEqual(next.update['nested.order'], ['existing', next.id])
  assert.equal(insert(state, { title: 'User name' }).record.title, 'User name')
  const defaults = structuredClone(manifest)
  defaults.sections[0].create.defaults.title = 'Canonical default'
  assert.equal(insert(state, { title: '' }, defaults).record.title, 'Canonical default')
  assert.equal(insert(state, { title: 'User name' }, defaults).record.title, 'User name')
  const translated = structuredClone(manifest)
  translated.sections[0].create.initial_label.numbered_text = '新验收要求 {index}'
  assert.equal(insert(state, {}, translated).record.title, '新验收要求 2')
  for (const field of ['id', 'nested.id', '__proto__']) {
    const invalid = structuredClone(manifest)
    delete invalid.sections[0].create.id_field
    invalid.sections[0].create.initial_label.field = field
    assert.ok(validatePanelManifest(invalid).some(error => error.includes('initial_label')))
  }
})

test('canvas workspace declares owned native files and rejects ambiguous or escaping bindings', async () => {
  const panel = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/whiteboard/panel.yaml', import.meta.url), 'utf8'))
  assert.deepEqual(validatePanelManifest(panel), [])
  for (const mutate of [
    value => { value.ui.canvas.scene_directory = '../outside' },
    value => { value.ui.canvas.asset_directory = 'constructor' },
    value => { value.ui.canvas.label_field = value.ui.canvas.file_field },
    value => { value.ui.canvas.file_field = 'title' },
    value => { value.sections[0].fields_path = 'nested' },
    value => { delete value.sections[0].order },
  ]) { const bad = structuredClone(panel); mutate(bad); assert.ok(validatePanelManifest(bad).length) }
})

test('canvas known absent scene is pending, while failed reads and invalid bytes remain errors', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<div id="canvas-state-root"></div>', { url: 'https://panel.test/' })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of keys.slice(0, -1)) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { CanvasWorkspace } = await import('../src/canvas-workspace.tsx')
  const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
  const manifest = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/whiteboard/panel.yaml', import.meta.url), 'utf8'))
  const data = { boards: { waiting: { id: 'waiting', title: 'Saved topic', artifact_file: 'whiteboard/boards/waiting.json' } }, board_order: ['waiting'] }
  const original = structuredClone(data), root = createRoot(document.getElementById('canvas-state-root'))
  const missing = async () => ({ found: false, content: '' })
  const show = async (readArtifact, locale = 'zh-CN', artifactFiles = {}) => {
    await React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
      React.createElement(CanvasWorkspace, { node: manifest.ui, manifest, data,
        options: { skill: 'whiteboard', artifactFiles, readArtifact, editable: false } }))))
  }
  try {
    await show(missing)
    assert.equal(document.querySelector('[role="alert"]'), null)
    assert.match(document.querySelector('[role="status"]').textContent, /尚未生成/)
    assert.equal(document.querySelector('canvas'), null, 'missing file is never synthesized as an empty scene')
    await show(missing, 'en-US')
    assert.match(document.querySelector('[role="status"]').textContent, /not been created yet/)
    assert.ok([...document.querySelectorAll('.dsh-canvas-heading button, .dsh-canvas-heading input, .dsh-panel-workspace-tree-add')].every(element => element.disabled))
    await show(async () => { throw Error('Permission denied') })
    assert.match(document.querySelector('[role="alert"]').textContent, /Permission denied/)
    await show(async () => ({ found: true, content: '{invalid' }))
    assert.ok(document.querySelector('[role="alert"]'), 'bad JSON cannot be called pending')
    await show(missing, 'en-US', { 'whiteboard/boards/waiting.json': 'observed-file' })
    assert.match(document.querySelector('[role="alert"]').textContent, /Scene unavailable/)
    assert.deepEqual(data, original, 'read state does not modify saved topic refs or create files')
  } finally {
    await React.act(async () => root.unmount())
    dom.window.close()
    for (const key of keys) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key] }
  }
})

test('artifact workspace isolates repeated child ids by parent, includes new records and projects bound receipts without writing facts', async () => {
  const panel = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/research/panel.yaml', import.meta.url), 'utf8'))
  assert.deepEqual(validatePanelManifest(panel), [])
  const state = { rounds: { a: { topic: 'Old', directions: { same: { title: 'Old child', findings_file: 'research/a/report.md' } } }, b: { topic: 'New', directions: { same: { title: 'New child' } } } }, round_order: ['a'], current_round_id: 'a' }
  const before = structuredClone(state)
  const event = { invocationId: 'now', attemptId: 'one', skill: 'research', artifactId: 'b/same', artifactKind: 'research_direction', artifactFile: 'research/b/new.md', role: 'worker', runId: 'real-child', phase: 'working', sequence: 4, timestamp: 1 }
  const groups = artifactGroups(state, panel.ui.artifacts, 'research', [event], { 'research/a/report.md': 'old', 'research/b/new.md': 'new' })
  assert.deepEqual(groups.map(group => group.id), ['a', 'b'])
  assert.equal(groups[0].children[0].status, 'completed')
  assert.equal(groups[1].children[0].status, 'working')
  assert.equal(groups[1].children[0].runId, 'real-child')
  assert.equal(groups[1].children[0].file, 'research/b/new.md')
  assert.deepEqual(state, before)
  assert.equal(artifactGroups(state, panel.ui.artifacts, 'research', [{ ...event, phase: 'completed' }], {})[1].children[0].status, 'failed', 'completion without file is not success')
  assert.deepEqual(orderedArtifactRecords({ a: { title: 'A' } }, ['a', 'a', 'missing']).map(([id]) => id), ['a'])
  for (const value of ['research/../private.md', '/research/a.md', 'other/a.md', 'research/a.js', 'research/a.md?x', 'research/\\secret.md']) assert.equal(confinedTextArtifact(value, 'research'), undefined)
  for (const mutate of [value => { value.records_path = '__proto__' }, value => { value.children = [] }, value => { value.children.scoped_ids = 'yes' }, value => { value.children.artifact_kind = '../bad' }]) {
    const bad = structuredClone(panel); mutate(bad.ui.artifacts); assert.ok(validatePanelManifest(bad).length)
  }
})

test('document workspace declares read-only confined artifacts and rejects malformed bindings', async () => {
  const panel = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/web_app_prd_assembly/panel.yaml', import.meta.url), 'utf8'))
  assert.deepEqual(validatePanelManifest(panel), [])
  const config = panel.ui.document
  assert.equal(documentArtifactPath('prd.html', config, 'web_app_prd_assembly'), 'web_app_prd_assembly/prd.html')
  for (const path of ['../../secret.html', 'other/prd.html', null, '/prd.html', '__proto__']) assert.equal(documentArtifactPath(path, config, 'web_app_prd_assembly'), undefined)
  assert.equal(documentArtifactPath('prd.html', config, 'other'), undefined)
  assert.equal(documentArtifactPath('prd.html', config), undefined)
  for (const mutate of [
    value => { value.path = '__proto__' },
    value => { value.allowed_files = ['bundle/../secret.html'] },
    value => { value.aliases = { 'prd.html': 'other/private.html' } },
    value => { value.sources = [null] },
    value => { value.references_id_field = 'nested.id' },
    value => { value.source_attribute = 'onclick' },
    value => { value.references_label = {} },
  ]) { const bad = structuredClone(panel); mutate(bad.ui.document); assert.ok(validatePanelManifest(bad).length) }
})

test('grouped board preserves rejection, stable identities, nested facts and declared binding boundaries', async () => {
  const panel = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/function_modules/panel.yaml', import.meta.url), 'utf8'))
  assert.deepEqual(validatePanelManifest(panel), [])
  const original = { functions: { one: { function_id: 'one', function_name: 'Find', function_description: 'Find evidence', function_epic: 'Reading',
    details: { purpose: 'Keep evidence', behaviors: { stable: { description: 'Search' } }, inputs: { input: { description: 'Question' } } },
    references: { source: { file: 'questions/state.json', revision: 'a'.repeat(40) } } },
    two: { function_name: 'Share', function_epic: 'Reading', rejected: true } } }
  assert.equal(boardGroups(original.functions, panel.ui.board, 'active', 'Ungrouped').get('Reading').length, 1)
  assert.equal(boardGroups(original.functions, panel.ui.board, 'all', 'Ungrouped').get('Reading').length, 2)
  const next = applyDesignEditToDraft(original, panel, { section: 'function_details', record: 'one', field: 'behaviors', value: { stable: { description: 'Search precisely' } } })
  assert.equal(next.functions.one.details.behaviors.stable.description, 'Search precisely')
  assert.deepEqual(next.functions.one.details.inputs, original.functions.one.details.inputs)
  assert.deepEqual(next.functions.one.references, original.functions.one.references)
  assert.deepEqual(next.functions.two, original.functions.two)
  assert.equal(original.functions.one.details.behaviors.stable.description, 'Search')
  for (const mutate of [
    value => { value.ui.board.rejected = 'priority' },
    value => { value.ui.board.label = '__proto__' },
    value => { value.ui.board.detail_sections = ['functions'] },
    value => { value.ui.board.detail_sections = null },
    value => { value.sections[1].records_path = 'other' },
    value => { value.sections[1].add_mode = 'default' },
  ]) { const bad = structuredClone(panel); mutate(bad); assert.ok(validatePanelManifest(bad).length) }
})

test('nested map declarations validate their supported controls and reject malformed columns without throwing', async () => {
  const panel = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/integration_design/panel.yaml', import.meta.url), 'utf8'))
  assert.deepEqual(validatePanelManifest(panel), [])
  for (const mutate of [
    field => { field.columns = {} },
    field => { field.columns = [null] },
    field => { field.columns[0].key = field.id_field },
    field => { field.columns[0].control = 'number' },
    field => { field.order_field = '__proto__' },
    field => { field.columns[0].format = 'execute-script' },
  ]) {
    const bad = structuredClone(panel); mutate(bad.fields.find(field => field.control === 'record_map'))
    assert.ok(validatePanelManifest(bad).length)
  }
})

test('permission panel uses atomic declared summaries and conditional clearing without changing sibling facts', async () => {
  const panel = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/role_access/panel.yaml', import.meta.url), 'utf8'))
  assert.deepEqual(validatePanelManifest(panel), [])
  const original = { policies: { a: { effect: 'allow', capability: 'Read', title: 'Saved wording', requirements: ['custom', 'confirm'], custom_requirement: 'Ask owner' }, b: { title: 'Other role' } } }
  const edit = (draft, field, value) => applyDesignEditToDraft(draft, panel, { section: 'policies', record: 'a', field, value })
  let next = edit(original, 'applies_when', 'Own records')
  assert.equal(next.policies.a.title, 'Saved wording')
  next = edit(next, 'effect', 'deny')
  assert.equal(next.policies.a.title, '禁止Read')
  next = edit(next, 'capability', 'Export')
  assert.equal(next.policies.a.title, '禁止Export')
  next = edit(next, 'requirements', ['confirm'])
  assert.equal(next.policies.a.custom_requirement, '')
  assert.deepEqual(next.policies.a.requirements, ['confirm'])
  assert.deepEqual(next.policies.b, original.policies.b)
  assert.equal(original.policies.a.title, 'Saved wording')
  assert.equal(original.policies.a.custom_requirement, 'Ask owner')
  for (const mutate of [
    panel => { panel.sections[1].derived_fields.title.parts = null },
    panel => { panel.sections[1].derived_fields.title.parts = [{ field: 'title' }] },
    panel => { panel.sections[1].derived_fields.id = panel.sections[1].derived_fields.title },
    panel => { panel.sections[1].derived_fields.title.parts[0].values = [] },
  ]) { const bad = structuredClone(panel); mutate(bad); assert.ok(validatePanelManifest(bad).length) }
})

test('new manifests validate; missing context, foreign sections and undeclared fields fail closed', () => {
  assert.deepEqual(validatePanelManifest(objects), [])
  assert.deepEqual(validatePanelManifest(dataPanel), [])
  assert.deepEqual(validatePanelManifest(resultsPanel), [])
  for (const mutate of [
    manifest => { manifest.ui.component = 'stack' },
    manifest => { manifest.ui.sources.push('undeclared') },
    manifest => { manifest.ui.sources.push(manifest.ui.sources[0]) },
    manifest => { manifest.ui.children[0].graph.edges = 'other_bundle' },
    manifest => { manifest.ui.children[0].graph.source_field = '__proto__' },
    manifest => { manifest.ui.children[0].graph.edge_defaults = { invented: 'x' } },
    manifest => { manifest.ui.children[0].graph.target_field = 'source_ref' },
    manifest => { manifest.ui.children[0].graph.node_kind_field = 'title_from_edge' },
    manifest => { manifest.ui.children[0].graph.edge_pending_values = [] },
    manifest => { manifest.ui.children[0].graph.related[0].reference_field = '__proto__' },
    manifest => { manifest.sections.find(section => section.id === 'objects').navigation = 'elsewhere' },
    manifest => { manifest.sections.find(section => section.id === 'objects').add_mode = 'floating' },
    manifest => { const field = manifest.fields.find(field => field.key === 'participants').item_fields.find(field => field.key === 'object_ref'); field.control = 'text'; delete field.options_from_section },
    manifest => { manifest.fields.find(field => field.key === 'object_ref').options_from_section = 'structures' },
    manifest => { manifest.fields.find(field => field.key === 'specializes').hierarchy.label_field = 'description' },
    manifest => { manifest.fields.find(field => field.key === 'specializes').options_from_section = 'relations' },
    manifest => { manifest.fields.find(field => field.key === 'specializes').hierarchy.inherit_fields = ['object_refs'] },
    manifest => { manifest.fields = manifest.fields.filter(field => !['object_ref', 'object_refs'].includes(field.key)) },
    manifest => { manifest.sections.find(section => section.id === 'structures').add_mode = 'graph' },
  ]) {
    const manifest = structuredClone(objects); mutate(manifest)
    assert.ok(validatePanelManifest(manifest).length > 0, String(mutate))
  }
  const bad = structuredClone(dataPanel); bad.ui.children[0].matrix.value = 'unknown'
  assert.ok(validatePanelManifest(bad).length > 0)
  for (const mutate of [
    manifest => { manifest.ui.children[0].artifact.field = 'title' },
    manifest => { manifest.ui.children[0].source = 'unknown' },
    manifest => { manifest.ui.children[0].artifact.field = '__proto__' },
  ]) { const bad = structuredClone(resultsPanel); mutate(bad); assert.ok(validatePanelManifest(bad).length > 0) }
})

test('matrix preserves coordinates, missing/duplicate cells, malformed rows and unrelated fields', () => {
  const binding = { row: 'person', column: 'slot', value: 'available' }
  const rows = [{ person: 'A', slot: 'AM', available: 'yes', provenance: 'source' },
    { person: 'B', slot: 'PM', available: 'no' }, { person: 'B', slot: 'PM', available: 'unknown' }, null]
  const before = JSON.stringify(rows)
  const pivot = pivotRows(rows, binding)
  assert.equal(pivot.cells.get('A').get('AM').length, 1)
  assert.equal(pivot.cells.get('A').get('PM'), undefined)
  assert.equal(pivot.issues.length, 2)
  assert.throws(() => replaceMatrixCell(rows, binding, 'B', 'PM', 'yes'), /exactly one/)
  assert.throws(() => replaceMatrixCell(rows, binding, 'A', 'PM', 'yes'), /exactly one/)
  const next = replaceMatrixCell(rows, binding, 'A', 'AM', 'no')
  assert.equal(next[0].provenance, 'source'); assert.equal(next[0].available, 'no')
  assert.equal(next[1], rows[1]); assert.equal(next[3], null)
  assert.equal(JSON.stringify(rows), before)
})

test('graph retains orphan records as explicit diagnostics; parallel edges remain distinct', () => {
  const nodes = { a: {}, b: {} }
  const edges = { x: { from: 'a', to: 'b' }, y: { from: 'a', to: 'b' }, z: { from: 'a', to: 'missing' } }
  const result = graphRecords(nodes, edges, 'from', 'to')
  assert.equal(result.valid.length, 2); assert.equal(result.issues.length, 1)
  assert.equal(Object.keys(edges).length, 3)
})

test('generic insert/edit preserve nested fields, sibling records, envelope and order; readonly emits nothing', () => {
  const manifest = { ...objects, sections: [{ id: 'items', title: 'Items', records_path: 'store.items', fields_path: 'details', order: 'store.order' }] }
  let draft = { store: { items: { old: { details: { title: 'old' }, keep: 5 } }, order: ['old'] }, envelope: 'keep' }
  const props = { manifest, node: {}, data: draft, options: { editable: true, onPanelUpdate: updates => { draft = applyPanelUpdatesToDraft(draft, updates) } } }
  const id = insertVisualRecord(props, 'items', { title: 'new' })
  assert.equal(draft.store.items[id].details.title, 'new')
  assert.deepEqual(draft.store.order, ['old', id])
  assert.equal(draft.store.items.old.keep, 5); assert.equal(draft.envelope, 'keep')
  draft = applyDesignEditToDraft(draft, manifest, { section: 'items', record: id, field: 'title', value: 'updated' })
  assert.equal(draft.store.items[id].details.title, 'updated')
  assert.equal(insertVisualRecord({ ...props, options: { ...props.options, editable: false } }, 'items', {}), undefined)
  assert.equal(Object.keys(draft.store.items).length, 2)
})

test('creation defaults and canonical ids are declared, not guessed from Bundle names', () => {
  const manifest = { ...objects, sections: [{ id: 'items', title: 'Items', order: 'order', create: { id_field: 'item_id', defaults: { title: '', tags: ['preset'] } } }] }
  let draft = { items: {}, order: [], preserved: true }
  const id = insertVisualRecord({ manifest, node: {}, data: draft, options: { editable: true,
    onPanelUpdate: updates => { draft = applyPanelUpdatesToDraft(draft, updates) } } }, 'items', { title: 'Chosen title' })
  assert.equal(draft.items[id].item_id, id)
  assert.equal(draft.items[id].title, 'Chosen title')
  assert.deepEqual(draft.items[id].tags, ['preset'])
  assert.deepEqual(draft.order, [id])
  assert.equal(draft.preserved, true)
})

test('deletion follows explicit child ownership only and preserves other records and order', () => {
  const manifest = { sections: [
    { id: 'parents', order: 'parent_order', delete_children: [{ section: 'children', reference_field: 'parent_ref' }] },
    { id: 'children', order: 'child_order' }, { id: 'ordinary_refs' },
  ] }
  const data = { parents: { a: { title: 'A' }, b: { title: 'B' } }, parent_order: ['b', 'a'],
    children: { x: { parent_ref: 'a', text: 'remove' }, y: { parent_ref: 'b', text: 'keep' } }, child_order: ['y', 'x'],
    ordinary_refs: { r: { parent_ref: 'a' } }, keep: 'untouched' }
  const before = structuredClone(data)
  const plan = recordDeletionUpdates(manifest, data, 'parents', 'a')
  const next = applyPanelUpdatesToDraft(data, plan.updates)
  assert.equal(plan.children, 1)
  assert.deepEqual(next.parents, { b: data.parents.b })
  assert.deepEqual(next.children, { y: data.children.y })
  assert.deepEqual(next.parent_order, ['b'])
  assert.deepEqual(next.child_order, ['y'])
  assert.deepEqual(next.ordinary_refs, data.ordinary_refs)
  assert.equal(next.keep, 'untouched')
  assert.deepEqual(data, before)
  assert.deepEqual(recordDeletionUpdates(manifest, data, 'parents', 'missing').updates, {})
})

test('child editor and deletion contracts reject foreign, multi-parent and chained ownership', () => {
  const panel = { version: 1, panel_kind: 'evidence_workbook', sections: [
    { id: 'parents', title: 'Parents', delete_children: [{ section: 'children', reference_field: 'parent_ref' }] },
    { id: 'children', title: 'Children' },
  ], fields: [{ key: 'parent_ref', control: 'record_select', options_from_section: 'parents', applies_to: ['children'] }],
  ui: { component: 'record_workspace', id: 'w', sources: ['parents', 'children'], children: [
    { component: 'record_related_editor', id: 'child', source: 'children', bindings: { reference: 'parent_ref' } },
  ] } }
  assert.deepEqual(validatePanelManifest(panel), [])
  for (const mutate of [
    panel => { panel.fields[0].control = 'record_multi_select' },
    panel => { panel.sections[0].delete_children[0].section = 'foreign' },
    panel => { panel.sections[1].delete_children = [{ section: 'parents', reference_field: 'parent_ref' }] },
    panel => { panel.ui.children[0].bindings.reference = '__proto__' },
    panel => { panel.ui.component = 'stack' },
  ]) { const bad = structuredClone(panel); mutate(bad); assert.ok(validatePanelManifest(bad).length) }
})

test('incident-link deletion is explicit, atomic and does not follow the other endpoint', () => {
  const panel = { version: 1, panel_kind: 'document', sections: [
    { id: 'things', title: 'Things', records_path: 'model.things', order: 'model.order', delete_relations: [{ section: 'links', reference_fields: ['from', 'to'] }] },
    { id: 'links', title: 'Links', records_path: 'model.links', fields_path: 'fields', order: 'model.link_order' },
  ], fields: ['from', 'to'].map(key => ({ key, control: 'record_select', options_from_section: 'things', applies_to: ['links'] })),
  ui: { component: 'record_workspace', id: 'workspace', sources: ['things', 'links'] } }
  assert.deepEqual(validatePanelManifest(panel), [])
  const data = { model: { things: { a: { name: 'A' }, b: { name: 'B' }, c: { name: 'C' } }, order: ['a', 'b', 'c'],
    links: { ab: { fields: { from: 'a', to: 'b' } }, ca: { fields: { from: 'c', to: 'a' } }, self: { fields: { from: 'a', to: 'a' } }, bc: { fields: { from: 'b', to: 'c' }, keep: 7 } }, link_order: ['ab', 'ca', 'self', 'bc'] }, extra: 'retained' }
  const before = structuredClone(data), plan = recordDeletionUpdates(panel, data, 'things', 'a')
  assert.equal(plan.relations, 3, 'self links count once')
  assert.equal(plan.children, 0)
  const next = applyPanelUpdatesToDraft(data, plan.updates)
  assert.deepEqual(next.model.things, { b: { name: 'B' }, c: { name: 'C' } })
  assert.deepEqual(next.model.links, { bc: data.model.links.bc })
  assert.deepEqual(next.model.link_order, ['bc'])
  assert.equal(next.extra, 'retained')
  assert.deepEqual(data, before)
  const removeLink = applyPanelUpdatesToDraft(data, recordDeletionUpdates(panel, data, 'links', 'ab').updates)
  assert.deepEqual(removeLink.model.things, before.model.things)
  assert.deepEqual(recordDeletionUpdates(panel, data, 'things', 'missing').updates, {})
  for (const mutate of [
    p => { p.sections[0].delete_relations = null }, p => { p.sections[0].delete_relations = [null] },
    p => { p.sections[0].delete_relations[0].reference_fields = [] }, p => { p.sections[0].delete_relations[0].reference_fields = ['from', 'from'] },
    p => { p.sections[0].delete_relations[0].reference_fields = ['unknown'] }, p => { p.sections[0].delete_relations[0].section = 'things' },
    p => { p.sections[0].delete_relations.push(p.sections[0].delete_relations[0]) }, p => { p.fields[0].control = 'record_multi_select' },
    p => { p.sections[1].records_path = 'model.things' }, p => { p.sections[1].records_path = 'model.things.related' },
    p => { p.sections[1].delete_relations = [{ section: 'things', reference_fields: ['other'] }] },
    p => { p.sections[0].delete_children = [{ section: 'links', reference_field: 'from' }] },
  ]) { const bad = structuredClone(panel); mutate(bad); assert.ok(validatePanelManifest(bad).length, String(mutate)) }
})

test('conditional omission preserves unknown quantities until an explicit dependency edit', () => {
  const panel = { version: 1, panel_kind: 'document', sections: [{ id: 'links', title: 'Links' }], fields: [
    { key: 'kind', control: 'select', options: [{ value: 'ordinary', label: 'Ordinary' }, { value: 'typed', label: 'Typed' }], applies_to: ['links'] },
    { key: 'count', control: 'select', options: [{ value: 'one', label: 'One' }], visible_when: { field: 'kind', in: ['ordinary'] }, clear_when_hidden: 'omit', applies_to: ['links'] },
    { key: 'name', control: 'text', applies_to: ['links'] },
  ], ui: { id: 'form', component: 'record_form', source: 'links' } }
  assert.deepEqual(validatePanelManifest(panel), [])
  const data = { links: { a: { kind: 'typed', count: 'one', name: 'Preserve on unrelated edit' }, b: { kind: 'ordinary', name: 'Unknown count' } } }
  const edit = (record, field, value) => applyDesignEditToDraft(data, panel, { section: 'links', record, field, value })
  assert.equal(edit('a', 'name', 'Edited name').links.a.count, 'one')
  assert.equal(Object.hasOwn(edit('a', 'kind', 'typed').links.a, 'count'), false)
  assert.equal(Object.hasOwn(edit('b', 'kind', 'typed').links.b, 'count'), false)
  assert.equal(Object.hasOwn(edit('b', 'kind', 'ordinary').links.b, 'count'), false)
  assert.equal(data.links.a.count, 'one')
})
