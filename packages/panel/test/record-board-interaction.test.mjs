import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.HTMLElement.prototype.scrollIntoView = function() {}
dom.window.HTMLElement.prototype.hasPointerCapture = () => false
dom.window.HTMLElement.prototype.releasePointerCapture = function() {}
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { RecordBoard } = await import('../src/record-board.tsx')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
const { applyDesignEditToDraft, renderManifest } = await import('../src/interpreter.ts')
const choose = async (trigger, label) => {
  await React.act(() => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await React.act(() => new Promise(resolve => setTimeout(resolve, 0)))
  const option = [...document.querySelectorAll('[role="option"]')].find(element => element.textContent === label)
  assert.ok(option, `choice ${label} is available`)
  await React.act(() => option.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await React.act(() => new Promise(resolve => setTimeout(resolve, 0)))
}

test('acceptance cards edit the Panel draft directly and preserve labeled reading, focus, order and lifecycle', async () => {
  const { readFile } = await import('node:fs/promises')
  const { parsePanelManifest } = await import('../src/dsl.ts')
  const { pathSet } = await import('../src/record-state.ts')
  const bundle = new URL('../../skills-web-app/bundles/quality_acceptance/', import.meta.url)
  const panel = parsePanelManifest(await readFile(new URL('panel.yaml', bundle), 'utf8'))
  panel.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale =>
    [locale, JSON.parse(await readFile(new URL(`locales/${locale}.json`, bundle), 'utf8'))])))
  let data = { schema_version: 4, requirement_order: ['b', 'a'], requirements: {
    a: { id: 'a', title: 'Submit feedback', group: 'Intake', condition: 'After entering feedback', pass_criteria: 'A saved receipt appears', verification: 'Submit and reload', source_refs: ['keep-source'] },
    b: { id: 'b', title: 'Empty requirement', group: 'Intake', condition: '', pass_criteria: '' },
  } }
  const original = structuredClone(data), writes = []
  const root = createRoot(document.getElementById('root'))
  let editable = false, locale = 'en-US', confirm = false
  const oldConfirm = window.confirm
  window.confirm = () => confirm
  const show = () => root.render(renderManifest(panel, data, { locale, editable,
    onEdit(edit) { writes.push(edit); data = applyDesignEditToDraft(data, panel, edit); show() },
    onTransaction(edits) { writes.push(edits); for (const edit of edits) data = applyDesignEditToDraft(data, panel, edit); show() },
    onPanelUpdate(updates) { writes.push(updates); for (const [path, value] of Object.entries(updates)) data = pathSet(data, path, value); show() },
  }))
  const card = id => document.querySelector(`[data-board-record="${id}"]`)
  const click = el => React.act(async () => el.click())
  const input = (el, value) => React.act(async () => {
    const prototype = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value)
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  try {
    await React.act(show)
    assert.deepEqual([...document.querySelectorAll('[data-board-record]')].map(el => el.dataset.boardRecord), ['b', 'a'])
    assert.equal(card('b').querySelectorAll('.dsh-record-facts h5').length, 2, 'blank required fields retain labels in reading mode')
    assert.equal(card('a').querySelectorAll('.dsh-record-facts h5').length, 3, 'nonempty verification is readable')
    assert.match(card('a').textContent, /After entering feedback/)
    assert.match(card('a').textContent, /A saved receipt appears/)
    assert.equal(document.querySelector('.dsh-record-board-map-toggle'), null)
    assert.equal(card('a').querySelector('details'), null, 'no empty fold or duplicate editor')
    assert.deepEqual(writes, [])
    editable = true
    await React.act(show)
    assert.equal(card('a').querySelectorAll('textarea').length, 3, 'all declared body fields are editable without an Edit action')
    assert.ok(card('b').querySelector('[data-field="condition"] textarea'), 'an empty required field keeps its editor')
    assert.equal(card('a').querySelector('.dsh-record-board-actions'), null, 'cards have no local Edit, Cancel or Finish boundary')
    for (const kind of ['up', 'down', 'remove']) assert.ok(card('a').querySelector(`:scope > header > .dsh-design-record-actions [data-testid="record-${kind}-a"]`))
    await input(card('a').querySelector('[data-field="condition"] textarea'), 'Changed condition')
    await input(card('a').querySelector('header input'), 'Updated title')
    await input(card('a').querySelector('[data-field="pass_criteria"] textarea'), 'Changed passing result')
    assert.equal(data.requirements.a.title, 'Updated title', 'title and body update the same Panel draft immediately')
    assert.equal(data.requirements.a.condition, 'Changed condition')
    assert.equal(data.requirements.a.pass_criteria, 'Changed passing result')
    assert.deepEqual(data.requirements.a.source_refs, ['keep-source'])
    assert.equal(data.requirements.a.verification, 'Submit and reload')
    assert.equal(original.requirements.a.title, 'Submit feedback', 'editing never mutates the saved input')
    const groupInput = card('a').querySelector('[data-field="group"] input'), focusedCard = card('a')
    await React.act(async () => groupInput.focus())
    await input(groupInput, 'Review')
    assert.equal(data.requirements.a.group, 'Review', 'group edits enter the Panel draft immediately')
    assert.equal(card('a'), focusedCard, 'the focused card stays mounted while its group is edited')
    assert.equal(card('a').querySelector('[data-field="group"] input'), groupInput)
    assert.equal(document.activeElement, groupInput)
    assert.equal(card('a').closest('[data-board-group]').dataset.boardGroup, 'Intake', 'only the display location is pinned during focus')
    await React.act(async () => groupInput.blur())
    assert.equal(card('a').closest('[data-board-group]').dataset.boardGroup, 'Review', 'leaving the field applies the canonical grouping')
    data = structuredClone(original)
    await React.act(show)
    await click(card('a').querySelector('[data-testid="record-up-a"]'))
    assert.deepEqual(data.requirement_order, ['a', 'b'])
    const beforeDelete = structuredClone(data)
    await click(card('a').querySelector('[data-testid="record-remove-a"]'))
    assert.deepEqual(data, beforeDelete, 'cancelled delete preserves both records and order')
    confirm = true
    await click(card('a').querySelector('[data-testid="record-remove-a"]'))
    assert.equal(data.requirements.a, undefined)
    assert.deepEqual(data.requirement_order, ['b'])
    await click(document.querySelector('.dsh-panel-workspace-tree-add'))
    assert.equal(Object.keys(data.requirements).length, 2)
    assert.equal(data.requirement_order.length, 2)
    assert.ok(Object.keys(data.requirements).every(id => data.requirements[id].id === id))
    editable = false; locale = 'zh-CN'
    await React.act(show)
    assert.equal(document.querySelector('[data-testid^="record-remove-"]'), null)
    assert.equal(document.querySelector('textarea'), null)
    assert.match(document.querySelector('.dsh-record-facts').textContent, /在什么情况下验收/)
  } finally { window.confirm = oldConfirm; await React.act(() => root.unmount()) }
})

test('direct board cards preserve hidden grouping and conditional body visibility without erasing saved values', async () => {
  const { validatePanelManifest } = await import('../../core/src/panel-dsl.ts')
  const panel = { version: 1, panel_kind: 'document', sections: [
    { id: 'items', title: 'Items', add_mode: 'none' },
  ], fields: [
    { key: 'title', label: 'Title', control: 'text', applies_to: ['items'] },
    { key: 'group', label: 'Private grouping field', control: 'text', hidden: true, applies_to: ['items'] },
    { key: 'show_details', label: 'Show details', control: 'select', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], applies_to: ['items'] },
    { key: 'condition', label: 'Conditional condition', control: 'textarea', visible_when: { field: 'show_details', in: ['yes'] }, applies_to: ['items'] },
    { key: 'result', label: 'Result', control: 'textarea', readonly: true, applies_to: ['items'] },
  ], ui: { component: 'record_board', id: 'visible-board', source: 'items', board: {
    label: 'title', description: 'condition', group: 'group', body_fields: ['condition', 'result'], detail_fields: [], overview: false,
  } } }
  let data = { items: { a: { title: 'One record', group: 'Saved grouping', show_details: 'no', condition: 'Retained conditional fact', result: 'Always readable fact', source_refs: ['keep-source'] } } }
  const original = structuredClone(data), writes = [], root = createRoot(document.getElementById('root'))
  let editable = true
  const show = () => root.render(renderManifest(panel, data, { locale: 'en-US', editable,
    onEdit(edit) { writes.push(edit); data = applyDesignEditToDraft(data, panel, edit); show() },
    onTransaction(edits) { writes.push(edits); for (const edit of edits) data = applyDesignEditToDraft(data, panel, edit); show() },
  }))
  const card = () => document.querySelector('[data-board-record="a"]')
  const hiddenFieldsAreAbsent = () => {
    assert.equal(card().querySelector('[data-field="group"], [data-field="condition"]'), null)
    assert.ok(!card().textContent.includes('Private grouping field'))
    assert.ok(!card().textContent.includes('Conditional condition'))
    assert.ok(!card().textContent.includes(data.items.a.condition), 'conditional facts are not exposed as readonly fallback text')
    assert.match(card().textContent, /Always readable fact/, 'a visible readonly field remains readable')
    assert.equal(card().querySelector('[data-field="result"] textarea'), null)
  }
  try {
    assert.deepEqual(validatePanelManifest(panel), [], 'hidden grouping and conditional body fields are a supported declaration')
    await React.act(show)
    hiddenFieldsAreAbsent()
    assert.deepEqual(writes, [])
    assert.deepEqual(data, original, 'rendering cannot clear hidden saved facts')
    data = { items: { a: { ...data.items.a, show_details: 'yes' } } }
    await React.act(show)
    const input = card().querySelector('[data-field="condition"] textarea')
    assert.ok(input, 'the same field becomes editable only when its condition is satisfied')
    assert.equal(input.value, 'Retained conditional fact')
    assert.equal(card().querySelector('[data-field="group"]'), null)
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Updated visible fact')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(data.items.a.condition, 'Updated visible fact')
    assert.equal(writes.length, 1)
    data = { items: { a: { ...data.items.a, show_details: 'no' } } }
    await React.act(show)
    hiddenFieldsAreAbsent()
    editable = false
    await React.act(show)
    hiddenFieldsAreAbsent()
    assert.equal(card().querySelector('textarea, header input'), null)
    assert.equal(writes.length, 1, 'hiding a field or switching readonly cannot synthesize a write')
    assert.equal(data.items.a.condition, 'Updated visible fact')
    assert.equal(data.items.a.group, original.items.a.group)
    assert.equal(data.items.a.result, original.items.a.result)
    assert.deepEqual(data.items.a.source_refs, original.items.a.source_refs)
  } finally { await React.act(() => root.unmount()) }
})


const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'items', title: 'Items', add_mode: 'none' }], fields: [
  { key: 'title', label: 'Title', control: 'text', applies_to: ['items'] },
  { key: 'description', label: 'Description', control: 'textarea', applies_to: ['items'] },
  { key: 'priority', label: 'Priority', control: 'select', applies_to: ['items'], options: [{ value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] },
] }
const node = { component: 'record_board', id: 'board', title: 'Items', source: 'items', board: { label: 'title', description: 'description', group: 'group', badge: 'priority', rejected: 'rejected' } }

