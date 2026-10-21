import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
const { register } = await import('tsx/esm/api'); register()
const { projectDesignGraph } = await import('../src/design-graph.ts')
const { parseSchemaYaml, compileSchema } = await import('../src/schema.ts')
const file = 'tasks/tasks.json'
const metadata = { role: 'metadata' }
const reference = target => ({ type: 'string', knowledge: { role: 'reference', ...(target ? { target } : {}) } })
const collection = properties => ({ type: 'map', value: { type: 'object', properties } })
const project = (root, schema) => projectDesignGraph({ [file]: root }, 'c', { [file]: schema }, { purpose: 'storage' })

test('metadata is a schema role, not a field-name blacklist, and never changes original bytes', () => {
  const schema = { type: 'object', properties: {
    schema_version: { type: 'number', knowledge: metadata }, skill_name: { type: 'string', knowledge: metadata },
    opaque: { type: 'object', knowledge: metadata }, order: { type: 'array', items: { type: 'string' }, knowledge: metadata },
    tasks: collection({ title: { type: 'string' }, epoch: { type: 'number', knowledge: metadata } }),
  } }
  const root = { schema_version: 8, skill_name: 'system-name', opaque: { text: '系统内部文本' }, order: ['a'],
    version: 12, tasks: { a: { title: '发布版本', version: 3, schema_version: '业务数据格式版本', epoch: 44 } } }
  const original = JSON.stringify(root), graph = project(root, schema)
  const fields = new Map(graph.nodes.flatMap(n => n.fields).map(f => [f.pointer, f.text]))
  for (const pointer of ['/schema_version', '/skill_name', '/opaque/text', '/order/0', '/tasks/a/epoch']) assert.equal(fields.has(pointer), false)
  assert.equal(fields.get('/version'), '12')
  assert.equal(fields.get('/tasks/a/version'), '3')
  assert.equal(fields.get('/tasks/a/schema_version'), '业务数据格式版本')
  assert.equal(JSON.stringify(root), original)
  const prior = project(root, {})
  for (const node of graph.nodes.filter(n => n.pointer.startsWith('/tasks/a'))) {
    assert.equal(node.id, prior.nodes.find(n => n.pointer === node.pointer)?.id, node.pointer)
  }
  assert.equal(project({ schema_version: 8, opaque: {} }, schema).nodes.length, 0)
})

test('reference roles scope equality to actual collection members, never prose or aggregate keys', () => {
  const schema = { type: 'object', properties: {
    tasks: collection({ link: reference('#/roles'), links: { type: 'array', items: reference('#/roles') },
      unknown: reference(), configRef: reference(), missing: reference('#/roles') }),
    roles: collection({}), others: collection({}), config: { type: 'object' },
  } }
  const graph = project({ tasks: { a: { title: '需要审批的任务', link: 'x', links: ['x'], unknown: 'x',
    caption: 'x', configRef: 'config', missing: 'missing' } },
    roles: { x: { title: '审批人' } }, others: { x: { title: '不相关记录' } }, config: { title: '系统布局' } }, schema)
  const edges = graph.edges.filter(e => e.kind === 'identifier-match')
  assert.equal(edges.length, 1)
  assert.equal(graph.nodes.find(n => n.id === edges[0].to).pointer, '/roles/x')
  assert.deepEqual(JSON.parse(edges[0].evidence).sort(), [file + '#/tasks/a/link', file + '#/tasks/a/links/0'])
  assert.ok(graph.nodes.some(n => n.pointer === '/tasks/a/caption'), 'prose equal to ID must not disappear')
  assert.ok(graph.nodes.find(n => n.pointer === '/tasks/a').fields.some(f => f.pointer.endsWith('/missing')), 'unresolved refs remain evidence')
  assert.equal(graph.nodes.some(n => ['/tasks/a/link', '/tasks/a/links/0'].includes(n.pointer)), false)
  assert.equal(project({ tasks: { a: { title: '任务', caption: 'x' } }, roles: { x: { title: '角色' } } }, {}).edges.some(e => e.kind === 'identifier-match'), false)
})

