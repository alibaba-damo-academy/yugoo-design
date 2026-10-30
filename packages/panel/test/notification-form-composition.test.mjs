import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[name] = dom.window[name]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderNode } = await import('../src/interpreter.ts')
const { loadDesignKit } = await import('../../core/src/kit-loader.ts')
const { localizePanelManifest, validatePanelManifest } = await import('../../core/src/panel-dsl.ts')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
const { pathSet } = await import('../src/record-state.ts')
const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error } },
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
const kit = await loadDesignKit(fs, fileURLToPath(new URL('../../skills-web-app', import.meta.url)), { sourceId: 'fixture:notification-composition' })
const manifest = kit.skills.find(skill => skill.name === 'notification_design').metadata.panelManifest
const data = { schema_version: 3, notifications: {
  a: { id: 'a', title: 'Existing notification', trigger: 'When submitted', recipients: ['Applicant'], channels: ['in_app', 'External'], message: 'First line\nSecond line', action_target: 'Request detail' },
  b: { id: 'b', title: 'Preserved notification', trigger: 'After review', recipients: ['Reviewer'], channels: ['in_app'], message: 'Keep message', action_target: 'Keep destination' },
}, notification_order: ['a', 'b'] }

test('detail-preview family responds to its content width and owns one narrow scroll region', async () => {
  const css = await readFile(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  assert.match(css, /\.is-record-preview > \.dsh-panel-workspace-main \{ container: record-preview-main \/ inline-size;/)
  const narrow = css.match(/@container record-preview-main \(max-width: 720px\) \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(narrow)
  assert.match(narrow, /\.is-record-preview > \.dsh-panel-workspace-main > \.dsh-record-workspace-body \{[^}]*flex: 1;[^}]*min-height: 0;[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*overflow: auto;/)
  assert.match(narrow, /grid-auto-rows: max-content;/, 'long inspector content must not shrink into the following preview row')
  assert.match(narrow, /\.dsh-record-inspector\.is-preview-pane \{[^}]*height: auto;[^}]*overflow: visible;/)
  assert.match(narrow, /\.dsh-record-preview\.is-preview-pane \{[^}]*overflow: visible;[^}]*border-left: 0;/)
  assert.ok(css.indexOf('@container record-preview-main') > css.indexOf('@container (max-width: 720px)'), 'family override follows the general narrow workspace defaults')
})

test('actual Kit loader retains notification fields with one label level and a same-record workspace preview', () => {
  for (const [locale, labels] of [['zh-CN', ['触发时机', '接收对象', '通知方式', '通知内容', '后续操作']], ['en-US', ['Trigger', 'Recipients', 'Channels', 'Message', 'Next action']]]) {
    const panel = localizePanelManifest(manifest, locale)
    assert.deepEqual(validatePanelManifest(panel), [])
    const section = panel.sections[0]
    assert.equal(section.order, 'notification_order')
    assert.equal(section.form.reorder, false)
    assert.deepEqual(section.form.header, { variant: 'detail', title: { field: 'title', editable: true } })
    const fields = ['trigger', 'recipients', 'channels', 'message', 'action_target']
    assert.deepEqual(section.form.body.map(item => item.field), fields)
    assert.ok(section.form.body.every(item => item.kind === 'field'))
    assert.deepEqual(fields.map(key => panel.fields.find(field => field.key === key).label), labels)
    assert.equal(panel.fields.find(field => field.key === 'action_target').control, 'text')
    assert.deepEqual(section.create.defaults.channels, ['in_app'])
    assert.deepEqual(panel.ui.children.map(child => child.component), ['record_inspector', 'record_preview'])
    assert.equal(panel.ui.children[1].source, 'notifications')
    assert.deepEqual(panel.ui.children[1].preview, { title: 'title', body: 'message', action: 'action_target' })
    const invalid = structuredClone(panel)
    invalid.ui.children[1].preview.body = 'undeclared'
    assert.ok(validatePanelManifest(invalid).some(error => error.includes('undeclared preview field')))
    invalid.ui.children[1].source = 'outside-workspace'
    assert.ok(validatePanelManifest(invalid).some(error => error.includes('requires a workspace source')))
  }
})

test('notification composition has one editable title, visible accessible labels, retained preview and narrow edits', async () => {
  const container = document.getElementById('root'), root = createRoot(container)
  const before = structuredClone(data), changes = []
  const show = (locale, editable = true) => React.act(async () => {
    const panel = localizePanelManifest(manifest, locale)
    root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
      renderNode(panel.ui, panel, data, { locale, editable, onPanelUpdate: next => changes.push(next) })))
  })
  try {
    for (const locale of ['zh-CN', 'en-US']) {
      await show(locale)
      assert.equal(container.querySelectorAll('.dsh-design-form-group').length, 0)
      assert.equal(container.querySelectorAll('.dsh-design-record-header-input').length, 1)
      assert.equal(container.querySelector('[data-field="title"]'), null)
      for (const key of ['trigger', 'recipients', 'channels', 'message', 'action_target']) assert.equal(container.querySelectorAll(`[data-field="${key}"]`).length, 1)
      assert.ok(container.querySelector('[data-field="trigger"] textarea').getAttribute('aria-label'))
      assert.ok(container.querySelector('[data-field="trigger"] .dsh-design-field-label'))
      assert.equal(container.querySelector('[data-field="message"] textarea').value, data.notifications.a.message)
      assert.equal(container.querySelector('[data-field="action_target"] textarea'), null)
      assert.equal(container.querySelector('[data-field="action_target"] input').value, data.notifications.a.action_target)
      assert.equal(container.querySelector('.dsh-record-preview article p').textContent, data.notifications.a.message)
      assert.equal(container.querySelectorAll('.dsh-record-preview').length, 1)
      assert.equal(container.querySelector('.dsh-record-preview').parentElement.className, 'dsh-record-workspace-body is-split-view', 'the inspector and preview keep an explicit two-pane owner')
      assert.ok(container.querySelector('.dsh-record-workspace-frame.is-record-form.is-record-preview'))
      assert.equal(changes.length, 0, 'mount/language switching do not write facts')
    }
    const input = container.querySelector('[data-field="action_target"] input')
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Edited destination')
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    assert.equal(changes.length, 1)
    assert.deepEqual(changes[0].notifications.a, { ...data.notifications.a, action_target: 'Edited destination' })
    assert.deepEqual(changes[0].notifications.b, data.notifications.b)
    assert.equal(changes[0].notification_order, undefined)
    assert.deepEqual(data, before)
    await show('en-US', false)
    assert.equal(container.querySelector('.dsh-design-record-header-input'), null)
    assert.equal(container.querySelector('[data-field="action_target"] input'), null)
    assert.ok(container.querySelector('[data-field="action_target"]').textContent.includes(data.notifications.a.action_target))
    assert.equal(container.querySelector('.dsh-token-add'), null)
    assert.equal(changes.length, 1)
  } finally { await React.act(async () => root.unmount()) }
})

