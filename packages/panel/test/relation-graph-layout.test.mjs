import test from 'node:test'
import assert from 'node:assert/strict'
import ELK from 'elkjs/lib/elk.bundled.js'
import { register } from 'tsx/esm/api'
register()
const { relationLayoutInput, layoutRelationGraph, relationRoute, relationGraphFitViewport, relationFallbackCurve, relationNodeId, relationEdgeId, RELATION_SIDES, RELATION_GRAPH_AUTO_FIT } = await import('../src/relation-graph-layout.ts')
const { readFile } = await import('node:fs/promises')

test('automatic framing caps sparse canvas at natural size, shrinks large graphs and preserves manual zoom', async () => {
  assert.equal(RELATION_GRAPH_AUTO_FIT.maxZoom, 1)
  const small = { x: 0, y: 0, width: 600, height: 200 }
  const wide = relationGraphFitViewport(small, 2300, 1000)
  assert.equal(wide.zoom, 1)
  const origin = { x: 170, y: -80, width: 600, height: 200 }
  const centered = relationGraphFitViewport(origin, 2300, 1000)
  assert.equal(centered.x + (origin.x + origin.width / 2) * centered.zoom, 1150)
  assert.equal(centered.y + (origin.y + origin.height / 2) * centered.zoom, 500)
  const large = { x: 0, y: 0, width: 2600, height: 1600 }
  const narrow = relationGraphFitViewport(large, 700, 600)
  assert.ok(narrow.zoom > 0.15 && narrow.zoom < 1)
  assert.ok(narrow.x >= 0 && narrow.y >= 0)
  assert.ok(narrow.x + large.width * narrow.zoom <= 700)
  assert.ok(narrow.y + large.height * narrow.zoom <= 600)
  const source = await readFile(new URL('../src/visual-components.tsx', import.meta.url), 'utf8')
  assert.match(source, /useFlowContainerFit\(canvasElement, flow, layoutBounds\)/)
  assert.match(source, /flow\?\.setViewport\(relationGraphFitViewport\(/)
  assert.match(source, /maxZoom=\{2\.5\} fitView fitViewOptions=\{RELATION_GRAPH_AUTO_FIT\}/)
  assert.match(source, /<Controls showInteractive=\{false\} fitViewOptions=\{RELATION_GRAPH_AUTO_FIT\}/)
  assert.doesNotMatch(source, /flow\?\.fitBounds\(/, 'layout must not inherit the unrestricted manual zoom ceiling')
})

test('four-side ports match routed geometry and keep side selection out of canonical facts', async () => {
  for (const sourceSide of RELATION_SIDES) for (const targetSide of RELATION_SIDES) {
    const nodes = [{ id: 'a', width: 180, height: 64 }, { id: 'b', width: 180, height: 120 }]
    const links = [{ id: 'edge', source: 'a', target: 'b', sourceSide, targetSide, labels: [{ id: 'main', placement: 'CENTER', width: 160, height: 44 }] }]
    const before = structuredClone({ nodes, links })
    const input = relationLayoutInput(nodes, links)
    assert.equal(input.children[0].ports.length, 4)
    assert.equal(input.edges[0].sources[0], `node:a:${sourceSide}`)
    assert.equal(input.edges[0].targets[0], `node:b:${targetSide}`)
    const result = await new ELK().layout(input)
    const route = relationRoute(result.edges[0])
    for (const [node, side, endpoint] of [[result.children[0], sourceSide, route.points[0]], [result.children[1], targetSide, route.points.at(-1)]]) {
      const port = node.ports.find(port => port.id.endsWith(`:${side}`))
      assert.ok(Math.abs(endpoint.x - (node.x + port.x)) < 0.1)
      assert.ok(Math.abs(endpoint.y - (node.y + port.y)) < 0.1)
    }
    assert.deepEqual({ nodes, links }, before)
  }
  const down = relationFallbackCurve({ x: 0, y: 0 }, { x: 0, y: 200 }, 'bottom', 'top')
  assert.match(down.path, /^M 0 0 C 0 70, 0 130, 0 200$/)
  assert.ok(down.sourceAnnotation.y > 0 && down.targetAnnotation.y < 200)
  const up = relationFallbackCurve({ x: 0, y: 200 }, { x: 0, y: 0 }, 'top', 'bottom')
  assert.match(up.path, /^M 0 200 C 0 130, 0 70, 0 0$/)
  assert.notDeepEqual(relationFallbackCurve({ x: 0, y: 0 }, { x: 0, y: 200 }, 'bottom', 'top', 30).label, down.label)
})

test('all shared ReactFlow workspaces reuse ports, count chrome and automatic fit without opening readonly writes', async () => {
  const source = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')
  const workspace = await source('panel-workspace.tsx')
  assert.match(workspace, /RELATION_SIDES\.map\(side => <Handle/)
  assert.match(workspace, /id=\{side\} type='source'/)
  for (const name of ['visual-components.tsx', 'navigation-workspace.tsx', 'record-board.tsx']) {
    const value = await source(name)
    assert.match(value, /PanelCanvasToolbar/)
    assert.match(value, /connectionMode=\{ConnectionMode\.Loose\}/)
    assert.match(value, /fitViewOptions=\{RELATION_GRAPH_AUTO_FIT\}/)
  }
  assert.match(await source('visual-components.tsx'), /sourceHandle: ports\.sourceSide, targetHandle: ports\.targetSide/)
  assert.match(await source('visual-components.tsx'), /if \(id\) setEdgePorts/)
  assert.match(await source('visual-components.tsx'), /const labels: RelationLayoutLink\['labels'\] = edgeCopy\(link\)\.label/,
    'hidden endpoint-only labels must not reserve an empty ELK text box')
  assert.match(await source('record-board.tsx'), /nodesDraggable=\{false\} nodesConnectable=\{false\} elementsSelectable=\{false\}/)
  assert.match(await source('record-board.tsx'), /<PanelCanvasHandles isConnectable=\{false\}/)
  assert.match(workspace, /isConnectableStart=\{isConnectable\} isConnectableEnd=\{isConnectable\}/)
  assert.match(await source('record-board.tsx'), /counts=\{t\([^\n]*'boardMapCounts'/)
  assert.match(await source('use-flow-container-fit.ts'), /flow\.fitView\(RELATION_GRAPH_AUTO_FIT\)/)
  const css = await source('visual-components.css')
  assert.match(css, /\.dsh-relation-graph\s*\{[^}]*padding: 12px 16px 0/)
  assert.doesNotMatch(css, /\.react-flow__handle:hover\s*\{[^}]*transform:/)
})
const overlaps = (a, b) => a.x < b.x + b.width - .1 && a.x + a.width > b.x + .1 && a.y < b.y + b.height - .1 && a.y + a.height > b.y + .1
const label = (id, placement, width = 200, height = 64) => ({ id, placement, width, height })

test('annotated relationship chains use the canvas area without dropping labels or changing endpoints', async () => {
  const nodes = Array.from({ length: 7 }, (_, id) => ({ id: String(id), width: 180, height: 64 }))
  const edges = [[0,1], [1,2], [1,3], [2,3], [3,4], [4,5], [5,6], [2,5]].map(([source, target], id) => ({
    id: String(id), source: String(source), target: String(target),
    labels: [label('main', 'CENTER', 160, 44), label('source', 'TAIL', 150, 36), label('target', 'HEAD', 150, 36)],
  }))
  const result = await layoutRelationGraph(new ELK(), nodes, edges, 1250 / 700)
  assert.equal(result.children.length, 7)
  assert.equal(result.edges.length, 8)
  assert.ok(relationGraphFitViewport({ x: 0, y: 0, width: result.width, height: result.height }, 1250, 700).zoom >= 0.5,
    'seven annotated objects must not open as a quarter-scale horizontal strip')
  const boxes = [...result.children, ...result.edges.flatMap(edge => edge.labels)]
  assert.equal(boxes.length, 7 + 8 * 3, 'all endpoint and relationship annotations remain visible')
  assert.ok(boxes.every((a, i) => boxes.slice(i + 1).every(b => !overlaps(a, b))), 'wrapping does not overlap text boxes')
  for (const edge of result.edges) {
    const authored = edges.find(value => relationEdgeId(value.id) === edge.id)
    assert.equal(edge.sources[0], `${relationNodeId(authored.source)}:right`)
    assert.equal(edge.targets[0], `${relationNodeId(authored.target)}:left`)
    assert.equal(edge.sections.length, 1, 'the shared route renderer receives one complete orthogonal route')
  }
})

for (const [name, links] of [
  ['chain', [['a','b'], ['b','c']]],
  ['parallel and reverse', [['a','b'], ['a','b'], ['b','a'], ['b','c']]],
  ['diamond', [['a','b'], ['a','c'], ['b','d'], ['c','d']]],
  ['cycle and self relationship', [['a','b'], ['b','c'], ['c','a'], ['a','a']]],
]) test(`auto layout reserves full measured node and relationship text: ${name}`, async () => {
  const nodes = ['a','b','c','d'].map((id, i) => ({ id, width: 180, height: 64 + 40 * i }))
  const edges = links.map(([source,target], i) => ({ id: `e${i}`, source, target,
    labels: [label('main', 'CENTER'), label('source', 'TAIL', 150, 58), label('target', 'HEAD', 150, 58)] }))
  const before = structuredClone({ nodes, edges })
  const result = await layoutRelationGraph(new ELK(), nodes, edges)
  assert.deepEqual({ nodes, edges }, before, 'source records remain immutable even though ELK mutates its private input')
  const boxes = [...result.children.map(n => ({...n, kind:'node'})), ...result.edges.flatMap(e => e.labels.map(l => ({...l, id:`${e.id}/${l.id}`,kind:'label'})))]
  const collisions = boxes.flatMap((a,i) => boxes.slice(i+1).filter(b=>overlaps(a,b)).map(b=>`${a.id} / ${b.id}`))
  assert.deepEqual(collisions, [], 'all text boxes must be distinct from nodes and other labels')
  for (const edge of result.edges) {
    const route = relationRoute(edge)
    assert.ok(route.points.length >= 2)
    assert.deepEqual(Object.keys(route.labels).sort(), ['main','source','target'])
  }
})
