import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { previewGeometryMarkup, previewGeometryReport } from './preview-geometry.ts'
import { secureDesignSrcDoc } from './client/srcdoc-security.ts'
import { previewNavigationMarkup, previewNavigation, previewHotspotSelection, type PreviewLink, type PreviewNavigation } from './preview-navigation.ts'
import { previewNavigationContextMarkup, type PreviewNavigationContext } from './preview-navigation-context.ts'

let previewGeneration = 0

/** Opaque-origin preview: inline prototype behavior is allowed, host access and
 * network capabilities are not. A one-way bridge updates declared CSS variables
 * without reloading the prototype or accepting writes from the artifact. */
export function LivePreview({ html, imageHtml, variables, title, designWidth = 1280, links = [], onNavigate, binding, onBind, navigationContext, onNavigationError, onGeometry }: {
  html: string; variables: Readonly<Record<string, string>>; title: string; designWidth?: number
  imageHtml?: string
  links?: readonly PreviewLink[]; onNavigate?: (target: string, navigation: PreviewNavigation) => void
  binding?: string; onBind?: (element: string, label: string) => void
  navigationContext?: PreviewNavigationContext; onNavigationError?: (message: string) => void
  onGeometry?: (issues: string[] | undefined) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null), container = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const values = useRef(variables); values.current = variables
  const images = useMemo(() => {
    if (!imageHtml) return []
    const parser = new DOMParser()
    const originals = Array.from(parser.parseFromString(html, 'text/html').querySelectorAll('img'))
    return Array.from(parser.parseFromString(imageHtml, 'text/html').querySelectorAll('img')).flatMap((image, index) => {
      const url = image.getAttribute('src') ?? '', source = originals[index]?.getAttribute('src')
      return source && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) ? [{ index, source, url }] : []
    })
  }, [html, imageHtml])
  const imageValues = useRef(images); imageValues.current = images
  const channel = useId()
  const linkKey = JSON.stringify(links)
  const contextKey = JSON.stringify(navigationContext)
  // Each document generation gets a distinct channel. Delayed messages from a
  // prior srcDoc must not navigate the newly selected record.
  const measureGeometry = !!onGeometry
  const navigationChannel = useMemo(() => `${channel}:${++previewGeneration}`, [channel, html, linkKey, binding, contextKey, measureGeometry])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const issues = previewGeometryReport(event.data, navigationChannel)
      if (issues !== undefined) { onGeometry?.(issues); return }
      if (binding) {
        const selection = previewHotspotSelection(event.data, navigationChannel, binding)
        if (selection) onBind?.(selection.element, selection.label)
        return
      }
      try {
        const navigation = previewNavigation(event.data, navigationChannel, links)
        if (navigation !== undefined) onNavigate?.(navigation.target, navigation)
      } catch (failure) { onNavigationError?.(String(failure)) }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [navigationChannel, linkKey, onNavigate, binding, onBind, onNavigationError, onGeometry])
  useEffect(() => { onGeometry?.(undefined) }, [navigationChannel, onGeometry])
  const send = () => frame.current?.contentWindow?.postMessage({ type: 'design-preview:variables', channel, variables: values.current, images: imageValues.current }, '*')
  const srcDoc = useMemo(() => {
    const script = `<script>(()=>{const channel=${JSON.stringify(channel)};let previous=[];const ownedImages=new WeakMap();
      window.addEventListener('message',event=>{
        if(event.source!==parent || event.data?.type!=='design-preview:variables' || event.data.channel!==channel) return;
        const values=event.data.variables;
        if(!values || typeof values!=='object' || Array.isArray(values)) return;
        for(const name of previous) if(!Object.hasOwn(values,name)) document.documentElement.style.removeProperty(name);
        previous=[];
        for(const [name,value] of Object.entries(values)) if(/^--[a-zA-Z0-9_-]+$/.test(name) && typeof value==='string') {document.documentElement.style.setProperty(name,value);previous.push(name)}
        const nodes=document.querySelectorAll('img');
        for(const patch of Array.isArray(event.data.images)?event.data.images:[]) {
          if(!Number.isInteger(patch.index)||patch.index<0||typeof patch.source!=='string'||typeof patch.url!=='string'||!/^data:image\\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(patch.url))continue;
          const node=nodes[patch.index];if(!node)continue;
          if(node.getAttribute('src')!==patch.source&&ownedImages.get(node)!==patch.source)continue;
          ownedImages.set(node,patch.source);node.removeAttribute('srcset');if(node.getAttribute('src')!==patch.url)node.setAttribute('src',patch.url);
        }
      });
      document.addEventListener('click',event=>{if(event.target instanceof Element && event.target.closest('a[href]'))event.preventDefault()},true);
      document.addEventListener('submit',event=>event.preventDefault(),true);
    })()</script>`
    try {
      const context = previewNavigationContextMarkup(html, navigationContext)
      return { html: secureDesignSrcDoc(html, 'interactive-preview', context + previewNavigationMarkup(navigationChannel, links, binding) + (measureGeometry ? previewGeometryMarkup(navigationChannel, links.map(link => link.element)) : '') + script) }
    } catch (failure) { return { error: String(failure) } }
  }, [html, channel, navigationChannel, linkKey, binding, contextKey, measureGeometry])
  useEffect(send, [variables, channel, images])
  useEffect(() => {
    const element = container.current
    if (!element) return
    const fit = () => setScale(Math.min(1, element.clientWidth / designWidth))
    const observer = new ResizeObserver(fit); observer.observe(element); fit()
    return () => observer.disconnect()
  }, [designWidth])
  return <div ref={container} className="dsh-live-preview">{srcDoc.error ? <p role="alert">{srcDoc.error}</p> : <iframe key={navigationChannel} ref={frame} title={title} srcDoc={srcDoc.html}
    sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={send}
    style={{ width: scale < 1 ? designWidth : '100%', height: `${100 / Math.max(scale, .01)}%`, transform: `scale(${scale})`, transformOrigin: 'top left', border: 0 }} />}</div>
}
