/** Rendered geometry regression. Uses an isolated context in Chrome 9222 when supplied. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'
import { chromium } from 'playwright'

const output = await mkdtemp(join(tmpdir(), 'studio-preview-alignment-'))
let browser, context, server
try {
  await build({ config: false, entry: [fileURLToPath(new URL('./preview-alignment-fixture.tsx', import.meta.url))],
    outDir: output, platform: 'browser', format: 'esm', dts: false, clean: false,
    deps: { alwaysBundle: [/./] }, define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  })
  const bundle = await readFile(join(output, 'preview-alignment-fixture.js'))
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    if (request.url === '/fixture.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle); return }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><meta charset="utf-8"><title>Studio preview alignment · UI fixture</title><style>html,body,#root{margin:0;height:100%;width:100%}</style><div id="root"></div><script type="module" src="/fixture.mjs"></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  if (process.env.STUDIO_BROWSER_CDP) {
    const endpoint = new URL(process.env.STUDIO_BROWSER_CDP)
    if (endpoint.protocol === 'http:' || endpoint.protocol === 'https:') {
      const version = await (await fetch(new URL('/json/version', endpoint))).json()
      const socket = new URL(version.webSocketDebuggerUrl); socket.host = endpoint.host
      browser = await chromium.connectOverCDP(socket.href)
    } else browser = await chromium.connectOverCDP(endpoint.href)
  } else browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage(), results = [], errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error('Fixture page error:', error) })
  const geometry = async label => {
    const value = await page.evaluate(() => {
      const split = document.querySelector('.ygd-studio-panel-split')
      const source = split.querySelector('.ygd-studio-source-toolbar') ?? split.querySelector('.ygd-studio-doc-toolbar')
      const preview = split.querySelector('.ygd-studio-preview-toolbar') ?? split.querySelector('.ygd-studio-live-pane>header')
      const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height } }
      return { source: rect(source), preview: rect(preview),
        sourceBody: rect(split.querySelector('.ygd-studio-yaml-pane')), previewBody: rect(split.querySelector('.ygd-studio-live-pane')) }
    })
    assert.ok(value.source.height >= 51, `${label}: shared toolbar height`)
    assert.ok(Math.abs(value.source.bottom - value.preview.bottom) < 0.5, `${label}: divider mismatch ${JSON.stringify(value)}`)
    assert.equal(value.sourceBody.top, value.source.bottom, `${label}: source body meets divider`)
    assert.equal(value.previewBody.top, value.preview.bottom, `${label}: preview body meets divider`)
    assert.ok(value.sourceBody.height > 100 && value.previewBody.height > 100, `${label}: content gets usable space`)
    results.push({ label, ...value })
  }
  for (const locale of ['zh', 'en']) for (const readOnly of [true, false]) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`${origin}/?locale=${locale}${readOnly ? '&readonly' : ''}`)
    await page.locator('textarea[aria-label="panel.yaml"]').waitFor()
    assert.equal(await page.locator('textarea').getAttribute('readonly') !== null, readOnly)
    await geometry(`${locale}:${readOnly ? 'reading' : 'editing'}`)
    await page.setViewportSize({ width: 520, height: 800 })
    await geometry(`${locale}:narrow:${readOnly ? 'reading' : 'editing'}`)
    if (!readOnly) {
      const draft = 'version: 1\nsections: []\n# retained browser draft\n'
      await page.getByRole('textbox', { name: 'panel.yaml', exact: true }).fill(draft)
      await page.getByRole('button', { name: locale === 'zh' ? '对比' : 'Diff', exact: true }).click()
      await page.locator('.ygd-studio-inline-diff').waitFor()
      await geometry(`${locale}:narrow:diff`)
      await page.getByRole('button', { name: locale === 'zh' ? '原始文件' : 'Source Files', exact: true }).click()
      await page.getByRole('button', { name: locale === 'zh' ? '编辑' : 'Edit', exact: true }).click()
      assert.equal(await page.getByRole('textbox', { name: 'panel.yaml', exact: true }).inputValue(), draft)
      await page.getByRole('button', { name: locale === 'zh' ? '面板预览' : 'Panel Preview', exact: true }).click()
      await page.getByRole('button', { name: locale === 'zh' ? '保存' : 'Save', exact: true }).click()
      await page.getByRole('button', { name: locale === 'zh' ? '还原' : 'Revert', exact: true }).waitFor({ state: 'visible' })
      await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => /^(保存|Save)$/.test(button.textContent.trim()))?.disabled)
      await geometry(`${locale}:saved`)
    }
    await page.locator('[data-testid="preview-end"]').scrollIntoViewIfNeeded()
    await geometry(`${locale}:scrolled`)
  }
  for (const locale of ['zh', 'en']) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`${origin}/?catalog&locale=${locale}`)
    await page.getByRole('button', { name: locale === 'zh' ? '技能包' : 'Bundles', exact: true }).click()
    await page.getByRole('button', { name: locale === 'zh' ? '打开' : 'Open', exact: true }).click()
    await page.getByRole('button', { name: locale === 'zh' ? '面板预览' : 'Panel Preview', exact: true }).click()
    await page.getByRole('textbox', { name: 'Panel YAML', exact: true }).waitFor()
    await geometry(`${locale}:catalog`)
    await page.setViewportSize({ width: 720, height: 800 })
    await geometry(`${locale}:catalog:narrow`)
    await page.locator('[data-testid="preview-end"]').scrollIntoViewIfNeeded()
    await geometry(`${locale}:catalog:scrolled`)
  }
  assert.deepEqual(errors, [])
  const result = { status: 'PASS', origin, scope: 'UI fixture; no native Host or durable persistence claim', results }
  if (process.env.STUDIO_ALIGNMENT_RESULT) await writeFile(process.env.STUDIO_ALIGNMENT_RESULT, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
  if (process.env.STUDIO_ALIGNMENT_KEEP_OPEN === '1') {
    console.log(`Studio fixture ready for visual walkthrough: ${origin}`)
    await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve) })
  }
} finally {
  await context?.close()
  // connectOverCDP's close disconnects this transport; it leaves the shared Chrome running.
  await browser?.close()
  await new Promise(resolve => server ? server.close(resolve) : resolve())
  await rm(output, { recursive: true, force: true })
}
