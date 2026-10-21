import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Background, BaseEdge, ConnectionMode, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, applyNodeChanges, getSmoothStepPath, useNodesInitialized, useReactFlow, useUpdateNodeInternals, useViewport, type EdgeProps, type Node, type NodeChange, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '../ported/ui/button.tsx'
import { ChevronLeft } from 'lucide-react'
import { IconButton } from '../ported/ui/icon-button.tsx'
import { DesignPanelHeader, DeleteButton } from '../ported/design/OfficialWebAppPanels/panelPrimitives.tsx'
import { BusinessRelationEditor } from './business-relation-editor.tsx'
import { businessEdgePorts, businessParentBranch, businessQuantityShort, businessRelationSentence, reconcileBusinessNodes, type BusinessRelation } from './business-relations.ts'

interface CanvasObject {id: string; name: string; description: string}
interface Props {
  open: boolean
  objects: readonly CanvasObject[]
  relations: readonly BusinessRelation[]
  selectedId: string | null
  disabled: boolean
  error?: string
  draft: BusinessRelation | null
  onClose: () => void
  onDetail: (id: string) => void
  onAdd: (source?: string, target?: string) => void
  onChange: (relation: BusinessRelation) => void
  onRemove: (id: string) => void
  onDraftChange: (relation: BusinessRelation) => void
  onDraftSave: () => void
  onDraftCancel: () => void
}
type ObjectNode = Node<{object: CanvasObject; disabled: boolean; onDetail: (id: string) => void}, 'businessObject'>
function BusinessObjectNode({data, selected}: NodeProps<ObjectNode>): ReactElement {
  const [hovered,setHovered] = useState(false), leaveTimer = useRef<ReturnType<typeof setTimeout>>()
  const enter = () => {clearTimeout(leaveTimer.current);setHovered(true)}
  const leave = () => {clearTimeout(leaveTimer.current);leaveTimer.current=setTimeout(() => setHovered(false),220)}
  useEffect(() => () => clearTimeout(leaveTimer.current), [])
  const handleStyle = {width:9, height:9, background:'#ab8eca', border:'2px solid white'} as const
  return <div onMouseEnter={enter} onMouseLeave={leave} className={`group relative w-[210px] rounded-[10px] border bg-white px-4 py-[13px] [box-shadow:0_3px_10px_#32204008] ${selected ? 'border-[#9670c9] [box-shadow:0_0_0_2px_#e9dcfb]' : 'border-[#ded5e9]'}`}>
    <span className='block text-[10px] leading-none text-[#a090af]'>对象类型</span>
    <strong className='mt-[3px] block text-[16px] leading-snug text-[#483254]'>{data.object.name || '未命名对象'}</strong>
    {data.object.description && <p className='business-object-node-summary mt-1.5 text-xs leading-[1.6] text-[#85778e]'>{data.object.description}</p>}
    <Button type='button' size='sm' className={`nodrag nopan absolute -bottom-2 -right-2 z-10 !h-auto !rounded-[6px] !border-0 !bg-[#663AE8] !px-[9px] !py-[5px] !text-xs !text-white shadow-[0_1px_4px_rgba(0,0,0,.18)] hover:!bg-[#5730d6] group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${hovered ? 'opacity-100' : 'pointer-events-none opacity-0'}`} aria-label={`查看${data.object.name}详情`}
      onMouseEnter={enter} onMouseLeave={leave} onMouseDown={event => event.stopPropagation()} onClick={event => {event.stopPropagation();data.onDetail(data.object.id)}}>查看详情</Button>
    {([['left',Position.Left],['right',Position.Right],['top',Position.Top],['bottom',Position.Bottom]] as const).map(([side,position]) =>
      <Handle key={side} id={`source-${side}`} type='source' position={position} style={handleStyle} isConnectable={!data.disabled}/>
    )}
  </div>
}
const nodeTypes = {businessObject:BusinessObjectNode}

