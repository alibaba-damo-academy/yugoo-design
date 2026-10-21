import type { PanelManifest } from './panel-dsl.ts'

export interface PanelTranslations {
  default_locale: string
  /** Bundle-relative JSON resources, expanded by the Kit loader. */
  locales: Record<string, string>
  messages?: Record<string, Record<string, string>>
}

const TEXT_KEYS = new Set(['title', 'label', 'description', 'guidance', 'placeholder', 'text', 'empty_description', 'item_name',
  'add_label', 'row_name', 'custom_description', 'token_add_description', 'menu_description', 'selected_description', 'group_label', 'create_label', 'create_title', 'new_title', 'empty', 'legend', 'references_label'])
const SKIP_KEYS = new Set(['initial_values', 'item_defaults', 'create', 'derived_fields', 'i18n', 'bindings', 'navigation_map', 'graph', 'matrix', 'board', 'question_policy', 'values', 'tokens'])
const TOKEN = /^\$t:([a-zA-Z0-9_.-]+)$/

/** Fixed endpoint names, not an expression language or executable markup. */
export function isNavigationLabelTemplate(value: unknown, allowTranslation = false): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  if (allowTranslation && TOKEN.test(value)) return true
  if (value.startsWith('$t:')) return false
  return !value.replace(/\{(?:source|target)\}/g, '').match(/[{}]/)
}

/** Traverse display text only: schema keys, ids, enum values, paths and saved facts never translate. */
function mapTexts(value: unknown, translate: (text: string) => string): unknown {
  if (Array.isArray(value)) return value.map(item => mapTexts(item, translate))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    key === 'create' && entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).map(([name, config]) => [name,
        (name === 'create_label' || name === 'create_title') && typeof config === 'string' ? translate(config)
        : name === 'initial_label' && config !== null && typeof config === 'object' && !Array.isArray(config)
          ? Object.fromEntries(Object.entries(config).map(([field, value]) => [field,
            (field === 'text' || field === 'numbered_text') && typeof value === 'string' ? translate(value) : value])) : config]))
      : key === 'navigation_map' && entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).map(([name, config]) => [name,
        name === 'edges' && config !== null && typeof config === 'object' && !Array.isArray(config)
          ? Object.fromEntries(Object.entries(config).map(([field, value]) => [field,
            field === 'new_label' && typeof value === 'string' ? translate(value) : value])) : config]))
      : key === 'diagram' && entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).map(([name, config]) => [name,
        name === 'tags' && Array.isArray(config) ? config.map(tag => ({ ...tag,
          ...(tag.labels ? { labels: Object.fromEntries(Object.entries(tag.labels).map(([key, text]) => [key, typeof text === 'string' ? translate(text) : text])) } : {}),
        })) : config]))
      : key === 'board' && entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).map(([name, config]) => [name,
        name === 'details_title' && typeof config === 'string' ? translate(config) : name === 'request_create' && config !== null && typeof config === 'object' && !Array.isArray(config)
          ? Object.fromEntries(Object.entries(config).map(([field, value]) => [field,
            (field === 'prompt' || field === 'submit_label') && typeof value === 'string' ? translate(value) : value])) : config]))
      : key === 'preview' && entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).map(([name, config]) => [name,
        name === 'empty' && typeof config === 'string' ? translate(config) : config]))
      : key === 'graph' && entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).map(([name, config]) => [name,
        name === 'hierarchy' || name === 'reverse' ? mapTexts(config, translate) : config]))
      : SKIP_KEYS.has(key) ? entry : TEXT_KEYS.has(key) && typeof entry === 'string' ? translate(entry) : mapTexts(entry, translate),
  ]))
}

export function panelTranslationKeys(manifest: PanelManifest): readonly string[] {
  const keys = new Set<string>()
  mapTexts(manifest, text => { const match = TOKEN.exec(text); if (match) keys.add(match[1]!); return text })
  return [...keys]
}

