import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath, mkdir, mkdtemp, writeFile, unlink, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const { register } = await import('tsx/esm/api'); register()
const { loadDesignKit } = await import('../src/kit-loader.ts')
const { validateSkillDesign } = await import('../src/validate-design.ts')
const { validatorFromSchemaYaml } = await import('../src/schema.ts')
const { DesignFilesStore } = await import('../src/design-files.ts')
const { GitVersioning } = await import('../src/git.ts')
const { applyPanelEdit } = await import('../src/panel-save.ts')
const { readDesignSourceReference } = await import('../src/design-source-reference.ts')
const { mergeUsageScenarios } = await import('../../skills-web-app/bundles/function_modules/scripts/merge-usage-scenario.mjs')
const exec = promisify(execFile)
const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
  readBytes: async path => { try { return await readFile(path) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
  writeText: async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) },
  writeBytes: async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) },
  ensureDir: path => mkdir(path, { recursive: true }), removeFile: unlink,
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
const kit = await loadDesignKit(fs, new URL('../../skills-web-app/', import.meta.url).pathname, { sourceId: 'package:dsh-design-skills-web-app' })
const skill = kit.skills.find(skill => skill.name === 'function_modules')
const old = { functions: { 'F-1': { function_id: 'F-1', function_name: 'Read evidence', function_description: 'Read original evidence', function_epic: 'Research' } } }
const enriched = structuredClone(old)
enriched.functions['F-1'].details = { situation: 'Writing a review to understand the evidence',
  behaviors: { 'B-1': { description: 'Open the claim source' } }, inputs: { 'I-1': { description: 'A selected claim' } },
  outputs: { 'O-1': { description: 'Source evidence' } }, limits: { 'L-1': { description: 'No invented citation' } },
  exceptions: { 'E-1': { condition: 'Source unavailable', response: 'Keep its location and explain the failure' } } }
enriched.functions['F-1'].references = { 'R-1': { file: 'smart_questions/smart_questions.json', pointer: '/questions/q1/answer', revision: 'a'.repeat(40), subject_pointer: '/details/behaviors/B-1' } }

test('actual loaded contract accepts overview cards and complete optional details; rejects malformed specs/locators', async () => {
  assert.equal(kit.version, '1.0'); assert.equal(skill.version, '1.0')
  for (const state of [old, enriched]) assert.deepEqual(await validateSkillDesign(skill, state), [])
  for (const mutate of [
    state => { state.functions['F-1'].details.approved = true },
    state => { state.functions['F-1'].details.purpose = 'Old split field needs explicit conversion' },
    state => { state.functions['F-1'].details.behaviors['B-1'] = {} },
    state => { state.functions['F-1'].references['R-1'].file = '../escape.json' },
    state => { state.functions['F-1'].references['R-1'].revision = 'HEAD' },
    state => { state.functions['F-1'].references['R-1'].pointer = '/wrong~2' },
    state => { state.functions['F-1'].references['R-1'].subject_pointer = '/details/behaviors/absent' },
  ]) { const bad = structuredClone(enriched); mutate(bad); assert.ok((await validateSkillDesign(skill, bad)).length > 0) }
})

test('explicit conversion preserves both original texts and pins, rebases only local purpose subjects and is idempotent', async () => {
  const split = structuredClone(enriched)
  const owner = split.functions['F-1']
  owner.details.purpose = '  Understand the evidence\nwithout invented facts. '
  owner.details.situation = '\nWriting a review  '
  owner.reason = 'Keep the existing design rationale and user notes'
  owner.references['R-purpose'] = { file: 'function_modules/function_modules.json', pointer: '/functions/F-1/details/purpose', revision: 'b'.repeat(40), subject_pointer: '/details/purpose' }
  const before = structuredClone(split)
  assert.ok((await validateSkillDesign(skill, split)).length)
  const converted = mergeUsageScenarios(split)
  assert.deepEqual(split, before, 'conversion never mutates its input')
  assert.equal(converted.functions['F-1'].details.situation, `${owner.details.purpose}\n\n${owner.details.situation}`)
  const expected = structuredClone(before)
  expected.functions['F-1'].details.situation = converted.functions['F-1'].details.situation
  delete expected.functions['F-1'].details.purpose
  expected.functions['F-1'].references['R-purpose'].subject_pointer = '/details/situation'
  assert.deepEqual(converted, expected, 'other facts, IDs, keys, and historical source pointers remain exact')
  assert.deepEqual(await validateSkillDesign(skill, converted), [])
  assert.deepEqual(mergeUsageScenarios(converted), converted)
})

