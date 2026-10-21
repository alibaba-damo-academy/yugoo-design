import test from 'node:test'
import assert from 'node:assert/strict'
import { installSelectDom, chooseSelectValue } from './select-interaction.mjs'

const { register } = await import('tsx/esm/api')
register()

const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'https://panel.test/',
})
for (const key of [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event',
  'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  'MutationObserver', 'CustomEvent',
]) {
  if (globalThis[key] === undefined) globalThis[key] = dom.window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
installSelectDom(dom.window)

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const {
  StandardQuestionList,
  StandardQuestionWorkspace,
  standardQuestionAnswered,
  standardQuestionSummary,
  inferredQuestionGroups,
} = await import('../src/question-list.tsx')
const { prepareDeclarativePanelSave } = await import('../src/client/native-panel-registry.ts')
const { DECLARATIVE_PANEL_ARTIFACTS_KEY } = await import('../src/question-attachments.tsx')
const { PANEL_TEXT_ARTIFACTS_KEY, stageTextArtifact, discardTextArtifactRecordEdits } = await import('../src/text-artifact-edit.ts')
const { previewFromArtifact } = await import('../src/question-attachments.tsx')
const { readFile } = await import('node:fs/promises')
const { parsePanelManifest, validatePanelManifest } = await import('../../core/src/panel-dsl.ts')
const { applyDeclarativePanelTransaction, declarativePanelOwnsWorkspace, appendDeclarativeAttachments } = await import('../src/client/panels/dsl-panel.tsx')
const { TokenList } = await import('../src/token-list.tsx')
const { CustomChoice } = await import('../src/custom-choice.tsx')
const { RecordMap } = await import('../src/record-map.tsx')
const { SourceReferences } = await import('../src/source-reference.tsx')
const { renderManifest, applyPanelUpdatesToDraft } = await import('../src/interpreter.ts')
const {
  PanelWorkspace,
  PanelWorkspaceTree,
  PanelWorkspaceTreeGroup,
  PanelWorkspaceTreeItem,
} = await import('../src/panel-workspace.tsx')

test('declarative text artifact deletion restores net state without losing sibling edits', async () => {
  const manifest = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/whiteboard/panel.yaml', import.meta.url), 'utf8'))
  const base = { boards: { kept: { id: 'kept', title: 'Kept', artifact_file: 'whiteboard/boards/kept.json' } }, board_order: ['kept'] }
  const binding = { recordsPath: 'boards', record: 'temporary', field: 'artifact_file' }
  const added = stageTextArtifact(applyPanelUpdatesToDraft(base, {
    boards: { ...base.boards, temporary: { id: 'temporary', title: 'Temporary', artifact_file: 'whiteboard/boards/temporary.json' } },
    board_order: ['kept', 'temporary'],
  }), 'whiteboard', { binding, path: 'whiteboard/boards/temporary.json', baseVersion: 'new', content: '{}' })
  const remove = draft => applyDeclarativePanelTransaction(draft, manifest, [], {
    boards: base.boards, board_order: base.board_order,
    [PANEL_TEXT_ARTIFACTS_KEY]: discardTextArtifactRecordEdits(draft[PANEL_TEXT_ARTIFACTS_KEY], 'boards', 'temporary'),
  })
  assert.deepEqual(remove(added), base)
  assert.equal(JSON.stringify(remove(added)), JSON.stringify(base), 'live store equality returns to clean')
  const sibling = { binding: { ...binding, record: 'kept' }, path: base.boards.kept.artifact_file, content: '{"edited":true}' }
  const withSibling = { ...added, [PANEL_TEXT_ARTIFACTS_KEY]: [...added[PANEL_TEXT_ARTIFACTS_KEY], sibling] }
  assert.deepEqual(remove(withSibling)[PANEL_TEXT_ARTIFACTS_KEY], [sibling])
  assert.notEqual(JSON.stringify(remove(withSibling)), JSON.stringify(base))
  assert.equal(remove({ ...added, [PANEL_TEXT_ARTIFACTS_KEY]: 'invalid' })[PANEL_TEXT_ARTIFACTS_KEY], 'invalid')
  assert.equal(added[PANEL_TEXT_ARTIFACTS_KEY].length, 1, 'prior draft stays unchanged')
})

test('nested records add and remove identity/order together, preserving sibling data and readonly state', async () => {
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  const field = { key: 'children', control: 'record_map', label: 'Children', row_name: 'Child', id_field: 'id', order_field: 'order', max_rows: 2,
    columns: [{ key: 'name', label: 'Name', control: 'text', format: 'upper_identifier' }] }
  let record = { children: { old: { id: 'old', name: 'FIRST', keep: true } }, order: ['old'], title: 'Parent' }
  const stylesheet = document.createElement('style')
  stylesheet.textContent = await readFile(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  document.head.append(stylesheet)
  const render = editable => root.render(React.createElement('div', { className: 'dsh-design-panel' },
    React.createElement(RecordMap, { field, record, editable, onPatch: patch => { record = { ...record, ...patch } } })))
  await React.act(async () => render(true))
  await React.act(async () => [...container.querySelectorAll('button')].find(button => button.textContent.includes('添加')).click())
  const id = record.order[1]
  assert.equal(record.children[id].id, id)
  assert.equal(record.children.old.keep, true)
  assert.equal(record.title, 'Parent')
  await React.act(async () => render(true))
  const add = [...container.querySelectorAll('button')].find(button => button.textContent.includes('添加'))
  assert.equal(add.disabled, true)
  assert.ok(add.querySelector('svg[aria-hidden="true"]'))
  assert.equal(window.getComputedStyle(add).height, '28px')
  assert.equal(window.getComputedStyle(add).fontSize, '12px', 'native small ghost auxiliary action')
  const remove = container.querySelector('[data-child-record="old"] button[aria-label^="删除"]')
  assert.ok(remove.querySelector('svg.lucide-trash-2[aria-hidden="true"]'))
  assert.equal(window.getComputedStyle(remove).height, '32px')
  assert.equal(window.getComputedStyle(remove).borderTopWidth, '0px')
  const up = () => container.querySelector(`[data-child-record="${id}"] button[aria-label^="上移"]`)
  assert.ok(up().querySelector('svg.lucide-arrow-up'))
  assert.equal(container.querySelector('[data-child-record="old"] button[aria-label^="上移"]').disabled, true)
  await React.act(async () => up().click())
  assert.deepEqual(record.order, [id, 'old'])
  await React.act(async () => render(true))
  assert.equal(up().disabled, true)
  await React.act(async () => container.querySelector(`[data-child-record="${id}"] button[aria-label^="下移"]`).click())
  assert.deepEqual(record.order, ['old', id])
  await React.act(async () => render(true))
  const input = container.querySelectorAll('input')[1]
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'api-key')
  await React.act(async () => input.dispatchEvent(new dom.window.Event('input', { bubbles: true })))
  assert.equal(record.children[id].name, 'API_KEY')
  await React.act(async () => render(true))
  await React.act(async () => container.querySelector('[data-child-record="old"] button[aria-label^="删除"]').click())
  assert.deepEqual(record.order, [id]); assert.equal(record.children.old, undefined)
  await React.act(async () => render(false))
  assert.equal(container.querySelector('input,button'), null)
  record = { ...record, children: { malformed: null } }
  await React.act(async () => render(true))
  assert.ok(container.querySelector('[role=alert]')); assert.equal(container.querySelector('button'), null)
  await React.act(async () => root.unmount())
  stylesheet.remove()
})

test('typed nested records reuse conditional controls, preserve opaque ids, reorder and respect readonly', async () => {
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'parents', title: 'Parents', add_mode: 'none' }],
    fields: [{ key: 'fields', control: 'record_map', label: 'Information', row_name: 'Field', applies_to: ['parents'],
      id_field: 'id', order_field: 'order', item_label_field: 'name', item_defaults: { name: '', requirement: 'optional' },
      item_fields: [{ key: 'name', control: 'text', label: 'Name' },
        { key: 'requirement', control: 'select', label: 'Requirement', options: [{ value: 'optional', label: 'Optional' }, { value: 'conditional', label: 'Conditional' }] },
        { key: 'required_when', control: 'textarea', label: 'Required when', visible_when: { field: 'requirement', in: ['conditional'] }, clear_when_hidden: true },
        { key: 'options', control: 'token_list', label: 'Choices' },
        { key: 'locked', control: 'text', label: 'Locked', readonly: true }] }],
    ui: { id: 'form', component: 'record_form', source: 'parents' } }
  assert.deepEqual(validatePanelManifest(manifest), [])
  let data = { parents: { parent: { title: 'Keep parent', fields: { 'field.with.dots': { id: 'field.with.dots', name: 'Duration', requirement: 'conditional', required_when: 'Only after approval', options: ['Saved'], locked: 'Keep', extra: 17 }, other: { id: 'other', name: 'Other' } }, order: ['field.with.dots', 'other'] } } }
  const original = structuredClone(data)
  const show = editable => root.render(renderManifest(manifest, data, { editable, locale: 'en-US', onPanelUpdate: updates => { data = applyPanelUpdatesToDraft(data, updates) } }))
  await React.act(async () => show(true))
  const child = () => container.querySelector('[data-child-record="field.with.dots"]')
  assert.equal(child().querySelector('[data-field=locked] input'), null)
  const requirement = child().querySelector('[role="combobox"]')
  await chooseSelectValue(React, requirement, 'optional')
  assert.equal(data.parents.parent.fields['field.with.dots'].required_when, '')
  assert.deepEqual(data.parents.parent.fields['field.with.dots'].options, ['Saved'])
  assert.equal(data.parents.parent.fields['field.with.dots'].extra, 17)
  await React.act(async () => show(true))
  assert.equal(child().querySelector('textarea'), null)
  await React.act(async () => child().querySelector('button[aria-label="Move down 1"]').click())
  assert.deepEqual(data.parents.parent.order, ['other', 'field.with.dots'])
  assert.equal(data.parents.parent.fields['field.with.dots'].id, 'field.with.dots')
  await React.act(async () => show(true))
  const addField = container.querySelector('button[aria-label="Add Field"]')
  assert.equal(addField.textContent, 'Add')
  await React.act(async () => addField.click())
  const added = data.parents.parent.order[2]
  assert.deepEqual(data.parents.parent.fields[added], { id: added, name: '', requirement: 'optional' })
  assert.equal(data.parents.parent.title, 'Keep parent')
  await React.act(async () => show(false))
  assert.equal(container.querySelector('input,select,textarea,button'), null)
  assert.deepEqual(original.parents.parent.order, ['field.with.dots', 'other'])
  assert.equal(original.parents.parent.fields['field.with.dots'].required_when, 'Only after approval')
  await React.act(async () => root.unmount())
})

