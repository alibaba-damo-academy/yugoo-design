#!/usr/bin/env node
/** Real Chromium pointer-drag regression for the Smart Questions splitter. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const execFileAsync = promisify(execFile)
const root = new URL('../..', import.meta.url).pathname
const output = await mkdtemp(join(tmpdir(), 'dsh-resizable-pointer-'))
let browser
let server

try {
  await execFileAsync('pnpm', [
    'exec', 'tsdown',
    '--config', 'packages/provider-web-app/fixtures/tsdown.config.ts',
    '--out-dir', output,
    '--logLevel', 'error',
  ], { cwd: root })
  const fixtureBundle = await readFile(join(output, 'resizable-pointer.js'), 'utf8')
  assert.doesNotMatch(fixtureBundle, /react-resizable-panels\.edge-light\.js/)
  assert.match(fixtureBundle, /react-resizable-panels\.browser\.js/)
  const styles = await Promise.all([
    readFile(join(root, 'packages/panel/src/client/generated/design.tw.css'), 'utf8'),
    readFile(join(root, 'packages/provider-web-app/src/client/generated/design.tw.css'), 'utf8'),
    readFile(join(root, 'packages/provider-web-app/src/client/ported/design/panel-shared.css'), 'utf8'),
  ])
  await writeFile(join(output, 'resizable-pointer.css'), styles.join('\n'))
  await writeFile(join(output, 'index.html'), [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<link rel="stylesheet" href="/resizable-pointer.css">',
    '<div id="root"></div>',
    '<script type="module" src="/resizable-pointer.js"></script>',
  ].join('\n'))
  server = createServer(async (request, response) => {
    if (request.url === '/favicon.ico') {
      response.statusCode = 204
      response.end()
      return
    }
    const pathname = request.url === '/' ? '/index.html' : request.url
    const file = join(output, pathname.slice(1))
    try {
      const content = await readFile(file)
      response.setHeader('content-type', pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.js') ? 'text/javascript' : 'text/html')
      response.end(content)
    } catch {
      response.statusCode = 404
      response.end('not found')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')

  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] }).catch(() =>
    chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-dev-shm-usage'] }))
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message) })
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`http://127.0.0.1:${address.port}`)

  const navigation = page.locator('#smart-question-round-sidebar-navigation')
  const handle = page.locator('#smart-question-round-sidebar-resize-handle')
  await page.locator('[data-testid="chat-design-tab-dummy"][data-state="active"]').waitFor()
  assert.equal(await navigation.count(), 0, 'inactive Smart Questions panel must not be mounted')
  await page.locator('[data-testid="chat-design-tab-smart_questions"]').click()
  await navigation.waitFor()
  await page.locator('[data-tip-id="tip_qa_edit_answer"]').first().click({ force: true })
  await page.getByText('团队用户', { exact: true }).click({ force: true })
  await page.locator('[data-testid="chat-design-tab-dummy"]').click()
  assert.equal(await navigation.count(), 0, 'Smart Questions panel must unmount after switching away')
  await page.locator('[data-testid="chat-design-tab-smart_questions"]').click()
  await navigation.waitFor()
  await page.getByText('团队用户', { exact: true }).waitFor()
  await page.waitForTimeout(100)
  const before = await navigation.boundingBox()
  const handleBox = await handle.boundingBox()
  assert.ok(before !== null && handleBox !== null)
  // Exercise the promised 12px hit affordance, not the one-pixel visual rule.
  // The right edge is where real users miss when the pseudo-element paints
  // outside the primitive's registered bounding box.
  const x = handleBox.x + handleBox.width / 2 + 6
  const y = handleBox.y + handleBox.height / 2
  await page.mouse.move(x, y)
  const hit = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y)
    return {
      id: element?.id ?? null,
      tag: element?.tagName ?? null,
      handleState: document.querySelector('#smart-question-round-sidebar-resize-handle')?.getAttribute('data-resize-handle-state') ?? null,
    }
  }, { x, y })

  assert.equal(hit.handleState, 'hover', `expanded hit area did not activate the handle: ${JSON.stringify(hit)}`)
  await page.mouse.down()
  const downState = await handle.evaluate(element => ({
    state: element.getAttribute('data-resize-handle-state'),
    active: element.getAttribute('data-resize-handle-active'),
  }))
  await page.mouse.move(x + 10, y)
  const firstMove = await handle.evaluate(element => ({
    state: element.getAttribute('data-resize-handle-state'),
    active: element.getAttribute('data-resize-handle-active'),
  }))
  assert.deepEqual(downState, { state: 'drag', active: 'pointer' })
  assert.deepEqual(firstMove, { state: 'drag', active: 'pointer' })
  await page.mouse.move(x + 100, y, { steps: 9 })
  await page.mouse.up()
  const after = await navigation.boundingBox()
  assert.ok(after !== null)
  assert.ok(after.width >= before.width + 60, `pointer drag did not widen navigation: ${before.width} -> ${after.width}; hit=${JSON.stringify(hit)}`)
  assert.deepEqual(errors, [])
  console.log(`SMART QUESTIONS TAB-SWITCH POINTER DRAG OK: ${before.width.toFixed(1)}px -> ${after.width.toFixed(1)}px; down=${downState.state}/${downState.active}; firstMove=${firstMove.state}/${firstMove.active}`)
} finally {
  await browser?.close()
  if (server !== undefined) await new Promise(resolve => server.close(resolve))
  await rm(output, { recursive: true, force: true })
}
