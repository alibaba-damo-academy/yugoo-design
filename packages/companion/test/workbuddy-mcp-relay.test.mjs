import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createRelayQueue,startWorkBuddyRelay} from '../src/workbuddy-mcp-relay.mjs'
import {createRelayProbe} from '../src/workbuddy-relay-probe.mjs'

test('relay rejects offline, stale or competing widgets and claims each message only once',()=>{
 let now=0;const q=createRelayQueue({now:()=>now,freshMs:4000}),owner=randomUUID(),other=randomUUID(),id=randomUUID()
 assert.throws(()=>q.submit(id,'hello'),/当前未发送/)
 q.pulse(owner,true);q.submit(id,'hello');assert.equal(q.take(owner).message.text,'hello');assert.equal(q.take(owner).message,null)
 assert.throws(()=>q.pulse(other,true),/Another widget/)
 assert.throws(()=>q.take(other),/not ready/)
 assert.equal(q.submit(id,'hello').status,'claimed')
 assert.throws(()=>q.submit(id,'changed'),/different content/)
 q.settle(owner,id,'submitted_unverified');now=5000
 assert.throws(()=>q.submit(randomUUID(),'next'),/当前未发送/)
 q.pulse(owner,false);assert.equal(q.status().online,false)
})

test('unknown delivery is never retried, queued expiry is distinguishable and close revokes ownership',()=>{
 let now=0;const q=createRelayQueue({now:()=>now,deadlineMs:15000}),owner=randomUUID(),id=randomUUID()
 q.pulse(owner,true);q.submit(id,'hello');q.take(owner);now=16000;q.pulse(owner,true)
 assert.equal(q.status(id).message.status,'delivery_unknown');assert.equal(q.take(owner).message,null)
 assert.throws(()=>q.submit(randomUUID(),'again'),/不会自动重发/)
 q.close();assert.throws(()=>q.settle(owner,id,'submitted_unverified'),/Stale/)
 const b=createRelayQueue({now:()=>now,deadlineMs:15000});b.pulse(owner,true);b.submit(id,'hello');now=32000
 assert.equal(b.status(id).message.status,'not_delivered')
})

test('loopback bridge isolates browser and widget credentials, guards browser Origin, and never reports an ACK',async t=>{
 const r=await startWorkBuddyRelay();t.after(()=>r.close())
 const api=(path,token,body,origin=r.origin)=>fetch(r.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':token,Origin:origin},body:JSON.stringify(body)})
 assert.equal((await api('/api',r.widgetToken,{action:'status'})).status,403)
 assert.equal((await api('/bridge',r.browserToken,{action:'pulse'})).status,403)
 assert.equal((await api('/api',r.browserToken,{action:'status'},'https://other.example')).status,403)
 const owner=randomUUID(),id=randomUUID()
 assert.equal((await api('/bridge',r.widgetToken,{action:'pulse',clientId:owner,visible:true},'null')).status,200)
 assert.equal((await api('/api',r.browserToken,{action:'send',id,text:'user request'})).status,200)
 const claim=await(await api('/bridge',r.widgetToken,{action:'take',clientId:owner},'null')).json()
 assert.equal(claim.message.id,id)
 assert.equal((await api('/bridge',r.widgetToken,{action:'result',clientId:owner,id,status:'completed'},'null')).status,400)
 await api('/bridge',r.widgetToken,{action:'result',clientId:owner,id,status:'submitted_unverified'},'null')
 const status=await(await api('/api',r.browserToken,{action:'status',id})).json()
 assert.equal(status.message.status,'submitted_unverified');assert.equal(status.message.accepted,undefined)
 const publicPage=await(await fetch(r.origin)).text();assert.ok(!publicPage.includes(r.browserToken));assert.ok(!publicPage.includes(r.widgetToken))
})

test('MCP relay resource carries only its exact local CSP origin and tool invocation sends nothing',async t=>{
 const p=createRelayProbe();t.after(()=>p.close())
 const call=(method,params)=>p.handle({id:1,method,params})
 const tool=(await call('tools/list')).result.tools[0]
 assert.equal((await call('tools/call',{name:tool.name,arguments:{}})).result.structuredContent.ready,true)
 const content=(await call('resources/read',{uri:tool._meta.ui.resourceUri})).result.contents[0]
 assert.match(content._meta.ui.csp.connectDomains[0],/^http:\/\/127\.0\.0\.1:\d+$/)
 assert.deepEqual(content._meta.ui.csp.resourceDomains,[])
 assert.match(content.text,/连接并打开外部输入页/)
 assert.equal((await call('resources/read',{uri:'file:///user/profile'})).error.code,-32602)
})


test('relay remains available after its creating MCP process exits', async t => {
 const service = new URL('../src/workbuddy-relay-service.mjs', import.meta.url).href
 const child = spawn(process.execPath, ['--input-type=module', '-e',
  `import {startDetachedWorkBuddyRelay} from ${JSON.stringify(service)}; const relay=await startDetachedWorkBuddyRelay(); console.log(JSON.stringify({origin:relay.origin,token:relay.widgetToken,pid:relay.pid}));`], {stdio:['ignore','pipe','pipe']})
 let output='', errors=''; child.stdout.on('data', chunk => output+=chunk); child.stderr.on('data', chunk => errors+=chunk)
 const [exitCode] = await once(child,'exit'); assert.equal(exitCode,0,errors)
 const relay=JSON.parse(output); t.after(() => {try {process.kill(relay.pid)} catch {}})
 const response=await fetch(relay.origin+'/bridge',{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':relay.token},body:JSON.stringify({action:'pulse',clientId:randomUUID(),visible:true})})
 assert.equal(response.status,200); assert.equal((await response.json()).online,true)
})

test('abandoned or over-age services expire without leaving a listener', async () => {
 for (const options of [{idleTimeoutMs:40},{maxLifetimeMs:40}]) {
  const relay=await startWorkBuddyRelay(options)
  await new Promise(resolve => setTimeout(resolve,120))
  await assert.rejects(fetch(relay.origin))
  await relay.close() // closing is idempotent
 }
})

test('active Panel reads prevent idle shutdown without granting native input availability', async () => {
 let activity=Date.now(),stopped
 const relay=await startWorkBuddyRelay({idleTimeoutMs:120,getLastActivityAt:()=>activity,onClose:reason=>{stopped=reason}})
 const heartbeat=setInterval(()=>{activity=Date.now()},30)
 try {
  await new Promise(resolve=>setTimeout(resolve,300))
  assert.equal((await fetch(relay.origin)).status,200)
  assert.equal(relay.queue.status().online,false,'Panel activity is not a widget heartbeat')
  assert.throws(()=>relay.queue.submit(randomUUID(),'must not wake a missing widget'),/当前未发送/)
  assert.equal(stopped,undefined)
  clearInterval(heartbeat)
  await new Promise(resolve=>setTimeout(resolve,300))
  await assert.rejects(fetch(relay.origin))
  assert.equal(stopped.reason,'idle-timeout')
  assert.ok(stopped.closedAt>=stopped.startedAt)
 } finally {clearInterval(heartbeat);await relay.close()}
})

test('maximum service lifetime still expires while Panel activity continues',async()=>{
 let stopped
 const relay=await startWorkBuddyRelay({idleTimeoutMs:120,maxLifetimeMs:120,getLastActivityAt:()=>Date.now(),onClose:reason=>{stopped=reason}})
 try {
  await new Promise(resolve=>setTimeout(resolve,300))
  await assert.rejects(fetch(relay.origin))
  assert.equal(stopped.reason,'maximum-lifetime')
 } finally {await relay.close()}
})
