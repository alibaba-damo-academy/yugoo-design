import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { register } = await import('tsx/esm/api'); register()
const { parsePanelManifest, validatePanelManifest } = await import('../../core/src/panel-dsl.ts')
const { localizePanelManifest, panelTranslationKeys, validatePanelTranslations } = await import('../../core/src/panel-i18n.ts')
const { planRelationHierarchyCreate } = await import('../src/relation-hierarchy-create.ts')
const { applyPanelUpdatesToDraft } = await import('../src/record-state.ts')
const { relationParents, relationHasCycle } = await import('../src/relation-records.ts')
const { validatorFromSchemaYaml } = await import('../../core/src/schema.ts')

const root = new URL('../../skills-web-app/bundles/business_data/', import.meta.url)
const declared = parsePanelManifest(await readFile(new URL('panel.yaml', root), 'utf8'))
declared.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale =>
  [locale, JSON.parse(await readFile(new URL(`locales/${locale}.json`, root), 'utf8'))])))
const localized = locale => localizePanelManifest(declared, locale)
const graphOf = panel => panel.ui.children.find(child => child.component === 'relation_graph').graph
const fixture = () => ({ schema_version: 3, object_order: ['parent', 'other'],
  objects: {
    parent: { id: 'parent', name: 'Base', description: 'Preserve parent',
      fields: { local: { id: 'local', name: 'Parent information' } }, field_order: ['local'],
      states: { current: { id: 'current', name: 'Parent state' } }, state_order: ['current'] },
    other: { id: 'other', name: 'Unrelated', description: 'Keep' },
  }, relations: { existing: { id: 'existing', name: 'references', kind: 'association', source: 'parent', target: 'other' } },
})

test('real opt-in translates display labels only, supports fallback and validates missing keys', () => {
  assert.deepEqual(validatePanelManifest(declared), [])
  assert.deepEqual(validatePanelTranslations(declared, true), [])
  assert.ok(panelTranslationKeys(declared).includes('createSubtype'))
  const before = structuredClone(declared)
  for (const [locale, label, title] of [['zh-CN', '添加子类型', '创建子类型'], ['en-US', 'Add subtype', 'Create a subtype']]) {
    const panel = localized(locale)
    assert.deepEqual(validatePanelManifest(panel), [])
    assert.deepEqual(graphOf(panel).hierarchy.create, { edge_kind: 'generalization', create_label: label, create_title: title })
    assert.deepEqual(panel.sections.map(section => section.create), declared.sections.map(section => section.create))
    assert.equal(graphOf(panel).label_field, 'name')
    assert.deepEqual(graphOf(panel).hierarchy.values, ['generalization'])
  }
  const missing = structuredClone(declared)
  delete missing.i18n.messages['en-US'].createSubtype
  assert.equal(graphOf(localizePanelManifest(missing, 'en-US')).hierarchy.create.create_label, '添加子类型')
  delete missing.i18n.messages['zh-CN'].createSubtype
  assert.ok(validatePanelTranslations(missing, true).some(error => error.includes('missing default translation: createSubtype')))
  assert.deepEqual(declared, before)
})

test('optional create rejects invalid kinds, missing display text and conflicting field bindings', () => {
  const old = structuredClone(declared)
  delete graphOf(old).hierarchy.create
  assert.deepEqual(validatePanelManifest(old), [])
  for (const mutate of [
    graph => { graph.hierarchy.create = null },
    graph => { graph.hierarchy.create = [] },
    graph => { graph.hierarchy.create = 'unsupported' },
    graph => { graph.hierarchy.create.edge_kind = 'association' },
    graph => { graph.hierarchy.create.edge_kind = 'guessed' },
    graph => { delete graph.hierarchy.create.edge_kind },
    graph => { graph.hierarchy.create.create_label = ' ' },
    graph => { delete graph.hierarchy.create.create_title },
    graph => { graph.hierarchy.create.script = 'not executable' },
    graph => { graph.label_field = 'id' },
  ]) {
    const panel = structuredClone(declared); mutate(graphOf(panel))
    assert.ok(validatePanelManifest(panel).some(error => error.includes('hierarchy create')))
  }
  for (const section of ['objects', 'relations']) {
    const panel = structuredClone(declared)
    // The current name field is shared by both sections.
    panel.fields.find(field => field.key === 'name' && field.applies_to.includes(section)).readonly = true
    assert.ok(validatePanelManifest(panel).some(error => error.includes('editable text labels')))
  }
  for (const mutate of [
    panel => { panel.sections[1].records_path = 'objects' },
    panel => { panel.sections[1].records_path = 'objects.nested' },
    panel => { panel.sections[1].order = 'object_order' },
    panel => { panel.sections[1].order = 'objects.order' },
  ]) {
    const panel = localized('en-US'); mutate(panel)
    assert.ok(validatePanelManifest(panel).some(error => error.includes('disjoint')))
    assert.equal(planRelationHierarchyCreate(panel, fixture(), graphOf(panel), 'parent', 'Child'), undefined)
  }
})

