/** Explicit native Service activation over the existing composed Host. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type DesignService from 'dsh-design-core'
import { PANEL_COMPONENT_CATALOG } from 'dsh-design-core/dsl'
import type { StudioInstances } from 'dsh-design-studio/node'
import { createDshStudioAuthoringHost } from './authoring-host.ts'
import type { DshStudioAuthoringHost, DshStudioAuthoringParent, StudioAuthoringAddress, StudioPreparedLocator } from './authoring-host.types.ts'
import { studioPreparedUrl } from './page-path.ts'
import type { StudioSessionRun } from './authoring-session.types.ts'
import type { StudioPageAuthoringStart } from './authoring.page-rpc.ts'
import { STUDIO_AUTHORING_RPC_SCHEMAS as schemas } from './authoring.remote-client.ts'
import { markStudioRemote } from './remote-method.ts'
import { registerStudioCustomizationTool } from './authoring-tools.ts'
import type { DshStudioManagementService } from './service.ts'
import { readStudioAuthoringMaterial, readStudioPanelComponents } from './authoring-material.ts'

export interface DshStudioAuthoringServiceConfig {
  /** Explicit private canonical Host directory, outside installed content/projects. */
  readonly stateRoot: string
  /** Explicit isolated Host workspace; never a browser argument. */
  readonly workspaceRoot: string
}
interface AuthoringContext extends Context { readonly design: DesignService; readonly fs: FileSystem }

/** No model client or extra catalog: project the installed shared Core vocabulary. */
function readComponents() {
  return { components: Object.entries(PANEL_COMPONENT_CATALOG).map(([name, entry]) => ({
    name, ...entry, generated: 'autoOrder' in entry && entry.autoOrder !== undefined,
  })), contract: 'Runtime vocabulary and composition guidance only; not a complete parameter schema or standard A2UI specification.' }
}

export class DshStudioAuthoringService extends TypertRemoteService {
  static inject = ['design', 'fs', 'agents', 'sessions', 'sessionQuery', 'tools', 'systemPrompt']
  private readonly owner: AuthoringContext
  private readonly config: DshStudioAuthoringServiceConfig
  private initialization?: Promise<DshStudioAuthoringHost>
  private host?: DshStudioAuthoringHost
  private closed = false
  private accepting = false
  private disposing?: Promise<void>
  private readonly calls = new Set<Promise<unknown>>()

  constructor(ctx: Context, config: DshStudioAuthoringServiceConfig) {
    super(ctx, 'studioAuthoring')
    this.owner = ctx as AuthoringContext
    this.config = Object.freeze({ ...config })
    // Own shutdown before init can await filesystem I/O. Joining uses the raw
    // factory promise, never the init wrapper that may await native cleanup.
    ctx.effect(() => () => this.dispose(), 'studio-authoring-service')
  }

  protected async [Service.init](): Promise<void> {
    if (this.closed) throw new Error('Studio authoring Service is disposed')
    const pending = createDshStudioAuthoringHost({ ctx: this.owner, design: this.owner.design, fs: this.owner.fs,
      stateRoot: this.config.stateRoot, workspaceRoot: this.config.workspaceRoot, readComponents })
    this.initialization = pending
    const host = await pending
    this.host = host
    if (this.closed) { await host.dispose(); throw new Error('Studio authoring Service closed during initialization') }
    this.accepting = true
    registerStudioCustomizationTool(this.owner, this)
  }

