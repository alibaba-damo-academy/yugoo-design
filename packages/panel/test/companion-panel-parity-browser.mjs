// Real-browser geometry probe of shared source components, not installed-host acceptance.
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api')
register()
const React = await import('react')
globalThis.React = React
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: FooterButtons } = await import('../src/client/ported/design/FooterButtons.tsx')
const { DOCK_CSS } = await import('../src/client/styles.ts')
const { DesignPanelSurface } = await import('../src/client/design-panel-surface.tsx')
const { PanelWorkspace } = await import('../src/panel-workspace.tsx')
const { EXPERIENCE_CSS } = await import('../src/client/experience-styles.ts')
const { chromium } = await import('playwright')
const h = React.createElement
const shared = await readFile(new URL('../src/visual-components.css', import.meta.url), 'utf8')
const utilities = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
const footer = renderToStaticMarkup(React.createElement(FooterButtons, {
  disabled: true, regenerateText: '取消', saveText: '保存并继续',
}))
const table = h('div', { className: 'dsh-design-rows', 'data-scroll': 'table' },
  h('table', { className: 'dsh-design-rows-table', style: { minWidth: 1200 } },
    h('tbody', {}, ...Array.from({ length: 24 }, (_, i) => h('tr', { key: i }, ...['Name', 'Condition', 'Result', 'Last column'].map(label => h('td', { key: label }, `${label} ${i + 1}`)))))))
const content = h('div', { className: 'dsh-panel-workspace-content', 'data-scroll': 'content' },
  h('h2', {}, 'Shared record details'), table,
  ...Array.from({ length: 25 }, (_, i) => h('p', { key: i }, `Readable long content ${i + 1}. A record keeps its own context.`)),
  h('article', { className: 'dsh-design-record', id: 'card' }, h('input', { className: 'dsh-design-field-input', value: 'Existing card control', readOnly: true })),
  h('p', { id: 'end' }, 'End of content'))
const workspace = h('div', { className: 'dsh-design-panel', 'data-layout': 'workspace' },
  h(PanelWorkspace, { sidebar: h('nav', { 'aria-label': 'Records' }, h('button', {}, 'Record one')) }, content))
function page(view) {
  const ordinary = h('div', { className: 'dsh-design-panel dsh-design-dock-panel-body', 'data-scroll': 'content' }, content.props.children)
  const body = view === 'document' ? ordinary : workspace
  const surface = h(DesignPanelSurface, {}, body)
  const markup = renderToStaticMarkup(view === 'experience' ? h('div', { className: 'dsh-experience-workspace' }, h('div', { className: 'dsh-experience-body' }, surface)) : surface)
  return `<!doctype html><meta charset="utf-8"><title>Shared Panel viewport</title><style>${utilities}${shared}${DOCK_CSS}${EXPERIENCE_CSS}
html,body{height:100%;margin:0;color-scheme:light dark}body{overflow:hidden}#viewport{height:calc(100% - 67px);min-height:0;display:flex;flex-direction:column}.dsh-design-dock{position:relative;width:100%;height:100%;box-sizing:border-box}</style>
<div class="dsh-design-root dsh-design-dock"><div id="viewport">${markup}</div>${footer}</div>`
}
const server = createServer((request, response) => {
  const view = new URL(request.url, 'http://localhost').searchParams.get('view') ?? 'workspace'
  if (!['workspace', 'document', 'experience'].includes(view)) { response.writeHead(404); response.end(); return }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(page(view))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
if (!process.argv.includes('--check')) {
  console.log(JSON.stringify({ pid: process.pid, origin }))
  await new Promise(resolve => process.once('SIGTERM', resolve))
  await new Promise(resolve => server.close(resolve))
} else {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const screenshots = process.argv.find(arg => arg.startsWith('--screenshots='))?.slice('--screenshots='.length)
    if (screenshots) await mkdir(screenshots, { recursive: true })
    for (const width of [480, 1000]) for (const theme of ['light', 'dark']) for (const view of ['workspace', 'document', 'experience']) {
      await page.setViewportSize({ width, height: 720 }); await page.emulateMedia({ colorScheme: theme })
      await page.goto(`${origin}/?view=${view}`)
      const geometry = await page.evaluate(() => {
        const surface = document.querySelector('[data-testid="dsh-design-panel-surface"]'), s = getComputedStyle(surface)
        const scroll = document.querySelector('[data-scroll="content"]'), gutter = getComputedStyle(scroll)
        const table = document.querySelector('[data-scroll="table"]'), card = document.querySelector('#card')
        return { docWidth: document.documentElement.scrollWidth, surfaceWidth: surface.getBoundingClientRect().width, viewportWidth: document.querySelector('#viewport').clientWidth,
          border: s.borderLeftWidth, radius: s.borderRadius, background: s.backgroundColor, gutters: [gutter.paddingLeft, gutter.paddingRight], scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth,
          tableWidth: table.clientWidth, tableScroll: table.scrollWidth, tableOverflow: getComputedStyle(table).overflowX, cardBorder: getComputedStyle(card).borderLeftWidth,
          inputBorder: getComputedStyle(card.querySelector('input')).borderLeftWidth }
      })
      const label = `${view}/${width}/${theme}`
      assert.equal(geometry.background, theme === 'dark' ? 'rgb(35, 35, 38)' : 'rgb(247, 247, 247)', label + ': Host scheme resolves the actual shared surface palette')
      assert.ok(geometry.docWidth <= width, label + ': no viewport overflow')
      assert.equal(geometry.border, '0px', label + ': no decorative outer border'); assert.equal(geometry.radius, '0px', label + ': no outer rounding')
      assert.equal(geometry.surfaceWidth, geometry.viewportWidth - (view === 'experience' ? 24 : 0), label + ': surface fills owning viewport')
      assert.deepEqual(geometry.gutters, ['16px', '16px'], label + ': one symmetric content gutter')
      assert.equal(geometry.scrollWidth, geometry.clientWidth, label + ': table does not stretch the content owner')
      assert.equal(geometry.tableOverflow, 'auto'); assert.ok(geometry.tableScroll > geometry.tableWidth)
      assert.equal(geometry.cardBorder, '1px'); assert.equal(geometry.inputBorder, '1px', label + ': meaningful inner boundaries remain')
      await page.locator('[data-scroll="table"]').hover(); await page.mouse.wheel(1500, 0)
      await page.waitForFunction(() => { const e = document.querySelector('[data-scroll="table"]'); return e.scrollLeft >= e.scrollWidth - e.clientWidth - 1 })
      await page.locator('[data-scroll="content"]').hover(); await page.mouse.wheel(0, 10000)
      await page.waitForFunction(() => { const e = document.querySelector('[data-scroll="content"]'); return e.scrollTop >= e.scrollHeight - e.clientHeight - 1 })
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, label + ': document stays fixed')
      if (screenshots && ((width === 480 && theme === 'light') || (width === 1000 && theme === 'dark'))) await page.screenshot({ path: `${screenshots}/${view}-${width}-${theme}.png` })
      console.log('PASS ' + label + ' ' + JSON.stringify(geometry))
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
}
