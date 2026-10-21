import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join, dirname, posix } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadDesignKit } from '../src/kit-loader.ts'
import { validatorFromSchemaYaml } from '../src/schema.ts'
import { validateSkillDesign } from '../src/validate-design.ts'
import { localizePanelManifest, validatePanelManifest } from '../src/panel-dsl.ts'
import { reconstructionContractPrompt } from '../src/reconstruction-prompt.ts'
import { renderDeclarativeState } from '../src/renderer.ts'
import { DesignFilesStore } from '../src/design-files.ts'
import { GitVersioning } from '../src/git.ts'
import { applyPanelEdit } from '../src/panel-save.ts'

const root = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
const io = {
  async readText(path) { try { return await readFile(path, 'utf8') } catch (e) {
    if (e.code === 'ENOENT') return undefined; throw e
  } },
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
  writeText: async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) },
  ensureDir: path => mkdir(path, { recursive: true }),
}
const kit = await loadDesignKit(io, root, { sourceId: 'fixture:ai-knowledge-resources' })
const bundle = kit.skills.find(skill => skill.name === 'ai_agent_capabilities')
const validate = validatorFromSchemaYaml(bundle.metadata.schemaYaml)
const sample = JSON.parse(kit.resources[`${bundle.name}/reference/preview.json`])
const optional = ['source_and_maintenance', 'formation_and_update', 'user_management', 'access_scope']
function links(text, from) {
  return [...text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/gu)].map(match => match[1].split('#')[0])
    .filter(path => !/^[a-z][a-z\d+.-]*:/iu.test(path))
    .map(path => posix.normalize(posix.join(posix.dirname(from), path)))
}

test('loaded knowledge/memory forms have distinct localized product fields without new required facts', async () => {
  assert.equal(String(bundle.version), '1.0')
  assert.equal(sample.schema_version, 1)
  assert.equal(bundle.execution.handoff, 'must_edit')
  for (const name of ['preview.json', 'example.json']) {
    const state = JSON.parse(kit.resources[`${bundle.name}/reference/${name}`])
    assert.equal(validate(state).ok, true)
    assert.deepEqual(await validateSkillDesign(bundle, state, { scopes: ['state', 'completion'] }), [])
  }
  for (const locale of ['zh-CN', 'en-US']) {
    const panel = localizePanelManifest(bundle.metadata.panelManifest, locale)
    assert.deepEqual(validatePanelManifest(panel), [])
    assert.equal(JSON.stringify(panel).includes('$t:'), false)
    const fields = Object.fromEntries(panel.fields.map(field => [field.key, field]))
    assert.deepEqual(fields.description.label_when.map(rule => rule.label), locale === 'zh-CN'
      ? ['资料内容', '记住什么'] : ['Material content', 'What to remember'])
    assert.deepEqual(fields.source_and_maintenance.visible_when, { field: 'kind', in: ['knowledge_base'] })
    for (const field of ['formation_and_update', 'user_management'])
      assert.deepEqual(fields[field].visible_when, { field: 'kind', in: ['long_term_memory'] })
    for (const field of [...optional, 'notes']) assert.equal(fields[field].required, undefined)
    assert.deepEqual(fields.kind.options.map(option => option.value), ['knowledge_base', 'long_term_memory'])
    assert.equal(fields.kind.choice_layout, 'row_wrap')
  }
})

test('minimal existing resources remain valid; optional types and actual local references still reject defects', async () => {
  const minimal = { schema_version: 1, knowledge_resources: {
    kb: { id: 'kb', name: 'Library', kind: 'knowledge_base' },
    memory: { id: 'memory', name: 'Preferences', kind: 'long_term_memory', description: 'Keep original broad user text' },
  }, agents: { agent: { id: 'agent', name: 'Reader', description: 'Read permitted sources', knowledge_resource_refs: ['kb', 'memory'] } } }
  const before = structuredClone(minimal)
  assert.equal(validate(minimal).ok, true)
  assert.deepEqual(await validateSkillDesign(bundle, minimal, { scopes: ['state', 'completion'] }), [])
  assert.deepEqual(minimal, before, 'validation cannot migrate legacy text or fill defaults')
  for (const field of optional) {
    for (const value of ['', '用户自定\n保持完整内容', undefined]) {
      const state = structuredClone(minimal)
      if (value !== undefined) state.knowledge_resources.kb[field] = value
      assert.equal(validate(state).ok, true, field)
    }
    for (const value of [42, null, [], {}, false]) {
      const invalid = structuredClone(minimal); invalid.knowledge_resources.memory[field] = value
      assert.equal(validate(invalid).ok, false, `${field} must be text`)
    }
  }
  const unknown = structuredClone(minimal); unknown.knowledge_resources.kb.vector_database = 'invented'
  assert.equal(validate(unknown).ok, false, 'closed product record, not a new technical settings slot')
  const dangling = structuredClone(minimal); dangling.agents.agent.knowledge_resource_refs.push('missing')
  assert.ok((await validateSkillDesign(bundle, dangling, { scopes: ['state'] })).length)
})