test('map-key-only records do not invent id or order fields', async () => {
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  let patch
  await React.act(async () => root.render(React.createElement(RecordMap, { field: { key: 'behaviors', control: 'record_map', columns: [{ key: 'description', label: 'Description', control: 'textarea' }] },
    record: { behaviors: { original: { description: 'Retained' } } }, editable: true, onPatch: value => { patch = value } })))
  await React.act(async () => [...container.querySelectorAll('button')].find(button => button.textContent.includes('添加')).click())
  assert.deepEqual(Object.keys(patch), ['behaviors'])
  assert.deepEqual(patch.behaviors.original, { description: 'Retained' })
  const newId = Object.keys(patch.behaviors).find(id => id !== 'original')
  assert.deepEqual(patch.behaviors[newId], { description: '' })
  await React.act(async () => root.unmount())
})

test('source cards read only on demand, pin revisions and escape source content', async () => {
  const container = dom.window.document.getElementById('root'), root = createRoot(container), reads = []
  const value = { r: { file: 'questions/state.json', revision: 'a'.repeat(40), pointer: '/answer', note: 'Evidence' } }
  await React.act(async () => root.render(React.createElement(SourceReferences, { value, options: { sourceRevision: 'b'.repeat(40), readArtifact: async (path, revision) => {
    reads.push([path, revision]); return { found: true, content: JSON.stringify({ answer: revision[0] === 'a' ? '<script>not executable</script>' : 'Updated' }) }
  } } })))
  assert.equal(reads.length, 0)
  await React.act(async () => { const detail = container.querySelector('details'); detail.open = true; detail.dispatchEvent(new dom.window.Event('toggle')) })
  assert.ok(reads.some(([, revision]) => revision === 'a'.repeat(40)))
  assert.ok(reads.some(([, revision]) => revision === 'b'.repeat(40)))
  assert.match(container.textContent, /当前来源已变化/)
  assert.match(container.textContent, /<script>not executable<\/script>/)
  assert.equal(container.querySelector('script'), null)
  await React.act(async () => root.unmount())
})

test('official question manifest declares its policy; malformed policies fail closed', async () => {
  const manifest = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/smart_questions/panel.yaml', import.meta.url), 'utf8'))
  assert.deepEqual(validatePanelManifest(manifest), [])
  assert.equal(manifest.ui.question_policy.history_readonly, true)
  for (const mutate of [
    value => { value.ui.question_policy = null },
    value => { value.ui.question_policy = [] },
    value => { value.ui.question_policy.history_readonly = 'true' },
    value => { value.ui.question_policy.first_round_ids = ['same', 'same'] },
    value => { value.ui.question_policy.first_round_ids = ['__proto__'] },
    value => { value.ui.question_policy.protected_ids = ['constructor'] },
    value => { value.ui.question_policy.unknown = true },
    value => { value.ui.component = 'question_list' },
    value => { value.fields = value.fields.filter(field => field.key !== 'rejected') },
  ]) {
    const invalid = structuredClone(manifest)
    mutate(invalid)
    assert.ok(validatePanelManifest(invalid).length > 0)
  }
})

test('preset tokens retain stored values, remove precisely and refuse invalid or read-only editing', async () => {
  const container = dom.window.document.getElementById('root'), root = createRoot(container), changes = []
  const props = { label: 'Channels', value: ['internal', 'custom'], options: [{ value: 'internal', label: 'In app' }], editable: true, onChange: value => changes.push(value) }
  await React.act(async () => root.render(React.createElement(TokenList, props)))
  assert.ok(container.textContent.includes('In app'))
  const remove = container.querySelector('.dsh-token-item button')
  await React.act(async () => remove.click())
  assert.deepEqual(changes, [['custom']])
  await React.act(async () => root.render(React.createElement(TokenList, { ...props, editable: false })))
  assert.equal(container.querySelector('input,select,button'), null)
  await React.act(async () => root.render(React.createElement(TokenList, { ...props, value: [42] })))
  assert.ok(container.querySelector('[role=alert]'))
  assert.equal(container.querySelector('input,select,button'), null)
  await React.act(async () => root.unmount())
})

