import React, { useEffect, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { drag } from 'd3-drag'
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom'
import type { SimulationNodeDatum } from 'd3-force'
import { nodeRadius, type GraphScope, type GraphNode, type GraphEdge } from './graph-model.js'
import { createGraphLayoutJob } from './graph-layout-client.js'
import { SpatialGraphCanvas } from './graph-spatial.js'
import { visibleLabelIds } from './graph-labels.js'

interface Particle extends SimulationNodeDatum { id: string; node: GraphNode; degree: number; cx: number; cy: number; record: string; group: string; dx: number; dy: number }
export interface GraphCanvasProps { graph: GraphScope; layoutEdges?: GraphEdge[]; reach: Map<string, number>; sizeMode?: 'uniform' | 'reach'; selected: string; selectedEdge: string; matches: Set<string> | null; layout?: string; onNode: (id: string) => void; onEdge: (id: string) => void; onClear: () => void }
const colors = ['#8b75cc', '#539fa5', '#cf9360', '#7893ce', '#bd7c9e', '#83a06c']
export function GraphCanvas(props: GraphCanvasProps) {
  const mode = props.layout ?? 'fcose'
  return <div className='graph-canvas' style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    {mode.startsWith('stress3') ? <SpatialGraphCanvas {...props} engine={mode} /> : <PlanarGraphCanvas {...props} engine={mode} />}
  </div>
}
function PlanarGraphCanvas(props: GraphCanvasProps & { engine: string }) {
  const svgRef = useRef<SVGSVGElement>(null), latest = useRef(props)
  const savedPositions = useRef(new Map<string, { x: number; y: number }>())
  const solvedKey = useRef(''), savedCamera = useRef<ZoomTransform>(zoomIdentity)
  latest.current = props
  const actions = useRef({ fit: () => {}, restart: () => {}, zoom: (_factor: number) => {}, pause: (_paused: boolean) => {}, style: () => {} })
  const [paused, setPaused] = useState(false)
  const pauseIntent = useRef(false)
  const [layoutError, setLayoutError] = useState('')
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const svg = select(el), root = svg.append('g').attr('data-graph-world', '')
    const graph = props.graph, centers = new Map(graph.nodes.map((n, i) => [n.id, { x: Math.cos(i * 2.399963) * 180, y: Math.sin(i * 2.399963) * 180 }]))
    const solverGraph = { ...graph, edges: props.layoutEdges ?? graph.edges }
    const key = JSON.stringify([props.engine, graph.nodes.map(n => [n.id, n.recordId, n.record]).sort(), solverGraph.edges.map(e => [e.from, e.to, e.kind]).sort()])
    const reusable = solvedKey.current === key && graph.nodes.every(n => savedPositions.current.has(n.id))
    let disposed = false, generation = 0
    let job: ReturnType<typeof createGraphLayoutJob> | undefined
    setLayoutError('')
    const owners = [...new Set(graph.nodes.map(n => n.owner))].sort()
    const counts = new Map<string, Set<string>>()
    for (const e of graph.edges) { if (!counts.has(e.from)) counts.set(e.from, new Set()); if (!counts.has(e.to)) counts.set(e.to, new Set()); counts.get(e.from)!.add(e.to); counts.get(e.to)!.add(e.from) }
    const particles: Particle[] = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((node, i) => {
      const { x: cx, y: cy } = savedPositions.current.get(node.id) ?? centers.get(node.id)!
      // Preserve solved anchors as seeds; the solver owns descendant spacing.
      return { id: node.id, node, degree: counts.get(node.id)?.size ?? 0, cx, cy, record: node.recordId ?? node.id, group: '', dx: 0, dy: 0, x: cx, y: cy }
    })
    // Layout uses one spring per endpoint pair. Original parallel edges remain inspectable.
    const byId = new Map(particles.map(n => [n.id, n]))
    const regions: { id: string; nodes: Particle[] }[] = []
    const backdrops = root.append('g').attr('pointer-events', 'none').selectAll<SVGRectElement, typeof regions[number]>('rect').data(regions).join('rect')
      .attr('data-layout-region', g => g.id).attr('fill', '#f0f2f7').attr('fill-opacity', .6).attr('stroke', '#e0e4ed').attr('stroke-width', 1).attr('rx', 26)
    const lines = root.append('g').selectAll<SVGLineElement, GraphEdge>('line').data(graph.edges).join('line')
      .attr('data-relation-kind', e => e.kind).attr('stroke', e => e.kind === 'contains' ? '#697386' : '#617291')
      .attr('stroke-dasharray', e => e.kind === 'contains' ? '4 3' : null)
      .attr('stroke-width', e => e.kind === 'contains' ? 1.4 : 1.6).attr('vector-effect', 'non-scaling-stroke').attr('pointer-events', 'none')
    const hits = root.append('g').selectAll<SVGLineElement, GraphEdge>('line').data(graph.edges).join('line')
      .attr('stroke', 'transparent').attr('stroke-width', 12).attr('vector-effect', 'non-scaling-stroke').attr('role', 'button').attr('tabindex', 0).attr('aria-label', e => e.label)
      .on('click', (event, e) => { event.stopPropagation(); latest.current.onEdge(e.id) })
      .on('keydown', (event, e) => { if (event.key === 'Enter') latest.current.onEdge(e.id) })
    const nodeEls = root.append('g').selectAll<SVGGElement, Particle>('g').data(particles, n => n.id).join('g')
      .attr('role', 'button').attr('tabindex', 0).attr('aria-label', n => n.node.label).attr('data-node-id', n => n.id).style('cursor', 'grab')
    nodeEls.append('circle').attr('r', n => Math.min(12, 4 + Math.sqrt(n.degree) * 1.6)).attr('fill', n => colors[owners.indexOf(n.node.owner) % colors.length])
    nodeEls.append('circle').attr('r', 14).attr('fill', 'transparent')
    const labels = nodeEls.append('text').attr('text-anchor', 'middle').attr('y', 23).attr('font-size', 11).attr('fill', '#59616d').attr('pointer-events', 'none')
      .attr('font-weight', n => n.node.record ? 500 : 400)
      .text(n => n.node.label.length > 14 ? n.node.label.slice(0, 14) + '…' : n.node.label)
    labels.append('tspan').attr('x', 0).attr('dy', '1.4em').attr('font-size', '.8em').attr('fill', '#8a909c')
      .text(n => { const source = n.node.sourcePanel ?? n.node.previewSourcePanel ?? n.node.file.split('/').at(-1) ?? ''; return source.length > 20 ? source.slice(0, 19) + '…' : source })
    nodeEls.append('title').text(n => [n.node.label, n.node.sourcePanel ?? n.node.previewSourcePanel, n.node.file + '#' + (n.node.pointer || '/')].filter(Boolean).join(' · '))
    let hovered = '', transform: ZoomTransform = zoomIdentity, stopped = pauseIntent.current
    let dragSnapshot: Map<string, { x: number; y: number }> | undefined
    const hasGroups = particles.some(n => !n.node.record && byId.get(n.record)?.node.record)
    const positions = () => new Map(particles.map(n => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]))
    function rollbackDrag() {
      if (!dragSnapshot) return
      for (const [id, p] of dragSnapshot) Object.assign(byId.get(id)!, p)
      savedPositions.current = positions(); dragSnapshot = undefined; paint()
    }
    async function arrange(dragged?: string) {
      const current = ++generation
      job?.cancel()
      setLayoutError('')
      el!.setAttribute('data-layout-state', 'running')
      try {
        job = createGraphLayoutJob(solverGraph, props.engine, positions(), dragged)
        const result = await job.result
        if (disposed || current !== generation) return
        setLayoutError('')
        for (const [id, p] of result) { const n = byId.get(id); if (n) { n.x = p.x; n.y = p.y } }
        savedPositions.current = positions()
        dragSnapshot = undefined
        solvedKey.current = key
        paint(); if (!dragged) fit()
        el!.setAttribute('data-layout-state', stopped ? 'paused' : 'settled')
      } catch (error) { if (!disposed && current === generation) {
        if (dragged) rollbackDrag()
        setLayoutError(String(error)); el!.setAttribute('data-layout-state', 'error')
      } }
    }
    function style() {
      const { selected, selectedEdge, matches } = latest.current, focus = hovered || selected
      const neighbors = counts.get(focus) ?? new Set<string>()
      nodeEls.attr('opacity', n => (focus && n.id !== focus && !neighbors.has(n.id)) || (matches && !matches.has(n.id) && n.id !== selected && n.id !== hovered) ? .16 : 1)
      nodeEls.select('circle').attr('stroke', n => n.id === selected ? '#44326f' : '#fff').attr('stroke-width', n => n.id === selected ? 2 : 1)
        .attr('r', n => (latest.current.sizeMode === 'uniform' ? (n.node.record ? 4 : 2) : nodeRadius(n.node, latest.current.reach)) / transform.k)
      nodeEls.select('circle:nth-child(2)').attr('r', 14 / transform.k)
      labels.attr('font-size', 11 / transform.k).attr('y', 23 / transform.k)
      lines.attr('stroke', e => e.id === selectedEdge ? '#b76d25' : focus && (e.from === focus || e.to === focus) ? '#65508f' : e.kind === 'contains' ? '#697386' : '#617291')
        .attr('stroke-width', e => e.id === selectedEdge || focus && (e.from === focus || e.to === focus) ? 2.5 : e.kind === 'contains' ? 1.4 : 1.6)
      .attr('stroke-opacity', e => e.id === selectedEdge ? 1 : focus && e.from !== focus && e.to !== focus ? .07 : e.kind === 'contains' ? .68 : .72)
      // Keep important labels, avoid overlapping ordinary labels at the current zoom.
      const boxes: { id: string; x: number; y: number; w: number; h: number; important: boolean }[] = []
      const measured = new Map<string, DOMRect>()
      labels.each(function (n) { measured.set(n.id, this.getBBox()) })
      for (const n of [...particles].sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || Number(b.node.record)-Number(a.node.record) || b.degree - a.degree)) {
        const important = n.id === focus || (matches?.has(n.id) ?? false)
        if (!important && ((focus && !neighbors.has(n.id)) || (matches && !matches.has(n.id)) || (!n.node.record && !focus && transform.k < .7))) continue
        const box = measured.get(n.id)!
        boxes.push({ id: n.id, important, x: ((n.x ?? 0) + box.x) * transform.k, y: ((n.y ?? 0) + box.y) * transform.k, w: box.width * transform.k, h: box.height * transform.k })
      }
      const show = visibleLabelIds(boxes)
      labels.attr('opacity', n => show.has(n.id) ? 1 : 0)
    }
    function paint() {
      backdrops.attr('x', g => Math.min(...g.nodes.map(n => n.x ?? 0)) - 65).attr('y', g => Math.min(...g.nodes.map(n => n.y ?? 0)) - 45)
        .attr('width', g => Math.max(...g.nodes.map(n => n.x ?? 0)) - Math.min(...g.nodes.map(n => n.x ?? 0)) + 130)
        .attr('height', g => Math.max(...g.nodes.map(n => n.y ?? 0)) - Math.min(...g.nodes.map(n => n.y ?? 0)) + 100)
      nodeEls.attr('transform', n => `translate(${n.x ?? 0},${n.y ?? 0})`)
      for (const selection of [lines, hits]) selection.attr('x1', e => byId.get(e.from)?.x ?? 0).attr('y1', e => byId.get(e.from)?.y ?? 0).attr('x2', e => byId.get(e.to)?.x ?? 0).attr('y2', e => byId.get(e.to)?.y ?? 0)
      style()
    }
    const camera = zoom<SVGSVGElement, unknown>().scaleExtent([.08, 5]).clickDistance(5)
      .on('zoom', event => { transform = event.transform; savedCamera.current = transform; root.attr('transform', transform.toString()); style() })
    svg.call(camera).on('dblclick.zoom', null)
    svg.on('click.clear', event => { if (event.target === el) latest.current.onClear() })
      .on('keydown.camera', event => {
        if (event.key === 'Escape') { latest.current.onClear(); return }
        if (event.target !== el) return
        const moves: Record<string, [number, number]> = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] }
        if (moves[event.key]) { event.preventDefault(); svg.call(camera.translateBy, moves[event.key][0] / transform.k, moves[event.key][1] / transform.k) }
      })
    nodeEls.on('mouseenter', (_e, n) => { hovered = n.id; style() }).on('mouseleave', () => { hovered = ''; style() })
      .on('focus', (_e, n) => { hovered = n.id; style() }).on('blur', () => { hovered = ''; style() })
      .on('click', (event, n) => { event.stopPropagation(); latest.current.onNode(n.id) })
      .on('keydown', (event, n) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); latest.current.onNode(n.id) } })
      .call(drag<SVGGElement, Particle>().container(() => root.node()!).clickDistance(5)
        .on('start', (_event, n) => { generation++; job?.cancel(); rollbackDrag(); dragSnapshot = positions(); n.fx = n.x; n.fy = n.y; nodeEls.style('cursor', 'grabbing') })
        .on('drag', (event, n) => {
          const dx = event.x - (n.x ?? 0), dy = event.y - (n.y ?? 0)
          if (n.node.record) for (const child of particles) if (child.id !== n.id && child.record === n.id) { child.x = (child.x ?? 0) + dx; child.y = (child.y ?? 0) + dy }
          n.fx = event.x; n.fy = event.y; n.x = event.x; n.y = event.y; paint()
        })
        .on('end', (_event, n) => { n.fx = n.x; n.fy = n.y; nodeEls.style('cursor', 'grab'); savedPositions.current = positions(); solvedKey.current = key; dragSnapshot = undefined; el.setAttribute('data-layout-state', 'settled'); nodeEls.filter(p => p.id === n.id).attr('data-pinned', 'true') }))
    const fit = () => {
      if (!particles.length) return
      const box = el.getBoundingClientRect(), xs = particles.map(n => n.x ?? 0), ys = particles.map(n => n.y ?? 0)
      const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(1, Math.max(...xs) - minX), h = Math.max(1, Math.max(...ys) - minY)
      // Labels keep screen-space font size: reserve pixels, not zoomed world padding.
      const marginX = Math.min(Math.max(16, box.width / 2 - 24), Math.max(24, ...labels.nodes().map(label => label.getComputedTextLength() * transform.k / 2 + 10)))
      const k = Math.max(.08, Math.min(1.5, Math.max(1, box.width - 2 * marginX) / w, Math.max(1, box.height - 100) / h))
      svg.call(camera.transform, zoomIdentity.translate(box.width / 2 - (minX + w / 2) * k, (box.height - 20) / 2 - (minY + h / 2) * k).scale(k))
    }
    paint()
    if (reusable || stopped) { svg.call(camera.transform, savedCamera.current); el.setAttribute('data-layout-state', stopped ? 'paused' : 'settled') }
    else { fit(); void arrange() }
    actions.current = { fit, style, zoom: factor => { svg.call(camera.scaleBy, factor) }, restart: () => { nodeEls.attr('data-pinned', null); rollbackDrag(); stopped = false; pauseIntent.current = false; setPaused(false); void arrange() }, pause: value => { stopped = value; pauseIntent.current = value; generation++; job?.cancel(); rollbackDrag(); savedPositions.current = positions(); if (value) el.setAttribute('data-layout-state', 'paused'); else void arrange() } }
    let width = el.clientWidth, height = el.clientHeight
    const resize = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight
      if (w === width && h === height) return
      // Resize preserves the user's scale and world center; only Fit changes framing.
      svg.call(camera.transform, zoomIdentity.translate(transform.x + (w - width) / 2, transform.y + (h - height) / 2).scale(transform.k))
      width = w; height = h
    })
    resize.observe(el)
    return () => { disposed = true; generation++; job?.cancel(); rollbackDrag(); resize.disconnect(); svg.on('.zoom', null).on('.clear', null).on('.camera', null); root.remove(); actions.current = { fit: () => {}, restart: () => {}, zoom: () => {}, pause: () => {}, style: () => {} } }
  }, [props.graph, props.engine, props.layoutEdges])
  useEffect(() => { actions.current.style() }, [props.selected, props.selectedEdge, props.matches, props.sizeMode])
  return <div style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}>
    <svg ref={svgRef} aria-label='字段关联图' tabIndex={0} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, background: '#fafafa', touchAction: 'none', userSelect: 'none', cursor: 'grab' }} />
    {layoutError && <p role='alert' style={{ position: 'relative', padding: 12 }}>布局不可用，可切换算法：{layoutError}</p>}
    <div className='graph-camera-tools' style={{ position: 'absolute', right: 16, bottom: 16, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      <button aria-label='放大图谱' onClick={() => actions.current.zoom(1.25)}>＋</button><button aria-label='缩小图谱' onClick={() => actions.current.zoom(.8)}>－</button>
      <button onClick={() => actions.current.fit()}>适应画布</button><button onClick={() => actions.current.restart()}>解除固定并重新布局</button>
      <button disabled>拖动后固定 · 仅当前视图</button>
    </div>
  </div>
}