test('qualified references and collection targets support escaped IDs, nested maps and arrays', () => {
  const files = {
    [file]: { tasks: { a: { title: '使用组件', qualified: 'styles:item', nested: 'a/b~c', array: 'arr' } } },
    'styles/styles.json': { config: { title: '样式', patterns: { 'a/b~c': { title: '嵌套模式' } } }, items: { item: { title: '组件' } }, arr: [{ id: 'arr', title: '数组条目' }] },
    'other/other.json': { items: { item: { title: '另一个组件' } } },
  }
  const schemas = {
    [file]: { type: 'object', properties: { tasks: collection({ qualified: reference(), nested: reference('styles/styles.json#/config/patterns'), array: reference('styles/styles.json#/arr') }) } },
    'styles/styles.json': { type: 'object', properties: { config: { type: 'object', properties: { patterns: collection({}) } }, items: collection({}), arr: { type: 'array', items: { type: 'object' } } } },
    'other/other.json': { type: 'object', properties: { items: collection({}) } },
  }
  const graph = projectDesignGraph(files, 'c', schemas, { purpose: 'storage' })
  assert.deepEqual(graph.edges.filter(e => e.kind === 'identifier-match').map(e => graph.nodes.find(n => n.id === e.to).pointer).sort(), ['/arr/0', '/config/patterns/a~1b~0c', '/items/item'])
})

test('projection annotations validate strictly but do not change the Design File contract', () => {
  const source = 'type: object\nproperties:\n  schema_version: {type: number, knowledge: {role: metadata}}\n  ref: {type: string, knowledge: {role: reference, target: "#/roles"}}\n'
  const schema = parseSchemaYaml(source)
  const plain = structuredClone(schema); delete plain.properties.schema_version.knowledge; delete plain.properties.ref.knowledge
  for (const value of [{ schema_version: 8, ref: 'a' }, { schema_version: 'bad', ref: 3 }, {}]) assert.deepEqual(compileSchema(schema)(value), compileSchema(plain)(value))
  for (const annotation of ['{role: typo}', '{role: reference, target: 3}', '{role: metadata, target: "#/x"}', '{role: reference, target: "#/bad~2"}', '{role: reference, extra: true}']) {
    assert.throws(() => parseSchemaYaml('type: string\nknowledge: ' + annotation), /knowledge/)
  }
  assert.throws(() => parseSchemaYaml('type: number\nknowledge: {role: reference}'), /reference requires/)
})

test('all bundled schemas parse; frozen fixtures exclude only declared metadata and keep business IDs', async () => {
  const root = webAppBundleUrl('')
  const schemas = {}
  for (const name of await readdir(root)) {
    try { schemas[`${name}/${name}.json`] = parseSchemaYaml(await readFile(new URL(`${name}/schema.yaml`, root), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  for (const variant of ['good', 'bad']) {
    const base = new URL(`../../../examples/research-platform-comparison/${variant}/design_files/`, import.meta.url)
    const files = {}
    for (const name of await readdir(base)) {
      const path = `${name}/${name}.json`
      files[path] = JSON.parse(await readFile(new URL(path, base), 'utf8'))
      assert.deepEqual(compileSchema(schemas[path])(files[path]), [], path)
    }
    const graph = projectDesignGraph(files, 'c', schemas, { purpose: 'storage' })
    assert.ok(graph.nodes.length > 2000)
    assert.equal(graph.nodes.flatMap(n => n.fields).some(f => /^\/(?:schema_version|skill_name|epoch|style_epoch)(?:\/|$)/u.test(f.pointer)), false)
    const business = graph.nodes.find(n => n.file === 'business_rules/business_rules.json' && n.pointer === '/rules/immutable-source-version')
    assert.ok(business)
    const page = graph.nodes.find(n => n.file === 'page_design/page_design.json' && n.pointer.startsWith('/pages/') && n.record)
    assert.ok(graph.edges.some(e => e.kind === 'identifier-match' && e.from === page.id))
  }
})
