/** Experimental read model. All relationships come from the supplied full snapshot. */
export function createReadingIndex(source, owner) {
  const nodes=new Map(source.nodes.map(n=>[n.id,n]))
  const parents=new Map(source.edges.filter(e=>e.kind==='contains').map(e=>[e.to,e]))
  const groups=new Map(),unresolved=[]
  for(const edge of source.edges){
    if(edge.kind==='contains')continue
    const a=owner.get(edge.from),b=owner.get(edge.to)
    if(!nodes.has(edge.from)||!nodes.has(edge.to)||!a||!b){unresolved.push(edge.id);continue}
    if(a===b)continue
    for(const [root,other] of [[a,b],[b,a]]){
      if(!groups.has(root))groups.set(root,new Map())
      const map=groups.get(root)
      if(!map.has(other))map.set(other,{record:nodes.get(other),edges:[]})
      map.get(other).edges.push(edge)
    }
  }
  const relations=id=>[...(groups.get(owner.get(id))?.values()??[])].sort((a,b)=>a.record.label.localeCompare(b.record.label)||a.record.id.localeCompare(b.record.id))
  function neighborhood(id,target='',edgeId=''){
    const root=owner.get(id),visible=new Set(),edgeIds=new Set()
    if(!root)return {root,visible,edgeIds,records:[]}
    visible.add(root)
    const records=relations(root).filter(g=>!target||g.record.id===target)
    function path(id){
      const seen=new Set()
      while(nodes.has(id)&&!seen.has(id)){
        seen.add(id);visible.add(id)
        if(nodes.get(id).record)break
        const edge=parents.get(id)
        if(!edge)break
        edgeIds.add(edge.id);id=edge.from
      }
    }
    path(id)
    for(const group of records){
      visible.add(group.record.id)
      for(const e of group.edges){
        if(edgeId&&e.id!==edgeId)continue
        edgeIds.add(e.id);path(e.from);path(e.to)
      }
    }
    return {root,visible,edgeIds,records}
  }
  return {nodes,owner,relations,neighborhood,unresolved}
}

/** Aggregate overview edges retain original member IDs, so both views use one selection. */
export function readingEdgeActive(edge, selection){
  return selection.edgeIds.has(edge.id)||(edge.members??[]).some(e=>selection.edgeIds.has(e.id))
}

/** The layout projection may deduplicate identical evidence; retain every original
 * identity for reading without introducing any new rendered edge or relationship. */
export function withReadingMembers(scope,source,owner){
  const visible=new Set(scope.nodes.map(n=>n.id)),members=new Map()
  const endpoint=id=>visible.has(id)?id:owner.get(id)
  const key=(kind,from,to)=>JSON.stringify([kind,from,to])
  for(const e of source.edges){
    const from=endpoint(e.from),to=endpoint(e.to)
    if(!from||!to||from===to||!visible.has(from)||!visible.has(to))continue
    const k=key(e.kind,from,to)
    if(!members.has(k))members.set(k,[])
    members.get(k).push({id:e.id,from:e.from,to:e.to,label:e.label,evidence:e.evidence})
  }
  return {...scope,edges:scope.edges.map(e=>({...e,members:members.get(key(e.kind,e.from,e.to))??e.members}))}
}
