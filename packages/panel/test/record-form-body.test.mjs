import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installSelectDom, chooseSelectValue, inspectSelectOption } from './select-interaction.mjs'
const dom = new JSDOM('<style></style><button id="outside">Outside</button><div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
installSelectDom(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
document.querySelector('style').textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderNode } = await import('../src/interpreter.ts')
const { pathSet } = await import('../src/record-state.ts')
const { parsePanelManifest, validatePanelManifest, localizePanelManifest } = await import('../../core/src/panel-dsl.ts')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
const { CustomChoice } = await import('../src/custom-choice.tsx')

test('sibling labels share visible/accessibility copy, fallback and read-only presentation without writes', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items' }], fields: [
    { key: 'mode', control: 'text', label: 'Mode', applies_to: ['items'] },
    { key: 'detail', control: 'text', label: 'Fallback', applies_to: ['items'], label_when: [
      { field: 'mode', in: ['automatic'], label: 'When it runs' },
      { field: 'mode', in: ['automatic', 'manual'], label: 'Action location' },
    ] },
  ], ui: { id: 'form', component: 'record_form', source: 'items' } }
  assert.deepEqual(validatePanelManifest(manifest), [])
  const writes = []
  try {
    for (const [mode, label] of [['automatic', 'When it runs'], ['manual', 'Action location'], ['unknown', 'Fallback']]) {
      const data = { items: { one: { mode, detail: 'User value' } } }, before = structuredClone(data)
      for (const editable of [true, false]) {
        await React.act(async () => root.render(renderNode(manifest.ui, manifest, data, { editable, onPanelUpdate: patch => writes.push(patch) })))
        const field = document.querySelector('[data-field="detail"]')
        assert.equal(field.querySelector('.dsh-design-field-label').textContent, label)
        if (editable) assert.equal(field.querySelector('input').getAttribute('aria-label'), label)
        else assert.match(field.textContent, /User value/)
      }
      assert.deepEqual(data, before)
    }
    assert.equal(writes.length, 0)
    assert.equal(manifest.fields[1].label, 'Fallback')
  } finally { await React.act(async () => root.unmount()) }
})

test('shared groups dedupe exact captions but retain semantic scopes, hidden sole captions, preview context and edits', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'entries', title: 'Entries', form: { body: [
    { kind: 'group', title: '$t:notes', description: '$t:help', items: [{ kind: 'field', field: 'notes' }] },
    { kind: 'group', title: '$t:required', items: [{ kind: 'field', field: 'requirement', label: 'visually_hidden' }] },
    { kind: 'group', title: '$t:scope', items: [{ kind: 'field', field: 'context' }] },
    { kind: 'group', title: '$t:multiple', items: [{ kind: 'field', field: 'first' }, { kind: 'field', field: 'second' }] },
    { kind: 'group', title: '$t:example', items: [{ kind: 'field', field: 'example' }],
      sidecar: { component: 'record_preview', preview: { title: 'example', body: 'example' } } },
    { kind: 'group', title: 'Hidden group', items: [{ kind: 'field', field: 'conditional' }] },
  ] } }], fields: [
    { key: 'notes', label: '$t:notes', description: '$t:help', control: 'textarea', required: true },
    { key: 'requirement', label: '$t:required', control: 'textarea', required: true },
    { key: 'context', label: '$t:context', control: 'textarea' },
    { key: 'first', label: '$t:multiple', control: 'text' },
    { key: 'second', label: 'Second', control: 'text' },
    { key: 'example', label: '$t:example', control: 'textarea' },
    { key: 'conditional', label: 'Conditional', control: 'text', visible_when: { field: 'first', in: ['show'] } },
  ].map(field => ({ ...field, applies_to: ['entries'] })),
  i18n: { default_locale: 'en-US', locales: { 'en-US': 'locales/en-US.json', 'zh-CN': 'locales/zh-CN.json' }, messages: {
    'en-US': { notes: 'Notes', help: 'Preserve this explanation', required: 'Assignment', scope: 'Deployment boundary', context: 'Description', multiple: 'Inputs', example: 'Example' },
    'zh-CN': { notes: '备注', help: '保留专业说明', required: '获得方式', scope: '部署边界', context: '说明', multiple: '输入', example: '样例' },
  } }, ui: { id: 'neutral-form', component: 'record_form', source: 'entries' } }
  assert.deepEqual(validatePanelManifest(manifest), [])
  const data = { entries: { a: { notes: 'Original', requirement: '', context: 'Keep scope', first: 'hidden', second: 'Keep second', example: 'Preview' } } }
  const original = structuredClone(data), updates = []
  const show = (locale, editable = true) => React.act(async () => root.render(React.createElement('div', { className: 'dsh-design-panel' },
    renderNode(manifest.ui, localizePanelManifest(manifest, locale), data, { locale, editable, onPanelUpdate: patch => updates.push(patch) }))))
  try {
    for (const locale of ['en-US', 'zh-CN']) {
      await show(locale)
      const copy = manifest.i18n.messages[locale]
      assert.deepEqual([...document.querySelectorAll('.dsh-design-form-group-title')].map(e => e.textContent),
        [copy.required + ' *', copy.scope, copy.multiple, copy.example], 'only an exact single-field duplicate disappears')
      const field = document.querySelector('[data-field="notes"]')
      assert.equal(field.querySelector('.dsh-design-field-label').textContent, copy.notes + ' *')
      assert.equal(field.querySelector('textarea').getAttribute('aria-label'), copy.notes)
      assert.equal(field.querySelector('textarea').getAttribute('aria-required'), 'true')
      assert.equal(document.querySelector('[data-field="requirement"] textarea').getAttribute('aria-required'), 'true')
      assert.equal(document.querySelector('[data-field="requirement"] > .dsh-design-required-mark'), null)
      assert.equal(document.querySelectorAll('.dsh-design-form-group-description').length, 1, 'help survives heading normalization')
      assert.equal(document.querySelectorAll('.dsh-record-preview').length, 1, 'preview context is not treated as a single input')
      assert.equal(document.querySelector('[data-field="conditional"]'), null)
      const help = window.getComputedStyle(field.querySelector('.dsh-design-field-description'))
      assert.equal(help.marginTop, 'var(--ygd-panel-detail-control-gap, 8px)')
      assert.equal(help.marginBottom, '0px', 'field help never stacks an extra section margin')
      assert.equal(updates.length, 0, 'render and locale switching cannot change data')
    }
    const input = document.querySelector('[data-field="notes"] textarea')
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'User edit')
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    assert.deepEqual(updates[0].entries.a, { ...data.entries.a, notes: 'User edit' })
    await show('en-US', false)
    assert.equal(document.querySelector('input,textarea,select'), null)
    assert.deepEqual(data, original)
    assert.equal(updates.length, 1)
  } finally { await React.act(async () => root.unmount()) }
})