  /** Plugin lifetime only; page/request teardown never calls this method. */
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing
    this.closed = true; this.accepting = false
    // Cancel an available Host first. A still-initializing factory must also
    // settle; its rejection remains with init and cannot enable admission.
    const stop = this.host?.dispose()
    const settleInitialization = this.initialization?.then(host => host.dispose(), () => undefined)
    const calls = [...this.calls].map(call => call.then(() => undefined, () => undefined))
    this.disposing = Promise.allSettled([stop, settleInitialization, ...calls]).then(results => {
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason)
      if (failures.length) throw new AggregateError([...new Set(failures)], 'Studio authoring Service cleanup failed')
    })
    void this.disposing.catch(() => {})
    return this.disposing
  }

  private invoke<T>(agent: Agent, operation: (parent: DshStudioAuthoringParent) => T | Promise<T>): Promise<T> {
    if (this.closed || !this.accepting || !this.host) return Promise.reject(new Error('Studio authoring Service is unavailable'))
    const host = this.host
    const result = Promise.resolve().then(() => {
      if (this.closed || !this.accepting) throw new Error('Studio authoring Service is disposed')
      return operation(host.forParent(agent))
    })
    this.calls.add(result)
    void result.finally(() => this.calls.delete(result)).catch(() => {})
    return result
  }
  /** Preserve call-time JSON intent before invoke queues its admission check. */
  private request<Input, Result>(agent: Agent, input: unknown,
    parser: { parse(value: unknown): Input },
    operation: (parent: DshStudioAuthoringParent, captured: Input) => Result | Promise<Result>): Promise<Result> {
    let captured: Input
    try { captured = parser.parse(input) }
    catch (error) { return Promise.reject(error) }
    return this.invoke(agent, parent => operation(parent, captured))
  }
  private reference(run: StudioSessionRun) {
    // Observation remains native-owned; no parallel execution-status record.
    void run.result.catch(() => {})
    return structuredClone(run.reference)
  }

  /** Conversation discovery reuses the page's existing read-only catalog. */
  catalog(agent: Agent, request: Record<string, unknown>) {
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || Object.keys(request).some(key => key !== 'query')
      || (request.query !== undefined && (typeof request.query !== 'string' || request.query.length > 4096))) {
      return Promise.reject(new Error('Studio catalog accepts only an optional search query'))
    }
    const query = request.query as string | undefined
    return this.invoke(agent, () => {
      const catalog = this.owner.get('studioManagement') as DshStudioManagementService | undefined
      if (!catalog) throw new Error('Studio catalog service is unavailable')
      return catalog.workspace(query ?? '')
    })
  }
  list(agent: Agent, request?: Parameters<StudioInstances['list']>[0]) {
    return this.request(agent, request, schemas.list.request, (p, captured) => p.instances.list(captured))
  }
  read(agent: Agent, request: { readonly id: string }) {
    return this.request(agent, request, schemas.read.request, (p, captured) => p.instances.read(captured))
  }
  create(agent: Agent, request: Parameters<StudioInstances['create']>[0]) {
    return this.request(agent, request, schemas.create.request, (p, captured) => p.instances.create(captured))
  }
  importSources(agent: Agent, request: Parameters<StudioInstances['importSources']>[0]) {
    return this.request(agent, request, schemas.importSources.request, (p, captured) => p.instances.importSources(captured))
  }
  /** Existing conversation read tool only; not a browser Remote or filesystem port. */
  readAuthoringMaterial(agent: Agent, request: unknown) {
    const captured = structuredClone(request)
    return this.invoke(agent, () => readStudioAuthoringMaterial(captured))
  }
  readPanelComponents(agent: Agent, request: unknown) {
    const captured = structuredClone(request)
    return this.invoke(agent, () => readStudioPanelComponents(captured))
  }
  copy(agent: Agent, request: Parameters<StudioInstances['copy']>[0]) {
    return this.request(agent, request, schemas.copy.request, (p, captured) => p.instances.copy(captured))
  }
  editCurrent(agent: Agent, request: Parameters<StudioInstances['editCurrent']>[0]) {
    return this.request(agent, request, schemas.editCurrent.request, (p, captured) => p.instances.editCurrent(captured))
  }
  rename(agent: Agent, request: Parameters<StudioInstances['rename']>[0]) {
    return this.request(agent, request, schemas.rename.request, (p, captured) => p.instances.rename(captured))
  }
  remove(agent: Agent, request: Parameters<StudioInstances['remove']>[0]) {
    return this.request(agent, request, schemas.remove.request, (p, captured) => p.instances.remove(captured))
  }
  readFile(agent: Agent, request: Parameters<StudioInstances['readFile']>[0]) {
    return this.request(agent, request, schemas.readFile.request, (p, captured) => p.instances.readFile(captured))
  }
  saveFile(agent: Agent, request: Parameters<StudioInstances['saveFile']>[0]) {
    return this.request(agent, request, schemas.saveFile.request, (p, captured) => p.instances.saveFile(captured))
  }
  prepareChanges(agent: Agent, request: Parameters<StudioInstances['prepareChanges']>[0]) {
    return this.request(agent, request, schemas.prepareChanges.request, async (p, captured) => {
      const { locator, prepared } = await p.prepareChanges(captured)
      const { requestId, digest: _digest, ...studio } = locator
      return { ...prepared.candidate, authoring: { requestId, studio, url: studioPreparedUrl(String(agent.id), locator) } }
    })
  }
  saveChanges(agent: Agent, request: Parameters<StudioInstances['saveChanges']>[0]) {
    return this.request(agent, request, schemas.saveChanges.request, (p, captured) => p.instances.saveChanges(captured))
  }
  updateMounts(agent: Agent, request: Parameters<StudioInstances['updateMounts']>[0]) {
    return this.request(agent, request, schemas.updateMounts.request, (p, captured) => p.instances.updateMounts(captured))
  }
  preview(agent: Agent, request: Parameters<StudioInstances['preview']>[0]) {
    return this.request(agent, request, schemas.preview.request, (p, captured) => p.instances.preview(captured))
  }
  start(agent: Agent, request: StudioPageAuthoringStart) {
    return this.request(agent, request, schemas.start.request, async (p, captured) => this.reference(await p.start(captured)))
  }
  resume(agent: Agent, request: StudioPageAuthoringStart & { readonly previous: StudioAuthoringAddress; readonly explicit: true }) {
    return this.request(agent, request, schemas.resume.request, async (p, captured) => this.reference(await p.resume(captured)))
  }
  observe(agent: Agent, address: StudioAuthoringAddress) {
    return this.request(agent, address, schemas.observe.request, (p, captured) => p.observe(captured))
  }
  cancel(agent: Agent, request: StudioAuthoringAddress & { readonly expectedTurn: number | null }) {
    return this.request(agent, request, schemas.cancel.request, (p, captured) => {
      const { expectedTurn, ...address } = captured
      return p.cancel(address, { expectedTurn })
    })
  }
  readPrepared(agent: Agent, address: StudioAuthoringAddress | StudioPreparedLocator) {
    return this.request(agent, address, schemas.readPrepared.request, async (p, captured) => {
      const prepared = await p.readPrepared(captured)
      return prepared === undefined ? {} : { prepared }
    })
  }
  listReferences(agent: Agent) { return this.invoke(agent, p => p.listReferences()) }
  exportContentArchive(agent: Agent, request: Parameters<DshStudioAuthoringParent['content']['exportContentArchive']>[0]) {
    return this.request(agent, request, schemas.exportContentArchive.request, (p, input) => p.content.exportContentArchive(input))
  }
  readArchive(agent: Agent, request: { source: string }) {
    return this.request(agent, request, schemas.readArchive.request, (p, input) => p.content.readArchive(input))
  }

}

