import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { renderAdvisoryReviewMemory, suppressRepeatedAdvisoryItems } = await import('../src/advisory-review-memory.ts')
const { DesignAdvisoryJournal } = await import('../src/design-advisory-journal.ts')
const { DesignJournalStorage } = await import('../src/design-journal-storage.ts')
const item = {id:'i1',title:'missing permission',detail:'source A lacks permission',references:['a#/permission']}
const advisory = {schemaVersion:1,id:'a1',profile:'design.grounding',items:[item]}
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
test('memory contains disposition and evidence, explicitly not source truth or permanent rejection',()=>{
  const prompt=renderAdvisoryReviewMemory([{advisory,status:'rejected'}])
  assert.match(prompt,/"status":"rejected"/)
  assert.match(prompt,/not a solved issue or permanent ban/)
  assert.match(prompt,/New evidence is allowed even at an unchanged checkpoint/)
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
    assert.match(prompt, /no-action.*material new fact/)
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
