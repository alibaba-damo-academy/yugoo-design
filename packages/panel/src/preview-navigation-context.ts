/** Selection metadata only: no URLs, expressions, nested data or design facts. */
export type PreviewNavigationContext = Readonly<Record<string, string>>
export const PREVIEW_CONTEXT_ELEMENT_ID = 'dsh-design-preview-context'

/** One budget/validation policy for both edge projection and frame bootstrap. */
export function validatePreviewNavigationContext(value: unknown): PreviewNavigationContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid preview navigation context: expected a flat string object')
  const entries = Object.entries(value)
  if (entries.length > 16) throw new Error('Invalid preview navigation context: at most 16 keys')
  const result: Record<string, string> = Object.create(null)
  for (const [key, item] of entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)
      || typeof item !== 'string' || item.length > 256) throw new Error('Invalid preview navigation context: unsafe key or non-string/oversized value')
    result[key] = item
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 4096) throw new Error('Invalid preview navigation context: exceeds 4096 bytes')
  return Object.freeze(result)
}

/** Reserved host bootstrap data is never executable artifact-owned markup. */
export function previewNavigationContextMarkup(html: string, value?: PreviewNavigationContext): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const hasReservedId = (root: ParentNode): boolean => Array.from(root.querySelectorAll('[id],template')).some(element =>
    element.id === PREVIEW_CONTEXT_ELEMENT_ID || element.tagName === 'TEMPLATE' && hasReservedId((element as HTMLTemplateElement).content))
  if (hasReservedId(document)) throw new Error(`Preview artifact uses reserved id: ${PREVIEW_CONTEXT_ELEMENT_ID}`)
  if (value === undefined) return ''
  const context = validatePreviewNavigationContext(value)
  return `<script type="application/json" id="${PREVIEW_CONTEXT_ELEMENT_ID}">${JSON.stringify(context).replace(/</g, '\\u003c')}</script>`
}
