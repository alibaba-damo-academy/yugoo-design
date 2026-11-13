import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const { register } = await import('tsx/esm/api'); register()
const { apply, producerPrompt } = await import('../src/dsh-design-execution-plugin.ts')
const { apply: registerTool } = await import('../src/dsh-run-design-skill-tool.ts')
const { default: DesignService } = await import('../src/design-service.ts')
const { DesignJournalStorage } = await import('../src/design-journal-storage.ts')
const { DesignAdvisoryJournal } = await import('../src/design-advisory-journal.ts')

// Real registered tool, controller, DesignService claim/settle and durable
// Journal. Stop at Producer entry, or capture the actual child followup.
// No model or publication is exercised.
const producerEntered = new Error('fixture: reached ordinary Producer')
const invocation = call => `design-${createHash('sha256').update('run_design_skill\0').update(call).digest('hex')}`
async function fixture(t, { handoff = 'none', pending = false, capturePrompt = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'advisory-start-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new DesignJournalStorage(root), journal = new DesignAdvisoryJournal(storage)
  const skill = { name: 'sample', version: '1.0', title: { en: 'Sample', zh: '示例' },
    execution: { mode: 'subagent', handoff, ...(handoff === 'user_continue'
      ? { resumeAction: { routeId: 'continue', label: { en: 'Continue', zh: '继续' } } } : {}) } }
  const kit = { name: 'fixture', version: '1.0', skills: [skill], resources: {} }
  const project = { projectId: '5a6c7c2f-19d8-4329-9ce6-805a4820c7e9', root, designFilesRoot: root, kit: { name: kit.name } }
  const events = [{ type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { turn: 1, source: { kind: 'plugin' }, content: [{ type: 'text', text: 'Accepted advisory notice' }] } }]
  const agent = { options: {}, session: { id: 'conv', header: {}, requestHeader: () => ({}), snapshotEvents: () => [...events] } }
  const tools = new Map(), attempts = [], prompts = []
  agent.ctx = { get: () => undefined, tools: { get: () => undefined }, agents: { create: async () => ({
    agent: { session: { snapshotEvents: () => [] }, followup(message) {
      prompts.push(message.content[0].text); throw producerEntered
    } }, dispose: async () => {},
  }) } }
  const design = Object.create(DesignService.prototype)
  Object.assign(design, {
    advisoryActionAttempts: new WeakMap(),
    withJournal: async (_agent, operation) => operation(root, 'conv', project),
    journals: {
      read: (_workspace, conversation) => storage.read(conversation),
      claimAdvisoryActionExecution: (_workspace, conversation, request) => journal.claimActionExecution(conversation, request),
      settleAdvisoryActionExecution: (_workspace, conversation, request) => journal.settleActionExecution(conversation, request),
    },
    assertProjectSelection() {}, notifyWorkspaceChange() {},
    requireKitForAgent: () => kit,
    projectForAgent: async () => project,
    registerClarityRuntime: () => () => {}, registerWorkspaceChangeListener: () => () => {},
    withProjectMutationFor: async (_agent, _project, operation) => operation(),
    runtimeDriverFor: () => ({ producer: { producerTools: [], ownsPath: () => true } }),
    designFilesForProject: async () => ({ head: async () => 'revision-1',
      listPathsAt: async () => [], auditInvocation: async () => ({ commit: 'revision-1' }),
      readPublished: async () => pending ? { title: 'Existing design' } : undefined,
      readLatestPublishedExecutionForSkillAt: async () => pending ? { execution: {
        invocationId: 'previous-run', bundleVersion: skill.version, stateStatus: 'pending', handoff,
      } } : undefined,
    }),
    executionAttemptsFor: () => attempts,
    renderDesignState: () => 'Existing design context',
    recordExecutionAttempt: (_agent, attempt) => { attempts.push(attempt); if (!capturePrompt) throw producerEntered },
  })
  apply({ design, tools: { register: tool => tools.set(tool.name, tool) },
    inject() {}, effect() {}, on() {}, systemPrompt: { section() {} } }, {
    maxArtifactInputFiles: 10, maxArtifactInputPathBytes: 1024,
    maxArtifactInputFileBytes: 1024, maxArtifactInputTotalBytes: 10240,
  })
  async function accept(targetOverrides = {}) {
    await journal.publish('conv', { schemaVersion: 2, id: 'advice-1', profile: 'design.grounding/v1',
      resultRef: 'result-1', inputs: [{ source: 'design', revision: 'revision-1' }], kind: 'suggestion', attention: 'human-review',
      summary: 'Repair an evidenced discrepancy', items: [{ id: 'finding-1', title: 'Repair', detail: 'Existing facts disagree', references: [] }],
      acceptanceInstruction: 'Revise the owning Bundle', blocksConversation: false, authorizesDesignWrite: false,
      actionSpec: { kind: 'bundle-revisions', targets: [{ skillName: targetOverrides.skillName ?? 'sample', entityRefs: ['finding-1'] }] } })
    const [entry] = await journal.decide('conv', { advisoryId: 'advice-1', decision: 'accepted' }, [{
      actionId: `bundle:${targetOverrides.skillName ?? 'sample'}`, target: { kitName: 'fixture', kitVersion: '1.0', skillName: 'sample',
        bundleVersion: '1.0', entityRefs: ['finding-1'], ...targetOverrides },
    }])
    return entry.actionReceipts[0].receiptId
  }
  async function execute(args = {}, call = 'call-1') {
    const turn = events.findLast(event => event.type === 'turn/start')?.data.turn ?? 1
    const input = { name: 'sample', ...(args.action ? {} : { brief: 'Repair the discrepancy' }), ...args }
    events.push({ type: 'assistant/message', data: { turn, step: 1,
      message: { content: [{ type: 'text', text: 'I will revise Sample and save the corrected design.' }] } } },
    { type: 'tool/call', data: { turn, step: 1, callId: call, name: 'run_design_skill', arguments: JSON.stringify(input) } })
    return tools.get('run_design_skill').execute(input, {
      agent, rootCallId: call, signal: new AbortController().signal, concludeTurn() {},
    })
  }
  // Exercise the canonical tool's real claim and completion settlement, with
  // only the Owner/publication boundary stubbed. Restore the production
  // controller for the subsequent ordinary repair.
  async function completeAccepted(receiptId, call = 'accepted-root') {
    const productionTool = tools.get('run_design_skill')
    registerTool({ on() {}, tools: { register: tool => tools.set(tool.name, tool) } }, {
      async claimAdvisoryActionExecution(request) {
        const result = await design.claimAdvisoryActionExecution(request.agent, {
          receiptId: request.receiptId, proposedInvocationId: request.proposedInvocationId,
          skillName: request.name, bundleVersion: '1.0',
        })
        return { kind: 'action', claimed: result.claimed, attemptId: result.attemptId,
          effectiveInvocationId: result.effectiveInvocationId, state: result.action.state }
      },
      settleAdvisoryActionExecution: request => design.settleAdvisoryActionExecution(request.agent, request),
      run: async () => ({ kind: 'completed', summary: 'First Owner repair saved', projectRoot: root,
        stateRevision: 'revision-1', clarity: { status: 'pending', summary: 'Not assessed in this fixture' } }),
    })
    try {
      assert.equal((await execute({ advisoryReceiptId: receiptId }, call)).kind, 'completed')
      return (await storage.read('conv')).snapshot.advisories[0].actionReceipts[0]
    } finally { tools.set('run_design_skill', productionTool) }
  }
  return { journal, storage, kit, agent, events, attempts, prompts, accept, execute, completeAccepted, design }
}

test('accepted notice starts the ordinary Producer and failed receipt retries keep its logical invocation', async t => {
  const f = await fixture(t), receiptId = await f.accept()
  await assert.rejects(f.execute({ advisoryReceiptId: receiptId }), error => error === producerEntered)
  const first = (await f.storage.read('conv')).snapshot.advisories[0].actionReceipts[0]
  assert.equal(first.state, 'failed', 'real tool settles the deliberately stopped Producer')
  assert.equal(f.attempts[0].invocationId, first.logicalInvocationId)
  await assert.rejects(f.execute({ advisoryReceiptId: receiptId }, 'retry-call'), error => error === producerEntered)
  const retry = (await f.storage.read('conv')).snapshot.advisories[0].actionReceipts[0]
  assert.equal(retry.logicalInvocationId, first.logicalInvocationId)
  assert.notEqual(retry.attemptId, first.attemptId)
  assert.equal(f.attempts.length, 2)
  assert.equal(f.events.filter(event => event.type === 'user/message').every(event => event.data.source.kind === 'plugin'), true)
})

test('ordinary notices and accepted-but-unclaimed advice cannot start work', async t => {
  const f = await fixture(t)
  for (const accepted of [false, true]) {
    if (accepted) await f.accept()
    assert.equal((await f.execute()).kind, 'invalid')
    assert.equal(f.attempts.length, 0)
  }
})

test('the same active accepted turn can finish a partial Owner repair after its first completion', async t => {
  const f = await fixture(t), receiptId = await f.accept()
  const first = await f.completeAccepted(receiptId)
  assert.equal(first.state, 'completed')
  await assert.rejects(f.execute({ brief: 'Also correct the omitted source pointer' }, 'repair-root'), error => error === producerEntered)
  assert.equal(f.attempts.length, 1)
  assert.notEqual(f.attempts[0].invocationId, first.logicalInvocationId, 'ordinary repair has its own execution identity')
  assert.deepEqual((await f.storage.read('conv')).snapshot.advisories[0].actionReceipts[0], first,
    'continuation does not reclaim or rewrite the completed action receipt')
  assert.match((await f.execute({ advisoryReceiptId: receiptId }, 'explicit-replay')).summary, /already completed/)
  assert.equal(f.attempts.length, 1)
})

for (const boundary of ['ended-turn', 'new-turn', 'other-project', 'other-bundle', 'other-kit', 'kit-version',
  'bundle-version', 'missing-call', 'different-call-id', 'different-receipt', 'different-name', 'malformed-call', 'replayed-old-receipt']) {
  test(`completed accepted work cannot authorize an ordinary repair across ${boundary}`, async t => {
    const f = await fixture(t), receiptId = await f.accept()
    await f.completeAccepted(receiptId)
    let args = {}
    if (boundary === 'ended-turn') f.events.push({ type: 'turn/end', data: { turn: 1 } })
    if (boundary === 'new-turn') f.events.push({ type: 'turn/start', data: { turn: 2 } },
      { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'Old accepted repair notice' }] } })
    if (boundary === 'other-bundle') {
      f.kit.skills.push({ ...f.kit.skills[0], name: 'other' }); args = { name: 'other' }
    }
    if (boundary === 'other-kit') f.kit.name = 'other'
    if (boundary === 'kit-version') f.kit.version = '2.0'
    if (boundary === 'bundle-version') f.kit.skills[0].version = '2.0'
    if (boundary === 'other-project') {
      const other = { ...await f.design.projectForAgent(), projectId: 'a55afbc0-4110-4338-947d-8c7727e05229' }
      f.design.projectForAgent = async () => other
      f.design.withJournal = async (_agent, operation) => operation(other.root, 'other-conversation', other)
    }
    if (boundary === 'missing-call') f.events.splice(2)
    if (boundary === 'different-call-id') f.events.find(event => event.type === 'tool/call').data.callId = 'unclaimed-call'
    if (boundary === 'different-receipt') f.events.find(event => event.type === 'tool/call').data.arguments =
      JSON.stringify({ name: 'sample', advisoryReceiptId: 'unrelated-receipt' })
    if (boundary === 'different-name') f.events.find(event => event.type === 'tool/call').data.arguments =
      JSON.stringify({ name: 'other', advisoryReceiptId: receiptId })
    if (boundary === 'malformed-call') f.events.find(event => event.type === 'tool/call').data.arguments = '{'
    if (boundary === 'replayed-old-receipt') {
      f.events.push({ type: 'turn/start', data: { turn: 2 } })
      assert.match((await f.execute({ advisoryReceiptId: receiptId }, 'explicit-replay')).summary, /already completed/)
    }
    if (boundary === 'other-kit') await assert.rejects(f.execute(args, 'repair-root'), /active Kit pin does not match/)
    else assert.equal((await f.execute(args, 'repair-root')).kind, 'invalid')
    assert.equal(f.attempts.length, 0)
  })
}

