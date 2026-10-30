import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserTransport, resolveBrowserAccess, resolveBrowserDefaultView, companionView, browserMethods, browserRequestAllowed } from '../src/browser-access.mjs'

test('explicit page views override the adapter default without changing special routes', () => {
  assert.equal(resolveBrowserDefaultView(), 'full')
  assert.equal(resolveBrowserDefaultView('panel-only'), 'panel-only')
  for (const value of [false, true, null, '', 'design', 'studio', 'trial-panel']) {
    assert.throws(() => resolveBrowserDefaultView(value), /browserDefaultView/)
  }
  for (const defaultView of ['full', 'panel-only']) {
    for (const value of [null, undefined]) assert.equal(companionView(value, defaultView), defaultView)
    for (const value of ['panel-only', 'design']) assert.equal(companionView(value, defaultView), 'panel-only')
    for (const value of ['full', 'studio', 'trial-panel', '', 'unknown']) assert.equal(companionView(value, defaultView), 'full')
  }
  assert.equal(companionView(null), 'full', 'older pages without host metadata remain compatible')
  assert.equal(companionView(null, 'invalid'), 'full', 'malformed page metadata does not select the embedded layout')
})

test('browser access defaults remain compatible and invalid modes fail closed', () => {
  assert.equal(resolveBrowserAccess(), 'token')
  assert.equal(resolveBrowserAccess('local'), 'local')
  for (const value of [false, true, null, '', 'off', 'LOCAL']) assert.throws(() => resolveBrowserAccess(value))
  for (const method of [
    'prepareBundle', 'registerNativeRun', 'finishNativeRun', 'beginMainBundle', 'finishMainBundle',
    'prepareReview', 'prepareReviews', 'bindReviewRun', 'bindReviewRuns', 'submitReview',
    'readReviewAction', 'selectReviewAction', 'claimReviewAction', 'settleReviewAction',
    'prepareContentUpgrade', 'readContentUpgradeDefinition', 'listContentUpgradeFiles',
    'readContentUpgradeFile', 'writeContentUpgradeFile', 'validateContentUpgrade',
    'finishContentUpgrade', 'recoverContentUpgrade', 'submitTrialInput',
    'prepareAutoPanel', 'submitAutoPanel', 'studioAuthoringPrepareChanges', 'constructor',
  ]) {
    assert.equal(browserMethods.has(method), false, method)
  }
})

test('fresh local pages and refreshed pages need no browser storage or token', () => {
  const path = '/browser/' + '1'.repeat(32) + '/'
  const storage = { getItem() { throw Error('must not read storage') }, setItem() { throw Error('must not write storage') } }
  const expected = { endpoint: path + 'api', headers: { 'X-Design-Browser': '1' } }
  for (const search of ['', '?view=panel-only', '?view=full']) {
    assert.deepEqual(browserTransport({ pathname: path, hash: '', search }, storage), expected)
    assert.deepEqual(browserTransport({ pathname: path, hash: '#irrelevant', search }, undefined), expected)
  }
  assert.throws(() => browserTransport({ pathname: '/browser/stale/', hash: '' }, storage))
})

test('legacy token entry survives refresh and retains fragment when storage is unavailable', () => {
  let saved = ''
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value } }
  const token = 'a'.repeat(64)
  assert.deepEqual(browserTransport({ pathname: '/', hash: '#' + token }, storage), {
    endpoint: '/api', headers: { 'X-Design-Token': token }, removeFragment: true,
  })
  assert.equal(browserTransport({ pathname: '/', hash: '' }, storage).headers['X-Design-Token'], token)
  assert.equal(browserTransport({ pathname: '/', hash: '#' + token }, undefined).removeFragment, false)
})


test('full and panel-only local views admit draft guards and Studio lifecycle operations', () => {
  const origin = 'http://127.0.0.1:32123'
  for (const view of ['full', 'panel-only']) {
    const transport = browserTransport(new URL(`${origin}/browser/${'2'.repeat(32)}/?view=${view}`))
    const headers = { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
      ...Object.fromEntries(Object.entries(transport.headers).map(([key, value]) => [key.toLowerCase(), value])),
    }
    assert.equal(browserRequestAllowed(headers, origin), true, view)
    for (const method of [
      'savePanel', 'decideAdvisory',
      'studioKitFiles', 'studioKitFile', 'studioInstalledPreview',
      'studioInstanceList', 'studioInstanceRead', 'studioInstanceEditCurrent', 'studioInstanceCopy', 'studioInstanceRename',
      'studioInstanceRemove', 'studioInstanceFile', 'studioInstanceSave', 'studioInstancePreview', 'studioInstanceMounts', 'studioInstancePrepareChanges', 'studioInstanceSaveChanges',
      'studioTrialAvailability', 'studioTrialStart', 'studioTrialList', 'studioTrialRead', 'studioTrialStop', 'studioTrialRemove',
      'studioContentExport', 'studioContentReadArchive',
    ]) assert.equal(browserMethods.has(method), true, `${view}: ${method}`)
    // Neither a view choice nor an extra native credential expands browser authority.
    headers['x-design-token'] = 'a'.repeat(64)
    assert.equal(browserMethods.has('submitTrialInput'), false, view)
    assert.equal(browserMethods.has('prepareContentUpgrade'), false, view)
    assert.equal(browserMethods.has('registerNativeRun'), false, view)
    for (const invalid of [{ origin: 'https://outside.invalid' }, { 'x-design-browser': '' },
      { 'content-type': 'text/plain' }, { 'sec-fetch-site': 'cross-site' }]) {
      assert.equal(browserRequestAllowed({ ...headers, ...invalid }, origin), false, `${view}: ${JSON.stringify(invalid)}`)
    }
  }
})

