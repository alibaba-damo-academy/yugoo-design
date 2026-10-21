/** Production GraphPanel browser contract. Read-only; never writes a project. */
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const { register } = await import('tsx/esm/api'); register()
const { projectGraphFixture } = await import('../core/test/project-graph-fixture.mjs')
const out = await mkdtemp(join(tmpdir(), 'graph-browser-'))
const root = process.argv[2]
let graph
if (process.env.GRAPH_TEST_SNAPSHOT) graph = JSON.parse(await readFile(process.env.GRAPH_TEST_SNAPSHOT, 'utf8'))
if (root) {
  graph = await projectGraphFixture(root, process.argv[4])
  if (process.argv[3]) {
    const report = JSON.parse(await readFile(process.argv[3], 'utf8'))
    assert.equal(report.checkpoint, graph.checkpoint, 'semantic evidence must match project version')
    const units = new Map(graph.semanticUnits.map(unit => [unit.id, unit.digest]))
    assert.equal(report.units.length, units.size)
    for (const unit of report.units) assert.equal(units.get(unit.id), unit.digest, 'semantic content must match current extractor')
    graph.edges.push(...report.result.edges); graph.semantic = report.result.status
  }
  console.log(JSON.stringify({ projectNodes: graph.nodes.length, projectEdges: graph.edges.length, warnings: graph.warnings }))
}