test('shared help rhythm uses one owner in stacked and inline fields', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items', form: { body: [
    { kind: 'field', field: 'stacked' }, { kind: 'field', field: 'inline', label: 'inline' },
  ] } }], fields: [
    { key: 'stacked', label: 'Stacked', description: 'Stacked help', control: 'text', applies_to: ['items'] },
    { key: 'inline', label: 'Inline', description: 'Inline help', control: 'text', applies_to: ['items'] },
  ], ui: { id: 'neutral-rhythm', component: 'record_form', source: 'items' } }
  assert.deepEqual(validatePanelManifest(manifest), [])
  try {
    await React.act(async () => root.render(React.createElement('div', { className: 'dsh-design-panel' },
      renderNode(manifest.ui, manifest, { items: { a: { stacked: 'First', inline: 'Second' } } }, { editable: true }))))
    const stacked = document.querySelector('[data-field="stacked"]')
    const inline = document.querySelector('[data-field="inline"]')
    const stackedHelp = window.getComputedStyle(stacked.querySelector('.dsh-design-field-description'))
    const inlineHelp = window.getComputedStyle(inline.querySelector('.dsh-design-field-description'))
    assert.equal(stackedHelp.marginTop, 'var(--ygd-panel-detail-control-gap, 8px)')
    assert.equal(stackedHelp.marginBottom, '0px')
    assert.equal(window.getComputedStyle(inline).gap, '8px 12px')
    assert.equal(inlineHelp.marginTop, '0px', 'grid row-gap must not stack with another help margin')
    assert.equal(inlineHelp.marginBottom, '0px')
    assert.equal(inlineHelp.gridColumn, '2')
    const rules = [...document.querySelector('style').sheet.cssRules]
    assert.ok(rules.some(rule => rule.selectorText?.split(',').map(selector => selector.trim())
      .includes('.dsh-design-panel .dsh-design-field-description') && rule.style.marginTop),
    'Panel scope protects help rhythm from host paragraph resets; actual cascade is checked in Chrome')
  } finally { await React.act(async () => root.unmount()) }
})

