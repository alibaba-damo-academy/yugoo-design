// Experimental route-only channel separation. No node or lane is moved.
import {diagramCost} from './cost.mjs';
import {segments,length,simplify,hit} from './router.mjs';

const axisValue=(point,horizontal)=>horizontal?point.x:point.y;
const fixedValue=(point,horizontal)=>horizontal?point.y:point.x;
function exposedRun(a,b,p,q,horizontal,lo,hi,grace) {
  const cuts=[];
  for(const [id,point] of [[a.edge.sourceId,a.path[0]],[a.edge.targetId,a.path.at(-1)]]) {
    if(id!==b.edge.sourceId && id!==b.edge.targetId)continue;
    const other=id===b.edge.sourceId?b.path[0]:b.path.at(-1);
    for(const dock of [point,other])if(Math.abs(fixedValue(dock,horizontal)-fixedValue(p,horizontal))<=grace
      &&Math.abs(fixedValue(dock,horizontal)-fixedValue(q,horizontal))<=grace)
      cuts.push([Math.max(lo,axisValue(dock,horizontal)-grace),Math.min(hi,axisValue(dock,horizontal)+grace)]);
  }
  let cursor=lo,run=0;
  for(const [start,end]of cuts.filter(([s,e])=>e>s).sort((x,y)=>x[0]-y[0])) {
    if(start>cursor)run+=start-cursor;
    cursor=Math.max(cursor,end);
  }
  return run+Math.max(0,hi-cursor);
}
export function channelCrowding(state,{margin=24,endpointGrace=20}={}) {
  const list=[];
  for(const edge of [...state.edges].sort((a,b)=>a.id.localeCompare(b.id))) {
    const path=state.routes.get(edge.id)||[];
    segments(path).forEach(([a,b],i)=>list.push({edge,path,a,b,i,horizontal:a.y===b.y}));
  }
  const pairs=[];
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++) {
    const a=list[i],b=list[j];
    if(a.edge.id===b.edge.id || a.horizontal!==b.horizontal)continue;
    const d=Math.abs(fixedValue(a.a,a.horizontal)-fixedValue(b.a,b.horizontal));
    if(d>=margin)continue;
    const lo=Math.max(Math.min(axisValue(a.a,a.horizontal),axisValue(a.b,a.horizontal)),Math.min(axisValue(b.a,b.horizontal),axisValue(b.b,b.horizontal)));
    const hi=Math.min(Math.max(axisValue(a.a,a.horizontal),axisValue(a.b,a.horizontal)),Math.max(axisValue(b.a,b.horizontal),axisValue(b.b,b.horizontal)));
    if(hi<=lo)continue;
    const run=exposedRun(a,b,a.a,b.a,a.horizontal,lo,hi,endpointGrace);
    if(run<8)continue;
    pairs.push({a,b,gap:d,run,severity:run*(1-d/margin)});
  }
  pairs.sort((a,b)=>b.severity-a.severity||a.a.edge.id.localeCompare(b.a.edge.id)||a.a.i-b.a.i||a.b.edge.id.localeCompare(b.b.edge.id)||a.b.i-b.b.i);
  return {severity:pairs.reduce((n,p)=>n+p.severity,0),pairs};
}
const model=state=>({nodes:state.nodes,lanes:state.lanes,edges:state.edges.map(e=>({...e,waypoints:state.routes.get(e.id)||[]}))});
function offsetSegment(path,index,offset,grace) {
  const a=path[index],b=path[index+1];if(!a||!b)return null;
  const horizontal=a.y===b.y;
  const shift=p=>({...p,[horizontal?'y':'x']:fixedValue(p,horizontal)+offset});
  if(index>0 && index<path.length-2) {
    const out=path.map(p=>({...p}));out[index]=shift(a);out[index+1]=shift(b);return simplify(out);
  }
  // Keep both docks, and keep a short endpoint stem before opening a channel.
  if(length([a,b])<=2*grace+8)return null;
  const key=horizontal?'x':'y',sign=Math.sign(b[key]-a[key]);
  const p={...a,[key]:a[key]+sign*grace},q={...b,[key]:b[key]-sign*grace};
  return simplify([...path.slice(0,index),a,p,shift(p),shift(q),q,b,...path.slice(index+2)]);
}
export function spaceChannels(seed,{margin=24,endpointGrace=20,maxPasses=3,maxCandidates=96,allowsCost=()=>true}={}) {
  const baseline=diagramCost(model(seed));
  const originalLengths=new Map(seed.edges.map(e=>[e.id,length(seed.routes.get(e.id)||[])]));
  let state=seed,cost=baseline,crowding=channelCrowding(state,{margin,endpointGrace}),accepted=0,evaluated=0;
  const before=crowding.severity;
  for(let pass=0;pass<maxPasses && crowding.pairs.length;pass++) {
    let best=null,attempts=0;const seen=new Set();
    const score=(c,m)=>2*m.severity+.2*c.terms.length+8*c.counts.bend;
    let bestScore=score(cost,crowding);
    const targets=crowding.pairs.flatMap(p=>[p.a,p.b]);
    for(const segment of targets)for(const offset of [-margin,margin,-margin/2,margin/2]) {
      if(attempts>=maxCandidates)break;
      const key=`${segment.edge.id}:${segment.i}:${offset}`;if(seen.has(key))continue;seen.add(key);attempts++;evaluated++;
      const path=state.routes.get(segment.edge.id),candidate=offsetSegment(path,segment.i,offset,endpointGrace);
      if(!candidate || candidate.length>path.length+4 || length(candidate)>originalLengths.get(segment.edge.id)*1.15+40)continue;
      if(segments(candidate).some(([a,b])=>a.x!==b.x&&a.y!==b.y || state.nodes.some(n=>hit(a,b,n.bounds))))continue;
      if(segments(candidate).some(([a,b])=>state.nodes.some(n=>n.id!==segment.edge.sourceId&&n.id!==segment.edge.targetId
        &&hit(a,b,{x:n.bounds.x-8,y:n.bounds.y-8,width:n.bounds.width+16,height:n.bounds.height+16}))))continue;
      const routes=new Map(state.routes);routes.set(segment.edge.id,candidate);
      const next={...state,routes},nextCost=diagramCost(model(next));
      if(!allowsCost(nextCost) || nextCost.counts.nodeOverlap || nextCost.counts.crossing>cost.counts.crossing
        ||nextCost.terms.length>baseline.terms.length*1.15+40
        ||nextCost.terms.exterior>baseline.terms.exterior+1e-6
        ||nextCost.counts.bend>baseline.counts.bend+4)continue;
      const nextCrowding=channelCrowding(next,{margin,endpointGrace});
      // Clearance is a soft preference: improvement must pay for extra wire
      // and bends, and it may never purchase a new crossing or move nodes.
      const candidateScore=score(nextCost,nextCrowding);
      if(nextCrowding.severity>=crowding.severity-1 || candidateScore>=bestScore-.01)continue;
      best={state:next,cost:nextCost,crowding:nextCrowding};bestScore=candidateScore;
    }
    if(!best)break;
    state=best.state;cost=best.cost;crowding=best.crowding;accepted++;
  }
  return {state,cost,metrics:{margin,before,after:crowding.severity,nearParallelPairs:crowding.pairs.length,accepted,evaluated}};
}
