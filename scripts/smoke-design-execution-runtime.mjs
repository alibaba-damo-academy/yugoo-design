/** Built-package smoke for the host-neutral Design Producer lifecycle. */
import assert from 'node:assert/strict'
import {
  continueAfterDesignPanelEdit,
  DesignBundleVersion,
  DesignExecutionInvocationId,
  DesignKitVersion,
  DesignResumeActionId,
  engageDesignExecution,
  resolveDesignExecutionInput,
  resumeDesignExecution,
} from '../packages/core/lib/index.js'

const kitVersion = DesignKitVersion('1.0')
const projectId = '11111111-1111-4111-8111-111111111111'
const signal = new AbortController().signal
const input = { brief: 'Do the work.', currentDesignState: '{}', userContext: 'Keep the current direction.' }
let versionSequence = 0

for (const invalid of ['', '-leading', 'contains space', 'a'.repeat(257)]) {
  assert.throws(() => DesignExecutionInvocationId(invalid), /invalid Design execution invocation id/)
}

function fixture(policy) {
  versionSequence += 1
  const version = DesignBundleVersion(`${versionSequence}.0`)
  const invocationId = DesignExecutionInvocationId(`invocation-${versionSequence}`)
  const skill = { name: 'fixture', version, description: 'fixture', content: 'fixture', execution: policy }
  const kit = { name: 'fixture_kit', version: kitVersion, mindset: 'fixture', skills: [skill], resources: {} }
  return {
    selection: { invocationId, projectId, kit, kitVersion, skillName: skill.name, bundleVersion: version, stateRevision: 'state-1' },
  }
}

function producer(...settlements) {
  const calls = []
  return {
    calls,
    value: {
      async run(request) {
        calls.push(request)
        const settlement = settlements.shift()
        if (settlement === undefined) throw new Error('unexpected Producer run')
        return typeof settlement === 'function' ? settlement() : settlement
      },
    },
  }
}

// A Producer with nested Delegation disabled still completes the Bundle.
{
  const { selection } = fixture({ handoff: 'none' })
  const host = producer({ kind: 'committed', stateRevision: 'state-complete', stateStatus: 'complete' })
  const transition = await engageDesignExecution(selection, input, signal, { producer: host.value })
  assert.equal(transition.kind, 'complete')
  assert.equal(transition.pin.stateRevision, 'state-complete')
  assert.equal(host.calls.length, 1)
  assert.equal(host.calls[0].mode, 'engage')
  assert.deepEqual(host.calls[0].input, input)
}

// The controller remains attached until the Producer's Promise settles.
{
  const { selection } = fixture({ handoff: 'none' })
  let release
  const settlement = new Promise((resolve) => { release = resolve })
  const host = producer(() => settlement)
  let returned = false
  const transition = engageDesignExecution(selection, input, signal, { producer: host.value })
    .then((value) => { returned = true; return value })
  await Promise.resolve()
  assert.equal(returned, false)
  release({ kind: 'committed', stateRevision: 'state-attached', stateStatus: 'complete' })
  assert.equal((await transition).pin.stateRevision, 'state-attached')
}

{
  const { selection } = fixture({ handoff: 'must_edit' })
  const host = producer({ kind: 'committed', stateRevision: 'state-produced', stateStatus: 'pending' })
  const waiting = await engageDesignExecution(selection, input, signal, { producer: host.value })
  assert.deepEqual({ kind: waiting.kind, gate: waiting.gate.kind }, { kind: 'await_user', gate: 'must_edit' })
  assert.equal('afterEdit' in waiting.gate, false)
  await assert.rejects(
    continueAfterDesignPanelEdit(waiting.gate, { ...selection, stateRevision: 'state-produced' }),
    /revision change/,
  )
  const completed = await continueAfterDesignPanelEdit(
    waiting.gate,
    { ...selection, stateRevision: 'state-after-edit' },
  )
  assert.equal(completed.kind, 'complete')
  assert.equal(completed.pin.stateRevision, 'state-after-edit')
  assert.equal(host.calls.length, 1, 'panel save consumes the gate without a second Producer run')
}

// user_continue is a manifest handoff, not evidence of fan-out execution.
{
  const action = {
    routeId: DesignResumeActionId('execute_plan'),
    label: { zh: '开始调研', en: 'Start Research' },
    aliases: { zh: ['执行调研计划'], en: ['Run the plan'] },
  }
  const { selection } = fixture({ handoff: 'user_continue', resumeAction: action })
  const host = producer(
    { kind: 'committed', stateRevision: 'state-plan', stateStatus: 'pending' },
    { kind: 'committed', stateRevision: 'state-research', stateStatus: 'complete' },
  )
  const waiting = await engageDesignExecution(selection, input, signal, { producer: host.value })
  assert.equal(waiting.gate.kind, 'user_continue')
  assert.deepEqual(resolveDesignExecutionInput(waiting.gate, { kind: 'chat', text: 'add mobile scope' }), {
    kind: 'ordinary_input', text: 'add mobile scope',
  })
  const resolved = resolveDesignExecutionInput(waiting.gate, { kind: 'chat', text: ' RUN THE PLAN！ ' })
  assert.equal(resolved.kind, 'command')
  await assert.rejects(resumeDesignExecution(resolved.command, selection, signal, host.value), /stale/)
  const completed = await resumeDesignExecution(
    resolved.command,
    { ...selection, stateRevision: 'state-plan' },
    signal,
    host.value,
  )
  assert.equal(completed.kind, 'complete')
  assert.equal(completed.pin.stateRevision, 'state-research')
  assert.equal(host.calls[1].mode, 'resume')
  assert.equal(host.calls[1].input, undefined)
  assert.throws(
    () => resolveDesignExecutionInput(waiting.gate, { kind: 'action', routeId: 'wrong_route' }),
    /does not match/,
  )
}

