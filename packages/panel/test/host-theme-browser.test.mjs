/** Shared CSS/Portal boundary in Chromium; no installed-Host or save claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from 'playwright'
import { StandardQuestionWorkspace } from '../src/question-list.tsx'
import { panelPopupTheme } from '../src/panel-select.tsx'
import { graphStyles } from '../src/client/graph-styles.ts'
import { DOCK_CSS, PANEL_SELECT_MENU_CSS, TOGGLE_CSS } from '../src/client/styles.ts'
import { STUDIO_WORKSPACE_CSS } from '../../studio-ui/src/styles.ts'
import { projectDistributionCode } from '../../../scripts/assemble-dsh-distribution.mjs'
import { dshClientStyles } from '../../../scripts/tsdown-client-styles.ts'

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
      // A retained legacy alias can be defined without following Host theme.
      // Its mere presence must not hide the current semantic layer.
      document.body.style.setProperty('--dsw-alias-bg-secondary', '#fff')
    })
    const dark = await colors()
    for (const name of ['dock', 'header', 'footer', 'input', 'studioHeader', 'card', 'graphToolbar']) assert.equal(dark[name].bg, 'rgb(18, 23, 28)', `${name} follows the Host surface`)
    assert.equal(dark.dock.color, 'rgb(237, 243, 250)')
    assert.equal(dark.toggle.bg, 'rgb(32, 40, 47)', 'boot toggle outside the dock uses the current Host layer token')
    await page.locator('.dsh-design-toggle-active').hover()
    assert.equal((await colors()).toggle.bg, dark.toggle.bg, 'hover also prefers the current layer over the conflicting legacy alias')
    assert.equal(dark.graphRefresh.color, 'rgb(187, 165, 255)', 'refresh uses the dark-readable graph accent')
    assert.equal(dark.graphSection.border, 'rgb(70, 70, 78)', 'settings use the same graph border')
    assert.notEqual(dark.selected.bg, light.selected.bg, 'selected navigation does not keep a light-only fill')
    assert.equal(dark.selected.color, dark.dock.color)
    await page.evaluate(() => {
      document.body.style.removeProperty('--dsw-alias-bg-layer-1')
      document.body.style.setProperty('--dsw-alias-bg-secondary', '#263445')
    })
    assert.equal((await colors()).toggle.bg, 'rgb(38, 52, 69)', 'an older Host without the current layer retains its legacy fallback')
    await page.evaluate(() => {
      document.body.style.setProperty('--dsw-alias-bg-layer-1', '#20282f')
      document.body.style.setProperty('--dsw-alias-bg-secondary', '#fff')
    })
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

test('scoped reload refreshes retained shell and shared styles, then Host cleanup removes their actual owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'panel-style-reload-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const mapping = Object.fromEntries(['dsh-design-panel', 'dsh-design-provider-web-app'].map(name => [name, { name: `@yugoo-design/${name}` }]))
    const shell = await readFile(new URL('../src/client/owned-styles.ts', import.meta.url), 'utf8')
    const commonjs = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const shellCode = projectDistributionCode(commonjs(shell), mapping, 'client.js').code
    const file = join(directory, 'shared.css')
    await writeFile(file, '.provider-probe{background:var(--dsw-alias-bg-layer-1)}')
    const loader = dshClientStyles('dsh-design-provider-web-app', new URL('../tsdown.config.ts', import.meta.url).href)
    const id = loader.resolveId(file)
    const emitted = loader.load.call({ addWatchFile() {} }, id).code
    const sharedCode = projectDistributionCode(commonjs(emitted), mapping, 'client.js').code
    const sharedKey = JSON.parse(emitted.match(/const tagId = ("[^"\n]+");/)[1])
    const page = await browser.newPage({ colorScheme: 'dark' })
    await page.setContent(`<style>:root{color-scheme:dark}body{--dsw-alias-bg-layer-1:#232324}</style>
      <button class="dsh-design-toggle dsh-design-toggle-active">Yugoo Design</button><div class="provider-probe">Provider</div>`)
    const values = { DOCK_CSS, TOGGLE_CSS, CLARITY_DOCK_CSS: '', ADVISORY_CSS: '', CONTINUATION_CSS: '' }
    for (const [key, owner, code, selector] of [
      ['dsh-design-panel/shell.css', 'dsh-design-panel', shellCode, '.dsh-design-toggle-active'],
      [sharedKey, 'dsh-design-provider-web-app', sharedCode, '.provider-probe'],
    ]) {
      const packageId = mapping[owner].name
      // A prior scoped build incorrectly tagged its CSS with the unscoped ID.
      // The Host removes styles by its package ID, so this old tag survives.
      await page.evaluate(({ key, owner, packageId, selector }) => {
        const old = document.createElement('style')
        old.dataset.plugin = owner; old.dataset.pluginCss = key
        old.textContent = `${selector}{background:#f1f5f9}`
        document.head.append(old)
        for (const tag of document.querySelectorAll('style[data-plugin]')) {
          if (tag.getAttribute('data-plugin') === packageId) tag.remove()
        }
      }, { key, owner, packageId, selector })
      const run = () => page.evaluate(({ code, values }) => { Function('require', 'exports', code)(() => values, {}) }, { code, values })
      const inspect = () => page.evaluate(({ key, selector }) => ({
        owners: [...document.querySelectorAll('style[data-plugin-css]')].filter(tag => tag.dataset.pluginCss === key).map(tag => tag.dataset.plugin),
        background: getComputedStyle(document.querySelector(selector)).backgroundColor,
      }), { key, selector })
      assert.equal((await inspect()).background, 'rgb(241, 245, 249)', 'the retained old sheet reproduces the failure')
      await run()
      assert.deepEqual(await inspect(), { owners: [packageId], background: 'rgb(35, 35, 36)' })
      await run()
      assert.deepEqual(await inspect(), { owners: [packageId], background: 'rgb(35, 35, 36)' }, 'repeated materialization keeps one current stylesheet')
      await page.evaluate(packageId => {
        for (const tag of document.querySelectorAll('style[data-plugin]')) {
          if (tag.getAttribute('data-plugin') === packageId) tag.remove()
        }
      }, packageId)
      assert.deepEqual((await inspect()).owners, [], 'Host cleanup finds the same package owner as its client module')
      await run()
      assert.deepEqual(await inspect(), { owners: [packageId], background: 'rgb(35, 35, 36)' }, 'reopening restores the stylesheet after cleanup')
    }
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }) }
})
