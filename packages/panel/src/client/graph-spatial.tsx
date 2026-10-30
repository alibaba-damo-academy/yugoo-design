import React, { useEffect, useRef, useState } from 'react'
import type { ForceGraph3DInstance, NodeObject, LinkObject } from '3d-force-graph'
import type * as Three from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { GraphCanvasProps } from './graph-canvas.js'
import { nodeRadius, type GraphNode, type GraphEdge } from './graph-model.js'
import { placeLabels, graphLabelRanks, shortGraphLabel } from './graph-labels.js'
import { createGraphLayoutJob } from './graph-layout-client.js'
import { createGraphNebula } from './graph-nebula.js'
import { GraphCameraTools, graphAmbientColors, graphSourceColors, graphDarkSourceColors, type GraphCanvasTheme } from './graph-canvas-presentation.js'

type Node = NodeObject & GraphNode
type Link = LinkObject<Node> & GraphEdge
type Graph = ForceGraph3DInstance<Node, Link>

/** Owned 3D view of the same KAG, without experimental DOM globals or graph writes. */
export function SpatialGraphCanvas(props: GraphCanvasProps & GraphCanvasTheme & { engine: string }) {
  const host = useRef<HTMLDivElement>(null), labels = useRef<HTMLDivElement>(null), nebulaRef = useRef<HTMLCanvasElement>(null), latest = useRef(props)
  const actions = useRef({ fit: (_all?: boolean) => {}, zoom: (_factor: number) => {}, pause: (_value: boolean) => {}, projection: (_value: boolean) => {}, restart: () => {}, style: () => {} })
  const [error, setError] = useState(''), [paused, setPaused] = useState(false), [orthographic, setOrthographic] = useState(false)
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0)
  const projection = useRef(false)
  latest.current = props
  useEffect(() => {
    const mount = host.current!, layer = labels.current!
    const nebula = createGraphNebula(nebulaRef.current!)
    let disposed = false, cleaned = false, frame = 0, resize: ResizeObserver | undefined, graph: Graph | undefined, controls: OrbitControls | undefined
    let stressJob: ReturnType<typeof createGraphLayoutJob> | undefined
    let removeEvents = () => {}
    const resources: { dispose(): void }[] = []
    const cleanup = () => {
      if (cleaned) return
      cleaned = true; stressJob?.cancel(); cancelAnimationFrame(frame); resize?.disconnect(); removeEvents(); controls?.dispose()
      actions.current = { fit: () => {}, zoom: () => {}, pause: () => {}, projection: () => {}, restart: () => {}, style: () => {} }
      const renderer = graph?.renderer()
      graph?.pauseAnimation(); graph?._destructor()
      for (const resource of resources) resource.dispose()
      renderer?.dispose(); renderer?.forceContextLoss(); nebula.dispose(); mount.replaceChildren(); layer.replaceChildren()
    }
    setError(''); setPaused(false); setLoading(true); mount.dataset.layoutState = 'loading'
    mount.dataset.layoutTicks = '0'; delete mount.dataset.lastPinned
    void Promise.all([import('3d-force-graph'), import('three'), import('three/examples/jsm/controls/OrbitControls.js')]).then(async ([{ default: ForceGraph3D }, THREE, { OrbitControls }]) => {
      if (disposed) return
      const nodes: Node[] = props.graph.nodes.map(n => ({ ...n }))
      const links: Link[] = props.graph.edges.map(e => ({ ...e, source: e.from, target: e.to }))
      const labelRanks = graphLabelRanks(props.graph)
      let hovered = ''
      stressJob = createGraphLayoutJob({ ...props.graph, edges: props.layoutEdges ?? props.graph.edges }, props.engine, new Map())
      const coordinates = await stressJob.result
      if (disposed) return
      for (const node of nodes) {
        const raw = coordinates.get(node.id)!
        const point = { x: raw.x * .2, y: raw.y * .2, z: (raw.z ?? 0) * .2 }
        Object.assign(node, point, { fx: point.x, fy: point.y, fz: point.z })
      }
      mount.dataset.stressDepth = String(Math.max(0, ...nodes.map(n => n.z!)) - Math.min(0, ...nodes.map(n => n.z!)))
      const owners = [...new Set([...Object.keys(props.sourceLabels ?? {}), ...nodes.map(n => n.owner)])].sort()
      const ownerIndex = (owner: string) => Math.max(0, owners.indexOf(owner)) % graphSourceColors.length
      const color = (owner: string) => (latest.current.dark ? graphDarkSourceColors : graphSourceColors)[ownerIndex(owner)]
      const objects = new Map<string, Three.Mesh>(), edgeObjects = new Map<string, Three.Line>()
      let dirty = true, lastLabels = 0, stopped = false, fitted = false, pausedAnimation = false
      const changed = () => { dirty = true }
      let ticks = 0
      const engineTick = () => { dirty = true; mount.dataset.layoutTicks = String(++ticks) }
      graph = new ForceGraph3D(mount, { controlType: 'orbit', rendererConfig: { antialias: true, alpha: true } }) as unknown as Graph
      const native = graph
      native.backgroundColor('rgba(0,0,0,0)').showNavInfo(false).forceEngine('d3').enableNodeDrag(false)
        .width(mount.clientWidth).height(mount.clientHeight).warmupTicks(0).cooldownTicks(1).cooldownTime(6000)
        .nodeLabel(n => { const el = document.createElement('span'); el.textContent = n.label; return el })
        .linkLabel(e => { const el = document.createElement('span'); el.textContent = e.label; return el })
        .nodeThreeObject(n => {
          const geometry = new THREE.SphereGeometry(1, 12, 8)
          const material = new THREE.MeshBasicMaterial({ color: color(n.owner), transparent: true })
          const object = new THREE.Mesh(geometry, material)
          resources.push(geometry, material); objects.set(n.id, object); return object
        })
        .linkThreeObject(e => {
          const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
          const material = e.kind === 'contains' ? new THREE.LineDashedMaterial({ color: '#9aa6b5', transparent: true, opacity: .5, dashSize: 4, gapSize: 3 }) : new THREE.LineBasicMaterial({ color: '#8291ac', transparent: true, opacity: .8 })
          const object = new THREE.Line(geometry, material)
          resources.push(geometry, material); edgeObjects.set(e.id, object); return object
        })
        .linkPositionUpdate((object, { start, end }) => {
          const line = object as Three.Line, positions = line.geometry.attributes.position as Three.BufferAttribute
          positions.setXYZ(0, start.x, start.y, start.z); positions.setXYZ(1, end.x, end.y, end.z); positions.needsUpdate = true
          line.computeLineDistances(); line.geometry.computeBoundingSphere(); return true
        })
        .onNodeClick(n => latest.current.onNode(n.id)).onLinkClick(e => latest.current.onEdge(e.id))
        .onNodeHover(n => { hovered = n?.id ?? ''; style() })
        .onBackgroundClick(() => latest.current.onClear())
        .onEngineTick(engineTick)
        .onEngineStop(() => { if (!disposed) { stopped = true; mount.dataset.layoutState = 'settled'; if (!fitted) { fitted = true; fit() }; style() } })
      const ortho = new THREE.OrthographicCamera(-500, 500, 500, -500, .1, 100000)
      controls = new OrbitControls(ortho, native.renderer().domElement); controls.enabled = false
      controls.enableDamping = true; controls.dampingFactor = .12
      const orbit = controls
      const nativeControls = native.controls() as OrbitControls
      const renderPass = native.postProcessingComposer().passes.find(p => 'camera' in p) as unknown as { camera: Three.Camera } | undefined
      if (!renderPass) throw new Error('3D renderer lacks a camera pass')
      const camera = () => projection.current ? ortho : native.camera()
      const point = new THREE.Vector3(), measure = document.createElement('canvas').getContext('2d')!
      const densityCenter = new THREE.Box3().setFromPoints(nodes.map(n => new THREE.Vector3(n.x!, n.y!, n.z!))).getCenter(new THREE.Vector3())
      let densityKey = '', baseSpan = 1
      const viewportSpan = () => projection.current ? (ortho.top - ortho.bottom) / ortho.zoom : 2 * native.camera().position.distanceTo(nativeControls.target) * Math.tan((native.camera() as Three.PerspectiveCamera).fov * Math.PI / 360)
      measure.font = '12px system-ui'
      function fit(all = false) {
        const adjacent = new Map(nodes.map(node => [node.id, new Set<string>()]))
        for (const edge of links) { adjacent.get(edge.from)?.add(edge.to); adjacent.get(edge.to)?.add(edge.from) }
        const visited = new Set<string>(); let largest: string[] = []
        for (const node of nodes) if (!visited.has(node.id)) {
          const group = [node.id]; visited.add(node.id)
          for (let index = 0; index < group.length; index++) for (const id of adjacent.get(group[index]) ?? []) if (!visited.has(id)) { visited.add(id); group.push(id) }
          if (group.length > largest.length) largest = group
        }
        const chosen = new Set(!all && largest.length > 1 ? largest : nodes.map(node => node.id))
        const positions = nodes.filter(node => chosen.has(node.id)).map(node => new THREE.Vector3(node.x!, node.y!, node.z!))
        if (!positions.length) return
        const bounds = new THREE.Box3().setFromPoints(positions), center = bounds.getCenter(new THREE.Vector3()), radius = Math.max(20, ...positions.map(point => point.distanceTo(center))) * 1.18
        const aspect = mount.clientWidth / Math.max(1, mount.clientHeight)
        if (projection.current) {
          const direction = ortho.position.clone().sub(orbit.target).normalize(); if (!direction.lengthSq()) direction.set(0, 0, 1)
          ortho.top = radius * Math.max(1, 1 / aspect); ortho.bottom = -ortho.top; ortho.right = ortho.top * aspect; ortho.left = -ortho.right; ortho.zoom = 1
          ortho.position.copy(center).addScaledVector(direction, radius * 4); orbit.target.copy(center); ortho.updateProjectionMatrix(); orbit.update()
        } else {
          const perspective = native.camera() as Three.PerspectiveCamera
          const half = Math.min(perspective.fov * Math.PI / 360, Math.atan(Math.tan(perspective.fov * Math.PI / 360) * aspect))
          const direction = perspective.position.clone().sub(nativeControls.target).normalize(); if (!direction.lengthSq()) direction.set(0, 0, 1)
          native.cameraPosition(center.clone().addScaledVector(direction, radius / Math.sin(half)), center, 0)
        }
        baseSpan = viewportSpan()
        mount.dataset.framing = all ? 'all' : 'main'; mount.dataset.framedNodes = String(chosen.size); dirty = true
      }
      function zoom(factor: number) {
        if (projection.current) { ortho.zoom = Math.max(.05, Math.min(100, ortho.zoom * factor)); ortho.updateProjectionMatrix(); orbit.update() }
        else {
          const position = native.camera().position.clone().sub(nativeControls.target).divideScalar(factor).add(nativeControls.target)
          native.cameraPosition(position, nativeControls.target, 0)
        }
        dirty = true
      }
      function project(value: boolean) {
        projection.current = value
        if (value) { ortho.position.copy(native.camera().position); ortho.quaternion.copy(native.camera().quaternion); orbit.target.copy(nativeControls.target) }
        renderPass!.camera = camera(); native.enableNavigationControls(!value).enablePointerInteraction(!value).enableNodeDrag(false); orbit.enabled = value
        mount.dataset.projection = value ? 'orthographic' : 'perspective'; fit(); dirty = true
      }
      function style() {
        const { selected, selectedEdge, matches, dark } = latest.current
        const focus = selected || hovered
        const neighbors = new Set(links.flatMap(e => e.from === focus ? [e.to] : e.to === focus ? [e.from] : []))
        for (const n of nodes) {
          const object = objects.get(n.id)
          if (object) {
            const material = object.material as Three.MeshBasicMaterial
            material.color.set(n.id === selected ? dark ? '#c1b1ff' : '#6758b8' : color(n.owner))
            material.opacity = n.id === focus || n.id === hovered || matches?.has(n.id) || neighbors.has(n.id) ? 1 : focus || matches ? .12 : 1
          }
        }
        for (const e of links) {
          const material = edgeObjects.get(e.id)?.material as Three.LineBasicMaterial | undefined
          if (material) { material.color.set(e.id === selectedEdge ? dark ? '#c1b1ff' : '#6758b8' : dark ? '#aabbd4' : '#8291ac'); material.opacity = e.id === selectedEdge ? 1 : focus && e.from !== focus && e.to !== focus ? .08 : e.kind === 'contains' ? .5 : .8 }
        }
        dirty = true
      }
      const labelButtons = new Map<string, HTMLButtonElement>()
      function drawLabels() {
        const width = mount.clientWidth, height = mount.clientHeight, { selected, selectedEdge, matches, dark } = latest.current
        if (!width || !height) return
        camera().updateMatrixWorld()
        for (const node of nodes) {
          const object = objects.get(node.id); if (!object) continue
          const pixels = latest.current.sizeMode === 'uniform' ? (node.record ? 5 : 3) : Math.max(3, Math.min(16, nodeRadius(node, latest.current.reach)))
          object.getWorldPosition(point).applyMatrix4(camera().matrixWorldInverse)
          const units = projection.current ? (ortho.top - ortho.bottom) / ortho.zoom / height : 2 * Math.max(.1, -point.z) * Math.tan((native.camera() as Three.PerspectiveCamera).fov * Math.PI / 360) / height
          object.scale.setScalar(pixels * units)
        }
        const projected = nodes.filter(n => objects.has(n.id)).map(n => {
          objects.get(n.id)!.getWorldPosition(point).project(camera())
          return { n, id: n.id, x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, depth: point.z }
        }).filter(p => p.depth > -1 && p.depth < 1)
        // Project the same source density through the active camera. This is a
        // background field, not additional 3D geometry or knowledge relations.
        const density = projected.filter(p => p.x > -180 && p.x < width + 180 && p.y > -180 && p.y < height + 180)
        point.copy(densityCenter).project(camera())
        const panX = point.x * width / 2, panY = -point.y * height / 2, scale = baseSpan / Math.max(.01, viewportSpan())
        const nextDensityKey = JSON.stringify([width, height, dark, Boolean(selected || selectedEdge), panX, panY, scale, density.map(p => [p.id, p.x, p.y])])
        if (densityKey !== nextDensityKey) {
          densityKey = nextDensityKey
          nebula.paint(density.map(p => ({ x: p.x, y: p.y, color: graphAmbientColors[ownerIndex(p.n.owner)] })), { width, height, panX, panY, zoom: scale, dark, focused: Boolean(selected || selectedEdge) })
        }
        const visible = projected.filter(p => p.x > 0 && p.x < width && p.y > 0 && p.y < height && ((objects.get(p.id)?.material as Three.Material | undefined)?.opacity ?? 1) > .5)
        const obstacles = visible.map(p => ({ x: p.x - 5, y: p.y - 5, w: 10, h: 10 }))
        const focus = selected || hovered
        const neighbors = new Set(links.flatMap(e => e.id === selectedEdge ? [e.from, e.to] : e.from === focus ? [e.to] : e.to === focus ? [e.from] : []))
        const detailed = (id: string) => id === focus || id === hovered || neighbors.has(id) || Boolean(matches?.has(id))
        const candidates = visible.sort((a, b) => Number(b.id === focus || b.id === hovered) - Number(a.id === focus || a.id === hovered) || Number(detailed(b.id)) - Number(detailed(a.id)) || labelRanks.get(a.id)! - labelRanks.get(b.id)!)
        const items = candidates.map(p => {
          const text = shortGraphLabel(p.n, detailed(p.id), latest.current.contentCounts?.get(p.id))
          return { ...p, text, w: measure.measureText(text).width + 12, h: 24 }
        })
        const placed: ReturnType<typeof placeLabels<(typeof items)[number]>> = []
        const fieldLabels = new Map<string, number>(), fieldBudget = Math.max(1, Math.min(3, Math.floor(scale)))
        for (const item of items) {
          const preview = !item.n.record && !detailed(item.id), owner = item.n.recordId ?? item.id
          if (preview && (fieldLabels.get(owner) ?? 0) >= fieldBudget) continue
          const next = placeLabels([item], obstacles, width, height)[0]
          if (!next) continue
          placed.push(next); obstacles.push({ x: next.box.x - 4, y: next.box.y - 5, w: next.box.w + 8, h: next.box.h + 10 })
          if (preview) fieldLabels.set(owner, (fieldLabels.get(owner) ?? 0) + 1)
        }
        mount.dataset.visibleNodes = String(visible.length); mount.dataset.labelCount = String(placed.length)
        const shown = new Set(placed.map(p => p.id))
        for (const [id, button] of labelButtons) if (!shown.has(id)) { button.remove(); labelButtons.delete(id) }
        for (const p of placed) {
          let button = labelButtons.get(p.id)
          if (!button) {
            button = document.createElement('button'); button.type = 'button'
            button.onclick = () => latest.current.onNode(p.id)
            button.onfocus = () => { hovered = p.id; style() }
            button.onblur = () => { hovered = ''; style() }
            labelButtons.set(p.id, button); layer.append(button)
          }
          button.textContent = p.text; button.title = p.n.label; button.setAttribute('aria-label', p.n.label)
          button.dataset.nodeId = p.id; button.dataset.nodeX = String(p.x); button.dataset.nodeY = String(p.y)
          const preview = !p.n.record && !detailed(p.id)
          button.dataset.labelTier = detailed(p.id) ? 'detail' : p.n.record ? 'record' : 'preview'
          button.style.cssText = `position:absolute;left:${p.box.x}px;top:${p.box.y}px;width:${p.box.w}px;height:24px;min-height:0;padding:3px 5px;border:0;font:${p.n.record ? '500' : '400'} ${preview ? '11' : '12'}px/18px system-ui;white-space:nowrap;background:${dark ? '#121a25df' : '#fafbfdeb'};color:${dark ? '#dce3ee' : '#253145'};opacity:${preview ? .72 : 1};pointer-events:auto;overflow:hidden`
        }
      }
      function tick(time: number) {
        if (disposed) return
        if (!document.hidden) {
          if (projection.current) orbit.update()
          if (dirty && time - lastLabels > 100) {
            dirty = false; lastLabels = time; drawLabels()
            // Pausing animation must not freeze explicit camera/theme actions.
            if (pausedAnimation) native.postProcessingComposer().render()
          }
        }
        frame = requestAnimationFrame(tick)
      }
      let start = { x: 0, y: 0, button: -1 }, dragging: Node | undefined, moved = false
      const dragPlane = new THREE.Plane(), offset = new THREE.Vector3()
      const pointerRay = (event: PointerEvent) => {
        const box = mount.getBoundingClientRect(), ray = new THREE.Raycaster()
        ray.setFromCamera(new THREE.Vector2((event.clientX - box.x) / box.width * 2 - 1, 1 - (event.clientY - box.y) / box.height * 2), camera())
        return ray
      }
      const down = (event: PointerEvent) => {
        start = { x: event.clientX, y: event.clientY, button: event.button }; if (event.button !== 0) return
        const ray = pointerRay(event), hit = ray.intersectObjects([...objects.values()], false)[0]
        const id = hit && [...objects].find(([, object]) => object === hit.object)?.[0]
        dragging = nodes.find(node => node.id === id); moved = false
        if (!dragging) return
        event.stopImmediatePropagation(); nativeControls.enabled = false; orbit.enabled = false
        const center = new THREE.Vector3(dragging.x!, dragging.y!, dragging.z!)
        dragPlane.setFromNormalAndCoplanarPoint(camera().getWorldDirection(new THREE.Vector3()), center)
        const point = ray.ray.intersectPlane(dragPlane, new THREE.Vector3())
        offset.copy(center).sub(point ?? center); (event.target as HTMLElement).setPointerCapture(event.pointerId)
      }
      const move = (event: PointerEvent) => {
        if (!dragging) return
        const point = pointerRay(event).ray.intersectPlane(dragPlane, new THREE.Vector3()); if (!point) return
        point.add(offset); moved ||= Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3
        Object.assign(dragging, { x: point.x, y: point.y, z: point.z, fx: point.x, fy: point.y, fz: point.z })
        native.d3ReheatSimulation(); fitted = true; dirty = true; event.stopImmediatePropagation()
      }
      const finishDrag = (event: PointerEvent) => {
        if (!dragging) return
        mount.dataset.lastPinned = dragging.id
        if (!moved) latest.current.onNode(dragging.id)
        dragging = undefined; nativeControls.enabled = !projection.current; orbit.enabled = projection.current
        start.button = -1; event.stopImmediatePropagation(); dirty = true
      }
      const up = (e: PointerEvent) => {
        if (!projection.current || start.button !== 0 || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return
        const box = mount.getBoundingClientRect(), ray = new THREE.Raycaster(); ray.params.Line.threshold = 3
        ray.setFromCamera(new THREE.Vector2((e.clientX - box.x) / box.width * 2 - 1, 1 - (e.clientY - box.y) / box.height * 2), ortho)
        const hit = ray.intersectObjects([...objects.values()], false)[0]
        const nodeId = hit && [...objects].find(([, object]) => object === hit.object)?.[0]
        if (nodeId) { latest.current.onNode(nodeId); return }
        const line = ray.intersectObjects([...edgeObjects.values()], false)[0]
        const edgeId = line && [...edgeObjects].find(([, object]) => object === line.object)?.[0]
        if (edgeId) latest.current.onEdge(edgeId); else latest.current.onClear()
      }
      const visibility = () => { if (document.hidden || pausedAnimation) native.pauseAnimation(); else native.resumeAnimation(); dirty = true }
      nativeControls.addEventListener('change', changed); orbit.addEventListener('change', changed)
      const canvas = native.renderer().domElement
      canvas.addEventListener('pointerdown', down, true); canvas.addEventListener('pointermove', move, true); canvas.addEventListener('pointerup', finishDrag, true); canvas.addEventListener('pointercancel', finishDrag, true); canvas.addEventListener('pointerup', up)
      document.addEventListener('visibilitychange', visibility)
      removeEvents = () => { nativeControls.removeEventListener('change', changed); orbit.removeEventListener('change', changed); canvas.removeEventListener('pointerdown', down, true); canvas.removeEventListener('pointermove', move, true); canvas.removeEventListener('pointerup', finishDrag, true); canvas.removeEventListener('pointercancel', finishDrag, true); canvas.removeEventListener('pointerup', up); document.removeEventListener('visibilitychange', visibility) }
      native.renderer().setPixelRatio(Math.min(window.devicePixelRatio, 2))
      actions.current = { fit, zoom, style, projection: project, restart: () => setRevision(value => value + 1), pause: value => { pausedAnimation = value; visibility(); mount.dataset.layoutState = value ? 'paused' : stopped ? 'settled' : 'running' } }
      native.graphData({ nodes, links }); project(projection.current); style(); mount.dataset.layoutState = 'running'
      resize = new ResizeObserver(() => { native.width(mount.clientWidth).height(mount.clientHeight); if (projection.current) fit(); dirty = true }); resize.observe(mount)
      frame = requestAnimationFrame(tick)
      setLoading(false)
    }).catch(reason => { if (!disposed) { cleanup(); setLoading(false); setError(String(reason)); mount.dataset.layoutState = 'error' } })
    return () => { disposed = true; cleanup(); actions.current = { fit: () => {}, zoom: () => {}, pause: () => {}, projection: () => {}, restart: () => {}, style: () => {} } }
  }, [props.graph, props.engine, props.layoutEdges, revision])
  useEffect(() => { actions.current.style() }, [props.selected, props.selectedEdge, props.matches, props.sizeMode, props.dark])
  return <div className='graph-spatial-canvas' data-canvas-theme={props.dark ? 'dark' : 'light'} style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', background: props.dark ? '#121a25' : '#fafbfd' }}>
    <canvas ref={nebulaRef} aria-hidden='true' style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: .9, pointerEvents: 'none' }} />
    <div ref={host} aria-label='三维关联图' style={{ position: 'absolute', inset: 0 }} />
    <div ref={labels} aria-label='三维图谱标签' style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }} />
    {error && <p role='alert' style={{ position: 'relative', padding: 12 }}>3D 不可用，可切回 2D：{error}</p>}
    <GraphCameraTools dark={props.dark} onToggleDark={props.onToggleDark} disabled={loading || Boolean(error)} onFit={() => actions.current.fit(true)} onZoom={factor => actions.current.zoom(factor)} onRestart={() => actions.current.restart()}>
      <details className='graph-popover'>
        <summary>3D 选项</summary>
        <div className='graph-popover-body'>
          <label>三维投影<select disabled={loading || Boolean(error)} aria-label='三维投影' value={orthographic ? 'orthographic' : 'perspective'} onChange={e => { const value = e.target.value === 'orthographic'; setOrthographic(value); actions.current.projection(value) }}><option value='perspective'>透视 · 近大远小</option><option value='orthographic'>正交 · 大小可比</option></select></label>
          <button disabled={loading || Boolean(error)} onClick={() => actions.current.fit()}>聚焦主体</button>
          <button disabled={loading || Boolean(error)} onClick={() => { actions.current.pause(!paused); setPaused(!paused) }}>{paused ? '继续动画' : '暂停动画'}</button>
          <p>拖动画布旋转 · 右键拖动平移 · 滚轮缩放</p>
        </div>
      </details>
    </GraphCameraTools>
  </div>
}
