/** Real React/interpreter interaction; JSDOM does not prove browser layout. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'
import { parse } from 'yaml'

const built = process.env.PANEL_SAMPLE_PREVIEW_BUILT === '1'
const entry = new URL(built ? '../lib/sample-preview.js' : '../src/sample-preview.tsx', import.meta.url)
const panelRequire = createRequire(new URL('../package.json', import.meta.url))
const hooks = registerHooks({
  resolve(specifier, context, next) {
    // Companion's real browser config resolves these same Panel-owned peers.
    if (/^react(?:-dom)?(?:\/|$)/u.test(specifier)) return { url: pathToFileURL(panelRequire.resolve(specifier)).href, shortCircuit: true }
    if (specifier === 'dsh-design-panel/sample-preview') return { url: entry.href, shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('.css?inline')) return { format: 'module', shortCircuit: true,
      source: `export default ${JSON.stringify(readFileSync(new URL(url.slice(0, -7)), 'utf8'))}` }
    return next(url, context)
  },
})
const consolePort = new VirtualConsole()
consolePort.on('jsdomError', error => { if (error.type !== 'css parsing') throw error })
const dom = new JSDOM('<div id="root"></div><div id="toolbar"></div>', { url: 'https://sample.test/', virtualConsole: consolePort })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { PanelSamplePreview } = await import(entry.href)
const { StudioRuntimePreview } = await import('../../companion/src/studio-preview.tsx')
const { bindDesignHostLocale } = await import('../src/client/ported/host.ts')
after(() => { dom.window.close(); hooks.deregister() })
const h = React.createElement
const panelYaml = JSON.stringify({ version: 1, panel_kind: 'document',
  sections: [{ id: 'people', title: 'People', item_name: 'Person' }],
  fields: [{ key: 'name', label: 'Name', control: 'text', applies_to: ['people'] }],
  ui: { component: 'record_workspace', id: 'people-workspace', sources: ['people'], children: [{ component: 'record_inspector', id: 'person' }] },
})
const sample = () => ({ people: { a: { name: 'Ada' }, b: { name: 'Lin' } } })
const props = sample => ({ skill: 'sample-bundle', panelYaml, sample, locale: 'en' })
function official(bundle, sampleFile) {
  const root = new URL(`../../${bundle}/`, import.meta.url)
  const manifest = parse(readFileSync(new URL('panel.yaml', root), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(['zh-CN', 'en-US'].map(locale =>
    [locale, JSON.parse(readFileSync(new URL(`locales/${locale}.json`, root), 'utf8'))]))
  return { skill: bundle.split('/').at(-1), panelYaml: JSON.stringify(manifest),
    sample: JSON.parse(readFileSync(new URL(`reference/${sampleFile}`, root), 'utf8')), locale: 'en-US' }
}
const button = label => [...document.querySelectorAll('button')].find(value => value.textContent.trim() === label)
async function change(input, value) {
  assert.ok(input, 'real editable field is present')
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}
async function mounted(t) {
  const root = createRoot(document.getElementById('root'))
  t.after(() => React.act(async () => root.unmount()))
  return value => React.act(async () => root.render(value))
}

test('sample surface uses real readonly navigation and the unique shared styles', async t => {
  const show = await mounted(t), source = sample(), before = structuredClone(source)
  await show(h(PanelSamplePreview, props(source)))
  assert.ok(document.querySelector('.dsh-record-workspace'))
  assert.equal(document.querySelector('input,textarea,input[type="file"]'), null)
  assert.ok(button('Ada')); assert.ok(button('Lin'))
  await React.act(async () => button('Lin').click())
  assert.match(document.getElementById('root').textContent, /Lin/)
  assert.equal(button('Lin').getAttribute('aria-current'), 'page')
  assert.equal(document.querySelectorAll('.dsh-design-record').length, 1, 'navigation shows one selected record, not the full collection')
  assert.equal(document.querySelector('.dsh-design-record').dataset.record, 'b')
  assert.deepEqual(source, before)
  const css = document.querySelector('.dsh-panel-sample-preview > style').textContent
  assert.equal(css, readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8') + '\n'
    + readFileSync(new URL('../src/panel-content-state.css', import.meta.url), 'utf8'))
  const shell = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
  assert.ok(!shell.includes('.dsh-design-dock-panel-body{'))
  assert.ok(shell.includes('.dsh-design-workspace-inset .dsh-design-dock-panel-body'))
})

test('controlled sample editing emits canonical data without changing input or the original baseline', async t => {
  const show = await mounted(t), source = sample(), before = structuredClone(source), values = []
  let value = structuredClone(source)
  const render = locale => show(h(PanelSamplePreview, { ...props(source), value, onChange: next => values.push(next), readOnly: false, locale }))
  await render('en')
  await change(document.querySelector('input[aria-label="Name"]'), 'Ada revised')
  assert.equal(values.length, 1); assert.equal(values[0].people.a.name, 'Ada revised')
  assert.deepEqual(source, before); assert.deepEqual(value, before)
  value = values[0]; await render('zh')
  assert.equal(document.querySelector('input[aria-label="Name"]').value, 'Ada revised')
  assert.ok(button('Ada revised'))
})

test('uncontrolled edits survive locale changes and a new source sample resets them', async t => {
  const show = await mounted(t), source = sample()
  await show(h(PanelSamplePreview, { ...props(source), readOnly: false }))
  await change(document.querySelector('input[aria-label="Name"]'), 'Local sample')
  await show(h(PanelSamplePreview, { ...props(source), locale: 'zh', readOnly: false }))
  assert.equal(document.querySelector('input[aria-label="Name"]').value, 'Local sample')
  assert.equal(source.people.a.name, 'Ada')
  const replacement = sample(); replacement.people.a.name = 'New baseline'
  await show(h(PanelSamplePreview, { ...props(replacement), readOnly: false }))
  assert.equal(document.querySelector('input[aria-label="Name"]').value, 'New baseline')
})

test('runtime-only ports and project artifact readers are never admitted to an isolated preview', async t => {
  const show = await mounted(t), attempted = []
  const forbidden = name => () => { attempted.push(name); return Promise.resolve({ found: true, content: 'PRIVATE ARTIFACT' }) }
  const yaml = JSON.stringify({ version: 1, panel_kind: 'document', sections: [], fields: [],
    ui: { component: 'preview_workspace', id: 'preview', live_preview: { file_path: 'preview.file', tokens: [] } } })
  await show(h(PanelSamplePreview, { ...props({ preview: { file: 'sample-bundle/private.html' } }), panelYaml: yaml, readOnly: false,
    readArtifact: forbidden('artifact'), readBinaryArtifact: forbidden('binary'), sendPrompt: forbidden('host'),
    onSaveAndContinue: forbidden('save'), selectPanel: forbidden('panel'), allowAttachments: true,
    artifactFiles: { 'sample-bundle/private.html': '<h1>PRIVATE ARTIFACT</h1>' },
  }))
  assert.equal(document.querySelector('.dsh-design-manifest-error'), null)
  assert.equal(document.querySelector('iframe,input[type="file"]'), null)
  assert.ok(!document.getElementById('root').textContent.includes('PRIVATE ARTIFACT'))
  for (const action of document.querySelectorAll('button:not(:disabled)')) await React.act(async () => action.click())
  assert.deepEqual(attempted, [])
})

test('an isolated sample reads only the explicitly supplied synthetic artifact bytes through the existing sandbox', async t => {
  const show = await mounted(t)
  const path = 'sample-bundle/artifacts/teaching.html'
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'charts', title: 'Charts' }],
    fields: [{ key: 'title', control: 'text', applies_to: ['charts'] }, { key: 'file', control: 'artifact_ref', applies_to: ['charts'] }],
    ui: { component: 'record_workspace', id: 'charts', sources: ['charts'], children: [{ component: 'record_artifact', id: 'chart', source: 'charts', artifact: { field: 'file' } }] } }
  const original = { charts: { example: { title: 'Teaching chart', file: path } } }
  const artifacts = { [path]: '<h1>Synthetic teaching chart</h1><script>window.untrusted = true</script>' }
  const before = structuredClone(original)
  await show(h(PanelSamplePreview, { ...props(original), panelYaml: JSON.stringify(manifest), artifacts }))
  const frame = document.querySelector('iframe')
  assert.ok(frame)
  assert.match(frame.srcdoc, /Synthetic teaching chart/u)
  assert.equal(frame.getAttribute('sandbox'), '')
  assert.match(frame.srcdoc, /script-src 'none'/u)
  assert.equal(window.untrusted, undefined)
  assert.deepEqual(original, before)
  assert.equal(document.querySelector('input[type="file"]'), null)
})

test('invalid authored YAML reports actual interpreter diagnostics', async t => {
  const show = await mounted(t)
  await show(h(PanelSamplePreview, { ...props(sample()), panelYaml: 'version: [invalid' }))
  assert.ok(document.querySelector('.dsh-design-manifest-error')?.textContent)
})

test('official Web App questions allow sample answers while attachment ports stay disabled', async t => {
  const show = await mounted(t), input = official('skills-web-app/bundles/smart_questions', 'preview.json')
  input.sample.questions = { sample_note: { prompt: 'Sample question', kind: 'text', answer: '', detail: '', round: 0 } }
  const before = structuredClone(input.sample), changes = []
  await show(h(PanelSamplePreview, { ...input, readOnly: false, allowAttachments: true, onChange: value => changes.push(value) }))
  assert.equal(document.querySelector('.dsh-design-manifest-error'), null)
  assert.match(document.getElementById('root').textContent, /Sample question/)
  assert.equal(document.querySelector('input[type="file"]'), null)
  const answer = document.querySelector('textarea')
  assert.ok(answer)
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(answer, 'Local answer')
    answer.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  assert.equal(changes.at(-1).questions.sample_note.answer, 'Local answer')
  assert.deepEqual(input.sample, before)
})

test('official Decision Modeling sample retains its real grouped forms in readonly mode', async t => {
  const show = await mounted(t), input = official('skills-decision-modeling/bundles/decision_objectives', 'state-example.json')
  const before = structuredClone(input.sample)
  await show(h(PanelSamplePreview, input))
  assert.equal(document.querySelector('.dsh-design-manifest-error'), null)
  const text = document.getElementById('root').textContent
  assert.ok(text.includes(input.sample.indicators.count.title))
  assert.ok(text.includes(input.sample.goals.minimum.title))
  assert.equal(document.querySelector('input,textarea'), null)
  assert.deepEqual(input.sample, before)
})

test('Companion keeps controlled edits, adoption, locale and portal toolbar behavior', async t => {
  const show = await mounted(t), adopted = [], source = sample()
  const unbind = bindDesignHostLocale({ getSnapshot: () => ({ active: 'en_US' }), subscribe: () => () => {} })
  t.after(unbind)
  const preview = { revision: 1, bundle: { name: 'sample-bundle', version: '1.0.0' }, panelYaml, sample: source }
  await show(h(StudioRuntimePreview, { preview, adoptSample: value => adopted.push(value) }))
  await change(document.querySelector('input[aria-label="Name"]'), 'Companion sample')
  await React.act(async () => button('Use sample edits').click())
  assert.equal(adopted[0].people.a.name, 'Companion sample'); assert.equal(source.people.a.name, 'Ada')
  const toolbarTarget = document.getElementById('toolbar')
  await show(h(StudioRuntimePreview, { preview, adoptSample: value => adopted.push(value), toolbarTarget }))
  assert.ok(toolbarTarget.querySelector('button')); assert.equal(document.querySelector('.ygd-studio-draft-toolbar'), null)
  assert.equal(document.querySelector('input[aria-label="Name"]').value, 'Companion sample')
  await show(h(StudioRuntimePreview, { preview, adoptSample: value => adopted.push(value), toolbarTarget, readOnly: true }))
  assert.equal(toolbarTarget.querySelector('button'), null); assert.equal(document.querySelector('input'), null)
})

test('layout shell provides ordinary content scrolling without wrapping a child workspace', async t => {
  const show = await mounted(t)
  const manifest = JSON.parse(panelYaml)
  const workspace = manifest.ui
  manifest.ui = { component: 'panel_workspace', id: 'shell', slots: {
    sidebar: { component: 'text_block', id: 'help', text: 'Context' },
    main: { component: 'record_form', id: 'form', source: 'people' },
  } }
  await show(h(PanelSamplePreview, { ...props(sample()), panelYaml: JSON.stringify(manifest) }))
  assert.ok(document.querySelector('.dsh-panel-workspace-content > .dsh-design-record-form'))
  manifest.ui.slots.main = workspace
  await show(h(PanelSamplePreview, { ...props(sample()), panelYaml: JSON.stringify(manifest) }))
  assert.equal(document.querySelector('.dsh-panel-workspace-content'), null, 'full workspace owns its existing scrolling')
  assert.ok(document.querySelector('.dsh-record-workspace'))
})
