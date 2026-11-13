// Label placement for laid-out BPMN diagrams.
//
// Originally extracted from orthogonal-routing.mjs when that module's routing
// core was superseded by router.mjs + search.mjs (revision 10). Label
// placement is an independent presentation pass over the FINAL geometry:
// it scores candidate rectangles against node boxes, already-placed labels
// and route segments, and never rewrites semantic text.

import { boxOverlap, distance, hit, segments } from './router.mjs';

// bpmn-js external labels expand DI widths below this importer minimum.
export const MIN_FLOW_LABEL_WIDTH=90;

export function flowLabelSize(name) {
  const textWidth=Array.from(name).length*13;
  const width=Math.min(140,Math.max(56,textWidth));
  return {width,height:Array.from(name).length>10?Math.max(36,Math.ceil(textWidth/width)*16):20};
}

export function placeLabels(model) {
  const placed=[];const allSegments=model.edges.flatMap(e=>segments(e.waypoint));
  // Lane dividers are visible wires too; a caption must not be printed over
  // one merely because it is not a semantic sequence flow.
  for(const lane of model.lanes){
    const b=lane.bounds;
    if(lane.isHorizontal)for(const y of [b.y,b.y+b.height])allSegments.push([{x:b.x,y},{x:b.x+b.width,y}]);
    else for(const x of [b.x,b.x+b.width])allSegments.push([{x,y:b.y},{x,y:b.y+b.height}]);
  }
  const minX=Math.min(...model.lanes.map(l=>l.bounds.x))+4,maxX=Math.max(...model.lanes.map(l=>l.bounds.x+l.bounds.width))-4;
  const minY=Math.min(...model.lanes.map(l=>l.bounds.y))+44,maxY=Math.max(...model.lanes.map(l=>l.bounds.y+l.bounds.height))-4;
  const outside=p=>p.x<minX||p.x+p.width>maxX||p.y<minY||p.y+p.height>maxY;
  // External event/gateway labels also occupy space, unlike task-internal text.
  // Reserve them before sequence-flow labels. No semantic text is rewritten.
  for(const n of model.nodes) {
    if(!/Gateway$|Event$/.test(n.bpmnElement.$type)||!n.bpmnElement.name)continue;
    const r=n.bounds,width=120,height=36,options=[];
    for(const gap of [6,14,22])for(const shift of [0,-24,24]) {
      options.push({x:r.x+r.width/2-width/2+shift,y:r.y+r.height+gap,width,height});
      options.push({x:r.x-width-gap,y:r.y+r.height/2-height/2+shift,width,height});
      options.push({x:r.x+r.width+gap,y:r.y+r.height/2-height/2+shift,width,height});
    }
    const score=p=>Number(outside(p))*100000+model.nodes.filter(other=>boxOverlap(other.bounds,p)).length*10000+placed.filter(q=>boxOverlap(p,q)).length*10000+allSegments.filter(([a,b])=>hit(a,b,p)).length*100;
    const chosen=options.map((r,i)=>({r,s:score(r)+i*.01})).sort((a,b)=>a.s-b.s)[0].r;
    n.label=model.moddle.create('bpmndi:BPMNLabel',{bounds:model.moddle.create('dc:Bounds',chosen)});placed.push(chosen);
  }
  const pending=[];
  for(const edge of model.edges) {
    const name=edge.bpmnElement.name;if(!name)continue;
    const preferred=flowLabelSize(name);
    // Keep the preferred width when it fits. A narrow route corridor may
    // require wrapping beside the same wire rather than crossing a divider
    // or an unrelated return path. Reserve the full wrapped height.
    const sizes=[preferred,...[.75,.5].map(scale=>{const width=Math.max(MIN_FLOW_LABEL_WIDTH,Math.floor(preferred.width*scale));return {width,height:Math.max(36,Math.ceil(Array.from(name).length*13/width)*16)};})].filter((s,i,a)=>s.width<=preferred.width&&a.findIndex(t=>t.width===s.width)===i);
    const options=[];
    for(const {width,height} of sizes)for(const [a,b]of segments(edge.waypoint)) {
      const span=distance(a,b);
      const positions=[.5,.25,.75,...Array.from({length:Math.floor(span/12)},(_,i)=>(i*12+6)/span)];
      for(const t of positions) {
        const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
        for(const gap of [6,14,22]) {
          if(a.y===b.y){options.push({x:x-width/2,y:y-height-gap,width,height},{x:x-width/2,y:y+gap,width,height})}
          else options.push({x:x+gap,y:y-height/2,width,height},{x:x-width-gap,y:y-height/2,width,height});
        }
      }
    }
    const available=options.filter(r=>!outside(r)&&!model.nodes.some(n=>boxOverlap(n.bounds,r))
      &&!placed.some(p=>boxOverlap(p,r))).length;
    pending.push({edge,options,available});
  }
  // Reserve short/constrained branches before routes that have many other
  // legal positions. ID order alone lets a flexible label consume the only
  // usable space beside a short branch, even when both labels could fit.
  pending.sort((a,b)=>a.available-b.available||a.edge.bpmnElement.id.localeCompare(b.edge.bpmnElement.id));
  for(const {edge,options} of pending) {
    const score=r=>Number(outside(r))*100000+model.nodes.filter(n=>boxOverlap(n.bounds,r)).length*10000+placed.filter(p=>boxOverlap(p,r)).length*10000+allSegments.filter(([a,b])=>hit(a,b,r)).length*100;
    // Candidate order only breaks ties: a long route has enough candidates
    // that adding its ordinal to the score can outweigh a real collision.
    const chosen=options.map((r,i)=>({r,s:score(r),i})).sort((a,b)=>a.s-b.s||a.i-b.i)[0].r;
    edge.label=model.moddle.create('bpmndi:BPMNLabel',{bounds:model.moddle.create('dc:Bounds',chosen)});placed.push(chosen);
  }
}
