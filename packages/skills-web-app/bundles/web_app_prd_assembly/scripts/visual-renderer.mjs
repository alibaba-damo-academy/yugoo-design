import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const BPMN_RENDERER = 'bpmn-js@18.24.0'
export const WHITEBOARD_RENDERER = 'excalidraw@0.18.1'
export const PAGE_VIEWPORT = Object.freeze({ width: 1440, height: 900, deviceScaleFactor: 1 })
export const PAGE_SCREENSHOT_OPTIONS = Object.freeze({ type: 'png', fullPage: true, animations: 'disabled' })

const require = createRequire(import.meta.url)

async function launchPrdBrowser(chromium) {
  const missing = []
  for (const channel of [undefined, 'chrome', 'msedge']) {
    try {
      return await chromium.launch({ headless: true, ...(channel ? { channel } : {}) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // These are the locked Playwright registry's pre-launch missing-binary
      // diagnostics. A crash, permission or missing-library error must surface
      // immediately instead of being hidden by another browser attempt.
      const firstLine = message.replace(/^browserType\.launch: /u, '').split(/\r?\n/u, 1)[0]
      const absent = channel
        ? firstLine === `Chromium distribution '${channel}' is not found` || firstLine.startsWith(`Chromium distribution '${channel}' is not found at `)
        : /^(?:browserType\.launch: )?Executable doesn't exist at [^\r\n]+(?:\r?\n|$)/u.test(message)
      if (!absent) throw error
      missing.push(`${channel ?? 'Playwright Chromium'}: ${message}`)
    }
  }
  throw new Error(`No executable was found for Playwright Chromium, installed Chrome or installed Microsoft Edge.\n${missing.join('\n')}`)
}

function embeddedSvg(svg) {
  const start = svg.indexOf('<svg ')
  if (start < 0) throw new Error('bpmn-js did not return an SVG document')
  let embedded = svg.slice(start)
  const markerIds = [...embedded.matchAll(/<marker\b[^>]*\bid="(?<id>marker-[^"]+)"/gu)].map(match => match.groups.id)
  for (const [index, markerId] of [...new Set(markerIds)].entries()) embedded = embedded.replaceAll(markerId, `prd-bpmn-marker-${index + 1}`)
  return embedded.replace('<svg ', `<svg class="prd-visual-svg" data-prd-bpmn-renderer="${BPMN_RENDERER}" role="img" `)
}

export async function renderPrdVisuals({ bpmnItems, htmlItems, whiteboardItems = [] }) {
  if (bpmnItems.length === 0 && htmlItems.length === 0 && whiteboardItems.length === 0) return { bpmnSvgs: [], htmlScreenshots: [], whiteboardImages: [] }
  // HTML-only projections do not consume BPMN. Resolve required BPMN bytes
  // before launching a browser; missing dependencies must still fail honestly.
  const packagedViewer = new URL('./assets/bpmn-viewer.js', import.meta.url)
  const viewerBundle = bpmnItems.length > 0
    ? existsSync(packagedViewer) ? fileURLToPath(packagedViewer) : require.resolve('bpmn-js/dist/bpmn-navigated-viewer.production.min.js')
    : null
  const presentationFile = new URL('./assets/bpmn-presentation.json', import.meta.url)
  const bpmnPresentation = bpmnItems.length > 0 && existsSync(presentationFile)
    ? JSON.parse(readFileSync(presentationFile, 'utf8')) : undefined
  if (bpmnItems.length > 0 && existsSync(packagedViewer) && !bpmnPresentation) throw new Error('Packaged BPMN presentation resource is missing')
  const whiteboardBundle = new URL('./assets/whiteboard-export.js', import.meta.url)
  if (whiteboardItems.length > 0 && !existsSync(whiteboardBundle)) throw new Error('Packaged Whiteboard export resource is missing; use the complete built Bundle')
  const packagedPlaywright = new URL('./runtime/playwright-core/index.mjs', import.meta.url)
  if ((existsSync(packagedViewer) || existsSync(whiteboardBundle)) && !existsSync(packagedPlaywright)) throw new Error('Packaged browser runtime is missing; use the complete built Bundle')
  const { chromium } = await import(existsSync(packagedPlaywright) ? packagedPlaywright.href : 'playwright')
  let browser
  try { browser = await launchPrdBrowser(chromium) }
  catch (error) { throw new Error(`PRD visual rendering needs an available supported browser: ${error instanceof Error ? error.message : String(error)}. No browser was installed or downloaded.`, { cause: error }) }
  try {
    const bpmnSvgs = []
    if (bpmnItems.length > 0) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
      await page.setContent('<!doctype html><html><body><div id="canvas" style="width:1600px;height:1200px"></div></body></html>')
      await page.addScriptTag({ path: viewerBundle })
      for (const item of bpmnItems) {
        try {
          const result = await page.evaluate(async ({ xml, textRenderer }) => {
            const viewer = new window.BpmnJS({ container: '#canvas', ...(textRenderer ? { textRenderer } : {}) })
            try {
              const imported = await viewer.importXML(xml)
              const saved = await viewer.saveSVG()
              return { svg: saved.svg, warnings: imported.warnings.map(warning => String(warning?.message ?? warning)) }
            } finally {
              viewer.destroy()
            }
          }, { xml: item.content, textRenderer: bpmnPresentation })
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
      // Source HTML initializes its own DOM; the injected CSP and aborted requests keep it offline.
      const context = await browser.newContext({
        javaScriptEnabled: true,
        viewport: { width: PAGE_VIEWPORT.width, height: PAGE_VIEWPORT.height },
        deviceScaleFactor: PAGE_VIEWPORT.deviceScaleFactor,
      })
      await context.route('**/*', route => route.abort())
      for (const item of htmlItems) {
        // setContent on a reused page retains globals from the previous source.
        const page = await context.newPage()
        try {
          await page.setContent(item.ownerHtml, { waitUntil: 'load' })
          const height = await page.evaluate(() => Math.max(innerHeight, document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0))
          if (height !== PAGE_VIEWPORT.height) await page.setViewportSize({ width: PAGE_VIEWPORT.width, height })
          const png = await page.screenshot(PAGE_SCREENSHOT_OPTIONS)
          htmlScreenshots.push(`data:image/png;base64,${png.toString('base64')}`)
        } catch (error) {
          throw new Error(`cannot render HTML visual ${JSON.stringify(item.path)} at ${PAGE_VIEWPORT.width}x${PAGE_VIEWPORT.height}: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          await page.close()
        }
      }
      await context.close()
    }
    const whiteboardImages = []
    if (whiteboardItems.length > 0) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
      await page.route('**/*', route => route.abort())
      try {
        await page.setContent('<!doctype html><html><body></body></html>')
        await page.addScriptTag({ path: fileURLToPath(whiteboardBundle) })
        for (const item of whiteboardItems) {
          try {
            whiteboardImages.push(await page.evaluate(scene => window.YugooWhiteboardExport(scene), item.scene))
          } catch (error) {
            throw new Error(`cannot render Whiteboard visual ${JSON.stringify(item.path)} with ${WHITEBOARD_RENDERER}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      } finally { await page.close() }
    }
    return { bpmnSvgs, htmlScreenshots, whiteboardImages }
  } finally {
    await browser.close()
  }
}
