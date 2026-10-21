// Label placement for laid-out BPMN diagrams.
//
// Extracted verbatim from orthogonal-routing.mjs when that module's routing
// core was superseded by router.mjs + search.mjs (revision 10). Label
// placement is an independent presentation pass over the FINAL geometry:
// it scores candidate rectangles against node boxes, already-placed labels
// and route segments, and never rewrites semantic text.

import { boxOverlap, distance, hit, segments } from './router.mjs';

export function placeLabels(model) {
  const placed=[];const allSegments=model.edges.flatMap(e=>segments(e.waypoint));
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
  for(const edge of model.edges) {
    const name=edge.bpmnElement.name;if(!name)continue;
    const width=Math.min(140,Math.max(56,Array.from(name).length*13)),height=Array.from(name).length>10?36:20;
    const options=[];
    for(const [a,b]of segments(edge.waypoint)) {
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
    const score=r=>Number(outside(r))*100000+model.nodes.filter(n=>boxOverlap(n.bounds,r)).length*10000+placed.filter(p=>boxOverlap(p,r)).length*10000+allSegments.filter(([a,b])=>hit(a,b,r)).length*100;
    const chosen=options.map((r,i)=>({r,s:score(r)+i*.01})).sort((a,b)=>a.s-b.s)[0].r;
    edge.label=model.moddle.create('bpmndi:BPMNLabel',{bounds:model.moddle.create('dc:Bounds',chosen)});placed.push(chosen);
  }
}
