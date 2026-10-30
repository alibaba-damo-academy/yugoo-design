import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { sidebarIcon } from './sidebar-icon.tsx'
import remarkGfm from 'remark-gfm'
import { ChevronRight, Pencil, CircleMinus } from 'lucide-react'
import { ReactFlow, Background, Controls, ConnectionMode, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import type { ComponentNode, PanelManifest } from './dsl.ts'
import { fieldsForSection, fieldValuesOf, recordsAtPath, sectionBindingOf, type DesignData } from './record-state.ts'
import type { RenderOptions } from './interpreter.ts'
import { insertVisualRecord } from './visual-components.tsx'
import { PanelEditableTitle, PanelWorkspace, PanelWorkspaceTree, PanelWorkspaceTreeGroup, PanelWorkspaceTreeItem, PanelWorkspaceCover, PanelWorkspaceCanvasToggle, PanelDisclosureIcon, PanelCanvasHandles, PanelCanvasToolbar } from './panel-workspace.tsx'
import { RELATION_GRAPH_AUTO_FIT } from './relation-graph-layout.ts'
import { useFlowContainerFit } from './use-flow-container-fit.ts'
import { RecordRequestDialog } from './record-request-dialog.tsx'
import { usePanelI18n } from './panel-i18n.tsx'
import { PanelSelect } from './panel-select.tsx'
import { useRecordCardDraft } from './record-card-drafts.tsx'

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

/** Native horizontal mind-map geometry, projected solely from declared bindings. */
export function boardMapProjection(groups: Map<string, [string, Record<string, unknown>][]>, binding: NonNullable<ComponentNode['board']>, label: string) {
  const nodes: Node[] = [], edges: { id: string; source: string; target: string }[] = []
  let ordinal = 0
  const centers: number[] = []
  for (const [name, records] of groups) {
    const group = `group:${centers.length}`
    const center = (ordinal + (records.length - 1) / 2) * 50
    centers.push(center)
    if (binding.group) nodes.push({ id: group, type: 'board', position: { x: 300, y: center }, data: { label: name, branch: true, rejected: !!binding.rejected && records.every(([, record]) => record[binding.rejected!] === true) } })
    if (binding.group) edges.push({ id: `root:${group}`, source: 'root', target: group })
    for (const [id, record] of records) {
      const leaf = `record:${id}`
      nodes.push({ id: leaf, type: 'board', position: { x: binding.group ? 600 : 300, y: ordinal++ * 50 }, data: {
        label: String(record[binding.label] || id), record: id, description: String(record[binding.description] ?? ''),
        badge: binding.badge ? record[binding.badge] : undefined, rejected: !!binding.rejected && record[binding.rejected] === true,
      } })
      edges.push({ id: `${group}:${leaf}`, source: binding.group ? group : 'root', target: leaf })
    }
  }
  if (centers.length) nodes.unshift({ id: 'root', type: 'board', position: { x: 0, y: (centers[0]! + centers[centers.length - 1]!) / 2 }, data: { label, branch: true } })
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
function BoardRecordId({ record, binding, manifest, section }: { record: Record<string, unknown>; binding: NonNullable<ComponentNode['board']>; manifest: PanelManifest; section: string }) {
  const key = binding.id_field
  const value = key ? record[key] : undefined
  if (typeof value !== 'string' || !value) return null
  const field = fieldsForSection(manifest.fields, section).find(item => item.key === key)
  return <small className="dsh-record-board-id" title={field?.label}>{value}</small>
}
function BoardMap({ groups, binding, onSelect, label, manifest, section }: { groups: Map<string, [string, Record<string, unknown>][]>
  binding: NonNullable<ComponentNode['board']>; onSelect: (id: string) => void; label: string; manifest: PanelManifest; section: string }) {
  const { t } = usePanelI18n()
  const { nodes, edges } = useMemo(() => boardMapProjection(groups, binding, label), [groups, binding, label])
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
    <ReactFlow<Node> onInit={setFlow} nodes={nodes.map(node => ({ ...node, data: { ...node.data,
    badgeLabel: node.data.rejected ? t('rejectedRecords') : badge?.options?.find(option => option.value === node.data.badge)?.label ?? node.data.badge,
  } }))} edges={edges.map(edge => ({ ...edge, sourceHandle: 'right', targetHandle: 'left', style: { strokeWidth: 1, stroke: edge.source === hovered ? `url(#${marker}-gradient)` : 'var(--ds-line-4, #b8b8c2)', markerStart: `url(#${marker}-${edge.source === hovered ? 'active' : 'normal'})` } }))} nodeTypes={boardNodeTypes} connectionMode={ConnectionMode.Loose} fitView fitViewOptions={RELATION_GRAPH_AUTO_FIT} minZoom={0.15} maxZoom={2.5}
    defaultEdgeOptions={{ style: { stroke: 'var(--ds-line-4, #b8b8c2)', strokeWidth: 1 } }}
    nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}
    onNodeMouseEnter={(_, node) => setHovered(node.id)} onNodeMouseLeave={() => setHovered(undefined)}
    onNodeClick={(_, node) => { if (typeof node.data.record === 'string') onSelect(node.data.record) }}>
    <Background gap={20} size={1.5} color="#94a3b8" style={{ opacity: .15 }} /><Controls showInteractive={false} fitViewOptions={RELATION_GRAPH_AUTO_FIT} />
  </ReactFlow></div>
}

/** Cards edit only their declared description/badge; all other fields remain in
 * the existing detail renderer. Local Save emits one shared draft transaction. */
export function BoardCard({ id, record, binding, section, manifest, options, hidden, onEditing, children, actions }: {
  id: string; record: Record<string, unknown>; binding: NonNullable<ComponentNode['board']>
  section: string; manifest: PanelManifest; options?: RenderOptions; hidden?: boolean; onEditing: (active: boolean) => void; children?: ReactNode; actions?: ReactNode
}) {
  const { t } = usePanelI18n()
  const owner = sectionBindingOf(manifest, section)
  const [draft, setDraft] = useRecordCardDraft(JSON.stringify([
    owner.recordsPath, owner.fieldsPath, id, binding.description, binding.badge,
  ]))
  const [error, setError] = useState('')
  const rejected = !!binding.rejected && record[binding.rejected] === true
  const writable = !!options?.editable && !!options.onTransaction && !rejected
  const field = (key: string | undefined) => fieldsForSection(manifest.fields, section).find(item => item.key === key)
  const labelField = field(binding.label), badgeField = field(binding.badge), descriptionField = field(binding.description)
  const canRename = writable && labelField?.control === 'text' && !labelField.readonly && !labelField.hidden
  const canDescribe = writable && !!descriptionField && !descriptionField.readonly && !descriptionField.hidden
  const canBadge = writable && !!badgeField && !badgeField.readonly && !badgeField.hidden
  const current = draft?.values ?? record
  const draftWritable = !draft || Object.keys(draft.values).every(key => { const current = field(key); return current && !current.readonly && !current.hidden })
  const stale = draft && Object.keys(draft.values).some(key => record[key] !== draft.base[key])
  const patch = (values: Record<string, unknown>) => options?.onTransaction?.(
    Object.entries(values).map(([field, value]) => ({ section, record: id, field, value })), {})
  const save = () => {
    if (!draft || !writable || !draftWritable || stale) return
    try { patch(draft.values); setDraft(undefined); onEditing(false); setError('') }
    catch (failure) { setError(String(failure)) }
  }
  const priorityControl = <>
      {rejected ? <div className="dsh-record-board-priority"><span className="dsh-record-board-badge">{t('rejectedRecords')}</span>
        {options?.editable && options.onEdit ? <button type="button" onClick={() => options.onEdit?.({ section, record: id, field: binding.rejected!, value: false })}>{t('restoreRecord')}</button> : null}</div>
        : badgeField ? <span className="dsh-record-board-priority-select" data-rank={badgeField.options?.findIndex(item => item.value === current[binding.badge!])}><i aria-hidden="true" /><PanelSelect className="dsh-record-board-badge" aria-label={badgeField.label} disabled={!canBadge}
          value={String(current[binding.badge!] ?? '')} options={badgeField.options ?? []} onValueChange={value => {
            if (!canBadge) return
            if (draft) setDraft({ ...draft, values: { ...draft.values, [binding.badge!]: value } })
            else patch({ [binding.badge!]: value })
          }} /></span> : null}
  </>
  return <article hidden={hidden} data-board-record={id} className={`${rejected ? 'is-rejected' : ''}${draft ? ' is-editing' : ''}`}>
    <header><h4>{canRename ? <PanelEditableTitle aria-label={labelField.label ?? binding.label}
      aria-required={labelField.required || undefined} value={String(record[binding.label] ?? '')}
      placeholder={t('untitled')} onChange={event => patch({ [binding.label]: event.target.value })} />
      : String(record[binding.label] || t('untitled'))}</h4>
      <BoardRecordId record={record} binding={binding} manifest={manifest} section={section} /></header>
    {draft ? <textarea autoFocus className="dsh-record-board-description-editor" aria-label={descriptionField?.label}
      aria-required={descriptionField?.required || undefined}
      disabled={!canDescribe} value={String(draft.values[binding.description] ?? '')}
      onChange={event => setDraft({ ...draft, values: { ...draft.values, [binding.description]: event.target.value } })} />
      : <div className="dsh-record-board-description"><ReactMarkdown remarkPlugins={[remarkGfm]}>{String(record[binding.description] ?? '')}</ReactMarkdown></div>}
    <footer className="dsh-record-board-footer">
      {priorityControl}
      <div className="dsh-record-board-actions">
      {draft ? <><button type="button" onClick={() => { setDraft(undefined); onEditing(false); setError('') }}>{t('cancel')}</button>
        <button type="button" disabled={!writable || !draftWritable || !!stale} onClick={save}>{t('saveRecord')}</button></>
        : !rejected ? <>
          {canDescribe ? <button type="button" aria-label={t('edit')} title={t('edit')} onClick={() => {
            const values = { [binding.description]: record[binding.description], ...(canBadge ? { [binding.badge!]: record[binding.badge!] } : {}) }
            onEditing(true); setDraft({ base: { ...values }, values }); setError('')
          }}><Pencil size={16} aria-hidden="true" /></button> : null}
          {binding.rejected && options?.editable && options.onEdit ? <button type="button" aria-label={t('rejectRecord')} title={t('rejectRecord')}
            onClick={() => options.onEdit?.({ section, record: id, field: binding.rejected!, value: true })}><CircleMinus size={16} aria-hidden="true" /></button> : null}
        </> : null}
        {actions}
      </div>
    </footer>
    {stale || error ? <p role="alert">{stale ? t('boardDraftConflict') : error}</p> : null}
    {children}
  </article>
}

export function RecordBoard(props: { node: ComponentNode; manifest: PanelManifest; data: DesignData; options?: RenderOptions
  render: (section: string, id: string, options?: RenderOptions) => ReactElement; renderDetails?: (id: string, options?: RenderOptions) => ReactElement }) {
  const { node, manifest, data, options } = props, { t } = usePanelI18n()
  const binding = node.board!, section = node.source!, definition = manifest.sections.find(item => item.id === section)!
  const storage = sectionBindingOf(manifest, section)
  const records = Object.fromEntries(Object.entries(recordsAtPath(data, storage.recordsPath)).map(([id, record]) => [id, fieldValuesOf(record, storage.fieldsPath)]))
  const [filter, setFilter] = useState<'active' | 'rejected' | 'all'>('all')
  const [map, showMap] = useState(false)
  const [detailId, setDetailId] = useState<string>()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const previousRunning = useRef(options?.running === true)
  useEffect(() => {
    if (previousRunning.current && !options?.running && Object.keys(records).length) showMap(true)
    previousRunning.current = options?.running === true
  }, [options?.running, Object.keys(records).length])
  const [selected, select] = useState<string>()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const content = useRef<HTMLDivElement>(null)
  const [draftGroups, setDraftGroups] = useState<Record<string, string>>({})
  const positioned = Object.fromEntries(Object.entries(records).map(([id, record]) => [id, !binding.group || !Object.hasOwn(draftGroups, id) ? record : { ...record, [binding.group]: draftGroups[id] }]))
  const groups = boardGroups(positioned, binding, filter, t('ungrouped'))
  const allGroups = boardGroups(positioned, binding, 'all', t('ungrouped'))
  const open = (id: string) => {
    select(id); showMap(false)
    if (binding.detail_presentation === 'cover') { setDetailId(id); setDetailsOpen(true) }
    const group = binding.group ? String(records[id]?.[binding.group] || t('ungrouped')) : ''
    setCollapsed(current => ({ ...current, [group]: false }))
    requestAnimationFrame(() => [...(content.current?.querySelectorAll<HTMLElement>('[data-board-record]') ?? [])]
      .find(element => element.dataset.boardRecord === id)?.scrollIntoView?.({ block: 'nearest' }))
  }
  const board = <div className="dsh-record-board">
    {adding ? <RecordRequestDialog node={node} manifest={manifest} options={options} onClose={() => setAdding(false)} /> : null}
    <PanelWorkspaceCover keepCoverMounted active={map} label={t('mindMap')} onClose={() => showMap(false)}
      cover={<div className="dsh-record-board-overview"><PanelCanvasToolbar title={node.title ?? definition.title}
        counts={t(binding.group ? 'boardMapCounts' : 'boardItemCounts', { records: [...groups.values()].reduce((sum, entries) => sum + entries.length, 0), groups: groups.size })}>
        {binding.rejected ? <PanelSelect aria-label={t('recordFilter')} value={filter} onValueChange={value => setFilter(value as typeof filter)}
          options={[{ value: 'active', label: t('activeRecords') }, { value: 'rejected', label: t('rejectedRecords') }, { value: 'all', label: t('allRecords') }]} /> : null}</PanelCanvasToolbar><BoardMap groups={groups} binding={binding} onSelect={open} label={node.title ?? definition.title} manifest={manifest} section={section} /></div>}>
    <PanelWorkspace guidance={node.guidance} autoSaveId={`board:${manifest.panel_kind}:${node.id}`} sidebar={<>
      <PanelWorkspaceTree icon={sidebarIcon(node.sidebar_icon)} title={node.title ?? definition.title}>
        {[...groups].map(([name, entries]) => !binding.group ? entries.map(([id, record]) => <PanelWorkspaceTreeItem key={id} selected={selected === id} onSelect={() => open(id)}>{String(record[binding.label] || t('untitled'))}</PanelWorkspaceTreeItem>) : <PanelWorkspaceTreeGroup key={name} label={name} expanded={expanded[name] === true}
          onToggle={() => {
            setExpanded(current => ({ ...current, [name]: current[name] !== true }))
            const target = [...(content.current?.querySelectorAll<HTMLElement>('[data-board-group]') ?? [])].find(element => element.dataset.boardGroup === name)
            if (target && content.current) content.current.scrollTo?.({ top: Math.max(0, content.current.scrollTop + target.getBoundingClientRect().top - content.current.getBoundingClientRect().top - 12), behavior: 'smooth' })
          }}>
          {entries.map(([id, record]) => <PanelWorkspaceTreeItem key={id} selected={selected === id} onSelect={() => open(id)}>{String(record[binding.label] || t('untitled'))}</PanelWorkspaceTreeItem>)}
        </PanelWorkspaceTreeGroup>)}
      </PanelWorkspaceTree>
      <PanelWorkspaceCanvasToggle className="dsh-record-board-map-toggle" label={t('mindMap')} onOpen={() => showMap(true)} />
    </>}>
      <div className="dsh-record-board-toolbar">
        {options?.editable && (binding.request_create ? !!options.sendPrompt : !!options.onPanelUpdate) && definition.add_mode !== 'none' ? <button type="button" onClick={() => {
          if (binding.request_create) { setAdding(true); return }
          const id = insertVisualRecord({ node, manifest, data, options }, section, {})
          if (id) { setFilter('active'); open(id) }
        }}>＋ {t('addItem', { item: definition.item_name ?? definition.title })}</button> : null}
        {binding.rejected ? <PanelSelect aria-label={t('recordFilter')} value={filter} onValueChange={value => setFilter(value as typeof filter)}
          options={[{ value: 'active', label: t('activeRecords') }, { value: 'rejected', label: t('rejectedRecords') }, { value: 'all', label: t('allRecords') }]} /> : null}
      </div>
      <div className="dsh-record-board-content" ref={content}>
        {groups.size === 0 ? <p role="status">{t('emptyFilter')}</p> : null}
        {[...allGroups].map(([group, entries]) => <section key={group} hidden={!groups.has(group)} data-board-group={group} className="dsh-record-board-group">
          {binding.group ? <button type="button" className="dsh-record-board-group-heading" aria-expanded={!collapsed[group]}
            onClick={() => setCollapsed(current => ({ ...current, [group]: !current[group] }))}>
            <span>{group}</span><small>({groups.get(group)?.length ?? 0})</small><ChevronRight size={14} aria-hidden="true" />
          </button> : null}
          <div className="dsh-record-board-cards" hidden={collapsed[group]}>
            {entries.map(([id, record]) => <BoardCard key={id} hidden={!groups.get(group)?.some(([shown]) => shown === id)} id={id} record={record} binding={binding} section={section} manifest={manifest} options={options} onEditing={active => setDraftGroups(current => { const next = { ...current }; if (active) next[id] = group; else delete next[id]; return next })}>
              {binding.detail_presentation === 'cover' ? <button type="button" className="dsh-record-board-open-details" onClick={() => open(id)}>{binding.details_title ?? t('details')}<ChevronRight size={14} aria-hidden="true" /></button> : <details className="dsh-record-board-editor"><summary className="dsh-panel-disclosure"><span className="dsh-panel-disclosure-label">{binding.details_title ?? t('details')}</span><PanelDisclosureIcon expanded={false} /></summary>
                {props.renderDetails?.(id, { ...options, editable: !!options?.editable && !(binding.rejected && record[binding.rejected] === true) })}
                {(binding.detail_sections ?? []).map(detail => <section key={detail}>
                  {props.renderDetails || (binding.detail_sections?.length ?? 0) > 1 ? <h5>{manifest.sections.find(item => item.id === detail)?.title}</h5> : null}
                  {props.render(detail, id, { ...options, editable: !!options?.editable && !(binding.rejected && record[binding.rejected] === true) })}</section>)}
                {props.render(section, id, { ...options, editable: !!options?.editable && !(binding.rejected && record[binding.rejected] === true) })}
              </details>}
            </BoardCard>)}
          </div>
        </section>)}
      </div>
    </PanelWorkspace>
    </PanelWorkspaceCover>
  </div>
  const detailRecord = detailId ? records[detailId] : undefined
  const detailOptions = { ...options, editable: !!options?.editable && !(binding.rejected && detailRecord?.[binding.rejected] === true) }
  return binding.detail_presentation === 'cover' ? <PanelWorkspaceCover keepCoverMounted active={detailsOpen && !!detailRecord}
    label={String(detailRecord?.[binding.label] ?? t('details'))} onClose={() => setDetailsOpen(false)} cover={detailId && detailRecord ? <div className="dsh-board-detail-cover">
      <header><strong>{String(detailRecord[binding.label] ?? t('untitled'))}</strong>
        <BoardRecordId record={detailRecord} binding={binding} manifest={manifest} section={section} />
        <span>{String(detailRecord[binding.description] ?? '')}</span></header>
      <details className="dsh-board-detail-definition"><summary className="dsh-panel-disclosure"><span className="dsh-panel-disclosure-label">{binding.details_title ?? t('details')}</span><PanelDisclosureIcon expanded={false} /></summary>{props.render(section, detailId, detailOptions)}</details>
      {props.renderDetails?.(detailId, detailOptions)}
    </div> : null}>{board}</PanelWorkspaceCover> : board
}
