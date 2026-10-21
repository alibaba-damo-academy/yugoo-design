import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {runInNewContext} from 'node:vm'
import {readFile,writeFile,appendFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createWorkBuddyConnection} from '../src/workbuddy-connection.mjs'
import {createRelayQueue} from '../src/workbuddy-mcp-relay.mjs'
import {createWorkBuddyPanelMcp} from '../src/workbuddy-panel-mcp.mjs'
import {fixture,threadId} from './fixture.mjs'
import {startCompanion} from '../src/server.mjs'
import {callCompanion} from '../src/connection-file.mjs'
import {createDesignMcp} from '../src/mcp.mjs'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {relayWidget} from '../src/workbuddy-relay-probe.mjs'
import {startWorkBuddyPanel} from '../src/workbuddy-panel-service.mjs'
import {mkdtemp,mkdir,rm,symlink,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'

function widgetElements(button,status) {
 const copy={disabled:true,hidden:true},guide={hidden:true},manual={hidden:true},address={value:'',focus(){},select(){}}
 const primary={appendChild(el){el.parentNode=this}},secondary={appendChild(el){el.parentNode=this}},options={hidden:true,open:false};primary.appendChild(button)
 const elements={'primary-actions':primary,'secondary-actions':secondary,'open-options':options,'connect':button,'status':status,'description':{},'copy-design-url':copy,'design-browser-guide':guide,'manual-copy':manual,'design-url':address}
 return {primary,secondary,options,copy,guide,manual,address,document:{getElementById:id=>elements[id]}}
}

async function manualWidget(clipboard){
 const listeners={},requests=[],calls=[],button={disabled:true},status={}
 const elements=widgetElements(button,status)
 const deliver=(data,source=parent)=>listeners.message({source,origin:'https://native.example',data:{jsonrpc:'2.0',...data}})
 const parent={postMessage(message){requests.push(message);if(message.id)queueMicrotask(()=>deliver({id:message.id,result:{hostCapabilities:{message:{},openLinks:{}}}}))}}
 runInNewContext(relayWidget({dynamic:true,origin:'',widgetToken:'',url:''}).match(/<script>([\s\S]*)<\/script>/)[1],{
  document:elements.document,window:{addEventListener:(event,fn)=>{listeners[event]=fn}},parent,URL,crypto:{randomUUID},AbortSignal,navigator:{clipboard},
  setTimeout:()=>1,clearTimeout:()=>{},fetch:async(_url,options)=>{calls.push(JSON.parse(options.body));return{ok:true,json:async()=>({})}},
 })
 await new Promise(resolve=>setImmediate(resolve))
 const cfg={origin:'http://127.0.0.1:31001',widgetToken:'a'.repeat(64),url:'http://127.0.0.1:31002/#'+'b'.repeat(64),view:'design',projectId:'original',threadId}
 const metadata=value=>deliver({method:'ui/notifications/tool-result',params:{_meta:{workbuddyPanel:value}}})
 metadata(cfg)
 return {listeners,requests,calls,button,status,elements,cfg,metadata}
}

const drainWidget=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve))}
const bridgeResponse=value=>({ok:true,json:async()=>value??{}})
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}

async function controlledWidget({fetchBridge=()=>bridgeResponse(),heldMethods=[],view='design',autoConnect=false}={}){
 const listeners={},requests=[],calls=[],scheduled=new Map(),button={disabled:true},status={}
 const elements=widgetElements(button,status);let timer=0
 const deliver=(data,source=parent)=>listeners.message({source,origin:'https://native.example',data:{jsonrpc:'2.0',...data}})
 const reply=(message,result={})=>deliver({id:message.id,result})
 const parent={postMessage(message){requests.push(message);if(message.id&&!heldMethods.includes(message.method))queueMicrotask(()=>reply(message,message.method==='ui/initialize'?{hostCapabilities:{message:{},openLinks:{}}}:{}))}}
 runInNewContext(relayWidget({dynamic:true,autoConnect,origin:'',widgetToken:'',url:''}).match(/<script>([\s\S]*)<\/script>/)[1],{
  document:elements.document,window:{addEventListener:(event,fn)=>{listeners[event]=fn}},parent,URL,crypto:{randomUUID},AbortSignal,navigator:{},
  setTimeout:(fn,ms)=>{scheduled.set(++timer,{fn,ms});return timer},clearTimeout:key=>scheduled.delete(key),
  fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return fetchBridge(body,calls.length-1)},
 })
 await drainWidget()
 const cfg={origin:'http://127.0.0.1:31001',widgetToken:'a'.repeat(64),url:'http://127.0.0.1:31002/#'+'b'.repeat(64),view,projectId:'original',threadId,connectionPath:'/state/old.json',reopenArgs:{projectRoot:'/original',sessionId:threadId,nativeCwd:'/native',transcriptPath:'/native/transcript.jsonl',view}}
 const metadata=value=>deliver({method:'ui/notifications/tool-result',params:{_meta:{workbuddyPanel:value}}})
 metadata(cfg)
 return{listeners,requests,calls,scheduled,button,status,elements,cfg,metadata,reply}
}

test('pending connect cannot revive a disposed or replaced connection on success or failure',async()=>{
 for(const outcome of ['resolve','reject'])for(const change of ['pagehide','same-origin-replacement']){
  const pulse=deferred(),f=await controlledWidget({fetchBridge:()=>pulse.promise})
  const clicked=f.button.onclick();await drainWidget();assert.equal(f.calls.length,1)
  await f.button.onclick();assert.equal(f.calls.length,1,'a pending click cannot create another handshake')
  if(change==='pagehide')f.listeners.pagehide()
  else f.metadata({...f.cfg,widgetToken:'c'.repeat(64),connectionPath:'/state/new.json'})
  const feedback=f.status.textContent,requests=f.requests.length
  if(outcome==='resolve')pulse.resolve(bridgeResponse());else pulse.reject(TypeError('offline'))
  await clicked;await drainWidget()
  assert.equal(f.calls.length,1,'late handshake cannot pulse or claim a queued message')
  assert.equal(f.requests.length,requests,'late handshake cannot open or message the host')
  assert.equal(f.status.textContent,feedback,'late success/error cannot replace current feedback')
  assert.equal(f.button.disabled,true);assert.equal(f.elements.copy.disabled,true)
  assert.equal([...f.scheduled.values()].filter(value=>value.ms===1000).length,0)
 }
})

