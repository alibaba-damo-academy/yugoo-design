/** Weighted graph-distance Stress coordinates shared by the production 2D and 3D views. */
export function stressPositions(graph, mode) {
  const dimensions = mode.startsWith('stress3') ? 3 : 2
  const natural = mode.endsWith('-natural'), source = mode.endsWith('-source')
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id))
  const ids = new Map(nodes.map((node, index) => [node.id, index])), adjacency = nodes.map(() => new Set())
  for (const edge of graph.edges) {
    const a = ids.get(edge.from), b = ids.get(edge.to)
    if (a === undefined || b === undefined || a === b) continue
    adjacency[a].add(b); adjacency[b].add(a)
  }
  // Source membership only joins solver components. It is not a KAG edge and
  // never changes the real graph-distance metric used below.
  const componentAdjacency = adjacency.map(neighbors => new Set(neighbors))
  if (source) {
    const byFile = new Map()
    for (let index = 0; index < nodes.length; index++) if (nodes[index].file) {
      const group = byFile.get(nodes[index].file) ?? []; group.push(index); byFile.set(nodes[index].file, group)
    }
    for (const group of byFile.values()) for (let index = 1; index < group.length; index++) {
      componentAdjacency[group[0]].add(group[index]); componentAdjacency[group[index]].add(group[0])
    }
  }
  const seen = new Set(), components = []
  for (let index = 0; index < nodes.length; index++) if (!seen.has(index)) {
    const group = [index]; seen.add(index)
    for (let cursor = 0; cursor < group.length; cursor++) for (const next of componentAdjacency[group[cursor]]) if (!seen.has(next)) {
      seen.add(next); group.push(next)
    }
    components.push(group)
  }
  const output = new Map(), boxes = []
  for (const group of components) {
    const count = group.length, local = new Map(group.map((value, index) => [value, index]))
    const distanceFrom = start => {
      const distance = new Float64Array(count).fill(Infinity), queue = [start]; distance[local.get(start)] = 0
      for (let cursor = 0; cursor < queue.length; cursor++) for (const next of adjacency[queue[cursor]]) if (!Number.isFinite(distance[local.get(next)])) {
        distance[local.get(next)] = distance[local.get(queue[cursor])] + 1; queue.push(next)
      }
      return distance
    }
    // Exact all-pairs stress is excellent for the normal interactive range.
    // Large expanded graphs use deterministic landmark stress so work remains
    // bounded while preserving graph-distance objectives and real edges.
    const sparse = count > 320
    const landmarks = sparse ? Array.from({ length: Math.min(32, count) }, (_, index) => Math.floor(index * count / Math.min(32, count))) : []
    const rows = new Map((sparse ? landmarks : group.map((_, index) => index)).map(index => [index, distanceFrom(group[index])]))
    const sourcePeers = new Map()
    if (source) {
      const byFile = new Map()
      for (let index = 0; index < count; index++) { const file = nodes[group[index]].file; if (!file) continue; const peers = byFile.get(file) ?? []; peers.push(index); byFile.set(file, peers) }
      for (const peers of byFile.values()) for (const index of peers) sourcePeers.set(index, peers.length <= 9 ? peers : [peers[0], ...peers.slice(1).filter((_, offset) => offset % Math.ceil(peers.length / 8) === 0).slice(0, 8)])
    }
    const allTargets = group.map((_, index) => index)
    const sparseTargets = sparse ? group.map((globalId, index) => [...new Set([
      ...landmarks,
      ...[...adjacency[globalId]].map(id => local.get(id)).filter(value => value !== undefined),
      ...(sourcePeers.get(index) ?? []),
    ])]) : undefined
    let points = group.map((_, index) => [
      Math.cos(index * 2.399963) * Math.sqrt(index + 1) * 90,
      Math.sin(index * 2.399963) * Math.sqrt(index + 1) * 90,
      dimensions === 3 ? Math.sin(index * 1.731 + .4) * Math.sqrt(count) * 90 : 0,
    ])
    // Coordinate-wise majorization of graph-distance stress. Disconnected
    // components are solved independently, then packed without invented edges.
    for (let step = 0; step < (sparse ? 140 : 240) && count > 1; step++) {
      let delta = 0
      for (let i = 0; i < count; i++) {
        const next = [0, 0, 0]; let sum = 0
        const targets = sparse ? sparseTargets[i] : allTargets
        for (const j of targets) if (j !== undefined && i !== j) {
          const dx = points[i][0] - points[j][0], dy = points[i][1] - points[j][1], dz = dimensions === 3 ? points[i][2] - points[j][2] : 0
          const length = Math.max(.00001, Math.hypot(dx, dy, dz)), diff = [dx, dy, dz]
          const graphDistance = rows.get(i)?.[j] ?? rows.get(j)?.[i] ?? (adjacency[group[i]].has(group[j]) ? 1 : Infinity)
          if (Number.isFinite(graphDistance)) {
            const target = 140 * graphDistance
            const weight = 1 / (target * target * (natural ? Math.sqrt(Math.max(1, adjacency[group[i]].size, adjacency[group[j]].size)) : 1))
            for (let axis = 0; axis < dimensions; axis++) next[axis] += weight * (points[j][axis] + target * diff[axis] / length)
            sum += weight
          }
          // Same-file proximity is a soft display objective. Existing
          // cross-file graph-distance terms remain authoritative.
          if (source && nodes[group[i]].file && nodes[group[i]].file === nodes[group[j]].file) {
            const weight = .65 / (100 * 100)
            for (let axis = 0; axis < dimensions; axis++) next[axis] += weight * (points[j][axis] + 100 * diff[axis] / length)
            sum += weight
          }
        }
        if (sum) for (let axis = 0; axis < dimensions; axis++) { next[axis] /= sum; delta += Math.abs(next[axis] - points[i][axis]) }
        if (sum) points[i] = next
      }
      if (delta / count < .01) break
    }
    const min = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis])))
    const max = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis])))
    boxes.push({ group, points, min, max, width: max[0] - min[0] + 180, height: max[1] - min[1] + 180 })
  }
  const rowWidth = Math.max(600, Math.sqrt(boxes.reduce((sum, box) => sum + box.width * box.height, 0)) * 1.4)
  let x = 0, y = 0, rowHeight = 0
  for (const box of boxes) {
    if (x && x + box.width > rowWidth) { x = 0; y += rowHeight; rowHeight = 0 }
    box.group.forEach((id, index) => output.set(nodes[id].id, {
      x: box.points[index][0] - box.min[0] + x,
      y: box.points[index][1] - box.min[1] + y,
      z: dimensions === 3 ? box.points[index][2] - (box.min[2] + box.max[2]) / 2 : 0,
    }))
    x += box.width; rowHeight = Math.max(rowHeight, box.height)
  }
  return nodes.map(node => [node.id, output.get(node.id)])
}
