import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { renderAdvisoryReviewMemory, suppressRepeatedAdvisoryItems } = await import('../src/advisory-review-memory.ts')
const { renderDesignReviewDepth } = await import('../src/design-review-depth.ts')
const { DesignAdvisoryJournal } = await import('../src/design-advisory-journal.ts')
const { DesignJournalStorage } = await import('../src/design-journal-storage.ts')
const { parseDesignAdvisory } = await import('../src/design-advisory.ts')
const item = {id:'i1',title:'missing permission',detail:'source A lacks permission',references:['a#/permission']}
const advisory = {schemaVersion:1,id:'a1',profile:'design.grounding',items:[item]}

function memoryEntry(index, references = [`design_files/example/state.json#/decision-${index}`]) {
  return {
    advisory: parseDesignAdvisory({
      schemaVersion: 1, id: `advice-${index}`, profile: 'io.deepseek.design.advisory.alignment/v1',
      resultRef: `result-${index}`, inputs: [{ source: 'design-state', revision: `state-${index}` }],
      kind: 'reminder', attention: 'human-review', summary: 'Clarify the current decision',
      items: [{ id: 'decision', title: `Decision ${index}`, detail: 'Verify the current source.', references }],
      acceptanceInstruction: 'Read the finding before selecting a follow-up.',
      blocksConversation: false, authorizesDesignWrite: false,
    }),
    status: 'accepted', selection: { kind: 'no-action', reason: `Current user decision ${index}`, journalRevision: index + 1 },
    executionStatus: 'completed',
  }
}

test('memory budget keeps the newest complete records and their current dispositions', () => {
  const entries = Array.from({ length: 64 }, (_, index) => memoryEntry(index,
    Array.from({ length: 6 }, (_, ref) => `design_files/example/state.json#/objects/${'context/'.repeat(12)}${index}-${ref}`)))
  const before = structuredClone(entries)
  const payload = renderAdvisoryReviewMemory(entries).split('\n')[1]
  const records = JSON.parse(payload)
  assert.ok(payload.length <= 48_000)
  assert.ok(records.length > 0 && records.length < entries.length, 'older records are omitted when complete recent records fill the budget')
  assert.deepEqual(records.map(record => record.id), entries.slice(-records.length).map(entry => entry.advisory.id))
  assert.deepEqual(records.at(-1).selection, entries.at(-1).selection)
  assert.deepEqual(records.at(-1).items, entries.at(-1).advisory.items.map(({ id, title, references }) => ({ id, title, references })))
  assert.deepEqual(entries, before, 'context budgeting never edits the complete durable advice')
})

test('oversized memory records retain disposition metadata and disclose omitted locators', () => {
  const references = Array.from({ length: 128 }, (_, ref) => `design_files/example/state.json#/${'context/'.repeat(45)}${ref}`)
  const newest = memoryEntry(1, references)
  newest.selection.reason = 'Keep the user’s current decision; {{saved_example}} remains literal.'
  const entries = [memoryEntry(0), newest]
  const before = structuredClone(entries)
  const payload = renderAdvisoryReviewMemory(entries).split('\n')[1]
  const records = JSON.parse(payload)
  assert.ok(payload.length <= 48_000)
  const record = records.at(-1)
  for (const key of ['id', 'profile']) assert.equal(record[key], newest.advisory[key])
  for (const key of ['status', 'selection', 'executionStatus']) assert.deepEqual(record[key], newest[key])
  assert.equal(record.items, undefined, 'oversized item locators are omitted rather than cut mid-JSON')
  assert.equal(record.inputs, undefined)
  assert.match(record.omittedDetails, /main Agent.*design_read_review_action/)
  assert.deepEqual(entries, before)
})

