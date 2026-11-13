/** Bundle source-loader and Files/Git checks; not a host, model or rendered-UI test. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { register } from 'tsx/esm/api'

register()
const { loadDesignBundle, loadDesignKit } = await import('../src/kit-loader.ts')
const { validatorFromSchemaYaml } = await import('../src/schema.ts')
const { parseValidationYaml, evaluateValidationRules } = await import('../src/validation-rules.ts')
const { renderDeclarativeState } = await import('../src/renderer.ts')
const { localizePanelManifest } = await import('../src/panel-i18n.ts')
const { reconstructionContractPrompt } = await import('../src/reconstruction-prompt.ts')
const { DesignFilesStore } = await import('../src/design-files.ts')
// Native Git owns a package-built JS worker; reuse the unchanged Core build.
const { GitVersioning } = await import('../lib/index.js')
const { applyPanelEdit } = await import('../src/panel-save.ts')
const { applyDesignEditToDraft, applyPanelUpdatesToDraft, recordDeletionUpdates } = await import('../../panel/src/record-state.ts')

const packageRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
const rootDir = join(packageRoot, 'bundles/smart_questions')
const appBasicsIds = ['const_identity_needs', 'const_data_retention', 'const_usage_devices']
const oldSettingIds = ['const_auth_mode', 'const_storage_mode']
const fixedIds = [...appBasicsIds, ...oldSettingIds]
const oldSettings = {
  const_auth_mode: { prompt: '是否需要注册登录？', kind: 'single',
    choices: [{ value: 'anonymous', label: '不需要，直接使用' }, { value: 'auth_required', label: '需要，支持注册登录' }],
    answer: 'anonymous', detail: 'Saved user context for authentication' },
  const_storage_mode: { prompt: '应用数据如何保存？', kind: 'single',
    choices: [{ value: 'browser_temp', label: '仅当前浏览器临时保存' }, { value: 'database_persistent', label: '持久保存，可跨设备继续使用' }],
    answer: 'database_persistent', detail: 'Saved user decision and source context' },
}
const asOldState = state => ({ ...state, questions: { ...oldSettings,
  ...Object.fromEntries(Object.entries(state.questions).filter(([id]) => !appBasicsIds.includes(id))) } })
const fs = {
  readText: async path => {
    try { return await readFile(path, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  },
  listDir: readdir,
  isDirectory: async path => (await stat(path)).isDirectory(),
  realPath: realpath,
  writeText: async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) },
  ensureDir: path => mkdir(path, { recursive: true }),
}
const bundle = await loadDesignBundle(fs, { rootDir, sourceId: 'smart-question-round-content-test' })
const { skill, resources } = bundle
const kit = await loadDesignKit(fs, { rootDir: packageRoot,
  mindsetPath: join(packageRoot, 'kits/web_app/mindset.md'),
  manifestPath: join(packageRoot, 'kits/web_app/kit.yaml'),
  relationsPath: join(packageRoot, 'kits/web_app/relations.yaml'),
  skillsDir: join(packageRoot, 'bundles'), bundlesDir: join(packageRoot, 'bundles') },
  { sourceId: 'smart-question-round-resource-test' })
const preview = JSON.parse(resources['reference/preview.json'])
const validate = validatorFromSchemaYaml(skill.metadata.schemaYaml)
const rules = parseValidationYaml(skill.metadata.validationYaml)

test('real source loader retains policy, fixed protection and readonly round declarations', () => {
  assert.equal(skill.name, 'smart_questions')
  assert.equal(skill.version, '1.0')
  assert.deepEqual(skill.execution, { mode: 'main', handoff: 'must_edit' })
  const panel = skill.metadata.panelManifest
  assert.equal(panel.ui.source, 'questions')
  assert.equal(panel.ui.rounds_source, 'rounds')
  assert.ok(panel.sections.some(section => section.id === 'rounds'))
  assert.deepEqual(panel.ui.question_policy.first_round_ids, fixedIds)
  assert.deepEqual(panel.ui.card_groups.map(group => group.question_ids), [appBasicsIds, oldSettingIds])
  assert.deepEqual(panel.ui.question_policy.protected_ids, panel.ui.question_policy.first_round_ids)
  assert.equal(panel.ui.question_policy.history_readonly, true)
  assert.equal(panel.ui.question_policy.allow_choice_actions, true)
  for (const locale of ['zh-CN', 'en-US']) {
    const localized = localizePanelManifest(panel, locale)
    for (const key of ['title', 'description']) {
      const field = localized.fields.find(field => field.key === key && field.applies_to.includes('rounds'))
      assert.equal(field.readonly, true)
      assert.ok(field.label && !field.label.startsWith('$t:'))
    }
  }
})

test('preview and legacy files share the same schema without automatic backfill', () => {
  assert.deepEqual(validate(preview), { ok: true })
  const legacy = structuredClone(preview)
  delete legacy.rounds
  const before = JSON.stringify(legacy)
  assert.deepEqual(validate(legacy), { ok: true })
  assert.equal(JSON.stringify(legacy), before)
  const oldState = asOldState(legacy), oldBytes = JSON.stringify(oldState)
  assert.deepEqual(validate(oldState), { ok: true })
  assert.equal(JSON.stringify(oldState), oldBytes, 'old settings are not replaced or backfilled')
  assert.match(preview.rounds['0'].description, /合成预览示例.*不代表用户需求或已确认事实/)
  assert.notEqual(preview.rounds['0'].title, preview.questions.preview_main_outcome.prompt)
  for (const id of appBasicsIds) {
    assert.equal(preview.questions[id].answer, '', 'a new template does not invent user answers')
    assert.equal(Object.hasOwn(preview.questions[id], 'round'), false)
    assert.equal(Object.hasOwn(preview.questions[id], 'rejected'), false)
  }
})

test('present round entries require both string fields and reject extra state', () => {
  for (const bad of [null, [], 'copy', { '0': null }, { '0': { title: 'Topic' } },
    { '0': { description: 'Context' } }, { '0': { title: 1, description: 'Context' } },
    { '0': { title: 'Topic', description: [] } },
    { '0': { title: 'Topic', description: 'Context', answer: 'approved' } }]) {
    assert.equal(validate({ ...preview, rounds: bad }).ok, false, JSON.stringify(bad))
  }
  assert.equal(validate({ ...preview, rounds: {} }).ok, true)
  // Meaningful new-round copy belongs to the method, not a length/quality gate.
  assert.equal(validate({ ...preview, rounds: { '0': { title: '', description: '' } } }).ok, true)
  assert.equal(validate({ ...preview, hidden_queue: [] }).ok, false)
  assert.equal(validate({ ...preview, questions: { q: { prompt: 'Question', rounds: {} } } }).ok, false)
})

test('round metadata does not change completion or fabricate an answer', async () => {
  const legacy = structuredClone(preview)
  delete legacy.rounds
  for (const state of [preview, legacy]) {
    assert.deepEqual(await evaluateValidationRules(rules, { skill: skill.name, state }, 'state'), [])
    assert.deepEqual(await evaluateValidationRules(rules, { skill: skill.name, state }, 'completion'), [])
    assert.equal(state.questions.preview_main_outcome.answer, '')
  }
  const issues = await evaluateValidationRules(rules,
    { skill: skill.name, state: { rounds: preview.rounds, questions: {} } }, 'completion')
  assert.ok(issues.some(issue => issue.code === 'smart_questions.empty'))
})

test('both entry points can reach the retained shared contract through loaded resources', () => {
  assert.match(skill.content, /\]\(reference\/artifact-contract\.md\)/)
  const contract = kit.resources['smart_questions/reference/artifact-contract.md']
  assert.equal(typeof contract, 'string')
  assert.equal(kit.resources['smart_questions/schema.yaml'], undefined,
    'Kit resource projection excludes fixed slots; Bundle loading retains their source')
  assert.match(reconstructionContractPrompt(skill, kit.resources),
    /read "reference\/artifact-contract\.md" with read_skill_resource/)
  for (const boundary of [/5W1H as lenses rather than six mandatory cards/, /Preserve actual user answers/,
    /Fixed cards cannot be rejected/, /supplementary `detail` alone does not answer/,
    /same\n  atomic checkpoint as this JSON/, /Do not rely on automatic write-time allocation/,
    /Both ordinary design and reconstruction follow/]) assert.match(contract, boundary)
  const example = JSON.parse(contract.match(/```json\n([\s\S]*?)\n```/)[1])
  assert.deepEqual(validate(example), { ok: true })
  for (const id of appBasicsIds) assert.equal(example.questions[id].answer, '')
  for (const id of oldSettingIds) assert.equal(example.questions[id], undefined)
  assert.match(contract, /synthetic example is not a user requirement/)
  assert.doesNotMatch(contract, /receive the next round automatically/)
})

test('optional summary projects introductions separately from untouched question fields', () => {
  const state = structuredClone(preview)
  state.rounds['7'] = { title: 'Later topic', description: 'New context, not approval' }
  state.questions.preview_situation.round = 7
  state.questions.preview_situation.answer = 'A real example'
  state.questions.preview_situation.detail = 'A saved explanation'
  const before = JSON.stringify(state)
  const output = JSON.stringify(renderDeclarativeState(state, skill))
  for (const text of ['Later topic', 'New context, not approval', 'A real example',
    'A saved explanation', state.questions.preview_situation.prompt]) assert.ok(output.includes(text), text)
  assert.equal(JSON.stringify(state), before)
  const legacy = structuredClone(state)
  delete legacy.rounds
  const legacyOutput = JSON.stringify(renderDeclarativeState(legacy, skill))
  assert.ok(legacyOutput.includes('A real example'))
  assert.ok(!legacyOutput.includes('Later topic'))
})

for (const oldGeneration of [false, true]) for (const withRounds of [true, false]) test(`canonical ${oldGeneration ? 'old settings' : 'App basics'} edits save and reopen without changing ${withRounds ? 'independent introductions' : 'legacy round absence'}`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'smart-question-rounds-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const exec = promisify(execFile)
  const spawn = async ({ argv, cwd, env, signal }) => {
    try { return { exitCode: 0, ...await exec(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, signal }) } }
    catch (error) { return { exitCode: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
  }
  const git = new GitVersioning(spawn, directory, 'design_files')
  await git.ensureRepo()
  const open = () => new DesignFilesStore(fs, new GitVersioning(spawn, directory, 'design_files'), join(directory, 'design_files'))
  const store = open(), panel = skill.metadata.panelManifest
  const original = oldGeneration ? asOldState(structuredClone(preview)) : structuredClone(preview)
  if (withRounds) original.rounds['7'] = { title: 'Separate later topic', description: 'Saved context, not approval' }
  else delete original.rounds
  const evidence = 'Synthetic supporting evidence\n'
  const attachmentPath = `smart_questions/attachments/${createHash('sha256').update(evidence).digest('hex')}.txt`
  original.questions.saved_history = { prompt: 'A previous question', kind: 'text', answer: 'A saved answer',
    detail: 'Exact supporting context', round: 7, rejected: true,
    multimodal_answer: [{ type: 'file', file_md5: createHash('md5').update(evidence).digest('hex'),
      filename: 'evidence.txt', mime_type: 'text/plain', size_bytes: Buffer.byteLength(evidence), artifact_file: attachmentPath }] }
  let settlements = 0
  const settle = async () => { settlements++ }
  await applyPanelEdit(store, { skill: skill.name, state: original }, settle, validate, { [attachmentPath]: evidence })
  const sibling = { note: 'Unrelated Bundle state' }
  await applyPanelEdit(store, { skill: 'neighbor', state: sibling }, async () => {})
  assert.deepEqual(await open().read(skill.name), original)

  let edited = applyDesignEditToDraft(original, panel, {
    section: 'questions', record: 'preview_situation', field: 'answer', value: 'Find the source while reviewing a saved claim',
  })
  edited = applyDesignEditToDraft(edited, panel, {
    section: 'questions', record: 'preview_main_outcome', field: 'prompt', value: 'An explicitly revised first question',
  })
  assert.deepEqual(edited.rounds, original.rounds)
  assert.deepEqual(edited.questions.saved_history, original.questions.saved_history)
  for (const id of fixedIds) assert.deepEqual(edited.questions[id], original.questions[id])
  const editedId = oldGeneration ? 'const_auth_mode' : 'const_identity_needs'
  const nextAnswer = oldGeneration ? 'auth_required' : 'needed'
  edited = applyDesignEditToDraft(edited, panel, { section: 'questions', record: editedId, field: 'answer', value: nextAnswer })
  assert.equal(edited.questions[editedId].answer, nextAnswer)
  for (const id of fixedIds.filter(id => id !== editedId)) assert.deepEqual(edited.questions[id], original.questions[id])
  assert.equal(original.questions.preview_situation.answer, '', 'draft editing must not mutate its baseline')
  await applyPanelEdit(store, { skill: skill.name, state: edited }, settle, validate)
  assert.deepEqual(await open().read(skill.name), edited)

  const { updates } = recordDeletionUpdates(panel, edited, 'questions', 'preview_main_outcome')
  const removed = applyPanelUpdatesToDraft(edited, updates)
  await applyPanelEdit(store, { skill: skill.name, state: removed }, settle, validate)
  const reopened = await open().read(skill.name)
  assert.deepEqual(reopened, removed)
  assert.equal(Object.hasOwn(reopened, 'rounds'), withRounds)
  assert.deepEqual(reopened.rounds, original.rounds, 'deleting the first question does not rebuild or discard introductions')
  assert.deepEqual(await open().read('neighbor'), sibling)
  assert.equal(await readFile(join(directory, 'design_files', attachmentPath), 'utf8'), evidence)

  const beforeHead = await store.head(), beforeSettlements = settlements
  const canonical = join(directory, 'design_files/smart_questions/smart_questions.json')
  const beforeBytes = await readFile(canonical, 'utf8')
  for (const bad of [{ '7': { title: 'Missing description' } }, { '7': { title: 'Topic', description: 'Context', answer: 'Confirmed' } }]) {
    await assert.rejects(applyPanelEdit(store, { skill: skill.name, state: { ...reopened, rounds: bad } }, settle, validate))
    assert.equal(await store.head(), beforeHead)
    assert.equal(await readFile(canonical, 'utf8'), beforeBytes)
    assert.equal(settlements, beforeSettlements, 'rejected metadata must not notify journal settlement')
  }
})
