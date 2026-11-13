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
const { renderNode, renderManifest } = await import('../src/interpreter.ts')
const { pathSet } = await import('../src/record-state.ts')
const { parsePanelManifest, validatePanelManifest, localizePanelManifest } = await import('../../core/src/panel-dsl.ts')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
const { CustomChoice } = await import('../src/custom-choice.tsx')

test('native disclosure activation keeps its default action beside a retained React Flow canvas', async () => {
  const { ReactFlow } = await import('@xyflow/react')
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items', form: { body: [
    { kind: 'group', title: 'Context', collapsible: true, items: [{ kind: 'field', field: 'notes' }] },
  ] } }], fields: [{ key: 'notes', label: 'Notes', control: 'record_map', item_fields: [{key:'text',control:'textarea'}], applies_to: ['items'] }],
    ui: { id: 'form', component: 'record_form', source: 'items' } }
  let received = 0
  const globalKey = () => { received++ }
  window.addEventListener('keydown', globalKey)
  const send = async (target, key = ' ', extra = {}) => {
    const event = new window.KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true, ...extra })
    await React.act(async () => target.dispatchEvent(event))
    await React.act(async () => target.dispatchEvent(new window.KeyboardEvent('keyup', { key, code: event.code, bubbles: true, ...extra })))
    return event
  }
  try {
    await React.act(async () => root.render(React.createElement(React.Fragment, null,
      renderManifest(manifest, { items: { a: { notes: {one:{text:'Keep the draft'},two:{text:'Second'}} } } }, { editable: true, onPanelUpdate:()=>{} }),
      React.createElement('div', { style: { visibility: 'hidden', width: 600, height: 400 } },
        React.createElement(ReactFlow, { nodes: [], edges: [] })),
    )))
    const summary = document.querySelector('summary')
    const space = await send(summary)
    assert.equal(space.defaultPrevented, false, 'native summary keeps browser activation; the canvas must not cancel it')
    assert.equal(received, 0, 'the disclosure activation key is owned by the Panel')
    await send(summary, 'Enter')
    assert.equal(received, 1, 'other keys keep their existing propagation')
    await send(summary, ' ', { ctrlKey: true })
    assert.equal(received, 2, 'modified shortcuts are not intercepted')
    const input = document.querySelector('textarea')
    assert.equal((await send(input)).defaultPrevented, false)
    assert.equal(received, 3, 'input editing events are not claimed by the disclosure boundary')
    const pane = document.querySelector('.react-flow__pane')
    assert.equal((await send(pane)).defaultPrevented, true, 'the real canvas retains its own Space handler')
  } finally {
    window.removeEventListener('keydown', globalKey)
    await React.act(async () => root.unmount())
  }
})

test('ordinary scalar captions retain unique accessible controls and reachable help without disclosure', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items' }], fields: [
    { key: 'name', label: 'Name', control: 'text', applies_to: ['items'] },
    { key: 'notes', label: 'Notes', description: 'Explain the decision.', control: 'textarea', applies_to: ['items'] },
    { key: 'mode', label: 'Mode', control: 'select', applies_to: ['items'], options: [{ value: 'one', label: 'One' }] },
  ], ui: { id: 'form', component: 'record_form', source: 'items' } }
  const data = { items: { a: { name: 'Original', notes: 'Keep', mode: 'one' } } }
  const show = editable => React.act(async () => root.render(React.createElement(React.Fragment, null,
    ...[0, 1].map(index => React.createElement('div', { key: index }, renderNode(manifest.ui, manifest, data, { editable }))))))
  try {
    await show(true)
    const labels = [...document.querySelectorAll('.dsh-design-field-label > label')]
    assert.equal(labels.length, 6)
    assert.equal(new Set(labels.map(label => label.htmlFor)).size, labels.length)
    assert.equal(document.querySelector('label button'), null, 'help is not another labelable control nested in a field label')
    const noteFields = [...document.querySelectorAll('[data-field="notes"]')]
    assert.equal(noteFields.length, 2)
    for (const field of noteFields) {
      assert.equal(field.closest('details'), null, 'ordinary fields do not become disclosures')
      assert.equal(field.querySelectorAll('.dsh-panel-help button').length, 1, 'the visible caption owns reachable help once')
    }
    for (const label of labels) {
      assert.ok(label.control, 'the visible caption has a native labelable control')
      assert.equal(label.control.closest('[data-field]'), label.closest('[data-field]'))
    }
    const ids = labels.map(label => label.htmlFor)
    await show(true)
    assert.deepEqual([...document.querySelectorAll('.dsh-design-field-label > label')].map(label => label.htmlFor), ids)
    await show(false)
    assert.equal(document.querySelector('.dsh-design-field-label > label'), null, 'read-only text has no misleading focus label')
    assert.deepEqual(data.items.a, { name: 'Original', notes: 'Keep', mode: 'one' })
  } finally { await React.act(async () => root.unmount()) }
})

