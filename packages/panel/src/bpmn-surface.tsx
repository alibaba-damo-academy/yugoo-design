import { useEffect, useRef, useState } from 'react'
import { BPMN_TEXT_RENDERER, applyBpmnLaneHeaderDividers, fitBpmnForVerticalBrowsing, fitBpmnToViewport, type IBpmnCanvasService } from './bpmn-viewport.ts'
import { usePanelI18n } from './panel-i18n.tsx'
import { loadBpmnRuntime } from './bpmn-runtime-loader.ts'
import { loadBpmnStyles } from './bpmn-styles-loader.ts'
import type { RenderOptions } from './interpreter.ts'

interface BpmnRuntime {
  get(name: string): unknown
  on(event: string, listener: (event: { element?: { id: string; type?: string; labelTarget?: { id: string } } }) => void): void
  importXML(xml: string): Promise<unknown>
  saveXML(options: { format: boolean }): Promise<{ xml?: string }>
  destroy(): void
}

/** Runtime-owned editor; the Bundle only binds a canonical artifact reference. */
export function BpmnSurface(props: { xml: string; editing: boolean; disabled: boolean
  selectedElement?: string; onSelectElement?: (id: string | undefined) => void
  onChange: (xml: string) => void; register: NonNullable<RenderOptions['registerBeforeSave']>
  navigationFlush: { current: (() => Promise<void>) | undefined } }) {
  const { t } = usePanelI18n()
  const container = useRef<HTMLDivElement>(null), instance = useRef<BpmnRuntime>()
  const callbacks = useRef(props); callbacks.current = props
  const [error, setError] = useState(''), [ready, setReady] = useState(false)
  const viewport = useRef<'width' | 'all' | 'manual'>('width')
  const fit = (mode: 'width' | 'all') => {
    const host = container.current, editor = instance.current
    if (!host?.clientWidth || !host.clientHeight || !editor) return
    const canvas = editor.get('canvas') as IBpmnCanvasService
    canvas.resized()
    mode === 'width' ? fitBpmnForVerticalBrowsing(canvas) : fitBpmnToViewport(canvas)
  }
  useEffect(() => {
    let gone = false, active: BpmnRuntime | undefined, version = 0, saved = 0
    let pending: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined
    let unregister: ReturnType<NonNullable<RenderOptions['registerBeforeSave']>> | undefined
    let originalText: string | undefined
    const reportPending = () => {
      const text = active && originalText !== undefined
        ? (active.get('directEditing') as { getValue(): string }).getValue() : originalText
      unregister?.setPending?.(saved !== version || (originalText !== undefined && text !== originalText))
    }
    const host = container.current
    host?.addEventListener('input', reportPending, true)
    setReady(false); setError('')
    const flush = async () => {
      if (!active || gone) return
      if (props.editing) (active.get('directEditing') as { complete(): void }).complete()
      if (timer) clearTimeout(timer)
      if (pending) await pending
      if (saved === version) return
      const serialize = async () => {
        while (saved !== version) {
          const target = version
          const output = await active!.saveXML({ format: true })
          if (!output.xml) throw Error('No BPMN XML was produced.')
          if (gone) throw Error('The diagram was closed before serialization completed.')
          callbacks.current.onChange(output.xml)
          saved = target
          reportPending()
        }
      }
      pending = serialize()
      try { await pending; setError('') }
      finally { pending = undefined }
    }
    const load = async () => {
      // CSS and renderer are loaded only when a diagram is actually opened.
      const [runtime] = await Promise.all([loadBpmnRuntime(), loadBpmnStyles()])
      const Constructor = (props.editing ? runtime.Modeler : runtime.NavigatedViewer) as unknown as new (options: Record<string, unknown>) => BpmnRuntime
      if (gone || !container.current) return
      active = new Constructor({ container: container.current, textRenderer: BPMN_TEXT_RENDERER })
      instance.current = active
      await active.importXML(props.xml)
      if (gone) return
      applyBpmnLaneHeaderDividers(active, props.xml)
      active.on('element.click', event => {
        if (callbacks.current.disabled) return
        const element = event.element?.labelTarget ?? event.element
        callbacks.current.onSelectElement?.(element?.id)
      })
      viewport.current = 'width'; fit('width'); setReady(true)
      if (props.editing) {
        active.on('directEditing.activate', () => {
          originalText = (active!.get('directEditing') as { getValue(): string }).getValue()
        })
        active.on('directEditing.deactivate', () => { originalText = undefined; reportPending() })
        active.on('commandStack.changed', () => {
          version++
          reportPending()
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => { void flush().catch(failure => { if (!gone) setError(String(failure)) }) }, 150)
        })
      }
      callbacks.current.navigationFlush.current = flush
      unregister = callbacks.current.register(flush)
    }
    void load().catch(failure => { if (!gone) setError(String(failure)) })
    const observer = new ResizeObserver(() => {
      if (!active || gone) return
      try {
        if (viewport.current === 'manual') (active.get('canvas') as IBpmnCanvasService).resized()
        else fit(viewport.current)
      } catch { /* Import or zero-sized hidden panels retry on the next resize. */ }
    })
    if (container.current) observer.observe(container.current)
    return () => {
      gone = true; if (timer) clearTimeout(timer)
      host?.removeEventListener('input', reportPending, true)
      unregister?.(); observer.disconnect()
      if (callbacks.current.navigationFlush.current === flush) callbacks.current.navigationFlush.current = undefined
      if (instance.current === active) instance.current = undefined
      active?.destroy()
    }
    // The owner remounts on file identity/revision or mode changes, not each
    // local XML echo. This preserves selection and the native undo stack.
  }, [])
  useEffect(() => {
    const runtime = instance.current
    if (!ready || !runtime) return
    const registry = runtime.get('elementRegistry') as { get?(id: string): unknown }
    const canvas = runtime.get('canvas') as { addMarker?(id: string, marker: string): void; removeMarker?(id: string, marker: string): void }
    const id = props.selectedElement
    if (!id || !registry.get?.(id)) return
    canvas.addMarker?.(id, 'dsh-diagram-selected')
    return () => { if (instance.current === runtime && registry.get?.(id)) canvas.removeMarker?.(id, 'dsh-diagram-selected') }
  }, [ready, props.selectedElement])
  const zoom = (factor: number) => {
    const canvas = instance.current?.get('canvas') as IBpmnCanvasService | undefined
    if (!canvas) return
    viewport.current = 'manual'; canvas.zoom(Math.max(0.1, Math.min(3, canvas.viewbox().scale * factor)))
  }
  return <div className="dsh-bpmn-surface">
    <div className="dsh-bpmn-toolbar" role="group" aria-label={t('diagram')}>
      <button type="button" disabled={!ready} onClick={() => { viewport.current = 'width'; fit('width') }}>{t('fitWidth')}</button>
      <button type="button" disabled={!ready} onClick={() => { viewport.current = 'all'; fit('all') }}>{t('fitAll')}</button>
      <button type="button" disabled={!ready} aria-label={t('zoomIn')} onClick={() => zoom(1.2)}>＋</button>
      <button type="button" disabled={!ready} aria-label={t('zoomOut')} onClick={() => zoom(1 / 1.2)}>−</button>
    </div>
    {error ? <p role="alert">{t('diagramInvalid')} {error}</p> : !ready ? <p role="status">{t('diagramLoading')}</p> : null}
    <div ref={container} className="dsh-bpmn-canvas" aria-label={t('diagram')} {...(props.disabled ? { inert: '' } : {})}
      onPointerDown={() => { viewport.current = 'manual' }} onWheel={() => { viewport.current = 'manual' }} />
  </div>
}
