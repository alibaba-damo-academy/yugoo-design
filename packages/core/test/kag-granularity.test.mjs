import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { register } = await import('tsx/esm/api'); register()
const { projectDesignGraph } = await import('../src/design-graph.ts')
const { knowledgeSemanticInput } = await import('../src/design-knowledge-semantic.ts')
const { parseSchemaYaml, compileSchema } = await import('../src/schema.ts')
const style = 'style/style.json', page = 'page/page.json'
const schemas = {
  [style]: { type: 'object', properties: { config: { type: 'object', properties: {
    theme: { type: 'string' }, patterns: { type: 'map', value: { type: 'object', properties: { description: { type: 'string' } } } },
  } } } },
  [page]: { type: 'object', properties: { pages: { type: 'map', value: { type: 'object', properties: {
    name: { type: 'string' }, pattern: { type: 'string', knowledge: { role: 'reference', target: style + '#/config/patterns' } },
  } } } } },
}
const snapshot = graph => ({ entities: graph.nodes.map(n => ({ id: n.id, label: n.label, entityType: n.record ? 'design-record' : 'design-content',
  provenance: { producer: 'design-file-projection', checkpoint: graph.checkpoint }, properties: { projection: 'design-files-v1', ...n } })), relations: [] })

test('referenced nested identity survives identical ancestor text and settings-only contents', () => {
  const build = (theme, pattern) => projectDesignGraph({ [style]: { config: { theme, patterns: { card: pattern } } }, [page]: { pages: { a: { name: 'Page', pattern: 'card' } } } }, 'c', schemas, { purpose: 'storage' })
  const first = build('Workspace', { description: 'Card' })
  for (const content of [{ description: 'Card' }, { size: 14 }, { id: 'F-001' }, { nested: { color: '#fff' } }]) {
    const graph = build('Card', content), target = graph.nodes.find(n => n.pointer === '/config/patterns/card')
    assert.ok(target)
    assert.equal(target.id, first.nodes.find(n => n.pointer === target.pointer).id)
    assert.equal(graph.edges.filter(e => e.kind === 'identifier-match' && e.to === target.id).length, 1)
  }
})

test('canonical and persisted semantic inputs share scoped context, unique fields and ancestor invalidation', () => {
  const build = theme => projectDesignGraph({ [style]: { config: { theme, patterns: {
    card: { description: 'Card', states: ['default'], size: '14px' },
    button: { description: 'Button', states: ['default'], size: '14px' },
  } } } }, 'c', schemas)
  const graph = build('Workspace'), input = knowledgeSemanticInput(snapshot(graph), 'c')
  assert.deepEqual(new Map(graph.semanticUnits.map(u => [u.id, u.text])), new Map(input.semanticUnits.map(u => [u.id, u.text])))
  const units = input.semanticUnits.filter(u => u.fieldPointers.some(p => p.endsWith('/states/0')))
  assert.equal(units.length, 2); assert.notEqual(units[0].text, units[1].text)
  assert.match(units[0].text, /Workspace/); assert.match(units[0].text, /patterns\/card\/states\/0/)
  const occurrences = new Map()
  for (const unit of input.semanticUnits) for (const pointer of unit.fieldPointers) occurrences.set(pointer, (occurrences.get(pointer) ?? 0) + 1)
  assert.ok([...occurrences.values()].every(n => n === 1))
  const later = knowledgeSemanticInput(snapshot(build('Changed workspace')), 'c')
  for (const unit of units) assert.notEqual(later.semanticUnits.find(u => u.id === unit.id).digest, unit.digest)
})

test('persisted content containers and units retain root ownership independently of semantic kind', () => {
  const files = {}, declared = {}
  for (const granularity of ['container', 'unit']) {
    const file = `${granularity}/${granularity}.json`
    files[file] = { entries: { a: { title: '采购方案', details: { purpose: '统一供应商资料', owner: '采购部' } } } }
    declared[file] = { type: 'object', properties: { entries: { type: 'map', value: {
      type: 'object', knowledge: { role: 'content', granularity, label: '采购方案' },
      properties: { title: { type: 'string' }, details: { type: 'object' } },
    } } } }
  }
  const graph = projectDesignGraph(files, 'checkpoint', declared, { purpose: 'storage' })
  assert.ok(graph.nodes.some(node => node.record && node.recordKind === 'design-content' && node.contentKind === 'container'))
  assert.ok(graph.nodes.some(node => node.record && node.recordKind === 'design-content' && node.contentKind === 'unit'))
  assert.ok(graph.nodes.some(node => !node.record), 'fixture includes nested content, which must remain subordinate')
  const saved = snapshot(graph)
  // Match materializeDesignFilesKnowledge: stores kind and owner identity, not
  // the graph's transient record flag. Also retain ordinary records/artifacts.
  for (const entity of saved.entities) {
    entity.entityType = entity.properties.recordKind
    delete entity.properties.record
  }
  for (const kind of ['design-record', 'design-artifact']) saved.entities.push({
    id: kind, label: kind, entityType: kind,
    provenance: { producer: 'design-file-projection', checkpoint: 'checkpoint' },
    properties: { projection: 'design-files-v1', file: 'source/source.json', pointer: '', recordId: kind, fields: [], recordKind: kind },
  })
  const restored = knowledgeSemanticInput(saved, 'checkpoint', false)
  for (const node of graph.nodes) {
    const loaded = restored.nodes.find(candidate => candidate.id === node.id)
    assert.equal(loaded.record, node.record, node.pointer)
    assert.equal(loaded.recordKind, node.recordKind)
    assert.equal(loaded.recordId, node.recordId)
    assert.deepEqual(loaded.fields, node.fields)
  }
  assert.ok(restored.nodes.filter(node => node.id === 'design-record' || node.id === 'design-artifact').every(node => node.record))
  assert.ok(restored.nodes.every(node => node.record || restored.nodes.some(owner => owner.record && owner.id === node.recordId)),
    'every nested node remains reachable through its visible overview root')
})

