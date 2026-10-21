import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { projectDesignGraph, attachKnowledgeGraph, readDesignGraph } = await import('../src/design-graph.ts')
const { semanticRecordUnits, semanticEdges } = await import('../src/design-semantic.ts')
const { compileDesignOntologyContract } = await import('../src/design-ontology.ts')
const { compileDesignRelationVocabulary } = await import('../src/design-relation-vocabulary.ts')
const file = 'tasks/tasks.json'
const record = { type: 'object', required: ['id', 'caption'], properties: { id: { type: 'string' }, caption: { type: 'string' }, source: { type: 'enum', values: ['ai', 'user'] } } }
const schema = { type: 'object', properties: { tasks: { type: 'map', value: record } } }
const project = (data, spec = schema) => projectDesignGraph({ [file]: data }, 'c', { [file]: spec })
test('single-word multilingual content expands, while map enum plumbing stays on the owner', () => {
  const spec = { type: 'object', properties: { tasks: { type: 'map', value: { type: 'object', properties: {
    caption: { type: 'string' }, actions: { type: 'array', items: { type: 'string' } }, flags: { type: 'map', value: { type: 'enum', values: ['需要审批', '无需审批'] } },
  } } } } }
  for (const action of ['Search', '검색', '検索', '检索']) {
    const graph = project({ tasks: { a: { caption: 'Research workspace', actions: [action], flags: { permission: '需要审批' } } } }, spec)
    assert.ok(graph.nodes.some(n => !n.record && n.label === action))
    assert.ok(!graph.nodes.some(n => n.pointer.startsWith('/tasks/a/flags')))
    assert.match(graph.nodes[0].context, /需要审批/)
  }
})
test('nested array reorder preserves child identity while evidence pointers move', () => {
  const rows = [{ id: 'a', scenario: '接口超时', response: { explanation: '使用备用来源继续查询' } }, { id: 'b', scenario: '结果为空', response: { explanation: '提示调整搜索条件' } }]
  const first = project({ tasks: { x: { id: 'x', caption: '检索任务', rows, order: 1, path: 'preview/file.html', ref: 'F-001' } } })
  const next = project({ tasks: { x: { id: 'x', caption: '检索任务', rows: [...rows].reverse() } } })
  const child = graph => graph.nodes.find(n => n.label === '使用备用来源继续查询')
  assert.equal(child(first).id, child(next).id)
  assert.notEqual(child(first).pointer, child(next).pointer)
  assert.ok(!first.nodes.some(n => ['/order', '/path', '/ref', '/id'].some(suffix => n.pointer.endsWith(suffix))))
  assert.ok(first.edges.some(e => e.kind === 'contains' && e.to === child(first).id))
})
test('semantic inputs and Knowledge target the actual deepest content, not an arbitrary record field', () => {
  const graph = project({ tasks: { a: { id: 'a', caption: '检索任务', rule: '由用户逐条确认推荐' }, b: { id: 'b', caption: '确认功能', behavior: '显示推荐理由与确认操作' } } })
  const child = graph.nodes.find(n => n.pointer === '/tasks/a/rule')
  const containingUnits = graph.semanticUnits.filter(u => u.fieldPointers.includes('/tasks/a/rule'))
  assert.equal(containingUnits.length, 1); assert.equal(containingUnits[0].nodeId, child.id)
  const provenance = locator => ({ checkpoint: 'c', evidence: [{ source: file, revision: 'c', locator }] })
  attachKnowledgeGraph(graph, { entities: [{ id: 'a', provenance: provenance('/tasks/a/rule') }, { id: 'b', provenance: provenance('/tasks/b/behavior') }], relations: [{ id: 'ab', from: 'a', to: 'b', relationType: 'related', lifecycle: 'proposed', provenance: provenance('/tasks/a/rule') }] })
  assert.equal(graph.edges.find(e => e.kind === 'knowledge').from, child.id)
})
test('answered questions only; ordinary saved records need no approval', () => {
  const source = { questions: {
    selected: { prompt: '如何使用？', answer: 'personal', detail: '自有资料', multimodal_answer: [{ text: '补充材料' }], choices: [{ value: 'team', label: '团队协作' }, { value: 'personal', label: '个人使用' }] },
    unknown: { prompt: '未回答？', answer: '', choices: [{ value: 'yes', label: '未选答案' }] },
    free: { prompt: '补充？', answer: '', detail: '未答补充', multimodal_answer: [{ text: '未答附件' }] },
  }, tasks: { 'F-001': { id: 'F-001', caption: '文献检索', source: 'ai' }, gone: { caption: '已删除', deleted: true }, rejected: { caption: '被拒绝', rejected: true } } }
  const original = JSON.stringify(source), graph = projectDesignGraph({ [file]: source }, 'c', { [file]: { ...schema, properties: { ...schema.properties, questions: { type: 'map', value: { type: 'object' } } } } })
  assert.deepEqual(graph.nodes.filter(n => n.record).map(n => n.label), ['个人使用', '文献检索'])
  assert.deepEqual(graph.nodes.filter(n => !n.record).map(n => n.label), ['自有资料', '补充材料'])
  assert.ok(!JSON.stringify(graph).match(/团队协作|未选答案|未答补充|未答附件|已删除|被拒绝/))
  assert.match(graph.nodes[0].context, /自有资料/)
  assert.match(graph.nodes[0].context, /补充材料/)
  assert.equal(JSON.stringify(source), original)
})
test('nested content retains its record and parent hierarchy; answer pointers retain provenance', () => {
  const graph = project({ tasks: { 'F-1': { id: 'F-1', caption: '文献检索', exceptions: [{ scenario: '接口超时', handling: '切换备用数据源' }] } } })
  assert.deepEqual(graph.nodes.filter(n => n.record).map(n => n.pointer), ['/tasks/F-1'])
  assert.deepEqual(graph.nodes.filter(n => !n.record).map(n => n.pointer), ['/tasks/F-1/exceptions/0', '/tasks/F-1/exceptions/0/handling'])
  assert.equal(graph.nodes[2].parentId, graph.nodes[1].id)
  assert.equal(graph.nodes[2].recordId, graph.nodes[0].id)
  assert.ok(graph.nodes[0].fields.some(f => f.pointer === '/tasks/F-1/exceptions/0/handling' && f.text === '切换备用数据源'))
  assert.match(graph.semanticUnits.map(n => n.text).join('\n'), /文献检索[\s\S]*接口超时/)
  const questions = projectDesignGraph({ [file]: {
    question: { prompt: '选择？', answer: 'a,b', choices: [{ value: 'a', label: '阅读' }, { value: 'b', label: '写作' }, { value: 'c', label: '实验' }] },
    'a/b~': { prompt: '说明？', answer: '保留自由回答' },
  } }, 'c')
  assert.equal(questions.nodes[0].label, '阅读；写作')
  assert.equal(questions.nodes[1].pointer, '/a~1b~0')
  assert.ok(questions.nodes[1].fields.some(f => f.pointer === '/a~1b~0/answer'))
  assert.ok(!JSON.stringify(questions).includes('实验'))
})
test('array IDs survive reorder/insertion/edit; keyed records retain identity', () => {
  const spec = { type: 'object', properties: { tasks: { type: 'array', items: record } } }
  const a = { id: 'a', caption: '原名称' }, b = { id: 'b', caption: '相同标题' }
  const first = project({ tasks: [a, b] }, spec)
  const next = project({ tasks: [{ id: 'c', caption: '新增' }, b, { ...a, caption: '新名称' }] }, spec)
  assert.equal(first.nodes[0].id, next.nodes[2].id)
  assert.notEqual(first.nodes[0].pointer, next.nodes[2].pointer)
  assert.ok(next.nodes[2].fields.some(f => f.pointer === '/tasks/2/caption'))
  const one = project({ tasks: { 'F-1': a } }), two = project({ tasks: { 'F-1': { ...a, caption: '改名' } } })
  assert.equal(one.nodes[0].id, two.nodes[0].id)
})
test('ID-only and duplicate records do not become misleading points; identity is file-scoped', () => {
  const graph = projectDesignGraph({ [file]: { items: [{ id: 'x', caption: '重复内容' }, { id: 'x', caption: '重复内容' }], records: { empty: { id: 'F-001' } } } }, 'c')
  assert.equal(graph.nodes.length, 0)
  assert.ok(graph.warnings.some(x => x.includes('重复')))
  const same = projectDesignGraph({ [file]: { tasks: { x: { id: 'x', caption: '甲内容' } } }, 'other/other.json': { tasks: { x: { id: 'x', caption: '乙内容', reference: 'x' } } } }, 'c')
  assert.equal(same.nodes.filter(n => n.record).length, 2)
  assert.equal(same.edges.filter(e => e.kind === 'identifier-match').length, 0, 'undeclared identifiers must not link')
  const ref = { type: 'string', knowledge: { role: 'reference', target: '#/tasks' } }
  const linked = project({ tasks: { a: { id: 'a', caption: '甲内容' }, b: { id: 'b', caption: '乙内容', link: 'a', another: 'a' } } },
    { type: 'object', properties: { tasks: { type: 'map', value: { ...record, properties: { ...record.properties, link: ref, another: ref } } } } })
  assert.equal(linked.edges.length, 1)
  assert.equal(linked.edges[0].kind, 'identifier-match')
  assert.equal(JSON.parse(linked.edges[0].evidence).length, 2)
})
test('existing schemas preserve aggregate config; renamed domain fields need no whitelist', () => {
  const graph = projectDesignGraph({ [file]: { container: { narrative: '清晰简洁的设计风格', palette: { color: '#fff' }, patterns: [{ caption: '内嵌规则' }] } } }, 'c', {
    [file]: { type: 'object', properties: { container: { type: 'object', properties: { narrative: { type: 'string' } } } } },
  })
  assert.deepEqual(graph.nodes.filter(n => n.record).map(n => n.label), ['清晰简洁的设计风格'])
  assert.equal(graph.nodes[0].pointer, '/container')
  const wrapped = project({ version: '1.0', items: [{ name: '文献整理' }, { name: '研究计划' }] }, { type: 'object', required: ['version'], properties: { version: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } } } })
  assert.deepEqual(wrapped.nodes.map(n => n.label), ['文献整理', '研究计划'])
  assert.deepEqual(wrapped.nodes.map(n => n.pointer), ['/items/0', '/items/1'])
})
test('nested-only saved aggregate is not discarded when it lacks a direct label', async () => {
  const { readFile } = await import('node:fs/promises'), { parseSchemaYaml } = await import('../src/schema.ts')
  const spec = parseSchemaYaml(await readFile(webAppBundleUrl('design_style/schema.yaml'), 'utf8'))
  const graph = project({ config: { colors: { primary: '#7C5AF6' }, brand: { name: '语构' }, typography: { body: 'Arial' } } }, spec)
  assert.equal(graph.nodes.filter(n => n.record).length, 1); assert.equal(graph.nodes[0].pointer, '/config')
  assert.equal(graph.nodes[0].label, '设计风格配置')
  assert.equal(graph.nodes[0].sourceLabel, '语构')
  assert.match(graph.nodes[0].context, /#7C5AF6/)
  assert.equal(project({ config: { colors: { primary: '#7C5AF6' } } }, spec).nodes.length, 2)
})
test('Knowledge subfield evidence maps to record owners, with exact revision and coverage', () => {
  const data = { tasks: { a: { id: 'a', caption: '甲内容' }, b: { id: 'b', caption: '乙内容' } } }
  const graph = project(data)
  const provenance = { checkpoint: 'c', evidence: [{ source: file, revision: 'c', locator: '/tasks/a/caption' }] }
  const knowledge = { entities: [{ id: 'a', provenance }, { id: 'b', provenance: { ...provenance, evidence: [{ source: file, revision: 'c', locator: '/tasks/b/caption' }] } }], relations: [{ id: 'r', from: 'a', to: 'b', relationType: 'related', lifecycle: 'proposed', provenance }] }
  attachKnowledgeGraph(graph, knowledge)
  assert.equal(graph.edges.filter(e => e.kind === 'knowledge').length, 1)
  for (const invalid of [{ ...provenance, checkpoint: 'old' }, { ...provenance, evidence: [...provenance.evidence, { source: file, revision: 'c', locator: '/tasks/a/choices/0/label' }] }]) {
    const other = project(data); knowledge.relations[0].provenance = invalid; attachKnowledgeGraph(other, knowledge)
    assert.equal(other.edges.filter(e => e.kind === 'knowledge').length, 0)
  }
})
test('bounded traversal and contexts are disclosed without fragmenting records', () => {
  let value = { end: true }; for (let i = 0; i < 10000; i++) value = { child: value }
  assert.equal(projectDesignGraph({ [file]: value }, 'c').nodes.length, 0)
  const wide = projectDesignGraph({ [file]: { items: Array(20001).fill({ caption: '重复内容' }) } }, 'c')
  assert.equal(wide.nodes.length, 0); assert.equal(wide.warnings.length, 1)
  const graph = project({ tasks: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [String(i), { id: String(i), caption: '长记录' + i, description: 'x'.repeat(13000) }])) })
  assert.equal(graph.nodes.filter(n => n.record).length, 120)
  assert.ok(graph.nodes.some(n => !n.context))
  assert.ok(graph.semanticUnits.length <= 300)
  assert.ok(graph.warnings.some(w => w.includes('部分覆盖')))
})
test('long-record chunks cover later subfields, aggregate to one pair, never self-link', () => {
  const fields = Array.from({ length: 6 }, (_, i) => ({ pointer: '/records/a/nested/' + i, text: ('内容' + i).repeat(240) }))
  const a = semanticRecordUnits('a', 'a.json', '/records/a', '甲记录', fields)
  assert.ok(a.units.length > 1); assert.equal(a.truncated, false)
  assert.ok(a.units.some(u => u.fieldPointers.includes('/records/a/nested/5')))
  assert.ok(a.units.every(u => u.nodeId === 'a'))
  const b = semanticRecordUnits('b', 'b.json', '/b', '乙记录', [{ pointer: '/b/text', text: '相关内容' }])
  const units = [...a.units, ...b.units], edges = semanticEdges(units, units.map(() => [1,0,0,0,0,0,0,0]), 'test', 'c')
  assert.equal(edges.length, 1); assert.equal(edges[0].from, 'a'); assert.equal(edges[0].to, 'b')
  assert.ok(JSON.parse(edges[0].evidence).sources.every(s => s.fields.length))
  const huge = semanticRecordUnits('a', 'a.json', '/a', '甲', [{ pointer: '/a/text', text: 'x'.repeat(50000) }])
  assert.equal(huge.units.length, 8); assert.equal(huge.truncated, true)
})
test('reader uses committed canonical files only, never writes or reads experiences', async () => {
  const calls = []
  const graph = await readDesignGraph({ listPathsAt: async () => [file, '_experiences/x/view.json', 'tasks/artifact.json'], readTextAt: async (commit, path) => { calls.push([commit, path]); return '{"tasks":{"a":{"id":"a","caption":"已保存内容"}}}' } }, 'c', undefined, { [file]: schema })
  assert.deepEqual(calls, [['c', file]])
  assert.equal(graph.nodes.length, 1)
})
test('actual remote supplies the active Kit schema and tolerates unavailable Knowledge', async () => {
  const { default: Remote } = await import('../src/panel-remote.ts')
  const prototype = Remote?.prototype
  const ontologyContract = compileDesignOntologyContract({ kit: 'fixture', kitVersion: '1.0', schemas: { [file]: schema },
    relationVocabulary: compileDesignRelationVocabulary(undefined, 'fixture', '1.0') })
  const read = { head: async () => 'c', listPathsAt: async () => [file], readTextAt: async () => '{"tasks":{"a":{"id":"a","caption":"已保存内容"}}}' }
  const receiver = { design: { projectForAgent: async () => ({ projectId: 'p' }), designFilesForProject: async () => read,
    kitForAgent: () => ({ ontologyContract, skills: [{ name: 'tasks', metadata: { schemaYaml: JSON.stringify(schema) } }] }),
    knowledgeRecoveryStatus: () => undefined, readStoredDesignGraph: async () => { throw new Error('offline') } } }
  // Exercise the current read body; progress/polling is covered by knowledge-read-progress tests.
  const result = JSON.parse((await prototype.readGraphNow.call(receiver, {}, new AbortController().signal)).content)
  assert.equal(result.checkpoint, 'c'); assert.equal(result.nodes.length, 1)
  assert.ok(!result.warnings.some(w => w.includes('无可用 schema')))
  assert.ok(result.warnings.some(w => w.includes('Knowledge')))
  assert.equal(result.coverage.ontology.contractRevision, ontologyContract.revision)
  assert.equal(result.coverage.ontology.untyped, 0)
  assert.ok(result.coverage.ontology.instantiatedTypes > 0)
  assert.equal(result.semanticUnits, undefined)
  assert.equal(result.nodes[0].fields, undefined)
})
test('actual remote renders stored graph identities without recomputing semantic relationships', async () => {
  const { default: Remote } = await import('../src/panel-remote.ts')
  const stored = { checkpoint: 'c', knowledgeRevision: 'rev:7', freshness: { sourceCheckpoint: 'c', indexedCheckpoint: 'c' }, nodes: [{ id: 'persisted-a', file, context: 'bounded', fields: [{ pointer: '/a', text: 'private index body' }] }], edges: [{ id: 'persisted-edge', from: 'persisted-a', to: 'persisted-a', kind: 'knowledge' }], warnings: [], semanticUnits: [{ text: 'internal' }] }
  const receiver = { design: {
    projectForAgent: async () => ({ projectId: 'p' }),
    designFilesForProject: async () => ({ head: async () => 'c', listPathsAt: () => assert.fail('Do not rebuild a second view graph') }),
    kitForAgent: () => ({ skills: [] }), readStoredDesignGraph: async () => structuredClone(stored),
    knowledgeStatusSnapshot: async () => ({ project: 'p', head: 'c', state: 'current', latestComplete: { revision: 'rev:7' } }),
    semanticDesignGraph: () => assert.fail('Do not recompute semantic edges in the Panel'),
  } }
  const result = JSON.parse((await Remote.prototype.readGraphNow.call(receiver, {}, new AbortController().signal)).content)
  assert.equal(result.knowledgeRevision, 'rev:7')
  assert.equal(result.knowledgeStatus, 'current')
  assert.equal(result.nodes[0].id, 'persisted-a')
  assert.equal(result.edges[0].id, 'persisted-edge')
  assert.equal(result.nodes[0].fields, undefined)
  assert.equal(result.semanticUnits, undefined)
})

