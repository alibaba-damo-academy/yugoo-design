/**
 * Host shims for ported AutoAgent components. `useLang` mirrors the original
 * i18n hook's language pick (navigator zh → zh_CN, else en_US) over the
 * extracted Design-tree key set; a missing key falls back to the key itself.
 */
import i18n from './i18n.json' with { type: 'json' }

const dictionaries = i18n as Record<'en_US' | 'zh_CN', Record<string, string>>

function pickLanguage(): 'en_US' | 'zh_CN' {
  const browserLang = navigator.language || navigator.languages?.[0] || 'en'
  return browserLang.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en_US'
}

let cached: Record<string, string> | undefined

/** The active translation dictionary (identity-stable across renders). */
function lang(): Record<string, string> {
  if (cached === undefined) {
    const dict = dictionaries[pickLanguage()]
    cached = new Proxy(dict, {
      get: (target, key) => (typeof key === 'string' ? target[key] ?? key : undefined),
    })
  }
  return cached
}

/** Original `useLang()`: `t.<key>` resolves to the active language's string. */
export function useLang(): Record<string, string> {
  return lang()
}

/** The active UI language (same pick as `useLang`, for bilingual chrome). */
export function currentLanguage(): 'zh_CN' | 'en_US' {
  return pickLanguage()
}
