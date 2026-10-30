/** Plugin-owned same-origin route serving the standalone Design Studio page. */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { registerPackagedCssAssets } from '../../../scripts/css-asset-host.mjs'
import { STUDIO_PAGE_BASE, STUDIO_PAGE_BUNDLE, STUDIO_PAGE_PATH } from './page-path.ts'

export { STUDIO_PAGE_BASE, STUDIO_PAGE_PATH } from './page-path.ts'

/** Minimal WebServer surface consumed by this plugin. */
export interface StudioPageWebServer {
  /** Register one named route; the returned disposer unregisters it. */
  register(route: {
    readonly kind: 'exact' | 'prefix'
    readonly path: string
    readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Incoming request slice read by the Studio route. */
export interface StudioPageRequest {
  readonly url?: string
  readonly method?: string
}

/** Server response slice written by the Studio route. */
export interface StudioPageResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  getHeader?(name: string): string | number | readonly string[] | undefined
  end(body?: string | Uint8Array): void
}

/** Cordis plugin name. */
export const name = 'dsh-design-studio-page'

/** The host web server owns the route registry. */
export const inject = ['webServer']

function requestPath(req: StudioPageRequest): string {
  const url = req.url ?? '/'
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : url.slice(0, queryIndex)
}

function send(res: StudioPageResponse, statusCode: number, contentType: string, body: string | Uint8Array, headers: Record<string, string> = {}): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'no-store')
  for (const [headerName, headerValue] of Object.entries(headers)) res.setHeader(headerName, headerValue)
  res.end(body)
}

function shellHtml(base: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Design Studio</title>
<style>html,body,#root{height:100%;margin:0}</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="${base}${STUDIO_PAGE_BUNDLE}"></script>
</body>
</html>
`
}

/** Minimal cordis effect surface consumed by this plugin. */
export interface StudioPageEffectContext {
  /** Host web server owning the named route registry. */
  readonly webServer: StudioPageWebServer
  /** Register the routes as one fiber effect; unregistration rides disposal. */
  effect<T>(execute: () => T, label?: string): T
}

/**
 * Serve the standalone Studio page below one plugin-owned base path.
 * The exact slash-less path and the prefix path are registered as separate
 * routes because the router never hands the exact path to a prefix handler.
 * Setup is transactional: a failed registration withdraws every route already
 * acquired and keeps the setup error authoritative. Disposal unregisters in
 * reverse order and preserves the first withdrawal failure.
 * @param ctx - host context carrying the web server service.
 */
export function apply(ctx: unknown): void {
  const face = ctx as StudioPageEffectContext
  const bundleUrl = new URL(`./${STUDIO_PAGE_BUNDLE}`, import.meta.url)
  const redirect = async (req: StudioPageRequest, res: StudioPageResponse): Promise<void> => {
    // Keep the explicit conversation locator through canonical slash routing.
    // The destination path stays owned here; the page validates the locator.
    const queryIndex = req.url?.indexOf('?') ?? -1
    const query = queryIndex < 0 ? '' : req.url!.slice(queryIndex)
    send(res, 308, 'text/plain; charset=utf-8', '', { Location: STUDIO_PAGE_BASE + query })
  }
  const handler = async (req: StudioPageRequest, res: StudioPageResponse): Promise<void> => {
    const path = requestPath(req)
    if (!path.startsWith(STUDIO_PAGE_BASE)) {
      send(res, 404, 'text/plain; charset=utf-8', 'Not found')
      return
    }
    const relative = path.slice(STUDIO_PAGE_BASE.length)
    if (relative === '') {
      send(res, 200, 'text/html; charset=utf-8', shellHtml('./'))
      return
    }
    if (relative === STUDIO_PAGE_BUNDLE) {
      try {
        const bundle = await readFile(bundleUrl)
        send(res, 200, 'application/javascript; charset=utf-8', bundle)
      } catch {
        send(res, 404, 'text/plain; charset=utf-8', 'Not found')
      }
      return
    }
    send(res, 404, 'text/plain; charset=utf-8', 'Not found')
  }
  face.effect(() => {
    const acquired: Array<() => void> = []
    try {
      acquired.push(registerPackagedCssAssets(face.webServer, fileURLToPath(new URL('.', import.meta.url)), [
        '/design-system-assets/dsh-design-studio-page/',
      ]))
      acquired.push(face.webServer.register({ kind: 'exact', path: STUDIO_PAGE_PATH, handler: redirect }))
      // A WebRoute prefix p matches only p and p/<anything>; the slash-less
      // path is required or subresources below the base fall through to the
      // SPA. The exact route above still wins for the bare path.
      acquired.push(face.webServer.register({ kind: 'prefix', path: STUDIO_PAGE_PATH, handler }))
    } catch (error) {
      for (const dispose of acquired.reverse()) {
        try {
          dispose()
        } catch {
          // Withdrawal reports never mask the setup failure that caused it.
        }
      }
      throw error
    }
    return async () => {
      let first: unknown
      for (const dispose of acquired.reverse()) {
        try {
          dispose()
        } catch (error) {
          first ??= error
        }
      }
      if (first !== undefined) throw first
    }
  }, 'design-studio-page.route')
}
