/** Real shared client + isolated service; never attaches to an installed host. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { fixture } from './fixture.mjs'
import { writeDesignClarityAuthority, designClarityDigest } from '../../core/lib/index.js'
const f=await fixture({withTranscript:true,serverOptions:{browserAccess:'local',staticRoot:fileURLToPath(new URL('../dist',import.meta.url)),indexPath:fileURLToPath(new URL('../index.html',import.meta.url))}})
const browser=await chromium.launch({headless:true})
const evidence=process.env.COMPANION_EVIDENCE
const failures=[]
try{
 await mkdir(join(f.options.projectRoot,'design_files/smart_questions'),{recursive:true})
 await writeFile(join(f.options.projectRoot,'design_files/smart_questions/smart_questions.json'),JSON.stringify({questions:{q:{prompt:'测试用途',kind:'text',answer:'保留已保存内容',detail:''}}}))
 const projectId=f.server.project.project.metadata.id
 const report={summary:'UI fixture assessment',u:{score:80,evidence:'需求来源明确'},s:{score:60,evidence:'范围已记录'},t:{score:40,evidence:'仍需验证'},kit:'web_app',version:'1.0',origin:'evaluator',turn:1,callId:'ui-fixture'}
 report.digest=designClarityDigest(report,report.kit,report.version)
 await writeDesignClarityAuthority(join(f.options.stateRoot,projectId),{schemaVersion:1,projectId,assessedCheckpoint:await f.server.project.store.head(),report})
 const context=await browser.newContext({viewport:{width:760,height:850},locale:'zh-CN'})
 // WorkBuddy's webview storage can be unavailable. Local entry must still reload/back.
 await context.addInitScript(()=>{Object.defineProperty(window,'sessionStorage',{get(){throw Error('storage unavailable')}})})
 const page=await context.newPage();page.on('pageerror',e=>failures.push(e.message))
 const methods=[];page.on('request',request=>{if(request.method()==='POST'){try{methods.push(request.postDataJSON().method)}catch{}}})
 await page.goto(f.server.url+'?view=panel-only')
 await page.locator('.dsh-design-tabs').waitFor()
 await page.getByText('保留已保存内容',{exact:true}).waitFor()
 const layout=()=>page.evaluate(()=>{const sidebar=document.querySelector('.companion-sidebar').getBoundingClientRect(),tabs=document.querySelector('.dsh-design-tabs').getBoundingClientRect();return{right:Math.round(sidebar.right),width:innerWidth,sidebar:sidebar.width,tabsTop:tabs.top,header:!!document.querySelector('[data-testid=design-project-header]'),overflow:document.documentElement.scrollWidth>innerWidth,history:!!document.querySelector('.companion-conversation')}})
 for(const width of [760,360,420,1200]){
  await page.setViewportSize({width,height:850});const got=await layout()
  assert.deepEqual(got,{right:width,width,sidebar:52,tabsTop:0,header:false,overflow:false,history:false})
 }
 const current=page.getByRole('button',{name:'当前项目',exact:true})
 const info=page.getByTestId('current-project-info')
 await current.hover();await info.waitFor()
 await page.mouse.move(20,500);await info.waitFor({state:'hidden'})
 await current.click();await info.waitFor()
 await page.mouse.move(20,500);assert.ok(await info.isVisible(),'click pins information for reading')
 assert.ok((await info.getByTestId('design-dock-meta-name').innerText()).length>0)
 assert.ok((await info.getByTestId('design-dock-meta-path').innerText()).includes(f.options.projectRoot))
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
  assert.equal(await info.evaluate(el=>el.scrollWidth>el.clientWidth),false,'path wraps without horizontal overflow')
 }
 await info.getByRole('button',{name:'关闭当前项目信息'}).click();await info.waitFor({state:'hidden'})
 await current.click();await info.waitFor();await page.mouse.click(20,500);await info.waitFor({state:'hidden'})
 await page.getByRole('button',{name:'设计项目',exact:true}).click()
 await page.getByTestId('design-project-catalog').waitFor()
 const popup=await page.getByTestId('design-project-catalog').boundingBox();assert.ok(popup.x+popup.width<=1200-52)
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
 const full=await context.newPage();const fullMethods=[];full.on('request',request=>{if(request.method()==='POST'){try{fullMethods.push(request.postDataJSON().method)}catch{}}})
 await full.goto(f.server.url);await full.locator('.companion-conversation').waitFor();await full.getByTestId('design-project-header').waitFor()
 assert.equal(await full.getByTestId('design-project-header').getAttribute('data-compact'),null)
 assert.equal(await full.locator('.companion-sidebar').getAttribute('data-collapsed'),'false')
 await full.waitForResponse(response=>response.request().postData()?.includes('readConversation')===true)
 assert.ok(fullMethods.includes('readConversation'))
 // A stalled history read releases its busy slot after the bounded read timeout.
 // No native input is replayed, and the next recorded row becomes visible.
 await full.evaluate(() => {
   const original = window.fetch
   window.__historyProbe = { held: 0, aborted: 0, recovered: 0 }
   window.fetch = (...args) => {
     const request = args[1]
     if (request?.body && JSON.parse(request.body).method === 'readConversation') {
       if (!window.__historyProbe.held++) return new Promise((_resolve, reject) => {
         request.signal.addEventListener('abort', () => { window.__historyProbe.aborted++; reject(request.signal.reason) }, { once: true })
       })
       window.__historyProbe.recovered++
     }
     return original(...args)
   }
 })
 await full.waitForFunction(() => window.__historyProbe.held > 0)
 await full.waitForFunction(() => window.__historyProbe.aborted === 1 && window.__historyProbe.recovered > 0, {}, {timeout:15000})
 assert.equal(f.messages.length,0,'read timeout never resubmits a native message')

 // The same local-browser admission must expose the integrated Studio archive
 // workspace without starting a trial or invoking the native conversation.
 const studio=await context.newPage();studio.on('pageerror',error=>failures.push(error.message))
 await studio.goto(f.server.url+'?view=studio')
 const importList=studio.waitForResponse(response=>response.request().postData()?.includes('studioContentImportList')===true)
 await studio.getByRole('button',{name:'内容归档',exact:true}).click()
 assert.equal((await importList).status(),200)
 await studio.locator('summary').filter({hasText:'归档 JSON'}).click()
 await studio.getByRole('textbox',{name:'归档 JSON',exact:true}).waitFor()
 assert.equal(f.messages.length,0,'opening Studio archives never runs or notifies a native agent')

 assert.equal(failures.length,0,failures.join('\n'))
 console.log(JSON.stringify({localReloadAndBack:true,noStorage:true,panelOnly:{rightSidebar:52,header:false,tabsTop:0,currentProject:'hover, pin, keyboard, nested explanation, close, full path',noHistoryRequests:true,widths:[360,420,760,1200]},fullViewPreserved:true,studioArchivesReachable:true,errors:failures}))
}finally{await browser.close();await f.close()}