test('a running action for a different invocation cannot authorize this notice', async t => {
  const f = await fixture(t), receiptId = await f.accept()
  await f.journal.claimActionExecution('conv', { receiptId, proposedInvocationId: 'another-invocation' })
  assert.equal((await f.execute()).kind, 'invalid')
  assert.equal(f.attempts.length, 0)
})

for (const [field, value] of [['kitName', 'other'], ['kitVersion', '2.0'], ['skillName', 'other'], ['bundleVersion', '2.0']]) {
  test(`a receipt with a different ${field} cannot authorize the selected Bundle`, async t => {
    const f = await fixture(t), receiptId = await f.accept({ [field]: value })
    await assert.rejects(f.execute({ advisoryReceiptId: receiptId }), /does not authorize the requested exact Bundle/)
    await f.journal.claimActionExecution('conv', { receiptId, proposedInvocationId: invocation('call-1') })
    assert.equal((await f.execute()).kind, 'invalid', 'controller also checks the exact target, not just accepted/running')
    assert.equal(f.attempts.length, 0)
  })
}

test('completed and live running replay never reach the controller or start another Producer', async t => {
  const f = await fixture(t), receiptId = await f.accept()
  const claim = await f.design.claimAdvisoryActionExecution(f.agent, {
    receiptId, proposedInvocationId: 'already-running', skillName: 'sample', bundleVersion: '1.0',
  })
  assert.match((await f.execute({ advisoryReceiptId: receiptId })).summary, /currently running/)
  await f.design.settleAdvisoryActionExecution(f.agent, { receiptId, attemptId: claim.attemptId, state: 'completed' })
  assert.match((await f.execute({ advisoryReceiptId: receiptId }, 'replay')).summary, /already completed/)
  assert.equal(f.attempts.length, 0)
})

