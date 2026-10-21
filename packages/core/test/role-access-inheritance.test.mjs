/** Actual content loader and Files/Git; synthetic roles, no native-model or installed UI claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath, mkdir, mkdtemp, writeFile, unlink, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadDesignKit, validateSkillDesign, validatorFromSchemaYaml, parseSchemaYaml,
  renderDeclarativeState, DesignFilesStore, GitVersioning, applyPanelEdit } from '../lib/index.js'
const { register } = await import('tsx/esm/api'); register()
// The legacy Design Files projection is distinct from the accepted-assertion
// projector exported by Core's index. Check this source boundary explicitly.
const { projectDesignGraph } = await import('../src/design-graph.ts')
const { applyDesignEditToDraft, recordDeletionUpdates } = await import('../../panel/src/record-state.ts')
const exec = promisify(execFile)
const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (e) { if (e.code === 'ENOENT') return undefined; throw e } },
  readBytes: async path => { try { return await readFile(path) } catch (e) { if (e.code === 'ENOENT') return undefined; throw e } },
  writeText: async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) },
  writeBytes: async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) },
  ensureDir: path => mkdir(path, { recursive: true }), removeFile: unlink, listDir: readdir,
  isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
const kit = await loadDesignKit(fs, new URL('../../skills-web-app/', import.meta.url).pathname, { sourceId: 'role-inheritance-test' })
const skill = kit.skills.find(s => s.name === 'role_access'), panel = skill.metadata.panelManifest
const example = JSON.parse(kit.resources['role_access/reference/example.json'])
const flat = JSON.parse(kit.resources['role_access/reference/artifact-contract.md'].match(/```json\n([\s\S]*?)\n```/)[1])
const edge = (id, source, target) => ({ id, title: '继承权限', kind: 'inherits', source, target })

test('actual loader retains version 1.0 and schema 5, accepting old flat state, empty inheritance and multilevel chains', async () => {
  assert.equal(skill.version, '1.0')
  assert.equal(skill.execution.handoff, 'must_edit')
  assert.equal(example.schema_version, 5)
  for (const state of [flat, { ...flat, inheritances: {} }, example]) assert.deepEqual(await validateSkillDesign(skill, state), [])
  assert.match(skill.content, /reference\/artifact-contract.md/)
  assert.match(kit.resources['role_access/reference/artifact-contract.md'], /\[the synthetic inheritance example\]\(example.json\)/)
  assert.ok(kit.resources['role_access/reference/example.json'])
  const graph = panel.ui.children.find(node => node.component === 'relation_graph').graph
  assert.equal(panel.ui.workspace_view, 'switch')
  assert.equal(graph.nodes, 'roles'); assert.equal(graph.edges, 'inheritances')
  assert.equal(graph.hierarchy.max_parents, 1)
  assert.equal(graph.hierarchy.create.edge_kind, 'inherits')
  assert.equal(panel.ui.children.find(node => node.component === 'record_inspector').children[0].inherit_from_graph, true)
  assert.equal(panel.sections.find(section => section.id === 'policies').navigation, 'contextual')
})

test('state and completion reject self/cycles/dangling/second parents/duplicate edges/identity mismatch', async () => {
  for (const [mutate, code] of [
    [s => { s.inheritances.self = edge('self', 'R-PREVIEW-A', 'R-PREVIEW-A') }, 'role_access.cyclic_inheritance'],
    [s => { s.inheritances.loop = edge('loop', 'R-PREVIEW-A', 'R-PREVIEW-C') }, 'role_access.cyclic_inheritance'],
    [s => { s.inheritances['RI-PREVIEW-B-A'].source = 'absent' }, 'role_access.invalid_inheritance_endpoint'],
    [s => { s.inheritances['RI-PREVIEW-B-A'].target = 'absent' }, 'role_access.invalid_inheritance_endpoint'],
    [s => { s.inheritances.second = edge('second', 'R-PREVIEW-C', 'R-PREVIEW-A') }, 'role_access.multiple_parents'],
    [s => { s.inheritances.duplicate = edge('duplicate', 'R-PREVIEW-C', 'R-PREVIEW-B') }, 'role_access.multiple_parents'],
    [s => { s.inheritances['RI-PREVIEW-B-A'].id = 'wrong' }, 'role_access.invalid_inheritance_id'],
    [s => { s.policies['AP-PREVIEW-A'].role_ref = 'absent' }, 'role_access.invalid_policy_role'],
  ]) for (const scope of ['state', 'completion']) {
    const bad = structuredClone(example); mutate(bad)
    assert.ok((await validateSkillDesign(skill, bad, { scopes: [scope] })).some(issue => issue.code === code), `${code}/${scope}`)
  }
  for (const mutate of [s => { s.inheritances['RI-PREVIEW-B-A'].kind = 'organization-rank' },
    s => { s.roles['R-PREVIEW-B'].parent_ref = 'R-PREVIEW-A' },
    s => { s.effective_policies = {} }, s => { delete s.inheritances['RI-PREVIEW-B-A'].target }]) {
    const bad = structuredClone(example); mutate(bad)
    assert.ok((await validateSkillDesign(skill, bad)).some(issue => issue.code === 'schema_violation'))
  }
})

test('inheritance references preserve previous KAG source IDs; summaries expose edges without copying policies', () => {
  const file = 'role_access/role_access.json', schema = parseSchemaYaml(skill.metadata.schemaYaml)
  const old = structuredClone(example); delete old.inheritances
  const graph = state => projectDesignGraph({ [file]: state }, 'checkpoint', { [file]: schema }, { purpose: 'storage' })
  const previous = graph(old), current = graph(example)
  for (const node of previous.nodes) assert.equal(current.nodes.find(n => n.pointer === node.pointer)?.id, node.id)
  for (const [id, value] of Object.entries(example.inheritances)) {
    const node = current.nodes.find(n => n.pointer === `/inheritances/${id}`)
    for (const endpoint of ['source', 'target']) {
      const role = current.nodes.find(n => n.pointer === `/roles/${value[endpoint]}`)
      assert.ok(current.edges.some(e => e.kind === 'identifier-match' && e.from === node.id && e.to === role.id))
    }
  }
  const summary = renderDeclarativeState(example, skill).join('\n')
  assert.match(summary, /source=R-PREVIEW-B/); assert.match(summary, /target=R-PREVIEW-A/)
  assert.match(summary, /核对请求归属后才能修改/)
  assert.deepEqual(Object.keys(example.policies), example.policy_order)
})

test('canonical edit/delete and real Panel Save/reopen preserve original policy conditions, verification and local assignment', async t => {
  const root = await mkdtemp(join(tmpdir(), 'role-inheritance-')); t.after(() => rm(root, { recursive: true, force: true }))
  const spawn = async ({ argv, cwd, signal, env }) => { try { return { exitCode: 0, ...await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env } }) } } catch (e) { return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' } } }
  const git = new GitVersioning(spawn, root, 'design_files'); await git.ensureRepo()
  const store = new DesignFilesStore(fs, git, join(root, 'design_files'))
  await applyPanelEdit(store, { skill: 'role_access', state: example }, async () => {}, validatorFromSchemaYaml(skill.metadata.schemaYaml))
  const reopened = new DesignFilesStore(fs, new GitVersioning(spawn, root, 'design_files'), join(root, 'design_files'))
  assert.deepEqual(await reopened.read('role_access'), example)
  const edited = applyDesignEditToDraft(example, panel, { section: 'inheritances', record: 'RI-PREVIEW-C-B', field: 'description', value: '用户明确调整的继承依据（合成测试）' })
  assert.deepEqual(await validateSkillDesign(skill, edited), [])
  await applyPanelEdit(reopened, { skill: 'role_access', state: edited }, async () => {}, validatorFromSchemaYaml(skill.metadata.schemaYaml))
  const saved = await store.read('role_access')
  assert.deepEqual(saved.policies, example.policies); assert.deepEqual(saved.roles, example.roles)
  const removed = recordDeletionUpdates(panel, saved, 'roles', 'R-PREVIEW-B').updates
  assert.ok(!removed.roles['R-PREVIEW-B']); assert.deepEqual(removed.inheritances, {})
  assert.ok(removed.policies['AP-PREVIEW-A']); assert.ok(removed.policies['AP-PREVIEW-C'])
  assert.ok(!removed.policies['AP-PREVIEW-B'])
  const after = { ...saved, ...removed }
  assert.deepEqual(await validateSkillDesign(skill, after), [])
  await applyPanelEdit(reopened, { skill: 'role_access', state: after }, async () => {}, validatorFromSchemaYaml(skill.metadata.schemaYaml))
  assert.deepEqual(await store.read('role_access'), after)
})
