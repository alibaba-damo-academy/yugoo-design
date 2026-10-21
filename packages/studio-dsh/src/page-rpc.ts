/** Thin same-origin RPC transport for the standalone Studio page. */
import { z } from 'zod'
import type { StudioManagementClient } from 'dsh-design-studio-ui'
import type { DshRemoteResult, DshStudioRemote } from './client-adapter.tsx'
import TYPERT_REMOTE from './typert.remote-client.ts'
import { isDshDesktopLocation } from './page-path.ts'

/** Strict outer gateway result: success carries the schema-validated value. */
const rpcResultSchema = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }).strict(),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown() }).strict(),
  }).strict(),
])

/** Strict outer envelope of one DSH /api server response. */
const serverResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: z.string(),
  result: rpcResultSchema,
}).strict()

/** Page transport with the same signature as the global fetch. */
export type StudioPageFetch = (input: URL, init: RequestInit) => Promise<Response>

function resolveBase(): string {
  const location = (globalThis as { location?: { origin?: string; href?: string } }).location
  // Custom-scheme URL.origin can be "null". Keep the request on Desktop's
  // existing authenticated protocol proxy instead of guessing an HTTP backend.
  if (isDshDesktopLocation(location?.href)) return 'dsh-app://app/'
  return location?.origin !== undefined && location.origin !== 'null' ? location.origin : 'http://dsh.internal'
}

/** One session-free read-only studioManagement method. */
export type StudioRpcMethod = 'workspace' | 'readKitWorkspace' | 'readKitFiles' | 'readKitFile' | 'readBundleWorkspace' | 'readBundleFile'

/**
 * Call one session-free studioManagement method over the host /api wire.
 * The request envelope, rpcId correlation, HTTP status, response JSON, and
 * the outer gateway result are all strictly validated; the success value is
 * parsed by the matching TYPERT_REMOTE result schema, and an outer gateway
 * failure converges on the shared code/message shape.
 * @param method - endpoint method of the studioManagement namespace.
 * @param args - wire-named business arguments for the method.
 * @param doFetch - transport override for tests; defaults to the page fetch.
 * @returns the validated Remote outcome for the shared client adapter.
 */
async function callStudioManagement<T>(
  method: StudioRpcMethod,
  args: Record<string, unknown>,
  doFetch: StudioPageFetch,
): Promise<T> {
  const descriptor = TYPERT_REMOTE.descriptors.find((candidate) => candidate.method === method)
  if (descriptor === undefined) throw new Error(`studio page rpc: unknown method ${JSON.stringify(method)}`)
  const rpcId = crypto.randomUUID()
  const response = await doFetch(
    new URL(`/api/studioManagement/${method}`, resolveBase()),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: `studioManagement/${method}`, payload: { args } }),
    },
  )
  if (!response.ok) throw new Error(`studio page rpc: transport failure for ${method}: HTTP ${response.status}`)
  const envelope = serverResponseSchema.parse(await response.json())
  if (envelope.rpcId !== rpcId) throw new Error(`studio page rpc: rpcId mismatch for ${method}`)
  if (!envelope.result.ok) {
    return { ok: false, error: { code: envelope.result.error.code, message: envelope.result.error.message } } as T
  }
  return { ok: true, value: descriptor.result.create().parse(envelope.result.value) } as T
}

/**
 * Build the session-free Studio Remote over one same-origin /api transport.
 * No DSH client plugin, runtime, or module loader boots for this page.
 * @param doFetch - transport override for tests; defaults to the page fetch.
 * @returns the Remote namespace consumed by the shared client adapter.
 */
export function createSameOriginStudioRemote(doFetch: StudioPageFetch = (input, init) => globalThis.fetch(input, init)): DshStudioRemote {
  return Object.freeze({
    workspace: (query: string): Promise<DshRemoteResult<Awaited<ReturnType<StudioManagementClient['workspace']>>>> => (
      callStudioManagement('workspace', { query }, doFetch)
    ),
    readKitWorkspace: (name: string, version: string): Promise<DshRemoteResult<Awaited<ReturnType<StudioManagementClient['readKitWorkspace']>>>> => (
      callStudioManagement('readKitWorkspace', { name, version }, doFetch)
    ),
    readKitFiles: (name: string, version: string): Promise<DshRemoteResult<Awaited<ReturnType<NonNullable<StudioManagementClient['readKitFiles']>>>>> => (
      callStudioManagement('readKitFiles', { name, version }, doFetch)
    ),
    readKitFile: (name: string, version: string, path: string): Promise<DshRemoteResult<Awaited<ReturnType<NonNullable<StudioManagementClient['readKitFile']>>>>> => (
      callStudioManagement('readKitFile', { name, version, path }, doFetch)
    ),
    readBundleWorkspace: (name: string, version?: string): Promise<DshRemoteResult<Awaited<ReturnType<StudioManagementClient['readBundleWorkspace']>>>> => (
      callStudioManagement('readBundleWorkspace', { name, ...(version === undefined ? {} : { version }) }, doFetch)
    ),
    readBundleFile: (name: string, path: string, version?: string): Promise<DshRemoteResult<Awaited<ReturnType<StudioManagementClient['readBundleFile']>>>> => (
      callStudioManagement('readBundleFile', { name, path, ...(version === undefined ? {} : { version }) }, doFetch)
    ),
  })
}