for (const handoff of ['must_edit', 'user_continue']) {
  test(`an accepted revision starts new work over an old ${handoff} gate`, async t => {
    const f = await fixture(t, { handoff, pending: true }), receiptId = await f.accept()
    await assert.rejects(f.execute({ advisoryReceiptId: receiptId }), error => error === producerEntered)
    assert.equal(f.attempts.length, 1)
  })
  test(`same-turn accepted repair remains a new revision over an old ${handoff} gate`, async t => {
    const f = await fixture(t, { handoff, pending: true }), receiptId = await f.accept()
    await f.completeAccepted(receiptId)
    await assert.rejects(f.execute({}, 'repair-root'), error => error === producerEntered)
    assert.equal(f.attempts.length, 1)
    if (handoff === 'user_continue') {
      assert.equal((await f.execute({ action: { routeId: 'continue' } }, 'independent-continue')).kind, 'invalid')
      assert.equal(f.attempts.length, 1, 'ordinary repair authority is not a human continue command')
    }
  })
}

test('accepted advisory cannot impersonate a separate current human continue action', async t => {
  const f = await fixture(t, { handoff: 'user_continue', pending: true }), receiptId = await f.accept()
  const result = await f.execute({ advisoryReceiptId: receiptId, action: { routeId: 'continue' } })
  assert.equal(result.kind, 'invalid')
  assert.match(result.summary, /requires a current human message/)
  assert.equal(f.attempts.length, 0)
})

