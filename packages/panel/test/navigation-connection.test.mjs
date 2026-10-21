import test from 'node:test'
import assert from 'node:assert/strict'
import { canCreateNavigationConnection, newNavigationConnectionLabel } from '../src/navigation-connection.ts'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('directed endpoint policy is opt-in and does not rewrite existing records', () => {
  const binding = { nodes: { path: 'things' }, edges: { path: 'relations', source: 'from', target: 'to' } }
  const data = { things: { a: {}, b: {} }, relations: { r: { from: 'a', to: 'b', port: 'left' },
    loop: { from: 'a', to: 'a' }, dangling: { from: 'missing', to: 'a' } } }
  const before = structuredClone(data)
  assert.equal(canCreateNavigationConnection(data, binding, 'a', 'a'), true)
  assert.equal(canCreateNavigationConnection(data, binding, 'a', 'b'), true)
  binding.connection_policy = { allow_self: false, allow_parallel: false }
  assert.equal(canCreateNavigationConnection(data, binding, 'a', 'a'), false)
  assert.equal(canCreateNavigationConnection(data, binding, 'a', 'b'), false)
  assert.equal(canCreateNavigationConnection(data, binding, 'b', 'a'), true, 'reverse is a distinct directed relation')
  for (const endpoint of [null, undefined, '', 'missing', '__proto__']) {
    assert.equal(canCreateNavigationConnection(data, binding, endpoint, 'a'), false)
    assert.equal(canCreateNavigationConnection(data, binding, 'a', endpoint), false)
  }
  binding.connection_policy = { allow_parallel: true, allow_self: false }
  assert.equal(canCreateNavigationConnection(data, binding, 'a', 'b'), true)
  assert.equal(canCreateNavigationConnection(data, binding, 'a', 'a'), false)
  binding.connection_policy = { allow_self: true }
  assert.equal(canCreateNavigationConnection(data, binding, 'a', 'a'), true)
  assert.deepEqual(data, before)
})

test('non-Page creation labels use explicit endpoint fields without changing saved labels or interpreting values', () => {
  const binding = { nodes: { path: 'things', label: 'caption' }, edges: { path: 'relations', source: 'from', target: 'to', label: 'meaning' } }
  const data = { things: { a: { caption: '<Alpha>' }, b: { caption: '{source} & Beta' }, c: {} },
    relations: { existing: { meaning: 'Authored label', from: 'a', to: 'b' } } }
  const before = structuredClone(data)
  assert.equal(newNavigationConnectionLabel(data, binding, 'a', 'b'), undefined, 'omission retains section defaults')
  binding.edges.new_label = '{source} → {target}'
  assert.equal(newNavigationConnectionLabel(data, binding, 'a', 'b'), '<Alpha> → {source} & Beta')
  const markup = renderToStaticMarkup(React.createElement('span', null, newNavigationConnectionLabel(data, binding, 'a', 'b')))
  assert.ok(markup.includes('&lt;Alpha&gt;') && markup.includes('&amp; Beta'), 'record labels remain escaped text')
  assert.equal(newNavigationConnectionLabel(data, binding, 'a', 'c'), '<Alpha> → c')
  binding.edges.new_label = '前往{target}'
  assert.equal(newNavigationConnectionLabel(data, binding, 'a', 'b'), '前往{source} & Beta')
  assert.deepEqual(data, before)
  const updated = { ...data, things: { ...data.things, b: { caption: 'Current target' } } }
  assert.equal(newNavigationConnectionLabel(updated, binding, 'a', 'b'), '前往Current target', 'creation reads current endpoint labels')
  assert.equal(updated.relations.existing.meaning, 'Authored label')
})