const proto = DshStudioAuthoringService.prototype
markStudioRemote(proto, 'list', proto.list)
markStudioRemote(proto, 'read', proto.read)
markStudioRemote(proto, 'create', proto.create)
markStudioRemote(proto, 'importSources', proto.importSources)
markStudioRemote(proto, 'copy', proto.copy)
markStudioRemote(proto, 'editCurrent', proto.editCurrent)
markStudioRemote(proto, 'rename', proto.rename)
markStudioRemote(proto, 'remove', proto.remove)
markStudioRemote(proto, 'readFile', proto.readFile)
markStudioRemote(proto, 'saveFile', proto.saveFile)
markStudioRemote(proto, 'prepareChanges', proto.prepareChanges)
markStudioRemote(proto, 'saveChanges', proto.saveChanges)
markStudioRemote(proto, 'updateMounts', proto.updateMounts)
markStudioRemote(proto, 'preview', proto.preview)
markStudioRemote(proto, 'start', proto.start)
markStudioRemote(proto, 'resume', proto.resume)
markStudioRemote(proto, 'observe', proto.observe)
markStudioRemote(proto, 'cancel', proto.cancel)
markStudioRemote(proto, 'readPrepared', proto.readPrepared)
markStudioRemote(proto, 'listReferences', proto.listReferences)
markStudioRemote(proto, 'exportContentArchive', proto.exportContentArchive)
markStudioRemote(proto, 'readArchive', proto.readArchive)
export default DshStudioAuthoringService