for (const state of ['failed', 'completed']) {
  test(`a ${state} receipt with the same invocation is not an active claim`, async t => {
    const f = await fixture(t), receiptId = await f.accept()
    const claim = await f.journal.claimActionExecution('conv', { receiptId, proposedInvocationId: invocation('call-1') })
    await f.journal.settleActionExecution('conv', { receiptId, attemptId: claim.attemptId, state })
    assert.equal((await f.execute()).kind, 'invalid')
    assert.equal(f.attempts.length, 0)
  })
}

test('accepted revision cannot be mistaken for adopting a legacy panel save', async t => {
  const f = await fixture(t, { handoff: 'must_edit', pending: true }), receiptId = await f.accept()
  await f.storage.append('conv', { type: 'design/changed', data: {
    kit: 'fixture', version: '1.0', skill: 'sample', origin: 'panel',
    state: { title: 'Existing design' }, commit: 'revision-1',
  } })
  await assert.rejects(f.execute({ advisoryReceiptId: receiptId }), error => error === producerEntered)
  assert.equal(f.attempts.length, 1)
})

function human(text, extraParts = []) {
  return { type: 'user/message', data: { source: { kind: 'user' },
    content: [{ type: 'text', text }, ...extraParts] } }
}

function questionReply(callId, custom, { name = 'ask_user_question', selected = [], isError = false, id = 'next' } = {}) {
  return [
    { type: 'tool/call', data: { turn: 1, step: 1, callId, name,
      arguments: JSON.stringify({ questions: [{ id: 'next', question: 'What would you like to design next?' }] }) } },
    { type: 'tool/result', data: { turn: 1, step: 1, message: { toolCallId: callId, isError,
      content: [{ type: 'text', text: JSON.stringify({ answers: [{ id, selected, ...(custom === undefined ? {} : { custom }) }] }) }] } } },
  ]
}