test('poll continuations stop at each bridge boundary after disposal or connection replacement',async()=>{
 // Pulse now runs independently: hold that heartbeat while delivery proceeds,
 // then verify its late success/failure cannot revive an invalidated lifetime.
 for(const stage of ['pulse','take','result'])for(const change of ['pagehide','replacement'])for(const outcome of ['resolve','reject']){
  const delayed=deferred(),f=await controlledWidget({fetchBridge:(body,index)=>{
   if((stage==='pulse'&&index===1)||(stage==='take'&&body.action==='take')||(stage==='result'&&body.action==='result'))return delayed.promise
   return bridgeResponse(body.action==='take'?{message:{id:'saved-notice',text:'saved design notice'}}:{})
  }})
  await f.button.onclick();await drainWidget()
  assert.equal((stage==='pulse'?f.calls[1]:f.calls.at(-1)).body.action,stage)
  if(change==='pagehide')f.listeners.pagehide();else f.metadata({...f.cfg,origin:'http://127.0.0.1:31003'})
  const calls=f.calls.length,requests=f.requests.length,feedback=f.status.textContent
  if(outcome==='resolve')delayed.resolve(bridgeResponse(stage==='take'?{message:{id:'saved-notice',text:'must not forward'}}:{}));else delayed.reject(TypeError('offline'))
  await drainWidget()
  assert.equal(f.calls.length,calls,'no new bridge request after invalidation')
  assert.equal(f.requests.length,requests,'no new host request after invalidation')
  assert.equal(f.status.textContent,feedback);assert.equal(f.button.disabled,true)
  assert.equal([...f.scheduled.values()].filter(value=>value.ms===1000).length,0)
 }
})

test('late host receipts cannot restore controls, acknowledge delivery or restart polling',async()=>{
 for(const method of ['ui/initialize','ui/open-link','ui/message','recovery'])for(const result of [{},{isError:true}]){
  const heldMethod=method==='recovery'?'ui/message':method
  const f=await controlledWidget({view:method==='ui/open-link'?'full':'design',heldMethods:[heldMethod],fetchBridge:body=>{
   if(method==='recovery')throw TypeError('offline')
   return bridgeResponse(method==='ui/message'&&body.action==='take'?{message:{id:'saved-notice',text:'saved design notice'}}:{})
  }})
  let clicked
  if(method==='recovery'){await f.button.onclick();clicked=f.button.onclick()}
  else if(method!=='ui/initialize')clicked=f.button.onclick()
  await drainWidget();const held=f.requests.find(value=>value.method===heldMethod);assert.ok(held)
  f.listeners.pagehide();const calls=f.calls.length,requests=f.requests.length,feedback=f.status.textContent
  f.reply(held,method==='ui/initialize'?{hostCapabilities:{message:{},openLinks:{}}}:result)
  await clicked;await drainWidget()
  for(const entry of [...f.scheduled.values()].filter(value=>value.ms===1000))await entry.fn()
  await drainWidget()
  assert.equal(f.calls.length,calls,'in-flight host message is not acknowledged or resent after disposal')
  assert.equal(f.requests.length,requests,'disposed initialize cannot advertise readiness')
  assert.equal(f.status.textContent,feedback);assert.equal(f.button.disabled,true);assert.equal(f.elements.copy.disabled,true)
 }
})

test('an old polling callback stays retired after an explicit reconnect',async()=>{
 let offline=false
 const f=await controlledWidget({fetchBridge:()=>offline?{ok:true,json:async()=>{throw SyntaxError('invalid response')}}:bridgeResponse()})
 await f.button.onclick();await drainWidget()
 const oldPoll=[...f.scheduled.values()].find(value=>value.ms===1000).fn
 offline=true;await oldPoll();await drainWidget();assert.match(f.status.textContent,/连接已停止/)
 // A response failure allows an explicit handshake, not automatic retries.
 offline=false
 await f.button.onclick();await drainWidget()
 const calls=f.calls.length,requests=f.requests.length,feedback=f.status.textContent
 await oldPoll();await drainWidget()
 assert.equal(f.calls.length,calls,'the old generation cannot join the new polling loop')
 assert.equal(f.requests.length,requests);assert.equal(f.status.textContent,feedback)
 assert.equal(f.button.disabled,true,'connected design view has no redundant connect action')
})

