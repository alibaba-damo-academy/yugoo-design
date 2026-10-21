/** Uses an isolated browser, real shared Panels + files/Git, and mocked Codex transport. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.mjs'

const run = promisify(execFile)
const session = `companion-smoke-${process.pid}`
const browser = async (...args) => (await run('agent-browser', ['--session', session, ...args], { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout
const f = await fixture()
try {
  const path = join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json')
  await mkdir(join(f.options.projectRoot, 'design_files/smart_questions'), { recursive: true })
  await writeFile(path, JSON.stringify({ questions: { overview: { prompt: '产品目标是什么？', kind: 'text', answer: '原始答案', detail: '' } } }))
  await browser('open', f.server.url)
  await browser('wait', '--fn', 'document.body.innerText.includes("原始答案")')
  console.log(await browser('snapshot', '-i'))
  await browser('find', 'text', 'Edit', 'click')
  await browser('wait', '.dsh-design-dock textarea')
  console.log(await browser('snapshot', '-i'))
  await browser('fill', '.dsh-design-dock textarea', '浏览器保存后的答案')
  await browser('find', 'role', 'button', 'click', '--name', '收起对话', '--exact')
  await browser('find', 'role', 'button', 'click', '--name', '展开对话', '--exact')
  assert.match(await browser('eval', 'document.querySelector(".dsh-design-dock textarea").value'), /浏览器保存后的答案/, 'layout toggles retain the native Panel draft')
  f.failNotification(`test transport disconnected: ${'long-error-detail/'.repeat(80)}`)
  await browser('find', 'role', 'button', 'click', '--name', 'Save and assess next step')
  await browser('wait', '--fn', 'document.body.innerText.includes("通知未确认")')
  assert.match(await browser('eval', `(()=>{const feedback=document.querySelector('.companion-feedback').getBoundingClientRect();const content=document.querySelector('.companion-content').getBoundingClientRect();return feedback.top>=content.bottom && document.documentElement.scrollWidth<=innerWidth})()`), /true/, 'feedback stays below content without covering chat or save controls')
  assert.equal(JSON.parse(await readFile(path, 'utf8')).questions.overview.answer, '浏览器保存后的答案')
  const checkpoint = await f.server.project.store.head()
  f.failNotification(false)
  await browser('find', 'role', 'button', 'click', '--name', '通知 Codex 读取当前文件')
  await browser('wait', '--fn', 'document.body.innerText.includes("Codex 已接收通知")')
  assert.ok(!(await browser('get', 'text', 'body')).includes('test transport disconnected'), 'successful retry clears only the notification error')
  assert.equal(f.messages.length, 1)
  assert.match(f.messages[0], /浏览器保存后的答案/)
  assert.equal(await f.server.project.store.head(), checkpoint)
  const errors = await browser('errors')
  assert.ok(!errors.includes('Error'), errors)
  console.log('COMPANION BROWSER OK: shared native Panel → file/Git save → failed notification → notification-only retry; mock transport, no model run.')
} catch (error) {
  console.error(await browser('snapshot', '-i').catch(() => 'snapshot unavailable'))
  console.error(await browser('errors').catch(() => 'browser errors unavailable'))
  console.error(await browser('get', 'text', 'body').catch(() => 'body unavailable'))
  throw error
} finally {
  await browser('close').catch(() => {})
  await f.close()
}
