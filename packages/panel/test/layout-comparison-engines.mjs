/** Experiment adapters only. No production renderer, graph facts, or database writes. */
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force'
import {layoutDiameter} from './graph-node-size.mjs'
cytoscape.use(fcose)

export const engines = ['ForceAtlas2 LinLog', 'fCoSE', 'D3 standard']
export function initialPositions(scope, seed = 42, previous = new Map()) {
  let state = seed >>> 0
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296)
  const positions = new Map()
  for (const node of [...scope.nodes].sort((a,b) => a.id.localeCompare(b.id))) {
    const old = previous.get(node.id), parent = previous.get(node.parentId) ?? previous.get(node.recordId)
    positions.set(node.id, old ? {...old} : {x: (parent?.x ?? 0) + (random()-.5)*(parent ? 60 : 500), y: (parent?.y ?? 0) + (random()-.5)*(parent ? 60 : 500)})
  }
  return positions
}
export function layoutEdges(scope) {
  const nodes = new Set(scope.nodes.map(n => n.id)), pairs = new Map()
  for (const edge of scope.edges) {
    if (edge.from === edge.to || !nodes.has(edge.from) || !nodes.has(edge.to)) continue
    const key = JSON.stringify([edge.from,edge.to].sort()), weight = edge.kind === 'contains' ? 2 : 1
    if (weight > (pairs.get(key)?.weight ?? 0)) pairs.set(key, {...edge, weight})
  }
  return [...pairs].sort(([a],[b]) => a.localeCompare(b)).map(([,edge]) => edge)
}
export function calculate(engine, scope, initial, fixed = new Set(), {incremental=false,seed=42,radii,iterations=2500,readingSpace=false}={}) {
  const start = performance.now(), nodes = [...scope.nodes].sort((a,b) => a.id.localeCompare(b.id)), edges = layoutEdges(scope)
  let positions
  if (engine === engines[0]) {
    const graph = new Graph({type:'undirected',allowSelfLoops:false})
    for (const n of nodes) graph.addNode(n.id, {...initial.get(n.id), size:radii ? layoutDiameter(n,radii)/2 : n.record ? 12 : 8, fixed:fixed.has(n.id)})
    for (const e of edges) graph.addEdge(e.from,e.to,{weight:e.weight})
    forceAtlas2.assign(graph,{iterations:2000,settings:{linLogMode:true,adjustSizes:!!radii,scalingRatio:10,gravity:1,slowDown:1,edgeWeightInfluence:1,barnesHutOptimize:false}})
    positions = new Map(graph.mapNodes((id,a) => [id,{x:a.x,y:a.y}]))
  } else if (engine === engines[1]) {
    // Parent IDs intentionally are NOT Cytoscape compound containers. Our
    // containment is represented by actual edges, without rectangular regions.
    const cy = cytoscape({headless:true,styleEnabled:true,layout:{name:'preset'},elements:[
      ...nodes.map(n => ({data:{id:n.id,layoutWidth:readingSpace&&n.record?160:layoutDiameter(n,radii),layoutHeight:readingSpace&&n.record?76:layoutDiameter(n,radii)},position:{...initial.get(n.id)}})),
      ...edges.map((e,i) => ({data:{id:'edge-'+i,source:e.from,target:e.to,weight:e.weight}})),
    ],style:[{selector:'node',style:{width:'data(layoutWidth)',height:'data(layoutHeight)'}}]})
    const originalRandom=Math.random
    let state=seed>>>0
    try {
      // fCoSE's cold start includes spectral initialization. Disabling it would
      // compare only its incremental refinement, not the recommended algorithm.
      // Synchronous experiment only; restore ambient RNG even on failure.
      Math.random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296)
      cy.layout({name:'fcose',quality:'proof',randomize:!incremental,animate:false,fit:false,tile:false,packComponents:false,
        numIter:iterations,nodeRepulsion:() => 4500,idealEdgeLength:e => e.data('weight') === 2 ? 80 : 140,
        edgeElasticity:() => .45,
        fixedNodeConstraint:[...fixed].map(nodeId => ({nodeId,position:initial.get(nodeId)})),
      }).run()
      positions = new Map(cy.nodes().map(n => [n.id(),{...n.position()}]))
    } finally {Math.random=originalRandom;cy.destroy()}
  } else {
    const particles = nodes.map(n => ({id:n.id,...initial.get(n.id),...(fixed.has(n.id) ? {fx:initial.get(n.id).x,fy:initial.get(n.id).y} : {})}))
    const links = edges.map(e => ({source:e.from,target:e.to,weight:e.weight}))
    const simulation = forceSimulation(particles)
      .force('link',forceLink(links).id(n=>n.id).distance(e=>e.weight===2?80:140).strength(e=>e.weight===2?.4:.12))
      .force('charge',forceManyBody().strength(-600))
      .force('collision',forceCollide(n=>layoutDiameter(n,radii)/2+6).iterations(2))
      .force('x',forceX(0).strength(.015)).force('y',forceY(0).strength(.015)).stop()
    try {simulation.tick(600);positions=new Map(particles.map(n=>[n.id,{x:n.x,y:n.y}]))} finally {simulation.stop()}
  }
  for (const [id,p] of positions) if (!Number.isFinite(p.x)||!Number.isFinite(p.y)) throw new Error('Non-finite position: '+id)
  return {positions,milliseconds:performance.now()-start}
}

export function fitted(positions,width=1100,height=660) {
  if (!positions.size) return new Map()
  const all=[...positions.values()],minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y))
  const k=Math.min((width-220)/Math.max(1,maxX-minX),(height-130)/Math.max(1,maxY-minY))
  return new Map([...positions].map(([id,p])=>[id,{x:width/2+(p.x-(minX+maxX)/2)*k,y:height/2+(p.y-(minY+maxY)/2)*k}]))
}
export function metrics(scope,positions) {
  const p=fitted(positions),ns=[...p.values()],edges=layoutEdges(scope)
  let closePairs12px=0,circleOverlaps=0,crossings=0,relationCrossings=0,mixedCrossings=0
  const ids=[...p.keys()],byId=new Map(scope.nodes.map(n=>[n.id,n]))
  for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){
    const distance=Math.hypot(ns[i].x-ns[j].x,ns[i].y-ns[j].y)
    if(distance<12)closePairs12px++
    if(distance<(byId.get(ids[i]).record?6:3.5)+(byId.get(ids[j]).record?6:3.5))circleOverlaps++
  }
  const orient=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
    const a=edges[i],b=edges[j]
    if(new Set([a.from,a.to,b.from,b.to]).size<4)continue
    const p1=p.get(a.from),p2=p.get(a.to),p3=p.get(b.from),p4=p.get(b.to)
    if(orient(p1,p2,p3)*orient(p1,p2,p4)<0&&orient(p3,p4,p1)*orient(p3,p4,p2)<0){
      crossings++
      if(a.kind!=='contains'&&b.kind!=='contains')relationCrossings++
      if((a.kind==='contains')!==(b.kind==='contains'))mixedCrossings++
    }
  }
  const median=xs=>{xs.sort((a,b)=>a-b);return xs.length?xs[Math.floor(xs.length/2)]:null}
  const length=es=>median(es.map(e=>Math.hypot(p.get(e.from).x-p.get(e.to).x,p.get(e.from).y-p.get(e.to).y)))
  return {nodes:ns.length,edges:edges.length,closePairs12px,circleOverlaps,edgeCrossings:crossings,relationCrossings,mixedCrossings,medianContainsPixels:length(edges.filter(e=>e.kind==='contains')),medianRelationPixels:length(edges.filter(e=>e.kind!=='contains'))}
}