test('required presentation follows sections, hidden headings, composites and newly added nested fields without creating gates', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [
    { id: 'items', title: 'Items', form: { body: [
      { kind: 'group', title: 'Assignment', items: [{ kind: 'field', field: 'choice', label: 'visually_hidden' }] },
      { kind: 'row', items: [{ kind: 'field', field: 'operation', label: 'visually_hidden', width: 'fill' }] },
    ] } }, { id: 'links', title: 'Links' } ], fields: [
    { key: 'description', label: 'Meaning', control: 'textarea', required_in: ['items'], applies_to: ['items', 'links'] },
    { key: 'choice', label: 'Assignment', control: 'radio_custom', required: true, options: [{ value: 'auto', label: 'Automatically' }], applies_to: ['items'] },
    { key: 'operation', label: 'Operation', control: 'text', required: true, applies_to: ['items'] },
    { key: 'members', label: 'Recipients', control: 'token_list', required: true, applies_to: ['items'] },
    { key: 'options', label: 'Options', control: 'multi_select', required: true, options: [{ value: 'one', label: 'One' }], applies_to: ['items'] },
    { key: 'children', label: 'Children', control: 'record_map', item_collapsible: true, item_label_field: 'name', applies_to: ['items'], item_defaults: { name: '', mode: 'off', detail: '' },
      item_fields: [{ key: 'name', label: 'Name', control: 'text', required: true },
        { key: 'mode', label: 'Mode', control: 'radio', required: true, options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
        { key: 'detail', label: 'Detail', control: 'text', required: true, visible_when: { field: 'mode', in: ['on'] }, clear_when_hidden: true }] },
    { key: 'notes', label: 'Notes', control: 'textarea', applies_to: ['items', 'links'] },
  ], ui: { id: 'form', component: 'record_form', source: 'items' } }
  assert.deepEqual(validatePanelManifest(manifest), [])
  const original = { items: { a: { description: '', choice: 'auto', operation: '', members: [], options: [], children: {}, notes: '' } }, links: { l: { description: '', notes: '' } } }
  let data = structuredClone(original), writes = 0
  const show = (source = 'items', locale = 'en-US') => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
    React.createElement('div', { className: 'dsh-design-panel' }, renderNode({ ...manifest.ui, source }, manifest, data,
      { editable: true, locale, onPanelUpdate: patch => { data = { ...data, ...patch }; writes++ } })))))
  const field = key => document.querySelector(`[data-field="${key}"]`)
  try {
    await show()
    assert.equal(writes, 0); assert.deepEqual(data, original)
    assert.equal(field('description').querySelector('textarea').getAttribute('aria-required'), 'true')
    assert.equal(document.querySelector('.dsh-design-form-group-title').textContent, 'Assignment *')
    assert.equal(field('choice').querySelector(':scope > .dsh-design-required-mark'), null, 'matching group owns exactly one visible mark')
    assert.equal(field('choice').querySelector('[role="radiogroup"]').getAttribute('aria-required'), 'true')
    assert.ok(field('operation').querySelector(':scope > .dsh-design-required-mark'), 'standalone hidden caption keeps a visible inline mark')
    assert.equal(window.getComputedStyle(field('operation')).gridTemplateColumns, 'minmax(0, 1fr) auto')
    assert.equal(field('members').querySelector('[role="group"]').getAttribute('aria-label'), 'Recipients (required)')
    assert.equal(field('options').querySelector('[role="group"]').getAttribute('aria-label'), 'Options (required)')
    assert.equal(document.querySelector('[role="group"][aria-required]'), null, 'group does not support aria-required')
    assert.equal(document.querySelector('input[required],textarea[required],select[required]'), null, 'no native submit gate is introduced')
    assert.equal(field('notes').querySelector('.dsh-design-required-mark'), null)
    await React.act(async () => field('children').querySelector('.dsh-record-map-add').click()); await show()
    const child = field('children').querySelector('[data-child-record]')
    assert.equal(child.querySelector('[data-field="name"] input').getAttribute('aria-required'), 'true')
    assert.equal(child.querySelector('[data-field="detail"]'), null)
    await React.act(async () => child.querySelectorAll('input[type="radio"]')[1].click()); await show()
    assert.equal(field('children').querySelector('[data-field="detail"] input').getAttribute('aria-required'), 'true')
    assert.deepEqual(data.links, original.links)
    await show('items', 'zh-CN')
    assert.equal(field('members').querySelector('[role="group"]').getAttribute('aria-label'), 'Recipients（必填）')
    await show('links')
    assert.equal(field('description').querySelector('textarea').getAttribute('aria-required'), null)
    assert.equal(field('description').querySelector('.dsh-design-required-mark'), null, 'same key remains optional in another section')
    assert.equal(field('notes').querySelector('.dsh-design-required-mark'), null)
  } finally { await React.act(async () => root.unmount()) }
})

