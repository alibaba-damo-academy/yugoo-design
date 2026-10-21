import test from 'node:test'
import assert from 'node:assert/strict'
import {
  businessLayoutColumns,
  businessTreeRoots,
  businessRelationIssue,
  businessQuantityLabel,
  businessAncestors,
  businessParentBranch,
  businessParents,
  businessRelationSentence,
  businessEdgePorts,
  reverseBusinessRelation,
} from '../src/client/panels/business-relations.ts'

// Non-research domain with a topology the reference example does NOT cover:
// a multi-parent diamond, an isolated type, and a self-association.
const ids = ['base', 'sale', 'purchase', 'summary', 'solo', 'order', 'customer']
const rel = (id, kind, source, target, extra = {}) => ({ id, kind, name: kind === 'generalization' ? '是一种' : '关联', source, target, ...extra })
const relations = [
  rel('gen-sale', 'generalization', 'sale', 'base'),
  rel('gen-purchase', 'generalization', 'purchase', 'base'),
  rel('gen-summary-sale', 'generalization', 'summary', 'sale'),
  rel('gen-summary-purchase', 'generalization', 'summary', 'purchase'),
  rel('self-dep', 'association', 'order', 'order'),
  rel('cust-order', 'association', 'customer', 'order', { source_count: '0..*', target_count: '0..*' }),
]

test('layout columns layer the relation DAG left to right for inheritance and association alike', () => {
  const columns = businessLayoutColumns(ids, relations)
  assert.deepEqual(columns, { base: 2, sale: 1, purchase: 1, summary: 0, solo: 0, order: 1, customer: 0 })
})

test('self association and association cycles contract instead of pushing columns outward', () => {
  const cyclic = businessLayoutColumns(
    ['solo', 'order', 'customer'],
    [rel('self-dep', 'association', 'order', 'order'), rel('o-c', 'association', 'order', 'customer'), rel('c-o', 'association', 'customer', 'order')],
  )
  assert.deepEqual(cyclic, { solo: 0, order: 0, customer: 0 })
  const chain = businessLayoutColumns(
    ['experiment', 'project', 'question'],
    [rel('g', 'generalization', 'experiment', 'project'), rel('a', 'association', 'project', 'question')],
  )
  assert.deepEqual(chain, { experiment: 0, project: 1, question: 2 })
})

test('tree roots are exactly the types with no parent, every type reachable', () => {
  assert.deepEqual(businessTreeRoots(ids, relations), ['base', 'solo', 'order', 'customer'])
})

test('diamond multi-parent is valid and adding a back-edge is rejected as a cycle', () => {
  assert.equal(businessRelationIssue(rel('gen-summary-sale', 'generalization', 'summary', 'sale'), relations, ids), undefined)
  const backEdge = rel('gen-base-summary', 'generalization', 'base', 'summary')
  assert.match(businessRelationIssue(backEdge, relations, ids) ?? '', /循环/)
})

test('self generalization is a cycle but self association is allowed', () => {
  assert.match(businessRelationIssue(rel('gen-order-order', 'generalization', 'order', 'order'), relations, ids) ?? '', /循环/)
  assert.equal(businessRelationIssue(rel('self-dep', 'association', 'order', 'order'), relations, ids), undefined)
})

test('unknown quantity renders undecided and never a fabricated default', () => {
  assert.equal(businessQuantityLabel(undefined), '尚未确定')
})

test('ancestor chain reveals the full parent branch for a diamond tip', () => {
  assert.deepEqual(businessAncestors('summary', relations, ids), ['sale', 'purchase', 'base'])
  assert.deepEqual(businessAncestors('base', relations, ids), [])
  assert.deepEqual(businessAncestors('solo', relations, ids), [])
})

test('parent branch presentation keeps direct parents and higher ancestors unchained', () => {
  assert.deepEqual(businessParentBranch('summary', relations, ids), { parents: ['sale', 'purchase'], higher: ['base'] })
  assert.deepEqual(businessParentBranch('sale', relations, ids), { parents: ['base'], higher: [] })
  assert.deepEqual(businessParentBranch('base', relations, ids), { parents: [], higher: [] })
  assert.deepEqual(businessParentBranch('solo', relations, ids), { parents: [], higher: [] })
})

test('diamond co-parents are never presented as an inheritance chain of each other', () => {
  const { parents, higher } = businessParentBranch('summary', relations, ids)
  assert.deepEqual(parents.filter(p => higher.includes(p)), [])
  assert.equal(businessParents('sale', relations, ids).includes('purchase'), false)
  assert.equal(businessParents('purchase', relations, ids).includes('sale'), false)
  assert.deepEqual(businessAncestors('sale', relations, ids), ['base'])
  assert.deepEqual(businessAncestors('purchase', relations, ids), ['base'])
})

test('parent branch ignores dangling and association edges, and survives cycles', () => {
  const dangling = [...relations, rel('gen-summary-ghost', 'generalization', 'summary', 'ghost')]
  assert.deepEqual(businessParentBranch('summary', dangling, ids), { parents: ['sale', 'purchase'], higher: ['base'] })
  assert.deepEqual(businessParentBranch('order', relations, ids), { parents: [], higher: [] })
  const cyclic = [...relations, rel('gen-base-summary', 'generalization', 'base', 'summary')]
  assert.deepEqual(businessParentBranch('summary', cyclic, ids).parents, ['sale', 'purchase'])
})

test('relation sentences state both directions in plain language, undecided when unknown', () => {
  const nameOf = (id) => ids.includes(id) ? id : '?'
  assert.equal(
    businessRelationSentence(relations.find(r => r.id === 'cust-order'), nameOf),
    '每个customer关联order：可以没有，也可有多个；每个order关联customer：可以没有，也可有多个',
  )
  const unknown = rel('u', 'association', 'customer', 'order')
  assert.equal(businessRelationSentence(unknown, nameOf), '每个customer关联order：尚未确定；每个order关联customer：尚未确定')
  assert.equal(businessRelationSentence(rel('g', 'generalization', 'sale', 'base'), nameOf), 'sale是一种base，沿用父类型的定义与信息')
})

test('canvas edge ports follow horizontal, vertical, reverse, and self positions', () => {
  const origin = {x: 0, y: 0}
  assert.deepEqual(businessEdgePorts(origin, {x: 370, y: 200}), {sourceHandle: 'source-right', targetHandle: 'source-left'})
  assert.deepEqual(businessEdgePorts(origin, {x: -370, y: 0}), {sourceHandle: 'source-left', targetHandle: 'source-right'})
  assert.deepEqual(businessEdgePorts(origin, {x: 0, y: 200}), {sourceHandle: 'source-bottom', targetHandle: 'source-top'})
  assert.deepEqual(businessEdgePorts(origin, {x: 0, y: -200}), {sourceHandle: 'source-top', targetHandle: 'source-bottom'})
  assert.deepEqual(businessEdgePorts(origin, origin), {sourceHandle: 'source-right', targetHandle: 'source-bottom'})
})

test('reverse endpoints with quantities, without mutating or inventing optional fields', () => {
  const original = rel('r', 'association', 'order', 'customer', {source_count:'0..*', target_count:'1'})
  const reversed = reverseBusinessRelation(original)
  assert.equal(reversed.source, 'customer')
  assert.equal(reversed.target_count, '0..*')
  assert.equal(reversed.source_count, '1')
  assert.deepEqual(reverseBusinessRelation(reversed), original)
  const inheritance = rel('g', 'generalization', 'sale', 'base')
  assert.equal('source_count' in reverseBusinessRelation(inheritance), false)
})
