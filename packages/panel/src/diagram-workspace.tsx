import { useEffect, useRef, useState, type ReactElement } from 'react'
import { sidebarIcon } from './sidebar-icon.tsx'
import type { ComponentNode, PanelManifest } from './dsl.ts'
import { fieldValuesOf, pathGet, pathSet, recordsAtPath, sectionBindingOf, type DesignData } from './record-state.ts'
import { insertVisualRecord } from './visual-components.tsx'
import type { RenderOptions } from './interpreter.ts'
import { PanelWorkspace, PanelDisclosureIcon, PanelWorkspaceTree, PanelWorkspaceTreeItem, PanelWorkspaceTreeRecord, PanelWorkspaceTreeGroup, PanelWorkspaceTreeAdd } from './panel-workspace.tsx'
import { usePanelI18n } from './panel-i18n.tsx'
import { BpmnSurface } from './bpmn-surface.tsx'
import { PANEL_TEXT_ARTIFACTS_KEY, confinedEditableArtifact, type PendingTextArtifact } from './text-artifact-edit.ts'
import { projectArtifactExecution, projectArtifactFile } from './artifact-execution.ts'
import { ExecutionTrace } from './artifact-workspace.tsx'
import { RecordFacts } from './record-facts.tsx'
import { diagramContextRecords, diagramNodeForElement, diagramRecords, diagramRecordProcess } from './diagram-context.ts'
import { ArtifactStatusIcon } from './artifact-status-icon.tsx'
import { PanelContentState } from './panel-content-state.tsx'

