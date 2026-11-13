import { Fragment, useCallback, useEffect, useId, useMemo, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { sidebarIcon } from './sidebar-icon.tsx'
import remarkGfm from 'remark-gfm'
import { ChevronRight, Filter } from 'lucide-react'
import { ReactFlow, Background, Controls, ConnectionMode, applyNodeChanges, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import type { ComponentNode, PanelManifest } from './dsl.ts'
import { fieldsForSection, fieldIsVisible, fieldValuesOf, recordIdentityOf, recordsAtPath, sectionBindingOf, orderedRecordIds, pathGet, type DesignData } from './record-state.ts'
import type { RenderOptions } from './interpreter.ts'
import { insertVisualRecord } from './visual-components.tsx'
import { PanelContentGroup, PanelRecordId, PanelRecordHeader, PanelEditableTitle, PanelFieldCaption, PanelWorkspace, PanelWorkspaceTree, PanelWorkspaceTreeRecord, PanelWorkspaceTreeItem, PanelWorkspaceTreeAdd, PanelWorkspaceCover, PanelWorkspaceCanvasToggle, PanelDetailDisclosure, PanelCanvasHandles, PanelCanvasToolbar, PanelCollectionCount } from './panel-workspace.tsx'
import { RELATION_GRAPH_AUTO_FIT } from './relation-graph-layout.ts'
import { useFlowContainerFit } from './use-flow-container-fit.ts'
import { RecordRequestDialog } from './record-request-dialog.tsx'
import { usePanelI18n } from './panel-i18n.tsx'
import { canvasAriaLabels } from './canvas-i18n.ts'
import { PanelSelect } from './panel-select.tsx'
import { RecordFacts } from './record-facts.tsx'
import type { EditorField } from './dsl.ts'
import { PanelTextarea } from './panel-textarea.tsx'

/** View projection only: groups are labels, never newly persisted entities. */
export function boardGroups(records: Record<string, Record<string, unknown>>, binding: NonNullable<ComponentNode['board']>, filter: 'active' | 'rejected' | 'all', ungrouped: string, editing?: { id: string; group: string }) {
  const groups = new Map<string, [string, Record<string, unknown>][]>()
  for (const [id, record] of Object.entries(records)) {
    const rejected = binding.rejected ? record[binding.rejected] === true : false
    if ((filter === 'active' && rejected) || (filter === 'rejected' && !rejected)) continue
    const group = !binding.group ? '' : editing?.id === id ? editing.group : typeof record[binding.group] === 'string' && String(record[binding.group]).trim() ? String(record[binding.group]) : ungrouped
    groups.set(group, [...(groups.get(group) ?? []), [id, record]])
  }
  return groups
}

/** Native horizontal mind-map geometry. React Flow measurements are view state,
 * not facts: wrapped branch labels reserve their real height before neighbours. */
export function boardMapProjection(groups: Map<string, [string, Record<string, unknown>][]>, binding: NonNullable<ComponentNode['board']>, label: string,
  measured: ReadonlyMap<string, { height?: number }> = new Map()) {
  const nodes: Node[] = [], edges: { id: string; source: string; target: string; ariaLabel: string }[] = []
  const height = (id: string) => Math.max(42, measured.get(id)?.height ?? 42)
  const centers: number[] = []
  let top = 0
  for (const [name, records] of groups) {
    const group = `group:${centers.length}`
    const leafHeight = records.reduce((sum, [id]) => sum + height(`record:${id}`), 0) + Math.max(0, records.length - 1) * 12
    const span = Math.max(leafHeight, binding.group ? height(group) : 0)
    const center = top + span / 2
    centers.push(center)
    if (binding.group) nodes.push({ id: group, type: 'board', position: { x: 300, y: center - height(group) / 2 }, data: { label: name, branch: true, rejected: !!binding.rejected && records.every(([, record]) => record[binding.rejected!] === true) } })
    if (binding.group) edges.push({ id: `root:${group}`, source: 'root', target: group, ariaLabel: `${label} → ${name}` })
    let leafTop = top + (span - leafHeight) / 2
    for (const [id, record] of records) {
      const leaf = `record:${id}`
      nodes.push({ id: leaf, type: 'board', position: { x: binding.group ? 600 : 300, y: leafTop }, data: {
        label: String(record[binding.label] || id), record: id, description: String(record[binding.description] ?? ''),
        badge: binding.badge ? record[binding.badge] : undefined, rejected: !!binding.rejected && record[binding.rejected] === true,
      } })
      leafTop += height(leaf) + 12
      edges.push({ id: `${group}:${leaf}`, source: binding.group ? group : 'root', target: leaf,
        ariaLabel: `${binding.group ? name : label} → ${String(record[binding.label] || id)}` })
    }
    top += span + 24
  }
  if (centers.length) nodes.unshift({ id: 'root', type: 'board', position: { x: 0, y: (centers[0]! + centers[centers.length - 1]!) / 2 - height('root') / 2 }, data: { label, branch: true } })
  return { nodes, edges }
}
function BoardMapNode({ data }: NodeProps) {
  return <div className={`dsh-board-map-node${data.branch ? ' is-branch' : ''}${data.rejected ? ' is-rejected' : ''}`}>
    <PanelCanvasHandles isConnectable={false} /><span>{String(data.label ?? '')}</span>
    {!data.branch ? <div role="tooltip" className="dsh-board-map-tooltip"><strong>{String(data.label ?? '')}</strong>
      {data.description ? <p>{String(data.description)}</p> : null}
      {data.badgeLabel ? <span className="dsh-record-board-badge">{String(data.badgeLabel)}</span> : null}
    </div> : null}
  </div>
}
const boardNodeTypes = { board: BoardMapNode }
function BoardMap({ groups, binding, onSelect, label, manifest, section }: { groups: Map<string, [string, Record<string, unknown>][]>
  binding: NonNullable<ComponentNode['board']>; onSelect: (id: string) => void; label: string; manifest: PanelManifest; section: string }) {
  const { t } = usePanelI18n()
  const { nodes: projectedNodes, edges } = useMemo(() => boardMapProjection(groups, binding, label), [groups, binding, label])
  const [nodes, setNodes] = useState<Node[]>(projectedNodes)
  const nodeSignature = JSON.stringify(projectedNodes)
  useEffect(() => {
    setNodes(current => {
      const previous = new Map(current.map(node => [node.id, node]))
      const layout = boardMapProjection(groups, binding, label, new Map(current.map(node => [node.id, node.measured ?? {}])))
      return layout.nodes.map(node => ({ ...previous.get(node.id), ...node }))
    })
  }, [nodeSignature])
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Like the relation/navigation canvases, retain React Flow's transient
    // measurements. Replacing controlled nodes loses same-size hidden mounts
    // and their ports without another ResizeObserver delivery on reveal.
    setNodes(current => {
      const next = applyNodeChanges(changes, current)
      if (!changes.some(change => change.type === 'dimensions')) return next
      const layout = boardMapProjection(groups, binding, label, new Map(next.map(node => [node.id, node.measured ?? {}])))
      const positions = new Map(layout.nodes.map(node => [node.id, node.position]))
      return next.map(node => ({ ...node, position: positions.get(node.id) ?? node.position }))
    })
  }, [groups, binding, label])
  const marker = `board-${useId().replaceAll(':', '')}`
  const [hovered, setHovered] = useState<string>()
  const [flow, setFlow] = useState<ReactFlowInstance>()
  const canvas = useRef<HTMLDivElement>(null)
  useFlowContainerFit(canvas, flow)
  const badge = manifest.fields.find(field => field.key === binding.badge && field.applies_to?.includes(section))
  return <div ref={canvas} className="dsh-record-board-map" aria-label={label}>
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><defs>
      {[false, true].map(active => <marker key={String(active)} id={`${marker}-${active ? 'active' : 'normal'}`} markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto"><circle cx="5" cy="5" r="3" fill="white" stroke={active ? 'var(--ds-brand-bg-default, #663ae8)' : 'var(--ds-line-4, #b8b8c2)'} strokeOpacity={active ? .6 : 1} strokeWidth="1" /></marker>)}
      <linearGradient id={`${marker}-gradient`} x1="100%" y1="50%" x2="0%" y2="50%"><stop offset="0%" stopColor="var(--ds-brand-bg-default, #663ae8)" stopOpacity=".4" /><stop offset="100%" stopColor="var(--ds-brand-bg-default, #663ae8)" stopOpacity=".6" /></linearGradient>
    </defs></svg>
    <ReactFlow<Node> ariaLabelConfig={canvasAriaLabels(t, t('boardMapKeyboard'))} onInit={setFlow} onNodesChange={onNodesChange} nodes={nodes.map(node => ({ ...node, data: { ...node.data,
    badgeLabel: node.data.rejected ? t('rejectedRecords') : badge?.options?.find(option => option.value === node.data.badge)?.label ?? node.data.badge,
  } }))} edges={edges.map(edge => ({ ...edge, sourceHandle: 'right', targetHandle: 'left', style: { strokeWidth: 1, stroke: edge.source === hovered ? `url(#${marker}-gradient)` : 'var(--ds-line-4, #b8b8c2)', markerStart: `url(#${marker}-${edge.source === hovered ? 'active' : 'normal'})` } }))} nodeTypes={boardNodeTypes} connectionMode={ConnectionMode.Loose} fitView fitViewOptions={RELATION_GRAPH_AUTO_FIT} minZoom={0.15} maxZoom={2.5}
    defaultEdgeOptions={{ style: { stroke: 'var(--ds-line-4, #b8b8c2)', strokeWidth: 1 } }}
    nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}
    onNodeMouseEnter={(_, node) => setHovered(node.id)} onNodeMouseLeave={() => setHovered(undefined)}
    onNodeClick={(_, node) => { if (typeof node.data.record === 'string') onSelect(node.data.record) }}>
    <Background gap={20} size={1.5} color="#94a3b8" style={{ opacity: .15 }} /><Controls showInteractive={false} fitViewOptions={RELATION_GRAPH_AUTO_FIT} />
  </ReactFlow></div>
}

/** Cards share the Panel draft with their detail fields. Editing never creates
 * a second save boundary; only readonly presentation substitutes readable facts. */
export function BoardCard({ id, record, binding, section, manifest, options, hidden, onFocusChange, children, actions, renderBodyField, presentation = 'card' }: {
  id: string; record: Record<string, unknown>; binding: NonNullable<ComponentNode['board']>
  section: string; manifest: PanelManifest; options?: RenderOptions; hidden?: boolean; onFocusChange?: (active: boolean) => void; children?: ReactNode; actions?: ReactNode
  /** A page's primary record owns a section; nested reading records stay cards. */
  presentation?: 'section' | 'card'
  renderBodyField?: (field: EditorField, values: Record<string, unknown>, onChange: (value: unknown) => void, editable: boolean) => ReactNode
}) {
  const { t } = usePanelI18n()
  const descriptionId = useId()
  const rejected = !!binding.rejected && record[binding.rejected] === true
  const writable = !!options?.editable && !!(options.onTransaction || options.onEdit) && !rejected
  const field = (key: string | undefined) => fieldsForSection(manifest.fields, section).find(item => item.key === key)
  const visibleField = (key: string | undefined) => {
    const item = field(key)
    return item && fieldIsVisible(item, record) ? item : undefined
  }
  const labelField = visibleField(binding.label), badgeField = visibleField(binding.badge), descriptionField = visibleField(binding.description)
  const canRename = writable && labelField?.control === 'text' && !labelField.readonly
  const canDescribe = writable && !!descriptionField && !descriptionField.readonly
  const canBadge = writable && !!badgeField && !badgeField.readonly
  const bodyFields = binding.body_fields?.map(key => visibleField(key)).filter((item): item is EditorField => !!item)
  const groupField = visibleField(binding.group)
  const identity = binding.id_field ? recordIdentityOf(manifest, section, record, binding.id_field) : undefined
  const editingFields = bodyFields ? [...bodyFields, ...(groupField ? [groupField] : [])] : []
  const patch = (key: string, value: unknown) => {
    const target = field(key)
    if (!writable || !target || target.readonly || !fieldIsVisible(target, record)) return
    const edit = { section, record: id, field: key, value }
    if (options?.onTransaction) options.onTransaction([edit], {})
    else options?.onEdit?.(edit)
  }
  const name = canRename ? <PanelEditableTitle aria-label={labelField.label ?? binding.label}
        aria-required={labelField.required || undefined} value={String(record[binding.label] ?? '')}
        placeholder={t('untitled')} onChange={event => patch(binding.label, event.target.value)} />
        : String(record[binding.label] || t('untitled'))
  const management = actions ? <div className="dsh-design-record-actions">{actions}</div> : null
  const body = <>
    {bodyFields ? writable ? editingFields.length ? <div className="dsh-record-board-fields">{editingFields.map(item => <Fragment key={item.key}>
      {renderBodyField?.(item, record, value => patch(item.key, value), !item.readonly && !item.hidden)}
    </Fragment>)}</div> : null : bodyFields.length ? <RecordFacts inline fields={bodyFields} value={record} rows={bodyFields.map(item => [item.key])} /> : null
      : canDescribe ? <div className="dsh-design-field dsh-record-board-description-field" data-field={binding.description}>
        <span className="dsh-design-field-label"><PanelFieldCaption htmlFor={descriptionId}
          label={descriptionField.label ?? binding.description} required={descriptionField.required} description={descriptionField.description} /></span>
        <PanelTextarea id={descriptionId} className="dsh-record-board-description-editor" aria-label={descriptionField?.label}
        aria-required={descriptionField?.required || undefined} value={String(record[binding.description] ?? '')}
        onChange={event => patch(binding.description, event.target.value)} /></div>
      : descriptionField || !field(binding.description) ? <div className="dsh-record-board-description"><ReactMarkdown remarkPlugins={[remarkGfm]}>{String(record[binding.description] ?? '')}</ReactMarkdown></div> : null}
    {rejected || badgeField ? <footer className="dsh-record-board-footer">
      {rejected ? <div className="dsh-record-board-priority"><span className="dsh-record-board-badge">{t('rejectedRecords')}</span>
        {options?.editable && options.onEdit ? <button type="button" onClick={() => options.onEdit?.({ section, record: id, field: binding.rejected!, value: false })}>{t('restoreRecord')}</button> : null}</div>
        : badgeField ? <span className="dsh-record-board-priority-select" data-rank={badgeField.options?.findIndex(item => item.value === record[binding.badge!])}><i aria-hidden="true" /><PanelSelect className="dsh-record-board-badge" aria-label={badgeField.label} disabled={!canBadge}
          value={String(record[binding.badge!] ?? '')} options={badgeField.options ?? []} onValueChange={value => patch(binding.badge!, value)} /></span> : null}
    </footer> : null}
    {children}
  </>
  return <article hidden={hidden} data-board-record={id} className={`${presentation === 'card' ? 'dsh-panel-content-card' : ''}${rejected ? ' is-rejected' : ''}`}
    onFocusCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) onFocusChange?.(true) }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) onFocusChange?.(false) }}>
    {presentation === 'section' ? <PanelContentGroup
      title={<span className="dsh-design-record-header-label"><PanelRecordId value={identity?.value} label={identity?.label} /><span className="dsh-panel-header-heading">{name}</span></span>}
      preview={management}>
      <div className="dsh-design-form-group-content"><div className="dsh-design-form-group-fields dsh-panel-content-card">{body}</div></div>
    </PanelContentGroup> : <>
      <header><PanelRecordId value={identity?.value} label={identity?.label} /><h4>{name}</h4>{management}</header>
      {body}
    </>}
  </article>
}

