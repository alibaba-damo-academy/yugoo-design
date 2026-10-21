import { createRequire } from 'node:module'

export const BPMN_RENDERER = 'bpmn-js@18.24.0'
export const PAGE_VIEWPORT = Object.freeze({ width: 1440, height: 900, deviceScaleFactor: 1 })

const require = createRequire(import.meta.url)

function embeddedSvg(svg) {
  const start = svg.indexOf('<svg ')
  if (start < 0) throw new Error('bpmn-js did not return an SVG document')
  let embedded = svg.slice(start)
  const markerIds = [...embedded.matchAll(/<marker\b[^>]*\bid="(?<id>marker-[^"]+)"/gu)].map(match => match.groups.id)
  for (const [index, markerId] of [...new Set(markerIds)].entries()) embedded = embedded.replaceAll(markerId, `prd-bpmn-marker-${index + 1}`)
  return embedded.replace('<svg ', `<svg class="prd-visual-svg" data-prd-bpmn-renderer="${BPMN_RENDERER}" role="img" `)
}

export async function renderPrdVisuals({ bpmnItems, htmlItems }) {
  if (bpmnItems.length === 0 && htmlItems.length === 0) return { bpmnSvgs: [], htmlScreenshots: [] }
  // HTML-only projections do not consume BPMN. Resolve required BPMN bytes
  // before launching a browser; missing dependencies must still fail honestly.
  const viewerBundle = bpmnItems.length > 0
    ? require.resolve('bpmn-js/dist/bpmn-navigated-viewer.production.min.js')
    : null
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const bpmnSvgs = []
    if (bpmnItems.length > 0) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
      await page.setContent('<!doctype html><html><body><div id="canvas" style="width:1600px;height:1200px"></div></body></html>')
      await page.addScriptTag({ path: viewerBundle })
      for (const item of bpmnItems) {
        try {
          const result = await page.evaluate(async xml => {
            const viewer = new window.BpmnJS({ container: '#canvas' })
            try {
              const imported = await viewer.importXML(xml)
              const saved = await viewer.saveSVG()
              return { svg: saved.svg, warnings: imported.warnings.map(warning => String(warning?.message ?? warning)) }
            } finally {
              viewer.destroy()
            }
          }, item.content)
          if (result.warnings.length > 0) throw new Error(result.warnings.join('; '))
          bpmnSvgs.push(embeddedSvg(result.svg))
        } catch (error) {
          throw new Error(`cannot render BPMN visual ${JSON.stringify(item.path)} with ${BPMN_RENDERER}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      await page.close()
    }

    const htmlScreenshots = []
    if (htmlItems.length > 0) {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: PAGE_VIEWPORT.width, height: PAGE_VIEWPORT.height },
        deviceScaleFactor: PAGE_VIEWPORT.deviceScaleFactor,
      })
      await context.route('**/*', route => route.abort())
      const page = await context.newPage()
      for (const item of htmlItems) {
        try {
          await page.setContent(item.ownerHtml, { waitUntil: 'load' })
          const png = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' })
          htmlScreenshots.push(`data:image/png;base64,${png.toString('base64')}`)
        } catch (error) {
          throw new Error(`cannot render HTML visual ${JSON.stringify(item.path)} at ${PAGE_VIEWPORT.width}x${PAGE_VIEWPORT.height}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      await context.close()
    }
    return { bpmnSvgs, htmlScreenshots }
  } finally {
    await browser.close()
  }
}
