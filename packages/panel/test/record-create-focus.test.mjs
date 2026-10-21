import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderManifest } = await import('../src/interpreter.ts')
after(() => dom.window.close())

test('shared record creation focuses a declared name once, without focusing navigation or readonly records', async () => {
  for (const navigation of ['list', 'tree']) {
    for (const header of [false, true]) {
      const manifest = { version: 1, panel_kind: 'document',
        sections: [{ id: 'equipment', title: 'Equipment', item_name: 'Equipment', order: 'equipment_order',
          create: { initial_label: { field: 'caption', text: 'New equipment', numbered_text: 'New equipment {index}' } },
          ...(header ? { form: { header: { variant: 'detail', title: { field: 'caption', editable: true } } } } : {}) }],
        fields: [{ key: 'caption', label: 'Equipment caption', control: 'text', applies_to: ['equipment'] }],
        ui: { id: 'workspace', component: 'record_workspace', sources: ['equipment'], navigation_layout: navigation,
          children: [{ id: 'inspector', component: 'record_inspector' }] } }
      const baseline = { equipment: { old: { caption: 'Existing meter', hidden: 'Keep' } }, equipment_order: ['old'] }
      let current, setData, pending
      const root = createRoot(document.getElementById('root'))
      function App({ editable = true, delayed = false }) {
        const [data, update] = React.useState(baseline)
        current = data; setData = update
        return renderManifest(manifest, data, { editable, locale: 'en-US', onPanelUpdate: next => {
          if (delayed) pending = next
          else update(value => ({ ...value, ...next }))
        } })
      }
      const show = props => React.act(async () => root.render(React.createElement(App, props)))
      const titleInput = () => document.querySelector(header ? '[data-panel-title="editable"]' : '[data-field="caption"] input')
      try {
        await show({})
        assert.notEqual(document.activeElement, titleInput(), 'initial selection never steals focus')
        const add = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Add Equipment')
        assert.ok(add)
        add.focus()
        await React.act(async () => add.click())
        const input = titleInput()
        assert.equal(document.activeElement, input)
        assert.equal(input.value, 'New equipment 2')
        assert.deepEqual(current.equipment.old, baseline.equipment.old)
        // A normal host update after editing must not reapply creation focus.
        add.focus()
        await React.act(async () => setData(value => structuredClone(value)))
        assert.equal(document.activeElement, add)
        await show({ editable: false })
        assert.equal(document.querySelector('[data-field="caption"] input'), null)
        assert.equal(document.querySelector('[data-panel-title="editable"]'), null)
        assert.notEqual(document.activeElement, input)
        await show({ editable: true, delayed: true })
        const secondAdd = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Add Equipment')
        secondAdd.focus()
        await React.act(async () => secondAdd.click())
        assert.ok(pending)
        assert.equal(document.activeElement, secondAdd, 'wait until delayed insertion actually exists')
        await React.act(async () => setData(value => ({ ...value, ...pending })))
        assert.equal(document.activeElement, titleInput())
        assert.equal(titleInput().value, 'New equipment 3')
        // A late host result must not pull the user away from a different record.
        secondAdd.focus()
        await React.act(async () => secondAdd.click())
        const previous = [...document.querySelectorAll('nav button')].find(button =>
          button.getAttribute('aria-label') === 'old' || button.textContent === 'old')
        assert.ok(previous)
        previous.focus()
        await React.act(async () => previous.click())
        await React.act(async () => setData(value => ({ ...value, ...pending })))
        assert.equal(document.activeElement, previous)
        assert.equal(titleInput().value, 'Existing meter')
        // Cancelling editability while an insertion is pending also cancels focus.
        secondAdd.focus()
        await React.act(async () => secondAdd.click())
        await show({ editable: false, delayed: true })
        await React.act(async () => setData(value => ({ ...value, ...pending })))
        await show({ editable: true, delayed: true })
        assert.notEqual(document.activeElement, titleInput())
      } finally { await React.act(async () => root.unmount()) }
    }
  }
})

test('the actual quality acceptance declaration focuses its new name in both locales', async () => {
  const { parsePanelManifest } = await import('../../core/src/panel-dsl.ts')
  const bundle = new URL('../../skills-web-app/bundles/quality_acceptance/', import.meta.url)
  const manifest = parsePanelManifest(readFileSync(new URL('panel.yaml', bundle), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(['zh-CN', 'en-US'].map(locale => [locale,
    JSON.parse(readFileSync(new URL(`locales/${locale}.json`, bundle), 'utf8'))]))
  for (const locale of ['zh-CN', 'en-US']) {
    const baseline = { schema_version: 4, requirements: { old: { id: 'old', title: 'Existing requirement',
      condition: '', pass_criteria: '', verification: '' } }, requirement_order: ['old'] }
    let current
    function App() {
      const [data, update] = React.useState(baseline)
      current = data
      return renderManifest(manifest, data, { locale, editable: true,
        onPanelUpdate: next => update(value => ({ ...value, ...next })) })
    }
    const root = createRoot(document.getElementById('root'))
    try {
      await React.act(async () => root.render(React.createElement(App)))
      const add = document.querySelector('.dsh-record-workspace-flat-add')
      assert.ok(add)
      add.focus()
      await React.act(async () => add.click())
      const newId = current.requirement_order.find(id => id !== 'old')
      assert.ok(newId)
      const title = document.querySelector(`[data-record="${newId}"] [data-field="title"] input`)
      assert.ok(title)
      assert.equal(document.activeElement, title)
      assert.equal(title.value, current.requirements[newId].title)
      assert.deepEqual(current.requirements.old, baseline.requirements.old)
    } finally { await React.act(async () => root.unmount()) }
  }
})
