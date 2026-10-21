import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validatePanelManifest, parsePanelManifest } from '../src/panel-dsl.ts'
import { autoPanelSnapshot, autoPanelManifest, validateAutoPanelEdit, exportAutoPanelDsl } from '../src/auto-panel-spec.ts'
import { PANEL_COMPONENT_CATALOG } from '../src/panel-component-catalog.ts'

const manifest = () => ({ version: 1, panel_kind: 'document', sections: [{ id: 'entries', title: 'Entries' }],
  fields: ['prompt', 'answer', 'detail'].map(key => ({ key, control: 'textarea', applies_to: ['entries'] })),
  ui: { id: 'questions', component: 'question_workspace', source: 'entries' } })
const context = { kit: 'neutral', kitVersion: '1', bundle: 'entries', bundleVersion: '1',
  schema: { type: 'object', properties: { entries: { type: 'map', value: { type: 'object', properties: {
    prompt: { type: 'string' }, answer: { type: 'string' }, detail: { type: 'string' },
    kind: { type: 'enum', values: ['single', 'multiple', 'text'] },
    choices: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, label: { type: 'string' } } } },
  } } } } }, state: { entries: { a: { prompt: 'Select', kind: 'single', answer: 'a', detail: 'Keep', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } } } }
const messages = view => [
  { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
  { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest: view }] } },
]

test('authored round context requires a separate declared text section and is rejected by generated panels', () => {
  const view = manifest()
  view.sections.push({ id: 'round_context', title: 'Round context' })
  view.fields.push(...['title', 'description'].map(key => ({ key, control: 'text', applies_to: ['round_context'] })))
  view.ui.rounds_source = 'round_context'
  for (const component of ['question_workspace', 'question_rounds']) {
    view.ui.component = component
    assert.deepEqual(validatePanelManifest(view), [])
  }
  for (const source of ['entries', '__proto__', 'missing', '', null, 3]) {
    view.ui.rounds_source = source
    assert.ok(validatePanelManifest(view).some(error => error.includes('rounds_source')))
  }
  view.ui.rounds_source = 'round_context'; view.ui.component = 'question_list'
  assert.ok(validatePanelManifest(view).some(error => error.includes('rounds_source')))
  view.ui.component = 'question_workspace'
  view.fields = view.fields.filter(field => field.key !== 'description')
  assert.ok(validatePanelManifest(view).some(error => error.includes('rounds_source')))
  const auto = manifest(); auto.ui.rounds_source = 'round_context'
  auto.sections.push({ id: 'round_context', title: 'Round context' })
  auto.fields.push(...['title', 'description'].map(key => ({ key, control: 'text', applies_to: ['round_context'] })))
  const roundContext = { ...context, schema: { ...context.schema, properties: { ...context.schema.properties,
    round_context: { type: 'map', value: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } } } } } },
    state: { ...context.state, round_context: {} } }
  assert.throws(() => autoPanelSnapshot(roundContext, messages(auto)), /authored round context/)
})

test('authored choice actions are explicitly typed and restricted to question workspaces', () => {
  const view = manifest()
  assert.deepEqual(validatePanelManifest(view), [])
  for (const component of ['question_workspace', 'question_rounds']) {
    view.ui.component = component
    for (const flag of [true, false]) {
      view.ui.question_policy = { allow_choice_actions: flag }
      assert.deepEqual(validatePanelManifest(view), [])
    }
    for (const flag of ['true', 1, null, [], {}]) {
      view.ui.question_policy = { allow_choice_actions: flag }
      assert.ok(validatePanelManifest(view).some(error => error.includes('allow_choice_actions must be boolean')))
    }
  }
  view.ui.question_policy = { allow_choices_actions: true }
  assert.ok(validatePanelManifest(view).some(error => error.includes('unknown question policy')))
  view.ui.component = 'question_list'; view.ui.question_policy = { allow_choice_actions: true }
  assert.ok(validatePanelManifest(view).some(error => error.includes('requires a question workspace')))
})

test('generated snapshot/export rejects authored action flag and preserves kind protection', () => {
  const view = manifest()
  // Generated panels must retain a readable overview of protected question
  // fields such as kind and choices; this fixture exercises that valid path.
  view.ui = { id: 'layout', component: 'stack', children: [view.ui,
    { id: 'overview', component: 'structured_data', source: 'entries' }] }
  const snapshot = autoPanelSnapshot(context, messages(view))
  assert.deepEqual(JSON.parse(exportAutoPanelDsl(snapshot, context)), view)
  for (const flag of [true, false]) {
    const authored = manifest(); authored.ui.question_policy = { allow_choice_actions: flag }
    assert.throws(() => autoPanelSnapshot(context, messages(authored)), /authored choice actions/)
  }
  const checked = autoPanelManifest(snapshot, context)
  const kind = structuredClone(context.state); kind.entries.a.kind = 'multiple'
  assert.throws(() => validateAutoPanelEdit(context.state, kind, context, checked), /protected field "kind"/)
  const answer = structuredClone(context.state); answer.entries.a.answer = 'b'
  validateAutoPanelEdit(context.state, answer, context, checked)
  answer.entries.a.answer = 'a,b'
  assert.throws(() => validateAutoPanelEdit(context.state, answer, context, checked), /undeclared choice/)
})

