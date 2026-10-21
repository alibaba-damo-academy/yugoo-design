/** Visual metric only: no graph facts, IDs, edges or semantic scores are changed. */
export function recordReach(graph,owners){
  const neighbors=new Map(graph.nodes.filter(n=>n.record).map(n=>[n.id,new Set()]))
  for(const edge of graph.edges){
    if(edge.kind==='contains')continue
    const a=owners.get(edge.from),b=owners.get(edge.to)
    if(!a||!b||a===b||!neighbors.has(a)||!neighbors.has(b))continue
    neighbors.get(a).add(b);neighbors.get(b).add(a)
  }
  return new Map([...neighbors].map(([id,set])=>[id,set.size]))
}
export function nodeRadius(node,mode,reach){
  if(!node.record)return 2
  if(mode!=='reach')return 4
  // Fixed across Good/Bad and 2D/3D: no per-dataset rescaling.
  // Smaller baseline, linear area, wider range to avoid flattening all hubs at 12.
  return Math.sqrt(6.25+9*Math.min(48,Math.max(0,reach.get(node.id)??0)))
}
export function layoutDiameter(node,radii){
  // Keep the previous 24-unit baseline; reserve extra solver space for larger dots.
  // These are layout units, not screen pixels at every possible zoom.
  return 24+4*Math.max(0,(radii?.get(node.id)??6)-6)
}