test('grouped card moves follow visible siblings without moving other groups or hidden records', async () => {
  const { pathSet } = await import('../src/record-state.ts')
  const panel = { ...manifest,
    sections: [{ id: 'items', title: 'Items', order: 'item_order', create: { defaults: {} } }],
    ui: { ...node, board: { ...node.board, overview: false } },
  }
  let data = { item_order: ['a', 'b', 'c', 'd', 'e'], items: {
    a: { title: 'A first', description: 'First in A', group: 'Group A' },
    b: { title: 'B first', description: 'First in B', group: 'Group B' },
    c: { title: 'A second', description: 'Second in A', group: 'Group A', rejected: true },
    d: { title: 'B last', description: 'Last in B', group: 'Group B' },
    e: { title: 'A last', description: 'Last in A', group: 'Group A' },
  } }
  const records = structuredClone(data.items), writes = [], root = createRoot(document.getElementById('root'))
  const show = () => root.render(renderManifest(panel, data, { locale: 'en-US', editable: true,
    onPanelUpdate(updates) { writes.push(updates); for (const [path, value] of Object.entries(updates)) data = pathSet(data, path, value); show() },
  }))
  const action = (id, direction) => document.querySelector(`[data-testid="record-${direction}-${id}"]`)
  const groups = () => [...document.querySelectorAll('[data-board-group]')].map(el => el.dataset.boardGroup)
  const visible = group => [...document.querySelector(`[data-board-group="${group}"]`).querySelectorAll('[data-board-record]')].filter(el => !el.hidden).map(el => el.dataset.boardRecord)
  try {
    await React.act(show)
    assert.equal(writes.length, 0, 'rendering does not normalize the durable order')
    assert.deepEqual(groups(), ['Group A', 'Group B'])
    assert.deepEqual(visible('Group A'), ['a', 'c', 'e'])
    assert.equal(action('a', 'up').disabled, true)
    assert.equal(action('b', 'up').disabled, true, 'first record in the second group cannot move into the first group')
    assert.equal(action('d', 'down').disabled, true)
    await React.act(async () => action('a', 'down').click())
    assert.deepEqual(data.item_order, ['c', 'b', 'a', 'd', 'e'])
    assert.deepEqual(visible('Group A'), ['c', 'a', 'e'])
    assert.deepEqual(groups(), ['Group A', 'Group B'], 'moving the leading card cannot move its entire group')
    const filter = document.querySelector('.dsh-panel-workspace-tree-actions [role="combobox"]')
    await choose(filter, 'Active')
    assert.deepEqual(visible('Group A'), ['a', 'e'])
    assert.equal(action('a', 'up').disabled, true, 'hidden records do not create a misleading move target')
    await React.act(async () => action('a', 'down').click())
    assert.deepEqual(data.item_order, ['c', 'b', 'e', 'd', 'a'], 'other groups and filtered records retain their slots')
    assert.deepEqual(visible('Group A'), ['e', 'a'])
    assert.deepEqual(data.items, records, 'sorting does not alter grouping or record content')
    await choose(filter, 'All')
    delete panel.ui.board.group
    await React.act(show)
    await React.act(async () => action('e', 'up').click())
    assert.deepEqual(data.item_order, ['c', 'e', 'b', 'd', 'a'], 'ungrouped boards move across the visible list normally')
  } finally { await React.act(() => root.unmount()) }
})

test('canvas controls follow the Panel locale while keeping the overview and authored records', async () => {
  const root = createRoot(document.getElementById('root'))
  const data = { items: { a: { title: 'Authored record', description: 'Keep', group: 'Authored group' } } }
  let locale = 'zh-CN'
  const show = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale }, React.createElement(RecordBoard, {
    node, manifest, data, options: { onEdit: () => assert.fail('localizing controls must not edit records') }, render: () => null,
  })))
  try {
    await React.act(show)
    await React.act(async () => document.querySelector('.dsh-record-board-map-toggle').click())
    assert.ok(document.querySelector('.react-flow__controls button[aria-label="放大"]'))
    assert.ok(document.querySelector('.react-flow__controls button[aria-label="显示全图"]'))
    assert.doesNotMatch(document.querySelector('.dsh-record-board-map').textContent, /Press enter|Press delete/)
    locale = 'en-US'; await React.act(show)
    assert.ok(document.querySelector('.react-flow__controls button[aria-label="Zoom in"]'))
    assert.ok(document.querySelector('.react-flow__controls button[aria-label="Fit all"]'))
    assert.match(document.querySelector('.dsh-record-board-map').textContent, /Authored record/)
    assert.match(document.querySelector('.dsh-record-board-map').textContent, /Return to the list/)
  } finally { await React.act(() => root.unmount()) }
})

test('direct card edits use the shared Panel draft and global Revert without a local save barrier', async () => {
  const { panelStore, resetPanelStore, syncProjection, editDraft, isDirty, revertAll } = await import('../src/client/store.ts')
  const registry = { get: () => undefined }, skill = 'direct-board-test'
  const saved = { items: { a: { title: 'One', description: 'Saved description', priority: 'low', group: 'Group', untouched: 'Keep' } } }
  const project = state => ({ [skill]: { state, skillManifest: { presentation: { mode: 'declarative' } } } })
  const root = createRoot(document.getElementById('root'))
  let writable = true, writes = 0, registrations = 0
  resetPanelStore('direct-board-test')
  syncProjection(project(saved), true, registry)
  const show = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(RecordBoard, {
    node, manifest, data: panelStore.getSnapshot().drafts[skill], options: { editable: writable,
      registerBeforeSave() { registrations++; assert.fail('a direct editor must not register another local save boundary') },
      onEdit(edit) {
        writes++
        editDraft(skill, applyDesignEditToDraft(panelStore.getSnapshot().drafts[skill], manifest, edit))
        show()
      },
    }, render: () => null,
  })))
  const input = value => React.act(async () => {
    const el = document.querySelector('[data-board-record="a"] .dsh-record-board-description-editor')
    assert.ok(el, 'the ordinary editor is available immediately')
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  try {
    await React.act(show)
    assert.equal(isDirty(skill, registry), false)
    await input('Keep while changing panels')
    assert.equal(panelStore.getSnapshot().drafts[skill].items.a.description, 'Keep while changing panels')
    assert.equal(isDirty(skill, registry), true, 'the existing global save bar sees the input immediately')
    assert.equal(registrations, 0)
    await React.act(async () => root.render(React.createElement('div', null, 'Another panel')))
    await React.act(show)
    assert.equal(document.querySelector('textarea').value, 'Keep while changing panels')
    assert.equal(panelStore.getSnapshot().drafts[skill].items.a.untouched, 'Keep')
    assert.equal(saved.items.a.description, 'Saved description', 'navigation is not a durable save')
    await input('Discard me')
    await React.act(async () => { revertAll(); show() })
    assert.equal(isDirty(skill, registry), false)
    assert.equal(document.querySelector('textarea').value, 'Saved description')
    await React.act(async () => root.render(React.createElement('div', null, 'Another panel')))
    await React.act(show)
    assert.equal(document.querySelector('textarea').value, 'Saved description', 'navigation cannot revive discarded card input')
    await input('Keep the shared dirty draft')
    const external = { items: { a: { ...saved.items.a, description: 'External input' } } }
    await React.act(async () => { syncProjection(project(external), true, registry); show() })
    assert.equal(document.querySelector('textarea').value, 'Keep the shared dirty draft', 'Host polling retains the existing dirty Panel draft')
    assert.equal(panelStore.getSnapshot().originals[skill].items.a.description, 'External input')
    await React.act(async () => { revertAll(); show() })
    assert.equal(document.querySelector('textarea').value, 'External input', 'global Revert uses the current Host baseline')
    const beforeLock = writes
    writable = false
    await React.act(show)
    assert.equal(document.querySelector('textarea'), null)
    assert.match(document.querySelector('.dsh-record-board-description').textContent, /External input/)
    assert.equal(document.querySelector('[role="combobox"][aria-label="Priority"]').disabled, true)
    assert.equal(writes, beforeLock, 'revoking editing cannot emit a retained local commit')
    assert.equal(registrations, 0)
  } finally { await React.act(() => root.unmount()); resetPanelStore() }
})

test('Function cards display the saved ID through expanded details, renaming and read-only rendering', async () => {
  const { readFile } = await import('node:fs/promises')
  const { parsePanelManifest } = await import('../../core/src/panel-dsl.ts')
  const bundle = new URL('../../skills-web-app/bundles/function_modules/', import.meta.url)
  const panel = parsePanelManifest(await readFile(new URL('panel.yaml', bundle), 'utf8'))
  panel.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale =>
    [locale, JSON.parse(await readFile(new URL(`locales/${locale}.json`, bundle), 'utf8'))])))
  let data = { functions: { internal_key: { function_id: 'F-005', function_name: 'Find saved material',
    function_description: 'Search the saved collection.', function_epic: 'Reading', priority: 'High',
    details: { situation: 'A reader returns to a saved article.' }, reason: 'Keep the original note' } } }
  const initial = structuredClone(data), edits = []
  const root = createRoot(document.getElementById('root'))
  const show = (editable = true, locale = 'en-US') => React.act(async () => root.render(renderManifest(panel, data, {
    editable, locale, onEdit(edit) { edits.push(edit); data = applyDesignEditToDraft(data, panel, edit) },
    onTransaction(values) { for (const edit of values) { edits.push(edit); data = applyDesignEditToDraft(data, panel, edit) } },
  })))
  try {
    await show()
    const card = document.querySelector('[data-board-record="internal_key"]')
    assert.equal(card.querySelector('header .dsh-record-board-id').textContent, 'F-005', 'display the saved field, not the map key')
    assert.equal(card.querySelector('.dsh-record-board-id').title, 'Function ID')
    assert.equal(card.querySelector('input[aria-label="Function ID"]'), null, 'identity has no editor')
    assert.deepEqual(edits, [], 'viewing does not initialize or rewrite IDs')
    await React.act(async () => card.querySelector('.dsh-record-board-editor summary').click())
    assert.equal(card.querySelector('details').open, true)
    assert.equal(card.querySelector('header .dsh-record-board-id').textContent, 'F-005', 'the same header identifies expanded details')
    const name = card.querySelector('input[aria-label="Function name"]')
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(name, 'Locate saved material')
      name.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(edits.length, 1)
    assert.equal(edits[0].field, 'function_name')
    assert.equal(data.functions.internal_key.function_id, 'F-005')
    assert.deepEqual({ ...data.functions.internal_key, function_name: initial.functions.internal_key.function_name }, initial.functions.internal_key)
    await show(false, 'zh-CN')
    assert.equal(document.querySelector('.dsh-record-board-id').textContent, 'F-005')
    assert.equal(document.querySelector('.dsh-record-board-id').title, '功能 ID')
    assert.equal(document.querySelector('[data-board-record] header h4').textContent, 'Locate saved material')
    const editCount = edits.length
    data.functions.internal_key.rejected = true
    await show(true)
    assert.equal(document.querySelector('.dsh-record-board-id').textContent, 'F-005', 'rejected functions retain their identity')
    assert.equal(document.querySelector('[data-board-record] header input'), null)
    delete panel.ui.board.id_field
    await show(false)
    assert.equal(document.querySelector('.dsh-record-board-id'), null, 'omitting the binding preserves title-only cards')
    panel.ui.board.id_field = 'function_id'
    delete data.functions.internal_key.function_id
    await show(false)
    assert.equal(document.querySelector('.dsh-record-board-id'), null, 'missing ID never invents a map-key fallback')
    assert.equal(edits.length, editCount)
  } finally { await React.act(async () => root.unmount()) }
})

