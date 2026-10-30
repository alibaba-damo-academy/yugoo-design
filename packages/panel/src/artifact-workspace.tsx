import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { sidebarIcon } from './sidebar-icon.tsx'
import remarkGfm from 'remark-gfm'
import type { ComponentNode } from './dsl.ts'
import { pathGet, type DesignData } from './record-state.ts'
import type { RenderOptions } from './interpreter.ts'
import { PanelWorkspace, PanelWorkspaceTree, PanelWorkspaceTreeItem, PanelWorkspaceTreeRecord } from './panel-workspace.tsx'
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
  points: string[]; links: string[]
}
export interface ArtifactGroup extends ArtifactItem { children: ArtifactItem[] }

/** Projection only: no transient status or guessed reference is written into Design JSON. */
export function artifactGroups(data: DesignData, config: Config, owner: string | undefined, attempts: readonly Attempt[] = [], files: Readonly<Record<string, string>> = {}, activities: NonNullable<RenderOptions['artifactActivities']> = []): ArtifactGroup[] {
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
      return { id: key, title: title || key, file, fileAvailable: file !== undefined && files[file] !== undefined,
        status: execution.status, runId: execution.runId, logTarget: execution.logTarget, points, links }
    }
    const children = orderedArtifactRecords(pathGet(value as DesignData, config.children.records_field), config.children.order_field ? pathGet(value as DesignData, config.children.order_field) : undefined).map(([childId, child]) => {
      const scopedId = config.children.scoped_ids ? `${id}/${childId}` : childId
      const hasScoped = activities.some(activity => activity.artifactKind === config.children.artifact_kind && activity.artifactId === scopedId) || active.some(attempt => attempt.artifactKind === config.children.artifact_kind && attempt.artifactId === scopedId)
      const projected = item(hasScoped ? scopedId : childId, stringAt(child, config.children.title_field), pathGet(child as DesignData, config.children.file_field), config.children.artifact_kind, hasScoped ? active : scoped,
        config.children.points_field ? strings(pathGet(child as DesignData, config.children.points_field)) : [], config.children.links_field ? strings(pathGet(child as DesignData, config.children.links_field)) : [])
      return { ...projected, id: childId }
    })
    const parent = item(id, stringAt(value, config.title_field), pathGet(value as DesignData, config.file_field), config.artifact_kind, scoped)
    const root = projectRootExecution(scoped)
    if (root.status === 'working' || root.status === 'queued' || root.status === 'failed') parent.status = root.status
    else if (parent.status !== 'unknown' && children.some(child => child.status === 'working' || child.status === 'queued')) parent.status = 'working'
    return { ...parent, children }
  })
}

export function ExecutionTrace({ item, read }: { item: ArtifactItem; read: RenderOptions['readExecutionLog'] }) {
  const { t, locale } = usePanelI18n()
  return <ExecutionRollingLog runId={item.runId} logTarget={item.logTarget}
    active={item.status === 'working' || item.status === 'queued'} label={t('executionTrace')}
    unavailableLabel={t('traceUnavailable')} locale={locale.startsWith('en') ? 'en' : 'zh'}
    presentation="conversation" maxEntries={200} readExecutionLog={read} />
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
  return <div className={`dsh-artifact-preview${html ? ' is-document' : ''}`} aria-busy={result.loading === true}>
    {result.failed && hasContent ? <PanelContentState state="error" message={t('documentUnavailable')} appearance="inline" /> : null}
    {hasContent ? html ? <iframe title={item.title} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={secureDesignSrcDoc(visible!, 'static-document')} />
      : <div className="dsh-artifact-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{visible}</ReactMarkdown></div>
      : <PanelContentState state={result.loading ? 'loading' : result.failed ? 'error' : item.file && !options?.readArtifact ? 'unavailable' : 'empty'}
        message={result.loading ? t('refreshing') : result.failed || item.file && !options?.readArtifact ? t('documentUnavailable') : t('emptyDocument')} />}
  </div>
}

