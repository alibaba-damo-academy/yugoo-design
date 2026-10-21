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
    <main class="dsh-advisory-expanded-layer" style="left:72px;top:76px;width:544px;height:740px">
      <div class="dsh-advisory-carousel">
        <article class="dsh-advisory-card" data-expanded>
          <header class="dsh-advisory-card-header">Reflection review</header>
          <p class="dsh-advisory-summary">Review the complete recommendation set.</p>
          <details class="dsh-advisory-details" open>
            <summary>Close details</summary>
            <div class="dsh-advisory-items-scroll"><ul class="dsh-advisory-items">${items}</ul></div>
          </details>
          <footer class="dsh-advisory-actions"><button>Accept</button><button>Reject</button></footer>
        </article>
        <nav class="dsh-advisory-carousel-controls"><button>←</button><span>1 / 2</span><button>→</button></nav>
      </div>
    </main>`)

  const scroll = page.locator('.dsh-advisory-items-scroll')
  const layer = page.locator('.dsh-advisory-expanded-layer')
  const actions = page.locator('.dsh-advisory-actions')
  const pagination = page.locator('.dsh-advisory-carousel-controls')
  const geometryBefore = await Promise.all([layer.boundingBox(), actions.boundingBox(), pagination.boundingBox()])
  const capacity = await scroll.evaluate(node => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }))
  assert.ok(capacity.clientHeight > 0 && capacity.scrollHeight > capacity.clientHeight, 'expanded advisory details must own a bounded scroll viewport')

  await scroll.hover()
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(50)
  const down = await scroll.evaluate(node => node.scrollTop)
  assert.ok(down > 0, 'mouse wheel must scroll expanded advisory details down')
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(50)
  const up = await scroll.evaluate(node => node.scrollTop)
  assert.ok(up < down, 'mouse wheel must scroll expanded advisory details up')

  const geometryAfter = await Promise.all([layer.boundingBox(), actions.boundingBox(), pagination.boundingBox()])
  assert.deepEqual(geometryAfter, geometryBefore, 'detail scrolling must not move the composer-width layer, actions, or pagination')
  assert.equal(geometryAfter[0]?.width, 544, 'expanded advisory must stay constrained to the conversation column')
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'detail scrolling must not scroll the host page')
} finally {
  await browser.close()
}

console.log('ADVISORY SCROLL OK')