test('semantic groups disclose independently of property count or populated fields', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items', form: { body: [
    { kind: 'group', title: 'Context', collapsible: true, items: [
      { kind: 'field', field: 'notes' }, { kind: 'field', field: 'empty' }, { kind: 'field', field: 'hidden' },
    ] },
    { kind: 'group', title: 'Unfilled', collapsible: true, items: [{ kind: 'field', field: 'empty' }] },
  ] } }], fields: [
    { key: 'notes', label: 'Notes', control: 'textarea' }, { key: 'empty', label: 'Empty', control: 'textarea' },
    { key: 'hidden', label: 'Hidden', control: 'text', hidden: true },
  ].map(field => ({ ...field, applies_to: ['items'] })), ui: { id: 'form', component: 'record_form', source: 'items' } }
  const data = { items: { a: { notes: 'Existing context', hidden: 'Technical value' } } }, before = structuredClone(data)
  try {
    for (const locale of ['en-US', 'zh-CN']) {
      await React.act(async () => root.render(renderNode(manifest.ui, manifest, data, { locale, editable: true })))
      const groups = [...document.querySelectorAll('.dsh-design-form-group')]
      assert.equal(groups.length, 2)
      assert.equal(groups[0].open, true)
      assert.equal(groups[0].querySelector('summary').getAttribute('role'), null)
      // Filled-field counts were replaced by actual collection counts in
      // af2cc77a. A semantic scalar group is not a completeness indicator.
      assert.equal(groups[0].querySelector('.dsh-design-form-group-preview,.dsh-panel-collection-count'), null)
      assert.equal(groups[1].querySelector('.dsh-design-form-group-preview'), null)
      await React.act(async () => groups[0].querySelector('summary').click())
      assert.equal(groups[0].open, false)
      assert.equal(groups[1].open, true, 'collapsing one group leaves its peer open')
      assert.equal(groups[0].querySelector('textarea').value, 'Existing context')
      assert.deepEqual(data, before)
      await React.act(async () => groups[0].querySelector('summary').click())
      assert.equal(groups[0].open, true)
      await React.act(async () => groups[1].querySelector('summary').click())
      assert.equal(groups[1].open, false, 'an unfilled group uses the same disclosure')
      assert.equal(groups[0].open, true)
      await React.act(async () => groups[1].querySelector('summary').click())
    }
  } finally { await React.act(async () => root.unmount()) }
})

test('initially open sections keep complete field bodies and native disclosure state across rerenders', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items', form: { body: [
    { kind: 'group', title: 'Main content', collapsible: true, default_open: true, items: [
      { kind: 'field', field: 'notes' }, { kind: 'field', field: 'rules' },
      { kind: 'field', field: 'children' }, { kind: 'field', field: 'after' },
    ] },
  ] } }], fields: [
    { key: 'notes', label: 'Notes', description: 'Why this content matters', control: 'textarea' },
    { key: 'rules', label: 'Rules', control: 'record_map', columns: [
      { key: 'when', label: 'When', control: 'text' }, { key: 'then', label: 'Then', control: 'text' },
    ] },
    { key: 'children', label: 'Child records', control: 'record_map', item_collapsible: true,
      item_fields: [{ key: 'name', label: 'Name', control: 'text' }] },
    { key: 'after', label: 'Further context', control: 'textarea' },
  ].map(field => ({ ...field, applies_to: ['items'] })), ui: { id: 'form', component: 'record_form', source: 'items' } }
  const data = { items: { a: { notes: 'Retain this draft', rules: { a: { when: 'Requested', then: 'Show draft' } },
    children: { one: { name: 'An independently edited record' },two:{name:'Another record'} }, after: 'Retain this too' } } }
  const before = structuredClone(data), writes = []
  const show = (locale, editable) => React.act(async () => root.render(renderNode(manifest.ui, manifest, data,
    { locale, editable, onPanelUpdate: patch => writes.push(patch) })))
  try {
    await show('en-US', true)
    const group = document.querySelector('details.dsh-design-form-group'), summary = group.querySelector(':scope > summary')
    assert.equal(group.open, true, 'primary content is initially visible')
    const notes = group.querySelector('[data-field="notes"]')
    const body = notes.closest('.dsh-panel-content-card')
    assert.ok(body)
    assert.ok(body.contains(notes.querySelector('.dsh-design-field-label')))
    assert.ok(body.contains(notes.querySelector('.dsh-panel-help')))
    assert.ok(body.contains(group.querySelector('[data-field="rules"] .dsh-record-map-table')), 'ordinary scalar and tabular fields share the complete content surface')
    const child = group.querySelector('[data-child-record="one"]')
    assert.ok(child.classList.contains('dsh-panel-content-card'))
    assert.equal(child.parentElement.closest('.dsh-panel-content-card'), null, 'existing record cards do not get a redundant outer card')
    assert.notEqual(group.querySelector('[data-field="after"]').closest('.dsh-panel-content-card'), body)
    await React.act(async () => summary.click())
    assert.equal(group.open, false)
    for (const [locale, editable] of [['zh-CN', true], ['en-US', false], ['en-US', true]]) {
      await show(locale, editable)
      assert.equal(document.querySelector('details'), group, 'locale/read-only updates retain the same native disclosure')
      assert.equal(group.open, false, 'initial visibility does not override the user on rerender')
    }
    await React.act(async () => summary.click())
    assert.equal(group.open, true)
    assert.equal(group.querySelector('[data-field="notes"] textarea').value, 'Retain this draft')
    assert.deepEqual(writes, [])
    assert.deepEqual(data, before)
  } finally { await React.act(async () => root.unmount()) }
})

