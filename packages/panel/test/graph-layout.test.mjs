import { test } from 'node:test'
import assert from 'node:assert/strict'
import { solveLayout, solveDraggedNeighborhood, recordRadius, recordGroups } from '../src/client/graph-layout.mjs'
const nodes = ['a', 'b', 'c', 'isolated'].map(id => ({ id, record: true }))
const scope = { nodes, edges: [{ from: 'a', to: 'b', kind: 'semantic' }, { from: 'b', to: 'c', kind: 'knowledge' }], total: 4 }
for (const engine of ['fcose', 'stress']) test(engine + ' returns finite positions without changing graph facts', async () => {
  const before = structuredClone(scope)
  const positions = await solveLayout(scope, engine)
  assert.equal(positions.size, nodes.length)
  assert.ok([...positions.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
  assert.deepEqual(scope, before)
  assert.equal(new Set([...positions.values()].map(p => JSON.stringify(p))).size, nodes.length)
})
test('local drag pins dragged node and unrelated records', async () => {
  const initial = new Map(nodes.map((n, i) => [n.id, { x: i * 160, y: 0 }]))
  initial.set('a', { x: 70, y: 30 })
  const before = structuredClone(initial)
  const next = await solveDraggedNeighborhood(scope, initial, 'a')
  for (const id of ['a', 'c', 'isolated']) assert.deepEqual(next.get(id), initial.get(id))
  assert.deepEqual(initial, before)
})
test('unknown engine errors instead of silently selecting another solver', async () => {
  await assert.rejects(solveLayout(scope, 'unknown'), /Unsupported/)
})
const grouped = { nodes: [{ id: 'a', record: true }, { id: 'a1', recordId: 'a' }, { id: 'a2', recordId: 'a', parentId: 'a1' }, { id: 'b', record: true }, { id: 'b1', recordId: 'b' }, { id: 'orphan', recordId: 'missing' }], edges: [{ from: 'a2', to: 'b1', kind: 'semantic', evidence: 'unchanged' }, { from: 'a', to: 'a1', kind: 'contains' }] }
for (const engine of ['fcose', 'stress']) test(engine + ' confines descendants to capacity-aware record neighborhoods without changing facts', async () => {
  const before = structuredClone(grouped), result = await solveLayout(grouped, engine)
  assert.equal(result.size, grouped.nodes.length)
  for (const [id, members] of recordGroups(grouped)) for (const n of members) {
    const root = result.get(id), p = result.get(n.id)
    assert.ok(Math.hypot(p.x - root.x, p.y - root.y) <= recordRadius(members.length - 1) + .01)
  }
  assert.deepEqual(grouped, before)
  assert.equal(new Set([...result.values()].map(p => JSON.stringify(p))).size, grouped.nodes.length)
})
test('capacity grows for large records and preserves minimum local spacing', async () => {
  assert.ok(recordRadius(2000) > recordRadius(500))
  const large = { nodes: [{id:'root',record:true}, ...Array.from({length:500}, (_,i)=>({id:'c'+i,recordId:'root'}))], edges:[] }
  const p = [...(await solveLayout(large,'fcose')).values()]
  let minimum = Infinity
  for(let i=0;i<p.length;i++) for(let j=i+1;j<p.length;j++) minimum=Math.min(minimum,Math.hypot(p[i].x-p[j].x,p[i].y-p[j].y))
  assert.ok(minimum >= 28, `local center spacing ${minimum}`)
})
test('dragging a record into another group resolves only the moved group', async () => {
  const p = new Map([['a',{x:0,y:0}],['a1',{x:45,y:0}],['a2',{x:0,y:60}],['b',{x:0,y:0}],['b1',{x:45,y:0}],['orphan',{x:600,y:0}]])
  const before=structuredClone(p), next=await solveDraggedNeighborhood(grouped,p,'a')
  for(const id of ['b','b1','orphan']) assert.deepEqual(next.get(id),p.get(id))
  assert.ok(Math.hypot(next.get('a').x-next.get('b').x,next.get('a').y-next.get('b').y)>150)
  assert.equal(next.get('a1').x-next.get('a').x,45)
  assert.equal(next.get('a2').y-next.get('a').y,60)
  assert.deepEqual(p,before)
})
test('child drag avoids siblings and root, stays local and preserves every other position', async () => {
  const p=await solveLayout(grouped,'fcose');p.set('a2',{...p.get('a1')})
  const next=await solveDraggedNeighborhood(grouped,p,'a2'), c=next.get('a2'), root=next.get('a')
  for(const id of p.keys()) if(id!=='a2') assert.deepEqual(next.get(id),p.get(id))
  for(const id of ['a','a1']) assert.ok(Math.hypot(c.x-next.get(id).x,c.y-next.get(id).y)>=28)
  assert.ok(Math.hypot(c.x-root.x,c.y-root.y)<=recordRadius(2))
})
