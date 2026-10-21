import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { ReactFlow, Background, Controls, BaseEdge, EdgeLabelRenderer, ConnectionMode, MarkerType, applyNodeChanges,
  type Node, type NodeProps, type EdgeProps, type NodeChange, type ReactFlowInstance } from '@xyflow/react'
import type { ComponentNode, PanelManifest, SidebarIcon } from './dsl.ts'
import { displayValue, isRecordValue, type RecordMap } from './visual-records.ts'
import { referenceHubProjection, hubRecordFacts, HUB_NODE_WIDTH, type HubNode } from './reference-hub.ts'
import { referenceNodeKey } from './reference-graph.ts'
import { sidebarIcon } from './sidebar-icon.tsx'
import { PanelCanvasHandles, PanelCanvasToolbar, PanelDisclosureIcon } from './panel-workspace.tsx'
import { usePanelI18n } from './panel-i18n.tsx'
import { useFlowContainerFit } from './use-flow-container-fit.ts'
import { RELATION_GRAPH_AUTO_FIT } from './relation-graph-layout.ts'
import { Brain, FileText, MapPin, Sparkles, Wrench } from 'lucide-react'
import { RecordPortrait } from './record-portrait.tsx'

type Selection = { section: string; record: string }
const HubSelectionContext = createContext<((value: Selection) => void) | undefined>(undefined)
type CardData = HubNode & { icon?: SidebarIcon; kind: string; focus: boolean; active: boolean; muted: boolean; empty: string
  portrait: boolean; alternate: boolean; sectionLabel: string; consumers: string; valueLabel: string; anatomyLabel: string
  capabilities: Array<{ zone: string; label: string; count: number }> }
