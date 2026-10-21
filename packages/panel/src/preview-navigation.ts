import { validatePreviewNavigationContext, type PreviewNavigationContext } from './preview-navigation-context.ts'
export interface PreviewLink { id: string; element: string; target: string; context?: PreviewNavigationContext; contextError?: string }
export interface PreviewNavigation { id: string; target: string; context?: PreviewNavigationContext }

export function previewHotspotSelection(value: unknown, channel: string, binding: string | undefined) {
  if (!binding || !value || typeof value !== 'object' || Array.isArray(value)) return
  const message = value as Record<string, unknown>
  if (Object.keys(message).sort().join(',') !== 'channel,element,id,label,type'
    || message.type !== 'design-preview:bind' || message.channel !== channel || message.id !== binding
    || typeof message.element !== 'string' || !message.element.trim() || message.element.length > 512
    || typeof message.label !== 'string' || message.label.length > 512) return
  return { element: message.element, label: message.label }
}

/** A frame message carries an edge identity, never an arbitrary URL or mutation. */
export function previewNavigationTarget(value: unknown, channel: string, links: readonly PreviewLink[]): string | undefined {
  return previewNavigation(value, channel, links)?.target
}

/** The untrusted frame supplies edge identity only; context comes from host links. */
export function previewNavigation(value: unknown, channel: string, links: readonly PreviewLink[]): PreviewNavigation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const message = value as Record<string, unknown>
  if (Object.keys(message).sort().join(',') !== 'channel,id,type'
    || message.type !== 'design-preview:navigate' || message.channel !== channel || typeof message.id !== 'string') return
  const link = links.find(link => link.id === message.id)
  if (!link) return
  if (link.contextError) throw new Error(link.contextError)
  return { id: link.id, target: link.target, ...(link.context === undefined ? {} : { context: validatePreviewNavigationContext(link.context) }) }
}

/** Host-authored interception; artifact labels/IDs cannot break out of the script. */
export function previewNavigationMarkup(channel: string, links: readonly PreviewLink[], binding?: string): string {
  const config = JSON.stringify({ channel, links, binding }).replace(/</g, '\\u003c')
  return `<script>(()=>{const config=${config};document.addEventListener('click',event=>{
    const element=event.target instanceof Element?event.target.closest('[data-prototype-id]'):null;
    if(!element)return;
    if(config.binding){event.preventDefault();event.stopImmediatePropagation();
      parent.postMessage({type:'design-preview:bind',channel:config.channel,id:config.binding,
        element:element.getAttribute('data-prototype-id'),label:(element.getAttribute('data-prototype-label')||element.getAttribute('aria-label')||element.textContent||'').trim().slice(0,512)},'*');return;}
    const link=config.links.find(item=>item.element===element.getAttribute('data-prototype-id'));
    if(!link)return;
    event.preventDefault();event.stopImmediatePropagation();
    parent.postMessage({type:'design-preview:navigate',channel:config.channel,id:link.id},'*');
  },true)})()</script>`
}
