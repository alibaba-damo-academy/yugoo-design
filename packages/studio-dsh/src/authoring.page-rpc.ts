/** Optional exact-parent client over the existing Studio /api carrier. */
import type { z } from 'zod'
import type { StudioInstanceClient, StudioContentClient } from 'dsh-design-studio-ui'
import type { StudioAuthoringReference, StudioAuthoringObservation } from './authoring-agent.types.ts'
import type { StudioSessionStart, StudioSessionPrepared } from './authoring-session.types.ts'
import type { StudioPreparedLocator } from './authoring-host.types.ts'
import type { DshRemoteResult } from './client-adapter.tsx'
import { callStudioRemote, type StudioPageFetch } from './page-rpc.ts'
import { STUDIO_AUTHORING_REMOTE, STUDIO_AUTHORING_RPC_SCHEMAS, type StudioAuthoringRpcMethod } from './authoring.remote-client.ts'

export type StudioAuthoringAddress = Pick<StudioAuthoringReference, 'sessionId' | 'epoch'>
export type StudioPageAuthoringStart = Omit<StudioSessionStart, 'signal' | 'onPrepared'>
export interface StudioPageAuthoringClient {
  readonly instances: StudioInstanceClient
  readonly content?: StudioContentClient
  start(request: StudioPageAuthoringStart): Promise<StudioAuthoringReference>
  resume(request: StudioPageAuthoringStart & { readonly previous: StudioAuthoringAddress; readonly explicit: true }): Promise<StudioAuthoringReference>
  observe(address: StudioAuthoringAddress): Promise<StudioAuthoringObservation>
  cancel(address: StudioAuthoringAddress, options: { readonly expectedTurn: number | null }): Promise<StudioAuthoringObservation>
  readPrepared(address: StudioAuthoringAddress | StudioPreparedLocator): Promise<StudioSessionPrepared | undefined>
  listReferences(): Promise<readonly StudioAuthoringReference[]>
}
type Result<M extends StudioAuthoringRpcMethod> = z.output<typeof STUDIO_AUTHORING_RPC_SCHEMAS[M]['result']>

/** An explicit native SessionId locator; this browser value never substitutes for Host lookup. */
export function createSameOriginStudioAuthoringClient(options: {
  readonly agentId: string
  readonly fetch?: StudioPageFetch
}): StudioPageAuthoringClient {
  const agentId = STUDIO_AUTHORING_REMOTE.descriptors[0].parameters[0].codec.create().parse(options.agentId)
  const fetch = options.fetch ?? ((input: URL, init: RequestInit) => globalThis.fetch(input, init))
  const call = async <M extends StudioAuthoringRpcMethod>(method: M, input?: unknown): Promise<Result<M>> => {
    const descriptor = STUDIO_AUTHORING_REMOTE.descriptors.find(item => item.method === method)!
    const spec = STUDIO_AUTHORING_RPC_SCHEMAS[method]
    const request = spec.request?.parse(input)
    if (spec.request === undefined && input !== undefined) throw new Error(`studioAuthoring/${method}: no request argument is accepted`)
    const result = await callStudioRemote<DshRemoteResult<Result<M>>>(descriptor,
      { agentId, ...(request === undefined ? {} : { request }) }, fetch)
    if (!result.ok) throw new Error(`studioAuthoring/${method}: ${result.error.message ?? result.error.code ?? 'request failed'}`)
    return result.value
  }
  const instances = Object.freeze<StudioInstanceClient>({
    list: input => call('list', input),
    read: input => call('read', input),
    create: input => call('create', input),
    importSources: input => call('importSources', input),
    copy: input => call('copy', input),
    editCurrent: input => call('editCurrent', input),
    rename: input => call('rename', input),
    remove: input => call('remove', input),
    readFile: input => call('readFile', input),
    saveFile: input => call('saveFile', input),
    prepareChanges: input => call('prepareChanges', input),
    saveChanges: input => call('saveChanges', input),
    updateMounts: input => call('updateMounts', input),
    // Locale belongs to the shared renderer; the existing S2 preview port takes source/sample intent.
    preview: ({ locale: _locale, ...request }) => call('preview', request),
  })
  const content = Object.freeze<StudioContentClient>({ export: input => call('exportContentArchive', input), readArchive: input => call('readArchive', input) })
  return Object.freeze<StudioPageAuthoringClient>({ instances, content,
    start: request => call('start', request), resume: request => call('resume', request),
    observe: address => call('observe', address), cancel: async (address, input) => call('cancel', {
      ...STUDIO_AUTHORING_RPC_SCHEMAS.observe.request.parse(address),
      ...STUDIO_AUTHORING_RPC_SCHEMAS.cancel.request.pick({ expectedTurn: true }).parse(input),
    }),
    readPrepared: async address => (await call('readPrepared', address)).prepared,
    listReferences: () => call('listReferences'),
  })
}