test('ordinary declared and fallback fields stay plain while explicit groups and child cards retain edits', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items', form: { body: [
    { kind: 'field', field: 'condition' },
    { kind: 'group', title: 'Outcome', items: [{ kind: 'field', field: 'outcome' }] },
  ] } }], fields: [
    { key: 'condition', label: 'Condition', required: true, control: 'textarea' },
    { key: 'outcome', label: 'Outcome', control: 'textarea' },
    { key: 'notes', label: 'Notes', control: 'textarea' },
    { key: 'children', label: 'Examples', control: 'record_map', item_collapsible: true, item_fields: [
      { key: 'name', label: 'Name', control: 'text' }, { key: 'detail', label: 'Detail', control: 'textarea' },
    ] },
  ].map(field => ({ ...field, applies_to: ['items'] })), ui: { id: 'form', component: 'record_form', source: 'items' } }
  let data = { items: { a: { condition: 'Keep original', outcome: 'Preserve history', notes: 'User wording', children: { one: { name: 'Example', detail: 'Inner record' } } } } }
  const updates = []
  const show = editable => React.act(async () => root.render(renderNode(manifest.ui, manifest, data,
    { editable, onPanelUpdate: patch => { updates.push(patch); data = { ...data, ...patch } } })))
  try {
    await show(true)
    for (const key of ['condition', 'notes']) {
      const field = document.querySelector(`[data-field="${key}"]`)
      assert.equal(field.closest('.dsh-panel-content-group'), null, `${key} does not acquire a synthetic group`)
      assert.equal(field.classList.contains('is-label-visually_hidden'), false, 'ordinary labels remain visible')
    }
    const group = document.querySelector('[data-field="outcome"]').closest('details')
    assert.ok(Boolean(group), 'the explicit Outcome scope remains a semantic disclosure')
    assert.equal(group.querySelectorAll('.dsh-panel-content-group').length, 0, 'an existing group is not wrapped again')
    const child = document.querySelector('[data-child-record="one"]')
    assert.equal(child.querySelector('.dsh-panel-content-group'), null, 'white record entries retain ordinary inner fields')
    const input = document.querySelector('[data-field="condition"] textarea')
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Changed by user\nKeep this line')
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    assert.equal(updates.length, 1)
    assert.equal(data.items.a.condition, 'Changed by user\nKeep this line')
    assert.equal(data.items.a.notes, 'User wording')
    await show(true)
    await React.act(async () => group.querySelector(':scope > summary').click())
    assert.equal(group.open, false)
    assert.equal(document.querySelector('[data-field="condition"] textarea'), input, 'folding a peer group retains ordinary editors')
    await show(false)
    assert.equal(document.querySelector('[data-field="condition"]').closest('details'), null)
    assert.equal(group.open, false, 'changing reading mode does not reopen the user’s group')
    assert.match(document.querySelector('[data-field="condition"]').textContent, /Changed by user/)
    assert.equal(updates.length, 1, 'presentation and disclosure do not write data')
  } finally { await React.act(async () => root.unmount()) }
})