test('uploads append to the latest draft across questions and never recreate a deleted record', () => {
  const manifest = { sections: [{ id: 'questions' }] }
  const addition = (id, name) => ({ ref: { filename: name, file_md5: name, type: 'file' }, pending: { path: `test/${name}`, question_id: id, filename: name, file_md5: name, content: 'eA==', encoding: 'base64' } })
  let draft = { questions: { a: { answer: 'A' }, b: { answer: 'B' } } }
  draft = appendDeclarativeAttachments(draft, manifest, 'questions', 'b', [addition('b', 'second')])
  draft.questions.a.answer = 'Edited while uploading'
  draft = appendDeclarativeAttachments(draft, manifest, 'questions', 'a', [addition('a', 'first')])
  assert.equal(draft.questions.a.answer, 'Edited while uploading')
  assert.equal(draft.questions.b.multimodal_answer[0].filename, 'second')
  assert.equal(draft[DECLARATIVE_PANEL_ARTIFACTS_KEY].length, 2)
  draft = appendDeclarativeAttachments(draft, manifest, 'questions', 'a', [addition('a', 'first')])
  assert.equal(draft.questions.a.multimodal_answer.length, 1)
  assert.equal(draft[DECLARATIVE_PANEL_ARTIFACTS_KEY].length, 2)
  const before = structuredClone(draft)
  assert.throws(() => appendDeclarativeAttachments(draft, manifest, 'questions', 'a', Array.from({ length: 5 }, (_, i) => addition('a', `extra${i}`))), /最多/)
  assert.deepEqual(draft, before)
  delete draft.questions.a
  assert.throws(() => appendDeclarativeAttachments(draft, manifest, 'questions', 'a', [addition('a', 'late')]), /移除/)
  assert.equal(draft.questions.a, undefined)
})

test('custom choice writes the preset value rather than its translated label, supports an empty custom mode', async () => {
  const container = dom.window.document.getElementById('root'), root = createRoot(container), changes = []
  const props = { value: '', label: 'Assignment', options: [{ value: 'canonical-value', label: 'Translated label' }], editable: true, onChange: value => changes.push(value) }
  await React.act(async () => root.render(React.createElement(CustomChoice, props)))
  await React.act(async () => container.querySelectorAll('input[type=radio]')[1].click())
  assert.ok(container.querySelector('input:not([type=radio])'))
  assert.deepEqual(changes, [])
  await React.act(async () => container.querySelector('input[type=radio]').click())
  assert.deepEqual(changes, ['canonical-value'])
  await React.act(async () => root.render(React.createElement(CustomChoice, { ...props, value: 'Existing custom rule', editable: false })))
  assert.ok(container.textContent.includes('Existing custom rule'))
  assert.equal(container.querySelector('input'), null)
  await React.act(async () => root.unmount())
})

test('record text controls follow refreshed values without remounting and honor readonly fields', async () => {
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'items', title: 'Items', add_mode: 'none' }], fields: [
    { key: 'title', control: 'text', applies_to: ['items'] }, { key: 'body', control: 'textarea', applies_to: ['items'] },
    { key: 'locked', control: 'text', readonly: true, applies_to: ['items'] },
  ], ui: { component: 'record_form', id: 'form', source: 'items' } }
  const show = value => root.render(renderManifest(manifest, { items: { sameId: { title: value, body: value, locked: value } } }, { editable: true, onPanelUpdate: () => {} }))
  await React.act(async () => show('old'))
  await React.act(async () => show('new'))
  assert.equal(container.querySelector('[data-field=title] input').value, 'new')
  assert.equal(container.querySelector('[data-field=body] textarea').value, 'new')
  assert.equal(container.querySelector('[data-field=locked] input'), null)
  assert.ok(container.querySelector('[data-field=locked]').textContent.includes('new'))
  await React.act(async () => root.unmount())
})

test('related editor filters without rewriting siblings and binds new records to the current parent', async () => {
  const container = dom.window.document.getElementById('root'), root = createRoot(container), updates = []
  const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [
    { id: 'parents', title: 'Parents', add_mode: 'none' },
    { id: 'children', title: 'Children', item_name: 'Child', navigation: 'contextual', add_mode: 'context', order: 'order', create: { id_field: 'id', defaults: { title: '' } } },
  ], fields: [
    { key: 'title', label: 'Title', control: 'text', applies_to: ['parents', 'children'] },
    { key: 'parent_ref', control: 'record_select', options_from_section: 'parents', readonly: true, applies_to: ['children'] },
  ], ui: { component: 'record_workspace', id: 'workspace', sources: ['parents', 'children'], children: [
    { component: 'record_inspector', id: 'editor', children: [
      { component: 'record_related_editor', id: 'related', source: 'children', bindings: { reference: 'parent_ref' }, title: 'Owned records' },
    ] },
  ] } }
  const data = { parents: { a: { title: 'A' }, b: { title: 'B' } }, children: { x: { title: 'Child A', parent_ref: 'a' }, y: { title: 'Child B', parent_ref: 'b' } }, order: ['y', 'x'] }
  await React.act(async () => root.render(renderManifest(manifest, data, { editable: true, locale: 'en-US', onPanelUpdate: value => updates.push(value) })))
  const editor = container.querySelector('.dsh-record-related-editor')
  assert.ok(editor.querySelector('[data-record=x]'))
  assert.equal(editor.querySelector('[data-record=y]'), null)
  assert.equal(editor.querySelector('[data-field=parent_ref] select'), null)
  const add = editor.querySelector('.dsh-record-related-add')
  assert.equal(editor.querySelector('header button'), null, 'adding belongs to the collection tail, not the title row')
  assert.equal(editor.lastElementChild, add)
  assert.equal(add.textContent, 'Add')
  assert.equal(add.getAttribute('aria-label'), 'Add Child')
  assert.equal(add.getAttribute('title'), 'Add Child')
  assert.ok(add.querySelector('svg'))
  await React.act(async () => add.click())
  assert.equal(updates.length, 1)
  const added = Object.keys(updates[0].children).find(key => !['x', 'y'].includes(key))
  assert.equal(updates[0].children[added].parent_ref, 'a')
  assert.equal(updates[0].children[added].id, added)
  assert.deepEqual(updates[0].children.y, data.children.y)
  assert.deepEqual(updates[0].order, ['y', 'x', added])
  await React.act(async () => root.unmount())
})

test('only a full workspace root escapes the legacy padded document body', () => {
  const base = { version: 1, panel_kind: 'evidence_workbook', sections: [], fields: [] }
  assert.equal(declarativePanelOwnsWorkspace({ ...base, ui: { component: 'question_workspace', id: 'questions' } }), true)
  assert.equal(declarativePanelOwnsWorkspace({ ...base, ui: { component: 'record_workspace', id: 'records' } }), true)
  assert.equal(declarativePanelOwnsWorkspace({ ...base, ui: { component: 'stack', id: 'root', children: [{ component: 'question_workspace', id: 'questions' }] } }), true)
  assert.equal(declarativePanelOwnsWorkspace({ ...base, ui: { component: 'stack', id: 'root', children: [{ component: 'question_list', id: 'questions' }, { component: 'record_form', id: 'details' }] } }), false)
  const views = { component: 'tabs', id: 'views', children: [
    { component: 'question_workspace', id: 'questions' },
    { component: 'record_workspace', id: 'goals' },
  ] }
  assert.equal(declarativePanelOwnsWorkspace({ ...base, ui: views }), true)
  assert.equal(declarativePanelOwnsWorkspace({ ...base, ui: { component: 'stack', id: 'root', children: [views] } }), true)
  assert.equal(declarativePanelOwnsWorkspace({ ...base, ui: { ...views, children: [] } }), false)
  assert.equal(declarativePanelOwnsWorkspace({ ...base, ui: { ...views, children: [views.children[0], { component: 'record_form', id: 'form' }] } }), false)
})