test('shared field foundations keep native input geometry across plain and composed forms with semantic exceptions', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'entries', title: 'Entries' }],
    fields: [
      { key: 'title', label: 'Title', control: 'text', applies_to: ['entries'] },
      { key: 'name', label: 'Name', control: 'text', applies_to: ['entries'] },
      { key: 'notes', label: 'Notes', control: 'textarea', applies_to: ['entries'] },
      { key: 'mode', label: 'Mode', control: 'select', options: [{ value: 'on', label: 'On' }], applies_to: ['entries'] },
      { key: 'enabled', label: 'Enabled', control: 'toggle', applies_to: ['entries'] },
      { key: 'children', label: 'Children', control: 'record_map', columns: [{ key: 'name', label: 'Child name', control: 'text' }], applies_to: ['entries'] },
    ], ui: { component: 'record_form', id: 'foundation-form', source: 'entries' } }
  const data = { entries: { a: { title: 'Entry', name: 'Keep', notes: 'Original notes', mode: 'on', enabled: true,
    children: { child: { name: 'Child' } } } } }, before = structuredClone(data)
  let writes = 0
  const show = () => React.act(async () => root.render(React.createElement('div', { className: 'dsh-design-panel' },
    renderNode(manifest.ui, manifest, data, { editable: true, onPanelUpdate: () => { writes++ } }))))
  const style = selector => window.getComputedStyle(document.querySelector(selector))
  const checkInput = selector => {
    const value = style(selector)
    assert.equal(value.height, '36px'); assert.equal(value.minHeight, '36px')
    assert.equal(value.fontSize, 'var(--ygd-panel-text-size,14px)'); assert.equal(value.lineHeight, '20px')
    assert.equal(value.padding, '4px 12px'); assert.equal(value.borderRadius, '8px')
  }
  try {
    await show()
    checkInput('[data-field="name"] input'); checkInput('.dsh-record-map input')
    assert.equal(style('[data-field="name"] .dsh-design-field-label').fontSize, 'var(--ygd-panel-text-size, 14px)')
    assert.equal(style('[data-field="name"] .dsh-design-field-label').lineHeight, '20px')
    assert.equal(style('.dsh-record-map label > span:first-child').fontSize, '12px', 'simple card captions use the reviewed secondary hierarchy, not nested field headings')
    assert.notEqual(style('.dsh-record-map label > span:first-child').display, 'none', 'ordinary single-column records keep their visible column meaning')
    assert.equal(document.querySelector('.dsh-record-map.is-compact'), null, 'multi-column defaults do not change the single-column contract')
    const textarea = style('[data-field="notes"] textarea'), select = style('[data-field="mode"] [role="combobox"]')
    const exceptions = { textareaHeight: textarea.minHeight, textareaResize: textarea.resize, selectPadding: select.padding }
    assert.equal(exceptions.textareaHeight, '88px'); assert.equal(exceptions.textareaResize, 'vertical')
    manifest.sections[0].form = { header: { variant: 'detail', title: { field: 'title', editable: true } },
      body: [{ kind: 'field', field: 'name' }, { kind: 'field', field: 'notes' }, { kind: 'field', field: 'mode' }, { kind: 'field', field: 'enabled' }, { kind: 'field', field: 'children' }] }
    assert.deepEqual(validatePanelManifest(manifest), [])
    await show()
    checkInput('[data-field="name"] input'); checkInput('.dsh-record-map input')
    assert.equal(style('.dsh-design-record-header-input').height, '32px')
    assert.equal(style('[data-field="notes"] textarea').minHeight, exceptions.textareaHeight, 'composition preserves multiline editing space')
    assert.equal(style('[data-field="notes"] textarea').padding, '8px 12px')
    assert.equal(style('[data-field="notes"] textarea').resize, exceptions.textareaResize)
    assert.equal(style('[data-field="mode"] [role="combobox"]').padding, '4px 12px', 'select shares ordinary text control geometry')
    assert.equal(style('[data-field="mode"] [role="combobox"]').height, '36px')
    assert.equal(style('[data-field="mode"] [role="combobox"]').borderRadius, '8px')
    assert.equal(style('[data-field="notes"] textarea').borderRadius, '8px')
    assert.equal(style('[data-field="name"] .dsh-design-field-label').marginBottom, '8px')
    assert.notEqual(style('[data-field="enabled"] input').height, '36px', 'choice controls are excluded')
    assert.equal(writes, 0); assert.deepEqual(data, before)
  } finally { await React.act(async () => root.unmount()) }
})