test('shared client RPCs remain reachable through the explicit browser allowlist', async () => {
  const client = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  const methods = new Set([...client.matchAll(/\brpc(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]))
  assert.ok(methods.has('savePanel') && methods.has('readWorkspace') && methods.has('sendPrompt'), 'client RPC extraction must include the shared project operations')
  assert.deepEqual([...methods].filter(method => !browserMethods.has(method)).sort(), [],
    'new browser UI operations need an explicit admission decision; native dispatcher methods are not automatically admitted')
})

// Uses the normal built client, owned projects and the existing mocked native
// transport. Run with COMPANION_BROWSER_TEST=1 node --import tsx --test ... .
if (process.env.COMPANION_BROWSER_TEST === '1') test('built browser entries honor adapter defaults and explicit view routes', { timeout: 120_000 }, async () => {
  const { fixture } = await import('./fixture.mjs')
  const { chromium } = await import('playwright')
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const staticOptions = { browserAccess: 'local', staticRoot: fileURLToPath(new URL('../dist', import.meta.url)), indexPath: fileURLToPath(new URL('../index.html', import.meta.url)) }
  const f = await fixture({ serverOptions: { ...staticOptions, browserDefaultView: 'panel-only' } })
  let browser, ordinary, page
  try {
    const path = join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json')
    const state = { questions: { purpose: { prompt: '测试用途', kind: 'text', answer: '保留已保存内容', detail: '' } } }
    await mkdir(join(f.options.projectRoot, 'design_files/smart_questions'), { recursive: true })
    await writeFile(path, JSON.stringify(state))
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 760, height: 850 }, locale: 'zh-CN' })
    await context.addInitScript(() => { Object.defineProperty(window, 'sessionStorage', { get() { throw Error('storage unavailable') } }) })
    page = await context.newPage()
    const errors = [], methods = []
    context.on('page', entry => entry.on('pageerror', error => errors.push(error.message)))
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.method() === 'POST') { try { methods.push(request.postDataJSON().method) } catch {} } })
    const panel = async () => {
      await page.locator('.dsh-design-tabs').waitFor()
      assert.equal(await page.locator('.companion-root').getAttribute('data-companion-view'), 'panel-only')
      assert.equal(await page.locator('.companion-conversation').count(), 0)
      assert.equal(await page.getByTestId('design-project-header').count(), 0)
      assert.equal(await page.locator('.companion-sidebar').getAttribute('data-collapsed'), 'true')
    }
    await page.goto(f.server.url)
    await panel()
    await page.getByText('保留已保存内容', { exact: true }).waitFor()
    const answer = page.getByRole('textbox', { name: '测试用途', exact: true })
    if (!await answer.isVisible()) await page.getByRole('button', { name: '编辑', exact: true }).click()
    await answer.fill('默认视图中改写答案')
    assert.equal(await answer.inputValue(), '默认视图中改写答案')
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), state, 'editing a draft does not pretend to be a durable save')
    await answer.fill('保留已保存内容')
    await page.reload(); await panel()
    await page.goto('about:blank'); await page.goBack(); await panel()
    assert.equal(methods.includes('readConversation'), false)
    if (process.env.COMPANION_EVIDENCE) {
      await mkdir(process.env.COMPANION_EVIDENCE, { recursive: true })
      await page.screenshot({ path: join(process.env.COMPANION_EVIDENCE, 'adapter-default-panel.png') })
    }
    const full = await context.newPage()
    const history = full.waitForRequest(request => request.postData()?.includes('"readConversation"') === true)
    await full.goto(f.server.url + '?view=full')
    await full.locator('.companion-conversation').waitFor(); await history
    await full.getByTestId('design-project-header').waitFor()
    assert.equal(await full.locator('.companion-root').getAttribute('data-companion-view'), 'full')
    const studio = await context.newPage()
    await studio.goto(f.server.url + '?view=studio')
    await studio.getByRole('button', { name: '内容归档', exact: true }).click()
    await studio.locator('summary').filter({ hasText: '归档 JSON' }).click()
    await studio.getByRole('textbox', { name: '归档 JSON', exact: true }).waitFor()
    const trial = await context.newPage()
    await trial.goto(f.server.url + '?view=trial-panel')
    await trial.getByText('保留已保存内容', { exact: true }).waitFor()
    assert.equal(await trial.locator('.companion-root').getAttribute('data-companion-view'), 'full', 'the explicit trial route bypasses the adapter default')
    assert.equal(await trial.locator('.companion-sidebar').count(), 0, 'trial keeps its dedicated surface')
    assert.equal(await trial.locator('.companion-conversation').count(), 0)
    ordinary = await fixture({ serverOptions: staticOptions })
    await full.goto(ordinary.server.url)
    await full.locator('.companion-conversation').waitFor()
    assert.equal(await full.locator('.companion-root').getAttribute('data-companion-view'), 'full', 'ordinary browser services keep their default')
    assert.deepEqual(f.messages, []); assert.deepEqual(ordinary.messages, [])
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await ordinary?.close()
    await f.close()
  }
})
