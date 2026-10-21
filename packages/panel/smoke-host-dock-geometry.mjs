/** Representative DOM/CSS geometry fixture, not an installed Desktop acceptance. */
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import {chromium} from 'playwright'
const source=await readFile(new URL('./src/client/host-dock-geometry.ts',import.meta.url),'utf8')
const script=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/^export /gm,'')
const styleSource=await readFile(new URL('./src/client/styles.ts',import.meta.url),'utf8')
const css=styleSource.match(/export const DOCK_CSS = `([\s\S]*?)`\n/)[1]
const html=`<!doctype html><meta charset="utf-8"><title>Host header alignment fixture</title>
<style>*{box-sizing:border-box}html,body{margin:0;height:100%;font:14px Arial,sans-serif}
:root{--caption:40px;--host-header:51px;--offset:0px;--frame-border:0px;--overlay-border:0px;--dsh-design-dock-w:65vw}
.host-frame{position:relative;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);height:calc(100vh - var(--offset));margin-top:var(--offset);padding-top:var(--caption);border:var(--frame-border) solid transparent}
.host-caption{position:absolute;inset:0 0 auto;height:var(--caption);display:flex;align-items:center;justify-content:space-between;background:#f5f5f5}
.host-caption button{height:28px;background:transparent;border:0}.conversation{min-height:0;overflow:hidden}
[data-slot]{display:contents}.host-header{height:var(--host-header);border-bottom:.5px solid #ddd;display:flex;align-items:center;padding:0 16px}
[data-shell-overlay]{position:absolute;inset:0;pointer-events:none;z-index:20;border:var(--overlay-border) solid transparent}
.dsh-design-project-header .dsh-clarity-dock{white-space:nowrap}.body{padding:16px}
${css}</style>
<div class="host-frame dsh-design-frame-inset"><div class="host-caption"><span>应用　编辑</span><button id="host-menu">系统菜单</button></div>
<main class="conversation" data-slot="conversation"><div data-slot="conversation.header"><header class="host-header">聊天标题与工具栏</header></div><div id="messages">原对话内容</div></main>
<div data-shell-overlay><div class="dsh-design-dock dsh-design-root"><header class="dsh-design-project-header" data-testid="design-project-header"><div class="dsh-design-dock-meta" data-testid="design-dock-meta"><div class="dsh-clarity-dock">构思完成度　尚未评估</div><div class="dsh-design-project-identity"><span data-testid="design-dock-meta-name">设计项目：test_1</span><button class="dsh-design-project-folder" aria-label="打开项目文件夹">▱</button></div></div></header><div class="body">设计面板内容</div><div class="dsh-design-dock-resize"></div></div></div></div>
<script>${script}
window.geometryChanges=0;
window.releaseGeometry=observeHostDockGeometry(document,g=>{window.geometryChanges++;const dock=document.querySelector('.dsh-design-dock');dock.style.setProperty('--dsh-design-dock-top',g.top+'px');dock.style.setProperty('--dsh-host-primary-header-height',g.headerHeight+'px')});
window.hostMenuClicks=0;document.querySelector('#host-menu').onclick=()=>window.hostMenuClicks++;
</script>`
const browser=await chromium.launch({headless:true}).catch(()=>chromium.launch({headless:true,channel:'chrome'}))
const observations=[]
try{
  const page=await browser.newPage({viewport:{width:1778,height:1067}})
  await page.setContent(html)
  const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  async function check(name){
    await settled()
    const r=await page.evaluate(()=>{
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height,left:r.left,right:r.right}}
      return {header:rect('.host-header'),dock:rect('.dsh-design-dock'),project:rect('[data-testid=design-project-header]'),folder:rect('.dsh-design-project-folder'),
        completion:rect('.dsh-clarity-dock'),identity:rect('.dsh-design-project-identity'),scrollWidth:document.documentElement.scrollWidth,width:innerWidth}
    })
    assert(Math.abs(r.dock.top-r.header.top)<0.01,name+': top must clear actual caption')
    assert(Math.abs(r.project.bottom-r.header.bottom)<0.01,name+': bottom divider must match actual Host header')
    assert(r.completion.top>=r.project.top&&r.identity.bottom<=r.project.bottom,name+': both rows remain inside the header')
    assert.equal(r.folder.height,24);assert.equal(r.folder.width,24);assert(r.folder.right<=r.project.right)
    assert.equal(r.scrollWidth,r.width,name+': no page overflow')
    observations.push({name,...r})
  }
  await check('windows-caption-40-no-tabs')
  await page.locator('#host-menu').click();assert.equal(await page.evaluate(()=>window.hostMenuClicks),1)
  await page.evaluate(()=>document.documentElement.style.setProperty('--host-header','76px'))
  await check('tabs-header-76')
  await page.evaluate(()=>{document.documentElement.style.setProperty('--caption','57.25px');document.documentElement.style.setProperty('--host-header','50.5px')})
  await check('fractional-caption-and-header')
  await page.evaluate(()=>{document.documentElement.style.setProperty('--offset','120px');document.documentElement.style.setProperty('--frame-border','3px');document.documentElement.style.setProperty('--overlay-border','2px')})
  await check('nonzero-frame-origin-and-borders')
  await page.evaluate(()=>{document.documentElement.style.setProperty('--caption','0px');document.documentElement.style.setProperty('--offset','0px');document.documentElement.style.setProperty('--frame-border','0px');document.documentElement.style.setProperty('--overlay-border','0px');document.documentElement.setAttribute('data-fullscreen','')})
  await check('web-or-fullscreen-no-caption-gap')
  await page.setViewportSize({width:1100,height:900})
  await page.evaluate(()=>document.querySelector('[data-testid=design-dock-meta-name]').textContent='设计项目：'+ '很长的项目名称 Long Project '.repeat(30))
  await check('narrow-long-name')
  await page.evaluate(()=>{const e=document.createElement('span');e.role='alert';e.className='dsh-design-project-folder-error';e.textContent='打开失败，请重试';document.querySelector('[data-testid=design-dock-meta]').append(e)})
  await check('opener-failure-keeps-divider-and-visible-error')
  const alert=await page.locator('[role=alert]').boundingBox(),header=await page.locator('[data-testid=design-project-header]').boundingBox()
  assert(alert.y>=header.y+header.height-.01,JSON.stringify({message:'Retryable error must start below the border-box divider',alert,header}));assert(await page.locator('[role=alert]').isVisible())
  await page.evaluate(()=>document.querySelector('[role=alert]').remove())
  const out=process.env.YUGOO_GEOMETRY_EVIDENCE
  if(out){
    await mkdir(out,{recursive:true});await writeFile(path.join(out,'fixture.html'),html,{flag:'wx'})
    await page.screenshot({path:path.join(out,'narrow-long-name.png')})
    await writeFile(path.join(out,'BROWSER-FIXTURE.json'),JSON.stringify({boundary:'Representative real-browser geometry fixture only, not native Desktop or official Web acceptance',observations},null,2)+'\n',{flag:'wx'})
  }
  console.log(JSON.stringify({boundary:'Browser DOM/CSS fixture',checks:observations.length,topAndBottomAligned:true,captionMenuClickable:true,observations}))
}finally{await browser.close()}
