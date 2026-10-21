import { createContext, useContext } from 'react'
import zh from './locales/zh-CN.json' with { type: 'json' }
import en from './locales/en-US.json' with { type: 'json' }

export type PanelMessageKey = keyof typeof zh
const english: Record<PanelMessageKey, string> = en
export const PanelLocaleContext = createContext('zh-CN')
/** Literal replacement only; substituted record text is never evaluated again. */
export function interpolatePanelText(text: string, values: Record<string, string | number> = {}): string {
  return text.replace(/\{([^}]+)\}/g, (token, name: string) => String(values[name] ?? token))
}
export function panelText(key: PanelMessageKey, locale = 'zh-CN', values: Record<string, string | number> = {}): string {
  const dictionary = locale.toLowerCase().startsWith('zh') ? zh : english
  return interpolatePanelText(dictionary[key], values)
}
export function usePanelI18n() {
  const locale = useContext(PanelLocaleContext)
  return { locale, t: (key: PanelMessageKey, values?: Record<string, string | number>) => panelText(key, locale, values) }
}