test('expired widget requests same-project recovery through one explicit user message, never stale tool calls',async()=>{
 for(const outcome of ['success','denied','timeout','object-error','stringified-error']){
  const listeners={},requests=[],calls=[],timers=new Map(),button={disabled:true},status={};let timer=0
  const args={projectRoot:'/original',sessionId:threadId,nativeCwd:'/native',transcriptPath:'/native/transcript.jsonl'}
  const first={origin:'http://127.0.0.1:31001',widgetToken:'a'.repeat(64),url:'http://127.0.0.1:31002/#'+'b'.repeat(64),projectId:'original',threadId,reopenArgs:args,connectionPath:'/state/old.json'}
  const deliver=data=>listeners.message({source:parent,origin:'https://native.example',data:{jsonrpc:'2.0',...data}})
  const parent={postMessage(message){requests.push(message);if(!message.id)return;
   if(message.method==='ui/message'&&outcome==='timeout')return;
   if(message.method==='ui/message'&&['object-error','stringified-error'].includes(outcome)){
    queueMicrotask(()=>deliver({id:message.id,error:{code:-32603,message:outcome==='object-error'?{detail:'opaque'}:'[object Object]'}}));return;
   }
   const result=message.method==='ui/initialize'?{hostCapabilities:{message:{},openLinks:{}}}:message.method==='ui/message'&&outcome==='denied'?{isError:true}:{};
   queueMicrotask(()=>deliver({id:message.id,result}));
  }}
  runInNewContext(relayWidget({dynamic:true,origin:'',widgetToken:'',url:''}).match(/<script>([\s\S]*)<\/script>/)[1],{
   document:widgetElements(button,status).document,window:{addEventListener:(event,fn)=>{listeners[event]=fn}},parent,URL,crypto:{randomUUID},AbortSignal,
   setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer},clearTimeout:id=>timers.delete(id),
   fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});throw TypeError('Failed to fetch')},
  })
  const drain=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))}
  await drain();deliver({method:'ui/notifications/tool-result',params:{_meta:{workbuddyPanel:first}}})
  await button.onclick();await drain()
  assert.equal(requests.filter(x=>x.method==='ui/message').length,0,'network failure alone grants no send')
  assert.equal(button.textContent,'恢复设计面板')
  const clicked=button.onclick();await drain()
  if(outcome==='timeout'){const deadline=[...timers.values()].find(x=>x.ms===10000);assert.ok(deadline);deadline.fn()}
  await clicked;await drain()
  const messages=requests.filter(x=>x.method==='ui/message');assert.equal(messages.length,1)
  assert.equal(messages[0].params.role,'user')
  const prompt=messages[0].params.content[0].text
  assert.ok(prompt.includes(JSON.stringify(args)),'only exact original project/session inputs')
  assert.ok(!prompt.includes(first.widgetToken));assert.match(prompt,/不要新建项目、运行 Bundle/)
  assert.equal(requests.filter(x=>['tools/call','ui/open-link','ui/update-model-context'].includes(x.method)).length,0)
  assert.equal(calls.length,1,'recovery never contacts old or guessed new services')
  if(outcome==='denied'){
   assert.equal(button.disabled,false);assert.match(status.textContent,/拒绝/)
  }else{
   assert.equal(button.disabled,true)
   if(outcome==='success')assert.match(status.textContent,/尚未确认新面板启动/)
   if(outcome.endsWith('error')){assert.match(status.textContent,/WB_HOST_RPC_FAILED/);assert.ok(!status.textContent.includes('[object Object]'))}
   await button.onclick();assert.equal(requests.filter(x=>x.method==='ui/message').length,1,'no repeat after accepted or unknown delivery')
  }
 }
})

test('bridge failures explain recovery without opening a page, sending or retrying a message',async()=>{
 for(const kind of ['network','timeout','policy','unrelated-policy','invalid-response','rejected']){
  const listeners={},requests=[],calls=[],button={disabled:true},status={}
  const parent={postMessage(message){requests.push(message);if(message.id)queueMicrotask(()=>listeners.message({source:parent,origin:'https://native.example',data:{jsonrpc:'2.0',id:message.id,result:{hostCapabilities:{message:{},openLinks:{}}}}}))}}
  runInNewContext(relayWidget({origin:'http://127.0.0.1:31001',widgetToken:'a'.repeat(64),url:'http://127.0.0.1:31002/'}).match(/<script>([\s\S]*)<\/script>/)[1],{
   document:widgetElements(button,status).document,window:{addEventListener:(event,fn)=>{listeners[event]=fn}},parent,URL,crypto:{randomUUID},AbortSignal,
   setTimeout:()=>1,clearTimeout:()=>{},
   fetch:async(_url,options)=>{
    calls.push(JSON.parse(options.body))
    if(kind==='invalid-response')return {ok:true,json:async()=>{throw SyntaxError('bad JSON')}}
    if(kind==='rejected')return {ok:false,status:403,json:async()=>({error:'Original widget is not ready.'})}
    if(kind.includes('policy'))listeners.securitypolicyviolation({effectiveDirective:'connect-src',blockedURI:kind==='policy'?'http://127.0.0.1:31001/bridge':'https://unrelated.example'})
    const error=TypeError('Failed to fetch');if(kind==='timeout')error.name='TimeoutError';throw error
   },
  })
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,0)
  await button.onclick()
  const expected=kind==='policy'?'WB_BRIDGE_POLICY':kind==='timeout'?'WB_BRIDGE_TIMEOUT':kind==='invalid-response'?'WB_BRIDGE_RESPONSE':kind==='rejected'?'Original widget is not ready.':'WB_BRIDGE_NETWORK'
  assert.ok(status.textContent.includes(expected),status.textContent)
  assert.equal(button.disabled,false)
  assert.equal(calls.length,1,'failed handshake does not retry automatically')
  assert.equal(requests.filter(x=>['ui/open-link','ui/message'].includes(x.method)).length,0)
  await button.onclick()
  assert.equal(calls.length,2,'only a new click retries the handshake')
  assert.equal(calls[0].clientId,calls[1].clientId,'explicit reconnect preserves owner identity')
  assert.ok(calls.every(x=>x.action==='pulse'),'recovery must not claim or replay a message')
 }
})

test('enabled widget delivers offscreen, stops on disposal and permits explicit reconnect after failure',async()=>{
 const listeners={},scheduled=new Map(),requests=[],calls=[],button={disabled:true},status={}
 let timer=0,offline=false,nextMessage={id:randomUUID(),text:'saved design notice'}
 const reply=message=>listeners.message({source:parent,origin:'https://native.example',data:{jsonrpc:'2.0',id:message.id,
  result:message.method==='ui/initialize'?{hostCapabilities:{message:{},openLinks:{}}}:{}}})
 const parent={postMessage(message){requests.push(message);if(message.id)queueMicrotask(()=>reply(message))}}
 const drain=async()=>{for(let n=0;n<12;n++)await new Promise(resolve=>setImmediate(resolve))}
 runInNewContext(relayWidget({origin:'http://127.0.0.1:31001',widgetToken:'a'.repeat(64),url:'http://127.0.0.1:31002/'}).match(/<script>([\s\S]*)<\/script>/)[1],{
  document:{hidden:true,body:{},getElementById:id=>id==='connect'?button:status},
  IntersectionObserver:class{constructor(fn){this.fn=fn}observe(){this.fn([{isIntersecting:false}])}},
  window:{addEventListener:(event,fn)=>{listeners[event]=fn}},parent,URL,crypto:{randomUUID},AbortSignal,
  setTimeout:(fn,ms)=>{const id=++timer;scheduled.set(id,{fn,ms});return id},clearTimeout:id=>scheduled.delete(id),
  fetch:async(_url,options)=>{if(offline)throw Error('network offline');const body=JSON.parse(options.body);calls.push(body);
   const response=body.action==='take'?{message:nextMessage}:{};if(body.action==='take')nextMessage=null;
   return{ok:true,json:async()=>response}},
 })
 await drain();assert.equal(calls.length,0)
 await button.onclick();await drain()
 assert.ok(calls.some(call=>call.action==='pulse'&&call.visible===true))
 assert.equal(requests.filter(call=>call.method==='ui/message').length,1)
 assert.equal(calls.find(call=>call.action==='result').status,'submitted_unverified')
 const tick=async()=>{const entry=[...scheduled].find(([,value])=>value.ms===1000);assert.ok(entry);scheduled.delete(entry[0]);await entry[1].fn();await drain()}
 offline=true;await tick();assert.equal(button.disabled,false);assert.match(status.textContent,/连接已停止/)
 offline=false;await button.onclick();await drain()
 assert.equal(requests.filter(call=>call.method==='ui/message').length,1,'reconnect must not replay the submitted message')
 listeners.pagehide();const before=calls.length;await drain();assert.equal(calls.length,before)
 assert.equal([...scheduled.values()].filter(value=>value.ms===1000).length,0,'disposal clears both owned timers')
})

