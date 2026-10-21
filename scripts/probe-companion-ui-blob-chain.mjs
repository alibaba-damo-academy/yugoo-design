/** Independent explicit candidate/diagnostic Blob-chain probe. No build/install/host mutation. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cp, lstat, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { artifactInventory, inventorySha256, sha256 } from './pica-worker-evidence.mjs'
import { UI_BLOB_FILES, UI_NETWORK_CONTROL_SOURCE, verifyUiBlobInputs, uiBlobRunnerIdentity, decodeUiPng, validateUiPixels } from './ui-blob-chain-evidence.mjs'

const args=process.argv.slice(2),options={}
for(let i=0;i<args.length;i++) {
  const key=args[i]; assert.ok(['--candidate-dir','--candidate-inventory-sha256','--retained-diagnostic-dir'].includes(key),'Unknown option')
  assert.ok(!(key in options),'Duplicate option'); options[key]=args[++i]; assert.ok(options[key],'Missing option value')
}
const diagnostic=!!options['--retained-diagnostic-dir']
assert.ok(diagnostic ? Object.keys(options).length===1 : options['--candidate-dir']&&/^[a-f0-9]{64}$/u.test(options['--candidate-inventory-sha256']??''),'Explicit candidate directory/inventory hash or retained diagnostic directory required')
const inputRoot=resolve(options[diagnostic?'--retained-diagnostic-dir':'--candidate-dir'])
const source=diagnostic?inputRoot:join(inputRoot,'payload/shared/web')
let inputInventory,inputInventorySha256,moduleInputs,webInventory,runnerIdentity
const root=await mkdtemp(join(tmpdir(),'companion-ui-blob-chain-')),web=join(root,'web')
const report={root,inputRoot,source,
  kind:diagnostic?'diagnostic-injected-pica-ui-blob-chain':'candidate-injected-pica-ui-blob-chain',scope:'injected-pica-ui-blob-chain',
  dynamicClosureVerified:false,embeddedDefaultWorkerVerified:false,candidateAccepted:false,
  browserExecuted:false,requests:[],blocked:[],serverRequests:[],errors:[],workers:[],blobs:[],cleanup:{}}
console.log(`UI BLOB PROBE ROOT ${root}`)
const req=createRequire(new URL('../packages/skills-web-app/package.json',import.meta.url))
let server,browserServer,browser,context,pid,phase='startup'
const deadline=(promise,ms,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms)})]).finally(()=>clearTimeout(timer))}
function instrument() {
  const audit=window.uiAudit={workers:[],blobs:[]},NativeWorker=window.Worker,make=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL)
  URL.createObjectURL=blob=>{const url=make(blob);audit.blobs.push({url,blob,revoked:false});return url}
  URL.revokeObjectURL=url=>{const item=audit.blobs.find(b=>b.url===url);if(item)item.revoked=true;return revoke(url)}
  window.Worker=class extends NativeWorker {
    constructor(url,options) {
      super(url,options)
      const item={url:String(url),posts:[],messages:[],errors:[],terminated:false,worker:this};audit.workers.push(item)
      const post=this.postMessage.bind(this),terminate=this.terminate.bind(this)
      this.postMessage=(data,...rest)=>{item.posts.push({tile:!!data?.opts});return post(data,...rest)}
      this.terminate=()=>{item.terminated=true;return terminate()}
      this.addEventListener('message',event=>item.messages.push({dataLength:event.data?.data?.length,bitmap:!!event.data?.bitmap,error:event.data?.err,support:typeof event.data==='boolean'?event.data:undefined}))
      this.addEventListener('error',event=>item.errors.push(event.message||'Worker error'))
    }
  }
  window.cleanupUiResources=()=>{audit.workers.forEach(w=>w.worker.terminate());audit.blobs.forEach(b=>URL.revokeObjectURL(b.url))}
}
try {
  inputInventory=await artifactInventory(inputRoot);inputInventorySha256=inventorySha256(inputInventory)
  Object.assign(report,{inputInventory,inputInventorySha256})
  if(!diagnostic)assert.equal(inputInventorySha256,options['--candidate-inventory-sha256'],'Candidate inventory mismatch before browser launch')
  moduleInputs=await verifyUiBlobInputs(source);webInventory=await artifactInventory(source);runnerIdentity=await uiBlobRunnerIdentity()
  Object.assign(report,{moduleInputs,webInventory,runnerIdentity,staticUnknown:moduleInputs.staticUnknown})
  await cp(source,web,{recursive:true,errorOnExist:true,force:false});assert.deepEqual(await artifactInventory(web),webInventory)
  await writeFile(join(root,'probe.html'),'<!doctype html><link rel="icon" href="data:,"><title>Injected UI Blob chain</title><h1>Injected UI Blob chain</h1><canvas id="input" width="256" height="128"></canvas><canvas id="output" width="64" height="32"></canvas><pre id="status"></pre>')
  server=createServer(async(request,response)=>{
    const path=resolve(root,'.'+new URL(request.url,'http://localhost').pathname),delta=relative(root,path)
    try {
      assert.ok(delta!=='..'&&!delta.startsWith('../')&&['GET','HEAD'].includes(request.method))
      const info=await lstat(path);assert.ok(info.isFile()&&!info.isSymbolicLink())
      response.setHeader('Content-Type',path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.js')?'text/javascript; charset=utf-8':'application/octet-stream')
      response.end(request.method==='HEAD'?undefined:await readFile(path));report.serverRequests.push({method:request.method,path:request.url,status:200})
    }catch{response.statusCode=404;response.end('not found');report.serverRequests.push({method:request.method,path:request.url,status:404})}
  })
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  const origin=report.origin=`http://127.0.0.1:${server.address().port}`
  assert.ok(![18421,9222].includes(server.address().port))
  const {chromium}=req('playwright')
  browserServer=await deadline(chromium.launchServer({headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']}),30000,'launch')
  pid=report.browserPid=browserServer.process().pid
  browser=await chromium.connect(browserServer.wsEndpoint());report.browserVersion=browser.version()
  report.playwrightVersion=req('playwright/package.json').version;report.nodeVersion=process.versions.node
  context=await browser.newContext({viewport:{width:900,height:450},serviceWorkers:'block'})
  context.on('request',request=>report.requests.push({phase,url:request.url(),type:request.resourceType()}))
  await context.route('**/*',route=>{
    const url=route.request().url();if(new URL(url).origin===origin)return route.continue()
    report.blocked.push({phase,url,type:route.request().resourceType()});return route.abort('blockedbyclient')
  })
  await context.routeWebSocket('**/*',socket=>{report.blocked.push({phase,url:socket.url(),type:'websocket'});socket.close()})
  phase='network-control'
  const control=await context.newPage();await control.goto(origin+'/probe.html')
  const controlled=await deadline(control.evaluate(async source=>{
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url)
    let result
    try{result=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=reject})}
    finally{worker.terminate();URL.revokeObjectURL(url)}
    return {...result,url,workerTerminated:true,blobRevoked:true}
  },UI_NETWORK_CONTROL_SOURCE),15000,'network controls')
  assert.equal(controlled.fetchBlocked,true);assert.equal(controlled.importBlocked,true)
  for(const suffix of ['fetch','import'])assert.ok(report.blocked.some(q=>q.phase===phase&&q.url===`https://example.invalid/ui-blob-${suffix}-control`))
  report.networkAuditControl={status:'PASS',...controlled,sourceSha256:sha256(UI_NETWORK_CONTROL_SOURCE)}
  await control.close()
  phase='ui-blob-chain'
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message))
  await page.addInitScript(instrument);await page.goto(origin+'/probe.html')
  const result=await deadline(page.evaluate(async({origin,files})=>{
    const [{default:Pica},{default:ImageBlobReduce}]=await Promise.all([import(origin+'/web/'+files.pica),import(origin+'/web/'+files.image)])
    const pica=Pica({features:['js','wasm']}),reducer=ImageBlobReduce({pica})
    const canvas=document.querySelector('#input'),context=canvas.getContext('2d')
    const colors=['rgb(220,30,40)','rgb(20,180,60)','rgb(30,50,210)','rgb(230,200,20)']
    colors.forEach((color,i)=>{context.fillStyle=color;context.fillRect(i%2*128,Math.floor(i/2)*64,128,64)})
    const png=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Input PNG missing')),'image/png'))
    const input=new File([png],'quadrants.png',{type:'image/png'}),output=await reducer.toBlob(input,{max:64,alpha:true})
    if(output.type!=='image/png')throw Error('Unexpected output MIME')
    const decoded=await createImageBitmap(output)
    let pixels,width=decoded.width,height=decoded.height
    try{const target=document.querySelector('#output');target.width=width;target.height=height;const ctx=target.getContext('2d');ctx.drawImage(decoded,0,0);pixels=[...ctx.getImageData(0,0,width,height).data]}finally{decoded.close()}
    const pngBytes=[...new Uint8Array(await output.arrayBuffer())]
    const before=window.uiAudit.workers.map(({worker,...item})=>item)
    if(pica.features.ww!==false||before.some(w=>w.posts.some(p=>p.tile)||w.messages.some(m=>m.dataLength||m.bitmap)))throw Error('Unexpected tile Worker activity')
    if(before.some(w=>w.errors.length||w.messages.some(m=>m.error!=null&&m.error!=='')))throw Error('Worker error')
    window.uiAudit.blobs.forEach(b=>b.revokedBeforeCleanup=b.revoked)
    window.cleanupUiResources()
    const blobs=await Promise.all(window.uiAudit.blobs.map(async({blob,...item})=>({...item,type:blob.type,bytes:blob.size,data:[...new Uint8Array(await blob.arrayBuffer())]})))
    document.querySelector('#status').textContent=JSON.stringify({features:pica.features,width,height,mime:output.type},null,2)
    return {features:pica.features,width,height,mime:output.type,pngBytes,pixels,workers:window.uiAudit.workers.map(({worker,...item})=>item),blobs}
  },{origin,files:UI_BLOB_FILES}),30000,'UI Blob resize')
  assert.equal(result.width,64);assert.equal(result.height,32);assert.equal(result.features.ww,false)
  assert.equal(result.features.js,true);assert.equal(result.features.wasm,true)
  const png=Buffer.from(result.pngBytes),pixels=Buffer.from(result.pixels)
  assert.deepEqual(decodeUiPng(png),pixels)
  const samples=validateUiPixels(pixels)
  await writeFile(join(root,'output.png'),png);await writeFile(join(root,'output.rgba'),pixels)
  report.task={configuredFeatures:['js','wasm'],features:result.features,mime:result.mime,width:64,height:32,
    outputBytes:png.length,outputSha256:sha256(png),pixelSha256:sha256(pixels),samples,workerTilePosts:0,workerTileResults:0}
  report.workers=result.workers
  for(const [i,w]of report.workers.entries()) {
    assert.equal(w.terminated,true);assert.deepEqual(w.errors,[]);assert.equal(w.posts.length,0)
    assert.ok(w.messages.every(m=>m.error==null||m.error===''))
    const prefix='data:text/javascript;base64,';assert.ok(w.url.startsWith(prefix),'Unknown auxiliary Worker')
    const bytes=Buffer.from(w.url.slice(prefix.length),'base64');assert.equal(sha256(bytes),moduleInputs.offscreenSupportScriptSha256)
    assert.ok(w.messages.some(m=>typeof m.support==='boolean'));w.sourceFile=`ui-support-${i}.js`;await writeFile(join(root,w.sourceFile),bytes)
  }
  for(const [i,b]of result.blobs.entries()) {
    assert.equal(b.revoked,true);assert.equal(b.type,'image/png','Unexpected generated Blob')
    const bytes=Buffer.from(b.data),file=`ui-blob-${i}.bin`;await writeFile(join(root,file),bytes)
    report.blobs.push({file,url:b.url,bytes:bytes.length,sha256:sha256(bytes),type:b.type,revoked:true,revokedBeforeCleanup:b.revokedBeforeCleanup,sourceRewritten:false})
  }
  assert.ok(!report.blocked.some(q=>q.phase===phase));assert.deepEqual(report.errors,[])
  assert.ok(report.serverRequests.every(q=>q.status===200))
  const allowedPaths=['/probe.html',...Object.values(UI_BLOB_FILES).filter(f=>f!=='client.js').map(f=>'/web/'+f)]
  for(const q of report.requests) {
    if(q.phase==='network-control'&&(q.url===controlled.url||report.blocked.some(b=>b.url===q.url)))continue
    if(q.phase==='ui-blob-chain'&&(report.blobs.some(b=>b.url===q.url)||report.workers.some(w=>w.url===q.url)))continue
    const url=new URL(q.url);assert.equal(url.origin,origin);assert.ok(allowedPaths.includes(url.pathname),'Unexpected loopback request')
  }
  await page.screenshot({path:join(root,'ui-blob-chain.png')});report.screenshotSha256=sha256(await readFile(join(root,'ui-blob-chain.png')))
  await page.close();report.browserExecuted=true;report.status='PASS'
}catch(error){report.status='FAIL';report.error={name:error.name,message:error.message};process.exitCode=1}
finally {
  try{if(context)for(const page of context.pages())await deadline(page.evaluate(()=>window.cleanupUiResources?.()),5000,'Worker/Blob cleanup')}catch(e){report.cleanup.resourceError=e.message}
  try{if(context)await deadline(context.close(),10000,'context cleanup')}catch(e){report.cleanup.contextError=e.message}
  try{if(browser)await deadline(browser.close(),10000,'browser cleanup')}catch(e){report.cleanup.browserError=e.message}
  try{if(browserServer)await deadline(browserServer.close(),10000,'browser-server cleanup')}catch(e){report.cleanup.browserServerError=e.message}
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  report.cleanup.httpListening=!!server?.listening;report.cleanup.browserConnected=!!browser?.isConnected()
  if(pid){try{process.kill(pid,0);report.cleanup.browserPidAlive=true}catch{report.cleanup.browserPidAlive=false}}else report.cleanup.browserPidAlive=false
  try{report.inputsUnchanged=!!inputInventorySha256&&inventorySha256(await artifactInventory(inputRoot))===inputInventorySha256;report.copyUnchanged=!!webInventory&&JSON.stringify(await artifactInventory(web))===JSON.stringify(webInventory)}catch(e){report.cleanup.inventoryError=e.message}
  if(Object.entries(report.cleanup).some(([key,value])=>key.endsWith('Error')||value!==false)||!report.inputsUnchanged||!report.copyUnchanged){report.status='FAIL';process.exitCode=1}
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n')
}
console.log(JSON.stringify({root,status:report.status,error:report.error,task:report.task,cleanup:report.cleanup,inputsUnchanged:report.inputsUnchanged,copyUnchanged:report.copyUnchanged,scope:report.scope,dynamicClosureVerified:false},null,2))