function ProductPosition({ card, showUnknown = false }: { card: HubNode; showUnknown?: boolean }): ReactElement | null {
  const { t } = usePanelI18n()
  const first = card.captions[0]
  return first || showUnknown ? <div className="ygd-reference-hub-card-entry" title={first ? card.captions.map(item => `${item.title} · ${item.description || t('hubPositionUnknown')}`).join('\n') : t('hubPositionUnknown')}>
    <MapPin size={14} aria-hidden="true" /><span>{first?.description || (showUnknown ? t('hubPositionUnknown') : first?.title)}</span>
    {card.captions.length > 1 ? <small>+{card.captions.length - 1}</small> : null}
  </div> : null
}
function HubCard({ data }: NodeProps): ReactElement {
  const card = data as unknown as CardData
  const select = useContext(HubSelectionContext)
  const anatomyCore = card.portrait && card.focus && card.zone === 'center'
  return <div className={`ygd-reference-hub-card is-${card.zone}${card.members ? ' is-resource-list' : ''}${card.alternate ? ' is-kind-alternate' : ''}${card.active ? ' is-active' : ''}${card.muted ? ' is-muted' : ''}`}
    style={{ width: card.width, height: card.height }}>
    <PanelCanvasHandles isConnectable={false} />
    {card.members ? <>
      <div className="ygd-reference-hub-resource-heading"><span className="ygd-reference-hub-symbol">{sidebarIcon(card.icon)}</span>
        <strong>{card.name}</strong><small>{card.members.length}</small></div>
      <div className="ygd-reference-hub-resource-list nodrag nowheel">
        {card.members.map(member => <button type="button" className="ygd-reference-hub-resource-item" key={member.id} title={member.name}
          aria-pressed={Boolean(data.selectedMember === member.id)}
          onClick={event => { event.stopPropagation(); select?.({ section: member.section, record: member.record }) }}>
          <span>{member.name}</span>
          {member.description ? <small title={member.description}>{member.description}</small> : null}
        </button>)}
      </div>
    </> : anatomyCore ? <div className="ygd-reference-hub-core">
      <span className="ygd-reference-hub-symbol"><Brain aria-hidden="true" /></span>
      <small>{card.anatomyLabel}</small><strong title={card.value}>{card.value || card.empty}</strong>
    </div> : <>
      <div className="ygd-reference-hub-card-title">
        {card.portrait && card.zone === 'center' ? <RecordPortrait identity={card.id} />
          : <span className="ygd-reference-hub-symbol">{sidebarIcon(card.icon)}</span>}
        <div><small>{card.anatomyLabel || (card.zone === 'center' ? card.sectionLabel : card.kind || card.sectionLabel)}</small><strong title={card.name}>{card.name}</strong></div>
      </div>
      {card.description && !(card.portrait && card.focus) ? <p title={card.description}>{card.description}</p> : null}
      {card.zone === 'center' ? <div className="ygd-reference-hub-card-foot">
        <span className="ygd-reference-hub-model"><Brain size={16} aria-hidden="true" /><span title={card.value}>{card.value || card.empty}</span></span>
        {card.portrait && card.capabilities.length ? <div className="ygd-reference-hub-capabilities">{card.capabilities.map(item => <span key={item.zone}>
          {item.zone === 'left' ? <Sparkles size={14} aria-hidden="true" /> : <Wrench size={14} aria-hidden="true" />}{item.label}<small>{item.count}</small>
        </span>)}</div> : null}
        <ProductPosition card={card} showUnknown={card.portrait} />
      </div> : <small className="ygd-reference-hub-consumers">{card.consumers}</small>}
    </>}
  </div>
}
function HubGroup({ data }: NodeProps): ReactElement {
  const role = data.role as HubNode | undefined
  return role ? <div className="ygd-reference-hub-role-heading"><RecordPortrait identity={role.id} />
    <div><strong>{role.name}</strong><p>{role.description}</p><ProductPosition card={role} showUnknown /></div>
  </div>
    : <div className="ygd-reference-hub-group-label">{String(data.label ?? '')}{data.count ? ` · ${data.count}` : ''}</div>
}
function HubColumnLabel({ data }: NodeProps): ReactElement {
  return <span className="ygd-reference-hub-column-label">{String(data.label)}</span>
}
function HubEdge(props: EdgeProps): ReactElement {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props
  const rail = typeof props.data?.rail === 'number' ? props.data.rail : undefined
  const horizontal = props.sourcePosition === 'left' || props.sourcePosition === 'right'
  const bend = horizontal ? (sx + tx) / 2 : (sy + ty) / 2
  const loop = props.source === props.target
  const path = loop ? `M ${sx} ${sy} H ${sx + 56} V ${ty + 48} H ${tx} V ${ty}` : rail !== undefined ? `M ${sx} ${sy} V ${rail} H ${tx} V ${ty}`
    : horizontal ? `M ${sx} ${sy} H ${bend} V ${ty} H ${tx}` : `M ${sx} ${sy} V ${bend} H ${tx} V ${ty}`
  const x = loop ? sx + 56 : rail !== undefined || !horizontal ? (sx + tx) / 2 : bend
  const y = loop ? ty + 48 : rail ?? (horizontal ? (sy + ty) / 2 : bend)
  return <><BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} />
    {props.label ? <EdgeLabelRenderer><span className="ygd-reference-hub-edge-label" style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px)` }}>{props.label}</span></EdgeLabelRenderer> : null}</>
}
const nodeTypes = { hubCard: HubCard, hubGroup: HubGroup, hubColumnLabel: HubColumnLabel }
const edgeTypes = { hubLink: HubEdge }

/** A read-only view over ordinary records. Detail actions return to the existing
 * form and save pipeline; neither navigation nor layout writes Design Files. */
export function ReferenceHub(props: { node: ComponentNode; manifest: PanelManifest;
  read: (source: string) => RecordMap; readRecord?: (source: string) => RecordMap; selected?: Selection; select: (value: Selection) => void; showDetails?: () => void }): ReactElement {
  const { t } = usePanelI18n()
  const [focus, setFocus] = useState<string>()
  const [resources, setResources] = useState(true)
  const [connections, setConnections] = useState(true)
  const [highlight, setHighlight] = useState(true)
  const [flow, setFlow] = useState<ReactFlowInstance>()
  const [nodes, setNodes] = useState<Node[]>([])
  const canvas = useRef<HTMLDivElement>(null)
  const refs = props.node.references!, layout = refs.layout!
  const portraits = layout.center_presentation === 'portrait'
  const sectionLabel = (source: string) => props.manifest.sections.find(section => section.id === source)?.title ?? source
  const valueLabel = props.manifest.fields.find(field => 'key' in field && field.key === layout.value_field && field.applies_to?.includes(layout.center))?.label ?? t('hubModel')
  const projection = referenceHubProjection(refs, props.read,
    source => props.manifest.sections.find(section => section.id === source)?.title ?? source, focus, props.readRecord)
  const selectedKey = props.selected && referenceNodeKey(props.selected.section, props.selected.record)
  const selected = projection.all.find(node => node.id === selectedKey)
  useEffect(() => setHighlight(true), [selectedKey])
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Measurements/handle bounds are React Flow's transient view state. Dropping
    // dimension changes resets same-size nodes without another observer delivery.
    setNodes(current => applyNodeChanges(changes, current))
    const selection = changes.find(change => change.type === 'select' && change.selected)
    if (!selection || !('id' in selection) || selection.id === selectedKey) return
    const owner = projection.owners[selection.id]
    if (owner) { setHighlight(true); props.select(owner) }
  }, [selectedKey, props.select, projection.owners])
  const neighbors = new Set(projection.allEdges.filter(edge => edge.source === selectedKey || edge.target === selectedKey)
    .flatMap(edge => [edge.source, edge.target]))
  const iconOf = (node: HubNode) => {
    const binding = refs.nodes.find(binding => binding.source === node.section)
    const kind = binding?.kind_field && props.read(node.section)[node.record]?.[binding.kind_field]
    return typeof kind === 'string' && binding?.kind_icons && Object.hasOwn(binding.kind_icons, kind)
      ? binding.kind_icons[kind] : binding?.icon
  }
  const cards = projection.nodes.map(node => ({ id: node.id, type: 'hubCard', position: { x: node.x, y: node.y },
    data: { ...node, icon: iconOf(node),
      portrait: portraits, sectionLabel: sectionLabel(node.section), valueLabel,
      anatomyLabel: portraits && projection.focus && node.zone === 'center' ? t('hubOwnModel') : '',
      alternate: (() => { const binding = refs.nodes.find(binding => binding.source === node.section)
        const kind = binding?.kind_field && props.read(node.section)[node.record]?.[binding.kind_field]
        const options = props.manifest.fields.find(field => field.key === binding?.kind_field && field.applies_to?.includes(node.section))?.options
        return Boolean(options && options.findIndex(option => option.value === kind) % 2 === 1) })(),
      consumers: t('hubConsumers', { count: new Set(projection.allEdges.filter(edge => edge.source === node.id || edge.target === node.id)
        .flatMap(edge => [edge.source, edge.target]).filter(id => projection.owners[id]?.section === layout.center)).size }),
      capabilities: (['left', 'right'] as const).flatMap(zone => {
        const count = projection.all.filter(item => item.section === layout[zone] && projection.allEdges.some(edge => (edge.source === node.id && edge.target === item.id) || (edge.target === node.id && edge.source === item.id))).length
        return count ? [{ zone, label: sectionLabel(layout[zone]!), count }] : []
      }),
      focus: Boolean(projection.focus),
      kind: (() => { const binding = refs.nodes.find(binding => binding.source === node.section); return binding?.kind_field
        ? displayValue(props.manifest, node.section, binding.kind_field, props.read(node.section)[node.record]?.[binding.kind_field]) : '' })(),
      selectedMember: highlight ? selectedKey : undefined,
      active: highlight && (node.id === selectedKey || Boolean(node.members?.some(member => member.id === selectedKey))),
      muted: Boolean(highlight && selected && node.id !== selectedKey && !neighbors.has(node.id)
        && !node.members?.some(member => member.id === selectedKey || neighbors.has(member.id))), empty: t('hubUnspecified') },
    ariaLabel: node.name, selected: highlight && node.id === selectedKey, selectable: !node.members, focusable: !node.members,
    draggable: false, connectable: false, deletable: false }))
  const groups = projection.groups.map(group => ({ id: `group:${group.id}`, type: 'hubGroup', position: { x: group.x, y: group.y },
    data: { label: group.label || t('hubUnassigned'), role: group.role,
      count: group.role ? undefined : projection.nodes.filter(node => node.zone === 'center' && node.x >= group.x && node.x < group.x + group.width).length },
    className: group.role ? 'is-role-frame' : undefined, style: { width: group.width, height: group.height },
    draggable: false, connectable: false, selectable: false, focusable: false, zIndex: -1 }))
  // These are transient annotations, not canonical graph records. Keep them
  // above the edge layer so a reference cannot strike through a column title.
  const columnLabels = projection.groups.flatMap(group => (group.columns ?? []).map(column => ({
    id: `column:${group.id}:${column.zone}`, type: 'hubColumnLabel',
    position: { x: group.x + column.x - HUB_NODE_WIDTH / 2, y: group.y + column.y },
    data: { label: column.zone === 'center' ? t('hubBrain') : sectionLabel(layout[column.zone]!) },
    style: { width: HUB_NODE_WIDTH, height: 18, pointerEvents: 'none' as const },
    draggable: false, connectable: false, selectable: false, focusable: false, deletable: false, zIndex: 1,
  })))
  const projectedNodes = [...groups, ...cards, ...columnLabels]
  const nodeSignature = JSON.stringify(projectedNodes)
  useEffect(() => {
    setNodes(current => {
      const previous = new Map(current.map(node => [node.id, node]))
      // As in the ordinary relation/navigation canvases, refresh authored data
      // and positions while retaining measured dimensions for surviving IDs.
      return projectedNodes.map(node => ({ ...previous.get(node.id), ...node }))
    })
  }, [nodeSignature])
  let lane = 0
  const edges = projection.edges.flatMap(edge => {
    const source = projection.nodes.find(node => node.id === edge.source)!, target = projection.nodes.find(node => node.id === edge.target)!
    const collaboration = source.zone === 'center' && target.zone === 'center'
    if (collaboration ? !connections : !resources) return []
    const horizontal = ['left', 'right'].includes(source.zone) || ['left', 'right'].includes(target.zone)
    const sourceHandle = edge.source === edge.target ? 'right' : collaboration ? 'top' : horizontal ? (source.x < target.x ? 'right' : 'left') : source.y < target.y ? 'bottom' : 'top'
    const targetHandle = edge.source === edge.target ? 'bottom' : collaboration ? 'top' : horizontal ? (source.x < target.x ? 'left' : 'right') : source.y < target.y ? 'top' : 'bottom'
    const selectedEndpoint = (node: HubNode) => node.id === selectedKey || node.members?.some(member => member.id === selectedKey)
    const muted = highlight && selected && !selectedEndpoint(source) && !selectedEndpoint(target)
    return [{ ...edge, label: portraits && !collaboration ? undefined : edge.label,
      type: 'hubLink', sourceHandle, targetHandle, selectable: false, focusable: false, deletable: false,
      data: { rail: collaboration ? Math.min(source.y, target.y) - 64 - lane++ * 32 : undefined },
      style: { stroke: collaboration ? 'var(--ds-brand-6, #7c5af6)' : 'var(--ds-text-tertiary, #9695a1)', strokeWidth: 1.4,
        strokeDasharray: collaboration ? undefined : '5 4', opacity: muted ? .22 : 1 },
      markerEnd: collaboration ? { type: MarkerType.ArrowClosed, color: 'var(--ds-brand-6, #7c5af6)' } : undefined }]
  })
  const geometry = JSON.stringify([projection.focus, projection.nodes.map(node => [node.id, node.x, node.y, node.height])])
  useFlowContainerFit(canvas, flow)
  useEffect(() => { if (!flow) return; const id = requestAnimationFrame(() => { void flow.fitView(RELATION_GRAPH_AUTO_FIT) }); return () => cancelAnimationFrame(id) }, [flow, geometry])
  const openDetails = () => { if (selected) { props.select({ section: selected.section, record: selected.record }); props.showDetails?.() } }
  const facts = (field: string, row: Record<string, unknown>, excluded: string[] = []) => hubRecordFacts(
    props.manifest.fields.find(candidate => candidate.key === field && candidate.applies_to?.includes(layout.center))?.item_fields ?? [],
    row, excluded, (section, record) => projection.all.find(node => node.id === referenceNodeKey(section, record))?.name ?? record)
  const renderFacts = (rows: ReturnType<typeof hubRecordFacts>) => rows.length ? <dl className="ygd-reference-hub-facts">
    {rows.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl> : null
  const collaborationRows = selected ? refs.links.filter(link => link.source === layout.center && link.target === layout.center && link.item_field)
    .flatMap(link => Object.entries(props.read(layout.center)).flatMap(([owner, value]) => {
      const rows = value[link.field]
      return isRecordValue(rows) ? Object.entries(rows).flatMap(([id, row]) => isRecordValue(row) && (owner === selected.record || row[link.item_field!] === selected.record)
        ? [{ id: `${owner}:${link.field}:${id}`, owner, field: link.field, row }] : []) : []
    })) : []
  const sideResources = (['left', 'right'] as const).map(zone => ({ zone,
    label: sectionLabel(layout[zone]!), count: projection.all.filter(node => node.zone === zone && neighbors.has(node.id)).length }))
  const selectRecord = (value: Selection) => { setHighlight(true); props.select(value) }
  return <HubSelectionContext.Provider value={selectRecord}><div className={`ygd-reference-hub${portraits && projection.focus ? ' is-focus-portrait' : ''}`}>
    <PanelCanvasToolbar title={props.node.title || t('relationGraph')} counts={t('graphCounts', {nodes: cards.length, edges: edges.length})}>
      <button type="button" aria-pressed={!projection.focus} onClick={() => setFocus(undefined)}>{t('hubOverview')}</button>
      <button type="button" aria-pressed={Boolean(projection.focus)} disabled={selected?.zone !== 'center'} onClick={() => setFocus(selected?.record)}>{t('hubFocus')}</button>
      <button type="button" aria-pressed={resources} onClick={() => setResources(value => !value)}>{t('hubResources')}</button>
      {!projection.focus ? <button type="button" aria-pressed={connections} onClick={() => setConnections(value => !value)}>{t('hubConnections')}</button> : null}
      <button type="button" disabled={!highlight} onClick={() => setHighlight(false)}>{t('hubClearHighlight')}</button>
    </PanelCanvasToolbar>
    {projection.missing.length ? <div className="dsh-relation-issues" role="alert">{projection.missing.map((item, index) => <button key={index} type="button" onClick={() => { props.select(item); props.showDetails?.() }}>{item.field}: {item.id} ⚠</button>)}</div> : null}
    <div className="ygd-reference-hub-body">
      <div className="ygd-reference-hub-canvas" ref={canvas}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onInit={setFlow} connectionMode={ConnectionMode.Loose} nodesDraggable={false} nodesConnectable={false}
        deleteKeyCode={null} multiSelectionKeyCode={null} onNodesChange={onNodesChange}
        ariaLabelConfig={{ 'node.a11yDescription.default': t('hubKeyboard'), 'node.a11yDescription.keyboardDisabled': t('hubKeyboard'),
          'controls.zoomIn.ariaLabel': t('zoomIn'), 'controls.zoomOut.ariaLabel': t('zoomOut'), 'controls.fitView.ariaLabel': t('fitAll') }}
        onNodeClick={(_event, node) => { const owner = projection.owners[node.id]; if (owner) { setHighlight(true); props.select(owner) } }}
        onNodeDoubleClick={(_event, node) => { const owner = projection.owners[node.id]; if (owner?.section === layout.center) { props.select(owner); setFocus(owner.record) } }}
        fitView fitViewOptions={RELATION_GRAPH_AUTO_FIT} minZoom={.15} maxZoom={2.5}>
        <Background gap={24} size={1} /><Controls showInteractive={false} />
      </ReactFlow></div>
      <aside className={`ygd-reference-hub-detail${portraits ? ' is-compact' : ''}`}>
        {selected && portraits ? <>
          <div className="ygd-reference-hub-compact-heading">
            {selected.zone === 'center' ? <RecordPortrait identity={selected.id} /> : sidebarIcon(iconOf(selected))}
            <div><small>{selected.zone === 'center' ? t('hubRoleProfile') : sectionLabel(selected.section)}</small><h3 title={selected.name}>{selected.name}</h3></div>
          </div>
          <div className="ygd-reference-hub-compact-actions">
            {selected.zone === 'center' ? <button type="button" className="ygd-reference-hub-profile-action"
              aria-expanded={projection.focus === selected.record}
              onClick={() => setFocus(projection.focus === selected.record ? undefined : selected.record)}>
              {t(projection.focus === selected.record ? 'hubReturnOverview' : 'hubExpandRole')}
            </button> : null}
            {props.showDetails ? <button type="button" className="ygd-reference-hub-detail-action" onClick={openDetails}>
              <FileText size={16} aria-hidden="true" />{t('recordDetails')}</button> : null}
          </div>
          {selected.description ? <p className="ygd-reference-hub-brief" title={selected.description}>{selected.description}</p> : null}
          {selected.zone === 'center' ? <>
            {selected.value ? <section className="ygd-reference-hub-detail-section"><h4>{valueLabel}</h4>
              <p className="ygd-reference-hub-brief" title={selected.value}>{selected.value}</p></section> : null}
            <section className="ygd-reference-hub-detail-section"><h4>{t('hubProductEntries')}</h4>
              {!selected.captions.length ? <p>{t('hubPositionUnknown')}</p> : null}
              {selected.captions.slice(0, 2).map(entry => <div className="ygd-reference-hub-entry" key={`${selected.id}:${entry.record}`}>
                <strong title={entry.title}>{entry.title}</strong>
                <span className="ygd-reference-hub-entry-position" title={entry.description}>{entry.description || t('hubPositionUnknown')}</span>
              </div>)}
              {selected.captions.length > 2 ? <small className="ygd-reference-hub-overflow-count">+{selected.captions.length - 2}</small> : null}
            </section>
            {sideResources.some(item => item.count) ? <section className="ygd-reference-hub-detail-section"><h4>{t('hubSharedResources')}</h4>
              <div className="ygd-reference-hub-resource-counts">{sideResources.filter(item => item.count).map(item => <span key={item.zone}>
                {item.zone === 'left' ? <Sparkles size={14} aria-hidden="true" /> : <Wrench size={14} aria-hidden="true" />}
                {item.label}<small>{item.count}</small></span>)}</div></section> : null}
          </> : <section className="ygd-reference-hub-detail-section"><h4>{t('hubUsedBy')}</h4>
            <div className="ygd-reference-hub-neighbors">{projection.all.filter(node => node.zone === 'center' && neighbors.has(node.id)).slice(0, 3).map(node =>
              <button type="button" key={node.id} onClick={() => { selectRecord({ section: node.section, record: node.record }); if (projection.focus) setFocus(node.record) }}>
                <span>{node.name}{selected.zone === 'top' ? <small className="ygd-reference-hub-consumer-model">{node.value || t('hubUnspecified')}</small> : null}</span>
              </button>)}</div>
            {projection.all.filter(node => node.zone === 'center' && neighbors.has(node.id)).length > 3 ? <small className="ygd-reference-hub-overflow-count">
              +{projection.all.filter(node => node.zone === 'center' && neighbors.has(node.id)).length - 3}</small> : null}
          </section>}
        </> : selected ? <><div className="ygd-reference-hub-profile-heading">
          <small>{selected.zone === 'center' && portraits ? t('hubRoleProfile') : sectionLabel(selected.section)}</small>
          {selected.zone === 'center' && portraits ? <RecordPortrait identity={selected.id} /> : null}
          <h3>{selected.zone !== 'center' || !portraits ? sidebarIcon(iconOf(selected)) : null}{selected.name}</h3>
        </div>
          {selected.description ? <p>{selected.description}</p> : null}
          {selected.zone === 'center' ? <button type="button" className="ygd-reference-hub-profile-action"
            aria-expanded={projection.focus === selected.record}
            onClick={() => setFocus(projection.focus === selected.record ? undefined : selected.record)}>
            {t(projection.focus === selected.record ? 'hubReturnOverview' : 'hubExpandRole')}
          </button> : null}
          {selected.captions.length || (portraits && selected.zone === 'center') ? <section className="ygd-reference-hub-detail-section"><h4>{t('hubProductEntries')}</h4>
            {!selected.captions.length ? <p>{t('hubPositionUnknown')}</p> : null}
            {selected.captions.map(entry => {
              const entries = layout.entries && props.read(selected.section)[selected.record]?.[layout.entries.field]
              const row = isRecordValue(entries) && entries[entry.record]
              const entryFacts = isRecordValue(row) && layout.entries
                ? facts(layout.entries.field, row, [layout.entries.title_field, layout.entries.description_field]) : []
              const summary = <span className="dsh-panel-disclosure-label"><strong>{entry.title}</strong>
                <span className="ygd-reference-hub-entry-position">{entry.description || t('hubPositionUnknown')}</span></span>
              return entryFacts.length ? <details className="ygd-reference-hub-entry" key={`${selected.id}:${entry.record}`}>
                <summary className="dsh-panel-disclosure">{summary}<PanelDisclosureIcon expanded={false} /></summary>
                {renderFacts(entryFacts)}
              </details> : <div className="ygd-reference-hub-entry" key={`${selected.id}:${entry.record}`}>{summary}</div>
            })}
          </section> : null}
          {selected.zone === 'center' && portraits ? <section className="ygd-reference-hub-detail-section"><h4>{t('hubModel')}</h4>
            <div className="ygd-reference-hub-detail-model"><Brain size={16} aria-hidden="true" /><div><small>{valueLabel}</small><p>{selected.value || t('hubUnspecified')}</p></div></div>
            <div className="ygd-reference-hub-neighbors">{projection.all.filter(node => node.zone === 'top' && neighbors.has(node.id)).map(node => <button type="button" key={node.id}
              onClick={() => props.select({section: node.section, record: node.record})}>{sidebarIcon(iconOf(node))}{node.name}</button>)}</div>
          </section> : selected.value ? <p>{selected.value}</p> : null}
          {([false, true] as const).map(collaboration => {
            const items = projection.all.filter(node => node.id !== selectedKey && neighbors.has(node.id) && (node.zone === 'center') === collaboration
              && !(selected.zone === 'center' && node.zone === 'top'))
            return items.length ? <section key={String(collaboration)} className="ygd-reference-hub-detail-section"><h4>{selected.zone !== 'center' ? t('hubUsedBy') : collaboration ? t('hubCollaborators') : t('hubSharedResources')}</h4>
              <div className="ygd-reference-hub-neighbors">{items.map(node => <button type="button" key={node.id} onClick={() => { setHighlight(true); props.select({ section: node.section, record: node.record }); if (projection.focus && node.zone === 'center') setFocus(node.record) }}>
                {sidebarIcon(iconOf(node))}<span>{node.name}
                  {portraits && selected.zone === 'top' && node.zone === 'center' ? <small className="ygd-reference-hub-consumer-model">{node.value || t('hubUnspecified')}</small> : null}
                </span>
              </button>)}</div>
            </section> : null
          })}
          {selected.zone === 'center' && collaborationRows.length ? <section className="ygd-reference-hub-detail-section">
            <h4>{t('hubHandoffDetails')}</h4>{collaborationRows.map(item => <details className="ygd-reference-hub-handoff" key={item.id}>
              <summary>{item.owner === selected.record ? t('hubOutgoing') : t('hubIncoming')} · {
                (item.owner !== selected.record ? projection.all.find(node => node.section === layout.center && node.record === item.owner)?.name
                  : facts(item.field, item.row).find(row => row.key === refs.links.find(link => link.field === item.field)?.item_field)?.value)
                  || t('hubExternalParty')}</summary>
              {item.owner !== selected.record ? <p>{projection.all.find(node => node.section === layout.center && node.record === item.owner)?.name}</p> : null}
              {renderFacts(facts(item.field, item.row))}
            </details>)}
          </section> : null}
          {props.showDetails ? <button type="button" className="ygd-reference-hub-detail-action" onClick={openDetails}>{t('recordDetails')}</button> : null}
        </> : <p>{t('hubSelect')}</p>}
      </aside>
    </div>
  </div></HubSelectionContext.Provider>
}