test('Function request creation retains header lifecycle actions and valid durable function order', async () => {
  const { readFile } = await import('node:fs/promises')
  const { parsePanelManifest } = await import('../../core/src/panel-dsl.ts')
  const { compileSchema, parseSchemaYaml } = await import('../../core/src/schema.ts')
  const { pathSet } = await import('../src/record-state.ts')
  const bundle = new URL('../../skills-web-app/bundles/function_modules/', import.meta.url)
  const panel = parsePanelManifest(await readFile(new URL('panel.yaml', bundle), 'utf8'))
  panel.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale =>
    [locale, JSON.parse(await readFile(new URL(`locales/${locale}.json`, bundle), 'utf8'))])))
  const validate = compileSchema(parseSchemaYaml(await readFile(new URL('schema.yaml', bundle), 'utf8')))
  let data = { functions: {
    'F-001': { function_id: 'F-001', function_name: 'Find saved material', function_description: 'Search the saved collection.', function_epic: 'Reading', priority: 'High', source: 'user', reason: 'Keep this source note', details: { situation: 'A reader returns to a saved article.' } },
    'F-002': { function_id: 'F-002', function_name: 'Open saved material', function_description: 'Open the selected article.', function_epic: 'Reading', priority: 'Medium' },
    'F-003': { function_id: 'F-003', function_name: 'Manage access', function_description: 'Choose who can read.', function_epic: 'Access', priority: 'Low' },
  } }
  const initial = structuredClone(data), writes = [], sent = []
  const root = createRoot(document.getElementById('root'))
  const dialogPrototype = dom.window.HTMLDialogElement.prototype
  const oldShowModal = dialogPrototype.showModal, oldClose = dialogPrototype.close, oldConfirm = window.confirm
  dialogPrototype.showModal = function() { this.open = true }
  dialogPrototype.close = function() { this.open = false }
  let editable = true, confirm = false
  window.confirm = () => confirm
  const show = () => root.render(renderManifest(panel, data, { locale: 'en-US', editable,
    sendPrompt: prompt => sent.push(prompt),
    onEdit(edit) { writes.push(edit); data = applyDesignEditToDraft(data, panel, edit); show() },
    onTransaction(edits) { writes.push(edits); for (const edit of edits) data = applyDesignEditToDraft(data, panel, edit); show() },
    onPanelUpdate(updates) { writes.push(updates); for (const [path, value] of Object.entries(updates)) data = pathSet(data, path, value); show() },
  }))
  const card = id => document.querySelector(`[data-board-record="${id}"]`)
  const action = (id, kind) => card(id).querySelector(`:scope > header > .dsh-design-record-actions [data-testid="record-${kind}-${id}"]`)
  try {
    assert.ok(panel.ui.board.request_create, 'this is the actual Host-request creation declaration')
    assert.equal(panel.sections.find(section => section.id === 'functions').order, 'function_order')
    assert.deepEqual(validate(data), [], 'existing state remains valid without optional order metadata')
    await React.act(show)
    assert.equal(Object.hasOwn(data, 'function_order'), false, 'viewing old data cannot initialize metadata')
    assert.deepEqual(writes, [])
    assert.equal(card('F-001').querySelector(':scope > header').firstElementChild.textContent, 'F-001', 'saved identity leads the shared card header')
    for (const kind of ['up', 'down', 'remove']) assert.ok(action('F-001', kind), 'Host-request creation does not suppress existing lifecycle actions')
    assert.equal(action('F-001', 'up').disabled, true)
    assert.equal(action('F-002', 'down').disabled, true, 'moves stay within their displayed group')
    const originalOrder = Object.keys(data.functions)
    await React.act(async () => action('F-001', 'up').click())
    assert.deepEqual(writes, [], 'a disabled boundary cannot emit metadata')
    await React.act(async () => document.querySelector('.dsh-panel-workspace-tree-add').click())
    assert.ok(document.querySelector('dialog'))
    await React.act(async () => document.querySelector('dialog button[aria-label="Cancel"]').click())
    assert.deepEqual(data, initial, 'cancelling the Host request cannot create a canonical record')
    assert.deepEqual(sent, [])
    await React.act(async () => action('F-002', 'up').click())
    assert.deepEqual(data.function_order, ['F-002', 'F-001', 'F-003'])
    assert.deepEqual(Object.keys(data.functions), originalOrder, 'an explicit order change preserves the record map')
    assert.deepEqual(data.functions, initial.functions, 'moving records preserves identities, details and source facts')
    assert.deepEqual(validate(data), [])
    data = JSON.parse(JSON.stringify(data))
    await React.act(show)
    assert.deepEqual([...document.querySelectorAll('[data-board-record]')].map(element => element.dataset.boardRecord), data.function_order, 'the saved wire representation reopens in declared order')
    const beforeRemove = structuredClone(data), count = writes.length
    await React.act(async () => action('F-001', 'remove').click())
    assert.equal(writes.length, count)
    assert.deepEqual(data, beforeRemove, 'a rejected confirmation preserves both map and order')
    confirm = true
    await React.act(async () => action('F-001', 'remove').click())
    assert.equal(Object.hasOwn(data.functions, 'F-001'), false)
    assert.deepEqual(data.function_order, ['F-002', 'F-003'])
    assert.ok(data.function_order.every(id => Object.hasOwn(data.functions, id)), 'atomic deletion leaves no stale order reference')
    assert.deepEqual(data.functions['F-002'], initial.functions['F-002'])
    assert.deepEqual(data.functions['F-003'], initial.functions['F-003'])
    assert.deepEqual(validate(data), [], 'the actual Function schema accepts the remaining records and metadata')
    assert.ok(validate({ ...data, function_order: [1] }).length, 'order metadata retains string identity validation')
    editable = false
    await React.act(show)
    assert.equal(document.querySelector('[data-testid^="record-up-"], [data-testid^="record-down-"], [data-testid^="record-remove-"]'), null)
    assert.equal(document.querySelector('.dsh-panel-workspace-tree-add'), null)
  } finally {
    window.confirm = oldConfirm
    await React.act(() => root.unmount())
    if (oldShowModal === undefined) delete dialogPrototype.showModal; else dialogPrototype.showModal = oldShowModal
    if (oldClose === undefined) delete dialogPrototype.close; else dialogPrototype.close = oldClose
  }
})

test('cover keeps hidden content from extending the canvas and restores focus without scrolling', async () => {
  const { PanelWorkspaceCover } = await import('../src/panel-workspace.tsx')
  const { readFileSync } = await import('node:fs')
  const root = createRoot(document.getElementById('root'))
  const nativeFocus = dom.window.HTMLElement.prototype.focus
  const calls = []
  dom.window.HTMLElement.prototype.focus = function(options) {
    calls.push({ element: this, options })
    nativeFocus.call(this, options)
  }
  const show = active => React.act(async () => root.render(React.createElement(PanelWorkspaceCover, {
    active, keepCoverMounted: true, label: 'Canvas', onClose() {},
    cover: React.createElement('div', null, 'Canvas'),
  }, React.createElement('button', { id: 'open-map' }, 'Open canvas'))))
  try {
    await show(false)
    const trigger = document.getElementById('open-map')
    trigger.focus()
    await show(true)
    assert.equal(document.activeElement.className, 'dsh-workspace-cover-return')
    assert.deepEqual(calls.at(-1).options, { preventScroll: true })
    assert.equal(document.querySelector('.dsh-workspace-cover-base').getAttribute('aria-hidden'), 'true')
    await show(false)
    assert.equal(document.activeElement, trigger)
    assert.deepEqual(calls.at(-1).options, { preventScroll: true })
    assert.equal(document.getElementById('open-map'), trigger, 'form state is retained, not remounted')
    const css = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
    for (const layer of ['base', 'surface']) assert.ok(css.includes(`.dsh-workspace-cover-${layer}[aria-hidden='true'] { overflow: clip; }`))
  } finally {
    dom.window.HTMLElement.prototype.focus = nativeFocus
    await React.act(async () => root.unmount())
  }
})

test('inheritance source references retain multiple parents and navigate without writes, including read-only', async () => {
  const root = createRoot(document.getElementById('root'))
  const graph = { nodes: 'things', edges: 'links', label_field: 'name', source_field: 'from', target_field: 'to', edge_kind_field: 'kind',
    hierarchy: { values: ['extends'], label: 'Inherited definitions', description: 'Edit shared information in its parent type.' } }
  const panel = { version: 1, panel_kind: 'neutral_records', sections: [
    { id: 'things', title: 'Things', add_mode: 'none' }, { id: 'links', title: 'Links', add_mode: 'none' },
  ], fields: [
    { key: 'name', label: 'Name', control: 'text', applies_to: ['things', 'links'] },
    { key: 'from', control: 'record_select', options_from_section: 'things', applies_to: ['links'] },
    { key: 'to', control: 'record_select', options_from_section: 'things', applies_to: ['links'] },
    { key: 'kind', control: 'text', applies_to: ['links'] },
  ], ui: { id: 'workspace', component: 'record_workspace', title: 'Things', navigation_roots: 'records', sources: ['things', 'links'], children: [
    { id: 'graph', component: 'relation_graph', graph },
    { id: 'details', component: 'record_inspector', children: [{ id: 'form', component: 'record_form' }] },
  ] } }
  const longName = 'A long parent type <strong>not markup</strong>'
  const data = { things: { parent: { name: longName }, second: { name: 'Second parent' }, child: { name: 'Child', own: 'Keep' }, related: { name: 'Unrelated peer' } },
    links: { one: { from: 'child', to: 'parent', kind: 'extends' }, two: { from: 'child', to: 'second', kind: 'extends' },
      association: { from: 'child', to: 'related', kind: 'association' } } }
  const before = structuredClone(data), writes = []
  const show = (editable, locale = 'en-US') => React.act(async () => root.render(renderManifest(panel, data, { editable, locale,
    onEdit: edit => writes.push(edit), onPanelUpdate: updates => writes.push(updates), onTransaction: edits => writes.push(edits) })))
  const selectChild = () => React.act(async () => document.querySelector('.dsh-panel-workspace-tree-item[aria-label="Child"]').click())
  try {
    for (const editable of [true, false]) {
      await show(editable); await selectChild()
      const region = document.querySelector('.dsh-record-inheritance')
      assert.equal(region.getAttribute('aria-label'), graph.hierarchy.label)
      assert.equal(region.querySelector('p'), null, 'field help does not take a separate content row')
      await React.act(async () => region.querySelector('.dsh-panel-help button').click())
      assert.equal(document.querySelector('[role=tooltip]').textContent, graph.hierarchy.description)
      await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      const parents = [...region.querySelectorAll('.dsh-record-inheritance-parent')]
      assert.deepEqual(parents.map(button => button.textContent), [longName, 'Second parent'])
      assert.equal(region.querySelector('strong'), null, 'a parent label cannot inject markup')
      assert.ok(parents.every(button => !button.disabled), 'read-only does not disable source navigation')
      assert.equal(parents[0].getAttribute('aria-label'), `View source: ${longName}`)
      await React.act(async () => parents[0].click())
      assert.equal(document.querySelector('.dsh-panel-workspace-tree-item[aria-current="page"]').textContent, longName)
      assert.ok(document.querySelector('.dsh-record-inspector').textContent.includes(longName))
      assert.equal(document.querySelector('.dsh-record-inheritance'), null, 'root records do not display an empty inheritance band')
      await selectChild()
      await React.act(async () => document.querySelectorAll('.dsh-record-inheritance-parent')[1].click())
      assert.equal(document.querySelector('.dsh-panel-workspace-tree-item[aria-current="page"]').textContent, 'Second parent')
    }
    await show(false, 'zh-CN'); await selectChild()
    assert.equal(document.querySelector('.dsh-record-inheritance-parent').getAttribute('aria-label'), `查看来源：${longName}`)
    assert.deepEqual(writes, [], 'viewing, switching language and navigation never write inheritance or duplicate parent facts')
    assert.deepEqual(data, before)
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
    assert.match(css, /\.dsh-record-inheritance-heading \{[^}]*flex-wrap:\s*wrap/)
    assert.match(css, /\.dsh-record-inheritance-parent > span \{[^}]*overflow-wrap:\s*anywhere/)
    assert.match(css, /\.dsh-record-inheritance \.dsh-record-inheritance-parent:focus-visible \{[^}]*outline:\s*2px/)
  } finally { await React.act(() => root.unmount()) }
})