// A legacy ordinary gate can be resumed explicitly as reconstruction.
{
  const action = {
    routeId: DesignResumeActionId('continue_reconstruction'),
    label: { zh: '继续重建', en: 'Continue reconstruction' },
  }
  const { selection } = fixture({ handoff: 'user_continue', resumeAction: action })
  const host = producer(
    { kind: 'committed', stateRevision: 'state-plan', stateStatus: 'pending' },
    { kind: 'committed', stateRevision: 'state-reconstructed', stateStatus: 'complete' },
  )
  const waiting = await engageDesignExecution(selection, input, signal, { producer: host.value })
  const resolved = resolveDesignExecutionInput(waiting.gate, { kind: 'action', routeId: action.routeId })
  const completed = await resumeDesignExecution(
    resolved.command,
    { ...selection, stateRevision: 'state-plan' },
    signal,
    host.value,
    { reconstruct: true, reconstructionSourceRoot: '/workspace/source', brief: 'Restore implemented screens from src/panel.ts; preserve host boundary.' },
  )
  assert.equal(completed.kind, 'complete')
  assert.equal(host.calls[1].skill.execution.handoff, 'none')
  assert.deepEqual(host.calls[1].input, {
    reconstruct: true,
    reconstructionSourceRoot: '/workspace/source',
    brief: 'Restore implemented screens from src/panel.ts; preserve host boundary.',
  })
}

// Reconstruction bypasses ordinary review gates, not errors or missing input.
for (const [handoff, executionMode] of [
  ['must_edit', 'main'],
  ['user_continue', 'subagent'],
]) {
  const { selection } = fixture({ mode: executionMode, handoff, resumeAction: { routeId: DesignResumeActionId('go'), label: { en: 'Go', zh: '继续' } } })
  const reconstruct = { ...input, reconstruct: true, reconstructionSourceRoot: '/workspace/source' }
  for (const [settlement, expected] of [
    [{ kind: 'committed', stateRevision: 'done', stateStatus: 'complete' }, 'complete'],
    [{ kind: 'failed', stateRevision: 'bad', diagnostics: ['invalid'] }, 'failed'],
    [{ kind: 'needs_input', stateRevision: 'blocked', instruction: 'Source unavailable' }, 'await_execution_input'],
  ]) {
    const host = producer(settlement)
    assert.equal((await engageDesignExecution(selection, reconstruct, signal, { producer: host.value })).kind, expected)
    assert.equal(host.calls[0].skill.execution.handoff, 'none')
    assert.equal(host.calls[0].skill.execution.mode, executionMode, 'reconstruction preserves frozen execution placement')
    assert.equal(selection.kit.skills[0].execution.handoff, handoff, 'original Bundle policy unchanged')
    assert.equal(selection.kit.skills[0].execution.mode, executionMode, 'original Bundle placement unchanged')
  }
  await assert.rejects(engageDesignExecution(selection, reconstruct, signal, {
    producer: producer({ kind: 'committed', stateRevision: 'plan', stateStatus: 'pending' }).value,
  }), /pending/)
}

for (const [settlement, expected] of [
  [{ kind: 'needs_input', stateRevision: 'state-question', instruction: 'Confirm the audience.' }, 'await_execution_input'],
  [{ kind: 'failed', stateRevision: 'state-failed', diagnostics: ['invalid result'] }, 'failed'],
  [{ kind: 'cancelled', stateRevision: 'state-cancelled', diagnostics: ['cancelled by user'] }, 'cancelled'],
]) {
  const { selection } = fixture({ handoff: 'none' })
  const host = producer(settlement)
  const transition = await engageDesignExecution(selection, input, signal, { producer: host.value })
  assert.equal(transition.kind, expected)
  assert.equal(transition.pin.stateRevision, settlement.stateRevision)
}

{
  const { selection } = fixture({ handoff: 'none' })
  const host = producer({ kind: 'committed', stateRevision: 'state-pending', stateStatus: 'pending' })
  await assert.rejects(
    engageDesignExecution(selection, input, signal, { producer: host.value }),
    /pending state without a handoff/,
  )
}

console.log('DESIGN EXECUTION RUNTIME OK')
