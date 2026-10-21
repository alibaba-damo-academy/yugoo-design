import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { register } = await import('tsx/esm/api')
register()
const { basicGenericManifest, generateAutoPanel } = await import('../src/auto-panel-generation.ts')
const { autoPanelManifest, autoPanelSnapshot } = await import('../src/auto-panel-spec.ts')
const { AUTO_PANEL_COMPONENT_KINDS } = await import('../src/auto-panel-spec.ts')
const { autoPanelGenerationPrompt } = await import('../src/auto-panel-generation.ts')
const { parseAutoPanelResponse } = await import('../src/dsh-auto-panel-model.ts')
const { parseSchemaYaml } = await import('../src/schema.ts')
const { assertAutoPanelSave, readAutoPanelCache } = await import('../src/auto-panel-cache.ts')
const { renderManifest } = await import('../../panel/lib/interpreter.js')
const { renderToStaticMarkup } = await import('../../panel/node_modules/react-dom/server.js')

const schema = { type: 'object', additional_properties: false, required: ['schema_version', 'cards', 'overview'], properties: {
  schema_version: { type: 'enum', values: [1], knowledge: { role: 'metadata' } },
  cards: { type: 'map', value: { type: 'object', additional_properties: false,
    required: ['title', 'note', 'active'], properties: {
      title: { type: 'string' }, note: { type: 'string' }, active: { type: 'boolean' },
      status: { type: 'enum', values: ['draft', 'ready'] },
    } } },
  overview: { type: 'object', additional_properties: false, required: ['goal', 'steps'], properties: {
    goal: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } },
  } },
} }
const state = { schema_version: 1, cards: { first: { title: '会议安排', note: '确认成员时间', active: true, status: 'draft' } },
  overview: { goal: '让团队确认下周例会', steps: ['收集空闲时间', '确认议题'] } }
const context = { kit: 'a2ui_test', kitVersion: '1.0', bundle: 'probe_records', bundleVersion: '1.0',
  schema, state, source: '', artifacts: { 'probe_records/summary.md': 'digest-1' } }
const components = [{ id: 'root', component: 'DesignPanel', manifest: basicGenericManifest(context) }]
const messages = [
  { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
  { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components } },
]

test('schema, actual values and artifacts derive a readable fixed-catalog A2UI view', () => {
  const snapshot = autoPanelSnapshot(context, messages)
  const manifest = autoPanelManifest(snapshot, context)
  const html = renderToStaticMarkup(renderManifest(manifest, state, { editable: false,
    artifactFiles: context.artifacts }))
  assert.match(html, /会议安排/)
  assert.match(html, /收集空闲时间/)
  assert.match(html, /summary.md/)
  assert.match(html, /dsh-design-record-form/)
  assert.match(html, /dsh-design-schema-field/)
  assert.equal((html.match(/让团队确认下周例会/g) ?? []).length, 1, 'fallback must not repeat the same object content')
  assert.ok(!JSON.stringify(snapshot).includes('确认成员时间'), 'cache must not duplicate Design JSON values')
})

test('report fallback shows editable scalars and nested facts without duplicating the whole object', async () => {
  const schema = parseSchemaYaml(await readFile(new URL('../../skills-a2ui-test/skills/probe_report/schema.yaml', import.meta.url), 'utf8'))
  const state = JSON.parse(await readFile(new URL('../../skills-a2ui-test/skills/probe_report/reference/state-example.json', import.meta.url), 'utf8'))
  const report = { ...context, bundle: 'probe_report', schema, state,
    artifacts: { 'probe_report/report.md': 'digest-1' } }
  const manifest = basicGenericManifest(report)
  assert.ok(manifest.ui.children.some(node => node.component === 'schema_field' && node.path === 'report.findings' && node.control === 'list'))
  assert.ok(!manifest.ui.children.some(node => node.component === 'structured_data' && node.source === 'report'))
  assert.ok(manifest.ui.children.some(node => node.component === 'schema_field' && node.path === 'report.title'))
  autoPanelSnapshot(report, [messages[0], { ...messages[1], updateComponents: {
    ...messages[1].updateComponents, components: [{ id: 'root', component: 'DesignPanel', manifest }],
  } }])
})

test('generic saves use current schema and binding, not model-declared write actions', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'auto-generic-'))
  try {
    const result = await generateAutoPanel({ context, stateRoot, signal: new AbortController().signal,
      currentContext: async () => context, port: { generate: async () => components } })
    assert.equal(result.status, 'published')
    const edited = structuredClone(state)
    edited.cards.first.note = '已确认时间'
    edited.overview.goal = '确认下周例会安排'
    await assertAutoPanelSave({ stateRoot, context, before: state, visibleState: state, after: edited })
    const metadata = structuredClone(edited)
    metadata.schema_version = 2
    await assert.rejects(assertAutoPanelSave({ stateRoot, context, before: state, visibleState: state, after: metadata }), /read-only source/)
    const unexpected = structuredClone(edited)
    unexpected.cards.first.undeclared = 'bad'
    await assert.rejects(assertAutoPanelSave({ stateRoot, context, before: state, visibleState: state, after: unexpected }), /protected field|schema-invalid/)
    const artifactChanged = { ...context, artifacts: { 'probe_records/summary.md': 'digest-2' } }
    assert.equal((await readAutoPanelCache(stateRoot, artifactChanged)).status, 'stale')
  } finally { await rm(stateRoot, { recursive: true, force: true }) }
})

