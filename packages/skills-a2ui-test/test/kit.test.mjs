import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { register } = await import('tsx/esm/api')
register()
const { loadDesignKit } = await import('../../core/src/kit-loader.ts')
const { startKitDiscovery } = await import('../../core/src/kit-discovery.ts')
const { parseSchemaYaml, validatorFromSchemaYaml } = await import('../../core/src/schema.ts')
const { parseValidationYaml, evaluateValidationRules } = await import('../../core/src/validation-rules.ts')
const { generateAutoPanel, basicGenericManifest } = await import('../../core/src/auto-panel-generation.ts')
const { readAutoPanelCache, assertAutoPanelSave } = await import('../../core/src/auto-panel-cache.ts')
const { autoPanelManifest, autoPanelSnapshot } = await import('../../core/src/auto-panel-spec.ts')
const { renderManifest } = await import('../../panel/lib/interpreter.js')
const { renderToStaticMarkup } = await import('../../panel/node_modules/react-dom/server.js')

const root = fileURLToPath(new URL('../', import.meta.url))
const readOptional = async path => {
  try { return await readFile(path, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}
const fs = { readText: readOptional, listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
const kit = await loadDesignKit(fs, root, { sourceId: 'package:dsh-design-skills-a2ui-test' })
const skill = kit.skills[0]
const example = JSON.parse(await readFile(new URL('../skills/probe_questions/reference/state-example.json', import.meta.url), 'utf8'))
const components = [{ id: 'root', component: 'DesignPanel', manifest: basicGenericManifest({
  schema: parseSchemaYaml(skill.metadata.schemaYaml), state: example,
}) }]

test('standalone Kit loads through the current loader with explicit auto and no predefined Panel', () => {
  assert.equal(kit.name, 'a2ui_test')
  assert.equal(kit.version, '1.0')
  assert.deepEqual(kit.skills.map(value => value.name), ['probe_questions', 'probe_records', 'probe_report'])
  assert.equal(skill.metadata.skillManifest.presentation.mode, 'auto')
  assert.equal(skill.metadata.panelYaml, undefined)
  assert.equal(skill.metadata.rendererMd, undefined)
  assert.equal(skill.execution.mode, 'main')
  assert.equal(skill.execution.handoff, 'must_edit')
})

test('record Bundle derives a generic form and saves a schema-valid field edit', async () => {
  const recordSkill = kit.skills.find(value => value.name === 'probe_records')
  const state = JSON.parse(kit.resources['probe_records/reference/state-example.json'])
  const schema = parseSchemaYaml(recordSkill.metadata.schemaYaml)
  assert.deepEqual(validatorFromSchemaYaml(recordSkill.metadata.schemaYaml)(state), { ok: true })
  assert.deepEqual(await evaluateValidationRules(parseValidationYaml(recordSkill.metadata.validationYaml),
    { skill: recordSkill.name, state }, 'completion'), [])
  const stateRoot = await mkdtemp(join(tmpdir(), 'a2ui-record-kit-'))
  try {
    const context = { kit: kit.name, kitVersion: String(kit.version), bundle: recordSkill.name,
      bundleVersion: String(recordSkill.version), schema, state }
    const result = await generateAutoPanel({ context, stateRoot, signal: new AbortController().signal,
      currentContext: async () => context, port: { generate: async () => [{ bad: true }] } })
    assert.equal(result.status, 'published')
    const cached = await readAutoPanelCache(stateRoot, context)
    assert.equal(cached.status, 'ready')
    const html = renderToStaticMarkup(renderManifest(autoPanelManifest(cached.snapshot, context), state, { editable: true }))
    assert.match(html, /研究资料归档/)
    const edited = structuredClone(state)
    edited.functions['F-001'].priority = 'Medium'
    await assertAutoPanelSave({ stateRoot, context, before: state, visibleState: state, after: edited })
    const invalid = structuredClone(edited)
    invalid.functions['F-001'].priority = 'urgent'
    await assert.rejects(assertAutoPanelSave({ stateRoot, context, before: state, visibleState: state, after: invalid }), /schema-invalid/)
  } finally { await rm(stateRoot, { recursive: true, force: true }) }
})

test('the same record Bundle can use a schema-bound grouped view without a custom Panel', () => {
  const recordSkill = kit.skills.find(value => value.name === 'probe_records')
  const state = JSON.parse(kit.resources['probe_records/reference/state-example.json'])
  const context = { kit: kit.name, kitVersion: String(kit.version), bundle: recordSkill.name,
    bundleVersion: String(recordSkill.version), schema: parseSchemaYaml(recordSkill.metadata.schemaYaml), state }
  const manifest = structuredClone(basicGenericManifest(context))
  const recordNode = manifest.ui.children.find(node => node.component === 'record_form')
  recordNode.component = 'grouped_records'
  recordNode.group_by = 'function_epic'
  const messages = [
    { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest }] } },
  ]
  const accepted = autoPanelManifest(autoPanelSnapshot(context, messages), context)
  const html = renderToStaticMarkup(renderManifest(accepted, state, { editable: true }))
  assert.match(html, /文献与知识/)
  assert.match(html, /课题推进/)
  assert.match(html, /dsh-design-grouped-records/)
  recordNode.group_by = 'not_in_schema'
  assert.throws(() => autoPanelSnapshot(context, messages), /grouped records/)
})

