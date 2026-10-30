import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom'
import { Button } from './ported/ui/button.js'
import { PanelSelect } from '../panel-select.js'
import { edgeReading, relationMeaningLabel, type GraphEdge, type GraphScope } from './graph-model.js'
import { bundleCoordinates, bundleDisplay, edgeMembers, graphColor } from './graph-bundle-model.js'
import { stressPositions } from './graph-stress.mjs'
import { placeLabels } from './graph-labels.js'
import { explorationStyles } from './graph-exploration-styles.js'

type Point = { x: number; y: number; angle?: number }
export function GraphExploration({ graph, selected, relation, onNode, onEdge, onClear }: {
  graph: GraphScope; selected: string; relation?: GraphEdge; onNode(id: string): void; onEdge(edge: GraphEdge): void; onClear(): void
}) {
  const [view, setView] = useState<'free' | 'bundle'>('bundle'), [style, setStyle] = useState('glow')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(graph.nodes.map(node => node.owner))), [hovered, setHovered] = useState('')
  const [motion, setMotion] = useState(true), [camera, setCamera] = useState(zoomIdentity)
  const [size, setSize] = useState({ width: 1100, height: 720 })
  const stage = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null)
  const cameras = useRef<Record<string, ZoomTransform>>({}), actions = useRef({ fit: () => {}, scale: (_value: number) => {} })
  const id = useId().replace(/:/g, '')
  const display = useMemo(() => bundleDisplay(graph, view === 'bundle' ? collapsed : new Set()), [graph, view, collapsed])
  const radial = useMemo(() => bundleCoordinates(display), [display])
  const free = useMemo(() => {
    const result = new Map<string, Point>(stressPositions(graph, 'stress2-original'))
    const values = [...result.values()]
    const x0 = Math.min(0, ...values.map(p => p.x)), x1 = Math.max(1, ...values.map(p => p.x))
    const y0 = Math.min(0, ...values.map(p => p.y)), y1 = Math.max(1, ...values.map(p => p.y))
    const scale = Math.max(x1 - x0, y1 - y0) / 1.75
    return new Map([...result].map(([key, p]) => [key, { x: (p.x - (x0 + x1) / 2) / scale, y: (p.y - (y0 + y1) / 2) / scale }]))
  }, [graph])
  const radius = Math.max(100, Math.min(size.width / 2 - 105, size.height / 2 - 84))
  const coordinates = view === 'bundle' ? radial : free
  const point = (nodeId: string): Point => { const p = coordinates.get(nodeId) ?? { x: 0, y: 0 }; return { x: p.x * radius, y: p.y * radius } }
  const sourceIds = new Set(relation ? edgeMembers(relation).map(member => member.id) : [])
  const internalEdges = display.edges.filter(edge => edge.from === edge.to)
  const internalCount = internalEdges.reduce((count, edge) => count + edgeMembers(edge).length, 0)
  const focused = display.nodes.find(node => node.id === hovered || node.sources.includes(selected))
  const focusedId = hovered || focused?.id
  const active = (edge: GraphEdge) => edgeMembers(edge).some(member => sourceIds.has(member.id))
  const selectedEndpoints = new Set(display.edges.filter(active).flatMap(edge => [edge.from, edge.to]))
  const incident = (edge: GraphEdge) => edge.from === focusedId || edge.to === focusedId
  const own = new Map(display.nodes.map(node => [node.id, node.owner]))
  const sectors = new Map(display.sectors.map(sector => [sector.owner, sector]))
  const visibleEdges = display.edges.filter(edge => edge.from !== edge.to)
  const screenPoint = (nodeId: string) => { const p = point(nodeId); return { x: size.width / 2 + camera.x + p.x * camera.k, y: size.height / 2 + camera.y + p.y * camera.k } }
  const labelCandidates = display.nodes.filter(node => node.node && (node.node.record || node.sources.includes(selected) || node.id === hovered || selectedEndpoints.has(node.id)))
    .sort((a, b) => Number(b.sources.includes(selected) || b.id === hovered) - Number(a.sources.includes(selected) || a.id === hovered) || a.id.localeCompare(b.id))
    .map(node => { const hot = node.sources.includes(selected) || node.id === hovered; const text = !hot && node.label.length > 15 ? node.label.slice(0, 14) + '…' : node.label; const fontSize = hot ? 14 : 12; return { id: node.id, ...screenPoint(node.id), text, fontSize, w: [...text].reduce((width, char) => width + (/[^\x00-\x7f]/.test(char) ? fontSize : fontSize * .58), 8), h: 20 } })
  const obstacles = display.nodes.map(node => ({ ...screenPoint(node.id), w: 14, h: 14 })).map(p => ({ ...p, x: p.x - 7, y: p.y - 7 }))
  if (view === 'bundle') for (const sector of display.sectors) { const w = sector.label.length * 7.2 + 40; obstacles.push({ x: size.width / 2 + camera.x + Math.sin(sector.angle) * (radius + 46) * camera.k - w / 2, y: size.height / 2 + camera.y - Math.cos(sector.angle) * (radius + 46) * camera.k - 10, w, h: 22 }) }
  const labels = placeLabels(labelCandidates, obstacles, size.width, size.height)
  function path(edge: GraphEdge) {
    const a = point(edge.from), b = point(edge.to)
    if (view === 'bundle') {
      const u = sectors.get(own.get(edge.from)!)!, v = sectors.get(own.get(edge.to)!)!
      const start = display.nodes.find(node => node.id === edge.from)?.node
      const end = display.nodes.find(node => node.id === edge.to)?.node
      const recordA = start?.recordId && coordinates.has(start.recordId) ? point(start.recordId) : a
      const recordB = end?.recordId && coordinates.has(end.recordId) ? point(end.recordId) : b
      const points = [a, { x: recordA.x * .82, y: recordA.y * .82 },
        { x: Math.sin(u.angle) * radius * .32, y: -Math.cos(u.angle) * radius * .32 },
        { x: Math.sin(v.angle) * radius * .32, y: -Math.cos(v.angle) * radius * .32 },
        { x: recordB.x * .82, y: recordB.y * .82 }, b]
      let curve = 'M' + a.x + ',' + a.y
      for (let index = 1; index < points.length - 1; index++) {
        const p = points[index]!, next = points[index + 1]!
        curve += ' Q' + p.x + ',' + p.y + ' ' + (index === points.length - 2 ? next.x : (p.x + next.x) / 2) + ',' + (index === points.length - 2 ? next.y : (p.y + next.y) / 2)
      }
      return curve
    }
    const dx = b.x - a.x, dy = b.y - a.y
    return 'M' + a.x + ',' + a.y + ' Q' + ((a.x + b.x) / 2 - dy * .08) + ',' + ((a.y + b.y) / 2 + dx * .08) + ' ' + b.x + ',' + b.y
  }
  useEffect(() => {
    const el = stage.current!
    const resize = new ResizeObserver(() => { const box = el.getBoundingClientRect(); setSize({ width: box.width, height: box.height }) })
    resize.observe(el); return () => resize.disconnect()
  }, [])
  useEffect(() => {
    const element = select(svg.current!)
    const behavior = zoom<SVGSVGElement, unknown>().scaleExtent([.35, 5]).filter(event => !event.target.closest('[data-graph-node], [data-bundle-sector]') && (!event.ctrlKey || event.type === 'wheel') && !event.button)
      .on('zoom', event => { cameras.current[view] = event.transform; setCamera(event.transform) })
    element.call(behavior).on('dblclick.zoom', null)
    element.call(behavior.transform, cameras.current[view] ?? zoomIdentity)
    actions.current = { fit: () => element.call(behavior.transform, zoomIdentity), scale: factor => element.call(behavior.scaleBy, factor) }
    return () => { element.on('.zoom', null); actions.current = { fit: () => {}, scale: () => {} } }
  }, [view, size.width, size.height])
  const toggle = (owner: string) => setCollapsed(previous => { const next = new Set(previous); if (next.has(owner)) next.delete(owner); else next.add(owner); return next })
  const keyboard = (event: React.KeyboardEvent, action: () => void) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action() } }
  return <div className='graph-exploration' data-testid='graph-exploration'>
    <style>{explorationStyles}</style>
    <div className='graph-exploration-toolbar'>
      <div role='group' aria-label='图谱视图'>
        <Button variant='outline' size='sm' aria-pressed={view === 'free'} onClick={() => setView('free')}>自由关系</Button>
        <Button variant='outline' size='sm' aria-pressed={view === 'bundle'} onClick={() => setView('bundle')}>Bundle 圆形总览</Button>
      </div>
      <PanelSelect aria-label='视觉方向' value={style} onValueChange={setStyle} options={[{ value: 'glow', label: '光环与束线' }, { value: 'depth', label: '空间层叠 · 2D' }]} />
      {view === 'bundle' && <Button variant='outline' size='sm' onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(display.sectors.map(s => s.owner)))}>{collapsed.size ? '展开所有 Bundle' : '聚合到 Bundle'}</Button>}
      {internalCount > 0 && <PanelSelect aria-label='折叠内部关系' value='' onValueChange={value => { const edge = internalEdges.find(edge => edge.id === value); if (edge) onEdge(edge) }} options={[{ value: '', label: '内部关系 · ' + internalCount }, ...internalEdges.map(edge => ({ value: edge.id, label: (display.nodes.find(node => node.id === edge.from)?.label ?? '') + ' · ' + relationMeaningLabel(edgeReading(edge).meaning) + ' · ' + edgeMembers(edge).length }))]} />}
      <Button variant='outline' size='sm' onClick={() => actions.current.fit()}>适应画布</Button>
      <Button variant='outline' size='sm' aria-label='放大探索图' onClick={() => actions.current.scale(1.25)}>＋</Button>
      <Button variant='outline' size='sm' aria-label='缩小探索图' onClick={() => actions.current.scale(.8)}>－</Button>
      <Button variant='outline' size='sm' aria-pressed={!motion} onClick={() => setMotion(!motion)}>{motion ? '暂停光效' : '继续光效'}</Button>
    </div>
    <div className='graph-exploration-stage' ref={stage} data-style={style} data-view={view} data-motion={motion ? 'on' : 'off'}>
      <svg ref={svg} aria-label={view === 'bundle' ? 'Bundle 圆形关系图' : '自由关系探索图'} tabIndex={0} onClick={event => { if (event.target === svg.current) onClear() }} onKeyDown={event => { if (event.key === 'Escape') onClear() }}>
        <defs>
          <radialGradient id={id + '-back'}><stop stopColor={style === 'depth' ? '#303164' : '#102e52'} stopOpacity='.65' /><stop offset='1' stopColor='#050c1c' stopOpacity='0' /></radialGradient>
          <filter id={id + '-glow'} x='-100%' y='-100%' width='300%' height='300%'><feGaussianBlur stdDeviation={style === 'depth' ? 4 : 3} /><feMerge><feMergeNode /><feMergeNode in='SourceGraphic' /></feMerge></filter>
          <pattern id={id + '-grid'} width='34' height='34' patternUnits='userSpaceOnUse'><circle cx='1' cy='1' r='1' fill='#9cb9ff' opacity='.15' /></pattern>
        </defs>
        <rect width='100%' height='100%' fill={'url(#' + id + '-grid)'} pointerEvents='none' />
        <ellipse cx={size.width / 2} cy={size.height / 2} rx={radius * 1.7} ry={radius * 1.5} fill={'url(#' + id + '-back)'} pointerEvents='none' />
        <g transform={'translate(' + (size.width / 2 + camera.x) + ',' + (size.height / 2 + camera.y) + ') scale(' + camera.k + ')'}>
          {[.35, .68, 1.08, 1.18].map(r => <circle key={r} r={radius * r} fill='none' stroke={style === 'depth' ? '#b1a1ff' : '#7bbfff'} strokeOpacity='.08' strokeDasharray={r < 1 ? '2 9' : undefined} pointerEvents='none' />)}
          {style === 'depth' && <ellipse cy={radius * .7} rx={radius * 1.3} ry={radius * .18} fill='none' stroke='#a18eff' strokeOpacity='.18' pointerEvents='none' />}
          {view === 'bundle' && display.sectors.map(sector => {
            const r = radius + 18, a = sector.start, b = sector.end
            return <g key={sector.owner} role='button' tabIndex={0} data-bundle-sector={sector.owner} aria-label={(collapsed.has(sector.owner) ? '展开 Bundle ' : '聚合 Bundle ') + sector.owner} className='exploration-sector' onClick={() => toggle(sector.owner)} onKeyDown={event => keyboard(event, () => toggle(sector.owner))}>
              <path d={'M' + Math.sin(a) * r + ',' + -Math.cos(a) * r + ' A' + r + ',' + r + ' 0 ' + (b - a > Math.PI ? 1 : 0) + ' 1 ' + Math.sin(b) * r + ',' + -Math.cos(b) * r} fill='none' stroke={graphColor(sector.owner)} strokeWidth={collapsed.has(sector.owner) ? 7 : 3} filter={'url(#' + id + '-glow)'} />
              <text transform={'translate(' + Math.sin(sector.angle) * (radius + 46) + ',' + -Math.cos(sector.angle) * (radius + 46) + ')'} textAnchor='middle' fontSize={12 / camera.k} fontWeight='600'>{sector.label} · {sector.count}</text>
            </g>
          })}
          {visibleEdges.map(edge => { const reading = edgeReading(edge), emphasized = active(edge) || incident(edge), muted = Boolean((focusedId || sourceIds.size) && !emphasized)
            return <g key={edge.id}>
              <path className='exploration-link' d={path(edge)} stroke={emphasized ? '#ecf6ff' : graphColor(own.get(edge.from)!)} strokeWidth={emphasized ? 2.4 : 1.1} strokeOpacity={muted ? .055 : reading.meaning === 'contains' ? .18 : emphasized ? .95 : .4} strokeDasharray={reading.meaning === 'similar' ? '4 4' : reading.meaning === 'contains' ? '2 5' : undefined} filter={emphasized ? 'url(#' + id + '-glow)' : undefined} pointerEvents='none' />
              <path d={path(edge)} stroke='transparent' strokeWidth='12' fill='none' role='button' tabIndex={0} aria-label={relationMeaningLabel(reading.meaning) + ' · ' + edgeMembers(edge).length + ' 条原始关系'} onClick={event => { event.stopPropagation(); onEdge(edge) }} onKeyDown={event => keyboard(event, () => onEdge(edge))}><title>{relationMeaningLabel(reading.meaning) + ' · ' + reading.origin + ' · ' + reading.lifecycle + ' · ' + edgeMembers(edge).length + ' 条原始关系'}</title></path>
            </g>
          })}
          {display.nodes.map(node => { const p = point(node.id), chosen = node.sources.includes(selected), hot = chosen || hovered === node.id || selectedEndpoints.has(node.id)
            const n = node.node, color = graphColor(node.owner), r = n ? (n.record ? 4.5 : 2.8) : 10
            return <g key={node.id} data-graph-node={node.id} data-original-id={n?.id} role='button' tabIndex={0} aria-label={node.label} className='exploration-node' transform={'translate(' + p.x + ',' + p.y + ')'} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered('')} onFocus={() => setHovered(node.id)} onBlur={() => setHovered('')} onClick={event => { event.stopPropagation(); if (n) onNode(n.id); else toggle(node.owner) }} onKeyDown={event => keyboard(event, () => n ? onNode(n.id) : toggle(node.owner))}>
              {style === 'depth' && <ellipse cy={r + 9} rx={r * 2.4} ry={r * .65} fill={color} opacity='.15' />}
              <circle r={hot ? r * 4 : r * 2.2} fill={color} opacity={hot ? .16 : .065} className={hot ? 'exploration-pulse' : undefined} />
              <circle className='exploration-focus' r={r + 5} fill='none' stroke={color} opacity={hot ? .9 : !n ? .5 : .12} strokeWidth='1' />
              <circle r={r} fill={hot ? '#fff' : color} filter={'url(#' + id + '-glow)'} />
              <circle r={14} fill='transparent' />
              <title>{node.label + ' · ' + node.owner + (n ? ' · ' + n.file + '#' + n.pointer : ' · 点击展开 ' + node.sources.length + ' 个对象')}</title>
            </g>
          })}
        </g>
        <g aria-hidden='true'>{labels.map(label => <text key={label.id} x={label.box.x + 4} y={label.box.y + 15} fontSize={label.fontSize} fontWeight={label.fontSize === 14 ? 600 : 400}>{label.text}</text>)}</g>
      </svg>
      <div className='graph-exploration-count'>{display.sectors.length} Bundles · {graph.nodes.length} 个可见原对象 · {visibleEdges.length} 组跨对象关系 · {internalCount} 条折叠内部关系 · 二维探索</div>
      <div className='graph-exploration-legend'>实线：其他关联　虚线：相似候选　点线：包含<br />{view === 'bundle' ? '点击外圈聚合/展开 · 悬停追线 · 点击关系查看依据' : '拖动画布平移 · 滚轮缩放 · 点击对象或关系查看依据'}<br />束线仅组织阅读；数量不代表业务强度或确认程度</div>
    </div>
  </div>
}
