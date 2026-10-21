import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopInputConnection, createQwenWorkPanelConnection, resolveQwenWorkInputMode } from '../src/qwenwork-desktop-input.mjs'
import { requireNotificationAccepted, notificationAutoDismiss } from '../src/notification-result.mjs'

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
