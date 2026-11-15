/** Real shared Scene component/CSS in Chromium; not installed Host acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

test('Scene shell shares Panel typography and host colors while its authored frame remains unchanged', async () => {
  const require = createRequire(import.meta.url)
  const { build } = await import(pathToFileURL(createRequire(require.resolve('tsx')).resolve('esbuild')).href)
  const shared = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
  const { outputFiles } = await build({
    stdin: { resolveDir: fileURLToPath(new URL('./', import.meta.url)), loader: 'tsx', contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { ExperiencePanel } from '../src/client/experience-panel.tsx';
      import { PanelLocaleContext } from '../src/panel-i18n.tsx';
      const source = 'intent/intent.json', hash = 'a'.repeat(64);
      const files = {};
      for (const [id, title] of [['one', 'Saved scenario / 用户场景'], ['two', 'Second saved scenario']]) {
        const htmlFile = '_experiences/' + id + '/v1/main.html';
        files['_experiences/' + id + '/view.json'] = JSON.stringify({id, title, version:'v1', purpose:'Saved purpose',
          sourceVersions:{[source]:hash}, sections:[{id:'main',title,htmlFile,sources:[source],assumptions:['Saved assumption']}]});
        files[htmlFile] = '<!doctype html><style>body{background:rgb(243,246,250);color:rgb(32,37,43)}</style><p id="authored">' + title + '</p>';
      }
      createRoot(document.getElementById('root')).render(<PanelLocaleContext.Provider value="en-US"><ExperiencePanel
        writable={false} artifactFiles={{[source]:hash}} experienceFiles={Object.fromEntries(Object.keys(files).map(path=>[path,hash]))}
        readArtifact={async path=>({found:path in files,content:files[path]})}
        readBinaryArtifact={async()=>({found:false,mediaType:'image/png',base64:'',byteLength:0})}
        sendPrompt={async()=>{throw new Error('This reading fixture cannot submit a prompt')}}
      /></PanelLocaleContext.Provider>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { 'dsh-design-core/experience-view': fileURLToPath(new URL('../../core/src/experience-view.ts', import.meta.url)) },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    for (const width of [1000, 700, 560]) {
      await page.setViewportSize({ width, height: 720 })
      await page.setContent(`<style>${shared}html,body,#root{height:100%;margin:0}body{font:14px system-ui}#root{height:680px}</style><div id="root"></div>`)
      await page.addScriptTag({ content: outputFiles[0].text })
      await page.locator('iframe').waitFor()
      await page.frameLocator('iframe').locator('#authored').waitFor()
      const initialDocument = await page.locator('iframe').getAttribute('srcdoc')
      const themeColors = []
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => { document.documentElement.style.colorScheme = value }, theme)
        const result = await page.evaluate(() => {
          const style = selector => getComputedStyle(document.querySelector(selector))
          const title = style('.dsh-experience-directory-heading h2'), heading = style('.dsh-experience-heading h2')
          const info = style('.dsh-experience-info'), count = style('.dsh-experience-count')
          const selected = style('.dsh-experience-scene[aria-current="page"]')
          return { title: [title.fontSize,title.fontWeight,title.lineHeight], heading: [heading.fontSize,heading.fontWeight,heading.lineHeight],
            text:title.color, headingText:heading.color, background:style('.dsh-experience').backgroundColor,
            count:count.color,info:info.color,selected:selected.backgroundColor,
            collapsed:style('.dsh-experience-directory-toggle').display !== 'none', overflow:document.documentElement.scrollWidth > innerWidth }
        })
        // Shared compact navigation uses 13px at the narrow Panel breakpoint.
        assert.deepEqual(result.title, [width <= 560 ? '13px' : '14px','400','20px'], `${width}/${theme}`)
        assert.deepEqual(result.heading, ['14px','600','20px'])
        assert.equal(result.headingText, result.text)
        assert.equal(result.count, result.info)
        assert.equal(result.overflow, false, `${width}/${theme}: content stays within its host`)
        assert.notEqual(result.selected, 'rgba(0, 0, 0, 0)', 'selection uses the shared navigation surface')
        themeColors.push(result)
        await page.locator('.dsh-experience-evidence summary').click()
        await page.getByText('Saved assumption', { exact: true }).waitFor()
        await page.locator('.dsh-experience-evidence summary').click()
        const frameColor = await page.frameLocator('iframe').locator('body').evaluate(node => getComputedStyle(node).backgroundColor)
        assert.equal(frameColor, 'rgb(243, 246, 250)', 'the authored application keeps its own design colors')
        assert.equal(await page.locator('iframe').getAttribute('srcdoc'), initialDocument, 'theme changes do not regenerate the authored document')
        if (process.env.SCENE_THEME_SCREENSHOTS) {
          await mkdir(process.env.SCENE_THEME_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: join(process.env.SCENE_THEME_SCREENSHOTS, `scene-${width}-${theme}.png`) })
        }
        if (result.collapsed) {
          const toggle = page.locator('.dsh-experience-directory-toggle')
          await toggle.click(); await page.getByRole('navigation', { name: 'Scenarios' }).waitFor({ state: 'visible' })
          await toggle.click(); await page.getByRole('navigation', { name: 'Scenarios' }).waitFor({ state: 'hidden' })
          assert.equal(await page.locator('iframe').getAttribute('srcdoc'), initialDocument, 'directory disclosure preserves the selected frame')
        }
      }
      assert.notEqual(themeColors[0].text, themeColors[1].text, 'shell text follows the host theme')
      assert.notEqual(themeColors[0].background, themeColors[1].background, 'shell background follows the host theme')
      assert.equal(themeColors[1].text, 'rgb(242, 242, 245)')
      if (themeColors[1].collapsed) await page.locator('.dsh-experience-directory-toggle').click()
      await page.getByRole('button', { name: 'Second saved scenario', exact: true }).click()
      await page.frameLocator('iframe').getByText('Second saved scenario', { exact: true }).waitFor()
      assert.equal(await page.locator('.dsh-experience-heading h2').textContent(), 'Second saved scenario')
    }
  } finally { await browser.close() }
})