test('compact record details share the first heading row while preserving disclosure and edits', async () => {
  const { readFileSync } = await import('node:fs')
  const { PanelDetailDisclosure } = await import('../src/panel-workspace.tsx')
  const { CompactRecordDetails } = await import('../src/compact-record-details.tsx')
  const style = document.createElement('style')
  style.textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  document.head.appendChild(style)
  const root = createRoot(document.getElementById('root'))
  try {
    await React.act(() => root.render(React.createElement('div', { className: 'dsh-design-panel' },
      React.createElement(PanelDetailDisclosure, { title: 'Details', className: 'dsh-record-board-editor' },
        React.createElement(CompactRecordDetails, {
          fields: [{ key: 'context', label: 'Context', control: 'text' }], values: { context: 'Draft' }, optional: false, editable: true,
          render: () => React.createElement('input', { defaultValue: 'Draft' }), change: () => {},
        })))))
    const details = document.querySelector('details'), summary = details.querySelector('summary')
    const label = summary.querySelector('.dsh-panel-disclosure-label'), input = details.querySelector('input')
    assert.equal(window.getComputedStyle(summary).fontWeight, '400')
    assert.equal(window.getComputedStyle(summary).lineHeight, '20px')
    assert.equal(window.getComputedStyle(label).visibility, 'visible')
    input.value = 'Unsaved change'
    await React.act(() => summary.click())
    assert.equal(details.open, true)
    assert.equal(window.getComputedStyle(label).display, 'none')
    assert.equal(summary.getAttribute('aria-label'), 'Details', 'open disclosure retains its accessible name')
    assert.ok(summary.lastElementChild.classList.contains('dsh-panel-disclosure-icon'))
    await React.act(() => summary.click())
    assert.equal(details.open, false)
    assert.equal(window.getComputedStyle(label).visibility, 'visible')
    assert.equal(details.querySelector('input'), input, 'collapse keeps the editor mounted')
    assert.equal(input.value, 'Unsaved change')
  } finally { await React.act(() => root.unmount()); style.remove() }
})

test('detail spacing distinguishes the title boundary from independent content groups', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  const rule = selector => {
    const start = css.indexOf(`${selector} {`)
    assert.notEqual(start, -1, selector)
    return css.slice(start, css.indexOf('}', start))
  }
  assert.match(rule('.dsh-design-panel'), /--ygd-panel-detail-section-gap:\s*16px;/)
  assert.match(rule('.dsh-design-panel'), /--ygd-panel-detail-control-gap:\s*8px;/)
  assert.ok(!css.includes(':is(.dsh-record-board-editor, .dsh-board-detail-definition) {'),
    'detail leaves inherit the actual content density instead of fixing wide gaps')
  assert.match(rule('.dsh-record-board-editor > summary + .dsh-compact-record-details:not(:has(> section:first-child > header))'),
    /margin-top:\s*var\(--ygd-panel-detail-control-gap, 8px\);/)
  assert.match(rule('.dsh-record-board-editor > :is(section, .dsh-compact-record-details) + :is(section, .dsh-compact-record-details)'),
    /margin-top:\s*var\(--ygd-panel-detail-section-gap, 16px\);/)
  assert.match(rule(':is(.dsh-record-board-editor, .dsh-board-detail-definition) .dsh-compact-record-details'),
    /gap:\s*var\(--ygd-panel-detail-section-gap, 16px\);/)
  assert.match(rule(':is(.dsh-record-board-editor, .dsh-board-detail-definition) .dsh-compact-record-details > section > header'),
    /margin-bottom:\s*var\(--ygd-panel-detail-control-gap, 8px\);/)
  assert.match(rule('.dsh-design-panel .dsh-record-map-table td > :is(input, textarea, select)'),
    /display:\s*block;/)
  assert.match(rule('.dsh-design-panel textarea.dsh-panel-textarea'), /field-sizing:\s*fixed;/)
  assert.match(rule('.dsh-design-panel textarea.dsh-panel-textarea'), /resize:\s*vertical;/)
  assert.match(rule('.dsh-design-panel .dsh-record-map.is-compact:has(> .dsh-record-map-table-scroll) > .dsh-record-map-add'), /margin-inline-start:\s*48px;/)
  assert.match(rule('.dsh-record-map.is-compact .dsh-record-map-table .dsh-record-map-actions'),
    /display:\s*flex;/)
})

test('native cards edit the Panel draft directly through navigation, filters, rejection and read-only changes', async () => {
  const root = createRoot(document.getElementById('root'))
  const localManifest = structuredClone(manifest)
  let data = { items: { a: { title: 'First', description: 'Before', group: 'Group', priority: 'low', details: { preserve: true } }, b: { title: 'Second', description: 'Rejected source', group: 'Group', rejected: true } } }
  let editable = true
  const transactions = [], edits = []
  const show = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(RecordBoard, {
    node, manifest: localManifest, data, options: { editable,
      onTransaction(batch) { transactions.push(batch); for (const edit of batch) data = applyDesignEditToDraft(data, localManifest, edit); show() },
      onEdit(edit) { edits.push(edit); data = applyDesignEditToDraft(data, localManifest, edit); show() },
    }, render: () => React.createElement('p', null, 'Extra details'),
  })))
  const click = selector => React.act(async () => { document.querySelector(selector).focus(); document.querySelector(selector).click(); await new Promise(resolve => setTimeout(resolve, 0)) })
  const input = (selector, value) => React.act(async () => {
    const el = document.querySelector(selector)
    const prototype = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value)
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const card = id => document.querySelector(`[data-board-record="${id}"]`)
  const priority = () => card('a').querySelector('[role="combobox"][aria-label="Priority"]')
  try {
    await React.act(show)
    assert.equal(card('a').querySelector('header [role="combobox"]'), null, 'priority does not compete with the card title')
    assert.ok(priority().closest('.dsh-record-board-footer'))
    assert.equal(card('a').querySelector('.dsh-record-board-actions'), null, 'the card has no second Edit or Save boundary')
    assert.equal(card('b').querySelector('input, textarea'), null, 'rejected source facts stay readonly')
    assert.match(card('b').querySelector('.dsh-record-board-description').textContent, /Rejected source/)
    await click('.dsh-panel-workspace-tree-group-toggle')
    await click('.dsh-panel-workspace-tree-item')
    assert.ok(card('a').querySelector('textarea'), 'sidebar navigation uses the same directly editable card')
    assert.equal(transactions.length, 0, 'navigation alone cannot write')
    await input('[data-board-record="a"] textarea', 'Panel draft')
    await choose(priority(), 'High')
    assert.equal(transactions.length, 2)
    assert.equal(data.items.a.description, 'Panel draft')
    assert.equal(data.items.a.priority, 'high', 'priority writes the same Panel draft without a card commit')
    await choose(document.querySelector('.dsh-panel-workspace-tree-actions [role="combobox"]'), 'Rejected')
    const filter = document.querySelector('.dsh-panel-workspace-tree-actions [role="combobox"]')
    assert.ok(filter.classList.contains('is-icon-only'))
    assert.equal(filter.dataset.active, 'true')
    assert.match(filter.title, /Rejected/)
    assert.equal(filter.querySelector('svg')?.getAttribute('width'), '16')
    assert.equal(filter.querySelector('.dsh-panel-select-hidden-value')?.textContent, 'Rejected')
    assert.equal(filter.querySelectorAll('svg').length, 1)
    assert.equal(card('a').hidden, true)
    await choose(filter, 'All')
    assert.equal(filter.dataset.active, 'false')
    await choose(document.querySelector('.dsh-panel-workspace-tree-actions [role="combobox"]'), 'Active')
    assert.equal(card('a').querySelector('textarea').value, 'Panel draft', 'filter round trips retain the canonical draft')
    const field = card('a').querySelector('textarea'), focusedCard = card('a')
    await React.act(async () => field.focus())
    data = { ...data, items: { ...data.items, a: { ...data.items.a, group: 'Updated group' } } }
    await React.act(show)
    assert.equal(card('a'), focusedCard, 'changing the group does not remount a focused card')
    assert.equal(card('a').querySelector('textarea'), field)
    assert.equal(document.activeElement, field)
    assert.equal(field.value, 'Panel draft')
    await click('.dsh-record-board-map-toggle')
    assert.ok(document.querySelector('.dsh-workspace-cover-base').hasAttribute('inert'))
    assert.equal(document.activeElement.className, 'dsh-workspace-cover-return')
    assert.ok(document.querySelector('.dsh-workspace-cover-surface .dsh-record-board-map'))
    await click('.dsh-workspace-cover-return')
    assert.equal(document.querySelector('.dsh-workspace-cover-surface').style.opacity, '0')
    assert.ok(document.querySelector('.dsh-workspace-cover-surface').hasAttribute('inert'))
    assert.equal(card('a').querySelector('textarea').value, 'Panel draft')
    assert.ok(document.activeElement.classList.contains('dsh-record-board-map-toggle'))
    assert.deepEqual(data.items.a.details, { preserve: true })
    await input('[data-board-record="a"] .dsh-design-record-header-input', 'Changed title')
    assert.equal(data.items.a.title, 'Changed title')
    localManifest.fields.find(field => field.key === 'title').readonly = true
    await React.act(show)
    assert.equal(card('a').querySelector('header input'), null, 'a readonly declaration removes only the affected editor')
    assert.equal(card('a').querySelector('header h4').textContent, 'Changed title')
    assert.ok(card('a').querySelector('textarea'))
    localManifest.fields.find(field => field.key === 'description').readonly = true
    await React.act(show)
    assert.equal(card('a').querySelector('textarea'), null)
    assert.match(card('a').querySelector('.dsh-record-board-description').textContent, /Panel draft/)
    await choose(document.querySelector('.dsh-panel-workspace-tree-actions [role="combobox"]'), 'All')
    const restore = [...card('b').querySelectorAll('button')].find(button => button.textContent === 'Restore')
    assert.ok(restore)
    await React.act(async () => restore.click())
    assert.equal(data.items.b.rejected, false)
    assert.equal(data.items.b.description, 'Rejected source', 'restoring a record preserves its saved facts')
    assert.equal(edits.at(-1).field, 'rejected')
    const beforeLock = { transactions: transactions.length, edits: edits.length, data: structuredClone(data) }
    editable = false
    await React.act(show)
    assert.equal(document.querySelector('[data-board-record] textarea, [data-board-record] header input'), null)
    assert.ok(priority().disabled, 'the footer follows the same readonly lock')
    assert.equal(transactions.length, beforeLock.transactions)
    assert.equal(edits.length, beforeLock.edits)
    assert.deepEqual(data, beforeLock.data, 'readonly rendering cannot flush a hidden card draft')
  } finally { await React.act(() => root.unmount()) }
})

