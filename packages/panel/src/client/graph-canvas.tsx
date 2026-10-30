import React, { useEffect, useId, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { drag } from 'd3-drag'
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom'
import type { SimulationNodeDatum } from 'd3-force'
import { nodeRadius, edgeReading, type GraphScope, type GraphNode, type GraphEdge } from './graph-model.js'
import { createGraphLayoutJob } from './graph-layout-client.js'
import { SpatialGraphCanvas } from './graph-spatial.js'
import { intersects, graphLabelRanks, shortGraphLabel, type LabelBox } from './graph-labels.js'
import { createGraphNebula } from './graph-nebula.js'
import { GraphCameraTools, graphAmbientColors, graphSourceColors, graphDarkSourceColors, type GraphCanvasTheme } from './graph-canvas-presentation.js'
export { graphSourceColors } from './graph-canvas-presentation.js'

interface Particle extends SimulationNodeDatum { id: string; node: GraphNode; degree: number; record: string }
export interface GraphCanvasProps { graph: GraphScope; layoutEdges?: GraphEdge[]; reach: Map<string, number>; contentCounts?: ReadonlyMap<string, number>; sizeMode?: 'uniform' | 'reach'; selected: string; selectedEdge: string; matches: Set<string> | null; layout?: string; sourceLabels?: Record<string, string>; viewMode?: 'graph' | 'ring'; onNode: (id: string) => void; onEdge: (id: string) => void; onClear: () => void }
export function GraphCanvas(props: GraphCanvasProps) {
  const mode = props.viewMode === 'ring' ? 'ring' : props.layout ?? 'stress2-original'
  const [dark, setDark] = useState(false)
  const theme = { dark, onToggleDark: () => setDark(value => !value) }
  return <div className='graph-canvas' style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    {mode.startsWith('stress3') ? <SpatialGraphCanvas {...props} {...theme} engine={mode} /> : <PlanarGraphCanvas {...props} {...theme} engine={mode} />}
  </div>
}
function PlanarGraphCanvas(props: GraphCanvasProps & GraphCanvasTheme & { engine: string }) {
  const svgRef = useRef<SVGSVGElement>(null), nebulaRef = useRef<HTMLCanvasElement>(null), latest = useRef(props)
  const instanceId = 'graph-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const views = useRef(new Map<string, { positions: Map<string, { x: number; y: number }>; camera: ZoomTransform; key: string; baseScale: number; center: [number, number] }>())
  latest.current = props
  const actions = useRef({ fit: () => {}, restart: () => {}, zoom: (_factor: number) => {}, style: () => {} })
  const { dark } = props, darkRef = useRef(dark)
  darkRef.current = dark
  const [bundleFocus, setBundleFocus] = useState(''), bundleFocusRef = useRef(bundleFocus)
  bundleFocusRef.current = bundleFocus
  const [layoutError, setLayoutError] = useState('')
  useEffect(() => {
    const el = svgRef.current, canvas = nebulaRef.current
    if (!el || !canvas) return
    const ring = props.engine === 'ring', previous = views.current.get(props.engine)
    const svg = select(el), defs = svg.append('defs'), root = svg.append('g').attr('data-graph-world', '')
    const nebula = createGraphNebula(canvas)
    const graph = props.graph, seeds = new Map(graph.nodes.map((node, i) => [node.id, { x: Math.cos(i * 2.399963) * 180, y: Math.sin(i * 2.399963) * 180 }])), solverGraph = { ...graph, edges: props.layoutEdges ?? graph.edges }
    const key = JSON.stringify([props.engine, graph.nodes.map(n => [n.id, n.recordId, n.record]).sort(), solverGraph.edges.map(e => [e.from, e.to, e.kind]).sort()])
    const reusable = previous?.key === key && graph.nodes.every(n => previous.positions.has(n.id))
    let disposed = false, generation = 0, frame = 0, densityKey = '', solved = reusable ? key : ''
    let job: ReturnType<typeof createGraphLayoutJob> | undefined
    let transform = previous?.camera ?? zoomIdentity, baseScale = previous?.baseScale ?? 1, fitCenter: [number, number] = previous?.center ?? [0, 0]
    setLayoutError('')
    const owners = [...new Set([...Object.keys(props.sourceLabels ?? {}), ...graph.nodes.map(n => n.owner)])].sort()
    const palette = (owner: string) => (darkRef.current ? graphDarkSourceColors : graphSourceColors)[Math.max(0, owners.indexOf(owner)) % graphSourceColors.length]
    const counts = new Map<string, Set<string>>()
    for (const e of graph.edges) { if (!counts.has(e.from)) counts.set(e.from, new Set()); if (!counts.has(e.to)) counts.set(e.to, new Set()); counts.get(e.from)!.add(e.to); counts.get(e.to)!.add(e.from) }
    const particles: Particle[] = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((node, i) => ({
      id: node.id, node, degree: counts.get(node.id)?.size ?? 0, record: node.recordId ?? node.id,
      x: previous?.positions.get(node.id)?.x ?? seeds.get(node.id)!.x,
      y: previous?.positions.get(node.id)?.y ?? seeds.get(node.id)!.y,
    }))
    const byId = new Map(particles.map(n => [n.id, n]))
    const labelRanks = graphLabelRanks(graph)
    const groups = owners.map(owner => ({ owner, nodes: particles.filter(n => n.node.owner === owner), start: 0, end: 0, angle: 0 })).filter(group => group.nodes.length > 0)
    let cursor = 0
    const total = particles.length + groups.length * 2, radius = 300
    for (const group of groups) {
      group.start = (cursor + .7) / total * Math.PI * 2
      group.end = (cursor + group.nodes.length + 1.3) / total * Math.PI * 2
      group.angle = (group.start + group.end) / 2
      if (ring && !reusable) group.nodes.forEach((n, i) => {
        const angle = group.start + (group.end - group.start) * (i + .5) / group.nodes.length
        n.x = Math.sin(angle) * radius; n.y = -Math.cos(angle) * radius
      })
      cursor += group.nodes.length + 2
    }
    const marker = defs.append('marker').attr('id', instanceId + '-arrow').attr('viewBox', '0 0 6 6').attr('refX', 7.6).attr('refY', 3).attr('markerWidth', 4).attr('markerHeight', 4).attr('orient', 'auto')
    const arrow = marker.append('path').attr('d', 'M0 0L6 3L0 6')
    const arcs = root.append('g').selectAll<SVGGElement, typeof groups[number]>('g').data(ring ? groups : []).join('g')
      .attr('role', 'button').attr('tabindex', 0).attr('data-bundle', g => g.owner).attr('aria-label', g => '突出' + (latest.current.sourceLabels?.[g.owner] ?? g.owner) + '关联').style('cursor', 'pointer')
      .on('click', (event, g) => { event.stopPropagation(); bundleFocusRef.current = bundleFocusRef.current === g.owner ? '' : g.owner; setBundleFocus(bundleFocusRef.current); latest.current.onClear(); style() })
      .on('keydown', (event, g) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); bundleFocusRef.current = bundleFocusRef.current === g.owner ? '' : g.owner; setBundleFocus(bundleFocusRef.current); latest.current.onClear(); style() } })
    arcs.append('path').attr('class', 'graph-bundle-arc').attr('fill', 'none').attr('stroke', g => palette(g.owner)).attr('vector-effect', 'non-scaling-stroke').attr('stroke-opacity', .8)
    arcs.append('path').attr('class', 'graph-bundle-hit').attr('fill', 'none').attr('stroke', 'transparent').attr('stroke-width', 16).attr('vector-effect', 'non-scaling-stroke')
    const arcLabels = arcs.append('text').attr('text-anchor', 'middle').attr('pointer-events', 'none')
      .text(g => (latest.current.sourceLabels?.[g.owner] ?? g.owner) + ' · ' + g.nodes.length)
    const gradients = defs.selectAll<SVGLinearGradientElement, GraphEdge>('linearGradient').data(graph.edges).join('linearGradient')
      .attr('id', (_e, i) => instanceId + '-edge-' + i).attr('gradientUnits', 'userSpaceOnUse')
    gradients.append('stop').attr('offset', '0%').attr('stop-color', e => palette(byId.get(e.from)?.node.owner ?? ''))
    gradients.append('stop').attr('offset', '100%').attr('stop-color', e => palette(byId.get(e.to)?.node.owner ?? ''))
    const edgeIndex = new Map(graph.edges.map((e, i) => [e.id, i]))
    const pairs = new Map<string, GraphEdge[]>()
    for (const e of graph.edges) { const key = [e.from, e.to].sort().join('|'); const group = pairs.get(key) ?? []; group.push(e); pairs.set(key, group) }
    function path(e: GraphEdge) {
      const a = byId.get(e.from), b = byId.get(e.to)
      if (!a || !b) return ''
      const ax = a.x ?? 0, ay = a.y ?? 0, bx = b.x ?? 0, by = b.y ?? 0
      if (ring) return 'M' + ax + ',' + ay + ' C' + ax * .3 + ',' + ay * .3 + ' ' + bx * .3 + ',' + by * .3 + ' ' + bx + ',' + by
      const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy) || 1, pair = pairs.get([e.from, e.to].sort().join('|'))!
      const arc = edgeReading(e).meaning === 'contains' ? 0 : pair.length > 1
        ? (pair.indexOf(e) - (pair.length - 1) / 2) * 12 / transform.k * (e.from < e.to ? 1 : -1) : Math.min(12 / transform.k, length * .065)
      return 'M' + ax + ',' + ay + ' Q' + ((ax + bx) / 2 - dy / length * arc) + ',' + ((ay + by) / 2 + dx / length * arc) + ' ' + bx + ',' + by
    }
    const edgeGlyphs = root.append('g').attr('pointer-events', 'none').selectAll<SVGGElement, GraphEdge>('g').data(graph.edges).join('g').attr('data-edge-glyph', e => e.id)
    const separation = edgeGlyphs.append('path')
      .attr('fill', 'none').attr('stroke-width', 4).attr('stroke-opacity', .85).attr('vector-effect', 'non-scaling-stroke')
    const lines = edgeGlyphs.append('path')
      .attr('data-relation-kind', e => e.kind).attr('data-edge-id', e => e.id).attr('fill', 'none').attr('vector-effect', 'non-scaling-stroke')
    const hits = root.append('g').selectAll<SVGPathElement, GraphEdge>('path').data(graph.edges).join('path')
      .attr('data-edge', e => e.id).attr('fill', 'none').attr('stroke', 'transparent').attr('stroke-width', 12).attr('vector-effect', 'non-scaling-stroke').attr('role', 'button').attr('tabindex', 0).attr('aria-label', e => e.label).style('cursor', 'pointer')
      .on('click', (event, e) => { event.stopPropagation(); bundleFocusRef.current = ''; setBundleFocus(''); latest.current.onEdge(e.id) })
      .on('keydown', (event, e) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); bundleFocusRef.current = ''; setBundleFocus(''); latest.current.onEdge(e.id) } })
    const nodeEls = root.append('g').selectAll<SVGGElement, Particle>('g').data(particles, n => n.id).join('g')
      .attr('role', 'button').attr('tabindex', 0).attr('aria-label', n => n.node.label).attr('data-node-id', n => n.id).style('cursor', ring ? 'pointer' : 'grab')
    nodeEls.append('circle').attr('class', 'graph-node-focus').attr('fill', 'none').attr('stroke-width', 1.5).attr('vector-effect', 'non-scaling-stroke')
    nodeEls.append('circle').attr('class', 'graph-node-dot')
    nodeEls.append('circle').attr('class', 'graph-node-hit').attr('fill', 'transparent')
    nodeEls.append('title').text(n => [n.node.label, n.node.sourcePanel ?? n.node.previewSourcePanel, n.node.file + '#' + (n.node.pointer || '/')].filter(Boolean).join(' · '))
    const labels = root.append('g').selectAll<SVGTextElement, Particle>('text').data(particles, n => n.id).join('text')
      .attr('data-label', n => n.id).attr('paint-order', 'stroke').attr('stroke-linejoin', 'round').attr('text-anchor', 'start')
      .attr('aria-hidden', 'true').style('cursor', 'pointer')
      .on('mousedown', event => { event.preventDefault(); event.stopPropagation() })
      .on('click', (event, n) => { event.stopPropagation(); latest.current.onNode(n.id) })
    let hovered = '', keyboardNode = '', hoverLeave: ReturnType<typeof setTimeout> | undefined, dragSnapshot: Map<string, { x: number; y: number }> | undefined
    const positions = () => new Map(particles.map(n => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]))
    const screen = (n: Particle) => ({ x: (n.x ?? 0) * transform.k + transform.x, y: (n.y ?? 0) * transform.k + transform.y })
    function rollbackDrag() {
      if (!dragSnapshot) return
      for (const [id, p] of dragSnapshot) Object.assign(byId.get(id)!, p)
      dragSnapshot = undefined; paint()
    }
    function requestDensity(focused: boolean) {
      const box = el!.getBoundingClientRect(), next = JSON.stringify([box.width, box.height, transform.x, transform.y, transform.k, darkRef.current, focused, particles.map(n => [n.x, n.y])])
      if (next === densityKey) return
      densityKey = next
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        if (disposed) return
        if (ring) { nebula.clear(); return }
        nebula.paint(particles.map(n => ({ ...screen(n), color: graphAmbientColors[Math.max(0, owners.indexOf(n.node.owner)) % graphAmbientColors.length] })), {
          width: el!.clientWidth, height: el!.clientHeight, panX: transform.apply(fitCenter)[0] - el!.clientWidth / 2,
          panY: transform.apply(fitCenter)[1] - el!.clientHeight / 2, zoom: transform.k / baseScale, dark: darkRef.current, focused,
        })
      })
    }
    function style() {
      const { selected, selectedEdge, matches } = latest.current, dark = darkRef.current
      const chosen = graph.edges.find(e => e.id === selectedEdge), endpoints = new Set(chosen ? [chosen.from, chosen.to] : [])
      const focus = selected || keyboardNode || hovered, bundle = ring ? bundleFocusRef.current : ''
      const near = new Set(focus ? [focus, ...(counts.get(focus) ?? [])] : endpoints)
      if (hovered) near.add(hovered)
      const hotEdge = (e: GraphEdge) => e.id === selectedEdge || Boolean(focus && (e.from === focus || e.to === focus)) || Boolean(bundle && (byId.get(e.from)?.node.owner === bundle || byId.get(e.to)?.node.owner === bundle))
      if (bundle) { for (const n of particles) if (n.node.owner === bundle) near.add(n.id); for (const e of graph.edges) if (hotEdge(e)) { near.add(e.from); near.add(e.to) } }
      const focused = Boolean(focus || chosen || bundle), accent = dark ? '#c1b1ff' : '#6758b8', background = dark ? '#121a25' : '#fafbfd'
      const hotNode = (n: Particle) => n.id === focus || n.id === hovered || endpoints.has(n.id)
      const visualZoom = transform.k / baseScale
      // v5 capped its canvas height at 820px. Preserve that density on ordinary
      // canvases, with bounded screen-space glyph growth on larger workspaces.
      const glyphScale = Math.min(1.4, Math.max(1, Math.min(el!.clientWidth, el!.clientHeight) / 820))
      const dotRadius = (n: Particle) => glyphScale * (latest.current.sizeMode === 'reach' ? nodeRadius(n.node, latest.current.reach) : Math.min(n.node.record ? 4 : 2.5, Math.max(n.node.record ? 3 : 1.6, (n.node.record ? 3.3 : 1.8) * Math.pow(visualZoom, .15))))
      el!.style.background = 'transparent'; arrow.attr('fill', accent)
      for (const selection of [separation, lines, hits]) selection.attr('d', path)
      gradients.attr('x1', e => byId.get(e.from)?.x ?? 0).attr('y1', e => byId.get(e.from)?.y ?? 0).attr('x2', e => byId.get(e.to)?.x ?? 0).attr('y2', e => byId.get(e.to)?.y ?? 0)
      gradients.select('stop[offset="0%"]').attr('stop-color', e => palette(byId.get(e.from)?.node.owner ?? ''))
      gradients.select('stop[offset="100%"]').attr('stop-color', e => palette(byId.get(e.to)?.node.owner ?? ''))
      edgeGlyphs.sort((a, b) => Number(hotEdge(a)) - Number(hotEdge(b)))
      separation.attr('stroke', dark ? '#141d29' : '#fafbfd').attr('stroke-width', 4 * glyphScale).attr('display', e => hotEdge(e) && !bundle ? null : 'none')
      lines.attr('stroke', e => hotEdge(e) || (ring && edgeReading(e).meaning !== 'contains') ? 'url(#' + instanceId + '-edge-' + edgeIndex.get(e.id) + ')' : dark ? '#aabbd4' : '#76859b')
        .attr('stroke-width', e => glyphScale * (hotEdge(e) ? (bundle ? 1.15 : 1.55) : edgeReading(e).meaning === 'contains' ? .5 : ring ? .85 : .75))
        .attr('stroke-opacity', e => focused ? (hotEdge(e) ? .94 : .065) : edgeReading(e).meaning === 'contains' ? (dark ? .26 : .18) : ring ? (dark ? .64 : .54) : dark ? .58 : .45)
        .attr('stroke-dasharray', e => edgeReading(e).lifecycle === 'proposed' ? '5 4' : null)
        .attr('marker-end', e => hotEdge(e) && edgeReading(e).direction === 'forward' ? 'url(#' + instanceId + '-arrow)' : null)
      hits.attr('pointer-events', e => !focused || hotEdge(e) ? 'stroke' : 'none').attr('tabindex', e => !focused || hotEdge(e) ? 0 : -1)
      nodeEls.attr('opacity', n => (focused && !near.has(n.id)) || (matches && !matches.has(n.id) && !hotNode(n)) ? .22 : 1)
      nodeEls.select('.graph-node-focus').attr('r', n => (dotRadius(n) + 3) / transform.k).attr('stroke-width', 1.5 * glyphScale).attr('stroke', accent).attr('opacity', n => hotNode(n) ? 1 : 0)
      nodeEls.select('.graph-node-dot').attr('r', n => dotRadius(n) / transform.k).attr('fill', n => hotNode(n) ? accent : palette(n.node.owner))
      nodeEls.select('.graph-node-hit').attr('r', n => Math.max(9, dotRadius(n) + 4) / transform.k)
      const r = radius + 17 / baseScale
      const arc = (g: typeof groups[number]) => 'M' + Math.sin(g.start) * r + ',' + -Math.cos(g.start) * r + ' A' + r + ',' + r + ' 0 ' + (g.end - g.start > Math.PI ? 1 : 0) + ' 1 ' + Math.sin(g.end) * r + ',' + -Math.cos(g.end) * r
      arcs.selectAll<SVGPathElement, typeof groups[number]>('path').attr('d', arc)
      arcs.select('.graph-bundle-arc').attr('stroke', g => palette(g.owner)).attr('stroke-width', g => glyphScale * (bundle === g.owner ? 3 : 1.6))
      arcLabels.attr('x', g => Math.sin(g.angle) * (r + 20 / transform.k)).attr('y', g => -Math.cos(g.angle) * (r + 20 / transform.k)).attr('font-size', 12 / transform.k).attr('fill', dark ? '#dce3ee' : '#253145')
      const box = el!.getBoundingClientRect(), occupied: LabelBox[] = []
      arcLabels.each(function () { const b = this.getBBox(); occupied.push({ x: b.x * transform.k + transform.x, y: b.y * transform.k + transform.y, w: b.width * transform.k, h: b.height * transform.k }) })
      const nodeBoxes = particles.filter(n => !focused || near.has(n.id)).map(n => {
        const r = Math.max(4, dotRadius(n) + 1)
        return { id: n.id, x: screen(n).x - r, y: screen(n).y - r, w: r * 2, h: r * 2 }
      })
      const placements = new Map<string, { x: number; y: number; font: number; value: string }>()
      const fieldLabels = new Map<string, number>(), fieldBudget = Math.max(1, Math.min(3, Math.floor(visualZoom)))
      const ordered = [...particles].sort((a, b) => Number(hotNode(b)) - Number(hotNode(a)) || Number(near.has(b.id)) - Number(near.has(a.id)) || Number(matches?.has(b.id)) - Number(matches?.has(a.id)) || labelRanks.get(a.id)! - labelRanks.get(b.id)!)
      for (const n of ordered) {
        const hot = hotNode(n), neighbor = near.has(n.id), q = screen(n)
        if (q.x < -20 || q.x > box.width + 20 || q.y < -20 || q.y > box.height + 20) continue
        const detailed = hot || neighbor || Boolean(matches?.has(n.id)), preview = !n.node.record && !detailed
        if (focused && !hot && !neighbor && !matches?.has(n.id)) continue
        if (preview && (fieldLabels.get(n.record) ?? 0) >= fieldBudget) continue
        const font = hot ? 13 : preview ? 11 : 12, value = shortGraphLabel(n.node, detailed, latest.current.contentCounts?.get(n.id))
        const width = [...value].reduce((w, c) => w + (/[^\x00-\x7f]/.test(c) ? font : font * .58), 6)
        const gap = Math.max(9, dotRadius(n) + 5)
        const choices = [[q.x + gap, q.y + 4], [q.x - width - gap, q.y + 4], [q.x - width / 2, q.y - gap - 1], [q.x - width / 2, q.y + font + gap + 1], [q.x + gap, q.y - gap], [q.x + gap, q.y + font + gap + 1], [q.x - width - gap, q.y - gap], [q.x - width - gap, q.y + font + gap + 1]]
        let placed = false
        for (const [x, y] of choices) {
          const candidate = { x, y: y - font, w: width, h: font + 4 }
          if (x < 7 || x + width > box.width - 7 || candidate.y < 6 || candidate.y + candidate.h > box.height - 6) continue
          if (occupied.some(b => intersects(b, candidate)) || nodeBoxes.some(b => b.id !== n.id && intersects(b, candidate))) continue
          placements.set(n.id, { x, y, font, value }); occupied.push({ x: candidate.x - 4, y: candidate.y - 5, w: candidate.w + 8, h: candidate.h + 10 }); placed = true
          if (preview) fieldLabels.set(n.record, (fieldLabels.get(n.record) ?? 0) + 1)
          break
        }
        if (!placed && hot) { const x = Math.max(7, Math.min(box.width - width - 7, q.x + gap)), y = q.y + 4; placements.set(n.id, { x, y, font, value }); occupied.push({ x, y: y - font, w: width, h: font + 4 }) }
      }
      labels.attr('display', n => placements.has(n.id) ? null : 'none').text(n => placements.get(n.id)?.value ?? '')
        .attr('data-label-tier', n => hotNode(n) || near.has(n.id) || matches?.has(n.id) ? 'detail' : n.node.record ? 'record' : 'preview')
        .attr('x', n => ((placements.get(n.id)?.x ?? 0) - transform.x) / transform.k).attr('y', n => ((placements.get(n.id)?.y ?? 0) - transform.y) / transform.k)
        .attr('font-size', n => (placements.get(n.id)?.font ?? 12) / transform.k).attr('font-weight', n => hotNode(n) ? 550 : n.node.record ? 500 : 400)
        .attr('fill', dark ? '#dce3ee' : '#253145').attr('stroke', background).attr('stroke-width', 3 / transform.k)
        .attr('opacity', n => focused && !near.has(n.id) ? .25 : n.node.record || near.has(n.id) || matches?.has(n.id) ? 1 : .72)
      requestDensity(focused)
    }
    function paint() { nodeEls.attr('transform', n => 'translate(' + (n.x ?? 0) + ',' + (n.y ?? 0) + ')'); style() }
    const camera = zoom<SVGSVGElement, unknown>().scaleExtent([.08, 8]).clickDistance(5)
      .on('zoom', event => { transform = event.transform; root.attr('transform', transform.toString()); style() })
    svg.call(camera).on('dblclick.zoom', null)
    svg.on('click.clear', event => { if (event.target === el) { bundleFocusRef.current = ''; setBundleFocus(''); latest.current.onClear(); style() } })
      .on('keydown.camera', event => {
        if (event.key === 'Escape') { clearTimeout(hoverLeave); hovered = ''; keyboardNode = ''; bundleFocusRef.current = ''; setBundleFocus(''); latest.current.onClear(); style(); return }
        if (event.target !== el) return
        const moves: Record<string, [number, number]> = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] }
        if (moves[event.key]) { event.preventDefault(); svg.call(camera.translateBy, moves[event.key][0] / transform.k, moves[event.key][1] / transform.k) }
      })
    const enterNode = (_event: unknown, n: Particle) => { clearTimeout(hoverLeave); hovered = n.id; style() }
    // Keep a revealed label reachable across the small gap beside its node.
    const leaveNode = () => { clearTimeout(hoverLeave); hoverLeave = setTimeout(() => { hovered = ''; style() }, 160) }
    labels.on('mouseenter', enterNode).on('mouseleave', leaveNode)
    nodeEls.on('mouseenter', enterNode).on('mouseleave', leaveNode)
      .on('focus', (_e, n) => { keyboardNode = n.id; style() }).on('blur', () => { keyboardNode = ''; style() })
      .on('click', (event, n) => { event.stopPropagation(); bundleFocusRef.current = ''; setBundleFocus(''); latest.current.onNode(n.id) })
      .on('keydown', (event, n) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); bundleFocusRef.current = ''; setBundleFocus(''); latest.current.onNode(n.id) } })
    if (!ring) nodeEls.call(drag<SVGGElement, Particle>().container(() => root.node()!).clickDistance(5)
      .on('start', () => { generation++; job?.cancel(); rollbackDrag(); dragSnapshot = positions(); nodeEls.style('cursor', 'grabbing') })
      .on('drag', (event, n) => {
        const dx = event.x - (n.x ?? 0), dy = event.y - (n.y ?? 0)
        if (n.node.record) for (const child of particles) if (child.id !== n.id && child.record === n.id) { child.x = (child.x ?? 0) + dx; child.y = (child.y ?? 0) + dy }
        n.x = event.x; n.y = event.y; paint()
      })
      .on('end', (_event, n) => { solved = key; dragSnapshot = undefined; el.setAttribute('data-layout-state', 'settled'); nodeEls.style('cursor', 'grab').filter(p => p.id === n.id).attr('data-pinned', 'true') }))
    function fit() {
      if (!particles.length) return
      const box = el!.getBoundingClientRect(), xs = particles.map(n => n.x ?? 0), ys = particles.map(n => n.y ?? 0)
      const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(1, Math.max(...xs) - minX), h = Math.max(1, Math.max(...ys) - minY)
      if (ring) {
        baseScale = Math.max(80, Math.min(box.width / 2 - 120, box.height / 2 - 65)) / radius
        fitCenter = [0, 0]
        svg.call(camera.transform, zoomIdentity.translate(box.width / 2, box.height / 2).scale(baseScale))
        return
      }
      const paddingX = 65, paddingY = 50
      const k = Math.max(.08, Math.min(1.5, Math.max(1, box.width - 2 * paddingX) / w, Math.max(1, box.height - 2 * paddingY) / h))
      baseScale = k; fitCenter = [minX + w / 2, minY + h / 2]
      svg.call(camera.transform, zoomIdentity.translate(box.width / 2 - (minX + w / 2) * k, box.height / 2 - (minY + h / 2) * k).scale(k))
    }
    async function arrange() {
      const current = ++generation
      job?.cancel(); setLayoutError('')
      el!.setAttribute('data-layout-state', 'running')
      if (ring) { solved = key; paint(); fit(); el!.setAttribute('data-layout-state', 'settled'); return }
      try {
        job = createGraphLayoutJob(solverGraph, props.engine, positions())
        const result = await job.result
        if (disposed || current !== generation) return
        for (const [id, p] of result) { const n = byId.get(id); if (n) { n.x = p.x; n.y = p.y } }
        dragSnapshot = undefined; solved = key; paint(); fit(); el!.setAttribute('data-layout-state', 'settled')
      } catch (error) { if (!disposed && current === generation) { setLayoutError(String(error)); el!.setAttribute('data-layout-state', 'error') } }
    }
    paint()
    if (reusable) { svg.call(camera.transform, transform); el.setAttribute('data-layout-state', 'settled') }
    else { fit(); void arrange() }
    actions.current = { fit, style, zoom: factor => { svg.call(camera.scaleBy, factor) }, restart: () => { nodeEls.attr('data-pinned', null); rollbackDrag(); void arrange() } }
    let width = el.clientWidth, height = el.clientHeight
    const resize = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight
      if (w === width && h === height) return
      svg.call(camera.transform, zoomIdentity.translate(transform.x + (w - width) / 2, transform.y + (h - height) / 2).scale(transform.k))
      width = w; height = h
    })
    resize.observe(el)
    return () => {
      disposed = true; generation++; job?.cancel(); cancelAnimationFrame(frame); clearTimeout(hoverLeave); resize.disconnect()
      views.current.set(props.engine, { positions: positions(), camera: transform, key: solved, baseScale, center: fitCenter })
      nebula.dispose(); svg.on('.zoom', null).on('.clear', null).on('.camera', null); root.remove(); defs.remove()
      actions.current = { fit: () => {}, restart: () => {}, zoom: () => {}, style: () => {} }
    }
  }, [props.graph, props.engine, props.layoutEdges, instanceId])
  useEffect(() => { actions.current.style() }, [props.selected, props.selectedEdge, props.matches, props.sizeMode, dark, bundleFocus])
  return <div className='graph-planar-canvas' data-canvas-theme={dark ? 'dark' : 'light'} data-canvas-view={props.engine === 'ring' ? 'ring' : 'graph'} style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', background: dark ? '#121a25' : '#fafbfd' }}>
    <canvas ref={nebulaRef} aria-hidden='true' style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: .9, pointerEvents: 'none' }} />
    <svg ref={svgRef} aria-label='字段关联图' tabIndex={0} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, touchAction: 'none', userSelect: 'none', cursor: 'grab' }} />
    {layoutError && <p role='alert' style={{ position: 'relative', padding: 12 }}>布局不可用，可切换算法：{layoutError}</p>}
    <GraphCameraTools dark={dark} onToggleDark={props.onToggleDark} onZoom={factor => actions.current.zoom(factor)} onFit={() => actions.current.fit()} onRestart={props.engine !== 'ring' ? () => actions.current.restart() : undefined}>
      {bundleFocus && props.engine === 'ring' && <button onClick={() => { bundleFocusRef.current = ''; setBundleFocus('') }}>返回完整环形图</button>}
    </GraphCameraTools>
  </div>
}
