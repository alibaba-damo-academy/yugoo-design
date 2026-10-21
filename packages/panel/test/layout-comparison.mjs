import {select} from 'd3-selection'
import {zoom,zoomIdentity} from 'd3-zoom'
import {drag} from 'd3-drag'
import {projectRecords} from '../src/client/graph-model.ts'
import {engines,initialPositions,calculate,fitted,metrics} from './layout-comparison-engines.mjs'

const source=JSON.parse(document.getElementById('graph-data').textContent)
let engine=engines[0],expanded=false,positions=new Map(),scope,selected='',fixed=new Set()
const colors=['#8b75cc','#539fa5','#cf9360','#7893ce','#bd7c9e','#83a06c']
const owners=[...new Set(source.nodes.map(n=>n.owner))].sort()
document.getElementById('engine').innerHTML=engines.map(e=>'<option>'+e+'</option>').join('')
document.getElementById('engine').onchange=e=>{engine=e.target.value;positions=new Map();fixed.clear();run()}
document.getElementById('overview').onclick=()=>{expanded=false;run(true)}
document.getElementById('expanded').onclick=()=>{expanded=true;run(true)}
document.getElementById('reset').onclick=()=>{positions=new Map();fixed.clear();run()}
const svg=select('svg'),root=svg.append('g')
const camera=zoom().scaleExtent([.2,6]).on('zoom',e=>root.attr('transform',e.transform))
svg.call(camera).on('dblclick.zoom',null)
document.getElementById('fit').onclick=()=>svg.call(camera.transform,zoomIdentity)
function run(incremental=false){
  selected=''
  scope=projectRecords(source,expanded)
  fixed=new Set([...fixed].filter(id=>scope.nodes.some(n=>n.id===id)))
  const initial=initialPositions(scope,42,incremental?positions:new Map())
  const result=calculate(engine,scope,initial,fixed,{incremental})
  positions=result.positions
  render()
  window.comparison={engine,expanded,milliseconds:result.milliseconds,metrics:metrics(scope,positions),positions:Object.fromEntries(positions),nodes:scope.nodes.length,edges:scope.edges.length}
  document.getElementById('status').textContent=`${scope.nodes.length} 个节点 · ${scope.edges.length} 条原始/聚合边 · 布局 ${result.milliseconds.toFixed(1)} ms`
  document.getElementById('overview').setAttribute('aria-pressed',String(!expanded));document.getElementById('expanded').setAttribute('aria-pressed',String(expanded))
  document.getElementById('detail').textContent='点击查看完整内容；拖动节点后松开，固定该节点并重新计算。此实验不是连续动画性能测试。'
}
function render(){
  root.selectAll('*').remove();svg.call(camera.transform,zoomIdentity)
  const screen=fitted(positions),adjacency=new Map(scope.nodes.map(n=>[n.id,new Set()]))
  for(const e of scope.edges){adjacency.get(e.from).add(e.to);adjacency.get(e.to).add(e.from)}
  const lines=root.append('g').selectAll('line').data(scope.edges).join('line')
    .attr('x1',e=>screen.get(e.from).x).attr('y1',e=>screen.get(e.from).y).attr('x2',e=>screen.get(e.to).x).attr('y2',e=>screen.get(e.to).y)
    .attr('stroke',e=>e.kind==='contains'?'#aeb5bf':'#768caf').attr('stroke-width',e=>e.kind==='contains'?.8:1.6)
    .attr('stroke-dasharray',e=>e.kind==='contains'?'3 4':null).attr('opacity',e=>e.kind==='contains'?.55:.8)
    .attr('data-kind',e=>e.kind)
  const groups=root.append('g').selectAll('g').data(scope.nodes).join('g').attr('data-node',n=>n.id)
    .attr('transform',n=>`translate(${screen.get(n.id).x},${screen.get(n.id).y})`).style('cursor','grab')
  groups.append('circle').attr('r',n=>n.record?6:3.5).attr('fill',n=>colors[owners.indexOf(n.owner)%colors.length])
  groups.append('circle').attr('r',12).attr('fill','transparent')
  groups.append('text').attr('text-anchor','middle').attr('y',17).attr('font-size',11).attr('fill','#3e4654')
    .text(n=>n.label.length>16?n.label.slice(0,16)+'…':n.label)
  groups.append('title').text(n=>n.label+'\n'+n.file+'#'+n.pointer)
  // Identical label policy for every candidate, not algorithm-specific tuning.
  const occupied=[],shown=new Set()
  for(const n of [...scope.nodes].sort((a,b)=>Number(b.record)-Number(a.record)||adjacency.get(b.id).size-adjacency.get(a.id).size)){
    const p=screen.get(n.id),w=Math.min(17,n.label.length)*11
    if(!occupied.some(b=>Math.abs(b.y-p.y)<16&&Math.abs(b.x-p.x)<(b.w+w)/2+4)){occupied.push({...p,w});shown.add(n.id)}
  }
  groups.select('text').attr('opacity',n=>shown.has(n.id)?1:0)
  function highlight(id){
    groups.attr('opacity',n=>id&&n.id!==id&&!adjacency.get(id).has(n.id)?.15:1)
    groups.select('text').attr('opacity',n=>id?(n.id===id||adjacency.get(id).has(n.id)?1:0):(shown.has(n.id)?1:0))
    lines.attr('opacity',e=>id?(e.from===id||e.to===id?1:.06):(e.kind==='contains'?.55:.8))
  }
  groups.on('mouseenter',(_,n)=>highlight(n.id)).on('mouseleave',()=>highlight(selected))
    .on('click',(_,n)=>{selected=n.id;highlight(selected);document.getElementById('detail').textContent=n.label+' — '+n.file+'#'+n.pointer+'\n'+n.context})
    .call(drag().container(()=>root.node()).clickDistance(5)
      .on('drag',(event,n)=>{
        screen.set(n.id,{x:event.x,y:event.y});select(event.sourceEvent.target.closest('[data-node]')).attr('transform',`translate(${event.x},${event.y})`)
        lines.attr('x1',e=>screen.get(e.from).x).attr('y1',e=>screen.get(e.from).y).attr('x2',e=>screen.get(e.to).x).attr('y2',e=>screen.get(e.to).y)
      }).on('end',(_,n)=>{
        // Convert drag delta from fitted display coordinates into layout coordinates.
        const before=fitted(positions),ids=[...positions.keys()],pair=ids.find(id=>id!==n.id&&Math.hypot(positions.get(id).x-positions.get(n.id).x,positions.get(id).y-positions.get(n.id).y)>1)
        const ratio=pair?Math.hypot(before.get(pair).x-before.get(n.id).x,before.get(pair).y-before.get(n.id).y)/Math.hypot(positions.get(pair).x-positions.get(n.id).x,positions.get(pair).y-positions.get(n.id).y):1
        const old=positions.get(n.id),end=screen.get(n.id),start=before.get(n.id)
        positions.set(n.id,{x:old.x+(end.x-start.x)/ratio,y:old.y+(end.y-start.y)/ratio});fixed.add(n.id);run(true)
      }))
}
window.chooseComparison=(name,all)=>{engine=name;expanded=all;positions=new Map();fixed.clear();document.getElementById('engine').value=engine;run()}
run()