test('declared question policy preserves first-round cards and read-only history, then follows a new round', async () => {
  const questions = [
    { id: 'fixed', prompt: '基础设置', kind: 'text', answer: '保留' },
    { id: 'old', prompt: '历史问题', kind: 'text', answer: '旧回答', round: 3 },
    { id: 'latest', prompt: '本轮问题', kind: 'text', answer: '', round: 7 },
  ]
  const groups = inferredQuestionGroups(questions, ['fixed'], true)
  assert.deepEqual(groups.map(g => [g.label, g.questionIds]), [['第 2 轮', ['latest']], ['第 1 轮', ['old', 'fixed']]])
  const container = dom.window.document.getElementById('root')
  const root = createRoot(container)
  const changes = []
  const props = { editable: true, firstRoundIds: ['fixed'], protectedQuestionIds: ['fixed'], numberedRounds: true,
    historyReadonly: true, onRejectedChange: (id, value) => changes.push([id, value]) }
  await React.act(async () => root.render(React.createElement(StandardQuestionWorkspace, { ...props, questions })))
  assert.ok(container.querySelector('[data-question-id=latest] textarea'))
  const skip = [...container.querySelectorAll('button')].find(button => button.textContent === '跳过问题')
  await React.act(async () => skip.click())
  assert.deepEqual(changes, [['latest', true]])
  const history = [...container.querySelectorAll('button')].find(button => button.textContent.includes('第 1 轮'))
  await React.act(async () => history.click())
  assert.ok(container.querySelector('[data-question-id=fixed]'))
  assert.equal(container.querySelectorAll('textarea, [data-testid=standard-question-edit]').length, 0)
  await React.act(async () => root.render(React.createElement(StandardQuestionWorkspace, { ...props,
    questions: [...questions, { id: 'new', prompt: '新一轮', kind: 'text', answer: '', round: 11 }] })))
  assert.ok(container.querySelector('[data-question-id=new] textarea'))
  assert.equal(container.querySelector('[data-question-id=old]'), null)
  await React.act(async () => root.unmount())
})

test('legacy attachment preview resolves inside the owning Bundle without rewriting its reference', async () => {
  const attachment = { type: 'image', file_md5: 'a'.repeat(32), filename: 'old.png', mime_type: 'image/png', size_bytes: 3 }
  let requested
  const result = await previewFromArtifact(attachment, [], async path => {
    requested = path
    return { found: true, mediaType: 'image/png', base64: 'YWJj', byteLength: 3 }
  }, 'example_questions')
  assert.equal(requested, `example_questions/attachments/${'a'.repeat(32)}.png`)
  assert.equal(result, 'data:image/png;base64,YWJj')
  assert.equal(attachment.artifact_file, undefined)
  assert.equal(await previewFromArtifact(attachment, [], async () => { throw Error('must not read') }, '../foreign'), undefined)
})

test('save echo collapses an answered card without collapsing during local typing', async () => {
  const container = dom.window.document.getElementById('root')
  const root = createRoot(container)
  const initial = {}
  const render = (answer, collapseToken) => root.render(React.createElement(StandardQuestionList, {
    questions: [{ id: 'answer', prompt: '问题', kind: 'text', answer }], editable: true, collapseToken,
  }))
  await React.act(async () => render('', initial))
  await React.act(async () => render('已填写', initial))
  assert.ok(container.querySelector('textarea'))
  await React.act(async () => render('已填写', {}))
  assert.equal(container.querySelector('textarea'), null)
  assert.ok(container.textContent.includes('已填写'))
  await React.act(async () => root.unmount())
})

test('declarative fixed recommendation badges preserve dynamic recommendations and answers', async () => {
  const container = dom.window.document.getElementById('root')
  const root = createRoot(container)
  const manifest = { sections: [{ id: 'questions', title: 'Questions' }], fields: [],
    ui: { component: 'question_list', id: 'questions', source: 'questions' } }
  const choices = [{ value: 'keep', label: '保留', recommended: true }, { value: 'other', label: '其他' }]
  const data = { questions: {
    const_single: { prompt: '固定单选', kind: 'single', answer: '', choices },
    const_multiple: { prompt: '固定多选', kind: 'multiple', answer: '', choices },
    dynamic: { prompt: '动态单选', kind: 'single', answer: '', choices },
  } }
  const edits = []
  await React.act(async () => root.render(renderManifest(manifest, data, { editable: true, onEdit: edit => edits.push(edit) })))
  for (const id of ['const_single', 'const_multiple', 'dynamic']) {
    const card = container.querySelector(`[data-question-id="${id}"]`)
    const badge = card.querySelector('.dsh-standard-question-recommended')
    assert.equal(badge.textContent, '推荐')
    assert.equal(badge.classList.contains('is-fixed'), id !== 'dynamic')
    assert.match(card.textContent, /保留/)
    await React.act(async () => card.querySelector('input').click())
  }
  assert.deepEqual(edits.map(edit => [edit.record, edit.value]), [['const_single', 'keep'], ['const_multiple', 'keep'], ['dynamic', 'keep']])
  assert.equal(data.questions.dynamic.choices[0].recommended, true)
  await React.act(async () => root.unmount())
})

test('text supplements stay readonly inside the answer shell and preserve collapsed content', async () => {
  const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
  const container = dom.window.document.getElementById('root')
  const root = createRoot(container)
  const changes = []
  const question = { id: 'text', prompt: '说明', kind: 'text', answer: '答案', detail: '第一行\n第二行' }
  const show = (editable, detail = question.detail) => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' },
    React.createElement(StandardQuestionList, { questions: [{ ...question, detail }], editable, collapseAnswered: false,
      onDetailChange: (...args) => changes.push(args) })))
  await React.act(async () => show(true))
  const shell = container.querySelector('.dsh-standard-question-answer-shell')
  const context = shell.querySelector('[data-testid=standard-question-context]')
  assert.equal(context.querySelector('span').textContent, 'Other additions')
  assert.equal(context.querySelector('.dsh-standard-question-answer-info').textContent, question.detail)
  assert.equal(context.querySelector('input,textarea,[contenteditable=true]'), null)
  assert.equal(shell.querySelectorAll('textarea').length, 1)
  assert.equal(container.querySelector('[data-testid=standard-question-detail]'), null)
  await React.act(async () => show(false))
  assert.equal(container.querySelector('.dsh-standard-question-answer-shell'), null)
  assert.equal(container.querySelector('.dsh-standard-question-result .dsh-standard-question-answer-info').textContent, question.detail)
  assert.equal(container.querySelector('input,textarea'), null)
  await React.act(async () => show(false, '  '))
  assert.equal(container.querySelector('[data-testid=standard-question-context]'), null)
  assert.deepEqual(changes, [])
  assert.equal(question.detail, '第一行\n第二行')
  await React.act(async () => root.unmount())
})