test('visible task groups own complete bodies while inner layout groups reuse the same surface', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items', form: { body: [
    { kind: 'group', title: 'Delivery', items: [
      { kind: 'field', field: 'trigger' },
      { kind: 'group', title: 'Audience', items: [{ kind: 'field', field: 'recipients' }] },
    ] },
    { kind: 'group', title: 'Entries', items: [{ kind: 'field', field: 'entries', label: 'visually_hidden' }] },
  ] } }], fields: [
    { key: 'trigger', label: 'Trigger', control: 'textarea' },
    { key: 'recipients', label: 'Recipients', control: 'text' },
    { key: 'entries', label: 'Entries', control: 'record_map', item_collapsible: true,
      item_fields: [{ key: 'name', label: 'Name', control: 'text' }] },
  ].map(field => ({ ...field, applies_to: ['items'] })), ui: { id: 'form', component: 'record_form', source: 'items' } }
  const data = { items: { a: { trigger: 'After approval', recipients: 'Applicant', entries: { one: { name: 'Inbox' } } } } }
  const before = structuredClone(data), writes = []
  try {
    for (const editable of [true, false]) {
      await React.act(async () => root.render(renderNode(manifest.ui, manifest, data, { editable, onPanelUpdate: patch => writes.push(patch) })))
      const groups = [...document.querySelectorAll('.dsh-design-form-group.dsh-panel-content-group')]
      assert.equal(groups.length, 2, 'only the two major task sections own supporting surfaces')
      const body = groups[0].querySelector('.dsh-panel-content-card')
      assert.equal(groups[0].querySelectorAll('.dsh-panel-content-card').length, 1)
      assert.ok(body.contains(groups[0].querySelector('[data-field="recipients"]')), 'the nested layout shares its complete body')
      const entry = groups[1].querySelector('[data-child-record="one"]')
      assert.equal(entry.parentElement.closest('.dsh-panel-content-card'), null, 'independent records do not acquire another outer card')
      assert.equal(groups[1].querySelectorAll('.dsh-design-form-group-title').length, 1)
      assert.equal(groups[0].querySelector('details'), null, 'grouping does not introduce a new disclosure step')
    }
    assert.deepEqual(writes, [])
    assert.deepEqual(data, before)
  } finally { await React.act(async () => root.unmount()) }
})

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
    { kind: 'group', title: '$t:collaboration', collapsible: true, items: [{ kind: 'field', field: 'collaboration' }] },
    { kind: 'group', title: '$t:scope', collapsible: true, items: [{ kind: 'field', field: 'otherScope' }] },
  ] } }], fields: [
    { key: 'notes', label: '$t:notes', description: '$t:help', control: 'textarea', required: true },
    { key: 'requirement', label: '$t:required', control: 'textarea', required: true },
    { key: 'context', label: '$t:context', control: 'textarea' },
    { key: 'first', label: '$t:multiple', control: 'text' },
    { key: 'second', label: 'Second', control: 'text' },
    { key: 'example', label: '$t:example', control: 'textarea' },
    { key: 'conditional', label: 'Conditional', control: 'text', visible_when: { field: 'first', in: ['show'] } },
    { key: 'collaboration', label: '$t:collaboration', control: 'textarea', required: true, description: '$t:help' },
    { key: 'otherScope', label: '$t:context', control: 'textarea' },
  ].map(field => ({ ...field, applies_to: ['entries'] })),
  i18n: { default_locale: 'en-US', locales: { 'en-US': 'locales/en-US.json', 'zh-CN': 'locales/zh-CN.json' }, messages: {
    'en-US': { notes: 'Notes', help: 'Preserve this explanation', required: 'Assignment', scope: 'Deployment boundary', context: 'Description', multiple: 'Inputs', example: 'Example', collaboration: 'Collaboration' },
    'zh-CN': { notes: '备注', help: '保留专业说明', required: '获得方式', scope: '部署边界', context: '说明', multiple: '输入', example: '样例', collaboration: '协作' },
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
        [copy.notes + ' *', copy.required + ' *', copy.scope, copy.multiple, copy.example, copy.collaboration + ' *', copy.scope], 'an exact duplicate never removes a disclosure summary')
      const collaboration = document.querySelector('[data-field="collaboration"]')
      assert.ok(collaboration.classList.contains('is-label-visually_hidden'), 'the summary is the single visible caption')
      assert.equal(collaboration.querySelector('textarea').getAttribute('aria-label'), copy.collaboration)
      assert.equal(collaboration.querySelector('textarea').getAttribute('aria-required'), 'true')
      assert.ok(collaboration.closest('details').querySelector('summary .dsh-panel-help'))
      assert.equal(collaboration.querySelector(':scope > .dsh-design-required-mark'), null, 'the summary owns the one visible requirement cue')
      assert.equal(document.querySelector('[data-field="otherScope"]').classList.contains('is-label-visually_hidden'), false, 'different scope names retain their field caption')
      const field = document.querySelector('[data-field="notes"]')
      assert.equal(field.querySelector('.dsh-design-field-label').textContent, copy.notes + ' *')
      assert.equal(field.querySelector('textarea').getAttribute('aria-label'), copy.notes)
      assert.equal(field.querySelector('textarea').getAttribute('aria-required'), 'true')
      assert.equal(document.querySelector('[data-field="requirement"] textarea').getAttribute('aria-required'), 'true')
      assert.equal(document.querySelector('[data-field="requirement"] > .dsh-design-required-mark'), null)
      assert.equal(document.querySelectorAll('.dsh-design-form-group-description').length, 0, 'group help lives beside its heading')
      assert.equal(document.querySelectorAll('.dsh-record-preview').length, 1, 'preview context is not treated as a single input')
      assert.equal(document.querySelector('[data-field="conditional"]'), null)
      assert.ok(field.closest('details').querySelector('summary .dsh-panel-help'))
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

test('card collections own one group and caption help without changing edits or native disclosure', async () => {
  const root = createRoot(document.getElementById('root'))
  const fields = ['entries', 'partners', 'fallback'].map(key => ({ key, label: key, control: 'record_map', applies_to: ['items'],
    description: `${key} instructions`, item_collapsible: true, item_label_field: 'name', max_rows: 2,
    item_fields: [{ key: 'name', label: 'Name', control: 'text' }] }))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items', form: { body: [
    { kind: 'field', field: 'entries' },
    { kind: 'group', title: 'partners', collapsible: true, items: [{ kind: 'field', field: 'partners' }] },
  ] } }], fields, ui: { component: 'record_form', id: 'collections', source: 'items' } }
  assert.deepEqual(validatePanelManifest(manifest), [])
  let data = { items: { a: { entries: { one: { name: 'Preserved' } }, partners: { one: { name: 'Partner' } }, fallback: {} } } }
  const updates = []
  const show = editable => React.act(async () => root.render(renderManifest(manifest, data,
    { locale: 'en-US', editable, onPanelUpdate: patch => { updates.push(patch); data = { ...data, ...patch } } })))
  try {
    await show(true)
    for (const key of ['entries', 'fallback']) {
      const field = document.querySelector(`[data-field="${key}"]`)
      assert.ok(field.classList.contains('dsh-panel-content-group'), 'declared and fallback collections share the same complete surface, including empty collections')
      assert.ok(field.querySelector(':scope > summary .dsh-panel-help'))
      assert.equal(field.querySelector('.dsh-design-field-description'), null, 'collection help does not create a trailing paragraph')
    }
    const partners = document.querySelector('[data-field="partners"]')
    assert.equal(partners.classList.contains('dsh-panel-content-group'), false, 'the authored chapter already owns this collection')
    assert.equal(partners.querySelector('.dsh-panel-help'), null, 'a hidden caption cannot contain an unreachable help button')
    const summary = partners.closest('details').querySelector('summary')
    const help = summary.querySelector('button')
    await React.act(async () => help.focus())
    assert.equal(document.querySelector('[role="tooltip"]').textContent, 'partners instructions')
    await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(document.querySelector('[role="tooltip"]'), null)
    assert.equal(document.activeElement, help)
    assert.equal(updates.length, 0)
    await React.act(async () => document.querySelector('[data-field="entries"] .dsh-record-map-add').click())
    await show(true)
    assert.equal(Object.keys(data.items.a.entries).length, 2)
    assert.equal(data.items.a.entries.one.name, 'Preserved')
    assert.equal(document.querySelector('[data-field="entries"] .dsh-record-map-add').disabled, true)
    await show(false)
    assert.ok(document.querySelector('[data-field="entries"].dsh-panel-content-group'))
    assert.equal(document.querySelector('.dsh-record-map-add'), null)
    assert.equal(updates.length, 1, 'readonly, help and group presentation never write data')
  } finally { await React.act(async () => root.unmount()) }
})

