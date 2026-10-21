import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReactFlowProvider } from '@xyflow/react'
import { navigationNodeExecution } from '../src/navigation-node-state.ts'
import { NavigationRecordNode } from '../src/navigation-record-node.tsx'
import { PanelLocaleContext } from '../src/panel-i18n.tsx'
globalThis.React = React

test('generic node activity requires file evidence and tracks live attempts without writing facts', () => {
  const binding = { nodes: { artifact: 'output', artifact_kind: 'report' } }
  const path = 'any_bundle/results/a.html'
  const record = { output: path }, before = structuredClone(record)
  const options = { skill: 'any_bundle', artifactFiles: {} }
  const status = (value, extra = {}) => navigationNodeExecution('a', value, binding, { ...options, ...extra })?.status
  assert.equal(status(record), 'pending')
  assert.equal(status(record, { artifactFiles: { [path]: 'hash' } }), 'completed')
  const attempt = { invocationId: 'i', attemptId: 'attempt', runId: 'worker', artifactId: 'a', artifactKind: 'report', artifactFile: path, role: 'worker', phase: 'working', sequence: 1 }
  assert.equal(status(record, { artifactFiles: { [path]: 'hash' }, executionAttempts: [attempt] }), 'working')
  assert.equal(status(record, { artifactFiles: { [path]: 'hash' }, executionAttempts: [{ ...attempt, artifactFile: 'any_bundle/results/other.html' }] }), 'completed', 'same ID on a different bound path must not borrow live activity')
  assert.equal(status(record, { executionAttempts: [{ ...attempt, artifactFile: 'any_bundle/results/other.html', phase: 'completed' }] }), 'pending', 'same ID on a different bound path must not borrow completion')
  assert.equal(status({}, { artifactFiles: { [path]: 'hash' }, executionAttempts: [{ ...attempt, phase: 'completed' }] }), 'completed')
  assert.equal(status(record, { executionAttempts: [{ ...attempt, phase: 'completed' }] }), 'failed', 'completed event alone is not an available artifact')
  assert.equal(status({ output: 'other/output.html' }, { artifactFiles: { 'other/output.html': 'hash' } }), 'pending')
  assert.equal(status({ output: '../escape.html' }, { artifactFiles: { '../escape.html': 'hash' } }), 'pending')
  for (const output of ['other/output.html', '../escape.html']) {
    for (const phase of ['working', 'completed']) {
      assert.equal(status({ output }, { artifactFiles: { [path]: 'hash', [output]: 'hash' }, executionAttempts: [{ ...attempt, phase }] }), 'pending', 'invalid explicit path must not fall back to same-ID events')
    }
  }
  assert.equal(navigationNodeExecution('a', record, { nodes: {} }, options), undefined)
  assert.deepEqual(record, before)
})

test('node labels and entry/activity badges are escaped and localized', () => {
  for (const [locale, expected] of [['en-US', 'Entry'], ['zh-CN', '入口']]) {
    const html = renderToStaticMarkup(React.createElement(ReactFlowProvider, null,
      React.createElement(PanelLocaleContext.Provider, { value: locale },
        React.createElement(NavigationRecordNode, { data: { label: '<script>x</script>', entry: true, executionStatus: 'working' } }))))
    assert.ok(html.includes(expected))
    assert.ok(!html.includes(locale === 'en-US' ? 'Entry page' : '入口页面'))
    assert.ok(html.includes('data-execution-status="working"'))
    assert.ok(html.includes('&lt;script&gt;'))
    assert.ok(!html.includes('<script>'))
  }
})