test('rejected board detail sources render through interpreter with no child writes', async () => {
  const root = createRoot(document.getElementById('root'))
  const child = { id: 'children', title: 'Child records', create: { id_field: 'id', defaults: {} } }
  const panel = { ...manifest, sections: [...manifest.sections, child], fields: [...manifest.fields,
    { key: 'caption', label: 'Child caption', control: 'text', applies_to: ['children'] }],
    ui: { ...node, board: { ...node.board, detail_sources: [{ section: 'children', reference: 'owner' }] },
      children: [{ component: 'record_form', id: 'child-form', source: 'children' }] } }
  const data = { items: { a: { title: 'Rejected parent', group: 'Group', rejected: true } }, children: { c: { id: 'c', owner: 'a', caption: 'Do not edit' } } }
  const writes = []
  try {
    await React.act(async () => root.render(renderManifest(panel, data, { editable: true, onEdit: e => writes.push(e), onPanelUpdate: e => writes.push(e), onTransaction: e => writes.push(e) })))
    const filter = document.querySelector('.dsh-panel-workspace-tree-actions [role="combobox"]')
    await choose(filter, '已拒绝')
    const details = document.querySelector('[data-board-record="a"] details'); details.open = true
    const childEditor = document.querySelector('.dsh-board-detail-workspace')
    assert.match(childEditor.textContent, /Do not edit/)
    assert.equal(childEditor.querySelector('input, textarea, button'), null, 'child fields and record creation are readonly')
    assert.deepEqual(writes, [])
  } finally { await React.act(() => root.unmount()) }
})

test('board sidebar add opens the existing request and cancels without writes or Host work', async () => {
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function() { this.open = false }
  const root = createRoot(document.getElementById('root'))
  const sent = [], writes = []
  let editable = true
  const requestManifest = { ...manifest, sections: [{ id: 'items', title: 'Items', item_name: 'item', create: { defaults: { priority: 'low' } } }] }
  const requestNode = { ...node, board: { ...node.board, request_create: { fields: ['title', 'description', 'priority'], prompt: 'Please add', submit_label: 'Send request' } } }
  const show = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(RecordBoard, {
    node: requestNode, manifest: requestManifest, data: { items: {} },
    options: { editable, sendPrompt: text => sent.push(text), onEdit: edit => writes.push(edit) }, render: () => null,
  })))
  try {
    await React.act(show)
    assert.equal(document.querySelector('.dsh-record-board-toolbar'), null, 'no empty toolbar remains above content')
    assert.ok(document.querySelector('.dsh-panel-workspace-tree-actions [aria-label="Filter records"]'))
    const add = document.querySelector('.dsh-panel-workspace-sidebar .dsh-panel-workspace-tree-add')
    assert.match(add.textContent, /Add item/)
    await React.act(() => add.click())
    assert.ok(document.querySelector('dialog[open]'))
    assert.match(document.querySelector('dialog').textContent, /Send request/)
    await React.act(() => document.querySelector('dialog button[aria-label="Cancel"]').click())
    assert.equal(document.querySelector('dialog'), null)
    assert.deepEqual(sent, []); assert.deepEqual(writes, [])
    editable = false; await React.act(show)
    assert.equal(document.querySelector('.dsh-panel-workspace-tree-add'), null)
  } finally { await React.act(() => root.unmount()) }
})

test('creation request awaits one host delivery, retains values on failure and never writes canonical data', async () => {
  const { RecordRequestDialog } = await import('../src/record-request-dialog.tsx')
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function() { this.open = false }
  const root = createRoot(document.getElementById('root'))
  let editable = true, closed = 0, reject, resolve
  const sent = [], writes = []
  const requestManifest = { ...manifest, sections: [{ id: 'items', title: 'Items', create: { defaults: { priority: 'low' } } }], fields: manifest.fields.map(field => ({ ...field, required: true })) }
  const requestNode = { ...node, board: { ...node.board, request_create: { fields: ['title','description','priority'], prompt: 'Please add', submit_label: 'Send request' } } }
  const show = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(RecordRequestDialog, {
    node: requestNode, manifest: requestManifest, options: { editable, onEdit: edit => writes.push(edit), sendPrompt: text => { sent.push(text); return new Promise((yes, no) => { resolve = yes; reject = no }) } }, onClose: () => closed++,
  })))
  const fill = (selector, value) => React.act(async () => {
    const element = document.querySelector(selector)
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const submit = () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  try {
    await React.act(show)
    assert.ok(document.querySelector('[type=submit]').disabled)
    await fill('input', 'New function'); await fill('textarea', 'User request')
    await React.act(async () => { submit(); submit() })
    assert.equal(sent.length, 1); assert.equal(closed, 0); assert.deepEqual(writes, [])
    assert.match(sent[0], /Title: New function\nDescription: User request\nPriority: Low/)
    await React.act(async () => reject(new Error('Host disconnected')))
    assert.match(document.querySelector('[role=alert]').textContent, /Host disconnected/)
    assert.equal(document.querySelector('textarea').value, 'User request')
    editable = false; await React.act(show)
    await React.act(async () => submit()); assert.equal(sent.length, 1)
    editable = true; await React.act(show)
    await React.act(async () => submit()); await React.act(async () => resolve())
    assert.equal(sent.length, 2); assert.equal(closed, 1); assert.deepEqual(writes, [])
  } finally { await React.act(async () => root.unmount()) }
})

test('creation requests resolve section-scoped requirements without changing canonical data', async () => {
  const { RecordRequestDialog } = await import('../src/record-request-dialog.tsx')
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function() { this.open = false }
  const root = createRoot(document.getElementById('root'))
  const panel = { ...manifest, sections: [{ id: 'items', title: 'Items' }, { id: 'links', title: 'Links' }], fields: [
    { key: 'description', label: 'Description', description: 'Describe the intended outcome.', control: 'textarea', required_in: ['items'], applies_to: ['items', 'links'] },
  ] }
  const before = structuredClone(panel), sent = [], writes = []
  const show = source => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(RecordRequestDialog, {
    key: source, node: { ...node, source, board: { ...node.board, request_create: { fields: ['description'], prompt: 'Please add', submit_label: 'Send request' } } },
    manifest: panel, options: { editable: true, sendPrompt: async prompt => { sent.push(prompt) }, onEdit: edit => writes.push(edit) }, onClose() {},
  })))
  const submit = () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  try {
    await React.act(async () => show('items'))
    assert.equal(document.querySelector('textarea').required, true, 'request dialog retains its own existing required-input boundary')
    assert.equal(document.querySelector('.dsh-design-required-mark').title, 'Required')
    assert.equal(document.querySelector('label').control, document.querySelector('textarea'))
    assert.equal(document.querySelector('label button'), null)
    await React.act(async () => document.querySelector('.dsh-panel-guidance-trigger').click())
    const tooltip = document.querySelector('[role="tooltip"]')
    assert.equal(tooltip.textContent, 'Describe the intended outcome.')
    assert.equal(tooltip.closest('dialog'), document.querySelector('dialog'), 'help remains in the modal top layer')
    assert.equal(tooltip.hasAttribute('aria-label'), false, 'the described body is not renamed to the help button label')
    assert.equal(document.querySelector('[type=submit]').disabled, true)
    await React.act(async () => submit()); assert.deepEqual(sent, [])
    await React.act(async () => {
      const input = document.querySelector('textarea')
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, 'A useful request')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await React.act(async () => submit())
    assert.equal(sent.length, 1); assert.match(sent[0], /Description: A useful request/)
    await React.act(async () => show('links'))
    assert.equal(document.querySelector('textarea').required, false)
    assert.equal(document.querySelector('.dsh-design-required-mark'), null)
    assert.equal(document.querySelector('[type=submit]').disabled, false)
    await React.act(async () => submit()); assert.equal(sent.length, 2)
    assert.deepEqual(writes, []); assert.deepEqual(panel, before)
  } finally { await React.act(async () => root.unmount()) }
})

test('mind-map parents center on native child centers and preserve canonical ids', async () => {
  const { boardMapProjection } = await import('../src/record-board.tsx')
  const data = new Map([['A', [['a', { title: 'A', rejected: true }], ['b', { title: 'B', rejected: true }]]], ['B', [['c', { title: 'C' }]]]])
  const { nodes, edges } = boardMapProjection(data, node.board, 'Root')
  assert.deepEqual(nodes.find(n => n.id === 'group:0').position, { x: 300, y: 25 })
  assert.deepEqual(nodes.find(n => n.id === 'root').position, { x: 0, y: 62.5 })
  assert.deepEqual(nodes.find(n => n.id === 'record:c').position, { x: 600, y: 100 })
  assert.equal(nodes.find(n => n.id === 'group:0').data.rejected, true)
  assert.equal(edges.length, 5)
  assert.deepEqual(edges.map(edge => edge.ariaLabel), ['Root → A', 'A → A', 'A → B', 'Root → B', 'B → C'],
    'assistive edge names use the same authored labels as the visible nodes, not internal projection IDs')
})

test('optional details add and remove only their canonical dimension; AI names and scoped relation editors remain reachable', async () => {
  const root = createRoot(document.getElementById('root'))
  const localManifest = { ...manifest, ui: { ...node, board: { ...node.board, detail_fields: ['title'], detail_sections: ['specification'] } }, sections: [...manifest.sections, { id: 'specification', title: 'Specification', records_path: 'items', fields_path: 'details', add_mode: 'none' }], fields: [...manifest.fields,
    { key: 'purpose', label: 'Purpose', control: 'textarea', applies_to: ['specification'] },
    { key: 'steps', label: 'Steps', row_name: 'Step', control: 'record_map', applies_to: ['specification'], columns: [{ key: 'text', label: 'Text', control: 'textarea' }] },
  ] }
  let data = { items: { a: { title: 'Capability', description: 'Before', group: 'Group', details: { untouched: 'retain' } } } }
  const show = () => root.render(renderManifest(localManifest, data, { locale: 'en-US', editable: true,
    onEdit(edit) { data = applyDesignEditToDraft(data, localManifest, edit); show() },
    onTransaction(edits) { for (const edit of edits) data = applyDesignEditToDraft(data, localManifest, edit); show() },
  }))
  const byText = text => [...document.querySelectorAll('button')].find(button => button.textContent === text)
  try {
    await React.act(show)
    assert.equal(document.querySelector('textarea[aria-label=Purpose]'), null)
    assert.equal(document.querySelector('.dsh-record-board-editor > section > h5'), null,
      'one detail section does not repeat the disclosure heading')
    assert.ok(document.querySelector('input[aria-label=Title]'), 'editable AI capability identity is not swallowed by card chrome')
    await React.act(async () => byText('＋ Purpose').click())
    assert.equal(data.items.a.details.purpose, '')
    await React.act(async () => byText('＋ Steps').click())
    assert.equal(Object.keys(data.items.a.details.steps).length, 1)
    assert.match(Object.keys(data.items.a.details.steps)[0], /^item-/)
    const remove = document.querySelector('.dsh-record-map-actions button')
    await React.act(async () => remove.click())
    assert.equal(data.items.a.details.steps, undefined)
    assert.equal(data.items.a.details.untouched, 'retain')
    await React.act(async () => document.querySelector('button[aria-label="Delete Purpose"]').click())
    assert.deepEqual(data.items.a.details, { untouched: 'retain' })
  } finally { await React.act(async () => root.unmount()) }
})

