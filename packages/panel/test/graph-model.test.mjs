import { test } from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { projectRecords, scopeGraph, structuralGroups, componentCenters, edgeSpring, relationshipGroups, readableLayout, contentDetail, edgeReading, filterRelations, graphNodeMatches, relationDirectionLabel, relationMeaningLabel } = await import('../src/client/graph-model.ts')
const node = (id, owner = 'a', record = true) => ({ id, owner, record, label: id, file: owner, pointer: '/' + id, context: '' })
const edge = (from, to, kind = 'contains') => ({ id: from + to, from, to, kind, label: kind, evidence: 'original' })
test('container detail groups persisted units and two-state expansion preserves exact endpoints', () => {
  const container = { ...node('config'), contentKind: 'container', recordId: 'config' }
  const unit = { ...node('typography', 'a', false), contentKind: 'unit', recordId: 'config', parentId: 'config', context: '/baseFontSize: 14px' }
  const graph = { nodes: [container, unit, node('page')], edges: [edge('config', 'typography'), edge('page', 'typography', 'identifier-match')] }
  assert.deepEqual(contentDetail(graph, container).children, [unit])
  assert.equal(contentDetail(graph, unit).source, container)
  assert.equal(contentDetail(graph, container).kind, '来源容器')
  assert.equal(contentDetail(graph, unit).kind, '设计单元')
  const overview = projectRecords(graph, false), expanded = projectRecords(graph, new Set(['config']))
  assert.equal(overview.nodes.length, 2); assert.equal(expanded.nodes.length, 3)
  assert.equal(overview.edges[0].members[0].to, 'typography')
  assert.equal(expanded.edges.find(e => e.kind === 'identifier-match').to, 'typography')
})
test('overview aggregates all evidence; local expansion reveals all depths and preserves other records', () => {
  const input = { nodes: [node('a'), { ...node('a1', 'a', false), recordId: 'a', parentId: 'a' }, { ...node('a2', 'a', false), recordId: 'a', parentId: 'a1' }, node('b'), { ...node('b1', 'b', false), recordId: 'b', parentId: 'b' }], edges: [edge('a','a1'), edge('a1','a2'), edge('b','b1'), edge('a1','b1','semantic'), { ...edge('a2','b1','semantic'), evidence: 'second source' }, edge('a1','a2','knowledge')] }
  const before = JSON.stringify(input)
  const overview = projectRecords(input, false)
  assert.deepEqual(overview.nodes.map(n => n.id), ['a','b'])
  assert.equal(overview.edges.length, 1); assert.equal(overview.edges[0].members.length, 2)
  assert.deepEqual(overview.edges[0].members.map(e => e.from), ['a1','a2'])
  assert.match(overview.edges[0].evidence, /original[\s\S]*second source/)
  const local = projectRecords(input, new Set(['a']))
  assert.deepEqual(local.nodes.map(n => n.id), ['a','a1','a2','b'])
  assert.ok(local.edges.some(e => e.from === 'a2' && e.to === 'b' && e.members[0].to === 'b1'))
  assert.equal(projectRecords(input, true).nodes.length, 5)
  assert.ok(projectRecords(input, true).edges.some(e => e.from === 'a2' && e.to === 'b1'))
  assert.deepEqual(projectRecords(input, new Set()), overview)
  assert.equal(JSON.stringify(input), before)
})
test('aggregating repeated evidence does not inflate counts or create self-loops', () => {
  const e = edge('a1','b','semantic')
  const input = { nodes: [node('a'), { ...node('a1','a',false), recordId:'a',parentId:'a' }, node('b')], edges: [edge('a','a1'), e, { ...e, id: 'duplicate' }, edge('a1','a','knowledge')] }
  const result = projectRecords(input, false)
  assert.equal(result.edges.length, 1); assert.equal(result.edges[0].members.length, 1)
})
test('empty content overview does not fall back to metadata nodes', () => {
  assert.equal(projectRecords({ nodes: [node('metadata', 'a', false)], edges: [] }, false).nodes.length, 0)
})
test('component packing is input-order stable and semantic springs are weaker', () => {
  const graph = { nodes: ['a','b','c','d'].map(id => node(id)), edges: [edge('a','b'), edge('b','c')], total: 4 }
  const first = componentCenters(graph), second = componentCenters({ ...graph, nodes: [...graph.nodes].reverse() })
  for (const n of graph.nodes) assert.deepEqual(first.get(n.id), second.get(n.id))
  assert.notDeepEqual(first.get('a'), first.get('d'))
  assert.ok(edgeSpring('semantic').strength < edgeSpring('contains').strength)
})
test('record projection preserves original edge evidence without mutating input', () => {
  const input = { checkpoint: 'x', warnings: [], nodes: [node('a'), node('field', 'a', false), node('b')], edges: [edge('a', 'field'), edge('field', 'b', 'knowledge')] }
  const original = JSON.stringify(input), output = projectRecords(input, false)
  assert.deepEqual(output.nodes.map(n => n.id), ['a', 'b'])
  assert.equal(output.edges[0].from, 'a'); assert.equal(output.edges[0].evidence, 'original')
  assert.equal(JSON.stringify(input), original)
})
test('scope depth, relation filters and seed priority are explicit', () => {
  const input = { nodes: ['a', 'b', 'c'].map(id => node(id)), edges: [edge('a', 'b'), edge('b', 'c', 'knowledge')], total: 3 }
  assert.deepEqual(scopeGraph(input, 'all', 'a', 1).nodes.map(n => n.id), ['a', 'b'])
  assert.equal(scopeGraph(input, 'all', 'a', 2).nodes.length, 3)
  assert.equal(scopeGraph(input, 'contains', 'c', 2).nodes.length, 1)
  assert.equal(scopeGraph(input, 'all', 'c', 2, 1).nodes[0].id, 'c')
})
test('structural components do not group unrelated nodes merely by owner', () => {
  const input = { nodes: ['a', 'b', 'c'].map(id => node(id)), edges: [edge('a', 'b')], total: 3 }
  const groups = structuralGroups(input)
  assert.equal(groups.get('a'), groups.get('b')); assert.notEqual(groups.get('a'), groups.get('c'))
})

