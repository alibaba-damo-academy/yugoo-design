/** Real React 18 effects and native Chromium resizing; no Host/save acceptance claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const reactUmd = join(dirname(require.resolve('react/package.json')), 'umd/react.development.js')
const domUmd = join(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js')
const source = await readFile(new URL('../src/panel-textarea.tsx', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/visual-components.css', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'panel-textarea.tsx', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
})
assert.deepEqual((compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error), [])

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function mount(browser, initial = {}) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<!doctype html><meta charset="utf-8"><div id="root"></div>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ path: reactUmd })
  await page.addScriptTag({ path: domUmd })
  await page.evaluate(({ code, initial }) => {
    const { React, ReactDOM } = window
    if (!React.version.startsWith('18.')) throw Error('This test requires the installed React 18 runtime')
    const exports = {}
    Function('require', 'exports', 'React', code)(name => {
      if (name === 'react') return React
      throw Error(`Unexpected browser dependency: ${name}`)
    }, exports, React)
    const { PanelTextarea } = exports
    const { createElement: h, useState } = React
    window.textareaWrites = []
    function Harness() {
      const [state, setState] = useState({ value: '', width: 520, hidden: false, readOnly: false, disabled: false, controlled: true, ...initial })
      window.configureTextarea = patch => ReactDOM.flushSync(() => setState(previous => ({ ...previous, ...patch })))
      const value = state.controlled ? { value: state.value } : { defaultValue: state.value }
      return h('div', { className: 'dsh-design-panel', style: { width: state.width, display: state.hidden ? 'none' : 'block' } },
        h('label', { htmlFor: 'entry', className: 'dsh-design-field-label' }, 'Description'),
        h(PanelTextarea, { ...value, id: 'entry', className: 'dsh-design-field-input', placeholder: state.placeholder,
          rows: state.rows, readOnly: state.readOnly, disabled: state.disabled,
          onChange: event => {
            const next = event.target.value
            window.textareaWrites.push(next)
            if (state.controlled) setState(previous => ({ ...previous, value: next }))
          } }),
        h('button', { id: 'outside', type: 'button' }, 'Another action'))
    }
    window.textareaRoot = ReactDOM.createRoot(document.getElementById('root'))
    ReactDOM.flushSync(() => window.textareaRoot.render(h(Harness)))
    window.originalTextarea = document.getElementById('entry')
  }, { code: compiled.outputText, initial })
  await settle(page)
  return { page, errors }
}

async function measure(page) {
  return page.locator('#entry').evaluate(node => {
    const style = getComputedStyle(node)
    const line = parseFloat(style.lineHeight)
    const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    return { height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width,
      line, minimum: line + chrome, maximum: 5 * line + chrome,
      scroll: node.scrollHeight, client: node.clientHeight, overflow: style.overflowY, resize: style.resize,
      value: node.value, sameNode: node === window.originalTextarea, writes: window.textareaWrites.length }
  })
}

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= 1.1, `${message}: ${actual} vs ${expected}`)
}

async function configure(page, patch) {
  await page.evaluate(patch => window.configureTextarea(patch), patch)
  await settle(page)
}

async function cleanup(page, errors) {
  try {
    await page.evaluate(() => ReactDOM.flushSync(() => window.textareaRoot.unmount()))
    assert.deepEqual(errors, [], 'the real effects and ResizeObserver callbacks do not throw')
  } finally { await page.close() }
}

const manyLines = Array.from({ length: 12 }, (_, index) => `Business condition ${index + 1}`).join('\n')

test('PanelTextarea fits actual content and preserves native user sizing', { timeout: 60_000 }, async t => {
  const browser = await chromium.launch({ headless: true })
  try {
    await t.test('empty long placeholder and one line stay compact; long content scrolls at five lines and shrinks back', async () => {
      const { page, errors } = await mount(browser, { placeholder: 'Describe the trigger, expected result and exceptions. '.repeat(20) })
      try {
        const empty = await measure(page)
        assert.ok(Number.isFinite(empty.line) && empty.line > 0)
        closeTo(empty.height, empty.minimum, 'placeholder text does not increase the empty field height')
        assert.equal(empty.writes, 0, 'initial sizing never emits a canonical edit')
        await page.locator('#entry').fill('One short line')
        await settle(page)
        const short = await measure(page)
        closeTo(short.height, short.minimum, 'one actual line needs only one line of height')
        await page.locator('#entry').fill(manyLines)
        await settle(page)
        const long = await measure(page)
        closeTo(long.height, long.maximum, 'automatic sizing stops at five visual lines')
        assert.ok(long.scroll > long.client, 'content beyond the automatic budget remains scrollable')
        assert.equal(long.overflow, 'auto')
        assert.equal(long.resize, 'vertical')
        assert.ok(await page.locator('#entry').evaluate(node => { node.scrollTop = node.scrollHeight; return node.scrollTop > 0 }), 'users can reach content beyond the fifth line')
        await page.locator('#entry').fill('Short again')
        await settle(page)
        closeTo((await measure(page)).height, short.minimum, 'removing content shrinks an automatically sized field')
        await page.locator('#entry').fill('')
        await settle(page)
        const cleared = await measure(page)
        closeTo(cleared.height, cleared.minimum, 'clearing restores one line despite the long placeholder')
        assert.ok(cleared.sameNode, 'content changes retain the actual input element')
        assert.deepEqual(await page.evaluate(() => window.textareaWrites), ['One short line', manyLines, 'Short again', ''], 'only actual input events write data')
      } finally { await cleanup(page, errors) }
    })

    await t.test('container width changes reflow the same field without writing data', async () => {
      const text = 'A meaningful detail wraps when the available field width changes. '.repeat(3)
      const { page, errors } = await mount(browser, { value: text, width: 760 })
      try {
        const wide = await measure(page)
        assert.ok(wide.height < wide.maximum - wide.line, 'the wide fixture must have room to grow before the limit')
        await configure(page, { width: 180 })
        const narrow = await measure(page)
        assert.ok(narrow.width < wide.width && narrow.height > wide.height, 'actual narrower layout grows the wrapped content')
        assert.ok(narrow.height <= narrow.maximum + 1.1)
        await configure(page, { width: 760 })
        const restored = await measure(page)
        closeTo(restored.height, wide.height, 'widening the same content shrinks it to its original fit')
        assert.equal(restored.value, text)
        assert.ok(restored.sameNode)
        assert.equal(restored.writes, 0, 'layout does not synthesize content edits')
      } finally { await cleanup(page, errors) }
    })

    await t.test('a real native resize beyond five lines survives input, clearing and immediate external rerenders', async () => {
      const { page, errors } = await mount(browser, { value: 'One line' })
      try {
        const before = await measure(page)
        const box = await page.locator('#entry').boundingBox()
        assert.ok(box)
        // Use Chromium's actual native resize grip. Do not assign style.height:
        // that would bypass the user interaction whose lifecycle matters here.
        await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4 + before.line * 8, { steps: 16 })
        await page.mouse.up()
        // Intentionally rerender before waiting for ResizeObserver delivery.
        const chosenHeight = await page.evaluate(() => {
          const height = document.getElementById('entry').getBoundingClientRect().height
          window.configureTextarea({ value: 'Immediate external value after dragging' })
          return height
        })
        await settle(page)
        const manual = await measure(page)
        assert.ok(chosenHeight > before.maximum + before.line, 'the real grip can grow beyond the automatic five-line ceiling')
        closeTo(manual.height, chosenHeight, 'the immediate external render preserves the exact native drag result')
        assert.equal(manual.writes, 0, 'dragging and external rendering do not emit content edits')
        await page.locator('#entry').fill('Typed after the drag')
        await settle(page)
        closeTo((await measure(page)).height, manual.height, 'typing preserves the user chosen height')
        await configure(page, { value: manyLines })
        closeTo((await measure(page)).height, manual.height, 'external controlled value changes preserve manual height')
        await page.locator('#entry').fill('')
        await settle(page)
        const cleared = await measure(page)
        closeTo(cleared.height, manual.height, 'clearing content does not undo the manual resize')
        assert.ok(cleared.sameNode, 'an unrelated render must not recreate the input')
        assert.deepEqual(await page.evaluate(() => window.textareaWrites), ['Typed after the drag', ''])
      } finally { await cleanup(page, errors) }
    })

    await t.test('content changed while hidden refits on same-width reveal, without remounting or editing data', async () => {
      const { page, errors } = await mount(browser, { value: 'Short', width: 520 })
      try {
        const before = await measure(page)
        await configure(page, { hidden: true })
        assert.equal(await page.locator('#entry').evaluate(node => node.getClientRects().length), 0, 'the real input is actually hidden')
        await configure(page, { value: manyLines })
        await configure(page, { hidden: false })
        const revealed = await measure(page)
        closeTo(revealed.width, before.width, 'the regression uses the same width on reveal')
        closeTo(revealed.height, revealed.maximum, 'revealing updated content fits it before further input')
        assert.equal(revealed.value, manyLines)
        assert.ok(revealed.scroll > revealed.client)
        assert.ok(revealed.sameNode)
        assert.equal(revealed.writes, 0)
        await configure(page, { hidden: true })
        await configure(page, { value: 'Short again' })
        await configure(page, { hidden: false })
        const shortened = await measure(page)
        closeTo(shortened.height, shortened.minimum, 'hidden content deletion also shrinks on reveal')
        assert.equal(shortened.writes, 0)
      } finally { await cleanup(page, errors) }
    })

    await t.test('readonly and disabled controls retain values while layout and external updates emit no edits', async () => {
      const { page, errors } = await mount(browser, { value: 'Read only fact', readOnly: true })
      try {
        await page.locator('#entry').focus()
        await page.keyboard.press('End')
        await page.keyboard.type(' must not be written')
        assert.equal((await measure(page)).value, 'Read only fact')
        await configure(page, { width: 190, value: manyLines })
        const readonly = await measure(page)
        closeTo(readonly.height, readonly.maximum, 'readonly layout can fit external content without making it editable')
        await configure(page, { disabled: true, width: 520, value: 'Disabled fact' })
        assert.equal(await page.locator('#entry').isDisabled(), true)
        const disabled = await measure(page)
        assert.equal(disabled.value, 'Disabled fact')
        closeTo(disabled.height, disabled.minimum, 'disabled content still uses the common sizing owner')
        assert.ok(disabled.sameNode)
        assert.equal(disabled.writes, 0, 'readonly, disabled and external layout are not user edits')
      } finally { await cleanup(page, errors) }
    })
  } finally { await browser.close() }
})
