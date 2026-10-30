import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { default: DesignService } = await import('../src/design-service.ts')
const { DesignJournalRegistry } = await import('../src/design-journal-registry.ts')
const { parseSessionDesignAdvisories } = await import('../src/design-advisory-events.ts')
const { registerKnowledgeOrchestrationTools } = await import('../src/dsh-knowledge-orchestration-tools.ts')
const { officialAdvisoryProfile, OFFICIAL_ALIGNMENT_PROFILE, OFFICIAL_REFLECTION_PROFILE, OFFICIAL_GROUNDING_PROFILE } = await import('../src/official-advisory-profiles.ts')

const input = { schemaVersion:1, runId:'review', resultId:'result', pins:[{source:'design-revision',revision:'1'}],facetRefs:['facts'] }
const output = {schemaVersion:1,questions:[{id:'audience',facets:['facts'],decision:'Audience',question:'Who uses this?',rationale:'Different workflows',impact:'Navigation'}]}
test('DSH registers callable read/select tools and forwards exact selection arguments',async()=>{
  const tools=[],calls=[]
  registerKnowledgeOrchestrationTools({tools:{register:tool=>tools.push(tool)}},{
    reviewActionOptions:async(...args)=>{calls.push(args);return {revision:2}},
    selectReviewAction:async(...args)=>{calls.push(args);return {status:'accepted'}},
  })
  const read=tools.find(t=>t.name==='design_read_review_action'),select=tools.find(t=>t.name==='design_select_review_action')
  assert.ok(read && select)
  const agent={id:'a'},args={advisoryId:'advice',acceptanceReceiptId:'accepted',kitName:'custom',kitVersion:'1.0',kind:'no-action',projectId:'project',selectionRevision:1,revision:2,reason:'Resolved'}
  assert.equal(JSON.parse((await read.execute({advisoryId:'advice'},{agent})).content).revision,2)
  await select.execute(args,{agent})
  assert.deepEqual(calls,[[agent,'advice'],[agent,args]])
  await assert.rejects(select.execute(args,{}),/Agent is required/)
})
test('official Web App loads candidate hints without a unique question capability',async()=>{
  const { loadDesignKit }=await import('../src/kit-loader.ts')
  const { reviewCandidates }=await import('../src/review-support.ts')
  const root=fileURLToPath(new URL('../../skills-web-app/',import.meta.url))
  const kit=await loadDesignKit({readText:async p=>readFile(p,'utf8').catch(()=>undefined),
    listDir:p=>readdir(p),isDirectory:async p=>(await stat(p)).isDirectory()},root,{sourceId:'review-choice-official-source'})
  assert.deepEqual(reviewCandidates(kit,'alignment').map(x=>x.name),['smart_questions'])
  assert.deepEqual(reviewCandidates(kit,'reflection').map(x=>x.name),['research'])
  assert.equal(kit.skills.find(x=>x.name==='smart_questions').metadata.skillManifest.semantic_capabilities,undefined)
})
test('official profiles propose choices, not fixed Question or Research targets', () => {
  const alignment=officialAdvisoryProfile(OFFICIAL_ALIGNMENT_PROFILE).project(input,output)
  assert.equal(alignment.actionSpec.kind,'review-choice')
  assert.equal(alignment.actionSpec.profile,'alignment')
  assert.match(alignment.acceptanceInstruction,/design_select_review_action/)
  assert.doesNotMatch(alignment.acceptanceInstruction,/invoke exactly one current Kit question capability/)
  const reflection=officialAdvisoryProfile(OFFICIAL_REFLECTION_PROFILE).project(input,{schemaVersion:1,researchNeeds:[{id:'r',facets:['facts'],uncertainty:'Unknown API',whyExternalKnowledge:'Published API matters',researchQuestion:'Which API?',suggestedSources:[]}]})
  assert.deepEqual(reflection.actionSpec,{kind:'review-choice',profile:'reflection',entityRefs:['research-r']})
})

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'gra-choice-service-'))
  const journals=new DesignJournalRegistry(()=>root)
  const kit={name:'custom',version:'1.0',skills:[{name:'interview',version:'2.0',description:'Clarify product choices',metadata:{}}]}
  const advisory=officialAdvisoryProfile(OFFICIAL_ALIGNMENT_PROFILE).project(input,output)
  await journals.publish('scope','main',advisory)
  const entries=await journals.decide('scope','main',{advisoryId:advisory.id,decision:'accepted'},[])
  let binding={projectId:'project',revision:1}
  const service={journals,kitForAgent:()=>kit,selectionForAgent:()=>binding,withJournal:(_a,fn)=>fn('scope','main',{projectId:'project'}),notifyWorkspaceChange(){},injectAdvisoryProjection(){}}
  const read=()=>DesignService.prototype.reviewActionOptions.call(service,{},advisory.id)
  const select=params=>DesignService.prototype.selectReviewAction.call(service,{},params)
  const options=await read()
  const request={advisoryId:advisory.id,acceptanceReceiptId:entries[0].acceptanceReceiptId,revision:options.revision,projectId:'project',selectionRevision:1,kitName:kit.name,kitVersion:kit.version,reason:'Current evidence requires a short interview'}
  return {read,select,request,kit,service,switchProject:()=>{binding={projectId:'other',revision:2}},close:async()=>{await rm(root,{recursive:true,force:true})}}
}