test('WorkBuddy sender waits for original widget receipt and rejects an offline owner',async()=>{
 const queue=createRelayQueue(), connection=createWorkBuddyConnection({threadId,queue}), owner=randomUUID()
 await assert.rejects(connection.send('first'),/连接不可用/)
 queue.pulse(owner,true)
 const pending=connection.send('real user request'), message=queue.take(owner).message
 assert.equal(message.text,'real user request')
 queue.settle(owner,message.id,'submitted_unverified')
 assert.equal((await pending).status,'submitted_unverified')
 const uncertain=connection.send('second'), next=queue.take(owner).message
 queue.settle(owner,next.id,'delivery_unknown');assert.equal((await uncertain).accepted,false)
 await assert.rejects(connection.send('do not replay'),/不会自动重发/)
})

test('shared server retains main/save semantics while rejecting unverified native execution',async()=>{
 const f=await fixture({smartQuestionsMode:'main'}); let server,client,mcp
 try {
  const queue=createRelayQueue(),owner=randomUUID(),connection=createWorkBuddyConnection({threadId,queue})
  const transcriptPath=join(f.root,'workbuddy.jsonl')
  const nativeEvent=(id,text)=>JSON.stringify({type:'message',id,role:'user',sessionId:threadId,cwd:f.options.projectRoot,timestamp:Date.now(),content:[{type:'input_text',text}]})+'\n'
  await writeFile(transcriptPath,nativeEvent('earlier','unrelated earlier text'))
  const options={...f.options,host:'workbuddy',threadId,connection,transcriptPath}
  await assert.rejects(startCompanion({...options,threadId:randomUUID()}),/exact MCP App/)
  server=await startCompanion(options)
  const call=(method,params={})=>callCompanion(server.connectionPath,{method,params})
  assert.equal((await call('info')).host,'workbuddy')
  await appendFile(transcriptPath,nativeEvent('current','current design request'))
  const history=(await call('readWorkspace')).conversation
  assert.equal(history.available,true)
  assert.equal(history.source,'workbuddy-native-transcript')
  assert.deepEqual(history.rows.filter(row=>row.role==='user').map(row=>row.text),['current design request'])
  mcp=createDesignMcp();client=new Client({name:'catalog-test',version:'1.0.0'})
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair()
  await Promise.all([mcp.connect(serverTransport),client.connect(clientTransport)])
  const discovered=(await client.listTools()).tools.find(tool=>tool.name==='design_list_bundles')
  assert.equal(discovered.annotations.readOnlyHint,true)
  const catalogResult=await client.callTool({name:'design_list_bundles',arguments:{connection:server.connectionPath}})
  assert.notEqual(catalogResult.isError,true)
  const catalog=JSON.parse(catalogResult.content[0].text)
  assert.equal(catalog.mindset,'web_app')
  assert.equal(catalog.mindsetMethod,join(f.options.kitRoot,'mindset.md'))
  assert.ok((await readFile(catalog.mindsetMethod,'utf8')).length>0)
  const questions=catalog.skills.find(item=>item.id==='smart_questions')
  assert.equal(questions.execution.mode,'main')
  assert.equal(catalog.skills.find(item=>item.id==='page_design').execution.mode,'subagent')
  assert.equal((await call('prepareBundle',{skill:questions.id})).execution.mode,'main')
  for(const skill of ['web_app','requirements','intake','question_workspace']) {
   const result=await client.callTool({name:'design_prepare_bundle',arguments:{connection:server.connectionPath,skill}})
   assert.equal(result.isError,true)
   assert.match(result.content[0].text,/Unknown Bundle/)
   assert.doesNotMatch(result.content[0].text,/requires an isolated native Producer/)
  }
  assert.deepEqual((await call('readWorkspace')).activeMainBundles,[])
  await assert.rejects(call('prepareBundle',{skill:'page_design'}),/isolated native Producer/)
  for(const method of ['registerNativeRun','prepareReviews','bindReviewRun','recheckReviews'])await assert.rejects(call(method),/not supported/)
  const invocation=await call('beginMainBundle',{skill:'smart_questions'})
  const saved=await call('savePanel',{skill:'smart_questions',state:{questions:{}},eventId:randomUUID()})
  assert.ok(saved.commit)
  assert.equal((await call('finishMainBundle',{invocationId:invocation.invocationId,scope:'state',outcome:'pause'})).accepted,true)
  await assert.rejects(call('sendPrompt',{text:'Please inspect the saved answers'}),/连接不可用/)
  assert.deepEqual(JSON.parse(await readFile(join(server.project.project.designFilesRoot,'smart_questions/smart_questions.json'),'utf8')),{questions:{}})
  queue.pulse(owner,true)
  const delivery=call('sendPrompt',{text:'Please inspect the saved answers'})
  let message
  for(let n=0;n<40&&!message;n++){await new Promise(r=>setTimeout(r,20));message=queue.take(owner).message}
  assert.ok(message);assert.match(message.text,/Exact Companion connection file/);assert.ok(message.text.includes(server.connectionPath))
  assert.doesNotMatch(message.text,/Follow the native-execution reference for due background reviews/)
  queue.settle(owner,message.id,'submitted_unverified');assert.equal((await delivery).accepted,true)
  const workspace=await call('readWorkspace');assert.equal(workspace.hostCapabilities.nativeSubagents,false);assert.deepEqual(workspace.reviews,[])
 }finally{await client?.close();await mcp?.close();await server?.close();await f.close()}
})

