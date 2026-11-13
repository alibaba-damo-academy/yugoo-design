/** Shared CSS/Portal boundary in Chromium; no installed-Host or save claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from 'playwright'
import { StandardQuestionList, StandardQuestionWorkspace } from '../src/question-list.tsx'
import { RecordBoard } from '../src/record-board.tsx'
import { renderManifest, renderNode, PANEL_COMPONENT_RENDERERS } from '../src/interpreter.ts'
import { parsePanelManifest } from '../../core/src/panel-dsl.ts'
import { localizePanelManifest } from '../src/dsl.ts'
import { PanelRecordHeader, PanelEditableTitle, PanelContentGroup } from '../src/panel-workspace.tsx'
import { PanelLocaleContext } from '../src/panel-i18n.tsx'
import { RecordFacts } from '../src/record-facts.tsx'
import { CompactRecordDetails } from '../src/compact-record-details.tsx'
import { RecordMap } from '../src/record-map.tsx'
import { panelPopupTheme } from '../src/panel-select.tsx'
import { graphStyles } from '../src/client/graph-styles.ts'
import { ADVISORY_CSS, DOCK_CSS, PANEL_SELECT_MENU_CSS, TOGGLE_CSS } from '../src/client/styles.ts'
import { EXPERIENCE_CSS } from '../src/client/experience-styles.ts'
import FooterButtons from '../src/client/ported/design/FooterButtons.tsx'
import { STUDIO_WORKSPACE_CSS } from '../../studio-ui/src/styles.ts'
import { projectDistributionCode } from '../../../scripts/assemble-dsh-distribution.mjs'
import { dshClientStyles } from '../../../scripts/tsdown-client-styles.ts'

test('readonly saved question choices retain readable text and selected surfaces in both themes and locales', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    // The Host may also load the native provider. Its legacy choice frame must
    // not own the shared component's ordinary reading state.
    const providerCss = await readFile(new URL('../../provider-web-app/src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) for (const scheme of ['light', 'dark']) {
      const html = renderToStaticMarkup(createElement(PanelLocaleContext.Provider, { value: locale },
        createElement(StandardQuestionList, {
          editable: false, questions: [{ id: 'saved', prompt: locale === 'zh-CN' ? '登录方式' : 'Sign-in method', kind: 'single', answer: 'yes',
            choices: [{ value: 'yes', label: locale === 'zh-CN' ? '账户登录' : 'Account sign-in' }, { value: 'no', label: locale === 'zh-CN' ? '无需登录' : 'No sign-in' }] }],
          cardGroups: [{ id: 'configuration', title: 'Configuration', questionIds: ['saved'], presentation: { alwaysExpanded: true, showDetail: false } }],
        })))
      await page.setContent(`<style>${css}${providerCss}</style><div class="dsh-design-root"><div class="dsh-design-panel">${html}</div></div>`)
      await page.evaluate(value => { document.documentElement.style.colorScheme = value }, scheme)
      const colors = await page.locator('.dsh-standard-question-option').evaluateAll(nodes => nodes.map(node => ({
        text: getComputedStyle(node.querySelector('span')).color, surrounding: getComputedStyle(node.parentElement).color,
        background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderColor,
        disabled: node.querySelector('input').disabled,
      })))
      assert.ok(colors.every(color => color.disabled && color.text === color.surrounding), `${locale}/${scheme}: readonly answers keep body text contrast`)
      assert.notEqual(colors[0].background, colors[1].background, 'saved selection keeps a distinct surface')
      assert.notEqual(colors[0].border, colors[1].border, 'saved selection keeps a distinct outline')
    }
  } finally { await browser.close() }
})

test('saved question supplements and record facts align text baselines while retaining their type roles', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) {
      const label = locale === 'zh-CN' ? '补充说明' : 'Additional details'
      const value = locale === 'zh-CN' ? '这些核对支持 BR-006 和 P-002；未定义自动重试窗口。' : 'These checks support BR-006 and P-002; an automatic retry window is not defined.'
      for (const detail of [value, `${value}\n${value} ${'reference-'.repeat(12)}`]) {
        const questions = createElement(StandardQuestionList, { editable: false, collapseAnswered: false,
          questions: [{ id: 'saved', prompt: 'Retry', kind: 'single', answer: 'yes', detail,
            choices: [{ value: 'yes', label: 'Yes' }] }], labels: { detail: label },
        })
        const facts = createElement(RecordFacts, { fields: [{ key: 'exceptions', label: 'Exceptions', columns: [{ key: 'response', label }] }],
          value: { exceptions: [{ response: detail }] }, rows: [['exceptions']],
        })
        await page.setContent('<style>' + css + '</style>' + renderToStaticMarkup(createElement(PanelLocaleContext.Provider, { value: locale },
          createElement('div', { className: 'dsh-design-root' }, createElement('div', { className: 'dsh-design-panel' }, questions, facts)))))
        for (const width of [1040, 360]) {
          await page.setViewportSize({ width, height: 900 })
          const rows = await page.locator('.dsh-standard-question-result p, .dsh-record-facts-entries dl > div').evaluateAll(nodes => nodes.map(row => {
            const textNodes = element => {
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), result = []
              while (walker.nextNode()) if (walker.currentNode.textContent.trim()) result.push(walker.currentNode)
              return result
            }
            const glyphTop = text => {
              const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1)
              return range.getBoundingClientRect().top
            }
            const text = textNodes(row), label = row.firstElementChild
            const delta = glyphTop(text[1]) - glyphTop(text[0])
            // Natural inline text establishes the reference baseline. Glyph tops
            // need not match when label and value have different font sizes.
            const reference = row.cloneNode(true)
            reference.style.cssText = 'position:absolute;visibility:hidden;display:block;white-space:nowrap;width:max-content'
            for (const child of reference.children) child.style.display = 'inline'
            row.parentElement.append(reference)
            const inlineText = textNodes(reference)
            const expected = glyphTop(inlineText[1]) - glyphTop(inlineText[0])
            reference.remove()
            return { delta, expected, text: text[1].textContent,
              labelSize: parseFloat(getComputedStyle(label).fontSize),
              valueSize: parseFloat(getComputedStyle(text[1].parentElement).fontSize),
              overflow: row.scrollWidth > row.clientWidth + 1 }
          }))
          assert.equal(rows.length, 2)
          for (const row of rows) {
            assert.ok(Math.abs(row.delta - row.expected) < 1, `${locale}/${width}: smaller labels align with the first value baseline`)
            assert.equal(row.labelSize, 12)
            assert.ok(row.valueSize > row.labelSize, 'alignment does not erase the helper/body type distinction')
            assert.equal(row.text, detail, 'line breaks, references and saved text are preserved')
            assert.equal(row.overflow, false, 'multiline values and long tokens stay inside their row')
          }
        }
      }
    }
  } finally { await browser.close() }
})

test('project view indicators meet the footer edge while save actions remain reachable', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) for (const selected of [0, 1, 2]) {
      const labels = locale === 'zh-CN' ? ['设计面板', '场景体验', '关联图谱'] : ['Panels', 'Scenarios', 'Relationships']
      const nav = createElement('nav', { className: 'dsh-design-view-switcher' }, ...labels.map((label, index) =>
        createElement('button', { key: label, 'aria-pressed': index === selected }, label)))
      // Actual save-footer composition plus the two existing specialist slots.
      const content = selected === 0 ? createElement(FooterButtons, {
        className: 'dsh-design-footer-with-views border-t', disabled: false,
        saveText: locale === 'zh-CN' ? '保存并继续' : 'Save & continue',
        regenerateText: locale === 'zh-CN' ? '取消' : 'Cancel',
      }, nav) : createElement('footer', { className: `dsh-design-view-footer ${selected === 1 ? 'dsh-experience-footer' : 'graph-footer'}` }, nav)
      await page.setContent('<style>' + css + DOCK_CSS + EXPERIENCE_CSS + graphStyles + '</style>' + renderToStaticMarkup(
        createElement('div', { className: 'dsh-design-root' }, createElement('div', { className: selected === 2 ? 'design-graph-view' : '' }, content))))
      for (const width of [1000, 360]) {
        await page.setViewportSize({ width, height: 700 })
        const geometry = await page.locator('.dsh-design-view-switcher').evaluate(nav => {
          const footer = nav.closest('.dsh-design-footer-with-views, .dsh-design-view-footer'), box = footer.getBoundingClientRect()
          const button = nav.querySelector('[aria-pressed="true"]'), b = button.getBoundingClientRect(), marker = getComputedStyle(button, '::before')
          return { footerHeight: box.height, inset: b.top + parseFloat(marker.top) - box.top,
            border: parseFloat(getComputedStyle(footer).borderTopWidth), markerHeight: marker.height,
            markerCount: [...nav.children].filter(n => getComputedStyle(n, '::before').content !== 'none').length,
            actions: [...footer.querySelectorAll('.dsh-design-footer-actions button')].map(n => {
              const r = n.getBoundingClientRect(); return { height: r.height, inside: r.left >= box.left && r.right <= box.right && r.bottom <= box.bottom }
            }), overflow: footer.scrollWidth > footer.clientWidth + 1 }
        })
        assert.equal(geometry.inset, geometry.border, `${locale}/${selected}/${width}: the line belongs to the footer's content boundary, not an inset text button`)
        assert.equal(geometry.markerHeight, '2px'); assert.equal(geometry.markerCount, 1)
        assert.ok(geometry.footerHeight >= 52)
        if (width === 1000) assert.equal(geometry.footerHeight, 52, 'all three views use the same compact footer height')
        assert.equal(geometry.overflow, false)
        for (const action of geometry.actions) assert.ok(action.height >= 32 && action.inside, 'save/cancel keep their complete targets when the footer wraps')
      }
    }
  } finally { await browser.close() }
})

test('Host scheme and semantic overrides reach shared surfaces, form controls and portalled choices', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    // Explicit Host light must win even on an OS reporting dark.
    const page = await browser.newPage({ colorScheme: 'dark' })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
      + await readFile(new URL('../src/visual-components.css', import.meta.url), 'utf8')
    const questions = renderToStaticMarkup(createElement(StandardQuestionWorkspace, {
      questions: [{ id: 'question', prompt: 'A real editable question', kind: 'text', answer: '', round: 1 }], editable: true,
    }))
    await page.setContent(`<style>${css}${DOCK_CSS}${ADVISORY_CSS}${PANEL_SELECT_MENU_CSS}${STUDIO_WORKSPACE_CSS}${graphStyles}${TOGGLE_CSS}</style><button type="button" id="collapsed-entry" class="dsh-design-toggle" aria-expanded="false">Yugoo Design</button><button type="button" class="dsh-design-toggle dsh-design-toggle-active" aria-expanded="true">Yugoo Design</button>
      <div class="dsh-design-root dsh-design-dock" style="position:relative;width:700px;height:500px">
        <div class="dsh-design-project-header">Project</div><div class="dsh-design-panel">${questions}
        <button class="dsh-standard-question-detail" id="trigger">Choose</button><div class="dsh-record-board-cards"><article class="dsh-panel-content-card">Record card</article></div></div>
        <div class="dsh-design-footer"><button class="dsh-design-btn dsh-design-btn-primary">Save</button></div><div class="dsh-design-view-footer">Save</div>
      </div><div class="ygd-studio-workspace"><header class="ygd-studio-topbar">Studio</header></div><div class="design-graph-view"><header class="graph-toolbar"><button class="graph-refresh">Refresh</button></header><fieldset class="graph-settings-section">Settings</fieldset><fieldset class="graph-settings-section">More settings</fieldset></div>
      <div class="dsh-project-catalog" style="left:720px;top:0"><header class="dsh-project-catalog-header">Projects</header><div class="dsh-project-row" data-current="true"><button class="dsh-project-open" disabled>Current project</button></div><form class="dsh-project-create"><input aria-label="New project" /></form></div>
      <button class="dsh-review-settings-close" style="position:fixed;left:720px;top:240px">Close settings</button>`)
    const colors = () => page.evaluate(() => Object.fromEntries([
      ['dock', '.dsh-design-dock'], ['header', '.dsh-design-project-header'], ['footer', '.dsh-design-view-footer'],
      ['input', '#trigger'], ['studio', '.ygd-studio-workspace'], ['studioHeader', '.ygd-studio-topbar'],
      ['toggle', '.dsh-design-toggle-active'], ['collapsedToggle', '#collapsed-entry'], ['selected', '[aria-current="page"]'], ['card', '.dsh-record-board-cards > article'], ['graphToolbar', '.graph-toolbar'], ['graphRefresh', '.graph-refresh'], ['graphSection', '.graph-settings-section'],
      ['projectMenu', '.dsh-project-catalog'], ['projectCurrent', '.dsh-project-row[data-current]'], ['projectInput', '.dsh-project-create input'],
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
    for (const name of ['dock', 'header', 'footer', 'input', 'studioHeader', 'card', 'graphToolbar', 'projectMenu']) assert.equal(dark[name].bg, 'rgb(18, 23, 28)', `${name} follows the Host surface`)
    assert.equal(dark.projectCurrent.bg, 'rgb(32, 40, 47)', 'current project outside the dock uses the current Host layer, never the stale white alias')
    assert.equal(dark.projectCurrent.color, dark.dock.color)
    assert.equal(dark.projectMenu.border, 'rgb(53, 53, 59)', 'missing legacy borders use a dark-aware separator')
    assert.equal(dark.projectInput.border, 'rgb(70, 70, 78)', 'input boundaries remain quieter than the label')
    await page.locator('.dsh-review-settings-close').hover()
    assert.equal(await page.locator('.dsh-review-settings-close').evaluate(x => getComputedStyle(x).backgroundColor), 'rgb(32, 40, 47)', 'another shared popup action uses the same current layer priority')
    assert.equal(dark.dock.color, 'rgb(237, 243, 250)')
    assert.equal(light.toggle.bg, 'rgb(255, 255, 255)', 'expanded entry uses its white CTA surface')
    assert.equal(dark.toggle.bg, light.toggle.bg, 'expanded entry remains white in a dark Host')
    assert.equal(dark.toggle.color, 'rgb(39, 39, 39)', 'expanded entry retains a dark label on white')
    assert.equal(light.collapsedToggle.color, 'rgb(255, 255, 255)', 'collapsed entry uses a white label')
    assert.equal(light.collapsedToggle.bg, 'rgb(124, 90, 246)', 'collapsed entry uses the standard primary background')
    assert.equal(dark.collapsedToggle.color, 'rgb(24, 17, 34)', 'dark entry follows the standard primary foreground')
    assert.equal(dark.collapsedToggle.bg, 'rgb(166, 139, 255)', 'dark entry follows the standard primary background')
    assert.notEqual(dark.collapsedToggle.bg, dark.toggle.bg, 'entry state remains distinct from the expanded panel')
    await page.locator('.dsh-design-toggle-active').hover()
    assert.equal((await colors()).toggle.bg, dark.toggle.bg, 'hover preserves the expanded CTA state')
    assert.equal(dark.graphRefresh.color, 'rgb(187, 165, 255)', 'refresh uses the dark-readable graph accent')
    assert.equal(dark.graphSection.border, 'rgb(70, 70, 78)', 'settings use the same graph border')
    assert.notEqual(dark.selected.bg, light.selected.bg, 'selected navigation does not keep a light-only fill')
    assert.equal(dark.selected.color, dark.dock.color)
    await page.evaluate(() => {
      document.body.style.removeProperty('--dsw-alias-bg-layer-1')
      document.body.style.setProperty('--dsw-alias-bg-secondary', '#263445')
    })
    assert.equal((await colors()).toggle.bg, light.toggle.bg, 'legacy Host layer aliases do not change the expanded CTA surface')
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

test('selected Panel tab and detail header join the workspace even when Host layers share a color', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    await page.setContent(`<style>${css}${DOCK_CSS}</style><div class="dsh-design-root dsh-design-dock" style="position:relative;width:700px;height:400px">
      <div class="dsh-design-tabs"><div class="dsh-design-tabs-scroll">
        <button class="dsh-design-tab" data-state="active">Roles</button><button class="dsh-design-tab" data-state="inactive">Questions</button>
      </div></div><div class="dsh-design-dock-panel-body dsh-design-dock-panel-workspace"><div class="dsh-design-panel" data-layout="workspace">
        <section class="dsh-panel-workspace"><aside class="dsh-panel-workspace-sidebar">Roles</aside><div></div><main class="dsh-panel-workspace-main">
          <header class="dsh-design-record-header is-detail">Customer</header><input aria-label="Role name" value="Customer">
          <h3 class="dsh-design-node-title">Shared specification</h3>${renderToStaticMarkup(createElement(PanelRecordHeader, { placement: 'workspace' }, createElement('h2', { className: 'dsh-panel-header-heading' }, 'Current round')))}
          <div class="dsh-document-toolbar"><strong>Research</strong></div>${renderToStaticMarkup(createElement(PanelContentGroup, { className: 'dsh-record-inherited-related', title: 'Inherited permissions' }, createElement('div', { className: 'dsh-design-form-group-content' }, 'Source permissions')))}
          <div class="dsh-record-board-editor"><div class="dsh-compact-record-details"><section data-detail-control="record_map"><header><h5>Behaviors</h5></header></section><section data-detail-control="textarea"><header><h5>Notes</h5></header></section></div></div>
          ${renderToStaticMarkup(createElement(PanelContentGroup, { className: 'dsh-preview-control-group', title: 'Colors' }, createElement('div', { className: 'dsh-design-form-group-content' }, 'Color controls')))}
          <div class="dsh-record-board-description">The user's main business explanation.</div>
        </main></section>
      </div></div></div>`)
    for (const scheme of ['light', 'dark']) {
      await page.evaluate(scheme => {
        document.documentElement.style.colorScheme = scheme
        for (const token of ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2']) {
          document.body.style.setProperty(token, scheme === 'light' ? '#fff' : '#19191c')
        }
      }, scheme)
      await page.locator('.dsh-design-tab').evaluateAll(tabs => Promise.all(tabs.flatMap(tab => tab.getAnimations()).map(animation => animation.finished)))
      const colors = () => page.evaluate(() => Object.fromEntries([
        ['strip', '.dsh-design-tabs'], ['tab', '.dsh-design-tab[data-state=active]'], ['panel', '.dsh-panel-workspace'],
        ['body', '.dsh-design-dock-panel-body'], ['header', '.dsh-design-record-header.is-detail'],
      ].map(([key, selector]) => [key, getComputedStyle(document.querySelector(selector)).backgroundColor])))
      const result = await colors()
      assert.equal(result.tab, result.panel, `${scheme}: selected tab joins the Panel surface`)
      assert.equal(result.header, result.panel, `${scheme}: detail header keeps the same surface`)
      assert.equal(result.body, result.panel, `${scheme}: ordinary body uses the same surface`)
      assert.notEqual(result.strip, result.tab, `${scheme}: tab silhouette survives equal Host layers`)
      const headings = await page.locator('.dsh-design-node-title,.dsh-panel-header-heading,.dsh-document-toolbar strong').evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node); return { size: style.fontSize, line: style.lineHeight, weight: style.fontWeight }
      }))
      for (const heading of headings) assert.deepEqual(heading, { size: '14px', line: '20px', weight: '600' }, `${scheme}: same-level chapters use shared typography`)
      for (const selector of ['.dsh-preview-control-group summary', '.dsh-record-inherited-related > summary']) {
        assert.deepEqual(await page.locator(selector).evaluate(node => { const s = getComputedStyle(node); return { size: s.fontSize, line: s.lineHeight, weight: s.fontWeight } }),
          { size: '14px', line: '20px', weight: '500' }, `${scheme}: a detail group stays below the current chapter`)
      }
      const fieldWeights = await page.locator('.dsh-compact-record-details h5').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontWeight))
      assert.deepEqual(fieldWeights, ['400', '400'], 'same-level list and text field labels stay regular regardless of control shape')
      assert.equal(await page.locator('.dsh-record-board-description').evaluate(node => getComputedStyle(node).fontSize), '13px', 'the actual content slot is compact even when the outer Panel is wider than 560px')
      await page.locator('.dsh-design-tab[data-state=active]').hover()
      assert.deepEqual(await colors(), result, `${scheme}: hover does not disconnect the selected tab`)
      const gap = await page.evaluate(() => document.querySelector('.dsh-design-dock-panel-body').getBoundingClientRect().top - document.querySelector('.dsh-design-tab[data-state=active]').getBoundingClientRect().bottom)
      assert.equal(gap, 0, `${scheme}: selected tab touches its content`)
    }
  } finally { await browser.close() }
})

test('compact detail disclosure shares its first field row without overlapping long headings or losing edits', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const label of ['使用场景与需要保留的详细业务背景', 'Usage scenario and the business context that must remain readable']) {
      await page.setContent('<style>' + css + '</style>' + renderToStaticMarkup(createElement('div', { className: 'dsh-design-panel', style: { width: 600 } },
        createElement(RecordBoard, {
          node: { id: 'details-regression', component: 'record_board', source: 'items', board: { label: 'title', details_title: 'Details', detail_sections: ['info'] } },
          manifest: { version: 1, panel_kind: 'test', fields: [], sections: [{ id: 'items', title: 'Items' }, { id: 'info', title: 'Info' }] },
          data: { items: { item: { title: 'Record' } } },
          render: section => section === 'info' ? createElement(CompactRecordDetails, {
            fields: [{ key: 'context', label, control: 'textarea' }], values: { context: 'Original' }, optional: false, editable: true,
            render: () => createElement('textarea', { 'aria-label': label, defaultValue: 'Original' }), change: () => assert.fail('disclosure must not write data'),
          }) : null,
        }))))
      const summary = page.locator('summary'), editor = page.locator('textarea')
      await summary.click()
      const geometry = await page.locator('details').evaluate(node => {
        const toggle = node.querySelector('summary').getBoundingClientRect(), heading = node.querySelector('h5').getBoundingClientRect(), row = node.querySelector('section > header').getBoundingClientRect()
        return { top: toggle.top - row.top, overlap: heading.right > toggle.left, hotArea: toggle.height }
      })
      assert.ok(Math.abs(geometry.top) < 1, 'collapse control uses the first heading row, with no empty row above it')
      assert.equal(geometry.overlap, false, 'a wrapped heading leaves the collapse control its own space')
      assert.ok(geometry.hotArea >= 28)
      await editor.fill('Unsaved change')
      await summary.focus(); await summary.press('Space')
      assert.equal(await editor.isVisible(), false)
      await summary.press('Enter')
      assert.equal(await editor.inputValue(), 'Unsaved change')
      assert.equal(await summary.getAttribute('aria-label'), 'Details')
    }
  } finally { await browser.close() }
})

test('ordinary record surfaces stay readable in Host themes and body density follows the content slot', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: 'dark' })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    const canvasCss = await readFile(new URL('../node_modules/@xyflow/react/dist/style.css', import.meta.url), 'utf8')
    const facts = renderToStaticMarkup(createElement(RecordFacts, {
      fields: [{ key: 'description', label: 'Description', control: 'textarea' },
        { key: 'exceptions', label: 'Exceptions', control: 'rows', columns: [{ key: 'response', label: 'Response' }] }],
      value: { description: 'Keep the saved business decision.', exceptions: [{ response: 'Retain the original evidence.' }] },
      rows: [['description'], ['exceptions']],
    }))
    const fields = [{ key: 'context', label: 'Context', control: 'textarea' },
      { key: 'behaviors', label: 'Behaviors', control: 'record_map', readonly: true, columns: [{ key: 'text', label: 'Behavior', control: 'textarea' }] },
      { key: 'exceptions', label: 'Exceptions', control: 'record_map', readonly: true,
        columns: [{ key: 'condition', label: 'Condition', control: 'textarea' }, { key: 'response', label: 'Response', control: 'textarea' }] }]
    const record = { context: 'A main business explanation, not a caption.', behaviors: { save: { text: 'Keep a saved decision.' }, retry: { text: 'Retry only failed delivery.' } },
      exceptions: { unavailable: { condition: 'Delivery is unavailable.', response: 'Keep the saved decision.' } } }
    const details = renderToStaticMarkup(createElement(CompactRecordDetails, {
      fields, values: record, optional: false, editable: true,
      change: () => assert.fail('a CSS fixture must not change facts'),
      render: field => field.control === 'record_map'
        ? createElement(RecordMap, { field, record, compact: true, editable: false, onPatch: () => assert.fail('a CSS fixture must not change facts') })
        : createElement('textarea', { className: 'dsh-design-field-input', 'aria-label': field.label, defaultValue: record[field.key] }),
    }))
    await page.setContent(`<style>${canvasCss}${css}</style><div class="dsh-design-root">
      <div class="dsh-design-panel" style="width:700px">
        <div class="dsh-record-board-group dsh-panel-content-group" id="ordinary-group"><div class="dsh-record-board-cards"><article class="dsh-panel-content-card" id="ordinary-card"><p>Ordinary business record</p></article></div></div>
        ${facts}
        <!-- BoardMap/BoardMapNode's ordinary shell; React Flow geometry is outside this CSS regression. -->
        <div class="dsh-record-board-overview"><header><strong>Functions</strong></header>
          <div class="dsh-record-board-map"><div class="dsh-board-map-node"><span>Collect feedback</span>
            <div class="dsh-board-map-tooltip" role="tooltip"><strong>Collect feedback</strong><p>Keep the original request.</p></div>
          </div></div>
        </div>
        <div class="react-flow" style="position:relative;width:120px;height:120px"><div class="react-flow__controls">
          <button class="react-flow__controls-button" aria-label="Zoom in"><svg viewBox="0 0 12 12"><path d="M0 5h12v2H0zM5 0h2v12H5z"/></svg></button>
        </div></div>
      </div>
      <div class="dsh-design-panel" id="density-panel" style="width:760px;height:420px"><section class="dsh-panel-workspace" id="density-frame">
        <aside class="dsh-panel-workspace-sidebar"><div class="dsh-panel-workspace-tree"><button class="dsh-panel-workspace-tree-item">Records</button></div></aside><div></div>
        <main class="dsh-panel-workspace-main"><aside class="dsh-record-inspector"><div class="dsh-record-board-editor">${details}</div></aside></main>
      </section></div>
    </div>`)
    const contrast = ({ color, background }) => {
      const luminance = value => {
        assert.match(value, /^rgb(?:a)?\(/, `the fixture must resolve an sRGB color: ${value}`)
        const [r, g, b, alpha = 1] = value.match(/[\d.]+/g).map(Number)
        assert.equal(alpha, 1, 'the contrast fixture uses opaque colors')
        const linear = [r, g, b].map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
      }
      const a = luminance(color), b = luminance(background)
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
    }
    for (const scheme of ['light', 'dark']) {
      await page.evaluate(scheme => {
        document.documentElement.style.colorScheme = scheme
        for (const [token, value] of Object.entries(scheme === 'light'
          ? { '--dsw-alias-bg-base': '#fff', '--dsw-alias-bg-layer-1': '#f7f7f7', '--dsw-alias-label-primary': '#161b22' }
          : { '--dsw-alias-bg-base': '#12171c', '--dsw-alias-bg-layer-1': '#20282f', '--dsw-alias-label-primary': '#edf3fa' })) document.body.style.setProperty(token, value)
      }, scheme)
      await page.locator('.dsh-board-map-node').hover()
      assert.equal(await page.locator('.dsh-board-map-tooltip').isVisible(), true, `${scheme}: the actual hover shell reveals its tooltip`)
      const pairs = await page.evaluate(() => ['#ordinary-card p', '.dsh-record-facts p', '.dsh-record-facts dd',
        '.dsh-record-board-overview > header strong', '.dsh-board-map-node > span', '.dsh-board-map-tooltip strong', '.dsh-board-map-tooltip p'].map(selector => {
        const node = document.querySelector(selector)
        if (!node) throw Error(selector)
        let surface = node
        while (surface && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement
        if (!surface) throw Error(`No opaque backing surface for ${selector}`)
        return { selector, color: getComputedStyle(node).color, background: getComputedStyle(surface).backgroundColor }
      }))
      for (const pair of pairs) assert.ok(contrast(pair) >= 4.5, `${scheme}: ${pair.selector} must be readable (${JSON.stringify(pair)})`)
      const canvasButton = page.locator('.react-flow__controls-button')
      for (const hovered of [false, true]) {
        if (hovered) await canvasButton.hover()
        const pair = await canvasButton.evaluate(node => ({ color: getComputedStyle(node.querySelector('svg')).fill, background: getComputedStyle(node).backgroundColor }))
        assert.ok(contrast(pair) >= 4.5, `${scheme}/${hovered ? 'hover' : 'normal'}: native canvas controls keep visible icons`)
      }
      assert.equal(await page.locator('[data-record-map=behaviors] .dsh-panel-reading-item').count(), 0, 'being single-column and readonly does not by itself turn a compact list into inset cards')
      assert.equal(await page.locator('[data-record-map=exceptions] .dsh-panel-reading-item').count(), 0, 'tabular cells retain table hierarchy instead of nesting individual cards')
      const ordinary = pairs[0].background
      assert.notEqual(await page.locator('#ordinary-group').evaluate(node => getComputedStyle(node).backgroundColor), ordinary, `${scheme}: the chapter stays distinct from its complete record card`)
      for (const selector of ['.dsh-record-facts p', '.dsh-board-map-node > span', '.dsh-board-map-tooltip strong']) {
        assert.equal(pairs.find(pair => pair.selector === selector).background, ordinary, `${scheme}: ${selector} shares the ordinary Host card surface`)
      }
      for (const [frameClass, retainedName] of [['', undefined], ['dsh-record-workspace-frame is-record-preview', 'record-preview-main'], ['dsh-navigation-frame', 'navigation-content']]) {
        await page.locator('#density-frame').evaluate((node, frameClass) => { node.className = `dsh-panel-workspace ${frameClass}` }, frameClass)
        for (const [width, size, sectionGap] of [[760, '13px', '12px'], [1120, '14px', '16px'], [760, '13px', '12px']]) {
          await page.locator('#density-panel').evaluate((node, width) => { node.style.width = `${width}px` }, width)
          const result = await page.locator('#density-panel').evaluate(panel => {
            const main = panel.querySelector('.dsh-panel-workspace-main')
            const read = selector => getComputedStyle(panel.querySelector(selector)).fontSize
            return { outer: panel.getBoundingClientRect().width, main: main.getBoundingClientRect().width,
              names: getComputedStyle(main).containerName.split(/\s+/),
              input: read('.dsh-compact-record-details textarea'), value: read('.dsh-record-map-table td > span'),
              sidebar: read('.dsh-panel-workspace-tree-item'), gap: getComputedStyle(panel.querySelector('.dsh-compact-record-details')).gap }
          })
          assert.ok(result.outer > 560, 'the outer Panel must not be the compact trigger')
          assert.equal(result.main <= 560, width === 760, 'the fixture exercises the real content width')
          assert.equal(result.input, size, `${scheme}/${frameClass}/${width}: main input follows content density`)
          assert.equal(result.value, size, 'the same business fact in a table is not demoted to 12px')
          assert.equal(result.gap, sectionGap, 'detail groups inherit the content density without a leaf reset')
          assert.equal(result.sidebar, '14px', 'narrow content does not shrink unrelated navigation')
          assert.ok(result.names.includes('ygd-panel'))
          if (retainedName) assert.ok(result.names.includes(retainedName), `${retainedName} still owns its existing layout query`)
        }
      }
    }
  } finally { await browser.close() }
})

test('group titles stay closer to their own content than independent records in real shared compositions', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) {
      const title = locale === 'zh-CN' ? '反馈接收' : 'Feedback intake'
      const longTitle = locale === 'zh-CN' ? '客户反馈接收与跨团队确认后重新提交的边界说明'.repeat(4)
        : 'CustomerFeedbackIntakeAndCrossTeamConfirmation'.repeat(4)
      const node = { id: 'board', component: 'record_board', source: 'items', board: { label: 'name', description: 'notes', group: 'group', id_field: 'id' } }
      const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title }], fields: [{ key: 'name', label: title, control: 'text', applies_to: ['items'] }] }
      const board = createElement(RecordBoard, { node, manifest, data: { items: {
        a: { id: 'F-001', name: title, notes: title, group: title }, b: { id: 'F-002', name: longTitle, notes: title, group: title },
        c: { id: 'F-003', name: title, notes: title, group: longTitle },
      } }, options: { editable: true, onTransaction: () => {} }, render: () => null })
      const questions = createElement(StandardQuestionList, {
        questions: ['a', 'b'].map(id => ({ id, prompt: title, kind: 'text', answer: title })),
        cardGroups: [{ id: 'group', title, questionIds: ['a', 'b'] }],
      })
      const formNode = { id: 'form', component: 'record_form', source: 'items' }
      const form = { ...manifest, sections: [{ id: 'items', title, form: { body: [false, true].map(collapsible => ({
        kind: 'group', title, collapsible, items: [{ kind: 'field', field: 'notes' }, { kind: 'field', field: 'other' }],
      })) } }], fields: ['notes', 'other'].map(key => ({ key, label: key, control: 'textarea', applies_to: ['items'] })) }
      const html = renderToStaticMarkup(createElement(PanelLocaleContext.Provider, { value: locale },
        createElement('div', { className: 'dsh-design-root' },
          createElement('div', { id: 'group-board', className: 'dsh-design-panel', style: { height: 650 } }, board),
          createElement('div', { id: 'group-questions', className: 'dsh-design-panel' }, questions),
          createElement('div', { id: 'group-form', className: 'dsh-design-panel' },
            renderNode(formNode, form, { items: { a: { notes: title, other: title } } }, { locale })),
        )))
      await page.setContent('<style>' + css + '</style>' + html)
      const summary = page.locator('#group-form details > summary').first()
      assert.equal(await page.locator('#group-form details[open]').count(), 2, 'both existing semantic groups start expanded')
      for (const width of [1040, 540]) {
        await page.locator('.dsh-design-panel').evaluateAll((nodes, width) => nodes.forEach(node => { node.style.width = width + 'px' }), width)
        const groups = await page.evaluate(() => {
          const gap = (a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().bottom
          return ['#group-board .dsh-panel-content-group', '#group-questions [data-question-card-group]'].map(selector => {
            const group = document.querySelector(selector), heading = group.firstElementChild
            const cards = group.querySelectorAll('.dsh-panel-content-card, .dsh-standard-question-card'), style = getComputedStyle(heading)
            return { titleGap: gap(heading, cards[0]), cardGap: gap(cards[0], cards[1]), line: style.lineHeight, weight: style.fontWeight,
              height: heading.getBoundingClientRect().height }
          })
        })
        for (const group of groups) {
          assert.ok(group.titleGap > 0 && group.titleGap * 2 <= group.cardGap + .1, locale + '/' + width + ': the title belongs visibly to its first record')
          assert.equal(group.line, '20px')
          assert.equal(group.weight, '500')
        }
        assert.ok(groups[0].height >= 28, 'compact typography does not shrink the native button target')
        const titleParts = await page.locator('#group-board [data-board-record="b"] > header').evaluate(header => {
          const box = node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width, height: rect.height } }
          return { header: box(header), title: box(header.querySelector('h4')), input: box(header.querySelector('input')),
            edit: box(header.querySelector('button')), id: box(header.querySelector('.dsh-record-board-id')) }
        })
        assert.ok(titleParts.input.width > 0 && titleParts.input.right <= titleParts.edit.left + .1, 'the input leaves room for its edit target')
        assert.ok(titleParts.edit.width >= 24 && titleParts.edit.right <= titleParts.title.right + .1, 'the pencil stays inside the assigned title column')
        assert.ok(titleParts.title.right < titleParts.id.left && titleParts.id.right <= titleParts.header.right + .1, 'the identifier has its own non-overlapping place')
        assert.equal(titleParts.id.height, 28, 'a short identifier does not break merely because the title is long')
        const formGaps = await page.locator('#group-form .dsh-design-form-group').evaluateAll(groups => groups.map(group =>
          group.querySelector('.dsh-design-form-group-content').getBoundingClientRect().top - group.querySelector(':scope > summary > .dsh-panel-disclosure-label').getBoundingClientRect().bottom))
        assert.ok(Math.abs(formGaps[0] - formGaps[1]) < .1, 'disclosure does not change the title-to-content relationship')
        assert.ok(formGaps[1] > 0 && formGaps[1] * 2 <= groups[0].cardGap + .1)
        assert.ok(await summary.evaluate(node => { const box = node.getBoundingClientRect(); return box.width >= 24 && box.height >= 24 }),
          'native form disclosure also retains its own minimum target')
        const longHeading = page.locator('#group-board .dsh-record-board-group-heading').nth(1)
        assert.equal(await longHeading.evaluate(node => {
          const box = node.getBoundingClientRect()
          return node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1 && [...node.children].every(child => {
            const rect = child.getBoundingClientRect()
            return rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1
          })
        }), true, 'long Chinese and unbroken English titles keep their count and disclosure visible')
      }
      await summary.focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.locator('#group-form details').first().getAttribute('open'), null, 'native disclosure still closes from the keyboard')
    }
  } finally { await browser.close() }
})

test('related collection headings keep the same level as form groups in a real record workspace', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 2000, height: 1000 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    const bundle = new URL('../../skills-web-app/bundles/role_access/', import.meta.url)
    const manifest = parsePanelManifest(await readFile(new URL('panel.yaml', bundle), 'utf8'))
    manifest.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale => [locale,
      JSON.parse(await readFile(new URL(`locales/${locale}.json`, bundle), 'utf8'))])))
    const data = JSON.parse(await readFile(new URL('reference/preview.json', bundle), 'utf8'))
    // Select the existing descendant on the initial render to include its two
    // inherited collections and its own collection without replacing the UI.
    data.role_order = ['ROLE-003', 'ROLE-001', 'ROLE-002']
    data.roles = Object.fromEntries(data.role_order.map(id => [id, data.roles[id]]))
    for (const locale of ['zh-CN', 'en-US']) {
      const html = renderToStaticMarkup(createElement('div', { className: 'dsh-design-root', id: 'related-workspace', style: { height: 700 } },
        renderManifest(manifest, data, { locale, editable: true, onPanelUpdate: () => {} })))
      await page.setContent('<style>' + css + '</style>' + html)
      assert.equal(await page.locator('.dsh-record-inherited-related').count(), 2, 'the real workspace includes inherited content, not a mocked heading')
      for (const scheme of ['light', 'dark']) {
        await page.evaluate(scheme => { document.documentElement.style.colorScheme = scheme }, scheme)
        for (const width of [1800, 1040, 568]) {
          await page.locator('#related-workspace').evaluate((node, width) => { node.style.width = `${width}px` }, width)
          const table = await page.locator('.dsh-record-related-collection > .dsh-design-form-group-content > .dsh-related-record-table').evaluate(node => {
            const collection = node.parentElement, style = getComputedStyle(collection)
            return { width: node.getBoundingClientRect().width,
              available: collection.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) }
          })
          assert.equal(table.width, table.available, 'the independently compared property table keeps its available workspace width')
          const collections = await page.locator('.dsh-record-related-collection,.dsh-record-inherited-related').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor))
          assert.ok(collections.every(color => color === (scheme === 'light' ? 'rgb(241, 241, 241)' : 'rgb(48, 48, 52)')), 'own and inherited permission tables share the same supporting collection surface')
          const tables = await page.locator('.dsh-related-record-table table').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor))
          assert.ok(tables.every(color => color === (scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(25, 25, 28)')), 'complete editable and inherited table bodies use the base surface')
          const headings = await page.locator('.dsh-design-form-group-title,.dsh-record-related-collection > header > h3,.dsh-record-inherited-related > header > h3')
            .evaluateAll(nodes => nodes.map(node => { const s = getComputedStyle(node); return { size: s.fontSize, weight: s.fontWeight, line: s.lineHeight } }))
          assert.equal(headings.length, 4)
          for (const heading of headings) assert.deepEqual(heading, { size: '14px', weight: '500', line: '20px' },
            `${locale}/${scheme}/${width}: ownership and inheritance do not promote a child collection above its sibling groups`)
          assert.equal(await page.locator('[data-panel-title="editable"]').first().evaluate(node => getComputedStyle(node).fontWeight), '600',
            'the current record title retains its distinct scope')
        }
      }
    }
  } finally { await browser.close() }
})

test('question and board containers use the same surface direction in Host themes', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) {
      const title = locale === 'zh-CN' ? '当负责人暂缓处理一条请求时，客户会看到什么信息？' : 'What does a customer see when the lead defers a request?'
      const answer = locale === 'zh-CN' ? '不会。决定保存与送达分开，失败记录可以重试。' : 'No. Saving the decision is separate from delivery, and failed deliveries can be retried.'
      const context = locale === 'zh-CN' ? '补充退回、并发、通知失败与 AI 草稿的边界。\n保留已经确认的负责人决定。' : 'Review the boundaries of returned requests, concurrent decisions, notification failures and AI drafts.\nKeep the decisions that the lead has already confirmed.'
      const questions = createElement(StandardQuestionWorkspace, {
        groups: [{ id: 'current', label: '2', title, description: context, questionIds: ['first', 'second', 'empty', 'grouped'] }],
        questions: ['first', 'second', 'empty', 'grouped'].map(id => ({ id, prompt: title, kind: 'text', answer: id === 'empty' ? '' : answer })),
        cardGroups: [{ id: 'real-group', title, questionIds: ['grouped'] }], editable: true,
        // The real Host offers Edit AND Skip, not just a short Edit label.
        onRejectedChange: () => {},
      })
      const board = createElement(RecordBoard, {
        node: { id: 'board', component: 'record_board', source: 'items', board: { label: 'name', description: 'notes', group: 'group' } },
        manifest: { version: 1, panel_kind: 'document', sections: [{ id: 'items', title }], fields: [] },
        data: { items: {
          first: { name: title, notes: answer, group: title },
          empty: { name: title, notes: '', group: title },
          list: { name: title, notes: `- ${answer}\n- ${answer}`, group: title },
        } }, render: () => null,
      })
      const html = renderToStaticMarkup(createElement(PanelLocaleContext.Provider, { value: locale },
        createElement('div', { className: 'dsh-design-root' },
          createElement('div', { className: 'dsh-design-panel', style: { height: 650 } }, questions),
          createElement('div', { id: 'surface-board', className: 'dsh-design-panel' }, board),
          createElement('div', { id: 'surface-readonly', className: 'dsh-design-panel' },
            createElement(StandardQuestionList, { questions: [{ id: 'readonly', prompt: title, kind: 'text', answer }] })))))
      await page.setContent('<style>' + css + '</style>' + html)
      for (const scheme of ['light', 'dark']) {
        await page.evaluate(scheme => {
          document.documentElement.style.colorScheme = scheme
          // Actual Host aliases: layer 1 can equal the card, and l1 is only a
          // quiet separator. A full record must retain its own readable edge.
          const light = scheme === 'light'
          document.body.style.setProperty('--dsw-alias-bg-base', light ? '#fff' : '#151517')
          document.body.style.setProperty('--dsw-alias-bg-layer-1', light ? '#fff' : '#151517')
          document.body.style.setProperty('--dsw-alias-border-l1', light ? '#0000000a' : '#ffffff0a')
          document.body.style.setProperty('--dsw-alias-border-l2', light ? '#0000001a' : '#ffffff1a')
        }, scheme)
        for (const width of [1040, 568]) {
          await page.locator('.dsh-design-panel').evaluateAll((nodes, width) => { nodes.forEach(node => { node.style.width = width + 'px' }) }, width)
          const reading = await page.evaluate(() => {
            const card = document.querySelector('[data-question-id="first"]')
            const heading = card.querySelector('.dsh-standard-question-heading .dsh-panel-disclosure-label'), answer = card.querySelector('.dsh-standard-question-result > div')
            const style = getComputedStyle(card), result = getComputedStyle(answer)
            const boardGroup = getComputedStyle(document.querySelector('#surface-board .dsh-record-board-group'))
            const boardCard = getComputedStyle(document.querySelector('#surface-board [data-board-record]'))
            const groupTitle = document.querySelector('#surface-board .dsh-panel-disclosure-label')
            const record = document.querySelector('#surface-board [data-board-record]')
            const box = node => node.getBoundingClientRect()
            const cardBox = box(card), second = box(document.querySelector('[data-question-id="second"]'))
            const channels = color => color.match(/[\d.]+/g).map(Number)
            // Plain records still need a visible edge when the Host's base and
            // workspace coincide. Titled containers instead use a shared fill.
            const bg = channels(boardCard.backgroundColor), border = channels(boardCard.borderTopColor)
            const alpha = border[3] ?? 1
            const painted = border.slice(0, 3).map((value, i) => value * alpha + bg[i] * (1 - alpha))
            const lum = channels => channels.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
              .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
            const a = lum(bg), b = lum(painted)
            const header = box(document.querySelector('.dsh-panel-header-heading'))
            const context = document.querySelector('.dsh-panel-header-context'), contextStyle = getComputedStyle(context)
            const recordHeader = box(document.querySelector('.dsh-design-record-header')), meta = box(document.querySelector('.dsh-panel-header-meta'))
            const control = getComputedStyle(document.querySelector('.dsh-standard-question-answer-shell'))
            const questionHeader = box(card.querySelector('.dsh-standard-question-header'))
            const questionHeading = box(card.querySelector('.dsh-standard-question-heading'))
            const actions = card.querySelector('.dsh-standard-question-actions')
            return { edgeContrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
              inset: parseFloat(result.paddingLeft), readingTopPadding: parseFloat(result.paddingTop),
              itemBackground: result.backgroundColor, recordBackground: style.backgroundColor, itemColor: result.color,
              boardContainer: boardGroup.backgroundColor, boardContent: boardCard.backgroundColor,
              questionTextToContent: box(answer).top - box(heading).bottom,
              groupTextToContent: box(record).top - box(groupTitle).bottom,
              recordTitleToBody: box(record.querySelector('.dsh-record-board-description')).top - box(record.querySelector('header')).bottom,
              emptyDescriptionGap: getComputedStyle(document.querySelector('#surface-board [data-board-record="empty"] .dsh-record-board-description')).marginTop,
              listTitleToBody: (() => { const card = document.querySelector('#surface-board [data-board-record="list"]'); return box(card.querySelector('.dsh-record-board-description > ul')).top - box(card.querySelector('header')).bottom })(),
              actionHeights: [...card.querySelectorAll('.dsh-standard-question-actions button')].map(node => box(node).height),
              itemContrast: (() => { const text = lum(channels(result.color)), fill = lum(channels(result.backgroundColor)); return (Math.max(text, fill) + .05) / (Math.min(text, fill) + .05) })(),
              answerLeft: box(answer).left, headingLeft: box(heading).left, cardLeft: cardBox.left, headerLeft: header.left,
              answerGap: box(answer).top - box(card.querySelector('.dsh-standard-question-header')).bottom, cardGap: second.top - cardBox.bottom,
              inputBorder: parseFloat(control.borderTopWidth), inputPadding: parseFloat(control.paddingLeft),
              questionHeading: { width: questionHeading.width, bottom: questionHeading.bottom },
              questionHeaderWidth: questionHeader.width, actionsTop: box(actions).top,
              disclosureRightGap: questionHeader.right - box(card.querySelector('.dsh-standard-question-header > .dsh-panel-disclosure-icon')).right,
              actionVisibility: [...actions.querySelectorAll('button')].map(node => getComputedStyle(node).opacity),
              context: { text: context.textContent, left: box(context).left, top: box(context).top, bottom: box(context).bottom, size: contextStyle.fontSize, weight: contextStyle.fontWeight },
              contextGap: box(context).top - Math.max(header.bottom, meta.bottom), headerBottom: recordHeader.bottom, cardTop: cardBox.top,
              overflow: card.scrollWidth > card.clientWidth + 1 }
          })
          assert.ok(reading.edgeContrast > 1.2, `${locale}/${scheme}/${width}: a record edge is not the Host's faint separator`)
          assert.equal(reading.cardLeft, reading.headerLeft, 'workspace owns its gutter once; the list does not add a second inset')
          assert.equal(reading.answerLeft, reading.headingLeft, 'the answer item boundary aligns with its question; its own padding expresses the inner reading level')
          assert.equal(reading.inset, 12)
          assert.equal(reading.readingTopPadding, width === 568 ? 6 : 8)
          assert.notEqual(reading.itemBackground, reading.recordBackground, 'an actual answer stays distinguishable from its record title surface')
          assert.equal(reading.recordBackground, reading.boardContainer, 'question headings and board headings share the same supporting surface')
          assert.equal(reading.itemBackground, reading.boardContent, 'answers and function content share the base surface, not an inverse inset')
          assert.equal(reading.recordTitleToBody, width === 568 ? 6 : 8, 'record names and their descriptions use the same title-to-content gap')
          assert.equal(reading.emptyDescriptionGap, '0px', 'an absent description does not create an empty content gap')
          assert.equal(reading.listTitleToBody, reading.recordTitleToBody, 'Markdown outer margins do not add a second title-to-content gap')
          assert.ok(reading.actionHeights.every(height => height >= 26), 'unifying the title row does not shrink actual action targets')
          if (width === 1040) assert.equal(reading.questionTextToContent, reading.groupTextToContent, 'same-row headings have the same visible text-to-content distance, not just the same CSS gap')
          assert.ok(reading.itemContrast >= 4.5, 'answer text remains readable on its resolved inner surface')
          assert.ok(reading.answerGap > 0 && reading.answerGap < reading.cardGap, 'within-question proximity differs from between-question separation')
          assert.ok(reading.inputBorder > 0 && reading.inputPadding > 0, 'editable answers keep their actual input boundary')
          assert.equal(reading.overflow, false)
          assert.equal(reading.disclosureRightGap, 0, 'the disclosure stays at the far right of the whole header, after actions')
          assert.equal(reading.context.text, context, 'the shared context preserves all authored background and line breaks')
          assert.equal(reading.context.left, reading.headerLeft, 'background shares the title and body gutter')
          assert.equal(reading.context.weight, '400')
          assert.equal(reading.context.size, '12px', 'supporting context uses the shared auxiliary size at both densities')
          assert.equal(reading.contextGap, width === 568 ? 6 : 8, 'the shared title uses the existing within-group spacing')
          assert.ok(reading.headerBottom > reading.context.bottom && reading.cardTop >= reading.headerBottom, 'multi-line context grows the header without covering the first question')
          if (width === 568) {
            assert.ok(reading.questionHeading.width >= reading.questionHeaderWidth - 24 - 1, 'narrow questions reserve only the 16px disclosure and its 8px gap; actions occupy their own row')
            assert.ok(reading.actionsTop >= reading.questionHeading.bottom, 'secondary actions do not overlap a long question')
            assert.ok(reading.actionVisibility.every(opacity => opacity === '1'), 'a separate narrow action row is useful, not an invisible spacer')
            await page.locator('[data-question-id="first"] > summary').focus()
            await page.keyboard.press('Tab')
            assert.equal(await page.locator('[data-question-id="first"] button').first().evaluate(node => node === document.activeElement), true, 'original actions remain keyboard reachable after the native disclosure')
          }
          if (width === 1040) {
            // Test the last visible line too: a minimum row height alone would
            // pass short titles but lose the breathing room as soon as they wrap.
            for (const text of [title.repeat(5), title]) {
              await page.evaluate(text => {
                document.querySelector('[data-question-id="first"] .dsh-standard-question-heading .dsh-panel-disclosure-label').textContent = text
                document.querySelector('[data-question-id="readonly"] .dsh-standard-question-heading .dsh-panel-disclosure-label').textContent = text
                document.querySelector('#surface-board .dsh-panel-disclosure-label').textContent = text
              }, text)
              const measure = () => page.evaluate(() => {
                const endGap = (title, content) => content.getBoundingClientRect().top - title.getBoundingClientRect().bottom
                return ['first', 'readonly'].map(id => {
                  const card = document.querySelector(`[data-question-id="${id}"]`)
                  return endGap(card.querySelector('.dsh-standard-question-heading .dsh-panel-disclosure-label'), card.querySelector('.dsh-panel-reading-item'))
                }).concat(endGap(document.querySelector('#surface-board .dsh-panel-disclosure-label'), document.querySelector('#surface-board [data-board-record]')))
              })
              assert.deepEqual(await measure(), [12, 12, 12], 'short or wrapped titles retain the same final-line spacing, with or without actions')
              await page.locator('[data-question-id="first"]').hover()
              await page.locator('[data-question-id="first"] button').first().focus()
              assert.deepEqual(await measure(), [12, 12, 12], 'revealing actions on hover/focus does not shift the title or answer')
            }
          }
        }
      }
    }
  } finally { await browser.close() }
})

test('nested record forms retain their own boundaries and share title-to-body rhythm across real Bundles', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 2000, height: 1000 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    const sources = await Promise.all(['business_data', 'ai_agent_capabilities'].map(async name => {
      const bundle = new URL(`../../skills-web-app/bundles/${name}/`, import.meta.url)
      const manifest = parsePanelManifest(await readFile(new URL('panel.yaml', bundle), 'utf8'))
      manifest.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale => [locale,
        JSON.parse(await readFile(new URL(`locales/${locale}.json`, bundle), 'utf8'))])))
      return { name, manifest }
    }))
    for (const locale of ['zh-CN', 'en-US']) for (const editable of [true, false]) {
      const views = await Promise.all(sources.map(async ({ name, manifest }) => {
        const data = JSON.parse(await readFile(new URL(`../../../examples/web-app-panel-review/${locale}/design_files/${name}/${name}.json`, import.meta.url), 'utf8'))
        return createElement('div', { key: name, id: name, className: 'dsh-design-root', style: { height: 750 } },
          renderManifest(manifest, data, { locale, editable, onPanelUpdate: () => {} }))
      }))
      // Two views of the same neutral record have neither an authored body nor
      // a form header. Their field containers must still be real layout boxes.
      const projection = { version: 1, panel_kind: 'document',
        sections: ['items', 'details'].map(id => ({ id, title: id, records_path: 'items' })),
        fields: ['name', 'notes', 'scope'].map(key => ({ key, label: key, control: 'text', applies_to: [key === 'name' ? 'items' : 'details'] })),
        ui: { component: 'record_workspace', id: 'projection', sources: ['items'], children: [
          { component: 'record_inspector', id: 'projection-details', sources: ['items', 'details'] },
        ] } }
      views.push(createElement('div', { key: 'projection', id: 'projection', className: 'dsh-design-root', style: { height: 750 } },
        renderManifest(projection, { items: { one: { name: 'Item', notes: 'Notes', scope: 'Scope' } } }, { locale, editable, onPanelUpdate: () => {} })))
      const related = { ...projection, sections: [{ id: 'parents', title: 'Parents' }, ...projection.sections],
        fields: [...projection.fields, { key: 'owner', control: 'record_select', options_from_section: 'parents', hidden: true, applies_to: ['details'] }],
        ui: { component: 'record_workspace', id: 'related', sources: ['parents', 'details'], children: [
          { component: 'record_inspector', id: 'related-inspector', children: [
            { component: 'record_related_editor', id: 'related-records', source: 'details', sources: ['items', 'details'], bindings: { reference: 'owner' } },
          ] },
        ] } }
      views.push(createElement('div', { key: 'related', id: 'related', className: 'dsh-design-root', style: { height: 750 } },
        renderManifest(related, { parents: { p: { title: 'Parent' } }, items: {
          one: { name: 'First item', notes: 'First notes', scope: 'First scope', owner: 'p' },
          two: { name: 'Second item', notes: 'Second notes', scope: 'Second scope', owner: 'p' },
        } }, { locale, editable, onPanelUpdate: () => {} })))
      await page.setContent('<style>' + css + '</style>' + renderToStaticMarkup(createElement('div', null, ...views)))
      for (const scheme of ['light', 'dark']) for (const width of [1800, 1040, 568]) {
        await page.evaluate(({ scheme, width }) => {
          document.documentElement.style.colorScheme = scheme
          document.querySelectorAll('.dsh-design-root').forEach(node => { node.style.width = `${width}px` })
        }, { scheme, width })
        const measures = await page.locator('.dsh-record-inspector-content > .dsh-design-record-form > .dsh-design-record > .dsh-design-record-fields').evaluateAll(bodies => bodies.map(body => ({
          source: body.closest('.dsh-design-root').id, width: body.getBoundingClientRect().width,
          available: body.parentElement.getBoundingClientRect().width,
        })))
        for (const source of ['business_data', 'ai_agent_capabilities']) {
          const body = measures.find(value => value.source === source)
          assert.ok(body, `${source}: actual detail body is present`)
          assert.equal(body.width, body.available, `${source}: detail fields fill their allocated body, independent of an authored form.body`)
        }
        const projected = await page.locator('#projection .dsh-record-inspector-views .dsh-design-record-fields').evaluateAll(bodies => bodies.map(body => {
          const record = body.parentElement, style = getComputedStyle(record)
          return { width: body.getBoundingClientRect().width,
            available: record.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            border: parseFloat(style.borderTopWidth), background: style.backgroundColor,
            gap: body.children.length > 1 ? body.children[1].getBoundingClientRect().top - body.children[0].getBoundingClientRect().bottom : null }
        }))
        assert.equal(projected.length, 2, 'the ungrouped same-record projections retain both field views')
        for (const body of projected) {
          assert.equal(body.width, body.available, 'implicit projection fields use the full allocated body')
          assert.equal(body.border, 0, 'a second view of the same current object does not acquire an unrelated record-card boundary')
          assert.equal(body.background, 'rgba(0, 0, 0, 0)')
          if (body.gap !== null) assert.equal(body.gap, width === 568 ? 12 : 16, 'the parent owns field separation once, without extra child margins')
        }
        const relatedCards = await page.locator('#related .dsh-record-related-collection > .dsh-design-form-group-content > .dsh-design-record-form > .dsh-panel-content-card').evaluateAll(cards => cards.map(card => ({
          id: card.dataset.record, background: getComputedStyle(card).backgroundColor,
          border: getComputedStyle(card).borderTopWidth, padding: getComputedStyle(card).paddingLeft,
          overflow: card.scrollWidth > card.clientWidth + 1,
          projections: [...card.querySelectorAll('.dsh-record-inspector-views [data-record]')].map(node => ({
            id: node.dataset.record, border: getComputedStyle(node).borderTopWidth, background: getComputedStyle(node).backgroundColor,
          })),
        })))
        assert.deepEqual(relatedCards.map(card => card.id), ['one', 'two'])
        for (const card of relatedCards) {
          assert.equal(card.background, scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(25, 25, 28)')
          assert.equal(card.border, '1px')
          assert.equal(card.padding, width === 568 ? '12px' : '16px', 'real CSS resolves the complete card inset')
          assert.equal(card.overflow, false)
          assert.deepEqual(card.projections, [{ id: card.id, border: '0px', background: 'rgba(0, 0, 0, 0)' }], 'same-record projections stay inside their owning card')
        }
        const metrics = await page.locator('.dsh-record-map:not(.is-compact)').evaluateAll(maps => maps.flatMap(map => {
          const card = [...map.children].find(node => node.matches('section, details[open]') && node.querySelector('.dsh-record-map-body') && node.getBoundingClientRect().height > 0)
          if (!card) return []
          const header = card.querySelector(':scope > :is(header, summary)'), body = card.querySelector(':scope > .dsh-record-map-body')
          const fields = [...body.children], style = getComputedStyle(card), box = node => node.getBoundingClientRect()
          const heading = card.querySelector('.dsh-record-map-heading')
          return [{ source: `${map.closest('.dsh-design-root').id}:${map.dataset.recordMap}`,
            background: style.backgroundColor, border: parseFloat(style.borderTopWidth), radius: style.borderRadius,
            bodyBackground: getComputedStyle(body).backgroundColor, gap: box(body).top - box(header).bottom,
            fieldGap: fields.length > 1 ? box(fields[1]).top - box(fields[0]).bottom : null,
            inset: heading ? getComputedStyle(heading).paddingInlineStart : null,
            physicalInsets: heading ? [getComputedStyle(heading).paddingLeft, getComputedStyle(heading).paddingRight] : null,
            labelWeight: heading ? getComputedStyle(heading).fontWeight : null,
            actionSizes: [...header.querySelectorAll('.dsh-design-record-actions button')].map(button => [box(button).width, box(button).height]),
            arrowRightGap: header.tagName === 'SUMMARY' ? box(header).right - box(header.lastElementChild).right : 0,
            overflow: card.scrollWidth > card.clientWidth + 1 }]
        }))
        for (const source of ['business_data:fields', 'ai_agent_capabilities:entries']) {
          assert.ok(metrics.some(value => value.source === source), `${locale}/${editable}/${scheme}/${width}: ${source} includes its expanded typed form`)
        }
        const fieldWeights = await page.locator('#ai_agent_capabilities .dsh-design-field:not(.is-card-collection) > .dsh-design-field-label').evaluateAll(labels => labels.map(label => ({
          field: label.parentElement.dataset.field, weight: getComputedStyle(label).fontWeight,
        })))
        for (const key of ['actions', 'knowledge_resource_refs', 'context']) {
          assert.ok(fieldWeights.some(label => label.field === key), `${key} has a real field caption`)
          assert.equal(fieldWeights.find(label => label.field === key).weight, '400', 'ordinary captions do not gain emphasis from their control type')
        }
        const collections = page.locator('.dsh-design-field.is-card-collection.dsh-panel-content-group')
        assert.ok(await collections.count() >= 3, 'business fields/states and AI entries share the collection foundation')
        for (const collection of await collections.all()) {
          assert.equal(await collection.evaluate(node => getComputedStyle(node).backgroundColor), scheme === 'light' ? 'rgb(241, 241, 241)' : 'rgb(48, 48, 52)')
          assert.equal(await collection.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, 'collection framing preserves narrow layouts')
        }
        for (const value of metrics) {
          assert.equal(value.background, scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(25, 25, 28)', 'a complete child object retains the base record surface')
          assert.equal(value.border, 1)
          assert.equal(value.radius, '8px')
          assert.equal(value.bodyBackground, 'rgba(0, 0, 0, 0)', 'a layout body does not add a decorative inner card')
          assert.equal(value.gap, width === 568 ? 6 : 8, `${locale}/${scheme}/${width}: the title belongs to its body`)
          if (value.fieldGap !== null) assert.equal(value.fieldGap, width === 568 ? 12 : 16, 'independent fields keep their larger separation')
          if (value.inset !== null) {
            assert.equal(value.inset, '0px'); assert.deepEqual(value.physicalInsets, ['0px', '0px'])
            assert.equal(value.labelWeight, '500')
          }
          for (const size of value.actionSizes) assert.deepEqual(size, [32, 32], 'shared title spacing must not shrink operation targets')
          assert.equal(value.overflow, false)
          assert.equal(value.arrowRightGap, 0, 'nested record disclosure follows actions at the far right')
        }
      }
      const collaboration = page.locator('#ai_agent_capabilities [data-field="collaborations"]')
      assert.equal(await collaboration.evaluate(node => node.classList.contains('is-label-visually_hidden')), true)
      assert.equal(await collaboration.evaluate(node => node.classList.contains('dsh-panel-content-group')), false, 'the authored section owns the shared supporting surface once')
      assert.equal(await page.locator('#ai_agent_capabilities [data-field="entries"] > .dsh-design-field-description').count(), 0)
      assert.equal(await page.locator('#ai_agent_capabilities [data-field="entries"] > summary .dsh-panel-help button').count(), 1, 'supplementary help lives beside the collection caption')
      const summary = page.locator('#ai_agent_capabilities details.dsh-design-form-group')
        .filter({ has: page.locator('[data-field="collaborations"]') }).locator(':scope > summary')
      assert.equal(await summary.count(), 1, 'the sole-field caption belongs to one native group summary')
      assert.equal(await summary.evaluate(node => node.parentElement.open), true, 'the content group starts expanded')
      await summary.focus()
      await page.keyboard.press('Enter')
      assert.equal(await summary.evaluate(node => node.parentElement.open), false, 'the native disclosure closes through its keyboard entry')
      assert.equal(await summary.evaluate(node => getComputedStyle(node.parentElement).backgroundColor), 'rgb(48, 48, 52)', 'a predefined collapsible section supports its base records with the shared muted surface')
      await page.keyboard.press('Space')
      assert.equal(await summary.evaluate(node => node.parentElement.open), true)
      if (editable) {
        const add = page.locator('#ai_agent_capabilities .dsh-token-add-trigger').first()
        assert.ok(await add.evaluate(node => node.getBoundingClientRect().height < 70), 'a label-only add action does not reserve an empty 80px description block')
      }
    }
  } finally { await browser.close() }
})

test('question and record-list workspaces fill their allocated content without a separate reading cap', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 2000, height: 1000 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const name of ['smart_questions', 'function_modules']) {
      const { manifest, data } = await loadTypographyBundle(name)
      for (const locale of ['zh-CN', 'en-US']) {
        await page.setContent('<style>' + css + '</style>' + renderToStaticMarkup(createElement('div', {
          className: 'dsh-design-root', style: { height: 850 },
        }, renderManifest(manifest, data, { locale, editable: true, onPanelUpdate() {} }))))
        for (const width of [1800, 568]) {
          await page.locator('.dsh-design-root').evaluate((node, width) => { node.style.width = `${width}px` }, width)
          const sizes = await page.locator('.dsh-question-workspace-content > .dsh-standard-question-list, .dsh-record-board-content > .dsh-record-board-group').evaluateAll(nodes => nodes.map(node => {
            const parent = node.parentElement, style = getComputedStyle(parent)
            return { width: node.getBoundingClientRect().width,
              available: parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) }
          }))
          assert.ok(sizes.length, `${name}: real content groups are present`)
          for (const size of sizes) assert.equal(size.width, size.available, `${name}/${locale}/${width}: ordinary content follows the workspace allocation`)
        }
      }
    }
  } finally { await browser.close() }
})

test('a detail form and its own and inherited permission groups fill the allocated reading width', async () => {
  const { manifest, data } = await loadTypographyBundle('role_access')
  // Select the deepest role on initial render, retaining the actual hierarchy,
  // related editor and table declarations rather than fabricating CSS boxes.
  const child = Object.values(data.inheritances).find(edge => edge.source === 'ROLE-003').source
  data.role_order = [child, ...data.role_order.filter(id => id !== child)]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 2000, height: 1000 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) for (const editable of [true, false]) {
      await page.setContent('<style>' + css + '</style>' + renderToStaticMarkup(createElement('div', {
        className: 'dsh-design-root', style: { height: 850 },
      }, renderManifest(manifest, data, { locale, editable, onPanelUpdate() {} }))))
      for (const width of [1800, 1040, 568]) {
        await page.locator('.dsh-design-root').evaluate((node, width) => { node.style.width = `${width}px` }, width)
        const geometry = await page.locator('.dsh-record-inspector').evaluate(inspector => {
          const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, width: r.width } }
          const body = inspector.querySelector('.dsh-record-inspector-content .dsh-design-record-fields')
          return { body: rect(body), available: body.parentElement.getBoundingClientRect().width,
            groups: [...inspector.querySelectorAll('.dsh-record-inherited-related, .dsh-record-related-collection')].map(rect),
            header: rect(inspector.querySelector('.dsh-design-record-header')),
            inspectorOverflow: inspector.scrollWidth > inspector.clientWidth + 1 }
        })
        assert.equal(geometry.groups.length, 3, 'both ancestor collections and the own collection are exercised')
        assert.equal(geometry.body.width, geometry.available)
        for (const group of geometry.groups) assert.deepEqual(group, geometry.body,
          `${locale}/${editable}/${width}: same-level form, inherited and table groups have the same reading edges`)
        assert.equal(geometry.inspectorOverflow, false, 'wide columns scroll inside their table, not the entire detail')
        assert.ok(geometry.header.width >= geometry.body.width,
          'the original header and source-role action retain their existing geometry')
        const table = page.locator('.dsh-record-related-collection .dsh-related-record-table')
        const scrolled = await table.evaluate(node => {
          node.scrollLeft = node.scrollWidth
          const cell = node.querySelector('tbody tr td:last-child').getBoundingClientRect()
          const box = node.getBoundingClientRect()
          return { right: cell.right, containerRight: box.right, scroll: node.scrollLeft, width: node.clientWidth, full: node.scrollWidth }
        })
        assert.ok(scrolled.right <= scrolled.containerRight + 1, 'the last table column remains reachable')
        if (width === 568) assert.ok(scrolled.full > scrolled.width && scrolled.scroll > 0, 'narrow details retain useful column sizes and local scrolling')
        const group = page.locator('.dsh-record-related-collection')
        await group.locator(':scope > summary').click()
        assert.equal(await group.evaluate(node => node.open), false)
        assert.equal(await group.evaluate(node => node.getBoundingClientRect().width), geometry.body.width, 'collapsing does not change group width')
        await group.locator(':scope > summary').click()
      }
    }
  } finally { await browser.close() }
})

test('semantic disclosure sections share surfaces and stable actions while continuous decision forms stay ungrouped', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) for (const editable of [true, false]) {
      const views = await Promise.all([
        ['skills-web-app', 'ai_agent_capabilities', 'agents'],
        ['skills-web-app', 'function_modules'],
        ['skills-decision-modeling', 'decision_rules', 'rules'],
      ].map(async ([pkg, name, section]) => {
        const base = new URL(`../../${pkg}/bundles/${name}/`, import.meta.url)
        const manifest = parsePanelManifest(await readFile(new URL('panel.yaml', base), 'utf8'))
        manifest.i18n.messages = { [locale]: JSON.parse(await readFile(new URL(`locales/${locale}.json`, base), 'utf8')) }
        const data = JSON.parse(await readFile(pkg === 'skills-web-app'
          ? new URL(`../../../examples/web-app-panel-review/${locale}/design_files/${name}/${name}.json`, import.meta.url)
          : new URL('reference/preview.json', base), 'utf8'))
        return createElement('div', { key: name, id: name, className: 'dsh-design-root' }, renderManifest({ ...manifest,
          ui: section ? { id: name, component: 'record_form', source: section } : manifest.ui,
        }, data, { locale, editable, onPanelUpdate: () => {} }))
      }))
      await page.setContent('<style>' + css + '</style>' + renderToStaticMarkup(createElement('div', null, ...views)))
      const action = page.locator('#ai_agent_capabilities [data-field="actions"]').first()
      assert.equal(await action.locator('xpath=ancestor::details').evaluate(node => node.open), true, 'primary behavior uses the same chapter shell and is initially readable')
      for (const scheme of ['light', 'dark']) for (const width of [1040, 360]) {
        await page.evaluate(({ scheme, width }) => {
          document.documentElement.style.colorScheme = scheme
          document.querySelectorAll('.dsh-design-root').forEach(node => { node.style.width = `${width}px` })
        }, { scheme, width })
        assert.equal(await page.locator('#decision_rules details.dsh-design-form-group').count(), 0, 'continuous decision rules do not retain an isolated technical group')
        for (const key of ['object_ref', 'relation_ref', 'dataset_ref', 'expression']) assert.ok(await page.locator(`#decision_rules [data-field="${key}"]`).count() > 0, `${key} remains in the continuous form`)
        for (const id of ['ai_agent_capabilities']) {
          const groups = page.locator(`#${id} details.dsh-design-form-group`)
          const section = (id === 'ai_agent_capabilities'
            ? groups.filter({ has: page.locator('[data-field="context"]') }) : groups).first()
          const summary = section.locator(':scope > summary')
          const measure = () => section.evaluate(node => {
            const s = node.querySelector('summary'), box = x => x.getBoundingClientRect()
            return { bg: getComputedStyle(node).backgroundColor, width: box(node).width,
              overflow: node.scrollWidth > node.clientWidth + 1,
              right: box(s.querySelector('.dsh-panel-disclosure-icon')).right - box(node).left,
              gap: node.open ? box(node.querySelector('.dsh-design-form-group-content')).top - box(s.querySelector('.dsh-panel-disclosure-label')).bottom : null }
          })
          if (await section.evaluate(node => node.open)) await summary.press('Enter')
          const closed = await measure()
          assert.equal(closed.bg, scheme === 'light' ? 'rgb(241, 241, 241)' : 'rgb(48, 48, 52)')
          assert.equal(closed.overflow, false)
          await summary.hover()
          assert.equal(await summary.evaluate(node => getComputedStyle(node).backgroundColor), scheme === 'light' ? 'rgb(235, 235, 235)' : 'rgb(56, 56, 61)')
          await summary.focus()
          await page.keyboard.press('Enter')
          const opened = await measure()
          assert.equal(opened.right, closed.right, 'hiding a filled-field count does not move the disclosure glyph')
          assert.equal(opened.gap, width === 360 ? 6 : 8)
          assert.equal(opened.overflow, false)
          const body = section.locator('.dsh-design-form-group-fields.dsh-panel-content-card').first()
          assert.equal(await body.evaluate(node => getComputedStyle(node).backgroundColor), scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(25, 25, 28)', 'labels, explanations and controls belong to a whole content surface')
          assert.ok(await body.locator('[data-field]').count() > 0)
          assert.equal(await summary.evaluate(node => getComputedStyle(node).outlineWidth), '2px')
          await page.keyboard.press('Space')
          assert.equal(await section.evaluate(node => node.open), false)
          await section.click({ position: { x: 30, y: 6 } })
          assert.equal(await section.evaluate(node => node.open), true, 'the closed frame inset belongs to the same native hit target')
          await summary.press('Enter')
          assert.equal(await section.evaluate(node => node.open), false)
        }
        const child = page.locator('#ai_agent_capabilities .dsh-record-map[data-record-map="entries"] > details').first()
        assert.equal(await child.evaluate(node => getComputedStyle(node).backgroundColor), scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(25, 25, 28)', 'readonly and editable versions keep the same independent record surface')
        const fieldBody = action.locator('xpath=ancestor::div[contains(@class,"dsh-panel-content-card")]')
        const functionCard = page.locator('#function_modules .dsh-record-board-cards > .dsh-panel-content-card').first()
        const surface = locator => locator.evaluate(node => {
          const style = getComputedStyle(node)
          return { background: style.backgroundColor, border: style.borderTopWidth, radius: style.borderRadius, padding: style.paddingLeft }
        })
        assert.deepEqual(await surface(fieldBody), await surface(functionCard), 'a complete field body shares the Function content surface, not merely its input colors')
        assert.equal(await fieldBody.locator('[data-field="notes"]').count(), 1, 'related tables and notes occupy the same complete body')
        assert.equal(await action.locator('xpath=ancestor::details').evaluate(node => node.open), true)
        const collaborationCard = page.locator('#ai_agent_capabilities [data-field="collaborations"] [data-child-record]').first()
        assert.equal(await collaborationCard.locator('xpath=ancestor::*[contains(@class,"dsh-panel-content-card")]').count(), 0, 'an independent record has no redundant same-colored outer card')
      }
    }
  } finally { await browser.close() }
})

test('all declared form groups keep field roles and spacing across both Kits', async t => {
  const inputs = []
  let inventory = 0
  for (const pkg of ['skills-web-app', 'skills-decision-modeling']) {
    const base = new URL(`../../${pkg}/bundles/`, import.meta.url)
    for (const name of await readdir(base)) {
      const bundle = new URL(`${name}/`, base)
      let source
      try { source = await readFile(new URL('panel.yaml', bundle), 'utf8') } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      inventory++
      const manifest = parsePanelManifest(source)
      const sections = manifest.sections.filter(section => JSON.stringify(section.form?.body ?? []).includes('"kind":"group"'))
      if (!sections.length) continue
      const data = JSON.parse(await readFile(new URL('reference/preview.json', bundle), 'utf8'))
      manifest.i18n ??= { messages: {} }
      manifest.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale => [locale,
        JSON.parse(await readFile(new URL(`locales/${locale}.json`, bundle), 'utf8'))])))
      inputs.push({ name, manifest, data, sections })
    }
  }
  assert.equal(inventory, 23, 'inventory all current Panel declarations, including those without form disclosures')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) for (const editable of [false, true]) {
      const markup = inputs.map(({ name, manifest, data, sections }) => createElement('div', { key: name, id: name, className: 'dsh-design-root' },
        renderManifest({ ...manifest, ui: { component: 'stack', id: `${name}-forms`, children: sections.map(section => ({
          component: 'record_form', id: section.id, source: section.id,
        })) } }, data, { locale, editable, onPanelUpdate: () => {} })))
      await page.setContent('<!doctype html><style>' + css + '</style>' + renderToStaticMarkup(createElement('div', null, ...markup)))
      for (const scheme of ['light', 'dark']) for (const width of [1040, 360]) {
        await page.evaluate(({ scheme, width }) => {
          document.documentElement.style.colorScheme = scheme
          document.querySelectorAll('.dsh-design-root').forEach(node => { node.style.width = `${width}px` })
          document.querySelectorAll('details').forEach(node => { node.open = true })
        }, { scheme, width })
        const result = await page.locator('.dsh-design-form-group').evaluateAll(groups => groups.map(group => ({
          bundle: group.closest('.dsh-design-root').id,
          title: group.querySelector(':scope > .dsh-design-form-group-title')?.textContent,
          labels: [...group.querySelectorAll('.dsh-design-field > .dsh-design-field-label')].map(label => ({
            text: label.textContent, weight: getComputedStyle(label).fontWeight,
            collection: label.parentElement.classList.contains('is-card-collection'),
          })),
          stacks: [...group.querySelectorAll('.dsh-design-form-group-fields')].filter(node => node.children.length > 1).map(node => getComputedStyle(node).rowGap),
          descriptions: [...group.querySelectorAll('.dsh-design-field-description')].map(node => getComputedStyle(node).fontWeight),
        })))
        assert.ok(result.length > 0)
        for (const group of result) {
          for (const label of group.labels) assert.equal(label.weight, label.collection ? '500' : '400', `${locale}/${group.bundle}/${group.title}/${label.text}`)
          for (const gap of group.stacks) assert.equal(gap, width === 360 ? '12px' : '16px', `${group.bundle}: one shared field stack spacing`)
          for (const weight of group.descriptions) assert.equal(weight, '400', `${group.bundle}: descriptions stay ordinary weight`)
        }
      }
    }
    t.diagnostic(`Inspected ${inventory} declarations; inspected visible and expanded form groups in ${inputs.map(input => input.name).join(', ')}. Fixture geometry only; native workspaces have separate walkthrough evidence.`)
  } finally { await browser.close() }
})

test('structured reading and tuning disclosures own their spacing once', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) {
      const content = []
      for (const name of ['page_design', 'design_style']) {
        const base = new URL(`../../skills-web-app/bundles/${name}/`, import.meta.url)
        let manifest = parsePanelManifest(await readFile(new URL('panel.yaml', base), 'utf8'))
        manifest.i18n.messages = { [locale]: JSON.parse(await readFile(new URL(`locales/${locale}.json`, base), 'utf8')) }
        manifest = localizePanelManifest(manifest, locale)
        const data = JSON.parse(await readFile(new URL('reference/preview.json', base), 'utf8'))
        if (name === 'page_design') data.common_spec = {
          layout: 'Sidebar', logo: { name: 'Example', mark_ref: 'brand.svg' },
          navigation: [{ id: 'inbox', label: locale === 'zh-CN' ? '收件箱' : 'Inbox', icon_ref: 'inbox' }],
          visual_pattern_refs: [{ pattern: 'list', source: 'design_style' }], source: 'design_style',
        }
        // Inspect the workspace's actual child composition without its canvas
        // or iframe. Native opening and editing are checked in the live Host.
        const children = PANEL_COMPONENT_RENDERERS[manifest.ui.component](manifest.ui, manifest, data, { locale, editable: true, onPanelUpdate: () => {} }).props.children
        content.push(createElement('div', { key: name, id: name, className: 'dsh-design-root' },
          createElement('div', { className: 'dsh-design-panel' },
            createElement('div', { className: name === 'page_design' ? 'dsh-navigation-spec-content' : 'dsh-preview-adjustments-body' }, children))))
      }
      await page.setContent('<style>' + css + '</style>' + renderToStaticMarkup(createElement('div', null, ...content)))
      for (const width of [1800, 360]) for (const scheme of ['light', 'dark']) {
        await page.evaluate(({ width, scheme }) => {
          document.documentElement.style.colorScheme = scheme
          document.querySelectorAll('.dsh-design-panel').forEach(node => { node.style.width = `${width}px` })
          document.querySelectorAll('details').forEach(node => { node.open = true })
        }, { width, scheme })
        const result = await page.evaluate(() => {
          const box = node => node.getBoundingClientRect()
          const section = document.querySelector('.dsh-navigation-spec-section')
          const first = section.querySelector('.dsh-design-field-label')
          return {
            titleCount: section.querySelectorAll(':scope > summary,:scope > h3').length,
            labels: [...document.querySelectorAll('.dsh-design-structured-row > .dsh-design-field-label')].map(node => ({
              margin: getComputedStyle(node).marginBottom, weight: getComputedStyle(node).fontWeight,
            })),
            branches: [...document.querySelectorAll('.dsh-design-structured-branch')].map(node =>
              box(node.querySelector(':scope > .dsh-design-structured-branch-body')).top - box(node.querySelector(':scope > summary')).bottom),
            tuning: [...document.querySelectorAll('.dsh-preview-control-group > .dsh-design-form-group-content')].map(node =>
              box(node).top - box(node.previousElementSibling.querySelector('.dsh-panel-disclosure-label')).bottom),
          }
        })
        assert.equal(await page.locator('.dsh-navigation-spec-section').evaluate(node => {
          const parent = node.parentElement, style = getComputedStyle(parent)
          return node.getBoundingClientRect().width === parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        }), true, 'public specifications use the same available-width rule as ordinary content')
        assert.equal(result.titleCount, 0, `${locale}/${scheme}: the dedicated toolbar owns the only page title`)
        assert.ok(result.labels.length > 0 && result.branches.length > 0 && result.tuning.length > 0)
        result.labels.forEach(label => assert.deepEqual(label, { margin: '0px', weight: '400' }))
        for (const gap of [...result.branches, ...result.tuning]) assert.equal(gap, width === 360 ? 6 : 8,
          `${locale}/${scheme}: scalar, object and tuning disclosure bodies share the within-group gap`)
      }
    }
  } finally { await browser.close() }
})

test('optional record background grows with its content while ordinary editable headers retain their geometry', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const variant of ['detail', 'card']) {
      for (const context of [undefined, '  ', 'Current scope: confirm the decision and its owner.\nKeep notifications separate from the saved decision.']) {
        const html = renderToStaticMarkup(createElement('div', { className: 'dsh-design-root' },
          createElement('div', { className: 'dsh-design-panel', style: { width: 340 } },
            createElement('article', { className: `dsh-design-record has-form-header is-${variant}` },
              createElement(PanelRecordHeader, { variant, context },
                createElement(PanelEditableTitle, { value: 'Current record', onChange: () => {} })),
              createElement('div', { id: 'body' }, 'Record content')))))
        await page.setContent('<style>' + css + '</style>' + html)
        const geometry = await page.locator('.dsh-design-record-header').evaluate(header => {
          const box = node => node.getBoundingClientRect()
          const context = header.querySelector('.dsh-panel-header-context')
          return { height: box(header).height, input: box(header.querySelector('input')).height,
            pencil: box(header.querySelector('button')).height, overflow: header.scrollWidth > header.clientWidth + 1,
            context: context ? { text: context.textContent, bottom: box(context).bottom } : null,
            bottom: box(header).bottom, bodyTop: box(document.getElementById('body')).top }
        })
        assert.equal(geometry.input, 32)
        assert.equal(geometry.pencil, 24)
        assert.equal(geometry.overflow, false)
        if (context?.trim()) {
          assert.equal(geometry.context.text, context)
          assert.ok(geometry.bottom > geometry.context.bottom && geometry.bodyTop >= geometry.bottom, 'long context remains inside the header before the body')
        } else {
          assert.equal(geometry.context, null, 'missing background does not create a placeholder or empty row')
          assert.equal(geometry.height, variant === 'card' ? 40 : 44)
        }
      }
    }
  } finally { await browser.close() }
})

test('a background taller than the workspace and the last question share a reachable reading scroll path', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    const questions = Array.from({ length: 8 }, (_, i) => ({ id: String(i), prompt: `Question ${i + 1}`, kind: 'text', answer: `Saved answer ${i + 1}` }))
    const html = renderToStaticMarkup(createElement('div', { className: 'dsh-design-root' },
      createElement('div', { className: 'dsh-design-panel', style: { width: 568, height: 220 } },
        createElement(StandardQuestionWorkspace, { questions, editable: true, groups: [{ id: 'round', label: 'Round', title: 'Current scope',
          description: 'Keep the original decision and review its delivery separately.\n'.repeat(16) + 'End of background.', questionIds: questions.map(q => q.id) }] }))))
    await page.setContent('<style>' + css + '</style>' + html)
    const scroll = page.locator('.dsh-question-workspace-content')
    assert.ok(await scroll.evaluate(node => node.clientHeight > 0 && node.scrollHeight > node.clientHeight))
    assert.ok(await page.locator('.dsh-panel-header-context').evaluate(node => node.getBoundingClientRect().height > 220), 'this case actually exceeds the whole available height')
    await page.locator('[data-question-id="7"] button').first().focus()
    assert.ok(await scroll.evaluate(node => node.scrollTop > 220), 'the existing question action remains reachable beyond the entire background')
    assert.ok(await page.locator('[data-question-id="7"]').evaluate(node => {
      const rect = node.getBoundingClientRect(), viewport = node.closest('.dsh-question-workspace-content').getBoundingClientRect()
      return rect.top >= viewport.top && rect.bottom <= viewport.bottom
    }), 'the last answer is reachable in the same scroll owner')
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

async function loadTypographyBundle(name) {
  const bundle = new URL(`../../skills-web-app/bundles/${name}/`, import.meta.url)
  const manifest = parsePanelManifest(await readFile(new URL('panel.yaml', bundle), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale => [locale,
    JSON.parse(await readFile(new URL(`locales/${locale}.json`, bundle), 'utf8'))])))
  return { manifest, data: JSON.parse(await readFile(new URL('reference/preview.json', bundle), 'utf8')) }
}

test('direct record cards share persistent title actions and semantic body spacing', async () => {
  const snapshots = []
  for (const locale of ['zh-CN', 'en-US']) for (const name of ['function_modules', 'quality_acceptance']) {
    const { manifest, data } = await loadTypographyBundle(name)
    if (locale === 'en-US' && name === 'quality_acceptance') {
      data.requirements['AC-001'].title = 'Request missing information first'
      data.requirements['AC-002'].title = 'Return is different from decline'
    }
    for (const editable of [true, false]) snapshots.push({ locale, name, editable,
      html: renderToStaticMarkup(renderManifest(manifest, data, { locale, editable,
        onTransaction: () => assert.fail('rendering never edits data'), onPanelUpdate: () => {} })),
    })
  }
  const browser = await chromium.launch({ headless: true })
  try {
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const hasTouch of [false, true]) {
      const page = await browser.newPage({ hasTouch, viewport: { width: 1100, height: 1400 } })
      for (const snapshot of snapshots) for (const width of [1000, 584, 520]) {
        await page.setContent(`<style>${css}</style><div class="dsh-design-root"><div class="dsh-design-panel" style="width:${width}px;height:1200px">${snapshot.html}</div></div>`)
        await page.mouse.move(1090, 1390)
        const card = page.locator('[data-board-record]').first()
        const actions = card.locator(':scope > header > .dsh-design-record-actions button')
        const detail = `${snapshot.locale}/${snapshot.name}/${snapshot.editable}/${width}/touch=${hasTouch}`
        assert.equal(await actions.count(), snapshot.editable ? 3 : 0, `${detail}: move up/down and delete are in the title`)
        if (snapshot.editable) {
          const styles = await actions.evaluateAll(nodes => nodes.map(node => ({ opacity: getComputedStyle(node).opacity, height: node.getBoundingClientRect().height })))
          assert.ok(styles.every(value => value.opacity === '1' && value.height === 32), `${detail}: actions do not depend on hover`)
          assert.ok(await card.locator('textarea').count(), `${detail}: editable fields need no mode switch`)
        } else assert.equal(await card.locator('textarea').count(), 0, `${detail}: readonly stays readable`)
        assert.equal(await card.locator('.dsh-record-board-actions').count(), 0, 'the superseded local save layer is absent')
        const metrics = await card.evaluate(node => {
          const header = node.querySelector('header'), body = header.nextElementSibling
          const contentWidth = node.closest('.dsh-panel-workspace-main').getBoundingClientRect().width
          const compact = contentWidth <= 560
          const field = node.querySelector('.dsh-record-board-fields .dsh-design-field-label, .dsh-record-board-description-field .dsh-design-field-label, .dsh-record-facts h5')
          const fields = [...node.querySelectorAll('.dsh-record-board-fields > .dsh-design-field')]
          const title = node.querySelector('h4')
          return { compact, contentWidth, gap: body.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
            titleWeight: getComputedStyle(title).fontWeight,
            field: field && { size: getComputedStyle(field).fontSize, weight: getComputedStyle(field).fontWeight,
              color: getComputedStyle(field).color, expected: getComputedStyle(node).getPropertyValue('--ds-text-primary').trim() },
            firstElement: header.firstElementChild.className,
            fieldGaps: fields.slice(1).map((field, index) => field.getBoundingClientRect().top - fields[index].getBoundingClientRect().bottom),
            lastFieldMargin: fields.length ? getComputedStyle(fields.at(-1)).marginBottom : null,
          }
        })
        const structured = snapshot.name === 'quality_acceptance' || snapshot.editable
        assert.equal(metrics.gap, structured ? (metrics.compact ? 12 : 16) : (metrics.compact ? 6 : 8), `${detail}: named fields have section spacing; direct prose uses control spacing`)
        assert.equal(metrics.titleWeight, '500', `${detail}: title role is consistent`)
        if (structured) {
          assert.equal(metrics.field.size, metrics.compact ? '13px' : '14px', `${detail}: field labels are not captions`)
          assert.equal(metrics.field.weight, '400', `${detail}: field labels do not invent another bold hierarchy`)
          assert.equal(metrics.field.color, await card.evaluate(node => getComputedStyle(node).color), `${detail}: field labels use primary text`)
          for (const gap of metrics.fieldGaps) assert.equal(gap, metrics.compact ? 12 : 16, `${detail}: the container owns field spacing without stacked margins`)
          if (metrics.lastFieldMargin !== null) assert.equal(metrics.lastFieldMargin, '0px', `${detail}: no trailing field margin`)
        } else assert.match(metrics.firstElement, /dsh-record-board-id/, `${detail}: Function ID precedes its name`)
        if (structured && snapshot.editable && snapshot.locale === 'en-US') {
          const titles = await page.locator('[data-board-record] > header').evaluateAll(headers => headers.slice(0, 2).map(header => {
            const input = header.querySelector('input'), actions = header.querySelector('.dsh-design-record-actions')
            const style = getComputedStyle(input), context = document.createElement('canvas').getContext('2d')
            context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
            return { available: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
              textWidth: context.measureText(input.value).width,
              actionTop: actions.getBoundingClientRect().top, titleBottom: input.getBoundingClientRect().bottom }
          }))
          // Reproduce the 362px review slot. At still narrower native inputs,
          // full arbitrary-length values remain reachable through text editing.
          if (metrics.contentWidth >= 340) assert.ok(titles.every(title => title.textWidth <= title.available + 1), `${detail}: common English titles remain readable without focusing or scrolling: ${JSON.stringify(titles)}`)
          if (metrics.compact) assert.ok(titles.every(title => title.actionTop >= title.titleBottom), `${detail}: compact actions use their own row`)
        }
      }
      await page.close()
    }
  } finally { await browser.close() }
})

test('question review actions and nested editable records retain their interaction states', async () => {
  const snapshots = []
  for (const locale of ['zh-CN', 'en-US']) for (const state of ['reading', 'editing']) {
    const questions = createElement(PanelLocaleContext.Provider, { value: locale }, createElement(StandardQuestionList, {
      editable: true, collapseAnswered: state === 'reading', onRejectedChange: () => {},
      questions: [{ id: 'q', kind: 'text', prompt: locale === 'zh-CN' ? '如何处理退回？' : 'How should returned work be handled?', answer: 'Retain the current draft.' }],
    }))
    snapshots.push({ locale, name: 'question', state, html: `<div class="dsh-question-workspace-content">${renderToStaticMarkup(questions)}</div>` })
  }
  const map = createElement(RecordMap, { field: { key: 'states', label: 'States', control: 'record_map', order_field: 'order', item_collapsible: true,
    columns: [{ key: 'name', label: 'Name' }] }, record: { states: { draft: { name: 'Draft' } }, order: ['draft'] }, editable: true, onPatch: () => {} })
  snapshots.push({ name: 'nested form', state: 'editing', locale: 'en-US',
    html: `<div class="dsh-question-workspace-content"><article class="dsh-panel-record-action-context">${renderToStaticMarkup(map)}</article></div>` })
  const browser = await chromium.launch({ headless: true })
  try {
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const hasTouch of [false, true]) {
      const page = await browser.newPage({ hasTouch, viewport: { width: 1100, height: 1400 } })
      assert.equal(await page.evaluate(() => matchMedia('(hover: hover)').matches), !hasTouch)
      for (const snapshot of snapshots) for (const width of [800, 360]) {
        await page.setContent(`<style>${css}</style><div class="dsh-design-root"><div class="dsh-design-panel" style="width:${width}px">${snapshot.html}</div></div>`)
        await page.mouse.move(1090, 1390)
        const scope = snapshot.name === 'question' ? '.dsh-standard-question-header > .dsh-panel-record-actions'
          : '.dsh-record-map-heading > .dsh-panel-record-actions'
        const actions = page.locator(`${scope} button`)
        const visible = hasTouch || width === 360 || snapshot.state === 'editing'
        const details = `${snapshot.locale}/${snapshot.name}/${snapshot.state}/${width}/touch=${hasTouch}`
        assert.ok(await actions.count(), `${details}: an actual record action is present`)
        const opacity = await actions.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).opacity))
        assert.ok(opacity.every(value => value === (visible ? '1' : '0')), `${details}: ${opacity.join(',')}`)
        const height = await page.locator('.dsh-design-panel').evaluate(node => node.getBoundingClientRect().height)
        await page.locator(`${scope} button:not(:disabled)`).first().focus()
        assert.ok((await actions.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).opacity))).every(value => value === '1'), `${details}: keyboard focus reveals the same actions`)
        assert.equal(await page.locator('.dsh-design-panel').evaluate(node => node.getBoundingClientRect().height), height, 'revealing actions does not move content')

      }
      await page.close()
    }
  } finally { await browser.close() }
})

test('named reading uses shared sections and record cards with actual bilingual Page specification data', async () => {
  const { manifest: original } = await loadTypographyBundle('page_design')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) {
      const manifest = localizePanelManifest(original, locale)
      const data = JSON.parse(await readFile(new URL(`../../../examples/web-app-panel-review/${locale}/design_files/page_design/page_design.json`, import.meta.url), 'utf8'))
      const before = structuredClone(data)
      for (const width of [1800, 410]) for (const scheme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 700 })
        await page.setContent('<style>' + css + '</style>' + renderToStaticMarkup(
          createElement('div', { className: 'dsh-design-root', style: { colorScheme: scheme } },
            createElement('div', { className: 'dsh-design-panel' }, renderNode(manifest.ui.children[0], manifest, data, {
              locale, editable: true, onPanelUpdate: () => assert.fail('reading must not change canonical data'),
            })))))
        const groups = page.locator('.dsh-design-structured-data > .dsh-design-structured-list > .dsh-panel-content-group')
        assert.equal(await groups.count(), Object.keys(data[manifest.ui.children[0].source]).length, 'every top-level section shares a surface regardless of default disclosure state')
        const navigation = groups.nth(2), card = navigation.locator('li.dsh-panel-content-card').first()
        const surface = await card.evaluate(node => ({ card: getComputedStyle(node).backgroundColor,
          group: getComputedStyle(node.closest('.dsh-panel-content-group')).backgroundColor,
          padding: getComputedStyle(node).padding, border: getComputedStyle(node).borderTopWidth }))
        assert.notEqual(surface.card, surface.group, `${locale}/${width}/${scheme}: shared content and support surfaces remain distinct`)
        assert.equal(surface.padding, width <= 560 ? '12px' : '16px')
        assert.equal(surface.border, '1px')
        assert.equal(await card.locator('h4').evaluate(node => getComputedStyle(node).fontWeight), '500')
        const row = card.locator('.dsh-design-structured-row').first()
        assert.equal(await row.evaluate(node => { const label = node.firstElementChild.getBoundingClientRect(), value = node.lastElementChild.getBoundingClientRect(); return value.top >= label.bottom }), true,
          'nested fields follow the shared vertical rhythm instead of recursively reserving label columns')
        assert.equal(await page.locator('.dsh-design-panel').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
        await navigation.locator(':scope > summary').click()
        assert.equal(await card.isVisible(), false)
        await navigation.locator(':scope > summary').click()
        assert.equal(await card.isVisible(), true)
        const technical = groups.last()
        assert.equal(await technical.getAttribute('open'), null)
        await technical.locator(':scope > summary').click()
        assert.notEqual(await technical.getAttribute('open'), null)
        assert.equal(await technical.locator(':scope > summary > svg').count(), 1)
        assert.equal(await technical.locator(':scope > summary').evaluate(node => Math.abs(node.getBoundingClientRect().right - node.lastElementChild.getBoundingClientRect().right - parseFloat(getComputedStyle(node).paddingRight)) < 2), true,
          'folded root sections use the same far-right disclosure')
        await technical.scrollIntoViewIfNeeded()
        assert.equal(await technical.isVisible(), true, 'the final secondary reference remains reachable')
      }
      assert.deepEqual(data, before)
    }
  } finally { await browser.close() }
})

test('shared typography gives card and tree navigation the same selected and ordinary roles', async () => {
  const { PanelWorkspaceNavigation, PanelWorkspaceTree, PanelWorkspaceTreeItem, PanelCanvasToolbar } = await import('../src/panel-workspace.tsx')
  const { ComponentTabs } = await import('../src/component-tabs.tsx')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) for (const selectedId of ['first', 'second']) {
      const items = [
        { id: 'first', label: locale === 'zh-CN' ? '第一个条目' : 'First item' },
        { id: 'second', label: locale === 'zh-CN' ? '第二个条目' : 'Second item' },
      ]
      const html = renderToStaticMarkup(createElement(PanelLocaleContext.Provider, { value: locale },
        createElement('div', { className: 'dsh-design-root' }, createElement('div', { className: 'dsh-design-panel' },
          createElement('div', { id: 'typography-card-nav' }, createElement(PanelWorkspaceNavigation, {
            title: 'Navigation', items, selectedId, onSelect() {},
          })),
          createElement('div', { id: 'typography-tree-nav' }, createElement(PanelWorkspaceTree, { title: 'Navigation' },
            ...items.map(item => createElement(PanelWorkspaceTreeItem, {
              key: item.id, selected: item.id === selectedId, onSelect() {},
            }, item.label)))),
          createElement('button', { className: 'dsh-design-tab' }, items[0].label),
          createElement(ComponentTabs, {
            node: { id: 'compact-view-switch', component: 'tabs', children: items.map(item => ({ id: item.id, title: item.label, component: 'text' })) },
            appearance: 'segmented', render: child => createElement('div', null, child.title),
            renderNavigation: controls => createElement(PanelCanvasToolbar, { title: 'Map', counts: '2', placement: 'workspace' },
              createElement('button', { 'data-map-action': true }, locale === 'zh-CN' ? '添加画布分区' : 'Add Canvas groups'), controls),
          })))))
      await page.setContent('<style>' + css + DOCK_CSS + '</style>' + html)
      const compact = await page.locator('.dsh-component-tabs-list.is-segmented > [role=tab]').evaluateAll(nodes => nodes.map(node => {
        const s = getComputedStyle(node)
        return { size: s.fontSize, line: s.lineHeight, weight: s.fontWeight }
      }))
      assert.deepEqual(compact, [{ size: '13px', line: '20px', weight: '500' }, { size: '13px', line: '20px', weight: '400' }],
        'toolbar view switching uses the compact navigation scale, independent of content navigation')
      assert.equal(await page.locator('.dsh-design-tab').evaluate(node => getComputedStyle(node).fontSize), compact[0].size)
      for (const width of [1000, 380]) {
        await page.setViewportSize({ width, height: 820 })
        const navigation = await page.evaluate(() => ['card', 'tree'].map(kind => {
          const parent = document.getElementById(`typography-${kind}-nav`).getBoundingClientRect()
          const button = document.querySelector(kind === 'card' ? '.dsh-panel-workspace-nav-items button' : '.dsh-panel-workspace-tree-item')
          const box = button.getBoundingClientRect()
          const label = button.querySelector(kind === 'card' ? '.dsh-panel-workspace-nav-label' : '.dsh-panel-workspace-tree-label').getBoundingClientRect()
          return { left: box.left - parent.left, right: parent.right - box.right, text: label.left - parent.left }
        }))
        assert.deepEqual(navigation, [{ left: 16, right: 16, text: 24 }, { left: 16, right: 16, text: 24 }],
          `${locale}/${width}: ordinary tree and card navigation share a balanced inset without fake icon space`)
        const geometry = () => page.locator('.dsh-canvas-toolbar').evaluate(toolbar => ({
          height: toolbar.getBoundingClientRect().height,
          switch: toolbar.querySelector('[role=tablist]').getBoundingClientRect().toJSON(),
          actionVisibility: getComputedStyle(toolbar.querySelector('[data-map-action]')).visibility,
        }))
        const before = await geometry()
        await page.locator('[data-map-action]').evaluate(action => { action.setAttribute('aria-hidden', 'true'); action.disabled = true })
        const after = await geometry()
        assert.equal(after.actionVisibility, 'hidden')
        assert.equal(after.height, before.height, 'inactive contextual actions preserve toolbar height')
        assert.deepEqual(after.switch, before.switch, 'view controls stay in place across the toolbar wrap boundary')
        await page.locator('[data-map-action]').evaluate(action => { action.removeAttribute('aria-hidden'); action.disabled = false })
      }
      for (const selector of ['#typography-card-nav .dsh-panel-workspace-nav-label', '#typography-tree-nav .dsh-panel-workspace-tree-label']) {
        const labels = await page.locator(selector).evaluateAll(nodes => nodes.map(node => ({
          selected: node.closest('button').getAttribute('aria-current') === 'page',
          weight: getComputedStyle(node).fontWeight,
        })))
        assert.equal(labels.length, 2, `${locale}/${selectedId}: both actual navigation labels exist`)
        assert.deepEqual(labels.map(label => label.weight), items.map(item => item.id === selectedId ? '500' : '400'),
          `${locale}/${selectedId}: the text leaf follows selection, regardless of navigation structure`)
        assert.equal(labels.filter(label => label.selected).length, 1)
      }
    }
  } finally { await browser.close() }
})

test('shared typography distinguishes current and repeated record titles in reading and editing', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    // Children deliberately retain a detail declaration: their actual related
    // card context, rather than the original standalone declaration, owns role.
    const manifest = { version: 1, panel_kind: 'document', sections: [
      { id: 'parents', title: 'Parents', form: { header: { variant: 'detail', title: { field: 'name', editable: true } } } },
      { id: 'children', title: 'Children', navigation: 'contextual', form: { header: { variant: 'detail', title: { field: 'name', editable: true } } } },
    ], fields: [
      { key: 'name', label: 'Name', control: 'text', applies_to: ['parents', 'children'] },
      { key: 'notes', label: 'Notes', control: 'textarea', applies_to: ['parents', 'children'] },
      { key: 'owner', control: 'record_select', options_from_section: 'parents', hidden: true, applies_to: ['children'] },
    ], ui: { component: 'record_workspace', id: 'typography-records', sources: ['parents', 'children'], children: [
      { component: 'record_inspector', id: 'typography-inspector', children: [
        { component: 'record_related_editor', id: 'typography-related', source: 'children', bindings: { reference: 'owner' } },
      ] },
    ] } }
    const data = { parents: { parent: { name: 'Current object', notes: 'Current notes' } }, children: {
      first: { name: 'Repeated first', notes: 'First notes', owner: 'parent' },
      second: { name: 'Repeated second', notes: 'Second notes', owner: 'parent' },
    } }
    const before = structuredClone(data), writes = []
    for (const parentVariant of ['card', 'detail']) for (const editable of [false, true]) {
      // A selected workspace object keeps its role even with a card frame.
      manifest.sections[0].form.header.variant = parentVariant
      await page.setContent('<style>' + css + '</style>' + renderToStaticMarkup(createElement('div', { className: 'dsh-design-root', id: 'typography-records-root' },
        renderManifest(manifest, data, { locale: 'en-US', editable, onPanelUpdate: patch => writes.push(patch) }))))
      const titles = await page.locator('#typography-records-root .dsh-design-record-title').evaluateAll(headers => headers.map(header => {
        const input = header.querySelector('[data-panel-title]')
        const leaf = input ?? header.querySelector('.dsh-design-record-header-label') ?? header
        return { title: input ? input.value : leaf.textContent.trim(), weight: getComputedStyle(leaf).fontWeight,
          editable: !!input, repeated: !!header.closest('.dsh-panel-content-card') }
      }))
      const current = titles.filter(title => title.title === 'Current object')
      const repeated = titles.filter(title => title.title.startsWith('Repeated '))
      assert.equal(current.length, 1, 'one actual current-object title is rendered')
      assert.equal(repeated.length, 2, 'both related records retain their own visible title')
      assert.equal(current[0].weight, '600', `${parentVariant}/${editable}: current-object context owns typography, independent of frame`)
      for (const title of repeated) {
        assert.equal(title.repeated, true)
        assert.equal(title.weight, '500', 'the real readonly label or editable input inherits its repeated-card role')
        assert.equal(title.editable, editable)
      }
      const labels = await page.locator('#typography-records-root .dsh-design-field-label').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontWeight))
      assert.ok(labels.length >= 3, 'current and both related records expose real field labels')
      assert.ok(labels.every(weight => weight === '400'), 'ordinary form labels share a role across record contexts')
    }
    assert.deepEqual(data, before)
    assert.deepEqual(writes, [])
  } finally { await browser.close() }
})

test('shared typography covers actual table labels and Flow and Style workspace titles', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    const names = ['role_access', 'integration_design', 'flow_design', 'design_style']
    const bundles = await Promise.all(names.map(async name => ({ name, ...await loadTypographyBundle(name) })))
    for (const locale of ['zh-CN', 'en-US']) for (const editable of [false, true]) {
      const views = bundles.map(({ name, manifest, data }) => createElement('div', {
        key: name, id: `typography-${name}`, className: 'dsh-design-root', style: { height: 700 },
      }, renderManifest(manifest, data, { locale, editable, onPanelUpdate() {} })))
      // The no-BPMN preview does not open its details on initial SSR. Exercise
      // that same real facts component with its declared rows and saved values.
      const flow = bundles.find(bundle => bundle.name === 'flow_design')
      const flowManifest = localizePanelManifest(flow.manifest, locale)
      views.push(createElement('div', { key: 'flow-facts', id: 'typography-flow-facts', className: 'dsh-design-root' },
        createElement('div', { className: 'dsh-design-panel' }, createElement(RecordFacts, {
          fields: flowManifest.fields, value: Object.values(flow.data.processes)[0],
          rows: flowManifest.ui.diagram.detail_rows, chips: flowManifest.ui.diagram.chip_fields,
        }))))
      await page.setContent('<style>' + css + '</style>' + renderToStaticMarkup(createElement('div', null, ...views)))
      for (const selector of [
        '#typography-role_access .dsh-related-record-table thead th',
        '#typography-integration_design .dsh-record-map-table thead th',
      ]) {
        const labels = await page.locator(selector).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontWeight))
        assert.ok(labels.length >= 2, `${locale}/${editable}: actual table composition exposes its column labels`)
        assert.ok(labels.every(weight => weight === '400'), `${selector}: ordinary column labels do not gain weight from renderer type`)
      }
      for (const selector of [
        '#typography-flow_design .dsh-diagram-heading > strong',
        '#typography-design_style .dsh-preview-toolbar > strong',
      ]) {
        const title = page.locator(selector)
        assert.equal(await title.count(), 1, 'the real workspace owns one current title')
        assert.equal(await title.evaluate(node => getComputedStyle(node).fontWeight), '600',
          `${locale}/${editable}: specialist workspace chrome reuses the current-title role`)
      }
      const facts = await page.locator('#typography-flow-facts .dsh-record-facts h5').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontWeight))
      assert.ok(facts.length > 0, 'actual Flow facts expose their ordinary labels')
      assert.ok(facts.every(weight => weight === '400'), 'reading a field does not promote its label to a record title')
    }
  } finally { await browser.close() }
})

test('shared typography keeps Decision Math current and repeated titles stable through actual React edit states', async () => {
  const { JSDOM } = await import('jsdom')
  const { act } = await import('react')
  const { MathDocument } = await import('../src/math-document.tsx')
  const base = new URL('../../skills-decision-modeling/bundles/decision_model/', import.meta.url)
  const original = parsePanelManifest(await readFile(new URL('panel.yaml', base), 'utf8'))
  original.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale => [locale,
    JSON.parse(await readFile(new URL(`locales/${locale}.json`, base), 'utf8'))])))
  const source = JSON.parse(await readFile(new URL('reference/preview.json', base), 'utf8'))
  const model = structuredClone(source.models.example), before = structuredClone(model), snapshots = []
  // Reuse the Math unit test's real React interaction boundary, then measure its
  // resulting DOM in Chromium. This is not a hydrated-browser or Host-save test.
  const dom = new JSDOM('<!doctype html><div id="math-root"></div>', { url: 'https://math.test/', pretendToBeVisual: true })
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT']
  const descriptors = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  let root
  try {
    for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
      value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key] })
    dom.window.HTMLElement.prototype.scrollIntoView = () => {}
    // This file imports the server renderer before installing JSDOM, so React's
    // cached DOM feature detection cannot test focus here. Only edit-state
    // rendering is exercised; actual focus is covered by the browser walkthrough.
    dom.window.HTMLElement.prototype.focus = () => {}
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('math-root')
    root = createRoot(container)
    for (const locale of ['zh-CN', 'en-US']) {
      const manifest = localizePanelManifest(original, locale)
      await act(async () => root.render(createElement(PanelLocaleContext.Provider, { value: locale },
        createElement('div', { className: 'dsh-design-root' }, createElement('div', { className: 'dsh-design-panel' },
          createElement(MathDocument, { key: locale, node: manifest.ui.children[0], manifest, value: model, editable: true,
            onChange: () => assert.fail('entering or finishing edit mode must not change saved model facts'), renderField: () => null }))))))
      const entry = '[data-math-field="equations"] [data-math-entry="0"]'
      assert.ok(container.querySelector(`${entry} > summary h4`), 'the saved Decision preview exposes an actual statement title')
      snapshots.push({ locale, state: 'reading', html: container.innerHTML, entry })
      await act(async () => container.querySelector(`${entry} > summary .dsh-math-edit`).click())
      const editor = container.querySelector(`${entry} .dsh-math-title-edit textarea`)
      assert.ok(editor, 'the actual edit action creates the bound title editor')
      assert.equal(editor.value, model.equations[0].label)
      snapshots.push({ locale, state: 'editing', html: container.innerHTML, entry })
      await act(async () => container.querySelector(`${entry} > summary .dsh-math-edit`).click())
      assert.ok(container.querySelector(`${entry} > summary h4`), 'finishing returns to the same reading title')
      snapshots.push({ locale, state: 'finished', html: container.innerHTML, entry })
    }
    assert.deepEqual(model, before)
  } finally {
    if (root) await act(async () => root.unmount())
    dom.window.close()
    for (const key of globals) {
      const descriptor = descriptors.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const { locale, state, html, entry } of snapshots) {
      await page.setContent('<style>' + css + '</style>' + html)
      const typography = node => { const s = getComputedStyle(node); return { size: s.fontSize, line: s.lineHeight, weight: s.fontWeight } }
      assert.deepEqual(await page.locator('.dsh-design-record-title input').evaluate(typography),
        { size: '14px', line: '20px', weight: '600' }, `${locale}/${state}: the model remains the current object`)
      const title = page.locator(state === 'editing' ? `${entry} .dsh-math-title-edit textarea` : `${entry} > summary h4`)
      assert.equal(await title.count(), 1)
      assert.deepEqual(await title.evaluate(typography), { size: '14px', line: '20px', weight: '500' },
        `${locale}/${state}: statement reading and editing share the repeated-record role`)
    }
  } finally { await browser.close() }
})

test('shared typography reaches actual grouped and nested catalog examples and DataTable column labels', async () => {
  const { createPanelComponentExample } = await import('../src/component-examples.ts')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    const css = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    for (const locale of ['zh-CN', 'en-US']) for (const editable of [false, true]) {
      for (const kind of ['record_form', 'grouped_records', 'nested_collection', 'data_table']) {
        const example = createPanelComponentExample(kind, locale === 'zh-CN' ? 'zh' : 'en')
        assert.ok(example, `${kind}: use the catalog's maintained composition`)
        const manifest = parsePanelManifest(example.panelYaml), before = structuredClone(example.sample)
        await page.setContent('<style>' + css + '</style>' + renderToStaticMarkup(
          createElement('div', { className: 'dsh-design-root', style: { height: 800 } },
            renderManifest(manifest, example.sample, { locale, editable,
              onPanelUpdate: () => assert.fail('reading a catalog example must not emit writes') }))))
        // Exercise native disclosures, including the full form nested inside a
        // grouped record. Static registration alone would miss that inner title.
        while (await page.locator('details:not([open]) > summary').count()) await page.locator('details:not([open]) > summary').first().click()
        const selectors = kind === 'grouped_records' ? [
          ['.dsh-design-grouped-records-group > summary', '500'],
          ['.dsh-design-grouped-record > summary', '500'],
          ['.dsh-design-grouped-record .dsh-design-record-title', '500'],
          [editable ? '.dsh-design-grouped-record .dsh-design-record-header-input' : '.dsh-design-grouped-record .dsh-design-record-header-label', '500'],
        ] : kind === 'record_form' ? [
          ['.dsh-design-record-title', '500'],
          [editable ? '.dsh-design-record-header-input' : '.dsh-design-record-header-label', '500'],
        ] : kind === 'nested_collection' ? [
          ['.dsh-design-nested-parent > summary', '500'], ['.dsh-design-nested-child > summary', '500'],
        ] : [['.dsh-data-table-column', '400']]
        for (const [selector, expected] of selectors) {
          const nodes = page.locator(selector)
          assert.ok(await nodes.count() > 0, `${locale}/${editable}/${kind}: the actual role must be present`)
          const weights = await nodes.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontWeight))
          assert.ok(weights.every(weight => weight === expected), `${locale}/${editable}/${selector}: ${weights}`)
        }
        if (kind === 'data_table') assert.equal(await page.locator('.dsh-data-table-column').count(), 3,
          'all three saved sample columns are covered, including readonly disabled controls')
        assert.deepEqual(example.sample, before)
      }
    }
  } finally { await browser.close() }
})

test('shared footer and controls keep semantic colors with either native provider stylesheet order', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const panelCss = await readFile(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    const providerCss = await readFile(new URL('../../provider-web-app/src/client/generated/design.tw.css', import.meta.url), 'utf8')
    const footer = renderToStaticMarkup(createElement(FooterButtons, { disabled: false, saveVariant: 'outline', saveText: 'Save', regenerateText: 'Cancel' }))
    const question = renderToStaticMarkup(createElement(StandardQuestionList, { editable: false,
      questions: [{ id: 'Q-001', prompt: 'Reading surface', kind: 'text', answer: 'Saved answer' }] }))
    const colors = {}
    for (const [order, css] of [['panel-first', panelCss + providerCss], ['provider-first', providerCss + panelCss]]) {
      for (const scheme of ['light', 'dark']) {
        await page.setContent(`<style>${css}</style><div class="dsh-design-root"><span id="semantic-reference" style="background-color:var(--ds-bg-white);color:var(--ds-text-primary)">Theme reference</span><div class="dsh-design-panel">${question}</div>${footer}</div>`)
        await page.evaluate(value => { document.documentElement.style.colorScheme = value }, scheme)
        await page.waitForFunction(() => {
          void document.body.offsetHeight
          return document.getAnimations().every(animation => animation.playState !== 'running')
        })
        const result = await page.evaluate(() => {
          const rgba = color => {
            const context = document.createElement('canvas').getContext('2d')
            context.fillStyle = color; context.fillRect(0, 0, 1, 1)
            return Array.from(context.getImageData(0, 0, 1, 1).data).join(',')
          }
          const reference = getComputedStyle(document.querySelector('#semantic-reference'))
          const footer = document.querySelector('[data-testid="dsh-design-save"]').parentElement.parentElement
          return { footer: rgba(getComputedStyle(footer).backgroundColor),
            controls: [...footer.querySelectorAll('button')].map(node => rgba(getComputedStyle(node).backgroundColor)),
            expected: rgba(reference.backgroundColor),
            documentPalette: getComputedStyle(document.documentElement).getPropertyValue('--ds-bg-white').trim(),
            answer: document.querySelector('[data-question-id="Q-001"]')?.textContent }
        })
        assert.equal(result.footer, result.expected, `${order}/${scheme}: the footer follows the shared semantic surface`)
        assert.ok(result.controls.every(value => value === result.expected), `${order}/${scheme}: outline controls follow that same surface ${JSON.stringify(result)}`)
        assert.equal(result.documentPalette, '', 'a native provider never publishes a palette on the Host document root')
        assert.match(result.answer, /Saved answer/, 'the same style composition keeps the adjacent shared reading surface')
        colors[`${order}/${scheme}`] = result.footer
      }
    }
    assert.notEqual(colors['panel-first/light'], colors['panel-first/dark'])
    assert.equal(colors['panel-first/dark'], colors['provider-first/dark'])
  } finally { await browser.close() }
})