export function RecordBoard(props: { node: ComponentNode; manifest: PanelManifest; data: DesignData; options?: RenderOptions
  render: (section: string, id: string, options?: RenderOptions) => ReactElement | null;
  renderActions?: (id: string, siblings: readonly string[]) => ReactNode;
  renderBodyField?: (id: string, field: EditorField, values: Record<string, unknown>, onChange: (value: unknown) => void, editable: boolean) => ReactNode; renderDetails?: (id: string, options?: RenderOptions) => ReactElement }) {
  const { node, manifest, data, options } = props, { t } = usePanelI18n()
  const binding = node.board!, section = node.source!, definition = manifest.sections.find(item => item.id === section)!
  const storage = sectionBindingOf(manifest, section)
  const rawRecords = recordsAtPath(data, storage.recordsPath)
  const rawOrder = storage.orderPath ? pathGet(data, storage.orderPath) : undefined
  const ids = orderedRecordIds(rawRecords, Array.isArray(rawOrder) ? rawOrder : undefined)
  const records = Object.fromEntries(ids.map(id => [id, fieldValuesOf(rawRecords[id]!, storage.fieldsPath)]))
  const [filter, setFilter] = useState<'active' | 'rejected' | 'all'>('all')
  const [map, showMap] = useState(false)
  const [detailId, setDetailId] = useState<string>()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const previousRunning = useRef(options?.running === true)
  useEffect(() => {
    if (binding.overview !== false && previousRunning.current && !options?.running && Object.keys(records).length) showMap(true)
    previousRunning.current = options?.running === true
  }, [options?.running, Object.keys(records).length])
  const [selected, select] = useState<string>()
  const pendingNameFocus = useRef<string>()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const content = useRef<HTMLDivElement>(null)
  const [focusedGroups, setFocusedGroups] = useState<Record<string, string>>({})
  const positioned = Object.fromEntries(Object.entries(records).map(([id, record]) => [id, !binding.group || !Object.hasOwn(focusedGroups, id) ? record : { ...record, [binding.group]: focusedGroups[id] }]))
  const groups = boardGroups(positioned, binding, filter, t('ungrouped'))
  const allGroups = boardGroups(positioned, binding, 'all', t('ungrouped'))
  const currentGroup = [...groups].find(([, entries]) => entries.some(([id]) => id === selected))?.[0] ?? groups.keys().next().value
  const updateCurrent = useCallback(() => {
    // Layout changes while a host insertion is pending must not select an old card.
    if (pendingNameFocus.current) return
    const container = content.current
    if (!container || !container.getClientRects().length) return
    const cards = [...container.querySelectorAll<HTMLElement>('[data-board-record]')].filter(card => card.getClientRects().length > 0)
    if (!cards.length) return
    const start = container.getBoundingClientRect().top + parseFloat(getComputedStyle(container).paddingTop || '0')
    const atEnd = container.scrollHeight > container.clientHeight + 1 && container.scrollTop + container.clientHeight >= container.scrollHeight - 1
    const current = atEnd ? cards.at(-1) : cards.find(card => card.getBoundingClientRect().bottom > start + 1) ?? cards.at(-1)
    select(current?.dataset.boardRecord)
  }, [])
  const visibleSignature = JSON.stringify([currentGroup, [...groups].map(([name, entries]) => [name, entries.map(([id]) => id)])])
  useLayoutEffect(() => {
    const container = content.current
    if (!container || map || detailsOpen) return
    let frame = 0
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(updateCurrent) }
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    container.querySelectorAll('[data-board-group], [data-board-record]').forEach(element => observer.observe(element))
    container.addEventListener('scroll', schedule, { passive: true })
    container.addEventListener('toggle', schedule, true)
    schedule()
    return () => { cancelAnimationFrame(frame); observer.disconnect(); container.removeEventListener('scroll', schedule); container.removeEventListener('toggle', schedule, true) }
  }, [visibleSignature, map, detailsOpen, updateCurrent])
  const scrollTo = (selector: string, attribute: string, value: string) => {
    const container = content.current
    const target = [...(container?.querySelectorAll<HTMLElement>(selector) ?? [])].find(element => element.getAttribute(attribute) === value)
    const section = target?.querySelector<HTMLDetailsElement>(':scope > details.dsh-panel-content-group')
    if (section && !section.open) section.open = true
    if (container && target) container.scrollTo?.({ top: Math.max(0, container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - parseFloat(getComputedStyle(container).paddingTop || '0')) })
  }
  const open = (id: string) => {
    pendingNameFocus.current = undefined
    select(id); showMap(false)
    if (binding.detail_presentation === 'cover') { setDetailId(id); setDetailsOpen(true) }
    requestAnimationFrame(() => scrollTo('[data-board-record]', 'data-board-record', id))
  }
  useEffect(() => {
    const id = pendingNameFocus.current
    if (!id) return
    if (!options?.editable || selected !== id || map || detailsOpen) {
      pendingNameFocus.current = undefined
      return
    }
    // Wait for this exact insertion, then consume the request once. Ordinary
    // updates and a late result after navigation must never steal focus.
    if (!Object.hasOwn(rawRecords, id)) return
    pendingNameFocus.current = undefined
    scrollTo('[data-board-record]', 'data-board-record', id)
    const card = [...(content.current?.querySelectorAll<HTMLElement>('[data-board-record]') ?? [])]
      .find(element => element.dataset.boardRecord === id)
    const input = card?.querySelector<HTMLInputElement>('[data-panel-title="editable"]')
    if (input && !input.disabled && !input.readOnly) input.focus()
  }, [data, manifest, options?.editable, selected, map, detailsOpen])
  const canAdd = options?.editable && (binding.request_create ? !!options.sendPrompt : !!options.onPanelUpdate) && definition.add_mode !== 'none'
  const addRecord = () => {
    if (binding.request_create) { setAdding(true); return }
    const id = insertVisualRecord({ node, manifest, data, options }, section, {})
    if (id) { setFilter('active'); open(id); pendingNameFocus.current = id }
  }
  const recordFilter = binding.rejected ? <PanelSelect aria-label={t('recordFilter')} title={`${t('recordFilter')}: ${t(filter === 'active' ? 'activeRecords' : filter === 'rejected' ? 'rejectedRecords' : 'allRecords')}`}
    triggerIcon={<Filter size={16} strokeWidth={1.5} aria-hidden='true' />} data-active={filter !== 'all'} value={filter} onValueChange={value => setFilter(value as typeof filter)}
    options={[{ value: 'active', label: t('activeRecords') }, { value: 'rejected', label: t('rejectedRecords') }, { value: 'all', label: t('allRecords') }]} /> : null
  const board = <div className="dsh-record-board">
    {adding ? <RecordRequestDialog node={node} manifest={manifest} options={options} onClose={() => setAdding(false)} /> : null}
    <PanelWorkspaceCover keepCoverMounted active={map} label={t('mindMap')} onClose={() => showMap(false)}
      cover={binding.overview !== false ? <div className="dsh-record-board-overview"><PanelCanvasToolbar placement="workspace" title={node.title ?? definition.title}
        counts={t(binding.group ? 'boardMapCounts' : 'boardItemCounts', { records: [...groups.values()].reduce((sum, entries) => sum + entries.length, 0), groups: groups.size })}>
        {binding.rejected ? <PanelSelect aria-label={t('recordFilter')} value={filter} onValueChange={value => setFilter(value as typeof filter)}
          options={[{ value: 'active', label: t('activeRecords') }, { value: 'rejected', label: t('rejectedRecords') }, { value: 'all', label: t('allRecords') }]} /> : null}</PanelCanvasToolbar><BoardMap groups={groups} binding={binding} onSelect={open} label={node.title ?? definition.title} manifest={manifest} section={section} /></div> : null}>
    <PanelWorkspace guidance={node.guidance} autoSaveId={`board:${manifest.panel_kind}:${node.id}`} sidebar={<>
      <PanelWorkspaceTree icon={sidebarIcon(node.sidebar_icon)} title={node.title ?? definition.title} actions={recordFilter}>
        {[...groups].map(([name, entries]) => !binding.group ? entries.map(([id, record]) => <PanelWorkspaceTreeItem key={id} selected={selected === id} onSelect={() => open(id)}>{String(record[binding.label] || t('untitled'))}</PanelWorkspaceTreeItem>) : <PanelWorkspaceTreeRecord key={name} label={name} ariaLabel={name} selected={currentGroup === name && expanded[name] !== true} expanded={expanded[name] === true}
          onSelect={() => {
            select(entries[0]?.[0]); showMap(false); setDetailsOpen(false)
            setExpanded(current => ({ ...current, [name]: true }))
            requestAnimationFrame(() => content.current?.scrollTo?.({ top: 0 }))
          }}
          onToggle={() => setExpanded(current => ({ ...current, [name]: current[name] !== true }))}>
          {entries.map(([id, record]) => <PanelWorkspaceTreeItem key={id} selected={selected === id} onSelect={() => open(id)}>{String(record[binding.label] || t('untitled'))}</PanelWorkspaceTreeItem>)}
        </PanelWorkspaceTreeRecord>)}
        {canAdd ? <PanelWorkspaceTreeAdd onAdd={addRecord}>{t('addItem', { item: definition.item_name ?? definition.title })}</PanelWorkspaceTreeAdd> : null}
      </PanelWorkspaceTree>
      {binding.overview !== false ? <PanelWorkspaceCanvasToggle className="dsh-record-board-map-toggle" label={t('mindMap')} onOpen={() => showMap(true)} /> : null}
    </>}>
      {binding.group && currentGroup !== undefined ? <PanelRecordHeader placement="workspace"><div className="dsh-panel-header-title-group"><span className="dsh-design-record-header-label">{currentGroup}</span><PanelCollectionCount count={groups.get(currentGroup)?.length ?? 0} /></div></PanelRecordHeader> : null}
      <div className="dsh-record-board-content" ref={content}>
        {groups.size === 0 ? <p role="status">{t('emptyFilter')}</p> : null}
        {[...allGroups].map(([group, entries]) => <section key={group} hidden={group !== currentGroup || !groups.has(group)} data-board-group={group} className="dsh-record-board-group">
          <div className="dsh-record-board-cards">
            {entries.map(([id]) => {
              const record = records[id]!
              const detailOptions = { ...options, editable: !!options?.editable && !(binding.rejected && record[binding.rejected] === true) }
              const remaining = props.render(section, id, detailOptions)
              const hasDetails = remaining || props.renderDetails || binding.detail_sections?.length
              return <BoardCard key={id} presentation="section" hidden={!groups.get(group)?.some(([shown]) => shown === id)} id={id} record={record} binding={binding} section={section} manifest={manifest} options={options} actions={props.renderActions?.(id, (groups.get(group) ?? []).map(([shown]) => shown))} renderBodyField={(field, values, change, editable) => props.renderBodyField?.(id, field, values, change, editable)} onFocusChange={active => setFocusedGroups(current => { const next = { ...current }; if (active) next[id] = group; else delete next[id]; return next })}>
              {binding.detail_presentation === 'cover' ? <button type="button" className="dsh-record-board-open-details" onClick={() => open(id)}>{binding.details_title ?? t('details')}<ChevronRight size={14} aria-hidden="true" /></button> : hasDetails ? <PanelDetailDisclosure className="dsh-record-board-editor" title={binding.details_title ?? t('details')}>
                {props.renderDetails?.(id, { ...options, editable: !!options?.editable && !(binding.rejected && record[binding.rejected] === true) })}
                {(binding.detail_sections ?? []).map(detail => {
                  const body = props.render(detail, id, { ...options, editable: !!options?.editable && !(binding.rejected && record[binding.rejected] === true) })
                  return props.renderDetails || (binding.detail_sections?.length ?? 0) > 1
                    ? <section key={detail}><h5>{manifest.sections.find(item => item.id === detail)?.title}</h5>{body}</section>
                    : <Fragment key={detail}>{body}</Fragment>
                })}
                {remaining}
              </PanelDetailDisclosure> : null}
            </BoardCard>})}
          </div>
        </section>)}
      </div>
    </PanelWorkspace>
    </PanelWorkspaceCover>
  </div>
  const detailRecord = detailId ? records[detailId] : undefined
  const detailIdentity = detailRecord && binding.id_field ? recordIdentityOf(manifest, section, detailRecord, binding.id_field) : undefined
  const detailOptions = { ...options, editable: !!options?.editable && !(binding.rejected && detailRecord?.[binding.rejected] === true) }
  return binding.detail_presentation === 'cover' ? <PanelWorkspaceCover keepCoverMounted active={detailsOpen && !!detailRecord}
    label={String(detailRecord?.[binding.label] ?? t('details'))} onClose={() => setDetailsOpen(false)} cover={detailId && detailRecord ? <div className="dsh-board-detail-cover">
      <header><PanelRecordId value={detailIdentity?.value} label={detailIdentity?.label} />
        <strong>{String(detailRecord[binding.label] ?? t('untitled'))}</strong>
        <span>{String(detailRecord[binding.description] ?? '')}</span></header>
      <PanelDetailDisclosure className="dsh-board-detail-definition" title={binding.details_title ?? t('details')}>{props.render(section, detailId, detailOptions)}</PanelDetailDisclosure>
      {props.renderDetails?.(detailId, detailOptions)}
    </div> : null}>{board}</PanelWorkspaceCover> : board
}
