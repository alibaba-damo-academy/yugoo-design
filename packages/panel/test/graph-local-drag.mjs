import {calculate} from './layout-comparison-engines.mjs'

/** UI policy, not semantic clustering: only the dragged node's immediate graph
 * neighbors may relax. All other positions are boundary constraints for fCoSE. */
export function dragNeighbors(scope,id){
  const known=new Set(scope.nodes.map(n=>n.id)),moving=new Set()
  for(const e of scope.edges){
    if(e.from===id&&e.to!==id&&known.has(e.to))moving.add(e.to)
    if(e.to===id&&e.from!==id&&known.has(e.from))moving.add(e.from)
  }
  return moving
}
export function solveLocalDrag(scope,positions,id,point,{radii,spacing=1,readingSpace=false}={}){
  if(!scope.nodes.some(n=>n.id===id)||!positions.has(id)||!Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isFinite(spacing)||!(spacing>0))throw Error('Invalid drag input')
  const moving=dragNeighbors(scope,id),initial=new Map([...positions].map(([key,p])=>[key,{x:p.x/spacing,y:p.y/spacing}]))
  initial.set(id,{x:point.x/spacing,y:point.y/spacing})
  const result=new Map([...positions].map(([key,p])=>[key,{...p}]))
  result.set(id,{...point})
  if(!moving.size)return {positions:result,moving,milliseconds:0}
  const fixed=new Set(scope.nodes.filter(n=>!moving.has(n.id)).map(n=>n.id))
  const solved=calculate('fCoSE',scope,initial,fixed,{incremental:true,radii,iterations:180,readingSpace})
  // Apply only free nodes; fixed nodes retain exact input bytes, not rounded solver output.
  for(const key of moving){const p=solved.positions.get(key);result.set(key,{x:p.x*spacing,y:p.y*spacing})}
  return {positions:result,moving,milliseconds:solved.milliseconds}
}
