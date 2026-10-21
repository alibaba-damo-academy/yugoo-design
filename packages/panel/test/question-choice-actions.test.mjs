import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { StandardQuestionList, StandardQuestionWorkspace } = await import('../src/question-list.tsx')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
const { renderManifest } = await import('../src/interpreter.ts')
const { applyDeclarativePanelTransaction } = await import('../src/client/panels/dsl-panel.tsx')
const { applyDesignEditToDraft } = await import('../src/record-state.ts')

const baseQuestion = () => ({ id: 'opaque.id-7', prompt: 'Existing choices', kind: 'single', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], answer: 'a', detail: 'Preserve context' })
const action = name => document.querySelector(`[data-testid="standard-question-${name}"]`)

test('explicit round context follows saved round numbers without splitting questions or manufacturing history', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'entries' }, { id: 'contexts', records_path: 'envelope.rounds' }], fields: [],
    ui: { id: 'workspace', component: 'question_workspace', source: 'entries', rounds_source: 'contexts',
      question_policy: { first_round_ids: ['fixed'], protected_ids: ['fixed'], numbered_rounds: true, history_readonly: true } } }
  let draft = { entries: {
    first: { prompt: 'A question: with its own punctuation', kind: 'text', answer: '', round: 7 },
    second: { prompt: 'Another question', kind: 'text', answer: '', round: 7 },
    history: { prompt: 'Original question', kind: 'text', answer: 'Saved evidence', detail: 'Kept', round: 2 },
    fixed: { prompt: 'Fixed configuration', kind: 'text', answer: 'Initialized' },
  }, envelope: { rounds: {
    '7': { title: 'Goal: clarify scope', description: 'A separate round explanation: retain every colon.' },
    '2': { title: 'Earlier evidence', description: 'The original background.' },
    '90': { title: 'Unattached metadata', description: 'Must not become a question round.' },
  }, untouched: 'Keep' } }
  const before = structuredClone(draft)
  const show = locale => root.render(renderManifest(manifest, draft, { editable: true, locale,
    onEdit: edit => { draft = applyDesignEditToDraft(draft, manifest, edit) } }))
  try {
    for (const component of ['question_rounds', 'question_workspace']) {
      manifest.ui.component = component
      await React.act(async () => show('en-US'))
      assert.equal(document.querySelector('.dsh-question-workspace-header h2').textContent, 'Goal: clarify scope', `${component} binds authored round context`)
    }
    const buttons = () => [...document.querySelectorAll('.dsh-panel-workspace-nav-items button')]
    assert.equal(buttons().length, 2, 'orphan metadata never creates another round')
    assert.equal(buttons()[0].querySelector('.dsh-panel-workspace-nav-eyebrow').textContent, 'Round 2')
    assert.equal(buttons()[0].querySelector('.dsh-panel-workspace-nav-label').textContent, 'Goal: clarify scope', 'independent titles are not colon-split')
    assert.equal(document.querySelector('.dsh-question-workspace-header h2').textContent, 'Goal: clarify scope')
    assert.equal(document.querySelector('.dsh-question-workspace-header p').textContent, 'A separate round explanation: retain every colon.')
    assert.ok(document.querySelector('[data-question-id="first"]').textContent.includes(before.entries.first.prompt))
    const input = document.querySelector('[data-question-id="second"] textarea')
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'New answer')
    await React.act(async () => input.dispatchEvent(new dom.window.Event('input', { bubbles: true })))
    assert.equal(draft.entries.second.answer, 'New answer')
    assert.deepEqual(draft.envelope, before.envelope, 'answer editing preserves every round and unrelated field')
    delete draft.entries.first
    await React.act(async () => show('zh-CN'))
    assert.equal(document.querySelector('.dsh-question-workspace-header h2').textContent, 'Goal: clarify scope', 'deleting the first question cannot rename its round')
    assert.equal(buttons()[0].querySelector('.dsh-panel-workspace-nav-eyebrow').textContent, '第 2 轮')
    await React.act(async () => buttons()[1].click())
    assert.ok(document.querySelector('[data-question-id="fixed"]'))
    assert.equal(document.querySelector('textarea'), null, 'historical readonly behavior is retained')
    delete draft.envelope.rounds
    await React.act(async () => show('en-US'))
    assert.equal(buttons()[0].querySelector('.dsh-panel-workspace-nav-label').textContent, 'Round 2', 'missing metadata uses a round label, not the first question')
    assert.equal(document.querySelector('.dsh-question-workspace-header p'), null)
    assert.equal(draft.entries.history.answer, 'Saved evidence')
    assert.equal(draft.entries.history.detail, 'Kept')
  } finally { await React.act(async () => root.unmount()) }
})

