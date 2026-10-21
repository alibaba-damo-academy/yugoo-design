/** Built-package smoke for deterministic durable execution-gate derivation. */
import assert from 'node:assert/strict'
import {
  deriveCurrentDesignExecutionGate,
  deriveDesignExecutionGate,
  DesignBundleVersion,
  DesignExecutionInvocationId,
  DesignKitVersion,
  DesignResumeActionId,
} from '../packages/core/lib/index.js'

const kitVersion = DesignKitVersion('1.0')
const projectId = '11111111-1111-4111-8111-111111111111'
let skillSequence = 0

function fixture(execution, stateStatus = 'pending') {
  skillSequence += 1
  const bundleVersion = DesignBundleVersion(`${skillSequence}.0`)
  const skill = { name: `fixture_${skillSequence}`, version: bundleVersion, description: '', content: '', execution }
  const pin = {
    projectId,
    kitName: 'fixture_kit',
    kitVersion,
    skillName: skill.name,
    bundleVersion,
    stateRevision: `state-${skillSequence}`,
  }
  const change = { ...pin, recordId: `journal-${skillSequence}`, origin: 'agent' }
  return { skill, pin, stateStatus, change }
}

{
  const input = fixture({ handoff: 'none' })
  assert.equal(deriveDesignExecutionGate(input), undefined)
}

{
  const input = fixture({ handoff: 'must_edit' })
  const first = deriveDesignExecutionGate(input)
  assert.deepEqual(deriveDesignExecutionGate(structuredClone(input)), first)
  assert.equal(first.kind, 'must_edit')
  assert.equal('afterEdit' in first, false)
  assert.equal(first.invocationId, input.change.recordId)
  assert.equal(deriveDesignExecutionGate({ ...input, change: { ...input.change, origin: 'panel' } }), undefined)
  assert.equal(deriveDesignExecutionGate({ ...input, stateStatus: 'complete' }), undefined)
}

// The handoff is durable without a runtime contribution, work item, or fan-out plan.
{
  const action = {
    routeId: DesignResumeActionId('run_research'),
    label: { zh: '开始调研', en: 'Start Research' },
  }
  const input = fixture({ handoff: 'user_continue', resumeAction: action })
  const gate = deriveDesignExecutionGate(input)
  assert.equal(gate.kind, 'user_continue')
  assert.equal(gate.action, action)
  assert.equal(deriveDesignExecutionGate({
    ...input,
    runningInvocationId: DesignExecutionInvocationId(input.change.recordId),
  }), undefined)
  assert.equal(deriveDesignExecutionGate({ ...input, stateStatus: 'complete' }), undefined)
}

{
  const input = fixture({ handoff: 'must_edit' })
  assert.throws(
    () => deriveDesignExecutionGate({ ...input, change: { ...input.change, skillName: 'unrelated' } }),
    /exact authoritative pin/,
  )
  assert.throws(
    () => deriveDesignExecutionGate({ ...input, change: { ...input.change, kitName: 'unrelated_kit' } }),
    /exact authoritative pin/,
  )
  assert.throws(
    () => deriveDesignExecutionGate({ ...input, skill: { ...input.skill, name: 'unrelated' } }),
    /compiled Bundle/,
  )
}

// Runtime publication authority, never a Bundle business-stage field, decides
// whether the current workspace exposes a user-continue gate.
{
  const action = {
    routeId: DesignResumeActionId('execute_plan'),
    label: { zh: '继续', en: 'Continue' },
  }
  const skill = {
    name: 'research',
    version: DesignBundleVersion('1.0'),
    description: '',
    content: '',
    execution: { handoff: 'user_continue', resumeAction: action },
  }
  const kit = { name: 'fixture_kit', version: kitVersion, mindset: '', skills: [skill], resources: {} }
  const base = {
    projectId,
    records: [],
    kit,
    skill,
    stateRevision: 'project-head',
    state: { current_round_id: 'round-1', rounds: { 'round-1': { stage: 'confirmed' } } },
    signal: new AbortController().signal,
  }
  const publication = (stateStatus, invocationId) => ({
    commit: `research-${stateStatus}`,
    execution: {
      skill: 'research',
      bundleVersion: skill.version,
      invocationId,
      stateStatus,
      handoff: stateStatus === 'pending' ? 'user_continue' : 'none',
    },
  })
  const pending = await deriveCurrentDesignExecutionGate({
    ...base,
    store: {
      readLatestPublishedExecutionForSkillAt: async () => publication('pending', 'research-run-1'),
      samePublishedFileAt: async () => false,
    },
  })
  assert.equal(pending?.kind, 'user_continue')
  assert.equal(pending?.invocationId, 'research-run-1')
  assert.equal(await deriveCurrentDesignExecutionGate({
    ...base,
    store: {
      readLatestPublishedExecutionForSkillAt: async () => publication('complete', 'research-run-1'),
      samePublishedFileAt: async () => false,
    },
  }), undefined, 'completed publication suppresses the gate even while Research JSON remains confirmed')
}

console.log('DESIGN EXECUTION DERIVATION OK')
