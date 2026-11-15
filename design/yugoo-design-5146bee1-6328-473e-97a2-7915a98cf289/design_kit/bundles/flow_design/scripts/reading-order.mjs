// Experimental reading-first objective. Groups are discovered once from the
// seed and held fixed: moving apart must not erase an alignment obligation.
import { forwardRanks, diagramCost } from './cost.mjs';
import { translateMove } from './moves.mjs';
import { boxOverlap } from './router.mjs';

const center = (node, axis) => node.bounds[axis] + node.bounds[axis === 'x' ? 'width' : 'height'] / 2;
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const ALIGNMENT_EPS = .5;
const gap = (a,b,axis) => Math.max(a.bounds[axis],b.bounds[axis])
  - Math.min(a.bounds[axis]+a.bounds[axis==='x'?'width':'height'],b.bounds[axis]+b.bounds[axis==='x'?'width':'height']);

export function discoverReadingGroups(state) {
  const nodes = state.nodes.filter(n=>!n.attachTo).sort((a,b)=>a.id.localeCompare(b.id));
  const ranks = forwardRanks(nodes,state.edges);
  const outgoing = new Map(nodes.map(n=>[n.id,new Set()]));
  const incoming = new Map(nodes.map(n=>[n.id,new Set()]));
  for (const edge of state.edges) if (!edge.feedback && edge.sourceId!==edge.targetId) {
    outgoing.get(edge.sourceId)?.add(edge.targetId);
    incoming.get(edge.targetId)?.add(edge.sourceId);
  }
  const reaches = new Map();
  for (const node of nodes) {
    const seen = new Set(), todo = [...outgoing.get(node.id)];
    for (let i=0;i<todo.length;i++) {
      const id=todo[i]; if(seen.has(id))continue;
      seen.add(id); todo.push(...(outgoing.get(id)||[]));
    }
    reaches.set(node.id,seen);
  }
  const shared = (map,a,b) => [...map.get(a.id)].some(id=>map.get(b.id).has(id));
  const compatible = (a,b,axis) => {
    const orthogonal=axis==='x'?'y':'x';
    const distance=Math.abs(center(a,axis)-center(b,axis));
    const between=gap(a,b,orthogonal);
    if (between < 0) return false;
    if (axis==='y') {
      // Never flatten a causal ancestor and descendant into one reading row.
      if(reaches.get(a.id).has(b.id)||reaches.get(b.id).has(a.id))return false;
      const siblings=ranks.get(a.id)===ranks.get(b.id)
        && (shared(outgoing,a,b)||shared(incoming,a,b));
      return between<=480 && distance<=(siblings?144:40);
    }
    // A lane may contain several parallel tracks. Preserve a true column's
    // intent across its whole spine, not only the nearby pairs; do not join
    // coincident coordinates from different lanes or merge distant tracks.
    return a.laneId===b.laneId && (distance<=ALIGNMENT_EPS || between<=180 && distance<=40);
  };
  const groups=[];
  for (const axis of ['x','y']) {
    const pending=[...nodes].sort((a,b)=>center(a,axis)-center(b,axis)||a.id.localeCompare(b.id));
    const clusters=[];
    for(const node of pending) {
      // Complete linkage, not transitive snapping: a ladder of near pairs
      // must not merge into a far-spread row/column.
      const group=clusters.find(members=>members.every(other=>compatible(node,other,axis)));
      if(group)group.push(node);else clusters.push([node]);
    }
    for(const members of clusters)if(members.length>1)groups.push({axis,ids:members.map(n=>n.id).sort()});
  }
  return groups;
}

export const READING_PREFERENCES = Object.freeze({
  alignment: { tolerancePx: 4, alignmentWeight: 8, routeWeight: 1, routeDebt: .15, crossingDebt: 1 },
  balanced: { tolerancePx: 8, alignmentWeight: 4, routeWeight: 2, routeDebt: .25, crossingDebt: 2 },
  routing: { tolerancePx: 12, alignmentWeight: 2, routeWeight: 4, routeDebt: .35, crossingDebt: 3 },
});