export function ArtifactWorkspace({ node, data, options }: { node: ComponentNode; data: DesignData; options?: RenderOptions }) {
  const { t } = usePanelI18n(), config = node.artifacts!
  const groups = useMemo(() => artifactGroups(data, config, options?.skill, options?.executionAttempts, options?.artifactFiles, options?.artifactActivities), [data, config, options?.skill, options?.executionAttempts, options?.artifactFiles, options?.artifactActivities])
  const current = config.current_path ? pathGet(data, config.current_path) : undefined
  const [selection, setSelection] = useState<{ parent: string; child?: string }>(() => ({ parent: groups.find(group => group.id === current)?.id ?? groups[0]?.id ?? '' }))
  const previousCurrent = useRef(current)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const published = useRef(new Map(groups.map(group => [group.id, group.file && options?.artifactFiles?.[group.file] ? group.file : undefined])))
  useEffect(() => {
    const next = new Map(groups.map(group => [group.id, group.file && options?.artifactFiles?.[group.file] ? group.file : undefined]))
    const newlyPublished = groups.filter(group => next.get(group.id) && next.get(group.id) !== published.current.get(group.id))
    published.current = next
    const target = newlyPublished.find(group => group.id === current) ?? newlyPublished[0]
    if (target) setSelection({ parent: target.id })
  }, [groups, current, options?.artifactFiles])
  useEffect(() => {
    if (current !== previousCurrent.current) { previousCurrent.current = current; const target = groups.find(group => group.id === current); if (target) { setSelection({ parent: target.id }); return } }
    if (!groups.some(group => group.id === selection.parent)) setSelection({ parent: groups[0]?.id ?? '' })
  }, [groups, current, selection.parent])
  const group = groups.find(value => value.id === selection.parent)
  const selected = group?.children.find(value => value.id === selection.child)
  const item = selected ?? group
  const [refresh, setRefresh] = useState(0)
  const content = useArtifactContent(item, options, refresh)
  const status = (value: ArtifactItem) => value.fileAvailable && value.status === 'failed'
    ? t('artifactAvailableWithFailedAttempt') : t(`artifact_${value.status}`)
  return <div className="dsh-artifact-workspace"><PanelWorkspace guidance={node.guidance} autoSaveId={`artifact:${node.id}`} sidebar={<PanelWorkspaceTree icon={sidebarIcon(node.sidebar_icon)} title={node.title ?? t('document')}>
    {groups.map(parent => <PanelWorkspaceTreeRecord key={parent.id} ariaLabel={parent.title} label={parent.title}
      trailing={<ArtifactStatusIcon status={parent.status} label={status(parent)} />}
      expanded={!collapsed.has(parent.id)} onToggle={() => setCollapsed(previous => { const next = new Set(previous); next.has(parent.id) ? next.delete(parent.id) : next.add(parent.id); return next })}
      selected={selection.parent === parent.id && !selection.child} onSelect={() => setSelection({ parent: parent.id })}>
      {parent.children.length ? parent.children.map(child => <PanelWorkspaceTreeItem key={child.id} ariaLabel={child.title} selected={selection.parent === parent.id && selection.child === child.id}
        trailing={<ArtifactStatusIcon status={child.status} label={status(child)} />}
        onSelect={() => setSelection({ parent: parent.id, child: child.id })}>{child.title}</PanelWorkspaceTreeItem>) : undefined}
    </PanelWorkspaceTreeRecord>)}
  </PanelWorkspaceTree>}>
    {!item ? <PanelContentState state="empty" message={node.description ?? t('emptyDocument')} /> : <>
      <header className="dsh-document-toolbar"><strong>{item.title}</strong><div className="dsh-artifact-toolbar-actions"><span role="status">{status(item)}</span>
        <button type="button" disabled={!item.file || !options?.readArtifact || content.loading} onClick={() => setRefresh(value => value + 1)}>{content.loading ? t('refreshing') : t('refresh')}</button>
      </div></header>
      {!selected && group?.file && group.children.some(child => !child.fileAvailable) ? <p role="status" className="dsh-artifact-warning">{t('partialArtifacts', { count: group.children.filter(child => child.fileAvailable).length, total: group.children.length })}</p> : null}
      <div className="dsh-artifact-content">
        {selected || group?.file ? <>
          {item.points.length ? <ul>{item.points.map((point, index) => <li key={index}>{point}</li>)}</ul> : null}
          <ExecutionTrace key={item.runId} item={item} read={options?.readExecutionLog} />
          <ArtifactPreview key={`${group?.id}/${selected?.id ?? ''}`} item={item} options={options} result={content} />
          {item.links.length ? <section><h3>{t('sources')}</h3>{item.links.map((link, index) => httpUrl(link) ? <a key={index} href={link} target="_blank" rel="noopener noreferrer">{link}</a> : <p key={index}>{link}</p>)}</section> : null}
        </> : group?.children.map(child => <article key={child.id} className="dsh-artifact-card">
          <button type="button" onClick={() => setSelection({ parent: group.id, child: child.id })}><strong>{child.title}</strong><span>{status(child)}</span></button>
          <ul>{child.points.map((point, index) => <li key={index}>{point}</li>)}</ul>
          <ExecutionTrace item={child} read={options?.readExecutionLog} />
        </article>)}
      </div>
    </>}
  </PanelWorkspace></div>
}
