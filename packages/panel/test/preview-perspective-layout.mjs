/** Ephemeral coordinates only. No labels, communities or graph writes. */
export function previewPositions(scope, mode) {
  const nodes = [...scope.nodes].sort((a,b)=>a.id.localeCompare(b.id))
  const index = new Map(nodes.map((n,i)=>[n.id,i])), pairs = new Map()
  for(const e of scope.edges) {
    const a=index.get(e.from),b=index.get(e.to)
    if(a===undefined||b===undefined||a===b)continue
    const key=[Math.min(a,b),Math.max(a,b)].join(':')
    if(!pairs.has(key))pairs.set(key,[a,b])
  }
  const links=[...pairs.values()],degree=nodes.map(()=>0)
  for(const [a,b] of links){degree[a]++;degree[b]++}
  const files=[...new Set(nodes.map(n=>n.file))].sort(),counts=new Map()
  const anchors=nodes.map(n=>{
    const i=files.indexOf(n.file),angle=i*Math.PI*2/Math.max(1,files.length)
    return {x:Math.cos(angle)*Math.max(500,files.length*180),y:Math.sin(angle)*Math.max(500,files.length*180)}
  })
  const points=nodes.map((n,i)=>{
    const k=mode==='source'?(counts.get(n.file)??0):i;counts.set(n.file,k+1)
    const r=30*Math.sqrt(k+1),a=k*2.399963
    return {x:Math.cos(a)*r+(mode==='source'?anchors[i].x:0),y:Math.sin(a)*r+(mode==='source'?anchors[i].y:0)}
  })
  for(let step=0;step<650;step++){
    const forces=nodes.map(()=>({x:0,y:0}))
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      let dx=points[j].x-points[i].x,dy=points[j].y-points[i].y,d=Math.hypot(dx,dy)
      if(d<.01){dx=1;dy=.5;d=Math.hypot(dx,dy)}
      const min=nodes[i].record&&nodes[j].record?160:60
      const force=9000/(d*d)+Math.max(0,min-d)*.3
      const x=dx/d*force,y=dy/d*force
      forces[i].x-=x;forces[i].y-=y;forces[j].x+=x;forces[j].y+=y
    }
    for(const [a,b]of links){
      const dx=points[b].x-points[a].x,dy=points[b].y-points[a].y,d=Math.max(1,Math.hypot(dx,dy))
      // Hubs remain connected but do not dominate all spring strengths.
      const pull=mode==='source'?.001*d:8*Math.log1p(d/85)/Math.sqrt(Math.max(1,degree[a],degree[b]))
      const x=dx/d*pull,y=dy/d*pull
      forces[a].x+=x;forces[a].y+=y;forces[b].x-=x;forces[b].y-=y
    }
    const cooling=.25+.75*(1-step/650)
    for(let i=0;i<nodes.length;i++){
      const anchor=mode==='source'?anchors[i]:{x:0,y:0},gravity=mode==='source'?.027:.0015
      forces[i].x+=(anchor.x-points[i].x)*gravity;forces[i].y+=(anchor.y-points[i].y)*gravity
      points[i].x+=Math.max(-10,Math.min(10,forces[i].x))*cooling
      points[i].y+=Math.max(-10,Math.min(10,forces[i].y))*cooling
    }
  }
  return nodes.map((n,i)=>[n.id,points[i]])
}