test('business-rule groups retain localized descriptions, accessible fields and canonical edit boundaries', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = parsePanelManifest(readFileSync(new URL('../../skills-web-app/bundles/business_rules/panel.yaml', import.meta.url), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(['zh-CN', 'en-US'].map(locale => [locale,
    JSON.parse(readFileSync(new URL(`../../skills-web-app/bundles/business_rules/locales/${locale}.json`, import.meta.url), 'utf8'))]))
  const data = {schema_version:4, rules:{a:{id:'a',title:'Existing rule',condition:'When submitted',outcome:'First line\nSecond line',notes:'Keep note'},b:{id:'b',title:'Other',outcome:'Keep result'}},rule_order:['a','b']}
  let patch
  const show = locale => React.act(async () => root.render(React.createElement('div',{className:'dsh-design-panel'},
    renderNode(manifest.ui,localizePanelManifest(manifest,locale),data,{locale,editable:true,onPanelUpdate:next=>{patch=next}}))))
  try {
    for(const locale of ['zh-CN','en-US']) {
      await show(locale)
      assert.equal(patch,undefined,'localization/mount cannot write canonical facts')
      assert.equal(document.querySelectorAll('.dsh-design-form-group').length,2)
      assert.equal(document.querySelector('.dsh-design-form-group-title').textContent,manifest.i18n.messages[locale].ruleContent)
      for(const key of ['condition','outcome','notes'])assert.equal(document.querySelectorAll(`[data-field="${key}"]`).length,1)
      const notes=document.querySelector('[data-field="notes"] textarea')
      assert.equal(notes.getAttribute('aria-label'),manifest.i18n.messages[locale].notes)
      assert.equal(document.querySelectorAll('.dsh-design-field-description').length,0,'help appears at group level only')
      assert.equal(document.querySelector('[data-field="outcome"] textarea').value,data.rules.a.outcome)
    }
    const notes=document.querySelector('[data-field="notes"] textarea')
    await React.act(async()=>{
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(notes,'Edited note')
      notes.dispatchEvent(new window.Event('input',{bubbles:true}))
    })
    assert.deepEqual(patch.rules.a,{...data.rules.a,notes:'Edited note'})
    assert.deepEqual(patch.rules.b,data.rules.b)
    assert.equal(patch.rule_order,undefined)
    assert.equal(data.rules.a.notes,'Keep note')
  } finally {await React.act(async()=>root.unmount())}
})

test('native composition and neutral records preserve binding, conditional cleanup, user-only focus and saved select values', async () => {
  const root = createRoot(document.getElementById('root'))
  let manifest = parsePanelManifest(readFileSync(new URL('../../skills-web-app/bundles/role_access/panel.yaml', import.meta.url), 'utf8'))
  // The Kit now opts into a table. Keep this regression on the supported card
  // composition; related-record-table.test covers its new default separately.
  delete manifest.ui.children.find(node => node.component === 'record_inspector').children[0].record_table
  manifest.i18n.messages = Object.fromEntries(['zh-CN', 'en-US'].map(locale => [locale,
    JSON.parse(readFileSync(new URL(`../../skills-web-app/bundles/role_access/locales/${locale}.json`, import.meta.url), 'utf8'))]))
  let locale = 'en-US', editable = true
  let data = { schema_version: 5, roles: { a: { id: 'a', title: 'First role', assignment_rule: '注册后自动拥有' },
    b: { id: 'b', title: 'Second role', assignment_rule: 'Do not change' } }, role_order: ['a', 'b'],
    policies: { p: { id: 'p', title: 'Allows Submit', role_ref: 'a', effect: 'allow', capability: 'Submit', applies_when: 'Own request', requirements: ['custom'], custom_requirement: 'Confirm manually' },
      other: { id: 'other', title: 'Other policy', role_ref: 'b', effect: 'deny', capability: 'Remove', requirements: [] } }, policy_order: ['p', 'other'] }
  const initial = structuredClone(data), edits = []
  const paint = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale }, React.createElement('div', { className: 'dsh-design-panel' }, renderNode(manifest.ui, localizePanelManifest(manifest, locale), data,
    { locale, editable, onPanelUpdate: next => {
      edits.push(next)
      for (const [path, value] of Object.entries(next)) data = pathSet(data, path, value)
      paint()
    } }))))
  const show = () => React.act(async () => paint())
  const click = element => React.act(async () => element.click())
  const input = (element, text) => React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, text)
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  const change = (element, text) => chooseSelectValue(React, element, text)
  const field = key => document.querySelector(`[data-field="${key}"]`)
  const outside = () => document.getElementById('outside').focus()
  try {
    outside(); await show()
    assert.equal(edits.length, 0, 'mount cannot write facts')
    assert.equal(document.activeElement.id, 'outside')
    assert.equal(document.querySelectorAll('[data-field="assignment_rule"]').length, 1)
    assert.equal(window.getComputedStyle(field('assignment_rule').querySelector('.dsh-design-field-choices')).flexWrap, 'nowrap')
    assert.equal(window.getComputedStyle(field('assignment_rule').querySelector('.dsh-design-field-choices')).overflowX, 'auto')
    const policyRow = field('effect').closest('.dsh-design-form-row')
    assert.equal(field('capability').closest('.dsh-design-form-row'), policyRow)
    assert.match(policyRow.textContent, /This role/)
    assert.equal(window.getComputedStyle(policyRow).flexWrap, 'wrap')
    assert.equal(await inspectSelectOption(React, field('effect').querySelector('[role="combobox"]'), ''), undefined)
    assert.equal(field('effect').querySelector('[role="combobox"]').getAttribute('aria-label'), 'This role')
    assert.equal(window.getComputedStyle(field('requirements').querySelector('.dsh-design-field-choices')).flexWrap, 'wrap')
    assert.ok(field('applies_when').classList.contains('is-label-inline'))
    assert.ok(field('custom_requirement'))
    await click(field('requirements').querySelector('input[value="custom"]'))
    assert.deepEqual(data.policies.p.requirements, [])
    assert.equal(data.policies.p.custom_requirement, '')
    assert.equal(field('custom_requirement'), null)
    assert.deepEqual(data.policies.other, initial.policies.other)
    assert.deepEqual(data.policy_order, initial.policy_order)
    await change(field('effect').querySelector('[role="combobox"]'), 'deny')
    assert.equal(data.policies.p.effect, 'deny')
    assert.equal(data.policies.p.capability, 'Submit')
    assert.equal(data.policies.p.title, '禁止Submit', 'existing deterministic summary remains canonical')
    await input(field('capability').querySelector('input'), 'Approve')
    assert.equal(data.policies.p.title, '禁止Approve')
    assert.equal(data.policies.p.applies_when, 'Own request')

    const otherRadio = () => [...field('assignment_rule').querySelectorAll('input[type="radio"]')].at(-1)
    await click(otherRadio())
    assert.equal(data.roles.a.assignment_rule, '')
    assert.equal(document.activeElement, field('assignment_rule').querySelector('input:not([type="radio"])'))
    await input(document.activeElement, 'Invited member')
    assert.equal(data.roles.a.assignment_rule, 'Invited member')
    assert.deepEqual(data.roles.b, initial.roles.b)
    assert.deepEqual(data.role_order, initial.role_order)
    outside(); await click(otherRadio())
    assert.equal(document.activeElement, field('assignment_rule').querySelector('input:not([type="radio"])'), 'reclick Other focuses without changing its value')
    const count = edits.length
    outside(); locale = 'zh-CN'; await show()
    assert.equal(document.activeElement.id, 'outside', 'locale change cannot refocus custom input')
    assert.equal(edits.length, count)
    assert.match(document.querySelector('.dsh-design-form-group-title').textContent, /谁会拥有/)
    assert.match(field('effect').closest('.dsh-design-form-row').textContent, /这个角色/)
    await show()
    assert.equal(document.activeElement.id, 'outside', 'same-data refresh cannot refocus')
    await click([...document.querySelectorAll('nav button')].find(button => button.textContent === 'Second role'))
    assert.equal(document.activeElement.id, 'outside', 'switching to a saved custom record cannot steal focus')
    assert.equal(edits.length, count)
    await click([...document.querySelectorAll('nav button')].find(button => button.textContent === 'First role'))
    assert.equal(document.activeElement.id, 'outside', 'switching back cannot replay the old focus event')
    editable = false; await show()
    assert.equal(document.querySelector('select'), null)
    assert.equal(field('assignment_rule').querySelector('input'), null)
    assert.equal(document.querySelector('.dsh-design-record-actions'), null)

    // Same contract, unrelated Kit vocabulary and nested canonical paths.
    manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'machines', title: 'Machines', records_path: 'model.machines', fields_path: 'details', order: 'model.order',
      form: { body: [
        { kind: 'row', items: [{ kind: 'text', text: 'Operating mode' }, { kind: 'field', field: 'mode', label: 'visually_hidden', width: 'auto' }] },
        { kind: 'group', title: 'Conditional group', items: [{ kind: 'row', items: [{ kind: 'text', text: 'Only custom' }, { kind: 'field', field: 'reason' }] }] },
        { kind: 'row', items: [{ kind: 'text', text: 'Display-only explanation' }] },
        { kind: 'group', title: 'How obtained', items: [{ kind: 'field', field: 'source' }] },
      ] } }], fields: [
      { key: 'mode', label: 'Mode', control: 'select', allow_clear: false, options: [{ value: 'on', label: 'On' }, { value: 'custom', label: 'Custom' }], applies_to: ['machines'] },
      { key: 'reason', label: 'Reason', control: 'text', visible_when: { field: 'mode', in: ['custom'] }, clear_when_hidden: true, applies_to: ['machines'] },
      { key: 'note', label: 'Unconsumed note', control: 'text', applies_to: ['machines'] },
      { key: 'source', label: 'Source', control: 'radio_custom', custom_focus: true, choice_layout: 'row_scroll', options: [{ value: 'preset', label: 'Preset' }], applies_to: ['machines'] },
    ], ui: { component: 'record_form', id: 'neutral-body', source: 'machines' } }
    assert.deepEqual(validatePanelManifest(manifest), [])
    data = { model: { machines: { x: { origin: 'Keep', details: { mode: undefined, note: 'Keep note', source: 'Already custom' } },
      y: { details: { mode: 'retired', note: 'Other', source: 'preset' } } }, order: ['x', 'y'] } }
    // New identity means restored custom content must not inherit a pending focus request.
    await React.act(async () => root.render(null))
    editable = true; outside(); await show()
    assert.equal(document.activeElement.id, 'outside', 'restored custom value does not focus on mount')
    const neutralBefore = structuredClone(data), beforeEdits = edits.length
    const record = id => document.querySelector(`[data-record="${id}"]`)
    const select = id => record(id).querySelector('[data-field="mode"] [role="combobox"]')
    assert.equal(select('x').value, '')
    assert.equal((await inspectSelectOption(React, select('x'), '')).disabled, true)
    assert.equal(select('y').value, 'retired')
    assert.equal((await inspectSelectOption(React, select('y'), 'retired')).disabled, true)
    assert.equal(edits.length, beforeEdits)
    assert.deepEqual(data, neutralBefore, 'missing/stale values are never normalized on load')
    assert.equal([...record('x').querySelectorAll('.dsh-design-form-group-title')].some(el => el.textContent === 'Conditional group'), false)
    assert.match(record('x').textContent, /Display-only explanation/)
    assert.equal(record('x').querySelectorAll('[data-field="note"]').length, 1, 'unconsumed visible fields fall back once')
    await change(select('x'), '')
    assert.equal(edits.length, beforeEdits, 'disabled empty option cannot clear a required choice')
    await change(select('x'), 'custom')
    assert.ok(record('x').querySelector('[data-field="reason"]'))
    assert.match(record('x').textContent, /Conditional group/)
    const patch = edits.at(-1)
    assert.equal(patch['model.machines'].x.origin, 'Keep')
    assert.equal(patch['model.machines'].x.details.note, 'Keep note')
    assert.deepEqual(patch['model.machines'].y, neutralBefore.model.machines.y)
    assert.equal(patch['model.order'], undefined)
    assert.equal(data['model.machines'], undefined, 'host applied the canonical dotted path, not a shadow collection')
    await change(select('x'), 'on')
    assert.equal(record('x').querySelector('[data-field="reason"]'), null)
    assert.equal(data.model.machines.x.details.reason, '')
    const afterOn = edits.length
    await change(select('x'), '')
    assert.equal(edits.length, afterOn, 'an absent empty option cannot clear a selected required choice')
    delete manifest.sections[0].form; delete manifest.fields[0].allow_clear
    await show()
    assert.equal(record('x').querySelector('.dsh-design-form-row'), null)
    assert.equal((await inspectSelectOption(React, select('x'), '')).disabled, false, 'default empty-selection path preserved')
    await change(select('x'), '')
    assert.equal(edits.at(-1)['model.machines'].x.details.mode, undefined)

    // A native host can acknowledge the controlled edit on a later render.
    // Pending focus belongs to the user event, not to generic value changes.
    await React.act(async () => root.render(null))
    let delayedValue = 'preset', requested
    const delayed = () => React.act(async () => root.render(React.createElement(CustomChoice, {
      value: delayedValue, label: 'Deferred choice', editable: true, customFocus: true,
      options: [{ value: 'preset', label: 'Preset' }], onChange: value => { requested = value },
    })))
    outside(); await delayed()
    await click([...document.querySelectorAll('#root input[type="radio"]')].at(-1))
    assert.equal(requested, '')
    assert.equal(document.querySelector('#root input:not([type="radio"])'), null, 'controlled value is not yet acknowledged')
    delayedValue = requested; await delayed()
    assert.equal(document.activeElement, document.querySelector('#root input:not([type="radio"])'), 'explicit focus survives delayed controlled acknowledgement')
    outside(); await delayed()
    assert.equal(document.activeElement.id, 'outside', 'acknowledged focus request is consumed only once')
    delayedValue = 'preset'; await delayed()
    await click([...document.querySelectorAll('#root input[type="radio"]')].at(-1))
    await click(document.querySelector('#root input[type="radio"]'))
    outside(); delayedValue = ''; await delayed()
    assert.equal(document.activeElement.id, 'outside', 'a preset click cancels an outstanding custom focus request')
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})


