import { createHash } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { registerQwenWorkHook, createQwenWorkHookConnection, receiveQwenWorkHook, QWENWORK_NOTICE_FILE } from '../src/qwenwork-hook-transport.mjs'
import { matchesQwenWorkMain, inspectQwenWorkProcess, findQwenWorkAncestor, readQwenWorkRuntimePins, qwenWorkDarwinProcess } from '../src/qwenwork-connection.mjs'
import { nativeScope } from '../src/native-identity.mjs'
import { createQwenWorkTranscript } from '../src/qwenwork-transcript.mjs'
import { createQoderTranscript } from '../src/qoder-transcript.mjs'
import { partitionReviewConversation } from '../src/background-reviews.mjs'

test('Mac runtime locator accepts only local POSIX absolute configuration',async()=>{
 const pins={executable:'/Applications/QwenWorkCN.app/Contents/MacOS/QwenWorkCN'}
 let observed
 assert.deepEqual(await readQwenWorkRuntimePins({platform:'darwin',environment:{YUGOO_QWENWORK_RUNTIME_CONFIG:'/Users/设计/pins.json'},read:async path=>{observed=path;return JSON.stringify(pins)}}),pins)
 assert.equal(observed,'/Users/设计/pins.json')
 for(const path of ['C:\\Qwen\\pins.json','relative.json','/bad\npath'])await assert.rejects(readQwenWorkRuntimePins({platform:'darwin',environment:{YUGOO_QWENWORK_RUNTIME_CONFIG:path}}),/absolute/)
 await assert.rejects(readQwenWorkRuntimePins({platform:'linux'}),/Windows or macOS/)
})

function macProcessFixture(){
 const executable='/Applications/QwenWorkCN.app/Contents/MacOS/QwenWorkCN'
 const state={parent:48517,uid:501,executable,args:executable,start:1793179778.392114,terminated:false,psCalls:0,changeParent:false},calls=[]
 const run=async(tool,args,options)=>{
  calls.push({tool,args,options})
  if(tool==='/usr/bin/osascript'){
   if(state.invisible)throw Error('AppKit returned nil in this sandbox')
   return {stdout:JSON.stringify({pid:69392,executable:state.executable,start:state.start,terminated:state.terminated})}
  }
  if(args.at(-1)==='args=')return {stdout:state.args+'\n'}
  state.psCalls++
  return {stdout:`69392 ${state.changeParent&&state.psCalls>1?1:state.parent} ${state.uid} Wed Oct 28 10:29:38 2026 ${state.executable}\n`}
 }
 return {state,calls,executable,read:()=>qwenWorkDarwinProcess(69392,{executable,uid:501,run})}
}

test('Mac snapshots retain actual parent and AppKit generation using bounded system tools',async()=>{
 const f=macProcessFixture(),snapshot=await f.read()
 assert.equal(snapshot.parent,48517);assert.equal(snapshot.procStart,'appkit:1793179778.392114')
 assert.equal(snapshot.commandLine,f.executable)
 assert.equal(f.calls.length,4)
 assert.ok(f.calls.every(c=>c.options.timeout===15000&&c.options.maxBuffer===262144&&c.options.env.LC_ALL==='C'))
 assert.ok(f.calls.every(c=>!c.args.includes('rawstart=')&&!c.args.includes('-axo')))
 const child=macProcessFixture();child.state.executable='/bin/zsh'
 assert.equal((await child.read()).procStart,undefined)
 assert.equal(child.calls.length,1,'non-application ancestors carry no accepted generation')
 const messaging=macProcessFixture();messaging.state.args+=' /Applications/QwenWorkCN.app/Contents/Resources/native-messaging-host/host.js'
 assert.equal((await messaging.read()).procStart,undefined)
 assert.equal(messaging.calls.length,2,'Chrome native messaging must be excluded before AppKit lookup')
})