test('dense cross-Bundle neighborhoods remain separate despite a single bridge', () => {
  const input = { nodes: ['a','b','c','d','e','f','alone'].map((id,i) => node(id, String(i%2))), edges: [
    edge('a','b','semantic'), edge('b','c','semantic'), edge('a','c','semantic'),
    edge('d','e','semantic'), edge('e','f','semantic'), edge('d','f','semantic'), edge('c','d','semantic'),
  ], total: 7 }
  const before = JSON.stringify(input), groups = relationshipGroups(input)
  assert.equal(groups.get('a'), groups.get('c'))
  assert.equal(groups.get('d'), groups.get('f'))
  assert.notEqual(groups.get('a'), groups.get('d'))
  assert.notEqual(groups.get('alone'), groups.get('a'))
  const reversed = { ...input, nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() }
  assert.deepEqual(relationshipGroups(reversed), groups)
  const first = readableLayout(input), second = readableLayout(reversed)
  for (const n of input.nodes) assert.deepEqual(first.get(n.id), second.get(n.id))
  assert.equal(JSON.stringify(input), before)
})

test('expanded descendants share record neighborhoods and no relations are synthesized', () => {
  const input = { nodes: [node('a'), {...node('a1','a',false),recordId:'a',parentId:'a'}, {...node('a2','a',false),recordId:'a',parentId:'a1'},node('b')], edges:[edge('a','a1'),edge('a1','a2'),edge('a2','b','semantic')], total:4 }
  const before = JSON.stringify(input), layout = readableLayout(input)
  for (const id of ['a1','a2']) {
    assert.equal(layout.get(id).record, 'a')
    assert.equal(layout.get(id).group, layout.get('a').group)
    assert.ok(Math.hypot(layout.get(id).x-layout.get('a').x,layout.get(id).y-layout.get('a').y) < 110)
  }
  assert.ok(Math.hypot(layout.get('b').x-layout.get('a').x,layout.get('b').y-layout.get('a').y)>300)
  assert.equal(JSON.stringify(input),before)
})

