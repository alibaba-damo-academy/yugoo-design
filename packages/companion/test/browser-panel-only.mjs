/** Real shared client + isolated service; never attaches to an installed host. */
import assert from 'node:assert/strict'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { GitVersioning, nodeDesignProjectSpawn } from '../../core/lib/index.js'
const f=await fixture({withTranscript:true,serverOptions:{browserAccess:'local',staticRoot:fileURLToPath(new URL('../dist',import.meta.url)),indexPath:fileURLToPath(new URL('../index.html',import.meta.url))}})
const browser=await chromium.launch({headless:true})
const evidence=process.env.COMPANION_EVIDENCE
const failures=[]
try{
 await mkdir(join(f.options.projectRoot,'design_files/smart_questions'),{recursive:true})
 await writeFile(join(f.options.projectRoot,'design_files/smart_questions/smart_questions.json'),JSON.stringify({questions:{q:{prompt:'测试用途',kind:'text',answer:'保留已保存内容',detail:''}}}))
 await new GitVersioning(nodeDesignProjectSpawn,f.options.projectRoot).commit('Initialize browser fixture',['design_files/smart_questions/smart_questions.json'])
 const assessment=await callCompanion(f.server.connectionPath,{method:'mainContext'})
 await callCompanion(f.server.connectionPath,{method:'reportMainClarity',params:{input:assessment.input,
  summary:'UI fixture assessment',u:{score:80,evidence:'需求来源明确'},s:{score:60,evidence:'范围已记录'},t:{score:40,evidence:'仍需验证'}}})
 const context=await browser.newContext({viewport:{width:760,height:850},locale:'zh-CN'})
 // WorkBuddy's webview storage can be unavailable. Local entry must still reload/back.
 await context.addInitScript(()=>{Object.defineProperty(window,'sessionStorage',{get(){throw Error('storage unavailable')}})})
 const page=await context.newPage();page.on('pageerror',e=>failures.push(e.message))
 const methods=[];page.on('request',request=>{if(request.method()==='POST'){try{methods.push(request.postDataJSON().method)}catch{}}})
 await page.goto(f.server.url+'?view=panel-only')
 await page.locator('.dsh-design-tabs').waitFor()
 await page.getByText('保留已保存内容',{exact:true}).waitFor()
 const layout=()=>page.evaluate(()=>{const sidebar=document.querySelector('.companion-sidebar').getBoundingClientRect(),tabs=document.querySelector('.dsh-design-tabs').getBoundingClientRect(),toolbar=document.querySelector('.dsh-design-dock-toolbar').getBoundingClientRect();return{right:Math.round(sidebar.right),width:innerWidth,sidebar:sidebar.width,tabsAfterPreferences:tabs.top===toolbar.bottom,preferencesAtTop:toolbar.top===0,header:!!document.querySelector('[data-testid=design-project-header]'),overflow:document.documentElement.scrollWidth>innerWidth,history:!!document.querySelector('.companion-conversation')}})
 for(const width of [760,360,420,1200]){
  await page.setViewportSize({width,height:850});const got=await layout()
  assert.deepEqual(got,{right:width,width,sidebar:52,tabsAfterPreferences:true,preferencesAtTop:true,header:false,overflow:false,history:false})
 }
 const current=page.getByRole('button',{name:'当前项目',exact:true})
 const info=page.getByTestId('current-project-info')
 await current.hover();await info.waitFor()
 await page.mouse.move(20,500);await info.waitFor({state:'hidden'})
 await current.click();await info.waitFor()
 await page.mouse.move(20,500);assert.ok(await info.isVisible(),'click pins information for reading')
 assert.equal(await info.getByTestId('design-dock-meta-name').innerText(),'设计项目：Companion fixture')
 assert.equal(await info.getByTestId('design-dock-meta-name').getAttribute('title'),'Companion fixture')
 assert.equal(await info.getByTestId('design-dock-meta-path').count(),0,'project information no longer repeats a raw path')
 await page.getByTestId('design-clarity-dock-u').focus()
 await page.getByRole('tooltip').filter({hasText:'80/100'}).waitFor()
 await page.keyboard.press('Escape');assert.ok(await info.isVisible(),'nested explanation Escape keeps its owner open')
 await page.keyboard.press('Escape');await info.waitFor({state:'hidden'})
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='当前项目')
 await page.keyboard.press('ArrowLeft');await info.waitFor()
 await page.waitForFunction(()=>document.querySelector('[data-testid=current-project-info]')===document.activeElement)
 for(const width of [360,420,760,1200]){
  await page.setViewportSize({width,height:600})
  await page.waitForFunction(()=>{const r=document.querySelector('[data-testid=current-project-info]').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight})
  assert.equal(await info.evaluate(el=>el.scrollWidth>el.clientWidth),false,'project information has no horizontal overflow')
 }
 await info.getByRole('button',{name:'关闭当前项目信息'}).click();await info.waitFor({state:'hidden'})
 await current.click();await info.waitFor();await page.mouse.click(20,500);await info.waitFor({state:'hidden'})
 await page.getByRole('button',{name:'设计项目',exact:true}).click()
 await page.getByTestId('design-project-catalog').waitFor()
 const popup=await page.getByTestId('design-project-catalog').boundingBox(),sidebar=await page.locator('.companion-sidebar').boundingBox()
 assert.ok(popup.x>=0&&popup.x+popup.width<=sidebar.x+1,JSON.stringify({popup,sidebar})) // Allow one CSS pixel at the shared border.
 await page.keyboard.press('Escape')
 await current.click();await info.waitFor()
 await page.mouse.move(20,500)
 await page.getByRole('button',{name:'设置',exact:true}).focus();await page.keyboard.press('Enter')
 const settings=page.getByRole('dialog',{name:'设计系统设置',exact:true});await settings.waitFor()
 await page.keyboard.press('Escape');await settings.waitFor({state:'hidden'});await info.waitFor({state:'hidden'})
 await page.reload();await page.locator('.dsh-design-tabs').waitFor()
 await page.goto('about:blank');await page.goBack();await page.locator('.dsh-design-tabs').waitFor()
 assert.equal(methods.includes('readConversation'),false)
 assert.equal(f.messages.length,0,'opening/reloading never sends a native user message')
 if(evidence){await mkdir(evidence,{recursive:true});await page.setViewportSize({width:760,height:850});await page.screenshot({path:join(evidence,'panel-only.png')});await current.click();await info.waitFor();await page.screenshot({path:join(evidence,'current-project.png')});await page.keyboard.press('Escape')}
 const recordedMessage=(id,text)=>JSON.stringify({type:'event_msg',payload:{type:'item_completed',turn_id:'browser-fixture',item:{type:'AgentMessage',id,content:[{type:'Text',text}]}}})+'\n'
 await appendFile(f.options.transcriptPath,recordedMessage('before-read','读取前已记录的内容'))
 const full=await context.newPage();const fullMethods=[];full.on('pageerror',error=>failures.push(error.message));full.on('request',request=>{if(request.method()==='POST'){try{fullMethods.push(request.postDataJSON().method)}catch{}}})
 await full.goto(f.server.url);await full.locator('.companion-conversation').waitFor();await full.getByTestId('design-project-header').waitFor()
 assert.equal(await full.getByTestId('design-project-header').getAttribute('data-compact'),null)
 assert.equal(await full.locator('.companion-sidebar').getAttribute('data-collapsed'),'false')
 await full.waitForResponse(response=>response.request().postData()?.includes('readConversation')===true)
 assert.ok(fullMethods.includes('readConversation'))
 await full.getByText('读取前已记录的内容',{exact:true}).waitFor()
 const draft=full.locator('.companion-conversation textarea')
 await draft.fill('尚未发送的草稿')
 // Keep one history read pending past the former ten-second cutoff. Real
 // completion/error releases its slot; the shared clock resumes observation.
 await full.evaluate(() => {
   const original = window.fetch
   window.__historyProbe = { held: 0, calls: 0, inFlight: 0, maximum: 0, aborted: 0, completed: 0, failed: 0, holdNext: true, restore: () => { window.fetch = original } }
   window.fetch = (...args) => {
     const request = args[1]
     const body = request?.body && JSON.parse(request.body)
     if (body?.method === 'readConversation' && body.params?.includeConversation !== false) {
       const probe = window.__historyProbe
       probe.calls++; probe.inFlight++; probe.maximum = Math.max(probe.maximum, probe.inFlight)
       request.signal?.addEventListener('abort', () => { probe.aborted++ }, { once: true })
       let response
       if (probe.holdNext) {
         probe.holdNext = false; probe.held++
         response = new Promise((resolve, reject) => {
           probe.release = () => original(...args).then(resolve, reject)
           probe.fail = () => reject(new TypeError('Controlled history transport failure'))
         })
       } else response = original(...args)
       return response.then(value => { probe.completed++; return value }, error => { probe.failed++; throw error }).finally(() => { probe.inFlight-- })
     }
     return original(...args)
   }
 })
 await full.waitForFunction(() => window.__historyProbe.held === 1)
 const workspaceReads=fullMethods.filter(method=>method==='readWorkspace').length
 // Deliberate wall-clock boundary: detect reintroduction of the old default
 // timer while the real page and shared polling clock remain active.
 await full.waitForTimeout(11000)
 assert.deepEqual(await full.evaluate(() => { const p=window.__historyProbe;return {calls:p.calls,inFlight:p.inFlight,maximum:p.maximum,aborted:p.aborted} }),{calls:1,inFlight:1,maximum:1,aborted:0})
 assert.ok(fullMethods.filter(method=>method==='readWorkspace').length>workspaceReads,'an unresolved history read does not stop workspace observation')
 assert.equal(await draft.inputValue(),'尚未发送的草稿')
 await full.getByText('读取前已记录的内容',{exact:true}).waitFor()
 if(evidence)await full.screenshot({path:join(evidence,'history-waiting.png')})
 await appendFile(f.options.transcriptPath,recordedMessage('slow-result','延迟读取后记录的内容'))
 await full.evaluate(() => window.__historyProbe.release())
 await full.getByText('延迟读取后记录的内容',{exact:true}).waitFor()
 await full.evaluate(() => { window.__historyProbe.holdNext=true })
 await full.waitForFunction(() => window.__historyProbe.held === 2)
 // Keep the next ordinary observation pending so the genuine error feedback
 // and retained messages/draft can be inspected before recovery completes.
 await full.evaluate(() => { window.__historyProbe.holdNext=true;window.__historyProbe.fail() })
 const syncError=full.getByText('会话同步已断开，正在重试；以下保留上次收到的记录。',{exact:true})
 await syncError.waitFor()
 await full.waitForFunction(() => window.__historyProbe.held === 3)
 await full.getByText('读取前已记录的内容',{exact:true}).waitFor()
 await full.getByText('延迟读取后记录的内容',{exact:true}).waitFor()
 assert.equal(await draft.inputValue(),'尚未发送的草稿')
 if(evidence)await full.screenshot({path:join(evidence,'history-error.png')})
 await appendFile(f.options.transcriptPath,recordedMessage('recovered','错误恢复后记录的内容'))
 await full.evaluate(() => window.__historyProbe.release())
 await full.getByText('错误恢复后记录的内容',{exact:true}).waitFor()
 await syncError.waitFor({state:'hidden'})
 assert.equal(await draft.inputValue(),'尚未发送的草稿')
 const historyReads=await full.evaluate(() => {const p=window.__historyProbe;return {held:p.held,maximum:p.maximum,aborted:p.aborted,failed:p.failed,completed:p.completed}})
 assert.equal(historyReads.maximum,1);assert.equal(historyReads.aborted,0);assert.equal(historyReads.failed,1)
 assert.equal(f.messages.length,0,'observing results/errors never submits or replays native input')
 await full.evaluate(() => window.__historyProbe.restore())
 if(evidence)await full.screenshot({path:join(evidence,'history-recovered.png')})

 // The same local-browser admission must expose the integrated Studio archive
 // workspace without starting a trial or invoking the native conversation.
 const studio=await context.newPage();studio.on('pageerror',error=>failures.push(error.message))
 await studio.goto(f.server.url+'?view=studio')
 await studio.getByRole('button',{name:'导入',exact:true}).waitFor()
 await studio.getByRole('button',{name:'导入',exact:true}).click()
 await studio.getByLabel('选择导入文件',{exact:true}).waitFor({state:'attached'})
 assert.equal(f.messages.length,0,'opening Studio archives never runs or notifies a native agent')

 assert.equal(failures.length,0,failures.join('\n'))
 console.log(JSON.stringify({localReloadAndBack:true,noStorage:true,panelOnly:{rightSidebar:52,header:false,tabsAfterPreferences:true,currentProject:'hover, pin, keyboard, nested explanation, close, project identity without raw path',noHistoryRequests:true,widths:[360,420,760,1200],catalogBounds:{popup,sidebar}},fullViewPreserved:true,historyReads:{...historyReads,waitPastFormerDeadlineMs:11000,recordedRowsRetained:true,draftRetained:true,nativeInputs:f.messages.length},studioArchivesReachable:true,errors:failures}))
}catch(error){
 if(evidence){
  await mkdir(evidence,{recursive:true})
  for(const [index,page]of browser.contexts().flatMap(context=>context.pages()).entries()){
   if(page.isClosed())continue
   await page.screenshot({path:join(evidence,`failure-${index}.png`)}).catch(()=>{})
   await writeFile(join(evidence,`failure-${index}.json`),JSON.stringify(await page.evaluate(()=>({
    text:document.body.innerText.slice(0,8000),
    controls:[...document.querySelectorAll('button,[role=dialog],[role=tab]')].map(el=>({role:el.getAttribute('role'),name:el.getAttribute('aria-label')??el.textContent.trim(),testid:el.getAttribute('data-testid')})),
   })).catch(()=>({closed:true})),null,2))
  }
 }
 throw error
}finally{await browser.close();await f.close()}
