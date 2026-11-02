import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopInputConnection, createQwenWorkPanelConnection, resolveQwenWorkInputMode, createQwenWorkDesktopInput, qwenWorkUserDataRoot } from '../src/qwenwork-desktop-input.mjs'
import { readNativePrivateFile } from '../src/native-hook-transport.mjs'
import { mkdtemp, mkdir, writeFile, readFile, chmod, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { requireNotificationAccepted, notificationAutoDismiss } from '../src/notification-result.mjs'

async function macDesktopFixture(t){
 const home=await mkdtemp(join(tmpdir(),'qwen-mac-input-'));t.after(()=>rm(home,{recursive:true,force:true}))
 const root=qwenWorkUserDataRoot({platform:'darwin',home}),sessionId='00000000-0000-4000-8000-000000000003'
 const nativeCwd=join(home,'中文 workspace'),transcriptPath=join(nativeCwd,'session.jsonl')
 await mkdir(nativeCwd);await writeFile(transcriptPath,'')
 const endpointFile=join(root,'cli-control/endpoint.json'),tokenFile=join(root,'cli-control','a'.repeat(32),'token')
 const bindingFile=join(home,'.local/state/design-system/qwenwork-hooks',sessionId,'binding.json')
 const endpoint={protocol:'qwenwork.desktop.v1',instance_id:'a'.repeat(32),port:54321}
 const binding={pid:69392,procStart:'appkit:1793179778.392114',cwd:nativeCwd,transcriptPath}
 const save=async(path,value)=>{await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,typeof value==='string'?value:JSON.stringify(value),{mode:0o600})}
 await save(endpointFile,endpoint);await save(tokenFile,'b'.repeat(64));await save(bindingFile,binding)
 await mkdir(join(root,'data'))
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(join(root,'data/agents.db'))
 db.exec('CREATE TABLE sub_chats (id TEXT, session_id TEXT)');db.prepare('INSERT INTO sub_chats VALUES (?,?)').run('desktop-one',sessionId)
 t.after(()=>db.close())
 const calls=[],state={procStart:binding.procStart,mismatch:false,fail:false}
 const deps={platform:'darwin',home,inspectProcess:async(pid,options)=>{assert.equal(pid,binding.pid);assert.equal(options.platform,'darwin');return {supported:true,procStart:state.procStart}},
  createInspector:()=>{throw Error('Mac must not start PowerShell')},
  fetchRequest:async(url,options)=>{
   assert.equal(url,'http://127.0.0.1:54321/v1/control');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+'b'.repeat(64))
   const request=JSON.parse(options.body);calls.push(request)
   const {method,params}=request
   if(method==='task.submit'&&state.fail)throw Error('lost response')
   const data=method==='desktop.status'?{protocol:'qwenwork.desktop.v1',authenticated:true,features:{task_execution:true}}:method==='session.get'?{session:{session_id:'desktop-one',workspace:nativeCwd},task:null}:{task_id:params.request_id,session_id:params.session_id,status:'starting'}
   return new Response(JSON.stringify({schema_version:'qwenwork.response.v1',ok:true,data}),{headers:{'x-qwenwork-instance':state.mismatch?'foreign':endpoint.instance_id}})
  }}
 return {home,root,sessionId,endpointFile,tokenFile,bindingFile,binding,endpoint,save,db,calls,state,open:()=>createQwenWorkDesktopInput({sessionId,nativeCwd,transcriptPath},deps)}
}

test('Mac desktop input uses private host files and exact read-only native subchat mapping',{skip:process.platform==='win32'},async t=>{
 const f=await macDesktopFixture(t),c=await f.open()
 assert.equal((await c.send('保存后的中文输入')).status,'user_input_accepted')
 const submitted=f.calls.filter(c=>c.method==='task.submit')
 assert.equal(submitted.length,1);assert.equal(submitted[0].params.session_id,'desktop-one')
 assert.equal(submitted[0].params.prompt,'保存后的中文输入');c.close()
 assert.equal(qwenWorkUserDataRoot({platform:'win32',environment:{APPDATA:'C:\\Users\\test\\AppData\\Roaming'}}),'C:\\Users\\test\\AppData\\Roaming\\QwenWorkCN')
 assert.throws(()=>qwenWorkUserDataRoot({platform:'linux'}),/native Windows or macOS/i)
})