test('record artifact sibling views keep one original editable header above tabs and preserve lifecycle authority', async () => {
 const localDom = new JSDOM('<body></body>', { url: 'https://panel.test/', pretendToBeVisual: true })
 for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = localDom.window[key]
 document.head.appendChild(document.createElement('style')).textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
 const container = document.body.appendChild(document.createElement('div'))
 container.className = 'dsh-design-panel'
 const root = createRoot(container)
 const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'cases', title: 'Cases', form: {
   header: { variant: 'detail', title: { field: 'title', editable: true } }, body: [{ kind: 'field', field: 'note' }, { kind: 'field', field: 'file' }],
 } }], fields: [{ key: 'title', label: 'Case title', control: 'text', required: true }, { key: 'note', label: 'Note', control: 'textarea' }, { key: 'file', label: 'File', control: 'artifact_ref' }],
 ui: { component: 'record_workspace', id: 'case-views', sources: ['cases'], navigation_layout: 'list', children: [{ component: 'tabs', id: 'case-tabs', children: [
 { component: 'record_inspector', id: 'reading', title: 'Read' }, { component: 'record_artifact', id: 'report', title: 'Report', source: 'cases', artifact: { field: 'file' } },
 ] }] } }
 for (const field of manifest.fields) field.applies_to = ['cases']
 assert.deepEqual(validatePanelManifest(manifest), [])
 let data = { cases: { one: { title: 'First case', note: 'Saved note' }, two: { title: 'Second case', note: 'Other note' } } }, writes = 0
 const render = (editable = true) => root.render(renderNode(manifest.ui, manifest, data, { editable, onPanelUpdate: patch => { writes++; data = { ...data, ...patch }; render() }, onEdit: edit => { writes++; data = pathSet(data, edit.section + '.' + edit.record + '.' + edit.field, edit.value); render() } }))
 try {
  await React.act(() => render())
  const header = document.querySelector('.dsh-record-workspace-header'), tabs = document.querySelector('[role=tablist]')
  assert.ok(header.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING)
  assert.equal(document.querySelectorAll('[data-panel-title]').length, 1)
  assert.equal(document.querySelector('.dsh-record-inspector [data-panel-title]'), null)
  assert.equal(header.querySelector('.dsh-design-record'), null, 'workspace title has no padded record shell or negative-inset dependency')
  assert.equal(window.getComputedStyle(header.querySelector('.dsh-design-record-header')).margin, '0px')
  assert.equal(window.getComputedStyle(header.querySelector('.dsh-design-record-header')).height, '44px')
  container.parentElement.classList.add('dsh-design-auto-surface')
  assert.equal(window.getComputedStyle(header.querySelector('.dsh-design-record-header')).padding, '0px 16px', 'auto surface cannot restyle a framed shared title')
  container.parentElement.classList.remove('dsh-design-auto-surface')
  const note = document.querySelector('[data-field=note] textarea')
  await React.act(() => document.querySelectorAll('[role=tab]')[1].click())
  assert.equal(header.querySelector('[data-panel-title]').value, 'First case')
  assert.equal(document.querySelector('[data-field=note] textarea'), note, 'body stays mounted')
  await React.act(() => header.querySelector('.dsh-panel-title-edit').click())
  assert.equal(document.activeElement, header.querySelector('[data-panel-title]'))
  assert.equal(writes, 0, 'view and pencil focus are not edits')
  await React.act(() => header.querySelector('[data-testid=record-remove-one]').click())
  assert.equal(writes, 1); assert.equal(data.cases.one, undefined); assert.equal(document.querySelector('[data-panel-title]').value, 'Second case')
  await React.act(() => render(false))
  assert.equal(document.querySelector('[data-panel-title]'), null); assert.equal(document.querySelector('[data-testid=record-remove-two]'), null)
  assert.match(document.querySelector('.dsh-record-workspace-header').textContent, /Second case/)
  assert.equal(writes, 1)
 } finally { await React.act(() => root.unmount()); container.remove(); localDom.window.close() }
})
