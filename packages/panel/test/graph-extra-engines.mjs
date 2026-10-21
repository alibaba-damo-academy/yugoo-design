/** Alternative solvers for the standalone experiment, not production graph policy. */
import {Layout} from 'webcola'
import ELK from 'elkjs/lib/elk.bundled.js'
import {calculate,layoutEdges} from './layout-comparison-engines.mjs'
import {layoutDiameter} from './graph-node-size.mjs'

export async function calculateLive(engine,scope,initial,{incremental=false,seed=42,radii,readingSpace=false}={}) {
  if(engine!=='WebCoLa'&&engine!=='ELK Stress')return calculate(engine,scope,initial,new Set(),{incremental,seed,radii,readingSpace})
  const start=performance.now(),ordered=[...scope.nodes].sort((a,b)=>a.id.localeCompare(b.id))
  const edges=layoutEdges(scope)
  if(!ordered.length)return {positions:new Map(),milliseconds:0}
  let positions
  if(engine==='WebCoLa'){
    const particles=ordered.map(n=>({id:n.id,...initial.get(n.id),width:layoutDiameter(n,radii),height:layoutDiameter(n,radii)}))
    const index=new Map(particles.map((n,i)=>[n.id,i]))
    const links=edges.map(e=>({source:index.get(e.from),target:index.get(e.to),weight:e.weight}))
    const layout=new Layout().size([1100,660]).nodes(particles).links(links)
      .linkDistance(e=>e.weight===2?80:140).avoidOverlaps(true).handleDisconnected(true)
      .convergenceThreshold(.001)
    // Bounded synchronous solve. No background timer or D3 adaptor, no groups/boxes.
    try{layout.start(80,0,120,0,false);positions=new Map(particles.map(n=>[n.id,{x:n.x,y:n.y}]))}
    finally{layout.stop()}
  }else{
    // Bundled ELK uses an in-process worker shim: no remote script, real Worker,
    // network access or persistent process. Never call terminateWorker on that shim.
    const elk=new ELK({algorithms:['stress']})
    const graph=await elk.layout({id:'root',layoutOptions:{
      'elk.algorithm':'org.eclipse.elk.stress','elk.randomSeed':String(seed),
      'elk.stress.iterationLimit':'300','elk.stress.epsilon':'0.001',
      'elk.stress.desiredEdgeLength':'140','elk.separateConnectedComponents':'true',
    },children:ordered.map(n=>({id:n.id,width:layoutDiameter(n,radii),height:layoutDiameter(n,radii),
      x:initial.get(n.id).x-layoutDiameter(n,radii)/2,y:initial.get(n.id).y-layoutDiameter(n,radii)/2})),
      edges:edges.map((e,i)=>({id:'e'+i,sources:[e.from],targets:[e.to],layoutOptions:{
        'elk.stress.desiredEdgeLength':e.weight===2?'80':'140',
      }}))})
    // ELK coordinates are top-left; the shared Canvas consumes node centers.
    positions=new Map(graph.children.map(n=>[n.id,{x:n.x+n.width/2,y:n.y+n.height/2}]))
  }
  if(positions.size!==ordered.length)throw Error(engine+': incomplete layout')
  for(const [id,p]of positions)if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw Error(engine+': non-finite position '+id)
  return {positions,milliseconds:performance.now()-start}
}
