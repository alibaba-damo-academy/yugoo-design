import { webAppBundleUrl } from './web-app-content-fixture.mjs'
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
const { parseSchemaYaml, validatorFromSchemaYaml } = await import('../src/schema.ts')
const { parseValidationYaml, evaluateValidationRules } = await import('../src/validation-rules.ts')
const { projectDesignGraph } = await import('../src/design-graph.ts')
const { DesignFilesStore } = await import('../src/design-files.ts')
const { GitVersioning } = await import('../src/git.ts')
const { applyPanelEdit } = await import('../src/panel-save.ts')
const exec = promisify(execFile)
const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (e) { if (e.code === 'ENOENT') return undefined; throw e } },
  readBytes: async path => { try { return await readFile(path) } catch (e) { if (e.code === 'ENOENT') return undefined; throw e } },
  writeText: async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) },
  writeBytes: async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) },
  ensureDir: path => mkdir(path, { recursive: true }), removeFile: unlink, listDir: readdir,
  isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
const kit = await loadDesignKit(fs, new URL('../../skills-web-app/', import.meta.url).pathname, { sourceId: 'business-test' })
const skill = kit.skills.find(s => s.name === 'business_data')
const example = JSON.parse(await readFile(webAppBundleUrl('business_data/reference/example.json'), 'utf8'))
const edge = (id, source, target, kind = 'generalization') => ({ id, kind, name: '是一种', source, target })

test('loaded 1.0 Bundle accepts additive relations, unknown quantities, self association and multi-parent diamonds', async () => {
  assert.equal(kit.version, '1.0'); assert.equal(skill.version, '1.0')
  assert.ok(kit.resources['business_data/reference/example.json'])
  const old = structuredClone(example); delete old.relations
  const unknown = structuredClone(example); delete unknown.relations['references-paper'].source_count; delete unknown.relations['references-paper'].target_count
  const self = structuredClone(example); self.relations.self = edge('self', 'project', 'project', 'association')
  const diamond = structuredClone(example)
  diamond.objects.special = { ...structuredClone(example.objects['experimental-project']), id: 'special', name: '专项项目' }; diamond.object_order.push('special')
  diamond.relations.b = edge('b', 'paper', 'project'); diamond.relations.c = edge('c', 'special', 'paper'); diamond.relations.d = edge('d', 'special', 'experimental-project')
  for (const state of [old, example, unknown, self, diamond]) assert.deepEqual(await validateSkillDesign(skill, state), [])
})

test('actual contract rejects cycles, dangling endpoints, identity mismatch and quantities on inheritance', async () => {
  for (const mutate of [
    s => { s.relations.loop = edge('loop', 'project', 'experimental-project') },
    s => { s.relations.loop = edge('loop', 'project', 'project') },
    s => { s.relations['references-paper'].target = 'absent' },
    s => { s.relations['references-paper'].id = 'wrong' },
    s => { s.relations['inherits-project'].source_count = '1' },
    s => { s.relations['inherits-project'].target_count = null },
    s => { s.relations['references-paper'].source_count = 'many' },
    s => { s.relations['references-paper'].name = '' },
  ]) { const bad = structuredClone(example); mutate(bad); assert.ok((await validateSkillDesign(skill, bad)).length > 0) }
})

test('acyclic and conditional absence primitives work without Kit-specific field names', async () => {
  const doc = parseValidationYaml(`skill: custom\nrules:\n  - id: cycle\n    scope: [state]\n    code: cycle\n    message: cycle\n    check: { acyclic_record_edges: { map: links, source: child, target: parent, where: {field: category, equals: ancestry} } }\n  - id: forbidden\n    scope: [state]\n    code: forbidden\n    message: forbidden\n    check: { for_each_in_map: links, fields_absent_when: { field: category, equals: ancestry, fields: [quantity] } }`)
  const state = {links: {a: {child: 'x', parent: 'y', category: 'ancestry'}, b: {child: 'y', parent: 'x', category: 'reference'}}}
  assert.deepEqual(await evaluateValidationRules(doc, {skill: 'custom', state}, 'state'), [])
  state.links.b.category = 'ancestry'; assert.ok((await evaluateValidationRules(doc, {skill: 'custom', state}, 'state')).length)
  state.links.b.category = 'reference'; state.links.a.quantity = ''; assert.ok((await evaluateValidationRules(doc, {skill: 'custom', state}, 'state')).length)
})

test('new endpoint references preserve all existing graph node identities', () => {
  const file = 'business_data/business_data.json', schema = parseSchemaYaml(skill.metadata.schemaYaml)
  const old = structuredClone(example); delete old.relations
  const graph = state => projectDesignGraph({[file]: state}, 'checkpoint', {[file]: schema}, {purpose: 'storage'})
  const previous = graph(old), current = graph(example)
  for (const node of previous.nodes) assert.equal(current.nodes.find(n => n.pointer === node.pointer)?.id, node.id)
  for (const id of Object.keys(example.relations)) {
    const node = current.nodes.find(n => n.pointer === `/relations/${id}`)
    assert.ok(node)
    for (const endpoint of ['source', 'target']) {
      const object = current.nodes.find(n => n.pointer === `/objects/${example.relations[id][endpoint]}`)
      assert.ok(current.edges.some(e => e.kind === 'identifier-match' && e.from === node.id && e.to === object.id))
    }
  }
})

test('real Panel Save and reopening preserve relationship facts and old object fields', async t => {
  const root = await mkdtemp(join(tmpdir(), 'business-relations-')); t.after(() => rm(root, {recursive: true, force: true}))
  const spawn = async ({argv, cwd, signal, env}) => { try { return {exitCode: 0, ...await exec(argv[0], argv.slice(1), {cwd, signal, env: {...process.env, ...env}})} } catch(e) { return {exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? ''} } }
  const git = new GitVersioning(spawn, root, 'design_files'); await git.ensureRepo()
  const store = new DesignFilesStore(fs, git, join(root, 'design_files'))
  await applyPanelEdit(store, {skill: 'business_data', state: example}, async () => {}, validatorFromSchemaYaml(skill.metadata.schemaYaml))
  const reopened = new DesignFilesStore(fs, new GitVersioning(spawn, root, 'design_files'), join(root, 'design_files'))
  assert.deepEqual(await reopened.read('business_data'), example)
  const renamed = structuredClone(example); renamed.objects.project.name = '研究项目'
  await applyPanelEdit(reopened, {skill: 'business_data', state: renamed}, async () => {}, validatorFromSchemaYaml(skill.metadata.schemaYaml))
  const saved = await store.read('business_data'); assert.deepEqual(saved.relations, example.relations); assert.deepEqual(saved.objects.project.fields, example.objects.project.fields)
})

test('frozen good/bad business snapshots remain byte-identical and valid without relations', async () => {
  const base = new URL('../../../examples/research-platform-comparison/', import.meta.url)
  const good = await readFile(new URL('good/design_files/business_data/business_data.json', base))
  const bad = await readFile(new URL('bad/design_files/business_data/business_data.json', base))
  assert.deepEqual(good, bad)
  assert.deepEqual(await validateSkillDesign(skill, JSON.parse(good)), [])
})