test('ordinary field captions and inline rows each own one reachable help', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items', form: { body: [
    { kind: 'field', field: 'stacked' }, { kind: 'field', field: 'inline', label: 'inline' },
    { kind: 'row', items: [{ kind: 'field', field: 'row_inline', label: 'inline' }] },
  ] } }], fields: [
    { key: 'stacked', label: 'Stacked', description: 'Stacked help', control: 'text', applies_to: ['items'] },
    { key: 'inline', label: 'Inline', description: 'Inline help', control: 'text', applies_to: ['items'] },
    { key: 'row_inline', label: 'Row inline', description: 'Row help', control: 'text', applies_to: ['items'] },
  ], ui: { id: 'neutral-rhythm', component: 'record_form', source: 'items' } }
  assert.deepEqual(validatePanelManifest(manifest), [])
  try {
    await React.act(async () => root.render(React.createElement('div', { className: 'dsh-design-panel' },
      renderNode(manifest.ui, manifest, { items: { a: { stacked: 'First', inline: 'Second', row_inline: 'Third' } } }, { editable: true }))))
    const stacked = document.querySelector('[data-field="stacked"]')
    const inline = document.querySelector('[data-field="inline"]')
    const rowInline = document.querySelector('[data-field="row_inline"]')
    for (const field of [stacked, inline, rowInline]) {
      assert.equal(field.querySelector('.dsh-design-field-description'), null)
      const owner = field
      assert.equal(owner.querySelectorAll('.dsh-panel-help button').length, 1)
      assert.equal(field.closest('.dsh-panel-content-group'), null, 'help does not require a synthetic group')
      const help = owner.querySelector('.dsh-panel-help button')
      await React.act(async () => help.focus())
      assert.equal(document.querySelector('[role="tooltip"]').textContent, field === stacked ? 'Stacked help' : field === inline ? 'Inline help' : 'Row help')
      await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', {key:'Escape',bubbles:true})))
      assert.equal(document.querySelector('[role="tooltip"]'), null)
      assert.equal(document.activeElement, help)
    }
    assert.ok(rowInline.classList.contains('is-label-inline'), 'inner row composition retains its declared inline label')

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
    const childTitle = child.querySelector('input[data-panel-title="editable"]')
    assert.equal(childTitle.getAttribute('aria-required'), 'true')
    assert.equal(childTitle.getAttribute('aria-label'), 'Name 1')
    assert.equal(child.querySelector('[data-field="name"] input'), null, 'the editable record header is the single name editor')
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
    assert.equal(style('[data-field="name"] .dsh-design-field-label').fontWeight, '400')
    assert.equal(style('[data-field="children"] > summary').fontWeight, '500', 'collection captions establish a group, ordinary field labels do not')
    assert.equal(style('.dsh-record-map label > span:first-child').fontSize, 'var(--ygd-panel-text-size, 14px)', 'nested field labels share the ordinary field typography role')
    assert.notEqual(style('.dsh-record-map label > span:first-child').display, 'none', 'ordinary single-column records keep their visible column meaning')
    assert.equal(document.querySelector('.dsh-record-map.is-compact'), null, 'multi-column defaults do not change the single-column contract')
    const textarea = style('[data-field="notes"] textarea'), select = style('[data-field="mode"] [role="combobox"]')
    const exceptions = { textareaHeight: textarea.minHeight, textareaResize: textarea.resize, selectPadding: select.padding }
    // JSDOM has no layout boxes: content fitting is verified by panel-textarea-browser.
    // The CSS foundation must not impose the superseded multi-line minimum.
    assert.equal(exceptions.textareaHeight, '0px'); assert.equal(exceptions.textareaResize, 'vertical')
    assert.equal(document.querySelector('[data-field="notes"] textarea').rows, 1)
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
    assert.notEqual(style('[data-field="name"] .dsh-design-field-label').position, 'absolute', 'ordinary field labels remain visible')
    assert.equal(document.querySelector('[data-field="name"]').closest('.dsh-panel-content-group'), null)
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
      const groups=[...document.querySelectorAll('.dsh-panel-content-group')]
      assert.equal(groups.length,3,'condition, result and remarks share peer group surfaces')
      for(const key of ['condition','outcome','notes']) {
        const field=document.querySelector(`[data-field="${key}"]`)
        const group=field.closest('.dsh-panel-content-group')
        assert.ok(groups.includes(group))
        assert.ok(field.closest('.dsh-panel-content-card'),'each peer has a complete base body')
        assert.equal(group.querySelector('.dsh-panel-content-group'),null,'ordinary fields do not acquire nested gray groups')
      }
      assert.equal(document.querySelector('.dsh-panel-header-context'),null,'generic writing instructions do not occupy the record context')
      const help=document.querySelector('[data-field="notes"]').closest('.dsh-panel-content-group').querySelector(':scope > summary .dsh-panel-help button')
      await React.act(async()=>help.click())
      assert.equal(document.querySelector('[role="tooltip"]').textContent,manifest.i18n.messages[locale].notesHelp)
      await React.act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
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
    const prototype = element instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text)
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
    assert.deepEqual(manifest.sections.find(section => section.id === 'policies').derived_fields.title.parts, [{field:'capability'}])
    assert.equal(data.policies.p.title, initial.policies.p.title, 'effect is not a declared title dependency and must not rewrite a saved title')
    await input(field('capability').querySelector('textarea'), 'Approve')
    assert.equal(data.policies.p.title, 'Approve', 'editing the declared dependency derives the canonical title without adding localized effect text')
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
    assert.equal(document.querySelector('.dsh-design-form-group-title').textContent, `${manifest.i18n.messages[locale].assignment} *`)
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
  // The title has a minimum height and grows with optional context. Real
  // Chromium checks its resulting box in host-theme-browser.test.mjs.
  assert.equal(window.getComputedStyle(header.querySelector('.dsh-design-record-header')).minHeight, '44px')
  const normalizedPadding = () => window.getComputedStyle(header.querySelector('.dsh-design-record-header')).padding.replace(/\b0px\b/g, '0')
  const originalPadding = normalizedPadding()
  // JSDOM does not resolve custom properties in padding shorthands. Check the
  // owning gutter declaration and preserve computed parity across the wrapper;
  // actual Chromium verifies its resolved geometry.
  assert.match(document.head.querySelector('style').textContent, /\.dsh-design-panel \.dsh-design-record-header \{[^}]*padding: 0 var\(--ygd-panel-content-gutter, 16px\)/)
  container.parentElement.classList.add('dsh-design-auto-surface')
  assert.equal(normalizedPadding(), originalPadding, 'auto surface cannot restyle a framed shared title')
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