test('Mac input rejects duplicate mapping and changed process, binding, endpoint or credential',{skip:process.platform==='win32'},async t=>{
 const f=await macDesktopFixture(t),c=await f.open()
 f.db.prepare('INSERT INTO sub_chats VALUES (?,?)').run('desktop-two',f.sessionId)
 await assert.rejects(c.send('once'),/Unique/);f.db.exec("DELETE FROM sub_chats WHERE id='desktop-two'")
 f.state.procStart='appkit:1793179778.999999';await assert.rejects(c.send('once'),/identity changed/);f.state.procStart=f.binding.procStart
 await f.save(f.bindingFile,{...f.binding,transcriptPath:'/foreign'});await assert.rejects(c.send('once'),/identity changed/);await f.save(f.bindingFile,f.binding)
 await f.save(f.endpointFile,{...f.endpoint,port:54322});await assert.rejects(c.send('once'),/instance changed/);await f.save(f.endpointFile,f.endpoint)
 await f.save(f.tokenFile,'c'.repeat(64));await assert.rejects(c.send('once'),/instance changed/);await f.save(f.tokenFile,'b'.repeat(64))
 f.state.mismatch=true;await assert.rejects(c.send('once'),/response instance mismatch/);f.state.mismatch=false
 assert.equal(f.calls.filter(c=>c.method==='task.submit').length,0)
 f.state.fail=true;await assert.rejects(c.send('once'),/提交未确认/)
 assert.equal(f.calls.filter(c=>c.method==='task.submit').length,1,'unknown delivery is never replayed')
 c.close()
})

test('shared private reads reject public, symlink, oversized and non-file inputs',{skip:process.platform==='win32'},async t=>{
 const f=await macDesktopFixture(t)
 assert.equal(await readNativePrivateFile(f.tokenFile),'b'.repeat(64))
 await chmod(f.tokenFile,0o644);await assert.rejects(f.open(),/private notification/);await chmod(f.tokenFile,0o600)
 const link=join(f.home,'link');await symlink(f.tokenFile,link);await assert.rejects(readNativePrivateFile(link),{code:'ELOOP'})
 const large=join(f.home,'large');await f.save(large,'x'.repeat(262145));await assert.rejects(readNativePrivateFile(large),/private notification/)
 await assert.rejects(readNativePrivateFile(f.home),/private notification/)
})

test('default-disabled Mac endpoint is explicit and never creates host configuration',{skip:process.platform==='win32'},async t=>{
 const f=await macDesktopFixture(t),before=await readFile(f.tokenFile,'utf8')
 await rm(f.endpointFile)
 await assert.rejects(f.open(),/endpoint is unavailable.*--qwenwork-events-only/)
 assert.equal(await readFile(f.tokenFile,'utf8'),before);assert.equal(f.calls.length,0)
})

test('notification lifetime follows confirmed delivery, not the host brand',()=>{
 for(const status of ['user_input_accepted','queued'])assert.equal(notificationAutoDismiss({accepted:true,status}),true)
 for(const status of ['submitted_unverified','queued_for_resume','hook_received','busy','unknown',undefined])assert.equal(notificationAutoDismiss({accepted:true,status}),false)
 assert.equal(notificationAutoDismiss({accepted:false,status:'user_input_accepted'}),false)
})
function fixture() {
 const calls=[]; const state={binding:'desktop-one',busy:false,fail:false,workspace:'C:\\test'}
 const request=async(method,p)=>{ calls.push({method,p});
  if(method==='desktop.status')return {protocol:'qwenwork.desktop.v1',authenticated:true,features:{task_execution:true}}
  if(method==='session.get')return {session:{session_id:state.binding,workspace:state.workspace},task:state.busy?{terminal:false}:null}
  if(state.fail)throw Error('lost response')
  return {task_id:p.request_id,session_id:p.session_id,status:'starting'}
 }
 return {state,calls,open:()=>createDesktopInputConnection({sessionId:'native-one',nativeCwd:'C:\\test',request,verifyBinding:async()=>state.binding})}
}
test('submits one real user-input request to exact mapped desktop session',async()=>{
 const f=fixture(),c=await f.open(),r=await c.send('hello');
 assert.equal(r.status,'user_input_accepted'); const submits=f.calls.filter(x=>x.method==='task.submit');assert.equal(submits.length,1);assert.equal(submits[0].p.session_id,'desktop-one');assert.equal(submits[0].p.prompt,'hello');assert.equal(c.threadId,'native-one');assert.match(requireNotificationAccepted(r,'QwenWork'),/已接收用户消息/)
})
test('busy or changed binding does not submit, uncertain delivery does not retry',async()=>{
 const f=fixture(),c=await f.open();f.state.busy=true;assert.equal((await c.send('hello')).status,'busy');assert.equal(f.calls.filter(x=>x.method==='task.submit').length,0)
 f.state.busy=false;f.state.fail=true;await assert.rejects(c.send('hello'),/提交未确认/);assert.equal(f.calls.filter(x=>x.method==='task.submit').length,1)
 f.state.binding='another';await assert.rejects(c.send('hello'),/binding changed/);assert.equal(f.calls.filter(x=>x.method==='task.submit').length,1)
})
test('wrong workspace and oversized input fail before submit',async()=>{
 const f=fixture();f.state.workspace='C:\\other';await assert.rejects(f.open(),/mismatch/)
 const g=fixture(),c=await g.open();await assert.rejects(c.send('x'.repeat(64001)),/64000/);assert.equal(g.calls.filter(x=>x.method==='task.submit').length,0)
})

