import ForceGraph3D from '3d-force-graph'
import * as THREE from 'three'
import {forceX,forceY,forceZ} from 'd3-force-3d'
import {OrbitControls} from 'spatial-orbit'
import {projectRecords,recordOwner} from '../src/client/graph-model.ts'
import {withReadingMembers,readingEdgeActive} from './graph-reading.mjs'
import {recordReach,nodeRadius} from './graph-node-size.mjs'
import {wrapLabel,placeLabels} from './graph-labels.mjs'

const bridge=window.graphExperiment.spatialBridge,source=bridge.source(),original=JSON.stringify(source)
const owner=new Map(source.nodes.map(n=>[n.id,recordOwner(source,n.id)])),reach=recordReach(source,owner)
const host=document.getElementById('graph'),palette=['#9371c4','#409594','#c38b4e','#577cbe','#b56c94','#708f4f']
const owners=[...new Set(source.nodes.map(n=>n.owner))].sort()
const color=n=>palette[owners.indexOf(n.owner)%palette.length]
const stage=document.createElement('div');stage.id='graph-spatial';stage.style.cssText='position:absolute;inset:0;display:none;background:#fafbfc';host.append(stage)
const labelLayer=document.createElement('div');labelLayer.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden';stage.append(labelLayer)
const style=document.createElement('style');style.textContent=`#graph-spatial .spatial-label{position:absolute;pointer-events:auto;border:0;border-radius:3px;background:#fafbfceb;padding:3px 5px;text-align:left;line-height:17px;font:12px/17px system-ui;color:#485769;cursor:pointer;white-space:pre-wrap}#graph-spatial .spatial-label.record{font-weight:600;color:#354052}#graph-spatial .spatial-label.endpoint{background:#eaf1fc;color:#244a80}#spatial-help{margin:8px 0 0;color:#5a6d84;font-size:12px}#graph-spatial canvas{outline:none}`;document.head.append(style)
const view=document.createElement('select');view.id='dimensions';view.setAttribute('aria-label','图形维度')
view.innerHTML='<option value="2d">2D · 平面</option><option value="3d">3D · 空间</option>'
document.querySelector('nav').prepend(view)
const help=document.createElement('p');help.id='spatial-help';document.querySelector('header').append(help)
const engineLabel=document.createElement('span');engineLabel.textContent='3D · 原生力导向';engineLabel.hidden=true;view.after(engineLabel)
const engine=document.createElement('select');engine.id='spatial-engine';engine.setAttribute('aria-label','三维布局算法');engine.innerHTML='<option value="d3">D3 · 三维力导向</option><option value="ngraph">ngraph · 三维弹簧</option><option value="stress">Stress · 三维全局距离</option>';engineLabel.replaceWith(engine)
const projection=document.createElement('select');projection.id='spatial-projection';projection.setAttribute('aria-label','三维投影');projection.innerHTML='<option value="perspective">透视 · 近大远小</option><option value="orthographic">正交 · 大小可比</option>';engine.after(projection)
const sizeLegend=document.createElement('span');sizeLegend.id='spatial-size-legend';sizeLegend.style.cssText='display:inline-flex;align-items:center;gap:8px;font-size:12px;color:#64748b;margin:6px 0';help.after(sizeLegend)
const stress=JSON.parse(document.getElementById('stress-3d')?.textContent??'null')
if(!stress?.scopes){const option=engine.querySelector('[value="stress"]');option.disabled=true;option.textContent='Stress · 此快照未预计算（不影响其他 3D 引擎）'}
let ortho,orthoControls,renderPass,orthoPointerStart
const orthographic=()=>projection.value==='orthographic'
const activeCamera=()=>orthographic()?ortho:graph.camera()
const activeControls=()=>orthographic()?orthoControls:graph.controls()
const screen=n=>{const p=new THREE.Vector3(n.x,n.y,n.z).project(activeCamera());return {x:(p.x+1)*host.clientWidth/2,y:(1-p.y)*host.clientHeight/2}}
let graph,active=false,expanded=false,nodes=[],links=[],stopped=false,error='',frame=0,dragCount=0,releaseCount=0,needsFit=false,spacing=1,labels=[],labelSignature=''
const positions=new Map(),objects=new Map(),edgeObjects=new Map(),textCache=new Map()
const measure=document.createElement('canvas').getContext('2d');measure.font='12px system-ui'
let dirty=true
const state=()=>bridge.state()
const focus=()=>state().selected
const selectedEdge=e=>readingEdgeActive(e,{edgeIds:state().edgeIds})
const visible=n=>!focus()||state().visible.has(n.id)
const matches=n=>!state().query||`${n.label} ${n.context??''}`.toLocaleLowerCase().includes(state().query)
const radius=n=>nodeRadius(n,state().sizeMode,reach)*(n.record?1.65:1.1)
const point=new THREE.Vector3(),unitY=new THREE.Vector3(0,1,0)
function init(){
  if(graph)return
  const mount=document.createElement('div');stage.prepend(mount)
  graph=new ForceGraph3D(mount,{controlType:'orbit',rendererConfig:{antialias:true,alpha:true}})
    .backgroundColor('#fafbfc').showNavInfo(false).numDimensions(3)
    .width(host.clientWidth).height(host.clientHeight)
    .warmupTicks(120).cooldownTicks(180).cooldownTime(8000).d3AlphaDecay(.035).d3VelocityDecay(.35)
    .nodeLabel(n=>{const el=document.createElement('div');el.textContent=n.label+(n.record?` · 关联 ${reach.get(n.id)??0} 项设计（含语义候选）`:'');return el})
    .nodeThreeObject(n=>{
      const material=new THREE.MeshBasicMaterial({color:color(n),transparent:true})
      const sphere=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),material);sphere.scale.setScalar(radius(n));objects.set(n.id,sphere);return sphere
    })
    .linkThreeObject(e=>{
      let object
      if(e.kind==='contains'){
        const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()])
        object=new THREE.Line(geometry,new THREE.LineDashedMaterial({color:'#8290a2',transparent:true,opacity:.55,dashSize:4,gapSize:3}))
      }else object=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,6),new THREE.MeshBasicMaterial({color:'#6a87b6',transparent:true,opacity:.6}))
      edgeObjects.set(e.id,object);return object
    })
    .linkPositionUpdate((object,{start,end},e)=>{
      if(e.kind==='contains'){
        const a=object.geometry.attributes.position;a.setXYZ(0,start.x,start.y,start.z);a.setXYZ(1,end.x,end.y,end.z);a.needsUpdate=true;object.computeLineDistances();object.geometry.computeBoundingSphere()
      }else{
        point.set(end.x-start.x,end.y-start.y,end.z-start.z)
        const length=point.length();object.position.set((start.x+end.x)/2,(start.y+end.y)/2,(start.z+end.z)/2)
        object.quaternion.setFromUnitVectors(unitY,point.normalize());object.scale.set(selectedEdge(e)?2.2:1,length,selectedEdge(e)?2.2:1)
      }
      return true
    })
    .onNodeClick(n=>bridge.select(n.id))
    .onLinkClick(e=>bridge.chooseEdge(e))
    .onBackgroundClick(()=>bridge.clear())
    .onNodeHover(n=>{stage.style.cursor=n?'grab':'default'})
    .onNodeDrag(()=>{dragCount++;stopped=false;needsFit=false;dirty=true})
    .onNodeDragEnd(n=>{delete n.fx;delete n.fy;delete n.fz;releaseCount++;dirty=true})
    .onEngineTick(()=>{dirty=true})
    .onEngineStop(()=>{stopped=true;if(needsFit){needsFit=false;fit()}dirty=true;status()})
  graph.renderer().setPixelRatio(Math.min(devicePixelRatio,2))
  graph.controls().autoRotate=false
  graph.controls().enableDamping=true;graph.controls().dampingFactor=.12
  graph.controls().addEventListener('change',()=>{dirty=true})
  ortho=new THREE.OrthographicCamera(-500,500,500,-500,.1,100000)
  orthoControls=new OrbitControls(ortho,graph.renderer().domElement);orthoControls.enabled=false;orthoControls.enableDamping=true;orthoControls.dampingFactor=.12
  orthoControls.addEventListener('change',()=>{dirty=true})
  renderPass=graph.postProcessingComposer().passes.find(p=>p.camera)
  if(!renderPass)throw new Error('Renderer has no camera pass for projection comparison')
  const canvas=graph.renderer().domElement
  canvas.addEventListener('pointerdown',e=>{orthoPointerStart={x:e.clientX,y:e.clientY,button:e.button}})
  canvas.addEventListener('pointerup',e=>{
    if(!orthographic()||!orthoPointerStart||orthoPointerStart.button!==0||Math.hypot(e.clientX-orthoPointerStart.x,e.clientY-orthoPointerStart.y)>4)return
    const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.x)/r.width*2-1,1-(e.clientY-r.y)/r.height*2),ortho)
    const hit=ray.intersectObjects([...objects.values()],false)[0],id=hit&&[...objects].find(([,object])=>object===hit.object)?.[0]
    if(id)bridge.select(id);else bridge.clear()
  })
  graph.d3Force('charge').strength(n=>n.record?-260:-65)
  graph.d3Force('link').distance(e=>(e.kind==='contains'?45:115)*spacing)
  // Gentle native positioning forces bound disconnected records without boxes,
  // fake links or manually prescribed clusters.
  graph.d3Force('x',forceX(0).strength(.018))
  graph.d3Force('y',forceY(0).strength(.018))
  graph.d3Force('z',forceZ(0).strength(.018))
  // This is the library's native 3D simulation. No fCoSE or D3-2D drag overlay.
}
function status(){
  if(!active)return
  document.getElementById('status').textContent=`${nodes.length} 节点 · ${links.length} 连线${stopped?'':' · 布局中'}`
  document.getElementById('algorithm-note').textContent=error?`3D 不可用：${error}；可切回 2D。`:engine.value==='stress'?'Graphviz neato 三维 Stress：构建时预计算全局距离，固定坐标；不偷换力导向拖拽。':engine.value==='ngraph'?'ngraph 原生三维弹簧、排斥与阻尼；当前组件未提供该引擎的节点拖拽。':'D3 原生三维力导向；透视模式可拖节点。'
  document.getElementById('size-note').textContent='大小表示关联的不同记录数，包含语义候选，不代表重要程度；排除父子包含和重复证据。固定面积标尺：0–48 项，基础半径 2.5，48 项以上封顶约 21；Good/Bad 不分别归一化。'+(orthographic()?'正交投影不受远近影响。':'透视会影响屏幕大小，可切正交比较。')
  help.textContent='拖空白旋转 · 右键拖动平移 · 滚轮缩放 · 点击节点或标题读关联'+(!orthographic()&&engine.value==='d3'?' · 可拖节点牵引':' · 此模式不拖动节点')
  updateLegend()
  document.getElementById('reading-note').textContent=focus()?'选中关系在空间中高亮，A / B 对照右侧原文。':'同一图数据；优先标注主要记录，子内容可点击或在右侧阅读。'
  document.getElementById('overview').setAttribute('aria-pressed',String(!expanded));document.getElementById('expanded').setAttribute('aria-pressed',String(expanded))
}
function rebuild(reset=false){
  for(const n of nodes)positions.set(n.id,{x:n.x,y:n.y,z:n.z})
  if(reset)positions.clear()
  const scope=withReadingMembers(projectRecords(source,expanded),source,owner)
  nodes=scope.nodes.map((n,i)=>{
    const previous=positions.get(n.id),parent=positions.get(n.parentId)||positions.get(n.recordId)
    const theta=i*2.399963229728653,angle=Math.acos(1-2*(i+.5)/scope.nodes.length),r=parent?24:120
    return {...n,x:previous?.x??(parent?.x??0)+Math.cos(theta)*Math.sin(angle)*r,y:previous?.y??(parent?.y??0)+Math.cos(angle)*r,z:previous?.z??(parent?.z??0)+Math.sin(theta)*Math.sin(angle)*r}
  })
  if(engine.value==='stress')for(const n of nodes){const p=stress.scopes[expanded?'expanded':'overview'][n.id];if(!p)throw new Error('Stress snapshot does not match node IDs');Object.assign(n,{x:p.x*spacing,y:p.y*spacing,z:p.z*spacing,fx:p.x*spacing,fy:p.y*spacing,fz:p.z*spacing})}
  links=scope.edges.map(e=>({...e,source:e.from,target:e.to}))
  objects.clear();edgeObjects.clear();stopped=false;needsFit=true;dirty=true
  // graphData initializes and reheats the layout on the component's next update.
  // An immediate reheat starts ticks before that layout exists on first mount.
  graph.forceEngine(engine.value==='ngraph'?'ngraph':'d3').enableNodeDrag(engine.value==='d3'&&!orthographic())
    .warmupTicks(engine.value==='stress'?0:120).cooldownTicks(engine.value==='stress'?0:180)
    .ngraphPhysics({springLength:100*spacing,springCoefficient:.0008,gravity:-1.2,dragCoefficient:.02,timeStep:20})
    .graphData({nodes,links})
  // Fit warmup result immediately; final fit happens only on explicit mode/reset.
  fit();refresh();status()
}
function fit(onlySelection=false){
  if(!graph||!active)return
  if(orthographic()){
    const selected=onlySelection?nodes.filter(n=>state().visible.has(n.id)):nodes
    if(!selected.length)return
    const bounds=new THREE.Box3().setFromPoints(selected.map(n=>new THREE.Vector3(n.x,n.y,n.z))),center=bounds.getCenter(new THREE.Vector3()),r=Math.max(50,bounds.getSize(new THREE.Vector3()).length()/2+30),aspect=host.clientWidth/host.clientHeight
    const direction=ortho.position.clone().sub(orthoControls.target).normalize();if(!direction.lengthSq())direction.set(0,0,1)
    ortho.left=-r*Math.max(1,aspect);ortho.right=-ortho.left;ortho.top=r*Math.max(1,1/aspect);ortho.bottom=-ortho.top;ortho.zoom=1
    ortho.position.copy(center).addScaledVector(direction,r*4);orthoControls.target.copy(center);ortho.updateProjectionMatrix();orthoControls.update();dirty=true;return
  }
  graph.zoomToFit(350,45,onlySelection?n=>state().visible.has(n.id):undefined);dirty=true
}
function refresh(){
  if(!active||!graph)return
  for(const n of nodes){const o=objects.get(n.id);if(o){o.material.opacity=visible(n)&&matches(n)?1:.12;o.scale.setScalar(radius(n))}}
  for(const e of links){const o=edgeObjects.get(e.id);if(o){const on=selectedEdge(e);o.material.opacity=focus()?(on?1:.06):e.kind==='contains'?.48:.6;o.material.color.set(e.kind==='contains'?(on?'#61748b':'#8290a2'):(on?'#285ca6':'#6a87b6'));if(e.kind!=='contains'){o.scale.x=o.scale.z=on?2.2:1}}}
  dirty=true;status()
}
function drawLabels(){
  if(!graph||!nodes.length)return
  const camera=activeCamera(),width=host.clientWidth,height=host.clientHeight,s=state()
  const raw=source.edges.find(e=>e.id===s.selectedEvidence),endpoints=raw?(owner.get(raw.from)===s.selected?[raw.from,raw.to]:[raw.to,raw.from]):[]
  const projected=nodes.map(n=>{const p=point.set(n.x,n.y,n.z).project(camera);return {n,...screen(n),depth:p.z}})
    .filter(p=>p.depth>-1&&p.depth<1&&p.x>0&&p.y>0&&p.x<width&&p.y<height)
  const obstacles=projected.filter(p=>visible(p.n)).map(p=>({x:p.x-6,y:p.y-6,w:12,h:12}))
  const candidates=projected.filter(p=>visible(p.n)&&matches(p.n)&&(p.n.record||s.visible.has(p.n.id)&&s.selectedEvidence||s.query))
    .sort((a,b)=>Number(endpoints.includes(b.n.id))-Number(endpoints.includes(a.n.id))||Number(b.n.id===s.selected)-Number(a.n.id===s.selected)||Number(b.n.record)-Number(a.n.record)||a.depth-b.depth||a.n.id.localeCompare(b.n.id))
  const items=candidates.map(p=>{
    measure.font=p.n.record?'600 12px system-ui':'12px system-ui'
    const badge=endpoints.indexOf(p.n.id),text=(badge<0?'':badge===0?'A · ':'B · ')+p.n.label
    if(!textCache.has(text))textCache.set(text,wrapLabel(text,t=>measure.measureText(t).width,p.n.record?150:190,p.n.record?2:3))
    const lines=textCache.get(text);return {...p,id:p.n.id,lines,badge,w:Math.max(...lines.map(t=>measure.measureText(t).width))+10,h:lines.length*17+6,gap:11}
  })
  const placed=placeLabels(items,obstacles,width,height).placed
  labels=placed.map(p=>({id:p.id,...p.box}))
  const signature=JSON.stringify(placed.map(p=>[p.id,Math.round(p.box.x),Math.round(p.box.y),p.badge,p.lines]))
  if(signature===labelSignature)return
  labelSignature=signature;labelLayer.replaceChildren()
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';labelLayer.append(svg)
  for(const p of placed){
    const x=Math.max(p.box.x,Math.min(p.x,p.box.x+p.box.w)),y=Math.max(p.box.y,Math.min(p.y,p.box.y+p.box.h))
    if(Math.hypot(x-p.x,y-p.y)>17){const line=document.createElementNS(svg.namespaceURI,'line');for(const [key,value]of Object.entries({x1:p.x,y1:p.y,x2:x,y2:y,stroke:'#aab6c3','stroke-width':.7,'stroke-opacity':.65}))line.setAttribute(key,String(value));svg.append(line)}
    const el=document.createElement('button');el.type='button';el.className='spatial-label'+(p.n.record?' record':'')+(p.badge>=0?' endpoint':'');el.textContent=p.lines.join('\n');el.title=p.n.label+(p.n.record?` · 关联 ${reach.get(p.id)??0} 项设计（含语义候选）`:'');el.dataset.node=p.id;el.style.cssText=`box-sizing:border-box;left:${p.box.x}px;top:${p.box.y}px;width:${p.box.w+1}px;height:${p.box.h}px`;el.onclick=()=>bridge.select(p.id);labelLayer.append(el)
  }
}
function tick(){frame=0;if(!active||document.hidden)return;if(orthographic())orthoControls?.update();if(dirty){dirty=false;drawLabels()}frame=requestAnimationFrame(tick)}
function updateLegend(){
  const key=state().sizeMode;if(sizeLegend.dataset.mode===key)return;sizeLegend.dataset.mode=key;sizeLegend.replaceChildren()
  const caption=document.createElement('span');caption.textContent=key==='reach'?'关联范围（含候选）：':'统一大小：';sizeLegend.append(caption)
  for(const count of key==='reach'?[0,4,16,48]:[0]){const dot=document.createElement('span'),label=document.createElement('span');const diameter=2*nodeRadius({id:'legend',record:true},key,new Map([['legend',count]]));dot.style.cssText=`display:inline-block;width:${diameter}px;height:${diameter}px;border-radius:50%;background:#698ab0`;label.textContent=key==='reach'?`${count===48?'48+':count} 项`:'设计记录';sizeLegend.append(dot,label)}
}
function applyProjection(){
  if(!graph)return
  if(orthographic()){ortho.position.copy(graph.camera().position);ortho.quaternion.copy(graph.camera().quaternion);orthoControls.target.copy(graph.controls().target)}
  renderPass.camera=activeCamera();graph.enableNavigationControls(!orthographic()).enablePointerInteraction(!orthographic()).enableNodeDrag(!orthographic()&&engine.value==='d3');orthoControls.enabled=orthographic();fit();dirty=true;status()
}
function switchView(){
  active=view.value==='3d';window.graphSpatial.active=active
  stage.style.display=active?'block':'none';document.getElementById('algorithm').hidden=active;engine.hidden=!active;projection.hidden=!active;sizeLegend.style.display=active?'inline-flex':'none'
  for(const child of host.children)if(child!==stage)child.style.visibility=active?'hidden':''
  cancelAnimationFrame(frame);frame=0
  if(active){
    help.textContent='拖空白旋转 · 右键拖动平移 · 滚轮缩放 · 拖节点牵引 · 点击标题读关联'
    bridge.pause()
    try{init();graph.resumeAnimation();graph.width(host.clientWidth).height(host.clientHeight);if(!nodes.length){expanded=state().expanded;rebuild(true)}else refresh();dirty=true;tick()}catch(e){error=String(e);status();help.textContent='当前浏览器无法启动 WebGL 3D；请切回 2D。'+error}
  }else{graph?.pauseAnimation();help.textContent='2D：拖空白平移 · 滚轮缩放 · 拖节点调整；布局选择互不覆盖。';bridge.resume()}
}
view.onchange=switchView
engine.onchange=()=>{error='';rebuild(true);status()};projection.onchange=applyProjection
const observer=new ResizeObserver(()=>{if(graph&&active){graph.width(host.clientWidth).height(host.clientHeight);if(orthographic())fit();dirty=true}});observer.observe(host)
window.graphSpatial={active:false,refresh,fit,expand(value){if(expanded!==value){expanded=value;rebuild()}},reset:()=>rebuild(true),resizeNodes:refresh,space(value){spacing=value;if(engine.value!=='d3'){rebuild(true);return}graph.d3Force('link').distance(e=>(e.kind==='contains'?45:115)*spacing);stopped=false;graph.d3ReheatSimulation();status()},
  snapshot:()=>({active,engine:engine.value,projection:projection.value,expanded,stopped,error,dragCount,releaseCount,labels,sourceUnchanged:JSON.stringify(source)===original,nodes:nodes.map(n=>({id:n.id,record:n.record,label:n.label,reach:reach.get(n.id)??0,radius:radius(n),x:n.x,y:n.y,z:n.z,screen:screen(n)})),edges:links.map(e=>({id:e.id,from:e.from,to:e.to,kind:e.kind})),camera:graph?{position:activeCamera().position.toArray(),target:activeControls().target.toArray()}:null}),
}
document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(frame);frame=0;if(document.hidden)graph?.pauseAnimation();else if(active){graph?.resumeAnimation();dirty=true;tick()}})
window.addEventListener('pagehide',()=>{active=false;cancelAnimationFrame(frame);observer.disconnect();orthoControls?.dispose();graph?._destructor()},{once:true})
switchView()