const reading = (overrides = {}) => ({ relationType: 'supports', meaning: 'supports', origin: 'agent', direction: 'forward', lifecycle: 'proposed', ...overrides })
const semanticEdge = (id, from, to, descriptor) => ({ ...edge(from, to, 'knowledge'), id, reading: descriptor })
test('record aggregation separates every reading dimension and preserves each exact member', () => {
  const edges = [
    semanticEdge('support', 'a1', 'b', reading()),
    semanticEdge('support-second', 'a2', 'b', reading()),
    semanticEdge('contradict', 'a1', 'b', reading({ relationType:'contradicts', meaning:'contradicts', direction:'symmetric' })),
    semanticEdge('reverse', 'b', 'a1', reading()),
    semanticEdge('human', 'a1', 'b', reading({ origin:'human' })),
    semanticEdge('accepted', 'a1', 'b', reading({ lifecycle:'accepted' })),
    semanticEdge('raw-other', 'a1', 'b', reading({ relationType:'supports-v2' })),
    semanticEdge('unknown-direction', 'a1', 'b', reading({ direction:'unknown' })),
    semanticEdge('other-meaning', 'a1', 'b', reading({ meaning:'custom-meaning' })),
  ]
  const graph = { nodes:[node('a'), {...node('a1','a',false), recordId:'a'}, {...node('a2','a',false), recordId:'a'}, node('b')], edges }
  const before = structuredClone(graph), overview = projectRecords(graph, false)
  assert.equal(overview.edges.length, 8)
  const combined = overview.edges.find(e => e.members.length === 2)
  assert.deepEqual(combined.members.map(e => e.id), ['support','support-second'])
  assert.deepEqual(combined.members.map(e => e.from), ['a1','a2'])
  assert.deepEqual(combined.members.map(e => e.reading), [reading(),reading()])
  assert.ok(overview.edges.some(e => e.from === 'b' && e.to === 'a' && e.reading.direction === 'forward'))
  assert.deepEqual(graph, before)
})
test('symmetric aggregation is endpoint-order stable without rewriting evidence endpoints', () => {
  const r = reading({ relationType:'semantic-similarity', meaning:'similar', origin:'embedding', direction:'symmetric' })
  const graph = { nodes:[node('a'),node('b')], edges:[semanticEdge('one','b','a',r), semanticEdge('two','a','b',r)] }
  const combined = projectRecords(graph,false).edges
  assert.equal(combined.length,1); assert.equal(combined[0].from,'a'); assert.equal(combined[0].to,'b')
  assert.deepEqual(combined[0].members.map(e=>[e.from,e.to]),[['b','a'],['a','b']])
  assert.match(relationDirectionLabel(combined[0].reading.direction),/对称/)
  assert.equal(projectRecords({...graph, edges:[...graph.edges].reverse()},false).edges[0].id,combined[0].id)
})
test('meaning and origin filters intersect before neighborhood and display limits', () => {
  const graph = { nodes:['a','b','c','d'].map(id=>node(id)), total:4, edges:[
    semanticEdge('ab','a','b',reading()),
    semanticEdge('ac','a','c',reading({origin:'file'})),
    semanticEdge('ad','a','d',reading({meaning:'similar',relationType:'semantic-similarity',origin:'embedding',direction:'symmetric'})),
  ] }
  const before = structuredClone(graph)
  assert.deepEqual(filterRelations(graph,'supports','agent').edges.map(e=>e.id),['ab'])
  assert.deepEqual(filterRelations(graph,'supports','all').edges.map(e=>e.id),['ab','ac'])
  assert.equal(filterRelations(graph,'supports','embedding').edges.length,0)
  assert.equal(filterRelations(graph,'unrecognized','all').edges.length,0)
  const neighborhood = scopeGraph(filterRelations(graph,'supports','agent'),'all','a',1,1)
  assert.equal(neighborhood.total,2); assert.deepEqual(neighborhood.nodes.map(n=>n.id),['a'])
  assert.equal(filterRelations(graph,'similar','embedding').nodes.length,4,'relation filters do not hide isolated records in the full view')
  assert.deepEqual(graph,before)
})
test('legacy and custom relations never acquire guessed authority or dependency direction', () => {
  for (const kind of ['knowledge','identifier-match','custom-old-type']) {
    const legacy = {...edge('a','b',kind),label:'confirmed dependency by human', evidence:'{"producer":"human-decision"}'}
    assert.deepEqual(edgeReading(legacy),{relationType:kind,meaning:'unknown',origin:'unknown',direction:'unknown',lifecycle:'unknown'})
  }
  assert.equal(edgeReading(edge('a','b','semantic')).meaning,'similar')
  assert.equal(edgeReading(edge('a','b','contains')).direction,'forward')
  const r = reading({relationType:'custom-unclassified',meaning:'unknown',direction:'unknown'})
  assert.deepEqual(edgeReading(semanticEdge('x','a','b',r)),r)
  assert.equal(relationMeaningLabel('custom-role-meaning'),'custom-role-meaning')
  assert.equal(relationMeaningLabel('__proto__'),'__proto__')
  assert.equal(relationMeaningLabel('constructor'),'constructor')
})
test('content search matches saved content and paths without changing records', () => {
  const n = {...node('a'), label:'Welcome',file:'pages/pages.json',pointer:'/pages/home',context:'Saved description'}
  const before = structuredClone(n)
  for (const query of [' welcome ','pages.json','/pages/home','saved description']) assert.equal(graphNodeMatches(n,query),true)
  assert.equal(graphNodeMatches(n,'absent'),false)
  assert.deepEqual(n,before)
})