let browser, server, page
try {
  execFileSync('pnpm', ['exec', 'tsdown', '--config', 'test/graph-browser.config.ts'], { cwd: import.meta.dirname, env: { ...process.env, GRAPH_TEST_OUT: out }, stdio: 'pipe' })
  server = createServer(async (req, res) => {
    if (req.url === '/graph.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(graph)); return }
    if (/^\/[\w.-]+\.js$/.test(req.url)) { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(join(out, req.url.slice(1)))); return }
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0;font-family:system-ui}</style><div id="root"></div><script type="module" src="/fixture.js"></script>')
  })
  await new Promise(resolve => server.listen(Number(process.env.GRAPH_BROWSER_PORT ?? 0), '127.0.0.1', resolve))
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.addInitScript(() => {
    const Original = window.Worker
    window.graphWorkers = { created: 0, active: 0 }
    window.graphContexts = new Set()
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const context = getContext.apply(this, args)
      if (context && /^webgl|experimental-webgl/.test(args[0])) window.graphContexts.add(context)
      return context
    }
    window.Worker = class extends Original {
      done = false
      constructor(...args) { super(...args); window.graphWorkers.created++; window.graphWorkers.active++ }
      terminate() { if (!this.done) { this.done = true; window.graphWorkers.active-- }; super.terminate() }
    }
  })
  const url = `http://127.0.0.1:${server.address().port}`
  const openSettings = async () => {
    const trigger = page.getByRole('button', { name: /^视图与筛选/ })
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  }
  const closeSettings = async () => {
    const close = page.getByRole('button', { name: '关闭视图设置' })
    if (await close.count()) await close.click()
  }
  const settle2D = () => page.locator('svg[data-layout-state=settled]').waitFor({ timeout: 30000 })
  const settle3D = () => page.locator('[aria-label="三维关联图"][data-layout-state=settled]').waitFor({ timeout: 30000 })

  await page.setViewportSize({ width: 520, height: 760 })
  await page.goto(url + '/?slow-read')
  await page.locator('.graph-initial-stage').waitFor()
  const pendingLayout = await page.evaluate(() => {
    const view = document.querySelector('.design-graph-view').getBoundingClientRect()
    const stage = document.querySelector('.graph-initial-stage').getBoundingClientRect()
    const footer = document.querySelector('.graph-footer').getBoundingClientRect()
    return { stageHeight: stage.height, footerGap: Math.round(view.bottom - footer.bottom) }
  })
  assert.ok(pendingLayout.stageHeight > 400, 'pending graph read preserves the canvas area in a narrow design dock')
  assert.ok(Math.abs(pendingLayout.footerGap) <= 2, 'pending graph read keeps footer at the panel bottom')
  await page.evaluate(() => window.releaseGraphRead())
  await settle2D()
  await page.setViewportSize({ width: 1100, height: 800 })

  await page.goto(url + '/?reading')
  await settle2D()
  assert.equal(await page.locator('svg line[role=button]').count(), 4, 'different meanings on one pair remain separate')
  await openSettings()
  await page.getByLabel('关系含义').selectOption('supports')
  await page.getByLabel('关系来源').selectOption('embedding')
  assert.equal(await page.locator('svg line[role=button]').count(), 0, 'meaning and origin filters intersect')
  await page.getByLabel('关系来源').selectOption('agent')
  await closeSettings()
  await page.locator('svg line[role=button]').press('Enter')
  assert.match(await page.locator('.graph-relation-detail').innerText(), /supports[\s\S]*Agent 分析[\s\S]*从源端到目标端/)
  await page.getByText('原始证据', { exact: true }).click()
  assert.match(await page.locator('aside').innerText(), /two-endpoint-saved-evidence/)
  await page.getByRole('button', { name: '关闭节点详情' }).click()
  await openSettings()
  await page.getByLabel('关系含义').selectOption('similar')
  await page.getByLabel('关系来源').selectOption('embedding')
  await closeSettings()
  await page.locator('svg line[role=button]').press('Enter')
  assert.match(await page.locator('aside').innerText(), /对称关系（无先后）[\s\S]*不证明依赖或因果关系/)

  await page.goto(url)
  await settle2D()
  assert.equal(await page.getByLabel('邻域深度').count(), 0)
  assert.equal(await page.locator('svg g[role=button]').count(), 2)
  await page.getByRole('button', { name: '展开', exact: true }).click()
  await settle2D()
  assert.equal(await page.locator('svg g[role=button]').count(), 5)
  const containsLine = page.locator('svg line[data-relation-kind="contains"]').first()
  assert.ok(await containsLine.count(), 'expanded records show a parent-child link')
  assert.ok(Number(await containsLine.getAttribute('stroke-opacity')) >= .6, 'parent-child dashes remain visible on the canvas background')
  assert.ok(Number(await containsLine.getAttribute('stroke-width')) >= 1.2, 'parent-child dashes have a legible stroke width')
  await page.locator('svg').getByRole('button', { name: '确认到场人数再开始', exact: true }).click()
  assert.match(await page.locator('aside').innerText(), /event\/event.json[\s\S]*\/plan\/coordination\/rule/)
  await page.getByRole('button', { name: '收起此记录', exact: true }).click()
  assert.equal(await page.locator('svg g[role=button]').count(), 3, 'local collapse preserves other expanded roots')
  await page.getByRole('button', { name: '概览', exact: true }).click()
  await settle2D()

  // Dragging pins only display coordinates; filters and node sizing keep the pin until reset.
  await page.getByRole('button', { name: '展开', exact: true }).click(); await settle2D()
  const target = page.locator('svg').getByRole('button', { name: '主持人职责', exact: true })
  const center = await target.evaluate(element => { const point = new DOMPoint().matrixTransform(element.getScreenCTM()); return { x: point.x, y: point.y } })
  const dragBefore = await target.getAttribute('transform')
  await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x + 70, center.y + 30, { steps: 12 }); await page.mouse.up()
  assert.notEqual(await target.getAttribute('transform'), dragBefore)
  assert.equal(await target.getAttribute('data-pinned'), 'true')
  const pinned = await target.getAttribute('transform')
  await openSettings(); await page.getByLabel('节点大小').selectOption('reach'); await closeSettings()
  assert.equal(await target.getAttribute('transform'), pinned)
  await page.getByRole('button', { name: '解除固定并重新布局', exact: true }).click(); await settle2D()
  assert.equal(await target.getAttribute('data-pinned'), null)

  // One compact drawer owns every display-only control and reports deviations.
  await openSettings()
  assert.equal(await page.getByLabel('布局视角').locator('option').count(), 4)
  assert.equal(await page.getByLabel('图谱布局').locator('option').count(), 2)
  await page.getByLabel('布局视角').selectOption('source')
  await page.getByLabel('节点大小').selectOption('reach')
  await page.getByLabel('显示节点上限').selectOption('500')
  await closeSettings()
  assert.match(await page.getByRole('button', { name: /^视图与筛选/ }).innerText(), /3/)
  assert.match(await page.getByRole('note').innerText(), /同来源柔性靠近[\s\S]*不写回 KAG/)

  // The first 3D import is gated: controls cannot act before a renderer exists.
  let releaseImport, enteredImport
  const gate = new Promise(resolve => { releaseImport = resolve })
  const entered = new Promise(resolve => { enteredImport = resolve })
  await page.route('**/3d-force-graph-*.js', async route => { enteredImport(); await gate; await route.continue() }, { times: 1 })
  await openSettings(); await page.getByLabel('图谱布局').selectOption('stress3'); await closeSettings()
  await Promise.race([entered, new Promise((_, reject) => setTimeout(() => reject(new Error('3D import was not intercepted')), 5000))])
  assert.equal(await page.locator('[aria-label="三维关联图"]').getAttribute('data-layout-state'), 'loading')
  assert.equal(await page.getByLabel('三维投影').isDisabled(), true)
  releaseImport()
  await settle3D()
  assert.ok(Number(await page.locator('[aria-label="三维关联图"]').getAttribute('data-stress-depth')) > 0)
  await page.getByLabel('三维投影').selectOption('orthographic')
  await page.getByRole('button', { name: '显示全部', exact: true }).click()
  assert.equal(await page.locator('canvas').count(), 1)
  await openSettings(); await page.getByLabel('图谱布局').selectOption('stress2'); await closeSettings(); await settle2D()
  assert.equal(await page.locator('canvas').count(), 0)
  assert.ok(await page.evaluate(() => [...window.graphContexts].every(context => context.isContextLost())), 'leaving 3D releases WebGL contexts')

  // Narrow layouts keep the drawer and status popover inside the viewport.
  await page.setViewportSize({ width: 360, height: 740 })
  await openSettings()
  assert.ok(await page.locator('.graph-settings-drawer').evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight }))
  await closeSettings()
  assert.equal(await page.locator('.graph-settings-drawer').count(), 0)
  await page.getByText(/^状态详情/).click()
  assert.ok(await page.locator('.graph-popover[open] .graph-popover-body').evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight }))
  await page.locator('.graph-popover[open]').press('Escape')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)

  // Status-only refresh keeps the settled graph and camera intact.
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto(url + '/?status'); await settle2D()
  const cameraBeforeStatus = await page.locator('[data-graph-world]').getAttribute('transform')
  await page.getByText('关联图可用', { exact: true }).waitFor({ timeout: 5000 })
  assert.equal(await page.locator('svg').getAttribute('data-layout-state'), 'settled')
  assert.equal(await page.locator('[data-graph-world]').getAttribute('transform'), cameraBeforeStatus)

  // A Graph already open on a current generation must discover a later KAG job,
  // show honest indeterminate progress, and load the new complete revision once.
  await page.goto(url + '/?live-status'); await settle2D()
  await page.getByText('统一 KAG 可用', { exact: true }).waitFor({ timeout: 7000 })
  assert.equal(await page.evaluate(() => window.graphLiveFixture.graphReads), 1, 'initial status sample does not duplicate the first graph read')
  assert.equal(await page.getByRole('progressbar').count(), 0)
  const beforeManualRefresh = await page.evaluate(() => ({ reads: window.graphLiveFixture.graphReads, status: window.graphLiveFixture.statusReads }))
  const cameraBeforeManualRefresh = await page.locator('[data-graph-world]').getAttribute('transform')
  await page.getByRole('button', { name: '刷新显示' }).click()
  await page.getByRole('button', { name: '刷新显示' }).waitFor({ timeout: 7000 })
  const afterManualRefresh = await page.evaluate(() => ({ reads: window.graphLiveFixture.graphReads, status: window.graphLiveFixture.statusReads }))
  await page.evaluate(() => { window.graphLiveFixture.head = 'v2'; window.graphLiveFixture.equivalent = true })
  await page.getByText('统一 KAG 可用', { exact: true }).waitFor({ timeout: 7000 })
  await page.getByText(/状态详情/).click()
  await page.getByText(/设计证据相同，沿用已发布图谱/).waitFor({ timeout: 7000 })
  await page.getByText(/状态详情/).click()
  await page.evaluate(() => { window.graphLiveFixture.equivalent = false })
  assert.equal(afterManualRefresh.reads, beforeManualRefresh.reads, 'manual refresh does not re-read an unchanged immutable publication')
  assert.ok(afterManualRefresh.status > beforeManualRefresh.status, 'manual refresh re-reads live status')
  assert.equal(await page.locator('[data-graph-world]').getAttribute('transform'), cameraBeforeManualRefresh, 'same publication preserves camera')
  await page.evaluate(() => { window.graphLiveFixture.state = 'due'; window.graphLiveFixture.head = 'v2' })
  await page.getByText(/设计文件已更新，图谱待刷新/).waitFor({ timeout: 7000 })
  assert.equal(await page.getByRole('progressbar').count(), 0, 'due is not a running job')
  await page.evaluate(() => { window.graphLiveFixture.state = 'queued' })
  await page.getByText(/更新已排队/).waitFor({ timeout: 7000 })
  assert.equal(await page.getByRole('progressbar').count(), 0, 'queued is not a running job')
  await page.evaluate(() => { window.graphLiveFixture.state = 'running'; window.graphLiveFixture.phase = 'semantic' })
  await page.getByRole('progressbar', { name: '图谱正在更新' }).waitFor({ timeout: 7000 })
  assert.match(await page.locator('.graph-health').innerText(), /正在计算语义候选/)
  await page.evaluate(() => { window.graphLiveFixture.failStatus = true })
  await page.getByText(/图谱状态暂不可确认 · 当前显示上一完整版本/).waitFor({ timeout: 7000 })
  assert.equal(await page.getByRole('progressbar').count(), 0, 'status loss must not leave a stale running animation')
  await page.evaluate(() => { window.graphLiveFixture.failStatus = false })
  await page.getByRole('progressbar', { name: '图谱正在更新' }).waitFor({ timeout: 7000 })
  const graphReadsBeforePublish = await page.evaluate(() => window.graphLiveFixture.graphReads)
  await page.evaluate(() => { window.graphLiveFixture.state = 'current'; window.graphLiveFixture.phase = undefined; window.graphLiveFixture.published = 'v2'; window.graphLiveFixture.failGraphRead = true })
  await page.getByText(/新图谱已发布，但载入暂不可用/).waitFor({ timeout: 7000 })
  assert.equal(await page.getByRole('progressbar').count(), 0, 'failed graph load must not animate indefinitely')
  await page.evaluate(() => { window.graphLiveFixture.state = 'queued' })
  await page.getByText(/更新已排队/).waitFor({ timeout: 7000 })
  assert.equal(await page.getByText(/新图谱已发布，但载入暂不可用/).count(), 0, 'stale graph-load error clears when job state changes')
  await page.evaluate(() => { window.graphLiveFixture.state = 'current'; window.graphLiveFixture.failGraphRead = false })
  await page.getByText('图谱已更新', { exact: true }).waitFor({ timeout: 7000 })
  assert.equal(await page.getByRole('progressbar').count(), 0)
  assert.ok(await page.evaluate(() => window.graphLiveFixture.graphReads) > graphReadsBeforePublish)
  await page.evaluate(() => { window.graphLiveFixture.state = 'failed' })
  await page.getByText(/图谱更新失败/).waitFor({ timeout: 7000 })
  assert.equal(await page.getByRole('progressbar').count(), 0, 'failed jobs stop animating')

  // Search sees nodes outside the initial display cap; landmark Stress handles the expanded heavy fixture.
  await page.goto(url + '/?large'); await settle2D()
  assert.equal(await page.locator('svg g[role=button]').count(), 160)
  await page.getByLabel('搜索设计字段').fill('record199')
  await page.getByRole('button', { name: 'record199', exact: true }).click()
  assert.equal(await page.locator('svg g[role=button]').count(), 1)
  await page.goto(url + '/?heavy')
  await openSettings(); await page.getByLabel('显示节点上限').selectOption(String(Number.MAX_SAFE_INTEGER)); await closeSettings()
  await page.getByRole('button', { name: '展开', exact: true }).click()
  await settle2D()
  assert.equal(await page.locator('svg g[role=button]').count(), 2120)
  assert.equal(await page.evaluate(() => window.graphWorkers.active), 0)

  if (root || process.env.GRAPH_TEST_SNAPSHOT) {
    await page.goto(url + '/?real'); await settle2D()
    assert.ok(await page.locator('svg g[role=button]').count() > 0)
    await openSettings(); await page.getByLabel('图谱布局').selectOption('stress3'); await closeSettings(); await settle3D()
    await page.screenshot({ path: join(out, 'real-3d-overview.png') })
  }
  assert.deepEqual(errors, [])
  console.log(`GRAPH BROWSER PASS screenshots: ${out}`)
  if (process.env.GRAPH_BROWSER_KEEP_OPEN) {
    console.log('READ-ONLY GRAPH PREVIEW ' + url)
    await new Promise(resolve => process.once('SIGINT', resolve))
  }
} catch (error) {
  if (page) console.error(await page.evaluate(() => JSON.stringify({ alerts: [...document.querySelectorAll('[role=alert]')].map(element => element.textContent), views: [...document.querySelectorAll('[data-layout-state]')].map(element => ({ ...element.dataset })) })))
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server ? server.close(resolve) : resolve())
}