test('collection collapse preserves edits, nested expansion and editor identity across one/many boundaries', async () => {
  const container=document.createElement('div');container.id='root';document.body.append(container)
  const root = createRoot(document.getElementById('root'))
  const manifest = {version:1,panel_kind:'document',sections:[{id:'items',title:'Items'}],fields:[
    {key:'entries',label:'Entries',required:true,control:'record_map',applies_to:['items'],item_collapsible:true,item_label_field:'name',
      item_fields:[{key:'name',label:'Name',control:'text'}]},
  ],ui:{component:'record_form',id:'collection',source:'items'}}
  let data={items:{a:{entries:{one:{name:'First'},two:{name:'Second'}}}}}, writes=0
  const paint=()=>root.render(renderManifest(manifest,data,{editable:true,onPanelUpdate:updates=>{
    writes++; data={...data,...updates};paint()
  }}))
  const click=element=>React.act(async()=>{element.click();await new Promise(resolve=>setTimeout(resolve,0))})
  try {
    await React.act(paint)
    const group=document.querySelector('details[data-field="entries"]'),summary=group.querySelector(':scope > summary')
    const input=group.querySelector('[data-child-record="one"] input')
    assert.equal(group.open,true)
    assert.match(group.getAttribute('aria-label'), /Entries.*(?:required|必填)/)
    await React.act(async()=>{
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'User draft')
      input.dispatchEvent(new window.Event('input',{bubbles:true}))
    })
    assert.equal(writes,1)
    await click(summary);assert.equal(group.open,false)
    await React.act(paint);assert.equal(group.open,false)
    assert.equal(group.querySelector('[data-child-record="one"] input'),input)
    await click(summary);assert.equal(group.open,true)
    assert.equal(input.value,'User draft')
    delete data.items.a.entries.two
    await React.act(paint)
    assert.equal(document.querySelector('details[data-field="entries"]'),group)
    assert.equal(summary.getAttribute('role'),null)
    assert.ok(summary.querySelector('.dsh-panel-disclosure-icon'))
    await click(summary);assert.equal(group.open,false,'a single record has the same disclosure')
    assert.equal(group.querySelector('[data-child-record="one"] input'),input)
    data.items.a.entries.two={name:'Returned'}
    await React.act(paint)
    assert.equal(summary.getAttribute('role'),null)
    assert.equal(group.querySelector('[data-child-record="one"] input'),input)
    assert.equal(group.open,false,'adding a record does not reset the chosen disclosure state')
    await click(summary);assert.equal(group.open,true)
    assert.equal(writes,1,'presentation and count transitions do not emit canonical edits')
  } finally {await React.act(async()=>root.unmount())}
})

