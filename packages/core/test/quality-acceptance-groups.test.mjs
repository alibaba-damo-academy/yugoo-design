import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  loadDesignKit, validatorFromSchemaYaml, validateSkillDesign, renderDeclarativeState,
  DesignFilesStore, GitVersioning, applyPanelEdit,
} from '../lib/index.js'
import { localizePanelManifest, validatePanelManifest } from '../lib/panel-dsl.js'

// Real authored Bundle in a synthetic Kit composition: no installed Kit or user project.
const authored = fileURLToPath(new URL('../../skills-web-app/bundles/quality_acceptance/', import.meta.url))
const kitRoot = resolve('.quality-groups-fixture-not-written')
const virtualBundle = join(kitRoot, 'skills/quality_acceptance')
const files = new Map([[join(kitRoot, 'mindset.md'),
  '---\nname: acceptance_fixture\nversion: "1.0"\n---\n<design_skills>\n## quality_acceptance\n</design_skills>\n']])
async function collect(path, relative = '') {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const next = join(relative, entry.name)
    if (entry.isDirectory()) await collect(join(path, entry.name), next)
    else files.set(join(virtualBundle, next), await readFile(join(path, entry.name), 'utf8'))
  }
}
await collect(authored)
const kit = await loadDesignKit({
  readText: async path => files.get(path),
  listDir: async path => [...new Set([...files.keys()]
    .filter(file => file.startsWith(path + '/'))
    .map(file => file.slice(path.length + 1).split('/')[0]))],
  isDirectory: async path => [...files.keys()].some(file => file.startsWith(path + '/')),
}, kitRoot, { sourceId: 'fixture:quality-acceptance-groups' })
const bundle = kit.skills.find(skill => skill.name === 'quality_acceptance')
const validate = validatorFromSchemaYaml(bundle.metadata.schemaYaml)
const sample = JSON.parse(files.get(join(virtualBundle, 'reference/preview.json')))
const resources = Object.entries(kit.resources)
const contract = resources.find(([key, content]) => key.endsWith('/reference/artifact-contract.md') &&
  content === files.get(join(virtualBundle, 'reference/artifact-contract.md')))?.[1]

test('actual acceptance Bundle loads optional grouping, reachable contract and both localized panels', async () => {
  assert.equal(kit.skills.length, 1)
  assert.equal(String(bundle.version), '1.0')
  assert.equal(bundle.execution.handoff, 'none')
  assert.equal(bundle.metadata.panelManifest.ui.navigation_group_by, 'group')
  assert.equal(bundle.metadata.panelManifest.ui.navigation_layout, 'list')
  assert.equal(typeof contract, 'string', 'contract is reachable through the loaded Bundle resources')
  assert.ok(bundle.content.includes('reference/artifact-contract.md'))
  for (const locale of ['zh-CN', 'en-US']) {
    const panel = localizePanelManifest(bundle.metadata.panelManifest, locale)
    assert.deepEqual(validatePanelManifest(panel), [])
    assert.ok(!JSON.stringify(panel).includes('$t:'))
    const group = panel.fields.find(field => field.key === 'group')
    assert.equal(group.control, 'text')
    assert.equal(group.required, undefined)
    assert.deepEqual(group.applies_to, ['requirements'])
  }
  assert.equal(validate(sample).ok, true)
  assert.deepEqual(await validateSkillDesign(bundle, sample, { scopes: ['state', 'completion'] }), [])
})