test('conversion handles partial/empty details without inventing defaults; malformed legacy values fail', () => {
  for (const [details, expected] of [
    [{ purpose: 'Original purpose' }, { situation: 'Original purpose' }],
    [{ situation: 'Original situation' }, { situation: 'Original situation' }],
    [{ purpose: '', situation: '' }, { situation: '\n\n' }],
    [{}, {}],
  ]) {
    const state = structuredClone(old); state.functions['F-1'].details = details
    assert.deepEqual(mergeUsageScenarios(state).functions['F-1'].details, expected)
  }
  assert.deepEqual(mergeUsageScenarios(old), old)
  for (const details of [{ purpose: null }, { purpose: 2 }, { purpose: 'keep', situation: [] }, { situation: null }]) {
    const state = structuredClone(old); state.functions['F-1'].details = details
    assert.throws(() => mergeUsageScenarios(state), /must be strings/)
  }
})

test('loaded method, reconstruction contract and isolated sample share the scenario/notes semantics', async () => {
  const sample = JSON.parse(await readFile(new URL('../../skills-web-app/bundles/function_modules/reference/preview.json', import.meta.url), 'utf8'))
  assert.deepEqual(await validateSkillDesign(skill, sample), [])
  assert.equal(skill.metadata.panelManifest.ui.board.detail_fields_mode, 'fixed')
  assert.equal(skill.metadata.panelManifest.ui.board.id_field, 'function_id')
  assert.equal(skill.metadata.panelManifest.fields.find(field => field.key === 'function_id').readonly, true)
  assert.equal(skill.metadata.panelManifest.fields.some(field => field.key === 'purpose'), false)
  assert.match(skill.content, /reason.*shown as Notes/s)
  assert.match(skill.content, /details\.situation/)
  const contract = await readFile(new URL('../../skills-web-app/bundles/function_modules/reference/artifact-contract.md', import.meta.url), 'utf8')
  assert.match(contract, /one optional `situation`/)
  assert.match(contract, /shown as Notes/)
  assert.ok(Object.hasOwn(kit.resources, 'function_modules/scripts/merge-usage-scenario.mjs'), 'explicit converter is a reachable Bundle resource')
})

test('real Panel Save, scoped agent write, reopening and pinned source reads preserve all nested facts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'function-specification-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const spawn = async ({ argv, cwd, signal, env }) => {
    try { const result = await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env } }); return { exitCode: 0, ...result } }
    catch (error) { return { exitCode: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
  }
  const git = new GitVersioning(spawn, root, 'design_files')
  await git.ensureRepo()
  const store = new DesignFilesStore(fs, git, join(root, 'design_files'))
  const source = await store.write('smart_questions', { questions: { q1: { prompt: 'What is difficult?', kind: 'text', answer: 'Finding evidence' } } }, { origin: 'agent', settleEvent: async () => {} })
  assert.ok(source.commit)
  const state = structuredClone(enriched); state.functions['F-1'].references['R-1'].revision = source.commit
  assert.deepEqual(await validateSkillDesign(skill, state), [])
  const validate = validatorFromSchemaYaml(skill.metadata.schemaYaml)
  const settlements = []
  const saved = await applyPanelEdit(store, { skill: skill.name, state }, async event => settlements.push(event), validate)
  assert.ok(saved.commit); assert.equal(settlements.length, 1)
  const reopened = new DesignFilesStore(fs, new GitVersioning(spawn, root, 'design_files'), join(root, 'design_files'))
  assert.deepEqual(await reopened.read(skill.name), state)
  const scenarioEdit = structuredClone(state)
  scenarioEdit.functions['F-1'].details.situation = 'User is reviewing a claim to check its supporting evidence'
  scenarioEdit.functions['F-1'].reason = 'An explicit design tradeoff; remaining question recorded here'
  await applyPanelEdit(reopened, { skill: skill.name, state: scenarioEdit }, async () => {}, validate)
  assert.deepEqual(await reopened.read(skill.name), scenarioEdit)
  const last = await git.head()
  assert.ok(last)
  assert.deepEqual(JSON.parse(await reopened.readTextAt(saved.commit, `${skill.name}/${skill.name}.json`)), state, 'the former checkpoint is not rewritten')
  const revised = structuredClone(scenarioEdit); revised.functions['F-1'].function_name = 'Inspect claim evidence'
  // Same durable writer underlying main and Producer integration; this does
  // not pretend to be a model-driven full-state preservation test.
  await reopened.write(skill.name, revised, { origin: 'agent', validate, settleEvent: async () => {} })
  assert.deepEqual((await reopened.read(skill.name)).functions['F-1'].details, scenarioEdit.functions['F-1'].details)
  assert.deepEqual((await reopened.read(skill.name)).functions['F-1'].references, state.functions['F-1'].references)
  const resolved = await readDesignSourceReference(state.functions['F-1'].references['R-1'], await git.head(),
    (revision, path, signal) => reopened.readTextAt(revision, path, signal))
  assert.equal(resolved.current, 'matching'); assert.equal(resolved.historicalValue, 'Finding evidence')
})
