import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { projectDesignGraph, readDesignGraph } = await import('../src/design-graph.ts')
const file = 'tasks/tasks.json'
const schema = { type: 'object', properties: { tasks: { type: 'map', value: { type: 'object' } } } }
test('storage reuses view identities without display node and semantic budgets', () => {
  const tasks = Object.fromEntries(Array.from({ length: 350 }, (_, i) => ['t' + i, { caption: '任务 ' + i, details: Array.from({ length: 5 }, (_, j) => '详细说明 ' + j) }]))
  const files = { [file]: { tasks } }, schemas = { [file]: schema }
  const view = projectDesignGraph(files, 'c', schemas)
  const stored = projectDesignGraph(files, 'c', schemas, { purpose: 'storage' })
  assert.equal(view.nodes.filter(n => n.record).length, 300)
  assert.equal(stored.nodes.filter(n => n.record).length, 350)
  assert.ok(stored.nodes.filter(n => !n.record).length > 1200)
  const ids = new Set(stored.nodes.map(n => n.id))
  assert.ok(view.nodes.every(n => ids.has(n.id)))
  assert.deepEqual(stored.semanticUnits, []) // Text is persisted; embedding gets its own work batches.
})
test('complete read is not truncated at four MB and rejects unreadable inputs', async () => {
  const content = '文'.repeat(1_400_000)
  const store = { listPathsAt: async () => [file], readTextAt: async () => JSON.stringify({ tasks: { a: { caption: '测试记录', content } } }) }
  const graph = await readDesignGraph(store, 'c', undefined, { [file]: schema }, { purpose: 'storage' })
  assert.equal(graph.nodes[0].fields.find(f => f.pointer.endsWith('/content')).text, content)
  for (const text of [undefined, '{bad', '[]']) {
    await assert.rejects(readDesignGraph({ ...store, readTextAt: async () => text }, 'c', undefined, {}, { purpose: 'storage' }))
  }
})
test('storage retains root settings alongside records without reviving excluded questions', () => {
  const root = { version: 3, enabled: false, tags: ['个人研究', '跨学科'], tasks: { a: { caption: '科研计划' } }, questions: { unanswered: { prompt: '待回答', answer: '' } } }
  const graph = projectDesignGraph({ [file]: root }, 'c', {}, { purpose: 'storage' })
  const fields = new Map(graph.nodes.flatMap(n => n.fields ?? []).map(f => [f.pointer, f.text]))
  assert.equal(fields.get('/version'), '3')
  assert.equal(fields.get('/enabled'), 'false')
  assert.equal(fields.get('/tags/1'), '跨学科')
  assert.equal(fields.get('/tasks/a/caption'), '科研计划')
  assert.equal([...fields.keys()].some(p => p.startsWith('/questions/')), false)
  assert.equal(graph.nodes.filter(n => n.record && n.pointer === '').length, 1)
})
