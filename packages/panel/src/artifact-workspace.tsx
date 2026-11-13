import type { DesignArtifactHistoryEntry } from './client/types.ts'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { sidebarIcon } from './sidebar-icon.tsx'
import remarkGfm from 'remark-gfm'
import type { ComponentNode, EditorField } from './dsl.ts'
import { pathGet, pathSet, type DesignData } from './record-state.ts'
import type { RenderOptions } from './interpreter.ts'
import { PanelRecordHeader, PanelWorkspace, PanelWorkspaceTree, PanelWorkspaceTreeItem, PanelWorkspaceTreeRecord } from './panel-workspace.tsx'
import { usePanelI18n } from './panel-i18n.tsx'
import { secureDesignSrcDoc } from './client/srcdoc-security.ts'
import { ExecutionRollingLog } from './client/execution-rolling-log.tsx'
import { ArtifactStatusIcon } from './artifact-status-icon.tsx'
import { PanelContentState } from './panel-content-state.tsx'
import { projectArtifactExecution, projectArtifactFile, projectRootExecution, type ProjectedArtifactStatus } from './artifact-execution.ts'

type Config = NonNullable<ComponentNode['artifacts']>
type RecordValue = Record<string, unknown>
type Attempt = NonNullable<RenderOptions['executionAttempts']>[number]
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const stringAt = (value: RecordValue, path: string) => { const text = pathGet(value as DesignData, path); return typeof text === 'string' ? text : undefined }
const httpUrl = (url: string) => /^https?:\/\//iu.test(url) ? url : undefined
const markdownComponents: Components = {
  table: ({ node: _node, ...props }) => <div className="dsh-artifact-markdown-table" tabIndex={0}><table {...props} /></div>,
}

/** Preserve all records, including a newly landed one not yet added to its order. */
export function orderedArtifactRecords(value: unknown, order: unknown): [string, RecordValue][] {
  if (!record(value)) return []
  return [...new Set([...strings(order), ...Object.keys(value)])].flatMap(id => Object.hasOwn(value, id) && record(value[id]) ? [[id, value[id]] as [string, RecordValue]] : [])
}

