import type { ComponentNode } from './dsl.ts'

type PreviewConfig = NonNullable<ComponentNode['live_preview']>
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
/** No expression evaluation or prototype traversal in a presentation binding. */
export function previewValue(data: unknown, path: string): unknown {
  let value = data
  for (const part of path.split('.')) {
    if (!part || forbidden.has(part) || !value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

export function previewVariables(data: unknown, tokens: PreviewConfig['tokens']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const token of tokens) {
    if (!/^--[A-Za-z0-9_-]+$/.test(token.variable)) continue
    const raw = previewValue(data, token.path) ?? (token.fallback_path ? previewValue(data, token.fallback_path) : undefined)
    let value = typeof raw === 'string' ? raw : token.fallback
    if (value === undefined) continue
    if (token.values && Object.hasOwn(token.values, value)) value = token.values[value]!
    if (token.font_fallback && !/\b(serif|sans-serif|monospace|system-ui|ui-monospace|ui-serif|ui-sans-serif|cursive|fantasy)\b/i.test(value)) value = `${value}, ${token.font_fallback}`
    out[token.variable] = value
  }
  return out
}

/** Stylesheet bytes are text, not additional trusted HTML. */
export function inlinePreviewStylesheet(html: string, css: string): string {
  const style = `<style data-panel-preview-tokens>${css.replace(/<\/style/gi, '<\\/style')}</style>`
  return /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, () => `${style}</head>`) : `${style}${html}`
}
