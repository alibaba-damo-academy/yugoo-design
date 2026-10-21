import { Map as MapIcon, Link2, MousePointerClick, Unlink, Trash2 } from 'lucide-react'
import { ArtifactStatusIcon } from './artifact-status-icon.tsx'
import { sidebarIcon } from './sidebar-icon.tsx'
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ReactFlow, Background, Controls, ConnectionMode, applyNodeChanges, type Node, type ReactFlowInstance } from '@xyflow/react'
import type { ComponentNode, PanelManifest } from './dsl.ts'
import type { RenderOptions } from './interpreter.ts'
import { navigationPreviewLinks, bindNavigationHotspot, unbindNavigationHotspot } from './navigation-map-state.ts'
import { freshRecordId, pathGet, recordsAtPath } from './record-state.ts'
import { navigationFormUpdates, translateNavigationFrame } from './navigation-map-edits.ts'
import { PanelWorkspace, PanelWorkspaceTree, PanelWorkspaceTreeGroup, PanelWorkspaceTreeItem, PanelWorkspaceTreeAdd, PanelWorkspaceCover, PanelWorkspaceCanvasToggle, PanelCanvasToolbar } from './panel-workspace.tsx'
import { RELATION_GRAPH_AUTO_FIT } from './relation-graph-layout.ts'
import { usePanelI18n } from './panel-i18n.tsx'
import { NavigationPreview } from './navigation-preview.tsx'
import { useFlowContainerFit } from './use-flow-container-fit.ts'
import { NavigationRecordNode } from './navigation-record-node.tsx'
import { navigationNodeExecution } from './navigation-node-state.ts'
import { useNavigationStylesheet } from './use-navigation-stylesheet.ts'
import { projectNavigationWorkspace, moveNavigationWorkspaceRecord } from './navigation-workspace-projection.ts'
import { navigationEdge } from './navigation-edge.ts'
import { NavigationFrameNode } from './navigation-frame-node.tsx'
import { centeredNavigationPosition } from './navigation-viewport.ts'
import { canCreateNavigationConnection, newNavigationConnectionLabel } from './navigation-connection.ts'
import { navigationFrameDragPositions, previewNavigationFrameMembers } from './navigation-frame-drag.ts'
import type { PreviewNavigationContext } from './preview-navigation-context.ts'

const types = { 'navigation-frame': NavigationFrameNode, 'navigation-record': NavigationRecordNode }
const point = (value: unknown, fallback: { x: number; y: number }) => value && typeof value === 'object'
  && Number.isFinite((value as { x: number }).x) && Number.isFinite((value as { y: number }).y) ? value as { x: number; y: number } : fallback

