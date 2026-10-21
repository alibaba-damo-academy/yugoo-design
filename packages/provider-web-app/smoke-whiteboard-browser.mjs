/** Production DSH factory + actual canvas events; isolated local persistence harness. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const run = promisify(execFile), root = import.meta.dirname
const out = await mkdtemp(join(tmpdir(), 'whiteboard-browser-'))
const session = `whiteboard-${process.pid}`
const browser = async (...args) => (await run('agent-browser', ['--session', session, ...args], {timeout:45000,maxBuffer:2e6})).stdout
let server
try {
  await run('pnpm', ['exec','tsdown','--config','test/whiteboard-browser.config.ts'], {cwd:root,env:{...process.env,WHITEBOARD_TEST_OUT:out}})
  server = createServer(async (req,res) => {
    if(req.url === '/') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="root"></div><script type="module" src="/fixture.js"></script>'); return }
    const path = {'/fixture.js':join(out,'fixture.js'),'/provider.js':join(root,'lib/client.js')}[req.url]
    if(!path) {res.writeHead(404);res.end();return}
    res.setHeader('Content-Type','text/javascript'); res.end(await readFile(path))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const click = name=>browser('find','role','button','click','--name',name)
  const check = async code=>assert.equal((await browser('eval',code)).trim(),'true',code)
  const draw = async()=>{
    await browser('click','input[aria-label="矩形"]')
    await browser('mouse','move','650','300'); await browser('mouse','down')
    await browser('mouse','move','850','430'); await browser('mouse','up')
  }
  await browser('open',url)
  await browser('wait','--fn','document.body.innerText.includes("新建一个主题")')
  await check('!!document.querySelector("[data-panel-content-mode=workspace]") && !document.querySelector("input[aria-label=白板修改要求]") && !document.body.innerText.includes("请 AI 调整")')
  const seed = {state:{boards:{pending:{id:'pending',title:'待绘制主题',artifact_file:'whiteboard/boards/pending.json'}},board_order:['pending']},files:{}}
  await browser('eval',`localStorage.setItem('whiteboard-test', ${JSON.stringify(JSON.stringify(seed))})`)
  await browser('open',url)
  await browser('wait','--fn','document.body.innerText.includes("白板场景尚未生成")')
  await check('!document.querySelector("[role=alert]") && !document.querySelector("canvas")')
  await check('Array.from(document.querySelectorAll("[role=status]")).some(e=>e.textContent.includes("白板场景尚未生成") && e.getBoundingClientRect().height>300 && getComputedStyle(e).justifyContent==="center")')
  await browser('screenshot','/tmp/cx2-whiteboard-pending.png')
  seed.files['whiteboard/boards/pending.json'] = {content:'{invalid'}
  await browser('eval',`localStorage.setItem('whiteboard-test', ${JSON.stringify(JSON.stringify(seed))})`)
  await browser('open',url)
  await browser('wait','--fn','document.body.innerText.includes("场景不能读取")')
  await check('document.querySelector("[role=alert]").getBoundingClientRect().height>300 && !document.querySelector("canvas")')
  await browser('eval','localStorage.removeItem("whiteboard-test")')
  await browser('open',url); await click('新建主题')
  await browser('fill','input[aria-label="白板主题名称"]','用户旅程')
  await browser('wait','canvas'); await draw()
  await check('Object.values(window.whiteboardTest.draft._scenes)[0].scene.elements.length === 1')
  await click('保存测试文件')
  await browser('open',url); await browser('wait','canvas')
  await check('!window.whiteboardTest.draft._scenes && Object.keys(window.whiteboardTest.disk.files).length === 1')
  await draw()
  await browser('eval','window.beforeAI = JSON.stringify(window.whiteboardTest.draft)')
  await click('模拟 AI 文件更新')
  await browser('wait','--fn','document.body.innerText.includes("草稿已保留")')
  await check('JSON.stringify(window.whiteboardTest.draft) === window.beforeAI')
  await click('保存测试文件')
  await check('JSON.parse(Object.values(window.whiteboardTest.disk.files)[0].content).elements.length === 2')
  await click('新建主题'); await browser('fill','input[aria-label="白板主题名称"]','服务蓝图')
  await click('保存测试文件'); await browser('open',url); await browser('wait','canvas')
  await check('window.whiteboardTest.disk.state.board_order.length === 2 && Object.keys(window.whiteboardTest.disk.files).length === 2')
  await browser('click','input[aria-label="白板主题名称"]')
  await browser('press','End')
  for (let i=0;i<4;i++) await browser('press','Backspace')
  await browser('wait','--fn','Object.values(window.whiteboardTest.draft.boards).some(board => board.title === "")')
  await click('保存测试文件')
  await check('window.whiteboardTest.disk.state.boards[window.whiteboardTest.disk.state.board_order[0]].title === "用户旅程"')
  await check('Object.values(window.whiteboardTest.draft.boards).some(board => board.title === "")')
  const errors = await browser('errors'); assert.ok(!errors.includes('Error'),errors)
  console.log('WHITEBOARD BROWSER OK: production factory loads; draw/save/reopen; dirty scene survives AI update; two topic artifacts; failed save preserves draft. Harness storage only, not full DSH session.')
} catch (error) {
  console.error(await browser('snapshot','-i').catch(()=>''))
  console.error(await browser('errors').catch(()=>''))
  throw error
} finally {
  await browser('close').catch(()=>{})
  if(server) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  await rm(out,{recursive:true,force:true})
}