function BusinessRelationEdge(props: EdgeProps): ReactElement {
  const [path,labelX,labelY] = getSmoothStepPath(props)
  const {zoom} = useViewport()
  const motionPath = useRef<SVGPathElement>(null)
  const [length, setLength] = useState(0)
  useEffect(() => {
    if (props.selected && motionPath.current) setLength(motionPath.current.getTotalLength())
  }, [path, props.selected])
  const screenLength = length * zoom
  const count = Math.max(2, Math.round(screenLength / 170))
  const duration = Math.max(3, screenLength / 24)
  return <>
    <BaseEdge id={props.id} path={path} labelX={labelX} labelY={labelY} label={props.label}
      labelStyle={props.labelStyle} labelBgStyle={props.labelBgStyle} labelBgPadding={props.labelBgPadding}
      markerEnd={props.markerEnd} style={props.style}/>
    {props.selected && <g className='business-relation-direction-pulse' fill={props.style?.stroke ?? '#9884b7'} pointerEvents='none' aria-hidden='true'>
      <path ref={motionPath} d={path} fill='none' stroke='none'/>
      {/* Equally phased, line-colored dots, about 170 screen pixels apart at 24 px/s. */}
      {length > 0 && Array.from({length:count}, (_,index) =>
        <circle key={`${count}-${duration}-${index}`} r={8 / zoom} stroke='white' strokeWidth={2 / zoom}>
          <animateMotion dur={`${duration}s`} begin={`${-index * duration / count}s`} repeatCount='indefinite' calcMode='paced' path={path}/>
        </circle>
      )}
    </g>}
  </>
}
const edgeTypes = {businessRelation:BusinessRelationEdge}

/** Modeling-boundary note carried over from the co-confirmed canvas baseline. */
function StandardsNote(): ReactElement {
  return <details className='mt-[22px] border-t border-[#eae4f0] pt-3 text-[11px] leading-[1.7] text-[#998aa4]'>
    <summary className='cursor-pointer text-xs text-[#756180]'>建模依据与边界</summary>
    <p className='mt-2'>对象类型、属性、关系与子类型参考 OWL / RDFS 的基本区分；画布只是一种编辑表示，不宣称实现 OWL 推理。</p>
    <p className='mt-2'>“由……派生”属于来源语义（PROV），不同于类型继承；面板不建实例来源图，也不将生成关系伪装成继承。</p>
    <p className='mt-2'><a className='text-[#8b70a7] underline' href='https://www.w3.org/TR/owl-primer/' target='_blank' rel='noreferrer'>OWL 2 Primer ↗</a> · <a className='text-[#8b70a7] underline' href='https://www.w3.org/TR/prov-o/' target='_blank' rel='noreferrer'>PROV-O ↗</a></p>
  </details>
}