test('fixed optional detail inputs preserve absence until edited and retain collection CRUD/readonly rules', async () => {
  const root = createRoot(document.getElementById('root'))
  const localManifest = { ...manifest, ui: { ...node, board: { ...node.board, detail_fields: [], detail_sections: ['specification'], detail_fields_mode: 'fixed' } },
    sections: [...manifest.sections, { id: 'specification', records_path: 'items', fields_path: 'details', add_mode: 'none' }], fields: [...manifest.fields,
      { key: 'scenario', label: 'Usage scenario', control: 'textarea', applies_to: ['specification'] },
      { key: 'secret', label: 'Secret', control: 'textarea', hidden: true, applies_to: ['specification'] },
      { key: 'source', label: 'Original note', control: 'textarea', readonly: true, applies_to: ['specification'] },
      { key: 'steps', label: 'Steps', row_name: 'Step', control: 'record_map', applies_to: ['specification'], columns: [{ key: 'text', label: 'Text', control: 'textarea' }] },
    ] }
  let data = { items: { a: { title: 'Capability', description: 'Before', group: 'Group', details: { source: 'Pinned explanation', secret: 'Keep hidden fact' } } } }, writes = 0
  const initial = structuredClone(data)
  let editable = true
  const show = () => root.render(renderManifest(localManifest, data, { locale: 'en-US', editable,
    onEdit(edit) { writes++; data = applyDesignEditToDraft(data, localManifest, edit); show() },
    onTransaction(edits) { writes++; for (const edit of edits) data = applyDesignEditToDraft(data, localManifest, edit); show() },
  }))
  try {
    await React.act(show)
    const input = document.querySelector('textarea[aria-label="Usage scenario"]')
    assert.ok(input)
    assert.equal(input.value, '')
    assert.equal(document.querySelector('[aria-label=Secret]'), null)
    assert.equal(document.querySelector('textarea[aria-label="Original note"]'), null, 'readonly data is text, not an editable input')
    assert.match(document.querySelector('.dsh-compact-record-details').textContent, /Pinned explanation/)
    assert.equal(document.querySelector('.dsh-compact-detail-add'), null)
    assert.equal(!!document.querySelector('.dsh-compact-record-details > section > header > button'), false)
    assert.deepEqual(data, initial); assert.equal(writes, 0, 'rendering optional empty fields creates no state')
    await React.act(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Who, when and for what outcome')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.deepEqual(data.items.a.details, { source: 'Pinned explanation', secret: 'Keep hidden fact', scenario: 'Who, when and for what outcome' })
    await React.act(() => document.querySelector('button[aria-label="Add Step"]').click())
    assert.equal(Object.keys(data.items.a.details.steps).length, 1)
    await React.act(() => document.querySelector('.dsh-record-map-actions button').click())
    assert.equal(data.items.a.details.steps, undefined)
    assert.equal(data.items.a.details.scenario, 'Who, when and for what outcome')
    const beforeReadonly = structuredClone(data)
    editable = false; await React.act(show)
    assert.deepEqual(data, beforeReadonly)
    assert.equal(document.querySelector('.dsh-record-map-add'), null)
    assert.equal(document.querySelector('textarea[aria-label="Usage scenario"]'), null)
    assert.match(document.querySelector('.dsh-compact-record-details').textContent, /Who, when and for what outcome/)
  } finally { await React.act(() => root.unmount()) }
})

test('distinct detail sections and professional visualizations retain their section titles', async () => {
  const root = createRoot(document.getElementById('root'))
  const sections = [{ id: 'first', title: 'First detail' }, { id: 'second', title: 'Second detail' }]
  const show = (detailSections, professional = false) => root.render(React.createElement(RecordBoard, {
    node: { ...node, board: { ...node.board, detail_sections: detailSections } },
    manifest: { ...manifest, sections: [...manifest.sections, ...sections] },
    data: { items: { a: { title: 'Capability', group: 'Group' } } },
    render: section => React.createElement('p', null, section),
    ...(professional ? { renderDetails: () => React.createElement('p', null, 'Professional graph') } : {}),
  }))
  const titles = () => [...document.querySelectorAll('.dsh-record-board-editor > section > h5')].map(el => el.textContent)
  try {
    await React.act(() => show(['first']))
    assert.deepEqual(titles(), [])
    await React.act(() => show(['first', 'second']))
    assert.deepEqual(titles(), ['First detail', 'Second detail'])
    await React.act(() => show(['first'], true))
    assert.deepEqual(titles(), ['First detail'])
    assert.match(document.querySelector('.dsh-record-board-editor').textContent, /Professional graph/)
  } finally { await React.act(() => root.unmount()) }
})

test('compact nested records number within each group and preserve multi-field identity and order', async () => {
  const { RecordMap } = await import('../src/record-map.tsx')
  const { CompactRecordDetails } = await import('../src/compact-record-details.tsx')
  const fields = [
    { key: 'steps', label: 'Steps', control: 'record_map', order_field: 'step_order', columns: [{ key: 'text', label: 'Text', control: 'textarea' }] },
    { key: 'exceptions', label: 'Exceptions', control: 'record_map', order_field: 'exception_order', columns: [{ key: 'condition', label: 'Condition', control: 'textarea' }, { key: 'response', label: 'Response', control: 'textarea' }] },
  ]
  let record = { steps: { s: { text: 'First' }, t: { text: 'Second' } }, step_order: ['s', 't'],
    exceptions: { e: { condition: 'Unavailable', response: 'Retain evidence' } }, exception_order: ['e'], untouched: 'Keep' }
  let editable = true
  const root = createRoot(document.getElementById('root'))
  const show = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' },
    React.createElement(CompactRecordDetails, { fields, values: record, optional: false, editable,
      change: () => assert.fail('presentation must not remove a dimension'),
      render: field => React.createElement(RecordMap, { field, record, editable, compact: true,
        onPatch: patch => { record = { ...record, ...patch }; show() } }),
    })))
  const group = key => document.querySelector(`[data-record-map="${key}"]`)
  const indices = key => [...group(key).querySelectorAll(':scope > section > header > strong, tbody > tr > th')].map(el => el.textContent)
  try {
    await React.act(show)
    assert.deepEqual(indices('steps'), ['1.', '2.'])
    assert.deepEqual(indices('exceptions'), ['1.'], 'each dimension restarts its own numbering')
    assert.equal(group('exceptions').closest('[data-detail-control]').dataset.detailControl, 'record_map')
    const exception = group('exceptions').querySelector('[data-child-record="e"]')
    assert.equal(exception.querySelector('textarea').rows, 1, 'compact text also starts short without field-sizing support')
    assert.equal(exception.querySelectorAll(':scope > th[scope="row"]').length, 1, 'record number occupies its own column')
    assert.equal(exception.getAttribute('aria-label'), 'Exceptions 1', 'row index remains available to assistive technology')
    assert.equal(group('exceptions').querySelectorAll('thead').length, 1)
    assert.deepEqual([...group('exceptions').querySelectorAll('thead th')].map(el => el.textContent), ['No.', 'Condition', 'Response', ''])
    assert.equal(exception.querySelector('label'), null, 'column labels are not repeated within each row')
    await React.act(async () => {
      const input = exception.querySelector('textarea[aria-label="Response 1"]')
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Explain retry')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.deepEqual(record.exception_order, ['e'])
    assert.deepEqual(record.exceptions, { e: { condition: 'Unavailable', response: 'Explain retry' } })
    await React.act(async () => group('steps').querySelector('[aria-label="Move down 1"]').click())
    assert.deepEqual(record.step_order, ['t', 's'])
    assert.deepEqual(indices('steps'), ['1.', '2.'])
    assert.deepEqual([...group('steps').querySelectorAll(':scope > section')].map(el => el.dataset.childRecord), ['t', 's'])
    assert.equal(record.untouched, 'Keep')
    editable = false; await React.act(show)
    assert.equal(document.querySelector('textarea, .dsh-record-map-actions'), null)
    assert.match(group('exceptions').textContent, /Explain retry/)
    assert.deepEqual(indices('exceptions'), ['1.'])
  } finally { await React.act(() => root.unmount()) }
})

test('grouped collection add actions are concise, accessible and retain localized CRUD limits', async () => {
  const { RecordMap } = await import('../src/record-map.tsx')
  for (const locale of ['zh-CN', 'en-US']) for (const compact of [true, false]) {
    const field = { key: 'steps', label: locale === 'zh-CN' ? '核心行为' : 'Core behaviors', row_name: locale === 'zh-CN' ? '行为' : 'Behavior',
      control: 'record_map', max_rows: 1, columns: [{ key: 'text', label: 'Text', control: 'textarea' }] }
    const addLabel = locale === 'zh-CN' ? '添加行为' : 'Add Behavior'
    let record = { steps: {}, untouched: 'Keep' }, editable = true, writes = 0
    const root = createRoot(document.getElementById('root'))
    const show = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
      React.createElement(RecordMap, { field, record, editable, compact,
        onPatch: patch => { writes++; record = { ...record, ...patch }; show() } })))
    try {
      await React.act(show)
      const add = document.querySelector('.dsh-record-map-add')
      assert.equal(add.textContent, locale === 'zh-CN' ? '添加' : 'Add', 'a labelled collection uses the same tail action in both density modes')
      assert.equal(add.getAttribute('aria-label'), addLabel)
      assert.equal(add.title, addLabel)
      assert.ok(add.querySelector('svg[aria-hidden="true"]'), 'the existing plus icon remains decorative')
      assert.equal(writes, 0)
      await React.act(() => add.click())
      assert.equal(writes, 1)
      assert.equal(Object.keys(record.steps).length, 1)
      assert.match(Object.keys(record.steps)[0], /^item-/)
      assert.equal(record.untouched, 'Keep')
      assert.equal(add.disabled, true, 'concise copy must not bypass the collection limit')
      await React.act(() => add.click())
      assert.equal(writes, 1)
      await React.act(() => document.querySelector('.dsh-record-map-actions button').click())
      assert.equal(Object.keys(record.steps).length, 0)
      assert.equal(add.disabled, false)
      editable = false; await React.act(show)
      assert.equal(document.querySelector('.dsh-record-map-add'), null)
    } finally { await React.act(() => root.unmount()) }
  }
})

test('tabular compact columns do not replace collapsible, typed or professional record editors', async () => {
  const { RecordMap } = await import('../src/record-map.tsx')
  const field = { key: 'pairs', label: 'Pairs', control: 'record_map', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] }
  const root = createRoot(document.getElementById('root'))
  const show = props => root.render(React.createElement(RecordMap, { field, record: { pairs: { p: { a: 'A value', b: 'B value' } } }, editable: true, compact: true, onPatch: () => {}, ...props }))
  try {
    await React.act(() => show({}))
    assert.ok(document.querySelector('table'))
    await React.act(() => show({ compact: false }))
    assert.equal(document.querySelector('table'), null)
    await React.act(() => show({ field: { ...field, item_collapsible: true } }))
    assert.equal(document.querySelector('table'), null)
    assert.ok(document.querySelector('.dsh-record-map-heading'))
    await React.act(() => show({ field: { ...field, item_fields: [{ key: 'a', control: 'text' }] }, renderItem: () => React.createElement('p', null, 'Typed editor') }))
    assert.equal(document.querySelector('table'), null)
    assert.match(document.querySelector('.dsh-record-map').textContent, /Typed editor/)
    await React.act(() => show({ renderItem: () => React.createElement('p', null, 'Professional editor') }))
    assert.equal(document.querySelector('table'), null)
  } finally { await React.act(() => root.unmount()) }
})

