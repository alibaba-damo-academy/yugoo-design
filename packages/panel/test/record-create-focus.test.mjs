import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderManifest, applyDesignEditToDraft } = await import('../src/interpreter.ts')
after(() => dom.window.close())

test('shared record creation focuses a declared name once, without focusing navigation or readonly records', async () => {
  for (const navigation of ['list', 'tree']) {
    for (const header of [false, true]) {
      const manifest = { version: 1, panel_kind: 'document',
        sections: [{ id: 'equipment', title: 'Equipment', item_name: 'Equipment', order: 'equipment_order',
          create: { id_field: 'id', id_prefix: 'EQ', initial_label: { field: 'caption', text: 'New equipment', numbered_text: 'New equipment {index}' } },
          ...(header ? { form: { header: { variant: 'detail', title: { field: 'caption', editable: true } } } } : {}) }],
        fields: [{ key: 'caption', label: 'Equipment caption', control: 'text', applies_to: ['equipment'] },
          { key: 'id', control: 'text', hidden: true, readonly: true, applies_to: ['equipment'] }],
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
        assert.equal(current.equipment['EQ-001'].id, 'EQ-001', 'the ordinary Add path uses the declared business prefix')
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
          ['old', 'Existing meter'].includes(button.getAttribute('aria-label') ?? button.textContent))
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
    let current, setData, pending
    function App({ editable = true, delayed = false }) {
      const [data, update] = React.useState(baseline)
      current = data; setData = update
      return renderManifest(manifest, data, { locale, editable,
        onEdit: edit => update(value => applyDesignEditToDraft(value, manifest, edit)),
        onPanelUpdate: next => {
          if (delayed) pending = next
          else update(value => ({ ...value, ...next }))
        } })
    }
    const root = createRoot(document.getElementById('root'))
    const show = props => React.act(async () => root.render(React.createElement(App, props)))
    const titleFor = id => document.querySelector(`[data-board-record="${id}"] [data-panel-title="editable"]`)
    const addButton = () => document.querySelector('.dsh-panel-workspace-tree-add')
    const delayedId = () => Object.keys(pending.requirements).find(id => !Object.hasOwn(current.requirements, id))
    const applyPending = () => React.act(async () => setData(value => ({ ...value, ...pending })))
    try {
      await show({})
      assert.equal(document.activeElement === titleFor('old'), false, 'opening an existing Board never applies creation focus')
      const add = addButton()
      assert.ok(add)
      add.focus()
      await React.act(async () => add.click())
      const newId = current.requirement_order.find(id => id !== 'old')
      assert.ok(newId)
      const title = titleFor(newId)
      assert.ok(title)
      assert.equal(document.activeElement === title, true, 'the new Board title receives creation focus')
      assert.equal(title.value, current.requirements[newId].title)
      assert.equal(current.requirements[newId].id, newId)
      assert.deepEqual(current.requirements.old, baseline.requirements.old)
      add.focus()
      await React.act(async () => setData(value => structuredClone(value)))
      assert.equal(document.activeElement === add, true, 'ordinary host updates do not repeat the completed focus request')

      await show({ delayed: true })
      addButton().focus()
      await React.act(async () => addButton().click())
      const waiting = delayedId()
      assert.ok(waiting)
      assert.equal(titleFor(waiting), null, 'a delayed insertion is not yet in the draft')
      assert.equal(document.activeElement === addButton(), true, 'focus stays on Add until the exact insertion arrives')
      await applyPending()
      assert.equal(document.activeElement === titleFor(waiting), true)
      assert.equal(titleFor(waiting).value, current.requirements[waiting].title)

      addButton().focus()
      await React.act(async () => addButton().click())
      const late = delayedId()
      const outline = document.querySelector('.dsh-panel-workspace-tree-record-toggle[aria-expanded="false"]')
      if (outline) await React.act(async () => outline.click())
      const originalNavigation = [...document.querySelectorAll('.dsh-panel-workspace-sidebar button')]
        .find(button => button.textContent === 'Existing requirement')
      assert.ok(originalNavigation)
      originalNavigation.focus()
      await React.act(async () => originalNavigation.click())
      await applyPending()
      assert.ok(titleFor(late), 'the late result still lands without forcing selection or focus')
      assert.equal(document.activeElement === originalNavigation, true, 'changing records cancels pending creation focus')

      addButton().focus()
      await React.act(async () => addButton().click())
      const cancelled = delayedId()
      await show({ editable: false, delayed: true })
      await applyPending()
      assert.equal(titleFor(cancelled), null)
      await show({ delayed: true })
      assert.ok(titleFor(cancelled))
      assert.equal(document.activeElement === titleFor(cancelled), false, 'restoring editability does not revive a cancelled focus request')
      assert.deepEqual(current.requirements.old, baseline.requirements.old)
      assert.equal(current.requirements[newId].title, title.value)
    } finally { await React.act(async () => root.unmount()) }
  }
})
