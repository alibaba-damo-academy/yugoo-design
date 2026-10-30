import { Children, Fragment, createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ArrowUpRight, GitBranch, Plus } from 'lucide-react'
import { hierarchyKey, projectRecordHierarchy, type HierarchyRecord } from './record-hierarchy.ts'
import { sidebarIcon } from './sidebar-icon.tsx'
import { PanelSelect } from './panel-select.tsx'
import { ReactFlow, Background, Controls, BaseEdge, EdgeLabelRenderer, MarkerType, Position, ConnectionMode, applyNodeChanges, useUpdateNodeInternals,
  type EdgeProps, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import type { ComponentNode, EditorField, PanelManifest, SidebarIcon } from './dsl.ts'
import type { ELK } from 'elkjs/lib/elk-api.js'
import { fieldValuesOf, recordLabel, recordsAtPath, sectionBindingOf, freshRecordId, pathSet, pathGet,
  type DesignData } from './record-state.ts'
import type { RenderOptions } from './interpreter.ts'
import { displayValue, relationCanvasLabel, graphRecords, pivotRows, replaceMatrixCell, type RecordMap } from './visual-records.ts'
import { secureDesignSrcDoc } from './client/srcdoc-security.ts'
import { usePanelI18n } from './panel-i18n.tsx'
import { ComponentTabsNavigation } from './component-tabs.tsx'
import { relationParents, relationAncestors, relationRoots, relationHasCycle, reverseRelation, relationParticipants, projectParticipantRelations } from './relation-records.ts'
import { RELATION_GRAPH_AUTO_FIT, isRelationSide, relationFallbackCurve, relationGraphFitViewport, relationLayoutInput, relationRoute, relationNodeId, relationEdgeId, type RelationSide, type RelationRoute, type RelationLayoutLink, type GraphSize } from './relation-graph-layout.ts'
import { planRelationHierarchyCreate } from './relation-hierarchy-create.ts'
import { planRelationParentEdit, relationHasParentConflict } from './relation-parent-edit.ts'
import { projectReferenceGraph, referenceMatches, referenceNodeKey, referenceRecordLabel, withReferenceContext } from './reference-graph.ts'
import { RecordCardDraftScope } from './record-card-drafts.tsx'
import { ReferenceHub } from './reference-hub-view.tsx'
import { useFlowContainerFit } from './use-flow-container-fit.ts'
import {
  PanelWorkspace,
  PanelWorkspaceCover,
  PanelWorkspaceCanvasToggle,
  PanelWorkspaceTree,
  PanelWorkspaceTreeAdd,
  PanelWorkspaceTreeGroup,
  PanelWorkspaceTreeItem,
  PanelWorkspaceTreeRecord,
  PanelWorkspaceTreeSubgroup,
  PanelCanvasHandles,
  PanelCanvasToolbar,
} from './panel-workspace.tsx'

interface Selection { section: string; record: string }
type HierarchyCreateRequest = { section: string; parent: string } &
  ({ field: EditorField; graph?: never } | { graph: NonNullable<ComponentNode['graph']>; field?: never })
interface SelectionContextValue {
  selected?: Selection
  select: (value: Selection) => void
  openRelated?: (value: Selection) => void
  returnTo?: Selection
  createHierarchy?: (request: HierarchyCreateRequest) => void
  graph?: ComponentNode['graph']
  referenceGraph?: boolean
  showDetails?: () => void
  canvasView?: boolean
  artifactReferences?: readonly { source: string; reference: string; target: string }[]
  headerOutside?: boolean
  previewLayout?: boolean
}
const SelectionContext = createContext<SelectionContextValue>({ select: () => {} })
/** Shared selection for composed views; reading context never changes canonical data. */
export function useRecordSelection(): SelectionContextValue { return useContext(SelectionContext) }
const RecordFlowContext = createContext(false)
interface Props { node: ComponentNode; manifest: PanelManifest; data: DesignData; options?: RenderOptions }

/** Bare workspace prose owns a content gutter; prose inside an inspector does not. */
export function WorkspaceTextBlock({ id, children }: { id: string; children?: ReactNode }): ReactElement {
  const flow = useContext(RecordFlowContext)
  return <p className={`dsh-design-auto-text${flow ? ' is-workspace-content' : ''}`} data-node={id}>{children}</p>
}

/** A one-child stack arranges content; it does not change the view's identity. */
function workspaceView(node: ComponentNode): ComponentNode {
  let view = node
  while (view.component === 'stack' && !view.guidance && view.children?.length === 1) view = view.children[0]!
  return view
}

interface BusinessRecordNodeData extends Record<string, unknown> {
  record: string
  label: string
  kind?: string
  icon?: SidebarIcon
  connecting?: 'source'
  onDetail?: () => void
  detailLabel?: string
}

/** Business-facing card used by every declarative relation graph. */
function BusinessRecordNode({ data, selected, isConnectable }: NodeProps): ReactElement {
  const value = data as BusinessRecordNodeData
  return <div data-graph-measure={relationNodeId(value.record)} className={`dsh-business-node${selected ? ' is-selected' : ''}${value.connecting === 'source' ? ' is-connection-source' : ''}`}>
    <PanelCanvasHandles isConnectable={isConnectable} />
    <div className="dsh-business-node-heading">
      <span className="dsh-business-node-symbol" aria-hidden="true">{sidebarIcon(value.icon) ?? '◇'}</span>
      <span className="dsh-business-node-title">{value.label}</span>
      {value.kind ? <span className="dsh-business-node-kind">{value.kind}</span> : null}
    </div>
    {value.onDetail ? <button type="button" className="dsh-business-node-detail nodrag nopan"
      aria-label={`${value.detailLabel}: ${value.label}`} onClick={event => { event.stopPropagation(); value.onDetail?.() }}>
      {value.detailLabel}
    </button> : null}
  </div>
}

const relationNodeTypes = { 'business-record': BusinessRecordNode }

function RelationEdge(props: EdgeProps): ReactElement {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props
  const offset = Number(props.data?.offset ?? 0)
  const fallback = relationFallbackCurve({ x: sx, y: sy }, { x: tx, y: ty },
    props.sourcePosition as RelationSide, props.targetPosition as RelationSide, offset)
  const route = props.data?.route as RelationRoute | undefined
  // A manual drag invalidates routed geometry until the next auto-layout.
  const points = route?.points
  const routed = points && Math.abs(points[0]!.x - sx) < 8 && Math.abs(points[0]!.y - sy) < 2
    && Math.abs(points.at(-1)!.x - tx) < 8 && Math.abs(points.at(-1)!.y - ty) < 2 ? route : undefined
  const path = routed ? [{ x: sx, y: sy }, ...routed.points.slice(1, -1), { x: tx, y: ty }]
    .map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
    : fallback.path
  const pending = props.data?.pending === true
  const { x, y } = routed?.labels.main ?? fallback.label
  return <><BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} />
    <EdgeLabelRenderer>{props.label || props.data?.kindLabel ? <span data-graph-measure={`${props.id}:main`} className={`dsh-business-edge-label${pending ? ' is-pending' : ''}`}
      style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, pointerEvents: 'none' }}>
      <strong>{props.label}</strong>
      {props.data?.kindLabel && String(props.data.kindLabel) !== String(props.label) ? <small>{String(props.data.kindLabel)}</small> : null}
    </span> : null}
      {[{ id: 'source', value: props.data?.sourceAnnotation, ...(routed?.labels.source ?? fallback.sourceAnnotation) },
        { id: 'target', value: props.data?.targetAnnotation, ...(routed?.labels.target ?? fallback.targetAnnotation) }].map(item => item.value !== undefined && item.value !== '' ? <span key={item.id}
        data-graph-measure={`${props.id}:${item.id}`} className="dsh-business-edge-annotation" style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${item.x}px, ${item.y}px)`, pointerEvents: 'none' }}>{String(item.value)}</span> : null)}
    </EdgeLabelRenderer></>
}
const relationEdgeTypes = { relation: RelationEdge }
function records(props: Props, section: string): RecordMap {
  const binding = sectionBindingOf(props.manifest, section)
  const current = recordsAtPath(props.data, binding.recordsPath)
  const rawOrder = binding.orderPath ? pathGet(props.data, binding.orderPath) : undefined
  const ids = [...new Set([...(Array.isArray(rawOrder) ? rawOrder.filter((id): id is string => typeof id === 'string' && Object.hasOwn(current, id)) : []), ...Object.keys(current)])]
  return Object.fromEntries(ids.map(id => [id, fieldValuesOf(current[id]!, binding.fieldsPath)]))
}

function referenceTargets(field: EditorField): readonly string[] {
  return field.options_from_sections ?? (field.options_from_section ? [field.options_from_section] : [])
}

/** Resolve a contextual edge only when the declared targets identify one owner. */
function contextualParents(props: Props, field: EditorField, value: unknown): Selection[] {
  if (!['record_select', 'record_multi_select'].includes(field.control)) return []
  return [...new Set(Array.isArray(value) ? value : [value])].flatMap(id => {
    if (typeof id !== 'string' || !id) return []
    const matches = referenceMatches(referenceTargets(field), id, source => records(props, source))
    return matches.length === 1 ? [{ section: matches[0]!, record: id }] : []
  })
}

/** Atomic record insertion, honoring nested section bindings and durable order. */
export function insertVisualRecord(props: Props, section: string, values: Record<string, unknown>): string | undefined {
  if (!props.options?.editable || !props.options.onPanelUpdate) return
  const binding = sectionBindingOf(props.manifest, section)
  const current = recordsAtPath(props.data, binding.recordsPath)
  const id = freshRecordId(section, current)
  const creation = props.manifest.sections.find(item => item.id === section)?.create
  const initial = { ...creation?.defaults, ...values, ...(creation?.id_field ? { [creation.id_field]: id } : {}) }
  const label = creation?.initial_label
  if (label) {
    const supplied = values[label.field]
    const fallback = creation?.defaults?.[label.field]
    const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
    const template = Object.keys(current).length > 0 ? label.numbered_text ?? label.text : label.text
    // Only seed this new record. Defaults and saved records are never localized.
    if (nonempty(supplied)) initial[label.field] = supplied
    else if (nonempty(fallback)) initial[label.field] = fallback
    else if (!template.includes('$t:') && template.trim()
      && !/[{}]/.test(template.replaceAll('{index}', ''))) {
      initial[label.field] = template.replaceAll('{index}', String(Object.keys(current).length + 1))
    }
  }
  // A nested editor may be the contextual creation entrance of a canonical
  // record. Preserve the explicitly declared root owner’s identity/defaults.
  const owner = binding.fieldsPath ? props.manifest.sections.find(item => !item.fields_path
    && (item.records_path ?? item.id) === binding.recordsPath && item.create) : undefined
  const root = owner ? { ...owner.create?.defaults, ...(owner.create?.id_field ? { [owner.create.id_field]: id } : {}) } : {}
  const record = binding.fieldsPath ? pathSet(root, binding.fieldsPath, initial) : initial
  const updates: Record<string, unknown> = { [binding.recordsPath]: { ...current, [id]: record } }
  if (binding.orderPath) {
    const previous = pathGet(props.data, binding.orderPath)
    updates[binding.orderPath] = [...(Array.isArray(previous) ? previous : Object.keys(current)), id]
  }
  props.options.onPanelUpdate(updates)
  return id
}

export function RecordWorkspace(props: Props & { children: ReactNode; renderHeader?: (selection: Selection) => ReactElement }): ReactElement {
  const { t } = usePanelI18n()
  const sections = props.node.sources ?? []
  const graph = props.node.children?.find(child => child.component === 'relation_graph')?.graph
  const referenceBindings = props.node.children?.find(child => child.component === 'reference_graph')?.references
  const referenceGraph = referenceBindings !== undefined
  const workspaceLabel = (section: string, id: string, value: Record<string, unknown>) => {
    const node = referenceBindings?.nodes.find(node => node.source === section)
    if (node) return referenceRecordLabel(node, id, value, source => recordsAtPath(props.data, sectionBindingOf(props.manifest, source).recordsPath))
    const binding = sectionBindingOf(props.manifest, section)
    const record = recordsAtPath(props.data, binding.recordsPath)[id] ?? {}
    const ownSection = props.manifest.sections.find(item => item.id === section)
    // A detail projection shares its canonical owner's explicitly declared
    // title. A secondary system-name field must not hide a user rename.
    const titleOwner = ownSection?.form?.header ? ownSection : props.manifest.sections.find(item =>
      !item.fields_path && (item.records_path ?? item.id) === binding.recordsPath && item.form?.header)
    const title = titleOwner?.form?.header?.title
    if (title && 'field' in title) {
      const label = fieldValuesOf(record, titleOwner?.fields_path)[title.field]
      if (typeof label === 'string' && label.trim()) return label
    }
    return recordLabel({ ...record, ...value }, id)
  }
  const [view, setView] = useState<'form' | 'graph'>('form')
  const first = sections.flatMap(section => Object.keys(records(props, section)).map(record => ({ section, record })))[0]
  const [selection, setSelection] = useState<Selection | undefined>(first)
  const [returnTo, setReturnTo] = useState<Selection>()
  const select = (value: Selection) => { setReturnTo(undefined); setSelection(value) }
  const workspaceElement = useRef<HTMLElement>(null)
  const pendingNameFocus = useRef<Selection>()
  const selectCreatedRecord = (section: string, record: string) => {
    pendingNameFocus.current = { section, record }
    select({ section, record })
  }
  useEffect(() => {
    const pending = pendingNameFocus.current
    if (!pending) return
    if (props.options?.editable !== true || selection?.section !== pending.section || selection.record !== pending.record) {
      pendingNameFocus.current = undefined
      return
    }
    // Hosts may apply the insertion asynchronously. Wait for this exact record,
    // but never focus an existing selection or repeatedly steal focus on edits.
    if (!Object.hasOwn(records(props, pending.section), pending.record)) return
    pendingNameFocus.current = undefined
    const section = props.manifest.sections.find(item => item.id === pending.section)
    const nameKey = section?.create?.initial_label?.field
    const field = props.manifest.fields.find(item => item.key === nameKey && item.applies_to?.includes(pending.section))
    if (!field || field.readonly === true || field.control !== 'text') return
    const recordElement = [...(workspaceElement.current?.querySelectorAll<HTMLElement>('[data-record]') ?? [])]
      .find(element => element.dataset.record === pending.record
        && element.closest<HTMLElement>('[data-section]')?.dataset.section === pending.section)
    const header = section?.form?.header
    const input = header && 'field' in header.title && header.title.field === nameKey
      ? recordElement?.querySelector<HTMLInputElement>('[data-panel-title="editable"]')
      : [...(recordElement?.querySelectorAll<HTMLElement>('[data-field]') ?? [])]
        .find(element => element.dataset.field === nameKey)?.querySelector<HTMLInputElement>('input')
    if (input && !input.disabled && !input.readOnly) input.focus()
  }, [props.data, props.manifest, props.options?.editable, selection])
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => Object.fromEntries(sections.map(section => [section, true])))
  const [expandedNavigationGroups, setExpandedNavigationGroups] = useState<Record<string, boolean>>({})
  const [expandedRecords, setExpandedRecords] = useState<Record<string, boolean>>(() => first ? { [`${first.section}:${first.record}`]: true } : {})
  const [expandedContext, setExpandedContext] = useState<Record<string, boolean>>({})
  const [createRequest, setCreateRequest] = useState<HierarchyCreateRequest>()
  const [createLabel, setCreateLabel] = useState('')
  const createConfig = createRequest?.field?.hierarchy ?? createRequest?.graph?.hierarchy?.create
  const createTitle = createConfig?.create_title ?? createConfig?.create_label ?? t('createRecord')
  const createNameKey = createRequest?.field?.hierarchy?.label_field ?? createRequest?.graph?.label_field
  const createDescription = createRequest?.field?.hierarchy?.description ?? createRequest?.graph?.hierarchy?.description
  const inheritedFields = createRequest?.field?.hierarchy?.inherit_fields ?? []
  const selected = selection && sections.includes(selection.section) && Object.hasOwn(records(props, selection.section), selection.record) ? selection : first
  // Relationships are selected from their graph, not duplicated as navigation
  // branches. They remain in scope so the same inspector can edit selected edges.
  const navigableSections = sections.filter(section => section !== graph?.edges
    && props.manifest.sections.find(value => value.id === section)?.navigation !== 'contextual')
  const inlineArtifacts: Array<{ source: string; reference: string; target: string }> = []
  const collectInlineArtifacts = (node: ComponentNode) => {
    if (node.component === 'record_artifact' && node.source && node.artifact?.reference_field) {
      const field = props.manifest.fields.find(field => field.key === node.artifact!.reference_field
        && field.applies_to?.includes(node.source!))
      if (field?.options_from_section && !inlineArtifacts.some(binding => binding.source === node.source)) {
        inlineArtifacts.push({ source: node.source, reference: field.key, target: field.options_from_section })
      }
    }
    node.children?.forEach(collectInlineArtifacts)
  }
  props.node.children?.forEach(collectInlineArtifacts)
  const hierarchyField = (section: string) => props.manifest.fields.find(field => field.hierarchy !== undefined
    && field.control === 'record_select' && field.options_from_section === section && field.applies_to?.includes(section))
  const contextualChildren = (parentSection: string, parentRecord: string) => props.manifest.sections.flatMap(section => {
    if (!sections.includes(section.id) || section.navigation !== 'contextual') return []
    const reference = props.manifest.fields.find(field => field.applies_to?.includes(section.id)
      && referenceTargets(field).includes(parentSection)
      && ['record_select', 'record_multi_select'].includes(field.control))
    if (!reference || !contextualParents(props, reference, parentRecord)
      .some(parent => parent.section === parentSection)) return []
    if (inlineArtifacts.some(binding => binding.source === section.id && binding.reference === reference.key
      && binding.target === parentSection)) return []
    // Canvas/form workspaces expose these records in the selected owner's
    // related editor. Preserve contextual branches in ordinary tree workspaces.
    if (props.node.children?.some(child => child.component === 'record_inspector'
      && child.children?.some(editor => editor.component === 'record_related_editor'
        && (editor.inherit_from_graph || props.node.workspace_view === 'switch')
        && editor.source === section.id && editor.bindings?.reference === reference.key))) return []
    return [{ section, reference, entries: Object.entries(records(props, section.id))
      .filter(([, record]) => contextualParents(props, reference, record[reference.key])
        .some(parent => parent.section === parentSection && parent.record === parentRecord)) }]
  })
  // Incomplete or stale parent references must not make saved records disappear.
  // This is only a recovery projection; choosing a parent remains a user edit.
  const unlinkedContextRecords = sections.flatMap(section => {
    if (props.manifest.sections.find(value => value.id === section)?.navigation !== 'contextual') return []
    const parentReferences = props.manifest.fields.filter(field => field.applies_to?.includes(section)
      && referenceTargets(field).some(target => sections.includes(target))
      && ['record_select', 'record_multi_select'].includes(field.control))
    return Object.entries(records(props, section))
      .filter(([, record]) => !parentReferences.some(field => contextualParents(props, field, record[field.key])
        .some(parent => sections.includes(parent.section))))
      .map(([record, value]) => ({ section, record, label: workspaceLabel(section, record, value) }))
  })
  const beginHierarchy = (request: HierarchyCreateRequest) => {
    setCreateLabel('')
    setCreateRequest(request)
  }
  const submitHierarchy = () => {
    if (!createRequest || createLabel.trim() === '' || !props.options?.editable || !props.options.onPanelUpdate) return
    const parent = records(props, createRequest.section)[createRequest.parent]
    if (!parent) return
    let id: string | undefined
    if (createRequest.graph) {
      const planned = planRelationHierarchyCreate(props.manifest, props.options.canonicalData ?? props.data, createRequest.graph, createRequest.parent, createLabel)
      if (!planned) return
      props.options.onPanelUpdate(planned.updates)
      id = planned.nodeId
    } else {
      const hierarchy = createRequest.field.hierarchy!
      const values: Record<string, unknown> = {
        [hierarchy.label_field]: createLabel.trim(), [createRequest.field.key]: createRequest.parent,
      }
      for (const key of hierarchy.inherit_fields ?? []) {
        const value = parent[key]
        if (value !== undefined) values[key] = value
      }
      id = insertVisualRecord(props, createRequest.section, values)
    }
    if (!id) return
    const parentKey = `${createRequest.section}:${createRequest.parent}`
    setExpandedRecords(current => ({ ...current, [parentKey]: true }))
    setExpandedContext(current => ({ ...current, [`${parentKey}:${createRequest.section}`]: true }))
    select({ section: createRequest.section, record: id })
    setCreateRequest(undefined)
    setCreateLabel('')
  }
  useEffect(() => {
    if (!selected) return
    if (graph?.hierarchy && selected.section === graph.nodes) {
      const ancestors = relationAncestors(selected.record, records(props, graph.nodes), records(props, graph.edges), graph)
      setExpandedRecords(current => {
        const keys = ancestors.map(id => `${graph.nodes}:${id}`)
        return keys.every(key => current[key]) ? current : { ...current, ...Object.fromEntries(keys.map(key => [key, true])) }
      })
    }
    if (contextualChildren(selected.section, selected.record).length) {
      const selectedKey = `${selected.section}:${selected.record}`
      setExpandedRecords(current => current[selectedKey] ? current : { ...current, [selectedKey]: true })
    }
    const reference = props.manifest.fields.find(field => field.applies_to?.includes(selected.section)
      && referenceTargets(field).some(target => sections.includes(target))
      && ['record_select', 'record_multi_select'].includes(field.control))
    if (!reference) return
    const value = records(props, selected.section)[selected.record]?.[reference.key]
    for (const parent of contextualParents(props, reference, value)) {
      if (!sections.includes(parent.section)) continue
      const parentKey = `${parent.section}:${parent.record}`
      const contextKey = `${parentKey}:${selected.section}`
      setExpandedRecords(current => current[parentKey] ? current : { ...current, [parentKey]: true })
      setExpandedContext(current => current[contextKey] ? current : { ...current, [contextKey]: true })
      break
    }
  }, [selected?.section, selected?.record])
  const treeRecord = (section: string, id: string, value: Record<string, unknown>, ancestry = new Set<string>(), recordScope?: Set<string>): ReactElement => {
    const contexts = contextualChildren(section, id)
    const hierarchy = hierarchyField(section)
    const sectionRecords = records(props, section)
    const edgeHierarchy = graph?.hierarchy && graph.nodes === section ? graph : undefined
    const descendants = Object.entries(sectionRecords).filter(([childId, child]) => childId !== id && !ancestry.has(childId)
      && (!recordScope || recordScope.has(childId))
      && (hierarchy ? child[hierarchy.key] === id : edgeHierarchy
        ? relationParents(childId, sectionRecords, records(props, edgeHierarchy.edges), edgeHierarchy).includes(id) : false))
    const canCreateEdgeChild = !!(edgeHierarchy?.hierarchy?.create && props.options?.editable && props.options.onPanelUpdate)
    const hasChildren = contexts.length > 0 || hierarchy !== undefined || descendants.length > 0 || canCreateEdgeChild
    if (!hasChildren) return <PanelWorkspaceTreeRecord key={id} reserveToggle={!!(hierarchy || edgeHierarchy)} label={workspaceLabel(section, id, value)}
      ariaLabel={workspaceLabel(section, id, value)} selected={selected?.section === section && selected.record === id}
      onSelect={() => select({ section, record: id })} />
    const recordKey = `${section}:${id}`
    const nextAncestry = new Set(ancestry).add(id)
    return <PanelWorkspaceTreeRecord key={id} reserveToggle label={workspaceLabel(section, id, value)} ariaLabel={workspaceLabel(section, id, value)}
      selected={selected?.section === section && selected.record === id}
      expanded={expandedRecords[recordKey] ?? false}
      onToggle={() => setExpandedRecords(current => ({ ...current, [recordKey]: !(current[recordKey] ?? false) }))}
      onSelect={() => {
        select({ section, record: id })
        setExpandedRecords(current => current[recordKey] ? current : { ...current, [recordKey]: true })
      }}>
      {contexts.map(({ section: childSection, reference, entries }) => {
        const contextKey = `${recordKey}:${childSection.id}`
        const childName = childSection.item_name ?? childSection.title
        return <PanelWorkspaceTreeSubgroup key={childSection.id} label={childSection.title} count={entries.length}
          expanded={expandedContext[contextKey] ?? true}
          onToggle={() => setExpandedContext(current => ({ ...current, [contextKey]: !(current[contextKey] ?? true) }))}>
          {entries.map(([childId, child]) => <PanelWorkspaceTreeItem key={childId}
            ariaLabel={workspaceLabel(childSection.id, childId, child)} selected={selected?.section === childSection.id && selected.record === childId}
            onSelect={() => select({ section: childSection.id, record: childId })}>{workspaceLabel(childSection.id, childId, child)}</PanelWorkspaceTreeItem>)}
          {props.options?.editable && props.options.onPanelUpdate && childSection.add_mode === 'context' ? <PanelWorkspaceTreeAdd
            ariaLabel={t('addItem', { item: childName })} onAdd={() => {
              const referenceValue = reference.control === 'record_multi_select' ? [id] : id
              const childId = insertVisualRecord(props, childSection.id, { [reference.key]: referenceValue })
              if (childId) select({ section: childSection.id, record: childId })
            }}>{t('addItem', { item: childName })}</PanelWorkspaceTreeAdd> : null}
        </PanelWorkspaceTreeSubgroup>
      })}
      {hierarchy ? <PanelWorkspaceTreeSubgroup key={`hierarchy:${hierarchy.key}`}
        label={hierarchy.hierarchy!.group_label} count={descendants.length}
        expanded={expandedContext[`${recordKey}:${section}`] ?? true}
        onToggle={() => setExpandedContext(current => ({ ...current, [`${recordKey}:${section}`]: !(current[`${recordKey}:${section}`] ?? true) }))}>
        {descendants.map(([childId, child]) => treeRecord(section, childId, child, nextAncestry, recordScope))}
        {props.options?.editable && props.options.onPanelUpdate ? <PanelWorkspaceTreeAdd
          ariaLabel={hierarchy.hierarchy!.create_label ?? t('createItem', { item: hierarchy.hierarchy!.group_label })}
          onAdd={() => beginHierarchy({ section, parent: id, field: hierarchy })}>
          {hierarchy.hierarchy!.create_label ?? t('createItem', { item: hierarchy.hierarchy!.group_label })}
        </PanelWorkspaceTreeAdd> : null}
      </PanelWorkspaceTreeSubgroup> : null}
      {edgeHierarchy ? <>
        {descendants.map(([childId, child]) => treeRecord(section, childId, child, nextAncestry, recordScope))}
        {edgeHierarchy.hierarchy?.create && props.options?.editable && props.options.onPanelUpdate ? <PanelWorkspaceTreeAdd
          ariaLabel={`${edgeHierarchy.hierarchy.create.create_label}: ${workspaceLabel(section, id, value)}`}
          onAdd={() => beginHierarchy({ section, parent: id, graph: edgeHierarchy })}>
          {edgeHierarchy.hierarchy.create.create_label}
        </PanelWorkspaceTreeAdd> : null}
      </> : null}
    </PanelWorkspaceTreeRecord>
  }
  const roots = (section: string, entries: Array<[string, Record<string, unknown>]>) => {
    if (graph?.hierarchy && graph.nodes === section) {
      const ids = new Set(relationRoots(Object.fromEntries(entries), records(props, graph.edges), graph))
      return entries.filter(([id]) => ids.has(id))
    }
    const hierarchy = hierarchyField(section)
    if (!hierarchy) return entries
    const byId = new Map(entries)
    return entries.filter(([id, value]) => {
      let parent = value[hierarchy.key]
      if (typeof parent !== 'string' || !byId.has(parent) || parent === id) return true
      const seen = new Set([id])
      while (typeof parent === 'string' && byId.has(parent)) {
        if (seen.has(parent)) return true
        seen.add(parent)
        parent = byId.get(parent)?.[hierarchy.key]
      }
      return false
    })
  }
  const navigationGroupValue = (value: Record<string, unknown>): string | undefined => {
    const raw = value[props.node.navigation_group_by!]
    return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined
  }
  const selectedGroupKey = props.node.navigation_group_by && selected
    ? JSON.stringify([selected.section, navigationGroupValue(records(props, selected.section)[selected.record] ?? {}) ?? null])
    : undefined
  useEffect(() => {
    if (selectedGroupKey) setExpandedNavigationGroups(current => current[selectedGroupKey] === true
      ? current : { ...current, [selectedGroupKey]: true })
  }, [selectedGroupKey, selected?.record])
  const groupedNavigation = (section: string): ReactElement => {
    const definition = props.manifest.sections.find(value => value.id === section)
    const groups = new Map<string | undefined, Array<[string, Record<string, unknown>]>>()
    for (const entry of Object.entries(records(props, section))) {
      const group = navigationGroupValue(entry[1])
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group)!.push(entry)
    }
    const entries = <>
      {[...groups].map(([group, members]) => {
        const key = JSON.stringify([section, group ?? null])
        const scope = new Set(members.map(([id]) => id))
        const records = props.node.navigation_layout === 'list'
          ? members.map(([id, value]) => <PanelWorkspaceTreeItem key={id} ariaLabel={workspaceLabel(section, id, value)}
            selected={selected?.section === section && selected.record === id}
            onSelect={() => select({ section, record: id })}>{workspaceLabel(section, id, value)}</PanelWorkspaceTreeItem>)
          : roots(section, members).map(([id, value]) => treeRecord(section, id, value, new Set(), scope))
        if (!props.node.navigation_group_by) return <Fragment key={key}>{records}</Fragment>
        return <PanelWorkspaceTreeGroup key={key} label={group ?? t('ungrouped')}
          expanded={expandedNavigationGroups[key] ?? true}
          onToggle={() => setExpandedNavigationGroups(current => ({ ...current, [key]: !(current[key] ?? true) }))}>
          {records}
        </PanelWorkspaceTreeGroup>
      })}
      {props.options?.editable && props.options.onPanelUpdate && (definition?.add_mode === undefined || definition.add_mode === 'default')
        ? <PanelWorkspaceTreeAdd ariaLabel={t('addItem', { item: definition?.item_name ?? definition?.title ?? section })}
          onAdd={() => {
            const id = insertVisualRecord(props, section, {})
            if (id) selectCreatedRecord(section, id)
          }}>{t('addItem', { item: definition?.item_name ?? definition?.title ?? section })}</PanelWorkspaceTreeAdd> : null}
    </>
    return navigableSections.length === 1 ? <div key={section}>{entries}</div>
      : <PanelWorkspaceTreeGroup key={section} label={definition?.title ?? section}
        expanded={expandedSections[section] ?? true}
        onToggle={() => setExpandedSections(current => ({ ...current, [section]: !(current[section] ?? true) }))}>{entries}</PanelWorkspaceTreeGroup>
  }
  const hierarchy = props.node.navigation_hierarchy
  const hierarchySources = hierarchy ? [...new Set([hierarchy.root_source, hierarchy.child_source])] : []
  const hierarchyEntries = hierarchy ? hierarchySources.flatMap(section => Object.entries(records(props, section)).map(([id, value]) => ({ section, id, parent: value[hierarchy.field] }))) : []
  const hierarchyView = projectRecordHierarchy(hierarchyEntries)
  const addHierarchyRecord = (section: string, parent?: HierarchyRecord) => {
    if (!hierarchy || props.manifest.sections.find(item => item.id === section)?.add_mode === 'none' || (parent && hierarchyEntries.filter(entry => entry.id === parent.id).length !== 1)) return
    const id = insertVisualRecord(props, section, parent ? { [hierarchy.field]: parent.id } : {})
    if (id) {
      if (parent) setExpandedRecords(current => ({ ...current, [hierarchyKey(parent)]: true }))
      selectCreatedRecord(section, id)
    }
  }
  const hierarchyRecord = (entry: HierarchyRecord): ReactElement => {
    const key = hierarchyKey(entry), children = hierarchyView.children.get(key) ?? []
    const label = workspaceLabel(entry.section, entry.id, records(props, entry.section)[entry.id]!)
    const canAdd = !!(props.options?.editable && props.options.onPanelUpdate && props.manifest.sections.find(section => section.id === hierarchy!.child_source)?.add_mode !== 'none' && hierarchyEntries.filter(value => value.id === entry.id).length === 1)
    const child = props.manifest.sections.find(section => section.id === hierarchy!.child_source)
    const addLabel = t('addItem', { item: child?.item_name ?? child?.title ?? hierarchy!.child_source })
    return <PanelWorkspaceTreeRecord key={key} label={label} ariaLabel={label} reserveToggle
      selected={selected?.section === entry.section && selected.record === entry.id}
      expanded={expandedRecords[key] ?? (selected?.section === entry.section && selected.record === entry.id)}
      onSelect={() => {
        select({ section: entry.section, record: entry.id })
        setExpandedRecords(current => current[key] ? current : { ...current, [key]: true })
      }}
      onToggle={() => setExpandedRecords(current => ({ ...current, [key]: !(current[key] ?? (selected?.section === entry.section && selected.record === entry.id)) }))}>
      {children.map(hierarchyRecord)}
      {canAdd ? <PanelWorkspaceTreeAdd ariaLabel={addLabel} onAdd={() => addHierarchyRecord(hierarchy!.child_source, entry)}>{addLabel}</PanelWorkspaceTreeAdd> : null}
    </PanelWorkspaceTreeRecord>
  }
  const hierarchyContent = hierarchy ? <>
    {hierarchyView.issues.size ? <div className="dsh-relation-issues" role="alert">{hierarchyEntries.filter(entry => hierarchyView.issues.has(hierarchyKey(entry))).map(entry => <button key={hierarchyKey(entry)} type="button" onClick={() => select({ section: entry.section, record: entry.id })}>{workspaceLabel(entry.section, entry.id, records(props, entry.section)[entry.id]!)} · {hierarchyView.issues.get(hierarchyKey(entry)) === 'cycle' ? t('graphCycle') : t(hierarchyView.issues.get(hierarchyKey(entry)) === 'ambiguous' ? 'ambiguousReference' : 'staleReference', { value: String(entry.parent) })}</button>)}</div> : null}
    {hierarchyView.roots.map(hierarchyRecord)}
    {props.options?.editable && props.options.onPanelUpdate && props.manifest.sections.find(section => section.id === hierarchy.root_source)?.add_mode !== 'none' ? <PanelWorkspaceTreeAdd
      ariaLabel={t('addItem', { item: props.manifest.sections.find(section => section.id === hierarchy.root_source)?.item_name ?? hierarchy.root_source })}
      onAdd={() => addHierarchyRecord(hierarchy.root_source)}>{t('addItem', { item: props.manifest.sections.find(section => section.id === hierarchy.root_source)?.item_name ?? hierarchy.root_source })}</PanelWorkspaceTreeAdd> : null}
  </> : null
  const hierarchyNavigation = hierarchy ? navigableSections.map(section => {
    if (!hierarchySources.includes(section)) return groupedNavigation(section)
    if (section !== hierarchy.root_source) return null
    // Preserve authored collection order and one semantic collection heading.
    // A pure hierarchy needs no redundant wrapper or invented "Ungrouped" row.
    if (navigableSections.every(source => hierarchySources.includes(source))) return <Fragment key={section}>{hierarchyContent}</Fragment>
    const definition = props.manifest.sections.find(value => value.id === section)
    return <PanelWorkspaceTreeGroup key={section} label={definition?.title ?? section}
      expanded={expandedSections[section] ?? true}
      onToggle={() => setExpandedSections(current => ({ ...current, [section]: !(current[section] ?? true) }))}>{hierarchyContent}</PanelWorkspaceTreeGroup>
  }) : null
  const detailChildren = props.node.workspace_view === 'switch' ? props.node.children?.slice(1) : props.node.children
  const detailViews = detailChildren?.map(workspaceView)
  const detailWithPreview = detailViews?.length === 2
    && detailViews[0]?.component === 'record_inspector'
    && detailViews[1]?.component === 'record_preview'
  const detailTabs = detailViews?.length === 1 && detailViews[0]?.component === 'tabs'
    && (detailViews[0].children?.length ?? 0) > 0
  const tabViews = detailTabs ? detailViews[0]!.children!.map(workspaceView) : []
  const splitDetail = detailWithPreview || (detailViews?.length === 2
    && ['relation_graph', 'reference_graph'].includes(detailViews[0]!.component)
    && detailViews[1]?.component === 'record_inspector')
  // Sibling views describe the same selected record. Its original title and
  // lifecycle controls belong above those views, not inside the first page.
  const headerOutside = !!(graph?.hierarchy?.parent_control !== 'header' && props.node.workspace_view !== 'switch' && detailTabs && selected && props.renderHeader
    && props.manifest.sections.find(section => section.id === selected.section)?.form?.header?.variant !== 'card'
    && tabViews.filter(child => child.component === 'record_inspector').length === 1
    && tabViews.every(child => ['record_inspector', 'record_artifact'].includes(child.component)))
  // Tabs own their outer slot independently of sibling content types. The
  // direct inspector receives form rhythm locally, never the whole mixed frame.
  const detailForm = detailWithPreview || (detailChildren?.length === 1 && ['record_inspector', 'math_document'].includes(detailChildren[0]?.component ?? ''))
  return <SelectionContext.Provider value={{ selected, select, returnTo,
    openRelated: value => { setReturnTo(selected); setSelection(value) },
    createHierarchy: beginHierarchy, graph, referenceGraph, artifactReferences: inlineArtifacts, headerOutside, previewLayout: detailWithPreview,
    canvasView: props.node.workspace_view === 'switch' && view === 'graph',
    showDetails: props.node.workspace_view === 'switch' ? () => setView('form') : undefined }}>
    <RecordCardDraftScope><section ref={workspaceElement} className="dsh-record-workspace" aria-label={props.node.title ?? t('recordWorkspace')}>
      <PanelWorkspaceCover keepCoverMounted={props.node.workspace_view === 'switch'} active={props.node.workspace_view === 'switch' && view === 'graph'} label={t('relationCanvas')}
        onClose={() => setView('form')} cover={<div className="dsh-record-workspace-canvas">
          {Children.toArray(props.children)[0]}
          {selected && props.node.children?.[0]?.references?.layout?.kind !== 'hub' ? <button type="button" className="dsh-record-workspace-open-detail" onClick={() => setView('form')}>{t('recordDetails')}</button> : null}
        </div>}>
      <PanelWorkspace
        guidance={props.node.guidance}
        className={`dsh-record-workspace-frame${props.node.workspace_view === 'switch' ? ' is-canvas-switch' : ''}${detailForm ? ' is-record-form' : ''}${detailWithPreview ? ' is-record-preview' : ''}${detailTabs ? ' is-record-tabs' : ''}`}
        autoSaveId={`record-workspace:${props.manifest.panel_kind}:${props.node.id}`}
        sidebar={(
          <><PanelWorkspaceTree icon={sidebarIcon(props.node.sidebar_icon)} title={props.node.title ?? t('records')}>
            {unlinkedContextRecords.length > 0 ? <div className="dsh-relation-issues" role="alert">
              {unlinkedContextRecords.map(entry => <PanelWorkspaceTreeItem key={`${entry.section}:${entry.record}`}
                ariaLabel={`${entry.label} · ${t('unlinkedRecord')}`}
                selected={selected?.section === entry.section && selected.record === entry.record}
                onSelect={() => select({ section: entry.section, record: entry.record })}>
                {entry.label} · {t('unlinkedRecord')}
              </PanelWorkspaceTreeItem>)}
            </div> : null}
            {hierarchy ? hierarchyNavigation : props.node.navigation_group_by ? navigableSections.map(groupedNavigation) : props.node.navigation_layout === 'list' ? navigableSections.map(section => {
              const definition = props.manifest.sections.find(value => value.id === section)
              const label = t('addItem', { item: definition?.item_name ?? definition?.title ?? section })
              return <Fragment key={section}>
                {Object.entries(records(props, section)).map(([id, value]) => <PanelWorkspaceTreeItem
                  key={id} ariaLabel={workspaceLabel(section, id, value)}
                  selected={selected?.section === section && selected.record === id}
                  onSelect={() => select({ section, record: id })}>{workspaceLabel(section, id, value)}</PanelWorkspaceTreeItem>)}
                {props.options?.editable && props.options.onPanelUpdate
                  && (definition?.add_mode === undefined || definition.add_mode === 'default') ? <PanelWorkspaceTreeAdd
                    ariaLabel={label} onAdd={() => {
                      const id = insertVisualRecord(props, section, {})
                      if (id) selectCreatedRecord(section, id)
                    }}>{label}</PanelWorkspaceTreeAdd> : null}
              </Fragment>
            }) : navigableSections.map(section => {
              const definition = props.manifest.sections.find(value => value.id === section)
              const sectionRecords = Object.entries(records(props, section))
              const itemName = definition?.item_name ?? definition?.title ?? section
              const entries = <>
                {roots(section, sectionRecords).map(([id, value]) => treeRecord(section, id, value))}
                {props.options?.editable && props.options.onPanelUpdate && (definition?.add_mode === undefined || definition.add_mode === 'default') && <PanelWorkspaceTreeAdd onAdd={() => {
                  const id = insertVisualRecord(props, section, {})
                  if (id) selectCreatedRecord(section, id)
                }} ariaLabel={t('addItem', { item: itemName })}>{t('addItem', { item: itemName })}</PanelWorkspaceTreeAdd>}
              </>
              // One root collection already has workspace context. Keep its real
              // records and contextual children without a redundant category node,
              // whether or not this workspace also offers a graph.
              if (navigableSections.length === 1) return <Fragment key={section}>{entries}</Fragment>
              return <PanelWorkspaceTreeGroup
                key={section}
                label={definition?.title ?? section}
                expanded={expandedSections[section] ?? true}
                onToggle={() => setExpandedSections(current => ({ ...current, [section]: !(current[section] ?? true) }))}
              >
                {entries}
              </PanelWorkspaceTreeGroup>
            })}
          </PanelWorkspaceTree>
          {props.node.workspace_view === 'switch' ? <PanelWorkspaceCanvasToggle className="dsh-record-workspace-map-toggle"
            label={t('relationCanvas')} onOpen={() => setView('graph')} /> : null}</>
        )}
      >
        {props.node.workspace_view === 'switch' ? <>
          <div className="dsh-record-workspace-body is-detail-cover"><RecordFlowContext.Provider value>{Children.toArray(props.children).slice(1)}</RecordFlowContext.Provider></div>
        </> : <div className={`dsh-record-workspace-body${splitDetail ? ' is-split-view' : ''}${headerOutside ? ' has-record-header' : ''}`}>
          {headerOutside && selected ? <div className="dsh-record-workspace-header" key={JSON.stringify(selected)}>{props.renderHeader!(selected)}</div> : null}
          <RecordFlowContext.Provider value>{props.children}</RecordFlowContext.Provider>
        </div>}
      </PanelWorkspace>
      </PanelWorkspaceCover>
      {createRequest && props.options?.editable && props.options.onPanelUpdate ? <div className="dsh-record-create-backdrop" onMouseDown={event => {
        if (event.currentTarget === event.target) setCreateRequest(undefined)
      }}>
        <form className="dsh-record-create-sheet" role="dialog" aria-modal="true"
          aria-label={createTitle}
          onSubmit={event => { event.preventDefault(); submitHierarchy() }}>
          <header>
            <div><h2>{createTitle}</h2>
              {createDescription ? <p>{createDescription}</p> : null}</div>
            <button type="button" aria-label={t('close')} onClick={() => setCreateRequest(undefined)}>×</button>
          </header>
          <div className="dsh-record-create-sheet-body">
            <label><span>{props.manifest.fields.find(field => field.key === createNameKey
              && field.applies_to?.includes(createRequest.section))?.label ?? t('recordName')}</span>
              <input autoFocus value={createLabel} onChange={event => setCreateLabel(event.target.value)} /></label>
            <div className="dsh-record-create-parent"><span>{t('basedOn')}</span><strong>{recordLabel(
              records(props, createRequest.section)[createRequest.parent] ?? {}, createRequest.parent)}</strong></div>
            {inheritedFields.length > 0 ? <p className="dsh-record-create-inherits">
              {t('recordInheritHint', { fields: inheritedFields.map(key => props.manifest.fields.find(field => field.key === key
                && field.applies_to?.includes(createRequest.section))?.label ?? key).join(t('listSeparator')) })}
            </p> : null}
          </div>
          <footer><button type="button" onClick={() => setCreateRequest(undefined)}>{t('cancel')}</button>
            <button type="submit" className="is-primary" disabled={createLabel.trim() === '' || !Object.hasOwn(records(props, createRequest.section), createRequest.parent)}>{t('create')}</button></footer>
        </form>
      </div> : null}
    </section></RecordCardDraftScope>
  </SelectionContext.Provider>
}

function referencesRecord(value: unknown, record: string): boolean {
  return Array.isArray(value) ? value.includes(record) : value === record
}

/** A reference to the owning definition, never a copy of inherited fields. */
function RecordInheritance({ graph, parents, nodes, select }: {
  graph: NonNullable<ComponentNode['graph']>
  parents: readonly string[]
  nodes: RecordMap
  select: (value: Selection) => void
}): ReactElement | null {
  const { t } = usePanelI18n()
  if (!graph.hierarchy || !parents.length) return null
  return <section className="dsh-record-inheritance" aria-label={graph.hierarchy.label}>
    <div className="dsh-record-inheritance-heading">
      <span className="dsh-record-inheritance-label"><GitBranch size={16} aria-hidden="true" />{graph.hierarchy.label}</span>
      <div className="dsh-record-inheritance-parents">
        {parents.map(id => {
          const label = String(nodes[id]?.[graph.label_field] ?? id)
          const action = t('viewSourceRecord', { item: label })
          return <button key={id} type="button" className="dsh-record-inheritance-parent"
            aria-label={action} title={action} onClick={() => select({ section: graph.nodes, record: id })}>
            <span>{label}</span><ArrowUpRight size={14} aria-hidden="true" />
          </button>
        })}
      </div>
    </div>
    {graph.hierarchy.description ? <p>{graph.hierarchy.description}</p> : null}
  </section>
}

export function RecordInspector(props: Props & { render: (selection: Selection, headerAccessory?: ReactNode, headerOutside?: boolean) => ReactElement; children?: ReactNode }): ReactElement {
  const { t } = usePanelI18n()
  const { selected, select, returnTo, createHierarchy, graph, canvasView, showDetails, artifactReferences, headerOutside, previewLayout } = useContext(SelectionContext)
  const [actionError, setActionError] = useState('')
  useEffect(() => setActionError(''), [selected?.section, selected?.record])
  const directParents = graph?.hierarchy && selected?.section === graph.nodes
    ? relationParents(selected.record, records(props, graph.nodes), records(props, graph.edges), graph) : []
  const currentEdge = graph && selected?.section === graph.edges ? records(props, graph.edges)[selected.record] : undefined
  const invalidCycle = graph && currentEdge && selected ? relationHasCycle(selected.record, currentEdge, records(props, graph.edges), graph) : false
  const invalidParent = graph && currentEdge && selected ? relationHasParentConflict(selected.record, currentEdge, records(props, graph.edges), graph) : false
  const contextual = selected ? props.manifest.sections.flatMap(section => {
    if (section.navigation !== 'contextual') return []
    const reference = props.manifest.fields.find(field => field.applies_to?.includes(section.id)
      && referenceTargets(field).includes(selected.section)
      && ['record_select', 'record_multi_select'].includes(field.control))
    if (!reference || !contextualParents(props, reference, selected.record)
      .some(parent => parent.section === selected.section)) return []
    // An explicit selected-parent editor already presents this collection.
    // Keep summaries for all other references; no Bundle field names belong here.
    const covered = artifactReferences?.some(binding => binding.source === section.id
      && binding.reference === reference.key && binding.target === selected.section)
      || props.node.children?.some(child => child.source === section.id
      && ((child.component === 'record_related_editor' && child.bindings?.reference === reference.key)
        || (child.component === 'record_artifact' && child.artifact?.reference_field === reference.key)))
    if (covered) return []
    return [{ section, reference, entries: Object.entries(records(props, section.id))
      .filter(([, record]) => contextualParents(props, reference, record[reference.key])
        .some(parent => parent.section === selected.section && parent.record === selected.record)) }]
  }) : []
  // A return link belongs only to an explicit related-preview detail action.
  // Sidebar selection and arbitrary canonical references never invent a trail.
  const parent = returnTo && Object.hasOwn(records(props, returnTo.section), returnTo.record) ? returnTo : undefined
  const hierarchy = selected ? props.manifest.fields.find(field => field.hierarchy !== undefined
    && field.control === 'record_select' && field.options_from_section === selected.section
    && field.applies_to?.includes(selected.section)) : undefined
  if (canvasView && graph && selected?.section === graph.nodes) {
    const nodes = records(props, graph.nodes), edges = records(props, graph.edges)
    const value = nodes[selected.record] ?? {}
    const ancestors = relationAncestors(selected.record, nodes, edges, graph).filter(id => !directParents.includes(id))
    const related = Object.entries(edges).filter(([, edge]) => graph.participants
      ? relationParticipants(edge, graph).some(item => item.object === selected.record)
      : edge[graph.source_field!] === selected.record || edge[graph.target_field!] === selected.record)
    const jump = (id: string) => <button key={id} type="button" onClick={() => select({ section: graph.nodes, record: id })}>{String(nodes[id]?.[graph.label_field] ?? id)}</button>
    return <aside className="dsh-record-inspector dsh-record-graph-summary" aria-label={t('recordProperties')}>
      <h3>{String(value[graph.label_field] ?? selected.record)}</h3>
      {graph.node_description_field && value[graph.node_description_field] ? <p>{String(value[graph.node_description_field])}</p> : null}
      <button type="button" onClick={showDetails}>{t('recordDetails')}</button>
      <RecordInheritance graph={graph} parents={directParents} nodes={nodes} select={select} />
      {ancestors.length ? <section className="dsh-record-context-summary"><strong>{t('graphAncestors')}</strong>{ancestors.map(jump)}</section> : null}
      {related.length ? <section className="dsh-record-context-summary"><strong>{t('graphRelated')}</strong>
        {related.map(([id, edge]) => {
          if (graph.participants) return <button key={id} type="button" onClick={() => select({ section: graph.edges, record: id })}>
            {String(edge[graph.label_field] ?? id)} · {relationParticipants(edge, graph).map(item =>
              `${String(nodes[String(item.object)]?.[graph.label_field] ?? item.object ?? '')}${item.role ? ` (${String(item.role)})` : ''}`).join(' · ')}
          </button>
          const source = String(edge[graph.source_field!] ?? ''), target = String(edge[graph.target_field!] ?? '')
          return <button key={id} type="button" onClick={() => select({ section: graph.edges, record: id })}>
            {String(nodes[source]?.[graph.label_field] ?? source)} → {String(edge[graph.label_field] ?? id)} → {String(nodes[target]?.[graph.label_field] ?? target)}
          </button>
        })}
      </section> : null}
    </aside>
  }
  const inlineParent = graph?.hierarchy?.parent_control === 'header' && selected?.section === graph.nodes
  const headerAccessory = inlineParent ? <span className="dsh-record-parent-inline">
    <span>{graph.hierarchy!.label}</span>
    {props.options?.editable && props.options.onPanelUpdate ? <PanelSelect
      aria-label={graph.hierarchy!.label} value={directParents[0] ?? ''} disabled={directParents.length > 1}
      options={[{ value: '', label: t('noParent') }, ...Object.entries(records(props, graph.nodes)).filter(([id]) => id !== selected.record).map(([id, value]) => ({ value: id,
        label: String(value[graph.label_field] ?? id), disabled: relationHasCycle('__candidate__', { [graph.source_field!]: selected.record,
          [graph.target_field!]: id, [graph.edge_kind_field!]: graph.hierarchy!.values[0] }, records(props, graph.edges), graph) }))]}
      onValueChange={value => {
        const updates = planRelationParentEdit(props.manifest, props.options!.canonicalData ?? props.data, graph, selected.record, value)
        if (!updates) { setActionError(t('graphInvalidParent')); return }
        setActionError('')
        if (Object.keys(updates).length) props.options!.onPanelUpdate!(updates)
      }} /> : <span className="dsh-record-parent-value">{directParents.length
        ? directParents.map(id => String(records(props, graph.nodes)[id]?.[graph.label_field] ?? id)).join(t('listSeparator')) : t('noParent')}</span>}
    {directParents.length === 1 ? <button type="button" className="dsh-record-parent-source" aria-label={t('viewSourceRecord', { item: String(records(props, graph.nodes)[directParents[0]!]!?.[graph.label_field] ?? directParents[0]) })}
      onClick={() => select({ section: graph.nodes, record: directParents[0]! })}><ArrowUpRight size={14} aria-hidden="true" /></button> : null}
  </span> : undefined
  return <aside className={`dsh-record-inspector${previewLayout ? ' is-preview-pane' : ''}`} aria-label={t('recordProperties')}>
    {graph && !inlineParent ? <RecordInheritance graph={graph} parents={directParents} nodes={records(props, graph.nodes)} select={select} /> : null}
    {!inlineParent && graph?.hierarchy?.max_parents === 1 && selected?.section === graph.nodes && props.options?.editable && props.options.onPanelUpdate ?
      <label className="dsh-record-parent-select"><span>{graph.hierarchy.label}</span>
        <select aria-label={graph.hierarchy.label} value={directParents[0] ?? ''} disabled={directParents.length > 1}
          onChange={event => {
            const updates = planRelationParentEdit(props.manifest, props.options!.canonicalData ?? props.data, graph, selected.record, event.currentTarget.value)
            if (!updates) { setActionError(t('graphInvalidParent')); return }
            setActionError('')
            if (Object.keys(updates).length) props.options!.onPanelUpdate!(updates)
          }}>
          <option value="">{t('noParent')}</option>
          {Object.entries(records(props, graph.nodes)).filter(([id]) => id !== selected.record).map(([id, record]) => <option key={id} value={id}
            disabled={relationHasCycle('__candidate__', { [graph.source_field!]: selected.record, [graph.target_field!]: id,
              [graph.edge_kind_field!]: graph.hierarchy!.values[0] }, records(props, graph.edges), graph)}>
            {String(record[graph.label_field] ?? id)}</option>)}
        </select>
      </label> : null}
    {graph?.reverse && currentEdge && selected && props.options?.editable && props.options.onPanelUpdate ? <button type="button" onClick={() => {
      const next = reverseRelation(currentEdge, graph)
      if (relationHasCycle(selected.record, next, records(props, graph.edges), graph)) { setActionError(t('graphCycle')); return }
      if (relationHasParentConflict(selected.record, next, records(props, graph.edges), graph)) { setActionError(t('graphSingleParent')); return }
      const binding = sectionBindingOf(props.manifest, graph.edges)
      const original = recordsAtPath(props.data, binding.recordsPath)
      const record = binding.fieldsPath ? pathSet(original[selected.record]!, binding.fieldsPath, next) : next
      props.options!.onPanelUpdate!({ [binding.recordsPath]: { ...original, [selected.record]: record } })
      setActionError('')
    }}>{graph.reverse.label}</button> : null}
    {invalidCycle || invalidParent || directParents.length > (graph?.hierarchy?.max_parents ?? Infinity) || actionError
      ? <p role="alert">{actionError || (invalidCycle ? t('graphCycle') : t('graphSingleParent'))}</p> : null}
    {parent ? <button type="button" className="dsh-record-inspector-back" onClick={() => select(parent)}>
      ← {t('backTo', { item: recordLabel(records(props, parent.section)[parent.record]!, parent.record) })}
    </button> : null}
    {selected ? <RecordFlowContext.Provider value={false}>
      <div className="dsh-record-inspector-content" key={JSON.stringify(selected)}>{props.render(selected, headerAccessory, headerOutside)}</div>
      {props.children}
    </RecordFlowContext.Provider> : <p>{props.manifest.empty_description ?? t('selectRecord')}</p>}
    {contextual.length ? <section className="dsh-record-context-summary" aria-label={t('childRecords')}>
      {contextual.map(({ section, entries }) => <div key={section.id}>
        <span>{section.title}</span><strong>{entries.length}</strong>
      </div>)}
      <p>{t('childNavigation')}</p>
    </section> : null}
    {selected && hierarchy && props.options?.editable && props.options.onPanelUpdate ? <button type="button"
      className="dsh-record-hierarchy-create" onClick={() => createHierarchy?.({ section: selected.section, parent: selected.record, field: hierarchy })}>
      ＋ {hierarchy.hierarchy!.create_label ?? t('createItem', { item: hierarchy.hierarchy!.group_label })}
    </button> : null}
    {selected && selected.section === graph?.nodes && graph?.hierarchy?.create && props.options?.editable && props.options.onPanelUpdate ? <button type="button"
      className="dsh-record-hierarchy-create" onClick={() => createHierarchy?.({ section: graph.nodes, parent: selected.record, graph })}>
      <Plus size={16} aria-hidden="true" /> {graph.hierarchy.create.create_label}
    </button> : null}
  </aside>
}

/** Flat canonical collections stay flat: this is only a selected-parent view. */
export function RecordRelatedEditor(props: Props & { render: (ids: readonly string[], readonly?: boolean) => ReactElement }): ReactElement | null {
  const { selected, graph, select } = useContext(SelectionContext)
  const { t } = usePanelI18n()
  const source = props.node.source!
  const field = props.manifest.fields.find(field => field.key === props.node.bindings?.reference && field.applies_to?.includes(source))!
  const targets = field.options_from_sections ?? (field.options_from_section ? [field.options_from_section] : [])
  if (!selected || !targets.includes(selected.section)) return null
  if (targets.filter(target => Object.hasOwn(records(props, target), selected.record)).length !== 1) return null
  const ids = Object.entries(records(props, source)).filter(([, value]) => referencesRecord(value[field.key], selected.record)).map(([id]) => id)
  const definition = props.manifest.sections.find(section => section.id === source)!
  const inherited = props.node.inherit_from_graph && graph?.hierarchy && selected.section === graph.nodes
    ? relationAncestors(selected.record, records(props, graph.nodes), records(props, graph.edges), graph).flatMap(parent => {
      const entries = Object.entries(records(props, source)).filter(([, value]) => value[field.key] === parent).map(([id]) => id)
      return entries.length ? [{ parent, entries, label: String(records(props, graph.nodes)[parent]?.[graph.label_field] ?? parent) }] : []
    }) : []
  return <section className="dsh-record-related-editor" aria-label={props.node.title ?? definition.title}>
    {inherited.map(({ parent, entries, label }) => <section key={parent} className="dsh-record-inherited-related" aria-label={t('inheritedFrom', { item: label })}>
      <header><h3>{t('inheritedFrom', { item: label })}</h3><button type="button" className="dsh-record-inherited-source"
        aria-label={t('viewSourceRecord', { item: label })} title={t('viewSourceRecord', { item: label })}
        onClick={() => select({ section: graph!.nodes, record: parent })}><ArrowUpRight size={14} aria-hidden="true" />{t('recordDetails')}</button></header>
      {props.render(entries, true)}
    </section>)}
    <header><h3>{props.node.title ?? definition.title}</h3></header>
    {props.node.description ? <p>{props.node.description}</p> : null}
    {props.render(ids)}
    {props.options?.editable && props.options.onPanelUpdate ? <button type="button" className="dsh-record-related-add"
      aria-label={t('addItem', { item: definition.item_name ?? definition.title })}
      title={t('addItem', { item: definition.item_name ?? definition.title })}
      onClick={() => insertVisualRecord(props, source, { [field.key]: field.control === 'record_multi_select' ? [selected.record] : selected.record })}>
      <Plus size={16} aria-hidden="true" />{t('add')}
    </button> : null}
  </section>
}

export function RecordPreview(props: Props & { record?: string }): ReactElement {
  const { t } = usePanelI18n()
  const { selected, previewLayout } = useContext(SelectionContext)
  const binding = props.node.preview!
  const selection = props.record !== undefined ? { section: props.node.source!, record: props.record } : selected
  const value = selection && selection.section === props.node.source ? records(props, selection.section)[selection.record] : undefined
  return <section className={`dsh-record-preview${previewLayout ? ' is-preview-pane' : ''}`} aria-label={props.node.title ?? t('preview')}>
    <small>{props.node.title ?? t('preview')}</small>
    {value ? <article><h3>{String(value[binding.title] ?? '')}</h3>
      <p>{String(value[binding.body] || binding.empty || t('emptyContent'))}</p>
      {binding.action && value[binding.action] ? <strong>{String(value[binding.action])} →</strong> : null}
    </article> : <p>{t('selectPreview')}</p>}
  </section>
}

/** A retained canvas can have measured nodes but no measured handle bounds.
 * Use React Flow's public measurement hook after visibility/geometry changes;
 * dimensions and routing remain transient, never canonical Panel updates.
 */
function RelationGraphGeometrySync({ nodes, active, canvas }: {
  nodes: readonly Node[]; active: boolean; canvas: Readonly<{ current: HTMLDivElement | null }>
}): null {
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    // Do not request DOM measurement before the canvas has a usable viewport.
    if (!active || !nodes.length || !canvas.current?.offsetWidth || !canvas.current.offsetHeight) return
    const frame = requestAnimationFrame(() => updateNodeInternals(nodes.map(node => node.id)))
    return () => cancelAnimationFrame(frame)
  }, [nodes, active, canvas, updateNodeInternals])
  return null
}

/** Reuse the regular canvas with an isolated read-only projection. Selection maps
 * back to the original section; no synthetic state can reach the save callbacks. */
export function ReferenceGraph(props: Props): ReactElement {
  const { t } = usePanelI18n()
  const readRecord = (source: string) => recordsAtPath(props.data, sectionBindingOf(props.manifest, source).recordsPath)
  const parent = useContext(SelectionContext)
  if (props.node.references?.layout?.kind === 'hub') return <ReferenceHub node={props.node} manifest={props.manifest}
    read={source => records(props, source)} readRecord={readRecord} selected={parent.selected} select={parent.select} showDetails={parent.showDetails} />
  const projection = projectReferenceGraph(props.node.references!, source => records(props, source),
    source => props.manifest.sections.find(section => section.id === source)?.title ?? source, readRecord)
  const nodeSection = '__reference_nodes', edgeSection = '__reference_edges'
  const selectedKey = parent.selected && referenceNodeKey(parent.selected.section, parent.selected.record)
  const manifest: PanelManifest = { ...props.manifest,
    sections: [{ id: nodeSection, title: '' }, { id: edgeSection, title: '' }],
    fields: [{ key: 'name', label: '', control: 'text', applies_to: [nodeSection, edgeSection] },
      { key: 'kind', label: '', control: 'text', applies_to: [nodeSection] }] }
  return <SelectionContext.Provider value={{
    selected: selectedKey ? { section: nodeSection, record: selectedKey } : undefined,
    select: selected => { const owner = projection.owners[selected.record]; if (owner) parent.select(owner) },
    showDetails: parent.showDetails, canvasView: parent.canvasView,
  }}>
    {projection.missing.length ? <div className="dsh-relation-issues" role="alert">
      {projection.missing.map((value, index) => <button key={index} type="button" onClick={() => {
        parent.select({ section: value.section, record: value.record }); parent.showDetails?.()
      }}>{referenceRecordLabel(props.node.references!.nodes.find(node => node.source === value.section)!, value.record,
        records(props, value.section)[value.record] ?? {}, readRecord)} · {props.manifest.fields.find(field =>
        field.key === value.field && field.applies_to?.includes(value.section))?.label ?? value.field}: {t(value.reason === 'ambiguous' ? 'ambiguousReference' : 'staleReference', { value: value.id })}</button>)}
    </div> : null}
    <RelationGraph node={{ ...props.node, component: 'relation_graph', references: undefined,
      graph: { nodes: nodeSection, edges: edgeSection, source_field: 'source', target_field: 'target', label_field: 'name', node_kind_field: 'kind' } }}
      manifest={manifest} data={{ [nodeSection]: projection.nodes, [edgeSection]: projection.edges }}
      options={{ ...props.options, editable: false, onEdit: undefined, onPanelUpdate: undefined, onTransaction: undefined }} />
  </SelectionContext.Provider>
}

export function RelationGraph(props: Props): ReactElement {
  return props.node.graph?.participants ? <ParticipantRelationGraph {...props} /> : <RelationCanvas {...props} />
}

/** Map the finite incidence view back to original records. No projected node,
 * edge, label, or coordinate can enter a Panel update or a saved Design File. */
function ParticipantRelationGraph(props: Props): ReactElement {
  const parent = useContext(SelectionContext), { t } = usePanelI18n()
  const graph = props.node.graph!, binding = graph.participants!
  const originals = records(props, graph.nodes), relations = records(props, graph.edges)
  const base = projectParticipantRelations(originals, relations, graph)
  const contextProjection = props.node.references ? withReferenceContext(base, props.node.references,
    source => records(props, source), source => props.manifest.sections.find(section => section.id === source)?.title ?? source) : undefined
  const projection = contextProjection ?? base
  const nodeIcons: Record<string, SidebarIcon> = {}
  const undirected = new Set(Object.entries(base.edges).filter(([, value]) => !base.connectable.has(String(value.target))).map(([id]) => id))
  const nodes = '__participant_nodes', edges = '__participant_edges'
  for (const [key, value] of Object.entries(projection.nodes)) {
    const owner = projection.owners[key]!
    const context = props.node.references?.nodes.find(node => node.source === owner.section)
    const original = context && records(props, owner.section)[owner.record]
    const icon = context?.kind_icons?.[String(original?.[context.kind_field ?? ''])] ?? context?.icon
    if (icon) nodeIcons[key] = icon
    if (owner.section !== graph.nodes && owner.section !== graph.edges) {
      const kind = context && displayValue(props.manifest, owner.section, context.kind_field, original?.[context.kind_field ?? ''])
      value.kind = [value.kind, kind].filter(Boolean).join(' · ')
      continue
    }
    const isRelation = owner.section === graph.edges
    const kind = displayValue(props.manifest, owner.section, isRelation ? graph.edge_kind_field : graph.node_kind_field, value.kind)
    value.kind = isRelation ? [props.manifest.sections.find(section => section.id === graph.edges)?.title, kind].filter(Boolean).join(' · ') : kind
  }
  for (const value of Object.values(projection.edges)) value.kind = displayValue(props.manifest, graph.edges, graph.edge_kind_field, value.kind)
  const selectedEntry = Object.entries(projection.owners).find(([key, owner]) => owner.section === parent.selected?.section
    && owner.record === parent.selected.record && (Object.hasOwn(projection.nodes, key) || Object.hasOwn(projection.edges, key)))
  const manifest: PanelManifest = { ...props.manifest,
    sections: [{ id: nodes, title: '' }, { id: edges, title: '' }],
    fields: [{ key: 'title', label: '', control: 'text', applies_to: [nodes, edges] },
      ...['kind', 'source_role', 'target_role'].map(key => ({ key, label: '', control: 'text' as const, applies_to: [nodes, edges] }))] }
  const createConnection = props.options?.editable && props.options.onPanelUpdate ? (source: string, target: string) => {
    const from = projection.owners[source], to = projection.owners[target]
    if (from?.section !== graph.nodes || to?.section !== graph.nodes) return
    const id = insertVisualRecord(props, graph.edges, {
      ...graph.edge_defaults, [graph.label_field]: `${String(originals[from.record]?.[graph.label_field] ?? from.record)} → ${String(originals[to.record]?.[graph.label_field] ?? to.record)}`,
      [binding.field]: {
        p1: { [binding.reference_field]: from.record },
        p2: { [binding.reference_field]: to.record },
      },
      [binding.order_field]: ['p1', 'p2'],
    })
    if (id) parent.select({ section: graph.edges, record: id })
    return id ? JSON.stringify([graph.edges, id, 'binary']) : undefined
  } : undefined
  return <SelectionContext.Provider value={{
    selected: selectedEntry ? { section: Object.hasOwn(projection.nodes, selectedEntry[0]) ? nodes : edges, record: selectedEntry[0] } : undefined,
    select: selected => { const owner = projection.owners[selected.record]; if (owner) parent.select(owner) },
    showDetails: parent.showDetails, canvasView: parent.canvasView,
  }}>
    {projection.invalid.length ? <div className="dsh-relation-issues" role="alert"><p>{t('graphMissingEndpoints', { count: projection.invalid.length })}</p>
      {projection.invalid.map(id => <button type="button" key={id} onClick={() => {
        parent.select({ section: graph.edges, record: id }); parent.showDetails?.()
      }}>{String(relations[id]?.[graph.label_field] ?? id)}</button>)}
    </div> : null}
    {contextProjection?.missing.length ? <div className="dsh-relation-issues" role="alert">
      {contextProjection.missing.map((value, index) => <button key={index} type="button" onClick={() => {
        parent.select({ section: value.section, record: value.record }); parent.showDetails?.()
      }}>{recordLabel(records(props, value.section)[value.record] ?? {}, value.record)} · {props.manifest.fields.find(field =>
        field.key === value.field && field.applies_to?.includes(value.section))?.label ?? value.field}: {value.id} ⚠</button>)}
    </div> : null}
    <RelationCanvas node={{ ...props.node, graph: {
      nodes, edges, source_field: 'source', target_field: 'target', label_field: 'title', node_kind_field: 'kind', edge_kind_field: 'kind',
      source_annotation_field: 'source_role', target_annotation_field: 'target_role', edge_state_field: 'state', edge_pending_values: graph.edge_pending_values,
    } }} manifest={manifest} data={{ [nodes]: projection.nodes, [edges]: projection.edges }}
      options={{ ...props.options, onEdit: undefined, onPanelUpdate: undefined, onTransaction: undefined }}
      createConnection={createConnection} connectableRecords={projection.connectable}
      nodeIcons={nodeIcons}
      counts={t('graphCounts', { nodes: Object.keys(originals).length, edges: Object.keys(relations).length - projection.invalid.length })
        + (contextProjection ? t('graphContextCounts', { nodes: contextProjection.contextNodes, references: contextProjection.referenceEdges.size }) : '')}
      undirectedRecords={undirected} />
  </SelectionContext.Provider>
}

function RelationCanvas(props: Props & { createConnection?: (source: string, target: string) => string | undefined;
  connectableRecords?: ReadonlySet<string>; undirectedRecords?: ReadonlySet<string>; counts?: string;
  nodeIcons?: Readonly<Record<string, SidebarIcon>> }): ReactElement {
  const binding = props.node.graph!
  const { t } = usePanelI18n()
  const { selected, select, showDetails, canvasView } = useContext(SelectionContext)
  const nodeRecords = records(props, binding.nodes), edgeRecords = records(props, binding.edges)
  const projection = graphRecords(nodeRecords, edgeRecords, binding.source_field!, binding.target_field!)
  const validEdgeIds = new Set(projection.valid.map(edge => edge.id))
  const invalidEdgeIds = Object.keys(edgeRecords).filter(id => !validEdgeIds.has(id))
  const [edgePorts, setEdgePorts] = useState<Record<string, { source: string; target: string; sourceSide: RelationSide; targetSide: RelationSide }>>({})
  const canonicalStructure = JSON.stringify([Object.keys(nodeRecords), projection.valid])
  const edgeCopy = (link: { id: string; source: string; target: string }) => {
    const value = edgeRecords[link.id] ?? {}
    const sourceLabel = String(nodeRecords[link.source]?.[binding.label_field] ?? link.source)
    const targetLabel = String(nodeRecords[link.target]?.[binding.label_field] ?? link.target)
    const kindLabel = displayValue(props.manifest, binding.edges, binding.edge_kind_field, value[binding.edge_kind_field ?? ''])
    return { sourceLabel, targetLabel, kindLabel,
      label: relationCanvasLabel(value[binding.label_field], sourceLabel, targetLabel, kindLabel) }
  }
  // Handle choice belongs to the current view, never a Design File. Drop it
  // when its canonical edge disappears or changes direction/endpoints.
  useEffect(() => setEdgePorts(previous => {
    const kept = Object.fromEntries(Object.entries(previous).filter(([id, ports]) => projection.valid.some(link =>
      link.id === id && link.source === ports.source && link.target === ports.target)))
    return Object.keys(kept).length === Object.keys(previous).length ? previous : kept
  }), [canonicalStructure])
  const portsFor = (link: { id: string; source: string; target: string }) => {
    const ports = edgePorts[link.id]
    return ports?.source === link.source && ports.target === link.target
      ? { sourceSide: ports.sourceSide, targetSide: ports.targetSide } : { sourceSide: 'right' as const, targetSide: 'left' as const }
  }
  const structure = JSON.stringify([Object.keys(nodeRecords), projection.valid.map(link => ({ ...link, ...portsFor(link) }))])
  const [nodes, setNodes] = useState<Node[]>([])
  const [routes, setRoutes] = useState<Record<string, RelationRoute>>({})
  const [measurements, setMeasurements] = useState<Record<string, GraphSize>>({})
  const presentation = JSON.stringify([Object.values(nodeRecords).map(value => [value[binding.label_field], value[binding.node_kind_field ?? '']]),
    Object.values(edgeRecords).map(value => [value[binding.label_field], value[binding.edge_kind_field ?? ''], value[binding.source_annotation_field ?? ''], value[binding.target_annotation_field ?? '']]), props.manifest.i18n, t('relationGraph')])
  const [flow, setFlow] = useState<ReactFlowInstance>()
  const canvasElement = useRef<HTMLDivElement>(null)
  const layoutBounds = useRef<{ x: number; y: number; width: number; height: number }>()
  useFlowContainerFit(canvasElement, flow, layoutBounds)
  useEffect(() => {
    const element = canvasElement.current
    if (!element) return
    let frame = 0
    const measure = () => {
      const next: Record<string, GraphSize> = {}
      element.querySelectorAll<HTMLElement>('[data-graph-measure]').forEach(item => {
        // offset sizes are graph-space CSS pixels, independent of zoom/fitView.
        if (item.offsetWidth && item.offsetHeight) next[item.dataset.graphMeasure!] = { width: item.offsetWidth, height: item.offsetHeight }
      })
      if (Object.keys(next).length) setMeasurements(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) })
    element.querySelectorAll('[data-graph-measure]').forEach(item => observer.observe(item))
    measure()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [structure, presentation, nodes.length, flow])
  const [layoutError, setLayoutError] = useState('')
  const [layoutRequest, setLayoutRequest] = useState(0)
  const [connectMode, setConnectMode] = useState(false)
  const [connectSource, setConnectSource] = useState<string>()
  const epoch = useRef(0)
  const nodeId = relationNodeId
  useEffect(() => {
    const revision = ++epoch.current
    const [ids, links] = JSON.parse(structure) as [string[], Array<{ id: string; source: string; target: string; sourceSide: RelationSide; targetSide: RelationSide }>]
    setNodes(previous => {
      const existing = new Map(previous.map(node => [node.id, node]))
      // Preserve React Flow's measured dimensions. Replacing a same-size DOM
      // node with a fresh record loses them without triggering ResizeObserver,
      // leaving the controlled node permanently hidden after relayout/init.
      return ids.map((id, index) => existing.get(nodeId(id)) ?? {
        id: nodeId(id), type: 'business-record', data: { record: id },
        position: { x: (index % 3) * 230, y: Math.floor(index / 3) * 130 },
        sourcePosition: Position.Right, targetPosition: Position.Left, style: { width: 180, minHeight: 64 },
      })
    })
    setLayoutError('')
    if (!ids.length) return
    void import('elkjs/lib/elk.bundled.js').then(async module => {
      const Constructor = module.default as unknown as new () => ELK
      const elk = new Constructor()
      // elk.bundled uses an in-process worker shim (no workerUrl/factory).
      // Its shim has no terminate(); terminateWorker would discard a successful layout.
      return await elk.layout(relationLayoutInput(ids.map(id => ({ id, ...(measurements[nodeId(id)] ?? { width: 180, height: 64 }) })), links.map(link => {
        const value = edgeRecords[link.id] ?? {}
        const labels: RelationLayoutLink['labels'] = edgeCopy(link).label
          ? [{ id: 'main', placement: 'CENTER', ...(measurements[`${relationEdgeId(link.id)}:main`] ?? { width: 160, height: 44 }) }] : []
        for (const [id, field, placement] of [['source', binding.source_annotation_field, 'TAIL'], ['target', binding.target_annotation_field, 'HEAD']] as const) {
          if (displayValue(props.manifest, binding.edges, field, value[field ?? ''])) labels.push({ id, placement,
            ...(measurements[`${relationEdgeId(link.id)}:${id}`] ?? { width: 150, height: 36 }) })
        }
        return { ...link, labels }
      })))
    }).then(result => {
      if (epoch.current !== revision) return
      layoutBounds.current = result.width && result.height ? { x: 0, y: 0, width: result.width, height: result.height } : undefined
      setNodes(previous => previous.map(node => {
        const location = result.children?.find(child => child.id === node.id)
        return location ? { ...node, position: { x: location.x ?? 0, y: location.y ?? 0 } } : node
      }))
      setRoutes(Object.fromEntries((result.edges ?? []).flatMap(edge => {
        const route = relationRoute(edge)
        return route ? [[edge.id, route]] : []
      })))
      requestAnimationFrame(() => {
        if (epoch.current === revision && result.width && result.height) {
          // Include labels and loop routes outside the node bounds.
          // fitBounds uses the manual maxZoom in this React Flow version.
          // Its public viewport utility lets automatic framing keep a separate
          // readable ceiling while retaining labels/loop routes in the bounds.
          const canvas = canvasElement.current
          if (canvas?.clientWidth && canvas.clientHeight) void flow?.setViewport(relationGraphFitViewport(
            { x: 0, y: 0, width: result.width, height: result.height }, canvas.clientWidth, canvas.clientHeight))
        }
      })
    }).catch(error => { if (epoch.current === revision) setLayoutError(String(error)) })
    return () => { epoch.current += 1 }
  }, [structure, layoutRequest, flow, measurements])
  const nodeLabel = (id: string) => String(nodeRecords[id]?.[binding.label_field] ?? id)
  const editable = props.options?.editable === true && (!!props.options.onPanelUpdate || !!props.createConnection)
  const [connectionError, setConnectionError] = useState('')
  const createRelation = (source: string, target: string) => {
    if (!editable || !Object.hasOwn(nodeRecords, source) || !Object.hasOwn(nodeRecords, target)) return
    if (props.connectableRecords && (!props.connectableRecords.has(source) || !props.connectableRecords.has(target))) return
    if (props.createConnection) return props.createConnection(source, target)
    const candidate = { ...props.manifest.sections.find(section => section.id === binding.edges)?.create?.defaults, ...binding.edge_defaults,
      [binding.label_field]: `${nodeLabel(source)} → ${nodeLabel(target)}`,
      [binding.source_field!]: source, [binding.target_field!]: target,
    }
    if (binding.hierarchy?.max_parents === 1 && (relationHasCycle('__candidate__', candidate, edgeRecords, binding)
      || relationHasParentConflict('__candidate__', candidate, edgeRecords, binding))) {
      setConnectionError(t('graphInvalidParent')); return
    }
    setConnectionError('')
    const id = insertVisualRecord(props, binding.edges, candidate)
    if (id) select({ section: binding.edges, record: id })
    return id
  }
  return <div className="dsh-relation-graph">
    {connectionError ? <p className="dsh-relation-issues" role="alert">{connectionError}</p> : null}
    <PanelCanvasToolbar title={props.node.title ?? t('relationGraph')}
      counts={props.counts ?? t('graphCounts', { nodes: Object.keys(nodeRecords).length, edges: projection.valid.length })}>
        {editable ? <button type="button" className={connectMode ? 'is-active' : ''} aria-label={connectMode ? t('cancelRelation') : t('addRelation')} aria-pressed={connectMode}
          onClick={() => { setConnectMode(value => !value); setConnectSource(undefined) }}>
          {connectMode ? t('cancelRelation') : `＋ ${t('addRelation')}`}
        </button> : null}
        <button type="button" aria-label={t('autoLayout')} onClick={() => setLayoutRequest(value => value + 1)}>{t('autoLayout')}</button>
    </PanelCanvasToolbar>
    {connectMode ? <div className="dsh-relation-connect-guide" role="status">
      {connectSource
        ? t('graphChooseTarget', { source: nodeLabel(connectSource) })
        : t('graphChooseSource')}
    </div> : null}
    {invalidEdgeIds.length > 0 ? <div className="dsh-relation-issues" role="alert">
      <p>{t('graphMissingEndpoints', { count: invalidEdgeIds.length })}</p>
      <div>{invalidEdgeIds.map(record => <button type="button" key={record}
        onClick={() => { select({ section: binding.edges, record }); showDetails?.() }}>
        {String(edgeRecords[record]?.[binding.label_field] || record)}
      </button>)}</div>
    </div> : null}
    <div ref={canvasElement} className="dsh-visual-canvas" aria-label={t('relationCanvas')}>
      <ReactFlow nodeTypes={relationNodeTypes} edgeTypes={relationEdgeTypes} nodes={nodes.map(node => {
        const record = String(node.data.record), value = nodeRecords[record] ?? {}
        return { ...node, type: 'business-record', connectable: editable && (!props.connectableRecords || props.connectableRecords.has(record)), selected: selected?.section === binding.nodes && selected.record === node.data.record,
          data: { ...node.data, label: String(value[binding.label_field] ?? node.data.record), icon: props.nodeIcons?.[record],
            onDetail: showDetails ? () => { select({ section: binding.nodes, record }); showDetails() } : undefined,
            detailLabel: t('recordDetails'),
            kind: displayValue(props.manifest, binding.nodes, binding.node_kind_field, value[binding.node_kind_field ?? '']),
            connecting: connectMode && connectSource === record ? 'source' : undefined } }
      })}
        edges={projection.valid.map(link => {
          const peers = projection.valid.filter(other => [other.source, other.target].sort().join('\0') === [link.source, link.target].sort().join('\0'))
          const offset = link.source === link.target ? -100 - peers.indexOf(link) * 44 : (peers.indexOf(link) - (peers.length - 1) / 2) * 64
          const value = edgeRecords[link.id] ?? {}
          const pending = binding.edge_state_field !== undefined && binding.edge_pending_values?.includes(String(value[binding.edge_state_field])) === true
          const hierarchical = !!binding.edge_kind_field && binding.hierarchy?.values.includes(String(value[binding.edge_kind_field])) === true
          const ports = portsFor(link)
          const copy = edgeCopy(link)
          return { id: `edge:${encodeURIComponent(link.id)}`, source: nodeId(link.source), target: nodeId(link.target),
          sourceHandle: ports.sourceSide, targetHandle: ports.targetSide, type: 'relation',
          data: { record: link.id, offset, pending, route: routes[relationEdgeId(link.id)],
            kindLabel: copy.kindLabel,
            sourceAnnotation: displayValue(props.manifest, binding.edges, binding.source_annotation_field, value[binding.source_annotation_field ?? '']),
            targetAnnotation: displayValue(props.manifest, binding.edges, binding.target_annotation_field, value[binding.target_annotation_field ?? '']) },
          label: copy.label,
          ariaLabel: `${copy.sourceLabel} → ${copy.targetLabel}${copy.label ? ` · ${copy.label}` : ''}${pending ? ` · ${t('graphPending')}` : ''}`,
          selected: selected?.section === binding.edges && selected.record === link.id,
          markerEnd: props.undirectedRecords?.has(link.id) ? undefined : { type: hierarchical ? MarkerType.Arrow : MarkerType.ArrowClosed }, style: { strokeWidth: pending ? 1.7 : 2.4, strokeDasharray: pending || hierarchical ? '7 5' : undefined,
            stroke: pending ? '#8a91a1' : '#596579' }, labelBgPadding: [5, 4],
        } })}
        onInit={setFlow} onNodesChange={changes => setNodes(current => applyNodeChanges(changes, current))}
        onNodeDragStart={() => { epoch.current += 1; layoutBounds.current = undefined }}
        onNodeClick={(_event, node) => {
          const record = String(node.data.record)
          if (!connectMode) { select({ section: binding.nodes, record }); return }
          if (props.connectableRecords && !props.connectableRecords.has(record)) return
          if (!connectSource) { setConnectSource(record); select({ section: binding.nodes, record }); return }
          if (createRelation(connectSource, record)) { setConnectMode(false); setConnectSource(undefined) }
        }}
        onEdgeClick={(_event, edge) => select({ section: binding.edges, record: String(edge.data?.record) })}
        connectionMode={ConnectionMode.Loose} nodesConnectable={editable} edgesReconnectable={false} deleteKeyCode={null} minZoom={0.15} maxZoom={2.5} fitView fitViewOptions={RELATION_GRAPH_AUTO_FIT}
        onConnect={connection => {
          if (!editable || !connection.source || !connection.target) return
          const source = nodes.find(node => node.id === connection.source)?.data.record
          const target = nodes.find(node => node.id === connection.target)?.data.record
          if (typeof source !== 'string' || typeof target !== 'string' || !Object.hasOwn(nodeRecords, source) || !Object.hasOwn(nodeRecords, target)) return
          if (!isRelationSide(connection.sourceHandle) || !isRelationSide(connection.targetHandle)) return
          const id = createRelation(source, target)
          if (id) setEdgePorts(previous => ({ ...previous, [id]: { source, target,
            sourceSide: connection.sourceHandle as RelationSide, targetSide: connection.targetHandle as RelationSide } }))
        }}>
        <RelationGraphGeometrySync nodes={nodes} active={canvasView ?? true} canvas={canvasElement} />
        <Background /><Controls showInteractive={false} fitViewOptions={RELATION_GRAPH_AUTO_FIT} />
      </ReactFlow>
      {!nodes.length && <p className="dsh-visual-empty">{t('graphEmpty')}</p>}
    </div>
    <p className="dsh-visual-hint">{props.node.description ?? t('graphHint')} {binding.edge_pending_values?.length ? t('graphPendingHint') : ''} {editable ? t('graphEditHint') : t('graphReadonlyHint')}</p>
    {layoutError ? <p role="alert">{t('graphLayoutError', { error: layoutError })}</p> : null}
  </div>
}

/** Only landed, indexed project artifacts are fetched through the host's scoped reader. */
/** Related artifacts are a view over explicit references, never copied records. */
export function RecordArtifact(props: Props): ReactElement {
  const { selected } = useContext(SelectionContext)
  const source = props.node.source!
  const all = records(props, source)
  const reference = props.node.artifact?.reference_field
  const parent = reference && props.manifest.fields.find(field => field.key === reference
    && field.applies_to?.includes(source))?.options_from_section
  const entries: Array<[string, Record<string, unknown>]> = selected?.section === source
    ? Object.hasOwn(all, selected.record) ? [[selected.record, all[selected.record]!]] : []
    : reference && selected && selected.section === parent
      ? Object.entries(all).filter(([, record]) => record[reference] === selected.record) : []
  // Inlined related collections have no empty page. Matching records with an
  // absent/broken file still render their own availability/error state.
  if (reference && entries.length === 0) return props.node.description
    ? <section className="dsh-record-artifact"><p role="status">{props.node.description}</p></section> : <></>
  if (!reference) return <RecordArtifactFile {...props} record={entries[0]?.[1]} recordId={entries[0]?.[0]} />
  return <div className="dsh-record-related-artifacts">{entries.map(([recordId, record]) =>
    <RecordArtifactFile key={recordId} {...props} record={record} recordId={recordId} />)}</div>
}

function RecordArtifactFile(props: Props & { record?: Record<string, unknown>; recordId?: string }): ReactElement {
  const { t } = usePanelI18n()
  const { selected, select, openRelated, headerOutside } = useContext(SelectionContext)
  const showSibling = useContext(ComponentTabsNavigation)
  const { record, recordId } = props
  const path = record?.[props.node.artifact!.field]
  const revision = typeof path === 'string' ? props.options?.artifactFiles?.[path] : undefined
  const sourceRevision = props.options?.sourceRevision
  const read = props.options?.readArtifact
  const [attempt, retry] = useState(0)
  const key = JSON.stringify([recordId, path, revision, sourceRevision, attempt])
  const [result, setResult] = useState<{ key: string; html?: string; error?: string;
    errorKey?: 'artifactUnsupported' | 'artifactNotReadable' | 'artifactTooLarge' }>()
  useEffect(() => {
    let cancelled = false
    if (typeof path !== 'string' || !path || !revision || !read) return
    if (!/\.(?:html|svg)$/i.test(path) || path.split('/').some(part => !part || part === '.' || part === '..') || /[\\:\x00-\x1f]/.test(path)) {
      setResult({ key, errorKey: 'artifactUnsupported' }); return
    }
    void read(path, sourceRevision).then(value => {
      if (cancelled) return
      if (!value.found) { setResult({ key, errorKey: 'artifactNotReadable' }); return }
      if (value.content.length > 2_000_000) { setResult({ key, errorKey: 'artifactTooLarge' }); return }
      setResult({ key, html: secureDesignSrcDoc(value.content, 'static-document') })
    }).catch(error => { if (!cancelled) setResult({ key, error: String(error) }) })
    return () => { cancelled = true }
  }, [key, path, revision, sourceRevision, read])
  let message = ''
  if (!record) message = t('artifactSelectRecord')
  else if (typeof path !== 'string' || !path) message = props.node.description ?? t('artifactNotGenerated')
  else if (!read || !revision) message = t('artifactNotPublished')
  else if (result?.key !== key) message = t('artifactReading')
  const error = result?.key === key ? result.errorKey ? t(result.errorKey) : result.error : undefined
  const explanation = props.node.artifact?.explanation_field && record?.[props.node.artifact.explanation_field]
  const title = record && recordId ? recordLabel(record, recordId) : props.node.title ?? t('artifactPreview')
  const ownHeader = headerOutside && selected !== undefined && selected.section === props.node.source && selected.record === recordId
  return <section className="dsh-record-artifact" aria-label={title}>
    {!ownHeader ? <h3>{title}</h3> : null}
    {typeof explanation === 'string' && explanation.trim() ? <p className="dsh-artifact-explanation">{explanation}</p> : null}
    {recordId && props.node.artifact?.reference_field && selected?.section !== props.node.source
      ? <button type="button" className="dsh-artifact-details-link" onClick={() => {
        const target = { section: props.node.source!, record: recordId }
        if (openRelated) openRelated(target)
        else select(target)
        showSibling?.('record_inspector')
      }}>{t('artifactDetails')}</button> : null}
    {message ? <p role="status">{message}</p> : error ? <div role="alert">{error}<button type="button" onClick={() => retry(n => n + 1)}>{t('artifactRetryPreview')}</button></div>
      : <iframe title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={result?.key === key ? result.html : undefined} />}
  </section>
}

export function RecordMatrix(props: Props): ReactElement {
  const { t } = usePanelI18n()
  const { selected } = useContext(SelectionContext)
  const binding = props.node.matrix!, source = props.node.source!
  const record = selected?.section === source ? records(props, source)[selected.record] : undefined
  if (!record || !selected) return <div className="dsh-record-matrix"><p>{Object.keys(records(props, source)).length
    ? t('matrixSelectRecord')
    : t('matrixNoDatasets')}</p></div>
  const pivot = pivotRows(record[binding.field], binding)
  const field = props.manifest.fields.find(field => field.key === binding.field)!
  const columnDefinition = field.columns?.find(column => column.key === binding.column)
  const ref = columnDefinition?.options_from_panel
  const options = { ...Object.assign({}, ...(columnDefinition?.ref_sections ?? []).map(section => records(props, section))),
    ...(ref ? props.options?.panelData?.(ref.panel_type, ref.section_id) ?? {} : {}) } as RecordMap
  const columnLabel = (column: string) => Object.hasOwn(options, column) ? recordLabel(options[column]!, column)
    : columnDefinition?.options?.find(option => option.value === column)?.label ?? column
  return <section className="dsh-record-matrix" aria-label={props.node.title ?? t('matrixTitle')}>
    <h3>{recordLabel(record, selected.record)}</h3>
    <p className="dsh-visual-hint">{t('matrixHint')}</p>
    <div className="dsh-matrix-scroll"><table><thead><tr><th>{field.columns?.find(column => column.key === binding.row)?.label ?? binding.row}</th>
      {pivot.columns.map(column => <th key={column}>{columnLabel(column)}</th>)}</tr></thead>
      <tbody>{pivot.rows.map(row => <tr key={row}><th>{row}</th>{pivot.columns.map(column => {
        const indices = pivot.cells.get(row)?.get(column)
        if (!indices) return <td key={column} aria-label={t('matrixMissing', { row, column: columnLabel(column) })}>—</td>
        if (indices.length !== 1) return <td key={column}>{t('matrixDuplicate', { count: indices.length })}</td>
        const value = (pivot.raw[indices[0]!] as Record<string, unknown>)[binding.value]
        if (value !== undefined && typeof value !== 'string') return <td key={column}>{t('matrixInvalidValue')}</td>
        return <td key={column}><input aria-label={`${row} / ${columnLabel(column)}`} value={value ?? ''}
          readOnly={!props.options?.editable || !props.options.onEdit}
          onChange={event => {
            if (!props.options?.editable) return
            props.options.onEdit?.({ section: source, record: selected.record, field: binding.field,
              value: replaceMatrixCell(record[binding.field], binding, row, column, event.target.value) })
          }} /></td>
      })}</tr>)}</tbody></table></div>
    {pivot.rows.length === 0 && <p>{t('matrixEmpty')}</p>}
    {pivot.issues.map(issue => <p role="alert" key={issue}>{issue}</p>)}
  </section>
}
