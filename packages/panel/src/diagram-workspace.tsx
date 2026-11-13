import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { sidebarIcon } from './sidebar-icon.tsx'
import type { ComponentNode, PanelManifest } from './dsl.ts'
import { fieldValuesOf, pathGet, pathSet, recordsAtPath, sectionBindingOf, type DesignData } from './record-state.ts'
import { insertVisualRecord } from './visual-components.tsx'
import type { RenderOptions } from './interpreter.ts'
import { PanelWorkspace, PanelRecordHeader, PanelRecordId, PanelContentGroup, PanelFieldCaption, PanelDisclosureIcon, PanelWorkspaceTree, PanelWorkspaceTreeItem, PanelWorkspaceTreeRecord, PanelWorkspaceTreeGroup, PanelWorkspaceTreeAdd } from './panel-workspace.tsx'
import { usePanelI18n } from './panel-i18n.tsx'
import { BpmnSurface } from './bpmn-surface.tsx'
import { PANEL_TEXT_ARTIFACTS_KEY, confinedEditableArtifact, type PendingTextArtifact } from './text-artifact-edit.ts'
import { projectArtifactExecution, projectArtifactFile } from './artifact-execution.ts'
import { ExecutionTrace } from './artifact-workspace.tsx'
import { RecordFacts } from './record-facts.tsx'
import { diagramContextRecords, diagramNodeForElement, diagramRecords, diagramRecordProcess } from './diagram-context.ts'
import { ArtifactStatusIcon } from './artifact-status-icon.tsx'
import { PanelContentState } from './panel-content-state.tsx'
import type { BpmnElementContext } from './bpmn-context.ts'
import { Button } from './client/ported/ui/button.tsx'

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
  const [contexts, setContexts] = useState<Record<string, readonly BpmnElementContext[]>>({})
  const [migrationSent, setMigrationSent] = useState<string>()
  const [migrationError, setMigrationError] = useState('')
  const [anchor, setAnchor] = useState<{ process: string; node?: string }>()
  const content = useRef<HTMLDivElement>(null)
  const selected = choice && ids.includes(choice) ? choice : ids[0]
  useEffect(() => { setEditing(false); selectLoose(undefined); setUnmappedElement(false); setMigrationError('') }, [selected])
  const value = selected ? fieldValuesOf(raw[selected]!, binding.fieldsPath) : undefined
  const inspector = config.inspector
  const documentMode = inspector?.presentation === 'document'
  const labelBinding = sectionBindingOf(manifest, config.label_source ?? section)
  const labelFor = (id: string) => String(fieldValuesOf(raw[id] ?? {}, labelBinding.fieldsPath)[config.label_field] || id)
  const nodes = selected && inspector ? diagramContextRecords(manifest, data, inspector.nodes, selected) : []
  const unassigned = inspector ? [inspector.nodes, ...(inspector.related ?? [])].flatMap(group => diagramRecords(manifest, data, group.source)
    .filter(item => !ids.includes(String(diagramRecordProcess(manifest, data, group, item.values, inspector.nodes) ?? '')))
    .map(item => ({ ...item, group }))) : []
  const looseRecord = unassigned.find(item => item.id === looseChoice?.id && item.group.source === looseChoice.source)
  const selectedNode = nodes.find(item => item.id === nodeChoice)
  const groupTitle = (source: string) => manifest.sections.find(item => item.id === source)?.title ?? source
  const renderSections = (sections: readonly string[], id: string, hideTitle = false) => sections.map(source => <div key={source} className={hideTitle || sectionBindingOf(manifest, source).fieldsPath ? "dsh-diagram-bound-fields" : undefined}>{render(id, source, true)}</div>)
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
        else if (context.source === inspector?.nodes.source) { select(processId); selectNode(id); selectLoose(undefined); if (processId) {
          setExpandedProcesses(current => ({ ...current, [processId]: true }))
          if (documentMode) openDocument(processId, id)
        } }
      })
    }}>{t('addItem', { item: owner.item_name ?? owner.title })}</PanelWorkspaceTreeAdd>
  }
  const safe = (path: unknown): path is string => typeof path === 'string' && !!options?.skill && confinedEditableArtifact(path, options.skill) && /\.bpmn$/iu.test(path)
  const canonical = value?.[config.file_field]
  const fallback = selected ? projectArtifactFile(selected, options?.executionAttempts ?? [], config.artifact_kind, options?.artifactFiles ?? {}, undefined, options?.artifactActivities) : undefined
  const file = safe(canonical) ? canonical : safe(fallback) ? fallback : undefined
  const contextFor = (id: string, process = selected) => {
    if (!inspector || !process) return undefined
    const record = diagramContextRecords(manifest, data, inspector.nodes, process).find(item => item.id === id)
    const path = fieldValuesOf(raw[process] ?? {}, binding.fieldsPath)[config.file_field]
    return typeof path === 'string' ? contexts[path]?.find(item => item.id === record?.values[inspector.nodes.element_field]) : undefined
  }
  const nodeLabel = (item: typeof nodes[number], process = selected) => contextFor(item.id, process)?.name
    || String(item.record.title || item.values[inspector!.nodes.label_field] || item.id)
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
  const active = execution.status === 'working' || execution.status === 'queued'
  const readError = loaded?.key === fileKey ? loaded.error : undefined
  const unavailable = !!file && !options?.readArtifact || !!canonical && !safe(canonical) && !file
  const progress = selected ? <ExecutionTrace item={{ id: selected, title: String(value?.[config.label_field] ?? selected), ...execution, file, points: [], links: [] }} read={options?.readExecutionLog} /> : null
  const navigable = async (action: () => void | Promise<void>) => {
    if (switching) return
    setSwitching(true)
    try { await flush.current?.(); setNavigationError(''); await action() }
    catch (failure) { setNavigationError(String(failure)) }
    finally { setSwitching(false) }
  }
  const detailsLabel = t('diagramDetails')
  const detailsUnavailable = documentMode && !details && !looseRecord && nodes.length === 0
  const canEdit = !!options?.editable && !!options.onStageArtifact && !!options.registerBeforeSave && !!file && canonical === file && !!xml
  const openDocument = (process: string, id?: string) => {
    select(process); selectNode(id); selectLoose(undefined); setUnmappedElement(false); setEditing(false)
    showDetails(true); setAnchor({ process, node: id })
    setExpandedProcesses(current => ({ ...current, [process]: true }))
  }
  useLayoutEffect(() => {
    const container = content.current
    if (!documentMode || !details || !container || anchor?.process !== selected) return
    const target = [...container.querySelectorAll<HTMLElement>('[data-diagram-record]')].find(element => element.dataset.diagramRecord === (anchor.node ?? ''))
    if (target) {
      // Reveal the semantic section without replacing its mounted editors.
      const group = target.closest<HTMLDetailsElement>('details.dsh-diagram-document-group')
      if (group && !group.open) group.open = true
      const destination = anchor.node ? target : group ?? target
      container.scrollTo?.({ top: Math.max(0, container.scrollTop + destination.getBoundingClientRect().top - container.getBoundingClientRect().top - parseFloat(getComputedStyle(container).paddingTop || '0')) })
    }
  }, [documentMode, details, selected, anchor])
  const nodeSignature = nodes.map(item => item.id).join('\0')
  useEffect(() => {
    const container = content.current
    if (!documentMode || !details || !container || looseRecord) return
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!container.getClientRects().length || container.scrollHeight <= container.clientHeight + 1) return
        const sections = [...container.querySelectorAll<HTMLElement>('[data-diagram-record]')]
          .filter(element => element.closest<HTMLDetailsElement>('details.dsh-diagram-document-group')?.open !== false)
        const start = container.getBoundingClientRect().top + parseFloat(getComputedStyle(container).paddingTop || '0')
        const atEnd = container.scrollHeight > container.clientHeight + 1 && container.scrollTop + container.clientHeight >= container.scrollHeight - 1
        const current = atEnd ? sections.at(-1) : sections.find(element => element.getBoundingClientRect().bottom > start + 1)
        if (current) selectNode(current.dataset.diagramRecord || undefined)
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    container.querySelectorAll('[data-diagram-record]').forEach(element => observer.observe(element))
    container.addEventListener('scroll', schedule, { passive: true })
    container.addEventListener('toggle', schedule, true); schedule()
    return () => { cancelAnimationFrame(frame); observer.disconnect(); container.removeEventListener('scroll', schedule); container.removeEventListener('toggle', schedule, true) }
  }, [documentMode, details, selected, nodeSignature, !!looseRecord])
  const relatedContent = (nodeId?: string) => (inspector?.related ?? []).map(group => {
    const records = diagramContextRecords(manifest, data, group, selected!, nodeId, inspector?.nodes)
    return <details key={group.source} className="dsh-diagram-context-group" open={!group.advanced && !!nodeId && !!group.node_field && records.length > 0}>
      <summary>{groupTitle(group.source)} <span>{records.length}</span></summary>
      {records.map(item => <details key={item.id} className="dsh-diagram-context-record" open={records.length === 1}>
        <summary>{String(item.record.title || item.id)}</summary>{renderSections(group.sections, item.id)}
      </details>)}
      {addControl(group.sections, group)}
    </details>
  })
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
        onSelect={() => { void navigable(() => { if (documentMode && details && processNodes.length) openDocument(id); else { select(id); selectNode(undefined); selectLoose(undefined); setUnmappedElement(false); setInspectorOpen(true); showDetails(false); setEditing(false) } }) }}>
        {inspector && (processNodes.length || addStep) ? <>
        {processNodes.map(item => <PanelWorkspaceTreeItem key={item.id} selected={id === selected && item.id === selectedNode?.id}
          onSelect={() => { void navigable(() => { if (documentMode) openDocument(id, item.id); else { select(id); selectNode(item.id); selectLoose(undefined); setUnmappedElement(false); setInspectorOpen(true); setEditing(false) } }) }}>
          {nodeLabel(item, id)}
        </PanelWorkspaceTreeItem>)}
        {addStep}
      </> : undefined}</PanelWorkspaceTreeRecord>
    })}
    {inspector ? addControl(inspector.process_sections) : null}
    {unassigned.length ? <PanelWorkspaceTreeGroup label={`${t('diagramUnassigned')} (${unassigned.length})`} expanded={unassignedOpen} onToggle={() => setUnassignedOpen(value => !value)}>
      {unassigned.map(item => <PanelWorkspaceTreeItem key={`${item.group.source}:${item.id}`} selected={looseRecord === item}
        onSelect={() => { void navigable(() => { selectLoose({ source: item.group.source, id: item.id, sections: item.group.sections }); selectNode(undefined); setInspectorOpen(true); if (documentMode) showDetails(true) }) }}>
        {String(item.record.title || item.id)}
      </PanelWorkspaceTreeItem>)}
    </PanelWorkspaceTreeGroup> : null}
  </PanelWorkspaceTree>}>
    <div className="dsh-diagram-workspace">
      <PanelRecordHeader placement="workspace" className="dsh-diagram-heading"><PanelRecordId value={selected} /><strong>{selected ? labelFor(selected) : node.title || t('diagram')}</strong>
        {value ? config.tags?.map(tag => { const key = String(value[tag.field] ?? ''); const field = manifest.fields.find(field => field.key === tag.field && field.applies_to?.includes(section)); return key && field && !field.hidden ? <span key={tag.field} className={`dsh-diagram-tag is-${tag.tones?.[key] ?? 'neutral'}`}>{tag.labels?.[key] ?? field?.options?.find(option => option.value === key)?.label ?? key}</span> : null }) : null}
        {execution.status !== 'completed' ? <span role="status" className={`dsh-diagram-status is-${execution.status}`}>{t(`artifact_${execution.status}`)}</span> : null}
        <button type="button" disabled={switching || detailsUnavailable} title={detailsUnavailable ? t('diagramDetailsUnavailable') : undefined} aria-expanded={documentMode ? details : inspector ? inspectorOpen : details} onClick={() => { void navigable(() => { if (documentMode) { if (details) showDetails(false); else if (selected) openDocument(selected, nodeChoice) } else if (inspector) setInspectorOpen(!inspectorOpen); else showDetails(!details); setEditing(false) }) }}>{documentMode && details ? t('diagramShowCanvas') : detailsLabel}{documentMode ? null : <PanelDisclosureIcon expanded={inspector ? inspectorOpen : details} />}</button>
        {!(documentMode && details) ? <button type="button" disabled={switching || (!inspector && details) || !canEdit} aria-pressed={editing} onClick={() => { void navigable(() => setEditing(!editing)) }}>{editing ? t('finishEditing') : t('editDiagram')}</button> : null}
        {pending ? <span aria-label={t('unsavedDiagram')}>●</span> : null}
      </PanelRecordHeader>
      {navigationError ? <p role="alert">{t('diagramSaveError')} {navigationError}</p> : null}
      {inspector?.migration && selected && file && !nodes.length && (options?.sendPrompt || migrationError || migrationSent === selected) ? <div className="dsh-diagram-migration">
        {options?.sendPrompt ? <Button type="button" variant="outline" size="sm" disabled={switching || options.running} onClick={() => {
          void navigable(async () => {
            setMigrationError('')
            try {
              await options.sendPrompt!(`${inspector.migration!.prompt}\nBundle: ${options.skill ?? ''}\nProcess: ${selected}\nDiagram: ${file}`)
              setMigrationSent(selected)
            } catch (failure) { setMigrationError(String(failure)) }
          })
        }}>{inspector.migration.action_label}</Button> : null}
        {migrationError || migrationSent === selected ? <PanelContentState state={migrationError ? 'error' : 'empty'} appearance="inline"
          message={migrationError || t('diagramMigrationSent')} /> : null}
      </div> : null}
      {documentMode && details && inspector && selected ? <div ref={content} className="dsh-diagram-details dsh-diagram-document">
        {looseRecord ? <><p className="dsh-diagram-context-hint">{t('diagramUnassignedHint')}</p>{renderSections(looseRecord.group.sections, looseRecord.id)}</> : <Fragment key={selected}>
          <PanelContentGroup className="dsh-diagram-document-group dsh-diagram-document-overview" title={t('diagramProcessInformation')}>
          <div className="dsh-design-form-group-content">
          <section className="dsh-diagram-document-section dsh-design-form-group-fields dsh-panel-content-card" data-diagram-record="">
            {renderSections(inspector.process_sections, selected, true)}
            {relatedContent()}
          </section>
          </div>
          </PanelContentGroup>
          {nodes.length ? <PanelContentGroup className="dsh-diagram-document-group dsh-diagram-document-nodes"
            title={<PanelFieldCaption label={t('diagramProcessNodes')} count={nodes.length} />}>
          <div className="dsh-design-form-group-content dsh-design-form-group-fields">
          {nodes.map(item => {
            const context = contextFor(item.id)
            return <section key={item.id} className="dsh-diagram-document-section dsh-panel-content-card" data-diagram-record={item.id}>
              <PanelRecordHeader titleRole="record" recordId={item.id} meta={context?.performer ? `${t('diagramPerformer')}: ${context.performer}` : undefined}><span className="dsh-design-record-header-label">{nodeLabel(item)}</span></PanelRecordHeader>
              {file && contexts[file] && !context ? <p role="status" className="dsh-diagram-context-hint">{t('diagramStepMissing')}</p> : null}
              {renderSections(inspector.nodes.sections, item.id, true)}
              {context?.outgoing.length ? <p className="dsh-diagram-node-context">{t('diagramNext')}: {context.outgoing.map(flow => flow.label ? `${flow.label} → ${flow.target}` : flow.target).join(' · ')}</p> : null}
              {relatedContent(item.id)}
            </section>
          })}
          </div>
          </PanelContentGroup> : null}
        </Fragment>}
      </div> : null}
      {!inspector && details && selected ? <div className="dsh-diagram-details">{config.detail_rows && value ? <RecordFacts fields={manifest.fields.filter(field => field.applies_to?.includes(section))} value={value} rows={config.detail_rows} chips={config.chip_fields} /> : render(selected)}</div> : <>
      <div hidden={documentMode && details} className={`dsh-diagram-body${!documentMode && inspector && inspectorOpen && !editing ? ' has-inspector' : ''}`}>
      <div className="dsh-diagram-stage">
        {xml && file && selected ? <BpmnSurface key={`${selected}:${fileKey}:${editing}:${transportEpoch.current.value}`} xml={xml} editing={editing} disabled={switching || (editing && !options?.editable)} navigationFlush={flush}
          active={active} progress={progress}
          selectedElement={selectedNode ? String(selectedNode.values[inspector!.nodes.element_field] || '') : undefined}
          onContext={inspector ? items => setContexts(current => ({ ...current, [file]: items })) : undefined}
          onSelectElement={inspector ? element => {
            const match = diagramNodeForElement(manifest, data, inspector.nodes, selected, element)
            if (documentMode && match && !editing) { void navigable(() => openDocument(selected, match.id)) }
            else { selectNode(match?.id); selectLoose(undefined); setUnmappedElement(!!element && !match); setInspectorOpen(true) }
          } : undefined}
          register={options?.registerBeforeSave ?? (() => () => {})} onChange={content => {
            if (latest.current.selected !== selected || latest.current.file !== file) throw Error('The selected diagram changed.')
            options?.onStageArtifact?.({ path: file, content, binding: { recordsPath: binding.recordsPath, record: selected, fieldsPath: binding.fieldsPath, field: config.file_field } })
          }} />
          : <div className="dsh-artifact-placeholder">{!active || readError || unavailable ? <PanelContentState kind="canvas"
            state={readError ? 'error' : file && options?.readArtifact ? 'loading' : selected ? 'unavailable' : 'empty'}
            message={readError || (file && options?.readArtifact ? t('diagramLoading') : t('diagramUnavailable'))}>
            {file && readError ? <button type="button" onClick={() => setRetry(value => value + 1)}>{t('retry')}</button> : null}
            </PanelContentState> : null}
            {progress}
          </div>}
      </div>
      {!documentMode && inspector && inspectorOpen && !editing && selected ? <aside className="dsh-diagram-inspector" aria-label={t('diagramContext')}>
        <header className="dsh-diagram-inspector-heading"><h2>{looseRecord ? t('diagramUnassigned') : selectedNode ? t('diagramStep') : t('diagramOverview')}</h2>
          {selectedNode || looseRecord ? <button type="button" onClick={() => { selectNode(undefined); selectLoose(undefined); setUnmappedElement(false) }}>{t('diagramOverview')}</button> : null}</header>
        {unmappedElement ? <p role="status" className="dsh-diagram-context-hint">{t('diagramUnmappedElement')}</p> : null}
        <div key={`${selected}:${looseRecord?.id ?? selectedNode?.id ?? 'overview'}`}>
          {looseRecord ? <><p className="dsh-diagram-context-hint">{t('diagramUnassignedHint')}</p>{renderSections(looseRecord.group.sections, looseRecord.id)}</> : selectedNode ? renderSections(inspector.nodes.sections, selectedNode.id) : renderSections(inspector.process_sections, selected)}
          {!looseRecord ? relatedContent(selectedNode?.id) : null}
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