export function createReadingObjective(seed, options = {}) {
  const preference = options.preference ?? 'alignment';
  const policy = READING_PREFERENCES[preference];
  if (!policy) throw new Error(`Unknown reading preference: ${preference}`);
  const seedCost=options.seedCost ?? diagramCost({nodes:seed.nodes,lanes:seed.lanes,
    edges:seed.edges.map(e=>({...e,waypoints:seed.routes.get(e.id)||[]}))});
  const groups=discoverReadingGroups(seed);
  const spreads = state => {
    const nodes=new Map(state.nodes.map(n=>[n.id,n]));
    return groups.map(group=>{
      const values=group.ids.map(id=>center(nodes.get(id),group.axis));
      return Math.max(...values)-Math.min(...values);
    });
  };
  const seedSpreads=spreads(seed);
  // Once a frozen row/column is aligned, neither another group's gain nor a
  // routing improvement may split it. Near seed groups are only heuristic
  // candidates: until aligned, keep the original preference/tolerance/debt
  // trade-offs rather than imposing monotonic spread on every loose group.
  const preservesAlignment = (state,previous) => spreads(state).every((value,index)=>
    Number.isFinite(value) && (previous[index]>ALIGNMENT_EPS || value<=ALIGNMENT_EPS + 1e-9));
  const original=new Map(seed.nodes.map(n=>[n.id,n]));
  const laneById=new Map(seed.lanes.map(l=>[l.id,l]));
  const error = state => {
    const nodes=new Map(state.nodes.map(n=>[n.id,n]));
    return groups.reduce((sum,group)=>{
      const values=group.ids.map(id=>center(nodes.get(id),group.axis));
      const target=median(values);
      return sum+values.reduce((dev,value)=>dev+Math.abs(value-target),0);
    },0);
  };
  // Compare mean alignment error, not a sum that grows with diagram size.
  // Fixed seed denominators make scores comparable across every candidate.
  const members=Math.max(1,groups.reduce((n,g)=>n+g.ids.length,0));
  const typicalSize=median(seed.nodes.filter(n=>!n.attachTo).map(n=>Math.max(n.bounds.width,n.bounds.height)))||100;
  const alignment = state => error(state)/members;
  const normalized = (cost,weights) => Object.entries(weights).reduce((sum,[key,weight])=>
    sum+weight*(cost.terms[key]||0)/Math.max(seedCost.terms[key]||0,64),0)/Object.values(weights).reduce((a,b)=>a+b,0);
  const regularity = cost => normalized(cost,{spine:1,row:1,rowCross:1,lattice:1,spacing:1,laneFit:1,sideGap:1});
  const reading = (state,cost) => policy.alignmentWeight*alignment(state)/typicalSize+.5*regularity(cost);
  const routing = cost => normalized(cost,{crossing:4,collinear:2,parallel:1,laneExtra:1,length:.5,bend:1,extraBend:1,exterior:2});
  const score = (state,cost) => reading(state,cost)+policy.routeWeight*routing(cost);
  const legalGeometry = state => {
    if(!preservesAlignment(state,seedSpreads))return false;
    const nodes=new Map(state.nodes.map(n=>[n.id,n]));
    for(const n of state.nodes) {
      const b=n.bounds,lane=laneById.get(n.laneId);
      if(![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0)return false;
      if(lane && (b.x<lane.bounds.x || b.y<lane.bounds.y || b.x+b.width>lane.bounds.x+lane.bounds.width || b.y+b.height>lane.bounds.y+lane.bounds.height))return false;
      if(n.attachTo) {
        const host=nodes.get(n.attachTo),before=original.get(n.id),oldHost=original.get(n.attachTo);
        if(!host||!before||!oldHost)return false;
        if(Math.abs((b.x-host.bounds.x)-(before.bounds.x-oldHost.bounds.x))>.01
          ||Math.abs((b.y-host.bounds.y)-(before.bounds.y-oldHost.bounds.y))>.01)return false;
      }
    }
    for(let i=0;i<state.nodes.length;i++)for(let j=i+1;j<state.nodes.length;j++) {
      const a=state.nodes[i],b=state.nodes[j];
      if(a.attachTo!==b.id && b.attachTo!==a.id && boxOverlap(a.bounds,b.bounds))return false;
    }
    for(const edge of state.edges) {
      if(edge.feedback||edge.sourceId===edge.targetId)continue;
      const a=original.get(edge.sourceId),b=original.get(edge.targetId);
      if(!a||!b||a.attachTo||b.attachTo)continue;
      if(center(b,'y')-center(a,'y')>20 && center(nodes.get(b.id),'y')<center(nodes.get(a.id),'y')+4)return false;
    }
    return true;
  };
  const allowsCost=cost=>routing(cost)<=routing(seedCost)*(1+policy.routeDebt)+1e-9
    &&cost.counts.crossing<=(seedCost.counts.crossing||0)+policy.crossingDebt;
  return {groups,error,alignment,reading,routing,score,legalGeometry,preference,policy,allowsCost,
    better(next,nextCost,prev,prevCost) {
      if(!legalGeometry(next)||nextCost.counts.nodeOverlap>0)return false;
      if(!preservesAlignment(next,spreads(prev)))return false;
      const a=alignment(next),b=alignment(prev),tolerance=policy.tolerancePx;
      // Bound debt against the INITIAL layout, not the last accepted move:
      // otherwise many small concessions accumulate into a large regression.
      if(a>alignment(seed)+tolerance || a>b+tolerance)return false;
      if(!allowsCost(nextCost))return false;
      if(Math.floor(a/tolerance)<Math.floor(b/tolerance))return true;
      return Math.floor(a/tolerance)<=Math.floor(b/tolerance)
        && score(next,nextCost)<score(prev,prevCost)-1e-6;
    },
    moves(state) {
      const nodes=new Map(state.nodes.map(n=>[n.id,n]));
      const out=[];
      for(const group of groups) {
        const values=group.ids.map(id=>center(nodes.get(id),group.axis)),target=median(values);
        const dev=values.reduce((sum,v)=>sum+Math.abs(v-target),0);
        if(dev<=.5)continue;
        for(const fraction of [1,.5]) {
          const base=new Map(group.ids.map(id=>[id,{[group.axis==='x'?'dx':'dy']:(target-center(nodes.get(id),group.axis))*fraction}]));
          const move=translateMove('readingGroup',`readingGroup ${group.axis} ${group.ids.join(',')} ${fraction}`,state,base);
          out.push({move,dev,fraction});
        }
      }
      return out.sort((a,b)=>b.dev-a.dev||b.fraction-a.fraction||a.move.label.localeCompare(b.move.label)).slice(0,24).map(v=>v.move);
    },
  };
}
