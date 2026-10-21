// Source-bound integration: real journal/storage and Companion review API,
// fake project currency/notification. Does not claim installed/native execution.
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier==='../../core/lib/index.js' || specifier==='../../core/lib/kit-loader.js')return next(new URL('../src/core-entry.ts',import.meta.url).href,context)
  return next(specifier,context)
}})
const { createCompanionReviews }=await import('../src/reviews.mjs')
const { createDesignMcp }=await import('../src/mcp.mjs')
const { Client }=await import('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport }=await import('@modelcontextprotocol/sdk/inMemory.js')
const { DesignJournalStorage }=await import('../../core/src/design-journal-storage.ts')
const { DesignAdvisoryJournal }=await import('../../core/src/design-advisory-journal.ts')
const { officialAdvisoryProfile,OFFICIAL_ALIGNMENT_PROFILE }=await import('../../core/src/official-advisory-profiles.ts')
hooks.deregister()
const threadId='00000000-0000-4000-8000-000000000001'

test('MCP advertises bounded read and selection tools with strict choice schema',async()=>{
  const server=createDesignMcp(),client=new Client({name:'review-choice-source',version:'1'})
  const [ct,st]=InMemoryTransport.createLinkedPair()
  try {
    await server.connect(st);await client.connect(ct)
    const {tools}=await client.listTools()
    const read=tools.find(x=>x.name==='design_read_review_action')
    const select=tools.find(x=>x.name==='design_select_review_action')
    assert.ok(read && select)
    assert.deepEqual(select.inputSchema.properties.kind.enum,['bundle','host-question','host-research','no-action'])
    assert.ok(select.inputSchema.required.includes('acceptanceReceiptId'))
    assert.ok(select.inputSchema.required.includes('currency'))
    const bad=await client.callTool({name:select.name,arguments:{kind:'arbitrary-write'}})
    assert.equal(bad.isError,true)
  } finally {await client.close();await server.close()}
})

async function setup({supported=false,skills=[]}={}){
  const root=await mkdtemp(join(tmpdir(),'companion-choice-'))
  let revision='initial'
  const messages=[]
  const project={project:{metadata:{id:'project'}},kit:{name:'custom',version:'1.0',skills},
    readWorkspace:async()=>({checkpoint:'commit',worktreeRevision:revision}),sendPrompt:async({text})=>{messages.push(text);return {accepted:true}}}
  const journal=new DesignAdvisoryJournal(new DesignJournalStorage(join(root,'project','reviews')))
  const advice=officialAdvisoryProfile(OFFICIAL_ALIGNMENT_PROFILE).project({schemaVersion:1,runId:'run',resultId:'result',pins:[{source:'design-state',revision:'initial'}],facetRefs:['facts']},
    {schemaVersion:1,questions:[{id:'q',facets:['facts'],decision:'Audience',question:'Which audience?',rationale:'Different needs',impact:'Changes scope'}]})
  await journal.publish(`codex:${threadId}`,advice)
  const api=createCompanionReviews({project,stateRoot:root,threadId,actionExecutionSupported:supported})
  const accepted=await api.decideAdvisory({advisoryId:advice.id,decision:'accepted'})
  const options=await api.readReviewAction({advisoryId:advice.id})
  const request={advisoryId:advice.id,acceptanceReceiptId:accepted.acceptanceReceiptId,revision:options.revision,currency:options.currency,reason:'Current user decision requires clarification'}
  return {api,request,options,messages,reopen:()=>createCompanionReviews({project,stateRoot:root,threadId,actionExecutionSupported:supported}),change:()=>{revision='changed'},close:()=>rm(root,{recursive:true,force:true})}
}
test('selected Bundle reaches existing claim/settle path across restart without a second notification',async()=>{
  const f=await setup({supported:true,skills:[{name:'interview',version:'1.0',description:'Ask questions',execution:{mode:'main'},metadata:{}}]})
  try {
    assert.equal(f.messages.length,1)
    assert.match(f.messages[0],/design_select_review_action/)
    assert.ok(f.messages[0].includes(f.request.advisoryId))
    const result=await f.api.selectReviewAction({...f.request,kind:'bundle',skillName:'interview'})
    const receiptId=result.actionReceipts[0].receiptId
    const api=f.reopen()
    const nativeBinding={mode:'main',mainThreadId:threadId,projectId:'project',skill:'interview',invocationId:'main-interview-1',finished:false}
    await assert.rejects(api.claimReviewAction({receiptId:f.request.acceptanceReceiptId,nativeBinding}),/Unknown/)
    await assert.rejects(api.claimReviewAction({receiptId,nativeBinding:{...nativeBinding,projectId:'foreign'}}),/exact advisory target/)
    const claim=await api.claimReviewAction({receiptId,nativeBinding})
    assert.equal(claim.action.state,'running')
    assert.equal((await api.claimReviewAction({receiptId,nativeBinding})).attemptId,claim.attemptId)
    await assert.rejects(api.settleReviewAction({receiptId,state:'completed',nativeBinding:{...nativeBinding,invocationId:'foreign'}}),/its Bundle invocation/)
    assert.equal((await api.settleReviewAction({receiptId,state:'completed',nativeBinding})).state,'completed')
    const restored=await f.reopen().readReviewAction({advisoryId:f.request.advisoryId})
    assert.equal(restored.entry.actionReceipts[0].state,'completed')
    assert.equal(restored.entry.selection.kind,'bundle')
    await api.decideAdvisory({advisoryId:f.request.advisoryId,decision:'accepted'})
    assert.equal(f.messages.length,1,'selection, settlement and repeated acceptance do not wake the Agent again')
  } finally {await f.close()}
})
test('zero candidates and unsupported Bundle execution still permit host questioning without write authority',async()=>{
  const f=await setup()
  try {
    assert.deepEqual(f.options.candidates,[])
    const result=await f.api.selectReviewAction({...f.request,kind:'host-question'})
    assert.deepEqual(result.actionReceipts,[])
    assert.notEqual(result.status,'completed')
    await assert.rejects(f.api.claimReviewAction({receiptId:f.request.acceptanceReceiptId}),/unsupported|Unknown/)
  } finally {await f.close()}
})
test('Companion rejects changed evidence and foreign targets, then selects one of multiple candidates',async()=>{
  const skills=['interview','survey'].map(name=>({name,version:'1.0',description:name,metadata:{skillManifest:{review_support:['alignment']}}}))
  const f=await setup({supported:true,skills})
  try {
    assert.equal(f.options.candidates.length,2)
    await assert.rejects(f.api.selectReviewAction({...f.request,kind:'bundle',skillName:'foreign'}),/unavailable/)
    const result=await f.api.selectReviewAction({...f.request,kind:'bundle',skillName:'survey'})
    assert.equal(result.actionReceipts.length,1)
    assert.equal(result.actionReceipts[0].target.skillName,'survey')
    f.change()
    await assert.rejects(f.api.selectReviewAction({...f.request,kind:'no-action'}),/context changed/)
  } finally {await f.close()}
})