export function DiagramWorkspace({ node, manifest, data, options, render }: { node: ComponentNode; manifest: PanelManifest
  data: DesignData; options?: RenderOptions; render: (id: string, section?: string, editable?: boolean) => ReactElement }) {
  const { t } = usePanelI18n(), config = node.diagram!, section = node.source!
  const binding = sectionBindingOf(manifest, section), raw = recordsAtPath(data, binding.recordsPath)
  const order = binding.orderPath ? pathGet(data, binding.orderPath) : undefined
  const ids = [...new Set([...(Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string' && Object.hasOwn(raw, id)) : []), ...(config.order_only ? [] : Object.keys(raw))])]
  const [choice, select] = useState<string>(), [details, showDetails] = useState(false), [editing, setEditing] = useState(false)
  const [looseChoice, selectLoose] = useState<{ source: string; id: string; sections: readonly string[] }>()
  const [nodeChoice, selectNode] = useState<string>(), [inspectorOpen, setInspectorOpen] = useState(true)
  const [expandedProcesses, setExpandedProcesses] = useState<Record<string, boolean>>({}), [unassignedOpen, setUnassignedOpen] = useState(true)
  const [unmappedElement, setUnmappedElement] = useState(false)
  const [navigationError, setNavigationError] = useState(''), [switching, setSwitching] = useState(false)
  const selected = choice && ids.includes(choice) ? choice : ids[0]
  useEffect(() => { showDetails(false); setEditing(false); selectLoose(undefined); setUnmappedElement(false) }, [selected])
  const value = selected ? fieldValuesOf(raw[selected]!, binding.fieldsPath) : undefined
  const inspector = config.inspector
  const labelBinding = sectionBindingOf(manifest, config.label_source ?? section)
  const labelFor = (id: string) => String(fieldValuesOf(raw[id] ?? {}, labelBinding.fieldsPath)[config.label_field] || id)
  const nodes = selected && inspector ? diagramContextRecords(manifest, data, inspector.nodes, selected) : []
  const unassigned = inspector ? [inspector.nodes, ...(inspector.related ?? [])].flatMap(group => diagramRecords(manifest, data, group.source)
    .filter(item => !ids.includes(String(diagramRecordProcess(manifest, data, group, item.values, inspector.nodes) ?? '')))
    .map(item => ({ ...item, group }))) : []
  const looseRecord = unassigned.find(item => item.id === looseChoice?.id && item.group.source === looseChoice.source)
  const selectedNode = nodes.find(item => item.id === nodeChoice)
  const groupTitle = (source: string) => manifest.sections.find(item => item.id === source)?.title ?? source
  const renderSections = (sections: readonly string[], id: string) => sections.map(source => <div key={source} className={sectionBindingOf(manifest, source).fieldsPath ? "dsh-diagram-bound-fields" : undefined}>{render(id, source, true)}</div>)
  const addControl = (sections: readonly string[], context?: { source: string; process_field: string; node_field?: string }, processId = selected) => {
    const owner = sections.map(source => manifest.sections.find(item => item.id === source)).find(item => item && item.add_mode !== 'none' && item.create)
    if (!owner || !options?.editable || !options.onPanelUpdate) return null
    return <PanelWorkspaceTreeAdd disabled={switching} onAdd={() => {
      void navigable(() => {
        const target = sectionBindingOf(manifest, owner.id)
        let record: Record<string, unknown> = {}
        if (context && processId) {
          const fieldsPath = sectionBindingOf(manifest, context.source).fieldsPath
          const path = (field: string) => fieldsPath ? `${fieldsPath}.${field}` : field
          record = pathSet(record, path(context.process_field), processId)
          if (context.node_field && selectedNode && processId === selected) record = pathSet(record, path(context.node_field), selectedNode.id)
        }
        const id = insertVisualRecord({ node, manifest, data, options }, owner.id, fieldValuesOf(record, target.fieldsPath))
        if (!id) return
        setInspectorOpen(true); setEditing(false); setUnmappedElement(false)
        if (!context) { select(id); selectNode(undefined); selectLoose(undefined) }
        else if (context.source === inspector?.nodes.source) { select(processId); selectNode(id); selectLoose(undefined); if (processId) setExpandedProcesses(current => ({ ...current, [processId]: true })) }
      })
    }}>{t('addItem', { item: owner.item_name ?? owner.title })}</PanelWorkspaceTreeAdd>
  }
  const safe = (path: unknown): path is string => typeof path === 'string' && !!options?.skill && confinedEditableArtifact(path, options.skill) && /\.bpmn$/iu.test(path)
  const canonical = value?.[config.file_field]
  const fallback = selected ? projectArtifactFile(selected, options?.executionAttempts ?? [], config.artifact_kind, options?.artifactFiles ?? {}, undefined, options?.artifactActivities) : undefined
  const file = safe(canonical) ? canonical : safe(fallback) ? fallback : undefined
  const execution = projectArtifactExecution(selected, options?.executionAttempts, config.artifact_kind, !!file && options?.artifactFiles?.[file] !== undefined, 'pending', file, options?.artifactActivities)
  const [retry, setRetry] = useState(0)
  const fileKey = JSON.stringify([file, file ? options?.artifactFiles?.[file] : undefined, retry])
  const [loaded, setLoaded] = useState<{ key: string; xml?: string; error?: string }>()
  const flush = useRef<(() => Promise<void>) | undefined>()
  const latest = useRef({ selected, file }); latest.current = { selected, file }
  useEffect(() => {
    let gone = false
    if (!file || !options?.readArtifact) return
    void options.readArtifact(file).then(result => {
      if (gone) return
      if (!result.found || !result.content.trim()) throw Error(t('diagramUnavailable'))
      if (result.content.length > 5_000_000) throw Error('Diagram exceeds 5 million characters.')
      setLoaded({ key: fileKey, xml: result.content })
    }).catch(failure => { if (!gone) setLoaded({ key: fileKey, error: String(failure) }) })
    return () => { gone = true }
  }, [fileKey, options?.readArtifact])
  const transport = (data as unknown as Record<string, unknown>)[PANEL_TEXT_ARTIFACTS_KEY]
  const pending = Array.isArray(transport) ? (transport as PendingTextArtifact[]).find(item => item.path === file && item.binding.record === selected) : undefined
  const transportEpoch = useRef({ pending: !!pending, value: 0 })
  if (transportEpoch.current.pending && !pending) transportEpoch.current.value++
  transportEpoch.current.pending = !!pending
  const xml = pending?.content ?? (loaded?.key === fileKey ? loaded.xml : undefined)
  const navigable = async (action: () => void) => {
    if (switching) return
    setSwitching(true)
    try { await flush.current?.(); setNavigationError(''); action() }
    catch (failure) { setNavigationError(String(failure)) }
    finally { setSwitching(false) }
  }
  const detailsLabel = t('diagramDetails')
  const canEdit = !!options?.editable && !!options.onStageArtifact && !!options.registerBeforeSave && !!file && canonical === file && !!xml
  return <PanelWorkspace guidance={node.guidance} autoSaveId={`diagram:${manifest.panel_kind}:${node.id}`} sidebar={<PanelWorkspaceTree icon={sidebarIcon(node.sidebar_icon)} title={node.title ?? t('diagram')}>
    {ids.map(id => {
      const record = fieldValuesOf(raw[id]!, binding.fieldsPath)
      const reference = record[config.file_field]
      const projected = projectArtifactFile(id, options?.executionAttempts ?? [], config.artifact_kind, options?.artifactFiles ?? {}, undefined, options?.artifactActivities)
      const artifact = safe(reference) ? reference : safe(projected) ? projected : undefined
      const status = projectArtifactExecution(id, options?.executionAttempts, config.artifact_kind,
        !!artifact && options?.artifactFiles?.[artifact] !== undefined, 'pending', artifact, options?.artifactActivities).status
      const processNodes = inspector ? diagramContextRecords(manifest, data, inspector.nodes, id) : []
      const addStep = inspector ? addControl(inspector.nodes.sections, inspector.nodes, id) : null
      return <PanelWorkspaceTreeRecord key={id} label={labelFor(id)} reserveToggle={!!inspector}
        expanded={expandedProcesses[id] ?? id === selected}
        onToggle={() => setExpandedProcesses(current => ({ ...current, [id]: !(current[id] ?? id === selected) }))}
        selected={id === selected && !selectedNode && !looseRecord}
        trailing={<ArtifactStatusIcon status={status} label={t(`artifact_${status}`)} />}
        onSelect={() => { void navigable(() => { select(id); selectNode(undefined); selectLoose(undefined); setUnmappedElement(false); setInspectorOpen(true); showDetails(false); setEditing(false) }) }}>
        {inspector && (processNodes.length || addStep) ? <>
        {processNodes.map(item => <PanelWorkspaceTreeItem key={item.id} selected={id === selected && item.id === selectedNode?.id}
          onSelect={() => { void navigable(() => { select(id); selectNode(item.id); selectLoose(undefined); setUnmappedElement(false); setInspectorOpen(true); setEditing(false) }) }}>
          {String(item.record.title || item.values[inspector.nodes.label_field] || item.id)}
        </PanelWorkspaceTreeItem>)}
        {addStep}
      </> : undefined}</PanelWorkspaceTreeRecord>
    })}
    {inspector ? addControl(inspector.process_sections) : null}
    {unassigned.length ? <PanelWorkspaceTreeGroup label={`${t('diagramUnassigned')} (${unassigned.length})`} expanded={unassignedOpen} onToggle={() => setUnassignedOpen(value => !value)}>
      {unassigned.map(item => <PanelWorkspaceTreeItem key={`${item.group.source}:${item.id}`} selected={looseRecord === item}
        onSelect={() => { selectLoose({ source: item.group.source, id: item.id, sections: item.group.sections }); selectNode(undefined); setInspectorOpen(true) }}>
        {String(item.record.title || item.id)}
      </PanelWorkspaceTreeItem>)}
    </PanelWorkspaceTreeGroup> : null}
  </PanelWorkspaceTree>}>
    <div className="dsh-diagram-workspace">
      <header className="dsh-diagram-heading"><strong>{selected ? labelFor(selected) : node.title || t('diagram')}</strong>
        {value ? config.tags?.map(tag => { const key = String(value[tag.field] ?? ''); const field = manifest.fields.find(field => field.key === tag.field && field.applies_to?.includes(section)); return key && field && !field.hidden ? <span key={tag.field} className={`dsh-diagram-tag is-${tag.tones?.[key] ?? 'neutral'}`}>{tag.labels?.[key] ?? field?.options?.find(option => option.value === key)?.label ?? key}</span> : null }) : null}
        {execution.status !== 'completed' ? <span role="status" className={`dsh-diagram-status is-${execution.status}`}>{t(`artifact_${execution.status}`)}</span> : null}
        <button type="button" disabled={switching} aria-expanded={inspector ? inspectorOpen : details} onClick={() => { void navigable(() => { if (inspector) setInspectorOpen(!inspectorOpen); else showDetails(!details); setEditing(false) }) }}>{detailsLabel}<PanelDisclosureIcon expanded={inspector ? inspectorOpen : details} /></button>
        <button type="button" disabled={switching || (!inspector && details) || !canEdit} aria-pressed={editing} onClick={() => { void navigable(() => setEditing(!editing)) }}>{editing ? t('finishEditing') : t('editDiagram')}</button>
        {pending ? <span aria-label={t('unsavedDiagram')}>●</span> : null}
      </header>
      {navigationError ? <p role="alert">{t('diagramSaveError')} {navigationError}</p> : null}
      {!inspector && details && selected ? <div className="dsh-diagram-details">{config.detail_rows && value ? <RecordFacts fields={manifest.fields.filter(field => field.applies_to?.includes(section))} value={value} rows={config.detail_rows} chips={config.chip_fields} /> : render(selected)}</div> : <>
      <div className={`dsh-diagram-body${inspector && inspectorOpen && !editing ? ' has-inspector' : ''}`}>
      <div className="dsh-diagram-stage">
        {xml && file && selected ? <BpmnSurface key={`${selected}:${fileKey}:${editing}:${transportEpoch.current.value}`} xml={xml} editing={editing} disabled={switching || (editing && !options?.editable)} navigationFlush={flush}
          selectedElement={selectedNode ? String(selectedNode.values[inspector!.nodes.element_field] || '') : undefined}
          onSelectElement={inspector ? element => {
            const match = diagramNodeForElement(manifest, data, inspector.nodes, selected, element)
            selectNode(match?.id); selectLoose(undefined); setUnmappedElement(!!element && !match); setInspectorOpen(true)
          } : undefined}
          register={options?.registerBeforeSave ?? (() => () => {})} onChange={content => {
            if (latest.current.selected !== selected || latest.current.file !== file) throw Error('The selected diagram changed.')
            options?.onStageArtifact?.({ path: file, content, binding: { recordsPath: binding.recordsPath, record: selected, fieldsPath: binding.fieldsPath, field: config.file_field } })
          }} />
          : <div className="dsh-diagram-placeholder"><PanelContentState kind="canvas"
            state={loaded?.key === fileKey && loaded.error ? 'error' : file && options?.readArtifact ? 'loading' : selected ? 'unavailable' : 'empty'}
            message={loaded?.key === fileKey && loaded.error ? loaded.error : file && options?.readArtifact ? t('diagramLoading') : t('diagramUnavailable')}>
            {file && loaded?.key === fileKey && loaded.error ? <button type="button" onClick={() => setRetry(value => value + 1)}>{t('retry')}</button> : null}
            </PanelContentState>
            {selected ? <ExecutionTrace item={{ id: selected, title: String(value?.[config.label_field] ?? selected), ...execution, file, points: [], links: [] }} read={options?.readExecutionLog} /> : null}
          </div>}
      </div>
      {inspector && inspectorOpen && !editing && selected ? <aside className="dsh-diagram-inspector" aria-label={t('diagramContext')}>
        <header className="dsh-diagram-inspector-heading"><h2>{looseRecord ? t('diagramUnassigned') : selectedNode ? t('diagramStep') : t('diagramOverview')}</h2>
          {selectedNode || looseRecord ? <button type="button" onClick={() => { selectNode(undefined); selectLoose(undefined); setUnmappedElement(false) }}>{t('diagramOverview')}</button> : null}</header>
        {unmappedElement ? <p role="status" className="dsh-diagram-context-hint">{t('diagramUnmappedElement')}</p> : null}
        <div key={`${selected}:${looseRecord?.id ?? selectedNode?.id ?? 'overview'}`}>
          {looseRecord ? <><p className="dsh-diagram-context-hint">{t('diagramUnassignedHint')}</p>{renderSections(looseRecord.group.sections, looseRecord.id)}</> : selectedNode ? renderSections(inspector.nodes.sections, selectedNode.id) : renderSections(inspector.process_sections, selected)}
          {!looseRecord && (inspector.related ?? []).map(group => {
            const records = diagramContextRecords(manifest, data, group, selected, selectedNode?.id, inspector.nodes)
            return <details key={group.source} className="dsh-diagram-context-group" open={!group.advanced && !!selectedNode && !!group.node_field && records.length > 0}>
              <summary>{groupTitle(group.source)} <span>{records.length}</span></summary>
              {records.map(item => <details key={item.id} className="dsh-diagram-context-record" open={records.length === 1}>
                <summary>{String(item.record.title || item.id)}</summary>{renderSections(group.sections, item.id)}
              </details>)}
              {addControl(group.sections, group)}
            </details>
          })}
        </div>
      </aside> : null}
      </div>
      {editing && inspector ? <p className="dsh-diagram-context-hint">{t('diagramEditContextHint')}</p> : null}
      {value && !inspector ? <dl className="dsh-diagram-summary">{(config.summary_fields ?? []).map(field => <div key={field}>
        <dt>{manifest.fields.find(item => item.key === field && item.applies_to?.includes(section))?.label ?? field}</dt>
        <dd>{Array.isArray(value[field]) ? value[field].join(' · ') : String(value[field] ?? '')}</dd>
      </div>)}</dl> : null}
      </>}
    </div>
  </PanelWorkspace>
}