/** No absolute paths, other Bundles, URLs, traversal or prototype-shaped segments. */
export function confinedTextArtifact(value: unknown, owner?: string): string | undefined {
  if (typeof value !== 'string' || !owner || !value.startsWith(`${owner}/`) || /[\\?#\u0000-\u001f]/u.test(value)
    || value.split('/').some(part => !part || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(part)) || !/\.(?:md|html?)$/iu.test(value)) return
  return value
}

export interface ArtifactItem {
  id: string; title: string; file?: string; status: ProjectedArtifactStatus; runId?: string
  /** Observed by the artifact workspace; trace-only callers may omit it. */
  fileAvailable?: boolean
  logTarget?: import('./client/types.ts').DesignArtifactLogTarget
  history?: DesignArtifactHistoryEntry
  points: string[]; links: string[]
}
export interface ArtifactGroup extends ArtifactItem { children: ArtifactItem[] }

/** Projection only: no transient status or guessed reference is written into Design JSON. */
export function artifactGroups(data: DesignData, config: Config, owner: string | undefined, attempts: readonly Attempt[] = [], files: Readonly<Record<string, string>> = {}, activities: NonNullable<RenderOptions['artifactActivities']> = [], history: readonly DesignArtifactHistoryEntry[] = []): ArtifactGroup[] {
  const newest = [...attempts].sort((a, b) => b.sequence - a.sequence)[0]
  const active = attempts.filter(attempt => attempt.invocationId === newest?.invocationId)
  const current = pathGet(data, config.current_path ?? '')
  const roots = orderedArtifactRecords(pathGet(data, config.records_path), config.order_path ? pathGet(data, config.order_path) : undefined)
  // Bound paths and scoped ids override a lagging current-parent hint.
  const associationParent = [...activities].filter(activity => activity.active).sort((a, b) => b.sequence - a.sequence)
    .flatMap(activity => roots.filter(([id, value]) => activity.artifactId === id || config.children.scoped_ids && activity.artifactId.startsWith(`${id}/`) || activity.artifactFile === stringAt(value, config.file_field) || orderedArtifactRecords(pathGet(value as DesignData, config.children.records_field), undefined).some(([, child]) => activity.artifactFile === stringAt(child, config.children.file_field))).map(([id]) => id))[0]
  const executing = associationParent ?? [...active].sort((a, b) => b.sequence - a.sequence).flatMap(attempt => {
    const match = roots.find(([id, value]) => attempt.artifactKind === config.artifact_kind && attempt.artifactId === id
      || attempt.artifactKind === config.children.artifact_kind && config.children.scoped_ids && attempt.artifactId.startsWith(`${id}/`)
      || [attempt.artifactFile, attempt.receipt?.path].some(path => path !== undefined && (path === stringAt(value, config.file_field)
        || orderedArtifactRecords(pathGet(value as DesignData, config.children.records_field), undefined).some(([, child]) => path === stringAt(child, config.children.file_field)))))
    return match ? [match[0]] : []
  })[0] ?? current
  return roots.map(([id, value]) => {
    const scoped = id === executing ? active : []
    const item = (key: string, title: string | undefined, ref: unknown, kind: string, source: readonly Attempt[], points: string[] = [], links: string[] = []): ArtifactItem => {
      const stored = confinedTextArtifact(ref, owner)
      const file = stored ?? confinedTextArtifact(projectArtifactFile(key, source, kind, files, undefined, activities), owner)
      const execution = projectArtifactExecution(key, source, kind, file !== undefined && files[file] !== undefined, 'pending', file, activities)
      const previous = history.filter(entry => entry.skill === owner && entry.artifactId === key && entry.artifactKind === kind
        && (file === undefined || file === entry.artifactFile)).sort((a, b) => b.timestamp - a.timestamp)[0]
      return { id: key, title: title || key, file, fileAvailable: file !== undefined && files[file] !== undefined,
        status: execution.status === 'pending' && previous && ['failed', 'cancelled'].includes(previous.phase) ? 'failed' : execution.status,
        runId: execution.runId, logTarget: execution.logTarget, history: previous, points, links }
    }
    const children = orderedArtifactRecords(pathGet(value as DesignData, config.children.records_field), config.children.order_field ? pathGet(value as DesignData, config.children.order_field) : undefined).map(([childId, child]) => {
      const scopedId = config.children.scoped_ids ? `${id}/${childId}` : childId
      const hasScoped = activities.some(activity => activity.artifactKind === config.children.artifact_kind && activity.artifactId === scopedId)
        || active.some(attempt => attempt.artifactKind === config.children.artifact_kind && attempt.artifactId === scopedId)
        || history.some(entry => entry.skill === owner && entry.artifactKind === config.children.artifact_kind && entry.artifactId === scopedId)
      const projected = item(hasScoped ? scopedId : childId, stringAt(child, config.children.title_field), pathGet(child as DesignData, config.children.file_field), config.children.artifact_kind, hasScoped ? active : scoped,
        config.children.points_field ? strings(pathGet(child as DesignData, config.children.points_field)) : [], config.children.links_field ? strings(pathGet(child as DesignData, config.children.links_field)) : [])
      return { ...projected, id: childId }
    })
    const parent = item(id, stringAt(value, config.title_field), pathGet(value as DesignData, config.file_field), config.artifact_kind, scoped)
    const root = projectRootExecution(scoped)
    if (root.status === 'working' || root.status === 'queued' || root.status === 'failed') {
      parent.status = root.status
      if (root.status !== 'failed' && parent.runId === undefined && parent.logTarget === undefined) parent.runId = root.runId
    }
    else if (parent.status !== 'unknown' && children.some(child => child.status === 'working' || child.status === 'queued')) parent.status = 'working'
    return { ...parent, children }
  })
}

export function ExecutionTrace({ item, read, presentation = 'conversation', retainHistory = false }: {
  item: ArtifactItem; read: RenderOptions['readExecutionLog']; presentation?: 'panel' | 'conversation'; retainHistory?: boolean
}) {
  const { t, locale } = usePanelI18n()
  // Actual execution remains visible even when this Host has no exact log reader.
  // A missing log association must never become a fabricated transcript or blank wait.
  if (!retainHistory && (item.status === 'working' || item.status === 'queued') && (!item.runId || !read)) {
    return <PanelContentState state="loading" appearance="inline" message={t('documentWorking')} />
  }
  return <ExecutionRollingLog runId={item.runId} logTarget={item.logTarget}
    active={item.status === 'working' || item.status === 'queued'} retainHistory={retainHistory}
    label={t(retainHistory ? 'executionTrace' : 'documentWorking')}
    unavailableLabel={t('traceUnavailable')} locale={locale.startsWith('en') ? 'en' : 'zh'}
    presentation={presentation} maxEntries={200} readExecutionLog={read} />
}

function useArtifactContent(item: ArtifactItem | undefined, options: RenderOptions | undefined, refresh: number) {
  const [result, setResult] = useState<{ path?: string; content?: string; failed?: boolean; loading?: boolean }>({})
  const file = item?.file
  const digest = file ? options?.artifactFiles?.[file] : undefined
  useEffect(() => {
    let live = true
    if (!file || !options?.readArtifact) { setResult({}); return }
    const path = file
    setResult(previous => ({ ...previous, loading: true, failed: false }))
    void options.readArtifact(path).then(value => {
      if (live) setResult(value.found ? { path, content: value.content } : { path, failed: true })
    }).catch(() => { if (live) setResult(previous => ({ ...previous, loading: false, failed: true })) })
    return () => { live = false }
  }, [file, digest, options?.readArtifact, options?.collapseToken, refresh])
  return result
}

function ArtifactPreview({ item, options, result }: { item: ArtifactItem; options?: RenderOptions; result: ReturnType<typeof useArtifactContent> }) {
  const { t } = usePanelI18n()
  const visible = result.path === item.file ? result.content : undefined
  const hasContent = visible !== undefined && visible.trim() !== ''
  const html = visible !== undefined && (/\.html?$/iu.test(item.file ?? '') || /<!doctype html|<html[\s>]/iu.test(visible))
  const active = item.status === 'working' || item.status === 'queued'
  const unavailable = !!item.file && !options?.readArtifact
  const contentError = result.failed || unavailable
  const progress = <ExecutionTrace item={item} read={options?.readExecutionLog} />
  return <div className={`dsh-artifact-preview${html ? ' is-document' : ''}${hasContent ? '' : ' is-pending'}`} aria-busy={result.loading === true}>
    {result.failed && hasContent ? <PanelContentState state="error" message={t('documentUnavailable')} appearance="inline" /> : null}
    {hasContent ? progress : null}
    {hasContent ? html ? <iframe title={item.title} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={secureDesignSrcDoc(visible!, 'static-document')} />
      : <div className="dsh-artifact-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{visible}</ReactMarkdown></div>
      : <div className="dsh-artifact-placeholder">{!active || contentError ? <PanelContentState state={result.failed ? 'error' : unavailable ? 'unavailable' : result.loading ? 'loading' : item.status === 'failed' ? 'error' : 'empty'}
        message={contentError ? t('documentUnavailable') : result.loading ? t('refreshing') : item.status === 'failed' ? t('documentFailed') : t('emptyDocument')} /> : null}{progress}</div>}
  </div>
}

export function ArtifactWorkspace({ node, data, options, render }: {
  node: ComponentNode; data: DesignData; options?: RenderOptions
  render?: (fields: readonly EditorField[], titleField: string, value: RecordValue, id: string,
    change: (update: (current: RecordValue) => RecordValue) => void, part: 'header' | 'body', accessory?: ReactNode, recordId?: string) => ReactNode
}) {
  const { t } = usePanelI18n(), config = node.artifacts!
  const [refresh, setRefresh] = useState(0)
  const [history, setHistory] = useState<{ reader?: RenderOptions['readArtifactHistory']; skill?: string; entries: readonly DesignArtifactHistoryEntry[] }>({ entries: [] })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  useEffect(() => {
    let live = true
    setHistory({ entries: [] }); setHistoryError(false)
    if (!options?.readArtifactHistory || !options.skill) { setHistoryLoading(false); return }
    setHistoryLoading(true)
    const reader = options.readArtifactHistory, skill = options.skill
    void reader(skill).then(entries => { if (live) setHistory({ reader, skill, entries }) })
      .catch(() => { if (live) setHistoryError(true) })
      .finally(() => { if (live) setHistoryLoading(false) })
    return () => { live = false }
  }, [options?.readArtifactHistory, options?.skill, refresh])
  const groups = useMemo(() => artifactGroups(data, config, options?.skill, options?.executionAttempts, options?.artifactFiles, options?.artifactActivities,
    history.reader === options?.readArtifactHistory && history.skill === options?.skill ? history.entries : []),
  [data, config, options?.skill, options?.readArtifactHistory, options?.executionAttempts, options?.artifactFiles, options?.artifactActivities, history])
  const current = config.current_path ? pathGet(data, config.current_path) : undefined
  const [selection, setSelection] = useState<{ parent: string; child?: string }>(() => ({ parent: groups.find(group => group.id === current)?.id ?? groups[0]?.id ?? '' }))
  const [details, setDetails] = useState(false)
  const select = (value: { parent: string; child?: string }) => { setDetails(false); setSelection(value) }
  const latest = useRef({ data, options, config })
  latest.current = { data, options, config }
  const changeRecord = (parentId: string, childId: string | undefined, update: (value: RecordValue) => RecordValue) => {
    const live = latest.current
    if (live.options?.editable !== true || !live.options.onPanelUpdate) return
    const parents = pathGet(live.data, live.config.records_path)
    if (!record(parents) || !record(parents[parentId])) return
    const parent = parents[parentId] as RecordValue
    const children = pathGet(parent as DesignData, live.config.children.records_field)
    if (childId !== undefined && (!record(children) || !record(children[childId]))) return
    const nextParent = childId === undefined ? update(parent)
      : pathSet(parent, live.config.children.records_field, { ...(children as RecordValue), [childId]: update((children as RecordValue)[childId] as RecordValue) })
    live.options.onPanelUpdate({ [live.config.records_path]: { ...parents, [parentId]: nextParent } })
  }
  const previousCurrent = useRef(current)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const published = useRef(new Map(groups.map(group => [group.id, group.file && options?.artifactFiles?.[group.file] ? group.file : undefined])))
  useEffect(() => {
    const next = new Map(groups.map(group => [group.id, group.file && options?.artifactFiles?.[group.file] ? group.file : undefined]))
    const newlyPublished = groups.filter(group => next.get(group.id) && next.get(group.id) !== published.current.get(group.id))
    published.current = next
    const target = newlyPublished.find(group => group.id === current) ?? newlyPublished[0]
    if (target && !selection.child && !details) setSelection({ parent: target.id })
  }, [groups, current, options?.artifactFiles, details, selection.child])
  useEffect(() => {
    if (current !== previousCurrent.current) { previousCurrent.current = current; const target = groups.find(group => group.id === current); if (target) { setSelection({ parent: target.id }); return } }
    if (!groups.some(group => group.id === selection.parent)) setSelection({ parent: groups[0]?.id ?? '' })
  }, [groups, current, selection.parent])
  const group = groups.find(value => value.id === selection.parent)
  const selected = group?.children.find(value => value.id === selection.child)
  const item = selected ?? group
  const content = useArtifactContent(item, options, refresh)
  const parents = pathGet(data, config.records_path)
  const parent = record(parents) && group ? parents[group.id] : undefined
  const childRecords = record(parent) ? pathGet(parent as DesignData, config.children.records_field) : undefined
  const value = selected && record(childRecords) ? childRecords[selected.id] : parent
  const fields = selected ? config.children.fields : config.fields
  const titleField = selected ? config.children.title_field : config.title_field
  const hasPlan = Boolean(render && fields?.length && record(value) && item)
  const busy = group?.status === 'working' || group?.status === 'queued'
  const hasOutput = Boolean(item?.file || !selected && group?.children.some(child => child.file))
  const showPlan = hasPlan && !hasOutput && !busy
  const hasDetails = Boolean(selected && (!showPlan || item?.history || historyError))
  const recordId = config.show_ids === true && item
    ? selected && config.children.scoped_ids ? `${group!.id}/${item.id}` : item.id : undefined
  const plan = (part: 'header' | 'body', accessory?: ReactNode) => hasPlan && group && item
    ? render!(fields!, titleField, value as RecordValue, `${group.id}/${selected?.id ?? ''}`,
      update => changeRecord(group.id, selected?.id, update), part, accessory, recordId) : null
  const status = (value: ArtifactItem) => value.fileAvailable && value.status === 'failed'
    ? t('artifactAvailableWithFailedAttempt') : t(`artifact_${value.status}`)
  const actions = item ? <div className="dsh-artifact-toolbar-actions">{item.status !== 'completed' ? <span role="status">{status(item)}</span> : null}
    {hasDetails ? <button type="button" aria-pressed={details} onClick={() => setDetails(!details)}>{details ? t(showPlan ? 'artifactPlan' : 'preview') : t('details')}</button> : null}
    <button type="button" disabled={content.loading || historyLoading || ((!item.file || !options?.readArtifact) && !options?.readArtifactHistory)} onClick={() => setRefresh(value => value + 1)}>{content.loading || historyLoading ? t('refreshing') : t('refresh')}</button>
  </div> : null
  const output = item ? (selected || group?.file || group?.children.length === 0 || busy && !group?.children.some(child => child.fileAvailable) ? <>
          <ArtifactPreview key={`${group?.id}/${selected?.id ?? ''}`} item={item} options={options} result={content} />
          {item.links.length ? <section className="dsh-artifact-sources"><h3>{t('sources')}</h3>{item.links.map((link, index) => httpUrl(link) ? <a key={index} href={link} target="_blank" rel="noopener noreferrer">{link}</a> : <p key={index}>{link}</p>)}</section> : null}
        </> : <><ExecutionTrace item={item} read={options?.readExecutionLog} />{group?.children.map(child => <article key={child.id} className="dsh-artifact-card">
          <button type="button" onClick={() => select({ parent: group.id, child: child.id })}><strong>{child.title}</strong><span>{status(child)}</span></button>
          <ul>{child.points.map((point, index) => <li key={index}>{point}</li>)}</ul>
        </article>)}</>) : null
  return <div className="dsh-artifact-workspace"><PanelWorkspace guidance={node.guidance} autoSaveId={`artifact:${node.id}`} sidebar={<PanelWorkspaceTree icon={sidebarIcon(node.sidebar_icon)} title={node.title ?? t('document')}>
    {groups.map(parent => <PanelWorkspaceTreeRecord key={parent.id} ariaLabel={parent.title} label={parent.title}
      trailing={<ArtifactStatusIcon status={parent.status} label={status(parent)} />}
      expanded={!collapsed.has(parent.id)} onToggle={() => setCollapsed(previous => { const next = new Set(previous); next.has(parent.id) ? next.delete(parent.id) : next.add(parent.id); return next })}
      selected={selection.parent === parent.id && !selection.child} onSelect={() => select({ parent: parent.id })}>
      {parent.children.length ? parent.children.map(child => <PanelWorkspaceTreeItem key={child.id} ariaLabel={child.title} selected={selection.parent === parent.id && selection.child === child.id}
        trailing={<ArtifactStatusIcon status={child.status} label={status(child)} />}
        onSelect={() => select({ parent: parent.id, child: child.id })}>{child.title}</PanelWorkspaceTreeItem>) : undefined}
    </PanelWorkspaceTreeRecord>)}
  </PanelWorkspaceTree>}>
    {!item ? <PanelContentState state="empty" message={node.description ?? t('emptyDocument')} /> : <>
      {showPlan && !details ? <div className="dsh-record-workspace-header">{plan('header', actions)}</div>
        : <PanelRecordHeader placement="workspace" className="dsh-document-toolbar" recordId={recordId}><strong>{item.title}</strong>{actions}</PanelRecordHeader>}
      {!selected && group?.file && group.children.some(child => !child.fileAvailable) ? <p role="status" className="dsh-artifact-warning">{t('partialArtifacts', { count: group.children.filter(child => child.fileAvailable).length, total: group.children.length })}</p> : null}
      <div className={`dsh-artifact-content${!showPlan && !(hasDetails && details) ? ' is-reading' : ''}`}>
        {showPlan && !details ? <div className="dsh-artifact-plan">{plan('body')}</div> : null}
        {hasDetails && details ? <div className="dsh-artifact-details">
          <section className="dsh-artifact-questions">
            <h3>{t('artifactQuestions')}</h3>
            {item.points.length ? <ul>{item.points.map((point, index) => <li key={index}>{point}</li>)}</ul>
              : <p>{t('artifactNoQuestions')}</p>}
          </section>
          <p className="dsh-artifact-details-hint">{t('artifactActivityScope')}</p>
          {(item.history?.runId || item.runId) && options?.readExecutionLog
            ? <ExecutionTrace key={item.runId ?? item.history?.runId} item={!item.runId && item.history ? { ...item, runId: item.history.runId, logTarget: { artifactId: item.history.artifactId, invocationId: item.history.invocationId } } : item} read={options.readExecutionLog} presentation="panel" retainHistory />
            : <PanelContentState state="unavailable" appearance="inline" message={t(historyError ? 'traceUnavailable' : 'artifactActivityUnavailable')} />}
        </div> : null}
        <div className="dsh-artifact-output" hidden={showPlan || hasDetails && details}>{output}</div>
      </div>
    </>}
  </PanelWorkspace></div>
}