test('report Bundle derives nested content and an owned artifact gallery', async () => {
  const reportSkill = kit.skills.find(value => value.name === 'probe_report')
  const state = JSON.parse(kit.resources['probe_report/reference/state-example.json'])
  const schema = parseSchemaYaml(reportSkill.metadata.schemaYaml)
  assert.deepEqual(validatorFromSchemaYaml(reportSkill.metadata.schemaYaml)(state), { ok: true })
  assert.deepEqual(await evaluateValidationRules(parseValidationYaml(reportSkill.metadata.validationYaml),
    { skill: reportSkill.name, state }, 'completion'), [])
  const stateRoot = await mkdtemp(join(tmpdir(), 'a2ui-report-kit-'))
  try {
    const artifacts = { 'probe_report/report.md': 'fixture-digest' }
    const context = { kit: kit.name, kitVersion: String(kit.version), bundle: reportSkill.name,
      bundleVersion: String(reportSkill.version), schema, state, artifacts }
    const result = await generateAutoPanel({ context, stateRoot, signal: new AbortController().signal,
      currentContext: async () => context, port: { generate: async () => [{ bad: true }] } })
    assert.equal(result.status, 'published')
    const cached = await readAutoPanelCache(stateRoot, context)
    assert.equal(cached.status, 'ready')
    const manifest = autoPanelManifest(cached.snapshot, context)
    assert.match(JSON.stringify(manifest), /artifact_gallery/)
    const html = renderToStaticMarkup(renderManifest(manifest, state, { editable: true }))
    assert.match(html, /团队例会安排/)
    assert.match(html, /report\.md/)
    const edited = structuredClone(state)
    edited.report.summary = '更新后的范围说明。'
    await assertAutoPanelSave({ stateRoot, context, before: state, visibleState: state, after: edited })
    assert.equal((await readAutoPanelCache(stateRoot, { ...context, artifacts: { 'probe_report/report.md': 'changed' } })).status, 'stale')
  } finally { await rm(stateRoot, { recursive: true, force: true }) }
})

test('DSH directory discovery registers an isolated copy without a host allowlist', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'a2ui-test-discovery-'))
  const original = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = dshHome
    const discovered = join(dshHome, 'design-system', 'kits', 'a2ui_test')
    await mkdir(join(dshHome, 'design-system', 'kits'), { recursive: true })
    await cp(root, discovered, { recursive: true })
    const installed = []
    const warnings = []
    const ctx = { logger: { warn: message => warnings.push(message) }, design: {
      listKits: () => installed,
      assertKitInstallable() {},
      registerKitSource: value => { installed.push(value); return { publish() {}, dispose() {} } },
    } }
    const close = await startKitDiscovery(ctx, { watch: false }, fs)
    try {
      assert.deepEqual(installed.map(value => value.name), ['a2ui_test'])
      assert.deepEqual(warnings, [])
    } finally { await close() }
  } finally {
    if (original === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = original
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('method resource is reachable and example passes the actual schema and completion rules', async () => {
  const resource = kit.resources['probe_questions/reference/artifact-contract.md']
  assert.ok(resource, 'method-linked contract must be available through the Bundle resource port')
  assert.match(skill.content, /reference\/artifact-contract\.md/)
  assert.match(resource, /probe_questions\/probe_questions\.json/)
  assert.ok(kit.resources['probe_questions/reference/state-example.json'])
  assert.deepEqual(validatorFromSchemaYaml(skill.metadata.schemaYaml)(example), { ok: true })
  const rules = parseValidationYaml(skill.metadata.validationYaml)
  assert.deepEqual(await evaluateValidationRules(rules, { skill: skill.name, state: example }, 'completion'), [])
  assert.equal(validatorFromSchemaYaml(skill.metadata.schemaYaml)({ ...example, approved: true }).ok, false)
  assert.notDeepEqual(await evaluateValidationRules(rules, { skill: skill.name, state: { schema_version: 1, questions: {} } }, 'completion'), [])
})

test('generated Panel renders, saves only authorized answers, and invalidates on saved fact change', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'a2ui-test-kit-'))
  try {
    const context = { kit: kit.name, kitVersion: String(kit.version), bundle: skill.name,
      bundleVersion: String(skill.version), schema: parseSchemaYaml(skill.metadata.schemaYaml), state: example }
    const result = await generateAutoPanel({ context, stateRoot, signal: new AbortController().signal,
      currentContext: async () => context, port: { generate: async () => components } })
    assert.equal(result.status, 'published')
    const cached = await readAutoPanelCache(stateRoot, context)
    assert.equal(cached.status, 'ready')
    const html = renderToStaticMarkup(renderManifest(autoPanelManifest(cached.snapshot, context), example,
      { editable: true, allowAttachments: false }))
    assert.match(html, /questions/)
    assert.match(html, /团队安排会议时/)
    assert.doesNotMatch(html, /添加附件/)
    const edited = structuredClone(example)
    edited.questions.first_view.answer = 'calendar'
    await assertAutoPanelSave({ stateRoot, context, before: example, visibleState: example, after: edited })
    const protectedEdit = structuredClone(edited)
    protectedEdit.questions.first_view.prompt = '被篡改的问题'
    await assert.rejects(assertAutoPanelSave({ stateRoot, context, before: example, visibleState: example, after: protectedEdit }), /protected field/)
    assert.equal((await readAutoPanelCache(stateRoot, { ...context, state: edited })).status, 'stale')
  } finally { await rm(stateRoot, { recursive: true, force: true }) }
})