test('controlled shared actions preserve selection, expansion and locale without Bundle renderActions', async () => {
  const root = createRoot(document.getElementById('root'))
  let question = baseQuestion(), locale = 'zh-CN'
  const show = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
    React.createElement(StandardQuestionList, { questions: [question], editable: true, collapseAnswered: false, allowChoiceActions: true,
      onKindChange: (id, kind) => { assert.equal(id, question.id); question = { ...question, kind }; show() },
      onAnswerChange: (id, answer) => { assert.equal(id, question.id); question = { ...question, answer }; show() } })))
  try {
    await React.act(async () => show())
    assert.equal(action('to-multiple').textContent, '改为多选')
    await React.act(async () => action('to-multiple').click())
    assert.equal(question.kind, 'multiple'); assert.equal(question.answer, 'a')
    assert.equal(question.detail, 'Preserve context')
    assert.equal(document.querySelectorAll('input[type=checkbox]').length, 2)
    assert.equal(document.querySelector('input[type=checkbox]').checked, true)
    assert.equal(action('select-all').textContent, '全选')
    await React.act(async () => action('select-all').click())
    assert.deepEqual(question.answer, ['a', 'b'])
    locale = 'en-US'; await React.act(async () => show())
    assert.equal(action('select-all').textContent, 'Deselect all')
    assert.deepEqual(question.answer, ['a', 'b'])
    await React.act(async () => action('select-all').click())
    assert.deepEqual(question.answer, [])
    assert.equal(action('select-all').textContent, 'Select all')
  } finally { await React.act(async () => root.unmount()) }
})

test('action permission gates preserve fixed, rejected, historical, disabled and readonly cards', async () => {
  const root = createRoot(document.getElementById('root')), writes = []
  const callbacks = { onKindChange: (...args) => writes.push(args), onAnswerChange: (...args) => writes.push(args) }
  try {
    let instance = 0
    for (const kind of ['single', 'multiple']) for (const extra of [{ allowChoiceActions: false }, { editable: false }, { disabled: true }, { choiceActionExcludedIds: ['opaque.id-7'] }, { rejected: true }]) {
      await React.act(async () => root.render(React.createElement(StandardQuestionList, {
        key: ++instance, questions: [{ ...baseQuestion(), kind, rejected: extra.rejected }], editable: true, collapseAnswered: false, allowChoiceActions: true, ...callbacks, ...extra })))
      assert.equal(action('to-multiple'), null)
      assert.equal(action('select-all'), null)
    }
    await React.act(async () => root.render(React.createElement(StandardQuestionList, {
      questions: [{ ...baseQuestion(), rejected: true }], editable: true, collapseAnswered: false, allowChoiceActions: true, ...callbacks })))
    assert.equal(action('to-multiple'), null)
    // protectedQuestionIds retains rejection-only semantics, not kind permissions.
    await React.act(async () => root.render(React.createElement(StandardQuestionList, {
      questions: [{ ...baseQuestion(), id: 'protected', answer: '' }], editable: true, collapseAnswered: false,
      allowChoiceActions: true, protectedQuestionIds: ['protected'], ...callbacks })))
    assert.ok(action('to-multiple'))
    const questions = [{ ...baseQuestion(), id: 'latest', round: 2, answer: '' },
      { ...baseQuestion(), id: 'history', round: 1 }, { ...baseQuestion(), id: 'fixed', answer: '' }]
    await React.act(async () => root.render(React.createElement(StandardQuestionWorkspace, { questions, firstRoundIds: ['fixed'],
      editable: true, historyReadonly: true, allowChoiceActions: true, collapseAnswered: false, ...callbacks })))
    assert.ok(action('to-multiple'))
    await React.act(async () => document.querySelectorAll('.dsh-panel-workspace-nav-items button')[1].click())
    assert.equal(action('to-multiple'), null)
    await React.act(async () => root.render(React.createElement(StandardQuestionWorkspace, { questions, firstRoundIds: ['fixed'],
      editable: true, historyReadonly: false, allowChoiceActions: true, collapseAnswered: false, ...callbacks })))
    assert.equal(document.querySelector('[data-question-id=fixed] [data-testid=standard-question-to-multiple]'), null)
    // Re-enable historical editing explicitly: history card may offer its action.
    await React.act(async () => document.querySelector('[data-question-id=history] [data-testid=standard-question-edit]')?.click())
    assert.ok(document.querySelector('[data-question-id=history] [data-testid=standard-question-to-multiple]'))
    assert.deepEqual(writes, [])
  } finally { await React.act(async () => root.unmount()) }
})

