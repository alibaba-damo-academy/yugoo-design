/** Keyless source smoke for the advisory currency read model. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import DesignService, {
  DesignJournalRegistry,
  deriveAdvisoryStaleness,
  parseDesignAdvisory,
} from '../packages/core/lib/index.js'

const projectId = '11111111-1111-4111-8111-111111111111'
const KIT_VERSION = '1.0'
const NEXT_VERSION = '2.0'

function kitFamily(name, versions) {
  return {
    owner: Symbol('smoke'),
    latestVersion: versions.at(-1),
    versions: new Map(versions.map((version) => [version, { name, version }])),
  }
}

function serviceAt(workspace, kits) {
  const service = Object.create(DesignService.prototype)
  service.journalMutations = new Map()
  service.journals = new DesignJournalRegistry((scope) => resolve(scope, '.design-system/journal'))
  service.projectForAgent = async () => ({ projectId, stateRoot: workspace })
  service.kits = kits
  service.activeWorkspaces = new WeakMap()
  service.workspaceChangeListeners = new Set()
  return service
}

function agentAt(service, workspace, kit = { name: 'web_app', version: KIT_VERSION }) {
  const agent = { id: 'session-1', session: { id: 'session-1', header: { cwd: workspace }, events: [] }, inject() {} }
  service.activeWorkspaces.set(agent, {
    project: { projectId, stateRoot: workspace, kit },
    values: {},
  })
  return agent
}

function setActiveKit(service, agent, name, version) {
  const current = service.activeWorkspaces.get(agent)
  service.activeWorkspaces.set(agent, { ...current, project: { ...current.project, kit: { name, version } } })
}

async function seedJournal(service, workspace, withChange = true) {
  await service.journals.append(workspace, 'session-1', {
    type: 'design/kit-selected',
    data: { kit: 'web_app', version: KIT_VERSION, operation: 'activate' },
  })
  if (!withChange) return
  await appendChange(service, workspace, { topic: 'Export' }, 'agent-head')
}

async function appendChange(service, workspace, state, commit) {
  return service.journals.append(workspace, 'session-1', {
    type: 'design/changed',
    data: { kit: 'web_app', version: KIT_VERSION, skill: 'questions', state, origin: 'agent', commit },
  })
}

function advisoryWith(id, inputs, profile = 'io.deepseek.design.advisory.alignment/v1') {
  return parseDesignAdvisory({
    schemaVersion: 1,
    id: `${id}/result-1`,
    profile,
    resultRef: 'result-1',
    inputs,
    kind: 'reminder',
    attention: 'human-review',
    summary: 'Currency smoke advisory.',
    items: [],
    acceptanceInstruction: 'Ask the user.',
    blocksConversation: false,
    authorizesDesignWrite: false,
  })
}

// The shared current inbox keeps only the latest publication per logical
// profile and applies the user-facing cap without deleting Journal history.
await inCase(async (root) => {
  const service = serviceAt(root, new Map([['web_app', kitFamily('web_app', [KIT_VERSION])]]))
  const agent = agentAt(service, root)
  await seedJournal(service, root)
  const oldAlignment = advisoryWith('run-old-alignment', currentPins())
  const grounding = advisoryWith('run-grounding-current', currentPins(), 'io.deepseek.design.advisory.grounding/v2')
  const newAlignment = advisoryWith('run-new-alignment', currentPins(), 'io.deepseek.design.advisory.alignment/v2')
  await service.publishAdvisory(agent, oldAlignment)
  await service.publishAdvisory(agent, grounding)
  await service.publishAdvisory(agent, newAlignment)
  assert.equal((await service.listAdvisories(agent)).length, 3, 'Journal history retains every publication')
  assert.deepEqual((await service.listAdvisoryInbox(agent)).map(entry => entry.advisory.id), [grounding.id, newAlignment.id])
  service.setAdvisoryInboxLimit(1)
  assert.deepEqual((await service.listAdvisoryInbox(agent)).map(entry => entry.advisory.id), [newAlignment.id])
  await service.decideAdvisory(agent, { advisoryId: newAlignment.id, decision: 'rejected' })
  assert.deepEqual((await service.listAdvisoryInbox(agent)).map(entry => entry.advisory.id), [grounding.id], 'disposing the latest profile result never resurfaces its older result')
  service.journals.dispose()
})

function currentPins() {
  return [
    { source: 'design-revision', revision: '2' },
    { source: 'kit:web_app', revision: KIT_VERSION },
  ]
}

function journalPath(workspace) {
  return resolve(workspace, '.design-system/journal', `${Buffer.from('session-1').toString('base64url')}.jsonl`)
}

async function inCase(run) {
  const root = await mkdtemp(join(tmpdir(), 'advisory-currency-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// ① current pins → not stale.
await inCase(async (root) => {
  const service = serviceAt(root, new Map([['web_app', kitFamily('web_app', [KIT_VERSION])]]))
  const agent = agentAt(service, root)
  await seedJournal(service, root)
  await service.publishAdvisory(agent, advisoryWith('run-current', currentPins()))
  const entries = await service.listAdvisories(agent)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].status, 'pending')
  assert.equal(entries[0].stale, false, 'a publication matching current pins reads current immediately')
  service.journals.dispose()
})

// ② a later DesignJournal change advances the revision → stale; history retains the entry.
await inCase(async (root) => {
  const service = serviceAt(root, new Map([['web_app', kitFamily('web_app', [KIT_VERSION])]]))
  const agent = agentAt(service, root)
  await seedJournal(service, root)
  await service.publishAdvisory(agent, advisoryWith('run-advance', currentPins()))
  await appendChange(service, root, { topic: 'CSV export' }, 'agent-head-2')
  const entries = await service.listAdvisories(agent)
  assert.equal(entries.length, 1, 'the journal history keeps the stale advisory listed')
  assert.equal(entries[0].stale, true, 'a later DesignJournal change makes the advisory stale')
  service.journals.dispose()
})

// Pure derivation: pin mismatch rules without any journal involvement.
{
  const advisory = advisoryWith('run-pure', currentPins())
  const current = { designRevision: 2, kit: { name: 'web_app', version: KIT_VERSION } }
  assert.equal(deriveAdvisoryStaleness(advisory, current), false, 'exact pin match is current')
  assert.equal(deriveAdvisoryStaleness(advisory, { ...current, designRevision: 3 }), true, 'DesignJournal revision mismatch is stale')
  assert.equal(deriveAdvisoryStaleness(
    advisoryWith('run-zero-pad', [{ source: 'design-revision', revision: '02' }, { source: 'kit:web_app', revision: KIT_VERSION }]),
    current,
  ), true, 'a zero-padded sequence revision never matches by numeric coercion')
  assert.equal(deriveAdvisoryStaleness(
    advisoryWith('run-float', [{ source: 'design-revision', revision: '2.0' }, { source: 'kit:web_app', revision: KIT_VERSION }]),
    current,
  ), true, 'a fractional sequence revision never matches by numeric coercion')
  assert.equal(deriveAdvisoryStaleness(advisory, { ...current, kit: { name: 'mobile_app', version: KIT_VERSION } }), true, 'Kit name mismatch is stale')
  assert.equal(deriveAdvisoryStaleness(advisory, { ...current, kit: { name: 'web_app', version: NEXT_VERSION } }), true, 'Kit version mismatch is stale')
  assert.equal(deriveAdvisoryStaleness(advisory, { designRevision: 2 }), true, 'a missing Kit is stale when the advisory pins one')
  // Pre-pin-format legacy data never carries design-revision/kit pins; the parser
  // now requires >=1 pin, so this compat rule is exercised on the pure read model.
  const pinless = { ...advisoryWith('run-legacy-pure', currentPins()), inputs: [] }
  assert.equal(deriveAdvisoryStaleness(pinless, { ...current, designRevision: 9 }), false, 'a pinless legacy advisory is never stale')
}

// ③ Kit upgrade: the selection is an audit fact only; the advisory stays
// listed and reads stale because its Kit version pin no longer matches.
await inCase(async (root) => {
  const service = serviceAt(root, new Map([['web_app', kitFamily('web_app', [KIT_VERSION, NEXT_VERSION])]]))
  const agent = agentAt(service, root)
  await seedJournal(service, root)
  await service.publishAdvisory(agent, advisoryWith('run-kit-upgrade', currentPins()))
  await service.journals.append(root, 'session-1', {
    type: 'design/kit-selected', data: { kit: 'web_app', version: NEXT_VERSION, operation: 'upgrade' },
  })
  setActiveKit(service, agent, 'web_app', NEXT_VERSION)
  const entries = await service.listAdvisories(agent)
  assert.equal(entries.length, 1, 'a Kit upgrade is an audit fact only and keeps the advisory listed')
  assert.equal(entries[0].stale, true, 'the advisory reads stale once the Kit version pin no longer matches the project pin')
  service.journals.dispose()
})

// ④ Kit pin unresolvable (absent registry entry) → stale.
await inCase(async (root) => {
  const service = serviceAt(root, new Map())
  const agent = agentAt(service, root)
  await seedJournal(service, root)
  await service.publishAdvisory(agent, advisoryWith('run-kit-absent', [{ source: 'kit:web_app', revision: KIT_VERSION }]))
  const entries = await service.listAdvisories(agent)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].stale, true, 'an unresolvable Kit pin makes the advisory stale')
  service.journals.dispose()
})

// ⑤+⑨ grounding-style publication: extra knowledge pins do not disturb currency,
// and the entry reads current immediately after publication.
await inCase(async (root) => {
  const service = serviceAt(root, new Map([['web_app', kitFamily('web_app', [KIT_VERSION])]]))
  const agent = agentAt(service, root)
  await seedJournal(service, root)
  await service.publishAdvisory(agent, advisoryWith('run-grounding', [
    ...currentPins(),
    { source: 'grounding-checkpoint', revision: 'c'.repeat(64) },
  ]))
  const entries = await service.listAdvisories(agent)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].stale, false, 'a grounding-style publication reads current immediately')
  await appendChange(service, root, { topic: 'CSV export' }, 'agent-head-2')
  assert.equal((await service.listAdvisories(agent))[0].stale, true, 'a later Journal change still stales a grounding-style advisory')
  service.journals.dispose()
})

// ⑦ Revision mismatch is only a revalidation marker: acceptance remains
// recordable after the design advances (the accept→revision race).
await inCase(async (root) => {
  const service = serviceAt(root, new Map([['web_app', kitFamily('web_app', [KIT_VERSION])]]))
  const agent = agentAt(service, root)
  await seedJournal(service, root)
  const advisory = advisoryWith('run-stale-decide', currentPins())
  await service.publishAdvisory(agent, advisory)
  await appendChange(service, root, { topic: 'CSV export' }, 'agent-head-2')
  const accepted = await service.decideAdvisory(agent, { advisoryId: advisory.id, decision: 'accepted' })
  assert.equal(typeof accepted.acceptanceReceiptId, 'string', 'acceptance persists a durable receipt before dispatch')
  const entries = await service.listAdvisories(agent)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].status, 'accepted', 'revision mismatch does not reject acceptance')
  assert.equal(entries[0].stale, true)
  service.journals.dispose()
})

// ⑧ a current advisory's decision still applies.
await inCase(async (root) => {
  const service = serviceAt(root, new Map([['web_app', kitFamily('web_app', [KIT_VERSION])]]))
  const agent = agentAt(service, root)
  await seedJournal(service, root)
  const advisory = advisoryWith('run-current-decide', currentPins())
  await service.publishAdvisory(agent, advisory)
  await service.decideAdvisory(agent, { advisoryId: advisory.id, decision: 'accepted' })
  const entries = await service.listAdvisories(agent)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].status, 'accepted', 'a current advisory decision is recorded')
  service.journals.dispose()
})

// ⑧b explicit Journal writes preserve the change-before-decision order.
await inCase(async (root) => {
  const service = serviceAt(root, new Map([['web_app', kitFamily('web_app', [KIT_VERSION])]]))
  const agent = agentAt(service, root)
  await seedJournal(service, root, false)
  const advisory = advisoryWith('run-current-order', [{ source: 'kit:web_app', revision: KIT_VERSION }])
  await service.publishAdvisory(agent, advisory)
  await appendChange(service, root, { topic: 'Export' }, 'agent-head')
  await service.decideAdvisory(agent, { advisoryId: advisory.id, decision: 'accepted' })
  const records = (await readFile(journalPath(root), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(records.map((record) => record.type), [
    'design/kit-selected',
    'design/advisory-published',
    'design/changed',
    'design/advisory-execution',
  ], 'the plugin Journal preserves the explicit mutation order')
  assert.equal((await service.listAdvisories(agent))[0].status, 'accepted')
  service.journals.dispose()
})

console.log('ADVISORY CURRENCY OK')
