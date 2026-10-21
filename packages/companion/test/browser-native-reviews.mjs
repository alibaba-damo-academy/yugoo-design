import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'

const run = promisify(execFile), session = `companion-reviews-${process.pid}`
const browser = async (...args) => (await run('agent-browser', ['--session', session, ...args], { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout
const f = await fixture({ withTranscript: true })
const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
try {
  await f.server.project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'initial' })
  const runId = '00000000-0000-4000-8000-000000000020'
  const nativeRun = { runId, parentRunId: threadId, transcriptPath: join(f.root, 'producer.jsonl') }
  for (const item of [
    { type: 'AgentMessage', id: 'before', content: [{ type: 'Text', text: '启动前的消息' }] },
    { type: 'SubAgentActivity', id: 'spawn', kind: 'started', agent_thread_id: runId },
    { type: 'AgentMessage', id: 'after', content: [{ type: 'Text', text: '启动后的后续消息' }] },
  ]) await appendFile(f.options.transcriptPath, JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item } }) + '\n')
  await writeFile(nativeRun.transcriptPath, [
    { type: 'session_meta', payload: { id: runId, cwd: f.options.projectRoot, source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } },
    { type: 'event_msg', payload: { type: 'task_started' } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', id: 'p1', content: [{ type: 'Text', text: '**Producer 检查中**\n\n- 保留文件事实' }] } } },
  ].map(item => JSON.stringify({ timestamp: new Date().toISOString(), ...item }) + '\n').join(''))
  await call('registerNativeRun', { ...nativeRun, role: 'producer', skill: 'smart_questions', artifactId: 'smart_questions' })
  await browser('open', f.server.url)
  await browser('wait', '--fn', 'document.body.innerText.includes("Producer 检查中")')
  assert.match(await browser('eval', '[...document.querySelectorAll("strong")].some(x=>x.textContent.includes("Producer 检查中"))'), /true/)
  assert.match(await browser('eval', `(()=>{const p=document.querySelector('[data-producer-run]');return !!(p.compareDocumentPosition([...document.querySelectorAll('.companion-conversation article')].find(x=>x.textContent.includes('启动后的后续消息')))&Node.DOCUMENT_POSITION_FOLLOWING)})()`), /true/)
  const task = await call('prepareReview', { profile: 'grounding' })
  const reviewId = '00000000-0000-4000-8000-000000000021'
  const reviewer = { runId: reviewId, parentRunId: threadId, transcriptPath: join(f.root, 'reviewer.jsonl') }
  await writeFile(reviewer.transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: reviewId, cwd: f.options.projectRoot, source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n')
  await call('bindReviewRun', { reviewId: task.reviewId, nativeRun: reviewer })
  await call('submitReview', { reviewId: task.reviewId, nativeRun: reviewer, result: { schemaVersion: 1, inconsistencies: [{
    id: 'audience', facets: ['smart_questions', 'research'], summary: '请核对用户定位', authoritativeReference: 'smart_questions/smart_questions.json', correction: '核对用户定位', affectedFacets: ['smart_questions'],
  }] } })
  await browser('wait', '.dsh-advisory-sidebar-trigger:not(:disabled)')
  await browser('wait', '#dsh-advisory-composer-inbox .dsh-advisory-card')
  // New actionable results open themselves; an unchanged poll must not undo
  // the user's explicit collapse, nor modify their unsent draft.
  await browser('fill', 'textarea', '保留草稿')
  await browser('click', '[aria-label="收起设计建议"]')
  await browser('wait', '1500')
  assert.match(await browser('eval', '!document.querySelector("#dsh-advisory-composer-inbox")'), /true/)
  assert.match(await browser('eval', 'document.querySelector("textarea").value'), /保留草稿/)
  await browser('click', '.dsh-advisory-sidebar-trigger')
  console.log(await browser('snapshot', '-i'))
  await browser('click', '.dsh-advisory-card summary')
  await browser('wait', '--fn', 'document.body.innerText.includes("请核对用户定位")')
  await browser('wait', '.dsh-advisory-expanded-layer')
  const geometry = `(()=>{const layer=document.querySelector('.dsh-advisory-expanded-layer').getBoundingClientRect(), history=document.querySelector('[data-conversation-scroll]').getBoundingClientRect(), composer=document.querySelector('[data-composer-card]').getBoundingClientRect();return Math.abs(layer.left-composer.left)<2&&Math.abs(layer.width-composer.width)<2&&Math.abs(layer.top-history.top)<2&&Math.abs(layer.bottom-composer.top)<2})()`
  assert.match(await browser('eval', geometry), /true/, 'details cover history above composer, not just the small inbox')
  await browser('set', 'viewport', '1440', '950')
  await browser('wait', '--fn', geometry)
  await browser('click', '.dsh-advisory-expanded-layer summary')
  assert.match(await browser('eval', `(()=>{const inbox=document.querySelector('#dsh-advisory-composer-inbox');return inbox.parentElement.matches('.companion-conversation')&&inbox.nextElementSibling.tagName==='FORM'})()`), /true/)
  assert.equal(f.messages.length, 0, 'background review did not queue foreground')
  await browser('set', 'viewport', '390', '850')
  await browser('scroll', 'down', '180', '--selector', '.companion-conversation')
  await browser('click', '.dsh-advisory-card summary')
  await browser('wait', '.dsh-advisory-expanded-layer')
  await browser('wait', '--fn', `(()=>{const l=document.querySelector('.dsh-advisory-expanded-layer').getBoundingClientRect(),c=document.querySelector('.companion-conversation').getBoundingClientRect();return l.top>=c.top-1&&l.bottom<=c.bottom+1&&l.height>0})()`)
  await browser('click', '.dsh-advisory-expanded-layer summary')
  await browser('scroll', 'up', '1000', '--selector', '.companion-conversation')
  assert.match(await browser('eval', 'document.querySelector(".companion-conversation-history").clientHeight>=120'), /true/)
  await browser('scroll', 'down', '80', '--selector', '.companion-conversation-history')
  assert.match(await browser('eval', 'document.querySelector(".companion-conversation-history").scrollTop>0'), /true/)
  await browser('fill', 'textarea[aria-label="发送给当前 Codex 会话"]', '窄屏草稿，不发送')
  await browser('scroll', 'down', '1000', '--selector', '.companion-conversation')
  assert.match(await browser('eval', `(()=>{const chat=document.querySelector('.companion-conversation').getBoundingClientRect(),send=document.querySelector('.companion-conversation button[type=submit]').getBoundingClientRect(),panel=document.querySelector('.dsh-design-dock').getBoundingClientRect();return send.top>=chat.top&&send.bottom<=chat.bottom&&!!document.elementFromPoint(send.x+send.width/2,send.y+send.height/2)?.closest('button[type=submit]')&&panel.top>=chat.bottom&& !document.elementFromPoint(panel.x+panel.width/2,panel.y+10)?.closest('.companion-conversation')})()`), /true/, 'composer reachable without covering Panel')
  await browser('scroll', 'up', '250', '--selector', '.companion-conversation')
  await browser('scroll', 'down', '200', '--selector', '#dsh-advisory-composer-inbox')
  await browser('scroll', 'down', '100', '--selector', '.companion-conversation')
  await browser('click', '[aria-label^="Defer advisory"]')
  await browser('wait', '--fn', '!document.querySelector("#dsh-advisory-composer-inbox")')
  assert.equal(f.messages.length, 0, 'reaching and deferring the narrow advisory does not send foreground work')
  await browser('set', 'viewport', '1440', '950')
  await browser('click', '[aria-label="关闭对话区域"]')
  const nextTask = await call('prepareReview', { profile: 'alignment' })
  const nextReviewer = { runId: '00000000-0000-4000-8000-000000000022', parentRunId: threadId, transcriptPath: join(f.root, 'next-reviewer.jsonl') }
  await writeFile(nextReviewer.transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: nextReviewer.runId, cwd: f.options.projectRoot, source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n')
  await call('bindReviewRun', { reviewId: nextTask.reviewId, nativeRun: nextReviewer })
  await call('submitReview', { reviewId: nextTask.reviewId, nativeRun: nextReviewer, result: { schemaVersion: 1, questions: [{
    id: 'scope', facets: ['smart_questions'], decision: '研究边界', question: '是否保留个人使用边界？', rationale: '避免混入团队协作假设', impact: '影响角色与功能划分',
  }] } })
  await browser('wait', '--fn', '!document.querySelector("#companion-conversation").hidden && !!document.querySelector("#dsh-advisory-composer-inbox")')
  assert.match(await browser('eval', 'document.querySelector("textarea").value'), /窄屏草稿，不发送/)
  await browser('click', '.dsh-advisory-card summary')
  await browser('wait', '--fn', geometry)
  console.log(await browser('screenshot', `/tmp/companion-advisory-${process.pid}.png`))
  await browser('click', '[aria-label="收起对话"]')
  await browser('wait', '--fn', '!document.querySelector(".dsh-advisory-expanded-layer")')
  assert.equal(f.messages.length, 0, 'new result only changes local presentation, never wakes foreground')
  await browser('click', '[aria-label="展开对话"]')
  await browser('fill', 'textarea', '键盘测试')
  await browser('press', 'Shift+Enter')
  assert.match(await browser('eval', 'document.querySelector("textarea").value.includes("\\n")'), /true/)
  await browser('eval', 'document.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown", {key:"Enter",isComposing:true,bubbles:true}))')
  assert.equal(f.messages.length, 0, 'Shift+Enter and IME confirmation never send')
  await browser('press', 'Enter')
  await browser('wait', '--fn', 'document.querySelector("textarea").value === "" && !!document.querySelector(".companion-feedback")')
  assert.equal(f.messages.length, 1, 'plain Enter sends exactly once')
  await browser('wait', '--fn', '!document.querySelector(".companion-feedback")')
  f.failNotification(true)
  await browser('fill', 'textarea', '失败后保留草稿')
  await browser('press', 'Enter')
  await browser('wait', '--fn', '!!document.querySelector(".companion-feedback [role=alert]")')
  await browser('wait', '5200')
  assert.match(await browser('eval', '!!document.querySelector(".companion-feedback [role=alert]") && document.querySelector("textarea").value === "失败后保留草稿"'), /true/, 'failure remains visible and draft is retained')
  assert.ok(!(await browser('errors')).includes('Error'))
  console.log('NATIVE REVIEW BROWSER OK: Producer Markdown logs and background advisory card render through real HTTP/file polling; no foreground notification.')
} finally { await browser('close').catch(() => {}); await f.close() }
