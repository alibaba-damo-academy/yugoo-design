/** Source helper/Remote boundary with real Files/Git. No browser/model claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { stringify } from 'yaml'
const { register } = await import('tsx/esm/api'); register()
const { panelGraphSaveRules } = await import('../src/panel-graph-save-rules.ts')
const { parseValidationYaml } = await import('../src/validation-rules.ts')
const { parsePanelManifest } = await import('../src/panel-dsl.ts')
const { DesignPanelRemote } = await import('../src/panel-remote.ts')
const { DesignFilesStore } = await import('../src/design-files.ts')
const { GitVersioning } = await import('../src/git.ts')
const { nodeFs } = await import('../src/service-tools.ts')
const { DesignJournalStorage } = await import('../src/design-journal-storage.ts')
const exec = promisify(execFile)
const bundleRoot = new URL('../../skills-web-app/bundles/role_access/', import.meta.url)
const text = file => readFile(new URL(file, bundleRoot), 'utf8')
const rule = (id, check, scope = ['state']) => ({ id, code: id, message: id + ' {key}', scope, check })

test('selection follows nested canonical maps/endpoint fields and only declared hierarchy filters', () => {
  const panel = { sections: [{ id: 'vertices', records_path: 'model.objects' }, { id: 'links', records_path: 'model.relations' }],
    ui: { component: 'container', slots: { main: { component: 'relation_graph', graph: {
      nodes: 'vertices', edges: 'links', source_field: 'child', target_field: 'parent',
      edge_kind_field: 'category', hierarchy: { values: ['ancestry'] },
    } } } } }
  const graph = { map: 'model.relations', source: 'child', target: 'parent' }
  const endpoint = value => ({ for_each_in_map: 'model.relations', member_of_map: { value, map: 'model.objects' } })
  const doc = parseValidationYaml(stringify({ skill: 'custom', rules: [
    rule('cycle', { acyclic_record_edges: graph }),
    rule('parent', { single_parent_record_edges: { ...graph, where: { field: 'category', equals: 'ancestry' } } }),
    rule('child', endpoint('child')), rule('target', endpoint('parent')),
    rule('completion-only', { acyclic_record_edges: graph }, ['completion']),
    rule('wrong-map', { acyclic_record_edges: { ...graph, map: 'other' } }),
    rule('wrong-field', { single_parent_record_edges: { ...graph, source: 'owner' } }),
    rule('wrong-filter', { acyclic_record_edges: { ...graph, where: { field: 'condition', equals: 'ancestry' } } }),
    rule('wrong-kind', { acyclic_record_edges: { ...graph, where: { field: 'category', equals: 'other' } } }),
    rule('other-reference', endpoint('owner')),
    rule('other-nodes', { for_each_in_map: 'model.relations', member_of_map: { value: 'child', map: 'other' } }),
    rule('whole-doc', { non_empty_string: 'complete' }),
  ] }))
  assert.deepEqual(panelGraphSaveRules(doc, panel).map(rule => rule.id), ['cycle', 'parent', 'child', 'target'])
  assert.deepEqual(panelGraphSaveRules(doc, undefined), [])
  const noGraph = structuredClone(panel); noGraph.ui.slots.main.component = 'record_inspector'
  assert.deepEqual(panelGraphSaveRules(doc, noGraph), [])
  const nestedFields = structuredClone(panel); nestedFields.sections[1].fields_path = 'properties'
  assert.deepEqual(panelGraphSaveRules(doc, nestedFields), [])
})

test('source Remote rejects forged graph integrity before write, journal settlement or notification; valid edits reopen', async t => {
  const root = await mkdtemp(join(tmpdir(), 'panel-graph-save-')); t.after(() => rm(root, { recursive: true, force: true }))
  const spawn = async ({ argv, cwd, env, signal }) => {
    try { return { exitCode: 0, ...await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env,
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost' } }) } }
    catch (error) { return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
  }
  const git = new GitVersioning(spawn, root); await git.ensureRepo()
  const store = new DesignFilesStore(nodeFs, git, root)
  const journal = new DesignJournalStorage(join(root, '.journal'))
  const conversation = 'graph-save-fixture', project = { projectId: '11111111-1111-4111-8111-111111111111' }
  const skill = { name: 'role_access', version: '1.0', execution: { handoff: 'must_edit' }, metadata: {
    schemaYaml: await text('schema.yaml'), validationYaml: await text('validation.yaml'),
    panelManifest: parsePanelManifest(await text('panel.yaml')),
  } }
  const kit = { name: 'fixture', version: '1.0', skills: [skill] }
  const remote = Object.create(DesignPanelRemote.prototype)
  remote.design = {
    projectForAgent: async () => project,
    withSelectedDesignFilesMutation: async (_agent, _fs, _signal, operation, entered) => { entered?.(); return operation(project, store) },
    withProjectMutationFor: async (_agent, _project, operation) => operation(),
    requireKitForAgent: () => kit,
    designFilesForProject: async () => store,
    readDesignJournal: () => journal.read(conversation),
    assertProjectSelection() {},
    recordDesignChange: async (_agent, _project, data) => {
      await journal.append(conversation, { type: 'design/changed', data })
      return (await journal.read(conversation)).revision
    },
  }
  const notifications = [], agent = { inject(message) { notifications.push(message) } }
  let sequence = 0
  const save = state => remote.savePanel(agent, 'role_access', state, [], `graph-save-${++sequence}`, new AbortController().signal)
  const example = JSON.parse(await text('reference/example.json'))
  const initial = await save(example)
  const head = await store.head(), revision = (await journal.read(conversation)).revision
  assert.equal(initial.commit, head); assert.equal(notifications.length, 1)
  const edge = (id, source, target) => ({ id, title: '继承权限', kind: 'inherits', source, target })
  for (const [mutate, code] of [
    [s => { s.inheritances.self = edge('self', 'R-PREVIEW-A', 'R-PREVIEW-A') }, 'cyclic_inheritance'],
    [s => { s.inheritances.loop = edge('loop', 'R-PREVIEW-A', 'R-PREVIEW-C') }, 'cyclic_inheritance'],
    [s => { s.inheritances.second = edge('second', 'R-PREVIEW-C', 'R-PREVIEW-A') }, 'multiple_parents'],
    [s => { s.inheritances.duplicate = edge('duplicate', 'R-PREVIEW-C', 'R-PREVIEW-B') }, 'multiple_parents'],
    [s => { s.inheritances['RI-PREVIEW-B-A'].source = 'absent' }, 'invalid_inheritance_endpoint'],
    [s => { s.inheritances['RI-PREVIEW-B-A'].target = 'absent' }, 'invalid_inheritance_endpoint'],
    [s => { delete s.inheritances['RI-PREVIEW-B-A'].target }, 'target'],
  ]) {
    const bad = structuredClone(example); mutate(bad)
    await assert.rejects(save(bad), new RegExp(code))
    assert.equal(await store.head(), head); assert.deepEqual(await store.read('role_access'), example)
    assert.equal((await journal.read(conversation)).revision, revision); assert.equal(notifications.length, 1)
  }
  const edited = structuredClone(example)
  edited.inheritances['RI-PREVIEW-C-B'].description = '面板保存修改的合成依据'
  // Existing completion/domain-quality rules are intentionally not new save
  // gates: a user may save an unfinished assignment without forging an edge.
  edited.roles['R-PREVIEW-C'].assignment_rule = ''
  const saved = await save(edited)
  assert.notEqual(saved.commit, head); assert.equal(notifications.length, 2)
  const reopened = new DesignFilesStore(nodeFs, new GitVersioning(spawn, root), root)
  assert.deepEqual(await reopened.read('role_access'), edited)
  assert.deepEqual(edited.policies, example.policies)
  assert.equal((await new DesignJournalStorage(join(root, '.journal')).read(conversation)).revision, revision + 1)
})
