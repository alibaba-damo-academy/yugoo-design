import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installSelectDom } from './select-interaction.mjs'

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
installSelectDom(dom.window)
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderManifest, renderNode } = await import('../src/interpreter.ts')
const { applyDesignEditToDraft } = await import('../src/record-state.ts')
const { parsePanelManifest, localizePanelManifest } = await import('../../core/src/panel-dsl.ts')

function bundle(name) {
  const root = new URL(`../../skills-web-app/bundles/${name}/`, import.meta.url)
  const manifest = parsePanelManifest(readFileSync(new URL('panel.yaml', root), 'utf8'))
  manifest.i18n.messages = { 'en-US': JSON.parse(readFileSync(new URL('locales/en-US.json', root), 'utf8')) }
  return { manifest: localizePanelManifest(manifest, 'en-US'),
    data: JSON.parse(readFileSync(new URL('reference/preview.json', root), 'utf8')) }
}

async function replaceText(input, text) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

test('actual Flow document keeps ordinary process fields visible and node fields inside their single record card', async () => {
  const { manifest, data: original } = bundle('flow_design')
  const root = createRoot(document.getElementById('root'))
  let data = structuredClone(original), writes = 0
  const paint = () => root.render(renderManifest(manifest, data, {
    locale: 'en-US', editable: true,
    onPanelUpdate: update => { writes++; data = { ...data, ...update }; paint() },
  }))
  try {
    await React.act(paint)
    const firstId = data.node_order[0]
    const firstLabel = data.nodes[firstId].activity
    const navigation = [...document.querySelectorAll('nav button')].find(button => button.textContent.trim() === firstLabel)
    assert.ok(Boolean(navigation), 'the actual node entry remains discoverable')
    await React.act(async () => { navigation.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    const process = document.querySelector('.dsh-diagram-document')
    assert.ok(process)
    assert.equal(process.querySelector('details.dsh-diagram-document-process'), null, 'the process title is not repeated in a grey group')
    const overviewGroup = process.querySelector('.dsh-diagram-document-overview')
    const nodesGroup = process.querySelector('.dsh-diagram-document-nodes')
    assert.equal(overviewGroup.classList.contains('dsh-panel-content-group'), true)
    assert.equal(nodesGroup.classList.contains('dsh-panel-content-group'), true)
    const overview = process.querySelector('[data-diagram-record=""]')
    assert.equal(overview.classList.contains('dsh-panel-content-card'), true, 'overview fields share one existing base body surface')
    assert.equal(overview.classList.contains('dsh-design-form-group-fields'), true)
    for (const key of ['description', 'stakeholders', 'business_rules', 'exception_handling']) {
      const field = overview.querySelector(`[data-field="${key}"]`)
      assert.ok(Boolean(field), `${key} remains readable`)
      assert.equal(field.closest('details'), overviewGroup, `${key} belongs to Flow information without an extra field disclosure`)
      assert.equal(field.classList.contains('is-label-visually_hidden'), false)
    }
    const cards = [...process.querySelectorAll('[data-diagram-record]')].filter(element => element.dataset.diagramRecord)
    assert.equal(cards.length, original.node_order.length)
    for (const card of cards) {
      assert.equal(card.classList.contains('dsh-panel-content-card'), true)
      assert.equal(card.closest('details'), nodesGroup)
      assert.equal(card.querySelectorAll('.dsh-panel-content-group,.dsh-panel-content-card').length, 0, 'ordinary node fields add neither grey groups nor another white card')
    }
    const activity = cards[0].querySelector('[data-field="activity"] textarea')
    await replaceText(activity, 'User-authored step detail\nRetain the second line')
    assert.equal(writes, 1)
    assert.equal(data.nodes[firstId].activity, 'User-authored step detail\nRetain the second line')
    assert.deepEqual(data.processes, original.processes)
    assert.deepEqual(data.node_order, original.node_order)
    assert.deepEqual(data.nodes[original.node_order[1]], original.nodes[original.node_order[1]])
    data = structuredClone(original)
    await React.act(paint)
    assert.equal(cards[0].querySelector('[data-field="activity"] textarea').value, original.nodes[firstId].activity, 'the host can discard the draft through its existing input-data reset')
    assert.equal(writes, 1, 'view and reset emit no additional write')
  } finally { await React.act(async () => root.unmount()) }
})

test('actual Function cards keep ordinary description editing and host draft reset', async () => {
  const { manifest, data: original } = bundle('function_modules')
  const id = original.function_order[0], otherId = original.function_order[1]
  let data = structuredClone(original), writes = 0
  const root = createRoot(document.getElementById('root'))
  const paint = editable => root.render(renderManifest(manifest, data, {
    locale: 'en-US', editable,
    onEdit: edit => { writes++; data = applyDesignEditToDraft(data, manifest, edit); paint(true) },
  }))
  const card = () => document.querySelector(`[data-board-record="${id}"]`)
  try {
    await React.act(() => paint(false))
    assert.ok(card().querySelector(':scope > details.dsh-panel-content-group'), 'the primary Function owns one shared grey section')
    assert.ok(card().querySelector(':scope > details > .dsh-design-form-group-content > .dsh-design-form-group-fields.dsh-panel-content-card'), 'the section body reuses the shared base surface')
    assert.equal(card().querySelectorAll('.dsh-record-board-description').length, 1)
    await React.act(() => paint(true))
    const description = card().querySelector('[data-field="function_description"]')
    assert.equal(description.closest('.dsh-panel-content-group') === card().querySelector(':scope > details'), true, 'ordinary fields do not add another grey group inside the Function section')
    await replaceText(description.querySelector('textarea'), 'User function description\nKeep the second line')
    assert.equal(data.functions[id].function_description, 'User function description\nKeep the second line')
    assert.deepEqual(data.functions[otherId], original.functions[otherId])
    data = structuredClone(original)
    await React.act(() => paint(true))
    assert.equal(card().querySelector('[data-field="function_description"] textarea').value, original.functions[id].function_description)
    assert.equal(writes, 1)
  } finally { await React.act(async () => root.unmount()) }
})

for (const [name, section, fieldKey] of [
  ['business_data', 'objects', 'description'],
  ['ai_agent_capabilities', 'agents', 'description'],
  ['business_rules', 'rules', 'outcome'],
]) test(`${name} retains its explicitly authored primary scope and canonical draft editing`, async () => {
  const { manifest, data: original } = bundle(name)
  const id = Object.keys(original[section])[0]
  let data = structuredClone(original), writes = 0
  const root = createRoot(document.getElementById('root'))
  const paint = editable => root.render(renderNode({ component: 'record_form', id: 'scope-check', source: section }, manifest, data, {
    locale: 'en-US', editable,
    onPanelUpdate: update => { writes++; data = { ...data, ...update }; paint(true) },
  }))
  const field = () => document.querySelector(`[data-section="${section}"] [data-record="${id}"] [data-field="${fieldKey}"]`)
  try {
    await React.act(() => paint(false))
    const scope = field().closest('.dsh-panel-content-group')
    assert.ok(Boolean(scope), 'the confirmed primary section remains explicit')
    const caption = manifest.fields.find(field => field.key === fieldKey && field.applies_to.includes(section)).label
    assert.equal(scope.querySelector(':scope > summary').textContent.includes(caption), true)
    assert.equal(scope.open, true)
    assert.equal(field().querySelector('textarea'), null)
    await React.act(() => paint(true))
    await replaceText(field().querySelector('textarea'), 'User correction\nKeep the full explanation')
    assert.equal(data[section][id][fieldKey], 'User correction\nKeep the full explanation')
    assert.deepEqual(Object.fromEntries(Object.entries(data[section]).filter(([key]) => key !== id)),
      Object.fromEntries(Object.entries(original[section]).filter(([key]) => key !== id)))
    data = structuredClone(original)
    await React.act(() => paint(true))
    assert.equal(field().querySelector('textarea').value, original[section][id][fieldKey], 'reset restores the original full value')
    assert.equal(writes, 1)
  } finally { await React.act(async () => root.unmount()) }
})

test.after(() => dom.window.close())
