/** Built rule engine, synthetic graph fields; no Kit-specific dispatch. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseValidationYaml, evaluateValidationRules } from '../lib/index.js'
import { stringify } from 'yaml'

const rule = spec => ({ skill: 'custom', rules: [{ id: 'one-parent', scope: ['state', 'completion'],
  code: 'one-parent', message: 'edge {key} has competing parents', check: { single_parent_record_edges: spec } }] })
const spec = { map: 'model.links', source: 'child', target: 'parent', where: { field: 'category', equals: 'ancestry' } }
const doc = parseValidationYaml(stringify(rule(spec)))
const edge = (child, parent, category = 'ancestry') => ({ child, parent, category })
const issues = state => evaluateValidationRules(doc, { skill: 'custom', state }, 'state')

test('optional flat graph, chains and many children sharing a parent remain valid', async () => {
  for (const state of [{}, { model: { links: {} } }, { model: { links: {
    a: edge('child', 'parent'), b: edge('parent', 'root'), c: edge('sibling', 'parent'),
    unrelated: edge('child', 'other', 'reference'),
  } } }]) assert.deepEqual(await issues(state), [])
})

test('second parent and duplicate same-parent edges both report every competing edge', async () => {
  for (const second of [edge('child', 'another'), edge('child', 'parent')]) {
    const result = await issues({ model: { links: { first: edge('child', 'parent'), second } } })
    assert.equal(result.length, 2)
    assert.ok(result.some(issue => issue.message.includes('first')))
    assert.ok(result.some(issue => issue.message.includes('second')))
  }
  const unfiltered = parseValidationYaml(stringify(rule({ map: 'links', source: 'from', target: 'to' })))
  assert.equal((await evaluateValidationRules(unfiltered, { skill: 'custom', state: {
    links: { a: { from: 'x', to: 'y' }, b: { from: 'x', to: 'z' } },
  } }, 'completion')).length, 2)
})

test('the primitive admits only safe finite spec fields and cannot combine structural operators', () => {
  for (const bad of [null, {}, { ...spec, map: '__proto__.links' }, { ...spec, source: 'nested.child' },
    { ...spec, target: 'constructor' }, { ...spec, extra: true }, { ...spec, where: { field: 'category', equals: '' } },
    { ...spec, where: { field: '__proto__', equals: 'ancestry' } }, { ...spec, where: { field: 'category', equals: 'ancestry', extra: true } }]) {
    assert.throws(() => parseValidationYaml(stringify(rule(bad))), /validation.yaml/)
  }
  const both = rule(spec)
  both.rules[0].check.acyclic_record_edges = spec
  assert.throws(() => parseValidationYaml(stringify(both)), /exactly one top-level operator/)
})