export function validatePanelTranslations(manifest: PanelManifest, requireMessages = false): string[] {
  const errors: string[] = [], config = manifest.i18n
  if (!config) return panelTranslationKeys(manifest).length ? ['translation tokens require i18n configuration'] : []
  if (typeof config !== 'object' || Array.isArray(config) || typeof config.default_locale !== 'string'
    || !config.locales || typeof config.locales !== 'object' || Array.isArray(config.locales)) return ['invalid panel i18n configuration']
  if (!Object.hasOwn(config.locales, config.default_locale)) errors.push('default_locale must have a resource')
  for (const [locale, path] of Object.entries(config.locales)) {
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) || typeof path !== 'string'
      || !/^locales\/[A-Za-z0-9._-]+\.json$/.test(path)) errors.push(`invalid locale resource ${locale}`)
  }
  if (config.messages !== undefined || requireMessages) {
    for (const locale of Object.keys(config.locales)) {
      const messages = config.messages?.[locale]
      if (!messages || typeof messages !== 'object' || Array.isArray(messages)) { errors.push(`missing messages: ${locale}`); continue }
      for (const [key, value] of Object.entries(messages)) if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(key)) errors.push(`invalid message: ${locale}.${key}`)
      // Validate resolved endpoint labels in every locale, including fallbacks.
      const checkLabels = (node: unknown): void => {
        if (!node || typeof node !== 'object') return
        const item = node as { navigation_map?: { edges?: { new_label?: unknown } }; children?: unknown[]; slots?: Record<string, unknown> }
        const label = item.navigation_map?.edges?.new_label
        if (label !== undefined) {
          const token = typeof label === 'string' ? TOKEN.exec(label) : null
          const resolved = token ? Object.hasOwn(messages, token[1]!) ? messages[token[1]!] : config.messages?.[config.default_locale]?.[token[1]!] : label
          if (!isNavigationLabelTemplate(resolved)) errors.push(`invalid navigation new_label: ${locale}`)
        }
        if (Array.isArray(item.children)) for (const child of item.children) checkLabels(child)
        if (item.slots && typeof item.slots === 'object') for (const child of Object.values(item.slots)) checkLabels(child)
      }
      checkLabels(manifest.ui)
      // Creation hints are display text, never translations of defaults or saved records.
      for (const section of manifest.sections ?? []) {
        const label = section.create?.initial_label
        if (!label) continue
        for (const field of ['text', 'numbered_text'] as const) {
          const text = label[field]
          if (field === 'numbered_text' && text === undefined) continue
          const token = typeof text === 'string' ? TOKEN.exec(text) : null
          const translated = token ? messages[token[1]!] : undefined
          const resolved = token ? typeof translated === 'string' && translated.trim()
            ? translated : config.messages?.[config.default_locale]?.[token[1]!] : text
          if (typeof resolved !== 'string' || !resolved.trim() || resolved.includes('$t:')
            || (field === 'numbered_text' ? !resolved.includes('{index}') || /[{}]/.test(resolved.replaceAll('{index}', '')) : /[{}]/.test(resolved))) {
            errors.push(`invalid create initial_label.${field}: ${locale}`)
          }
        }
      }
      // The default language is required. Other languages may fall back explicitly.
      if (locale === config.default_locale) for (const key of panelTranslationKeys(manifest)) {
        if (!Object.hasOwn(messages, key) || !messages[key]?.trim()) errors.push(`missing default translation: ${key}`)
      }
    }
  }
  return errors
}

/** Missing optional translations fall back to the Bundle's declared default locale. */
export function localizePanelManifest(manifest: PanelManifest, locale = 'zh-CN'): PanelManifest {
  const config = manifest.i18n
  if (!config?.messages) return manifest
  const normalized = locale.replaceAll('_', '-').toLowerCase()
  const selected = Object.keys(config.locales).find(key => key.toLowerCase() === normalized.toLowerCase())
    ?? Object.keys(config.locales).find(key => key.toLowerCase().split('-')[0] === normalized.split('-')[0]) ?? config.default_locale
  return mapTexts(manifest, text => {
    const match = TOKEN.exec(text)
    if (!match) return text
    const translated = config.messages?.[selected]?.[match[1]!]
    return translated?.trim() ? translated : config.messages?.[config.default_locale]?.[match[1]!] ?? text
  }) as PanelManifest
}