test('cooperation is a loaded conditional resource reachable from both actual design entries, not an execution grant', () => {
  const prefix = `${bundle.name}/`
  const resources = Object.fromEntries(Object.entries(kit.resources).filter(([path]) => path.startsWith(prefix))
    .map(([path, text]) => [path.slice(prefix.length), text]))
  const guide = 'reference/cooperation-guide.md'
  const contract = 'reference/artifact-contract.md'
  assert.ok(links(bundle.content, 'SKILL.md').includes(guide))
  assert.ok(reconstructionContractPrompt(bundle, kit.resources).includes(contract))
  assert.ok(links(resources[contract], contract).includes(guide))
  for (const path of links(resources[guide], guide)) {
    assert.ok(!path.startsWith('../') && !path.startsWith('/'))
    assert.equal(typeof resources[path], 'string', path)
  }
  const guideText = resources[guide].replace(/\s+/gu, ' ')
  for (const owner of ['function_modules', 'page_design', 'smart_questions', 'integration_design', 'quality_acceptance'])
    assert.ok(guideText.includes(owner), owner)
  assert.match(guideText, /executor writes only its current Bundle/u)
  assert.match(guideText, /not a required sequence/u)
  assert.match(guideText, /reconstruction recover only evidenced existing behavior/u)
  assert.match(guideText, /must_edit/u)
  assert.match(guideText, /parameters of that actually referenced integration belong to its owner/u)
  assert.match(guideText, /AI tools retain their supplied `interface`\/opaque `config_json`/u)
  assert.match(guideText, /external\/MCP alone does not transfer configuration ownership or imply an integration reference/u)
  const summary = renderDeclarativeState(sample, bundle).join('\n')
  for (const [id, resource] of Object.entries(sample.knowledge_resources)) {
    assert.ok(summary.includes(resource.kind), id)
    for (const field of ['description', ...optional]) if (resource[field]) assert.ok(summary.includes(resource[field]), `${id}.${field}`)
  }
})

test('kind switches and optional lifecycle edits durably save/reopen through existing Files/Git; invalid type leaves head/state unchanged', async t => {
  const project = await mkdtemp(join(tmpdir(), 'ai-knowledge-save-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const run = promisify(execFile)
  const spawn = async ({ argv, cwd, env }) => {
    try { return { exitCode: 0, ...await run(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env } }) } }
    catch (e) { return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' } }
  }
  const git = new GitVersioning(spawn, project, 'design_files'); await git.ensureRepo()
  const open = () => new DesignFilesStore(io, new GitVersioning(spawn, project, 'design_files'), join(project, 'design_files'))
  const store = open()
  const edited = structuredClone(sample)
  Object.assign(edited.knowledge_resources['K-material'], {
    formation_and_update: 'Explicitly authored memory formation', user_management: 'View, correct, clear when requested',
  })
  for (const kind of ['knowledge_base', 'long_term_memory', 'knowledge_base']) {
    edited.knowledge_resources['K-material'].kind = kind
    const result = await applyPanelEdit(store, { skill: bundle.name, state: edited }, async () => {}, validate)
    assert.ok(result.commit)
    assert.deepEqual(await open().read(bundle.name), edited, 'inactive branch bytes and every unrelated record survive')
  }
  const head = await store.head()
  const invalid = structuredClone(edited); invalid.knowledge_resources['K-memory'].user_management = {}
  await assert.rejects(applyPanelEdit(store, { skill: bundle.name, state: invalid }, async () => {}, validate))
  assert.equal(await store.head(), head)
  assert.deepEqual(await open().read(bundle.name), edited)
})