test('standard question list renders shared text, single and multiple interactions', async () => {
  const changes = []
  const detailChanges = []
  const questions = [
    { id: 'audience', prompt: '主要服务谁？', kind: 'text', answer: '课题组研究人员', detail: '第一版先面向个人。' },
    {
      id: 'boundary', prompt: '自动执行到哪一步？', kind: 'single', answer: '', detail: '',
      choices: [
        { value: 'proposal', label: '提出计划，由人确认', recommended: true },
        { value: 'automatic', label: '自动执行' },
      ],
    },
    {
      id: 'outputs', prompt: '需要哪些输出？', kind: 'multiple', answer: ['evidence'], detail: '',
      choices: [
        { value: 'evidence', label: '文献证据' },
        { value: 'plan', label: '研究计划' },
      ],
    },
  ]
  assert.equal(standardQuestionAnswered(questions[0]), true)
  assert.equal(standardQuestionAnswered(questions[1]), false)
  assert.equal(standardQuestionAnswered({ ...questions[1], detail: '仍未回答，只记录背景。' }), false)
  assert.equal(standardQuestionSummary({ id: 'punctuation', prompt: '说明', kind: 'text', answer: '甲，乙,丙' }), '甲，乙,丙')
  assert.equal(standardQuestionSummary(questions[2]), '文献证据')

  const container = dom.window.document.getElementById('root')
  const root = createRoot(container)
  await React.act(async () => {
    root.render(React.createElement(StandardQuestionList, {
      questions,
      editable: true,
      onAnswerChange: (id, answer) => changes.push([id, answer]),
      onDetailChange: (id, detail) => detailChanges.push([id, detail]),
    }))
  })

  assert.equal(container.querySelectorAll('.dsh-standard-question-card').length, 3)
  assert.equal(container.querySelector('[data-question-id="audience"] [data-testid="standard-question-edit"]')?.textContent, '编辑')
  assert.equal(container.querySelector('[data-question-id="boundary"] .dsh-standard-question-recommended')?.textContent, '推荐')

  const boundaryRadio = container.querySelector('[data-question-id="boundary"] input[value="proposal"]')
    ?? container.querySelector('[data-question-id="boundary"] input[type="radio"]')
  await React.act(async () => { boundaryRadio.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.deepEqual(changes[0], ['boundary', 'proposal'])

  await React.act(async () => {
    container.querySelector('[data-question-id="outputs"] [data-testid="standard-question-edit"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  const planCheckbox = [...container.querySelectorAll('[data-question-id="outputs"] input[type="checkbox"]')][1]
  await React.act(async () => { planCheckbox.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.deepEqual(changes[1], ['outputs', ['evidence', 'plan']])

  await React.act(async () => {
    container.querySelector('[data-question-id="audience"] [data-testid="standard-question-edit"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(container.querySelectorAll('[data-question-id="audience"] textarea').length, 1)
  assert.match(container.querySelector('[data-question-id="audience"] [data-testid="standard-question-context"]')?.textContent ?? '', /第一版先面向个人。/)
  const detail = container.querySelector('[data-question-id="boundary"] [data-testid="standard-question-detail"]')
  assert.equal(detail.tagName, 'INPUT')
  assert.equal(detail.type, 'text')
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(detail, '新的补充说明')
  await React.act(async () => { detail.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.deepEqual(detailChanges, [['boundary', '新的补充说明']])

  await React.act(async () => { root.unmount() })
})

test('provider-declared answered questions do not show an unanswered placeholder without a text answer', async () => {
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const root = createRoot(container)
  await React.act(async () => {
    root.render(React.createElement(StandardQuestionList, {
      questions: [
        { id: 'detail-only', prompt: '补充背景', kind: 'text', answer: '', detail: '先记录边界。', answered: true },
        { id: 'attachment-only', prompt: '上传参考', kind: 'text', answer: '', detail: '', answered: true },
        { id: 'whitespace-only', prompt: '尚未回答', kind: 'text', answer: '   ', detail: '' },
      ],
      editable: false,
      renderAccessory: (question) => question.id === 'attachment-only'
        ? React.createElement('span', { 'data-testid': 'attachment' }, 'reference.webp')
        : null,
    }))
  })

  assert.equal(container.querySelector('[data-question-id="detail-only"] .is-empty'), null)
  assert.equal(container.querySelector('[data-question-id="attachment-only"] .is-empty'), null)
  assert.equal(container.querySelector('[data-question-id="whitespace-only"] .is-empty')?.textContent, '未回答')
  assert.match(container.textContent, /先记录边界。/)
  assert.match(container.textContent, /reference\.webp/)
  assert.equal(container.querySelectorAll('[data-answered="true"]').length, 2)

  await React.act(async () => { root.unmount() })
  container.remove()
})

test('question workspace provides round navigation and keeps one selected batch in the main pane', async () => {
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const root = createRoot(container)
  const questions = [
    { id: 'current', prompt: '当前问题', kind: 'text', answer: '', round: 2 },
    { id: 'history', prompt: '历史问题', kind: 'text', answer: '已回答', round: 1 },
  ]
  await React.act(async () => {
    root.render(React.createElement(StandardQuestionWorkspace, { questions, editable: true, title: '问题轮次', description: '先回答当前必要的问题。' }))
  })
  assert.equal(container.querySelectorAll('.dsh-panel-workspace-sidebar').length, 1)
  assert.equal(container.querySelector('.dsh-panel-workspace-sidebar')?.textContent?.includes('先回答当前必要的问题。'), false)
  assert.equal(container.querySelector('.dsh-panel-workspace-tip')?.textContent, '先回答当前必要的问题。')
  assert.equal(container.querySelectorAll('.dsh-standard-question-card').length, 1)
  assert.match(container.textContent, /当前问题/)
  const historyButton = [...container.querySelectorAll('.dsh-panel-workspace-nav-items button')][1]
  await React.act(async () => { historyButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(container.querySelector('[data-question-id="history"]') !== null, true)
  assert.equal(container.querySelector('[data-question-id="current"]'), null)
  await React.act(async () => { root.unmount() })
  container.remove()
})

test('question rounds separate authored titles and descriptions without changing canonical introductions', async () => {
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const root = createRoot(container)
  const introduction = '  确认本轮业务目标  \r\n完整说明：这里保留用户原有事实，不生成新的摘要。'
  const singleLine = '没有既有分隔的长标题保持原文，不按任意字数改写用户事实。'
  const questions = [{ id: 'current', prompt: '实际问题', kind: 'text', answer: '', round: 1 }]
  const before = JSON.stringify(questions)
  const writes = []
  const show = title => root.render(React.createElement(StandardQuestionWorkspace, {
    questions, editable: true, onAnswerChange: (...args) => writes.push(args),
    groups: [{ id: 'round', label: '本轮确认', title, current: true, questionIds: ['current'] }],
  }))
  try {
    await React.act(async () => { show(introduction) })
    const heading = () => container.querySelector('.dsh-question-workspace-header h2')?.textContent
    const description = () => container.querySelector('.dsh-question-workspace-header p')?.textContent
    const navigation = () => container.querySelector('.dsh-panel-workspace-nav-label')?.textContent
    assert.equal(navigation(), '确认本轮业务目标')
    assert.equal(container.querySelector('.dsh-panel-workspace-nav-eyebrow').textContent, '本轮确认')
    assert.equal(heading(), '确认本轮业务目标')
    assert.equal(description(), '完整说明：这里保留用户原有事实，不生成新的摘要。')
    assert.equal(container.querySelector('.dsh-panel-workspace-nav-description'), null)
    assert.equal(container.querySelector('.dsh-panel-workspace-nav-footer'), null)
    const sample = '合成预览示例：整理个人阅读材料时，你最希望先解决什么问题？以下选项仅演示交互，不代表用户需求。'
    await React.act(async () => { show(sample) })
    assert.equal(navigation(), '合成预览示例')
    assert.equal(heading(), '合成预览示例')
    assert.equal(description(), sample.slice(sample.indexOf('：') + 1))
    await React.act(async () => { show('Review: Keep evidence: do not invent requirements.') })
    assert.equal(heading(), 'Review')
    assert.equal(description(), 'Keep evidence: do not invent requirements.', 'only the first colon separates the title')
    await React.act(async () => { show(singleLine) })
    assert.equal(navigation(), singleLine)
    assert.equal(heading(), singleLine)
    assert.equal(description(), undefined, 'a title without a description is not repeated')
    await React.act(async () => { show('仅标题：') })
    assert.equal(heading(), '仅标题')
    assert.equal(description(), undefined)
    await React.act(async () => { show('：没有轮次标题的原文') })
    assert.equal(heading(), '：没有轮次标题的原文', 'an empty title does not hide authored text')
    await React.act(async () => { show('  ') })
    assert.equal(heading(), '本轮确认')
    assert.equal(navigation(), '本轮确认')
    assert.equal(container.querySelector('.dsh-panel-workspace-nav-eyebrow'), null, 'missing title leaves one readable round label')
    assert.deepEqual(writes, [], 'selection/display never writes the introduction or an answer')
    assert.equal(JSON.stringify(questions), before, 'display shortening does not mutate canonical facts')
  } finally { await React.act(async () => { root.unmount() }); container.remove() }
})

test('shared workspace exposes a resizable separator and collapsible record tree', async () => {
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const root = createRoot(container)
  const Tree = () => {
    const [expanded, setExpanded] = React.useState(true)
    return React.createElement(PanelWorkspace, {
      autoSaveId: 'tree-test',
      sidebar: React.createElement(PanelWorkspaceTree, { title: '模型结构' },
        React.createElement(PanelWorkspaceTreeGroup, {
          label: '业务对象', expanded, onToggle: () => setExpanded(value => !value),
        }, React.createElement(PanelWorkspaceTreeItem, { selected: true, onSelect: () => {} }, '人员'))),
    }, React.createElement('div', null, '内容'))
  }
  await React.act(async () => { root.render(React.createElement(Tree)) })
  const separator = container.querySelector('[role="separator"]')
  assert.equal(separator?.getAttribute('aria-valuenow'), '220')
  await React.act(async () => { separator.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
  assert.equal(separator?.getAttribute('aria-valuenow'), '232')
  assert.equal(container.querySelector('.dsh-panel-workspace-tree-item')?.textContent, '人员')
  await React.act(async () => { container.querySelector('.dsh-panel-workspace-tree-group-toggle').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(container.querySelector('.dsh-panel-workspace-tree-item'), null)
  await React.act(async () => { root.unmount() })
  container.remove()
  dom.window.localStorage.removeItem('dsh-panel-workspace:tree-test:sidebar-width')
})

test('declarative attachment transport is removed from canonical state and writes only referenced files', () => {
  const kept = 'decision_brief/attachments/kept.png'
  const removed = 'decision_brief/attachments/removed.png'
  const draft = {
    schema_version: 1,
    questions: { q: { prompt: '参考资料？', answer: '', multimodal_answer: [{ artifact_file: kept }] } },
    [DECLARATIVE_PANEL_ARTIFACTS_KEY]: [
      { path: kept, content: 'aGVsbG8=', encoding: 'base64' },
      { path: removed, content: 'b3JwaGFu', encoding: 'base64' },
    ],
  }
  const prepared = prepareDeclarativePanelSave(draft)
  assert.equal(Object.hasOwn(prepared.state, DECLARATIVE_PANEL_ARTIFACTS_KEY), false)
  assert.deepEqual(prepared.artifacts, [{ path: kept, content: 'aGVsbG8=', encoding: 'base64' }])
})

test('declarative attachment upload and removal compose reference and transport atomically', () => {
  const manifest = {
    version: 1,
    panel_kind: 'evidence_workbook',
    sections: [{ id: 'questions', title: '问题' }],
    fields: [],
    ui: { component: 'question_workspace', id: 'questions', source: 'questions' },
  }
  const path = 'decision_brief/attachments/reference.png'
  const ref = { type: 'image', file_md5: 'digest', filename: 'reference.png', mime_type: 'image/png', size_bytes: 5, artifact_file: path }
  const pending = { path, content: 'aGVsbG8=', encoding: 'base64', question_id: 'q', file_md5: 'digest', filename: 'reference.png', mime_type: 'image/png' }
  const initial = { schema_version: 1, questions: { q: { prompt: '参考资料？', answer: '' } } }
  const uploaded = applyDeclarativePanelTransaction(initial, manifest,
    [{ section: 'questions', record: 'q', field: 'multimodal_answer', value: [ref] }],
    { [DECLARATIVE_PANEL_ARTIFACTS_KEY]: [pending] })
  assert.deepEqual(uploaded.questions.q.multimodal_answer, [ref])
  assert.deepEqual(uploaded[DECLARATIVE_PANEL_ARTIFACTS_KEY], [pending])
  const prepared = prepareDeclarativePanelSave(uploaded)
  assert.deepEqual(prepared.state.questions.q.multimodal_answer, [ref])
  assert.deepEqual(prepared.artifacts, [{ path, content: 'aGVsbG8=', encoding: 'base64' }])

  const removed = applyDeclarativePanelTransaction(uploaded, manifest,
    [{ section: 'questions', record: 'q', field: 'multimodal_answer', value: [] }],
    { [DECLARATIVE_PANEL_ARTIFACTS_KEY]: [] })
  assert.deepEqual(removed.questions.q.multimodal_answer, [])
  assert.equal(Object.hasOwn(removed, DECLARATIVE_PANEL_ARTIFACTS_KEY), false)
  assert.notDeepEqual(removed, initial, 'an absent design field is not silently normalized to an empty list')

  const existingRef = { ...ref, file_md5: 'existing', filename: 'existing.png', artifact_file: 'decision_brief/attachments/existing.png' }
  const baseline = { ...initial, questions: { q: { ...initial.questions.q, multimodal_answer: [existingRef] } } }
  const added = appendDeclarativeAttachments(baseline, manifest, 'questions', 'q', [{ ref, pending }])
  const restored = applyDeclarativePanelTransaction(added, manifest,
    [{ section: 'questions', record: 'q', field: 'multimodal_answer', value: [existingRef] }],
    { [DECLARATIVE_PANEL_ARTIFACTS_KEY]: [] })
  assert.deepEqual(restored, baseline, 'removing a newly added attachment restores the exact existing-reference draft')
  assert.equal(JSON.stringify(restored), JSON.stringify(baseline), 'the existing structural dirty comparator sees net restoration')

  const siblingPending = { ...pending, question_id: 'sibling', path: 'decision_brief/attachments/sibling.png' }
  const siblingKept = applyDeclarativePanelTransaction(added, manifest,
    [{ section: 'questions', record: 'q', field: 'multimodal_answer', value: [existingRef] }],
    { [DECLARATIVE_PANEL_ARTIFACTS_KEY]: [siblingPending] })
  assert.deepEqual(siblingKept[DECLARATIVE_PANEL_ARTIFACTS_KEY], [siblingPending])
  assert.notEqual(JSON.stringify(siblingKept), JSON.stringify(baseline), 'pending sibling bytes remain observable')
  const edited = applyDeclarativePanelTransaction(added, manifest,
    [{ section: 'questions', record: 'q', field: 'multimodal_answer', value: [existingRef] },
      { section: 'questions', record: 'q', field: 'answer', value: 'actual edit' }],
    { [DECLARATIVE_PANEL_ARTIFACTS_KEY]: [] })
  assert.equal(edited.questions.q.answer, 'actual edit')
  assert.notEqual(JSON.stringify(edited), JSON.stringify(baseline))
  const invalid = applyDeclarativePanelTransaction(baseline, manifest, [], { [DECLARATIVE_PANEL_ARTIFACTS_KEY]: 'invalid' })
  assert.equal(invalid[DECLARATIVE_PANEL_ARTIFACTS_KEY], 'invalid', 'malformed transport remains available for validation')
  assert.deepEqual(added[DECLARATIVE_PANEL_ARTIFACTS_KEY], [pending], 'cleanup never mutates the previous draft')
})

test('native question attachment presentation preserves image preview, file metadata, removal and readonly limits', async () => {
  const { QuestionAttachments, QUESTION_MAX_ATTACHMENTS } = await import('../src/question-attachments.tsx')
  const image = { type: 'image', file_md5: 'a'.repeat(32), filename: 'reference.png', mime_type: 'image/png', size_bytes: 181452, artifact_file: 'questions/attachments/reference.png' }
  const file = { type: 'file', file_md5: 'b'.repeat(32), filename: 'notes.txt', mime_type: 'text/plain', size_bytes: 42, artifact_file: 'questions/attachments/notes.txt' }
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  const removals = [], uploads = []
  const resolvePreview = async attachment => attachment === image ? '/fixture/reference.png' : undefined
  const render = (attachments, editable = true, disabled = false) => root.render(React.createElement(QuestionAttachments, {
    attachments, editable, disabled, resolvePreview,
    children: editable ? React.createElement('input', { 'data-answer-control': true, disabled }) : undefined,
    onChange: value => removals.push(value), onUploadFiles: async files => uploads.push(files),
  }))
  await React.act(async () => render([image, file]))
  const preview = container.querySelector('.is-image img')
  assert.equal(preview?.getAttribute('src'), '/fixture/reference.png')
  assert.equal(preview?.getAttribute('alt'), image.filename)
  assert.ok(container.querySelector('.dsh-question-attachment-controls [data-answer-control]'))
  assert.ok(container.querySelector('.dsh-question-attachment-controls .dsh-question-attachment-add'))
  await React.act(async () => preview.dispatchEvent(new dom.window.Event('error')))
  assert.equal(container.querySelector('.is-image img'), null)
  assert.equal(container.querySelector('.is-image .dsh-question-attachment-name')?.textContent, image.filename)
  assert.equal(container.querySelector('.is-image .dsh-question-attachment-name')?.classList.contains('dsh-question-visually-hidden'), false)
  assert.equal(container.querySelector('.is-image .dsh-question-attachment-size'), null)
  assert.equal(container.querySelector('.is-file .dsh-question-attachment-name')?.textContent, file.filename)
  assert.equal(container.querySelector('.is-file .dsh-question-attachment-size')?.textContent, '42 B')
  await React.act(async () => container.querySelector('.is-image button').click())
  assert.deepEqual(removals, [[file]])
  await React.act(async () => render([image, file], false))
  assert.equal(container.querySelector('button,input'), null)
  assert.equal(container.querySelectorAll('.dsh-question-attachment').length, 2)
  await React.act(async () => render([image, file], true, true))
  assert.equal(container.querySelector('.dsh-question-attachment button'), null)
  assert.equal(container.querySelector('.dsh-question-attachment-add').disabled, true)
  const maximum = Array.from({ length: QUESTION_MAX_ATTACHMENTS }, (_, i) => ({ ...file, filename: `notes-${i}.txt`, file_md5: String(i).repeat(32) }))
  await React.act(async () => render(maximum))
  assert.equal(container.querySelector('.dsh-question-attachment-add').disabled, true)
  assert.equal(container.querySelector('input[type=file]').disabled, true)
  assert.deepEqual(uploads, [])
  await React.act(async () => root.unmount())
})

test('authored card groups frame contiguous cards and preserve answers, actions and input order', async () => {
  const container = document.getElementById('root'), root = createRoot(container)
  const questions = ['a', 'b', 'c', 'd'].map(id => ({ id, prompt: id, kind: 'single', answer: '',
    choices: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] }))
  const answers = [], rejections = []
  await React.act(async () => root.render(React.createElement(StandardQuestionList, {
    questions, editable: true, allowChoiceActions: true, protectedQuestionIds: ['b'],
    choiceActionExcludedIds: ['b'], onKindChange: () => {}, onRejectedChange: (...args) => rejections.push(args),
    onAnswerChange: (...args) => answers.push(args),
    cardGroups: [{ id: 'settings', title: 'Settings', questionIds: ['b', 'c'] }],
  })))
  assert.deepEqual([...container.querySelectorAll('[data-question-id]')].map(node => node.dataset.questionId), ['a', 'b', 'c', 'd'])
  const group = container.querySelector('[data-question-card-group]')
  assert.equal(group.querySelector('h3').textContent, 'Settings')
  assert.deepEqual([...group.querySelectorAll('.is-embedded')].map(node => node.dataset.questionId), ['b', 'c'])
  assert.equal(group.querySelector('[data-question-id="b"] [data-testid="standard-question-to-multiple"]'), null)
  const skipButton = id => [...group.querySelectorAll(`[data-question-id="${id}"] button`)].find(button => button.textContent === '跳过问题')
  assert.equal(skipButton('b'), undefined)
  assert.ok(skipButton('c'))
  await React.act(async () => skipButton('c').click())
  assert.deepEqual(rejections, [['c', true]])
  assert.ok(group.querySelector('[data-question-id="c"] [data-testid="standard-question-to-multiple"]'))
  await React.act(async () => group.querySelector('[data-question-id="b"] input[type="radio"]').click())
  assert.deepEqual(answers, [['b', 'one']])
  assert.equal(container.querySelector('[role="alert"]'), null)
  await React.act(async () => root.unmount())
})

test('invalid card grouping keeps flat cards for noncontiguous, reversed and missing members; invisible groups are ignored', async () => {
  const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
  const container = document.getElementById('root'), root = createRoot(container)
  const questions = ['a', 'b', 'c'].map(id => ({ id, prompt: id, kind: 'text', answer: id }))
  for (const ids of [['a', 'c'], ['b', 'a'], ['a', 'missing']]) {
    await React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' },
      React.createElement(StandardQuestionList, { questions, cardGroups: [{ id: 'group', title: 'Group', questionIds: ids }] }))))
    assert.deepEqual([...container.querySelectorAll('[data-question-id]')].map(node => node.dataset.questionId), ['a', 'b', 'c'])
    assert.equal(container.querySelector('[data-question-card-group]'), null)
    assert.match(container.querySelector('[role="alert"]').textContent, /original question list is preserved/)
  }
  await React.act(async () => root.render(React.createElement(StandardQuestionList, { questions,
    cardGroups: [{ id: 'other', title: 'Other', questionIds: ['absent'] }] })))
  assert.equal(container.querySelector('[role="alert"]'), null)
  assert.equal(container.querySelectorAll('[data-question-id]').length, 3)
  await React.act(async () => root.unmount())
})

test('workspace card groups cannot span rounds and retain historical readonly state', async () => {
  const container = document.getElementById('root'), root = createRoot(container)
  const questions = [{ id: 'a', prompt: 'A', kind: 'text', answer: 'old', round: 0 },
    { id: 'b', prompt: 'B', kind: 'text', answer: '', round: 1 }]
  await React.act(async () => root.render(React.createElement(StandardQuestionWorkspace, {
    questions, editable: true, historyReadonly: true,
    cardGroups: [{ id: 'cross', title: 'Cross', questionIds: ['a', 'b'] }],
  })))
  assert.deepEqual([...container.querySelectorAll('[data-question-id]')].map(node => node.dataset.questionId), ['b'])
  assert.ok(container.querySelector('[role="alert"]'))
  assert.equal(container.querySelector('[data-question-card-group]'), null)
  const history = [...container.querySelectorAll('button')].find(node => node.textContent.includes('基础问题'))
  assert.ok(history)
  await React.act(async () => history.click())
  assert.deepEqual([...container.querySelectorAll('[data-question-id]')].map(node => node.dataset.questionId), ['a'])
  assert.equal(container.querySelector('textarea'), null)
  assert.equal(container.querySelector('[data-testid="standard-question-edit"]'), null)
  assert.ok(container.querySelector('[role="alert"]'))
  await React.act(async () => root.unmount())
})

test('declarative card groups preserve official earliest-round placement and map standalone lists', async () => {
  const { localizePanelManifest } = await import('../../core/src/panel-i18n.ts')
  const container = document.getElementById('root'), root = createRoot(container)
  const manifest = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/smart_questions/panel.yaml', import.meta.url), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(await Promise.all(['zh-CN', 'en-US'].map(async locale => [locale,
    JSON.parse(await readFile(new URL(`../../skills-web-app/bundles/smart_questions/locales/${locale}.json`, import.meta.url), 'utf8'))])))
  const data = { questions: {
    const_auth_mode: { prompt: 'Auth', kind: 'text', answer: '' },
    const_storage_mode: { prompt: 'Storage', kind: 'text', answer: '' },
    old: { prompt: 'Old', kind: 'text', answer: '', round: 0 },
  } }
  await React.act(async () => root.render(renderManifest(localizePanelManifest(manifest, 'en-US'), data, { editable: true, locale: 'en-US' })))
  assert.deepEqual([...container.querySelectorAll('[data-question-id]')].map(node => node.dataset.questionId), ['old', 'const_auth_mode', 'const_storage_mode'])
  assert.equal(container.querySelector('.dsh-standard-question-card-group-title').textContent, 'Application Development Configuration')
  assert.equal(container.querySelector('[role="alert"]'), null)
  const standalone = { ...manifest, ui: { component: 'question_list', source: 'questions', card_groups: manifest.ui.card_groups } }
  await React.act(async () => root.render(renderManifest(localizePanelManifest(standalone, 'zh-CN'), data, { editable: true })))
  assert.deepEqual([...container.querySelectorAll('[data-question-id]')].map(node => node.dataset.questionId), ['const_auth_mode', 'const_storage_mode', 'old'])
  assert.equal(container.querySelector('.dsh-standard-question-card-group-title').textContent, '应用开发配置')
  await React.act(async () => root.unmount())
})

test('official fixed card presentation stays expanded after save and hides supplements without deleting facts', async () => {
  const container = document.getElementById('root'), root = createRoot(container)
  const manifest = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/smart_questions/panel.yaml', import.meta.url), 'utf8'))
  const choices = [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]
  const attachment = { type: 'file', file_md5: 'a'.repeat(32), filename: 'kept.txt', mime_type: 'text/plain', size_bytes: 4, artifact_file: 'smart_questions/attachments/kept.txt' }
  const data = { questions: Object.fromEntries(['const_auth_mode', 'const_storage_mode'].map(id => [id,
    { prompt: id, kind: 'single', choices, answer: 'one', detail: 'Keep the saved context', multimodal_answer: [attachment] }])) }
  const before = structuredClone(data), edits = []
  const show = collapseToken => root.render(renderManifest(manifest, data, { editable: true, collapseToken, onEdit: edit => edits.push(edit) }))
  await React.act(async () => show(1))
  assert.equal(container.querySelectorAll('input[type="radio"]').length, 4)
  assert.equal(container.querySelector('[data-testid="standard-question-edit"]'), null)
  assert.equal(container.querySelector('[data-testid="standard-question-detail"]'), null)
  assert.equal(container.querySelector('input[type="file"]'), null)
  assert.ok(!container.textContent.includes('kept.txt'))
  await React.act(async () => container.querySelectorAll('input[type="radio"]')[1].click())
  assert.deepEqual(edits, [{ section: 'questions', record: 'const_auth_mode', field: 'answer', value: 'two' }])
  await React.act(async () => show(2))
  assert.equal(container.querySelectorAll('input[type="radio"]').length, 4)
  assert.equal(container.querySelector('[data-testid="standard-question-edit"]'), null)
  assert.deepEqual(data, before)
  await React.act(async () => root.unmount())
})

test('expanded presentation respects readonly disabled rejected and restore permissions even for direct callbacks', async () => {
  const container = document.getElementById('root'), root = createRoot(container)
  const edits = [], rejections = []
  const question = { id: 'a', prompt: 'A', kind: 'single', answer: 'one', detail: 'Saved detail', choices: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] }
  const cardGroups = [{ id: 'group', title: 'Group', questionIds: ['a'], presentation: { alwaysExpanded: true } }]
  const reactProps = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
  for (const policy of [{ editable: false }, { editable: true, disabled: true }, { editable: true, rejected: true }]) {
    await React.act(async () => root.render(React.createElement(StandardQuestionList, { ...policy,
      questions: [{ ...question, rejected: policy.rejected }], cardGroups,
      onAnswerChange: (...args) => edits.push(args), onDetailChange: (...args) => edits.push(args),
      onKindChange: (...args) => edits.push(args), allowChoiceActions: true,
      onRejectedChange: (...args) => rejections.push(args),
    })))
    const options = [...container.querySelectorAll('input[type="radio"]')]
    assert.equal(options.length, 2)
    assert.ok(options.every(node => node.disabled))
    assert.equal(container.querySelector('[data-testid="standard-question-to-multiple"]'), null)
    const detail = container.querySelector('[data-testid="standard-question-detail"]')
    assert.ok(detail.disabled)
    await React.act(async () => {
      reactProps(options[1]).onChange()
      reactProps(detail).onChange({ target: { value: 'Do not write' } })
    })
    assert.deepEqual(edits, [])
    const restore = [...container.querySelectorAll('button')].find(node => node.textContent === '恢复问题')
    if (policy.rejected) {
      assert.ok(restore && !restore.disabled)
      await React.act(async () => restore.click())
      assert.deepEqual(rejections, [['a', false]])
    } else {
      assert.equal(restore, undefined)
      const skip = [...container.querySelectorAll('button')].find(node => node.textContent === '跳过问题')
      if (skip) {
        assert.ok(skip.disabled)
        await React.act(async () => reactProps(skip).onClick())
      }
      assert.deepEqual(rejections, [])
    }
  }
  await React.act(async () => root.unmount())
})

test('presentation switches preserve text answers and default cards while invalid groups ignore presentation', async () => {
  const container = document.getElementById('root'), root = createRoot(container)
  const questions = [{ id: 'a', prompt: 'Text', kind: 'text', answer: 'Saved answer', detail: 'Saved context' },
    { id: 'b', prompt: 'Choice', kind: 'single', answer: 'one', choices: [{ value: 'one', label: 'One' }], detail: 'Saved detail' }]
  const before = structuredClone(questions)
  const render = cardGroups => root.render(React.createElement(StandardQuestionList, { questions, cardGroups, editable: true }))
  await React.act(async () => render([{ id: 'text', title: 'Text', questionIds: ['a'], presentation: { alwaysExpanded: true, showAttachments: false, showDetail: true } }]))
  assert.equal(container.querySelector('textarea').value, 'Saved answer')
  assert.match(container.querySelector('[data-testid="standard-question-context"]').textContent, /Saved context/)
  assert.ok(container.querySelector('[data-question-id="b"] [data-testid="standard-question-edit"]'))
  await React.act(async () => container.querySelector('[data-question-id="b"] [data-testid="standard-question-edit"]').click())
  assert.equal(container.querySelector('[data-testid="standard-question-detail"]').value, 'Saved detail')
  await React.act(async () => render([{ id: 'invalid', title: 'Invalid', questionIds: ['b', 'a'], presentation: { alwaysExpanded: true, showDetail: false, showAttachments: false } }]))
  assert.equal(container.querySelector('[data-question-card-group]'), null)
  assert.ok(container.querySelector('[role="alert"]'))
  // Remount fallback so prior user edit state cannot mask default initial collapse.
  await React.act(async () => root.unmount())
  const next = createRoot(container)
  await React.act(async () => next.render(React.createElement(StandardQuestionList, { questions, editable: true,
    cardGroups: [{ id: 'invalid', title: 'Invalid', questionIds: ['b', 'a'], presentation: { alwaysExpanded: true, showDetail: false, showAttachments: false } }] })))
  assert.equal(container.querySelectorAll('[data-testid="standard-question-edit"]').length, 2)
  assert.equal(container.querySelector('textarea'), null)
  assert.deepEqual(questions, before)
  await React.act(async () => next.unmount())
})

test('expanded group remains readonly in historical workspace rounds', async () => {
  const container = document.getElementById('root'), root = createRoot(container)
  const changes = []
  const choices = [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]
  await React.act(async () => root.render(React.createElement(StandardQuestionWorkspace, {
    editable: true, historyReadonly: true,
    questions: [{ id: 'old', prompt: 'Old', kind: 'single', choices, answer: 'one', round: 0 }, { id: 'now', prompt: 'Now', kind: 'text', answer: '', round: 1 }],
    cardGroups: [{ id: 'old-group', title: 'Old group', questionIds: ['old'], presentation: { alwaysExpanded: true, showDetail: false, showAttachments: false } }],
    onAnswerChange: (...args) => changes.push(args),
  })))
  const history = [...container.querySelectorAll('button')].find(node => node.textContent.includes('基础问题'))
  await React.act(async () => history.click())
  const input = container.querySelectorAll('input[type="radio"]')[1]
  assert.ok(input.disabled)
  await React.act(async () => input.click())
  assert.deepEqual(changes, [])
  assert.equal(container.querySelector('[data-testid="standard-question-edit"]'), null)
  await React.act(async () => root.unmount())
})
