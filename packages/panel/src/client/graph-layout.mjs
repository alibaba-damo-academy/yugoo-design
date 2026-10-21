/** Presentation-only solvers. Never mutate canonical nodes, edges or evidence. */
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import ELK from 'elkjs/lib/elk.bundled.js'
cytoscape.use(fcose)

export function initialPositions(scope, previous = new Map()) {
  let seed = 42
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  return new Map([...scope.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(n => [n.id,
    previous.has(n.id) ? { ...previous.get(n.id) } : { x: (random() - .5) * 500, y: (random() - .5) * 500 }]))
}

/** Bounded record neighborhoods, not inferred business clusters or Bundle bins. */
export const recordRadius = count => 38 + 18 * Math.sqrt(count)
export function recordGroups(scope) {
  const nodes = new Map(scope.nodes.map(n => [n.id, n])), groups = new Map()
  for (const n of [...scope.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const id = !n.record && n.recordId && nodes.get(n.recordId)?.record ? n.recordId : n.id
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(n)
  }
  return groups
}

export async function solveLayout(scope, engine, previous = new Map(), fixed = new Set()) {
  const groups = recordGroups(scope)
  if (groups.size === scope.nodes.length || fixed.size) return solveFlatLayout(scope, engine, previous, fixed)
  const owner = new Map([...groups].flatMap(([id, members]) => members.map(n => [n.id, id])))
  const radius = new Map([...groups].map(([id, members]) => [id, members.length > 1 ? recordRadius(members.length - 1) + 22 : 38]))
  const roots = [...groups].map(([id, members]) => ({ ...members.find(n => n.id === id), layoutRadius: radius.get(id) }))
  // These endpoints exist only inside the solver. Render the original edges.
  const edges = scope.edges.map(e => ({ ...e, from: owner.get(e.from), to: owner.get(e.to) })).filter(e => e.from && e.to && e.from !== e.to)
  const centers = await solveFlatLayout({ nodes: roots, edges }, engine, previous)
  // Solvers need different collision behavior; one bounded pass keeps record
  // neighborhoods distinguishable without adding boxes or semantic edges.
  const ids = [...groups.keys()].sort()
  for (let step = 0; step < 60; step++) {
    let moved = false
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = centers.get(ids[i]), b = centers.get(ids[j]), dx = b.x - a.x, dy = b.y - a.y
      const distance = Math.hypot(dx, dy), minimum = radius.get(ids[i]) + radius.get(ids[j]) + 18
      if (distance >= minimum - .1) continue
      const ux = distance > .01 ? dx / distance : Math.cos(i + j), uy = distance > .01 ? dy / distance : Math.sin(i + j)
      const shift = (minimum - distance) * .51
      a.x -= ux * shift; a.y -= uy * shift; b.x += ux * shift; b.y += uy * shift; moved = true
    }
    if (!moved) break
  }
  const result = new Map()
  for (const [id, members] of groups) {
    const center = centers.get(id)
    result.set(id, { ...center })
    const children = members.filter(n => n.id !== id)
    const bound = recordRadius(children.length)
    for (const [i, child] of children.entries()) {
      const angle = i * 2.399963229728653, distance = 28 + (bound - 28) * Math.sqrt((i + 1) / children.length)
      result.set(child.id, { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance })
    }
  }
  return result
}

async function solveFlatLayout(scope, engine, previous = new Map(), fixed = new Set()) {
  if (!['fcose', 'stress'].includes(engine)) throw new Error('Unsupported layout engine: ' + engine)
  const initial = initialPositions(scope, previous)
  const nodes = [...scope.nodes].sort((a, b) => a.id.localeCompare(b.id))
  if (!nodes.length) return initial
  const ids = new Set(nodes.map(n => n.id)), pairs = new Map()
  for (const e of scope.edges) {
    if (e.from === e.to || !ids.has(e.from) || !ids.has(e.to)) continue
    const key = JSON.stringify([e.from, e.to].sort())
    if (!pairs.has(key) || e.kind === 'contains') pairs.set(key, e)
  }
  const edges = [...pairs.values()]
  let positions
  if (engine === 'stress') {
    const elk = new ELK({ algorithms: ['stress'] })
    const graph = await elk.layout({ id: 'root', layoutOptions: {
      'elk.algorithm': 'org.eclipse.elk.stress', 'elk.randomSeed': '42',
      'elk.stress.iterationLimit': '300', 'elk.stress.epsilon': '0.001',
      'elk.stress.desiredEdgeLength': String(140 + nodes.reduce((sum, n) => sum + (n.layoutRadius ?? 0), 0) / nodes.length), 'elk.separateConnectedComponents': 'true',
    }, children: nodes.map(n => ({ id: n.id, width: n.layoutRadius ? n.layoutRadius * 2 : 36, height: n.layoutRadius ? n.layoutRadius * 2 : 36, ...initial.get(n.id) })),
    edges: edges.map((e, i) => ({ id: 'e' + i, sources: [e.from], targets: [e.to] })) })
    positions = new Map(graph.children.map(n => [n.id, { x: n.x + n.width / 2, y: n.y + n.height / 2 }]))
  } else {
    const cy = cytoscape({ headless: true, styleEnabled: true, layout: { name: 'preset' },
      elements: [...nodes.map(n => ({ data: { id: n.id, width: n.layoutRadius ? n.layoutRadius * 2 : n.record ? 120 : 36, height: n.layoutRadius ? n.layoutRadius * 2 : n.record ? 55 : 36 }, position: initial.get(n.id) })),
        ...edges.map((e, i) => ({ data: { id: 'edge-' + i, source: e.from, target: e.to, contains: e.kind === 'contains' } }))],
      style: [{ selector: 'node', style: { width: 'data(width)', height: 'data(height)' } }],
    })
    try {
      cy.layout({ name: 'fcose', quality: 'proof', randomize: false, animate: false, fit: false,
        tile: false, packComponents: false, numIter: fixed.size ? 180 : 2500,
        nodeRepulsion: () => 4500, idealEdgeLength: e => e.data('contains') ? 80 : 140,
        edgeElasticity: () => .45,
        fixedNodeConstraint: [...fixed].map(nodeId => ({ nodeId, position: initial.get(nodeId) })),
      }).run()
      positions = new Map(cy.nodes().map(n => [n.id(), { ...n.position() }]))
    } finally { cy.destroy() }
  }
  if (positions.size !== nodes.length || [...positions.values()].some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Layout returned incomplete or non-finite positions')
  for (const id of fixed) positions.set(id, { ...initial.get(id) })
  return positions
}

export async function solveDraggedNeighborhood(scope, positions, id) {
  const groups = recordGroups(scope)
  if (groups.size < scope.nodes.length) {
    const result = new Map([...positions].map(([id, p]) => [id, { ...p }]))
    const group = [...groups].find(([, members]) => members.some(n => n.id === id))
    if (!group) return result
    if (group[0] !== id) {
      const center = result.get(group[0]), child = result.get(id), bound = recordRadius(group[1].length - 1)
      const distance = Math.hypot(child.x - center.x, child.y - center.y)
      if (distance > bound) { child.x = center.x + (child.x - center.x) * bound / distance; child.y = center.y + (child.y - center.y) * bound / distance }
      const others = group[1].filter(n => n.id !== id).map(n => result.get(n.id))
      const free = p => others.every(q => Math.hypot(p.x - q.x, p.y - q.y) >= 28)
      if (!free(child)) {
        // Choose the nearest free local slot, never move siblings or other records.
        const slots = Array.from({ length: group[1].length * 12 }, (_, i) => {
          const angle = i * 2.399963229728653, r = 28 + (bound - 28) * Math.sqrt((i + 1) / (group[1].length * 12))
          return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r }
        }).filter(free).sort((a, b) => Math.hypot(a.x - child.x, a.y - child.y) - Math.hypot(b.x - child.x, b.y - child.y))
        if (!slots.length) throw new Error('No free local slot; restore the previous drag position')
        result.set(id, slots[0])
      }
    } else {
      const origin = result.get(id), center = { ...origin }
      const radius = members => members.length > 1 ? recordRadius(members.length - 1) + 22 : 38
      const obstacles = [...groups].filter(([key]) => key !== id).map(([key, members]) => ({ ...result.get(key), radius: radius(members) }))
      const ownRadius = radius(group[1])
      for (let step = 0; step < 80; step++) {
        let moved = false
        for (const other of obstacles) {
          const dx = center.x - other.x, dy = center.y - other.y, d = Math.hypot(dx, dy), min = ownRadius + other.radius + 18
          if (d >= min) continue
          center.x += (d > .01 ? dx / d : 1) * (min - d + .1)
          center.y += (d > .01 ? dy / d : 0) * (min - d + .1); moved = true
        }
        if (!moved) break
      }
      if (obstacles.some(p => Math.hypot(center.x - p.x, center.y - p.y) < ownRadius + p.radius + 18)) {
        throw new Error('No free local group position; restore the previous drag position')
      }
      if (Math.hypot(center.x - origin.x, center.y - origin.y) > ownRadius * 4) throw new Error('Group displacement exceeded the local drag budget')
      const dx = center.x - origin.x, dy = center.y - origin.y
      for (const n of group[1]) { const p = result.get(n.id); p.x += dx; p.y += dy }
    }
    return result
  }
  const moving = new Set(scope.edges.flatMap(e => e.from === id ? [e.to] : e.to === id ? [e.from] : []))
  const fixed = new Set(scope.nodes.filter(n => !moving.has(n.id) || n.id === id).map(n => n.id))
  return moving.size ? solveLayout(scope, 'fcose', positions, fixed) : positions
}