test('normal QwenWork entry uses verified user input; background events stay separate', async () => {
 const f=fixture(), calls=[], binding={sessionId:'native-one',nativeCwd:'C:\\test',transcriptPath:'C:\\test\\main.jsonl'}
 let closed=0
 const c=await createQwenWorkPanelConnection(binding,{
  desktop:async input=>{assert.deepEqual(input,binding);calls.push('desktop');return {...await f.open(),close:()=>closed++}},
  hooks:async input=>{assert.deepEqual(input,{...binding,timeoutMs:30000});calls.push('hooks');return {send:async text=>({accepted:true,status:'hook_received',text})}},
 })
 assert.equal(c.inputMode,'desktop');assert.deepEqual(calls,['desktop'])
 assert.equal((await c.send('user message')).status,'user_input_accepted')
 assert.deepEqual(calls,['desktop'],'A user message never selects Hooks')
 assert.equal((await c.sendEvent('background event')).status,'hook_received')
 assert.deepEqual(calls,['desktop','hooks'])
 assert.equal(f.calls.filter(x=>x.method==='task.submit').length,1,'Background events never submit user input')
 c.close();assert.equal(closed,1)
})

test('desktop startup failure and uncertain delivery never fall back or replay',async()=>{
 let hooks=0, desktop=0
 const unavailable={desktop:async()=>{desktop++;throw Error('endpoint unavailable')},hooks:async()=>{hooks++;throw Error('must not run')}}
 await assert.rejects(createQwenWorkPanelConnection({},unavailable),/不会自动改用 Hook.*endpoint unavailable/)
 assert.equal(desktop,1);assert.equal(hooks,0)
 const f=fixture()
 const c=await createQwenWorkPanelConnection({},{desktop:f.open,hooks:unavailable.hooks})
 f.state.fail=true
 await assert.rejects(c.send('once'),/提交未确认/)
 assert.equal(f.calls.filter(x=>x.method==='task.submit').length,1);assert.equal(hooks,0)
})

test('limited events require an explicit mode, and old desktop flags remain compatible',async()=>{
 assert.equal(resolveQwenWorkInputMode({host:'qwenwork'}),'desktop')
 assert.equal(resolveQwenWorkInputMode({host:'qwenwork',qwenworkDesktop:true}),'desktop')
 assert.equal(resolveQwenWorkInputMode({host:'qwenwork',qwenworkEventsOnly:true}),'events-only')
 for(const host of ['codex','claude-code','qoder','workbuddy']){
  assert.equal(resolveQwenWorkInputMode({host}),undefined)
  assert.throws(()=>resolveQwenWorkInputMode({host,qwenworkEventsOnly:true}),/QwenWork-only/)
 }
 assert.throws(()=>resolveQwenWorkInputMode({host:'qwenwork',qwenworkDesktop:false}),/explicit/)
 assert.throws(()=>resolveQwenWorkInputMode({host:'qwenwork',qwenworkDesktop:true,qwenworkEventsOnly:true}),/not both/)
 assert.throws(()=>resolveQwenWorkInputMode({host:'qwenwork',qwenworkEventsOnly:'false'}),/boolean/)
 let hooks=0
 const c=await createQwenWorkPanelConnection({qwenworkEventsOnly:true},{
  desktop:async()=>{throw Error('must not start desktop')},
  hooks:async()=>{hooks++;return {send:async()=>({accepted:true,status:'hook_received'})}},
 })
 assert.equal(c.inputMode,'events-only');assert.equal(hooks,1)
 assert.equal((await c.send('explicit event')).status,'hook_received')
 assert.match(requireNotificationAccepted(await c.send('explicit event'),'QwenWork'),/尚未作为用户消息提交/)
})
