/** Shared CSS/Portal boundary in Chromium; no installed-Host or save claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from 'playwright'
import { StandardQuestionWorkspace } from '../src/question-list.tsx'
import { panelPopupTheme } from '../src/panel-select.tsx'
import { graphStyles } from '../src/client/graph-styles.ts'
import { DOCK_CSS, PANEL_SELECT_MENU_CSS, TOGGLE_CSS } from '../src/client/styles.ts'
import { STUDIO_WORKSPACE_CSS } from '../../studio-ui/src/styles.ts'

test('Host scheme and semantic overrides reach shared surfaces, form controls and portalled choices', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    // Explicit Host light must win even on an OS reporting dark.
    const page = await browser.newPage({ colorScheme: 'dark' })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    const questions = renderToStaticMarkup(createElement(StandardQuestionWorkspace, {
      questions: [{ id: 'question', prompt: 'A real editable question', kind: 'text', answer: '', round: 1 }], editable: true,
    }))
    await page.setContent(`<style>${css}${DOCK_CSS}${PANEL_SELECT_MENU_CSS}${STUDIO_WORKSPACE_CSS}${graphStyles}${TOGGLE_CSS}</style><button class="dsh-design-toggle dsh-design-toggle-active">Yugoo Design</button>
      <div class="dsh-design-root dsh-design-dock" style="position:relative;width:700px;height:500px">
        <div class="dsh-design-project-header">Project</div><div class="dsh-design-panel">${questions}
        <button class="dsh-standard-question-detail" id="trigger">Choose</button><div class="dsh-record-board-cards"><article>Record card</article></div></div>
        <div class="dsh-design-footer"><button class="dsh-design-btn dsh-design-btn-primary">Save</button></div><div class="dsh-design-view-footer">Save</div>
      </div><div class="ygd-studio-workspace"><header class="ygd-studio-topbar">Studio</header></div><div class="design-graph-view"><header class="graph-toolbar"><button class="graph-refresh">Refresh</button></header><fieldset class="graph-settings-section">Settings</fieldset><fieldset class="graph-settings-section">More settings</fieldset></div>`)
    const colors = () => page.evaluate(() => Object.fromEntries([
      ['dock', '.dsh-design-dock'], ['header', '.dsh-design-project-header'], ['footer', '.dsh-design-view-footer'],
      ['input', '#trigger'], ['studio', '.ygd-studio-workspace'], ['studioHeader', '.ygd-studio-topbar'],
      ['toggle', '.dsh-design-toggle-active'], ['selected', '[aria-current="page"]'], ['card', '.dsh-record-board-cards > article'], ['graphToolbar', '.graph-toolbar'], ['graphRefresh', '.graph-refresh'], ['graphSection', '.graph-settings-section'],
    ].map(([name, selector]) => { const node = document.querySelector(selector); if (!node) throw Error(selector); const s = getComputedStyle(node); return [name, { bg: s.backgroundColor, color: s.color, border: s.borderBottomColor }] })))
    await page.evaluate(() => { document.documentElement.style.colorScheme = 'light' })
    const light = await colors()
    assert.equal(light.dock.bg, 'rgb(255, 255, 255)')
    assert.equal(light.header.bg, light.dock.bg)
    assert.equal(light.footer.bg, light.dock.bg)
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'dark'
      document.body.style.setProperty('--dsw-alias-bg-base', '#12171c')
      document.body.style.setProperty('--dsw-alias-label-primary', '#edf3fa')
      document.body.style.setProperty('--dsw-alias-bg-layer-1', '#20282f')
    })
    const dark = await colors()
    for (const name of ['dock', 'header', 'footer', 'input', 'studioHeader', 'card', 'graphToolbar']) assert.equal(dark[name].bg, 'rgb(18, 23, 28)', `${name} follows the Host surface`)
    assert.equal(dark.dock.color, 'rgb(237, 243, 250)')
    assert.equal(dark.toggle.bg, 'rgb(32, 40, 47)', 'boot toggle outside the dock uses the current Host layer token')
    assert.equal(dark.graphRefresh.color, 'rgb(187, 165, 255)', 'refresh uses the dark-readable graph accent')
    assert.equal(dark.graphSection.border, 'rgb(70, 70, 78)', 'settings use the same graph border')
    assert.notEqual(dark.selected.bg, light.selected.bg, 'selected navigation does not keep a light-only fill')
    assert.equal(dark.selected.color, dark.dock.color)
    // Exercise the production Portal token-capture function outside the surface.
    const popup = await page.evaluate(`(() => {
      const style = (${panelPopupTheme.toString()})(document.querySelector('#trigger'));
      const menu = document.createElement('div'); menu.className = 'dsh-panel-select-content';
      for (const [key, value] of Object.entries(style)) { if (key.startsWith('--')) menu.style.setProperty(key, value); else menu.style[key] = value }
      document.body.append(menu);
      return { background: getComputedStyle(menu).backgroundColor, color: getComputedStyle(menu).color };
    })()`)
    assert.equal(popup.background, dark.input.bg)
    assert.equal(popup.color, dark.input.color)
    await page.evaluate(() => { document.body.removeAttribute('style'); document.documentElement.style.colorScheme = 'light' })
    assert.deepEqual(await colors(), light, 'switching back restores shared colors without remounting')
  } finally { await browser.close() }
})