test('native question replies reach the Producer verbatim with question context and arrival order', async t => {
  const f = await fixture(t, { capturePrompt: true })
  const custom = 'Functions, Agent capabilities and review/revision/handoff flows.\nKeep drafts; no code or unsupported cost assumptions.'
  f.events.push(human('Start Research'), ...questionReply('next-1', custom), human('Retain existing identifiers.'))
  assert.deepEqual((await f.execute({ brief: 'Only map functions' })).diagnostics, ['fixture: reached ordinary Producer'])
  const actual = JSON.parse(f.prompts[0].split('<current_user_request>\n')[1].split('\n</current_user_request>')[0])
  assert.deepEqual(actual, ['Start Research', { kind: 'question-answer', questionId: 'next',
    question: 'What would you like to design next?', selected: [], custom }, 'Retain existing identifiers.'])
  assert.match(f.prompts[0], /question context is Agent-authored/)
})

test('a selected native answer is human input without impersonating a direct continue command', async t => {
  const f = await fixture(t, { capturePrompt: true })
  f.events.push(...questionReply('selection', undefined, { selected: ['Map functions'] }))
  assert.deepEqual((await f.execute()).diagnostics, ['fixture: reached ordinary Producer'])
  assert.match(f.prompts[0], /Map functions/)
  const gated = await fixture(t, { handoff: 'user_continue', pending: true })
  gated.events.push(...questionReply('selection', undefined, { selected: ['Continue'] }))
  assert.equal((await gated.execute({ action: { routeId: 'continue' } })).kind, 'invalid')
})

test('only a matched successful native question answer counts, never generic tool content or old turns', async t => {
  for (const options of [{ name: 'read' }, { isError: true }, { id: 'unasked' }]) {
    const f = await fixture(t)
    f.events.push(...questionReply('not-human', 'Do work', options))
    assert.equal((await f.execute()).kind, 'invalid')
    assert.equal(f.attempts.length, 0)
  }
  const f = await fixture(t)
  f.events.unshift(...questionReply('old', 'Past answer'))
  f.events.push(...questionReply('empty', undefined))
  const orphan = questionReply('orphan', 'Unmatched answer')[1]
  f.events.push(orphan, { type: 'tool/result', data: { content: 'background activity' } })
  assert.equal((await f.execute()).kind, 'invalid')
})