test('memory budget retains the existing 64-record bound and chronological order', () => {
  const entries = Array.from({ length: 70 }, (_, index) => memoryEntry(index))
  const records = JSON.parse(renderAdvisoryReviewMemory(entries).split('\n')[1])
  assert.deepEqual(records.map(record => record.id), entries.slice(-64).map(entry => entry.advisory.id))
})
test('pending and rejected exact findings are fenced, while new evidence and profiles survive',()=>{
  for(const status of ['pending','deferred','rejected']) {
    const entries=[{advisory,status}]
    assert.equal(suppressRepeatedAdvisoryItems({...advisory,id:'new'},entries).items.length,0)
    assert.equal(suppressRepeatedAdvisoryItems({...advisory,items:[{...item,detail:'source B newly proves impact'}]},entries).items.length,1)
    assert.equal(suppressRepeatedAdvisoryItems({...advisory,profile:'design.alignment'},entries).items.length,1)
  }
  assert.equal(suppressRepeatedAdvisoryItems(advisory,[{advisory,status:'accepted'}]).items.length,1)
})
test('mixed findings keep their atomic action; changed actions are not discarded',()=>{
  const v2={...advisory,schemaVersion:2,actionSpec:{kind:'none'}}
  const entries=[{advisory:v2,status:'rejected'}]
  const mixed={...v2,items:[item,{...item,id:'i2',detail:'different evidence'}]}
  assert.equal(suppressRepeatedAdvisoryItems(mixed,entries),mixed)
  const changed={...v2,actionSpec:{kind:'bundle-revisions',commands:[]}}
  assert.equal(suppressRepeatedAdvisoryItems(changed,entries),changed)
})
test('review history preserves disposition locators without injecting past machine findings or repairs', () => {
  const entries = ['pending', 'deferred', 'rejected', 'accepted'].map(status => ({
    advisory: { ...advisory, id: status, inputs: [{ source: 'design-state', revision: 'state-1' }],
      items: [{ ...item, detail: 'Rewrite the confirmed decision to match the derived diagram',
        rationale: 'The diagram must be authoritative because it is detailed' }],
      acceptanceInstruction: 'Apply the old proposed repair', actionSpec: { kind: 'none' } },
    status, executionStatus: status === 'accepted' ? 'ready' : undefined,
  }))
  const before = structuredClone(entries)
  const memory = renderAdvisoryReviewMemory(entries)
  const records = JSON.parse(memory.split('\n')[1])
  assert.deepEqual(records, entries.map(entry => ({
    id: entry.advisory.id, profile: entry.advisory.profile, status: entry.status,
    items: [{ id: item.id, title: item.title, references: item.references }],
    inputs: entry.advisory.inputs,
    ...(entry.executionStatus ? { executionStatus: entry.executionStatus } : {}),
  })))
  assert.deepEqual(entries, before, 'The persisted advice remains complete and unchanged')
  assert.doesNotMatch(memory, /Rewrite the confirmed decision|diagram must be authoritative|Apply the old proposed repair/)
  for (const depth of ['light', 'standard', 'thorough']) {
    const prompt = `${renderDesignReviewDepth(depth)}\n${memory}`
    assert.match(prompt, /Publication owns exact duplicate filtering/)
    assert.match(prompt, /acceptance proves neither factual correctness nor repair/)
    assert.match(prompt, /Respect a still-valid rejection or no-action reason/)
    assert.match(prompt, /recorded Agent choice, not necessarily a direct user statement/)
    assert.doesNotMatch(prompt, /Reuse valid existing advice|reuse the existing ID|Before treating old advice as coverage|Return no new findings when/)
  }
})

test('review memory retains a persisted follow-up choice and its reason after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gra-follow-up-memory-'))
  const value = {
    ...advisory, schemaVersion: 2, profile: 'io.deepseek.design.advisory.alignment/v2',
    resultRef: 'result-a1', inputs: [{ source: 'design-state', revision: 'state-1' }],
    kind: 'reminder', attention: 'human-review', summary: 'Clarify the product goal',
    acceptanceInstruction: 'Review the current need before choosing a follow-up',
    actionSpec: { kind: 'review-choice', profile: 'alignment', entityRefs: ['i1'] },
    blocksConversation: false, authorizesDesignWrite: false,
  }
  try {
    for (const [kind, reason] of [
      ['no-action', 'The user confirmed the current scope and asked to continue with flows. Revisit only if a conflicting need appears.'],
      ['host-question', 'Ask which audience the user wants to prioritize before changing the scope.'],
    ]) {
      const journal = new DesignAdvisoryJournal(new DesignJournalStorage(root))
      await journal.publish(kind, value)
      const [accepted] = await journal.decide(kind, { advisoryId: value.id, decision: 'accepted' })
      const selected = await journal.selectReviewAction(kind, {
        advisoryId: value.id, acceptanceReceiptId: accepted.acceptanceReceiptId, kind, reason,
      })
      const restored = await new DesignAdvisoryJournal(new DesignJournalStorage(root)).list(kind)
      const prompt = renderAdvisoryReviewMemory(restored)
      const [record] = JSON.parse(prompt.split('\n')[1])
      assert.equal(record.status, 'accepted', 'Acceptance is distinct from the follow-up choice')
      assert.deepEqual(record.selection, { kind, reason, journalRevision: selected.selection.journalRevision })
      assert.equal(record.executionStatus, selected.executionStatus)
      assert.doesNotMatch(prompt, new RegExp(accepted.acceptanceReceiptId), 'Review memory must not transport executable receipts')
    }
    const prompt = renderAdvisoryReviewMemory([])
    assert.match(prompt, /source-backed correction/)
    assert.match(prompt, /Host-question\/research selection alone does not prove completion/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('journal serializes duplicate publications and restores rejection memory after restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gra-memory-'))
  const value=id=>({...advisory,id,profile:'io.deepseek.design.advisory.alignment/v1',resultRef:`${id}-result`,inputs:[{source:'design-state',revision:'state-1'}],kind:'reminder',attention:'human-review',summary:'Check permissions',acceptanceInstruction:'Ask user',blocksConversation:false,authorizesDesignWrite:false})
  try {
    let journal=new DesignAdvisoryJournal(new DesignJournalStorage(root))
    await Promise.all(['first','second'].map(id=>journal.publish('conv',value(id))))
    const entries=await journal.list('conv')
    assert.equal(entries.length,1)
    await journal.decide('conv',{advisoryId:entries[0].advisory.id,decision:'rejected'})
    journal=new DesignAdvisoryJournal(new DesignJournalStorage(root))
    assert.equal((await journal.publish('conv',value('third'))).length,1)
    assert.equal((await journal.publish('conv',{...value('fourth'),items:[{...item,detail:'newly observed evidence'}]})).length,2)
  }finally{await rm(root,{recursive:true,force:true})}
})