test('function detail declarations render localized exception table without introducing ordering', async () => {
  const { readFileSync } = await import('node:fs')
  const { parse } = await import('yaml')
  const base = new URL('../../skills-web-app/bundles/function_modules/', import.meta.url)
  const panel = parse(readFileSync(new URL('panel.yaml', base), 'utf8'))
  panel.i18n.messages = Object.fromEntries(Object.entries(panel.i18n.locales).map(([locale, path]) => [locale, JSON.parse(readFileSync(new URL(path, base), 'utf8'))]))
  const messages = panel.i18n.messages['zh-CN']
  let data = { functions: { f: { function_id: 'f', function_name: 'Find evidence', function_description: 'Read linked sources', function_epic: 'Research',
    details: { situation: 'Find saved materials while reviewing a claim', behaviors: { b: { description: 'Read linked evidence' } }, exceptions: { e: { condition: 'Unavailable', response: 'Preserve locator' } } } } } }
  const root = createRoot(document.getElementById('root'))
  const show = () => root.render(renderManifest(panel, data, { editable: true, locale: 'zh-CN',
    onEdit: edit => { data = applyDesignEditToDraft(data, panel, edit); show() },
    onTransaction: edits => { for (const edit of edits) data = applyDesignEditToDraft(data, panel, edit); show() },
  }))
  try {
    await React.act(show)
    assert.ok([...document.querySelectorAll('.dsh-compact-record-details h5')].some(el => el.textContent === messages.situation))
    assert.ok(document.querySelector(`textarea[aria-label="${messages.reason}"]`))
    assert.equal(document.querySelector('.dsh-compact-detail-add'), null, 'fixed dimensions have no add/remove UI')
    assert.equal(!!document.querySelector('.dsh-compact-record-details > section > header > button'), false)
    const table = document.querySelector('[data-record-map="exceptions"] table')
    assert.ok(table, 'interpreter passes a professional item renderer only for typed item_fields')
    assert.deepEqual([...table.querySelectorAll('thead th')].map(el => el.textContent), ['序号', messages.condition, messages.response, ''])
    assert.equal(table.getAttribute('aria-label'), messages.exceptions)
    assert.equal(table.querySelectorAll('.dsh-record-map-actions button').length, 1, 'no up/down operations without order_field')
    assert.equal(document.querySelector('[data-record-map="behaviors"] .dsh-record-map-actions').children.length, 1, 'behavior index is for reference, not execution ordering')
    await React.act(async () => {
      const input = table.querySelector(`[aria-label="${messages.response} 1"]`)
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Explain unreadable source')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.deepEqual(data.functions.f.details, { situation: 'Find saved materials while reviewing a claim', behaviors: { b: { description: 'Read linked evidence' } }, exceptions: { e: { condition: 'Unavailable', response: 'Explain unreadable source' } } })
    assert.equal(document.querySelector('.dsh-record-board-editor > section > h5'), null)
  } finally { await React.act(() => root.unmount()) }
})

test('relationships missing both endpoints remain inspectable and repairable without a sidebar relationship tree', async () => {
  const { readFileSync } = await import('node:fs')
  const { parse } = await import('yaml')
  const base = new URL('../../skills-web-app/bundles/business_data/', import.meta.url)
  const panel = parse(readFileSync(new URL('panel.yaml', base), 'utf8'))
  panel.i18n.messages = Object.fromEntries(Object.entries(panel.i18n.locales).map(([locale, path]) => [locale, JSON.parse(readFileSync(new URL(path, base), 'utf8'))]))
  let data = { schema_version: 3, object_order: ['a', 'b'], objects: {
    a: { id: 'a', name: 'Source', fields: {}, field_order: [], states: {}, state_order: [] },
    b: { id: 'b', name: 'Target', fields: {}, field_order: [], states: {}, state_order: [] },
  }, relations: { broken: { id: 'broken', name: 'Retained relationship', kind: 'association', source: 'missing-a', target: 'missing-b', description: 'Keep this evidence' } } }
  const original = structuredClone(data)
  const root = createRoot(document.getElementById('root'))
  let editable = false
  const show = () => root.render(renderManifest(panel, data, { editable, locale: 'en-US', onEdit: edit => {
    assert.ok(editable, 'readonly inspection must not emit edits')
    data = applyDesignEditToDraft(data, panel, edit); show()
  } }))
  const open = async () => React.act(async () => document.querySelector('.dsh-record-workspace-map-toggle').click())
  const inspect = async () => React.act(async () => document.querySelector('.dsh-relation-issues button').click())
  try {
    await React.act(show)
    assert.doesNotMatch(document.querySelector('.dsh-panel-workspace-tree').textContent, /Retained relationship/)
    assert.equal(document.querySelector('.dsh-panel-workspace-tree-group'), null, 'single node collection has no duplicate root')
    await open()
    assert.match(document.querySelector('.dsh-relation-issues').textContent, /missing endpoints/)
    await inspect()
    assert.equal(document.querySelector('.dsh-workspace-cover-base').hasAttribute('inert'), false, 'repair entry reveals the existing inspector')
    assert.match(document.querySelector('.dsh-record-inspector').textContent, /Keep this evidence/)
    assert.equal(document.querySelector('.dsh-record-inspector select'), null, 'readonly can inspect but cannot repair')
    assert.deepEqual(data, original)
    editable = true
    await React.act(show)
    const repair = async (field, value) => {
      const select = document.querySelector(`.dsh-record-inspector [data-field="${field}"] [role="combobox"]`)
      assert.ok(select, `existing ${field} control remains reachable`)
      await choose(select, value === 'a' ? 'Source' : 'Target')
    }
    await repair('source', 'a')
    await open()
    assert.ok(document.querySelector('.dsh-relation-issues'), 'one missing endpoint is still reported')
    await inspect()
    await repair('target', 'b')
    await open()
    assert.equal(document.querySelector('.dsh-relation-issues'), null, 'warning disappears only when both endpoints exist')
    assert.deepEqual(data.objects, original.objects)
    assert.deepEqual(data.relations.broken, { ...original.relations.broken, source: 'a', target: 'b' })
    data = { ...original, objects: {}, object_order: [] }; editable = false
    await React.act(show)
    assert.ok(document.querySelector('.dsh-relation-issues button'), 'repair/inspection entry survives even an empty object canvas')
    await inspect()
    assert.match(document.querySelector('.dsh-record-inspector').textContent, /Keep this evidence/)
    assert.deepEqual(data.relations, original.relations, 'rendering an empty canvas cannot discard orphan relationships')
  } finally { await React.act(() => root.unmount()) }
})

test('neutral scoped-board relationship canvas covers details and preserves selected scoped edits', async () => {
  const manifest={version:1,panel_kind:'evidence_workbook',sections:[
    {id:'capabilities',title:'Collections',item_name:'Collection'},
    {id:'components',title:'Items',item_name:'Item'},
    {id:'relations',title:'Links',item_name:'Link',add_mode:'graph'}
  ],fields:[
    {key:'id',label:'Collection ID',control:'text',readonly:true,applies_to:['capabilities']},
    {key:'name',control:'text',applies_to:['capabilities','components','relations']},
    {key:'description',control:'textarea',applies_to:['capabilities','components','relations']},
    {key:'group',control:'text',applies_to:['capabilities']},
    {key:'kind',control:'text',applies_to:['components']},
    {key:'relation_kind',control:'text',applies_to:['relations']},
    {key:'capability_ref',control:'record_select',readonly:true,hidden:true,options_from_section:'capabilities',applies_to:['components','relations']},
    {key:'source',control:'record_select',options_from_section:'components',applies_to:['relations']},
    {key:'target',control:'record_select',options_from_section:'components',applies_to:['relations']}
  ],ui:{component:'record_board',id:'collections',source:'capabilities',
    board:{label:'name',id_field:'id',description:'description',group:'group',detail_presentation:'cover',detail_sources:[{section:'components',reference:'capability_ref'},{section:'relations',reference:'capability_ref'}]},
    children:[{component:'record_workspace',id:'selected-collection',workspace_view:'switch',sources:['components','relations'],children:[
      {component:'relation_graph',id:'links',graph:{nodes:'components',edges:'relations',source_field:'source',target_field:'target',label_field:'name',node_description_field:'description',node_kind_field:'kind',edge_kind_field:'relation_kind',edge_defaults:{relation_kind:'uses'}}},
      {component:'record_inspector',id:'item-detail'}
    ]}]
  }}
  let data = {schema_version:1,capabilities:{a:{id:'a',name:'Assistant',description:'Organize',group:'Personal'},b:{id:'b',name:'Other',description:'Other',group:'Personal'}},components:{one:{id:'one',name:'Capture',description:'Before',kind:'skill',capability_ref:'a'},two:{id:'two',name:'Other',description:'Unchanged',kind:'skill',capability_ref:'b'}},relations:{}}
  const root = createRoot(document.getElementById('root'))
  const show = () => root.render(renderManifest(manifest,data,{editable:true,locale:'en-US',onEdit:edit=>{data=applyDesignEditToDraft(data,manifest,edit);show()}}))
  try {
    await React.act(show)
    assert.equal(document.querySelector('[role=tab]'), null)
    const card = document.querySelector('[data-board-record="a"]')
    await React.act(async () => card.querySelector('.dsh-record-board-open-details').click())
    assert.equal(document.querySelector('.dsh-board-detail-cover > header .dsh-record-board-id').textContent, 'a', 'cover details preserve the same saved identity')
    const workspace = document.querySelector('.dsh-board-detail-cover .dsh-record-workspace')
    const outer = workspace.closest('.dsh-board-detail-cover').parentElement.parentElement
    assert.ok(outer.querySelector(':scope > .dsh-workspace-cover-base').hasAttribute('inert'), 'outer capability list is covered, not a second visible sidebar')
    assert.ok(workspace)
    assert.deepEqual([...workspace.querySelectorAll('.dsh-panel-workspace-tree-item')].map(item=>item.textContent),['Capture'],'foreign capability components are not exposed')
    const initial = workspace.querySelector('.dsh-workspace-cover-base')
    await React.act(async()=>workspace.querySelector('.dsh-record-workspace-map-toggle').click())
    assert.ok(initial.hasAttribute('inert'))
    const surface = workspace.querySelector('.dsh-workspace-cover-surface')
    assert.notEqual(surface.style.opacity,'0')
    await React.act(async()=>surface.querySelector('.dsh-workspace-cover-return').click())
    assert.equal(surface.style.opacity,'0')
    assert.equal(initial.hasAttribute('inert'),false)
    const input=workspace.querySelector('input')
    assert.equal(input.value,'Capture')
    await React.act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'Renamed');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}))})
    assert.equal(data.components.one.name,'Renamed')
    assert.equal(data.components.two.name,'Other')
    assert.equal(data.components.one.capability_ref,'a')
    await React.act(async () => outer.querySelector(':scope > .dsh-workspace-cover-surface > .dsh-workspace-cover-return').click())
    assert.equal(outer.querySelector(':scope > .dsh-workspace-cover-base').hasAttribute('inert'), false)
    assert.equal(document.querySelector('[data-board-record="a"]'), card, 'closing details preserves the board and its drafts')
    await React.act(async () => card.querySelector('.dsh-record-board-open-details').click())
    assert.equal(document.querySelector('.dsh-board-detail-cover .dsh-record-workspace'), workspace, 'reopening preserves scoped selection and graph viewport')
    assert.equal(workspace.querySelector('input').value, 'Renamed')

  } finally {await React.act(()=>root.unmount())}
})