test('panel MCP hands the exact design URL to native navigation while keeping relay authority host-only',async()=>{
 let input
 const descriptor={origin:'http://127.0.0.1:31001',widgetToken:'a'.repeat(64),url:'http://127.0.0.1:31002/#'+'b'.repeat(64),connectionPath:'/state/exact.json',threadId,projectId:'project-one',projectName:'Example'}
 const mcp=createWorkBuddyPanelMcp({runtimeRoot:'/runtime',stateRoot:'/state',start:async value=>(input=value,{...descriptor})})
 const result=await mcp.handle({id:1,method:'tools/call',params:{name:'yugoo_workbuddy_open_panel',arguments:{projectRoot:'/project',sessionId:threadId,nativeCwd:'/native',transcriptPath:'/native/transcript.jsonl'}}})
 assert.equal(input.threadId,threadId);assert.equal(input.projectRoot,'/project')
 assert.ok(!JSON.stringify(result.result.content).includes(descriptor.widgetToken));assert.ok(!JSON.stringify(result.result.content).includes('b'.repeat(64)));assert.deepEqual(result.result._meta.workbuddyPanel,{...descriptor,view:'full',reopenArgs:{projectRoot:'/project',sessionId:threadId,nativeCwd:'/native',transcriptPath:'/native/transcript.jsonl',view:'full'}})
 assert.equal((await mcp.handle({id:2,method:'tools/call',params:{name:'yugoo_workbuddy_open_panel',arguments:{}}})).result.isError,true)
 const args={projectRoot:'/project',sessionId:threadId,nativeCwd:'/native',transcriptPath:'/native/transcript.jsonl',view:'design'}
 const design=(await mcp.handle({id:4,method:'tools/call',params:{name:'yugoo_workbuddy_open_panel',arguments:args}})).result
 const page=new URL(design._meta.workbuddyPanel.url)
 assert.equal(page.search,'?view=panel-only');assert.equal(page.hash,new URL(descriptor.url).hash)
 assert.equal(Object.hasOwn(input,'view'),false,'layout cannot alter the service/native binding')
 const content=JSON.parse(design.content[0].text)
 assert.deepEqual(content.nativePreview,{tool:'present_files',arguments:{files:[page.href],cwd:'/native',explanation:'在 WorkBuddy 中打开当前项目的设计面板。'}})
 assert.equal(content.nativePreview.arguments.files.length,1)
 assert.match(content.instruction,/将 nativePreview.arguments 原样传给原生 present_files 调用一次/)
 assert.match(content.instruction,/不重启已成功的服务/)
 assert.equal(Object.hasOwn(input,'createNativePreview'),false)
 assert.equal(content.nativePreview.arguments.files[0],design._meta.workbuddyPanel.url,'native tool and widget use the same service and access grant')
 assert.ok(!JSON.stringify(design.content).includes(descriptor.widgetToken),'native navigation never receives the message bridge credential')
 assert.equal((await mcp.handle({id:5,method:'tools/call',params:{name:'yugoo_workbuddy_open_panel',arguments:{...args,view:'unknown'}}})).result.isError,true)

 const html=(await mcp.handle({id:3,method:'resources/read',params:{uri:result.result._meta.ui.resourceUri}})).result.contents[0].text
 let listener;const messages=[],button={disabled:true},status={};const parent={postMessage:message=>messages.push(message)}
 runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],{
  document:widgetElements(button,status).document,window:{addEventListener:(event,fn)=>{if(event==='message')listener=fn}},parent,
  URL,crypto:{randomUUID},setTimeout:()=>1,clearTimeout:()=>{},AbortSignal,
  fetch:async()=>bridgeResponse(),
 })
 const deliver=(data,source=parent)=>listener({source,origin:'https://host.example',data:{jsonrpc:'2.0',...data}})
 deliver({id:messages[0].id,result:{hostCapabilities:{message:{},openLinks:{}}}});await Promise.resolve();assert.equal(button.disabled,true)
 deliver({method:'ui/notifications/tool-result',params:result.result},{});assert.equal(button.disabled,true)
 deliver({method:'ui/notifications/tool-result',params:result.result});await drainWidget();assert.equal(button.disabled,false)
 assert.equal(messages.filter(x=>x.method==='ui/message').length,0)
})

test('native browser handoff rejects a noncanonical or foreign service URL',async()=>{
 const args={projectRoot:'/project',sessionId:threadId,nativeCwd:'/native',transcriptPath:'/native/transcript.jsonl',view:'design'}
 const hash='#'+'b'.repeat(64)
 for(const url of ['https://foreign.invalid/'+hash,'http://localhost:31002/'+hash,
  'http://127.0.0.1:31002/artifact.html'+hash,'http://127.0.0.1:31002/?view=studio'+hash,
  'http://user@127.0.0.1:31002/'+hash,'http://127.0.0.1:31002/','file:///private.html']){
  const mcp=createWorkBuddyPanelMcp({runtimeRoot:'/runtime',start:async()=>({url})})
  const result=(await mcp.handle({id:1,method:'tools/call',params:{name:'yugoo_workbuddy_open_panel',arguments:args}})).result
  assert.equal(result.isError,true)
  assert.equal(result._meta,undefined,'invalid links never reach the widget or native navigator')
  assert.match(result.content[0].text,/invalid local browser entry/)
 }
})

