import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RenderOptions } from './interpreter.ts'
import { confinedEditableArtifact } from './text-artifact-edit.ts'
import { LivePreview } from './live-preview.tsx'
import type { PreviewLink, PreviewNavigation } from './preview-navigation.ts'
import type { PreviewNavigationContext } from './preview-navigation-context.ts'
import { usePanelI18n } from './panel-i18n.tsx'
import { projectArtifactExecution, projectArtifactReceipt, projectArtifactFile } from './artifact-execution.ts'
import { ExecutionTrace } from './artifact-workspace.tsx'
import { useHtmlImageContents } from './client/panels/artifact-html-images.ts'
import { useTextArtifactContents } from './client/panels/artifact-text-hydration.ts'
import { inlinePreviewStylesheet } from './preview-tokens.ts'
import { secureDesignSrcDoc } from './client/srcdoc-security.ts'
import { ArtifactStatusIcon } from './artifact-status-icon.tsx'
import { PanelContentState } from './panel-content-state.tsx'
import type { NavigationStylesheet } from './use-navigation-stylesheet.ts'

/** Read-only artifact projection. Fetch results never become canonical state. */
let previewReaderGeneration = 0
export function NavigationPreview({ path: raw, title, options, links, onNavigate, binding, onBind, artifactId, artifactKind, stylesheet, thumbnail = false, sharedStylesheet, navigationContext, onNavigationError, onNavigationReset, documentVersion, titleBadge, actions }: {
  path: unknown; title: string; options?: RenderOptions
  links?: readonly PreviewLink[]; onNavigate?: (target: string, navigation: PreviewNavigation) => void
  navigationContext?: PreviewNavigationContext; onNavigationError?: (message: string) => void
  onNavigationReset?: () => void
  documentVersion?: string
  titleBadge?: ReactNode; actions?: ReactNode
  binding?: string; onBind?: (element: string, label: string) => void
  artifactId: string; artifactKind?: string
  stylesheet?: string
  thumbnail?: boolean
  sharedStylesheet?: NavigationStylesheet
}) {
  const { t } = usePanelI18n()
  const candidate = typeof raw === 'string' && raw !== '' ? raw : artifactKind
    ? projectArtifactFile(artifactId, options?.executionAttempts ?? [], artifactKind, options?.artifactFiles ?? {}, undefined, options?.artifactActivities) : undefined
  const path = typeof candidate === 'string' && options?.skill && confinedEditableArtifact(candidate, options.skill)
    && /\.html?$/i.test(candidate) ? candidate : undefined
  const generation = path ? options?.artifactFiles?.[path] : undefined
  const receipt = path ? projectArtifactReceipt(artifactId, options?.executionAttempts, artifactKind, path) : undefined
  const [geometry, setGeometry] = useState<{ identity: number; issues: string[] | undefined }>()
  const [reload, setReload] = useState(0)
  const key = JSON.stringify([artifactId, path, generation, receipt, options?.sourceRevision, options?.collapseToken, documentVersion, reload])
  const read = options?.readArtifact
  const documentIdentity = useMemo(() => ++previewReaderGeneration, [key, read])
  const onGeometry = useCallback((issues: string[] | undefined) => setGeometry({ identity: documentIdentity, issues }), [documentIdentity])
  const geometryIssues = geometry?.identity === documentIdentity ? geometry.issues : undefined
  const [result, setResult] = useState<{ key: string; read: typeof read; html?: string; failed: boolean }>()
  useEffect(() => {
    let live = true
    if (!path || !read) return
    void read(path).then(file => {
      if (live) setResult({ key, read, html: file.found ? file.content : undefined, failed: !file.found })
    }).catch(() => { if (live) setResult({ key, read, failed: true }) })
    return () => { live = false }
  }, [key, read])
  const current = result?.key === key && result.read === read ? result : undefined
  const cssPath = stylesheet && confinedEditableArtifact(stylesheet, stylesheet.split('/')[0] ?? '')
    && /\.css$/u.test(stylesheet) ? stylesheet : undefined
  const readStyle = useCallback(async (file: string) => {
    if (file === cssPath && options?.readArtifact) return options.readArtifact(file)
    return { found: false, content: '' }
  }, [cssPath, options?.readArtifact])
  const styles = useTextArtifactContents(cssPath && sharedStylesheet === undefined ? [{ id: 'stylesheet', path: cssPath }] : [],
    readStyle, key, options?.artifactFiles)
  const css = sharedStylesheet === undefined ? styles.stylesheet
    : sharedStylesheet.path === cssPath ? sharedStylesheet.content : undefined
  const html = current?.html === undefined ? undefined : typeof css === 'string'
    ? inlinePreviewStylesheet(current.html, css) : current.html
  const readBinary = useCallback<NonNullable<RenderOptions['readBinaryArtifact']>>(async file => {
    // Image references are resolved within Design Files by prepareHtmlImages.
    // Reading a shared artifact is not editing another Bundle: the host's
    // revision-bound reader remains the authority, as in the native adapter.
    const owner = file.split('/')[0] ?? ''
    if (confinedEditableArtifact(file, owner) && /\.(?:png|jpe?g|webp)$/u.test(file)
      && options?.readBinaryArtifact) return options.readBinaryArtifact(file)
    return { found: false, mediaType: 'image/png', base64: '', byteLength: 0 }
  }, [options?.readBinaryArtifact])
  const contents = useHtmlImageContents(path ? [{ id: artifactId, path }] : [],
    { [artifactId]: html ?? null }, readBinary, key, options?.artifactFiles)
  const busy = !!path && !!options?.readArtifact && !current
  const execution = projectArtifactExecution(artifactId, options?.executionAttempts, artifactKind, current?.html !== undefined, 'pending', path, options?.artifactActivities)
  const statusLabel = execution.status === 'working' || execution.status === 'queued' ? t('documentWorking')
    : execution.status === 'failed' ? t('documentFailed') : execution.status === 'completed' ? t('documentReady') : t('emptyDocument')
  // Stylesheets and hydration are preview transport, not artifact content.
  const hasContent = html !== undefined && current?.html !== undefined && current.html.trim() !== ''
  const contentState = busy ? 'loading' : current?.failed || (candidate && !path) ? 'error'
    : path && !read ? 'unavailable' : 'empty'
  const contentMessage = busy ? t('refreshing') : candidate && !path ? t('invalidDocumentPath')
    : contentState === 'error' || contentState === 'unavailable' ? t('documentUnavailable') : t('emptyDocument')
  if (thumbnail) return <div className="dsh-navigation-thumbnail" aria-label={title} aria-busy={busy}>
    {hasContent ? <iframe title={title} loading="lazy" tabIndex={-1} aria-hidden="true"
      // As in the full preview, artifact inline scripts may draw the screen.
      // The opaque sandbox denies host/top/popup access; CSP denies fetch and
      // subresources, not this document's own navigation. No host message bridge.
      sandbox="allow-scripts" referrerPolicy="no-referrer"
      srcDoc={secureDesignSrcDoc(contents[artifactId] ?? html, 'interactive-preview')} />
      : <PanelContentState state={contentState} message={contentMessage} kind="preview" appearance="compact" />}
  </div>
  return <div className="dsh-navigation-preview" aria-busy={busy}>
    <header><div className="dsh-navigation-preview-title"><strong>{title}</strong>{titleBadge}<ArtifactStatusIcon status={execution.status} label={statusLabel} /></div><div className="dsh-navigation-preview-actions">{actions}<button type="button" data-preview-refresh disabled={!path || busy}
      onClick={() => { onNavigationReset?.(); setReload(value => value + 1) }}>{busy ? t('refreshing') : t('refresh')}</button></div></header>
    {html !== undefined && geometryIssues !== undefined ? <div className={`dsh-navigation-visual-check is-${geometryIssues.length ? 'fail' : 'pass'}`} role={geometryIssues.length ? 'alert' : 'status'}>
      {t(geometryIssues.length ? 'navigationGeometryFailed' : 'navigationGeometryPassed')}
      {geometryIssues.length ? <ul>{geometryIssues.map((issue, index) => {
        const separator = issue.indexOf(':'); const code = separator < 0 ? issue : issue.slice(0, separator); const detail = separator < 0 ? '' : issue.slice(separator + 1)
        const label = code === 'body-empty' ? t('navigationGeometryEmpty') : code === 'document-root' ? t('navigationGeometryRoot')
          : code === 'horizontal-overflow' ? t('navigationGeometryOverflow', { value: detail }) : code === 'region-missing' ? t('navigationGeometryMissing', { value: detail })
            : code === 'region-invisible' ? t('navigationGeometryInvisible', { value: detail }) : issue
        return <li key={index}>{label}</li>
      })}</ul> : null}
    </div> : null}
    <ExecutionTrace item={{ id: artifactId, title, file: path, status: execution.status, runId: execution.runId, logTarget: execution.logTarget, points: [], links: [] }} read={options?.readExecutionLog} />
    {hasContent ? <LivePreview key={documentIdentity} html={html!} imageHtml={contents[artifactId] ?? undefined} variables={{}} title={title} links={links} onNavigate={onNavigate} binding={binding} onBind={onBind} navigationContext={navigationContext} onNavigationError={onNavigationError} onGeometry={onGeometry} />
      : <PanelContentState state={contentState} message={contentMessage} kind="preview" />}
  </div>
}
