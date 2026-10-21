import ForceGraph from 'force-graph'
import {forceCollide,forceX,forceY} from 'd3-force'
import {projectRecords,recordOwner} from '../src/client/graph-model.ts'
import {initialPositions} from './layout-comparison-engines.mjs'
import {calculateLive} from './graph-extra-engines.mjs'
import {recordReach,nodeRadius,layoutDiameter} from './graph-node-size.mjs'
import {createReadingIndex,readingEdgeActive,withReadingMembers} from './graph-reading.mjs'
import {dragNeighbors} from './graph-local-drag.mjs'
import {wrapLabel,placeLabels,orientToViewport} from './graph-labels.mjs'

// A read-only experiment: force-graph mutates only the copied simulation objects.
const source=JSON.parse(document.getElementById('graph-data').textContent)
const sourceBytes=JSON.stringify(source)
const reach=recordReach(source,new Map(source.nodes.map(n=>[n.id,recordOwner(source,n.id)])))
const reading=createReadingIndex(source,new Map(source.nodes.map(n=>[n.id,recordOwner(source,n.id)])))
const element=document.getElementById('graph')
const palette=['#9371c4','#409594','#c38b4e','#577cbe','#b56c94','#708f4f']
const owners=[...new Set(source.nodes.map(n=>n.owner))].sort()
let expanded=false,scope,nodes=[],links=[],adjacent=new Map(),selected='',hovered='',query=''
let initialFit=true,previewFit=true,ticks=0,stopped=false,dragged=0,released=0,labels=[],spacing=1
let algorithm='fCoSE',adjusted=false,layoutMilliseconds=0
let loading=false,layoutError='',generation=0
let sizeMode='uniform'
let labelBoxes=[],hiddenLabels=[]
const labelTextCache=new Map()
const labelPlacementCache=new Map()
const memory=new Map()
let targetRecord='',selectedEvidence='',readingSelection=reading.neighborhood('')
let localDrag=null,dragTimer=0,dragFrame=0,localSolves=0,maxLocalSolveMs=0
let dragWorker=null,workerDeadline=0,dragWorkerUrl=''
const idOf=n=>typeof n==='object'?n.id:n
const focus=()=>selected||hovered
const related=n=>!focus()||readingSelection.visible.has(n.id)
const emphasized=e=>!!focus()&&readingEdgeActive(e,readingSelection)
const matches=n=>!query||`${n.label} ${n.context??''}`.toLocaleLowerCase().includes(query)
const nodeColor=n=>palette[owners.indexOf(n.owner)%palette.length]
const radius=n=>nodeRadius(n,sizeMode,reach)
const sizeDescription=n=>n.record?`关联 ${reach.get(n.id)??0} 条其他设计记录（含语义候选；非重要程度）`:'子内容 · 大小固定'
const graph=new ForceGraph(element)
  .backgroundColor('#fafbfc').minZoom(.15).maxZoom(6)
  .d3AlphaDecay(.025).d3AlphaMin(.003).d3VelocityDecay(.3)
  .warmupTicks(160).cooldownTime(Infinity).cooldownTicks(Infinity)
  .nodeLabel(n=>{const text=document.createElement('div');text.textContent=n.label+' · '+sizeDescription(n);return text})
  .linkLabel(e=>{const text=document.createElement('div');text.textContent=e.kind==='contains'?'父子包含':'跨记录关联 · 语义关系为候选';return text})
  .linkColor(edgeColor).linkWidth(e=>emphasized(e)?2.5:1.4)
  .linkCanvasObjectMode(()=> 'replace')
  .linkCanvasObject(paintLink)
  .nodeCanvasObject(paintNode)
  .nodePointerAreaPaint(paintPointer)
  .onRenderFramePost(paintLabels)
  .onNodeHover(n=>{hovered=n?.id??'';element.style.cursor=n?'grab':'default';refresh()})
  .onNodeClick(n=>selectRecord(n.id))
  .onLinkClick(e=>{
    if(e.kind==='contains')return
    const originals=e.members??[e],member=originals.find(m=>selected&&[reading.owner.get(m.from),reading.owner.get(m.to)].includes(selected))??originals[0]
    const a=reading.owner.get(member.from),b=reading.owner.get(member.to)
    if(!a||!b||a===b)return
    if(selected!==a&&selected!==b)selected=a
    targetRecord=selected===a?b:a;selectedEvidence=member.id;hovered='';showDetail();refresh()
  })
  .onBackgroundClick(()=>{selected='';targetRecord='';selectedEvidence='';showDetail();refresh()})
  .onNodeDrag(n=>{
    if(algorithm==='fCoSE'){
      initialFit=false;dragged++;stopped=false;element.style.cursor='grabbing'
      // Keep the renderer, but never start a different force model for fCoSE.
      graph.cooldownTicks(0)
      if(layoutError){stopped=true;return} // A failed worker is not retried per mousemove.
      if(!localDrag||localDrag.id!==n.id||localDrag.released){
        cancelLocalDrag()
        localDrag={id:n.id,moving:dragNeighbors(scope,n.id),targets:new Map(),released:false}
      }
      adjusted=true;queueLocalSolve(n);showAlgorithm();return
    }
    if(algorithm!=='D3'&&!adjusted){adjusted=true;graph.cooldownTicks(Infinity);showAlgorithm()}
    // alphaMin stops idle work; alphaTarget alone cannot wake an already cold engine.
    if(stopped)graph.d3ReheatSimulation()
    dragged++;initialFit=false;stopped=false;element.style.cursor='grabbing'
  })
  .onNodeDragEnd(n=>{
    // Default drag is temporary, not a permanent pin. Let the network settle.
    delete n.fx;delete n.fy;released++;hovered='';element.style.cursor='grab';refresh()
    if(algorithm==='fCoSE'&&localDrag){
      clearTimeout(dragTimer);dragTimer=0;localDrag.released=true
      runLocalSolve(n);showAlgorithm()
    }
  })
  .onEngineTick(()=>{
    ticks++;stopped=false
    if(initialFit&&previewFit){previewFit=false;graph.zoomToFit(0,65)}
  })
  .onEngineStop(()=>{
    if(initialFit){initialFit=false;graph.zoomToFit(0,65)}
    stopped=!localDrag;updateStatus()
  })
