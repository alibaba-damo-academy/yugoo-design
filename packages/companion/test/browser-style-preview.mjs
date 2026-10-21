/** Isolated React preview: interactivity/live tokens remain, parent access does not. */
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:http'
import {build} from 'tsdown'
import {chromium} from 'playwright'
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'style-preview-'))
let server,browser
try{
 const html=`<button id="counter" onclick="this.textContent=String(Number(this.textContent)+1)">0</button><div id="color" style="color:var(--ds-primary)">色彩</div><script>try{parent.document.body.dataset.compromised='yes'}catch{document.body.dataset.isolated='yes'}</script>`
 const config={theme:'fixture',layout:{},colors:{primary:'#112233'},typography:{},components:{},notes:'',preview_page:{html}}
 const entry=join(dir,'fixture.tsx')
 await writeFile(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{PreviewFrame}from ${JSON.stringify(join(root,'provider-web-app/src/client/ported/design/DesignStylePanel/PreviewFrame.tsx'))};const root=createRoot(document.getElementById('root'));const config=${JSON.stringify(config)};window.changeColor=()=>{config.colors={primary:'#445566'};root.render(<PreviewFrame config={{...config}}/>)};root.render(<PreviewFrame config={config}/>);`)
 await build({config:false,entry:{fixture:entry},outDir:join(dir,'out'),platform:'browser',format:'esm',tsconfig:false,dts:false,deps:{alwaysBundle:[/.*/],onlyBundle:false},alias:{react:join(root,'panel/node_modules/react'),'react-dom':join(root,'panel/node_modules/react-dom'),'dsh-design-panel/client-api':join(root,'panel/src/client/srcdoc-security.ts')},define:{'process.env.NODE_ENV':'"production"'}})
 const script=await readFile(join(dir,'out/fixture.js'))
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?script:'<div id="root" style="height:800px"></div><script type="module" src="/fixture.js"></script>')})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`)
 const frame=page.frameLocator('iframe');await frame.locator('#counter').click();assert.equal(await frame.locator('#counter').textContent(),'1')
 assert.equal(await page.locator('body').getAttribute('data-compromised'),null)
 assert.equal(await frame.locator('body').getAttribute('data-isolated'),'yes')
 await page.evaluate(()=>window.changeColor())
 await frame.locator('#color').evaluate(element=>new Promise(resolve=>{const check=()=>getComputedStyle(element).color==='rgb(68, 85, 102)'?resolve():setTimeout(check,10);check()}))
 assert.equal(await frame.locator('#counter').textContent(),'1','live color update must not reload preview')
 assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts')
 assert.equal(await frame.locator('meta[http-equiv="Content-Security-Policy"]').count(),1)
 console.log(JSON.stringify({interactive:true,liveStyleWithoutReload:true,parentIsolated:true,sharedCsp:true}))
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true})}