test('old data, blank labels and arbitrary free labels remain valid without new completion gates', async () => {
  const legacy = structuredClone(sample)
  for (const record of Object.values(legacy.requirements)) delete record.group
  for (const label of [undefined, '', '   ', 'AI 能力', '部署检查 / 用户自定', 'Ungrouped']) {
    const state = structuredClone(legacy)
    if (label !== undefined) state.requirements['Q-PREVIEW-001'].group = label
    assert.equal(validate(state).ok, true, String(label))
    assert.deepEqual(await validateSkillDesign(bundle, state, { scopes: ['state', 'completion'] }), [])
  }
  for (const label of [null, 42, false, [], {}]) {
    const invalid = structuredClone(legacy)
    invalid.requirements['Q-PREVIEW-001'].group = label
    assert.equal(validate(invalid).ok, false, 'a label is not a second data model')
  }
  const invalidOrder = structuredClone(legacy)
  invalidOrder.requirement_order.pop()
  assert.ok((await validateSkillDesign(bundle, invalidOrder, { scopes: ['state'] }))
    .some(issue => issue.code === 'quality_acceptance.invalid_order'))
  const invalidId = structuredClone(legacy)
  invalidId.requirements['Q-PREVIEW-001'].id = 'different'
  assert.ok((await validateSkillDesign(bundle, invalidId, { scopes: ['state'] }))
    .some(issue => issue.code === 'quality_acceptance.invalid_id'))
  const incomplete = structuredClone(legacy)
  incomplete.requirements['Q-PREVIEW-001'].pass_criteria = ''
  assert.deepEqual(await validateSkillDesign(bundle, incomplete, { scopes: ['state'] }), [])
  assert.ok((await validateSkillDesign(bundle, incomplete, { scopes: ['completion'] }))
    .some(issue => issue.code === 'quality_acceptance.missing_pass_criteria'))
})

test('summary locates real labels without adding categories to ungrouped records', () => {
  const before = structuredClone(sample)
  const summary = renderDeclarativeState(sample, bundle).join('\n')
  assert.ok(summary.includes('group=业务流程'))
  assert.ok(summary.includes('group=AI 能力'))
  assert.ok(summary.includes(sample.requirements['Q-PREVIEW-002'].title))
  assert.deepEqual(sample, before)
  assert.equal(Object.hasOwn(sample.requirements['Q-PREVIEW-002'], 'group'), false)
})

test('shared Panel save durably retains free labels, IDs/order and unedited criteria after reopen', async t => {
  const project = await mkdtemp(join(tmpdir(), 'quality-groups-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const io = {
    async readText(path) { try { return await readFile(path, 'utf8') } catch (e) {
      if (e.code === 'ENOENT') return undefined; throw e
    } },
    listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
    writeText: async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) },
    ensureDir: path => mkdir(path, { recursive: true }),
  }
  const run = promisify(execFile)
  const spawn = async ({ argv, cwd, env }) => {
    try { return { exitCode: 0, ...await run(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env } }) } }
    catch (e) { return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' } }
  }
  const git = new GitVersioning(spawn, project, 'design_files')
  await git.ensureRepo()
  const open = () => new DesignFilesStore(io, new GitVersioning(spawn, project, 'design_files'), join(project, 'design_files'))
  const store = open()
  await applyPanelEdit(store, { skill: bundle.name, state: sample }, async () => {}, validate)
  const edited = structuredClone(sample)
  edited.requirements['Q-PREVIEW-001'].group = 'AI 能力 / 用户自定'
  edited.requirements['Q-PREVIEW-003'].group = ''
  const saved = await applyPanelEdit(store, { skill: bundle.name, state: edited }, async () => {}, validate)
  assert.ok(saved.commit)
  assert.ok(saved.diff.includes('AI 能力 / 用户自定'))
  const reopened = await open().read(bundle.name)
  assert.deepEqual(reopened, edited)
  assert.deepEqual(reopened.requirement_order, sample.requirement_order)
  assert.deepEqual(reopened.requirements['Q-PREVIEW-002'], sample.requirements['Q-PREVIEW-002'])
  for (const id of sample.requirement_order) {
    assert.equal(reopened.requirements[id].id, id)
    for (const field of ['title', 'condition', 'pass_criteria', 'verification'])
      assert.equal(reopened.requirements[id][field], sample.requirements[id][field])
  }
  const head = await store.head()
  const invalid = structuredClone(edited)
  invalid.requirements['Q-PREVIEW-001'].group = { name: 'invalid' }
  await assert.rejects(applyPanelEdit(store, { skill: bundle.name, state: invalid }, async () => {}, validate))
  assert.equal(await store.head(), head)
  assert.deepEqual(await open().read(bundle.name), edited)
})
