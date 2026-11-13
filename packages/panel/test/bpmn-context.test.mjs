import test from 'node:test'
import assert from 'node:assert/strict'
import { bpmnElementContexts } from '../src/bpmn-context.ts'

test('BPMN context uses the actual lane and outgoing flow, without a parallel editable copy', () => {
  const submit = { id: 'submit', name: 'Submit feedback', outgoing: [{ name: 'Within scope', targetRef: { id: 'review', name: 'Lead review' } }] }
  const lane = { id: 'lane', name: 'Designer', flowNodeRef: [submit] }
  const source = [{ id: 'lane', type: 'bpmn:Lane', businessObject: lane },
    { id: 'submit', type: 'bpmn:Task', businessObject: submit },
    { id: 'submit_label', labelTarget: {}, businessObject: submit }]
  const before = structuredClone(source)
  assert.deepEqual(bpmnElementContexts(source), [{ id: 'submit', name: 'Submit feedback', performer: 'Designer', outgoing: [{ label: 'Within scope', target: 'Lead review' }] }])
  assert.deepEqual(source, before)
  submit.name = 'Revise feedback'; lane.name = 'Client'
  assert.equal(bpmnElementContexts(source)[0].name, 'Revise feedback')
  assert.equal(bpmnElementContexts(source)[0].performer, 'Client')
})

test('unnamed nodes and flows retain exact identities, without guessing roles or conditions', () => {
  const values = bpmnElementContexts([{ id: 'gateway', businessObject: { id: 'gateway', outgoing: [
    { conditionExpression: { body: 'changesScope' }, targetRef: { id: 'review' } }, {},
  ] } }])
  assert.deepEqual(values, [{ id: 'gateway', outgoing: [{ label: 'changesScope', target: 'review' }] }])
})

test('sequence flow endpoints work when optional node back-references are absent', () => {
  const contexts = bpmnElementContexts([
    { id: 'read', type: 'bpmn:Task', businessObject: { id: 'read', name: 'Read' } },
    { id: 'flow', type: 'bpmn:SequenceFlow', businessObject: { id: 'flow', name: 'Finished', sourceRef: { id: 'read' }, targetRef: { id: 'summarize', name: 'Summarize' } } },
  ])
  assert.deepEqual(contexts.find(item => item.id === 'read').outgoing, [{ label: 'Finished', target: 'Summarize' }])
})