test('ungrouped boards show records directly, edit canonically, and omit artificial map branches', async () => {
  const { boardGroups, boardMapProjection } = await import('../src/record-board.tsx')
  const local = structuredClone(node); delete local.board.group
  let data = { items: { a: { title: 'Review', description: 'A long explanation, not a category.', group: 'Unrelated saved fact' }, b: { title: 'Reuse', description: 'Retain approved material.' } } }
  const before = structuredClone(data)
  const groups = boardGroups(data.items, local.board, 'all', 'Ungrouped')
  assert.equal(groups.size, 1)
  const projection = boardMapProjection(groups, local.board, 'Rules')
  assert.deepEqual(projection.nodes.map(n => n.id), ['root', 'record:a', 'record:b'])
  assert.ok(projection.edges.every(e => e.source === 'root'))
  const panel = { ...manifest, ui: local }
  const root = createRoot(document.getElementById('root'))
  const show = () => root.render(renderManifest(panel, data, {locale: 'en-US', editable: true,
    onTransaction(edits) { for (const edit of edits) data = applyDesignEditToDraft(data, panel, edit); show() }
  }))
  try {
    await React.act(show)
    assert.equal(document.querySelector('.dsh-record-board-group-heading'), null)
    const sidebar = document.querySelector('.dsh-panel-workspace-sidebar')
    assert.ok(sidebar, 'shared navigation is present')
    assert.ok(sidebar.textContent.includes('Review'))
    assert.ok(!sidebar.textContent.includes('A long explanation'))
    assert.ok(!sidebar.textContent.includes('Ungrouped'))
    assert.deepEqual(data, before)
    const name = document.querySelector('[data-board-record="a"] input[aria-label="Title"]')
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(name, 'Review revised')
      name.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(data.items.a.title, 'Review revised')
    assert.equal(data.items.a.group, before.items.a.group)
    assert.deepEqual(data.items.b, before.items.b)
    assert.ok(!Object.hasOwn(data.items.b, 'group'))
  } finally { await React.act(async () => root.unmount()) }
})

// Use real React Flow and its controlled-node store. DOM sizes are synthetic;
// installed-browser save/reopen and visual checks remain separate.
test('record board retains measured nodes through hidden mount, reveal and reopen', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'getComputedStyle', 'ResizeObserver',
    'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'React']
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const observers = new Set(), frames = new Map()
  let frameId = 0, nodeHeight = 42
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class {
      elements = new Set()
      constructor(callback) { this.callback = callback; observers.add(this) }
      observe(element) { this.elements.add(element) }
      unobserve(element) { this.elements.delete(element) }
      disconnect() { this.elements.clear(); observers.delete(this) }
    },
  })
  dom.window.DOMMatrixReadOnly = class { m22 = 1 }
  dom.window.HTMLElement.prototype.scrollIntoView = function () {}
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    offsetWidth: { get() { return this.classList.contains('react-flow__handle') ? 10 : 200 } },
    offsetHeight: { get() { return this.classList.contains('react-flow__handle') ? 10 : nodeHeight } },
  })
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return new dom.window.DOMRect(0, 0, this.offsetWidth, this.offsetHeight)
  }
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { ReactFlowProvider, useStoreApi } = await import('@xyflow/react')
  const { RecordBoard } = await import('../src/record-board.tsx')
  const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
  const manifest = { version: 1, panel_kind: 'evidence_workbook',
    sections: [{ id: 'items', title: 'Items', add_mode: 'none' }],
    fields: [{ key: 'title', label: 'Title', control: 'text', applies_to: ['items'] },
      { key: 'description', label: 'Description', control: 'textarea', applies_to: ['items'] }] }
  const node = { component: 'record_board', id: 'board', title: 'Items', source: 'items',
    board: { label: 'title', description: 'description' } }
  let data = { items: { a: { title: 'Alpha', description: 'First' }, b: { title: 'Beta', description: 'Second' } } }
  let locale = 'en-US', instance = 0, store
  function ObserveStore() { store = useStoreApi(); return null }
  const root = createRoot(document.getElementById('root'))
  const render = () => root.render(React.createElement(ReactFlowProvider, { key: instance },
    React.createElement(ObserveStore), React.createElement(PanelLocaleContext.Provider, { value: locale },
      React.createElement(RecordBoard, { node, manifest, data,
        options: { editable: false, onPanelUpdate: () => assert.fail('measurement must not write facts') },
        render: () => React.createElement('div') }))))
  const measure = () => act(async () => {
    for (const observer of observers) {
      const elements = [...observer.elements].filter(element => element.classList.contains('react-flow__node'))
      if (elements.length) observer.callback(elements.map(target => ({ target, contentRect: target.getBoundingClientRect() })))
    }
  })
  const click = selector => act(async () => document.querySelector(selector).click())
  const assertMeasured = label => {
    for (const node of store.getState().nodes) {
      const internal = store.getState().nodeLookup.get(node.id)
      assert.equal(internal.measured?.width, 200, `${label}: ${node.id} width retained`)
      assert.equal(internal.measured?.height, nodeHeight, `${label}: ${node.id} height retained`)
      assert.equal(document.querySelector(`[data-id='${node.id}']`).style.visibility, 'visible', `${label}: node not stuck hidden`)
      assert.equal(internal.internals.handleBounds?.source.length, 4, `${label}: measured ports retained`)
    }
    assert.equal(document.querySelectorAll('.react-flow__edge').length, Object.keys(data.items).length, `${label}: actual edges rendered`)
  }
  try {
    await act(async () => render())
    assert.equal(document.querySelector('.dsh-workspace-cover-surface').style.visibility, 'hidden')
    await measure(); assertMeasured('measured while mounted behind cards')
    await click('.dsh-record-board-map-toggle'); assertMeasured('first reveal without another observer delivery')
    const retainedNode = document.querySelector('.react-flow__node')
    await click('.dsh-workspace-cover-return')
    await click('.dsh-record-board-map-toggle'); assertMeasured('same-size re-entry')
    assert.equal(document.querySelector('.react-flow__node'), retainedNode, 'ordinary navigation retains the canvas')
    await act(async () => render()); assertMeasured('new parent/options identities')
    data = { ...data, items: { ...data.items, a: { ...data.items.a, title: 'Renamed' } } }
    await act(async () => render()); assertMeasured('updated record projection')
    assert.match(document.querySelector('[data-id="record:a"]').textContent, /Renamed/)
    nodeHeight = 54
    await measure(); assertMeasured('resized nodes')
    locale = 'zh-CN'; await act(async () => render()); assertMeasured('locale change')
    data = { items: { a: data.items.a } }
    await act(async () => render()); assertMeasured('removed record')
    assert.equal(store.getState().nodeLookup.has('record:b'), false, 'removed record leaves no ghost node')
    const saved = structuredClone(data)
    instance++; await act(async () => render())
    await measure(); assertMeasured('new readonly instance after reopen')
    await click('.dsh-record-board-map-toggle'); assertMeasured('reopened graph reveal')
    assert.deepEqual(data, saved, 'measurement and view switches do not change canonical data')
  } finally {
    await act(async () => root.unmount())
    frames.clear(); dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('board scroll location follows long cards, the end, collapsed groups and filters without writes', async () => {
  const root = createRoot(document.getElementById('root'))
  const data = { items: {
    a: { title: 'Long first', description: 'Long', group: 'Group' },
    b: { title: 'Second', description: 'Two', group: 'Group', rejected: true },
    c: { title: 'Last', description: 'Three', group: 'Group' },
  } }
  let height = 300
  const show = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(RecordBoard, {
    node, manifest, data, options: { editable: false, onEdit() { assert.fail('navigation wrote data') }, onPanelUpdate() { assert.fail('navigation wrote data') } }, render: () => null,
  })))
  const settle = () => React.act(() => new Promise(resolve => setTimeout(resolve, 20)))
  const current = () => document.querySelector('.dsh-panel-workspace-tree-item[aria-current]')?.textContent
  try {
    await React.act(show)
    const container = document.querySelector('.dsh-record-board-content')
    container.getClientRects = () => [{ height }]
    container.getBoundingClientRect = () => ({ top: 0, bottom: height, height })
    Object.defineProperties(container, { clientHeight: { get: () => height }, scrollHeight: { get: () => 1260 } })
    container.scrollTo = ({ top }) => { container.scrollTop = top; container.dispatchEvent(new dom.window.Event('scroll')) }
    const starts = { a: 0, b: 1000, c: 1130 }, heights = { a: 1000, b: 130, c: 130 }
    for (const card of document.querySelectorAll('[data-board-record]')) {
      const id = card.dataset.boardRecord
      card.getClientRects = () => card.closest('[hidden]') ? [] : [{}]
      card.getBoundingClientRect = () => ({ top: starts[id] - container.scrollTop, bottom: starts[id] + heights[id] - container.scrollTop })
    }
    const group = document.querySelector('[data-board-group]')
    group.getBoundingClientRect = () => ({ top: -container.scrollTop })
    await React.act(async () => document.querySelector('.dsh-panel-workspace-tree-group-toggle').click())
    await settle()
    assert.equal(current(), 'Long first')
    await React.act(async () => container.scrollTo({ top: 700 }))
    await settle()
    assert.equal(current(), 'Long first', 'a tall card stays current while reading its middle')
    await React.act(async () => document.querySelector('.dsh-panel-workspace-tree-item').click())
    await settle()
    assert.equal(container.scrollTop, 0, 'clicking a partially visible tall card returns to its title')
    await React.act(async () => container.scrollTo({ top: 1001 }))
    // At a real overflow end the last visible item is the current destination.
    await settle()
    assert.equal(current(), 'Last')
    height = 150
    await React.act(async () => container.scrollTo({ top: 1001 }))
    await settle()
    assert.equal(current(), 'Second', 'away from end use the reading start, not the largest visible area')
    await React.act(async () => document.querySelector('.dsh-panel-workspace-tree-group-toggle').click())
    assert.equal(document.querySelector('.dsh-panel-workspace-tree-group-toggle').getAttribute('aria-current'), 'location')
    await React.act(async () => document.querySelector('.dsh-record-board-group-heading').click())
    await settle()
    assert.equal(document.querySelector('.dsh-panel-workspace-tree-group-toggle').hasAttribute('aria-current'), false)
    await React.act(async () => document.querySelector('.dsh-record-board-group-heading').click())
    await choose(document.querySelector('.dsh-panel-workspace-tree-actions [role="combobox"]'), 'Active')
    await settle()
    await React.act(async () => document.querySelector('.dsh-panel-workspace-tree-group-toggle').click())
    await React.act(async () => container.scrollTo({ top: 1001 }))
    await settle()
    assert.equal(current(), 'Last', 'filtered-out records never become current')
    height = 2000
    await React.act(async () => container.scrollTo({ top: 0 }))
    await settle()
    assert.equal(current(), 'Long first', 'nonoverflow content does not default to its last record')
  } finally { await React.act(() => root.unmount()) }
})

test('an onEdit-only board consumes its directly editable title once', async () => {
  const panel = { ...manifest, ui: { ...node, board: { ...node.board, overview: false } } }
  let data = { items: { a: { title: 'Current title', description: 'One line', priority: 'low', source_refs: ['keep'] } } }
  const root = createRoot(document.getElementById('root')), edits = []
  const show = () => root.render(renderManifest(panel, data, { locale: 'en-US', editable: true,
    onEdit(edit) { edits.push(edit); data = applyDesignEditToDraft(data, panel, edit); show() },
  }))
  try {
    await React.act(show)
    assert.equal(document.querySelectorAll('input[aria-label="Title"]').length, 1)
    assert.equal(document.querySelector('.dsh-record-board-editor input[aria-label="Title"]'), null, 'the consumed header title is not duplicated inside details')
    await React.act(async () => {
      const input = document.querySelector('input[aria-label="Title"]')
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Revised title')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(data.items.a.title, 'Revised title')
    assert.equal(edits.length, 1)
    assert.deepEqual(data.items.a.source_refs, ['keep'])
  } finally { await React.act(() => root.unmount()) }
})