/** Whole-model view; node positions and selection remain local presentation state. */
function CanvasWorkspace(props: Props): ReactElement {
  const {open, objects, relations, disabled} = props
  const [nodes,setNodes] = useState<ObjectNode[]>([])
  const [selected,setSelected] = useState<{kind:'object'|'relation'; id:string} | null>(null)
  const priorOpen = useRef(false)
  const {fitView} = useReactFlow<ObjectNode>()
  const updateNodeInternals = useUpdateNodeInternals()
  const nodesInitialized = useNodesInitialized()
  useEffect(() => {
    if (open && !priorOpen.current && props.selectedId) setSelected({kind:'object',id:props.selectedId})
    priorOpen.current = open
  }, [open, props.selectedId])
  const onDetail = useRef(props.onDetail)
  useEffect(() => {onDetail.current = props.onDetail}, [props.onDetail])
  const detail = useCallback((id: string) => onDetail.current(id), [])
  const desired = useMemo<ObjectNode[]>(() => objects.map(object => ({
    id:object.id,type:'businessObject',position:{x:0,y:0},
    data:{object,disabled,onDetail:detail},selected:selected?.kind==='object' && selected.id===object.id,
  })),[objects,disabled,detail,selected])
  // Position and measurement belong to the canvas; a host re-render must never rebuild a node object.
  useEffect(() => {setNodes(previous => reconcileBusinessNodes(previous, desired, relations))}, [desired, relations])
  const onNodesChange = useCallback((changes: NodeChange<ObjectNode>[]) => setNodes(previous => applyNodeChanges(changes, previous)), [])
  // Fit only once, on the first open after measurement has landed: fitting an
  // unmeasured or zero-sized canvas leaves the view stuck. The flow stays mounted
  // across open/close, so the visitor's viewport survives the toggle.
  const didFit = useRef(false)
  useEffect(() => {
    if (didFit.current || !open || !nodesInitialized) return
    didFit.current = true
    fitView({padding:.18})
  }, [open, nodesInitialized, fitView])
  // A host remount can strand nodes without measurements; recover instead of staying blank.
  // Keyed on the id set, not node identity: drag and render churn must not reset the deadline.
  const nodeKey = useMemo(() => nodes.map(node => node.id).join('|'), [nodes])
  const healed = useRef(false)
  useEffect(() => {
    if (!open || healed.current || nodesInitialized || nodeKey === '') return
    const ids = nodeKey.split('|')
    const timer = setTimeout(() => {healed.current = true; updateNodeInternals(ids)}, 1200)
    return () => clearTimeout(timer)
  }, [open, nodesInitialized, nodeKey, updateNodeInternals])
  const nodePositions = useMemo(() => new Map(nodes.map(node => [node.id, node.position])), [nodes])
  const edges = useMemo(() => relations.filter(r => nodePositions.has(r.source) && nodePositions.has(r.target)).map(r => ({
    id:r.id,source:r.source,target:r.target,type:'businessRelation',
    ...businessEdgePorts(nodePositions.get(r.source)!, nodePositions.get(r.target)!),
    label:r.kind==='generalization' ? r.name : `${r.name} · ${businessQuantityShort(r.target_count)}`,
    selected:selected?.kind==='relation' && selected.id===r.id,
    markerEnd:{type:MarkerType.ArrowClosed,color:r.kind==='generalization'?'#60889e':'#9884b7'},
    style:{stroke:r.kind==='generalization'?'#60889e':'#9884b7',strokeWidth:selected?.id===r.id?3:1.6,strokeDasharray:r.kind==='generalization'?'6 4':undefined},
    labelStyle:{fontSize:12,fill:'#594b69'},labelBgPadding:[7,5] as [number,number],labelBgStyle:{fill:'#fff'},
  })),[relations,nodePositions,selected])
  const object = selected?.kind==='object' ? objects.find(o => o.id===selected.id) : undefined
  const relation = selected?.kind==='relation' ? relations.find(r => r.id===selected.id) : undefined
  const draft = props.draft
  const branch = object ? businessParentBranch(object.id, relations, objects.map(o => o.id)) : {parents:[],higher:[]}
  const nameOf = (id: string) => objects.find(o => o.id===id)?.name ?? '对象已不存在'
  return <div aria-hidden={!open} {...(!open ? {inert:''} : {})} className='absolute inset-0 z-20 flex min-h-0 flex-col overflow-hidden bg-white transition-[clip-path] duration-300 ease-out'
    style={{clipPath:open?'inset(0 0 0 0)':'inset(0 100% 0 0)',pointerEvents:open?'auto':'none'}}>
    <DesignPanelHeader variant='workspace'>
      <div className='flex flex-wrap items-center gap-3'><strong className='text-sm'>业务对象关系</strong><span className='text-xs text-[var(--ds-text-secondary)]'>{objects.length} 个对象 · {relations.length} 条关系</span></div>
      <div className='flex gap-2'><Button type='button' size='sm' variant='outline' disabled={disabled || objects.length===0} onClick={() => props.onAdd()}>添加关系</Button><Button type='button' size='sm' variant='outline' disabled={!nodesInitialized} onClick={() => fitView({padding:.18,duration:250})}>适应画布</Button></div>
    </DesignPanelHeader>
    <div className='business-object-canvas-layout flex min-h-0 flex-1 flex-col md:flex-row'>
      <main className='flex min-h-[280px] min-w-0 flex-1 flex-col bg-[#fcfbfe]'>
        <p className='px-[18px] pt-[15px] text-xs text-[#94869f]'>业务概念层：类型与关系，不是具体项目实例。拖动位置不改变业务含义。</p>
        <div className='relative min-h-0 flex-1'>
          <ReactFlow<ObjectNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} minZoom={.25} maxZoom={1.6} connectionMode={ConnectionMode.Loose}
            nodesDraggable={!disabled} nodesConnectable={!disabled} deleteKeyCode={null}
            onNodeClick={(_,node) => setSelected({kind:'object',id:node.id})} onEdgeClick={(_,edge) => setSelected({kind:'relation',id:edge.id})}
            onNodesChange={onNodesChange}
            onConnect={connection => {if(!disabled && connection.source && connection.target)props.onAdd(connection.source,connection.target)}}>
            <Background color='#e4dfeb' gap={22}/><Controls showInteractive={false}/>
          </ReactFlow>
        </div>
        <div className='flex flex-wrap justify-center gap-[18px] px-3 pb-[14px] pt-1 text-[11px] text-[#9786a5]'>
          <span>— 业务关联</span><span className='text-[#60889e]'>┄ 类型继承（子类型 → 父类型）</span><span>点击连线，查看双方的数量约定</span>
        </div>
      </main>
      <aside className='max-h-[40%] overflow-y-auto border-t border-[#e8e1ef] px-5 py-[18px] md:max-h-none md:w-[330px] md:shrink-0 md:border-l md:border-t-0'>
        {props.error && <p role='alert' className='mb-3 text-sm text-destructive'>{props.error}</p>}
        <div className='flex items-start justify-between gap-3 text-sm font-semibold text-[#38313f]'>
          <h3 className='min-w-0 break-words'>{draft ? '新建关系' : relation ? relation.name || '未命名关系' : object ? object.name || '未命名对象' : '关系详情'}</h3>
          {draft && <small className='shrink-0 text-[11px] font-normal text-[#a196ad]'>保存后生效</small>}
        </div>
        {draft ? <>
          <p className='mt-[18px] text-xs leading-[1.7] text-[#85778e]'>定义两个对象类型之间的关系。数量不确定时可以保留“尚未确定”。</p>
          <div className='mt-3'><BusinessRelationEditor relation={draft} objects={objects} disabled={disabled} onChange={props.onDraftChange}/></div>
          <div className='mt-4 flex gap-2'>
            <Button type='button' size='sm' disabled={disabled} onClick={props.onDraftSave}>添加关系</Button>
            <Button type='button' size='sm' variant='outline' onClick={props.onDraftCancel}>取消</Button>
          </div>
        </> : relation ? <><div className='mt-[18px] flex items-center gap-[7px]'>
            <Button type='button' variant='outline' size='sm' className='h-auto max-w-[45%] truncate whitespace-normal text-xs' onClick={() => setSelected({kind:'object',id:relation.source})}>{nameOf(relation.source)}</Button>
            <span className='text-xs text-[#a196ad]'>→</span>
            <Button type='button' variant='outline' size='sm' className='h-auto max-w-[45%] truncate whitespace-normal text-xs' onClick={() => setSelected({kind:'object',id:relation.target})}>{nameOf(relation.target)}</Button>
          </div>
          <div className='mt-[18px]'><BusinessRelationEditor relation={relation} objects={objects} disabled={disabled} onChange={props.onChange}/></div>
          <div className='mt-3'><DeleteButton label='移除这条关系' disabled={disabled} onClick={() => {props.onRemove(relation.id);setSelected(null)}}/></div>
          <StandardsNote/>
        </> : object ? <>
          <p className='mt-3 text-[13px] leading-[1.6] text-[#38313f]'>{object.description}</p>
          <div className='mt-[14px]'><Button type='button' variant='outline' size='sm' onClick={() => props.onDetail(object.id)}>查看对象详情</Button></div>
          {(branch.parents.length > 0 || branch.higher.length > 0) && <>
            <h3 className='mb-2 mt-[22px] text-xs text-[#82738e]'>父类型分支</h3>
            {branch.parents.length > 0 && <><p className='text-xs text-[#85778e]'>直接父类型</p>
              <div className='mt-1 flex flex-wrap gap-1'>
                {branch.parents.map(parentId => <Button key={parentId} type='button' variant='secondary' size='sm' className='h-auto max-w-full whitespace-normal px-2 py-1 text-xs' onClick={() => setSelected({kind:'object',id:parentId})}>{nameOf(parentId)}</Button>)}
              </div></>}
            {branch.higher.length > 0 && <><p className='mt-3 text-xs text-[#85778e]'>更上层祖先</p>
              <div className='mt-1 flex flex-wrap gap-1'>
                {branch.higher.map(ancestorId => <Button key={ancestorId} type='button' variant='outline' size='sm' className='h-auto max-w-full whitespace-normal px-2 py-1 text-xs' onClick={() => setSelected({kind:'object',id:ancestorId})}>{nameOf(ancestorId)}</Button>)}
              </div></>}
            <p className='mt-2 text-xs text-[#85778e]'>多个父类型并列存在，不构成先后顺序；共享信息在各父类型原处维护。</p></>}
          <h3 className='mb-2 mt-[22px] text-xs text-[#82738e]'>关联关系</h3>
          <div className='flex flex-col gap-[7px]'>
            {relations.filter(r => r.source===object.id || r.target===object.id).map(r => <Button key={r.id} type='button' variant='outline' size='sm' className='flex h-auto w-full flex-col items-start gap-0.5 whitespace-normal px-[11px] py-[6px] text-left text-xs' onClick={() => setSelected({kind:'relation',id:r.id})}>
              <span className='block min-w-0 w-full break-words text-[#5c5268]'>{nameOf(r.source)} <b className='px-[3px] font-normal text-[#9775b4]'>{r.name}</b> {nameOf(r.target)}<span className='float-right text-[#a196ad]'>›</span></span>
              <span className='block min-w-0 w-full break-words text-[11px] font-normal leading-[1.6] text-[#85778e]'>{businessRelationSentence(r, nameOf)}</span>
            </Button>)}
            {!relations.some(r => r.source===object.id || r.target===object.id) && <p className='text-xs text-[#85778e]'>暂未建立关系。</p>}
          </div>
          <StandardsNote/>
        </> : <p className='mt-[18px] text-[13px] text-[#85778e]'>选择对象查看关联，或选择连线编辑关系。</p>}
      </aside>
    </div>
    <IconButton type='button' size='lg' variant='transparent' shape='square' aria-label='收起业务对象关系画布' className='absolute right-0 top-[36vh] z-10 h-[48px] w-[24px] -translate-y-1/2 rounded-l-[8px] rounded-r-[0px] bg-white [box-shadow:-1px_1px_4px_0px_rgba(0,0,0,0.1)] text-[var(--ds-text-tertiary)] hover:!bg-[#f6f6f6] hover:text-[var(--ds-brand-text-primary)]' onClick={props.onClose}><ChevronLeft className='size-4'/></IconButton>
  </div>
}

/** Flow state lives in a provider that outlives open/close, so measurement is never thrown away. */
export function BusinessObjectCanvas(props: Props): ReactElement {
  return <ReactFlowProvider><CanvasWorkspace {...props}/></ReactFlowProvider>
}
