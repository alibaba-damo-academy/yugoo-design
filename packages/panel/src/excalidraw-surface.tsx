import { useEffect, useRef, useState } from 'react'
import { Excalidraw, acquireDesignUiFont } from '@excalidraw/excalidraw'
import { useCanvasFontSession } from './use-canvas-ui-font.mjs'
import type { ExcalidrawInitialDataState, BinaryFiles, ExcalidrawImperativeAPI, AppState } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import { prepareCanvasScene, type CanvasScene, type CanvasScope, type CanvasBinary } from './canvas-scene.ts'
import type { RenderOptions } from './interpreter.ts'
import type { PendingTextArtifact } from './text-artifact-edit.ts'
import { usePanelI18n } from './panel-i18n.tsx'

export default function ExcalidrawSurface(props: {
  scene: CanvasScene; assets?: PendingTextArtifact['assets']; scope: CanvasScope; disabled: boolean
  readImages: RenderOptions['readBinaryArtifact']; register: NonNullable<RenderOptions['registerBeforeSave']>
  onChange: (edit: { content: string; assets: NonNullable<PendingTextArtifact['assets']> }) => void
}) {
  const { t, locale } = usePanelI18n()
  const {error: fontError, initialized: fontsInitialized} = useCanvasFontSession(acquireDesignUiFont)
  const [initial, setInitial] = useState<ExcalidrawInitialDataState>(), [missing, setMissing] = useState<string[]>([]), [error, setError] = useState('')
  const api = useRef<ExcalidrawImperativeAPI>(), baseline = useRef<string>(), failure = useRef<unknown>()
  const source = useRef(props), current = useRef(props); current.current = props
  useEffect(() => {
    let gone = false
    const files: Record<string, CanvasBinary> = {}, unavailable: string[] = []
    void Promise.all(Object.values(source.current.scene.files).map(async reference => {
      const pending = source.current.assets?.find(asset => asset.path === reference.path)
      try {
        const read = pending ? { found: true, mediaType: reference.mimeType, base64: pending.content } : await source.current.readImages?.(reference.path)
        if (!read?.found || read.mediaType !== reference.mimeType) throw Error('missing')
        files[reference.id] = { ...reference, dataURL: `data:${reference.mimeType};base64,${read.base64}` }
      } catch { unavailable.push(reference.id) }
    })).then(() => {
      if (gone) return
      setMissing(unavailable)
      setInitial({ elements: source.current.scene.elements as ExcalidrawInitialDataState['elements'],
        appState: { ...source.current.scene.appState, currentItemFontFamily: (source.current.scene.appState as Partial<AppState>).currentItemFontFamily ?? 6 }, files: files as BinaryFiles, scrollToContent: true })
    })
    return () => { gone = true }
  }, [])
  const persist = (elements: CanvasScene['elements'], background: string, binaries: BinaryFiles, force = false) => {
    const signature = JSON.stringify([elements, background])
    // Restore, selection, zoom and tool changes are not design edits.
    if (baseline.current === undefined) { baseline.current = signature; return }
    if (signature === baseline.current && !failure.current) return
    if (current.current.disabled && !force) return
    try {
      const prepared = prepareCanvasScene(current.current.scope, elements, background, source.current.scene.files, binaries)
      // A restored pending scene already has image references, so retain its unsaved bytes too.
      const retained = source.current.assets ?? []
      const refs = Object.values(JSON.parse(prepared.content).files as CanvasScene['files'])
      const assets = [...retained.filter(asset => refs.some(ref => ref.path === asset.path)), ...prepared.assets]
      current.current.onChange({ content: prepared.content, assets })
      baseline.current = signature; failure.current = undefined; setError('')
    } catch (reason) { failure.current = reason; setError(String(reason)); if (force) throw reason }
  }
  const latestPersist = useRef(persist); latestPersist.current = persist
  useEffect(() => props.register(async () => {
    if (api.current) latestPersist.current(api.current.getSceneElementsIncludingDeleted(), api.current.getAppState().viewBackgroundColor, api.current.getFiles(), true)
    if (failure.current) throw failure.current
  }), [props.register])
  if (!initial || !fontsInitialized) return <p role="status">{t('canvasLoading')}</p>
  return <div className="dsh-canvas-surface">
    {fontError ? <p role="status">{locale.startsWith('zh') ? '白板字体加载失败，正在使用系统备用字体。' : 'Whiteboard font failed to load. System fallback is in use.'}</p> : null}
    {missing.length ? <p role="alert">{t('canvasMissingImages')} {missing.join(', ')}</p> : null}
    {error ? <p role="alert">{t('canvasSaveError')} {error}</p> : null}
    <div className="dsh-canvas-editor"><Excalidraw initialData={initial} excalidrawAPI={(value: ExcalidrawImperativeAPI) => { api.current = value }}
      langCode={locale.startsWith('zh') ? 'zh-CN' : 'en'} viewModeEnabled={props.disabled}
      handleKeyboardGlobally={false} validateEmbeddable={false} onLinkOpen={(_element: unknown, event: CustomEvent) => event.preventDefault()}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
      onChange={(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => persist(elements, appState.viewBackgroundColor, files)} /></div>
  </div>
}
