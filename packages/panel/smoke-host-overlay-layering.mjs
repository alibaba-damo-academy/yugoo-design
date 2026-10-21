#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { chromium } from 'playwright'

const source = await readFile(new URL('./src/client/styles.ts', import.meta.url), 'utf8')
const cssMatch = source.match(/export const DOCK_CSS = `([\s\S]*?)`\n/)
assert.ok(cssMatch, 'the Design dock stylesheet must remain directly testable')
const css = cssMatch[1]

assert.match(css, /\.dsh-design-frame-inset>\[data-shell-overlay\]\{z-index:auto\}/)
assert.match(css, /\.dsh-design-frame-inset>:has\(>\[data-slot="conversation"\]\),\n\.dsh-design-frame-inset \[data-slot="conversation"\]>\*\{overflow:visible\}/)
assert.match(css, /\.dsh-design-dock\{[^}]*z-index:1\}/)
assert.doesNotMatch(css, /子代理|subagent|role="tree"|X7WArq/, 'layering must not target one Host menu implementation')

const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: 'chrome' }))
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1042 } })
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; height: 100%; }
      .host-frame { position: relative; width: 100%; height: 100%; overflow: hidden; }
      .host-conversation-column { position: absolute; inset: 0 auto 0 56px; width: 363px; overflow: hidden; }
      .host-conversation { position: relative; width: 100%; height: 100%; overflow: hidden; }
      .host-header { position: relative; height: 76px; }
      .host-menu { position: absolute; left: 106px; top: 47px; z-index: 100; width: 336px; height: 560px; background: white; }
      .host-menu-item { width: 100%; height: 50px; }
      [data-shell-overlay] { position: absolute; inset: 0; z-index: 20; pointer-events: none; }
      :root { --dsh-design-dock-w: 1501px; }
      ${css}
    </style>
    <div class="host-frame dsh-design-frame-inset">
      <div class="host-conversation-column">
        <div data-slot="conversation">
          <div class="host-conversation">
            <header class="host-header">
              <div class="host-menu" role="tree"><button class="host-menu-item" type="button">Host menu item</button></div>
            </header>
          </div>
        </div>
      </div>
      <div data-shell-overlay="true">
        <div class="dsh-design-dock"><span>Design dock</span></div>
      </div>
    </div>
    <script>
      window.hostMenuClicks = 0
      window.designDockClicks = 0
      document.querySelector('.host-menu-item').addEventListener('click', () => { window.hostMenuClicks += 1 })
      document.querySelector('.dsh-design-dock').addEventListener('click', () => { window.designDockClicks += 1 })
    </script>
  `)

  const overlap = { x: 450, y: 70 }
  assert.equal(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, overlap),
    'host-menu-item',
    'the Host menu must paint and receive pointers over the Design dock',
  )
  await page.mouse.click(overlap.x, overlap.y)
  assert.deepEqual(
    await page.evaluate(() => ({ host: window.hostMenuClicks, dock: window.designDockClicks })),
    { host: 1, dock: 0 },
    'the Design dock must not capture a click inside the overlapping Host menu',
  )

  await page.locator('.host-frame').evaluate((element) => { element.classList.remove('dsh-design-frame-inset') })
  assert.equal(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, overlap),
    'dsh-design-dock',
    'the Host escape rules must remain scoped to an open Design dock',
  )
} finally {
  await browser.close()
}

console.log('host overlay layering: native menus paint and receive input above an overlapping Design dock')