test('manual design widget enables the original relay without opening an artifact or second browser',async()=>{
 const listeners={},requests=[],calls=[],button={disabled:true},status={}
 const parent={postMessage(message){requests.push(message);if(message.id)queueMicrotask(()=>listeners.message({source:parent,origin:'https://native.example',data:{jsonrpc:'2.0',id:message.id,result:{hostCapabilities:{message:{},openLinks:{}}}}}))}}
 runInNewContext(relayWidget({dynamic:true,origin:'',widgetToken:'',url:''}).match(/<script>([\s\S]*)<\/script>/)[1],{
  document:widgetElements(button,status).document,window:{addEventListener:(event,fn)=>{listeners[event]=fn}},parent,URL,crypto:{randomUUID},AbortSignal,
  setTimeout:()=>1,clearTimeout:()=>{},fetch:async(_url,options)=>{calls.push(JSON.parse(options.body));return{ok:true,json:async()=>({})}},
 })
 const drain=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve))}
 await drain()
 listeners.message({source:parent,origin:'https://native.example',data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{_meta:{workbuddyPanel:{origin:'http://127.0.0.1:31001',widgetToken:'a'.repeat(64),url:'http://127.0.0.1:31002/?view=design#'+'b'.repeat(64),view:'design',projectId:'original',threadId,reopenArgs:{projectRoot:'/project',sessionId:threadId,nativeCwd:'/native',transcriptPath:'/native/transcript.jsonl',view:'design'}}}}}})
 assert.equal(button.textContent,'连接当前对话');assert.equal(calls.length,0,'metadata alone does not activate the relay')
 await button.onclick();await drain()
 assert.equal(button.disabled,true);assert.equal(button.textContent,'已连接当前对话')
 assert.equal(requests.filter(x=>x.method==='ui/open-link').length,0)
 assert.equal(requests.filter(x=>x.method==='ui/message').length,0)
 assert.equal(calls.filter(x=>x.action==='take').length,1)
 await button.onclick();await drain()
 assert.equal(calls.filter(x=>x.action==='take').length,1,'reconnecting an active view does not add a poll loop')
 assert.equal(relayWidget({dynamic:true,origin:'',widgetToken:'',url:''}).includes('<select'),false,'view is chosen by the entry, not a second widget control')
 listeners.pagehide()
})

test('private browser address copies only after a user click, with bounded manual fallback and no model RPC',async()=>{
 for(const clipboard of ['allowed','denied','missing']){
  const listeners={},requests=[],copies=[],button={disabled:true},status={}
  const elements=widgetElements(button,status);let focused=0,selected=0
  elements.address.focus=()=>focused++;elements.address.select=()=>selected++
  const parent={postMessage(message){requests.push(message);if(message.id)queueMicrotask(()=>listeners.message({source:parent,origin:'https://native.example',data:{jsonrpc:'2.0',id:message.id,result:{hostCapabilities:{message:{},openLinks:{}}}}}))}}
  const widget=relayWidget({dynamic:true,origin:'',widgetToken:'',url:''})
  runInNewContext(widget.match(/<script>([\s\S]*)<\/script>/)[1],{
   document:elements.document,window:{addEventListener:(event,fn)=>{listeners[event]=fn}},parent,URL,crypto:{randomUUID},AbortSignal,
   navigator:clipboard==='missing'?{}:{clipboard:{writeText:async text=>{if(clipboard==='denied')throw Error('permission denied');copies.push(text)}}},
   setTimeout:()=>1,clearTimeout:()=>{},fetch:()=>{throw Error('Copy must not contact any service')},
  })
  await new Promise(resolve=>setImmediate(resolve))
  const cfg={origin:'http://127.0.0.1:31001',widgetToken:'a'.repeat(64),url:'http://127.0.0.1:31002/#'+'b'.repeat(64),view:'design',projectId:'original',threadId}
  const deliver=(value,source=parent)=>listeners.message({source,origin:'https://native.example',data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{_meta:{workbuddyPanel:value}}}})
  deliver(cfg,{});assert.equal(elements.copy.disabled,true,'foreign window cannot provide a copy address')
  deliver({...cfg,url:'https://foreign.example/#'+'b'.repeat(64)});assert.equal(elements.copy.disabled,true)
  deliver({...cfg,url:'http://127.0.0.1:31002/#invalid'});assert.equal(elements.copy.disabled,true)
  deliver(cfg)
  assert.equal(elements.copy.hidden,false);assert.equal(elements.guide.hidden,false);assert.equal(copies.length,0)
  assert.equal(elements.address.value,'','metadata does not expose a field or copy automatically')
  await elements.copy.onclick()
  const expected=cfg.url.replace('/#','/?view=panel-only#')
  if(clipboard==='allowed'){
   assert.deepEqual(copies,[expected]);assert.equal(elements.manual.hidden,true);assert.equal(elements.address.value,'')
  }else{
   assert.equal(elements.manual.hidden,false);assert.equal(elements.address.value,expected)
   assert.equal(focused,1);assert.equal(selected,1);assert.match(status.textContent,/Ctrl\+C/)
  }
  assert.equal(requests.filter(x=>x.method!=='ui/initialize'&&x.method!=='ui/notifications/initialized').length,0,'copy grants no native navigation, message or model-context RPC')
  assert.ok(!JSON.stringify(requests).includes('b'.repeat(64)));assert.ok(!widget.includes('b'.repeat(64)))
  deliver({...cfg,view:'full'});assert.equal(elements.copy.hidden,true);assert.equal(elements.address.value,'')
  assert.equal(cfg.url.includes('?view=design'),false,'the same full-view connection is retained')
  deliver(cfg);listeners.pagehide();assert.equal(elements.copy.disabled,true);assert.equal(elements.address.value,'')
 }
})

test('invalidated original connection cannot be re-enabled by later view metadata',async()=>{
 const f=await manualWidget({writeText:async()=>{throw Error('Stale copy must not execute')}})
 await f.button.onclick();await new Promise(resolve=>setImmediate(resolve))
 f.metadata({...f.cfg,origin:'http://127.0.0.1:32001'})
 assert.equal(f.button.disabled,true);assert.equal(f.elements.copy.disabled,true)
 for(const view of ['full','design'])f.metadata({...f.cfg,view})
 f.metadata(f.cfg)
 assert.equal(f.button.disabled,true);assert.equal(f.elements.copy.disabled,true)
 const calls=f.calls.length,requests=f.requests.length
 await f.button.onclick();await f.elements.copy.onclick()
 assert.equal(f.calls.length,calls);assert.equal(f.requests.length,requests)
 assert.equal(f.elements.address.value,'');assert.equal(f.elements.manual.hidden,true)
})

