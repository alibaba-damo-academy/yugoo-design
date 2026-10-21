/** Probe explicit candidate artifacts or retained diagnostics; no build, install or host service. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = process.argv.slice(2), options = {}
for(let i=0;i<args.length;i++) {
  const key=args[i]
  assert.ok(['--retained-diagnostic-dir','--candidate-dir','--candidate-inventory-sha256','--pica-file'].includes(key),'Unknown probe option')
  assert.ok(!(key in options),'Duplicate probe option')
  options[key]=args[++i]
  assert.ok(options[key]&&!options[key].startsWith('--'),'Missing probe option value')
}
const diagnostic=!!options['--retained-diagnostic-dir']
assert.ok(diagnostic || (options['--candidate-dir'] && /^[a-f0-9]{64}$/u.test(options['--candidate-inventory-sha256']??'') && options['--pica-file']), 'Explicit candidate directory, full inventory SHA-256 and pica filename required')
assert.ok(!diagnostic || (Object.keys(options).length===2&&options['--pica-file']),'Explicit diagnostic directory and pica filename required; diagnostic and candidate inputs cannot mix')
const candidateDirectory=diagnostic?undefined:resolve(options['--candidate-dir'])
const source = diagnostic?resolve(options['--retained-diagnostic-dir']):join(candidateDirectory,'payload/shared/web')
const picaFile = options['--pica-file']
assert.ok(typeof picaFile==='string' && !/[\\/\0\r\n]/u.test(picaFile) && picaFile.endsWith('.js'),'Expected pica basename')
// Refused CLI inputs must not load native compiler/parser or browser dependencies.
// This cheap preflight supplements, never replaces, the full evidence inventory.
if(diagnostic) {
  assert.equal(await realpath(source),source,'Diagnostic root follows a symlink')
  assert.ok((await lstat(source)).isDirectory(),'Expected diagnostic directory')
  assert.ok((await readdir(source)).includes(picaFile),'Diagnostic pica input is missing')
  const input=await lstat(join(source,picaFile))
  assert.ok(input.isFile()&&!input.isSymbolicLink(),'Expected regular diagnostic pica input')
}
const { artifactInventory, inventorySha256, classifyPicaWorker } = await import('./pica-worker-evidence.mjs')
const candidateInputs=candidateDirectory?await artifactInventory(candidateDirectory):undefined
const candidateInventorySha256=candidateInputs?inventorySha256(candidateInputs):undefined
if(candidateInputs)assert.equal(candidateInventorySha256,options['--candidate-inventory-sha256'],'Candidate inventory mismatch before browser launch')
// Retain complete diagnostic inventory/symlink validation after the cheap checks.
if(diagnostic) {
  const inputs=await artifactInventory(source)
  assert.ok(Object.hasOwn(inputs,picaFile),'Diagnostic pica input is missing')
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const root = await mkdtemp(join(await realpath(tmpdir()), 'companion-pica-worker-probe-'))
const web = join(root, 'web')
const report = { root, source, picaFile, candidateDirectory, candidateInputs, candidateInventorySha256,
  runnerSha256:sha(await readFile(fileURLToPath(import.meta.url))),
  kind:diagnostic?'retained-relocated-pica-worker-probe':'candidate-relocated-pica-worker-probe', fullBuild:false,
  staticUnknown:['webworkify factory accesses dispatcher/source/cache to generate Worker code'],
  dynamicClosureVerified:false, browserExecuted:false, requests:[], blocked:[], serverRequests:[], cases:[], errors:[], blobs:[], cleanup:{} }
console.log(`PICA PROBE ROOT ${root}`)

async function inventory(directory) {
  const result = {}
  async function walk(path) {
    for(const name of (await readdir(path)).sort()) {
      const file=join(path,name),info=await lstat(file)
      assert.ok(!info.isSymbolicLink(),'Artifact symlink rejected')
      if(info.isDirectory())await walk(file)
      else {assert.ok(info.isFile());result[relative(directory,file)]={bytes:info.size,sha256:sha(await readFile(file))}}
    }
  }
  await walk(directory);return result
}
const req = createRequire(new URL('../packages/skills-web-app/package.json', import.meta.url))
const { chromium } = req('playwright')
const { parseSync } = await import(pathToFileURL(createRequire(req.resolve('tsdown')).resolve('rolldown/utils')))
let server, browserServer, browser, context, browserPid, phase='startup'
const deadline = (promise, ms, label) => {
  let timer
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out`)),ms)})]).finally(()=>clearTimeout(timer))
}
function instrument() {
  const audit=window.workerAudit={workers:[],blobs:[],errors:[]}
  const NativeWorker=window.Worker,makeURL=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL)
  URL.createObjectURL=function(blob){const url=makeURL(blob);audit.blobs.push({url,blob,revoked:false});return url}
  URL.revokeObjectURL=function(url){const item=audit.blobs.find(x=>x.url===url);if(item)item.revoked=true;return revoke(url)}
  window.Worker=class extends NativeWorker {
    constructor(url,options){
      super(url,options)
      const item={id:audit.workers.length,url:String(url),posts:[],messages:[],errors:[],terminated:false};audit.workers.push(item)
      const post=this.postMessage.bind(this),terminate=this.terminate.bind(this)
      this.postMessage=(data,...args)=>{item.posts.push({tile:!!data?.opts,width:data?.opts?.width,height:data?.opts?.height,toWidth:data?.opts?.toWidth,toHeight:data?.opts?.toHeight});return post(data,...args)}
      this.terminate=()=>{item.terminated=true;return terminate()}
      this.addEventListener('message',event=>item.messages.push({dataLength:event.data?.data?.length,bitmap:!!event.data?.bitmap,control:event.data?.control,support:typeof event.data==='boolean'?event.data:undefined,error:event.data?.err}))
      this.addEventListener('error',event=>item.errors.push(event.message||'worker error'))
      item.worker=this
    }
  }
  window.cleanupWorkers=()=>{audit.workers.forEach(item=>item.worker.terminate());audit.blobs.forEach(item=>URL.revokeObjectURL(item.url))}
}

try {
  report.inputs=await inventory(source)
  assert.equal(report.inputs[picaFile].sha256,'c79c7f30b9c2b043072d5b975caf1dbe27007204fe72480ce4a9dbe5c27bdbce')
  const picaCode=await readFile(join(source,picaFile),'utf8'),parsed=parseSync(picaFile,picaCode),supportFunctions=[]
  classifyPicaWorker(picaCode)
  assert.equal(parsed.errors.length,0)
  function findSupport(node){if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration'&&node.id?.name==='workerPayload')supportFunctions.push(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(findSupport);else if(value&&typeof value==='object')findSupport(value)}
  findSupport(parsed.program);assert.equal(supportFunctions.length,1)
  const support=supportFunctions[0],expectedSupportScript='('+picaCode.slice(support.start,support.end)+')(self);'
  report.offscreenSupportScriptSha256=sha(expectedSupportScript)
  await cp(source,web,{recursive:true,errorOnExist:true,force:false})
  assert.deepEqual(await inventory(web),report.inputs)
  await writeFile(join(root,'probe.html'),'<!doctype html><link rel="icon" href="data:,"><title>Relocated pica Worker probe</title><h1>Pica Worker probe</h1><canvas id="source" width="256" height="128"></canvas><canvas id="result" width="64" height="32"></canvas><pre id="status"></pre>')
  server=createServer(async(request,response)=>{
    const path=resolve(root,'.'+new URL(request.url,'http://localhost').pathname)
    const rel=relative(root,path)
    try{
      assert.ok(!rel.startsWith('../')&&rel!=='..'&&['GET','HEAD'].includes(request.method))
      const info=await lstat(path);assert.ok(info.isFile()&&!info.isSymbolicLink())
      response.setHeader('Content-Type',path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.js')?'text/javascript; charset=utf-8':'application/octet-stream')
      response.statusCode=200;response.end(request.method==='HEAD'?undefined:await readFile(path))
      report.serverRequests.push({method:request.method,path:request.url,status:200})
    }catch{response.statusCode=404;response.end('not found');report.serverRequests.push({method:request.method,path:request.url,status:404})}
  })
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  const port=server.address().port,origin=`http://127.0.0.1:${port}`
  assert.ok(![18421,9222].includes(port));report.origin=origin
  browserServer=await deadline(chromium.launchServer({headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']}),30000,'browser launch')
  browserPid=browserServer.process().pid;report.browserPid=browserPid
  browser=await chromium.connect(browserServer.wsEndpoint());report.browserVersion=browser.version()
  report.nodeVersion=process.versions.node;report.playwrightVersion=req('playwright/package.json').version
  context=await browser.newContext({viewport:{width:900,height:450},serviceWorkers:'block'})
  context.on('request',request=>report.requests.push({phase,url:request.url(),type:request.resourceType()}))
  await context.route('**/*',route=>{
    const url=route.request().url()
    if(new URL(url).origin===origin)return route.continue()
    report.blocked.push({phase,url,type:route.request().resourceType()});return route.abort('blockedbyclient')
  })
  await context.routeWebSocket('**/*',socket=>{report.blocked.push({phase,url:socket.url(),type:'websocket'});socket.close()})
  phase='network-control'
  const control=await context.newPage();await control.goto(origin+'/probe.html')
  const controlResult=await deadline(control.evaluate(async()=>{
    const source="(async()=>{let fetchBlocked=false,importBlocked=false;try{await fetch('https://example.invalid/pica-worker-fetch-control')}catch{fetchBlocked=true}try{importScripts('https://example.invalid/pica-worker-import-control')}catch{importBlocked=true}postMessage({control:{fetchBlocked,importBlocked}})})()"
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url)
    try{return await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data.control);worker.onerror=reject})}finally{worker.terminate();URL.revokeObjectURL(url)}
  }),15000,'worker network audit control')
  assert.deepEqual(controlResult,{fetchBlocked:true,importBlocked:true})
  assert.ok(report.blocked.some(x=>x.phase===phase&&x.url.endsWith('pica-worker-fetch-control')))
  assert.ok(report.blocked.some(x=>x.phase===phase&&x.url.endsWith('pica-worker-import-control')))
  report.networkAuditControl={status:'PASS',...controlResult};await control.close()
  for(const [label,features]of [['js-worker',['js','ww']],['default-worker',['js','wasm','ww']]]){
    phase=label
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push({phase:label,message:error.message}))
    await page.addInitScript(instrument);await page.goto(origin+'/probe.html')
    const result=await deadline(page.evaluate(async({moduleURL,features})=>{
      const {default:Pica}=await import(moduleURL),pica=Pica({features,concurrency:1,tile:64,idle:100})
      await pica.init();if(!pica.features.ww)throw Error('Worker unavailable; fallback is not success')
      const canvas=document.querySelector('#source'),target=document.querySelector('#result'),ctx=canvas.getContext('2d')
      const colors=['rgb(220,30,40)','rgb(20,180,60)','rgb(30,50,210)','rgb(230,200,20)']
      colors.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i%2*128,Math.floor(i/2)*64,128,64)})
      await pica.resize(canvas,target,{quality:3,alpha:true})
      const pixels=target.getContext('2d').getImageData(0,0,64,32).data
      const samples=[[16,8],[48,8],[16,24],[48,24]].map(([x,y])=>Array.from(pixels.slice((y*64+x)*4,(y*64+x)*4+4)))
      const workers=window.workerAudit.workers.map(({worker,...item})=>item)
      const tasks=workers.filter(item=>item.posts.some(x=>x.tile))
      if(!tasks.length||!tasks.some(item=>item.messages.some(x=>x.dataLength>0||x.bitmap)))throw Error('No actual Worker tile/result')
      window.cleanupWorkers()
      const blobs=await Promise.all(window.workerAudit.blobs.map(async({blob,...item})=>({...item,type:blob.type,bytes:blob.size,text:await blob.text()})))
      const result={features:pica.features,workers:window.workerAudit.workers.map(({worker,...item})=>item),samples,pixels:Array.from(pixels),blobs,width:target.width,height:target.height}
      document.querySelector('#status').textContent=JSON.stringify({features:result.features,samples},null,2);return result
    },{moduleURL:origin+'/web/'+picaFile,features}),30000,label+' resize')
    report.caseDiagnostics??=[];report.caseDiagnostics.push({label,features:result.features,workers:result.workers,samples:result.samples})
    assert.equal(result.features.ww,true);assert.equal(result.width,64);assert.equal(result.height,32)
    const expected=[[220,30,40,255],[20,180,60,255],[30,50,210,255],[230,200,20,255]]
    result.samples.forEach((sample,i)=>sample.forEach((value,j)=>assert.ok(Math.abs(value-expected[i][j])<=3,`${label}: unexpected pixel ${i}/${j}`)))
    assert.ok(result.workers.every(worker=>worker.errors.length===0&&worker.terminated))
    assert.ok(result.workers.every(worker=>worker.messages.every(message=>message.error==null||message.error==='')),'Worker message reports an error')
    for(const worker of result.workers){
      if(worker.url.startsWith('blob:'+origin)){worker.urlKind='owned-blob';continue}
      const prefix='data:text/javascript;base64,';assert.ok(worker.url.startsWith(prefix),'Unexpected Worker URL')
      const code=Buffer.from(worker.url.slice(prefix.length),'base64').toString('utf8')
      assert.equal(code,expectedSupportScript,'Unknown data-URL Worker script')
      assert.equal(worker.posts.length,0,'Support worker must not receive resize tasks')
      assert.ok(worker.messages.some(message=>typeof message.support==='boolean'))
      worker.urlKind='verified-offscreen-support';worker.scriptSha256=sha(code)
      await writeFile(join(root,label+'-offscreen-support.js'),code)
    }
    for(const [i,blob]of result.blobs.entries()){
      const file=`${label}-worker-${i}.js`;await writeFile(join(root,file),blob.text)
      report.blobs.push({phase:label,file,url:blob.url,bytes:blob.bytes,sha256:sha(blob.text),revoked:blob.revoked,sourceRewritten:false,
        importScriptsMentions:/\bimportScripts\s*\(/u.test(blob.text),urlLoadingMentions:/\b(?:fetch|XMLHttpRequest)\b/u.test(blob.text)})
    }
    assert.ok(!report.blocked.some(x=>x.phase===label))
    assert.ok(report.blobs.filter(x=>x.phase===label).every(blob=>!blob.importScriptsMentions&&!blob.urlLoadingMentions))
    report.cases.push({label,status:'PASS',features:result.features,width:result.width,height:result.height,samples:result.samples,pixelSha256:sha(Buffer.from(result.pixels)),workers:result.workers})
    await page.screenshot({path:join(root,label+'.png')});await page.close()
  }
  assert.equal(report.errors.length,0);assert.ok(report.serverRequests.every(request=>request.status===200))
  report.browserExecuted=true;report.status='PASS'
}catch(error){report.status='FAIL';report.error={name:error.name,message:error.message};process.exitCode=1}
finally{
  try{if(context)await deadline(context.close(),10000,'context cleanup')}catch(error){report.cleanup.contextError=error.message}
  try{if(browser)await deadline(browser.close(),10000,'browser cleanup')}catch(error){report.cleanup.browserError=error.message}
  try{if(browserServer)await deadline(browserServer.close(),10000,'browser-server cleanup')}catch(error){report.cleanup.browserServerError=error.message}
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  report.cleanup.httpListening=!!server?.listening;report.cleanup.browserConnected=!!browser?.isConnected()
  if(browserPid){try{process.kill(browserPid,0);report.cleanup.browserPidAlive=true}catch{report.cleanup.browserPidAlive=false}}
  try{report.inputsUnchanged=JSON.stringify(await inventory(source))===JSON.stringify(report.inputs);report.copyUnchanged=JSON.stringify(await inventory(web))===JSON.stringify(report.inputs)}catch(error){report.cleanup.inventoryError=error.message}
  try{if(candidateInputs)report.candidateUnchanged=inventorySha256(await artifactInventory(candidateDirectory))===candidateInventorySha256}catch(error){report.cleanup.candidateInventoryError=error.message}
  if(report.cleanup.httpListening||report.cleanup.browserConnected||report.cleanup.browserPidAlive||!report.inputsUnchanged||!report.copyUnchanged||(candidateInputs&&!report.candidateUnchanged)||Object.keys(report.cleanup).some(k=>k.endsWith('Error'))){report.status='FAIL';process.exitCode=1}
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n')
}
console.log(JSON.stringify({root,status:report.status,error:report.error,cases:report.cases.map(x=>({label:x.label,status:x.status,features:x.features,workers:x.workers.length})),networkAuditControl:report.networkAuditControl,cleanup:report.cleanup,inputsUnchanged:report.inputsUnchanged,copyUnchanged:report.copyUnchanged,dynamicClosureVerified:false},null,2))