test('workspace preview follows canonical edits, selection and locale without a second data model', async () => {
  const container = document.getElementById('root'), root = createRoot(container)
  let current = structuredClone(data), locale = 'en-US', wrapped = false
  const original = structuredClone(current), changes = []
  const paint = () => {
    const panel = localizePanelManifest(manifest, locale)
    if (wrapped) panel.ui = { ...panel.ui, children: panel.ui.children.map(child => ({ component: 'stack', id: `wrap-${child.id}`, children: [child] })) }
    root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
    renderNode(panel.ui, panel, current, { locale, editable: true, onPanelUpdate: next => {
      changes.push(next)
      for (const [path, value] of Object.entries(next)) current = pathSet(current, path, value)
      paint()
    } })))
  }
  const edit = (element, text) => React.act(async () => {
    const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text)
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  const preview = () => container.querySelector('.dsh-record-preview article')
  try {
    await React.act(async () => paint())
    await edit(container.querySelector('.dsh-design-record-header-input'), 'Renamed notification')
    await edit(container.querySelector('[data-field="message"] textarea'), 'Edited line one\nEdited line two')
    await edit(container.querySelector('[data-field="action_target"] input'), 'Edited destination')
    assert.equal(preview().querySelector('h3').textContent, current.notifications.a.title)
    assert.equal(preview().querySelector('p').textContent, current.notifications.a.message)
    assert.equal(preview().querySelector('strong').textContent, `${current.notifications.a.action_target} →`)
    assert.equal(preview().querySelector('button,a,input,textarea'), null, 'preview does not execute or own edits')
    assert.equal(changes.length, 3)
    assert.deepEqual(current.notifications.b, original.notifications.b)
    assert.deepEqual(current.notifications.a.recipients, original.notifications.a.recipients)
    assert.deepEqual(current.notifications.a.channels, original.notifications.a.channels)
    assert.equal(current.notifications.a.trigger, original.notifications.a.trigger)
    assert.equal(current.notifications.a.id, original.notifications.a.id)
    assert.deepEqual(current.notification_order, original.notification_order)
    for (const index of [1, 0]) {
      const title = current.notifications[index ? 'b' : 'a'].title
      const item = [...container.querySelectorAll('.dsh-panel-workspace-tree-item')].find(button => button.textContent === title)
      assert.ok(item, 'the shared structural navigation exposes the original record')
      await React.act(async () => item.click())
      assert.equal(preview().querySelector('h3').textContent, current.notifications[index ? 'b' : 'a'].title)
      assert.equal(preview().querySelector('p').textContent, current.notifications[index ? 'b' : 'a'].message)
    }
    locale = 'zh-CN'
    await React.act(async () => paint())
    assert.equal(container.querySelector('.dsh-record-preview > small').textContent, '通知内容预览')
    assert.equal(preview().querySelector('h3').textContent, 'Renamed notification', 'locale cannot rewrite user content')
    assert.equal(changes.length, 3, 'selection and localization cannot persist facts')
    wrapped = true
    await React.act(async () => paint())
    assert.ok(container.querySelector('.is-record-preview .is-split-view'), 'transparent stacks retain the detail-preview family')
    assert.ok(container.querySelector('.dsh-record-inspector.is-preview-pane'))
    assert.ok(container.querySelector('.dsh-record-preview.is-preview-pane'))
    assert.equal(changes.length, 3, 'changing composition cannot write canonical data')
    await edit(container.querySelector('[data-field="message"] textarea'), 'Edited through a transparent stack')
    assert.equal(preview().querySelector('p').textContent, current.notifications.a.message)
    assert.equal(changes.length, 4)
    assert.deepEqual(current.notifications.b, original.notifications.b)

  } finally { await React.act(async () => root.unmount()) }
})
