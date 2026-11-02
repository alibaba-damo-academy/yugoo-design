import { useEffect, useState, type RefObject } from 'react'

/** Read the Host's resolved CSS scheme for imperative canvas renderers.
 * CSS remains the authority; this hook owns no preference or document styles. */
export function useColorScheme(ref: RefObject<HTMLElement | null>): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const doc = element.ownerDocument, view = doc.defaultView!
    const media = view.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => {
      const supported = view.getComputedStyle(element).colorScheme.split(/\s+/u)
      // `normal` paints light-dark()'s light branch. An explicit Host light
      // wins over OS dark; only a dual-scheme surface delegates to the OS.
      setScheme(supported.includes('dark') && (!supported.includes('light') || media.matches) ? 'dark' : 'light')
    }
    const observer = new view.MutationObserver(sync)
    // Host presenters publish their resolved scheme on the root/body. Also
    // cover an explicitly themed containing surface, without polling frames.
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme'] })
    }
    media.addEventListener('change', sync)
    sync()
    return () => { observer.disconnect(); media.removeEventListener('change', sync) }
  }, [ref])
  return scheme
}