test('unmarked suitable Bundle can be selected; exact target is minted only after selection',async()=>{
  const f=await fixture()
  try {
    const options=await f.read()
    assert.deepEqual(options.entry.actionReceipts,[])
    assert.deepEqual(options.candidates[0].review_support,[])
    const selected=await f.select({...f.request,kind:'bundle',skillName:'interview'})
    assert.deepEqual((await f.select({...f.request,kind:'bundle',skillName:'interview'})).actionReceipts,selected.actionReceipts,'lost response retries reuse the original receipt')
    assert.equal(selected.actionReceipts.length,1)
    assert.deepEqual(selected.actionReceipts[0].target,{kitName:'custom',kitVersion:'1.0',skillName:'interview',bundleVersion:'2.0',entityRefs:['question-audience']})
    const wire={advisory:selected.advisory,status:selected.status,stale:false,acceptanceReceiptId:selected.acceptanceReceiptId,
      actionReceipts:selected.actionReceipts,executionStatus:selected.executionStatus,selection:selected.selection}
    assert.deepEqual(parseSessionDesignAdvisories([wire])[0].selection,selected.selection)
    assert.throws(()=>parseSessionDesignAdvisories([{...wire,selection:{...selected.selection,acceptanceReceiptId:'foreign'}}]),/identity mismatch/)
    assert.throws(()=>parseSessionDesignAdvisories([{...wire,actionReceipts:[{...selected.actionReceipts[0],target:{...selected.actionReceipts[0].target,skillName:'foreign'}}]}]),/action mismatch/)
  } finally {await f.close()}
})

test('host fallback mints no write receipt and wrong Kit, revision, or target is rejected',async()=>{
  const f=await fixture()
  try {
    await assert.rejects(f.select({...f.request,kind:'bundle',skillName:'absent'}),/not in/)
    await assert.rejects(f.select({...f.request,kind:'no-action',kitVersion:'changed'}),/context changed/)
    await assert.rejects(f.select({...f.request,kind:'no-action',revision:0}),/revision changed/)
    await assert.rejects(f.select({...f.request,kind:'host-question',skillName:'interview'}),/cannot carry/)
    const selected=await f.select({...f.request,kind:'host-question'})
    assert.equal(selected.actionReceipts.length,0)
    assert.notEqual(selected.status,'completed','selection is not evidence of execution')
    const wire={advisory:selected.advisory,status:selected.status,stale:false,acceptanceReceiptId:selected.acceptanceReceiptId,
      actionReceipts:selected.actionReceipts,executionStatus:selected.executionStatus,selection:{...selected.selection,kind:'host-research'}}
    assert.throws(()=>parseSessionDesignAdvisories([wire]),/profile mismatch/)
  } finally {await f.close()}
})

test('project switching while an options read is pending cannot mix Kit and journal scopes',async()=>{
  const f=await fixture()
  try {
    const original=f.service.journals.read.bind(f.service.journals)
    f.service.journals.read=async(...args)=>{const result=await original(...args);f.switchProject();return result}
    await assert.rejects(f.read(),/project changed/)
    await assert.rejects(f.select({...f.request,kind:'host-question'}),/project changed/)
  } finally {await f.close()}
})

test('Grounding details read by exact report id preserves receipts and cannot select another Bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'grounding-read-service-'))
  try {
    const journals = new DesignJournalRegistry(() => root)
    const kit = { name: 'fixture', version: '1.0', skills: ['design_style', 'page_design'].map(name => ({ name, version: '1.0' })) }
    const profile = officialAdvisoryProfile(OFFICIAL_GROUNDING_PROFILE)
    const advice = (runId, detail) => profile.project({ ...input, runId }, { schemaVersion: 1, inconsistencies: [{
      id: 'GND-004', facets: ['page_design', 'design_style'], summary: detail,
      authoritativeReference: 'design_files/page_design/pages/detail.html', correction: detail, affectedFacets: ['page_design', 'design_style'],
    }] })
    const previous = advice('previous', 'Change the sidebar layout.')
    const current = advice('current', 'Fix ../tokens.css to ../../design_style/tokens.css.')
    for (const advisory of [previous, current]) await journals.publish('scope', 'main', advisory)
    const actions = current.actionSpec.targets.map(target => ({ actionId: `bundle:${target.skillName}`,
      target: { kitName: kit.name, kitVersion: kit.version, skillName: target.skillName, bundleVersion: '1.0', entityRefs: target.entityRefs } }))
    await journals.decide('scope', 'main', { advisoryId: current.id, decision: 'accepted' }, actions)
    const service = { journals, kitForAgent: () => kit, selectionForAgent: () => ({ projectId: 'project', revision: 1 }),
      withJournal: (_agent, fn) => fn('scope', 'main', { projectId: 'project' }) }
    const before = await journals.read('scope', 'main')
    const read = advisoryId => DesignService.prototype.reviewActionOptions.call(service, {}, advisoryId)
    const options = await read(current.id)
    assert.equal(options.entry.advisory.id, current.id)
    assert.equal(options.entry.status, 'accepted')
    assert.match(options.entry.advisory.items[0].detail, /tokens\.css/)
    assert.doesNotMatch(options.entry.advisory.items[0].detail, /sidebar/)
    assert.equal(options.entry.actionReceipts.length, 2)
    assert.deepEqual(options.candidates, [], 'fixed targets expose no new choice authority')
    assert.match((await read(previous.id)).entry.advisory.items[0].detail, /sidebar/)
    await assert.rejects(read(current.items[0].id), /unknown advisory.*full advisoryId/)
    await assert.rejects(DesignService.prototype.selectReviewAction.call(service, {}, {
      advisoryId: current.id, acceptanceReceiptId: options.entry.acceptanceReceiptId, kind: 'bundle', skillName: 'page_design',
      reason: 'Try to replace an existing target', projectId: 'project', selectionRevision: 1,
      revision: options.revision, kitName: kit.name, kitVersion: kit.version,
    }), /no agentic choice/)
    assert.deepEqual(await journals.read('scope', 'main'), before, 'reads and rejected selection never mutate receipts or the journal')
  } finally { await rm(root, { recursive: true, force: true }) }
})
