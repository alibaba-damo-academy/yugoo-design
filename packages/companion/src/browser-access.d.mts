export function resolveBrowserAccess(value?: unknown): 'token' | 'local'
export function companionView(value: unknown): 'panel-only' | 'full'
export const browserMethods: ReadonlySet<string>
export function browserRequestAllowed(headers: Record<string, string | string[] | undefined>, origin: string): boolean
export function localBrowserBase(pathname: string): string | undefined
export function browserTransport(location: Pick<Location, 'pathname' | 'hash'>, storage?: Pick<Storage, 'getItem' | 'setItem'>): {
  endpoint: string
  headers: Record<string, string>
  removeFragment?: boolean
}
