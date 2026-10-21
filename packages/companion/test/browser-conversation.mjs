import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture } from './fixture.mjs'

const run = promisify(execFile), session = process.env.COMPANION_BROWSER_SESSION ?? `companion-conversation-${process.pid}`
const browser = async (...args) => (await run('agent-browser', ['--session', session, ...args], { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout
const f = await fixture({ withTranscript: true, serverOptions: {
  staticRoot: fileURLToPath(new URL('../dist', import.meta.url)),
  indexPath: fileURLToPath(new URL('../index.html', import.meta.url)),
} })
const append = payload => appendFile(f.options.transcriptPath, JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload }) + '\n')
try {
  await mkdir(join(f.options.projectRoot, 'design_files/smart_questions'))
  await writeFile(join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json'), JSON.stringify({ questions: { overview: { prompt: '产品目标是什么？', kind: 'text', answer: '帮助用户整理设计成果', detail: '' } } }))
  await append({ type: 'task_started', turn_id: 't1' })
  await append({ type: 'item_completed', turn_id: 't1', item: { type: 'AgentMessage', id: 'm1', content: [{ type: 'Text', text: '**正在检查设计文件**\n\n- 保留已有答案\n- 检查页面内容' }] } })
  await browser('open', f.server.url)
  await browser('wait', '--fn', 'document.body.innerText.includes("帮助用户整理设计成果") && document.body.innerText.includes("正在检查设计文件")')
  // This scenario asserts Chinese labels. Select the real UI preference rather
  // than assuming the headless browser's default language is Chinese.
  await browser('click', '.companion-sidebar-bottom > button:last-of-type')
  await browser('wait', '.companion-settings-dialog[open]')
  await browser('select', '#companion-language', 'zh')
  await browser('find', 'role', 'button', 'click', '--name', '关闭设置', '--exact')
  console.log(await browser('snapshot', '-i'))
  const readWorkspace = f.server.project.readWorkspace
  let release, enter
  const entered = new Promise(resolve => { enter = resolve })
  const held = new Promise(resolve => { release = resolve })
  f.server.project.readWorkspace = async (...args) => { enter(); await held; return readWorkspace(...args) }
  try {
    await entered
    await append({ type: 'item_completed', item: { type: 'UserMessage', id: 'user-before-action',
      content: [{ type: 'Text', text: '用户消息无需等下一次 Agent 操作' }] } })
    await browser('wait', '--fn', 'document.querySelector(".companion-conversation-history").textContent.includes("用户消息无需等下一次 Agent 操作")')
    assert.equal(f.messages.length, 0, 'native observation never sends a model message')
  } finally { release(); f.server.project.readWorkspace = readWorkspace }
  await append({ type: 'item_completed', item: { type: 'CommandExecution', id: 'tool-1', status: 'failed' } })
  await append({ type: 'item_completed', item: { type: 'CommandExecution', id: 'tool-2', status: 'completed' } })
  await browser('wait', '--fn', 'document.querySelector(".companion-activity summary")?.textContent.includes("2 项操作")')
  assert.match(await browser('eval', 'document.querySelector(".companion-activity").open && !!document.querySelector(".companion-conversation header .companion-spinner") && document.querySelector(".companion-activity summary").textContent.includes("有失败记录")'), /true/)
  await browser('click', '.companion-activity summary')
  await append({ type: 'item_completed', item: { type: 'CommandExecution', id: 'tool-3', status: 'completed' } })
  await browser('wait', '--fn', 'document.querySelector(".companion-activity summary")?.textContent.includes("3 项操作")')
  assert.match(await browser('eval', '!document.querySelector(".companion-activity").open && document.querySelectorAll(".companion-activity article").length === 3'), /true/, 'manual collapse survives polling')
  await browser('click', '.companion-activity summary')
  await append({type:'task_complete'})
  await browser('wait','--fn','!document.querySelector(".companion-activity").open && !document.querySelector(".companion-conversation header .companion-spinner")')
  await browser('click','.companion-activity summary')
  await append({type:'task_started'})
  await browser('wait','--fn','document.querySelector(".companion-activity").open && !!document.querySelector(".companion-conversation header .companion-spinner")')
  await appendFile(f.options.transcriptPath, JSON.stringify({type:'response_item',payload:{type:'function_call',
    name:'request_user_input',call_id:'next-step',arguments:JSON.stringify({questions:[{id:'next',question:'继续梳理流程，还是调整功能？',
      options:[{label:'梳理流程',description:'明确使用路径'},{label:'调整功能',description:'先修正范围'}]}]})}})+'\n')
  await browser('wait','--fn','document.querySelector(".companion-native-question")?.textContent.includes("梳理流程") && document.body.innerText.includes("主对话：等待你回答")')
  assert.match(await browser('eval','!document.querySelector(".companion-conversation header .companion-spinner") && !document.querySelector(".companion-native-question").closest("details")'),/true/)
  await appendFile(f.options.transcriptPath,JSON.stringify({type:'response_item',payload:{type:'function_call_output',call_id:'next-step',output:'private answer'}})+'\n')
  await browser('wait','--fn','document.querySelector(".companion-native-question")?.textContent.includes("调用已结束") && document.body.innerText.includes("主对话：运行中")')
  assert.match(await browser('eval', 'Math.abs(document.querySelector(".companion-conversation").getBoundingClientRect().width/document.querySelector(".companion-content").getBoundingClientRect().width-.3)<.01'), /true/)
  await browser('click', '[role=separator]')
  await browser('press', 'ArrowRight')
  assert.match(await browser('eval', 'document.querySelector("[role=separator]").getAttribute("aria-valuenow")'), /32/)
  await browser('press', 'Home')
  await browser('find', 'role', 'button', 'click', '--name', '设置', '--exact')
  await browser('wait', 'dialog[open]')
  await browser('fill', 'input[aria-label="最大建议数"]', '4')
  await browser('find', 'role', 'button', 'click', '--name', '保存设置', '--exact')
  await browser('find', 'role', 'button', 'click', '--name', '打开 Studio', '--exact')
  await browser('wait', '--fn', 'document.querySelector(".companion-studio-dialog[open]")?.innerText.includes("web_app")')
  await browser('find', 'role', 'button', 'click', '--name', '关闭 Studio', '--exact')
  for (const width of [768, 390]) {
    await browser('set', 'viewport', String(width), '850')
    assert.match(await browser('eval', 'document.querySelector(".companion-conversation").clientWidth===document.querySelector(".companion-content").clientWidth && document.documentElement.scrollWidth<=innerWidth'), /true/, `narrow layout at ${width}`)
  }
  await browser('set', 'viewport', '1280', '900')
  const initial = await browser('eval', `JSON.stringify({sheets:[...document.querySelectorAll('style[data-plugin-css]')].filter(s=>s.dataset.pluginCss.startsWith('design-companion/design.tw.css:')).length,theme:getComputedStyle(document.querySelector('.dsh-design-root')).getPropertyValue('--ds-brand-bg-default').trim(),bold:!!document.querySelector('.companion-conversation strong'),list:!!document.querySelector('.companion-conversation ul'),fits:document.documentElement.scrollWidth<=innerWidth})`)
  assert.match(initial, /\\?"sheets\\?":2/)
  assert.match(initial, /\\?"fits\\?":true/)
  assert.ok(!initial.includes('"theme":""'), initial)
  assert.match(initial, /\\?"list\\?":true/)
  assert.match(await browser('get', 'text', 'body'), /主对话：运行中/)
  await browser('network', 'route', `${f.server.origin}/api`, '--abort')
  await browser('wait', '--fn', 'document.body.innerText.includes("会话同步已断开")')
  assert.ok(!(await browser('get', 'text', 'body')).includes('主对话：状态同步中'), 'unknown must not imply live synchronization')
  assert.match(await browser('get', 'text', '.companion-conversation-history'), /正在检查设计文件/)
  await browser('network', 'unroute', `${f.server.origin}/api`)
  await browser('wait', '--fn', 'document.body.innerText.includes("主对话：运行中") && !document.body.innerText.includes("会话同步已断开") && !document.querySelector(".companion-error")')
  // No DOM/state injection: append native-format records and let normal polling render them.
  for (let i = 0; i < 25; i++) await append({ type: 'item_completed', turn_id: 't1', item: { type: 'AgentMessage', id: `message-${i}`, content: [{ type: 'Text', text: `第 ${i} 条更新：保留用户输入与当前设计文件。` }] } })
  await browser('wait', '--fn', 'document.body.innerText.includes("第 24 条更新")')
  await browser('wait', '--fn', `(()=>{const x=document.querySelector('.companion-conversation-history');return x.scrollHeight-x.scrollTop-x.clientHeight<10})()`)
  await browser('scroll', 'up', '350', '--selector', '.companion-conversation-history')
  await append({ type: 'item_completed', turn_id: 't1', item: { type: 'AgentMessage', id: 'last', content: [{ type: 'Text', text: '最新记录：检查结束。' }] } })
  await append({ type: 'task_complete', turn_id: 't1' })
  await browser('wait', '--fn', 'document.querySelector(".companion-connection-popover")?.textContent.includes("本轮已结束")')
  assert.match(await browser('eval', `(()=>{const x=document.querySelector('.companion-conversation-history');return x.scrollHeight-x.scrollTop-x.clientHeight>100})()`), /true/)
  // Collapse without unmounting: preserve the chat draft, manual scroll and Panel editing state.
  await browser('fill', 'textarea[aria-label="发送给当前 Codex 会话"]', '暂未发送的草稿')
  const position = Number((await browser('eval', 'document.querySelector(".companion-conversation-history").scrollTop')).trim())
  const panelWidth = Number((await browser('eval', 'document.querySelector(".dsh-design-dock").clientWidth')).trim())
  await browser('find', 'role', 'button', 'click', '--name', '关闭对话区域', '--exact')
  await browser('wait', '--fn', 'document.querySelector(".companion-conversation").hidden')
  assert.ok(Number((await browser('eval', 'document.querySelector(".dsh-design-dock").clientWidth')).trim()) > panelWidth + 200)
  await browser('find', 'role', 'button', 'click', '--name', '收起侧边栏', '--exact')
  assert.match(await browser('eval', 'document.querySelector(".companion-sidebar").clientWidth < 70'), /true/)
  assert.match(await browser('eval', 'document.querySelector(".dsh-design-dock").getBoundingClientRect().top === 0'), /true/, 'no duplicate headers above the native workspace')
  await append({ type: 'item_completed', turn_id: 't1', item: { type: 'AgentMessage', id: 'while-hidden', content: [{ type: 'Text', text: '收起时收到的记录' }] } })
  await browser('wait', '--fn', 'document.querySelector(".companion-conversation").textContent.includes("收起时收到的记录")')
  if (process.env.COMPANION_SCREENSHOT) await browser('screenshot', process.env.COMPANION_SCREENSHOT.replace('.png', '-collapsed.png'))
  await browser('find', 'role', 'button', 'click', '--name', '展开对话', '--exact')
  await browser('wait', '--fn', '!document.querySelector(".companion-conversation").hidden')
  assert.match(await browser('eval', 'document.querySelector(".companion-conversation textarea").value'), /暂未发送的草稿/)
  assert.ok(Math.abs(Number((await browser('eval', 'document.querySelector(".companion-conversation-history").scrollTop')).trim()) - position) < 10, 'manual reading position survives hidden updates')
  await browser('find', 'role', 'button', 'click', '--name', '展开侧边栏', '--exact')
  assert.match(await browser('eval', 'document.querySelector(".companion-sidebar").clientWidth > 150'), /true/)
  if (process.env.COMPANION_SCREENSHOT) await browser('screenshot', process.env.COMPANION_SCREENSHOT)
  await browser('scroll', 'down', '10000', '--selector', '.companion-conversation-history')
  await browser('find', 'role', 'button', 'click', '--name', '收起对话', '--exact')
  await append({ type: 'item_completed', turn_id: 't1', item: { type: 'AgentMessage', id: 'hidden-tail', content: [{ type: 'Text', text: '重新展开时跟随最新记录' }] } })
  await browser('wait', '--fn', 'document.querySelector(".companion-conversation").textContent.includes("重新展开时跟随最新记录")')
  await browser('find', 'role', 'button', 'click', '--name', '展开对话', '--exact')
  await browser('wait', '--fn', `(()=>{const x=document.querySelector('.companion-conversation-history');return x.scrollHeight-x.scrollTop-x.clientHeight<10})()`)
  await browser('fill', 'textarea[aria-label="发送给当前 Codex 会话"]', '请读取我的新答案')
  await browser('find', 'role', 'button', 'click', '--name', '发送到 Codex', '--exact')
  await browser('wait', '--fn', 'document.body.innerText.includes("Codex 已将通知入队")')
  assert.equal(f.messages.length, 1)
  assert.match(f.messages[0], /请读取我的新答案/)
  assert.ok(!(await browser('errors')).includes('Error'))
  console.log('CONVERSATION BROWSER OK: independent history while workspace is blocked, styles, Markdown, native records, disconnect recovery, tail/manual scroll, sidebar/chat collapse with draft+scroll preservation, no duplicate headers, same-thread send (mock transport).')
} finally { await browser('close').catch(() => {}); await f.close() }
