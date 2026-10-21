// Explicit opt-in native model check. No automatic test-suite model calls.
// Uses real Companion HTTP/journal and compiled MCP; notification is captured
// and supplied to a fresh claude-qwen print session, not native hook delivery.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const {register}=await import('tsx/esm/api');register()
const stateMode=process.argv.includes('--bundle-state')
const bundleMode=stateMode||process.argv.includes('--bundle-cancel')
const hooks=registerHooks({resolve(s,c,next){
  if(s==='dsh-design-core'||s==='../../core/lib/index.js'||s==='../../core/lib/kit-loader.js')return next(new URL('../src/core-entry.ts',import.meta.url).href,c)
  return next(s,c)
}})
const {fixture,threadId}=await import('./fixture.mjs')
const {callCompanion}=await import('../src/connection-file.mjs')
const {DesignJournalStorage}=await import('../../core/src/design-journal-storage.ts')
const {DesignAdvisoryJournal}=await import('../../core/src/design-advisory-journal.ts')
const {officialAdvisoryProfile,OFFICIAL_ALIGNMENT_PROFILE}=await import('../../core/src/official-advisory-profiles.ts')
hooks.deregister()
const f=await fixture({smartQuestionsMode:'main',serverOptions:{host:'claude-code'}})
try {
  const profile=officialAdvisoryProfile(OFFICIAL_ALIGNMENT_PROFILE)
  const advice=profile.project({schemaVersion:1,runId:'native-choice',resultId:'audience',pins:[{source:'design-state',revision:'initial'}],facetRefs:['smart_questions']},
    {schemaVersion:1,questions:[{id:'audience',facets:['smart_questions'],decision:'Target audience',question:'Who is the primary audience?',rationale:'User preference is unresolved',impact:'Determines scope'}]})
  const journal=new DesignAdvisoryJournal(new DesignJournalStorage(join(f.options.stateRoot,f.server.project.project.metadata.id,'reviews')))
  const conversation=`claude-code:${threadId}`
  await journal.publish(conversation,advice)
  const accepted=await callCompanion(f.server.connectionPath,{method:'decideAdvisory',params:{advisoryId:advice.id,decision:'accepted'}})
  assert.equal(accepted.notification,'sent')
  assert.equal(f.messages.length,1)
  const configDir=join(f.root,'native-config');await mkdir(configDir)
  const binary=fileURLToPath(new URL('../dist-server/design.mjs',import.meta.url))
  const mcp=JSON.stringify({mcpServers:{design:{command:process.execPath,args:[binary,'mcp']}}})
  const intent=stateMode
    ? 'Current user intent: use the Smart Questions Bundle panel to ask one short text question about target audience. Read the choice and choose a suitable Bundle, prepare it, begin main execution, and claim the exact action receipt. Read its method and output contract using Read before editing. Write exactly one unanswered target-audience question to the canonical state path disclosed by begin/prepare, using Write. Do not invent an answer. Then finish main bundle with scope=state and outcome=pause and settle the action; the correct outcome is waiting for the user, never completed. Use only the isolated project/kit paths supplied by tools; do not modify kit resources or any other files.'
    : bundleMode
    ? 'Current user intent: use the Smart Questions Bundle panel for this clarification. This is a cancellation-path test: read the choice, select the suitable Bundle, prepare it, begin main execution, claim its exact action receipt with the returned invocationId, then cancel using design_finish_main_bundle outcome=cancelled and settle that action. Do not write any files, call shell tools, or claim successful design completion. Stop after cancellation settlement.'
    : 'Current user intent: ask me one short question about the audience directly in this conversation; do not open a design panel or create Design Files for this question. After recording the choice, ask the question and stop. Do not claim the question is answered or execution completed.'
  const allowed=['design_status','design_read_review_action','design_select_review_action',...(bundleMode?['design_prepare_bundle','design_begin_main_bundle','design_claim_action','design_finish_main_bundle','design_settle_action']:[])].map(name=>`mcp__design__${name}`)
  // Claude 2.1.209 applies Edit(path) permissions to Write as well. A scoped
  // Write(path) rule was rejected in the native check; keep the same narrow path.
  if(stateMode)allowed.push(`Read(/${f.root}/**)`,`Edit(/${f.options.projectRoot}/design_files/smart_questions/**)`)
  const prompt=`You are the main design Agent in an isolated integration test. Native session ID: ${threadId}. Exact Companion connection path: ${f.server.connectionPath}. Do not read its contents. Use only allowed design MCP tools. The project is already selected; do not run design_command. Knowledge is deliberately disabled in this isolated fixture. Read review options and record selection BEFORE beginning the Bundle, so your own lifecycle operations do not stale the selection revision. Finish with one short sentence, not a tool-call recap.\n${f.messages[0]}\n${intent}`
  const events=[]
  const result=await new Promise((resolve,reject)=>{
    // Keep claude-qwen's existing private gateway/authentication. Its model
    // requires an explicit request policy, not merely a client UI/env toggle.
    const child=spawn('claude-qwen',['--print','--thinking','disabled','--no-session-persistence','--session-id',threadId,'--setting-sources','','--settings','{"disableAllHooks":true}',
      '--strict-mcp-config','--mcp-config',mcp,'--tools',stateMode?'Read,Write':'','--allowedTools',...allowed,
      '--permission-mode','dontAsk','--disable-slash-commands','--output-format','stream-json','--verbose',prompt],
      {cwd:f.root,env:{...process.env,CLAUDE_CONFIG_DIR:configDir},stdio:['ignore','pipe','pipe'],detached:true})
    let buffer='',bytes=0,last
    const stop=()=>{try{process.kill(-child.pid,'SIGTERM')}catch{}}
    let killer
    const timer=setTimeout(()=>{stop();killer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},5000)},stateMode?420000:120000)
    child.stdout.on('data',data=>{
      bytes+=data.length;if(bytes>1000000){stop();return}
      buffer+=data.toString()
      let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{
        const event=JSON.parse(line)
        if(event.type==='assistant')for(const block of event.message?.content??[])if(block.type==='tool_use'){events.push(block.name);console.log(JSON.stringify({tool:block.name,...(block.name==='Write'?{path:block.input?.file_path}: {})}))}
        if(event.type==='user')for(const block of event.message?.content??[])if(block.type==='tool_result'&&block.is_error)console.log(JSON.stringify({toolError:String(typeof block.content==='string'?block.content:JSON.stringify(block.content)).slice(0,500).replace(/[a-f0-9]{64}/gi,'[redacted]')}))
        if(event.type==='result')last=event
      }catch{}}
    })
    child.stderr.on('data',()=>{}) // Never echo credential-bearing native diagnostics.
    child.on('error',error=>{clearTimeout(timer);reject(error)})
    child.on('close',(code,signal)=>{clearTimeout(timer);clearTimeout(killer);resolve({code,signal,last})})
  })
  console.log(JSON.stringify({nativeExit:result.code,signal:result.signal,tools:events,nativeResult:result.last?.subtype}))
  const entry=(await journal.list(conversation)).find(item=>item.advisory.id===advice.id)
  console.log(JSON.stringify({selection:entry.selection?.kind,actionStates:entry.actionReceipts?.map(action=>action.state)}))
  assert.equal(result.code,0,'native process must finish successfully')
  assert.ok(events.some(name=>name.endsWith('design_read_review_action')))
  assert.ok(events.some(name=>name.endsWith('design_select_review_action')))
  assert.equal(entry.selection?.kind,bundleMode?'bundle':'host-question')
  assert.equal(entry.actionReceipts.length,bundleMode?1:0)
  if(bundleMode){
    assert.equal(entry.actionReceipts[0].state,stateMode?'needs-user-input':'failed','Bundle must settle to the correct non-completed outcome')
    for(const name of ['design_claim_action','design_finish_main_bundle','design_settle_action'])assert.ok(events.some(tool=>tool.endsWith(name)),name)
  }
  if(stateMode){
    const saved=JSON.parse(await readFile(join(f.options.projectRoot,'design_files','smart_questions','smart_questions.json'),'utf8'))
    const questions=Object.entries(saved.questions).filter(([key])=>!key.startsWith('const_'))
    assert.equal(questions.length,1,'one user-requested question, excluding protected fixed cards')
    assert.equal(questions[0][1].kind,'text')
    assert.ok(!questions[0][1].answer,'do not invent a user answer')
    assert.ok(questions[0][1].prompt.trim())
    assert.equal((await callCompanion(f.server.connectionPath,{method:'readReviewAction',params:{advisoryId:advice.id}})).entry.actionReceipts[0].state,'needs-user-input')
  }
  assert.notEqual(entry.status,'completed')
  assert.ok(result.last?.result?.trim(),'host must produce a user-facing question')
  console.log(JSON.stringify({finalText:result.last.result.slice(0,800).replace(/[a-f0-9]{64}/gi,'[redacted]')}))
  console.log(`CLAUDE-QWEN NATIVE CHOICE PASS: ${stateMode?'Bundle state generation and user-input handoff':bundleMode?'Bundle selection, claim and cancellation settlement':'host-question selection without Bundle write authority'}. Real model -> compiled MCP -> actual HTTP -> durable journal. Hook notification and full design completion are separate boundaries.`)
} finally {await f.close()}