test('ordinary reading fields retain complete bodies while editable controls and table cells retain native boundaries', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items' }], fields: [
    { key: 'notes', label: 'Notes', control: 'textarea', applies_to: ['items'] },
    { key: 'kind', label: 'Kind', control: 'select', options: [{ value: 'saved', label: 'Saved kind' }], readonly: true, applies_to: ['items'] },
    { key: 'entries', label: 'Entries', control: 'list', applies_to: ['items'] },
    { key: 'participants', label: 'Participants', control: 'token_list', applies_to: ['items'] },
    { key: 'history', label: 'History', control: 'rows', columns: [{ key: 'event', label: 'Event', control: 'text' }], applies_to: ['items'] },
  ] }
  const data = { items: { one: { notes: 'First line\nSecond line', kind: 'saved', entries: ['Keep\nnewlines', 'Duplicate', 'Duplicate'], participants: ['Designer', 'Client'], history: [{ event: 'Saved' }] } } }
  const before = structuredClone(data), edits = []
  const node = { id: 'form', component: 'record_form', source: 'items' }
  const show = (next = node, editable = false) => React.act(async () => root.render(renderNode(next, manifest, data, { editable, onEdit: edit => edits.push(edit) })))
  try {
    await show()
    for (const key of ['notes', 'kind', 'entries', 'participants']) {
      const field = document.querySelector(`[data-field="${key}"]`)
      const surface = field.querySelector('.dsh-panel-field-reading')
      assert.ok(Boolean(surface), key)
      assert.equal(field.closest('details'), null, 'ordinary readings do not need disclosure')
      assert.equal(surface.querySelector('input,textarea,button,[tabindex]'), null, 'reading content does not pretend to be an input')
    }
    assert.equal(document.querySelector('[data-field=notes] .dsh-design-field-value').textContent, data.items.one.notes)
    assert.deepEqual([...document.querySelectorAll('[data-field=entries] li')].map(element => element.textContent), data.items.one.entries)
    assert.match(document.querySelector('[data-field=kind]').textContent, /Saved kind/)
    assert.equal(document.querySelector('[data-field=history] .dsh-panel-field-reading'), null, 'a table owns its existing boundary')
    await show(node, true)
    assert.ok(Boolean(document.querySelector('[data-field=notes] textarea')))
    assert.equal(document.querySelector('[data-field=notes] .dsh-panel-field-reading'), null)
    assert.equal(document.querySelector('[data-field=kind] input, [data-field=kind] button'), null, 'declared readonly fields remain readings in an editable form')
    assert.equal(document.querySelector('[data-field=kind] .dsh-design-field-value').textContent, 'Saved kind')
    await show({ ...node, record_table: { columns: [{ fields: ['notes'] }, { fields: ['kind'] }] } })
    assert.ok(document.querySelectorAll('tbody td').length > 0)
    assert.equal(document.querySelector('tbody .dsh-panel-field-reading'), null, 'table headers and cell borders already express the relationship')
    await show({ id: 'schema-note', component: 'schema_field', control: 'textarea', path: 'items.one.notes', title: 'Notes' })
    assert.equal(document.querySelector('.dsh-panel-field-reading').textContent, data.items.one.notes)
    assert.equal(edits.length, 0)
    assert.deepEqual(data, before)
  } finally { await React.act(async () => root.unmount()) }
})

test('record header metadata shares the title row while longer context keeps its separate place', async () => {
  const { PanelRecordHeader } = await import('../src/panel-workspace.tsx')
  const root = createRoot(document.getElementById('root'))
  try {
    await React.act(async () => root.render(React.createElement('div', { className: 'dsh-design-panel' }, React.createElement(PanelRecordHeader, { titleRole: 'record', meta: 'Responsible: Designer', context: 'Longer record context' }, 'Review feedback'))))
    const header = document.querySelector('[data-panel-title-role=record]')
    assert.equal(header.querySelector('.dsh-panel-header-main').textContent, 'Review feedback')
    assert.equal(header.querySelector('.dsh-panel-header-meta').textContent, 'Responsible: Designer')
    assert.equal(header.querySelector('.dsh-panel-header-context').textContent, 'Longer record context')
    assert.equal(header.querySelector('button,input'), null)
    const metadataStyle = window.getComputedStyle(header.querySelector('.dsh-panel-header-meta'))
    assert.equal(metadataStyle.flexShrink, '1', 'brief metadata can shrink and wrap beside a long title')
    assert.equal(metadataStyle.maxWidth, '100%')
  } finally { await React.act(async () => root.unmount()) }
})
