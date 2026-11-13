#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const stylesSource = await readFile(new URL('./src/client/styles.ts', import.meta.url), 'utf8')
const advisoryCss = stylesSource.match(/export const ADVISORY_CSS = `([^]*?)`/u)?.[1]
assert.notEqual(advisoryCss, undefined, 'advisory CSS must be available to the browser smoke')

const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const items = Array.from({ length: 60 }, (_, index) => `
    <li class="dsh-advisory-item">
      <span class="dsh-advisory-item-title">Recommendation ${index + 1}</span>
      <span class="dsh-advisory-item-detail">${'Long advisory detail. '.repeat(12)}</span>
    </li>`).join('')
  await page.setContent(`<!doctype html>
    <style>${advisoryCss}</style>
    <main class="dsh-advisory-inbox" style="position:fixed;left:72px;bottom:60px;width:544px">
      <header class="dsh-advisory-inbox-heading">Design Advisories</header>
      <section class="dsh-advisory-review"><div class="dsh-advisory-carousel">
        <article class="dsh-advisory-card">
          <p class="dsh-advisory-summary">Review the complete recommendation set.</p>
          <details class="dsh-advisory-details">
            <summary>Details</summary>
            <div class="dsh-advisory-items-scroll"><ul class="dsh-advisory-items">${items}</ul></div>
          </details>
          <footer class="dsh-advisory-actions"><button>Accept</button><button>Reject</button><button>Later</button></footer>
        </article>
        <nav class="dsh-advisory-carousel-controls"><time class="dsh-advisory-time">Today 12:28</time><button>←</button><span class="dsh-advisory-position">1 / 2</span><button>→</button></nav>
      </div></section>
    </main>
    <script>document.querySelector('details').addEventListener('toggle', event => document.querySelector('article').toggleAttribute('data-expanded', event.target.open))</script>`)

  const appearance = () => page.evaluate(() => {
    const selectors = ['.dsh-advisory-inbox', '.dsh-advisory-time', '.dsh-advisory-carousel-controls button', '.dsh-advisory-position']
    return selectors.map(selector => {
      const node = document.querySelector(selector), css = getComputedStyle(node)
      return { font: css.font, color: css.color, border: css.border, background: css.backgroundColor,
        padding: css.padding, borderRadius: css.borderRadius, width: node.getBoundingClientRect().width }
    })
  })
  const collapsed = await appearance()
  await page.locator('summary').click()
  await page.waitForFunction(() => document.querySelector('article').hasAttribute('data-expanded'))
  assert.deepEqual(await appearance(), collapsed, 'expansion preserves the frame, date and pagination appearance')

  const scroll = page.locator('.dsh-advisory-items-scroll')
  const layer = page.locator('.dsh-advisory-inbox')
  const actions = page.locator('.dsh-advisory-actions')
  const pagination = page.locator('.dsh-advisory-carousel-controls')
  const geometryBefore = await Promise.all([layer.boundingBox(), actions.boundingBox(), pagination.boundingBox()])
  const capacity = await scroll.evaluate(node => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }))
  assert.ok(capacity.clientHeight > 0 && capacity.scrollHeight > capacity.clientHeight, 'expanded advisory details must own a bounded scroll viewport')
  assert.ok(geometryBefore[1].y + geometryBefore[1].height <= geometryBefore[0].y + geometryBefore[0].height, 'actions remain within the original frame')
  assert.ok(geometryBefore[2].y + geometryBefore[2].height <= geometryBefore[0].y + geometryBefore[0].height, 'date and pagination remain visible')

  await scroll.hover()
  await page.mouse.wheel(0, capacity.scrollHeight)
  await page.waitForTimeout(50)
  const down = await scroll.evaluate(node => node.scrollTop)
  assert.ok(down > 0, 'mouse wheel must scroll expanded advisory details down')
  assert.ok(await scroll.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1), 'the final recommendation remains reachable')
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(50)
  const up = await scroll.evaluate(node => node.scrollTop)
  assert.ok(up < down, 'mouse wheel must scroll expanded advisory details up')

  const geometryAfter = await Promise.all([layer.boundingBox(), actions.boundingBox(), pagination.boundingBox()])
  assert.deepEqual(geometryAfter, geometryBefore, 'detail scrolling must not move the original frame, actions, or pagination')
  assert.equal(geometryAfter[0]?.width, 544, 'expanded advisory keeps its original width')
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'detail scrolling must not scroll the host page')
} finally {
  await browser.close()
}

console.log('ADVISORY SCROLL OK')
