/** Opens only an experiment tab, leaving the user's DSH tab untouched. No server/daemon. */
import {writeFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import assert from 'node:assert/strict'
const [path,host,algorithm,sizeMode]=process.argv.slice(2)
assert.ok(path?.startsWith('/tmp/graph-live-')&&path.endsWith('/comparison.html'),'Expected generated graph-live HTML')
assert.ok(host,'Pass an explicit Chrome debug HTTP endpoint as the second argument')
const endpoint=new URL(host)
assert.ok(['http:','https:'].includes(endpoint.protocol)&&!endpoint.username&&!endpoint.password
  &&endpoint.pathname==='/'&&!endpoint.search&&!endpoint.hash,'Expected a credential-free Chrome debug HTTP origin')
const file=`file://wsl.localhost/${process.env.WSL_DISTRO_NAME??'Ubuntu-20.04'}${path}`
// Always create a new owned tab; another session's same-title experiment is not ours.
const tab=await(await fetch(`${endpoint.origin}/json/new?${encodeURIComponent(file)}`,{method:'PUT',signal:AbortSignal.timeout(5000)})).json()
const debuggerUrl=new URL(tab.webSocketDebuggerUrl)
debuggerUrl.host=endpoint.host
debuggerUrl.protocol=endpoint.protocol==='https:'?'wss:':'ws:'
const ws=new WebSocket(debuggerUrl)
let sequence=0;const pending=new Map()
ws.addEventListener('message',event=>{
  const msg=JSON.parse(event.data),p=pending.get(msg.id)
  if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result)}
})
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`))},8000)
  pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))
})
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP connection timeout')),8000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP connection error'))},{once:true})})
  await send('Runtime.enable');await send('Page.enable')
  // A background tab intentionally pauses this experiment's simulation.
  await send('Page.bringToFront')
  let state
  for(let i=0;i<30;i++){
    const result=await send('Runtime.evaluate',{expression:'window.graphExperiment?.snapshot()',returnByValue:true})
    state=result.result?.value
    if(state?.stopped)break
    await new Promise(r=>setTimeout(r,500))
  }
  assert.ok(state?.stopped,'Experiment did not load/settle in Chrome')
  for(const [id,value]of [['algorithm',algorithm],['node-size',sizeMode]]){
    if(!value)continue
    const changed=await send('Runtime.evaluate',{expression:`(()=>{const el=document.getElementById(${JSON.stringify(id)});if(!el||![...el.options].some(o=>o.value===${JSON.stringify(value)}))return false;el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change'));return true})()`,returnByValue:true})
    assert.equal(changed.result?.value,true,'Unknown experiment option')
    for(let i=0;i<40;i++){
      const result=await send('Runtime.evaluate',{expression:'window.graphExperiment?.snapshot()',returnByValue:true})
      state=result.result?.value
      if(state?.stopped&&!state.loading)break
      await new Promise(r=>setTimeout(r,500))
    }
    assert.ok(state?.stopped&&!state.layoutError,'Selected layout failed')
  }
  await send('Page.bringToFront')
  const screenshot=await send('Page.captureScreenshot',{format:'png'})
  await writeFile(join(dirname(path),'windows-chrome.png'),Buffer.from(screenshot.data,'base64'))
  console.log(JSON.stringify({tab:tab.id,url:file,algorithm:state.algorithm,sizeMode:state.sizeMode,nodes:state.nodes.length,edges:state.edges,sourceUnchanged:state.sourceUnchanged,screenshot:join(dirname(path),'windows-chrome.png')}))
}finally{
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP closed'))}
  pending.clear();ws.close()
}