graph.d3Force('center',null)
graph.d3Force('x',forceX(0).strength(.008))
graph.d3Force('y',forceY(0).strength(.008))

function cancelLocalDrag(){
  clearTimeout(dragTimer);cancelAnimationFrame(dragFrame);dragTimer=0;dragFrame=0;localDrag=null
  clearTimeout(workerDeadline);workerDeadline=0;dragWorker?.terminate();dragWorker=null
  if(dragWorkerUrl){URL.revokeObjectURL(dragWorkerUrl);dragWorkerUrl=''}
}
function queueLocalSolve(n){
  if(!dragTimer)dragTimer=setTimeout(()=>{dragTimer=0;if(localDrag?.id===n.id)runLocalSolve(n)},70)
}
function runLocalSolve(n){
  if(!localDrag||loading||algorithm!=='fCoSE')return
  if(localDrag.busy){localDrag.pending=true;return}
  const active=localDrag
  const fail=error=>{
    if(localDrag!==active)return
    layoutError=`局部调整失败：${String(error)}`;cancelLocalDrag();stopped=true;showAlgorithm()
  }
  try{
    if(!dragWorker){
      dragWorkerUrl=URL.createObjectURL(new Blob([JSON.parse(document.getElementById('drag-worker-code').textContent)],{type:'text/javascript'}))
      dragWorker=new Worker(dragWorkerUrl)
    }
    dragWorker.onerror=e=>{e.preventDefault();fail(e.message||'geometry worker could not load')}
    dragWorker.onmessage=({data})=>{
      if(localDrag!==active)return
      clearTimeout(workerDeadline);workerDeadline=0;active.busy=false
      if(data.error){fail(data.error);return}
      const result=data.result
      localSolves++;maxLocalSolveMs=Math.max(maxLocalSolveMs,result.milliseconds)
      active.targets=new Map([...result.positions].filter(([id])=>active.moving.has(id)))
      if(!dragFrame)dragFrame=requestAnimationFrame(animateLocalDrag)
      if(active.pending){active.pending=false;runLocalSolve(nodes.find(n=>n.id===active.id))}
    }
    const positions=new Map(nodes.map(n=>[n.id,{x:n.x,y:n.y}]))
    const radii=sizeMode==='reach'?new Map(nodes.map(n=>[n.id,radius(n)])):undefined
    active.busy=true
    // One request in flight, one coalesced latest pointer position; never a backlog.
    dragWorker.postMessage({scope,positions,id:n.id,point:{x:n.x,y:n.y},options:{spacing,radii,readingSpace:true}})
    workerDeadline=setTimeout(()=>fail('worker timeout'),10000)
  }catch(error){fail(error)}
}
function animateLocalDrag(){
  dragFrame=0
  if(!localDrag)return
  let remaining=0
  for(const n of nodes){
    const target=localDrag.targets.get(n.id)
    if(!target)continue
    const dx=target.x-n.x,dy=target.y-n.y,d=Math.hypot(dx,dy)
    if(d<.15){n.x=target.x;n.y=target.y}else{n.x+=dx*.3;n.y+=dy*.3;remaining++}
    n.vx=0;n.vy=0
  }
  refresh()
  if(remaining)dragFrame=requestAnimationFrame(animateLocalDrag)
  else if(localDrag.released&&!localDrag.busy&&!localDrag.pending){
    cancelLocalDrag();stopped=true;showAlgorithm()
  }
}