test('a model cannot bind another Bundle artifact or invent a Design JSON source', () => {
  for (const mutate of [
    manifest => { manifest.ui.children.at(-1).paths = ['other_bundle/private.md'] },
    manifest => { manifest.ui.children.at(-1).paths = ['__proto__'] },
    manifest => { manifest.ui.children[0].source = 'unowned' },
  ]) {
    const invalid = structuredClone(messages)
    mutate(invalid[1].updateComponents.components[0].manifest)
    assert.throws(() => autoPanelSnapshot(context, invalid), /auto panel:/)
  }
})

test('invalid model layout gets one bounded repair then a readable schema-derived view', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'auto-generic-fallback-'))
  try {
    const result = await generateAutoPanel({ context, stateRoot, signal: new AbortController().signal,
      currentContext: async () => context, port: { generate: async () => [{ id: 'root', component: 'RunScript' }] } })
    assert.equal(result.status, 'published')
    assert.equal(result.attempts, 2)
    assert.match(result.fallbackReason, /DesignPanel/)
    assert.equal((await readAutoPanelCache(stateRoot, context)).status, 'ready')
  } finally { await rm(stateRoot, { recursive: true, force: true }) }
})

test('catalog names used by the model and validator stay in one shared list', () => {
  const prompt = autoPanelGenerationPrompt(context)
  assert.equal(new Set(AUTO_PANEL_COMPONENT_KINDS).size, AUTO_PANEL_COMPONENT_KINDS.length)
  for (const kind of AUTO_PANEL_COMPONENT_KINDS) assert.ok(prompt.includes(kind), kind)
})

test('model parser accepts complete JSON fences without accepting explanatory prose', () => {
  assert.deepEqual(parseAutoPanelResponse('```json\n[{"id":"root"}]\n```'), [{ id: 'root' }])
  assert.deepEqual(parseAutoPanelResponse(' [{"id":"root"}] '), [{ id: 'root' }])
  assert.throws(() => parseAutoPanelResponse('Here is the UI:\n```json\n[]\n```'), SyntaxError)
})

test('nested records and record-owned artifacts render only from declared schema and inventory', () => {
  const nested = { kit: 'a2ui_test', kitVersion: '1.0', bundle: 'probe_research', bundleVersion: '1.0',
    schema: { type: 'object', additional_properties: false, required: ['schema_version', 'rounds'], properties: {
      schema_version: { type: 'enum', values: [1], knowledge: { role: 'metadata' } },
      rounds: { type: 'map', value: { type: 'object', additional_properties: false,
        required: ['title', 'directions'], properties: {
          title: { type: 'string' }, directions: { type: 'map', value: { type: 'object', additional_properties: false,
            required: ['title', 'artifact'], properties: { title: { type: 'string' }, artifact: { type: 'string' } } } },
        } } },
    } },
    state: { schema_version: 1, rounds: { 'R-001': { title: '研究机会', directions: {
      'D-001': { title: '现有工具边界', artifact: 'probe_research/R-001/D-001.md' },
    } } } }, artifacts: { 'probe_research/R-001/D-001.md': 'owned-digest' } }
  const manifest = { version: 1, panel_kind: 'document', sections: [], fields: [], ui: { id: 'layout', component: 'stack', children: [
    { id: 'rounds', component: 'nested_collection', source: 'rounds', label_field: 'title',
      children_field: 'directions', child_label_field: 'title' },
    { id: 'files', component: 'related_artifacts', paths_from: ['rounds.*.directions.*.artifact'] },
  ] } }
  const messages = [
    { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest }] } },
  ]
  const accepted = autoPanelManifest(autoPanelSnapshot(nested, messages), nested)
  const html = renderToStaticMarkup(renderManifest(accepted, nested.state, { artifactFiles: nested.artifacts }))
  assert.match(html, /现有工具边界/)
  assert.match(html, /D-001\.md/)
  assert.match(html, /dsh-design-nested-collection/)
  assert.match(html, /dsh-design-related-artifacts/)
  const tampered = structuredClone(nested)
  tampered.state.rounds['R-001'].directions['D-001'].artifact = 'other/private.md'
  assert.throws(() => autoPanelSnapshot(tampered, messages), /not Bundle-owned/)
  manifest.ui.children[1].paths_from = ['rounds.*.__proto__.artifact']
  assert.throws(() => autoPanelSnapshot(nested, messages), /related_artifacts|invalid artifact reference pattern/)
})