test('one plan contains node, child-to-parent edge and declared order without changing existing facts', async () => {
  const panel = localized('en-US'), graph = graphOf(panel), data = fixture(), before = structuredClone(data)
  const result = planRelationHierarchyCreate(panel, data, graph, 'parent', '  Specialist  ')
  assert.ok(result)
  assert.deepEqual(Object.keys(result.updates).sort(), ['objects', 'relations', 'object_order'].sort())
  assert.deepEqual(data, before, 'planning is not a UI write, save or publication')
  const next = applyPanelUpdatesToDraft(data, result.updates), node = next.objects[result.nodeId]
  assert.equal(node.name, 'Specialist'); assert.equal(node.id, result.nodeId)
  assert.equal(Object.hasOwn(node, 'fields'), false); assert.equal(Object.hasOwn(node, 'states'), false)
  assert.deepEqual(next.objects.parent, before.objects.parent)
  assert.deepEqual(next.objects.other, before.objects.other)
  assert.deepEqual(next.relations.existing, before.relations.existing)
  assert.deepEqual(next.object_order, ['parent', 'other', result.nodeId])
  assert.equal(Object.hasOwn(next, 'relation_order'), false)
  const [[edgeId, edge]] = Object.entries(next.relations).filter(([id]) => id !== 'existing')
  assert.equal(edge.id, edgeId); assert.equal(edge.source, result.nodeId); assert.equal(edge.target, 'parent')
  assert.equal(edge.kind, 'generalization'); assert.equal(edge.name, 'Type inheritance (is a kind of)')
  assert.deepEqual(relationParents(result.nodeId, next.objects, next.relations, graph), ['parent'])
  assert.equal(relationHasCycle(edgeId, edge, next.relations, graph), false)
  assert.equal(Object.hasOwn(edge, 'source_count'), false); assert.equal(Object.hasOwn(edge, 'target_count'), false)
  assert.equal(graph.edge_defaults.kind, 'association', 'ordinary graph connection default is unchanged')
  const validate = validatorFromSchemaYaml(await readFile(new URL('schema.yaml', root), 'utf8'))
  assert.deepEqual(validate(next), { ok: true })
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next, 'JSON wire check only, not a durable save/reopen claim')
})

test('fresh submissions have stable distinct identities and tolerate absent optional relations', () => {
  const panel = localized('zh-CN'), graph = graphOf(panel), data = fixture()
  delete data.relations
  const first = planRelationHierarchyCreate(panel, data, graph, 'parent', '子类型')
  const next = applyPanelUpdatesToDraft(data, first.updates)
  const second = planRelationHierarchyCreate(panel, next, graph, 'parent', '另一子类型')
  assert.notEqual(first.nodeId, second.nodeId)
  const final = applyPanelUpdatesToDraft(next, second.updates)
  assert.deepEqual(final.objects[first.nodeId], next.objects[first.nodeId])
  assert.equal(Object.keys(final.relations).length, 2)
  assert.equal(Object.values(final.relations)[0].name, '类型继承（是一种）')
})

test('blank names, absent parent, disabled capability and unresolved translation produce no plan', () => {
  const panel = localized('en-US'), graph = graphOf(panel), data = fixture(), before = structuredClone(data)
  for (const name of ['', '  ', undefined, 7]) assert.equal(planRelationHierarchyCreate(panel, data, graph, 'parent', name), undefined)
  for (const parent of ['missing', '__proto__', 'constructor']) assert.equal(planRelationHierarchyCreate(panel, data, graph, parent, 'Child'), undefined)
  const stale = structuredClone(data); delete stale.objects.parent
  assert.equal(planRelationHierarchyCreate(panel, stale, graph, 'parent', 'Child'), undefined)
  const disabled = structuredClone(graph); delete disabled.hierarchy.create
  assert.equal(planRelationHierarchyCreate(panel, data, disabled, 'parent', 'Child'), undefined)
  assert.equal(planRelationHierarchyCreate(declared, data, graphOf(declared), 'parent', 'Child'), undefined)
  const broken = structuredClone(data); broken.relations = []
  assert.equal(planRelationHierarchyCreate(panel, broken, graph, 'parent', 'Child'), undefined)
  assert.deepEqual(data, before)
})