test('Panel reopens reuse only a publication pinned to the same head and revision', async () => {
  const { default: Remote } = await import('../src/panel-remote.ts')
  let head = 'c1', revision = 'rev:7', state = 'current', reads = 0
  const receiver = { graphReads: new Map(), design: {
    projectForAgent: async () => ({ projectId: 'p' }),
    designFilesForProject: async () => ({ head: async () => head }),
    kitForAgent: () => ({ name: 'fixture', version: '1.0', skills: [] }),
    assertProjectSelection() {},
    readStoredDesignGraph: async () => {
      reads += 1
      return { checkpoint: head, knowledgeRevision: revision,
        freshness: { sourceCheckpoint: head, indexedCheckpoint: 'c1', ...(head === 'c1' ? {} : { sourceEquivalent: true }) },
        nodes: [{ id: 'record', file, context: 'bounded' }], edges: [], warnings: [] }
    },
    knowledgeStatusSnapshot: async () => ({ project: 'p', head, state, latestComplete: { revision } }),
  } }
  const read = async () => JSON.parse((await Remote.prototype.readGraphNow.call(receiver, {}, new AbortController().signal)).content)
  assert.equal((await read()).knowledgeRevision, 'rev:7')
  assert.equal((await read()).knowledgeRevision, 'rev:7')
  assert.equal(reads, 1, 'a reopen must not rescan the same immutable publication')
  state = 'running'
  assert.equal((await read()).knowledgeStatus, 'running')
  assert.equal(reads, 2, 'a live generation must not reuse a cached current-state response')
  state = 'current'
  revision = 'rev:8'
  assert.equal((await read()).knowledgeRevision, 'rev:8')
  assert.equal(reads, 3, 'a new KAG revision invalidates the response cache')
  head = 'c2'
  assert.equal((await read()).freshness.sourceCheckpoint, 'c2')
  assert.equal(reads, 4, 'a new Design head invalidates the response cache')
  assert.equal((await read()).freshness.sourceEquivalent, true)
  assert.equal(reads, 4, 'a verified source-equivalent publication remains cacheable at the new head')
})

