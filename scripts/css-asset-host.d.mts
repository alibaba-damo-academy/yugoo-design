import type { IncomingMessage, ServerResponse } from 'node:http'

export interface CssAssetWebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void
  }): () => void
}

/** Child context runtime shape is checked by the implementation. The optional
 * service is supplied by Cordis injection, not a property required on callers.
 */
export interface CssAssetLifecycleContext {
  inject(dependencies: string[], callback: (child: any) => void): unknown
}

export function registerPackagedCssAssets(webServer: CssAssetWebServer, packageRoot: string, prefixes: string[]): () => void
export function attachPackagedCssAssetRoutes(ctx: CssAssetLifecycleContext, packageRoot: string, prefixes: string[]): unknown
