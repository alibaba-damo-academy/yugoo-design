import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { sidebarIcon } from './sidebar-icon.tsx'
import type { ComponentNode } from './dsl.ts'
import type { DesignData, RenderOptions } from './interpreter.ts'
import { PanelWorkspace, PanelWorkspaceSidebar, PanelWorkspaceChoice } from './panel-workspace.tsx'
import { LivePreview } from './live-preview.tsx'
import { previewVariables, previewValue, inlinePreviewStylesheet } from './preview-tokens.ts'
import { confinedEditableArtifact } from './text-artifact-edit.ts'
import { useHtmlImageContents } from './client/panels/artifact-html-images.ts'
import { usePanelI18n } from './panel-i18n.tsx'
import { PanelContentState } from './panel-content-state.tsx'

const missingImage = async () => ({ found: false, mediaType: 'image/png' as const, base64: '', byteLength: 0 })

/** A Bundle supplies only data bindings. This component owns safe preview
 * transport and composition, never the product's palettes or field names. */
export function PreviewWorkspace({ node, data, options, children }: {
  node: ComponentNode; data: DesignData; options?: RenderOptions; children?: ReactNode
}) {
  const config = node.live_preview!, { t } = usePanelI18n()
  const raw = previewValue(data, config.file_path)
  const path = typeof raw === 'string' && options?.skill && confinedEditableArtifact(raw, options.skill) && /\.html?$/i.test(raw) ? raw : undefined
  const stylesheet = config.stylesheet && options?.skill && confinedEditableArtifact(config.stylesheet, options.skill) ? config.stylesheet : undefined
  const titleValue = config.title_path && previewValue(data, config.title_path)
  const title = typeof titleValue === 'string' && titleValue ? titleValue : node.title ?? t('preview')
  const description = config.description_path && previewValue(data, config.description_path)
  const [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState<{ path: string; html: string; hasContent: boolean }>()
  const [tuning, setTuning] = useState(false)
  const [original, setOriginal] = useState<Record<string, unknown>>()
  // Capture once per mounted workspace; later save echoes must not replace the
  // initial palette with a user-selected preset. Do not manufacture absent data.
  useEffect(() => {
    if (original || !(config.restore_paths ?? []).some(binding => previewValue(data, binding) !== undefined)) return
    setOriginal(Object.fromEntries((config.restore_paths ?? []).map(binding => [binding, structuredClone(previewValue(data, binding))])))
  }, [data, config.restore_paths, original])
  const generation = path ? options?.artifactFiles?.[path] : undefined
  const cssGeneration = stylesheet ? options?.artifactFiles?.[stylesheet] : undefined
  useEffect(() => {
    let live = true
    setFailed(false)
    if (!path || !options?.readArtifact) { setLoaded(undefined); setBusy(false); return }
    setBusy(true)
    void Promise.all([options.readArtifact(path), stylesheet ? options.readArtifact(stylesheet) : Promise.resolve({ found: false, content: '' })]).then(([html, css]) => {
      if (!live) return
      if (html.found) setLoaded({ path, hasContent: html.content.trim() !== '',
        html: css.found ? inlinePreviewStylesheet(html.content, css.content) : html.content })
      else { setLoaded(undefined); setFailed(true) }
    }).catch(() => { if (live) { setLoaded(undefined); setFailed(true) } }).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [path, stylesheet, generation, cssGeneration, options?.readArtifact, options?.sourceRevision, options?.collapseToken, reload])
  // Additional image artifacts stay inside the owning Bundle. The host remains
  // the authority for file reads; an HTML reference grants no cross-Bundle access.
  const readBinary = useCallback<NonNullable<RenderOptions['readBinaryArtifact']>>(async file =>
    options?.skill && confinedEditableArtifact(file, options.skill) && options.readBinaryArtifact ? options.readBinaryArtifact(file) : missingImage(),
  [options?.skill, options?.readBinaryArtifact])
  const contents = useHtmlImageContents(path ? [{ id: 'preview', path }] : [],
    { preview: path && loaded?.path === path ? loaded.html : null }, readBinary, options?.collapseToken, options?.artifactFiles)
  // Judge the source before CSS/image transport adds its own markup.
  const hasContent = loaded?.path === path && loaded?.hasContent === true
  const editable = options?.editable === true && Boolean(options.onPanelUpdate)
  useEffect(() => { if (!editable) setTuning(false) }, [editable])
  const apply = (values: Record<string, unknown>) => { if (editable) options?.onPanelUpdate?.(structuredClone(values)) }
  const swatches = (values: Record<string, unknown>) => <span className="dsh-preview-swatches" aria-hidden="true">{(config.swatch_paths ?? []).map(binding =>
    <i key={binding} style={{ backgroundColor: typeof values[binding] === 'string' ? values[binding] as string : 'transparent' }} />)}</span>
  return <div className="dsh-preview-workspace"><PanelWorkspace guidance={node.guidance} autoSaveId={`preview:${node.id}`} sidebar={<PanelWorkspaceSidebar icon={sidebarIcon(node.sidebar_icon)} title={node.title ?? t('previewPresets')}>
    {original ? <PanelWorkspaceChoice title={t('previewOriginal')} disabled={!editable} onChoose={() => apply(original)} /> : null}
    {(config.presets ?? []).map(preset => {
      const selected = Object.entries(preset.values).every(([binding, value]) => previewValue(data, binding) === value)
      return <PanelWorkspaceChoice key={preset.id} title={preset.title} description={preset.description} selected={selected} disabled={!editable} onChoose={() => apply(preset.values)}>
        {swatches(preset.values)}
      </PanelWorkspaceChoice>
    })}
  </PanelWorkspaceSidebar>}>
    <header className="dsh-preview-toolbar"><strong>{title}</strong>
      <button type="button" disabled={!path || busy} onClick={() => setReload(value => value + 1)}>{busy ? t('refreshing') : t('refresh')}</button>
      {options?.onPanelUpdate ? <button type="button" disabled={!editable} aria-expanded={editable && tuning} onClick={() => setTuning(value => !value)}>{t('previewAdjust')}</button> : null}
    </header>
    {typeof description === 'string' && description ? <p className="dsh-preview-description">{description}</p> : null}
    <div className="dsh-preview-main" aria-busy={busy}>
      {hasContent && contents.preview ? <LivePreview html={contents.preview} variables={previewVariables(data, config.tokens)} title={title} designWidth={config.design_width} />
        : <PanelContentState kind="preview" state={raw && !path || failed ? 'error' : busy ? 'loading' : path && !options?.readArtifact ? 'unavailable' : 'empty'}
          message={raw && !path ? t('invalidDocumentPath') : failed || path && !options?.readArtifact ? t('documentUnavailable') : busy ? t('refreshing') : node.description ?? t('emptyContent')} />}
      {editable && tuning ? <aside className="dsh-preview-adjustments" aria-label={t('previewAdjust')}>
        <header><strong>{t('previewAdjust')}</strong><button type="button" onClick={() => setTuning(false)}>{t('close')}</button></header>
        <div>{children}</div>
        <footer><p>{t('previewRegenerateHint')}</p>{options?.onSaveAndContinue ? <button type="button" disabled={!editable} onClick={options.onSaveAndContinue}>{t('previewRegenerate')}</button> : null}</footer>
      </aside> : null}
    </div>
  </PanelWorkspace></div>
}