test('concurrent Knowledge publication preserves a coherent stored generation without claiming database failure', async () => {
  const { default: Remote } = await import('../src/panel-remote.ts')
  const stored = { checkpoint: 'c1', knowledgeRevision: 'rev:1', freshness: { sourceCheckpoint: 'c1', indexedCheckpoint: 'c1' },
    nodes: [{ id: 'persisted', file, context: 'bounded' }], edges: [{ id: 'link', from: 'persisted', to: 'persisted', kind: 'knowledge' }], warnings: [] }
  const receiver = { design: {
    projectForAgent: async () => ({ projectId: 'p' }),
    designFilesForProject: async () => ({ head: async () => 'c1', listPathsAt: () => assert.fail('Do not replace a coherent stored graph with structural preview') }),
    kitForAgent: () => ({ skills: [] }), readStoredDesignGraph: async () => structuredClone(stored),
    knowledgeStatusSnapshot: async () => ({ project: 'p', head: 'c2', state: 'current', latestComplete: { revision: 'rev:2' } }),
  } }
  const result = JSON.parse((await Remote.prototype.readGraphNow.call(receiver, {}, new AbortController().signal)).content)
  assert.equal(result.knowledgeStatus, 'unknown')
  assert.equal(result.knowledgeRevision, 'rev:1')
  assert.equal(result.edges[0].id, 'link')
  assert.ok(!result.warnings.some(w => w.includes('Knowledge（统一 KAG）当前不可用')))
})

