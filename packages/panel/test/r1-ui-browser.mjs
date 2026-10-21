/** Bounded headless source regression; never attaches to the user's 9222 browser. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { chromium } from 'playwright'
import { parsePanelManifest } from '../../core/lib/panel-dsl.js'

const root = new URL('../', import.meta.url).pathname
const output = await mkdtemp(join(tmpdir(), 'r1-ui-browser-'))
const evidence = process.env.UI_TEST_EVIDENCE
if (evidence) await mkdir(evidence, { recursive: true })
const panel = async name => {
  const base = new URL(`../../skills-web-app/bundles/${name}/`, import.meta.url)
  const manifest = parsePanelManifest(await readFile(new URL('panel.yaml', base), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale => [locale,
    JSON.parse(await readFile(new URL(`locales/${locale}.json`, base), 'utf8'))])))
  return manifest
}
const research = await panel('research'), roles = await panel('role_access')
const roleState = JSON.parse(await readFile(new URL('../../skills-web-app/bundles/role_access/reference/preview.json', import.meta.url), 'utf8'))
roleState.roles['R-PREVIEW-A'].title = 'Reader with a deliberately long synthetic role title for narrow-container editing'
const fixture = { panels: { research, roles }, states: { roles: roleState, research: {
  rounds: { R1: { topic: 'Synthetic Research', conclusion_file: 'research/report.md', directions: {
    D1: { title: 'HTML document', findings_file: 'research/report.html', research_points: ['Synthetic point'] },
    D2: { title: 'Delayed document', findings_file: 'research/slow.md', research_points: [] },
  }, direction_order: ['D1', 'D2'] } }, round_order: ['R1'], current_round_id: 'R1',
} }, artifactFiles: { 'research/report.md': 'synthetic-md', 'research/report.html': 'synthetic-html', 'research/slow.md': 'synthetic-slow' }, activities: [
  { artifactId: 'R1', artifactKind: 'research_conclusion', artifactFile: 'research/report.md', skill: 'research', projectId: 'fixture', invocationId: 'fixture', executor: 'main', runId: 'fixture-run', sequence: 1, active: false, available: true, nativeStatus: 'completed', logTarget: { artifactId: 'R1', invocationId: 'fixture' } },
] }
const markdown = '# Research heading\n\n## Main findings\n\nSynthetic long-form text. This deliberately long paragraph remains readable in a narrow tool container, without altering a user-owned HTML document.\n\n### Supporting observation\n\n- First synthetic item\n- Second synthetic item\n\n| Name | Explanation | Another long field |\n|---|---|---|\n| Synthetic | Long unbroken https://example.invalid/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p | Preserved content |\n\n' + Array.from({ length: 12 }, (_, i) => `## Observation ${i + 1}\n\nSynthetic evidence paragraph.\n`).join('\n')
let server, browser
try {
  await promisify(execFile)('pnpm', ['--config.verify-deps-before-run=false', 'exec', 'tsdown', '--config', 'test/visual-browser.config.ts'], {
    cwd: root, maxBuffer: 5e6, env: { ...process.env, VISUAL_TEST_ENTRY: './r1-ui-browser.tsx', VISUAL_TEST_OUT: output },
  })
  server = createServer(async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{margin:0}.dsh-design-panel{height:100%}</style><div id="root"></div><script type="module" src="/fixture.js"></script>'); return }
      if (req.url === '/fixture') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture)); return }
      if (req.url.startsWith('/artifact?')) {
        const url = new URL(req.url, 'http://localhost'), file = url.searchParams.get('path')
        if (file === 'research/slow.md') await new Promise(done => setTimeout(done, 700))
        const html = '<html><style>body{font-size:27px;color:rgb(31,41,51)}h1{font-size:37px}</style><body><h1>Unchanged user HTML</h1><p>Exact owned document</p></body></html>'
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ found: true, content: file.endsWith('.html') ? html : file.includes('slow') ? '# Late stale report' : markdown })); return
      }
      const path = resolve(output, `.${req.url}`)
      if (!path.startsWith(`${output}/`)) throw Error('outside test output')
      res.setHeader('Content-Type', extname(path) === '.css' ? 'text/css' : 'text/javascript')
      res.end(await readFile(path))
    } catch (error) { res.writeHead(400); res.end(String(error)) }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const errors = []; page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.locator('.dsh-artifact-markdown h1').waitFor()
  const measurements = []
  for (const width of [1040, 540, 360]) {
    await page.evaluate(width => window.r1UI.setWidth(width), width)
    await page.waitForTimeout(80)
    const geometry = await page.evaluate(width => {
      const root = document.querySelector('#panel-frame'), md = document.querySelector('.dsh-artifact-markdown')
      const toolbar = document.querySelector('.dsh-document-toolbar'), refresh = toolbar.querySelector('button')
      const h1 = md.querySelector('h1'), h2 = md.querySelector('h2'), log = document.querySelector('[data-execution-log]')
      return { width: root.getBoundingClientRect().width, body: parseFloat(getComputedStyle(md).fontSize), h1: parseFloat(getComputedStyle(h1).fontSize), h2: parseFloat(getComputedStyle(h2).fontSize),
        refreshHeight: refresh.getBoundingClientRect().height, refreshTop: refresh.getBoundingClientRect().top, toolbarBottom: toolbar.getBoundingClientRect().bottom,
        overflow: document.documentElement.scrollWidth > innerWidth, gap: md.getBoundingClientRect().top - log.getBoundingClientRect().bottom }
    })
    assert.ok(geometry.h1 <= geometry.body * 1.44 && geometry.h1 > geometry.h2, JSON.stringify(geometry))
    assert.equal(geometry.body, width === 1040 ? 14 : 13)
    assert.ok(geometry.refreshHeight >= 32 && geometry.refreshTop < geometry.toolbarBottom)
    assert.ok(geometry.gap >= 7 && geometry.gap <= 9, JSON.stringify(geometry))
    assert.equal(geometry.overflow, false)
    measurements.push(geometry)
    if (evidence) await page.screenshot({ path: join(evidence, `research-${width}.png`) })
  }
  const refresh = page.locator('.dsh-document-toolbar button')
  const before = await page.evaluate(() => window.r1UI.reads.length)
  await refresh.focus(); await page.keyboard.press('Enter')
  await page.waitForFunction(previous => window.r1UI.reads.length > previous, before)
  await page.locator('.dsh-artifact-markdown h1').waitFor()
  await page.getByRole('button', { name: 'Delayed document', exact: true }).click()
  await page.getByRole('button', { name: 'Synthetic Research', exact: true }).click()
  await page.waitForTimeout(800)
  assert.equal(await page.locator('.dsh-artifact-markdown h1').textContent(), 'Research heading', 'late read cannot replace current file')
  await page.getByRole('button', { name: 'HTML document', exact: true }).click()
  await page.locator('iframe').waitFor()
  await page.frameLocator('iframe').getByText('Exact owned document').waitFor()
  assert.equal(await page.frameLocator('iframe').locator('h1').evaluate(el => getComputedStyle(el).fontSize), '37px', 'tool density never rewrites user HTML')
  await page.getByRole('button', { name: 'roles', exact: true }).click()
  await page.locator('.dsh-related-record-table table').waitFor()
  assert.equal(await page.locator('.dsh-related-record-table [data-field=capability] > .dsh-design-required-mark').isVisible(), true)
  for (const width of [1040, 540, 360]) {
    await page.evaluate(width => window.r1UI.setWidth(width), width); await page.waitForTimeout(60)
    const geometry = await page.evaluate(width => {
      const table = document.querySelector('.dsh-related-record-table'), header = document.querySelector('.dsh-design-record-header')
      const source = header.querySelector('.dsh-record-parent-inline')
      return { width, scroll: table.scrollWidth, client: table.clientWidth,
        tableContained: table.getBoundingClientRect().right <= document.querySelector('#panel-frame').getBoundingClientRect().right + 1,
        sourceContained: source.getBoundingClientRect().right <= header.getBoundingClientRect().right + 1,
        inputFont: getComputedStyle(table.querySelector('input')).fontSize,
        navigationContained: document.querySelector('.dsh-panel-workspace-tree').getBoundingClientRect().right <= document.querySelector('#panel-frame').getBoundingClientRect().right + 1,
        cellsFit: [...table.querySelectorAll('input:not([type=checkbox])')].every(input => input.getBoundingClientRect().right <= input.closest('td').getBoundingClientRect().right + 1),
        overflow: document.documentElement.scrollWidth > innerWidth }
    }, width)
    assert.ok(geometry.tableContained && geometry.sourceContained && !geometry.overflow, JSON.stringify(geometry))
    assert.ok(geometry.navigationContained, JSON.stringify(geometry))
    assert.ok(geometry.cellsFit, JSON.stringify(geometry))
    assert.equal(geometry.inputFont, width === 1040 ? '14px' : '13px')
    if (width < 600) assert.ok(geometry.scroll > geometry.client, JSON.stringify(geometry))
    if (evidence) await page.screenshot({ path: join(evidence, `roles-${width}.png`) })
  }
  await page.locator('[data-field=capability] input').fill('Edited synthetic capability')
  assert.equal(await page.evaluate(() => window.r1UI.data.roles.policies['AP-PREVIEW-A'].capability), 'Edited synthetic capability')
  await page.locator('[aria-label="Source role"]').focus(); await page.keyboard.press('Enter')
  await page.locator('[role=option]').first().waitFor()
  assert.ok(await page.locator('[role=option]').count() >= 1)
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.r1UI.setReadonly(true))
  assert.equal(await page.locator('.dsh-record-inspector :is(input:not([readonly]),textarea:not([readonly]),button[role=combobox],.dsh-record-related-add)').count(), 0)
  await page.evaluate(() => window.r1UI.setLocale('zh-CN'))
  assert.ok((await page.locator('.dsh-related-record-table thead').textContent()).includes('操作前需要'))
  // Theme-token and enlarged-text stress checks belong to the tool surface,
  // never to an embedded user's HTML. This is not native-zoom certification.
  await page.evaluate(() => {
    const root = document.querySelector('.dsh-design-panel')
    for (const [key, value] of Object.entries({ '--ds-bg-white': '#20232b', '--ds-bg-gary-default': '#292d36', '--ds-fill-1': '#20232b', '--ds-fill-2': '#292d36', '--ds-brand-1': '#303046', '--ds-notice-1': '#252f40', '--ds-text-primary': '#f5f6fa', '--ds-text-secondary': '#c4c9d4', '--ds-text-7': '#c4c9d4', '--ds-line-1': '#4b5260' })) root.style.setProperty(key, value)
  })
  assert.equal(await page.locator('.dsh-design-panel').evaluate(el => getComputedStyle(el).color), 'rgb(245, 246, 250)')
  if (evidence) await page.screenshot({ path: join(evidence, 'roles-dark-360.png') })
  await page.evaluate(() => window.r1UI.setReadonly(false))
  await page.locator('[aria-label="来源角色"]').waitFor()
  await page.evaluate(() => {
    const root = document.querySelector('.dsh-design-panel')
    const targets = [...root.querySelectorAll('input,.dsh-panel-select-trigger,.dsh-design-field-label,.dsh-design-record-header-label,.dsh-record-parent-inline > span,.dsh-record-related-editor > header h3')]
    const sizes = targets.map(el => parseFloat(getComputedStyle(el).fontSize))
    targets.forEach((el, i) => { el.style.fontSize = `${sizes[i] * 2}px`; el.style.lineHeight = '1.5' })
  })
  const enlarged = await page.locator('.dsh-design-record-header').evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight }))
  assert.ok(enlarged.scroll <= enlarged.client + 1, JSON.stringify(enlarged))
  assert.equal(await page.locator('.dsh-record-parent-inline [role=combobox]').isVisible(), true)
  await page.locator('[data-field=capability] input').fill('Enlarged synthetic field')
  assert.equal(await page.evaluate(() => window.r1UI.data.roles.policies['AP-PREVIEW-A'].capability), 'Enlarged synthetic field')
  if (evidence) await page.screenshot({ path: join(evidence, 'roles-enlarged-360.png') })
  assert.deepEqual(errors, [])
  const result = { sourceOnly: true, hostStarted: false, measurements, browserErrors: errors, assertions: 'toolbar/density/headings/narrow table/keyboard/edit/read-only/late-file/HTML preservation/theme/enlarged typography stress', nativeZoomCertified: false }
  if (evidence) await writeFile(join(evidence, 'browser-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { await browser?.close(); await new Promise(done => server ? server.close(done) : done()); await rm(output, { recursive: true, force: true }) }
