/** Browser-safe path constants shared by the host route and the launcher. */

/** Base path owned by the Studio page route. */
export const STUDIO_PAGE_BASE = '/design-studio/'

/** Slash-less route that redirects to the base path. */
export const STUDIO_PAGE_PATH = '/design-studio'

/** Bundle file name served below the base path. */
export const STUDIO_PAGE_BUNDLE = 'page-client.js'

/** Recognize only the official Desktop application authority, not a redirect hint. */
export function isDshDesktopLocation(href: string | undefined = globalThis.location?.href): boolean {
  if (href === undefined) return false
  try {
    const url = new URL(href)
    return url.protocol === 'dsh-app:' && url.host === 'app' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/** Desktop returns through the known application root; no caller-controlled redirect. */
export function studioConversationReturnPath(href: string | undefined = globalThis.location?.href): '/' | undefined {
  if (!isDshDesktopLocation(href)) return undefined
  const { pathname } = new URL(href!)
  return pathname === STUDIO_PAGE_BASE || pathname === STUDIO_PAGE_PATH ? '/' : undefined
}