test('targetless references retain unique candidates but never guess among ambiguous IDs or revive excluded contents', () => {
  const spec = structuredClone(schemas); delete spec[page].properties.pages.value.properties.pattern.knowledge.target
  for (const content of [{ description: 'Card' }, { size: 14 }, { id: 'F-001' }]) {
    const files = { [style]: { config: { theme: 'Card', patterns: { card: content } } }, [page]: { pages: { a: { name: 'Page', pattern: 'card' } } } }
    for (const withSchema of [true, false]) {
      const selected = withSchema ? spec : { [page]: spec[page] }
      const run = extra => projectDesignGraph({ ...files, ...extra }, 'c', selected, { purpose: 'storage' })
      const graph = run({}); assert.equal(graph.edges.filter(e => e.kind === 'identifier-match').length, 1)
      const ambiguous = run({ 'other/other.json': { patterns: { card: content } } })
      assert.equal(ambiguous.edges.filter(e => e.kind === 'identifier-match').length, 0)
      assert.ok(ambiguous.warnings.some(w => w.includes('多个候选')))
    }
  }
  for (const excluded of [{ description: 'Card', deleted: true }, { description: 'Card', rejected: true }, { prompt: 'Card?', answer: '', choices: [] }]) {
    const graph = projectDesignGraph({ [style]: { config: { theme: 'Card', patterns: { card: excluded } } }, [page]: { pages: { a: { name: 'Page', pattern: 'card' } } } }, 'c', spec, { purpose: 'storage' })
    assert.ok(!graph.nodes.some(n => n.pointer === '/config/patterns/card'))
  }
  const array = projectDesignGraph({ [style]: { config: { theme: 'Card', patterns: [{ id: 'card', description: 'Card' }] } }, [page]: { pages: { a: { name: 'Page', pattern: 'card' } } } }, 'c', { [page]: spec[page] }, { purpose: 'storage' })
  assert.equal(array.edges.filter(e => e.kind === 'identifier-match').length, 1)
  const top = projectDesignGraph({ [style]: { patterns: { card: { id: 'card' } } }, [page]: { pages: { a: { name: 'Page', pattern: 'card' } } } }, 'c', { [page]: spec[page] })
  assert.equal(top.edges.filter(e => e.kind === 'identifier-match').length, 1)
})