test('interpreter maps kind atomically and choice arrays to canonical CSV, preserving opaque identity and Undo baseline', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'entries', title: 'Entries' }], fields: [],
    ui: { id: 'workspace', component: 'question_workspace', source: 'entries', question_policy: { allow_choice_actions: true } } }
  let draft = { entries: { 'opaque.id-7': { ...baseQuestion(), answer: ' a ', attachments_extra: { keep: 7 } } }, untouched: { keep: 'yes' } }
  delete draft.entries['opaque.id-7'].id
  const original = structuredClone(draft), transactions = []
  const show = () => root.render(renderManifest(manifest, draft, { editable: true, collapseToken: 1,
    onEdit: edit => { draft = applyDesignEditToDraft(draft, manifest, edit); show() },
    onTransaction: (edits, updates) => { transactions.push({ edits, updates }); draft = applyDeclarativePanelTransaction(draft, manifest, edits, updates); show() } }))
  try {
    await React.act(async () => show())
    await React.act(async () => action('edit').click())
    await React.act(async () => action('to-multiple').click())
    assert.deepEqual(transactions, [{ edits: [{ section: 'entries', record: 'opaque.id-7', field: 'kind', value: 'multiple' }], updates: {} }])
    assert.equal(draft.entries['opaque.id-7'].answer, ' a ', 'kind action preserves exact answer bytes')
    assert.equal(draft.entries['opaque.id-7'].kind, 'multiple')
    assert.equal(document.querySelectorAll('input[type=checkbox]').length, 2)
    await React.act(async () => action('select-all').click())
    assert.equal(draft.entries['opaque.id-7'].answer, 'a,b')
    await React.act(async () => action('select-all').click())
    assert.equal(draft.entries['opaque.id-7'].answer, '')
    assert.equal(draft.entries['opaque.id-7'].detail, original.entries['opaque.id-7'].detail)
    assert.deepEqual(draft.entries['opaque.id-7'].attachments_extra, { keep: 7 })
    assert.deepEqual(draft.untouched, { keep: 'yes' })
    assert.deepEqual(original.entries['opaque.id-7'].answer, ' a ', 'immutable original remains the host Undo source')
    draft = structuredClone(original); await React.act(async () => show())
    assert.deepEqual(draft, original); assert.equal(document.querySelectorAll('input[type=radio]').length, 2)
  } finally { await React.act(async () => root.unmount()) }
})


test('unanswered cards become editable when publication releases readonly or disabled state', async () => {
 const root=createRoot(document.getElementById('root'))
 const question={id:'new-question',prompt:'Describe your task',kind:'text',answer:''}
 const show=(editable,disabled=false,answer='')=>root.render(React.createElement(StandardQuestionList,{questions:[{...question,answer}],editable,disabled,onAnswerChange:()=>{}}))
 try {
  await React.act(async()=>show(false))
  assert.equal(document.querySelectorAll('textarea').length,0)
  await React.act(async()=>show(true))
  assert.ok(document.querySelector('textarea'),'new unanswered question opens without clicking Edit')
  await React.act(async()=>show(true,true))
  await React.act(async()=>show(true,false))
  assert.ok(document.querySelector('textarea'),'temporary disable does not strand an unanswered question')
  await React.act(async()=>show(false,false,'Saved answer'))
  await React.act(async()=>show(true,false,'Saved answer'))
  assert.equal(document.querySelectorAll('textarea').length,0,'answered cards retain the collapsed saved presentation')
 } finally { await React.act(async()=>root.unmount()) }
})
