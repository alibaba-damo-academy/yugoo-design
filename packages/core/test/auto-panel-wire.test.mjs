import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TYPERT_REMOTE } from '../src/typert.remote-client.ts'

function descriptor(method) {
  const found = TYPERT_REMOTE.descriptors.find(item => item.method === method)
  assert.ok(found, `${method} descriptor`)
  return found
}

test('workspace wire retains generated auto Panel and progress instead of stripping them', () => {
  const schema = descriptor('readWorkspace').result.create()
  const state = {
    projectId: 'p1', projectName: 'pilot', projectPath: '/tmp/pilot', checkpoint: 'abc', worktreeRevision: 'worktree:abc',
    executionRevision: 0, executionAttempts: [], access: { mode: 'writable', writable: true, kit: { name: 'web_app', version: '1.0' } },
    journalRevision: 0, design: {}, continuations: [], clarity: { assessment: null, needsReassessment: false },
    autoPanelManifests: { smart_questions: '{"version":1}' },
    autoPanelDefinitions: { smart_questions: { origin: 'retained', definitionRevision: 'pin', sourceChanged: true }, broken: { error: 'incompatible' } },
    autoPanelStates: { smart_questions: { phase: 'ready', target: 'revision-1', attempts: 2,
      durationMs: 21900, fallbackReason: 'invalid layout' } },
  }
  const decoded = schema.parse(state)
  assert.deepEqual(decoded.autoPanelManifests, state.autoPanelManifests)
  assert.deepEqual(decoded.autoPanelStates, state.autoPanelStates)
  assert.deepEqual(decoded.autoPanelDefinitions, state.autoPanelDefinitions)
})

test('save wire accepts only the explicit auto before-state envelope', () => {
  const schema = descriptor('savePanel').parameters.find(item => item.name === 'artifacts')?.codec.create()
  assert.ok(schema)
  assert.deepEqual(schema.parse({ autoBefore: { questions: {} } }), { autoBefore: { questions: {} } })
  assert.throws(() => schema.parse({ autoBefore: {}, allowAll: true }))
  assert.deepEqual(schema.parse({ autoBefore: {}, definitionRevision: 'pin' }), { autoBefore: {}, definitionRevision: 'pin' })
})

test('retention wire accepts identity pins but never a caller-supplied definition or file path', () => {
  const method = descriptor('retainAutoPanel')
  const parameter = method.parameters.find(item => item.name === 'request')
  assert.equal(parameter.source, 'json')
  const request = { projectId: 'project', skill: 'inventory', sourceRevision: 'source', definitionRevision: 'layout' }
  assert.deepEqual(parameter.codec.create().parse(request), request)
  assert.throws(() => parameter.codec.create().parse({ ...request, dsl: '{}' }))
  assert.throws(() => parameter.codec.create().parse({ ...request, path: '/outside' }))
  assert.throws(() => parameter.codec.create().parse({ skill: 'inventory' }))
  assert.deepEqual(method.result.create().parse({ retained: true }), { retained: true })
})

test('live Knowledge status is exposed to the Panel remote without losing lifecycle fields', () => {
  const schema = descriptor('readKnowledgeStatus').result.create()
  const status = {
    schemaVersion: 1, project: 'project-1', head: 'head-2', state: 'running', phase: 'semantic', freshness: 'different',
    latestComplete: { checkpoint: 'head-1', revision: 'revision-1', warningCount: 2 },
    recovery: { state: 'ready', message: 'ready', generation: 'generation-2' },
    semanticLayer: 'enabled',
  }
  assert.deepEqual(schema.parse(status), status)
  assert.equal(schema.parse(undefined), undefined)
  assert.throws(() => schema.parse({ ...status, state: 'done' }))
})