test('checkpoint movement during stored read is a temporary race, not Knowledge outage', async () => {
  const { default: Remote } = await import('../src/panel-remote.ts')
  const { DesignGraphReadRaceError } = await import('../src/design-service.ts')
  let heads = 0
  const receiver = { design: {
    projectForAgent: async () => ({ projectId: 'p' }),
    designFilesForProject: async () => ({ head: async () => ++heads === 1 ? 'c1' : 'c2',
      listPathsAt: async () => [file], readTextAt: async () => '{"tasks":{"a":{"id":"a","caption":"新版本"}}}' }),
    kitForAgent: () => ({ skills: [] }),
    readStoredDesignGraph: async () => { throw new DesignGraphReadRaceError('Design checkpoint changed during graph read') },
  } }
  const result = JSON.parse((await Remote.prototype.readGraphNow.call(receiver, {}, new AbortController().signal)).content)
  assert.equal(result.knowledgeStatus, 'unknown')
  assert.equal(result.checkpoint, 'c2')
  assert.equal(result.coverage.projection, 'structural-preview')
  assert.ok(!result.warnings.some(w => w.includes('Knowledge（统一 KAG）当前不可用')))
})

test('Graph live status remote reads the selected project without starting maintenance', async () => {
  const { default: Remote } = await import('../src/panel-remote.ts')
  const calls = []
  const status = { schemaVersion: 1, project: 'p', head: 'c2', state: 'running', phase: 'semantic',
    freshness: 'different', latestComplete: { checkpoint: 'c1', revision: 'rev:1', warningCount: 0 }, semanticLayer: 'enabled' }
  const receiver = { design: {
    projectForAgent: async () => { calls.push('project'); return { projectId: 'p' } },
    knowledgeStatusSnapshot: async () => { calls.push('status'); return status },
    assertProjectSelection: (_agent, id) => { calls.push(`assert:${id}`) },
    requestKnowledgeMaintenance: () => assert.fail('status reads must never schedule KAG'),
  } }
  assert.equal(await Remote.prototype.readKnowledgeStatus.call(receiver, {}, new AbortController().signal), status)
  assert.deepEqual(calls, ['project', 'status', 'assert:p'])
})

test('actual remote does not call an unindexed empty graph ready', async () => {
  const { default: Remote } = await import('../src/panel-remote.ts')
  const receiver = { design: {
    projectForAgent: async () => ({ projectId: 'p' }),
    designFilesForProject: async () => ({ head: async () => 'c' }),
    kitForAgent: () => ({ skills: [] }),
    readStoredDesignGraph: async () => ({ checkpoint: 'c', knowledgeRevision: 'rev:0',
      freshness: { sourceCheckpoint: 'c' }, nodes: [], edges: [], warnings: [] }),
    knowledgeStatusSnapshot: async () => ({ project: 'p', head: 'c', state: 'due', latestComplete: undefined }),
  } }
  const result = JSON.parse((await Remote.prototype.readGraphNow.call(receiver, {}, new AbortController().signal)).content)
  assert.equal(result.knowledgeStatus, 'due')
  assert.equal(result.freshness.indexedCheckpoint, undefined)
  assert.deepEqual(result.nodes, [])
})
