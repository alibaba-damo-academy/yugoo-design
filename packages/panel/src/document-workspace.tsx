import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sidebarIcon } from './sidebar-icon.tsx'
import type { ComponentNode } from './dsl.ts'
import { pathGet, type DesignData } from './record-state.ts'
import type { RenderOptions } from './interpreter.ts'
import { PanelRecordHeader, PanelWorkspace, PanelWorkspaceTree, PanelWorkspaceTreeItem } from './panel-workspace.tsx'
import { secureDesignSrcDoc } from './client/srcdoc-security.ts'
import { panelText, usePanelI18n } from './panel-i18n.tsx'
import { PanelContentState } from './panel-content-state.tsx'
import { projectRootExecution } from './artifact-execution.ts'
import { ExecutionTrace } from './artifact-workspace.tsx'

export function documentArtifactPath(value: unknown, config: NonNullable<ComponentNode['document']>, owner?: string): string | undefined {
  if (typeof value !== 'string') return
  const path = Object.hasOwn(config.aliases ?? {}, value) ? config.aliases![value] : value
  if (!owner || !path?.startsWith(`${owner}/`) || !config.allowed_files.includes(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return
  return path
}

interface Chapter { id: string; title: string }
const split = (text: string | null) => [...new Set((text ?? '').split(/[\s,，、]+/u).filter(Boolean))]

export function DocumentWorkspace({ node, data, options }: { node: ComponentNode; data: DesignData; options?: RenderOptions }) {
  const { locale, t } = usePanelI18n(), config = node.document!
  const rawPath = pathGet(data, config.path), path = documentArtifactPath(rawPath, config, options?.skill)
  const rawTitle = config.title_path ? pathGet(data, config.title_path) : undefined
  const title = typeof rawTitle === 'string' && rawTitle ? rawTitle : node.title ?? t('document')
  const root = projectRootExecution(options?.executionAttempts)
  const activity = [...(options?.artifactActivities ?? [])].filter(item => item.artifactFile === path).sort((a, b) => b.sequence - a.sequence)[0]
  const focusedStatus = activity?.active && activity.available ? activity.nativeStatus : undefined
  const execution = focusedStatus === 'running' ? { status: 'working' as const, runId: activity?.runId, logTarget: activity?.logTarget } : root
  const working = execution.status === 'queued' || execution.status === 'working'
  const [reload, setReload] = useState(0)
  const [loaded, setLoaded] = useState<{ path: string; content: string; found: boolean }>()
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const [chapters, setChapters] = useState<Chapter[]>([]), [active, setActive] = useState<string>()
  const frame = useRef<HTMLIFrameElement>(null), cleanup = useRef<() => void>()
  const content = loaded && loaded.path === path && loaded.found ? loaded.content : undefined
  const missing = loaded?.path === path && loaded?.found === false
  const readError = (!!rawPath && !path) || (failed && !missing) || (!!path && !options?.readArtifact)
  useEffect(() => {
    setFailed(false)
    if (!path || !options?.readArtifact) { setLoaded(undefined); setBusy(false); return }
    let live = true
    setBusy(true)
    void options.readArtifact(path).then(result => {
      if (!live) return
      setLoaded({ path, content: result.content, found: result.found }); setFailed(!result.found)
    }).catch(() => { if (live) { setLoaded(undefined); setFailed(true) } }).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [path, options?.readArtifact, options?.sourceRevision, options?.collapseToken, reload])
  useEffect(() => {
    cleanup.current?.(); cleanup.current = undefined
    setChapters([]); setActive(undefined)
    return () => cleanup.current?.()
  }, [content, working])
  const srcDoc = useMemo(() => working || content === undefined || !content.trim() ? undefined : secureDesignSrcDoc(content, 'static-document'), [content, working])
  const rawReferences = config.references_path ? pathGet(data, config.references_path) : undefined
  const ids = useMemo(() => {
    const references = Array.isArray(rawReferences) ? rawReferences : rawReferences && typeof rawReferences === 'object' ? Object.values(rawReferences) : []
    return new Set(references.flatMap(record => record && typeof record === 'object' && typeof record[config.references_id_field ?? ''] === 'string' ? [record[config.references_id_field!]] : []))
  }, [rawReferences, config.references_id_field])
  const referenceLabel = useCallback((count: number) => config.references_label ? `${config.references_label} ×${count}` : panelText('referenceCount', locale, { count }), [config.references_label, locale])
  const showLegend = !!config.legend && (!config.references_path || ids.size > 0)
  const sourcesLabel = t('sources')
  const onLoad = useCallback(() => {
    cleanup.current?.()
    const doc = frame.current?.contentDocument, window = frame.current?.contentWindow
    if (!doc || !window) return
    const headings = [...doc.querySelectorAll('h2')]
    const notes: HTMLElement[] = []
    const next = headings.flatMap((heading, index) => {
      const title = heading.textContent?.trim()
      if (!title) return []
      const id = `document-chapter-${index + 1}`
      heading.id = id
      const sources = config.source_attribute ? split(heading.getAttribute(config.source_attribute)) : []
      const references = config.references_attribute ? split(heading.getAttribute(config.references_attribute)) : []
      const count = references.filter(value => ids.has(value)).length
      if (sources.length || !showLegend && count) {
        // Derived reading annotations stay beside their chapter, not above the
        // whole document. Inherit the authored document's ordinary prose/link
        // typography; never write them into the canonical HTML artifact.
        const note = doc.createElement('p')
        note.className = 'dsh-document-chapter-sources'
        note.dataset.documentChapterSources = id
        if (sources.length) {
          note.append(`${sourcesLabel}: `)
          sources.forEach((source, sourceIndex) => {
            if (sourceIndex) note.append(' · ')
            const definition = config.sources?.find(item => item.value === source)
            const label = definition?.label ?? source
            if (definition?.navigable && options?.selectPanel) {
              const link = doc.createElement('a')
              link.href = `#${id}`
              link.textContent = label
              link.addEventListener('click', event => { event.preventDefault(); options.selectPanel?.(source) })
              note.append(link)
            } else {
              const context = doc.createElement('span')
              context.textContent = label
              note.append(context)
            }
          })
        }
        if (!showLegend && count) note.append(`${sources.length ? ' · ' : ''}${referenceLabel(count)}`)
        const container = heading.closest('section, article') ?? heading.parentElement
        let boundary: Element | null = headings[index + 1] ?? null
        if (!container?.contains(boundary)) boundary = null
        while (boundary && boundary.parentElement !== container) boundary = boundary.parentElement
        container?.insertBefore(note, boundary)
        notes.push(note)
      }
      return [{ id, title }]
    })
    setChapters(next); setActive(next[0]?.id)
    const onScroll = () => {
      const scrolling = doc.scrollingElement ?? doc.documentElement
      const atEnd = scrolling.scrollHeight > window.innerHeight + 1
        && scrolling.scrollTop + window.innerHeight >= scrolling.scrollHeight - 1
      let id = next[0]?.id
      for (const chapter of next) if ((doc.getElementById(chapter.id)?.getBoundingClientRect().top ?? Infinity) <= 96) id = chapter.id
      setActive(atEnd ? next.at(-1)?.id : id)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    cleanup.current = () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); notes.forEach(note => note.remove()) }
  }, [config.source_attribute, config.references_attribute, config.sources, options?.selectPanel, ids, showLegend, referenceLabel, sourcesLabel])
  useEffect(() => {
    if (frame.current?.contentDocument?.readyState === 'complete') onLoad()
  }, [onLoad, srcDoc])
  const status = working ? t('documentWorking') : content !== undefined ? undefined
    : focusedStatus === 'failed' || focusedStatus === 'interrupted' || root.status === 'failed' ? t('documentFailed') : undefined
  return <div className="dsh-document-workspace"><PanelWorkspace guidance={node.guidance} autoSaveId={`document:${node.id}`} sidebar={<PanelWorkspaceTree icon={sidebarIcon(node.sidebar_icon)} title={node.title ?? t('contents')}>
    {!working && chapters.map(chapter => <PanelWorkspaceTreeItem key={chapter.id} selected={active === chapter.id} onSelect={() => {
      frame.current?.contentDocument?.getElementById(chapter.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); setActive(chapter.id)
    }}>{chapter.title}</PanelWorkspaceTreeItem>)}
    {!working && !chapters.length ? <p>{t('noChapters')}</p> : null}
  </PanelWorkspaceTree>}>
    <PanelRecordHeader placement="workspace" className="dsh-document-toolbar"><strong>{title}</strong>{status ? <span role="status">{status}</span> : null}
      <button type="button" disabled={!path || busy} onClick={() => setReload(value => value + 1)}>{busy ? t('refreshing') : t('refresh')}</button></PanelRecordHeader>
    {showLegend ? <div className="dsh-document-legend">{config.legend}{config.references_path ? <span>{referenceLabel(ids.size)}</span> : null}</div> : null}
    <div className="dsh-document-body" aria-busy={busy || working}>
      {working && !readError ? <div className="dsh-artifact-placeholder"><ExecutionTrace item={{ id: node.id, title, file: path, ...execution, points: [], links: [] }} read={options?.readExecutionLog} /></div>
        : srcDoc !== undefined ? <iframe ref={frame} srcDoc={srcDoc} sandbox="allow-same-origin" referrerPolicy="no-referrer" title={title} onLoad={onLoad} />
        : <PanelContentState state={rawPath && !path || failed ? 'error' : busy ? 'loading' : path && !options?.readArtifact ? 'unavailable' : 'empty'}
          message={rawPath && !path ? t('invalidDocumentPath') : failed || path && !options?.readArtifact ? t('documentUnavailable') : busy ? t('refreshing') : node.description ?? t('emptyDocument')} />}
    </div>
  </PanelWorkspace></div>
}
