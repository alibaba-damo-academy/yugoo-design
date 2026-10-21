/**
 * Host shims for ported AutoAgent components. `useLang` mirrors the original
 * i18n hook's language pick (host preference, then browser fallback) over the
 * extracted Design-tree key set; a missing key falls back to the key itself.
 */
import i18n from './i18n.json' with { type: 'json' }
import { useSyncExternalStore } from 'react'

const dictionaries = i18n as Record<'en_US' | 'zh_CN', Record<string, string>>

function pickLanguage(): 'en_US' | 'zh_CN' {
  const browserLang = typeof navigator === 'undefined' ? 'en' : navigator.language || navigator.languages?.[0] || 'en'
  return browserLang.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en_US'
}

/** Public DSH LocaleRuntime face; standalone hosts need no runtime DSH import. */
export interface DesignHostLocale {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}
let hostLocale: DesignHostLocale | undefined
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
/** Read-only binding; disposal releases the host subscription and browser fallback. */
export function bindDesignHostLocale(source: DesignHostLocale): () => void {
  hostLocale = source
  const unsubscribe = source.subscribe(notify)
  notify()
  return () => {
    unsubscribe()
    if (hostLocale === source) { hostLocale = undefined; notify() }
  }
}
const cached = new Map<string, Record<string, string>>()

/** The active translation dictionary (identity-stable across renders). */
function lang(language: 'zh_CN' | 'en_US'): Record<string, string> {
  if (!cached.has(language)) {
    const dict = dictionaries[language]
    cached.set(language, new Proxy(dict, {
      get: (target, key) => (typeof key === 'string' ? target[key] ?? key : undefined),
    }))
  }
  return cached.get(language)!
}

/** Original `useLang()`: `t.<key>` resolves to the active language's string. */
export function useLang(): Record<string, string> {
  return lang(useCurrentLanguage())
}

/** The active UI language (same pick as `useLang`, for bilingual chrome). */
export function currentLanguage(): 'zh_CN' | 'en_US' {
  const active = hostLocale?.getSnapshot().active
  return active === undefined ? pickLanguage() : active.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en_US'
}

/** Follow host preference changes without remounting panels or resetting drafts. */
export function useCurrentLanguage(): 'zh_CN' | 'en_US' {
  return useSyncExternalStore(subscribe, currentLanguage, currentLanguage)
}