test('late clipboard completion cannot restore a field or feedback after view or connection changes',async()=>{
 for(const outcome of ['resolve','reject'])for(const change of ['full','full-design','new-metadata','invalidated','pagehide']){
  let resolveCopy,rejectCopy
  const f=await manualWidget({writeText:()=>new Promise((resolve,reject)=>{resolveCopy=resolve;rejectCopy=reject})})
  if(change==='invalidated'){await f.button.onclick();await new Promise(resolve=>setImmediate(resolve))}
  const pending=f.elements.copy.onclick()
  assert.equal(typeof rejectCopy,'function')
  if(change==='full'||change==='full-design'){f.metadata({...f.cfg,view:'full'});if(change==='full-design')f.metadata(f.cfg)}
  if(change==='new-metadata')f.metadata({...f.cfg,url:'http://127.0.0.1:32002/#'+'c'.repeat(64)})
  if(change==='invalidated')f.metadata({...f.cfg,origin:'http://127.0.0.1:32001'})
  if(change==='pagehide')f.listeners.pagehide()
  const message=f.status.textContent,requests=f.requests.length
  if(outcome==='resolve')resolveCopy();else rejectCopy(Error('denied'))
  await pending
  assert.equal(f.elements.manual.hidden,true,change+' must not reveal the old address')
  assert.equal(f.elements.address.value,'');assert.equal(f.status.textContent,message)
  assert.equal(f.requests.length,requests,'clipboard completion grants no host operation')
 }
})

test('opted-in WorkBuddy Producer reuses native binding and settlement while Workers/GRA remain disabled',async()=>{
 const f=await fixture();let server
 try{
  const {mkdir}=await import('node:fs/promises')
  const transcriptPath=join(f.root,threadId+'.jsonl'),runId='agent-producer-test'
  const child=join(f.root,threadId,'subagents',runId+'.jsonl');await mkdir(join(child,'..'),{recursive:true})
  const event=(type,extra={})=>({id:randomUUID(),type,sessionId:threadId,cwd:f.options.projectRoot,...extra})
  const parent=[event('message',{role:'user'}),event('function_call',{name:'Agent',callId:'dispatch',arguments:'{}'}),event('function_call_result',{name:'Agent',callId:'dispatch',status:'completed',providerData:{toolResult:{subAgent:{sessionId:runId,lastId:'child-done'}}}})]
  await writeFile(transcriptPath,parent.map(JSON.stringify).join('\n')+'\n')
  await writeFile(child,JSON.stringify(event('message',{id:'child-done',sessionId:'native-child',role:'assistant',status:'completed',content:[{type:'output_text',text:'ready'}]}))+'\n')
  server=await startCompanion({...f.options,host:'workbuddy',threadId,transcriptPath,workbuddyProducer:true,connection:createWorkBuddyConnection({threadId,queue:createRelayQueue()})})
  const call=(method,params={})=>callCompanion(server.connectionPath,{method,params})
  assert.equal((await call('prepareBundle',{skill:'smart_questions'})).execution.mode,'subagent')
  await assert.rejects(call('registerNativeRun',{runId:'agent-forged',parentRunId:threadId,role:'producer',skill:'smart_questions',artifactId:'questions'}))
  assert.equal((await call('registerNativeRun',{runId,parentRunId:threadId,role:'producer',skill:'smart_questions',artifactId:'questions'})).registered,true)
  await assert.rejects(call('registerNativeRun',{runId,role:'worker'}),/Workers are not verified/)
  await assert.rejects(call('prepareReviews'),/background reviews are not supported/)
  await mkdir(join(server.project.project.designFilesRoot,'smart_questions'),{recursive:true})
  await writeFile(join(server.project.project.designFilesRoot,'smart_questions/smart_questions.json'),JSON.stringify({questions:{}}))
  const settled=await call('finishNativeRun',{runId,scope:'state',outcome:'pause'})
  assert.equal(settled.accepted,true)
  const workspace=await call('readWorkspace');assert.equal(workspace.hostCapabilities.nativeSubagents,true);assert.equal(workspace.hostCapabilities.backgroundReviews,false);assert.deepEqual(workspace.reviews,[])
 }finally{await server?.close();await f.close()}
})


test('startup failure cleans up relay without invoking the successful-service shutdown callback',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workbuddy-startup-failure-'));let stopped=0;
 try {
  await assert.rejects(startWorkBuddyPanel({runtimeRoot:root,projectRoot:join(root,'project'),stateRoot:join(root,'state'),nativeCwd:root,transcriptPath:join(root,'native.jsonl'),threadId,onStopped:()=>{stopped++}}),error=>error.code==='ENOENT'&&error.path===join(root,'web'));
  assert.equal(stopped,0,'startup cleanup must not exit the process before its error can be returned');
 }finally{await rm(root,{recursive:true,force:true})}
});

test('normal Panel closure records its exact identity and reason without retaining credentials',async()=>{
 const f=await fixture({withTranscript:true,serverOptions:{host:'workbuddy'}})
 let panel
 try {
  const runtimeRoot=join(f.root,'runtime')
  await mkdir(join(runtimeRoot,'kits'),{recursive:true})
  await symlink(f.options.kitRoot,join(runtimeRoot,'kits/web_app'),'dir')
  await symlink(f.options.staticRoot,join(runtimeRoot,'web'),'dir')
  panel=await startWorkBuddyPanel({runtimeRoot,projectRoot:f.options.projectRoot,stateRoot:join(f.root,'panel-state'),nativeCwd:f.options.projectRoot,transcriptPath:f.options.transcriptPath,threadId})
  const connection=JSON.parse(await readFile(panel.connectionPath,'utf8'))
  assert.equal(panel.previewPath,undefined)
  await assert.rejects(readdir(join(f.root,'panel-state/native-previews')),error=>error.code==='ENOENT','no HTML artifact is created')
  await panel.close()
  await assert.rejects(readFile(panel.connectionPath),error=>error.code==='ENOENT')
  const receipt=JSON.parse(await readFile(panel.connectionPath+'.closed.json','utf8'))
  assert.equal(receipt.host,'workbuddy');assert.equal(receipt.threadId,threadId);assert.equal(receipt.projectId,panel.projectId)
  assert.equal(receipt.reason,'explicit-close');assert.ok(receipt.closedAt>=receipt.startedAt)
  assert.ok(Number.isFinite(receipt.lastAuthenticatedActivityAt))
  assert.ok(!JSON.stringify(receipt).includes(connection.token));assert.ok(!JSON.stringify(receipt).includes(panel.widgetToken))
 } finally {await panel?.close();await f.close()}
})