/** Host-independent diagram; all canonical ownership comes from explicit bindings. */
export function NavigationWorkspace({ node, manifest, data, options, render, children }: {
  node: ComponentNode; manifest: PanelManifest; data: Record<string, unknown>; options?: RenderOptions
  render: (section: string, id: string, options?: RenderOptions, displayData?: Record<string, unknown>) => ReactElement
  children?: ReactNode
}): ReactElement {
  const { t } = usePanelI18n()
  const binding = node.navigation_map!
  const projection = projectNavigationWorkspace(data, binding,
    manifest.sections.find(section => section.id === binding.frames.path)?.create?.id_field,
    { primary: t('navigationPrimaryGroup'), other: t('navigationOtherGroup'), generic: t('navigationGenericGroup') })
  const { map, displayData } = projection
  const sharedStylesheet = useNavigationStylesheet(binding.stylesheet, options)
  const artifactMode = Boolean(binding.nodes.artifact)
  const [mapOpen, setMapOpen] = useState(() => map.nodes.length > 0)
  const hadPages = useRef(map.nodes.length > 0)
  useEffect(() => {
    if (!hadPages.current && map.nodes.length > 0) setMapOpen(true)
    hadPages.current = map.nodes.length > 0
  }, [map.nodes.length])
  const [selection, setSelection] = useState<{ section: string; id: string } | undefined>(() => artifactMode && map.nodes[0] ? { section: binding.nodes.path, id: map.nodes[0].id } : undefined)
  const [arrival, setArrival] = useState<{ target: string; version: string; read: RenderOptions['readArtifact']; context?: PreviewNavigationContext }>()
  // All sidebar/canvas/form selections are manual and discard prior arrivals.
  const select = (value: typeof selection) => {
    setArrival(undefined); setSelection(value)
    if (artifactMode && value?.section === binding.nodes.path) { setMapOpen(false); setPreview(true) }
  }
  const [nodes, setNodes] = useState<Node[]>([])
  const frameDrag = useRef<{ id: string; token: string; origin: { x: number; y: number }; starts: Record<string, { x: number; y: number }> }>()
  const recordDrag = useRef<{ id: string; token: string }>()
  const [restoreProjection, setRestoreProjection] = useState(0)
  const [flow, setFlow] = useState<ReactFlowInstance>()
  const mapElement = useRef<HTMLDivElement>(null)
  useFlowContainerFit(mapElement, flow)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(artifactMode)
  const [activeEdgeId, setActiveEdgeId] = useState<string>()
  const [bindingPick, setBindingPick] = useState<{ edge: string; source: string; version: string }>()
  const previewVersion = JSON.stringify([binding, options?.skill, options?.sourceRevision, options?.collapseToken, options?.artifactFiles, options?.editable, data[binding.nodes.path], data[binding.edges.path]])
  const arrivalContext = preview && arrival?.version === previewVersion && arrival.read === options?.readArtifact
    && selection?.section === binding.nodes.path && arrival.target === selection.id ? arrival.context : undefined
  useEffect(() => {
    if (arrival && (!preview || arrival.version !== previewVersion || arrival.read !== options?.readArtifact
      || selection?.section !== binding.nodes.path || arrival.target !== selection.id)) setArrival(undefined)
  }, [arrival, preview, previewVersion, options?.readArtifact, selection, binding.nodes.path])
  const activePick = preview && bindingPick?.version === previewVersion && selection?.section === binding.nodes.path
    && selection.id === bindingPick.source ? bindingPick : undefined
  useEffect(() => { if (bindingPick && !activePick) setBindingPick(undefined) }, [bindingPick, activePick])
  const editable = options?.editable === true && !!options.onPanelUpdate
  const latest = useRef({ data, displayData, options, editable, binding })
  latest.current = { data, displayData, options, editable, binding }
  const validConnection = (connection: { source: string | null; target: string | null }) => {
    const live = latest.current
    if (!live.editable) return false
    const source = nodes.find(item => item.id === connection.source)
    const target = nodes.find(item => item.id === connection.target)
    if (!source || !target || source.data.section !== live.binding.nodes.path || target.data.section !== live.binding.nodes.path) return false
    return canCreateNavigationConnection(live.data, live.binding, String(source.data.record), String(target.data.record))
  }
  const commit = (updates: Record<string, unknown>) => {
    if (!editable) return
    try { options!.onPanelUpdate!(navigationFormUpdates(data, binding, updates)); setError('') }
    catch (failure) { setError(String(failure)) }
  }
  const updateFrame = (id: string, patch: Record<string, unknown>) => {
    const live = latest.current
    if (!live.editable) return
    const current = recordsAtPath(live.displayData, live.binding.frames.path)
    if (!Object.hasOwn(current, id)) return
    try {
      live.options!.onPanelUpdate!({ [live.binding.frames.path]: { ...current, [id]: { ...current[id], ...patch } } })
      setError('')
    } catch (failure) { setError(String(failure)) }
  }
  const add = (section: string, values: Record<string, unknown> = {}) => {
    if (!editable) return
    const definition = manifest.sections.find(item => item.id === section), current = recordsAtPath(displayData, section)
    const id = freshRecordId(section, current), identity = definition?.create?.id_field
    const updates: Record<string, unknown> = { [section]: { ...current, [id]: { ...definition?.create?.defaults, ...values, ...(identity ? { [identity]: id } : {}) } } }
    if (definition?.order) {
      const before = pathGet(data, definition.order)
      updates[definition.order] = [...new Set([...(Array.isArray(before) ? before : []), ...Object.keys(current), id])]
    }
    commit(updates)
    if (artifactMode && section === binding.frames.path) { setArrival(undefined); setSelection({ section, id }); setPreview(false) }
    else select({ section, id })
  }
  const removeFrame = (id: string) => {
    const live = latest.current
    if (!live.editable) return
    const current = recordsAtPath(live.displayData, live.binding.frames.path)
    if (!Object.hasOwn(current, id)) return
    const next = { ...current }; delete next[id]
    try {
      live.options!.onPanelUpdate!({ [live.binding.frames.path]: next })
      setError('')
    } catch (failure) { setError(String(failure)) }
  }
  // A new DSL can project the same labels/positions through different fields.
  // Refresh the node callbacks and section identities when those bindings change.
  const fingerprint = JSON.stringify([binding, map, [...projection.positions]])
  const dragToken = JSON.stringify([fingerprint, options?.sourceRevision, options?.collapseToken, editable])
  const currentDragToken = useRef(dragToken)
  currentDragToken.current = dragToken
  useEffect(() => {
    frameDrag.current = undefined
    recordDrag.current = undefined
    setNodes(previous => {
      const old = new Map(previous.map(item => [item.id, item]))
      const frames: Node[] = map.frames.map(frame => {
        const size = frame.size as { width?: number; height?: number } | undefined
        return { ...old.get(`frame:${frame.id}`), id: `frame:${frame.id}`, type: 'navigation-frame', zIndex: 0,
          position: point(frame.position, { x: 0, y: 0 }),
          style: { width: size?.width ?? 500, height: size?.height ?? 300, background: 'var(--ds-fill-2, #f7f7fa)', border: '1px solid var(--ds-divider-default, #ddd)', padding: 12 },
          data: { record: frame.id, section: binding.frames.path, label: frame.label, editable,
            count: Array.isArray(frame.members) ? frame.members.length : 0,
            rename: (value: string) => updateFrame(frame.id, { [binding.frames.label]: value }),
            remove: () => removeFrame(frame.id),
            resize: (box: { x: number; y: number; width: number; height: number }) => updateFrame(frame.id, { [binding.frames.position]: { x: box.x, y: box.y }, [binding.frames.size]: { width: box.width, height: box.height } }) } }
      })
      return [...frames, ...map.nodes.map((item): Node => ({ ...old.get(`node:${item.id}`), id: `node:${item.id}`, type: 'navigation-record', zIndex: 2,
        position: projection.positions.get(item.id) ?? { x: 0, y: 0 },
        data: { record: item.id, section: binding.nodes.path, label: item.label } }))]
    })
  }, [dragToken, restoreProjection])
  const sections = artifactMode ? [binding.nodes.path] : [binding.nodes.path, binding.edges.path, binding.frames.path]
  const livePositions = new Map(nodes.map(item => [item.id, item.position]))
  const orderedIds = (section: string) => section === binding.nodes.path ? map.nodes.map(item => item.id)
    : section === binding.edges.path ? map.edges.map(item => item.id) : map.frames.map(item => item.id)
  const selectedRecord = selection?.section === binding.nodes.path ? recordsAtPath(data, binding.nodes.path)[selection.id] : undefined
  const showingPreview = Boolean(preview && selectedRecord && binding.nodes.artifact && (!artifactMode || !mapOpen))
  const entries = binding.entry_ids ? pathGet(data, binding.entry_ids) : undefined
  const entryIds = Array.isArray(entries) ? entries : []
  useEffect(() => {
    if (artifactMode && !selection && map.nodes[0]) {
      setSelection({ section: binding.nodes.path, id: map.nodes[0].id })
      setPreview(true)
    }
    if (selection && !Object.hasOwn(recordsAtPath(displayData, selection.section), selection.id)) {
      setArrival(undefined)
      setSelection(artifactMode && map.nodes[0] ? { section: binding.nodes.path, id: map.nodes[0].id } : undefined)
      if (artifactMode) {
        setPreview(true)
        if (!map.nodes.length) setMapOpen(true)
      }
    }
  }, [displayData, selection, artifactMode, binding.nodes.path])
  const addFrameAtViewport = () => {
        const canvas = mapElement.current
        if (!editable || !canvas || !flow || showingPreview || (artifactMode && !mapOpen)) return
        const rect = canvas.getBoundingClientRect()
        if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return
        const size = { width: 500, height: 300 }
        add(binding.frames.path, {
          [binding.frames.label]: t('navigationNewGroup', { n: map.frames.length + 1 }),
          [binding.frames.members]: [], [binding.frames.size]: size,
          [binding.frames.position]: centeredNavigationPosition(rect, size,
            position => flow.screenToFlowPosition(position)),
        })
  }
  const mapCanvas = (<div ref={mapElement} className="dsh-navigation-map" style={{ height: '100%', minHeight: 0, ...(artifactMode ? {} : preview && selectedRecord && binding.nodes.artifact ? { display: 'none' } : {}) }}>
        <ReactFlow nodes={nodes.map(item => item.type !== 'navigation-record' ? item : { ...item, data: { ...item.data,
          caption: (binding.nodes.caption_fields ?? []).flatMap(key => {
            const field = manifest.fields.find(field => field.key === key && field.applies_to?.includes(binding.nodes.path))
            const value = recordsAtPath(data, binding.nodes.path)[String(item.data.record)]?.[key]
            if (!field || field.hidden) return []
            return [field.control === 'list' ? `${Array.isArray(value) ? value.length : 0} ${field.label ?? key}` : field.options?.find(option => option.value === value)?.label ?? (typeof value === 'string' ? value : '')]
          }).filter(Boolean).join(' · '),
          entry: entryIds.includes(String(item.data.record)),
          executionStatus: navigationNodeExecution(String(item.data.record), recordsAtPath(data, binding.nodes.path)[String(item.data.record)] ?? {}, binding, options)?.status,
          thumbnail: binding.nodes.artifact ? <NavigationPreview thumbnail
            artifactId={String(item.data.record)} artifactKind={binding.nodes.artifact_kind}
            path={recordsAtPath(data, binding.nodes.path)[String(item.data.record)]?.[binding.nodes.artifact]}
            title={String(item.data.label)} options={options} stylesheet={binding.stylesheet} sharedStylesheet={sharedStylesheet} /> : undefined,
        } })} nodeTypes={types} edges={map.edges.filter(edge => !map.invalidEdges.includes(edge.id)).map(edge => navigationEdge(edge,
          livePositions.get(`node:${edge.source}`) ?? { x: 0, y: 0 },
          livePositions.get(`node:${edge.target}`) ?? { x: 0, y: 0 },
          selection?.section === binding.edges.path && selection.id === edge.id))}
          fitView fitViewOptions={RELATION_GRAPH_AUTO_FIT} minZoom={0.15} maxZoom={2.5} onInit={setFlow} nodesDraggable={editable} nodesConnectable={editable} deleteKeyCode={null}
          elevateNodesOnSelect={false}
          // A visible port can receive a directed link as well as start one.
          // Endpoint rules remain in validConnection, independent of handle type.
          connectionMode={ConnectionMode.Loose}
          zoomOnDoubleClick={!binding.nodes.artifact}
          isValidConnection={validConnection}
          onConnect={connection => {
            if (!validConnection(connection)) return
            const source = nodes.find(item => item.id === connection.source), target = nodes.find(item => item.id === connection.target)
            if (!source || !target || source.data.section !== binding.nodes.path || target.data.section !== binding.nodes.path) return
            const label = newNavigationConnectionLabel(data, binding, String(source.data.record), String(target.data.record))
            add(binding.edges.path, { [binding.edges.source]: source.data.record, [binding.edges.target]: target.data.record,
              ...(label === undefined ? {} : { [binding.edges.label]: label }) })
          }}
          onNodesChange={changes => setNodes(current => applyNodeChanges(changes, current))}
          onNodeClick={(_, item) => {
            if (item.data.section === binding.nodes.path && artifactMode) {
              setArrival(undefined); setSelection({ section: binding.nodes.path, id: String(item.data.record) }); setPreview(true); return
            }
            select({ section: String(item.data.section), id: String(item.data.record) })
          }}
          onNodeDoubleClick={(_, item) => {
            if (item.data.section !== binding.nodes.path || !binding.nodes.artifact) return
            select({ section: binding.nodes.path, id: String(item.data.record) })
            setBindingPick(undefined)
            setPreview(true)
            if (artifactMode) setMapOpen(false)
          }}
          onEdgeClick={(_, edge) => select({ section: binding.edges.path, id: edge.id })}
          onPaneClick={() => { if (!artifactMode) { select(undefined); setPreview(false) } setBindingPick(undefined) }}
          onNodeDragStart={(_, item) => {
            frameDrag.current = undefined
            recordDrag.current = undefined
            if (!latest.current.editable) return
            if (item.type === 'navigation-record' && item.data.section === binding.nodes.path) {
              recordDrag.current = { id: String(item.data.record), token: currentDragToken.current }; return
            }
            if (item.type !== 'navigation-frame' || item.data.section !== binding.frames.path) return
            const frame = map.frames.find(frame => frame.id === item.data.record)
            if (!frame || !Array.isArray(frame.members)) return
            const starts: Record<string, { x: number; y: number }> = Object.fromEntries(frame.members.flatMap(id => {
              const member = nodes.find(node => node.data.section === binding.nodes.path && node.data.record === id)
              return member ? [[id, { ...member.position }]] : []
            }))
            if (frame.members.some(id => !Object.hasOwn(starts, id))) return
            frameDrag.current = { id: String(item.data.record), token: currentDragToken.current,
              origin: { ...point(frame.position, { x: 0, y: 0 }) }, starts }
          }}
          onNodeDrag={(_, item) => {
            const gesture = frameDrag.current
            if (item.type !== 'navigation-frame' || !gesture || gesture.id !== item.data.record || gesture.token !== currentDragToken.current || !latest.current.editable) return
            try {
              const positions = navigationFrameDragPositions(gesture.origin, item.position, gesture.starts)
              setNodes(current => previewNavigationFrameMembers(current, latest.current.binding.nodes.path, positions))
            } catch (failure) {
              frameDrag.current = undefined; setRestoreProjection(value => value + 1); setError(String(failure))
            }
          }}
          onNodeDragStop={(_, item) => {
            if (item.type === 'navigation-frame') {
              const gesture = frameDrag.current
              frameDrag.current = undefined
              const live = latest.current
              if (!gesture || gesture.id !== item.data.record || gesture.token !== currentDragToken.current || !live.editable) {
                setRestoreProjection(value => value + 1); return
              }
              try {
                const updates = translateNavigationFrame(live.displayData, live.binding, gesture.id, item.position, gesture.starts, gesture.origin)
                live.options!.onPanelUpdate!(navigationFormUpdates(live.data, live.binding, updates))
                setError('')
              } catch (failure) { setRestoreProjection(value => value + 1); setError(String(failure)) }
            }
            else {
              const gesture = recordDrag.current
              recordDrag.current = undefined
              const live = latest.current
              if (item.type !== 'navigation-record' || item.data.section !== live.binding.nodes.path
                || !gesture || gesture.id !== item.data.record || gesture.token !== currentDragToken.current || !live.editable) {
                setRestoreProjection(value => value + 1); return
              }
              try {
                live.options!.onPanelUpdate!(moveNavigationWorkspaceRecord(live.data, live.binding, projection,
                  String(item.data.record), item.position,
                  { width: item.measured?.width ?? 320, height: item.measured?.height ?? 228 }))
              } catch (failure) { setRestoreProjection(value => value + 1); setError(String(failure)) }
            }
          }}><Background /><Controls showInteractive={false} fitViewOptions={RELATION_GRAPH_AUTO_FIT} /></ReactFlow>
      </div>)
  const edgeLabelField = manifest.fields?.find(field => field.key === binding.edges.label && field.applies_to?.includes(binding.edges.path))
  const selectedEdge = selection?.section === binding.edges.path ? map.edges.find(edge => edge.id === selection.id) : undefined
  const outgoing = selectedRecord && selection ? map.edges.filter(edge => edge.source === selection.id && !map.invalidEdges.includes(edge.id)) : []
  const activeEdge = outgoing.find(edge => edge.id === activeEdgeId) ?? outgoing[0]
  const hasHotspot = activeEdge && binding.edges.hotspot && recordsAtPath(data, binding.edges.path)[activeEdge.id]?.[binding.edges.hotspot]
  const entryAction = selectedRecord && selection && binding.entry_ids ? <button type="button" className="dsh-navigation-entry"
    disabled={!editable || (entryIds.includes(selection.id) && entryIds.length === 1)}
    title={entryIds.includes(selection.id) && entryIds.length === 1 ? t('navigationLastEntry') : undefined}
    onClick={() => commit({ [binding.entry_ids!]: entryIds.includes(selection.id) ? entryIds.filter(id => id !== selection.id) : [...new Set([...entryIds, selection.id])] })}>
    {t(entryIds.includes(selection.id) ? 'navigationUnsetEntry' : 'navigationSetEntry')}</button> : null
  const previewActions = <>{binding.edges.hotspot && activeEdge ? <div className="dsh-navigation-binding-controls">
    <Link2 aria-hidden="true" size={16} />
    <select aria-label={t('navigationSelectConnection')} disabled={!editable} value={activeEdge.id}
      onChange={event => { setActiveEdgeId(event.target.value); setBindingPick(undefined) }}>
      {outgoing.map(edge => <option key={edge.id} value={edge.id}>{edge.label} → {String(recordsAtPath(data, binding.nodes.path)[edge.target]?.[binding.nodes.label] ?? edge.target)}</option>)}
    </select>
    <button type="button" disabled={!editable} aria-pressed={activePick?.edge === activeEdge.id}
      onClick={() => setBindingPick(activePick?.edge === activeEdge.id ? undefined : { edge: activeEdge.id, source: activeEdge.source, version: previewVersion })}>
      <MousePointerClick size={16} aria-hidden="true" />{t(activePick?.edge === activeEdge.id ? 'cancel' : hasHotspot ? 'navigationRepick' : 'bindHotspot')}
    </button>
    {hasHotspot ? <button type="button" disabled={!editable} aria-label={t('unbindHotspot')} title={t('unbindHotspot')} onClick={() => {
      try { commit(unbindNavigationHotspot(latest.current.data, binding, activeEdge.id)); setBindingPick(undefined) }
      catch (failure) { setError(String(failure)) }
    }}><Unlink size={16} aria-hidden="true" /></button> : null}
  </div> : null}{entryAction}</>
  const workspace = <PanelWorkspace guidance={node.guidance} className={artifactMode ? "dsh-navigation-frame dsh-navigation-artifact" : "dsh-navigation-frame"} autoSaveId={`navigation:${node.id}`} sidebar={<PanelWorkspaceTree icon={sidebarIcon(node.sidebar_icon)} title={artifactMode ? manifest.sections.find(item => item.id === binding.nodes.path)?.title ?? node.title ?? '' : node.title ?? ''}>
    {artifactMode ? map.nodes.map(item => {
      const status = navigationNodeExecution(item.id, recordsAtPath(data, binding.nodes.path)[item.id] ?? {}, binding, options)?.status ?? 'pending'
      return <PanelWorkspaceTreeItem key={item.id} ariaLabel={String(item.label)} selected={selection?.section === binding.nodes.path && selection.id === item.id}
        trailing={<>{entryIds.includes(item.id) ? <span className="dsh-navigation-entry-badge">{t('navigationEntry')}</span> : null}
          <ArtifactStatusIcon status={status} label={t(`artifact_${status}`)} /></>}
        onSelect={() => select({ section: binding.nodes.path, id: item.id })}>{String(item.label)}</PanelWorkspaceTreeItem>
    }) : sections.map(section => <PanelWorkspaceTreeGroup key={section} label={manifest.sections.find(item => item.id === section)?.title ?? section}
      expanded={!collapsed[section]} onToggle={() => setCollapsed(current => ({ ...current, [section]: !current[section] }))}>
      {orderedIds(section).map(id => <PanelWorkspaceTreeItem key={id}
        selected={selection?.section === section && selection.id === id} onSelect={() => select({ section, id })}>
        {String(recordsAtPath(displayData, section)[id]?.[section === binding.nodes.path ? binding.nodes.label : section === binding.edges.path ? binding.edges.label : binding.frames.label] ?? id)}
      </PanelWorkspaceTreeItem>)}
      {editable && section !== binding.edges.path ? <PanelWorkspaceTreeAdd
        disabled={section === binding.frames.path && (!flow || showingPreview)} onAdd={() => {
        if (section !== binding.frames.path) { add(section); return }
        addFrameAtViewport()
      }}>{t('addItem', { item: manifest.sections.find(item => item.id === section)?.title ?? section })}</PanelWorkspaceTreeAdd> : null}
    </PanelWorkspaceTreeGroup>)}
    {artifactMode ? <PanelWorkspaceCanvasToggle className="dsh-navigation-map-toggle" label={t('mindMap')} expanded={mapOpen} onOpen={() => { setArrival(undefined); setMapOpen(true) }} /> : null}
  </PanelWorkspaceTree>}>
    <div className="dsh-navigation-workspace" style={artifactMode ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } : undefined}>
      {preview && selectedRecord && binding.nodes.artifact ? <div style={{ flex: 1, minHeight: 0, order: 2 }}><NavigationPreview
        artifactId={selection!.id} artifactKind={binding.nodes.artifact_kind}
        titleBadge={artifactMode && entryIds.includes(selection!.id) ? <span className="dsh-navigation-entry-badge">{t('navigationEntry')}</span> : undefined}
        actions={artifactMode ? previewActions : undefined}
        stylesheet={binding.stylesheet} sharedStylesheet={sharedStylesheet}
        path={selectedRecord[binding.nodes.artifact]} title={String(selectedRecord[binding.nodes.label] ?? selection!.id)} options={options}
        links={navigationPreviewLinks(data, binding, selection!.id)}
        navigationContext={arrivalContext} onNavigationError={setError} onNavigationReset={() => setArrival(undefined)} documentVersion={previewVersion}
        binding={activePick?.edge}
        onBind={(element, label) => {
          if (!activePick || !latest.current.editable) return
          try {
            const live = latest.current
            const version = JSON.stringify([live.binding, live.options?.skill, live.options?.sourceRevision, live.options?.collapseToken, live.options?.artifactFiles, live.options?.editable, live.data[binding.nodes.path], live.data[binding.edges.path]])
            if (version !== activePick.version) return
            commit(bindNavigationHotspot(live.data, binding, activePick.source, activePick.edge, element, label))
            setBindingPick(undefined)
          } catch (failure) { setError(String(failure)) }
        }}
        onNavigate={(id, navigation) => {
          const live = latest.current
          const version = JSON.stringify([live.binding, live.options?.skill, live.options?.sourceRevision, live.options?.collapseToken, live.options?.artifactFiles, live.options?.editable, live.data[binding.nodes.path], live.data[binding.edges.path]])
          if (version !== previewVersion || live.options?.readArtifact !== options?.readArtifact) return
          // Re-resolve the edge against live host state, never accept a frame payload.
          const edge = navigationPreviewLinks(live.data, live.binding, selection!.id).find(item => item.id === navigation.id)
          if (!edge || edge.target !== id || edge.contextError || !Object.hasOwn(recordsAtPath(live.data, live.binding.nodes.path), id)) return
          setError('')
          setArrival({ target: id, version, read: live.options?.readArtifact, context: edge.context })
          setSelection({ section: live.binding.nodes.path, id })
        }} /></div> : null}
      {!artifactMode ? mapCanvas : null}
      {artifactMode ? <>{error ? <p role="alert">{error}</p> : null}{activePick ? <div className="dsh-navigation-binding-hint" role="status">{t('pickHotspot')}</div> : null}
        {!selectedRecord ? <div className="dsh-navigation-detail-header"><p role="status">{node.description ?? t('emptyFilter')}</p></div> : null}</> : <aside className="dsh-navigation-inspector">{error ? <p role="alert">{error}</p> : null}
        {children}
        <div className="dsh-navigation-actions">
        {selectedRecord && selection && binding.entry_ids ? <label className="dsh-navigation-entry">
          <input type="checkbox" checked={entryIds.includes(selection.id)}
            disabled={!editable || (entryIds.includes(selection.id) && entryIds.length === 1)}
            onChange={event => commit({ [binding.entry_ids!]: event.target.checked
              ? [...new Set([...entryIds, selection.id])] : entryIds.filter(id => id !== selection.id) })} />
          {t('navigationEntry')}
        </label> : null}
        {editable && binding.edges.hotspot && selection?.section === binding.edges.path && !map.invalidEdges.includes(selection.id) ?
          <button type="button" onClick={() => {
            const edge = map.edges.find(item => item.id === selection.id)
            if (!edge) return
            select({ section: binding.nodes.path, id: edge.source }); setPreview(true)
            setBindingPick({ edge: edge.id, source: edge.source, version: previewVersion })
          }}>{t('bindHotspot')}</button> : null}
        {activePick ? <div role="status">{t('pickHotspot')}<button type="button" onClick={() => setBindingPick(undefined)}>{t('cancel')}</button></div> : null}
        {editable && binding.edges.hotspot && selection?.section === binding.edges.path
          && recordsAtPath(data, binding.edges.path)[selection.id]?.[binding.edges.hotspot] ?
          <button type="button" onClick={() => {
            try { commit(unbindNavigationHotspot(latest.current.data, binding, selection.id)); setBindingPick(undefined) }
            catch (failure) { setError(String(failure)) }
          }}>{t('unbindHotspot')}</button> : null}
        {selectedRecord && binding.nodes.artifact ? <button type="button" aria-expanded={artifactMode ? mapOpen : undefined} aria-pressed={artifactMode ? undefined : preview} onClick={() => { if (artifactMode) { setArrival(undefined); setMapOpen(true) } else setPreview(value => !value) }}>{t(artifactMode ? 'mindMap' : 'preview')}</button> : null}
        </div>
        {map.invalidEdges.length ? <p role="alert">{t('navigationInvalidEdges', { ids: map.invalidEdges.join(', ') })}</p> : null}
        {selection ? render(selection.section, selection.id, { ...options, onPanelUpdate: commit }, displayData) : node.description}</aside>}
    </div>
  </PanelWorkspace>
  return artifactMode ? <PanelWorkspaceCover keepCoverMounted active={mapOpen} label={t('mindMap')} onClose={() => {
    setMapOpen(false)
    if (selection?.section !== binding.nodes.path && map.nodes[0]) select({ section: binding.nodes.path, id: map.nodes[0].id })
  }} cover={<div className="dsh-navigation-map-cover">
    <PanelCanvasToolbar title={<><MapIcon size={16} aria-hidden="true" />{node.title ?? t('mindMap')}</>}
      counts={<><span>{map.nodes.length} {manifest.sections.find(item => item.id === binding.nodes.path)?.title}</span>
        <span>{map.edges.length} {manifest.sections.find(item => item.id === binding.edges.path)?.title}</span></>}>
      {editable && manifest.sections.find(item => item.id === binding.frames.path)?.add_mode !== 'none' ? <button type="button" disabled={!flow || !mapOpen} onClick={addFrameAtViewport}>{t('addItem', { item: manifest.sections.find(item => item.id === binding.frames.path)?.title ?? binding.frames.path })}</button> : null}
    </PanelCanvasToolbar>
    {children ? <div className="dsh-navigation-map-spec">{children}</div> : null}
    {map.invalidEdges.length ? <p role="alert">{t('navigationInvalidEdges', { ids: map.invalidEdges.join(', ') })}</p> : null}
    <div className="dsh-navigation-map-stage">{mapCanvas}
      {selectedEdge ? <aside className="dsh-navigation-connection-editor">
        <header><strong>{String(recordsAtPath(data, binding.nodes.path)[selectedEdge.source]?.[binding.nodes.label] ?? selectedEdge.source)} → {String(recordsAtPath(data, binding.nodes.path)[selectedEdge.target]?.[binding.nodes.label] ?? selectedEdge.target)}</strong>
          <button type="button" disabled={!editable} aria-label={t('remove', { item: selectedEdge.label })} onClick={() => {
            const records = { ...recordsAtPath(data, binding.edges.path) }; delete records[selectedEdge.id]
            const order = pathGet(data, binding.edges.order)
            commit({ [binding.edges.path]: records, ...(Array.isArray(order) ? { [binding.edges.order]: order.filter(id => id !== selectedEdge.id) } : {}) })
          }}><Trash2 size={16} aria-hidden="true" /></button>
        </header>
        <label>{edgeLabelField?.label ?? t('navigationSelectConnection')}
          <input disabled={!editable || !edgeLabelField || edgeLabelField.readonly || edgeLabelField.hidden} value={selectedEdge.label} onChange={event => {
            if (!editable || !edgeLabelField || edgeLabelField.readonly || edgeLabelField.hidden) return
            const records = recordsAtPath(data, binding.edges.path)
            commit({ [binding.edges.path]: { ...records, [selectedEdge.id]: { ...records[selectedEdge.id], [binding.edges.label]: event.target.value } } })
          }} />
        </label>
      </aside> : null}
    </div>
  </div>}>{workspace}</PanelWorkspaceCover> : workspace
}