test('content declaration changes projection only; units own properties without losing source fields', () => {
  const content = { type: 'object', knowledge: { role: 'content', granularity: 'unit', label: '设计单元' }, properties: {
    name: { type: 'string' }, values: { type: 'object', knowledge: { role: 'content', granularity: 'property' } },
    debug: { type: 'string', knowledge: { role: 'metadata' } },
  } }
  for (const bundle of ['policy', 'research', 'notification']) {
    const file = `${bundle}/${bundle}.json`, spec = { type: 'object', properties: { entries: { type: 'map', value: content } } }
    const root = { entries: { a: { name: 'Example', values: { size: '14px', color: '#fff', count: 4, enabled: false, states: ['default', 'hover'] }, debug: 'not evidence' } } }
    const parsed = parseSchemaYaml(JSON.stringify(spec)), plain = JSON.parse(JSON.stringify(spec), (k, v) => k === 'knowledge' ? undefined : v)
    for (const input of [root, {}, { entries: 1 }]) assert.deepEqual(compileSchema(parsed)(input), compileSchema(plain)(input))
    const graph = projectDesignGraph({ [file]: root }, 'c', { [file]: parsed }, { purpose: 'storage' })
    assert.equal(graph.nodes.length, 1); assert.equal(graph.nodes[0].contentKind, 'unit')
    assert.equal(graph.nodes[0].fields.length, 7); assert.ok(!JSON.stringify(graph).includes('not evidence'))
    const units = knowledgeSemanticInput(snapshot(graph), 'c').semanticUnits
    assert.equal(units.length, 1); assert.match(units[0].text, /14px/); assert.match(units[0].text, /#fff/); assert.match(units[0].text, /default/)
  }
  for (const annotation of [
    { role: 'content' }, { role: 'content', granularity: 'unknown' }, { role: 'content', granularity: 'unit', label: '' },
    { role: 'content', granularity: 'unit', target: '#/x' }, { role: 'metadata', granularity: 'unit' },
  ]) assert.throws(() => parseSchemaYaml(JSON.stringify({ type: 'object', knowledge: annotation })), /knowledge/)
})

test('actual style schema groups complete settings and preserves component identities and references', async () => {
  const styleFile = 'design_style/design_style.json'
  const spec = parseSchemaYaml(await readFile(webAppBundleUrl('design_style/schema.yaml'), 'utf8'))
  const plain = JSON.parse(JSON.stringify(spec), (k, v) => k === 'knowledge' && v.role === 'content' ? undefined : v)
  const pageSpec = structuredClone(schemas[page]); pageSpec.properties.pages.value.properties.pattern.knowledge.target = styleFile + '#/config/component_patterns'
  const files = { [styleFile]: { epoch: 1, config: { theme: 'Workspace', colors: { primary: '#abc', bg: '#fff' }, typography: { baseFontSize: '14px' },
    brand: { name: 'A' }, component_patterns: { card: { description: 'Card', states: ['default', 'hover'] }, button: { description: 'Button', states: ['default'] } } } },
    [page]: { pages: { a: { name: 'Page', pattern: 'card' } } } }
  const run = s => projectDesignGraph(files, 'c', { [styleFile]: s, [page]: pageSpec }, { purpose: 'storage' })
  const before = run(plain), after = run(spec)
  const fields = g => [...new Set(g.nodes.flatMap(n => n.fields.map(f => `${n.file}#${f.pointer}:${f.text}`)))].sort()
  assert.deepEqual(fields(after), fields(before))
  const root = after.nodes.find(n => n.pointer === '/config')
  assert.equal(root.label, '设计风格配置'); assert.equal(root.contentKind, 'container')
  assert.ok(after.nodes.some(n => n.pointer === '/config/colors' && n.contentKind === 'unit'))
  assert.ok(!after.nodes.some(n => n.label === '14px' || n.label === 'default'))
  const target = after.nodes.find(n => n.pointer === '/config/component_patterns/card')
  assert.equal(target.label, '组件模式 · card')
  assert.equal(target.id, before.nodes.find(n => n.pointer === target.pointer).id)
  assert.equal(after.edges.find(e => e.kind === 'identifier-match').to, target.id)
  const input = knowledgeSemanticInput(snapshot(after), 'c')
  assert.equal(new Set(input.semanticUnits.flatMap(u => u.fieldPointers.map(p => u.file + '#' + p))).size, fields(after).length)
})

test('content policy is depth-independent for object, map, array and scalar roots within canonical objects', () => {
  const shapes = [
    [{ type: 'map', value: { type: 'object' } }, { red: { value: '#f00' }, blue: { value: '#00f' } }],
    [{ type: 'array', items: { type: 'object' } }, [{ id: 'red', value: '#f00' }, { id: 'blue', value: '#00f' }]],
    [{ type: 'object' }, { number: 12, enabled: true }],
    [{ type: 'string' }, 'default'],
  ]
  for (const [shape, value] of shapes) for (const granularity of ['unit', 'property', ...(shape.type === 'string' ? [] : ['container'])]) {
    const item = { ...shape, knowledge: { role: 'content', granularity, label: 'Palette' } }
    const roots = [
      [{ values: value }, { type: 'object', properties: { values: item } }, '/values'],
      [{ config: { values: value } }, { type: 'object', properties: { config: { type: 'object', properties: { values: item } } } }, '/config/values'],
    ]
    for (const [root, schema, pointer] of roots) {
      const g = projectDesignGraph({ [style]: root }, 'c', { [style]: schema }, { purpose: 'storage' })
      const expected = JSON.stringify(value)
      assert.ok(g.nodes.flatMap(n => n.fields).length, expected)
      if (granularity === 'property') assert.ok(!g.nodes.some(n => n.pointer === pointer || n.pointer.startsWith(pointer + '/')))
      else assert.ok(g.nodes.some(n => n.pointer === pointer && n.label === 'Palette' && n.contentKind === granularity), pointer)
      if (granularity === 'unit') assert.ok(!g.nodes.some(n => n.pointer.startsWith(pointer + '/')))
      const input = knowledgeSemanticInput(snapshot(g), 'c'), fieldIds = input.semanticUnits.flatMap(u => u.fieldPointers)
      assert.equal(fieldIds.length, new Set(fieldIds).size)
    }
  }
  const rootSchema = { type: 'object', knowledge: { role: 'content', granularity: 'unit', label: 'Whole record' }, properties: { items: { type: 'map', value: { type: 'object' } } } }
  const root = projectDesignGraph({ [style]: { items: { a: { value: 1 }, b: { value: 2 } } } }, 'c', { [style]: rootSchema }, { purpose: 'storage' })
  assert.equal(root.nodes.length, 1); assert.equal(root.nodes[0].pointer, '')
  assert.equal(root.nodes[0].contentKind, 'unit')
})