test('native answer surface replacements do not duplicate human context', async t => {
  const f = await fixture(t, { capturePrompt: true })
  const reply = questionReply('question-1', 'Keep the full goal')
  f.events.push(...reply, reply[1])
  assert.deepEqual((await f.execute()).diagnostics, ['fixture: reached ordinary Producer'])
  const actual = JSON.parse(f.prompts[0].split('<current_user_request>\n')[1].split('\n</current_user_request>')[0])
  assert.equal(actual.length, 1)
})

test('the actual Producer receives current human text separately from a narrowed caller plan', async t => {
  const f = await fixture(t, { capturePrompt: true })
  f.events.unshift(human('Old-turn request must not be replayed'))
  const first = 'Return rejection to pending; retain the reason.\nPreserve identifiers.'
  const second = 'After designer supplementation, submit to the lead for judgment.'
  const correction = 'Necessary behavior and output details must agree too.'
  f.events.push(human(first, [{ type: 'text', text: second }]), human(correction),
    { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'Plugin summary is not the human request' }] } },
    { type: 'compaction', data: { summary: 'Generated summary must not replace the request' } })
  const brief = 'Only change the description; lead judgment means designer scope judgment.'
  assert.deepEqual((await f.execute({ brief })).diagnostics, ['fixture: reached ordinary Producer'])
  assert.equal(f.prompts.length, 1)
  const prompt = f.prompts[0]
  assert.deepEqual(JSON.parse(prompt.split('<current_user_request>\n')[1].split('\n</current_user_request>')[0]), [first, second, correction])
  assert.ok(prompt.includes(`<caller_task_plan>\n${brief}\n</caller_task_plan>`))
  assert.doesNotMatch(prompt, /Old-turn request|Plugin summary|Generated summary|<user_brief>/)
  assert.match(prompt, /edit only the current Bundle/)
  assert.match(prompt, /revising them when the user requests it/)
})

test('accepted plugin-only work never fills human context from past turns', async t => {
  const f = await fixture(t, { capturePrompt: true }), receiptId = await f.accept()
  f.events.unshift(human('Past request'))
  assert.deepEqual((await f.execute({ advisoryReceiptId: receiptId })).diagnostics, ['fixture: reached ordinary Producer'])
  assert.equal(f.prompts.length, 1)
  assert.doesNotMatch(f.prompts[0], /current_user_request|Past request|<user_brief>/)
  assert.match(f.prompts[0], /<caller_task_plan>/)
})

test('multi-part human context does not relax exact continue-control matching', async t => {
  const f = await fixture(t, { handoff: 'user_continue', pending: true })
  f.events.push(human('Continue', [{ type: 'text', text: 'Change the scope too' }]))
  assert.equal((await f.execute({ action: { routeId: 'continue' } })).kind, 'invalid')
  assert.equal(f.attempts.length, 0)
})

test('reconstruction and ordinary resume keep their existing modes without inventing human history', () => {
  const skill = { name: 'sample' }
  const engage = producerPrompt('engage', skill, { brief: 'Restore observed behavior',
    currentUserInput: ['Use this repository as evidence'], reconstruct: true, reconstructionSourceRoot: '/source' })
  assert.match(engage, /current_user_request/)
  assert.match(engage, /without redesign/)
  assert.match(engage, /exact read-only evidence file or directory/)
  const resume = producerPrompt('resume', skill, { reconstruct: true, reconstructionSourceRoot: '/source' })
  assert.match(resume, /not the forward-design workflow/)
  assert.match(resume, /<caller_task_plan>/)
  assert.doesNotMatch(resume, /current_user_request|user_brief/)
  assert.doesNotMatch(producerPrompt('resume', skill), /current_user_request|caller_task_plan|user_brief/)
})
