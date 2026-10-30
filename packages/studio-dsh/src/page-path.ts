/** Browser-safe path constants shared by the host route and the launcher. */
import type { StudioPreparedLocator } from './authoring-host.types.ts'

/** Base path owned by the Studio page route. */
export const STUDIO_PAGE_BASE = '/design-studio/'

/** Slash-less route that redirects to the base path. */
export const STUDIO_PAGE_PATH = '/design-studio'

/** Bundle file name served below the base path. */
export const STUDIO_PAGE_BUNDLE = 'page-client.js'

export interface StudioAuthoringLocation {
  readonly presentation: 'content-only' | 'full'
  readonly initialInstance?: Pick<StudioPreparedLocator, 'id' | 'expectedRevision' | 'bundle'>
  readonly preparedLocator?: StudioPreparedLocator
}

/** A locator for one parent-owned S2 receipt, never a save or identity capability. */
export function studioPreparedUrl(agentId: string, locator: StudioPreparedLocator): string {
  const { requestId, digest, ...target } = locator
  const query = new URLSearchParams({ agentId, presentation: 'full', studioTarget: JSON.stringify(target), studioRequest: requestId, studioDigest: digest })
  return `${STUDIO_PAGE_BASE}?${query}`
}

/** Parse exact navigation intent; the live Host revalidates its parent and candidate. */
export function studioAuthoringLocation(href: string | undefined = globalThis.location?.href): StudioAuthoringLocation {
  if (href === undefined) return { presentation: 'full' }
  const url = new URL(href)
  const one = (name: string) => {
    const values = url.searchParams.getAll(name)
    if (values.length > 1) throw new Error(`Studio requires one ${name} locator`)
    return values[0]
  }
  const presentation = one('presentation') ?? 'full'
  if (presentation !== 'content-only' && presentation !== 'full') throw new Error('Unknown Studio presentation')
  const raw = one('studioTarget'), requestId = one('studioRequest'), digest = one('studioDigest')
  if (raw === undefined && requestId === undefined && digest === undefined) return { presentation }
  if (!studioAuthoringSessionLocator(href)) throw new Error('Studio candidate navigation requires an explicit native Session')
  const validIdentity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f]/u.test(value)
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  if (raw === undefined || raw.length > 8192) throw new Error('Studio target is missing or too large')
  const value: unknown = JSON.parse(raw)
  if (!object(value) || Object.keys(value).some(key => !['id', 'expectedRevision', 'bundle'].includes(key))
    || !validIdentity(value.id) || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) throw new Error('Invalid Studio target')
  const pin = value.bundle
  if (pin !== undefined && (!object(pin) || Object.keys(pin).some(key => !['name', 'version'].includes(key))
    || !validIdentity(pin.name) || !validIdentity(pin.version))) throw new Error('Invalid Studio Bundle pin')
  const initialInstance = { id: value.id, expectedRevision: value.expectedRevision as number,
    ...(pin === undefined ? {} : { bundle: { name: (pin as Record<string, string>).name!, version: (pin as Record<string, string>).version! } }) }
  if (requestId === undefined && digest === undefined) return { presentation, initialInstance }
  if (!validIdentity(requestId) || requestId.length > 128 || digest === undefined || !/^[a-f0-9]{64}$/u.test(digest)) throw new Error('Invalid Studio candidate locator')
  return { presentation, initialInstance, preparedLocator: { ...initialInstance, requestId, digest } }
}

/** Read only an explicit Session locator; the client codec and Host lookup validate it. */
export function studioAuthoringSessionLocator(href: string | undefined = globalThis.location?.href): string | undefined {
  if (href === undefined) return undefined
  const url = new URL(href)
  const locators = url.searchParams.getAll('agentId')
  if (!locators.length) return undefined
  if (locators.length !== 1 || (url.pathname !== STUDIO_PAGE_BASE && url.pathname !== STUDIO_PAGE_PATH)) {
    throw new Error('Studio authoring requires one explicit Session locator on its owned page')
  }
  return locators[0]
}

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