test('generic nested bindings preserve envelopes, unknown records and defaults with one path-keyed transaction', () => {
  const panel = {
    version: 1, panel_kind: 'capability_map',
    sections: [
      { id: 'things', title: 'Things', records_path: 'catalog.items', fields_path: 'details', order: 'catalog.order', create: { id_field: 'key', defaults: { caption: '', note: 'Node default', tags: ['local'] } } },
      { id: 'links', title: 'Links', records_path: 'catalog.links', fields_path: 'details', order: 'catalog.link_order', create: { id_field: 'key', defaults: { caption: '', note: 'Edge default' } } },
    ],
    fields: [
      { key: 'key', control: 'text', label: 'Id', readonly: true, applies_to: ['things', 'links'] },
      { key: 'caption', control: 'text', label: 'Name', applies_to: ['things', 'links'] },
      { key: 'note', control: 'text', label: 'Note', applies_to: ['things', 'links'] },
      { key: 'tags', control: 'list', label: 'Tags', applies_to: ['things'] },
      { key: 'flavor', control: 'radio', label: 'Kind', applies_to: ['links'], options: [{ value: 'extends', label: 'Refines' }, { value: 'uses', label: 'Uses' }] },
      { key: 'from', control: 'record_select', options_from_section: 'things', label: 'From', applies_to: ['links'] },
      { key: 'to', control: 'record_select', options_from_section: 'things', label: 'To', applies_to: ['links'] },
    ],
    ui: { component: 'record_workspace', id: 'workspace', sources: ['things', 'links'], children: [
      { component: 'relation_graph', id: 'graph', graph: { nodes: 'things', edges: 'links', label_field: 'caption', source_field: 'from', target_field: 'to', edge_kind_field: 'flavor', edge_defaults: { flavor: 'uses' }, hierarchy: { values: ['extends'], label: 'Parents', create: { edge_kind: 'extends', create_label: 'Add refinement', create_title: 'Refine' } } } },
      { component: 'record_inspector', id: 'details' },
    ] },
  }
  assert.deepEqual(validatePanelManifest(panel), [])
  const data = { catalog: { items: { base: { envelope: 'keep', details: { key: 'base', caption: 'Base', tags: ['parent only'] } }, malformed: 'keep for repair' }, order: ['base', 'malformed'], links: { old: { envelope: 'edge keep', details: { key: 'old', caption: 'Old', flavor: 'uses', from: 'base', to: 'base' } } }, link_order: ['old'], unrelated: 42 }, other: 'Keep' }
  const before = structuredClone(data), manifestBefore = structuredClone(panel)
  const result = planRelationHierarchyCreate(panel, data, graphOf(panel), 'base', 'Refinement')
  assert.deepEqual(Object.keys(result.updates).sort(), ['catalog.items', 'catalog.links', 'catalog.order', 'catalog.link_order'].sort())
  const next = applyPanelUpdatesToDraft(data, result.updates)
  assert.deepEqual(next.catalog.items.base, data.catalog.items.base)
  assert.equal(next.catalog.items.malformed, 'keep for repair')
  assert.deepEqual(next.catalog.links.old, data.catalog.links.old)
  assert.equal(next.catalog.unrelated, 42); assert.equal(next.other, 'Keep')
  assert.deepEqual(next.catalog.items[result.nodeId].details.tags, ['local'])
  const newEdge = Object.values(next.catalog.links).find(edge => edge.details.key !== 'old')
  assert.equal(newEdge.details.from, result.nodeId); assert.equal(newEdge.details.to, 'base')
  assert.equal(newEdge.details.caption, 'Refines'); assert.equal(newEdge.details.flavor, 'extends')
  assert.equal(newEdge.details.note, 'Edge default')
  assert.deepEqual(next.catalog.order, ['base', 'malformed', result.nodeId])
  assert.equal(next.catalog.link_order.length, 2)
  next.catalog.items[result.nodeId].details.tags.push('New only')
  assert.deepEqual(panel, manifestBefore, 'defaults are cloned rather than shared with new data')
  assert.deepEqual(data, before)
})

test('declared dependent cleanup removes only new edge quantities, keeping old associations and the parent', () => {
  const panel = localized('en-US'), graph = graphOf(panel), data = fixture()
  Object.assign(panel.sections.find(section => section.id === 'relations').create.defaults, { source_count: '1', target_count: '0..*' })
  graph.edge_defaults.source_count = '0..1'
  data.relations.existing.source_count = '1'
  const result = planRelationHierarchyCreate(panel, data, graph, 'parent', 'Child')
  const next = applyPanelUpdatesToDraft(data, result.updates)
  assert.equal(next.relations.existing.source_count, '1')
  const edge = Object.entries(next.relations).find(([id]) => id !== 'existing')[1]
  assert.equal(Object.hasOwn(edge, 'source_count'), false); assert.equal(Object.hasOwn(edge, 'target_count'), false)
  assert.deepEqual(next.objects.parent, data.objects.parent)
})

test('source Kit loader resolves the opted-in declaration and languages through its real resource channel', async () => {
  const { loadDesignKit } = await import('../../core/src/kit-loader.ts')
  const fs = {
    readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return; throw error } },
    listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
  }
  const kit = await loadDesignKit(fs, fileURLToPath(new URL('../../skills-web-app/', import.meta.url)), { sourceId: 'fixture:relation-hierarchy-create' })
  const skill = kit.skills.find(skill => skill.name === 'business_data')
  assert.ok(skill)
  const panel = parsePanelManifest(skill.metadata.panelYaml)
  for (const locale of ['zh-CN', 'en-US']) {
    const resolved = localizePanelManifest(panel, locale)
    assert.deepEqual(validatePanelManifest(resolved), [])
    assert.doesNotMatch(graphOf(resolved).hierarchy.create.create_label, /\$t:/)
    assert.ok(planRelationHierarchyCreate(resolved, fixture(), graphOf(resolved), 'parent', 'A new subtype'))
  }
})