test('panel widget connects once after both original metadata and host readiness, without navigation or a fabricated message',async()=>{
 for(const metadataFirst of [false,true]) {
  const f=await controlledWidget({autoConnect:true,heldMethods:metadataFirst?['ui/initialize']:[]})
  if(metadataFirst){assert.equal(f.calls.length,0);f.reply(f.requests.find(x=>x.method==='ui/initialize'),{hostCapabilities:{message:{},openLinks:{}}})}
  await drainWidget()
  assert.deepEqual(f.calls.map(x=>x.body.action),['pulse','pulse','take'])
  assert.equal(f.requests.filter(x=>['ui/open-link','ui/message'].includes(x.method)).length,0)
  assert.match(f.status.textContent,/已连接当前对话/)
  assert.equal(f.button.textContent,'在系统浏览器打开');assert.equal(f.button.disabled,false)
  const count=f.calls.length
  f.metadata(f.cfg);f.metadata(f.cfg);await drainWidget();assert.equal(f.calls.length,count,'repeated metadata cannot start a second poll loop')
  await f.button.onclick();await drainWidget()
  const opened=f.requests.filter(x=>x.method==='ui/open-link');assert.equal(opened.length,1)
  assert.equal(new URL(opened[0].params.url).search,'','explicit extra window uses full UI')
  assert.equal(f.requests.filter(x=>x.method==='ui/message').length,0)
  f.listeners.pagehide()
 }
})

test('automatic handshake failure, disposal and identity replacement do not silently retry or deliver messages',async()=>{
 for(const change of ['failed','disposed','replaced']){
  const pulse=deferred(),f=await controlledWidget({autoConnect:true,fetchBridge:()=>pulse.promise})
  await drainWidget();assert.equal(f.calls.length,1)
  if(change==='disposed')f.listeners.pagehide()
  if(change==='replaced')f.metadata({...f.cfg,threadId:'another-thread'})
  const requests=f.requests.length
  pulse.reject(TypeError('offline'));await drainWidget()
  f.metadata(f.cfg);f.metadata(f.cfg);await drainWidget()
  assert.equal(f.calls.length,1);assert.equal(f.requests.length,requests)
  assert.equal([...f.scheduled.values()].filter(x=>x.ms===1000).length,0)
 }
})

test('local WorkBuddy config passes startup policy, exposes a plain page URL and never accepts model policy overrides',async()=>{
 const args={projectRoot:'/project',sessionId:threadId,nativeCwd:'/native',transcriptPath:'/native/transcript.jsonl',view:'panel-only'}
 let input
 const descriptor={origin:'http://127.0.0.1:31001',widgetToken:'a'.repeat(64),url:'http://127.0.0.1:31002/browser/'+'b'.repeat(32)+'/',connectionPath:'/state/exact.json',threadId,projectId:'project-one'}
 const mcp=createWorkBuddyPanelMcp({runtimeRoot:'/runtime',stateRoot:'/state',browserAccess:'local',start:async value=>(input=value,descriptor)})
 const result=(await mcp.handle({id:1,method:'tools/call',params:{name:'yugoo_workbuddy_open_panel',arguments:args}})).result
 assert.notEqual(result.isError,true);assert.equal(input.browserAccess,'local')
 const url=new URL(JSON.parse(result.content[0].text).nativePreview.arguments.files[0])
 assert.equal(url.hash,'');assert.equal(url.search,'?view=panel-only');assert.equal(url.pathname,new URL(descriptor.url).pathname)
 assert.ok(!JSON.stringify(result.content).includes(descriptor.widgetToken))
 const catalog=(await mcp.handle({id:2,method:'tools/list'})).result
 assert.equal(Object.hasOwn(catalog.tools[0].inputSchema.properties,'browserAccess'),false)
 assert.throws(()=>createWorkBuddyPanelMcp({browserAccess:'off'}),/browserAccess/)
})


test('optional external-window rejection preserves the automatically connected save relay',async()=>{
 const f=await controlledWidget({autoConnect:true,heldMethods:['ui/open-link']});await drainWidget()
 const click=f.button.onclick();await drainWidget()
 f.reply(f.requests.find(x=>x.method==='ui/open-link'),{isError:true});await click
 assert.match(f.status.textContent,/保存仍可回传/);assert.equal(f.button.disabled,false)
 assert.equal([...f.scheduled.values()].filter(x=>x.ms===1000).length,2,'independent heartbeat and delivery timers remain active')
 assert.equal(f.requests.filter(x=>x.method==='ui/message').length,0)
 f.listeners.pagehide()
})


test('automatic panel-only keeps external opening secondary and recovery directly accessible',async()=>{
 for(const view of ['panel-only','design','full']){
  let offline=false
  const f=await controlledWidget({autoConnect:true,view,fetchBridge:()=>{if(offline)throw TypeError('offline');return bridgeResponse()}})
  await drainWidget()
  assert.equal(f.elements.options.hidden,view==='full')
  assert.equal(f.elements.options.open,false)
  assert.equal(f.button.parentNode,view==='full'?f.elements.primary:f.elements.secondary)
  assert.equal(f.requests.filter(x=>x.method==='ui/open-link').length,0)
  offline=true
  await [...f.scheduled.values()].find(x=>x.ms===1000).fn();await drainWidget()
  assert.equal(f.button.textContent,'恢复设计面板')
  assert.equal(f.button.parentNode,f.elements.primary)
  assert.equal(f.elements.options.hidden,true)
  assert.equal(f.button.hidden,false)
  assert.equal(f.button.disabled,false)
  assert.equal(f.requests.filter(x=>x.method==='ui/message').length,0,'failure does not send recovery without the user')
  f.listeners.pagehide()
 }
})
