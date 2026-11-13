import { test } from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { placeLabels, intersects, graphLabelRanks, shortGraphLabel } = await import('../src/client/graph-labels.ts')
const { recordReach, nodeRadius, edgeReading } = await import('../src/client/graph-model.ts')
const { graphNodeLabels } = await import('../src/client/graph-node-label.ts')

test('KAG captions reuse the actual Bundle locales while preserving source facts and user titles', async () => {
  const { readFile } = await import('node:fs/promises')
  const { parsePanelManifest } = await import('../src/dsl.ts')
  const root = new URL('../../skills-web-app/bundles/function_modules/', import.meta.url)
  const manifest = parsePanelManifest(await readFile(new URL('panel.yaml', root), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(await Promise.all(Object.entries(manifest.i18n.locales).map(async ([locale, file]) =>
    [locale, JSON.parse(await readFile(new URL(file, root), 'utf8'))])))
  const panels = { sample: { panelYaml: JSON.stringify(manifest) } }
  const base = { owner: 'sample', file: 'sample/data.json', id: 'content:one', record: false, context: '用户写的原文', recordId: 'source:one', parentId: 'source:one',
    contentKind: 'container', label: '功能详情', sourceLabel: '用户写的标题', pointer: '/functions/F001/details', schemaPointer: '/properties/functions/value/properties/details', ontologyType: 'fixed:type', ontologyRevision: 'fixed:rev' }
  const before = structuredClone({ panels, base })
  const en = graphNodeLabels(panels, 'en-US'), zh = graphNodeLabels(panels, 'zh-CN')
  assert.equal(en(base), 'Function details')
  assert.equal(zh(base), '功能详情')
  assert.equal(en({ ...base, contentKind: 'unit', label: '核心行为 · B001', pointer: base.pointer + '/behaviors/B001', schemaPointer: base.schemaPointer + '/properties/behaviors/value' }), 'Core behaviors · B001')
  assert.equal(en({ ...base, contentKind: 'unit', label: '输入 · I001', pointer: base.pointer + '/inputs/I001', schemaPointer: base.schemaPointer + '/properties/inputs/value' }), 'Input · I001')
  for (const change of [
    { sourceLabel: undefined }, { sourceLabel: '功能详情' }, { contentKind: undefined }, { schemaPointer: undefined },
    { owner: 'unknown' }, { schemaPointer: '/properties/other/value/properties/details' }, { label: '用户自定义分区' },
  ]) assert.equal(en({ ...base, ...change }), change.label ?? base.label)
  assert.deepEqual({ panels, base }, before, 'locale lookup cannot mutate saved prose, schema identity or Panel declarations')

  const React = await import('react'); globalThis.React = React
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { GraphInspector } = await import('../src/client/graph-inspector.tsx')
  const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
  const parent = { ...base, id: 'source:one', label: '用户写的标题', contentKind: undefined, sourceLabel: undefined, record: true }
  const graph = { nodes: [parent, base], edges: [], checkpoint: 'fixed:commit', warnings: [] }
  for (const [locale, label, expected] of [['en-US', en, 'Function details'], ['zh-CN', zh, '功能详情']]) {
    const html = renderToStaticMarkup(React.createElement(PanelLocaleContext.Provider, { value: locale }, React.createElement(GraphInspector, {
      graph, node: parent, nodeLabel: label, relations: [], sourceLabels: {}, onClose() {}, onNode() {}, onEdge() {}, onNeighborhood() {}, onExpandEndpoints() {},
    })))
    assert.match(html, new RegExp(expected))
    assert.match(html, /用户写的标题/)
    assert.match(html, /用户写的原文/)
    if (locale === 'en-US') assert.doesNotMatch(html, />功能详情<\/button>/)
    const scalar = { ...base, id: 'scalar:one', label: 'A shortened value', pointer: '/answer', context: '/answer: 用户的完整中文回答', sourceLabel: undefined, contentKind: 'unit' }
    const edge = { id: 'example:edge', from: base.id, to: scalar.id, kind: 'knowledge', label: 'User relationship', evidence: 'Original evidence',
      reading: { relationType: 'references', meaning: 'references', origin: 'human', direction: 'forward', lifecycle: 'accepted' } }
    const relationHtml = renderToStaticMarkup(React.createElement(PanelLocaleContext.Provider, { value: locale }, React.createElement(GraphInspector, {
      graph: { ...graph, nodes: [...graph.nodes, scalar], edges: [edge] }, edge, nodeLabel: label, relations: [edge], sourceLabels: {}, onClose() {}, onNode() {}, onEdge() {}, onNeighborhood() {}, onExpandEndpoints() {},
    })))
    assert.match(relationHtml, new RegExp(expected), 'object endpoints use their resolved metadata caption')
    assert.match(relationHtml, /用户的完整中文回答/, 'scalar endpoints retain the full original value')
    assert.doesNotMatch(relationHtml, />A shortened value</)
    assert.match(relationHtml, /Original evidence/)
    if (locale === 'en-US') assert.doesNotMatch(relationHtml, />功能详情</)
  }
})

test('graph caption lookup requires unambiguous declared bindings and retains unknown inputs', () => {
  const manifest = { version: 1, panel_kind: 'evidence_workbook',
    i18n: { default_locale: 'zh-CN', locales: { 'zh-CN': 'locales/zh-CN.json', 'en-US': 'locales/en-US.json' },
      messages: { 'zh-CN': { detail: '详情', other: '详情' }, 'en-US': { detail: 'Details', other: 'Other details' } } },
    sections: [{ id: 'detail', records_path: 'items', fields_path: 'detail', title: '$t:detail' }], fields: [],
    ui: { component: 'record_workspace', id: 'list', sources: ['detail'] } }
  const node = { id: 'a', owner: 'custom', label: '详情', sourceLabel: 'Original prose', contentKind: 'container', schemaPointer: '/properties/items/items/properties/detail', pointer: '/items/0/detail' }
  const resolve = panel => graphNodeLabels({ custom: { panelYaml: JSON.stringify(panel) } }, 'en-US')
  assert.equal(resolve(manifest)(node), 'Details', 'array membership uses the same declared storage path')
  const ambiguous = structuredClone(manifest)
  ambiguous.sections.push({ ...ambiguous.sections[0], id: 'other', title: '$t:other' })
  assert.equal(resolve(ambiguous)(node), '详情', 'conflicting presentation bindings cannot choose a caption silently')
  assert.equal(graphNodeLabels({ custom: { panelYaml: 'broken: [' } }, 'en-US')(node), '详情')
  assert.equal(graphNodeLabels(undefined, 'en-US')(node), '详情')
})
test('production labels avoid each other, node obstacles and viewport boundaries', () => {
  const items = [{ id: 'a', x: 100, y: 100, w: 90, h: 24 }, { id: 'b', x: 110, y: 100, w: 90, h: 24 }]
  const obstacles = [{ x: 95, y: 95, w: 10, h: 10 }]
  const before = structuredClone(items), placed = placeLabels(items, obstacles, 350, 250)
  assert.equal(placed.length, 2)
  assert.equal(intersects(placed[0].box, placed[1].box), false)
  assert.ok(placed.every(p => !obstacles.some(o => intersects(o, p.box))))
  assert.ok(placed.every(({ box: b }) => b.x >= 8 && b.y >= 8 && b.x + b.w <= 342 && b.y + b.h <= 242))
  assert.deepEqual(placeLabels([{ id: 'too-wide', x: 5, y: 5, w: 500, h: 24 }], [], 100, 100), [])
  assert.deepEqual(items, before)
})
test('reach counts other records, never contains or duplicate evidence or self edges', () => {
  const graph = { nodes: [{ id: 'a', record: true }, { id: 'child', record: false, recordId: 'a' }, { id: 'b', record: true }], edges: [
    { from: 'a', to: 'child', kind: 'contains' }, { from: 'child', to: 'a', kind: 'semantic' },
    { from: 'child', to: 'b', kind: 'semantic' }, { from: 'a', to: 'b', kind: 'knowledge' }, { from: 'b', to: 'a', kind: 'semantic' },
  ] }
  const before = structuredClone(graph), reach = recordReach(graph)
  assert.deepEqual([...reach], [['a', 1], ['b', 1]])
  assert.equal(nodeRadius(graph.nodes[1], reach), 2)
  assert.equal(nodeRadius(graph.nodes[0], reach), Math.sqrt(15.25))
  assert.deepEqual(graph, before)
})
test('graph reading hints prefer records and linked fields without changing source content', () => {
  const graph = { nodes: [
    { id: 'plain', label: '备注', record: false },
    { id: 'long', label: '确认到场人数并且核对签到记录后再开始', record: false },
    { id: 'short', label: '现场协调', record: false },
    { id: 'record', label: '活动安排', record: true },
  ], edges: [
    { from: 'record', to: 'plain', kind: 'contains' },
    { from: 'long', to: 'short', kind: 'semantic' },
  ] }
  const before = structuredClone(graph)
  assert.deepEqual([...graphLabelRanks(graph).keys()], ['record', 'short', 'long', 'plain'])
  assert.equal(shortGraphLabel(graph.nodes[3], false, 3), '活动安排 · 3项')
  assert.equal(shortGraphLabel(graph.nodes[1], false), '确认到场人数并且核…')
  assert.equal(shortGraphLabel(graph.nodes[1], true), graph.nodes[1].label)
  assert.deepEqual(graph, before, 'presentation must never rewrite canonical names, nodes or links')
})

test('relationship details retain candidate and unknown states independently of continuous line rendering', async () => {
  const React = await import('react'); globalThis.React = React
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { GraphInspector } = await import('../src/client/graph-inspector.tsx')
  const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
  const nodes = ['a', 'b'].map(id => ({ id, label: id, owner: 'preview', file: 'preview.json', pointer: '/' + id, context: id, record: true }))
  const edge = { id: 'proposal', from: 'a', to: 'b', kind: 'knowledge', label: 'Proposed dependency', evidence: 'Original saved explanation',
    reading: { relationType: 'references', meaning: 'references', origin: 'agent', direction: 'forward', lifecycle: 'proposed' } }
  const graph = { nodes, edges: [edge], checkpoint: 'preview', warnings: [] }, before = structuredClone(graph)
  const html = renderToStaticMarkup(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(GraphInspector, {
    graph, edge, relations: [edge], sourceLabels: { preview: 'Preview' }, onClose() {}, onNode() {}, onEdge() {}, onNeighborhood() {}, onExpandEndpoints() {},
  })))
  assert.match(html, /Proposed interpretation/)
  assert.match(html, /Original saved explanation/)
  assert.deepEqual(graph, before, 'reading a continuous relationship cannot accept or rewrite the underlying proposal')
  const legacy = { kind: 'semantic' }
  assert.equal(edgeReading(legacy).lifecycle, 'unknown', 'legacy similarity is never silently accepted')
  assert.deepEqual(legacy, { kind: 'semantic' })
})