test('Mac process evidence rejects foreign owner, missing launch identity and changed process',async()=>{
 const owner=macProcessFixture();owner.state.uid=502;await assert.rejects(owner.read(),/identity/)
 for(const start of [null,0,'1793179778',-1]){const f=macProcessFixture();f.state.start=start;await assert.rejects(f.read(),/identity/)}
 const ended=macProcessFixture();ended.state.terminated=true;await assert.rejects(ended.read(),/identity/)
 const invisible=macProcessFixture();invisible.state.invisible=true
 await assert.rejects(invisible.read(),/identity is unobservable.*generation could not be verified/)
 const changed=macProcessFixture();changed.state.changeParent=true;await assert.rejects(changed.read(),/changed during/)
 await assert.rejects(qwenWorkDarwinProcess(0),/PID/)
})

test('Mac admission pins executable and worker bytes, rejects helper, symlink target and PID reuse',async()=>{
 const f=macProcessFixture(),snapshot=await f.read(),hash=createHash('sha256').update('fixed').digest('hex')
 const pins={executable:f.executable,worker:'/Applications/QwenWorkCN.app/Contents/Resources/app.asar.unpacked/worker.mjs',executableSha256:hash,workerSha256:hash}
 const deps={platform:'darwin',snapshot:async()=>snapshot,canonical:async p=>p,bytes:async()=>Buffer.from('fixed')}
 assert.equal((await inspectQwenWorkProcess(69392,pins,deps)).supported,true)
 assert.equal(matchesQwenWorkMain({...snapshot,commandLine:snapshot.commandLine+' --type=renderer'},pins,{platform:'darwin'}),false)
 assert.equal(matchesQwenWorkMain({...snapshot,procStart:snapshot.observedStart},pins,{platform:'darwin'}),false)
 await assert.rejects(inspectQwenWorkProcess(69392,pins,{...deps,bytes:async()=>Buffer.from('replaced')}),/bytes changed/)
 await assert.rejects(inspectQwenWorkProcess(69392,pins,{...deps,canonical:async()=>'/foreign'}),/outside its pins/)
 let n=0;await assert.rejects(inspectQwenWorkProcess(69392,pins,{...deps,snapshot:async()=>({...snapshot,procStart:`appkit:1793179778.${++n}`})}),/changed during/)
 await assert.rejects(inspectQwenWorkProcess(69392,{...pins,worker:'C:\\worker.mjs'},deps),/worker path/)
})

test('Qwen internal notification descendants stay in background until an actual human turn',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-visibility-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const sessionId='00000000-0000-4000-8000-000000000001',path=join(root,'session.jsonl')
 const event=(uuid,parentUuid,type,content,extra={})=>({uuid,parentUuid,type,sessionId,cwd:root,message:{content},...extra})
 const rows=[event('human',null,'user','Discuss GRA',{origin:{kind:'human'}}),
  event('answer','human','assistant','GRA is a legitimate public topic'),
  event('notice','answer','user','An internal event',{isMeta:true,origin:{kind:'task-notification'}}),
  event('hidden','notice','assistant','Background processing'),
  event('tool','hidden','assistant',[{type:'tool_use',id:'call',name:'Agent',input:{prompt:'PRIVATE'}}])]
 await writeFile(path,rows.map(JSON.stringify).join('\n')+'\n')
 const observer=createQwenWorkTranscript({path,sessionId,projectRoot:root})
 const project=log=>partitionReviewConversation(log,[],{connectionPath:'/exact'})
 const first=project(await observer.read())
 assert.deepEqual(first.conversation.rows.map(r=>r.id),['human','answer'])
 assert.deepEqual(first.backgroundRows.map(r=>r.id),['hidden','call'])
 assert.equal(first.conversation.backgroundActivity,true)
 assert.doesNotMatch(JSON.stringify(first),/PRIVATE|An internal event/)
 await appendFile(path,JSON.stringify(event('result','tool','user',[{type:'tool_result',tool_use_id:'call'}]))+'\n'+JSON.stringify(event('end','result','assistant','Done'))+'\n')
 assert.deepEqual(project(await observer.read()).backgroundRows.map(r=>r.id),['hidden','call','end'])
 await appendFile(path,JSON.stringify(event('next','end','user','GRA again',{origin:{kind:'human'}}))+'\n'+JSON.stringify(event('reply','next','assistant','Public reply'))+'\n')
 const next=project(await observer.read())
 assert.deepEqual(next.conversation.rows.map(r=>r.id),['human','answer','next','reply'])
 assert.equal(next.conversation.backgroundActivity,false)
 await appendFile(path,JSON.stringify(event('fork','answer','assistant','Public sibling'))+'\n')
 assert.deepEqual(project(await observer.read()).conversation.rows.map(r=>r.id),['human','answer','fork'])
 const qoder=await createQoderTranscript({path,sessionId,projectRoot:root}).read()
 assert.ok(qoder.rows.every(r=>r.nativeBackground===undefined),'Qwen visibility does not change other SDK hosts')
})

