import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { projectRecords, relationDisplayLabel, relationMeaningLabel, relationOriginLabel, relationLifecycleLabel } = await import('../src/client/graph-model.ts')
const { projectExplorationRecords, bundleDisplay } = await import('../src/client/graph-bundle-model.ts')

test('system-produced single relations follow the interface locale without changing original evidence', () => {
  const edge = (kind, label, reading) => ({ id: kind, from: 'a', to: 'b', kind, label, evidence: '原始证据 exact bytes', ...(reading ? { reading } : {}) })
  const sources = [
    [edge('contains', '包含内容'), 'Contains', '包含'],
    [edge('semantic', '语义相近（候选） 0.921'), 'Similarity candidate', '相似候选'],
    [edge('identifier-match', '标识符匹配（非业务确认）'), 'Identifier match (unconfirmed)', '标识符匹配（非业务确认）'],
    [edge('identifier-match', '来源引用（非确认）', { relationType: 'references', meaning: 'references', origin: 'file', direction: 'forward', lifecycle: 'observed' }), 'Source reference (unconfirmed)', '来源引用（非确认）'],
    [{ ...edge('knowledge', '来源引用（非确认）', { relationType: 'references', meaning: 'references', origin: 'file', direction: 'forward', lifecycle: 'observed' }), id: 'source-ref:stored' }, 'Source reference (unconfirmed)', '来源引用（非确认）'],
    [edge('knowledge', '引用产物', { relationType: 'references-artifact', meaning: 'references', origin: 'file', direction: 'forward', lifecycle: 'observed' }), 'Artifact reference', '引用产物'],
  ]
  for (const [source, en, zh] of sources) {
    const original = structuredClone(source)
    for (const displayed of [source, { ...source, members: [source] }]) {
      assert.equal(relationDisplayLabel(displayed, 'en-US'), en)
      assert.equal(relationDisplayLabel(displayed, 'zh-CN'), zh)
    }
    assert.deepEqual(source, original)
  }
  const authored = edge('knowledge', '人工命名 unchanged', { relationType: 'references-artifact', meaning: 'references', origin: 'human', direction: 'forward', lifecycle: 'accepted' })
  assert.equal(relationDisplayLabel(authored, 'en-US'), authored.label)
})

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
