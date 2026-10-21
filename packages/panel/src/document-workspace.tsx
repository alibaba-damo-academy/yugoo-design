import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sidebarIcon } from './sidebar-icon.tsx'
import type { ComponentNode } from './dsl.ts'
import { pathGet, type DesignData } from './record-state.ts'
import type { RenderOptions } from './interpreter.ts'
import { PanelWorkspace, PanelWorkspaceTree, PanelWorkspaceTreeItem } from './panel-workspace.tsx'
import { secureDesignSrcDoc } from './client/srcdoc-security.ts'
import { usePanelI18n } from './panel-i18n.tsx'
import { PanelContentState } from './panel-content-state.tsx'

export function documentArtifactPath(value: unknown, config: NonNullable<ComponentNode['document']>, owner?: string): string | undefined {
  if (typeof value !== 'string') return
  const path = Object.hasOwn(config.aliases ?? {}, value) ? config.aliases![value] : value
  if (!owner || !path?.startsWith(`${owner}/`) || !config.allowed_files.includes(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return
  return path
}

interface Chapter { id: string; title: string; sources: string[]; references: string[] }
const split = (text: string | null) => [...new Set((text ?? '').split(/[\s,，、]+/u).filter(Boolean))]

export function DocumentWorkspace({ node, data, options }: { node: ComponentNode; data: DesignData; options?: RenderOptions }) {
  const { t } = usePanelI18n(), config = node.document!
  const rawPath = pathGet(data, config.path), path = documentArtifactPath(rawPath, config, options?.skill)
  const rawTitle = config.title_path ? pathGet(data, config.title_path) : undefined
  const title = typeof rawTitle === 'string' && rawTitle ? rawTitle : node.title ?? t('document')
  const [reload, setReload] = useState(0)
  const [loaded, setLoaded] = useState<{ path: string; content: string }>()
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const [chapters, setChapters] = useState<Chapter[]>([]), [active, setActive] = useState<string>()
  const frame = useRef<HTMLIFrameElement>(null), cleanup = useRef<() => void>()
  const content = loaded && loaded.path === path ? loaded.content : undefined
  useEffect(() => {
    setFailed(false)
    if (!path || !options?.readArtifact) { setLoaded(undefined); setBusy(false); return }
    let live = true
    setBusy(true)
    void options.readArtifact(path).then(result => {
      if (!live) return
      if (!result.found) { setLoaded(undefined); setFailed(true) }
      else setLoaded({ path, content: result.content })
    }).catch(() => { if (live) { setLoaded(undefined); setFailed(true) } }).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [path, options?.readArtifact, options?.sourceRevision, options?.collapseToken, reload])
  useEffect(() => {
    cleanup.current?.(); cleanup.current = undefined
    setChapters([]); setActive(undefined)
    return () => cleanup.current?.()
  }, [content])
  const srcDoc = useMemo(() => content === undefined || !content.trim() ? undefined : secureDesignSrcDoc(content, 'static-document'), [content])
  const onLoad = useCallback(() => {
    cleanup.current?.()
    const doc = frame.current?.contentDocument, window = frame.current?.contentWindow
    if (!doc || !window) return
    const next = [...doc.querySelectorAll('h2')].flatMap((heading, index) => {
      const title = heading.textContent?.trim()
      if (!title) return []
      const id = `document-chapter-${index + 1}`
      heading.id = id
      return [{ id, title, sources: config.source_attribute ? split(heading.getAttribute(config.source_attribute)) : [],
        references: config.references_attribute ? split(heading.getAttribute(config.references_attribute)) : [] }]
    })
    setChapters(next); setActive(next[0]?.id)
    const onScroll = () => {
      let id = next[0]?.id
      for (const chapter of next) if ((doc.getElementById(chapter.id)?.getBoundingClientRect().top ?? Infinity) <= 96) id = chapter.id
      setActive(id)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    cleanup.current = () => window.removeEventListener('scroll', onScroll)
  }, [config.source_attribute, config.references_attribute])
  const rawReferences = config.references_path ? pathGet(data, config.references_path) : undefined
  const references = Array.isArray(rawReferences) ? rawReferences : rawReferences && typeof rawReferences === 'object' ? Object.values(rawReferences) : []
  const ids = new Set(references.flatMap(record => record && typeof record === 'object' && typeof record[config.references_id_field ?? ''] === 'string' ? [record[config.references_id_field!]] : []))
  const selected = chapters.find(chapter => chapter.id === active)
  const selectedCount = selected?.references.filter(id => ids.has(id)).length ?? 0
  const referenceLabel = (count: number) => config.references_label ? `${config.references_label} ×${count}` : t('referenceCount', { count })
  const attempts = options?.executionAttempts ?? []
  const latest = [...attempts].sort((a, b) => b.sequence - a.sequence)[0]
  const root = [...attempts].filter(attempt => attempt.invocationId === latest?.invocationId && attempt.role === 'producer' && attempt.artifactKind === undefined).sort((a, b) => b.sequence - a.sequence)[0]
  const activity = [...(options?.artifactActivities ?? [])].filter(item => item.artifactFile === path).sort((a, b) => b.sequence - a.sequence)[0]
  const focusedStatus = activity?.active && activity.available ? activity.nativeStatus : undefined
  const status = content !== undefined ? t('documentReady') : focusedStatus === 'running' || root?.phase === 'queued' || root?.phase === 'working' ? t('documentWorking')
    : focusedStatus === 'failed' || focusedStatus === 'interrupted' || root?.phase === 'failed' || root?.phase === 'cancelled' ? t('documentFailed') : undefined
  return <div className="dsh-document-workspace"><PanelWorkspace guidance={node.guidance} autoSaveId={`document:${node.id}`} sidebar={<PanelWorkspaceTree icon={sidebarIcon(node.sidebar_icon)} title={node.title ?? t('contents')}>
    {chapters.map(chapter => <PanelWorkspaceTreeItem key={chapter.id} selected={active === chapter.id} onSelect={() => {
      frame.current?.contentDocument?.getElementById(chapter.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); setActive(chapter.id)
    }}>{chapter.title}</PanelWorkspaceTreeItem>)}
    {!chapters.length ? <p>{t('noChapters')}</p> : null}
  </PanelWorkspaceTree>}>
    <header className="dsh-document-toolbar"><strong>{title}</strong>{status ? <span role="status">{status}</span> : null}
      <button type="button" disabled={!path || busy} onClick={() => setReload(value => value + 1)}>{busy ? t('refreshing') : t('refresh')}</button></header>
    {config.legend ? <div className="dsh-document-legend">{config.legend}{config.references_path ? <span>{referenceLabel(ids.size)}</span> : null}</div> : null}
    {selected && (selected.sources.length || selectedCount) ? <div className="dsh-document-sources">
      {selected.sources.map(id => { const definition = config.sources?.find(source => source.value === id)
        return <button type="button" key={id} disabled={!definition?.navigable || !options?.selectPanel} onClick={() => { if (definition?.navigable) options?.selectPanel?.(id) }}>{definition?.label ?? id}</button>
      })}{selectedCount ? <span>{referenceLabel(selectedCount)}</span> : null}
    </div> : null}
    <div className="dsh-document-body" aria-busy={busy}>
      {srcDoc !== undefined ? <iframe ref={frame} srcDoc={srcDoc} sandbox="allow-same-origin" referrerPolicy="no-referrer" title={title} onLoad={onLoad} />
        : <PanelContentState state={rawPath && !path || failed ? 'error' : busy ? 'loading' : path && !options?.readArtifact ? 'unavailable' : 'empty'}
          message={rawPath && !path ? t('invalidDocumentPath') : failed || path && !options?.readArtifact ? t('documentUnavailable') : busy ? t('refreshing') : node.description ?? t('emptyDocument')} />}
    </div>
  </PanelWorkspace></div>
}