test('official declaration opts in with both fixed records excluded and public catalog documents the boundary', () => {
  const view = parsePanelManifest(readFileSync(webAppBundleUrl('smart_questions/panel.yaml'), 'utf8'))
  assert.deepEqual(validatePanelManifest(view), [])
  assert.equal(view.ui.question_policy.allow_choice_actions, true)
  assert.deepEqual(view.ui.question_policy.first_round_ids, ['const_auth_mode', 'const_storage_mode'])
  assert.deepEqual(view.ui.question_policy.protected_ids, view.ui.question_policy.first_round_ids)
  for (const name of ['question_workspace', 'question_rounds']) assert.match(PANEL_COMPONENT_CATALOG[name].description, /allow_choice_actions/)
  assert.match(PANEL_COMPONENT_CATALOG.question_workspace.description, /Generated panels reject/)
})

test('authored card groups validate strictly, localize content and remain unavailable to generated panels', async () => {
  const { localizePanelManifest } = await import('../src/panel-i18n.ts')
  const view = manifest()
  const valid = [{ id: 'settings', title: 'Settings', question_ids: ['a', 'b'] }]
  for (const component of ['question_list', 'question_workspace', 'question_rounds']) {
    view.ui.component = component
    view.ui.card_groups = valid
    assert.deepEqual(validatePanelManifest(view), [])
  }
  for (const groups of [null, {}, [{ ...valid[0], extra: true }], [{ ...valid[0], id: '__proto__' }],
    [{ ...valid[0], title: ' ' }], [{ ...valid[0], question_ids: [] }], [{ ...valid[0], question_ids: ['a', 'a'] }],
    [valid[0], { id: 'other', title: 'Other', question_ids: ['b'] }],
    [valid[0], { id: 'settings', title: 'Other', question_ids: ['c'] }]]) {
    view.ui.card_groups = groups
    assert.ok(validatePanelManifest(view).some(error => error.includes('card_groups')))
  }
  view.ui.card_groups = valid; view.ui.component = 'record_form'
  assert.ok(validatePanelManifest(view).some(error => error.includes('card_groups')))
  view.ui.component = 'question_workspace'
  assert.throws(() => autoPanelSnapshot(context, messages(view)), /authored card groups/)
  const official = parsePanelManifest(readFileSync(webAppBundleUrl('smart_questions/panel.yaml'), 'utf8'))
  official.i18n.messages = Object.fromEntries(['zh-CN', 'en-US'].map(locale => [locale,
    JSON.parse(readFileSync(webAppBundleUrl(`smart_questions/locales/${locale}.json`), 'utf8'))]))
  assert.deepEqual(validatePanelManifest(official), [])
  for (const [locale, title] of [['zh-CN', '应用开发配置'], ['en-US', 'Application Development Configuration']]) {
    const localized = localizePanelManifest(official, locale)
    assert.equal(localized.ui.card_groups[0].title, title)
    assert.deepEqual(localized.ui.card_groups[0].question_ids, official.ui.question_policy.first_round_ids)
  }
})

test('card group presentation strictly accepts only three authored boolean display options', () => {
  const view = manifest()
  const group = { id: 'settings', title: 'Settings', question_ids: ['a'] }
  for (const presentation of [{}, { always_expanded: true, show_detail: false, show_attachments: false },
    { always_expanded: false, show_detail: true, show_attachments: true }]) {
    view.ui.card_groups = [{ ...group, presentation }]
    assert.deepEqual(validatePanelManifest(view), [])
    assert.throws(() => autoPanelSnapshot(context, messages(view)), /authored card groups/)
  }
  for (const presentation of [null, [], 'compact', { show_detail: 0 }, { always_expanded: 'true' },
    { show_attachments: null }, { compact: true }]) {
    view.ui.card_groups = [{ ...group, presentation }]
    assert.ok(validatePanelManifest(view).some(error => error.includes('presentation')))
  }
  const official = parsePanelManifest(readFileSync(webAppBundleUrl('smart_questions/panel.yaml'), 'utf8'))
  assert.deepEqual(official.ui.card_groups[0].presentation,
    { always_expanded: true, show_detail: false, show_attachments: false })
})
