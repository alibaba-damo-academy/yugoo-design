import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { projectRecords, relationDisplayLabel, relationMeaningLabel, relationOriginLabel, relationLifecycleLabel } = await import('../src/client/graph-model.ts')
const { projectExplorationRecords, bundleDisplay } = await import('../src/client/graph-bundle-model.ts')

test('ordinary and Bundle aggregations share the display formatter without translating original labels or evidence', () => {
  const node = id => ({ id, owner: id, record: true, label: 'Original ' + id, file: 'fixture.json', pointer: '/' + id, context: '原文 context' })
  const reading = { relationType: 'supports', meaning: 'supports', origin: 'human', direction: 'forward', lifecycle: 'accepted' }
  const edge = id => ({ id, from: 'a', to: 'b', kind: 'knowledge', reading, label: 'Original label / 原文 ' + id, evidence: 'Exact evidence ' + id })
  const graph = { checkpoint: 'fixture', warnings: [], nodes: [node('a'), node('b')], edges: [edge('one'), edge('two')] }
  const before = structuredClone(graph)
  const ordinary = projectRecords(graph, false), exploration = projectExplorationRecords(graph, new Set()), folded = bundleDisplay(exploration, new Set())
  for (const aggregate of [ordinary.edges[0], exploration.edges[0], folded.edges[0]]) {
    assert.equal(aggregate.label, '支持 · 2 条原始关系', 'default Chinese projection remains readable')
    assert.equal(relationDisplayLabel(aggregate), aggregate.label, 'projection and default UI share one formatter')
    assert.equal(relationDisplayLabel(aggregate, 'en-US'), 'Supports · Original relationships: 2')
    assert.deepEqual(aggregate.members.map(member => [member.id, member.from, member.to, member.label, member.evidence]), graph.edges.map(member => [member.id, member.from, member.to, member.label, member.evidence]))
  }
  assert.equal(relationDisplayLabel(graph.edges[0], 'en-US'), graph.edges[0].label, 'an authored label is not translated')
  assert.equal(relationDisplayLabel({ ...graph.edges[0], members: [graph.edges[0]] }, 'en-US'), graph.edges[0].label)
  for (const read of [relationMeaningLabel, relationOriginLabel, relationLifecycleLabel]) assert.equal(read('custom-code / 原文', 'en-US'), 'custom-code / 原文')
  const custom = { ...ordinary.edges[0], reading: { ...reading, meaning: 'custom-meaning / 原文' } }
  assert.equal(relationDisplayLabel(custom, 'en-US'), 'custom-meaning / 原文 · Original relationships: 2')
  assert.deepEqual(graph, before, 'display and locale choices cannot change the source graph')
})