test('late Qwen registration binds exact session/transcript, silent readiness and restart rejection', async t => {
 const root = await mkdtemp(join(tmpdir(), 'qwen-hook-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const transcriptPath=join(root,'main.jsonl'), foreign=join(root,'foreign.jsonl');await writeFile(transcriptPath,'');await writeFile(foreign,'')
 const sessionId='00000000-0000-4000-8000-000000000001';let native={pid:123,procStart:'1'}
 const options={sessionId,nativeCwd:root,transcriptPath,hookRoot:join(root,'private'),timeoutMs:1000,resolveSession:async()=>native}
 const event={session_id:sessionId,cwd:root,transcript_path:transcriptPath,hook_event_name:'PostToolUse'}
 await registerQwenWorkHook(event,options)
 assert.notEqual(nativeScope('qwenwork',sessionId),nativeScope('qoder',sessionId))
 await assert.rejects(createQwenWorkHookConnection({...options,transcriptPath:foreign}),/does not match/)
 await assert.rejects(registerQwenWorkHook({...event,transcript_path:foreign},options),/transcript changed/)
 const changed={...event,hook_event_name:'FileChanged',file_path:join(root,QWENWORK_NOTICE_FILE).replaceAll('\\','/'),event:'change'}
 for (const file_path of [QWENWORK_NOTICE_FILE, join(root,'another-file'), join(root+'-sibling',QWENWORK_NOTICE_FILE)]) assert.equal(await receiveQwenWorkHook({...changed,file_path},options),'')
 const received=[];let stop=false
 const loop=(async()=>{while(!stop){assert.equal(await receiveQwenWorkHook({...changed,transcript_path:foreign},options),'');const value=await receiveQwenWorkHook(changed,options);if(value)received.push(value);await delay(10)}})()
 try {
  const c=await createQwenWorkHookConnection(options);assert.deepEqual(received,[])
  assert.equal((await c.send('Saved event within authorized design task')).accepted,true)
  assert.equal(received.length,1)
  native={pid:123,procStart:'2'};await assert.rejects(c.send('stale'),/process changed/)
 }finally{stop=true;await loop}
})

test('ancestor binding chooses only verified desktop process, rejects cycles and absence', async()=>{
 const snapshots={3:{parent:4},4:{parent:5},5:{parent:1}}
 const result=await findQwenWorkAncestor(3,async pid=>({supported:pid===5,procStart:'100'}),async pid=>snapshots[pid])
 assert.deepEqual(result,{pid:5,procStart:'100'})
 await assert.rejects(findQwenWorkAncestor(3,async()=>({supported:false}),async()=>({parent:3})),/loop/)
 await assert.rejects(findQwenWorkAncestor(3,async()=>({supported:false}),async pid=>snapshots[pid]),/not under/)
})

test('desktop identity rejects renderer/helpers, replaced bytes and PID reuse',async()=>{
 const hash=createHash('sha256').update('fixed').digest('hex')
 const pins={executable:'C:/Qwen/QwenWorkCN.exe',worker:'C:/Qwen/worker.mjs',executableSha256:hash,workerSha256:hash}
 const native={pid:42,parent:1,procStart:'1',executable:pins.executable,commandLine:'"C:/Qwen/QwenWorkCN.exe"'}
 assert.equal(matchesQwenWorkMain(native,pins,{platform:'win32'}),true)
 assert.equal(matchesQwenWorkMain({...native,commandLine:native.commandLine+' --type=renderer'},pins,{platform:'win32'}),false)
 const deps={platform:'win32',snapshot:async()=>native,canonical:async p=>p,bytes:async()=>Buffer.from('fixed')}
 assert.equal((await inspectQwenWorkProcess(42,pins,deps)).supported,true)
 await assert.rejects(inspectQwenWorkProcess(42,pins,{...deps,bytes:async()=>Buffer.from('changed')}),/bytes changed/)
 let n=0;await assert.rejects(inspectQwenWorkProcess(42,pins,{...deps,snapshot:async()=>({...native,procStart:String(++n)})}),/changed during/)
})


test('ancestor inspection reuses the observed snapshot and still rechecks the verified root', async()=>{
 const hash=createHash('sha256').update('fixed').digest('hex')
 const pins={executable:'C:/Qwen/QwenWorkCN.exe',worker:'C:/Qwen/worker.mjs',executableSha256:hash,workerSha256:hash}
 const root={pid:42,parent:1,procStart:'1',executable:pins.executable,commandLine:'"C:/Qwen/QwenWorkCN.exe"'}
 const child={pid:43,parent:42,procStart:'2',executable:'C:/Node/node.exe',commandLine:'node script.mjs'}
 const calls=[];const snapshot=async pid=>{calls.push(pid);return pid===42?root:child}
 const inspect=(pid,initial)=>inspectQwenWorkProcess(pid,pins,{platform:'win32',initial,snapshot,canonical:async p=>p,bytes:async()=>Buffer.from('fixed')})
 assert.deepEqual(await findQwenWorkAncestor(43,inspect,snapshot),{pid:42,procStart:'1'})
 assert.deepEqual(calls,[43,42,42])
})

test('idle notices resume once in the exact native conversation; claimed timeouts never replay', async t=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-resume-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const path=join(root,'main.jsonl'),foreign=join(root,'other.jsonl');await writeFile(path,'');await writeFile(foreign,'')
 const sessionId='00000000-0000-4000-8000-000000000002'
 const options={sessionId,nativeCwd:root,transcriptPath:path,hookRoot:join(root,'hooks'),timeoutMs:100,resolveSession:async()=>({pid:123,procStart:'1'})}
 const event={session_id:sessionId,cwd:root,transcript_path:path,hook_event_name:'SessionStart'}
 const changed={...event,hook_event_name:'FileChanged',file_path:join(root,QWENWORK_NOTICE_FILE),event:'change'}
 await registerQwenWorkHook(event,options)
 let live=true;const loop=(async()=>{while(live){await receiveQwenWorkHook(changed,options);await delay(5)}})()
 let connection;try {connection=await createQwenWorkHookConnection(options)}finally{live=false;await loop}
 assert.deepEqual(await connection.send('Saved checkpoint: read canonical state'),{accepted:true,status:'queued_for_resume'})
 assert.equal(await receiveQwenWorkHook({...event,transcript_path:foreign},options),'')
 assert.equal(await receiveQwenWorkHook({...event,agent_id:'child'},options),'')
 assert.match(await receiveQwenWorkHook(event,options),/Saved checkpoint/)
 assert.equal(await receiveQwenWorkHook({...event,hook_event_name:'PostToolUse'},options),'','do not redeliver after SessionStart')
 let claimedResolve;const claimed=new Promise(resolve=>{claimedResolve=resolve});let release;const gate=new Promise(resolve=>{release=resolve})
 const sending=connection.send('Already claimed must not replay')
 let receiving
 for(let n=0;n<20;n++){
  receiving=receiveQwenWorkHook(changed,{...options,afterClaim:async()=>{claimedResolve();await gate}})
  if(await Promise.race([claimed.then(()=>true),receiving.then(()=>false)]))break
  await delay(5)
 }
 await claimed
 assert.deepEqual(await sending,{accepted:false,status:'unknown'})
 release();await receiving
 assert.equal(await receiveQwenWorkHook(event,options),'','claimed timeout is never retained for retry')
})
