/** Built React 18 client + real Runtime gates; isolated native transport fixture. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'

const f = await fixture({ withTranscript: true, researchMode: 'main', serverOptions: {
  browserAccess: 'local', staticRoot: fileURLToPath(new URL('../dist', import.meta.url)),
  indexPath: fileURLToPath(new URL('../index.html', import.meta.url)),
} })
let browser
const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
const state = { rounds: { 'R-001': { round_id: 'R-001', stage: 'identified', topic: 'Continuation evidence',
  directions: { 'D-001': { direction_id: 'D-001', title: 'Literature', research_points: ['Find primary evidence'] } },
  direction_order: ['D-001'] } }, round_order: ['R-001'], current_round_id: 'R-001' }
const errors = [], methods = [], sends = []
const evidence = process.env.COMPANION_EVIDENCE
try {
  browser = await chromium.launch({ headless: true })
  await mkdir(join(f.options.projectRoot, 'design_files/research'), { recursive: true })
  const researchPath = join(f.options.projectRoot, 'design_files/research/research.json')
  await writeFile(researchPath, JSON.stringify(state))
  const gate = async () => {
    const invocation = await call('beginMainBundle', { skill: 'research' })
    assert.equal((await call('finishMainBundle', { invocationId: invocation.invocationId, scope: 'state', outcome: 'pause' })).accepted, true)
    const descriptor = (await call('readWorkspace')).continuations[0]
    assert.equal(descriptor.invocationId, invocation.invocationId)
    return descriptor
  }
  const first = await gate()
  const questionState = { questions: { q: { prompt: '草稿保护问题', kind: 'text', answer: '已保存答案', detail: '' } } }
  await mkdir(join(f.options.projectRoot, 'design_files/smart_questions'), { recursive: true })
  await writeFile(join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json'), JSON.stringify(questionState))
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, locale: 'zh-CN' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (request.method() !== 'POST') return
    try { const body = request.postDataJSON(); methods.push(body.method); if (body.method === 'sendPrompt') sends.push(body.params) } catch {}
  })
  const bar = page.getByTestId('dsh-design-continuation-bar')
  const go = page.getByTestId('dsh-design-continuation-continue')
  const ready = () => page.waitForFunction(() => document.querySelector('[data-testid=dsh-design-continuation-continue]')?.disabled === false)
  await page.goto(f.server.url + '?view=panel-only')
  await ready()
  assert.equal(await bar.count(), 1)
  assert.equal(await go.innerText(), first.label.zh)
  assert.equal(await page.getByTestId('dsh-design-continuation-adjust').count(), 0)
  assert.equal(await page.locator('.companion-conversation').count(), 0)
  assert.equal(methods.includes('readConversation'), false)
  assert.equal(sends.length, 0, 'opening a pending gate never submits')

  // A real shared editor/barrier must inhibit continuation without saving for the user.
  await page.getByText('已保存答案', { exact: true }).waitFor()
  const answer = page.getByRole('textbox', { name: '草稿保护问题', exact: true })
  if (!await answer.isVisible()) {
    const edit = page.getByRole('button', { name: '编辑', exact: true })
    await edit.focus()
    await edit.press('Enter')
  }
  await answer.fill('尚未保存的答案')
  await page.waitForFunction(() => document.querySelector('[data-testid=dsh-design-continuation-continue]')?.disabled === true)
  assert.match(await bar.innerText(), /保存或撤回/)
  assert.equal(sends.length, 0)
  await answer.fill('已保存答案')
  await ready()
  if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'panel-only-continuation.png') }) }

  // Same descriptor, full view: one entry above the composer, real Adjust focus, retained draft.
  await page.goto(f.server.url + '?view=full')
  await ready()
  const composer = page.locator('[data-composer-card] textarea')
  await composer.fill('保留原会话草稿')
  await page.getByTestId('dsh-design-continuation-adjust').click()
  assert.equal(await composer.inputValue(), '保留原会话草稿')
  assert.equal(await composer.evaluate(node => node === document.activeElement), true)
  assert.equal(await bar.evaluate(node => node.nextElementSibling?.hasAttribute('data-composer-card')), true)
  await page.getByRole('button', { name: '关闭对话区域', exact: true }).click()
  assert.equal(await bar.count(), 1)
  assert.equal(await bar.evaluate(node => node.parentElement.classList.contains('dsh-design-dock')), true)
  assert.equal(await page.getByTestId('dsh-design-continuation-adjust').count(), 0)
  await page.getByTestId('dsh-design-continuation-later').click()
  await page.getByRole('button', { name: '展开对话', exact: true }).click()
  assert.equal(await bar.count(), 0, 'collapse/expand must not undo Later')
  assert.equal(await composer.inputValue(), '保留原会话草稿')
  // Observe a completed polling cycle, not a fixed sleep.
  await page.waitForResponse(response => response.request().postData()?.includes('readWorkspace') === true)
  assert.equal(await bar.count(), 0, 'polling must not undo Later')
  const second = await gate()
  assert.notEqual(second.invocationId, first.invocationId)
  await ready()
  assert.equal(await bar.count(), 1, 'a different invocation resurfaces the same route')
  assert.equal(await composer.inputValue(), '保留原会话草稿')
  if (evidence) await page.screenshot({ path: join(evidence, 'full-continuation.png') })

  // Lost response after actual server submission: the UI cannot infer non-delivery.
  let intercept = true
  await page.route('**/api', async route => {
    if (route.request().postDataJSON()?.method !== 'sendPrompt' || !intercept) return route.continue()
    intercept = false
    await route.fetch()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: false, status: 'unknown' }) })
  })
  await go.click()
  await page.waitForFunction(() => document.body.innerText.includes('通知送达未确认'))
  await page.waitForFunction(() => document.querySelector('[data-testid=dsh-design-continuation-bar]')?.textContent.includes('不会自动重发'))
  assert.equal(sends.length, 1)
  assert.equal(sends[0].text, second.label.zh)
  assert.ok(sends[0].requestId, 'normal request identity is supplied')
  assert.equal(f.messages.length, 1, 'one real server admission to the fixture transport')
  assert.equal(await composer.inputValue(), '保留原会话草稿')
  await go.evaluate(node => { node.click(); node.click() })
  await page.waitForResponse(response => response.request().postData()?.includes('readWorkspace') === true)
  assert.equal(sends.length, 1, 'disabled clicks and polling do not replay an unknown receipt')
  await page.reload()
  await page.locator('.dsh-design-tabs').waitFor()
  await page.waitForResponse(response => response.request().postData()?.includes('readWorkspace') === true)
  assert.equal(sends.length, 1, 'refresh does not automatically replay a request')
  assert.deepEqual(JSON.parse(await readFile(researchPath, 'utf8')), state, 'Host actions never rewrite Bundle stages')

  // Access guard: retain the real Runtime descriptor but project a recovery read.
  const third = await gate()
  const english = await browser.newContext({ viewport: { width: 760, height: 850 }, locale: 'en-US' })
  try {
    const localized = await english.newPage()
    await localized.goto(f.server.url + '?view=panel-only')
    await localized.getByTestId('dsh-design-continuation-bar').waitFor()
    assert.equal(await localized.getByTestId('dsh-design-continuation-continue').innerText(), third.label.en)
    assert.equal(await localized.getByTestId('dsh-design-continuation-adjust').count(), 0)
  } finally { await english.close() }
  assert.equal(f.messages.length, 1, 'reading another locale never submits')
  const readWorkspace = f.server.project.readWorkspace.bind(f.server.project)
  f.server.project.readWorkspace = async (...args) => {
    const value = await readWorkspace(...args)
    return { ...value, access: { ...value.access, writable: false, mode: 'recovery' } }
  }
  await page.goto(f.server.url + '?view=panel-only')
  await bar.waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid=dsh-design-continuation-bar]')?.textContent.includes('只读'))
  assert.equal(await go.isDisabled(), true)
  assert.equal(sends.length, 1)
  f.server.project.readWorkspace = readWorkspace
  const trialRead = page.waitForResponse(response => response.request().postData()?.includes('readWorkspace') === true)
  await page.goto(f.server.url + '?view=trial-panel')
  await trialRead
  await page.locator('.companion-root').waitFor()
  assert.equal(await bar.count(), 0, 'Studio trial/demo must not offer original-conversation execution')
  assert.equal(sends.length, 1)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'PASS', gates: [first.invocationId, second.invocationId, third.invocationId], sends: sends.length,
    checks: ['panel-only', 'full placement', 'Adjust focus + draft', 'dirty editor barrier', 'Later polling + collapse',
      'new invocation', 'unknown no replay', 'refresh no replay', 'bilingual action', 'read-only', 'trial exclusion', 'canonical unchanged'],
    boundary: 'built client + real Core/Companion; native transport mocked; no installed Host validation' }, null, 2))
} finally {
  try { await browser?.close() }
  finally { await f.close() }
}