function edgeColor(e){
  const active=focus()
  if(active&&!emphasized(e))return e.kind==='contains'?'#b1bbc328':'#798cab1c'
  return e.kind==='contains'?(active?'#687689':'#a0aab7a6'):active?'#355fa8':'#7188ae99'
}
function paintLink(e,ctx,scale){
  if(typeof e.source!=='object'||typeof e.target!=='object')return
  ctx.save();ctx.strokeStyle=edgeColor(e)
  const contains=e.kind==='contains'
  ctx.lineWidth=(contains?(emphasized(e)?1.5:1):emphasized(e)?2.6:1.3)/scale
  ctx.setLineDash(contains?[4/scale,4/scale]:[]);ctx.beginPath()
  ctx.moveTo(e.source.x,e.source.y);ctx.lineTo(e.target.x,e.target.y);ctx.stroke();ctx.restore()
}
function refresh(){readingSelection=reading.neighborhood(focus(),selected?targetRecord:'',selected?selectedEvidence:'');graph.nodeCanvasObject((...args)=>paintNode(...args));graph.linkColor(e=>edgeColor(e));window.graphSpatial?.refresh()}
function selectRecord(id){
  const root=reading.owner.get(id)
  if(!root)return
  selected=selected===root?'':root;hovered='';targetRecord='';selectedEvidence='';showDetail();refresh()
}
function paintNode(n,ctx,scale){
  ctx.globalAlpha=related(n)&&matches(n)?1:.13
  const r=radius(n)/scale
  ctx.fillStyle=nodeColor(n);ctx.beginPath();ctx.arc(n.x,n.y,r,0,2*Math.PI);ctx.fill()
  ctx.strokeStyle='#fafbfc';ctx.lineWidth=1.5/scale;ctx.stroke()
  if(n.id===focus()){
    ctx.strokeStyle=nodeColor(n);ctx.lineWidth=1.5/scale
    ctx.beginPath();ctx.arc(n.x,n.y,r+4/scale,0,2*Math.PI);ctx.stroke()
  }
  ctx.globalAlpha=1
}
function paintPointer(n,color,ctx,scale){
  ctx.fillStyle=color;ctx.beginPath();ctx.arc(n.x,n.y,Math.max(radius(n),9)/scale,0,2*Math.PI);ctx.fill()
}
function paintLabels(ctx,scale){
  labels=[]
  const endpointIds=selectedEvidence?source.edges.filter(e=>e.id===selectedEvidence).flatMap(e=>reading.owner.get(e.from)===selected?[e.from,e.to]:[e.to,e.from]):[]
  const candidates=nodes.filter(n=>related(n)&&matches(n)&&
    (n.id===focus()||n.id===hovered||n.record||selectedEvidence||scale>1.15||query))
    .sort((a,b)=>Number(b.id===focus())-Number(a.id===focus())||Number(endpointIds.includes(b.id))-Number(endpointIds.includes(a.id))||Number(b.record)-Number(a.record)||
      (adjacent.get(b.id)?.size??0)-(adjacent.get(a.id)?.size??0)||a.id.localeCompare(b.id))
  const items=[]
  for(const n of candidates){
    const font=n.record?13:12,badge=endpointIds.indexOf(n.id)
    const text=badge<0?n.label:`${badge===0?'A':'B'} · ${n.label}`
    const key=JSON.stringify([n.id,badge])
    if(!labelTextCache.has(key)){
      ctx.font=`${n.record?'600':'400'} ${font}px system-ui`
      const lines=wrapLabel(text,s=>ctx.measureText(s).width,n.record?154:175,n.record?3:2)
      labelTextCache.set(key,{lines,width:Math.max(...lines.map(s=>ctx.measureText(s).width))})
    }
    const {lines,width}=labelTextCache.get(key)
    const p=graph.graph2ScreenCoords(n.x,n.y)
    if(p.x<0||p.y<0||p.x>graph.width()||p.y>graph.height())continue
    const item={id:n.id,n,x:p.x,y:p.y,w:width+10,h:lines.length*(font+4)+6,lines,font,badge,gap:radius(n)+7}
    const old=labelPlacementCache.get(n.id)
    if(old&&old.x===item.x&&old.y===item.y&&old.w===item.w&&old.h===item.h)item.preferred=old.box
    items.push(item)
  }
  const obstacles=nodes.filter(n=>related(n)).map(n=>{const p=graph.graph2ScreenCoords(n.x,n.y),r=radius(n)+3;return {x:p.x-r,y:p.y-r,w:2*r,h:2*r}})
  const result=placeLabels(items,obstacles,graph.width(),graph.height())
  hiddenLabels=result.hidden;labelBoxes=result.placed.map(p=>({id:p.id,...p.box}))
  for(const item of result.placed){
    labelPlacementCache.set(item.id,item)
    const {n,box,lines,font,badge}=item;labels.push(n.id)
    const p=graph.screen2GraphCoords(box.x,box.y)
    // A small leader disambiguates labels that had to avoid a nearby node.
    const end={x:Math.max(box.x,Math.min(item.x,box.x+box.w)),y:Math.max(box.y,Math.min(item.y,box.y+box.h))}
    const endpoint=graph.screen2GraphCoords(end.x,end.y)
    ctx.strokeStyle='#a9b2bf';ctx.lineWidth=.6/scale;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(n.x,n.y);ctx.lineTo(endpoint.x,endpoint.y);ctx.stroke()
    ctx.fillStyle=badge<0?'#fafbfcf5':'#edf3fff5';ctx.fillRect(p.x,p.y,box.w/scale,box.h/scale)
    ctx.font=`${n.record?'600':'400'} ${font/scale}px system-ui`
    ctx.fillStyle=n.id===focus()||badge>=0?'#233d65':n.record?'#354052':'#657083'
    ctx.textAlign='left';ctx.textBaseline='top'
    lines.forEach((line,i)=>ctx.fillText(line,p.x+5/scale,p.y+(3+i*(font+4))/scale))
  }
  const note=selectedEvidence?'A / B 对照右侧两处原文；虚线追溯所属记录。':selected?'突出显示所选记录及其关联；点击右侧一项查看依据。':expanded?'全部子内容已展开；主要记录优先标注，放大或悬停查看子内容。':'每个圆点是一条设计记录；连线聚合其子内容间的关联。'
  const hint=document.getElementById('reading-note');if(hint.textContent!==note)hint.textContent=note
}
function configureForces(){
  const degree=new Map(nodes.map(n=>[n.id,0]))
  for(const e of links){degree.set(idOf(e.source),degree.get(idOf(e.source))+1);degree.set(idOf(e.target),degree.get(idOf(e.target))+1)}
  // Standard degree-normalised D3 springs; containment is shorter than a relation.
  // No per-record center/regions, artificial layout edges or semantic filtering.
  graph.d3Force('link').distance(e=>(e.kind==='contains'?85:170)*spacing)
    .strength(e=>(e.kind==='contains'?1:.55)/Math.min(degree.get(idOf(e.source)),degree.get(idOf(e.target))))
  graph.d3Force('charge').strength(n=>(n.record?-400:-135)*spacing*spacing).distanceMax(900*spacing)
  graph.d3Force('collision',forceCollide(n=>((n.record?52:20)+4*Math.max(0,radius(n)-6))*spacing).iterations(2))
  // Standard global gravity, aspect-adjusted to use the available canvas.
  // It does not assign positions or centers to any record/community.
  graph.d3Force('y').strength(.008*Math.max(1,graph.width()/graph.height())**2)
}
async function rebuild(reset=false){
  cancelLocalDrag()
  const version=++generation,chosenAlgorithm=algorithm
  loading=true;layoutError='';stopped=false;showAlgorithm()
  graph.pauseAnimation()
  element.style.pointerEvents='none'
  for(const id of ['overview','expanded','reset','spacing','fit','node-size'])document.getElementById(id).disabled=true
  try{
  if(!reset)for(const n of nodes)memory.set(n.id,n)
  else memory.clear()
  const nextScope=withReadingMembers(projectRecords(source,expanded),source,reading.owner)
  const nextNodes=nextScope.nodes.map((n,i)=>{
    const previous=memory.get(n.id),parent=memory.get(n.parentId)||memory.get(n.recordId)
    const angle=i*2.399963229728653
    return {...n,x:previous?.x??(parent?parent.x+Math.cos(angle)*40:Math.cos(angle)*Math.sqrt(i+1)*36),
      y:previous?.y??(parent?parent.y+Math.sin(angle)*40:Math.sin(angle)*Math.sqrt(i+1)*36),vx:previous?.vx??0,vy:previous?.vy??0}
  })
  adjusted=false;layoutMilliseconds=0
  if(algorithm!=='D3'){
    const radii=sizeMode==='reach'?new Map(nextScope.nodes.map(n=>[n.id,radius(n)])):undefined
    let initial=initialPositions(nextScope,42,reset?new Map():memory),incremental=!reset,coarseMilliseconds=0
    if(reset&&expanded&&chosenAlgorithm==='fCoSE'){
      // The same coarse-to-fine route as opening overview, then expanding:
      // native fCoSE on real record relations seeds the full native solve.
      // No invented edges, forced file clusters, or compound rectangles.
      const coarse=projectRecords(source,false)
      const seed=await calculateLive(chosenAlgorithm,coarse,initialPositions(coarse,42),{radii,readingSpace:true})
      if(version!==generation)return
      initial=initialPositions(nextScope,42,orientToViewport(seed.positions,graph.width()-220,graph.height()-170))
      incremental=true;coarseMilliseconds=seed.milliseconds
    }
    const result=await calculateLive(chosenAlgorithm,nextScope,initial,{incremental,radii,readingSpace:true})
    if(version!==generation)return
    layoutMilliseconds=result.milliseconds+coarseMilliseconds
    const positions=reset&&!expanded?orientToViewport(result.positions,graph.width()-220,graph.height()-170):result.positions
    for(const n of nextNodes){const p=positions.get(n.id);n.x=p.x*spacing;n.y=p.y*spacing;n.vx=0;n.vy=0}
  }
  scope=nextScope;nodes=nextNodes;loading=false
  links=scope.edges.map(e=>({...e,source:e.from,target:e.to}))
  adjacent=new Map(nodes.map(n=>[n.id,new Set()]))
  for(const e of links){adjacent.get(e.from)?.add(e.to);adjacent.get(e.to)?.add(e.from)}
  hovered='';stopped=false
  // Preserve the chosen solver's actual result until the user starts dragging.
  graph.cooldownTicks(algorithm==='D3'?Infinity:0).warmupTicks(algorithm==='D3'&&reset?160:0).graphData({nodes,links})
  configureForces();graph.d3ReheatSimulation();refresh();showDetail();updateStatus()
  showAlgorithm()
  document.getElementById('overview').setAttribute('aria-pressed',String(!expanded))
  document.getElementById('expanded').setAttribute('aria-pressed',String(expanded))
  }catch(error){
    if(version!==generation)return
    layoutError=String(error);stopped=true
  }finally{
    if(version===generation){
      loading=false;element.style.pointerEvents=''
      for(const id of ['overview','expanded','reset','spacing','fit','node-size'])document.getElementById(id).disabled=false
      if(!document.hidden&&!window.graphSpatial?.active)graph.resumeAnimation()
      showAlgorithm()
    }
  }
}
function updateStatus(){document.getElementById('status').textContent=`${nodes.length} 节点 · ${links.length} 连线`}
function showAlgorithm(){
  document.getElementById('size-note').textContent=sizeMode==='reach'?
    '大小：关联的不同设计记录数（含语义候选，非重要程度）；半径从 2.5px 起，面积随计数增加，48 条及以上封顶约 21px；两份设计使用同一标尺，子内容固定 2px。'+(algorithm==='ForceAtlas2 LinLog'?' 此模式启用 FA2 尺寸避让。':''):
    '大小：设计记录统一半径 4px，子内容统一 2px；切换“按关联范围”比较联系广度。'
  document.getElementById('algorithm-note').textContent=loading?`${algorithm}：正在计算布局…`:layoutError?`${algorithm} 计算失败，未切换到其他算法：${layoutError}`:algorithm==='D3'?'D3：持续力导向布局，拖动后自然稳定。':algorithm==='fCoSE'?
    `fCoSE：拖动时仅调整直接邻居，远处节点保持原位；不切换 D3。${localDrag?'正在局部调整…':adjusted?'局部调整已稳定。':'重新布局可恢复全图布局。'}`:
    adjusted?`${algorithm} 初始布局 · 当前已用 D3 弹性调整；“重新布局”恢复算法结果。`:
    `${algorithm}：保留算法原始布局（本次 ${Math.round(layoutMilliseconds)} ms）；开始拖动后使用 D3 弹性调整。`
}
function showDetail(){
  const body=document.getElementById('detail-body'),title=document.getElementById('detail-title'),n=reading.nodes.get(selected)
  body.replaceChildren()
  const add=(parent,tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;parent.append(el);return el}
  const button=(parent,text,fn,cls)=>{const el=add(parent,'button',text,cls);el.type='button';el.onclick=fn;return el}
  if(!n){
    title.textContent='选择一项设计，查看它与哪些内容有关'
    add(body,'p','点击节点查看关联记录；再选择一项关联，对照两边的原始内容。图的位置不会因选择而重排。')
    add(body,'p','实线是跨记录关联，细虚线是父子包含。语义相似只是线索，不代表已确认的业务关系。')
    const list=add(body,'div','','record-picker')
    for(const record of source.nodes.filter(n=>n.record&&matches(n)))button(list,record.label,()=>selectRecord(record.id),'record-choice')
    return
  }
  title.textContent=n.label
  button(body,'清除选择',()=>{selected='';targetRecord='';selectedEvidence='';showDetail();refresh()},'quiet')
  const groups=reading.relations(selected)
  if(!targetRecord)add(body,'p',`当前快照关联 ${groups.length} 条其他设计记录。点击下面一项，在图中追踪双方。`,'reading-summary')
  else button(body,`← 返回 ${groups.length} 条关联`,()=>{targetRecord='';selectedEvidence='';showDetail();refresh()},'back-relations')
  if(targetRecord)button(body,'放大这条关联',()=>window.graphSpatial?.active?window.graphSpatial.fit(true):graph.zoomToFit(350,115,n=>readingSelection.visible.has(n.id)),'focus-relation')
  if(reading.unresolved.length)add(body,'p',`${reading.unresolved.length} 条边的端点未解析；此列表不代表完整关联范围。`,'warning')
  const list=add(body,'div','','relations')
  for(const group of groups){
    if(targetRecord&&targetRecord!==group.record.id)continue
    const active=targetRecord===group.record.id,wrap=add(list,'section','','relation-group')
    const choose=button(wrap,group.record.label,()=>{targetRecord=active?'':group.record.id;selectedEvidence=active?'':group.edges[0]?.id??'';showDetail();refresh()},'relation-choice')
    choose.dataset.record=group.record.id;choose.setAttribute('aria-expanded',String(active))
    add(choose,'span',`${group.edges.length} 处关联依据 · ${[...new Set(group.edges.map(e=>e.kind==='semantic'?'语义候选':e.kind==='reference'?'显式引用':e.kind))].join(' / ')}`,'relation-meta')
    if(!active)continue
    button(wrap,'以这条记录为中心',()=>selectRecord(group.record.id),'quiet')
    const current=Math.max(0,group.edges.findIndex(e=>e.id===selectedEvidence))
    const bar=add(wrap,'div','','evidence-nav')
    const go=offset=>{selectedEvidence=group.edges[current+offset].id;showDetail();refresh()}
    const previous=button(bar,'上一处',()=>go(-1));previous.disabled=current===0
    add(bar,'span',`依据 ${current+1} / ${group.edges.length}`)
    const next=button(bar,'下一处',()=>go(1));next.disabled=current===group.edges.length-1
    for(const [i,e] of group.edges.entries()){
      if(i!==current)continue
      const chosen=e.id===selectedEvidence,card=add(wrap,'div','','evidence-card')
      card.classList.toggle('chosen',chosen)
      const pick=button(card,`依据 ${i+1} · ${e.label||e.kind}`,()=>{selectedEvidence=e.id;showDetail();refresh()},'evidence-choice')
      pick.dataset.edge=e.id;pick.setAttribute('aria-pressed',String(chosen))
      const ids=reading.owner.get(e.from)===selected?[e.from,e.to]:[e.to,e.from]
      for(const [j,id] of ids.entries()){
        const endpoint=reading.nodes.get(id),record=reading.nodes.get(reading.owner.get(id))
        add(card,'div',`${j===0?'A':'B'} · ${record?.label??''}`,'endpoint-owner')
        add(card,'p',endpoint?.label??'端点未加载','endpoint-text')
        const detail=add(card,'details','')
        add(detail,'summary','查看原始内容与位置')
        add(detail,'div',`${endpoint?.file??''}#${endpoint?.pointer??''}`,'source-locator')
        add(detail,'pre',endpoint?.context??'未附带更多原文')
      }
      if(e.kind==='semantic')add(card,'p','两处内容由 embedding 判为相近；这不是因果、依赖或已确认业务关系。','candidate-note')
      const raw=add(card,'details','');add(raw,'summary','关联来源 / 元数据');add(raw,'pre',e.evidence||'未附带证据元数据')
    }
  }
  if(!groups.length)add(body,'p','当前已加载快照未找到可解析的跨记录关联；不代表该设计无需关联。')
  const original=add(body,'details','');add(original,'summary','所选记录的原始内容');add(original,'pre',`${n.file}#${n.pointer}\n${n.context??''}`)
}
document.getElementById('overview').onclick=()=>{if(window.graphSpatial?.active)return window.graphSpatial.expand(false);if(expanded){expanded=false;initialFit=true;previewFit=true;rebuild()}}
document.getElementById('expanded').onclick=()=>{if(window.graphSpatial?.active)return window.graphSpatial.expand(true);if(!expanded){expanded=true;initialFit=true;previewFit=true;rebuild()}}
document.getElementById('fit').onclick=()=>window.graphSpatial?.active?window.graphSpatial.fit():graph.zoomToFit(400,85)
document.getElementById('reset').onclick=()=>{if(window.graphSpatial?.active)return window.graphSpatial.reset();initialFit=true;previewFit=true;rebuild(true)}
document.getElementById('algorithm').onchange=e=>{algorithm=e.target.value;initialFit=true;previewFit=true;rebuild(true)}
// Same seed/cold solver per mode for reproducible A/B; preserve the user's camera.
document.getElementById('node-size').onchange=e=>{sizeMode=e.target.value;if(window.graphSpatial?.active)return window.graphSpatial.resizeNodes();initialFit=false;previewFit=false;rebuild(true)}
document.getElementById('search').oninput=e=>{query=e.target.value.trim().toLocaleLowerCase();if(!selected)showDetail();refresh()}
document.getElementById('spacing').oninput=e=>{
  if(window.graphSpatial?.active)return window.graphSpatial.space(Number(e.target.value))
  cancelLocalDrag()
  const next=Number(e.target.value),ratio=next/spacing;spacing=next
  if(algorithm!=='D3'&&(!adjusted||algorithm==='fCoSE')){for(const n of nodes){n.x*=ratio;n.y*=ratio}stopped=true;refresh()}
  else{configureForces();graph.d3ReheatSimulation();stopped=false}
}
const resize=new ResizeObserver(()=>{graph.width(element.clientWidth).height(element.clientHeight)})
// Post-render labels are outside force-graph's node picking pass. Their own
// click target must follow the visible screen rectangle, not a stale shadow map.
let titlePress
element.addEventListener('pointerdown',event=>{
  titlePress=undefined
  if(window.graphSpatial?.active)return
  if(event.button!==0)return
  const bounds=element.getBoundingClientRect(),x=event.clientX-bounds.left,y=event.clientY-bounds.top
  const title=labelBoxes.find(b=>x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h)
  if(title){titlePress={id:title.id,x:event.clientX,y:event.clientY};event.stopPropagation()}
},true)
element.addEventListener('pointerup',event=>{
  if(!titlePress)return
  const press=titlePress;titlePress=undefined;event.stopPropagation()
  if(Math.hypot(event.clientX-press.x,event.clientY-press.y)<5)selectRecord(press.id)
},true)
element.addEventListener('pointercancel',()=>{titlePress=undefined})
element.addEventListener('pointerdown',()=>{initialFit=false})
element.addEventListener('wheel',()=>{initialFit=false},{passive:true})
resize.observe(element)
graph.width(element.clientWidth).height(element.clientHeight)
// The test API reports actual Canvas/engine state, not synthetic drag success.
window.graphExperiment={
  spatialBridge:{
    source:()=>structuredClone(source),
    state:()=>({selected,targetRecord,selectedEvidence,query,sizeMode,expanded,visible:new Set(readingSelection.visible),edgeIds:new Set(readingSelection.edgeIds)}),
    select:selectRecord,
    clear:()=>{selected='';hovered='';targetRecord='';selectedEvidence='';showDetail();refresh()},
    chooseEdge:e=>{
      if(e.kind==='contains')return
      const member=(e.members??[e]).find(m=>selected&&[reading.owner.get(m.from),reading.owner.get(m.to)].includes(selected))??(e.members??[e])[0]
      const a=reading.owner.get(member.from),b=reading.owner.get(member.to)
      if(!a||!b||a===b)return
      if(selected!==a&&selected!==b)selected=a
      targetRecord=selected===a?b:a;selectedEvidence=member.id;hovered='';showDetail();refresh()
    },
    pause:()=>{cancelLocalDrag();hovered='';graph.pauseAnimation();refresh()},
    resume:()=>{graph.resumeAnimation();document.getElementById('overview').setAttribute('aria-pressed',String(!expanded));document.getElementById('expanded').setAttribute('aria-pressed',String(expanded));updateStatus();showAlgorithm();refresh()},
  },
  snapshot:()=>({algorithm,sizeMode,adjusted,layoutMilliseconds,loading,layoutError,expanded,ticks,stopped:stopped&&!loading&&!localDrag,localDragging:!!localDrag,localSolves,maxLocalSolveMs,hovered,dragged,released,labels:[...labels],labelBoxes,hiddenLabels,selected,targetRecord,selectedEvidence,highlightedNodes:[...readingSelection.visible],highlightedEdges:[...readingSelection.edgeIds],relatedRecords:reading.relations(selected).map(g=>g.record.id),sourceUnchanged:JSON.stringify(source)===sourceBytes,
    camera:{...graph.centerAt(),zoom:graph.zoom()},nodes:nodes.map(n=>({id:n.id,label:n.label,record:n.record,radius:radius(n),reach:n.record?reach.get(n.id):null,layoutDiameter:layoutDiameter(n,new Map([[n.id,radius(n)]])),x:n.x,y:n.y,vx:n.vx,vy:n.vy,
      screen:graph.graph2ScreenCoords(n.x,n.y),fixed:n.fx!=null||n.fy!=null,degree:adjacent.get(n.id).size})),edges:links.length}),
  adjacent:id=>[...(adjacent.get(id)??[])],
}
window.addEventListener('pagehide',()=>{generation++;cancelLocalDrag();resize.disconnect();graph._destructor()},{once:true})
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){cancelLocalDrag();for(const n of nodes){delete n.fx;delete n.fy}graph.pauseAnimation()}
  else if(!window.graphSpatial?.active){graph.resumeAnimation();if(algorithm==='fCoSE')stopped=true}
})
document.getElementById('algorithm').value=algorithm
rebuild(true)
